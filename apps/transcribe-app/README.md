# Transcribe

A Windows desktop app for live transcription, audio recording and screen recording, built by Gladys Lacia.

> **Note:** Transcribe is an Electron desktop app, not a website. This folder holds its source code. The page at `https://gladys-lacia.github.io/apps/transcribe-app/transcribe.html` does not run the app. To use it, build it and install it on Windows (see below).

## What it does

The app has three sections, chosen from the sidebar.

### 1. Transcribe Live
- Streams your microphone to the Gemini Live API (default model: `gemini-3.5-transcribe-live`) and shows the transcript as you speak.
- Each finished line is saved to a Cloudflare D1 database, so past sessions appear as cards that you can open, copy or delete.
- A session records in 7-minute segments. After each segment the app waits 8 seconds and restarts the recording automatically.
- Needs an internet connection. When you are offline, this section is covered and disabled.

### 2. Audio Recordings
- Records from the microphone and saves an MP3 (mono, 48 kHz, 64 kbps) on your laptop. One recording runs up to 70 minutes.
- **MP3 Local Files:** play, delete, or upload a file to Cloudflare R2. Uploaded files are renamed with an `-r2` suffix.
- **MP3 Cloudflare Files:** transcribe an uploaded file with Gemini (default model: `gemini-3.5-flash-lite`). The transcript is saved in D1 and the MP3 is then removed from R2.
- Saved transcriptions can be opened, copied or deleted.

### 3. Screen Recordings
- Records the main screen with Windows system audio, your microphone, and your camera as a small picture in the top-right corner.
- Saves an MP4 (720p, 30 FPS, about 2.5 Mbps) on your laptop. One recording runs up to 50 minutes.
- Includes a built-in video player (spacebar plays or pauses).
- Any MP4 can be converted to MP3, which then appears in Audio Recordings.
- Works offline.

### Safety features
- Stopping a recording requires typing `STOP`. Deleting, uploading and converting require typing `DELETE`, `UPLOAD` or `CONVERT`.
- While a recording is ongoing, the window cannot be closed or minimized, and the other sections are locked.
- The window has a fixed size (1000 × 700) and cannot be maximized or made fullscreen.

## How it is put together

| Part | File | Purpose |
| --- | --- | --- |
| Main process | `start-transcribe.js` | Creates the window, screen capture, saved login, offline login check |
| Interface | `transcribe.html` | The app's page |
| Styles | `transcribe-app-assets/transcribe.css` | Layout and colors |
| App logic | `transcribe-app-assets/transcribe.js` | Recording, live streaming, lists, uploads, player |
| Build workspace | `transcribe-app-electronbuild/` | Electron and electron-builder settings |
| Icons | `transcribe-app-assets/` | App icon and favicon |

The app talks to a small Cloudflare Worker, which:
- checks the login and hands out short-lived tokens, so the Gemini API key never reaches the app;
- stores live transcript lines and saved transcriptions in Cloudflare D1;
- stores uploaded MP3 files in Cloudflare R2 until they are transcribed.

The Worker's source is kept on Cloudflare and is not part of this folder.

## Where your files are saved

On your laptop, under `C:\Users\<you>\AppData\Roaming\GDLC Apps\transcribe-app\`:

- `data\mp3-local-files` for audio recordings
- `data\video-files-local` for screen recordings
- `tmp` for raw recordings while they are being converted

## Login

Transcribe uses a single account. After you log in, the app stays signed in for 30 days.

After one successful online login, a salted and hashed copy of your login is saved on the laptop (encrypted by Windows). This lets you log in offline to use the local features. Logging out does not delete it.

## Requirements

- Windows 10 or 11 (64-bit)
- A microphone (camera optional)
- An internet connection for Transcribe Live, uploads and transcription

## Build it yourself

You need Node.js 24 (LTS).

1. Install the build tools:
   ```powershell
   cd transcribe-app-electronbuild
   npm install --save-dev electron electron-builder
   ```
2. Install the app's dependency (`ffmpeg-static`):
   ```powershell
   cd ..
   npm install
   ```
3. Try it without building:
   ```powershell
   npx electron .
   ```
4. Build the Windows app:
   ```powershell
   cd transcribe-app-electronbuild
   $v = node -p "require('./node_modules/electron/package.json').version"
   npx electron-builder --win dir "-c.electronVersion=$v"
   ```
   The result is in `transcribe-app-electronbuild\dist\win-unpacked`.

## Install

Copy everything inside `dist\win-unpacked` to a folder such as `C:\Program Files\GDLC Apps\transcribe-app`, then run `transcribe.exe`.

## Built with

- [Electron](https://www.electronjs.org/) and [electron-builder](https://www.electron.build/)
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) for converting recordings to MP3 and MP4
- Google Gemini (live transcription and file transcription)
- Cloudflare Workers, D1 and R2
