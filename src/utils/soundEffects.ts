import { DEFAULT_SOUND_EFFECTS_ENABLED } from '~/utils/soundEffectSettings'

type AudioContextConstructor = typeof AudioContext

type SoundEffectWindow = Window & {
  AudioContext?: AudioContextConstructor
  webkitAudioContext?: AudioContextConstructor
}

export const SOUND_EFFECT = {
  diceRoll: 'dice-roll',
  pokeballThrow: 'pokeball-throw',
  pokeballShake: 'pokeball-shake',
  pokeballSuccess: 'pokeball-success',
  pokeballFail: 'pokeball-fail',
} as const

export type SoundEffectName = typeof SOUND_EFFECT[keyof typeof SOUND_EFFECT]

export interface SoundEffectPlaybackOptions {
  /** Optional per-call scalar; final recipe volumes stay intentionally modest. */
  readonly volume?: number
  /** Suppresses accidental double-play of the same synced event across local/remote bridges. */
  readonly dedupeKey?: string
  /** Time window for dedupeKey suppression. Defaults to 300 ms. */
  readonly dedupeMs?: number
}

const DEFAULT_DEDUPE_MS = 300
const SOUND_EFFECT_UNLOCK_EVENT_OPTIONS: AddEventListenerOptions = { capture: true, passive: true }

let soundEffectsEnabled: boolean = DEFAULT_SOUND_EFFECTS_ENABLED
let audioContext: AudioContext | null = null
let unlockListenerRefCount = 0
let unlockListenerCleanup: (() => void) | null = null
const recentPlaybackByKey = new Map<string, number>()

const browserWindow = (): SoundEffectWindow | null => (
  typeof window === 'undefined' ? null : window as SoundEffectWindow
)

const browserNowMs = (): number => {
  const performanceNow = globalThis.performance?.now
  if (typeof performanceNow === 'function') return performanceNow.call(globalThis.performance)
  return Date.now()
}

const clampVolume = (value: number | null | undefined): number => {
  if (value == null) return 1
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

const playbackVolume = (baseVolume: number, options: SoundEffectPlaybackOptions): number => (
  baseVolume * clampVolume(options.volume)
)

const audioConstructor = (win: SoundEffectWindow): AudioContextConstructor | null => (
  win.AudioContext ?? win.webkitAudioContext ?? null
)

const hasTransientUserActivation = (
  win: SoundEffectWindow,
  allowUnknownActivation = false,
): boolean => {
  const activation = win.navigator?.userActivation
  if (!activation) return allowUnknownActivation
  return activation.isActive === true
}

const canCreateOrResumeAudio = (
  win: SoundEffectWindow,
  allowUnknownActivation = false,
): boolean => (
  audioContext?.state === 'running' || hasTransientUserActivation(win, allowUnknownActivation)
)

const getAudioContext = (
  win: SoundEffectWindow,
  allowUnknownActivation = false,
): AudioContext | null => {
  if (!canCreateOrResumeAudio(win, allowUnknownActivation)) return null
  const Ctor = audioConstructor(win)
  if (!Ctor) return null
  audioContext ??= new Ctor()
  return audioContext
}

const primeUnlockedContext = (context: AudioContext): void => {
  try {
    const buffer = context.createBuffer(1, 1, context.sampleRate)
    const source = context.createBufferSource()
    const gain = context.createGain()
    gain.gain.value = 0
    source.buffer = buffer
    source.connect(gain)
    gain.connect(context.destination)
    source.start(context.currentTime)
    source.stop(context.currentTime + 0.001)
  } catch {
    // Some mocked or constrained contexts do not support zero-audible priming.
  }
}

const ensureRunningContext = async (options: {
  readonly allowUnknownActivation?: boolean
} = {}): Promise<AudioContext | null> => {
  if (!soundEffectsEnabled) return null

  const win = browserWindow()
  if (!win) return null

  const allowUnknownActivation = options.allowUnknownActivation === true
  const context = getAudioContext(win, allowUnknownActivation)
  if (!context) return null

  if (context.state === 'suspended') {
    if (!hasTransientUserActivation(win, allowUnknownActivation)) return null
    try {
      await context.resume()
    } catch {
      return null
    }
  }

  if (context.state !== 'closed') primeUnlockedContext(context)
  return context.state === 'closed' ? null : context
}

const pruneRecentPlayback = (nowMs: number): void => {
  for (const [key, playedAtMs] of recentPlaybackByKey.entries()) {
    if (nowMs - playedAtMs > 5_000) recentPlaybackByKey.delete(key)
  }
}

const shouldPlayWithDedupe = (
  name: SoundEffectName,
  options: SoundEffectPlaybackOptions,
): boolean => {
  const rawKey = options.dedupeKey?.trim()
  if (!rawKey) return true

  const nowMs = browserNowMs()
  pruneRecentPlayback(nowMs)
  const key = `${name}:${rawKey}`
  const dedupeMs = Math.max(0, Number.isFinite(options.dedupeMs) ? options.dedupeMs as number : DEFAULT_DEDUPE_MS)
  const previousMs = recentPlaybackByKey.get(key)
  if (previousMs != null && nowMs - previousMs <= dedupeMs) return false

  recentPlaybackByKey.set(key, nowMs)
  return true
}

const makeGain = (context: AudioContext, volume: number): GainNode => {
  const gain = context.createGain()
  gain.gain.value = Math.max(0.0001, volume)
  gain.connect(context.destination)
  return gain
}

const beep = (context: AudioContext, options: {
  readonly frequency: number
  readonly duration: number
  readonly volume?: number
  readonly type?: OscillatorType
  readonly when?: number
  readonly slideTo?: number
}) => {
  const start = options.when ?? context.currentTime
  const duration = Math.max(0.001, options.duration)
  const volume = Math.max(0.0001, options.volume ?? 0.08)
  const osc = context.createOscillator()
  const gain = makeGain(context, volume)
  osc.type = options.type ?? 'square'
  osc.frequency.setValueAtTime(Math.max(1, options.frequency), start)
  if (options.slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.slideTo), start + duration)
  }
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration * 0.4))
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

