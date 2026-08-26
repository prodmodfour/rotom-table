import { createHash, randomBytes } from 'node:crypto'
import type { WildGenerationJournalDrawV1 } from '#shared/gmToolkit/generation'

export const GM_TOOLKIT_RNG_ALGORITHM = 'sha256-seeded-mulberry32-v1' as const
const UINT32_SIZE = 0x1_0000_0000
const SEED = /^[a-f0-9]{64}$/

export interface GmToolkitSeededRng {
  readonly algorithm: typeof GM_TOOLKIT_RNG_ALGORITHM
  readonly seed: string
  readonly journal: readonly WildGenerationJournalDrawV1[]
  int(minimum: number, maximum: number, purpose: string): number
}

export const createGmToolkitServerSeed = (): string => randomBytes(32).toString('hex')

export const createGmToolkitSeededRng = (seedInput: string): GmToolkitSeededRng => {
  if (!SEED.test(seedInput)) throw new Error('Generation seed must be 32 lowercase hexadecimal bytes')
  const digest = createHash('sha256').update(seedInput, 'utf8').digest()
  let state = digest.readUInt32LE(0)
  let ordinal = 0
  const journal: WildGenerationJournalDrawV1[] = []

  const uint32 = (): number => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return (value ^ (value >>> 14)) >>> 0
  }

  const int = (minimum: number, maximum: number, purpose: string): number => {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum
      || minimum < -Number.MAX_SAFE_INTEGER || maximum > Number.MAX_SAFE_INTEGER || maximum - minimum + 1 > UINT32_SIZE) {
      throw new Error('Seeded RNG range must be an ordered safe integer range no wider than uint32')
    }
    if (typeof purpose !== 'string' || purpose.length < 1 || purpose.length > 160) throw new Error('Seeded RNG purpose must be bounded text')
    const span = maximum - minimum + 1
    const acceptanceCeiling = Math.floor(UINT32_SIZE / span) * span
    let rejection = 0
    while (true) {
      const rawUint32 = uint32()
      const result = minimum + (rawUint32 % span)
      const accepted = rawUint32 < acceptanceCeiling
      journal.push(Object.freeze({
        ordinal: ++ordinal,
        purpose: rejection === 0 ? purpose : `${purpose}.retry-${rejection}`,
        rawUint32,
        range: Object.freeze({ minimum, maximum }),
        result,
        accepted,
      }))
      if (accepted) return result
      rejection += 1
    }
  }

  return {
    algorithm: GM_TOOLKIT_RNG_ALGORITHM,
    seed: seedInput,
    get journal() { return journal },
    int,
  }
}
