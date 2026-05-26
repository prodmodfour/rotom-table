import { describe, expect, it } from 'vitest'
import { buildMapSessionAttachmentActionModel } from '~/utils/mapSessionAttachmentAction'

describe('map session attachment action model', () => {
  it('enables a remembered GM to attach a local-first map and open session mode', () => {
    const model = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      sessionModeEnabled: false,
      localRoleIsGm: true,
      rememberedRole: 'gm',
    })

    expect(model.modeLabel).toBe('Local-first map view')
    expect(model.modeSummary).toContain('local-first')
    expect(model.modeSummary).toContain('session commands')
    expect(model.canAttach).toBe(true)
    expect(model.statusKind).toBe('ready')
    expect(model.statusMessage).toBe('Ready to attach this persisted map to the active live session.')
    expect(model.attachButtonLabel).toBe('Attach current map to live session')
    expect(model.openSessionMapHref).toBe('/maps/training-yard?session=1')
  })

  it('blocks the attach action until the browser has a remembered GM session identity', () => {
    const noRememberedIdentity = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      localRoleIsGm: true,
      rememberedRole: null,
    })
    const rememberedPlayer = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      localRoleIsGm: true,
      rememberedRole: 'player',
    })

    expect(noRememberedIdentity.canAttach).toBe(false)
    expect(noRememberedIdentity.disabledReason).toBe(
      'Start or load a GM live session in this browser before attaching a map.',
    )
    expect(rememberedPlayer.canAttach).toBe(false)
    expect(rememberedPlayer.disabledReason).toContain('remembers a player live session')
  })

  it('requires the local GM role before publishing the current map to a live session', () => {
    const model = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      localRoleIsGm: false,
      rememberedRole: 'gm',
    })

    expect(model.canAttach).toBe(false)
    expect(model.statusKind).toBe('blocked')
    expect(model.statusMessage).toBe('GM login is required before attaching a map to a live session.')
  })

  it('shows a success state with a clean session-map link after attach', () => {
    const model = buildMapSessionAttachmentActionModel({
      mapSlug: 'folder/name',
      localRoleIsGm: true,
      rememberedRole: 'gm',
      attachedMapSlug: 'folder/name',
      lastNotice: 'Attached folder/name to the live session map.',
    })

    expect(model.canAttach).toBe(true)
    expect(model.statusKind).toBe('success')
    expect(model.statusMessage).toBe('Attached folder/name to the live session map.')
    expect(model.attachButtonLabel).toBe('Attach current map again')
    expect(model.openSessionMapHref).toBe('/maps/folder%2Fname?session=1')
    expect(model.openSessionMapLabel).toBe('Open attached session map')
  })

  it('keeps session mode copy distinct from the local-first attach flow', () => {
    const model = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      sessionModeEnabled: true,
      localRoleIsGm: true,
      rememberedRole: 'gm',
    })

    expect(model.modeLabel).toBe('Session mode view')
    expect(model.modeSummary).toContain('server-owned session map')
    expect(model.modeSummary).toContain('session commands')
    expect(model.canAttach).toBe(true)
  })

  it('surfaces user-safe errors and busy state without exposing session secrets', () => {
    const busy = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      localRoleIsGm: true,
      rememberedRole: 'gm',
      busy: true,
    })
    const failed = buildMapSessionAttachmentActionModel({
      mapSlug: 'training-yard',
      localRoleIsGm: true,
      rememberedRole: 'gm',
      lastError: 'Session hosting is not enabled on this Rotom Table server for gmkey_exampleSecret1234567890.',
    })

    expect(busy.canAttach).toBe(false)
    expect(busy.statusKind).toBe('busy')
    expect(busy.attachButtonLabel).toBe('Attaching map…')
    expect(failed.statusKind).toBe('error')
    expect(failed.statusMessage).toBe(
      'Session hosting is not enabled on this Rotom Table server for [hidden GM key].',
    )
    expect(failed.statusMessage).not.toContain('gmkey')
  })
})
