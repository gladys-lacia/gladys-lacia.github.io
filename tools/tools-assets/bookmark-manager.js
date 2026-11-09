/* Bookmark Manager tool: login, three sections (Personal, Resources, Work), tabs and bookmarks.
   API_BASE_URL is the base URL of your bookmark-manager Cloudflare Worker.
   Like the Remote Job Hunting tool, the login token, username, open section and open tabs
   are kept in localStorage so a refresh does not log you out or lose your place. */
(() => {
  "use strict";

  const API_BASE_URL = "https://bookmark-manager-html.acct-gladyslacia.workers.dev";
  const DELETE_PHRASE = "DELETE";

  // Keys are prefixed so they never clash with the other tools on the same site.
  const KEY_TOKEN = "bookmarkManagerToken";
  const KEY_USER = "bookmarkManagerUser";
  const KEY_SECTION = "bookmarkManagerActiveSection";
  const KEY_TABS = "bookmarkManagerActiveTabs";

  const SECTIONS = ["personal", "resources", "work"];
  const SECTION_NAMES = { personal: "Personal", resources: "Resources", work: "Work" };
  const EMPTY_TEXT = "No bookmarks yet. Use the Add bookmark button at the top right to save your first one.";

  const $ = (id) => document.getElementById(id);
  const loginView = $("loginView");
  const loginForm = $("loginForm");
  const loginUsername = $("loginUsername");
  const loginPassword = $("loginPassword");
  const loginSubmit = $("loginSubmit");
  const loginError = $("loginError");
  const appView = $("appView");
  const userLabel = $("userLabel");
  const logoutButton = $("logoutButton");
  const pageError = $("pageError");

  const bookmarkModal = $("bookmarkModal");
  const bookmarkForm = $("bookmarkForm");
  const bookmarkTitle = $("bookmarkTitle");
  const bookmarkName = $("bookmark-name");
  const bookmarkDesc = $("bookmark-desc");
  const bookmarkUrl = $("bookmark-url");
  const bookmarkError = $("bookmarkError");
  const bookmarkSave = $("bookmarkSave");
  const tabModal = $("tabModal");
  const tabForm = $("tabForm");
  const tabTitle = $("tabTitle");
  const tabName = $("tab-name");
  const tabDesc = $("tab-desc");
  const tabError = $("tabError");
  const tabSave = $("tabSave");
  const deleteModal = $("deleteModal");
  const deleteForm = $("deleteForm");
  const deleteTitle = $("deleteTitle");
  const deleteText = $("deleteText");
  const deletePhrase = $("deletePhrase");
  const deleteError = $("deleteError");
  const deleteConfirm = $("deleteConfirm");

  /* localStorage can be unavailable (private mode, blocked storage), so every call is guarded. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
  };

  function savedTabs() {
    try {
      const data = JSON.parse(store.get(KEY_TABS) || "{}");
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  const savedSection = store.get(KEY_SECTION);
  const state = {
    token: store.get(KEY_TOKEN),
    user: store.get(KEY_USER) || "",
    tabs: [],
    bookmarks: [],
    loaded: false,
    section: SECTIONS.includes(savedSection) ? savedSection : "personal",
    activeTab: savedTabs(),   // section -> id of the open tab
    editing: null,            // { kind: "bookmark" | "tab", item, section?, tabId? } while a form is open
    deleting: null            // { kind: "bookmark" | "tab", item } while the delete popup is open
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(message) {
    pageError.textContent = message || "";
    pageError.hidden = !message;
  }

  function showFormError(node, message) {
    node.textContent = message || "";
    node.hidden = !message;
  }

  function iconLink(symbol, label, extraClass, onClick) {
    const button = el("button", `ic tool ${extraClass || ""}`.trim());
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg aria-hidden="true"><use href="#${symbol}"/></svg>`; // static markup only
    button.addEventListener("click", onClick);
    return button;
  }

  // Only web addresses are ever turned into links.
  function safeUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  }

  /* ---------- API ---------- */

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }

    const refreshed = response.headers.get("X-Refreshed-Token");
    if (refreshed && state.token) {
      state.token = refreshed;
      store.set(KEY_TOKEN, refreshed);
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/auth/login") {
      signOut("Your session expired. Log in again.");
      throw new Error("Your session expired. Log in again.");
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  async function loadAll() {
    try {
      const data = await api("/api/data");
      state.tabs = data.tabs;
      state.bookmarks = data.bookmarks;
      state.loaded = true;
      showError("");
      renderAll();
    } catch (error) {
      if (state.token) showError(error.message);
    }
  }

  /* ---------- Views ---------- */

  function showLogin(message) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message || "";
    loginError.hidden = !message;
    loginPassword.value = "";
    loginUsername.focus();
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    userLabel.textContent = state.user;
    setSection(state.section);
    renderAll();
  }

  function signOut(message) {
    state.token = null;
    state.user = "";
    state.tabs = [];
    state.bookmarks = [];
    state.loaded = false;
    state.editing = null;
    state.deleting = null;
    store.remove(KEY_TOKEN);
    store.remove(KEY_USER);
    store.remove(KEY_SECTION);
    store.remove(KEY_TABS);
    state.activeTab = {};
    closeAllModals();
    SECTIONS.forEach((section) => $(`section-${section}`).replaceChildren());
    showError("");
    setSidebar(true);
    showLogin(message);
  }

  function setSidebar(open) {
    appView.classList.toggle("sidebar-collapsed", !open);
    document.querySelectorAll(".js-sidebar-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", String(open));
    });
  }

  function setSection(section) {
    if (!SECTIONS.includes(section)) section = "personal";
    state.section = section;
    store.set(KEY_SECTION, section);
    document.querySelectorAll(".sbtn").forEach((button) => {
      if (button.dataset.section === section) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    SECTIONS.forEach((name) => { $(`section-${name}`).hidden = name !== section; });
    // A popup that belongs to another section should not stay on top of the new one.
    closeAllModals();
  }

  /* ---------- Rendering ---------- */

  const tabsOf = (section) => state.tabs.filter((tab) => tab.section === section);

  // The open tab of a section: the remembered one if it still exists, otherwise the permanent Main tab.
  function currentTab(section) {
    const tabs = tabsOf(section);
    return tabs.find((tab) => tab.id === state.activeTab[section]) || tabs.find((tab) => tab.is_permanent) || tabs[0] || null;
  }

  function selectTab(section, id) {
    state.activeTab[section] = id;
    store.set(KEY_TABS, JSON.stringify(state.activeTab));
    renderSection(section);
  }

  function renderAll() {
    SECTIONS.forEach(renderSection);
  }

  function renderSection(section) {
    const host = $(`section-${section}`);
    host.replaceChildren();
    if (!state.loaded) return;
    const tabs = tabsOf(section);
    const open = currentTab(section);
    if (!open) return;

    const tabset = el("div", "tabset");
    tabset.setAttribute("role", "group");
    tabset.setAttribute("aria-label", `${SECTION_NAMES[section]} tabs`);

    const rail = el("div", "rail");
    tabs.forEach((tab) => {
      const button = el("button", "vtab", tab.name);
      button.type = "button";
      button.title = tab.name;
      button.setAttribute("aria-selected", String(tab.id === open.id));
      button.addEventListener("click", () => selectTab(section, tab.id));
      rail.append(button);
    });
    tabset.append(rail, renderPane(section, open));
    host.append(tabset);
  }

  function renderPane(section, tab) {
    const pane = el("div", "pane");
    pane.setAttribute("aria-label", tab.name);

    const head = el("header", "phead");
    const toggle = el("button", "ic ptoggle js-sidebar-toggle");
    toggle.type = "button";
    toggle.title = "Open sidebar";
    toggle.setAttribute("aria-label", "Open sidebar");
    toggle.setAttribute("aria-expanded", String(!appView.classList.contains("sidebar-collapsed")));
    toggle.innerHTML = '<svg aria-hidden="true"><use href="#i-side"/></svg>'; // static markup only
    toggle.addEventListener("click", () => setSidebar(appView.classList.contains("sidebar-collapsed")));

    const title = el("div", "ptitle");
    title.append(el("h1", "", tab.name));
    if (tab.description) title.append(el("p", "desc", tab.description));

    const tools = el("div", "tools");
    tools.append(
      iconLink("i-tabadd", "Add tab", "", () => openTabForm(null)),
      iconLink("i-bmadd", "Add bookmark", "primary", () => openBookmarkForm(null, tab.id))
    );
    head.append(toggle, title, tools);

    const grid = el("div", "grid");
    const items = state.bookmarks.filter((bookmark) => bookmark.tab_id === tab.id);
    if (!items.length) grid.append(el("p", "empty", EMPTY_TEXT));
    items.forEach((bookmark) => grid.append(renderBookmark(bookmark)));

    const foot = el("footer", "pfoot");
    foot.append(iconLink("i-edit", "Edit tab", "", () => openTabForm(tab)));
    // The permanent Main tab cannot be deleted, so it gets no Delete tab button.
    if (!tab.is_permanent) foot.append(iconLink("i-del", "Delete tab", "danger", () => openDelete("tab", tab)));

    pane.append(head, grid, foot);
    return pane;
  }

  function renderBookmark(bookmark) {
    const card = el("div", "bm");

    const href = safeUrl(bookmark.url);
    if (href) {
      const open = el("a", "bm-open");
      open.href = href;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.setAttribute("aria-label", `Open ${bookmark.name} in a new tab`);
      card.append(open);
    }

    const copy = el("button", "mini copy", "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => copyUrl(bookmark.url, copy));

    const body = el("div", "bm-body");
    body.append(el("h3", "", bookmark.name), el("p", "bm-url", bookmark.url));

    const del = el("button", "mini del", "Delete");
    del.type = "button";
    del.addEventListener("click", () => openDelete("bookmark", bookmark));
    const edit = el("button", "mini edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => openBookmarkForm(bookmark, bookmark.tab_id));

    card.append(copy, body, del, edit);
    return card;
  }

  async function copyUrl(url, button) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const area = el("textarea");
      area.value = url;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      area.remove();
    }
    button.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  }

  /* ---------- Popups ---------- */

  const MODALS = [bookmarkModal, tabModal, deleteModal];

  function openModal(modal, focusNode) {
    modal.hidden = false;
    if (focusNode) focusNode.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
  }

  function closeAllModals() {
    MODALS.forEach(closeModal);
    state.editing = null;
    state.deleting = null;
  }

  function closeTop() {
    const open = MODALS.filter((modal) => !modal.hidden);
    if (!open.length) return;
    const top = open.includes(deleteModal) ? deleteModal : open[open.length - 1];
    closeModal(top);
    if (top === deleteModal) state.deleting = null;
    else state.editing = null;
  }

  /* Bookmark form (add and edit use the same popup) */

  function openBookmarkForm(bookmark, tabId) {
    state.editing = { kind: "bookmark", item: bookmark, tabId };
    bookmarkTitle.textContent = bookmark ? "Edit bookmark" : "Add a bookmark";
    bookmarkName.value = bookmark ? bookmark.name : "";
    bookmarkDesc.value = bookmark ? bookmark.description : "";
    bookmarkUrl.value = bookmark ? bookmark.url : "";
    showFormError(bookmarkError, "");
    openModal(bookmarkModal, bookmarkName);
  }

  bookmarkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editing = state.editing;
    if (!editing || editing.kind !== "bookmark") return;

    const name = bookmarkName.value.trim();
    const url = bookmarkUrl.value.trim();
    if (!name) return showFormError(bookmarkError, "Enter a bookmark name.");
    if (!url) return showFormError(bookmarkError, "Enter the URL.");
    if (!safeUrl(url)) return showFormError(bookmarkError, "Enter a full web address, for example https://example.com/");

    bookmarkSave.disabled = true;
    showFormError(bookmarkError, "");
    try {
      const body = { name, description: bookmarkDesc.value.trim(), url };
      if (editing.item) {
        const result = await api(`/api/bookmarks/${editing.item.id}`, { method: "PUT", body });
        state.bookmarks = state.bookmarks.map((item) => (item.id === result.bookmark.id ? result.bookmark : item));
      } else {
        const result = await api("/api/bookmarks", { method: "POST", body: { ...body, tab_id: editing.tabId } });
        state.bookmarks.push(result.bookmark);
      }
      closeModal(bookmarkModal);
      state.editing = null;
      renderAll();
    } catch (error) {
      showFormError(bookmarkError, error.message);
    } finally {
      bookmarkSave.disabled = false;
    }
  });

  /* Tab form (add and edit use the same popup) */

  function openTabForm(tab) {
    state.editing = { kind: "tab", item: tab, section: state.section };
    tabTitle.textContent = tab ? "Edit tab" : "Add a tab";
    tabName.value = tab ? tab.name : "";
    tabDesc.value = tab ? tab.description : "";
    showFormError(tabError, "");
    openModal(tabModal, tabName);
  }

  tabForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editing = state.editing;
    if (!editing || editing.kind !== "tab") return;

    const name = tabName.value.trim();
    if (!name) return showFormError(tabError, "Enter a tab name.");

    tabSave.disabled = true;
    showFormError(tabError, "");
    try {
      const body = { name, description: tabDesc.value.trim() };
      if (editing.item) {
        const result = await api(`/api/tabs/${editing.item.id}`, { method: "PUT", body });
        state.tabs = state.tabs.map((item) => (item.id === result.tab.id ? result.tab : item));
      } else {
        const result = await api("/api/tabs", { method: "POST", body: { ...body, section: editing.section } });
        state.tabs.push(result.tab);
        state.activeTab[editing.section] = result.tab.id;   // open the tab that was just made
        store.set(KEY_TABS, JSON.stringify(state.activeTab));
      }
      closeModal(tabModal);
      state.editing = null;
      renderAll();
    } catch (error) {
      showFormError(tabError, error.message);
    } finally {
      tabSave.disabled = false;
    }
  });

  /* Delete popup (shared by bookmarks and tabs) */

  function openDelete(kind, item) {
    state.deleting = { kind, item };
    if (kind === "tab") {
      deleteTitle.textContent = "Delete this tab?";
      deleteText.textContent = "This permanently removes this tab and every bookmark inside it.";
    } else {
      deleteTitle.textContent = "Delete this bookmark?";
      deleteText.textContent = "This permanently removes this bookmark.";
    }
    deletePhrase.value = "";
    deleteConfirm.disabled = true;
    showFormError(deleteError, "");
    openModal(deleteModal, deletePhrase);
  }

  // The Delete button stays dim until DELETE is typed exactly.
  deletePhrase.addEventListener("input", () => {
    deleteConfirm.disabled = deletePhrase.value.trim() !== DELETE_PHRASE;
  });

  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = state.deleting;
    if (!target || deletePhrase.value.trim() !== DELETE_PHRASE) return;

    deleteConfirm.disabled = true;
    showFormError(deleteError, "");
    try {
      const path = `/api/${target.kind === "tab" ? "tabs" : "bookmarks"}/${target.item.id}`;
      await api(path, { method: "DELETE", body: { confirm: DELETE_PHRASE } });
      if (target.kind === "tab") {
        state.tabs = state.tabs.filter((tab) => tab.id !== target.item.id);
        state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.tab_id !== target.item.id);
        delete state.activeTab[target.item.section];
        store.set(KEY_TABS, JSON.stringify(state.activeTab));
      } else {
        state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== target.item.id);
      }
      state.deleting = null;
      closeModal(deleteModal);
      renderAll();
    } catch (error) {
      showFormError(deleteError, error.message);
      deleteConfirm.disabled = deletePhrase.value.trim() !== DELETE_PHRASE;
    }
  });

  /* ---------- Login ---------- */

  async function handleLogin(event) {
    event.preventDefault();
    loginSubmit.disabled = true;
    loginError.hidden = true;
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: { username: loginUsername.value.trim(), password: loginPassword.value }
      });
      state.token = result.token;
      state.user = result.user.username;
      store.set(KEY_TOKEN, state.token);
      store.set(KEY_USER, state.user);
      loginPassword.value = "";
      showApp();
      await loadAll();
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    } finally {
      loginSubmit.disabled = false;
    }
  }

  /* ---------- Events ---------- */

  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", () => signOut(""));

  document.querySelectorAll(".sbtn").forEach((button) => {
    button.addEventListener("click", () => setSection(button.dataset.section));
  });

  document.querySelectorAll(".js-sidebar-toggle").forEach((button) => {
    button.addEventListener("click", () => setSidebar(appView.classList.contains("sidebar-collapsed")));
  });

  MODALS.forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target.classList.contains("backdrop") || event.target.closest("[data-close]")) {
        if (modal === deleteModal) state.deleting = null;
        else state.editing = null;
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTop();
  });

  /* ---------- Start ---------- */

  if (state.token) {
    showApp();
    loadAll();
  } else {
    showLogin("");
  }
})();
