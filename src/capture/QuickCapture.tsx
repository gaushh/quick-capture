import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'

import {
  Bell,
  Calendar,
  Check,
  Clock,
  Copy,
  FileText,
  Inbox,
  Lightbulb,
  ListChecks,
  Mic,
  Minus,
  FolderInput,
  Moon,
  MoreHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

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
  loadCaptureDerivedItems,
  loadCaptureHistory,
  saveCaptureHistory,
  saveCaptureDerivedItems,
  updateCaptureHistoryById,
  updateCaptureHistoryMovedTo,
  clearCaptureHistoryMovedTo,
  IDEA_TAGS,
  IDEA_TAG_LABEL,
  type CaptureDerivedIdea,
  type CaptureDerivedItems,
  type CaptureDerivedReminder,
  type CaptureDerivedTask,
  type CaptureDestinationMode,
  type CaptureHistoryRow,
  type IdeaTag,
  type MoveDestination,
  type TaskStatus,
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
const MAX_TASK_ITEMS = 50

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

function trackedNoteHtmlAcceptedPlain(html: string): string {
  const root = document.createElement(`div`)

  root.innerHTML = html
  return trackedNoteAcceptedPlain(root)
}

type PastCleanupDraft = {
  rowId: string
  html: string
  session: number
}

type ActivePanel = CaptureDestinationMode
type MoveDestinationMode = Exclude<CaptureDestinationMode, `notes`>

type MoveTaskDraft = {
  id: string
  mode: `tasks`
  selected: boolean
  text: string
  status: TaskStatus
}

type MoveIdeaDraft = {
  id: string
  mode: `ideas`
  selected: boolean
  title: string
  text: string
  tag?: IdeaTag
}

type MoveReminderDraft = {
  id: string
  mode: `reminders`
  selected: boolean
  text: string
  dateText: string
  timeText: string
  scheduledAt?: string
  needsDateTime: boolean
}

type MoveReviewDraft = MoveTaskDraft | MoveIdeaDraft | MoveReminderDraft

type MoveReviewState = {
  rowId: string
  mode: MoveDestinationMode
  status: `loading` | `ready` | `error`
  error: string | null
  drafts: MoveReviewDraft[]
}

function buildTrackedSuggestionHtml(
  originalText: string,
  replacements: Array<{ old: string; new: string }>,
  cleanedText: string,
) {
  const htmlApplied = applySuggestReplacements(originalText, replacements)
  if (htmlApplied !== null && htmlApplied.includes(`qc-ai-del`)) return htmlApplied

  return applyWholeTextSuggestion(originalText, cleanedText)
}

function fallbackChecklistItems(raw: string) {
  return raw
    .split(/[\r\n.;]+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TASK_ITEMS)
    .map(text => ({ text, checked: false }))
}

function makeTaskId() {
  return crypto.randomUUID?.() ?? `task-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

/** Get safe bounds for positioning tooltips/popovers within the app window, accounting for padding. */
function getAppSafeBounds(): { top: number; left: number; right: number; bottom: number; margin: number } {
  // SHELL_PADDING is 32px total (16px each side) in output mode, 4px in other modes.
  // Detect mode based on height: idle=38px, recording=52px, output=520px
  const isOutputMode = window.innerHeight > 100 // heuristic: output mode is >100px (well above idle 38px and recording 52px)
  const padding = isOutputMode ? 16 : 4 // margin from edge to shell
  const margin = 8 // additional safety margin inside the safe bounds

  return {
    top: padding + margin,
    left: padding + margin,
    right: window.innerWidth - padding - margin,
    bottom: window.innerHeight - padding - margin,
    margin,
  }
}

/** Inner tooltip div — measures itself after mount and clamps within the app bounds, repositioning vertically if needed. */
function TooltipEl({ content, anchorRect }: { content: string; anchorRect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState<number>(() => Math.round(anchorRect.left + anchorRect.width / 2))
  const [top, setTop] = useState<number>(() => Math.round(anchorRect.top - 7))
  const [transform, setTransform] = useState<string>(`translateY(-100%)`)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const bounds = getAppSafeBounds()

    // Horizontal centering with bounds checking
    const center = anchorRect.left + anchorRect.width / 2
    const newLeft = Math.round(Math.min(Math.max(center - width / 2, bounds.left), bounds.right - width))
    setLeft(newLeft)

    // Vertical positioning: try above first, fall back to below if not enough space
    const spaceAbove = anchorRect.top - bounds.top
    const spaceBelow = bounds.bottom - anchorRect.bottom
    const tooltipHeight = height + 12 // tooltip height + gap

    let newTop: number
    let newTransform: string

    if (spaceAbove >= tooltipHeight) {
      // Position above anchor
      newTop = Math.round(anchorRect.top - 7)
      newTransform = `translateY(-100%)`
    } else if (spaceBelow >= tooltipHeight) {
      // Position below anchor
      newTop = Math.round(anchorRect.bottom + 7)
      newTransform = `translateY(0%)`
    } else {
      // Not enough space either way, use above but may be clipped
      newTop = Math.round(Math.max(bounds.top, anchorRect.top - 7))
      newTransform = `translateY(-100%)`
    }

    setTop(newTop)
    setTransform(newTransform)
  }, [anchorRect])

  return (
    <div
      ref={ref}
      className="qc-tooltip"
      style={{
        position: `fixed`,
        left,
        top,
        transform,
        pointerEvents: `none`,
        zIndex: 9999,
      }}
    >
      {content}
    </div>
  )
}

/** Lightweight styled tooltip — wraps a single child element, renders via portal so overflow:hidden never clips it. */
function Tip({ content, children }: { content: string; children: ReactElement }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    const anchor = anchorRef.current?.firstElementChild
    if (anchor instanceof HTMLElement) {
      const captured = anchor.getBoundingClientRect()
      timerRef.current = setTimeout(() => setRect(captured), 500)
    }
  }

  const handleMouseLeave = () => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    setRect(null)
  }

  return (
    <>
      <span
        ref={anchorRef}
        className="qc-tip-anchor"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>
      {rect && createPortal(<TooltipEl content={content} anchorRect={rect} />, document.body)}
    </>
  )
}

/**
 * Feed-entry text: collapsed = 3-line clamp with `…` (click to expand accordion-style),
 * expanded = full text as contentEditable. Saves on blur.
 */
function PastEntryText({
  row,
  textClassName = `qc-feed-past-text qc-feed-body-text`,
  cleanupHtml,
  cleanupSession,
  onCleanupHtmlChange,
  onSave: _onSave,
}: {
  row: { id: string; text: string; silent: boolean }
  textClassName?: string
  editableClassName?: string
  cleanupHtml?: string
  cleanupSession?: number
  onCleanupHtmlChange?: (html: string) => void
  onSave: (newText: string) => void
}) {
  const cleanupRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = cleanupRef.current
    if (!el || cleanupHtml === undefined) return
    if (el.innerHTML !== cleanupHtml) el.innerHTML = cleanupHtml
  }, [cleanupHtml, cleanupSession])

  // Refine/tracked-changes mode — editable diff view only
  if (cleanupHtml !== undefined) {
    return (
      <div className="qc-feed-truncate-slot">
        <div
          ref={cleanupRef}
          role="textbox"
          aria-multiline={true}
          aria-label="Cleaned note suggestions"
          contentEditable={true}
          suppressContentEditableWarning={true}
          spellCheck={true}
          className="qc-tracked-note-root qc-feed-past-tracked"
          onPointerDownCapture={e => {
            const edited = acceptTrackedAdditionAtPointer(e.currentTarget, e.target)
            if (edited) {
              e.preventDefault()
              onCleanupHtmlChange?.(e.currentTarget.innerHTML)
            }
          }}
          onInput={e => {
            onCleanupHtmlChange?.(e.currentTarget.innerHTML)
          }}
        />
      </div>
    )
  }

  // Plain read-only transcript
  return (
    <div className="qc-feed-truncate-slot">
      <p className={`${textClassName} whitespace-pre-wrap`}>
        {row.text}
      </p>
    </div>
  )
}

type DestinationRailProps = {
  activePanel: ActivePanel
  noteCount: number
  taskCount: number
  ideaCount: number
  reminderCount: number
  onSelect: (panel: ActivePanel) => void
}

function DestinationRail({
  activePanel,
  noteCount,
  taskCount,
  ideaCount,
  reminderCount,
  onSelect,
}: DestinationRailProps) {
  const items: Array<{
    panel: ActivePanel
    label: string
    count: number
    icon: ReactElement
  }> = [
    { panel: `notes`, label: `All notes`, count: noteCount, icon: <InboxIcon size={16} /> },
    { panel: `tasks`, label: `Tasks`, count: taskCount, icon: <ChecklistIcon size={16} /> },
    { panel: `ideas`, label: `Ideas`, count: ideaCount, icon: <IdeaIcon size={16} /> },
    { panel: `reminders`, label: `Reminders`, count: reminderCount, icon: <ReminderIcon size={16} /> },
  ]

  return (
    <nav className="qc-left-rail" aria-label="Thought categories">
      {items.map(item => (
        <Tip
          key={item.panel}
          content={item.count > 0 ? `${item.label} · ${item.count}` : item.label}
        >
          <button
            type="button"
            className={`qc-left-rail__item${activePanel === item.panel ? ` qc-left-rail__item--active` : ``}`}
            onClick={() => onSelect(item.panel)}
            aria-pressed={activePanel === item.panel}
            aria-label={item.label}
          >
            <span className="qc-left-rail__icon">{item.icon}</span>
          </button>
        </Tip>
      ))}
    </nav>
  )
}

const STATUS_ORDER: TaskStatus[] = [`todo`, `in_progress`, `done`]
const STATUS_LABEL: Record<TaskStatus, string> = {
  in_progress: `In Progress`,
  todo: `Not Started`,
  done: `Done`,
}

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === `done`) {
    return (
      <span className="qc-status-icon qc-status-icon--done" aria-label="Done">
        <CheckIcon size={9} />
      </span>
    )
  }
  if (status === `in_progress`) {
    return <span className="qc-status-icon qc-status-icon--in-progress" aria-label="In Progress" />
  }
  return <span className="qc-status-icon qc-status-icon--todo" aria-label="To Do" />
}

function TaskStatusPicker({
  status,
  onSetStatus,
}: {
  status: TaskStatus
  onSetStatus: (s: TaskStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, openUp: false })
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const POPOVER_H = 116 // approx height of the 3-item popover
  const POPOVER_W = 180 // conservative width incl. icon + label + padding

  function openPicker(e: MouseEvent) {
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const bounds = getAppSafeBounds()

      // Vertical positioning: try below, fall back to above if not enough space
      const spaceBelow = bounds.bottom - r.bottom
      const spaceAbove = r.top - bounds.top
      const openUp = spaceBelow < POPOVER_H + 12 && spaceAbove >= POPOVER_H + 12
      const top = openUp ? r.top - POPOVER_H - 6 : r.bottom + 6

      // Horizontal positioning: prefer left-align, flip to right-align if it would overflow
      const overflowsRight = r.left + POPOVER_W > bounds.right
      const overflowsLeft = r.right - POPOVER_W < bounds.left
      let left: number

      if (overflowsRight && !overflowsLeft) {
        // Flip to right-align
        left = Math.max(bounds.left, r.right - POPOVER_W)
      } else if (overflowsLeft && !overflowsRight) {
        // Keep left-align (already correct)
        left = Math.max(bounds.left, r.left)
      } else if (overflowsRight && overflowsLeft) {
        // Both overflow: center it within bounds
        left = Math.max(bounds.left, Math.min(bounds.right - POPOVER_W, r.left + r.width / 2 - POPOVER_W / 2))
      } else {
        // Neither overflows: prefer left-align with button
        left = r.left
      }

      setPopoverPos({ top, left, openUp })
    }
    setOpen(prev => !prev)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener(`mousedown`, close)
    return () => document.removeEventListener(`mousedown`, close)
  }, [open])

  return (
    <div className="qc-status-wrap">
      <button
        ref={btnRef}
        type="button"
        className="qc-status-btn"
        aria-label="Change status"
        onClick={openPicker}
      >
        <TaskStatusIcon status={status} />
      </button>
      {open && createPortal(
        <div
          className="qc-status-popover"
          role="menu"
          style={{ position: `fixed`, top: popoverPos.top, left: popoverPos.left, transformOrigin: popoverPos.openUp ? `bottom left` : `top left` }}
          onMouseDown={e => e.stopPropagation()}
        >
          {STATUS_ORDER.map(s => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className={`qc-status-popover__item${s === status ? ` qc-status-popover__item--active` : ``}`}
              onClick={e => { e.stopPropagation(); onSetStatus(s); setOpen(false) }}
            >
              <TaskStatusIcon status={s} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

type TaskManagerPanelProps = {
  tasks: CaptureDerivedTask[]
  addText: string
  onAddTextChange: (value: string) => void
  onAddTask: () => void
  onCopy: () => void
  onSetStatus: (taskId: string, status: TaskStatus) => void
  onEdit: (taskId: string, text: string) => void
  onRemove: (taskId: string) => void
}

function TaskManagerPanel({
  tasks,
  addText,
  onAddTextChange,
  onAddTask,
  onCopy,
  onSetStatus,
  onEdit,
  onRemove,
}: TaskManagerPanelProps) {
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | null>(null)

  const filteredTasks = selectedStatus ? tasks.filter(t => t.status === selectedStatus) : tasks

  const todoCount = tasks.filter(t => t.status === `todo`).length
  const inProgressCount = tasks.filter(t => t.status === `in_progress`).length
  const doneCount = tasks.filter(t => t.status === `done`).length

  const grouped = STATUS_ORDER
    .map(status => ({ status, items: filteredTasks.filter(t => t.status === status) }))
    .filter(g => g.items.length > 0)

  return (
    <section className="qc-derived-panel" aria-label="Tasks">
      <div className="qc-derived-panel__summary">
        <div className="qc-derived-panel__title">Tasks <span className="qc-pill-count">({tasks.length})</span></div>
      </div>

      <div className="qc-task-filter-pills">
        {STATUS_ORDER.map(status => (
          <button
            key={status}
            type="button"
            className={`qc-status-pill qc-status-pill--${status}${selectedStatus === status ? ` qc-status-pill--selected` : ``}`}
            onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
            aria-pressed={selectedStatus === status}
          >
            {STATUS_LABEL[status]} <span className="qc-pill-count">({status === `todo` ? todoCount : status === `in_progress` ? inProgressCount : doneCount})</span>
          </button>
        ))}
      </div>

      <div className="qc-task-list">
        {!tasks.length && (
          <div className="qc-derived-panel__empty">
            Choose <span>Move to...</span> on a note and select Tasks.
          </div>
        )}

        {grouped.map(group => (
          <div key={group.status} className="qc-task-group">
            <div className="qc-task-group__label">
              {STATUS_LABEL[group.status]}
              <span className="qc-task-group__count">({group.items.length})</span>
            </div>
            {group.items.map(task => (
              <div key={task.id} className={`qc-task-row${task.status === `done` ? ` qc-task-row--done` : ``}`}>
                <TaskStatusPicker status={task.status} onSetStatus={s => onSetStatus(task.id, s)} />
                <input
                  key={`${task.id}-${task.text}`}
                  type="text"
                  className="qc-task-text"
                  defaultValue={task.text}
                  onBlur={e => onEdit(task.id, e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === `Enter`) e.currentTarget.blur() }}
                  aria-label="Task"
                />
                <button
                  type="button"
                  className="qc-task-remove"
                  onClick={() => onRemove(task.id)}
                  aria-label="Remove task"
                >
                  <XIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        ))}

        <form
          className="qc-task-add-row"
          onSubmit={e => { e.preventDefault(); onAddTask() }}
        >
          <span className="qc-task-add-circle" aria-hidden="true" />
          <input
            type="text"
            className="qc-task-text"
            value={addText}
            onChange={e => onAddTextChange(e.currentTarget.value)}
            placeholder="New task…"
            aria-label="Add task"
            maxLength={280}
          />
        </form>
      </div>
    </section>
  )
}

type IdeasPanelProps = {
  ideas: CaptureDerivedIdea[]
  onEdit: (ideaId: string, patch: Partial<Pick<CaptureDerivedIdea, `title` | `text` | `tag`>>) => void
  onRemove: (ideaId: string) => void
}

function IdeasPanel({ ideas, onEdit, onRemove }: IdeasPanelProps) {
  const [selectedTag, setSelectedTag] = useState<ExtractIdeaTag | null>(null)

  const filteredIdeas = selectedTag ? ideas.filter(idea => idea.tag === selectedTag) : ideas
  const tagCounts = IDEA_TAGS.reduce((acc, tag) => {
    acc[tag] = ideas.filter(idea => idea.tag === tag).length
    return acc
  }, {} as Record<ExtractIdeaTag, number>)

  return (
    <section className="qc-derived-panel" aria-label="Ideas">
      <div className="qc-derived-panel__summary">
        <div className="qc-derived-panel__title">Ideas <span className="qc-pill-count">({ideas.length})</span></div>
      </div>

      <div className="qc-ideas-filter-pills">
        {IDEA_TAGS.map(tag => (
          <button
            key={tag}
            type="button"
            className={`qc-tag-pill qc-tag-pill--${tag}${selectedTag === tag ? ` qc-tag-pill--selected` : ``}`}
            onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            aria-pressed={selectedTag === tag}
          >
            {IDEA_TAG_LABEL[tag]} <span className="qc-pill-count">({tagCounts[tag]})</span>
          </button>
        ))}
      </div>

      <div className="qc-derived-panel__list">
        {!filteredIdeas.length && (
          <div className="qc-derived-panel__empty">
            {selectedTag
              ? `No ideas with this tag. ${ideas.length > 0 ? `Clear filter to see all.` : `Move notes here to shape ideas`}`
              : `Choose <span>Move to...</span> on a note and select Ideas.`}
          </div>
        )}

        {filteredIdeas.map(idea => (
          <article key={idea.id} className="qc-derived-panel__card qc-idea-card">
            <div className="qc-idea-card__head">
              <input
                key={`${idea.id}-title-${idea.title ?? ``}`}
                type="text"
                className="qc-idea-card__title"
                defaultValue={idea.title ?? ``}
                placeholder="Untitled idea"
                onBlur={e => onEdit(idea.id, { title: e.currentTarget.value })}
                aria-label="Idea title"
              />
              <IdeaTagPicker
                tag={idea.tag}
                onSetTag={t => onEdit(idea.id, { tag: t })}
              />
              <button
                type="button"
                className="qc-derived-panel__remove"
                onClick={() => onRemove(idea.id)}
                aria-label="Remove idea"
              >
                <XIcon size={13} />
              </button>
            </div>
            <textarea
              key={`${idea.id}-text-${idea.text}`}
              className="qc-idea-card__text"
              defaultValue={idea.text}
              placeholder="Add context, the so-what, the next move..."
              onBlur={e => onEdit(idea.id, { text: e.currentTarget.value })}
              aria-label="Idea"
              rows={2}
            />
            {idea.sourceText && <p className="qc-derived-panel__source">{idea.sourceText}</p>}
          </article>
        ))}
      </div>
    </section>
  )
}

type RemindersPanelProps = {
  reminders: CaptureDerivedReminder[]
  onToggle: (reminderId: string, done: boolean) => void
  onEdit: (reminderId: string, patch: Partial<Pick<CaptureDerivedReminder, `text` | `dateText` | `timeText`>>) => void
  onRemove: (reminderId: string) => void
}

type ReminderGroup = 'upcoming' | 'past' | 'no-date'

function getReminderGroup(reminder: CaptureDerivedReminder): ReminderGroup {
  if (!reminder.dateText) return `no-date`

  const reminderDate = new Date(reminder.dateText)
  reminderDate.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return reminderDate >= today ? `upcoming` : `past`
}

function isReminderPast(reminder: CaptureDerivedReminder): boolean {
  if (!reminder.dateText) return false
  const reminderDate = new Date(reminder.dateText)
  reminderDate.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return reminderDate < today
}

const REMINDER_GROUP_ORDER: ReminderGroup[] = [`upcoming`, `past`, `no-date`]
const REMINDER_GROUP_LABEL: Record<ReminderGroup, string> = {
  upcoming: `Upcoming`,
  past: `Past`,
  'no-date': `No Date Set`,
}

function RemindersPanel({ reminders, onToggle, onEdit, onRemove }: RemindersPanelProps) {
  const [selectedReminderGroup, setSelectedReminderGroup] = useState<ReminderGroup | null>(null)
  const openReminders = reminders.filter(reminder => !reminder.done).length

  const groupCounts = REMINDER_GROUP_ORDER.reduce((acc, group) => {
    acc[group] = reminders.filter(r => getReminderGroup(r) === group).length
    return acc
  }, {} as Record<ReminderGroup, number>)

  const filteredReminders = selectedReminderGroup
    ? reminders.filter(r => getReminderGroup(r) === selectedReminderGroup)
    : reminders

  const grouped = REMINDER_GROUP_ORDER
    .map(group => ({
      group,
      items: filteredReminders.filter(r => getReminderGroup(r) === group),
    }))
    .filter(g => g.items.length > 0)

  return (
    <section className="qc-derived-panel" aria-label="Reminders">
      <div className="qc-derived-panel__summary">
        <div className="qc-derived-panel__title">Reminders <span className="qc-pill-count">({reminders.length})</span></div>
      </div>

      <div className="qc-reminder-filter-pills">
        {REMINDER_GROUP_ORDER.map(group => (
          <button
            key={group}
            type="button"
            className={`qc-reminder-group-pill${selectedReminderGroup === group ? ` qc-reminder-group-pill--selected` : ``}`}
            onClick={() => setSelectedReminderGroup(selectedReminderGroup === group ? null : group)}
            aria-pressed={selectedReminderGroup === group}
          >
            {REMINDER_GROUP_LABEL[group]} <span className="qc-pill-count">({groupCounts[group]})</span>
          </button>
        ))}
      </div>

      <div className="qc-derived-panel__list">
        {!filteredReminders.length && (
          <div className="qc-derived-panel__empty">
            {selectedReminderGroup
              ? `No reminders in this category. ${reminders.length > 0 ? `Clear filter to see all.` : `Choose Move to... on a note and select Reminders.`}`
              : `Choose <span>Move to...</span> on a note and select Reminders.`}
          </div>
        )}

        {grouped.map(group => (
          <div key={group.group} className="qc-reminder-group">
            <div className="qc-reminder-group__label">
              {REMINDER_GROUP_LABEL[group.group]}
              <span className="qc-reminder-group__count">({group.items.length})</span>
            </div>
            {group.items.map(reminder => (
              <div key={reminder.id} className={`qc-derived-panel__item qc-derived-panel__item--reminder${reminder.done ? ` qc-derived-panel__item--done` : ``}`}>
                <div className="qc-reminder-item-main">
                  <textarea
                    key={`${reminder.id}-text-${reminder.text}`}
                    className="qc-reminder-item-text"
                    defaultValue={reminder.text}
                    onBlur={e => onEdit(reminder.id, { text: e.currentTarget.value })}
                    aria-label="Reminder"
                  />
                  <div className={`qc-reminder-item-meta${isReminderPast(reminder) ? ` qc-reminder-item-meta--past` : ` qc-reminder-item-meta--upcoming`}`}>
                    <input
                      key={`${reminder.id}-date-${reminder.dateText ?? ``}`}
                      type="date"
                      className="qc-reminder-input-date"
                      defaultValue={reminder.dateText ?? ``}
                      onBlur={e => onEdit(reminder.id, { dateText: e.currentTarget.value })}
                      aria-label="Reminder date"
                      title="Set date"
                    />
                    <input
                      key={`${reminder.id}-time-${reminder.timeText ?? ``}`}
                      type="time"
                      className="qc-reminder-input-time"
                      defaultValue={reminder.timeText ?? ``}
                      onBlur={e => onEdit(reminder.id, { timeText: e.currentTarget.value })}
                      aria-label="Reminder time"
                      title="Set time"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="qc-derived-panel__remove qc-reminder-remove"
                  onClick={() => onRemove(reminder.id)}
                  aria-label="Remove reminder"
                >
                  <XIcon size={13} />
                </button>
                {reminder.needsDateTime && <div className="qc-reminder-needs-datetime">Needs date/time</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Reminder quick-pick helpers ────────────────────────────────

const REMINDER_QUICK_TIME = `08:00`

function dateToYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, `0`)
  const day = String(d.getDate()).padStart(2, `0`)
  return `${y}-${m}-${day}`
}

function formatPresetDate(dateText: string, timeText: string): string {
  if (!dateText) return `¯\\_(ツ)_/¯`
  try {
    const d = new Date(`${dateText}T${timeText || REMINDER_QUICK_TIME}:00`)
    const DAY = [`SUN`, `MON`, `TUE`, `WED`, `THU`, `FRI`, `SAT`][d.getDay()]
    const h = parseInt((timeText || REMINDER_QUICK_TIME).split(`:`)[0] ?? `8`, 10)
    const ampm = h >= 12 ? `PM` : `AM`
    const h12 = h % 12 || 12
    const mm = (timeText || REMINDER_QUICK_TIME).split(`:`)[1] ?? `00`
    return `${DAY}, ${h12}:${mm} ${ampm}`
  } catch {
    return dateText
  }
}

type ReminderPreset = { id: string; label: string; dateText: string; timeText: string }

function buildReminderPresets(): ReminderPreset[] {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  const nextWeek = new Date()
  const twd = nextWeek.getDay()
  nextWeek.setDate(nextWeek.getDate() + (twd === 0 ? 8 : (8 - twd) % 7 || 7))

  const nextWeekend = new Date()
  const wd = nextWeekend.getDay()
  nextWeekend.setDate(nextWeekend.getDate() + (wd === 6 ? 7 : (6 - wd + 7) % 7 || 7))

  return [
    { id: `tomorrow`,     label: `tomorrow`,     dateText: dateToYMD(tomorrow),    timeText: REMINDER_QUICK_TIME },
    { id: `next-week`,    label: `next week`,    dateText: dateToYMD(nextWeek),    timeText: REMINDER_QUICK_TIME },
    { id: `next-weekend`, label: `next weekend`, dateText: dateToYMD(nextWeekend), timeText: REMINDER_QUICK_TIME },
    { id: `someday`,      label: `someday`,      dateText: ``,                      timeText: `` },
  ]
}

function parseNaturalLanguageDateTime(input: string): { dateText: string; timeText: string } | null {
  const lower = input.toLowerCase().trim()
  if (!lower) return null

  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  let hour = 8
  let minute = 0

  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10)
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
    if (timeMatch[3] === `pm` && hour < 12) hour += 12
    if (timeMatch[3] === `am` && hour === 12) hour = 0
  }

  const timeText = `${String(hour).padStart(2, `0`)}:${String(minute).padStart(2, `0`)}`

  let targetDate = new Date()

  if (lower.includes(`tomorrow`)) {
    targetDate.setDate(targetDate.getDate() + 1)
  } else if (lower.includes(`today`)) {
    // Use current date
  } else if (lower.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/)) {
    const dayMap: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    }
    const dayMatch = Object.entries(dayMap).find(([name]) => lower.includes(name))
    if (dayMatch) {
      const targetDay = dayMatch[1]
      let daysAhead = targetDay - targetDate.getDay()
      if (daysAhead <= 0) daysAhead += 7
      targetDate.setDate(targetDate.getDate() + daysAhead)
    }
  } else if (lower.includes(`next week`)) {
    const nw = new Date()
    const twd = nw.getDay()
    nw.setDate(nw.getDate() + (twd === 0 ? 8 : (8 - twd) % 7 || 7))
    targetDate = nw
  } else if (lower.includes(`next weekend`)) {
    const nwe = new Date()
    const wd = nwe.getDay()
    nwe.setDate(nwe.getDate() + (wd === 6 ? 7 : (6 - wd + 7) % 7 || 7))
    targetDate = nwe
  } else if (lower.match(/in\s+(\d+)\s+days?/)) {
    const match = lower.match(/in\s+(\d+)\s+days?/)
    if (match) {
      targetDate.setDate(targetDate.getDate() + parseInt(match[1], 10))
    }
  } else if (lower.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)) {
    const match = lower.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)
    if (match) {
      const monthMap: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      }
      const day = parseInt(match[1], 10)
      const month = monthMap[match[2]]
      targetDate.setMonth(month)
      targetDate.setDate(day)
      if (targetDate < new Date()) {
        targetDate.setFullYear(targetDate.getFullYear() + 1)
      }
    }
  }

  const dateText = dateToYMD(targetDate)
  return { dateText, timeText }
}

function ReminderQuickPick({
  dateText,
  timeText,
  onPick,
}: {
  dateText: string
  timeText: string
  onPick: (dateText: string, timeText: string) => void
}) {
  const [inputValue, setInputValue] = useState(``)
  const presets = useMemo(() => buildReminderPresets(), [])

  function handleInputChange(value: string) {
    setInputValue(value)
    const parsed = parseNaturalLanguageDateTime(value)
    if (parsed) {
      onPick(parsed.dateText, parsed.timeText)
    }
  }

  return (
    <div className="qc-reminder-quick-pick-wrapper">
      <div className="qc-reminder-quick-pick">
        {presets.map(p => {
          const isSomeday = p.id === `someday`
          const isSelected = isSomeday
            ? !dateText
            : p.dateText === dateText && p.timeText === timeText
          return (
            <button
              key={p.id}
              type="button"
              className={`qc-reminder-preset${isSelected ? ` qc-reminder-preset--selected` : ``}`}
              onClick={() => {
                setInputValue(``)
                onPick(p.dateText, p.timeText)
              }}
            >
              <span className="qc-reminder-preset__label">{p.label}</span>
              <span className="qc-reminder-preset__date">
                {isSomeday ? `¯\\_(ツ)_/¯` : formatPresetDate(p.dateText, p.timeText)}
              </span>
            </button>
          )
        })}
      </div>
      <input
        type="text"
        className="qc-reminder-natural-input"
        placeholder="Or type: tomorrow 3pm, friday 9am, aug 7..."
        value={inputValue}
        onChange={e => handleInputChange(e.currentTarget.value)}
        aria-label="Type date and time"
      />
    </div>
  )
}

function IdeaTagPicker({
  tag,
  onSetTag,
}: {
  tag: IdeaTag | undefined
  onSetTag: (next: IdeaTag | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, openUp: false })
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const POPOVER_H = 150
  const POPOVER_W = 180

  function openPicker(e: MouseEvent) {
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const bounds = getAppSafeBounds()

      // Vertical positioning: try below, fall back to above if not enough space
      const spaceBelow = bounds.bottom - r.bottom
      const spaceAbove = r.top - bounds.top
      const openUp = spaceBelow < POPOVER_H + 12 && spaceAbove >= POPOVER_H + 12
      const top = openUp ? r.top - POPOVER_H - 6 : r.bottom + 6

      // Horizontal positioning: prefer left-align, flip to right-align if it would overflow
      const overflowsRight = r.left + POPOVER_W > bounds.right
      const overflowsLeft = r.right - POPOVER_W < bounds.left
      let left: number

      if (overflowsRight && !overflowsLeft) {
        // Flip to right-align
        left = Math.max(bounds.left, r.right - POPOVER_W)
      } else if (overflowsLeft && !overflowsRight) {
        // Keep left-align (already correct)
        left = Math.max(bounds.left, r.left)
      } else if (overflowsRight && overflowsLeft) {
        // Both overflow: center it within bounds
        left = Math.max(bounds.left, Math.min(bounds.right - POPOVER_W, r.left + r.width / 2 - POPOVER_W / 2))
      } else {
        // Neither overflows: prefer left-align with button
        left = r.left
      }

      setPopoverPos({ top, left, openUp })
    }
    setOpen(prev => !prev)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener(`mousedown`, close)
    return () => document.removeEventListener(`mousedown`, close)
  }, [open])

  return (
    <div className="qc-tag-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`qc-tag-pill${tag ? ` qc-tag-pill--${tag}` : ` qc-tag-pill--empty`}`}
        aria-label="Change tag"
        onClick={openPicker}
      >
        <span className="qc-tag-pill__dot" aria-hidden />
        {tag ? IDEA_TAG_LABEL[tag] : `Tag`}
      </button>
      {open && createPortal(
        <div
          className="qc-tag-popover"
          role="menu"
          style={{ position: `fixed`, top: popoverPos.top, left: popoverPos.left, transformOrigin: popoverPos.openUp ? `bottom left` : `top left` }}
          onMouseDown={e => e.stopPropagation()}
        >
          {IDEA_TAGS.map(t => (
            <button
              key={t}
              type="button"
              role="menuitem"
              className={`qc-tag-popover__item qc-tag-popover__item--${t}${t === tag ? ` qc-tag-popover__item--active` : ``}`}
              onClick={e => { e.stopPropagation(); onSetTag(t === tag ? undefined : t); setOpen(false) }}
            >
              <span className={`qc-tag-pill__dot qc-tag-pill__dot--${t}`} aria-hidden />
              {IDEA_TAG_LABEL[t]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}

type MoveReviewModalProps = {
  state: MoveReviewState
  row: CaptureHistoryRow | null
  shellEl: HTMLElement | null
  onClose: () => void
  onAccept: () => void
  onToggleDraft: (draftId: string, selected: boolean) => void
  onUpdateDraft: (draftId: string, patch: Partial<MoveReviewDraft>) => void
}

function destinationLabel(mode: MoveDestinationMode) {
  if (mode === `tasks`) return `Tasks`
  if (mode === `ideas`) return `Ideas`
  return `Reminders`
}

function MoveReviewModal({
  state,
  row,
  shellEl,
  onClose,
  onAccept,
  onToggleDraft,
  onUpdateDraft,
}: MoveReviewModalProps) {
  const selectedCount = state.drafts.filter(draft => draft.selected).length
  const hasMissingReminderTime = state.drafts.some(draft =>
    draft.mode === `reminders` &&
    draft.selected &&
    draft.needsDateTime,
  )
  const canAccept =
    state.status === `ready` &&
    selectedCount > 0 &&
    !hasMissingReminderTime

  return createPortal(
    <div className="qc-move-modal" role="dialog" aria-modal="true" aria-label={`Move to ${destinationLabel(state.mode)}`}>
      <div className="qc-move-modal__sheet">
        <div className="qc-move-modal__header">
          <div className="qc-move-modal__header-left">
            <div className="qc-move-modal__title">Move to {destinationLabel(state.mode)}</div>
            {state.mode !== `reminders` && <p>{row?.text ?? ``}</p>}
          </div>
          <div className="qc-move-modal__header-actions">
            <button type="button" className="qc-move-modal__text-btn qc-move-modal__text-btn--cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="qc-move-modal__text-btn qc-move-modal__text-btn--confirm" disabled={!canAccept} onClick={onAccept}>
              Add {selectedCount || ``} {destinationLabel(state.mode)}
            </button>
          </div>
        </div>

        <div className="qc-move-modal__body">
          {state.status === `loading` && (
            <div className="qc-move-modal__status">
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-solid"
                style={{
                  borderColor: `var(--qc-border-strong)`,
                  borderTopColor: `var(--qc-accent)`,
                }}
              />
              <span>Finding {destinationLabel(state.mode).toLowerCase()}…</span>
            </div>
          )}

          {state.status === `error` && (
            <div className="qc-move-modal__empty">
              {state.error ?? `Could not extract anything useful.`}
            </div>
          )}

          {state.status === `ready` && state.drafts.length === 0 && (
            <div className="qc-move-modal__empty">
              Nothing obvious to add. Try refining the note or choose another destination.
            </div>
          )}

          {state.status === `ready` && state.drafts.map(draft => {
            if (draft.mode === `tasks`) {
              return (
                <div key={draft.id} className="qc-move-modal__task-row">
                  <button
                    type="button"
                    className={`qc-task-check${draft.selected ? ` qc-task-check--selected` : ` qc-task-check--unchecked`}`}
                    onClick={() => onToggleDraft(draft.id, !draft.selected)}
                    aria-label={draft.selected ? `Deselect` : `Select`}
                  >
                    {draft.selected && <CheckIcon size={10} />}
                  </button>
                  <input
                    type="text"
                    className="qc-task-text"
                    value={draft.text}
                    onChange={e => onUpdateDraft(draft.id, { text: e.currentTarget.value } as Partial<MoveReviewDraft>)}
                    aria-label="Task"
                  />
                  <TaskStatusPicker
                    status={draft.status}
                    onSetStatus={s => onUpdateDraft(draft.id, { status: s } as Partial<MoveReviewDraft>)}
                  />
                </div>
              )
            }

            if (draft.mode === `ideas`) {
              return (
                <div key={draft.id} className={`qc-move-modal__idea-row${draft.selected ? `` : ` qc-move-modal__idea-row--muted`}`}>
                  <button
                    type="button"
                    className={`qc-task-check${draft.selected ? ` qc-task-check--selected` : ` qc-task-check--unchecked`}`}
                    onClick={() => onToggleDraft(draft.id, !draft.selected)}
                    aria-label={draft.selected ? `Deselect` : `Select`}
                  >
                    {draft.selected && <CheckIcon size={10} />}
                  </button>
                  <div className="qc-idea-row__body">
                    <div className="qc-idea-row__head">
                      <input
                        type="text"
                        className="qc-idea-row__title"
                        value={draft.title}
                        placeholder="Untitled idea"
                        onChange={e => onUpdateDraft(draft.id, { title: e.currentTarget.value } as Partial<MoveReviewDraft>)}
                        aria-label="Idea title"
                      />
                      <IdeaTagPicker
                        tag={draft.tag}
                        onSetTag={t => onUpdateDraft(draft.id, { tag: t } as Partial<MoveReviewDraft>)}
                      />
                    </div>
                    <textarea
                      className="qc-idea-row__text"
                      value={draft.text}
                      placeholder="Add context, the so-what, the next move..."
                      onChange={e => onUpdateDraft(draft.id, { text: e.currentTarget.value } as Partial<MoveReviewDraft>)}
                      aria-label="Idea body"
                      rows={2}
                    />
                  </div>
                </div>
              )
            }

            return (
              <div key={draft.id} className="qc-move-modal__reminder-row">
                <input
                  type="text"
                  className="qc-reminder-text"
                  value={draft.text}
                  placeholder="What do you want to be reminded about?"
                  onChange={e => onUpdateDraft(draft.id, { text: e.currentTarget.value } as Partial<MoveReviewDraft>)}
                  aria-label="Reminder"
                />
                <ReminderQuickPick
                  dateText={draft.dateText}
                  timeText={draft.timeText}
                  onPick={(dateText, timeText) =>
                    onUpdateDraft(draft.id, {
                      dateText,
                      timeText,
                      needsDateTime: false,
                    } as Partial<MoveReviewDraft>)
                  }
                />
              </div>
            )
          })}
        </div>

      </div>
    </div>,
    shellEl || document.body,
  )
}


const SW = 1.65 // shared Lucide stroke weight

/** "Improve note" sparkle */
function ImproveIconOutline({ size = 17 }: { size?: number }) {
  return <Sparkles size={size} strokeWidth={SW} />
}

/** Sheet / notes — idle pill primary control */
function NotesIcon({ size = 17 }: { size?: number }) {
  return <FileText size={size} strokeWidth={SW} />
}

function CopyIcon({ size = 16 }: { size?: number }) {
  return <Copy size={size} strokeWidth={SW} />
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return <Trash2 size={size} strokeWidth={SW} aria-hidden />
}

function CheckIcon({ size = 18 }: { size?: number }) {
  return <Check size={size} strokeWidth={SW} />
}

function ChecklistIcon({ size = 15 }: { size?: number }) {
  return <ListChecks size={size} strokeWidth={SW} />
}

function InboxIcon({ size = 15 }: { size?: number }) {
  return <Inbox size={size} strokeWidth={SW} />
}

function IdeaIcon({ size = 15 }: { size?: number }) {
  return <Lightbulb size={size} strokeWidth={SW} />
}

function ReminderIcon({ size = 15 }: { size?: number }) {
  return <Bell size={size} strokeWidth={SW} />
}

function CalendarIcon({ size = 15 }: { size?: number }) {
  return <Calendar size={size} strokeWidth={SW} />
}

function ClockIcon({ size = 15 }: { size?: number }) {
  return <Clock size={size} strokeWidth={SW} />
}

function MoreIcon({ size = 15 }: { size?: number }) {
  return <FolderInput size={size} strokeWidth={SW} />
}

/** Title-bar style minimize (floating window chrome). */
function WindowMinimizeIcon() {
  return <Minus size={15} strokeWidth={SW} aria-hidden />
}

/** Dismiss overlay (hides pill; same behaviour as ESC). */
function WindowCloseIcon() {
  return <X size={15} strokeWidth={SW} aria-hidden />
}

function XIcon({ size = 13 }: { size?: number }) {
  return <X size={size} strokeWidth={SW} aria-hidden />
}

function UndoIcon({ size = 15 }: { size?: number }) {
  return <Undo2 size={size} strokeWidth={SW} aria-hidden />
}

function MoonIcon({ size = 14 }: { size?: number }) {
  return <Moon size={size} strokeWidth={SW} aria-hidden />
}

function SunIcon({ size = 14 }: { size?: number }) {
  return <Sun size={size} strokeWidth={SW} aria-hidden />
}

function MicIcon({ size = 14 }: { size?: number }) {
  return <Mic size={size} strokeWidth={SW} aria-hidden />
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
  const deleteAckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [appearance, setAppearance] = useState<QcAppearance>(() => getStoredAppearance())
  const phaseRef = useRef<PhaseKind>('idle')
  const transcriptionGenRef = useRef(0)

  const [phase, setPhase] = useState<PhaseKind>('idle')
  const [historyRows, setHistoryRows] = useState<CaptureHistoryRow[]>(() => loadCaptureHistory())
  const [derivedItems, setDerivedItems] = useState<CaptureDerivedItems>(() => loadCaptureDerivedItems())
  const [activePanel, setActivePanel] = useState<ActivePanel>(`notes`)
  const [selectedMoveDestination, setSelectedMoveDestination] = useState<MoveDestination | null>(null)
  const [taskAddText, setTaskAddText] = useState(``)
  const [liveText, setLiveText] = useState('')
  const [finalText, setFinalText] = useState('')
  const finalTextRef = useRef(finalText)
  const [isProcessingWhisper, setIsProcessingWhisper] = useState(false)
  const [notePresentationMode, setNotePresentationMode] = useState<'plain' | 'tracked'>(`plain`)
  const [trackedNoteSession, setTrackedNoteSession] = useState(0)
  const [trackedOriginalTranscript, setTrackedOriginalTranscript] = useState<string | null>(null)
  const [pastCleanupDraft, setPastCleanupDraft] = useState<PastCleanupDraft | null>(null)
  const [copyOk, setCopyOk] = useState(false)
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null)
  const [newlyAddedRowId, setNewlyAddedRowId] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const [noteCapturedAt, setNoteCapturedAt] = useState<number | null>(null)
  /** Drives `now · …` → clock time in the feed without calling `Date.now()` during render. */
  const [feedStampNowMs, setFeedStampNowMs] = useState(() => nowMs())
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false)
  const [aiSuggestBanner, setAiSuggestBanner] = useState<string | null>(null)
  const [feedRowActionBusy, setFeedRowActionBusy] = useState<string | null>(null)
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [feedAckText, setFeedAckText] = useState<string | null>(null)
  const [feedAckType, setFeedAckType] = useState<'success' | 'danger' | 'warning' | 'info'>('success')
  const [movePopoverRowId, setMovePopoverRowId] = useState<string | null>(null)
  const [moveReview, setMoveReview] = useState<MoveReviewState | null>(null)
  /** Idle pill: hover expands to reveal dictation (second row). */

  const trackedNoteEditorRef = useRef<HTMLDivElement | null>(null)
  const trackedNoteBackupHtmlRef = useRef(`<p></p>`)
  const noteTranscriptScrollRef = useRef<HTMLDivElement | null>(null)
  const noteContinueBaseRef = useRef<string | null>(null)
  const aiSuggestBannerTimerRef = useRef<number | null>(null)

  // Recording always lives inside the notes card — treat recording phase as output for sizing
  const layoutPhaseForShell =
    phase === `recording` ? `output` : phase

  const widthPx  = WIDTH_BY_PHASE[layoutPhaseForShell]
  const heightPx = HEIGHT_BY_PHASE[layoutPhaseForShell]
  const isEmbeddedRecording = phase === `recording`
  const isOutputMode = layoutPhaseForShell === `output`

  // In output mode the shell fills the Electron window so dragging an edge resizes content.
  // We track the window's inner dimensions and use them instead of the fixed constants.
  const SHELL_PADDING = 32 // 2 × p-4 (16px each side)
  const [windowSize, setWindowSize] = useState<{ w: number; h: number }>({
    w: window.innerWidth,
    h: window.innerHeight,
  })
  useEffect(() => {
    if (!isOutputMode) return
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOutputMode])

  const shellWidth  = isOutputMode ? windowSize.w - SHELL_PADDING : widthPx
  const shellHeight = isOutputMode ? windowSize.h - SHELL_PADDING : heightPx

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
      el.scrollTop = 0
    })
  }, [phase, liveText])

  /** Notes are newest-first; keep fresh captures pinned near the top. */
  useLayoutEffect(() => {
    if (phase !== `output`) return
    const el = noteTranscriptScrollRef.current
    if (!el) return

    window.requestAnimationFrame(() => {
      el.scrollTop = 0
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

  function clearFeedAckTimer() {
    if (deleteAckTimerRef.current !== null) {
      clearTimeout(deleteAckTimerRef.current)
      deleteAckTimerRef.current = null
    }
  }

  function showFeedAcknowledgement(message: string, type: 'success' | 'danger' | 'warning' | 'info' = 'success') {
    clearFeedAckTimer()
    setFeedAckText(message)
    setFeedAckType(type)
    deleteAckTimerRef.current = setTimeout(() => {
      deleteAckTimerRef.current = null
      setFeedAckText(null)
    }, 1800)
  }

  function showDeleteAcknowledgement(count: number) {
    showFeedAcknowledgement(count === 1 ? `Deleted 1 note` : `Deleted ${count} notes`, 'danger')
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
    setPastCleanupDraft(null)
    clearFeedAckTimer()
    setFeedAckText(null)
    setActivePanel(`notes`)
    setMovePopoverRowId(null)
    setMoveReview(null)
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
    setPastCleanupDraft(null)
    clearFeedAckTimer()
    setFeedAckText(null)
    setActivePanel(`notes`)
    setMovePopoverRowId(null)
    setMoveReview(null)
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
    setPastCleanupDraft(null)
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
    setPastCleanupDraft(null)
    setActivePanel(`notes`)
    setMovePopoverRowId(null)
    setMoveReview(null)
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
          // No Whisper bridge outside demo mode — live SpeechRecognition is preview-only.
          resolved = `Transcription failed.`
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

    if (resolvedIsEmpty) {
      const rows = loadCaptureHistory()
      const latest = rows[0]

      setHistoryRows(rows)
      setLiveText(``)
      if (continueBase !== null) {
        setFinalText(continueBase)
      } else {
        setFinalText(latest?.text ?? ``)
        setNoteCapturedAt(latest?.at ?? null)
      }
      setFeedStampNowMs(nowMs())
      setNotePresentationMode(`plain`)
      setTrackedOriginalTranscript(null)
      setPastCleanupDraft(null)
      setIsProcessingWhisper(false)
      setPhase(`output`)
      showFeedAcknowledgement(`No speech captured`, 'warning')
      return
    }

    const merged =
      continueBase !== null ?
        mergeNoteContinue(continueBase, resolved)
      : resolved

    // Secondary silent guard — catches Whisper hallucinations that slipped past resolvedIsEmpty
    if (classifySilentTranscript(merged)) {
      const rows = loadCaptureHistory()
      const latest = rows[0]
      setHistoryRows(rows)
      setLiveText(``)
      setFinalText(continueBase ?? latest?.text ?? ``)
      setNoteCapturedAt(continueBase !== null ? noteCapturedAt : (latest?.at ?? null))
      setFeedStampNowMs(nowMs())
      setNotePresentationMode(`plain`)
      setTrackedOriginalTranscript(null)
      setPastCleanupDraft(null)
      setIsProcessingWhisper(false)
      setPhase(`output`)
      showFeedAcknowledgement(`No speech captured`, 'warning')
      return
    }

    const captured = addCaptureHistoryEntry(merged)
    setHistoryRows(loadCaptureHistory())
    setNewlyAddedRowId(captured.id)
    setTimeout(() => setNewlyAddedRowId(null), 5000)

    setFinalText(merged)
    setNoteCapturedAt(captured.at)
    setFeedStampNowMs(captured.at)
    setNotePresentationMode(`plain`)
    setTrackedOriginalTranscript(null)
    setPastCleanupDraft(null)
    setIsProcessingWhisper(false)
    setPhase(`output`)
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
    setPastCleanupDraft(null)
    resetLatestCopyState()
    setNoteCapturedAt(null)
    noteContinueBaseRef.current = null
    setIsProcessingWhisper(false)
    setIsSelectionMode(false)
    setSelectedIds(new Set())
    clearFeedAckTimer()
    setFeedAckText(null)
    setActivePanel(`notes`)
    setMovePopoverRowId(null)
    setMoveReview(null)
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
      revealAiBanner(`Nothing to refine in this note.`)
      return
    }
    if (classifySilentTranscript(trimmedPlain)) {
      revealAiBanner(`Nothing to refine in this note.`)
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

      const trackedHtml = buildTrackedSuggestionHtml(trimmedPlain, reps, cleanedText)

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
      setPastCleanupDraft(null)
      resetLatestCopyState()
      setNotePresentationMode(`tracked`)
      setTrackedNoteSession(n => n + 1)

      if (outcome.summary?.trim().length) revealAiBanner(outcome.summary.trim())
    } catch {
      revealAiBanner(`Suggestions request failed — check connectivity and OPENAI quotas.`)
    } finally {
      setAiSuggestBusy(false)
    }
  }

  function saveDerivedItems(next: CaptureDerivedItems) {
    saveCaptureDerivedItems(next)
    setDerivedItems(next)
  }

  function saveTasks(tasks: CaptureDerivedTask[]) {
    saveDerivedItems({ ...derivedItems, tasks: tasks.slice(0, 300) })
  }

  function saveIdeas(ideas: CaptureDerivedIdea[]) {
    saveDerivedItems({ ...derivedItems, ideas: ideas.slice(0, 300) })
  }

  function saveReminders(reminders: CaptureDerivedReminder[]) {
    saveDerivedItems({ ...derivedItems, reminders: reminders.slice(0, 300) })
  }

  function fallbackMoveDrafts(row: CaptureHistoryRow, mode: MoveDestinationMode): MoveReviewDraft[] {
    const sourceText = row.text.trim()
    if (!sourceText.length) return []

    if (mode === `tasks`) {
      return fallbackChecklistItems(sourceText).map(item => ({
        id: makeTaskId(),
        mode: `tasks`,
        selected: true,
        text: item.text,
        status: `todo` as TaskStatus,
      }))
    }

    if (mode === `ideas`) {
      return [{
        id: makeTaskId(),
        mode: `ideas`,
        selected: true,
        title: ``,
        text: sourceText,
      }]
    }

    return [{
      id: makeTaskId(),
      mode: `reminders`,
      selected: true,
      text: sourceText,
      dateText: ``,
      timeText: ``,
      needsDateTime: true,
    }]
  }

  function dateFieldsFromScheduledAt(scheduledAt?: string) {
    if (!scheduledAt) return { dateText: ``, timeText: `` }
    const parsed = new Date(scheduledAt)
    if (Number.isNaN(parsed.getTime())) return { dateText: ``, timeText: `` }

    const yyyy = parsed.getFullYear()
    const mm = `${parsed.getMonth() + 1}`.padStart(2, `0`)
    const dd = `${parsed.getDate()}`.padStart(2, `0`)
    const hh = `${parsed.getHours()}`.padStart(2, `0`)
    const min = `${parsed.getMinutes()}`.padStart(2, `0`)

    return { dateText: `${yyyy}-${mm}-${dd}`, timeText: `${hh}:${min}` }
  }

  function draftsFromExtraction(
    row: CaptureHistoryRow,
    mode: MoveDestinationMode,
    result: PillExtractDestinationResult | null,
  ): MoveReviewDraft[] {
    if (!result?.ok) return fallbackMoveDrafts(row, mode)

    if (mode === `tasks`) {
      const drafts = (result.tasks ?? [])
        .map(item => `${item.text ?? ``}`.trim())
        .filter(Boolean)
        .slice(0, MAX_TASK_ITEMS)
        .map(text => ({
          id: makeTaskId(),
          mode: `tasks` as const,
          selected: true,
          text,
          status: `todo` as TaskStatus,
        }))

      return drafts.length ? drafts : []
    }

    if (mode === `ideas`) {
      const drafts = (result.ideas ?? [])
        .map(item => {
          const tagRaw = `${item.tag ?? ``}`.trim().toLowerCase()
          const tag: IdeaTag | undefined =
            tagRaw === `product` || tagRaw === `strategy` || tagRaw === `content` || tagRaw === `other`
              ? tagRaw
              : undefined
          return {
            title: `${item.title ?? ``}`.trim(),
            text: `${item.text ?? ``}`.trim(),
            tag,
          }
        })
        .filter(item => item.text.length > 0)
        .slice(0, 20)
        .map(item => ({
          id: makeTaskId(),
          mode: `ideas` as const,
          selected: true,
          title: item.title,
          text: item.text,
          ...(item.tag ? { tag: item.tag } : {}),
        }))

      return drafts.length ? drafts : []
    }

    const defaultPreset = buildReminderPresets()[0]!

    const drafts = (result.reminders ?? [])
      .map(item => ({
        text: `${item.text ?? ``}`.trim(),
        scheduledAt: `${item.scheduledAt ?? ``}`.trim() || undefined,
        dateText: `${item.dateText ?? ``}`.trim(),
        timeText: `${item.timeText ?? ``}`.trim(),
      }))
      .filter(item => item.text.length > 0)
      .slice(0, 20)
      .map(item => {
        const derivedFields = dateFieldsFromScheduledAt(item.scheduledAt)
        const dateText = item.dateText || derivedFields.dateText || defaultPreset.dateText
        const timeText = item.timeText || derivedFields.timeText || defaultPreset.timeText

        return {
          id: makeTaskId(),
          mode: `reminders` as const,
          selected: true,
          text: item.text,
          ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
          dateText,
          timeText,
          needsDateTime: false,
        }
      })

    if (drafts.length) return drafts

    // User explicitly chose Reminders — always give them one draft to schedule,
    // even if the AI found nothing reminder-like in the transcript.
    return [{
      id: makeTaskId(),
      mode: `reminders` as const,
      selected: true,
      text: row.text.trim(),
      dateText: defaultPreset.dateText,
      timeText: defaultPreset.timeText,
      needsDateTime: false,
    }]
  }

  async function openMoveReview(row: CaptureHistoryRow, mode: MoveDestinationMode, evt?: MouseEvent) {
    evt?.stopPropagation()
    setMovePopoverRowId(null)

    const sourceText = row.text.trim()
    if (!sourceText.length || row.silent || classifySilentTranscript(sourceText)) {
      showFeedAcknowledgement(`No speech to move`, 'warning')
      return
    }
    if (isEmbeddedRecording || isProcessingWhisper) return

    setMoveReview({
      rowId: row.id,
      mode,
      status: `loading`,
      error: null,
      drafts: [],
    })

    try {
      const result = window.pill ?
        await window.pill.extractDestination({
          mode,
          text: sourceText,
          nowIso: new Date().toISOString(),
        })
      : null
      const drafts = draftsFromExtraction(row, mode, result)

      setMoveReview({
        rowId: row.id,
        mode,
        status: `ready`,
        error: null,
        drafts,
      })
    } catch {
      const drafts = fallbackMoveDrafts(row, mode)
      setMoveReview({
        rowId: row.id,
        mode,
        status: drafts.length ? `ready` : `error`,
        error: drafts.length ? null : `Could not extract ${destinationLabel(mode).toLowerCase()} from this note.`,
        drafts,
      })
    }
  }

  async function copyText() {
    cancelAutoDismiss()
    if (copyOk) return

    let text = finalText
    if (
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

  const taskOpenCount = useMemo(
    () => derivedItems.tasks.filter(task => !task.checked).length,
    [derivedItems.tasks],
  )
  const reminderOpenCount = useMemo(
    () => derivedItems.reminders.filter(reminder => !reminder.done).length,
    [derivedItems.reminders],
  )

  const liveFeedStamp = useMemo(() => {
    if (noteCapturedAt === null) return ``
    return formatLiveFeedStamp(noteCapturedAt, feedStampNowMs)
  }, [noteCapturedAt, feedStampNowMs])

  const latestPlainForSilent = phase === `output` || isEmbeddedRecording ? `${finalText}`.trim() : ``
  const latestSilentClass = classifySilentTranscript(latestPlainForSilent)
  const showingDerivedPanel = activePanel !== `notes` && !isSelectionMode && !isEmbeddedRecording
  const activeMoveReviewRow = moveReview ?
    historyRows.find(row => row.id === moveReview.rowId) ?? null
  : null

  function cancelAutoDismiss() {
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current)
      autoDismissTimerRef.current = null
    }
  }

  async function copyHistoryRow(row: CaptureHistoryRow, evt: MouseEvent) {
    evt.stopPropagation()
    if (copiedRowId === row.id) return

    const cleanupText =
      pastCleanupDraft?.rowId === row.id ?
        trackedNoteHtmlAcceptedPlain(pastCleanupDraft.html)
      : ``
    const text = row.silent ? SILENT_HISTORY_PREVIEW : cleanupText || row.text

    try {
      const copied = await writeClipboardText(text)
      if (copied) {
        setCopiedRowId(row.id)
        setTimeout(() => setCopiedRowId(null), 900)
      }
    } catch {
      //
    }
  }

  function addManualTask() {
    const text = taskAddText.trim()
    if (!text.length) return

    showFeedAcknowledgement(`Task added`, 'success')
    const now = nowMs()
    saveTasks([
      {
        id: makeTaskId(),
        sourceNoteId: null,
        sourceText: ``,
        text,
        checked: false,
        status: `todo` as TaskStatus,
        createdAt: now,
        updatedAt: now,
      },
      ...derivedItems.tasks,
    ])
    setTaskAddText(``)
  }

  function setTaskStatus(taskId: string, status: TaskStatus) {
    const label = status === `done` ? `Task done` : status === `in_progress` ? `In progress` : `Task reopened`
    showFeedAcknowledgement(label, 'success')
    saveTasks(derivedItems.tasks.map(item =>
      item.id === taskId ? { ...item, status, checked: status === `done`, updatedAt: nowMs() } : item,
    ))
  }

  function editTask(taskId: string, text: string) {
    const trimmed = text.trim()
    saveTasks(
      derivedItems.tasks
        .map(item => item.id === taskId ? { ...item, text: trimmed, updatedAt: nowMs() } : item)
        .filter(item => item.text.length > 0),
    )
  }

  function removeTask(taskId: string) {
    showFeedAcknowledgement(`Task removed`, 'danger')
    saveTasks(derivedItems.tasks.filter(item => item.id !== taskId))
  }

  function editIdea(ideaId: string, patch: Partial<Pick<CaptureDerivedIdea, `title` | `text` | `tag`>>) {
    saveIdeas(
      derivedItems.ideas
        .map(item => {
          if (item.id !== ideaId) return item
          const title = patch.title !== undefined ? patch.title.trim() : item.title
          const text = patch.text !== undefined ? patch.text.trim() : item.text
          const tag = `tag` in patch ? patch.tag : item.tag

          return {
            ...item,
            ...(title ? { title } : { title: undefined }),
            text,
            ...(tag ? { tag } : { tag: undefined }),
            updatedAt: nowMs(),
          }
        })
        .filter(item => item.text.length > 0),
    )
  }

  function removeIdea(ideaId: string) {
    showFeedAcknowledgement(`Idea removed`, 'danger')
    saveIdeas(derivedItems.ideas.filter(item => item.id !== ideaId))
  }

  function combineReminderDateTime(dateText?: string, timeText?: string) {
    const date = `${dateText ?? ``}`.trim()
    const time = `${timeText ?? ``}`.trim()
    if (!date || !time) return undefined

    const parsed = new Date(`${date}T${time}`)
    if (Number.isNaN(parsed.getTime())) return undefined

    return parsed.toISOString()
  }

  function toggleReminder(reminderId: string, done: boolean) {
    showFeedAcknowledgement(done ? `Reminder done` : `Reminder reopened`, 'success')
    saveReminders(derivedItems.reminders.map(item =>
      item.id === reminderId ? { ...item, done, updatedAt: nowMs() } : item,
    ))
  }

  function editReminder(
    reminderId: string,
    patch: Partial<Pick<CaptureDerivedReminder, `text` | `dateText` | `timeText`>>,
  ) {
    saveReminders(
      derivedItems.reminders
        .map(item => {
          if (item.id !== reminderId) return item
          const text = patch.text !== undefined ? patch.text.trim() : item.text
          const dateText = patch.dateText !== undefined ? patch.dateText.trim() : item.dateText
          const timeText = patch.timeText !== undefined ? patch.timeText.trim() : item.timeText
          const scheduledAt = combineReminderDateTime(dateText, timeText)

          return {
            ...item,
            text,
            ...(dateText ? { dateText } : { dateText: undefined }),
            ...(timeText ? { timeText } : { timeText: undefined }),
            ...(scheduledAt ? { scheduledAt } : { scheduledAt: undefined }),
            needsDateTime: !dateText || !timeText,
            updatedAt: nowMs(),
          }
        })
        .filter(item => item.text.length > 0),
    )
  }

  function removeReminder(reminderId: string) {
    showFeedAcknowledgement(`Reminder removed`, 'danger')
    saveReminders(derivedItems.reminders.filter(item => item.id !== reminderId))
  }

  async function copyTasks() {
    const lines = derivedItems.tasks.map(item => `${item.checked ? `☑` : `☐`} ${item.text}`)

    if (!lines.length) return

    try {
      await writeClipboardText(lines.join(`\n`))
      showFeedAcknowledgement(`Tasks copied`, 'success')
    } catch {
      //
    }
  }

  function toggleMoveDraft(draftId: string, selected: boolean) {
    setMoveReview(prev => prev ? {
      ...prev,
      drafts: prev.drafts.map(draft => draft.id === draftId ? { ...draft, selected } : draft),
    } : prev)
  }

  function updateMoveDraft(draftId: string, patch: Partial<MoveReviewDraft>) {
    setMoveReview(prev => prev ? {
      ...prev,
      drafts: prev.drafts.map(draft => {
        if (draft.id !== draftId) return draft

        if (draft.mode === `tasks`) {
          return {
            ...draft,
            text: `text` in patch && typeof patch.text === `string` ? patch.text : draft.text,
          }
        }

        if (draft.mode === `ideas`) {
          return {
            ...draft,
            title: `title` in patch && typeof patch.title === `string` ? patch.title : draft.title,
            text: `text` in patch && typeof patch.text === `string` ? patch.text : draft.text,
          }
        }

        const dateText = `dateText` in patch && typeof patch.dateText === `string` ?
          patch.dateText
        : draft.dateText
        const timeText = `timeText` in patch && typeof patch.timeText === `string` ?
          patch.timeText
        : draft.timeText

        return {
          ...draft,
          text: `text` in patch && typeof patch.text === `string` ? patch.text : draft.text,
          dateText,
          timeText,
          scheduledAt: combineReminderDateTime(dateText, timeText),
          needsDateTime: !dateText || !timeText,
        }
      }),
    } : prev)
  }

  function acceptMoveReview() {
    if (!moveReview || moveReview.status !== `ready`) return

    const row = historyRows.find(item => item.id === moveReview.rowId)
    if (!row) return

    const selectedDrafts = moveReview.drafts.filter(draft => draft.selected)
    if (!selectedDrafts.length) return

    const sourceText = row.text
    const createdAt = nowMs()

    if (moveReview.mode === `tasks`) {
      const nextTasks = selectedDrafts
        .filter((draft): draft is MoveTaskDraft => draft.mode === `tasks`)
        .map(draft => ({
          id: makeTaskId(),
          sourceNoteId: row.id,
          sourceText,
          text: draft.text.trim(),
          status: draft.status,
          checked: draft.status === `done`,
          createdAt,
          updatedAt: createdAt,
        }))
        .filter(item => item.text.length > 0)

      saveTasks([...nextTasks, ...derivedItems.tasks])
      setActivePanel(`tasks`)
      showFeedAcknowledgement(`${nextTasks.length} added to Tasks`, 'success')
    }

    if (moveReview.mode === `ideas`) {
      const nextIdeas = selectedDrafts
        .filter((draft): draft is MoveIdeaDraft => draft.mode === `ideas`)
        .map(draft => ({
          id: makeTaskId(),
          sourceNoteId: row.id,
          sourceText,
          title: draft.title.trim() || undefined,
          text: draft.text.trim(),
          ...(draft.tag ? { tag: draft.tag } : {}),
          createdAt,
          updatedAt: createdAt,
        }))
        .filter(item => item.text.length > 0)

      saveIdeas([...nextIdeas, ...derivedItems.ideas])
      setActivePanel(`ideas`)
      showFeedAcknowledgement(`${nextIdeas.length} added to Ideas`, 'success')
    }

    if (moveReview.mode === `reminders`) {
      const nextReminders = selectedDrafts
        .filter((draft): draft is MoveReminderDraft => draft.mode === `reminders`)
        .map(draft => {
          const dateText = draft.dateText.trim()
          const timeText = draft.timeText.trim()
          const scheduledAt = combineReminderDateTime(dateText, timeText)

          return {
            id: makeTaskId(),
            sourceNoteId: row.id,
            sourceText,
            text: draft.text.trim(),
            ...(scheduledAt ? { scheduledAt } : {}),
            ...(dateText ? { dateText } : {}),
            ...(timeText ? { timeText } : {}),
            needsDateTime: draft.needsDateTime && (!dateText || !timeText),
            done: false,
            createdAt,
            updatedAt: createdAt,
          }
        })
        .filter(item => item.text.length > 0)

      saveReminders([...nextReminders, ...derivedItems.reminders])
      setActivePanel(`reminders`)
      showFeedAcknowledgement(`${nextReminders.length} added to Reminders`, 'success')
    }

    // Mark this row as moved so the feed shows the destination label
    const movedDestination = moveReview.mode as MoveDestination
    const updatedRows = updateCaptureHistoryMovedTo(moveReview.rowId, movedDestination)
    setHistoryRows(updatedRows)

    setMoveReview(null)
  }

  function handleRemoveFromFolder(row: CaptureHistoryRow) {
    const label = row.movedTo === `tasks` ? `Tasks` : row.movedTo === `ideas` ? `Ideas` : `Reminders`
    const updatedRows = clearCaptureHistoryMovedTo(row.id)
    setHistoryRows(updatedRows)
    setMovePopoverRowId(null)
    showFeedAcknowledgement(`Removed from ${label}`, 'danger')
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

      const trackedHtml = buildTrackedSuggestionHtml(trimmed, outcome.replacements ?? [], polished)
      if (trackedHtml === null) {
        revealAiBanner(`Could not safely show edits for this note.`)
        return
      }

      setPastCleanupDraft(prev => ({
        rowId: row.id,
        html: trackedHtml,
        session: (prev?.session ?? 0) + 1,
      }))
    } catch {
      revealAiBanner(`Refine failed — check connectivity and quotas.`)
    } finally {
      setFeedRowActionBusy(null)
    }
  }

  async function handleFeedRowTidy(
    row: CaptureHistoryRow,
    isLatest: boolean,
    evt?: MouseEvent,
  ) {
    evt?.stopPropagation()
    if (isProcessingWhisper) return

    const pillBridge = window.pill
    if (!pillBridge) return

    const trimmed = isLatest ? getNotePlainSnapshot() : row.text.trim()
    if (!trimmed.length || row.silent) return

    setFeedRowActionBusy(row.id)
    try {
      const outcome = await pillBridge.suggestEdits({ text: trimmed })
      if (!outcome.ok) {
        revealAiBanner(outcome.message ?? `Tidy failed (${outcome.code}).`)
        return
      }

      const polished = `${outcome.cleanedText ?? ``}`.trim()
      if (!polished.length || polished === trimmed) {
        showFeedAcknowledgement(`Already tidy — no changes needed.`, 'warning')
        return
      }

      // Apply silently: no diff view, just replace text directly
      if (isLatest) {
        setFinalText(polished)
        setNotePresentationMode(`plain`)
        setTrackedOriginalTranscript(null)
        resetLatestCopyState()
        if (noteCapturedAt !== null) updateCaptureHistoryById(row.id, polished)
      } else {
        updateCaptureHistoryById(row.id, polished)
        setPastCleanupDraft(null)
      }
      setHistoryRows(loadCaptureHistory())
      showFeedAcknowledgement(`Tidied`, 'success')
    } catch {
      revealAiBanner(`Tidy failed — check connectivity and quotas.`)
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
    resetLatestCopyState()
  }

  function restorePastTranscript(rowId: string) {
    if (pastCleanupDraft?.rowId !== rowId) return
    setPastCleanupDraft(null)
  }

  // ── Selection mode ────────────────────────────────────────────────
  function enterSelectionMode() {
    clearFeedAckTimer()
    setFeedAckText(null)
    setActivePanel(`notes`)
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
    const allIds = filteredHistoryRows.map(r => r.id)
    setSelectedIds(prev =>
      prev.size === allIds.length ? new Set() : new Set(allIds),
    )
  }

  function deleteSelected() {
    if (selectedIds.size === 0) return
    const deleteCount = selectedIds.size
    const remaining = historyRows.filter(r => !selectedIds.has(r.id))
    saveCaptureHistory(remaining)
    setHistoryRows(remaining)
    if (pastCleanupDraft && selectedIds.has(pastCleanupDraft.rowId)) setPastCleanupDraft(null)
    // If the currently-displayed latest note was deleted, clear it
    if (historyRows[0] && selectedIds.has(historyRows[0].id)) {
      const nextLatest = remaining[0] ?? null
      setFinalText(nextLatest?.text ?? ``)
      setTrackedOriginalTranscript(null)
      resetLatestCopyState()
      setNoteCapturedAt(nextLatest?.at ?? null)
      setNotePresentationMode(`plain`)
    }
    if (movePopoverRowId && selectedIds.has(movePopoverRowId)) setMovePopoverRowId(null)
    if (moveReview && selectedIds.has(moveReview.rowId)) setMoveReview(null)
    exitSelectionMode()
    showDeleteAcknowledgement(deleteCount)
  }

  useEffect(() => {
    return () => {
      clearLatestCopyTimer()
      clearFeedAckTimer()
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

  // Calculate destination counts for "All notes" filters
  const destinationCounts = {
    tasks: historyRows.filter(row => row.movedTo === 'tasks').length,
    ideas: historyRows.filter(row => row.movedTo === 'ideas').length,
    reminders: historyRows.filter(row => row.movedTo === 'reminders').length,
  }

  // Filter history rows based on selected destination
  const filteredHistoryRows = selectedMoveDestination
    ? historyRows.filter(row => row.movedTo === selectedMoveDestination)
    : historyRows

  return (
    <div
      className={`relative flex min-h-screen items-end justify-end bg-transparent ${phase === `idle` ? `p-1` : `p-4`}`}
      style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
    >
      <section
        ref={node => { shellRef.current = node }}
        style={{
          position: `relative`,
          width: shellWidth,
          height: shellHeight,
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
            <Tip content="Your notes">
              <button
                type="button"
                onClick={() => openNotesOnly()}
                className="qc-idle-split-btn"
                aria-label="Open your notes"
              >
                <NotesIcon size={15} />
              </button>
            </Tip>
            <div className="qc-idle-split-divider" aria-hidden />
            <Tip content="Hit ⌃Space">
              <button
                type="button"
                onClick={() => void startRecordingFromNotes()}
                className="qc-idle-split-btn"
                aria-label="Start dictation"
              >
                <MicIcon size={14} />
              </button>
            </Tip>
          </div>
        )}

        {/* SCRATCHPAD: Output (+ embedded dictate from footer) */}
        {(phase === 'output' || isEmbeddedRecording) && (
          <div className="fade-in flex h-full min-h-0 w-full flex-col">
            {/* Main */}
            <div
              className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              style={{
                borderRadius: `var(--qc-radius-sm)`,
                WebkitAppRegion: `drag`,
              } as CSSProperties}
            >
              {/* Title row — notes header, shortcut, copy + window chrome */}
              <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-4">
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] pr-1">
                  <span
                    className="qc-scratchpad-header-title truncate text-[17px] font-semibold tracking-tight"
                    style={{ color: `var(--qc-text-primary)` }}
                  >
                    Voice notes
                  </span>
                  <p className="qc-sheet-shortcut-hint">
                    {isProcessingWhisper ?
                      `Transcribing…`
                    : isEmbeddedRecording ?
                      `Listening · speak naturally`
                    : `Press ⌃Space to capture`}
                  </p>
                </div>
                <div
                  className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
                  role="presentation"
                >
                  {/* Mic CTA — always visible in header, active state when recording */}
                  {!isSelectionMode && (
                    <Tip content="Start recording">
                      <button
                        type="button"
                        className={`qc-chrome-icon-btn qc-chrome-icon-btn--mic-cta${isEmbeddedRecording ? ` qc-chrome-icon-btn--active` : ``}`}
                        aria-label="Start dictation"
                        disabled={isEmbeddedRecording || isProcessingWhisper}
                        onClick={() => void startRecordingFromNotes()}
                      >
                        <MicIcon size={15} />
                      </button>
                    </Tip>
                  )}

                  {/* Delete / selection mode toggle */}
                  {!isEmbeddedRecording && (
                    isSelectionMode ? (
                      <button
                        type="button"
                        className="qc-chrome-icon-btn"
                        style={{ fontSize: `11px`, fontWeight: 500, color: `var(--qc-text-secondary)`, width: `auto`, padding: `0 6px` }}
                        onClick={exitSelectionMode}
                      >
                        Cancel
                      </button>
                    ) : (
                      <Tip content="Delete notes">
                        <button
                          type="button"
                          className="qc-chrome-icon-btn"
                          aria-label="Select notes to delete"
                          disabled={historyRows.length === 0}
                          onClick={enterSelectionMode}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </Tip>
                    )
                  )}

                  <Tip content={appearance === `light` ? `Dark mode` : `Light mode`}>
                    <button
                      type="button"
                      className="qc-chrome-icon-btn"
                      aria-label={appearance === `light` ? `Switch to dark mode` : `Switch to light mode`}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        toggleAppearance()
                      }}
                    >
                      {appearance === `light` ? <MoonIcon size={15} /> : <SunIcon size={15} />}
                    </button>
                  </Tip>

                  {typeof window !== `undefined` && window.pill ?
                    <>
                      <Tip content="Minimize">
                        <button
                          type="button"
                          className="qc-chrome-square-btn"
                          aria-label="Minimize to pill"
                          onClick={() => collapseToIdlePill()}
                        >
                          <WindowMinimizeIcon />
                        </button>
                      </Tip>
                      <Tip content="Close">
                        <button
                          type="button"
                          className="qc-chrome-square-btn"
                          aria-label="Close"
                          onClick={() => dismiss()}
                        >
                          <WindowCloseIcon />
                        </button>
                      </Tip>
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

              <div className="qc-thought-layout">
                <DestinationRail
                  activePanel={activePanel}
                  noteCount={historyRows.length}
                  taskCount={taskOpenCount}
                  ideaCount={derivedItems.ideas.length}
                  reminderCount={reminderOpenCount}
                  onSelect={(panel) => {
                    setActivePanel(panel)
                    setMovePopoverRowId(null)
                  }}
                />

                <div className="qc-thought-main">
                  {!showingDerivedPanel && (
                    <>
                      <div className="qc-derived-panel__summary">
                        <div>
                          <div className="qc-derived-panel__title">All notes <span className="qc-pill-count">({historyRows.length})</span></div>
                        </div>
                      </div>

                      <div
                        className="qc-task-filter-pills"
                        onClick={(e) => {
                          const btn = (e.target as HTMLElement).closest('button')
                          if (!btn) return
                          const pill = btn.getAttribute('data-pill')
                          if (pill === 'all') setSelectedMoveDestination(null)
                          else if (pill === 'tasks') setSelectedMoveDestination(selectedMoveDestination === 'tasks' ? null : 'tasks')
                          else if (pill === 'ideas') setSelectedMoveDestination(selectedMoveDestination === 'ideas' ? null : 'ideas')
                          else if (pill === 'reminders') setSelectedMoveDestination(selectedMoveDestination === 'reminders' ? null : 'reminders')
                        }}
                      >
                        <button
                          key="all"
                          type="button"
                          className={`qc-status-pill${selectedMoveDestination === null ? ` qc-status-pill--selected` : ``}`}
                          data-pill="all"
                          aria-pressed={selectedMoveDestination === null}
                        >
                          All <span className="qc-pill-count">({historyRows.length})</span>
                        </button>
                        <button
                          key="tasks"
                          type="button"
                          className={`qc-status-pill${selectedMoveDestination === 'tasks' ? ` qc-status-pill--selected` : ``}`}
                          data-pill="tasks"
                          aria-pressed={selectedMoveDestination === 'tasks'}
                        >
                          Tasks <span className="qc-pill-count">({destinationCounts.tasks})</span>
                        </button>
                        <button
                          key="ideas"
                          type="button"
                          className={`qc-status-pill${selectedMoveDestination === 'ideas' ? ` qc-status-pill--selected` : ``}`}
                          data-pill="ideas"
                          aria-pressed={selectedMoveDestination === 'ideas'}
                        >
                          Ideas <span className="qc-pill-count">({destinationCounts.ideas})</span>
                        </button>
                        <button
                          key="reminders"
                          type="button"
                          className={`qc-status-pill${selectedMoveDestination === 'reminders' ? ` qc-status-pill--selected` : ``}`}
                          data-pill="reminders"
                          aria-pressed={selectedMoveDestination === 'reminders'}
                        >
                          Reminders <span className="qc-pill-count">({destinationCounts.reminders})</span>
                        </button>
                      </div>

                      <div
                        ref={noteTranscriptScrollRef}
                        className="transcript-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                        style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
                      >
                        <div className="qc-feed">
                        {isEmbeddedRecording && (
                          <div
                            className={`qc-inline-recording-card${isProcessingWhisper ? ` qc-inline-recording-card--processing` : ``}`}
                            role="status"
                            aria-live="polite"
                          >
                            <div className="qc-inline-recording-card__wave" aria-hidden={true}>
                              {isProcessingWhisper ?
                                <span className="qc-inline-recording-card__spinner" />
                              :
                                <>
                                  <i /><i /><i /><i /><i /><i /><i />
                                </>
                              }
                            </div>
                            <span className="qc-inline-recording-card__label">
                              {isProcessingWhisper ? `Transcribing` : `Listening...`}
                            </span>
                            {!isProcessingWhisper && (
                              <div className="qc-inline-recording-card__actions">
                                <Tip content="Discard">
                                  <button
                                    type="button"
                                    className="qc-inline-recording-card__icon-btn"
                                    onClick={() => cancelRecording()}
                                    aria-label="Cancel recording"
                                  >
                                    <XIcon size={13} />
                                  </button>
                                </Tip>
                                <Tip content="Finish and transcribe">
                                  <button
                                    type="button"
                                    className="qc-inline-recording-card__accept"
                                    onClick={() => void stopRecording()}
                                    aria-label="Accept audio and transcribe"
                                  >
                                    <CheckIcon size={15} />
                                  </button>
                                </Tip>
                              </div>
                            )}
                          </div>
                        )}

                        {isSelectionMode && filteredHistoryRows.length > 0 && (
                          <div className="qc-feed-select-all-row">
                            <label className="qc-feed-select-all-label">
                              <div
                                className={`qc-feed-checkbox${selectedIds.size === filteredHistoryRows.length && filteredHistoryRows.length > 0 ? ` qc-feed-checkbox--checked` : ``}`}
                                onClick={selectAll}
                                role="checkbox"
                                aria-checked={selectedIds.size === filteredHistoryRows.length && filteredHistoryRows.length > 0}
                                tabIndex={0}
                                onKeyDown={(e) => e.key === ` ` && selectAll()}
                              >
                                {selectedIds.size === filteredHistoryRows.length && filteredHistoryRows.length > 0 && <CheckIcon size={10} />}
                              </div>
                              <span style={{ fontSize: `12px`, color: `var(--qc-text-muted)` }}>
                                {selectedIds.size === filteredHistoryRows.length && filteredHistoryRows.length > 0 ? `Deselect all` : `Select all`}
                              </span>
                            </label>
                          </div>
                        )}

                        {filteredHistoryRows.map((row, idx) => {
                          const isLatest = idx === 0
                          const stamp =
                            isLatest && noteCapturedAt !== null ?
                              liveFeedStamp || formatFeedEntryStamp(row.at)
                            : formatFeedEntryStamp(row.at)

                          const rowSideBusy = !isLatest && feedRowActionBusy === row.id
                          const isPastCleanupActive = !isLatest && pastCleanupDraft?.rowId === row.id
                          const activePastCleanupDraft = isPastCleanupActive ? pastCleanupDraft : null
                          const cleanDisabledLatest =
                            aiSuggestBusy ||
                            isEmbeddedRecording ||
                            isProcessingWhisper ||
                            copyOk ||
                            latestSilentClass
                          const moveDisabled =
                            isEmbeddedRecording ||
                            isProcessingWhisper ||
                            moveReview?.status === `loading` ||
                            row.silent ||
                            !row.text.trim().length
                          const cleanDisabledPast =
                            feedRowActionBusy !== null || row.silent || isProcessingWhisper ||
                            !window.pill
                          const cleanDisabled = isLatest ? cleanDisabledLatest : cleanDisabledPast

                          return (
                            <div
                              key={row.id}
                              className={[
                                isLatest ? `qc-feed-entry qc-feed-entry--current` : `qc-feed-entry`,
                                isSelectionMode ? `qc-feed-entry--selectable` : ``,
                                isSelectionMode && selectedIds.has(row.id) ? `qc-feed-entry--selected` : ``,
                                newlyAddedRowId === row.id ? ` qc-feed-entry--new` : ``,
                              ].join(` `).trim()}
                              onClick={isSelectionMode ? () => toggleSelectId(row.id) : undefined}
                            >
                              {isSelectionMode && (
                                <div
                                  className="qc-feed-select-col"
                                  aria-hidden
                                  onClick={e => { e.stopPropagation(); toggleSelectId(row.id) }}
                                >
                                  <div className={`qc-feed-checkbox${selectedIds.has(row.id) ? ` qc-feed-checkbox--checked` : ``}`}>
                                    {selectedIds.has(row.id) && <CheckIcon size={10} />}
                                  </div>
                                </div>
                              )}

                              <div className="qc-feed-meta">
                                <span className="qc-feed-meta-time">{stamp}</span>
                                {!isSelectionMode && (rowSideBusy ?
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
                                  <div className="qc-feed-actions qc-feed-actions--text">
                                    {!isProcessingWhisper && (
                                      <>
                                        <Tip content="Refine with tracked edits">
                                          <button
                                            type="button"
                                            className="qc-feed-action qc-feed-action--label"
                                            aria-label="Refine"
                                            disabled={cleanDisabled}
                                            onClick={(e) => void handleFeedRowCleanUp(row, isLatest, e)}
                                          >
                                            {aiSuggestBusy && isLatest ?
                                              <span
                                                aria-hidden={true}
                                                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid"
                                                style={{
                                                  borderColor: `var(--qc-border-strong)`,
                                                  borderTopColor: `var(--qc-accent)`,
                                                }}
                                              />
                                            : <ImproveIconOutline size={14} />}
                                          </button>
                                        </Tip>
                                        <Tip content={isLatest && copyOk ? `Copied` : copiedRowId === row.id ? `Copied` : `Copy`}>
                                          <button
                                            type="button"
                                            className="qc-feed-action qc-feed-action--label"
                                            aria-label="Copy"
                                            disabled={(isLatest && copyOk) || copiedRowId === row.id || isEmbeddedRecording}
                                            onClick={(e) => handleFeedRowCopy(row, isLatest, e)}
                                          >
                                            {(isLatest && copyOk) || copiedRowId === row.id ?
                                              <CheckIcon size={14} />
                                            : <CopyIcon size={14} />}
                                          </button>
                                        </Tip>
                                        <div className="qc-move-menu-wrap">
                                          {row.movedTo ? (
                                            <>
                                              <button
                                                type="button"
                                                className="qc-moved-badge"
                                                aria-label={`Moved to ${row.movedTo}`}
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setMovePopoverRowId(prev => prev === row.id ? null : row.id)
                                                }}
                                              >
                                                {row.movedTo === `tasks` && <ChecklistIcon size={11} />}
                                                {row.movedTo === `ideas` && <IdeaIcon size={11} />}
                                                {row.movedTo === `reminders` && <ReminderIcon size={11} />}
                                              </button>
                                              {movePopoverRowId === row.id && (
                                                <div className="qc-move-popover" role="menu" aria-label="Folder options">
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="qc-move-popover__remove"
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveFromFolder(row) }}
                                                  >
                                                    <XIcon size={13} />
                                                    Remove from {row.movedTo === `tasks` ? `Tasks` : row.movedTo === `ideas` ? `Ideas` : `Reminders`}
                                                  </button>
                                                  {([`tasks`, `ideas`, `reminders`] as const)
                                                    .filter(d => d !== row.movedTo)
                                                    .map(dest => (
                                                      <button
                                                        key={dest}
                                                        type="button"
                                                        role="menuitem"
                                                        onClick={(e) => void openMoveReview(row, dest, e)}
                                                      >
                                                        {dest === `tasks` && <ChecklistIcon size={14} />}
                                                        {dest === `ideas` && <IdeaIcon size={14} />}
                                                        {dest === `reminders` && <ReminderIcon size={14} />}
                                                        Move to {dest === `tasks` ? `Tasks` : dest === `ideas` ? `Ideas` : `Reminders`}
                                                      </button>
                                                    ))
                                                  }
                                                </div>
                                              )}
                                            </>
                                          ) : (
                                            <>
                                              <Tip content="Move to…">
                                              <button
                                                type="button"
                                                className="qc-feed-action qc-feed-action--label qc-feed-action--move"
                                                aria-label="Move to"
                                                disabled={moveDisabled}
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  setMovePopoverRowId(prev => prev === row.id ? null : row.id)
                                                }}
                                              >
                                                <MoreIcon size={14} />
                                              </button>
                                              </Tip>
                                              {movePopoverRowId === row.id && (
                                                <div className="qc-move-popover" role="menu" aria-label="Move note to">
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={(e) => void openMoveReview(row, `tasks`, e)}
                                                  >
                                                    <ChecklistIcon size={14} />
                                                    Tasks
                                                  </button>
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={(e) => void openMoveReview(row, `ideas`, e)}
                                                  >
                                                    <IdeaIcon size={14} />
                                                    Ideas
                                                  </button>
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    onClick={(e) => void openMoveReview(row, `reminders`, e)}
                                                  >
                                                    <ReminderIcon size={14} />
                                                    Reminders
                                                  </button>
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                        {isLatest && notePresentationMode === `tracked` && trackedOriginalTranscript !== null && (
                                          <Tip content="Restore">
                                            <button
                                              type="button"
                                              className="qc-feed-action qc-feed-action--revert"
                                              aria-label="Restore"
                                              onClick={restoreTranscript}
                                            >
                                              <UndoIcon size={15} />
                                            </button>
                                          </Tip>
                                        )}
                                        {!isLatest && isPastCleanupActive && (
                                          <Tip content="Restore">
                                            <button
                                              type="button"
                                              className="qc-feed-action qc-feed-action--revert"
                                              aria-label="Restore"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                restorePastTranscript(row.id)
                                              }}
                                            >
                                              <UndoIcon size={15} />
                                            </button>
                                          </Tip>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              {isLatest ?
                                <>
                                  {notePresentationMode === `tracked` ?
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
                                    isEmbeddedRecording ?
                                      <FeedClampText
                                        text={finalText || row.text}
                                        className="qc-feed-current-text select-text whitespace-pre-wrap"
                                      />
                                    :
                                      <PastEntryText
                                        row={{ id: row.id, text: displayText, silent: row.silent }}
                                        textClassName="qc-feed-current-text select-text"
                                        editableClassName="qc-feed-current-text qc-feed-past-editable select-text"
                                        onSave={(newText) => {
                                          updateCaptureHistoryById(row.id, newText)
                                          setHistoryRows(loadCaptureHistory())
                                          setFinalText(newText)
                                          resetLatestCopyState()
                                        }}
                                      />
                                  }

                                  {aiSuggestBanner && !isEmbeddedRecording &&
                                    <div role="status" className="qc-ai-banner mt-2 px-3 py-2 leading-[1.2]">
                                      {aiSuggestBanner}
                                    </div>
                                  }
                                </>
                              :
                                <PastEntryText
                                  key={row.id}
                                  row={row}
                                  cleanupHtml={activePastCleanupDraft?.html}
                                  cleanupSession={activePastCleanupDraft?.session}
                                  onCleanupHtmlChange={(html) => {
                                    setPastCleanupDraft(prev =>
                                      prev?.rowId === row.id ? { ...prev, html } : prev,
                                    )
                                  }}
                                  onSave={(newText) => {
                                    updateCaptureHistoryById(row.id, newText)
                                    setHistoryRows(loadCaptureHistory())
                                  }}
                                />
                              }
                            </div>
                          )
                        })}

                        {filteredHistoryRows.length === 0 && historyRows.length === 0 && !isProcessingWhisper && !isEmbeddedRecording && (
                          <p className="px-3 py-6 text-sm italic" style={{ color: `var(--qc-text-muted)` }}>
                            No captures yet.
                          </p>
                        )}
                        {filteredHistoryRows.length === 0 && historyRows.length > 0 && !isProcessingWhisper && !isEmbeddedRecording && (
                          <p className="px-3 py-6 text-sm italic" style={{ color: `var(--qc-text-muted)` }}>
                            No notes in this category.
                          </p>
                        )}
                      </div>
                      </div>
                    </>
                  )}

                  {activePanel === `tasks` && showingDerivedPanel && (
                    <TaskManagerPanel
                      tasks={derivedItems.tasks}
                      addText={taskAddText}
                      onAddTextChange={setTaskAddText}
                      onAddTask={addManualTask}
                      onCopy={() => void copyTasks()}
                      onSetStatus={setTaskStatus}
                      onEdit={editTask}
                      onRemove={removeTask}
                    />
                  )}

                  {activePanel === `ideas` && showingDerivedPanel && (
                    <IdeasPanel
                      ideas={derivedItems.ideas}
                      onEdit={editIdea}
                      onRemove={removeIdea}
                    />
                  )}

                  {activePanel === `reminders` && showingDerivedPanel && (
                    <RemindersPanel
                      reminders={derivedItems.reminders}
                      onToggle={toggleReminder}
                      onEdit={editReminder}
                      onRemove={removeReminder}
                    />
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

              {feedAckText && !isSelectionMode && (
                <div
                  className={`qc-feed-ack qc-feed-ack--${feedAckType}`}
                  role="status"
                  aria-live="polite"
                  style={{ WebkitAppRegion: `no-drag` } as CSSProperties}
                >
                  {feedAckType === 'success' && <CheckIcon size={13} />}
                  {feedAckType === 'danger' && <XIcon size={13} />}
                  {feedAckType === 'warning' && <AlertCircleIcon size={13} />}
                  {feedAckType === 'info' && <InfoIcon size={13} />}
                  <span>{feedAckText}</span>
                </div>
              )}

              {!isEmbeddedRecording && !isSelectionMode && (
                <div className="qc-resize-affordance" aria-hidden={true} />
              )}

              </div>{/* end white content panel */}
            </div>
          </div>
        )}
      </section>

      {moveReview && (
        <MoveReviewModal
          state={moveReview}
          row={activeMoveReviewRow}
          shellEl={shellRef.current}
          onClose={() => setMoveReview(null)}
          onAccept={acceptMoveReview}
          onToggleDraft={toggleMoveDraft}
          onUpdateDraft={updateMoveDraft}
        />
      )}


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
