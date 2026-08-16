import {
  parseItemGuidedAdjudicationCommand,
  type ItemGuidedAdjudicationCommandV1,
} from '#shared/itemAutomation/guidedAdjudication'
import { isPlayerProfileId } from '#shared/playerProfiles'

export const ITEM_GUIDED_PENDING_STORAGE_PREFIX = 'rotom-table:item-guided:pending:v1:'

export interface PendingItemGuidedOperationV1 {
  readonly schemaVersion: 1
  readonly scope: string
  readonly profileId: string | null
  readonly command: ItemGuidedAdjudicationCommandV1
}

const SCOPE = /^(?:gm|(?:trainer|pokemon):[a-z0-9]+(?:-[a-z0-9]+)*)$/u
const key = (scope: string): string => `${ITEM_GUIDED_PENDING_STORAGE_PREFIX}${scope}`

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/gu, '').toLocaleLowerCase('en-US')
    if (/^[a-f0-9]{32}$/u.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for guided item operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createItemGuidedOperationId = (): string => `item-guided-operation:v1:${randomHex32()}`

const parsePending = (value: unknown, expectedScope: string): PendingItemGuidedOperationV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending guided item operation must be an object.')
  const input = value as Record<string, unknown>
  const fields = ['schemaVersion', 'scope', 'profileId', 'command']
  if (Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.scope !== expectedScope || !SCOPE.test(expectedScope)
    || (input.profileId !== null && !isPlayerProfileId(input.profileId))) {
    throw new Error('Pending guided item operation has invalid authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    scope: expectedScope,
    profileId: input.profileId as string | null,
    command: parseItemGuidedAdjudicationCommand(input.command),
  })
}

export const loadPendingItemGuidedOperation = (scope: string): PendingItemGuidedOperationV1 | null => {
  if (typeof window === 'undefined' || !SCOPE.test(scope)) return null
  const raw = window.sessionStorage.getItem(key(scope))
  if (raw === null) return null
  try { return parsePending(JSON.parse(raw), scope) }
  catch {
    window.sessionStorage.removeItem(key(scope))
    return null
  }
}

export const retainPendingItemGuidedOperation = (input: PendingItemGuidedOperationV1): PendingItemGuidedOperationV1 => {
  const parsed = parsePending(input, input.scope)
  if (typeof window !== 'undefined') window.sessionStorage.setItem(key(parsed.scope), JSON.stringify(parsed))
  return parsed
}

export const clearPendingItemGuidedOperation = (scope: string, operationId: string): void => {
  if (typeof window === 'undefined') return
  const pending = loadPendingItemGuidedOperation(scope)
  if (pending?.command.operationId === operationId) window.sessionStorage.removeItem(key(scope))
}
