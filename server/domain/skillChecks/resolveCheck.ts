import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID,
  parseSkillCheckJournalId,
  parseSkillCheckOperationId,
  type SkillCheckAcceptedResultV1,
  type SkillCheckDiceJournalV1,
  type SkillCheckDocumentV1,
  type SkillCheckModifierContributorV1,
  type SkillCheckSubjectV1,
} from '#shared/skillChecks/contract'
import { parseSkillCheckDocument } from '#shared/skillChecks/persistence'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { parseSkillDiceValue } from '~/utils/skillRanks'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import {
  equipmentContributionOwnerContext,
  resolveEquipmentContributions,
  resolveEquipmentMetric,
} from '../itemAutomation/equipmentContributions'

export const SKILL_CHECK_MAX_TIE_REROLLS = 10 as const
export const SKILL_CHECK_MAX_DICE = 6 as const

export type SkillCheckResolutionErrorCode =
  | 'not-ready'
  | 'subject-not-accepted'
  | 'expired'
  | 'invalid-time'
  | 'sheet-missing'
  | 'sheet-identity-conflict'
  | 'sheet-revision-conflict'
  | 'skill-unavailable'
  | 'modifier-out-of-bounds'
  | 'journal-capacity-exceeded'
  | 'invalid-randomness'

export class SkillCheckResolutionError extends Error {
  readonly code: SkillCheckResolutionErrorCode

  constructor(code: SkillCheckResolutionErrorCode, message: string) {
    super(message)
    this.name = 'SkillCheckResolutionError'
    this.code = code
  }
}

