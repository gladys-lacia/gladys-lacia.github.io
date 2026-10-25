/* Prompts tool API: Cloudflare Worker + Cloudflare D1 (free tiers).

   It's already been resolved: 
   There is NO registration endpoint. You create each account directly in the database.
   Every data request needs a valid login token, and every query is filtered by the user id
   inside that token, so one user can never read or change another user's prompts.

   ------------------------------------------------------------------------------------
   1. D1 TABLES (run each statement once in the D1 console or with `wrangler d1 execute`)
   ------------------------------------------------------------------------------------

   CREATE TABLE IF NOT EXISTS user_prompts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     email TEXT UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     is_active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   );

   CREATE TABLE IF NOT EXISTS "multi-user-prompts-tool" (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES user_prompts(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('ismco','other','note')),
     title TEXT NOT NULL DEFAULT '',
     intent TEXT NOT NULL DEFAULT '',
     scope TEXT NOT NULL DEFAULT '',
     method TEXT NOT NULL DEFAULT '',
     constraints_text TEXT NOT NULL DEFAULT '',
     output_text TEXT NOT NULL DEFAULT '',
     body TEXT NOT NULL DEFAULT '',
     template_id INTEGER REFERENCES "multi-user-prompts-tool"(id) ON DELETE SET NULL,
     input_text TEXT NOT NULL DEFAULT '',
     plain_notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
     updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   );

   CREATE INDEX IF NOT EXISTS idx_prompts_items_user
     ON "multi-user-prompts-tool" (user_id, kind, id DESC);

   CREATE TABLE IF NOT EXISTS prompts_login_failures (
     key TEXT PRIMARY KEY,
     fails INTEGER NOT NULL,
     window_start INTEGER NOT NULL
   );

   ------------------------------------------------------------------------------------
   2. SETTINGS (wrangler.toml, or Workers dashboard > Settings)
   ------------------------------------------------------------------------------------

   name = "multi-user-prompts-tool"
   main = "prompts-worker.js"
   compatibility_date = "2026-10-01"

   [[d1_databases]]
   binding = "DB"                       # must be exactly DB
   database_name = "gladys-lacia-github-io"
   database_id = "c158a644-5858-4835-938e-06ba65c039f5"

   [vars]
   ALLOWED_ORIGINS = "https://gladys-lacia.github.io"

   Secret (never put this in a file or in GitHub). Use a long random value, for example the
   output of `openssl rand -base64 48`:
     npx wrangler secret put TOKEN_SECRET

   Deploy:
     npx wrangler deploy

   ------------------------------------------------------------------------------------
   3. CREATING AN ACCOUNT (you do this yourself; there is no sign-up page)
   ------------------------------------------------------------------------------------

   a) Make a password hash. Open the console of any https page in your browser and run this
      with the real password in place of CHANGE-ME:

      (async () => {
        const password = "CHANGE-ME";
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
        const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
        console.log(`pbkdf2$100000$${b64(salt)}$${b64(bits)}`);
      })();

   b) Insert the user with the printed value:

      INSERT INTO user_prompts (username, email, password_hash)
      VALUES ('gladyslacia', 'you@example.com', 'pbkdf2$100000$...$...');

   To block someone without deleting their data:
      UPDATE user_prompts SET is_active = 0 WHERE username = 'someone';
   To change a password, make a new hash (step a) and UPDATE password_hash.
   If the free plan ever reports "exceeded CPU" on login, create hashes with a lower
   iterations number (for example 50000); the number is stored inside each hash.
*/

const USERS_TABLE = "user_prompts";
const ITEMS_TABLE = "multi-user-prompts-tool";
const FAILS_TABLE = "prompts_login_failures";

const DEFAULT_ORIGIN = "https://gladys-lacia.github.io";

const TOKEN_TTL = 12 * 60 * 60;          // a token is valid for 12 hours
const TOKEN_REFRESH_AFTER = 30 * 60;     // active users get a fresh token every 30 minutes
const MAX_LOGIN_FAILS = 5;               // failed logins allowed ...
const LOGIN_WINDOW = 15 * 60;            // ... per 15 minutes for the same IP and username

const TITLE_MAX = 200;
const FIELD_MAX = 20000;
const MAX_BODY = 200000;
const MAX_ITEMS_PER_USER = 500;
const KINDS = ["ismco", "other", "note"];

