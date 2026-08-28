import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeNitroBundle,
  normalizeReleaseBuildOutput,
  sourceDateStamp,
} from '../../scripts/release-readiness/normalize-release-build-output.mjs'

const temporaryDirectories: string[] = []

function fixtureOutput() {
  const output = mkdtempSync(join(tmpdir(), 'rotom-release-normalization-'))
  temporaryDirectories.push(output)
  mkdirSync(join(output, 'server/chunks/nitro'), { recursive: true })
  writeFileSync(join(output, 'nitro.json'), '{\n  "date": "2030-02-03T04:05:06.789Z",\n  "preset": "node-server"\n}\n')
  writeFileSync(join(output, 'server/chunks/nitro/nitro.mjs'), `const unrelated = { value: true };
const assets = {
  "/z-last.js": {
    "type": "text/javascript; charset=utf-8",
    "etag": "z-etag",
    "mtime": "2030-02-03T04:05:07.111Z",
    "size": 2,
    "path": "../public/z-last.js"
  },
  "/a-first.css": {
    "type": "text/css; charset=utf-8",
    "etag": "a-etag",
    "mtime": "2030-02-03T04:05:08.222Z",
    "size": 1,
    "path": "../public/a-first.css"
  }
};
export default assets;
`)
  return output
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('release build output normalization', () => {
  it('derives an exact ISO timestamp from integer commit authority', () => {
    expect(sourceDateStamp('0')).toBe('1970-01-01T00:00:00.000Z')
    expect(sourceDateStamp('1787924982')).toBe('2026-08-28T13:49:42.000Z')
    expect(() => sourceDateStamp('1.5')).toThrow('integer SOURCE_DATE_EPOCH')
    expect(() => sourceDateStamp('-1')).toThrow('integer SOURCE_DATE_EPOCH')
  })

  it('sorts the Nitro public-asset map and replaces generated dates and mtimes', () => {
    const output = fixtureOutput()
    const first = normalizeReleaseBuildOutput({ outputDirectory: output, sourceDateEpoch: '0' })
    const metadataPath = join(output, 'nitro.json')
    const bundlePath = join(output, 'server/chunks/nitro/nitro.mjs')

    expect(first).toEqual({
      sourceDateStamp: '1970-01-01T00:00:00.000Z',
      publicAssetCount: 2,
    })
    expect(JSON.parse(readFileSync(metadataPath, 'utf8')).date).toBe('1970-01-01T00:00:00.000Z')
    const normalized = readFileSync(bundlePath, 'utf8')
    expect(normalized.indexOf('"/a-first.css"')).toBeLessThan(normalized.indexOf('"/z-last.js"'))
    expect(normalized.match(/1970-01-01T00:00:00\.000Z/g)).toHaveLength(2)
    expect(normalized).not.toContain('2030-02-03')

    normalizeReleaseBuildOutput({ outputDirectory: output, sourceDateEpoch: '0' })
    expect(readFileSync(bundlePath, 'utf8')).toBe(normalized)
  })

  it('fails closed unless exactly one generated public-asset map is present', () => {
    const metadata = {
      '/asset.js': {
        type: 'text/javascript',
        etag: 'etag',
        mtime: '2030-01-01T00:00:00.000Z',
        size: 1,
        path: '../public/asset.js',
      },
    }
    const declaration = `\nconst assets = ${JSON.stringify(metadata)};`

    expect(() => normalizeNitroBundle('const noAssets = {};\n', '1970-01-01T00:00:00.000Z'))
      .toThrow('found 0')
    expect(() => normalizeNitroBundle(`${declaration}${declaration}\n`, '1970-01-01T00:00:00.000Z'))
      .toThrow('found 2')
  })
})
