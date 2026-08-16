import { isSlug } from '../paths'

export const BREEDING_ITEM_WORKFLOW_API_PATH = '/api/breeding/items' as const
export const ITEM_BREEDING_OPERATION_ID_PREFIX = 'item-breeding:v1:' as const
export const BREEDING_ITEM_OPTION_ID_PREFIX = 'breeding-item-option:v1:' as const
export const BREEDING_ITEM_CHOICE_ID_PREFIX = 'breeding-item-choice:v1:' as const

export type ItemBreedingOperationKind = 'assign-egg-warmer' | 'restore-fossil' | 'create-artificial-egg'
export type ItemBreedingSourceWorkflowKind = 'fossil' | 'artificial'
export type ItemBreedingProjectionAudience = 'gm' | 'owner'

export interface ItemBreedingEggWarmerAssignmentV1 {
  readonly inventoryEntryId: string
  readonly unitOrdinal: number
  readonly eggIds: readonly string[]
  readonly assignedAtCampaignMinute: number
  readonly lastOperationId: string
}
export interface ItemBreedingStateV1 {
  readonly schemaVersion: 1
  readonly eggWarmerAssignments: readonly ItemBreedingEggWarmerAssignmentV1[]
}

export interface ItemBreedingOptionV1 {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly disabled: boolean
  readonly unavailableReason: string | null
}
export interface ItemBreedingChoiceV1 {
  readonly choiceId: string
  readonly label: string
  readonly minimum: number
  readonly maximum: number
  readonly options: readonly ItemBreedingOptionV1[]
}
export interface ItemBreedingEggOptionV1 extends ItemBreedingOptionV1 {
  readonly status: 'incubating'
  readonly accumulatedCampaignMinutes: number
  readonly targetCampaignMinutes: number
  readonly percent: number
}
export interface ItemBreedingWarmerUnitV1 extends ItemBreedingOptionV1 {
  readonly assignedEggOptionIds: readonly string[]
}
export interface ItemBreedingWorkflowAvailabilityV1 {
  readonly enabled: boolean
  readonly unavailableReason: string | null
}
export interface ItemBreedingWorkflowProjectionV1 {
  readonly schemaVersion: 1
  readonly audience: ItemBreedingProjectionAudience
  readonly trainer: {
    readonly trainerSheetSlug: string
    readonly trainerRevision: number
    readonly displayName: string
  }
  readonly generatedAtCampaignMinute: number
  readonly commandsBlocked: boolean
  readonly eggWarmer: {
    readonly availability: ItemBreedingWorkflowAvailabilityV1
    readonly capacity: 4
    readonly progressRateNumerator: 2
    readonly progressRateDenominator: 1
    readonly units: readonly ItemBreedingWarmerUnitV1[]
    readonly eggs: readonly ItemBreedingEggOptionV1[]
  }
  readonly fossil: {
    readonly availability: ItemBreedingWorkflowAvailabilityV1
    readonly sourceOptions: readonly ItemBreedingOptionV1[]
    readonly machineOptions: readonly ItemBreedingOptionV1[]
    readonly speciesOptions: readonly ItemBreedingOptionV1[]
    readonly consumesFossilSource: 1
    readonly consumesMachine: 0
  }
  readonly artificial: {
    readonly availability: ItemBreedingWorkflowAvailabilityV1
    readonly chemistryOptions: readonly ItemBreedingOptionV1[]
    readonly moneyCost: 3500
    readonly consumesChemistrySet: 0
  }
}

export interface ItemBreedingSourcePreviewV1 {
  readonly schemaVersion: 1
  readonly kind: ItemBreedingSourceWorkflowKind
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly title: string
  readonly summary: readonly string[]
  readonly choices: readonly ItemBreedingChoiceV1[]
}

