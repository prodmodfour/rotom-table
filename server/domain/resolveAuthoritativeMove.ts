import { MOVE_AUTOMATION_AREA_DIRECTIONS } from '~/types/moveAutomation'
import type { ResolveMoveIntent, ResolveMoveSelection } from '#shared/livePlayMoveResolution'
import { LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS } from '#shared/livePlayMoveResolution'
import { moveUsageKey } from '~/utils/moveUsage'
import {
  isSeamlessAreaConfirmationScript,
  isSeamlessSelfMoveScript,
  isSeamlessSingleTargetMoveScript,
  isSeamlessTargetCountMoveScript,
  moveAutomationHasMultipleTargetBranches,
  moveAutomationScriptForTargetBranch,
  moveAutomationTargetBranches,
} from '~/utils/moveAutomation'
import { moveAutomationCanResolveDamageAtRuntime } from '~/utils/moveAutomationDynamicDamage'
import { moveAutomationStatusDetailsText } from '~/utils/moveAutomationSemanticStatus'
import { moveAutomationScriptForConfirmedAreaTemplate } from '~/utils/moveAutomationConfirmedAreaTemplate'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacementAtCenter,
  buildMoveAutomationCloseBlastPlacementAtAimCell,
  buildMoveAutomationPassPlacement,
  moveAutomationAreaTemplateId,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import {
  resolveInstantAreaMoveAutomation,
  resolveInstantMoveAutomation,
  resolveInstantMultiTargetMoveAutomation,
  resolveInstantSelfMoveAutomation,
  resolveInstantTargetMoveAutomation,
} from '~/utils/moveAutomationInstant'
import {
  moveAutomationTargetsInRange,
  parseExplicitMultiTargetMoveRangeMeters,
  parseSingleTargetMoveRangeMeters,
} from '~/utils/moveAutomationRange'
import { passDestinationLogLine } from '~/utils/moveAutomationPass'
import { tokenFacingForPlacement, tokenFacingFromAreaDirection, tokenFacingTowardPoint } from '~/utils/tokenFacing'
import { buildAllVoxelOccupancy } from '~/utils/voxelOccupancy'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaTemplate,
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { MoveAutomationConditionImmunityContext } from '~/utils/moveAutomationConditionImmunity'
import {
  AuthoritativeMoveRulesContextError,
  buildAuthoritativeMoveRulesContext,
  deduplicateAuthoritativeMoveSheetReads as deduplicateContextSheetReads,
  type AuthoritativeMoveRulesContext,
  type AuthoritativeMoveSheetRead,
} from './moveAutomation/context'

export type { AuthoritativeMoveSheetRead } from './moveAutomation/context'

export type AuthoritativeMoveResolutionFailureReason =
  | 'invalid'
  | 'not-found'
  | 'unauthorized-state'
  | 'conflict'
  | 'unsupported'

export type AuthoritativeMoveResolutionFailureCode =
  | 'actor-placement-missing'
  | 'actor-sheet-missing'
  | 'actor-token-unresolved'
  | 'duplicate-placement-id'
  | 'move-absent'
  | 'move-automation-blocked'
  | 'move-condition-blocked'
  | 'move-usage-unavailable'
  | 'move-usage-key-invalid'
  | 'target-branch-required'
  | 'target-branch-invalid'
  | 'target-branch-unexpected'
  | 'selection-kind-mismatch'
  | 'target-placement-missing'
  | 'target-sheet-missing'
  | 'target-token-unresolved'
  | 'target-out-of-range'
  | 'duplicate-target-id'
  | 'empty-target-selection'
  | 'too-many-targets'
  | 'area-template-invalid'
  | 'area-placement-missing'
  | 'area-placement-unexpected'
  | 'area-direction-illegal'
  | 'area-aim-cell-illegal'
  | 'area-geometry-empty'
  | 'area-friendly-exclusion-invalid'
  | 'pass-direction-required'
  | 'pass-aim-cell-unexpected'
  | 'pass-destination-unavailable'
  | 'pass-geometry-empty'
  | 'unsupported-range'
  | 'unsupported-damage-resolution'
  | 'unsupported-move-script'
  | 'sheet-read-revision-conflict'

export class AuthoritativeMoveResolutionError extends Error {
  readonly reason: AuthoritativeMoveResolutionFailureReason
  readonly code: AuthoritativeMoveResolutionFailureCode

  constructor(
    reason: AuthoritativeMoveResolutionFailureReason,
    code: AuthoritativeMoveResolutionFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthoritativeMoveResolutionError'
    this.reason = reason
    this.code = code
  }
}

export interface ResolveAuthoritativeMoveInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly random?: () => number
  readonly now?: () => number
  readonly idFactory?: () => string
}

export interface AuthoritativeMoveArea {
  readonly areaTemplateId: string
  readonly template: MoveAutomationAreaTemplate
  readonly cells: readonly GridAnchor[]
  readonly candidateTargetIds: readonly string[]
  readonly excludedTargetIds: readonly string[]
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
}

export interface AuthoritativeMovePassMovement {
  readonly kind: 'pass'
  readonly from: GridAnchor
  readonly destination: GridAnchor
  readonly direction: MoveAutomationAreaDirection
  readonly pathCells: readonly GridAnchor[]
}

export interface AuthoritativeMoveResolution {
  readonly actorPlacementId: string
  readonly moveName: string
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly targetBranchId?: string
  readonly selectedTargetIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly feedback?: MoveAutomationFeedbackState
  readonly desiredFacing?: TokenFacingDirection
  readonly area?: AuthoritativeMoveArea
  readonly movement?: AuthoritativeMovePassMovement
}

type UnfinalizedAuthoritativeMoveResolution = Omit<AuthoritativeMoveResolution, 'sheetReads'>

const fail = (
  reason: AuthoritativeMoveResolutionFailureReason,
  code: AuthoritativeMoveResolutionFailureCode,
  message: string,
): never => {
  throw new AuthoritativeMoveResolutionError(reason, code, message)
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const selectedTargetIdsForSelection = (selection: ResolveMoveSelection): readonly string[] => {
  if (selection.kind === 'self' || selection.kind === 'area') return []
  if (selection.kind === 'single-target') return [selection.targetPlacementId]
  return selection.targetPlacementIds
}

export const deduplicateAuthoritativeMoveSheetReads = (
  reads: readonly AuthoritativeMoveSheetRead[],
): AuthoritativeMoveSheetRead[] => {
  try {
    return deduplicateContextSheetReads(reads)
  }
  catch (error) {
    return fail(
      'conflict',
      'sheet-read-revision-conflict',
      error instanceof Error ? error.message : 'A sheet was observed at conflicting revisions.',
    )
  }
}

const recordSheetReadForPlacement = (
  context: AuthoritativeMoveRulesContext,
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): void => context.reads.recordPlacement(placement)

const recordSheetReadsForTokens = (
  context: AuthoritativeMoveRulesContext,
  tokens: readonly SpawnedPokemon[],
): void => {
  for (const token of tokens) context.reads.recordToken(token)
}

const scriptConsultsSweetVeilProviders = (script: MoveAutomationScript): boolean =>
  script.conditionSuggestions.some((suggestion) => (
    suggestion.recipient === 'target'
    && (suggestion.action ?? 'add') === 'add'
    && normalizeConditionName(suggestion.condition) === 'Sleep'
  ))

const authoritativeConditionImmunityContext = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): MoveAutomationConditionImmunityContext => {
  if (!scriptConsultsSweetVeilProviders(script)) return {}

  return {
    sweetVeilProviderCandidates: context.queries.tokens.all(),
    isAlly: (provider, target) => {
      const providerPlacement = context.queries.placements.get(provider.id)
      const targetPlacement = context.queries.placements.get(target.id)
      if (
        !providerPlacement
        || !targetPlacement
        || !context.queries.relationships.ally(providerPlacement, targetPlacement)
      ) {
        return false
      }
      recordSheetReadForPlacement(context, providerPlacement)
      return true
    },
  }
}

const finalizeResolution = (
  context: AuthoritativeMoveRulesContext,
  resolution: UnfinalizedAuthoritativeMoveResolution,
): AuthoritativeMoveResolution => ({
  ...resolution,
  sheetReads: context.reads.snapshot(),
})

const resolveSelectedTarget = (
  context: AuthoritativeMoveRulesContext,
  targetId: string,
): { placement: SheetPlacement; token: SpawnedPokemon } => {
  const placement = context.queries.placements.get(targetId)
    ?? fail('not-found', 'target-placement-missing', `Target placement ${targetId} was not found.`)

  const token = context.queries.tokens.get(targetId)
  if (token) return { placement, token }

  if (!context.queries.sheets.forPlacement(placement)) {
    fail(
      'not-found',
      'target-sheet-missing',
      `Target sheet ${placement.sheetKind}/${placement.sheetSlug} for placement ${placement.id} was not found.`,
    )
  }
  return fail('not-found', 'target-token-unresolved', `Target placement ${placement.id} could not resolve to a spawned token.`)
}

