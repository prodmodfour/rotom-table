import { resolve } from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'
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
  ],
  experimental: {
    appManifest: false,
  },
  runtimeConfig: {
    public: {
      // Browser contract fixtures are absent from normal production. The
      // production-build Playwright harness opts in explicitly.
      presentationContractPreview: false,
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
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/favicon.png' },
      ],
    },
  },
})
