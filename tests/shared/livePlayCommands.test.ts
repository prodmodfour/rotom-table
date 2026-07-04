import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  LIVE_PLAY_CLEAR_HAZARDS_MODES,
  LIVE_PLAY_COMMAND_REJECTION_REASONS,
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_COMMAND_TYPE_VALUES,
  LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS,
  LIVE_PLAY_HAZARD_KIND_VALUES,
  LIVE_PLAY_MAP_COMMAND_TYPE_VALUES,
  LIVE_PLAY_MAP_SCOPE_LANES,
  LIVE_PLAY_OP_ID_PREFIX,
  LIVE_PLAY_PATCH_TYPES,
  LIVE_PLAY_PATCH_TYPE_VALUES,
  LIVE_PLAY_SHOP_SCOPE_FIELDS,
  LIVE_PLAY_TOKEN_SCOPE_FIELDS,
  SHOP_CHECKOUT_COMMAND_REQUIRED_FIELDS,
  SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS,
  assertValidLivePlayCommandEnvelope,
  assertValidShopCheckoutCommandEnvelope,
  collectLivePlayCommandEnvelopeIssues,
  collectShopCheckoutCommandEnvelopeIssues,
  createClearHazardsCommandScopes,
  createLivePlayAcceptedResult,
  createLivePlayDuplicateResult,
  createLivePlayOpId,
  createLivePlayRejectedResult,
  isClearHazardsMode,
  isLivePlayBaseRevision,
  isLivePlayCommandRejectionReason,
  isLivePlayCommandType,
  isLivePlayGroupInventoryScopeField,
  isLivePlayHazardKind,
  isLivePlayMapCommandType,
  isLivePlayMapScopeLane,
  isLivePlayMapSlug,
  isLivePlayOpId,
  isLivePlayPatchType,
  isLivePlayShopScopeField,
  isLivePlayTokenScopeField,
  isShopCheckoutTrainerSheetScopeField,
  isValidLivePlayCommandEnvelope,
  isValidShopCheckoutCommandEnvelope,
  parseClearHazardsPayload,
  parseLivePlayBaseRevision,
  parseLivePlayCommandType,
  parseLivePlayMapCommandType,
  parseLivePlayMapSlug,
  parseLivePlayOpId,
  validateLivePlayCommandEnvelope,
  validateShopCheckoutCommandEnvelope,
  type BuildTerrainVoxelLivePlayCommand,
  type BuildTerrainVoxelPayload,
  type ClearHazardsLivePlayCommand,
  type ClearHazardsPayload,
  type DeleteTokenLivePlayCommand,
  type DeleteTokenPayload,
  type GrantExperienceLivePlayCommand,
  type GrantExperiencePayload,
  type HazardsClearedPatchPayload,
  type LivePlayBaseRevision,
  type LivePlayCommandEnvelope,
  type LivePlayCommandResult,
  type LivePlayGroupInventoryScope,
  type LivePlayMapScope,
  type LivePlayMapScopeLane,
  type LivePlayMapSlug,
  type LivePlayOpId,
  type LivePlayPatch,
  type LivePlayScope,
  type LivePlayShopScope,
  type LivePlayTokenScope,
  type LivePlayTokenScopeField,
  type PlaceHazardLivePlayCommand,
  type PlaceHazardPayload,
  type RemoveTerrainVoxelLivePlayCommand,
  type RemoveTerrainVoxelPayload,
  type SendOutPokemonLivePlayCommand,
  type SendOutPokemonPayload,
  type SetFieldEffectLivePlayCommand,
  type SpawnTokenLivePlayCommand,
  type SpawnTokenPayload,
  type SetFieldEffectPayload,
  type SetInitiativeLivePlayCommand,
  type SetInitiativePayload,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutCommandResult,
  type ShopCheckoutLivePlayCommand,
  type ShopCheckoutPayload,
  type ShopCheckoutTrainerSheetScope,
  type UseAbilityLivePlayCommand,
  type UseAbilityPayload,
  type UseMoveLivePlayCommand,
  type UseMovePayload,
} from '#shared/livePlayCommands'

const opId = parseLivePlayOpId('op_liveplay001')
const mapSlug = parseLivePlayMapSlug('arena-map')
const baseRevision = parseLivePlayBaseRevision(7)

