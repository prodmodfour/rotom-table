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
})
