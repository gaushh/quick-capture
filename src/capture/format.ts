export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = `${Math.floor(totalSeconds / 60)}`.padStart(2, '0')
  const seconds = `${Math.floor(totalSeconds % 60)}`.padStart(2, '0')
  const centiseconds = `${Math.floor((ms % 1000) / 10)}`.padStart(2, '0')
  return `${minutes}:${seconds}.${centiseconds}`
}

export async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  let binary = ''
  for (let idx = 0; idx < bytes.byteLength; idx += 1) binary += String.fromCharCode(bytes[idx] as number)

  return btoa(binary)
}

export type TodoItemShape = {
  id: string
  text: string
  checked: boolean
}

export function checklistMarkdown(items: TodoItemShape[]) {
  return items
    .map((task) => {
      const trimmed = task.text.replace(/\s+/g, ' ').trim()
      const checkbox = task.checked ? '- [x]' : '- [ ]'
      return trimmed.length ? `${checkbox} ${trimmed}` : checkbox
    })
    .join('\n')
}

export function summarizeError(error: unknown) {
  if (error instanceof DOMException && error.message) return error.message
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error

  return 'Something went wrong while capturing.'
}
