import { createHash } from 'node:crypto'
import abilitiesJson from '~~/data/reference/abilities.json'
import itemsJson from '~~/data/reference/items.json'
import movesJson from '~~/data/reference/moves.json'
import pokedexJson from '~~/data/reference/pokedex.json'
import featuresJson from '~~/data/reference/features.json'
import rulesJson from '~~/data/reference/rules.json'
import specsJson from '~~/data/complete-play-loop/specs.v1.json'
import guidedAdjudicationsJson from '~~/data/complete-play-loop/guided-item-adjudications.v1.json'
import guidedCatalogItemsJson from '~~/data/complete-play-loop/guided-catalog-items.v1.json'
import type {
  PtuItem,
  PtuItemAdvancementMechanicsV1,
  PtuItemEvolutionMechanicsV1,
  PtuItemExplorationMechanicsV1,
  PtuItemMoveLearningMechanicsV1,
} from '~/types/ptuReference'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID,
} from '#shared/itemAutomation/guidedAdjudication'
import { createItemIdentityRegistry } from '#shared/itemAutomation/identity'
import {
  ITEM_SPEC_SCHEMA_VERSION,
  parseItemSpec,
  type ItemEffectSpec,
  type ItemHpRestorationSpec,
  type ItemRuntimeDefinition,
  type ItemRuntimeRegistry,
  type ItemSpecV1,
} from '#shared/itemAutomation/spec'

