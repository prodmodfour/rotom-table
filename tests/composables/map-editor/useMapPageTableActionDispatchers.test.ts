import { describe, expect, it, vi } from 'vitest'
import { useMapPageTableActionDispatchers } from '~/composables/map-editor/useMapPageTableActionDispatchers'

describe('useMapPageTableActionDispatchers', () => {
  const liveCommands = () => ({
    useManeuver: vi.fn(async () => ({ dispatched: true })),
    useOrder: vi.fn(async () => ({ dispatched: true })),
  })

  it('leaves setup/edit table actions for local panel fallback', () => {
    const commands = liveCommands()
    const dispatchers = useMapPageTableActionDispatchers({
      isSetupEditMode: () => true,
      livePlayCommands: commands,
    })

    expect(dispatchers.dispatchManeuverUse({ userId: 'actor', maneuverName: 'Trip' })).toBeUndefined()
    expect(dispatchers.dispatchOrderUse({ userId: 'trainer', orderName: 'Agility Training' })).toBeUndefined()
    expect(commands.useManeuver).not.toHaveBeenCalled()
    expect(commands.useOrder).not.toHaveBeenCalled()
  })

  it('routes live manoeuvres and orders through authoritative commands', async () => {
    const commands = liveCommands()
    const dispatchers = useMapPageTableActionDispatchers({
      isSetupEditMode: () => false,
      livePlayCommands: commands,
    })

    await expect(dispatchers.dispatchManeuverUse({
      userId: 'actor',
      maneuverName: 'Trip',
      targetTokenId: 'target',
    })).resolves.toBe(true)
    await expect(dispatchers.dispatchOrderUse({
      userId: 'trainer',
      orderName: 'Agility Training',
      targetTokenId: 'actor',
    })).resolves.toBe(true)

    expect(commands.useManeuver).toHaveBeenCalledWith({
      placementId: 'actor',
      maneuverName: 'Trip',
      targetPlacementId: 'target',
    })
    expect(commands.useOrder).toHaveBeenCalledWith({
      placementId: 'trainer',
      orderName: 'Agility Training',
      targetPlacementId: 'actor',
    })
  })

  it('returns false for rejected or thrown live commands so panels do not run local fallback', async () => {
    const dispatchers = useMapPageTableActionDispatchers({
      isSetupEditMode: () => false,
      livePlayCommands: {
        useManeuver: vi.fn(async () => ({ dispatched: false })),
        useOrder: vi.fn(async () => { throw new Error('transport') }),
      },
    })

    await expect(dispatchers.dispatchManeuverUse({ userId: 'actor', maneuverName: 'Trip' })).resolves.toBe(false)
    await expect(dispatchers.dispatchOrderUse({ userId: 'trainer', orderName: 'Agility Training' })).resolves.toBe(false)
  })
})
