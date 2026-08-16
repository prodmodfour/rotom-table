import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementAllocation,
  type EncounterSettlementAllocationDestination,
  type EncounterSettlementAuthorityRef,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import { normalizePlayerProfile, type PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson } from '~/utils/serialization'
import { TRAINER_TEAM_LIMIT, normalizePokemonSlugList } from '~/utils/trainerPokemonLinks'
import type {
  EncounterSettlementRewardDestinationAuthority,
  EncounterSettlementRewardPermissionAuthority,
  EncounterSettlementRewardWriteAuthority,
} from './rewardPackage'

export const ENCOUNTER_SETTLEMENT_CAPTURE_RECORD_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS = ['team', 'box'] as const
export type EncounterSettlementCaptureRosterDestination =
  typeof ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS[number]

export interface AcceptedEncounterSettlementCaptureRecordV1 {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_CAPTURE_RECORD_SCHEMA_VERSION
  readonly captureOperationId: string
  readonly sourceAuthority: EncounterSettlementAuthorityRef
  readonly acceptedResultSha256: string
  readonly provenanceDefinitionSha256: string
  readonly actorProfileId: string
  readonly trainerSheetSlug: string
  readonly trainerRevisionAfterCapture: number
  readonly pokemonSheetSlug: string
  readonly pokemonRevisionAfterCapture: number
  readonly rosterDestinationAfterCapture: EncounterSettlementCaptureRosterDestination
  readonly caughtBall: string
  readonly namingRequirement: 'none' | 'optional' | 'required'
  readonly acceptedAtCampaignMinute: number
}

export interface EncounterSettlementCaptureDeclaration {
  readonly rewardId: string
  readonly destination: EncounterSettlementAllocationDestination
  readonly ownerTrainerSlug: string
  readonly rosterDestination: EncounterSettlementCaptureRosterDestination
  readonly nicknameDecision: 'keep' | 'set' | null
  readonly nickname: string | null
  readonly permission: EncounterSettlementRewardPermissionAuthority
}

export interface EncounterSettlementCaptureTrainerAuthority {
  readonly slug: string
  readonly revision: number
  readonly sheet: TrainerSheet
}

export interface EncounterSettlementCapturePokemonAuthority {
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet
}

export interface EncounterSettlementCaptureProfileAuthority {
  readonly profileId: string
  readonly revision: number
  readonly definitionSha256: string
  readonly profile: PlayerProfile
}

export interface EncounterSettlementCaptureAuthoritySnapshot {
  readonly completeness: 'authoritative-current'
  readonly captureRecords: readonly AcceptedEncounterSettlementCaptureRecordV1[]
  readonly trainerSheets: readonly EncounterSettlementCaptureTrainerAuthority[]
  readonly pokemonSheets: readonly EncounterSettlementCapturePokemonAuthority[]
  readonly profiles: readonly EncounterSettlementCaptureProfileAuthority[]
  readonly declarations: readonly EncounterSettlementCaptureDeclaration[]
}

export interface EncounterSettlementCaptureRequiredDecision {
  readonly rewardId: string
  readonly kind: 'assignment' | 'naming' | 'team-capacity'
  readonly trainerSheetSlug: string | null
  readonly pokemonSheetSlug: string
  readonly legalRosterDestinations: readonly EncounterSettlementCaptureRosterDestination[]
}

export interface EncounterSettlementCapturePreview {
  readonly rewardId: string
  readonly allocationId: string
  readonly pokemonSheetSlug: string
  readonly trainerSheetSlug: string
  readonly destinationProfileId: string
  readonly rosterBefore: EncounterSettlementCaptureRosterDestination
  readonly rosterAfter: EncounterSettlementCaptureRosterDestination
  readonly nicknameChanged: boolean
  readonly teamSlotsBefore: number
  readonly teamSlotsAfter: number
  readonly caughtBallPreserved: true
}

export interface EncounterSettlementCaptureSheetWrite {
  readonly kind: 'trainer' | 'pokemon'
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly beforeDefinitionSha256: string
  readonly afterDefinitionSha256: string
  readonly nextSheet: TrainerSheet | CharacterSheet
}

