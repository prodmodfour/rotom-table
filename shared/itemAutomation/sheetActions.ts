import { SLUG_RE } from '../paths'
import { isSheetKind, type SheetKind } from '../sheets'
import {
  ITEM_INVENTORY_SECTIONS,
  type ItemInventorySection,
} from './inventory'
import { parseUseItemCommand, type UseItemCommandV1 } from './operations'

export const SHEET_ITEM_ACTION_SCHEMA_VERSION = 1 as const
export const SHEET_ITEM_ACTION_LIMITS = Object.freeze({
  offers: 256,
  actionsPerOffer: 3,
  targetsPerOffer: 64,
  previewFactsPerTarget: 12,
  choicesPerTarget: 8,
  optionsPerChoice: 64,
  textLength: 500,
  identifierLength: 1_024,
})

export type SheetItemActionKind = 'use' | 'inspect' | 'equip'
export type SheetItemActionTone = 'neutral' | 'positive' | 'warning'

export interface SheetItemActionReason {
  readonly code: string
  readonly label: string
}

export interface SheetItemActionControl {
  readonly kind: SheetItemActionKind
  readonly label: string
  readonly enabled: boolean
  readonly unavailableReason: SheetItemActionReason | null
  readonly href: string | null
}

export interface SheetItemTargetPreviewFact {
  readonly label: string
  readonly value: string
  readonly tone: SheetItemActionTone
}

export interface SheetItemActionChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly previewFacts: readonly SheetItemTargetPreviewFact[]
}

export interface SheetItemActionChoice {
  readonly choiceId: string
  readonly label: string
  readonly presentation: 'radio' | 'confirmation'
  readonly minimum: number
  readonly maximum: number
  readonly options: readonly SheetItemActionChoiceOption[]
}

export interface SheetItemTargetOption {
  readonly targetId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly label: string
  readonly kindLabel: 'Trainer' | 'Pokémon'
  readonly summary: string | null
  readonly description: string | null
  readonly href: string
  readonly enabled: boolean
  readonly unavailableReason: SheetItemActionReason | null
  readonly previewFacts: readonly SheetItemTargetPreviewFact[]
  /** Safe target-specific choices. Opaque option IDs are reauthorized on declaration and completion. */
  readonly choices: readonly SheetItemActionChoice[]
}

export interface SheetItemActionOfferV1 {
  readonly schemaVersion: typeof SHEET_ITEM_ACTION_SCHEMA_VERSION
  readonly offerId: string
  readonly actor: {
    readonly sheetKind: 'trainer'
    readonly sheetSlug: string
    readonly revision: number
    readonly label: string
    readonly href: string
  }
  readonly source: {
    /** Opaque offer-local source choice; never a row or serialized-item identity. */
    readonly sourceSelectionId: string
    readonly containerKind: 'trainer' | 'group'
    readonly containerLabel: 'Trainer inventory' | 'Group inventory'
    readonly canonicalId: string | null
    readonly displayName: string
    readonly section: ItemInventorySection
    readonly sectionLabel: string
    /** Presentation locator within the projected section; never an authority identity. */
    readonly rowIndex: number
    /** User-facing locator that corresponds to rowIndex without exposing the inventory row ID. */
    readonly rowLabel: string
    readonly quantity: number
  }
  readonly context: 'sheet'
  readonly description: string | null
  readonly timingLabel: string
  readonly costs: readonly string[]
  readonly acceptanceNotice: string
  readonly availability: {
    readonly enabled: boolean
    readonly unavailableReason: SheetItemActionReason | null
  }
  readonly actions: readonly SheetItemActionControl[]
  readonly targeting: {
    readonly requirementId: string
    readonly minimum: number
    readonly maximum: number
    readonly options: readonly SheetItemTargetOption[]
  } | null
}

export interface SheetItemActionProjectionV1 {
  readonly schemaVersion: typeof SHEET_ITEM_ACTION_SCHEMA_VERSION
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly generatedAt: number
  readonly offers: readonly SheetItemActionOfferV1[]
}

