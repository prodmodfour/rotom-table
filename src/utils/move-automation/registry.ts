import { findMove, moves } from '~~/data/ptuReference'
import { REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS } from '~/utils/move-automation/scripts/additionalSingleTarget'
import {
  REVIEWED_ALLY_AREA_STAGE_SCRIPTS,
  REVIEWED_AREA_COAT_SCRIPTS,
  REVIEWED_AREA_CONDITION_SCRIPTS,
  REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  REVIEWED_MIXED_TARGET_AREA_SCRIPTS,
  REVIEWED_PASS_SCRIPTS,
  REVIEWED_SMOG_SCRIPTS,
  REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
} from '~/utils/move-automation/scripts/area'
import { REVIEWED_DIRECT_HP_LOSS_SCRIPTS } from '~/utils/move-automation/scripts/directHpLoss'
import { REVIEWED_SELF_SCRIPTS } from '~/utils/move-automation/scripts/self'
import {
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS,
  STRUGGLE_ATTACK_SCRIPTS,
} from '~/utils/move-automation/scripts/singleTargetAttacks'
import { REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetConditions'
import { REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetStages'
import { REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS } from '~/utils/move-automation/scripts/singleTargetStatus'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { hasNativeMoveAutomationPresentation } from '~/utils/move-automation/nativePresentation'

const SEAMLESS_AREA_CONFIRMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map([
  ...REVIEWED_TARGET_STAGE_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONFIRMATION_SCRIPTS,
  ...REVIEWED_MIXED_TARGET_AREA_SCRIPTS,
  ...REVIEWED_AREA_CONDITION_SCRIPTS,
  ...REVIEWED_SMOG_SCRIPTS,
  ...REVIEWED_AREA_COAT_SCRIPTS,
  ...REVIEWED_ALLY_AREA_STAGE_SCRIPTS,
  ...REVIEWED_PASS_SCRIPTS,
])

const hasReviewedSeamlessSingleTargetScript = (script: MoveAutomationScript): boolean =>
  SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS.has(script.moveName)
  || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
  || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
  || REVIEWED_MIXED_TARGET_AREA_SCRIPTS.has(script.moveName)
  || hasNativeMoveAutomationPresentation(script.moveName)
  || (REVIEWED_DIRECT_HP_LOSS_SCRIPTS.has(script.moveName) && Boolean(script.directHpLoss))

export const isSeamlessSingleTargetAttackScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && (
      SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS.has(script.moveName)
      || REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS.has(script.moveName)
      || REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS.has(script.moveName)
    )
    && script.targetMode === 'one-target'
    && script.targetCount === 1
    && script.damaging,
)

export const isSeamlessSingleTargetMoveScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => {
  if (!script) return false
  return Boolean(
    script.kind === 'explicit'
      && hasReviewedSeamlessSingleTargetScript(script)
      && script.targetMode === 'one-target'
      && script.targetCount === 1,
  )
}

export const isSeamlessSelfMoveScript = (
  script: MoveAutomationScript | null | undefined,
): boolean => Boolean(
  script
    && script.kind === 'explicit'
    && (
      REVIEWED_SELF_SCRIPTS.has(script.moveName)
      || hasNativeMoveAutomationPresentation(script.moveName)
    )
    && script.targetMode === 'self'
    && script.targetCount === 1
    && !script.requiresAccuracy,
)

export const isSeamlessAreaConfirmationScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && (
      SEAMLESS_AREA_CONFIRMATION_SCRIPTS.has(script.moveName)
      || hasNativeMoveAutomationPresentation(script.moveName)
    )
    && script.targetMode === 'multi-target'
    && script.areaTemplates?.length,
)

export const isSeamlessTargetCountMoveScript = (
  script: MoveAutomationScript | null | undefined,
): script is MoveAutomationScript => Boolean(
  script
    && script.kind === 'explicit'
    && script.targetMode === 'multi-target'
    && typeof script.targetCount === 'number'
    && Number.isInteger(script.targetCount)
    && script.targetCount > 1
    && !script.areaTemplates?.length,
)

