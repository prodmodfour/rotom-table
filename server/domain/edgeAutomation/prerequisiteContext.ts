import abilitiesJson from '~~/data/reference/abilities.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { parseCapabilityLabel } from '#shared/capabilityAutomation/catalog'
import { canonicalEdgeKey, type EdgeFamily } from '#shared/edgeAutomation/catalog'
import type { EdgePrerequisiteContext } from '#shared/edgeAutomation/prerequisites'
import { resolveSkills, resolveCapabilities, pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { parseSkillDiceRankValue } from '~/utils/skillRanks'
import { resolveEffectiveEdges } from './effectiveEdges'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'

interface AbilityReferenceRow {
  readonly name: string
  readonly effect?: string
}

const abilitiesByName = new Map(
  Object.values(abilitiesJson as Record<string, AbilityReferenceRow>)
    .map(row => [row.name.trim().toLocaleLowerCase('en-US'), row] as const),
)
const pokedexBySpecies = new Map(
  (pokedexJson as PokedexRecord[]).map(row => [row.species, row] as const),
)

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

const effectiveEdgeFacts = (
  sheet: CharacterSheet | TrainerSheet,
  family: EdgeFamily,
): {
  keys: ReadonlySet<string>
  choices: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
} => {
  const effective = resolveEffectiveEdges({ ownerId: sheet.slug, family, sheet })
  const keys = new Set<string>()
  const choices = new Map<string, Map<string, Set<string>>>()
  for (const instance of effective.instances) {
    if (!instance.effective) continue
    const key = canonicalEdgeKey(instance.family, instance.canonicalId)
    keys.add(key)
    const byChoice = choices.get(key) ?? new Map<string, Set<string>>()
    for (const selection of instance.instance.choices) {
      const values = byChoice.get(selection.choiceId) ?? new Set<string>()
      selection.values.forEach(value => values.add(value))
      byChoice.set(selection.choiceId, values)
    }
    choices.set(key, byChoice)
  }
  return { keys, choices }
}

const trainerFeatureTags = (sheet: TrainerSheet): ReadonlySet<string> => new Set(
  resolvedSheetFeatureClosure(sheet)
    .flatMap(instance => {
      const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(instance.canonicalId)
      return [...(manifest?.tags ?? []), ...(manifest?.roles.includes('class-anchor') ? [instance.canonicalId] : [])]
    }),
)

const pokemonCapabilityIds = (sheet: CharacterSheet): ReadonlySet<string> => {
  const resolved = resolveCapabilities(sheet)
  const labels = [
    ...resolved.rows.map(row => row.label),
    ...resolved.other,
  ]
  const ids = new Set<string>()
  for (const label of labels) {
    const parsed = parseCapabilityLabel(label)
    if (parsed.canonicalId) ids.add(parsed.canonicalId)
    else ids.add(label.trim())
  }
  return ids
}

const pokemonAbilityKeywords = (sheet: CharacterSheet): ReadonlySet<string> => {
  const keywords = new Set<string>()
  for (const ability of sheet.abilities ?? []) {
    const reference = abilitiesByName.get(normalized(ability.name))
    const effect = reference?.effect ?? ability.effect ?? ''
    if (/\bConnection\b/i.test(effect)) keywords.add('Connection')
  }
  return keywords
}

export interface BuildEdgePrerequisiteContextOptions {
  /** Server-derived permissions supplied by the current owner/team authority. */
  readonly ownerProviderIds?: ReadonlySet<string>
}

/** Build prerequisite evidence exclusively from authoritative sheet/reference facts. */
export const buildTrainerEdgePrerequisiteContext = (
  sheet: TrainerSheet,
  options: BuildEdgePrerequisiteContextOptions = {},
): EdgePrerequisiteContext => {
  const edgeFacts = effectiveEdgeFacts(sheet, 'trainer')
  return Object.freeze({
    level: Math.max(1, Math.floor(sheet.level ?? 1)),
    skillRanks: Object.freeze(Object.fromEntries(resolveTrainerSkills(sheet).map(skill => [skill.key, skill.rankValue]))),
    effectiveEdgeKeys: edgeFacts.keys,
    edgeChoices: edgeFacts.choices,
    featureTags: trainerFeatureTags(sheet),
    capabilityIds: new Set<string>(),
    abilityKeywords: new Set<string>(),
    statPoints: Object.freeze({}),
    pokemonClassifications: new Set<string>(),
    ownerProviderIds: options.ownerProviderIds ?? new Set<string>(),
  })
}

/** Build Poké Edge prerequisites from the Pokémon and app-owned Pokédex row. */
export const buildPokeEdgePrerequisiteContext = (
  sheet: CharacterSheet,
  options: BuildEdgePrerequisiteContextOptions = {},
): EdgePrerequisiteContext => {
  const edgeFacts = effectiveEdgeFacts(sheet, 'poke')
  const species = pokedexBySpecies.get(sheet.species)
  const classifications = new Set<string>()
  if (pokemonHasResolvedCapability(sheet, 'Underdog')) classifications.add('underdog')
  return Object.freeze({
    level: Math.max(1, Math.floor(sheet.level ?? 1)),
    skillRanks: Object.freeze(Object.fromEntries(resolveSkills(sheet).map(skill => [skill.key, parseSkillDiceRankValue(skill.value)]))),
    effectiveEdgeKeys: edgeFacts.keys,
    edgeChoices: edgeFacts.choices,
    featureTags: new Set<string>(),
    capabilityIds: pokemonCapabilityIds(sheet),
    abilityKeywords: pokemonAbilityKeywords(sheet),
    statPoints: Object.freeze({
      hp: sheet.stats?.hp?.added ?? 0,
      atk: sheet.stats?.atk?.added ?? 0,
      def: sheet.stats?.def?.added ?? 0,
      satk: sheet.stats?.satk?.added ?? 0,
      sdef: sheet.stats?.sdef?.added ?? 0,
      spd: sheet.stats?.spd?.added ?? 0,
    }),
    pokemonClassifications: classifications,
    ownerProviderIds: options.ownerProviderIds ?? new Set<string>(),
    // Reading the row here deliberately makes missing species data fail closed
    // in acquisition-specific validators rather than inventing classifications.
    ...(species ? {} : { pokemonClassifications: new Set<string>() }),
  })
}
