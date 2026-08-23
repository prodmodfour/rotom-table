import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { SkillCheckDocumentV1, SkillCheckHistoryEntryV1, SkillCheckSubjectV1 } from '#shared/skillChecks/contract'
import {
  parseSkillCheckGmProjection,
  parseSkillCheckSpectatorProjection,
  type SkillCheckGmProjectionV1,
  type SkillCheckSpectatorHistoryEntryV1,
  type SkillCheckSpectatorProjectionV1,
} from '#shared/skillChecks/projections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { previewSkillCheckGmModifiers, type SkillCheckSubjectSheetSnapshot } from './resolveCheck'

const digest = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const safeLabel = (subject: SkillCheckSubjectV1, snapshot: SkillCheckSubjectSheetSnapshot | undefined): string => {
  const sheet = snapshot?.sheet
  const candidate = subject.kind === 'trainer'
    ? (sheet as TrainerSheet | undefined)?.name
    : (sheet as CharacterSheet | undefined)?.nickname || (sheet as CharacterSheet | undefined)?.species
  return typeof candidate === 'string' && candidate.trim() && candidate.length <= 120
    && !/[\u0000-\u001f\u007f]/u.test(candidate)
    ? candidate.trim()
    : subject.sheetSlug
}

export const buildSkillCheckGmProjection = (input: {
  readonly document: SkillCheckDocumentV1
  readonly snapshots: ReadonlyMap<string, SkillCheckSubjectSheetSnapshot>
}): SkillCheckGmProjectionV1 => parseSkillCheckGmProjection({
  schemaVersion: 1,
  projection: 'gm',
  document: input.document,
  subjects: input.document.subjects.map(subject => {
    const snapshot = input.snapshots.get(subject.subjectId)
    try {
      const modifierAuthority = previewSkillCheckGmModifiers({
        document: input.document,
        subject,
        subjectSheet: snapshot,
      })
      return {
        subjectId: subject.subjectId,
        label: safeLabel(subject, snapshot),
        modifierAuthority: {
          status: 'available',
          diceCount: modifierAuthority.diceCount,
          flatModifier: modifierAuthority.flatModifier,
          contributors: modifierAuthority.contributors,
        },
      }
    }
    catch {
      return {
        subjectId: subject.subjectId,
        label: safeLabel(subject, snapshot),
        modifierAuthority: {
          status: 'unavailable',
          reason: 'skill-authority-unavailable',
        },
      }
    }
  }),
})

const publicHistoryHeadline = (entry: SkillCheckHistoryEntryV1): string => {
  if (entry.kind === 'requested') return 'Skill Check requested'
  if (entry.kind === 'accepted') return 'Skill Check resolved'
  if (entry.kind === 'cancelled') return 'Skill Check cancelled'
  if (entry.kind === 'timed-out') return 'Skill Check timed out'
  return 'Skill Check result updated'
}

const publicHistory = (document: SkillCheckDocumentV1): readonly SkillCheckSpectatorHistoryEntryV1[] => Object.freeze(
  document.history
    .filter(entry => entry.kind !== 'responded'
      && (entry.kind !== 'corrected' || document.visibility === 'public-results'))
    .map(entry => Object.freeze({
      entryId: `skill-check-public-history:v1:${digest({
        checkId: document.checkId,
        historyId: entry.historyId,
      }).slice(0, 40)}` as const,
      kind: entry.kind as SkillCheckSpectatorHistoryEntryV1['kind'],
      headline: publicHistoryHeadline(entry),
      createdAt: entry.createdAt,
    })),
)

export const buildSkillCheckSpectatorProjection = (
  document: SkillCheckDocumentV1,
): SkillCheckSpectatorProjectionV1 => {
  const visible = document.visibility === 'public-results'
  const result = document.state !== 'accepted'
    ? null
    : visible
      ? {
          visibility: 'visible' as const,
          successfulSubjects: document.acceptedResults.filter(result => result.outcome === 'success').length,
          failedSubjects: document.acceptedResults.filter(result => result.outcome === 'failure').length,
          winners: document.acceptedResults.filter(result => result.outcome === 'winner').length,
          losers: document.acceptedResults.filter(result => result.outcome === 'loser').length,
        }
      : {
          visibility: 'withheld' as const,
          successfulSubjects: null,
          failedSubjects: null,
          winners: null,
          losers: null,
        }
  return parseSkillCheckSpectatorProjection({
    schemaVersion: 1,
    projection: 'spectator',
    checkId: document.checkId,
    revision: document.revision,
    state: document.state,
    publicLabel: document.publicLabel,
    pendingCount: document.subjects.filter(subject => subject.response === 'pending').length,
    result,
    history: publicHistory(document),
    updatedAt: document.updatedAt,
  })
}
