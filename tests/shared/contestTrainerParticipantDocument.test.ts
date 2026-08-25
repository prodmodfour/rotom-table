import { describe, expect, it } from 'vitest'
import { contestBaseVariantAllowsTrainerParticipants, trainerParticipantContestVariant } from '../../shared/contests/catalog'
import {
  createContestDocument,
  parseContestDocument,
  type ContestDocumentV1,
  type ContestPokemonPerformerSnapshotV1,
  type ContestTrainerPerformerSnapshotV1,
} from '../../shared/contests/document'
import { buildContestPerformerSnapshot, buildContestTrainerPerformerSnapshot } from '../../shared/contests/integrations'
import { CONTEST_STAT_IDS, CONTEST_VARIANT_IDS, type ContestVariantId } from '../../shared/contests/ids'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { createContestantState, executeContestEngineCommand } from '../../server/domain/contests/engine'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const trainerSheet = (slug = 'trainer-pair'): TrainerSheet => ({
  slug,
  name: 'Avery',
  level: 7,
  movelist: [{ name: 'Charm' }, { name: 'Unreviewed Contest Technique' }],
})
const pokemonSheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: `Partner ${slug.at(-1)}`,
  species: 'Pikachu',
  level: 12,
  movelist: [{ name: 'Growl' }],
})
const pokemonPerformer = (slug: string, revision = 3): ContestPokemonPerformerSnapshotV1 =>
  buildContestPerformerSnapshot({ sheet: pokemonSheet(slug), trainer: trainerSheet(), campaignDay: 0, revision })
const trainerPerformer = (revision = 5): ContestTrainerPerformerSnapshotV1 =>
  buildContestTrainerPerformerSnapshot({ sheet: trainerSheet(), revision })

const baseDocument = (variantId: ContestVariantId = 'standard', participant = true): ContestDocumentV1 => createContestDocument({
  contestId: `contest:v1:trainer-participant-${variantId}`,
  name: 'Trainer Participant Fixture',
  hallName: 'Fixture Hall',
  variantId,
  participantVariantId: participant ? 'trainer-participant' : null,
  participantMethodId: participant ? 'simultaneous' : null,
  contestTypeId: variantId === 'supercontest' ? null : 'cute',
  significanceMultiplier: 1,
  awardRibbon: true,
  now: 10,
})

const enroll = (document: ContestDocumentV1, performers: readonly (ContestPokemonPerformerSnapshotV1 | ContestTrainerPerformerSnapshotV1)[], rotationOrder: readonly number[] = []): ContestDocumentV1 => {
  const enrollment = createContestantState({
    contestantId: 'contestant:trainer-pair',
    trainerSheetSlug: 'trainer-pair',
    trainerSheetRevision: 5,
    displayName: 'Avery',
    controller: { kind: 'gm' },
    performers,
    rotationOrder,
  })
  return executeContestEngineCommand(document, {
    schemaVersion: 1,
    operationId: 'contest-op:v1:trainer-pair-enroll',
    contestId: document.contestId,
    commandKind: 'enroll-contestant',
    expectedRevision: document.revision,
    clientId: 'document-test',
    contestantId: enrollment.contestantId,
    trainerSheetSlug: enrollment.trainerSheetSlug,
    pokemonSheetSlugs: performers.filter((row): row is ContestPokemonPerformerSnapshotV1 => row.performerKind === 'pokemon').map(row => row.pokemonSheetSlug),
    controller: enrollment.controller,
    rotationOrder,
  }, { now: 11, random: createSeededContestRandomSource(1), enrollment })
}

