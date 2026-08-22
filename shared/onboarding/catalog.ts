/**
 * Canonical character-creation catalog (P9-015).
 *
 * Compiles reviewed Trainer and Pokémon creation rules from app-owned
 * `data/reference/*.json` (plus automation directories) into one
 * deterministic, versioned, frozen catalog with source fingerprints,
 * legal ranges, choice cardinality, and explicit campaign-policy extension
 * points. Missing or malformed structured authority fails closed at build.
 */

import pokedexJson from '../../data/reference/pokedex.json'
import featuresJson from '../../data/reference/features.json'
import edgesJson from '../../data/reference/edges.json'
import itemsJson from '../../data/reference/items.json'
import movesJson from '../../data/reference/moves.json'
import abilitiesJson from '../../data/reference/abilities.json'
import rulesJson from '../../data/reference/rules.json'
import experienceChartJson from '../../data/reference/pokemonExperienceChart.json'
import classDirectoryJson from '../../data/feature-automation/class-directory.json'
import { PTU_NATURE_CHART, type PtuNatureChartEntry } from '../ruleset/natures'
import { ONBOARDING_STAT_KEYS, type OnboardingStatKey } from './draft'

export const ONBOARDING_CATALOG_SCHEMA_VERSION = 1 as const

export class OnboardingCatalogError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingCatalogError'
    this.field = field
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic fingerprinting (drift detection, not security)       */
/* ------------------------------------------------------------------ */

/** FNV-1a 64-bit over the UTF-16 code units of a deterministic string. */
export const onboardingFnv1a64 = (input: string): string => {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

export const onboardingStableFingerprint = (value: unknown): string =>
  onboardingFnv1a64(JSON.stringify(sortValue(value)))

/* ------------------------------------------------------------------ */
/* Structured mechanics (fail closed)                                 */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireRecord = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) throw new OnboardingCatalogError(field, `${field} is missing or not an object; canonical authority is required`)
  return value
}

const requireInt = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new OnboardingCatalogError(field, `${field} must be an integer`)
  }
  return value
}

const requireStringArray = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new OnboardingCatalogError(field, `${field} must be a string array`)
  }
  return value as string[]
}

const requireIntArray = (value: unknown, field: string): readonly number[] => {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'number' || !Number.isInteger(entry))) {
    throw new OnboardingCatalogError(field, `${field} must be an integer array`)
  }
  return value as number[]
}

export interface OnboardingTrainerEntitlements {
  readonly maximumLevel: number
  readonly paidFeaturesAtLevelOne: number
  readonly paidFeatureEveryOddLevelFrom: number
  readonly freeTrainingAtLevelOne: number
  readonly freeTrainingFeatureIds: readonly string[]
  readonly maximumClassFeatures: number
  readonly edgesAtLevelOne: number
  readonly edgeEveryEvenLevelFrom: number
  readonly bonusSkillEdgeLevels: readonly number[]
  readonly skillEdgeIds: readonly string[]
}

export interface OnboardingSkillRankMaximum {
  readonly level: number
  readonly rank: string
  readonly backgroundException: string | null
}

export interface OnboardingMilestoneOption {
  readonly id: string
  readonly immediatePoints?: number
  readonly scheduledEvenLevels?: readonly number[]
  readonly edgeSlots?: number
  readonly featureSlots?: number
}

export interface OnboardingMilestone {
  readonly level: number
  readonly options: readonly OnboardingMilestoneOption[]
}

export interface OnboardingBackgroundMechanics {
  readonly adeptPicks: number
  readonly novicePicks: number
  readonly patheticPicks: number
  readonly distinctSkillsRequired: boolean
  readonly patheticFloorLockedDuringCreation: boolean
}

export interface OnboardingMoneyMechanics {
  readonly recommendedDefault: number
  readonly policyOverridable: boolean
}

