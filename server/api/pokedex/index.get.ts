import { defineEventHandler, setHeader } from 'h3'
import { listPokedexEntrySummaries } from '../../utils/pokedexRepository'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'public, max-age=3600, stale-while-revalidate=86400')
  return listPokedexEntrySummaries()
})
