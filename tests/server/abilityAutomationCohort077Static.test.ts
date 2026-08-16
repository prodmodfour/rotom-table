import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { activeEquipmentState } from '../fixtures/equipment'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseMoveEffectOperation, type MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { placementToSpawned } from '~/utils/placement'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA077_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa077'
import {
  aa077AdjustedToken,
  aa077MoveDamageModifiers,
  applyAa077DisengageResourceEvidence,
} from '../../server/domain/abilityAutomation/mechanics/aa077StaticIntegration'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveMoveCriticalHit } from '../../server/domain/moveAutomation/criticalHits'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { resolveMoveCoreTokenRecipient } from '../../server/domain/moveAutomation/reducers/coreTokenRecipients'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { resolveMovement } from '../../server/domain/movement/resolveMovement'
import { planAuthoritativeMovementResources } from '../../server/domain/movement/planMovementResources'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slug(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  abilities?: readonly string[]
  currentHp?: number
  held?: string
  levitate?: number
  species?: string
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species ?? 'Eevee',
  level: 25,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  equipmentState: input.held
    ? activeEquipmentState({ ownerKind: 'pokemon', ownerSlug: input.slug, slotId: 'held', canonicalItemId: input.held })
    : createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: input.slug }),
  ...(input.held ? { items: { held: input.held } } : {}),
  ...(input.levitate === undefined ? {} : { capabilities: { levitate: input.levitate } }),
  stats: {
    hp: { added: 90 }, atk: { added: 40 }, def: { added: 30 },
    satk: { added: 40 }, sdef: { added: 30 }, spd: { added: 30 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 250, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa077.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})
