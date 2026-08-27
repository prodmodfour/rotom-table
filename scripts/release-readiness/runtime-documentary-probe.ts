#!/usr/bin/env -S npx vite-node
import { DatabaseSync } from 'node:sqlite'
import abilities from '../../data/reference/abilities.json'
import capabilities from '../../data/reference/capabilities.json'
import conditions from '../../data/reference/conditions.json'
import contests from '../../data/reference/contests.json'
import edges from '../../data/reference/edges.json'
import features from '../../data/reference/features.json'
import items from '../../data/reference/items.json'
import maneuvers from '../../data/reference/maneuvers.json'
import moves from '../../data/reference/moves.json'
import pokedex from '../../data/reference/pokedex.json'
import pokeEdges from '../../data/reference/poke-edges.json'
import experience from '../../data/reference/pokemonExperienceChart.json'
import rules from '../../data/reference/rules.json'
import statRankings from '../../data/reference/stat-rankings.json'
import { PTU_NATURE_CHART } from '../../shared/ruleset/natures'
import { applyStorageMigrations, LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import { constructWildPokemon } from '../../server/domain/gmToolkit/wildPokemonConstruction'

const authorities = [
  abilities, capabilities, conditions, contests, edges, features, items, maneuvers,
  moves, pokedex, pokeEdges, experience, rules, statRankings, PTU_NATURE_CHART,
]
if (authorities.some(value => !value || typeof value !== 'object')) throw new Error('Canonical authority failed to load')
if (typeof constructWildPokemon !== 'function') throw new Error('GM canonical construction authority failed to load')
const database = new DatabaseSync(':memory:')
applyStorageMigrations(database)
if (database.prepare('PRAGMA user_version').get()?.user_version !== LATEST_STORAGE_SCHEMA_VERSION) throw new Error('Storage runtime probe failed')
database.close()
process.stdout.write(`Runtime documentary-read probe passed across ${authorities.length} canonical authorities.\n`)
