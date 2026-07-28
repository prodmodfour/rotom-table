import type { AuthRole } from '#shared/auth'
import type { AbilityClientCapability, AbilityClientCapabilityBundle } from '#shared/abilityAutomation/clientCapabilities'
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
import type { PendingMoveResponseWindowList } from '#shared/moveAutomation/responseViews'
import { toSlug, findAbility, findEdge, findFeature, findItem, findMove } from '~~/data/ptuReference'
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
import { resolveCapabilities } from '~/utils/sheets/pokemonDerived'
import { pendingEncounterInteractionsFromMoveResponses } from './pendingAdapters'

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

const participantForPlacement = (
  placement: SheetPlacement,
  pokemonBySlug: ReadonlyMap<string, CharacterSheet>,
  trainerBySlug: ReadonlyMap<string, TrainerSheet>,
  map: TabletopMap,
): EncounterParticipantPresentationRef => {
  const pokemon = placement.sheetKind === 'pokemon' ? pokemonBySlug.get(placement.sheetSlug) : null
  const trainer = placement.sheetKind === 'trainer' ? trainerBySlug.get(placement.sheetSlug) : null
  const side = placement.sideId ? map.encounterState?.sides[placement.sideId] : null
  return {
    participantId: placement.id,
    displayName: pokemon?.nickname?.trim() || pokemon?.species?.trim() || trainer?.name?.trim() || 'Participant',
    portraitUrl: trainer?.portraitUrl?.startsWith('/') ? trainer.portraitUrl : null,
    sideId: placement.sideId ?? null,
    sideLabel: side?.label ?? null,
    sideAccent: side?.color && /^#[0-9a-fA-F]{6}$/.test(side.color) ? side.color : null,
    sheetKind: placement.sheetKind,
    statusLabels: [...new Set((
      placement.sheetKind === 'pokemon'
        ? pokemon?.combat?.conditions ?? []
        : trainer?.conditions ?? []
    ).map(label => label.trim()).filter(Boolean))].slice(0, 32),
  }
}

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
    offerId: encounterPresentationStableId(
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
}): EncounterActionOffer[] => moveEntriesForPlacement(input.placement, {
  pokemon: new Map(input.pokemonBySlug),
  trainer: new Map(input.trainerBySlug),
}, { encounterEffects: input.map.encounterState?.effects ?? [] }).map((entry, index) => {
  const reference = findMove(entry.move.name)
  const name = reference?.name ?? entry.move.name
  const frequency = reference?.frequency ?? entry.move.frequency ?? null
  const range = reference?.range ?? entry.move.range ?? null
  const damageClass = reference?.damage_class ?? entry.move.category ?? null
  const semantic = moveAutomationSemanticStatusForMenu(name)
  const usage = moveUsage(input.placement.id, name, frequency, input.map, input.sheet)
  const conditions = input.placement.sheetKind === 'pokemon'
    ? (input.sheet as CharacterSheet).combat?.conditions
    : (input.sheet as TrainerSheet).conditions
  const conditionBlock = moveConditionUseBlock({ name, damageClass, range, frequency }, conditions)
  const unavailable: EncounterAvailabilityReasonCode[] = [
    ...(semantic.baseStatus === 'blocked' ? ['action.unsupported' as const] : []),
    ...(entry.moveListProjection?.available === false ? ['source.suppressed' as const] : []),
    ...(conditionBlock ? ['condition.disabled' as const] : []),
    ...(usage.unavailable ? [usage.unavailable] : []),
  ]
  const timing = timingFromText(frequency)
  return makeOffer({
    map: input.map,
    mapRevision: input.mapRevision,
    actor: input.actor,
    source: sourceRef({ kind: 'move', canonicalId: name }),
    group: damageClass === 'Status' ? 'support' : 'attack',
    groupOrder: damageClass === 'Status' ? 20 : 10,
    offerOrder: index,
    timing,
    targeting: targetingFromRange(range),
    usage: usage.summary,
    availability: availabilityFromCodes(unavailable),
    copy: presentation(name, {
      description: [reference?.type, damageClass, range].filter(Boolean).join(' · ') || null,
      iconKey: `source.move`,
    }),
    actionId: 'move.declare',
  })
})

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

