import type { EquipmentActionId } from './equipmentActions'

export interface EquipmentActionPresentationV1 {
  readonly actionId: EquipmentActionId
  readonly canonicalItemId: string
  readonly label: string
  readonly timingLabel: string
  /** Public, reviewed summary only. Exact custody and private evidence are never included. */
  readonly summary: string
  readonly targetLabel: string
}

export const EQUIPMENT_ACTION_PRESENTATIONS: readonly EquipmentActionPresentationV1[] = Object.freeze([
  Object.freeze({
    actionId: 'equipment.light-shield.ready',
    canonicalItemId: 'Light Shield',
    label: 'Ready Light Shield',
    timingLabel: 'Standard Action',
    summary: 'Gain +2 Evasion and +10 Damage Reduction and become Slowed through the end of the next turn.',
    targetLabel: 'Self',
  }),
  Object.freeze({
    actionId: 'equipment.heavy-shield.ready',
    canonicalItemId: 'Heavy Shield',
    label: 'Ready Heavy Shield',
    timingLabel: 'Standard Action',
    summary: 'Gain +4 Evasion and +15 Damage Reduction and become Slowed through the end of the next turn.',
    targetLabel: 'Self',
  }),
  Object.freeze({
    actionId: 'equipment.shock-collar.activate',
    canonicalItemId: 'Shock Collar',
    label: 'Activate Shock Collar',
    timingLabel: 'Standard Action',
    summary: 'Apply the reviewed one-sixth maximum HP loss to the exact paired, eligible wearer.',
    targetLabel: 'Paired wearer',
  }),
  Object.freeze({
    actionId: 'equipment.glue-cannon.attack',
    canonicalItemId: 'Glue Cannon',
    label: 'Fire Glue Cannon',
    timingLabel: 'Standard Action',
    summary: 'Spend one charge on an AC 8 status attack within 4 meters; a hit Slows and a critical hit also Sticks and Traps.',
    targetLabel: 'Participant within 4 meters',
  }),
  Object.freeze({
    actionId: 'equipment.hand-net.attack',
    canonicalItemId: 'Hand Net',
    label: 'Use Hand Net',
    timingLabel: 'Standard Action',
    summary: 'Make an AC 6 melee status attack against an eligible Small Pokémon; a hit nets and Traps it.',
    targetLabel: 'Adjacent Small Pokémon',
  }),
  Object.freeze({
    actionId: 'equipment.weighted-nets.throw',
    canonicalItemId: 'Weighted Nets',
    label: 'Throw Weighted Net',
    timingLabel: 'Standard Action',
    summary: 'Make an AC 8 status attack within 4 meters; a hit nets and Slows the Pokémon and suppresses airborne movement.',
    targetLabel: 'Pokémon within 4 meters',
  }),
  Object.freeze({
    actionId: 'equipment.weighted-nets.pull',
    canonicalItemId: 'Weighted Nets',
    label: 'Pull Weighted Net',
    timingLabel: 'Standard Action',
    summary: 'Pull a Pokémon netted by this exact source one legal meter toward the wielder.',
    targetLabel: 'Pokémon netted by this source',
  }),
  Object.freeze({
    actionId: 'equipment.fishing.old-rod',
    canonicalItemId: 'Old Rod',
    label: 'Fish with Old Rod',
    timingLabel: '15-minute Extended Action',
    summary: 'Choose an adjacent authoritative water cell and create a bounded GM fishing resolution after 15 campaign minutes.',
    targetLabel: 'Adjacent water cell',
  }),
  Object.freeze({
    actionId: 'equipment.fishing.good-rod',
    canonicalItemId: 'Good Rod',
    label: 'Fish with Good Rod',
    timingLabel: '15-minute Extended Action',
    summary: 'Choose an adjacent authoritative water cell and create a bounded GM fishing resolution after 15 campaign minutes.',
    targetLabel: 'Adjacent water cell',
  }),
  Object.freeze({
    actionId: 'equipment.fishing.super-rod',
    canonicalItemId: 'Super Rod',
    label: 'Fish with Super Rod',
    timingLabel: '15-minute Extended Action',
    summary: 'Choose an adjacent authoritative water cell and create a bounded GM fishing resolution after 15 campaign minutes.',
    targetLabel: 'Adjacent water cell',
  }),
  Object.freeze({
    actionId: 'equipment.snag-machine.convert',
    canonicalItemId: 'Snag Machine',
    label: 'Prepare Snag Ball',
    timingLabel: 'Swift Action or Large-machine conversion',
    summary: 'Reserve one reviewed Poké Ball for a bounded GM legality decision using the current Portable or Large machine authority.',
    targetLabel: 'Reviewed Poké Ball',
  }),
])

const BY_ACTION_ID = new Map(EQUIPMENT_ACTION_PRESENTATIONS.map(row => [row.actionId, row] as const))
const BY_ITEM_ID = new Map<string, readonly EquipmentActionPresentationV1[]>()
for (const row of EQUIPMENT_ACTION_PRESENTATIONS) {
  BY_ITEM_ID.set(row.canonicalItemId, Object.freeze([...(BY_ITEM_ID.get(row.canonicalItemId) ?? []), row]))
}

export const equipmentActionPresentation = (
  actionId: EquipmentActionId,
): EquipmentActionPresentationV1 => BY_ACTION_ID.get(actionId)!

export const equipmentActionPresentationsForItem = (
  canonicalItemId: string | null | undefined,
): readonly EquipmentActionPresentationV1[] => canonicalItemId ? BY_ITEM_ID.get(canonicalItemId) ?? [] : []

export const equipmentEncounterContinuationLabel = (
  canonicalItemId: string | null | undefined,
): string | null => {
  const rows = equipmentActionPresentationsForItem(canonicalItemId)
  if (rows.length === 0) return null
  const actions = rows.map(row => row.label).join(' or ')
  return canonicalItemId === 'Snag Machine'
    ? `Use ${actions} from a live encounter Action Dock; the server will bind the current Portable or Large machine custody.`
    : `Equip this item in its required slots, then use ${actions} from the live encounter Action Dock.`
}
