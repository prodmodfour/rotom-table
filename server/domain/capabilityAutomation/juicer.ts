import {
  materializeJuicerCampaignStateAtTime,
  parseCapabilityCampaignState,
  type CapabilityStoredItemState,
} from '#shared/capabilityAutomation/campaignState'
import {
  SHUCKLES_BERRY_JUICE_ITEM_ID,
  SHUCKLES_BERRY_JUICE_ITEM_NAME,
  canonicalPtuBerryId,
  canonicalPtuBerryName,
} from '#shared/capabilityAutomation/items'
import { findItem } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'

export const pokemonHasAuthoritativeJuicerIdentity = (sheet: CharacterSheet): boolean => (
  sheet.species.trim().toLocaleLowerCase('en-US') === 'shuckle'
  && pokemonHasResolvedCapability(sheet, 'Juicer')
)

const digestionBuffNames = (sheet: CharacterSheet): readonly string[] | null => {
  const legacy = sheet.items?.digestionFood
  const extras = sheet.items?.digestionFoods
  if (legacy !== undefined && legacy !== null && legacy !== ''
    && (typeof legacy !== 'string' || !legacy.trim())) return null
  if (extras !== undefined && (!Array.isArray(extras) || extras.length > 3
    || extras.some(name => typeof name !== 'string' || !name.trim()))) return null
  const names = [
    ...(typeof legacy === 'string' && legacy.trim() ? [legacy.trim()] : []),
    ...((extras ?? []).map(name => name.trim())),
  ]
  if (names.length > 3 || names.some(name => !findItem(name) && !canonicalPtuBerryName(name))) return null
  return Object.freeze(names)
}

/** Resolve elapsed Juicer state without trusting a stale Berry whose held custody is already absent. */
export const materializeJuicerSheetAtTime = (sheet: CharacterSheet, now: number): CharacterSheet => {
  const before = parseCapabilityCampaignState(sheet.capabilityCampaignState)
  const beforeItem = before.storedItems[0]
  if (beforeItem?.stage === 'berry'
    && canonicalPtuBerryId(sheet.items?.held ?? '') !== beforeItem.canonicalItemId) return sheet
  const materialized = materializeJuicerCampaignStateAtTime({
    value: before,
    heldItemName: sheet.items?.held,
    now,
  })
  return {
    ...sheet,
    capabilityCampaignState: materialized.state,
    ...(materialized.transitionedFromHeldBerry
      ? { items: { ...(sheet.items ?? {}), held: materialized.heldItemName } }
      : {}),
  }
}

export const juicerShellOutput = (sheet: CharacterSheet, now: number): CapabilityStoredItemState | null => {
  const item = parseCapabilityCampaignState(
    materializeJuicerSheetAtTime(sheet, now).capabilityCampaignState,
  ).storedItems[0] ?? null
  return item && item.stage !== 'berry' ? item : null
}

export const juicerShellJuice = (sheet: CharacterSheet, now: number): CapabilityStoredItemState | null => {
  const item = juicerShellOutput(sheet, now)
  return item?.stage === 'berry-juice' && item.canonicalItemId === SHUCKLES_BERRY_JUICE_ITEM_ID ? item : null
}

export const juicerOfferAuthorityIdentity = (
  sheet: CharacterSheet,
  actionId: string,
  now: number,
  linkedTrainerSlugs: readonly string[] = [],
): string | null => {
  const item = actionId === 'consume-juicer-shell-juice-as-snack'
    ? juicerShellJuice(sheet, now)
    : actionId === 'collect-juicer-output' ? juicerShellOutput(sheet, now) : null
  const linkedAuthority = actionId === 'collect-juicer-output'
    ? `:linked-trainers:${[...new Set(linkedTrainerSlugs)].sort().join(',')}`
    : ''
  return item
    ? `${item.id}:${item.stage}:${item.canonicalItemId}:${item.storedAt}:${item.custodyStartedAt}:${item.custodyFingerprint}:${item.remainingDayAdvances}:${item.sourceOperationId}${linkedAuthority}`
    : null
}

const juicerSnackCapacity = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: CharacterSheet
}): 1 | 3 => effectiveRuntimeAbilityIds(input).includes('Gluttony') ? 3 : 1

export const juicerCanConsumeShellJuiceAsSnack = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: CharacterSheet
  readonly now: number
}): boolean => {
  if (!juicerShellJuice(input.sheet, input.now)) return false
  const names = digestionBuffNames(input.sheet)
  return names !== null && names.length < juicerSnackCapacity(input)
}

/** Move the exact shell juice into Shuckle's normal Digestion Buff storage. */
export const withJuicerShellJuiceSnack = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: CharacterSheet
  readonly now: number
}): CharacterSheet => {
  const sheet = materializeJuicerSheetAtTime(input.sheet, input.now)
  const names = digestionBuffNames(sheet)
  const capacity = juicerSnackCapacity({ ...input, sheet })
  if (!juicerShellJuice(sheet, input.now)) throw new Error('The exact Shuckle’s Berry Juice shell item is unavailable.')
  if (names === null || names.length >= capacity) throw new Error('Shuckle has no legal Digestion Buff slot for shell juice.')
  const items = { ...(sheet.items ?? {}) }
  if (capacity === 1) {
    items.digestionFood = SHUCKLES_BERRY_JUICE_ITEM_NAME
    delete items.digestionFoods
  }
  else {
    delete items.digestionFood
    items.digestionFoods = [...names, SHUCKLES_BERRY_JUICE_ITEM_NAME]
  }
  return { ...sheet, items }
}
