import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGmMoveCorrections } from '~/composables/map-editor/useGmMoveCorrections'
import type { TabletopMap } from '~/types/map'
import { MAP_API_PATHS } from '~/utils/apiRoutes'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => apiMocks,
}))
vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'gm-correction-client',
}))

const originOperationId = 'op_composableorig1'
const inverseOperationId = 'inverse.state-change.1.combatStages'

const correctionDetails = (corrections: readonly unknown[] = []) => ({
  schemaVersion: 1,
  mapSlug: 'arena',
  originOperationId,
  moveName: 'Swords Dance',
  acceptedAt: 1_000,
  acceptedRevision: 8,
  operations: [{
    operationId: inverseOperationId,
    effectKind: 'combat-stages',
    reasonCode: 'combat-stage-changed',
    resource: {
      kind: 'sheet',
      sheetKind: 'pokemon',
      sheetSlug: 'actor',
      acceptedRevision: 5,
    },
    availability: 'available',
  }, {
    operationId: 'unavailable.state-change.2',
    effectKind: 'history',
    reasonCode: 'accepted-move-log-projection',
    resource: { kind: 'map', mapSlug: 'arena', acceptedRevision: 8 },
    availability: 'unavailable',
    safety: 'externally-observed',
    unavailableReasonCode: 'accepted-log-may-be-observed',
  }],
  corrections,
})

const mapDocument = (revision = 9): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  revision,
  dimensions: { x: 6, y: 2, z: 6 },
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const createHarness = (enabled = true) => {
  const applyPersistedMap = vi.fn()
  const applySheetUpdate = vi.fn()
  const mapRevision = ref(8)
  const actions = useGmMoveCorrections({
    slug: 'arena',
    enabled: ref(enabled),
    mapRevision,
    applyPersistedMap,
    applySheetUpdate,
    createOperationId: () => 'op_composablefix1',
  })
  return { actions, applyPersistedMap, applySheetUpdate, mapRevision }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useGmMoveCorrections', () => {
  it('loads value-free details and applies an ID-only correction with terminal history', async () => {
    const acceptedHistory = {
      correctionOperationId: 'op_composablefix1',
      originOperationId,
      operationIds: [inverseOperationId],
      status: 'accepted',
      createdAt: 2_000,
      mapRevision: 9,
    }
    apiMocks.getJson
      .mockResolvedValueOnce(correctionDetails())
      .mockResolvedValueOnce(correctionDetails([acceptedHistory]))
    apiMocks.postJson.mockResolvedValueOnce({
      ok: true,
      opId: 'op_composablefix1',
      mapSlug: 'arena',
      previousRevision: 8,
      revision: 9,
      patches: [],
      map: mapDocument(),
      sheetUpdates: [{
        kind: 'pokemon',
        slug: 'actor',
        sheet: { slug: 'actor', revision: 6, combatStages: { atk: 0 } },
      }],
    })
    const harness = createHarness()

    await harness.actions.open(originOperationId)
    expect(harness.actions.status.value).toBe('ready')
    expect(apiMocks.getJson).toHaveBeenCalledWith(MAP_API_PATHS.moveCorrectionDetails, {
      params: { slug: 'arena', originOperationId },
    })

    const applyPromise = harness.actions.apply([inverseOperationId])
    expect(harness.actions.status.value).toBe('pending')
    await applyPromise

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.applyMoveCorrection, {
      schemaVersion: 1,
      opId: 'op_composablefix1',
      mapSlug: 'arena',
      baseRevision: 8,
      type: 'gm-move-correction',
      payload: { originOperationId, operationIds: [inverseOperationId] },
      clientId: 'gm-correction-client',
    })
    const commandJson = JSON.stringify(apiMocks.postJson.mock.calls[0]?.[1])
    expect(commandJson).not.toContain('inverse"')
    expect(commandJson).not.toContain('expectedCurrent')
    expect(commandJson).not.toContain('restore')
    expect(harness.applyPersistedMap).toHaveBeenCalledWith(mapDocument())
    expect(harness.applySheetUpdate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'pokemon',
      slug: 'actor',
    }))
    expect(harness.actions.status.value).toBe('accepted')
    expect(harness.actions.details.value?.corrections).toEqual([acceptedHistory])
  })

  it('shows a durable conflict and never adopts documents from a rejected result', async () => {
    const conflictHistory = {
      correctionOperationId: 'op_composablefix1',
      originOperationId,
      operationIds: [inverseOperationId],
      status: 'conflicted',
      createdAt: 2_000,
      mapRevision: 8,
      reasonCode: 'conflict',
      message: 'The affected sheet changed.',
    }
    apiMocks.getJson
      .mockResolvedValueOnce(correctionDetails())
      .mockResolvedValueOnce(correctionDetails([conflictHistory]))
    apiMocks.postJson.mockResolvedValueOnce({
      ok: false,
      opId: 'op_composablefix1',
      mapSlug: 'arena',
      reason: 'conflict',
      message: 'The affected sheet changed.',
      currentRevision: 8,
    })
    const harness = createHarness()

    await harness.actions.open(originOperationId)
    await harness.actions.apply([inverseOperationId])

    expect(harness.actions.status.value).toBe('conflicted')
    expect(harness.actions.message.value).toBe('The affected sheet changed.')
    expect(harness.applyPersistedMap).not.toHaveBeenCalled()
    expect(harness.applySheetUpdate).not.toHaveBeenCalled()
    expect(harness.actions.details.value?.corrections).toEqual([conflictHistory])
  })

  it('fails locally for non-GMs and unavailable operation IDs', async () => {
    const disabled = createHarness(false)
    await disabled.actions.open(originOperationId)
    expect(disabled.actions.status.value).toBe('error')
    expect(apiMocks.getJson).not.toHaveBeenCalled()

    apiMocks.getJson.mockResolvedValueOnce(correctionDetails())
    const harness = createHarness()
    await harness.actions.open(originOperationId)
    await harness.actions.apply(['unavailable.state-change.2'])
    expect(harness.actions.status.value).toBe('error')
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })
})