export interface SkillCheckSubjectSheetSnapshot {
  readonly kind: SkillCheckSubjectV1['kind']
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface ResolveSkillCheckDocumentInput {
  readonly document: SkillCheckDocumentV1
  readonly operationId: SkillCheckDocumentV1['lastOperationId']
  readonly subjectSheets: readonly SkillCheckSubjectSheetSnapshot[]
  readonly now: number
  /** Server-owned integer source using the same inclusive/exclusive bounds as node:crypto randomInt. */
  readonly randomInt: (minimum: number, maximumExclusive: number) => number
}

interface ResolvedSkillProfile {
  readonly subject: SkillCheckSubjectV1
  readonly diceCount: number
  readonly sheetModifier: number
  readonly flatModifier: number
  readonly contributors: readonly SkillCheckModifierContributorV1[]
}

export interface SkillCheckGmModifierPreview {
  readonly diceCount: number
  readonly flatModifier: number
  readonly contributors: readonly SkillCheckModifierContributorV1[]
}

export interface SkillCheckSubjectModifierPreview {
  readonly diceCount: number
  /** Excludes contributors whose contract visibility is GM-only. */
  readonly visibleFlatModifier: number
  readonly contributors: readonly SkillCheckModifierContributorV1[]
  readonly privateGmAdjustment: 'none' | 'may-apply'
}

const fail = (code: SkillCheckResolutionErrorCode, message: string): never => {
  throw new SkillCheckResolutionError(code, message)
}

const safeInteger = (value: unknown, minimum: number, maximum: number): value is number => (
  Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
)

const digest = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const journalIdFor = (input: {
  readonly operationId: string
  readonly subjectId: string
  readonly attempt: number
  readonly kind: 'skill' | 'tie-coin'
}): SkillCheckDiceJournalV1['journalId'] => parseSkillCheckJournalId(
  `skill-check-journal:v1:${digest(input).slice(0, 40)}`,
)

const historyIdFor = (operationId: string): string => (
  `skill-check-history:v1:${digest({ operationId, kind: 'accepted' }).slice(0, 40)}`
)

const sheetModifierContributor = (
  subject: SkillCheckSubjectV1,
  value: number,
): SkillCheckModifierContributorV1 => Object.freeze({
  contributorId: `sheet:${subject.kind}:${subject.sheetSlug}:skill:${subject.skillId}`,
  label: subject.kind === 'trainer'
    ? 'Authoritative Trainer skill modifier'
    : 'Authoritative Pokémon skill modifier',
  value,
  visibility: 'gm-and-subject',
})

const situationalModifierContributor = (value: number): SkillCheckModifierContributorV1 => Object.freeze({
  contributorId: 'request:gm-situational-modifier',
  label: 'GM situational modifier',
  value,
  visibility: 'gm-only',
})

const resolveProfile = (
  document: SkillCheckDocumentV1,
  subject: SkillCheckSubjectV1,
  snapshot: SkillCheckSubjectSheetSnapshot | undefined,
): ResolvedSkillProfile => {
  if (!snapshot) return fail('sheet-missing', `Skill Check subject ${subject.subjectId} has no authoritative sheet.`)
  if (snapshot.kind !== subject.kind || snapshot.slug !== subject.sheetSlug) {
    return fail('sheet-identity-conflict', `Skill Check subject ${subject.subjectId} sheet identity changed.`)
  }
  if (snapshot.revision !== subject.sheetRevision) {
    return fail(
      'sheet-revision-conflict',
      `Skill Check subject ${subject.subjectId} expected sheet revision ${subject.sheetRevision}; current revision is ${snapshot.revision}.`,
    )
  }
  if (snapshot.sheet.slug !== subject.sheetSlug) {
    return fail('sheet-identity-conflict', `Skill Check subject ${subject.subjectId} sheet payload identity changed.`)
  }

  let diceCount: number
  let sheetModifier: number
  if (subject.kind === 'trainer') {
    const skill = resolveTrainerSkills(snapshot.sheet as TrainerSheet)
      .find(candidate => candidate.key === subject.skillId)
      ?? fail('skill-unavailable', `Trainer ${subject.sheetSlug} has no authoritative ${subject.skillId} skill.`)
    diceCount = skill.rankValue
    sheetModifier = skill.modifier
  }
  else {
    const expression = resolveSkills(snapshot.sheet as CharacterSheet)
      .find(candidate => candidate.key === subject.skillId)?.value
    const skill = parseSkillDiceValue(expression)
      ?? fail('skill-unavailable', `Pokémon ${subject.sheetSlug} has no valid authoritative ${subject.skillId} dice.`)
    diceCount = skill.dice
    sheetModifier = skill.modifier
  }

  if (!safeInteger(diceCount, 1, SKILL_CHECK_MAX_DICE)) {
    return fail('skill-unavailable', `${subject.subjectId} skill dice are outside the reviewed 1d6 through 6d6 bounds.`)
  }
  if (!safeInteger(sheetModifier, -100, 100)) {
    return fail('modifier-out-of-bounds', `${subject.subjectId} sheet modifier is outside the reviewed integer bounds.`)
  }
  const contributors: SkillCheckModifierContributorV1[] = []
  if (sheetModifier !== 0) contributors.push(sheetModifierContributor(subject, sheetModifier))
  let equipmentAdjustedModifier = sheetModifier
  if (snapshot.sheet.equipmentState !== undefined) {
    let resolution: ReturnType<typeof resolveEquipmentMetric>
    try {
      const equipment = resolveEquipmentContributions({
        equipmentState: snapshot.sheet.equipmentState,
        owner: equipmentContributionOwnerContext({
          kind: subject.kind,
          slug: subject.sheetSlug,
          sheet: snapshot.sheet,
        }),
      })
      resolution = resolveEquipmentMetric({
        contributions: equipment.active,
        metric: 'skill-check-modifier',
        targetId: subject.skillId,
        base: sheetModifier,
      })
    }
    catch {
      return fail('skill-unavailable', `${subject.subjectId} equipment skill authority is invalid.`)
    }
    if (resolution.conflict) {
      return fail('skill-unavailable', `${subject.subjectId} equipment skill modifiers conflict.`)
    }
    equipmentAdjustedModifier = resolution.final
    for (const step of resolution.contributions) {
      if (step.applied === 0) continue
      if (!safeInteger(step.applied, -100, 100)) {
        return fail('modifier-out-of-bounds', `${subject.subjectId} equipment modifier is outside the journal bounds.`)
      }
      contributors.push(Object.freeze({
        contributorId: `equipment:${digest({ instanceId: step.instanceId, contributionId: step.contributionId }).slice(0, 40)}`,
        label: step.canonicalItemId,
        value: step.applied,
        visibility: 'gm-and-subject' as const,
      }))
    }
  }
  const flatModifier = equipmentAdjustedModifier + document.situationalModifier
  if (!safeInteger(flatModifier, -100, 100)
    || contributors.reduce((sum, contributor) => sum + contributor.value, 0) !== equipmentAdjustedModifier) {
    return fail('modifier-out-of-bounds', `${subject.subjectId} final modifier is outside the journal bounds.`)
  }
  if (document.situationalModifier !== 0) contributors.push(situationalModifierContributor(document.situationalModifier))
  return Object.freeze({
    subject,
    diceCount,
    sheetModifier,
    flatModifier,
    contributors: Object.freeze(contributors),
  })
}

export const previewSkillCheckGmModifiers = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly subjectSheet: SkillCheckSubjectSheetSnapshot | undefined
}): SkillCheckGmModifierPreview => {
  const profile = resolveProfile(input.document, input.subject, input.subjectSheet)
  return Object.freeze({
    diceCount: profile.diceCount,
    flatModifier: profile.flatModifier,
    contributors: profile.contributors,
  })
}

