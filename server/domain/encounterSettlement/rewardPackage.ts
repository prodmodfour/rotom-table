import { createHash } from 'node:crypto'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAllocationDestination,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
  type EncounterSettlementRewardLine,
  type EncounterSettlementRewardPayload,
} from '#shared/encounterSettlement/document'

export const ENCOUNTER_SETTLEMENT_REWARD_KINDS = [
  'experience', 'money', 'item', 'capture', 'narrative',
] as const
export type EncounterSettlementRewardKind = typeof ENCOUNTER_SETTLEMENT_REWARD_KINDS[number]

export const ENCOUNTER_SETTLEMENT_REWARD_WRITE_FIELDS = [
  'experience', 'money', 'inventory-stack', 'serialized-equipment',
  'capture-destination', 'narrative-fact',
] as const
export type EncounterSettlementRewardWriteField =
  typeof ENCOUNTER_SETTLEMENT_REWARD_WRITE_FIELDS[number]

export const ENCOUNTER_SETTLEMENT_REWARD_CAPACITY_METRICS = [
  'unbounded', 'quantity', 'slots', 'team-slots', 'fact-slots',
] as const
export type EncounterSettlementRewardCapacityMetric =
  typeof ENCOUNTER_SETTLEMENT_REWARD_CAPACITY_METRICS[number]

export const ENCOUNTER_SETTLEMENT_REWARD_DESTINATION_RULES = Object.freeze({
  experience: Object.freeze(['group', 'side', 'participant', 'pokemon-sheet'] as const),
  money: Object.freeze(['group', 'side', 'participant', 'trainer-inventory', 'group-inventory'] as const),
  item: Object.freeze(['group', 'side', 'participant', 'trainer-inventory', 'group-inventory'] as const),
  capture: Object.freeze(['participant', 'profile'] as const),
  narrative: Object.freeze(['group', 'side', 'participant', 'profile'] as const),
} satisfies Readonly<Record<EncounterSettlementRewardKind, readonly EncounterSettlementAllocationDestination['kind'][]>>)

export const ENCOUNTER_SETTLEMENT_REWARD_METHOD_RULES = Object.freeze({
  experience: Object.freeze(['fixed', 'weighted', 'individual'] as const),
  money: Object.freeze(['fixed', 'weighted', 'individual'] as const),
  item: Object.freeze(['fixed', 'whole'] as const),
  capture: Object.freeze(['whole'] as const),
  narrative: Object.freeze(['whole'] as const),
} satisfies Readonly<Record<EncounterSettlementRewardKind, readonly EncounterSettlementAllocation['method'][]>>)

export interface EncounterSettlementRewardPermissionAuthority {
  readonly status: 'allowed' | 'denied'
  readonly authority: EncounterSettlementAuthorityRef
  readonly reasonId: string | null
}

export type EncounterSettlementRewardCapacity =
  | {
      readonly metric: 'unbounded'
      readonly limit: null
      readonly used: null
    }
  | {
      readonly metric: Exclude<EncounterSettlementRewardCapacityMetric, 'unbounded'>
      readonly limit: number
      readonly used: number
    }

export interface EncounterSettlementRewardWriteAuthority {
  readonly sourceWriteId: string
  readonly allocationId: string
  readonly targetAuthority: EncounterSettlementAuthorityRef
  readonly field: EncounterSettlementRewardWriteField
  readonly amount: number
  readonly countsTowardAllocation: boolean
  readonly capacityCost: number
}

export interface EncounterSettlementRewardDestinationAuthority {
  readonly destination: EncounterSettlementAllocationDestination
  readonly permission: EncounterSettlementRewardPermissionAuthority
  readonly capacity: EncounterSettlementRewardCapacity
  readonly writes: readonly EncounterSettlementRewardWriteAuthority[]
}

export interface EncounterSettlementRewardAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly destinations: readonly EncounterSettlementRewardDestinationAuthority[]
}

export const ENCOUNTER_SETTLEMENT_REWARD_VALIDATION_ISSUE_KINDS = [
  'unallocated',
  'amount-mismatch',
  'unsupported-destination',
  'unsupported-method',
  'stale-destination',
  'permission-denied',
  'capacity-exceeded',
  'missing-write-preview',
  'write-preview-mismatch',
] as const
export type EncounterSettlementRewardValidationIssueKind =
  typeof ENCOUNTER_SETTLEMENT_REWARD_VALIDATION_ISSUE_KINDS[number]