const noiseBurst = (context: AudioContext, options: {
  readonly duration: number
  readonly volume?: number
  readonly when?: number
  readonly filter?: number
  readonly filterType?: BiquadFilterType
  readonly q?: number
}) => {
  const start = options.when ?? context.currentTime
  const duration = Math.max(0.001, options.duration)
  const sampleRate = context.sampleRate
  const frameCount = Math.max(1, Math.floor(sampleRate * duration))
  const buffer = context.createBuffer(1, frameCount, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frameCount; i += 1) {
    const fade = 1 - (i / frameCount)
    data[i] = (Math.random() * 2 - 1) * fade
  }

  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = options.filterType ?? 'bandpass'
  filter.frequency.value = options.filter ?? 1000
  filter.Q.value = options.q ?? 4
  const gain = makeGain(context, options.volume ?? 0.08)
  gain.gain.setValueAtTime(Math.max(0.0001, options.volume ?? 0.08), start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  source.connect(filter)
  filter.connect(gain)
  source.start(start)
  source.stop(start + duration)
}

const playDiceRollRecipe = (context: AudioContext, options: SoundEffectPlaybackOptions): void => {
  const t = context.currentTime
  const volume = (base: number) => playbackVolume(base, options)

  noiseBurst(context, { duration: 0.22, volume: volume(0.028), filter: 1250, q: 2.6, when: t })

  for (let i = 0; i < 5; i += 1) {
    const when = t + 0.025 + (i * 0.035)
    const pitch = 150 + (Math.random() * 170)
    noiseBurst(context, {
      duration: 0.026,
      volume: volume(0.021 + (i === 4 ? 0.012 : 0)),
      filter: 520 + (Math.random() * 1300),
      q: 5,
      when,
    })
    beep(context, {
      frequency: pitch,
      slideTo: Math.max(80, pitch * 0.72),
      duration: 0.032,
      volume: volume(0.009),
      type: 'triangle',
      when,
    })
  }

  beep(context, { frequency: 360, slideTo: 260, duration: 0.055, volume: volume(0.026), type: 'triangle', when: t + 0.205 })
}

const playPokeballThrowRecipe = (context: AudioContext, options: SoundEffectPlaybackOptions): void => {
  const t = context.currentTime
  const volume = (base: number) => playbackVolume(base, options)
  beep(context, { frequency: 880, slideTo: 420, duration: 0.18, volume: volume(0.055), type: 'square', when: t })
  noiseBurst(context, { duration: 0.16, volume: volume(0.035), filter: 1400, when: t + 0.02 })
}

const playPokeballShakeRecipe = (context: AudioContext, options: SoundEffectPlaybackOptions): void => {
  const t = context.currentTime
  const volume = (base: number) => playbackVolume(base, options)
  beep(context, { frequency: 220, slideTo: 165, duration: 0.09, volume: volume(0.07), type: 'triangle', when: t })
  beep(context, { frequency: 330, slideTo: 260, duration: 0.07, volume: volume(0.04), type: 'square', when: t + 0.035 })
  noiseBurst(context, { duration: 0.08, volume: volume(0.025), filter: 650, when: t })
}

const playPokeballSuccessRecipe = (context: AudioContext, options: SoundEffectPlaybackOptions): void => {
  const t = context.currentTime
  const volume = (base: number) => playbackVolume(base, options)
  beep(context, { frequency: 523.25, duration: 0.1, volume: volume(0.065), type: 'square', when: t })
  beep(context, { frequency: 659.25, duration: 0.1, volume: volume(0.065), type: 'square', when: t + 0.11 })
  beep(context, { frequency: 783.99, duration: 0.18, volume: volume(0.075), type: 'square', when: t + 0.22 })
}

const playPokeballFailRecipe = (context: AudioContext, options: SoundEffectPlaybackOptions): void => {
  const t = context.currentTime
  const volume = (base: number) => playbackVolume(base, options)
  beep(context, { frequency: 300, slideTo: 180, duration: 0.18, volume: volume(0.06), type: 'sawtooth', when: t })
  noiseBurst(context, { duration: 0.12, volume: volume(0.025), filter: 420, when: t + 0.02 })
}

const playRecipe = (
  name: SoundEffectName,
  context: AudioContext,
  options: SoundEffectPlaybackOptions,
): void => {
  switch (name) {
    case SOUND_EFFECT.diceRoll:
      playDiceRollRecipe(context, options)
      return
    case SOUND_EFFECT.pokeballThrow:
      playPokeballThrowRecipe(context, options)
      return
    case SOUND_EFFECT.pokeballShake:
      playPokeballShakeRecipe(context, options)
      return
    case SOUND_EFFECT.pokeballSuccess:
      playPokeballSuccessRecipe(context, options)
      return
    case SOUND_EFFECT.pokeballFail:
      playPokeballFailRecipe(context, options)
  }
}

export const setSoundEffectsEnabled = (enabled: boolean): void => {
  soundEffectsEnabled = enabled
}

export const soundEffectsAreEnabled = (): boolean => soundEffectsEnabled

export const unlockSoundEffects = async (): Promise<boolean> => {
  const context = await ensureRunningContext({ allowUnknownActivation: true })
  return Boolean(context)
}

export const installSoundEffectUnlockListeners = (): (() => void) => {
  const win = browserWindow()
  if (!win) return () => {}

  unlockListenerRefCount += 1

  if (!unlockListenerCleanup) {
    const unlockFromGesture = () => {
      if (soundEffectsEnabled) void unlockSoundEffects()
    }
    win.addEventListener('pointerdown', unlockFromGesture, SOUND_EFFECT_UNLOCK_EVENT_OPTIONS)
    win.addEventListener('keydown', unlockFromGesture, SOUND_EFFECT_UNLOCK_EVENT_OPTIONS)
    unlockListenerCleanup = () => {
      win.removeEventListener('pointerdown', unlockFromGesture, SOUND_EFFECT_UNLOCK_EVENT_OPTIONS)
      win.removeEventListener('keydown', unlockFromGesture, SOUND_EFFECT_UNLOCK_EVENT_OPTIONS)
    }
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    unlockListenerRefCount = Math.max(0, unlockListenerRefCount - 1)
    if (unlockListenerRefCount > 0) return
    unlockListenerCleanup?.()
    unlockListenerCleanup = null
  }
}

export const playSoundEffect = async (
  name: SoundEffectName,
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => {
  if (!soundEffectsEnabled || !shouldPlayWithDedupe(name, options)) return false

  const context = await ensureRunningContext()
  if (!context) return false

  playRecipe(name, context, options)
  return true
}

export const playDiceRollSound = (
  options: SoundEffectPlaybackOptions = {},
): Promise<boolean> => playSoundEffect(SOUND_EFFECT.diceRoll, options)
