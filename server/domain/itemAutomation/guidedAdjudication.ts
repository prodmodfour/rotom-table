import { createHash } from 'node:crypto'
import guidedCatalogJson from '~~/data/complete-play-loop/guided-catalog-items.v1.json'
import type { AuthRole } from '#shared/auth'
import { encounterPresentationStableId } from '#shared/encounterPresentation'
import {
  ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
  ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_CHOICE_ID,
  ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID,
  ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID,
  ITEM_GUIDED_RE_BREATHER_ACTIVATE_OPTION_ID,
  ITEM_GUIDED_RE_BREATHER_REFILL_OPTION_ID,
  type ItemGuidedReBreatherOfferV1,
  type ItemGuidedRequestProjectionV1,
} from '#shared/itemAutomation/guidedAdjudication'
import { parseSheetEquipmentStateForOwner, type EquipmentOwnerKind } from '#shared/itemAutomation/equipment'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type {
  StoredItemGuidedAuthorityV1,
  StoredItemGuidedCommonAuthorityV1,
  StoredItemGuidedRequestRecord,
} from '../../storage/itemGuidedRequestRepository'
import { equipmentGrantDefinitionFor } from './equipmentGrantRegistry'
import { currentReviewedReBreatherState } from './reBreatherLifecycle'

interface GuidedCatalogRow {
  readonly canonicalId: string
  readonly canonicalRecordSha256: string
  readonly canonicalEffectSha256: string
  readonly prompt: string
  readonly canonicalFacts: readonly string[]
  readonly settlementFacts: readonly string[]
  readonly consumption: {
    readonly quantity: number
    readonly reusable: boolean
  }
}
const guidedCatalog = guidedCatalogJson as unknown as {
  readonly schemaVersion: 1
  readonly status: 'reviewed'
  readonly decision: {
    readonly choiceId: string
    readonly optionId: string
    readonly optionLabel: string
    readonly decisionRole: 'gm'
    readonly freeformMechanics: false
  }
  readonly items: readonly GuidedCatalogRow[]
}
const guidedCatalogById = new Map(guidedCatalog.items.map(row => [row.canonicalId, row]))
if (guidedCatalog.schemaVersion !== 1 || guidedCatalog.status !== 'reviewed'
  || guidedCatalog.decision.choiceId !== ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID
  || guidedCatalog.decision.optionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID
  || guidedCatalog.decision.decisionRole !== 'gm'
  || guidedCatalog.decision.freeformMechanics !== false
  || guidedCatalogById.size !== guidedCatalog.items.length) {
  throw new Error('Reviewed guided catalog item authority is malformed or duplicated.')
}

const displayName = (kind: EquipmentOwnerKind, sheet: CharacterSheet | TrainerSheet): string => kind === 'trainer'
  ? (sheet as TrainerSheet).name?.trim() || sheet.slug
  : (sheet as CharacterSheet).nickname?.trim() || (sheet as CharacterSheet).species?.trim() || sheet.slug

const fixedHealing = (definition: ItemRuntimeDefinition): number | null => {
  const healing = definition.spec.effects.find(effect => effect.operation === 'heal-hp')
  return healing?.operation === 'heal-hp' && healing.restoration.amount.kind === 'fixed'
    ? healing.restoration.amount.amount : null
}

const deterministicFact = (definition: ItemRuntimeDefinition): string => {
  const healing = fixedHealing(definition)
  if (healing !== null) return `Restores ${healing} HP up to the effective maximum when accepted.`
  const revival = definition.spec.effects.find(effect => effect.operation === 'revive')
  if (revival) return 'Revives a Fainted Pokémon at half its full formula maximum HP, capped by Injuries, when accepted.'
  const removal = definition.spec.effects.find(effect => effect.operation === 'remove-conditions')
  if (removal?.operation === 'remove-conditions' && removal.mode === 'persistent') {
    return 'Cures every applicable Persistent Status Affliction when accepted.'
  }
  const treatment = definition.spec.effects.find(effect => effect.operation === 'apply-medical-treatment')
  if (treatment) return 'Applies the reviewed six-hour treatment with half-hour healing and its bounded Injury completion rule.'
  throw new Error(`Guided item ${definition.canonicalId} has no reviewed deterministic settlement fact.`)
}