export interface EncounterSettlementRewardValidationIssue {
  readonly issueId: string
  readonly kind: EncounterSettlementRewardValidationIssueKind
  readonly rewardId: string
  readonly allocationId: string | null
  readonly destination: EncounterSettlementAllocationDestination | null
}

export interface EncounterSettlementRewardWritePreview {
  readonly previewId: string
  readonly rewardId: string
  readonly allocationId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly targetAuthority: EncounterSettlementAuthorityRef
  readonly field: EncounterSettlementRewardWriteField
  readonly amount: number
  readonly countsTowardAllocation: boolean
  readonly capacityCost: number
  readonly nextRevision: number
}

export interface EncounterSettlementRewardPackagePlan {
  readonly eligible: boolean
  readonly document: EncounterSettlementDocument
  readonly rewardPackage: EncounterSettlementDocument['rewardPackage']
  readonly allocations: readonly EncounterSettlementAllocation[]
  readonly writePreviews: readonly EncounterSettlementRewardWritePreview[]
  readonly issues: readonly EncounterSettlementRewardValidationIssue[]
}

export type EncounterSettlementRewardPackageErrorCode =
  | 'incomplete-authority'
  | 'invalid-destination-authority'
  | 'duplicate-destination-authority'
  | 'invalid-permission-authority'
  | 'invalid-capacity-authority'
  | 'invalid-write-authority'
  | 'duplicate-write-authority'
  | 'foreign-allocation-authority'
  | 'terminal-reward-state'

export class EncounterSettlementRewardPackageError extends Error {
  constructor(
    readonly code: EncounterSettlementRewardPackageErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementRewardPackageError'
  }
}

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const AUTHORITY_KINDS = new Set([
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
])
const DESTINATION_KINDS = new Set([
  'group', 'side', 'participant', 'trainer-inventory', 'pokemon-sheet',
  'group-inventory', 'profile',
])
const WRITE_FIELDS = new Set<string>(ENCOUNTER_SETTLEMENT_REWARD_WRITE_FIELDS)
const CAPACITY_METRICS = new Set<string>(ENCOUNTER_SETTLEMENT_REWARD_CAPACITY_METRICS)

const fail = (
  code: EncounterSettlementRewardPackageErrorCode,
  path: string,
  message: string,
): never => {
  throw new EncounterSettlementRewardPackageError(code, path, message)
}

const isStableId = (value: unknown): value is string => (
  typeof value === 'string' && STABLE_ID.test(value)
)

const authorityKey = (authority: EncounterSettlementAuthorityRef): string => (
  `${authority.kind}\u0000${authority.id}\u0000${authority.revision}`
)

const destinationIdentity = (
  destination: Pick<EncounterSettlementAllocationDestination, 'kind' | 'id'>,
): string => `${destination.kind}\u0000${destination.id}`

const destinationKey = (destination: EncounterSettlementAllocationDestination): string => (
  `${destinationIdentity(destination)}\u0000${destination.revision}`
)

const cloneAuthority = (
  authority: EncounterSettlementAuthorityRef,
  path: string,
): EncounterSettlementAuthorityRef => {
  if (!authority || !AUTHORITY_KINDS.has(authority.kind) || !isStableId(authority.id)
    || !Number.isSafeInteger(authority.revision) || authority.revision < 0) {
    return fail('invalid-destination-authority', path, 'must be one exact supported authority reference.')
  }
  return Object.freeze({ kind: authority.kind, id: authority.id, revision: authority.revision })
}

const cloneDestination = (
  destination: EncounterSettlementAllocationDestination,
  path: string,
): EncounterSettlementAllocationDestination => {
  if (!destination || !DESTINATION_KINDS.has(destination.kind) || !isStableId(destination.id)
    || !Number.isSafeInteger(destination.revision) || destination.revision < 0) {
    return fail('invalid-destination-authority', path, 'must be one exact supported reward destination.')
  }
  return Object.freeze({ kind: destination.kind, id: destination.id, revision: destination.revision })
}

const hashIdentity = (prefix: string, ...values: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  values.forEach(value => hash.update('\u0000').update(value))
  return `${prefix}:${hash.digest('hex')}`
}

const rewardKind = (payload: EncounterSettlementRewardPayload): EncounterSettlementRewardKind => payload.kind

