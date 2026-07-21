import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { deepFreezeStrictJson } from '#shared/automation/strictJson'
import {
  ABILITY_DECLARATION_SCHEMA_VERSION,
  parseAbilityDeclarationIntent,
  parseAbilityDeclarationOffer,
  type AbilityDeclarationIntent,
  type AbilityDeclarationOffer,
  type AbilityDeclarationOfferTargeting,
  type AbilityDeclarationOption,
} from '#shared/abilityAutomation/declarationIntent'
import type { AbilitySpecTargetingKind } from '#shared/abilityAutomation/spec'
import {
  parseAbilityClientDeclarationOffer,
  type AbilityClientDeclarationOffer,
  type AbilityClientOptionHint,
} from '#shared/abilityAutomation/clientCommands'
import type { AbilitySpecV1Runtime } from './registry'

export interface AbilityDeclarationOfferDraft {
  readonly offerId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly createdAt: number
  readonly expiresAt: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly modeId: string
  readonly declarations: readonly AbilityDeclarationOfferTargeting[]
}

export interface ResolvedAbilityDeclarationChoice {
  readonly declarationId: string
  readonly kind: AbilitySpecTargetingKind
  readonly options: readonly AbilityDeclarationOption[]
}

export interface ResolvedAbilityDeclarationIntent {
  readonly intent: AbilityDeclarationIntent
  readonly offer: AbilityDeclarationOffer
  readonly intentSha256: string
  readonly choices: readonly ResolvedAbilityDeclarationChoice[]
}

export interface AbilityDeclarationOfferControllerView {
  readonly schemaVersion: typeof ABILITY_DECLARATION_SCHEMA_VERSION
  readonly offerId: string
  readonly offerSha256: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly expiresAt: number
  readonly actorPlacementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly modeId: string
  readonly declarations: readonly {
    readonly id: string
    readonly kind: AbilitySpecTargetingKind
    readonly minSelections: number
    readonly maxSelections: number
    readonly options: readonly { readonly id: string; readonly presentationKey: string }[]
  }[]
}

export type AbilityDeclarationResolutionErrorCode =
  | 'runtime-mismatch'
  | 'targeting-mismatch'
  | 'offer-integrity-failed'
  | 'offer-expired'
  | 'stale-revision'
  | 'intent-mismatch'
  | 'invalid-selection'

export class AbilityDeclarationResolutionError extends Error {
  constructor(readonly code: AbilityDeclarationResolutionErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityDeclarationResolutionError'
  }
}

const fail = (code: AbilityDeclarationResolutionErrorCode, detail: string): never => {
  throw new AbilityDeclarationResolutionError(code, detail)
}
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value), 'utf8')
  .digest('hex')
const offerHashPayload = (offer: AbilityDeclarationOffer): Omit<AbilityDeclarationOffer, 'offerSha256'> => {
  const { offerSha256: _offerSha256, ...payload } = offer
  return payload
}
export const hashAbilityDeclarationOffer = (offer: AbilityDeclarationOffer): string => (
  sha256(offerHashPayload(offer))
)
export const hashAbilityDeclarationIntent = (intent: AbilityDeclarationIntent): string => sha256(intent)

const assertRuntimeTargeting = (input: {
  readonly offer: AbilityDeclarationOffer
  readonly runtime: AbilitySpecV1Runtime
}): void => {
  const { offer, runtime } = input
  if (offer.canonicalId !== runtime.canonicalId
    || offer.runtimeVersion !== runtime.version
    || offer.definitionHash !== runtime.definitionHash
    || !runtime.definition.spec.modes.some(mode => mode.id === offer.modeId)) {
    fail('runtime-mismatch', 'Declaration offer does not match the selected reviewed runtime.')
  }
  const targeting = runtime.definition.spec.targeting.filter(entry => entry.modeId === offer.modeId)
  if (targeting.length !== offer.declarations.length) {
    fail('targeting-mismatch', 'Declaration offer does not cover the selected mode targeting.')
  }
  for (let index = 0; index < targeting.length; index += 1) {
    const expected = targeting[index]!
    const actual = offer.declarations[index]!
    if (actual.id !== expected.id || actual.kind !== expected.kind
      || actual.minSelections !== expected.minSelections
      || actual.maxSelections !== expected.maxSelections) {
      fail('targeting-mismatch', 'Declaration offer changed reviewed targeting semantics or order.')
    }
    if (actual.kind === 'self' && actual.options.some(option => (
      option.value.kind !== 'self' || option.value.placementId !== offer.actorPlacementId
    ))) fail('targeting-mismatch', 'Self targeting options must resolve only to the actor.')
  }
}

