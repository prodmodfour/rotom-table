import { describe, expect, it } from 'vitest'
import { createEmptyAbilityTransformationState } from '#shared/abilityAutomation/transformations'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvent } from '#shared/moveAutomation/events'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { reduceAbilityTransformationCommand } from '../../server/domain/abilityAutomation/transformations'
import {
  planEncounterLifecycle,
  planInitiativeLifecycle,
} from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { clearAa084PowerOfAlchemyForKnockouts } from '../../server/domain/abilityAutomation/mechanics/aa084LifecycleIntegration'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})

const sheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: slug === 'target' ? [ability('Power of Alchemy')] : [],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})

const alchemyCopyState = () => reduceAbilityTransformationCommand(
  createEmptyAbilityTransformationState(),
  {
    operationId: 'op_aa084_alchemy_copy',
    kind: 'create',
    snapshotId: 'ability.power-of-alchemy.copy.test',
    expectedVersion: null,
    snapshot: {
      snapshotId: 'ability.power-of-alchemy.copy.test',
      kind: 'copy',
      placementId: 'target',
      ownerPlacementId: 'target',
      sourceAbilityInstanceId: 'base:power-of-alchemy',
      canonicalId: 'Power of Alchemy',
      sourceOperationId: 'op_aa084_alchemy_copy',
      duration: { kind: 'scene' },
      mechanics: {
        formId: null,
        abilityPolicy: 'add',
        abilities: [{
          instanceId: 'copied:ability.power-of-alchemy.copy.test:0',
          canonicalId: 'Prism Armor',
          definitionHash: null,
          sourcePlacementId: 'other',
          parameterStatus: 'not-parameterized',
          parameterData: null,
        }],
        moves: [],
        typeIds: [],
        footprint: null,
        weightClass: null,
        capabilityTags: [],
      },
      copyBase: {
        sourcePlacementId: 'other',
        sourceRevision: 3,
        sourceReadSha256: 'a'.repeat(64),
      },
      presentation: {
        public: {
          presentationId: 'ability.power-of-alchemy.copy.test',
          labelKey: 'ability.power-of-alchemy.copied',
          formId: null,
          assetId: null,
        },
        private: null,
      },
    },
  },
).state

const perishEffect = (): EncounterEffect => parseEncounterEffect({
  ...capabilityEncounterEffectFixture(),
  id: 'effect.aa084.perish.target',
  source: {
    operationId: 'op_aa084_perish',
    moveId: 'ability.perish-body',
    placementId: 'other',
  },
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 1,
  duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa083', 'aa083-perish-count'],
  payload: { capabilityId: 'aa083.perish-count', action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['aa083-perish-count'] },
  suppression: { sources: [] },
})

const powerConstructMarker = (): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'form',
    action: 'replace',
    value: 'zygarde-complete-forme',
    referencePlacementId: null,
  }),
  id: 'ability.power-construct.form.test',
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  duration: { kind: 'scene', remaining: null },
  tags: ['ability', 'aa084', 'power-construct', 'complete-forme'],
})

const mapFixture = (effects: readonly EncounterEffect[] = []): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2,
    slug: 'aa084-lifecycle',
    name: 'AA084 lifecycle',
    revision: 5,
    dimensions: { x: 8, y: 3, z: 8 },
    groundLevelY: 0,
    voxels: [],
    hazards: [],
    placements: [
      { id: 'other', sheetKind: 'pokemon', sheetSlug: 'other', sideId: 'foes', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
    ],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: [...effects],
      abilityTransformations: alchemyCopyState(),
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: 'scene:aa084-lifecycle',
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'other' },
      },
    },
    initiative: { activeId: 'other', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
}

const sheetMap = new Map<string, CharacterSheet>([
  ['other', sheet('other')],
  ['target', sheet('target')],
])
const load = () => ({
  pokemonSheets: sheetMap,
  trainerSheets: new Map<string, TrainerSheet>(),
})

describe('AA-084 lifecycle integrations', () => {
  it('removes a Power of Alchemy copy when lifecycle damage Faints its owner without mutating the input map', () => {
    const map = mapFixture([perishEffect()])
    const before = structuredClone(map)
    const plan = planInitiativeLifecycle({
      map,
      previous: { activeId: 'other', round: 1 },
      current: { activeId: 'target', round: 1 },
      orderIds: ['other', 'target'],
      operationId: 'op_aa084_lifecycle_ko',
      time: 2_000,
      loadSheets: load,
    })
    const nextTarget = plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(nextTarget.combat?.currentHp).toBe(0)
    expect(plan.currentEncounterState.abilityTransformations?.entries).toHaveLength(0)
    expect(map).toEqual(before)
    expect(map.encounterState?.abilityTransformations?.entries).toHaveLength(1)
  })

  it('removes a Trace copy at its exact owner faint boundary', () => {
    const map = mapFixture()
    const previous = map.encounterState!.abilityTransformations!
    const trace = reduceAbilityTransformationCommand(previous, {
      operationId: 'op_aa096_trace_copy',
      kind: 'create',
      snapshotId: 'ability.trace.copy.test',
      expectedVersion: null,
      snapshot: {
        snapshotId: 'ability.trace.copy.test', kind: 'copy',
        placementId: 'target', ownerPlacementId: 'target',
        sourceAbilityInstanceId: 'base:trace', canonicalId: 'Trace',
        sourceOperationId: 'op_aa096_trace_copy', duration: { kind: 'scene' },
        mechanics: {
          formId: null, abilityPolicy: 'add', abilities: [{
            instanceId: 'copied:ability.trace.copy.test:0', canonicalId: 'Prism Armor',
            definitionHash: null, sourcePlacementId: 'other',
            parameterStatus: 'not-parameterized', parameterData: null,
          }],
          moves: [], typeIds: [], footprint: null, weightClass: null, capabilityTags: [],
        },
        copyBase: {
          sourcePlacementId: 'other', sourceRevision: 3, sourceReadSha256: 'b'.repeat(64),
        },
        presentation: {
          public: {
            presentationId: 'ability.trace.copy.test', labelKey: 'ability.trace.copied',
            formId: null, assetId: null,
          },
          private: null,
        },
      },
    }).state
    map.encounterState = { ...map.encounterState!, abilityTransformations: trace }
    const next = clearAa084PowerOfAlchemyForKnockouts({ map, placementIds: ['target'] })
    expect(next.encounterState?.abilityTransformations?.entries).toHaveLength(0)
    expect(map.encounterState?.abilityTransformations?.entries).toHaveLength(2)
  })

  it('expires scene-owned form effects and immutable Ability-copy snapshots at authoritative scene end', () => {
    const marker = powerConstructMarker()
    const map = mapFixture([marker])
    const sceneEnd = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.aa084.scene-end',
      kind: 'scene-end',
      sourceOperationId: 'op_aa084_scene_end',
      causalParentEventId: null,
      reasonCode: 'scene-ended',
      sceneId: 'scene:aa084-lifecycle',
    })
    const plan = planEncounterLifecycle({
      map,
      events: [sceneEnd],
      time: 3_000,
      loadSheets: load,
    })
    expect(plan.currentEncounterState.effects.some(effect => effect.id === marker.id)).toBe(false)
    expect(plan.currentEncounterState.abilityTransformations?.entries).toHaveLength(0)
  })
})
