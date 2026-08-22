/**
 * Onboarding read sets, write sets, and atomicity (P9-018).
 *
 * Final approval consumes an explicit OnboardingCommitPlan: everything the
 * commit will read (with expected revisions/identities) and everything it
 * will write. The commit transaction re-validates the entire read set and
 * either applies the whole write set or nothing. The plan is also the
 * approval-preview payload shown to the GM (P9-056).
 */

import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import { isSheetKind, type SheetKind } from '../sheets'
import { isSlug } from '../paths'
import {
  OnboardingIdError,
  parseOnboardingDraftId,
  parseOnboardingOperationId,
  parseOnboardingPolicyId,
  parseOnboardingSlotId,
  type OnboardingDraftId,
  type OnboardingOperationId,
  type OnboardingPolicyId,
  type OnboardingSlotId,
} from './ids'
import type { OnboardingInventorySection } from './policy'
import { ONBOARDING_INVENTORY_SECTIONS } from './policy'

export const ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION = 1 as const

export class OnboardingCommitPlanError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingCommitPlanError'
    this.field = field
  }
}

/* ------------------------------------------------------------------ */
/* Read set                                                           */
/* ------------------------------------------------------------------ */

export interface OnboardingCommitReadSetV1 {
  /** The exact draft revision the plan was computed from. */
  readonly draft: { readonly draftId: OnboardingDraftId, readonly revision: number }
  /** The immutable policy version the draft is bound to. */
  readonly policy: { readonly policyId: OnboardingPolicyId, readonly version: number, readonly contentHash: string }
  /** Canonical catalog fingerprint used for final re-authorization. */
  readonly catalogFingerprint: string
  /** The owning profile that must still exist and be bound to the slot. */
  readonly profileId: PlayerProfileId
  readonly slotId: OnboardingSlotId
  /** Slugs that must still be free when the transaction begins. */
  readonly slugReservations: readonly { readonly kind: SheetKind, readonly slug: string }[]
  /** Folder paths that will be created if absent. */
  readonly folderDestinations: readonly string[]
}

/* ------------------------------------------------------------------ */
/* Write set                                                          */
/* ------------------------------------------------------------------ */

export interface OnboardingPlannedSheetV1 {
  readonly kind: SheetKind
  readonly slug: string
  readonly folder: string
  readonly displayName: string
  /** starter buildId for pokemon sheets; 'trainer' for the trainer sheet. */
  readonly sourceBuildId: string
}

export interface OnboardingPlannedInventoryRowV1 {
  readonly trainerSlug: string
  readonly section: OnboardingInventorySection
  readonly itemId: string
  readonly quantity: number
}

export interface OnboardingPlannedHeldItemV1 {
  readonly pokemonSlug: string
  readonly itemId: string
}

export interface OnboardingCommitWriteSetV1 {
  readonly sheets: readonly OnboardingPlannedSheetV1[]
  readonly profileLinks: readonly { readonly profileId: PlayerProfileId, readonly sheetKind: SheetKind, readonly sheetSlug: string }[]
  readonly team: { readonly trainerSlug: string, readonly currentTeam: readonly string[], readonly boxedPokemon: readonly string[] }
  readonly startingMoney: number
  readonly inventoryRows: readonly OnboardingPlannedInventoryRowV1[]
  readonly starterHeldItems: readonly OnboardingPlannedHeldItemV1[]
  /** Completion/provenance record identity written with the package. */
  readonly completionRecordId: string
  /** Realtime event types that will be appended in-transaction. */
  readonly realtimeEventTypes: readonly string[]
}

export interface OnboardingCommitPlanV1 {
  readonly schemaVersion: typeof ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION
  readonly operationId: OnboardingOperationId
  readonly readSet: OnboardingCommitReadSetV1
  readonly writeSet: OnboardingCommitWriteSetV1
}

/* ------------------------------------------------------------------ */
/* Parsing and internal-consistency validation                        */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const expectRecord = (value: unknown, field: string): UnknownRecord => {
  if (!isRecord(value)) throw new OnboardingCommitPlanError(field, `${field} must be an object`)
  return value
}

