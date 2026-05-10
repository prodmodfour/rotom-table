import { describe, expect, it } from 'vitest'
import {
  buildFolderBreadcrumbs,
  buildFolderMoveDestinations,
  buildVisibleFolderTiles,
  canMoveFolderTo,
  childFolderPaths,
  folderLeafName,
  folderMoveDestinationPaths,
  folderPathFromQuery,
  isInsideFolder,
  isSameOrDescendantFolder,
  joinFolderPath,
  movedFolderPath,
  nextAvailableFolderLeaf,
  normalizeSearchText,
  parentFolderPath,
  renameFolderPrefix,
} from '~/utils/folderBrowser'

describe('folderBrowser helpers', () => {
  it('normalizes search text and route query folders', () => {
    expect(normalizeSearchText('  Team Alpha  ')).toBe('team alpha')
    expect(folderPathFromQuery('/npcs/wild/')).toBe('npcs/wild')
    expect(folderPathFromQuery(['npcs'])).toBe('')
    expect(folderPathFromQuery(null)).toBe('')
  })

  it('tests whether folders are inside the current folder', () => {
    expect(isInsideFolder('npcs/wild', '')).toBe(true)
    expect(isInsideFolder('npcs/wild', 'npcs')).toBe(true)
    expect(isInsideFolder('npcs', 'npcs')).toBe(true)
    expect(isInsideFolder('players', 'npcs')).toBe(false)
    expect(isInsideFolder('npcstuff', 'npcs')).toBe(false)
  })

  it('builds breadcrumbs with optional segment formatting', () => {
    expect(buildFolderBreadcrumbs('npcs/wild')).toEqual([
      { label: 'Home', path: '' },
      { label: 'npcs', path: 'npcs' },
      { label: 'wild', path: 'npcs/wild' },
    ])
    expect(buildFolderBreadcrumbs('npcs/wild', { formatSegment: (segment) => segment.toUpperCase() })).toEqual([
      { label: 'Home', path: '' },
      { label: 'NPCS', path: 'npcs' },
      { label: 'WILD', path: 'npcs/wild' },
    ])
  })

  it('finds direct child folders and counts descendant items', () => {
    const folders = new Set(['npcs', 'npcs/wild', 'npcs/wild/cave', 'players', 'players/team-a'])
    expect(childFolderPaths(folders, '')).toEqual(['npcs', 'players'])
    expect(childFolderPaths(folders, 'npcs')).toEqual(['npcs/wild'])

    const tiles = buildVisibleFolderTiles({
      folderPaths: folders,
      currentPath: '',
      items: [
        { folder: 'npcs' },
        { folder: 'npcs/wild/cave' },
        { folder: 'players/team-a' },
      ],
      formatLabel: (leaf) => leaf.toUpperCase(),
    })

    expect(tiles).toEqual([
      { path: 'npcs', label: 'NPCS', count: 2 },
      { path: 'players', label: 'PLAYERS', count: 1 },
    ])
  })

  it('allocates folder leaves within the current path', () => {
    expect(nextAvailableFolderLeaf(new Set(['new_folder']), '')).toBe('new_folder_1')
    expect(nextAvailableFolderLeaf(new Set(['team/new_folder', 'team/new_folder_1']), 'team')).toBe('new_folder_2')
    expect(nextAvailableFolderLeaf(new Set(['new_folder']), 'team')).toBe('new_folder')
  })

  it('validates folder moves without allowing self, descendants, or conflicts', () => {
    const existing = new Set(['npcs', 'npcs/wild', 'archive/wild'])
    expect(folderLeafName('npcs/wild')).toBe('wild')
    expect(folderLeafName('npcs')).toBe('npcs')
    expect(parentFolderPath('npcs/wild')).toBe('npcs')
    expect(parentFolderPath('npcs')).toBe('')
    expect(joinFolderPath('archive', 'wild')).toBe('archive/wild')
    expect(joinFolderPath('', 'wild')).toBe('wild')
    expect(isSameOrDescendantFolder('npcs/wild/cave', 'npcs/wild')).toBe(true)
    expect(isSameOrDescendantFolder('npcs/wild', 'npcs/wild')).toBe(true)
    expect(isSameOrDescendantFolder('npcs/wildlife', 'npcs/wild')).toBe(false)
    expect(movedFolderPath('npcs/wild', '')).toBe('wild')
    expect(movedFolderPath('npcs/wild', 'archive')).toBe('archive/wild')
    expect(canMoveFolderTo('npcs/wild', 'npcs/wild/cave', existing)).toBe(false)
    expect(canMoveFolderTo('npcs/wild', 'npcs', existing)).toBe(false)
    expect(canMoveFolderTo('npcs/wild', 'archive', existing)).toBe(false)
    expect(canMoveFolderTo('npcs/wild', '', existing)).toBe(true)
  })

  it('renames folder prefixes and builds valid move destinations', () => {
    const folders = new Set(['archive', 'npcs', 'npcs/wild', 'npcs/wild/cave', 'players'])
    expect(renameFolderPrefix('npcs/wild/cave', 'npcs/wild', 'archive/wild')).toBe('archive/wild/cave')
    expect(renameFolderPrefix('npcs', 'npcs/wild', 'archive/wild')).toBe('npcs')

    expect(folderMoveDestinationPaths(folders, { type: 'item', folder: 'npcs' })).toEqual([
      '',
      'archive',
      'npcs/wild',
      'npcs/wild/cave',
      'players',
    ])
    expect(folderMoveDestinationPaths(folders, { type: 'folder', path: 'npcs/wild' })).toEqual([
      '',
      'archive',
      'players',
    ])

    expect(buildFolderMoveDestinations({
      folderPaths: folders,
      target: { type: 'folder', path: 'npcs/wild' },
      formatLabel: (path) => path.toUpperCase(),
    })).toEqual([
      { value: '', label: 'Home (root)' },
      { value: 'archive', label: 'ARCHIVE' },
      { value: 'players', label: 'PLAYERS' },
    ])
  })
})
