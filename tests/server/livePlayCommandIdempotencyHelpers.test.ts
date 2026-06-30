import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type LivePlayCommandCoreEnvelope,
} from '#shared/livePlayCommands'
import {
  areCanonicalCommandsSemanticallyEqual,
  createCanonicalCommandHash,
  isAcceptedTerminalResult,
  isRejectedTerminalResult,
  validateLivePlayOperationId,
} from '~~/server/livePlay/commandIdempotency'

interface HelperTestPayload {
  readonly shopSlug: string
  readonly lines: readonly { readonly entryId: string; readonly quantity: number }[]
}

type HelperTestCommand = LivePlayCommandCoreEnvelope<string, HelperTestPayload, { readonly kind: 'helper' }>

interface HelperTestHashMaterial {
  readonly schemaVersion: HelperTestCommand['schemaVersion']
  readonly opId: string
  readonly type: string
  readonly scopes: HelperTestCommand['scopes']
  readonly payload: HelperTestPayload
}

const command = (overrides: Partial<HelperTestCommand> = {}): HelperTestCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_helperhash01',
  type: 'helperTest',
  scopes: [{ kind: 'helper' }],
  payload: {
    shopSlug: 'viridian-mart',
    lines: [{ entryId: 'potion-row', quantity: 1 }],
  },
  ...overrides,
})

const normalize = (input: HelperTestCommand): HelperTestHashMaterial => ({
  schemaVersion: input.schemaVersion,
  opId: input.opId,
  type: input.type,
  scopes: input.scopes,
  payload: input.payload,
})

const hash = (input: HelperTestCommand): string => createCanonicalCommandHash({
  command: input,
  normalize,
  path: 'helperCommand',
  errorPrefix: 'Helper command could not be hashed',
})

describe('live-play command idempotency helpers', () => {
  it('hashes semantically identical commands the same despite object key order', () => {
    const original = command()
    const sameCommandDifferentKeyOrder = command({
      payload: {
        lines: [{ quantity: 1, entryId: 'potion-row' }],
        shopSlug: 'viridian-mart',
      },
    })

    expect(areCanonicalCommandsSemanticallyEqual({
      left: original,
      right: sameCommandDifferentKeyOrder,
      normalize,
      path: 'helperCommand',
      errorPrefix: 'Helper command could not be hashed',
    })).toBe(true)
    expect(hash(sameCommandDifferentKeyOrder)).toBe(hash(original))
  })

  it('hashes changed command material differently', () => {
    const original = command()
    const changedQuantity = command({
      payload: {
        ...original.payload,
        lines: [{ entryId: 'potion-row', quantity: 2 }],
      },
    })

    expect(areCanonicalCommandsSemanticallyEqual({
      left: original,
      right: changedQuantity,
      normalize,
      path: 'helperCommand',
      errorPrefix: 'Helper command could not be hashed',
    })).toBe(false)
    expect(hash(changedQuantity)).not.toBe(hash(original))
  })

  it('centralizes operation ID and terminal result validation primitives', () => {
    expect(validateLivePlayOperationId('op_validhelper01')).toBe('op_validhelper01')
    expect(() => validateLivePlayOperationId('bad-op')).toThrow('/^op_[A-Za-z0-9_-]{8,96}$/')

    expect(isAcceptedTerminalResult({ ok: true, opId: 'op_validhelper01', revision: 2 })).toBe(true)
    expect(isAcceptedTerminalResult({ ok: true, duplicate: true, opId: 'op_validhelper01', original: {} })).toBe(false)
    expect(isRejectedTerminalResult({ ok: false, opId: 'op_validhelper01', reason: 'invalid', message: 'Nope' })).toBe(true)
  })

  it('does not require map-only command fields in helper-normalized command material', () => {
    const checkoutLikeCommand = command({ type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT })

    expect(hash(checkoutLikeCommand)).toMatch(/^[a-f0-9]{64}$/)
    expect(checkoutLikeCommand).not.toHaveProperty('mapSlug')
  })
})
