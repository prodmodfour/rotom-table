import { describe, expect, it } from 'vitest'
import { trainerParticipantContestVariant, trainerParticipantMethodById } from '../../shared/contests/catalog'
import { createContestDocument, parseContestDocument } from '../../shared/contests/document'
import { CONTEST_PARTICIPANT_METHOD_IDS } from '../../shared/contests/ids'
import { parseContestCommand } from '../../shared/contests/operations'
import { resolveTrainerParticipantMethodTurn } from '../../shared/contests/participantMethods'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { executeContestEngineCommand } from '../../server/domain/contests/engine'

const create = (method: 'simultaneous'|'alternating'|null = null) => createContestDocument({
  contestId: 'contest:v1:participant-methods', name: 'Participant Methods', hallName: 'Method Hall', variantId: 'standard',
  participantVariantId: 'trainer-participant', participantMethodId: method, contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, now: 1,
})
const commandBase = (commandKind: string, operationId: string, expectedRevision = 0) => ({ schemaVersion: 1, contestId: 'contest:v1:participant-methods', commandKind, operationId, expectedRevision, clientId: 'method-test' })
const createSettings = (participantVariantId: 'trainer-participant'|null, participantMethodId?: unknown) => ({
  name: 'Participant Methods', hallName: 'Method Hall', description: '', variantId: 'standard', participantVariantId,
  ...(participantMethodId !== undefined ? { participantMethodId } : {}), contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true,
  prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '',
})

