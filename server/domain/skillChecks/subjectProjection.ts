import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { SkillCheckDocumentV1, SkillCheckHistoryEntryV1, SkillCheckSubjectV1 } from '#shared/skillChecks/contract'
import { parseSkillCheckSubjectRequestView, type SkillCheckSubjectComparisonViewV1, type SkillCheckSubjectRequestViewV1, type SkillCheckSubjectSkillAuthorityV1, type SkillCheckSubjectUnavailableReason } from '#shared/skillChecks/subjectWorkflow'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { previewSkillCheckSubjectModifiers, type SkillCheckSubjectSheetSnapshot } from './resolveCheck'

const digest = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const safeLabel = (subject: SkillCheckSubjectV1, sheet: CharacterSheet | TrainerSheet | undefined): string => {
  const candidate = subject.kind === 'trainer'
    ? (sheet as TrainerSheet | undefined)?.name
    : (sheet as CharacterSheet | undefined)?.nickname || (sheet as CharacterSheet | undefined)?.species
  return typeof candidate === 'string' && candidate.trim() && candidate.length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate)
    ? candidate.trim()
    : subject.sheetSlug
}

const skillAuthority = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly snapshot: SkillCheckSubjectSheetSnapshot | undefined
}): SkillCheckSubjectSkillAuthorityV1 => {
  try {
    const preview = previewSkillCheckSubjectModifiers({
      document: input.document,
      subject: input.subject,
      subjectSheet: input.snapshot,
    })
    return Object.freeze({
      status: 'available',
      skillId: input.subject.skillId,
      diceCount: preview.diceCount,
      visibleFlatModifier: preview.visibleFlatModifier,
      contributors: Object.freeze(preview.contributors.map(contributor => Object.freeze({
        label: contributor.label,
        value: contributor.value,
      }))),
      privateGmAdjustment: preview.privateGmAdjustment,
    })
  }
  catch {
    return Object.freeze({
      status: 'unavailable',
      skillId: input.subject.skillId,
      reason: 'skill-authority-unavailable',
    })
  }
}

const comparisonView = (document: SkillCheckDocumentV1): SkillCheckSubjectComparisonViewV1 => {
  if (document.comparison.kind === 'opposed') {
    return Object.freeze({
      kind: 'opposed',
      tiePolicyLabel: 'Server rerolls ties, then uses a journaled fair coin after ten ties.',
    })
  }
  const disclosure = document.comparison.concealment === 'public'
    ? 'visible' as const
    : document.comparison.concealment === 'gm-only'
      ? 'gm-only' as const
      : 'after-acceptance' as const
  const visible = disclosure === 'visible' || (disclosure === 'after-acceptance' && document.state === 'accepted')
  return Object.freeze({
    kind: 'dc',
    difficultyClass: visible ? document.comparison.difficultyClass : null,
    disclosure,
  })
}

const subjectHistoryHeadline = (entry: SkillCheckHistoryEntryV1): string => {
  if (entry.kind === 'requested') return 'Skill Check requested'
  if (entry.kind === 'responded') return 'You responded to the Skill Check'
  if (entry.kind === 'accepted') return 'Skill Check resolved'
  if (entry.kind === 'cancelled') return 'Skill Check cancelled'
  if (entry.kind === 'timed-out') return 'Skill Check timed out'
  return 'Your Skill Check result was corrected'
}

const subjectHistory = (
  document: SkillCheckDocumentV1,
  subject: SkillCheckSubjectV1,
): readonly {
  readonly entryId: `skill-check-subject-history:v1:${string}`
  readonly kind: SkillCheckHistoryEntryV1['kind']
  readonly headline: string
  readonly createdAt: number
}[] => Object.freeze(document.history
  .filter(entry => entry.kind === 'corrected'
    ? entry.subjectId === subject.subjectId
    : entry.subjectId === null || entry.subjectId === subject.subjectId)
  .map(entry => Object.freeze({
    entryId: `skill-check-subject-history:v1:${digest({
      checkId: document.checkId,
      subjectId: subject.subjectId,
      historyId: entry.historyId,
    }).slice(0, 40)}` as const,
    kind: entry.kind,
    headline: subjectHistoryHeadline(entry),
    createdAt: entry.createdAt,
  })))

const unavailableReason = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly authority: SkillCheckSubjectSkillAuthorityV1
  readonly now: number
}): SkillCheckSubjectUnavailableReason | null => {
  if (input.subject.response !== 'pending') return 'already-responded'
  if (input.document.state !== 'pending') return 'check-not-pending'
  if (input.document.expiresAt !== null && input.now >= input.document.expiresAt) return 'expired-awaiting-timeout'
  if (input.authority.status !== 'available') return 'skill-authority-unavailable'
  return null
}

export const buildSkillCheckSubjectRequestView = (input: {
  readonly document: SkillCheckDocumentV1
  readonly subject: SkillCheckSubjectV1
  readonly snapshot: SkillCheckSubjectSheetSnapshot | undefined
  readonly now: number
}): SkillCheckSubjectRequestViewV1 => {
  const authority = skillAuthority(input)
  const reason = unavailableReason({ ...input, authority })
  const acceptedResult = input.document.acceptedResults.find(result => result.subjectId === input.subject.subjectId)
  const result = input.document.state !== 'accepted'
    ? null
    : input.document.visibility === 'gm-only-results'
      ? Object.freeze({ visibility: 'withheld' as const, finalTotal: null, outcome: null })
      : Object.freeze({
          visibility: 'visible' as const,
          finalTotal: acceptedResult?.finalTotal ?? null,
          outcome: acceptedResult?.outcome ?? null,
        })
  return parseSkillCheckSubjectRequestView({
    schemaVersion: 1,
    projection: 'subject',
    checkId: input.document.checkId,
    revision: input.document.revision,
    state: input.document.state,
    subjectId: input.subject.subjectId,
    subjectKind: input.subject.kind,
    subjectLabel: safeLabel(input.subject, input.snapshot?.sheet),
    publicLabel: input.document.publicLabel,
    prompt: input.document.prompt,
    response: input.subject.response,
    skillAuthority: authority,
    comparison: comparisonView(input.document),
    group: {
      subjectCount: input.document.subjects.length,
      acceptedCount: input.document.subjects.filter(subject => subject.response === 'accepted').length,
    },
    canRespond: reason === null,
    canDecline: reason === null,
    unavailableReason: reason,
    result,
    history: subjectHistory(input.document, input.subject),
    expiresAt: input.document.expiresAt,
    updatedAt: input.document.updatedAt,
  })
}
