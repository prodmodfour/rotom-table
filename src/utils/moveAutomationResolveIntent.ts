import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import type { GridAnchor } from '~/types/map'
import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'

interface MoveAutomationResolveIntentBaseInput {
  readonly actorPlacementId: string
  readonly moveName: string
  readonly targetBranchId?: string | null
}

export interface BuildSelfMoveAutomationResolveIntentInput extends MoveAutomationResolveIntentBaseInput {
  readonly kind: 'self'
}

export interface BuildSingleTargetMoveAutomationResolveIntentInput extends MoveAutomationResolveIntentBaseInput {
  readonly kind: 'single-target'
  readonly targetPlacementId: string
}

export interface BuildTargetCountMoveAutomationResolveIntentInput extends MoveAutomationResolveIntentBaseInput {
  readonly kind: 'target-count'
  readonly targetPlacementIds: readonly string[]
}

export interface BuildAreaMoveAutomationResolveIntentInput extends MoveAutomationResolveIntentBaseInput {
  readonly kind: 'area'
  readonly areaTemplateId: string
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
  readonly excludedTargetPlacementIds?: readonly string[]
  readonly candidateTargetPlacementIds?: readonly string[]
}

export interface BuildPassMoveAutomationResolveIntentInput extends MoveAutomationResolveIntentBaseInput {
  readonly kind: 'pass'
  readonly areaTemplateId: string
  readonly direction: MoveAutomationAreaDirection
  readonly excludedTargetPlacementIds?: readonly string[]
  readonly candidateTargetPlacementIds?: readonly string[]
}

export type BuildMoveAutomationResolveIntentInput =
  | BuildSelfMoveAutomationResolveIntentInput
  | BuildSingleTargetMoveAutomationResolveIntentInput
  | BuildTargetCountMoveAutomationResolveIntentInput
  | BuildAreaMoveAutomationResolveIntentInput
  | BuildPassMoveAutomationResolveIntentInput

export interface BuildMoveAutomationResolveIntentResult {
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds?: readonly string[]
}

const nonEmptyTrimmed = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const normalizedStringArray = (values: readonly string[] | null | undefined): string[] => {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of values ?? []) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

const cloneGridAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const baseIntentFields = (input: MoveAutomationResolveIntentBaseInput) => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: input.actorPlacementId.trim(),
  moveName: input.moveName.trim(),
  ...(nonEmptyTrimmed(input.targetBranchId) ? { targetBranchId: nonEmptyTrimmed(input.targetBranchId) } : {}),
})

const areaCandidateScopePlacementIds = (
  input: BuildAreaMoveAutomationResolveIntentInput | BuildPassMoveAutomationResolveIntentInput,
): readonly string[] | undefined => {
  const ids = normalizedStringArray(input.candidateTargetPlacementIds)
  return ids.length ? ids : undefined
}

const areaExcludedTargetPlacementIds = (
  input: BuildAreaMoveAutomationResolveIntentInput | BuildPassMoveAutomationResolveIntentInput,
): readonly string[] | undefined => {
  const ids = normalizedStringArray(input.excludedTargetPlacementIds)
  return ids.length ? ids : undefined
}

export const buildMoveAutomationResolveIntent = (
  input: BuildMoveAutomationResolveIntentInput,
): BuildMoveAutomationResolveIntentResult => {
  if (input.kind === 'self') {
    return {
      intent: {
        ...baseIntentFields(input),
        selection: { kind: 'self' },
      },
    }
  }

  if (input.kind === 'single-target') {
    return {
      intent: {
        ...baseIntentFields(input),
        selection: {
          kind: 'single-target',
          targetPlacementId: input.targetPlacementId.trim(),
        },
      },
    }
  }

  if (input.kind === 'target-count') {
    return {
      intent: {
        ...baseIntentFields(input),
        selection: {
          kind: 'target-count',
          targetPlacementIds: normalizedStringArray(input.targetPlacementIds),
        },
      },
    }
  }

  if (input.kind === 'pass') {
    const excludedTargetPlacementIds = areaExcludedTargetPlacementIds(input)
    const candidateScopePlacementIds = areaCandidateScopePlacementIds(input)
    return {
      intent: {
        ...baseIntentFields(input),
        selection: {
          kind: 'area',
          areaTemplateId: input.areaTemplateId.trim(),
          direction: input.direction,
          ...(excludedTargetPlacementIds?.length ? { excludedTargetPlacementIds } : {}),
        },
      },
      ...(candidateScopePlacementIds?.length ? { candidateScopePlacementIds } : {}),
    }
  }

  const excludedTargetPlacementIds = areaExcludedTargetPlacementIds(input)
  const candidateScopePlacementIds = areaCandidateScopePlacementIds(input)
  return {
    intent: {
      ...baseIntentFields(input),
      selection: {
        kind: 'area',
        areaTemplateId: input.areaTemplateId.trim(),
        ...(input.direction && !input.aimCell ? { direction: input.direction } : {}),
        ...(input.aimCell ? { aimCell: cloneGridAnchor(input.aimCell) } : {}),
        ...(excludedTargetPlacementIds?.length ? { excludedTargetPlacementIds } : {}),
      },
    },
    ...(candidateScopePlacementIds?.length ? { candidateScopePlacementIds } : {}),
  }
}