export interface EncounterSettlementCapturePlan {
  readonly complete: boolean
  readonly authorityDefinitionSha256: string
  readonly document: EncounterSettlementDocument
  readonly allocations: readonly EncounterSettlementAllocation[]
  readonly destinationAuthorities: readonly EncounterSettlementRewardDestinationAuthority[]
  readonly previews: readonly EncounterSettlementCapturePreview[]
  readonly sheetWrites: readonly EncounterSettlementCaptureSheetWrite[]
  readonly requiredDecisions: readonly EncounterSettlementCaptureRequiredDecision[]
  readonly pendingRewardIds: readonly string[]
  readonly deniedRewardIds: readonly string[]
}

export type EncounterSettlementCaptureErrorCode =
  | 'incomplete-authority'
  | 'invalid-capture-record'
  | 'duplicate-capture-record'
  | 'invalid-declaration'
  | 'duplicate-declaration'
  | 'missing-authority'
  | 'stale-authority'
  | 'invalid-ownership'
  | 'invalid-roster'
  | 'capture-provenance-changed'
  | 'foreign-capture-allocation'
  | 'terminal-capture-state'
  | 'stale-capture-plan'

export class EncounterSettlementCaptureError extends Error {
  constructor(
    readonly code: EncounterSettlementCaptureErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'EncounterSettlementCaptureError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const SHA256 = /^[a-f0-9]{64}$/
const ALLOCATION_PREFIX = 'settlement-capture-allocation:v1:'
const WRITE_PREFIX = 'settlement-capture-write:v1:'
const AUTHORITY_KINDS = new Set<EncounterSettlementAuthorityRef['kind']>([
  'encounter-document', 'map', 'sheet', 'group-inventory', 'campaign-clock',
  'capture-operation', 'item-operation', 'equipment-operation', 'inventory-operation',
  'objective', 'clock', 'phase', 'effect', 'resource',
])

const fail = (code: EncounterSettlementCaptureErrorCode, path: string, message: string): never => {
  throw new EncounterSettlementCaptureError(code, path, message)
}

const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const isSha = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)

const hashJson = (value: unknown, path = 'captureSettlementAuthority'): string => createHash('sha256')
  .update(stableJsonStringify(value, {
    path,
    limits: {
      maxDepth: 64,
      maxNodes: 500_000,
      maxObjectFields: 20_000,
      maxArrayEntries: 200_000,
      maxStringLength: 100_000,
    },
  }))
  .digest('hex')

const deterministicId = (prefix: string, ...parts: readonly string[]): string => {
  const hash = createHash('sha256').update(prefix)
  parts.forEach(part => hash.update('\u0000').update(part))
  return `${prefix}${hash.digest('hex')}`
}

const sameAuthority = (left: EncounterSettlementAuthorityRef, right: EncounterSettlementAuthorityRef): boolean => (
  left.kind === right.kind && left.id === right.id && left.revision === right.revision
)

const parseAuthority = (value: EncounterSettlementAuthorityRef, path: string): EncounterSettlementAuthorityRef => {
  if (!value || !AUTHORITY_KINDS.has(value.kind) || !isId(value.id) || !isRevision(value.revision)) {
    return fail('invalid-capture-record', path, 'must be one exact supported authority reference.')
  }
  return Object.freeze({ ...value })
}

const parsePermission = (
  value: EncounterSettlementRewardPermissionAuthority,
  path: string,
): EncounterSettlementRewardPermissionAuthority => {
  if (!value || (value.status !== 'allowed' && value.status !== 'denied')
    || (value.status === 'denied') !== (value.reasonId !== null)
    || (value.reasonId !== null && !isId(value.reasonId))) {
    return fail('invalid-declaration', path, 'must contain one exact allowed or denied permission.')
  }
  return Object.freeze({
    status: value.status,
    authority: parseAuthority(value.authority, `${path}.authority`),
    reasonId: value.reasonId,
  })
}

const samePermission = (
  left: EncounterSettlementRewardPermissionAuthority,
  right: EncounterSettlementRewardPermissionAuthority,
): boolean => left.status === right.status && left.reasonId === right.reasonId
  && sameAuthority(left.authority, right.authority)

const parseRecord = (
  value: AcceptedEncounterSettlementCaptureRecordV1,
  path: string,
): AcceptedEncounterSettlementCaptureRecordV1 => {
  if (!value || value.schemaVersion !== 1 || !isId(value.captureOperationId)
    || !isSha(value.acceptedResultSha256) || !isSha(value.provenanceDefinitionSha256)
    || !isId(value.actorProfileId) || !isId(value.trainerSheetSlug) || !isRevision(value.trainerRevisionAfterCapture)
    || !isId(value.pokemonSheetSlug) || !isRevision(value.pokemonRevisionAfterCapture)
    || !ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS.includes(value.rosterDestinationAfterCapture)
    || typeof value.caughtBall !== 'string' || !value.caughtBall.trim() || value.caughtBall.length > 200
    || !['none', 'optional', 'required'].includes(value.namingRequirement)
    || !isRevision(value.acceptedAtCampaignMinute)) {
    return fail('invalid-capture-record', path, 'must be one bounded accepted successful capture record.')
  }
  const sourceAuthority = parseAuthority(value.sourceAuthority, `${path}.sourceAuthority`)
  if (sourceAuthority.kind !== 'capture-operation' || sourceAuthority.id !== value.captureOperationId) {
    return fail('invalid-capture-record', `${path}.sourceAuthority`, 'must be the exact accepted capture operation.')
  }
  return Object.freeze({ ...value, sourceAuthority })
}

const parseSheetMap = <T extends { readonly slug: string, readonly revision: number, readonly sheet: { readonly slug: string, readonly revision?: number } }>(
  values: readonly T[],
  label: 'trainerSheets' | 'pokemonSheets',
): ReadonlyMap<string, T> => {
  if (!Array.isArray(values) || values.length > 4_096) {
    return fail('incomplete-authority', `authority.${label}`, 'must be one bounded complete sheet read.')
  }
  const map = new Map<string, T>()
  values.forEach((value, index) => {
    const path = `authority.${label}[${index}]`
    if (!value || !isId(value.slug) || !isRevision(value.revision)
      || value.revision >= Number.MAX_SAFE_INTEGER || !value.sheet
      || value.sheet.slug !== value.slug || value.sheet.revision !== value.revision) {
      fail('stale-authority', path, 'must contain one exact current sheet and revision.')
    }
    if (map.has(value.slug)) fail('stale-authority', `authority.${label}`, 'must not duplicate sheet identities.')
    map.set(value.slug, value)
  })
  return map
}

const parseProfiles = (
  values: readonly EncounterSettlementCaptureProfileAuthority[],
): ReadonlyMap<string, EncounterSettlementCaptureProfileAuthority> => {
  if (!Array.isArray(values) || values.length > 1_024) {
    return fail('incomplete-authority', 'authority.profiles', 'must be one bounded complete Profile authority read.')
  }
  const profiles = new Map<string, EncounterSettlementCaptureProfileAuthority>()
  values.forEach((value, index) => {
    const path = `authority.profiles[${index}]`
    let profile: PlayerProfile
    try { profile = normalizePlayerProfile(value?.profile, `${path}.profile`) }
    catch (error) {
      fail('stale-authority', path, error instanceof Error ? error.message : 'contains malformed Profile authority.')
    }
    if (!value || value.profileId !== profile!.id || !isRevision(value.revision)
      || value.revision >= Number.MAX_SAFE_INTEGER || !isSha(value.definitionSha256)
      || hashJson(profile!, 'captureProfile') !== value.definitionSha256) {
      fail('stale-authority', path, 'must contain one exact current hash-bound Profile authority.')
    }
    if (profiles.has(value.profileId)) fail('stale-authority', 'authority.profiles', 'must not duplicate Profile identities.')
    profiles.set(value.profileId, Object.freeze({ ...value, profile: profile! }))
  })
  return profiles
}

const roster = (authority: EncounterSettlementCaptureTrainerAuthority): {
  readonly team: string[]
  readonly box: string[]
} => {
  const rawTeam = authority.sheet.currentTeam ?? []
  const rawBox = authority.sheet.boxedPokemon ?? []
  const team = normalizePokemonSlugList(rawTeam)
  const box = normalizePokemonSlugList(rawBox)
  if (rawTeam.length !== team.length || rawBox.length !== box.length || team.length > TRAINER_TEAM_LIMIT
    || team.some(slug => box.includes(slug))) {
    return fail('invalid-roster', authority.slug, 'current team and box authority must be unique, disjoint, and within the six-member team limit.')
  }
  return { team, box }
}

const rosterOf = (
  authority: EncounterSettlementCaptureTrainerAuthority,
  pokemonSlug: string,
): EncounterSettlementCaptureRosterDestination => {
  const current = roster(authority)
  const team = current.team.includes(pokemonSlug)
  const box = current.box.includes(pokemonSlug)
  if (team === box) {
    return fail('invalid-ownership', `${authority.slug}:${pokemonSlug}`, 'captured Pokémon must belong to exactly one current Trainer roster destination.')
  }
  return team ? 'team' : 'box'
}

const validNickname = (value: unknown): value is string => typeof value === 'string'
  && Boolean(value.trim()) && value.length <= 100
  && !/[\u0000-\u001f\u007f]/u.test(value)

const destinationKey = (destination: EncounterSettlementAllocationDestination): string => (
  `${destination.kind}\u0000${destination.id}\u0000${destination.revision}`
)

const allocationIdFor = (settlementId: string, rewardId: string): string => (
  deterministicId(ALLOCATION_PREFIX, settlementId, rewardId)
)

const authorityEvidence = (authority: EncounterSettlementCaptureAuthoritySnapshot): string => hashJson({
  completeness: authority.completeness,
  captureRecords: authority.captureRecords,
  trainerSheets: authority.trainerSheets,
  pokemonSheets: authority.pokemonSheets,
  profiles: authority.profiles,
  declarations: authority.declarations,
})

export const planEncounterSettlementCaptures = (input: {
  readonly settlement: unknown
  readonly authority: EncounterSettlementCaptureAuthoritySnapshot
}): EncounterSettlementCapturePlan => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  const captureLines = settlement.rewardPackage.lines.filter(line => line.payload.kind === 'capture')
  const captureRewardIds = new Set(captureLines.map(line => line.rewardId))
  if (settlement.status === 'committing' || settlement.status === 'completed' || settlement.status === 'cancelled'
    || settlement.rewardPackage.status === 'committed' || settlement.rewardPackage.status === 'cancelled'
    || captureLines.some(line => line.disposition === 'committed')
    || settlement.allocations.some(allocation => captureRewardIds.has(allocation.rewardId)
      && (allocation.state === 'applied' || allocation.receiptId !== null))) {
    return fail('terminal-capture-state', 'settlement', 'cannot re-plan captures after settlement commit has begun.')
  }
  if (!input.authority || input.authority.completeness !== 'authoritative-current'
    || !Array.isArray(input.authority.captureRecords) || !Array.isArray(input.authority.declarations)) {
    return fail('incomplete-authority', 'authority', 'must contain one complete current capture authority read.')
  }
  const trainers = parseSheetMap(input.authority.trainerSheets, 'trainerSheets')
  const pokemon = parseSheetMap(input.authority.pokemonSheets, 'pokemonSheets')
  const profiles = parseProfiles(input.authority.profiles)
  const linesByReward = new Map(captureLines.map(line => [line.rewardId, line] as const))
  const recordsByPokemon = new Map<string, AcceptedEncounterSettlementCaptureRecordV1>()
  const recordsByReward = new Map<string, AcceptedEncounterSettlementCaptureRecordV1>()
  input.authority.captureRecords.forEach((raw, index) => {
    const record = parseRecord(raw, `authority.captureRecords[${index}]`)
    if (recordsByPokemon.has(record.pokemonSheetSlug)) {
      fail('duplicate-capture-record', 'authority.captureRecords', 'must not contain duplicate captured Pokémon identities.')
    }
    const matching = captureLines.filter(line => line.payload.kind === 'capture'
      && line.payload.captureOperationId === record.captureOperationId
      && line.payload.pokemonSheetSlug === record.pokemonSheetSlug)
    if (matching.length !== 1 || !sameAuthority(matching[0]!.sourceAuthority, record.sourceAuthority)) {
      fail('invalid-capture-record', `authority.captureRecords[${index}]`, 'must match exactly one current capture reward and source authority.')
    }
    recordsByPokemon.set(record.pokemonSheetSlug, record)
    recordsByReward.set(matching[0]!.rewardId, record)
  })
  for (const line of captureLines) {
    if (line.disposition !== 'excluded' && !recordsByReward.has(line.rewardId)) {
      fail('missing-authority', line.rewardId, 'accepted capture evidence is unavailable for a non-excluded reward.')
    }
  }
  for (const allocation of settlement.allocations.filter(row => captureRewardIds.has(row.rewardId))) {
    if (!allocation.allocationId.startsWith(ALLOCATION_PREFIX)) {
      fail('foreign-capture-allocation', allocation.allocationId, 'cannot replace capture allocation evidence owned by another provider.')
    }
  }

