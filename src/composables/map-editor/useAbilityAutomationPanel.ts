import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  ABILITY_CLIENT_COMMAND_SCHEMA_VERSION,
  parseAbilityClientDeclarationOffer,
  type AbilityClientDeclarationOffer,
  type BeginAbilityClientDeclarationCommand,
} from '#shared/abilityAutomation/clientCommands'
import type { AbilityClientCapabilityBundle, AbilityClientModeCapability } from '#shared/abilityAutomation/clientCapabilities'
import {
  ABILITY_DECLARATION_SCHEMA_VERSION,
  parseAbilityDeclarationIntent,
  type AbilityDeclarationIntent,
} from '#shared/abilityAutomation/declarationIntent'
import {
  parseAbilityResolutionPublicResult,
  type AbilityResolutionPublicResult,
} from '#shared/abilityAutomation/results'
import {
  abilityEntriesForPlacement,
  buildTokenAbilityMenuOptions,
  type TokenAbilityMenuOption,
  type TokenAbilityUseReference,
  type TokenSheetAbility,
} from '~/utils/mapTokenAbilities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { isPlainJsonObject } from '#shared/automation/strictJson'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>

export interface AbilityModeSelectionState {
  readonly placementId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly displayName: string
  readonly modes: readonly AbilityClientModeCapability[]
}
export interface AbilityDeclarationPanelState {
  readonly offer: AbilityClientDeclarationOffer
  readonly selectedOptionIds: Readonly<Record<string, readonly string[]>>
}
export type AbilityInvocationStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading-offer'; readonly requestId: string }
  | { readonly kind: 'selecting' }
  | { readonly kind: 'submitting'; readonly intentId: string }
  | { readonly kind: 'pending'; readonly result: AbilityResolutionPublicResult; readonly controllerPresentationKey?: string | null }
  | { readonly kind: 'accepted'; readonly result: AbilityResolutionPublicResult; readonly controllerPresentationKey?: string | null }
  | { readonly kind: 'uncertain'; readonly message: string; readonly intentId: string }
  | { readonly kind: 'error'; readonly message: string }

export interface UseAbilityAutomationPanelOptions {
  readonly map: Ref<TabletopMap | null>
  readonly spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  readonly pokemonBySlug: SheetMapRef<CharacterSheet>
  readonly trainerBySlug: SheetMapRef<TrainerSheet>
  readonly capabilities: Ref<AbilityClientCapabilityBundle>
  readonly canControlPlacement: (id: string) => boolean
  readonly beginDeclaration: (command: BeginAbilityClientDeclarationCommand) => MaybePromise<unknown>
  readonly resolveDeclaration: (intent: AbilityDeclarationIntent) => MaybePromise<unknown>
  readonly idFactory?: () => string
}

