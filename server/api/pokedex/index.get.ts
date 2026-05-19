import { defineEventHandler, setHeader } from 'h3'
import { listPokedexEntrySummaries } from '../../utils/pokedexRepository'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  return listPokedexEntrySummaries()
})