const assertNoDuplicateTargetIds = (targetIds: readonly string[]): void => {
  const seen = new Set<string>()
  for (const targetId of targetIds) {
    if (seen.has(targetId)) fail('conflict', 'duplicate-target-id', `Target placement ${targetId} was submitted more than once.`)
    seen.add(targetId)
  }
}

const resolveCanonicalScript = (options: {
  readonly baseScript: MoveAutomationScript
  readonly targetBranchId?: string
}): { script: MoveAutomationScript; targetBranchId?: string } => {
  if (moveAutomationHasMultipleTargetBranches(options.baseScript)) {
    if (!options.targetBranchId) {
      fail('invalid', 'target-branch-required', `${options.baseScript.moveName} requires a target branch.`)
    }
    const branch = moveAutomationTargetBranches(options.baseScript).find((item) => item.id === options.targetBranchId)
      ?? fail('invalid', 'target-branch-invalid', `Unknown target branch ${options.targetBranchId} for ${options.baseScript.moveName}.`)
    const script = moveAutomationScriptForTargetBranch(options.baseScript, branch)
      ?? fail('unsupported', 'target-branch-invalid', `Target branch ${branch.id} could not be applied.`)
    return { script: cloneJson(script), targetBranchId: branch.id }
  }

  if (options.targetBranchId) {
    fail('invalid', 'target-branch-unexpected', `${options.baseScript.moveName} does not accept a target branch.`)
  }

  return { script: cloneJson(options.baseScript) }
}

const assertResolvableDamage = (script: MoveAutomationScript, damageFormula: string | null): void => {
  if (script.damaging && !damageFormula && !moveAutomationCanResolveDamageAtRuntime(script)) {
    fail(
      'unsupported',
      'unsupported-damage-resolution',
      `${script.moveName} damage cannot be resolved automatically from authoritative data.`,
    )
  }
}

const tokenFacingPoint = (token: SpawnedPokemon): { x: number; z: number } => ({
  x: token.position.x + token.base / 2,
  z: token.position.z + token.base / 2,
})

const desiredFacingTowardToken = (
  userPlacement: SheetPlacement,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
): TokenFacingDirection | undefined => tokenFacingTowardPoint(
  tokenFacingPoint(user),
  tokenFacingPoint(target),
  tokenFacingForPlacement(userPlacement),
) ?? undefined

const squaredFacingDistance = (from: SpawnedPokemon, to: SpawnedPokemon): number => {
  const fromPoint = tokenFacingPoint(from)
  const toPoint = tokenFacingPoint(to)
  return (toPoint.x - fromPoint.x) ** 2 + (toPoint.z - fromPoint.z) ** 2
}

const nearestSelectedTarget = (
  user: SpawnedPokemon,
  targets: readonly SpawnedPokemon[],
): SpawnedPokemon | null => [...targets]
  .sort((a, b) => {
    const distance = squaredFacingDistance(user, a) - squaredFacingDistance(user, b)
    return distance || a.id.localeCompare(b.id)
  })[0] ?? null

const desiredFacingTowardNearestTarget = (
  userPlacement: SheetPlacement,
  user: SpawnedPokemon,
  targets: readonly SpawnedPokemon[],
): TokenFacingDirection | undefined => {
  const target = nearestSelectedTarget(user, targets)
  return target ? desiredFacingTowardToken(userPlacement, user, target) : undefined
}

const AREA_DIRECTION_SET = new Set<string>(MOVE_AUTOMATION_AREA_DIRECTIONS)

const isMoveAutomationAreaDirection = (value: unknown): value is MoveAutomationAreaDirection =>
  typeof value === 'string' && AREA_DIRECTION_SET.has(value)

const cloneGridAnchor = (anchor: GridAnchor): GridAnchor => ({ x: anchor.x, y: anchor.y, z: anchor.z })

const cloneGridAnchors = (anchors: readonly GridAnchor[]): GridAnchor[] => anchors.map(cloneGridAnchor)

const cloneAreaTemplate = (template: MoveAutomationAreaTemplate): MoveAutomationAreaTemplate => ({ ...template })

const moveAutomationTransactionWithAppendedLogLine = (
  transaction: MoveAutomationTransaction,
  line: string,
): MoveAutomationTransaction => ({
  ...transaction,
  attackedTargetIds: [...transaction.attackedTargetIds],
  hitTargetIds: [...transaction.hitTargetIds],
  logLines: [...transaction.logLines, line],
})

const isSafeGridAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<Record<keyof GridAnchor, unknown>>
  return Number.isSafeInteger(candidate.x)
    && Number.isSafeInteger(candidate.y)
    && Number.isSafeInteger(candidate.z)
}

const areaCellConstraints = (map: TabletopMap) => ({
  bounds: map.dimensions,
  blockedCells: buildAllVoxelOccupancy(map.voxels),
})

