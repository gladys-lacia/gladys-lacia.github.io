/* Remote Job Hunting tool: login, ISMCO templates, notes with uploads, work diaries,
   and five AI analysis sections.
   Set API_BASE_URL to the base URL of your remote-jobhunting Cloudflare Worker.
   Like the Prompts tool, the login token, username, and last open section
   are kept in localStorage so a refresh does not log you out. */
(() => {
  "use strict";

  const API_BASE_URL = "https://remote-jobhunting-html.acct-gladyslacia.workers.dev";
  const DELETE_PHRASE = "DELETE";

  // Keys are prefixed so they never clash with the other tools on the same site.
  const KEY_TOKEN = "remoteJobHuntingToken";
  const KEY_USER = "remoteJobHuntingUser";
  const KEY_TAB = "remoteJobHuntingActiveTab";

  const TABS = ["ismco", "notes", "diary", "experience", "description", "classification", "application", "workdiary"];
  const KINDS = ["diary", "experience", "description", "classification", "application"];
  const EMPTY_TEXT = {
    ismco: "No ISMCO templates yet. Choose + Add template to save your first one.",
    notes: "No notes yet. Choose + Add note to save your first one.",
    diary: "No diary analyses yet. Choose + Add analysis to run your first one.",
    experience: "No experience analyses yet. Choose + Add analysis to run your first one.",
    description: "No description analyses yet. Choose + Add analysis to run your first one.",
    classification: "No classification analyses yet. Choose + Add classification to run your first one.",
    application: "No application analyses yet. Choose + Add application to run your first one.",
    workdiary: "No work diaries yet. Choose + Add work diary to start your first one."
  };
  const TAB_NUMBER = { ismco: 1, notes: 2, diary: 3, experience: 4, description: 5, classification: 6, application: 7, workdiary: 8 };
  const APPLIES_TO = {
    diary: "Diary Analysis",
    experience: "Experience Analysis",
    description: "Description Analysis",
    classification: "Classification Analysis",
    application: "Application Analysis"
  };
  const ADD_TITLE = {
    diary: "Add a diary analysis",
    experience: "Add an experience analysis",
    description: "Add a description analysis",
    classification: "Add a classification analysis",
    application: "Add an application analysis"
  };
  const EDIT_TITLE = {
    diary: "Edit diary analysis",
    experience: "Edit experience analysis",
    description: "Edit description analysis",
    classification: "Edit classification analysis",
    application: "Edit application analysis"
  };
  const PURPOSE_LABEL = {
    diary: "What is this diary analysis for?",
    experience: "What is this experience analysis for?",
    description: "What is this description analysis for?",
    classification: "What is this classification for?",
    application: "What is this application for?"
  };
  const ISMCO_FIELDS = [
    ["INTENT", "intent"],
    ["SCOPE", "scope"],
    ["METHOD", "method"],
    ["CONSTRAINTS", "constraints"],
    ["OUTPUT", "output"]
  ];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MAX_FILES = 5;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const FILE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "txt"];
  const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

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
  const sidebarNode = document.querySelector(".sidebar");
  const contentNode = document.querySelector(".content");

  const ismcoModal = $("ismcoModal");
  const ismcoForm = $("ismcoForm");
  const ismcoError = $("ismcoError");
  const ismcoSave = $("ismcoSave");
  const noteModal = $("noteModal");
  const noteForm = $("noteForm");
  const noteError = $("noteError");
  const noteSave = $("noteSave");
  const notePlainCheck = $("note-plain-check");
  const noteUploadsCheck = $("note-uploads-check");
  const noteSlots = $("noteSlots");
  const analysisModal = $("analysisModal");
  const analysisForm = $("analysisForm");
  const analysisError = $("analysisError");
  const analysisSave = $("analysisSave");
  const diaryModal = $("diaryModal");
  const diaryForm = $("diaryForm");
  const diaryError = $("diaryError");
  const diarySave = $("diarySave");
  const viewModal = $("viewModal");
  const viewDialog = $("viewDialog");
  const previewModal = $("previewModal");
  const previewDialog = $("previewDialog");
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
    templates: [],
    notes: [],
    diaries: [],
    analyses: [],
    loaded: false,
    tab: TABS.includes(savedTab) ? savedTab : "ismco",
    editing: null,
    deleting: null,
    formKind: null,
    entries: new Map(),
    slots: []
  };
  const fileUrls = new Map();

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

  function iconButton(symbol, label, onClick) {
    const button = el("button", "ic");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg aria-hidden="true"><use href="#${symbol}"/></svg>`; // static markup only
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  function autogrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 140)}px`;
  }

  /* ---------- Dates: always shown in UTC+8, whatever the device clock says ---------- */

  function parts8(iso) {
    const date = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
    return { y: date.getUTCFullYear(), mo: date.getUTCMonth(), d: date.getUTCDate(), h: date.getUTCHours(), mi: date.getUTCMinutes() };
  }
  const fmtDate = (iso) => { const p = parts8(iso); return `${p.y} ${MONTHS[p.mo]} ${p.d}`; };
  function fmtStamp(iso) {
    const p = parts8(iso);
    const hour = p.h % 12 || 12;
    return `${fmtDate(iso)} at ${hour}:${String(p.mi).padStart(2, "0")} ${p.h >= 12 ? "pm" : "am"} UTC+8`;
  }
  function timeframeOf(entries) {
    if (!entries.length) return "No entries yet";
    const times = entries.map((e) => new Date(e.created_at).getTime());
    const first = fmtDate(new Date(Math.min(...times)).toISOString());
    const last = fmtDate(new Date(Math.max(...times)).toISOString());
    return first === last ? first : `${first} to ${last}`;
  }
  // The same text the Worker sends to the AI as the INPUT for a diary-based analysis.
  function diaryContent(diary, entries) {
    const ordered = [...entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
    const lines = [`Work diary: ${diary.title}`];
    if (diary.context) lines.push(`Context: ${diary.context}`);
    if (ordered.length) {
      lines.push(`Covered timeframe: ${timeframeOf(ordered)}`, "", "Entries:");
      ordered.forEach((entry) => lines.push(`[${fmtStamp(entry.created_at)}] ${entry.content}`));
    }
    return lines.join("\n");
  }

  /* ---------- API ---------- */

  async function api(path, { method = "GET", body, form, blob } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, {
        method,
        headers,
        body: form || (body === undefined ? undefined : JSON.stringify(body)),
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
    if (blob && response.ok) return response.blob();
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
    state.templates = [];
    state.notes = [];
    state.diaries = [];
    state.analyses = [];
    state.loaded = false;
    state.editing = null;
    state.deleting = null;
    state.entries.clear();
    fileUrls.forEach((url) => URL.revokeObjectURL(url));
    fileUrls.clear();
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
    document.querySelectorAll(".tab").forEach((button) => {
      if (button.dataset.tab === tab) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.hidden = panel.dataset.tab !== tab;
    });
    // A popup that belongs to another tab should not stay on top of the new tab.
    closeAllModals();
  }

  /* ---------- Data helpers ---------- */

  const COLLECTION = { templates: "templates", notes: "notes", diaries: "diaries", analyses: "analyses" };
  const templateById = (id) => state.templates.find((item) => item.id === id);
  const noteById = (id) => state.notes.find((item) => item.id === id);
  const diaryById = (id) => state.diaries.find((item) => item.id === id);
  const analysesOf = (kind) => state.analyses.filter((item) => item.kind === kind);

  function upsert(collection, item) {
    const list = state[collection];
    const index = list.findIndex((existing) => existing.id === item.id);
    if (index === -1) list.unshift(item);
    else list[index] = item;
  }

  // The list keeps only a summary of each analysis; the view popup loads the full result.
  function analysisSummary(detail) {
    const { result, messages, ...summary } = detail;
    return summary;
  }

  function noteLabel(note) {
    const hasPlain = Boolean(note.plain_text);
    const hasFiles = note.files.length > 0;
    if (hasPlain && hasFiles) return "Plain notes and uploads";
    if (hasFiles) return "With uploads";
    return "Plain notes";
  }

  function fileExtension(name) {
    const match = /\.([A-Za-z0-9]+)$/.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  async function fileUrl(file) {
    if (fileUrls.has(file.id)) return fileUrls.get(file.id);
    const blob = await api(`/api/files/${file.id}`, { blob: true });
    const url = URL.createObjectURL(blob);
    fileUrls.set(file.id, url);
    return url;
  }

  /* ---------- Rendering ---------- */

  function cardNode(tab, title, line, onOpen) {
    const card = el("article", `card c${TAB_NUMBER[tab]}`);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.append(el("h3", "", title), el("p", "", line));
    card.addEventListener("click", onOpen);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    });
    return card;
  }

  function itemsFor(tab) {
    if (tab === "ismco") return state.templates;
    if (tab === "notes") return state.notes;
    if (tab === "workdiary") return state.diaries;
    return analysesOf(tab);
  }

  function cardFor(tab, item) {
    if (tab === "ismco") return cardNode(tab, item.title, item.intent, () => openIsmcoView(item));
    if (tab === "notes") return cardNode(tab, item.title, noteLabel(item), () => openNoteView(item));
    if (tab === "workdiary") return cardNode(tab, item.title, `Created ${fmtDate(item.created_at)}`, () => openDiaryView(item));
    return cardNode(tab, item.title, `Source: ${item.source_label}`, () => openAnalysisView(item));
  }

  function renderGrid(tab) {
    const grid = $(`grid-${tab}`);
    grid.replaceChildren();
    if (!state.loaded) {
      grid.appendChild(el("p", "empty", "Loading..."));
      return;
    }
    const list = itemsFor(tab);
    if (!list.length) {
      grid.appendChild(el("p", "empty", EMPTY_TEXT[tab]));
      return;
    }
    list.forEach((item) => grid.appendChild(cardFor(tab, item)));
  }

  function renderAll() {
    TABS.forEach(renderGrid);
  }

  async function loadAll() {
    state.loaded = false;
    renderAll();
    try {
      const data = await api("/api/all");
      state.templates = Array.isArray(data.templates) ? data.templates : [];
      state.notes = Array.isArray(data.notes) ? data.notes : [];
      state.diaries = Array.isArray(data.diaries) ? data.diaries : [];
      state.analyses = Array.isArray(data.analyses) ? data.analyses : [];
    } catch (error) {
      if (!state.token) return;
      showError(error.message);
    }
    state.loaded = true;
    renderAll();
  }

  /* ---------- Markdown: the AI answers in markdown; it is shown as safe, simple formatting ---------- */

  function inlineMarkdown(parent, text) {
    const pattern = /(\*\*(.+?)\*\*|`([^`]+)`|\*(?!\s)(.+?)\*)/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) parent.append(text.slice(last, match.index));
      if (match[2] !== undefined) parent.appendChild(el("strong", "", match[2]));
      else if (match[3] !== undefined) parent.appendChild(el("code", "", match[3]));
      else parent.appendChild(el("em", "", match[4]));
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function renderMarkdown(text, root) {
    root.replaceChildren();
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list = null;
    let listType = "";

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = el("p");
      inlineMarkdown(p, paragraph.join(" "));
      root.appendChild(p);
      paragraph = [];
    };
    const flushList = () => { list = null; listType = ""; };
    const addItem = (type, content) => {
      flushParagraph();
      if (!list || listType !== type) {
        list = el(type);
        listType = type;
        root.appendChild(list);
      }
      const li = el("li");
      inlineMarkdown(li, content);
      list.appendChild(li);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) {
        flushParagraph(); flushList();
        const h = el("h4");
        inlineMarkdown(h, m[1].replace(/\s+#+\s*$/, ""));
        root.appendChild(h);
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushParagraph(); flushList();
        root.appendChild(el("hr"));
      } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        addItem("ul", m[1]);
      } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        addItem("ol", m[1]);
      } else if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flushParagraph(); flushList();
        const wrap = el("div", "tbl");
        const table = el("table");
        const head = el("tr");
        splitRow(line).forEach((cell) => { const th = el("th"); inlineMarkdown(th, cell); head.appendChild(th); });
        table.appendChild(head);
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          const row = el("tr");
          splitRow(lines[i]).forEach((cell) => { const td = el("td"); inlineMarkdown(td, cell); row.appendChild(td); });
          table.appendChild(row);
          i++;
        }
        i--;
        wrap.appendChild(table);
        root.appendChild(wrap);
      } else {
        flushList();
        paragraph.push(line.trim());
      }
    }
    flushParagraph();
  }

  /* ---------- Popups ---------- */

  const openModals = [];

  function syncModalStack() {
    openModals.forEach((modal, index) => { modal.inert = index !== openModals.length - 1; });
    const open = openModals.length > 0;
    sidebarNode.inert = open;
    contentNode.inert = open;
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
    setTimeout(() => { button.textContent = "copy"; }, 1500);
  }

  // Header used by every view popup: edit and delete on the left, close on the right.
  function viewHeader(title, onEdit, onDelete) {
    const head = el("header", "head");
    const heading = el("h2", "", title);
    heading.id = "viewTitle";
    const close = iconButton("i-x", "Close");
    close.setAttribute("data-close", "");
    head.append(iconButton("i-edit", "Edit", onEdit), iconButton("i-del", "Delete", onDelete), heading, close);
    return head;
  }

  function startView(className) {
    viewDialog.className = className;
    viewDialog.replaceChildren();
  }

  /* ---------- ISMCO templates ---------- */

  function openIsmcoView(item) {
    startView("dialog");
    viewDialog.append(viewHeader(item.title, () => { closeModal(viewModal); openIsmcoForm(item); }, () => openDelete("templates", item)));
    viewDialog.appendChild(el("p", "sub", `Updated last ${fmtStamp(item.updated_at)}.`));
    const list = el("dl", "dl");
    ISMCO_FIELDS.forEach(([label, key]) => list.append(el("dt", "", label), el("dd", "", item[key])));
    list.append(el("dt", "", "Applies to"), el("dd", "", APPLIES_TO[item.applies_to] || item.applies_to));
    viewDialog.appendChild(list);
    openModal(viewModal);
  }

  function openIsmcoForm(item) {
    state.editing = item || null;
    $("ismcoTitle").textContent = item ? "Edit ISMCO template" : "Add an ISMCO template";
    $("ismco-name").value = item ? item.title : "";
    ISMCO_FIELDS.forEach(([, key]) => { $(`ismco-${key}`).value = item ? item[key] : ""; });
    $("ismco-applies").value = item ? item.applies_to : "diary";
    showFormError(ismcoError, "");
    openModal(ismcoModal, $("ismco-name"));
  }

  async function saveItem(collection, payload, errorNode, submitButton, modal) {
    showFormError(errorNode, "");
    submitButton.disabled = true;
    try {
      const editing = state.editing;
      const data = editing
        ? await api(`/api/${collection}/${editing.id}`, { method: "PUT", body: payload })
        : await api(`/api/${collection}`, { method: "POST", body: payload });
      upsert(collection, data.item);
      state.editing = null;
      closeModal(modal);
      renderAll();
      return data.item;
    } catch (error) {
      showFormError(errorNode, error.message);
      return null;
    } finally {
      submitButton.disabled = false;
    }
  }

  ismcoForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("ismco-name").value.trim();
    if (!title) {
      showFormError(ismcoError, "Enter what this prompt is for.");
      return;
    }
    const payload = { title, applies_to: $("ismco-applies").value };
    ISMCO_FIELDS.forEach(([, key]) => { payload[key] = $(`ismco-${key}`).value.trim(); });
    saveItem("templates", payload, ismcoError, ismcoSave, ismcoModal);
  });

  /* ---------- Notes ---------- */

  function syncNoteBlocks() {
    $("blockPlain").hidden = !notePlainCheck.checked;
    $("blockUploads").hidden = !noteUploadsCheck.checked;
  }

  function renderSlots() {
    noteSlots.replaceChildren();
    for (let index = 0; index < MAX_FILES; index++) {
      const slot = state.slots[index];
      const box = el("label", slot ? "up filled" : "up");
      if (!slot) {
        const input = el("input", "sr");
        input.type = "file";
        input.accept = FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
        input.addEventListener("change", () => {
          const file = input.files && input.files[0];
          if (!file) return;
          if (!FILE_EXTENSIONS.includes(fileExtension(file.name))) {
            showFormError(noteError, "Only PDF, PNG, JPG, WEBP or TXT files can be uploaded.");
            return;
          }
          if (file.size > MAX_FILE_BYTES) {
            showFormError(noteError, "Each file must be 4 MB or smaller.");
            return;
          }
          showFormError(noteError, "");
          state.slots[index] = { file };
          renderSlots();
        });
        box.append(input, el("span", "", `+ File ${index + 1}`));
      } else {
        const name = slot.file ? slot.file.name : slot.existing.name;
        box.appendChild(el("span", "", name));
        const remove = el("button", "rm");
        remove.type = "button";
        remove.title = "Remove file";
        remove.setAttribute("aria-label", `Remove ${name}`);
        remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15"/></svg>'; // static markup only
        remove.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.slots[index] = null;
          renderSlots();
        });
        box.appendChild(remove);
      }
      noteSlots.appendChild(box);
    }
  }

  function openNoteForm(item) {
    state.editing = item || null;
    $("noteTitle").textContent = item ? "Edit note" : "Add a note";
    $("note-title").value = item ? item.title : "";
    notePlainCheck.checked = Boolean(item && item.plain_text);
    noteUploadsCheck.checked = Boolean(item && item.files.length);
    $("note-plain-text").value = item ? item.plain_text : "";
    state.slots = Array.from({ length: MAX_FILES }, (_, index) => (item && item.files[index] ? { existing: item.files[index] } : null));
    renderSlots();
    syncNoteBlocks();
    showFormError(noteError, "");
    openModal(noteModal, $("note-title"));
  }

  function openNoteView(item) {
    startView("dialog");
    viewDialog.append(viewHeader(item.title, () => { closeModal(viewModal); openNoteForm(item); }, () => openDelete("notes", item)));
    viewDialog.appendChild(el("p", "sub", `Updated last ${fmtStamp(item.updated_at)}.`));

    if (item.plain_text) {
      const section = el("section", "sec");
      section.appendChild(el("p", "txt", item.plain_text));
      const row = el("div", "copyrow");
      const copy = el("button", "copy", "copy");
      copy.type = "button";
      copy.addEventListener("click", () => copyText(copy, item.plain_text));
      row.appendChild(copy);
      section.appendChild(row);
      viewDialog.appendChild(section);
    }

    if (item.files.length) {
      const section = el("section", "sec pv");
      item.files.forEach((file) => {
        const button = el("button");
        button.type = "button";
        const figure = el("figure");
        const thumb = el("span", "", fileExtension(file.name).toUpperCase());
        figure.append(thumb, el("figcaption", "", file.name));
        button.appendChild(figure);
        button.addEventListener("click", () => openPreview(file));
        section.appendChild(button);
        if (IMAGE_EXTENSIONS.includes(fileExtension(file.name))) {
          fileUrl(file).then((url) => {
            const img = el("img");
            img.alt = "";
            img.src = url;
            thumb.replaceChildren(img);
          }).catch(() => { /* the extension label stays as the thumbnail */ });
        }
      });
      viewDialog.appendChild(section);
    }
    openModal(viewModal);
  }

  async function openPreview(file) {
    previewDialog.replaceChildren();
    const head = el("header", "head");
    const heading = el("h2", "", file.name);
    heading.id = "previewTitle";
    const close = iconButton("i-x", "Close preview");
    close.setAttribute("data-close", "");
    head.append(heading, close);
    const body = el("div", "bigpv", "Loading preview...");
    previewDialog.append(head, body);
    openModal(previewModal, close);
    try {
      const url = await fileUrl(file);
      body.replaceChildren();
      if (IMAGE_EXTENSIONS.includes(fileExtension(file.name))) {
        const img = el("img");
        img.alt = file.name;
        img.src = url;
        body.appendChild(img);
      } else {
        const frame = el("iframe");
        frame.title = file.name;
        frame.src = url;
        body.appendChild(frame);
      }
    } catch (error) {
      body.textContent = error.message;
    }
  }

  notePlainCheck.addEventListener("change", syncNoteBlocks);
  noteUploadsCheck.addEventListener("change", syncNoteBlocks);

  noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = $("note-title").value.trim();
    if (!title) {
      showFormError(noteError, "Enter what this note is for.");
      return;
    }
    const withPlain = notePlainCheck.checked;
    const withUploads = noteUploadsCheck.checked;
    if (!withPlain && !withUploads) {
      showFormError(noteError, "Choose Plain Notes, With Uploads, or both.");
      return;
    }
    const plainText = withPlain ? $("note-plain-text").value.trim() : "";
    if (withPlain && !plainText) {
      showFormError(noteError, "Write your notes.");
      return;
    }
    const kept = state.slots.filter(Boolean);
    if (withUploads && !kept.length) {
      showFormError(noteError, "Add at least one file, or uncheck With Uploads.");
      return;
    }

    showFormError(noteError, "");
    noteSave.disabled = true;
    try {
      let note = state.editing;
      if (note) {
        const keptIds = withUploads ? kept.filter((slot) => slot.existing).map((slot) => slot.existing.id) : [];
        const removeIds = note.files.filter((file) => !keptIds.includes(file.id)).map((file) => file.id);
        const data = await api(`/api/notes/${note.id}`, { method: "PUT", body: { title, plain_text: plainText, remove_file_ids: removeIds } });
        note = data.item;
      } else {
        const data = await api("/api/notes", { method: "POST", body: { title, plain_text: plainText } });
        note = data.item;
      }
      upsert("notes", note);
      state.editing = note;

      const newFiles = withUploads ? kept.filter((slot) => slot.file).map((slot) => slot.file) : [];
      if (newFiles.length) {
        const form = new FormData();
        newFiles.forEach((file) => form.append("files", file, file.name));
        const data = await api(`/api/notes/${note.id}/files`, { method: "POST", form });
        note = data.item;
        upsert("notes", note);
        state.editing = note;
      }
      state.editing = null;
      closeModal(noteModal);
      renderAll();
    } catch (error) {
      renderAll();
      showFormError(noteError, error.message);
    } finally {
      noteSave.disabled = false;
    }
  });

  /* ---------- Work diaries ---------- */

  function openDiaryForm(item) {
    state.editing = item || null;
    $("diaryTitle").textContent = item ? "Edit work diary" : "Add a work diary";
    $("diary-name").value = item ? item.title : "";
    $("diary-context").value = item ? item.context : "";
    showFormError(diaryError, "");
    openModal(diaryModal, $("diary-name"));
  }

  diaryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = $("diary-name").value.trim();
    if (!title) {
      showFormError(diaryError, "Enter what this work diary is about.");
      return;
    }
    saveItem("diaries", { title, context: $("diary-context").value.trim() }, diaryError, diarySave, diaryModal);
  });

  async function loadEntries(diaryId) {
    if (state.entries.has(diaryId)) return state.entries.get(diaryId);
    const data = await api(`/api/diaries/${diaryId}/entries`);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.entries.set(diaryId, entries);
    return entries;
  }

  function entryBubble(diary, entry, rerender, errorNode) {
    const bubble = el("div", "b d");
    bubble.appendChild(el("span", "when", fmtStamp(entry.created_at)));
    bubble.appendChild(el("p", "", entry.content));

    const editBox = el("div", "editbox");
    const editArea = el("textarea");
    editArea.rows = 3;
    editArea.maxLength = 20000;
    editArea.value = entry.content;
    editArea.setAttribute("aria-label", "Edit this diary entry");
    const editActs = el("div", "acts");
    const editCancel = el("button", "btn plain", "Cancel");
    editCancel.type = "button";
    const editSave = el("button", "btn save", "Save");
    editSave.type = "button";
    editActs.append(editCancel, editSave);
    editBox.append(editArea, editActs);

    const delBox = el("div", "delbox");
    const delField = el("label", "f", "Type DELETE to confirm");
    const delInput = el("input");
    delInput.type = "text";
    delInput.autocomplete = "off";
    delField.appendChild(delInput);
    const delActs = el("div", "acts");
    const delCancel = el("button", "btn plain", "Cancel");
    delCancel.type = "button";
    const delGo = el("button", "btn dng", "Delete");
    delGo.type = "button";
    delGo.disabled = true;
    delActs.append(delCancel, delGo);
    delBox.append(delField, delActs);

    const foot = el("div", "bfoot");
    const del = el("button", "mini del", "Delete");
    del.type = "button";
    const edit = el("button", "mini ed", "Edit");
    edit.type = "button";
    foot.append(del, edit);
    bubble.append(editBox, delBox, foot);

    edit.addEventListener("click", () => { showFormError(errorNode, ""); bubble.classList.add("editing"); editArea.focus(); });
    editCancel.addEventListener("click", () => { bubble.classList.remove("editing"); editArea.value = entry.content; });
    editSave.addEventListener("click", async () => {
      const content = editArea.value.trim();
      if (!content) { showFormError(errorNode, "A diary entry cannot be empty."); return; }
      editSave.disabled = true;
      try {
        const data = await api(`/api/entries/${entry.id}`, { method: "PUT", body: { content } });
        const list = state.entries.get(diary.id) || [];
        const index = list.findIndex((existing) => existing.id === entry.id);
        if (index !== -1) list[index] = data.item;
        showFormError(errorNode, "");
        rerender();
      } catch (error) {
        showFormError(errorNode, error.message);
        editSave.disabled = false;
      }
    });

    del.addEventListener("click", () => { showFormError(errorNode, ""); bubble.classList.add("deleting"); delInput.value = ""; delGo.disabled = true; delInput.focus(); });
    delCancel.addEventListener("click", () => { bubble.classList.remove("deleting"); });
    delInput.addEventListener("input", () => { delGo.disabled = delInput.value.trim() !== DELETE_PHRASE; });
    delGo.addEventListener("click", async () => {
      if (delInput.value.trim() !== DELETE_PHRASE) return;
      delGo.disabled = true;
      try {
        await api(`/api/entries/${entry.id}`, { method: "DELETE", body: { confirm: DELETE_PHRASE } });
        state.entries.set(diary.id, (state.entries.get(diary.id) || []).filter((existing) => existing.id !== entry.id));
        showFormError(errorNode, "");
        rerender();
      } catch (error) {
        showFormError(errorNode, error.message);
        delGo.disabled = delInput.value.trim() !== DELETE_PHRASE;
      }
    });
    return bubble;
  }

  function composerNode(placeholder) {
    const composer = el("div", "composer");
    const input = el("textarea");
    input.rows = 1;
    input.maxLength = 20000;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    input.addEventListener("input", () => autogrow(input));
    composer.appendChild(input);
    return { composer, input };
  }

  async function openDiaryView(diary) {
    startView("dialog tall");
    viewDialog.append(viewHeader(diary.title, () => { closeModal(viewModal); openDiaryForm(diary); }, () => openDelete("diaries", diary)));
    viewDialog.appendChild(el("p", "sub", `Created ${fmtStamp(diary.created_at)}.`));
    if (diary.context) viewDialog.appendChild(el("div", "ctx", diary.context));

    const chat = el("div", "chat full");
    chat.appendChild(el("p", "sub", "Loading entries..."));
    const errorNode = el("p", "form-error");
    errorNode.setAttribute("role", "alert");
    errorNode.hidden = true;
    const { composer, input } = composerNode("Write a message");
    const saveButton = el("button", "btn save", "Save Diary");
    saveButton.type = "button";
    composer.appendChild(saveButton);
    viewDialog.append(chat, errorNode, composer);
    openModal(viewModal, input);

    const render = () => {
      chat.replaceChildren();
      const entries = state.entries.get(diary.id) || [];
      if (!entries.length) {
        chat.appendChild(el("p", "sub", "No entries yet. Write one below and choose Save Diary."));
        return;
      }
      entries.forEach((entry) => chat.appendChild(entryBubble(diary, entry, render, errorNode)));
    };

    try {
      await loadEntries(diary.id);
      render();
    } catch (error) {
      chat.replaceChildren(el("p", "form-error", error.message));
    }

    const save = async () => {
      const content = input.value.trim();
      if (!content) return;
      saveButton.disabled = true;
      try {
        const data = await api(`/api/diaries/${diary.id}/entries`, { method: "POST", body: { content } });
        const list = state.entries.get(diary.id) || [];
        state.entries.set(diary.id, [data.item, ...list]);
        input.value = "";
        autogrow(input);
        showFormError(errorNode, "");
        render();
      } catch (error) {
        showFormError(errorNode, error.message);
      } finally {
        saveButton.disabled = false;
      }
    };
    saveButton.addEventListener("click", save);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        save();
      }
    });
  }

  /* ---------- Analyses ---------- */

  function fillSelect(select, options, selected, emptyText) {
    select.replaceChildren();
    const wanted = selected === null || selected === undefined ? "" : String(selected);
    let found = false;
    options.forEach(([value, label]) => {
      const option = el("option", "", label);
      option.value = String(value);
      if (option.value === wanted) { option.selected = true; found = true; }
      select.appendChild(option);
    });
    // When editing, keep the original choice even if that item has since been deleted.
    if (wanted && !found) {
      const option = el("option", "", "(original item no longer available)");
      option.value = wanted;
      option.selected = true;
      select.prepend(option);
    }
    if (!select.options.length) {
      const option = el("option", "", emptyText);
      option.value = "";
      select.appendChild(option);
    }
  }

  let previewSequence = 0;
  async function updateDiaryPreview() {
    const sequence = ++previewSequence;
    const timeframe = $("af-timeframe");
    const content = $("af-content");
    const diary = diaryById(Number($("af-diary").value));
    if (!diary) {
      timeframe.value = "";
      content.value = $("af-diary").value ? "The original work diary is no longer available." : "";
      return;
    }
    timeframe.value = "Loading...";
    content.value = "";
    try {
      const entries = await loadEntries(diary.id);
      if (sequence !== previewSequence) return;
      timeframe.value = timeframeOf(entries);
      content.value = diaryContent(diary, entries);
    } catch (error) {
      if (sequence !== previewSequence) return;
      timeframe.value = "";
      content.value = error.message;
    }
  }

  $("af-diary").addEventListener("change", updateDiaryPreview);

  function openAnalysisForm(kind, item) {
    state.editing = item || null;
    state.formKind = kind;
    const diaryKind = kind === "diary" || kind === "experience" || kind === "description";
    $("analysisFormTitle").textContent = item ? EDIT_TITLE[kind] : ADD_TITLE[kind];
    $("afPurposeLabel").textContent = PURPOSE_LABEL[kind];
    $("af-title").value = item ? item.title : "";
    $("af-title").placeholder = diaryKind ? "e.g. Week 2 wins" : "";

    $("afDiaryBlock").hidden = !diaryKind;
    $("afJobBlock").hidden = kind !== "application";
    $("afSourceBlock").hidden = !(kind === "classification" || kind === "application");
    $("afRefBlock").hidden = kind !== "classification";

    fillSelect($("af-template"), state.templates.filter((t) => t.applies_to === kind).map((t) => [t.id, t.title]),
      item ? item.template_id : null, `No ISMCO template applies to ${APPLIES_TO[kind]} yet`);

    if (diaryKind) {
      fillSelect($("af-diary"), state.diaries.map((d) => [d.id, d.title]), item ? item.source_diary_id : null, "No work diaries yet");
      updateDiaryPreview();
    }
    if (kind === "classification" || kind === "application") {
      fillSelect($("af-source"), state.notes.filter((n) => n.files.length).map((n) => [n.id, n.title]),
        item ? item.source_note_id : null, "No notes with uploads yet");
    }
    if (kind === "classification") {
      fillSelect($("af-reference"), state.notes.filter((n) => n.plain_text).map((n) => [n.id, n.title]),
        item ? item.reference_note_id : null, "No plain notes yet");
    }
    if (kind === "application") {
      $("af-jobtitle").value = item ? item.job_title : "";
      $("af-jobdetails").value = item ? item.job_details : "";
      $("af-jobdesc").value = item ? item.job_description : "";
    }

    $("afNote").textContent = item
      ? "Changing the source, template, or job post details runs the analysis again and clears the conversation."
      : "The AI runs when you save, which can take a little while.";
    showFormError(analysisError, "");
    openModal(analysisModal, $("af-title"));
  }

  analysisForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = state.formKind;
    const diaryKind = kind === "diary" || kind === "experience" || kind === "description";
    const title = $("af-title").value.trim();
    const payload = { kind, title, template_id: Number($("af-template").value) || null };

    if (!title) return showFormError(analysisError, "Enter what this analysis is for.");
    if (diaryKind) {
      payload.source_diary_id = Number($("af-diary").value) || null;
      if (!payload.source_diary_id) return showFormError(analysisError, "Choose a Work Diary. Add one in Work Diary first.");
    }
    if (kind === "classification" || kind === "application") {
      payload.source_note_id = Number($("af-source").value) || null;
      if (!payload.source_note_id) return showFormError(analysisError, "Choose a note with uploads. Add one in Notes first.");
    }
    if (kind === "classification") {
      payload.reference_note_id = Number($("af-reference").value) || null;
      if (!payload.reference_note_id) return showFormError(analysisError, "Choose a plain note as the reference. Add one in Notes first.");
    }
    if (kind === "application") {
      payload.job_title = $("af-jobtitle").value.trim();
      payload.job_details = $("af-jobdetails").value.trim();
      payload.job_description = $("af-jobdesc").value.trim();
      if (!payload.job_title) return showFormError(analysisError, "Enter the job post title.");
      if (!payload.job_description) return showFormError(analysisError, "Enter the full job post description.");
    }
    if (!payload.template_id) {
      return showFormError(analysisError, `Choose an ISMCO template. Add one in ISMCO Templates and set Applies to ${APPLIES_TO[kind]}.`);
    }

    showFormError(analysisError, "");
    analysisSave.disabled = true;
    analysisSave.textContent = "Analyzing...";
    try {
      const editing = state.editing;
      const data = editing
        ? await api(`/api/analyses/${editing.id}`, { method: "PUT", body: payload })
        : await api("/api/analyses", { method: "POST", body: payload });
      upsert("analyses", analysisSummary(data.item));
      state.editing = null;
      closeModal(analysisModal);
      renderAll();
      openAnalysisView(analysisSummary(data.item), data.item);
    } catch (error) {
      showFormError(analysisError, error.message);
    } finally {
      analysisSave.disabled = false;
      analysisSave.textContent = "Save";
    }
  });

  function userBubble(message, onDelete) {
    const bubble = el("div", "b u");
    bubble.appendChild(el("p", "", message.content));
    const del = el("button", "mini", "delete");
    del.type = "button";
    del.addEventListener("click", () => onDelete(message));
    bubble.appendChild(del);
    return bubble;
  }

  function assistantBubble(message) {
    const bubble = el("div", "b ai");
    const body = el("div", "rich");
    renderMarkdown(message.content, body);
    bubble.appendChild(body);
    return bubble;
  }

  async function openAnalysisView(summary, preloaded) {
    startView("dialog tall");
    viewDialog.append(viewHeader(summary.title, () => { closeModal(viewModal); openAnalysisForm(summary.kind, summary); }, () => openDelete("analyses", summary)));
    viewDialog.appendChild(el("p", "sub", `Created ${fmtStamp(summary.created_at)}.`));

    const resultSection = el("section", "result");
    resultSection.appendChild(el("h3", "", "Result"));
    const resultBody = el("div", "txt rich", "Loading...");
    resultSection.appendChild(resultBody);

    const convo = el("section", "convo");
    convo.appendChild(el("h3", "", "Conversation"));
    const chat = el("div", "chat");
    convo.appendChild(chat);
    const errorNode = el("p", "form-error");
    errorNode.setAttribute("role", "alert");
    errorNode.hidden = true;
    const { composer, input } = composerNode("Write a message");
    const send = iconButton("i-send", "Send");
    send.classList.add("send");
    composer.appendChild(send);
    viewDialog.append(resultSection, convo, errorNode, composer);
    openModal(viewModal, input);

    let messages = [];
    let busy = false;

    const renderChat = () => {
      chat.replaceChildren();
      messages.forEach((message) => {
        chat.appendChild(message.role === "user" ? userBubble(message, removeMessage) : assistantBubble(message));
      });
      chat.scrollTop = chat.scrollHeight;
    };

    async function removeMessage(message) {
      if (busy) return;
      try {
        await api(`/api/messages/${message.id}`, { method: "DELETE" });
        messages = messages.filter((m) => m.id !== message.id && m.parent_id !== message.id);
        showFormError(errorNode, "");
        renderChat();
      } catch (error) {
        showFormError(errorNode, error.message);
      }
    }

    try {
      const detail = preloaded || (await api(`/api/analyses/${summary.id}`)).item;
      renderMarkdown(detail.result, resultBody);
      messages = Array.isArray(detail.messages) ? detail.messages : [];
      renderChat();
    } catch (error) {
      resultBody.textContent = error.message;
    }

    const sendMessage = async () => {
      const content = input.value.trim();
      if (!content || busy) return;
      busy = true;
      send.disabled = true;
      showFormError(errorNode, "");
      const pending = el("div", "b ai pending", "Thinking...");
      chat.appendChild(pending);
      chat.scrollTop = chat.scrollHeight;
      try {
        const data = await api(`/api/analyses/${summary.id}/messages`, { method: "POST", body: { content } });
        messages = messages.concat(data.messages || []);
        input.value = "";
        autogrow(input);
      } catch (error) {
        showFormError(errorNode, error.message);
      } finally {
        busy = false;
        send.disabled = false;
        renderChat();
      }
    };
    send.addEventListener("click", sendMessage);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  /* ---------- Delete ---------- */

  function openDelete(collection, item) {
    state.deleting = { collection, item };
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
    const target = state.deleting;
    if (!target) return;
    deleteConfirm.disabled = true;
    try {
      await api(`/api/${COLLECTION[target.collection]}/${target.item.id}`, { method: "DELETE", body: { confirm: DELETE_PHRASE } });
      state[target.collection] = state[target.collection].filter((existing) => existing.id !== target.item.id);
      if (target.collection === "diaries") state.entries.delete(target.item.id);
      if (target.collection === "notes") {
        target.item.files.forEach((file) => {
          const url = fileUrls.get(file.id);
          if (url) URL.revokeObjectURL(url);
          fileUrls.delete(file.id);
        });
      }
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

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelectorAll(".js-sidebar-toggle").forEach((button) => {
    button.addEventListener("click", () => setSidebar(appView.classList.contains("sidebar-collapsed")));
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.add;
      if (kind === "ismco") openIsmcoForm(null);
      else if (kind === "notes") openNoteForm(null);
      else if (kind === "workdiary") openDiaryForm(null);
      else if (KINDS.includes(kind)) openAnalysisForm(kind, null);
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
