import {
  parseItemBreedingOperationCommand,
  type ItemBreedingOperationCommandV1,
} from '#shared/breeding/itemWorkflows'
import { isPlayerProfileId } from '#shared/playerProfiles'

export const ITEM_BREEDING_PENDING_STORAGE_PREFIX = 'rotom-table:item-breeding:pending:v1:'
export interface PendingItemBreedingOperationV1 {
  readonly schemaVersion: 1
  readonly trainerSheetSlug: string
  readonly profileId: string | null
  readonly command: ItemBreedingOperationCommandV1
}
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const key = (trainerSheetSlug: string): string => `${ITEM_BREEDING_PENDING_STORAGE_PREFIX}${trainerSheetSlug}`
const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/gu, '').toLocaleLowerCase('en-US')
    if (/^[0-9a-f]{32}$/u.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for breeding item operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}
export const createItemBreedingOperationId = (): string => `item-breeding:v1:${randomHex32()}`
const parsePending = (value: unknown, expectedSlug: string): PendingItemBreedingOperationV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending breeding item operation must be an object.')
  const row = value as Record<string, unknown>
  const fields = ['schemaVersion','trainerSheetSlug','profileId','command']
  if (Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
    || row.schemaVersion !== 1 || row.trainerSheetSlug !== expectedSlug || !slug.test(expectedSlug)
    || (row.profileId !== null && !isPlayerProfileId(row.profileId))) {
    throw new Error('Pending breeding item operation has invalid authority.')
  }
  const command = parseItemBreedingOperationCommand(row.command)
  if (command.trainerSheetSlug !== expectedSlug) throw new Error('Pending breeding item command targets another Trainer.')
  return Object.freeze({ schemaVersion: 1, trainerSheetSlug: expectedSlug, profileId: row.profileId as string | null, command })
}
export const loadPendingItemBreedingOperation = (trainerSheetSlug: string): PendingItemBreedingOperationV1 | null => {
  if (typeof window === 'undefined' || !slug.test(trainerSheetSlug)) return null
  const raw = window.sessionStorage.getItem(key(trainerSheetSlug))
  if (raw === null) return null
  try { return parsePending(JSON.parse(raw), trainerSheetSlug) }
  catch { window.sessionStorage.removeItem(key(trainerSheetSlug)); return null }
}
export const retainPendingItemBreedingOperation = (input: PendingItemBreedingOperationV1): PendingItemBreedingOperationV1 => {
  const parsed = parsePending(input, input.trainerSheetSlug)
  if (typeof window !== 'undefined') window.sessionStorage.setItem(key(parsed.trainerSheetSlug), JSON.stringify(parsed))
  return parsed
}
export const clearPendingItemBreedingOperation = (trainerSheetSlug: string, operationId: string): void => {
  if (typeof window === 'undefined') return
  const pending = loadPendingItemBreedingOperation(trainerSheetSlug)
  if (pending?.command.operationId === operationId) window.sessionStorage.removeItem(key(trainerSheetSlug))
}
