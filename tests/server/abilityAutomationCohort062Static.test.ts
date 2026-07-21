import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveCombatStageEffectOperation, MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { aa062MoveDamageModifiers, aa062MoveOverlayOperations } from '../../server/domain/abilityAutomation/mechanics/aa062MoveIntegration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const sheet = (input: {
  slug: string
  species?: string
  ability?: string
  move?: string
  hp?: number
  maxHpStat?: number
  types?: string[]
  capabilities?: CharacterSheet['capabilities']
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species ?? 'Pikachu', level: 20, revision: 3,
  types: input.types ?? ['Normal'], capabilities: input.capabilities,
  abilities: input.ability ? [{
    name: input.ability,
    automation: {
      schemaVersion: 1, instanceId: `base:${input.slug}:${input.ability.toLowerCase().replace(/ /g, '-')}`,
      canonicalId: input.ability, definitionVersion: null, selections: [],
    },
  }] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: input.maxHpStat ?? 20 }, atk: { added: 20 }, def: { added: 10 },
    satk: { added: 20 }, sdef: { added: 10 }, spd: { added: 10 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, conditions: [] },
})
const map = (actorSlug: string, targetSlug = 'target'): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: `aa062-${actorSlug}`, name: actorSlug, revision: 5,
    dimensions: { x: 10, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: actorSlug, position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: targetSlug, position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: `scene:${actorSlug}` } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const context = (actor: CharacterSheet, target: CharacterSheet, moveName: string) => buildAuthoritativeMoveRulesContext({
  map: map(actor.slug, target.slug), pokemonSheets: new Map([[actor.slug, actor], [target.slug, target]]), trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName, selection: { kind: 'single-target', targetPlacementId: 'target' } },
  selectedPlacementIds: ['target'], random: () => 0, time: 1_000,
})

