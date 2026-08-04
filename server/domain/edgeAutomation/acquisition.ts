import abilitiesJson from '~~/data/reference/abilities.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet, CharacterSheetEdge } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { TrainerEdgeEntry, TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'
import { canonicalEdgeReference, type EdgeFamily } from '#shared/edgeAutomation/catalog'
import {
  edgeChoiceValues,
  parseEdgeInstanceData,
  resolveEdgeInstance,
  type EdgeInstanceData,
} from '#shared/edgeAutomation/instances'
import {
  EDGE_PREREQUISITE_BY_KEY,
  evaluateEdgePrerequisite,
  type EdgePrerequisiteContext,
  type EdgePrerequisiteEvaluation,
} from '#shared/edgeAutomation/prerequisites'
import { canonicalEdgeKey } from '#shared/edgeAutomation/catalog'
import { computePokemonTutorPointsEarnedForSheet } from '~/utils/sheets/pokemonTutorPoints'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { parseSkillDiceRankValue } from '~/utils/skillRanks'
import {
  buildPokeEdgePrerequisiteContext,
  buildTrainerEdgePrerequisiteContext,
  type BuildEdgePrerequisiteContextOptions,
} from './prerequisiteContext'

export type EdgeAcquisitionActorRole = 'owner' | 'gm'
export type EdgeAcquisitionOperation = 'add' | 'replace' | 'remove'

export interface EdgeAcquisitionRequest {
  readonly operation: EdgeAcquisitionOperation
  readonly family: EdgeFamily
  readonly actorRole: EdgeAcquisitionActorRole
  readonly instance?: unknown
  readonly targetInstanceId?: string
}

export interface EdgeAcquisitionDiagnostic {
  readonly code: string
  readonly message: string
  readonly canonicalId: string | null
}

export interface EdgeAcquisitionResult<Sheet extends CharacterSheet | TrainerSheet> {
  readonly ok: boolean
  readonly sheet: Sheet
  readonly evaluation: EdgePrerequisiteEvaluation | null
  readonly diagnostics: readonly EdgeAcquisitionDiagnostic[]
  readonly addedInstanceId: string | null
  readonly removedInstanceId: string | null
}

interface AbilityReferenceRow { readonly name: string; readonly effect?: string }
const abilityReferences = Object.values(abilitiesJson as Record<string, AbilityReferenceRow>)
const pokedexRows = pokedexJson as PokedexRecord[]
const pokedexBySpecies = new Map(pokedexRows.map(row => [row.species, row] as const))

const fail = (code: string, message: string, canonicalId: string | null = null): EdgeAcquisitionDiagnostic => Object.freeze({ code, message, canonicalId })
const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const readyInstances = (sheet: CharacterSheet | TrainerSheet, family: EdgeFamily): EdgeInstanceData[] => (
  (sheet.edges ?? []).flatMap((entry, index) => {
    const resolved = resolveEdgeInstance({ family, entry, ownerId: sheet.slug, index })
    return resolved.status === 'ready' && resolved.data ? [resolved.data] : []
  })
)

const valuesFor = (instance: EdgeInstanceData, choiceId: string): readonly string[] => edgeChoiceValues(instance, choiceId)

const REPEATABLE_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  'trainer:Basic Skills': 128,
  'trainer:Adept Skills': 128,
  'trainer:Expert Skills': 128,
  'trainer:Master Skills': 128,
  'trainer:Skill Stunt': 128,
  'trainer:Skill Enhancement': 128,
  'trainer:Virtuoso': 128,
  'poke:Accuracy Training': 3,
  'poke:Advanced Mobility': 6,
  'poke:Basic Ranged Attacks': 6,
  'poke:Capability Training': 3,
  'poke:Skill Improvement': 17,
  'poke:Underdog’s Lessons': 3,
})

const repeatLimit = (instance: EdgeInstanceData): number => REPEATABLE_LIMITS[canonicalEdgeKey(instance.family, instance.canonicalId)] ?? 1

const duplicateChoice = (
  instances: readonly EdgeInstanceData[],
  candidate: EdgeInstanceData,
  choiceId: string,
): boolean => {
  const selected = new Set(valuesFor(candidate, choiceId).map(normalized))
  return instances.some(instance => instance.canonicalId === candidate.canonicalId
    && valuesFor(instance, choiceId).some(value => selected.has(normalized(value))))
}