export const buildGuidedItemOperationAuthority = (input: {
  readonly definition: ItemRuntimeDefinition
  readonly itemOperationId: string
  readonly decisionId: string
  readonly targetChoiceId: string
  readonly actorLabel: string
  readonly targetLabel: string
  readonly targetKind: 'pokemon' | 'trainer'
  readonly sourceDisplayLabel: string
}): StoredItemGuidedAuthorityV1 => {
  if (input.definition.spec.implementationState !== 'guided') {
    throw new Error('Only a reviewed guided ItemSpec can create guided item authority.')
  }
  const campaignToolChoice = input.definition.spec.choices.find(choice => (
    choice.choiceId === ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID && choice.privateTo === 'gm'
  ))
  if (campaignToolChoice) {
    const policy = guidedCatalogById.get(input.definition.canonicalId)
    if (!policy
      || policy.canonicalRecordSha256 !== input.definition.spec.evidence.canonicalRecordSha256
      || policy.canonicalEffectSha256 !== input.definition.spec.evidence.canonicalEffectSha256
      || input.targetKind !== 'trainer'
      || campaignToolChoice.options.length !== 1
      || campaignToolChoice.options[0]?.optionId !== ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID) {
      throw new Error('The reviewed guided campaign-tool authority changed or is incomplete.')
    }
    return Object.freeze({
      schemaVersion: 1,
      sourceKind: 'item-operation',
      itemOperationId: input.itemOperationId,
      decisionId: input.decisionId,
      targetChoiceId: input.targetChoiceId,
      campaignToolChoiceId: ITEM_GUIDED_CAMPAIGN_TOOL_CHOICE_ID,
      actorLabel: input.actorLabel,
      targetLabel: input.targetLabel,
      timingLabel: input.definition.spec.costs.some(cost => cost.kind === 'action')
        ? 'Standard Action' : 'Campaign action',
      prompt: policy.prompt,
      canonicalFacts: Object.freeze([...policy.canonicalFacts]),
      settlementFacts: Object.freeze([...policy.settlementFacts]),
      reservationLabel: policy.consumption.reusable
        ? `Exact reusable ${input.sourceDisplayLabel} bound`
        : `${policy.consumption.quantity} ${input.sourceDisplayLabel} reserved`,
      boundaryLabel: 'No action cost, source disposition, target effect, or decision receipt settles until the GM accepts.',
    })
  }
  if (!input.definition.spec.choices.some(choice => choice.choiceId === ITEM_GUIDED_LOYALTY_CHOICE_ID
    && choice.privateTo === 'gm')) {
    throw new Error('Guided ItemSpec has no reviewed bounded GM decision authority.')
  }
  const fact = deterministicFact(input.definition)
  const consume = input.definition.spec.consumption.quantity
  return Object.freeze({
    schemaVersion: 1,
    sourceKind: 'item-operation',
    itemOperationId: input.itemOperationId,
    decisionId: input.decisionId,
    targetChoiceId: input.targetChoiceId,
    loyaltyChoiceId: ITEM_GUIDED_LOYALTY_CHOICE_ID,
    actorLabel: input.actorLabel,
    targetLabel: input.targetLabel,
    timingLabel: input.definition.spec.timing === 'extended' ? 'Extended Action completion' : 'Standard Action',
    prompt: input.targetKind === 'pokemon'
      ? `How does this ${input.definition.canonicalId} use affect Loyalty?`
      : `Record the reviewed no-Loyalty-change outcome for this Trainer use.`,
    canonicalFacts: Object.freeze([
      fact,
      input.targetKind === 'pokemon'
        ? 'Persistent Repulsive Medicine use may lower Loyalty at GM discretion.'
        : 'Trainer targets have no Pokémon Loyalty Rank to change.',
    ]),
    settlementFacts: Object.freeze([
      fact,
      `Consume ${consume} reserved ${input.sourceDisplayLabel}.`,
      'Record the bounded GM decision privately.',
    ]),
    reservationLabel: `${consume} ${input.sourceDisplayLabel} reserved`,
    boundaryLabel: 'No deterministic effect, Loyalty change, action cost, or inventory consumption occurs until the GM accepts.',
  })
}

