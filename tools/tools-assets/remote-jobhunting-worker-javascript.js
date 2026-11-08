/**
 * Cloudflare Worker for the Remote Job Hunting tool.
 *
 * Bindings / secrets (Cloudflare dashboard):
 *   D1 binding:  DB
 *   R2 binding:  BUCKET
 *   Secret:      AUTH_SECRET     (random, at least 32 characters)
 *   Secret:      GEMINI_API_KEY  (from Google AI Studio)
 *   Variable:    ALLOWED_ORIGIN = https://gladys-lacia.github.io
 *
 * IMPORTANT: Do not commit this file to the public GitHub repository.
 * It contains your private username and password. Deploy it from the Cloudflare dashboard.
 * Keep AUTH_SECRET and GEMINI_API_KEY as Worker secrets; never paste them into this file.
 *
 * D1 tables (run once in the D1 console, one statement at a time if the console asks for that):
 *
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-templates" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, title TEXT NOT NULL,
 *     intent TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '',
 *     constraints TEXT NOT NULL DEFAULT '', output TEXT NOT NULL DEFAULT '', applies_to TEXT NOT NULL,
 *     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-notes" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, title TEXT NOT NULL,
 *     plain_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-files" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, note_id INTEGER NOT NULL, user_name TEXT NOT NULL,
 *     name TEXT NOT NULL, r2_key TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL,
 *     created_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-diaries" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, title TEXT NOT NULL,
 *     context TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-entries" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, diary_id INTEGER NOT NULL, user_name TEXT NOT NULL,
 *     content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-analyses" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
 *     template_id INTEGER, source_diary_id INTEGER, source_note_id INTEGER, reference_note_id INTEGER,
 *     source_label TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '',
 *     job_details TEXT NOT NULL DEFAULT '', job_description TEXT NOT NULL DEFAULT '',
 *     prompt_text TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "remote-jobhunting-tool-messages" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, analysis_id INTEGER NOT NULL, user_name TEXT NOT NULL,
 *     role TEXT NOT NULL, content TEXT NOT NULL, parent_id INTEGER, created_at TEXT NOT NULL);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_templates_user ON "remote-jobhunting-tool-templates" (user_name);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_notes_user ON "remote-jobhunting-tool-notes" (user_name);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_files_note ON "remote-jobhunting-tool-files" (note_id);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_diaries_user ON "remote-jobhunting-tool-diaries" (user_name);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_entries_diary ON "remote-jobhunting-tool-entries" (diary_id);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_analyses_user ON "remote-jobhunting-tool-analyses" (user_name, kind);
 *   CREATE INDEX IF NOT EXISTS idx_rjh_messages_analysis ON "remote-jobhunting-tool-messages" (analysis_id);
 */

const GEMINI_MODEL = "gemini-3.5-flash-lite";

// Only this account can use the tool.
const USERNAME = "gladyslacia";
const PASSWORD = "gl10997";

const TABLES = {
  templates: "remote-jobhunting-tool-templates",
  notes: "remote-jobhunting-tool-notes",
  files: "remote-jobhunting-tool-files",
  diaries: "remote-jobhunting-tool-diaries",
  entries: "remote-jobhunting-tool-entries",
  analyses: "remote-jobhunting-tool-analyses",
  messages: "remote-jobhunting-tool-messages"
};
const tb = (key) => `"${TABLES[key]}"`;

const R2_PREFIX = "remote-jobhunting-html";
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const ALLOWED_DEFAULT_ORIGIN = "https://gladys-lacia.github.io";
const KINDS = ["diary", "experience", "description", "classification", "application"];
const DIARY_KINDS = ["diary", "experience", "description"];
const ISMCO_KEYS = ["intent", "scope", "method", "constraints", "output"];
const MAX_FILES = 5;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_AI_FILE_BYTES = 14 * 1024 * 1024; // Gemini accepts about 20 MB per request, and base64 adds a third
const MAX_TITLE_CHARACTERS = 200;
const MAX_TEXT_CHARACTERS = 20000;
const MAX_JOB_DESCRIPTION_CHARACTERS = 30000;
const FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain"
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || ALLOWED_DEFAULT_ORIGIN).split(",").map((v) => v.trim()).filter(Boolean);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "X-Refreshed-Token",
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

/* ---------- Crypto helpers ---------- */

const utf8 = (value) => new TextEncoder().encode(value);

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(value)));
}

