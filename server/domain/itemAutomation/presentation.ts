import type { AuthRole } from '#shared/auth'
import {
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  encounterPresentationStableId,
  parseAcceptedEncounterPresentation,
  parseEncounterPendingInteractionView,
  type AcceptedEncounterPresentation,
  type EncounterChoiceKind,
  type EncounterChoiceOption,
  type EncounterParticipantPresentationRef,
  type EncounterPendingInteractionView,
  type EncounterProjectionAudience,
  type RuleSourceRef,
} from '#shared/encounterPresentation'
import type { EncounterWorkspaceAudience } from '#shared/encounterWorkspace/model'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ItemPendingChoiceV1, PlannedItemOperation } from '#shared/itemAutomation/operations'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { StoredItemOperationRecord } from '../../storage/itemOperationRepository'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'

export interface ProjectedItemOperationPresentations {
  readonly pending: readonly EncounterPendingInteractionView[]
  readonly accepted: readonly AcceptedEncounterPresentation[]
  readonly authorizedInteractionIds: readonly string[]
}

const boundedCopy = (value: string, fallback: string, maximum = 500): string => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return (normalized || fallback).slice(0, maximum)
}

export const encounterItemParticipantDirectory = (input: {
  readonly map: TabletopMap
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): ReadonlyMap<string, EncounterParticipantPresentationRef> => {
  const pokemon = new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainers = new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet]))
  return new Map(input.map.placements.map((placement): readonly [string, EncounterParticipantPresentationRef] => {
    const pokemonSheet = placement.sheetKind === 'pokemon' ? pokemon.get(placement.sheetSlug) : null
    const trainerSheet = placement.sheetKind === 'trainer' ? trainers.get(placement.sheetSlug) : null
    const side = placement.sideId ? input.map.encounterState?.sides[placement.sideId] : null
    return [placement.id, {
      participantId: placement.id,
      displayName: pokemonSheet?.nickname?.trim() || pokemonSheet?.species?.trim() || trainerSheet?.name?.trim() || 'Participant',
      portraitUrl: trainerSheet?.portraitUrl?.startsWith('/') ? trainerSheet.portraitUrl : null,
      sideId: placement.sideId ?? null,
      sideLabel: side?.label ?? null,
      sideAccent: side?.color && /^#[0-9a-f]{6}$/i.test(side.color) ? side.color : null,
      sheetKind: placement.sheetKind,
      statusLabels: [...new Set((placement.sheetKind === 'pokemon'
        ? pokemonSheet?.combat?.conditions ?? []
        : trainerSheet?.conditions ?? []).map(value => value.trim()).filter(Boolean))].slice(0, 32),
    }]
  }))
}

const controlsActor = (input: {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly record: StoredItemOperationRecord
}): boolean => input.role === 'gm' || playerProfileCanControlTokenSheet(
  input.playerProfile,
  input.record.command.actorSheet.kind,
  input.record.command.actorSheet.slug,
)

const currentDefinition = (record: StoredItemOperationRecord) => {
  if (!record.canonicalItemId || !record.canonicalDefinitionSha256) return null
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.resolve(record.canonicalItemId)
  return definition?.definitionSha256 === record.canonicalDefinitionSha256 ? definition : null
}

const canViewAudience = (input: {
  readonly audience: EncounterWorkspaceAudience
  readonly privacy: EncounterProjectionAudience
  readonly controlsActor: boolean
}): boolean => {
  if (input.audience === 'gm' || input.audience === 'diagnostic') return true
  if (input.privacy === 'public') return true
  if (input.audience !== 'player-owner' || !input.controlsActor) return false
  return input.privacy === 'actor-owner'
}

const authorizedProjection = (
  audience: EncounterWorkspaceAudience,
): 'actor-owner' | 'gm' | 'diagnostic' => audience === 'diagnostic'
  ? 'diagnostic'
  : audience === 'gm' ? 'gm' : 'actor-owner'

const choiceKind = (choice: ItemPendingChoiceV1): EncounterChoiceKind => {
  if (choice.kind === 'self' || choice.kind === 'participant') return 'participant'
  if (choice.kind === 'side') return 'side'
  if (choice.kind === 'move') return 'move'
  if (choice.kind === 'inventory-row' || choice.kind === 'equipment-slot') return 'item'
  return 'mode'
}

