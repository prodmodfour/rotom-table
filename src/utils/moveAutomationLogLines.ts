import type {
  MoveAutomationConditionSuggestion,
  MoveAutomationHpSuggestion,
  MoveAutomationScript,
  MoveAutomationStageSuggestion,
} from '~/types/moveAutomation'
import type {
  MoveAutomationDamageBreakdown,
  MoveAutomationDamageBreakdownTerm,
} from '~/utils/moveAutomationTargetResolution'
import type { PtuInjuryAutomationResult } from '~/utils/ptuInjuries'

export const buildMoveAutomationStartLogLines = (
  script: MoveAutomationScript,
  userName: string,
): string[] => [
  `${userName} used ${script.moveName}.`,
  `Explicit move script v${script.version} used.`,
]

export const formatMoveAutomationDamageLogLine = (
  targetName: string,
  hpLoss: number,
  critical: boolean | undefined = false,
): string => `${targetName}: ${hpLoss} damage${critical ? ' (critical flagged)' : ''}.`

const formatDamageBreakdownTerm = (
  term: MoveAutomationDamageBreakdownTerm,
  index: number,
): string => {
  const sign = term.operator === 'subtract' ? '−' : '+'
  const prefix = index === 0 && term.operator === 'add' ? '' : `${sign} `
  return `${prefix}${term.amount} ${term.label}`
}

const formatDamageBreakdownTerms = (terms: readonly MoveAutomationDamageBreakdownTerm[]): string =>
  terms.map(formatDamageBreakdownTerm).join(' ')

export const formatMoveAutomationDamageBreakdownLogLine = (
  targetName: string,
  breakdown: MoveAutomationDamageBreakdown,
): string | null => {
  if (breakdown.kind === 'none' || breakdown.kind === 'direct') return null
  if (breakdown.kind === 'manual') {
    return `${targetName} damage breakdown: manual override = ${breakdown.manualHpLoss}.`
  }

  const result = breakdown.minimumDamageApplied
    ? `${breakdown.scaledDamage} → minimum ${breakdown.hpLoss}`
    : String(breakdown.hpLoss)

  return `${targetName} damage breakdown: (${formatDamageBreakdownTerms(breakdown.terms)}) × ${breakdown.multiplierLabel} = ${result}.`
}

export const formatMoveAutomationDirectHpLossLogLine = (
  targetName: string,
  hpLoss: number,
  label: string,
): string => `${targetName}: ${hpLoss} HP lost (${label}).`

export const formatMoveAutomationInjuryLogLine = (
  targetName: string,
  result: PtuInjuryAutomationResult,
): string | null => {
  if (result.injuryDelta <= 0) return null
  const reasons: string[] = []
  if (result.massiveDamageInjuries > 0) reasons.push('Massive Damage')
  if (result.markerInjuries > 0) {
    reasons.push(`${result.markerInjuries} HP Marker${result.markerInjuries === 1 ? '' : 's'}`)
  }
  return `${targetName}: +${result.injuryDelta} ${result.injuryDelta === 1 ? 'Injury' : 'Injuries'}${reasons.length ? ` (${reasons.join(', ')})` : ''}.`
}

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
  return trimmed ? `Note: ${trimmed}` : null
}

export const formatMoveAutomationAutomationNoteLogLines = (notes: readonly string[]): string[] =>
  notes.map((note) => `Note: ${note}`)