  const declarations = new Map<string, EncounterSettlementCaptureDeclaration>()
  input.authority.declarations.forEach((declaration, index) => {
    const path = `authority.declarations[${index}]`
    const line = linesByReward.get(declaration?.rewardId)
    if (!declaration || !line || line.disposition === 'excluded'
      || declaration.destination.kind !== 'profile' || !isId(declaration.destination.id)
      || !isRevision(declaration.destination.revision) || !isId(declaration.ownerTrainerSlug)
      || !ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS.includes(declaration.rosterDestination)
      || !['keep', 'set', null].includes(declaration.nicknameDecision)) {
      fail('invalid-declaration', path, 'must select one current capture, Profile, owner Trainer, roster destination, and bounded naming decision.')
    }
    if ((declaration.nicknameDecision === 'set') !== (declaration.nickname !== null)
      || (declaration.nickname !== null && !validNickname(declaration.nickname))) {
      fail('invalid-declaration', `${path}.nickname`, 'is available only as bounded text for an explicit set decision.')
    }
    if (declarations.has(declaration.rewardId)) {
      fail('duplicate-declaration', path, 'must not declare one capture reward more than once.')
    }
    parsePermission(declaration.permission, `${path}.permission`)
    declarations.set(declaration.rewardId, declaration)
  })