describe('Trainer Participant Contest document authority', () => {
  it('binds the native canonical participant row to every reviewed native base variant', () => {
    expect(trainerParticipantContestVariant).toMatchObject({
      id: 'trainer-participant',
      completionState: 'native',
      structuredSemanticsVersion: 1,
      contestantMinimum: 3,
      contestantMaximum: 5,
      performerPolicy: {
        performersPerEntry: ['trainer', 'pokemon'],
        trainerMayAppeal: true,
        moveAuthority: 'authoritative-performer-move-list',
        missingContestIdentityPolicy: 'reject',
      },
    })
    expect(trainerParticipantContestVariant.compatibleBaseVariantIds).toEqual(CONTEST_VARIANT_IDS)
    for (const variantId of CONTEST_VARIANT_IDS) {
      expect(contestBaseVariantAllowsTrainerParticipants(variantId)).toBe(true)
      expect(baseDocument(variantId).participantVariantId).toBe('trainer-participant')
    }
    expect(contestBaseVariantAllowsTrainerParticipants('unreviewed' as never)).toBe(false)
    expect(() => baseDocument('unreviewed' as never)).toThrow(/supported Contest variant/)
  })

  it('snapshots one exact Trainer beside the Pokémon without a parallel Contest dice pool', () => {
    const trainer = trainerPerformer()
    expect(trainer).toMatchObject({
      performerKind: 'trainer',
      trainerSheetSlug: 'trainer-pair',
      trainerSheetRevision: 5,
      displayName: 'Avery',
      level: 7,
    })
    expect(trainer.moves.find(row => row.label === 'Charm')).toMatchObject({ available: true, source: 'sheet' })
    expect(trainer.moves.find(row => row.label === 'Unreviewed Contest Technique')).toMatchObject({
      available: false,
      unavailableCode: 'contest.move-identity-missing',
    })
    for (const statId of CONTEST_STAT_IDS) expect(trainer.dicePools[statId]).toEqual({ total: 0, remaining: 0, contributors: [] })

    const document = enroll(baseDocument(), [pokemonPerformer('pokemon-pair'), trainer])
    expect(document.contestants[0]?.performers.map(row => row.performerKind)).toEqual(['pokemon', 'trainer'])
    expect(document.contestants[0]?.performers[1]).toEqual(trainer)
    expect(parseContestDocument(structuredClone(document))).toEqual(document)
  })

  it('strictly enforces participant composition, exact Trainer authority, and typed fields', () => {
    const valid = enroll(baseDocument(), [pokemonPerformer('pokemon-pair'), trainerPerformer()])

    const missingTrainer = structuredClone(valid) as any
    missingTrainer.contestants[0].performers.pop()
    expect(() => parseContestDocument(missingTrainer)).toThrow(/exactly one Trainer performer/)

    const mismatchedRevision = structuredClone(valid) as any
    mismatchedRevision.contestants[0].performers[1].trainerSheetRevision = 4
    expect(() => parseContestDocument(mismatchedRevision)).toThrow(/exact enrolled Trainer sheet revision/)

    const parallelPool = structuredClone(valid) as any
    parallelPool.contestants[0].performers[1].dicePools.cute = {
      total: 1,
      remaining: 1,
      contributors: [{ id: 'forged', kind: 'combat-stat', statId: 'cute', dice: 1, active: true, label: 'Forged', sourceId: 'forged', explanation: 'Forged parallel authority.' }],
    }
    expect(() => parseContestDocument(parallelPool)).toThrow(/cannot retain a parallel Contest dice pool/)

    const crossKindField = structuredClone(valid) as any
    crossKindField.contestants[0].performers[1].species = 'Human'
    try { parseContestDocument(crossKindField); throw new Error('expected cross-kind field rejection') }
    catch (error) { expect(error).toMatchObject({ field: 'contestants[0].performers[1].species', message: 'is not recognized' }) }

    const ordinary = structuredClone(baseDocument('standard', false)) as any
    ordinary.contestants = structuredClone(valid.contestants)
    ordinary.revision = valid.revision
    ordinary.updatedAt = valid.updatedAt
    ordinary.history = structuredClone(valid.history)
    expect(() => parseContestDocument(ordinary)).toThrow(/does not permit a Trainer performer/)
  })

  it('keeps Rotation order on Pokémon identities while allowing the paired Trainer snapshot', () => {
    const performers = [pokemonPerformer('pokemon-a'), pokemonPerformer('pokemon-b'), pokemonPerformer('pokemon-c'), trainerPerformer()]
    const valid = enroll(baseDocument('rotation'), performers, [0, 1, 2])
    expect(valid.contestants[0]?.performers).toHaveLength(4)

    const trainerInOrder = structuredClone(valid) as any
    trainerInOrder.contestants[0].rotationOrder = [0, 1, 3]
    expect(() => parseContestDocument(trainerInOrder)).toThrow(/Rotation order may reference only enrolled Pokémon performers/)
  })

  it('upgrades pre-extension schema-v1 Pokémon snapshots without weakening exact parsing', () => {
    const ordinary = enroll(baseDocument('standard', false), [pokemonPerformer('pokemon-legacy')])
    const legacy = structuredClone(ordinary) as any
    delete legacy.participantVariantId
    delete legacy.contestants[0].performers[0].performerKind
    const parsed = parseContestDocument(legacy)
    expect(parsed.participantVariantId).toBeNull()
    expect(parsed.contestants[0]?.performers[0]?.performerKind).toBe('pokemon')

    const unknown = structuredClone(parsed) as any
    unknown.contestants[0].performers[0].trainerSheetSlug = 'forged-cross-kind'
    try { parseContestDocument(unknown); throw new Error('expected cross-kind field rejection') }
    catch (error) { expect(error).toMatchObject({ field: 'contestants[0].performers[0].trainerSheetSlug', message: 'is not recognized' }) }
  })

  it('rejects an incomplete Trainer Participant lineup before introduction stage writes', () => {
    const document = enroll(baseDocument(), [pokemonPerformer('pokemon-pair'), trainerPerformer()])
    expect(() => executeContestEngineCommand(document, {
      schemaVersion: 1,
      operationId: 'contest-op:v1:trainer-pair-start',
      contestId: document.contestId,
      commandKind: 'start-introduction',
      expectedRevision: document.revision,
      clientId: null,
    }, { now: 12, random: createSeededContestRandomSource(2) })).toThrow(/three through five contestants/)
  })
})
