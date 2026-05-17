import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import OpenAI from 'openai'

import type {
  ChecklistPayload,
  ExtractDestinationMode,
  ExtractDestinationPayload,
  ExtractDestinationResult,
  SuggestEditsAiResult,
  SuggestReplacement,
  TranscriptionResult,
} from './shared.js'

/*
 * ESM `import { … } from "electron"` resolves to the npm stub (no exports). CJS require gets the
 * real main-process API — see https://www.electronjs.org/docs/latest/tutorial/esm
 */
const requireElectron = createRequire(import.meta.url)
const {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  systemPreferences,
} = requireElectron('electron') as typeof import('electron')

/*
 * Vite dev must not share the same userData directory as a packaged install, or `npm run dev` loses
 * `requestSingleInstanceLock()` to an already-running .app and exits without a window.
 */
if (process.env.VITE_DEV_SERVER_URL) {
  const base = app.getPath('userData')
  app.setPath('userData', `${base}-vite-dev`)
}

function loadEnvFileIfPresent(filePath: string) {
  let content: string

  try {
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice(7).trimStart() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue

    const key = withoutExport.slice(0, eq).trim()
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = withoutExport.slice(eq + 1).trim()
    value = unquoteEnvValue(value)

    /*
     * Prefer filling gaps: Cursor / shell often export OPENAI_API_KEY="" which is not undefined,
     * so the previous check skipped .env entirely and Whisper kept failing.
     */
    const cur = process.env[key]
    if (cur === undefined || `${cur}`.trim() === ``) process.env[key] = value
  }
}

function unquoteEnvValue(value: string) {
  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      return value.slice(1, -1).replaceAll(`\\${quote}`, quote)
    }
  }

  return value
}

const dirnameResolved =
  typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : path.dirname(fileURLToPath(import.meta.url))

/*
 * Electron often starts with cwd outside the repo (.app bundle, Dock, Spotlight).
 * Load repo-root `.env` first (deterministic relative to bundled main), then cwd so `npm run dev`
 * from a subfolder can still augment without blocking the canonical key when cwd has an empty `.env`.
 */
const envCandidates = Array.from(
  new Set([
    path.resolve(dirnameResolved, '..', '.env'),
    path.join(process.cwd(), '.env'),
  ]),
)

for (const envPath of envCandidates) if (fs.existsSync(envPath)) loadEnvFileIfPresent(envPath)

const dirname = dirnameResolved

function resolvePreloadPath() {
  const candidates = ['preload.mjs', 'preload.js', 'preload.cjs']

  for (const candidateFilename of candidates) {
    const absolutePath = path.join(dirname, candidateFilename)
    if (fs.existsSync(absolutePath)) return absolutePath
  }

  return path.join(dirname, 'preload.mjs')
}

const OPENAI_MODEL = process.env.OPENAI_CHECKLIST_MODEL ?? 'gpt-4o-mini'
const OPENAI_EDIT_MODEL = process.env.OPENAI_EDIT_MODEL ?? 'gpt-4o'

const openaiApiKey = `${process.env.OPENAI_API_KEY ?? ``}`.trim()

function createTrayIcon(): Electron.NativeImage {
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWBAMAAAA2mnDCAAAAHlBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACHf5XUAAAACnRSTlMAERIiMjNEVFdXH6Z8vQAAAABiSURBVBjTdYyxCsMgDEU9ZU9W9V8VJ6cG7QQN4gI6cE9X8QEKJ7bB5cE8V7bB/cE8w7YB8wTzDtgHzBPMOmAfME8z7YB8YD7DtgLzDNsHmGfYBswzbANmGdYC8wzrAXmGdYG8wzpgnmEdMO+wDqh3WQfUO6wDxh26gPEP6wH6Jy4AAAAASUVORK5CYII='

  const png = Buffer.from(data, 'base64')
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  return img
}

let tray: Tray | null = null
let win: BrowserWindow | null = null

/** Bottom-right margin from work area — docked pill (Granola-style). */
const PILL_SCREEN_MARGIN = 24

/** Minimum dimensions for the expanded notes card (user-resizable). */
const OUTPUT_MIN_WIDTH = 320
const OUTPUT_MIN_HEIGHT = 300

/**
 * When the user manually drags a window edge, remember their preferred card size so
 * subsequent pill:resize calls (e.g. phase transitions) don't overwrite it.
 */
let userOutputSize: { width: number; height: number } | null = null

