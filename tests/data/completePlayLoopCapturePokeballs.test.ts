import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/capture-pokeballs.v1.json'
import items from '../../data/reference/items.json'
import reviewed from '../../scripts/reviewed-data/capture-pokeballs.v1.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

const canonicalBallIds = Object.entries(items)
  .filter(([, row]) => row.categories.includes('Poké Ball'))
  .map(([canonicalId]) => canonicalId)
  .sort((left, right) => left.localeCompare(right, 'en-US'))

describe('P8-093 reviewed structured Poké Ball provider', () => {
  it('covers every canonical Ball exactly once and pins reviewed source and canonical rows', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-093',
      status: 'reviewed-native',
      runtimeProseParsing: false,
      itemCount: 25,
      catalogSha256: sha256(readFileSync('data/reference/items.json')),
      reviewedSourceSha256: sha256(readFileSync('scripts/reviewed-data/capture-pokeballs.v1.json')),
    })
    expect(reviewed).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-093',
      reviewStatus: 'accepted',
      runtimeProseParsing: false,
      catalogSha256: contract.catalogSha256,
    })
    expect(contract.items.map(row => row.canonicalId).sort((left, right) => left.localeCompare(right, 'en-US')))
      .toEqual(canonicalBallIds)
    expect(new Set(contract.items.map(row => row.canonicalId)).size).toBe(25)
    expect(contract.registrySha256).toBe(sha256(stableJsonStringify(contract.items)))

    for (const row of contract.items) {
      const canonical = items[row.canonicalId as keyof typeof items]
      expect(canonical, row.canonicalId).toBeDefined()
      expect(row.canonicalRecordSha256, row.canonicalId).toBe(sha256(stableJsonStringify(canonical)))
      expect(row.canonicalEffectSha256, row.canonicalId).toBe(sha256(canonical.effects.join('\n')))
    }
  })

  it('records bounded automatic mechanics and explicit unavailable authority without prose inference', () => {
    const byId = new Map(contract.items.map(row => [row.canonicalId, row]))
    expect(byId.get('Timer Ball')).toMatchObject({
      baseModifier: 5,
      condition: { kind: 'round-schedule', modifiersByRound: [5, 0, -5, -10, -15, -20], afterLast: -20, authority: 'automatic' },
    })
    expect(byId.get('Friend Ball')?.postCapture).toEqual({
      kind: 'increase-starting-loyalty', amount: 1, authority: 'automatic',
    })
    expect(byId.get('Heal Ball')?.postCapture).toEqual({
      kind: 'heal-to-effective-maximum', authority: 'automatic',
    })
    for (const canonicalId of ['Lure Ball', 'Dive Ball', 'Luxury Ball', 'Dusk Ball']) {
      const row = byId.get(canonicalId)!
      const unavailable = row.condition.authority === 'unavailable-with-reason'
        ? row.condition
        : row.postCapture
      expect(unavailable.authority, canonicalId).toBe('unavailable-with-reason')
      expect(unavailable.unavailableReason, canonicalId).toBeTruthy()
    }

    const runtime = readFileSync('src/utils/pokeballCapture.ts', 'utf8')
    expect(runtime).not.toContain('entry.mod')
    expect(runtime).not.toMatch(/Capture Modifier[^\n]*match/)
    expect(runtime).toContain("runtimeProseParsing !== false")
  })
})