export interface OnboardingLoyaltyMechanics {
  readonly defaultValue: number
  readonly minimum: number
  readonly maximum: number
  readonly policyOverridable: boolean
}

export interface OnboardingAbilityMilestone {
  readonly level: number
  readonly ordinal: number
  readonly tiers: readonly string[]
}

/* ------------------------------------------------------------------ */
/* Species records                                                    */
/* ------------------------------------------------------------------ */

export type OnboardingSpeciesIneligibleReason =
  | 'missing-base-stats'
  | 'missing-basic-abilities'
  | 'missing-level-up-moves'

export interface OnboardingSpeciesRecord {
  readonly speciesId: string
  readonly fingerprint: string
  readonly eligible: boolean
  readonly ineligibleReasons: readonly OnboardingSpeciesIneligibleReason[]
  readonly stage: number | null
  readonly types: readonly string[]
  readonly genderless: boolean
  readonly malePct: number | null
  readonly baseStats: Readonly<Record<OnboardingStatKey, number>> | null
  readonly basicAbilities: readonly string[]
  readonly advancedAbilities: readonly string[]
  readonly highAbilities: readonly string[]
  readonly levelUpMoves: readonly { readonly level: number, readonly name: string }[]
  readonly skills: Readonly<Record<string, string>>
  readonly capabilities: UnknownRecord | null
}

export interface OnboardingFeatureRecord {
  readonly canonicalId: string
  readonly tags: readonly string[]
  readonly className: string | null
  readonly isClass: boolean
  readonly prerequisitesText: string | null
}

export interface OnboardingEdgeRecord {
  readonly canonicalId: string
  readonly tags: readonly string[]
  readonly isSkillEdge: boolean
  readonly prerequisitesText: string | null
}

export interface OnboardingClassRecord {
  readonly className: string
  readonly anchorCanonicalId: string
  readonly memberCanonicalIds: readonly string[]
}