const moveAutomationScriptHasFriendlyKeyword = (script: MoveAutomationScript): boolean =>
  script.keywords.some((keyword) => /^Friendly$/i.test(keyword.trim()))

const selectedAreaTemplate = (
  script: MoveAutomationScript,
  areaTemplateId: string,
): MoveAutomationAreaTemplate => {
  const moveName = script.moveName
  if (!isSeamlessAreaConfirmationScript(script as MoveAutomationScript | null)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless area-confirmation move.`)
  }

  return script.areaTemplates?.find((item) => moveAutomationAreaTemplateId(item) === areaTemplateId)
    ?? fail('invalid', 'area-template-invalid', `Unknown area template ${areaTemplateId} for ${moveName}.`)
}

const assertNoAreaDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.direction !== undefined) {
    fail('invalid', 'area-placement-unexpected', `${template.label} does not accept a direction.`)
  }
}

const assertNoAreaAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.aimCell !== undefined) {
    fail('invalid', 'area-placement-unexpected', `${template.label} does not accept an aim cell.`)
  }
}

const requireAreaDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): MoveAutomationAreaDirection => {
  const direction = selection.direction
  if (direction === undefined) {
    return fail('invalid', 'area-placement-missing', `${template.label} requires an area direction.`)
  }
  if (!isMoveAutomationAreaDirection(direction)) {
    return fail('invalid', 'area-direction-illegal', `${String(direction)} is not a legal area direction.`)
  }
  return direction
}

const requireAreaAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): GridAnchor => {
  const aimCell = selection.aimCell
  if (aimCell === undefined) {
    return fail('invalid', 'area-placement-missing', `${template.label} requires an aim cell.`)
  }
  if (!isSafeGridAnchor(aimCell)) {
    return fail('invalid', 'area-aim-cell-illegal', `${template.label} aim cell must contain safe integer x, y, and z.`)
  }
  return cloneGridAnchor(aimCell)
}

const assertNoPassAimCell = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): void => {
  if (selection.aimCell !== undefined) {
    fail('invalid', 'pass-aim-cell-unexpected', `${template.label} does not accept an aim cell.`)
  }
}

const requirePassDirection = (
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  template: MoveAutomationAreaTemplate,
): MoveAutomationAreaDirection => {
  const direction = selection.direction
  if (direction === undefined) {
    return fail('invalid', 'pass-direction-required', `${template.label} requires a Pass direction.`)
  }
  if (!isMoveAutomationAreaDirection(direction)) {
    return fail('invalid', 'area-direction-illegal', `${String(direction)} is not a legal area direction.`)
  }
  return direction
}

const assertSupportedPassTemplate = (template: MoveAutomationAreaTemplate): void => {
  if (template.kind !== 'pass' || !Number.isSafeInteger(template.size) || template.size <= 0) {
    fail('unsupported', 'pass-geometry-empty', `${template.label} is not a supported Pass template.`)
  }
}

const assertAreaCellsPresent = (template: MoveAutomationAreaTemplate, cells: readonly GridAnchor[]): void => {
  if (!cells.length) {
    fail('invalid', 'area-geometry-empty', `${template.label} does not produce any legal authoritative area cells.`)
  }
}

const authoritativeAreaCandidates = (options: {
  readonly actor: SpawnedPokemon
  readonly tokens: readonly SpawnedPokemon[]
  readonly cells: readonly GridAnchor[]
}): SpawnedPokemon[] => tokensInMoveAutomationArea({
  cells: options.cells,
  tokens: options.tokens,
  excludeIds: [options.actor.id],
})

interface ResolvedAuthoritativeAreaPlacement {
  readonly cells: readonly GridAnchor[]
  readonly candidateTargets: readonly SpawnedPokemon[]
  readonly direction?: MoveAutomationAreaDirection
  readonly aimCell?: GridAnchor
  readonly movement?: AuthoritativeMovePassMovement
}

const resolvedAreaPlacement = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actor: SpawnedPokemon
  readonly template: MoveAutomationAreaTemplate
  readonly selection: Extract<ResolveMoveSelection, { kind: 'area' }>
}): ResolvedAuthoritativeAreaPlacement => {
  const tokens = options.context.queries.tokens.all()
  const constraints = areaCellConstraints(options.context.map)
  const common = {
    user: options.actor,
    tokens,
    includeEmpty: true,
    ...constraints,
  }

  if (options.template.kind === 'burst' || options.template.kind === 'cardinally-adjacent') {
    assertNoAreaDirection(options.selection, options.template)
    assertNoAreaAimCell(options.selection, options.template)
    const cells = buildMoveAutomationAreaTemplateCells({
      template: options.template,
      user: options.actor,
      ...constraints,
    })
    assertAreaCellsPresent(options.template, cells)
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
    }
  }

  if (options.template.kind === 'cone' || options.template.kind === 'line') {
    assertNoAreaAimCell(options.selection, options.template)
    const direction = requireAreaDirection(options.selection, options.template)
    const cells = buildMoveAutomationAreaTemplateCells({
      template: options.template,
      user: options.actor,
      direction,
      ...constraints,
    })
    assertAreaCellsPresent(options.template, cells)
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
      direction,
    }
  }

  if (options.template.kind === 'close-blast') {
    assertNoAreaDirection(options.selection, options.template)
    const aimCell = requireAreaAimCell(options.selection, options.template)
    const placement = buildMoveAutomationCloseBlastPlacementAtAimCell({
      template: options.template,
      aimCell,
      ...common,
    }) ?? fail(
      'invalid',
      'area-aim-cell-illegal',
      `${options.template.label} cannot be placed at (${aimCell.x}, ${aimCell.y}, ${aimCell.z}).`,
    )
    assertAreaCellsPresent(options.template, placement.cells)
    return {
      cells: placement.cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells: placement.cells }),
      aimCell,
    }
  }

  if (options.template.kind === 'ranged-blast') {
    assertNoAreaDirection(options.selection, options.template)
    const aimCell = requireAreaAimCell(options.selection, options.template)
    const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
      template: options.template,
      center: aimCell,
      ...common,
    }) ?? fail(
      'invalid',
      'area-aim-cell-illegal',
      `${options.template.label} cannot be centered at (${aimCell.x}, ${aimCell.y}, ${aimCell.z}).`,
    )
    assertAreaCellsPresent(options.template, placement.cells)
    return {
      cells: placement.cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells: placement.cells }),
      aimCell,
    }
  }

  if (options.template.kind === 'pass') {
    assertSupportedPassTemplate(options.template)
    assertNoPassAimCell(options.selection, options.template)
    const direction = requirePassDirection(options.selection, options.template)
    const placement = buildMoveAutomationPassPlacement({
      template: options.template,
      user: options.actor,
      tokens,
      direction,
      ...constraints,
    }) ?? fail(
      'conflict',
      'pass-destination-unavailable',
      `${options.template.label} cannot reach a legal empty Pass destination in the current map state.`,
    )
    if (!placement.cells.length) {
      fail('unsupported', 'pass-geometry-empty', `${options.template.label} did not produce authoritative Pass path cells.`)
    }
    const cells = cloneGridAnchors(placement.cells)
    return {
      cells,
      candidateTargets: authoritativeAreaCandidates({ actor: options.actor, tokens, cells }),
      direction,
      movement: {
        kind: 'pass',
        from: cloneGridAnchor(options.actor.position),
        destination: cloneGridAnchor(placement.destination),
        direction,
        pathCells: cloneGridAnchors(cells),
      },
    }
  }

  return fail('unsupported', 'unsupported-move-script', `${options.template.label} resolution is not implemented.`)
}

const excludedAreaTargetIds = (
  script: MoveAutomationScript,
  selection: Extract<ResolveMoveSelection, { kind: 'area' }>,
  candidateTargetIds: readonly string[],
): string[] => {
  const excludedIds = [...(selection.excludedTargetPlacementIds ?? [])]
  if (!excludedIds.length) return []

  if (!moveAutomationScriptHasFriendlyKeyword(script)) {
    fail('invalid', 'area-friendly-exclusion-invalid', `${script.moveName} does not allow Friendly target exclusions.`)
  }
  if (excludedIds.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    fail('invalid', 'area-friendly-exclusion-invalid', `At most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} area targets may be excluded.`)
  }

  const seen = new Set<string>()
  const candidateIds = new Set(candidateTargetIds)
  for (const excludedId of excludedIds) {
    if (seen.has(excludedId)) {
      fail('invalid', 'area-friendly-exclusion-invalid', `Area target ${excludedId} was excluded more than once.`)
    }
    seen.add(excludedId)
    if (!candidateIds.has(excludedId)) {
      fail('invalid', 'area-friendly-exclusion-invalid', `Area target ${excludedId} is not an authoritative candidate for this area.`)
    }
  }

  return excludedIds
}

const legalSingleTargetTokens = (options: {
  readonly script: MoveAutomationScript
  readonly user: SpawnedPokemon
  readonly tokens: readonly SpawnedPokemon[]
  readonly rangeMeters: number
}): SpawnedPokemon[] => {
  const targets = moveAutomationTargetsInRange({
    user: options.user,
    tokens: options.tokens,
    rangeMeters: options.rangeMeters,
  })
  return /\bSelf\b/i.test(options.script.range) ? [options.user, ...targets] : targets
}

const resolveSelfMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  if (!isSeamlessSelfMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${options.script.moveName} is not a seamless self move.`)
  }
  const transaction = resolveInstantSelfMoveAutomation({
    script: options.script,
    user: actor,
    fieldEffects: options.context.map.fieldEffects,
    random: options.context.random,
  })
  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: [],
    script: options.script,
    transaction,
  }
}

const resolveSingleTargetMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'single-target' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const moveName = options.script.moveName
  if (!isSeamlessSingleTargetMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless single-target move.`)
  }
  assertResolvableDamage(options.script, options.damageFormula)

  const rangeMeters = parseSingleTargetMoveRangeMeters(options.script.range, {
    focusSkillRankValue: actor.focusSkillRankValue,
  }) ?? fail('unsupported', 'unsupported-range', `${options.script.moveName} has an unsupported target range.`)

  const resolvedTarget = resolveSelectedTarget(options.context, options.selection.targetPlacementId)
  recordSheetReadForPlacement(options.context, resolvedTarget.placement)
  const target = resolvedTarget.token
  const legalTargets = legalSingleTargetTokens({
    script: options.script,
    user: actor,
    tokens: options.context.queries.tokens.all(),
    rangeMeters,
  })
  if (!legalTargets.some((candidate) => candidate.id === target.id)) {
    fail('invalid', 'target-out-of-range', `Target ${target.id} is outside ${options.script.moveName}'s authoritative range.`)
  }

  const desiredFacing = desiredFacingTowardToken(actorPlacement, actor, target)
  const common = {
    script: options.script,
    user: actor,
    target,
    damageFormula: options.damageFormula,
    fieldEffects: options.context.map.fieldEffects,
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, options.script),
    random: options.context.random,
  }

  if (!options.script.requiresAccuracy) {
    const transaction = resolveInstantTargetMoveAutomation(common)
    return {
      actorPlacementId: actorPlacement.id,
      moveName: options.script.moveName,
      canonicalMoveName: options.canonicalMoveName,
      moveKey: options.moveKey,
      frequency: options.frequency,
      damageFormula: options.damageFormula,
      ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
      selectedTargetIds: [target.id],
      script: options.script,
      transaction,
      ...(desiredFacing ? { desiredFacing } : {}),
    }
  }

  const result = resolveInstantMoveAutomation({
    ...common,
    idFactory: options.context.idFactory,
  })
  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds: [target.id],
    script: options.script,
    transaction: result.transaction,
    feedback: result.feedback,
    ...(desiredFacing ? { desiredFacing } : {}),
  }
}

const resolveTargetCountMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'target-count' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const moveName = options.script.moveName
  if (!isSeamlessTargetCountMoveScript(options.script)) {
    fail('invalid', 'selection-kind-mismatch', `${moveName} is not a seamless target-count move.`)
  }
  assertResolvableDamage(options.script, options.damageFormula)

  const submittedTargetIds = options.selection.targetPlacementIds
  if (submittedTargetIds.length === 0) fail('invalid', 'empty-target-selection', 'At least one target is required.')
  if (submittedTargetIds.length > LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS) {
    fail('invalid', 'too-many-targets', `At most ${LIVE_PLAY_MOVE_RESOLUTION_MAX_TARGET_IDS} targets may be submitted.`)
  }
  assertNoDuplicateTargetIds(submittedTargetIds)

  const maxTargetCount = typeof options.script.targetCount === 'number' && Number.isFinite(options.script.targetCount)
    ? Math.floor(options.script.targetCount)
    : 0
  if (submittedTargetIds.length > maxTargetCount) {
    fail('invalid', 'too-many-targets', `${options.script.moveName} can target at most ${maxTargetCount} targets.`)
  }

  const rangeMeters = parseExplicitMultiTargetMoveRangeMeters(options.script.range)
    ?? fail('unsupported', 'unsupported-range', `${options.script.moveName} has an unsupported target-count range.`)

  for (const targetId of submittedTargetIds) {
    const target = resolveSelectedTarget(options.context, targetId)
    recordSheetReadForPlacement(options.context, target.placement)
  }

  const legalTargets = moveAutomationTargetsInRange({
    user: actor,
    tokens: options.context.queries.tokens.all(),
    rangeMeters,
  })
  const legalTargetIds = new Set(legalTargets.map((target) => target.id))
  for (const targetId of submittedTargetIds) {
    if (!legalTargetIds.has(targetId)) {
      fail('invalid', 'target-out-of-range', `Target ${targetId} is outside ${options.script.moveName}'s authoritative range.`)
    }
  }

  const submittedTargetSet = new Set(submittedTargetIds)
  const selectedTargets = legalTargets.filter((target) => submittedTargetSet.has(target.id))
  const selectedTargetIds = selectedTargets.map((target) => target.id)
  const transaction = resolveInstantMultiTargetMoveAutomation({
    script: options.script,
    user: actor,
    selectedTargets,
    damageFormula: options.damageFormula,
    fieldEffects: options.context.map.fieldEffects,
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, options.script),
    random: options.context.random,
  })
  const desiredFacing = desiredFacingTowardNearestTarget(actorPlacement, actor, selectedTargets)

  return {
    actorPlacementId: actorPlacement.id,
    moveName: options.script.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds,
    script: options.script,
    transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
  }
}