const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHp?: number
  targetHp?: number
  actorHeld?: string
  targetHeld?: string
  actorLevitate?: number
  targetLevitate?: number
  targetConditions?: readonly string[]
  actorSpecies?: string
  effects?: readonly EncounterEffect[]
  actorMovementSpent?: number
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const actorLedger = createEncounterTurnResourceLedger({ placementId: 'actor', round: 1, turn: 1 })
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: {
        actor: {
          ...actorLedger,
          actions: {
            ...actorLedger.actions,
            shift: {
              ...actorLedger.actions.shift,
              spent: (input.actorMovementSpent ?? 0) > 0 ? 1 : 0,
            },
          },
          movement: { ...actorLedger.movement, budget: 10, spent: input.actorMovementSpent ?? 0 },
        },
        target: createEncounterTurnResourceLedger({ placementId: 'target', round: 1, turn: 1 }),
      },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const move = input.move ?? 'Tackle'
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move, abilities: input.actorAbilities, currentHp: input.actorHp,
      held: input.actorHeld, levitate: input.actorLevitate, species: input.actorSpecies,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities, currentHp: input.targetHp,
      held: input.targetHeld, levitate: input.targetLevitate, conditions: input.targetConditions,
    })],
  ])
  return { map, sheets, move }
}
const context = (state: ReturnType<typeof fixture>) => buildAuthoritativeMoveRulesContext({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  selectedPlacementIds: ['target'], candidatePlacementIds: ['target'],
  random: () => 0.75, time: 1_000, resolutionId: `resolution:${state.map.slug}`,
})
const resolve = (state: ReturnType<typeof fixture>) => planAuthoritativeMoveState({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75, now: () => 1_000,
  operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
})
const targetHp = (state: ReturnType<typeof fixture>): number => {
  const plan = resolve(state)
  const target = (plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')) as CharacterSheet
  return target.combat?.currentHp ?? 0
}
const damageOperation = (): MoveDamageEffectOperation => {
  const operation = parseMoveEffectOperation({
    id: 'aa077.test.damage', kind: 'damage', source: { kind: 'move', id: 'move.tackle' },
    recipients: { kind: 'selected-targets' }, phase: 'damage', reasonCode: 'aa077.test.damage',
    payload: {
      damageBase: 6, damageClass: 'physical', moveType: 'normal',
      accuracyRollId: null, criticalRollId: null,
    },
  })
  if (operation.kind !== 'damage') throw new Error('Expected damage operation.')
  return operation
}

describe('AA-077 static integrations', () => {
  it('selects all twelve exact reviewed runtimes', () => {
    expect(AA077_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Klutz', 'Lancer', 'Landslide', 'Last Chance', 'Leaf Gift', 'Leaf Guard',
      'Leaf Rush', 'Leafy Cloak', 'Leek Mastery', 'Levitate', 'Life Force', 'Light Metal',
    ])
    for (const spec of AA077_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa077.ts',
      })
    }
  })

  it('aa077.levitate.reviewed preserves native speed, applies 4-or-+2 only while effective, and grants Ground immunity', () => {
    const native = fixture({
      slug: 'aa077-levitate-native', move: 'Mud-Slap',
      targetAbilities: ['Levitate'], targetLevitate: 5,
    })
    const placement = native.map.placements[1]!
    const unprojected = placementToSpawned(placement, { pokemon: native.sheets, trainer: new Map() }, native.map, {
      skipAa077NativeProjection: true,
    })!
    expect(unprojected.movementCapabilities?.levitate).toBe(5)
    expect(placementToSpawned(placement, {
      pokemon: native.sheets, trainer: new Map(),
    }, native.map)?.movementCapabilities?.levitate).toBe(7)
    expect(context(native).queries.tokens.get('target')?.movementCapabilities?.levitate).toBe(7)
    expect(targetHp(native)).toBe(native.sheets.get('target')!.combat?.currentHp)
    const multiHit = fixture({
      slug: 'aa077-levitate-multi-hit', move: 'Bonemerang', targetAbilities: ['Levitate'],
    })
    expect(targetHp(multiHit)).toBe(multiHit.sheets.get('target')!.combat?.currentHp)

    const directHpOperation = parseMoveEffectOperation({
      id: 'aa077.levitate.direct-hp', kind: 'direct-hp',
      source: { kind: 'move', id: 'move.ground-direct-hp' },
      recipients: { kind: 'selected-targets' }, phase: 'damage',
      reasonCode: 'aa077.levitate.direct-hp',
      payload: {
        mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: 10 },
        copySource: null, bounds: { minimum: null, maximum: null }, rounding: 'floor',
        applyTypeImmunity: true, cost: null,
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    })
    if (directHpOperation.kind !== 'direct-hp') throw new Error('Expected direct HP operation.')
    const nativeContext = context(native)
    const nativeImmunities = createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: 'Ground', context: nativeContext,
    })
    const nativeRecipient = resolveMoveCoreTokenRecipient(nativeContext, 'target')
    expect(nativeImmunities.directHp({
      operation: directHpOperation,
      recipient: nativeRecipient,
    }).blockedBy).toBe('Levitate')
    const unrelatedCondition = parseMoveEffectOperation({
      id: 'aa077.levitate.unrelated-condition', kind: 'condition',
      source: { kind: 'move', id: 'move.ground-unrelated-condition' },
      recipients: { kind: 'selected-targets' }, phase: 'hit',
      reasonCode: 'aa077.levitate.unrelated-condition',
      payload: {
        action: 'apply', conditionId: 'slowed', conditionSource: null,
        filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null }, applyTypeImmunity: true,
      },
    })
    if (unrelatedCondition.kind !== 'condition') throw new Error('Expected condition operation.')
    expect(nativeImmunities.condition({
      operation: unrelatedCondition, condition: 'Slowed', recipient: nativeRecipient,
    }).blockedBy).toBeNull()

    const granted = fixture({ slug: 'aa077-levitate-four', targetAbilities: ['Levitate'] })
    expect(context(granted).queries.tokens.get('target')?.movementCapabilities?.levitate).toBe(4)
    const movementState = fixture({ slug: 'aa077-levitate-movement', actorAbilities: ['Levitate'] })
    const movement = resolveMovement({
      map: movementState.map,
      sheets: { pokemon: movementState.sheets, trainer: new Map() },
      placementId: 'actor', mode: 'shift', destination: { x: 1, y: 1, z: 1 },
    })
    expect(movement).toMatchObject({
      ok: true,
      movementProfile: { speeds: { levitate: 4 } },
      capabilities: { used: [expect.objectContaining({ key: 'levitate', speed: 4 })] },
    })
    const dynamicLevitate = creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability', action: 'add', values: ['Levitate'],
      referencePlacementId: null, suppressionScope: null,
    })
    const dynamicallyGranted = fixture({
      slug: 'aa077-levitate-dynamic', move: 'Mud-Slap',
      effects: [{
        ...dynamicLevitate, id: 'effect.aa077.dynamic-levitate',
        affected: { placementIds: ['target'], sideIds: [], cells: [] },
      }],
    })
    expect(context(dynamicallyGranted).queries.tokens.get('target')?.movementCapabilities?.levitate).toBe(4)
    expect(targetHp(dynamicallyGranted)).toBe(dynamicallyGranted.sheets.get('target')!.combat?.currentHp)

    const suppressed = fixture({
      slug: 'aa077-levitate-suppressed', move: 'Mud-Slap',
      targetAbilities: ['Levitate'], targetLevitate: 5,
      effects: [suppression('target')],
    })
    expect(placementToSpawned(suppressed.map.placements[1]!, {
      pokemon: suppressed.sheets, trainer: new Map(),
    }, suppressed.map)?.movementCapabilities?.levitate).toBe(5)
    expect(context(suppressed).queries.tokens.get('target')?.movementCapabilities?.levitate).toBe(5)
    expect(targetHp(suppressed)).toBeLessThan(
      suppressed.sheets.get('target')!.combat?.currentHp ?? 0,
    )
    const suppressedContext = context(suppressed)
    expect(createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: 'Ground', context: suppressedContext,
    }).directHp({
      operation: directHpOperation,
      recipient: resolveMoveCoreTokenRecipient(suppressedContext, 'target'),
    }).blockedBy).toBeNull()

    const grounded = fixture({
      slug: 'aa077-levitate-grounded', move: 'Mud-Slap',
      targetAbilities: ['Levitate'], targetConditions: ['Smack Down Grounded'],
    })
    expect(targetHp(grounded)).toBeLessThan(grounded.sheets.get('target')!.combat?.currentHp ?? 0)
  }, 30_000)

  it('aa077.landslide-and-last-chance.reviewed add exactly +5 only at one-third HP', () => {
    const groundPlain = fixture({ slug: 'aa077-landslide-plain', move: 'Mud-Slap', actorHp: 70 })
    const groundBoost = fixture({
      slug: 'aa077-landslide-boost', move: 'Mud-Slap', actorHp: 70,
      actorAbilities: ['Landslide'],
    })
    const groundHigh = fixture({
      slug: 'aa077-landslide-high', move: 'Mud-Slap', actorHp: 250,
      actorAbilities: ['Landslide'],
    })
    expect(targetHp(groundBoost)).toBe(targetHp(groundPlain) - 5)
    const groundSuppressed = fixture({
      slug: 'aa077-landslide-suppressed', move: 'Mud-Slap', actorHp: 70,
      actorAbilities: ['Landslide'], effects: [suppression('actor')],
    })
    expect(targetHp(groundSuppressed)).toBe(targetHp(groundPlain))
    const groundPlainHigh = fixture({
      slug: 'aa077-landslide-plain-high', move: 'Mud-Slap', actorHp: 250,
    })
    expect(targetHp(groundHigh)).toBe(targetHp(groundPlainHigh))

    const normalPlain = fixture({ slug: 'aa077-last-chance-plain', actorHp: 70 })
    const normalBoost = fixture({
      slug: 'aa077-last-chance-boost', actorHp: 70, actorAbilities: ['Last Chance'],
    })
    expect(targetHp(normalBoost)).toBe(targetHp(normalPlain) - 5)
    expect(JSON.stringify(resolve(normalBoost).resolution.auditTrace)).toContain('ability.last-chance.normal')
  }, 30_000)

  it('aa077.lancer.reviewed derives critical range and +5 DR from durable Shift/Disengage evidence', () => {
    const movementState = fixture({ slug: 'aa077-lancer-movement', actorAbilities: ['Lancer'] })
    const movement = resolveMovement({
      map: movementState.map,
      sheets: { pokemon: movementState.sheets, trainer: new Map() },
      placementId: 'actor', mode: 'shift', destination: { x: 4, y: 0, z: 1 },
    })
    if (!movement.ok) throw new Error(`Expected Lancer Shift: ${movement.message}`)
    const movedMap = planAuthoritativeMovementResources({
      map: movementState.map, movement, sourceOperationId: 'op_aa077_lancer_shift',
    }).nextMap
    expect(movedMap.encounterState?.turnResources.actor).toMatchObject({
      movement: { spent: 4 }, actions: { shift: { spent: 1 } },
    })
    const movedContext = context({ ...movementState, map: movedMap })
    expect(resolveMoveCriticalHit({
      context: movedContext, operation: damageOperation(),
      script: movedContext.queries.rules.reviewedScriptFor('Tackle')!,
      recipientId: 'target', naturalRoll: 17,
    }).critical).toBe(true)

    const shifted = fixture({
      slug: 'aa077-lancer-shifted', actorAbilities: ['Lancer'], actorMovementSpent: 3,
    })
    const shiftedContext = context(shifted)
    expect(resolveMoveCriticalHit({
      context: shiftedContext, operation: damageOperation(),
      script: shiftedContext.queries.rules.reviewedScriptFor('Tackle')!,
      recipientId: 'target', naturalRoll: 17,
    }).critical).toBe(true)
    const shiftedSuppressed = fixture({
      slug: 'aa077-lancer-shifted-suppressed', actorAbilities: ['Lancer'],
      actorMovementSpent: 3, effects: [suppression('actor')],
    })
    const shiftedSuppressedContext = context(shiftedSuppressed)
    expect(resolveMoveCriticalHit({
      context: shiftedSuppressedContext, operation: damageOperation(),
      script: shiftedSuppressedContext.queries.rules.reviewedScriptFor('Tackle')!,
      recipientId: 'target', naturalRoll: 17,
    }).critical).toBe(false)

    const plain = fixture({ slug: 'aa077-lancer-plain' })
    const idle = fixture({ slug: 'aa077-lancer-idle', targetAbilities: ['Lancer'] })
    expect(targetHp(idle)).toBe(targetHp(plain) + 5)
    const suppressedIdle = fixture({
      slug: 'aa077-lancer-idle-suppressed', targetAbilities: ['Lancer'],
      effects: [suppression('target')],
    })
    expect(targetHp(suppressedIdle)).toBe(targetHp(plain))
    expect(JSON.stringify(resolve(idle).resolution.auditTrace))
      .toContain('ability.lancer.no-shift-damage-reduction')
    const idleContext = context(idle)
    expect(aa077MoveDamageModifiers({
      context: idleContext, operation: damageOperation(), actor: idleContext.actor.token,
      recipient: idleContext.queries.tokens.get('target')!, moveType: 'Normal',
    })).toContainEqual(expect.objectContaining({
      reasonCode: 'ability.lancer.no-shift-damage-reduction', value: 5,
      stage: 'post-damage-modifiers', operation: 'subtract',
    }))

    const targetTurnMap = {
      ...idle.map,
      encounterState: {
        ...idle.map.encounterState!,
        history: {
          ...idle.map.encounterState!.history,
          currentTurn: { round: 1, turn: 1, placementId: 'target' },
        },
      },
    }
    const disengaged = applyAa077DisengageResourceEvidence({
      map: targetTurnMap, placementId: 'target', operationId: 'op_aa077_disengage',
    })
    const disengagedContext = context({ ...idle, map: disengaged })
    expect(aa077MoveDamageModifiers({
      context: disengagedContext, operation: damageOperation(), actor: disengagedContext.actor.token,
      recipient: disengagedContext.queries.tokens.get('target')!, moveType: 'Normal',
    }).some(modifier => modifier.reasonCode === 'ability.lancer.no-shift-damage-reduction')).toBe(false)
  })

  it('aa077.klutz-leek-mastery-light-metal.reviewed use exact effective ability and canonical item authority', () => {
    const klutz = fixture({ slug: 'aa077-klutz-static', actorAbilities: ['Klutz'], actorHeld: 'Quick Claw' })
    expect(context(klutz).queries.itemEffects.resolve({
      placementId: 'actor', scope: 'pokemon-held', timing: 'static',
    })).toMatchObject({ suppressed: true, reasonCode: 'item-effect.ability-suppressed' })
    const suppressedKlutz = fixture({
      slug: 'aa077-klutz-suppressed', actorAbilities: ['Klutz'], actorHeld: 'Quick Claw',
      effects: [suppression('actor')],
    })
    expect(context(suppressedKlutz).queries.itemEffects.resolve({
      placementId: 'actor', scope: 'pokemon-held', timing: 'static',
    }).suppressed).toBe(false)

    const leek = fixture({
      slug: 'aa077-leek-mastery', move: 'Acrobatics',
      actorAbilities: ['Leek Mastery'], actorHeld: 'Rare Leek', actorSpecies: 'Eevee',
    })
    // Connection authority supplies Acrobatics even when the authored list omits it.
    leek.sheets.set('actor', { ...leek.sheets.get('actor')!, movelist: [{ name: 'Tackle' }] })
    const plainAcrobatics = fixture({
      slug: 'aa077-leek-plain-acrobatics', move: 'Acrobatics', actorHeld: 'Rare Leek',
      actorSpecies: 'Eevee',
    })
    expect(targetHp(leek)).toBeLessThan(targetHp(plainAcrobatics))
    const suppressedLeek = fixture({
      slug: 'aa077-leek-mastery-suppressed', move: 'Acrobatics',
      actorAbilities: ['Leek Mastery'], actorHeld: 'Rare Leek', actorSpecies: 'Eevee',
      effects: [suppression('actor')],
    })
    suppressedLeek.sheets.set('actor', {
      ...suppressedLeek.sheets.get('actor')!, movelist: [{ name: 'Tackle' }],
    })
    expect(() => targetHp(suppressedLeek)).toThrow(/Acrobatics|move/i)
    const leekContext = context(leek)
    expect(resolveMoveCriticalHit({
      context: leekContext, operation: damageOperation(),
      script: leekContext.queries.rules.reviewedScriptFor('Acrobatics')!,
      recipientId: 'target', naturalRoll: 18,
    }).critical).toBe(true)
    const klutzyLeek = fixture({
      slug: 'aa077-klutzy-leek', actorAbilities: ['Klutz', 'Leek Mastery'],
      actorHeld: 'Rare Leek', actorSpecies: 'Eevee',
    })
    const klutzyLeekContext = context(klutzyLeek)
    expect(resolveMoveCriticalHit({
      context: klutzyLeekContext, operation: damageOperation(),
      script: klutzyLeekContext.queries.rules.reviewedScriptFor('Tackle')!,
      recipientId: 'target', naturalRoll: 18,
    }).critical).toBe(false)

    const base = leekContext.actor.token
    const light = aa077AdjustedToken({ token: base, effectiveAbilityIds: ['Light Metal'] })
    expect(light.weightClass).toBe(Math.max(1, (base.weightClass ?? 1) - 2))
    expect(light.spd).toBe((base.spd ?? 0) + 2)
    expect(light.def).toBe(base.def - 2)
    expect(aa077AdjustedToken({ token: base, effectiveAbilityIds: [] })).toBe(base)
    const lightState = fixture({ slug: 'aa077-light-metal', actorAbilities: ['Light Metal'] })
    const plainState = fixture({ slug: 'aa077-light-metal-plain' })
    const lightToken = context(lightState).actor.token
    const plainToken = context(plainState).actor.token
    expect(lightToken.spd).toBe((plainToken.spd ?? 0) + 2)
    expect(lightToken.def).toBe(plainToken.def - 2)
    expect(lightToken.weightClass).toBe(Math.max(1, (plainToken.weightClass ?? 1) - 2))
    const suppressedLight = fixture({
      slug: 'aa077-light-metal-suppressed', actorAbilities: ['Light Metal'],
      effects: [suppression('actor')],
    })
    expect(context(suppressedLight).actor.token).toMatchObject({
      def: plainToken.def, spd: plainToken.spd, weightClass: plainToken.weightClass,
    })
  })
})
