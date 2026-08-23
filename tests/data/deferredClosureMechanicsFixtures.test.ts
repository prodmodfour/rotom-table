import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../../data/deferred-closure/mechanics-acceptance-fixtures.v1.json'
import equipment from '../../data/complete-play-loop/equipment-definitions.v1.json'
import grants from '../../data/complete-play-loop/equipment-grants.v1.json'
import items from '../../data/reference/items.json'
import { capabilityWeaponMove } from '../../shared/capabilityAutomation/weaponMoves'
import { findMoveDamageBase, formatMoveDamageBaseFormula } from '../../src/utils/moveDamageBase'

const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const recordHashes = new Map(equipment.definitions.map(row => [row.canonicalItemId, row.canonicalRecordSha256]))
const grantRows = grants.definitions.flatMap(definition => definition.grants.map(grant => ({ item: definition.canonicalItemId, grant })))
const profileByItem = new Map(grantRows.filter(row => row.grant.kind === 'weapon-profile').map(row => [row.item, row.grant]))
const actionById = new Map(grantRows.filter(row => row.grant.kind === 'action').map(row => [row.grant.actionId, row.grant]))

describe('P11-009 deterministic mechanics acceptance fixtures', () => {
  it('covers exactly six profiles, seven Moves, and eleven item actions', () => {
    expect(fixtures).toMatchObject({ schemaVersion: 1, ticket: 'P11-009', status: 'reviewed', runtimeProseParsing: false })
    expect(fixtures.counts).toEqual({ weaponProfiles: 6, weaponMoves: 7, itemActions: 11, total: 24 })
    expect(fixtures.weaponProfiles).toHaveLength(6)
    expect(fixtures.weaponMoves).toHaveLength(7)
    expect(fixtures.itemActions).toHaveLength(11)
    const all = [...fixtures.weaponProfiles, ...fixtures.weaponMoves, ...fixtures.itemActions]
    expect(new Set(all.map(row => row.fixtureId)).size).toBe(24)
    expect(new Set(all.map(row => row.seed)).size).toBe(24)
  })

  it('binds every fixture to canonical item bytes and the reviewed gear fingerprint', () => {
    expect(fixtures.sourceAuthority.itemsCatalogSha256).toBe(sha('data/reference/items.json'))
    expect(fixtures.sourceAuthority.gearDocumentSha256).toBe(sha('books/markdown/core/09-gear-and-items.md'))
    for (const fixture of [...fixtures.weaponProfiles, ...fixtures.weaponMoves, ...fixtures.itemActions]) {
      expect((items as Record<string, unknown>)[fixture.source.canonicalItemId], fixture.fixtureId).toBeDefined()
      expect(fixture.source.canonicalRecordSha256, fixture.fixtureId).toBe(recordHashes.get(fixture.source.canonicalItemId))
      expect(fixture.source.documentarySha256, fixture.fixtureId).toBe(fixtures.sourceAuthority.gearDocumentSha256)
    }
  })

  it('pins ranged legality, AC, DB, damage, custody, and no invented ammunition', () => {
    for (const fixture of fixtures.weaponProfiles) {
      const profile = profileByItem.get(fixture.source.canonicalItemId) as any
      expect(profile).toMatchObject({
        weaponClass: fixture.expected.weaponClass,
        rangeMinimumMeters: fixture.expected.rangeMinimumMeters,
        rangeMaximumMeters: fixture.expected.rangeMaximumMeters,
        handsRequired: fixture.expected.handsRequired,
        ammunitionPolicy: 'abstracted-no-tracked-consumption',
      })
      expect(fixture.expected.effectiveAccuracyCheck).toBe(fixture.declaration.baseAccuracyCheck + profile.accuracyCheckPenalty)
      expect(fixture.expected.effectiveDamageBase).toBe(fixture.declaration.baseDamageBase + profile.damageBaseBonus)
      expect(formatMoveDamageBaseFormula(findMoveDamageBase(fixture.expected.effectiveDamageBase)!)).toBe(fixture.expected.damageFormula)
      expect(fixture.expected.ammunitionConsumed).toBe(0)
      expect(fixture.expected.receiptKinds).toContain('accepted-result')
      expect(fixture.illegal.validationCode).toBe('weapon.target-out-of-range')
      expect(fixture.pokemonWielderCase).toMatchObject({ expectedLegal: false, validationCode: 'weapon.ranged-pokemon-ineligible' })
    }
  })

  it('pins all new Move stats after exact source-profile modifiers and rank gates', () => {
    for (const fixture of fixtures.weaponMoves) {
      const definition = capabilityWeaponMove(fixture.source.weaponMoveId)!
      const profile = profileByItem.get(fixture.source.canonicalItemId) as any
      expect(definition).not.toBeNull()
      expect(fixture.expected.minimumCombatRank).toBe(fixture.actor.combatRank)
      expect(fixture.expected.effectiveAccuracyCheck).toBe(Number(definition.ac) + profile.accuracyCheckPenalty)
      expect(fixture.expected.effectiveDamageBase).toBe(Number(definition.db) + profile.damageBaseBonus)
      expect(fixture.illegal.mutation['actor.combatRank']).toBe(fixture.expected.minimumCombatRank - 1)
      expect(fixture.illegal.validationCode).toMatch(/^weapon-move\.[a-z-]+\.rank-required$/)
      if (fixture.expected.minimumCombatRank === 6) {
        expect(fixture.pokemonWielderCase).toMatchObject({ expectedLegal: false, validationCode: 'weapon-move.pokemon-master-ineligible' })
      }
    }
  })

  it('pins each item action to a real grant, complete commit receipts, and one stable illegal declaration', () => {
    for (const fixture of fixtures.itemActions) {
      expect(actionById.has(fixture.actionId), fixture.actionId).toBe(true)
      expect(['native', 'guided']).toContain(fixture.expected.finalState)
      expect(fixture.expected.receiptKinds).toContain('accepted-result')
      expect(fixture.illegal.validationCode).toMatch(/^[a-z]+(?:-[a-z]+)*(?:\.[a-z]+(?:-[a-z]+)*)+$/)
      expect(Object.keys(fixture.illegal.mutation).length).toBeGreaterThan(0)
    }
    expect(fixtures.itemActions.filter(row => row.actionId.startsWith('equipment.fishing.'))).toHaveLength(3)
    expect(fixtures.itemActions.find(row => row.actionId === 'equipment.shock-collar.activate')?.expected.hitPointLoss).toBe(10)
    expect(fixtures.itemActions.find(row => row.actionId === 'equipment.weighted-nets.pull')?.expected.distanceMeters).toBe(1)
  })

  it('records deterministic server-owned randomness and explicit ambiguity decisions', () => {
    expect(fixtures.determinism).toMatchObject({ randomAlgorithm: 'fixture-ordered-faces', serverOwned: true, clock: 'fixture-campaign-minute' })
    expect(fixtures.reviewedFixturePolicies.statusAttackRange).toContain('4m')
    expect(fixtures.reviewedFixturePolicies.fishingAttemptTime).toContain('15-minute')
    expect(fixtures.reviewedFixturePolicies.fractionRounding).toContain('floor')
  })
})
