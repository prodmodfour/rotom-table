import { describe, expect, it } from 'vitest'
import {
  GmMoveCorrectionDetailsValidationError,
  parseGmMoveCorrectionDetails,
} from '#shared/moveAutomation/correctionViews'

const detailsFixture = () => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  originOperationId: 'op_originview001',
  moveName: 'Swords Dance',
  acceptedAt: 1_000,
  acceptedRevision: 8,
  operations: [
    {
      operationId: 'inverse.state-change.1.combatStages',
      effectKind: 'combat-stages',
      reasonCode: 'combat-stage-changed',
      resource: {
        kind: 'sheet',
        sheetKind: 'pokemon',
        sheetSlug: 'actor',
        acceptedRevision: 5,
      },
      availability: 'available',
    },
    {
      operationId: 'unavailable.state-change.2',
      effectKind: 'history',
      reasonCode: 'accepted-move-log-projection',
      resource: { kind: 'map', mapSlug: 'arena', acceptedRevision: 8 },
      availability: 'unavailable',
      safety: 'externally-observed',
      unavailableReasonCode: 'accepted-log-may-be-observed',
    },
  ],
  corrections: [{
    correctionOperationId: 'op_correctionview1',
    originOperationId: 'op_originview001',
    operationIds: ['inverse.state-change.1.combatStages'],
    status: 'conflicted',
    createdAt: 1_100,
    mapRevision: 8,
    reasonCode: 'conflict',
    message: 'The affected resource changed.',
  }],
})

describe('GM move correction detail views', () => {
  it('parses a bounded mechanics-free operation and causal history projection', () => {
    const source = detailsFixture()
    const parsed = parseGmMoveCorrectionDetails(source)

    expect(parsed).toEqual(source)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.operations)).toBe(true)
    expect(parsed.corrections[0]).toMatchObject({
      status: 'conflicted',
      originOperationId: parsed.originOperationId,
    })
    expect(JSON.stringify(parsed)).not.toContain('expectedCurrent')
    expect(JSON.stringify(parsed)).not.toContain('restore')
  })

  it('rejects inverse values, unknown operations, and broken ancestry', () => {
    const withPrivateInverse = detailsFixture() as ReturnType<typeof detailsFixture> & {
      operations: Array<Record<string, unknown>>
    }
    withPrivateInverse.operations[0]!.inverse = {
      expectedCurrent: { currentHp: 1 },
      restore: { currentHp: 99 },
    }
    expect(() => parseGmMoveCorrectionDetails(withPrivateInverse)).toThrowError(
      GmMoveCorrectionDetailsValidationError,
    )

    const unknownSelection = detailsFixture()
    unknownSelection.corrections[0]!.operationIds = ['inverse.not-offered']
    expect(() => parseGmMoveCorrectionDetails(unknownSelection)).toThrow(/unavailable operation/)

    const brokenAncestry = detailsFixture()
    brokenAncestry.corrections[0]!.originOperationId = 'op_anotherorigin1'
    expect(() => parseGmMoveCorrectionDetails(brokenAncestry)).toThrow(/ancestry/)
  })
})