const choicesFor = (record: StoredItemGuidedRequestRecord, role: AuthRole): ItemGuidedRequestProjectionV1['choices'] => {
  if (role !== 'gm' || record.status !== 'pending') return Object.freeze([])
  if (record.requestKind === 'loyalty-consequence') return Object.freeze([
    Object.freeze({
      optionId: ITEM_GUIDED_LOYALTY_NO_CHANGE_OPTION_ID,
      label: 'Record use; no Loyalty Rank change',
      description: 'Apply the deterministic item effect and record no Loyalty Rank change.',
    }),
    ...(record.targetKind === 'pokemon' ? [Object.freeze({
      optionId: ITEM_GUIDED_LOYALTY_DECREASE_OPTION_ID,
      label: 'Lower Loyalty by 1',
      description: 'Apply the deterministic item effect and lower current Loyalty by exactly 1, to a minimum of 0.',
    })] : []),
  ])
  if (record.requestKind === 'campaign-tool-adjudication') return Object.freeze([Object.freeze({
    optionId: ITEM_GUIDED_CAMPAIGN_TOOL_ACCEPT_OPTION_ID,
    label: guidedCatalog.decision.optionLabel,
    description: 'Settle the exact reviewed source disposition and record this bounded GM decision.',
  })])
  if (record.requestKind === 're-breather-activation') return Object.freeze([Object.freeze({
    optionId: ITEM_GUIDED_RE_BREATHER_ACTIVATE_OPTION_ID,
    label: 'Activate for one hour',
    description: 'Grant Gilled from this exact equipped Re-Breather for 60 campaign minutes.',
  })])
  return Object.freeze([Object.freeze({
    optionId: ITEM_GUIDED_RE_BREATHER_REFILL_OPTION_ID,
    label: 'Begin open-air refill',
    description: 'Confirm open air now; the exact Re-Breather becomes ready after 5 campaign minutes.',
  })])
}

export const projectItemGuidedRequest = (input: {
  readonly record: StoredItemGuidedRequestRecord
  readonly role: AuthRole
}): ItemGuidedRequestProjectionV1 => {
  const { record } = input
  return Object.freeze({
    schemaVersion: 1,
    requestId: record.requestId,
    revision: record.revision,
    status: record.status,
    requestKind: record.requestKind,
    canonicalItemId: record.canonicalItemId,
    itemLabel: record.canonicalItemId,
    actorLabel: record.authority.actorLabel,
    targetLabel: record.authority.targetLabel,
    targetKindLabel: record.targetKind === 'pokemon' ? 'Pokémon' : 'Trainer',
    timingLabel: record.authority.timingLabel,
    prompt: record.authority.prompt,
    canonicalFacts: record.authority.canonicalFacts,
    choices: choicesFor(record, input.role),
    settlementFacts: record.authority.settlementFacts,
    reservationLabel: record.authority.reservationLabel,
    boundaryLabel: record.authority.boundaryLabel,
    canCancel: record.status === 'pending',
    acceptedSummary: record.result?.acceptedSummary ?? null,
  })
}

export const reBreatherGuidedCommonAuthority = (input: {
  readonly actionKind: 'activate' | 'begin-open-air-refill'
  readonly ownerLabel: string
}): StoredItemGuidedCommonAuthorityV1 => input.actionKind === 'activate'
  ? Object.freeze({
      actorLabel: input.ownerLabel,
      targetLabel: input.ownerLabel,
      timingLabel: 'Standard Action',
      prompt: 'Confirm this exact equipped Re-Breather activation.',
      canonicalFacts: Object.freeze([
        'Grants the Gilled Capability for 60 campaign minutes when accepted.',
        'The reservoir must refill for 5 campaign minutes in GM-confirmed open air after depletion.',
      ]),
      settlementFacts: Object.freeze([
        'Activate Gilled on this self target for 60 campaign minutes.',
        'Retain the exact equipped Re-Breather; no inventory is consumed.',
        'Record the GM confirmation privately.',
      ]),
      reservationLabel: 'Exact equipped Re-Breather reserved',
      boundaryLabel: 'No Capability, equipment state, action, or campaign-clock change occurs until the GM accepts.',
    })
  : Object.freeze({
      actorLabel: input.ownerLabel,
      targetLabel: input.ownerLabel,
      timingLabel: 'Open-air refill',
      prompt: 'Confirm that this exact equipped Re-Breather is now in open air.',
      canonicalFacts: Object.freeze([
        'A depleted Re-Breather refills automatically after 5 campaign minutes in open air.',
        'Open-air authority must be confirmed by the GM; elapsed time is never inferred from client state.',
      ]),
      settlementFacts: Object.freeze([
        'Start the exact Re-Breather’s 5-minute open-air refill interval.',
        'Retain the exact equipped Re-Breather; no inventory is consumed.',
        'Record the GM confirmation privately.',
      ]),
      reservationLabel: 'Exact equipped Re-Breather reserved',
      boundaryLabel: 'No refill interval, equipment state, action, or campaign-clock change occurs until the GM accepts.',
    })

