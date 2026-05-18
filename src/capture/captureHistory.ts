export type CaptureTaskItem = {
  id: string
  text: string
  checked: boolean
}

export type CaptureDestinationMode = `notes` | `tasks` | `ideas` | `reminders`

export type CaptureDerivedTask = CaptureTaskItem & {
  sourceNoteId: string | null
  sourceText: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
}

export type CaptureStandaloneTask = CaptureDerivedTask

export type IdeaTag = `product` | `strategy` | `content` | `other`

export const IDEA_TAGS: IdeaTag[] = [`product`, `strategy`, `content`, `other`]

export const IDEA_TAG_LABEL: Record<IdeaTag, string> = {
  product: `Product`,
  strategy: `Strategy`,
  content: `Content`,
  other: `Other`,
}

export type CaptureDerivedIdea = {
  id: string
  sourceNoteId: string | null
  sourceText: string
  title?: string
  text: string
  tag?: IdeaTag
  createdAt: number
  updatedAt: number
}

export type CaptureDerivedReminder = {
  id: string
  sourceNoteId: string | null
  sourceText: string
  text: string
  scheduledAt?: string
  dateText?: string
  timeText?: string
  needsDateTime: boolean
  done: boolean
  createdAt: number
  updatedAt: number
}

export type CaptureDerivedItems = {
  tasks: CaptureDerivedTask[]
  ideas: CaptureDerivedIdea[]
  reminders: CaptureDerivedReminder[]
  migratedFromLegacyTasks: boolean
}

export type CaptureTaskState = {
  items: CaptureTaskItem[]
  updatedAt: number
  sourceText: string
}

export type MoveDestination = `tasks` | `ideas` | `reminders`

export type TaskStatus = `todo` | `in_progress` | `done`

export type CaptureHistoryRow = {
  id: string
  at: number
  text: string
  silent: boolean
  tasks?: CaptureTaskState
  movedTo?: MoveDestination
}

const STORAGE_KEY = `quick-capture-transcript-history`
const TASK_INBOX_STORAGE_KEY = `quick-capture-task-inbox`
const DERIVED_STORAGE_KEY = `quick-capture-derived-items`
const MAX_ITEMS = 200
const MAX_TASK_ITEMS = 50
const MAX_STANDALONE_TASKS = 200
const MAX_DERIVED_ITEMS = 300

function clampItems(rows: CaptureHistoryRow[]) {
  return rows.slice(0, MAX_ITEMS)
}

