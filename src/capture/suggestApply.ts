/** Deterministic markup for AI-suggested deltas (validated against source text only). */

export type PlainReplacement = { old: string; new: string }

export function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(`'`, '&#39;')
}

type Span = { start: number; end: number; old: string; new: string }

/** Build tracked paragraph markup using `.qc-ai-del` / `.qc-ai-add` for each validated span. */
export function applySuggestReplacements(basePlain: string, replacements: PlainReplacement[]): string | null {
  const cleaned =
    replacements
      .filter((r) => r.old.length > 0 && r.old !== r.new)
      .map((r) => ({ old: r.old, new: r.new }))

  const spans: Span[] = []

  for (const rep of cleaned) {
    const idx = basePlain.indexOf(rep.old)

    if (idx < 0) return null
    if (basePlain.indexOf(rep.old, idx + rep.old.length) >= 0) return null

    spans.push({
      start: idx,
      end: idx + rep.old.length,
      old: rep.old,
      new: rep.new,
    })
  }

  if (!cleaned.length) {
    return `<p class="qc-ai-par-pre">${escapeHtml(basePlain)}</p>`
  }

  spans.sort((a, b) => a.start - b.start)

  for (let i = 1; i < spans.length; i++)
    if (spans[i]!.start < spans[i - 1]!.end) return null

  let out = ''
  let cur = 0

  for (const span of spans) {
    out += escapeHtml(basePlain.slice(cur, span.start))
    out +=
      `<span class="qc-ai-del">${escapeHtml(span.old)}</span><span class="qc-ai-add">${escapeHtml(span.new)}</span>`
    cur = span.end
  }

  out += escapeHtml(basePlain.slice(cur))

  return `<p class="qc-ai-par-pre">${out}</p>`
}

/** Reliable fallback when granular model spans cannot be mapped safely. */
export function applyWholeTextSuggestion(basePlain: string, cleanedPlain: string): string | null {
  const base = basePlain.trim()
  const cleaned = cleanedPlain.trim()

  if (!base.length || !cleaned.length || base === cleaned) return null

  return (
    `<p class="qc-ai-par-pre">` +
    `<span class="qc-ai-del">${escapeHtml(base)}</span>` +
    `<span class="qc-ai-add">${escapeHtml(cleaned)}</span>` +
    `</p>`
  )
}

/** Same validation as `applySuggestReplacements`, but returns fully merged plain text (for copy / history rows). */
export function applySuggestionReplacementsPlain(basePlain: string, replacements: PlainReplacement[]): string | null {
  const cleaned =
    replacements
      .filter((r) => r.old.length > 0 && r.old !== r.new)
      .map((r) => ({ old: r.old, new: r.new }))

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

  for (let i = 1; i < spans.length; i++)
    if (spans[i]!.start < spans[i - 1]!.end) return null

  let out = ``
  let cur = 0

  for (const span of spans) {
    out += basePlain.slice(cur, span.start) + span.new
    cur = span.end
  }

  out += basePlain.slice(cur)

  return out
}
