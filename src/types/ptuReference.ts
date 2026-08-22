/**
 * PTU reference-data shapes mirrored from Rotom Table's app-owned `data/reference/*.json`.
 *
 * Each JSON file is a dict keyed by name; we expose them as both the canonical
 * dict and a sorted array of records via ``data/ptuReference.ts``.
 */

export interface PtuAbility {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
  bonus?: string
}

export type PtuMoveContestIdentity =
  | {
      schemaVersion: 1
      status: 'defined'
      typeId: 'beauty' | 'cool' | 'cute' | 'smart' | 'tough'
      effectId: string
      typeLabel: string
      effectLabel: string
      tags: string[]
      source: string
      sourceSha256: string
      reviewedMigrationId: string
    }
  | {
      schemaVersion: 1
      status: 'unavailable'
      reasonCode: string
      safeReason: string
      reviewedMigrationId: string
    }

export interface PtuMove {
  name: string
  type: string
  frequency?: string
  ac?: number | null
  damage_base?: number | null
  damage_roll?: string | null
  damage_class?: 'Physical' | 'Special' | 'Status' | string
  range?: string
  effect?: string
  special?: string
  /** Reviewed structured Contest identity. Free-form legacy Contest text is not authoritative. */
  contest?: PtuMoveContestIdentity
}

export interface PtuManeuver {
  name: string
  category: string
  action?: string
  ac?: number | null
  maneuver_class?: 'Physical' | 'Special' | 'Status' | string
  range?: string
  trigger?: string
  effect?: string
  special?: string
  aliases?: string[]
  source?: string
}

export interface PtuCapability {
  name: string
  effect?: string
  source?: string
}

export interface PtuItem {
  name: string
  categories: string[]
  effects: string[]
  costs: string[]
  sections: string[]
  aliases: string[]
  notes: string[]
  source: string
}

export interface PtuCondition {
  name: string
  category: string
  effect?: string
  aliases?: string[]
  source?: string
}

export type PtuStatPointFormulaKey = 'pokemonAdded' | 'trainerLevelUp' | 'trainerTotalAtLevel'

export interface PtuLevelOffsetFormula {
  kind: 'levelOffset'
  offset: number
  min?: number
  minLevel?: number
  maxLevel?: number
}

export interface PtuItemAdvancementMechanicsV1 {
  schemaVersion: number
  vitaminLifetimeLimit: number
  statVitamins: {
    'HP Up': string
    Protein: string
    Iron: string
    Calcium: string
    Zinc: string
    Carbos: string
  }
  heartBooster: {
    lifetimeLimit: number
    tutorPoints: number
  }
  ppUp: {
    lifetimeLimit: number
    atWillPolicy: string
    eotResult: string
    repeatableFrequencies: string[]
    additionalUses: number
  }
  rareCandy: {
    lifetimeLimit: number
    maximumLevel: number
    experienceResult: string
  }
  statSuppressants: {
    baseStatDelta: number
    minimumBaseStat: number
    consent: string
  }
}

export interface PtuItemEvolutionTransitionV1 {
  itemId: string
  fromSpecies: string
  toSpecies: string
  minimumLevel: number
  requiredGender: 'Male' | 'Female' | null
}

export interface PtuItemEvolutionMechanicsV1 {
  schemaVersion: number
  actorKind: 'trainer'
  targetKind: 'owned-pokemon'
  timing: 'confirmed-instant'
  consumptionQuantity: number
  consumptionPhase: 'accepted-use'
  identityPolicy: 'retain-sheet-character-and-ownership-identity'
  statPolicy: 'unallocate-added-points-then-owner-restat'
  abilityPolicy: 'map-current-canonical-abilities-by-tier-and-slot'
  movePolicy: 'retain-current-moves-and-create-bounded-opportunity-attention'
  skillsCapabilitiesPolicy: 'adopt-destination-canonical-defaults-and-preserve-explicit-overrides'
  equipmentPolicy: 'reconcile-current-equipment-against-destination-species'
  transitionCount: number
  transitions: PtuItemEvolutionTransitionV1[]
}

