/**
 * Serializes an accepted onboarding snapshot into ordinary runtime sheet
 * documents (P9-039/P9-040/P9-050). The result is a normal TrainerSheet and
 * normal CharacterSheets — no onboarding-only mechanical fields survive.
 */

import type { OnboardingCreationCatalog } from '#shared/onboarding/catalog'
import {
  ONBOARDING_STAT_KEYS,
  type OnboardingDraftV1,
  type OnboardingPokemonBuildV1,
  type OnboardingStatKey,
} from '#shared/onboarding/draft'
import type { CampaignOnboardingPolicyContentV1 } from '#shared/onboarding/policy'

export interface SerializedOnboardingSheets {
  readonly trainerDocument: Record<string, unknown>
  readonly pokemonDocuments: readonly { readonly buildId: string, readonly document: Record<string, unknown> }[]
  readonly startingMoney: number
}

const TRAINER_BASE: Record<OnboardingStatKey, number> = {
  hp: 10, atk: 5, def: 5, satk: 5, sdef: 5, spd: 5,
}

export const resolveOnboardingStartingMoney = (
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
): number => (
  policy.trainer.startingMoney.kind === 'explicit'
    ? policy.trainer.startingMoney.amount
    : catalog.trainer.startingMoney.recommendedDefault
)

export const resolveOnboardingStartingLoyalty = (
  policy: CampaignOnboardingPolicyContentV1,
  catalog: OnboardingCreationCatalog,
): number => (
  policy.pokemon.startingLoyalty.kind === 'explicit'
    ? policy.pokemon.startingLoyalty.value
    : catalog.pokemon.startingLoyalty.defaultValue
)

export const serializeOnboardingCharacterPackage = (input: {
  readonly snapshot: OnboardingDraftV1
  readonly policy: CampaignOnboardingPolicyContentV1
  readonly catalog: OnboardingCreationCatalog
  readonly trainerSlug: string
  readonly pokemonSlugs: ReadonlyMap<string, string>
  readonly trainerFolder: string
  readonly pokemonFolder: string
}): SerializedOnboardingSheets => {
  const { snapshot, policy, catalog } = input
  const build = snapshot.trainerBuild
  const level = policy.trainer.startingLevel

  /* Trainer stats: base floor + creation allocation (+ milestone immediates in advancement rows). */
  const stats: Record<string, { base: number, levelUp: number }> = {}
  for (const key of ONBOARDING_STAT_KEYS) {
    stats[key] = { base: TRAINER_BASE[key], levelUp: build.statAllocation[key] }
  }

  const advancement = build.milestoneChoices
    .filter(choice => choice.optionId === 'attack-special-attack')
    .map(choice => ({
      level: choice.level,
      attack: choice.immediateAllocation.atk ?? 0,
      spAttack: choice.immediateAllocation.satk ?? 0,
    }))
    .filter(row => row.attack > 0 || row.spAttack > 0)

  /* Milestone immediate points also live in the Lvl-Up columns for combat math. */
  for (const choice of build.milestoneChoices) {
    for (const key of ONBOARDING_STAT_KEYS) {
      const bonus = choice.immediateAllocation[key] ?? 0
      if (bonus > 0) stats[key]!.levelUp += bonus
    }
  }

  const classes = build.features
    .filter(feature => feature.isClassAnchor)
    .map(feature => ({ name: feature.canonicalId }))

  const features = build.features.map(feature => ({
    name: feature.canonicalId,
    ...(Object.keys(feature.choices).length > 0 ? { choices: { ...feature.choices } } : {}),
  }))

  const edges = build.edges.map((edge) => {
    const entry: Record<string, unknown> = { name: edge.canonicalId }
    const choices = { ...edge.choices }
    if (edge.canonicalId === 'Basic Skills' && choices.skill) {
      entry.basicSkill = choices.skill
      delete choices.skill
    }
    if (Object.keys(choices).length > 0) entry.choices = choices
    return entry
  })

  const inventory: Record<string, { name: string, qty: number }[]> = {}
  for (const grant of policy.packages.trainerItems) {
    const section = inventory[grant.section] ?? []
    section.push({ name: grant.itemId, qty: grant.quantity })
    inventory[grant.section] = section
  }

  const startingMoney = resolveOnboardingStartingMoney(policy, catalog)

  const orderedTeam = [...snapshot.pokemonBuilds]
    .sort((left, right) => (left.teamSlot ?? 99) - (right.teamSlot ?? 99))
    .map(entry => input.pokemonSlugs.get(entry.buildId))
    .filter((slug): slug is string => typeof slug === 'string')

  const trainerDocument: Record<string, unknown> = {
    slug: input.trainerSlug,
    folder: input.trainerFolder,
    name: build.name ?? 'New Trainer',
    level,
    money: startingMoney,
    ...(build.identity.playedBy ? { playedBy: build.identity.playedBy } : {}),
    ...(build.identity.age ? { age: build.identity.age } : {}),
    ...(build.identity.sex ? { sex: build.identity.sex } : {}),
    ...(build.identity.portraitUrl ? { portraitUrl: build.identity.portraitUrl } : {}),
    ...(build.identity.accentColor ? { accentColor: build.identity.accentColor } : {}),
    ...(build.identity.physicalDescription ? { physicalDescription: build.identity.physicalDescription } : {}),
    ...(build.identity.background ? { background: build.identity.background } : {}),
    ...(build.identity.personality ? { personality: build.identity.personality } : {}),
    ...(build.identity.goalsAndDreams ? { goalsAndDreams: build.identity.goalsAndDreams } : {}),
    stats,
    ...(advancement.length > 0 ? { advancement } : {}),
    skillBackground: build.background
      ? {
          name: build.background.name,
          adept: [...build.background.adept],
          novice: [...build.background.novice],
          pathetic: [...build.background.pathetic],
        }
      : {},
    ...(build.trainingFeatureId ? { trainingFeature: build.trainingFeatureId } : {}),
    classes,
    features,
    edges,
    remainingFeatures: 0,
    remainingEdges: 0,
    ...(Object.keys(inventory).length > 0 ? { inventory } : {}),
    currentTeam: orderedTeam,
    boxedPokemon: [],
  }

  const loyalty = resolveOnboardingStartingLoyalty(policy, catalog)

  const pokemonDocuments = snapshot.pokemonBuilds.map((pokemonBuild) => ({
    buildId: pokemonBuild.buildId,
    document: serializePokemonDocument({
      build: pokemonBuild,
      policy,
      catalog,
      slug: input.pokemonSlugs.get(pokemonBuild.buildId)!,
      folder: input.pokemonFolder,
      loyalty,
    }),
  }))

  return { trainerDocument, pokemonDocuments, startingMoney }
}

