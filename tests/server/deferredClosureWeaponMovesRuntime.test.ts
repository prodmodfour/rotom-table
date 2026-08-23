import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import { buildEncounterPresentationProjection } from '~~/server/domain/encounterPresentation/buildProjection'
import { resolveAuthoritativeMove } from '~~/server/domain/resolveAuthoritativeMove'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { activeEquipmentState } from '../fixtures/equipment'

const ACTOR_ID = 'weapon-trainer'
const TARGET_IDS = ['weapon-target-a', 'weapon-target-b', 'weapon-target-c'] as const

const targetSheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 30,
  combat: { currentHp: 100 },
})

const masterTrainer = (canonicalItemId: string, twoHanded: boolean): TrainerSheet => ({
  slug: 'weapon-trainer-sheet',
  name: 'Weapon Trainer',
  level: 30,
  currentHp: 100,
  skillBackground: { name: 'Weapon Master', adept: 'combat' },
  edges: [{ name: 'Expert Skills (Combat)' }],
  skills: { combat: { rankBonus: 1 } },
  equipmentState: activeEquipmentState({
    ownerKind: 'trainer',
    ownerSlug: 'weapon-trainer-sheet',
    slotId: 'mainHand',
    ...(twoHanded ? { additionalSlotIds: ['offHand'] } : {}),
    canonicalItemId,
  }),
})