const enc = new TextEncoder();
const dec = new TextDecoder();

// Used so a wrong username takes as long to reject as a wrong password.
const DUMMY_HASH = `pbkdf2$100000$${"A".repeat(22)}==$${"A".repeat(43)}=`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Small helpers ---------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function withHeaders(response, extra) {
  const copy = new Response(response.body, response);
  Object.entries(extra).forEach(([name, value]) => copy.headers.set(name, value));
  return copy;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGIN)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeadersFor(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Expose-Headers": "X-Refreshed-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Send the request as JSON.");
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "That request is too large.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request was not valid JSON.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "The request was not valid JSON.");
  }
  return data;
}

function bytesToB64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function b64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const toB64Url = (bytes) => bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64Url(text) {
  let value = text.replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  return b64ToBytes(value);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------- Passwords ---------- */

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 100000) return false;
  let salt;
  let expected;
  try {
    salt = b64ToBytes(parts[2]);
    expected = b64ToBytes(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// Put them right after verifyPassword in the “Passwords” section:
async function hashPassword(password) {
  const iterations = 100000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

function isHashed(stored) {
  return String(stored || "").startsWith("pbkdf2$");
}

// Only used for old rows that still hold a plain-text password.
// Comparing SHA-256 digests keeps the comparison constant-time and equal-length.
async function verifyLegacyPlaintext(password, stored) {
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(password)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(stored))));
  return timingSafeEqual(a, b);
}

/* ---------- Login tokens (HMAC-signed, expire on their own) ---------- */

async function hmacKey(env) {
  if (!env.TOKEN_SECRET || String(env.TOKEN_SECRET).length < 32) {
    throw new Error("TOKEN_SECRET is missing or shorter than 32 characters.");
  }
  return crypto.subtle.importKey("raw", enc.encode(env.TOKEN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signToken(env, user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { uid: user.id, usr: user.username, iat: now, exp: now + TOKEN_TTL };
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(body));
  return `${body}.${toB64Url(new Uint8Array(signature))}`;
}

async function verifyToken(env, token) {
  const key = await hmacKey(env);
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", key, fromB64Url(parts[1]), enc.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(fromB64Url(parts[0])));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(payload.uid) || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/* Checks the token, then confirms the account still exists and is active in D1. */
async function authenticate(request, env) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) return null;
  const payload = await verifyToken(env, match[1]);
  if (!payload) return null;
  const user = await env.DB
    .prepare(`SELECT id, username FROM "${USERS_TABLE}" WHERE id = ?1 AND is_active = 1`)
    .bind(payload.uid)
    .first();
  if (!user) return null;
  const now = Math.floor(Date.now() / 1000);
  const refreshedToken = now - payload.iat > TOKEN_REFRESH_AFTER ? await signToken(env, user) : null;
  return { user, refreshedToken };
}

/* ---------- Login ---------- */

async function handleLogin(request, env) {
  const body = await readJson(request);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password || identifier.length > 254 || password.length > 1024) {
    throw new HttpError(400, "Enter your username or email and your password.");
  }

  const now = Math.floor(Date.now() / 1000);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const throttleKey = `${ip}|${identifier.toLowerCase()}`;

  const failure = await env.DB
    .prepare(`SELECT fails, window_start FROM "${FAILS_TABLE}" WHERE key = ?1`)
    .bind(throttleKey)
    .first();
  if (failure && now - failure.window_start < LOGIN_WINDOW && failure.fails >= MAX_LOGIN_FAILS) {
    const wait = LOGIN_WINDOW - (now - failure.window_start);
    return json(
      { error: "Too many failed log-in attempts. Wait a few minutes and try again." },
      429,
      { "Retry-After": String(wait) }
    );
  }

  const user = await env.DB
    .prepare(`SELECT id, username, password_hash, is_active FROM "${USERS_TABLE}" WHERE username = ?1 OR email = ?1 LIMIT 1`)
    .bind(identifier)
    .first();

  const stored = user ? user.password_hash : DUMMY_HASH;
  let passwordOk;
  let needsUpgrade = false;
  if (user && !isHashed(stored)) {
    passwordOk = await verifyLegacyPlaintext(password, stored);
    needsUpgrade = passwordOk;
  } else {
    passwordOk = await verifyPassword(password, stored);
  }
  /* const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH); */
  if (!user || !passwordOk || user.is_active !== 1) {
    await env.DB
      .prepare(
        `INSERT INTO "${FAILS_TABLE}" (key, fails, window_start) VALUES (?1, 1, ?2)
         ON CONFLICT(key) DO UPDATE SET
           fails = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE fails + 1 END,
           window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`
      )
      .bind(throttleKey, now, LOGIN_WINDOW)
      .run();
    await env.DB.prepare(`DELETE FROM "${FAILS_TABLE}" WHERE window_start < ?1`).bind(now - LOGIN_WINDOW).run();
    return json({ error: "Incorrect username/email or password." }, 401);
  }

  await env.DB.prepare(`DELETE FROM "${FAILS_TABLE}" WHERE key = ?1`).bind(throttleKey).run();
  // Add this directly below it, before const token = ...:
  if (needsUpgrade) {
    const newHash = await hashPassword(password);
    await env.DB
      .prepare(`UPDATE "${USERS_TABLE}" SET password_hash = ?1 WHERE id = ?2 AND password_hash = ?3`)
      .bind(newHash, user.id, user.password_hash)
      .run();
  }
  // 
  const token = await signToken(env, user);
  return json({ token, user: { username: user.username } });
}

