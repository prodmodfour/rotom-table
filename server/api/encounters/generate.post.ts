/**
 * POST /api/encounters/generate
 *
 * Mirrors the ``just encounter <region> <table> <count>`` recipe in the
 * justfile: chooses a count from the requested range, rolls that many times on
 * an encounter table, and runs ``pokegen.sh`` for each rolled species/level
 * pair, writing ``CharacterSheet`` JSON files into
 * ``<outRoot>/<table>_<count>[-N]/``.
 *
 * Local development or explicitly enabled private-host tool only — spawns the
 * Rotom Table Pokémon sheet generator on the host.
 */
import { defineEventHandler, readBody } from 'h3'
import { requireGm } from '../../utils/auth'
import { requireWritableCampaignMode } from '../../utils/http'
import { throwUseCaseHttpError } from '../../utils/useCaseHttp'
import { generateEncountersUseCase } from '../../useCases/generateEncounters'
import type { GenerateEncounterBody } from '../../utils/encounterGeneration'

export default defineEventHandler(async (event) => {
  requireGm(event)
  const body = await readBody<GenerateEncounterBody | null>(event)
  if (!body?.preview) requireWritableCampaignMode()

  try {
    return await generateEncountersUseCase(body)
  } catch (err) {
    throwUseCaseHttpError(err)
  }
})