// Comparing hashes keeps the comparison time the same whatever the input length.
async function safeEqual(a, b) {
  return constantTimeEqual(await sha256(a), await sha256(b));
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function signToken(payload, secret) {
  const unsigned = `${b64url(utf8(JSON.stringify({ alg: "HS256", typ: "JWT" })))}.${b64url(utf8(JSON.stringify(payload)))}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), utf8(unsigned)));
  return `${unsigned}.${b64url(signature)}`;
}

async function verifyToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64url(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireUser(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = await verifyToken(match[1], env.AUTH_SECRET);
  return payload && payload.role === "user" && payload.sub === USERNAME ? payload.sub : null;
}

/* ---------- Helpers ---------- */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function requireConfirm(request) {
  const body = await readJson(request);
  if (body.confirm !== "DELETE") throw new HttpError(400, "Type DELETE to confirm.");
}

const pad = (n) => String(n).padStart(2, "0");
const now = () => new Date().toISOString();

// Times shown to the AI are in UTC+8, the same as in the page.
function plus8(iso) {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
}
function dateText(iso) {
  const d = plus8(iso);
  return `${d.getUTCFullYear()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function stampText(iso) {
  const d = plus8(iso);
  const hour = d.getUTCHours() % 12 || 12;
  return `${dateText(iso)} at ${hour}:${pad(d.getUTCMinutes())} ${d.getUTCHours() >= 12 ? "pm" : "am"} UTC+8`;
}
function timeframeText(entries) {
  if (!entries.length) return "No entries yet";
  const times = entries.map((e) => new Date(e.created_at).getTime());
  const first = dateText(new Date(Math.min(...times)).toISOString());
  const last = dateText(new Date(Math.max(...times)).toISOString());
  return first === last ? first : `${first} to ${last}`;
}

// Example: 2026-01jan-13-0742am-utc-0342pm-utc8  (UTC date, UTC time, then UTC+8 time)
function fileBaseName(date) {
  const clock = (d) => {
    const hour = d.getUTCHours();
    return `${pad(hour % 12 || 12)}${pad(d.getUTCMinutes())}${hour >= 12 ? "pm" : "am"}`;
  };
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}${MONTHS[date.getUTCMonth()]}-${pad(date.getUTCDate())}-${clock(date)}-utc-${clock(shifted)}-utc8`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function cleanTitle(value, message) {
  const title = String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARACTERS);
  if (!title) throw new HttpError(400, message);
  return title;
}

function cleanText(value, label, max = MAX_TEXT_CHARACTERS, required = false) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (required && !text) throw new HttpError(400, `${label} is required.`);
  if (text.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}

function idOrNull(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const first = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const run = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).run();
async function all(env, sql, ...binds) {
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return result.results || [];
}

async function requireRow(env, key, id, user) {
  const row = await first(env, `SELECT * FROM ${tb(key)} WHERE id = ? AND user_name = ?`, id, user);
  if (!row) throw new HttpError(404, "That item was not found.");
  return row;
}

async function deleteR2Keys(env, keys) {
  for (let i = 0; i < keys.length; i += 500) await env.BUCKET.delete(keys.slice(i, i + 500));
}

/* ---------- Gemini ---------- */

function ismcoPrompt(template, inputText) {
  const sections = [
    ["INTENT", template.intent],
    ["SCOPE", template.scope],
    ["METHOD", template.method],
    ["CONSTRAINTS", template.constraints],
    ["OUTPUT", template.output],
    ["INPUT", inputText]
  ];
  return sections
    .filter(([, text]) => String(text || "").trim())
    .map(([name, text]) => `${name}:\n${String(text).trim()}`)
    .join("\n\n");
}

async function callGemini(env, contents) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, "Worker secret GEMINI_API_KEY is not set.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents,
      generationConfig: { thinkingConfig: { thinkingLevel: "high" } }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, `Gemini error: ${data?.error?.message || `request failed (${response.status})`}`);
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  if (!text) {
    const reason = data?.promptFeedback?.blockReason;
    throw new HttpError(502, reason ? `Gemini blocked this request (${reason}).` : "Gemini returned no text. Try again.");
  }
  return text;
}

/* ---------- Route handlers: everything in one call ---------- */

async function listNoteFiles(env, user) {
  const rows = await all(env, `SELECT id, note_id, name, size, content_type FROM ${tb("files")} WHERE user_name = ? ORDER BY id ASC`, user);
  const byNote = {};
  for (const row of rows) (byNote[row.note_id] ||= []).push({ id: row.id, name: row.name, size: row.size, content_type: row.content_type });
  return byNote;
}

const ANALYSIS_COLUMNS = "id, kind, title, template_id, source_diary_id, source_note_id, reference_note_id, source_label, job_title, job_details, job_description, created_at, updated_at";

async function listAll(env, user) {
  const byNote = await listNoteFiles(env, user);
  const notes = (await all(env, `SELECT id, title, plain_text, created_at, updated_at FROM ${tb("notes")} WHERE user_name = ? ORDER BY id DESC`, user))
    .map((note) => ({ ...note, files: byNote[note.id] || [] }));
  return json({
    templates: await all(env, `SELECT id, title, intent, scope, method, constraints, output, applies_to, created_at, updated_at FROM ${tb("templates")} WHERE user_name = ? ORDER BY id DESC`, user),
    notes,
    diaries: await all(env, `SELECT id, title, context, created_at, updated_at FROM ${tb("diaries")} WHERE user_name = ? ORDER BY id DESC`, user),
    analyses: await all(env, `SELECT ${ANALYSIS_COLUMNS} FROM ${tb("analyses")} WHERE user_name = ? ORDER BY id DESC`, user)
  });
}

/* ---------- ISMCO templates ---------- */

const TEMPLATE_COLUMNS = "id, title, intent, scope, method, constraints, output, applies_to, created_at, updated_at";

async function saveTemplate(request, env, user, id) {
  const body = await readJson(request);
  const title = cleanTitle(body.title, "Enter what this prompt is for.");
  const appliesTo = String(body.applies_to || "");
  if (!KINDS.includes(appliesTo)) throw new HttpError(400, "Choose where this prompt applies.");
  const fields = {};
  for (const key of ISMCO_KEYS) fields[key] = cleanText(body[key], key.toUpperCase());
  const stamp = now();

  let rowId = id;
  if (id) {
    await requireRow(env, "templates", id, user);
    await run(env,
      `UPDATE ${tb("templates")} SET title = ?, intent = ?, scope = ?, method = ?, constraints = ?, output = ?, applies_to = ?, updated_at = ? WHERE id = ? AND user_name = ?`,
      title, fields.intent, fields.scope, fields.method, fields.constraints, fields.output, appliesTo, stamp, id, user);
  } else {
    const result = await run(env,
      `INSERT INTO ${tb("templates")} (user_name, title, intent, scope, method, constraints, output, applies_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user, title, fields.intent, fields.scope, fields.method, fields.constraints, fields.output, appliesTo, stamp, stamp);
    rowId = result.meta.last_row_id;
  }
  const item = await first(env, `SELECT ${TEMPLATE_COLUMNS} FROM ${tb("templates")} WHERE id = ?`, rowId);
  return json({ item }, id ? 200 : 201);
}

async function deleteTemplate(request, env, user, id) {
  await requireRow(env, "templates", id, user);
  await requireConfirm(request);
  await run(env, `DELETE FROM ${tb("templates")} WHERE id = ? AND user_name = ?`, id, user);
  return json({ success: true });
}

/* ---------- Notes and uploads ---------- */

async function noteWithFiles(env, user, id) {
  const note = await first(env, `SELECT id, title, plain_text, created_at, updated_at FROM ${tb("notes")} WHERE id = ? AND user_name = ?`, id, user);
  if (!note) throw new HttpError(404, "That note was not found.");
  const files = await all(env, `SELECT id, name, size, content_type FROM ${tb("files")} WHERE note_id = ? AND user_name = ? ORDER BY id ASC`, id, user);
  return { ...note, files };
}

async function createNote(request, env, user) {
  const body = await readJson(request);
  const title = cleanTitle(body.title, "Enter what this note is for.");
  const plain = cleanText(body.plain_text, "Notes");
  const stamp = now();
  const result = await run(env,
    `INSERT INTO ${tb("notes")} (user_name, title, plain_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    user, title, plain, stamp, stamp);
  return json({ item: await noteWithFiles(env, user, result.meta.last_row_id) }, 201);
}

async function updateNote(request, env, user, id) {
  await requireRow(env, "notes", id, user);
  const body = await readJson(request);
  const title = cleanTitle(body.title, "Enter what this note is for.");
  const plain = cleanText(body.plain_text, "Notes");
  const removeIds = Array.isArray(body.remove_file_ids) ? body.remove_file_ids.map(idOrNull).filter(Boolean) : [];

  if (removeIds.length) {
    const files = await all(env, `SELECT id, r2_key FROM ${tb("files")} WHERE note_id = ? AND user_name = ?`, id, user);
    const doomed = files.filter((file) => removeIds.includes(file.id));
    await deleteR2Keys(env, doomed.map((file) => file.r2_key));
    await env.DB.batch(doomed.map((file) => env.DB.prepare(`DELETE FROM ${tb("files")} WHERE id = ? AND user_name = ?`).bind(file.id, user)));
  }
  await run(env, `UPDATE ${tb("notes")} SET title = ?, plain_text = ?, updated_at = ? WHERE id = ? AND user_name = ?`, title, plain, now(), id, user);
  return json({ item: await noteWithFiles(env, user, id) });
}

async function deleteNote(request, env, user, id) {
  await requireRow(env, "notes", id, user);
  await requireConfirm(request);
  const files = await all(env, `SELECT r2_key FROM ${tb("files")} WHERE note_id = ? AND user_name = ?`, id, user);
  await deleteR2Keys(env, files.map((file) => file.r2_key));
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tb("files")} WHERE note_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`DELETE FROM ${tb("notes")} WHERE id = ? AND user_name = ?`).bind(id, user)
  ]);
  return json({ success: true });
}

function looksLikeItsType(ext, head) {
  if (ext === "pdf") return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (ext === "png") return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (ext === "jpg" || ext === "jpeg") return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (ext === "webp") return head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  return true;
}

// Whatever name the file had, it is renamed on upload from the Worker clock.
async function uploadFiles(request, env, user, noteId) {
  const note = await requireRow(env, "notes", noteId, user);
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "The upload must be sent as form data.");
  }
  const files = form.getAll("files").filter((f) => f && typeof f === "object" && typeof f.arrayBuffer === "function");
  if (!files.length) throw new HttpError(400, "Add at least one file.");

  const existing = await all(env, `SELECT name FROM ${tb("files")} WHERE note_id = ? AND user_name = ?`, noteId, user);
  if (existing.length + files.length > MAX_FILES) throw new HttpError(400, `A note can have at most ${MAX_FILES} files.`);

  const prepared = [];
  for (const file of files) {
    const match = /\.([A-Za-z0-9]+)$/.exec(String(file.name || ""));
    const ext = match ? match[1].toLowerCase() : "";
    if (!FILE_TYPES[ext]) throw new HttpError(400, "Only PDF, PNG, JPG, WEBP or TXT files can be uploaded.");
    if (file.size > MAX_FILE_BYTES) throw new HttpError(400, "Each file must be 4 MB or smaller.");
    const buffer = await file.arrayBuffer();
    if (!looksLikeItsType(ext, new Uint8Array(buffer.slice(0, 12)))) {
      throw new HttpError(400, `A .${ext} file does not look like a real ${ext.toUpperCase()} file.`);
    }
    prepared.push({ ext, buffer });
  }

  const base = fileBaseName(new Date());
  const used = new Set(existing.map((row) => row.name));
  for (const item of prepared) {
    let counter = 1;
    let name;
    do {
      name = `${base}${counter > 1 ? `-${counter}` : ""}.${item.ext}`;
      counter++;
    } while (used.has(name));
    used.add(name);
    item.name = name;
  }

  const keys = [];
  const stamp = now();
  try {
    for (const item of prepared) {
      const key = `${R2_PREFIX}/${note.id}/${item.name}`;
      await env.BUCKET.put(key, item.buffer, { httpMetadata: { contentType: FILE_TYPES[item.ext] } });
      keys.push(key);
      await run(env,
        `INSERT INTO ${tb("files")} (note_id, user_name, name, r2_key, size, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        note.id, user, item.name, key, item.buffer.byteLength, FILE_TYPES[item.ext], stamp);
    }
  } catch (error) {
    await deleteR2Keys(env, keys).catch(() => {});
    await run(env, `DELETE FROM ${tb("files")} WHERE note_id = ? AND user_name = ? AND r2_key IN (${keys.map(() => "?").join(",") || "''"})`, note.id, user, ...keys).catch(() => {});
    console.error(error);
    throw new HttpError(500, "The files could not be saved to R2 Object Storage. Try again.");
  }
  await run(env, `UPDATE ${tb("notes")} SET updated_at = ? WHERE id = ? AND user_name = ?`, now(), note.id, user);
  return json({ item: await noteWithFiles(env, user, note.id) }, 201);
}

