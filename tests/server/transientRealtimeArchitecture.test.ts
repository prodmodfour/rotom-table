import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const listTsFiles = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry)
  if (statSync(path).isDirectory()) return listTsFiles(path)
  return path.endsWith('.ts') ? [path] : []
})

const serverFiles = listTsFiles(join(process.cwd(), 'server')).map((path) => ({
  path,
  relativePath: relative(process.cwd(), path),
  text: readFileSync(path, 'utf8'),
}))

const readProjectFile = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

describe('transient realtime publication architecture', () => {
  it('does not publish unscoped transient events from production server code', () => {
    const compatibilityHelper = 'server/utils/realtime.ts'
    const offenders = serverFiles
      .filter((file) => file.relativePath !== compatibilityHelper)
      .filter((file) => /\bpublishRealtime\s*\(/.test(file.text))
      .map((file) => file.relativePath)

    expect(offenders).toEqual([])
  })

  it('requires production scoped transient call sites to provide an explicit access descriptor', () => {
    const helperFiles = new Set(['server/utils/realtime.ts', 'server/utils/useCaseHttp.ts'])
    const offenders: string[] = []
    for (const file of serverFiles) {
      if (helperFiles.has(file.relativePath)) continue
      const matches = file.text.matchAll(/\bpublishTransientRealtime\s*\(([^)]{0,500})\)/gs)
      for (const match of matches) {
        if (!match[1]?.includes('access:')) offenders.push(file.relativePath)
      }
    }

    expect(offenders).toEqual([])
  })

  it('does not pass plain use-case event arrays to the transient publication helper', () => {
    const offenders = serverFiles
      .filter((file) => /\bpublishUseCaseRealtimeEvents\s*\(\s*result\.events\s*\)/.test(file.text))
      .map((file) => file.relativePath)

    expect(offenders).toEqual([])
  })

  it('keeps campaign-day and encounter-spawn persistent mutations on durable events instead of transient-only publication', () => {
    for (const path of [
      'server/useCases/advanceCampaignDay.ts',
      'server/api/campaign/next-day.post.ts',
      'server/useCases/spawnGeneratedEncounters.ts',
      'server/api/encounters/spawn.post.ts',
    ]) {
      const source = readProjectFile(path)
      expect(source).not.toContain('publishUseCaseRealtimeEvents')
      expect(source).not.toContain('publishTransientRealtime')
      expect(source).not.toContain('publishRealtime(')
    }

    expect(readProjectFile('server/useCases/advanceCampaignDay.ts')).toContain('realtimeEventRepository.appendMany')
    expect(readProjectFile('server/useCases/spawnGeneratedEncounters.ts')).toContain('realtimeEventRepository.appendMany')
  })

  it('documents the remaining production transient map event path as visual-only', () => {
    const productionTransientCallers = serverFiles
      .filter((file) => !['server/utils/realtime.ts', 'server/utils/useCaseHttp.ts'].includes(file.relativePath))
      .filter((file) => /\bpublishTransientRealtime\s*\(/.test(file.text))
      .map((file) => file.relativePath)

    expect(productionTransientCallers).toEqual(['server/api/maps/action-event.post.ts'])
    const actionUseCase = readProjectFile('server/useCases/publishMapActionEvent.ts')
    expect(actionUseCase).not.toMatch(/saveSetup|replaceSetup|applyLivePlayUpdate|appendMany|withTransaction/)
  })

  it('keeps runtime encounter spawn independent from generated JSON import/export helpers', () => {
    const source = readProjectFile('server/useCases/spawnGeneratedEncounters.ts')
    expect(source).not.toContain('readJsonFile')
    expect(source).not.toContain('readGeneratedPokemonSheet')
    expect(source).not.toContain('generateEncountersUseCase')
    expect(source).not.toContain('saveMapUseCase')
    expect(source).not.toContain('writeTextFile(')
  })
})
