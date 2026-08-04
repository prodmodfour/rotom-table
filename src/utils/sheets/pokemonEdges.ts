import pokedexJson from '~~/data/reference/pokedex.json'
import type { CharacterSheet, CharacterSheetEdge } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import { CANONICAL_POKE_EDGE_IDS, CANONICAL_POKE_EDGE_REFERENCE, parseEdgeLabel } from '#shared/edgeAutomation/catalog'
import { EDGE_AUTOMATION_MANIFEST_BY_KEY, type EdgeChoiceDefinition } from '#shared/edgeAutomation/manifest'
import { canonicalEdgeKey } from '#shared/edgeAutomation/catalog'
import { parseEdgeInstanceData, resolveEdgeInstance, type EdgeInstanceParameterStatus } from '#shared/edgeAutomation/instances'
import { SHEET_SKILL_ORDER } from '~/utils/sheets/pokemonDerived'

const pokedexBySpecies = new Map((pokedexJson as PokedexRecord[]).map(row => [row.species, row] as const))
const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const stablePart = (value: string): string => value.normalize('NFKD').toLocaleLowerCase('en-US')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'edge'

export const POKE_EDGE_NAME_OPTIONS: readonly string[] = CANONICAL_POKE_EDGE_IDS

export interface PokemonEdgeChoiceOption {
  readonly value: string
  readonly label: string
}

export const pokemonEdgeChoiceDefinitions = (edge: Pick<CharacterSheetEdge, 'name'>): readonly EdgeChoiceDefinition[] => {
  const canonicalId = parseEdgeLabel('poke', edge.name).canonicalId
  return canonicalId
    ? EDGE_AUTOMATION_MANIFEST_BY_KEY.get(canonicalEdgeKey('poke', canonicalId))?.choices ?? []
    : []
}

const speciesAbilities = (species: PokedexRecord | undefined): readonly string[] => species?.abilities
  ? [...(species.abilities.basic ?? []), ...(species.abilities.advanced ?? []), ...(species.abilities.high ?? [])]
  : []

const uniqueOptions = (values: readonly string[]): PokemonEdgeChoiceOption[] => [...new Set(values.map(value => value.trim()).filter(Boolean))]
  .sort((left, right) => left.localeCompare(right, 'en-US'))
  .map(value => ({ value, label: value }))

export const pokemonEdgeChoiceOptions = (
  sheet: CharacterSheet,
  edge: CharacterSheetEdge,
  definition: EdgeChoiceDefinition,
): readonly PokemonEdgeChoiceOption[] => {
  const canonicalId = parseEdgeLabel('poke', edge.name).canonicalId
  const species = pokedexBySpecies.get(sheet.species)
  if (definition.kind === 'ability') {
    return uniqueOptions(canonicalId === 'Advanced Connection'
      ? (sheet.abilities ?? []).map(ability => ability.name)
      : speciesAbilities(species))
  }
  if (definition.kind === 'move') {
    if (canonicalId === 'Underdog’s Lessons') {
      const finalSpecies = edge.choices?.['choice-1']
      const final = finalSpecies ? pokedexBySpecies.get(finalSpecies) : undefined
      return uniqueOptions((final?.level_up_moves ?? [])
        .filter(move => move.level <= (sheet.level ?? 1))
        .map(move => move.name))
    }
    return uniqueOptions([...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? [])].map(move => move.name))
  }
  if (definition.kind === 'movement-capability') {
    return uniqueOptions(['Overland', 'Sky', 'Swim', 'Levitate', 'Burrow', 'Teleporter'])
  }
  if (definition.kind === 'attack-stat') return uniqueOptions(['Attack', 'Special Attack'])
  if (definition.kind === 'elemental-struggle-capability') {
    return uniqueOptions(['Firestarter', 'Fountain', 'Freezer', 'Guster', 'Materializer', 'Zapper'])
  }
  if (definition.kind === 'power-or-jump-capability') return uniqueOptions(['Power', 'High Jump', 'Long Jump'])
  if (definition.kind === 'final-evolution') {
    if (!species) return []
    const evolutions = species.evolutions ?? []
    const finalStage = Math.max(0, ...evolutions.map(evolution => evolution.stage))
    return uniqueOptions(evolutions.filter(evolution => evolution.stage === finalStage).map(evolution => evolution.species))
  }
  if (definition.kind === 'skill') return SHEET_SKILL_ORDER.map(([value, label]) => ({ value, label }))
  return []
}

