import { describe, expect, it } from 'vitest'
import {
  parseEncounterEffect,
  type EncounterCapabilityEffect,
  type EncounterCreatureRuleOverlayEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import {
  projectEncounterCreatureRules,
} from '#shared/moveAutomation/creatureRuleOverlays'
import type {
  EncounterCreatureRuleOverlayEffectPayload,
} from '#shared/moveAutomation/creatureRuleOverlayPayloads'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const overlay = (
  id: string,
  payload: EncounterCreatureRuleOverlayEffectPayload,
  overrides: Partial<EncounterCreatureRuleOverlayEffect> = {},
): EncounterCreatureRuleOverlayEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture(payload),
  id,
  ...overrides,
})

const capability = (
  id: string,
  capabilityId: string,
  action: 'grant' | 'suppress',
  value?: number,
): EncounterCapabilityEffect => ({
  ...capabilityEncounterEffectFixture(),
  id,
  affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
  payload: {
    capabilityId,
    action,
    ...(value === undefined ? {} : { value }),
  },
})

const base = () => ({
  typeIds: ['Fire', 'Flying'],
  abilityNames: ['Blaze', 'Levitate'],
  formId: 'base-form',
  size: 'Medium',
  capabilityIds: ['movement.sky', 'capability.tracker'],
  grounding: 'grounded' as const,
})

const target = {
  placementId: 'target-token',
  sideId: 'blue',
  position: { x: 2, y: 0, z: 2 },
  base: 1,
  clearance: 1,
}

