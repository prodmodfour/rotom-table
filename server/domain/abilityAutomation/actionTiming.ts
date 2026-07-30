import {
  isAbilityMechanicOperation,
  parseAbilityMechanicOperation,
} from '#shared/abilityAutomation/mechanics'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'

const requiresStandardAction = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLocaleLowerCase('en-US')
  return normalized === 'full'
    || normalized === 'move'
    || normalized.startsWith('standard')
}

/** True when one reviewed Ability mode consumes a Standard, Full, or Move action. */
export const abilityMechanicRequiresStandardAction = (
  operation: unknown,
  modeId: string,
): boolean => {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)
    || !isAbilityMechanicOperation(operation as AbilitySpecJsonObject)) return false
  const config = parseAbilityMechanicOperation(operation).config
  if (requiresStandardAction(config.action)) return true
  const normalizedMode = modeId.trim().toLocaleLowerCase('en-US')
  if (normalizedMode === 'standard') return true
  const modeActionKey = `${normalizedMode.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())}Action`
  if (requiresStandardAction(config[modeActionKey])) return true
  if (normalizedMode === 'deploy' && requiresStandardAction(config.activationAction)) return true
  if ((normalizedMode.startsWith('mark-') || normalizedMode.startsWith('replace-'))
    && requiresStandardAction(config.markAction)) return true
  return false
}
