/**
 * Cloudflare Worker for the Translate tool.
 *
 * Bindings / secrets (Cloudflare dashboard):
 *   D1 binding:  DB
 *   Secret:      AUTH_SECRET     (random, at least 32 characters)
 *   Secret:      GEMINI_API_KEY  (from Google AI Studio)
 *   Variable:    ALLOWED_ORIGIN = https://gladys-lacia.github.io
 *
 * IMPORTANT: Do not commit this file to the public GitHub repository.
 * It contains your private prompts. Deploy it from the Cloudflare dashboard.
 *
 * D1 tables (run once in the D1 console). "multi-user-translate-tool" holds the accounts.
 * You add each account yourself with an INSERT; a plaintext password is replaced by a
 * PBKDF2 hash the first time that user logs in.
 *
 *   CREATE TABLE IF NOT EXISTS "multi-user-translate-tool" (
 *     first_name TEXT, last_name TEXT,
 *     user_name TEXT NOT NULL UNIQUE, user_email TEXT UNIQUE, user_password TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "multi-user-translate-tabs" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL,
 *     title TEXT NOT NULL DEFAULT 'New translation', mode_id TEXT NOT NULL, created_at TEXT NOT NULL);
 *   CREATE TABLE IF NOT EXISTS "multi-user-translate-messages" (
 *     id INTEGER PRIMARY KEY AUTOINCREMENT, tab_id INTEGER NOT NULL, user_name TEXT NOT NULL,
 *     role TEXT NOT NULL, content TEXT NOT NULL, mode_id TEXT, created_at TEXT NOT NULL);
 *   CREATE INDEX IF NOT EXISTS idx_translate_tabs_user ON "multi-user-translate-tabs" (user_name);
 *   CREATE INDEX IF NOT EXISTS idx_translate_msgs_tab ON "multi-user-translate-messages" (tab_id, user_name);
 *
 *   INSERT INTO "multi-user-translate-tool" (first_name, last_name, user_name, user_email, user_password)
 *   VALUES ('Gladys', 'Lacia', 'gladyslacia', 'you@example.com', 'a-temporary-password');
 */

// Confirm the exact model name your free API key can use in Google AI Studio.
const GEMINI_MODEL = "gemini-3.6-flash";

const T_USERS = "multi-user-translate-tool";
const T_TABS = "multi-user-translate-tabs";
const T_MSGS = "multi-user-translate-messages";

const PBKDF2_ITERATIONS = 100000; // Cloudflare Workers caps PBKDF2 at 100,000 iterations.
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const ALLOWED_DEFAULT_ORIGIN = "https://gladys-lacia.github.io";
const MAX_INPUT_CHARACTERS = 20000;
const DEFAULT_TITLE = "New translation";

/**
 * YOUR PROMPTS. Paste each section between the backticks.
 * The text typed in the chat box is added automatically as the INPUT section.
 * If a prompt contains a backtick or ${, put a backslash before it.
 * A mode with an empty section returns an error instead of calling Gemini.
 */
