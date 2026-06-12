import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useLivePlayStateMachine } from '~/composables/map-editor/useLivePlayStateMachine'
import type { MapRealtimeReconciliationStatus, MapSaveStatus } from '~/composables/useEditableMap'

const createMachine = () => {
  const mapStatus = ref<MapSaveStatus>('loading')
  const mapError = ref<string | null>(null)
  const realtimeStatus = ref<MapRealtimeReconciliationStatus>('synced')
  const realtimeNotice = ref<string | null>(null)
  const machine = useLivePlayStateMachine({
    mapStatus,
    mapError,
    realtimeStatus,
    realtimeNotice,
  })

  return { mapStatus, mapError, realtimeStatus, realtimeNotice, machine }
}

describe('useLivePlayStateMachine', () => {
  it('starts in loading and allows commands only after the authoritative map is ready', () => {
    const { mapStatus, machine } = createMachine()

    expect(machine.state.value).toBe('loading')
    expect(machine.commandsAllowed.value).toBe(false)
    expect(machine.commandBlockMessage.value).toContain('Loading the authoritative map')

    mapStatus.value = 'idle'

    expect(machine.state.value).toBe('ready')
    expect(machine.commandsAllowed.value).toBe(true)
    expect(machine.commandBlockMessage.value).toBeNull()
  })

  it('moves through saving-command and back to ready when a command is accepted', () => {
    const { mapStatus, machine } = createMachine()
    mapStatus.value = 'idle'

    machine.commandStarted()

    expect(machine.state.value).toBe('saving-command')
    expect(machine.commandsAllowed.value).toBe(false)
    expect(machine.notice.value).toContain('Sending live-play command')

    machine.commandAccepted()

    expect(machine.state.value).toBe('ready')
    expect(machine.commandsAllowed.value).toBe(true)
  })

  it('blocks commands during reconnecting and reconciling realtime states with visible messages', () => {
    const { mapStatus, realtimeStatus, realtimeNotice, machine } = createMachine()
    mapStatus.value = 'idle'

    realtimeStatus.value = 'reconnecting'
    realtimeNotice.value = 'Realtime connection lost. Reconnecting before commands resume.'

    expect(machine.state.value).toBe('reconnecting')
    expect(machine.commandsAllowed.value).toBe(false)
    expect(machine.commandBlockMessage.value).toBe('Realtime connection lost. Reconnecting before commands resume.')

    realtimeStatus.value = 'reconciling'
    realtimeNotice.value = 'Reconnected. Reloading the authoritative map.'

    expect(machine.state.value).toBe('reconciling')
    expect(machine.commandBlockMessage.value).toBe('Reconnected. Reloading the authoritative map.')
  })

  it('marks stale command rejections and then returns to ready after reconciliation succeeds', async () => {
    const { mapStatus, machine } = createMachine()
    mapStatus.value = 'idle'

    machine.commandRejected({
      reason: 'stale-revision',
      message: 'Map revision is stale. Reloading.',
    })

    expect(machine.state.value).toBe('stale')
    expect(machine.commandsAllowed.value).toBe(false)
    expect(machine.notice.value).toBe('Map revision is stale. Reloading.')

    await machine.reconcile(async () => 'reloaded')

    expect(machine.state.value).toBe('ready')
    expect(machine.commandsAllowed.value).toBe(true)
  })

  it('enters error for fatal command failures until the command error is cleared', () => {
    const { mapStatus, machine } = createMachine()
    mapStatus.value = 'idle'

    machine.commandFailed('Network request failed')

    expect(machine.state.value).toBe('error')
    expect(machine.commandsAllowed.value).toBe(false)
    expect(machine.notice.value).toBe('Network request failed')

    machine.clearCommandError()

    expect(machine.state.value).toBe('ready')
    expect(machine.commandsAllowed.value).toBe(true)
  })
})
