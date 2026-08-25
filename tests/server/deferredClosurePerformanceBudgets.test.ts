import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import encounterBudgets from '../../data/encounter-workspace/performance-budgets.json'
import scaleBudgets from '../../data/complete-play-loop/performance-scale-budgets.v1.json'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase } from '../../server/useCases/contests'
import { projectContestGm, projectContestOwner, projectContestPublic } from '../../shared/contests/projections'
import type { ContestDocumentV1 } from '../../shared/contests/document'
import { createEmptySheetEquipmentState } from '../../shared/itemAutomation/equipment'
import type { PlayerProfile } from '../../shared/playerProfiles'
import type { TabletopMap } from '../../src/types/map'
import { activeEquipmentState } from '../fixtures/equipment'
import {
  createItemChoiceMap,
  createItemChoiceTargetSheet,
  createItemChoiceTrainerSheet,
  ITEM_CHOICE_ACTOR_ID,
} from '../fixtures/moveAutomation/itemChoices'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

const p95 = (samples: readonly number[]): number => {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.ceil(ordered.length * 0.95) - 1]!
}

const denseRangedFixture = () => {
  const baseMap = createItemChoiceMap()
  const actorPlacement = baseMap.placements.find(row => row.id === ITEM_CHOICE_ACTOR_ID)!
  const baseTarget = createItemChoiceTargetSheet()
  const pokemonSheets = Array.from({ length: 256 }, (_, index) => {
    const slug = `dense-ranged-target-${index}`
    return {
      ...structuredClone(baseTarget),
      slug,
      nickname: `Dense target ${index + 1}`,
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
    }
  })
  const map: TabletopMap = {
    ...baseMap,
    dimensions: { x: 32, y: 2, z: 32 },
    placements: [actorPlacement, ...pokemonSheets.map((sheet, index) => ({
      id: `dense-ranged-placement-${index}`,
      sheetKind: 'pokemon' as const,
      sheetSlug: sheet.slug,
      sideId: 'targets',
      initiative: 256 - index,
      position: { x: 4 + index % 16, y: 0, z: 1 + Math.floor(index / 16) },
    }))],
    encounterState: {
      ...baseMap.encounterState!,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active', color: '#4587c7' },
        targets: { id: 'targets', label: 'Targets', status: 'active', color: '#a06745' },
      },
    },
  }
  const trainer = {
    ...createItemChoiceTrainerSheet({ includePotion: false }),
    inventory: {},
    currentTeam: [],
    skillBackground: { name: 'Combatant', adept: 'combat' as const },
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'item-choice-trainer', slotId: 'mainHand',
      additionalSlotIds: ['offHand'], canonicalItemId: 'Hunting Bow',
    }),
  }
  const profile: PlayerProfile = {
    schemaVersion: 1,
    id: 'profile_dense_ranged',
    displayName: 'Dense ranged owner',
    linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainer.slug }],
    createdAt: 1,
    updatedAt: 1,
  }
  return { map, trainer, pokemonSheets, profile }
}

const operationId = (value: string): string => `contest-op:v1:${value.padEnd(16, 'x')}`

