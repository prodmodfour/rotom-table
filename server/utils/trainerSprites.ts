import { trainerCatalog } from '~~/data/trainerCatalog'

export interface TrainerSpriteSource {
  spriteUrl?: string | null
}

const clampRandomIndex = (value: number, length: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(length - 1, Math.floor(value * length)))
}

export const trainerSpriteUrls = (
  sprites: readonly TrainerSpriteSource[] = trainerCatalog,
): string[] => sprites
  .map((entry) => entry.spriteUrl)
  .filter((url): url is string => typeof url === 'string' && url.length > 0)

export const pickRandomTrainerSpriteUrl = (
  sprites: readonly TrainerSpriteSource[] = trainerCatalog,
  random: () => number = Math.random,
): string | undefined => {
  const urls = trainerSpriteUrls(sprites)
  if (urls.length === 0) return undefined
  return urls[clampRandomIndex(random(), urls.length)]
}