export interface AssignEggWarmerCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'assign-egg-warmer'
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly warmerUnitOptionId: string
  readonly eggOptionIds: readonly string[]
}
export interface RestoreFossilCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'restore-fossil'
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly fossilSourceOptionId: string
  readonly machineOptionId: string
  readonly speciesOptionId: string
  readonly selectedOptionIds: readonly string[]
}
export interface CreateArtificialEggCommandV1 {
  readonly schemaVersion: 1
  readonly kind: 'create-artificial-egg'
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly chemistryOptionId: string
  readonly selectedOptionIds: readonly string[]
}
export type ItemBreedingOperationCommandV1 = AssignEggWarmerCommandV1 | RestoreFossilCommandV1 | CreateArtificialEggCommandV1

export interface PreviewFossilRequestV1 {
  readonly schemaVersion: 1
  readonly action: 'preview-fossil'
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly fossilSourceOptionId: string
  readonly machineOptionId: string
  readonly speciesOptionId: string
}
export interface PreviewArtificialRequestV1 {
  readonly schemaVersion: 1
  readonly action: 'preview-artificial'
  readonly operationId: string
  readonly trainerSheetSlug: string
  readonly expectedTrainerRevision: number
  readonly chemistryOptionId: string
}
export type ItemBreedingWorkflowPostRequestV1 = ItemBreedingOperationCommandV1 | PreviewFossilRequestV1 | PreviewArtificialRequestV1

export interface ItemBreedingOperationResultV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly kind: ItemBreedingOperationKind
  readonly status: 'accepted' | 'rejected'
  readonly trainerSheetSlug: string
  readonly trainerRevision: number
  readonly egg: null | {
    readonly sourceKind: 'fossil' | 'feature-artificial'
    readonly speciesName: string
    readonly startingLevel: number
    readonly status: 'incubating'
  }
  readonly assignment: null | {
    readonly warmerLabel: string
    readonly assignedEggLabels: readonly string[]
    readonly capacity: 4
    readonly progressRateNumerator: 2
    readonly progressRateDenominator: 1
  }
  readonly message: string
}

export class ItemBreedingWorkflowValidationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'ItemBreedingWorkflowValidationError'
  }
}
type Row = Record<string, unknown>
const OPERATION_ID = /^item-breeding:v1:[0-9a-f]{32}$/u
const OPTION_ID = /^breeding-item-option:v1:[0-9a-f]{32}$/u
const CHOICE_ID = /^breeding-item-choice:v1:[0-9a-f]{32}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const fail = (path: string, message: string): never => { throw new ItemBreedingWorkflowValidationError(path, message) }
const record = (value: unknown, path: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length > 0) return fail(path, 'must be one plain data object.')
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${path}.${key}`, 'must be an enumerable data field.')
  }
  return value as Row
}
const exact = (value: unknown, fields: readonly string[], path: string): Row => {
  const row = record(value, path); const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(row, field)) || Object.keys(row).some(field => !allowed.has(field))) fail(path, 'must contain exactly the declared fields.')
  return row
}
const array = (value: unknown, maximum: number, path: string): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
    || Object.getOwnPropertySymbols(value).length > 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) return fail(path, `must be one dense plain array of at most ${maximum} entries.`)
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) fail(`${path}[${index}]`, 'must be an enumerable data entry.')
  }
  return value
}
const integer = (value: unknown, path: string, maximum = Number.MAX_SAFE_INTEGER): number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : fail(path, 'must be a bounded nonnegative safe integer.')
const text = (value: unknown, path: string, maximum = 500): string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value) ? value : fail(path, 'must be bounded non-empty text.')
const nullableText = (value: unknown, path: string): string | null => value === null ? null : text(value, path)
const slug = (value: unknown, path: string): string => typeof value === 'string' && value.length <= 160 && isSlug(value) ? value : fail(path, 'must be a canonical slug.')
const operationId = (value: unknown, path: string): string => typeof value === 'string' && OPERATION_ID.test(value) ? value : fail(path, 'must be an item-breeding operation ID.')
const optionId = (value: unknown, path: string): string => typeof value === 'string' && OPTION_ID.test(value) ? value : fail(path, 'must be a breeding-item option ID.')
const choiceId = (value: unknown, path: string): string => typeof value === 'string' && CHOICE_ID.test(value) ? value : fail(path, 'must be a breeding-item choice ID.')
const stableId = (value: unknown, path: string): string => typeof value === 'string' && STABLE_ID.test(value) ? value : fail(path, 'must be a bounded stable ID.')
const sortedUnique = (values: readonly string[], path: string): readonly string[] => {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) fail(path, 'must be unique in strict code-point order.')
  return Object.freeze([...values])
}
const parseOptionIds = (value: unknown, maximum: number, path: string): readonly string[] => sortedUnique(array(value, maximum, path).map((entry, index) => optionId(entry, `${path}[${index}]`)), path)

export const parseItemBreedingState = (value: unknown, path = 'itemBreedingState'): ItemBreedingStateV1 => {
  if (value === undefined || value === null) return Object.freeze({ schemaVersion: 1, eggWarmerAssignments: Object.freeze([]) })
  const row = exact(value, ['schemaVersion', 'eggWarmerAssignments'], path)
  if (row.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
  const assignments = array(row.eggWarmerAssignments, 256, `${path}.eggWarmerAssignments`).map((entry, index) => {
    const current = exact(entry, ['inventoryEntryId','unitOrdinal','eggIds','assignedAtCampaignMinute','lastOperationId'], `${path}.eggWarmerAssignments[${index}]`)
    const eggIds = sortedUnique(array(current.eggIds, 4, `${path}.eggWarmerAssignments[${index}].eggIds`).map((id, eggIndex) => stableId(id, `${path}.eggWarmerAssignments[${index}].eggIds[${eggIndex}]`)), `${path}.eggWarmerAssignments[${index}].eggIds`)
    if (eggIds.length === 0) fail(`${path}.eggWarmerAssignments[${index}].eggIds`, 'must contain at least one Egg.')
    return Object.freeze({ inventoryEntryId: stableId(current.inventoryEntryId, `${path}.eggWarmerAssignments[${index}].inventoryEntryId`), unitOrdinal: integer(current.unitOrdinal, `${path}.eggWarmerAssignments[${index}].unitOrdinal`, 2_147_483_647), eggIds, assignedAtCampaignMinute: integer(current.assignedAtCampaignMinute, `${path}.eggWarmerAssignments[${index}].assignedAtCampaignMinute`), lastOperationId: operationId(current.lastOperationId, `${path}.eggWarmerAssignments[${index}].lastOperationId`) })
  }).sort((left, right) => left.inventoryEntryId.localeCompare(right.inventoryEntryId) || left.unitOrdinal - right.unitOrdinal)
  const keys = assignments.map(value => `${value.inventoryEntryId}\0${String(value.unitOrdinal).padStart(10, '0')}`)
  if (new Set(keys).size !== keys.length) fail(`${path}.eggWarmerAssignments`, 'must identify unique inventory units.')
  const assignedEggIds = assignments.flatMap(value => value.eggIds)
  if (new Set(assignedEggIds).size !== assignedEggIds.length) fail(`${path}.eggWarmerAssignments`, 'must assign each Egg to at most one inventory unit.')
  return Object.freeze({ schemaVersion: 1, eggWarmerAssignments: Object.freeze(assignments) })
}

export const parseItemBreedingOperationCommand = (value: unknown, path = 'itemBreedingCommand'): ItemBreedingOperationCommandV1 => {
  const base = record(value, path)
  if (base.kind === 'assign-egg-warmer') {
    const row = exact(base, ['schemaVersion','kind','operationId','trainerSheetSlug','expectedTrainerRevision','warmerUnitOptionId','eggOptionIds'], path)
    if (row.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
    return Object.freeze({ schemaVersion:1, kind:'assign-egg-warmer', operationId:operationId(row.operationId,`${path}.operationId`), trainerSheetSlug:slug(row.trainerSheetSlug,`${path}.trainerSheetSlug`), expectedTrainerRevision:integer(row.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647), warmerUnitOptionId:optionId(row.warmerUnitOptionId,`${path}.warmerUnitOptionId`), eggOptionIds:parseOptionIds(row.eggOptionIds,4,`${path}.eggOptionIds`) })
  }
  if (base.kind === 'restore-fossil') {
    const row = exact(base, ['schemaVersion','kind','operationId','trainerSheetSlug','expectedTrainerRevision','fossilSourceOptionId','machineOptionId','speciesOptionId','selectedOptionIds'], path)
    if (row.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
    return Object.freeze({ schemaVersion:1, kind:'restore-fossil', operationId:operationId(row.operationId,`${path}.operationId`), trainerSheetSlug:slug(row.trainerSheetSlug,`${path}.trainerSheetSlug`), expectedTrainerRevision:integer(row.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647), fossilSourceOptionId:optionId(row.fossilSourceOptionId,`${path}.fossilSourceOptionId`), machineOptionId:optionId(row.machineOptionId,`${path}.machineOptionId`), speciesOptionId:optionId(row.speciesOptionId,`${path}.speciesOptionId`), selectedOptionIds:parseOptionIds(row.selectedOptionIds,32,`${path}.selectedOptionIds`) })
  }
  if (base.kind === 'create-artificial-egg') {
    const row = exact(base, ['schemaVersion','kind','operationId','trainerSheetSlug','expectedTrainerRevision','chemistryOptionId','selectedOptionIds'], path)
    if (row.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
    return Object.freeze({ schemaVersion:1, kind:'create-artificial-egg', operationId:operationId(row.operationId,`${path}.operationId`), trainerSheetSlug:slug(row.trainerSheetSlug,`${path}.trainerSheetSlug`), expectedTrainerRevision:integer(row.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647), chemistryOptionId:optionId(row.chemistryOptionId,`${path}.chemistryOptionId`), selectedOptionIds:parseOptionIds(row.selectedOptionIds,32,`${path}.selectedOptionIds`) })
  }
  return fail(`${path}.kind`, 'must be a supported item-breeding operation kind.')
}

export const parseItemBreedingWorkflowPostRequest = (value: unknown, path = 'itemBreedingRequest'): ItemBreedingWorkflowPostRequestV1 => {
  const row = record(value, path)
  if (row.action === 'preview-fossil') {
    const current = exact(row, ['schemaVersion','action','operationId','trainerSheetSlug','expectedTrainerRevision','fossilSourceOptionId','machineOptionId','speciesOptionId'], path)
    if (current.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
    return Object.freeze({ schemaVersion:1, action:'preview-fossil', operationId:operationId(current.operationId,`${path}.operationId`), trainerSheetSlug:slug(current.trainerSheetSlug,`${path}.trainerSheetSlug`), expectedTrainerRevision:integer(current.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647), fossilSourceOptionId:optionId(current.fossilSourceOptionId,`${path}.fossilSourceOptionId`), machineOptionId:optionId(current.machineOptionId,`${path}.machineOptionId`), speciesOptionId:optionId(current.speciesOptionId,`${path}.speciesOptionId`) })
  }
  if (row.action === 'preview-artificial') {
    const current = exact(row, ['schemaVersion','action','operationId','trainerSheetSlug','expectedTrainerRevision','chemistryOptionId'], path)
    if (current.schemaVersion !== 1) fail(`${path}.schemaVersion`, 'must be 1.')
    return Object.freeze({ schemaVersion:1, action:'preview-artificial', operationId:operationId(current.operationId,`${path}.operationId`), trainerSheetSlug:slug(current.trainerSheetSlug,`${path}.trainerSheetSlug`), expectedTrainerRevision:integer(current.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647), chemistryOptionId:optionId(current.chemistryOptionId,`${path}.chemistryOptionId`) })
  }
  return parseItemBreedingOperationCommand(row, path)
}

const parseOption = (value: unknown, path: string): ItemBreedingOptionV1 => {
  const row = exact(value, ['optionId','label','description','disabled','unavailableReason'], path)
  if (typeof row.disabled !== 'boolean' || (row.disabled !== (row.unavailableReason !== null))) fail(path, 'disabled and unavailable reason must agree.')
  const disabled = row.disabled as boolean
  return Object.freeze({ optionId:optionId(row.optionId,`${path}.optionId`), label:text(row.label,`${path}.label`,240), description:nullableText(row.description,`${path}.description`), disabled, unavailableReason:nullableText(row.unavailableReason,`${path}.unavailableReason`) })
}
const parseAvailability = (value: unknown, path: string): ItemBreedingWorkflowAvailabilityV1 => {
  const row = exact(value, ['enabled','unavailableReason'], path)
  if (typeof row.enabled !== 'boolean' || (row.enabled === (row.unavailableReason !== null))) fail(path, 'enabled and unavailable reason must agree.')
  const enabled = row.enabled as boolean
  return Object.freeze({ enabled, unavailableReason: nullableText(row.unavailableReason,`${path}.unavailableReason`) })
}

export const parseItemBreedingWorkflowProjection = (value: unknown, path = 'itemBreedingProjection'): ItemBreedingWorkflowProjectionV1 => {
  const row = exact(value, ['schemaVersion','audience','trainer','generatedAtCampaignMinute','commandsBlocked','eggWarmer','fossil','artificial'], path)
  if (row.schemaVersion !== 1 || (row.audience !== 'gm' && row.audience !== 'owner') || typeof row.commandsBlocked !== 'boolean') fail(path, 'must be a v1 role-projected workflow.')
  const trainer = exact(row.trainer, ['trainerSheetSlug','trainerRevision','displayName'], `${path}.trainer`)
  const warmer = exact(row.eggWarmer, ['availability','capacity','progressRateNumerator','progressRateDenominator','units','eggs'], `${path}.eggWarmer`)
  if (warmer.capacity !== 4 || warmer.progressRateNumerator !== 2 || warmer.progressRateDenominator !== 1) fail(`${path}.eggWarmer`, 'must retain reviewed capacity and rate.')
  const units = array(warmer.units, 256, `${path}.eggWarmer.units`).map((entry,index) => {
    const current = exact(entry, ['optionId','label','description','disabled','unavailableReason','assignedEggOptionIds'], `${path}.eggWarmer.units[${index}]`)
    const base = parseOption({ optionId:current.optionId,label:current.label,description:current.description,disabled:current.disabled,unavailableReason:current.unavailableReason }, `${path}.eggWarmer.units[${index}]`)
    return Object.freeze({ ...base, assignedEggOptionIds:parseOptionIds(current.assignedEggOptionIds,4,`${path}.eggWarmer.units[${index}].assignedEggOptionIds`) })
  })
  const eggs = array(warmer.eggs, 256, `${path}.eggWarmer.eggs`).map((entry,index) => {
    const current = exact(entry, ['optionId','label','description','disabled','unavailableReason','status','accumulatedCampaignMinutes','targetCampaignMinutes','percent'], `${path}.eggWarmer.eggs[${index}]`)
    const base = parseOption({ optionId:current.optionId,label:current.label,description:current.description,disabled:current.disabled,unavailableReason:current.unavailableReason }, `${path}.eggWarmer.eggs[${index}]`)
    const target = integer(current.targetCampaignMinutes,`${path}.eggWarmer.eggs[${index}].targetCampaignMinutes`)
    const accumulated = integer(current.accumulatedCampaignMinutes,`${path}.eggWarmer.eggs[${index}].accumulatedCampaignMinutes`,target)
    const percent = integer(current.percent,`${path}.eggWarmer.eggs[${index}].percent`,100)
    if (current.status !== 'incubating') fail(`${path}.eggWarmer.eggs[${index}].status`,'must be incubating.')
    return Object.freeze({ ...base, status:'incubating' as const, accumulatedCampaignMinutes:accumulated,targetCampaignMinutes:target,percent })
  })
  const fossil = exact(row.fossil, ['availability','sourceOptions','machineOptions','speciesOptions','consumesFossilSource','consumesMachine'], `${path}.fossil`)
  if (fossil.consumesFossilSource !== 1 || fossil.consumesMachine !== 0) fail(`${path}.fossil`,'must preserve exact consumption.')
  const artificial = exact(row.artificial, ['availability','chemistryOptions','moneyCost','consumesChemistrySet'], `${path}.artificial`)
  if (artificial.moneyCost !== 3500 || artificial.consumesChemistrySet !== 0) fail(`${path}.artificial`,'must preserve exact cost and tool custody.')
  const options = (raw: unknown, name: string) => Object.freeze(array(raw,1_024,`${path}.${name}`).map((entry,index)=>parseOption(entry,`${path}.${name}[${index}]`)))
  return Object.freeze({ schemaVersion:1, audience:row.audience, trainer:Object.freeze({trainerSheetSlug:slug(trainer.trainerSheetSlug,`${path}.trainer.trainerSheetSlug`),trainerRevision:integer(trainer.trainerRevision,`${path}.trainer.trainerRevision`,2_147_483_647),displayName:text(trainer.displayName,`${path}.trainer.displayName`,240)}), generatedAtCampaignMinute:integer(row.generatedAtCampaignMinute,`${path}.generatedAtCampaignMinute`), commandsBlocked:row.commandsBlocked, eggWarmer:Object.freeze({availability:parseAvailability(warmer.availability,`${path}.eggWarmer.availability`),capacity:4,progressRateNumerator:2,progressRateDenominator:1,units:Object.freeze(units),eggs:Object.freeze(eggs)}), fossil:Object.freeze({availability:parseAvailability(fossil.availability,`${path}.fossil.availability`),sourceOptions:options(fossil.sourceOptions,'fossil.sourceOptions'),machineOptions:options(fossil.machineOptions,'fossil.machineOptions'),speciesOptions:options(fossil.speciesOptions,'fossil.speciesOptions'),consumesFossilSource:1,consumesMachine:0}), artificial:Object.freeze({availability:parseAvailability(artificial.availability,`${path}.artificial.availability`),chemistryOptions:options(artificial.chemistryOptions,'artificial.chemistryOptions'),moneyCost:3500,consumesChemistrySet:0}) }) as ItemBreedingWorkflowProjectionV1
}

export const parseItemBreedingSourcePreview = (value: unknown, path = 'itemBreedingPreview'): ItemBreedingSourcePreviewV1 => {
  const row = exact(value, ['schemaVersion','kind','operationId','trainerSheetSlug','expectedTrainerRevision','title','summary','choices'], path)
  if (row.schemaVersion !== 1 || (row.kind !== 'fossil' && row.kind !== 'artificial')) fail(path,'must be one source-workflow preview.')
  const kind = row.kind as ItemBreedingSourceWorkflowKind
  const choices = array(row.choices,16,`${path}.choices`).map((entry,index) => {
    const current = exact(entry,['choiceId','label','minimum','maximum','options'],`${path}.choices[${index}]`)
    const minimum=integer(current.minimum,`${path}.choices[${index}].minimum`,32);const maximum=integer(current.maximum,`${path}.choices[${index}].maximum`,32)
    if(maximum<minimum)fail(`${path}.choices[${index}]`,'maximum must not be below minimum.')
    return Object.freeze({choiceId:choiceId(current.choiceId,`${path}.choices[${index}].choiceId`),label:text(current.label,`${path}.choices[${index}].label`,240),minimum,maximum,options:Object.freeze(array(current.options,1_024,`${path}.choices[${index}].options`).map((option,index2)=>parseOption(option,`${path}.choices[${index}].options[${index2}]`)))})
  })
  if(new Set(choices.map(value=>value.choiceId)).size!==choices.length)fail(`${path}.choices`,'choice identities must be unique.')
  return Object.freeze({schemaVersion:1,kind,operationId:operationId(row.operationId,`${path}.operationId`),trainerSheetSlug:slug(row.trainerSheetSlug,`${path}.trainerSheetSlug`),expectedTrainerRevision:integer(row.expectedTrainerRevision,`${path}.expectedTrainerRevision`,2_147_483_647),title:text(row.title,`${path}.title`,240),summary:Object.freeze(array(row.summary,16,`${path}.summary`).map((entry,index)=>text(entry,`${path}.summary[${index}]`,500))),choices:Object.freeze(choices)})
}

export const parseItemBreedingOperationResult = (value: unknown, path = 'itemBreedingResult'): ItemBreedingOperationResultV1 => {
  const row=exact(value,['schemaVersion','operationId','kind','status','trainerSheetSlug','trainerRevision','egg','assignment','message'],path)
  if(row.schemaVersion!==1||!['assign-egg-warmer','restore-fossil','create-artificial-egg'].includes(String(row.kind))||!['accepted','rejected'].includes(String(row.status)))fail(path,'must be a v1 item-breeding result.')
  let egg:ItemBreedingOperationResultV1['egg']=null
  if(row.egg!==null){const current=exact(row.egg,['sourceKind','speciesName','startingLevel','status'],`${path}.egg`);if(!['fossil','feature-artificial'].includes(String(current.sourceKind))||current.status!=='incubating')fail(`${path}.egg`,'must be a safe incubating Egg summary.');egg=Object.freeze({sourceKind:current.sourceKind as 'fossil'|'feature-artificial',speciesName:text(current.speciesName,`${path}.egg.speciesName`,240),startingLevel:integer(current.startingLevel,`${path}.egg.startingLevel`,100),status:'incubating'})}
  let assignment:ItemBreedingOperationResultV1['assignment']=null
  if(row.assignment!==null){const current=exact(row.assignment,['warmerLabel','assignedEggLabels','capacity','progressRateNumerator','progressRateDenominator'],`${path}.assignment`);if(current.capacity!==4||current.progressRateNumerator!==2||current.progressRateDenominator!==1)fail(`${path}.assignment`,'must preserve reviewed warmer mechanics.');assignment=Object.freeze({warmerLabel:text(current.warmerLabel,`${path}.assignment.warmerLabel`,240),assignedEggLabels:Object.freeze(array(current.assignedEggLabels,4,`${path}.assignment.assignedEggLabels`).map((entry,index)=>text(entry,`${path}.assignment.assignedEggLabels[${index}]`,240))),capacity:4,progressRateNumerator:2,progressRateDenominator:1})}
  if((row.kind==='assign-egg-warmer')!==(assignment!==null)||(row.kind==='assign-egg-warmer')===(egg!==null)||(row.status==='accepted'&&row.kind!=='assign-egg-warmer'&&egg===null)||(row.status==='rejected'&&(egg!==null||assignment!==null)))fail(path,'result payload does not match kind and status.')
  return Object.freeze({schemaVersion:1,operationId:operationId(row.operationId,`${path}.operationId`),kind:row.kind as ItemBreedingOperationKind,status:row.status as 'accepted'|'rejected',trainerSheetSlug:slug(row.trainerSheetSlug,`${path}.trainerSheetSlug`),trainerRevision:integer(row.trainerRevision,`${path}.trainerRevision`,2_147_483_647),egg,assignment,message:text(row.message,`${path}.message`,500)})
}

export const itemBreedingOperationHex = (value: string): string => operationId(value, 'operationId').slice(ITEM_BREEDING_OPERATION_ID_PREFIX.length)
export const itemBreedingOptionIdSyntax = (value: unknown): string | null => typeof value === 'string' && OPTION_ID.test(value) ? value : null