function boundsForTray(width: number, height: number) {
  const { workArea } = screen.getPrimaryDisplay()
  const xPos = Math.round(workArea.x + workArea.width - width - PILL_SCREEN_MARGIN)
  const yPos = Math.round(workArea.y + workArea.height - height - PILL_SCREEN_MARGIN)

  return { x: xPos, y: yPos }
}

/** Allow narrow idle capsule; scratchpadresize IPC supplies full width when needed. */
const MIN_WINDOW_WIDTH = 48
const MIN_WINDOW_HEIGHT = 52

/**
 * Size + place the pill. Anchored to the bottom-right of the primary display work area
 * (Granola-style) so narrow ↔ wide transitions stay flush to the right edge.
 */
function repositionWindow(width: number, height: number) {
  const windowRef = win
  if (!windowRef) return
  const targetWidth = Math.max(Math.round(width), MIN_WINDOW_WIDTH)
  const targetHeight = Math.max(Math.round(height), MIN_WINDOW_HEIGHT)
  const { workArea } = screen.getPrimaryDisplay()

  const xPos = Math.round(workArea.x + workArea.width - targetWidth - PILL_SCREEN_MARGIN)
  const yPos = Math.round(workArea.y + workArea.height - targetHeight - PILL_SCREEN_MARGIN)

  windowRef.setBounds({
    x: xPos,
    y: yPos,
    width: targetWidth,
    height: targetHeight,
  }, process.platform === 'darwin')
  windowRef.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
}

function showPill() {
  const w = win
  if (!w) return
  repositionWindow(Math.max(w.getContentSize()[0], MIN_WINDOW_WIDTH), Math.max(w.getContentSize()[1], 76))

  w.show()
  w.focus()
}

/**
 * Single entry point for both the keyboard shortcut and tray click.
 * Sends pill:toggle — the renderer starts recording if idle, stops if recording.
 */
function toggleRecording() {
  showPill()
  win?.webContents.send('pill:toggle')
}

function registerShortcuts() {
  globalShortcut.unregisterAll()
  globalShortcut.register('Control+Space', toggleRecording)
}

function applyReplacementSuggestionsPlain(basePlain: string, replacements: SuggestReplacement[]) {
  const cleaned = replacements.filter((r) => r.old.length > 0 && r.old !== r.new)
  const spans: { start: number; end: number; new: string }[] = []

  for (const rep of cleaned) {
    const idx = basePlain.indexOf(rep.old)

    if (idx < 0) return null
    if (basePlain.indexOf(rep.old, idx + rep.old.length) >= 0) return null

    spans.push({
      start: idx,
      end: idx + rep.old.length,
      new: rep.new,
    })
  }

  if (!cleaned.length) return basePlain

  spans.sort((a, b) => a.start - b.start)

  for (let idx = 1; idx < spans.length; idx += 1)
    if (spans[idx]!.start < spans[idx - 1]!.end) return null

  let out = ``
  let cur = 0

  for (const span of spans) {
    out += basePlain.slice(cur, span.start) + span.new
    cur = span.end
  }

  return out + basePlain.slice(cur)
}

function attachWindowSizingOnce() {
  ipcMain.handle('pill:resize', (_, size: { width: number; height: number }) => {
    const horizontalPad = 8
    const verticalPad = 16
    const requestedWidth  = Math.ceil(size.width  ?? 264) + horizontalPad
    const requestedHeight = Math.ceil(size.height ?? 56)  + verticalPad

    const isOutputCard = requestedWidth > 200

    if (!isOutputCard) {
      // Returning to idle pill — clear custom size, lock down resizing
      userOutputSize = null
      win?.setResizable(false)
      win?.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
      repositionWindow(requestedWidth, requestedHeight)
    } else if (userOutputSize) {
      // User has a preferred card size — keep it, just re-anchor to bottom-right
      win?.setResizable(true)
      win?.setMinimumSize(OUTPUT_MIN_WIDTH, OUTPUT_MIN_HEIGHT)
      repositionWindow(userOutputSize.width, userOutputSize.height)
    } else {
      // First open of the output card — use the default dimensions
      win?.setResizable(true)
      win?.setMinimumSize(OUTPUT_MIN_WIDTH, OUTPUT_MIN_HEIGHT)
      repositionWindow(requestedWidth, requestedHeight)
    }

    return true
  })
}