function makeStorageTaskId() {
  return crypto.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseTaskState(raw: unknown): CaptureTaskState | undefined {
  if (!raw || typeof raw !== `object`) return undefined

  const rec = raw as Record<string, unknown>
  const itemsRaw = rec.items
  if (!Array.isArray(itemsRaw)) return undefined

  const items = itemsRaw
    .map((item) => {
      if (!item || typeof item !== `object`) return null

      const itemRec = item as Record<string, unknown>
      const id = typeof itemRec.id === `string` && itemRec.id.trim().length ?
        itemRec.id.trim()
      : makeStorageTaskId()
      const text = typeof itemRec.text === `string` ? itemRec.text.trim() : ``
      const checked = Boolean(itemRec.checked)

      return text.length ? { id, text, checked } : null
    })
    .filter((item): item is CaptureTaskItem => item !== null)
    .slice(0, MAX_TASK_ITEMS)

  if (!items.length) return undefined

  return {
    items,
    updatedAt: typeof rec.updatedAt === `number` ? rec.updatedAt : Date.now(),
    sourceText: typeof rec.sourceText === `string` ? rec.sourceText : ``,
  }
}

export function loadCaptureStandaloneTasks(): CaptureStandaloneTask[] {
  if (typeof localStorage === `undefined`) return []
  try {
    const raw = localStorage.getItem(TASK_INBOX_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((item): CaptureStandaloneTask | null => {
        if (!item || typeof item !== `object`) return null

        const rec = item as Record<string, unknown>
        const text = typeof rec.text === `string` ? rec.text.trim() : ``
        if (!text.length) return null

        const now = Date.now()
        const createdAt = typeof rec.createdAt === `number` ? rec.createdAt : now
        const updatedAt = typeof rec.updatedAt === `number` ? rec.updatedAt : createdAt
        const id = typeof rec.id === `string` && rec.id.trim().length ?
          rec.id.trim()
        : makeStorageTaskId()

        return {
          id,
          text,
          checked: Boolean(rec.checked),
          sourceNoteId: null,
          sourceText: ``,
          createdAt,
          updatedAt,
        }
      })
      .filter((item): item is CaptureStandaloneTask => item !== null)
      .slice(0, MAX_STANDALONE_TASKS)
  } catch {
    return []
  }
}

export function saveCaptureStandaloneTasks(tasks: CaptureStandaloneTask[]) {
  if (typeof localStorage === `undefined`) return
  try {
    localStorage.setItem(TASK_INBOX_STORAGE_KEY, JSON.stringify(tasks.slice(0, MAX_STANDALONE_TASKS)))
  } catch {
    //
  }
}

function parseDerivedTask(item: unknown): CaptureDerivedTask | null {
  if (!item || typeof item !== `object`) return null

  const rec = item as Record<string, unknown>
  const text = typeof rec.text === `string` ? rec.text.trim() : ``
  if (!text.length) return null

  const now = Date.now()
  const createdAt = typeof rec.createdAt === `number` ? rec.createdAt : now
  const updatedAt = typeof rec.updatedAt === `number` ? rec.updatedAt : createdAt
  const id = typeof rec.id === `string` && rec.id.trim().length ? rec.id.trim() : makeStorageTaskId()
  const sourceNoteId = typeof rec.sourceNoteId === `string` && rec.sourceNoteId.trim().length ?
    rec.sourceNoteId.trim()
  : null

  const statusRaw = rec.status
  const status: TaskStatus =
    statusRaw === `todo` || statusRaw === `in_progress` || statusRaw === `done`
      ? statusRaw
      : Boolean(rec.checked) ? `done` : `todo`

  return {
    id,
    text,
    checked: status === `done`,
    sourceNoteId,
    sourceText: typeof rec.sourceText === `string` ? rec.sourceText : ``,
    status,
    createdAt,
    updatedAt,
  }
}

function parseDerivedIdea(item: unknown): CaptureDerivedIdea | null {
  if (!item || typeof item !== `object`) return null

  const rec = item as Record<string, unknown>
  const text = typeof rec.text === `string` ? rec.text.trim() : ``
  if (!text.length) return null

  const now = Date.now()
  const createdAt = typeof rec.createdAt === `number` ? rec.createdAt : now
  const updatedAt = typeof rec.updatedAt === `number` ? rec.updatedAt : createdAt
  const id = typeof rec.id === `string` && rec.id.trim().length ? rec.id.trim() : makeStorageTaskId()
  const sourceNoteId = typeof rec.sourceNoteId === `string` && rec.sourceNoteId.trim().length ?
    rec.sourceNoteId.trim()
  : null
  const title = typeof rec.title === `string` && rec.title.trim().length ? rec.title.trim() : undefined
  const tagRaw = typeof rec.tag === `string` ? rec.tag.trim().toLowerCase() : ``
  const tag: IdeaTag | undefined =
    tagRaw === `product` || tagRaw === `strategy` || tagRaw === `content` || tagRaw === `other`
      ? tagRaw
      : undefined

  return {
    id,
    sourceNoteId,
    sourceText: typeof rec.sourceText === `string` ? rec.sourceText : ``,
    ...(title ? { title } : {}),
    text,
    ...(tag ? { tag } : {}),
    createdAt,
    updatedAt,
  }
}

function parseDerivedReminder(item: unknown): CaptureDerivedReminder | null {
  if (!item || typeof item !== `object`) return null

  const rec = item as Record<string, unknown>
  const text = typeof rec.text === `string` ? rec.text.trim() : ``
  if (!text.length) return null

  const now = Date.now()
  const createdAt = typeof rec.createdAt === `number` ? rec.createdAt : now
  const updatedAt = typeof rec.updatedAt === `number` ? rec.updatedAt : createdAt
  const id = typeof rec.id === `string` && rec.id.trim().length ? rec.id.trim() : makeStorageTaskId()
  const sourceNoteId = typeof rec.sourceNoteId === `string` && rec.sourceNoteId.trim().length ?
    rec.sourceNoteId.trim()
  : null
  const scheduledAt = typeof rec.scheduledAt === `string` && rec.scheduledAt.trim().length ?
    rec.scheduledAt.trim()
  : undefined
  const dateText = typeof rec.dateText === `string` && rec.dateText.trim().length ? rec.dateText.trim() : undefined
  const timeText = typeof rec.timeText === `string` && rec.timeText.trim().length ? rec.timeText.trim() : undefined

  return {
    id,
    sourceNoteId,
    sourceText: typeof rec.sourceText === `string` ? rec.sourceText : ``,
    text,
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(dateText ? { dateText } : {}),
    ...(timeText ? { timeText } : {}),
    needsDateTime: Boolean(rec.needsDateTime),
    done: Boolean(rec.done),
    createdAt,
    updatedAt,
  }
}

function emptyDerivedItems(): CaptureDerivedItems {
  return {
    tasks: [],
    ideas: [],
    reminders: [],
    migratedFromLegacyTasks: false,
  }
}

function clampDerivedItems(items: CaptureDerivedItems): CaptureDerivedItems {
  return {
    tasks: items.tasks.slice(0, MAX_DERIVED_ITEMS),
    ideas: items.ideas.slice(0, MAX_DERIVED_ITEMS),
    reminders: items.reminders.slice(0, MAX_DERIVED_ITEMS),
    migratedFromLegacyTasks: items.migratedFromLegacyTasks,
  }
}

function parseDerivedItems(raw: string | null): CaptureDerivedItems {
  if (!raw) return emptyDerivedItems()

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== `object`) return emptyDerivedItems()

    const rec = parsed as Record<string, unknown>

    return clampDerivedItems({
      tasks: Array.isArray(rec.tasks) ?
        rec.tasks.map(parseDerivedTask).filter((item): item is CaptureDerivedTask => item !== null)
      : [],
      ideas: Array.isArray(rec.ideas) ?
        rec.ideas.map(parseDerivedIdea).filter((item): item is CaptureDerivedIdea => item !== null)
      : [],
      reminders: Array.isArray(rec.reminders) ?
        rec.reminders.map(parseDerivedReminder).filter((item): item is CaptureDerivedReminder => item !== null)
      : [],
      migratedFromLegacyTasks: Boolean(rec.migratedFromLegacyTasks),
    })
  } catch {
    return emptyDerivedItems()
  }
}