const trainerChoiceDiagnostics = (
  sheet: TrainerSheet,
  candidate: EdgeInstanceData,
  existing: readonly EdgeInstanceData[],
): EdgeAcquisitionDiagnostic[] => {
  const diagnostics: EdgeAcquisitionDiagnostic[] = []
  const id = candidate.canonicalId
  const skill = valuesFor(candidate, 'skill')[0] as TrainerSkillKey | undefined
  const skills = new Map(resolveTrainerSkills(sheet).map(row => [row.key, row]))
  const rank = skill ? skills.get(skill)?.rank : undefined
  const expectedRank: Readonly<Record<string, string>> = {
    'Adept Skills': 'Novice',
    'Expert Skills': 'Adept',
    'Master Skills': 'Expert',
    Virtuoso: 'Master',
  }
  if (id === 'Basic Skills' && skill && rank !== 'Pathetic' && rank !== 'Untrained') {
    diagnostics.push(fail('edge.choice.skill-rank-invalid', 'Basic Skills requires the selected Skill to be Pathetic or Untrained.', id))
  }
  if (expectedRank[id] && rank !== expectedRank[id]) {
    diagnostics.push(fail('edge.choice.skill-rank-invalid', `${id} requires the selected Skill to be ${expectedRank[id]}.`, id))
  }
  if (['Basic Skills', 'Adept Skills', 'Expert Skills', 'Master Skills', 'Virtuoso'].includes(id)
    && duplicateChoice(existing, candidate, 'skill')) {
    diagnostics.push(fail('edge.choice.duplicate', `${id} has already selected that Skill.`, id))
  }
  if (id === 'Skill Enhancement') {
    const selected = valuesFor(candidate, 'skills')
    if (selected.length !== 2 || normalized(selected[0] ?? '') === normalized(selected[1] ?? '')) {
      diagnostics.push(fail('edge.choice.distinct-required', 'Skill Enhancement requires two different Skills.', id))
    }
    if (selected.some(value => existing.some(instance => instance.canonicalId === id
      && valuesFor(instance, 'skills').some(previous => normalized(previous) === normalized(value))))) {
      diagnostics.push(fail('edge.choice.duplicate', 'A Skill may receive Skill Enhancement only once.', id))
    }
  }
  if (id === 'Skill Stunt') {
    const circumstance = valuesFor(candidate, 'circumstance')[0]
    if (circumstance && existing.some(instance => instance.canonicalId === id
      && normalized(valuesFor(instance, 'circumstance')[0] ?? '') === normalized(circumstance))) {
      diagnostics.push(fail('edge.choice.duplicate', 'Skill Stunt requires a different circumstance each time.', id))
    }
  }
  if (id === 'Elemental Connection' && existing.some(instance => instance.canonicalId === 'Mystic Senses')) {
    diagnostics.push(fail('edge.mutual-exclusion', 'Elemental Connection and Mystic Senses are mutually exclusive.', id))
  }
  if (id === 'Mystic Senses' && existing.some(instance => instance.canonicalId === 'Elemental Connection')) {
    diagnostics.push(fail('edge.mutual-exclusion', 'Mystic Senses and Elemental Connection are mutually exclusive.', id))
  }
  return diagnostics
}

const speciesAbilities = (species: PokedexRecord | undefined): readonly string[] => species
  ? [...species.abilities.basic, ...species.abilities.advanced, ...species.abilities.high]
  : []

