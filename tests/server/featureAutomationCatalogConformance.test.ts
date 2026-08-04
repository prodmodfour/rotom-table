import { describe, expect, it } from 'vitest'
import { FEATURE_AUTOMATION_MANIFEST } from '#shared/featureAutomation/manifest'
import { parseFeatureInstanceData, type FeatureChoiceSelection } from '#shared/featureAutomation/instances'
import { resolveEffectiveFeatures } from '../../server/domain/featureAutomation/effectiveFeatures'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/featureAutomation/registry'
import type { TrainerSheet } from '~/types/trainerSheet'

const fallback: Readonly<Record<string, readonly string[]>> = {
  ability: ['Overcoat', 'Pickup'], 'contest-stat': ['Beauty', 'Cool'], edge: ['Basic Skills', 'Adept Skills'], 'equipment-slot': ['Accessory', 'Head'],
  feature: ['Ace Trainer', 'Agility Training'], 'feature-or-edge': ['Field Clinic', 'Medic Training'], move: ['Tackle', 'Growl'], 'research-field': ['General Education', 'Apothecary'],
  species: ['Pikachu', 'Raichu'], stat: ['atk', 'def'], terrain: ['Forest', 'Cave'], 'training-feature': ['Agility Training', 'Brutal Training'], type: ['Normal', 'Fire'],
  skill: ['charm', 'command'], 'damage-class': ['Physical', 'Special'], taste: ['Salty', 'Sweet'],
}
const choicesFor = (entry: typeof FEATURE_AUTOMATION_MANIFEST.entries[number]): FeatureChoiceSelection[] => {
  const groupOffsets = new Map<string, number>()
  return entry.choices.map(choice => {
    const count = choice.minimum
    const offset = choice.distinctGroup ? groupOffsets.get(choice.distinctGroup) ?? 0 : 0
    if (choice.distinctGroup) groupOffsets.set(choice.distinctGroup, offset + count)
    const options = choice.options ?? []
    const defaults = fallback[choice.kind] ?? [choice.kind]
    const values = Array.from({ length: count }, (_, index) => options.length ? options[(offset + index) % options.length]! : defaults[(offset + index) % defaults.length]!)
    return { choiceId: choice.id, values }
  })
}

describe('Feature whole-catalog conformance', () => {
  it('resolves every canonical Feature through a unique hash-bound native definition', () => {
    const started = performance.now()
    for (const [index, manifest] of FEATURE_AUTOMATION_MANIFEST.entries.entries()) {
      const instance = parseFeatureInstanceData({ schemaVersion: 1, instanceId: `feature.conformance.${index}`, canonicalId: manifest.canonicalId, definitionVersion: 1, rank: 1, choices: choicesFor(manifest), acquisition: { kind: 'sheet', sourceId: `conformance.${index}` }, prerequisiteOverride: null })
      const sheet: TrainerSheet = { slug: `trainer-${index}`, name: 'Conformance', level: 50, features: [{ name: manifest.canonicalId, automation: instance }] }
      const effective = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet })
      const projected = effective.instances.find(row => row.instanceId === instance.instanceId)
      expect(projected, manifest.canonicalId).toMatchObject({ canonicalId: manifest.canonicalId, effective: true, parameterStatus: 'ready' })
      expect(FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(manifest.canonicalId).definitionHash).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(performance.now() - started).toBeLessThan(2_500)
  })

  it('fails closed for cyclic nested grants and bounds catalog-scale ownership rows', () => {
    expect(() => parseFeatureInstanceData({ schemaVersion: 1, instanceId: 'feature.cycle.1', canonicalId: 'Dilettante', definitionVersion: 1, rank: 1, choices: [{ choiceId: 'edge', values: ['Basic Skills'] }, { choiceId: 'feature', values: ['Dilettante'] }], acquisition: { kind: 'sheet', sourceId: 'cycle.1' }, prerequisiteOverride: null })).toThrow(/missing feature\.edge/)
    const sheet: TrainerSheet = { slug: 'bounded', name: 'Bounded', level: 50, features: Array.from({ length: 300 }, () => ({ name: 'Witch Hunter' })) }
    const effective = resolveEffectiveFeatures({ ownerId: sheet.slug, sheet })
    expect(effective.instances.length).toBeLessThanOrEqual(256)
    expect(effective.unresolved.some(row => row.reason === 'projection-limit')).toBe(true)
  })
})