function extensionFromRecordingMime(mime: string): string {
  const m = mime.split(`;`)[0]?.trim().toLowerCase() ?? `audio/webm`

  if (m.includes(`webm`)) return `webm`
  if (m === `audio/m4a` || m.endsWith(`/x-m4a`)) return `m4a`
  // audio/mp4 from macOS MediaRecorder is a proper AAC-in-M4A container; use .m4a
  // so Whisper treats it as audio rather than a video mp4 file
  if (m === `audio/mp4` || m.includes(`mp4;`) || m.endsWith(`/mp4`)) return `m4a`
  if (m === `audio/aac`) return `mp4`
  if (m.includes(`ogg`)) return `ogg`
  if (m.includes(`wav`) || m.endsWith(`/x-wav`)) return `wav`
  if (m.includes(`mpeg`) || m.endsWith(`/mp3`) || m === `audio/mp3`) return `mpeg`
  if (m.includes(`flac`)) return `flac`
  if (m.includes(`mpga`)) return `mpga`

  return `webm`
}

async function whisperTranscribe(base64Payload: string, mime: string): Promise<TranscriptionResult> {
  const missingKey = {
    ok: false as const,
    code: `MISSING_API_KEY` as const,
    message: `Add OPENAI_API_KEY to a repo-root .env (see .env.example), then restart the app.`,
  }

  if (!openaiApiKey) return missingKey

  try {
    const trimmedPayload = `${base64Payload ?? ``}`.trim()
    const buffer = Buffer.from(base64Payload, `base64`)

    if (!buffer.byteLength || trimmedPayload.length < 8)
      return { ok: false, code: `BAD_AUDIO_PAYLOAD`, message: `Audio payload missing or corrupted.` }

    const extension = extensionFromRecordingMime(mime)
    const tempFile = path.join(os.tmpdir(), `qc-whisper-${process.pid}-${Date.now()}.${extension}`)
    await fs.promises.writeFile(tempFile, buffer)

    try {
      const client = new OpenAI({ apiKey: openaiApiKey })
      const model = process.env.WHISPER_MODEL ?? `whisper-1`
      let lastError: unknown

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const transcription = await client.audio.transcriptions.create({
            model,
            file: fs.createReadStream(tempFile),
          })

          const raw =
            typeof transcription === `string` ?
              transcription
            : ((transcription as { text?: string }).text ?? ``)

          return { ok: true, text: `${raw}`.trim() }
        } catch (e) {
          lastError = e
          console.warn(`[quick-capture] Whisper attempt ${attempt + 1} failed:`, e)
          if (attempt < 1) await new Promise((r) => setTimeout(r, 450))
        }
      }

      const fallbackMsg =
        lastError instanceof Error ? lastError.message : typeof lastError === `string` ? lastError : `Unknown error`

      return { ok: false, code: `TRANSCRIBE_FAILED`, message: fallbackMsg.slice(0, 480) }
    } finally {
      await fs.promises.unlink(tempFile).catch(() => null)
    }
  } catch (e) {
    console.warn(`[quick-capture] Whisper transport failed:`, e)

    return {
      ok: false,
      code: `TRANSCRIBE_FAILED`,
      message: e instanceof Error ? e.message.slice(0, 480) : undefined,
    }
  }
}