describe('central creature-rule overlay projection', () => {
  it('provides strict primitives for the representative creature-overlay move families', () => {
    const representatives: readonly [string, EncounterEffect][] = [
      ['Soak', overlay('effect.soak', {
        domain: 'type', action: 'replace', values: ['water'], referencePlacementId: null, suppressionScope: null,
      })],
      ['Magic Powder', overlay('effect.magic-powder', {
        domain: 'type', action: 'replace', values: ['psychic'], referencePlacementId: null, suppressionScope: null,
      })],
      ['Reflect Type', overlay('effect.reflect-type', {
        domain: 'type', action: 'copy', values: ['normal'], referencePlacementId: 'provider-token', suppressionScope: null,
      })],
      ['Type swap primitive', overlay('effect.type-swap', {
        domain: 'type', action: 'swap', values: ['fire'], referencePlacementId: 'provider-token', suppressionScope: null,
      })],
      ['Burn Up', overlay('effect.burn-up', {
        domain: 'type', action: 'suppress', values: ['fire'], referencePlacementId: null, suppressionScope: 'listed',
      })],
      ['Simple Beam', overlay('effect.simple-beam', {
        domain: 'ability', action: 'replace', values: ['Simple'], referencePlacementId: null, suppressionScope: null,
      })],
      ['Worry Seed', overlay('effect.worry-seed', {
        domain: 'ability', action: 'replace', values: ['Insomnia'], referencePlacementId: null, suppressionScope: null,
      })],
      ['Role Play', overlay('effect.role-play', {
        domain: 'ability', action: 'copy', values: ['Intimidate'], referencePlacementId: 'provider-token', suppressionScope: null,
      })],
      ['Skill Swap', overlay('effect.skill-swap', {
        domain: 'ability', action: 'swap', values: ['Levitate'], referencePlacementId: 'provider-token', suppressionScope: null,
      })],
      ['Entrainment', overlay('effect.entrainment', {
        domain: 'ability', action: 'copy', values: ['Plus'], referencePlacementId: 'provider-token', suppressionScope: null,
      })],
      ['Gastro Acid', overlay('effect.gastro-acid', {
        domain: 'ability', action: 'suppress', values: [], referencePlacementId: null, suppressionScope: 'all',
      })],
      ['Aura Wheel form', overlay('effect.aura-wheel-form', {
        domain: 'form', action: 'replace', value: 'hangry-form', referencePlacementId: null,
      })],
      ['Magnet Rise', capability('effect.magnet-rise', 'movement.levitate', 'grant', 4)],
      ['Smack Down', capability('effect.smack-down', 'movement.grounding.grounded', 'grant')],
      ['Thousand Arrows', capability('effect.thousand-arrows', 'movement.grounding.grounded', 'grant')],
      ['Minimize', overlay('effect.minimize', {
        domain: 'size', action: 'replace', value: 'small', referencePlacementId: null,
      })],
      ['Throat Chop', overlay('effect.throat-chop', { domain: 'sonic-lock', action: 'lock' })],
    ]

    for (const [moveName, effect] of representatives) {
      expect(parseEncounterEffect(effect), moveName).toEqual(effect)
    }
  })

  it('applies mutation order, dominant suppressions, scalar winners, capabilities, grounding evidence, and Sonic locks', () => {
    const effects: EncounterEffect[] = [
      overlay('effect.type.add-grass', {
        domain: 'type', action: 'add', values: ['grass'], referencePlacementId: null, suppressionScope: null,
      }),
      overlay('effect.type.copy-water', {
        domain: 'type', action: 'copy', values: ['water'], referencePlacementId: 'provider-token', suppressionScope: null,
      }),
      overlay('effect.type.add-fairy', {
        domain: 'type', action: 'add', values: ['fairy'], referencePlacementId: null, suppressionScope: null,
      }),
      overlay('effect.type.suppress-water', {
        domain: 'type', action: 'suppress', values: ['water'], referencePlacementId: null, suppressionScope: 'listed',
      }),
      overlay('effect.ability.add-soundproof', {
        domain: 'ability', action: 'add', values: ['Soundproof'], referencePlacementId: null, suppressionScope: null,
      }),
      overlay('effect.ability.swap-intimidate', {
        domain: 'ability', action: 'swap', values: ['Intimidate'], referencePlacementId: 'provider-token', suppressionScope: null,
      }),
      overlay('effect.ability.add-levitate', {
        domain: 'ability', action: 'add', values: ['Levitate'], referencePlacementId: null, suppressionScope: null,
      }),
      overlay('effect.ability.suppress-intimidate', {
        domain: 'ability', action: 'suppress', values: ['Intimidate'], referencePlacementId: null, suppressionScope: 'listed',
      }),
      overlay('effect.form.replace', {
        domain: 'form', action: 'replace', value: 'amped-form', referencePlacementId: null,
      }),
      overlay('effect.form.copy', {
        domain: 'form', action: 'copy', value: 'hangry-form', referencePlacementId: 'provider-token',
      }),
      overlay('effect.size.large', {
        domain: 'size', action: 'replace', value: 'large', referencePlacementId: null,
      }),
      overlay('effect.size.small', {
        domain: 'size', action: 'copy', value: 'small', referencePlacementId: 'provider-token',
      }),
      capability('effect.capability.suppress-sky', 'movement.sky', 'suppress'),
      capability('effect.capability.grant-levitate', 'movement.levitate', 'grant'),
      capability('effect.grounding', 'movement.grounding.grounded', 'grant'),
      overlay('effect.sonic-lock', { domain: 'sonic-lock', action: 'lock' }),
    ]

    const profile = projectEncounterCreatureRules({ base: base(), effects, target })

    expect(profile).toMatchObject({
      placementId: 'target-token',
      typeIds: ['fairy'],
      abilityNames: ['Levitate'],
      formId: 'hangry-form',
      size: 'small',
      capabilityIds: ['capability.tracker', 'movement.levitate', 'movement.grounding.grounded'],
      grounding: 'grounded',
      sonicLocked: true,
      sonicLockSourceEffectIds: ['effect.sonic-lock'],
    })
    expect(profile.sources.find(source => source.effectId === 'effect.type.copy-water')).toEqual({
      effectId: 'effect.type.copy-water',
      operationId: 'op_effect_creature_rule_01',
      moveId: 'move.soak',
      sourcePlacementId: 'actor-token',
      domain: 'type',
      action: 'copy',
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
    })
    expect(profile.sources.find(source => source.effectId === 'effect.grounding')?.domain)
      .toBe('grounding')
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.sources)).toBe(true)
  })

  it('keeps all-ability suppression authoritative over additions and restores the immutable base when effects disappear', () => {
    const add = overlay('effect.ability.add', {
      domain: 'ability', action: 'add', values: ['Soundproof'], referencePlacementId: null, suppressionScope: null,
    })
    const suppressAll = overlay('effect.ability.suppress-all', {
      domain: 'ability', action: 'suppress', values: [], referencePlacementId: null, suppressionScope: 'all',
    })
    const inputBase = base()
    const original = structuredClone(inputBase)

    const active = projectEncounterCreatureRules({
      base: inputBase,
      effects: [suppressAll, add],
      target,
    })
    const restored = projectEncounterCreatureRules({ base: inputBase, effects: [], target })

    expect(active.abilityNames).toEqual([])
    expect(restored.abilityNames).toEqual(['Blaze', 'Levitate'])
    expect(restored.typeIds).toEqual(['fire', 'flying'])
    expect(inputBase).toEqual(original)
  })

  it('honors direct, side, and footprint-cell scope while ignoring inactive and unrelated effects', () => {
    const side = overlay('effect.side.type', {
      domain: 'type', action: 'replace', values: ['water'], referencePlacementId: null, suppressionScope: null,
    }, {
      affected: { placementIds: [], sideIds: ['blue'], cells: [] },
    })
    const cell = overlay('effect.cell.ability', {
      domain: 'ability', action: 'replace', values: ['Torrent'], referencePlacementId: null, suppressionScope: null,
    }, {
      affected: { placementIds: [], sideIds: [], cells: [{ x: 2, y: 0, z: 2 }] },
    })
    const depleted = {
      ...overlay('effect.depleted.form', {
        domain: 'form', action: 'replace', value: 'depleted-form', referencePlacementId: null,
      }),
      charges: 0,
      chargePolicy: { kind: 'consume-on-trigger' as const, amount: 1 },
    }
    const unrelated = overlay('effect.other.size', {
      domain: 'size', action: 'replace', value: 'gigantic', referencePlacementId: null,
    }, {
      affected: { placementIds: ['other-token'], sideIds: [], cells: [] },
    })

    const profile = projectEncounterCreatureRules({
      base: base(),
      effects: [side, cell, depleted, unrelated],
      target,
    })

    expect(profile.typeIds).toEqual(['water'])
    expect(profile.abilityNames).toEqual(['Torrent'])
    expect(profile.formId).toBe('base-form')
    expect(profile.size).toBe('medium')
    expect(profile.sourceEffectIds).toEqual(['effect.side.type', 'effect.cell.ability'])
  })
})
