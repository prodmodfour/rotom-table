import { randomBytes, randomInt } from 'node:crypto'
import {
  CLIENT_ID_PREFIX,
  GM_KEY_PREFIX,
  PLAYER_ID_PREFIX,
  SESSION_ID_PREFIX,
  parseClientId,
  parseGmKey,
  parseJoinCode,
  parsePlayerId,
  parseSessionId,
  type ClientId,
  type GmKey,
  type JoinCode,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'

export const SESSION_JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' as const
export const DEFAULT_SESSION_JOIN_CODE_LENGTH = 8 as const

const randomBase64Url = (byteLength: number): string => randomBytes(byteLength).toString('base64url')

const randomStringFromAlphabet = (alphabet: string, length: number): string => {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomInt(0, alphabet.length)]
  }
  return value
}

export const generateSessionId = (): SessionId =>
  parseSessionId(`${SESSION_ID_PREFIX}${randomBase64Url(12)}`)

export const generateClientId = (): ClientId =>
  parseClientId(`${CLIENT_ID_PREFIX}${randomBase64Url(12)}`)

export const generatePlayerId = (): PlayerId =>
  parsePlayerId(`${PLAYER_ID_PREFIX}${randomBase64Url(12)}`)

export const generateGmKey = (): GmKey =>
  parseGmKey(`${GM_KEY_PREFIX}${randomBase64Url(32)}`)

export const generateJoinCode = (
  length: number = DEFAULT_SESSION_JOIN_CODE_LENGTH,
): JoinCode => {
  if (!Number.isInteger(length) || length < 6 || length > 12) {
    throw new Error('join code length must be an integer from 6 to 12 characters')
  }

  return parseJoinCode(randomStringFromAlphabet(SESSION_JOIN_CODE_ALPHABET, length))
}
