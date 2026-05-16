/** Manual light / dark chrome — stored so it stays across sessions (no OS media query sync). */

export type QcAppearance = 'light' | 'dark'

const STORAGE_KEY = `quick-capture-appearance`

export function getStoredAppearance(): QcAppearance {
  if (typeof localStorage === `undefined`) return `light`

  try {
    const raw = `${localStorage.getItem(STORAGE_KEY) ?? ``}`.trim()
    if (raw === `dark` || raw === `light`) return raw
    return `light`
  } catch {
    return `light`
  }
}

export function setStoredAppearance(mode: QcAppearance) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    //
  }
}

export function applyAppearanceToDocument(mode: QcAppearance) {
  document.documentElement.classList.toggle(`qc-theme-dark`, mode === `dark`)
}
