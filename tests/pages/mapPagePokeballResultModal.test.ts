import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('map page Poké Ball capture result modal sync', () => {
  it('uses transient map-action pokeball-result events to drive the remote result modal', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(mapPage).toContain('publishPokeballResult: (request) => publishSyncedPokeballResult?.(request)')
    expect(mapPage).toContain('publishSyncedPokeballResult = (request) => mapActionEventSync.publishPokeballResult(request)')
    expect(mapPage).toContain('onPokeballResult: (event) => {\n      clearRemoteMoveFeedback()\n      replayPokeballResult(event.payload)\n    }')
    expect(mapPage).toContain('onPokeballResult: (event) => {\n    broadcastPokeballResult(event)\n  }')
    expect(mapPage).toContain('const displayedPokeballCaptureResult = computed(() => (\n  pokeballCaptureResult.value ?? remotePokeballCaptureResult.value\n))')
    expect(mapPage).toContain('v-if="displayedPokeballCaptureResult"')
    expect(mapPage).toContain(':key="displayedPokeballCaptureResult.id"')
    expect(mapPage).toContain(':result="displayedPokeballCaptureResult"')
  })

  it('does not dismiss an already-visible remote result just because map data reconciles', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(mapPage).toContain('clearRemotePokeballCaptureFeedback,')
    expect(mapPage).toContain('watch(mapDataRevision, () => {\n  clearRemoteMoveFeedback()\n  if (remotePokeballCaptureResult.value) clearRemotePokeballCaptureFeedback()\n  else clearRemotePokeballCapture()\n})')
    expect(mapPage).not.toContain('watch(mapDataRevision, () => {\n  clearRemoteMoveFeedback()\n  clearRemotePokeballCapture()\n})')
  })
})
