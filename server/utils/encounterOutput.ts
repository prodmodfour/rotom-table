import { join as joinPath, resolve as resolvePath } from 'node:path'
import {
  assertEncounterPathInsideRoot,
  slugifyEncounterOutputPath,
  uniqueEncounterOutputDir,
} from './encounterGeneration'

export interface EncounterOutputRequest {
  tableKey: string
  count: number
  outRoot: string
  preview: boolean
}

export type UniqueEncounterOutputDir = (
  parent: string,
  baseName: string,
  exists: (path: string) => boolean,
) => string

export interface ResolveEncounterOutputDirDependencies {
  projectRoot: string
  pathExists: (path: string) => boolean
  ensureDirectory: (path: string) => void
  makeTempDir: (prefix: string) => string
  uniqueOutputDir?: UniqueEncounterOutputDir
}

export interface EncounterOutputDirResolution {
  dir: string
  cleanup: boolean
}

export interface EncounterOutputPlan extends EncounterOutputDirResolution {
  responseDir: string
  responseRelDir: string
  slugPrefix: string
}

export const encounterOutputSlugPrefix = (
  projectRoot: string,
  outputDir: string,
  tableKey: string,
  preview: boolean,
  now: () => number,
): string => {
  const relForSlug = preview
    ? joinPath('preview', tableKey, String(now()))
    : outputDir.slice(projectRoot.length + 1)
  return slugifyEncounterOutputPath(relForSlug.replace(/^data\/sheets\//, ''))
}

export const resolveEncounterOutputDir = (
  request: EncounterOutputRequest,
  dependencies: ResolveEncounterOutputDirDependencies,
): EncounterOutputDirResolution => {
  if (request.preview) {
    return {
      dir: dependencies.makeTempDir(`rotom-encounter-${request.tableKey}-`),
      cleanup: true,
    }
  }

  const parent = resolvePath(dependencies.projectRoot, request.outRoot)
  assertEncounterPathInsideRoot(dependencies.projectRoot, parent)
  dependencies.ensureDirectory(parent)
  const dir = (dependencies.uniqueOutputDir ?? uniqueEncounterOutputDir)(
    parent,
    `${request.tableKey}_${request.count}`,
    dependencies.pathExists,
  )
  dependencies.ensureDirectory(dir)
  return { dir, cleanup: false }
}

export const createEncounterOutputPlan = (
  request: EncounterOutputRequest,
  dependencies: ResolveEncounterOutputDirDependencies & { now: () => number },
): EncounterOutputPlan => {
  const output = resolveEncounterOutputDir(request, dependencies)
  return {
    ...output,
    responseDir: request.preview ? '' : output.dir,
    responseRelDir: request.preview ? '' : output.dir.slice(dependencies.projectRoot.length + 1),
    slugPrefix: encounterOutputSlugPrefix(
      dependencies.projectRoot,
      output.dir,
      request.tableKey,
      request.preview,
      dependencies.now,
    ),
  }
}