const pokemonChoiceDiagnostics = (
  sheet: CharacterSheet,
  candidate: EdgeInstanceData,
  existing: readonly EdgeInstanceData[],
): EdgeAcquisitionDiagnostic[] => {
  const diagnostics: EdgeAcquisitionDiagnostic[] = []
  const id = candidate.canonicalId
  const species = pokedexBySpecies.get(sheet.species)
  if (!species) return [fail('edge.species.unresolved', `The app-owned Pokédex has no ${sheet.species} row.`, id)]
  const selected = valuesFor(candidate, 'choice-1')[0]
  if (['Accuracy Training', 'Advanced Mobility', 'Basic Ranged Attacks', 'Capability Training', 'Skill Improvement'].includes(id)
    && duplicateChoice(existing, candidate, 'choice-1')) {
    diagnostics.push(fail('edge.choice.duplicate', `${id} requires a different selection each time.`, id))
  }
  if (id === 'Ability Mastery' && selected) {
    if (!speciesAbilities(species).some(name => normalized(name) === normalized(selected))) {
      diagnostics.push(fail('edge.choice.ability-ineligible', `${selected} is not an Ability ${sheet.species} can naturally qualify for.`, id))
    }
    if ((sheet.abilities ?? []).some(ability => normalized(ability.name) === normalized(selected))) {
      diagnostics.push(fail('edge.choice.ability-owned', `${sheet.species} already has ${selected}.`, id))
    }
  }
  if (id === 'Accuracy Training' && selected) {
    const move = findMove(selected)
    const ac = Number(move?.ac)
    const known = [...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? [])]
      .some(entry => normalized(entry.name) === normalized(selected))
    if (!move || !Number.isFinite(ac) || ac < 3 || !known) diagnostics.push(fail('edge.choice.move-ac-invalid', 'Accuracy Training requires a known canonical Move with AC 3 or higher.', id))
  }
  if (id === 'Advanced Connection' && selected) {
    const owned = (sheet.abilities ?? []).some(ability => normalized(ability.name) === normalized(selected))
    const reference = abilityReferences.find(ability => normalized(ability.name) === normalized(selected))
    if (!owned || !/\bConnection\b/i.test(reference?.effect ?? '')) {
      diagnostics.push(fail('edge.choice.connection-invalid', 'Advanced Connection requires an owned Ability with the Connection keyword.', id))
    }
  }
  if (id === 'Skill Improvement' && selected) {
    const row = resolveSkills(sheet).find(skill => skill.key === selected)
    const speciesValue = Object.entries(species.skills).find(([label]) => normalized(label).replace(/[^a-z0-9]/g, '') === normalized(selected).replace(/(?:education|ed)|[^a-z0-9]/g, ''))?.[1]
    const currentRank = parseSkillDiceRankValue(row?.value)
    const speciesRank = parseSkillDiceRankValue(speciesValue)
    if (!row || currentRank > speciesRank || currentRank >= 6) {
      diagnostics.push(fail('edge.choice.skill-ineligible', 'Skill Improvement requires a Skill at or below its species default and below rank 6.', id))
    }
  }
  if (id === 'Underdog’s Lessons') {
    const finalEvolution = valuesFor(candidate, 'choice-1')[0]
    const moveName = valuesFor(candidate, 'choice-2')[0]
    const finalStage = Math.max(...species.evolutions.map(evolution => evolution.stage))
    const finals = species.evolutions.filter(evolution => evolution.stage === finalStage).map(evolution => evolution.species)
    if (!finalEvolution || !finals.some(name => normalized(name) === normalized(finalEvolution))) {
      diagnostics.push(fail('edge.choice.final-evolution-invalid', 'Underdog’s Lessons requires a final Evolution from the species chain.', id))
    }
    const finalRow = pokedexBySpecies.get(finalEvolution ?? '')
    const eligibleMove = finalRow?.level_up_moves.some(move => move.level <= (sheet.level ?? 1) && normalized(move.name) === normalized(moveName ?? ''))
    if (!eligibleMove) diagnostics.push(fail('edge.choice.move-ineligible', 'The selected Move must be a level-up Move the final Evolution learns at or below the current Level.', id))
    const previousFinals = existing.filter(instance => instance.canonicalId === id).flatMap(instance => valuesFor(instance, 'choice-1'))
    if (previousFinals.some(name => normalized(name) !== normalized(finalEvolution ?? ''))) {
      diagnostics.push(fail('edge.choice.final-evolution-mismatch', 'Every Underdog’s Lessons instance must use the same final Evolution.', id))
    }
  }
  return diagnostics
}

const validOverride = (
  instance: EdgeInstanceData,
  actorRole: EdgeAcquisitionActorRole,
): boolean => {
  const override = instance.prerequisiteOverride
  if (!override || actorRole !== 'gm') return false
  const prerequisite = EDGE_PREREQUISITE_BY_KEY.get(canonicalEdgeKey(instance.family, instance.canonicalId))
  return prerequisite?.expressionSha256 === override.prerequisiteHash
}

const asTrainerEntry = (instance: EdgeInstanceData): TrainerEdgeEntry => ({
  name: instance.canonicalId,
  automation: instance as EdgeInstanceData & { family: 'trainer' },
})

const pokeEdgeTutorCost = (canonicalId: string): number => {
  const reference = canonicalEdgeReference('poke', canonicalId)
  return reference && 'cost' in reference ? reference.cost : 0
}