const expectedRewardAmount = (line: EncounterSettlementRewardLine): number => {
  if (line.payload.kind === 'experience' || line.payload.kind === 'money') return line.payload.amount
  if (line.payload.kind === 'item') return line.payload.quantity
  return 1
}

const expectedWriteField = (line: EncounterSettlementRewardLine): EncounterSettlementRewardWriteField => {
  if (line.payload.kind === 'item') return line.payload.serialized ? 'serialized-equipment' : 'inventory-stack'
  if (line.payload.kind === 'capture') return 'capture-destination'
  if (line.payload.kind === 'narrative') return 'narrative-fact'
  return line.payload.kind
}

const validWriteAuthorityKind = (
  field: EncounterSettlementRewardWriteField,
  kind: EncounterSettlementAuthorityRef['kind'],
): boolean => {
  if (field === 'experience') return kind === 'sheet'
  if (field === 'money') return kind === 'sheet' || kind === 'group-inventory'
  if (field === 'inventory-stack' || field === 'serialized-equipment') {
    return kind === 'sheet' || kind === 'group-inventory'
  }
  if (field === 'capture-destination') return kind === 'capture-operation' || kind === 'sheet'
  return kind === 'encounter-document' || kind === 'objective' || kind === 'phase'
}

const parsePermission = (
  permission: EncounterSettlementRewardPermissionAuthority,
  path: string,
): EncounterSettlementRewardPermissionAuthority => {
  if (!permission || (permission.status !== 'allowed' && permission.status !== 'denied')) {
    return fail('invalid-permission-authority', path, 'must have one allowed or denied status.')
  }
  if ((permission.status === 'denied') !== (permission.reasonId !== null)
    || (permission.reasonId !== null && !isStableId(permission.reasonId))) {
    return fail('invalid-permission-authority', `${path}.reasonId`, 'is required only as one stable denied reason.')
  }
  return Object.freeze({
    status: permission.status,
    authority: cloneAuthority(permission.authority, `${path}.authority`),
    reasonId: permission.reasonId,
  })
}

const parseCapacity = (
  capacity: EncounterSettlementRewardCapacity,
  path: string,
): EncounterSettlementRewardCapacity => {
  if (!capacity || !CAPACITY_METRICS.has(capacity.metric)) {
    return fail('invalid-capacity-authority', path, 'must use one supported capacity metric.')
  }
  if (capacity.metric === 'unbounded') {
    if (capacity.limit !== null || capacity.used !== null) {
      return fail('invalid-capacity-authority', path, 'unbounded capacity cannot contain limit or usage.')
    }
    return Object.freeze({ metric: 'unbounded', limit: null, used: null })
  }
  if (!Number.isSafeInteger(capacity.limit) || capacity.limit < 0
    || !Number.isSafeInteger(capacity.used) || capacity.used < 0 || capacity.used > capacity.limit) {
    return fail('invalid-capacity-authority', path, 'bounded capacity requires safe usage from zero through its limit.')
  }
  return Object.freeze({ metric: capacity.metric, limit: capacity.limit, used: capacity.used })
}

const parseWrite = (
  write: EncounterSettlementRewardWriteAuthority,
  path: string,
): EncounterSettlementRewardWriteAuthority => {
  if (!write || !isStableId(write.sourceWriteId) || !isStableId(write.allocationId)
    || !WRITE_FIELDS.has(write.field)
    || typeof write.countsTowardAllocation !== 'boolean'
    || !Number.isSafeInteger(write.amount) || write.amount < 0
    || (write.countsTowardAllocation ? write.amount < 1 : write.amount !== 0)
    || !Number.isSafeInteger(write.capacityCost) || write.capacityCost < 0) {
    return fail('invalid-write-authority', path, 'must be one bounded write whose positive allocation amount or zero related-write amount is explicit.')
  }
  const targetAuthority = cloneAuthority(write.targetAuthority, `${path}.targetAuthority`)
  if (!validWriteAuthorityKind(write.field, targetAuthority.kind)
    || targetAuthority.revision >= Number.MAX_SAFE_INTEGER) {
    return fail('invalid-write-authority', path, 'uses an unsupported target authority or cannot advance its revision.')
  }
  return Object.freeze({
    sourceWriteId: write.sourceWriteId,
    allocationId: write.allocationId,
    targetAuthority,
    field: write.field,
    amount: write.amount,
    countsTowardAllocation: write.countsTowardAllocation,
    capacityCost: write.capacityCost,
  })
}