export const previewSkillCheckSubjectModifiers = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly subjectSheet: SkillCheckSubjectSheetSnapshot | undefined
}): SkillCheckSubjectModifierPreview => {
  const gmPreview = previewSkillCheckGmModifiers(input)
  const contributors = Object.freeze(gmPreview.contributors.filter(contributor => contributor.visibility === 'gm-and-subject'))
  return Object.freeze({
    diceCount: gmPreview.diceCount,
    visibleFlatModifier: contributors.reduce((sum, contributor) => sum + contributor.value, 0),
    contributors,
    privateGmAdjustment: gmPreview.contributors.some(contributor => contributor.visibility === 'gm-only')
      ? 'may-apply'
      : 'none',
  })
}

const rollD6 = (randomInt: ResolveSkillCheckDocumentInput['randomInt']): number => {
  const result = randomInt(1, 7)
  if (!safeInteger(result, 1, 6)) {
    return fail('invalid-randomness', 'Skill Check server randomness returned an invalid d6 result.')
  }
  return result
}

const rollSkillJournal = (input: {
  readonly profile: ResolvedSkillProfile
  readonly operationId: string
  readonly attempt: number
  readonly now: number
  readonly randomInt: ResolveSkillCheckDocumentInput['randomInt']
}): SkillCheckDiceJournalV1 => {
  const results = Object.freeze(Array.from(
    { length: input.profile.diceCount },
    () => rollD6(input.randomInt),
  ))
  const dieTotal = results.reduce((sum, result) => sum + result, 0)
  return Object.freeze({
    journalId: journalIdFor({
      operationId: input.operationId,
      subjectId: input.profile.subject.subjectId,
      attempt: input.attempt,
      kind: 'skill',
    }),
    subjectId: input.profile.subject.subjectId,
    attempt: input.attempt,
    diceCount: input.profile.diceCount,
    dieSides: 6,
    flatModifier: input.profile.flatModifier,
    contributors: input.profile.contributors,
    results,
    dieTotal,
    finalTotal: dieTotal + input.profile.flatModifier,
    rolledAt: input.now,
  })
}

/**
 * PTU skill journals are d6-only. The reviewed fair server coin is therefore
 * persisted as one extra d6 journal: odd selects the first subject and even
 * selects the second. Its reserved contributor identity distinguishes it from
 * every skill attempt without introducing a second dice authority.
 */