export interface OnboardingCreationCatalog {
  readonly schemaVersion: typeof ONBOARDING_CATALOG_SCHEMA_VERSION
  readonly catalogFingerprint: string
  readonly sourceFingerprints: readonly { readonly source: string, readonly fnv64: string }[]
  readonly trainer: {
    readonly entitlements: OnboardingTrainerEntitlements
    readonly skillRankMaximums: readonly OnboardingSkillRankMaximum[]
    readonly milestones: readonly OnboardingMilestone[]
    readonly background: OnboardingBackgroundMechanics
    readonly startingMoney: OnboardingMoneyMechanics
    readonly statBudget: (level: number) => number
    readonly paidFeatureSlots: (level: number) => number
    readonly edgeSlots: (level: number) => number
    readonly bonusSkillEdgeSlots: (level: number) => number
    readonly milestonesForLevel: (level: number) => readonly OnboardingMilestone[]
  }
  readonly pokemon: {
    readonly addedStatBudget: (level: number) => number
    readonly activeMoveMaximum: number
    readonly abilityMilestones: readonly OnboardingAbilityMilestone[]
    readonly abilityOrdinalsForLevel: (level: number) => readonly OnboardingAbilityMilestone[]
    readonly startingLoyalty: OnboardingLoyaltyMechanics
    readonly tutorPoints: (level: number) => number
    readonly experienceForLevel: (level: number) => number | null
  }
  readonly species: ReadonlyMap<string, OnboardingSpeciesRecord>
  readonly features: ReadonlyMap<string, OnboardingFeatureRecord>
  readonly edges: ReadonlyMap<string, OnboardingEdgeRecord>
  readonly classes: ReadonlyMap<string, OnboardingClassRecord>
  readonly natures: ReadonlyMap<string, PtuNatureChartEntry>
  readonly items: ReadonlySet<string>
  readonly moves: ReadonlySet<string>
  readonly abilities: ReadonlySet<string>
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

const POKEDEX_STAT_KEY: Record<OnboardingStatKey, string> = {
  hp: 'hp', atk: 'atk', def: 'def', satk: 'spatk', sdef: 'spdef', spd: 'spd',
}

const levelOffsetBudget = (formula: UnknownRecord, field: string): (level: number) => number => {
  if (formula.kind !== 'levelOffset') {
    throw new OnboardingCatalogError(field, `${field}.kind must be levelOffset`)
  }
  const offset = requireInt(formula.offset, `${field}.offset`)
  const minLevel = requireInt(formula.minLevel, `${field}.minLevel`)
  const maxLevel = requireInt(formula.maxLevel, `${field}.maxLevel`)
  return (level: number): number => {
    if (!Number.isInteger(level) || level < minLevel || level > maxLevel) {
      throw new OnboardingCatalogError(field, `level ${level} is outside ${minLevel}..${maxLevel}`)
    }
    return level + offset
  }
}

let cachedCatalog: OnboardingCreationCatalog | null = null

export const buildOnboardingCreationCatalog = (): OnboardingCreationCatalog => {
  const rules = rulesJson as Record<string, UnknownRecord>

  const advancementRule = requireRecord(rules['Trainer Advancement Choices'], 'rules.Trainer Advancement Choices')
  const mechanics = requireRecord(advancementRule.trainerAdvancementChoiceMechanics, 'trainerAdvancementChoiceMechanics')
  const featureEntitlements = requireRecord(mechanics.featureEntitlements, 'trainerAdvancementChoiceMechanics.featureEntitlements')
  const edgeEntitlements = requireRecord(mechanics.edgeEntitlements, 'trainerAdvancementChoiceMechanics.edgeEntitlements')

  const statRule = requireRecord(rules['Stat Point Advancement'], 'rules.Stat Point Advancement')
  const statFormulas = requireRecord(statRule.statPointFormulas, 'statPointFormulas')

  const pokemonRule = requireRecord(rules['Pokémon Advancement Choices'], 'rules.Pokémon Advancement Choices')
  const pokemonMechanics = requireRecord(pokemonRule.pokemonAdvancementChoiceMechanics, 'pokemonAdvancementChoiceMechanics')
  const moveLearning = requireRecord(pokemonMechanics.moveLearning, 'pokemonAdvancementChoiceMechanics.moveLearning')

  const creationRule = requireRecord(rules['Character Creation'], 'rules.Character Creation')
  const creationMechanics = requireRecord(creationRule.characterCreationMechanics, 'characterCreationMechanics')
  const backgroundMechanics = requireRecord(creationMechanics.background, 'characterCreationMechanics.background')
  const moneyMechanics = requireRecord(creationMechanics.startingMoney, 'characterCreationMechanics.startingMoney')
  const loyaltyMechanics = requireRecord(creationMechanics.startingLoyalty, 'characterCreationMechanics.startingLoyalty')

  const entitlements: OnboardingTrainerEntitlements = {
    maximumLevel: requireInt(mechanics.maximumLevel, 'maximumLevel'),
    paidFeaturesAtLevelOne: requireInt(featureEntitlements.paidAtLevelOne, 'featureEntitlements.paidAtLevelOne'),
    paidFeatureEveryOddLevelFrom: requireInt(featureEntitlements.paidEveryOddLevelFrom, 'featureEntitlements.paidEveryOddLevelFrom'),
    freeTrainingAtLevelOne: requireInt(featureEntitlements.freeTrainingAtLevelOne, 'featureEntitlements.freeTrainingAtLevelOne'),
    freeTrainingFeatureIds: requireStringArray(featureEntitlements.freeTrainingFeatureIds, 'featureEntitlements.freeTrainingFeatureIds'),
    maximumClassFeatures: requireInt(featureEntitlements.maximumClassFeatures, 'featureEntitlements.maximumClassFeatures'),
    edgesAtLevelOne: requireInt(edgeEntitlements.atLevelOne, 'edgeEntitlements.atLevelOne'),
    edgeEveryEvenLevelFrom: requireInt(edgeEntitlements.everyEvenLevelFrom, 'edgeEntitlements.everyEvenLevelFrom'),
    bonusSkillEdgeLevels: requireIntArray(edgeEntitlements.bonusSkillEdgeLevels, 'edgeEntitlements.bonusSkillEdgeLevels'),
    skillEdgeIds: requireStringArray(edgeEntitlements.skillEdgeIds, 'edgeEntitlements.skillEdgeIds'),
  }

  const skillRankMaximums = (mechanics.skillRankMaximums as unknown[]).map((entry, index) => {
    const record = requireRecord(entry, `skillRankMaximums[${index}]`)
    return {
      level: requireInt(record.level, `skillRankMaximums[${index}].level`),
      rank: String(record.rank),
      backgroundException: record.backgroundException === null ? null : String(record.backgroundException),
    }
  })

  const milestones = (mechanics.milestoneChoices as unknown[]).map((entry, index) => {
    const record = requireRecord(entry, `milestoneChoices[${index}]`)
    const options = (record.options as unknown[]).map((option, optionIndex) => {
      const optionRecord = requireRecord(option, `milestoneChoices[${index}].options[${optionIndex}]`)
      const out: OnboardingMilestoneOption = {
        id: String(optionRecord.id),
        ...(optionRecord.immediatePoints !== undefined ? { immediatePoints: requireInt(optionRecord.immediatePoints, 'immediatePoints') } : {}),
        ...(optionRecord.scheduledEvenLevels !== undefined ? { scheduledEvenLevels: (optionRecord.scheduledEvenLevels as unknown[]).map(value => requireInt(value, 'scheduledEvenLevels[]')) } : {}),
        ...(optionRecord.edgeSlots !== undefined ? { edgeSlots: requireInt(optionRecord.edgeSlots, 'edgeSlots') } : {}),
        ...(optionRecord.featureSlots !== undefined ? { featureSlots: requireInt(optionRecord.featureSlots, 'featureSlots') } : {}),
      }
      return out
    })
    return { level: requireInt(record.level, `milestoneChoices[${index}].level`), options }
  })

  const trainerStatBudget = levelOffsetBudget(requireRecord(statFormulas.trainerLevelUp, 'statPointFormulas.trainerLevelUp'), 'statPointFormulas.trainerLevelUp')
  const pokemonAddedBudget = levelOffsetBudget(requireRecord(statFormulas.pokemonAdded, 'statPointFormulas.pokemonAdded'), 'statPointFormulas.pokemonAdded')

  /* Species ------------------------------------------------------- */
  const species = new Map<string, OnboardingSpeciesRecord>()
  for (const rowUnknown of pokedexJson as unknown[]) {
    const row = requireRecord(rowUnknown, 'pokedex row')
    const speciesId = String(row.species ?? '').trim()
    if (!speciesId) continue
    const ineligibleReasons: OnboardingSpeciesIneligibleReason[] = []

    const rawStats = isRecord(row.base_stats) ? row.base_stats : null
    let baseStats: Record<OnboardingStatKey, number> | null = null
    if (rawStats) {
      baseStats = {} as Record<OnboardingStatKey, number>
      let complete = true
      for (const key of ONBOARDING_STAT_KEYS) {
        const value = rawStats[POKEDEX_STAT_KEY[key]]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          complete = false
          break
        }
        baseStats[key] = value
      }
      if (!complete) baseStats = null
    }
    if (!baseStats) ineligibleReasons.push('missing-base-stats')

    const abilities = isRecord(row.abilities) ? row.abilities : null
    const basicAbilities = abilities && Array.isArray(abilities.basic) ? (abilities.basic as unknown[]).map(String) : []
    const advancedAbilities = abilities && Array.isArray(abilities.advanced) ? (abilities.advanced as unknown[]).map(String) : []
    const highAbilities = abilities && Array.isArray(abilities.high) ? (abilities.high as unknown[]).map(String) : []
    if (basicAbilities.length === 0) ineligibleReasons.push('missing-basic-abilities')

    const levelUpMoves = Array.isArray(row.level_up_moves)
      ? (row.level_up_moves as unknown[]).flatMap((moveUnknown) => {
          if (!isRecord(moveUnknown)) return []
          const level = moveUnknown.level
          const name = moveUnknown.name
          if (typeof level !== 'number' || typeof name !== 'string') return []
          return [{ level, name }]
        })
      : []
    if (levelUpMoves.length === 0) ineligibleReasons.push('missing-level-up-moves')

    let stage: number | null = null
    if (Array.isArray(row.evolutions)) {
      for (const evolutionUnknown of row.evolutions as unknown[]) {
        if (!isRecord(evolutionUnknown)) continue
        if (String(evolutionUnknown.species ?? '').trim().toLocaleLowerCase() === speciesId.toLocaleLowerCase()) {
          stage = typeof evolutionUnknown.stage === 'number' ? evolutionUnknown.stage : null
          break
        }
      }
    }

    species.set(speciesId, {
      speciesId,
      fingerprint: onboardingStableFingerprint(row),
      eligible: ineligibleReasons.length === 0,
      ineligibleReasons,
      stage,
      types: Array.isArray(row.types) ? (row.types as unknown[]).map(String) : [],
      genderless: row.genderless === true,
      malePct: typeof row.male_pct === 'number' ? row.male_pct : null,
      baseStats,
      basicAbilities,
      advancedAbilities,
      highAbilities,
      levelUpMoves,
      skills: isRecord(row.skills) ? Object.fromEntries(Object.entries(row.skills).map(([key, value]) => [key, String(value)])) : {},
      capabilities: isRecord(row.capabilities) ? row.capabilities : null,
    })
  }

