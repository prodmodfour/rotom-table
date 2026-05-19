import { defineEventHandler, getQuery, setHeader } from 'h3'
import { findPokedexEntryDetail } from '../../utils/pokedexRepository'
import { routeParamToPokedexSlug } from '~/utils/pokedex/entryIndex'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')

  const { slug } = getQuery(event)
  const rawSlug = Array.isArray(slug) ? slug[0] : slug
  const normalizedSlug = typeof rawSlug === 'string' && rawSlug.trim()
    ? routeParamToPokedexSlug(rawSlug)
    : null

  return findPokedexEntryDetail(normalizedSlug)
})
