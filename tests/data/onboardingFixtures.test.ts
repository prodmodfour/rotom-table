import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import failureFixtures from '../../data/onboarding/fixtures/failure-fixtures.json'
import pokedexJson from '../../data/reference/pokedex.json'
import featuresJson from '../../data/reference/features.json'
import edgesJson from '../../data/reference/edges.json'
import itemsJson from '../../data/reference/items.json'
import rulesJson from '../../data/reference/rules.json'

type PokedexRow = {
  species: string
  base_stats: Record<string, number>
  abilities: { basic?: string[] }
  level_up_moves?: { level: number, name: string }[]
  genderless?: boolean
  male_pct?: number | null
  female_pct?: number | null
}

const pokedex = pokedexJson as unknown as PokedexRow[]
const features = Object.values(featuresJson as Record<string, { name: string }>)
const edges = Object.values(edgesJson as Record<string, { name: string }>)
const items = Object.values(itemsJson as Record<string, { name: string }>)
const rules = Object.values(rulesJson as Record<string, { name?: string } & Record<string, unknown>>)

const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)

const pokedexRow = (species: string): PokedexRow => {
  const row = pokedex.find(entry => entry.species === species)
  expect(row, `pokedex row ${species}`).toBeDefined()
  return row!
}

const STAT_KEYS = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd'] as const
const POKEDEX_STAT_KEY: Record<string, string> = {
  hp: 'hp', atk: 'atk', def: 'def', satk: 'spatk', sdef: 'spdef', spd: 'spd',
}

// Neutral natures used by the fixtures cancel out; keep the checker honest.
const NEUTRAL_NATURES = new Set(['Composed', 'Hardy', 'Docile', 'Bashful', 'Quirky', 'Serious'])