const choiceOption = (
  choice: ItemPendingChoiceV1,
  option: ItemPendingChoiceV1['options'][number],
  participants: ReadonlyMap<string, EncounterParticipantPresentationRef>,
  map: TabletopMap,
): EncounterChoiceOption => {
  const participant = (choice.kind === 'participant' || choice.kind === 'self')
    ? participants.get(option.optionId) ?? null
    : null
  const side = choice.kind === 'side' ? map.encounterState?.sides[option.optionId] ?? null : null
  const [label, ...descriptionParts] = option.label.split(' — ')
  return {
    optionId: option.optionId,
    label: boundedCopy(label ?? option.label, 'Authorized option', 200),
    description: choice.kind === 'participant' && descriptionParts.length > 0
      ? boundedCopy(descriptionParts.join(' — '), 'Authorized target', 500)
      : null,
    disabled: false,
    unavailableReason: null,
    preview: participant
      ? { kind: 'participant', participant }
      : side
        ? { kind: 'side', sideId: option.optionId, label: side.label, accent: side.color ?? null }
        : { kind: 'none' },
  }
}

const publicPending = (input: {
  readonly record: StoredItemOperationRecord
  readonly map: TabletopMap
}): EncounterPendingInteractionView => {
  const decision = input.record.pendingDecision!
  const interactionId = encounterPresentationStableId('item-pending', decision.decisionId)
  return parseEncounterPendingInteractionView({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projection: 'public',
    interactionId,
    mapSlug: input.map.slug,
    mapRevision: input.map.revision,
    status: 'pending',
    source: null,
    actor: null,
    prompt: 'Waiting for an authorised item decision.',
    outstandingChoiceCount: decision.choices.length,
    allowPass: false,
    allowCancel: false,
    expiresAt: null,
    announcement: {
      announcementId: encounterPresentationStableId('announcement', interactionId),
      priority: 'polite',
      message: 'The encounter is waiting for an authorised item decision.',
      dedupeKey: encounterPresentationStableId('pending', interactionId),
    },
  })
}

const pendingPresentation = (input: {
  readonly record: StoredItemOperationRecord
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly audience: EncounterWorkspaceAudience
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}): { readonly view: EncounterPendingInteractionView, readonly authorized: boolean } | null => {
  const decision = input.record.pendingDecision
  if (input.record.status !== 'pending' || !decision || input.record.resumeCommand) return null
  const controls = controlsActor(input)
  const choiceAuthorized = controls && decision.choices.every(choice => canViewAudience({
    audience: input.audience,
    privacy: choice.privateTo,
    controlsActor: controls,
  }))
  if (!choiceAuthorized || input.audience === 'public') {
    return { view: publicPending({ record: input.record, map: input.map }), authorized: false }
  }
  const definition = currentDefinition(input.record)
  const sourceVisible = definition !== null && canViewAudience({
    audience: input.audience,
    privacy: definition.spec.privacy.sourceInventory,
    controlsActor: controls,
  })
  const interactionId = encounterPresentationStableId('item-pending', decision.decisionId)
  const source: RuleSourceRef | null = sourceVisible ? {
    sourceKind: 'item',
    canonicalId: decision.canonicalItemId,
    instanceId: decision.sourceInstanceId,
    displayName: decision.canonicalItemId,
    referenceHref: `/items/${encodeURIComponent(decision.canonicalItemId)}`,
  } : null
  const actor = input.record.command.actorParticipantId
    ? input.participants.get(input.record.command.actorParticipantId) ?? null
    : null
  const choices = decision.choices.map(choice => ({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    choiceOfferId: encounterPresentationStableId('item-choice', decision.decisionId, choice.choiceId),
    interactionId,
    mapSlug: input.map.slug,
    mapRevision: input.map.revision,
    choiceId: choice.choiceId,
    kind: choiceKind(choice),
    prompt: `Choose ${choice.kind.replace(/-/g, ' ')}`,
    helpText: null,
    cardinality: { minimum: choice.minimum, maximum: choice.maximum },
    ordering: choice.kind === 'participant' ? 'initiative' : 'server',
    options: choice.options.map(option => choiceOption(choice, option, input.participants, input.map)),
    defaultOptionIds: [],
    requiresConfirmation: true,
    allowPass: choice.minimum === 0,
    allowCancel: false,
    expiresAt: null,
  }))
  return {
    authorized: true,
    view: parseEncounterPendingInteractionView({
      schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
      projection: authorizedProjection(input.audience),
      interactionId,
      mapSlug: input.map.slug,
      mapRevision: input.map.revision,
      status: 'pending',
      source,
      actor,
      prompt: source ? `Complete the ${source.displayName} decision.` : 'Complete the authorised item decision.',
      choices,
      responseIdentity: {
        interactionId,
        resolutionId: input.record.operationId,
        windowId: decision.decisionId,
        retryKey: input.record.operationId,
      },
      allowPass: false,
      allowCancel: false,
      expiresAt: null,
      recoveryActions: (input.audience === 'gm' || input.audience === 'diagnostic') ? [{
        action: 'cancel',
        actionId: encounterPresentationStableId('item-recovery', input.record.operationId, 'abandon'),
        label: decision.reservation ? 'Abandon and release item' : 'Abandon item decision',
        enabled: true,
        unavailableReason: null,
      }] : [],
      announcement: {
        announcementId: encounterPresentationStableId('announcement', interactionId),
        priority: 'assertive',
        message: source ? `${source.displayName} requires a decision.` : 'An item requires an authorised decision.',
        dedupeKey: encounterPresentationStableId('pending', interactionId),
      },
    }),
  }
}