export const createAbilityDeclarationOffer = (input: {
  readonly draft: AbilityDeclarationOfferDraft
  readonly runtime: AbilitySpecV1Runtime
}): AbilityDeclarationOffer => {
  const provisional = parseAbilityDeclarationOffer({
    schemaVersion: ABILITY_DECLARATION_SCHEMA_VERSION,
    ...input.draft,
    offerSha256: '0'.repeat(64),
    canonicalId: input.runtime.canonicalId,
    runtimeVersion: input.runtime.version,
    definitionHash: input.runtime.definitionHash,
  })
  assertRuntimeTargeting({ offer: provisional, runtime: input.runtime })
  return parseAbilityDeclarationOffer({
    ...provisional,
    offerSha256: hashAbilityDeclarationOffer(provisional),
  })
}

export const resolveAbilityDeclarationIntent = (input: {
  readonly intent: unknown
  readonly offer: unknown
  readonly runtime: AbilitySpecV1Runtime
  readonly currentMapRevision: number
  readonly now: number
}): ResolvedAbilityDeclarationIntent => {
  const intent = parseAbilityDeclarationIntent(input.intent)
  const offer = parseAbilityDeclarationOffer(input.offer)
  if (hashAbilityDeclarationOffer(offer) !== offer.offerSha256) {
    fail('offer-integrity-failed', 'Declaration offer hash does not match its private mechanics.')
  }
  assertRuntimeTargeting({ offer, runtime: input.runtime })
  if (!Number.isSafeInteger(input.now) || input.now < offer.createdAt || input.now > offer.expiresAt) {
    fail('offer-expired', 'Declaration offer is outside its authoritative lifetime.')
  }
  if (!Number.isSafeInteger(input.currentMapRevision)
    || offer.mapRevision !== input.currentMapRevision
    || intent.baseRevision !== input.currentMapRevision) {
    fail('stale-revision', 'Declaration targeting must be regenerated for the current map revision.')
  }
  if (intent.offerId !== offer.offerId || intent.offerSha256 !== offer.offerSha256
    || intent.mapSlug !== offer.mapSlug || intent.actorPlacementId !== offer.actorPlacementId
    || intent.abilityInstanceId !== offer.abilityInstanceId
    || intent.canonicalId !== offer.canonicalId || intent.modeId !== offer.modeId
    || intent.selections.length !== offer.declarations.length) {
    fail('intent-mismatch', 'Declaration intent does not match its server-issued offer.')
  }
  const choices: ResolvedAbilityDeclarationChoice[] = []
  for (let index = 0; index < offer.declarations.length; index += 1) {
    const declaration = offer.declarations[index]!
    const selection = intent.selections[index]!
    if (selection.declarationId !== declaration.id || selection.kind !== declaration.kind
      || selection.optionIds.length < declaration.minSelections
      || selection.optionIds.length > declaration.maxSelections) {
      fail('invalid-selection', 'Declaration selection does not match reviewed bounds or order.')
    }
    const byId = new Map(declaration.options.map(option => [option.id, option]))
    const options = selection.optionIds.map(optionId => (
      byId.get(optionId)
      ?? fail('invalid-selection', `Option ${optionId} was not issued by the authoritative offer.`)
    ))
    choices.push(Object.freeze({
      declarationId: declaration.id,
      kind: declaration.kind,
      options: Object.freeze(options),
    }))
  }
  return deepFreezeStrictJson({
    intent,
    offer,
    intentSha256: hashAbilityDeclarationIntent(intent),
    choices: Object.freeze(choices),
  }) as unknown as ResolvedAbilityDeclarationIntent
}