describe('onboarding creation fixtures (P9-009)', () => {
  it('binds every fixture to live canonical fingerprints', () => {
    for (const fixture of creationFixtures.fixtures) {
      for (const bound of fixture.canonicalFingerprints) {
        const [file, selector] = bound.source.split('#')
        let actual: string | null = null
        if (file === 'data/reference/pokedex.json') {
          actual = fingerprint(pokedexRow(selector!.replace('species=', '')))
        } else if (file === 'data/reference/features.json') {
          actual = fingerprint(features.find(feature => feature.name === selector))
        } else if (file === 'data/reference/items.json') {
          actual = fingerprint(items.find(item => item.name === selector))
        } else if (file === 'data/reference/rules.json') {
          const [ruleName, field] = selector!.split('.')
          const rule = rules.find(entry => entry.name === ruleName)
          actual = fingerprint((rule as Record<string, unknown>)?.[field!])
        }
        expect(actual, `${fixture.fixtureId} fingerprint source ${bound.source}`).toBe(bound.sha256_16)
      }
    }
  })

  it('keeps trainer builds inside canonical budgets and entitlements', () => {
    for (const fixture of creationFixtures.fixtures) {
      const build = fixture.trainerBuild
      const spent = Object.values(build.statAllocation).reduce((sum, value) => sum + value, 0)
      const budget = build.level + 9
      expect(spent, `${fixture.fixtureId} trainer stat spend`).toBe(budget)
      expect(fixture.expected.derivedPreview.trainer.statPointsSpent).toBe(spent)
      expect(fixture.expected.derivedPreview.trainer.statPointsBudget).toBe(budget)

      // Derived HP: 2*level + 3*(10 base + added HP) + 10.
      const hpStat = 10 + build.statAllocation.hp
      expect(fixture.expected.derivedPreview.trainer.maxHp, fixture.fixtureId)
        .toBe(build.level * 2 + hpStat * 3 + 10)
      expect(fixture.expected.derivedPreview.trainer.apMax, fixture.fixtureId)
        .toBe(5 + Math.floor(build.level / 5))

      // Entitlements: 4 paid features at L1 plus one per odd level from 3; training feature is free.
      const oddLevels = Array.from({ length: build.level }, (_, index) => index + 1)
        .filter(level => level >= 3 && level % 2 === 1).length
      const paidFeatureSlots = 4 + oddLevels
      expect(build.features.length, `${fixture.fixtureId} paid features`).toBe(paidFeatureSlots)
      expect(fixture.expected.derivedPreview.trainer.featureRows)
        .toBe(build.features.length + 1)

      const evenLevels = Array.from({ length: build.level }, (_, index) => index + 1)
        .filter(level => level >= 2 && level % 2 === 0).length
      const edgeSlots = 4 + evenLevels
      expect(build.edges.length, `${fixture.fixtureId} edges`).toBe(edgeSlots)
      const bonusSkillEdges = (build as { bonusSkillEdges?: unknown[] }).bonusSkillEdges ?? []
      const expectedBonus = [2, 6, 12].filter(level => build.level >= level).length
      expect(bonusSkillEdges.length, `${fixture.fixtureId} bonus skill edges`).toBe(expectedBonus)
      expect(fixture.expected.derivedPreview.trainer.edgeRows)
        .toBe(build.edges.length + bonusSkillEdges.length)

      // Every named feature/edge resolves to a canonical row.
      expect(features.some(feature => feature.name === build.trainingFeature), build.trainingFeature).toBe(true)
      for (const feature of build.features) {
        expect(features.some(entry => entry.name === feature.name), `${fixture.fixtureId} feature ${feature.name}`).toBe(true)
      }
      for (const edge of build.edges) {
        expect(edges.some(entry => entry.name === edge.name), `${fixture.fixtureId} edge ${edge.name}`).toBe(true)
      }
    }
  })

  it('keeps starter builds canonical: budgets, base relations, moves, abilities, gender', () => {
    for (const fixture of creationFixtures.fixtures) {
      expect(fixture.pokemonBuilds.length).toBe(fixture.policy.pokemon.starterCount)
      fixture.pokemonBuilds.forEach((build, index) => {
        const row = pokedexRow(build.species)
        const expectedPreview = fixture.expected.derivedPreview.pokemon[index]!
        expect(expectedPreview.species).toBe(build.species)

        const spent = Object.values(build.addedStats).reduce((sum, value) => sum + value, 0)
        expect(spent, `${fixture.fixtureId} ${build.species} added spend`).toBe(build.level + 10)
        expect(expectedPreview.addedSpent).toBe(spent)
        expect(expectedPreview.addedBudget).toBe(build.level + 10)

        // Base relations with the neutral natures used by fixtures.
        expect(NEUTRAL_NATURES.has(build.nature), `${fixture.fixtureId} nature ${build.nature}`).toBe(true)
        const totals = STAT_KEYS.map(key => ({
          key,
          base: row.base_stats[POKEDEX_STAT_KEY[key]!] ?? 0,
          total: (row.base_stats[POKEDEX_STAT_KEY[key]!] ?? 0) + (build.addedStats as Record<string, number>)[key]!,
        }))
        for (const left of totals) {
          for (const right of totals) {
            if (left.base > right.base) {
              expect(left.total, `${fixture.fixtureId} ${build.species} base relation ${left.key}>${right.key}`)
                .toBeGreaterThan(right.total)
            }
          }
        }

        // Max HP: level + 3*HP + 10.
        const hpTotal = totals.find(entry => entry.key === 'hp')!.total
        expect(expectedPreview.maxHp, `${fixture.fixtureId} ${build.species} maxHp`)
          .toBe(build.level + hpTotal * 3 + 10)

        // Tutor points: 1 + floor(level/5).
        expect(expectedPreview.tutorPoints).toBe(1 + Math.floor(build.level / 5))

        // Moves: legal level-up entries at or below level; complete set expected.
        const legal = new Set((row.level_up_moves ?? [])
          .filter(move => move.level <= build.level)
          .map(move => move.name))
        expect(build.moves.length).toBe(expectedPreview.moveCount)
        for (const move of build.moves) {
          expect(legal.has(move), `${fixture.fixtureId} ${build.species} move ${move}`).toBe(true)
        }

        // Ability comes from the Basic tier at starter levels below 20.
        for (const ability of build.abilities) {
          expect(row.abilities.basic ?? [], `${fixture.fixtureId} ${build.species} ability ${ability}`)
            .toContain(ability)
        }

        // Gender respects species ratios.
        if (row.genderless) {
          expect(build.gender).toBeNull()
        } else if (build.gender === 'Male') {
          expect(row.male_pct ?? 0).toBeGreaterThan(0)
        } else if (build.gender === 'Female') {
          expect((row.female_pct ?? (row.male_pct !== undefined && row.male_pct !== null ? 100 - row.male_pct : 0))).toBeGreaterThan(0)
        }

        // Pool membership when curated.
        const pool = fixture.policy.pokemon.starterPool as { mode: string, species?: string[] }
        if (pool.mode === 'curated-list') {
          expect(pool.species, `${fixture.fixtureId} pool`).toContain(build.species)
        }
      })

      // Commit plan consistency.
      const plan = fixture.expected.commitPlan
      expect(plan.sheetsCreated).toBe(1 + fixture.pokemonBuilds.length)
      expect(plan.profileLinks).toBe(plan.sheetsCreated)
      expect(plan.teamMembers + plan.boxedMembers).toBe(fixture.pokemonBuilds.length)
      expect(plan.teamMembers).toBeLessThanOrEqual(6)
      const packageRows = (fixture.policy.packages.trainerItems as unknown[]).length
      expect(plan.inventoryRows).toBe(packageRows)
      expect(fixture.expected.readyForPlay).toBe(true)
    }
  })

  it('covers the required fixture spread', () => {
    const ids = new Set(creationFixtures.fixtures.map(fixture => fixture.fixtureId))
    for (const required of [
      'default-level1-single-starter',
      'higher-level-start',
      'multiple-starters',
      'class-subchoices',
      'equipment-package',
      'optional-unresolved-choices',
    ]) expect(ids, required).toContain(required)

    // Item package entries resolve canonically.
    const outfitted = creationFixtures.fixtures.find(fixture => fixture.fixtureId === 'equipment-package')!
    for (const entry of outfitted.policy.packages.trainerItems as { itemId: string }[]) {
      expect(items.some(item => item.name === entry.itemId), entry.itemId).toBe(true)
    }

    // Deferral fixture keeps deferred decisions inside the policy allowance.
    const relaxed = creationFixtures.fixtures.find(fixture => fixture.fixtureId === 'optional-unresolved-choices')!
    const workflow = relaxed.policy.workflow as { deferrableDecisions?: string[] }
    for (const deferred of (relaxed as { deferredDecisions?: string[] }).deferredDecisions ?? []) {
      expect(workflow.deferrableDecisions, deferred).toContain(deferred)
    }
  })
})

