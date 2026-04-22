import { resolve } from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'

export default defineNuxtConfig({
  compatibilityDate: '2026-04-22',
  buildDir: isDev ? '.nuxt-dev' : '.nuxt-build',
  css: ['~/assets/css/main.css'],
  experimental: {
    appManifest: false,
  },
  nitro: {
    publicAssets: [
      {
        dir: resolve(process.cwd(), 'pokemon_sizes/sprites'),
        baseURL: '/sprites',
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
          content: 'A Nuxt 3 tabletop for spawning and moving Pokémon sprites on an isometric Three.js grid.',
        },
      ],
    },
  },
})
