import { AA068_DUST_CLOUD_BURST_BRANCH_ID } from '#shared/abilityAutomation/mechanics'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import type { MoveAutomationScript, MoveAutomationTargetBranch } from '~/types/moveAutomation'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { SheetPlacement } from '~/types/map'
import type { TabletopMap } from '~/types/map'
import {
  effectivenessStepsFromMultiplier,
  multiplierFromEffectivenessSteps,
} from '~/utils/typeChart'
import { moveAutomationTargetBranches } from '~/utils/moveAutomationTargetBranches'
import { normalizeConditionNames } from '~/utils/statusConditions'

export { AA068_DUST_CLOUD_BURST_BRANCH_ID }

export const AA068_DUST_CLOUD_TARGETING_OVERRIDE = Object.freeze({
  kind: 'area' as const,
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' as const },
  predicate: { relationship: 'any' as const, willingness: 'any' as const, excludeActor: true },
})
export const AA068_DRAGONS_MAW_REASON = 'ability.dragons-maw.optional-vulnerability' as const
export const AA068_DREAM_SMOKE_REASON = 'ability.dream-smoke.optional-sleep' as const
export const AA068_DROWN_OUT_REASON = 'ability.drown-out.optional-cancel' as const
export const AA068_EFFECT_SPORE_REASON = 'ability.effect-spore.optional-condition' as const
export const AA068_DRY_SKIN_FIRE_REASON = 'ability.dry-skin.fire-hit-tick' as const
export const AA068_DRY_SKIN_WATER_REASON = 'ability.dry-skin.water-hit-heal' as const

const canonicalKeyword = (value: string): string => value.trim().toLowerCase()
const hasKeyword = (script: Pick<MoveAutomationScript, 'keywords'>, keyword: string): boolean => (
  script.keywords.some(candidate => canonicalKeyword(candidate) === keyword)
)

export const aa068IsDamagingMove = (
  script: Pick<MoveAutomationScript, 'damageClass'>,
): boolean => script.damageClass === 'Physical' || script.damageClass === 'Special'

export const aa068IsMeleeAttack = (
  script: Pick<MoveAutomationScript, 'range'>,
): boolean => /\bmelee\b/i.test(script.range)

export const aa068IsSonicMove = (
  script: Pick<MoveAutomationScript, 'keywords'>,
): boolean => hasKeyword(script, 'sonic')

export const aa068IsPowderMove = (
  script: Pick<MoveAutomationScript, 'keywords'>,
): boolean => hasKeyword(script, 'powder')

export const aa068IsWaterMove = (
  script: Pick<MoveAutomationScript, 'type'>,
): boolean => script.type.trim().toLowerCase() === 'water'

export const aa068DrySkinCancelsRecipientEffect = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'type'>
  readonly recipientId: string
  readonly operationReasonCode: string
  readonly operationKind: string
}): boolean => aa068IsWaterMove(input.script)
  && input.context.queries.abilities.has(input.recipientId, 'Dry Skin')
  && input.operationKind !== 'accuracy'
  && input.operationKind !== 'roll'
  && input.operationKind !== 'damage'
  && input.operationKind !== 'usage'
  && input.operationKind !== 'log'
  && input.operationReasonCode !== AA068_DRY_SKIN_WATER_REASON

const oneStepMoreEffective = (multiplier: number, immuneResistanceSteps: number | null): number => {
  const base = multiplier === 0 && immuneResistanceSteps !== null
    ? multiplierFromEffectivenessSteps(-immuneResistanceSteps)
    : multiplier
  const steps = effectivenessStepsFromMultiplier(base)
  return steps === null ? base : multiplierFromEffectivenessSteps(steps + 1)
}

const relationForMultiplier = (
  multiplier: number,
): MoveDamageTypeResolution['finalRelation'] => multiplier === 0
  ? 'immune'
  : multiplier < 1
    ? 'resistant'
    : multiplier > 1
      ? 'weak'
      : 'neutral'