const resolveAreaMove = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly selection: Extract<ResolveMoveSelection, { kind: 'area' }>
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly canonicalMoveName: string
  readonly moveKey: string
  readonly targetBranchId?: string
}): UnfinalizedAuthoritativeMoveResolution => {
  const { placement: actorPlacement, token: actor } = options.context.actor
  const template = selectedAreaTemplate(options.script, options.selection.areaTemplateId)
  assertResolvableDamage(options.script, options.damageFormula)

  const placement = resolvedAreaPlacement({
    context: options.context,
    actor,
    template,
    selection: options.selection,
  })
  const candidateTargetIds = placement.candidateTargets.map((target) => target.id)
  recordSheetReadsForTokens(options.context, placement.candidateTargets)
  const excludedTargetIds = excludedAreaTargetIds(options.script, options.selection, candidateTargetIds)
  const excludedTargetSet = new Set(excludedTargetIds)
  const selectedTargets = placement.candidateTargets.filter((target) => !excludedTargetSet.has(target.id))
  const selectedTargetIds = selectedTargets.map((target) => target.id)
  const confirmedScript = moveAutomationScriptForConfirmedAreaTemplate(options.script, template)
  const baseTransaction = resolveInstantAreaMoveAutomation({
    script: confirmedScript,
    user: actor,
    targets: selectedTargets,
    damageFormula: options.damageFormula,
    fieldEffects: options.context.map.fieldEffects,
    conditionImmunityContext: authoritativeConditionImmunityContext(options.context, confirmedScript),
    random: options.context.random,
  })
  const transaction = placement.movement?.kind === 'pass'
    ? moveAutomationTransactionWithAppendedLogLine(
        baseTransaction,
        passDestinationLogLine(actor, placement.movement.destination),
      )
    : baseTransaction
  const currentFacing = tokenFacingForPlacement(actorPlacement)
  const desiredFacing = placement.direction
    ? tokenFacingFromAreaDirection(placement.direction, currentFacing) ?? (placement.movement?.kind === 'pass' ? currentFacing : undefined)
    : desiredFacingTowardNearestTarget(actorPlacement, actor, selectedTargets)
  const movement = placement.movement
    ? {
        kind: 'pass' as const,
        from: cloneGridAnchor(placement.movement.from),
        destination: cloneGridAnchor(placement.movement.destination),
        direction: placement.movement.direction,
        pathCells: cloneGridAnchors(placement.movement.pathCells),
      }
    : undefined

  return {
    actorPlacementId: actorPlacement.id,
    moveName: confirmedScript.moveName,
    canonicalMoveName: options.canonicalMoveName,
    moveKey: options.moveKey,
    frequency: options.frequency,
    damageFormula: options.damageFormula,
    ...(options.targetBranchId ? { targetBranchId: options.targetBranchId } : {}),
    selectedTargetIds,
    script: confirmedScript,
    transaction,
    ...(desiredFacing ? { desiredFacing } : {}),
    ...(movement ? { movement } : {}),
    area: {
      areaTemplateId: options.selection.areaTemplateId,
      template: cloneAreaTemplate(template),
      cells: cloneGridAnchors(placement.cells),
      candidateTargetIds: [...candidateTargetIds],
      excludedTargetIds: [...excludedTargetIds],
      ...(placement.direction ? { direction: placement.direction } : {}),
      ...(placement.aimCell ? { aimCell: cloneGridAnchor(placement.aimCell) } : {}),
    },
  }
}

