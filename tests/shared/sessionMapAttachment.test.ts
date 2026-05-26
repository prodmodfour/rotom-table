import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  DEFAULT_SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIOR,
  DEFAULT_SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIOR,
  SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS,
  SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS,
  ATTACH_SESSION_MAP_REQUIRED_FIELDS,
  ATTACH_SESSION_MAP_UNTRUSTED_DOCUMENT_FIELDS,
  ATTACH_SESSION_MAP_VALIDATION_CODES,
  assertValidAttachSessionMapInput,
  collectAttachSessionMapInputIssues,
  isAttachSessionMapValidationCode,
  isSessionMapAttachmentSelectedMapBehavior,
  isSessionMapAttachmentVisibilityBehavior,
  isValidAttachSessionMapInput,
  shouldGrantAttachedMapVisibilityToFuturePlayers,
  shouldGrantAttachedMapVisibilityToJoinedPlayers,
  shouldSelectAttachedSessionMap,
  validateAttachSessionMapInput,
  type AttachSessionMapInput,
  type AttachSessionMapRequest,
  type AttachSessionMapRequiredField,
  type AttachSessionMapResult,
  type AttachSessionMapValidationCode,
  type AttachSessionMapVisibilityResult,
  type SessionMapAttachmentSelectedMapBehavior,
  type SessionMapAttachmentVisibilityBehavior,
} from '#shared/sessionMapAttachment'
import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'

const sessionId = parseSessionId('session_attach000001')
const gmKey = parseGmKey('gmkey_attachabcdefghijklmnopqrstuvwxyz')
const gmClientId = parseClientId('client_attachGM1')
const playerId = parsePlayerId('player_attach01')

const minimalInput = {
  sessionId,
  gmKey,
  mapSlug: 'viridian-gym',
} as const satisfies AttachSessionMapInput

const fullInput = {
  sessionId,
  gmKey,
  gmClientId,
  mapSlug: 'pewter-gym',
  selectedMapBehavior: 'preserve-current-selection',
  visibilityBehavior: 'gm-only',
} as const satisfies AttachSessionMapInput

