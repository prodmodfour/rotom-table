import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import { projectAuthoritativeEffectiveAbilities } from '../abilityAutomation/effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../edgeAutomation/permanentGrants'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'

export const ITEM_DIGESTION_BUFF_ORDINARY_CAPACITY = 1 as const
export const ITEM_DIGESTION_BUFF_GLUTTONY_CAPACITY = 3 as const

export interface AuthoritativeDigestionBuffStorage {
  readonly names: readonly string[]
  readonly capacity: 1 | 3
  readonly hasEffectiveGluttony: boolean
}

const fail = (message: string): never => { throw new Error(message) }

const storedNames = (kind: SheetKind, sheet: AnyLiveSheet): readonly string[] => {
  const legacy: unknown = kind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFood
    : (sheet as TrainerSheet).digestion
  const extras: unknown = kind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFoods
    : (sheet as TrainerSheet).digestionFoods
  if (extras !== undefined && (!Array.isArray(extras) || extras.length > ITEM_DIGESTION_BUFF_GLUTTONY_CAPACITY)) {
    return fail('Digestion Buff storage has invalid bounded contents.')
  }
  const values = extras ?? []
  if (values.some(value => typeof value !== 'string' || value.trim() !== value || value.length === 0)) {
    return fail('Digestion Buff storage contains an invalid canonical item name.')
  }
  const legacyNames: string[] = []
  if (typeof legacy === 'string' && legacy.trim()) legacyNames.push(legacy.trim())
  else if (legacy !== undefined && legacy !== null && legacy !== '') {
    return fail('Digestion Buff storage contains an invalid legacy item name.')
  }
  const names = [...legacyNames, ...(values as string[])]
  if (names.length > ITEM_DIGESTION_BUFF_GLUTTONY_CAPACITY) {
    return fail('Digestion Buff storage exceeds its bounded capacity.')
  }
  for (const name of names) {
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(name)
    if (!definition?.spec.effects.some(effect => (
      effect.operation === 'store-digestion-buff' || effect.operation === 'use-snack-or-bait'
    ))) {
      fail(`Stored Digestion Buff ${name} has no reviewed item definition.`)
    }
  }
  return Object.freeze(names)
}

const effectiveGluttony = (input: {
  readonly kind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly placement: SheetPlacement | null
  readonly map: TabletopMap | null
}): boolean => {
  if (!input.placement || !input.map) return false
  return projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    species: input.kind === 'pokemon' ? (input.sheet as CharacterSheet).species : null,
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective && ability.canonicalId === 'Gluttony')
}

/** Validate bounded legacy/new storage and resolve suppression-aware Gluttony capacity. */
export const resolveAuthoritativeDigestionBuffStorage = (input: {
  readonly kind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly placement: SheetPlacement | null
  readonly map: TabletopMap | null
}): AuthoritativeDigestionBuffStorage => {
  const names = storedNames(input.kind, input.sheet)
  const hasEffectiveGluttony = effectiveGluttony(input)
  const capacity = hasEffectiveGluttony
    ? ITEM_DIGESTION_BUFF_GLUTTONY_CAPACITY
    : ITEM_DIGESTION_BUFF_ORDINARY_CAPACITY
  if (names.length > capacity) {
    fail(`Digestion Buff storage exceeds its authoritative capacity ${capacity}.`)
  }
  return Object.freeze({ names, capacity, hasEffectiveGluttony })
}

/** Store one exact reviewed Snack identity; incompatible stacking fails before inventory consumption. */
export const storeAuthoritativeDigestionBuff = (input: {
  readonly kind: SheetKind
  readonly sheet: AnyLiveSheet
  readonly placement: SheetPlacement | null
  readonly map: TabletopMap | null
  readonly definition: ItemRuntimeDefinition
}): AnyLiveSheet => {
  const effect = input.definition.spec.effects.find(candidate => (
    candidate.operation === 'store-digestion-buff' || candidate.operation === 'use-snack-or-bait'
  )) ?? fail(`${input.definition.canonicalId} is not a reviewed Snack definition.`)
  const storage = resolveAuthoritativeDigestionBuffStorage(input)
  if (storage.names.length >= storage.capacity) {
    fail(`Digestion Buff storage reached its authoritative capacity ${storage.capacity}.`)
  }
  if (effect.requiredPokemonType !== null && input.kind !== 'pokemon') {
    fail(`${input.definition.canonicalId} requires a Pokémon target.`)
  }
  if (input.kind === 'pokemon') {
    const pokemon = structuredClone(input.sheet as CharacterSheet)
    const items = { ...(pokemon.items ?? {}) }
    if (storage.capacity === 1) {
      items.digestionFood = input.definition.canonicalId
      delete items.digestionFoods
    }
    else {
      items.digestionFoods = [...storage.names, input.definition.canonicalId]
      delete items.digestionFood
    }
    pokemon.items = items
    return pokemon
  }
  const trainer = structuredClone(input.sheet as TrainerSheet)
  if (storage.capacity === 1) {
    trainer.digestion = input.definition.canonicalId
    delete trainer.digestionFoods
  }
  else {
    trainer.digestionFoods = [...storage.names, input.definition.canonicalId]
    delete trainer.digestion
  }
  return trainer
}

export const itemDigestionBuffPreviewDescription = (definition: ItemRuntimeDefinition): string | null => {
  const effect = definition.spec.effects.find(candidate => (
    candidate.operation === 'store-digestion-buff' || candidate.operation === 'use-snack-or-bait'
  ))
  if (!effect) return null
  return effect.buffKind === 'fixed-heal'
    ? `Stores a Digestion Buff that restores ${effect.amount} HP when traded.`
    : `Stores a Digestion Buff that restores ${effect.amount}/${effect.denominator} maximum HP at each turn start for the rest of the encounter when traded.`
}
