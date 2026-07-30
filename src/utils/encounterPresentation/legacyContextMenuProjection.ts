import type { EncounterPresentationProjection, EncounterRuleSourceKind } from '#shared/encounterPresentation'
import type { MoveAttackSourceId } from '#shared/moveAutomation/attackSource'

const key = (value: string): string => value.trim().toLocaleLowerCase()

const availableSourceNamesByActor = (
  projection: EncounterPresentationProjection,
  sourceKind: EncounterRuleSourceKind,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const mutable = new Map<string, Set<string>>()
  for (const offer of projection.offers) {
    if (offer.source.sourceKind !== sourceKind || offer.availability.status !== 'available') continue
    const values = mutable.get(offer.actor.participantId) ?? new Set<string>()
    values.add(key(offer.source.canonicalId))
    values.add(key(offer.source.displayName))
    mutable.set(offer.actor.participantId, values)
  }
  return new Map([...mutable].map(([actorId, values]) => [actorId, values as ReadonlySet<string>]))
}

export const contextMenuOptionsFromEncounterOffers = <Option extends { readonly name: string }>(input: {
  readonly projection: EncounterPresentationProjection
  readonly sourceKind: EncounterRuleSourceKind
  readonly optionsByParticipantId: Readonly<Record<string, readonly Option[]>>
}): Record<string, Option[]> => {
  const namesByActor = availableSourceNamesByActor(input.projection, input.sourceKind)
  return Object.fromEntries(Object.entries(input.optionsByParticipantId).map(([participantId, options]) => {
    const names = namesByActor.get(participantId) ?? new Set<string>()
    return [participantId, options.filter(option => names.has(key(option.name)))]
  }))
}

export const contextMenuMoveOptionsFromEncounterOffers = <Option extends {
  readonly name: string
  readonly attackSourceId?: MoveAttackSourceId
}>(input: {
  readonly projection: EncounterPresentationProjection
  readonly optionsByParticipantId: Readonly<Record<string, readonly Option[]>>
}): Record<string, Option[]> => {
  const offersByActor = new Map<string, typeof input.projection.offers>()
  for (const offer of input.projection.offers) {
    if (offer.source.sourceKind !== 'move' || offer.availability.status !== 'available') continue
    offersByActor.set(offer.actor.participantId, [
      ...(offersByActor.get(offer.actor.participantId) ?? []),
      offer,
    ])
  }
  return Object.fromEntries(Object.entries(input.optionsByParticipantId).map(([participantId, options]) => {
    const offers = offersByActor.get(participantId) ?? []
    return [participantId, options.filter(option => offers.some(offer => (
      key(offer.source.canonicalId) === key(option.name)
      && offer.source.instanceId === (option.attackSourceId ?? null)
    )))]
  }))
}

export const contextMenuAbilityOptionsFromEncounterOffers = <Option extends {
  readonly name: string
  readonly instanceId: string | null
  readonly canonicalId: string
}>(input: {
  readonly projection: EncounterPresentationProjection
  readonly optionsByParticipantId: Readonly<Record<string, readonly Option[]>>
}): Record<string, Option[]> => {
  const offersByActor = new Map<string, typeof input.projection.offers>()
  for (const offer of input.projection.offers) {
    if (offer.source.sourceKind !== 'ability' || offer.availability.status !== 'available') continue
    offersByActor.set(offer.actor.participantId, [
      ...(offersByActor.get(offer.actor.participantId) ?? []),
      offer,
    ])
  }
  return Object.fromEntries(Object.entries(input.optionsByParticipantId).map(([participantId, options]) => {
    const offers = offersByActor.get(participantId) ?? []
    return [participantId, options.filter(option => offers.some(offer => (
      (offer.source.instanceId !== null && offer.source.instanceId === option.instanceId)
      || key(offer.source.canonicalId) === key(option.canonicalId)
    )))]
  }))
}

export const contextMenuItemOptionsFromEncounterAffordances = <Option extends { readonly name: string }>(input: {
  readonly projection: EncounterPresentationProjection
  readonly optionsByParticipantId: Readonly<Record<string, readonly Option[]>>
}): Record<string, Option[]> => {
  const itemNamesByActor = new Map<string, Set<string>>()
  for (const affordance of input.projection.affordances) {
    if (affordance.source.sourceKind !== 'item' || affordance.actor === null) continue
    const names = itemNamesByActor.get(affordance.actor.participantId) ?? new Set<string>()
    names.add(key(affordance.source.canonicalId))
    names.add(key(affordance.source.displayName))
    itemNamesByActor.set(affordance.actor.participantId, names)
  }
  const captureActors = new Set(input.projection.offers
    .filter(offer => offer.intent.actionId === 'capture.throw' && offer.availability.status === 'available')
    .map(offer => offer.actor.participantId))
  return Object.fromEntries(Object.entries(input.optionsByParticipantId).map(([participantId, options]) => {
    const itemNames = itemNamesByActor.get(participantId) ?? new Set<string>()
    return [participantId, captureActors.has(participantId)
      ? options.filter(option => itemNames.has(key(option.name)))
      : []]
  }))
}