export interface PtuItemFormChangeRecordV1 {
  formId: string
  baseSpeciesId: string
  displayName: string
  /** Null retains the base species Types. */
  types: PtuTypeName[] | null
  abilityId: string
  statDeltas: Record<'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>
  requiresMegaStone: boolean
}

export interface PtuItemFormChangeMechanicsV1 {
  schemaVersion: number
  triggerKind: 'mega-evolution'
  ringItemId: 'Mega Ring'
  stoneItemId: 'Mega Stone'
  timing: 'swift-action-on-trainer-or-pokemon-turn'
  duration: 'scene'
  trainerSceneLimit: number
  hpPolicy: 'unchanged'
  statPolicy: 'add-reviewed-non-hp-deltas-to-effective-stats'
  typePolicy: 'replace-only-when-form-record-declares-types'
  abilityPolicy: 'add-reviewed-ability-or-select-distinct-natural-ability-on-duplicate'
  identityPolicy: 'retain-sheet-character-history-and-customization'
  sourcePolicy: 'active-matching-ring-and-form-bound-stone-or-reviewed-delta-exception'
  sourceLossPolicy: 'accepted-scene-form-survives-suppression-and-stone-is-removal-locked'
  reversalPolicy: 'automatic-at-scene-end'
  persistentFormPolicy: 'supported-by-state-model-but-no-reviewed-item-trigger'
  formCount: number
  forms: PtuItemFormChangeRecordV1[]
}

export interface PtuItemExplorationMechanicsV1 {
  schemaVersion: number
  actorKind: 'trainer'
  bait: {
    canonicalId: 'Bait'
    consumptionQuantity: 1
    routeLure: {
      checkIntervalMinutes: 15
      successMinimum: 15
      maximumAttempts: 3
      dieSides: 20
      encounterSelection: 'gm-comparable-party-level'
    }
    wildDistraction: {
      timing: 'standard-action'
      target: 'exact-wild-pokemon'
      focusDc: 12
      failureConsequence: 'forfeit-next-standard-action'
    }
  }
  fishingLure: {
    canonicalId: 'Fishing Lure'
    routeLureMechanics: 'same-as-bait'
    reusable: true
    lossPolicy: 'never-automatic-bounded-gm-adjudication'
  }
  honey: {
    canonicalId: 'Honey'
    snackMechanicsRetained: true
    baitMechanics: 'same-as-bait'
  }
  repels: Array<{
    canonicalId: 'Repel' | 'Super Repel' | 'Max Repel'
    durationMinutes: 60 | 120 | 300
    maximumAffectedWildLevel: 15 | 25 | 35
  }>
  repelDirect: {
    timing: 'standard-action'
    target: 'exact-wild-pokemon-at-or-below-item-level'
    accuracyCheck: { baseAc: 6, attackClass: 'status', evasion: 'speed' }
    hitConsequence: {
      movement: 'immediate-interrupt-shift-away-as-far-as-able'
      nextAction: 'forfeit-next-shift-action'
      positioningAuthority: 'bounded-gm-prompt-after-server-owned-hit'
    }
  }
  dowsingRod: {
    canonicalId: 'Dowsing Rod'
    searchMinutes: 10
    allowedAreas: Array<'route' | 'cave' | 'outside'>
    dailyUses: 'floor-occult-education-rank-divided-by-two'
    baseDice: 'occult-education-rank-d6'
    terrainBonusDice: 1
    terrainKinds: Array<'beach' | 'cave' | 'desert' | 'sandy-or-rocky'>
    skillStuntDowsingBonusDice: 1
    crystalResonanceBonusDice: 3
    successMinimum: 4
    rerollOn: 6
    shardColors: Array<'Red' | 'Orange' | 'Yellow' | 'Green' | 'Blue' | 'Violet'>
    areaAuthority: 'bounded-gm-confirmation'
  }
}