export interface GuidedReBreatherOfferAuthority {
  readonly offer: ItemGuidedReBreatherOfferV1
  readonly instanceId: string
  readonly instanceRevision: number
  readonly equipmentRevision: number
  readonly sheetRevision: number
  readonly actionKind: 'activate' | 'begin-open-air-refill'
}

export const buildItemGuidedReBreatherOffers = (input: {
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly sheet: CharacterSheet | TrainerSheet
  readonly sheetRevision: number
  readonly campaignClockRevision: number
  readonly campaignMinute: number
  readonly pendingRecords: readonly StoredItemGuidedRequestRecord[]
}): readonly GuidedReBreatherOfferAuthority[] => {
  if (input.sheet.equipmentState === undefined) return Object.freeze([])
  const state = parseSheetEquipmentStateForOwner(input.sheet.equipmentState, {
    kind: input.ownerKind,
    slug: input.ownerSlug,
  })
  const definition = equipmentGrantDefinitionFor('Re-Breather')
  if (!definition || !definition.grants.some(grant => grant.kind === 'action'
    && grant.actionId === 'equipment.re-breather.activate' && grant.executionStatus === 'native')) return Object.freeze([])
  const ownerLabel = displayName(input.ownerKind, input.sheet)
  return Object.freeze(state.instances.flatMap((instance): readonly GuidedReBreatherOfferAuthority[] => {
    if (instance.canonicalItemId !== 'Re-Breather'
      || instance.activity.status !== 'active'
      || instance.canonicalRecordSha256 !== definition.canonicalRecordSha256
      || instance.equipmentDefinitionSha256 !== definition.equipmentDefinitionSha256) return []
    const slots = state.slots.filter(slot => slot.instanceId === instance.instanceId).map(slot => slot.slotId)
    if ((input.ownerKind === 'trainer' && (slots.length !== 1 || slots[0] !== 'head'))
      || (input.ownerKind === 'pokemon' && (slots.length !== 1 || slots[0] !== 'held'))) return []
    let reBreather
    try {
      reBreather = currentReviewedReBreatherState({
        serializedState: instance.serializedState,
        campaignMinute: input.campaignMinute,
      })
    }
    catch { return [] }
    const actionKind = reBreather.mode === 'depleted' || reBreather.mode === 'refilling'
      ? 'begin-open-air-refill' as const : 'activate' as const
    const pending = input.pendingRecords.some(record => record.status === 'pending'
      && record.authority.sourceKind === 'equipped-re-breather'
      && record.authority.instanceId === instance.instanceId)
    const modeUnavailable = reBreather.mode === 'active'
      ? `Active through campaign minute ${reBreather.activeUntilCampaignMinute}.`
      : reBreather.mode === 'refilling'
        ? `Open-air refill completes at campaign minute ${reBreather.refillCompletesAtCampaignMinute}.`
        : null
    const unavailableReason = pending ? 'A guided request already reserves this Re-Breather.' : modeUnavailable
    const offerId = encounterPresentationStableId(
      'guided-re-breather', input.ownerKind, input.ownerSlug,
      createHash('sha256').update(instance.instanceId).digest('hex').slice(0, 16),
      String(input.sheetRevision), String(state.revision), String(instance.revision),
      String(input.campaignClockRevision), actionKind,
    )
    const offer: ItemGuidedReBreatherOfferV1 = Object.freeze({
      schemaVersion: 1,
      offerId,
      canonicalItemId: 'Re-Breather',
      itemLabel: 'Re-Breather',
      ownerKind: input.ownerKind,
      ownerSlug: input.ownerSlug,
      ownerLabel,
      actionKind,
      actionLabel: actionKind === 'activate' ? 'Activate Re-Breather' : 'Begin open-air refill',
      timingLabel: actionKind === 'activate' ? 'Standard Action' : 'Open-air refill',
      statusLabel: reBreather.mode === 'ready' ? 'Ready · 60 minutes'
        : reBreather.mode === 'active' ? `Active until minute ${reBreather.activeUntilCampaignMinute}`
          : reBreather.mode === 'depleted' ? 'Depleted · open air required'
            : `Refilling until minute ${reBreather.refillCompletesAtCampaignMinute}`,
      enabled: unavailableReason === null,
      unavailableReason,
    })
    return [{
      offer,
      instanceId: instance.instanceId,
      instanceRevision: instance.revision,
      equipmentRevision: state.revision,
      sheetRevision: input.sheetRevision,
      actionKind,
    }]
  }))
}