const clientHint = (option: AbilityDeclarationOption): AbilityClientOptionHint => {
  const value = option.value
  if (value.kind === 'none') return Object.freeze({ kind: 'none' })
  if (value.kind === 'self' || value.kind === 'token') {
    return Object.freeze({ kind: 'placement', placementId: value.placementId })
  }
  if (value.kind === 'side') return Object.freeze({ kind: 'side', sideId: value.sideId })
  if (value.kind === 'cell') return Object.freeze({ kind: 'cell', ...value.cell })
  if (value.kind === 'area') return Object.freeze({ kind: 'cell', ...value.cells[0]! })
  if (value.kind === 'field') return Object.freeze({ kind: 'field', valueId: value.fieldId })
  if (value.kind === 'direction') return Object.freeze({ kind: 'direction', valueId: value.directionId })
  if (value.kind === 'type') return Object.freeze({ kind: 'type', valueId: value.typeId })
  if (value.kind === 'stat') return Object.freeze({ kind: 'stat', valueId: value.statId })
  if (value.kind === 'move') return Object.freeze({ kind: 'move', valueId: option.id })
  if (value.kind === 'ability') return Object.freeze({
    kind: 'ability',
    valueId: `ability:${value.canonicalAbilityId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  })
  if (value.kind === 'item') return Object.freeze({ kind: 'item', valueId: value.itemId })
  if (value.kind === 'branch') return Object.freeze({ kind: 'branch', valueId: value.branchId })
  throw new AbilityDeclarationResolutionError('invalid-selection', 'Unsupported client option hint.')
}

/** Controller-authorized projection with safe visual hints but no private mechanic values. */
export const projectAbilityDeclarationOfferForClient = (
  offerValue: unknown,
): AbilityClientDeclarationOffer => {
  const offer = parseAbilityDeclarationOffer(offerValue)
  if (hashAbilityDeclarationOffer(offer) !== offer.offerSha256) {
    fail('offer-integrity-failed', 'Declaration offer hash does not match its private mechanics.')
  }
  return parseAbilityClientDeclarationOffer({
    schemaVersion: 1,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug,
    mapRevision: offer.mapRevision,
    expiresAt: offer.expiresAt,
    actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId,
    canonicalId: offer.canonicalId,
    modeId: offer.modeId,
    declarations: offer.declarations.map(declaration => ({
      declarationId: declaration.id,
      kind: declaration.kind,
      minSelections: declaration.minSelections,
      maxSelections: declaration.maxSelections,
      options: declaration.options.map(option => ({
        optionId: option.id,
        presentationKey: option.presentationKey,
        hint: clientHint(option),
      })),
    })),
  })
}

/** Controller-only projection; private option values never cross this boundary. */
export const projectAbilityDeclarationOfferForController = (
  offerValue: unknown,
): AbilityDeclarationOfferControllerView => {
  const offer = parseAbilityDeclarationOffer(offerValue)
  if (hashAbilityDeclarationOffer(offer) !== offer.offerSha256) {
    fail('offer-integrity-failed', 'Declaration offer hash does not match its private mechanics.')
  }
  return deepFreezeStrictJson({
    schemaVersion: ABILITY_DECLARATION_SCHEMA_VERSION,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug,
    mapRevision: offer.mapRevision,
    expiresAt: offer.expiresAt,
    actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId,
    canonicalId: offer.canonicalId,
    modeId: offer.modeId,
    declarations: offer.declarations.map(declaration => ({
      id: declaration.id,
      kind: declaration.kind,
      minSelections: declaration.minSelections,
      maxSelections: declaration.maxSelections,
      options: declaration.options.map(option => ({
        id: option.id,
        presentationKey: option.presentationKey,
      })),
    })),
  }) as AbilityDeclarationOfferControllerView
}
