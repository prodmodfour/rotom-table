import { LIVE_PLAY_COMMAND_TYPES, type LivePlayMapCommandType } from '#shared/livePlayCommands'

export type LivePlayBatchCommandType =
  | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS
  | typeof LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS
  | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS
  | typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS

export interface LivePlayBatchCommandSummaryContext {
  readonly hazardCount?: number | null
  readonly fieldEffectCount?: number | null
}

export interface LivePlayBatchCommandSummaryInput {
  readonly commandType?: unknown
  readonly body?: Readonly<Record<string, unknown>> | null
  readonly context?: LivePlayBatchCommandSummaryContext
}

export interface LivePlayBatchCommandSummary {
  readonly title: string
  readonly pendingLabel: string
  readonly recoveryLabel: string
}

const BATCH_COMMAND_TYPES = new Set<unknown>([
  LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
])

const FIELD_EFFECT_CATEGORIES = new Set<unknown>(['all', 'weather', 'terrain', 'room'])

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const finiteCount = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const arrayCount = (value: unknown): number | null => (Array.isArray(value) ? value.length : null)

const countLabel = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
)

const titleForBatchCommand = (commandType: LivePlayBatchCommandType): string => {
  switch (commandType) {
    case LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS:
      return 'Clear hazards'
    case LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS:
      return 'Edit hazards'
    case LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS:
      return 'Clear field effects'
    case LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS:
      return 'Edit terrain voxels'
  }
}

export const isLivePlayBatchCommandType = (value: unknown): value is LivePlayBatchCommandType => (
  BATCH_COMMAND_TYPES.has(value)
)

const commandTypeFromInput = (input: LivePlayBatchCommandSummaryInput): LivePlayBatchCommandType | null => {
  if (isLivePlayBatchCommandType(input.commandType)) return input.commandType
  if (isLivePlayBatchCommandType(input.body?.type)) return input.body.type
  return null
}

const payloadFromBody = (body: Readonly<Record<string, unknown>> | null | undefined): Readonly<Record<string, unknown>> | null => (
  isRecord(body?.payload) ? body.payload : null
)

const operationBreakdown = (
  operations: unknown,
  labels: { readonly upsertOnly: (count: number) => string; readonly removeOnly: (count: number) => string; readonly mixed: (count: number) => string },
): string | null => {
  if (!Array.isArray(operations)) return null
  const total = operations.length
  let upsertCount = 0
  let removeCount = 0

  for (const operation of operations) {
    if (!isRecord(operation)) continue
    if (operation.action === 'upsert') upsertCount += 1
    if (operation.action === 'remove') removeCount += 1
  }

  if (total === 0) return null
  if (upsertCount > 0 && removeCount === 0) return labels.upsertOnly(total)
  if (removeCount > 0 && upsertCount === 0) return labels.removeOnly(total)
  return labels.mixed(total)
}

const clearHazardsSummary = (
  payload: Readonly<Record<string, unknown>>,
  context?: LivePlayBatchCommandSummaryContext,
): Pick<LivePlayBatchCommandSummary, 'pendingLabel' | 'recoveryLabel'> | null => {
  if (payload.mode === 'all') {
    const hazardCount = finiteCount(context?.hazardCount)
    const target = hazardCount === null ? 'all hazards' : countLabel(hazardCount, 'hazard')
    return {
      pendingLabel: `Clearing ${target}…`,
      recoveryLabel: `Clearing ${target}`,
    }
  }

  if (payload.mode === 'cells') {
    const cellCount = arrayCount(payload.cells)
    if (cellCount === null || cellCount === 0) return null
    const target = countLabel(cellCount, 'hazard cell')
    return {
      pendingLabel: `Clearing ${target}…`,
      recoveryLabel: `Clearing ${target}`,
    }
  }

  if (payload.mode === 'kind') {
    return {
      pendingLabel: 'Clearing matching hazards…',
      recoveryLabel: 'Clearing matching hazards',
    }
  }

  return null
}

