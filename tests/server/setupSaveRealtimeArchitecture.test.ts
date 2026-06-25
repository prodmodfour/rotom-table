import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

describe('setup-save durable realtime architecture', () => {
  it('map and sheet setup routes no longer publish draft use-case realtime events', () => {
    expect(readProjectFile('server/api/maps/save.post.ts')).not.toContain('publishUseCaseRealtimeEvents')
    expect(readProjectFile('server/api/sheets/save.post.ts')).not.toContain('publishUseCaseRealtimeEvents')
  })

  it('migrated save use cases use the durable realtime repository inside a database transaction', () => {
    const saveMap = readProjectFile('server/useCases/saveMap.ts')
    const saveSheet = readProjectFile('server/useCases/saveSheet.ts')

    for (const text of [saveMap, saveSheet]) {
      expect(text).toContain('createSqliteRealtimeEventRepository({ database })')
      expect(text).toContain('realtimeEventRepository.appendMany')
      expect(text).toContain('database.withTransaction(() =>')
      expect(text).toContain('publishPersistedSetupSaveRealtimeEventsAfterCommit')
    }
  })

  it('constructs document and realtime repositories from the same RotomDatabase instance', () => {
    const saveMap = readProjectFile('server/useCases/saveMap.ts')
    const saveSheet = readProjectFile('server/useCases/saveSheet.ts')

    expect(saveMap).toContain('createSqliteMapRepository<TabletopMap>(database)')
    expect(saveMap).toContain('Map setup save map repository must use the same RotomDatabase')
    expect(saveMap).toContain('Map setup save realtime event repository must use the same RotomDatabase')

    expect(saveSheet).toContain('createSqliteSheetRepository<Record<string, unknown>>(database)')
    expect(saveSheet).toContain('Sheet setup save sheet repository must use the same RotomDatabase')
    expect(saveSheet).toContain('Sheet setup save realtime event repository must use the same RotomDatabase')
  })

  it('migrated setup-save paths do not call unsequenced realtime publishers directly', () => {
    const migratedFiles = [
      'server/useCases/saveMap.ts',
      'server/useCases/saveSheet.ts',
      'server/api/maps/save.post.ts',
      'server/api/sheets/save.post.ts',
      'server/realtime/setupDocumentRealtime.ts',
    ]
    const offenders = migratedFiles.filter((path) => {
      const text = readProjectFile(path)
      return text.includes('publishRealtime(') || text.includes('publishUseCaseRealtimeEvents')
    })

    expect(offenders).toEqual([])
  })
})
