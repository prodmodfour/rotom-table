/**
 * @vitest-environment happy-dom
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import LivePlayCommandRecoveryPanel from '~/components/map/LivePlayCommandRecoveryPanel.vue'
import {
  LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
  type LivePlayCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'

const createEntry = (
  state: LivePlayCommandOutboxEntry['state'],
  overrides: Partial<LivePlayCommandOutboxEntry> = {},
): LivePlayCommandOutboxEntry => {
  const opId = overrides.opId ?? `op_panel${state}001`
  return {
    schemaVersion: LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
    opId,
    mapSlug: 'arena-map',
    commandType: overrides.commandType ?? LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    requestPath: '/api/maps/token/move',
    body: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug: 'arena-map',
      baseRevision: 7,
      type: overrides.commandType ?? LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'secret-token-id', field: 'position' }],
      payload: { placementId: 'secret-token-id', privateSheet: 'do-not-render' },
      clientId: 'secret-client',
    },
    authContext: { role: 'player', profileId: parsePlayerProfileId('profile_secret000') },
    fingerprint: `fingerprint-${opId}`,
    state,
    createdAt: 1,
    updatedAt: 1,
    attemptCount: 2,
    ...(state === 'sending' ? { leaseOwner: 'other-tab', leaseExpiresAt: Date.now() + 30_000 } : {}),
    ...overrides,
  }
}

describe('LivePlayCommandRecoveryPanel', () => {
  it('renders queued, uncertain, and sending entries with safe retry guidance', () => {
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [
          createEntry('queued', { commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN, opId: 'op_panelqueued01' }),
          createEntry('uncertain', {
            commandType: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
            opId: 'op_paneluncertain01',
            lastError: 'The previous send ended without a terminal response.',
          }),
          createEntry('sending', { commandType: LIVE_PLAY_COMMAND_TYPES.SET_SCENE, opId: 'op_panelsending01' }),
        ],
        recoveryStatus: 'idle',
        recoveryError: null,
        blockMessage: 'Resolve the pending live-play commands before sending another action.',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        retryDisabledMessage: null,
      },
    })

    expect(wrapper.text()).toContain('Move token')
    expect(wrapper.text()).toContain('Throw Poké Ball')
    expect(wrapper.text()).toContain('Set scene')
    expect(wrapper.text()).toContain('Queued')
    expect(wrapper.text()).toContain('Uncertain')
    expect(wrapper.text()).toContain('Sending')
    expect(wrapper.text()).toContain('Retry reuses the original operation ID')
    expect(wrapper.text()).toContain('server is idempotent')
    expect(wrapper.text()).toContain('Another tab or page instance may own this send lease')

    const checkButtons = wrapper.findAll('button').filter((button) => button.text().includes('Check server'))
    expect(checkButtons).toHaveLength(3)
    expect(checkButtons.every((button) => button.attributes('disabled') === undefined)).toBe(true)

    const retryButtons = wrapper.findAll('button').filter((button) => button.text().includes('Retry'))
    expect(retryButtons).toHaveLength(3)
    expect(retryButtons[0]?.attributes('disabled')).toBeUndefined()
    expect(retryButtons[1]?.attributes('disabled')).toBeUndefined()
    expect(retryButtons[2]?.attributes('disabled')).toBeDefined()

    const abandonButtons = wrapper.findAll('button').filter((button) => button.text().includes('Abandon…'))
    expect(abandonButtons).toHaveLength(3)
    expect(abandonButtons.every((button) => button.attributes('disabled') === undefined)).toBe(true)
  })

  it('disables retries in Prepare Map and while another send is active', async () => {
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [createEntry('queued', { opId: 'op_panelqueued02' })],
        recoveryStatus: 'idle',
        interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
        retryingOpId: null,
        retryDisabledMessage: null,
      },
    })

    let retryButton = wrapper.findAll('button').find((button) => button.text() === 'Retry')
    expect(retryButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Switch to Run Live Play')

    await wrapper.setProps({
      interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
      retryDisabledMessage: 'A live-play command is already in flight.',
    })
    const checkButton = wrapper.findAll('button').find((button) => button.text() === 'Check server')
    expect(checkButton?.attributes('disabled')).toBeUndefined()

    retryButton = wrapper.findAll('button').find((button) => button.text() === 'Retry')
    expect(retryButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('A live-play command is already in flight.')
  })

  it('emits refresh, retry, and status checks with accessible labels and the existing operation ID', async () => {
    const entry = createEntry('uncertain', { opId: 'op_panelretry01' })
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [entry],
        recoveryStatus: 'idle',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        retryDisabledMessage: null,
      },
    })

    const refresh = wrapper.find('button[aria-label="Refresh live-play command recovery without sending commands"]')
    expect(refresh.exists()).toBe(true)
    await refresh.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)

    const check = wrapper.find(`button[aria-label="Check whether operation op_panelretry01 has a terminal server result"]`)
    expect(check.exists()).toBe(true)
    await check.trigger('click')
    expect(wrapper.emitted('checkStatus')).toEqual([[entry.opId]])

    const retry = wrapper.find(`button[aria-label="Retry Move token operation op_panelretry01 with its original operation ID"]`)
    expect(retry.exists()).toBe(true)
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toEqual([[entry.opId]])
  })

  it('shows accepted-command synchronization without retry controls when no entries remain', () => {
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [],
        recoveryStatus: 'synchronizing',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        retryDisabledMessage: null,
      },
    })

    expect(wrapper.text()).toContain('Synchronizing accepted command')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Retry')).toBe(false)
    expect(wrapper.find('button[aria-label="Refresh live-play command recovery without sending commands"]').attributes('disabled')).toBeDefined()
  })

  it('shows status checks separately from last send errors and active checking state', async () => {
    const entry = createEntry('uncertain', {
      opId: 'op_panelstatus01',
      lastError: 'The original send timed out.',
    })
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [entry],
        recoveryStatus: 'idle',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        checkingOpId: null,
        retryDisabledMessage: null,
        statusResultByOpId: {
          [entry.opId]: {
            status: 'unknown',
            message: 'The server has no terminal record for this operation yet.',
            checkedAt: 1,
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Last send error')
    expect(wrapper.text()).toContain('The original send timed out.')
    expect(wrapper.text()).toContain('Server status check')
    expect(wrapper.text()).toContain('The server has no terminal record for this operation yet.')

    await wrapper.setProps({ checkingOpId: entry.opId, recoveryStatus: 'checking' })
    expect(wrapper.text()).toContain('Checking the server for a terminal command result without resending the command.')
    const checkButton = wrapper.find(`button[aria-label="Check whether operation ${entry.opId} has a terminal server result"]`)
    expect(checkButton.text()).toBe('Checking…')
    expect(checkButton.attributes('disabled')).toBeDefined()
  })

  it('requires an inline accessible confirmation before emitting abandonment confirmation', async () => {
    const entry = createEntry('queued', { opId: 'op_panelabandon01' })
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [entry],
        recoveryStatus: 'idle',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        checkingOpId: null,
        abandoningOpId: null,
        confirmingAbandonOpId: null,
        retryDisabledMessage: null,
      },
    })

    const abandon = wrapper.findAll('button').find((button) => button.text() === 'Abandon…')
    expect(abandon?.exists()).toBe(true)
    await abandon?.trigger('click')
    expect(wrapper.emitted('requestAbandonConfirmation')).toEqual([[entry.opId]])
    expect(wrapper.emitted('confirmAbandon')).toBeUndefined()

    await wrapper.setProps({ confirmingAbandonOpId: entry.opId })
    const dialog = wrapper.find('[role="alertdialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-labelledby')).toBeTruthy()
    expect(dialog.attributes('aria-describedby')).toBeTruthy()
    expect(dialog.text()).toContain('Abandoning does not undo an operation that already committed')
    expect(dialog.text()).toContain('if the command already finished, its existing terminal result wins')
    expect(dialog.text()).toContain('prevents future execution under this operation ID')

    await dialog.find('button[aria-label="Cancel abandoning this live-play operation"]').trigger('click')
    expect(wrapper.emitted('cancelAbandonConfirmation')).toHaveLength(1)

    await dialog.findAll('button').find((button) => button.text() === 'Abandon operation')?.trigger('click')
    expect(wrapper.emitted('confirmAbandon')).toEqual([[entry.opId]])
  })

  it('disables other controls and displays Abandoning while abandonment is active', () => {
    const active = createEntry('uncertain', { opId: 'op_panelabandon02' })
    const other = createEntry('queued', { opId: 'op_panelabandon03' })
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [active, other],
        recoveryStatus: 'abandoning',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        checkingOpId: null,
        abandoningOpId: active.opId,
        confirmingAbandonOpId: active.opId,
        retryDisabledMessage: null,
      },
    })

    expect(wrapper.text()).toContain('Abandoning the pending live-play operation safely on the server.')
    expect(wrapper.find('button[aria-label="Refresh live-play command recovery without sending commands"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').filter((button) => button.text() === 'Check server').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').filter((button) => button.text() === 'Retry').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Abandoning…')).toBe(true)
    expect(wrapper.findAll('button').filter((button) => button.text() === 'Abandon…').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('does not render raw command payloads, sheets, or auth context', () => {
    const wrapper = mount(LivePlayCommandRecoveryPanel, {
      props: {
        entries: [createEntry('uncertain', { lastError: 'Outcome unknown' })],
        recoveryStatus: 'idle',
        interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
        retryingOpId: null,
        retryDisabledMessage: null,
      },
    })

    expect(wrapper.text()).not.toContain('do-not-render')
    expect(wrapper.text()).not.toContain('secret-token-id')
    expect(wrapper.text()).not.toContain('secret-client')
    expect(wrapper.text()).not.toContain('profile_secret000')
  })
})