  const nextTrainers = new Map<string, TrainerSheet>()
  const nextPokemon = new Map<string, CharacterSheet>()
  const pending = new Set<string>()
  const denied = new Set<string>()
  const requiredDecisions: EncounterSettlementCaptureRequiredDecision[] = []
  const blockedCapacity = new Set<string>()
  const generatedAllocations: EncounterSettlementAllocation[] = []
  const permissionsByDestination = new Map<string, EncounterSettlementRewardPermissionAuthority>()
  const destinationByKey = new Map<string, EncounterSettlementAllocationDestination>()
  const writesByDestination = new Map<string, EncounterSettlementRewardWriteAuthority[]>()
  const previews: EncounterSettlementCapturePreview[] = []

  // Validate accepted custody and declarations before deriving aggregate team capacity.
  for (const line of captureLines) {
    if (line.disposition === 'excluded') continue
    const record = recordsByReward.get(line.rewardId)!
    if (record.acceptedAtCampaignMinute > settlement.encounter.campaignMinute) {
      fail('invalid-capture-record', line.rewardId, 'accepted capture evidence cannot postdate encounter settlement authority.')
    }
    const trainer = trainers.get(record.trainerSheetSlug)
      ?? fail('missing-authority', line.rewardId, 'capturing Trainer sheet is unavailable.')
    const target = pokemon.get(record.pokemonSheetSlug)
      ?? fail('missing-authority', line.rewardId, 'captured Pokémon sheet is unavailable.')
    if (trainer.revision < record.trainerRevisionAfterCapture || target.revision < record.pokemonRevisionAfterCapture) {
      fail('stale-authority', line.rewardId, 'current sheets cannot predate the accepted capture revisions.')
    }
    rosterOf(trainer, record.pokemonSheetSlug)
    if (target.sheet.caughtBall !== record.caughtBall) {
      fail('capture-provenance-changed', line.rewardId, 'the original accepted caught-ball field changed after capture.')
    }
    const declaration = declarations.get(line.rewardId)
    if (!declaration) {
      pending.add(line.rewardId)
      requiredDecisions.push(Object.freeze({
        rewardId: line.rewardId,
        kind: 'assignment',
        trainerSheetSlug: record.trainerSheetSlug,
        pokemonSheetSlug: record.pokemonSheetSlug,
        legalRosterDestinations: ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS,
      }))
      continue
    }
    if (declaration.ownerTrainerSlug !== record.trainerSheetSlug) {
      fail('invalid-ownership', line.rewardId, 'capture assignment cannot silently change its accepted owning Trainer.')
    }
    const profile = profiles.get(declaration.destination.id)
      ?? fail('missing-authority', line.rewardId, 'destination Profile authority is unavailable.')
    if (profile.revision !== declaration.destination.revision
      || !profile.profile.linkedCharacters.some(ref => ref.sheetKind === 'trainer' && ref.sheetSlug === record.trainerSheetSlug)
      || (record.actorProfileId !== 'system:gm-live-play' && record.actorProfileId !== profile.profileId)) {
      fail('invalid-ownership', line.rewardId, 'destination Profile must currently control the accepted capture Trainer and actor authority.')
    }
    const permission = parsePermission(declaration.permission, `${line.rewardId}.permission`)
    if (permission.authority.kind !== 'sheet'
      || permission.authority.id !== trainer.slug
      || permission.authority.revision !== trainer.revision) {
      fail('invalid-ownership', line.rewardId, 'capture permission must come from the exact current owning Trainer sheet.')
    }
    const key = destinationKey(declaration.destination)
    const existingPermission = permissionsByDestination.get(key)
    if (existingPermission && !samePermission(existingPermission, permission)) {
      fail('invalid-declaration', line.rewardId, 'captures sharing one Profile require the same exact permission authority.')
    }
    permissionsByDestination.set(key, permission)
    destinationByKey.set(key, Object.freeze({ ...declaration.destination }))
    const allocationId = allocationIdFor(settlement.settlementId, line.rewardId)
    generatedAllocations.push(Object.freeze({
      allocationId,
      rewardId: line.rewardId,
      destination: declaration.destination,
      method: 'whole',
      amount: 1,
      weight: null,
      state: 'proposed',
      decisionId: null,
      receiptId: null,
    }))
    if (permission.status === 'denied') {
      denied.add(line.rewardId)
      continue
    }
    if (record.namingRequirement === 'required' && declaration.nicknameDecision === null) {
      pending.add(line.rewardId)
      requiredDecisions.push(Object.freeze({
        rewardId: line.rewardId,
        kind: 'naming',
        trainerSheetSlug: record.trainerSheetSlug,
        pokemonSheetSlug: record.pokemonSheetSlug,
        legalRosterDestinations: ENCOUNTER_SETTLEMENT_CAPTURE_ROSTER_DESTINATIONS,
      }))
    }
  }