interface ReviewedItemEffectRow {
  readonly canonicalId: string
  readonly recordSha256: string
  readonly effectSha256: string
  readonly effect:
    | { readonly kind: 'heal-hp', readonly amount: number }
    | { readonly kind: 'heal-hp-rolled', readonly diceCount: number, readonly dieSides: number, readonly modifier: number }
    | { readonly kind: 'heal-hp-relative', readonly numerator: number, readonly denominator: number, readonly rounding: 'down' | 'up' | 'nearest', readonly minimum: number }
    | {
        readonly kind: 'remove-conditions'
        readonly conditionIds: readonly string[]
        readonly mode?: 'listed' | 'persistent' | 'volatile' | 'all-status'
        readonly selection?: 'all-applicable' | 'choose-one'
      }
    | {
        readonly kind: 'heal-and-remove'
        readonly amount: number
        readonly conditionIds: readonly string[]
        readonly mode?: 'listed' | 'persistent' | 'volatile' | 'all-status'
        readonly selection?: 'all-applicable' | 'choose-one'
      }
    | {
        readonly kind: 'revive'
        readonly amount:
          | { readonly kind: 'fixed', readonly amount: number }
          | { readonly kind: 'maximum-relative', readonly numerator: number, readonly denominator: number, readonly rounding: 'down' | 'up' | 'nearest', readonly minimum: number }
      }
    | { readonly kind: 'modify-stage', readonly stat: 'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'acc', readonly amount: number }
    | {
        readonly kind: 'temporary-combat-effect'
        readonly family: 'critical-range' | 'move-stage-reduction-immunity'
        readonly amount: number
        readonly duration: { readonly kind: 'turns' | 'encounter', readonly amount: number | null }
        readonly stackPolicy: 'replace' | 'refresh'
        readonly switchPolicy: 'expire'
      }
    | {
        readonly kind: 'store-digestion-buff'
        readonly buffKind: 'fixed-heal' | 'turn-start-heal'
        readonly amount: number
        readonly denominator: number | null
        readonly requiredPokemonType: string | null
      }
    | {
        readonly kind: 'skill-check-heal-and-remove'
        readonly skillId: 'medicineEd'
        readonly dieSides: 6
        readonly apMode: 'drain'
        readonly apAmount: 1
        readonly conditionIds: readonly string[]
      }
    | {
        readonly kind: 'apply-medical-treatment'
        readonly treatmentKind: 'bandages'
        readonly durationMinutes: 360
        readonly tickMinutes: 30
        readonly healingNumerator: 1
        readonly healingDenominator: 8
        readonly injuryAtCompletion: 1
        readonly stopOnHpLoss: true
        readonly obeyDailyInjuryLimit: true
      }
    | {
        readonly kind: 'modify-base-stat'
        readonly stat: 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd' | 'selected'
        readonly amount: -1 | 1
        readonly countsAsVitamin: boolean
        readonly requiresTrainerConsent: boolean
      }
    | {
        readonly kind: 'grant-tutor-points'
        readonly amount: 2
        readonly countsAsVitamin: true
        readonly lifetimeLimit: 1
      }
    | {
        readonly kind: 'increase-move-frequency'
        readonly countsAsVitamin: true
        readonly lifetimeLimit: 1
      }
    | {
        readonly kind: 'gain-next-level-experience'
        readonly lifetimeLimit: 5
        readonly maximumLevel: 100
      }
    | {
        readonly kind: 'learn-machine-move'
        readonly machineKind: 'TM' | 'HM'
        readonly machineNumber: string
        readonly moveId: string
        readonly tutorPointCost: 1
        readonly learningMinutes: 60
        readonly activeMoveMaximum: 6
        readonly machineTutorMoveMaximum: 3
        readonly dailyUseLimit: 1 | null
      }
    | { readonly kind: 'evolve-pokemon', readonly transitionPolicyId: string }
    | {
        readonly kind: 'use-bait'
        readonly lure: PtuItemExplorationMechanicsV1['bait']['routeLure']
        readonly distraction: PtuItemExplorationMechanicsV1['bait']['wildDistraction']
      }
    | {
        readonly kind: 'start-route-lure'
        readonly lure: PtuItemExplorationMechanicsV1['bait']['routeLure']
        readonly reusable: true
        readonly lossPolicy: PtuItemExplorationMechanicsV1['fishingLure']['lossPolicy']
      }
    | {
        readonly kind: 'use-snack-or-bait'
        readonly buffKind: 'fixed-heal'
        readonly amount: 5
        readonly denominator: null
        readonly requiredPokemonType: null
        readonly lure: PtuItemExplorationMechanicsV1['bait']['routeLure']
        readonly distraction: PtuItemExplorationMechanicsV1['bait']['wildDistraction']
      }
    | {
        readonly kind: 'use-repel'
        readonly durationMinutes: 60 | 120 | 300
        readonly maximumAffectedWildLevel: 15 | 25 | 35
        readonly directBaseAc: 6
        readonly positioningAuthority: PtuItemExplorationMechanicsV1['repelDirect']['hitConsequence']['positioningAuthority']
      }
    | {
        readonly kind: 'search-for-shards'
        readonly searchMinutes: 10
        readonly dailyUses: PtuItemExplorationMechanicsV1['dowsingRod']['dailyUses']
        readonly baseDice: PtuItemExplorationMechanicsV1['dowsingRod']['baseDice']
        readonly terrainBonusDice: 1
        readonly skillStuntDowsingBonusDice: 1
        readonly crystalResonanceBonusDice: 3
        readonly successMinimum: 4
        readonly rerollOn: 6
        readonly shardColors: PtuItemExplorationMechanicsV1['dowsingRod']['shardColors']
        readonly areaAuthority: PtuItemExplorationMechanicsV1['dowsingRod']['areaAuthority']
      }
}

interface ReviewedItemSpecsDocument {
  readonly schemaVersion: 1
  readonly catalogSha256: string
  readonly ruleEvidence: {
    readonly usingItemsRecordSha256: string
    readonly conditionCatalogSha256: string
    readonly loyaltyRecordSha256: string
    readonly repulsiveMedicinePolicy: {
      readonly items: readonly ['Energy Powder', 'Energy Root', 'Heal Powder', 'Revival Herb']
      readonly deterministicLoyaltyMutation: false
      readonly runtimeDisposition: 'fail-closed-until-gm-attention-authority'
      readonly reason: string
    }
    readonly persistentAfflictionsRecordSha256: string
    readonly otherAfflictionsRecordSha256: string
    readonly combatStagesRecordSha256: string
    readonly firstAidKitPolicy: {
      readonly actorKind: 'trainer'
      readonly skillId: 'medicineEd'
      readonly dieSides: 6
      readonly timing: 'extended'
      readonly apCost: {
        readonly mode: 'drain'
        readonly amount: 1
        readonly recovery: 'extended-rest'
      }
      readonly healingBasis: 'authoritative-skill-check-total'
      readonly conditionIds: readonly ['Burned', 'Poisoned', 'Badly Poisoned', 'Paralysis']
      readonly reusable: true
    }
    readonly bandagePolicy: {
      readonly canonicalId: 'Bandages'
      readonly naturalHealingRecordSha256: string
      readonly timing: 'extended'
      readonly durationMinutes: 360
      readonly tickMinutes: 30
      readonly healing: {
        readonly basis: 'full-formula-maximum-hp'
        readonly numerator: 1
        readonly denominator: 8
        readonly minimum: 1
        readonly blockedAtInjuries: 5
      }
      readonly injuryAtCompletion: 1
      readonly obeyDailyInjuryLimit: true
      readonly stopOnHpLoss: true
      readonly consumptionPhase: 'extended-action-completion'
    }
    readonly poulticePolicy: {
      readonly canonicalId: 'Poultices'
      readonly nativeBandageMechanicsShared: true
      readonly loyaltyConsequenceDeterministic: false
      readonly runtimeDisposition: 'fail-closed-until-guided-adjudication-P8-059'
    }
    readonly permanentAdvancementPolicy: {
      readonly ruleCanonicalId: 'Vitamins and Related Items'
      readonly ruleRecordSha256: string
      readonly timing: 'extended'
      readonly targetKind: 'pokemon'
      readonly consumptionPhase: 'extended-action-completion'
      readonly vitaminLifetimeLimit: 5
      readonly statVitamins: PtuItemAdvancementMechanicsV1['statVitamins']
      readonly heartBooster: PtuItemAdvancementMechanicsV1['heartBooster']
      readonly ppUp: PtuItemAdvancementMechanicsV1['ppUp']
      readonly rareCandy: PtuItemAdvancementMechanicsV1['rareCandy']
      readonly statSuppressants: PtuItemAdvancementMechanicsV1['statSuppressants']
      readonly sheetValidity: {
        readonly baseRelations: 'required-after-application'
        readonly statPointBudget: 'must-not-exceed'
        readonly provenance: 'server-private-immutable-application-ledger'
      }
    }
    readonly itemEvolutionPolicy: {
      readonly ruleCanonicalId: 'Evolutionary Items'
      readonly ruleRecordSha256: string
      readonly itemCount: 24
      readonly transitionCount: 62
      readonly timing: 'standard'
      readonly targetKind: 'pokemon'
      readonly consumptionPhase: 'accepted-use'
      readonly destinationChoice: 'one-authority-projected-destination'
      readonly confirmation: 'one-exact-explicit-confirmation'
      readonly provenance: 'server-private-immutable-application-ledger'
      readonly restatAttention: 'owner-visible-unallocated-stat-point-work'
      readonly moveAttention: 'owner-visible-bounded-new-form-move-opportunities'
    }
    readonly machineMoveLearningPolicy: {
      readonly ruleCanonicalId: 'TMs and HMs'
      readonly ruleRecordSha256: string
      readonly tmTutorLimitCanonicalId: '3-TM/Tutor Move Limit'
      readonly tmTutorLimitRecordSha256: string
      readonly tutorPointsCanonicalId: 'Tutor Points'
      readonly tutorPointsRecordSha256: string
      readonly pokedexMachineAuthoritySha256: string
      readonly moveLearningMoveAuthoritySha256: string
      readonly clusterMindRecordSha256: string
      readonly machineCount: 106
      readonly timing: 'extended'
      readonly targetKind: 'pokemon'
      readonly compatibilityAuthority: 'exact-species-tm_hm_moves-entry'
      readonly knownMoveAuthority: 'union-of-movelist-and-appliedMoves'
      readonly consumptionPhase: 'extended-action-completion'
      readonly reusableHmUsesPerCampaignDay: 1
      readonly replacementChoice: 'one-authority-projected-active-move-or-open-slot'
      readonly provenance: 'server-private-immutable-application-ledger'
    }
    readonly explorationItemPolicy: {
      readonly ruleCanonicalId: 'Exploration Items'
      readonly ruleRecordSha256: string
      readonly actorKind: 'trainer'
      readonly itemIds: readonly ['Bait', 'Fishing Lure', 'Honey', 'Repel', 'Super Repel', 'Max Repel', 'Dowsing Rod']
      readonly routeLure: PtuItemExplorationMechanicsV1['bait']['routeLure']
      readonly wildDistraction: PtuItemExplorationMechanicsV1['bait']['wildDistraction']
      readonly fishingLure: PtuItemExplorationMechanicsV1['fishingLure']
      readonly repels: PtuItemExplorationMechanicsV1['repels']
      readonly repelDirect: PtuItemExplorationMechanicsV1['repelDirect']
      readonly dowsingRod: PtuItemExplorationMechanicsV1['dowsingRod']
      readonly crystalResonanceRecordSha256: string
      readonly runtimeDocumentaryParsingForbidden: true
    }
    readonly snackPolicy: {
      readonly storage: 'authoritative-sheet-digestion-buff'
      readonly consumptionTiming: 'extended-action-any-time'
      readonly ordinaryCapacity: 1
      readonly gluttonyCapacity: 3
      readonly tradeLimitPerScene: 1
      readonly gluttonyTradeLimitPerScene: 3
      readonly incompatibleStacking: 'reject-before-consumption'
      readonly tradeAuthority: 'server-owned-move-item-mutation'
      readonly fixedHealing: { readonly 'Candy Bar': 5, readonly Honey: 5 }
      readonly encounterHealing: {
        readonly Leftovers: { readonly numerator: 1, readonly denominator: 16, readonly boundary: 'turn-start', readonly duration: 'encounter' }
        readonly 'Black Sludge': { readonly numerator: 1, readonly denominator: 8, readonly boundary: 'turn-start', readonly duration: 'encounter', readonly requiredPokemonType: 'Poison' }
      }
    }
    readonly xItemPolicy: {
      readonly targetKind: 'pokemon'
      readonly directStageBounds: readonly [-6, 6]
      readonly directStageDuration: 'encounter-stage-state'
      readonly directStageSwitchPolicy: 'clear-on-switch-or-recall'
      readonly direHit: {
        readonly family: 'critical-range'
        readonly amount: 2
        readonly duration: 'encounter'
        readonly reapplication: 'replace'
      }
      readonly guardSpec: {
        readonly family: 'move-stage-reduction-immunity'
        readonly amount: 5
        readonly duration: 'target-turns'
        readonly reapplication: 'refresh'
      }
      readonly temporarySwitchPolicy: 'expire'
    }
    readonly revivalPolicy: {
      readonly targetKind: 'pokemon'
      readonly requiresCondition: 'Fainted'
      readonly clearsCondition: 'Fainted'
      readonly fixedHpBasis: 'absolute-resulting-hp'
      readonly maximumRelativeBasis: 'full-formula-maximum-hp'
      readonly finalCap: 'injury-adjusted-effective-maximum-hp'
      readonly ordinaryHealingDistinct: true
      readonly zeroEffectiveMaximumPolicy: 'unavailable'
    }
    readonly restorativeItemTiming: {
      readonly otherTargetActionCost: 'standard'
      readonly otherTargetNextTurnForfeit: readonly ['standard', 'shift']
      readonly exceptionCanonicalEdgeId: 'Medic Training'
      readonly selfActionCost: 'full'
      readonly selfForfeit: false
    }
  }
  readonly specs: readonly ReviewedItemEffectRow[]
}

const CATALOG_SHA256 = '62b29a499c791d689f6efc99e04ed515a71336421352626749cf6cc7407982c8'
const canonicalItems = itemsJson as Record<string, PtuItem>
const reviewed = specsJson as unknown as ReviewedItemSpecsDocument
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const assertCanonicalEvidence = (row: ReviewedItemEffectRow): PtuItem => {
  const item = canonicalItems[row.canonicalId]
  if (!item || item.name !== row.canonicalId) throw new Error(`Reviewed ItemSpec ${row.canonicalId} has no canonical item row.`)
  if (sha256(stableJsonStringify(item)) !== row.recordSha256) throw new Error(`Reviewed ItemSpec ${row.canonicalId} canonical record drifted.`)
  if (sha256(item.effects.join('\n')) !== row.effectSha256) throw new Error(`Reviewed ItemSpec ${row.canonicalId} canonical effect drifted.`)
  return item
}

const restoration = (amount: ItemHpRestorationSpec['amount']): ItemHpRestorationSpec => ({
  amount,
  cap: 'injury-adjusted-effective-maximum-hp',
  faintedState: 'preserve',
})

const effectsFor = (row: ReviewedItemEffectRow): readonly ItemEffectSpec[] => {
  if (row.effect.kind === 'heal-hp') return [{ effectId: 'primary', operation: 'heal-hp', restoration: restoration({ kind: 'fixed', amount: row.effect.amount }) }]
  if (row.effect.kind === 'heal-hp-rolled') return [{ effectId: 'primary', operation: 'heal-hp', restoration: restoration({
    kind: 'rolled', diceCount: row.effect.diceCount, dieSides: row.effect.dieSides, modifier: row.effect.modifier,
  }) }]
  if (row.effect.kind === 'heal-hp-relative') return [{ effectId: 'primary', operation: 'heal-hp', restoration: restoration({
    kind: 'maximum-relative', basis: 'full-formula-maximum-hp', numerator: row.effect.numerator,
    denominator: row.effect.denominator, rounding: row.effect.rounding, minimum: row.effect.minimum,
  }) }]
  if (row.effect.kind === 'remove-conditions') return [{
    effectId: 'primary', operation: 'remove-conditions', conditionIds: row.effect.conditionIds,
    mode: row.effect.mode ?? 'listed', selection: row.effect.selection ?? 'all-applicable',
  }]
  if (row.effect.kind === 'heal-and-remove') return [
    { effectId: 'heal', operation: 'heal-hp', restoration: restoration({ kind: 'fixed', amount: row.effect.amount }) },
    {
      effectId: 'conditions', operation: 'remove-conditions', conditionIds: row.effect.conditionIds,
      mode: row.effect.mode ?? 'listed', selection: row.effect.selection ?? 'all-applicable',
    },
  ]
  if (row.effect.kind === 'revive') return [{
    effectId: 'primary',
    operation: 'revive',
    revival: {
      amount: row.effect.amount.kind === 'fixed'
        ? { kind: 'fixed', amount: row.effect.amount.amount }
        : {
            kind: 'maximum-relative', basis: 'full-formula-maximum-hp',
            numerator: row.effect.amount.numerator, denominator: row.effect.amount.denominator,
            rounding: row.effect.amount.rounding, minimum: row.effect.amount.minimum,
          },
      cap: 'injury-adjusted-effective-maximum-hp',
      targetKind: 'pokemon',
      faintedState: 'require-and-clear',
    },
  }]
  if (row.effect.kind === 'modify-stage') {
    return [{ effectId: 'primary', operation: 'modify-stage', stat: row.effect.stat, amount: row.effect.amount }]
  }
  if (row.effect.kind === 'store-digestion-buff') return [{
    effectId: 'primary', operation: 'store-digestion-buff', buffKind: row.effect.buffKind,
    amount: row.effect.amount, denominator: row.effect.denominator,
    requiredPokemonType: row.effect.requiredPokemonType,
  }]
  if (row.effect.kind === 'apply-medical-treatment') return [{
    effectId: 'treatment', operation: 'apply-medical-treatment',
    treatmentKind: row.effect.treatmentKind,
    durationMinutes: row.effect.durationMinutes,
    tickMinutes: row.effect.tickMinutes,
    healingNumerator: row.effect.healingNumerator,
    healingDenominator: row.effect.healingDenominator,
    injuryAtCompletion: row.effect.injuryAtCompletion,
    stopOnHpLoss: row.effect.stopOnHpLoss,
    obeyDailyInjuryLimit: row.effect.obeyDailyInjuryLimit,
  }]
  if (row.effect.kind === 'modify-base-stat') return [{
    effectId: 'advancement', operation: 'modify-base-stat', stat: row.effect.stat,
    amount: row.effect.amount, countsAsVitamin: row.effect.countsAsVitamin,
    requiresTrainerConsent: row.effect.requiresTrainerConsent,
  }]
  if (row.effect.kind === 'grant-tutor-points') return [{
    effectId: 'advancement', operation: 'grant-tutor-points', amount: row.effect.amount,
    countsAsVitamin: row.effect.countsAsVitamin, lifetimeLimit: row.effect.lifetimeLimit,
  }]
  if (row.effect.kind === 'increase-move-frequency') return [{
    effectId: 'advancement', operation: 'increase-move-frequency',
    countsAsVitamin: row.effect.countsAsVitamin, lifetimeLimit: row.effect.lifetimeLimit,
  }]
  if (row.effect.kind === 'gain-next-level-experience') return [{
    effectId: 'advancement', operation: 'gain-next-level-experience',
    lifetimeLimit: row.effect.lifetimeLimit, maximumLevel: row.effect.maximumLevel,
  }]
  if (row.effect.kind === 'learn-machine-move') return [{
    effectId: 'machine-learning', operation: 'learn-machine-move',
    machineKind: row.effect.machineKind, machineNumber: row.effect.machineNumber,
    moveId: row.effect.moveId, tutorPointCost: row.effect.tutorPointCost,
    learningMinutes: row.effect.learningMinutes,
    activeMoveMaximum: row.effect.activeMoveMaximum,
    machineTutorMoveMaximum: row.effect.machineTutorMoveMaximum,
    dailyUseLimit: row.effect.dailyUseLimit,
  }]
  if (row.effect.kind === 'evolve-pokemon') return [{
    effectId: 'evolution', operation: 'evolve-pokemon',
    transitionPolicyId: row.effect.transitionPolicyId,
    statPolicy: 'unallocate-added-points-then-owner-restat',
    abilityPolicy: 'map-current-canonical-abilities-by-tier-and-slot',
    movePolicy: 'retain-current-moves-and-create-bounded-opportunity-attention',
    equipmentPolicy: 'reconcile-current-equipment-against-destination-species',
  }]
  if (row.effect.kind === 'use-bait') return [{
    effectId: 'exploration', operation: 'use-bait',
    lure: {
      checkIntervalMinutes: row.effect.lure.checkIntervalMinutes,
      successMinimum: row.effect.lure.successMinimum,
      maximumAttempts: row.effect.lure.maximumAttempts,
      dieSides: row.effect.lure.dieSides,
    },
    focusDc: row.effect.distraction.focusDc,
  }]
  if (row.effect.kind === 'start-route-lure') return [{
    effectId: 'exploration', operation: 'start-route-lure',
    lure: {
      checkIntervalMinutes: row.effect.lure.checkIntervalMinutes,
      successMinimum: row.effect.lure.successMinimum,
      maximumAttempts: row.effect.lure.maximumAttempts,
      dieSides: row.effect.lure.dieSides,
    },
    lossPolicy: row.effect.lossPolicy,
  }]
  if (row.effect.kind === 'use-snack-or-bait') return [{
    effectId: 'exploration', operation: 'use-snack-or-bait',
    buffKind: row.effect.buffKind, amount: row.effect.amount,
    denominator: row.effect.denominator, requiredPokemonType: row.effect.requiredPokemonType,
    lure: {
      checkIntervalMinutes: row.effect.lure.checkIntervalMinutes,
      successMinimum: row.effect.lure.successMinimum,
      maximumAttempts: row.effect.lure.maximumAttempts,
      dieSides: row.effect.lure.dieSides,
    },
    focusDc: row.effect.distraction.focusDc,
  }]
  if (row.effect.kind === 'use-repel') return [{
    effectId: 'exploration', operation: 'use-repel',
    durationMinutes: row.effect.durationMinutes,
    maximumAffectedWildLevel: row.effect.maximumAffectedWildLevel,
    directBaseAc: row.effect.directBaseAc,
    positioningAuthority: row.effect.positioningAuthority,
  }]
  if (row.effect.kind === 'search-for-shards') return [{
    effectId: 'exploration', operation: 'search-for-shards',
    searchMinutes: row.effect.searchMinutes,
    terrainBonusDice: row.effect.terrainBonusDice,
    skillStuntDowsingBonusDice: row.effect.skillStuntDowsingBonusDice,
    crystalResonanceBonusDice: row.effect.crystalResonanceBonusDice,
    successMinimum: row.effect.successMinimum,
    rerollOn: row.effect.rerollOn,
    shardColors: [...row.effect.shardColors],
    areaAuthority: row.effect.areaAuthority,
  }]
  if (row.effect.kind === 'skill-check-heal-and-remove') return [
    {
      effectId: 'medicine-check', operation: 'heal-hp', restoration: restoration({
        kind: 'skill-check', skillId: row.effect.skillId, dieSides: row.effect.dieSides,
      }),
    },
    {
      effectId: 'conditions', operation: 'remove-conditions', conditionIds: row.effect.conditionIds,
      mode: 'listed', selection: 'all-applicable',
    },
  ]
  return [{
    effectId: 'primary', operation: 'temporary-combat-effect', family: row.effect.family,
    amount: row.effect.amount, stackPolicy: row.effect.stackPolicy, switchPolicy: row.effect.switchPolicy,
  }]
}

const specFor = (row: ReviewedItemEffectRow): ItemSpecV1 => {
  const item = assertCanonicalEvidence(row)
  const snack = row.effect.kind === 'store-digestion-buff'
  const skillCheckTool = row.effect.kind === 'skill-check-heal-and-remove'
  const medicalTreatment = row.effect.kind === 'apply-medical-treatment'
  const xItem = row.effect.kind === 'modify-stage' || row.effect.kind === 'temporary-combat-effect'
  const permanentAdvancement = row.effect.kind === 'modify-base-stat'
    || row.effect.kind === 'grant-tutor-points'
    || row.effect.kind === 'increase-move-frequency'
    || row.effect.kind === 'gain-next-level-experience'
  const machineMoveLearning = row.effect.kind === 'learn-machine-move'
  const evolution = row.effect.kind === 'evolve-pokemon'
  const exploration = row.effect.kind === 'use-bait'
    || row.effect.kind === 'start-route-lure'
    || row.effect.kind === 'use-snack-or-bait'
    || row.effect.kind === 'use-repel'
    || row.effect.kind === 'search-for-shards'
  const dowsing = row.effect.kind === 'search-for-shards'
  const reusableExploration = row.effect.kind === 'start-route-lure' || dowsing
  const selfExploration = row.effect.kind === 'start-route-lure' || dowsing
  const revival = row.effect.kind === 'revive'
  const healing = row.effect.kind === 'heal-hp' || row.effect.kind === 'heal-hp-rolled'
    || row.effect.kind === 'heal-hp-relative' || row.effect.kind === 'heal-and-remove'
  const spec: ItemSpecV1 = {
    schemaVersion: ITEM_SPEC_SCHEMA_VERSION,
    canonicalId: item.name,
    aliases: [...item.aliases],
    implementationState: 'native',
    contexts: row.effect.kind === 'temporary-combat-effect'
      ? ['encounter']
      : exploration
        ? dowsing ? ['campaign', 'sheet', 'extended-action']
          : row.effect.kind === 'start-route-lure' ? ['campaign', 'sheet']
            : ['encounter', 'campaign', 'sheet']
        : snack
          ? ['encounter', 'extended-action']
          : skillCheckTool || medicalTreatment || permanentAdvancement || machineMoveLearning
            ? ['campaign', 'sheet', 'extended-action']
            : evolution ? ['campaign', 'sheet'] : ['encounter', 'sheet'],
    roles: ['usable'],
    timing: skillCheckTool || medicalTreatment || permanentAdvancement || machineMoveLearning || dowsing ? 'extended' : 'standard',
    costs: skillCheckTool
      ? [{ kind: 'ap', resourceId: 'drain', amount: row.effect.apAmount, label: 'Drain 1 AP' }]
      : medicalTreatment || permanentAdvancement || machineMoveLearning || evolution || selfExploration || dowsing
        ? []
        : [{ kind: 'action', resourceId: 'standard', amount: 1, label: '1 Standard Action' }],
    prerequisites: [
      ...(skillCheckTool ? [{ prerequisiteId: 'trainer-actor', kind: 'actor-kind' as const, values: ['trainer'], unavailableReason: 'First Aid Kit use requires a Trainer actor.' }] : []),
      ...(permanentAdvancement ? [{ prerequisiteId: 'trainer-actor', kind: 'actor-kind' as const, values: ['trainer'], unavailableReason: 'Permanent advancement items require a Trainer actor.' }] : []),
      ...(machineMoveLearning ? [{ prerequisiteId: 'trainer-actor', kind: 'actor-kind' as const, values: ['trainer'], unavailableReason: 'Machine Move learning requires a Trainer actor.' }] : []),
      ...(evolution ? [{ prerequisiteId: 'trainer-actor', kind: 'actor-kind' as const, values: ['trainer'], unavailableReason: 'Item evolution requires a Trainer actor.' }] : []),
      ...(exploration ? [{ prerequisiteId: 'trainer-actor', kind: 'actor-kind' as const, values: ['trainer'], unavailableReason: 'Exploration item use requires a Trainer actor.' }] : []),
      ...(dowsing ? [{ prerequisiteId: 'gm-area-confirmation', kind: 'gm' as const, values: ['route-cave-or-outside'], unavailableReason: 'A GM must confirm the Dowsing search area.' }] : []),
      ...(xItem || permanentAdvancement || machineMoveLearning || evolution ? [{
        prerequisiteId: 'pokemon-target', kind: 'target-kind' as const, values: ['pokemon'],
        unavailableReason: permanentAdvancement
          ? 'Permanent advancement items target Pokémon only.'
          : machineMoveLearning ? 'Machine Move learning targets Pokémon only.'
            : evolution ? 'Evolutionary Items target Pokémon only.' : 'X Items target Pokémon only.',
      }] : []),
      ...(snack && row.effect.requiredPokemonType ? [{
        prerequisiteId: 'required-pokemon-type', kind: 'type' as const,
        values: [row.effect.requiredPokemonType],
        unavailableReason: `${item.name} may only be consumed by ${row.effect.requiredPokemonType}-Type Pokémon.`,
      }] : []),
      ...(revival ? [{ prerequisiteId: 'fainted', kind: 'condition' as const, values: ['Fainted'], unavailableReason: 'This item requires a fainted Pokémon.' }] : []),
      ...(healing && row.effect.kind !== 'heal-and-remove'
        ? [{ prerequisiteId: 'damaged', kind: 'hp-state' as const, values: ['below-effective-maximum'], unavailableReason: 'This target is already at its effective maximum HP.' }]
        : []),
    ],
    targets: [{
      targetId: 'target', kind: 'participant', minimum: 1, maximum: 1,
      relationship: permanentAdvancement || machineMoveLearning || evolution ? 'owned' : selfExploration ? 'self' : 'any',
      rangeMeters: null, requiresLineOfSight: false,
    }],
    choices: dowsing
      ? [
          { choiceId: 'dowsing-terrain', kind: 'mode', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'gm' },
          { choiceId: 'dowsing-skill-stunt', kind: 'mode', minimum: 0, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' },
        ]
      : row.effect.kind === 'use-bait' || row.effect.kind === 'use-snack-or-bait' || row.effect.kind === 'use-repel'
        ? [{ choiceId: 'exploration-use-mode', kind: 'mode', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' }]
        : evolution
      ? [
          { choiceId: 'evolution-destination', kind: 'destination', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' },
          { choiceId: 'evolution-confirmation', kind: 'mode', minimum: 1, maximum: 1, optionSource: 'spec', options: [{ optionId: 'confirmed', label: 'Confirm this exact evolution' }], privateTo: 'actor-owner' },
        ]
      : machineMoveLearning
      ? [
          { choiceId: 'machine-replacement', kind: 'move', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' },
          { choiceId: 'machine-confirmation', kind: 'mode', minimum: 1, maximum: 1, optionSource: 'spec', options: [{ optionId: 'confirmed', label: 'Confirm this exact Move change' }], privateTo: 'actor-owner' },
        ]
      : row.effect.kind === 'increase-move-frequency'
      ? [{ choiceId: 'permanent-move', kind: 'move', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' }]
      : row.effect.kind === 'modify-base-stat' && row.effect.stat === 'selected'
        ? [
            { choiceId: 'permanent-stat', kind: 'stat', minimum: 1, maximum: 1, optionSource: 'authority', options: [], privateTo: 'actor-owner' },
            { choiceId: 'trainer-consent', kind: 'mode', minimum: 1, maximum: 1, optionSource: 'spec', options: [{ optionId: 'confirmed', label: 'The Pokémon’s Trainer consents' }], privateTo: 'actor-owner' },
          ]
        : [],
    consumption: skillCheckTool
      ? { phase: 'never', quantity: 0, reserveWhilePending: false, refundableOnCancel: false, reusable: true }
      : exploration
        ? reusableExploration
          ? { phase: 'never', quantity: 0, reserveWhilePending: false, refundableOnCancel: false, reusable: true }
          : { phase: 'accepted-use', quantity: 1, reserveWhilePending: true, refundableOnCancel: true, reusable: false }
        : machineMoveLearning
        ? row.effect.machineKind === 'HM'
          ? { phase: 'never', quantity: 0, reserveWhilePending: false, refundableOnCancel: false, reusable: true }
          : { phase: 'extended-action-completion', quantity: 1, reserveWhilePending: true, refundableOnCancel: false, reusable: false }
        : medicalTreatment || permanentAdvancement
          ? { phase: 'extended-action-completion', quantity: 1, reserveWhilePending: false, refundableOnCancel: false, reusable: false }
          : evolution
            ? { phase: 'accepted-use', quantity: 1, reserveWhilePending: true, refundableOnCancel: false, reusable: false }
            : { phase: 'accepted-use', quantity: 1, reserveWhilePending: true, refundableOnCancel: true, reusable: false },
    effects: effectsFor(row),
    duration: row.effect.kind === 'temporary-combat-effect'
      ? row.effect.duration
      : dowsing
        ? { kind: 'campaign-minutes', amount: row.effect.searchMinutes }
        : medicalTreatment
        ? { kind: 'campaign-minutes', amount: row.effect.durationMinutes }
        : machineMoveLearning
          ? { kind: 'campaign-minutes', amount: row.effect.learningMinutes }
          : { kind: 'instant', amount: null },
    privacy: {
      sourceInventory: 'actor-owner',
      choices: dowsing ? 'gm' : 'actor-owner',
      outcome: permanentAdvancement || machineMoveLearning || evolution || dowsing ? 'actor-owner' : 'public',
    },
    presentation: {
      label: item.name,
      description: snack
        ? row.effect.buffKind === 'turn-start-heal'
          ? `Store this Snack as a Digestion Buff, then trade it in during battle to recover 1/${row.effect.denominator} maximum HP at each turn start for the encounter.`
          : `Store this Snack as a Digestion Buff, then trade it in during battle to recover ${row.effect.amount} HP.`
        : medicalTreatment
        ? 'Apply Bandages as an Extended Action. They last 6 hours, heal 1/8 Max HP each half hour, remove 1 Injury at full duration within the daily limit, and stop on HP loss.'
        : exploration
          ? row.effect.kind === 'use-bait'
            ? 'Set Bait on a route for up to three 15-minute checks, or throw it at an exact wild Pokémon for a Focus DC 12 distraction.'
            : row.effect.kind === 'start-route-lure'
              ? 'Start reusable fishing lure checks every 15 campaign minutes; any fictional lure loss remains explicit GM adjudication.'
              : row.effect.kind === 'use-snack-or-bait'
                ? 'Choose Honey as a 5 HP Digestion Buff Snack, route lure, or wild distraction before acceptance.'
                : row.effect.kind === 'use-repel'
                  ? `Ward off wild Pokémon of Level ${row.effect.maximumAffectedWildLevel} or lower for ${row.effect.durationMinutes} campaign minutes, or make an AC 6 direct spray.`
                  : 'Search a GM-confirmed route, cave, or outside area for 10 campaign minutes and resolve exact Dowsing dice into color-preserving Shards.'
        : machineMoveLearning
          ? `Teach ${row.effect.moveId} as an hour-long Extended Action after compatibility, Tutor Point, active-Move, and TM/Tutor limit checks.`
          : evolution
            ? 'Preview and apply one reviewed species evolution while retaining character identity and exposing required follow-up choices.'
            : item.effects.join(' '),
      unavailableReason: null,
    },
    evidence: {
      canonicalCatalogSha256: reviewed.catalogSha256,
      canonicalRecordSha256: row.recordSha256,
      canonicalEffectSha256: row.effectSha256,
      reviewId: `complete-loop:${item.name}:v1`,
      status: 'reviewed',
    },
    registeredHandlerId: 'item.native.v1',
  }
  return spec
}

const explorationPolicy = reviewed.ruleEvidence.explorationItemPolicy
const explorationMechanics = (rulesJson as Record<string, {
  itemExplorationMechanics?: PtuItemExplorationMechanicsV1
}>)[explorationPolicy.ruleCanonicalId]?.itemExplorationMechanics

if (reviewed.schemaVersion !== 1 || reviewed.catalogSha256 !== CATALOG_SHA256
  || reviewed.ruleEvidence.usingItemsRecordSha256 !== 'b28291192d6d5b498596316a5e642d486f6007087ab61fd9b58f2506d812c3f9'
  || reviewed.ruleEvidence.conditionCatalogSha256 !== 'a3ddc1b832304df106d1e1587b3208a51b7806e5a764e773103b0f29da838fb0'
  || reviewed.ruleEvidence.loyaltyRecordSha256 !== '95cf2e2467ac266b285b011aac0622b52f1014ed8dfad36f42a8d1adb57e76d3'
  || reviewed.ruleEvidence.repulsiveMedicinePolicy.items.join(',') !== 'Energy Powder,Energy Root,Heal Powder,Revival Herb'
  || reviewed.ruleEvidence.repulsiveMedicinePolicy.deterministicLoyaltyMutation !== false
  || reviewed.ruleEvidence.repulsiveMedicinePolicy.runtimeDisposition !== 'fail-closed-until-gm-attention-authority'
  || reviewed.ruleEvidence.repulsiveMedicinePolicy.reason.trim().length === 0
  || reviewed.ruleEvidence.persistentAfflictionsRecordSha256 !== '6ac45922e6d35d90e6a62a5aa47d52f19318f62f6243e396ec5163c011e7746e'
  || reviewed.ruleEvidence.otherAfflictionsRecordSha256 !== '67ee4b0f939c0c3d110cf4d6c9661446fbfee70a0cb1fbd370385a4804ecbd3f'
  || reviewed.ruleEvidence.revivalPolicy.targetKind !== 'pokemon'
  || reviewed.ruleEvidence.revivalPolicy.requiresCondition !== 'Fainted'
  || reviewed.ruleEvidence.revivalPolicy.clearsCondition !== 'Fainted'
  || reviewed.ruleEvidence.revivalPolicy.fixedHpBasis !== 'absolute-resulting-hp'
  || reviewed.ruleEvidence.revivalPolicy.maximumRelativeBasis !== 'full-formula-maximum-hp'
  || reviewed.ruleEvidence.revivalPolicy.finalCap !== 'injury-adjusted-effective-maximum-hp'
  || reviewed.ruleEvidence.revivalPolicy.ordinaryHealingDistinct !== true
  || reviewed.ruleEvidence.revivalPolicy.zeroEffectiveMaximumPolicy !== 'unavailable'
  || reviewed.ruleEvidence.combatStagesRecordSha256 !== '02c83f25187daee76ae6b9c4c73cdca20ddee2dc302b318b4b3d1588a6c07545'
  || reviewed.ruleEvidence.firstAidKitPolicy.actorKind !== 'trainer'
  || reviewed.ruleEvidence.firstAidKitPolicy.skillId !== 'medicineEd'
  || reviewed.ruleEvidence.firstAidKitPolicy.dieSides !== 6
  || reviewed.ruleEvidence.firstAidKitPolicy.timing !== 'extended'
  || reviewed.ruleEvidence.firstAidKitPolicy.apCost.mode !== 'drain'
  || reviewed.ruleEvidence.firstAidKitPolicy.apCost.amount !== 1
  || reviewed.ruleEvidence.firstAidKitPolicy.apCost.recovery !== 'extended-rest'
  || reviewed.ruleEvidence.firstAidKitPolicy.healingBasis !== 'authoritative-skill-check-total'
  || reviewed.ruleEvidence.firstAidKitPolicy.conditionIds.join(',') !== 'Burned,Poisoned,Badly Poisoned,Paralysis'
  || reviewed.ruleEvidence.firstAidKitPolicy.reusable !== true
  || reviewed.ruleEvidence.bandagePolicy.canonicalId !== 'Bandages'
  || reviewed.ruleEvidence.bandagePolicy.naturalHealingRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>).Resting))
  || reviewed.ruleEvidence.bandagePolicy.timing !== 'extended'
  || reviewed.ruleEvidence.bandagePolicy.durationMinutes !== 360
  || reviewed.ruleEvidence.bandagePolicy.tickMinutes !== 30
  || reviewed.ruleEvidence.bandagePolicy.healing.basis !== 'full-formula-maximum-hp'
  || reviewed.ruleEvidence.bandagePolicy.healing.numerator !== 1
  || reviewed.ruleEvidence.bandagePolicy.healing.denominator !== 8
  || reviewed.ruleEvidence.bandagePolicy.healing.minimum !== 1
  || reviewed.ruleEvidence.bandagePolicy.healing.blockedAtInjuries !== 5
  || reviewed.ruleEvidence.bandagePolicy.injuryAtCompletion !== 1
  || reviewed.ruleEvidence.bandagePolicy.obeyDailyInjuryLimit !== true
  || reviewed.ruleEvidence.bandagePolicy.stopOnHpLoss !== true
  || reviewed.ruleEvidence.bandagePolicy.consumptionPhase !== 'extended-action-completion'
  || reviewed.ruleEvidence.poulticePolicy.canonicalId !== 'Poultices'
  || reviewed.ruleEvidence.poulticePolicy.nativeBandageMechanicsShared !== true
  || reviewed.ruleEvidence.poulticePolicy.loyaltyConsequenceDeterministic !== false
  || reviewed.ruleEvidence.poulticePolicy.runtimeDisposition !== 'fail-closed-until-guided-adjudication-P8-059'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId !== 'Vitamins and Related Items'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.ruleRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['Vitamins and Related Items']))
  || reviewed.ruleEvidence.permanentAdvancementPolicy.timing !== 'extended'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.targetKind !== 'pokemon'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.consumptionPhase !== 'extended-action-completion'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.vitaminLifetimeLimit !== 5
  || reviewed.ruleEvidence.permanentAdvancementPolicy.sheetValidity.baseRelations !== 'required-after-application'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.sheetValidity.statPointBudget !== 'must-not-exceed'
  || reviewed.ruleEvidence.permanentAdvancementPolicy.sheetValidity.provenance !== 'server-private-immutable-application-ledger'
  || stableJsonStringify(reviewed.ruleEvidence.permanentAdvancementPolicy.statVitamins)
    !== stableJsonStringify(((rulesJson as Record<string, { itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1 }>)[reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId]?.itemAdvancementMechanics?.statVitamins))
  || stableJsonStringify(reviewed.ruleEvidence.permanentAdvancementPolicy.heartBooster)
    !== stableJsonStringify(((rulesJson as Record<string, { itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1 }>)[reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId]?.itemAdvancementMechanics?.heartBooster))
  || stableJsonStringify(reviewed.ruleEvidence.permanentAdvancementPolicy.ppUp)
    !== stableJsonStringify(((rulesJson as Record<string, { itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1 }>)[reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId]?.itemAdvancementMechanics?.ppUp))
  || stableJsonStringify(reviewed.ruleEvidence.permanentAdvancementPolicy.rareCandy)
    !== stableJsonStringify(((rulesJson as Record<string, { itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1 }>)[reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId]?.itemAdvancementMechanics?.rareCandy))
  || stableJsonStringify(reviewed.ruleEvidence.permanentAdvancementPolicy.statSuppressants)
    !== stableJsonStringify(((rulesJson as Record<string, { itemAdvancementMechanics?: PtuItemAdvancementMechanicsV1 }>)[reviewed.ruleEvidence.permanentAdvancementPolicy.ruleCanonicalId]?.itemAdvancementMechanics?.statSuppressants))
  || reviewed.ruleEvidence.machineMoveLearningPolicy.ruleCanonicalId !== 'TMs and HMs'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.ruleRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['TMs and HMs']))
  || reviewed.ruleEvidence.machineMoveLearningPolicy.tmTutorLimitCanonicalId !== '3-TM/Tutor Move Limit'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.tmTutorLimitRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['3-TM/Tutor Move Limit']))
  || reviewed.ruleEvidence.machineMoveLearningPolicy.tutorPointsCanonicalId !== 'Tutor Points'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.tutorPointsRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['Tutor Points']))
  || reviewed.ruleEvidence.machineMoveLearningPolicy.clusterMindRecordSha256
    !== sha256(stableJsonStringify((abilitiesJson as Record<string, unknown>)['Cluster Mind']))
  || reviewed.ruleEvidence.machineMoveLearningPolicy.machineCount !== 106
  || reviewed.ruleEvidence.machineMoveLearningPolicy.timing !== 'extended'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.targetKind !== 'pokemon'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.compatibilityAuthority !== 'exact-species-tm_hm_moves-entry'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.knownMoveAuthority !== 'union-of-movelist-and-appliedMoves'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.consumptionPhase !== 'extended-action-completion'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.reusableHmUsesPerCampaignDay !== 1
  || reviewed.ruleEvidence.machineMoveLearningPolicy.replacementChoice !== 'one-authority-projected-active-move-or-open-slot'
  || reviewed.ruleEvidence.machineMoveLearningPolicy.provenance !== 'server-private-immutable-application-ledger'
  || reviewed.ruleEvidence.itemEvolutionPolicy.ruleCanonicalId !== 'Evolutionary Items'
  || reviewed.ruleEvidence.itemEvolutionPolicy.ruleRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)['Evolutionary Items']))
  || reviewed.ruleEvidence.itemEvolutionPolicy.itemCount !== 24
  || reviewed.ruleEvidence.itemEvolutionPolicy.transitionCount !== 62
  || reviewed.ruleEvidence.itemEvolutionPolicy.timing !== 'standard'
  || reviewed.ruleEvidence.itemEvolutionPolicy.targetKind !== 'pokemon'
  || reviewed.ruleEvidence.itemEvolutionPolicy.consumptionPhase !== 'accepted-use'
  || reviewed.ruleEvidence.itemEvolutionPolicy.destinationChoice !== 'one-authority-projected-destination'
  || reviewed.ruleEvidence.itemEvolutionPolicy.confirmation !== 'one-exact-explicit-confirmation'
  || reviewed.ruleEvidence.itemEvolutionPolicy.provenance !== 'server-private-immutable-application-ledger'
  || reviewed.ruleEvidence.itemEvolutionPolicy.restatAttention !== 'owner-visible-unallocated-stat-point-work'
  || reviewed.ruleEvidence.itemEvolutionPolicy.moveAttention !== 'owner-visible-bounded-new-form-move-opportunities'
  || explorationPolicy.ruleCanonicalId !== 'Exploration Items'
  || explorationPolicy.ruleRecordSha256
    !== sha256(stableJsonStringify((rulesJson as Record<string, unknown>)[explorationPolicy.ruleCanonicalId]))
  || explorationPolicy.actorKind !== 'trainer'
  || explorationPolicy.itemIds.join(',') !== 'Bait,Fishing Lure,Honey,Repel,Super Repel,Max Repel,Dowsing Rod'
  || explorationPolicy.runtimeDocumentaryParsingForbidden !== true
  || !explorationMechanics || explorationMechanics.schemaVersion !== 1
  || explorationMechanics.actorKind !== 'trainer'
  || stableJsonStringify(explorationPolicy.routeLure) !== stableJsonStringify(explorationMechanics.bait.routeLure)
  || stableJsonStringify(explorationPolicy.wildDistraction) !== stableJsonStringify(explorationMechanics.bait.wildDistraction)
  || stableJsonStringify(explorationPolicy.fishingLure) !== stableJsonStringify(explorationMechanics.fishingLure)
  || stableJsonStringify(explorationPolicy.repels) !== stableJsonStringify(explorationMechanics.repels)
  || stableJsonStringify(explorationPolicy.repelDirect) !== stableJsonStringify(explorationMechanics.repelDirect)
  || stableJsonStringify(explorationPolicy.dowsingRod) !== stableJsonStringify(explorationMechanics.dowsingRod)
  || explorationPolicy.crystalResonanceRecordSha256
    !== sha256(stableJsonStringify((featuresJson as Record<string, unknown>)['Crystal Resonance']))
  || reviewed.ruleEvidence.snackPolicy.storage !== 'authoritative-sheet-digestion-buff'
  || reviewed.ruleEvidence.snackPolicy.consumptionTiming !== 'extended-action-any-time'
  || reviewed.ruleEvidence.snackPolicy.ordinaryCapacity !== 1
  || reviewed.ruleEvidence.snackPolicy.gluttonyCapacity !== 3
  || reviewed.ruleEvidence.snackPolicy.tradeLimitPerScene !== 1
  || reviewed.ruleEvidence.snackPolicy.gluttonyTradeLimitPerScene !== 3
  || reviewed.ruleEvidence.snackPolicy.incompatibleStacking !== 'reject-before-consumption'
  || reviewed.ruleEvidence.snackPolicy.tradeAuthority !== 'server-owned-move-item-mutation'
  || reviewed.ruleEvidence.snackPolicy.fixedHealing['Candy Bar'] !== 5
  || reviewed.ruleEvidence.snackPolicy.fixedHealing.Honey !== 5
  || reviewed.ruleEvidence.snackPolicy.encounterHealing.Leftovers.numerator !== 1
  || reviewed.ruleEvidence.snackPolicy.encounterHealing.Leftovers.denominator !== 16
  || reviewed.ruleEvidence.snackPolicy.encounterHealing.Leftovers.boundary !== 'turn-start'
  || reviewed.ruleEvidence.snackPolicy.encounterHealing.Leftovers.duration !== 'encounter'
  || reviewed.ruleEvidence.snackPolicy.encounterHealing['Black Sludge'].numerator !== 1
  || reviewed.ruleEvidence.snackPolicy.encounterHealing['Black Sludge'].denominator !== 8
  || reviewed.ruleEvidence.snackPolicy.encounterHealing['Black Sludge'].requiredPokemonType !== 'Poison'
  || reviewed.ruleEvidence.xItemPolicy.targetKind !== 'pokemon'
  || reviewed.ruleEvidence.xItemPolicy.directStageBounds.join(',') !== '-6,6'
  || reviewed.ruleEvidence.xItemPolicy.directStageDuration !== 'encounter-stage-state'
  || reviewed.ruleEvidence.xItemPolicy.directStageSwitchPolicy !== 'clear-on-switch-or-recall'
  || reviewed.ruleEvidence.xItemPolicy.direHit.family !== 'critical-range'
  || reviewed.ruleEvidence.xItemPolicy.direHit.amount !== 2
  || reviewed.ruleEvidence.xItemPolicy.direHit.duration !== 'encounter'
  || reviewed.ruleEvidence.xItemPolicy.direHit.reapplication !== 'replace'
  || reviewed.ruleEvidence.xItemPolicy.guardSpec.family !== 'move-stage-reduction-immunity'
  || reviewed.ruleEvidence.xItemPolicy.guardSpec.amount !== 5
  || reviewed.ruleEvidence.xItemPolicy.guardSpec.duration !== 'target-turns'
  || reviewed.ruleEvidence.xItemPolicy.guardSpec.reapplication !== 'refresh'
  || reviewed.ruleEvidence.xItemPolicy.temporarySwitchPolicy !== 'expire'
  || reviewed.ruleEvidence.restorativeItemTiming.otherTargetActionCost !== 'standard'
  || reviewed.ruleEvidence.restorativeItemTiming.otherTargetNextTurnForfeit.join(',') !== 'standard,shift'
  || reviewed.ruleEvidence.restorativeItemTiming.exceptionCanonicalEdgeId !== 'Medic Training'
  || reviewed.ruleEvidence.restorativeItemTiming.selfActionCost !== 'full'
  || reviewed.ruleEvidence.restorativeItemTiming.selfForfeit !== false) {
  throw new Error('Unsupported or stale reviewed item specification document.')
}

