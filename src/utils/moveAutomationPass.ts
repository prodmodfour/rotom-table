import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'

export const passDestinationLogLine = (
  user: Pick<SpawnedPokemon, 'species'>,
  destination: GridAnchor,
): string => `${user.species} ends the Pass dash at (${destination.x}, ${destination.y}, ${destination.z}).`
