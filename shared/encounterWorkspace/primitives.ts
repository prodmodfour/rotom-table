import type { EncounterVisualState } from './designTokens'

export interface EncounterSideAccent {
  id: string
  label: string
  symbol: string
  color?: string
}

export interface EncounterResourceSummary {
  id: string
  label: string
  current: number
  maximum?: number | null
}

export interface EncounterParticipantSummary {
  id: string
  name: string
  role: string
  portraitUrl?: string | null
  side: EncounterSideAccent
  relationship?: string | null
  hp?: {
    current: number
    maximum: number
    temporary?: number
  } | null
  injuries?: number
  conditions?: string[]
  resources?: EncounterResourceSummary[]
  currentTurn?: boolean
  controlled?: boolean
  hidden?: boolean
  fainted?: boolean
}

export type EncounterActionAvailability = 'available' | 'unavailable'

export interface EncounterActionSummary {
  id: string
  name: string
  category: string
  source: string
  timing: string
  cost?: string | null
  usage?: string | null
  scope?: string | null
  availability: EncounterActionAvailability
  unavailableReason?: string | null
  state?: EncounterVisualState
  recommended?: boolean
}

export interface EncounterDecisionOption {
  id: string
  label: string
  description?: string | null
  disabled?: boolean
  disabledReason?: string | null
  selected?: boolean
}

export interface EncounterDecisionSummary {
  id: string
  ownerLabel: string
  headline: string
  prompt: string
  publicSummary?: string | null
  options: EncounterDecisionOption[]
  timingLabel?: string | null
  canPass?: boolean
  canCancel?: boolean
  state?: Extract<EncounterVisualState, 'pending' | 'corrected' | 'unavailable'>
}
