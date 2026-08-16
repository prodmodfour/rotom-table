import { describe, expect, it } from 'vitest'
import {
  ITEM_SKILL_CHECK_IDS,
  ITEM_SPEC_SCHEMA_VERSION,
  ItemSpecValidationError,
  parseItemSpec,
  type ItemSpecV1,
} from '#shared/itemAutomation/spec'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '~~/server/domain/itemAutomation/registry'
import { TRAINER_SKILLS } from '~/types/trainerSheet'

const HASH = 'a'.repeat(64)

const fixtureSpec = (): ItemSpecV1 => ({
  schemaVersion: ITEM_SPEC_SCHEMA_VERSION,
  canonicalId: 'Fixture Potion',
  aliases: ['Fixture Restorative'],
  implementationState: 'native',
  contexts: ['encounter', 'sheet'],
  roles: ['usable'],
  timing: 'standard',
  costs: [{ kind: 'action', resourceId: 'standard', amount: 1, label: '1 Standard Action' }],
  prerequisites: [{
    prerequisiteId: 'conscious',
    kind: 'not-condition',
    values: ['Fainted'],
    unavailableReason: 'The target is fainted.',
  }],
  targets: [{
    targetId: 'target',
    kind: 'participant',
    minimum: 1,
    maximum: 1,
    relationship: 'any',
    rangeMeters: null,
    requiresLineOfSight: false,
  }],
  choices: [],
  consumption: {
    phase: 'accepted-use',
    quantity: 1,
    reserveWhilePending: true,
    refundableOnCancel: true,
    reusable: false,
  },
  effects: [{
    effectId: 'heal', operation: 'heal-hp',
    restoration: {
      amount: { kind: 'fixed', amount: 20 }, cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    },
  }],
  duration: { kind: 'instant', amount: null },
  privacy: { sourceInventory: 'actor-owner', choices: 'actor-owner', outcome: 'public' },
  presentation: { label: 'Fixture Potion', description: 'Heals 20 HP.', unavailableReason: null },
  evidence: {
    canonicalCatalogSha256: HASH,
    canonicalRecordSha256: HASH,
    canonicalEffectSha256: HASH,
    reviewId: 'fixture-potion-v1',
    status: 'reviewed',
  },
  registeredHandlerId: 'item.native.v1',
})

const mutation = (change: (value: Record<string, unknown>) => void): unknown => {
  const value = structuredClone(fixtureSpec()) as unknown as Record<string, unknown>
  change(value)
  return value
}

const expectCode = (value: unknown, code: ItemSpecValidationError['code']): void => {
  try {
    parseItemSpec(value)
    throw new Error('Expected item spec validation to fail.')
  }
  catch (error) {
    expect(error).toBeInstanceOf(ItemSpecValidationError)
    expect((error as ItemSpecValidationError).code).toBe(code)
  }
}

