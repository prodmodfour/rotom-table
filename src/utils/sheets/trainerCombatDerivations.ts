import { findAbility, findEdge, findFeature, findMove, toSlug } from '~~/data/ptuReference'
import {
  trainerEdgeSubchoices,
  trainerFeatureSubchoices,
  trainerSubchoiceValue,
  type TrainerSubchoiceDefinition,
} from '~/utils/sheets/trainerSubchoices'
import type { PtuEdge, PtuFeature } from '~/types/ptuReference'
import type {
  TrainerAbilityEntry,
  TrainerClassEntry,
  TrainerEdgeEntry,
  TrainerFeatureEntry,
  TrainerMove,
  TrainerSheet,
} from '~/types/trainerSheet'

export interface TrainerCombatFeatureSource {
  entry: TrainerFeatureEntry
  reference: PtuFeature | null
  /** Human-readable sheet origin, such as the granting Feature name. */
  sourceLabel: string
}

export interface TrainerCombatEdgeSource {
  entry: TrainerEdgeEntry
  reference: PtuEdge | null
  sourceLabel: string
}

export interface TrainerAutomaticCombatEntry<T> {
  entry: T
  sourceLabel: string
}

const GRANTED_FEATURE_CHOICE_KEYS = new Set(['trainingFeature', 'orderFeature', 'feature'])

const normalizedNameKey = (name: unknown): string => (
  typeof name === 'string' ? toSlug(name) : ''
)

const featureName = (entry: Pick<TrainerFeatureEntry, 'name'> | Pick<TrainerClassEntry, 'name'>): string => (
  typeof entry.name === 'string' ? entry.name.trim() : ''
)

const edgeName = (entry: Pick<TrainerEdgeEntry, 'name'>): string => (
  typeof entry.name === 'string' ? entry.name.trim() : ''
)

const addFeatureSource = (
  out: TrainerCombatFeatureSource[],
  seen: Set<string>,
  entry: TrainerFeatureEntry,
  sourceLabel: string,
): void => {
  const name = featureName(entry)
  const key = normalizedNameKey(name)
  if (!key || seen.has(key)) return
  seen.add(key)
  out.push({ entry: { ...entry, name }, reference: findFeature(name), sourceLabel })
}

const addEdgeSource = (
  out: TrainerCombatEdgeSource[],
  seen: Set<string>,
  entry: TrainerEdgeEntry,
  sourceLabel: string,
): void => {
  const name = edgeName(entry)
  const key = normalizedNameKey(name)
  if (!key || seen.has(key)) return
  seen.add(key)
  out.push({ entry: { ...entry, name }, reference: findEdge(name), sourceLabel })
}

const selectedGrantedFeatureNames = (feature: TrainerFeatureEntry): string[] => {
  const definitions = trainerFeatureSubchoices(feature)
  return definitions
    .filter((definition) => GRANTED_FEATURE_CHOICE_KEYS.has(definition.key))
    .map((definition) => trainerSubchoiceValue(feature, definition, definitions))
    .filter((value): value is string => Boolean(value?.trim()))
}

/**
 * Feature-like trainer combat sources, including direct Features, Class names
 * that resolve as class Features, the sheet's selected training Feature, and
 * Features granted through explicit sheet subchoices such as Commander or
 * Elite Trainer.
 */
export const trainerCombatFeatureSources = (sheet: TrainerSheet | null | undefined): TrainerCombatFeatureSource[] => {
  if (!sheet) return []

  const out: TrainerCombatFeatureSource[] = []
  const seen = new Set<string>()

  if (sheet.trainingFeature) addFeatureSource(out, seen, { name: sheet.trainingFeature, tags: ['Training', 'Orders'] }, 'Training Feature')
  for (const feature of sheet.features ?? []) addFeatureSource(out, seen, feature, feature.name)
  for (const trainerClass of sheet.classes ?? []) addFeatureSource(out, seen, { name: featureName(trainerClass) }, trainerClass.name)

  for (const feature of sheet.features ?? []) {
    for (const name of selectedGrantedFeatureNames(feature)) {
      addFeatureSource(out, seen, { name }, feature.name)
    }
  }

  return out
}

export const trainerCombatEdgeSources = (sheet: TrainerSheet | null | undefined): TrainerCombatEdgeSource[] => {
  if (!sheet) return []

  const out: TrainerCombatEdgeSource[] = []
  const seen = new Set<string>()
  for (const edge of sheet.edges ?? []) addEdgeSource(out, seen, edge, edge.name)
  return out
}

const knownChoiceValues = (
  entry: TrainerFeatureEntry | TrainerEdgeEntry,
  definitions: readonly TrainerSubchoiceDefinition[],
  predicate: (definition: TrainerSubchoiceDefinition) => boolean,
): string[] => definitions
  .filter(predicate)
  .map((definition) => trainerSubchoiceValue(entry, definition, definitions))
  .filter((value): value is string => Boolean(value?.trim()))

const isMoveChoice = (definition: TrainerSubchoiceDefinition): boolean =>
  /move/i.test(definition.key)

const isAbilityChoice = (definition: TrainerSubchoiceDefinition): boolean =>
  /ability/i.test(definition.key)

const effectGrantsTrainerMoveChoice = (effect: string | null | undefined): boolean => {
  const text = effect ?? ''
  return /\bYou learn\b/i.test(text) || /^\s*Learn\b/i.test(text)
}

const effectGrantsTrainerAbilityChoice = (effect: string | null | undefined): boolean =>
  /\bYou gain\b/i.test(effect ?? '')

