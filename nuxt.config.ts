import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createReleaseIdentity,
  releaseTagForVersion,
  ROTOM_TABLE_VERSION,
  type ReleaseBuildIdentity,
} from './shared/release/identity'

const isDev = process.env.NODE_ENV !== 'production'
const releaseBuildRequested = process.env.ROTOM_RELEASE_BUILD === '1'
const migrationSource = readFileSync(resolve(process.cwd(), 'server/storage/migrations.ts'), 'utf8')
const schemaVersionMatch = migrationSource.match(/export const LATEST_STORAGE_SCHEMA_VERSION = (\d+)/)
if (!schemaVersionMatch) throw new Error('Could not derive the release storage schema version')
const storageSchemaVersion = Number(schemaVersionMatch[1])
const npmVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/)?.[1] ?? null
const gitCommit = (): string | null => {
  if (isDev) return null
  const supplied = process.env.ROTOM_BUILD_COMMIT?.trim()
  if (supplied) return supplied
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}
const buildCommit = gitCommit()
const buildTag = process.env.ROTOM_BUILD_TAG?.trim() || null
const prereleaseCandidate = /-rc\.\d+$/.test(ROTOM_TABLE_VERSION)
const buildKind: ReleaseBuildIdentity['kind'] = isDev
  ? 'development'
  : prereleaseCandidate
    ? 'release-candidate'
    : releaseBuildRequested
      ? 'release'
      : 'production-unreleased'
const buildProvenanceComplete = Boolean(
  buildCommit
  && npmVersion
  && (!releaseBuildRequested || buildTag === releaseTagForVersion()),
)
if (releaseBuildRequested && !buildProvenanceComplete) {
  throw new Error('ROTOM_RELEASE_BUILD=1 requires ROTOM_BUILD_COMMIT, ROTOM_BUILD_TAG, Node, and npm provenance that agree with package.json')
}
const releaseIdentity = createReleaseIdentity({
  storageSchemaVersion,
  build: {
    kind: buildKind,
    commit: buildCommit,
    tag: buildTag,
    command: isDev ? 'nuxt dev' : 'npm run build',
    nodeVersion: process.version,
    npmVersion,
    provenanceComplete: buildProvenanceComplete,
  },
})
// Nuxt runtime-config defaults cannot carry null even though the public API
// models unavailable development provenance as null. Encode absence as an
// empty string here; parseReleaseIdentity restores the role-safe null shape.
const runtimeReleaseIdentity = {
  ...releaseIdentity,
  build: {
    ...releaseIdentity.build,
    commit: releaseIdentity.build.commit ?? '',
    tag: releaseIdentity.build.tag ?? '',
    npmVersion: releaseIdentity.build.npmVersion ?? '',
  },
}
const persistedDataWatchIgnored = [/(?:^|[\\/])data[\\/](?:sheets|trainers|maps|player-profiles|reference-overrides)(?:[\\/]|$)/]

export default defineNuxtConfig({
  compatibilityDate: '2026-04-22',
  modules: ['@nuxt/eslint'],
  eslint: {
    checker: false,
    config: {
      stylistic: false,
    },
  },
  srcDir: 'src',
  // Keep non-app runtime directories at the project root while Nuxt app
  // source (pages, components, composables, assets, middleware) lives in src/.
  serverDir: 'server',
  dir: {
    // Nuxt 4 resolves public from rootDir even with a custom srcDir.
    public: 'public',
  },
  buildDir: isDev ? '.nuxt-dev' : '.nuxt-build',
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],
  css: [
    '@fontsource/atkinson-hyperlegible/latin-400.css',
    '@fontsource/atkinson-hyperlegible/latin-400-italic.css',
    '@fontsource/atkinson-hyperlegible/latin-700.css',
    '@fontsource/eb-garamond/latin-400.css',
    '@fontsource/eb-garamond/latin-400-italic.css',
    '@fontsource/eb-garamond/latin-600.css',
    '@fontsource/eb-garamond/latin-700.css',
    '@fontsource/jetbrains-mono/latin-400.css',
    '@fontsource/jetbrains-mono/latin-700.css',
    '~/assets/css/main.css',
    '~/assets/css/ref.css',
    '~/assets/css/encounter-design-system.css',
  ],
  experimental: {
    appManifest: false,
  },
  runtimeConfig: {
    public: {
      // Nuxt applies runtime-config defaults mutably; clone the shared immutable identity.
      releaseIdentity: structuredClone(runtimeReleaseIdentity),
      // Browser contract fixtures are absent from normal production. The
      // production-build Playwright harness opts in explicitly.
      presentationContractPreview: false,
      // The workspace is the default live-play route after staged acceptance;
      // the Battlefield Workshop remains available for setup and exact geometry.
      encounterWorkspaceEnabled: true,
      encounterWorkspaceDefaultForLivePlay: true,
      encounterWorkspaceMetricsEnabled: true,
      battlefieldWorkshopEnabled: true,
    },
  },
  watchers: {
    chokidar: {
      // Sheet, map, profile, and reference-override JSON is edited by the app
      // itself. Let the realtime channels update UI state instead of letting
      // Nuxt/Vite full-reload every open editor when an autosave writes to disk.
      // Chokidar v4 no longer treats glob strings as patterns, so use regexes here.
      ignored: persistedDataWatchIgnored,
    },
  },
  vite: {
    server: {
      watch: {
        ignored: persistedDataWatchIgnored,
      },
    },
  },
  nitro: {
    experimental: {
      websocket: true,
    },
    publicAssets: [
      {
        dir: resolve(process.cwd(), 'trainer_sizes/sprites'),
        baseURL: '/trainer-sprites',
      },
    ],
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Rotom Table',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          name: 'description',
          content: 'A live-play tabletop for spawning and moving Pokémon sprites on isometric maps.',
        },
      ],
      script: [
        {
          innerHTML: "try{var mode=localStorage.getItem('rotom-table:theme-mode');if(mode==='light'||mode==='dark'){document.documentElement.dataset.theme=mode;document.documentElement.style.colorScheme=mode;}}catch(error){}",
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
})
