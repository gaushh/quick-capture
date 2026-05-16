import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'

import { browserDemoUiMockActive } from './browserDemo.ts'
import {
  HEIGHT_BY_PHASE,
  SPRING_TRANSITION,
  WIDTH_BY_PHASE,
  type PhaseKind,
} from './constants.ts'
import {
  addCaptureHistoryEntry,
  BUCKET_LABEL,
  bucketForTimestamp,
  classifySilentTranscript,
  formatHistoryTime,
  loadCaptureHistory,
  saveCaptureHistory,
  updateCaptureHistoryById,
  type CaptureHistoryRow,
} from './captureHistory.ts'
import { blobToBase64, summarizeError } from './format.ts'
import { applySuggestReplacements, applyWholeTextSuggestion } from './suggestApply.ts'
import {
  applyAppearanceToDocument,
  getStoredAppearance,
  type QcAppearance,
  setStoredAppearance,
} from '../theme.ts'

/* eslint-disable react-hooks/exhaustive-deps */

const SILENT_HISTORY_PREVIEW = `Recording was silent. Click here to re-transcribe.`

function mergeNoteContinue(base: string, addition: string) {
  const a = base.trimEnd()
  const b = addition.trim()

  if (!a.length) return b
  if (!b.length) return a

  return `${a} ${b}`
}

function nowMs() {
  return Date.now()
}

function trackedNoteAcceptedPlain(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement

  clone.querySelectorAll(`.qc-ai-add`).forEach((el) => el.remove())
  clone.querySelectorAll(`.qc-ai-del`).forEach((el) => {
    el.replaceWith(document.createTextNode(el.textContent ?? ``))
  })

  return `${clone.textContent ?? ``}`.replace(/\u00a0/g, ` `).trim()
}

/** Resolve click on `.qc-ai-add`: keep wording as plain text, drop paired `.qc-ai-del` to its left (whitespace only between). */
function acceptTrackedAdditionAtPointer(root: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Node) || !root.contains(target)) return false

  const startEl = target instanceof Element ? target : target.parentElement
  const hit = startEl?.closest?.(`span.qc-ai-add`) ?? null

  if (!hit || !root.contains(hit)) return false

  let cur: ChildNode | null = hit.previousSibling

  while (cur) {
    if (cur.nodeType === Node.TEXT_NODE) {
      const t = cur.textContent ?? ``

      if (t.trim() !== ``) break
      cur = cur.previousSibling
      continue
    }

    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement

      if (el.classList.contains(`qc-ai-del`)) {
        el.remove()
        break
      }
      break
    }

    break
  }

  const phrase = hit.textContent ?? ``
  const plain = document.createTextNode(phrase)

  hit.replaceWith(plain)

  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()

    r.setStartAfter(plain)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }

  return true
}

/** e.g. `8:39 AM · Today` (matches transcript list design). */
function formatFeedEntryStamp(at: number) {
  try {
    const bucket = bucketForTimestamp(at)
    const time = formatHistoryTime(at)
    return `${time} · ${BUCKET_LABEL[bucket]}`
  } catch {
    return ``
  }
}

/** Latest row: show `now · Today` briefly, then calendar-style stamp. */
function formatLiveFeedStamp(at: number, nowMs: number) {
  const age = nowMs - at
  const bucket = bucketForTimestamp(at)
  const dayPart = BUCKET_LABEL[bucket]
  if (age < 75_000) return `now · ${dayPart}`
  return formatFeedEntryStamp(at)
}

/** Clamp feed body to 3 lines with native `…`; click text to expand accordion-style. */
function FeedClampText({
  text,
  className,
  style,
}: {
  text: string
  className: string
  style?: CSSProperties
}) {
  const [expanded, setExpanded] = useState(false)
  const [clampable, setClampable] = useState(false)
  const paragraphRef = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = paragraphRef.current
    if (!el || text.trim().length === 0) {
      setClampable(false)
      setExpanded(false)
      return
    }
    if (expanded) return
    // With -webkit-line-clamp the browser clips rendering; scrollHeight still reflects full height
    setClampable(el.scrollHeight > el.clientHeight + 2)
  }, [text, expanded])

  return (
    <div className="qc-feed-truncate-slot">
      <p
        ref={paragraphRef}
        className={`${!expanded ? `qc-feed-line-clamp-3` : ``} ${className}`.trim()}
        style={style}
        onClick={clampable && !expanded ? (e) => { e.stopPropagation(); setExpanded(true) } : undefined}
      >
        {text}
      </p>
      {clampable && expanded && (
        <button
          type="button"
          className="qc-feed-expand-link"
          onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
          aria-expanded={true}
        >
          Show less
        </button>
      )}
    </div>
  )
}

/**
 * Past-entry text: collapsed = 3-line clamp with `…` (click to expand accordion-style),
 * expanded = full text as contentEditable. Saves on blur.
 */
function PastEntryText({
  row,
  onSave,
}: {
  row: { id: string; text: string; silent: boolean }
  onSave: (newText: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [clampable, setClampable] = useState(false)
  const measureRef = useRef<HTMLParagraphElement>(null)
  const editRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el || !row.text.trim()) { setClampable(false); return }
    if (expanded) return
    setClampable(el.scrollHeight > el.clientHeight + 2)
  }, [row.text, expanded])

  // Auto-focus editable div and move cursor to end when expanded
  useEffect(() => {
    if (!expanded) return
    const el = editRef.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }, [expanded])

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText
    if (newText.trim() !== row.text.trim()) onSave(newText)
  }

  return (
    <div className="qc-feed-truncate-slot">
      {/* Collapsed: always apply clamp — scrollHeight vs clientHeight detects actual overflow */}
      {!expanded && (
        <p
          ref={measureRef}
          className="qc-feed-past-text qc-feed-body-text whitespace-pre-wrap qc-feed-line-clamp-3"
          style={{ cursor: `pointer` }}
          onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
        >
          {row.text}
        </p>
      )}

      {/* Expanded: full contentEditable + optional "Show less" */}
      {expanded && (
        <>
          <div
            ref={editRef}
            role="textbox"
            aria-multiline={true}
            aria-label="Note text"
            contentEditable={!row.silent}
            suppressContentEditableWarning={true}
            spellCheck={true}
            className="qc-feed-past-text qc-feed-body-text qc-feed-past-editable whitespace-pre-wrap"
            onBlur={handleBlur}
            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === `Escape`) { e.preventDefault(); e.currentTarget.blur(); setExpanded(false) }
            }}
            dangerouslySetInnerHTML={{ __html: row.text }}
          />
          {clampable && (
            <button
              type="button"
              className="qc-feed-expand-link"
              onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
            >
              Show less
            </button>
          )}
        </>
      )}
    </div>
  )
}


