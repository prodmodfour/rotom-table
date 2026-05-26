import { describe, expect, it } from 'vitest'
import {
  buildSessionMapTokenResource,
  normalizeSessionMapTokenResources,
} from '~/utils/sessionTokenAssignmentResources'

const mapSlug = 'training-yard'

describe('session token assignment resource helpers', () => {
  it('builds map-token resources with token, map, sheet kind, and sheet slug details', () => {
    expect(buildSessionMapTokenResource({
      tokenId: ' token-pikachu ',
      mapSlug: ' training-yard ',
      sheetKind: 'pokemon',
      sheetSlug: ' pikachu ',
    })).toEqual({
      kind: 'token',
      tokenId: 'token-pikachu',
      mapSlug,
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
    })
  })

  it('uses the selected session map when a token does not carry its own map slug', () => {
    expect(buildSessionMapTokenResource({
      tokenId: 'token-brock',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
    }, {
      fallbackMapSlug: mapSlug,
    })).toEqual({
      kind: 'token',
      tokenId: 'token-brock',
      mapSlug,
      sheetKind: 'trainer',
      sheetSlug: 'brock',
    })
  })

  it('returns null for missing token or map identity instead of creating an unsafe assignment payload', () => {
    expect(buildSessionMapTokenResource({ tokenId: '', mapSlug })).toBeNull()
    expect(buildSessionMapTokenResource({ tokenId: 'token-pikachu' })).toBeNull()
  })

  it('deduplicates token resources while keeping the richest available sheet details', () => {
    expect(normalizeSessionMapTokenResources([
      { tokenId: 'token-pikachu' },
      { tokenId: 'token-pikachu', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { tokenId: 'token-pikachu', mapSlug: 'other-map', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      { tokenId: 'token-eevee', mapSlug, sheetSlug: 'eevee' },
    ], mapSlug)).toEqual([
      {
        kind: 'token',
        tokenId: 'token-pikachu',
        mapSlug,
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
      {
        kind: 'token',
        tokenId: 'token-pikachu',
        mapSlug: 'other-map',
        sheetKind: 'pokemon',
        sheetSlug: 'pikachu',
      },
      {
        kind: 'token',
        tokenId: 'token-eevee',
        mapSlug,
        sheetSlug: 'eevee',
      },
    ])
  })
})