export interface PtuItemMoveLearningMechanicsV1 {
  schemaVersion: number
  actorKind: 'trainer'
  targetKind: 'owned-pokemon'
  learningMinutes: number
  activeMoveMaximum: number
  clusterMindAdditionalSlots: number
  machineTutorMoveMaximum: number
  tutorPointCost: number
  replacementOfCountedMachineTutorMoveCost: number
  tm: {
    reusable: false
    consumptionQuantity: number
    consumptionPhase: 'extended-action-completion'
  }
  hm: {
    reusable: true
    usesPerCampaignDay: number
    consumptionQuantity: 0
  }
  naturalization: 'current-level-up-opportunity-does-not-count'
}

export interface PtuRule {
  name: string
  category: string
  text?: string
  aliases?: string[]
  source?: string
  statPointFormulas?: Partial<Record<PtuStatPointFormulaKey, PtuLevelOffsetFormula>>
  /** Reviewed structured authority for permanent item advancement; never inferred from text. */
  itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1
  /** Reviewed structured authority for TM/HM Move learning; never inferred from text. */
  itemMoveLearningMechanics?: PtuItemMoveLearningMechanicsV1
  /** Reviewed structured authority for item-driven permanent evolution; never inferred from text. */
  itemEvolutionMechanics?: PtuItemEvolutionMechanicsV1
  /** Reviewed structured authority for temporary/persistent item-driven forms; never inferred from text. */
  itemFormChangeMechanics?: PtuItemFormChangeMechanicsV1
  /** Reviewed structured authority for bait, Repels, and exploration tools; never inferred from text. */
  itemExplorationMechanics?: PtuItemExplorationMechanicsV1
}

/**
 * A trainer Feature entry shaped from PTU Skills/Edges/Features and Trainer
 * Classes source material (plus errata patches). Class Features are
 * marked by the ``Class`` tag; Branching Classes additionally carry ``Branch``.
 */
export interface PtuFeature {
  name: string
  /** Bracketed tags from the source: ``Class``, ``Orders``, ``Training``,
   *  ``Branch``, ``Stratagem``, ``Weapon``, ``Ranked X``, ``+HP`` etc. */
  tags: string[]
  prerequisites?: string | null
  /** ``Static``, ``At-Will – Free Action``, ``Drain 1 AP – Extended Action``… */
  frequency?: string | null
  trigger?: string | null
  target?: string | null
  condition?: string | null
  effect?: string | null
  /** Typed recipe metadata repaired from parser-merged source fields. */
  cost?: string
  ingredients?: string | string[]
  /** For class features, the parent Trainer Class name (matches a ``Class``-
   *  tagged feature). */
  className?: string
}

/**
 * A trainer Edge — a smaller character-building unit than a Feature, with
 * just Prereqs + Effect (and no Frequency/Action line).
 */
export interface PtuEdge {
  name: string
  tags: string[]
  prerequisites?: string | null
  frequency?: string | null
  trigger?: string | null
  target?: string | null
  condition?: string | null
  effect?: string | null
}

/** A Pokémon-type tag string used for pill colouring on move/pokedex pages. */
export type PtuTypeName =
  | 'Normal' | 'Fighting' | 'Flying' | 'Poison' | 'Ground' | 'Rock'
  | 'Bug' | 'Ghost' | 'Steel' | 'Fire' | 'Water' | 'Grass'
  | 'Electric' | 'Psychic' | 'Ice' | 'Dragon' | 'Dark' | 'Fairy'

/** A trainer Skill key as used by the trainer sheet. */
export type PtuSkillKey =
  | 'acrobatics' | 'athletics' | 'charm' | 'combat' | 'command'
  | 'generalEd' | 'medicineEd' | 'occultEd' | 'pokeEd' | 'techEd'
  | 'focus' | 'guile' | 'intimidate' | 'intuition'
  | 'perception' | 'stealth' | 'survival'
