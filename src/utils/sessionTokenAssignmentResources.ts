import type { SessionTokenResourceRef } from '#shared/sessionPermissions'
import { isSheetKind, type SheetKind } from '#shared/sheets'

export interface SessionMapTokenResourceInput {
  readonly tokenId?: string | null
  readonly mapSlug?: string | null
  readonly sheetKind?: SheetKind | null
  readonly sheetSlug?: string | null
}

export interface BuildSessionMapTokenResourceOptions {
  readonly fallbackMapSlug?: string | null
}

export const normalizeSessionTokenAssignmentText = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const normalizeSheetKind = (value: SheetKind | null | undefined): SheetKind | undefined =>
  isSheetKind(value) ? value : undefined

export const sessionTokenResourceKey = (
  resource: Pick<SessionTokenResourceRef, 'tokenId' | 'mapSlug'>,
): string => `${resource.mapSlug ?? 'current-map'}::${resource.tokenId}`

const sessionTokenResourceDetailScore = (resource: SessionTokenResourceRef): number =>
  (resource.mapSlug === undefined ? 0 : 1) +
  (resource.sheetKind === undefined ? 0 : 1) +
  (resource.sheetSlug === undefined ? 0 : 1)

export const buildSessionMapTokenResource = (
  input: SessionMapTokenResourceInput,
  options: BuildSessionMapTokenResourceOptions = {},
): SessionTokenResourceRef | null => {
  const tokenId = normalizeSessionTokenAssignmentText(input.tokenId)
  const mapSlug = normalizeSessionTokenAssignmentText(input.mapSlug)
    ?? normalizeSessionTokenAssignmentText(options.fallbackMapSlug)
  if (tokenId === null || mapSlug === null) return null

  const sheetKind = normalizeSheetKind(input.sheetKind)
  const sheetSlug = normalizeSessionTokenAssignmentText(input.sheetSlug)

  return {
    kind: 'token',
    tokenId,
    mapSlug,
    ...(sheetKind === undefined ? {} : { sheetKind }),
    ...(sheetSlug === null ? {} : { sheetSlug }),
  }
}

export const normalizeSessionMapTokenResources = (
  tokens: readonly SessionMapTokenResourceInput[],
  fallbackMapSlug: string | null,
): readonly SessionTokenResourceRef[] => {
  const resourcesByKey = new Map<string, SessionTokenResourceRef>()

  for (const token of tokens) {
    const resource = buildSessionMapTokenResource(token, { fallbackMapSlug })
    if (resource === null) continue

    const key = sessionTokenResourceKey(resource)
    const existing = resourcesByKey.get(key)
    if (
      existing === undefined ||
      sessionTokenResourceDetailScore(resource) > sessionTokenResourceDetailScore(existing)
    ) {
      resourcesByKey.set(key, resource)
    }
  }

  return [...resourcesByKey.values()]
}