const rollTieBreakJournal = (input: {
  readonly firstSubject: SkillCheckSubjectV1
  readonly operationId: string
  readonly now: number
  readonly randomInt: ResolveSkillCheckDocumentInput['randomInt']
}): SkillCheckDiceJournalV1 => {
  const result = rollD6(input.randomInt)
  return Object.freeze({
    journalId: journalIdFor({
      operationId: input.operationId,
      subjectId: input.firstSubject.subjectId,
      attempt: SKILL_CHECK_MAX_TIE_REROLLS + 1,
      kind: 'tie-coin',
    }),
    subjectId: input.firstSubject.subjectId,
    attempt: SKILL_CHECK_MAX_TIE_REROLLS + 1,
    diceCount: 1,
    dieSides: 6,
    flatModifier: 0,
    contributors: Object.freeze([Object.freeze({
      contributorId: SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID,
      label: 'Server tie-break coin (odd: first subject; even: second subject)',
      value: 0,
      visibility: 'gm-only' as const,
    })]),
    results: Object.freeze([result]),
    dieTotal: result,
    finalTotal: result,
    rolledAt: input.now,
  })
}

const acceptedResult = (input: {
  readonly profile: ResolvedSkillProfile
  readonly journals: readonly SkillCheckDiceJournalV1[]
  readonly finalTotal: number
  readonly outcome: SkillCheckAcceptedResultV1['outcome']
  readonly now: number
}): SkillCheckAcceptedResultV1 => Object.freeze({
  subjectId: input.profile.subject.subjectId,
  journalIds: Object.freeze(input.journals
    .filter(journal => journal.subjectId === input.profile.subject.subjectId
      && !journal.contributors.some(contributor => contributor.contributorId === SKILL_CHECK_TIE_BREAK_CONTRIBUTOR_ID))
    .map(journal => journal.journalId)),
  finalTotal: input.finalTotal,
  outcome: input.outcome,
  acceptedAt: input.now,
})

const resolveDc = (input: {
  readonly document: SkillCheckDocumentV1
  readonly profiles: readonly ResolvedSkillProfile[]
  readonly operationId: string
  readonly now: number
  readonly randomInt: ResolveSkillCheckDocumentInput['randomInt']
}): {
  readonly journals: readonly SkillCheckDiceJournalV1[]
  readonly results: readonly SkillCheckAcceptedResultV1[]
} => {
  if (input.document.comparison.kind !== 'dc') throw new Error('DC resolver received an opposed check.')
  const comparison = input.document.comparison
  const journals = input.profiles.map(profile => rollSkillJournal({
    profile,
    operationId: input.operationId,
    attempt: 1,
    now: input.now,
    randomInt: input.randomInt,
  }))
  const results = input.profiles.map((profile, index) => acceptedResult({
    profile,
    journals,
    finalTotal: journals[index]!.finalTotal,
    outcome: journals[index]!.finalTotal >= comparison.difficultyClass ? 'success' : 'failure',
    now: input.now,
  }))
  return Object.freeze({ journals: Object.freeze(journals), results: Object.freeze(results) })
}