function legacyTasksFromHistory(rows: CaptureHistoryRow[]): CaptureDerivedTask[] {
  return rows.flatMap(row =>
    (row.tasks?.items ?? []).map(item => ({
      id: item.id,
      text: item.text,
      checked: item.checked,
      sourceNoteId: row.id,
      sourceText: row.tasks?.sourceText || row.text,
      createdAt: row.tasks?.updatedAt ?? row.at,
      updatedAt: row.tasks?.updatedAt ?? row.at,
    })),
  )
}

function mergeTasksById(primary: CaptureDerivedTask[], incoming: CaptureDerivedTask[]) {
  const seen = new Set(primary.map(item => item.id))
  const merged = [...primary]

  for (const task of incoming) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    merged.push(task)
  }

  return merged.slice(0, MAX_DERIVED_ITEMS)
}

export function loadCaptureDerivedItems(): CaptureDerivedItems {
  if (typeof localStorage === `undefined`) return emptyDerivedItems()

  const parsed = parseDerivedItems(localStorage.getItem(DERIVED_STORAGE_KEY))

  if (parsed.migratedFromLegacyTasks) return parsed

  const migrated = clampDerivedItems({
    ...parsed,
    tasks: mergeTasksById(
      parsed.tasks,
      [...loadCaptureStandaloneTasks(), ...legacyTasksFromHistory(loadCaptureHistory())],
    ),
    migratedFromLegacyTasks: true,
  })

  saveCaptureDerivedItems(migrated)
  return migrated
}

export function saveCaptureDerivedItems(items: CaptureDerivedItems) {
  if (typeof localStorage === `undefined`) return
  try {
    localStorage.setItem(DERIVED_STORAGE_KEY, JSON.stringify(clampDerivedItems(items)))
  } catch {
    //
  }
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
          const silent = Boolean(r.silent) || classifySilentTranscript(text)
          const tasks = parseTaskState(r.tasks)
          const movedToRaw = r.movedTo
          const movedTo: MoveDestination | undefined =
            movedToRaw === `tasks` || movedToRaw === `ideas` || movedToRaw === `reminders` ?
              movedToRaw
            : undefined

          if (!id.length || !at || silent) return null

          const row: CaptureHistoryRow = {
            id,
            at,
            text,
            silent: false,
            ...(tasks ? { tasks } : {}),
            ...(movedTo ? { movedTo } : {}),
          }

          return row
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

/**
 * Whisper commonly hallucinates these short phrases when it receives silence or
 * near-silent audio. Matched case-insensitively against the full trimmed string.
 */
const WHISPER_HALLUCINATIONS = new Set([
  `thank you`,
  `thank you.`,
  `thanks`,
  `thanks.`,
  `thanks for watching`,
  `thanks for watching.`,
  `bye`,
  `bye.`,
  `bye-bye`,
  `bye-bye.`,
  `you`,
  `you.`,
  `.`,
  `...`,
  `you know`,
  `okay`,
  `okay.`,
  `ok`,
  `ok.`,
  `hmm`,
  `hmm.`,
  `uh`,
  `uh.`,
  `um`,
  `um.`,
])

export function classifySilentTranscript(text: string) {
  const t = text.trim()

  return !t.length || SILENT_HINTS.test(t) || WHISPER_HALLUCINATIONS.has(t.toLowerCase())
}

export function updateCaptureHistoryById(id: string, text: string) {
  const prev = loadCaptureHistory()
  const nextText = text.trim()
  const next = classifySilentTranscript(nextText) ?
    prev.filter(row => row.id !== id)
  : prev.map((row) =>
      row.id === id ? { ...row, text: nextText, silent: false } : row,
    )
  saveCaptureHistory(next)
  return next
}

export function updateCaptureHistoryTasksById(
  id: string,
  tasks: CaptureTaskState | undefined,
) {
  const prev = loadCaptureHistory()
  const next = prev.map((row) =>
    row.id === id ? { ...row, ...(tasks ? { tasks } : { tasks: undefined }) } : row,
  )

  saveCaptureHistory(next)
  return next
}

export function updateCaptureHistoryMovedTo(id: string, movedTo: MoveDestination) {
  const prev = loadCaptureHistory()
  const next = prev.map(row => row.id === id ? { ...row, movedTo } : row)
  saveCaptureHistory(next)
  return next
}

export function clearCaptureHistoryMovedTo(id: string) {
  const prev = loadCaptureHistory()
  const next = prev.map(row => {
    if (row.id !== id) return row
    const updated = { ...row }
    delete updated.movedTo
    return updated
  })
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
