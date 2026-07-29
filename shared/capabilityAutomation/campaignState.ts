import {
  RARE_CANDY_ITEM_ID,
  RARE_CANDY_ITEM_NAME,
  SHUCKLES_BERRY_JUICE_ITEM_ID,
  SHUCKLES_BERRY_JUICE_ITEM_NAME,
  canonicalPtuBerryId,
} from './items'

export const CAPABILITY_CAMPAIGN_STATE_SCHEMA_VERSION = 1 as const

export interface CapabilityStoredItemState {
  /** Stable identity of the one physical item moving from held custody into the shell. */
  readonly id: string
  readonly kind: 'juicer'
  /** Stable item-catalog ID, never a display label. */
  readonly canonicalItemId: string
  readonly stage: 'berry' | 'berry-juice' | 'rare-candy'
  /** Start of the current stage (Berry custody, shell juice, or Rare Candy). */
  readonly storedAt: number
  /** Start of the exact continuously-held Berry custody epoch. Retained as provenance after conversion. */
  readonly custodyStartedAt: number
  /** Server-authored stable identity for that custody epoch. */
  readonly custodyFingerprint: string
  readonly remainingDayAdvances: number
  readonly sourceOperationId: string
}

export interface CapabilityPlanterState {
  readonly id: string
  readonly inputCanonicalItemId: string
  readonly plantedCanonicalId: string
  readonly plantedAt: number
  readonly sourceOperationId: string
}

export interface CapabilityLetterPressHiddenPower {
  readonly sourceSheetSlug: string
  readonly attackStat: 'attack' | 'special-attack'
}

export interface CapabilityKeystoneSynchronizationState {
  readonly keystoneId: string
  readonly synchronizedAt: number
  readonly sourceOperationId: string
}

export interface CapabilityMarsupialPouchState {
  readonly motherSheetSlug: string
  readonly babySheetSlug: string
  readonly experienceSharePercent: 0 | 20
  readonly establishedAt: number
  readonly sourceOperationId: string
}

export interface CapabilityLetterPressState {
  readonly combinedUnownCount: number
  readonly statBonuses: Readonly<Partial<Record<'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>>>
  readonly hiddenPowers: readonly CapabilityLetterPressHiddenPower[]
  readonly sourceOperationIds: readonly string[]
}

export interface CapabilityCampaignState {
  readonly schemaVersion: typeof CAPABILITY_CAMPAIGN_STATE_SCHEMA_VERSION
  readonly storedItems: readonly CapabilityStoredItemState[]
  readonly planter: CapabilityPlanterState | null
  readonly keystoneSynchronizations: readonly CapabilityKeystoneSynchronizationState[]
  readonly letterPress: CapabilityLetterPressState | null
  readonly marsupialPouch: CapabilityMarsupialPouchState | null
}

export const createEmptyCapabilityCampaignState = (): CapabilityCampaignState => Object.freeze({
  schemaVersion: 1,
  storedItems: Object.freeze([]),
  planter: null,
  keystoneSynchronizations: Object.freeze([]),
  letterPress: null,
  marsupialPouch: null,
})

export class CapabilityCampaignStateValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityCampaignStateValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new CapabilityCampaignStateValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !expected.has(field))) {
    fail(path, 'has missing or unknown fields.')
  }
}
const text = (value: unknown, path: string, max = 240): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(path, `must be bounded trimmed text (max ${max}).`)
  }
  return value as string
}
const timestamp = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path, 'must be a non-negative safe integer.')
  return value as number
}

