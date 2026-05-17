declare global {
  type PillTranscriptionResult =
    | { ok: true; text: string }
    | {
        ok: false
        code: 'MISSING_API_KEY' | 'BAD_AUDIO_PAYLOAD' | 'TRANSCRIBE_FAILED'
        message?: string
      }

  type PillSuggestEditsResult =
    | { ok: true; replacements: Array<{ old: string; new: string }>; cleanedText: string; summary?: string }
    | { ok: false; code: 'MISSING_API_KEY' | 'EMPTY_TEXT' | 'BAD_RESPONSE'; message?: string }

  type PillExtractDestinationMode = 'tasks' | 'ideas' | 'reminders'

  type PillExtractDestinationResult =
    | {
        ok: true
        mode: PillExtractDestinationMode
        tasks?: { text: string }[]
        ideas?: { title?: string; text: string }[]
        reminders?: {
          text: string
          scheduledAt?: string
          dateText?: string
          timeText?: string
          needsDateTime?: boolean
        }[]
        summary?: string
      }
    | { ok: false; code: 'EMPTY_TEXT' | 'BAD_RESPONSE'; message?: string }

  interface PillApiLocal {
    resize: (size: { width: number; height: number }) => Promise<unknown | null>
    show: () => Promise<unknown | null>
    hide: () => Promise<unknown | null>
    minimize: () => Promise<unknown | null>
    onSummon: (cb: () => void) => () => void
    onToggle: (cb: () => void) => () => void
    transcribeBlob: (args: { data: string; mime: string }) => Promise<PillTranscriptionResult>
    suggestEdits: (payload: { text: string }) => Promise<PillSuggestEditsResult>
    extractDestination: (payload: {
      mode: PillExtractDestinationMode
      text: string
      nowIso?: string
    }) => Promise<PillExtractDestinationResult>
    formatChecklist: (transcript: string) => Promise<{ items: { text: string; checked: boolean }[] }>
    copyText: (text: string) => Promise<boolean>
    quit: () => Promise<unknown | null>
    platform: NodeJS.Platform
  }

  interface Window {
    /** Present in the Electron preload layer; absent in plain Vite previews. */
    pill?: PillApiLocal
  }

  interface SpeechRecognitionAlternative {
    transcript: string
    confidence?: number
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    item: (index: number) => SpeechRecognitionAlternative
    [index: number]: SpeechRecognitionAlternative
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    item: (index: number) => SpeechRecognitionResult
    [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onend?: ((event: Event) => void) | null
    onerror?: ((event: Event) => void) | null
    onnomatch?: ((event: SpeechRecognitionEvent) => void) | null
    onresult?: ((event: SpeechRecognitionEvent) => void) | null
    onstart?: ((event: Event) => void) | null

    abort: () => void
    start: () => void
    stop: () => void
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
  }

  interface WindowOrWorkerGlobalScope {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

export {}