async function suggestEditsViaOpenAi(raw: string): Promise<SuggestEditsAiResult> {
  const trimmed = raw.trim()
  if (!trimmed.length)
    return { ok: false, code: `EMPTY_TEXT`, message: `Nothing left to polish in this note.` }

  const missingKey: SuggestEditsAiResult = {
    ok: false,
    code: `MISSING_API_KEY`,
    message: `Add OPENAI_API_KEY to .env — see .env.example.`,
  }

  if (!openaiApiKey) return missingKey

  try {
    const client = new OpenAI({ apiKey: openaiApiKey })

    const response = await client.chat.completions.create({
      model: OPENAI_EDIT_MODEL,
      temperature: 0.15,
      response_format: { type: `json_object` },
      messages: [
        {
          role: `system`,
          content: `You conservatively correct voice-to-text transcription mistakes.
Respond ONLY JSON: {"cleanedText":"<full improved transcript>","replacements":[{"old":"<exact verbatim substring from input>","new":"<improved text>"}], "summary":""}.
Rules:
- Each "old" MUST match the input EXACTLY (verbatim, including spaces) and appear ONLY ONCE.
- Preserve the speaker's wording, meaning, tone, language, and facts.
- Only fix punctuation, capitalization, obvious speech-to-text homophones, duplicated words, and clear grammar/transcription errors.
- Do NOT rewrite for style, improve word choice, summarize, translate, add details, remove profanity, or make the speaker sound more polished.
- Prefer small replacements. Replace larger spans only when the original text is clearly a transcription error.
- If nothing needs changing, emit {"cleanedText":"<original input>","replacements":[],"summary":"Already clear."}.
- Cap at 24 replacements.`,
        },
        {
          role: `user`,
          content: trimmed,
        },
      ],
    })

    const message = response.choices.at(0)?.message?.content
    if (!message)
      return { ok: false, code: `BAD_RESPONSE`, message: `No response body from completion.` }

    const parsed =
      JSON.parse(message) as {
        cleanedText?: unknown
        replacements?: unknown
        summary?: unknown
      }

    const unknownList = parsed.replacements
    if (!Array.isArray(unknownList))
      return { ok: false, code: `BAD_RESPONSE`, message: `Model JSON missing replacements array.` }

    const replacements: SuggestReplacement[] = []

    for (const entry of unknownList.slice(0, 32)) {
      if (!entry || typeof entry !== `object`) continue

      const rec = entry as Record<string, unknown>
      const oldText = `${rec.old ?? ``}`
      const newText = `${rec.new ?? ``}`

      if (!oldText.length || oldText === newText || oldText.length > 8192 || newText.length > 8192)
        continue

      replacements.push({ old: oldText, new: newText })
    }

    const summaryParsed = `${parsed.summary ?? ``}`.trim()
    const cleanedTextParsed = `${parsed.cleanedText ?? ``}`.trim()
    const cleanedText =
      cleanedTextParsed ||
      applyReplacementSuggestionsPlain(trimmed, replacements)?.trim() ||
      trimmed

    return {
      ok: true,
      replacements,
      cleanedText,
      summary: summaryParsed.length ? summaryParsed : undefined,
    }
  } catch (e) {
    console.warn('[quick-capture] suggest-edits failed:', e)

    return {
      ok: false,
      code: `BAD_RESPONSE`,
      message: e instanceof Error ? e.message.slice(0, 480) : undefined,
    }
  }
}