export const parseCapabilityCampaignState = (value: unknown): CapabilityCampaignState => {
  if (value == null) return createEmptyCapabilityCampaignState()
  const parsedRoot = record(value, 'capabilityCampaignState')
  const root: UnknownRecord = {
    ...parsedRoot,
    ...(Object.hasOwn(parsedRoot, 'letterPress') ? {} : { letterPress: null }),
    ...(Object.hasOwn(parsedRoot, 'keystoneSynchronizations') ? {} : { keystoneSynchronizations: [] }),
    ...(Object.hasOwn(parsedRoot, 'marsupialPouch') ? {} : { marsupialPouch: null }),
  }
  exact(root, ['schemaVersion', 'storedItems', 'planter', 'keystoneSynchronizations', 'letterPress', 'marsupialPouch'], 'capabilityCampaignState')
  if (root.schemaVersion !== 1) fail('capabilityCampaignState.schemaVersion', 'must be 1.')
  if (!Array.isArray(root.storedItems) || root.storedItems.length > 1) {
    fail('capabilityCampaignState.storedItems', 'must contain at most one exact Juicer shell item.')
  }
  const rawStoredItems = root.storedItems as unknown[]
  const storedItems = rawStoredItems.map((raw, index): CapabilityStoredItemState => {
    const path = `capabilityCampaignState.storedItems[${index}]`
    const item = record(raw, path)
    const hasCustodyStartedAt = Object.hasOwn(item, 'custodyStartedAt')
    const hasCustodyFingerprint = Object.hasOwn(item, 'custodyFingerprint')
    if (hasCustodyStartedAt !== hasCustodyFingerprint) fail(path, 'must contain both custody fields or neither legacy field.')
    exact(item, hasCustodyStartedAt
      ? ['id', 'kind', 'canonicalItemId', 'stage', 'storedAt', 'custodyStartedAt', 'custodyFingerprint', 'remainingDayAdvances', 'sourceOperationId']
      : ['id', 'kind', 'canonicalItemId', 'stage', 'storedAt', 'remainingDayAdvances', 'sourceOperationId'], path)
    if (item.kind !== 'juicer') fail(`${path}.kind`, 'must be juicer.')
    if (item.stage !== 'berry' && item.stage !== 'berry-juice' && item.stage !== 'rare-candy') fail(`${path}.stage`, 'is unsupported.')
    const stage = item.stage as CapabilityStoredItemState['stage']
    const rawCanonicalItemId = text(item.canonicalItemId, `${path}.canonicalItemId`)
    const canonicalItemId = hasCustodyStartedAt
      ? rawCanonicalItemId
      : stage === 'berry'
        ? canonicalPtuBerryId(rawCanonicalItemId)
        : stage === 'berry-juice' && ['Berry Juice', 'Shuckle’s Berry Juice', "Shuckle's Berry Juice", SHUCKLES_BERRY_JUICE_ITEM_ID].includes(rawCanonicalItemId)
          ? SHUCKLES_BERRY_JUICE_ITEM_ID
          : stage === 'rare-candy' && (rawCanonicalItemId === 'Rare Candy' || rawCanonicalItemId === RARE_CANDY_ITEM_ID)
            ? RARE_CANDY_ITEM_ID
            : null
    if (stage === 'berry' ? canonicalPtuBerryId(canonicalItemId ?? '') !== canonicalItemId
      : stage === 'berry-juice' ? canonicalItemId !== SHUCKLES_BERRY_JUICE_ITEM_ID
        : canonicalItemId !== RARE_CANDY_ITEM_ID) {
      fail(`${path}.canonicalItemId`, `is not the legal canonical catalog identity for stage ${stage}.`)
    }
    const remaining = timestamp(item.remainingDayAdvances, `${path}.remainingDayAdvances`)
    if ((stage === 'berry' && remaining !== 1)
      || (stage === 'berry-juice' && (remaining < 1 || remaining > 14))
      || (stage === 'rare-candy' && remaining !== 0)) {
      fail(`${path}.remainingDayAdvances`, `is inconsistent with stage ${stage}.`)
    }
    const storedAt = timestamp(item.storedAt, `${path}.storedAt`)
    const legacyElapsed = stage === 'berry' ? 0 : stage === 'berry-juice' ? JUICER_BERRY_ELAPSED_MS : JUICER_TOTAL_ELAPSED_MS
    const custodyStartedAt = hasCustodyStartedAt
      ? timestamp(item.custodyStartedAt, `${path}.custodyStartedAt`)
      : Math.max(0, storedAt - legacyElapsed)
    if (custodyStartedAt > storedAt) fail(`${path}.custodyStartedAt`, 'must not be after the current stage started.')
    const legalStageStartedAt = stage === 'berry'
      ? custodyStartedAt
      : afterMilliseconds(custodyStartedAt, stage === 'berry-juice'
        ? JUICER_BERRY_ELAPSED_MS
        : JUICER_TOTAL_ELAPSED_MS)
    if (hasCustodyStartedAt && storedAt !== legalStageStartedAt) {
      fail(`${path}.storedAt`, `must equal the canonical elapsed boundary for stage ${stage}.`)
    }
    const id = text(item.id, `${path}.id`)
    const sourceOperationId = text(item.sourceOperationId, `${path}.sourceOperationId`)
    const custodyFingerprint = hasCustodyFingerprint
      ? text(item.custodyFingerprint, `${path}.custodyFingerprint`)
      : `legacy:${stableFingerprint(`${id}:${sourceOperationId}:${custodyStartedAt}`)}`
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/%-]*$/.test(custodyFingerprint)) {
      fail(`${path}.custodyFingerprint`, 'must be a stable custody identifier.')
    }
    return Object.freeze({
      id,
      kind: 'juicer',
      canonicalItemId: canonicalItemId!,
      stage,
      storedAt,
      custodyStartedAt,
      custodyFingerprint,
      remainingDayAdvances: remaining,
      sourceOperationId,
    })
  })
  let planter: CapabilityPlanterState | null = null
  if (root.planter !== null) {
    const raw = record(root.planter, 'capabilityCampaignState.planter')
    exact(raw, ['id', 'inputCanonicalItemId', 'plantedCanonicalId', 'plantedAt', 'sourceOperationId'], 'capabilityCampaignState.planter')
    planter = Object.freeze({
      id: text(raw.id, 'capabilityCampaignState.planter.id'),
      inputCanonicalItemId: text(raw.inputCanonicalItemId, 'capabilityCampaignState.planter.inputCanonicalItemId'),
      plantedCanonicalId: text(raw.plantedCanonicalId, 'capabilityCampaignState.planter.plantedCanonicalId'),
      plantedAt: timestamp(raw.plantedAt, 'capabilityCampaignState.planter.plantedAt'),
      sourceOperationId: text(raw.sourceOperationId, 'capabilityCampaignState.planter.sourceOperationId'),
    })
  }
  if (!Array.isArray(root.keystoneSynchronizations) || root.keystoneSynchronizations.length > 64) {
    fail('capabilityCampaignState.keystoneSynchronizations', 'must be a bounded array.')
  }
  const keystoneSynchronizations = (root.keystoneSynchronizations as unknown[]).map((candidate, index): CapabilityKeystoneSynchronizationState => {
    const path = `capabilityCampaignState.keystoneSynchronizations[${index}]`
    const item = record(candidate, path)
    exact(item, ['keystoneId', 'synchronizedAt', 'sourceOperationId'], path)
    return Object.freeze({
      keystoneId: text(item.keystoneId, `${path}.keystoneId`),
      synchronizedAt: timestamp(item.synchronizedAt, `${path}.synchronizedAt`),
      sourceOperationId: text(item.sourceOperationId, `${path}.sourceOperationId`),
    })
  })
  if (new Set(keystoneSynchronizations.map(entry => entry.keystoneId)).size !== keystoneSynchronizations.length) {
    fail('capabilityCampaignState.keystoneSynchronizations', 'contains duplicate Keystone IDs.')
  }
  let letterPress: CapabilityLetterPressState | null = null
  if (root.letterPress !== null) {
    const raw = record(root.letterPress, 'capabilityCampaignState.letterPress')
    exact(raw, ['combinedUnownCount', 'statBonuses', 'hiddenPowers', 'sourceOperationIds'], 'capabilityCampaignState.letterPress')
    if (!Number.isSafeInteger(raw.combinedUnownCount) || (raw.combinedUnownCount as number) < 2 || (raw.combinedUnownCount as number) > 257) {
      fail('capabilityCampaignState.letterPress.combinedUnownCount', 'must be from 2 through 257.')
    }
    const statBonusesRaw = record(raw.statBonuses, 'capabilityCampaignState.letterPress.statBonuses')
    const statKeys = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd'] as const
    if (Object.keys(statBonusesRaw).some(key => !statKeys.includes(key as typeof statKeys[number]))) {
      fail('capabilityCampaignState.letterPress.statBonuses', 'contains an unknown stat.')
    }
    const statBonuses: Partial<Record<typeof statKeys[number], number>> = {}
    for (const key of statKeys) {
      const bonus = statBonusesRaw[key]
      if (bonus === undefined) continue
      if (!Number.isSafeInteger(bonus) || (bonus as number) < 5 || (bonus as number) > 20 || (bonus as number) % 5 !== 0) {
        fail(`capabilityCampaignState.letterPress.statBonuses.${key}`, 'must be a multiple of 5 from 5 through 20.')
      }
      statBonuses[key] = bonus as number
    }
    if (Object.values(statBonuses).reduce((total, bonus) => total + (bonus ?? 0), 0) > 20) {
      fail('capabilityCampaignState.letterPress.statBonuses', 'may contain at most four five-point increases.')
    }
    if (!Array.isArray(raw.hiddenPowers) || raw.hiddenPowers.length > 6) fail('capabilityCampaignState.letterPress.hiddenPowers', 'must contain at most six entries.')
    const hiddenPowerValues = raw.hiddenPowers as unknown[]
    const hiddenPowers = hiddenPowerValues.map((candidate, index): CapabilityLetterPressHiddenPower => {
      const path = `capabilityCampaignState.letterPress.hiddenPowers[${index}]`
      const item = record(candidate, path)
      exact(item, ['sourceSheetSlug', 'attackStat'], path)
      if (item.attackStat !== 'attack' && item.attackStat !== 'special-attack') fail(`${path}.attackStat`, 'is unsupported.')
      return Object.freeze({
        sourceSheetSlug: text(item.sourceSheetSlug, `${path}.sourceSheetSlug`),
        attackStat: item.attackStat as CapabilityLetterPressHiddenPower['attackStat'],
      })
    })
    if (!Array.isArray(raw.sourceOperationIds) || raw.sourceOperationIds.length > 16) fail('capabilityCampaignState.letterPress.sourceOperationIds', 'must be bounded.')
    const sourceOperationValues = raw.sourceOperationIds as unknown[]
    const sourceOperationIds = sourceOperationValues.map((id, index) => text(id, `capabilityCampaignState.letterPress.sourceOperationIds[${index}]`))
    letterPress = Object.freeze({
      combinedUnownCount: raw.combinedUnownCount as number,
      statBonuses: Object.freeze(statBonuses),
      hiddenPowers: Object.freeze(hiddenPowers),
      sourceOperationIds: Object.freeze(sourceOperationIds),
    })
  }
  let marsupialPouch: CapabilityMarsupialPouchState | null = null
  if (root.marsupialPouch !== null) {
    const raw = record(root.marsupialPouch, 'capabilityCampaignState.marsupialPouch')
    exact(raw, ['motherSheetSlug', 'babySheetSlug', 'experienceSharePercent', 'establishedAt', 'sourceOperationId'], 'capabilityCampaignState.marsupialPouch')
    if (raw.experienceSharePercent !== 0 && raw.experienceSharePercent !== 20) {
      fail('capabilityCampaignState.marsupialPouch.experienceSharePercent', 'must be 0 or 20.')
    }
    const motherSheetSlug = text(raw.motherSheetSlug, 'capabilityCampaignState.marsupialPouch.motherSheetSlug', 120)
    const babySheetSlug = text(raw.babySheetSlug, 'capabilityCampaignState.marsupialPouch.babySheetSlug', 120)
    if (!/^[a-z0-9-]+$/.test(motherSheetSlug) || !/^[a-z0-9-]+$/.test(babySheetSlug)
      || motherSheetSlug === babySheetSlug) {
      fail('capabilityCampaignState.marsupialPouch', 'must contain distinct stable mother and baby sheet slugs.')
    }
    marsupialPouch = Object.freeze({
      motherSheetSlug,
      babySheetSlug,
      experienceSharePercent: raw.experienceSharePercent as 0 | 20,
      establishedAt: timestamp(raw.establishedAt, 'capabilityCampaignState.marsupialPouch.establishedAt'),
      sourceOperationId: text(raw.sourceOperationId, 'capabilityCampaignState.marsupialPouch.sourceOperationId'),
    })
  }
  return Object.freeze({
    schemaVersion: 1,
    storedItems: Object.freeze(storedItems),
    planter,
    keystoneSynchronizations: Object.freeze(keystoneSynchronizations),
    letterPress,
    marsupialPouch,
  })
}

