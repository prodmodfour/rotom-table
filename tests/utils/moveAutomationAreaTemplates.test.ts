import { describe, expect, it } from 'vitest'
import {
  buildMoveAutomationAreaTemplateCells,
  buildMoveAutomationAreaTemplatePlacementAtCenter,
  buildMoveAutomationAreaTemplatePlacements,
  buildMoveAutomationCloseBlastPlacementAtAimCell,
  parseMoveAutomationAreaTemplates,
  tokensInMoveAutomationArea,
} from '~/utils/moveAutomationAreaTemplates'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

const token = (id: string, species: string, position = { x: 5, y: 0, z: 5 }): SpawnedPokemon => ({
  id,
  species,
  slug: species.toLowerCase(),
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/sprite.png',
  entityKind: 'pokemon',
  position,
  sheetKind: 'pokemon',
  sheetSlug: species.toLowerCase(),
  level: 5,
  currentHp: 10,
  maxHp: 20,
  atk: 5,
  satk: 5,
  def: 5,
  sdef: 5,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
})

const cells = (items: Array<[number, number, number]>) => items.map(([x, y, z]) => ({ x, y, z }))
const sortedCells = (items: Array<{ x: number; y: number; z: number }>) =>
  [...items].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)

const template = (value: MoveAutomationAreaTemplate['kind'], size: number, range?: number | null): MoveAutomationAreaTemplate => ({
  kind: value,
  size,
  ...(range !== undefined ? { range } : {}),
  label: `${value} ${size}`,
})

