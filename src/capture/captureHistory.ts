export type CaptureHistoryRow = {
  id: string
  at: number
  text: string
  silent: boolean
}

const STORAGE_KEY = `quick-capture-transcript-history`
const MAX_ITEMS = 200

function clampItems(rows: CaptureHistoryRow[]) {
  return rows.slice(0, MAX_ITEMS)
}

export function loadCaptureHistory(): CaptureHistoryRow[] {
  if (typeof localStorage === `undefined`) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return clampItems(
      parsed
        .map((item) => {
          if (
            typeof item !== `object` ||
            item === null ||
            !(`id` in item) ||
            !(`at` in item) ||
            !(`text` in item)
          ) {
            return null
          }

          const r = item as Record<string, unknown>
          const id = typeof r.id === `string` ? r.id : ``
          const at = typeof r.at === `number` ? r.at : 0
          const text = typeof r.text === `string` ? r.text : ``
          const silent = Boolean(r.silent)

          return id.length && at ?
              {
                id,
                at,
                text,
                silent,
              }
            : null
        })
        .filter((x): x is CaptureHistoryRow => x !== null),
    )
  } catch {
    return []
  }
}

export function saveCaptureHistory(rows: CaptureHistoryRow[]) {
  if (typeof localStorage === `undefined`) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clampItems(rows)))
  } catch {
    //
  }
}

const SILENT_HINTS =
  /\b(no speech detected|silent|recording was silent|no audible speech|transcription failed)/i

export function classifySilentTranscript(text: string) {
  const t = text.trim()

  return !t.length || SILENT_HINTS.test(t)
}

export function updateCaptureHistoryById(id: string, text: string) {
  const prev = loadCaptureHistory()
  const next = prev.map((row) =>
    row.id === id ? { ...row, text: text.trim(), silent: classifySilentTranscript(text) } : row,
  )
  saveCaptureHistory(next)
  return next
}

export function removeCaptureHistoryById(id: string) {
  const prev = loadCaptureHistory()
  const next = prev.filter((row) => row.id !== id)

  saveCaptureHistory(next)

  return next
}

export function addCaptureHistoryEntry(text: string) {
  const silent = classifySilentTranscript(text)

  const row: CaptureHistoryRow = {
    id: crypto.randomUUID?.() ?? `h-${Date.now()}`,
    at: Date.now(),
    text: text.trim(),
    silent,
  }

  const prev = loadCaptureHistory()
  saveCaptureHistory([row, ...prev])
  return row
}

export function formatHistoryTime(at: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: `numeric`,
      minute: `2-digit`,
    }).format(new Date(at))
  } catch {
    return ``
  }
}

export type DayBucket = `today` | `yesterday` | `older`

export function bucketForTimestamp(at: number): DayBucket {
  const now = new Date()

  now.setHours(0, 0, 0, 0)

  const d = new Date(at)

  d.setHours(0, 0, 0, 0)

  const diffDays = Math.round((now.getTime() - d.getTime()) / 86400000)

  if (diffDays === 0) return `today`
  if (diffDays === 1) return `yesterday`

  return `older`
}

export const BUCKET_LABEL: Record<DayBucket, string> = {
  today: `Today`,
  yesterday: `Yesterday`,
  older: `Earlier`,
}
