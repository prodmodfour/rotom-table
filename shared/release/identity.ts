import packageMetadata from '../../package.json'

export const ROTOM_TABLE_SERVICE = 'rotom-table' as const
export const ROTOM_TABLE_VERSION = packageMetadata.version

export type ReleaseBuildKind = 'development' | 'production-unreleased' | 'release-candidate' | 'release'

export interface ReleaseBuildIdentity {
  readonly kind: ReleaseBuildKind
  readonly commit: string | null
  readonly tag: string | null
  readonly command: 'nuxt dev' | 'npm run build'
  readonly nodeVersion: string
  readonly npmVersion: string | null
  readonly provenanceComplete: boolean
}

export interface ReleaseIdentity {
  readonly service: typeof ROTOM_TABLE_SERVICE
  readonly version: string
  readonly storageSchemaVersion: number
  readonly build: ReleaseBuildIdentity
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const COMMIT = /^[0-9a-f]{40}$/

const nonEmpty = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export const releaseTagForVersion = (version = ROTOM_TABLE_VERSION): string => `v${version}`

export const createReleaseIdentity = (input: {
  readonly storageSchemaVersion: number
  readonly build: ReleaseBuildIdentity
}): ReleaseIdentity => {
  if (!SEMVER.test(ROTOM_TABLE_VERSION)) throw new Error('package.json must contain a valid semantic release version')
  if (!Number.isSafeInteger(input.storageSchemaVersion) || input.storageSchemaVersion < 1) {
    throw new Error('Release identity requires a positive storage schema version')
  }
  if (input.build.commit !== null && !COMMIT.test(input.build.commit)) {
    throw new Error('Release build commit must be a full lowercase Git SHA')
  }
  if (input.build.tag !== null && input.build.tag !== releaseTagForVersion()) {
    throw new Error(`Release build tag ${input.build.tag} disagrees with package version ${ROTOM_TABLE_VERSION}`)
  }
  if (input.build.kind === 'release' && !input.build.provenanceComplete) {
    throw new Error('Release builds require complete provenance')
  }
  return Object.freeze({
    service: ROTOM_TABLE_SERVICE,
    version: ROTOM_TABLE_VERSION,
    storageSchemaVersion: input.storageSchemaVersion,
    build: Object.freeze({ ...input.build }),
  })
}

export const parseReleaseIdentity = (value: unknown): ReleaseIdentity | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<ReleaseIdentity>
  const build = candidate.build
  if (candidate.service !== ROTOM_TABLE_SERVICE
    || candidate.version !== ROTOM_TABLE_VERSION
    || !Number.isSafeInteger(candidate.storageSchemaVersion)
    || !build || typeof build !== 'object' || Array.isArray(build)) return null
  const kind = build.kind
  if (!['development', 'production-unreleased', 'release-candidate', 'release'].includes(String(kind))) return null
  const commit = build.commit === null ? null : nonEmpty(build.commit)
  if (commit !== null && !COMMIT.test(commit)) return null
  const tag = build.tag === null ? null : nonEmpty(build.tag)
  if (tag !== null && tag !== releaseTagForVersion()) return null
  if (!['nuxt dev', 'npm run build'].includes(String(build.command))) return null
  const nodeVersion = nonEmpty(build.nodeVersion)
  const npmVersion = build.npmVersion === null ? null : nonEmpty(build.npmVersion)
  if (!nodeVersion || (build.npmVersion !== null && !npmVersion)) return null
  return {
    service: ROTOM_TABLE_SERVICE,
    version: ROTOM_TABLE_VERSION,
    storageSchemaVersion: candidate.storageSchemaVersion as number,
    build: {
      kind: kind as ReleaseBuildKind,
      commit,
      tag,
      command: build.command as ReleaseBuildIdentity['command'],
      nodeVersion,
      npmVersion,
      provenanceComplete: build.provenanceComplete === true,
    },
  }
}
