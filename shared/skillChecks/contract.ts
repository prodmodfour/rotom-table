import { TRAINER_SKILLS, type TrainerSkillKey } from '~/types/trainerSheet'

export const SKILL_CHECK_SCHEMA_VERSION = 1 as const
export const SKILL_CHECK_STATES = Object.freeze(['pending', 'ready', 'accepted', 'cancelled', 'timed-out'] as const)
export const SKILL_CHECK_OPERATION_KINDS = Object.freeze(['request', 'respond', 'resolve', 'cancel', 'timeout', 'correct'] as const)
export const SKILL_CHECK_SKILL_IDS = Object.freeze([...TRAINER_SKILLS])
/** Reserved contributor identity for the reviewed d6-parity opposed-check coin journal. */
export const SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID = 'system:opposed-tie-break-coin' as const

export type SkillCheckState = typeof SKILL_CHECK_STATES[number]
export type SkillCheckOperationKind = typeof SKILL_CHECK_OPERATION_KINDS[number]
export type SkillCheckSubjectKind = 'trainer' | 'pokemon'
export type SkillCheckResponse = 'pending' | 'accepted' | 'declined'
export type SkillCheckMode = 'single' | 'group'
export type SkillCheckVisibility = 'public-results' | 'participants-results' | 'gm-only-results'

export const SKILL_CHECK_DC_PRESET_IDS = Object.freeze([
  'skill-check-dc-preset:v1:easy',
  'skill-check-dc-preset:v1:challenging',
  'skill-check-dc-preset:v1:hard',
  'skill-check-dc-preset:v1:nigh-impossible',
] as const)
export type SkillCheckDcPresetId = typeof SKILL_CHECK_DC_PRESET_IDS[number]
export type SkillCheckDcSelectionV1 =
  | { readonly kind: 'explicit', readonly difficultyClass: number }
  | { readonly kind: 'preset', readonly presetId: SkillCheckDcPresetId }
export type SkillCheckRequestComparisonPolicyV1 =
  | {
      readonly kind: 'dc'
      readonly difficulty: SkillCheckDcSelectionV1
      readonly concealment: 'public' | 'subjects-after-acceptance' | 'gm-only'
    }
  | {
      readonly kind: 'opposed'
      readonly tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin'
    }

export type SkillCheckId = `skill-check:v1:${string}`
export type SkillCheckOperationId = `skill-check-op:v1:${string}`
export type SkillCheckSubjectId = `skill-check-subject:v1:${string}`
export type SkillCheckJournalId = `skill-check-journal:v1:${string}`

export interface SkillCheckSubjectV1 {
  readonly subjectId: SkillCheckSubjectId
  readonly kind: SkillCheckSubjectKind
  readonly sheetSlug: string
  readonly sheetRevision: number
  readonly skillId: TrainerSkillKey
  readonly controllerProfileIds: readonly string[]
  readonly response: SkillCheckResponse
  readonly respondedAt: number | null
}

export type SkillCheckComparisonPolicyV1 =
  | {
      readonly kind: 'dc'
      readonly difficultyClass: number
      readonly concealment: 'public' | 'subjects-after-acceptance' | 'gm-only'
    }
  | {
      readonly kind: 'opposed'
      readonly tiePolicy: 'reroll-both-up-to-10-then-journaled-server-coin'
    }

export interface SkillCheckModifierContributorV1 {
  readonly contributorId: string
  readonly label: string
  readonly value: number
  readonly visibility: 'gm-and-subject' | 'gm-only'
}

export interface SkillCheckDiceJournalV1 {
  readonly journalId: SkillCheckJournalId
  readonly subjectId: SkillCheckSubjectId
  readonly attempt: number
  readonly diceCount: number
  readonly dieSides: 6
  readonly flatModifier: number
  readonly contributors: readonly SkillCheckModifierContributorV1[]
  readonly results: readonly number[]
  readonly dieTotal: number
  readonly finalTotal: number
  readonly rolledAt: number
}

export interface SkillCheckAcceptedResultV1 {
  readonly subjectId: SkillCheckSubjectId
  readonly journalIds: readonly SkillCheckJournalId[]
  readonly finalTotal: number
  readonly outcome: 'success' | 'failure' | 'winner' | 'loser'
  readonly acceptedAt: number
}

export interface SkillCheckCorrectionReceiptV1 {
  readonly correctionId: string
  readonly operationId: SkillCheckOperationId
  readonly gmPrincipalId: string
  readonly reason: string
  readonly previousOutcome: SkillCheckAcceptedResultV1['outcome']
  readonly correctedOutcome: SkillCheckAcceptedResultV1['outcome']
  readonly createdAt: number
}