  // Team overflow remains a visible choice; never silently redirect a chosen capture to the box.
  for (const [trainerSlug, authority] of trainers) {
    const current = roster(authority)
    const selected = captureLines.flatMap(line => {
      const record = recordsByReward.get(line.rewardId)
      const declaration = declarations.get(line.rewardId)
      if (!record || !declaration || record.trainerSheetSlug !== trainerSlug
        || denied.has(line.rewardId) || pending.has(line.rewardId)) return []
      return [{ line, record, declaration }]
    })
    const selectedSlugs = new Set(selected.map(row => row.record.pokemonSheetSlug))
    const retained = current.team.filter(slug => !selectedSlugs.has(slug))
    const requestedTeam = selected.filter(row => row.declaration.rosterDestination === 'team')
      .sort((left, right) => allocationIdFor(settlement.settlementId, left.line.rewardId)
        .localeCompare(allocationIdFor(settlement.settlementId, right.line.rewardId)))
    const available = Math.max(0, TRAINER_TEAM_LIMIT - retained.length)
    for (const row of requestedTeam.slice(available)) {
      blockedCapacity.add(row.line.rewardId)
      pending.add(row.line.rewardId)
      requiredDecisions.push(Object.freeze({
        rewardId: row.line.rewardId,
        kind: 'team-capacity',
        trainerSheetSlug: trainerSlug,
        pokemonSheetSlug: row.record.pokemonSheetSlug,
        legalRosterDestinations: ['box'] as const,
      }))
    }
  }