export const JUICER_BERRY_ELAPSED_MS = 24 * 60 * 60_000
export const JUICER_JUICE_ELAPSED_MS = 14 * JUICER_BERRY_ELAPSED_MS
export const JUICER_TOTAL_ELAPSED_MS = JUICER_BERRY_ELAPSED_MS + JUICER_JUICE_ELAPSED_MS

const afterMilliseconds = (timestampValue: number, duration: number): number => (
  Math.min(Number.MAX_SAFE_INTEGER, timestampValue + duration)
)

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
const stableFingerprint = (value: string): string => `${fnv1a32(value)}${fnv1a32([...value].reverse().join(''))}`

export const capabilityCampaignStateHasContent = (state: CapabilityCampaignState): boolean => (
  state.storedItems.length > 0 || state.planter !== null
  || state.keystoneSynchronizations.length > 0 || state.letterPress !== null
  || state.marsupialPouch !== null
)

/** Compatibility-only detection for old snapshots that mirrored shell contents in the held slot. */
export const juicerHeldItemIsLegacyShellMirror = (
  state: CapabilityCampaignState,
  heldItemName: string | null | undefined,
): boolean => {
  const item = state.storedItems[0]
  if (!item || item.stage === 'berry' || !item.custodyFingerprint.startsWith('legacy:')) return false
  const held = (heldItemName ?? '').trim().toLocaleLowerCase('en-US')
  return item.stage === 'berry-juice'
    ? [SHUCKLES_BERRY_JUICE_ITEM_NAME, SHUCKLES_BERRY_JUICE_ITEM_ID, "Shuckle's Berry Juice", 'Berry Juice']
        .some(value => value.toLocaleLowerCase('en-US') === held)
    : [RARE_CANDY_ITEM_NAME, RARE_CANDY_ITEM_ID]
        .some(value => value.toLocaleLowerCase('en-US') === held)
}

