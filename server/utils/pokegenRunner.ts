import { spawn as nodeSpawn } from 'node:child_process'
import { resolve as resolvePath } from 'node:path'

export interface PokegenRunResult {
  ok: boolean
  stderr: string
}

export interface PokegenSheetRunResult extends PokegenRunResult {
  content?: string
  fileName?: string
}

export type RunPokegen = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
) => Promise<PokegenRunResult>

export type RunPokegenSheet = (
  species: string,
  level: number,
  slugPrefix: string,
  sequence: number,
) => Promise<PokegenSheetRunResult>

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

const runPokegenProcess = (
  args: string[],
  options: RunPokegenScriptOptions = {},
): Promise<PokegenRunResult & { stdout: string }> => {
  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT
  const pokegenScript = options.pokegenScript ?? resolvePath(projectRoot, 'scripts/pokegen.sh')
  const spawnProcess = options.spawn ?? (nodeSpawn as unknown as PokegenSpawn)

  return new Promise((resolve) => {
    const child = spawnProcess(
      pokegenScript,
      args,
      { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const resolveOnce = (result: PokegenRunResult & { stdout: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      resolveOnce({ ok: false, stderr: stderr + String(err), stdout })
    })
    child.on('close', (code) => {
      resolveOnce({ ok: code === 0, stderr, stdout })
    })
  })
}

export const runPokegenScript = (
  species: string,
  level: number,
  outputDir: string,
  slugPrefix: string,
  options: RunPokegenScriptOptions = {},
): Promise<PokegenRunResult> => runPokegenProcess([
  '--species', species,
  '--level', String(level),
  '--output-dir', outputDir,
  '--slug-prefix', slugPrefix,
], options).then(({ ok, stderr }) => ({ ok, stderr }))

export const runPokegenSheetScript = async (
  species: string,
  level: number,
  slugPrefix: string,
  sequence: number,
  options: RunPokegenScriptOptions = {},
): Promise<PokegenSheetRunResult> => {
  const result = await runPokegenProcess([
    '--species', species,
    '--level', String(level),
    '--slug-prefix', slugPrefix,
    '--slug-sequence', String(sequence),
    '--stdout-json',
  ], options)
  return {
    ok: result.ok,
    stderr: result.stderr,
    ...(result.stdout.trim() ? { content: result.stdout } : {}),
  }
}
