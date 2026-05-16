# Quick Capture

Quick Capture is a small Electron desktop app for fast voice notes. It sits as a lightweight pill, records speech with `Control+Space`, transcribes audio through OpenAI, and keeps a local history of recent captures.

## Features

- Global `Control+Space` shortcut for starting, stopping, and continuing dictation.
- Electron tray and floating pill UI.
- OpenAI-backed transcription with local browser speech preview while recording.
- Transcript history stored locally in the renderer.
- Copy confirmation with a check state after successful clipboard writes.
- AI cleanup suggestions that show blue click-to-accept edits next to the original transcript.
- Restore Transcript action after cleanup so the original note can be recovered.
- Optional checklist formatting for transcript text.

## Requirements

- macOS, Windows, or Linux with a recent Node.js runtime.
- npm.
- An OpenAI API key for transcription and AI cleanup/checklist features.

The app can be opened in browser dev mode, but full recording, tray, clipboard, and global-shortcut behavior should be tested in Electron.

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env`. You can also override the default models:

```bash
WHISPER_MODEL=whisper-1
OPENAI_CHECKLIST_MODEL=gpt-4o-mini
OPENAI_EDIT_MODEL=gpt-4o-mini
```

Never commit `.env`; it is intentionally ignored.

## Development

Start the Electron app with Vite:

```bash
npm run dev
```

Stop the dev server with `Ctrl+C`.

If macOS Gatekeeper blocks native packages installed under `node_modules`, clear quarantine on the local dependency bundle and retry:

```bash
xattr -dr com.apple.quarantine node_modules/electron node_modules/@rolldown node_modules/fsevents node_modules/lightningcss-darwin-arm64 node_modules/@tailwindcss/oxide-darwin-arm64 node_modules/iconv-corefoundation
```

## Verification

Run the static checks and production build:

```bash
npm run lint
npm run build
```

For a manual smoke test:

1. Run `npm run dev`.
2. Press `Control+Space` or click the microphone.
3. Record a short messy sentence with filler words or poor punctuation.
4. Click `Copy` and verify the icon changes to a check with `Copied`.
5. Click `Clean up` and verify blue suggestions appear beside original text.
6. Click a blue suggestion and verify only that suggestion is accepted.
7. Click `Restore Transcript` and verify the original transcript returns.
8. Verify recording can start and stop again with `Control+Space`.

## Build And Package

Build the renderer and Electron bundles:

```bash
npm run build
```

Create an unpacked desktop build:

```bash
npm run electron:build
```

Create platform packages:

```bash
npm run electron:dist:mac
npm run electron:dist:win
npm run electron:dist:linux
```

Generated output lives in `dist/`, `dist-electron/`, and `release/`; those directories are ignored.

## Project Structure

- `src/` contains the React renderer.
- `src/capture/` contains the capture UI, formatting, history, and cleanup suggestion helpers.
- `electron/` contains the Electron main process, preload bridge, and shared IPC types.
- `public/` and `src/assets/` contain static assets.

## Security

- Keep real API keys in `.env` only.
- Do not commit local recordings, generated desktop builds, or machine-specific artifacts.
- Review AI-suggested transcript edits before accepting them.