/** Declaration-only shape. Private command authority is never present in the list projection. */
export type AuthorizedSheetItemActionOffer = SheetItemActionOfferV1 & {
  readonly itemCommand: UseItemCommandV1
}

export interface DeclareSheetItemActionIntentV1 {
  readonly schemaVersion: typeof SHEET_ITEM_ACTION_SCHEMA_VERSION
  readonly trainerSlug: string
  readonly trainerRevision: number
  readonly offerId: string
  readonly action: 'use'
}

export class SheetItemActionValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetItemActionValidationError'
  }
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const SOURCE_SELECTION_ID_PATTERN = /^inventory-source:v1:[a-f0-9]{32}$/u
const ACTION_KINDS = new Set<string>(['use', 'inspect', 'equip'])
const TONES = new Set<string>(['neutral', 'positive', 'warning'])
const CHOICE_PRESENTATIONS = new Set<string>(['radio', 'confirmation'])
const SECTIONS = new Set<string>(ITEM_INVENTORY_SECTIONS)

const fail = (message: string): never => { throw new SheetItemActionValidationError(message) }
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`${label} must be an object.`)
  return value as Record<string, unknown>
}
const exact = (value: Record<string, unknown>, fields: readonly string[], label: string): void => {
  const allowed = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    fail(`${label} has an invalid shape.`)
  }
}
const text = (value: unknown, label: string, maximum: number = SHEET_ITEM_ACTION_LIMITS.textLength): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > maximum || CONTROL_CHARACTER_PATTERN.test(value)) return fail(`${label} must be bounded safe text.`)
  return value
}
const nullableText = (value: unknown, label: string): string | null => value === null ? null : text(value, label)
const integer = (value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) return fail(`${label} must be a safe non-negative integer.`)
  return Number(value)
}
const bool = (value: unknown, label: string): boolean => typeof value === 'boolean' ? value : fail(`${label} must be boolean.`)
const array = (value: unknown, label: string, maximum: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) return fail(`${label} must be a bounded array.`)
  return value
}
const slug = (value: unknown, label: string): string => {
  const parsed = text(value, label, 200)
  return SLUG_RE.test(parsed) ? parsed : fail(`${label} must be a sheet slug.`)
}
const href = (value: unknown, label: string): string => {
  const parsed = text(value, label, SHEET_ITEM_ACTION_LIMITS.identifierLength)
  return parsed.startsWith('/') && !parsed.startsWith('//') ? parsed : fail(`${label} must be an app-relative path.`)
}
const nullableHref = (value: unknown, label: string): string | null => value === null ? null : href(value, label)

const parseReason = (value: unknown, label: string): SheetItemActionReason | null => {
  if (value === null) return null
  const input = record(value, label)
  exact(input, ['code', 'label'], label)
  return Object.freeze({ code: text(input.code, `${label}.code`, 200), label: text(input.label, `${label}.label`) })
}

const assertAvailabilityPair = (
  enabled: boolean,
  reason: SheetItemActionReason | null,
  label: string,
): void => {
  if (enabled === (reason !== null)) fail(`${label} must pair enabled state with exactly one unavailable reason.`)
}

const parseAction = (value: unknown, label: string): SheetItemActionControl => {
  const input = record(value, label)
  exact(input, ['kind', 'label', 'enabled', 'unavailableReason', 'href'], label)
  const kind = text(input.kind, `${label}.kind`, 20)
  if (!ACTION_KINDS.has(kind)) fail(`${label}.kind is unsupported.`)
  const enabled = bool(input.enabled, `${label}.enabled`)
  const unavailableReason = parseReason(input.unavailableReason, `${label}.unavailableReason`)
  assertAvailabilityPair(enabled, unavailableReason, label)
  const parsedHref = nullableHref(input.href, `${label}.href`)
  if (kind === 'inspect' && enabled && !parsedHref) fail(`${label} requires an inspect href.`)
  if (kind !== 'inspect' && parsedHref) fail(`${label} may not carry navigation authority.`)
  return Object.freeze({
    kind: kind as SheetItemActionKind,
    label: text(input.label, `${label}.label`, 100),
    enabled,
    unavailableReason,
    href: parsedHref,
  })
}

