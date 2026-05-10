export type SaveIndicatorStatus = 'idle' | 'saving' | 'saved' | 'error'

export const saveIndicatorLabel = (status: SaveIndicatorStatus): string => {
  switch (status) {
    case 'saving': return 'Saving…'
    case 'saved': return 'Saved'
    case 'error': return 'Save failed'
    default: return 'Edit any cell to save'
  }
}

export const saveIndicatorTitle = (error: string | null | undefined): string => error ?? ''