  /* Features, edges, classes -------------------------------------- */
  const features = new Map<string, OnboardingFeatureRecord>()
  for (const featureUnknown of Object.values(featuresJson as Record<string, unknown>)) {
    const feature = requireRecord(featureUnknown, 'feature')
    const canonicalId = String(feature.name ?? '').trim()
    if (!canonicalId) continue
    const tags = Array.isArray(feature.tags) ? (feature.tags as unknown[]).map(String) : []
    features.set(canonicalId, {
      canonicalId,
      tags,
      className: typeof feature.className === 'string' ? feature.className : null,
      isClass: tags.includes('Class'),
      prerequisitesText: typeof feature.prerequisites === 'string' ? feature.prerequisites : null,
    })
  }

  const skillEdgeIdSet = new Set(entitlements.skillEdgeIds)
  const edges = new Map<string, OnboardingEdgeRecord>()
  for (const edgeUnknown of Object.values(edgesJson as Record<string, unknown>)) {
    const edge = requireRecord(edgeUnknown, 'edge')
    const canonicalId = String(edge.name ?? '').trim()
    if (!canonicalId) continue
    edges.set(canonicalId, {
      canonicalId,
      tags: Array.isArray(edge.tags) ? (edge.tags as unknown[]).map(String) : [],
      isSkillEdge: skillEdgeIdSet.has(canonicalId),
      prerequisitesText: typeof edge.prerequisites === 'string' ? edge.prerequisites : null,
    })
  }