export interface SkillCheckHistoryEntryV1 {
  readonly historyId: string
  readonly kind: 'requested' | 'responded' | 'accepted' | 'cancelled' | 'timed-out' | 'corrected'
  readonly operationId: SkillCheckOperationId
  readonly subjectId: SkillCheckSubjectId | null
  readonly headline: string
  readonly createdAt: number
}

export interface SkillCheckDocumentV1 {
  readonly schemaVersion: typeof SKILL_CHECK_SCHEMA_VERSION
  readonly checkId: SkillCheckId
  readonly revision: number
  readonly state: SkillCheckState
  readonly mode: SkillCheckMode
  readonly requester: {
    readonly role: 'gm'
    readonly principalId: string
  }
  readonly publicLabel: string
  readonly prompt: string
  readonly gmNotes: string
  readonly visibility: SkillCheckVisibility
  readonly comparison: SkillCheckComparisonPolicyV1
  readonly situationalModifier: number
  readonly subjects: readonly SkillCheckSubjectV1[]
  readonly journals: readonly SkillCheckDiceJournalV1[]
  readonly acceptedResults: readonly SkillCheckAcceptedResultV1[]
  readonly corrections: readonly SkillCheckCorrectionReceiptV1[]
  readonly history: readonly SkillCheckHistoryEntryV1[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number | null
  readonly terminalAt: number | null
  readonly lastOperationId: SkillCheckOperationId
}

interface SkillCheckCommandBase {
  readonly schemaVersion: 1
  readonly operationId: SkillCheckOperationId
  readonly expectedRevision: number
}

export interface RequestSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'request'
  readonly expectedRevision: 0
  readonly checkId: SkillCheckId
  readonly publicLabel: string
  readonly prompt: string
  readonly gmNotes: string
  readonly visibility: SkillCheckVisibility
  readonly comparison: SkillCheckRequestComparisonPolicyV1
  readonly situationalModifier: number
  readonly expiresAt: number | null
  readonly subjects: readonly {
    readonly subjectId: SkillCheckSubjectId
    readonly kind: SkillCheckSubjectKind
    readonly sheetSlug: string
    readonly skillId: TrainerSkillKey
  }[]
}

export interface RespondSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'respond'
  readonly checkId: SkillCheckId
  readonly subjectId: SkillCheckSubjectId
  readonly decision: 'accept' | 'decline'
}

export interface ResolveSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'resolve'
  readonly checkId: SkillCheckId
}

export interface CancelSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'cancel'
  readonly checkId: SkillCheckId
  readonly reason: string
}

export interface TimeoutSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'timeout'
  readonly checkId: SkillCheckId
  readonly campaignMinute: number
}

export interface CorrectSkillCheckCommandV1 extends SkillCheckCommandBase {
  readonly commandKind: 'correct'
  readonly checkId: SkillCheckId
  readonly subjectId: SkillCheckSubjectId
  readonly correctedOutcome: SkillCheckAcceptedResultV1['outcome']
  readonly reason: string
}

export type SkillCheckCommandV1 =
  | RequestSkillCheckCommandV1
  | RespondSkillCheckCommandV1
  | ResolveSkillCheckCommandV1
  | CancelSkillCheckCommandV1
  | TimeoutSkillCheckCommandV1
  | CorrectSkillCheckCommandV1

const boundedId = <Value extends string>(value: unknown, label: string, expression: RegExp, maximum: number): Value => {
  if (typeof value !== 'string' || value.length > maximum || !expression.test(value)) {
    throw new Error(`${label} must be a stable bounded identifier.`)
  }
  return value as Value
}

export const parseSkillCheckId = (value: unknown, label = 'checkId'): SkillCheckId =>
  boundedId(value, label, /^skill-check:v1:[a-z0-9][a-z0-9-]{0,79}$/u, 95)

export const parseSkillCheckOperationId = (value: unknown, label = 'operationId'): SkillCheckOperationId =>
  boundedId(value, label, /^skill-check-op:v1:[A-Za-z0-9_-]{8,96}$/u, 114)

export const parseSkillCheckSubjectId = (value: unknown, label = 'subjectId'): SkillCheckSubjectId =>
  boundedId(value, label, /^skill-check-subject:v1:[a-z0-9][a-z0-9-]{0,79}$/u, 103)

export const parseSkillCheckJournalId = (value: unknown, label = 'journalId'): SkillCheckJournalId =>
  boundedId(value, label, /^skill-check-journal:v1:[a-z0-9][a-z0-9-]{0,95}$/u, 119)

