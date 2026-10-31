'use strict';
const { app, BrowserWindow, Menu, ipcMain, safeStorage, session, powerSaveBlocker, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

/* ---- userData: C:\Users\<you>\AppData\Roaming\GDLC Apps\transcribe-app ----
   Must be set before the app is ready. mkdir (recursive) creates "GDLC Apps" if it is missing. */
const USER = path.join(app.getPath('appData'), 'GDLC Apps', 'transcribe-app');
const DATA = path.join(USER, 'data');
const DIRS = {
  mp3: path.join(DATA, 'mp3-local-files'),
  video: path.join(DATA, 'video-files-local'),
  tmp: path.join(USER, 'tmp')
};
/* turn off the newer capture method */
app.commandLine.appendSwitch('disable-features', 'AllowWgcScreenCapturer,AllowWgcWindowCapturer');
fs.mkdirSync(USER, { recursive: true });
Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));
app.setPath('userData', USER);

const AUTH = path.join(USER, 'auth.json');
const LOCAL = path.join(USER, 'local-login.json');   // scrambled copy of the login, for logging in offline
let win = null;
let busy = null;          // 'Transcribe Live' | 'Audio Recording' | 'Video Recording' | null
let blocker = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

function notifyBlocked() {
  if (win && !win.isDestroyed()) win.webContents.send('app:blocked', busy);
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const OK = ['media', 'display-capture'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(OK.includes(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => OK.includes(permission));

  // Screen recording: share the main screen plus Windows system audio (no picker window)
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });

  win = new BrowserWindow({
    width: 1000,
    height: 700,
    useContentSize: true,      // the page area is exactly 1000 x 700
    resizable: false,
    maximizable: false,
    fullscreenable: false,     // fullscreen button disabled
    minimizable: true,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#FFFEF2',
    title: 'Transcribe | An app built by Gladys Lacia',
    icon: path.join(__dirname, 'transcribe-app-assets', 'gdlcprofilepicture1.jpg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,   // keep recording timers accurate
      spellcheck: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'transcribe.html'));
  win.once('ready-to-show', () => win.show());

  // Stay fixed no matter what
  win.on('maximize', () => win.unmaximize());
  win.on('enter-full-screen', () => win.setFullScreen(false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());

  // Close is refused while something is ongoing (backup for Alt+F4 etc.)
  win.on('close', e => { if (busy) { e.preventDefault(); notifyBlocked(); } });

  // While busy the Minimize and Close buttons are greyed out (see app:busy below).
  // Windows still tells us when someone clicks them, so we can show the warning.
  if (process.platform === 'win32') {
    win.hookWindowMessage(0x00A1, wParam => {            // WM_NCLBUTTONDOWN
      const hit = wParam.readUInt32LE(0);
      if (busy && (hit === 8 || hit === 20)) notifyBlocked(); // 8 = Minimize, 20 = Close
    });
  }
  win.on('closed', () => { win = null; });
}

/* ---- IPC ---- */
ipcMain.handle('app:screen-id', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources[0].id;
});

// Compatibility mode: one screenshot at a time (used only if live screen capture cannot start)
ipcMain.handle('app:screen-shot', async (e, w, h) => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  const img = sources[0] && sources[0].thumbnail;
  return img && !img.isEmpty() ? img.toJPEG(75) : null;
});

ipcMain.on('app:paths', e => { e.returnValue = DIRS; });

ipcMain.on('app:busy', (e, label) => {
  busy = label || null;
  if (busy && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  if (win && !win.isDestroyed()) { win.setMinimizable(!busy); win.setClosable(!busy); }
});

ipcMain.handle('auth:load', () => {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH, 'utf8'));
    const buf = Buffer.from(j.data, 'base64');
    return j.enc ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { return ''; }
});

ipcMain.handle('auth:save', (e, token) => {
  const enc = safeStorage.isEncryptionAvailable();
  const buf = enc ? safeStorage.encryptString(String(token)) : Buffer.from(String(token), 'utf8');
  fs.writeFileSync(AUTH, JSON.stringify({ enc, data: buf.toString('base64') }));
  return true;
});

ipcMain.handle('auth:clear', () => { fs.rmSync(AUTH, { force: true }); return true; });

/* ---- offline login: a scrambled (hashed) copy of the username + password, kept only on this laptop ----
   Windows encrypts the file, so it can only be read from your Windows account. It is created or refreshed after
   every successful online login. Logging out does NOT delete it. */
const scramble = (user, pass, salt) => crypto.pbkdf2Sync(user + '\n' + pass, salt, 210000, 32, 'sha256');

ipcMain.handle('local:save', (e, user, pass) => {
  try {
    const salt = crypto.randomBytes(16);
    const rec = JSON.stringify({ salt: salt.toString('base64'), hash: scramble(String(user), String(pass), salt).toString('base64') });
    const enc = safeStorage.isEncryptionAvailable();
    const buf = enc ? safeStorage.encryptString(rec) : Buffer.from(rec, 'utf8');
    fs.writeFileSync(LOCAL, JSON.stringify({ enc, data: buf.toString('base64') }));
    return true;
  } catch { return false; }
});

// returns 'ok', 'wrong', or 'none' (no saved login on this laptop yet)
ipcMain.handle('local:check', (e, user, pass) => {
  let rec;
  try {
    const j = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
    const buf = Buffer.from(j.data, 'base64');
    rec = JSON.parse(j.enc ? safeStorage.decryptString(buf) : buf.toString('utf8'));
  } catch { return 'none'; }
  const want = Buffer.from(rec.hash, 'base64');
  const got = scramble(String(user), String(pass), Buffer.from(rec.salt, 'base64'));
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? 'ok' : 'wrong';
});