describe('onboarding failure fixtures (P9-010)', () => {
  it('freezes projections, retry, rollback, and no-partial-creation for every scenario', () => {
    const outcomeCodes = new Set(failureFixtures.outcomeCodes)
    expect(new Set(failureFixtures.fixtures.map(fixture => fixture.fixtureId)).size)
      .toBe(failureFixtures.fixtures.length)

    for (const fixture of failureFixtures.fixtures) {
      expect(outcomeCodes.has(fixture.expected.outcomeCode), fixture.fixtureId).toBe(true)
      for (const role of ['gm', 'ownerPlayer', 'otherPlayer', 'publicObserver'] as const) {
        expect(fixture.expected.projections[role]?.trim(), `${fixture.fixtureId} ${role}`).toBeTruthy()
      }
      expect(fixture.expected.projections.otherPlayer).toBe('nothing')
      expect(fixture.expected.projections.publicObserver).toBe('nothing')
      expect(fixture.expected.retryBehavior.trim(), fixture.fixtureId).not.toBe('')
      expect(fixture.expected.rollback.trim(), fixture.fixtureId).not.toBe('')
      expect(fixture.expected.partialSheetCreation, fixture.fixtureId).toBe('none')
    }
  })

  it('covers stale drafts, policy changes, slug collisions, invalid choices, interrupted approval, concurrency, profile loss, and restart', () => {
    const ids = new Set(failureFixtures.fixtures.map(fixture => fixture.fixtureId))
    for (const required of [
      'stale-draft-revision',
      'policy-superseded-during-draft',
      'duplicate-slug-at-commit',
      'invalid-prerequisite-submission',
      'interrupted-approval-commit',
      'concurrent-owner-and-gm-review',
      'profile-deleted-during-draft',
      'server-restart-resume',
    ]) expect(ids, required).toContain(required)
  })
})