const firstAidRows = reviewed.specs.filter(row => row.canonicalId === 'First Aid Kit')
const firstAidEffect = firstAidRows[0]?.effect
if (firstAidRows.length !== 1
  || firstAidEffect?.kind !== 'skill-check-heal-and-remove'
  || firstAidEffect.skillId !== reviewed.ruleEvidence.firstAidKitPolicy.skillId
  || firstAidEffect.dieSides !== reviewed.ruleEvidence.firstAidKitPolicy.dieSides
  || firstAidEffect.apMode !== reviewed.ruleEvidence.firstAidKitPolicy.apCost.mode
  || firstAidEffect.apAmount !== reviewed.ruleEvidence.firstAidKitPolicy.apCost.amount
  || firstAidEffect.conditionIds.join(',') !== reviewed.ruleEvidence.firstAidKitPolicy.conditionIds.join(',')) {
  throw new Error('Unsupported or stale reviewed First Aid Kit mechanics.')
}

const bandageRows = reviewed.specs.filter(row => row.canonicalId === reviewed.ruleEvidence.bandagePolicy.canonicalId)
const bandageEffect = bandageRows[0]?.effect
if (bandageRows.length !== 1 || bandageEffect?.kind !== 'apply-medical-treatment'
  || bandageEffect.treatmentKind !== 'bandages'
  || bandageEffect.durationMinutes !== reviewed.ruleEvidence.bandagePolicy.durationMinutes
  || bandageEffect.tickMinutes !== reviewed.ruleEvidence.bandagePolicy.tickMinutes
  || bandageEffect.healingNumerator !== reviewed.ruleEvidence.bandagePolicy.healing.numerator
  || bandageEffect.healingDenominator !== reviewed.ruleEvidence.bandagePolicy.healing.denominator
  || bandageEffect.injuryAtCompletion !== reviewed.ruleEvidence.bandagePolicy.injuryAtCompletion
  || bandageEffect.stopOnHpLoss !== reviewed.ruleEvidence.bandagePolicy.stopOnHpLoss
  || bandageEffect.obeyDailyInjuryLimit !== reviewed.ruleEvidence.bandagePolicy.obeyDailyInjuryLimit
  || reviewed.specs.some(row => row.canonicalId === reviewed.ruleEvidence.poulticePolicy.canonicalId)) {
  throw new Error('Unsupported or stale reviewed Bandages/Poultices mechanics.')
}