const failFromContextError = (error: AuthoritativeMoveRulesContextError): never => {
  if (error.code === 'duplicate-placement-id') {
    return fail('conflict', 'duplicate-placement-id', error.message)
  }
  if (error.code === 'actor-placement-missing') {
    return fail('not-found', 'actor-placement-missing', error.message)
  }
  if (error.code === 'actor-sheet-missing') {
    return fail('not-found', 'actor-sheet-missing', error.message)
  }
  if (error.code === 'actor-token-unresolved') {
    return fail('not-found', 'actor-token-unresolved', error.message)
  }
  if (error.code === 'duplicate-selected-id') {
    return fail('conflict', 'duplicate-target-id', error.message)
  }
  if (error.code === 'sheet-read-revision-conflict') {
    return fail('conflict', 'sheet-read-revision-conflict', error.message)
  }
  return fail('conflict', 'duplicate-placement-id', error.message)
}

/** Resolve mechanics exclusively from one detached authoritative snapshot. */
export const resolveAuthoritativeMoveFromContext = (
  context: AuthoritativeMoveRulesContext,
): AuthoritativeMoveResolution => {
  const { placement: actorPlacement } = context.actor
  const { intent } = context
  recordSheetReadForPlacement(context, actorPlacement)
  const submittedTargetIds = selectedTargetIdsForSelection(intent.selection)
  assertNoDuplicateTargetIds(submittedTargetIds)

  const moveEntryResult = context.queries.resolveActorMoveEntry(intent.moveName)
  if (!moveEntryResult.ok) {
    if (moveEntryResult.reason === 'condition-blocked') {
      fail('unauthorized-state', 'move-condition-blocked', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'usage-blocked') {
      fail('conflict', 'move-usage-unavailable', moveEntryResult.message)
    }
    if (moveEntryResult.reason === 'move-absent') {
      fail('not-found', 'move-absent', moveEntryResult.message)
    }
    fail('not-found', 'actor-token-unresolved', moveEntryResult.message)
  }

  const entry = moveEntryResult.ok
    ? moveEntryResult.entry
    : fail('not-found', 'move-absent', 'Move entry resolution failed.')
  const semanticStatus = context.queries.rules.semanticStatusFor(entry.canonicalMoveName)
  if (semanticStatus?.baseStatus === 'blocked') {
    const details = moveAutomationStatusDetailsText(semanticStatus)
    fail(
      'unsupported',
      'move-automation-blocked',
      `${entry.canonicalMoveName} automation is blocked.${details ? ` ${details}` : ''}`,
    )
  }
  const { script, targetBranchId } = resolveCanonicalScript({
    baseScript: entry.script,
    targetBranchId: intent.targetBranchId,
  })
  const resolvedMoveKey = moveUsageKey(entry.canonicalMoveName)
  if (!resolvedMoveKey) {
    fail('invalid', 'move-usage-key-invalid', `${entry.canonicalMoveName} did not produce a valid move usage key.`)
  }

  const common = {
    context,
    script,
    frequency: entry.frequency,
    damageFormula: entry.damageFormula,
    canonicalMoveName: entry.canonicalMoveName,
    moveKey: resolvedMoveKey,
    targetBranchId,
  }

  if (intent.selection.kind === 'self') {
    return finalizeResolution(context, resolveSelfMove(common))
  }
  if (intent.selection.kind === 'single-target') {
    return finalizeResolution(context, resolveSingleTargetMove({
      ...common,
      selection: intent.selection,
    }))
  }
  if (intent.selection.kind === 'target-count') {
    return finalizeResolution(context, resolveTargetCountMove({
      ...common,
      selection: intent.selection,
    }))
  }
  if (intent.selection.kind === 'area') {
    return finalizeResolution(context, resolveAreaMove({
      ...common,
      selection: intent.selection,
    }))
  }
  return fail('unsupported', 'unsupported-move-script', 'Unsupported move selection.')
}

export const resolveAuthoritativeMove = (input: ResolveAuthoritativeMoveInput): AuthoritativeMoveResolution => {
  const selectedPlacementIds = selectedTargetIdsForSelection(input.intent.selection)
  assertNoDuplicateTargetIds(selectedPlacementIds)
  const random = input.random ?? Math.random
  const time = (input.now ?? Date.now)()

  try {
    const context = buildAuthoritativeMoveRulesContext({
      map: input.map,
      pokemonSheets: input.pokemonSheets,
      trainerSheets: input.trainerSheets,
      intent: input.intent,
      selectedPlacementIds,
      random,
      time,
      idFactory: input.idFactory,
    })
    return resolveAuthoritativeMoveFromContext(context)
  }
  catch (error) {
    if (error instanceof AuthoritativeMoveRulesContextError) return failFromContextError(error)
    throw error
  }
}

export const isAuthoritativeMoveResolutionError = (value: unknown): value is AuthoritativeMoveResolutionError =>
  value instanceof AuthoritativeMoveResolutionError