describe('session map attachment contract', () => {
  it('defines selection and visibility behavior vocabulary for persisted map attachment', () => {
    expect(ATTACH_SESSION_MAP_REQUIRED_FIELDS).toEqual(['sessionId', 'gmKey', 'mapSlug'])
    expect(SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS).toEqual([
      'select-attached-map',
      'preserve-current-selection',
    ])
    expect(SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS).toEqual([
      'gm-only',
      'visible-to-joined-players',
      'visible-to-all-players',
    ])
    expect(DEFAULT_SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIOR).toBe('select-attached-map')
    expect(DEFAULT_SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIOR).toBe('visible-to-all-players')
    expect(isSessionMapAttachmentSelectedMapBehavior('select-attached-map')).toBe(true)
    expect(isSessionMapAttachmentSelectedMapBehavior('select-local-map')).toBe(false)
    expect(isSessionMapAttachmentVisibilityBehavior('visible-to-all-players')).toBe(true)
    expect(isSessionMapAttachmentVisibilityBehavior('public-internet')).toBe(false)
    expect(isAttachSessionMapValidationCode('invalid-map-slug')).toBe(true)
    expect(isAttachSessionMapValidationCode('invalid-map-document')).toBe(false)

    expectTypeOf<(typeof ATTACH_SESSION_MAP_REQUIRED_FIELDS)[number]>().toEqualTypeOf<AttachSessionMapRequiredField>()
    expectTypeOf<(typeof ATTACH_SESSION_MAP_VALIDATION_CODES)[number]>().toEqualTypeOf<AttachSessionMapValidationCode>()
    expectTypeOf<(typeof SESSION_MAP_ATTACHMENT_SELECTED_MAP_BEHAVIORS)[number]>().toEqualTypeOf<SessionMapAttachmentSelectedMapBehavior>()
    expectTypeOf<(typeof SESSION_MAP_ATTACHMENT_VISIBILITY_BEHAVIORS)[number]>().toEqualTypeOf<SessionMapAttachmentVisibilityBehavior>()
  })

  it('normalizes valid input to a server-load request with safe defaults', () => {
    const result = validateAttachSessionMapInput(minimalInput)

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected input to be valid')

    expect(result.input).toEqual({
      sessionId,
      gmKey,
      mapSlug: 'viridian-gym',
      selectedMapBehavior: 'select-attached-map',
      visibilityBehavior: 'visible-to-all-players',
    })
    expect(isValidAttachSessionMapInput(minimalInput)).toBe(true)
    expect(assertValidAttachSessionMapInput(minimalInput)).toEqual(result.input)
    expect(result.input).not.toHaveProperty('map')
    expect(result.input).not.toHaveProperty('document')
    expectTypeOf(result.input).toEqualTypeOf<AttachSessionMapRequest>()
  })

  it('accepts optional GM client identity and explicit behavior choices', () => {
    const request = assertValidAttachSessionMapInput(fullInput)

    expect(request).toEqual({
      sessionId,
      gmKey,
      gmClientId,
      mapSlug: 'pewter-gym',
      selectedMapBehavior: 'preserve-current-selection',
      visibilityBehavior: 'gm-only',
    })
    expect(shouldSelectAttachedSessionMap(request.selectedMapBehavior)).toBe(false)
    expect(shouldGrantAttachedMapVisibilityToJoinedPlayers(request.visibilityBehavior)).toBe(false)
    expect(shouldGrantAttachedMapVisibilityToFuturePlayers(request.visibilityBehavior)).toBe(false)

    const joinedVisibility: AttachSessionMapVisibilityResult = {
      behavior: 'visible-to-joined-players',
      grantsJoinedPlayers: shouldGrantAttachedMapVisibilityToJoinedPlayers('visible-to-joined-players'),
      grantsFuturePlayers: shouldGrantAttachedMapVisibilityToFuturePlayers('visible-to-joined-players'),
      visiblePlayerIds: [playerId],
    }
    const allPlayerVisibility: AttachSessionMapVisibilityResult = {
      behavior: 'visible-to-all-players',
      grantsJoinedPlayers: shouldGrantAttachedMapVisibilityToJoinedPlayers('visible-to-all-players'),
      grantsFuturePlayers: shouldGrantAttachedMapVisibilityToFuturePlayers('visible-to-all-players'),
      visiblePlayerIds: [playerId],
    }

    expect(shouldSelectAttachedSessionMap('select-attached-map')).toBe(true)
    expect(joinedVisibility).toMatchObject({
      behavior: 'visible-to-joined-players',
      grantsJoinedPlayers: true,
      grantsFuturePlayers: false,
    })
    expect(allPlayerVisibility).toMatchObject({
      behavior: 'visible-to-all-players',
      grantsJoinedPlayers: true,
      grantsFuturePlayers: true,
    })
  })

  it('models a public result without secrets or map documents', () => {
    const result = {
      session: {
        sessionId,
        revision: parseSessionRevision(4),
        selectedMapSlug: 'viridian-gym',
        mapCount: 1,
      },
      map: {
        mapSlug: 'viridian-gym',
        revision: parseMapRevision(1),
        selected: true,
      },
      selection: {
        behavior: 'select-attached-map',
        previousSelectedMapSlug: null,
        selectedMapSlug: 'viridian-gym',
      },
      visibility: {
        behavior: 'visible-to-all-players',
        grantsJoinedPlayers: true,
        grantsFuturePlayers: true,
        visiblePlayerIds: [playerId],
      },
      snapshot: {
        writtenAt: '2026-05-26T00:00:00.000Z',
        revision: parseSessionRevision(4),
      },
    } as const satisfies AttachSessionMapResult

    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(result).not.toHaveProperty('gmKey')
    expect(result.map).not.toHaveProperty('document')
    expect(result.map).not.toHaveProperty('mapDocument')
  })

  it('reports non-object and missing required field shapes', () => {
    expect(collectAttachSessionMapInputIssues(null)).toMatchObject([
      {
        path: '$',
        code: 'not-object',
      },
    ])

    const issues = collectAttachSessionMapInputIssues({})
    expect(issues.map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      'sessionId:missing-field',
      'gmKey:missing-field',
      'mapSlug:missing-field',
    ])
    expect(validateAttachSessionMapInput({}).valid).toBe(false)
    expect(() => assertValidAttachSessionMapInput({}, 'test map attachment')).toThrow(
      'test map attachment is invalid',
    )
  })

  it('reports malformed identities, persisted map slugs, and behavior choices', () => {
    const issues = collectAttachSessionMapInputIssues({
      sessionId: 'session_short',
      gmKey: 'bad-key',
      gmClientId: 'bad-client',
      mapSlug: 'Viridian Gym',
      selectedMapBehavior: 'replace-browser-map',
      visibilityBehavior: 'everyone-on-the-internet',
    })
    const issueByPath = new Map(issues.map((issue) => [issue.path, issue]))

    expect(issueByPath.get('sessionId')?.code).toBe('invalid-session-id')
    expect(issueByPath.get('gmKey')?.code).toBe('invalid-gm-key')
    expect(issueByPath.get('gmClientId')?.code).toBe('invalid-gm-client-id')
    expect(issueByPath.get('mapSlug')?.code).toBe('invalid-map-slug')
    expect(issueByPath.get('mapSlug')?.expected).toContain('/^[a-z0-9-]+$/')
    expect(issueByPath.get('selectedMapBehavior')?.code).toBe('invalid-selected-map-behavior')
    expect(issueByPath.get('visibilityBehavior')?.code).toBe('invalid-visibility-behavior')
  })

  it('rejects client-provided map documents in attachment input', () => {
    const issues = collectAttachSessionMapInputIssues({
      ...minimalInput,
      map: { cells: [], tokens: [] },
      maps: [{ slug: 'viridian-gym' }],
      document: { name: 'Browser copy' },
      mapDocument: { playerVisible: true },
      mapState: { revision: 99 },
    })

    expect(ATTACH_SESSION_MAP_UNTRUSTED_DOCUMENT_FIELDS).toEqual([
      'map',
      'maps',
      'document',
      'mapDocument',
      'mapState',
    ])
    expect(issues.map((issue) => `${issue.path}:${issue.code}`)).toEqual([
      'map:untrusted-map-document',
      'maps:untrusted-map-document',
      'document:untrusted-map-document',
      'mapDocument:untrusted-map-document',
      'mapState:untrusted-map-document',
    ])
    expect(validateAttachSessionMapInput({ ...minimalInput, document: { unsafe: true } }).valid).toBe(false)
    expect(() => assertValidAttachSessionMapInput({ ...minimalInput, map: { tokens: [] } })).toThrow(
      'the session host loads the map document from storage',
    )
  })
})