describe('move automation area templates', () => {
  it('parses all PTU AoE range template kinds from move range text', () => {
    expect(parseMoveAutomationAreaTemplates('Burst 1, Friendly')).toMatchObject([
      { kind: 'burst', size: 1, label: 'Burst 1' },
    ])
    expect(parseMoveAutomationAreaTemplates('Close Blast 2')).toMatchObject([
      { kind: 'close-blast', size: 2, label: 'Close Blast 2' },
    ])
    expect(parseMoveAutomationAreaTemplates('Cone 3 or Line 8')).toMatchObject([
      { kind: 'cone', size: 3, label: 'Cone 3' },
      { kind: 'line', size: 8, label: 'Line 8' },
    ])
    expect(parseMoveAutomationAreaTemplates('Melee, Pass')).toMatchObject([
      { kind: 'pass', size: 4, label: 'Pass 4' },
    ])
    expect(parseMoveAutomationAreaTemplates('8, Ranged Blast 3')).toMatchObject([
      { kind: 'ranged-blast', size: 3, range: 8, label: 'Ranged 8 Blast 3' },
    ])
    expect(parseMoveAutomationAreaTemplates('5, Blast 2')).toMatchObject([
      { kind: 'ranged-blast', size: 2, range: 5, label: 'Ranged 5 Blast 2' },
    ])
    expect(parseMoveAutomationAreaTemplates('All Cardinally Adjacent Targets')).toMatchObject([
      { kind: 'cardinally-adjacent', size: 1, label: 'Cardinally Adjacent Targets' },
    ])
  })

  it('does not parse explicit target-count ranges as AoE templates', () => {
    expect(parseMoveAutomationAreaTemplates('6, 2 Targets')).toEqual([])
    expect(parseMoveAutomationAreaTemplates('Range 6, 2-Targets')).toEqual([])
    expect(parseMoveAutomationAreaTemplates('Melee, 3 Targets')).toEqual([])
    expect(parseMoveAutomationAreaTemplates('3, 5 Targets')).toEqual([])
  })

  it('builds Burst, Cone, Line, Blast, and cardinal-adjacent template cells', () => {
    const bounds = { x: 12, y: 4, z: 12 }
    const user = token('user', 'Eevee', { x: 5, y: 1, z: 5 })

    const burst = buildMoveAutomationAreaTemplateCells({ template: template('burst', 1), user, bounds })
    expect(burst).toHaveLength(26)
    expect(sortedCells(burst.filter((cell) => cell.y === 1))).toEqual(sortedCells(cells([
      [4, 1, 4], [4, 1, 5], [4, 1, 6],
      [5, 1, 4], [5, 1, 6],
      [6, 1, 4], [6, 1, 5], [6, 1, 6],
    ])))
    expect(burst).toContainEqual({ x: 5, y: 0, z: 5 })
    expect(burst).toContainEqual({ x: 5, y: 2, z: 5 })

    const burst2 = buildMoveAutomationAreaTemplateCells({ template: template('burst', 2), user, bounds })
    expect(burst2).toContainEqual({ x: 7, y: 1, z: 5 })
    expect(burst2).toContainEqual({ x: 7, y: 2, z: 5 })
    expect(burst2).not.toContainEqual({ x: 7, y: 1, z: 7 })
    expect(burst2).not.toContainEqual({ x: 7, y: 3, z: 5 })

    const cone = buildMoveAutomationAreaTemplateCells({ template: template('cone', 2), user, direction: 'north', bounds })
    expect(cone).toHaveLength(10)
    expect(sortedCells(cone.filter((cell) => cell.y === 1))).toEqual(sortedCells(cells([
      [5, 1, 4],
      [4, 1, 3], [5, 1, 3], [6, 1, 3],
    ])))
    expect(cone).toContainEqual({ x: 4, y: 0, z: 3 })
    expect(cone).toContainEqual({ x: 6, y: 2, z: 3 })

    const diagonalCone = buildMoveAutomationAreaTemplateCells({ template: template('cone', 2), user, direction: 'north-east', bounds })
    expect(diagonalCone).toHaveLength(7)
    expect(sortedCells(diagonalCone.filter((cell) => cell.y === 1))).toEqual(sortedCells(cells([
      [6, 1, 3], [6, 1, 4],
      [7, 1, 4],
    ])))
    expect(diagonalCone).not.toContainEqual({ x: 7, y: 1, z: 3 })

    expect(buildMoveAutomationAreaTemplateCells({ template: template('line', 3), user, direction: 'east', bounds })).toEqual(cells([
      [6, 1, 5], [7, 1, 5], [8, 1, 5],
    ]))
    expect(buildMoveAutomationAreaTemplateCells({ template: template('pass', 4), user, direction: 'east', bounds })).toEqual(cells([
      [6, 1, 5], [7, 1, 5], [8, 1, 5], [9, 1, 5],
    ]))
    expect(buildMoveAutomationAreaTemplateCells({ template: template('line', 4), user, direction: 'north-east', bounds })).toEqual(cells([
      [6, 1, 4], [7, 1, 3], [8, 1, 2],
    ]))
    expect(buildMoveAutomationAreaTemplateCells({ template: template('line', 3), user, direction: 'up', bounds })).toEqual(cells([
      [5, 2, 5], [5, 3, 5],
    ]))
    expect(buildMoveAutomationAreaTemplateCells({ template: template('line', 3), user, direction: 'down', bounds })).toEqual(cells([
      [5, 0, 5],
    ]))

    const coneUp = buildMoveAutomationAreaTemplateCells({ template: template('cone', 2), user, direction: 'up', bounds })
    expect(coneUp).toHaveLength(10)
    expect(coneUp).toContainEqual({ x: 5, y: 2, z: 5 })
    expect(sortedCells(coneUp.filter((cell) => cell.y === 3))).toEqual(sortedCells(cells([
      [4, 3, 4], [4, 3, 5], [4, 3, 6],
      [5, 3, 4], [5, 3, 5], [5, 3, 6],
      [6, 3, 4], [6, 3, 5], [6, 3, 6],
    ])))

    const closeBlast = buildMoveAutomationAreaTemplateCells({ template: template('close-blast', 2), user, direction: 'north', bounds })
    expect(closeBlast).toHaveLength(8)
    expect(sortedCells(closeBlast.filter((cell) => cell.y === 1))).toEqual(sortedCells(cells([
      [4, 1, 3], [4, 1, 4], [5, 1, 3], [5, 1, 4],
    ])))
    expect(closeBlast).toContainEqual({ x: 4, y: 0, z: 3 })

    const closeBlastUp = buildMoveAutomationAreaTemplateCells({ template: template('close-blast', 2), user, direction: 'up', bounds })
    expect(closeBlastUp).toHaveLength(8)
    expect(sortedCells(closeBlastUp.filter((cell) => cell.y === 2))).toEqual(sortedCells(cells([
      [4, 2, 4], [4, 2, 5], [5, 2, 4], [5, 2, 5],
    ])))
    expect(sortedCells(closeBlastUp.filter((cell) => cell.y === 3))).toEqual(sortedCells(cells([
      [4, 3, 4], [4, 3, 5], [5, 3, 4], [5, 3, 5],
    ])))

    const elevatedUser = token('elevated-user', 'Eevee', { x: 5, y: 3, z: 5 })
    const tallBounds = { x: 12, y: 8, z: 12 }
    const closeBlast4 = buildMoveAutomationAreaTemplateCells({ template: template('close-blast', 4), user: elevatedUser, direction: 'north', bounds: tallBounds })
    expect(closeBlast4).toContainEqual({ x: 5, y: 3, z: 1 })
    expect(closeBlast4).toContainEqual({ x: 4, y: 2, z: 1 })
    expect(closeBlast4).not.toContainEqual({ x: 3, y: 1, z: 1 })

    const rangedBlast = buildMoveAutomationAreaTemplateCells({ template: template('ranged-blast', 3, 8), user, center: { x: 5, y: 1, z: 5 }, bounds })
    expect(rangedBlast).toHaveLength(27)
    expect(sortedCells(rangedBlast.filter((cell) => cell.y === 1))).toEqual(sortedCells(cells([
      [4, 1, 4], [4, 1, 5], [4, 1, 6],
      [5, 1, 4], [5, 1, 5], [5, 1, 6],
      [6, 1, 4], [6, 1, 5], [6, 1, 6],
    ])))
    expect(rangedBlast).toContainEqual({ x: 5, y: 0, z: 5 })
    expect(rangedBlast).toContainEqual({ x: 5, y: 2, z: 5 })

    const rangedBlast5 = buildMoveAutomationAreaTemplateCells({ template: template('ranged-blast', 5, 8), user: elevatedUser, center: { x: 5, y: 3, z: 5 }, bounds: tallBounds })
    expect(rangedBlast5).toContainEqual({ x: 3, y: 3, z: 5 })
    expect(rangedBlast5).toContainEqual({ x: 3, y: 2, z: 5 })
    expect(rangedBlast5).not.toContainEqual({ x: 3, y: 1, z: 3 })

    expect(sortedCells(buildMoveAutomationAreaTemplateCells({ template: template('cardinally-adjacent', 1), user, bounds }))).toEqual(sortedCells(cells([
      [5, 1, 4], [6, 1, 5], [5, 1, 6], [4, 1, 5],
    ])))
  })

  it('clips three-dimensional area volumes around terrain blockers', () => {
    const user = token('user', 'Eevee', { x: 3, y: 1, z: 3 })
    const cellsForBurst = buildMoveAutomationAreaTemplateCells({
      template: template('burst', 2),
      user,
      bounds: { x: 8, y: 4, z: 8 },
      blockedCells: new Set(['4,1,3']),
    })

    expect(cellsForBurst).toContainEqual({ x: 3, y: 2, z: 3 })
    expect(cellsForBurst).toContainEqual({ x: 4, y: 2, z: 3 })
    expect(cellsForBurst).not.toContainEqual({ x: 4, y: 1, z: 3 })
    expect(cellsForBurst).not.toContainEqual({ x: 5, y: 1, z: 3 })
  })

  it('resolves tokens and reusable placement buttons from templates', () => {
    const user = token('user', 'Eevee')
    const north = token('north', 'Pidgey', { x: 5, y: 0, z: 4 })
    const far = token('far', 'Rattata', { x: 8, y: 0, z: 5 })
    const bounds = { x: 10, y: 2, z: 10 }
    const cellsForBurst = buildMoveAutomationAreaTemplateCells({ template: template('burst', 1), user, bounds })

    expect(tokensInMoveAutomationArea({ cells: cellsForBurst, tokens: [user, north, far], excludeIds: [user.id] }).map((item) => item.id)).toEqual(['north'])

    const placements = buildMoveAutomationAreaTemplatePlacements({
      script: { range: 'Burst 1', areaTemplates: parseMoveAutomationAreaTemplates('Burst 1') },
      user,
      tokens: [user, north, far],
      bounds,
    })

    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({ label: 'Burst 1', targetIds: ['north'] })
  })

  it('builds free-aim Ranged Blast placements on empty legal center cells', () => {
    const user = token('user', 'Eevee', { x: 1, y: 0, z: 1 })
    const target = token('target', 'Pidgey', { x: 4, y: 0, z: 4 })
    const blast = template('ranged-blast', 2, 8)

    const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
      template: blast,
      user,
      tokens: [user, target],
      center: { x: 5, y: 0, z: 4 },
      includeEmpty: true,
      bounds: { x: 12, y: 2, z: 12 },
    })

    expect(placement).toMatchObject({
      label: 'ranged-blast 2 centered at (5, 0, 4)',
      center: { x: 5, y: 0, z: 4 },
      aimCell: { x: 5, y: 0, z: 4 },
      targetIds: ['target'],
    })

    const outOfRange = buildMoveAutomationAreaTemplatePlacementAtCenter({
      template: blast,
      user,
      tokens: [user, target],
      center: { x: 11, y: 0, z: 11 },
      includeEmpty: true,
      bounds: { x: 12, y: 2, z: 12 },
    })

    expect(outOfRange).toBeNull()
  })

  it('builds constrained free-aim Close Blast placements on legal adjacent cells', () => {
    const user = token('user', 'Eevee', { x: 3, y: 1, z: 3 })
    const target = token('target', 'Pidgey', { x: 4, y: 1, z: 3 })
    const blast = template('close-blast', 2)

    const placement = buildMoveAutomationCloseBlastPlacementAtAimCell({
      template: blast,
      user,
      tokens: [user, target],
      aimCell: { x: 4, y: 1, z: 3 },
      includeEmpty: true,
      bounds: { x: 8, y: 4, z: 8 },
    })

    expect(placement).toMatchObject({
      label: 'close-blast 2 aimed at (4, 1, 3)',
      aimCell: { x: 4, y: 1, z: 3 },
      targetIds: ['target'],
    })
    expect(placement?.cells).toContainEqual({ x: 4, y: 1, z: 3 })
    expect(placement?.cells).not.toContainEqual(user.position)

    const outOfRange = buildMoveAutomationCloseBlastPlacementAtAimCell({
      template: blast,
      user,
      tokens: [user, target],
      aimCell: { x: 7, y: 1, z: 7 },
      includeEmpty: true,
      bounds: { x: 8, y: 4, z: 8 },
    })

    expect(outOfRange).toBeNull()
  })

  it('builds Pass placements that stop at the farthest legal empty end square', () => {
    const user = token('user', 'Eevee', { x: 1, y: 0, z: 1 })
    const first = token('first', 'Rattata', { x: 2, y: 0, z: 1 })
    const second = token('second', 'Pidgey', { x: 3, y: 0, z: 1 })
    const beyondEndpoint = token('beyond', 'Zubat', { x: 5, y: 0, z: 1 })

    const placements = buildMoveAutomationAreaTemplatePlacements({
      script: { range: 'Melee, Pass', areaTemplates: parseMoveAutomationAreaTemplates('Melee, Pass') },
      user,
      tokens: [user, first, second, beyondEndpoint],
      bounds: { x: 7, y: 2, z: 3 },
      includeEmpty: true,
    })

    const east = placements.find((placement) => placement.direction === 'east')

    expect(east).toMatchObject({
      label: 'Pass 4 east',
      targetIds: ['first', 'second'],
      destination: { x: 4, y: 0, z: 1 },
    })
    expect(east?.cells).toEqual(cells([[2, 0, 1], [3, 0, 1], [4, 0, 1]]))
  })
})