/* ---------- Items ---------- */

function publicItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    intent: row.intent,
    scope: row.scope,
    method: row.method,
    constraints: row.constraints_text,
    output: row.output_text,
    body: row.body,
    template_id: row.template_id,
    input_text: row.input_text,
    plain_notes: row.plain_notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function readText(input, key, label, max) {
  const value = input[key];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `${label} is too long (maximum ${max} characters).`);
  return trimmed;
}

async function buildValues(env, userId, kind, input) {
  const values = {
    title: "", intent: "", scope: "", method: "", constraints_text: "", output_text: "",
    body: "", template_id: null, input_text: "", plain_notes: ""
  };

  if (kind === "ismco") {
    values.title = readText(input, "title", "Template name", TITLE_MAX);
    if (!values.title) throw new HttpError(400, "Enter a template name.");
    values.intent = readText(input, "intent", "INTENT", FIELD_MAX);
    values.scope = readText(input, "scope", "SCOPE", FIELD_MAX);
    values.method = readText(input, "method", "METHOD", FIELD_MAX);
    values.constraints_text = readText(input, "constraints", "CONSTRAINTS", FIELD_MAX);
    values.output_text = readText(input, "output", "OUTPUT", FIELD_MAX);
  } else if (kind === "other") {
    values.body = readText(input, "body", "Template", FIELD_MAX);
    if (!values.body) throw new HttpError(400, "Enter the template text.");
  } else {
    values.title = readText(input, "title", "Note title", TITLE_MAX);
    if (!values.title) throw new HttpError(400, "Enter what this note is about.");
    values.plain_notes = readText(input, "plain_notes", "Notes", FIELD_MAX);

    const templateId = input.template_id;
    if (templateId !== null && templateId !== undefined) {
      if (!Number.isInteger(templateId) || templateId <= 0) throw new HttpError(400, "Choose a valid ISMCO template.");
      // The template must belong to this same user.
      const template = await env.DB
        .prepare(`SELECT id FROM "${ITEMS_TABLE}" WHERE id = ?1 AND user_id = ?2 AND kind = 'ismco'`)
        .bind(templateId, userId)
        .first();
      if (!template) throw new HttpError(400, "That ISMCO template was not found.");
      values.template_id = templateId;
      values.input_text = readText(input, "input_text", "INPUT", FIELD_MAX);
      if (!values.input_text) throw new HttpError(400, "Enter the INPUT for the ISMCO template.");
    }
    if (!values.template_id && !values.plain_notes) {
      throw new HttpError(400, "Add an ISMCO template with INPUT, plain notes, or both.");
    }
  }
  return values;
}

async function listItems(env, user) {
  const { results } = await env.DB
    .prepare(`SELECT * FROM "${ITEMS_TABLE}" WHERE user_id = ?1 ORDER BY id DESC`)
    .bind(user.id)
    .all();
  return json({ items: results.map(publicItem) });
}

