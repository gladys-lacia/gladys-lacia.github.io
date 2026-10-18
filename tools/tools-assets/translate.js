/* Translate tool: login, tabs (separate conversations), translation, deletion.
   Set API_BASE_URL to the base URL of your translate Cloudflare Worker. */
(() => {
  "use strict";

  const API_BASE_URL = "https://translate-html.acct-gladyslacia.workers.dev";
  const DEFAULT_TITLE = "New translation";
  const CLEAR_PHRASE = "CLEAR";
  const DELETE_PHRASE = "DELETE";

  const $ = (id) => document.getElementById(id);
  const loginView = $("loginView");
  const loginForm = $("loginForm");
  const loginIdentifier = $("loginIdentifier");
  const loginPassword = $("loginPassword");
  const loginSubmit = $("loginSubmit");
  const loginError = $("loginError");
  const appView = $("appView");
  const newTabButton = $("newTabButton");
  const tabList = $("tabList");
  const logoutButton = $("logoutButton");
  const userLabel = $("userLabel");
  const sidebarToggle = $("sidebarToggle");
  const modeSelect = $("modeSelect");
  const settingsButton = $("settingsButton");
  const settingsMenu = $("settingsMenu");
  const clearButton = $("clearButton");
  const deleteTabButton = $("deleteTabButton");
  const pageError = $("pageError");
  const messagesEl = $("messages");
  const composer = $("composer");
  const inputText = $("inputText");
  const translateButton = $("translateButton");
  const clearDialog = $("clearDialog");
  const clearForm = $("clearForm");
  const clearPhrase = $("clearPhrase");
  const clearError = $("clearError");
  const clearCancel = $("clearCancel");
  const clearConfirm = $("clearConfirm");
  const deleteDialog = $("deleteDialog");
  const deleteForm = $("deleteForm");
  const deletePhrase = $("deletePhrase");
  const deleteError = $("deleteError");
  const deleteCancel = $("deleteCancel");
  const deleteConfirm = $("deleteConfirm");

  const state = {
    token: localStorage.getItem("translateToken"),
    user: localStorage.getItem("translateUser") || "",
    modes: [],
    tabs: [],
    messages: {},
    activeId: null,
    pending: null,
    busy: false
  };

  const isNarrow = () => window.matchMedia("(max-width: 700px)").matches;

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
      localStorage.setItem("translateToken", refreshed);
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
    if (isNarrow()) setSidebar(false);
  }

  function signOut(message) {
    state.token = null;
    state.user = "";
    state.modes = [];
    state.tabs = [];
    state.messages = {};
    state.activeId = null;
    state.pending = null;
    localStorage.removeItem("translateToken");
    localStorage.removeItem("translateUser");
    localStorage.removeItem("translateActiveTab");
    messagesEl.replaceChildren();
    tabList.replaceChildren();
    showError("");
    showLogin(message);
  }

  function setSidebar(open) {
    appView.classList.toggle("sidebar-collapsed", !open);
    sidebarToggle.setAttribute("aria-expanded", String(open));
  }

  /* ---------- Rendering ---------- */

  const activeTab = () => state.tabs.find((tab) => tab.id === state.activeId);

  function modeLabel(id) {
    const mode = state.modes.find((item) => item.id === id);
    return mode ? mode.label : id || "";
  }

  function renderTabs() {
    tabList.replaceChildren();
    state.tabs.forEach((tab) => {
      const button = el("button", "tab-item");
      button.type = "button";
      if (tab.id === state.activeId) button.setAttribute("aria-current", "true");
      button.append(el("span", "tab-title", tab.title), el("span", "tab-mode", modeLabel(tab.mode_id)));
      button.addEventListener("click", () => {
        setActive(tab.id);
        if (isNarrow()) setSidebar(false);
      });
      tabList.appendChild(button);
    });
  }

  function renderHeader() {
    const tab = activeTab();
    modeSelect.replaceChildren();
    state.modes.forEach((mode) => {
      const option = el("option", "", mode.label);
      option.value = mode.id;
      modeSelect.appendChild(option);
    });
    if (tab) modeSelect.value = tab.mode_id;
  }

  function messageNode(message) {
    const wrap = el("div", `msg msg-${message.role}`);
    if (message.role === "assistant" && message.mode_id) wrap.appendChild(el("div", "msg-label", modeLabel(message.mode_id)));
    wrap.appendChild(el("div", "msg-body", message.content));

    const actions = el("div", "msg-actions");
    if (message.role === "assistant") {
      const copy = el("button", "", "Copy");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(message.content);
          copy.textContent = "Copied";
        } catch {
          copy.textContent = "Copy failed";
        }
        setTimeout(() => { copy.textContent = "Copy"; }, 1500);
      });
      actions.appendChild(copy);
    }
    const remove = el("button", "", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deleteMessage(message));
    actions.appendChild(remove);
    wrap.appendChild(actions);
    return wrap;
  }

  function renderMessages() {
    const list = state.messages[state.activeId];
    const pending = state.pending && state.pending.tabId === state.activeId ? state.pending : null;
    messagesEl.replaceChildren();

    if (!list) {
      messagesEl.appendChild(el("p", "empty", "Loading conversation..."));
      return;
    }
    if (!list.length && !pending) {
      messagesEl.appendChild(el("p", "empty", "Choose a mode, then paste the text you want translated below."));
      return;
    }
    list.forEach((message) => messagesEl.appendChild(messageNode(message)));
    if (pending) {
      messagesEl.appendChild(el("div", "msg msg-user")).appendChild(el("div", "msg-body", pending.text));
      const wait = el("div", "msg msg-assistant msg-pending");
      wait.appendChild(el("div", "msg-body", "Translating..."));
      messagesEl.appendChild(wait);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ---------- Tabs and messages ---------- */

  async function setActive(id) {
    state.activeId = id;
    localStorage.setItem("translateActiveTab", String(id));
    showError("");
    renderTabs();
    renderHeader();
    renderMessages();
    if (state.messages[id]) return;
    try {
      const data = await api(`/api/tabs/${id}/messages`);
      state.messages[id] = data.messages;
    } catch (error) {
      showError(error.message);
      return;
    }
    if (state.activeId === id) renderMessages();
  }

  async function createTab() {
    showError("");
    try {
      const modeId = (activeTab() || {}).mode_id || state.modes[0].id;
      const data = await api("/api/tabs", { method: "POST", body: { mode_id: modeId } });
      state.tabs.unshift(data.tab);
      state.messages[data.tab.id] = [];
      await setActive(data.tab.id);
      inputText.focus();
    } catch (error) {
      showError(error.message);
    }
  }

  async function loadAll() {
    try {
      const [modes, tabs] = await Promise.all([api("/api/modes"), api("/api/tabs")]);
      state.modes = modes.modes;
      state.tabs = tabs.tabs;
    } catch (error) {
      showError(error.message);
      return;
    }
    if (!state.modes.length) {
      showError("No translation modes are configured in the Worker.");
      return;
    }
    if (!state.tabs.length) {
      await createTab();
      return;
    }
    const saved = Number(localStorage.getItem("translateActiveTab"));
    await setActive(state.tabs.some((tab) => tab.id === saved) ? saved : state.tabs[0].id);
  }

  async function changeMode() {
    const tab = activeTab();
    if (!tab) return;
    const previous = tab.mode_id;
    tab.mode_id = modeSelect.value;
    renderTabs();
    try {
      await api(`/api/tabs/${tab.id}`, { method: "PUT", body: { mode_id: tab.mode_id } });
    } catch (error) {
      tab.mode_id = previous;
      renderHeader();
      renderTabs();
      showError(error.message);
    }
  }

  async function deleteMessage(message) {
    if (!window.confirm("Delete this message? It will also be removed from the database.")) return;
    const tabId = state.activeId;
    try {
      await api(`/api/messages/${message.id}`, { method: "DELETE" });
      state.messages[tabId] = state.messages[tabId].filter((item) => item.id !== message.id);
      if (state.activeId === tabId) renderMessages();
    } catch (error) {
      showError(error.message);
    }
  }

  /* async function deleteTab() {
    const tab = activeTab();
    if (!tab || !window.confirm("Delete this tab and all of its messages? This cannot be undone.")) return;
    try {
      await api(`/api/tabs/${tab.id}`, { method: "DELETE" });
    } catch (error) {
      showError(error.message);
      return;
    }
    state.tabs = state.tabs.filter((item) => item.id !== tab.id);
    delete state.messages[tab.id];
    if (state.tabs.length) await setActive(state.tabs[0].id);
    else await createTab();
  } */
  async function deleteTab(event) {
    event.preventDefault();
    if (deletePhrase.value.trim() !== DELETE_PHRASE) return;
    const tab = activeTab();
    if (!tab) return;
    deleteConfirm.disabled = true;
    try {
      await api(`/api/tabs/${tab.id}`, { method: "DELETE", body: { confirm: DELETE_PHRASE } });
    } catch (error) {
      deleteError.textContent = error.message;
      deleteError.hidden = false;
      deleteConfirm.disabled = deletePhrase.value.trim() !== DELETE_PHRASE;
      return;
    }
    deleteDialog.close();
    state.tabs = state.tabs.filter((item) => item.id !== tab.id);
    delete state.messages[tab.id];
    if (state.tabs.length) await setActive(state.tabs[0].id);
    else await createTab();
  }

  async function clearConversation(event) {
    event.preventDefault();
    if (clearPhrase.value.trim() !== CLEAR_PHRASE) return;
    const tab = activeTab();
    clearConfirm.disabled = true;
    try {
      await api(`/api/tabs/${tab.id}/messages`, { method: "DELETE", body: { confirm: CLEAR_PHRASE } });
      state.messages[tab.id] = [];
      tab.title = DEFAULT_TITLE;
      clearDialog.close();
      renderTabs();
      renderMessages();
    } catch (error) {
      clearError.textContent = error.message;
      clearError.hidden = false;
    } finally {
      clearConfirm.disabled = clearPhrase.value.trim() !== CLEAR_PHRASE;
    }
  }

  async function translate(event) {
    event.preventDefault();
    const text = inputText.value.trim();
    if (!text || state.busy || !activeTab()) return;

    const tabId = state.activeId;
    state.busy = true;
    translateButton.disabled = true;
    state.pending = { tabId, text };
    inputText.value = "";
    autoGrow();
    showError("");
    renderMessages();

    try {
      const data = await api(`/api/tabs/${tabId}/translate`, { method: "POST", body: { text } });
      (state.messages[tabId] ||= []).push(data.user, data.assistant);
      const tab = state.tabs.find((item) => item.id === tabId);
      if (tab) tab.title = data.title;
    } catch (error) {
      if (state.activeId === tabId) {
        inputText.value = text;
        autoGrow();
      }
      showError(error.message);
    } finally {
      state.pending = null;
      state.busy = false;
      translateButton.disabled = false;
      renderTabs();
      renderMessages();
      inputText.focus();
    }
  }

  function autoGrow() {
    inputText.style.height = "auto";
    inputText.style.height = `${Math.min(inputText.scrollHeight, 200)}px`;
  }

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
      localStorage.setItem("translateToken", state.token);
      localStorage.setItem("translateUser", state.user);
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

  function closeSettings() {
    settingsMenu.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }

  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", () => signOut(""));
  newTabButton.addEventListener("click", () => {
    createTab();
    if (isNarrow()) setSidebar(false);
  });
  sidebarToggle.addEventListener("click", () => setSidebar(appView.classList.contains("sidebar-collapsed")));
  modeSelect.addEventListener("change", changeMode);
  composer.addEventListener("submit", translate);
  inputText.addEventListener("input", autoGrow);
  inputText.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) composer.requestSubmit();
  });

  settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = settingsMenu.hidden;
    settingsMenu.hidden = !open;
    settingsButton.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!settingsMenu.contains(event.target)) closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  });

  clearButton.addEventListener("click", () => {
    closeSettings();
    clearPhrase.value = "";
    clearConfirm.disabled = true;
    clearError.hidden = true;
    clearDialog.showModal();
    clearPhrase.focus();
  });
  clearPhrase.addEventListener("input", () => {
    clearConfirm.disabled = clearPhrase.value.trim() !== CLEAR_PHRASE;
  });
  clearCancel.addEventListener("click", () => clearDialog.close());
  clearForm.addEventListener("submit", clearConversation);
  /* deleteTabButton.addEventListener("click", () => {
    closeSettings();
    deleteTab();
  }); */
  deleteTabButton.addEventListener("click", () => {
    closeSettings();
    deletePhrase.value = "";
    deleteConfirm.disabled = true;
    deleteError.hidden = true;
    deleteDialog.showModal();
    deletePhrase.focus();
  });
  deletePhrase.addEventListener("input", () => {
    deleteConfirm.disabled = deletePhrase.value.trim() !== DELETE_PHRASE;
  });
  deleteCancel.addEventListener("click", () => deleteDialog.close());
  deleteForm.addEventListener("submit", deleteTab);

  /* ---------- Start ---------- */

  if (state.token) {
    showApp();
    loadAll();
  } else {
    showLogin("");
  }
})();
