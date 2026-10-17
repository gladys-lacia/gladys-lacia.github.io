/**
 * Cloudflare Worker for the Grocery List project.
 *
 * Required bindings/secrets:
 *   D1 binding: DB
 *   Secret: AUTH_SECRET (a long random value; never put it in browser JavaScript)
 *   Variable: ALLOWED_ORIGIN = https://gladys-lacia.github.io
 *
 * The public GET /api/grocery-list endpoint is read-only.
 * Every write endpoint requires a valid signed bearer token.
 *
 * Password format:
 *   New/updated password hashes: pbkdf2$310000$<salt-hex>$<hash-hex>
 *   Legacy plaintext values are accepted once and upgraded after successful login.
 *   This legacy compatibility exists only to migrate an existing table; do not add
 *   or keep plaintext passwords in D1.
 */

const PBKDF2_ITERATIONS = 100000;
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const ALLOWED_DEFAULT_ORIGIN = "https://gladys-lacia.github.io";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || ALLOWED_DEFAULT_ORIGIN)
    .split(",").map(value => value.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) throw new Error("Invalid hexadecimal value.");
  return Uint8Array.from(value.match(/.{2}/g) || [], pair => parseInt(pair, 16));
}

async function derivePasswordHash(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePasswordHash(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(digest)}`;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function verifyPassword(password, storedValue) {
  const stored = String(storedValue || "");
  const parts = stored.split("$");
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return { valid: false, legacy: false };
    try {
      const expected = fromHex(parts[3]);
      const actual = await derivePasswordHash(password, fromHex(parts[2]), iterations);
      return { valid: constantTimeEqual(actual, expected), legacy: false };
    } catch {
      return { valid: false, legacy: false };
    }
  }

  // Compatibility migration for a pre-existing plaintext user_password value.
  // Successful login immediately replaces it with a PBKDF2 hash.
  return { valid: stored.length > 0 && stored === password, legacy: true };
}

async function signToken(payload, secret) {
  const header = b64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(utf8(JSON.stringify(payload)));
  const unsigned = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(unsigned)));
  return `${unsigned}.${b64url(signature)}`;
}

async function verifyToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireOwner(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = await verifyToken(match[1], env.AUTH_SECRET);
  if (!payload || payload.role !== "owner") return null;
  return payload;
}

async function getOwnerByIdentifier(db, identifier) {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  return db.prepare(`
    SELECT first_name, last_name, user_name, user_email, user_password
    FROM "jimarsagun-user-grocery-list"
    WHERE lower(user_name) = ? OR lower(user_email) = ?
    LIMIT 1
  `).bind(normalized, normalized).first();
}

function publicUser(user) {
  return {
    firstName: String(user.first_name || ""),
    lastName: String(user.last_name || ""),
    username: String(user.user_name || ""),
    email: String(user.user_email || "")
  };
}

function validateItem(item) {
  const groceryItem = typeof item?.grocery_item === "string" ? item.grocery_item.trim() : "";
  const quad = Number(item?.quad_number);
  const checkMark = Number(item?.check_mark);
  if (!groceryItem || groceryItem.length > 300) throw new Error("Grocery item must contain 1 to 300 characters.");
  if (![1, 2, 3, 4].includes(quad)) throw new Error("quad_number must be 1, 2, 3, or 4.");
  if (![0, 1].includes(checkMark)) throw new Error("check_mark must be 0 or 1.");
  return { grocery_item: groceryItem, quad_number: quad, check_mark: checkMark };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function handleLogin(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    return json({ error: "Worker secret AUTH_SECRET is missing or too short. Set a random secret of at least 32 characters." }, 500);
  }

  const body = await readJson(request);
  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");
  if (!identifier || !password) return json({ error: "Enter your username/email and password." }, 400);

  const user = await getOwnerByIdentifier(env.DB, identifier);
  if (!user) return json({ error: "Incorrect username/email or password." }, 401);

  const verification = await verifyPassword(password, user.user_password);
  if (!verification.valid) return json({ error: "Incorrect username/email or password." }, 401);

  if (verification.legacy) {
    const upgraded = await makePasswordRecord(password);
    await env.DB.prepare(`
      UPDATE "jimarsagun-user-grocery-list" SET user_password = ?
      WHERE user_name = ? AND user_email = ?
    `).bind(upgraded, user.user_name, user.user_email).run();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({
    sub: String(user.user_name || user.user_email),
    role: "owner",
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS
  }, env.AUTH_SECRET);

  return json({ token, user: publicUser(user), expiresAt: now + TOKEN_LIFETIME_SECONDS });
}

async function handleGetList(env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  const result = await env.DB.prepare(`
    SELECT rowid, grocery_item, quad_number, check_mark
    FROM "jimarsagun-grocery-list"
    ORDER BY quad_number ASC, rowid ASC
  `).all();
  return json({ items: result.results || [] });
}

async function newServerRowid(db) {
  // Random positive 52-bit integer; check for an existing row before using it.
  for (let attempt = 0; attempt < 8; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    let value = 0;
    for (const byte of bytes) value = value * 256 + byte;
    const candidate = (value % 4000000000000000) + 1;
    const exists = await db.prepare(`SELECT rowid FROM "jimarsagun-grocery-list" WHERE rowid = ?`).bind(candidate).first();
    if (!exists) return candidate;
  }
  throw new Error("Could not allocate a unique grocery item ID. Please retry.");
}

async function applySyncChange(db, change) {
  const changeId = String(change.changeId || "");
  const action = String(change.action || "");
  const clientRowid = Number(change.rowid);
  if (!changeId || changeId.length > 100) throw new Error("Each change must include a valid changeId.");
  if (!["create", "upsert", "delete"].includes(action)) throw new Error("Unsupported grocery change action.");

  // Idempotency: if this change ID was committed before, return its previous result.
  const prior = await db.prepare(`
    SELECT change_id, client_rowid, server_rowid, action
    FROM jimarsagun_grocery_sync_changes WHERE change_id = ?
  `).bind(changeId).first();
  if (prior) return { changeId, rowid: Number(prior.server_rowid), skipped: true };

  let serverRowid = clientRowid;
  if (action === "create") {
    const item = validateItem(change);
    serverRowid = await newServerRowid(db);
    await db.prepare(`
      INSERT INTO "jimarsagun-grocery-list" (rowid, grocery_item, quad_number, check_mark)
      VALUES (?, ?, ?, ?)
    `).bind(serverRowid, item.grocery_item, item.quad_number, item.check_mark).run();
  } else {
    if (!Number.isSafeInteger(clientRowid) || clientRowid === 0) throw new Error("Invalid rowid in queued change.");
    // New items use a negative temporary rowid in the browser. The create record
    // stores its permanent ID so later checkbox/delete changes can find it.
    if (clientRowid < 0) {
      const mapping = await db.prepare(`
        SELECT server_rowid FROM jimarsagun_grocery_sync_changes
        WHERE client_rowid = ? AND action = 'create'
        ORDER BY created_at ASC LIMIT 1
      `).bind(clientRowid).first();
      if (!mapping) throw new Error(`Could not find the server ID for local item ${clientRowid}. Retry syncing from the device where it was created.`);
      serverRowid = Number(mapping.server_rowid);
    }
    if (action === "upsert") {
      const item = validateItem(change);
      const update = await db.prepare(`
        UPDATE "jimarsagun-grocery-list"
        SET grocery_item = ?, quad_number = ?, check_mark = ?
        WHERE rowid = ?
      `).bind(item.grocery_item, item.quad_number, item.check_mark, serverRowid).run();
      if (!update.meta?.changes) throw new Error(`Grocery item ${serverRowid} no longer exists in D1.`);
    } else {
      await db.prepare(`DELETE FROM "jimarsagun-grocery-list" WHERE rowid = ?`).bind(serverRowid).run();
    }
  }

  await db.prepare(`
    INSERT INTO jimarsagun_grocery_sync_changes (change_id, client_rowid, server_rowid, action, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(changeId, clientRowid, serverRowid, action, new Date().toISOString()).run();

  return { changeId, rowid: serverRowid, skipped: false };
}

async function handleSync(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);
  const owner = await requireOwner(request, env);
  if (!owner) return json({ error: "Your login has expired or is invalid. Log in online again." }, 401);

  const body = await readJson(request);
  if (!Array.isArray(body.changes) || body.changes.length > 500) {
    return json({ error: "The sync request must contain an array of no more than 500 changes." }, 400);
  }

  const results = [];
  try {
    // Changes are processed in chronological order by the browser. The change ledger
    // makes retries idempotent after a successful ledger write.
    for (const change of body.changes) results.push(await applySyncChange(env.DB, change));
  } catch (error) {
    return json({
      success: false,
      error: `Sync stopped after ${results.length} change(s): ${error.message}`,
      processed: results.length
    }, 409);
  }
  return json({ success: true, processed: results.length, results });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    let response;

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        response = json({ ok: true, service: "grocery-list-worker" });
      } else if (url.pathname === "/api/auth/login" && request.method === "POST") {
        response = await handleLogin(request, env);
      } else if (url.pathname === "/api/grocery-list" && request.method === "GET") {
        response = await handleGetList(env);
      } else if (url.pathname === "/api/grocery-list/sync" && request.method === "POST") {
        response = await handleSync(request, env);
      } else if (url.pathname.startsWith("/api/grocery-list/") && ["PUT", "DELETE"].includes(request.method)) {
        const owner = await requireOwner(request, env);
        if (!owner) response = json({ error: "Your login has expired or is invalid. Log in online again." }, 401);
        else response = json({ error: "Use POST /api/grocery-list/sync for grocery-list changes." }, 405);
      } else {
        response = json({ error: "Not found." }, 404);
      }
    } catch (error) {
      response = json({ error: error?.message || "Unexpected server error." }, 500);
    }

    return withCors(response, cors);
  }
};
