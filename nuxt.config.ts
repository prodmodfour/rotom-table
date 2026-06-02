import { resolve } from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'
const persistedDataWatchIgnored = [/(?:^|[\\/])data[\\/](?:sheets|trainers|maps|player-profiles)(?:[\\/]|$)/]

export default defineNuxtConfig({
  compatibilityDate: '2026-04-22',
  srcDir: 'src',
  // Keep non-app runtime directories at the project root while Nuxt app
  // source (pages, components, composables, assets, middleware) lives in src/.
  serverDir: 'server',
  dir: {
    public: '../public',
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
  watchers: {
    chokidar: {
      // Sheet and map JSON is edited by the app itself. Let the realtime
      // channels update UI state instead of letting Nuxt/Vite full-reload
      // every open editor when an autosave writes to disk. Chokidar v4 no
      // longer treats glob strings as patterns, so use regexes here.
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
      title: 'Rotom Table',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1',
        },
        {
          name: 'description',
          content: 'A Nuxt 3 tabletop for spawning and moving Pokémon sprites on isometric maps.',
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
