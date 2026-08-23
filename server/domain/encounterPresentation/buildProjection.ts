import { createHash } from 'node:crypto'
import type { AuthRole } from '#shared/auth'
import type { AbilityClientCapability, AbilityClientCapabilityBundle } from '#shared/abilityAutomation/clientCapabilities'
import type {
  CapabilityClientCapabilityBundle,
  PlacementCapabilityClientBundle,
} from '#shared/capabilityAutomation/clientCapabilities'
import type { AbilitySpecTargetingKind } from '#shared/abilityAutomation/spec'
import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  encounterAvailabilityReason,
  encounterAvailable,
  encounterPresentationStableId,
  encounterUnavailable,
  parseEncounterPresentationProjection,
  type AcceptedEncounterPresentation,
  type EncounterActionOffer,
  type EncounterActionTiming,
  type EncounterAvailability,
  type EncounterAvailabilityReasonCode,
  type EncounterContextualAffordance,
  type EncounterContributionExplanation,
  type EncounterDerivedFactValue,
  type EncounterInteractionRole,
  type EncounterParticipantPresentationRef,
  type EncounterPassiveFact,
  type EncounterPassiveSummary,
  type EncounterPresentationCopy,
  type EncounterPresentationProjection,
  type EncounterProjectionAudience,
  type EncounterRuleSourceKind,
  type EncounterTargetingSummary,
  type EncounterUsageSummary,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import type { PlayerProfile } from '#shared/playerProfiles'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { parseGlueCannonState } from '#shared/itemAutomation/glueCannon'
import { equipmentActionPresentationsForItem } from '#shared/itemAutomation/equipmentActionPresentation'
import type { PendingMoveResponseWindowList } from '#shared/moveAutomation/responseViews'
import { toSlug, findAbility, findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap, SheetPlacement } from '~/types/map'
import type { TrainerSheet, InventoryEntry } from '~/types/trainerSheet'
import { buildAbilityClientCapabilityBundle } from '../abilityAutomation/clientCapabilities'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../abilityAutomation/registry'
import {
  actorControlledMapPlacementIds,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../../policies/playerProfileTokenControlPolicy'
import { moveEntriesForPlacement, buildTokenMoveUsageState } from '~/utils/mapTokenMoves'
import { maneuverOptionsForPlacement } from '~/utils/mapTokenManeuvers'
import { orderOptionsForPlacement } from '~/utils/mapTokenOrders'
import { moveAutomationSemanticStatusForMenu } from '~/utils/moveAutomationSemanticStatus'
import { moveConditionUseBlock } from '~/utils/moveConditionRestrictions'
import { buildCapabilityClientCapabilityBundle } from '../capabilityAutomation/clientCapabilities'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import { canonicalFeatureReference } from '#shared/featureAutomation/catalog'
import { resolveEffectiveFeatures } from '../featureAutomation/effectiveFeatures'
import {
  resolveCapabilityWeaponMoveGrants,
  resolveEquipmentWeaponAttackSources,
  resolveLivingWeaponAttackSources,
} from '../capabilityAutomation/weaponMoveGrants'
import type { ResolveEquipmentGrantsResult } from '../itemAutomation/equipmentGrants'
import { createEncounterEquipmentGrantQueries } from '../moveAutomation/equipmentGrantQueries'
import { capabilityWeaponMoveName } from '#shared/capabilityAutomation/weaponMoves'
import {
  applyEquipmentWeaponRangeToMoveRange,
  equipmentWeaponRangeLabel,
} from '#shared/itemAutomation/equipmentGrants'
import { placementToSpawned } from '~/utils/placement'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { mapMovementTerrainTagsForVoxel } from '~/utils/mapMovementTerrain'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import { pendingEncounterInteractionsFromMoveResponses } from './pendingAdapters'
import { resolveMoveAutomationLineOfSight } from '../moveAutomation/lineOfSight'
import { resolveEffectiveEdges } from '../edgeAutomation/effectiveEdges'
import { canonicalEdgeReference } from '#shared/edgeAutomation/catalog'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { projectEncounterItemOffers } from '../itemAutomation/encounterOffers'
import { projectEncounterItemFormChangeOffers } from '../itemAutomation/formChangeOffers'
import { activeReviewedItemFormChange } from '../itemAutomation/formChanges'
import {
  resolveShockCollarPairCandidates,
  shockCollarImplicitRemoteAuthority,
  shockCollarPairForInstance,
} from '../itemAutomation/shockCollar'
import {
  largeSnagMachineInventorySources,
  snagBallInventoryChoices,
} from '../itemAutomation/snagMachine'

export interface BuildEncounterPresentationProjectionInput {
  readonly role: AuthRole
  readonly audience?: EncounterProjectionAudience
  readonly playerProfile?: PlayerProfile | null
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  readonly generatedAt?: number
}

export interface BuildEncounterPresentationProjectionDependencies {
  readonly abilityCapabilities?: AbilityClientCapabilityBundle
  readonly capabilityCapabilities?: CapabilityClientCapabilityBundle
  readonly pendingMoveResponses?: PendingMoveResponseWindowList | null
  readonly acceptedPresentations?: readonly AcceptedEncounterPresentation[]
}

const sourcePath: Readonly<Partial<Record<EncounterRuleSourceKind, string>>> = Object.freeze({
  move: 'moves',
  maneuver: 'maneuvers',
  ability: 'abilities',
  capability: 'capabilities',
  edge: 'edges',
  feature: 'features',
  item: 'items',
})

/** Native actions owned by the replay-safe encounter equipment-action executor. */
const ENCOUNTER_EQUIPMENT_ACTION_IDS: ReadonlySet<string> = new Set([
  'equipment.light-shield.ready',
  'equipment.heavy-shield.ready',
  'equipment.shock-collar.activate',
  'equipment.glue-cannon.attack',
  'equipment.hand-net.attack',
  'equipment.weighted-nets.throw',
  'equipment.weighted-nets.pull',
  'equipment.fishing.old-rod',
  'equipment.fishing.good-rod',
  'equipment.fishing.super-rod',
  'equipment.snag-machine.convert',
])

const sourceRef = (input: {
  readonly kind: EncounterRuleSourceKind
  readonly canonicalId: string
  readonly displayName?: string
  readonly instanceId?: string | null
}): RuleSourceRef => {
  const path = sourcePath[input.kind]
  return {
    sourceKind: input.kind,
    canonicalId: input.canonicalId,
    instanceId: input.instanceId ?? null,
    displayName: input.displayName ?? input.canonicalId,
    referenceHref: path ? `/${path}/${toSlug(input.canonicalId)}` : null,
  }
}

const presentation = (
  label: string,
  options: {
    readonly description?: string | null
    readonly iconKey?: string | null
    readonly tone?: EncounterPresentationCopy['tone']
  } = {},
): EncounterPresentationCopy => ({
  label,
  description: options.description ?? null,
  iconKey: options.iconKey ?? null,
  tone: options.tone ?? 'neutral',
})

const PUBLIC_CAPABILITY_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  blended: 'Blended', glowing: 'Glowing', illusion: 'Maintaining an Illusion', inflated: 'Inflated',
  invisible: 'Invisible', intangible: 'Intangible', 'mega-evolved': 'Mega Evolved', crowned: 'Crowned Forme',
  'shadow-melded': 'Shadow Melded', shapechanged: 'Shapechanged', shrunken: 'Shrunken',
  'inside-machine': 'Inside a Machine', 'zygarde-form': 'Zygarde Forme',
  'as-one-mounted': 'Mounted as One', 'viral-fusion': 'Viral Fusion',
  'carrying-rider': 'Carrying Rider', 'mounted-rider': 'Mounted',
  'living-weapon': 'Engaged Living Weapon', 'living-weapon-wielder': 'Wielding Living Weapon',
  'shadow-rider': 'Riding a Shadow', 'shadow-host': 'Carrying a Shadow Rider',
})

const capabilityPresentationStatusLabels = (map: TabletopMap, placementId: string): readonly string[] => {
  const now = map.updatedAt ?? 0
  const rawLabels = (map.encounterState?.capabilityRuntime?.modes ?? []).flatMap(mode => (
    mode.actorPlacementId === placementId
      && (mode.expiresAt === null || mode.expiresAt > now)
      && PUBLIC_CAPABILITY_STATE_LABELS[mode.mode]
      ? [PUBLIC_CAPABILITY_STATE_LABELS[mode.mode]!] : []
  ))
  const rawLinkLabels = (map.encounterState?.capabilityRuntime?.links ?? []).flatMap((link): readonly string[] => {
    if (link.ownerPlacementId === placementId) {
      if (link.kind === 'as-one-mount') return ['Mounted as One']
      if (link.kind === 'viral-fusion') return ['Viral Fusion']
      if (link.kind === 'mount-rider') return ['Carrying Rider']
      if (link.kind === 'living-weapon') return ['Engaged Living Weapon']
      if (link.kind === 'shadow-rider') return ['Riding a Shadow']
    }
    if (link.participantPlacementIds.includes(placementId)) {
      if (link.kind === 'mount-rider') return ['Mounted']
      if (link.kind === 'living-weapon') return ['Wielding Living Weapon']
      if (link.kind === 'shadow-rider') return ['Carrying a Shadow Rider']
    }
    return []
  })
  const safeLabels = Array.isArray(map.metadata?.automationPresentationStates)
    ? map.metadata.automationPresentationStates.flatMap((raw): readonly string[] => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
        const state = raw as Record<string, unknown>
        return state.placementId === placementId
          && typeof state.state === 'string'
          && state.label === PUBLIC_CAPABILITY_STATE_LABELS[state.state]
          && (state.expiresAt === null || (typeof state.expiresAt === 'number' && state.expiresAt > now))
          ? [state.label as string] : []
      }) : []
  return [...new Set([...rawLabels, ...rawLinkLabels, ...safeLabels])]
}

const participantForPlacement = (
  placement: SheetPlacement,
  pokemonBySlug: ReadonlyMap<string, CharacterSheet>,
  trainerBySlug: ReadonlyMap<string, TrainerSheet>,
  map: TabletopMap,
): EncounterParticipantPresentationRef => {
  const pokemon = placement.sheetKind === 'pokemon' ? pokemonBySlug.get(placement.sheetSlug) : null
  const trainer = placement.sheetKind === 'trainer' ? trainerBySlug.get(placement.sheetSlug) : null
  const side = placement.sideId ? map.encounterState?.sides[placement.sideId] : null
  const activeItemForm = pokemon ? (() => {
    try {
      return activeReviewedItemFormChange({ map, placementId: placement.id, pokemonSheet: pokemon })?.form.displayName ?? null
    }
    catch { return null }
  })() : null
  return {
    participantId: placement.id,
    displayName: pokemon?.nickname?.trim() || pokemon?.species?.trim() || trainer?.name?.trim() || 'Participant',
    portraitUrl: trainer?.portraitUrl?.startsWith('/') ? trainer.portraitUrl : null,
    sideId: placement.sideId ?? null,
    sideLabel: side?.label ?? null,
    sideAccent: side?.color && /^#[0-9a-fA-F]{6}$/.test(side.color) ? side.color : null,
    sheetKind: placement.sheetKind,
    statusLabels: [...new Set([
      ...(placement.sheetKind === 'pokemon'
        ? pokemon?.combat?.conditions ?? []
        : trainer?.conditions ?? []),
      ...capabilityPresentationStatusLabels(map, placement.id),
      ...(activeItemForm ? [activeItemForm] : []),
    ].map(label => label.trim()).filter(Boolean))].slice(0, 32),
  }
}

const currentParticipantIdentity = (
  participant: EncounterParticipantPresentationRef | null,
  participants: ReadonlyMap<string, EncounterParticipantPresentationRef>,
): EncounterParticipantPresentationRef | null => {
  if (!participant) return null
  const current = participants.get(participant.participantId)
  if (!current) return participant
  return {
    ...current,
    // Keep the accepted fact's historical state labels while adopting the
    // role-projected current identity for this stable participant.
    statusLabels: participant.statusLabels,
  }
}

const currentAcceptedParticipantIdentities = (
  accepted: AcceptedEncounterPresentation,
  participants: ReadonlyMap<string, EncounterParticipantPresentationRef>,
): AcceptedEncounterPresentation => ({
  ...accepted,
  actor: currentParticipantIdentity(accepted.actor, participants),
  affectedParticipants: accepted.affectedParticipants.map(participant => (
    currentParticipantIdentity(participant, participants) ?? participant
  )),
})