  const classes = new Map<string, OnboardingClassRecord>()
  const classDirectory = requireRecord(classDirectoryJson as unknown, 'class-directory')
  for (const classUnknown of classDirectory.classes as unknown[]) {
    const classRecord = requireRecord(classUnknown, 'class-directory entry')
    const className = String(classRecord.className ?? '').trim()
    if (!className) continue
    classes.set(className, {
      className,
      anchorCanonicalId: String(classRecord.anchorCanonicalId ?? className),
      memberCanonicalIds: requireStringArray(classRecord.canonicalIds, `class ${className} canonicalIds`),
    })
  }

  /* Cross-reference guards (orphans fail closed) ------------------- */
  for (const trainingId of entitlements.freeTrainingFeatureIds) {
    if (!features.has(trainingId)) {
      throw new OnboardingCatalogError('freeTrainingFeatureIds', `Training Feature "${trainingId}" is not a canonical feature`)
    }
  }
  for (const skillEdgeId of entitlements.skillEdgeIds) {
    if (!edges.has(skillEdgeId)) {
      throw new OnboardingCatalogError('skillEdgeIds', `Skill Edge "${skillEdgeId}" is not a canonical edge`)
    }
  }
  for (const classRecord of classes.values()) {
    if (!features.has(classRecord.anchorCanonicalId)) {
      throw new OnboardingCatalogError('class-directory', `class anchor "${classRecord.anchorCanonicalId}" is not a canonical feature`)
    }
  }