export const isSkillCheckTerminal = (state: SkillCheckState): boolean =>
  state === 'accepted' || state === 'cancelled' || state === 'timed-out'

export const SKILL_CHECK_STATE_TRANSITIONS: Readonly<Record<SkillCheckState, readonly SkillCheckState[]>> = Object.freeze({
  pending: Object.freeze(['pending', 'ready', 'cancelled', 'timed-out'] as const),
  ready: Object.freeze(['accepted', 'cancelled', 'timed-out'] as const),
  accepted: Object.freeze(['accepted'] as const),
  cancelled: Object.freeze(['cancelled'] as const),
  'timed-out': Object.freeze(['timed-out'] as const),
})

export const assertSkillCheckDocumentInvariants = (document: SkillCheckDocumentV1): void => {
  if (document.schemaVersion !== 1) throw new Error('skill-check.unsupported-schema')
  parseSkillCheckId(document.checkId)
  parseSkillCheckOperationId(document.lastOperationId)
  if (!Number.isSafeInteger(document.revision) || document.revision < 1) throw new Error('skill-check.invalid-revision')
  if (!SKILL_CHECK_STATES.includes(document.state)) throw new Error('skill-check.invalid-state')
  if (document.subjects.length < 1 || document.subjects.length > 32) throw new Error('skill-check.invalid-subject-count')
  if ((document.mode === 'single') !== (document.subjects.length === 1)) throw new Error('skill-check.invalid-mode')
  if (document.comparison.kind === 'dc') {
    if (!Number.isSafeInteger(document.comparison.difficultyClass)
      || document.comparison.difficultyClass < 1
      || document.comparison.difficultyClass > 100) throw new Error('skill-check.invalid-dc')
  }
  else if (document.subjects.length !== 2) throw new Error('skill-check.opposed-requires-two-subjects')
  if (!Number.isSafeInteger(document.situationalModifier)
    || document.situationalModifier < -20
    || document.situationalModifier > 20) throw new Error('skill-check.invalid-situational-modifier')

  const subjectIds = document.subjects.map(subject => parseSkillCheckSubjectId(subject.subjectId))
  const subjectSheetKeys = document.subjects.map(subject => `${subject.kind}:${subject.sheetSlug}`)
  if (new Set(subjectIds).size !== subjectIds.length
    || new Set(subjectSheetKeys).size !== subjectSheetKeys.length) throw new Error('skill-check.duplicate-subject')
  for (const subject of document.subjects) {
    if (!SKILL_CHECK_SKILL_IDS.includes(subject.skillId)) throw new Error('skill-check.unknown-skill')
    if (!Number.isSafeInteger(subject.sheetRevision) || subject.sheetRevision < 0) throw new Error('skill-check.invalid-sheet-revision')
  }
  if ((document.state === 'ready' || document.state === 'accepted')
    && document.subjects.some(subject => subject.response !== 'accepted')) {
    throw new Error('skill-check.unaccepted-ready-subject')
  }

  const journalsById = new Map<string, SkillCheckDiceJournalV1>()
  const ordinaryJournalsBySubject = new Map(subjectIds.map(subjectId => [subjectId, [] as SkillCheckDiceJournalV1[]]))
  const tieBreakJournals: SkillCheckDiceJournalV1[] = []
  for (const journal of document.journals) {
    const journalId = parseSkillCheckJournalId(journal.journalId)
    if (journalsById.has(journalId)) throw new Error('skill-check.duplicate-journal')
    journalsById.set(journalId, journal)
    const contributorIds = journal.contributors.map(contributor => contributor.contributorId)
    const tieBreak = contributorIds.includes(SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID)
    if (!subjectIds.includes(journal.subjectId)
      || journal.dieSides !== 6
      || !Number.isSafeInteger(journal.attempt) || journal.attempt < 1 || journal.attempt > 11
      || !Number.isSafeInteger(journal.diceCount) || journal.diceCount < 1 || journal.diceCount > 20
      || !Number.isSafeInteger(journal.flatModifier) || journal.flatModifier < -100 || journal.flatModifier > 100
      || new Set(contributorIds).size !== contributorIds.length
      || journal.contributors.some(contributor => !Number.isSafeInteger(contributor.value))
      || journal.contributors.reduce((sum, contributor) => sum + contributor.value, 0) !== journal.flatModifier
      || journal.results.length !== journal.diceCount
      || journal.results.some(result => !Number.isSafeInteger(result) || result < 1 || result > 6)
      || journal.dieTotal !== journal.results.reduce((sum, result) => sum + result, 0)
      || journal.finalTotal !== journal.dieTotal + journal.flatModifier) throw new Error('skill-check.invalid-journal')
    if (tieBreak) {
      if (journal.contributors.length !== 1
        || journal.contributors[0]?.contributorId !== SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID
        || journal.contributors[0].value !== 0
        || journal.diceCount !== 1
        || journal.flatModifier !== 0
        || journal.attempt !== 11) throw new Error('skill-check.invalid-tie-break-journal')
      tieBreakJournals.push(journal)
    }
    else ordinaryJournalsBySubject.get(journal.subjectId)!.push(journal)
  }

  if (document.state === 'accepted') {
    if (document.acceptedResults.length !== document.subjects.length || document.terminalAt === null) {
      throw new Error('skill-check.incomplete-accepted-result')
    }
    const resultsBySubject = new Map(document.acceptedResults.map(result => [result.subjectId, result]))
    if (resultsBySubject.size !== subjectIds.length || subjectIds.some(subjectId => !resultsBySubject.has(subjectId))
      || document.journals.some(journal => journal.rolledAt !== document.terminalAt)) {
      throw new Error('skill-check.invalid-result')
    }
    for (const subjectId of subjectIds) {
      const result = resultsBySubject.get(subjectId)!
      const journals = ordinaryJournalsBySubject.get(subjectId)!
      if (journals.length < 1
        || result.journalIds.length !== journals.length
        || result.journalIds.some((journalId, index) => journalId !== journals[index]?.journalId)
        || result.finalTotal !== journals.at(-1)?.finalTotal
        || result.acceptedAt !== document.terminalAt) throw new Error('skill-check.invalid-result')
    }

    if (document.comparison.kind === 'dc') {
      if (tieBreakJournals.length > 0
        || document.journals.some((journal, index) => journal.subjectId !== subjectIds[index])) {
        throw new Error('skill-check.invalid-dc-result')
      }
      for (const subjectId of subjectIds) {
        const journals = ordinaryJournalsBySubject.get(subjectId)!
        const result = resultsBySubject.get(subjectId)!
        const expected = result.finalTotal >= document.comparison.difficultyClass ? 'success' : 'failure'
        if (journals.length !== 1 || journals[0]?.attempt !== 1 || result.outcome !== expected) {
          throw new Error('skill-check.invalid-dc-result')
        }
      }
    }
    else {
      const firstJournals = ordinaryJournalsBySubject.get(subjectIds[0]!)!
      const secondJournals = ordinaryJournalsBySubject.get(subjectIds[1]!)!
      const ordinaryJournals = document.journals.filter(journal => !journal.contributors
        .some(contributor => contributor.contributorId === SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID))
      if (firstJournals.length !== secondJournals.length || firstJournals.length > 11
        || ordinaryJournals.some((journal, index) => journal.subjectId !== subjectIds[index % 2])
        || firstJournals.some((journal, index) => journal.attempt !== index + 1
          || secondJournals[index]?.attempt !== index + 1
          || index < firstJournals.length - 1 && journal.finalTotal !== secondJournals[index]?.finalTotal)) {
        throw new Error('skill-check.invalid-opposed-result')
      }
      const firstResult = resultsBySubject.get(subjectIds[0]!)!
      const secondResult = resultsBySubject.get(subjectIds[1]!)!
      let firstWins: boolean
      if (firstResult.finalTotal !== secondResult.finalTotal) {
        if (tieBreakJournals.length !== 0) throw new Error('skill-check.invalid-opposed-result')
        firstWins = firstResult.finalTotal > secondResult.finalTotal
      }
      else {
        const coin = tieBreakJournals[0]
        if (firstJournals.length !== 11 || tieBreakJournals.length !== 1
          || coin?.subjectId !== subjectIds[0]
          || document.journals.at(-1)?.journalId !== coin?.journalId) throw new Error('skill-check.invalid-opposed-result')
        firstWins = coin!.results[0]! % 2 === 1
      }
      if (firstResult.outcome !== (firstWins ? 'winner' : 'loser')
        || secondResult.outcome !== (firstWins ? 'loser' : 'winner')) {
        throw new Error('skill-check.invalid-opposed-result')
      }
    }
  }
  else if (document.acceptedResults.length > 0 || document.journals.length > 0) {
    throw new Error('skill-check.unaccepted-dice-evidence')
  }
  if (isSkillCheckTerminal(document.state) !== (document.terminalAt !== null)) throw new Error('skill-check.invalid-terminal-boundary')
}