export interface ReconcileJuicerHeldItemCustodyInput {
  readonly value: unknown
  readonly sheetSlug: string
  readonly heldItemName: string | null | undefined
  readonly hasJuicer: boolean
  readonly now: number
  readonly sourceOperationId: string
  /** Use only when an authoritative item operation proves replacement despite an unchanged legacy held-item label. */
  readonly forceCustodyReset?: boolean
}

/**
 * Bind a Berry-stage item to one server-owned held-item custody epoch. Converted
 * shell contents are independent from the ordinary held slot and survive both
 * held-item changes and loss of the Capability source.
 */
export const reconcileJuicerHeldItemCustody = (
  input: ReconcileJuicerHeldItemCustodyInput,
): CapabilityCampaignState => {
  if (!Number.isSafeInteger(input.now) || input.now < 0) fail('now', 'must be a non-negative safe integer timestamp.')
  const state = parseCapabilityCampaignState(input.value)
  const current = state.storedItems[0] ?? null
  if (current && current.stage !== 'berry') return state

  const heldBerryId = canonicalPtuBerryId(input.heldItemName ?? '')
  const retainsExactCustody = Boolean(
    current
    && input.hasJuicer
    && heldBerryId === current.canonicalItemId
    && input.forceCustodyReset !== true,
  )
  if (retainsExactCustody) return state

  if (!input.hasJuicer || !heldBerryId) {
    return Object.freeze({ ...state, storedItems: Object.freeze([]) })
  }

  const fingerprintSource = `${input.sheetSlug}:${input.sourceOperationId}:${input.now}:${heldBerryId}`
  const custodyFingerprint = `juicer-custody:${stableFingerprint(fingerprintSource)}`
  const item: CapabilityStoredItemState = Object.freeze({
    id: `juicer-shell:${input.sheetSlug}:${stableFingerprint(`${fingerprintSource}:shell`)}`.slice(0, 240),
    kind: 'juicer',
    canonicalItemId: heldBerryId,
    stage: 'berry',
    storedAt: input.now,
    custodyStartedAt: input.now,
    custodyFingerprint,
    remainingDayAdvances: 1,
    sourceOperationId: input.sourceOperationId,
  })
  return parseCapabilityCampaignState({ ...state, storedItems: [item] })
}

