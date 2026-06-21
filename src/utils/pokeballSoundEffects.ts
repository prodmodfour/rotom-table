import {
  SOUND_EFFECT,
  playSoundEffect,
  type SoundEffectPlaybackOptions,
} from '~/utils/soundEffects'

export const playPokeballThrowSound = (
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => playSoundEffect(SOUND_EFFECT.pokeballThrow, options)

export const playPokeballShakeSound = (
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => playSoundEffect(SOUND_EFFECT.pokeballShake, options)

export const playPokeballSuccessSound = (
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => playSoundEffect(SOUND_EFFECT.pokeballSuccess, options)

export const playPokeballFailSound = (
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => playSoundEffect(SOUND_EFFECT.pokeballFail, options)
