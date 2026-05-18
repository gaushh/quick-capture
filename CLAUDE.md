# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Product Is

**Quick Capture** is a floating Electron desktop app for voice-first note-taking. It lives as a small pill anchored to the bottom-right of the screen. Press `Control+Space` to record — speech is transcribed via OpenAI Whisper, then the user can Tidy, Refine (AI-tracked edits), Copy, or move the transcript into one of three derived panels: **Tasks**, **Ideas**, or **Reminders**.

The UI has three distinct phases:
- **idle** — a narrow pill (124×38px) showing a notes icon and mic button
- **recording** — an embedded card (52px tall) with a live waveform and transcription in progress
- **output** — a full card (480×520px, user-resizable) with the transcript feed, left-rail panel navigation, and action buttons

All user data (transcript history, tasks, ideas, reminders) lives in **localStorage** in the renderer — there is no backend database.

---

## Commands

```bash
# Install
npm install

# Dev (Electron + Vite hot reload)
npm run dev

# Type-check only (no emit)
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build

# Package (unpacked)
npm run electron:build

# Distribute
npm run electron:dist:mac
npm run electron:dist:win
npm run electron:dist:linux
```

> `npm run dev` requires `.env` with `OPENAI_API_KEY`. Copy `.env.example` to get started.
> If macOS Gatekeeper blocks native packages: `xattr -dr com.apple.quarantine node_modules/electron node_modules/@rolldown node_modules/fsevents node_modules/lightningcss-darwin-arm64 node_modules/@tailwindcss/oxide-darwin-arm64 node_modules/iconv-corefoundation`

---

## Architecture

### Process Boundary

```
electron/main.ts          — Electron main process
  └── ipcMain.handle(...)   Whisper transcription, GPT edits, clipboard, window sizing
electron/preload.ts       — contextBridge exposes window.pill (PillApi) to renderer
electron/shared.ts        — TypeScript types shared across the boundary (no runtime code)

src/capture/QuickCapture.tsx  — entire renderer UI (~3000 lines, single component tree)
src/capture/captureHistory.ts — localStorage read/write for history + derived items
src/capture/constants.ts      — phase dimensions (WIDTH_BY_PHASE, HEIGHT_BY_PHASE)
src/capture/format.ts         — blob→base64, error summarisation helpers
src/index.css                 — all styles (CSS variables, no CSS modules)
```

### IPC surface (`window.pill`)

The renderer calls these via `window.pill` (typed as `PillApi` in `electron/preload.ts`):

| Method | IPC channel | What it does |
|--------|------------|--------------|
| `transcribeBlob` | `openai:transcribe` | Whisper transcription — base64 audio + mime → text |
| `suggestEdits` | `openai:suggest-edits` | GPT edit suggestions → `{replacements[], cleanedText}` |
| `extractDestination` | `openai:extract-destination` | Extract tasks/ideas/reminders from a transcript |
| `formatChecklist` | `openai:format-checklist` | Format transcript as checklist items |
| `resize` | `pill:resize` | Tell main process to resize/reposition the window |
| `copyText` | `pill:clipboard` | Write text to system clipboard |
| `onToggle` | `pill:toggle` (push) | Main → renderer: `Control+Space` was pressed |

### Data Layer (`captureHistory.ts`)

Three localStorage keys:
- `quick-capture-transcript-history` — `CaptureHistoryRow[]` (transcript feed)
- `quick-capture-derived-items` — `CaptureDerivedItems` (tasks, ideas, reminders)
- `quick-capture-task-inbox` — legacy standalone tasks (migrated on first load)

Key types:
- `CaptureHistoryRow` — `{ id, at, text, silent, tasks?, movedTo? }`
- `CaptureDerivedTask` — includes `status: TaskStatus` (`todo | in_progress | done`) and `checked` (derived from status)
- `MoveDestination` / `TaskStatus` — exported from `captureHistory.ts`

### Window Sizing

The shell `<section>` fills the window dynamically in output mode:
```tsx
const shellWidth  = isOutputMode ? windowSize.w - SHELL_PADDING : widthPx
const shellHeight = isOutputMode ? windowSize.h - SHELL_PADDING : heightPx
```
`repositionWindow()` in `main.ts` anchors the window to the bottom-right of the work area. `userOutputSize` remembers manual resize drags so phase transitions don't overwrite them.

### Modal Portaling

`MoveReviewModal` portals to `shellEl` (the shell `<section>` ref) using `position: absolute` — this keeps the overlay within the app boundary. Tooltips (`TooltipEl`) portal to `document.body`.

The `TaskStatusPicker` popover portals to `document.body` with `position: fixed` + `getBoundingClientRect()` coordinates — this lets it escape `overflow: hidden` containers like the modal sheet.

---

## Key UI Decisions Made

- **Left rail** (notes/tasks/ideas/reminders) is always visible, including during selection mode.
- **Transcripts are read-only** — `PastEntryText` renders plain `<p>` tags. The only `contentEditable` surface is the tracked-changes diff during Refine mode.
- **Tidy** = silent direct apply of `cleanedText` (no diff shown). **Refine** = shows tracked additions/deletions for user review.
- **Move to** flow: opens `MoveReviewModal` → user reviews/edits drafts → `acceptMoveReview` saves to derived items and stamps `movedTo` on the history row. The feed then shows a clickable badge (Tasks/Ideas/Reminders) instead of the move button.
- **Task status** (`todo | in_progress | done`) replaces the old boolean `checked`. The `checked` field is kept for backward compatibility and derived as `status === 'done'`.
- **Toast acknowledgements** (`showFeedAcknowledgement`) fire on all mutating actions: add task, toggle status, remove, delete notes, move, tidy, copy.
- **Silent transcript detection** uses `classifySilentTranscript` (keyword hints + a Whisper hallucination set). Silents are never added to history.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | Required for all AI features |
| `WHISPER_MODEL` | `whisper-1` | Transcription model |
| `OPENAI_CHECKLIST_MODEL` | `gpt-4o-mini` | Checklist formatting |
| `OPENAI_EDIT_MODEL` | `gpt-4o` | Suggest edits / extract destination |
