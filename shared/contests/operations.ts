import type { PlayerProfileId } from '../playerProfiles'
import { emptyContestStatRecord, isContestParticipantMethodId, isContestStatId, isContestVariantId, parseContestAppealId, parseContestId, parseContestOperationId, parseContestantId, type ContestIntroductionSkillId, type ContestParticipantMethodId, type ContestStatId } from './ids'
import { normalizeContestPrize, type ContestControllerV1, type ContestCorrectionReceiptV1, type CreateContestDocumentInput } from './document'

export const CONTEST_COMMAND_KINDS = Object.freeze([
  'create-contest', 'update-settings', 'set-participant-method', 'enroll-contestant', 'remove-contestant',
  'start-introduction', 'declare-introduction', 'restart-introduction', 'create-battle-encounter', 'score-battle-accepted-move', 'apply-battle-voltage-lifecycle', 'end-battle-contest', 'start-performance', 'select-rotation-performer',
  'declare-appeal', 'use-intervention', 'pass-intervention', 'set-paused', 'apply-correction', 'declare-prize', 'prepare-settlement',
  'commit-settlement', 'cancel-contest',
] as const)
export type ContestCommandKind = typeof CONTEST_COMMAND_KINDS[number]

export interface ContestCommandBaseV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly contestId: string
  readonly commandKind: ContestCommandKind
  readonly expectedRevision: number
  readonly clientId: string | null
}

export interface CreateContestCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'create-contest'
  readonly settings: Omit<CreateContestDocumentInput, 'contestId' | 'now'>
}
export interface UpdateContestSettingsCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'update-settings'
  readonly patch: {
    readonly name?: string
    readonly hallName?: string
    readonly description?: string
    readonly significanceMultiplier?: number
    readonly awardRibbon?: boolean
    readonly prize?: { readonly declared: boolean, readonly money: number, readonly items: readonly { readonly itemId: string, readonly quantity: number, readonly targetTrainerSlug: string | null }[], readonly notes: string }
    readonly gmNotes?: string
  }
}
export interface SetContestParticipantMethodCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'set-participant-method'
  readonly participantMethodId: ContestParticipantMethodId
}
export interface EnrollContestantCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'enroll-contestant'
  readonly contestantId: string
  readonly trainerSheetSlug: string
  readonly pokemonSheetSlugs: readonly string[]
  readonly controller: ContestControllerV1
  readonly rotationOrder: readonly number[]
}
export interface RemoveContestantCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'remove-contestant'
  readonly contestantId: string
}
export interface StartIntroductionCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'start-introduction' }
export interface DeclareIntroductionCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'declare-introduction'
  readonly contestantId: string
  readonly skillId: ContestIntroductionSkillId
  /** Grace may direct the selected Skill roll to any canonical stat. */
  readonly generatedStatId: ContestStatId
  /** Independent bonus rolls may generate dice for a different canonical stat. */
  readonly bonusStatIds?: {
    readonly contestAccessory?: ContestStatId
    readonly jugglingShow?: ContestStatId
  }
}
export interface RestartIntroductionCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'restart-introduction' }
/** Server derives map, Encounter, Scene, deployment, and initiative; clients provide no parallel setup material. */
export interface CreateBattleEncounterCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'create-battle-encounter' }
/** Server-internal command material created only after deriving one persisted accepted Encounter Move fact. */
export interface ScoreBattleAcceptedMoveCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'score-battle-accepted-move'
  readonly sourceOperationId: string
  readonly sourceResolutionId: string
  readonly spentDice: Readonly<Record<ContestStatId, number>>
}
/** Server-internal command identifying one accepted typed KO/switch history result. */
export interface ApplyBattleVoltageLifecycleCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'apply-battle-voltage-lifecycle'
  readonly sourceOperationId: string
  readonly sourceResultId: string
}
/** Server-internal command identifying one accepted round-boundary or final-KO result. */
export interface EndBattleContestCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'end-battle-contest'
  readonly sourceOperationId: string
  readonly sourceResultId: string
}
export interface StartPerformanceCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'start-performance' }
export interface SelectRotationPerformerCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'select-rotation-performer', readonly contestantId: string, readonly performerId: string }
export interface DeclareAppealCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'declare-appeal'
  readonly contestantId: string
  readonly performerId: string
  readonly moveOptionId: string
  /** Optional same-entry recipient for reviewed Simultaneous cross-performer effects. */
  readonly partnerEffectTargetPerformerId?: string | null
  readonly spentDice: Readonly<Record<ContestStatId, number>>
}
export interface UseContestInterventionCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'use-intervention'
  readonly contestantId: string
  readonly interventionId: string
  /** Exact paired performer receiving this intervention; null for ordinary Contest decisions. */
  readonly targetPerformerId?: string | null
  readonly targetContestantId: string | null
  readonly appealId: string | null
  readonly choices: Readonly<Record<string, string | number | boolean>>
}
export interface PassContestInterventionCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'pass-intervention'
  readonly contestantId: string
  readonly appealId: string
}
export interface SetContestPausedCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'set-paused', readonly paused: boolean }
export interface ApplyContestCorrectionCommandV1 extends ContestCommandBaseV1 {
  readonly commandKind: 'apply-correction'
  readonly correctionKind: ContestCorrectionReceiptV1['kind']
  readonly contestantId: string | null
  /** Required only when correcting one Battle Pokémon's performer-scoped Voltage. */
  readonly performerId?: string | null
  readonly statId: ContestStatId | null
  readonly numericDelta: number | null
  readonly replacementProfileId: PlayerProfileId | null
  readonly reason: string
}
export interface DeclareContestPrizeCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'declare-prize' }
export interface PrepareContestSettlementCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'prepare-settlement' }
export interface CommitContestSettlementCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'commit-settlement' }
export interface CancelContestCommandV1 extends ContestCommandBaseV1 { readonly commandKind: 'cancel-contest', readonly reason: string }