const timingFromText = (value: string | null | undefined): EncounterActionTiming => {
  const normalized = value?.trim() ?? ''
  const lower = normalized.toLowerCase()
  if (lower.includes('interrupt')) return { kind: 'interrupt', label: normalized || 'Interrupt', triggerLabel: null, priority: 0 }
  if (lower.includes('reaction')) return { kind: 'reaction', label: normalized || 'Reaction', triggerLabel: null, priority: 0 }
  if (lower.includes('priority')) return { kind: 'priority', label: normalized || 'Priority', triggerLabel: null, priority: 0 }
  if (lower.includes('full action')) return { kind: 'full', label: normalized || 'Full Action', triggerLabel: null, priority: null }
  if (lower.includes('extended')) return { kind: 'extended', label: normalized || 'Extended Action', triggerLabel: null, priority: null }
  if (lower.includes('shift')) return { kind: 'shift', label: normalized || 'Shift Action', triggerLabel: null, priority: null }
  if (lower.includes('swift')) return { kind: 'swift', label: normalized || 'Swift Action', triggerLabel: null, priority: null }
  if (lower.includes('free')) return { kind: 'free', label: normalized || 'Free Action', triggerLabel: null, priority: null }
  return { kind: 'standard', label: normalized || 'Standard Action', triggerLabel: null, priority: null }
}

const actionCosts = (timing: EncounterActionTiming): EncounterActionOffer['costs'] => {
  if (timing.kind === 'standard') return [{ kind: 'standard-action', resourceId: null, amount: 1, label: '1 Standard Action' }]
  if (timing.kind === 'shift') return [{ kind: 'shift-action', resourceId: null, amount: 1, label: '1 Shift Action' }]
  if (timing.kind === 'swift') return [{ kind: 'swift-action', resourceId: null, amount: 1, label: '1 Swift Action' }]
  if (timing.kind === 'full') return [{ kind: 'full-action', resourceId: null, amount: 1, label: '1 Full Action' }]
  return []
}

const targetingFromRange = (range: string | null | undefined): EncounterTargetingSummary[] => {
  const value = range?.trim() ?? ''
  const lower = value.toLowerCase()
  if (!value || lower === 'self') return [{
    requirementId: 'target',
    kind: lower === 'self' ? 'self' : 'none',
    minSelections: 0,
    maxSelections: lower === 'self' ? 1 : 0,
    rangeLabel: value || null,
    relationshipLabel: null,
    requiresLineOfSight: false,
    requiresSpatialInput: false,
  }]
  const kind: EncounterTargetingSummary['kind'] = lower.includes('line')
    || lower.includes('cone')
    || lower.includes('burst')
    || lower.includes('blast')
    ? 'area'
    : lower.includes('cardinal') || lower.includes('direction')
      ? 'direction'
      : 'participant'
  return [{
    requirementId: 'target',
    kind,
    minSelections: kind === 'participant' ? 1 : 0,
    maxSelections: kind === 'participant' ? 32 : 1,
    rangeLabel: value,
    relationshipLabel: null,
    requiresLineOfSight: /ranged|\d+m/i.test(value),
    requiresSpatialInput: kind === 'area' || kind === 'direction',
  }]
}

const emptyUsage = (frequencyLabel: string | null = null): EncounterUsageSummary => ({
  frequencyLabel,
  remaining: null,
  maximum: null,
  cooldownLabel: null,
  resetLabel: null,
})

const availabilityFromCodes = (
  codes: readonly EncounterAvailabilityReasonCode[],
): EncounterAvailability => codes.length === 0
  ? encounterAvailable()
  : encounterUnavailable(...[...new Set(codes)].map(code => encounterAvailabilityReason(code)))

const actionEconomyReason = (
  map: TabletopMap,
  placementId: string,
  timing: EncounterActionTiming,
): EncounterAvailabilityReasonCode | null => {
  const ledger = map.encounterState?.turnResources[placementId]
  if (!ledger) return null
  if (timing.kind === 'reaction' || timing.kind === 'interrupt') {
    return ledger.reaction.available ? null : 'timing.reaction-window-closed'
  }
  const actionType = timing.kind === 'priority' ? 'standard' : timing.kind
  if (!['standard', 'shift', 'swift', 'free', 'full'].includes(actionType)) return null
  const resource = ledger.actions[actionType as keyof typeof ledger.actions]
  if (!resource || resource.budget === null || resource.spent < resource.budget) return null
  if (actionType === 'standard') return 'economy.standard-spent'
  if (actionType === 'shift') return 'economy.shift-spent'
  if (actionType === 'swift') return 'economy.swift-spent'
  if (actionType === 'full') return 'economy.full-action-unavailable'
  return null
}

const makeOffer = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly source: RuleSourceRef
  readonly role?: EncounterInteractionRole
  readonly roles?: readonly EncounterInteractionRole[]
  readonly group: EncounterActionOffer['group']
  readonly groupOrder: number
  readonly offerOrder: number
  readonly timing: EncounterActionTiming
  readonly targeting?: readonly EncounterTargetingSummary[]
  readonly usage?: EncounterUsageSummary
  readonly availability?: EncounterAvailability
  readonly copy?: EncounterPresentationCopy
  readonly actionId: string
  readonly intentInput?: EncounterActionOffer['intent']['input']
  readonly offerId?: string
  readonly selectionOptions?: EncounterActionOffer['selectionOptions']
  readonly sourceContextLabel?: string | null
}): EncounterActionOffer => {
  const targeting = input.targeting ?? []
  const economyReason = actionEconomyReason(input.map, input.actor.participantId, input.timing)
  const availability = economyReason
    ? availabilityFromCodes([
        ...((input.availability?.reasons ?? []).map(reason => reason.code)),
        economyReason,
      ])
    : input.availability ?? encounterAvailable()
  const hasSpatial = targeting.some(target => target.requiresSpatialInput)
  return {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    offerId: input.offerId ?? encounterPresentationStableId(
      'offer', input.map.slug, String(input.mapRevision), input.actor.participantId,
      input.source.sourceKind, input.source.canonicalId, input.source.instanceId ?? 'base', input.actionId,
      String(input.groupOrder), String(input.offerOrder),
    ),
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    actor: input.actor,
    source: input.source,
    roles: input.roles ?? [input.role ?? 'activated-action'],
    group: input.group,
    groupOrder: input.groupOrder,
    offerOrder: input.offerOrder,
    timing: input.timing,
    costs: actionCosts(input.timing),
    targeting,
    usage: input.usage ?? emptyUsage(),
    availability,
    presentation: input.copy ?? presentation(input.source.displayName),
    intent: {
      actionId: input.actionId,
      input: hasSpatial ? 'spatial' : input.intentInput ?? (targeting.some(target => target.kind !== 'none' && target.kind !== 'self') ? 'choices' : 'immediate'),
    },
    selectionOptions: input.selectionOptions ?? [],
    sourceContextLabel: input.sourceContextLabel ?? null,
  }
}

const moveUsage = (
  placementId: string,
  moveName: string,
  frequency: string | null,
  map: TabletopMap,
  sheet: CharacterSheet | TrainerSheet,
): { readonly summary: EncounterUsageSummary; readonly unavailable: EncounterAvailabilityReasonCode | null } => {
  const state = buildTokenMoveUsageState(placementId, moveName, frequency, {
    mapMoveUsage: map.moveUsage,
    sheetMoveUsage: sheet.moveUsage,
    activeScene: map.activeScene,
    currentRound: map.initiative?.round,
  })
  if (!state) return { summary: emptyUsage(frequency), unavailable: null }
  const summary: EncounterUsageSummary = {
    frequencyLabel: state.label,
    remaining: state.remainingUses ?? state.sceneRemainingUses ?? null,
    maximum: state.maxUses ?? state.sceneMaxUses ?? null,
    cooldownLabel: state.available ? null : state.title,
    resetLabel: state.frequencyKind === 'daily' ? 'Extended Rest' : state.frequencyKind === 'scene' ? 'Next Scene' : 'Eligible round',
  }
  if (state.available) return { summary, unavailable: null }
  if (state.frequencyKind === 'daily') return { summary, unavailable: 'usage.daily-exhausted' }
  if (state.frequencyKind === 'scene') return { summary, unavailable: 'usage.scene-exhausted' }
  return { summary, unavailable: 'usage.cooldown-active' }
}

const moveOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly placement: SheetPlacement
  readonly actor: EncounterParticipantPresentationRef
  readonly sheet: CharacterSheet | TrainerSheet
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly equipmentGrants: ResolveEquipmentGrantsResult | null
}): EncounterActionOffer[] => {
  const sheets = {
    pokemon: new Map(input.pokemonBySlug),
    trainer: new Map(input.trainerBySlug),
  }
  const tokenForPlacement = (placementId: string) => {
    const placement = input.map.placements.find(candidate => candidate.id === placementId)
    return placement ? placementToSpawned(placement, sheets, input.map) : null
  }
  const token = tokenForPlacement(input.placement.id)
  const weaponInput = token ? {
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
    token,
    pokemonSheets: sheets.pokemon,
    trainerSheets: sheets.trainer,
    tokenForPlacement,
    ...(input.equipmentGrants ? { equipmentGrants: input.equipmentGrants } : {}),
  } : null
  const weaponGrants = weaponInput ? resolveCapabilityWeaponMoveGrants(weaponInput) : []
  const equipmentWeaponSources = weaponInput ? resolveEquipmentWeaponAttackSources(weaponInput) : []
  const livingWeaponSources = weaponInput ? resolveLivingWeaponAttackSources(weaponInput) : []
  const encounterEffects = input.map.encounterState?.effects ?? []
  const baseEntries = moveEntriesForPlacement(input.placement, sheets, { encounterEffects })
  const baseStruggleEntries = baseEntries.filter(entry => isStruggleAttackMoveName(entry.move.name))
  const sourcedStruggleEntries = [
    ...equipmentWeaponSources.flatMap(source => baseStruggleEntries.map(entry => ({
      ...entry,
      attackSourceId: source.attackSourceId,
      attackSourceLabel: source.attackSourceLabel,
    }))),
    ...livingWeaponSources.flatMap(source => source.actorIsWielder
      ? baseStruggleEntries.map(entry => ({
          ...entry,
          attackSourceId: source.attackSourceId,
          attackSourceLabel: source.attackSourceLabel,
        }))
      : []),
  ]
  return moveEntriesForPlacement(input.placement, sheets, {
    encounterEffects,
    additionalMoveEntries: [
      ...weaponGrants.map(grant => grant.entry),
      ...sourcedStruggleEntries,
    ],
  }).map((entry, index) => {
  const reference = findMove(entry.move.name)
  const name = reference?.name ?? entry.move.name
  const frequency = reference?.frequency ?? entry.move.frequency ?? null
  const baseRange = reference?.range ?? entry.move.range ?? null
  const damageClass = reference?.damage_class ?? entry.move.category ?? null
  const semantic = moveAutomationSemanticStatusForMenu(name)
  const usage = moveUsage(input.placement.id, name, frequency, input.map, input.sheet)
  const conditions = input.placement.sheetKind === 'pokemon'
    ? (input.sheet as CharacterSheet).combat?.conditions
    : (input.sheet as TrainerSheet).conditions
  const conditionBlock = moveConditionUseBlock({ name, damageClass, range: baseRange, frequency }, conditions)
  const unavailable: EncounterAvailabilityReasonCode[] = [
    ...(semantic.baseStatus === 'blocked' && !capabilityWeaponMoveName(name) ? ['action.unsupported' as const] : []),
    ...(entry.moveListProjection?.available === false ? ['source.suppressed' as const] : []),
    ...(conditionBlock ? ['condition.disabled' as const] : []),
    ...(usage.unavailable ? [usage.unavailable] : []),
  ]
  const timing = timingFromText(frequency)
  const weaponGrant = weaponGrants.find(grant => (
    grant.canonicalId === capabilityWeaponMoveName(name)
    && grant.attackSourceId === (entry.attackSourceId ?? null)
  ))
  const equipmentWeaponSource = equipmentWeaponSources.find(source => (
    source.attackSourceId === (entry.attackSourceId ?? null)
  ))
  const range = equipmentWeaponSource?.profile.targetingPolicy === 'ranged-line-of-sight'
    ? applyEquipmentWeaponRangeToMoveRange(equipmentWeaponSource.profile, baseRange ?? 'Melee, 1 Target')
    : baseRange
  const hasReach = weaponGrant?.grantsReach === true
    || equipmentWeaponSource?.profile.grantsReach === true
    || resolveEffectiveCapabilities({
    map: input.map, placement: input.placement, sheet: input.sheet, sheets,
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Reach')
  const reachMeters = token && /^(?:large|huge|gigantic)$/i.test(token.size ?? '') ? 3 : 2
  const targeting = targetingFromRange(range).map(summary => hasReach && /\bmelee\b/i.test(range ?? '')
    ? { ...summary, rangeLabel: `${reachMeters} meters (Reach)` } : summary)
  return makeOffer({
    map: input.map,
    mapRevision: input.mapRevision,
    actor: input.actor,
    source: sourceRef({
      kind: 'move',
      canonicalId: name,
      displayName: entry.attackSourceLabel ? `${name} (${entry.attackSourceLabel})` : name,
      instanceId: entry.attackSourceId ?? null,
    }),
    group: damageClass === 'Status' ? 'support' : 'attack',
    groupOrder: damageClass === 'Status' ? 20 : 10,
    offerOrder: index,
    timing,
    targeting,
    usage: usage.summary,
    availability: availabilityFromCodes(unavailable),
    copy: presentation(entry.attackSourceLabel ? `${name} · ${entry.attackSourceLabel}` : name, {
      description: [reference?.type ?? entry.move.type, damageClass, range].filter(Boolean).join(' · ') || null,
      iconKey: `source.move`,
    }),
    actionId: 'move.declare',
  })
  })
}

const abilityReasonCode = (capability: AbilityClientCapability): EncounterAvailabilityReasonCode[] => {
  if (capability.status === 'ready' || capability.status === 'passive') return []
  if (capability.status === 'suppressed') return ['source.suppressed']
  if (capability.status === 'parameters-required') return ['action.parameters-required']
  if (capability.status === 'runtime-drift') return ['action.runtime-drift']
  return ['action.unsupported']
}

const abilityTargeting = (
  capability: AbilityClientCapability,
  modeId: string,
): EncounterTargetingSummary[] => capability.modes
  .find(mode => mode.modeId === modeId)?.targeting
  .flatMap((target): EncounterTargetingSummary[] => {
    const mapped: Partial<Record<AbilitySpecTargetingKind, EncounterTargetingSummary['kind']>> = {
      none: 'none',
      self: 'self',
      token: 'participant',
      side: 'side',
      area: 'area',
      cell: 'cell',
      direction: 'direction',
      move: 'move',
      item: 'item',
    }
    const kind = mapped[target.kind]
    if (!kind) return []
    return [{
      requirementId: target.id,
      kind,
      minSelections: target.kind === 'self' || target.kind === 'none' ? 0 : target.minSelections,
      maxSelections: target.kind === 'none' ? 0 : target.maxSelections,
      rangeLabel: null,
      relationshipLabel: null,
      requiresLineOfSight: false,
      requiresSpatialInput: ['area', 'cell', 'direction'].includes(kind),
    }]
  }) ?? []

const abilityOffersAndPassives = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly capabilities: AbilityClientCapabilityBundle
}): { readonly offers: EncounterActionOffer[]; readonly passives: EncounterPassiveSummary[] } => {
  const offers: EncounterActionOffer[] = []
  const passives: EncounterPassiveSummary[] = []
  for (const placementCapabilities of input.capabilities.placements) {
    const actor = input.participants.get(placementCapabilities.placementId)
    if (!actor) continue
    for (const [abilityIndex, ability] of placementCapabilities.abilities.entries()) {
      const source = sourceRef({
        kind: 'ability',
        canonicalId: ability.canonicalId,
        displayName: ability.displayName,
        instanceId: ability.instanceId,
      })
      const reference = findAbility(ability.canonicalId)
      const passiveModes = ability.modes.filter(mode => mode.kind === 'static' || mode.kind === 'triggered')
      if (passiveModes.length > 0 || ability.status === 'passive') {
        const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(ability.canonicalId)
        const hasOptionalTrigger = passiveModes.some(mode => runtime?.definition.spec.subscriptions.some(subscription => (
          subscription.modeId === mode.modeId && subscription.response === 'optional'
        )))
        const hasAutomaticTrigger = passiveModes.some(mode => mode.kind === 'triggered') && !hasOptionalTrigger
        const roles: EncounterInteractionRole[] = [
          ...(passiveModes.some(mode => mode.kind === 'static') || ability.status === 'passive'
            ? ['passive-provider' as const]
            : []),
          ...(hasOptionalTrigger ? ['triggered-optional' as const] : []),
          ...(hasAutomaticTrigger ? ['triggered-automatic' as const] : []),
        ]
        passives.push({
          schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
          summaryId: encounterPresentationStableId('passive', input.map.slug, actor.participantId, 'ability', ability.instanceId),
          participant: actor,
          source,
          roles: roles.length > 0 ? [...new Set(roles)] : ['passive-provider'],
          active: ability.effective && ability.status !== 'blocked' && ability.status !== 'runtime-drift',
          facts: [],
          presentation: presentation(ability.displayName, {
            description: reference?.frequency ?? 'Passive Ability',
            iconKey: 'source.ability',
          }),
          explanation: null,
        })
      }
      for (const [modeIndex, mode] of ability.modes.entries()) {
        if (mode.kind !== 'activated' && mode.kind !== 'configuration') continue
        const targeting = abilityTargeting(ability, mode.modeId)
        const hasUnprojectedChoices = mode.targeting.length > targeting.length
        offers.push(makeOffer({
          map: input.map,
          mapRevision: input.mapRevision,
          actor,
          source,
          roles: mode.kind === 'configuration'
            ? ['activated-action', 'choice-only']
            : ['activated-action'],
          group: 'support',
          groupOrder: 30,
          offerOrder: abilityIndex * 10 + modeIndex,
          timing: timingFromText(reference?.frequency),
          targeting,
          usage: emptyUsage(reference?.frequency ?? null),
          availability: availabilityFromCodes(abilityReasonCode(ability)),
          copy: presentation(ability.displayName, {
            description: reference?.frequency ?? null,
            iconKey: 'source.ability',
          }),
          actionId: `ability.declare:${mode.modeId}`,
          intentInput: hasUnprojectedChoices ? 'choices' : undefined,
        }))
      }
    }
  }
  return { offers, passives }
}

const maneuverOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly placement: SheetPlacement
  readonly actor: EncounterParticipantPresentationRef
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
}): EncounterActionOffer[] => maneuverOptionsForPlacement(input.placement, {
  trainer: new Map(input.trainerBySlug),
}).map((maneuver, index) => makeOffer({
  map: input.map,
  mapRevision: input.mapRevision,
  actor: input.actor,
  source: sourceRef({ kind: 'maneuver', canonicalId: maneuver.name }),
  group: maneuver.trigger ? 'reaction' : 'support',
  groupOrder: 40,
  offerOrder: index,
  timing: timingFromText(maneuver.action ?? maneuver.trigger),
  targeting: targetingFromRange(maneuver.range),
  usage: emptyUsage(maneuver.action),
  copy: presentation(maneuver.name, {
    description: [maneuver.action, maneuver.range].filter(Boolean).join(' · ') || null,
    iconKey: 'source.maneuver',
  }),
  actionId: 'maneuver.declare',
}))

const orderOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly placement: SheetPlacement
  readonly actor: EncounterParticipantPresentationRef
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
}): EncounterActionOffer[] => orderOptionsForPlacement(input.placement, {
  trainer: new Map(input.trainerBySlug),
}).map((order, index) => makeOffer({
  map: input.map,
  mapRevision: input.mapRevision,
  actor: input.actor,
  source: sourceRef({ kind: 'order', canonicalId: order.name }),
  group: 'support',
  groupOrder: 50,
  offerOrder: index,
  timing: timingFromText(order.frequency ?? order.trigger),
  targeting: [{
    requirementId: 'target',
    kind: 'participant',
    minSelections: 1,
    maxSelections: 1,
    rangeLabel: order.target,
    relationshipLabel: 'Eligible allied Pokémon',
    requiresLineOfSight: false,
    requiresSpatialInput: false,
  }],
  usage: emptyUsage(order.frequency),
  copy: presentation(order.name, {
    description: [order.frequency, order.target].filter(Boolean).join(' · ') || null,
    iconKey: 'source.order',
  }),
  actionId: 'order.declare',
}))

const numberFact = (value: number, unit: string | null = null): EncounterDerivedFactValue => ({
  kind: 'number',
  numberValue: value,
  textValue: null,
  booleanValue: null,
  unit,
})
const textFact = (value: string): EncounterDerivedFactValue => ({
  kind: 'text',
  numberValue: null,
  textValue: value,
  booleanValue: null,
  unit: null,
})
const booleanFact = (value: boolean): EncounterDerivedFactValue => ({
  kind: 'boolean',
  numberValue: null,
  textValue: null,
  booleanValue: value,
  unit: null,
})

const passiveSummary = (input: {
  readonly map: TabletopMap
  readonly participant: EncounterParticipantPresentationRef
  readonly source: RuleSourceRef
  readonly roles?: readonly EncounterInteractionRole[]
  readonly active?: boolean
  readonly facts?: readonly EncounterPassiveFact[]
  readonly description?: string | null
  readonly explanation?: EncounterContributionExplanation | null
}): EncounterPassiveSummary => ({
  schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  summaryId: encounterPresentationStableId(
    'passive', input.map.slug, input.participant.participantId,
    input.source.sourceKind, input.source.canonicalId, input.source.instanceId ?? 'base',
  ),
  participant: input.participant,
  source: input.source,
  roles: input.roles ?? ['passive-provider'],
  active: input.active ?? true,
  facts: input.facts ?? [],
  presentation: presentation(input.source.displayName, {
    description: input.description ?? null,
    iconKey: `source.${input.source.sourceKind}`,
  }),
  explanation: input.explanation ?? null,
})

const capabilityParameterFact = (
  parameters: PlacementCapabilityClientBundle['facts'][number]['parameters'],
): EncounterDerivedFactValue | null => {
  if (parameters.kind === 'none') return null
  if (parameters.kind === 'value') return numberFact(parameters.value)
  if (parameters.kind === 'jump') return textFact(`${parameters.long}/${parameters.high}`)
  if (parameters.kind === 'rider-capacity') return numberFact(parameters.riders)
  if (parameters.kind === 'categories') return textFact(parameters.categories.join(', '))
  if (parameters.kind === 'qualifiers') return textFact(parameters.qualifiers.join(', '))
  return textFact(parameters.terrains.join(', '))
}