const parsePreviewFact = (value: unknown, label: string): SheetItemTargetPreviewFact => {
  const input = record(value, label)
  exact(input, ['label', 'value', 'tone'], label)
  const tone = text(input.tone, `${label}.tone`, 20)
  if (!TONES.has(tone)) fail(`${label}.tone is unsupported.`)
  return Object.freeze({
    label: text(input.label, `${label}.label`, 100),
    value: text(input.value, `${label}.value`, 200),
    tone: tone as SheetItemActionTone,
  })
}

const parseChoiceOption = (value: unknown, label: string): SheetItemActionChoiceOption => {
  const input = record(value, label)
  exact(input, ['optionId', 'label', 'description', 'previewFacts'], label)
  return Object.freeze({
    optionId: text(input.optionId, `${label}.optionId`, SHEET_ITEM_ACTION_LIMITS.identifierLength),
    label: text(input.label, `${label}.label`, 200),
    description: nullableText(input.description, `${label}.description`),
    previewFacts: Object.freeze(array(
      input.previewFacts,
      `${label}.previewFacts`,
      SHEET_ITEM_ACTION_LIMITS.previewFactsPerTarget,
    ).map((entry, index) => parsePreviewFact(entry, `${label}.previewFacts[${index}]`))),
  })
}

const parseChoice = (value: unknown, label: string): SheetItemActionChoice => {
  const input = record(value, label)
  exact(input, ['choiceId', 'label', 'presentation', 'minimum', 'maximum', 'options'], label)
  const presentation = text(input.presentation, `${label}.presentation`, 20)
  if (!CHOICE_PRESENTATIONS.has(presentation)) fail(`${label}.presentation is unsupported.`)
  const minimum = integer(input.minimum, `${label}.minimum`, SHEET_ITEM_ACTION_LIMITS.optionsPerChoice)
  const maximum = integer(input.maximum, `${label}.maximum`, SHEET_ITEM_ACTION_LIMITS.optionsPerChoice)
  if (minimum > maximum) fail(`${label} cardinality is invalid.`)
  const options = array(input.options, `${label}.options`, SHEET_ITEM_ACTION_LIMITS.optionsPerChoice)
    .map((entry, index) => parseChoiceOption(entry, `${label}.options[${index}]`))
  if (new Set(options.map(option => option.optionId)).size !== options.length
    || (maximum > 0 && options.length === 0)) fail(`${label}.options are invalid.`)
  if (presentation === 'confirmation' && (minimum !== 1 || maximum !== 1 || options.length !== 1)) {
    fail(`${label} confirmation choices require one exact option.`)
  }
  return Object.freeze({
    choiceId: text(input.choiceId, `${label}.choiceId`, 200),
    label: text(input.label, `${label}.label`, 200),
    presentation: presentation as 'radio' | 'confirmation',
    minimum,
    maximum,
    options: Object.freeze(options),
  })
}

