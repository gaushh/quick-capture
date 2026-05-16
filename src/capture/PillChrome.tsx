import { memo, useLayoutEffect, useMemo, useRef } from 'react'

import type { TodoItemShape } from './format.ts'

export const MemoWaveform = memo(function MemoWaveform() {
  const bars = useMemo(() => Array.from({ length: 16 }, (_, idx) => idx), [])

  return (
    <div className="flex h-[52px] items-end justify-between gap-[3px]" aria-hidden="true">
      {bars.map((barIdx) => (
        <span
          key={`wave-${barIdx}`}
          aria-hidden={true}
          className="wave-bar h-[48px]"
          style={{ '--i': barIdx } as React.CSSProperties}
        />
      ))}
    </div>
  )
})

export function EditableTodoItem(props: {
  todo: TodoItemShape
  index: number
  onToggleChecked: () => void
  onDraft: (sanitizedDraft: string) => void
}) {
  const { todo, index, onToggleChecked, onDraft } = props
  const editorRef = useRef<HTMLDivElement | null>(null)

  /*
   * Keep DOM synced with structured checklist updates arriving from GPT.
   */
  useLayoutEffect(() => {
    const node = editorRef.current
    if (!node) return

    const currentDom = `${node.innerText ?? ''}`.trimEnd()
    if (currentDom === todo.text) return

    node.textContent = todo.text
  }, [todo.text, todo.id])

  function handleDraftInput(nativeEvent: React.FormEvent<HTMLDivElement>) {
    onDraft(sanitizeDomText(nativeEvent.currentTarget.innerText))
  }

  const handlePaste = (nativePaste: React.ClipboardEvent<HTMLDivElement>) => {
    nativePaste.preventDefault()
    document.execCommand('insertText', false, sanitizeDomText(nativePaste.clipboardData?.getData('text/plain') ?? ''))
  }

  return (
    <li
      className="stagger-rise flex gap-3 rounded-[13px] border border-[rgba(239,239,239,0.08)] px-3 py-2 backdrop-blur"
      style={{ '--qc-delay': `${index * 70}ms` } as React.CSSProperties}
    >
      <div className="flex flex-1 items-start gap-[10px]">
        <button
          type="button"
          aria-pressed={todo.checked}
          aria-label={todo.checked ? 'Mark incomplete' : 'Mark complete'}
          className={`mt-[7px] h-[13px] w-[13px] flex-none rounded-[3px] border transition ${
            todo.checked ?
              `border-[rgba(239,239,239,0.45)] bg-[rgba(239,239,239,0.18)]`
            : `border-[rgba(239,239,239,0.32)]`
          }`}
          onClick={onToggleChecked}
        />

        <div
          ref={editorRef}
          contentEditable={true}
          suppressContentEditableWarning={true}
          spellCheck={true}
          aria-multiline={true}
          role="textbox"
          className="min-h-[36px] flex-1 whitespace-pre-wrap font-[family-name:var(--font-ui)] leading-[120%] outline-none"
          style={{
            textDecoration: todo.checked ? `line-through` : undefined,
            textDecorationThickness: todo.checked ? 1.06 : undefined,
            textDecorationColor: 'rgba(239,239,239,0.35)',
            color: todo.checked ? 'rgba(239,239,239,0.64)' : 'rgba(239,239,239,0.92)',
          }}
          onInput={handleDraftInput}
          onPaste={handlePaste}
        />
      </div>
    </li>
  )
}

export function SkeletonStack() {
  const widthsFraction = useMemo(() => ['78%', '64%', '52%', '71%', '48%', '60%'], [])

  return (
    <div className="flex flex-col gap-[9px]" aria-busy={true}>
      {widthsFraction.map((fraction, ordinal) => (
        <span key={`shimmer-band-${ordinal}`} className="shimmer-row" style={{ width: fraction }} aria-hidden />
      ))}
    </div>
  )
}

function sanitizeDomText(raw: string) {
  return `${raw}`.replace(/\r/g, '').replace(/\n{4,}/g, '\n\n\n').trimEnd()
}