const resolveOpposed = (input: {
  readonly profiles: readonly ResolvedSkillProfile[]
  readonly operationId: string
  readonly now: number
  readonly randomInt: ResolveSkillCheckDocumentInput['randomInt']
}): {
  readonly journals: readonly SkillCheckDiceJournalV1[]
  readonly results: readonly SkillCheckAcceptedResultV1[]
} => {
  const first = input.profiles[0]
  const second = input.profiles[1]
  if (!first || !second || input.profiles.length !== 2) throw new Error('Opposed resolver requires exactly two profiles.')
  const journals: SkillCheckDiceJournalV1[] = []
  let firstTotal = 0
  let secondTotal = 0
  for (let attempt = 1; attempt <= SKILL_CHECK_MAX_TIE_REROLLS + 1; attempt += 1) {
    const firstJournal = rollSkillJournal({
      profile: first,
      operationId: input.operationId,
      attempt,
      now: input.now,
      randomInt: input.randomInt,
    })
    const secondJournal = rollSkillJournal({
      profile: second,
      operationId: input.operationId,
      attempt,
      now: input.now,
      randomInt: input.randomInt,
    })
    journals.push(firstJournal, secondJournal)
    firstTotal = firstJournal.finalTotal
    secondTotal = secondJournal.finalTotal
    if (firstTotal !== secondTotal) break
  }

  let firstWins: boolean
  if (firstTotal !== secondTotal) firstWins = firstTotal > secondTotal
  else {
    const coin = rollTieBreakJournal({
      firstSubject: first.subject,
      operationId: input.operationId,
      now: input.now,
      randomInt: input.randomInt,
    })
    journals.push(coin)
    firstWins = coin.results[0]! % 2 === 1
  }
  const results = Object.freeze([
    acceptedResult({
      profile: first,
      journals,
      finalTotal: firstTotal,
      outcome: firstWins ? 'winner' : 'loser',
      now: input.now,
    }),
    acceptedResult({
      profile: second,
      journals,
      finalTotal: secondTotal,
      outcome: firstWins ? 'loser' : 'winner',
      now: input.now,
    }),
  ])
  return Object.freeze({ journals: Object.freeze(journals), results })
}

export const resolveSkillCheckDocument = (input: ResolveSkillCheckDocumentInput): SkillCheckDocumentV1 => {
  const document = parseSkillCheckDocument(input.document)
  const operationId = parseSkillCheckOperationId(input.operationId)
  if (document.state !== 'ready') return fail('not-ready', 'Skill Check must be ready before it can resolve.')
  if (document.subjects.some(subject => subject.response !== 'accepted')) {
    return fail('subject-not-accepted', 'Every Skill Check subject must accept before resolution.')
  }
  if (!safeInteger(input.now, document.updatedAt, Number.MAX_SAFE_INTEGER)) {
    return fail('invalid-time', 'Skill Check resolution time is stale or invalid.')
  }
  if (document.expiresAt !== null && input.now >= document.expiresAt) {
    return fail('expired', 'Skill Check expired before resolution.')
  }
  if (document.history.length >= 5000 || document.journals.length !== 0 || document.acceptedResults.length !== 0) {
    return fail('journal-capacity-exceeded', 'Skill Check cannot append bounded resolution evidence.')
  }

  const snapshots = new Map(input.subjectSheets.map(snapshot => [`${snapshot.kind}:${snapshot.slug}`, snapshot] as const))
  if (snapshots.size !== input.subjectSheets.length) {
    return fail('sheet-identity-conflict', 'Skill Check subject sheet snapshots contain duplicate identities.')
  }
  const profiles = document.subjects.map(subject => resolveProfile(
    document,
    subject,
    snapshots.get(`${subject.kind}:${subject.sheetSlug}`),
  ))
  if (snapshots.size !== profiles.length) {
    return fail('sheet-identity-conflict', 'Skill Check subject sheet snapshots do not exactly match the read set.')
  }

  const resolution = document.comparison.kind === 'dc'
    ? resolveDc({
        document,
        profiles,
        operationId,
        now: input.now,
        randomInt: input.randomInt,
      })
    : resolveOpposed({
        profiles,
        operationId,
        now: input.now,
        randomInt: input.randomInt,
      })

  return parseSkillCheckDocument({
    ...document,
    revision: document.revision + 1,
    state: 'accepted',
    journals: resolution.journals,
    acceptedResults: resolution.results,
    history: [...document.history, {
      historyId: historyIdFor(operationId),
      kind: 'accepted',
      operationId,
      subjectId: null,
      headline: 'Skill Check results accepted',
      createdAt: input.now,
    }],
    updatedAt: input.now,
    terminalAt: input.now,
    lastOperationId: operationId,
  })
}