const stripLeadingChoiceText = (raw: string): string => raw
  .replace(/^your\s+choice\s+of\s+(?:the\s+)?/i, '')
  .replace(/^one\s+of\s+(?:the\s+)?/i, '')
  .replace(/^the\s+/i, '')
  .trim()

const splitNamedList = (raw: string): string[] => stripLeadingChoiceText(raw)
  .replace(/\s+(?:and|or)\s+/gi, ', ')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const learnedMoveTexts = (effect: string | null | undefined): string[] => {
  const text = effect ?? ''
  const matches = text.matchAll(/(?:\bYou learn|^\s*Learn)\s+(?:the\s+)?(?:Moves?\s+)?([^.]+?)(?:\.|$)/gim)
  return [...matches].map((match) => match[1]?.trim() ?? '').filter(Boolean)
}

const gainedAbilityTexts = (effect: string | null | undefined): string[] => {
  const text = effect ?? ''
  const matches = text.matchAll(/\bYou gain\s+(?:the\s+)?(.+?)\s+Ability\b/gim)
  return [...matches].map((match) => match[1]?.trim() ?? '').filter(Boolean)
}

const addAutomaticMove = (
  out: TrainerAutomaticCombatEntry<TrainerMove>[],
  seen: Set<string>,
  existing: Set<string>,
  rawName: string,
  sourceLabel: string,
): void => {
  const reference = findMove(rawName)
  if (!reference) return
  const key = normalizedNameKey(reference.name)
  if (!key || existing.has(key) || seen.has(key)) return
  seen.add(key)
  out.push({ entry: { name: reference.name }, sourceLabel })
}

const addAutomaticAbility = (
  out: TrainerAutomaticCombatEntry<TrainerAbilityEntry>[],
  seen: Set<string>,
  existing: Set<string>,
  rawName: string,
  sourceLabel: string,
): void => {
  const reference = findAbility(rawName)
  if (!reference) return
  const key = normalizedNameKey(reference.name)
  if (!key || existing.has(key) || seen.has(key)) return
  seen.add(key)
  out.push({ entry: { name: reference.name }, sourceLabel })
}

const existingMoveKeys = (sheet: TrainerSheet | null | undefined): Set<string> => new Set(
  (sheet?.movelist ?? []).map((move) => normalizedNameKey(findMove(move.name)?.name ?? move.name)).filter(Boolean),
)

const existingAbilityKeys = (sheet: TrainerSheet | null | undefined): Set<string> => new Set(
  (sheet?.abilities ?? []).map((ability) => normalizedNameKey(findAbility(ability.name)?.name ?? ability.name)).filter(Boolean),
)

export const deriveTrainerAutomaticMoves = (
  sheet: TrainerSheet | null | undefined,
): TrainerAutomaticCombatEntry<TrainerMove>[] => {
  const out: TrainerAutomaticCombatEntry<TrainerMove>[] = []
  const seen = new Set<string>()
  const existing = existingMoveKeys(sheet)

  for (const source of trainerCombatFeatureSources(sheet)) {
    if (effectGrantsTrainerMoveChoice(source.reference?.effect)) {
      const definitions = trainerFeatureSubchoices(source.entry)
      for (const name of knownChoiceValues(source.entry, definitions, isMoveChoice)) {
        addAutomaticMove(out, seen, existing, name, source.entry.name)
      }
    }

    for (const text of learnedMoveTexts(source.reference?.effect)) {
      for (const name of splitNamedList(text)) addAutomaticMove(out, seen, existing, name, source.entry.name)
    }
  }

  for (const source of trainerCombatEdgeSources(sheet)) {
    const definitions = trainerEdgeSubchoices(source.entry)
    for (const name of knownChoiceValues(source.entry, definitions, isMoveChoice)) {
      addAutomaticMove(out, seen, existing, name, source.entry.name)
    }

    for (const text of learnedMoveTexts(source.reference?.effect)) {
      for (const name of splitNamedList(text)) addAutomaticMove(out, seen, existing, name, source.entry.name)
    }
  }

  return out
}

export const deriveTrainerAutomaticAbilities = (
  sheet: TrainerSheet | null | undefined,
): TrainerAutomaticCombatEntry<TrainerAbilityEntry>[] => {
  const out: TrainerAutomaticCombatEntry<TrainerAbilityEntry>[] = []
  const seen = new Set<string>()
  const existing = existingAbilityKeys(sheet)

  for (const source of trainerCombatFeatureSources(sheet)) {
    if (effectGrantsTrainerAbilityChoice(source.reference?.effect)) {
      const definitions = trainerFeatureSubchoices(source.entry)
      for (const name of knownChoiceValues(source.entry, definitions, isAbilityChoice)) {
        addAutomaticAbility(out, seen, existing, name, source.entry.name)
      }
    }

    for (const text of gainedAbilityTexts(source.reference?.effect)) {
      for (const name of splitNamedList(text)) addAutomaticAbility(out, seen, existing, name, source.entry.name)
    }
  }

  for (const source of trainerCombatEdgeSources(sheet)) {
    const definitions = trainerEdgeSubchoices(source.entry)
    for (const name of knownChoiceValues(source.entry, definitions, isAbilityChoice)) {
      addAutomaticAbility(out, seen, existing, name, source.entry.name)
    }

    for (const text of gainedAbilityTexts(source.reference?.effect)) {
      for (const name of splitNamedList(text)) addAutomaticAbility(out, seen, existing, name, source.entry.name)
    }
  }

  return out
}