const editHazardsSummary = (
  payload: Readonly<Record<string, unknown>>,
): Pick<LivePlayBatchCommandSummary, 'pendingLabel' | 'recoveryLabel'> | null => {
  const label = operationBreakdown(payload.operations, {
    upsertOnly: (count) => `Applying hazard brush (${countLabel(count, 'cell')})`,
    removeOnly: (count) => `Removing ${countLabel(count, 'hazard cell')}`,
    mixed: (count) => `Applying hazard brush (${countLabel(count, 'cell')})`,
  })
  if (!label) return null
  return {
    pendingLabel: `${label}…`,
    recoveryLabel: label,
  }
}

const clearFieldEffectsSummary = (
  payload: Readonly<Record<string, unknown>>,
  context?: LivePlayBatchCommandSummaryContext,
): Pick<LivePlayBatchCommandSummary, 'pendingLabel' | 'recoveryLabel'> | null => {
  if (!FIELD_EFFECT_CATEGORIES.has(payload.category)) return null

  if (payload.category === 'all') {
    const fieldEffectCount = finiteCount(context?.fieldEffectCount)
    const target = fieldEffectCount === null ? 'all field effects' : countLabel(fieldEffectCount, 'field effect')
    return {
      pendingLabel: `Clearing ${target}…`,
      recoveryLabel: `Clearing ${target}`,
    }
  }

  const category = payload.category as 'weather' | 'terrain' | 'room'
  const kindCount = arrayCount(payload.kinds)
  const target = kindCount && kindCount > 0
    ? `${countLabel(kindCount, `${category} effect`)}`
    : `${category} effects`
  return {
    pendingLabel: `Clearing ${target}…`,
    recoveryLabel: `Clearing ${target}`,
  }
}

const editTerrainVoxelsSummary = (
  payload: Readonly<Record<string, unknown>>,
): Pick<LivePlayBatchCommandSummary, 'pendingLabel' | 'recoveryLabel'> | null => {
  const label = operationBreakdown(payload.operations, {
    upsertOnly: (count) => `Building ${countLabel(count, 'terrain voxel')}`,
    removeOnly: (count) => `Removing ${countLabel(count, 'terrain voxel')}`,
    mixed: (count) => `Applying terrain brush (${countLabel(count, 'cell')})`,
  })
  if (!label) return null
  return {
    pendingLabel: `${label}…`,
    recoveryLabel: label,
  }
}

const commandSpecificSummary = (
  commandType: LivePlayBatchCommandType,
  payload: Readonly<Record<string, unknown>>,
  context?: LivePlayBatchCommandSummaryContext,
): Pick<LivePlayBatchCommandSummary, 'pendingLabel' | 'recoveryLabel'> | null => {
  switch (commandType) {
    case LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS:
      return clearHazardsSummary(payload, context)
    case LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS:
      return editHazardsSummary(payload)
    case LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS:
      return clearFieldEffectsSummary(payload, context)
    case LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS:
      return editTerrainVoxelsSummary(payload)
  }
}

export const buildLivePlayBatchCommandSummary = (
  input: LivePlayBatchCommandSummaryInput,
): LivePlayBatchCommandSummary | null => {
  const commandType = commandTypeFromInput(input)
  const payload = payloadFromBody(input.body)
  if (!commandType || !payload) return null

  const summary = commandSpecificSummary(commandType, payload, input.context)
  if (!summary) return null

  return {
    title: titleForBatchCommand(commandType),
    ...summary,
  }
}

export const buildLivePlayBatchPendingLabel = (
  commands: readonly { readonly commandType: LivePlayMapCommandType; readonly body: Readonly<Record<string, unknown>> }[],
  context?: LivePlayBatchCommandSummaryContext,
): string | null => {
  const labels = commands
    .map((command) => buildLivePlayBatchCommandSummary({
      commandType: command.commandType,
      body: command.body,
      context,
    })?.pendingLabel ?? null)
    .filter((label): label is string => label !== null)

  if (labels.length === 0) return null
  if (labels.length === 1) return labels[0] ?? null

  const remaining = labels.length - 1
  return `${labels[0]} (+${remaining} more batch ${remaining === 1 ? 'command' : 'commands'})`
}
