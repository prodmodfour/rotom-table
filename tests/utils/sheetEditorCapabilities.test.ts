import { describe, expect, it } from 'vitest'
import {
  resolveSheetEditorCapabilities,
  SHEET_EDITOR_READONLY_REASON,
} from '~/utils/sheetEditorCapabilities'

describe('sheet editor capabilities', () => {
  it('gives GMs full sheet editing and player-access management controls', () => {
    expect(resolveSheetEditorCapabilities({
      isGm: true,
      isPlayer: false,
      sheet: { player: false },
      hasEditableResource: true,
    })).toEqual({
      accessMode: 'gm',
      canEditSheet: true,
      canManagePlayerAccess: true,
      readonlyReason: null,
    })
  })

  it('gives profile-linked player sheets normal edit controls without admin access toggles', () => {
    expect(resolveSheetEditorCapabilities({
      isGm: false,
      isPlayer: true,
      sheet: { playerProfileAccessible: true, player: false },
      hasEditableResource: true,
    })).toEqual({
      accessMode: 'profile-linked',
      canEditSheet: true,
      canManagePlayerAccess: false,
      readonlyReason: null,
    })
  })

  it('preserves existing player-visible sheet edit access modes', () => {
    expect(resolveSheetEditorCapabilities({
      isGm: false,
      isPlayer: true,
      sheet: { player: true },
      hasEditableResource: true,
    }).accessMode).toBe('player-accessible')
    expect(resolveSheetEditorCapabilities({
      isGm: false,
      isPlayer: true,
      sheet: { sessionPlayerAccessible: true },
      hasEditableResource: true,
    }).accessMode).toBe('session-granted')
  })

  it('keeps unlinked or unavailable player sheets non-editable', () => {
    expect(resolveSheetEditorCapabilities({
      isGm: false,
      isPlayer: true,
      sheet: { player: false },
      hasEditableResource: false,
    })).toEqual({
      accessMode: 'none',
      canEditSheet: false,
      canManagePlayerAccess: false,
      readonlyReason: SHEET_EDITOR_READONLY_REASON,
    })
  })
})