const capabilityPassives = (input: {
  readonly map: TabletopMap
  readonly participant: EncounterParticipantPresentationRef
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
}): EncounterPassiveSummary[] => {
  const entries: Array<{ readonly label: string; readonly value: EncounterDerivedFactValue }> = []
  if (input.placement.sheetKind === 'pokemon') {
    const resolved = resolveCapabilities(input.sheet as CharacterSheet)
    for (const row of resolved.rows) {
      const value = typeof row.value === 'number'
        ? numberFact(row.value)
        : String(row.value ?? '').trim()
          ? textFact(String(row.value).trim())
          : null
      if (value) entries.push({ label: row.label, value })
    }
    for (const other of resolved.other) entries.push({ label: other, value: booleanFact(true) })
  }
  else {
    const capabilities = (input.sheet as TrainerSheet).capabilities ?? {}
    for (const [key, raw] of Object.entries(capabilities)) {
      if (key === 'other') continue
      if (typeof raw === 'number' && Number.isFinite(raw)) entries.push({ label: key, value: numberFact(raw) })
    }
    for (const other of capabilities.other ?? []) entries.push({ label: other, value: booleanFact(true) })
  }
  return entries.map((entry, index) => {
    const source = sourceRef({ kind: 'capability', canonicalId: entry.label })
    return passiveSummary({
      map: input.map,
      participant: input.participant,
      source,
      facts: [{
        factId: encounterPresentationStableId('fact', input.participant.participantId, 'capability', entry.label, String(index)),
        factKey: encounterPresentationStableId('capability', entry.label),
        value: entry.value,
        label: entry.label,
      }],
      explanation: {
        schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
        explanationId: encounterPresentationStableId('explanation', input.participant.participantId, 'capability', entry.label),
        subjectId: input.participant.participantId,
        label: `${entry.label} contribution`,
        result: entry.value,
        contributions: [{
          contributionId: encounterPresentationStableId('contribution', input.participant.participantId, 'capability', entry.label, 'base'),
          order: 0,
          kind: 'base',
          source,
          label: entry.label,
          value: entry.value,
          applied: true,
          private: false,
          preventionReason: null,
        }],
      },
    })
  })
}

const frequencyRoles = (
  frequency: string | null | undefined,
  trigger: string | null | undefined,
): readonly EncounterInteractionRole[] => {
  const lower = `${frequency ?? ''} ${trigger ?? ''}`.toLowerCase()
  if (lower.includes('interrupt')) return ['interrupt-reaction']
  if (trigger) return ['triggered-optional']
  if (/standard|shift|swift|free|full|extended|priority|action/.test(lower)) return ['activated-action']
  return ['passive-provider']
}

const featureAndEdgePresentation = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participant: EncounterParticipantPresentationRef
  readonly sheet: CharacterSheet | TrainerSheet
}): { readonly offers: EncounterActionOffer[]; readonly passives: EncounterPassiveSummary[] } => {
  const rows: Array<{
    readonly kind: 'feature' | 'edge'
    readonly name: string
    readonly frequency: string | null
    readonly trigger: string | null
    readonly description: string | null
  }> = []
  if ('features' in input.sheet) {
    for (const feature of input.sheet.features ?? []) {
      const reference = findFeature(feature.name)
      rows.push({
        kind: 'feature',
        name: reference?.name ?? feature.name,
        frequency: feature.frequency ?? reference?.frequency ?? null,
        trigger: reference?.trigger ?? null,
        description: reference?.effect ?? feature.notes ?? null,
      })
    }
    for (const edge of input.sheet.edges ?? []) {
      const reference = findEdge(edge.name)
      rows.push({
        kind: 'edge',
        name: reference?.name ?? edge.name,
        frequency: reference?.frequency ?? null,
        trigger: reference?.trigger ?? null,
        description: reference?.effect ?? edge.notes ?? null,
      })
    }
  }
  else {
    for (const edge of (input.sheet as CharacterSheet).edges ?? []) {
      const reference = findEdge(edge.name)
      rows.push({
        kind: 'edge',
        name: reference?.name ?? edge.name,
        frequency: reference?.frequency ?? null,
        trigger: reference?.trigger ?? null,
        description: reference?.effect ?? edge.effect ?? null,
      })
    }
  }
  const offers: EncounterActionOffer[] = []
  const passives: EncounterPassiveSummary[] = []
  rows.forEach((row, index) => {
    const source = sourceRef({ kind: row.kind, canonicalId: row.name })
    const roles = frequencyRoles(row.frequency, row.trigger)
    if (roles.includes('passive-provider')) {
      passives.push(passiveSummary({
        map: input.map,
        participant: input.participant,
        source,
        roles,
        description: row.frequency,
      }))
      return
    }
    offers.push(makeOffer({
      map: input.map,
      mapRevision: input.mapRevision,
      actor: input.participant,
      source,
      roles,
      group: roles.includes('interrupt-reaction') ? 'reaction' : 'support',
      groupOrder: 60,
      offerOrder: index,
      timing: timingFromText(row.frequency ?? row.trigger),
      targeting: [],
      usage: emptyUsage(row.frequency),
      availability: availabilityFromCodes(['action.unsupported']),
      copy: presentation(row.name, { description: row.frequency, iconKey: `source.${row.kind}` }),
      actionId: `${row.kind}.declare`,
    }))
  })
  return { offers, passives }
}