const privateSource = (): RuleSourceRef => ({
  sourceKind: 'system',
  canonicalId: 'private-rule',
  instanceId: null,
  displayName: 'Private encounter event',
  referenceHref: null,
})

const genericAccepted = (input: {
  readonly record: StoredItemOperationRecord
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
}): AcceptedEncounterPresentation => {
  const presentationId = encounterPresentationStableId('accepted-item', input.record.operationId)
  const correction = input.record.status === 'corrected'
    && input.record.correctionOfOperationId
    && input.record.recoveryCommand?.action === 'correct'
    ? {
        correctionId: encounterPresentationStableId('item-correction', input.record.operationId),
        correctsPresentationId: encounterPresentationStableId('accepted-item', input.record.correctionOfOperationId),
        reasonLabel: 'The GM corrected a private item operation.',
        rollbackChangeIds: [] as readonly string[],
      }
    : null
  const headline = correction ? 'Encounter item use corrected.' : 'Encounter state changed.'
  return parseAcceptedEncounterPresentation({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId,
    operationId: input.record.operationId,
    mapSlug: input.mapSlug,
    previousRevision: input.previousRevision,
    revision: input.revision,
    source: privateSource(),
    actor: null,
    affectedParticipants: [],
    outcomes: [{
      outcomeId: encounterPresentationStableId('outcome', input.record.operationId, 'private'),
      kind: correction ? 'corrected' : 'accepted', participantId: null,
      label: correction ? 'A private item use was corrected' : 'Encounter state changed',
      tone: correction ? 'warning' : 'neutral', preventedBy: [],
    }],
    changes: [], explanations: [],
    causal: {
      groupId: encounterPresentationStableId('causal', input.record.operationId),
      parentPresentationId: null, depth: 0, sequence: 0,
    },
    headline: { label: headline, description: null, iconKey: 'encounter.private-change', tone: correction ? 'warning' : 'neutral' },
    splash: null,
    vfx: [],
    announcements: [{
      announcementId: encounterPresentationStableId('announcement', input.record.operationId),
      priority: 'polite', message: headline,
      dedupeKey: encounterPresentationStableId('accepted', input.record.operationId),
    }],
    history: [{
      entryId: encounterPresentationStableId('history', input.record.operationId),
      occurredAt: input.record.updatedAt,
      headline, detail: null, tone: correction ? 'warning' : 'neutral', participantIds: [],
    }],
    correction,
  })
}

const operationChangeKind = (operation: PlannedItemOperation): 'hp' | 'condition' | 'stage' | 'resource' | 'effect' | null => {
  if (operation.kind === 'hp') return 'hp'
  if (operation.kind === 'condition') return 'condition'
  if (operation.kind === 'stage') return 'stage'
  if (operation.kind === 'resource') return 'resource'
  if (operation.kind === 'effect') return 'effect'
  if (operation.kind === 'inventory' && operation.payload.action === 'store-digestion-buff') return 'effect'
  return null
}