const serializePokemonDocument = (input: {
  readonly build: OnboardingPokemonBuildV1
  readonly policy: CampaignOnboardingPolicyContentV1
  readonly catalog: OnboardingCreationCatalog
  readonly slug: string
  readonly folder: string
  readonly loyalty: number
}): Record<string, unknown> => {
  const { build, policy, catalog } = input
  const level = policy.pokemon.starterLevel
  const species = build.speciesId ? catalog.species.get(build.speciesId) ?? null : null

  const stats: Record<string, { added: number }> = {}
  for (const key of ONBOARDING_STAT_KEYS) {
    stats[key] = { added: build.addedStats[key] }
  }

  const caughtBall = policy.pokemon.caughtBallPolicy === 'standard-metadata'
    ? 'Basic Ball'
    : policy.pokemon.caughtBallPolicy === 'player-choice'
      ? build.caughtBallId ?? undefined
      : undefined

  return {
    slug: input.slug,
    folder: input.folder,
    nickname: build.nickname ?? build.speciesId ?? 'New Pokémon',
    species: build.speciesId ?? '',
    level,
    ...(catalog.pokemon.experienceForLevel(level) !== null
      ? { totalExp: catalog.pokemon.experienceForLevel(level)! }
      : {}),
    ...(species?.genderless === true ? { gender: 'Genderless' } : build.gender ? { gender: build.gender } : {}),
    ...(build.natureId ? { nature: build.natureId } : {}),
    loyalty: input.loyalty,
    ...(caughtBall ? { caughtBall } : {}),
    stats,
    abilities: build.abilityIds.map(name => ({ name })),
    movelist: build.moveIds.map(name => ({ name })),
    ...(build.heldItemId ? { items: { held: build.heldItemId } } : {}),
  }
}