  for (const allocation of [...generatedAllocations].sort((a, b) => a.allocationId.localeCompare(b.allocationId))) {
    const line = linesByReward.get(allocation.rewardId)!
    const record = recordsByReward.get(line.rewardId)!
    const declaration = declarations.get(line.rewardId)!
    const permission = permissionsByDestination.get(destinationKey(declaration.destination))!
    if (permission.status === 'denied' || pending.has(line.rewardId) || blockedCapacity.has(line.rewardId)) continue
    const trainerAuthority = trainers.get(record.trainerSheetSlug)!
    const pokemonAuthority = pokemon.get(record.pokemonSheetSlug)!
    const beforeRoster = rosterOf(trainerAuthority, record.pokemonSheetSlug)
    const beforeTeamCount = roster(nextTrainers.has(record.trainerSheetSlug)
      ? { ...trainerAuthority, sheet: nextTrainers.get(record.trainerSheetSlug)! }
      : trainerAuthority).team.length
    const trainer = nextTrainers.get(record.trainerSheetSlug)
      ?? deepCloneJson(trainerAuthority.sheet)
    const team = normalizePokemonSlugList(trainer.currentTeam)
    const box = normalizePokemonSlugList(trainer.boxedPokemon)
    trainer.currentTeam = team.filter(slug => slug !== record.pokemonSheetSlug)
    trainer.boxedPokemon = box.filter(slug => slug !== record.pokemonSheetSlug)
    if (declaration.rosterDestination === 'team') trainer.currentTeam.push(record.pokemonSheetSlug)
    else trainer.boxedPokemon.push(record.pokemonSheetSlug)
    if (trainer.currentTeam.length > TRAINER_TEAM_LIMIT) {
      fail('invalid-roster', line.rewardId, 'capture team assignment exceeded the six-member limit after preflight.')
    }
    nextTrainers.set(record.trainerSheetSlug, trainer)

    const target = nextPokemon.get(record.pokemonSheetSlug)
      ?? deepCloneJson(pokemonAuthority.sheet)
    const beforeNickname = target.nickname
    if (declaration.nicknameDecision === 'set') target.nickname = declaration.nickname!
    nextPokemon.set(record.pokemonSheetSlug, target)
    const key = destinationKey(declaration.destination)
    const writes = writesByDestination.get(key) ?? []
    writes.push(Object.freeze({
      sourceWriteId: deterministicId(WRITE_PREFIX, settlement.settlementId, allocation.allocationId, 'capture'),
      allocationId: allocation.allocationId,
      targetAuthority: record.sourceAuthority,
      field: 'capture-destination',
      amount: 1,
      countsTowardAllocation: true,
      capacityCost: 1,
    }))
    if (beforeRoster !== declaration.rosterDestination) {
      writes.push(Object.freeze({
        sourceWriteId: deterministicId(WRITE_PREFIX, settlement.settlementId, allocation.allocationId, 'roster'),
        allocationId: allocation.allocationId,
        targetAuthority: Object.freeze({ kind: 'sheet', id: trainerAuthority.slug, revision: trainerAuthority.revision }),
        field: 'capture-destination',
        amount: 0,
        countsTowardAllocation: false,
        capacityCost: 0,
      }))
    }
    if (target.nickname !== beforeNickname) {
      writes.push(Object.freeze({
        sourceWriteId: deterministicId(WRITE_PREFIX, settlement.settlementId, allocation.allocationId, 'nickname'),
        allocationId: allocation.allocationId,
        targetAuthority: Object.freeze({ kind: 'sheet', id: pokemonAuthority.slug, revision: pokemonAuthority.revision }),
        field: 'capture-destination',
        amount: 0,
        countsTowardAllocation: false,
        capacityCost: 0,
      }))
    }
    writesByDestination.set(key, writes)
    previews.push(Object.freeze({
      rewardId: line.rewardId,
      allocationId: allocation.allocationId,
      pokemonSheetSlug: record.pokemonSheetSlug,
      trainerSheetSlug: record.trainerSheetSlug,
      destinationProfileId: declaration.destination.id,
      rosterBefore: beforeRoster,
      rosterAfter: declaration.rosterDestination,
      nicknameChanged: target.nickname !== beforeNickname,
      teamSlotsBefore: beforeTeamCount,
      teamSlotsAfter: trainer.currentTeam.length,
      caughtBallPreserved: true,
    }))
  }