const parseTarget = (value: unknown, label: string): SheetItemTargetOption => {
  const input = record(value, label)
  exact(input, [
    'targetId', 'sheetKind', 'sheetSlug', 'label', 'kindLabel', 'summary', 'description',
    'href', 'enabled', 'unavailableReason', 'previewFacts',
    ...(Object.hasOwn(input, 'choices') ? ['choices'] : []),
  ], label)
  if (!isSheetKind(input.sheetKind)) fail(`${label}.sheetKind is unsupported.`)
  const sheetKind = input.sheetKind as SheetKind
  const kindLabel = text(input.kindLabel, `${label}.kindLabel`, 20)
  if ((sheetKind === 'trainer' && kindLabel !== 'Trainer') || (sheetKind === 'pokemon' && kindLabel !== 'Pokémon')) {
    fail(`${label}.kindLabel does not match its sheet kind.`)
  }
  const enabled = bool(input.enabled, `${label}.enabled`)
  const unavailableReason = parseReason(input.unavailableReason, `${label}.unavailableReason`)
  assertAvailabilityPair(enabled, unavailableReason, label)
  const targetId = text(input.targetId, `${label}.targetId`, SHEET_ITEM_ACTION_LIMITS.identifierLength)
  const targetRef = parseSheetItemTargetId(targetId)
  const sheetSlug = slug(input.sheetSlug, `${label}.sheetSlug`)
  if (!targetRef || targetRef.kind !== sheetKind || targetRef.slug !== sheetSlug) fail(`${label}.targetId does not match its sheet.`)
  return Object.freeze({
    targetId,
    sheetKind,
    sheetSlug,
    label: text(input.label, `${label}.label`, 200),
    kindLabel: kindLabel as 'Trainer' | 'Pokémon',
    summary: nullableText(input.summary, `${label}.summary`),
    description: nullableText(input.description, `${label}.description`),
    href: href(input.href, `${label}.href`),
    enabled,
    unavailableReason,
    previewFacts: Object.freeze(array(input.previewFacts, `${label}.previewFacts`, SHEET_ITEM_ACTION_LIMITS.previewFactsPerTarget)
      .map((entry, index) => parsePreviewFact(entry, `${label}.previewFacts[${index}]`))),
    choices: (() => {
      const choices = array(input.choices ?? [], `${label}.choices`, SHEET_ITEM_ACTION_LIMITS.choicesPerTarget)
        .map((entry, index) => parseChoice(entry, `${label}.choices[${index}]`))
      if (new Set(choices.map(choice => choice.choiceId)).size !== choices.length) {
        fail(`${label}.choices must have unique identities.`)
      }
      return Object.freeze(choices)
    })(),
  })
}

