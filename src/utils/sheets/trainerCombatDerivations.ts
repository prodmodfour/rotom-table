import { findAbility, findEdge, findFeature, findMove, toSlug } from '~~/data/ptuReference'
import type { PtuEdge, PtuFeature } from '~/types/ptuReference'
import { resolveEdgeInstance } from '#shared/edgeAutomation/instances'
import { TRAINER_EDGE_MOVE_GRANTS } from '#shared/edgeAutomation/grants'
import { resolveFeatureGrants } from '#shared/featureAutomation/grants'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
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

  for (const instance of resolvedSheetFeatureClosure(sheet)) {
    const choices = Object.fromEntries(instance.choices.flatMap(choice => choice.values.length === 1
      ? [[choice.choiceId, choice.values[0]!]]
      : choice.values.map((value, index) => [`${choice.choiceId}${index + 1}`, value])))
    addFeatureSource(out, seen, { name: instance.canonicalId, ...(Object.keys(choices).length ? { choices } : {}) }, instance.acquisition.kind === 'training' ? 'Training Feature' : instance.canonicalId)
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

  for (const source of resolvedSheetFeatureClosure(sheet)) {
    for (const grant of resolveFeatureGrants(source)) {
      if (grant.kind === 'move' && grant.targetPolicy === 'trainer' && grant.duration === 'permanent') {
        addAutomaticMove(out, seen, existing, grant.canonicalId, grant.sourceCanonicalId)
      }
    }
  }

  for (const [index, edge] of (sheet?.edges ?? []).entries()) {
    const resolved = resolveEdgeInstance({ family: 'trainer', entry: edge, ownerId: sheet?.slug ?? 'unknown', index })
    if (resolved.status !== 'ready' || !resolved.data) continue
    for (const name of TRAINER_EDGE_MOVE_GRANTS[resolved.data.canonicalId] ?? []) {
      addAutomaticMove(out, seen, existing, name, resolved.data.canonicalId)
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

  for (const source of resolvedSheetFeatureClosure(sheet)) {
    for (const grant of resolveFeatureGrants(source)) {
      if (grant.kind === 'ability' && grant.targetPolicy === 'trainer' && grant.duration === 'permanent') {
        addAutomaticAbility(out, seen, existing, grant.canonicalId, grant.sourceCanonicalId)
      }
    }
  }

  return out
}