const asPokemonEntry = (instance: EdgeInstanceData): CharacterSheetEdge => {
  const reference = canonicalEdgeReference('poke', instance.canonicalId)
  return {
    name: instance.canonicalId,
    cost: pokeEdgeTutorCost(instance.canonicalId),
    effect: reference?.effect,
    automation: instance as EdgeInstanceData & { family: 'poke' },
  }
}

const result = <Sheet extends CharacterSheet | TrainerSheet>(
  ok: boolean,
  sheet: Sheet,
  diagnostics: readonly EdgeAcquisitionDiagnostic[],
  evaluation: EdgePrerequisiteEvaluation | null = null,
  addedInstanceId: string | null = null,
  removedInstanceId: string | null = null,
): EdgeAcquisitionResult<Sheet> => Object.freeze({
  ok,
  sheet,
  evaluation,
  diagnostics: Object.freeze([...diagnostics]),
  addedInstanceId,
  removedInstanceId,
})

const removeDependentDiagnostics = (
  family: EdgeFamily,
  canonicalId: string,
  remaining: readonly EdgeInstanceData[],
): EdgeAcquisitionDiagnostic[] => {
  if (family === 'poke' && canonicalId === 'Underdog’s Strength'
    && remaining.some(instance => instance.canonicalId === 'Underdog’s Lessons')) {
    return [fail('edge.removal.dependent-edge', 'Remove Underdog’s Lessons before Underdog’s Strength.', canonicalId)]
  }
  if (family === 'trainer' && canonicalId === 'Elemental Connection'
    && remaining.some(instance => instance.canonicalId === 'Basic Psionics')) {
    return [fail('edge.removal.dependent-edge', 'Remove Basic Psionics before its Elemental Connection prerequisite.', canonicalId)]
  }
  return []
}

export interface ApplyEdgeAcquisitionOptions extends BuildEdgePrerequisiteContextOptions {
  /** Tests and trusted server workflows may supply an already snapshotted context. */
  readonly prerequisiteContext?: EdgePrerequisiteContext
}

/**
 * Authoritative add/retrain/remove planner. It never mutates the supplied sheet;
 * callers commit the returned sheet through the existing revision transaction.
 */