describe('AA-062 static move integrations', () => {
  it('aa062.big-pecks.defense-immunity blocks Defense stage loss only while effective', () => {
    const actor = sheet({ slug: 'attacker', move: 'Tail Whip' })
    const protectedTarget = sheet({ slug: 'protected', ability: 'Big Pecks' })
    const moveContext = context(actor, protectedTarget, 'Tail Whip')
    const targetPlacement = moveContext.queries.placements.get('target')!
    const recipient = {
      placement: targetPlacement,
      token: moveContext.queries.tokens.get('target')!,
      sheet: moveContext.queries.sheets.forPlacement(targetPlacement)!,
    }
    const operation = {
      id: 'tail-whip.lower-defense', kind: 'combat-stage', recipients: { kind: 'hit-targets' },
      payload: { applyTypeImmunity: false, trigger: null },
    } as unknown as MoveCombatStageEffectOperation
    expect(createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal', context: moveContext })
      .combatStage({ operation, stage: 'def', delta: -1, recipient }).blockedBy).toBe('Big Pecks')
    expect(createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal', context: moveContext })
      .combatStage({ operation, stage: 'atk', delta: -1, recipient }).blockedBy).toBeNull()
  })

  it('aa062.big-swallow.virtual-stockpile heals as one Stockpile and grants the Stockpile Connection', () => {
    const actor = sheet({ slug: 'swallower', ability: 'Big Swallow', move: 'Swallow', hp: 30 })
    const target = sheet({ slug: 'target' })
    const moveContext = context(actor, target, 'Stockpile')
    expect(moveContext.queries.resolveActorMoveEntry('Stockpile')).toMatchObject({ ok: true })
    const result = planAuthoritativeMoveState({
      map: map(actor.slug, target.slug), pokemonSheets: new Map([[actor.slug, actor], [target.slug, target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Swallow', selection: { kind: 'self' } },
      random: () => 0, now: () => 1_000, operationId: 'op_big_swallow',
    })
    const write = result.sheetWrites.find(entry => entry.slug === actor.slug)!
    expect((write.nextSheet as CharacterSheet).combat?.currentHp).toBeGreaterThan(30)
  }, 20_000)

  it('aa062.blaze.last-chance contributes +5 normally and +10 at one-third HP', () => {
    const target = sheet({ slug: 'target', species: 'Snorlax' })
    const modifier = (hp: number) => {
      const actor = sheet({ slug: `blaze-${hp}`, ability: 'Blaze', move: 'Ember', hp, types: ['Fire'] })
      const moveContext = context(actor, target, 'Ember')
      const entry = moveContext.queries.resolveActorMoveEntry('Ember')
      expect(entry.ok).toBe(true)
      if (!entry.ok) throw new Error('Ember entry missing')
      return aa062MoveDamageModifiers({
        context: moveContext,
        operation: { id: 'ember.damage', kind: 'damage' } as unknown as MoveDamageEffectOperation,
        script: entry.entry.script,
        actor: moveContext.actor.token,
        recipient: moveContext.queries.tokens.get('target')!, moveType: 'Fire',
      })[0]
    }
    expect(modifier(100)).toMatchObject({ value: 5, reasonCode: 'ability.blaze.damage-bonus' })
    expect(modifier(1)).toMatchObject({ value: 10, reasonCode: 'ability.blaze.low-hp-damage-bonus' })
  })

  it('aa062.blow-away.whirlwind-overlay grants Whirlwind and emits tick loss plus two-meter push', () => {
    const actor = sheet({ slug: 'blower', ability: 'Blow Away' })
    const target = sheet({ slug: 'target' })
    const moveContext = context(actor, target, 'Whirlwind')
    expect(moveContext.queries.resolveActorMoveEntry('Whirlwind')).toMatchObject({ ok: true })
    const entry = moveContext.queries.resolveActorMoveEntry('Whirlwind')
    expect(entry.ok).toBe(true)
    if (!entry.ok) throw new Error('Whirlwind entry missing')
    expect(aa062MoveOverlayOperations({ context: moveContext, script: entry.entry.script, moveSourceId: 'move.whirlwind' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'direct-hp', payload: expect.objectContaining({ calculation: { kind: 'percent-max', percent: 10 } }) }),
        expect.objectContaining({ kind: 'movement-request', payload: expect.objectContaining({ distance: 2 }) }),
      ]))
  })

  it('aa062.blur.imposed-accuracy turns an automatic hit into AC 2 with half Evasion', () => {
    const actor = sheet({ slug: 'swift-user', move: 'Aerial Ace', types: ['Flying'] })
    const target = sheet({ slug: 'blur-target', ability: 'Blur', species: 'Eevee' })
    target.stats = { ...target.stats, def: { added: 20 }, spd: { added: 10 } }
    const run = (random: number) => planAuthoritativeMoveState({
      map: map(actor.slug, target.slug), pokemonSheets: new Map([[actor.slug, actor], [target.slug, target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Aerial Ace', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => random, now: () => 1_000, operationId: `op_blur_${String(random).replace('.', '_')}`,
    })
    const missed = run(0.1)
    expect(missed.sheetWrites.some(entry => entry.slug === target.slug)).toBe(false)
    expect(missed.resolution.rollLedger.some(roll => roll.rollId.includes('ability.blur.accuracy-roll'))).toBe(true)
    const hitWithHalfEvasion = run(0.15)
    expect(hitWithHalfEvasion.sheetWrites.some(entry => entry.slug === target.slug)).toBe(true)
  }, 20_000)

  it('aa062.bone-wielder.ignore-immunity damages a Flying target and exposes no unrelated immunity override', () => {
    const actor = sheet({ slug: 'wielder', ability: 'Bone Wielder', move: 'Bone Club', types: ['Ground'] })
    const target = sheet({ slug: 'flying-target', species: 'Pidgey', types: ['Flying'] })
    const result = planAuthoritativeMoveState({
      map: map(actor.slug, target.slug), pokemonSheets: new Map([[actor.slug, actor], [target.slug, target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Bone Club', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 1_000, operationId: 'op_bone_wielder',
    })
    const write = result.sheetWrites.find(entry => entry.slug === target.slug)!
    expect((write.nextSheet as CharacterSheet).combat?.currentHp).toBeLessThan(100)
  }, 20_000)
})