/** "Improve note" sparkle */
function ImproveIconOutline({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.76 7.76L21 13l-7.24 2.24L12 23l-1.76-7.76L3 13l7.24-2.24L12 3z" />
    </svg>
  )
}

/** Sheet / notes — idle pill primary control */
function NotesIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.55} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

/** Title-bar style minimize (floating window chrome). */
function WindowMinimizeIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M6 14h12" />
    </svg>
  )
}

/** Dismiss overlay (hides pill; same behaviour as ESC). */
function WindowCloseIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  )
}

function XIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function UndoIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10h11a5 5 0 010 10H9" />
      <path d="M3 10l4-4M3 10l4 4" />
    </svg>
  )
}

function MoonIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

export function QuickCapture() {
  const shellRef = useRef<HTMLElement | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recorderMimeRef = useRef<string>('')
  const chunkPartsRef = useRef<BlobPart[]>([])
  const speechRef = useRef<SpeechRecognition | null>(null)
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const audioRafRef = useRef<number | null>(null)
  const latestCopyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [appearance, setAppearance] = useState<QcAppearance>(() => getStoredAppearance())
  const phaseRef = useRef<PhaseKind>('idle')
  const transcriptionGenRef = useRef(0)

  const [phase, setPhase] = useState<PhaseKind>('idle')
  const [historyRows, setHistoryRows] = useState<CaptureHistoryRow[]>(() => loadCaptureHistory())
  const [liveText, setLiveText] = useState('')
  const [finalText, setFinalText] = useState('')
  const finalTextRef = useRef(finalText)
  const [isProcessingWhisper, setIsProcessingWhisper] = useState(false)
  const [notePresentationMode, setNotePresentationMode] = useState<'plain' | 'tracked'>(`plain`)
  const [trackedNoteSession, setTrackedNoteSession] = useState(0)
  const [trackedOriginalTranscript, setTrackedOriginalTranscript] = useState<string | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [noteCapturedAt, setNoteCapturedAt] = useState<number | null>(null)
  /** Drives `now · …` → clock time in the feed without calling `Date.now()` during render. */
  const [feedStampNowMs, setFeedStampNowMs] = useState(() => nowMs())
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false)
  const [aiSuggestBanner, setAiSuggestBanner] = useState<string | null>(null)
  const [outputMode, setOutputMode] = useState<'note' | 'checklist'>('note')
  const [checklistItems, setChecklistItems] = useState<{ text: string; checked: boolean }[]>([])
  const [checklistBusy, setChecklistBusy] = useState(false)
  const [checklistHighlight, setChecklistHighlight] = useState(false)
  const [feedRowActionBusy, setFeedRowActionBusy] = useState<string | null>(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  /** Idle pill: hover expands to reveal dictation (second row). */

  const trackedNoteEditorRef = useRef<HTMLDivElement | null>(null)
  const trackedNoteBackupHtmlRef = useRef(`<p></p>`)
  const noteTranscriptScrollRef = useRef<HTMLDivElement | null>(null)
  const noteContinueBaseRef = useRef<string | null>(null)
  const aiSuggestBannerTimerRef = useRef<number | null>(null)

  const outputModeRef = useRef(outputMode)

  // Recording always lives inside the notes card — treat recording phase as output for sizing
  const layoutPhaseForShell =
    phase === `recording` ? `output` : phase

  const widthPx  = WIDTH_BY_PHASE[layoutPhaseForShell]
  const heightPx = HEIGHT_BY_PHASE[layoutPhaseForShell]
  const isEmbeddedRecording = phase === `recording`


  function resizeElectronWindow() {
    const pillBridge = window.pill
    if (!pillBridge) return

    const pad = 64
    void pillBridge.resize({
      width: widthPx,
      height: heightPx + pad,
    })
  }

  useLayoutEffect(() => {
    resizeElectronWindow()
  }, [phase, widthPx, heightPx, isProcessingWhisper])

  useEffect(() => {
    finalTextRef.current = finalText
  }, [finalText])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    outputModeRef.current = outputMode
  }, [outputMode])

  useLayoutEffect(() => {
    if (
      phase !== `output` ||
      notePresentationMode !== `tracked` ||
      isProcessingWhisper
    )
      return
    const root = trackedNoteEditorRef.current
    if (!root) return

    root.innerHTML = trackedNoteBackupHtmlRef.current
  }, [phase, notePresentationMode, isProcessingWhisper, trackedNoteSession])

  useEffect(() => {
    if (phase !== `output` || noteCapturedAt === null) return
    if (nowMs() - noteCapturedAt >= 90_000) return

    const id = window.setInterval(() => {
      setFeedStampNowMs(nowMs())
    }, 9000)

    return () => {
      clearInterval(id)
    }
  }, [phase, noteCapturedAt])

  useEffect(() => {
    if (phase !== `recording`) return
    const el = noteTranscriptScrollRef.current
    if (!el) return

    window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [phase, liveText])

  /** After each capture, history is oldest→newest; keep the latest entry in view. */
  useLayoutEffect(() => {
    if (phase !== `output`) return
    const el = noteTranscriptScrollRef.current
    if (!el) return

    window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [phase, historyRows, noteCapturedAt, finalText])

  function teardownSpeech() {
    const s = speechRef.current
    if (!s) return
    speechRef.current = null
    try { s.stop() } catch { /* ignore */ }
  }

  function teardownMic() {
    teardownSpeech()
    const rec = recorderRef.current
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* ignore */ }
    recorderRef.current = null
    recorderMimeRef.current = ''
    chunkPartsRef.current = []
    mediaStreamRef.current?.getTracks().forEach(t => t.stop())
    mediaStreamRef.current = null
    // stop audio level analysis
    if (audioRafRef.current !== null) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = null }
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    audioCtxRef.current = null
  }

  async function getAudioBlob(): Promise<Blob | null> {
    teardownSpeech()
    const rec = recorderRef.current

    await new Promise<void>(resolve => {
      if (!rec || rec.state === 'inactive') return resolve()
      const done = () => resolve()
      rec.addEventListener('stop', done, { once: true })
      try { rec.requestData?.(); rec.stop() } catch { resolve() }
      setTimeout(done, 800)
    })

    const mime = recorderMimeRef.current || rec?.mimeType || 'audio/webm'
    const blob = new Blob(chunkPartsRef.current, { type: mime })
    chunkPartsRef.current = []
    recorderRef.current = null
    recorderMimeRef.current = ''
    mediaStreamRef.current?.getTracks().forEach(t => t.stop())
    mediaStreamRef.current = null

    return blob.size > 500 ? blob : null
  }

  function clearAiBannerTimer() {
    if (aiSuggestBannerTimerRef.current !== null) {
      window.clearTimeout(aiSuggestBannerTimerRef.current)
      aiSuggestBannerTimerRef.current = null
    }
  }

  function revealAiBanner(message: string) {
    clearAiBannerTimer()
    setAiSuggestBanner(`${message ?? ``}`.slice(0, 480))

    aiSuggestBannerTimerRef.current = window.setTimeout(() => {
      aiSuggestBannerTimerRef.current = null
      setAiSuggestBanner(null)
    }, 6500)
  }

  /** Plain-text snapshot for GPT suggestions (tracked view uses cleaned inner text). */
  function getNotePlainSnapshot(): string {
    if (notePresentationMode === `tracked` && trackedNoteEditorRef.current)
      return trackedNoteAcceptedPlain(trackedNoteEditorRef.current)

    return `${finalText}`.trim()
  }

  function clearLatestCopyTimer() {
    if (latestCopyResetTimerRef.current !== null) {
      clearTimeout(latestCopyResetTimerRef.current)
      latestCopyResetTimerRef.current = null
    }
  }

  function resetLatestCopyState() {
    clearLatestCopyTimer()
    setCopyOk(false)
  }

  function showLatestCopyConfirmation() {
    clearLatestCopyTimer()
    setCopyOk(true)
    latestCopyResetTimerRef.current = setTimeout(() => {
      latestCopyResetTimerRef.current = null
      setCopyOk(false)
    }, 900)
  }

  async function writeClipboardText(text: string) {
    const value = `${text ?? ``}`

    if (browserDemoUiMockActive()) {
      await navigator.clipboard.writeText(value)
      return true
    }

    if (window.pill) return window.pill.copyText(value)

    await navigator.clipboard.writeText(value)
    return true
  }

  function openNotesOnly() {
    clearAiBannerTimer()
    setAiSuggestBanner(null)
    setAiSuggestBusy(false)
    setMicError(null)
    resetLatestCopyState()
    const rows = loadCaptureHistory()
    setHistoryRows(rows)
    const latest = rows[0]
    setFinalText(latest?.text ?? '')
    setNoteCapturedAt(latest?.at ?? null)
    setFeedStampNowMs(nowMs())
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    setOutputMode(`note`)
    setChecklistItems([])
    setChecklistBusy(false)
    setChecklistHighlight(false)
    setPhase(`output`)
  }

  /** Start recording and open the notes card at the same time.
   *  Each invocation creates a fresh new note — prior notes remain in the feed history. */
  async function startRecordingFromNotes() {
    clearAiBannerTimer()
    setAiSuggestBanner(null)
    setAiSuggestBusy(false)
    setMicError(null)
    resetLatestCopyState()
    const rows = loadCaptureHistory()
    setHistoryRows(rows)
    // Start fresh — no continueFromNote, so the new transcription is a standalone note
    setFinalText(``)
    setNoteCapturedAt(null)
    setFeedStampNowMs(nowMs())
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    setOutputMode(`note`)
    setChecklistItems([])
    setChecklistBusy(false)
    setChecklistHighlight(false)
    void startRecording({ embeddedInScratchpad: true })
  }

  /** Cancel in-progress recording — discards the audio, returns to notes with prior text intact. */
  function cancelRecording() {
    transcriptionGenRef.current += 1
    const priorText = noteContinueBaseRef.current ?? ``
    noteContinueBaseRef.current = null
    teardownMic()
    setLiveText(``)
    setIsProcessingWhisper(false)
    setFinalText(priorText)
    setTrackedOriginalTranscript(null)
    setPhase(`output`)
  }

  async function startRecording(opts?: {
    continueFromNote?: string
    /** Keep scratchpad chrome instead of collapsing to waveform pill */
    embeddedInScratchpad?: boolean
  }) {
    transcriptionGenRef.current += 1
    setMicError(null)
    resetLatestCopyState()
    setLiveText(``)
    if (opts?.continueFromNote !== undefined) {
      noteContinueBaseRef.current = opts.continueFromNote
      setFinalText(opts.continueFromNote)
    } else {
      noteContinueBaseRef.current = null
      setFinalText(``)
    }
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    // Only reset output mode when starting fresh — preserve checklist state for continuations
    if (opts?.continueFromNote === undefined) {
      setOutputMode('note')
      setChecklistItems([])
    }
    teardownMic()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
      mediaStreamRef.current = stream

      // On macOS, audio/webm files from Electron's MediaRecorder can have
      // malformed containers that Whisper rejects (400 Invalid file format).
      // Prefer audio/mp4 on macOS since it's the native format and always valid.
      const isMac = window.pill?.platform === 'darwin'
      const preferred = isMac
        ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      recorderMimeRef.current = preferred.find(m => MediaRecorder.isTypeSupported?.(m)) ?? ''

      const recorder = recorderMimeRef.current
        ? new MediaRecorder(stream, { mimeType: recorderMimeRef.current })
        : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunkPartsRef.current = []
      recorder.ondataavailable = e => { if (e.data.size) chunkPartsRef.current.push(e.data) }

      const SpeechCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition
      if (SpeechCtor) {
        try {
          const recognition = new SpeechCtor()
          recognition.continuous = true
          recognition.interimResults = true
          recognition.lang = navigator.language ?? 'en-US'

          let accumulated = ''
          recognition.onresult = (evt: SpeechRecognitionEvent) => {
            let interim = ''
            for (let i = evt.resultIndex; i < evt.results.length; i++) {
              const result = evt.results.item(i) as SpeechRecognitionResult
              const transcript = result.item(0)?.transcript ?? ''
              if (result.isFinal) {
                accumulated += transcript + ' '
              } else {
                interim += transcript
              }
            }
            setLiveText((accumulated + interim).trim())
          }
          recognition.onerror = () => {}
          recognition.start()
          speechRef.current = recognition
        } catch { /* ignore */ }
      }

      recorder.start(200)

      // Web Audio API — drive pill gradient speed from mic level
      try {
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 256
        audioCtx.createMediaStreamSource(stream).connect(analyser)
        const freqData = new Uint8Array(analyser.frequencyBinCount)
        let smoothed = 0

        const tick = () => {
          analyser.getByteFrequencyData(freqData)
          const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length / 255
          smoothed = smoothed * 0.78 + avg * 0.22
          const opacity = smoothed < 0.012
            ? 0.15
            : Math.min(0.88, 0.15 + smoothed * 4.0)
          ;(document.querySelectorAll('.qc-audio-blob') as NodeListOf<HTMLElement>)
            .forEach(b => { b.style.opacity = opacity.toString() })
          audioRafRef.current = requestAnimationFrame(tick)
        }
        audioRafRef.current = requestAnimationFrame(tick)
      } catch { /* AudioContext not available — degrade gracefully */ }

      setPhase('recording')
    } catch (err) {
      setMicError(`Mic blocked: ${summarizeError(err)}`)
      noteContinueBaseRef.current = null
      teardownMic()
    }
  }

  async function stopRecording() {
    if (phaseRef.current !== 'recording') return

    transcriptionGenRef.current += 1
    const gen = transcriptionGenRef.current
    const currentLive = liveText

    function finishStaleEarly() {
      setIsProcessingWhisper(false)
    }

    setIsProcessingWhisper(true)
    const blob = await getAudioBlob()

    if (transcriptionGenRef.current !== gen) {
      finishStaleEarly()
      return
    }

    const whisperBridge = window.pill
    let resolved: string

    if (browserDemoUiMockActive()) {
      await new Promise(r => setTimeout(r, 200))
      resolved = currentLive || `This is sample transcription text in dev mode.`
    } else {
      try {
        if (blob && whisperBridge) {
          const b64 = await blobToBase64(blob)

          if (transcriptionGenRef.current !== gen) {
            finishStaleEarly()
            return
          }

          const tc = await whisperBridge.transcribeBlob({
            data: b64,
            mime: blob.type,
          })

          if (transcriptionGenRef.current !== gen) {
            finishStaleEarly()
            return
          }

          const errObj =
            tc && typeof tc === `object` && `ok` in tc && (tc as { ok: unknown }).ok === false ?
              (tc as { ok: false; code: string; message?: string })
            : null

          if (errObj) {
            resolved =
              errObj.code === `MISSING_API_KEY` ?
                (errObj.message
                  ?? `Transcription unavailable: add OPENAI_API_KEY to .env and restart Quick Capture.`)
              : errObj.code === `BAD_AUDIO_PAYLOAD` ?
                `No audible speech captured.`
              : (errObj.message?.trim() || `Transcription failed.`)
          } else {
            const txt =
              tc && typeof tc === `object` && `text` in tc ?
                `${(tc as { text?: string }).text ?? ``}`
              : ``

            // Only use Whisper's result. currentLive (browser SpeechRecognition) is a live
            // preview only — it's too sensitive to background audio to use as a final fallback.
            resolved = txt.trim() || `No speech detected.`
          }
        } else {
          // No Whisper bridge (browser-only mode) — SpeechRecognition is the only source.
          resolved = currentLive || `No speech detected.`
        }
      } catch {
        resolved = `Transcription failed.`
      }
    }

    if (transcriptionGenRef.current !== gen) {
      finishStaleEarly()
      return
    }

    const continueBase = noteContinueBaseRef.current
    noteContinueBaseRef.current = null

    // If this was a "continue from scratchpad" recording and nothing new was captured,
    // keep the prior text as-is rather than appending a fallback error string.
    const FALLBACK_MSGS = [`No speech detected.`, `No audible speech captured.`, `Transcription failed.`]
    const resolvedIsEmpty = !resolved.trim() || FALLBACK_MSGS.includes(resolved.trim())

    const merged =
      continueBase !== null ?
        (resolvedIsEmpty ? continueBase : mergeNoteContinue(continueBase, resolved))
      : resolved

    const captured = addCaptureHistoryEntry(merged)
    setHistoryRows(loadCaptureHistory())

    setFinalText(merged)
    setNoteCapturedAt(captured.at)
    setFeedStampNowMs(captured.at)
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    setIsProcessingWhisper(false)
    setPhase(`output`)

    // If user was in checklist mode, re-format the combined text as tasks
    if (outputModeRef.current === 'checklist' && whisperBridge && !resolvedIsEmpty) {
      setOutputMode('checklist')
      setChecklistBusy(true)
      void (async () => {
        try {
          const result = await whisperBridge.formatChecklist(merged.trim())
          if (result?.items?.length) {
            setChecklistItems(result.items)
            setChecklistHighlight(true)
            setTimeout(() => setChecklistHighlight(false), result.items.length * 90 + 1200)
          }
        } catch { /* ignore */ }
        finally { setChecklistBusy(false) }
      })()
    }



  }

  /** Shared reset for idle pill UI; pair with `pill.hide()` (dismiss) or `pill.show()` (collapse). */
  function resetChromeToIdlePill() {
    clearAiBannerTimer()
    setAiSuggestBanner(null)
    setAiSuggestBusy(false)

    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
    transcriptionGenRef.current += 1
    teardownMic()
    setLiveText('')
    setFinalText('')
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    resetLatestCopyState()
    setNoteCapturedAt(null)
    noteContinueBaseRef.current = null
    setIsProcessingWhisper(false)
    setOutputMode('note')
    setChecklistItems([])
    setChecklistBusy(false)
    setChecklistHighlight(false)
    setIsSelectionMode(false)
    setSelectedIds(new Set())
    setPhase('idle')
  }

  function collapseToIdlePill() {
    resetChromeToIdlePill()
    void window.pill?.show()
  }

  function dismiss() {
    resetChromeToIdlePill()
    void window.pill?.hide()
  }

  async function runSuggestAiEdits() {
    const pillBridge = window.pill
    if (
      !pillBridge
      || phase !== `output`
      || aiSuggestBusy
      || isEmbeddedRecording
      || isProcessingWhisper
    )
      return

    const trimmedPlain = getNotePlainSnapshot()
    if (!trimmedPlain.length) {
      revealAiBanner(`Nothing to clean up in this note.`)
      return
    }
    if (classifySilentTranscript(trimmedPlain)) {
      revealAiBanner(`Nothing to clean up in this note.`)
      return
    }

    setAiSuggestBusy(true)
    setAiSuggestBanner(null)
    clearAiBannerTimer()

    try {
      const outcome = await pillBridge.suggestEdits({ text: trimmedPlain })

      if (!outcome.ok) {
        revealAiBanner(outcome.message ?? `Suggestions failed (${outcome.code}).`)
        return
      }

      const reps = outcome.replacements ?? []
      const cleanedText = `${outcome.cleanedText ?? ``}`.trim()
      if (!reps.length && (!cleanedText.length || cleanedText === trimmedPlain)) {
        revealAiBanner(outcome.summary ?? `Looks good — no edits suggested.`)
        return
      }

      const htmlApplied = applySuggestReplacements(trimmedPlain, reps)
      const fallbackHtml = applyWholeTextSuggestion(trimmedPlain, cleanedText)
      const trackedHtml =
        htmlApplied !== null && htmlApplied.includes(`qc-ai-del`) ? htmlApplied : fallbackHtml

      if (trackedHtml === null) {
        revealAiBanner(
          `${
            outcome.summary ? `${outcome.summary} — ` : ``
          }Could not safely apply edits; try recording again clearer text.`,
        )
        return
      }

      trackedNoteBackupHtmlRef.current = trackedHtml
      setFinalText(trimmedPlain)
      setTrackedOriginalTranscript(trimmedPlain)
      resetLatestCopyState()
      // Checklist branch renders before tracked — leave tasks view so the diff UI can show.
      setOutputMode(`note`)
      setNotePresentationMode(`tracked`)
      setTrackedNoteSession(n => n + 1)

      if (outcome.summary?.trim().length) revealAiBanner(outcome.summary.trim())
    } catch {
      revealAiBanner(`Suggestions request failed — check connectivity and OPENAI quotas.`)
    } finally {
      setAiSuggestBusy(false)
    }
  }

  async function copyText() {
    cancelAutoDismiss()
    if (copyOk) return

    let text = finalText
    if (outputMode === 'checklist' && checklistItems.length) {
      text = checklistItems.map(i => `${i.checked ? '☑' : '☐'} ${i.text}`).join('\n')
    } else if (
      phase === `output` &&
      notePresentationMode === `tracked` &&
      trackedNoteEditorRef.current
    ) {
      text = trackedNoteAcceptedPlain(trackedNoteEditorRef.current) || finalText
    }

    try {
      const copied = await writeClipboardText(text)
      if (copied) showLatestCopyConfirmation()
    } catch {
      //
    }
  }

  const transcriptPlainMain =
    isEmbeddedRecording ? mergeNoteContinue(finalText, liveText) : phase === `output` ? finalText : liveText
  const displayText = transcriptPlainMain

  const chronoRows = useMemo(() => [...historyRows].reverse(), [historyRows])

  const liveFeedStamp = useMemo(() => {
    if (noteCapturedAt === null) return ``
    return formatLiveFeedStamp(noteCapturedAt, feedStampNowMs)
  }, [noteCapturedAt, feedStampNowMs])

  const latestPlainForSilent = phase === `output` || isEmbeddedRecording ? `${finalText}`.trim() : ``
  const latestSilentClass = classifySilentTranscript(latestPlainForSilent)

  function cancelAutoDismiss() {
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
  }

  async function copyHistoryRow(row: CaptureHistoryRow, evt: MouseEvent) {
    evt.stopPropagation()

    const text = row.silent ? SILENT_HISTORY_PREVIEW : row.text

    try {
      await writeClipboardText(text)
    } catch {
      //
    }
  }

  async function handleFeedRowCleanUp(
    row: CaptureHistoryRow,
    isLatest: boolean,
    evt?: MouseEvent,
  ) {
    evt?.stopPropagation()
    if (isProcessingWhisper) return

    if (isLatest) {
      void runSuggestAiEdits()
      return
    }

    if (row.silent) return
    const trimmed = row.text.trim()
    if (!trimmed.length) return

    const pillBridge = window.pill
    if (!pillBridge) return

    setFeedRowActionBusy(row.id)
    try {
      const outcome = await pillBridge.suggestEdits({ text: trimmed })
      if (!outcome.ok) {
        revealAiBanner(outcome.message ?? `Suggestions failed (${outcome.code}).`)
        return
      }
      const polished = `${outcome.cleanedText ?? ``}`.trim()
      if (!polished.length || polished === trimmed) {
        revealAiBanner(outcome.summary ?? `Looks good — no edits suggested.`)
        return
      }
      await writeClipboardText(polished)
      revealAiBanner(
        outcome.summary?.trim() ?
          `${outcome.summary.trim()} — Copied cleaned text.`
        : `Cleaned text copied to clipboard.`,
      )
    } catch {
      revealAiBanner(`Clean up failed — check connectivity and quotas.`)
    } finally {
      setFeedRowActionBusy(null)
    }
  }

  function handleFeedRowCopy(row: CaptureHistoryRow, isLatest: boolean, evt: MouseEvent) {
    evt.stopPropagation()
    if (isLatest) {
      void copyText()
      return
    }
    void copyHistoryRow(row, evt)
  }

  function toggleAppearance() {
    setAppearance(prev => {
      const next = prev === `light` ? `dark` : `light`
      setStoredAppearance(next)
      applyAppearanceToDocument(next)
      return next
    })
  }

  function restoreTranscript() {
    clearAiBannerTimer()
    setAiSuggestBanner(null)
    if (trackedOriginalTranscript !== null) setFinalText(trackedOriginalTranscript)
    trackedNoteBackupHtmlRef.current = `<p></p>`
    setTrackedOriginalTranscript(null)
    setNotePresentationMode(`plain`)
    setOutputMode(`note`)
    setChecklistItems([])
    setChecklistBusy(false)
    setChecklistHighlight(false)
    resetLatestCopyState()
  }

  // ── Selection mode ────────────────────────────────────────────────
  function enterSelectionMode() {
    setIsSelectionMode(true)
    setSelectedIds(new Set())
  }

  function exitSelectionMode() {
    setIsSelectionMode(false)
    setSelectedIds(new Set())
  }

  function toggleSelectId(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    const allIds = historyRows.map(r => r.id)
    setSelectedIds(prev =>
      prev.size === allIds.length ? new Set() : new Set(allIds),
    )
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return
    const remaining = historyRows.filter(r => !selectedIds.has(r.id))
    saveCaptureHistory(remaining)
    setHistoryRows(remaining)
    // If the currently-displayed latest note was deleted, clear it
    if (historyRows[0] && selectedIds.has(historyRows[0].id)) {
      setFinalText(``)
      setTrackedOriginalTranscript(null)
      resetLatestCopyState()
      setNoteCapturedAt(null)
      if (remaining.length === 0) setPhase(`idle`)
    }
    exitSelectionMode()
  }

  useEffect(() => {
    return () => {
      clearLatestCopyTimer()
    }
  }, [])

  useEffect(() => {
    const pillBridge = window.pill
    if (!pillBridge) return

    const unsub = pillBridge.onSummon(() => {
      if (phaseRef.current === 'idle') {
        setMicError(null)
        void startRecordingFromNotes()
      }
    })

    const unsubToggle = pillBridge.onToggle(() => {
      if (phaseRef.current === 'idle') {
        setMicError(null)
        void startRecordingFromNotes()
      } else if (phaseRef.current === 'recording') {
        void stopRecording()
      } else if (phaseRef.current === 'output') {
        setMicError(null)
        const priorText = finalTextRef.current.replace(/\s+/g, ' ').trim()
        void startRecording({ continueFromNote: priorText, embeddedInScratchpad: true })
      }
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === `Escape`) {
        if (phaseRef.current === `recording`) cancelRecording()
        else dismiss()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => {
      unsub()
      unsubToggle()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      className={`relative flex min-h-screen items-end justify-end bg-transparent ${phase === `idle` ? `p-1` : `p-4`}`}
      style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
    >
      <section
        ref={node => { shellRef.current = node }}
        style={{
          width: widthPx,
          height: heightPx,
          borderRadius:
            phase === `output` || isEmbeddedRecording ? `var(--qc-radius-lg)` : `999px`,
          transition: SPRING_TRANSITION,
          background:
            phase === `output` || isEmbeddedRecording ?
              `var(--qc-bg-canvas)`
            : `var(--qc-bg-surface)`,
          overflow: `hidden`,
          ...(phase === `idle` ?
            { WebkitAppRegion: `drag` as const }
          : {}),
        } as CSSProperties}
        className={
          phase === `output` || isEmbeddedRecording ?
            `scratchpad-shadow`
          : `icon-btn-shadow`
        }
      >
        {/* IDLE: notes | mic */}
        {phase === 'idle' && (
          <div className="qc-idle-split">
            <button
              type="button"
              onClick={() => openNotesOnly()}
              className="qc-idle-split-btn"
              aria-label="Open your notes"
              title="Your notes"
            >
              <NotesIcon size={15} />
            </button>
            <div className="qc-idle-split-divider" aria-hidden />
            <button
              type="button"
              onClick={() => void startRecordingFromNotes()}
              className="qc-idle-split-btn"
              aria-label="Start dictation"
              title="Start dictation  ⌃Space"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15a4 4 0 004-4V7a4 4 0 10-8 0v4a4 4 0 004 4z" />
                <path d="M19 11a7 7 0 01-14 0" />
                <path d="M12 19v2" /><path d="M10 21h4" />
              </svg>
            </button>
          </div>
        )}

        {/* SCRATCHPAD: Output (+ embedded dictate from footer) */}
        {(phase === 'output' || isEmbeddedRecording) && (
          <div className="fade-in flex h-full min-h-0 w-full flex-col">
            {/* Main */}
            <div
              className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              style={{
                borderRadius: `var(--qc-radius-lg)`,
                WebkitAppRegion: `drag`,
              } as CSSProperties}
            >
              {/* Title row — notes header, shortcut, copy + window chrome */}
              <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-4">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] pr-1">
                  <span
                    className="qc-scratchpad-header-title truncate text-[15px] font-bold tracking-tight"
                    style={{ color: `var(--qc-text-primary)` }}
                  >
                    Voice notes
                  </span>
                  <p className={`qc-sheet-shortcut-hint${isEmbeddedRecording ? `` : ``}`}>
                    {isEmbeddedRecording ? `listening…` : `Hit ⌃Space to speak`}
                  </p>
                </div>
                <div
                  className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
                  role="presentation"
                >
                  {/* Delete / selection mode toggle */}
                  {!isEmbeddedRecording && (
                    isSelectionMode ? (
                      <button
                        type="button"
                        className="qc-chrome-icon-btn"
                        style={{ fontSize: `11px`, fontWeight: 500, color: `var(--qc-text-secondary)`, width: `auto`, padding: `0 6px` }}
                        onClick={exitSelectionMode}
                        title="Cancel selection"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="qc-chrome-icon-btn"
                        aria-label="Select notes to delete"
                        title="Delete notes"
                        disabled={historyRows.length === 0}
                        onClick={enterSelectionMode}
                      >
                        <TrashIcon size={13} />
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    className="qc-chrome-icon-btn"
                    aria-label={appearance === `light` ? `Switch to dark mode` : `Switch to light mode`}
                    title={appearance === `light` ? `Dark mode` : `Light mode`}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      toggleAppearance()
                    }}
                  >
                    {appearance === `light` ? <MoonIcon size={13} /> : <SunIcon size={13} />}
                  </button>

                  {typeof window !== `undefined` && window.pill ?
                    <>
                      <button
                        type="button"
                        className="qc-chrome-square-btn"
                        aria-label="Minimize to pill"
                        title="Minimize to pill"
                        onClick={() => collapseToIdlePill()}
                      >
                        <WindowMinimizeIcon />
                      </button>
                      <button
                        type="button"
                        className="qc-chrome-square-btn"
                        aria-label="Close"
                        title="Close"
                        onClick={() => dismiss()}
                      >
                        <WindowCloseIcon />
                      </button>
                    </>
                  : null}
                </div>
              </div>

              {/* White content panel — separates header (grey) from feed (white) */}
              <div
                className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
                style={{
                  background: `var(--qc-bg-surface)`,
                  borderTop: `1px solid var(--qc-border-strong)`,
                }}
              >

              {/* Transcript list */}
              <div
                ref={noteTranscriptScrollRef}
                className={`transcript-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden${isEmbeddedRecording ? ` pb-[76px]` : ``}`}
                style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
              >
                <div className="qc-feed">
                  {/* Select-all row — only visible in selection mode */}
                  {isSelectionMode && historyRows.length > 0 && (
                    <div className="qc-feed-select-all-row">
                      <label className="qc-feed-select-all-label">
                        <div
                          className={`qc-feed-checkbox${selectedIds.size === historyRows.length ? ` qc-feed-checkbox--checked` : ``}`}
                          onClick={selectAll}
                          role="checkbox"
                          aria-checked={selectedIds.size === historyRows.length}
                          tabIndex={0}
                          onKeyDown={(e) => e.key === ` ` && selectAll()}
                        >
                          {selectedIds.size === historyRows.length && <CheckIcon size={10} />}
                        </div>
                        <span style={{ fontSize: `12px`, color: `var(--qc-text-muted)` }}>
                          {selectedIds.size === historyRows.length ? `Deselect all` : `Select all`}
                        </span>
                      </label>
                    </div>
                  )}

                  {chronoRows.map((row, idx) => {
                    const isLatest = idx === chronoRows.length - 1
                    const stamp =
                      isLatest && noteCapturedAt !== null ?
                        liveFeedStamp || formatFeedEntryStamp(row.at)
                      : formatFeedEntryStamp(row.at)

                    const rowSideBusy = !isLatest && feedRowActionBusy === row.id
                    const cleanDisabledLatest =
                      aiSuggestBusy ||
                      isEmbeddedRecording ||
                      isProcessingWhisper ||
                      copyOk ||
                      outputMode === `checklist` ||
                      latestSilentClass

                    const cleanDisabledPast =
                      feedRowActionBusy !== null || row.silent || isProcessingWhisper ||
                      !window.pill

                    return (
                      <div
                        key={row.id}
                        className={[
                          isLatest ? `qc-feed-entry qc-feed-entry--current` : `qc-feed-entry`,
                          isSelectionMode ? `qc-feed-entry--selectable` : ``,
                          isSelectionMode && selectedIds.has(row.id) ? `qc-feed-entry--selected` : ``,
                        ].join(` `).trim()}
                        onClick={isSelectionMode ? () => toggleSelectId(row.id) : undefined}
                      >
                        {/* Checkbox — only in selection mode */}
                        {isSelectionMode && (
                          <div className="qc-feed-select-col" aria-hidden>
                            <div className={`qc-feed-checkbox${selectedIds.has(row.id) ? ` qc-feed-checkbox--checked` : ``}`}>
                              {selectedIds.has(row.id) && <CheckIcon size={10} />}
                            </div>
                          </div>
                        )}

                        <div className="qc-feed-meta">
                          <span className="qc-feed-meta-time">{stamp}</span>
                          {isLatest ?
                            !isProcessingWhisper ?
                              <div className="qc-feed-actions">
                                <button
                                  type="button"
                                  className="qc-feed-action"
                                  aria-label="Clean up"
                                  title="Clean up grammar & phrasing"
                                  disabled={cleanDisabledLatest}
                                  onClick={(e) => void handleFeedRowCleanUp(row, true, e)}
                                >
                                  {aiSuggestBusy ?
                                    <span
                                      aria-hidden={true}
                                      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid"
                                      style={{
                                        borderColor: `var(--qc-border-strong)`,
                                        borderTopColor: `var(--qc-accent)`,
                                      }}
                                    />
                                  : <ImproveIconOutline size={15} />}
                                  <span className="qc-feed-action-label-clip" aria-hidden={true}>
                                    <span className="qc-feed-action-label-text">Clean up</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="qc-feed-action"
                                  aria-label={copyOk ? `Copied` : `Copy`}
                                  title={copyOk ? `Copied` : `Copy`}
                                  disabled={copyOk || isEmbeddedRecording}
                                  onClick={(e) => handleFeedRowCopy(row, true, e)}
                                >
                                  {copyOk ?
                                    <CheckIcon size={15} />
                                  : <CopyIcon size={15} />}
                                  <span className="qc-feed-action-label-clip" aria-hidden={true}>
                                    <span className="qc-feed-action-label-text">
                                      {copyOk ? `Copied` : `Copy`}
                                    </span>
                                  </span>
                                </button>
                                {notePresentationMode === `tracked` && trackedOriginalTranscript !== null && (
                                  <button
                                    type="button"
                                    className="qc-feed-action qc-feed-action--revert"
                                    aria-label="Restore Transcript"
                                    title="Restore Transcript"
                                    onClick={restoreTranscript}
                                  >
                                    <UndoIcon size={15} />
                                    <span className="qc-feed-action-label-clip" aria-hidden={true}>
                                      <span className="qc-feed-action-label-text">Restore Transcript</span>
                                    </span>
                                  </button>
                                )}
                              </div>
                            : null
                          : rowSideBusy ?
                            <div className="qc-feed-actions-busy">
                              <div
                                className="h-4 w-4 animate-spin rounded-full border-2 border-solid"
                                style={{
                                  borderColor: `var(--qc-border-strong)`,
                                  borderTopColor: `var(--qc-accent)`,
                                }}
                              />
                            </div>
                          :
                            <div className="qc-feed-actions">
                              <button
                                type="button"
                                className="qc-feed-action"
                                aria-label="Clean up"
                                title="Copy cleaned text from this note"
                                  disabled={cleanDisabledPast}
                                  onClick={(e) => void handleFeedRowCleanUp(row, false, e)}
                                >
                                  <ImproveIconOutline size={15} />
                                <span className="qc-feed-action-label-clip" aria-hidden={true}>
                                  <span className="qc-feed-action-label-text">Clean up</span>
                                </span>
                              </button>
                              <button
                                type="button"
                                className="qc-feed-action"
                                aria-label="Copy"
                                title="Copy"
                                onClick={(e) => handleFeedRowCopy(row, false, e)}
                              >
                                <CopyIcon size={15} />
                                <span className="qc-feed-action-label-clip" aria-hidden={true}>
                                  <span className="qc-feed-action-label-text">Copy</span>
                                </span>
                              </button>
                            </div>
                          }
                        </div>

                        {isLatest ?
                          <>
                            {outputMode === `checklist` ?
                              isEmbeddedRecording && checklistItems.length ?
                                <div className="flex flex-col gap-0">
                                  <div className="qc-checklist-root" style={{ opacity: 0.45 }}>
                                    {checklistItems.map((item, i) => (
                                      <label key={i} className="qc-checklist-item" style={{ animationDelay: `0ms` }}>
                                        <input
                                          type="checkbox"
                                          checked={item.checked}
                                          className="qc-checklist-checkbox"
                                          readOnly
                                        />
                                        <span
                                          className="qc-checklist-label"
                                          style={{
                                            textDecoration: item.checked ? `line-through` : `none`,
                                            color: item.checked ? `var(--qc-text-muted)` : `var(--qc-text-primary)`,
                                          }}
                                        >
                                          {item.text}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2 py-3">
                                    <div style={{ flex: 1, height: 1, background: `var(--qc-border)` }} />
                                    <span className="text-[11px] shrink-0" style={{ color: `var(--qc-text-muted)` }}>
                                      Adding more…
                                    </span>
                                    <div style={{ flex: 1, height: 1, background: `var(--qc-border)` }} />
                                  </div>
                                  {liveText ?
                                    <FeedClampText
                                      text={liveText}
                                      className={`qc-feed-current-text select-text whitespace-pre-wrap`}
                                      style={{ color: `var(--qc-text-muted)` }}
                                    />
                                  :
                                    <div className="qc-dictation-typing" aria-hidden={true}>
                                      <span /><span /><span />
                                    </div>
                                  }
                                </div>
                              :
                                <div className="flex flex-col gap-0">
                                  <div className="pb-3">
                                    <FeedClampText
                                      text={finalText}
                                      className="qc-feed-past-text qc-feed-body-text select-text whitespace-pre-wrap"
                                      style={{ color: `var(--qc-text-muted)` }}
                                    />
                                  </div>
                                  <div style={{ height: 1, background: `var(--qc-border)`, marginBottom: 12 }} />
                                  <div className="qc-checklist-root">
                                    {checklistBusy ?
                                      <div className="flex items-center gap-2" style={{ color: `var(--qc-text-muted)` }}>
                                        <div
                                          className="h-4 w-4 animate-spin rounded-full border-2 border-solid"
                                          style={{
                                            borderColor: `var(--qc-border-strong)`,
                                            borderTopColor: `var(--qc-accent)`,
                                          }}
                                        />
                                        <span className="text-sm">Formatting tasks…</span>
                                      </div>
                                    : checklistItems.map((item, i) => (
                                      <label
                                        key={i}
                                        className="qc-checklist-item"
                                        style={{ animationDelay: `${i * 90}ms` } as CSSProperties}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={item.checked}
                                          className="qc-checklist-checkbox"
                                          onChange={() =>
                                            setChecklistItems(prev =>
                                              prev.map((it, idx) =>
                                                idx === i ? { ...it, checked: !it.checked } : it
                                              )
                                            )
                                          }
                                        />
                                        <span
                                          className={`qc-checklist-label${
                                            checklistHighlight && !item.checked ? ` qc-checklist-label--highlight` : ``
                                          }`}
                                          style={{
                                            textDecoration: item.checked ? `line-through` : `none`,
                                            color: item.checked ? `var(--qc-text-muted)` : undefined,
                                            animationDelay: `${i * 90}ms`,
                                          }}
                                        >
                                          {item.text}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                            : notePresentationMode === `tracked` ?
                              <div
                                ref={trackedNoteEditorRef}
                                key={`tracked-${trackedNoteSession}`}
                                role="textbox"
                                aria-multiline={true}
                                aria-label="Edited note"
                                spellCheck={true}
                                className="qc-tracked-note-root"
                                contentEditable={true}
                                suppressContentEditableWarning={true}
                                onPointerDownCapture={e => {
                                  const edited = acceptTrackedAdditionAtPointer(e.currentTarget, e.target)
                                  if (edited) {
                                    e.preventDefault()
                                    trackedNoteBackupHtmlRef.current = e.currentTarget.innerHTML
                                    resetLatestCopyState()
                                  }
                                }}
                                onInput={e => {
                                  trackedNoteBackupHtmlRef.current = e.currentTarget.innerHTML
                                  resetLatestCopyState()
                                }}
                              />
                            :
                              /* When recording, show prior text stable — live block appears below */
                              <FeedClampText
                                text={isEmbeddedRecording ? finalText : displayText}
                                className="qc-feed-current-text select-text whitespace-pre-wrap"
                              />
                            }

                            {aiSuggestBanner && !isEmbeddedRecording &&
                              <div role="status" className="qc-ai-banner mt-2 px-3 py-2 leading-[1.2]">
                                {aiSuggestBanner}
                              </div>
                            }
                          </>
                        :
                          <>
                            <PastEntryText
                              key={row.id}
                              row={row}
                              onSave={(newText) => {
                                updateCaptureHistoryById(row.id, newText)
                                setHistoryRows(loadCaptureHistory())
                              }}
                            />
                          </>
                        }
                      </div>
                    )
                  })}

                  {historyRows.length === 0 && !isProcessingWhisper && !isEmbeddedRecording && (
                    <p className="px-3 py-6 text-sm italic" style={{ color: `var(--qc-text-muted)` }}>
                      No captures yet.
                    </p>
                  )}
                </div>
              </div>

              {/* Selection mode bottom bar — overlays the FAB when active */}
              {isSelectionMode && (
                <div className="qc-feed-select-bar" style={{ WebkitAppRegion: `no-drag` } as CSSProperties}>
                  <span className="qc-feed-select-bar__count">
                    {selectedIds.size === 0 ? `Select notes` : `${selectedIds.size} selected`}
                  </span>
                  <button
                    type="button"
                    className="qc-feed-select-bar__delete"
                    disabled={selectedIds.size === 0}
                    onClick={deleteSelected}
                  >
                    <TrashIcon size={13} />
                    Delete{selectedIds.size > 0 ? ` ${selectedIds.size}` : ``}
                  </button>
                </div>
              )}

              {(phase === `output` || isEmbeddedRecording) && !isSelectionMode && (
                <div
                  className={
                    isEmbeddedRecording ?
                      `qc-notes-mic-cta qc-notes-mic-cta--expanded`
                    : `qc-notes-mic-cta`
                  }
                  role="presentation"
                  style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
                >
                  {!isEmbeddedRecording ? (
                    <button
                      type="button"
                      className="qc-notes-mic-cta__fab"
                      onClick={() => void startRecordingFromNotes()}
                      aria-label="Start dictation"
                      title="Start dictation  ⌃Space"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden={true}>
                        <path d="M12 15a4 4 0 004-4V7a4 4 0 10-8 0v4a4 4 0 004 4z" />
                        <path d="M19 11a7 7 0 01-14 0" />
                        <path d="M12 19v2" /><path d="M10 21h4" />
                      </svg>
                    </button>
                  ) : isProcessingWhisper ? (
                    <div className="qc-notes-mic-cta__bar qc-notes-mic-cta__bar--processing">
                      <div className="qc-notes-mic-cta__bar-dots" aria-hidden={true}>
                        <div className="qc-dictation-typing">
                          <span /><span /><span />
                        </div>
                      </div>
                      <div className="qc-notes-mic-cta__bar-center">
                        <div
                          className="qc-notes-mic-cta__spinner h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-solid animate-spin"
                          role="status"
                          aria-label="Processing"
                          style={{
                            borderColor: `var(--qc-border-strong)`,
                            borderTopColor: `var(--qc-accent)`,
                          }}
                        />
                      </div>
                    </div>
                  ) :
                    (
                      <div className="qc-notes-mic-cta__bar">
                        <div className="qc-notes-mic-cta__bar-dots" aria-hidden={true}>
                          <div className="qc-dictation-typing">
                            <span /><span /><span />
                          </div>
                        </div>
                        <div className="qc-notes-mic-cta__bar-actions">
                          <button
                            type="button"
                            className="qc-notes-mic-cta__icon-btn"
                            onClick={() => cancelRecording()}
                            aria-label="Cancel recording"
                            title="Discard"
                          >
                            <XIcon size={13} />
                          </button>
                          <div className="qc-notes-mic-cta__wave" aria-hidden={true}>
                            <span /><span /><span /><span /><span /><span /><span />
                          </div>
                          <button
                            type="button"
                            className="qc-notes-mic-cta__icon-btn"
                            onClick={() => void stopRecording()}
                            aria-label="Accept audio and transcribe"
                            title="Finish and transcribe"
                          >
                            <CheckIcon size={15} />
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              )}

              </div>{/* end white content panel */}
            </div>
          </div>
        )}
      </section>


      {/* Error toast */}
      {micError && phase === 'idle' && (
        <div
          className="absolute bottom-20 right-4 px-3 py-2 text-xs shadow-[var(--qc-shadow-sm)]"
          style={{
            background: `var(--qc-bg-surface)`,
            border: `1px solid var(--qc-border)`,
            color: `var(--recording-red)`,
            borderRadius: `var(--qc-radius-md)`,
          }}
        >
          {micError}
        </div>
      )}
    </div>
  )
}