const maximumBattleContest = (): ContestDocumentV1 => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const teams = ['north', 'south'].map((side, teamIndex) => {
    const trainerSlug = `performance-${side}-trainer`
    const pokemonSlugs = Array.from({ length: 6 }, (_, index) => `performance-${side}-pokemon-${index + 1}`)
    sheets.save({
      kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1,
      document: {
        slug: trainerSlug, name: `${side} trainer`, level: 10,
        stats: { spd: { base: 20 - teamIndex } }, skills: { charm: { rankBonus: 1 } },
        currentTeam: pokemonSlugs,
      },
    })
    pokemonSlugs.forEach((slug, index) => sheets.save({
      kind: 'pokemon', slug, revision: 0, updatedAt: 1,
      document: {
        slug, nickname: `${side} ${index + 1}`, species: 'Pikachu', level: 10,
        stats: { spd: { base: 10 + index } }, movelist: [{ name: 'Growl' }],
      },
    }))
    return { side, trainerSlug, pokemonSlugs, profileId: `profile_performance_${side}` }
  })
  const profiles = new Map(teams.map(team => [team.profileId, {
    schemaVersion: 1 as const,
    id: team.profileId,
    displayName: `${team.side} owner`,
    linkedCharacters: [
      { sheetKind: 'trainer' as const, sheetSlug: team.trainerSlug },
      ...team.pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon' as const, sheetSlug })),
    ],
    createdAt: 1,
    updatedAt: 1,
  } satisfies PlayerProfile]))
  const contestId = 'contest:v1:maximum-battle-performance'
  let sequence = 0
  const execute = (command: Record<string, unknown>) => executeContestCommandUseCase({
    schemaVersion: 1,
    operationId: operationId(`performance-${sequence++}`),
    contestId,
    clientId: 'deferred-closure-performance',
    ...command,
  } as never, { role: 'gm' }, {
    database,
    now: () => 100,
    random: { nextInteger: minimum => minimum },
    readProfile: id => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  })
  let response = execute({
    commandKind: 'create-contest', expectedRevision: 0,
    settings: {
      name: 'Maximum Battle Performance', hallName: 'Budget Hall', description: '',
      variantId: 'battle', participantVariantId: null, participantMethodId: null,
      contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true,
      prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private budget note',
    },
  })
  for (const team of teams) response = execute({
    commandKind: 'enroll-contestant', expectedRevision: response.result.revision,
    contestantId: `contestant:performance-${team.side}`,
    trainerSheetSlug: team.trainerSlug,
    pokemonSheetSlugs: team.pokemonSlugs,
    controller: { kind: 'profile', profileId: team.profileId },
    rotationOrder: [],
  })
  return createSqliteContestRepository(database).get(contestId)!.document
}

const maximumTrainerParticipantContest = (): ContestDocumentV1 => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const entries = Array.from({ length: 5 }, (_, index) => {
    const trainerSlug = `performance-participant-trainer-${index + 1}`
    const pokemonSlug = `performance-participant-pokemon-${index + 1}`
    sheets.save({
      kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1,
      document: {
        slug: trainerSlug, name: `Participant trainer ${index + 1}`, level: 10,
        stats: { spd: { base: 20 - index } }, skills: { charm: { rankBonus: 1 } },
        movelist: [{ name: 'Charm' }], currentTeam: [pokemonSlug],
      },
    })
    sheets.save({
      kind: 'pokemon', slug: pokemonSlug, revision: 0, updatedAt: 1,
      document: {
        slug: pokemonSlug, nickname: `Participant Pokémon ${index + 1}`, species: 'Pikachu', level: 10,
        stats: { spd: { base: 10 + index } }, movelist: [{ name: 'Growl' }],
      },
    })
    return { trainerSlug, pokemonSlug }
  })
  const contestId = 'contest:v1:maximum-trainer-participant-performance'
  let sequence = 0
  const execute = (command: Record<string, unknown>) => executeContestCommandUseCase({
    schemaVersion: 1,
    operationId: operationId(`participant-performance-${sequence++}`),
    contestId,
    clientId: 'deferred-closure-performance',
    ...command,
  } as never, { role: 'gm' }, {
    database,
    now: () => 100,
    random: { nextInteger: minimum => minimum },
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  })
  let response = execute({
    commandKind: 'create-contest', expectedRevision: 0,
    settings: {
      name: 'Maximum Trainer Participant Performance', hallName: 'Budget Hall', description: '',
      variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'alternating',
      contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true,
      prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private budget note',
    },
  })
  for (const [index, entry] of entries.entries()) response = execute({
    commandKind: 'enroll-contestant', expectedRevision: response.result.revision,
    contestantId: `contestant:participant-performance-${index + 1}`,
    trainerSheetSlug: entry.trainerSlug,
    pokemonSheetSlugs: [entry.pokemonSlug],
    controller: { kind: 'gm' },
    rotationOrder: [],
  })
  return createSqliteContestRepository(database).get(contestId)!.document
}