  const destinationAuthorities: EncounterSettlementRewardDestinationAuthority[] = []
  for (const [key, permission] of permissionsByDestination) {
    const destination = destinationByKey.get(key)!
    // Box capacity has no finite app-owned rule. Team capacity is validated per
    // exact Trainer above; this general reward boundary counts one whole
    // ownership write without inventing a shared cross-Trainer slot pool.
    destinationAuthorities.push(Object.freeze({
      destination,
      permission,
      capacity: Object.freeze({ metric: 'unbounded' as const, limit: null, used: null }),
      writes: Object.freeze(writesByDestination.get(key) ?? []),
    }))
  }

  const sheetWrites: EncounterSettlementCaptureSheetWrite[] = []
  for (const [slug, next] of nextTrainers) {
    const current = trainers.get(slug)!
    if (hashJson(current.sheet, 'captureSheet') === hashJson(next, 'captureSheet')) continue
    const nextSheet = { ...next, revision: current.revision + 1 }
    sheetWrites.push(Object.freeze({
      kind: 'trainer', slug, expectedRevision: current.revision, revision: current.revision + 1,
      beforeDefinitionSha256: hashJson(current.sheet, 'captureSheet'),
      afterDefinitionSha256: hashJson(nextSheet, 'captureSheet'), nextSheet,
    }))
  }
  for (const [slug, next] of nextPokemon) {
    const current = pokemon.get(slug)!
    if (next.caughtBall !== current.sheet.caughtBall) {
      fail('capture-provenance-changed', slug, 'capture settlement cannot rewrite the original caught-ball authority.')
    }
    if (hashJson(current.sheet, 'captureSheet') === hashJson(next, 'captureSheet')) continue
    const nextSheet = { ...next, revision: current.revision + 1 }
    sheetWrites.push(Object.freeze({
      kind: 'pokemon', slug, expectedRevision: current.revision, revision: current.revision + 1,
      beforeDefinitionSha256: hashJson(current.sheet, 'captureSheet'),
      afterDefinitionSha256: hashJson(nextSheet, 'captureSheet'), nextSheet,
    }))
  }

