type AudioContextConstructor = typeof AudioContext

let audioContext: AudioContext | null = null

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  const Ctor = (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext)
  if (!Ctor) return null
  audioContext ??= new Ctor()
  return audioContext
}

const ensureRunningContext = async (): Promise<AudioContext | null> => {
  const context = getAudioContext()
  if (!context) return null
  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      return null
    }
  }
  return context
}

const makeGain = (context: AudioContext, volume: number): GainNode => {
  const gain = context.createGain()
  gain.gain.value = volume
  gain.connect(context.destination)
  return gain
}

const beep = (context: AudioContext, options: {
  frequency: number
  duration: number
  volume?: number
  type?: OscillatorType
  when?: number
  slideTo?: number
}) => {
  const start = options.when ?? context.currentTime
  const osc = context.createOscillator()
  const gain = makeGain(context, options.volume ?? 0.08)
  osc.type = options.type ?? 'square'
  osc.frequency.setValueAtTime(options.frequency, start)
  if (options.slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.slideTo), start + options.duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(options.volume ?? 0.08, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration)
  osc.connect(gain)
  osc.start(start)
  osc.stop(start + options.duration + 0.02)
}

const noiseBurst = (context: AudioContext, options: {
  duration: number
  volume?: number
  when?: number
  filter?: number
}) => {
  const start = options.when ?? context.currentTime
  const sampleRate = context.sampleRate
  const frameCount = Math.max(1, Math.floor(sampleRate * options.duration))
  const buffer = context.createBuffer(1, frameCount, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frameCount; i += 1) {
    const fade = 1 - (i / frameCount)
    data[i] = (Math.random() * 2 - 1) * fade
  }

  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = options.filter ?? 1000
  filter.Q.value = 4
  const gain = makeGain(context, options.volume ?? 0.08)
  gain.gain.setValueAtTime(options.volume ?? 0.08, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration)
  source.connect(filter)
  filter.connect(gain)
  source.start(start)
  source.stop(start + options.duration)
}

export const playPokeballThrowSound = async () => {
  const context = await ensureRunningContext()
  if (!context) return
  const t = context.currentTime
  beep(context, { frequency: 880, slideTo: 420, duration: 0.18, volume: 0.055, type: 'square', when: t })
  noiseBurst(context, { duration: 0.16, volume: 0.035, filter: 1400, when: t + 0.02 })
}

export const playPokeballShakeSound = async () => {
  const context = await ensureRunningContext()
  if (!context) return
  const t = context.currentTime
  beep(context, { frequency: 220, slideTo: 165, duration: 0.09, volume: 0.07, type: 'triangle', when: t })
  beep(context, { frequency: 330, slideTo: 260, duration: 0.07, volume: 0.04, type: 'square', when: t + 0.035 })
  noiseBurst(context, { duration: 0.08, volume: 0.025, filter: 650, when: t })
}

export const playPokeballSuccessSound = async () => {
  const context = await ensureRunningContext()
  if (!context) return
  const t = context.currentTime
  beep(context, { frequency: 523.25, duration: 0.1, volume: 0.065, type: 'square', when: t })
  beep(context, { frequency: 659.25, duration: 0.1, volume: 0.065, type: 'square', when: t + 0.11 })
  beep(context, { frequency: 783.99, duration: 0.18, volume: 0.075, type: 'square', when: t + 0.22 })
}

export const playPokeballFailSound = async () => {
  const context = await ensureRunningContext()
  if (!context) return
  const t = context.currentTime
  beep(context, { frequency: 300, slideTo: 180, duration: 0.18, volume: 0.06, type: 'sawtooth', when: t })
  noiseBurst(context, { duration: 0.12, volume: 0.025, filter: 420, when: t + 0.02 })
}