async function getFile(env, user, id) {
  const file = await first(env, `SELECT r2_key, content_type FROM ${tb("files")} WHERE id = ? AND user_name = ?`, id, user);
  if (!file) throw new HttpError(404, "That file was not found.");
  const object = await env.BUCKET.get(file.r2_key);
  if (!object) throw new HttpError(404, "That file was not found in R2 Object Storage.");
  return new Response(object.body, {
    headers: { "Content-Type": file.content_type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" }
  });
}

/* ---------- Work diaries ---------- */

const DIARY_COLUMNS = "id, title, context, created_at, updated_at";

async function saveDiary(request, env, user, id) {
  const body = await readJson(request);
  const title = cleanTitle(body.title, "Enter what this work diary is about.");
  const context = cleanText(body.context, "Context");
  const stamp = now();
  let rowId = id;
  if (id) {
    await requireRow(env, "diaries", id, user);
    await run(env, `UPDATE ${tb("diaries")} SET title = ?, context = ?, updated_at = ? WHERE id = ? AND user_name = ?`, title, context, stamp, id, user);
  } else {
    const result = await run(env,
      `INSERT INTO ${tb("diaries")} (user_name, title, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      user, title, context, stamp, stamp);
    rowId = result.meta.last_row_id;
  }
  return json({ item: await first(env, `SELECT ${DIARY_COLUMNS} FROM ${tb("diaries")} WHERE id = ?`, rowId) }, id ? 200 : 201);
}

async function deleteDiary(request, env, user, id) {
  await requireRow(env, "diaries", id, user);
  await requireConfirm(request);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tb("entries")} WHERE diary_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`DELETE FROM ${tb("diaries")} WHERE id = ? AND user_name = ?`).bind(id, user)
  ]);
  return json({ success: true });
}

const ENTRY_COLUMNS = "id, diary_id, content, created_at, updated_at";

async function listEntries(env, user, diaryId) {
  await requireRow(env, "diaries", diaryId, user);
  return json({ entries: await all(env, `SELECT ${ENTRY_COLUMNS} FROM ${tb("entries")} WHERE diary_id = ? AND user_name = ? ORDER BY id DESC`, diaryId, user) });
}

async function createEntry(request, env, user, diaryId) {
  await requireRow(env, "diaries", diaryId, user);
  const body = await readJson(request);
  const content = cleanText(body.content, "The diary entry", MAX_TEXT_CHARACTERS, true);
  const stamp = now();
  const result = await run(env,
    `INSERT INTO ${tb("entries")} (diary_id, user_name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    diaryId, user, content, stamp, stamp);
  await run(env, `UPDATE ${tb("diaries")} SET updated_at = ? WHERE id = ? AND user_name = ?`, stamp, diaryId, user);
  return json({ item: await first(env, `SELECT ${ENTRY_COLUMNS} FROM ${tb("entries")} WHERE id = ?`, result.meta.last_row_id) }, 201);
}

async function updateEntry(request, env, user, id) {
  const entry = await requireRow(env, "entries", id, user);
  const body = await readJson(request);
  const content = cleanText(body.content, "The diary entry", MAX_TEXT_CHARACTERS, true);
  await run(env, `UPDATE ${tb("entries")} SET content = ?, updated_at = ? WHERE id = ? AND user_name = ?`, content, now(), id, user);
  return json({ item: await first(env, `SELECT ${ENTRY_COLUMNS} FROM ${tb("entries")} WHERE id = ?`, entry.id) });
}

async function deleteEntry(request, env, user, id) {
  await requireRow(env, "entries", id, user);
  await requireConfirm(request);
  await run(env, `DELETE FROM ${tb("entries")} WHERE id = ? AND user_name = ?`, id, user);
  return json({ success: true });
}

/* ---------- Analyses ---------- */

// Reads the files of a note from R2 and shapes them for Gemini.
async function loadNoteFiles(env, user, noteId) {
  const rows = await all(env, `SELECT name, r2_key, size, content_type FROM ${tb("files")} WHERE note_id = ? AND user_name = ? ORDER BY id ASC`, noteId, user);
  const total = rows.reduce((sum, row) => sum + row.size, 0);
  if (total > MAX_AI_FILE_BYTES) {
    throw new HttpError(400, "The uploaded files are too large to send to the AI together. Use smaller files or fewer files.");
  }
  const parts = [];
  for (const row of rows) {
    const object = await env.BUCKET.get(row.r2_key);
    if (!object) throw new HttpError(404, `The file ${row.name} could not be found in R2 Object Storage.`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    parts.push({ inlineData: { mimeType: row.content_type, data: bytesToBase64(bytes) } });
  }
  return parts;
}

// Reads and checks the fields of an analysis form for its kind.
function readAnalysisFields(kind, body) {
  const fields = {
    template_id: idOrNull(body.template_id),
    source_diary_id: null,
    source_note_id: null,
    reference_note_id: null,
    job_title: "",
    job_details: "",
    job_description: ""
  };
  if (!fields.template_id) throw new HttpError(400, "Choose an ISMCO template.");
  if (DIARY_KINDS.includes(kind)) {
    fields.source_diary_id = idOrNull(body.source_diary_id);
    if (!fields.source_diary_id) throw new HttpError(400, "Choose a Work Diary.");
  } else if (kind === "classification") {
    fields.source_note_id = idOrNull(body.source_note_id);
    fields.reference_note_id = idOrNull(body.reference_note_id);
    if (!fields.source_note_id) throw new HttpError(400, "Choose a note with uploads.");
    if (!fields.reference_note_id) throw new HttpError(400, "Choose a plain note as the reference.");
  } else {
    fields.source_note_id = idOrNull(body.source_note_id);
    if (!fields.source_note_id) throw new HttpError(400, "Choose a note with uploads.");
    fields.job_title = cleanTitle(body.job_title, "Enter the job post title.");
    fields.job_details = cleanText(body.job_details, "The job post details");
    fields.job_description = cleanText(body.job_description, "The full job post description", MAX_JOB_DESCRIPTION_CHARACTERS, true);
  }
  return fields;
}

// Builds the prompt, runs Gemini once, and returns everything needed to save the analysis.
async function runAnalysis(env, user, kind, title, fields) {
  const template = await first(env, `SELECT * FROM ${tb("templates")} WHERE id = ? AND user_name = ?`, fields.template_id, user);
  if (!template) throw new HttpError(404, "That ISMCO template was not found.");
  if (template.applies_to !== kind) throw new HttpError(400, "That ISMCO template does not apply to this analysis.");

  let inputText;
  let sourceLabel;
  let fileParts = [];

  if (DIARY_KINDS.includes(kind)) {
    const diary = await first(env, `SELECT * FROM ${tb("diaries")} WHERE id = ? AND user_name = ?`, fields.source_diary_id, user);
    if (!diary) throw new HttpError(404, "That Work Diary was not found.");
    const entries = await all(env, `SELECT id, content, created_at FROM ${tb("entries")} WHERE diary_id = ? AND user_name = ? ORDER BY created_at ASC, id ASC`, diary.id, user);
    if (!entries.length && !diary.context) throw new HttpError(400, "That Work Diary has no entries or context to analyze yet.");
    const lines = [`Work diary: ${diary.title}`];
    if (diary.context) lines.push(`Context: ${diary.context}`);
    if (entries.length) {
      lines.push(`Covered timeframe: ${timeframeText(entries)}`, "", "Entries:");
      for (const entry of entries) lines.push(`[${stampText(entry.created_at)}] ${entry.content}`);
    }
    inputText = `Purpose of this analysis: ${title}\n\n${lines.join("\n")}`;
    sourceLabel = diary.title;
  } else {
    const source = await noteWithFiles(env, user, fields.source_note_id);
    if (!source.files.length) throw new HttpError(400, "The chosen source note has no uploads.");
    fileParts = await loadNoteFiles(env, user, source.id);
    sourceLabel = source.title;
    if (kind === "classification") {
      const reference = await noteWithFiles(env, user, fields.reference_note_id);
      if (!reference.plain_text) throw new HttpError(400, "The chosen reference note has no plain notes.");
      inputText = [
        `Purpose of this analysis: ${title}`,
        `Source: the attached upload(s) from the note "${source.title}".`,
        `Reference note "${reference.title}":`,
        reference.plain_text
      ].join("\n");
    } else {
      inputText = [
        `Purpose of this analysis: ${title}`,
        `Job post title: ${fields.job_title}`,
        fields.job_details ? `Job post details:\n${fields.job_details}` : "",
        `Full job post description:\n${fields.job_description}`,
        `Source: the attached upload(s) from the note "${source.title}".`
      ].filter(Boolean).join("\n\n");
    }
  }

  const promptText = ismcoPrompt(template, inputText);
  const result = await callGemini(env, [{ role: "user", parts: [{ text: promptText }, ...fileParts] }]);
  return { promptText, result, sourceLabel };
}

async function analysisDetail(env, user, id) {
  const row = await first(env, `SELECT ${ANALYSIS_COLUMNS}, result FROM ${tb("analyses")} WHERE id = ? AND user_name = ?`, id, user);
  if (!row) throw new HttpError(404, "That analysis was not found.");
  const messages = await all(env, `SELECT id, analysis_id, role, content, parent_id, created_at FROM ${tb("messages")} WHERE analysis_id = ? AND user_name = ? ORDER BY id ASC`, id, user);
  return { ...row, messages };
}

async function createAnalysis(request, env, user) {
  const body = await readJson(request);
  const kind = String(body.kind || "");
  if (!KINDS.includes(kind)) throw new HttpError(400, "Unknown analysis type.");
  const title = cleanTitle(body.title, "Enter what this analysis is for.");
  const fields = readAnalysisFields(kind, body);
  const built = await runAnalysis(env, user, kind, title, fields);
  const stamp = now();
  const inserted = await run(env,
    `INSERT INTO ${tb("analyses")} (user_name, kind, title, template_id, source_diary_id, source_note_id, reference_note_id, source_label, job_title, job_details, job_description, prompt_text, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user, kind, title, fields.template_id, fields.source_diary_id, fields.source_note_id, fields.reference_note_id,
    built.sourceLabel, fields.job_title, fields.job_details, fields.job_description, built.promptText, built.result, stamp, stamp);
  return json({ item: await analysisDetail(env, user, inserted.meta.last_row_id) }, 201);
}

async function updateAnalysis(request, env, user, id) {
  const current = await requireRow(env, "analyses", id, user);
  const body = await readJson(request);
  const title = cleanTitle(body.title, "Enter what this analysis is for.");
  const fields = readAnalysisFields(current.kind, body);
  const changed = Object.keys(fields).some((key) => String(fields[key] ?? "") !== String(current[key] ?? ""));

  if (!changed) {
    await run(env, `UPDATE ${tb("analyses")} SET title = ?, updated_at = ? WHERE id = ? AND user_name = ?`, title, now(), id, user);
    return json({ item: await analysisDetail(env, user, id) });
  }
  // The source, template, or job post changed: run the analysis again and start a fresh conversation.
  const built = await runAnalysis(env, user, current.kind, title, fields);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tb("messages")} WHERE analysis_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(
      `UPDATE ${tb("analyses")} SET title = ?, template_id = ?, source_diary_id = ?, source_note_id = ?, reference_note_id = ?, source_label = ?, job_title = ?, job_details = ?, job_description = ?, prompt_text = ?, result = ?, updated_at = ? WHERE id = ? AND user_name = ?`
    ).bind(title, fields.template_id, fields.source_diary_id, fields.source_note_id, fields.reference_note_id, built.sourceLabel,
      fields.job_title, fields.job_details, fields.job_description, built.promptText, built.result, now(), id, user)
  ]);
  return json({ item: await analysisDetail(env, user, id) });
}

async function deleteAnalysis(request, env, user, id) {
  await requireRow(env, "analyses", id, user);
  await requireConfirm(request);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tb("messages")} WHERE analysis_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`DELETE FROM ${tb("analyses")} WHERE id = ? AND user_name = ?`).bind(id, user)
  ]);
  return json({ success: true });
}

// A follow-up question: the saved prompt (and the source files, if the note still exists), the first answer, then the conversation.
async function sendMessage(request, env, user, analysisId) {
  const analysis = await requireRow(env, "analyses", analysisId, user);
  const body = await readJson(request);
  const content = cleanText(body.content, "Your message", 10000, true);

  const history = await all(env, `SELECT id, role, content FROM ${tb("messages")} WHERE analysis_id = ? AND user_name = ? ORDER BY id ASC`, analysisId, user);
  let fileParts = [];
  if (analysis.source_note_id) {
    const note = await first(env, `SELECT id FROM ${tb("notes")} WHERE id = ? AND user_name = ?`, analysis.source_note_id, user);
    if (note) fileParts = await loadNoteFiles(env, user, note.id).catch(() => []);
  }
  const contents = [
    { role: "user", parts: [{ text: analysis.prompt_text }, ...fileParts] },
    { role: "model", parts: [{ text: analysis.result }] },
    ...history.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: content }] }
  ];

  const userStamp = now();
  const userInsert = await run(env,
    `INSERT INTO ${tb("messages")} (analysis_id, user_name, role, content, parent_id, created_at) VALUES (?, ?, 'user', ?, NULL, ?)`,
    analysisId, user, content, userStamp);
  const userId = userInsert.meta.last_row_id;

  let reply;
  try {
    reply = await callGemini(env, contents);
  } catch (error) {
    await run(env, `DELETE FROM ${tb("messages")} WHERE id = ? AND user_name = ?`, userId, user).catch(() => {});
    throw error;
  }
  const replyStamp = now();
  const replyInsert = await run(env,
    `INSERT INTO ${tb("messages")} (analysis_id, user_name, role, content, parent_id, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`,
    analysisId, user, reply, userId, replyStamp);
  return json({
    messages: [
      { id: userId, analysis_id: analysisId, role: "user", content, parent_id: null, created_at: userStamp },
      { id: replyInsert.meta.last_row_id, analysis_id: analysisId, role: "assistant", content: reply, parent_id: userId, created_at: replyStamp }
    ]
  }, 201);
}

// Deleting a user message also deletes the AI reply that answers it.
async function deleteMessage(env, user, id) {
  const message = await first(env, `SELECT id, role FROM ${tb("messages")} WHERE id = ? AND user_name = ?`, id, user);
  if (!message || message.role !== "user") throw new HttpError(404, "That message was not found.");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${tb("messages")} WHERE parent_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`DELETE FROM ${tb("messages")} WHERE id = ? AND user_name = ?`).bind(id, user)
  ]);
  return json({ success: true });
}

/* ---------- Login ---------- */

async function login(request, env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new HttpError(500, "Worker secret AUTH_SECRET is missing or shorter than 32 characters.");
  }
  const body = await readJson(request);
  const identifier = String(body.identifier || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!identifier || !password) throw new HttpError(400, "Enter your username and password.");

  const userOk = await safeEqual(identifier, USERNAME);
  const passOk = await safeEqual(password, PASSWORD);
  if (!(userOk && passOk)) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    throw new HttpError(401, "Incorrect username or password.");
  }

  const issued = Math.floor(Date.now() / 1000);
  const token = await signToken({ sub: USERNAME, role: "user", iat: issued, exp: issued + TOKEN_LIFETIME_SECONDS }, env.AUTH_SECRET);
  return json({ token, user: { username: USERNAME }, expiresAt: issued + TOKEN_LIFETIME_SECONDS });
}

/* ---------- Routing ---------- */

async function route(request, env, url, ctx) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") return json({ ok: true, service: "remote-jobhunting-worker" });
  if (path === "/api/auth/login" && method === "POST") return login(request, env);

  if (!env.DB) throw new HttpError(500, "D1 binding DB is not configured.");
  if (!env.BUCKET) throw new HttpError(500, "R2 binding BUCKET is not configured.");
  const user = await requireUser(request, env);
  if (!user) throw new HttpError(401, "Your login has expired or is invalid. Log in again.");
  const issued = Math.floor(Date.now() / 1000);
  ctx.token = await signToken({ sub: user, role: "user", iat: issued, exp: issued + TOKEN_LIFETIME_SECONDS }, env.AUTH_SECRET);

  if (path === "/api/all" && method === "GET") return listAll(env, user);

  if (path === "/api/templates" && method === "POST") return saveTemplate(request, env, user, null);
  if (path === "/api/notes" && method === "POST") return createNote(request, env, user);
  if (path === "/api/diaries" && method === "POST") return saveDiary(request, env, user, null);
  if (path === "/api/analyses" && method === "POST") return createAnalysis(request, env, user);

  let match = path.match(/^\/api\/templates\/(\d+)$/);
  if (match && method === "PUT") return saveTemplate(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteTemplate(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/notes\/(\d+)$/);
  if (match && method === "PUT") return updateNote(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteNote(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/notes\/(\d+)\/files$/);
  if (match && method === "POST") return uploadFiles(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/files\/(\d+)$/);
  if (match && method === "GET") return getFile(env, user, Number(match[1]));

  match = path.match(/^\/api\/diaries\/(\d+)$/);
  if (match && method === "PUT") return saveDiary(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteDiary(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/diaries\/(\d+)\/entries$/);
  if (match && method === "GET") return listEntries(env, user, Number(match[1]));
  if (match && method === "POST") return createEntry(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/entries\/(\d+)$/);
  if (match && method === "PUT") return updateEntry(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteEntry(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/analyses\/(\d+)$/);
  if (match && method === "GET") return json({ item: await analysisDetail(env, user, Number(match[1])) });
  if (match && method === "PUT") return updateAnalysis(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteAnalysis(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/analyses\/(\d+)\/messages$/);
  if (match && method === "POST") return sendMessage(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/messages\/(\d+)$/);
  if (match && method === "DELETE") return deleteMessage(env, user, Number(match[1]));

  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const ctx = {};
    let response;
    try {
      response = await route(request, env, new URL(request.url), ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status);
      } else {
        console.error(error);
        response = json({ error: "Unexpected server error." }, 500);
      }
    }
    const finalResponse = withCors(response, cors);
    if (ctx.token) finalResponse.headers.set("X-Refreshed-Token", ctx.token);
    return finalResponse;
  }
};