const MODES = [
  { id: "ceb-us", label: "Cebuano to US/American English", prompt: { 
    INTENT: `Translate the provided text from Philippine Cebuano into natural US/American English while correcting grammar, spelling, punctuation, and sentence structure. The goal is to produce a translation that sounds as though it was originally written by a native US/American English speaker, while faithfully preserving the original meaning, intent, and tone.`, 
    SCOPE: `- Work only on the text provided under INPUT.
    - The task applies exclusively to the user-supplied text. Do not translate, modify, or respond to any part of the instructions.`,
     METHOD: `1st. Translate the text from Philippine Cebuano into US/American English.
    2nd. Correct grammar, spelling, punctuation, and sentence structure.
    3rd. Improve naturalness and readability.
    4th. Preserve the original meaning, context, and tone.
    5th. Use a conversational, friendly, and respectful US/American English style.`, 
     CONSTRAINTS: `- Do not add information.
    - Do not omit important information.
    - Do not explain your changes.
    - Do not answer the message.
    - Return only the translated and corrected text.`,
      OUTPUT: `Return only the final translated and grammatically corrected US/American English text. Do not include headings, explanations, notes, or quotation marks.` 
    } },
  { id: "ceb-uk", label: "Cebuano to UK/British English", prompt: { 
    INTENT: `Translate the provided text from Philippine Cebuano into natural UK/British English while correcting grammar, spelling, punctuation, and sentence structure. The goal is to produce a translation that sounds as though it was originally written by a native UK/British English speaker, while faithfully preserving the original meaning, intent, and tone.`, 
    SCOPE: `- Work only on the text provided under INPUT.
    - The task applies exclusively to the user-supplied text. Do not translate, modify, or respond to any part of the instructions.`, 
    METHOD: `1st. Translate the text from Philippine Cebuano into UK/British English.
    2nd. Correct grammar, spelling, punctuation, and sentence structure.
    3rd. Improve naturalness and readability.
    4th. Preserve the original meaning, context, and tone.
    5th. Use a conversational, friendly, and respectful UK/British English style.`, 
    CONSTRAINTS: `- Do not add information.
    - Do not omit important information.
    - Do not explain your changes.
    - Do not answer the message.
    - Return only the translated and corrected text.`, 
    OUTPUT: `Return only the final translated and grammatically corrected UK/British English text. Do not include headings, explanations, notes, or quotation marks.` 
    } },
  { id: "ceb-au", label: "Cebuano to AU/Australian English", prompt: { 
    INTENT: `Translate the provided text from Philippine Cebuano into natural AU/Australian English while correcting grammar, spelling, punctuation, and sentence structure. The goal is to produce a translation that sounds as though it was originally written by a native AU/Australian English speaker, while faithfully preserving the original meaning, intent, and tone.`, 
    SCOPE: `- Work only on the text provided under INPUT.
    - The task applies exclusively to the user-supplied text. Do not translate, modify, or respond to any part of the instructions.`, 
    METHOD: `1st. Translate the text from Philippine Cebuano into AU/Australian English.
    2nd. Correct grammar, spelling, punctuation, and sentence structure.
    3rd. Improve naturalness and readability.
    4th. Preserve the original meaning, context, and tone.
    5th. Use a conversational, friendly, and respectful AU/Australian English style.`, 
    CONSTRAINTS: `- Do not add information.
    - Do not omit important information.
    - Do not explain your changes.
    - Do not answer the message.
    - Return only the translated and corrected text.`, 
    OUTPUT: `Return only the final translated and grammatically corrected AU/Australian English text. Do not include headings, explanations, notes, or quotation marks.` 
    } },
  { id: "ceb-taglish", label: "Cebuano to Tagalog Code-Switching", prompt: { 
    INTENT: `Translate the provided text from Philippine Cebuano into natural Philippine Taglish (Tagalog and English code-switching) while correcting grammar, spelling, punctuation, capitalization, sentence structure, and word choice. The goal is to produce a translation that sounds as though it was originally written by a fluent Filipino who naturally switches between Tagalog and English in everyday conversation. Preserve the original meaning, intent, emotion, and tone while ensuring the output is conversational, friendly, respectful, and easy to understand.`, 
    SCOPE: `- Work only on the text provided under INPUT.
    - The task applies exclusively to the user-supplied text. Do not translate, modify, or respond to any part of these instructions.`, 
    METHOD: `1st. Read and fully understand the meaning, context, intent, and emotional tone of the Philippine Cebuano text before translating.
    2nd. Correct any grammar, spelling, punctuation, capitalization, sentence structure, awkward wording, or typographical errors found in the source text whenever necessary to accurately reflect the intended meaning.
    3rd. Translate the corrected text into natural Philippine Taglish, using a balanced and authentic mix of Tagalog and English that reflects how Filipinos commonly communicate in everyday conversations.
    4th. Preserve the original message, context, intent, emphasis, and emotional tone while improving clarity, readability, and overall flow. Rewrite expressions only when necessary to make them sound more natural in Philippine Taglish.
    5th. Review the final translation to ensure it is grammatically correct, fluent, conversational, friendly, respectful, internally consistent, and free of untranslated Cebuano unless intentionally retained because it is widely understood or has no more natural Taglish equivalent.`, 
    CONSTRAINTS: `- Do not add, remove, reinterpret, summarize, or invent information that is not present in the original text.
    - Do not explain the translation, provide notes, reasoning, commentary, alternatives, or additional responses.
    - Do not preserve grammatical, spelling, punctuation, or typographical errors from the original unless they are intentionally required to preserve meaning.
    - Use only natural Philippine Taglish that feels authentic to native Filipino speakers, avoiding overly formal, overly literal, or unnatural translations.
    - Output only the translated and grammatically corrected text.`, 
    OUTPUT: `Provide a single, polished translation in natural Philippine Taglish that faithfully preserves the original meaning while improving grammar, clarity, readability, and flow. The final output should be ready to use without requiring any further editing or explanation.` 
    } },
  { id: "ceb-grammar", label: "Cebuano Grammar", prompt: { 
    INTENT: `Correct the grammar, spelling, punctuation, word choice, and sentence structure of the provided Philippine Cebuano text while preserving its original language, meaning, intent, tone, and personality. The goal is to produce a version that reads as though it was naturally written by a fluent native Cebuano speaker, making only the changes necessary to improve clarity, correctness, and natural flow without altering the author's message.`, 
    SCOPE: `- Work only on the text provided under INPUT. The task applies exclusively to the user-supplied text.
    - Rewrite the input into grammatically correct and natural Philippine Cebuano while preserving the original meaning, intent, tone, level of formality, and overall message.`, 
    METHOD: `1st. Read the entire input carefully to understand its complete meaning, context, tone, and intended message before making any corrections.
    2nd. Correct grammatical errors, spelling mistakes, punctuation, capitalization, sentence structure, word usage, and awkward phrasing while keeping the language entirely in Philippine Cebuano.
    3rd. Improve readability and natural flow by replacing unnatural or repetitive expressions with wording that a native Cebuano speaker would commonly use, but only when necessary.
    4th. Preserve the author's original intent, emotional tone, emphasis, and conversational style. Do not add, remove, exaggerate, simplify, or reinterpret information that was not present in the original text.
    5th. Review the corrected version to ensure it is fluent, natural, internally consistent, and free from grammatical or typographical errors before producing the final output.`, 
    CONSTRAINTS: `- Do not translate the text into any other language. The output must remain entirely in Philippine Cebuano.
    - Do not add explanations, notes, comments, summaries, introductions, conclusions, or alternative versions.
    - Do not invent, omit, or modify facts, ideas, opinions, or context that were not present in the original text.
    - Preserve names, numbers, dates, quotations, formatting, emojis, and other intentional elements unless they contain clear errors that require correction.
    - Output only the corrected Philippine Cebuano text and nothing else.`, 
    OUTPUT: `Produce a single polished version of the corrected Philippine Cebuano text. The final result should sound natural, conversational, friendly, and respectful, while faithfully preserving the original meaning, intent, tone, and style. Return only the corrected text without any additional commentary or formatting.` 
    } },
  { id: "en-hokkien", label: "English to Hokkien", prompt: { 
    INTENT: `Translate the text provided under INPUT from US-American/UK-British/AU-Australian English into Hokkien using the most accurate, natural, and grammatically correct Hokkien possible. Preserve the original meaning, intent, tone, and context while ensuring the translation sounds natural to a fluent Hokkien speaker. After the translation, explain how the translation was produced by describing important word choices, grammar, sentence structure, idioms, cultural adaptations (if applicable), and any alternative translations where they would significantly affect meaning.`, 
    SCOPE: `- Work only on the text provided under INPUT.
    - Produce both a Hokkien translation and a detailed explanation of the translation process.`, 
    METHOD: `1st. Carefully read the entire input and determine its meaning, context, tone, and intended message before translating.
    2nd. Translate the text into natural, fluent Hokkien while preserving the original meaning, correcting only obvious grammatical or spelling mistakes in the English source when necessary to produce a faithful translation.
    3rd. Use appropriate Hokkien vocabulary, grammar, sentence structure, expressions, and word order that would sound natural to native speakers rather than translating word-for-word.
    4th. Review the completed translation for accuracy, consistency, grammatical correctness, and completeness, ensuring that no information from the original text has been omitted, added, or altered.
    5th. After presenting the translation, provide a clear explanation describing how the translation was formed. Explain important vocabulary choices, grammatical structures, cultural considerations, idiomatic expressions, and any alternative translations when they are relevant to understanding the result.`, 
    CONSTRAINTS: `- Do not change, summarize, expand, or reinterpret the meaning unless required to produce a natural Hokkien translation.
    - Do not omit, add, or invent information that is not present in the original text.
    - Prioritize natural Hokkien grammar and readability over literal word-for-word translation while remaining faithful to the original meaning.
    - If a word, phrase, or sentence has multiple valid Hokkien translations, choose the one that best matches the original context and explain the choice.
    - Do not answer questions, provide opinions, or perform tasks unrelated to translating and explaining the text supplied under INPUT.`, 
    OUTPUT: `First, present the complete Hokkien translation. Afterward, provide a detailed explanation of how the translation was produced, including significant vocabulary choices, grammar, sentence structure, idiomatic expressions, cultural adaptations (if applicable), and alternative translations when appropriate. Keep the explanation organized, easy to follow, and directly related to the translated text.` 
    } },
  { id: "en-madurese", label: "English to Madurese", prompt: { 
    INTENT: `Translate the text provided under INPUT from US-American/UK-British/AU-Australian English into Indonesian Madurese using the highest possible level of linguistic accuracy, grammatical correctness, and natural fluency. Preserve the original meaning, intent, tone, nuance, context, and level of formality while ensuring the translation reads as though it was originally written by a native speaker of Indonesian Madurese. After completing the translation, provide a thorough explanation describing how the translation was produced, including important grammatical choices, vocabulary selection, sentence structure, idiomatic expressions, cultural adaptations (when applicable), and any alternative translations that could reasonably be used without significantly changing the intended meaning.`, 
    SCOPE: `- Work exclusively on the text provided under INPUT. Do not translate, modify, summarize, expand, or respond to any text outside of the INPUT section.
    - The task consists of two equally important parts: (1) producing a complete Indonesian Madurese translation and (2) explaining in detail the linguistic reasoning behind the translation.`, 
    METHOD: `1st. Analyze the source text: Carefully examine the original English text to determine its meaning, context, tone, grammatical structure, register, implied meanings, idiomatic language, and any culturally dependent expressions before beginning the translation.
    2nd. Produce the translation: Translate the text into natural Indonesian Madurese while preserving the original meaning as faithfully as possible. Use vocabulary, grammar, spelling, punctuation, capitalization, and sentence structure that would sound natural to fluent Indonesian Madurese speakers. Prioritize natural readability without sacrificing accuracy.
    3rd. Review and refine: Carefully proofread the translation to eliminate grammatical errors, awkward phrasing, mistranslations, omissions, unnecessary additions, inconsistencies, or unnatural wording. Improve fluency while maintaining complete semantic equivalence with the original text.
    4th. Explain the translation: After the translation, explain how it was produced. Discuss important word choices, grammatical constructions, sentence restructuring, idioms, expressions, cultural localization decisions (if any), and why those choices best preserve the original meaning. Mention notable translation challenges and how they were resolved.
    5th. Present the final result: Display the completed Indonesian Madurese translation first, followed by the detailed explanation. Organize the response clearly so that the translation and explanation are easy to distinguish and read.`, 
    CONSTRAINTS: `- Preserve the original meaning, intent, tone, emotion, nuance, and context as accurately as possible. Do not omit, simplify, embellish, reinterpret, or invent information.
    - Use natural, grammatically correct, and fluent Indonesian Madurese that reflects how native speakers would normally communicate while remaining faithful to the source text.
    - Retain proper nouns, names, numbers, dates, technical terminology, formatting, and specialized vocabulary unless an established Indonesian Madurese equivalent is more appropriate.
    - When multiple valid translations exist, choose the one that best fits the context. Mention significant alternative translations only when they meaningfully affect interpretation or nuance.
    - Do not include personal opinions, assumptions, unrelated commentary, or information beyond what is necessary to complete the translation and explain the translation process.`, 
    OUTPUT: `The response should contain two clearly labeled sections. The first section should present the complete Indonesian Madurese translation. The second section should provide a detailed explanation of the translation process, including grammatical decisions, vocabulary choices, sentence structure, idiomatic expressions, cultural considerations (when applicable), translation challenges, and noteworthy alternative translations where they would significantly influence meaning.` 
    } }
];

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
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(value) {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) throw new Error("Invalid hexadecimal value.");
  return Uint8Array.from(value.match(/.{2}/g) || [], (pair) => parseInt(pair, 16));
}

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

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256));
}

