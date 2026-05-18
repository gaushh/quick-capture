export const SPRING_TRANSITION = [
  'width 420ms cubic-bezier(0.32, 0.72, 0, 1)',
  'height 420ms cubic-bezier(0.32, 0.72, 0, 1)',
  'border-radius 400ms cubic-bezier(0.32, 0.72, 0, 1)',
  'box-shadow 350ms ease',
  'opacity 220ms ease',
].join(', ')

export type PhaseKind = 'idle' | 'recording' | 'output'

export const WIDTH_BY_PHASE: Record<PhaseKind, number> = {
  idle:      124,   // notes | mic
  recording: 52, // recording phase uses embedded card layout — width unused for shell
  output:    480,
}

export const HEIGHT_BY_PHASE: Record<PhaseKind, number> = {
  idle:      38,
  recording: 52,
  output:    520,
}
