import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION } from '#shared/livePlayMoveResolution'
import { buildMoveAutomationResolveIntent } from '~/utils/moveAutomationResolveIntent'

describe('buildMoveAutomationResolveIntent', () => {
  it('builds self intents without target data', () => {
    const result = buildMoveAutomationResolveIntent({
      kind: 'self',
      actorPlacementId: 'actor',
      moveName: 'Swords Dance',
    })

    expect(result).toEqual({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'actor',
        moveName: 'Swords Dance',
        selection: { kind: 'self' },
      },
    })
    expect(JSON.stringify(result.intent)).not.toContain('target')
  })

  it('detaches an optional server-validated virtual origin without adding mechanics', () => {
    const originCell = { x: 2, y: 0, z: 3 }
    const result = buildMoveAutomationResolveIntent({
      kind: 'single-target', actorPlacementId: 'actor', moveName: 'Water Gun',
      originCell, targetPlacementId: 'target-a',
    })
    originCell.x = 99
    expect(result.intent).toMatchObject({
      originCell: { x: 2, y: 0, z: 3 },
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
  })

  it('builds single-target intents with only the selected target id', () => {
    const result = buildMoveAutomationResolveIntent({
      kind: 'single-target',
      actorPlacementId: 'actor',
      moveName: 'Ember',
      targetBranchId: 'melee-branch',
      targetPlacementId: 'target-a',
    })

    expect(result).toEqual({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'actor',
        moveName: 'Ember',
        targetBranchId: 'melee-branch',
        selection: { kind: 'single-target', targetPlacementId: 'target-a' },
      },
    })
    expect(result.intent.selection).not.toHaveProperty('targetPlacementIds')
  })

  it('builds target-count intents with selected target ids only', () => {
    const result = buildMoveAutomationResolveIntent({
      kind: 'target-count',
      actorPlacementId: 'actor',
      moveName: 'Fake 6, 2 Targets',
      targetPlacementIds: ['target-b', 'target-a', 'target-a'],
    })

    expect(result.intent.selection).toEqual({
      kind: 'target-count',
      targetPlacementIds: ['target-b', 'target-a'],
    })
  })

  it('builds stationary area intents with template choice, exclusions, and separate candidate scope ids', () => {
    const result = buildMoveAutomationResolveIntent({
      kind: 'area',
      actorPlacementId: 'actor',
      moveName: 'Burst Move',
      areaTemplateId: 'burst:any:1',
      excludedTargetPlacementIds: ['friend-a'],
      candidateTargetPlacementIds: ['friend-a', 'enemy-a'],
    })

    expect(result.intent).toEqual({
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: 'actor',
      moveName: 'Burst Move',
      selection: {
        kind: 'area',
        areaTemplateId: 'burst:any:1',
        excludedTargetPlacementIds: ['friend-a'],
      },
    })
    expect(result.candidateScopePlacementIds).toEqual(['friend-a', 'enemy-a'])
    expect(result.intent.selection).not.toHaveProperty('cells')
    expect(result.intent.selection).not.toHaveProperty('candidateTargetIds')
  })

  it('builds cone and line area intents with direction', () => {
    expect(buildMoveAutomationResolveIntent({
      kind: 'area',
      actorPlacementId: 'actor',
      moveName: 'Cone Move',
      areaTemplateId: 'cone:any:3',
      direction: 'north-east',
    }).intent.selection).toEqual({ kind: 'area', areaTemplateId: 'cone:any:3', direction: 'north-east' })

    expect(buildMoveAutomationResolveIntent({
      kind: 'area',
      actorPlacementId: 'actor',
      moveName: 'Line Move',
      areaTemplateId: 'line:any:4',
      direction: 'south',
    }).intent.selection).toEqual({ kind: 'area', areaTemplateId: 'line:any:4', direction: 'south' })
  })

  it('builds aimed close-blast and ranged-blast intents with aim cells and no cells', () => {
    const close = buildMoveAutomationResolveIntent({
      kind: 'area',
      actorPlacementId: 'actor',
      moveName: 'Close Blast Move',
      areaTemplateId: 'close-blast:any:2',
      aimCell: { x: 1, y: 0, z: 1 },
    })
    const ranged = buildMoveAutomationResolveIntent({
      kind: 'area',
      actorPlacementId: 'actor',
      moveName: 'Ranged Blast Move',
      areaTemplateId: 'ranged-blast:6:2',
      aimCell: { x: 3, y: 0, z: 2 },
    })

    expect(close.intent.selection).toEqual({
      kind: 'area',
      areaTemplateId: 'close-blast:any:2',
      aimCell: { x: 1, y: 0, z: 1 },
    })
    expect(ranged.intent.selection).toEqual({
      kind: 'area',
      areaTemplateId: 'ranged-blast:6:2',
      aimCell: { x: 3, y: 0, z: 2 },
    })
    expect(JSON.stringify(close.intent)).not.toContain('cells')
    expect(JSON.stringify(ranged.intent)).not.toContain('cells')
  })

  it('builds Pass intents with direction and no destination', () => {
    const result = buildMoveAutomationResolveIntent({
      kind: 'pass',
      actorPlacementId: 'actor',
      moveName: 'Scratch',
      areaTemplateId: 'pass:any:4',
      direction: 'east',
      candidateTargetPlacementIds: ['crossed-target'],
    })

    expect(result.intent.selection).toEqual({
      kind: 'area',
      areaTemplateId: 'pass:any:4',
      direction: 'east',
    })
    expect(result.candidateScopePlacementIds).toEqual(['crossed-target'])
    expect(JSON.stringify(result.intent)).not.toContain('destination')
  })
})