/** Apply final AA-068 type/STAB rules after every ordinary type modifier. */
export const aa068DamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
  readonly naturalAccuracyRoll: number | null
  readonly dragonsMawSelected: boolean
}): MoveDamageTypeResolution => {
  let finalMultiplier = input.resolved.finalMultiplier
  let immunitySource = input.resolved.immunitySource
  let hasStab = input.resolved.hasStab
  const passiveSources = [...input.resolved.passiveSources]

  if (input.context.queries.abilities.has(input.recipientId, 'Dry Skin')
    && input.resolved.moveType === 'Water') {
    finalMultiplier = 0
    immunitySource = 'Dry Skin'
    passiveSources.push('Dry Skin')
  }

  if (input.dragonsMawSelected) {
    finalMultiplier = oneStepMoreEffective(finalMultiplier, 2)
    immunitySource = null
    passiveSources.push('Dragon’s Maw')
  }

  const eggscellence = ['Barrage', 'Egg Bomb'].includes(input.script.moveName)
    && input.context.queries.abilities.has(input.context.actor.placement.id, 'Eggscellence')
  if (eggscellence) {
    hasStab = true
    passiveSources.push('Eggscellence')
    const normalTyped = input.context.actor.token.defenderTypes
      .some(type => type.trim().toLowerCase() === 'normal')
    if (normalTyped && (input.naturalAccuracyRoll ?? 0) >= 16) {
      finalMultiplier = oneStepMoreEffective(finalMultiplier, null)
      if (finalMultiplier > 0) immunitySource = null
    }
  }

  return Object.freeze({
    ...input.resolved,
    passiveSources: Object.freeze(passiveSources),
    finalMultiplier,
    finalRelation: relationForMultiplier(finalMultiplier),
    immunitySource,
    hasStab,
  })
}

export const aa068DustCloudBurstEnabled = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'keywords'>
  readonly targetBranchId: string | null | undefined
}): boolean => input.targetBranchId === AA068_DUST_CLOUD_BURST_BRANCH_ID
  && aa068IsPowderMove(input.script)
  && input.context.queries.abilities.has(input.context.actor.placement.id, 'Dust Cloud')

export const aa068DustCloudPresentationScript = (input: {
  readonly script: MoveAutomationScript
  readonly active: boolean
}): MoveAutomationScript => {
  if (!input.active || !aa068IsPowderMove(input.script)) return input.script
  const branches = moveAutomationTargetBranches(input.script)
  if (branches.some(branch => branch.id === AA068_DUST_CLOUD_BURST_BRANCH_ID)) return input.script
  const burst: MoveAutomationTargetBranch = {
    id: AA068_DUST_CLOUD_BURST_BRANCH_ID,
    label: 'Dust Cloud — Burst 1',
    targetMode: 'multi-target',
    targetCount: null,
    range: 'Burst 1',
    areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
  }
  return {
    ...input.script,
    targetBranches: [...branches, burst],
  }
}

export const aa068DustCloudSelectedScript = (input: {
  readonly script: MoveAutomationScript
  readonly active: boolean
  readonly targetBranchId: string | null | undefined
}): MoveAutomationScript => {
  if (!input.active
    || input.targetBranchId !== AA068_DUST_CLOUD_BURST_BRANCH_ID
    || !aa068IsPowderMove(input.script)) return input.script
  return {
    ...input.script,
    targetMode: 'multi-target',
    targetCount: null,
    range: 'Burst 1',
    areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
    targetBranches: aa068DustCloudPresentationScript({ script: input.script, active: true }).targetBranches,
  }
}

const earlyBirdEffective = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
}): boolean => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Early Bird')
  if (!runtime) return false
  return projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === 'Early Bird'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
}

export const aa068EarlyBirdInitiativeActive = earlyBirdEffective

export const aa068EarlyBirdSleepSaveBonus = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly condition: string
}): number => normalizeConditionNames([input.condition]).includes('Sleep')
  && earlyBirdEffective(input) ? 3 : 0