describe('ItemSpec v1', () => {
  it('strictly parses, detaches, and freezes mechanics separately from presentation', () => {
    const source = fixtureSpec()
    const parsed = parseItemSpec(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.effects)).toBe(true)
    expect(parsed.effects).toEqual([{
      effectId: 'heal', operation: 'heal-hp',
      restoration: {
        amount: { kind: 'fixed', amount: 20 }, cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
      },
    }])
    expect(parsed.presentation).toEqual({
      label: 'Fixture Potion',
      description: 'Heals 20 HP.',
      unavailableReason: null,
    })
  })

  it('rejects unknown schema versions, fields, duplicate IDs, unbounded choices, and invalid lifecycle policy', () => {
    expectCode(mutation(value => { value.schemaVersion = 2 }), 'unsupported-schema-version')
    expectCode(mutation(value => { value.clientEffect = { hp: 20 } }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [
        { effectId: 'same', operation: 'heal-hp', restoration: { amount: { kind: 'fixed', amount: 20 }, cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve' } },
        { effectId: 'same', operation: 'heal-hp', restoration: { amount: { kind: 'fixed', amount: 5 }, cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve' } },
      ]
    }), 'duplicate-id')
    expectCode(mutation(value => {
      value.choices = [{
        choiceId: 'condition', kind: 'condition', minimum: 1, maximum: 1,
        optionSource: 'spec', options: [], privateTo: 'actor-owner',
      }]
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.consumption = {
        phase: 'never', quantity: 1, reserveWhilePending: false,
        refundableOnCancel: false, reusable: true,
      }
    }), 'invalid-spec')
  })

  it('strictly parses counted campaign-day and boundary durations without inference', () => {
    expect(parseItemSpec(mutation(value => {
      value.duration = { kind: 'daily', amount: 2 }
    })).duration).toEqual({ kind: 'daily', amount: 2 })
    expect(parseItemSpec(mutation(value => {
      value.duration = { kind: 'explicit-dismissal', amount: null }
    })).duration).toEqual({ kind: 'explicit-dismissal', amount: null })
    expect(parseItemSpec(mutation(value => {
      value.duration = { kind: 'encounter', amount: null }
    })).duration).toEqual({ kind: 'encounter', amount: null })

    for (const amount of [null, 0, -1, 1.5, '1']) {
      expectCode(mutation(value => {
        value.duration = { kind: 'daily', amount }
      }), 'invalid-spec')
    }
    expectCode(mutation(value => {
      value.duration = { kind: 'daily', amount: 1, unit: 'wall-day' }
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.duration = { kind: 'explicit-dismissal', amount: 1 }
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.duration = { kind: 'unknown-duration', amount: null }
    }), 'invalid-spec')
  })

  it('requires revival effects to declare Pokémon revival semantics and a Fainted target gate', () => {
    const revival = mutation(value => {
      value.effects = [{
        effectId: 'revive', operation: 'revive', revival: {
          amount: { kind: 'fixed', amount: 20 }, cap: 'injury-adjusted-effective-maximum-hp',
          targetKind: 'pokemon', faintedState: 'require-and-clear',
        },
      }]
      value.prerequisites = [{
        prerequisiteId: 'fainted', kind: 'condition', values: ['Fainted'],
        unavailableReason: 'This item requires a Fainted Pokémon.',
      }]
    })
    expect(parseItemSpec(revival).effects[0]).toMatchObject({ operation: 'revive' })
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'revive', operation: 'revive', revival: {
          amount: { kind: 'fixed', amount: 20 }, cap: 'injury-adjusted-effective-maximum-hp',
          targetKind: 'pokemon', faintedState: 'require-and-clear',
        },
      }]
      value.prerequisites = []
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'revive', operation: 'revive', revival: {
          amount: { kind: 'maximum-relative', basis: 'injury-adjusted-effective-maximum-hp', numerator: 1, denominator: 2, rounding: 'down', minimum: 1 },
          cap: 'injury-adjusted-effective-maximum-hp', targetKind: 'pokemon', faintedState: 'require-and-clear',
        },
      }]
      value.prerequisites = [{ prerequisiteId: 'fainted', kind: 'condition', values: ['Fainted'], unavailableReason: 'Fainted only.' }]
    }), 'invalid-spec')
  })

  it('enforces canonical condition-removal scope and authority-choice coupling', () => {
    const allApplicable = mutation(value => {
      value.effects = [{
        effectId: 'cure', operation: 'remove-conditions', conditionIds: [],
        mode: 'persistent', selection: 'all-applicable',
      }]
      value.prerequisites = []
    })
    expect(parseItemSpec(allApplicable).effects).toEqual([{
      effectId: 'cure', operation: 'remove-conditions', conditionIds: [],
      mode: 'persistent', selection: 'all-applicable',
    }])
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'cure', operation: 'remove-conditions', conditionIds: [],
        mode: 'listed', selection: 'all-applicable',
      }]
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'cure', operation: 'remove-conditions', conditionIds: ['Burned'],
        mode: 'persistent', selection: 'all-applicable',
      }]
    }), 'invalid-spec')
    const chosen = mutation(value => {
      value.effects = [{
        effectId: 'cure', operation: 'remove-conditions', conditionIds: ['Burned', 'Paralysis'],
        mode: 'listed', selection: 'choose-one',
      }]
      value.choices = [{
        choiceId: 'condition:cure', kind: 'condition', minimum: 1, maximum: 1,
        optionSource: 'authority', options: [], privateTo: 'actor-owner',
      }]
    })
    expect(parseItemSpec(chosen).choices[0]).toMatchObject({
      choiceId: 'condition:cure', optionSource: 'authority', minimum: 1, maximum: 1,
    })
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'cure', operation: 'remove-conditions', conditionIds: ['Burned'],
        mode: 'listed', selection: 'choose-one',
      }]
      value.choices = []
    }), 'invalid-spec')
  })

  it('enforces handler, implementation-state, lifecycle, and actionability compatibility', () => {
    expectCode(mutation(value => { value.registeredHandlerId = 'item.guided.v1' }), 'invalid-spec')
    expectCode(mutation(value => { value.effects = [] }), 'invalid-spec')
    expectCode(mutation(value => {
      value.implementationState = 'reference-only'
      value.roles = ['reference-only']
      value.registeredHandlerId = 'item.none.v1'
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.implementationState = 'passive'
      value.roles = ['passive']
      value.contexts = ['passive']
      value.timing = 'passive'
      value.registeredHandlerId = 'item.passive.v1'
      value.effects = []
      value.duration = { kind: 'instant', amount: null }
    }), 'invalid-spec')
  })

  it('strictly validates reviewed X-Item stage and durable temporary-effect semantics', () => {
    for (const canonicalId of ['X Attack', 'X Defend', 'X Special', 'X Sp. Def', 'X Speed', 'X Accuracy']) {
      const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
      expect(definition.spec).toMatchObject({
        contexts: ['encounter', 'sheet'],
        prerequisites: [expect.objectContaining({ kind: 'target-kind', values: ['pokemon'] })],
        duration: { kind: 'instant', amount: null },
        effects: [expect.objectContaining({ operation: 'modify-stage', amount: 2 })],
      })
    }
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dire Hit').spec).toMatchObject({
      contexts: ['encounter'], duration: { kind: 'encounter', amount: null },
      effects: [{ operation: 'temporary-combat-effect', family: 'critical-range', amount: 2, stackPolicy: 'replace', switchPolicy: 'expire' }],
    })
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Guard Spec').spec).toMatchObject({
      contexts: ['encounter'], duration: { kind: 'turns', amount: 5 },
      effects: [{ operation: 'temporary-combat-effect', family: 'move-stage-reduction-immunity', amount: 5, stackPolicy: 'refresh', switchPolicy: 'expire' }],
    })
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'temporary', operation: 'temporary-combat-effect', family: 'critical-range',
        amount: 2, stackPolicy: 'replace', switchPolicy: 'expire',
      }]
      value.duration = { kind: 'instant', amount: null }
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'temporary', operation: 'temporary-combat-effect', family: 'move-stage-reduction-immunity',
        amount: 5, stackPolicy: 'refresh', switchPolicy: 'retain',
      }]
      value.duration = { kind: 'turns', amount: 5 }
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{ effectId: 'stage', operation: 'modify-stage', stat: 'atk', amount: 0 }]
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'temporary', operation: 'temporary-combat-effect', family: 'critical-range',
        amount: 3, stackPolicy: 'replace', switchPolicy: 'expire',
      }]
      value.contexts = ['encounter']
      value.duration = { kind: 'encounter', amount: null }
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'temporary', operation: 'temporary-combat-effect', family: 'move-stage-reduction-immunity',
        amount: 5, stackPolicy: 'replace', switchPolicy: 'expire',
      }]
      value.contexts = ['encounter']
      value.duration = { kind: 'turns', amount: 5 }
    }), 'invalid-spec')
  })

  it('strictly registers refreshments and reviewed deterministic Snacks including Black Sludge', () => {
    for (const [canonicalId, amount] of [
      ['Enriched Water', 20], ['Shuckle’s Berry Juice', 30], ['Super Soda Pop', 30],
      ['Sparkling Lemonade', 50], ['MooMoo Milk', 80],
    ] as const) {
      expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId).spec.effects).toEqual([
        expect.objectContaining({
          operation: 'heal-hp',
          restoration: expect.objectContaining({ amount: { kind: 'fixed', amount } }),
        }),
      ])
    }
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Candy Bar').spec.effects).toEqual([{
      effectId: 'primary', operation: 'store-digestion-buff', buffKind: 'fixed-heal',
      amount: 5, denominator: null, requiredPokemonType: null,
    }])
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Honey').spec.effects).toEqual([{
      effectId: 'exploration', operation: 'use-snack-or-bait', buffKind: 'fixed-heal',
      amount: 5, denominator: null, requiredPokemonType: null,
      lure: { checkIntervalMinutes: 15, successMinimum: 15, maximumAttempts: 3, dieSides: 20 },
      focusDc: 12,
    }])
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Leftovers').spec.effects).toEqual([{
      effectId: 'primary', operation: 'store-digestion-buff', buffKind: 'turn-start-heal',
      amount: 1, denominator: 16, requiredPokemonType: null,
    }])
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Black Sludge').spec).toMatchObject({
      implementationState: 'native',
      prerequisites: [expect.objectContaining({ kind: 'type', values: ['Poison'] })],
      effects: [{
        effectId: 'primary', operation: 'store-digestion-buff', buffKind: 'turn-start-heal',
        amount: 1, denominator: 8, requiredPokemonType: 'Poison',
      }],
      evidence: {
        canonicalRecordSha256: '507c203bcd29d275c94b06e9a6efb0247e36277a92e3f5b66a6f1667a27fd250',
      },
    })
  })

  it('rejects malformed Digestion Buff mechanics instead of inferring them', () => {
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'snack', operation: 'store-digestion-buff', buffKind: 'turn-start-heal',
        amount: 1, denominator: null, requiredPokemonType: null,
      }]
    }), 'invalid-spec')
    expectCode(mutation(value => {
      value.effects = [{
        effectId: 'snack', operation: 'store-digestion-buff', buffKind: 'fixed-heal',
        amount: 5, denominator: null, requiredPokemonType: 'Poison',
      }]
      value.prerequisites = []
    }), 'invalid-spec')
  })

  it('strictly registers permanent advancement effects, completion consumption, ownership, privacy, and exact choices', () => {
    const expectedEffects = new Map<string, Record<string, unknown>>([
      ['HP Up', { operation: 'modify-base-stat', stat: 'hp', amount: 1 }],
      ['Protein', { operation: 'modify-base-stat', stat: 'atk', amount: 1 }],
      ['Iron', { operation: 'modify-base-stat', stat: 'def', amount: 1 }],
      ['Calcium', { operation: 'modify-base-stat', stat: 'satk', amount: 1 }],
      ['Zinc', { operation: 'modify-base-stat', stat: 'sdef', amount: 1 }],
      ['Carbos', { operation: 'modify-base-stat', stat: 'spd', amount: 1 }],
      ['Heart Booster', { operation: 'grant-tutor-points', amount: 2, lifetimeLimit: 1 }],
      ['PP Up', { operation: 'increase-move-frequency', lifetimeLimit: 1 }],
      ['Rare Candy', { operation: 'gain-next-level-experience', lifetimeLimit: 5, maximumLevel: 100 }],
      ['Stat Suppressants', { operation: 'modify-base-stat', stat: 'selected', amount: -1 }],
    ])
    for (const [canonicalId, effect] of expectedEffects) {
      expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId).spec).toMatchObject({
        contexts: ['campaign', 'sheet', 'extended-action'],
        timing: 'extended',
        costs: [],
        prerequisites: expect.arrayContaining([
          expect.objectContaining({ kind: 'actor-kind', values: ['trainer'] }),
          expect.objectContaining({ kind: 'target-kind', values: ['pokemon'] }),
        ]),
        targets: [expect.objectContaining({
          kind: 'participant', minimum: 1, maximum: 1, relationship: 'owned',
        })],
        consumption: {
          phase: 'extended-action-completion', quantity: 1,
          reserveWhilePending: false, refundableOnCancel: false, reusable: false,
        },
        effects: [expect.objectContaining(effect)],
        privacy: { sourceInventory: 'actor-owner', choices: 'actor-owner', outcome: 'actor-owner' },
      })
    }
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('PP Up').spec.choices).toEqual([
      expect.objectContaining({
        choiceId: 'permanent-move', kind: 'move', minimum: 1, maximum: 1,
        optionSource: 'authority', options: [], privateTo: 'actor-owner',
      }),
    ])
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Stat Suppressants').spec.choices).toEqual([
      expect.objectContaining({ choiceId: 'permanent-stat', kind: 'stat', optionSource: 'authority' }),
      expect.objectContaining({
        choiceId: 'trainer-consent', kind: 'mode', optionSource: 'spec',
        options: [{ optionId: 'confirmed', label: 'The Pokémon’s Trainer consents' }],
      }),
    ])

    const ppWithoutChoice = structuredClone(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('PP Up').spec) as any
    ppWithoutChoice.choices = []
    expectCode(ppWithoutChoice, 'invalid-spec')
    const publicOutcome = structuredClone(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Rare Candy').spec) as any
    publicOutcome.privacy.outcome = 'public'
    expectCode(publicOutcome, 'invalid-spec')
    const suppressantWithoutConsent = structuredClone(
      ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Stat Suppressants').spec,
    ) as any
    suppressantWithoutConsent.choices = suppressantWithoutConsent.choices.filter((choice: any) => (
      choice.choiceId !== 'trainer-consent'
    ))
    expectCode(suppressantWithoutConsent, 'invalid-spec')
  })

  it('strictly registers First Aid Kit as a reusable Trainer skill-check tool with one recoverable AP drain', () => {
    expect(new Set(ITEM_SKILL_CHECK_IDS)).toEqual(new Set(TRAINER_SKILLS))
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('First Aid Kit').spec).toMatchObject({
      contexts: ['campaign', 'sheet', 'extended-action'],
      timing: 'extended',
      costs: [{ kind: 'ap', resourceId: 'drain', amount: 1, label: 'Drain 1 AP' }],
      prerequisites: [expect.objectContaining({ kind: 'actor-kind', values: ['trainer'] })],
      consumption: {
        phase: 'never', quantity: 0, reserveWhilePending: false,
        refundableOnCancel: false, reusable: true,
      },
      effects: [
        expect.objectContaining({
          operation: 'heal-hp',
          restoration: expect.objectContaining({
            amount: { kind: 'skill-check', skillId: 'medicineEd', dieSides: 6 },
          }),
        }),
        {
          effectId: 'conditions', operation: 'remove-conditions', mode: 'listed',
          selection: 'all-applicable', conditionIds: ['Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis'],
        },
      ],
    })

    const valid = mutation(value => {
      value.contexts = ['campaign', 'extended-action']
      value.timing = 'extended'
      value.costs = [{ kind: 'ap', resourceId: 'drain', amount: 1, label: 'Drain 1 AP' }]
      value.prerequisites = [{
        prerequisiteId: 'trainer', kind: 'actor-kind', values: ['trainer'],
        unavailableReason: 'Trainer only.',
      }]
      value.consumption = {
        phase: 'never', quantity: 0, reserveWhilePending: false,
        refundableOnCancel: false, reusable: true,
      }
      value.effects = [{
        effectId: 'check', operation: 'heal-hp', restoration: {
          amount: { kind: 'skill-check', skillId: 'medicineEd', dieSides: 6 },
          cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
        },
      }]
    })
    expect(parseItemSpec(valid).effects[0]).toMatchObject({
      operation: 'heal-hp', restoration: { amount: { kind: 'skill-check', skillId: 'medicineEd', dieSides: 6 } },
    })
    for (const mutateInvalid of [
      (value: any) => { value.effects[0].restoration.amount.dieSides = 8 },
      (value: any) => { value.effects[0].restoration.amount.skillId = 'clientInventedSkill' },
      (value: any) => { value.costs = [] },
      (value: any) => { value.prerequisites = [] },
      (value: any) => { value.timing = 'standard' },
    ]) {
      const invalid = structuredClone(valid) as any
      mutateInvalid(invalid)
      expectCode(invalid, 'invalid-spec')
    }
  })

  it('registers Repulsive medicines and Poultices only through bounded GM-owned guided Loyalty authority', () => {
    for (const canonicalId of ['Energy Powder', 'Energy Root', 'Heal Powder', 'Revival Herb', 'Poultices']) {
      const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
      expect(definition).toMatchObject({
        spec: {
          implementationState: 'guided',
          registeredHandlerId: 'item.guided.v1',
          consumption: { phase: 'gm-adjudication', quantity: 1, reserveWhilePending: true, refundableOnCancel: true },
        },
      })
      expect(definition?.spec.choices).toContainEqual(expect.objectContaining({
        choiceId: 'gm-loyalty-outcome', kind: 'gm-adjudication', privateTo: 'gm', minimum: 1, maximum: 1,
      }))
    }
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve('Full Heal')).not.toBeNull()
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve('Mental Herb')).not.toBeNull()
  })

  it('loads every reviewed executable definition through the strict parser', () => {
    expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.definitions.length).toBeGreaterThan(0)
    for (const definition of ITEM_AUTOMATION_RUNTIME_REGISTRY.definitions) {
      expect(parseItemSpec(definition.spec)).toEqual(definition.spec)
      expect(definition.definitionSha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
