import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const runtimeRoots = ['server/api', 'server/useCases', 'server/livePlay', 'server/policies']
const forbidden = [
  '../utils/mapStorage',
  '../../utils/mapStorage',
  '../utils/sheetStorage',
  '../../utils/sheetStorage',
  '../utils/mapFolderStorage',
  '../../utils/mapFolderStorage',
  '../utils/sheetFolderStorage',
  '../../utils/sheetFolderStorage',
  'findMapFile',
  'readMapFile',
  'writeMapFile',
  'findPersistedSheetFile',
  'readSheetFile',
  'writeSheetFile',
  'listSheetFilesWithFolders',
  'findMapPath',
  'findSheetPath',
  'MAPS_ROOT',
]

const filesUnder = (root: string): string[] => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      const stats = statSync(path)
      if (stats.isDirectory()) walk(path)
      else if (/\.(ts|vue)$/.test(entry)) out.push(path)
    }
  }
  walk(root)
  return out
}

describe('runtime map/sheet storage boundary', () => {
  it('keeps runtime code off JSON map/sheet storage helpers', () => {
    const offenders: string[] = []
    for (const root of runtimeRoots) {
      for (const file of filesUnder(root)) {
        const source = readFileSync(file, 'utf8')
        for (const specifier of forbidden) {
          if (source.includes(specifier)) offenders.push(`${file} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
