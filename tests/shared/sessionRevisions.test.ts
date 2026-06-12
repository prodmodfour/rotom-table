import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  INITIAL_MAP_REVISION,
  INITIAL_REVISION_VALUE,
  INITIAL_SESSION_REVISION,
  MAX_REVISION_VALUE,
  compareMapRevisions,
  compareRevisions,
  compareSessionRevisions,
  incrementMapRevision,
  incrementRevision,
  incrementSessionRevision,
  isMapRevision,
  isRevision,
  isRevisionAfter,
  isRevisionBefore,
  isSameRevision,
  isSessionRevision,
  nextMapRevision,
  nextRevision,
  nextSessionRevision,
  normalizeRevision,
  parseMapRevision,
  parseRevision,
  parseSessionRevision,
  serializeMapRevision,
  serializeRevision,
  serializeSessionRevision,
  type MapRevision,
  type Revision,
  type RevisionComparison,
  type SerializedRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'

describe('session revision helpers', () => {
  it('brands validated session and map revisions as monotonic numeric protocol values', () => {
    const genericRevision = parseRevision(3)
    const sessionRevision = parseSessionRevision(0)
    const mapRevision = parseMapRevision(12)

    expect(INITIAL_REVISION_VALUE).toBe(0)
    expect(INITIAL_SESSION_REVISION).toBe(0)
    expect(INITIAL_MAP_REVISION).toBe(0)
    expect(genericRevision).toBe(3)
    expect(sessionRevision).toBe(0)
    expect(mapRevision).toBe(12)
    expect(isRevision(genericRevision)).toBe(true)
    expect(isSessionRevision(sessionRevision)).toBe(true)
    expect(isMapRevision(mapRevision)).toBe(true)

    expectTypeOf(genericRevision).toEqualTypeOf<Revision>()
    expectTypeOf(sessionRevision).toEqualTypeOf<SessionRevision>()
    expectTypeOf(mapRevision).toEqualTypeOf<MapRevision>()
    expectTypeOf(sessionRevision).toMatchTypeOf<Revision>()
    expectTypeOf(mapRevision).toMatchTypeOf<Revision>()
    expectTypeOf(sessionRevision).not.toMatchTypeOf<MapRevision>()
    expectTypeOf(mapRevision).not.toMatchTypeOf<SessionRevision>()
  })

  it('rejects malformed, fractional, negative, and non-JSON-safe revisions', () => {
    expect(isRevision(-1)).toBe(false)
    expect(isRevision(1.5)).toBe(false)
    expect(isRevision(Number.NaN)).toBe(false)
    expect(isRevision(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isRevision(MAX_REVISION_VALUE + 1)).toBe(false)
    expect(isRevision('1')).toBe(false)
    expect(isRevision(null)).toBe(false)

    expect(() => parseRevision(-1)).toThrow('revision must be a safe non-negative integer revision')
    expect(() => parseSessionRevision('1')).toThrow(
      'sessionRevision must be a safe non-negative integer revision',
    )
    expect(() => parseMapRevision(1.5)).toThrow(
      'mapRevision must be a safe non-negative integer revision',
    )
    expect(normalizeRevision(5)).toBe(5)
    expect(normalizeRevision(undefined)).toBe(INITIAL_REVISION_VALUE)
    expect(normalizeRevision('5')).toBe(INITIAL_REVISION_VALUE)
  })

  it('increments revisions one step at a time and guards against overflow', () => {
    const firstGenericRevision = incrementRevision(parseRevision(0))
    const secondGenericRevision = nextRevision(firstGenericRevision)
    const firstSessionRevision = incrementSessionRevision(INITIAL_SESSION_REVISION)
    const secondSessionRevision = nextSessionRevision(firstSessionRevision)
    const firstMapRevision = incrementMapRevision(INITIAL_MAP_REVISION)
    const secondMapRevision = nextMapRevision(firstMapRevision)

    expect(firstGenericRevision).toBe(1)
    expect(secondGenericRevision).toBe(2)
    expect(firstSessionRevision).toBe(1)
    expect(secondSessionRevision).toBe(2)
    expect(firstMapRevision).toBe(1)
    expect(secondMapRevision).toBe(2)

    expectTypeOf(firstSessionRevision).toEqualTypeOf<SessionRevision>()
    expectTypeOf(firstMapRevision).toEqualTypeOf<MapRevision>()
    expect(() => incrementSessionRevision(parseSessionRevision(MAX_REVISION_VALUE))).toThrow(
      `sessionRevision cannot advance past ${MAX_REVISION_VALUE}`,
    )
  })

  it('compares revisions without changing their serialized value', () => {
    const before = parseRevision(1)
    const after = parseRevision(2)
    const sessionBefore = parseSessionRevision(4)
    const sessionAfter = parseSessionRevision(5)
    const mapBefore = parseMapRevision(7)
    const mapAfter = parseMapRevision(8)

    expect(compareRevisions(before, after)).toBe(-1)
    expect(compareRevisions(after, before)).toBe(1)
    expect(compareRevisions(before, parseRevision(1))).toBe(0)
    expect(compareSessionRevisions(sessionBefore, sessionAfter)).toBe(-1)
    expect(compareMapRevisions(mapAfter, mapBefore)).toBe(1)
    expect(isRevisionBefore(before, after)).toBe(true)
    expect(isRevisionAfter(after, before)).toBe(true)
    expect(isSameRevision(before, parseRevision(1))).toBe(true)

    expectTypeOf(compareRevisions(before, after)).toEqualTypeOf<RevisionComparison>()
  })

  it('serializes revisions as JSON-safe numbers and parses them back from snapshots', () => {
    const sessionRevision = parseSessionRevision(6)
    const mapRevision = parseMapRevision(9)
    const snapshot = {
      sessionRevision: serializeSessionRevision(sessionRevision),
      mapRevision: serializeMapRevision(mapRevision),
      revision: serializeRevision(parseRevision(2)),
    }

    expect(snapshot).toEqual({ sessionRevision: 6, mapRevision: 9, revision: 2 })
    expect(JSON.stringify(snapshot)).toBe('{"sessionRevision":6,"mapRevision":9,"revision":2}')

    const revived = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
    expect(parseSessionRevision(revived.sessionRevision)).toBe(sessionRevision)
    expect(parseMapRevision(revived.mapRevision)).toBe(mapRevision)
    expect(parseRevision(revived.revision)).toBe(2)
    expectTypeOf(snapshot.sessionRevision).toEqualTypeOf<SerializedRevision>()

    expect(() => serializeSessionRevision(Number.NaN as SessionRevision)).toThrow(
      'sessionRevision must be a safe non-negative integer revision',
    )
  })
})