const inventoryEntries = (sheet: TrainerSheet): InventoryEntry[] => Object.values(sheet.inventory ?? {})
  .flatMap(entries => entries ?? [])
  .filter(entry => entry.name.trim().length > 0 && (entry.qty ?? 1) > 0)

const inventoryAffordances = (input: {
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly participant: EncounterParticipantPresentationRef
  readonly sheet: TrainerSheet
}): EncounterContextualAffordance[] => inventoryEntries(input.sheet).map((entry, index) => {
  const reference = findItem(entry.name)
  const name = reference?.name ?? entry.name
  return {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    affordanceId: encounterPresentationStableId('affordance', input.map.slug, input.participant.participantId, 'item', name, String(index)),
    contextKind: 'inventory',
    contextId: encounterPresentationStableId('inventory', input.sheet.slug, entry.id ?? String(index)),
    source: sourceRef({
      kind: 'item',
      canonicalId: name,
      instanceId: entry.id
        ? encounterPresentationStableId('item', input.sheet.slug, entry.id)
        : null,
    }),
    actor: input.participant,
    linkedOfferId: null,
    availability: encounterAvailable(),
    presentation: presentation(name, {
      description: `${entry.qty ?? 1} available`,
      iconKey: 'source.item',
    }),
  }
})

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
  const offers: EncounterActionOffer[] = [...ability.offers]
  const passives: EncounterPassiveSummary[] = [...ability.passives]
  const affordances: EncounterContextualAffordance[] = []
  let offerBase = 1_000
  for (const placement of input.map.placements) {
    if (!controlledIds.has(placement.id)) continue
    const actor = participants.get(placement.id)
    const sheet = placement.sheetKind === 'pokemon'
      ? pokemonBySlug.get(placement.sheetSlug)
      : trainerBySlug.get(placement.sheetSlug)
    if (!actor || !sheet) continue
    offers.push(...moveOffers({
      map: input.map,
      mapRevision: input.mapRevision,
      placement,
      actor,
      sheet,
      pokemonBySlug,
      trainerBySlug,
    }))
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
    passives.push(...capabilityPassives({ map: input.map, participant: actor, placement, sheet }))
    const featureEdge = featureAndEdgePresentation({
      map: input.map,
      mapRevision: input.mapRevision,
      participant: actor,
      sheet,
    })
    offers.push(...featureEdge.offers)
    passives.push(...featureEdge.passives)
    const trainerSheet = placement.sheetKind === 'trainer' ? sheet as TrainerSheet : null
    if (trainerSheet) affordances.push(...inventoryAffordances({
      map: input.map,
      mapRevision: input.mapRevision,
      participant: actor,
      sheet: trainerSheet,
    }))
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
      .sort((left, right) => left.revision - right.revision || left.presentationId.localeCompare(right.presentationId))
      .slice(-100),
    diagnostics: [],
  })
}