async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(digest)}`;
}

async function verifyPassword(password, storedValue) {
  const stored = String(storedValue || "");
  const parts = stored.split("$");
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) return { valid: false, legacy: false };
    try {
      const actual = await derivePasswordHash(password, fromHex(parts[2]), iterations);
      return { valid: constantTimeEqual(actual, fromHex(parts[3])), legacy: false };
    } catch {
      return { valid: false, legacy: false };
    }
  }
  // A password you typed directly into the database: accepted once, then replaced by a hash.
  return { valid: stored.length > 0 && stored === password, legacy: true };
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
  return payload && payload.role === "user" ? payload.sub : null;
}

/* ---------- Request helpers ---------- */

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

const findMode = (id) => MODES.find((mode) => mode.id === id);

function buildPrompt(mode, input) {
  const sections = ["INTENT", "SCOPE", "METHOD", "CONSTRAINTS", "OUTPUT"];
  const missing = sections.filter((name) => !String(mode.prompt[name] || "").trim());
  if (missing.length) {
    throw new HttpError(500, `The prompt for "${mode.label}" is missing: ${missing.join(", ")}. Add it in translate-worker.js.`);
  }
  return sections.map((name) => `${name}:\n${mode.prompt[name].trim()}`).join("\n\n") + `\n\nINPUT:\n${input}`;
}

async function callGemini(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new HttpError(500, "Worker secret GEMINI_API_KEY is not set.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
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
    throw new HttpError(502, reason ? `Gemini blocked this request (${reason}).` : "Gemini returned no translation. Try again.");
  }
  return text;
}

const ownTab = (env, id, user) =>
  env.DB.prepare(`SELECT id, title, mode_id, created_at FROM "${T_TABS}" WHERE id = ? AND user_name = ?`).bind(id, user).first();

async function requireTab(env, id, user) {
  const tab = await ownTab(env, id, user);
  if (!tab) throw new HttpError(404, "That tab was not found.");
  return tab;
}

async function insertMessage(env, tabId, user, role, content, modeId) {
  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO "${T_MSGS}" (tab_id, user_name, role, content, mode_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(tabId, user, role, content, modeId, createdAt).run();
  return { id: result.meta.last_row_id, tab_id: tabId, role, content, mode_id: modeId, created_at: createdAt };
}

/* ---------- Route handlers ---------- */

async function login(request, env) {
  if (!env.DB) throw new HttpError(500, "D1 binding DB is not configured.");
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
    throw new HttpError(500, "Worker secret AUTH_SECRET is missing or shorter than 32 characters.");
  }
  const body = await readJson(request);
  const identifier = String(body.identifier || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!identifier || !password) throw new HttpError(400, "Enter your username/email and password.");

  const user = await env.DB.prepare(
    `SELECT user_name, user_email, user_password FROM "${T_USERS}" WHERE lower(user_name) = ? OR lower(user_email) = ? LIMIT 1`
  ).bind(identifier, identifier).first();
  const check = user ? await verifyPassword(password, user.user_password) : { valid: false };
  if (!check.valid) throw new HttpError(401, "Incorrect username/email or password.");

  if (check.legacy) {
    await env.DB.prepare(`UPDATE "${T_USERS}" SET user_password = ? WHERE user_name = ?`)
      .bind(await makePasswordRecord(password), user.user_name).run();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ sub: String(user.user_name), role: "user", iat: now, exp: now + TOKEN_LIFETIME_SECONDS }, env.AUTH_SECRET);
  return json({ token, user: { username: String(user.user_name) }, expiresAt: now + TOKEN_LIFETIME_SECONDS });
}

async function listTabs(env, user) {
  const result = await env.DB.prepare(
    `SELECT id, title, mode_id, created_at FROM "${T_TABS}" WHERE user_name = ? ORDER BY id DESC`
  ).bind(user).all();
  return json({ tabs: result.results || [] });
}

async function createTab(request, env, user) {
  const body = await readJson(request);
  const modeId = body.mode_id || MODES[0].id;
  if (!findMode(modeId)) throw new HttpError(400, "Unknown translation mode.");
  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO "${T_TABS}" (user_name, title, mode_id, created_at) VALUES (?, ?, ?, ?)`
  ).bind(user, DEFAULT_TITLE, modeId, createdAt).run();
  return json({ tab: { id: result.meta.last_row_id, title: DEFAULT_TITLE, mode_id: modeId, created_at: createdAt } }, 201);
}