const parseDestinationAuthority = (
  value: EncounterSettlementRewardDestinationAuthority,
  path: string,
): EncounterSettlementRewardDestinationAuthority => {
  const destination = cloneDestination(value.destination, `${path}.destination`)
  const permission = parsePermission(value.permission, `${path}.permission`)
  const capacity = parseCapacity(value.capacity, `${path}.capacity`)
  if (!Array.isArray(value.writes) || value.writes.length > 4_096) {
    return fail('invalid-write-authority', `${path}.writes`, 'must be one bounded write list.')
  }
  const writes = value.writes.map((write, index) => parseWrite(write, `${path}.writes[${index}]`))
  const sourceIds = writes.map(write => write.sourceWriteId)
  const targetFields = writes.map(write => `${write.allocationId}\u0000${authorityKey(write.targetAuthority)}\u0000${write.field}`)
  if (new Set(sourceIds).size !== sourceIds.length || new Set(targetFields).size !== targetFields.length) {
    return fail('duplicate-write-authority', `${path}.writes`, 'must not contain duplicate source-write or allocation target-field identities.')
  }
  return Object.freeze({ destination, permission, capacity, writes: Object.freeze(writes) })
}

const issue = (input: {
  readonly settlementId: string
  readonly kind: EncounterSettlementRewardValidationIssueKind
  readonly rewardId: string
  readonly allocationId?: string | null
  readonly destination?: EncounterSettlementAllocationDestination | null
}): EncounterSettlementRewardValidationIssue => Object.freeze({
  issueId: hashIdentity(
    'settlement-reward-issue:v1',
    input.settlementId,
    input.kind,
    input.rewardId,
    input.allocationId ?? '-',
    input.destination ? destinationKey(input.destination) : '-',
  ),
  kind: input.kind,
  rewardId: input.rewardId,
  allocationId: input.allocationId ?? null,
  destination: input.destination ?? null,
})

const destinationParticipantIsCurrent = (
  settlement: EncounterSettlementDocument,
  destination: EncounterSettlementAllocationDestination,
): boolean => {
  if (destination.kind === 'participant') {
    return settlement.participants.some(participant => participant.participantId === destination.id)
  }
  if (destination.kind === 'side') {
    return settlement.participants.some(participant => participant.sideId === destination.id)
  }
  if (destination.kind === 'pokemon-sheet') {
    return settlement.participants.some(participant => (
      participant.sheetKind === 'pokemon' && participant.sheetSlug === destination.id
    ))
  }
  return true
}

const allocationMethodSupported = (
  line: EncounterSettlementRewardLine,
  allocation: EncounterSettlementAllocation,
): boolean => {
  if (!ENCOUNTER_SETTLEMENT_REWARD_METHOD_RULES[rewardKind(line.payload)].includes(allocation.method as never)) {
    return false
  }
  if ((line.payload.kind === 'capture' || line.payload.kind === 'narrative'
    || (line.payload.kind === 'item' && line.payload.serialized))) {
    return allocation.method === 'whole' && allocation.amount === 1
  }
  return true
}

const deduplicateIssues = (
  issues: readonly EncounterSettlementRewardValidationIssue[],
): readonly EncounterSettlementRewardValidationIssue[] => Object.freeze(
  [...new Map(issues.map(entry => [entry.issueId, entry] as const)).values()]
    .sort((left, right) => left.issueId.localeCompare(right.issueId)),
)