  const otherAllocations = settlement.allocations.filter(allocation => !captureRewardIds.has(allocation.rewardId))
  const document = parseEncounterSettlementDocument({
    ...settlement,
    allocations: [...otherAllocations, ...generatedAllocations].sort((a, b) => a.allocationId.localeCompare(b.allocationId)),
  })
  const pendingRewardIds = Object.freeze([...pending].sort())
  const deniedRewardIds = Object.freeze([...denied].sort())
  requiredDecisions.sort((a, b) => `${a.rewardId}:${a.kind}`.localeCompare(`${b.rewardId}:${b.kind}`))
  previews.sort((a, b) => a.allocationId.localeCompare(b.allocationId))
  sheetWrites.sort((a, b) => `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`))
  destinationAuthorities.sort((a, b) => destinationKey(a.destination).localeCompare(destinationKey(b.destination)))
  return Object.freeze({
    complete: pendingRewardIds.length === 0 && deniedRewardIds.length === 0,
    authorityDefinitionSha256: authorityEvidence(input.authority),
    document,
    allocations: Object.freeze(document.allocations.filter(row => captureRewardIds.has(row.rewardId))),
    destinationAuthorities: Object.freeze(destinationAuthorities),
    previews: Object.freeze(previews),
    sheetWrites: Object.freeze(sheetWrites),
    requiredDecisions: Object.freeze(requiredDecisions),
    pendingRewardIds,
    deniedRewardIds,
  })
}

export const applyEncounterSettlementCapturePlan = (input: {
  readonly plan: EncounterSettlementCapturePlan
  readonly currentAuthority: EncounterSettlementCaptureAuthoritySnapshot
}): readonly EncounterSettlementCaptureSheetWrite[] => {
  if (!input.plan.complete || input.plan.authorityDefinitionSha256 !== authorityEvidence(input.currentAuthority)) {
    return fail('stale-capture-plan', 'plan', 'complete capture authority changed before application.')
  }
  const trainers = parseSheetMap(input.currentAuthority.trainerSheets, 'trainerSheets')
  const pokemon = parseSheetMap(input.currentAuthority.pokemonSheets, 'pokemonSheets')
  for (const write of input.plan.sheetWrites) {
    const current = write.kind === 'trainer' ? trainers.get(write.slug) : pokemon.get(write.slug)
    if (!current || current.revision !== write.expectedRevision
      || hashJson(current.sheet, 'captureSheet') !== write.beforeDefinitionSha256
      || hashJson(write.nextSheet, 'captureSheet') !== write.afterDefinitionSha256
      || write.revision !== write.expectedRevision + 1) {
      fail('stale-capture-plan', `${write.kind}:${write.slug}`, 'capture sheet authority no longer matches its complete preview.')
    }
  }
  return input.plan.sheetWrites
}
