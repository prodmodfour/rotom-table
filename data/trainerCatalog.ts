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

const featuredTrainerOrder = ['Lenora Vask', 'Hassan', 'Marilena', 'Clara', 'Aurora']
const featuredTrainerIndex = new Map(
  featuredTrainerOrder.map((trainer, index) => [trainer, index]),
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
      entityKind: 'trainer',
      spriteCrop:
        sprite.canvas_width &&
        sprite.canvas_height &&
        sprite.bbox_width &&
        sprite.bbox_height &&
        sprite.bbox_left !== undefined &&
        sprite.bbox_top !== undefined
          ? {
              canvasWidth: sprite.canvas_width,
              canvasHeight: sprite.canvas_height,
              left: sprite.bbox_left,
              top: sprite.bbox_top,
              width: sprite.bbox_width,
              height: sprite.bbox_height,
            }
          : undefined,
    }
  })
  .filter((entry): entry is PokemonCatalogEntry => entry !== null)
  .sort((left, right) => {
    const leftFeaturedIndex = featuredTrainerIndex.get(left.species)
    const rightFeaturedIndex = featuredTrainerIndex.get(right.species)

    if (leftFeaturedIndex !== undefined || rightFeaturedIndex !== undefined) {
      if (leftFeaturedIndex === undefined) {
        return 1
      }

      if (rightFeaturedIndex === undefined) {
        return -1
      }

      return leftFeaturedIndex - rightFeaturedIndex
    }

    return left.species.localeCompare(right.species)
  })
