export type ChecklistItem = {
  text: string
  checked: boolean
}

export type ChecklistPayload = {
  items: ChecklistItem[]
}

/** Hosted transcription (Electron main IPC). Renderer must handle `.ok`. */
export type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; code: 'MISSING_API_KEY' | 'BAD_AUDIO_PAYLOAD' | 'TRANSCRIBE_FAILED'; message?: string }

export type SuggestReplacement = {
  /** Must match the source text exactly once. */
  old: string
  new: string
}

/** Structured edit suggestions produced by GPT in the main process. */
export type SuggestEditsAiResult =
  | { ok: true; replacements: SuggestReplacement[]; cleanedText: string; summary?: string }
  | { ok: false; code: 'MISSING_API_KEY' | 'EMPTY_TEXT' | 'BAD_RESPONSE'; message?: string }