/**
 * Explicit v1 move automation scripts. Registry presence means a script is
 * available; it does not claim that every canonical clause or cross-cutting
 * interaction is complete. Durable post-commit ability windows remain
 * assisted until their canonical interrupt timing is certified. Small
 * factories may copy canonical move data, but this registry stays
 * an allow-list of reviewed v1 implementations.
 */
export interface ExplicitMoveAutomationRegistrySource {
  readonly sourceModule: string
  readonly scripts: ReadonlyMap<string, MoveAutomationScript>
}

export type ExplicitMoveAutomationRegistryValidationCode =
  | 'duplicate-id'
  | 'canonical-id-mismatch'

export class ExplicitMoveAutomationRegistryValidationError extends Error {
  readonly code: ExplicitMoveAutomationRegistryValidationCode
  readonly canonicalId: string

  constructor(
    code: ExplicitMoveAutomationRegistryValidationCode,
    canonicalId: string,
    message: string,
  ) {
    super(message)
    this.name = 'ExplicitMoveAutomationRegistryValidationError'
    this.code = code
    this.canonicalId = canonicalId
  }
}

/**
 * Source ownership for the v1 allow-list. Report tooling reads these same
 * groups so source attribution cannot drift from the runtime registry.
 */
export const EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES: readonly ExplicitMoveAutomationRegistrySource[] = Object.freeze([
  {
    sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
    scripts: new Map([
      ...STRUGGLE_ATTACK_SCRIPTS,
      ...SEAMLESS_SINGLE_TARGET_ATTACK_SCRIPTS,
    ]),
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/singleTargetConditions.ts',
    scripts: REVIEWED_SINGLE_TARGET_CONDITION_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/singleTargetStatus.ts',
    scripts: REVIEWED_SINGLE_TARGET_STATUS_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/singleTargetStages.ts',
    scripts: REVIEWED_SINGLE_TARGET_STAGE_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/additionalSingleTarget.ts',
    scripts: REVIEWED_ADDITIONAL_SINGLE_TARGET_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/self.ts',
    scripts: REVIEWED_SELF_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/area.ts',
    scripts: SEAMLESS_AREA_CONFIRMATION_SCRIPTS,
  },
  {
    sourceModule: 'src/utils/move-automation/scripts/directHpLoss.ts',
    scripts: REVIEWED_DIRECT_HP_LOSS_SCRIPTS,
  },
])

export const createExplicitMoveAutomationScriptRegistry = (
  sources: readonly ExplicitMoveAutomationRegistrySource[],
): ReadonlyMap<string, MoveAutomationScript> => {
  const registry = new Map<string, MoveAutomationScript>()
  for (const { sourceModule, scripts } of sources) {
    for (const [canonicalId, script] of scripts) {
      if (canonicalId !== script.moveName) {
        throw new ExplicitMoveAutomationRegistryValidationError(
          'canonical-id-mismatch',
          canonicalId,
          `Move automation registry key ${JSON.stringify(canonicalId)} in ${sourceModule} does not match script moveName ${JSON.stringify(script.moveName)}.`,
        )
      }
      if (registry.has(canonicalId)) {
        throw new ExplicitMoveAutomationRegistryValidationError(
          'duplicate-id',
          canonicalId,
          `Move automation registry contains duplicate canonical ID ${JSON.stringify(canonicalId)}.`,
        )
      }
      registry.set(canonicalId, script)
    }
  }
  return registry
}

export const EXPLICIT_MOVE_AUTOMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> =
  createExplicitMoveAutomationScriptRegistry(EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES)

export const moveAutomationCoverage = {
  canonicalMoveCount: moves.length,
  explicitScriptCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
  missing: moves
    .filter((move) => !EXPLICIT_MOVE_AUTOMATION_SCRIPTS.has(move.name))
    .map((move) => move.name),
}

export const explicitScriptForMove = (moveName: string): MoveAutomationScript | null => {
  const direct = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
  if (direct) return direct

  const canonical = findMove(moveName)
  return canonical ? EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(canonical.name) ?? null : null
}
