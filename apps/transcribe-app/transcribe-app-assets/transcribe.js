'use strict';
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const API = 'https://transcribe-app-electron.acct-gladyslacia.workers.dev';
const P = ipcRenderer.sendSync('app:paths'); // { mp3, video, tmp }
const FF = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const p2 = n => String(n).padStart(2, '0');
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const stamp = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}${MON[d.getMonth()]}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + p2(m) : p2(m)) + ':' + p2(s % 60); };
const hms = s => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}:${p2(s % 60)}`;
const enc = encodeURIComponent;
const fileUrl = f => pathToFileURL(f).href;
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function icon(id) { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('class', 'ic'); const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; }
function ibtn(id, title, fn, cls) { const b = el('button', 'icon-btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.title = title; b.append(icon(id)); b.onclick = fn; return b; }
const setIcon = (btn, id) => btn.querySelector('use').setAttribute('href', '#' + id);
const note = (box, text) => box.replaceChildren(el('p', 'empty-note', text));
/* Copy text to the clipboard. Electron 44 and newer no longer give the page the `clipboard` object, so this uses the
   browser's clipboard API, with the older textarea method as a backup. Returns true when the text was copied. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* use the backup */ }
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  t.remove();
  return ok;
}
function copyDone(btn, ok) { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }

function uniqueName(dir, ext, extras) {
  const base = stamp(); let name = base, i = 2;
  while (['', ...extras].some(x => fs.existsSync(path.join(dir, name + x + ext)))) name = `${base}-${i++}`;
  return name + ext;
}

function ff(args, total, onP) {
  return new Promise((res, rej) => {
    const p = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true });
    let err = '';
    p.stdout.on('data', d => { const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].pop(); if (m && total > 0 && onP) onP(Math.min(1, m[1] / 1e6 / total)); });
    p.stderr.on('data', d => { err += d; });
    p.on('error', rej);
    p.on('close', c => c === 0 ? res() : rej(new Error(err.trim().split('\n').pop() || 'ffmpeg exited with code ' + c)));
  });
}

function mediaDuration(url) {
  return new Promise(r => {
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => { const d = v.duration; v.removeAttribute('src'); v.load(); r(isFinite(d) ? d : 0); };
    v.onerror = () => r(0);
    v.src = url;
  });
}

/* ---------- warning, busy state, tabs ---------- */
let warnT;
function warn(msg) { const w = $('#warn'); w.textContent = msg; w.hidden = false; clearTimeout(warnT); warnT = setTimeout(() => { w.hidden = true; }, 4500); }

const BUSY_TAB = { 'Transcribe Live': 'tab-live', 'Audio Recording': 'tab-audio', 'Screen Recording': 'tab-video' };
let busy = null;
function setBusy(label) {
  busy = label;
  ipcRenderer.send('app:busy', label);
  $$('.tab-btn').forEach(l => l.classList.toggle('locked', !!busy && BUSY_TAB[busy] !== l.getAttribute('for')));
}
ipcRenderer.on('app:blocked', (e, label) => warn(label + ' is still ongoing.'));

function currentTab() { return ['tab-live', 'tab-audio', 'tab-video'].find(id => $('#' + id).checked); }
function onTab(id) {
  if (id === 'tab-live') loadSessions();
  if (id === 'tab-audio') { renderLocal(); loadR2(); }
  if (id === 'tab-video') renderVideos();
}
$$('.tab-btn').forEach(l => l.addEventListener('click', e => {
  e.preventDefault();
  const id = l.getAttribute('for');
  if (busy && BUSY_TAB[busy] !== id) { warn(busy + ' is still ongoing.'); return; }
  $('#' + id).checked = true;
  onTab(id);
}));

/* ---------- network ---------- */
let online = navigator.onLine;
function setOnline(v) {
  if (v === online) return;
  online = v; $('#offline').checked = !v;
  if (v) refreshCloud();
}
function refreshCloud() { const t = currentTab(); if (t === 'tab-live') loadSessions(); if (t === 'tab-audio') loadR2(); }
async function checkNet() {
  if (!navigator.onLine) return setOnline(false);
  try { await fetch(API + '/api/ping', { cache: 'no-store' }); setOnline(true); } catch { setOnline(false); }
}
addEventListener('online', checkNet);
addEventListener('offline', checkNet);
setInterval(checkNet, 45000);
$('#offline').checked = !online;

/* ---------- API ---------- */
let TOKEN = '';
async function api(p, o = {}) {
  const r = await fetch(API + p, { ...o, headers: { Authorization: 'Bearer ' + TOKEN, ...(o.headers || {}) } });
  if (r.status === 401) { showLogin('Please log in again.'); throw new Error('Unauthorized'); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch { /* ignore */ } throw new Error(m || 'HTTP ' + r.status); }
  return r;
}
const jget = p => api(p).then(r => r.json());
const jpost = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());

function applyConfig(c) {
  if (c.liveModel) $('#model-live').textContent = c.liveModel;
  if (c.fileModel) $('#model-audio').textContent = c.fileModel;
  try { localStorage.setItem('cfg', JSON.stringify(c)); } catch { /* ignore */ }
}

/* ---------- log in ---------- */
function showLogin(msg) {
  $('#login-err').hidden = !msg; $('#login-err').textContent = msg || '';
  $('#m-login').classList.add('open'); ($('#login-user').value ? $('#login-pass') : $('#login-user')).focus();
}
$('#login-user').onkeydown = $('#login-pass').onkeydown = e => { if (e.key === 'Enter') $('#login-ok').click(); };
$('#login-ok').onclick = async () => {
  const username = $('#login-user').value.trim(), password = $('#login-pass').value;
  if (!username || !password) return;
  const btn = $('#login-ok'); btn.disabled = true;
  try {
    let r = null;
    try { r = await fetch(API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) }); }
    catch { /* the server cannot be reached */ }
    if (r) {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return showLogin(j.error || 'Could not log in (HTTP ' + r.status + ').');
      TOKEN = j.token; await ipcRenderer.invoke('auth:save', TOKEN);
      await ipcRenderer.invoke('local:save', username, password); // remember it on this laptop for offline logins
    } else {
      const res = await ipcRenderer.invoke('local:check', username, password);
      if (res === 'none') return showLogin('Cannot reach the server. Connect to the internet and log in once, so this laptop can remember your password.');
      if (res !== 'ok') return showLogin('Wrong username or password.');
      TOKEN = ''; // offline login: no cloud token, so only the local features work
    }
  } finally { btn.disabled = false; }
  $('#login-pass').value = ''; $('#m-login').classList.remove('open'); boot();
  if (!TOKEN) warn('Offline login: only local features work until you log in online.');
};
$('#btn-logout').onclick = async () => {
  if (busy) return warn(busy + ' is still ongoing.');
  await ipcRenderer.invoke('auth:clear'); TOKEN = '';
  $('#live-grid').replaceChildren(); $('#list-r2').replaceChildren();
  showLogin();
};

/* ---------- confirmation box ---------- */
const cm = $('#m-confirm'), cIn = $('#c-input'), cOk = $('#c-ok'), cErr = $('#c-err');
let cRun = null, cBusy = false, cWord = '';
function confirmBox({ title, text, word, ok, cls = 'btn-danger', run }) {
  $('#c-title').textContent = title; $('#c-text').textContent = text; $('#c-word').textContent = word;
  cWord = word; cRun = run; cBusy = false;
  cIn.value = ''; cIn.disabled = false; cOk.textContent = ok; cOk.className = 'btn ' + cls; cOk.disabled = true; cErr.hidden = true;
  cm.classList.add('open'); cIn.focus();
}
cIn.oninput = () => { cOk.disabled = cBusy || cIn.value !== cWord; };
cIn.onkeydown = e => { if (e.key === 'Enter' && !cOk.disabled) cOk.click(); };
const cCancel = () => { if (!cBusy) cm.classList.remove('open'); };
$('#c-cancel').onclick = cCancel;
$('.backdrop', cm).onclick = cCancel;
cOk.onclick = async () => {
  const label = cOk.textContent;
  cBusy = true; cOk.disabled = true; cIn.disabled = true; cOk.textContent = 'Working…';
  try { await cRun(t => { $('#c-text').textContent = t; }); cBusy = false; cm.classList.remove('open'); }
  catch (e) { cBusy = false; cErr.textContent = e.message; cErr.hidden = false; cOk.textContent = label; cIn.disabled = false; cIn.oninput(); }
};

/* ---------- dialog helper ---------- */
function dlg(root) {
  const st = $('.status', root), ti = $('.dlg-title', root);
  const o = {
    state: '',
    set(s) { o.state = s; $$('[data-on]', root).forEach(e => { e.hidden = !e.dataset.on.split(' ').includes(s); }); },
    status(html) { st.innerHTML = html; },
    statusText(t) { st.textContent = t; },
    title(t) { ti.textContent = t; },
    open() { root.classList.add('open'); },
    close() { root.classList.remove('open'); }
  };
  $('.backdrop', root).onclick = () => { if (['idle', 'ended'].includes(o.state)) o.close(); };
  const c = $('.b-close', root); if (c) c.onclick = () => o.close();
  return o;
}

/* ===================== Transcribe Live ===================== */
const live = (() => {
  const root = $('#m-live'), D = dlg(root);
  const linesBox = $('.lines', root), empty = $('.empty', root), input = $('.stop-input', root);
  const bStart = $('.b-start', root), bStop = $('.b-stop', root), bEnd = $('.b-end', root);
  const LIMIT = 420, GAP = 8, CHUNK = 160000; // 7 min, 8 s, 10 s of 16 kHz audio
  /* const LIMIT = 10, GAP = 8, CHUNK = 160000; */
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=';
  const MAX_BUFFER = 16000 * 120; // while reconnecting, keep up to 2 minutes of audio
  let S = null;

  // A "-live" model (gemini-3.5-transcribe-live) streams straight from this app to Gemini, like the AI Studio
  // playground. Any other model keeps the old way: 10-second chunks sent through the worker.
  const isStream = () => /-live$/.test($('#model-live').textContent.trim());
  const pos = s => Math.floor(s.samples / 16000); // seconds of audio captured so far

  const reset = name => { if (S) hardStop(S); S = { name, created: false, lines: [], samples: 0, pcm: [], pcmLen: 0, Q: [], pumping: false, tick: null, waitT: null, cap: null, endAt: 0, stream: false, ws: null, ready: false, finalizing: false, gen: 0, retry: 0, reconnectT: null, closeT: null, turnStart: null, lastFinal: 0, lastOff: -1, interimEl: null, problemShown: false }; linesBox.replaceChildren(); empty.hidden = false; input.value = ''; bStop.disabled = true; bStart.disabled = bEnd.disabled = false; };

  function addLine(l) {
    S.lines.push(l); empty.hidden = true;
    const p = el('p'); p.append(el('time', null, l.ts), el('span', null, l.text));
    if (S.interimEl) linesBox.insertBefore(p, S.interimEl); else linesBox.append(p);
    linesBox.parentElement.scrollTop = linesBox.parentElement.scrollHeight;
  }

  function wavB64(f) {
    const b = Buffer.alloc(44 + f.length * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + f.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(f.length * 2, 40);
    for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); b.writeInt16LE((v < 0 ? v * 32768 : v * 32767) | 0, 44 + i * 2); }
    return b.toString('base64');
  }

  function cut(final) {
    const n = S.pcmLen; if (!n) return;
    if (final && n < 8000) { S.pcm = []; S.pcmLen = 0; return; }
    const buf = new Float32Array(n); let o = 0;
    for (const c of S.pcm) { buf.set(c, o); o += c.length; }
    S.pcm = []; S.pcmLen = 0;
    const off = Math.floor(S.samples / 16000); S.samples += n;
    S.Q.push({ off, wav: wavB64(buf), fails: 0 }); pump();
  }

  async function pump() {
    const s = S; if (s.pumping) return; s.pumping = true;
    try {
      while (s.Q.length) {
        const c = s.Q[0];
        try {
          if (c.text != null) { await jpost('/api/live/line', { name: s.name, offset: c.off, text: c.text }); s.Q.shift(); } // streamed line: already on screen, just save it
          else { const r = await jpost('/api/live/chunk', { name: s.name, offset: c.off, wav: c.wav }); s.Q.shift(); if (r.line && S === s) addLine(r.line); }
        /* } catch (e) {
          if (online && ++c.fails >= 4) { s.Q.shift(); if (S === s) addLine({ ts: hms(c.off), text: '[this part could not be transcribed]' }); }
          else await sleep(3000);
        } */
        } catch (e) {
          if (online && ++c.fails >= 4) { s.Q.shift(); if (S === s) { if (c.text != null) warn('A line could not be saved: ' + e.message); else addLine({ ts: hms(c.off), text: '[this part could not be transcribed: ' + e.message + ']' }); } }
          else await sleep(3000);
        }
      }
    } finally { s.pumping = false; }
  }

  /* ---- direct streaming to the Gemini Live API (used when the live model ends in "-live") ---- */
  function addNote(text) { // a message in the log that is not part of the transcript and is not saved
    const p = el('p'); p.append(el('time', null, hms(pos(S))), el('span', null, text));
    if (S.interimEl) linesBox.insertBefore(p, S.interimEl); else linesBox.append(p);
    empty.hidden = true; linesBox.parentElement.scrollTop = linesBox.parentElement.scrollHeight;
  }
  function problem(s, why) { if (S !== s || s.problemShown) return; s.problemShown = true; addNote('[Live connection problem: ' + why + '. Retrying…]'); }

  function showInterim(s, text) { // grey "still speaking" line that the final text replaces
    if (S !== s) return;
    if (s.turnStart == null) s.turnStart = Math.max(0, pos(s) - 1);
    if (!s.interimEl) { const p = el('p'); p.style.opacity = '0.55'; p.append(el('time', null, hms(s.turnStart)), el('span')); s.interimEl = p; linesBox.append(p); empty.hidden = true; }
    $('span', s.interimEl).textContent = text;
    linesBox.parentElement.scrollTop = linesBox.parentElement.scrollHeight;
  }
  function dropInterim(s) { if (s.interimEl) { s.interimEl.remove(); s.interimEl = null; } }

  function sendPending(s) { // send the captured audio to Gemini (or keep it while there is no connection)
    if (!s.ready || !s.ws || s.ws.readyState !== 1) {
      while (s.pcmLen > MAX_BUFFER && s.pcm.length) s.pcmLen -= s.pcm.shift().length;
      return;
    }
    if (!s.pcmLen) return;
    const f = new Float32Array(s.pcmLen); let o = 0;
    for (const c of s.pcm) { f.set(c, o); o += c.length; }
    s.pcm = []; s.pcmLen = 0;
    for (let i = 0; i < f.length; i += 4096) {
      const part = f.subarray(i, i + 4096), pcm = new Int16Array(part.length);
      for (let j = 0; j < part.length; j++) { const v = Math.max(-1, Math.min(1, part[j])); pcm[j] = v < 0 ? v * 32768 : v * 32767; }
      s.ws.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.from(pcm.buffer).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
    }
  }

  function closeWs(s) {
    clearTimeout(s.closeT);
    const ws = s.ws; s.ws = null; s.ready = false;
    try { if (ws) ws.close(1000, 'done'); } catch { /* ignore */ }
  }
  function armClose(s, ms) { clearTimeout(s.closeT); s.closeT = setTimeout(() => closeWs(s), ms); }
  function hardStop(s) { clearTimeout(s.reconnectT); s.gen++; closeWs(s); }

  function endStream(s) { // tell Gemini the audio is over so it finishes the last sentence, then close
    sendPending(s);
    try { s.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch { /* ignore */ }
    armClose(s, 3500);
  }
  function finishStream() { // called when the microphone has stopped
    const s = S; s.finalizing = true; clearTimeout(s.reconnectT);
    if (s.ready && s.ws) endStream(s);
    else if (!s.ws) { s.pcm = []; s.pcmLen = 0; }
    // if it is still connecting, markReady() finishes it
  }
  async function settle() { const s = S, t0 = Date.now(); while (s.ws && Date.now() - t0 < 6000) await sleep(100); }

  async function connect() {
    const s = S, gen = ++s.gen; clearTimeout(s.reconnectT);
    s.finalizing = false; s.ready = false;
    const alive = () => S === s && gen === s.gen && s.cap;
    const retry = why => {
      if (!alive()) return;
      problem(s, why); s.retry++;
      s.reconnectT = setTimeout(connect, Math.min(5000, 1000 * s.retry));
    };
    let t;
    try { t = await jpost('/api/live/token'); } catch (e) { return retry(e.message); }
    if (!alive()) return;
    let ws;
    try { ws = new WebSocket(WS_URL + t.token); } catch (e) { return retry(e.message); }
    ws.binaryType = 'arraybuffer';
    s.ws = ws;

    const markReady = () => { // the server accepted the setup: send everything captured so far
      if (s.ws !== ws || s.ready) return;
      s.ready = true; s.retry = 0; s.problemShown = false;
      sendPending(s);
      if (s.finalizing) endStream(s);
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ setup: { model: 'models/' + t.model, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { mode: t.mode || 'SMART', languageCodes: [] } } }));
      setTimeout(markReady, 3000); // in case the server never announces the setup
    };
    ws.onmessage = ev => {
      if (s.ws !== ws || S !== s) return;
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); } catch { return; }
      markReady(); // any reply means the setup was accepted
      if (s.finalizing) armClose(s, 1500);
      const sc = msg.serverContent; if (!sc) return;
      const part = sc.interimInputTranscription && sc.interimInputTranscription.text;
      if (part && part.trim()) showInterim(s, part.trim());
      const fin = sc.inputTranscription && sc.inputTranscription.text;
      if (fin != null) {
        dropInterim(s);
        const text = String(fin).replace(/\s+/g, ' ').trim();
        if (!text) { s.turnStart = null; return; }
        let off = s.turnStart != null ? s.turnStart : s.lastFinal;
        off = Math.max(off, s.lastOff + 1); // the cloud keeps one line per second, so never reuse a second
        s.turnStart = null; s.lastFinal = pos(s); s.lastOff = off;
        addLine({ ts: hms(off), text });
        s.Q.push({ off, text, fails: 0 }); pump();
      }
    };
    ws.onclose = ev => {
      if (s.ws !== ws) return; // we closed it ourselves
      s.ws = null; s.ready = false;
      if (s.finalizing) { s.pcm = []; s.pcmLen = 0; return; }
      retry('the connection closed (' + ev.code + (ev.reason ? ': ' + ev.reason : '') + ')');
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  async function startStream() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { D.statusText('Cannot access the microphone: ' + e.message); return false; }
    const ctx = new AudioContext({ sampleRate: 16000 }); ctx.resume();
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(S.stream ? 2048 : 4096, 1, 1);
    if (S.stream) { S.pcm = []; S.pcmLen = 0; }
    proc.onaudioprocess = e => {
      const d = new Float32Array(e.inputBuffer.getChannelData(0)); S.pcm.push(d); S.pcmLen += d.length;
      if (S.stream) { S.samples += d.length; sendPending(S); } else if (S.pcmLen >= CHUNK) cut();
    };
    src.connect(proc); proc.connect(ctx.destination);
    S.cap = { stream, ctx, src, proc };
    S.endAt = Date.now() + LIMIT * 1000;
    D.set('rec');
    if (S.stream) { S.retry = 0; S.problemShown = false; connect(); }
    const f = () => { const left = Math.ceil((S.endAt - Date.now()) / 1000); D.status(`<b>${fmt(left)}</b> left of ${fmt(LIMIT)}`); if (left <= 0) { clearInterval(S.tick); limit(); } };
    clearInterval(S.tick); f(); S.tick = setInterval(f, 250);
    return true;
  }

  function endCapture() {
    const c = S.cap; if (!c) return; S.cap = null;
    c.proc.onaudioprocess = null;
    try { c.src.disconnect(); c.proc.disconnect(); } catch { /* ignore */ }
    c.ctx.close(); c.stream.getTracks().forEach(t => t.stop());
    if (S.stream) finishStream(); else cut(true);
  }

  function limit() {
    endCapture(); D.set('wait');
    const until = Date.now() + GAP * 1000;
    clearInterval(S.waitT);
    S.waitT = setInterval(() => {
      const n = Math.ceil((until - Date.now()) / 1000);
      if (n <= 0) { clearInterval(S.waitT); startStream().then(ok => { if (!ok) D.set('stopped'); }); }
      else D.statusText(`Recording restarts in ${n}s`);
    }, 250);
    D.statusText(`Recording restarts in ${GAP}s`);
  }

  async function begin() {
    S.stream = isStream();
    if (!(await startStream())) return;
    setBusy('Transcribe Live');
    if (!S.created) {
      try { await jpost('/api/live/sessions', { name: S.name }); S.created = true; }
      catch (e) { clearInterval(S.tick); endCapture(); setBusy(null); D.set('idle'); D.statusText('Could not start the session: ' + e.message); }
    }
  }

  input.oninput = () => { bStop.disabled = input.value !== 'STOP'; };
  bStart.onclick = begin;
  bStop.onclick = () => {
    if (input.value !== 'STOP') return;
    clearInterval(S.tick); clearInterval(S.waitT); endCapture();
    input.value = ''; bStop.disabled = true;
    D.set('stopped'); D.statusText('Stopped. Start again or end the session.');
  };
  bEnd.onclick = async () => {
    if (!S.created) { setBusy(null); D.close(); return; }
    bStart.disabled = bEnd.disabled = true; D.statusText('Finishing the transcription…');
    if (S.stream) await settle(); // let Gemini finish the last sentence
    const t0 = Date.now();
    while (S.Q.length && Date.now() - t0 < 120000) { pump(); await sleep(500); }
    if (S.Q.length) addLine({ ts: hms(S.Q[0].off), text: '[some parts could not be sent. Check your connection.]' });
    try { await jpost(`/api/live/sessions/${enc(S.name)}/end`); } catch { /* ignore */ }
    setBusy(null); S.Q.length = 0; hardStop(S); dropInterim(S);
    D.set('ended'); D.statusText('The session has ended'); loadSessions();
  };

  $('.b-copy', root).onclick = async e => {
    const b = e.currentTarget;
    copyDone(b, await copyText(`${S.name} Transcription:\n\n` + S.lines.map(l => `${l.ts} ${l.text}`).join('\n')));
  };
  $('.b-delete', root).onclick = () => confirmBox({
    title: 'Delete this session?', text: S.name + ' and its transcription will be permanently removed.', word: 'DELETE', ok: 'Delete',
    run: async () => { await api('/api/live/sessions/' + enc(S.name), { method: 'DELETE' }); D.close(); loadSessions(); }
  });

  return {
    async openNew() {
      if (!online) return;
      try {
        const { name } = await jget('/api/live/newname');
        reset(name); D.title(name); D.set('idle'); D.statusText('The session has not started yet'); D.open();
      } catch (e) { warn('Could not add a session: ' + e.message); }
    },
    async view(name) {
      try {
        const j = await jget('/api/live/sessions/' + enc(name));
        reset(name); S.created = true; D.title(name);
        j.lines.forEach(addLine);
        D.set('ended'); D.statusText('The session has ended'); D.open();
      } catch (e) { warn('Could not open the session: ' + e.message); }
    }
  };
})();

async function loadSessions() {
  const g = $('#live-grid'); if (!online) return;
  try {
    const { sessions } = await jget('/api/live/sessions');
    g.replaceChildren();
    if (!sessions.length) return note(g, 'No sessions yet. Click “+ Add session” to start one.');
    for (const s of sessions) {
      const c = el('article', 'card'), b = el('button', 'card-open');
      b.type = 'button'; b.title = 'Open session'; b.append(icon('i-open')); b.onclick = () => live.view(s.name);
      c.append(b, el('h3', null, s.name), el('p', null, s.preview || ''));
      g.append(c);
    }
  } catch (e) { note(g, 'Could not load sessions: ' + e.message); }
}

/* ===================== Audio and video recorders ===================== */
function makeRec(cfg) {
  const root = $(cfg.root), D = dlg(root);
  const input = $('.stop-input', root), bStart = $('.b-start', root), bStop = $('.b-stop', root), bEnd = $('.b-end', root);
  let R = null;
  const lock = () => { bStart.disabled = bEnd.disabled = R.rendering; };

  async function begin() {
    let stream;
    try { stream = await cfg.stream(); } catch (e) { D.statusText(`Cannot access the ${cfg.dev}: ${e.message}`); return false; }
    R.stream = stream; R.name = cfg.nameFor(); D.title(R.name);
    R.mime = cfg.mime();
    const rec = new MediaRecorder(stream, { ...(R.mime ? { mimeType: R.mime } : {}), ...cfg.bits });
    R.tmp = path.join(P.tmp, `${Date.now()}-${cfg.kind}.${R.mime.includes('mp4') ? 'mp4' : 'webm'}`);
    const w = R.ws = fs.createWriteStream(R.tmp); R.chain = Promise.resolve();
    rec.ondataavailable = e => { if (e.data.size) R.chain = R.chain.then(async () => { w.write(Buffer.from(await e.data.arrayBuffer())); }); };
    R.rec = rec; rec.start(5000); R.t0 = Date.now(); R.endAt = R.t0 + cfg.limit * 1000; R.prog = 0;
    if (cfg.onStream) cfg.onStream(stream);
    if (!R.started) { R.started = true; setBusy(cfg.label); }
    D.set('rec');
    const f = () => { const left = Math.ceil((R.endAt - Date.now()) / 1000); D.status(`<b>${fmt(left)}</b> left of ${fmt(cfg.limit)}`); if (left <= 0) { clearInterval(R.tick); limit(); } };
    clearInterval(R.tick); f(); R.tick = setInterval(f, 500);
    return true;
  }

  function endSeg() {
    return new Promise(res => {
      const rec = R.rec, w = R.ws, stream = R.stream;
      rec.onstop = async () => {
        await R.chain; await new Promise(r => w.end(r));
        stream.getTracks().forEach(t => t.stop());
        if (cfg.onStreamEnd) cfg.onStreamEnd();
        res();
      };
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop();
    });
  }

  async function save() {
    const dur = (Date.now() - R.t0) / 1000, name = R.name, tmp = R.tmp, out = path.join(cfg.dir, name);
    R.rendering = true; lock(); R.prog = 0;
    const t0 = Date.now(), est = cfg.estimate(dur, tmp);
    const show = () => {
      const el_ = (Date.now() - t0) / 1000;
      const left = R.prog > 0.02 ? el_ * (1 - R.prog) / R.prog : Math.max(1, est - el_);
      D.statusText(`Saving ${cfg.ext.toUpperCase()}… about ${fmt(left)} left`);
    };
    show(); const timer = setInterval(show, 1000);
    let ok = true;
    try { await ff(cfg.args(tmp, out + '.part', dur), dur, p => { R.prog = p; }); fs.renameSync(out + '.part', out); fs.rmSync(tmp, { force: true }); }
    catch (e) { ok = false; fs.rmSync(out + '.part', { force: true }); D.statusText(`Could not save ${name}: ${e.message}. The raw recording is kept at ${tmp}`); }
    clearInterval(timer); R.rendering = false; lock(); cfg.refresh();
    return ok;
  }

  async function limit() {
    await endSeg(); D.set('wait');
    const ok = await save();
    if (R.cancelled || !ok) { D.set('stopped'); if (ok) D.statusText('Stopped. Start again or end the recording.'); return; }
    if (!(await begin())) D.set('stopped');
  }

  input.oninput = () => { bStop.disabled = input.value !== 'STOP'; };
  bStart.onclick = () => { if (!R.rendering) begin(); };
  bStop.onclick = async () => {
    if (input.value !== 'STOP') return;
    input.value = ''; bStop.disabled = true;
    if (D.state === 'wait') { R.cancelled = true; D.set('stopped'); return; }
    clearInterval(R.tick); R.rendering = true; lock(); D.set('stopped');
    await endSeg();
    if (await save()) D.statusText('Stopped. Start again or end the recording.');
  };
  bEnd.onclick = () => {
    if (R.rendering) return;
    if (R.started) setBusy(null);
    D.close(); cfg.refresh();
  };

  return {
    open() {
      R = { started: false, cancelled: false, rendering: false, tick: null, rec: null, stream: null, ws: null, chain: Promise.resolve(), tmp: '', name: '', t0: 0, endAt: 0, mime: '', prog: 0 };
      input.value = ''; bStop.disabled = true; lock();
      D.set('idle'); D.statusText(cfg.idle); D.title(cfg.nameFor()); D.open();
    }
  };
}

const audioRec = makeRec({
  root: '#m-audio', kind: 'audio', label: 'Audio Recording', ext: 'mp3', dir: P.mp3, limit: 4200, dev: 'microphone',
  /* root: '#m-audio', kind: 'audio', label: 'Audio Recording', ext: 'mp3', dir: P.mp3, limit: 10, dev: 'microphone', */
  idle: 'The audio recording has not started yet',
  stream: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 48000, echoCancellation: false, noiseSuppression: false } }),
  mime: () => 'audio/webm;codecs=opus', bits: { audioBitsPerSecond: 96000 },
  nameFor: () => uniqueName(P.mp3, '.mp3', ['-r2', '-converted']),
  estimate: d => Math.max(5, d / 60),
  args: (i, o) => ['-i', i, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', o], // 48 kHz, mono, 64 kbps
  refresh: () => renderLocal()
});

/* Ask for the screen in three ways, because Windows setups differ */
async function getScreen() {
  const errs = [], note1 = e => errs.push(`${e.name}: ${e.message}`);
  try { return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); } catch (e) { note1(e); }
  try { return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); } catch (e) { note1(e); }
  let id = '';
  try { id = await ipcRenderer.invoke('app:screen-id'); } catch (e) { note1(e); }
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } };
  try { return await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video }); } catch (e) { note1(e); }
  try { return await navigator.mediaDevices.getUserMedia({ audio: false, video }); } catch (e) { note1(e); }
  throw new Error(`all 4 methods failed (screen id: ${id || 'none'}) | ` + errs.join(' | '));
}

/* Screen + system audio + microphone, with the camera as a small picture in the top-right corner */
let screenOut = null;
async function screenStream() {
  const W = 1280, H = 720;
  let display = null, snap = null;
  try { display = await getScreen(); }
  catch (err) {
    // Live capture cannot start on this PC: fall back to screenshots (about 8 frames per second, microphone only)
    const first = await ipcRenderer.invoke('app:screen-shot', W, H).catch(() => null);
    if (!first) throw new Error(err.message + ' | screenshots are blocked too');
    snap = { img: await createImageBitmap(new Blob([first], { type: 'image/jpeg' })), stop: false };
    warn('Screen capture is in compatibility mode: about 8 frames per second, microphone only.');
    (async () => {
      while (!snap.stop) {
        try { const b = await ipcRenderer.invoke('app:screen-shot', W, H); if (b && !snap.stop) { const old = snap.img; snap.img = await createImageBitmap(new Blob([b], { type: 'image/jpeg' })); old.close(); } } catch { /* keep the last frame */ }
        await sleep(30);
      }
    })();
  }
  let mic = null, cam = null;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } }); } catch { /* no microphone */ }
  try { cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } }); } catch { /* no camera */ }
  const vid = st => { const v = document.createElement('video'); v.muted = true; v.srcObject = st; v.play().catch(() => {}); return v; };
  const sv = display ? vid(new MediaStream(display.getVideoTracks())) : null, cv = cam ? vid(cam) : null;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const draw = () => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const src = sv || (snap && snap.img), sw = sv ? sv.videoWidth : src && src.width, sh = sv ? sv.videoHeight : src && src.height;
    if (src && sw) { const k = Math.min(W / sw, H / sh), w = sw * k, h = sh * k; g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h); }
    if (cv && cv.videoWidth) {
      const w = 240, h = Math.round(w * cv.videoHeight / cv.videoWidth), x = W - w - 16, y = 16;
      g.drawImage(cv, x, y, w, h); g.strokeStyle = '#FFFEF2'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    }
  };
  const timer = setInterval(draw, 1000 / 30);
  const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination();
  [display, mic].forEach(st => { if (st && st.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks())).connect(dest); });
  const out = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  out._cleanup = () => { clearInterval(timer); if (snap) snap.stop = true; [display, mic, cam].forEach(st => st && st.getTracks().forEach(t => t.stop())); ctx.close(); };
  screenOut = out;
  return out;
}

const previewEl = $('.preview', $('#m-video'));
const videoRec = makeRec({
  root: '#m-video', kind: 'video', label: 'Screen Recording', ext: 'mp4', dir: P.video, limit: 3000, dev: 'screen',
  /* root: '#m-video', kind: 'video', label: 'Screen Recording', ext: 'mp4', dir: P.video, limit: 10, dev: 'screen', */
  idle: 'The mp4 recording has not started yet',
  stream: screenStream,
  mime: () => ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '',
  bits: { videoBitsPerSecond: 2500000, audioBitsPerSecond: 64000 }, // 720p, 30 FPS, 2.5 Mbps
  nameFor: () => uniqueName(P.video, '.mp4', ['-converted']),
  estimate: (d, tmp) => tmp.endsWith('.mp4') ? Math.max(5, d / 200 + 3) : Math.max(10, d / 2.5),
  args: (i, o) => i.endsWith('.mp4')
    ? ['-i', i, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', o]
    : ['-i', i, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-f', 'mp4', o],
  onStream: s => { previewEl.srcObject = s; previewEl.play().catch(() => {}); },
  onStreamEnd: () => { previewEl.srcObject = null; if (screenOut) { screenOut._cleanup(); screenOut = null; } },
  refresh: () => renderVideos()
});

$('#btn-add-live').onclick = () => live.openNew();
$('#btn-add-audio').onclick = () => audioRec.open();
$('#btn-add-video').onclick = () => videoRec.open();

/* ===================== Audio lists ===================== */
const players = new Map();
function releaseAudio(f) { const a = players.get(f); if (a) { a.pause(); a.removeAttribute('src'); a.load(); players.delete(f); } }
const r2Name = f => f.replace(/-converted\.mp3$/i, '.mp3').replace(/\.mp3$/i, '-r2.mp3');
const d1Name = r => r.replace(/-r2\.mp3$/i, '-d1');

function renderLocal() {
  [...players.keys()].forEach(releaseAudio);
  const box = $('#list-local');
  let files = [];
  try { files = fs.readdirSync(P.mp3).filter(f => /\.mp3$/i.test(f)).sort().reverse(); } catch { /* ignore */ }
  if (!files.length) return note(box, 'No MP3 files yet. Click “+ Add recording”.');
  box.replaceChildren(...files.map(localItem));
}

function localItem(f) {
  const full = path.join(P.mp3, f);
  const a = el('article', 'file'), row = el('div', 'file-row'), acts = el('div', 'file-acts');
  const seek = el('input', 'seek'); seek.type = 'range'; seek.min = 0; seek.max = 1000; seek.value = 0; seek.setAttribute('aria-label', 'Seek');
  const play = ibtn('i-play', 'Play', () => {
    let x = players.get(f);
    if (!x) {
      x = new Audio(); x.preload = 'metadata'; x.src = fileUrl(full); players.set(f, x);
      x.ontimeupdate = () => { if (x.duration) seek.value = x.currentTime / x.duration * 1000; };
      x.onplay = () => setIcon(play, 'i-pause'); x.onpause = () => setIcon(play, 'i-play');
    }
    if (x.paused) { players.forEach((o, k) => { if (k !== f) o.pause(); }); x.play(); } else x.pause();
  });
  seek.oninput = () => { const x = players.get(f); if (x && x.duration) x.currentTime = seek.value / 1000 * x.duration; };
  const del = ibtn('i-trash', 'Delete', () => confirmBox({
    title: 'Delete this MP3?', text: f, word: 'DELETE', ok: 'Delete',
    run: async () => { releaseAudio(f); fs.unlinkSync(full); renderLocal(); }
  }));
  acts.append(play, del);
  if (/-r2\.mp3$/i.test(f)) acts.append(el('span', 'tag', 'uploaded'));
  else acts.append(ibtn('i-up', 'Upload to Cloudflare', () => confirmBox({
    title: 'Upload to Cloudflare R2?', text: `${f} will be renamed ${r2Name(f)} once it is uploaded.`, word: 'UPLOAD', ok: 'Upload', cls: 'btn-save',
    run: async setMsg => {
      const rn = r2Name(f), dest = path.join(P.mp3, rn);
      if (fs.existsSync(dest)) throw new Error(rn + ' already exists on this laptop.');
      setMsg('Uploading… this can take a minute.');
      releaseAudio(f);
      await api('/api/r2/' + enc(rn), { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: fs.readFileSync(full) });
      fs.renameSync(full, dest); renderLocal(); loadR2();
    }
  }), 'upload'));
  row.append(seek, acts); a.append(el('p', 'file-name', f), row);
  return a;
}

async function loadR2() {
  const box = $('#list-r2');
  if (!online) return note(box, 'You are offline. Cloudflare files appear when you reconnect.');
  try {
    const { files } = await jget('/api/r2');
    if (!files.length) return note(box, 'No files in Cloudflare yet. Upload an MP3 from the left.');
    box.replaceChildren(...files.map(r2Item));
  } catch (e) { note(box, 'Could not load Cloudflare files: ' + e.message); }
}

function r2Item(f) {
  const a = el('article', 'file'), acts = el('div', 'file-acts');
  const del = ibtn('i-trash', 'Delete', () => confirmBox({
    title: 'Delete from Cloudflare?', text: f.status === 'd1' ? d1Name(f.name) + ' and its transcription will be permanently removed.' : f.name + ' will be permanently removed.', word: 'DELETE', ok: 'Delete',
    run: async () => { await api('/api/r2/' + enc(f.name), { method: 'DELETE' }); loadR2(); }
  }));
  if (f.status === 'd1') {
    const l = el('button', 'd1-link', d1Name(f.name)); l.type = 'button'; l.onclick = () => openD1(f.name);
    acts.append(del); a.append(l, acts);
  } else {
    acts.append(del, ibtn('i-text', 'Transcribe', async () => {
      a.classList.add('busy'); acts.replaceChildren(el('span', 'file-note', 'Transcribing… this can take a few minutes.'));
      try { await api(`/api/r2/${enc(f.name)}/transcribe`, { method: 'POST' }); } catch (e) { warn('Could not transcribe: ' + e.message); }
      loadR2();
    }));
    a.append(el('p', 'file-name', f.name), acts);
  }
  return a;
}

const d1m = $('#m-d1'); let d1cur = null;
async function openD1(rname) {
  try {
    const j = await jget('/api/d1/' + enc(rname));
    d1cur = { rname, d1: d1Name(rname), text: j.text };
    $('#d1-title').textContent = d1cur.d1; $('.d1-status', d1m).textContent = `${rname} has already been deleted.`; $('.d1-text', d1m).textContent = j.text;
    d1m.classList.add('open');
  } catch (e) { warn('Could not open the transcription: ' + e.message); }
}
$('.b-close', d1m).onclick = $('.backdrop', d1m).onclick = () => d1m.classList.remove('open');
$('.b-copy', d1m).onclick = async e => {
  const b = e.currentTarget;
  copyDone(b, await copyText(`${d1cur.d1} Transcription:\n\n${d1cur.text}`));
};
$('.b-delete', d1m).onclick = () => confirmBox({
  title: 'Delete this transcription?', text: d1cur.d1 + ' will be permanently removed.', word: 'DELETE', ok: 'Delete',
  run: async () => { await api('/api/r2/' + enc(d1cur.rname), { method: 'DELETE' }); d1m.classList.remove('open'); loadR2(); }
});

/* ===================== Video list and player ===================== */
const pv = $('#player'), pBtn = $('#p-toggle'), pSeek = $('#p-seek'), pTime = $('#p-time'), pMsg = $('#screen-msg');
let pFile = '';
const clock = s => isFinite(s) ? Math.floor(s / 60) + ':' + p2(Math.floor(s % 60)) : '0:00';
function playVideo(f) { pFile = f; pv.src = fileUrl(path.join(P.video, f)); pv.hidden = false; pMsg.hidden = true; pv.play().catch(() => {}); }
function clearPlayer() { pv.pause(); pv.removeAttribute('src'); pv.load(); pv.hidden = true; pMsg.hidden = false; pFile = ''; pSeek.value = 0; pTime.textContent = '0:00 / 0:00'; setIcon(pBtn, 'i-play'); }
function togglePlay() { if (!pFile) return; if (pv.paused) pv.play(); else pv.pause(); }
pv.onplay = () => setIcon(pBtn, 'i-pause'); pv.onpause = () => setIcon(pBtn, 'i-play');
pv.ontimeupdate = () => { if (pv.duration) pSeek.value = pv.currentTime / pv.duration * 1000; pTime.textContent = `${clock(pv.currentTime)} / ${clock(pv.duration)}`; };
pSeek.oninput = () => { if (pv.duration) pv.currentTime = pSeek.value / 1000 * pv.duration; };
pBtn.onclick = togglePlay;
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !$('#tab-video').checked || $('.modal.open')) return;
  const t = e.target; if ((t.tagName === 'INPUT' && t.type !== 'range') || t.tagName === 'TEXTAREA') return;
  e.preventDefault(); if (t.tagName === 'BUTTON' || t.tagName === 'INPUT') t.blur();
  togglePlay();
});

function renderVideos() {
  const box = $('#list-video');
  let files = [];
  try { files = fs.readdirSync(P.video).filter(f => /\.mp4$/i.test(f) && !/-converted\.mp4$/i.test(f)).sort().reverse(); } catch { /* ignore */ }
  if (!files.length) return note(box, 'No videos yet. Click “+ Add MP4 recording”.');
  box.replaceChildren(...files.map(f => {
    const a = el('article', 'file'), acts = el('div', 'file-acts'), src = path.join(P.video, f);
    acts.append(
      ibtn('i-play', 'Play', () => playVideo(f)),
      ibtn('i-trash', 'Delete', () => confirmBox({
        title: 'Delete this video?', text: f, word: 'DELETE', ok: 'Delete',
        run: async () => { if (pFile === f) clearPlayer(); fs.unlinkSync(src); renderVideos(); }
      })),
      ibtn('i-conv', 'Convert to MP3', () => confirmBox({
        title: 'Convert to MP3?', text: 'The MP3 is saved in your audio folder, and the video moves out of this list.', word: 'CONVERT', ok: 'Convert', cls: 'btn-save',
        run: async setMsg => {
          const base = f.replace(/\.mp4$/i, ''), out = path.join(P.mp3, base + '-converted.mp3');
          if (fs.existsSync(out)) throw new Error(base + '-converted.mp3 already exists.');
          if (pFile === f) clearPlayer();
          const dur = await mediaDuration(fileUrl(src));
          setMsg('Converting… 0%');
          await ff(['-i', src, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', out + '.part'], dur, p => setMsg(`Converting… ${Math.round(p * 100)}%`));
          fs.renameSync(out + '.part', out);
          fs.renameSync(src, path.join(P.video, base + '-converted.mp4'));
          renderVideos(); renderLocal();
        }
      }))
    );
    a.append(el('p', 'file-name', f), acts);
    return a;
  }));
}

/* ===================== Start ===================== */
async function boot() {
  await checkNet();
  if (online) { try { applyConfig(await jget('/api/config')); } catch { /* ignore */ } }
  renderLocal(); renderVideos(); onTab(currentTab());
}
(async () => {
  try { applyConfig(JSON.parse(localStorage.getItem('cfg') || '{}')); } catch { /* ignore */ }
  TOKEN = await ipcRenderer.invoke('auth:load');
  if (!TOKEN) { renderLocal(); renderVideos(); showLogin(); } else boot();
})();