  /* Simple identity sets ------------------------------------------ */
  const items = new Set<string>()
  for (const itemUnknown of Object.values(itemsJson as Record<string, unknown>)) {
    if (isRecord(itemUnknown) && typeof itemUnknown.name === 'string') items.add(itemUnknown.name)
  }
  const moves = new Set<string>()
  for (const moveUnknown of Object.values(movesJson as Record<string, unknown>)) {
    if (isRecord(moveUnknown) && typeof moveUnknown.name === 'string') moves.add(moveUnknown.name)
  }
  const abilities = new Set<string>()
  for (const abilityUnknown of Object.values(abilitiesJson as Record<string, unknown>)) {
    if (isRecord(abilityUnknown) && typeof abilityUnknown.name === 'string') abilities.add(abilityUnknown.name)
  }

  const natures = new Map<string, PtuNatureChartEntry>(
    PTU_NATURE_CHART.map(nature => [nature.name, nature]),
  )

  const experienceByLevel = new Map<number, number>()
  for (const rowUnknown of experienceChartJson as unknown[]) {
    if (!isRecord(rowUnknown)) continue
    const level = rowUnknown.level
    const expNeeded = rowUnknown.expNeeded
    if (typeof level === 'number' && typeof expNeeded === 'number') experienceByLevel.set(level, expNeeded)
  }

  const abilityMilestones = (pokemonMechanics.abilityMilestones as unknown[]).map((entry, index) => {
    const record = requireRecord(entry, `abilityMilestones[${index}]`)
    return {
      level: requireInt(record.level, `abilityMilestones[${index}].level`),
      ordinal: requireInt(record.ordinal, `abilityMilestones[${index}].ordinal`),
      tiers: requireStringArray(record.tiers, `abilityMilestones[${index}].tiers`),
    }
  })

  const background: OnboardingBackgroundMechanics = {
    adeptPicks: requireInt(backgroundMechanics.adeptPicks, 'background.adeptPicks'),
    novicePicks: requireInt(backgroundMechanics.novicePicks, 'background.novicePicks'),
    patheticPicks: requireInt(backgroundMechanics.patheticPicks, 'background.patheticPicks'),
    distinctSkillsRequired: backgroundMechanics.distinctSkillsRequired === true,
    patheticFloorLockedDuringCreation: backgroundMechanics.patheticFloorLockedDuringCreation === true,
  }

  const startingMoney: OnboardingMoneyMechanics = {
    recommendedDefault: requireInt(moneyMechanics.recommendedDefault, 'startingMoney.recommendedDefault'),
    policyOverridable: moneyMechanics.policyOverridable === true,
  }

  const startingLoyalty: OnboardingLoyaltyMechanics = {
    defaultValue: requireInt(loyaltyMechanics.defaultValue, 'startingLoyalty.defaultValue'),
    minimum: requireInt(loyaltyMechanics.minimum, 'startingLoyalty.minimum'),
    maximum: requireInt(loyaltyMechanics.maximum, 'startingLoyalty.maximum'),
    policyOverridable: loyaltyMechanics.policyOverridable === true,
  }

