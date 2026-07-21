import { describe, expect, it } from 'vitest'
import {
  AbilityDeclarationValidationError,
  parseAbilityDeclarationIntent,
  parseAbilityDeclarationOffer,
  type AbilityDeclarationOfferTargeting,
} from '#shared/abilityAutomation/declarationIntent'
import {
  AbilityDeclarationResolutionError,
  createAbilityDeclarationOffer,
  projectAbilityDeclarationOfferForController,
  resolveAbilityDeclarationIntent,
} from '../../server/domain/abilityAutomation/declarationIntent'
import type { AbilitySpecV1Runtime } from '../../server/domain/abilityAutomation/registry'
import { DEFAULT_ABILITY_SPEC_RULESET_VERSION } from '../../server/domain/abilityAutomation/validateSpec'

const HASH = 'a'.repeat(64)
const targetingKinds = [
  'none', 'self', 'token', 'side', 'area', 'field', 'cell', 'direction',
  'type', 'stat', 'move', 'ability', 'item', 'branch',
] as const
const optionValues = {
  self: { kind: 'self', placementId: 'actor-token' },
  token: { kind: 'token', placementId: 'target-token' },
  side: { kind: 'side', sideId: 'side.a' },
  area: { kind: 'area', areaId: 'area.burst.actor', cells: [{ x: 1, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }] },
  field: { kind: 'field', fieldId: 'field.weather' },
  cell: { kind: 'cell', cellId: 'cell.1.2.0', cell: { x: 1, y: 2, z: 0 } },
  direction: { kind: 'direction', directionId: 'northeast' },
  type: { kind: 'type', typeId: 'fire' },
  stat: { kind: 'stat', statId: 'special-attack' },
  move: { kind: 'move', canonicalMoveId: 'Flamethrower' },
  ability: { kind: 'ability', canonicalAbilityId: 'Blaze', abilityInstanceId: 'base:target-token:0' },
  item: { kind: 'item', itemId: 'item.sitrus-berry', itemResourceId: 'inventory.actor.sitrus' },
  branch: { kind: 'branch', branchId: 'branch.power' },
} as const

const declarations = (): readonly AbilityDeclarationOfferTargeting[] => targetingKinds.map((kind, index) => ({
  id: `targeting.${kind}`,
  kind,
  minSelections: kind === 'none' ? 0 : 1,
  maxSelections: kind === 'none' ? 0 : 1,
  options: kind === 'none' ? [] : [{
    id: `option.${kind}.one`,
    presentationKey: `ability.option.${kind}.one`,
    value: optionValues[kind as keyof typeof optionValues],
  }],
})) as readonly AbilityDeclarationOfferTargeting[]

const runtime = (): AbilitySpecV1Runtime => ({
  kind: 'abilityspec-v1',
  canonicalId: 'Choice Master',
  version: 1,
  definitionHash: HASH,
  sourceModule: 'server/domain/abilityAutomation/specs/choiceMaster.ts',
  definition: {
    spec: {
      schemaVersion: 1,
      canonicalId: 'Choice Master',
      version: 1,
      modes: [{ id: 'mode-activated', kind: 'activated' }],
      subscriptions: [],
      targeting: declarations().map(declaration => ({
        id: declaration.id,
        modeId: 'mode-activated',
        kind: declaration.kind,
        minSelections: declaration.minSelections,
        maxSelections: declaration.maxSelections,
        selector: null,
        predicate: null,
      })),
      preconditions: [], costs: [], phases: [], registeredHandlerId: null,
      presentation: {
        displayName: 'Choice Master', summaryKey: 'ability.choice-master.summary',
        vfxKey: null, tags: ['activated'],
      },
    },
    capabilityIds: [],
    rulesetVersion: DEFAULT_ABILITY_SPEC_RULESET_VERSION,
    definitionHash: HASH,
    canonicalJson: '{}',
    extensionReferences: [],
    registeredHandler: null,
  },
})

const offer = () => createAbilityDeclarationOffer({
  runtime: runtime(),
  draft: {
    offerId: 'offer.choice-master.one',
    mapSlug: 'choice-arena',
    mapRevision: 12,
    createdAt: 1_000,
    expiresAt: 61_000,
    actorPlacementId: 'actor-token',
    abilityInstanceId: 'base:actor-token:choice-master',
    modeId: 'mode-activated',
    declarations: declarations(),
  },
})

const intent = (issued = offer()) => ({
  schemaVersion: 1,
  intentId: 'intent.choice-master.one',
  offerId: issued.offerId,
  offerSha256: issued.offerSha256,
  mapSlug: issued.mapSlug,
  baseRevision: issued.mapRevision,
  actorPlacementId: issued.actorPlacementId,
  abilityInstanceId: issued.abilityInstanceId,
  canonicalId: issued.canonicalId,
  modeId: issued.modeId,
  selections: issued.declarations.map(declaration => ({
    declarationId: declaration.id,
    kind: declaration.kind,
    optionIds: declaration.kind === 'none' ? [] : [declaration.options[0]!.id],
  })),
})

