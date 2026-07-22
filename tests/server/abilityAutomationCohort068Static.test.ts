import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import {
  AA068_DUST_CLOUD_BURST_BRANCH_ID,
  aa068DamageTypeOverlay,
  aa068DustCloudPresentationScript,
  aa068EarlyBirdInitiativeActive,
  aa068EarlyBirdSleepSaveBonus,
} from '../../server/domain/abilityAutomation/mechanics/aa068StaticIntegration'
import { pokemonInitiativeOrderEntry } from '~/utils/initiativeOrderEntries'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'

const abilitySlug = (canonicalId: string): string => canonicalId
  .normalize('NFKD').replace(/[’']/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${abilitySlug(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  move?: string
  types?: readonly string[]
  hp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 40, stage: 0 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 150, injuries: 0, conditions: [] },
})
const mapFixture = (input: {
  slug: string
  actorAbility?: string
  targetAbility?: string
  actorMove?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  targetHp?: number
  weather?: 'sunny' | 'rainy'
  effects?: NonNullable<TabletopMap['encounterState']>['effects']
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], placements,
    fieldEffects: {
      weather: input.weather ? [{ kind: input.weather }] : [], terrains: [], rooms: [],
    },
    encounterState: {
      ...encounter, effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', ability: input.actorAbility, move: input.actorMove,
      types: input.actorTypes,
    })],
    ['target', sheet({
      slug: 'target', ability: input.targetAbility, types: input.targetTypes,
      hp: input.targetHp,
    })],
  ])
  return { map, sheets }
}
const suppression = (placementId: string, canonicalId: string) => parseEncounterEffect({
  id: `suppress.${abilitySlug(canonicalId)}`,
  kind: 'creature-rule-overlay',
  source: { operationId: 'op_suppress', moveId: 'ability.suppression', placementId },
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
  createdRound: 1, createdTurn: 1, duration: { kind: 'scene', remaining: null },
  stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null }, tags: ['test', 'suppression'],
  payload: {
    domain: 'ability', action: 'suppress', values: [canonicalId],
    referencePlacementId: null, suppressionScope: 'listed',
  },
  dispel: { policy: 'matching-tags', tags: ['suppression'] },
  transferPolicy: 'retain', suppression: { sources: [] },
})
const context = (fixture: ReturnType<typeof mapFixture>, moveName: string) => buildAuthoritativeMoveRulesContext({
  map: fixture.map, pokemonSheets: fixture.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  candidatePlacementIds: ['target'], selectedPlacementIds: ['target'],
  random: () => 0.5, time: 1_000, resolutionId: `resolution:${fixture.map.slug}`,
})