const rebuildPokemonEdgeAutomation = (
  sheet: CharacterSheet,
  edge: CharacterSheetEdge,
  index: number,
): void => {
  const canonicalId = parseEdgeLabel('poke', edge.name).canonicalId
  if (!canonicalId) {
    delete edge.automation
    return
  }
  const definitions = pokemonEdgeChoiceDefinitions(edge)
  const selections = definitions.flatMap(definition => {
    const value = edge.choices?.[definition.id]?.trim()
    return value ? [{ choiceId: definition.id, values: [value] }] : []
  })
  if (definitions.some(definition => definition.minimum > 0
    && !selections.some(selection => selection.choiceId === definition.id))) {
    delete edge.automation
    return
  }
  const existingId = edge.automation?.canonicalId === canonicalId ? edge.automation.instanceId : null
  try {
    edge.automation = parseEdgeInstanceData({
      schemaVersion: 1,
      instanceId: existingId ?? `poke-edge.${stablePart(sheet.slug)}.${index + 1}.${stablePart(canonicalId)}`,
      family: 'poke',
      canonicalId,
      definitionVersion: 1,
      rank: 1,
      choices: selections,
      acquisition: { kind: 'sheet', sourceId: `sheet.${stablePart(sheet.slug)}` },
      prerequisiteOverride: null,
    }, 'poke', canonicalId) as NonNullable<CharacterSheetEdge['automation']>
  }
  catch {
    delete edge.automation
  }
}

export const setPokemonEdgeName = (
  sheet: CharacterSheet,
  edge: CharacterSheetEdge,
  index: number,
  rawName: unknown,
): void => {
  const canonicalId = parseEdgeLabel('poke', rawName).canonicalId
  edge.name = canonicalId ?? ''
  edge.choices = {}
  delete edge.automation
  if (!canonicalId) {
    delete edge.cost
    delete edge.effect
    return
  }
  const reference = CANONICAL_POKE_EDGE_REFERENCE[canonicalId]!
  edge.cost = reference.cost
  edge.effect = reference.effect
  rebuildPokemonEdgeAutomation(sheet, edge, index)
}

export const setPokemonEdgeChoice = (
  sheet: CharacterSheet,
  edge: CharacterSheetEdge,
  index: number,
  choiceId: string,
  rawValue: unknown,
): void => {
  const definition = pokemonEdgeChoiceDefinitions(edge).find(choice => choice.id === choiceId)
  if (!definition) return
  const value = typeof rawValue === 'string' ? rawValue.trim() : ''
  const allowed = pokemonEdgeChoiceOptions(sheet, edge, definition)
  if (value && allowed.length > 0 && !allowed.some(option => normalized(option.value) === normalized(value))) return
  edge.choices ??= {}
  if (value) edge.choices[choiceId] = value
  else delete edge.choices[choiceId]
  // Changing the final Evolution invalidates its dependent Move selection.
  if (choiceId === 'choice-1' && parseEdgeLabel('poke', edge.name).canonicalId === 'Underdog’s Lessons') {
    delete edge.choices['choice-2']
  }
  rebuildPokemonEdgeAutomation(sheet, edge, index)
}

export interface PokemonEdgeInspectorStatus {
  readonly status: EdgeInstanceParameterStatus | 'unresolved-identity'
  readonly label: string
  readonly diagnostics: readonly string[]
}

export const pokemonEdgeInspectorStatus = (
  sheet: CharacterSheet,
  edge: CharacterSheetEdge,
  index: number,
): PokemonEdgeInspectorStatus => {
  const resolved = resolveEdgeInstance({ family: 'poke', entry: edge, ownerId: sheet.slug, index })
  const labels: Readonly<Record<PokemonEdgeInspectorStatus['status'], string>> = {
    ready: 'Automated',
    'missing-required-data': 'Choice required',
    'unresolved-identity': 'No canonical identity',
    malformed: 'Invalid automation data',
  }
  return Object.freeze({ status: resolved.status, label: labels[resolved.status], diagnostics: resolved.diagnostics })
}