async function updateTab(request, env, user, id) {
  const tab = await requireTab(env, id, user);
  const body = await readJson(request);
  const modeId = body.mode_id === undefined ? tab.mode_id : String(body.mode_id);
  if (!findMode(modeId)) throw new HttpError(400, "Unknown translation mode.");
  await env.DB.prepare(`UPDATE "${T_TABS}" SET mode_id = ? WHERE id = ? AND user_name = ?`).bind(modeId, id, user).run();
  return json({ tab: { ...tab, mode_id: modeId } });
}

async function deleteTab(env, user, id) {
  await requireTab(env, id, user);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM "${T_MSGS}" WHERE tab_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`DELETE FROM "${T_TABS}" WHERE id = ? AND user_name = ?`).bind(id, user)
  ]);
  return json({ success: true });
}

async function listMessages(env, user, id) {
  await requireTab(env, id, user);
  const result = await env.DB.prepare(
    `SELECT id, tab_id, role, content, mode_id, created_at FROM "${T_MSGS}" WHERE tab_id = ? AND user_name = ? ORDER BY id ASC`
  ).bind(id, user).all();
  return json({ messages: result.results || [] });
}

async function clearMessages(request, env, user, id) {
  await requireTab(env, id, user);
  const body = await readJson(request);
  if (body.confirm !== "CLEAR") throw new HttpError(400, "Type CLEAR to confirm.");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM "${T_MSGS}" WHERE tab_id = ? AND user_name = ?`).bind(id, user),
    env.DB.prepare(`UPDATE "${T_TABS}" SET title = ? WHERE id = ? AND user_name = ?`).bind(DEFAULT_TITLE, id, user)
  ]);
  return json({ success: true });
}

async function deleteMessage(env, user, id) {
  const result = await env.DB.prepare(`DELETE FROM "${T_MSGS}" WHERE id = ? AND user_name = ?`).bind(id, user).run();
  if (!result.meta.changes) throw new HttpError(404, "That message was not found.");
  return json({ success: true });
}

async function translate(request, env, user, id) {
  const tab = await requireTab(env, id, user);
  const body = await readJson(request);
  const text = String(body.text || "").trim();
  if (!text) throw new HttpError(400, "Enter some text to translate.");
  if (text.length > MAX_INPUT_CHARACTERS) throw new HttpError(400, `Text must be ${MAX_INPUT_CHARACTERS} characters or fewer.`);

  const mode = findMode(tab.mode_id);
  if (!mode) throw new HttpError(400, "This tab's mode no longer exists. Choose another mode.");

  // Each translation is independent: only the chosen prompt and the new text go to Gemini.
  const output = await callGemini(env, buildPrompt(mode, text));

  const userMessage = await insertMessage(env, tab.id, user, "user", text, mode.id);
  const assistantMessage = await insertMessage(env, tab.id, user, "assistant", output, mode.id);

  let title = tab.title;
  if (title === DEFAULT_TITLE) {
    title = text.replace(/\s+/g, " ").slice(0, 40);
    await env.DB.prepare(`UPDATE "${T_TABS}" SET title = ? WHERE id = ? AND user_name = ?`).bind(title, tab.id, user).run();
  }
  return json({ user: userMessage, assistant: assistantMessage, title });
}

async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") return json({ ok: true, service: "translate-worker" });
  if (path === "/api/auth/login" && method === "POST") return login(request, env);

  if (!env.DB) throw new HttpError(500, "D1 binding DB is not configured.");
  const user = await requireUser(request, env);
  if (!user) throw new HttpError(401, "Your login has expired or is invalid. Log in again.");

  if (path === "/api/modes" && method === "GET") return json({ modes: MODES.map(({ id, label }) => ({ id, label })) });
  if (path === "/api/tabs" && method === "GET") return listTabs(env, user);
  if (path === "/api/tabs" && method === "POST") return createTab(request, env, user);

  let match = path.match(/^\/api\/tabs\/(\d+)$/);
  if (match && method === "PUT") return updateTab(request, env, user, Number(match[1]));
  if (match && method === "DELETE") return deleteTab(env, user, Number(match[1]));

  match = path.match(/^\/api\/tabs\/(\d+)\/messages$/);
  if (match && method === "GET") return listMessages(env, user, Number(match[1]));
  if (match && method === "DELETE") return clearMessages(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/tabs\/(\d+)\/translate$/);
  if (match && method === "POST") return translate(request, env, user, Number(match[1]));

  match = path.match(/^\/api\/messages\/(\d+)$/);
  if (match && method === "DELETE") return deleteMessage(env, user, Number(match[1]));

  throw new HttpError(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    let response;
    try {
      response = await route(request, env, new URL(request.url));
    } catch (error) {
      if (error instanceof HttpError) {
        response = json({ error: error.message }, error.status);
      } else {
        console.error(error);
        response = json({ error: "Unexpected server error." }, 500);
      }
    }
    return withCors(response, cors);
  }
};