const expectInt = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new OnboardingCommitPlanError(field, `${field} must be an integer between ${min} and ${max}`)
  }
  return value
}

const expectString = (value: unknown, field: string, maxLength = 200): string => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new OnboardingCommitPlanError(field, `${field} must be a bounded non-empty string`)
  }
  return value
}

const expectSlugValue = (value: unknown, field: string): string => {
  const parsed = expectString(value, field, 120)
  if (!isSlug(parsed)) throw new OnboardingCommitPlanError(field, `${field} must be a slug`)
  return parsed
}

const expectSheetKind = (value: unknown, field: string): SheetKind => {
  if (!isSheetKind(value)) throw new OnboardingCommitPlanError(field, `${field} must be pokemon or trainer`)
  return value
}

const expectArray = (value: unknown, field: string, maxEntries: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new OnboardingCommitPlanError(field, `${field} must be an array of at most ${maxEntries} entries`)
  }
  return value
}

export const parseOnboardingCommitPlan = (value: unknown, label = 'commitPlan'): OnboardingCommitPlanV1 => {
  const record = expectRecord(value, label)
  if (record.schemaVersion !== ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION) {
    throw new OnboardingCommitPlanError(`${label}.schemaVersion`, `${label}.schemaVersion must be ${ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION}`)
  }

  let operationId: OnboardingOperationId
  let draftId: OnboardingDraftId
  let policyId: OnboardingPolicyId
  let slotId: OnboardingSlotId
  const readSetRecord = expectRecord(record.readSet, `${label}.readSet`)
  const draftRecord = expectRecord(readSetRecord.draft, `${label}.readSet.draft`)
  const policyRecord = expectRecord(readSetRecord.policy, `${label}.readSet.policy`)
  try {
    operationId = parseOnboardingOperationId(record.operationId, `${label}.operationId`)
    draftId = parseOnboardingDraftId(draftRecord.draftId, `${label}.readSet.draft.draftId`)
    policyId = parseOnboardingPolicyId(policyRecord.policyId, `${label}.readSet.policy.policyId`)
    slotId = parseOnboardingSlotId(readSetRecord.slotId, `${label}.readSet.slotId`)
  } catch (error) {
    throw new OnboardingCommitPlanError(label, error instanceof OnboardingIdError ? error.message : 'invalid identifier')
  }
  if (!isPlayerProfileId(readSetRecord.profileId)) {
    throw new OnboardingCommitPlanError(`${label}.readSet.profileId`, 'profileId must be a player profile ID')
  }

  const slugReservations = expectArray(readSetRecord.slugReservations, `${label}.readSet.slugReservations`, 10)
    .map((entry, index) => {
      const entryRecord = expectRecord(entry, `${label}.readSet.slugReservations[${index}]`)
      return {
        kind: expectSheetKind(entryRecord.kind, `${label}.readSet.slugReservations[${index}].kind`),
        slug: expectSlugValue(entryRecord.slug, `${label}.readSet.slugReservations[${index}].slug`),
      }
    })

  const writeSetRecord = expectRecord(record.writeSet, `${label}.writeSet`)
  const sheets = expectArray(writeSetRecord.sheets, `${label}.writeSet.sheets`, 10).map((entry, index) => {
    const entryRecord = expectRecord(entry, `${label}.writeSet.sheets[${index}]`)
    return {
      kind: expectSheetKind(entryRecord.kind, `${label}.writeSet.sheets[${index}].kind`),
      slug: expectSlugValue(entryRecord.slug, `${label}.writeSet.sheets[${index}].slug`),
      folder: expectString(entryRecord.folder, `${label}.writeSet.sheets[${index}].folder`),
      displayName: expectString(entryRecord.displayName, `${label}.writeSet.sheets[${index}].displayName`, 120),
      sourceBuildId: expectString(entryRecord.sourceBuildId, `${label}.writeSet.sheets[${index}].sourceBuildId`, 40),
    }
  })

  const profileLinks = expectArray(writeSetRecord.profileLinks, `${label}.writeSet.profileLinks`, 10)
    .map((entry, index) => {
      const entryRecord = expectRecord(entry, `${label}.writeSet.profileLinks[${index}]`)
      if (!isPlayerProfileId(entryRecord.profileId)) {
        throw new OnboardingCommitPlanError(`${label}.writeSet.profileLinks[${index}].profileId`, 'must be a player profile ID')
      }
      return {
        profileId: entryRecord.profileId,
        sheetKind: expectSheetKind(entryRecord.sheetKind, `${label}.writeSet.profileLinks[${index}].sheetKind`),
        sheetSlug: expectSlugValue(entryRecord.sheetSlug, `${label}.writeSet.profileLinks[${index}].sheetSlug`),
      }
    })

  const teamRecord = expectRecord(writeSetRecord.team, `${label}.writeSet.team`)
  const team = {
    trainerSlug: expectSlugValue(teamRecord.trainerSlug, `${label}.writeSet.team.trainerSlug`),
    currentTeam: expectArray(teamRecord.currentTeam, `${label}.writeSet.team.currentTeam`, 6)
      .map((entry, index) => expectSlugValue(entry, `${label}.writeSet.team.currentTeam[${index}]`)),
    boxedPokemon: expectArray(teamRecord.boxedPokemon ?? [], `${label}.writeSet.team.boxedPokemon`, 20)
      .map((entry, index) => expectSlugValue(entry, `${label}.writeSet.team.boxedPokemon[${index}]`)),
  }

  const inventoryRows = expectArray(writeSetRecord.inventoryRows ?? [], `${label}.writeSet.inventoryRows`, 60)
    .map((entry, index) => {
      const entryRecord = expectRecord(entry, `${label}.writeSet.inventoryRows[${index}]`)
      const section = entryRecord.section
      if (!(ONBOARDING_INVENTORY_SECTIONS as readonly string[]).includes(section as string)) {
        throw new OnboardingCommitPlanError(`${label}.writeSet.inventoryRows[${index}].section`, 'must be a trainer inventory section')
      }
      return {
        trainerSlug: expectSlugValue(entryRecord.trainerSlug, `${label}.writeSet.inventoryRows[${index}].trainerSlug`),
        section: section as OnboardingInventorySection,
        itemId: expectString(entryRecord.itemId, `${label}.writeSet.inventoryRows[${index}].itemId`, 120),
        quantity: expectInt(entryRecord.quantity, `${label}.writeSet.inventoryRows[${index}].quantity`, 1, 99),
      }
    })

  const starterHeldItems = expectArray(writeSetRecord.starterHeldItems ?? [], `${label}.writeSet.starterHeldItems`, 6)
    .map((entry, index) => {
      const entryRecord = expectRecord(entry, `${label}.writeSet.starterHeldItems[${index}]`)
      return {
        pokemonSlug: expectSlugValue(entryRecord.pokemonSlug, `${label}.writeSet.starterHeldItems[${index}].pokemonSlug`),
        itemId: expectString(entryRecord.itemId, `${label}.writeSet.starterHeldItems[${index}].itemId`, 120),
      }
    })

  const plan: OnboardingCommitPlanV1 = {
    schemaVersion: ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION,
    operationId,
    readSet: {
      draft: { draftId, revision: expectInt(draftRecord.revision, `${label}.readSet.draft.revision`, 0, Number.MAX_SAFE_INTEGER) },
      policy: {
        policyId,
        version: expectInt(policyRecord.version, `${label}.readSet.policy.version`, 1, 1_000_000),
        contentHash: expectString(policyRecord.contentHash, `${label}.readSet.policy.contentHash`, 64),
      },
      catalogFingerprint: expectString(readSetRecord.catalogFingerprint, `${label}.readSet.catalogFingerprint`, 64),
      profileId: readSetRecord.profileId,
      slotId,
      slugReservations,
      folderDestinations: expectArray(readSetRecord.folderDestinations, `${label}.readSet.folderDestinations`, 10)
        .map((entry, index) => expectString(entry, `${label}.readSet.folderDestinations[${index}]`)),
    },
    writeSet: {
      sheets,
      profileLinks,
      team,
      startingMoney: expectInt(writeSetRecord.startingMoney, `${label}.writeSet.startingMoney`, 0, 1_000_000),
      inventoryRows,
      starterHeldItems,
      completionRecordId: expectString(writeSetRecord.completionRecordId, `${label}.writeSet.completionRecordId`, 120),
      realtimeEventTypes: expectArray(writeSetRecord.realtimeEventTypes, `${label}.writeSet.realtimeEventTypes`, 20)
        .map((entry, index) => expectString(entry, `${label}.writeSet.realtimeEventTypes[${index}]`, 80)),
    },
  }

  assertOnboardingCommitPlanConsistency(plan, label)
  return plan
}

