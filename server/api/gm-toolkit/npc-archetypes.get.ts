import { defineEventHandler } from 'h3'
import { requireGm } from '../../utils/auth'
import { createSqliteGmNpcArchetypeRepository } from '../../storage/gmNpcArchetypeRepository'
import { projectNpcArchetypeForLibrary } from '#shared/gmToolkit/npcArchetypes'

export default defineEventHandler((event) => {
  requireGm(event)
  return {
    schemaVersion: 1,
    archetypes: createSqliteGmNpcArchetypeRepository().list().map(projectNpcArchetypeForLibrary),
  }
})