const advancementPolicy = reviewed.ruleEvidence.permanentAdvancementPolicy
const advancementRows = reviewed.specs.filter(row => (
  row.effect.kind === 'modify-base-stat'
  || row.effect.kind === 'grant-tutor-points'
  || row.effect.kind === 'increase-move-frequency'
  || row.effect.kind === 'gain-next-level-experience'
))
const advancementNames = new Set([
  ...Object.keys(advancementPolicy.statVitamins),
  'Heart Booster', 'PP Up', 'Rare Candy', 'Stat Suppressants',
])
if (advancementRows.length !== advancementNames.size
  || advancementRows.some(row => !advancementNames.has(row.canonicalId))
  || Object.entries(advancementPolicy.statVitamins).some(([canonicalId, stat]) => {
    const effect = advancementRows.find(row => row.canonicalId === canonicalId)?.effect
    return effect?.kind !== 'modify-base-stat' || effect.stat !== stat || effect.amount !== 1
      || !effect.countsAsVitamin || effect.requiresTrainerConsent
  })
  || (() => {
    const effect = advancementRows.find(row => row.canonicalId === 'Heart Booster')?.effect
    return effect?.kind !== 'grant-tutor-points'
      || effect.amount !== advancementPolicy.heartBooster.tutorPoints
      || effect.lifetimeLimit !== advancementPolicy.heartBooster.lifetimeLimit
  })()
  || (() => {
    const effect = advancementRows.find(row => row.canonicalId === 'PP Up')?.effect
    return effect?.kind !== 'increase-move-frequency'
      || effect.lifetimeLimit !== advancementPolicy.ppUp.lifetimeLimit
  })()
  || (() => {
    const effect = advancementRows.find(row => row.canonicalId === 'Rare Candy')?.effect
    return effect?.kind !== 'gain-next-level-experience'
      || effect.lifetimeLimit !== advancementPolicy.rareCandy.lifetimeLimit
      || effect.maximumLevel !== advancementPolicy.rareCandy.maximumLevel
  })()
  || (() => {
    const effect = advancementRows.find(row => row.canonicalId === 'Stat Suppressants')?.effect
    return effect?.kind !== 'modify-base-stat' || effect.stat !== 'selected'
      || effect.amount !== advancementPolicy.statSuppressants.baseStatDelta
      || effect.countsAsVitamin || !effect.requiresTrainerConsent
  })()) {
  throw new Error('Unsupported or stale reviewed permanent advancement mechanics.')
}

