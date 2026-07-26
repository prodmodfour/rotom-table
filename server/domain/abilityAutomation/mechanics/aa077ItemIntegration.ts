import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import { parseMoveItemReference, type MoveItemReference } from '#shared/moveAutomation/items'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import type { AuthoritativeAbilityContext } from '../context'
import { resolveMoveAutomationItemRuleIdentity } from '../../moveAutomation/itemRuleData'
import { planMoveItemMutations } from '../../moveAutomation/planItemMutations'
import type { MoveItemMutation } from '../../moveAutomation/itemMutationTypes'
import { createMoveStateChangePlan, type MoveStateChangePlan } from '../../moveAutomation/plan'

export interface Aa077VoluntaryDropSlot {
  readonly branchId: string
  readonly canonicalItemId: string
  readonly canonicalItemName: string
  readonly reference: MoveItemReference
}

const sourceOwner = (
  kind: 'pokemon' | 'trainer',
  slug: string,
  revision: number,
) => ({ kind: 'sheet' as const, sheetKind: kind, slug, revision: normalizeRevision(revision) })

/** Enumerate bounded opaque equipped slots; item names remain server-side. */
export const aa077VoluntaryDropSlots = (input: {
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheet: CharacterSheet | TrainerSheet
  readonly onlyCanonicalItemId?: string
}): readonly Aa077VoluntaryDropSlot[] => {
  const revision = normalizeRevision(input.sheet.revision)
  const names = input.sheetKind === 'pokemon'
    ? splitSheetItemNames((input.sheet as CharacterSheet).items?.held)
    : splitSheetItemNames((input.sheet as TrainerSheet).equipmentSlots?.accessory)
  return Object.freeze(names.flatMap((name, index) => {
    const identity = resolveMoveAutomationItemRuleIdentity(name)
    if (!identity || (input.onlyCanonicalItemId && identity.canonicalItemId !== input.onlyCanonicalItemId)) {
      return []
    }
    const reference = parseMoveItemReference(input.sheetKind === 'pokemon'
      ? {
          schemaVersion: 1,
          kind: 'pokemon-held',
          itemId: `held:${index + 1}`,
          canonicalItemId: identity.canonicalItemId,
          owner: sourceOwner('pokemon', input.sheet.slug, revision),
          quantity: 1,
          stack: 'singleton',
          equip: 'pokemon-held',
        }
      : {
          schemaVersion: 1,
          kind: 'trainer-equipment-slot',
          itemId: `slot:accessory:${index + 1}`,
          canonicalItemId: identity.canonicalItemId,
          owner: sourceOwner('trainer', input.sheet.slug, revision),
          slot: 'accessory',
          quantity: 1,
          stack: 'singleton',
          equip: 'trainer-slot',
        })
    return [{
      branchId: `equipped.${index + 1}`,
      canonicalItemId: identity.canonicalItemId,
      canonicalItemName: identity.canonicalItemName,
      reference,
    }]
  }))
}

const sheetMaps = (context: AuthoritativeAbilityContext): {
  readonly pokemon: ReadonlyMap<string, CharacterSheet>
  readonly trainer: ReadonlyMap<string, TrainerSheet>
} => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const placement of context.map.placements) {
    const resolved = context.queries.sheets.forPlacement(placement)
    if (!resolved) continue
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

/** Plan one voluntary equipped-item drop through the typed item reducer. */
export const planAa077VoluntaryDrop = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly map: TabletopMap
  readonly operationId: string
  readonly branchId: string
  readonly onlyCanonicalItemId?: string
}): { readonly plan: MoveStateChangePlan; readonly currentMap: TabletopMap } => {
  const slot = aa077VoluntaryDropSlots({
    sheetKind: input.context.actor.sheet.kind,
    sheet: input.context.actor.sheet.sheet,
    ...(input.onlyCanonicalItemId ? { onlyCanonicalItemId: input.onlyCanonicalItemId } : {}),
  }).find(candidate => candidate.branchId === input.branchId)
  if (!slot) throw new Error('Selected equipped item is no longer available to drop.')
  const stableHash = createHash('sha256')
    .update(`${input.operationId}\u0000${slot.reference.itemId}`)
    .digest('hex').slice(0, 24)
  const mutation: MoveItemMutation = {
    id: `ability.aa077.drop.${stableHash}`,
    kind: 'ground-item-add',
    reasonCode: 'ability.aa077.voluntary-item-drop',
    source: slot.reference,
    destination: {
      kind: 'map-ground-item',
      owner: {
        kind: 'map', slug: input.map.slug,
        revision: normalizeRevision(input.map.revision),
      },
      itemId: `ground.item.${stableHash}`,
      position: { ...input.context.actor.placement.position },
      sideId: input.context.actor.placement.sideId ?? null,
      ownerPlacementId: input.context.actor.placement.id,
    },
    quantity: 1,
  }
  const maps = sheetMaps(input.context)
  const planned = planMoveItemMutations({
    map: input.map,
    pokemonSheets: maps.pokemon,
    trainerSheets: maps.trainer,
    groupInventories: new Map(),
    operations: [mutation],
    originOperationId: `op_aa077_drop_${stableHash}`,
    plannedAt: input.context.time,
  })
  if (!planned.operationResults.some(result => result.operationId === mutation.id)) {
    throw new Error('Voluntary item drop did not produce one applied item mutation.')
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(planned.stateChanges.changes.filter(change => change.kind === 'sheet-state')),
    currentMap: planned.nextMap,
  })
}
