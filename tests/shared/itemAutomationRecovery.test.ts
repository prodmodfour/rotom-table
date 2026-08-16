import { describe, expect, it } from 'vitest'
import {
  ItemOperationRecoveryValidationError,
  parseItemOperationRecoveryCommand,
} from '#shared/itemAutomation/recovery'

const correction = () => ({
  schemaVersion: 1,
  operationId: 'op_item_origin_0001',
  action: 'correct',
  correctionOperationId: 'op_item_correction_0001',
  reason: 'The GM corrected the accepted target.',
})

describe('item operation recovery contracts', () => {
  it('parses and freezes bounded correction and abandonment intents', () => {
    const parsed = parseItemOperationRecoveryCommand(correction())
    expect(parsed).toEqual(correction())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(parseItemOperationRecoveryCommand({
      schemaVersion: 1, operationId: 'op_item_pending_0001', action: 'abandon',
      reason: 'The private decision is no longer needed.',
    })).toMatchObject({ action: 'abandon' })
  })

  it.each([
    [{ ...correction(), quantity: 1 }, 'invalid-command'],
    [{ ...correction(), mechanics: { hp: 20 } }, 'invalid-command'],
    [{ ...correction(), schemaVersion: 2 }, 'unsupported-schema-version'],
    [{ ...correction(), reason: ' x' }, 'invalid-command'],
    [{ ...correction(), reason: 'x'.repeat(501) }, 'limit-exceeded'],
    [{ ...correction(), operationId: 'short' }, 'invalid-command'],
    [{ ...correction(), correctionOperationId: correction().operationId }, 'invalid-command'],
  ] as const)('rejects untrusted recovery payload %j', (value, code) => {
    expect(() => parseItemOperationRecoveryCommand(value)).toThrow(ItemOperationRecoveryValidationError)
    try { parseItemOperationRecoveryCommand(value) }
    catch (error) { expect((error as ItemOperationRecoveryValidationError).code).toBe(code) }
  })

  it('detaches the immutable parsed command from caller-owned values', () => {
    const source = correction()
    const parsed = parseItemOperationRecoveryCommand(source)
    source.reason = 'Changed after parse.'
    expect(parsed.reason).toBe('The GM corrected the accepted target.')
  })
})
