import trainerData from '~/trainer_sizes/trainers.json'
import trainerManifest from '~/trainer_sizes/sprite_manifest.json'
import type {
  PokemonCatalogEntry,
  TrainerSizeRecord,
  TrainerSpriteManifestRecord,
} from '~/types/pokemon'

const manifestByTrainer = new Map(
  (trainerManifest as TrainerSpriteManifestRecord[]).map((entry) => [entry.trainer, entry]),
)

export const trainerCatalog: PokemonCatalogEntry[] = (trainerData as TrainerSizeRecord[])
  .map((entry) => {
    const sprite = manifestByTrainer.get(entry.trainer)

    if (!sprite) {
      return null
    }

    return {
      species: entry.trainer,
      size: 'Trainer',
      width: entry.width,
      height: entry.height,
      base: entry.base,
      clearance: entry.clearance,
      slug: entry.slug,
      spriteUrl: `/trainer-sprites/${sprite.local_path.replace(/^sprites\//, '')}`,
    }
  })
  .filter((entry): entry is PokemonCatalogEntry => entry !== null)
  .sort((left, right) => left.species.localeCompare(right.species))