export const planEncounterSettlementRewardPackage = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementRewardAuthoritySnapshot
}): EncounterSettlementRewardPackagePlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.rewardPackage.status === 'committed' || settlement.rewardPackage.status === 'cancelled'
    || settlement.rewardPackage.lines.some(line => line.disposition === 'committed')
    || settlement.allocations.some(allocation => allocation.state === 'applied')) {
    return fail('terminal-reward-state', 'settlement.rewardPackage', 'cannot re-plan rewards after commit or cancellation has begun.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current'
    || !Array.isArray(input.authority.destinations)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current destination authority read.')
  }

  const allocationById = new Map(settlement.allocations.map(allocation => [allocation.allocationId, allocation] as const))
  const requiredDestinationIdentities = new Set(settlement.allocations
    .filter(allocation => allocation.state !== 'excluded')
    .map(allocation => destinationIdentity(allocation.destination)))
  const destinationAuthorities = input.authority.destinations.map((entry, index) => (
    parseDestinationAuthority(entry, `authority.destinations[${index}]`)
  ))
  const authoritiesByIdentity = new Map<string, EncounterSettlementRewardDestinationAuthority>()
  for (const authority of destinationAuthorities) {
    const identity = destinationIdentity(authority.destination)
    if (authoritiesByIdentity.has(identity)) {
      fail('duplicate-destination-authority', 'authority.destinations', 'must contain only one current authority per destination identity.')
    }
    if (!requiredDestinationIdentities.has(identity)) {
      fail('foreign-allocation-authority', 'authority.destinations', 'cannot include authority or writes for an undeclared allocation destination.')
    }
    for (const write of authority.writes) {
      const allocation = allocationById.get(write.allocationId)
      if (!allocation || destinationIdentity(allocation.destination) !== identity) {
        fail('foreign-allocation-authority', 'authority.destinations.writes', 'write authority must belong to one declared allocation at this destination.')
      }
    }
    authoritiesByIdentity.set(identity, authority)
  }
  const allSourceWriteIds = destinationAuthorities.flatMap(authority => authority.writes.map(write => write.sourceWriteId))
  if (new Set(allSourceWriteIds).size !== allSourceWriteIds.length) {
    fail('duplicate-write-authority', 'authority.destinations', 'source-write identities must be unique across the complete destination read.')
  }

  const issues: EncounterSettlementRewardValidationIssue[] = []
  const previews: EncounterSettlementRewardWritePreview[] = []
  const allocationIssueKinds = new Map<string, Set<EncounterSettlementRewardValidationIssueKind>>()
  const addIssue = (
    kind: EncounterSettlementRewardValidationIssueKind,
    rewardId: string,
    allocation: EncounterSettlementAllocation | null,
  ): void => {
    issues.push(issue({
      settlementId: settlement.settlementId,
      kind,
      rewardId,
      allocationId: allocation?.allocationId,
      destination: allocation?.destination,
    }))
    if (allocation) {
      const kinds = allocationIssueKinds.get(allocation.allocationId) ?? new Set()
      kinds.add(kind)
      allocationIssueKinds.set(allocation.allocationId, kinds)
    }
  }

  for (const authority of destinationAuthorities) {
    if (authority.capacity.metric === 'unbounded') continue
    const requested = authority.writes.reduce((sum, write) => sum + write.capacityCost, 0)
    if (!Number.isSafeInteger(requested)
      || requested > authority.capacity.limit - authority.capacity.used) {
      const allocations = settlement.allocations.filter(allocation => (
        allocation.state !== 'excluded'
        && destinationIdentity(allocation.destination) === destinationIdentity(authority.destination)
      ))
      allocations.forEach(allocation => addIssue('capacity-exceeded', allocation.rewardId, allocation))
    }
  }

  const lineById = new Map(settlement.rewardPackage.lines.map(line => [line.rewardId, line] as const))
  for (const allocation of settlement.allocations) {
    const line = lineById.get(allocation.rewardId)!
    if (allocation.state === 'excluded') continue
    const kind = rewardKind(line.payload)
    if (!ENCOUNTER_SETTLEMENT_REWARD_DESTINATION_RULES[kind].includes(allocation.destination.kind as never)
      || !destinationParticipantIsCurrent(settlement, allocation.destination)) {
      addIssue('unsupported-destination', line.rewardId, allocation)
    }
    if (!allocationMethodSupported(line, allocation)) addIssue('unsupported-method', line.rewardId, allocation)
    const authority = authoritiesByIdentity.get(destinationIdentity(allocation.destination))
    if (!authority) {
      addIssue('missing-write-preview', line.rewardId, allocation)
      continue
    }
    if (authority.destination.revision !== allocation.destination.revision) {
      addIssue('stale-destination', line.rewardId, allocation)
    }
    if (authority.permission.status === 'denied') addIssue('permission-denied', line.rewardId, allocation)
    const writes = authority.writes.filter(write => write.allocationId === allocation.allocationId)
    if (writes.length === 0) {
      addIssue('missing-write-preview', line.rewardId, allocation)
      continue
    }
    const expectedField = expectedWriteField(line)
    const contributingWrites = writes.filter(write => write.countsTowardAllocation)
    const amount = contributingWrites.reduce((sum, write) => sum + write.amount, 0)
    const oneWholeWrite = line.payload.kind === 'capture' || line.payload.kind === 'narrative'
      || (line.payload.kind === 'item' && line.payload.serialized)
    const mismatched = amount !== allocation.amount
      || writes.some(write => write.field !== expectedField)
      || (oneWholeWrite && (contributingWrites.length !== 1 || contributingWrites[0]!.amount !== 1))
      || ((expectedField === 'serialized-equipment' || expectedField === 'capture-destination')
        && (contributingWrites.some(write => write.capacityCost !== 1)
          || writes.some(write => !write.countsTowardAllocation && write.capacityCost !== 0)))
    if (mismatched) addIssue('write-preview-mismatch', line.rewardId, allocation)
    for (const write of writes) {
      previews.push(Object.freeze({
        previewId: hashIdentity(
          'settlement-reward-preview:v1',
          settlement.settlementId,
          allocation.allocationId,
          write.sourceWriteId,
          authorityKey(write.targetAuthority),
        ),
        rewardId: line.rewardId,
        allocationId: allocation.allocationId,
        destination: allocation.destination,
        targetAuthority: write.targetAuthority,
        field: write.field,
        amount: write.amount,
        countsTowardAllocation: write.countsTowardAllocation,
        capacityCost: write.capacityCost,
        nextRevision: write.targetAuthority.revision + 1,
      }))
    }
  }

  const lineAmountValid = new Map<string, boolean>()
  for (const line of settlement.rewardPackage.lines) {
    const allocations = settlement.allocations.filter(allocation => (
      allocation.rewardId === line.rewardId && allocation.state !== 'excluded'
    ))
    if (line.disposition === 'excluded') {
      if (allocations.length > 0) allocations.forEach(allocation => addIssue('amount-mismatch', line.rewardId, allocation))
      lineAmountValid.set(line.rewardId, allocations.length === 0)
      continue
    }
    if (allocations.length === 0) {
      addIssue('unallocated', line.rewardId, null)
      lineAmountValid.set(line.rewardId, false)
      continue
    }
    const total = allocations.reduce((sum, allocation) => sum + allocation.amount, 0)
    const expected = expectedRewardAmount(line)
    const wholeCountInvalid = allocations.some(allocation => allocation.method === 'whole')
      && (allocations.length !== 1 || total !== expected)
    const valid = Number.isSafeInteger(total) && total === expected && !wholeCountInvalid
    if (!valid) allocations.forEach(allocation => addIssue('amount-mismatch', line.rewardId, allocation))
    lineAmountValid.set(line.rewardId, valid)
  }

  const finalIssues = deduplicateIssues(issues)
  const finalAllocations = settlement.allocations.map((allocation) => {
    if (allocation.state === 'excluded') return allocation
    const valid = lineAmountValid.get(allocation.rewardId) === true
      && (allocationIssueKinds.get(allocation.allocationId)?.size ?? 0) === 0
    return Object.freeze({
      ...allocation,
      state: valid ? 'ready' as const : 'proposed' as const,
      receiptId: null,
    })
  })
  const allocationsByReward = new Map<string, readonly EncounterSettlementAllocation[]>()
  settlement.rewardPackage.lines.forEach((line) => {
    allocationsByReward.set(line.rewardId, finalAllocations.filter(allocation => allocation.rewardId === line.rewardId))
  })
  const finalLines = settlement.rewardPackage.lines.map((line) => {
    if (line.disposition === 'excluded') return line
    const allocations = allocationsByReward.get(line.rewardId) ?? []
    const allocated = lineAmountValid.get(line.rewardId) === true
      && allocations.length > 0
      && allocations.every(allocation => allocation.state === 'ready' || allocation.state === 'excluded')
      && !finalIssues.some(entry => entry.rewardId === line.rewardId)
    return Object.freeze({ ...line, disposition: allocated ? 'allocated' as const : 'pending' as const })
  })
  const allAllocated = finalLines.every(line => line.disposition === 'allocated' || line.disposition === 'excluded')
  const fullyValid = allAllocated && finalIssues.length === 0
  const packageStatus = finalLines.length === 0 ? 'ready' as const : fullyValid ? 'allocated' as const : 'ready' as const
  previews.sort((left, right) => left.previewId.localeCompare(right.previewId))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    rewardPackage: {
      ...settlement.rewardPackage,
      status: packageStatus,
      lines: finalLines,
    },
    allocations: finalAllocations,
  })
  return Object.freeze({
    eligible: fullyValid,
    document,
    rewardPackage: document.rewardPackage,
    allocations: document.allocations,
    writePreviews: Object.freeze(previews),
    issues: finalIssues,
  })
}