export const applyEdgeAcquisition = <Sheet extends CharacterSheet | TrainerSheet>(
  sheet: Sheet,
  request: EdgeAcquisitionRequest,
  options: ApplyEdgeAcquisitionOptions = {},
): EdgeAcquisitionResult<Sheet> => {
  const original = clone(sheet)
  const next = clone(sheet)
  const expectedFamily: EdgeFamily = 'species' in next ? 'poke' : 'trainer'
  if (request.family !== expectedFamily) return result(false, original, [fail('edge.family.owner-mismatch', 'The Edge family does not match this sheet owner.')])
  const current = readyInstances(next, expectedFamily)

  if (request.operation === 'remove') {
    const targetId = request.targetInstanceId?.trim() ?? ''
    const index = (next.edges ?? []).findIndex((entry, entryIndex) => {
      const resolved = resolveEdgeInstance({ family: expectedFamily, entry, ownerId: next.slug, index: entryIndex })
      return resolved.data?.instanceId === targetId
    })
    if (index < 0) return result(false, original, [fail('edge.instance.not-found', 'The requested Edge instance does not exist.')])
    const removed = current.find(instance => instance.instanceId === targetId)!
    const remaining = current.filter(instance => instance.instanceId !== targetId)
    const dependencies = removeDependentDiagnostics(expectedFamily, removed.canonicalId, remaining)
    if (dependencies.length) return result(false, original, dependencies)
    next.edges = [...(next.edges ?? []).slice(0, index), ...(next.edges ?? []).slice(index + 1)] as Sheet['edges']
    if (expectedFamily === 'poke') {
      const pokemon = next as CharacterSheet
      pokemon.tutorPoints ??= {}
      pokemon.tutorPoints.spent = Math.max(0, (pokemon.tutorPoints.spent ?? 0) - pokeEdgeTutorCost(removed.canonicalId))
    }
    return result(true, next, [], null, null, targetId)
  }

  let candidate: EdgeInstanceData
  try {
    candidate = parseEdgeInstanceData(request.instance, expectedFamily)
  }
  catch (error) {
    return result(false, original, [fail('edge.instance.malformed', error instanceof Error ? error.message : 'Malformed Edge instance.')])
  }
  if (request.operation === 'replace' && !request.targetInstanceId) {
    return result(false, original, [fail('edge.instance.target-required', 'Retraining requires an exact source instance.', candidate.canonicalId)])
  }
  const withoutTarget = request.operation === 'replace'
    ? current.filter(instance => instance.instanceId !== request.targetInstanceId)
    : current
  if (request.operation === 'replace' && withoutTarget.length === current.length) {
    return result(false, original, [fail('edge.instance.not-found', 'The Edge being retrained no longer exists.', candidate.canonicalId)])
  }
  if (withoutTarget.some(instance => instance.instanceId === candidate.instanceId)) {
    return result(false, original, [fail('edge.instance.duplicate-id', 'Edge instance IDs must be unique.', candidate.canonicalId)])
  }
  const ownedCount = withoutTarget.filter(instance => instance.canonicalId === candidate.canonicalId).length
  if (ownedCount >= repeatLimit(candidate)) {
    return result(false, original, [fail('edge.repeat-limit', `${candidate.canonicalId} has reached its repeat limit.`, candidate.canonicalId)])
  }

  const choiceDiagnostics = expectedFamily === 'trainer'
    ? trainerChoiceDiagnostics(next as TrainerSheet, candidate, withoutTarget)
    : pokemonChoiceDiagnostics(next as CharacterSheet, candidate, withoutTarget)
  if (choiceDiagnostics.length) return result(false, original, choiceDiagnostics)

  const context = options.prerequisiteContext ?? (expectedFamily === 'trainer'
    ? buildTrainerEdgePrerequisiteContext(next as TrainerSheet, options)
    : buildPokeEdgePrerequisiteContext(next as CharacterSheet, options))
  const evaluation = evaluateEdgePrerequisite(expectedFamily, candidate.canonicalId, context)
  if (!evaluation.eligible && !validOverride(candidate, request.actorRole)) {
    const overrideMessage = candidate.prerequisiteOverride && request.actorRole !== 'gm'
      ? ' Only a GM may authorize a prerequisite override.' : ''
    return result(false, original, [fail('edge.prerequisite.unmet', `Unmet prerequisites: ${evaluation.unmet.join(', ')}.${overrideMessage}`, candidate.canonicalId)], evaluation)
  }

  let pokeTutorPointDelta = 0
  if (expectedFamily === 'poke') {
    const pokemon = next as CharacterSheet
    const earned = computePokemonTutorPointsEarnedForSheet(pokemon)
    const spent = Math.max(0, Math.floor(pokemon.tutorPoints?.spent ?? 0))
    const replaced = request.operation === 'replace'
      ? current.find(instance => instance.instanceId === request.targetInstanceId)
      : null
    pokeTutorPointDelta = pokeEdgeTutorCost(candidate.canonicalId)
      - (replaced ? pokeEdgeTutorCost(replaced.canonicalId) : 0)
    if (spent + pokeTutorPointDelta > earned) return result(false, original, [fail('edge.tutor-points.insufficient', `The Pokémon needs ${Math.max(0, pokeTutorPointDelta)} additional Tutor Point${pokeTutorPointDelta === 1 ? '' : 's'}.`, candidate.canonicalId)], evaluation)
  }

  const entry = expectedFamily === 'trainer' ? asTrainerEntry(candidate) : asPokemonEntry(candidate)
  if (request.operation === 'replace') {
    const targetIndex = (next.edges ?? []).findIndex((existing, index) => {
      const resolved = resolveEdgeInstance({ family: expectedFamily, entry: existing, ownerId: next.slug, index })
      return resolved.data?.instanceId === request.targetInstanceId
    })
    next.edges = (next.edges ?? []).map((existing, index) => index === targetIndex ? entry : existing) as Sheet['edges']
  }
  else {
    next.edges = [...(next.edges ?? []), entry] as Sheet['edges']
  }
  if (expectedFamily === 'poke') {
    const pokemon = next as CharacterSheet
    pokemon.tutorPoints ??= {}
    pokemon.tutorPoints.earned = computePokemonTutorPointsEarnedForSheet(pokemon)
    pokemon.tutorPoints.spent = Math.max(0, Math.floor(pokemon.tutorPoints.spent ?? 0) + pokeTutorPointDelta)
  }
  return result(true, next, [], evaluation, candidate.instanceId, request.operation === 'replace' ? request.targetInstanceId ?? null : null)
}