/** Advance Juicer custody against an authoritative wall-clock timestamp. */
export const advanceCapabilityCampaignStateToTime = (
  value: unknown,
  now: number,
): CapabilityCampaignState | null => {
  if (!Number.isSafeInteger(now) || now < 0) fail('now', 'must be a non-negative safe integer timestamp.')
  const state = parseCapabilityCampaignState(value)
  const storedItems = state.storedItems.map((item): CapabilityStoredItemState => {
    if (item.stage === 'rare-candy') return item
    if (item.stage === 'berry') {
      const juiceAt = afterMilliseconds(item.custodyStartedAt, JUICER_BERRY_ELAPSED_MS)
      if (now < juiceAt) return Object.freeze({ ...item, remainingDayAdvances: 1 })
      const candyAt = afterMilliseconds(juiceAt, JUICER_JUICE_ELAPSED_MS)
      if (now >= candyAt) return Object.freeze({
        ...item, canonicalItemId: RARE_CANDY_ITEM_ID, stage: 'rare-candy', storedAt: candyAt, remainingDayAdvances: 0,
      })
      return Object.freeze({
        ...item, canonicalItemId: SHUCKLES_BERRY_JUICE_ITEM_ID, stage: 'berry-juice', storedAt: juiceAt,
        remainingDayAdvances: Math.max(1, Math.min(14, Math.ceil((candyAt - now) / JUICER_BERRY_ELAPSED_MS))),
      })
    }
    const candyAt = afterMilliseconds(item.storedAt, JUICER_JUICE_ELAPSED_MS)
    if (now >= candyAt) return Object.freeze({
      ...item, canonicalItemId: RARE_CANDY_ITEM_ID, stage: 'rare-candy', storedAt: candyAt, remainingDayAdvances: 0,
    })
    return Object.freeze({
      ...item,
      remainingDayAdvances: Math.max(1, Math.min(14, Math.ceil((candyAt - now) / JUICER_BERRY_ELAPSED_MS))),
    })
  })
  const result = Object.freeze({ ...state, storedItems: Object.freeze(storedItems) })
  return capabilityCampaignStateHasContent(result) ? result : null
}

