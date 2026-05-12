import type {
  MoveAutomationConditionSuggestion,
  MoveAutomationHpSuggestion,
  MoveAutomationScript,
  MoveAutomationStageSuggestion,
} from '~/types/moveAutomation'

export const buildMoveAutomationStartLogLines = (
  script: MoveAutomationScript,
  userName: string,
): string[] => [
  `${userName} used ${script.moveName}.`,
  script.kind === 'manual-fallback'
    ? 'Manual fallback resolver used: no explicit reviewed automation script exists for this move.'
    : `Explicit move script v${script.version} used.`,
]

export const formatMoveAutomationDamageLogLine = (
  targetName: string,
  hpLoss: number,
  critical: boolean | undefined = false,
): string => `${targetName}: ${hpLoss} HP damage${critical ? ' (critical flagged)' : ''}.`

export const formatMoveAutomationHpSuggestionLogLine = (
  tokenName: string,
  suggestion: Pick<MoveAutomationHpSuggestion, 'label'>,
  amount: number,
): string => `${tokenName}: ${suggestion.label}${amount > 0 ? ` (${amount} HP)` : ''}.`

const recipientNames = (recipients: readonly { species: string }[]): string =>
  recipients.map((token) => token.species).join(', ')

export const formatMoveAutomationConditionSuggestionLogLine = (
  suggestion: Pick<MoveAutomationConditionSuggestion, 'label' | 'action'>,
  recipients: readonly { species: string }[],
): string | null => {
  if (!recipients.length) return null
  return `${suggestion.label} ${suggestion.action === 'remove' ? 'removed from' : 'applied to'} ${recipientNames(recipients)}.`
}

export const formatMoveAutomationStageSuggestionLogLine = (
  suggestion: Pick<MoveAutomationStageSuggestion, 'label'>,
  recipients: readonly { species: string }[],
): string | null => {
  if (!recipients.length) return null
  return `${suggestion.label} on ${recipientNames(recipients)}.`
}

export const formatMoveAutomationManualNoteLogLine = (manualNote: string): string | null => {
  const trimmed = manualNote.trim()
  return trimmed ? `Manual note: ${trimmed}` : null
}

export const formatMoveAutomationAutomationNoteLogLines = (notes: readonly string[]): string[] =>
  notes.map((note) => `Note: ${note}`)