export const parseSheetItemActionOffer = (value: unknown, label = 'sheetItemActionOffer'): SheetItemActionOfferV1 => {
  const input = record(value, label)
  exact(input, [
    'schemaVersion', 'offerId', 'actor', 'source', 'context', 'description', 'timingLabel',
    'costs', 'acceptanceNotice', 'availability', 'actions', 'targeting',
  ], label)
  if (input.schemaVersion !== SHEET_ITEM_ACTION_SCHEMA_VERSION || input.context !== 'sheet') fail(`${label} uses an unsupported schema or context.`)
  const actor = record(input.actor, `${label}.actor`)
  exact(actor, ['sheetKind', 'sheetSlug', 'revision', 'label', 'href'], `${label}.actor`)
  if (actor.sheetKind !== 'trainer') fail(`${label}.actor must be a Trainer.`)
  const actorSlug = slug(actor.sheetSlug, `${label}.actor.sheetSlug`)
  const source = record(input.source, `${label}.source`)
  exact(source, [
    'sourceSelectionId', 'containerKind', 'containerLabel', 'canonicalId', 'displayName',
    'section', 'sectionLabel', 'rowIndex', 'rowLabel', 'quantity',
  ], `${label}.source`)
  if ((source.containerKind !== 'trainer' && source.containerKind !== 'group')
    || (source.containerKind === 'trainer' && source.containerLabel !== 'Trainer inventory')
    || (source.containerKind === 'group' && source.containerLabel !== 'Group inventory')) {
    fail(`${label}.source container is unsupported.`)
  }
  const section = text(source.section, `${label}.source.section`, 50)
  if (!SECTIONS.has(section)) fail(`${label}.source.section is unsupported.`)
  const sourceSelectionId = text(source.sourceSelectionId, `${label}.source.sourceSelectionId`, SHEET_ITEM_ACTION_LIMITS.identifierLength)
  if (!SOURCE_SELECTION_ID_PATTERN.test(sourceSelectionId)) fail(`${label}.source.sourceSelectionId must be an opaque inventory source identity.`)
  const sourceRowIndex = integer(source.rowIndex, `${label}.source.rowIndex`, 1_000_000)
  const sourceRowLabel = text(source.rowLabel, `${label}.source.rowLabel`, 100)
  if (sourceRowLabel !== `Row ${sourceRowIndex + 1}`) fail(`${label}.source.rowLabel does not match its presentation row.`)
  const availabilityInput = record(input.availability, `${label}.availability`)
  exact(availabilityInput, ['enabled', 'unavailableReason'], `${label}.availability`)
  const availabilityEnabled = bool(availabilityInput.enabled, `${label}.availability.enabled`)
  const availabilityReason = parseReason(availabilityInput.unavailableReason, `${label}.availability.unavailableReason`)
  assertAvailabilityPair(availabilityEnabled, availabilityReason, `${label}.availability`)
  const actions = array(input.actions, `${label}.actions`, SHEET_ITEM_ACTION_LIMITS.actionsPerOffer)
    .map((entry, index) => parseAction(entry, `${label}.actions[${index}]`))
  if (new Set(actions.map(action => action.kind)).size !== actions.length || !actions.some(action => action.kind === 'inspect')) {
    fail(`${label}.actions must be unique and include Inspect.`)
  }
  let targeting: SheetItemActionOfferV1['targeting'] = null
  if (input.targeting !== null) {
    const targetInput = record(input.targeting, `${label}.targeting`)
    exact(targetInput, ['requirementId', 'minimum', 'maximum', 'options'], `${label}.targeting`)
    const minimum = integer(targetInput.minimum, `${label}.targeting.minimum`, SHEET_ITEM_ACTION_LIMITS.targetsPerOffer)
    const maximum = integer(targetInput.maximum, `${label}.targeting.maximum`, SHEET_ITEM_ACTION_LIMITS.targetsPerOffer)
    if (minimum > maximum) fail(`${label}.targeting cardinality is invalid.`)
    const options = array(targetInput.options, `${label}.targeting.options`, SHEET_ITEM_ACTION_LIMITS.targetsPerOffer)
      .map((entry, index) => parseTarget(entry, `${label}.targeting.options[${index}]`))
    if (new Set(options.map(option => option.targetId)).size !== options.length) fail(`${label}.targeting options must be unique.`)
    targeting = Object.freeze({
      requirementId: text(targetInput.requirementId, `${label}.targeting.requirementId`, 200),
      minimum,
      maximum,
      options: Object.freeze(options),
    })
  }
  return Object.freeze({
    schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
    offerId: text(input.offerId, `${label}.offerId`, SHEET_ITEM_ACTION_LIMITS.identifierLength),
    actor: Object.freeze({
      sheetKind: 'trainer' as const,
      sheetSlug: actorSlug,
      revision: integer(actor.revision, `${label}.actor.revision`),
      label: text(actor.label, `${label}.actor.label`, 200),
      href: href(actor.href, `${label}.actor.href`),
    }),
    source: Object.freeze({
      sourceSelectionId,
      containerKind: source.containerKind as 'trainer' | 'group',
      containerLabel: source.containerLabel as 'Trainer inventory' | 'Group inventory',
      canonicalId: nullableText(source.canonicalId, `${label}.source.canonicalId`),
      displayName: text(source.displayName, `${label}.source.displayName`, 200),
      section: section as ItemInventorySection,
      sectionLabel: text(source.sectionLabel, `${label}.source.sectionLabel`, 100),
      rowIndex: sourceRowIndex,
      rowLabel: sourceRowLabel,
      quantity: integer(source.quantity, `${label}.source.quantity`, 1_000_000_000),
    }),
    context: 'sheet' as const,
    description: nullableText(input.description, `${label}.description`),
    timingLabel: text(input.timingLabel, `${label}.timingLabel`, 100),
    costs: Object.freeze(array(input.costs, `${label}.costs`, 16).map((entry, index) => text(entry, `${label}.costs[${index}]`, 200))),
    acceptanceNotice: text(input.acceptanceNotice, `${label}.acceptanceNotice`, 300),
    availability: Object.freeze({ enabled: availabilityEnabled, unavailableReason: availabilityReason }),
    actions: Object.freeze(actions),
    targeting,
  })
}

