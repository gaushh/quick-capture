import type { TodoItemShape } from './format.ts'

/**
 * Plain `npm run dev` in the browser has no preload — `shapeChecklist` would throw.
 * When this is true, we synthesize checklist rows locally so layouts can be finished
 * before testing in Electron. Disabled in production builds and whenever `window.pill` exists.
 */
export function browserDemoUiMockActive(): boolean {
  return (
    typeof window !== `undefined` &&
    import.meta.env.DEV &&
    window.pill === undefined
  )
}

const FALLBACK_ROWS = [
  `Pick up groceries after work`,
  `Draft the quarterly outline`,
  `Book dentist for next month`,
]

/** Cheap stand-in for `format-checklist` — splits transcript; falls back if empty. */
export function todoRowsFromDemoTranscript(draft: string): Omit<TodoItemShape, `id`>[] {
  const normalized = `${draft ?? ``}`.replace(/\r/g, ``).trim()
  let pieces: string[] = []

  if (normalized.length) {
    pieces = normalized
      .split(/\n+|;/)
      .flatMap((segment) => segment.split(/\.\s+/))
      .map((segment) => segment.replace(/^[-*•]\s*/, ``).trim())
      .filter((segment) => segment.length >= 2)
  }

  const texts = pieces.length >= 1 ? pieces : FALLBACK_ROWS

  return texts.slice(0, 16).map((text) => ({
    text,
    checked: false,
  }))
}