interface MoveTokenPayload {
  readonly placementId: string
  readonly position: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
}

const tokenScope = {
  kind: 'token',
  placementId: 'placement-001',
  field: 'position',
} as const satisfies LivePlayTokenScope

const buildMoveTokenCommand = (): LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  MoveTokenPayload,
  LivePlayTokenScope
> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug,
  baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [tokenScope],
  payload: {
    placementId: 'placement-001',
    position: { x: 4, y: 5, z: 0 },
  },
})

const buildShopCheckoutCommand = (): ShopCheckoutLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: parseLivePlayOpId('op_shopbuy001'),
  type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  scopes: [
    { kind: 'shop', shopSlug: 'general-store', field: 'purchase' },
    { kind: 'shop', shopSlug: 'general-store', field: 'stock' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash-ketchum', field: 'money' },
    { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
  ],
  payload: {
    shopSlug: 'general-store',
    shopRevision: 3,
    paymentSource: { kind: 'trainer', slug: 'ash-ketchum', revision: 12 },
    deliveryTarget: { kind: 'groupInventory', slug: 'party-bag', revision: 5 },
    lines: [{ entryId: 'shop-entry-1', quantity: 2 }],
    origin: { kind: 'shopPage' },
  },
})

describe('live-play command contract', () => {
  it('brands and validates operation ids, map slugs, and base revisions', () => {
    const createdOpId = createLivePlayOpId(() => '123e4567-e89b-12d3-a456-426614174000')

    expect(LIVE_PLAY_OP_ID_PREFIX).toBe('op_')
    expect(opId).toBe('op_liveplay001')
    expect(createdOpId).toBe('op_123e4567-e89b-12d3-a456-426614174000')
    expect(isLivePlayOpId(opId)).toBe(true)
    expect(isLivePlayOpId('op_short')).toBe(false)
    expect(() => parseLivePlayOpId('op_short')).toThrow('opId must match')
    expect(() => createLivePlayOpId(() => 'tiny')).toThrow('opId must match')

    expect(mapSlug).toBe('arena-map')
    expect(isLivePlayMapSlug(mapSlug)).toBe(true)
    expect(isLivePlayMapSlug('Arena Map')).toBe(false)
    expect(() => parseLivePlayMapSlug('../arena')).toThrow('mapSlug must match')

    expect(baseRevision).toBe(7)
    expect(isLivePlayBaseRevision(0)).toBe(true)
    expect(isLivePlayBaseRevision(-1)).toBe(false)
    expect(isLivePlayBaseRevision(1.25)).toBe(false)
    expect(() => parseLivePlayBaseRevision(-1)).toThrow('baseRevision must be')

    expectTypeOf(opId).toEqualTypeOf<LivePlayOpId>()
    expectTypeOf(mapSlug).toEqualTypeOf<LivePlayMapSlug>()
    expectTypeOf(baseRevision).toEqualTypeOf<LivePlayBaseRevision>()
  })

  it('defines supported command, patch, and reusable resource scope constants', () => {
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('moveToken')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('modifyHp')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('grantExperience')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('useAbility')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('resolveMove')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('setInitiative')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('placeHazard')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('clearHazards')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('setFieldEffect')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('buildTerrainVoxel')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('removeTerrainVoxel')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('spawnToken')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('sendOutPokemon')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('deleteToken')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('throwPokeball')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('setScene')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('updateStartTurnModal')
    expect(LIVE_PLAY_COMMAND_TYPE_VALUES).toContain('shopCheckout')
    expect(LIVE_PLAY_MAP_COMMAND_TYPE_VALUES).not.toContain('shopCheckout')
    expect(isLivePlayCommandType(LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN)).toBe(true)
    expect(isLivePlayCommandType(LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS)).toBe(true)
    expect(isLivePlayCommandType(LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT)).toBe(true)
    expect(isLivePlayMapCommandType(LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN)).toBe(true)
    expect(isLivePlayMapCommandType(LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT)).toBe(false)
    expect(isLivePlayCommandType('teleportToken')).toBe(false)
    expect(parseLivePlayCommandType('useMove')).toBe('useMove')
    expect(parseLivePlayCommandType('clearHazards')).toBe('clearHazards')
    expect(parseLivePlayCommandType('shopCheckout')).toBe('shopCheckout')
    expect(parseLivePlayMapCommandType('useMove')).toBe('useMove')
    expect(parseLivePlayMapCommandType('clearHazards')).toBe('clearHazards')
    expect(() => parseLivePlayCommandType('teleportToken')).toThrow(
      'supported live-play command type',
    )
    expect(() => parseLivePlayMapCommandType('shopCheckout')).toThrow(
      'supported map live-play command type',
    )

    expect(LIVE_PLAY_PATCH_TYPE_VALUES).toContain('token.position')
    expect(LIVE_PLAY_PATCH_TYPE_VALUES).toContain('sheet.field')
    expect(LIVE_PLAY_PATCH_TYPE_VALUES).toContain('move.state')
    expect(LIVE_PLAY_PATCH_TYPE_VALUES).toContain('map.scene')
    expect(isLivePlayPatchType(LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS)).toBe(true)
    expect(isLivePlayPatchType('map.updated-document')).toBe(false)

    expect(LIVE_PLAY_MAP_SCOPE_LANES).toEqual([
      'initiative',
      'hazards',
      'fieldEffects',
      'terrain',
      'placements',
      'scene',
      'metadata',
    ])
    expect(LIVE_PLAY_TOKEN_SCOPE_FIELDS).toEqual([
      'position',
      'facing',
      'hp',
      'conditions',
      'combatStages',
      'experience',
      'moveUsage',
      'action',
      'spawn',
      'sendOut',
      'delete',
    ])
    expect(LIVE_PLAY_SHOP_SCOPE_FIELDS).toEqual(['stock', 'purchase'])
    expect(LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS).toEqual(['money', 'inventory'])
    expect(SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS).toEqual(['money', 'inventory'])
    expect(SHOP_CHECKOUT_COMMAND_REQUIRED_FIELDS).toEqual([
      'schemaVersion',
      'opId',
      'type',
      'scopes',
      'payload',
    ])
    expect(LIVE_PLAY_CLEAR_HAZARDS_MODES).toEqual(['all', 'cells', 'kind'])
    expect(LIVE_PLAY_HAZARD_KIND_VALUES).toEqual(['spikes', 'toxic-spikes', 'sticky-web', 'stealth-rock', 'fire'])
    expect(isClearHazardsMode('cells')).toBe(true)
    expect(isClearHazardsMode('explicit')).toBe(false)
    expect(isLivePlayHazardKind('stealth-rock')).toBe(true)
    expect(isLivePlayHazardKind('bad-hazard')).toBe(false)
    expect(isLivePlayMapScopeLane('initiative')).toBe(true)
    expect(isLivePlayMapScopeLane('wholeMap')).toBe(false)
    expect(isLivePlayTokenScopeField('position')).toBe(true)
    expect(isLivePlayTokenScopeField('inventory')).toBe(false)
    expect(isLivePlayShopScopeField('stock')).toBe(true)
    expect(isLivePlayShopScopeField('price')).toBe(false)
    expect(isLivePlayGroupInventoryScopeField('money')).toBe(true)
    expect(isLivePlayGroupInventoryScopeField('stock')).toBe(false)
    expect(isShopCheckoutTrainerSheetScopeField('inventory')).toBe(true)
    expect(isShopCheckoutTrainerSheetScopeField('currentHp')).toBe(false)

    const mapScope = { kind: 'map', lane: 'initiative' } as const satisfies LivePlayMapScope
    const sheetScope = {
      kind: 'sheet',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      field: 'currentHp',
    } as const satisfies LivePlayScope
    const shopScope = {
      kind: 'shop',
      shopSlug: 'general-store',
      field: 'stock',
    } as const satisfies LivePlayShopScope
    const groupInventoryScope = {
      kind: 'groupInventory',
      slug: 'party-bag',
      field: 'inventory',
    } as const satisfies LivePlayGroupInventoryScope
    const trainerCheckoutScope = {
      kind: 'sheet',
      sheetKind: 'trainer',
      sheetSlug: 'ash-ketchum',
      field: 'money',
    } as const satisfies ShopCheckoutTrainerSheetScope

    expect(mapScope.lane).toBe('initiative')
    expect(sheetScope.sheetSlug).toBe('pikachu')
    expect(shopScope.shopSlug).toBe('general-store')
    expect(groupInventoryScope.slug).toBe('party-bag')
    expect(trainerCheckoutScope.field).toBe('money')
    expectTypeOf(mapScope.lane).toMatchTypeOf<LivePlayMapScopeLane>()
    expectTypeOf(tokenScope.field).toMatchTypeOf<LivePlayTokenScopeField>()
  })

  it('models canonical command envelopes without command-specific persistence imports', () => {
    const command = buildMoveTokenCommand()

    expect(command.schemaVersion).toBe(1)
    expect(command.opId).toBe(opId)
    expect(command.mapSlug).toBe(mapSlug)
    expect(command.baseRevision).toBe(7)
    expect(command.type).toBe('moveToken')
    expect(command.scopes).toEqual([tokenScope])
    expect(command.payload.position).toEqual({ x: 4, y: 5, z: 0 })

    const useMoveCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      scopes: [{ kind: 'token', placementId: 'placement-001', field: 'moveUsage' }],
      payload: { placementId: 'placement-001', moveName: 'Thunderbolt' },
    } as const satisfies UseMoveLivePlayCommand

    expect(useMoveCommand.type).toBe('useMove')
    expect(useMoveCommand.payload).toEqual({ placementId: 'placement-001', moveName: 'Thunderbolt' })

    const useAbilityCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      scopes: [{ kind: 'token', placementId: 'placement-001', field: 'action' }],
      payload: { placementId: 'placement-001', abilityName: 'Healer', targetPlacementId: 'placement-002' },
    } as const satisfies UseAbilityLivePlayCommand

    expect(useAbilityCommand.type).toBe('useAbility')
    expect(useAbilityCommand.payload).toEqual({
      placementId: 'placement-001',
      abilityName: 'Healer',
      targetPlacementId: 'placement-002',
    })

    const grantExperienceCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      scopes: [{ kind: 'token', placementId: 'placement-001', field: 'experience' }],
      payload: { placementId: 'placement-001', amount: 25 },
    } as const satisfies GrantExperienceLivePlayCommand

    expect(grantExperienceCommand.type).toBe('grantExperience')
    expect(grantExperienceCommand.payload).toEqual({ placementId: 'placement-001', amount: 25 })

    const initiativeCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: { tokenId: 'placement-001', initiative: 12, activeId: 'placement-001', round: 2 },
    } as const satisfies SetInitiativeLivePlayCommand

    expect(initiativeCommand.type).toBe('setInitiative')
    expect(initiativeCommand.payload).toEqual({ tokenId: 'placement-001', initiative: 12, activeId: 'placement-001', round: 2 })

    const hazardCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: { hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } },
    } as const satisfies PlaceHazardLivePlayCommand

    expect(hazardCommand.type).toBe('placeHazard')
    expect(hazardCommand.payload.hazard).toEqual({ kind: 'spikes', x: 1, y: 0, z: 2 })

    const clearHazardsPayload = {
      mode: 'cells',
      cells: [{ x: 1, y: 0, z: 2 }],
      kind: 'spikes',
    } as const satisfies ClearHazardsPayload
    const clearHazardsCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
      scopes: createClearHazardsCommandScopes(clearHazardsPayload),
      payload: clearHazardsPayload,
    } as const satisfies ClearHazardsLivePlayCommand

    expect(clearHazardsCommand.type).toBe('clearHazards')
    expect(clearHazardsCommand.scopes).toEqual([
      { kind: 'map', lane: 'hazards', cell: { x: 1, y: 0, z: 2 } },
    ])
    expect(clearHazardsCommand.payload).toEqual({
      mode: 'cells',
      cells: [{ x: 1, y: 0, z: 2 }],
      kind: 'spikes',
    })

    const fieldEffectCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: { category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' },
    } as const satisfies SetFieldEffectLivePlayCommand

    expect(fieldEffectCommand.type).toBe('setFieldEffect')
    expect(fieldEffectCommand.payload).toEqual({ category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' })

    const buildTerrainCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { voxel: { x: 1, y: 0, z: 2, materialId: 'meadow_grass' } },
    } as const satisfies BuildTerrainVoxelLivePlayCommand

    const removeTerrainCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { cell: { x: 1, y: 0, z: 2 } },
    } as const satisfies RemoveTerrainVoxelLivePlayCommand

    expect(buildTerrainCommand.type).toBe('buildTerrainVoxel')
    expect(buildTerrainCommand.payload.voxel).toEqual({ x: 1, y: 0, z: 2, materialId: 'meadow_grass' })
    expect(removeTerrainCommand.type).toBe('removeTerrainVoxel')
    expect(removeTerrainCommand.payload.cell).toEqual({ x: 1, y: 0, z: 2 })

    const spawnTokenCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      scopes: [{ kind: 'token', placementId: 'placement-002', field: 'spawn' }],
      payload: {
        placement: {
          id: 'placement-002',
          sheetKind: 'pokemon',
          sheetSlug: 'eevee',
          position: { x: 2, y: 0, z: 2 },
          facing: 'south-east',
          turned: false,
        },
      },
    } as const satisfies SpawnTokenLivePlayCommand

    const sendOutPokemonCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
      scopes: [
        { kind: 'token', placementId: 'trainer-001', field: 'sendOut' },
        { kind: 'token', placementId: 'placement-003', field: 'spawn' },
      ],
      payload: {
        trainerId: 'trainer-001',
        pokemonSlug: 'eevee',
        tokenId: 'placement-003',
        position: { x: 3, y: 0, z: 2 },
        facing: 'south-east',
      },
    } as const satisfies SendOutPokemonLivePlayCommand

    const deleteTokenCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug,
      baseRevision,
      type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'placement-002', field: 'delete' }],
      payload: { placementId: 'placement-002' },
    } as const satisfies DeleteTokenLivePlayCommand

    expect(spawnTokenCommand.type).toBe('spawnToken')
    expect(spawnTokenCommand.payload.placement.id).toBe('placement-002')
    expect(sendOutPokemonCommand.type).toBe('sendOutPokemon')
    expect(sendOutPokemonCommand.payload).toMatchObject({ trainerId: 'trainer-001', pokemonSlug: 'eevee' })
    expect(deleteTokenCommand.type).toBe('deleteToken')
    expect(deleteTokenCommand.payload).toEqual({ placementId: 'placement-002' })

    expectTypeOf(command).toEqualTypeOf<
      LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN, MoveTokenPayload, LivePlayTokenScope>
    >()
    expectTypeOf(useMoveCommand.payload).toMatchTypeOf<UseMovePayload>()
    expectTypeOf(useAbilityCommand.payload).toMatchTypeOf<UseAbilityPayload>()
    expectTypeOf(grantExperienceCommand.payload).toMatchTypeOf<GrantExperiencePayload>()
    expectTypeOf(initiativeCommand.payload).toMatchTypeOf<SetInitiativePayload>()
    expectTypeOf(hazardCommand.payload).toMatchTypeOf<PlaceHazardPayload>()
    expectTypeOf(clearHazardsCommand.payload).toMatchTypeOf<ClearHazardsPayload>()
    expectTypeOf(fieldEffectCommand.payload).toMatchTypeOf<SetFieldEffectPayload>()
    expectTypeOf(buildTerrainCommand.payload).toMatchTypeOf<BuildTerrainVoxelPayload>()
    expectTypeOf(removeTerrainCommand.payload).toMatchTypeOf<RemoveTerrainVoxelPayload>()
    expectTypeOf(spawnTokenCommand.payload).toMatchTypeOf<SpawnTokenPayload>()
    expectTypeOf(sendOutPokemonCommand.payload).toMatchTypeOf<SendOutPokemonPayload>()
    expectTypeOf(deleteTokenCommand.payload).toMatchTypeOf<DeleteTokenPayload>()
  })

  it('validates clearHazards payload modes and strict batch fields', () => {
    const all = parseClearHazardsPayload({ mode: 'all' })
    expect(all).toEqual({ valid: true, value: { mode: 'all' }, issues: [] })

    const explicitCellsInput = {
      mode: 'cells',
      cells: [
        { x: 1, y: 0, z: 2 },
        { x: 1, y: 0, z: 2 },
        { x: 3, y: 0, z: 4 },
      ],
      kind: 'toxic-spikes',
    }
    const explicitCellsBefore = structuredClone(explicitCellsInput)
    const explicitCells = parseClearHazardsPayload(explicitCellsInput)
    expect(explicitCells.valid).toBe(true)
    if (!explicitCells.valid) throw new Error('expected explicit clearHazards cells payload')
    expect(explicitCells.value).toEqual({
      mode: 'cells',
      cells: [
        { x: 1, y: 0, z: 2 },
        { x: 3, y: 0, z: 4 },
      ],
      kind: 'toxic-spikes',
    })
    expect(explicitCellsInput).toEqual(explicitCellsBefore)

    const kind = parseClearHazardsPayload({ mode: 'kind', kind: 'sticky-web' })
    expect(kind).toEqual({ valid: true, value: { mode: 'kind', kind: 'sticky-web' }, issues: [] })

    const emptyCells = parseClearHazardsPayload({ mode: 'cells', cells: [] })
    expect(emptyCells.valid).toBe(false)
    if (emptyCells.valid) throw new Error('expected empty clearHazards cells payload to reject')
    expect(new Map(emptyCells.issues.map((issue) => [issue.path, issue])).get('payload.cells')).toMatchObject({
      code: 'empty-array',
      message: expect.stringContaining('at least 1'),
    })

    const invalidMode = parseClearHazardsPayload({ mode: 'explicit', cells: [{ x: 1, y: 0, z: 2 }] })
    expect(invalidMode.valid).toBe(false)
    if (invalidMode.valid) throw new Error('expected invalid mode to reject')
    expect(new Map(invalidMode.issues.map((issue) => [issue.path, issue])).get('payload.mode')?.code)
      .toBe('invalid-mode')

    const invalidKind = parseClearHazardsPayload({ mode: 'kind', kind: 'fog' })
    expect(invalidKind.valid).toBe(false)
    if (invalidKind.valid) throw new Error('expected invalid kind to reject')
    expect(new Map(invalidKind.issues.map((issue) => [issue.path, issue])).get('payload.kind')?.code)
      .toBe('invalid-kind')

    const unknownField = parseClearHazardsPayload({ mode: 'all', profileId: 'private-profile' })
    expect(unknownField.valid).toBe(false)
    if (unknownField.valid) throw new Error('expected unknown fields to reject')
    expect(new Map(unknownField.issues.map((issue) => [issue.path, issue])).get('payload.profileId')?.code)
      .toBe('unknown-field')
  })

  it('constructs conservative and precise clearHazards conflict scopes', () => {
    expect(createClearHazardsCommandScopes({ mode: 'all' })).toEqual([
      { kind: 'map', lane: 'hazards' },
    ])
    expect(createClearHazardsCommandScopes({ mode: 'kind', kind: 'fire' })).toEqual([
      { kind: 'map', lane: 'hazards' },
    ])

    const payload = {
      mode: 'cells',
      cells: [
        { x: 1, y: 0, z: 2 },
        { x: 3, y: 0, z: 4 },
      ],
    } as const satisfies ClearHazardsPayload
    const scopes = createClearHazardsCommandScopes(payload)

    expect(scopes).toEqual([
      { kind: 'map', lane: 'hazards', cell: { x: 1, y: 0, z: 2 } },
      { kind: 'map', lane: 'hazards', cell: { x: 3, y: 0, z: 4 } },
    ])
    expect('cell' in scopes[0] ? scopes[0].cell : null).not.toBe(payload.cells[0])
  })

  it('models clearHazards map-hazard accepted patches with final authoritative hazards', () => {
    const payload = {
      command: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
      mode: 'kind',
      kind: 'spikes',
      previous: [
        { kind: 'spikes', x: 1, y: 0, z: 2 },
        { kind: 'fire', x: 3, y: 0, z: 4 },
      ],
      current: [{ kind: 'fire', x: 3, y: 0, z: 4 }],
      removed: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
    } as const satisfies HazardsClearedPatchPayload

    const patch = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
      mapSlug,
      revision: 8,
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload,
    } as const satisfies LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS, HazardsClearedPatchPayload>

    expect(patch.payload.current).toEqual([{ kind: 'fire', x: 3, y: 0, z: 4 }])
  })

  it('models shop checkout command envelopes without map persistence fields', () => {
    const command = buildShopCheckoutCommand()
    const result = validateShopCheckoutCommandEnvelope<typeof command>(command)

    expect(command.schemaVersion).toBe(1)
    expect(command.type).toBe('shopCheckout')
    expect(command.payload).toEqual({
      shopSlug: 'general-store',
      shopRevision: 3,
      paymentSource: { kind: 'trainer', slug: 'ash-ketchum', revision: 12 },
      deliveryTarget: { kind: 'groupInventory', slug: 'party-bag', revision: 5 },
      lines: [{ entryId: 'shop-entry-1', quantity: 2 }],
      origin: { kind: 'shopPage' },
    })
    expect(command.scopes).toEqual([
      { kind: 'shop', shopSlug: 'general-store', field: 'purchase' },
      { kind: 'shop', shopSlug: 'general-store', field: 'stock' },
      { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash-ketchum', field: 'money' },
      { kind: 'groupInventory', slug: 'party-bag', field: 'inventory' },
    ])
    expect(collectShopCheckoutCommandEnvelopeIssues(command)).toEqual([])
    expect(isValidShopCheckoutCommandEnvelope(command)).toBe(true)
    expect(assertValidShopCheckoutCommandEnvelope(command)).toBe(command)
    expect(validateLivePlayCommandEnvelope(command).valid).toBe(false)

    if (result.valid) {
      expect(result.command.payload.shopSlug).toBe('general-store')
      expectTypeOf(result.command).toEqualTypeOf<typeof command>()
    }

    expectTypeOf(command.payload).toMatchTypeOf<ShopCheckoutPayload>()
  })

  it('defines shop checkout terminal result interfaces for authoritative document updates', () => {
    expectTypeOf<ShopCheckoutCommandAccepted>().toMatchTypeOf<ShopCheckoutCommandResult>()
    expectTypeOf<ShopCheckoutCommandRejected>().toMatchTypeOf<ShopCheckoutCommandResult>()

    const accepted = {
      ok: true,
      opId: parseLivePlayOpId('op_shopbuy002'),
      shopSlug: 'general-store',
      previousShopRevision: 3,
      shopRevision: 4,
      totalPrice: 400,
      lines: [
        {
          entryId: 'shop-entry-1',
          itemName: 'Potion',
          section: 'medicalKit',
          quantity: 2,
          unitPrice: 200,
          lineTotal: 400,
          stock: 8,
        },
      ],
      documents: {
        shop: {
          slug: 'general-store',
          revision: 4,
          updatedAt: 1_700_000_000,
          name: 'General Store',
          playerVisible: true,
          open: true,
          allowedPaymentSources: ['trainer'],
          allowedDeliveryTargets: ['trainer', 'groupInventory'],
          entries: [],
        },
      },
    } satisfies ShopCheckoutCommandAccepted

    expect(accepted.lines[0].lineTotal).toBe(400)
    expect(accepted.documents.shop.revision).toBe(4)
  })

  it('rejects malformed shop checkout command envelopes without requiring map state', () => {
    const invalidEnvelope = {
      schemaVersion: 2,
      opId: 'not-an-op-id',
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [
        { kind: 'shop', shopSlug: 'Bad Slug', field: 'price' },
        { kind: 'groupInventory', slug: 'Party Bag', field: 'stock' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'currentHp' },
        { kind: 'map', lane: 'terrain' },
      ],
      payload: undefined,
    }

    const issues = collectShopCheckoutCommandEnvelopeIssues(invalidEnvelope)
    const issueByPath = new Map(issues.map((issue) => [issue.path, issue]))

    expect(validateShopCheckoutCommandEnvelope(invalidEnvelope).valid).toBe(false)
    expect(issueByPath.get('schemaVersion')?.code).toBe('invalid-schema-version')
    expect(issueByPath.get('opId')?.code).toBe('invalid-op-id')
    expect(issueByPath.get('type')?.code).toBe('unsupported-command-type')
    expect(issueByPath.get('scopes[0].shopSlug')?.code).toBe('invalid-shop-scope')
    expect(issueByPath.get('scopes[0].field')?.code).toBe('invalid-shop-scope')
    expect(issueByPath.get('scopes[1].slug')?.code).toBe('invalid-group-inventory-scope')
    expect(issueByPath.get('scopes[1].field')?.code).toBe('invalid-group-inventory-scope')
    expect(issueByPath.get('scopes[2].sheetKind')?.code).toBe('invalid-sheet-scope')
    expect(issueByPath.get('scopes[2].field')?.code).toBe('invalid-sheet-scope')
    expect(issueByPath.get('scopes[3].kind')?.code).toBe('invalid-scope-kind')
    expect(issueByPath.get('payload')?.code).toBe('invalid-payload')
  })

  it('builds accepted, rejected, and duplicate results with reusable shapes', () => {
    const patch = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      mapSlug,
      revision: 8,
      scopes: [tokenScope],
      payload: {
        placementId: 'placement-001',
        position: { x: 4, y: 5, z: 0 },
      },
    } as const satisfies LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION>

    const accepted = createLivePlayAcceptedResult({
      opId,
      mapSlug,
      previousRevision: 7,
      revision: 8,
      patches: [patch],
    })
    const rejected = createLivePlayRejectedResult({
      opId: parseLivePlayOpId('op_liveplay002'),
      mapSlug,
      reason: 'stale-revision',
      message: 'Refresh the map before retrying.',
      currentRevision: 8,
      currentState: { revision: 8 },
    })
    const duplicate = createLivePlayDuplicateResult({ original: accepted })

    expect(LIVE_PLAY_COMMAND_REJECTION_REASONS).toEqual([
      'invalid',
      'unauthorized',
      'not-found',
      'stale-revision',
      'conflict',
      'no-op',
      'persistence-failed',
      'abandoned',
    ])
    expect(isLivePlayCommandRejectionReason('conflict')).toBe(true)
    expect(isLivePlayCommandRejectionReason('abandoned')).toBe(true)
    expect(isLivePlayCommandRejectionReason('stale')).toBe(false)

    expect(accepted).toMatchObject({ ok: true, opId, mapSlug, previousRevision: 7, revision: 8 })
    expect(accepted.patches).toEqual([patch])
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 8,
    })
    expect(duplicate).toEqual({ ok: true, duplicate: true, opId, original: accepted })

    expectTypeOf(accepted).toMatchTypeOf<LivePlayCommandResult>()
    expectTypeOf(rejected).toMatchTypeOf<LivePlayCommandResult>()
    expectTypeOf(duplicate).toMatchTypeOf<LivePlayCommandResult>()
  })

  it('validates common envelope fields including opId, baseRevision, and supported command type', () => {
    const command = buildMoveTokenCommand()
    const result = validateLivePlayCommandEnvelope<typeof command>(command)

    expect(result.valid).toBe(true)
    expect(collectLivePlayCommandEnvelopeIssues(command)).toEqual([])
    expect(isValidLivePlayCommandEnvelope(command)).toBe(true)
    expect(assertValidLivePlayCommandEnvelope(command)).toBe(command)

    if (result.valid) {
      expect(result.command.payload.placementId).toBe('placement-001')
      expectTypeOf(result.command).toEqualTypeOf<typeof command>()
    }

    const invalidEnvelope = {
      ...command,
      schemaVersion: 2,
      opId: 'not-an-op-id',
      mapSlug: '../arena',
      baseRevision: -1,
      type: 'teleportToken',
      scopes: [
        { kind: 'map', lane: 'wholeMap' },
        { kind: 'token', placementId: '', field: 'inventory' },
        { kind: 'sheet', sheetKind: 'npc', sheetSlug: 'Bad Slug', field: '' },
      ],
    }

    const issues = collectLivePlayCommandEnvelopeIssues(invalidEnvelope)
    const issueByPath = new Map(issues.map((issue) => [issue.path, issue]))

    expect(validateLivePlayCommandEnvelope(invalidEnvelope).valid).toBe(false)
    expect(issueByPath.get('schemaVersion')?.code).toBe('invalid-schema-version')
    expect(issueByPath.get('opId')?.code).toBe('invalid-op-id')
    expect(issueByPath.get('mapSlug')?.code).toBe('invalid-map-slug')
    expect(issueByPath.get('baseRevision')?.code).toBe('invalid-base-revision')
    expect(issueByPath.get('type')?.code).toBe('unsupported-command-type')
    expect(issueByPath.get('scopes[0].lane')?.code).toBe('invalid-map-scope')
    expect(issueByPath.get('scopes[1].placementId')?.code).toBe('invalid-token-scope')
    expect(issueByPath.get('scopes[1].field')?.code).toBe('invalid-token-scope')
    expect(issueByPath.get('scopes[2].sheetKind')?.code).toBe('invalid-sheet-scope')
    expect(issueByPath.get('scopes[2].sheetSlug')?.code).toBe('invalid-sheet-scope')
    expect(issueByPath.get('scopes[2].field')?.code).toBe('invalid-sheet-scope')
  })
})
