import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED,
  INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY,
  INITIATIVE_AUTO_FOCUS_HELP_TEXT,
  initiativeAutoFocusEnabledLabel,
  initiativeAutoFocusEnabledTitle,
  parseInitiativeAutoFocusEnabled,
  resolveInitiativeAutoFocusEnabled,
  serializeInitiativeAutoFocusEnabled,
} from '~/utils/initiativeAutoFocusSettings'

describe('initiative auto-focus settings', () => {
  it('defaults initiative auto-focus to enabled', () => {
    expect(DEFAULT_INITIATIVE_AUTO_FOCUS_ENABLED).toBe(true)
    expect(INITIATIVE_AUTO_FOCUS_ENABLED_STORAGE_KEY).toBe('rotom-table:initiative-auto-focus-enabled')
    expect(resolveInitiativeAutoFocusEnabled(undefined)).toBe(true)
    expect(resolveInitiativeAutoFocusEnabled('unexpected')).toBe(true)
  })

  it('parses and serializes the local browser enablement preference', () => {
    expect(parseInitiativeAutoFocusEnabled(true)).toBe(true)
    expect(parseInitiativeAutoFocusEnabled(false)).toBe(false)
    expect(parseInitiativeAutoFocusEnabled('enabled')).toBe(true)
    expect(parseInitiativeAutoFocusEnabled('OFF')).toBe(false)
    expect(parseInitiativeAutoFocusEnabled('0')).toBe(false)
    expect(parseInitiativeAutoFocusEnabled('maybe')).toBeNull()

    expect(serializeInitiativeAutoFocusEnabled(true)).toBe('true')
    expect(serializeInitiativeAutoFocusEnabled(false)).toBe('false')
  })

  it('labels the map camera preference with user-facing help text', () => {
    expect(initiativeAutoFocusEnabledLabel(true)).toBe('Auto-focus active initiative on')
    expect(initiativeAutoFocusEnabledLabel(false)).toBe('Auto-focus active initiative off')
    expect(initiativeAutoFocusEnabledTitle(true)).toBe(INITIATIVE_AUTO_FOCUS_HELP_TEXT)
    expect(initiativeAutoFocusEnabledTitle(false)).toBe(INITIATIVE_AUTO_FOCUS_HELP_TEXT)
  })
})