async function formatChecklistViaOpenAi(raw: string): Promise<ChecklistPayload> {
  const fallbackChunks = raw.split(/[\r\n.;]+/)

  const fallback: ChecklistPayload = {
    items: fallbackChunks
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50)
      .map((text) => ({ text, checked: false })),
  }

  const trimmed = raw.trim()
  if (!trimmed.length) return { items: [] }

  if (!openaiApiKey) return fallback

  try {
    const client = new OpenAI({ apiKey: openaiApiKey })

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract actionable tasks from voice transcripts.
Respond ONLY JSON: {"items":[{"text":"<imperative line>","checked":false}]} 
Rules:
- Preserve the transcript language. Do not translate.
- Extract only explicit or strongly implied actionable items.
- Do not turn general thoughts, observations, questions, or narration into tasks.
- Keep task text short and useful, but do not invent missing details.
- Return {"items":[]} when there are no actionable tasks.
- Return at most 50 tasks.`,
        },
        {
          role: 'user',
          content: trimmed,
        },
      ],
    })

    const message = response.choices.at(0)?.message?.content
    if (!message) return fallback

    const parsed = JSON.parse(message) as { items?: unknown }
    const itemsUnknown = parsed.items ?? []

    if (!Array.isArray(itemsUnknown)) return fallback

    const items = itemsUnknown
      .filter((entry): entry is { text?: string } => !!entry && typeof entry === 'object')
      .map((entry, index) => ({
        text: String(entry?.text ?? `Task ${index + 1}`).trim(),
        checked: false,
      }))
      .filter((item) => item.text.length > 0)
      .slice(0, 50)

    if (!items.length) return { items: [] }
    return { items }
  } catch (e) {
    console.warn('[quick-capture] GPT formatting failed:', e)
    return fallback
  }
}

function fallbackDestination(mode: ExtractDestinationMode, raw: string): ExtractDestinationResult {
  const trimmed = raw.trim()
  if (!trimmed.length) return { ok: false, code: 'EMPTY_TEXT', message: 'Nothing to move.' }

  if (mode === 'tasks') {
    const tasks = trimmed
      .split(/[\r\n.;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50)
      .map((text) => ({ text }))

    return { ok: true, mode, tasks: tasks.length ? tasks : [{ text: trimmed }] }
  }

  if (mode === 'ideas') {
    return { ok: true, mode, ideas: [{ text: trimmed }] }
  }

  return {
    ok: true,
    mode,
    reminders: [{ text: trimmed, needsDateTime: true }],
  }
}

function destinationPrompt(mode: ExtractDestinationMode) {
  if (mode === 'tasks') {
    return `Extract actionable tasks from a voice transcript.
Respond ONLY JSON: {"tasks":[{"text":"<short task>"}],"summary":""}
Rules:
- Preserve the transcript language. Do not translate.
- Extract only explicit or strongly implied actionable items.
- Do not turn general thoughts, observations, questions, or narration into tasks.
- Keep task text short and useful, but do not invent missing details.
- Return {"tasks":[]} when there are no actionable tasks.
- Return at most 50 tasks.`
  }

  if (mode === 'ideas') {
    return `Extract ideas from a voice transcript.
Respond ONLY JSON: {"ideas":[{"title":"<optional short title>","text":"<idea>"}],"summary":""}
Rules:
- Preserve the transcript language, sentiment, and personal voice.
- Lightly tidy grammar and punctuation only when it improves readability.
- Do not transform the idea into marketing copy, a task, or a summary.
- Split distinct ideas only when the transcript clearly contains more than one.
- Return {"ideas":[]} when no idea is present.
- Return at most 20 ideas.`
  }

  return `Extract reminder candidates from a voice transcript.
Respond ONLY JSON: {"reminders":[{"text":"<reminder>","dateText":"<YYYY-MM-DD if known>","timeText":"<HH:mm if known>","scheduledAt":"<ISO if fully known>","needsDateTime":true}],"summary":""}
Rules:
- Preserve the transcript language. Do not translate.
- Extract only explicit or strongly implied reminders/follow-ups.
- Use the provided current date/time context to resolve relative dates when clear.
- If date or time is missing or ambiguous, leave missing fields blank and set needsDateTime true.
- Do not invent dates, times, or details.
- Return {"reminders":[]} when no reminder is present.
- Return at most 20 reminders.`
}

async function extractDestinationViaOpenAi(
  payload: ExtractDestinationPayload,
): Promise<ExtractDestinationResult> {
  const mode = payload.mode
  const trimmed = `${payload.text ?? ''}`.trim()

  if (!trimmed.length) return { ok: false, code: 'EMPTY_TEXT', message: 'Nothing to move.' }
  if (mode !== 'tasks' && mode !== 'ideas' && mode !== 'reminders')
    return { ok: false, code: 'BAD_RESPONSE', message: 'Unsupported destination.' }

  const fallback = fallbackDestination(mode, trimmed)
  if (!openaiApiKey) return fallback

  try {
    const client = new OpenAI({ apiKey: openaiApiKey })

    const response = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: mode === 'ideas' ? 0.25 : 0.15,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: destinationPrompt(mode),
        },
        {
          role: 'user',
          content: `Current date/time: ${payload.nowIso || new Date().toISOString()}\n\nTranscript:\n${trimmed}`,
        },
      ],
    })

    const message = response.choices.at(0)?.message?.content
    if (!message) return fallback

    const parsed = JSON.parse(message) as Record<string, unknown>
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length ?
      parsed.summary.trim()
    : undefined

    if (mode === 'tasks') {
      const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
      const tasks = rawTasks
        .filter((entry): entry is { text?: string } => !!entry && typeof entry === 'object')
        .map(entry => ({ text: `${entry.text ?? ''}`.trim() }))
        .filter(item => item.text.length)
        .slice(0, 50)

      return { ok: true, mode, tasks, ...(summary ? { summary } : {}) }
    }

    if (mode === 'ideas') {
      const rawIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : []
      const ideas = rawIdeas
        .filter((entry): entry is { title?: string; text?: string } => !!entry && typeof entry === 'object')
        .map(entry => {
          const title = `${entry.title ?? ''}`.trim()
          return {
            ...(title ? { title } : {}),
            text: `${entry.text ?? ''}`.trim(),
          }
        })
        .filter(item => item.text.length)
        .slice(0, 20)

      return { ok: true, mode, ideas, ...(summary ? { summary } : {}) }
    }

    const rawReminders = Array.isArray(parsed.reminders) ? parsed.reminders : []
    const reminders = rawReminders
      .filter((entry): entry is {
        text?: string
        scheduledAt?: string
        dateText?: string
        timeText?: string
        needsDateTime?: boolean
      } => !!entry && typeof entry === 'object')
      .map(entry => {
        const scheduledAt = `${entry.scheduledAt ?? ''}`.trim()
        const dateText = `${entry.dateText ?? ''}`.trim()
        const timeText = `${entry.timeText ?? ''}`.trim()
        return {
          text: `${entry.text ?? ''}`.trim(),
          ...(scheduledAt ? { scheduledAt } : {}),
          ...(dateText ? { dateText } : {}),
          ...(timeText ? { timeText } : {}),
          needsDateTime: Boolean(entry.needsDateTime) || !scheduledAt,
        }
      })
      .filter(item => item.text.length)
      .slice(0, 20)

    return { ok: true, mode, reminders, ...(summary ? { summary } : {}) }
  } catch (e) {
    console.warn('[quick-capture] destination extraction failed:', e)
    return fallback
  }
}

function prefersDarkViaSystemTheme() {
  try {
    if (process.platform === 'darwin')
      /* Electron mirrors macOS Appearance */
      return { prefersDark: systemPreferences.shouldUseDarkColors ?? true }

    return { prefersDark: true }
  } catch {
    return { prefersDark: true }
  }
}

ipcMain.handle('pill:theme-info', prefersDarkViaSystemTheme)

function attachIpcOnce() {
  ipcMain.handle('pill:show', async () => {
    showPill()
    return true
  })

  ipcMain.handle('pill:hide', () => {
    win?.hide()
    return true
  })

  ipcMain.handle('pill:minimize', () => {
    win?.minimize()
    return true
  })

  ipcMain.handle(
    'openai:format-checklist',
    async (_evt, transcript: string): Promise<ChecklistPayload> => formatChecklistViaOpenAi(transcript ?? ''),
  )

  ipcMain.handle(
    'openai:extract-destination',
    async (_evt, payload: ExtractDestinationPayload): Promise<ExtractDestinationResult> =>
      extractDestinationViaOpenAi(payload),
  )

  ipcMain.handle(
    'openai:transcribe',
    async (_evt, args: { data?: string; mime?: string }) => whisperTranscribe(args?.data ?? '', args?.mime ?? 'audio/webm'),
  )

  ipcMain.handle(
    'openai:suggest-edits',
    async (_evt, payload: { text?: string }): Promise<SuggestEditsAiResult> =>
      suggestEditsViaOpenAi(payload?.text ?? ''),
  )

  ipcMain.handle('pill:clipboard', (_evt, text: string) => {
    clipboard.writeText(text ?? '')
    return true
  })

  ipcMain.handle('pill:quit', () => {
    globalShortcut.unregisterAll()
    app.quit()
    return true
  })
}

attachWindowSizingOnce()
attachIpcOnce()

function createWindow() {
  const initialBounds = boundsForTray(392, 480)

  win = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: 392,
    height: 460,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,   // starts locked; unlocked when output card opens
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    maximizable: false,
    fullscreen: false,
    alwaysOnTop: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  /*
   * macOS Spaces & Stage Manager visibility.
   */
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  /*
   * Track manual user resizes so we don't override their preferred card size.
   * Only save when the window is large (output card open), not during idle pill.
   */
  win.on('will-resize', (_event, newBounds) => {
    if (newBounds.width > 200) {
      userOutputSize = { width: newBounds.width, height: newBounds.height }
    }
  })

  /*
   * Preload attaches `window.pill`; devtools gated so production stays serene.
   */
  if (!app.isPackaged && process.env.QUICK_CAPTURE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })

  if (process.env.VITE_DEV_SERVER_URL) void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void win.loadFile(path.join(dirname, '..', 'dist', 'index.html'))
}

// Prevent multiple instances — if one is already running, focus it and quit the new one.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // A second launch attempt — bring the existing window to focus instead.
    if (win) {
      if (!win.isVisible()) showPill()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    /*
     * Accessory-ish UX when installed: hide Dock clutter. Keep Dock during `npm run dev` so Electron
     * is easy to Cmd-Tab/switch-to while iterating.
     */
    if (process.platform === 'darwin' && app.dock && app.isPackaged) app.dock.hide()

    createWindow()

    tray = new Tray(createTrayIcon())
    tray.setToolTip('Quick Capture')
    tray.on('click', () => toggleRecording())

    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Start / Stop Recording',
          accelerator: 'Control+Space',
          click: () => toggleRecording(),
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Control+Q',
          click: () => app.quit(),
        },
      ]),
    )

    repositionWindow(392, 460)
    registerShortcuts()

    // Show the idle pill automatically on launch (after renderer has loaded)
    win?.webContents.once('did-finish-load', () => {
      setTimeout(() => showPill(), 120)
    })
  })
}

app.on('before-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', (event) => {
  /* Prevent quitting on window close — tray persists */
  event.preventDefault()
})