describe('AA-068 static abilities', () => {
  it('aa068.dry-skin.reviewed cancels Water damage/effects, heals on Water hits, and applies both Weather boundaries', () => {
    const water = mapFixture({
      slug: 'aa068-dry-water', actorMove: 'Scald', targetAbility: 'Dry Skin', targetHp: 100,
    })
    const waterPlan = planAuthoritativeMoveState({
      map: water.map, pokemonSheets: water.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Scald',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.99, now: () => 1_000, operationId: 'op_aa068_dry_water',
    })
    const healed = waterPlan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(healed.combat?.currentHp).toBeGreaterThan(100)
    expect(healed.combat?.conditions ?? []).not.toContain('Burned')
    expect(JSON.stringify(waterPlan.resolution.auditTrace)).toContain('Dry Skin')

    const fire = mapFixture({
      slug: 'aa068-dry-fire', actorMove: 'Ember', targetAbility: 'Dry Skin', targetHp: 150,
    })
    const firePlan = planAuthoritativeMoveState({
      map: fire.map, pokemonSheets: fire.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa068_dry_fire',
    })
    expect(JSON.stringify(firePlan.resolution.auditTrace)).toContain('ability.dry-skin.fire-hit-tick')

    const suppressed = mapFixture({
      slug: 'aa068-dry-suppressed', actorMove: 'Water Gun', targetAbility: 'Dry Skin',
      targetHp: 100, effects: [suppression('target', 'Dry Skin')],
    })
    const suppressedPlan = planAuthoritativeMoveState({
      map: suppressed.map, pokemonSheets: suppressed.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa068_dry_suppressed',
    })
    const damaged = suppressedPlan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(Number(damaged.combat?.currentHp)).toBeLessThan(100)
    expect(JSON.stringify(suppressedPlan.resolution.auditTrace)).not.toContain('Dry Skin')

    for (const [weather, reason, direction] of [
      ['sunny', 'ability.dry-skin.sunny-turn-end', 'down'],
      ['rainy', 'ability.dry-skin.rainy-turn-end', 'up'],
    ] as const) {
      const fixture = mapFixture({
        slug: `aa068-dry-${weather}`, actorAbility: 'Dry Skin', weather,
        targetHp: 100,
      })
      fixture.sheets.set('actor', sheet({ slug: 'actor', ability: 'Dry Skin', hp: 100 }))
      const lifecycle = planInitiativeLifecycle({
        map: fixture.map,
        previous: { activeId: 'actor', round: 1 }, current: { activeId: 'target', round: 1 },
        orderIds: ['actor', 'target'], operationId: `op_aa068_dry_${weather}`, time: 2_000,
        loadSheets: () => ({ pokemonSheets: fixture.sheets, trainerSheets: new Map() }),
      })
      const next = lifecycle.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
      expect(lifecycle.reduction.operations).toContainEqual(expect.objectContaining({ reasonCode: reason }))
      expect(direction === 'up' ? Number(next.combat?.currentHp) > 100 : Number(next.combat?.currentHp) < 100).toBe(true)
    }
  })

  it('aa068.dust-cloud.reviewed grants Poison Powder and the optional Burst 1 branch only while effective', () => {
    const active = mapFixture({ slug: 'aa068-dust', actorAbility: 'Dust Cloud' })
    const rules = buildAuthoritativeMoveRulesContext({
      map: active.map, pokemonSheets: active.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Poison Powder',
        targetBranchId: AA068_DUST_CLOUD_BURST_BRANCH_ID,
        selection: { kind: 'self' },
      },
      random: () => 0.5, time: 1_000,
    })
    const entry = rules.queries.resolveActorMoveEntry('Poison Powder')
    expect(entry.ok).toBe(true)
    if (entry.ok) {
      expect(entry.entry.script).toMatchObject({
        targetMode: 'multi-target', range: 'Burst 1',
        areaTemplates: [{ kind: 'burst', size: 1 }],
      })
      expect(aa068DustCloudPresentationScript({ script: entry.entry.script, active: true }).targetBranches)
        .toContainEqual(expect.objectContaining({ id: AA068_DUST_CLOUD_BURST_BRANCH_ID }))
    }
    const burstPlan = planAuthoritativeMoveState({
      map: active.map, pokemonSheets: active.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Poison Powder',
        targetBranchId: AA068_DUST_CLOUD_BURST_BRANCH_ID,
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 1 }),
        },
      },
      random: () => 0.99, now: () => 1_000, operationId: 'op_aa068_dust_burst',
    })
    const poisoned = burstPlan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(poisoned.combat?.conditions).toContain('Poisoned')

    const blocked = mapFixture({
      slug: 'aa068-dust-blocked', actorAbility: 'Dust Cloud',
      effects: [suppression('actor', 'Dust Cloud')],
    })
    expect(context(blocked, 'Poison Powder').queries.resolveActorMoveEntry('Poison Powder'))
      .toMatchObject({ ok: false, reason: 'move-absent' })
  })

  it('aa068.early-bird.reviewed adds half staged Speed to Initiative and +3 only to Sleep saves', () => {
    const fixture = mapFixture({ slug: 'aa068-early-bird', actorAbility: 'Early Bird' })
    const placement = fixture.map.placements[0]!
    const actor = fixture.sheets.get('actor')!
    expect(aa068EarlyBirdInitiativeActive({ map: fixture.map, placement, sheet: actor })).toBe(true)
    expect(aa068EarlyBirdSleepSaveBonus({
      map: fixture.map, placement, sheet: actor, condition: 'Sleep',
    })).toBe(3)
    expect(aa068EarlyBirdSleepSaveBonus({
      map: fixture.map, placement, sheet: actor, condition: 'Paralysis',
    })).toBe(0)
    const base = pokemonInitiativeOrderEntry(placement, actor)
    const boosted = pokemonInitiativeOrderEntry(placement, actor, { earlyBirdSpeedBonus: true })
    expect(boosted.initiativeScore - base.initiativeScore).toBe(Math.floor(base.initiativeScore / 2))

    fixture.map.encounterState = {
      ...fixture.map.encounterState!, effects: [suppression('actor', 'Early Bird')],
    }
    expect(aa068EarlyBirdInitiativeActive({ map: fixture.map, placement, sheet: actor })).toBe(false)
  })

  it('aa068.eggscellence.reviewed grants both Connections/STAB and the Normal-user 16+ effectiveness step', () => {
    const fixture = mapFixture({
      slug: 'aa068-eggscellence', actorAbility: 'Eggscellence', actorMove: 'Egg Bomb',
      actorTypes: ['Normal'], targetTypes: ['Rock'],
    })
    const rules = context(fixture, 'Egg Bomb')
    expect(rules.queries.resolveActorMoveEntry('Barrage')).toMatchObject({ ok: true })
    const baseType = {
      operationId: 'egg-bomb.damage', recipientId: 'target', moveType: 'Normal' as const,
      moveTypeSource: 'static' as const, defenderTypes: ['Rock' as const], defenderTypeEvaluations: [],
      policy: {
        immunity: 'honor' as const, resistance: 'honor' as const, weakness: 'honor' as const,
        effectivenessOverride: null, defenderTypeOverrides: [],
      },
      baseMultiplier: 0.5, passiveMultiplier: 0.5, passiveSources: [],
      finalMultiplier: 0.5, finalRelation: 'resistant' as const, immunitySource: null,
      hasStab: false, evaluationTrace: [],
    }
    expect(aa068DamageTypeOverlay({
      context: rules, script: { moveName: 'Egg Bomb' }, recipientId: 'target',
      resolved: baseType, naturalAccuracyRoll: 16, dragonsMawSelected: false,
    })).toMatchObject({
      hasStab: true, finalMultiplier: 1, finalRelation: 'neutral',
      passiveSources: ['Eggscellence'],
    })
    expect(aa068DamageTypeOverlay({
      context: rules, script: { moveName: 'Egg Bomb' }, recipientId: 'target',
      resolved: baseType, naturalAccuracyRoll: 15, dragonsMawSelected: false,
    }).finalMultiplier).toBe(0.5)
  })
})