describe('Trainer Participant method policies', () => {
  it('strictly binds both canonical source rows and their complete method semantics', () => {
    expect(CONTEST_PARTICIPANT_METHOD_IDS).toEqual(['simultaneous', 'alternating'])
    expect(trainerParticipantContestVariant.methods).toEqual([
      {
        id: 'simultaneous', appealsPerEntryPerRound: 2, appealOrderPolicy: 'controller-chooses-trainer-or-pokemon-first',
        voltageScope: 'per-performer', adjacentEffectScope: 'both-performers-of-adjacent-entry',
        crossPerformerEffectPolicy: ['get-ready-may-apply-to-partner-same-round', 'attention-grabber-may-transfer-between-pair'],
      },
      {
        id: 'alternating', appealsPerEntryPerRound: 1, appealOrderPolicy: 'trainer-and-pokemon-alternate',
        voltageScope: 'shared-entry', adjacentEffectScope: 'shared-entry', crossPerformerEffectPolicy: [],
      },
    ])
    expect([...trainerParticipantMethodById.keys()]).toEqual(['simultaneous', 'alternating'])
  })

  it('schedules Simultaneous rounds in controller-chosen order with each member exactly once', () => {
    const open = resolveTrainerParticipantMethodTurn({ methodId: 'simultaneous', acceptedPerformerKindsThisRound: [], previousRoundTerminalPerformerKind: null })
    expect(open).toMatchObject({ appealsPerEntryPerRound: 2, roundComplete: false, legalNextPerformerKinds: ['trainer', 'pokemon'], voltageScope: 'per-performer', adjacentEffectScope: 'both-performers-of-adjacent-entry' })
    const trainerFirst = resolveTrainerParticipantMethodTurn({ methodId: 'simultaneous', acceptedPerformerKindsThisRound: ['trainer'], previousRoundTerminalPerformerKind: 'pokemon' })
    expect(trainerFirst).toMatchObject({ acceptedAppealsThisRound: 1, roundComplete: false, legalNextPerformerKinds: ['pokemon'] })
    expect(resolveTrainerParticipantMethodTurn({ methodId: 'simultaneous', acceptedPerformerKindsThisRound: ['trainer', 'pokemon'], previousRoundTerminalPerformerKind: null })).toMatchObject({ roundComplete: true, legalNextPerformerKinds: [] })
    expect(() => resolveTrainerParticipantMethodTurn({ methodId: 'simultaneous', acceptedPerformerKindsThisRound: ['pokemon', 'pokemon'], previousRoundTerminalPerformerKind: null })).toThrow(/each paired member exactly once/)
  })

  it('allows either first Alternating lead, then enforces the opposite member across entry rounds', () => {
    const first = resolveTrainerParticipantMethodTurn({ methodId: 'alternating', acceptedPerformerKindsThisRound: [], previousRoundTerminalPerformerKind: null })
    expect(first).toMatchObject({ appealsPerEntryPerRound: 1, legalNextPerformerKinds: ['trainer', 'pokemon'], voltageScope: 'shared-entry', adjacentEffectScope: 'shared-entry' })
    expect(resolveTrainerParticipantMethodTurn({ methodId: 'alternating', acceptedPerformerKindsThisRound: ['pokemon'], previousRoundTerminalPerformerKind: null })).toMatchObject({ roundComplete: true, legalNextPerformerKinds: [] })
    const nextRound = resolveTrainerParticipantMethodTurn({ methodId: 'alternating', acceptedPerformerKindsThisRound: [], previousRoundTerminalPerformerKind: 'pokemon' })
    expect(nextRound.legalNextPerformerKinds).toEqual(['trainer'])
    expect(() => resolveTrainerParticipantMethodTurn({ methodId: 'alternating', acceptedPerformerKindsThisRound: ['pokemon'], previousRoundTerminalPerformerKind: 'pokemon' })).toThrow(/requires the other paired member/)
    expect(() => resolveTrainerParticipantMethodTurn({ methodId: 'alternating', acceptedPerformerKindsThisRound: ['trainer', 'pokemon'], previousRoundTerminalPerformerKind: null })).toThrow(/exactly one paired appeal/)
  })

  it('strictly parses explicit create and setup-selection commands', () => {
    const parsed = parseContestCommand({ ...commandBase('create-contest', 'contest-op:v1:method-create'), settings: createSettings('trainer-participant', 'simultaneous') })
    expect(parsed).toMatchObject({ commandKind: 'create-contest', settings: { participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous' } })
    expect(() => parseContestCommand({ ...commandBase('create-contest', 'contest-op:v1:method-missing'), settings: createSettings('trainer-participant') })).toThrow(/participantMethodId.*required/)
    expect(() => parseContestCommand({ ...commandBase('create-contest', 'contest-op:v1:method-ordinary'), settings: createSettings(null, 'alternating') })).toThrow(/available only/)
    expect(() => parseContestCommand({ ...commandBase('set-participant-method', 'contest-op:v1:method-invalid'), participantMethodId: 'undefined-method' })).toThrow(/must be canonical/)
    expect(parseContestCommand({ ...commandBase('set-participant-method', 'contest-op:v1:method-select'), participantMethodId: 'alternating' })).toMatchObject({ commandKind: 'set-participant-method', participantMethodId: 'alternating' })
  })

  it('normalizes P11-053 setup documents to no choice and journals replay-safe setup selection', () => {
    const legacy = structuredClone(create()) as any
    delete legacy.participantMethodId
    const parsed = parseContestDocument(legacy)
    expect(parsed.participantMethodId).toBeNull()
    const missingStart = { ...commandBase('start-introduction', 'contest-op:v1:method-start-missing'), expectedRevision: parsed.revision } as const
    expect(() => executeContestEngineCommand(parsed, missingStart, { now: 2, random: createSeededContestRandomSource(1) })).toThrow(/Choose a canonical Trainer Participant method/)

    const selected = executeContestEngineCommand(parsed, { ...commandBase('set-participant-method', 'contest-op:v1:method-select', parsed.revision), participantMethodId: 'alternating' }, { now: 3, random: createSeededContestRandomSource(2) })
    expect(selected).toMatchObject({ revision: 1, participantMethodId: 'alternating' })
    expect(selected.history.at(-1)).toMatchObject({ type: 'participant-method-selected', operationId: 'contest-op:v1:method-select' })
    expect(() => executeContestEngineCommand(selected, { ...commandBase('start-introduction', 'contest-op:v1:method-start-gated', selected.revision) }, { now: 4, random: createSeededContestRandomSource(3) })).toThrow(/three through five contestants/)

    const ordinary = createContestDocument({ contestId: 'contest:v1:ordinary-methods', name: 'Ordinary', hallName: 'Hall', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, now: 1 })
    expect(() => executeContestEngineCommand(ordinary, { ...commandBase('set-participant-method', 'contest-op:v1:method-ordinary-set'), contestId: ordinary.contestId, participantMethodId: 'simultaneous' }, { now: 2, random: createSeededContestRandomSource(4) })).toThrow(/available only to Trainer Participant/)

    const forged = structuredClone(selected) as any
    forged.participantMethodId = 'parallel'
    expect(() => parseContestDocument(forged)).toThrow(/method is unavailable/)
  })
})
