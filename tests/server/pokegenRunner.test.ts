import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { runPokegenScript, type PokegenSpawn } from '~/server/utils/pokegenRunner'

class FakeStream extends EventEmitter {}

class FakePokegenProcess extends EventEmitter {
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
}

const createSpawnHarness = () => {
  const child = new FakePokegenProcess()
  const spawn: PokegenSpawn = vi.fn(() => child)
  return { child, spawn }
}

describe('runPokegenScript', () => {
  it('spawns pokegen with compatible args and resolves successful runs', async () => {
    const { child, spawn } = createSpawnHarness()
    const pending = runPokegenScript('Mr. Mime', 12, '/repo/out', 'wild-route-1', {
      projectRoot: '/repo',
      pokegenScript: '/repo/scripts/pokegen.sh',
      spawn,
    })

    child.stdout.emit('data', 'ignored stdout')
    child.stderr.emit('data', 'warning\n')
    child.emit('close', 0)

    await expect(pending).resolves.toEqual({ ok: true, stderr: 'warning\n' })
    expect(spawn).toHaveBeenCalledWith(
      '/repo/scripts/pokegen.sh',
      [
        '--species', 'Mr. Mime',
        '--level', '12',
        '--output-dir', '/repo/out',
        '--slug-prefix', 'wild-route-1',
      ],
      { cwd: '/repo', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  })

  it('reports non-zero exits as failed runs', async () => {
    const { child, spawn } = createSpawnHarness()
    const pending = runPokegenScript('Pidgey', 5, '/tmp/out', 'preview', {
      projectRoot: '/repo',
      spawn,
    })

    child.stderr.emit('data', 'bad input')
    child.emit('close', 2)

    await expect(pending).resolves.toEqual({ ok: false, stderr: 'bad input' })
  })

  it('reports spawn errors and ignores later close events', async () => {
    const { child, spawn } = createSpawnHarness()
    const pending = runPokegenScript('Rattata', 6, '/tmp/out', 'preview', {
      projectRoot: '/repo',
      spawn,
    })

    child.stderr.emit('data', 'before: ')
    child.emit('error', new Error('missing script'))
    child.emit('close', 0)

    await expect(pending).resolves.toEqual({ ok: false, stderr: 'before: Error: missing script' })
  })
})
