import { describe, expect, it } from 'vitest'
import {
  EncounterDocumentValidationError,
  createEncounterDocument,
  parseEncounterDocument,
} from '../../shared/encounterDocuments/model'
import {
  ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION,
  EncounterDirectorCommandError,
  applyEncounterDirectorCommand,
  parseEncounterDirectorCommand,
} from '../../shared/encounterDocuments/commands'

const command = (patch: Record<string, unknown>) => parseEncounterDirectorCommand({
  schemaVersion: ENCOUNTER_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: 'director-command-1',
  encounterId: 'canal-ambush',
  baseRevision: 0,
  type: 'set-participant-visibility',
  payload: { participantId: 'hidden-zubat', visibility: 'hidden' },
  ...patch,
})

describe('first-class encounter documents', () => {
  it('creates a closed map-linked document without duplicating mechanics state', () => {
    const document = createEncounterDocument({
      encounterId: 'canal-ambush', name: 'Canal ambush', linkedMapSlug: 'canal-map', recipe: 'ambush', now: 100,
    })
    expect(document).toMatchObject({ schemaVersion: 1, revision: 0, linkedMapSlug: 'canal-map', lifecycle: 'draft' })
    expect(document).not.toHaveProperty('hp')
    expect(document).not.toHaveProperty('initiative')
    expect(document).not.toHaveProperty('positions')
    expect(() => parseEncounterDocument({ ...document, mechanics: {} })).toThrow(EncounterDocumentValidationError)
  })

  it('validates reserve/wave references and progress pairs fail closed', () => {
    const base = createEncounterDocument({ encounterId: 'canal-ambush', name: 'Canal ambush', linkedMapSlug: 'canal-map', now: 100 })
    expect(() => parseEncounterDocument({
      ...base,
      waves: [{ waveId: 'wave-one', label: 'One', status: 'planned', participantIds: [], reserveIds: ['missing'], revealOnDeploy: true }],
    })).toThrow('unknown reserve')
    expect(() => parseEncounterDocument({
      ...base,
      objectives: [{ objectiveId: 'goal', label: 'Goal', visibility: 'public', status: 'active', progress: 2, maximum: 1 }],
    })).toThrow('bounded progress pair')
  })

  it('hides and atomically reveals pre-staged wave participants by revision', () => {
    const base = createEncounterDocument({ encounterId: 'canal-ambush', name: 'Canal ambush', linkedMapSlug: 'canal-map', now: 100 })
    const hidden = applyEncounterDirectorCommand({ document: base, command: command({}), now: 101 })
    const withWave = applyEncounterDirectorCommand({
      document: hidden,
      command: command({
        commandId: 'director-command-2',
        baseRevision: 1,
        type: 'upsert-wave',
        payload: {
          wave: { waveId: 'wave-one', label: 'Canal ambushers', status: 'ready', participantIds: ['hidden-zubat'], reserveIds: [], revealOnDeploy: true },
        },
      }),
      now: 102,
    })
    const deployed = applyEncounterDirectorCommand({
      document: withWave,
      command: command({
        commandId: 'director-command-3', baseRevision: 2, type: 'set-wave-status', payload: { waveId: 'wave-one', status: 'deployed' },
      }),
      now: 103,
    })
    expect(deployed.revision).toBe(3)
    expect(deployed.hiddenParticipantIds).toEqual([])
    expect(deployed.waves[0]?.status).toBe('deployed')
    expect(() => applyEncounterDirectorCommand({ document: deployed, command: command({}), now: 104 }))
      .toThrow(EncounterDirectorCommandError)
  })

  it('owns bounded objectives, clocks, phases, stakes, and notes without changing map mechanics', () => {
    let document = createEncounterDocument({ encounterId: 'canal-ambush', name: 'Canal ambush', linkedMapSlug: 'canal-map', now: 100 })
    const intents = [
      {
        type: 'upsert-objective',
        payload: { objective: { objectiveId: 'goal', label: 'Reach the gate', visibility: 'public', status: 'active', progress: 1, maximum: 3 } },
      },
      {
        type: 'upsert-clock',
        payload: { clock: { clockId: 'gate', label: 'Gate closes', visibility: 'public', status: 'active', progress: 2, maximum: 4 } },
      },
      {
        type: 'upsert-phase',
        payload: { phase: { phaseId: 'pursuit', label: 'Pursuit', visibility: 'public', status: 'upcoming', summary: 'Reach the gate.' } },
      },
      { type: 'activate-phase', payload: { phaseId: 'pursuit' } },
      {
        type: 'set-story',
        payload: { name: 'Canal pursuit', lifecycle: 'active', publicStakes: 'The gate closes.', gmStakes: 'A witness escapes.', notes: 'Private route.' },
      },
    ] as const
    for (const [index, intent] of intents.entries()) {
      document = applyEncounterDirectorCommand({
        document,
        command: command({ commandId: `story-command-${index}`, baseRevision: index, ...intent }),
        now: 101 + index,
      })
    }
    expect(document).toMatchObject({ revision: 5, name: 'Canal pursuit', lifecycle: 'active', activePhaseId: 'pursuit' })
    expect(document.objectives[0]?.progress).toBe(1)
    expect(document.clocks[0]?.progress).toBe(2)
    expect(document.phases[0]?.status).toBe('active')
    expect(document.notes).toBe('Private route.')
  })

  it('rejects open command envelopes and unsupported statuses', () => {
    expect(() => command({ trace: 'private' })).toThrow('unsupported or missing fields')
    expect(() => command({ payload: { participantId: 'hidden-zubat', visibility: 'maybe' } })).toThrow('visibility')
  })
})
