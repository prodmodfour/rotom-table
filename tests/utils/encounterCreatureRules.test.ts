import { describe, expect, it } from 'vitest'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { encounterCreatureRuleProfileForToken } from '~/utils/encounterCreatureRules'
import { placementToSpawned } from '~/utils/placement'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
  transformationEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const placement: SheetPlacement = {
  id: 'actor-token',
  sheetKind: 'pokemon',
  sheetSlug: 'morph',
  sideId: 'heroes',
  position: { x: 1, y: 0, z: 1 },
}

const sheet = (): CharacterSheet => ({
  revision: 5,
  slug: 'morph',
  nickname: 'Morph',
  species: 'Ditto',
  level: 20,
  abilities: [{ name: 'Limber' }],
  movelist: [{ name: 'Transform' }],
})

const targeted = <Effect extends EncounterEffect>(effect: Effect): Effect => ({
  ...effect,
  affected: { placementIds: ['actor-token'], sideIds: [], cells: [] },
})

const effects = (): EncounterEffect[] => [
  transformationEncounterEffectFixture(),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'type',
      action: 'replace',
      values: ['water'],
      referencePlacementId: null,
      suppressionScope: null,
    }),
    id: 'effect.rules.type-water',
  }),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'type',
      action: 'add',
      values: ['grass'],
      referencePlacementId: null,
      suppressionScope: null,
    }),
    id: 'effect.rules.type-grass',
  }),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability',
      action: 'replace',
      values: ['Soundproof'],
      referencePlacementId: null,
      suppressionScope: null,
    }),
    id: 'effect.rules.ability-soundproof',
  }),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'form',
      action: 'copy',
      value: 'hangry-form',
      referencePlacementId: 'target-token',
    }),
    id: 'effect.rules.form-hangry',
  }),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'size',
      action: 'replace',
      value: 'small',
      referencePlacementId: null,
    }),
    id: 'effect.rules.size-small',
  }),
  targeted({
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'sonic-lock',
      action: 'lock',
    }),
    id: 'effect.rules.sonic-lock',
  }),
  targeted({
    ...capabilityEncounterEffectFixture(),
    id: 'effect.rules.levitate',
    payload: { capabilityId: 'movement.levitate', action: 'grant', value: 4 },
  }),
  targeted({
    ...capabilityEncounterEffectFixture(),
    id: 'effect.rules.grounded',
    payload: { capabilityId: 'movement.grounding.grounded', action: 'grant' },
  }),
]

const map = (encounterEffects: readonly EncounterEffect[]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'creature-rule-arena',
  name: 'Creature Rule Arena',
  revision: 2,
  dimensions: { x: 8, y: 3, z: 8 },
  voxels: [],
  placements: [placement],
  encounterState: {
    ...createEmptyEncounterState(),
    sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
    effects: encounterEffects,
  },
})

describe('encounter creature-rule token projection', () => {
  it('layers reversible creature rules over Transform and feeds existing type, ability, and movement fields', () => {
    const sourceSheet = sheet()
    const original = structuredClone(sourceSheet)
    const token = placementToSpawned(placement, {
      pokemon: new Map([['morph', sourceSheet]]),
      trainer: new Map(),
    }, map(effects()))!

    expect(token.defenderTypes).toEqual(['water', 'grass'])
    expect(token.abilityNames).toEqual(['Soundproof'])
    expect(token.movementCapabilities).toMatchObject({ overland: 5, swim: 1, levitate: 4 })
    expect(token.movementProfile?.state.grounding).toBe('grounded')
    expect(token.size).toBe('Large')
    expect(token.ruleCapabilities?.size).toBe('Small')
    expect(token.creatureRules).toMatchObject({
      formId: 'hangry-form',
      size: 'small',
      grounding: 'grounded',
      sonicLocked: true,
      capabilityIds: expect.arrayContaining([
        'movement.overland',
        'movement.swim',
        'movement.levitate',
        'movement.grounding.grounded',
      ]),
      sourceEffectIds: [
        'effect.transformation.actor-token',
        'effect.rules.type-water',
        'effect.rules.type-grass',
        'effect.rules.ability-soundproof',
        'effect.rules.form-hangry',
        'effect.rules.size-small',
        'effect.rules.sonic-lock',
        'effect.rules.levitate',
        'effect.rules.grounded',
      ],
    })
    expect(sourceSheet).toEqual(original)
  })

  it('restores the sheet-backed creature view when durable overlays are absent', () => {
    const sourceSheet = sheet()
    const lookups = {
      pokemon: new Map([['morph', sourceSheet]]),
      trainer: new Map(),
    }
    const active = placementToSpawned(placement, lookups, map(effects()))!
    const restored = placementToSpawned(placement, lookups, map([]))!

    expect(active.creatureRules?.sonicLocked).toBe(true)
    expect(restored.creatureRules).toMatchObject({
      formId: 'ditto',
      capabilityIds: expect.arrayContaining(['Jump', 'capability.jump']),
      sources: [],
    })
    expect(restored.defenderTypes.map(type => type.toLowerCase())).toEqual(['normal'])
    expect(restored.abilityNames).toEqual(['Limber'])
    expect(restored.ruleCapabilities?.size).toBe('Small')
  })

  it('always materializes Trainer rules and preserves raw zero Jump and Teleporter identities', () => {
    const trainerPlacement: SheetPlacement = {
      id: 'trainer-token',
      sheetKind: 'trainer',
      sheetSlug: 'jumper',
      position: { x: 0, y: 0, z: 0 },
    }
    const trainer: TrainerSheet = {
      slug: 'jumper',
      name: 'Jumper',
      level: 1,
      capabilities: {
        highJump: 0,
        longJump: 0,
        other: ['Teleporter 4'],
      },
    }
    const spawned = placementToSpawned(trainerPlacement, {
      pokemon: new Map(),
      trainer: new Map([[trainer.slug, trainer]]),
    })!

    expect(spawned.movementTraits?.jump).toEqual({ long: 0, high: 0 })
    expect(spawned.movementCapabilities?.teleporter).toBe(4)
    expect(spawned.creatureRules?.capabilityIds).toEqual(expect.arrayContaining([
      'Jump',
      'capability.jump',
      'movement.jump',
      'Teleporter',
      'capability.teleporter',
      'movement.teleport',
    ]))

    const { creatureRules: _creatureRules, ...rawToken } = spawned
    expect(encounterCreatureRuleProfileForToken(rawToken).capabilityIds).toEqual(expect.arrayContaining([
      'Jump',
      'capability.jump',
      'movement.jump',
      'Teleporter',
      'capability.teleporter',
      'movement.teleport',
    ]))
  })
})
