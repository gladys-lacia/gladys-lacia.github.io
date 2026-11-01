/* Image to Text tool: login, tabs (separate conversations), photo upload to R2,
   text extraction with Gemini, and deletion.
   Set API_BASE_URL to the base URL of your image2text Cloudflare Worker. */
(() => {
  "use strict";

  const API_BASE_URL = "https://image2text-html.acct-gladyslacia.workers.dev";
  const MAX_PHOTOS = 5;
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;   // must match the Worker
  const RESIZE_ABOVE_BYTES = 2.5 * 1024 * 1024; // bigger photos are shrunk before upload
  const MAX_EDGE = 2560;
  const CONFIRM_PHRASE = "DELETE";
  const TEXT_DELETED = "The photos shown here have already been deleted from R2 Object Storage.";
  const TEXT_EXTRACTED = "The text in the photos shown here has already been extracted, and these photos have been deleted from R2 Object Storage.";

  const $ = (id) => document.getElementById(id);
  const loginView = $("loginView");
  const loginForm = $("loginForm");
  const loginIdentifier = $("loginIdentifier");
  const loginPassword = $("loginPassword");
  const loginSubmit = $("loginSubmit");
  const loginError = $("loginError");
  const appView = $("appView");
  const sidebarCollapse = $("sidebarCollapse");
  const addTabButton = $("addTabButton");
  const addTabPopover = $("add-tab");
  const addTabForm = $("addTabForm");
  const addTabTitle = $("addTabTitle");
  const addTabError = $("addTabError");
  const addTabSubmit = $("addTabSubmit");
  const tabList = $("tabList");
  const logoutButton = $("logoutButton");
  const userLabel = $("userLabel");
  const convTitle = $("convTitle");
  const deleteTabButton = $("deleteTabButton");
  const pageError = $("pageError");
  const messagesEl = $("messages");
  const composer = $("composer");
  const slotsEl = $("slots");
  const uploadHint = $("uploadHint");
  const uploadButton = $("uploadButton");
  const fileInput = $("fileInput");
  const deleteTabModal = $("delete-tab");
  const deleteTabForm = $("deleteTabForm");
  const deleteTabPhrase = $("deleteTabPhrase");
  const deleteTabError = $("deleteTabError");
  const deleteTabConfirm = $("deleteTabConfirm");
  const deleteMessageModal = $("delete-message");
  const deleteMessageForm = $("deleteMessageForm");
  const deleteMessagePhrase = $("deleteMessagePhrase");
  const deleteMessageError = $("deleteMessageError");
  const deleteMessageConfirm = $("deleteMessageConfirm");
  const viewerModal = $("photo-viewer");
  const viewerPhoto = $("viewerPhoto");
  const viewerName = $("viewerName");

  const state = {
    token: localStorage.getItem("image2textToken"),
    user: localStorage.getItem("image2textUser") || "",
    tabs: [],
    messages: {},        // tabId -> messages
    slots: {},           // tabId -> photos waiting in the upload field
    activeId: null,
    pending: null,       // upload in progress
    extracting: null,    // extraction in progress
    busy: false,
    adding: false,
    deleteTarget: null,
    photoUrls: {},       // photoId -> object URL
    photoLoads: {}       // photoId -> loading promise
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

  function showFieldError(node, message) {
    node.textContent = message || "";
    node.hidden = !message;
  }

  /* ---------- API ---------- */

  function captureToken(refreshed) {
    if (refreshed && state.token) {
      state.token = refreshed;
      localStorage.setItem("image2textToken", refreshed);
    }
  }

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const allHeaders = { Accept: "application/json", ...headers };
    if (state.token) allHeaders.Authorization = `Bearer ${state.token}`;

    let response;
    try {
      response = await fetch(`${API_BASE_URL.replace(/\/+$/, "")}${path}`, {
        method,
        headers: allHeaders,
        body,
        cache: "no-store",
        credentials: "omit"
      });
    } catch {
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    captureToken(response.headers.get("X-Refreshed-Token"));
    if (response.status === 401 && path !== "/api/auth/login") {
      signOut("Your session expired. Log in again.");
      throw new Error("Your session expired. Log in again.");
    }
    return response;
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = {};
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await request(path, { method, body: payload, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  // Upload with progress events so the estimated time can be shown.
  function uploadWithProgress(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL.replace(/\/+$/, "")}${path}`);
      xhr.setRequestHeader("Accept", "application/json");
      if (state.token) xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
      xhr.onerror = () => reject(new Error("Could not reach the server. Check your connection and try again."));
      xhr.onload = () => {
        captureToken(xhr.getResponseHeader("X-Refreshed-Token"));
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
        if (xhr.status === 401) {
          signOut("Your session expired. Log in again.");
          reject(new Error("Your session expired. Log in again."));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || `Upload failed (${xhr.status}).`));
          return;
        }
        resolve(data);
      };
      xhr.send(formData);
    });
  }

  /* ---------- Photo URLs (photos need the login token, so they load as blobs) ---------- */

  function loadPhoto(id) {
    if (state.photoUrls[id]) return Promise.resolve(state.photoUrls[id]);
    if (!state.photoLoads[id]) {
      state.photoLoads[id] = request(`/api/photos/${id}`, { headers: { Accept: "image/jpeg" } })
        .then((response) => {
          if (!response.ok) throw new Error("Photo could not be loaded.");
          return response.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          state.photoUrls[id] = url;
          return url;
        })
        .finally(() => { delete state.photoLoads[id]; });
    }
    return state.photoLoads[id];
  }

  function paintPhoto(node, url) {
    node.style.backgroundImage = `url("${url}")`;
    node.classList.add("has-photo");
  }

  function applyPhoto(node, photoId) {
    if (state.photoUrls[photoId]) {
      paintPhoto(node, state.photoUrls[photoId]);
      return;
    }
    loadPhoto(photoId).then((url) => paintPhoto(node, url)).catch(() => {});
  }

  function releasePhotos(message) {
    (message.photos || []).forEach((photo) => {
      const url = state.photoUrls[photo.id];
      if (url) URL.revokeObjectURL(url);
      delete state.photoUrls[photo.id];
    });
  }

  /* ---------- Views ---------- */

  function showLogin(message) {
    appView.hidden = true;
    loginView.hidden = false;
    showFieldError(loginError, message);
    loginPassword.value = "";
    loginIdentifier.focus();
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    userLabel.textContent = state.user;
    if (isNarrow()) sidebarCollapse.checked = false;
  }

  function signOut(message) {
    Object.values(state.photoUrls).forEach((url) => URL.revokeObjectURL(url));
    Object.values(state.slots).forEach((list) => list.forEach((slot) => URL.revokeObjectURL(slot.url)));
    state.token = null;
    state.user = "";
    state.tabs = [];
    state.messages = {};
    state.slots = {};
    state.activeId = null;
    state.pending = null;
    state.extracting = null;
    state.busy = false;
    state.photoUrls = {};
    state.photoLoads = {};
    localStorage.removeItem("image2textToken");
    localStorage.removeItem("image2textUser");
    localStorage.removeItem("image2textActiveTab");
    messagesEl.replaceChildren();
    tabList.replaceChildren();
    slotsEl.replaceChildren();
    convTitle.textContent = "";
    closeAddTab();
    document.querySelectorAll(".modal.is-open").forEach(closeModal);
    showError("");
    showLogin(message);
  }

  function closeSidebarOnNarrow() {
    if (isNarrow()) sidebarCollapse.checked = false;
  }

  /* ---------- Pop-ups ---------- */

  function openModal(modal) {
    modal.classList.add("is-open");
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
  }

  function openAddTab() {
    addTabTitle.value = "";
    showFieldError(addTabError, "");
    addTabPopover.hidden = false;
    addTabButton.setAttribute("aria-expanded", "true");
    addTabTitle.focus();
  }

  function closeAddTab() {
    addTabPopover.hidden = true;
    addTabButton.setAttribute("aria-expanded", "false");
  }

  /* ---------- Rendering ---------- */

  const activeTab = () => state.tabs.find((tab) => tab.id === state.activeId);
  const slotsFor = (id) => (id == null ? [] : (state.slots[id] ||= []));

  function renderTabs() {
    tabList.replaceChildren();
    state.tabs.forEach((tab) => {
      const button = el("button", "tab-item");
      button.type = "button";
      if (tab.id === state.activeId) button.setAttribute("aria-current", "true");
      button.append(el("span", "tab-title", tab.title));
      button.addEventListener("click", () => {
        setActive(tab.id);
        closeSidebarOnNarrow();
      });
      tabList.appendChild(button);
    });
  }

  function renderHeader() {
    const tab = activeTab();
    convTitle.textContent = tab ? tab.title : "";
    deleteTabButton.disabled = !tab;
  }

  function renderSlots() {
    const tab = activeTab();
    const slots = slotsFor(state.activeId);
    slotsEl.replaceChildren();
    for (let i = 0; i < MAX_PHOTOS; i++) {
      const slot = slots[i];
      if (slot) {
        const box = el("div", "slot slot-filled ph has-photo");
        box.title = slot.name;
        box.style.backgroundImage = `url("${slot.url}")`;
        box.appendChild(el("span", "slot-name", slot.name));
        const remove = el("button", "slot-remove", "\u00d7");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove photo ${i + 1}`);
        remove.disabled = state.busy;
        remove.addEventListener("click", () => removeSlot(i));
        box.appendChild(remove);
        slotsEl.appendChild(box);
      } else {
        const button = el("button", "slot slot-empty", "+");
        button.type = "button";
        button.setAttribute("aria-label", `Add photo ${i + 1}`);
        button.disabled = !tab || state.busy || state.adding;
        button.addEventListener("click", () => fileInput.click());
        slotsEl.appendChild(button);
      }
    }
    uploadHint.textContent = `${slots.length} of ${MAX_PHOTOS} photos added`;
    uploadButton.disabled = !tab || !slots.length || state.busy || state.adding;
  }

  function removedNode(text) {
    const wrap = el("div", "msg msg-user msg-removed");
    wrap.appendChild(el("p", "", text));
    return wrap;
  }

  function assistantNode(message) {
    const wrap = el("article", "msg msg-assistant");
    const head = el("div", "msg-head");
    head.appendChild(el("span", "msg-label", "Extracted text"));
    const copy = el("button", "text-btn", "Copy");
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
    head.appendChild(copy);
    wrap.appendChild(head);
    wrap.appendChild(el("div", "msg-body", message.content));
    return wrap;
  }

  function userNode(message) {
    if (message.status === "deleted") return removedNode(TEXT_DELETED);
    if (message.status === "extracted") return removedNode(TEXT_EXTRACTED);

    const wrap = el("article", "msg msg-user");
    const extractingThis = state.extracting && state.extracting.id === message.id;

    const head = el("div", "msg-head msg-head-end");
    const extract = el("button", "text-btn", extractingThis
      ? `Extracting ${Math.min(state.extracting.done + 1, state.extracting.total)} of ${state.extracting.total}...`
      : "Extract");
    extract.type = "button";
    extract.disabled = state.busy;
    extract.addEventListener("click", () => extractMessage(message));
    head.appendChild(extract);
    wrap.appendChild(head);

    const photos = el("div", "msg-photos");
    message.photos.forEach((photo, index) => {
      const thumb = el("button", "thumb ph");
      thumb.type = "button";
      thumb.setAttribute("aria-label", `View photo ${index + 1}`);
      applyPhoto(thumb, photo.id);
      thumb.addEventListener("click", () => openViewer(photo));
      photos.appendChild(thumb);
    });
    wrap.appendChild(photos);

    const foot = el("div", "msg-foot");
    const remove = el("button", "text-btn", "Delete");
    remove.type = "button";
    remove.disabled = state.busy;
    remove.addEventListener("click", () => openDeleteMessage(message));
    foot.append(remove, el("span", "msg-status", "Uploaded"));
    wrap.appendChild(foot);
    return wrap;
  }

  function pendingNode(pending) {
    const wrap = el("article", "msg msg-user msg-pending");
    const photos = el("div", "msg-photos");
    pending.items.forEach((item) => {
      const thumb = el("span", "thumb ph has-photo");
      thumb.style.backgroundImage = `url("${item.url}")`;
      photos.appendChild(thumb);
    });
    wrap.appendChild(photos);
    const foot = el("div", "msg-foot msg-foot-end");
    pending.statusEl = el("span", "msg-status", pending.text);
    foot.appendChild(pending.statusEl);
    wrap.appendChild(foot);
    return wrap;
  }

  function renderMessages() {
    messagesEl.replaceChildren();
    if (!activeTab()) {
      messagesEl.appendChild(el("p", "empty", "Click the + button in the sidebar to add a tab and get started."));
      return;
    }
    const list = state.messages[state.activeId];
    const pending = state.pending && state.pending.tabId === state.activeId ? state.pending : null;
    if (!list) {
      messagesEl.appendChild(el("p", "empty", "Loading conversation..."));
      return;
    }
    if (!list.length && !pending) {
      messagesEl.appendChild(el("p", "empty", "Add up to 5 JPG photos below, then click Upload."));
      return;
    }
    list.forEach((message) => {
      messagesEl.appendChild(message.role === "assistant" ? assistantNode(message) : userNode(message));
    });
    if (pending) messagesEl.appendChild(pendingNode(pending));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderAll() {
    renderTabs();
    renderHeader();
    renderSlots();
    renderMessages();
  }

  /* ---------- Tabs ---------- */

  async function setActive(id) {
    state.activeId = id;
    if (id != null) localStorage.setItem("image2textActiveTab", String(id));
    showError("");
    renderAll();
    if (id == null || state.messages[id]) return;
    try {
      const data = await api(`/api/tabs/${id}/messages`);
      state.messages[id] = data.messages;
    } catch (error) {
      showError(error.message);
      return;
    }
    if (state.activeId === id) renderMessages();
  }

  async function loadAll() {
    try {
      const data = await api("/api/tabs");
      state.tabs = data.tabs;
    } catch (error) {
      showError(error.message);
      return;
    }
    if (!state.tabs.length) {
      await setActive(null);
      return;
    }
    const saved = Number(localStorage.getItem("image2textActiveTab"));
    await setActive(state.tabs.some((tab) => tab.id === saved) ? saved : state.tabs[0].id);
  }

  async function addTab(event) {
    event.preventDefault();
    const title = addTabTitle.value.trim();
    if (!title) {
      showFieldError(addTabError, "Type what this tab is for.");
      return;
    }
    addTabSubmit.disabled = true;
    try {
      const data = await api("/api/tabs", { method: "POST", body: { title } });
      state.tabs.unshift(data.tab);
      state.messages[data.tab.id] = [];
      closeAddTab();
      await setActive(data.tab.id);
      closeSidebarOnNarrow();
    } catch (error) {
      showFieldError(addTabError, error.message);
    } finally {
      addTabSubmit.disabled = false;
    }
  }

  function openDeleteTab() {
    if (!activeTab()) return;
    if (state.busy) {
      showError("Wait for the current upload or extraction to finish first.");
      return;
    }
    deleteTabPhrase.value = "";
    deleteTabConfirm.disabled = true;
    showFieldError(deleteTabError, "");
    openModal(deleteTabModal);
    deleteTabPhrase.focus();
  }

  async function deleteTab(event) {
    event.preventDefault();
    if (deleteTabPhrase.value.trim() !== CONFIRM_PHRASE) return;
    const tab = activeTab();
    if (!tab) return;
    deleteTabConfirm.disabled = true;
    try {
      await api(`/api/tabs/${tab.id}`, { method: "DELETE", body: { confirm: CONFIRM_PHRASE } });
    } catch (error) {
      showFieldError(deleteTabError, error.message);
      deleteTabConfirm.disabled = deleteTabPhrase.value.trim() !== CONFIRM_PHRASE;
      return;
    }
    (state.messages[tab.id] || []).forEach(releasePhotos);
    slotsFor(tab.id).forEach((slot) => URL.revokeObjectURL(slot.url));
    delete state.slots[tab.id];
    delete state.messages[tab.id];
    state.tabs = state.tabs.filter((item) => item.id !== tab.id);
    closeModal(deleteTabModal);
    await setActive(state.tabs.length ? state.tabs[0].id : null);
  }

  /* ---------- Photo upload field ---------- */

  async function isJpeg(file) {
    if (!/\.jpe?g$/i.test(file.name)) return false;
    if (file.type && file.type !== "image/jpeg") return false;
    try {
      const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    } catch {
      return false;
    }
  }

  // Large phone photos are shrunk to keep uploads fast. The result is still a JPEG.
  async function prepareJpeg(file) {
    if (file.size <= RESIZE_ABOVE_BYTES) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      return blob && blob.size < file.size ? blob : file;
    } catch {
      return file;
    }
  }

  async function addFiles(fileList) {
    const tab = activeTab();
    if (!tab || state.adding || state.busy) return;
    const slots = slotsFor(tab.id);
    const room = MAX_PHOTOS - slots.length;
    const files = Array.from(fileList);
    if (!files.length) return;
    if (!room) {
      showError(`You can only add ${MAX_PHOTOS} photos at a time.`);
      return;
    }

    state.adding = true;
    renderSlots();
    showError("");
    const problems = [];
    try {
      const accepted = [];
      for (const file of files) {
        if (accepted.length >= room) {
          problems.push(`Only ${MAX_PHOTOS} photos are allowed, so the extra photos were skipped.`);
          break;
        }
        if (!(await isJpeg(file))) {
          problems.push(`"${file.name}" was skipped because only JPG or JPEG photos are accepted.`);
          continue;
        }
        const prepared = await prepareJpeg(file);
        if (prepared.size > MAX_PHOTO_BYTES) {
          problems.push(`"${file.name}" was skipped because it is larger than 10 MB.`);
          continue;
        }
        accepted.push(prepared);
      }
      if (accepted.length) {
        const data = await api("/api/filenames", {
          method: "POST",
          body: { count: accepted.length, used: slots.map((slot) => slot.name) }
        });
        accepted.forEach((blob, index) => {
          slots.push({ name: data.names[index], blob, url: URL.createObjectURL(blob), size: blob.size });
        });
      }
    } catch (error) {
      problems.push(error.message);
    } finally {
      state.adding = false;
      renderSlots();
      if (problems.length) showError(problems.join(" "));
    }
  }

  function removeSlot(index) {
    const slots = slotsFor(state.activeId);
    const [removed] = slots.splice(index, 1);
    if (removed) URL.revokeObjectURL(removed.url);
    renderSlots();
  }

  function estimateText(seconds) {
    const s = Math.max(1, Math.ceil(seconds));
    if (s < 60) return `Estimated upload time: about ${s} second${s === 1 ? "" : "s"}`;
    const m = Math.ceil(s / 60);
    return `Estimated upload time: about ${m} minute${m === 1 ? "" : "s"}`;
  }

  async function upload(event) {
    event.preventDefault();
    const tab = activeTab();
    if (!tab || state.busy || state.adding) return;
    const items = slotsFor(tab.id).slice();
    if (!items.length) return;

    const tabId = tab.id;
    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    const startedAt = performance.now();
    state.busy = true;
    state.pending = { tabId, items, text: estimateText(totalBytes / (1024 * 1024)), statusEl: null };
    state.slots[tabId] = [];
    showError("");
    renderAll();

    const formData = new FormData();
    items.forEach((item) => formData.append("photos", new File([item.blob], `${item.name}.jpg`, { type: "image/jpeg" })));

    try {
      const data = await uploadWithProgress(`/api/tabs/${tabId}/upload`, formData, (loaded, total) => {
        const elapsed = (performance.now() - startedAt) / 1000;
        if (!state.pending || loaded <= 0 || elapsed < 0.3) return;
        const remaining = (total - loaded) / (loaded / elapsed);
        state.pending.text = estimateText(remaining);
        if (state.pending.statusEl) state.pending.statusEl.textContent = state.pending.text;
      });
      data.message.photos.forEach((photo) => {
        const item = items.find((entry) => entry.name === photo.name);
        if (item) state.photoUrls[photo.id] = item.url;
      });
      (state.messages[tabId] ||= []).push(data.message);
    } catch (error) {
      if (state.token) {
        state.slots[tabId] = items;
        showError(error.message);
      }
    } finally {
      state.pending = null;
      state.busy = false;
      if (state.token) renderAll();
    }
  }

  /* ---------- Photo viewer ---------- */

  function openViewer(photo) {
    viewerPhoto.style.backgroundImage = "";
    viewerPhoto.classList.remove("has-photo");
    viewerName.textContent = photo.name;
    applyPhoto(viewerPhoto, photo.id);
    openModal(viewerModal);
  }

  /* ---------- Extract ---------- */

  async function extractMessage(message) {
    if (state.busy) return;
    const tabId = state.activeId;
    state.busy = true;
    state.extracting = { id: message.id, done: 0, total: message.photos.length };
    showError("");
    renderAll();
    try {
      for (;;) {
        const data = await api(`/api/messages/${message.id}/extract-next`, { method: "POST" });
        if (data.assistant) {
          (state.messages[tabId] ||= []).push(data.assistant);
          state.extracting.done += 1;
        }
        if (data.done) {
          releasePhotos(message);
          message.status = "extracted";
          message.photos = [];
          break;
        }
        renderMessages();
      }
    } catch (error) {
      if (state.token) showError(`${error.message} Click Extract to continue with the remaining photos.`);
    } finally {
      state.extracting = null;
      state.busy = false;
      if (state.token) renderAll();
    }
  }

  /* ---------- Delete photos in a message ---------- */

  function openDeleteMessage(message) {
    if (state.busy) return;
    state.deleteTarget = message;
    deleteMessagePhrase.value = "";
    deleteMessageConfirm.disabled = true;
    showFieldError(deleteMessageError, "");
    openModal(deleteMessageModal);
    deleteMessagePhrase.focus();
  }

  async function deleteMessage(event) {
    event.preventDefault();
    const message = state.deleteTarget;
    if (!message || deleteMessagePhrase.value.trim() !== CONFIRM_PHRASE) return;
    deleteMessageConfirm.disabled = true;
    try {
      await api(`/api/messages/${message.id}`, { method: "DELETE", body: { confirm: CONFIRM_PHRASE } });
    } catch (error) {
      showFieldError(deleteMessageError, error.message);
      deleteMessageConfirm.disabled = deleteMessagePhrase.value.trim() !== CONFIRM_PHRASE;
      return;
    }
    releasePhotos(message);
    message.status = "deleted";
    message.photos = [];
    state.deleteTarget = null;
    closeModal(deleteMessageModal);
    renderMessages();
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
      localStorage.setItem("image2textToken", state.token);
      localStorage.setItem("image2textUser", state.user);
      loginPassword.value = "";
      showApp();
      await loadAll();
    } catch (error) {
      showFieldError(loginError, error.message);
    } finally {
      loginSubmit.disabled = false;
    }
  }

  /* ---------- Events ---------- */

  loginForm.addEventListener("submit", handleLogin);
  logoutButton.addEventListener("click", () => signOut(""));

  addTabButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (addTabPopover.hidden) openAddTab();
    else closeAddTab();
  });
  addTabForm.addEventListener("submit", addTab);

  deleteTabButton.addEventListener("click", openDeleteTab);
  deleteTabPhrase.addEventListener("input", () => {
    deleteTabConfirm.disabled = deleteTabPhrase.value.trim() !== CONFIRM_PHRASE;
  });
  deleteTabForm.addEventListener("submit", deleteTab);

  deleteMessagePhrase.addEventListener("input", () => {
    deleteMessageConfirm.disabled = deleteMessagePhrase.value.trim() !== CONFIRM_PHRASE;
  });
  deleteMessageForm.addEventListener("submit", deleteMessage);

  document.querySelectorAll(".modal [data-close]").forEach((node) => {
    node.addEventListener("click", () => closeModal(node.closest(".modal")));
  });

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    addFiles(files);
  });
  composer.addEventListener("submit", upload);

  document.addEventListener("click", (event) => {
    if (!addTabPopover.hidden && !addTabPopover.contains(event.target) && !addTabButton.contains(event.target)) closeAddTab();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAddTab();
    document.querySelectorAll(".modal.is-open").forEach(closeModal);
  });

  /* ---------- Start ---------- */

  if (state.token) {
    showApp();
    loadAll();
  } else {
    showLogin("");
  }
})();