describe('authoritative ability declaration intent', () => {
  it('issues a hash-bound offer for every reviewed targeting/choice kind', () => {
    const issued = offer()
    expect(issued.declarations.map(declaration => declaration.kind)).toEqual(targetingKinds)
    expect(issued.offerSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(issued.declarations[4]).toMatchObject({ kind: 'area' })
    expect(issued.declarations[4]?.options[0]?.value).toMatchObject({
      cells: expect.arrayContaining([{ x: 1, y: 2, z: 0 }]),
    })
    expect(Object.isFrozen(issued)).toBe(true)
    expect(Object.isFrozen(issued.declarations[4]?.options[0]?.value)).toBe(true)
  })

  it('resolves only stable option IDs back to private server-issued mechanics', () => {
    const issued = offer()
    const resolved = resolveAbilityDeclarationIntent({
      offer: issued,
      intent: intent(issued),
      runtime: runtime(),
      currentMapRevision: 12,
      now: 2_000,
    })
    expect(resolved.choices).toHaveLength(targetingKinds.length)
    expect(resolved.choices.find(choice => choice.kind === 'token')).toMatchObject({
      options: [{ value: { placementId: 'target-token' } }],
    })
    expect(resolved.choices.find(choice => choice.kind === 'type')).toMatchObject({
      options: [{ value: { typeId: 'fire' } }],
    })
    expect(resolved.intentSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('projects option IDs and presentation only, never private target mechanics', () => {
    const view = projectAbilityDeclarationOfferForController(offer())
    const serialized = JSON.stringify(view)
    expect(serialized).toContain('option.token.one')
    expect(serialized).not.toContain('target-token')
    expect(serialized).not.toContain('inventory.actor.sitrus')
    expect(serialized).not.toContain('Flamethrower')
  })

  it('rejects tampered offers, stale revisions, expired offers, and mismatched identity', () => {
    const issued = offer()
    const tampered = structuredClone(issued)
    const token = tampered.declarations.find(declaration => declaration.kind === 'token')!
    Object.assign(token.options[0]!.value, { placementId: 'attacker-chosen-token' })
    expect(() => resolveAbilityDeclarationIntent({
      offer: tampered, intent: intent(issued), runtime: runtime(), currentMapRevision: 12, now: 2_000,
    })).toThrowError(AbilityDeclarationResolutionError)
    expect(() => resolveAbilityDeclarationIntent({
      offer: issued, intent: intent(issued), runtime: runtime(), currentMapRevision: 13, now: 2_000,
    })).toThrowError(/regenerated/)
    expect(() => resolveAbilityDeclarationIntent({
      offer: issued, intent: intent(issued), runtime: runtime(), currentMapRevision: 12, now: 70_000,
    })).toThrowError(/lifetime/)
    const mismatched = intent(issued)
    mismatched.actorPlacementId = 'other-token'
    expect(() => resolveAbilityDeclarationIntent({
      offer: issued, intent: mismatched, runtime: runtime(), currentMapRevision: 12, now: 2_000,
    })).toThrowError(/does not match/)
  })

  it('rejects unknown, duplicate, over-limit, and reordered selections', () => {
    const issued = offer()
    const unknown = intent(issued)
    unknown.selections[2]!.optionIds = ['option.token.unissued']
    expect(() => resolveAbilityDeclarationIntent({
      offer: issued, intent: unknown, runtime: runtime(), currentMapRevision: 12, now: 2_000,
    })).toThrowError(/not issued/)
    const duplicate = intent(issued)
    duplicate.selections[2]!.optionIds = ['option.token.one', 'option.token.one']
    expect(() => parseAbilityDeclarationIntent(duplicate)).toThrowError(AbilityDeclarationValidationError)
    const reordered = intent(issued)
    ;[reordered.selections[1], reordered.selections[2]] = [reordered.selections[2]!, reordered.selections[1]!]
    expect(() => resolveAbilityDeclarationIntent({
      offer: issued, intent: reordered, runtime: runtime(), currentMapRevision: 12, now: 2_000,
    })).toThrowError(/bounds or order/)
  })

  it('rejects non-JSON and malformed option shapes before mechanics', () => {
    expect(() => parseAbilityDeclarationIntent({ ...intent(), callback: () => true }))
      .toThrowError(AbilityDeclarationValidationError)
    const malformed = structuredClone(offer())
    const cell = malformed.declarations.find(declaration => declaration.kind === 'cell')!
    Object.assign(cell.options[0]!.value, { rawPatch: { x: 99 } })
    expect(() => parseAbilityDeclarationOffer(malformed)).toThrowError(AbilityDeclarationValidationError)
  })
})