describe('P11-085 Deferred Mechanics Closure performance budgets', () => {
  it('projects a dense 256-target ranged Encounter inside the lower-end interaction and payload budgets', () => {
    const fixture = denseRangedFixture()
    const run = () => {
      const started = performance.now()
      const projection = buildEncounterPresentationProjection({
        role: 'player', playerProfile: fixture.profile, map: fixture.map, mapRevision: 42,
        pokemonSheets: fixture.pokemonSheets, trainerSheets: [fixture.trainer], generatedAt: 100,
      })
      return { elapsed: performance.now() - started, projection }
    }
    for (let index = 0; index < encounterBudgets.measurement.warmupRuns; index += 1) run()
    const measured = Array.from({ length: encounterBudgets.measurement.measuredRuns }, run)
    const projection = measured.at(-1)!.projection
    const ranged = projection.offers.find(row => row.source.canonicalId === 'Struggle' && row.source.displayName.includes('Hunting Bow'))

    expect(ranged).toMatchObject({
      availability: { status: 'available' },
      targeting: [{ rangeLabel: expect.stringMatching(/12.*Minimum Range 4/u), requiresLineOfSight: true }],
    })
    expect(p95(measured.map(row => row.elapsed))).toBeLessThanOrEqual(scaleBudgets.profiles.lowerEndLaptop.interactionTargetMs)
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(encounterBudgets.runtime.maximumProjectionBytes)
    expect(projection.offers.length).toBeLessThanOrEqual(scaleBudgets.profiles.mobile.maximumRenderedActionOffers)
  }, 15_000)

  it('recomputes five-entry Trainer Participant role projections inside the accepted-presentation budget', () => {
    const document = maximumTrainerParticipantContest()
    const original = JSON.stringify(document)
    const run = () => {
      const started = performance.now()
      const gm = projectContestGm(document)
      const publicProjection = projectContestPublic(document)
      return { elapsed: performance.now() - started, gm, publicProjection }
    }
    for (let index = 0; index < encounterBudgets.measurement.warmupRuns; index += 1) run()
    const measured = Array.from({ length: encounterBudgets.measurement.measuredRuns }, run)
    const result = measured.at(-1)!

    expect(result.gm.contestants).toHaveLength(5)
    expect(result.gm.contestants.every(row => row.performers.length === 2)).toBe(true)
    expect(result.publicProjection.scoreboard).toHaveLength(5)
    expect(result.publicProjection.scoreboard.every(row => row.performers.length === 2)).toBe(true)
    expect(p95(measured.map(row => row.elapsed))).toBeLessThanOrEqual(encounterBudgets.runtime.acceptedPresentationP95Ms)
    for (const projection of [result.gm, result.publicProjection]) {
      expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(encounterBudgets.runtime.maximumProjectionBytes)
    }
    expect(JSON.stringify(document)).toBe(original)
  })

  it('recomputes maximum-roster Battle Contest role projections inside the accepted-presentation budget', () => {
    const document = maximumBattleContest()
    const original = JSON.stringify(document)
    const run = () => {
      const started = performance.now()
      const gm = projectContestGm(document)
      const owner = projectContestOwner(document, 'profile_performance_north')
      const publicProjection = projectContestPublic(document)
      return { elapsed: performance.now() - started, gm, owner, publicProjection }
    }
    for (let index = 0; index < encounterBudgets.measurement.warmupRuns; index += 1) run()
    const measured = Array.from({ length: encounterBudgets.measurement.measuredRuns }, run)
    const result = measured.at(-1)!

    expect(result.gm.contestants).toHaveLength(2)
    expect(result.gm.contestants.every(row => row.performers.length === 6)).toBe(true)
    expect(result.owner.ownContestant.performers).toHaveLength(6)
    expect(result.publicProjection.scoreboard).toHaveLength(2)
    expect(p95(measured.map(row => row.elapsed))).toBeLessThanOrEqual(encounterBudgets.runtime.acceptedPresentationP95Ms)
    for (const projection of [result.gm, result.owner, result.publicProjection]) {
      expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(encounterBudgets.runtime.maximumProjectionBytes)
    }
    expect(JSON.stringify(document)).toBe(original)
  })
})
