import { defineEventHandler, setHeader } from 'h3'
import { listPokedexSearchEntries } from '../../utils/pokedexRepository'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  return listPokedexSearchEntries()
})