export type ContestCommandV1 =
  | CreateContestCommandV1 | UpdateContestSettingsCommandV1 | SetContestParticipantMethodCommandV1 | EnrollContestantCommandV1
  | RemoveContestantCommandV1 | StartIntroductionCommandV1 | DeclareIntroductionCommandV1
  | RestartIntroductionCommandV1 | CreateBattleEncounterCommandV1 | ScoreBattleAcceptedMoveCommandV1 | ApplyBattleVoltageLifecycleCommandV1 | EndBattleContestCommandV1 | StartPerformanceCommandV1 | SelectRotationPerformerCommandV1 | DeclareAppealCommandV1
  | UseContestInterventionCommandV1 | PassContestInterventionCommandV1 | SetContestPausedCommandV1 | ApplyContestCorrectionCommandV1
  | DeclareContestPrizeCommandV1 | PrepareContestSettlementCommandV1 | CommitContestSettlementCommandV1 | CancelContestCommandV1

export interface ContestOperationResultV1 {
  readonly schemaVersion: 1
  readonly ok: true
  readonly exactRetry: boolean
  readonly operationId: string
  readonly contestId: string
  readonly commandKind: ContestCommandKind
  readonly revision: number
  readonly stage: string
  readonly updatedAt: number
}

export class ContestCommandContractError extends Error {
  readonly field: string
  constructor(field: string, message: string) { super(`${field}: ${message}`); this.name = 'ContestCommandContractError'; this.field = field }
}
const fail = (field: string, message: string): never => { throw new ContestCommandContractError(field, message) }
const object = (value: unknown, field: string): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(field, 'must be an object')
const exact = (value: Record<string, unknown>, allowed: readonly string[], field: string): void => {
  const keys = new Set(allowed)
  const unknown = Object.keys(value).filter(key => !keys.has(key))
  if (unknown.length) fail(`${field}.${unknown[0]}`, 'is not recognized')
}
const text = (value: unknown, field: string, maximum = 200): string => typeof value === 'string' && value.trim() && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail(field, 'must be bounded text')
const integer = (value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : fail(field, `must be an integer from ${minimum} through ${maximum}`)
const COMMON = ['schemaVersion', 'operationId', 'contestId', 'commandKind', 'expectedRevision', 'clientId'] as const
const FIELDS: Readonly<Record<ContestCommandKind, readonly string[]>> = Object.freeze({
  'create-contest': [...COMMON, 'settings'],
  'update-settings': [...COMMON, 'patch'],
  'set-participant-method': [...COMMON, 'participantMethodId'],
  'enroll-contestant': [...COMMON, 'contestantId', 'trainerSheetSlug', 'pokemonSheetSlugs', 'controller', 'rotationOrder'],
  'remove-contestant': [...COMMON, 'contestantId'],
  'start-introduction': COMMON,
  'declare-introduction': [...COMMON, 'contestantId', 'skillId', 'generatedStatId', 'bonusStatIds'],
  'restart-introduction': COMMON,
  'create-battle-encounter': COMMON,
  'score-battle-accepted-move': [...COMMON, 'sourceOperationId', 'sourceResolutionId', 'spentDice'],
  'apply-battle-voltage-lifecycle': [...COMMON, 'sourceOperationId', 'sourceResultId'],
  'end-battle-contest': [...COMMON, 'sourceOperationId', 'sourceResultId'],
  'start-performance': COMMON,
  'select-rotation-performer': [...COMMON, 'contestantId', 'performerId'],
  'declare-appeal': [...COMMON, 'contestantId', 'performerId', 'moveOptionId', 'partnerEffectTargetPerformerId', 'spentDice'],
  'use-intervention': [...COMMON, 'contestantId', 'interventionId', 'targetPerformerId', 'targetContestantId', 'appealId', 'choices'],
  'pass-intervention': [...COMMON, 'contestantId', 'appealId'],
  'set-paused': [...COMMON, 'paused'],
  'apply-correction': [...COMMON, 'correctionKind', 'contestantId', 'performerId', 'statId', 'numericDelta', 'replacementProfileId', 'reason'],
  'declare-prize': COMMON,
  'prepare-settlement': COMMON,
  'commit-settlement': COMMON,
  'cancel-contest': [...COMMON, 'reason'],
})

export const parseContestCommand = (value: unknown): ContestCommandV1 => {
  const row = object(value, 'command')
  if (row.schemaVersion !== 1) fail('command.schemaVersion', 'must be 1')
  if (typeof row.commandKind !== 'string' || !CONTEST_COMMAND_KINDS.includes(row.commandKind as ContestCommandKind)) fail('command.commandKind', 'is unsupported')
  const commandKind = row.commandKind as ContestCommandKind
  exact(row, FIELDS[commandKind], 'command')
  parseContestOperationId(row.operationId)
  parseContestId(row.contestId)
  integer(row.expectedRevision, 'command.expectedRevision')
  if (commandKind === 'create-contest' && row.expectedRevision !== 0) fail('command.expectedRevision', 'must be 0 when creating a Contest')
  if (row.clientId !== null && (typeof row.clientId !== 'string' || !row.clientId || row.clientId.trim() !== row.clientId || row.clientId.length > 100 || /[\u0000-\u001f\u007f]/u.test(row.clientId))) fail('command.clientId', 'must be bounded text or null')
  if ('contestantId' in row && row.contestantId !== null) parseContestantId(row.contestantId)
  if (commandKind === 'create-contest' || commandKind === 'update-settings') {
    const settings = object(commandKind === 'create-contest' ? row.settings : row.patch, `command.${commandKind === 'create-contest' ? 'settings' : 'patch'}`)
    if (JSON.stringify(settings).length > 20_000) fail(`command.${commandKind === 'create-contest' ? 'settings' : 'patch'}`, 'exceeds the bounded payload size')
    exact(settings, commandKind === 'create-contest'
      ? ['name','hallName','description','variantId','participantVariantId','participantMethodId','contestTypeId','significanceMultiplier','awardRibbon','prize','rotationOrderPolicy','supercontestFestival','gmNotes']
      : ['name','hallName','description','significanceMultiplier','awardRibbon','prize','gmNotes'], `command.${commandKind === 'create-contest' ? 'settings' : 'patch'}`)
    const prefix = `command.${commandKind === 'create-contest' ? 'settings' : 'patch'}`
    for (const key of ['name','hallName'] as const) if (settings[key] !== undefined) text(settings[key], `${prefix}.${key}`, 120)
    for (const [key, maximum] of [['description', 1_000], ['gmNotes', 4_000]] as const) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || settings[key].length > maximum || /[\u0000-\u001f\u007f]/u.test(settings[key]))) fail(`${prefix}.${key}`, 'must be bounded control-free text')
    if (settings.significanceMultiplier !== undefined && (typeof settings.significanceMultiplier !== 'number' || !Number.isFinite(settings.significanceMultiplier))) fail(`${prefix}.significanceMultiplier`, 'must be a finite number')
    if (settings.awardRibbon !== undefined && typeof settings.awardRibbon !== 'boolean') fail(`${prefix}.awardRibbon`, 'must be boolean')
    if (settings.prize !== undefined) try { normalizeContestPrize(settings.prize as never) } catch (error) { fail(`${prefix}.prize`, error instanceof Error ? error.message : 'is invalid') }
    if (commandKind === 'create-contest') {
      if (!isContestVariantId(settings.variantId)) fail(`${prefix}.variantId`, 'is unsupported')
      if (settings.participantVariantId !== undefined && settings.participantVariantId !== null && settings.participantVariantId !== 'trainer-participant') fail(`${prefix}.participantVariantId`, 'is unsupported')
      if (settings.participantVariantId === 'trainer-participant' && !isContestParticipantMethodId(settings.participantMethodId)) fail(`${prefix}.participantMethodId`, 'is required and must be canonical for Trainer Participant Contests')
      if (settings.participantVariantId !== 'trainer-participant' && settings.participantMethodId !== undefined && settings.participantMethodId !== null) fail(`${prefix}.participantMethodId`, 'is available only to Trainer Participant Contests')
      if (settings.contestTypeId !== null && !isContestStatId(settings.contestTypeId)) fail(`${prefix}.contestTypeId`, 'must be canonical or null')
      if (settings.rotationOrderPolicy !== undefined && !['predeclared','choose-each-round'].includes(String(settings.rotationOrderPolicy))) fail(`${prefix}.rotationOrderPolicy`, 'is invalid')
      if (settings.supercontestFestival !== undefined && typeof settings.supercontestFestival !== 'boolean') fail(`${prefix}.supercontestFestival`, 'must be boolean')
    }
  }
  if (commandKind === 'set-participant-method' && !isContestParticipantMethodId(row.participantMethodId)) fail('command.participantMethodId', 'must be canonical')
  if (commandKind === 'select-rotation-performer') text(row.performerId, 'command.performerId', 160)
  if (commandKind === 'declare-appeal' || commandKind === 'score-battle-accepted-move') {
    if (commandKind === 'declare-appeal') {
      text(row.performerId, 'command.performerId', 160); text(row.moveOptionId, 'command.moveOptionId', 240); if (row.partnerEffectTargetPerformerId !== undefined && row.partnerEffectTargetPerformerId !== null) text(row.partnerEffectTargetPerformerId, 'command.partnerEffectTargetPerformerId', 160)
    } else {
      text(row.sourceOperationId, 'command.sourceOperationId', 200)
      text(row.sourceResolutionId, 'command.sourceResolutionId', 200)
    }
    const spent = object(row.spentDice, 'command.spentDice')
    exact(spent, ['beauty','cool','cute','smart','tough'], 'command.spentDice')
    for (const statId of Object.keys(emptyContestStatRecord(() => 0)) as ContestStatId[]) integer(spent[statId], `command.spentDice.${statId}`, 0, 3)
  }
  if (commandKind === 'apply-battle-voltage-lifecycle' || commandKind === 'end-battle-contest') {
    text(row.sourceOperationId, 'command.sourceOperationId', 200)
    text(row.sourceResultId, 'command.sourceResultId', 200)
  }
  if (commandKind === 'enroll-contestant') {
    text(row.trainerSheetSlug, 'command.trainerSheetSlug', 160)
    if (!Array.isArray(row.pokemonSheetSlugs) || row.pokemonSheetSlugs.length < 1 || row.pokemonSheetSlugs.length > 6) fail('command.pokemonSheetSlugs', 'must contain one through six sheet slugs')
    ;(row.pokemonSheetSlugs as unknown[]).forEach((slug, index) => text(slug, `command.pokemonSheetSlugs[${index}]`, 160))
    if (!Array.isArray(row.rotationOrder) || row.rotationOrder.length > 5) fail('command.rotationOrder', 'must be bounded')
    ;(row.rotationOrder as unknown[]).forEach((index, position) => integer(index, `command.rotationOrder[${position}]`, 0, 4))
    const controller = object(row.controller, 'command.controller')
    if (controller.kind === 'gm') exact(controller, ['kind'], 'command.controller')
    else if (controller.kind === 'profile' && typeof controller.profileId === 'string' && /^profile_[A-Za-z0-9_-]{8,64}$/u.test(controller.profileId)) exact(controller, ['kind','profileId'], 'command.controller')
    else fail('command.controller.kind', 'is invalid')
  }
  if (commandKind === 'declare-introduction') {
    if (!['charm','command','guile','intimidate','intuition'].includes(String(row.skillId))) fail('command.skillId', 'is not a Contest introduction skill')
    if (!isContestStatId(row.generatedStatId)) fail('command.generatedStatId', 'is not a canonical Contest stat')
    if (row.bonusStatIds !== undefined) {
      const choices = object(row.bonusStatIds, 'command.bonusStatIds'); exact(choices, ['contestAccessory','jugglingShow'], 'command.bonusStatIds')
      for (const [key, choice] of Object.entries(choices)) if (!isContestStatId(choice)) fail(`command.bonusStatIds.${key}`, 'is not a canonical Contest stat')
    }
  }
  if (commandKind === 'pass-intervention') parseContestAppealId(row.appealId, 'command.appealId')
  if (commandKind === 'use-intervention') {
    text(row.interventionId, 'command.interventionId', 120)
    if (row.targetPerformerId !== undefined && row.targetPerformerId !== null) text(row.targetPerformerId, 'command.targetPerformerId', 160)
    if (row.targetContestantId !== null) parseContestantId(row.targetContestantId, 'command.targetContestantId')
    if (row.appealId !== null) parseContestAppealId(row.appealId, 'command.appealId')
    const choices = object(row.choices, 'command.choices')
    if (Object.keys(choices).length > 10) fail('command.choices', 'must contain at most 10 bounded choices')
    for (const [key, choice] of Object.entries(choices)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/u.test(key)) fail(`command.choices.${key}`, 'has an invalid key')
      if (typeof choice === 'string') text(choice, `command.choices.${key}`, 240)
      else if (typeof choice === 'number' && !Number.isFinite(choice)) fail(`command.choices.${key}`, 'must be finite')
      else if (typeof choice !== 'number' && typeof choice !== 'boolean') fail(`command.choices.${key}`, 'must be a string, number, or boolean')
    }
  }
  if (commandKind === 'set-paused' && typeof row.paused !== 'boolean') fail('command.paused', 'must be boolean')
  if (commandKind === 'cancel-contest' || commandKind === 'apply-correction') text(row.reason, 'command.reason', 500)
  if (commandKind === 'apply-correction') {
    if (row.performerId !== undefined && row.performerId !== null) text(row.performerId, 'command.performerId', 160)
    if (!['appeal-delta','fumble-delta','voltage-delta','dice-pool-delta','controller-reassignment','cancel-contest'].includes(String(row.correctionKind))) fail('command.correctionKind', 'is invalid')
    if (row.statId !== null && !isContestStatId(row.statId)) fail('command.statId', 'is invalid')
    if (row.numericDelta !== null && (!Number.isSafeInteger(row.numericDelta) || Math.abs(Number(row.numericDelta)) > 99)) fail('command.numericDelta', 'must be null or a bounded integer')
    if (row.replacementProfileId !== null && (typeof row.replacementProfileId !== 'string' || !/^profile_[A-Za-z0-9_-]{8,64}$/u.test(row.replacementProfileId))) fail('command.replacementProfileId', 'is invalid')
    if (row.correctionKind === 'cancel-contest') {
      if (row.contestantId !== null || row.performerId != null || row.statId !== null || row.numericDelta !== null || row.replacementProfileId !== null) fail('command.correctionKind', 'cancel-contest accepts only a reason')
    } else {
      if (row.contestantId === null) fail('command.contestantId', 'is required for this correction')
      if (row.correctionKind === 'controller-reassignment') {
        if (row.performerId != null || row.statId !== null || row.numericDelta !== null) fail('command.correctionKind', 'controller-reassignment accepts only a replacement profile')
      } else {
        if (row.numericDelta === null || row.replacementProfileId !== null) fail('command.correctionKind', 'numeric corrections require exactly one bounded delta')
        if ((row.correctionKind === 'dice-pool-delta') !== (row.statId !== null)) fail('command.statId', 'is required only for a dice-pool correction')
        if (row.correctionKind !== 'voltage-delta' && row.performerId != null) fail('command.performerId', 'is available only for a Voltage correction')
      }
    }
  }
  // Parsing validates the mutation dialect; command-specific legal choices are
  // re-derived against the latest authoritative document by the engine.
  return structuredClone(row) as unknown as ContestCommandV1
}