const machinePolicy = reviewed.ruleEvidence.machineMoveLearningPolicy
const machineRows = reviewed.specs.filter(row => row.effect.kind === 'learn-machine-move')
const canonicalMachineItems = Object.values(canonicalItems).filter(item => (
  item.categories.length === 1 && (item.categories[0] === 'TM' || item.categories[0] === 'HM')
))
const moveLearningMechanics = (rulesJson as Record<string, {
  itemMoveLearningMechanics?: PtuItemMoveLearningMechanicsV1
}>)[machinePolicy.ruleCanonicalId]?.itemMoveLearningMechanics
const pokedexRows = pokedexJson as unknown as readonly {
  readonly tm_hm_moves?: readonly { readonly kind: string, readonly number: string, readonly name: string }[]
}[]
const moveRows = movesJson as unknown as Record<string, { readonly name?: string }>
const machinePokedexAuthority = machineRows
  .flatMap(row => row.effect.kind === 'learn-machine-move' ? [row.effect] : [])
  .sort((left, right) => {
    const leftKey = `${left.machineKind}\u0000${left.machineNumber}\u0000${left.moveId}`
    const rightKey = `${right.machineKind}\u0000${right.machineNumber}\u0000${right.moveId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  .map(effect => ({
    machineKind: effect.machineKind,
    machineNumber: effect.machineNumber,
    moveId: effect.moveId,
    compatibleSpecies: (pokedexJson as unknown as readonly {
      readonly species: string
      readonly tm_hm_moves?: readonly { readonly kind: string, readonly number: string, readonly name: string }[]
    }[]).filter(species => species.tm_hm_moves?.some(entry => (
      entry.kind === effect.machineKind && entry.number === effect.machineNumber && entry.name === effect.moveId
    ))).map(species => species.species).sort(),
  }))
const machineMoveAuthority = Object.fromEntries([...new Set(machineRows.flatMap(row => (
  row.effect.kind === 'learn-machine-move' ? [row.effect.moveId] : []
)))].sort().map(moveId => [moveId, moveRows[moveId]]))
if (!moveLearningMechanics || moveLearningMechanics.schemaVersion !== 1
  || moveLearningMechanics.learningMinutes !== 60
  || moveLearningMechanics.activeMoveMaximum !== 6
  || moveLearningMechanics.machineTutorMoveMaximum !== 3
  || moveLearningMechanics.tutorPointCost !== 1
  || moveLearningMechanics.replacementOfCountedMachineTutorMoveCost !== 0
  || moveLearningMechanics.tm.reusable !== false
  || moveLearningMechanics.tm.consumptionQuantity !== 1
  || moveLearningMechanics.tm.consumptionPhase !== 'extended-action-completion'
  || moveLearningMechanics.hm.reusable !== true
  || moveLearningMechanics.hm.usesPerCampaignDay !== 1
  || moveLearningMechanics.hm.consumptionQuantity !== 0
  || machinePolicy.pokedexMachineAuthoritySha256 !== sha256(stableJsonStringify(machinePokedexAuthority))
  || machinePolicy.moveLearningMoveAuthoritySha256 !== sha256(stableJsonStringify(machineMoveAuthority))
  || machineRows.length !== machinePolicy.machineCount
  || canonicalMachineItems.length !== machinePolicy.machineCount
  || new Set(machineRows.map(row => row.canonicalId)).size !== machineRows.length
  || machineRows.some(row => {
    const effect = row.effect
    if (effect.kind !== 'learn-machine-move') return true
    const item = canonicalItems[row.canonicalId]
    const category = item?.categories.length === 1 ? item.categories[0] : null
    return category !== effect.machineKind
      || effect.tutorPointCost !== moveLearningMechanics.tutorPointCost
      || effect.learningMinutes !== moveLearningMechanics.learningMinutes
      || effect.activeMoveMaximum !== moveLearningMechanics.activeMoveMaximum
      || effect.machineTutorMoveMaximum !== moveLearningMechanics.machineTutorMoveMaximum
      || effect.dailyUseLimit !== (effect.machineKind === 'HM' ? moveLearningMechanics.hm.usesPerCampaignDay : null)
      || moveRows[effect.moveId]?.name !== effect.moveId
      || !pokedexRows.some(species => species.tm_hm_moves?.some(entry => (
        entry.kind === effect.machineKind && entry.number === effect.machineNumber && entry.name === effect.moveId
      )))
  })
  || canonicalMachineItems.some(item => !machineRows.some(row => row.canonicalId === item.name))) {
  throw new Error('Unsupported or stale reviewed machine Move-learning mechanics.')
}

const evolutionPolicy = reviewed.ruleEvidence.itemEvolutionPolicy
const evolutionRows = reviewed.specs.filter(row => row.effect.kind === 'evolve-pokemon')
const evolutionMechanics = (rulesJson as Record<string, {
  itemEvolutionMechanics?: PtuItemEvolutionMechanicsV1
}>)[evolutionPolicy.ruleCanonicalId]?.itemEvolutionMechanics
const evolutionSpecies = new Set((pokedexJson as unknown as readonly { readonly species: string }[]).map(row => row.species))
const evolutionItemIds = new Set(evolutionMechanics?.transitions.map(row => row.itemId) ?? [])
const evolutionTransitionKeys = evolutionMechanics?.transitions.map(row => (
  `${row.itemId}\u0000${row.fromSpecies}\u0000${row.toSpecies}\u0000${row.requiredGender ?? ''}`
)) ?? []
if (!evolutionMechanics || evolutionMechanics.schemaVersion !== 1
  || evolutionMechanics.actorKind !== 'trainer'
  || evolutionMechanics.targetKind !== 'owned-pokemon'
  || evolutionMechanics.timing !== 'confirmed-instant'
  || evolutionMechanics.consumptionQuantity !== 1
  || evolutionMechanics.consumptionPhase !== 'accepted-use'
  || evolutionMechanics.identityPolicy !== 'retain-sheet-character-and-ownership-identity'
  || evolutionMechanics.statPolicy !== 'unallocate-added-points-then-owner-restat'
  || evolutionMechanics.abilityPolicy !== 'map-current-canonical-abilities-by-tier-and-slot'
  || evolutionMechanics.movePolicy !== 'retain-current-moves-and-create-bounded-opportunity-attention'
  || evolutionMechanics.skillsCapabilitiesPolicy !== 'adopt-destination-canonical-defaults-and-preserve-explicit-overrides'
  || evolutionMechanics.equipmentPolicy !== 'reconcile-current-equipment-against-destination-species'
  || evolutionMechanics.transitionCount !== evolutionPolicy.transitionCount
  || evolutionMechanics.transitions.length !== evolutionPolicy.transitionCount
  || new Set(evolutionTransitionKeys).size !== evolutionTransitionKeys.length
  || evolutionItemIds.size !== evolutionPolicy.itemCount
  || evolutionRows.length !== evolutionPolicy.itemCount
  || new Set(evolutionRows.map(row => row.canonicalId)).size !== evolutionRows.length
  || evolutionRows.some(row => row.effect.kind !== 'evolve-pokemon'
    || row.effect.transitionPolicyId !== row.canonicalId
    || !evolutionItemIds.has(row.canonicalId)
    || !canonicalItems[row.canonicalId]?.categories.some(category => (
      category === 'Evolutionary Stone' || category === 'Evolutionary Keepsake'
    )))
  || evolutionMechanics.transitions.some(row => row.itemId.length === 0
    || row.fromSpecies.length === 0 || row.toSpecies.length === 0
    || !evolutionSpecies.has(row.fromSpecies) || !evolutionSpecies.has(row.toSpecies)
    || !Number.isSafeInteger(row.minimumLevel) || row.minimumLevel < 0 || row.minimumLevel > 100
    || ![null, 'Male', 'Female'].includes(row.requiredGender))
  || [...evolutionItemIds].some(itemId => !evolutionRows.some(row => row.canonicalId === itemId))) {
  throw new Error('Unsupported or stale reviewed Evolutionary Item mechanics.')
}

const explorationRows = reviewed.specs.filter(row => explorationPolicy.itemIds.includes(row.canonicalId as never))
const expectedRepels = new Map(explorationPolicy.repels.map(row => [row.canonicalId, row]))
if (explorationRows.length !== explorationPolicy.itemIds.length
  || new Set(explorationRows.map(row => row.canonicalId)).size !== explorationRows.length
  || explorationPolicy.itemIds.some(canonicalId => !explorationRows.some(row => row.canonicalId === canonicalId))
  || explorationRows.some(row => {
    const effect = row.effect
    if (row.canonicalId === 'Bait') return effect.kind !== 'use-bait'
      || stableJsonStringify(effect.lure) !== stableJsonStringify(explorationPolicy.routeLure)
      || stableJsonStringify(effect.distraction) !== stableJsonStringify(explorationPolicy.wildDistraction)
    if (row.canonicalId === 'Fishing Lure') return effect.kind !== 'start-route-lure'
      || effect.reusable !== true
      || stableJsonStringify(effect.lure) !== stableJsonStringify(explorationPolicy.routeLure)
      || effect.lossPolicy !== explorationPolicy.fishingLure.lossPolicy
    if (row.canonicalId === 'Honey') return effect.kind !== 'use-snack-or-bait'
      || effect.buffKind !== 'fixed-heal' || effect.amount !== 5
      || effect.denominator !== null || effect.requiredPokemonType !== null
      || stableJsonStringify(effect.lure) !== stableJsonStringify(explorationPolicy.routeLure)
      || stableJsonStringify(effect.distraction) !== stableJsonStringify(explorationPolicy.wildDistraction)
    if (row.canonicalId === 'Dowsing Rod') return effect.kind !== 'search-for-shards'
      || effect.searchMinutes !== explorationPolicy.dowsingRod.searchMinutes
      || effect.dailyUses !== explorationPolicy.dowsingRod.dailyUses
      || effect.baseDice !== explorationPolicy.dowsingRod.baseDice
      || effect.terrainBonusDice !== explorationPolicy.dowsingRod.terrainBonusDice
      || effect.skillStuntDowsingBonusDice !== explorationPolicy.dowsingRod.skillStuntDowsingBonusDice
      || effect.crystalResonanceBonusDice !== explorationPolicy.dowsingRod.crystalResonanceBonusDice
      || effect.successMinimum !== explorationPolicy.dowsingRod.successMinimum
      || effect.rerollOn !== explorationPolicy.dowsingRod.rerollOn
      || stableJsonStringify(effect.shardColors) !== stableJsonStringify(explorationPolicy.dowsingRod.shardColors)
      || effect.areaAuthority !== explorationPolicy.dowsingRod.areaAuthority
    const repel = expectedRepels.get(row.canonicalId as 'Repel' | 'Super Repel' | 'Max Repel')
    return !repel || effect.kind !== 'use-repel'
      || effect.durationMinutes !== repel.durationMinutes
      || effect.maximumAffectedWildLevel !== repel.maximumAffectedWildLevel
      || effect.directBaseAc !== explorationPolicy.repelDirect.accuracyCheck.baseAc
      || effect.positioningAuthority !== explorationPolicy.repelDirect.hitConsequence.positioningAuthority
  })) {
  throw new Error('Unsupported or stale reviewed exploration-item mechanics.')
}

interface GuidedItemAdjudicationContractV1 {
  readonly schemaVersion: 1
  readonly ticket: 'P8-059'
  readonly status: 'reviewed'
  readonly runtimeProseParsing: false
  readonly ruleEvidence: {
    readonly loyaltyRecordSha256: string
    readonly usingItemsRecordSha256: string
  }
  readonly loyalty: {
    readonly choiceId: 'gm-loyalty-outcome'
    readonly targetKind: 'pokemon'
    readonly minimum: 1
    readonly maximum: 1
    readonly options: readonly [
      { readonly optionId: 'record-no-loyalty-change', readonly label: string, readonly outcome: 'no-change', readonly delta: 0 },
      { readonly optionId: 'lower-loyalty-by-one', readonly label: string, readonly outcome: 'decrease-one', readonly delta: -1 },
    ]
    readonly defaultLoyaltyWhenAbsent: 3
    readonly minimumLoyalty: 0
    readonly maximumLoyalty: 6
    readonly decisionRole: 'gm'
    readonly freeformMechanics: false
  }
  readonly inventoryItems: readonly {
    readonly canonicalId: string
    readonly canonicalRecordSha256: string
    readonly canonicalEffectSha256: string
    readonly deterministicEffect: Record<string, unknown>
    readonly targetKinds: readonly ('pokemon' | 'trainer')[]
    readonly timing: 'standard' | 'extended'
    readonly contexts: readonly string[]
  }[]
  readonly consumption: {
    readonly phase: 'gm-adjudication'
    readonly quantity: 1
    readonly reserveWhilePending: true
    readonly refundableOnCancel: true
    readonly reusable: false
  }
  readonly reBreather: {
    readonly canonicalId: 'Re-Breather'
    readonly actionId: 'equipment.re-breather.activate'
    readonly capabilityId: 'Gilled'
    readonly activeMinutes: 60
    readonly openAirRefillMinutes: 5
    readonly openAirAuthority: 'bounded-gm-confirmation'
  }
}

const guidedContract = guidedAdjudicationsJson as unknown as GuidedItemAdjudicationContractV1
const repulsiveItems: ReadonlySet<string> = new Set(reviewed.ruleEvidence.repulsiveMedicinePolicy.items)
if (guidedContract.schemaVersion !== 1 || guidedContract.ticket !== 'P8-059'
  || guidedContract.status !== 'reviewed' || guidedContract.runtimeProseParsing !== false
  || guidedContract.ruleEvidence.loyaltyRecordSha256 !== reviewed.ruleEvidence.loyaltyRecordSha256
  || guidedContract.ruleEvidence.usingItemsRecordSha256 !== reviewed.ruleEvidence.usingItemsRecordSha256
  || guidedContract.loyalty.choiceId !== 'gm-loyalty-outcome'
  || guidedContract.loyalty.options.map(option => `${option.optionId}:${option.delta}`).join(',')
    !== 'record-no-loyalty-change:0,lower-loyalty-by-one:-1'
  || guidedContract.loyalty.defaultLoyaltyWhenAbsent !== 3
  || guidedContract.loyalty.minimumLoyalty !== 0 || guidedContract.loyalty.maximumLoyalty !== 6
  || guidedContract.loyalty.decisionRole !== 'gm' || guidedContract.loyalty.freeformMechanics !== false
  || guidedContract.consumption.phase !== 'gm-adjudication'
  || guidedContract.consumption.quantity !== 1 || guidedContract.consumption.reserveWhilePending !== true
  || guidedContract.consumption.refundableOnCancel !== true || guidedContract.consumption.reusable !== false
  || guidedContract.reBreather.canonicalId !== 'Re-Breather'
  || guidedContract.reBreather.actionId !== 'equipment.re-breather.activate'
  || guidedContract.reBreather.capabilityId !== 'Gilled'
  || guidedContract.reBreather.activeMinutes !== 60
  || guidedContract.reBreather.openAirRefillMinutes !== 5
  || guidedContract.reBreather.openAirAuthority !== 'bounded-gm-confirmation') {
  throw new Error('Unsupported or stale reviewed guided-item adjudication contract.')
}

const guidedRows = guidedContract.inventoryItems.map((contractRow): ReviewedItemEffectRow => {
  const existing = reviewed.specs.find(row => row.canonicalId === contractRow.canonicalId)
  if (existing) {
    if (existing.recordSha256 !== contractRow.canonicalRecordSha256
      || existing.effectSha256 !== contractRow.canonicalEffectSha256) {
      throw new Error(`Guided ItemSpec evidence drifted for ${contractRow.canonicalId}.`)
    }
    return existing
  }
  if (contractRow.canonicalId !== 'Poultices') {
    throw new Error(`Guided ItemSpec ${contractRow.canonicalId} has no reviewed deterministic effect.`)
  }
  return {
    canonicalId: 'Poultices',
    recordSha256: contractRow.canonicalRecordSha256,
    effectSha256: contractRow.canonicalEffectSha256,
    effect: {
      kind: 'apply-medical-treatment', treatmentKind: 'bandages', durationMinutes: 360,
      tickMinutes: 30, healingNumerator: 1, healingDenominator: 8,
      injuryAtCompletion: 1, stopOnHpLoss: true, obeyDailyInjuryLimit: true,
    },
  }
})
if (guidedRows.length !== 5 || new Set(guidedRows.map(row => row.canonicalId)).size !== 5
  || [...repulsiveItems].some(canonicalId => !guidedRows.some(row => row.canonicalId === canonicalId))
  || !guidedRows.some(row => row.canonicalId === 'Poultices')) {
  throw new Error('Guided item adjudication inventory is incomplete or duplicated.')
}

const guidedSpecFor = (row: ReviewedItemEffectRow): ItemSpecV1 => {
  const base = specFor(row)
  const pokemonOnly = repulsiveItems.has(row.canonicalId)
  const contractRow = guidedContract.inventoryItems.find(candidate => candidate.canonicalId === row.canonicalId)
  if (!contractRow || contractRow.timing !== base.timing
    || stableJsonStringify(contractRow.contexts) !== stableJsonStringify(base.contexts)
    || (pokemonOnly && contractRow.targetKinds.join(',') !== 'pokemon')
    || (!pokemonOnly && contractRow.targetKinds.join(',') !== 'pokemon,trainer')) {
    throw new Error(`Guided item context evidence drifted for ${row.canonicalId}.`)
  }
  return parseItemSpec({
    ...base,
    implementationState: 'guided',
    roles: ['usable', 'guided'],
    prerequisites: [
      ...base.prerequisites,
      ...(pokemonOnly && !base.prerequisites.some(prerequisite => prerequisite.kind === 'target-kind')
        ? [{
            prerequisiteId: 'pokemon-target', kind: 'target-kind', values: ['pokemon'],
            unavailableReason: `${row.canonicalId} may target Pokémon only.`,
          }]
        : []),
    ],
    choices: [
      ...base.choices,
      {
        choiceId: guidedContract.loyalty.choiceId,
        kind: 'gm-adjudication',
        minimum: guidedContract.loyalty.minimum,
        maximum: guidedContract.loyalty.maximum,
        optionSource: 'spec',
        options: guidedContract.loyalty.options.map(option => ({ optionId: option.optionId, label: option.label })),
        privateTo: 'gm',
      },
    ],
    consumption: guidedContract.consumption,
    effects: [
      ...base.effects,
      { effectId: 'guided-loyalty', operation: 'guided', outcomeKinds: ['campaign-fact'] },
    ],
    privacy: { sourceInventory: 'actor-owner', choices: 'gm', outcome: 'actor-owner' },
    presentation: {
      label: row.canonicalId,
      description: row.canonicalId === 'Poultices'
        ? 'Complete the reviewed six-hour Bandages treatment through bounded GM Loyalty adjudication before applying or consuming the Poultices.'
        : `${base.presentation.description} A bounded GM Loyalty decision is required before any effect or consumption.`,
      unavailableReason: null,
    },
    registeredHandlerId: 'item.guided.v1',
  })
}

interface GuidedCatalogItemContractV1 {
  readonly schemaVersion: 1
  readonly ticket: 'P8-093'
  readonly status: 'reviewed'
  readonly runtimeProseParsing: false
  readonly catalogSha256: string
  readonly decision: {
    readonly choiceId: string
    readonly optionId: string
    readonly optionLabel: string
    readonly decisionRole: 'gm'
    readonly freeformMechanics: false
  }
  readonly itemCount: number
  readonly registrySha256: string
  readonly items: readonly {
    readonly canonicalId: string
    readonly canonicalRecordSha256: string
    readonly canonicalEffectSha256: string
    readonly contexts: readonly ('campaign' | 'sheet' | 'encounter')[]
    readonly timing: 'standard'
    readonly actionCost: 'none' | 'standard'
    readonly consumption: ItemSpecV1['consumption']
    readonly presentationDescription: string
  }[]
}

const guidedCatalogContract = guidedCatalogItemsJson as unknown as GuidedCatalogItemContractV1
if (guidedCatalogContract.schemaVersion !== 1 || guidedCatalogContract.ticket !== 'P8-093'
  || guidedCatalogContract.status !== 'reviewed' || guidedCatalogContract.runtimeProseParsing !== false
  || guidedCatalogContract.catalogSha256 !== CATALOG_SHA256
  || guidedCatalogContract.itemCount !== 34
  || guidedCatalogContract.items.length !== guidedCatalogContract.itemCount
  || new Set(guidedCatalogContract.items.map(row => row.canonicalId)).size !== guidedCatalogContract.itemCount
  || guidedCatalogContract.decision.choiceId !== ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID
  || guidedCatalogContract.decision.optionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
  || guidedCatalogContract.decision.decisionRole !== 'gm'
  || guidedCatalogContract.decision.freeformMechanics !== false) {
  throw new Error('Unsupported, stale, incomplete, or duplicated guided catalog-item contract.')
}

const guidedCatalogSpecFor = (row: GuidedCatalogItemContractV1['items'][number]): ItemSpecV1 => {
  const item = canonicalItems[row.canonicalId]
  if (!item || item.name !== row.canonicalId
    || sha256(stableJsonStringify(item)) !== row.canonicalRecordSha256
    || sha256(item.effects.join('\n')) !== row.canonicalEffectSha256
    || row.contexts.length < 1
    || row.contexts.some((context, index) => row.contexts.indexOf(context) !== index)
    || row.timing !== 'standard'
    || (row.actionCost === 'standard') !== row.contexts.includes('encounter')
    || row.consumption.phase !== (row.consumption.reusable ? 'never' : 'gm-adjudication')
    || row.consumption.quantity !== (row.consumption.reusable ? 0 : 1)
    || row.consumption.reserveWhilePending !== !row.consumption.reusable
    || row.consumption.refundableOnCancel !== !row.consumption.reusable) {
    throw new Error(`Guided catalog ItemSpec evidence or source disposition drifted for ${row.canonicalId}.`)
  }
  return parseItemSpec({
    schemaVersion: ITEM_SPEC_SCHEMA_VERSION,
    canonicalId: item.name,
    aliases: [...item.aliases],
    implementationState: 'guided',
    contexts: [...row.contexts],
    roles: ['usable', 'guided'],
    timing: row.timing,
    costs: row.actionCost === 'standard'
      ? [{ kind: 'action', resourceId: 'standard', amount: 1, label: '1 Standard Action' }]
      : [],
    prerequisites: [{
      prerequisiteId: 'trainer-actor', kind: 'actor-kind', values: ['trainer'],
      unavailableReason: `${row.canonicalId} guided use requires a Trainer actor.`,
    }],
    targets: [{
      targetId: 'target', kind: 'participant', minimum: 1, maximum: 1,
      relationship: 'self', rangeMeters: null, requiresLineOfSight: false,
    }],
    choices: [{
      choiceId: guidedCatalogContract.decision.choiceId,
      kind: 'gm-adjudication', minimum: 1, maximum: 1, optionSource: 'spec',
      options: [{
        optionId: guidedCatalogContract.decision.optionId,
        label: guidedCatalogContract.decision.optionLabel,
      }],
      privateTo: 'gm',
    }],
    consumption: row.consumption,
    effects: [{ effectId: 'guided-outcome', operation: 'guided', outcomeKinds: ['campaign-fact'] }],
    duration: { kind: 'instant', amount: null },
    privacy: { sourceInventory: 'actor-owner', choices: 'gm', outcome: 'actor-owner' },
    presentation: {
      label: item.name,
      description: row.presentationDescription,
      unavailableReason: null,
    },
    evidence: {
      canonicalCatalogSha256: guidedCatalogContract.catalogSha256,
      canonicalRecordSha256: row.canonicalRecordSha256,
      canonicalEffectSha256: row.canonicalEffectSha256,
      reviewId: `complete-loop-guided-catalog:${item.name}:v1`,
      status: 'reviewed',
    },
    registeredHandlerId: 'item.guided.v1',
  })
}

const definitions: readonly ItemRuntimeDefinition[] = [
  ...reviewed.specs.filter(row => !repulsiveItems.has(row.canonicalId)).map(row => parseItemSpec(specFor(row))),
  ...guidedRows.map(guidedSpecFor),
  ...guidedCatalogContract.items.map(guidedCatalogSpecFor),
]
  .map(spec => ({ canonicalId: spec.canonicalId, definitionSha256: sha256(stableJsonStringify(spec)), spec }))
  .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))

const identity = createItemIdentityRegistry(Object.values(canonicalItems).map(item => ({
  canonicalId: item.name,
  aliases: item.aliases,
})))
const byCanonicalId = new Map(definitions.map(definition => [definition.canonicalId, definition]))
const resolve = (canonicalIdOrAlias: string): ItemRuntimeDefinition | null => {
  const canonicalId = identity.resolve(canonicalIdOrAlias)
  return canonicalId ? byCanonicalId.get(canonicalId) ?? null : null
}

export const ITEM_AUTOMATION_RUNTIME_REGISTRY: ItemRuntimeRegistry = Object.freeze({
  definitions: Object.freeze([...definitions]),
  aliases: identity.aliases,
  resolve,
  require: (canonicalIdOrAlias: string) => resolve(canonicalIdOrAlias)
    ?? (() => { throw new Error(`No executable ItemSpec is registered for ${canonicalIdOrAlias}.`) })(),
})

export const resolveCanonicalItemId = (canonicalIdOrAlias: string): string | null => identity.resolve(canonicalIdOrAlias)

export const ITEM_AUTOMATION_CATALOG_SHA256 = CATALOG_SHA256