const fixture = (input: {
  item: string
  move: string
  ranged?: boolean
  targetTrainerDamageReduction?: number
  random?: number
}) => {
  const actor: SheetPlacement = {
    id: ACTOR_ID,
    sheetKind: 'trainer',
    sheetSlug: 'weapon-trainer-sheet',
    position: { x: 1, y: 0, z: 1 },
    sideId: 'red',
  }
  const longRange = input.item.includes('Bow')
  const rangedX = longRange ? 7 : 5
  const positions = input.ranged
    ? [{ x: rangedX, y: 0, z: 1 }, { x: rangedX, y: 0, z: 3 }, { x: rangedX, y: 0, z: 5 }]
    : [{ x: 2, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }]
  const placements: SheetPlacement[] = [actor, ...TARGET_IDS.map((id, index): SheetPlacement => ({
    id,
    sheetKind: input.targetTrainerDamageReduction !== undefined && index === 0 ? 'trainer' : 'pokemon',
    sheetSlug: `${id}-sheet`,
    position: positions[index]!,
    sideId: 'blue',
  }))]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `weapon-${input.move.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, 
    name: 'Weapon Move Runtime',
    revision: 1,
    dimensions: { x: 20, y: 4, z: 20 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    placements,
    encounterState: {
      ...createEmptyEncounterState(),
      sides: {
        red: { id: 'red', label: 'Red', status: 'active' },
        blue: { id: 'blue', label: 'Blue', status: 'active' },
      },
    },
  }
  const trainer = masterTrainer(
    input.item,
    ['Hunting Bow', 'Twin-Needled Bow', 'Meteor Masher'].includes(input.item),
  )
  const pokemonSheets = new Map<string, CharacterSheet>()
  const trainerSheets = new Map<string, TrainerSheet>([[trainer.slug, trainer]])
  for (const [index, id] of TARGET_IDS.entries()) {
    const slug = `${id}-sheet`
    if (input.targetTrainerDamageReduction !== undefined && index === 0) {
      trainerSheets.set(slug, {
        slug,
        name: id,
        level: 20,
        currentHp: 100,
        damageReduction: input.targetTrainerDamageReduction,
      })
    }
    else pokemonSheets.set(slug, targetSheet(slug))
  }
  const projection = buildEncounterPresentationProjection({
    role: 'gm', map, mapRevision: 1,
    pokemonSheets: [...pokemonSheets.values()],
    trainerSheets: [...trainerSheets.values()],
    generatedAt: 1_000,
  })
  const offer = projection.offers.find(entry => entry.source.canonicalId === input.move)
  if (!offer?.source.instanceId?.startsWith('attack-source.v1.')) {
    throw new Error(`Missing native ${input.move} offer for ${input.item}.`)
  }
  const selection: ResolveMoveIntent['selection'] = input.move === 'Triple Threat'
    ? { kind: 'target-count', targetPlacementIds: [...TARGET_IDS] }
    : { kind: 'single-target', targetPlacementId: TARGET_IDS[0] }
  const resolution = resolveAuthoritativeMove({
    map,
    pokemonSheets,
    trainerSheets,
    intent: {
      schemaVersion: 1,
      placementId: ACTOR_ID,
      moveName: input.move,
      attackSourceId: offer.source.instanceId as `attack-source.v1.${string}`,
      selection,
    },
    random: () => input.random ?? 0.99,
    now: () => 1_000,
  })
  return { projection, resolution }
}

describe('P11 supplemental weapon Move runtime', () => {
  it('executes Bash! and installs Initiative 0 only from a qualifying natural roll', () => {
    const { resolution } = fixture({ item: 'Throwing Hammers', move: 'Bash!', ranged: true, random: 0.76 })
    expect(resolution.nativeV2?.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({
        kind: 'temporary-effect',
        reasonCode: 'capability-weapon.bash.initiative-zero',
      }),
      recipientIds: [TARGET_IDS[0]],
    }))
  })

  it('does not install the Bash! Initiative effect below its reviewed threshold', () => {
    const { resolution } = fixture({ item: 'Throwing Hammers', move: 'Bash!', ranged: true, random: 0.51 })
    expect(resolution.nativeV2?.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({ reasonCode: 'capability-weapon.bash.initiative-zero' }),
      recipientIds: [],
    }))
  })

  it('executes Pierce! with its conditional +10 damage modifier against Damage Reduction', () => {
    const { resolution } = fixture({
      item: 'Hunting Bow', move: 'Pierce!', ranged: true, targetTrainerDamageReduction: 5,
    })
    expect(JSON.stringify(resolution.auditTrace.events))
      .toContain('capability-weapon.pierce.damage-reduction-bonus')
    const withoutReduction = fixture({ item: 'Hunting Bow', move: 'Pierce!', ranged: true })
    expect(JSON.stringify(withoutReduction.resolution.auditTrace.events))
      .not.toContain('capability-weapon.pierce.damage-reduction-bonus')
  })

  it('executes Gouge as two independent strikes and adds one Injury only when both hit', () => {
    const { resolution } = fixture({ item: 'Honed Claws', move: 'Gouge' })
    expect(resolution.nativeV2?.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({ kind: 'multi-hit', id: 'gouge.multi-hit' }),
    }))
    expect(resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'gouge.add-injury',
      outcome: 'applied',
    }))
  })

  it('executes Titanic Slam and applies Slowed on an even natural accuracy roll', () => {
    const { resolution } = fixture({ item: 'Meteor Masher', move: 'Titanic Slam', random: 0.26 })
    expect(resolution.nativeV2?.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({
        kind: 'condition',
        id: 'titanic-slam.slowed-even-roll',
      }),
      recipientIds: [TARGET_IDS[0]],
    }))
  })

  it('executes Bullseye with a 16+ critical range', () => {
    const { resolution } = fixture({ item: 'Super Lucky Throwing Stars', move: 'Bullseye', ranged: true, random: 0.76 })
    expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  })

  it('executes Deadly Strike as an automatic critical on an ordinary hit', () => {
    const { resolution } = fixture({ item: 'Super Lucky Throwing Stars', move: 'Deadly Strike', ranged: true, random: 0.51 })
    expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  })

  it('executes Triple Threat against exactly three authoritative ranged targets', () => {
    const { projection, resolution } = fixture({ item: 'Twin-Needled Bow', move: 'Triple Threat', ranged: true })
    expect(projection.offers.filter(offer => (
      offer.source.canonicalId === 'Double Swipe' || offer.source.canonicalId === 'Triple Threat'
    )).map(offer => offer.source.canonicalId)).toEqual(['Double Swipe', 'Triple Threat'])
    expect(resolution.selectedTargetIds).toEqual(TARGET_IDS)
    expect(resolution.transaction.attackedTargetIds).toEqual(TARGET_IDS)
    expect(resolution.script.range).toContain('Minimum Range 4')
  })
})
