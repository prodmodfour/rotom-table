import { describe, expect, it } from 'vitest'
import {
  FinishEncounterViewParseError,
  parseFinishEncounterView,
} from '#shared/encounterSettlement/finish'

const command = {
  schemaVersion: 1,
  operationId: 'settlement-commit:v1:0000000001000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  settlementId: 'encounter-settlement:riverside-training',
  expectedSettlementRevision: 2,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true,
}
const ready = () => ({
  schemaVersion: 1,
  state: 'ready',
  encounterName: 'Riverside Training',
  participantCount: 2,
  readinessLabel: 'Ready to settle',
  readinessDetail: 'No unresolved decisions.',
  gates: [],
  consequences: [{ kind: 'hp', label: 'Hit Points', count: 2, detail: 'Preserved.' }],
  rewards: [{ kind: 'money', label: 'Money', amountLabel: '₽500', destinationLabel: 'Shared inventory', detail: null }],
  outcomes: [{ kind: 'encounter', label: 'Riverside Training', resultLabel: 'completed', visibility: 'public' }],
  cleanup: [{ kind: 'initiative', label: 'Initiative', sourceCount: 1, actionLabel: 'reset', detail: 'Reset.' }],
  outstandingWork: [],
  continuations: [],
  command,
  accepted: null,
})

describe('Finish Encounter view projection', () => {
  it('parses one strict bounded ready projection', () => {
    expect(parseFinishEncounterView(ready())).toEqual(ready())
  })

  it('rejects response expansion, technical row expansion, and inconsistent state', () => {
    expect(() => parseFinishEncounterView({ ...ready(), privateNotes: 'do not expose' }))
      .toThrow(FinishEncounterViewParseError)
    expect(() => parseFinishEncounterView({
      ...ready(),
      rewards: [{ ...ready().rewards[0], allocationId: 'private-row' }],
    })).toThrow(FinishEncounterViewParseError)
    expect(() => parseFinishEncounterView({ ...ready(), state: 'blocked' }))
      .toThrow(FinishEncounterViewParseError)
    expect(() => parseFinishEncounterView({
      ...ready(), state: 'accepted', command: null, accepted: null,
    })).toThrow(FinishEncounterViewParseError)
  })
})