/** Cross-checks that make a structurally valid plan internally coherent. */
export const assertOnboardingCommitPlanConsistency = (
  plan: OnboardingCommitPlanV1,
  label = 'commitPlan',
): void => {
  const sheetKeys = new Set(plan.writeSet.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`))
  if (sheetKeys.size !== plan.writeSet.sheets.length) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.sheets`, 'planned sheets must not repeat kind+slug')
  }

  const reservationKeys = new Set(plan.readSet.slugReservations.map(entry => `${entry.kind}:${entry.slug}`))
  for (const key of sheetKeys) {
    if (!reservationKeys.has(key)) {
      throw new OnboardingCommitPlanError(`${label}.readSet.slugReservations`, `planned sheet ${key} has no slug reservation`)
    }
  }

  const trainerSheets = plan.writeSet.sheets.filter(sheet => sheet.kind === 'trainer')
  if (trainerSheets.length !== 1) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.sheets`, 'exactly one trainer sheet must be planned')
  }
  if (plan.writeSet.team.trainerSlug !== trainerSheets[0]!.slug) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.team`, 'team.trainerSlug must be the planned trainer sheet')
  }

  const pokemonSlugs = new Set(
    plan.writeSet.sheets.filter(sheet => sheet.kind === 'pokemon').map(sheet => sheet.slug),
  )
  for (const slug of [...plan.writeSet.team.currentTeam, ...plan.writeSet.team.boxedPokemon]) {
    if (!pokemonSlugs.has(slug)) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.team`, `team references ${slug}, which is not a planned pokemon sheet`)
    }
  }
  const teamAll = [...plan.writeSet.team.currentTeam, ...plan.writeSet.team.boxedPokemon]
  if (new Set(teamAll).size !== teamAll.length) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.team`, 'team and box must not repeat slugs')
  }
  if (teamAll.length !== pokemonSlugs.size) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.team`, 'every planned pokemon must be teamed or boxed')
  }

  const linkKeys = new Set(plan.writeSet.profileLinks.map(link => `${link.sheetKind}:${link.sheetSlug}`))
  if (linkKeys.size !== plan.writeSet.profileLinks.length) {
    throw new OnboardingCommitPlanError(`${label}.writeSet.profileLinks`, 'profile links must not repeat')
  }
  for (const link of plan.writeSet.profileLinks) {
    if (!sheetKeys.has(`${link.sheetKind}:${link.sheetSlug}`)) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.profileLinks`, `link ${link.sheetKind}:${link.sheetSlug} references an unplanned sheet`)
    }
    if (link.profileId !== plan.readSet.profileId) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.profileLinks`, 'links must target the read-set profile')
    }
  }
  for (const key of sheetKeys) {
    if (!linkKeys.has(key)) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.profileLinks`, `planned sheet ${key} is never profile-linked`)
    }
  }

  for (const row of plan.writeSet.inventoryRows) {
    if (row.trainerSlug !== plan.writeSet.team.trainerSlug) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.inventoryRows`, 'inventory rows must target the planned trainer')
    }
  }
  for (const held of plan.writeSet.starterHeldItems) {
    if (!pokemonSlugs.has(held.pokemonSlug)) {
      throw new OnboardingCommitPlanError(`${label}.writeSet.starterHeldItems`, `held item targets unplanned pokemon ${held.pokemonSlug}`)
    }
  }
}