const acceptedPresentation = (input: {
  readonly record: StoredItemOperationRecord
  readonly map: TabletopMap
  readonly participants: ReadonlyMap<string, EncounterParticipantPresentationRef>
  readonly audience: EncounterWorkspaceAudience
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
}): AcceptedEncounterPresentation | null => {
  if ((input.record.status !== 'accepted' && input.record.status !== 'corrected')
    || input.record.result?.status !== 'accepted' || !input.record.plan) return null
  const before = input.record.command.readSet.find(ref => ref.kind === 'map')
  const after = input.record.result.aggregateRefs.find(ref => ref.kind === 'map')
  if (!before || !after || after.revision <= before.revision || before.id !== input.map.slug || after.id !== input.map.slug) return null
  const controls = controlsActor(input)
  const definition = currentDefinition(input.record)
  const detailed = definition !== null && canViewAudience({
    audience: input.audience,
    privacy: definition.spec.privacy.outcome,
    controlsActor: controls,
  })
  if (!detailed) return genericAccepted({
    record: input.record,
    mapSlug: input.map.slug,
    previousRevision: before.revision,
    revision: after.revision,
  })
  const source: RuleSourceRef = {
    sourceKind: 'item', canonicalId: definition.canonicalId, instanceId: null,
    displayName: definition.canonicalId, referenceHref: `/items/${encodeURIComponent(definition.canonicalId)}`,
  }
  const actor = input.record.command.actorParticipantId
    ? input.participants.get(input.record.command.actorParticipantId) ?? null
    : null
  const targetIds = [...new Set(input.record.command.targetIds)].filter(id => input.participants.has(id))
  const affected = targetIds.filter(id => id !== actor?.participantId).map(id => input.participants.get(id)!)
  const presentedParticipantIds = new Set([...(actor ? [actor.participantId] : []), ...affected.map(value => value.participantId)])
  const changes = input.record.plan.operations.flatMap((operation, index) => {
    const kind = operationChangeKind(operation)
    const participantId = presentedParticipantIds.has(operation.subjectId) ? operation.subjectId : null
    if (!kind || !participantId) return []
    const healing = kind === 'hp' && operation.payload.action === 'heal'
      && Number.isSafeInteger(operation.payload.currentHp)
      && Number.isSafeInteger(operation.payload.resultingHp)
      && Number.isSafeInteger(operation.payload.effectiveHealing)
    const revival = kind === 'hp' && operation.payload.action === 'revive'
      && Number.isSafeInteger(operation.payload.currentHp)
      && Number.isSafeInteger(operation.payload.resultingHp)
    const conditionRemoval = kind === 'condition' && operation.payload.action === 'remove'
      && Array.isArray(operation.payload.removedConditionIds)
      && operation.payload.removedConditionIds.every(value => typeof value === 'string')
      && operation.payload.removedConditionIds.length > 0
    const stageChange = kind === 'stage' && operation.payload.action === 'modify'
      && Number.isSafeInteger(operation.payload.previous)
      && Number.isSafeInteger(operation.payload.current)
      && Number.isSafeInteger(operation.payload.appliedDelta)
    const temporaryEffect = kind === 'effect'
      && operation.payload.action === 'apply-temporary-combat-effect'
      && typeof operation.payload.family === 'string'
    const digestionBuff = kind === 'effect'
      && operation.payload.action === 'store-digestion-buff'
      && typeof operation.payload.canonicalItemId === 'string'
    const removedConditionLabels = conditionRemoval
      ? (operation.payload.removedConditionIds as readonly string[]).join(', ')
      : ''
    return [{
      changeId: encounterPresentationStableId('item-change', input.record.operationId, String(index)),
      kind,
      operation: healing || revival || (stageChange && Number(operation.payload.appliedDelta) > 0)
        ? 'increase' as const
        : stageChange ? 'decrease' as const
          : conditionRemoval ? 'remove' as const
            : temporaryEffect || digestionBuff ? 'add' as const : 'set' as const,
      participantId,
      subjectId: participantId,
      field: kind,
      before: healing || revival || stageChange ? {
        kind: 'number' as const,
        numberValue: stageChange ? Number(operation.payload.previous) : Number(operation.payload.currentHp),
        textValue: null, booleanValue: null, unit: stageChange ? 'stage' : 'HP',
      } : null,
      after: healing || revival || stageChange ? {
        kind: 'number' as const,
        numberValue: stageChange ? Number(operation.payload.current) : Number(operation.payload.resultingHp),
        textValue: null, booleanValue: null, unit: stageChange ? 'stage' : 'HP',
      } : {
        kind: 'text' as const, numberValue: null,
        textValue: conditionRemoval
          ? removedConditionLabels
          : temporaryEffect
            ? String(operation.payload.family).replace(/-/g, ' ')
            : digestionBuff ? 'Digestion Buff' : 'applied',
        booleanValue: null, unit: null,
      },
      delta: healing ? Number(operation.payload.effectiveHealing)
        : revival ? Number(operation.payload.resultingHp) - Number(operation.payload.currentHp)
          : stageChange ? Number(operation.payload.appliedDelta) : null,
      label: healing
        ? boundedCopy(`${operation.payload.effectiveHealing} HP restored${Number(operation.payload.overheal) > 0 ? `; ${operation.payload.overheal} overheal` : ''}`, 'HP restored', 200)
        : revival
          ? boundedCopy(`Revived at ${operation.payload.resultingHp} HP`, 'Revived', 200)
          : conditionRemoval
          ? boundedCopy(`${removedConditionLabels} cured`, 'Condition cured', 200)
          : stageChange
            ? boundedCopy(`Combat Stage ${operation.payload.previous} → ${operation.payload.current} (${Number(operation.payload.appliedDelta) >= 0 ? '+' : ''}${operation.payload.appliedDelta}${operation.payload.capped === true ? '; capped' : ''})`, 'Combat Stage changed', 200)
            : temporaryEffect
              ? boundedCopy(operation.payload.family === 'critical-range'
                  ? `Critical Hit Range +${operation.payload.amount} until encounter end`
                  : `Move-caused stage reductions prevented for ${String((operation.payload.duration as Record<string, unknown>).amount)} turns`,
                'Temporary combat effect applied', 200)
              : digestionBuff
                ? boundedCopy(operation.payload.buffKind === 'fixed-heal'
                    ? `Digestion Buff stored (${operation.payload.amount} HP when traded)`
                    : `Digestion Buff stored (${operation.payload.amount}/${operation.payload.denominator} maximum HP at turn start until encounter end)`,
                  'Digestion Buff stored', 200)
                : boundedCopy(operation.label, 'Item effect applied', 200),
    }]
  })
  const outcomeParticipants = targetIds.length > 0 ? targetIds : actor ? [actor.participantId] : []
  const outcomes = (outcomeParticipants.length > 0 ? outcomeParticipants : [null]).map((participantId, index) => ({
    outcomeId: encounterPresentationStableId('item-outcome', input.record.operationId, String(index)),
    kind: 'accepted' as const,
    participantId,
    label: 'Item applied',
    tone: 'positive' as const,
    preventedBy: [],
  }))
  const correction = input.record.status === 'corrected'
    && input.record.correctionOfOperationId
    && input.record.recoveryCommand?.action === 'correct'
    ? {
        correctionId: encounterPresentationStableId('item-correction', input.record.operationId),
        correctsPresentationId: encounterPresentationStableId(
          'accepted-item',
          input.record.correctionOfOperationId,
        ),
        reasonLabel: boundedCopy(input.record.recoveryCommand.reason, 'The GM corrected this item use.', 500),
        rollbackChangeIds: [] as readonly string[],
      }
    : null
  const healingSummary = input.record.plan.operations.find(operation => operation.kind === 'hp'
    && operation.payload.action === 'heal' && Number.isSafeInteger(operation.payload.effectiveHealing))
  const revivalSummary = input.record.plan.operations.find(operation => operation.kind === 'hp'
    && operation.payload.action === 'revive' && Number.isSafeInteger(operation.payload.resultingHp))
  const conditionSummary = input.record.plan.operations.find(operation => operation.kind === 'condition'
    && operation.payload.action === 'remove' && Array.isArray(operation.payload.removedConditionIds)
    && operation.payload.removedConditionIds.length > 0)
  const stageSummary = input.record.plan.operations.find(operation => operation.kind === 'stage'
    && operation.payload.action === 'modify' && Number.isSafeInteger(operation.payload.current))
  const temporaryEffectSummary = input.record.plan.operations.find(operation => operation.kind === 'effect'
    && operation.payload.action === 'apply-temporary-combat-effect')
  const digestionSummary = input.record.plan.operations.find(operation => operation.kind === 'inventory'
    && operation.payload.action === 'store-digestion-buff')
  const headline = correction
    ? `${definition.canonicalId} use corrected — inventory restored`
    : healingSummary
      ? `${definition.canonicalId} restored ${healingSummary.payload.effectiveHealing} HP${conditionSummary ? ' and cured conditions' : ''}`
      : revivalSummary
        ? `${definition.canonicalId} revived the target at ${revivalSummary.payload.resultingHp} HP`
        : conditionSummary
        ? `${definition.canonicalId} cured ${(conditionSummary.payload.removedConditionIds as readonly string[]).join(', ')}`
        : stageSummary
          ? `${definition.canonicalId} changed the target’s Combat Stage to ${stageSummary.payload.current}`
          : temporaryEffectSummary
            ? `${definition.canonicalId} applied ${String(temporaryEffectSummary.payload.family).replace(/-/g, ' ')}`
            : digestionSummary
              ? `${definition.canonicalId} Digestion Buff stored`
              : `${definition.canonicalId} resolved`
  const presentationId = encounterPresentationStableId('accepted-item', input.record.operationId)
  const historyParticipantIds = [...presentedParticipantIds]
  return parseAcceptedEncounterPresentation({
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    presentationId,
    operationId: input.record.operationId,
    mapSlug: input.map.slug,
    previousRevision: before.revision,
    revision: after.revision,
    source,
    actor,
    affectedParticipants: affected,
    outcomes: correction ? [{
      outcomeId: encounterPresentationStableId('item-outcome', input.record.operationId, 'corrected'),
      kind: 'corrected', participantId: actor?.participantId ?? null,
      label: 'Item use corrected; consumed inventory restored', tone: 'warning', preventedBy: [],
    }] : outcomes,
    changes: correction ? [] : changes,
    explanations: [],
    causal: {
      groupId: encounterPresentationStableId('causal', input.record.operationId),
      parentPresentationId: null, depth: 0, sequence: 0,
    },
    headline: { label: headline, description: null, iconKey: 'source.item', tone: correction ? 'warning' : 'positive' },
    splash: { label: definition.spec.presentation.label, description: null, iconKey: 'source.item', tone: correction ? 'warning' : 'positive' },
    vfx: [{
      vfxId: encounterPresentationStableId('item-vfx', input.record.operationId),
      kind: healingSummary || revivalSummary ? 'healing' : 'status',
      sourceParticipantId: actor?.participantId ?? null,
      targetParticipantIds: targetIds,
      cells: [], tone: correction ? 'warning' : 'positive', duration: 'short', reducedMotionKind: 'static',
      label: correction ? 'Item correction' : 'Item effect',
    }],
    announcements: [{
      announcementId: encounterPresentationStableId('announcement', input.record.operationId),
      priority: 'polite', message: headline,
      dedupeKey: encounterPresentationStableId('accepted', input.record.operationId),
    }],
    history: [{
      entryId: encounterPresentationStableId('history', input.record.operationId),
      occurredAt: input.record.updatedAt,
      headline,
      detail: correction ? 'The correction restored the consumed item and reversed only unchanged accepted effects.' : null,
      tone: correction ? 'warning' : 'positive',
      participantIds: historyParticipantIds,
    }],
    correction,
  })
}

/** Project durable item decisions and receipts without exposing inventory mechanics to unauthorized viewers. */
export const projectItemOperationPresentations = (input: {
  readonly records: readonly StoredItemOperationRecord[]
  readonly audience: EncounterWorkspaceAudience
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly map: TabletopMap
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}): ProjectedItemOperationPresentations => {
  const participants = encounterItemParticipantDirectory(input)
  const pending: EncounterPendingInteractionView[] = []
  const accepted: AcceptedEncounterPresentation[] = []
  const authorizedInteractionIds: string[] = []
  for (const record of input.records) {
    if (record.command.context !== 'encounter') continue
    const pendingValue = pendingPresentation({ ...input, record, participants })
    if (pendingValue) {
      pending.push(pendingValue.view)
      if (pendingValue.authorized) authorizedInteractionIds.push(pendingValue.view.interactionId)
    }
    const acceptedValue = acceptedPresentation({ ...input, record, participants })
    if (acceptedValue) accepted.push(acceptedValue)
  }
  return Object.freeze({
    pending: Object.freeze(pending),
    accepted: Object.freeze(accepted),
    authorizedInteractionIds: Object.freeze(authorizedInteractionIds),
  })
}