export const parseSheetItemActionProjection = (value: unknown): SheetItemActionProjectionV1 => {
  const input = record(value, 'sheetItemActionProjection')
  exact(input, ['schemaVersion', 'trainerSlug', 'trainerRevision', 'generatedAt', 'offers'], 'sheetItemActionProjection')
  if (input.schemaVersion !== SHEET_ITEM_ACTION_SCHEMA_VERSION) fail('sheetItemActionProjection uses an unsupported schema version.')
  const offers = array(input.offers, 'sheetItemActionProjection.offers', SHEET_ITEM_ACTION_LIMITS.offers)
    .map((entry, index) => parseSheetItemActionOffer(entry, `sheetItemActionProjection.offers[${index}]`))
  if (new Set(offers.map(offer => offer.offerId)).size !== offers.length) fail('sheetItemActionProjection offer IDs must be unique.')
  if (new Set(offers.map(offer => offer.source.sourceSelectionId)).size !== offers.length) {
    fail('sheetItemActionProjection source selection IDs must be unique.')
  }
  const trainerSlug = slug(input.trainerSlug, 'sheetItemActionProjection.trainerSlug')
  const trainerRevision = integer(input.trainerRevision, 'sheetItemActionProjection.trainerRevision')
  if (offers.some(offer => offer.actor.sheetSlug !== trainerSlug || offer.actor.revision !== trainerRevision)) {
    fail('sheetItemActionProjection offers do not match the projected Trainer revision.')
  }
  return Object.freeze({
    schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
    trainerSlug,
    trainerRevision,
    generatedAt: integer(input.generatedAt, 'sheetItemActionProjection.generatedAt'),
    offers: Object.freeze(offers),
  })
}

export const parseDeclareSheetItemActionIntent = (value: unknown): DeclareSheetItemActionIntentV1 => {
  const input = record(value, 'declareSheetItemActionIntent')
  exact(input, ['schemaVersion', 'trainerSlug', 'trainerRevision', 'offerId', 'action'], 'declareSheetItemActionIntent')
  if (input.schemaVersion !== SHEET_ITEM_ACTION_SCHEMA_VERSION || input.action !== 'use') {
    fail('declareSheetItemActionIntent uses an unsupported schema or action.')
  }
  return Object.freeze({
    schemaVersion: SHEET_ITEM_ACTION_SCHEMA_VERSION,
    trainerSlug: slug(input.trainerSlug, 'declareSheetItemActionIntent.trainerSlug'),
    trainerRevision: integer(input.trainerRevision, 'declareSheetItemActionIntent.trainerRevision'),
    offerId: text(input.offerId, 'declareSheetItemActionIntent.offerId', SHEET_ITEM_ACTION_LIMITS.identifierLength),
    action: 'use' as const,
  })
}

export const parseAuthorizedSheetItemActionOffer = (value: unknown): AuthorizedSheetItemActionOffer => {
  const input = record(value, 'authorizedSheetItemActionOffer')
  if (!Object.hasOwn(input, 'itemCommand')) fail('authorizedSheetItemActionOffer is missing private command authority.')
  const { itemCommand, ...offerInput } = input
  const offer = parseSheetItemActionOffer(offerInput, 'authorizedSheetItemActionOffer')
  const command = parseUseItemCommand(itemCommand)
  if (command.context !== 'sheet' || command.offerId !== offer.offerId
    || command.actorSheet.kind !== offer.actor.sheetKind
    || command.actorSheet.slug !== offer.actor.sheetSlug
    || command.actorSheet.expectedRevision !== offer.actor.revision
    || command.source.kind !== offer.source.containerKind
    || (command.source.kind === 'trainer' && command.source.slug !== offer.actor.sheetSlug)
    || command.source.section !== offer.source.section
    || (command.source.kind === 'trainer' && command.source.expectedRevision !== offer.actor.revision)) {
    fail('authorizedSheetItemActionOffer command authority does not match its offer.')
  }
  return Object.freeze({ ...offer, itemCommand: command })
}

