export type SheetEditorAccessMode =
  | 'none'
  | 'gm'
  | 'player-accessible'
  | 'profile-linked'
  | 'session-granted'

export interface SheetEditorCapabilitySheet {
  readonly player?: unknown
  readonly sessionPlayerAccessible?: unknown
  readonly playerProfileAccessible?: unknown
}

export interface ResolveSheetEditorCapabilitiesOptions {
  readonly isGm: boolean
  readonly isPlayer: boolean
  readonly sheet: SheetEditorCapabilitySheet | null | undefined
  readonly hasEditableResource: boolean
}

export interface SheetEditorCapabilities {
  readonly accessMode: SheetEditorAccessMode
  /** Enables normal character-sheet editing controls. */
  readonly canEditSheet: boolean
  /** Enables administrative controls that change who can see/control a sheet. */
  readonly canManagePlayerAccess: boolean
  readonly readonlyReason: string | null
}

export const SHEET_EDITOR_READONLY_REASON =
  'This sheet is not editable for the current role or selected player profile.'

const playerAccessModeForSheet = (sheet: SheetEditorCapabilitySheet): SheetEditorAccessMode => {
  if (sheet.playerProfileAccessible === true) return 'profile-linked'
  if (sheet.sessionPlayerAccessible === true) return 'session-granted'
  if (sheet.player === true) return 'player-accessible'
  return 'none'
}

export const resolveSheetEditorCapabilities = (
  options: ResolveSheetEditorCapabilitiesOptions,
): SheetEditorCapabilities => {
  if (options.isGm && options.hasEditableResource) {
    return {
      accessMode: 'gm',
      canEditSheet: true,
      canManagePlayerAccess: true,
      readonlyReason: null,
    }
  }

  if (options.isPlayer && options.hasEditableResource && options.sheet) {
    const accessMode = playerAccessModeForSheet(options.sheet)
    if (accessMode !== 'none') {
      return {
        accessMode,
        canEditSheet: true,
        canManagePlayerAccess: false,
        readonlyReason: null,
      }
    }
  }

  return {
    accessMode: 'none',
    canEditSheet: false,
    canManagePlayerAccess: false,
    readonlyReason: SHEET_EDITOR_READONLY_REASON,
  }
}
