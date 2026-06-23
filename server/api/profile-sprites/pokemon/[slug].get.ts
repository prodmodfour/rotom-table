import { defineEventHandler, getRouterParam, setHeader, createError } from 'h3'
import { validateSlug } from '#shared/paths'
import { readPokemonProfileImage } from '../../../utils/pokedexProfileImageStorage'

const readRouteSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message })
  }
}

export default defineEventHandler((event) => {
  const slug = readRouteSlug(getRouterParam(event, 'slug'))
  const image = readPokemonProfileImage(slug)

  if (!image) {
    throw createError({ statusCode: 404, statusMessage: `Pokémon profile image not found: ${slug}` })
  }

  setHeader(event, 'content-type', 'image/png')
  setHeader(event, 'cache-control', 'no-cache')
  return image
})
