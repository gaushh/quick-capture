import { contextBridge, ipcRenderer } from 'electron'

import type {
  ExtractDestinationPayload,
  ExtractDestinationResult,
  SuggestEditsAiResult,
  TranscriptionResult,
} from './shared.js'

export type ResizePayload = { width: number; height: number }

export type PillApi = {
  resize: (size: ResizePayload) => Promise<unknown | null>
  show: () => Promise<unknown | null>
  hide: () => Promise<unknown | null>
  minimize: () => Promise<unknown | null>
  onSummon: (cb: () => void) => () => void
  onToggle: (cb: () => void) => () => void
  transcribeBlob: (args: { data: string; mime: string }) => Promise<TranscriptionResult>
  suggestEdits: (payload: { text: string }) => Promise<SuggestEditsAiResult>
  extractDestination: (payload: ExtractDestinationPayload) => Promise<ExtractDestinationResult>
  formatChecklist: (transcript: string) => Promise<{ items: { text: string; checked: boolean }[] }>
  copyText: (text: string) => Promise<boolean>
  quit: () => Promise<unknown | null>
  platform: NodeJS.Platform
}

const pillApi: PillApi = {
  resize: (size: ResizePayload) => ipcRenderer.invoke('pill:resize', size),

  show: () => ipcRenderer.invoke('pill:show'),

  hide: () => ipcRenderer.invoke('pill:hide'),

  minimize: () => ipcRenderer.invoke('pill:minimize'),

  onSummon(cb: () => void) {
    const wrapped = (): void => {
      cb()
    }
    ipcRenderer.on('pill:summon', wrapped)
    return () => ipcRenderer.removeListener('pill:summon', wrapped)
  },

  onToggle(cb: () => void) {
    const wrapped = (): void => { cb() }
    ipcRenderer.on('pill:toggle', wrapped)
    return () => ipcRenderer.removeListener('pill:toggle', wrapped)
  },

  transcribeBlob: ({ data, mime }) => ipcRenderer.invoke('openai:transcribe', { mime, data }),

  suggestEdits: (payload) => ipcRenderer.invoke('openai:suggest-edits', payload),

  extractDestination: (payload) => ipcRenderer.invoke('openai:extract-destination', payload),

  formatChecklist: (transcript: string) => ipcRenderer.invoke('openai:format-checklist', transcript),

  copyText: async (text: string) => ipcRenderer.invoke('pill:clipboard', text),

  quit: () => ipcRenderer.invoke('pill:quit'),

  platform: process.platform,
}

contextBridge.exposeInMainWorld('pill', pillApi)
