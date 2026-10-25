/* Prompts tool: login, ISMCO templates, other templates, and input notes.
   Set API_BASE_URL to the base URL of your prompts Cloudflare Worker.
   Like the Translate tool, the login token, username, and last open section
   are kept in localStorage so a refresh does not log you out. */
(() => {
  "use strict";

  const API_BASE_URL = "https://multi-user-prompts-tool.acct-gladyslacia.workers.dev";
  const DELETE_PHRASE = "DELETE";

  // Keys are prefixed so they never clash with the Translate tool on the same site.
  const KEY_TOKEN = "promptsToken";
  const KEY_USER = "promptsUser";
  const KEY_TAB = "promptsActiveTab";

  const TABS = ["ismco", "other", "inputs"];
  const KIND_FOR_TAB = { ismco: "ismco", other: "other", inputs: "note" };
  const TAB_FOR_KIND = { ismco: "ismco", other: "other", note: "inputs" };
  const EMPTY_TEXT = {
    ismco: "No ISMCO templates yet. Choose + Add template to save your first one.",
    other: "No templates yet. Choose + Add template to save your first one.",
    inputs: "No notes yet. Choose + Add note to save your first one."
  };
  const ISMCO_FIELDS = [
    ["INTENT", "intent"],
    ["SCOPE", "scope"],
    ["METHOD", "method"],
    ["CONSTRAINTS", "constraints"],
    ["OUTPUT", "output"]
  ];
  const OPEN_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.5 3.5h5v5M16.5 3.5l-6 6M8.5 4.5h-4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"/></svg>';

  const $ = (id) => document.getElementById(id);
  const loginView = $("loginView");
  const loginForm = $("loginForm");
  const loginIdentifier = $("loginIdentifier");
  const loginPassword = $("loginPassword");
  const loginSubmit = $("loginSubmit");
  const loginError = $("loginError");
  const appView = $("appView");
  const userLabel = $("userLabel");
  const logoutButton = $("logoutButton");
  const pageError = $("pageError");

  const ismcoModal = $("ismcoModal");
  const ismcoForm = $("ismcoForm");
  const ismcoError = $("ismcoError");
  const ismcoSave = $("ismcoSave");
  const otherModal = $("otherModal");
  const otherForm = $("otherForm");
  const otherError = $("otherError");
  const otherSave = $("otherSave");
  const noteModal = $("noteModal");
  const noteForm = $("noteForm");
  const noteError = $("noteError");
  const noteSave = $("noteSave");
  const noteWithIsmco = $("note-with-ismco");
  const notePlain = $("note-plain");
  const noteTemplate = $("note-template");
  const viewModal = $("viewModal");
  const viewDialog = $("viewDialog");
  const deleteModal = $("deleteModal");
  const deleteForm = $("deleteForm");
  const deletePhrase = $("deletePhrase");
  const deleteError = $("deleteError");
  const deleteConfirm = $("deleteConfirm");

  /* localStorage can be unavailable (private mode, blocked storage), so every call is guarded. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } }
  };

  const savedTab = store.get(KEY_TAB);
  const state = {
    token: store.get(KEY_TOKEN),
    user: store.get(KEY_USER) || "",
    items: [],
    loaded: false,
    tab: TABS.includes(savedTab) ? savedTab : "ismco",
    editing: null,
    deleting: null
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

  /* ---------- Views ---------- */

  function showLogin(message) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = message || "";
    loginError.hidden = !message;
    loginPassword.value = "";
    loginIdentifier.focus();
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    userLabel.textContent = state.user;
    setTab(state.tab);
    renderAll();
  }

  function signOut(message) {
    state.token = null;
    state.user = "";
    state.items = [];
    state.loaded = false;
    state.editing = null;
    state.deleting = null;
    store.remove(KEY_TOKEN);
    store.remove(KEY_USER);
    store.remove(KEY_TAB);
    closeAllModals();
    TABS.forEach((tab) => $(`grid-${tab}`).replaceChildren());
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

  function setTab(tab) {
    if (!TABS.includes(tab)) tab = "ismco";
    state.tab = tab;
    store.set(KEY_TAB, tab);
    document.querySelectorAll(".tab-btn").forEach((button) => {
      if (button.dataset.tab === tab) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.hidden = panel.dataset.tab !== tab;
    });
  }

  /* ---------- Data helpers ---------- */

  const itemsOf = (kind) => state.items.filter((item) => item.kind === kind);
  const templateById = (id) => state.items.find((item) => item.kind === "ismco" && item.id === id);

  function upsertItem(item) {
    const index = state.items.findIndex((existing) => existing.id === item.id);
    if (index === -1) state.items.unshift(item);
    else state.items[index] = item;
  }

  function noteLabel(item) {
    const parts = [];
    if (item.template_id) {
      const template = templateById(item.template_id);
      parts.push(`With ISMCO template: ${template ? template.title : "(template not found)"}`);
    }
    if (item.plain_notes) parts.push(item.template_id ? "Plain notes" : "Plain note");
    return parts.join(" + ") || "Plain note";
  }

  function copyTextFor(item) {
    if (item.kind === "other") return item.body;
    const chunks = [];
    const template = item.template_id ? templateById(item.template_id) : null;
    if (template) {
      ISMCO_FIELDS.forEach(([label, key]) => {
        if (template[key]) chunks.push(`${label}:\n${template[key]}`);
      });
      chunks.push(`INPUT:\n${item.input_text}`);
    }
    if (item.plain_notes) chunks.push(template ? `NOTES:\n${item.plain_notes}` : item.plain_notes);
    return chunks.join("\n\n");
  }

  /* ---------- Rendering ---------- */

  function cardNode(item) {
    const tab = TAB_FOR_KIND[item.kind];
    const card = el("article", `card card-${tab}`);

    const open = el("button", "card-open");
    open.type = "button";
    open.title = item.kind === "note" ? "Open note" : "Open template";
    open.setAttribute("aria-label", open.title);
    open.innerHTML = OPEN_ICON; // static markup only; no user text is inserted here
    card.appendChild(open);

    if (item.kind === "other") {
      card.appendChild(el("p", "card-snippet card-snippet-long", item.body));
    } else if (item.kind === "ismco") {
      card.append(el("h3", "", item.title), el("p", "card-snippet", item.intent));
    } else {
      card.append(el("h3", "", item.title), el("p", "card-snippet", noteLabel(item)));
    }

    card.addEventListener("click", () => openView(item));
    return card;
  }

  function renderGrid(tab) {
    const grid = $(`grid-${tab}`);
    grid.replaceChildren();
    if (!state.loaded) {
      grid.appendChild(el("p", "empty", "Loading..."));
      return;
    }
    const list = itemsOf(KIND_FOR_TAB[tab]);
    if (!list.length) {
      grid.appendChild(el("p", "empty", EMPTY_TEXT[tab]));
      return;
    }
    list.forEach((item) => grid.appendChild(cardNode(item)));
  }

  function renderAll() {
    TABS.forEach(renderGrid);
  }

  async function loadAll() {
    state.loaded = false;
    renderAll();
    try {
      const data = await api("/api/items");
      state.items = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      if (!state.token) return;
      state.items = [];
      showError(error.message);
    }
    state.loaded = true;
    renderAll();
  }

  /* ---------- Popups ---------- */

  const openModals = [];

  function syncModalStack() {
    openModals.forEach((modal, index) => { modal.inert = index !== openModals.length - 1; });
    appView.inert = openModals.length > 0;
  }

  function openModal(modal, focusNode) {
    if (!modal.hidden) return;
    modal.hidden = false;
    modal.returnFocus = document.activeElement;
    openModals.push(modal);
    syncModalStack();
    const target = focusNode || modal.querySelector("input, textarea, select, button");
    if (target) target.focus();
  }

  function closeModal(modal) {
    if (modal.hidden) return;
    modal.hidden = true;
    modal.inert = false;
    const index = openModals.indexOf(modal);
    if (index !== -1) openModals.splice(index, 1);
    syncModalStack();
    const back = modal.returnFocus;
    modal.returnFocus = null;
    if (back && document.contains(back) && typeof back.focus === "function") back.focus();
  }

  function closeAllModals() {
    [...openModals].reverse().forEach(closeModal);
  }

  document.addEventListener("click", (event) => {
    const closer = event.target.closest("[data-close]");
    if (!closer) return;
    const modal = closer.closest(".modal");
    if (modal) closeModal(modal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openModals.length) closeModal(openModals[openModals.length - 1]);
  });

  async function copyText(button, text) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  }

  function promptList(pairs) {
    const list = el("dl", "prompt");
    pairs.forEach(([label, value]) => {
      list.append(el("dt", "", label), el("dd", "", value));
    });
    return list;
  }

  function openView(item) {
    viewDialog.replaceChildren();

    // Templates in "Other Templates" and notes can be copied; ISMCO templates have no Copy button.
    if (item.kind !== "ismco") {
      const copy = el("button", "copy", "Copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(copy, copyTextFor(item)));
      viewDialog.appendChild(copy);
    }

    const title = el("h2", "", item.kind === "other" ? "Template" : item.title);
    title.id = "viewTitle";
    viewDialog.appendChild(title);

    if (item.kind === "ismco") {
      viewDialog.appendChild(promptList(ISMCO_FIELDS.map(([label, key]) => [label, item[key]])));
    } else if (item.kind === "other") {
      viewDialog.appendChild(el("p", "prompt-text", item.body));
    } else {
      viewDialog.appendChild(el("p", "dialog-sub", noteLabel(item)));
      const template = item.template_id ? templateById(item.template_id) : null;
      if (template) {
        const pairs = ISMCO_FIELDS.map(([label, key]) => [label, template[key]]);
        pairs.push(["INPUT", item.input_text]);
        if (item.plain_notes) pairs.push(["NOTES", item.plain_notes]);
        viewDialog.appendChild(promptList(pairs));
      } else if (item.plain_notes) {
        viewDialog.appendChild(el("p", "prompt-text", item.plain_notes));
      }
    }

    const foot = el("div", "dialog-foot");
    const remove = el("button", "delete", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => openDelete(item));
    const edit = el("button", "edit", "Edit");
    edit.type = "button";
    edit.addEventListener("click", () => {
      closeModal(viewModal);
      openEdit(item);
    });
    foot.append(remove, edit);
    viewDialog.appendChild(foot);

    openModal(viewModal, edit);
  }

  function openEdit(item) {
    if (item.kind === "ismco") openIsmcoForm(item);
    else if (item.kind === "other") openOtherForm(item);
    else openNoteForm(item);
  }

  /* ---------- Add and edit forms ---------- */

  async function saveItem(kind, payload, errorNode, submitButton, modal) {
    showFormError(errorNode, "");
    submitButton.disabled = true;
    try {
      const editing = state.editing;
      const data = editing
        ? await api(`/api/items/${editing.id}`, { method: "PUT", body: payload })
        : await api("/api/items", { method: "POST", body: { kind, ...payload } });
      upsertItem(data.item);
      state.editing = null;
      closeModal(modal);
      renderAll();
    } catch (error) {
      showFormError(errorNode, error.message);
    } finally {
      submitButton.disabled = false;
    }
  }

  function openIsmcoForm(item) {
    state.editing = item || null;
    $("ismcoTitle").textContent = item ? "Edit ISMCO template" : "Add an ISMCO template";
    $("ismco-name").value = item ? item.title : "";
    ISMCO_FIELDS.forEach(([, key]) => { $(`ismco-${key}`).value = item ? item[key] : ""; });
    showFormError(ismcoError, "");
    openModal(ismcoModal, $("ismco-name"));
  }

  function openOtherForm(item) {
    state.editing = item || null;
    $("otherTitle").textContent = item ? "Edit template" : "Add a template";
    $("other-body").value = item ? item.body : "";
    showFormError(otherError, "");
    openModal(otherModal, $("other-body"));
  }

  function syncNoteBlocks() {
    $("blockIsmco").hidden = !noteWithIsmco.checked;
    $("blockPlain").hidden = !notePlain.checked;
  }

  function openNoteForm(item) {
    state.editing = item || null;
    $("noteTitle").textContent = item ? "Edit note" : "Add a note";
    $("note-title").value = item ? item.title : "";

    const templates = itemsOf("ismco");
    noteTemplate.replaceChildren();
    if (!templates.length) {
      const none = el("option", "", "No ISMCO templates yet");
      none.value = "";
      noteTemplate.appendChild(none);
    } else {
      templates.forEach((template) => {
        const option = el("option", "", template.title);
        option.value = String(template.id);
        noteTemplate.appendChild(option);
      });
    }

    noteWithIsmco.checked = Boolean(item && item.template_id);
    notePlain.checked = Boolean(item && item.plain_notes);
    if (item && item.template_id) noteTemplate.value = String(item.template_id);
    $("note-input").value = item ? item.input_text : "";
    $("note-plain-text").value = item ? item.plain_notes : "";
    syncNoteBlocks();
    showFormError(noteError, "");
    openModal(noteModal, $("note-title"));
  }

  ismcoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("ismco-name").value.trim();
    if (!title) {
      showFormError(ismcoError, "Enter a template name.");
      return;
    }
    const payload = { title };
    ISMCO_FIELDS.forEach(([, key]) => { payload[key] = $(`ismco-${key}`).value.trim(); });
    saveItem("ismco", payload, ismcoError, ismcoSave, ismcoModal);
  });

  otherForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = $("other-body").value.trim();
    if (!body) {
      showFormError(otherError, "Enter the template text.");
      return;
    }
    saveItem("other", { body }, otherError, otherSave, otherModal);
  });

  noteWithIsmco.addEventListener("change", syncNoteBlocks);
  notePlain.addEventListener("change", syncNoteBlocks);

  noteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("note-title").value.trim();
    if (!title) {
      showFormError(noteError, "Enter what this note is about.");
      return;
    }
    if (!noteWithIsmco.checked && !notePlain.checked) {
      showFormError(noteError, "Choose With ISMCO Template, Plain Notes, or both.");
      return;
    }

    let templateId = null;
    let inputText = "";
    let plainNotes = "";
    if (noteWithIsmco.checked) {
      templateId = Number(noteTemplate.value) || null;
      if (!templateId) {
        showFormError(noteError, "Choose an ISMCO template. Add one in ISMCO Templates first.");
        return;
      }
      inputText = $("note-input").value.trim();
      if (!inputText) {
        showFormError(noteError, "Enter the INPUT for the ISMCO template.");
        return;
      }
    }
    if (notePlain.checked) {
      plainNotes = $("note-plain-text").value.trim();
      if (!plainNotes) {
        showFormError(noteError, "Write your notes.");
        return;
      }
    }

    saveItem(
      "note",
      { title, template_id: templateId, input_text: inputText, plain_notes: plainNotes },
      noteError,
      noteSave,
      noteModal
    );
  });

  /* ---------- Delete ---------- */

  function openDelete(item) {
    state.deleting = item;
    deletePhrase.value = "";
    deleteConfirm.disabled = true;
    showFormError(deleteError, "");
    openModal(deleteModal, deletePhrase);
  }

  deletePhrase.addEventListener("input", () => {
    deleteConfirm.disabled = deletePhrase.value.trim() !== DELETE_PHRASE;
  });

  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (deletePhrase.value.trim() !== DELETE_PHRASE) return;
    const item = state.deleting;
    if (!item) return;
    deleteConfirm.disabled = true;
    try {
      await api(`/api/items/${item.id}`, { method: "DELETE", body: { confirm: DELETE_PHRASE } });
      state.items = state.items.filter((existing) => existing.id !== item.id);
      state.deleting = null;
      closeModal(deleteModal);
      closeModal(viewModal);
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
        body: { identifier: loginIdentifier.value.trim(), password: loginPassword.value }
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

  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelectorAll(".js-sidebar-toggle").forEach((button) => {
    button.addEventListener("click", () => setSidebar(appView.classList.contains("sidebar-collapsed")));
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.add;
      if (kind === "ismco") openIsmcoForm(null);
      else if (kind === "other") openOtherForm(null);
      else openNoteForm(null);
    });
  });

  /* ---------- Start ---------- */

  if (state.token) {
    showApp();
    loadAll();
  } else {
    showLogin("");
  }
})();