const capabilityTargeting = (
  contextPredicateId: string,
): readonly EncounterTargetingSummary[] => {
  const context = contextPredicateId.slice(contextPredicateId.lastIndexOf('.') + 1)
  if (context === 'electronic-device' || context === 'inside-machine') return [{
    requirementId: 'capability-device-cell', kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: context === 'electronic-device', requiresSpatialInput: true,
  }]
  if (context === 'unsynchronized-keystone-and-2tp') return [{
    requirementId: 'capability-keystone-resource', kind: 'item', minSelections: 1, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  if (context === 'synchronized-keystone') return [{
    requirementId: 'capability-keystone-destination', kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: '10 meters', relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }]
  if (context === 'jump-destination-cell' || context === 'teleport-destination-cell' || context === 'alluring-lure-cell') return [{
    requirementId: `capability-${context}`,
    kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null,
    requiresLineOfSight: context === 'teleport-destination-cell', requiresSpatialInput: true,
  }]
  if (context === 'linked-rider-and-adjacent-cell') return [{
    requirementId: 'capability-linked-rider', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: null, relationshipLabel: 'Current rider', requiresLineOfSight: false, requiresSpatialInput: false,
  }, {
    requirementId: 'capability-adjacent-release-cell', kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Adjacent', relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }]
  if (context === 'visible-cell' || context === 'moving-illusion' || context === 'adjacent-release-cell') return [{
    requirementId: `capability-${context}`, kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: context === 'adjacent-release-cell' ? 'Adjacent' : null,
    relationshipLabel: null,
    requiresLineOfSight: context !== 'adjacent-release-cell', requiresSpatialInput: true,
  }]
  if (context === 'open-space') return [{
    requirementId: 'capability-summon-cell', kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }]
  if (context === 'plant-or-planted-berry') return [{
    requirementId: 'capability-sprouter-plant-cell', kind: 'cell', minSelections: 0, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }, {
    requirementId: 'capability-sprouter-berry', kind: 'item', minSelections: 0, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  if (context === 'object-in-8m' || context === 'iron-or-steel-object') return [{
    requirementId: 'capability-object-destination', kind: 'cell', minSelections: 1, maxSelections: 1,
    rangeLabel: context === 'object-in-8m' ? '8 meters' : null,
    relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }]
  if (context === 'zygarde-cube-and-cells' || context === 'disassemblable-zygarde'
    || context === 'power-construct-zygarde' || context === 'zygarde-cube-and-tp') return [{
    requirementId: 'capability-zygarde-resource', kind: 'item', minSelections: 0, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  if (context === 'close-examination-target') return [{
    requirementId: 'capability-close-examiner', kind: 'participant', minSelections: 1, maxSelections: 1,
    rangeLabel: 'Adjacent', relationshipLabel: 'Examiner', requiresLineOfSight: true, requiresSpatialInput: false,
  }]
  if (context === 'anchor-or-target-in-4m') return [{
    requirementId: 'capability-threaded-anchor', kind: 'cell', minSelections: 0, maxSelections: 1,
    rangeLabel: '4 meters', relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: true,
  }, {
    requirementId: 'capability-threaded-target', kind: 'participant', minSelections: 0, maxSelections: 1,
    rangeLabel: '4 meters', relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  if (/cell|terrain|anchor|visible-cell/.test(context)) return [{
    requirementId: 'capability-spatial-context', kind: 'area', minSelections: 1, maxSelections: 32,
    rangeLabel: context.includes('4m') ? '4 meters' : null, relationshipLabel: null,
    requiresLineOfSight: context.includes('visible'), requiresSpatialInput: true,
  }]
  if (context === 'adjacent-living-shadow' || /target|mount|rider|wielder|mind|unown|zygarde/.test(context)) return [{
    requirementId: 'capability-target', kind: 'participant', minSelections: 1, maxSelections: 16,
    rangeLabel: context.includes('adjacent') ? 'Adjacent' : null, relationshipLabel: null,
    requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  if (/item|berry|jar|weapon|seed|cube/.test(context)) return [{
    requirementId: 'capability-item', kind: 'item', minSelections: 0, maxSelections: 1,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
  return [{
    requirementId: 'capability-context', kind: 'none', minSelections: 0, maxSelections: 0,
    rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false,
  }]
}

const boundedCapabilityDescription = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? ''
  if (!normalized) return null
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 499).trimEnd()}…`
}

const equipmentGrantTargeting = (
  kind: 'self' | 'participant' | 'item' | 'move' | 'cell',
): readonly EncounterTargetingSummary[] => [{
  requirementId: `equipment-${kind}`,
  kind,
  minSelections: kind === 'self' ? 0 : 1,
  maxSelections: 1,
  rangeLabel: null,
  relationshipLabel: kind === 'self' ? 'Self' : null,
  requiresLineOfSight: false,
  requiresSpatialInput: kind === 'cell',
}]

const equipmentGrantLabel = (
  grant: ResolveEquipmentGrantsResult['active'][number]['grant'],
): string => {
  if (grant.kind === 'weapon-profile') return `${grant.weaponClass.split('-').join(' ')} weapon`
  if (grant.kind === 'move') return `${grant.canonicalId} (${grant.minimumCombatRank === 4 ? 'Adept' : 'Master'} Combat)`
  if (grant.kind === 'capability') return grant.parameterLabel ?? grant.canonicalId
  if (grant.kind === 'ability') return `${grant.canonicalId} Ability`
  return grant.label
}

const equipmentGrantPresentation = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participant: EncounterParticipantPresentationRef
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly grantsForPlacement: (placementId: string) => ResolveEquipmentGrantsResult | null
  readonly resolved: ResolveEquipmentGrantsResult
  readonly offerOrderBase: number
}): {
  readonly offers: readonly EncounterActionOffer[]
  readonly passives: readonly EncounterPassiveSummary[]
  readonly affordances: readonly EncounterContextualAffordance[]
} => {
  const equipmentState = parseSheetEquipmentStateForOwner(input.sheet.equipmentState, {
    kind: input.placement.sheetKind,
    slug: input.placement.sheetSlug,
  })
  const sheetLookup = {
    pokemon: new Map(input.pokemonBySlug),
    trainer: new Map(input.trainerBySlug),
  }
  const actorToken = placementToSpawned(input.placement, sheetLookup, input.map)
  const lineOfSightPlacements = input.map.placements.flatMap((placement) => {
    const token = placementToSpawned(placement, sheetLookup, input.map)
    return token ? [{
      id: placement.id,
      position: placement.position,
      base: token.base,
      clearance: token.clearance,
    }] : []
  })
  const targetGeometryReason = (
    target: SheetPlacement,
    maximumRangeMeters: number,
    requiresLineOfSight: boolean,
  ): EncounterAvailabilityReasonCode | null => {
    const targetToken = placementToSpawned(target, sheetLookup, input.map)
    if (!actorToken || !targetToken) return 'target.invalid'
    if (tokenGridDistance(actorToken, targetToken) > maximumRangeMeters) return 'target.out-of-range'
    if (!requiresLineOfSight) return null
    const sight = resolveMoveAutomationLineOfSight({
      voxels: input.map.voxels,
      placements: lineOfSightPlacements,
      sourcePlacementId: input.placement.id,
      targetPlacementId: target.id,
    })
    return sight.targetable ? null : 'target.not-visible'
  }
  const grouped = new Map<string, ResolveEquipmentGrantsResult['active'][number][]>()
  for (const entry of input.resolved.active) {
    const current = grouped.get(entry.instanceId) ?? []
    current.push(entry)
    grouped.set(entry.instanceId, current)
  }
  const groups = [...grouped.values()].sort((left, right) => (
    left[0]!.canonicalItemId.localeCompare(right[0]!.canonicalItemId)
      || left[0]!.instanceId.localeCompare(right[0]!.instanceId)
  ))
  const offers: EncounterActionOffer[] = []
  const passives: EncounterPassiveSummary[] = []
  const affordances: EncounterContextualAffordance[] = []
  for (const [sourceIndex, entries] of groups.entries()) {
    const canonicalItemId = entries[0]!.canonicalItemId
    // Projection-local ordinal references are intentionally unrelated to serialized identity.
    const projectedSourceId = `equipment-source:${input.participant.participantId}:${sourceIndex + 1}`
    const source = sourceRef({
      kind: 'item',
      canonicalId: canonicalItemId,
      displayName: canonicalItemId,
      instanceId: projectedSourceId,
    })
    const nativeWeaponProfile = entries.some(entry => (
      entry.grant.kind === 'weapon-profile' && entry.grant.executionStatus === 'native'
    ))
    const facts = entries.flatMap((entry, entryIndex): EncounterPassiveFact[] => {
      const base: EncounterPassiveFact = {
        factId: encounterPresentationStableId(
          'fact', input.participant.participantId, projectedSourceId, entry.grant.grantId, String(entryIndex),
        ),
        factKey: encounterPresentationStableId('equipment-grant', entry.grant.grantId),
        value: booleanFact(
          entry.grant.kind === 'weapon-profile'
            ? entry.grant.executionStatus === 'native'
            : entry.grant.kind === 'move'
              ? entry.grant.executionStatus === 'native' && nativeWeaponProfile
              : true,
        ),
        label: equipmentGrantLabel(entry.grant),
      }
      if (entry.grant.kind === 'action' && entry.grant.actionId === 'equipment.glue-cannon.attack') {
        const instance = equipmentState.instances.find(candidate => candidate.instanceId === entry.instanceId)
        let charges: number | null = null
        try { charges = instance ? parseGlueCannonState(instance.serializedState).charges : null }
        catch { charges = null }
        return [base, {
          factId: encounterPresentationStableId(
            'fact', input.participant.participantId, projectedSourceId, entry.grant.grantId, 'charges',
          ),
          factKey: encounterPresentationStableId('equipment-grant-charges', entry.grant.grantId),
          value: charges === null ? textFact('Unavailable') : numberFact(charges, 'charges'),
          label: charges === null ? 'Charge state unavailable' : `${charges} charge${charges === 1 ? '' : 's'} remaining`,
        }]
      }
      if (entry.grant.kind !== 'weapon-profile' || entry.grant.executionStatus !== 'native') return [base]
      return [base, {
        factId: encounterPresentationStableId(
          'fact', input.participant.participantId, projectedSourceId, entry.grant.grantId, 'range',
        ),
        factKey: encounterPresentationStableId('equipment-grant-range', entry.grant.grantId),
        value: textFact(equipmentWeaponRangeLabel(entry.grant)),
        label: 'Weapon range',
      }, {
        factId: encounterPresentationStableId(
          'fact', input.participant.participantId, projectedSourceId, entry.grant.grantId, 'hands',
        ),
        factKey: encounterPresentationStableId('equipment-grant-hands', entry.grant.grantId),
        value: numberFact(entry.grant.handsRequired, 'hands'),
        label: 'Ready hands',
      }, {
        factId: encounterPresentationStableId(
          'fact', input.participant.participantId, projectedSourceId, entry.grant.grantId, 'ammunition',
        ),
        factKey: encounterPresentationStableId('equipment-grant-ammunition', entry.grant.grantId),
        value: textFact('Abstracted; no tracked consumption'),
        label: 'Ammunition',
      }]
    })
    passives.push(passiveSummary({
      map: input.map,
      participant: input.participant,
      source,
      facts,
      description: `Current reviewed rule source: ${facts.map(fact => fact.label).join(', ')}`,
    }))
    for (const [grantIndex, entry] of entries.entries()) {
      const grant = entry.grant
      const moveUnavailable = grant.kind === 'move'
        && (grant.executionStatus === 'definition-missing' || !nativeWeaponProfile)
      const profileUnavailable = grant.kind === 'weapon-profile'
        && grant.executionStatus === 'definition-missing'
      if (grant.kind === 'action' && grant.executionStatus === 'native'
        && !ENCOUNTER_EQUIPMENT_ACTION_IDS.has(grant.actionId)) continue
      let nativeAction = grant.kind === 'action' && grant.executionStatus === 'native'
      let nativeUnavailableCode: EncounterAvailabilityReasonCode | null = null
      let nativeUnavailableDescription: string | null = null
      let selectionOptions: EncounterActionOffer['selectionOptions'] = []
      let shockTargets: ReturnType<typeof resolveShockCollarPairCandidates> = []
      if (grant.kind === 'action' && grant.actionId === 'equipment.shock-collar.activate') {
        const pair = shockCollarPairForInstance({
          placement: input.placement,
          sheet: input.sheet,
          instanceId: entry.instanceId,
        })
        if (pair?.role !== 'remote') continue
        shockTargets = resolveShockCollarPairCandidates({
          map: input.map,
          actorPlacement: input.placement,
          actorSheet: input.sheet,
          remoteSource: entry,
          pokemonSheets: input.pokemonBySlug,
          trainerSheets: input.trainerBySlug,
          grantsForPlacement: input.grantsForPlacement,
        })
        selectionOptions = shockTargets.flatMap((candidate) => {
          const participant = input.participants.get(candidate.placement.id)
          const token = placementToSpawned(candidate.placement, sheetLookup, input.map)
          const groundBlocked = token?.creatureRules?.typeIds.some(type => (
            type.toLocaleLowerCase('en-US') === 'ground'
          )) === true && !candidate.pair.groundCapable
          const unavailableReason = groundBlocked ? encounterAvailabilityReason('target.invalid') : null
          return participant ? [{
            kind: 'participant' as const,
            requirementId: 'equipment-shock-collar-target',
            value: candidate.placement.id,
            label: participant.displayName,
            description: groundBlocked
              ? 'Ground-type wearer requires the Ground-capable collar variant'
              : 'Paired wearer',
            disabled: unavailableReason !== null,
            unavailableReason,
          }] : []
        })
        nativeAction = nativeAction && selectionOptions.some(option => !option.disabled)
        if (!nativeAction) {
          nativeUnavailableCode = selectionOptions.find(option => option.disabled)?.unavailableReason?.code ?? 'target.invalid'
          nativeUnavailableDescription = selectionOptions.find(option => option.disabled)?.description
            ?? 'No paired wearer is currently eligible.'
        }
      }
      if (grant.kind === 'action' && grant.actionId === 'equipment.glue-cannon.attack') {
        const instance = equipmentState.instances.find(candidate => candidate.instanceId === entry.instanceId)
        let chargeReady = false
        try { chargeReady = Boolean(instance && parseGlueCannonState(instance.serializedState).charges > 0) }
        catch { chargeReady = false }
        selectionOptions = input.map.placements.flatMap((candidate) => {
          const participant = input.participants.get(candidate.id)
          if (!participant || candidate.id === input.placement.id) return []
          const reasonCode = targetGeometryReason(candidate, 4, true)
          const unavailableReason = reasonCode ? encounterAvailabilityReason(reasonCode) : null
          return [{
            kind: 'participant' as const,
            requirementId: 'equipment-participant',
            value: candidate.id,
            label: participant.displayName,
            description: unavailableReason
              ? `${unavailableReason.label}; requires 4 meters and line of sight`
              : 'Participant within 4 meters and line of sight',
            disabled: unavailableReason !== null,
            unavailableReason,
          }]
        })
        nativeAction = nativeAction && chargeReady && selectionOptions.some(option => !option.disabled)
        if (!nativeAction) {
          nativeUnavailableCode = chargeReady
            ? selectionOptions.find(option => option.disabled)?.unavailableReason?.code ?? 'target.invalid'
            : 'source.item-unavailable'
          nativeUnavailableDescription = chargeReady
            ? selectionOptions.find(option => option.disabled)?.description ?? 'No target is currently within 4 meters and line of sight.'
            : 'No Glue Cannon charge packet remains.'
        }
      }
      if (grant.kind === 'action' && grant.actionId === 'equipment.hand-net.attack') {
        selectionOptions = input.map.placements.flatMap((candidate) => {
          if (candidate.sheetKind !== 'pokemon' || candidate.id === input.placement.id) return []
          const token = placementToSpawned(candidate, sheetLookup, input.map)
          const participant = input.participants.get(candidate.id)
          if (!participant) return []
          const reasonCode: EncounterAvailabilityReasonCode | null = token?.creatureRules?.size !== 'small'
            ? 'target.invalid'
            : targetGeometryReason(candidate, 1, true)
          const unavailableReason = reasonCode ? encounterAvailabilityReason(reasonCode) : null
          return [{
            kind: 'participant' as const,
            requirementId: 'equipment-hand-net-target',
            value: candidate.id,
            label: participant.displayName,
            description: token?.creatureRules?.size !== 'small'
              ? 'Unavailable; Hand Net requires a Small Pokémon'
              : unavailableReason
                ? `${unavailableReason.label}; requires adjacency and line of sight`
                : 'Small Pokémon within 1 meter and line of sight',
            disabled: unavailableReason !== null,
            unavailableReason,
          }]
        })
        nativeAction = nativeAction && selectionOptions.some(option => !option.disabled)
        if (!nativeAction) {
          nativeUnavailableCode = selectionOptions.find(option => option.disabled)?.unavailableReason?.code ?? 'target.invalid'
          nativeUnavailableDescription = selectionOptions.find(option => option.disabled)?.description
            ?? 'No Small Pokémon is currently adjacent and visible.'
        }
      }
      if (grant.kind === 'action' && (grant.actionId === 'equipment.weighted-nets.throw'
        || grant.actionId === 'equipment.weighted-nets.pull')) {
        const sourceKey = createHash('sha256').update(entry.instanceId).digest('hex').slice(0, 32)
        const sourceTag = `equipment.weighted-net.source:${sourceKey}`
        const nettedTargetIds = new Set((input.map.encounterState?.effects ?? []).flatMap(effect => (
          effect.kind === 'capability'
          && effect.payload.capabilityId === 'equipment.restraint.netted'
          && effect.tags.includes('equipment.weighted-net')
          && effect.tags.includes(sourceTag)
          && effect.suppression.sources.length === 0
          && (effect.duration.remaining === null || effect.duration.remaining > 0)
            ? effect.affected.placementIds : []
        )))
        if (grant.actionId === 'equipment.weighted-nets.throw') {
          selectionOptions = input.map.placements.flatMap((candidate) => {
            const participant = input.participants.get(candidate.id)
            if (candidate.sheetKind !== 'pokemon' || candidate.id === input.placement.id || !participant) return []
            const reasonCode = targetGeometryReason(candidate, 4, true)
            const unavailableReason = reasonCode ? encounterAvailabilityReason(reasonCode) : null
            return [{
              kind: 'participant' as const,
              requirementId: 'equipment-weighted-net-target',
              value: candidate.id,
              label: participant.displayName,
              description: unavailableReason
                ? `${unavailableReason.label}; requires 4 meters and line of sight`
                : 'Pokémon within 4 meters and line of sight',
              disabled: unavailableReason !== null,
              unavailableReason,
            }]
          })
          nativeAction = nativeAction && nettedTargetIds.size === 0
            && selectionOptions.some(option => !option.disabled)
          if (!nativeAction) {
            nativeUnavailableCode = nettedTargetIds.size > 0
              ? 'source.item-unavailable'
              : selectionOptions.find(option => option.disabled)?.unavailableReason?.code ?? 'target.invalid'
            nativeUnavailableDescription = nettedTargetIds.size > 0
              ? 'This exact Weighted Net is already deployed.'
              : selectionOptions.find(option => option.disabled)?.description
                ?? 'No Pokémon is currently within 4 meters and line of sight.'
          }
        }
        else {
          selectionOptions = [...nettedTargetIds].flatMap((placementId) => {
            const participant = input.participants.get(placementId)
            return participant ? [{
              kind: 'participant' as const,
              requirementId: 'equipment-weighted-net-pull-target',
              value: placementId,
              label: participant.displayName,
              description: 'Netted by this exact source',
            }] : []
          })
          nativeAction = nativeAction && selectionOptions.length > 0
          if (!nativeAction) {
            nativeUnavailableCode = 'target.invalid'
            nativeUnavailableDescription = 'This exact Weighted Net has no active netted target.'
          }
        }
      }
      if (grant.kind === 'action' && grant.actionId === 'equipment.snag-machine.convert') {
        const trainer = input.placement.sheetKind === 'trainer' ? input.sheet as TrainerSheet : null
        const choices = trainer ? snagBallInventoryChoices(trainer) : []
        selectionOptions = choices.map(choice => ({
          kind: 'object' as const,
          requirementId: 'equipment-item',
          value: choice.publicOptionId,
          label: choice.option.name,
          description: `${choice.availableUnconvertedUnits} unreserved unit${choice.availableUnconvertedUnits === 1 ? '' : 's'} available`,
        }))
        nativeAction = nativeAction && (selectionOptions?.length ?? 0) > 0
        if (!nativeAction) {
          nativeUnavailableCode = 'source.item-unavailable'
          nativeUnavailableDescription = 'No unreserved reviewed Poké Ball unit is available.'
        }
      }
      if (grant.kind === 'action' && (grant.actionId === 'equipment.fishing.old-rod'
        || grant.actionId === 'equipment.fishing.good-rod'
        || grant.actionId === 'equipment.fishing.super-rod')) {
        const token = placementToSpawned(input.placement, {
          pokemon: new Map(input.pokemonBySlug),
          trainer: new Map(input.trainerBySlug),
        }, input.map)
        const footprint = token ? gridFootprintCells(input.placement.position, token) : []
        const adjacentWater = input.map.voxels.filter(voxel => (
          mapMovementTerrainTagsForVoxel(voxel).has('water')
          && footprint.some(origin => ptuGridVectorDistance({
            x: voxel.x - origin.x,
            y: voxel.y - origin.y,
            z: voxel.z - origin.z,
          }) === 1)
        )).sort((left, right) => left.x - right.x || left.y - right.y || left.z - right.z)
        selectionOptions = adjacentWater.map(voxel => ({
          kind: 'cell' as const,
          requirementId: 'equipment-cell',
          value: `cell:${voxel.x}:${voxel.y}:${voxel.z}`,
          label: `Water cell ${voxel.x}, ${voxel.y}, ${voxel.z}`,
          description: 'Adjacent authoritative water terrain',
        }))
        nativeAction = nativeAction && adjacentWater.length > 0
        if (!nativeAction) {
          nativeUnavailableCode = 'target.invalid'
          nativeUnavailableDescription = 'No adjacent authoritative water cell is present.'
        }
      }
      if (grant.kind !== 'action' && !moveUnavailable && !profileUnavailable) continue
      const unavailableDiagnostic = grant.kind === 'move'
        ? grant.executionStatus === 'definition-missing'
          ? `${grant.canonicalId} has no reviewed executable Move definition.`
          : `${grant.canonicalId} has no reviewed executable weapon profile.`
        : grant.kind === 'weapon-profile'
          ? `${canonicalItemId} has no reviewed executable ${grant.weaponClass.split('-').join(' ')} attack profile.`
          : `${grant.label} has no reviewed executable action definition yet.`
      const actionId = grant.kind === 'move'
        ? `equipment.move:${grant.grantId}`
        : grant.kind === 'weapon-profile'
          ? `equipment.weapon:${grant.grantId}`
          : grant.actionId
      const targeting = grant.kind === 'action'
        ? grant.actionId === 'equipment.shock-collar.activate'
          ? [{
              requirementId: 'equipment-shock-collar-target',
              kind: 'participant' as const,
              minSelections: 1,
              maxSelections: 1,
              rangeLabel: 'Paired remote',
              relationshipLabel: 'Paired wearer',
              requiresLineOfSight: false,
              requiresSpatialInput: false,
            }]
          : grant.actionId === 'equipment.glue-cannon.attack'
            ? [{
                requirementId: 'equipment-participant',
                kind: 'participant' as const,
                minSelections: 1,
                maxSelections: 1,
                rangeLabel: 'Within 4 meters',
                relationshipLabel: 'Participant',
                requiresLineOfSight: true,
                requiresSpatialInput: false,
              }]
            : grant.actionId === 'equipment.hand-net.attack'
              ? [{
                  requirementId: 'equipment-hand-net-target',
                  kind: 'participant' as const,
                  minSelections: 1,
                  maxSelections: 1,
                  rangeLabel: 'Melee, 1 meter',
                  relationshipLabel: 'Small Pokémon',
                  requiresLineOfSight: true,
                  requiresSpatialInput: false,
                }]
              : grant.actionId === 'equipment.weighted-nets.throw'
                ? [{
                    requirementId: 'equipment-weighted-net-target',
                    kind: 'participant' as const,
                    minSelections: 1,
                    maxSelections: 1,
                    rangeLabel: 'Within 4 meters',
                    relationshipLabel: 'Pokémon',
                    requiresLineOfSight: true,
                    requiresSpatialInput: false,
                  }]
                : grant.actionId === 'equipment.weighted-nets.pull'
                  ? [{
                      requirementId: 'equipment-weighted-net-pull-target',
                      kind: 'participant' as const,
                      minSelections: 1,
                      maxSelections: 1,
                      rangeLabel: '1 meter toward wielder',
                      relationshipLabel: 'Netted by this source',
                      requiresLineOfSight: false,
                      requiresSpatialInput: false,
                    }]
                  : grant.actionId === 'equipment.fishing.old-rod'
                    || grant.actionId === 'equipment.fishing.good-rod'
                    || grant.actionId === 'equipment.fishing.super-rod'
                    ? [{
                        requirementId: 'equipment-cell',
                        kind: 'cell' as const,
                        minSelections: 1,
                        maxSelections: 1,
                        rangeLabel: 'Adjacent water cell',
                        relationshipLabel: 'Water',
                        requiresLineOfSight: false,
                        requiresSpatialInput: true,
                      }]
                    : equipmentGrantTargeting(grant.targetKind)
        : equipmentGrantTargeting('participant')
      const timing = grant.kind === 'action'
        ? timingFromText(`${grant.timing} action`)
        : timingFromText('standard action')
      const group: EncounterActionOffer['group'] = grant.kind === 'move' || grant.kind === 'weapon-profile' ? 'attack'
        : grant.targetKind === 'item' ? 'inventory'
          : grant.targetKind === 'cell' ? 'field' : 'support'
      const offer = makeOffer({
        map: input.map,
        mapRevision: input.mapRevision,
        actor: input.participant,
        source,
        roles: grant.kind === 'action'
          ? [grant.interactionRole]
          : ['activated-action'],
        group,
        groupOrder: grant.kind === 'move' || grant.kind === 'weapon-profile' ? 10 : 42,
        offerOrder: input.offerOrderBase + sourceIndex * 20 + grantIndex,
        timing,
        targeting,
        availability: nativeAction
          ? encounterAvailable()
          : encounterUnavailable(encounterAvailabilityReason(
              nativeUnavailableCode ?? 'action.unsupported',
              { sources: [source] },
            )),
        copy: presentation(
          grant.kind === 'move' ? grant.canonicalId
            : grant.kind === 'weapon-profile' ? `Use ${canonicalItemId} as a weapon` : grant.label,
          {
          description: nativeAction
            ? grant.kind === 'action'
              ? equipmentActionPresentationsForItem(canonicalItemId)
                  .find(action => action.actionId === grant.actionId)?.summary
                ?? `Authoritative ${timing.label.toLowerCase()} from exact equipped custody.`
              : `Authoritative ${timing.label.toLowerCase()} from exact equipped custody.`
            : nativeUnavailableDescription ?? unavailableDiagnostic,
          iconKey: 'source.item',
          tone: nativeAction ? 'neutral' : 'warning',
          },
        ),
        actionId,
        selectionOptions,
        sourceContextLabel: grant.kind === 'action' ? `${canonicalItemId} · equipped custody` : null,
      })
      offers.push(offer)
      if (grant.kind === 'action' && grant.interactionRole === 'contextual-affordance') {
        affordances.push({
          schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
          affordanceId: encounterPresentationStableId(
            'affordance', input.map.slug, input.participant.participantId, projectedSourceId, grant.grantId,
          ),
          contextKind: grant.targetKind === 'cell' ? 'terrain'
            : grant.targetKind === 'item' ? 'inventory'
              : grant.targetKind === 'self' || grant.targetKind === 'participant' ? 'participant' : 'encounter',
          contextId: grant.targetKind === 'self' ? input.participant.participantId : grant.actionId,
          source,
          actor: input.participant,
          linkedOfferId: offer.offerId,
          availability: offer.availability,
          presentation: offer.presentation,
        })
      }
    }
  }
  return { offers, passives, affordances }
}

const equipmentRestraintPassives = (input: {
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
}): readonly EncounterPassiveSummary[] => Object.freeze((input.map.encounterState?.effects ?? []).flatMap((effect, index): EncounterPassiveSummary[] => {
  if (effect.kind !== 'capability'
    || effect.payload.capabilityId !== 'equipment.restraint.netted'
    || !effect.tags.includes('netted')
    || effect.suppression.sources.length > 0
    || (effect.duration.remaining !== null && effect.duration.remaining <= 0)) return []
  const targetId = effect.affected.placementIds[0]
  const participant = targetId ? input.participants.get(targetId) : null
  const hand = effect.tags.includes('equipment.hand-net')
  const weighted = effect.tags.includes('equipment.weighted-net')
  if (!participant || (!hand && !weighted)) return []
  const canonicalId = hand ? 'Hand Net' : 'Weighted Nets'
  const projectedSourceId = encounterPresentationStableId(
    'equipment-restraint', input.map.slug, targetId!, canonicalId, String(index),
  )
  const source = sourceRef({ kind: 'item', canonicalId, displayName: canonicalId, instanceId: projectedSourceId })
  const facts: EncounterPassiveFact[] = [{
    factId: encounterPresentationStableId('fact', projectedSourceId, 'netted'),
    factKey: 'equipment-restraint.netted',
    value: booleanFact(true),
    label: 'Netted',
  }, {
    factId: encounterPresentationStableId('fact', projectedSourceId, 'capture'),
    factKey: 'equipment-restraint.capture-modifier',
    value: numberFact(-20, 'capture roll'),
    label: 'Capture rolls −20',
  }, ...(hand ? [{
    factId: encounterPresentationStableId('fact', projectedSourceId, 'trapped'),
    factKey: 'equipment-restraint.trapped',
    value: booleanFact(true),
    label: 'Trapped; moves with the net wielder',
  }] : [{
    factId: encounterPresentationStableId('fact', projectedSourceId, 'slowed'),
    factKey: 'equipment-restraint.slowed',
    value: booleanFact(true),
    label: 'Slowed',
  }, {
    factId: encounterPresentationStableId('fact', projectedSourceId, 'airborne'),
    factKey: 'equipment-restraint.airborne-suppressed',
    value: booleanFact(true),
    label: 'Sky and Levitate suppressed',
  }])]
  return [passiveSummary({
    map: input.map,
    participant,
    source,
    facts,
    description: hand
      ? 'Attack the net and record damage against its configured durability to break free; source release, breakage, or removal clears the full restraint.'
      : 'Attack the net and record damage against its configured durability to break free; source release, breakage, or removal clears Slowed, movement suppression, and the capture modifier together.',
  })]
}))

const shockCollarImplicitRemoteOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly controlledIds: ReadonlySet<string>
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly pokemonBySlug: ReadonlyMap<string, CharacterSheet>
  readonly trainerBySlug: ReadonlyMap<string, TrainerSheet>
  readonly grantsForPlacement: (placementId: string) => ResolveEquipmentGrantsResult | null
}): readonly EncounterActionOffer[] => Object.freeze(input.map.placements.flatMap((target, index): EncounterActionOffer[] => {
  const targetSheet = target.sheetKind === 'pokemon'
    ? input.pokemonBySlug.get(target.sheetSlug)
    : input.trainerBySlug.get(target.sheetSlug)
  if (!targetSheet) return []
  const collarSource = input.grantsForPlacement(target.id)?.active.find(entry => (
    entry.canonicalItemId === 'Shock Collar'
    && entry.grant.kind === 'action'
    && entry.grant.actionId === 'equipment.shock-collar.activate'
    && entry.grant.executionStatus === 'native'
  ))
  if (!collarSource) return []
  const authority = shockCollarImplicitRemoteAuthority({
    placement: target,
    sheet: targetSheet,
    collarSource,
  })
  if (!authority) return []
  const actorPlacement = input.map.placements.find(placement => (
    placement.sheetKind === 'trainer'
    && placement.sheetSlug === authority.holderTrainerSlug
    && input.controlledIds.has(placement.id)
  ))
  const actor = actorPlacement ? input.participants.get(actorPlacement.id) : null
  const wearer = input.participants.get(target.id)
  if (!actorPlacement || !actor || !wearer) return []
  const token = placementToSpawned(target, {
    pokemon: new Map(input.pokemonBySlug),
    trainer: new Map(input.trainerBySlug),
  }, input.map)
  const groundBlocked = token?.creatureRules?.typeIds.includes('ground') === true
    && !authority.groundCapable
  const projectedSourceId = encounterPresentationStableId(
    'equipment-shock-collar-set', input.map.slug, actorPlacement.id, target.id, String(index),
  )
  const source = sourceRef({
    kind: 'item', canonicalId: 'Shock Collar', displayName: 'Shock Collar', instanceId: projectedSourceId,
  })
  return [makeOffer({
    map: input.map,
    mapRevision: input.mapRevision,
    actor,
    source,
    roles: ['activated-action', 'choice-only'],
    group: 'support',
    groupOrder: 42,
    offerOrder: 1_720 + index,
    timing: timingFromText('standard action'),
    targeting: [{
      requirementId: 'equipment-shock-collar-target',
      kind: 'participant',
      minSelections: 1,
      maxSelections: 1,
      rangeLabel: 'Paired remote',
      relationshipLabel: 'Paired wearer',
      requiresLineOfSight: false,
      requiresSpatialInput: false,
    }],
    availability: groundBlocked
      ? encounterUnavailable(encounterAvailabilityReason('target.invalid', { sources: [source] }))
      : encounterAvailable(),
    copy: presentation('Activate Shock Collar', {
      description: groundBlocked
        ? 'This Ground-type wearer requires the Ground-capable collar variant.'
        : 'Authoritative Standard Action from exact paired remote custody.',
      iconKey: 'source.item',
      tone: groundBlocked ? 'warning' : 'neutral',
    }),
    actionId: 'equipment.shock-collar.activate',
    offerId: encounterPresentationStableId(
      'offer', input.map.slug, String(input.mapRevision), actorPlacement.id, target.id,
      'equipment.shock-collar.activate',
    ),
    selectionOptions: [{
      kind: 'participant',
      requirementId: 'equipment-shock-collar-target',
      value: target.id,
      label: wearer.displayName,
      description: 'Paired wearer',
    }],
  })]
}))

const capabilityPresentation = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participant: EncounterParticipantPresentationRef
  readonly capabilityBundle: PlacementCapabilityClientBundle
}): { readonly offers: readonly EncounterActionOffer[]; readonly passives: readonly EncounterPassiveSummary[] } => {
  const passives = input.capabilityBundle.facts.map((fact) => {
    const source = sourceRef({
      kind: 'capability', canonicalId: fact.canonicalId,
      displayName: fact.displayName, instanceId: fact.instanceId,
    })
    const value = fact.value !== null
      ? numberFact(fact.value)
      : capabilityParameterFact(fact.parameters) ?? booleanFact(true)
    const facts: EncounterPassiveFact[] = [{
      factId: encounterPresentationStableId('fact', input.participant.participantId, 'capability', fact.instanceId, 'effective'),
      factKey: encounterPresentationStableId('capability', fact.canonicalId, 'effective'),
      value,
      label: fact.displayName,
    }, ...fact.semanticTags.slice(0, 24).map((tag): EncounterPassiveFact => ({
      factId: encounterPresentationStableId('fact', input.participant.participantId, 'capability', fact.instanceId, tag),
      factKey: encounterPresentationStableId('capability-semantic', fact.canonicalId, tag),
      value: booleanFact(true),
      label: tag.split('-').join(' '),
    }))]
    return passiveSummary({
      map: input.map,
      participant: input.participant,
      source,
      active: fact.active,
      facts,
      description: boundedCapabilityDescription(fact.contextualSummary
        ? `${fact.contextualSummary} — ${fact.sourceEffect}`
        : fact.sourceEffect),
      explanation: {
        schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
        explanationId: encounterPresentationStableId('explanation', input.participant.participantId, 'capability', fact.instanceId),
        subjectId: input.participant.participantId,
        label: `${fact.displayName} acquisition`,
        result: value,
        contributions: fact.sources.slice(0, 16).map((contribution, contributionIndex) => ({
          contributionId: encounterPresentationStableId('contribution', input.participant.participantId, fact.instanceId, String(contributionIndex)),
          order: contributionIndex,
          kind: fact.active
            ? contributionIndex === 0 ? 'base' as const : 'add' as const
            : 'prevent' as const,
          source,
          label: contribution.label,
          value: contribution.value === null ? booleanFact(true) : numberFact(contribution.value),
          applied: fact.active,
          private: false,
          preventionReason: fact.active ? null : encounterAvailabilityReason('source.capability-required', {
            sources: [source],
            diagnosticDetail: fact.suppressionReasons.join(', ') || 'Suppressed',
          }),
        })),
      },
    })
  })
  const factByInstance = new Map(input.capabilityBundle.facts.map(fact => [fact.instanceId, fact]))
  const actionOffers = input.capabilityBundle.offers.map((offer, index) => {
    const fact = factByInstance.get(offer.capabilityInstanceId)
    const source = sourceRef({
      kind: 'capability', canonicalId: offer.canonicalId,
      displayName: fact?.displayName ?? offer.canonicalId, instanceId: offer.capabilityInstanceId,
    })
    const timing = timingFromText(`${offer.economy} action`)
    const unavailableCodes: EncounterAvailabilityReasonCode[] = offer.unavailableReasonCodes.map((reason) => {
      if (reason.startsWith('economy.standard')) return 'economy.standard-spent'
      if (reason.startsWith('economy.shift')) return 'economy.shift-spent'
      if (reason.startsWith('economy.swift')) return 'economy.swift-spent'
      if (reason.startsWith('usage.daily')) return 'usage.daily-exhausted'
      if (reason.startsWith('usage.')) return 'usage.frequency-exhausted'
      return 'source.capability-required'
    })
    const group: EncounterActionOffer['group'] = offer.mechanic === 'movement-request' ? 'movement'
      : offer.mechanic === 'shape-terrain' ? 'field'
        : offer.mechanic === 'produce-item' || offer.mechanic === 'resolve-roll' ? 'inventory'
          : offer.mechanic === 'campaign-time' ? 'campaign' : 'support'
    return makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.participant,
      source,
      roles: offer.economy === 'extended' ? ['activated-action', 'campaign-operation'] : ['activated-action'],
      group,
      groupOrder: group === 'movement' ? 25 : group === 'inventory' ? 45 : group === 'campaign' ? 80 : 35,
      offerOrder: index,
      timing,
      targeting: capabilityTargeting(offer.contextPredicateId),
      usage: {
        frequencyLabel: offer.frequency,
        remaining: offer.frequency === 'at-will' ? null : offer.available ? 1 : 0,
        maximum: offer.frequency === 'at-will' ? null : 1,
        cooldownLabel: offer.unavailableReasonCodes.some(reason => reason.includes('cooldown')) ? 'Cooldown active' : null,
        resetLabel: offer.frequency === 'daily' ? 'Next campaign day' : offer.frequency === 'weekly' ? 'After seven campaign days' : null,
      },
      availability: availabilityFromCodes(unavailableCodes),
      copy: presentation(offer.label, { description: boundedCapabilityDescription(fact?.sourceEffect), iconKey: 'source.capability' }),
      actionId: `capability.execute:${offer.actionId}`,
      offerId: offer.offerId,
      selectionOptions: offer.selectionOptions,
    })
  })
  const privateNoticePassives = input.capabilityBundle.privateNotices.map((notice) => {
    const source = sourceRef({
      kind: 'capability', canonicalId: notice.canonicalId,
      displayName: notice.label, instanceId: notice.noticeId,
    })
    return passiveSummary({
      map: input.map,
      participant: input.participant,
      source,
      roles: ['passive-provider'],
      facts: [{
        factId: encounterPresentationStableId('fact', input.participant.participantId, 'capability-notice', notice.noticeId),
        factKey: encounterPresentationStableId('capability-notice', notice.canonicalId, notice.actionId),
        value: textFact(notice.summary),
        label: notice.label,
      }],
      description: notice.summary,
    })
  })
  const adjudicationOffers = input.capabilityBundle.pendingAdjudications.map((pending, index) => {
    const fact = factByInstance.get(pending.capabilityInstanceId)
    const source = sourceRef({
      kind: 'capability', canonicalId: pending.canonicalId,
      displayName: fact?.displayName ?? pending.canonicalId,
      instanceId: pending.capabilityInstanceId,
    })
    return makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.participant,
      source,
      roles: ['choice-only'],
      group: 'support',
      groupOrder: 95,
      offerOrder: actionOffers.length + index,
      timing: timingFromText('free action'),
      targeting: [],
      usage: emptyUsage('pending GM adjudication'),
      availability: encounterAvailable(),
      copy: presentation(`Resolve ${pending.canonicalId}: ${pending.actionId.split('-').join(' ')}`, {
        description: 'Review and retain a bounded source-authorized GM decision.',
        iconKey: 'source.capability',
      }),
      actionId: `capability.adjudication:${pending.requestId}`,
      offerId: encounterPresentationStableId('capability-adjudication', input.map.slug, String(input.mapRevision), pending.requestId),
    })
  })
  return { offers: [...actionOffers, ...adjudicationOffers], passives: [...passives, ...privateNoticePassives] }
}

const featureAndEdgePresentation = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participant: EncounterParticipantPresentationRef
  readonly sheet: CharacterSheet | TrainerSheet
}): { readonly offers: EncounterActionOffer[]; readonly passives: EncounterPassiveSummary[] } => {
  const offers: EncounterActionOffer[] = []
  const passives: EncounterPassiveSummary[] = []

  if ('features' in input.sheet) {
    const effectiveFeatures = resolveEffectiveFeatures({ ownerId: input.sheet.slug, sheet: input.sheet })
    for (const [index, feature] of effectiveFeatures.instances.entries()) {
      const reference = canonicalFeatureReference(feature.canonicalId)
      const source = sourceRef({ kind: 'feature', canonicalId: feature.canonicalId, instanceId: feature.instanceId })
      const facts: EncounterPassiveFact[] = feature.mechanics.map((mechanic, mechanicIndex) => ({
        factId: encounterPresentationStableId('feature-fact', feature.instanceId, mechanic.mechanicId, String(mechanicIndex)),
        factKey: mechanic.propertyId,
        value: textFact(mechanic.operation),
        label: mechanic.propertyId,
      }))
      passives.push(passiveSummary({
        map: input.map,
        participant: input.participant,
        source,
        roles: ['passive-provider'],
        active: feature.effective,
        facts,
        description: feature.effective ? reference?.effect ?? null : feature.suppressionReasonCode,
      }))
      for (const [actionIndex, action] of feature.actions.entries()) {
        const roles: EncounterInteractionRole[] = action.triggered
          ? action.frequency.modifiers.includes('interrupt') || action.frequency.modifiers.includes('reaction') ? ['interrupt-reaction'] : ['triggered-optional']
          : ['activated-action']
        const unavailable: EncounterAvailabilityReasonCode[] = feature.effective ? [] : ['source.suppressed']
        offers.push(makeOffer({
          map: input.map,
          mapRevision: input.mapRevision,
          actor: input.participant,
          source,
          roles,
          group: roles.includes('interrupt-reaction') ? 'reaction' : 'support',
          groupOrder: 60,
          offerOrder: index * 10 + actionIndex,
          timing: timingFromText(action.frequency.source),
          targeting: action.targetRequired ? [{ requirementId: 'feature-target', kind: 'participant', minSelections: 1, maxSelections: 32, rangeLabel: reference?.target ?? null, relationshipLabel: 'Server-authorized Feature targets', requiresLineOfSight: false, requiresSpatialInput: false }] : [],
          usage: emptyUsage(action.frequency.source),
          availability: availabilityFromCodes(unavailable),
          copy: presentation(feature.canonicalId, { description: reference?.effect ?? null, iconKey: 'source.feature' }),
          actionId: `feature.${feature.canonicalId}.${action.id}`,
          intentInput: action.choices.length ? 'choices' : undefined,
        }))
      }
    }
  }

  const family = 'species' in input.sheet ? 'poke' as const : 'trainer' as const
  const effective = resolveEffectiveEdges({ ownerId: input.sheet.slug, family, sheet: input.sheet })
  for (const [index, edge] of effective.instances.entries()) {
    const reference = canonicalEdgeReference(family, edge.canonicalId)
    const source = sourceRef({
      kind: 'edge',
      canonicalId: edge.canonicalId,
      instanceId: edge.instanceId,
    })
    const facts: EncounterPassiveFact[] = edge.mechanics.map((mechanic, mechanicIndex) => {
      const selected = mechanic.choiceId ? edgeChoiceValues(edge.instance, mechanic.choiceId) : []
      const value = selected.length > 0
        ? textFact(selected.join(', '))
        : typeof mechanic.value === 'number'
          ? numberFact(mechanic.value)
          : typeof mechanic.value === 'boolean'
            ? booleanFact(mechanic.value)
            : textFact(typeof mechanic.value === 'string'
              ? mechanic.value
              : mechanic.valueSource ?? mechanic.operation)
      return {
        factId: encounterPresentationStableId('edge-fact', edge.instanceId, mechanic.mechanicId, String(mechanicIndex)),
        factKey: mechanic.propertyId,
        value,
        label: mechanic.propertyId,
      }
    })
    passives.push(passiveSummary({
      map: input.map,
      participant: input.participant,
      source,
      roles: ['passive-provider'],
      active: edge.effective,
      facts,
      description: edge.effective ? reference?.effect ?? null : edge.suppressionReasonCode,
    }))

    for (const [actionIndex, action] of edge.actions.entries()) {
      const timing: EncounterActionTiming = action.timing === 'extended'
        ? { kind: 'extended', label: 'Extended Action', triggerLabel: null, priority: null }
        : { kind: action.timing, label: `${action.timing[0]?.toUpperCase()}${action.timing.slice(1)} Action`, triggerLabel: null, priority: null }
      const unavailable: EncounterAvailabilityReasonCode[] = []
      if (!edge.effective) unavailable.push('source.suppressed')
      if (edge.canonicalId === 'Breeder') unavailable.push('action.unsupported')
      if (action.id === 'stand-from-tripped'
        && !input.participant.statusLabels.some(label => /tripped/i.test(label))) unavailable.push('timing.trigger-not-met')
      offers.push(makeOffer({
        map: input.map,
        mapRevision: input.mapRevision,
        actor: input.participant,
        source,
        roles: ['activated-action', 'contextual-affordance'],
        group: action.operation === 'encounter' ? 'movement' : 'support',
        groupOrder: 60,
        offerOrder: index * 10 + actionIndex,
        timing,
        usage: emptyUsage(),
        availability: availabilityFromCodes(unavailable),
        copy: presentation(edge.canonicalId, { description: reference?.effect ?? null, iconKey: 'source.edge' }),
        actionId: `edge.${family}.${edge.canonicalId}.${action.id}`,
      }))
    }
  }
  return { offers, passives }
}

const inventoryEntries = (sheet: TrainerSheet): InventoryEntry[] => Object.values(sheet.inventory ?? {})
  .flatMap(entries => entries ?? [])
  .filter(entry => entry.name.trim().length > 0 && (entry.qty ?? 1) > 0)

const largeSnagMachineOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly trainerSheet: TrainerSheet
  readonly offerBase: number
}): EncounterActionOffer[] => {
  const choices = snagBallInventoryChoices(input.trainerSheet)
  return largeSnagMachineInventorySources(input.trainerSheet).map((machine, index) => {
    const source = sourceRef({
      kind: 'item',
      canonicalId: 'Snag Machine',
      displayName: 'Large Snag Machine',
      instanceId: machine.publicSourceId,
    })
    return makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.actor,
      source,
      roles: ['activated-action', 'choice-only', 'contextual-affordance'],
      group: 'inventory',
      groupOrder: 42,
      offerOrder: input.offerBase + index,
      timing: { kind: 'system', label: 'Large-machine conversion', triggerLabel: null, priority: null },
      targeting: equipmentGrantTargeting('item'),
      usage: emptyUsage('5 conversions per campaign day per machine'),
      availability: choices.length > 0
        ? encounterAvailable()
        : encounterUnavailable(encounterAvailabilityReason('source.item-unavailable', { sources: [source] })),
      copy: presentation('Prepare permanent Snag Ball', {
        description: choices.length > 0
          ? 'Choose one reviewed Poké Ball for GM-bounded permanent conversion.'
          : 'No unreserved reviewed Poké Ball unit is available.',
        iconKey: 'source.item',
        tone: choices.length > 0 ? 'neutral' : 'warning',
      }),
      actionId: 'equipment.snag-machine.convert',
      offerId: encounterPresentationStableId(
        'offer', input.map.slug, String(input.mapRevision), input.actor.participantId,
        machine.publicSourceId, 'equipment.snag-machine.convert',
      ),
      sourceContextLabel: 'Large Snag Machine · Trainer inventory custody',
      selectionOptions: choices.map(choice => ({
        kind: 'object',
        requirementId: 'equipment-item',
        value: choice.publicOptionId,
        label: choice.option.name,
        description: `${choice.availableUnconvertedUnits} unreserved unit${choice.availableUnconvertedUnits === 1 ? '' : 's'} available`,
      })),
    })
  })
}

const systemOffers = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly trainerSheet: TrainerSheet | null
  readonly gm: boolean
  readonly offerBase: number
}): EncounterActionOffer[] => {
  const offers: EncounterActionOffer[] = [makeOffer({
    map: input.map,
    mapRevision: input.mapRevision,
    actor: input.actor,
    source: sourceRef({ kind: 'movement', canonicalId: 'shift', displayName: 'Shift' }),
    roles: ['activated-action', 'spatial-choice'],
    group: 'movement',
    groupOrder: 5,
    offerOrder: input.offerBase,
    timing: { kind: 'shift', label: 'Shift Action', triggerLabel: null, priority: null },
    targeting: [{
      requirementId: 'destination',
      kind: 'path',
      minSelections: 1,
      maxSelections: 1,
      rangeLabel: 'Authoritative movement allowance',
      relationshipLabel: null,
      requiresLineOfSight: false,
      requiresSpatialInput: true,
    }],
    actionId: 'movement.shift',
  })]
  if (input.trainerSheet) {
    offers.push(makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.actor,
      source: sourceRef({ kind: 'capture', canonicalId: 'throw-poke-ball', displayName: 'Throw Poké Ball' }),
      roles: ['activated-action', 'contextual-affordance', 'choice-only'],
      group: 'capture',
      groupOrder: 70,
      offerOrder: input.offerBase + 1,
      timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
      targeting: [{
        requirementId: 'target',
        kind: 'participant',
        minSelections: 1,
        maxSelections: 1,
        rangeLabel: 'Throwing range',
        relationshipLabel: 'Eligible wild Pokémon',
        requiresLineOfSight: true,
        requiresSpatialInput: false,
      }],
      availability: inventoryEntries(input.trainerSheet).some(entry => /ball/i.test(entry.name))
        ? encounterAvailable()
        : availabilityFromCodes(['source.item-required']),
      actionId: 'capture.throw',
      intentInput: 'choices',
    }))
    offers.push(makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.actor,
      source: sourceRef({ kind: 'token', canonicalId: 'send-out', displayName: 'Send Out Pokémon' }),
      roles: ['contextual-affordance', 'spatial-choice'],
      group: 'participant',
      groupOrder: 80,
      offerOrder: input.offerBase + 2,
      timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
      targeting: [{
        requirementId: 'destination',
        kind: 'destination',
        minSelections: 1,
        maxSelections: 1,
        rangeLabel: 'Legal send-out cell',
        relationshipLabel: null,
        requiresLineOfSight: false,
        requiresSpatialInput: true,
      }],
      availability: (input.trainerSheet.currentTeam?.length ?? 0) > 0
        ? encounterAvailable()
        : availabilityFromCodes(['source.missing']),
      actionId: 'token.send-out',
    }))
  }
  if (input.gm) {
    const gmActions = [
      ['initiative', 'initiative.advance', 'Advance Initiative', 'initiative'],
      ['scene', 'scene.manage', 'Manage Scene', 'scene'],
      ['field-effect', 'field.manage', 'Manage Field Effects', 'field'],
      ['hazard', 'hazard.manage', 'Manage Hazards', 'field'],
      ['terrain', 'terrain.manage', 'Edit Terrain', 'field'],
      ['token', 'token.manage', 'Manage Participant', 'administration'],
    ] as const
    gmActions.forEach(([kind, actionId, label, group], index) => {
      offers.push(makeOffer({
        map: input.map,
        mapRevision: input.mapRevision,
        actor: input.actor,
        source: sourceRef({ kind, canonicalId: actionId, displayName: label }),
        roles: ['activated-action'],
        group,
        groupOrder: 90,
        offerOrder: input.offerBase + 10 + index,
        timing: { kind: 'system', label: 'GM table action', triggerLabel: null, priority: null },
        actionId,
      }))
    })
  }
  return offers
}

/**
 * Build the one source-agnostic, role-specific snapshot bundle. Mechanics stay
 * in their owning runtimes; this function projects only server-reviewed facts.
 */
export const buildEncounterPresentationProjection = (
  input: BuildEncounterPresentationProjectionInput,
  dependencies: BuildEncounterPresentationProjectionDependencies = {},
): EncounterPresentationProjection => {
  const pokemonBySlug = new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet]))
  const equipmentGrantQueries = createEncounterEquipmentGrantQueries({
    map: input.map,
    sheets: [
      ...input.pokemonSheets.map(sheet => ({ kind: 'pokemon' as const, slug: sheet.slug, sheet })),
      ...input.trainerSheets.map(sheet => ({ kind: 'trainer' as const, slug: sheet.slug, sheet })),
    ],
  })
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => trainerBySlug.get(slug),
  )
  const controlledIds = new Set(actorControlledMapPlacementIds({
    role: input.role,
    profile: input.playerProfile,
    placements: input.map.placements,
    linkedTrainerSheets,
  }))
  const participants = new Map(input.map.placements.map(placement => [
    placement.id,
    participantForPlacement(placement, pokemonBySlug, trainerBySlug, input.map),
  ]))
  const abilityCapabilities = dependencies.abilityCapabilities ?? buildAbilityClientCapabilityBundle({
    role: input.role,
    playerProfile: input.playerProfile,
    map: input.map,
    mapRevision: input.mapRevision,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
  })
  const ability = abilityOffersAndPassives({
    map: input.map,
    mapRevision: input.mapRevision,
    participants,
    capabilities: abilityCapabilities,
  })
  const capabilityCapabilities = dependencies.capabilityCapabilities ?? buildCapabilityClientCapabilityBundle({
    role: input.role,
    playerProfile: input.playerProfile,
    map: input.map,
    mapRevision: input.mapRevision,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    now: input.generatedAt ?? input.map.updatedAt ?? 0,
  })
  const capabilityByPlacement = new Map(
    capabilityCapabilities.placements.map(bundle => [bundle.placementId, bundle]),
  )
  const offers: EncounterActionOffer[] = [...ability.offers]
  const passives: EncounterPassiveSummary[] = [...ability.passives]
  const affordances: EncounterContextualAffordance[] = []
  passives.push(...equipmentRestraintPassives({ map: input.map, participants }))
  offers.push(...shockCollarImplicitRemoteOffers({
    map: input.map,
    mapRevision: input.mapRevision,
    controlledIds,
    participants,
    pokemonBySlug,
    trainerBySlug,
    grantsForPlacement: placementId => equipmentGrantQueries.resolve(placementId),
  }))
  // An accepted form is public encounter mechanics even when the transformed
  // participant has no current action offer. Project only reviewed effective
  // data; immutable source instances, revisions, hashes, and operation identity
  // remain solely in encounterState and are redacted from players.
  for (const placement of input.map.placements) {
    if (placement.sheetKind !== 'pokemon') continue
    const pokemon = pokemonBySlug.get(placement.sheetSlug)
    const participant = participants.get(placement.id)
    if (!pokemon || !participant) continue
    const activeForm = activeReviewedItemFormChange({
      map: input.map, placementId: placement.id, pokemonSheet: pokemon,
    })
    if (!activeForm) continue
    const types = activeForm.form.types ?? pokemon.types ?? []
    const statDeltas = Object.entries(activeForm.form.statDeltas)
      .filter(([, value]) => value !== 0)
      .map(([stat, value]) => `${stat.toUpperCase()} ${value > 0 ? '+' : ''}${value}`)
    const projectedSourceId = `active-item-form:${placement.id}`
    passives.push(passiveSummary({
      map: input.map,
      participant,
      source: sourceRef({
        kind: 'system',
        canonicalId: 'item-form-change.mega-evolution',
        displayName: activeForm.form.displayName,
        instanceId: projectedSourceId,
      }),
      facts: [{
        factId: encounterPresentationStableId('fact', placement.id, projectedSourceId, 'form'),
        factKey: 'effective-form',
        value: textFact(activeForm.form.displayName),
        label: `Form: ${activeForm.form.displayName}`,
      }, {
        factId: encounterPresentationStableId('fact', placement.id, projectedSourceId, 'types'),
        factKey: 'effective-types',
        value: textFact(types.join(' / ')),
        label: `Types: ${types.join(' / ')}`,
      }, {
        factId: encounterPresentationStableId('fact', placement.id, projectedSourceId, 'ability'),
        factKey: 'effective-ability',
        value: textFact(activeForm.entry.abilityId),
        label: `Ability: ${activeForm.entry.abilityId}`,
      }, {
        factId: encounterPresentationStableId('fact', placement.id, projectedSourceId, 'stats'),
        factKey: 'effective-stat-deltas',
        value: textFact(statDeltas.length > 0 ? statDeltas.join(', ') : 'No non-HP Stat change'),
        label: statDeltas.length > 0 ? `Stat changes: ${statDeltas.join(', ')}` : 'No non-HP Stat change',
      }],
      description: 'Active until this Scene ends; HP and permanent sheet identity are unchanged.',
    }))
  }
  let offerBase = 1_000
  for (const placement of input.map.placements) {
    if (!controlledIds.has(placement.id)) continue
    const actor = participants.get(placement.id)
    const sheet = placement.sheetKind === 'pokemon'
      ? pokemonBySlug.get(placement.sheetSlug)
      : trainerBySlug.get(placement.sheetSlug)
    if (!actor || !sheet) continue
    const resolvedEquipmentGrants = equipmentGrantQueries.resolve(placement.id)
    offers.push(...moveOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      placement,
      actor,
      sheet,
      pokemonBySlug,
      trainerBySlug,
      equipmentGrants: resolvedEquipmentGrants,
    }))
    if (resolvedEquipmentGrants) {
      const equipment = equipmentGrantPresentation({
        map: input.map,
        mapRevision: input.mapRevision,
        participant: actor,
        placement,
        sheet,
        participants,
        pokemonBySlug,
        trainerBySlug,
        grantsForPlacement: placementId => equipmentGrantQueries.resolve(placementId),
        resolved: resolvedEquipmentGrants,
        offerOrderBase: offerBase + 70,
      })
      offers.push(...equipment.offers)
      passives.push(...equipment.passives)
      affordances.push(...equipment.affordances)
    }
    offers.push(...maneuverOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      placement,
      actor,
      trainerBySlug,
    }))
    offers.push(...orderOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      placement,
      actor,
      trainerBySlug,
    }))
    const capabilityBundle = capabilityByPlacement.get(placement.id)
    if (capabilityBundle) {
      const capability = capabilityPresentation({
        map: input.map,
        mapRevision: input.mapRevision,
        participant: actor,
        capabilityBundle,
      })
      offers.push(...capability.offers)
      passives.push(...capability.passives)
    }
    const featureEdge = featureAndEdgePresentation({
      map: input.map,
      mapRevision: input.mapRevision,
      participant: actor,
      sheet,
    })
    offers.push(...featureEdge.offers)
    passives.push(...featureEdge.passives)
    const itemFormChanges = projectEncounterItemFormChangeOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      actor,
      sheets: { pokemon: pokemonBySlug, trainer: trainerBySlug },
      participants,
      ...(input.role === 'player' ? {
        permittedTrainerSourceSlugs: new Set(linkedTrainerSheets.map(trainer => trainer.slug)),
      } : {}),
      offerOrderBase: offerBase + 40,
    })
    offers.push(...itemFormChanges.offers)
    affordances.push(...itemFormChanges.affordances)
    const trainerSheet = placement.sheetKind === 'trainer' ? sheet as TrainerSheet : null
    if (trainerSheet) {
      const itemProjection = projectEncounterItemOffers({
        map: input.map,
        mapRevision: input.mapRevision,
        actor,
        trainerSheet,
        pokemonSheets: input.pokemonSheets,
        trainerSheets: input.trainerSheets,
        equipmentGrants: resolvedEquipmentGrants,
        offerOrderBase: offerBase + 50,
      })
      offers.push(...itemProjection.offers)
      affordances.push(...itemProjection.affordances)
      offers.push(...largeSnagMachineOffers({
        map: input.map,
        mapRevision: input.mapRevision,
        actor,
        trainerSheet,
        offerBase: offerBase + 75,
      }))
    }
    offers.push(...systemOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      actor,
      trainerSheet,
      gm: input.role === 'gm',
      offerBase,
    }))
    offerBase += 100
  }
  const audience = input.audience ?? (
    input.role === 'gm'
      ? 'gm'
      : (dependencies.pendingMoveResponses?.windows.length ?? 0) > 0
        ? 'responder-owner'
        : 'actor-owner'
  )
  const pending = pendingEncounterInteractionsFromMoveResponses({
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    summaries: input.map.encounterState?.pendingResolutionSummaries ?? [],
    authorized: dependencies.pendingMoveResponses ?? null,
    participants: [...participants.values()],
    gm: input.role === 'gm',
  })
  return parseEncounterPresentationProjection({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projectionId: encounterPresentationStableId('projection', input.map.slug, String(input.mapRevision), audience),
    audience,
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    generatedAt: input.generatedAt ?? input.map.updatedAt ?? 0,
    offers: offers.sort((left, right) => (
      left.groupOrder - right.groupOrder
      || left.offerOrder - right.offerOrder
      || left.presentation.label.localeCompare(right.presentation.label)
      || left.offerId.localeCompare(right.offerId)
    )),
    passives: passives.sort((left, right) => (
      left.participant.participantId.localeCompare(right.participant.participantId)
      || left.presentation.label.localeCompare(right.presentation.label)
      || left.summaryId.localeCompare(right.summaryId)
    )),
    affordances: affordances.sort((left, right) => (
      (left.actor?.participantId ?? '').localeCompare(right.actor?.participantId ?? '')
      || left.presentation.label.localeCompare(right.presentation.label)
      || left.affordanceId.localeCompare(right.affordanceId)
    )),
    pending,
    accepted: [...(dependencies.acceptedPresentations ?? [])]
      .filter(accepted => accepted.mapSlug === input.map.slug && accepted.revision <= input.mapRevision)
      .map(accepted => currentAcceptedParticipantIdentities(accepted, participants))
      .sort((left, right) => left.revision - right.revision || left.presentationId.localeCompare(right.presentationId))
      .slice(-100),
    diagnostics: [],
  })
}