async function createItem(request, env, user) {
  const input = await readJson(request);
  if (!KINDS.includes(input.kind)) throw new HttpError(400, "Unknown item type.");

  const count = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM "${ITEMS_TABLE}" WHERE user_id = ?1`)
    .bind(user.id)
    .first();
  if (count.n >= MAX_ITEMS_PER_USER) {
    throw new HttpError(403, `You have reached the limit of ${MAX_ITEMS_PER_USER} saved items. Delete some first.`);
  }

  const v = await buildValues(env, user.id, input.kind, input);
  const row = await env.DB
    .prepare(
      `INSERT INTO "${ITEMS_TABLE}"
         (user_id, kind, title, intent, scope, method, constraints_text, output_text, body, template_id, input_text, plain_notes)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       RETURNING *`
    )
    .bind(user.id, input.kind, v.title, v.intent, v.scope, v.method, v.constraints_text, v.output_text, v.body, v.template_id, v.input_text, v.plain_notes)
    .first();
  return json({ item: publicItem(row) }, 201);
}

async function updateItem(request, env, user, id) {
  const existing = await env.DB
    .prepare(`SELECT id, kind FROM "${ITEMS_TABLE}" WHERE id = ?1 AND user_id = ?2`)
    .bind(id, user.id)
    .first();
  if (!existing) throw new HttpError(404, "That item was not found.");

  const input = await readJson(request);
  const v = await buildValues(env, user.id, existing.kind, input);
  const row = await env.DB
    .prepare(
      `UPDATE "${ITEMS_TABLE}" SET
         title = ?1, intent = ?2, scope = ?3, method = ?4, constraints_text = ?5, output_text = ?6,
         body = ?7, template_id = ?8, input_text = ?9, plain_notes = ?10,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?11 AND user_id = ?12
       RETURNING *`
    )
    .bind(v.title, v.intent, v.scope, v.method, v.constraints_text, v.output_text, v.body, v.template_id, v.input_text, v.plain_notes, id, user.id)
    .first();
  return json({ item: publicItem(row) });
}

async function deleteItem(request, env, user, id) {
  const input = await readJson(request);
  if (input.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");

  const existing = await env.DB
    .prepare(`SELECT id, kind FROM "${ITEMS_TABLE}" WHERE id = ?1 AND user_id = ?2`)
    .bind(id, user.id)
    .first();
  if (!existing) throw new HttpError(404, "That item was not found.");

  if (existing.kind === "ismco") {
    const used = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM "${ITEMS_TABLE}" WHERE template_id = ?1 AND user_id = ?2`)
      .bind(id, user.id)
      .first();
    if (used.n > 0) {
      throw new HttpError(409, `This template is used by ${used.n} note${used.n === 1 ? "" : "s"}. Delete or edit those notes first.`);
    }
  }

  await env.DB.prepare(`DELETE FROM "${ITEMS_TABLE}" WHERE id = ?1 AND user_id = ?2`).bind(id, user.id).run();
  return json({ success: true });
}

/* ---------- Routing ---------- */

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (path === "/api/auth/login") {
    if (method !== "POST") throw new HttpError(405, "Use POST to log in.");
    return handleLogin(request, env);
  }
  if (!path.startsWith("/api/")) throw new HttpError(404, "Not found.");

  const auth = await authenticate(request, env);
  if (!auth) return json({ error: "Your session expired. Log in again." }, 401);

  let response;
  const itemMatch = /^\/api\/items\/(\d+)$/.exec(path);
  if (path === "/api/items") {
    if (method === "GET") response = await listItems(env, auth.user);
    else if (method === "POST") response = await createItem(request, env, auth.user);
    else throw new HttpError(405, "Method not allowed.");
  } else if (itemMatch) {
    const id = Number(itemMatch[1]);
    if (method === "PUT") response = await updateItem(request, env, auth.user, id);
    else if (method === "DELETE") response = await deleteItem(request, env, auth.user, id);
    else throw new HttpError(405, "Method not allowed.");
  } else {
    throw new HttpError(404, "Not found.");
  }

  return auth.refreshedToken ? withHeaders(response, { "X-Refreshed-Token": auth.refreshedToken }) : response;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = origin && allowedOrigins(env).includes(origin) ? corsHeadersFor(origin) : null;

    // Browsers from any other website are refused.
    if (origin && !cors) return withHeaders(json({ error: "Origin not allowed." }, 403), SECURITY_HEADERS);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...(cors || {}) } });
    }

    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status);
      } else {
        console.error(error);
        response = json({ error: "Something went wrong on the server. Try again." }, 500);
      }
    }
    return withHeaders(response, { ...SECURITY_HEADERS, ...(cors || {}) });
  }
};
