import { spawn as nodeSpawn } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'

export interface PokegenRunResult {
  ok: boolean
  stderr: string
}

export type RunPokegen = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
) => Promise<PokegenRunResult>

export interface PokegenSpawnOptions {
  cwd: string
  stdio: ['ignore', 'pipe', 'pipe']
}

export interface PokegenSpawnStream {
  on(event: 'data', listener: (chunk: unknown) => void): unknown
}

export interface PokegenSpawnProcess {
  stdout: PokegenSpawnStream
  stderr: PokegenSpawnStream
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}

export type PokegenSpawn = (
  command: string,
  args: string[],
  options: PokegenSpawnOptions,
) => PokegenSpawnProcess

const DEFAULT_PROJECT_ROOT = resolvePath(process.cwd())

export interface RunPokegenScriptOptions {
  projectRoot?: string
  pokegenScript?: string
  spawn?: PokegenSpawn
}

export const runPokegenScript = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
  options: RunPokegenScriptOptions = {},
): Promise<PokegenRunResult> => {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT
  const pokegenScript = options.pokegenScript ?? resolvePath(projectRoot, 'scripts/pokegen.sh')
  const spawnProcess = options.spawn ?? (nodeSpawn as unknown as PokegenSpawn)

  return new Promise((resolve) => {
    const child = spawnProcess(
      pokegenScript,
      [
        '--species', species,
        '--level', String(level),
        '--output-dir', outputDir,
        '--slug-prefix', slugPrefix,
      ],
      { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    let settled = false
    const resolveOnce = (result: PokegenRunResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    // Drain stdout so the child can't block on a full pipe.
    child.stdout.on('data', () => {})
    child.on('error', (err) => {
      resolveOnce({ ok: false, stderr: stderr + String(err) })
    })
    child.on('close', (code) => {
      resolveOnce({ ok: code === 0, stderr })
    })
  })
}