export interface MaterializedJuicerCampaignState {
  readonly state: CapabilityCampaignState
  readonly heldItemName: string
  readonly transitionedFromHeldBerry: boolean
}

/**
 * Materialize elapsed Juicer time and detach the converted Berry from the
 * legacy held slot. Callers still decide when and how the returned state is
 * persisted atomically with their authoritative operation.
 */
export const materializeJuicerCampaignStateAtTime = (input: {
  readonly value: unknown
  readonly heldItemName: string | null | undefined
  readonly now: number
}): MaterializedJuicerCampaignState => {
  const before = parseCapabilityCampaignState(input.value)
  const after = advanceCapabilityCampaignStateToTime(before, input.now) ?? before
  const beforeItem = before.storedItems[0]
  const afterItem = after.storedItems[0]
  const transitionedFromHeldBerry = Boolean(
    beforeItem?.stage === 'berry'
    && afterItem?.id === beforeItem.id
    && afterItem.stage !== 'berry',
  )
  const legacyShellMirror = juicerHeldItemIsLegacyShellMirror(before, input.heldItemName)
  const heldItemName = legacyShellMirror || (transitionedFromHeldBerry
    && canonicalPtuBerryId(input.heldItemName ?? '') === beforeItem?.canonicalItemId)
    ? ''
    : input.heldItemName ?? ''
  return Object.freeze({ state: after, heldItemName, transitionedFromHeldBerry })
}

/** Backward-compatible one-day transition used by isolated state reducers. */
export const advanceCapabilityCampaignStateDay = (value: unknown): CapabilityCampaignState | null => {
  const state = parseCapabilityCampaignState(value)
  const storedItems = state.storedItems.map((item): CapabilityStoredItemState => {
    if (item.stage === 'rare-candy') return item
    const remaining = Math.max(0, item.remainingDayAdvances - 1)
    if (remaining > 0) return Object.freeze({ ...item, remainingDayAdvances: remaining })
    if (item.stage === 'berry') return Object.freeze({
      ...item,
      canonicalItemId: SHUCKLES_BERRY_JUICE_ITEM_ID,
      stage: 'berry-juice',
      storedAt: afterMilliseconds(item.custodyStartedAt, JUICER_BERRY_ELAPSED_MS),
      remainingDayAdvances: 14,
    })
    return Object.freeze({
      ...item,
      canonicalItemId: RARE_CANDY_ITEM_ID,
      stage: 'rare-candy',
      storedAt: afterMilliseconds(item.storedAt, JUICER_JUICE_ELAPSED_MS),
      remainingDayAdvances: 0,
    })
  })
  const result = Object.freeze({ ...state, storedItems: Object.freeze(storedItems) })
  return capabilityCampaignStateHasContent(result) ? result : null
}
