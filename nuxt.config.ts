import { resolve } from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'

export default defineNuxtConfig({
  compatibilityDate: '2026-04-22',
  buildDir: isDev ? '.nuxt-dev' : '.nuxt-build',
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
  vite: {
    server: {
      watch: {
        // Sheet and map JSON is edited by the app itself. Let the realtime
        // channels update UI state instead of letting Vite HMR full-reload
        // every open tabletop when a token HP/condition change is persisted.
        ignored: [
          '**/data/sheets/**',
          '**/data/trainers/**',
          '**/data/maps/**',
        ],
      },
    },
  },
  nitro: {
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
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/favicon.png' },
      ],
    },
  },
})