  const sourceFingerprints = [
    { source: 'data/reference/pokedex.json', fnv64: onboardingStableFingerprint(pokedexJson) },
    { source: 'data/reference/features.json', fnv64: onboardingStableFingerprint(featuresJson) },
    { source: 'data/reference/edges.json', fnv64: onboardingStableFingerprint(edgesJson) },
    { source: 'data/reference/items.json', fnv64: onboardingStableFingerprint(itemsJson) },
    { source: 'data/reference/moves.json', fnv64: onboardingStableFingerprint(movesJson) },
    { source: 'data/reference/abilities.json', fnv64: onboardingStableFingerprint(abilitiesJson) },
    { source: 'data/reference/rules.json', fnv64: onboardingStableFingerprint(rulesJson) },
    { source: 'data/reference/pokemonExperienceChart.json', fnv64: onboardingStableFingerprint(experienceChartJson) },
    { source: 'data/feature-automation/class-directory.json', fnv64: onboardingStableFingerprint(classDirectoryJson) },
    { source: 'shared/ruleset/natures.ts#PTU_NATURE_CHART', fnv64: onboardingStableFingerprint(PTU_NATURE_CHART) },
  ]

  const paidFeatureSlots = (level: number): number => {
    let slots = entitlements.paidFeaturesAtLevelOne
    for (let at = entitlements.paidFeatureEveryOddLevelFrom; at <= level; at += 2) slots += 1
    return slots
  }
  const edgeSlots = (level: number): number => {
    let slots = entitlements.edgesAtLevelOne
    for (let at = entitlements.edgeEveryEvenLevelFrom; at <= level; at += 2) slots += 1
    return slots
  }
  const bonusSkillEdgeSlots = (level: number): number =>
    entitlements.bonusSkillEdgeLevels.filter(at => level >= at).length

  const catalogWithoutFingerprint = {
    schemaVersion: ONBOARDING_CATALOG_SCHEMA_VERSION,
    entitlements,
    skillRankMaximums,
    milestones,
    background,
    startingMoney,
    startingLoyalty,
    abilityMilestones,
    sourceFingerprints,
  }

  const catalog: OnboardingCreationCatalog = {
    schemaVersion: ONBOARDING_CATALOG_SCHEMA_VERSION,
    catalogFingerprint: onboardingStableFingerprint(catalogWithoutFingerprint),
    sourceFingerprints,
    trainer: {
      entitlements,
      skillRankMaximums,
      milestones,
      background,
      startingMoney,
      statBudget: trainerStatBudget,
      paidFeatureSlots,
      edgeSlots,
      bonusSkillEdgeSlots,
      milestonesForLevel: (level: number) => milestones.filter(milestone => milestone.level <= level),
    },
    pokemon: {
      addedStatBudget: pokemonAddedBudget,
      activeMoveMaximum: requireInt(moveLearning.activeMoveMaximum, 'moveLearning.activeMoveMaximum'),
      abilityMilestones,
      abilityOrdinalsForLevel: (level: number) => abilityMilestones.filter(milestone => milestone.level <= level),
      startingLoyalty,
      tutorPoints: (level: number) => 1 + Math.floor(Math.max(1, level) / 5),
      experienceForLevel: (level: number) => experienceByLevel.get(level) ?? null,
    },
    species,
    features,
    edges,
    classes,
    natures,
    items,
    moves,
    abilities,
  }

  return Object.freeze(catalog)
}

/** Shared singleton; deterministic for one process and data snapshot. */
export const onboardingCreationCatalog = (): OnboardingCreationCatalog => {
  if (!cachedCatalog) cachedCatalog = buildOnboardingCreationCatalog()
  return cachedCatalog
}