const defaultId = (): string => `ability:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const errorMessage = (error: unknown): string => error instanceof Error && error.message
  ? error.message
  : 'Ability command failed.'
const parseResolutionResponse = (value: unknown): {
  readonly result: AbilityResolutionPublicResult
  readonly controllerPresentationKey: string | null
} => {
  if (isPlainJsonObject(value) && value.schemaVersion === 1 && Object.prototype.hasOwnProperty.call(value, 'result')) {
    const key = value.controllerPresentationKey
    if (key !== null && typeof key !== 'string') throw new Error('Ability controller presentation is invalid.')
    return { result: parseAbilityResolutionPublicResult(value.result), controllerPresentationKey: key as string | null }
  }
  return { result: parseAbilityResolutionPublicResult(value), controllerPresentationKey: null }
}

/**
 * Native client boundary. It consumes only server-issued capabilities/offers,
 * submits stable IDs, and never executes ability mechanics or legacy mutations.
 */
export const useAbilityAutomationPanel = (options: UseAbilityAutomationPanelOptions) => {
  const activeModeSelection = ref<AbilityModeSelectionState | null>(null)
  const activeOffer = ref<AbilityClientDeclarationOffer | null>(null)
  const selectedOptionIds = ref<Readonly<Record<string, readonly string[]>>>({})
  const invocationStatus = ref<AbilityInvocationStatus>({ kind: 'idle' })
  const lastIntent = ref<AbilityDeclarationIntent | null>(null)
  const idFactory = options.idFactory ?? defaultId

  const sheetLookup = () => ({
    pokemon: options.pokemonBySlug.value,
    trainer: options.trainerBySlug.value,
  })
  const abilityEntriesForId = (id: string | null | undefined): TokenSheetAbility[] => {
    if (!options.map.value || !id) return []
    return abilityEntriesForPlacement(
      options.map.value.placements.find(item => item.id === id),
      sheetLookup(),
    )
  }
  const currentCapabilityPlacement = (id: string) => {
    const map = options.map.value
    const bundle = options.capabilities.value
    if (!map || bundle.mapSlug !== map.slug || bundle.mapRevision !== (map.revision ?? 0)) return null
    return bundle.placements.find(entry => entry.placementId === id) ?? null
  }
  const tokenAbilityOptionsById = computed(() => {
    const output: Record<string, TokenAbilityMenuOption[]> = {}
    if (!options.map.value) return output
    for (const token of options.spawnedPokemon.value) {
      output[token.id] = buildTokenAbilityMenuOptions(
        abilityEntriesForId(token.id),
        currentCapabilityPlacement(token.id)?.abilities ?? [],
      )
    }
    return output
  })
  const optionForUse = (placementId: string, reference: TokenAbilityUseReference): TokenAbilityMenuOption | null => (
    tokenAbilityOptionsById.value[placementId]?.find(option => (
      option.instanceId === reference.abilityInstanceId
      && option.canonicalId === reference.canonicalId
    )) ?? null
  )
  const clearSelection = (): void => {
    activeModeSelection.value = null
    activeOffer.value = null
    selectedOptionIds.value = {}
  }
  const selectedFor = (declarationId: string): readonly string[] => selectedOptionIds.value[declarationId] ?? []
  const selectionIsValid = (offer: AbilityClientDeclarationOffer): boolean => offer.declarations.every(declaration => {
    const selected = selectedFor(declaration.declarationId)
    const issued = new Set(declaration.options.map(option => option.optionId))
    return selected.length >= declaration.minSelections
      && selected.length <= declaration.maxSelections
      && new Set(selected).size === selected.length
      && selected.every(optionId => issued.has(optionId))
  })
  const abilityAutomationTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const offer = activeOffer.value
    if (!offer || !options.canControlPlacement(offer.actorPlacementId)) return null
    const unresolved = offer.declarations.filter(declaration => (
      declaration.kind === 'token'
      && selectedFor(declaration.declarationId).length < declaration.minSelections
    ))
    if (unresolved.length !== 1 || offer.declarations.some(declaration => (
      declaration.kind !== 'token'
      && selectedFor(declaration.declarationId).length < declaration.minSelections
    ))) return null
    const declaration = unresolved[0]!
    return {
      userId: offer.actorPlacementId,
      moveName: offer.canonicalId,
      rangeLabel: 'server-authorized targets',
      rangeMeters: Number.POSITIVE_INFINITY,
      candidateIds: declaration.options.flatMap(option => option.hint.kind === 'placement'
        ? [option.hint.placementId]
        : []),
    }
  })
  const abilityDeclarationPanel = computed<AbilityDeclarationPanelState | null>(() => activeOffer.value
    ? { offer: activeOffer.value, selectedOptionIds: selectedOptionIds.value }
    : null)

  const buildIntent = (offer: AbilityClientDeclarationOffer): AbilityDeclarationIntent => parseAbilityDeclarationIntent({
    schemaVersion: ABILITY_DECLARATION_SCHEMA_VERSION,
    intentId: idFactory(),
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug,
    baseRevision: offer.mapRevision,
    actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId,
    canonicalId: offer.canonicalId,
    modeId: offer.modeId,
    selections: offer.declarations.map(declaration => ({
      declarationId: declaration.declarationId,
      kind: declaration.kind,
      optionIds: [...selectedFor(declaration.declarationId)],
    })),
  })
  const submitIntent = async (intent: AbilityDeclarationIntent): Promise<boolean> => {
    lastIntent.value = intent
    invocationStatus.value = { kind: 'submitting', intentId: intent.intentId }
    try {
      const response = parseResolutionResponse(await options.resolveDeclaration(intent))
      invocationStatus.value = response.result.kind === 'pending'
        ? { kind: 'pending', result: response.result, controllerPresentationKey: response.controllerPresentationKey }
        : { kind: 'accepted', result: response.result, controllerPresentationKey: response.controllerPresentationKey }
      clearSelection()
      return true
    }
    catch (error) {
      invocationStatus.value = { kind: 'uncertain', message: errorMessage(error), intentId: intent.intentId }
      return false
    }
  }
  const submitAbilityDeclaration = async (): Promise<boolean> => {
    const offer = activeOffer.value
    if (!offer || !selectionIsValid(offer)) return false
    return submitIntent(buildIntent(offer))
  }
  const autoSelect = (offer: AbilityClientDeclarationOffer): Readonly<Record<string, readonly string[]>> => Object.freeze(
    Object.fromEntries(offer.declarations.map(declaration => {
      const options = declaration.options
      const ids = (declaration.kind === 'self' || declaration.kind === 'none')
        && declaration.minSelections === declaration.maxSelections
        && declaration.maxSelections === options.length
        ? options.map(option => option.optionId)
        : declaration.minSelections === 0
          ? []
          : declaration.kind === 'self' && options.length === 1 && declaration.minSelections === 1
            ? [options[0]!.optionId]
            : []
      return [declaration.declarationId, Object.freeze(ids)]
    })),
  )
  const beginMode = async (selection: AbilityModeSelectionState, mode: AbilityClientModeCapability): Promise<boolean> => {
    const map = options.map.value
    if (!map || !options.canControlPlacement(selection.placementId) || !mode.invocable) return false
    const capabilityRevision = options.capabilities.value.mapRevision
    if (capabilityRevision !== (map.revision ?? 0)) return false
    const request = {
      schemaVersion: ABILITY_CLIENT_COMMAND_SCHEMA_VERSION,
      requestId: idFactory(),
      mapSlug: map.slug,
      baseRevision: capabilityRevision,
      actorPlacementId: selection.placementId,
      abilityInstanceId: selection.abilityInstanceId,
      canonicalId: selection.canonicalId,
      modeId: mode.modeId,
    } satisfies BeginAbilityClientDeclarationCommand
    invocationStatus.value = { kind: 'loading-offer', requestId: request.requestId }
    try {
      const offer = parseAbilityClientDeclarationOffer(await options.beginDeclaration(request))
      if (offer.mapSlug !== request.mapSlug || offer.mapRevision !== request.baseRevision
        || offer.actorPlacementId !== request.actorPlacementId
        || offer.abilityInstanceId !== request.abilityInstanceId
        || offer.canonicalId !== request.canonicalId || offer.modeId !== request.modeId) {
        throw new Error('Ability declaration offer does not match the requested capability.')
      }
      activeModeSelection.value = null
      activeOffer.value = offer
      selectedOptionIds.value = autoSelect(offer)
      invocationStatus.value = { kind: 'selecting' }
      return selectionIsValid(offer) ? submitAbilityDeclaration() : true
    }
    catch (error) {
      clearSelection()
      invocationStatus.value = { kind: 'error', message: errorMessage(error) }
      return false
    }
  }
  const openAbilityAutomation = async (input: { id: string } & TokenAbilityUseReference): Promise<boolean> => {
    if (!options.canControlPlacement(input.id)) return false
    const option = optionForUse(input.id, input)
    const capability = option?.capability
    if (!option || !capability || capability.status !== 'ready') return false
    clearSelection()
    const modes = capability.modes.filter(mode => mode.invocable)
    if (modes.length === 0) return false
    const selection = {
      placementId: input.id,
      abilityInstanceId: capability.instanceId,
      canonicalId: capability.canonicalId,
      displayName: capability.displayName,
      modes,
    }
    if (modes.length > 1) {
      activeModeSelection.value = selection
      invocationStatus.value = { kind: 'selecting' }
      return true
    }
    return beginMode(selection, modes[0]!)
  }
  const selectAbilityMode = async (modeId: string): Promise<boolean> => {
    const selection = activeModeSelection.value
    const mode = selection?.modes.find(candidate => candidate.modeId === modeId)
    return selection && mode ? beginMode(selection, mode) : false
  }
  const selectAbilityDeclarationOption = (declarationId: string, optionId: string): boolean => {
    const offer = activeOffer.value
    const declaration = offer?.declarations.find(entry => entry.declarationId === declarationId)
    if (!declaration || !declaration.options.some(option => option.optionId === optionId)) return false
    const current = [...selectedFor(declarationId)]
    const index = current.indexOf(optionId)
    if (index >= 0) current.splice(index, 1)
    else {
      if (declaration.maxSelections === 1) current.splice(0, current.length, optionId)
      else if (current.length < declaration.maxSelections) current.push(optionId)
      else return false
    }
    selectedOptionIds.value = Object.freeze({ ...selectedOptionIds.value, [declarationId]: Object.freeze(current) })
    return true
  }
  const selectAbilityAutomationTarget = async (targetId: string): Promise<boolean> => {
    const overlay = abilityAutomationTargeting.value
    const offer = activeOffer.value
    if (!offer || !overlay?.candidateIds.includes(targetId)) return false
    const declaration = offer.declarations.find(entry => entry.kind === 'token'
      && entry.options.some(option => option.hint.kind === 'placement' && option.hint.placementId === targetId))
    const option = declaration?.options.find(entry => entry.hint.kind === 'placement' && entry.hint.placementId === targetId)
    if (!declaration || !option || !selectAbilityDeclarationOption(declaration.declarationId, option.optionId)) return false
    return selectionIsValid(offer) ? submitAbilityDeclaration() : true
  }
  const retryAbilityDeclaration = async (): Promise<boolean> => lastIntent.value
    ? submitIntent(lastIntent.value)
    : false
  const cancelAbilityAutomationTargeting = (): void => {
    clearSelection()
    invocationStatus.value = { kind: 'idle' }
  }

  return {
    abilityAutomationTargeting,
    abilityDeclarationPanel,
    activeAbilityModeSelection: computed(() => activeModeSelection.value),
    abilityInvocationStatus: computed(() => invocationStatus.value),
    tokenAbilityOptionsById,
    openAbilityAutomation,
    selectAbilityMode,
    selectAbilityDeclarationOption,
    submitAbilityDeclaration,
    retryAbilityDeclaration,
    cancelAbilityAutomationTargeting,
    selectAbilityAutomationTarget,
  }
}
