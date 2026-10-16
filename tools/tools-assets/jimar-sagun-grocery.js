/* Grocery List: IndexedDB offline storage and Cloudflare Worker API integration.
   Configure API_BASE_URL below to the base URL of your Cloudflare Worker.
   The Worker must enforce authentication and authorization on every write request.
*/
(() => {
  "use strict";

  const API_BASE_URL = "https://grocery-list.acct-gladyslacia.workers.dev";
  const API_PATHS = {
    login: "/api/jimar-sagun-auth/login",
    list: "/api/jimar-sagun-grocery-list",
    create: "/api/jimar-sagun-grocery-list",
    update: (id) => `/api/jimar-sagun-grocery-list/${encodeURIComponent(id)}`,
    remove: (id) => `/api/jimar-sagun-grocery-list/${encodeURIComponent(id)}`,
    sync: "/api/jimar-sagun-grocery-list/sync"
  };

  const DB_NAME = "jimar-sagun-groceries";
  const DB_VERSION = 1;
  const STORE_ITEMS = "groceryItems";
  const STORE_META = "metadata";
  const STORE_QUEUE = "pendingChanges";
  const STORE_AUTH = "offlineAuth";
  const CREDENTIAL_KEY = "ownerCredential";
  const PBKDF2_ITERATIONS = 100000;
  const QUAD_LABELS = {
    1: "A. Urgent and Important",
    2: "B. Not Urgent but Important",
    3: "C. Urgent but Not Important",
    4: "D. Not Urgent and Not Important"
  };

  const $ = (id) => document.getElementById(id);
  const connectionStatus = $("connectionStatus");
  const indexedDBStatus = $("indexedDBStatus");
  const accountStatus = $("accountStatus");
  const showLoginButton = $("showLoginButton");
  const logoutButton = $("logoutButton");
  const loginPanel = $("loginPanel");
  const loginForm = $("loginForm");
  const loginIdentifier = $("loginIdentifier");
  const loginPassword = $("loginPassword");
  const loginSubmitButton = $("loginSubmitButton");
  const groceryEditor = $("groceryEditor");
  const addGroceryForm = $("addGroceryForm");
  const newGroceryItem = $("newGroceryItem");
  const newGroceryQuad = $("newGroceryQuad");
  const pageMessage = $("pageMessage");

  let db = null;
  let currentSession = null;
  let lastOnlineCredential = null;
  let isSyncing = false;
  let hasPendingChanges = false;
  let refreshInProgress = false;

  function apiUrl(path) {
    return `${API_BASE_URL.replace(/\/+$/, "")}${path}`;
  }

  function showMessage(message, isError = false) {
    pageMessage.textContent = message;
    pageMessage.hidden = false;
    pageMessage.style.borderLeftColor = isError ? "#C0392B" : "#27834A";
  }

  function clearMessage() {
    pageMessage.textContent = "";
    pageMessage.hidden = true;
  }

  function setStatus(element, className, label) {
    element.className = `status-item ${className}`;
    element.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    element.append(dot, text);
  }

  function updateConnectionStatus() {
    if (navigator.onLine) {
      setStatus(connectionStatus, "status-online", "Online");
    } else {
      setStatus(connectionStatus, "status-offline", "Offline");
    }
  }

  function updateIndexedDBStatus(enabled) {
    setStatus(
      indexedDBStatus,
      enabled ? "status-indexeddb" : "status-disabled",
      enabled ? "IndexedDB enabled" : "IndexedDB disabled"
    );
  }

  function renderAccountStatus() {
    accountStatus.replaceChildren();
    if (currentSession) {
      const loggedIn = document.createElement("span");
      loggedIn.className = "status-logged-in";
      loggedIn.textContent = "Logged In";
      accountStatus.appendChild(loggedIn);

      if (navigator.onLine && !isSyncing && !hasPendingChanges && currentSession.onlineAuthenticated) {
        const synced = document.createElement("span");
        synced.className = "status-synced";
        synced.textContent = "Synced";
        accountStatus.appendChild(synced);
      }
      showLoginButton.hidden = true;
      logoutButton.hidden = false;
      groceryEditor.hidden = false;
    } else {
      showLoginButton.hidden = false;
      logoutButton.hidden = true;
      groceryEditor.hidden = true;
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not supported by this browser."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_ITEMS)) {
          database.createObjectStore(STORE_ITEMS, { keyPath: "rowid" });
        }
        if (!database.objectStoreNames.contains(STORE_META)) {
          database.createObjectStore(STORE_META, { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains(STORE_QUEUE)) {
          database.createObjectStore(STORE_QUEUE, { keyPath: "changeId" });
        }
        if (!database.objectStoreNames.contains(STORE_AUTH)) {
          database.createObjectStore(STORE_AUTH, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another open tab."));
    });
  }

  function transaction(storeNames, mode, callback) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      let result;
      try {
        result = callback(tx);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function storeRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  async function getAllFromStore(storeName) {
    const tx = db.transaction(storeName, "readonly");
    return storeRequest(tx.objectStore(storeName).getAll());
  }

  async function getFromStore(storeName, key) {
    const tx = db.transaction(storeName, "readonly");
    return storeRequest(tx.objectStore(storeName).get(key));
  }

  async function putInStore(storeName, value) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save local data."));
      tx.onabort = () => reject(tx.error || new Error("Local save was aborted."));
    });
  }

  async function deleteFromStore(storeName, key) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not delete local data."));
      tx.onabort = () => reject(tx.error || new Error("Local delete was aborted."));
    });
  }

  async function clearStore(storeName) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not clear local data."));
      tx.onabort = () => reject(tx.error || new Error("Local clear was aborted."));
    });
  }

  function makeChangeId() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function queueChange(action, item) {
    if (!currentSession) {
      throw new Error("Log in before editing the grocery list.");
    }
    const change = {
      changeId: makeChangeId(),
      action,
      rowid: item.rowid,
      grocery_item: item.grocery_item,
      quad_number: item.quad_number,
      check_mark: item.check_mark,
      queuedAt: new Date().toISOString()
    };
    await putInStore(STORE_QUEUE, change);
    hasPendingChanges = true;
    renderAccountStatus();
  }

  function normalizeItem(item) {
    const rowid = Number(item.rowid);
    const quad = Number(item.quad_number);
    const checkMark = Number(item.check_mark);
    if (!Number.isFinite(rowid) || ![1, 2, 3, 4].includes(quad)) {
      throw new Error("The server returned a grocery item with invalid rowid or quad_number.");
    }
    return {
      rowid,
      grocery_item: String(item.grocery_item ?? ""),
      quad_number: quad,
      check_mark: checkMark === 0 ? 0 : 1
    };
  }

  function renderItems(items) {
    const grouped = { 1: [], 2: [], 3: [], 4: [] };
    items.forEach((item) => {
      const normalized = normalizeItem(item);
      grouped[normalized.quad_number].push(normalized);
    });

    Object.keys(grouped).forEach((quad) => {
      const container = document.querySelector(`[data-items-for="${quad}"]`);
      container.replaceChildren();

      if (!grouped[quad].length) {
        const empty = document.createElement("p");
        empty.className = "grocery-empty";
        empty.textContent = "No items in this category.";
        container.appendChild(empty);
        return;
      }

      grouped[quad].forEach((item) => {
        const row = document.createElement("div");
        row.className = `grocery-item${item.check_mark === 0 ? " is-checked" : ""}`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.check_mark === 0;
        checkbox.disabled = !currentSession;
        checkbox.setAttribute("aria-label", `Mark ${item.grocery_item} as ${checkbox.checked ? "not purchased" : "purchased"}`);
        checkbox.addEventListener("change", async () => {
          const updated = { ...item, check_mark: checkbox.checked ? 0 : 1 };
          try {
            await putInStore(STORE_ITEMS, updated);
            await queueChange("upsert", updated);
            renderLocalItems();
            if (navigator.onLine && currentSession.onlineAuthenticated) {
              await syncPendingChanges();
            } else {
              showMessage("Saved locally. It will sync after you reconnect and authenticate online.");
            }
          } catch (error) {
            showMessage(error.message || "Could not save the checkbox change.", true);
          }
        });

        const label = document.createElement("span");
        label.className = "grocery-item-text";
        label.textContent = item.grocery_item;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.disabled = !currentSession;
        deleteButton.setAttribute("aria-label", `Delete ${item.grocery_item}`);
        deleteButton.addEventListener("click", async () => {
          if (!currentSession) return;
          try {
            await deleteFromStore(STORE_ITEMS, item.rowid);
            await queueChange("delete", item);
            renderLocalItems();
            if (navigator.onLine && currentSession.onlineAuthenticated) {
              await syncPendingChanges();
            } else {
              showMessage("Deletion saved locally. It will sync after you reconnect and authenticate online.");
            }
          } catch (error) {
            showMessage(error.message || "Could not delete the grocery item.", true);
          }
        });

        row.append(checkbox, label, deleteButton);
        container.appendChild(row);
      });
    });
  }

  async function renderLocalItems() {
    if (!db) return;
    const items = await getAllFromStore(STORE_ITEMS);
    renderItems(items);
  }

  async function apiRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (currentSession && currentSession.token) {
      headers.set("Authorization", `Bearer ${currentSession.token}`);
    }

    const response = await fetch(apiUrl(path), {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit"
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = data && typeof data === "object" && data.error
        ? data.error
        : `Request failed (${response.status}).`;
      throw new Error(message);
    }
    return data;
  }

  async function cacheOfflineCredential(identifier, password, serverUser) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      passwordKey,
      256
    );
    const credential = {
      key: CREDENTIAL_KEY,
      identifier: String(serverUser.username || identifier).trim().toLowerCase(),
      email: String(serverUser.email || "").trim().toLowerCase(),
      salt: Array.from(salt),
      verifier: Array.from(new Uint8Array(bits)),
      iterations: PBKDF2_ITERATIONS,
      savedAt: new Date().toISOString()
    };
    await putInStore(STORE_AUTH, credential);
  }

  function constantTimeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
    return result === 0;
  }

  async function verifyOfflineCredential(identifier, password) {
    const credential = await getFromStore(STORE_AUTH, CREDENTIAL_KEY);
    if (!credential) {
      throw new Error("This browser has no saved offline login record. Connect to the internet and log in first.");
    }

    const normalized = identifier.trim().toLowerCase();
    if (normalized !== credential.identifier && normalized !== credential.email) {
      throw new Error("The username or email does not match the saved account.");
    }

    const passwordKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(credential.salt),
        iterations: credential.iterations,
        hash: "SHA-256"
      },
      passwordKey,
      256
    );
    if (!constantTimeEqual(new Uint8Array(bits), new Uint8Array(credential.verifier))) {
      throw new Error("Incorrect username/email or password.");
    }
    return credential;
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearMessage();
    loginSubmitButton.disabled = true;

    const identifier = loginIdentifier.value.trim();
    const password = loginPassword.value;
    if (!identifier || !password) {
      showMessage("Enter your username or email and password.", true);
      loginSubmitButton.disabled = false;
      return;
    }

    try {
      if (navigator.onLine) {
        const result = await apiRequest(API_PATHS.login, {
          method: "POST",
          body: { identifier, password }
        });
        if (!result || !result.token || !result.user) {
          throw new Error("The Worker login response must include token and user details.");
        }

        currentSession = {
          token: result.token,
          username: result.user.username || identifier,
          email: result.user.email || "",
          onlineAuthenticated: true
        };
        lastOnlineCredential = { identifier, password };
        await cacheOfflineCredential(identifier, password, result.user);
        loginPassword.value = "";
        loginPanel.hidden = true;
        renderAccountStatus();
        await refreshFromServer();
        showMessage("You are logged in. Your list is ready.");
        await syncPendingChanges();
      } else {
        const credential = await verifyOfflineCredential(identifier, password);
        currentSession = {
          token: null,
          username: credential.identifier,
          email: credential.email,
          onlineAuthenticated: false
        };
        loginPassword.value = "";
        loginPanel.hidden = true;
        renderAccountStatus();
        await renderLocalItems();
        showMessage("Logged in offline. Changes will stay on this device until you reconnect and log in online to sync.");
      }
    } catch (error) {
      currentSession = null;
      renderAccountStatus();
      showMessage(error.message || "Login failed.", true);
    } finally {
      loginSubmitButton.disabled = false;
    }
  }

  async function refreshFromServer() {
    if (!navigator.onLine || !currentSession || !currentSession.onlineAuthenticated || refreshInProgress) return;
    refreshInProgress = true;
    try {
      const result = await apiRequest(API_PATHS.list, { method: "GET" });
      const serverItems = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(serverItems)) throw new Error("The Worker list response must be an array or contain an items array.");

      const queue = await getAllFromStore(STORE_QUEUE);
      if (queue.length === 0) {
        await clearStore(STORE_ITEMS);
        for (const rawItem of serverItems) {
          await putInStore(STORE_ITEMS, normalizeItem(rawItem));
        }
        await renderLocalItems();
      }
    } catch (error) {
      showMessage(`Could not refresh the server list: ${error.message}`, true);
    } finally {
      refreshInProgress = false;
    }
  }

  async function addItem(event) {
    event.preventDefault();
    clearMessage();
    if (!currentSession) {
      showMessage("Log in before adding grocery items.", true);
      return;
    }

    const groceryItem = newGroceryItem.value.trim();
    const quadNumber = Number(newGroceryQuad.value);
    if (!groceryItem) return;
    if (![1, 2, 3, 4].includes(quadNumber)) {
      showMessage("Choose one of the four grocery categories.", true);
      return;
    }

    try {
      // Use a negative numeric ID for a new local-only item. D1 rowid values are positive integers.
      const tempId = -Date.now() - Math.floor(Math.random() * 100000);
      const item = {
        rowid: tempId,
        grocery_item: groceryItem,
        quad_number: quadNumber,
        check_mark: 1
      };
      await putInStore(STORE_ITEMS, item);
      await queueChange("create", item);
      newGroceryItem.value = "";
      await renderLocalItems();

      if (navigator.onLine && currentSession.onlineAuthenticated) {
        await syncPendingChanges();
      } else {
        showMessage("Added locally. The item will sync after you reconnect and authenticate online.");
      }
    } catch (error) {
      showMessage(error.message || "Could not add the grocery item.", true);
    }
  }

  async function syncPendingChanges() {
    if (isSyncing || !navigator.onLine || !currentSession || !currentSession.onlineAuthenticated || !currentSession.token) return;
    const pending = (await getAllFromStore(STORE_QUEUE)).sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
    if (pending.length === 0) {
      hasPendingChanges = false;
      renderAccountStatus();
      return;
    }

    hasPendingChanges = true;
    isSyncing = true;
    renderAccountStatus();
    try {
      // The Worker must validate the active token and authorize the single owner account.
      // A successful response means every supplied change has been committed to D1.
      const result = await apiRequest(API_PATHS.sync, {
        method: "POST",
        body: { changes: pending }
      });

      if (!result || result.success !== true) {
        throw new Error("The Worker did not confirm that all changes were saved.");
      }

      // Only clear offline data after the Worker confirms the sync has committed.
      await clearStore(STORE_QUEUE);
      hasPendingChanges = false;
      await refreshServerAfterSync();
      showMessage("Synced. Offline changes have been saved to the database.");
    } catch (error) {
      hasPendingChanges = true;
      showMessage(`Sync is waiting: ${error.message}. Local changes have been kept.`, true);
    } finally {
      isSyncing = false;
      renderAccountStatus();
    }
  }

  async function refreshServerAfterSync() {
    const result = await apiRequest(API_PATHS.list, { method: "GET" });
    const serverItems = Array.isArray(result) ? result : result.items;
    if (!Array.isArray(serverItems)) throw new Error("The Worker list response must contain the current items.");

    await clearStore(STORE_ITEMS);
    for (const rawItem of serverItems) {
      await putInStore(STORE_ITEMS, normalizeItem(rawItem));
    }
    await renderLocalItems();
  }

  async function handleLogout() {
    currentSession = null;
    lastOnlineCredential = null;
    loginPanel.hidden = true;
    loginPassword.value = "";
    renderAccountStatus();
    await renderLocalItems();
    showMessage("Logged out. The list is read-only. Pending offline changes remain on this device until you log in online again.");
  }

  async function handleConnectionRestored() {
    updateConnectionStatus();
    renderAccountStatus();
    if (!navigator.onLine) return;

    // An offline session is not allowed to sync. The owner must re-enter the
    // username/email and password so the Worker can authenticate the account.
    if (currentSession && !currentSession.onlineAuthenticated) {
      loginPanel.hidden = false;
      showMessage("You are back online. Log in again with your username/email and password to verify your account and sync pending changes.");
      return;
    }
    if (currentSession && currentSession.onlineAuthenticated) {
      await refreshFromServer();
      await syncPendingChanges();
    } else {
      // Public visitors can see the latest server list when online.
      await loadPublicList();
    }
  }

  async function loadPublicList() {
    if (!navigator.onLine || !db) return;
    try {
      const result = await apiRequest(API_PATHS.list, { method: "GET" });
      const serverItems = Array.isArray(result) ? result : result.items;
      if (!Array.isArray(serverItems)) throw new Error("The Worker list response must be an array or contain an items array.");

      const pending = await getAllFromStore(STORE_QUEUE);
      if (pending.length === 0) {
        await clearStore(STORE_ITEMS);
        for (const rawItem of serverItems) {
          await putInStore(STORE_ITEMS, normalizeItem(rawItem));
        }
      }
      await renderLocalItems();
    } catch (error) {
      // The cached list remains visible if the network or Worker is unavailable.
      await renderLocalItems();
      if (navigator.onLine) showMessage(`Showing the saved list. Server refresh failed: ${error.message}`, true);
    }
  }

  async function initialize() {
    updateConnectionStatus();
    showLoginButton.addEventListener("click", () => {
      loginPanel.hidden = !loginPanel.hidden;
      if (!loginPanel.hidden) loginIdentifier.focus();
    });
    logoutButton.addEventListener("click", handleLogout);
    loginForm.addEventListener("submit", handleLogin);
    addGroceryForm.addEventListener("submit", addItem);
    window.addEventListener("online", handleConnectionRestored);
    window.addEventListener("offline", () => {
      updateConnectionStatus();
      renderAccountStatus();
      showMessage("You are offline. The saved grocery list remains available.");
    });

    try {
      if (!("indexedDB" in window) || !window.isSecureContext) {
        throw new Error("IndexedDB requires browser support and a secure context such as HTTPS or localhost.");
      }
      db = await openDatabase();
      updateIndexedDBStatus(true);
      hasPendingChanges = (await getAllFromStore(STORE_QUEUE)).length > 0;
      await renderLocalItems();
      await loadPublicList();
    } catch (error) {
      updateIndexedDBStatus(false);
      showMessage(`IndexedDB is unavailable: ${error.message}`, true);
      document.querySelectorAll(".grocery-item input, .grocery-item button").forEach((control) => {
        control.disabled = true;
      });
    }

    renderAccountStatus();
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