export const sheetItemTargetId = (kind: SheetKind, value: string): string => {
  if (!isSheetKind(kind) || !SLUG_RE.test(value)) throw new SheetItemActionValidationError('Sheet item target requires a valid sheet identity.')
  return `sheet-target:v1:${kind}:${value}`
}

export const parseSheetItemTargetId = (value: unknown): { readonly kind: SheetKind, readonly slug: string } | null => {
  if (typeof value !== 'string' || value.length > SHEET_ITEM_ACTION_LIMITS.identifierLength) return null
  const [prefix, version, kind, valueSlug, ...rest] = value.split(':')
  if (prefix !== 'sheet-target' || version !== 'v1' || rest.length > 0 || !isSheetKind(kind) || !SLUG_RE.test(valueSlug ?? '')) return null
  return Object.freeze({ kind: kind as SheetKind, slug: valueSlug! })
}

/** Bind only server-projected target identities to a fresh private command template. */
export const itemCommandFromAuthorizedSheetAction = (input: {
  readonly offer: AuthorizedSheetItemActionOffer
  readonly operationId: string
  readonly targetIds: readonly string[]
  readonly choices?: readonly { readonly choiceId: string, readonly optionIds: readonly string[] }[]
}): UseItemCommandV1 => {
  const useAction = input.offer.actions.find(action => action.kind === 'use')
  if (!input.offer.availability.enabled || !useAction?.enabled) {
    throw new SheetItemActionValidationError('This sheet item action is unavailable.')
  }
  const targeting = input.offer.targeting
  const targetIds = [...new Set(input.targetIds)]
  if (targetIds.length !== input.targetIds.length) throw new SheetItemActionValidationError('Sheet item targets must be unique.')
  if (targeting) {
    if (targetIds.length < targeting.minimum || targetIds.length > targeting.maximum) {
      throw new SheetItemActionValidationError('Sheet item target selection is incomplete.')
    }
    const options = new Map(targeting.options.map(option => [option.targetId, option]))
    if (targetIds.some(targetId => options.get(targetId)?.enabled !== true)) {
      throw new SheetItemActionValidationError('A selected sheet item target is unavailable.')
    }
  }
  else if (targetIds.length > 0) throw new SheetItemActionValidationError('This sheet item action does not accept targets.')
  const presentedChoices = targetIds.length === 1
    ? targeting?.options.find(option => option.targetId === targetIds[0])?.choices ?? []
    : []
  const suppliedChoices = input.choices ?? []
  if (new Set(suppliedChoices.map(choice => choice.choiceId)).size !== suppliedChoices.length) {
    throw new SheetItemActionValidationError('Sheet item choices must be unique.')
  }
  for (const choice of presentedChoices) {
    const selected = suppliedChoices.find(value => value.choiceId === choice.choiceId)?.optionIds ?? []
    if (selected.length < choice.minimum || selected.length > choice.maximum
      || new Set(selected).size !== selected.length
      || selected.some(optionId => !choice.options.some(option => option.optionId === optionId))) {
      throw new SheetItemActionValidationError(`Sheet item choice ${choice.label} is incomplete or unavailable.`)
    }
  }
  if (suppliedChoices.some(choice => !presentedChoices.some(value => value.choiceId === choice.choiceId))) {
    throw new SheetItemActionValidationError('Sheet item command contains an unknown projected choice.')
  }
  return parseUseItemCommand({
    ...input.offer.itemCommand,
    operationId: input.operationId,
    offerId: input.offer.offerId,
    targetIds,
    choices: [
      ...(targeting ? [{ choiceId: targeting.requirementId, optionIds: targetIds }] : []),
      ...suppliedChoices.map(choice => ({ choiceId: choice.choiceId, optionIds: [...choice.optionIds] })),
    ],
  })
}
