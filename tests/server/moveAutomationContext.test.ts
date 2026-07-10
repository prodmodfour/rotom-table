import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  AuthoritativeMoveRulesContextError,
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveFromContext } from '~~/server/domain/resolveAuthoritativeMove'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/move-automation/registry'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
  ...(sideId ? { sideId } : {}),
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'context-arena',
  name: 'Context Arena',
  revision: 7,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0, 'red'),
    placement('target-token', 'target', 1, 'blue'),
    placement('ally-token', 'ally', 2, 'red'),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 2 },
  encounterState: redBlueEncounterStateFixture(),
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 80 },
  ...overrides,
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const buildContext = (overrides: {
  readonly map?: TabletopMap
  readonly pokemonSheets?: ReadonlyMap<string, CharacterSheet>
  readonly random?: () => number
} = {}) => buildAuthoritativeMoveRulesContext({
  map: overrides.map ?? mapFixture(),
  pokemonSheets: overrides.pokemonSheets ?? new Map([
    ['actor', pokemonSheet('actor')],
    ['target', pokemonSheet('target', { revision: 5 })],
    ['ally', pokemonSheet('ally')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: ['target-token', 'ally-token'],
  selectedPlacementIds: ['target-token'],
  random: overrides.random ?? randomSequence([0.5, 0, 0.25]),
  time: 1_234,
})

describe('immutable authoritative move rules context', () => {
  it('detaches and freezes map, actor, placement, sheet, ruleset, and query snapshots', () => {
    const map = mapFixture()
    const actor = pokemonSheet('actor')
    const pokemonSheets = new Map([
      ['actor', actor],
      ['target', pokemonSheet('target', { revision: 5 })],
      ['ally', pokemonSheet('ally')],
    ])
    const context = buildContext({ map, pokemonSheets })

    map.name = 'Mutated source map'
    map.placements[0]!.position.x = 7
    actor.nickname = 'Mutated source actor'
    pokemonSheets.delete('target')

    expect(context.map.name).toBe('Context Arena')
    expect(context.actor.placement.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(context.actor.token.species).toBe('actor')
    expect((context.actor.sheet.sheet as CharacterSheet).nickname).toBe('actor')
    expect(context.candidatePlacements.map(({ id }) => id)).toEqual(['target-token', 'ally-token'])
    expect(context.selectedPlacements.map(({ id }) => id)).toEqual(['target-token'])
    expect(context.resolvedSheets.find(sheet => sheet.slug === 'target')).toMatchObject({
      kind: 'pokemon',
      slug: 'target',
      revision: 5,
    })
    expect(context.ruleset).toMatchObject({
      rulesetId: 'rotom-table-reference-moves-v1',
      canonicalization: { version: 1 },
    })

    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.map)).toBe(true)
    expect(Object.isFrozen(context.map.placements)).toBe(true)
    expect(Object.isFrozen(context.actor.token)).toBe(true)
    expect(Object.isFrozen(context.actor.sheet.sheet)).toBe(true)
    expect(Object.isFrozen(context.candidatePlacements)).toBe(true)
    expect(Object.isFrozen(context.ruleset)).toBe(true)
    expect(Object.isFrozen(context.queries)).toBe(true)
    expect(() => {
      ;(context.map.placements as SheetPlacement[]).push(placement('forged', 'actor', 4))
    }).toThrow()
  })

  it('serves snapshot-only placement, token, sheet, relationship, history, resource, runtime, and status queries', () => {
    const context = buildContext()
    const actor = context.queries.placements.get('actor-token')!
    const target = context.queries.placements.get('target-token')!
    const allyPlacement = context.queries.placements.get('ally-token')!

    expect(context.queries.placements.all()).toHaveLength(3)
    expect(context.queries.placements.candidates()).toEqual(context.candidatePlacements)
    expect(context.queries.placements.selected()).toEqual(context.selectedPlacements)
    expect(context.queries.tokens.get('target-token')).toMatchObject({ id: 'target-token', sheetSlug: 'target' })
    expect(context.queries.sheets.forPlacement(target)).toMatchObject({
      kind: 'pokemon',
      slug: 'target',
      revision: 5,
    })
    expect(context.queries.relationships.resolve(actor.id, actor.id)).toMatchObject({
      relationship: 'self',
      reasonCode: 'relationship-self',
    })
    expect(context.queries.relationships.match(actor.id, allyPlacement.id, 'same-side')).toMatchObject({
      relationship: 'ally',
      reasonCode: 'relationship-ally',
      matches: true,
    })
    expect(context.queries.relationships.match(actor.id, allyPlacement.id, 'ally').matches).toBe(true)
    expect(context.queries.relationships.match(actor.id, target.id, 'enemy')).toMatchObject({
      relationship: 'enemy',
      reasonCode: 'relationship-enemy',
      matches: true,
    })
    expect(context.queries.history.query(actor.id, 'last-completed-move-id')).toBeNull()
    expect(context.queries.history.query(actor.id, 'damage-dealt-this-turn')).toBe(0)
    expect(Object.isFrozen(context.queries.history)).toBe(true)
    expect(context.queries.resources.ledger(actor.id)).toBeNull()
    expect(context.queries.resources.actionAvailable(actor.id, 'standard')).toBe(false)
    expect(context.queries.resources.reactionAvailable(actor.id)).toBe(false)
    expect(Object.isFrozen(context.queries.resources)).toBe(true)
    expect(context.queries.rules.runtimeFor('Tackle')).toMatchObject({
      canonicalId: 'Tackle',
      kind: 'legacy-v1',
    })
    expect(context.queries.rules.runtimeFor('tackle')).toBeNull()
    expect(context.queries.rules.legacyScriptFor('tackle')).toMatchObject({ moveName: 'Tackle' })
    expect(context.queries.rules.semanticStatusFor('Tackle')).toMatchObject({
      canonicalId: 'Tackle',
      baseStatus: 'assisted',
    })
  })

  it('derives relationship results from the snapshotted side directory and requires unknown-target opt-in', () => {
    const map = mapFixture()
    delete map.placements[1]!.sideId
    const context = buildContext({ map })

    map.placements[1]!.sideId = 'blue'

    expect(context.queries.relationships.resolve('actor-token', 'target-token')).toEqual({
      sourcePlacementId: 'actor-token',
      targetPlacementId: 'target-token',
      sourceSideId: 'red',
      targetSideId: null,
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
    })
    expect(context.queries.relationships.match('actor-token', 'target-token', 'ally', {
      allowUnknown: true,
    }).matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'enemy', {
      allowUnknown: true,
    }).matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'other').matches).toBe(false)
    expect(context.queries.relationships.match('actor-token', 'target-token', 'other', {
      allowUnknown: true,
    })).toMatchObject({
      relationship: 'unknown',
      reasonCode: 'relationship-unknown-side',
      matches: true,
    })
  })

  it('records a deduplicated, immutable sheet read set only through the context seam', () => {
    const context = buildContext()
    expect(context.reads.snapshot()).toEqual([])

    context.reads.recordPlacement(context.actor.placement)
    context.reads.recordToken({ id: 'target-token' })
    context.reads.recordToken({ id: 'target-token' })

    const reads = context.reads.snapshot()
    expect(reads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
    expect(Object.isFrozen(reads)).toBe(true)
    expect(Object.isFrozen(reads[0])).toBe(true)
  })

  it('uses only injected time and randomness after construction and preserves its detached source snapshot', () => {
    const map = mapFixture()
    const actor = pokemonSheet('actor')
    const sheets = new Map([
      ['actor', actor],
      ['target', pokemonSheet('target', { revision: 5 })],
      ['ally', pokemonSheet('ally')],
    ])
    const context = buildContext({
      map,
      pokemonSheets: sheets,
      random: randomSequence([0.5, 0, 0.25]),
    })

    map.placements[1]!.position.x = 7
    actor.movelist = []

    const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
    const originalScript = scripts.get('Tackle')!
    scripts.set('Tackle', { ...originalScript, targetMode: 'self' })
    const originalRandom = Math.random
    const originalNow = Date.now
    Math.random = () => { throw new Error('ambient random must not run') }
    Date.now = () => { throw new Error('ambient clock must not run') }
    try {
      const resolution = resolveAuthoritativeMoveFromContext(context)
      expect(resolution.transaction.attackedTargetIds).toEqual(['target-token'])
      expect(resolution.transaction.hitTargetIds).toEqual(['target-token'])
      expect(resolution.feedback?.id).toMatch(/^move-resolution-1234-[0-9a-f]{8}-1$/)
      expect(resolution.rollLedger.map((roll) => roll.rollId)).toEqual([
        'legacy-v1.accuracy.1',
        'legacy-v1.damage.1',
      ])
      expect(resolution.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'pokemon', slug: 'target', revision: 5 },
      ])
    }
    finally {
      scripts.set('Tackle', originalScript)
      Math.random = originalRandom
      Date.now = originalNow
    }
  })

  it('rejects invalid actor and duplicate placement identities before mechanics run', () => {
    expect(() => buildContext({
      map: { ...mapFixture(), placements: [] },
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRulesContextError.name,
      code: 'actor-placement-missing',
    }))

    const map = mapFixture()
    map.placements.push({ ...map.placements[0]! })
    expect(() => buildContext({ map })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRulesContextError.name,
      code: 'duplicate-placement-id',
    }))
  })
})
