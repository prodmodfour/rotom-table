import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { toPokedexSlug } from '~/utils/pokedex/searchText'
import type { PokedexRecord } from '~/types/pokemon'
import { PROJECT_ROOT } from './fsPaths'

const execFileAsync = promisify(execFile)

export const POKEDEX_MARKDOWN_ROOT = join(PROJECT_ROOT, 'books', 'markdown', 'pokedexes')
const POKEDEX_PARSER_PATH = join(PROJECT_ROOT, 'ptu-data', 'parse_pokedex.py')
const PARSE_POKEDEX_SCRIPT = `
import importlib.util
import json
import pathlib
import sys

parser_path = sys.argv[1]
markdown_path = sys.argv[2]
spec = importlib.util.spec_from_file_location("rotom_parse_pokedex", parser_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
entry = module.parse_pokemon_file(markdown_path)
if entry is None:
    raise SystemExit("Could not parse pokedex markdown")
entry["source_gen"] = pathlib.Path(markdown_path).parent.name
print(json.dumps(entry, ensure_ascii=False))
`.trim()

const markdownGenerationDirs = (): string[] => readdirSync(POKEDEX_MARKDOWN_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const candidateMarkdownPaths = (slug: string, sourceGen?: string | null): string[] => {
  const genDirs = markdownGenerationDirs()
  const orderedGenDirs = sourceGen && genDirs.includes(sourceGen)
    ? [sourceGen, ...genDirs.filter((genDir) => genDir !== sourceGen)]
    : genDirs

  return orderedGenDirs.map((genDir) => join(POKEDEX_MARKDOWN_ROOT, genDir, `${slug}.md`))
}

export const findPokedexMarkdownPath = (
  slug: string,
  sourceGen?: string | null,
): string | null => {
  for (const candidatePath of candidateMarkdownPaths(slug, sourceGen)) {
    if (existsSync(candidatePath)) return candidatePath
  }

  return null
}

export const parsePokedexMarkdownFile = async (markdownPath: string): Promise<PokedexRecord> => {
  const { stdout } = await execFileAsync(
    'python3',
    ['-c', PARSE_POKEDEX_SCRIPT, POKEDEX_PARSER_PATH, markdownPath],
    { maxBuffer: 1024 * 1024 },
  )
  const parsed = JSON.parse(stdout) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Pokedex parser returned an invalid entry')
  }

  return parsed as PokedexRecord
}

export const restorePokedexRecordFromMarkdown = async (
  currentEntry: PokedexRecord,
): Promise<PokedexRecord | null> => {
  const markdownPath = findPokedexMarkdownPath(
    toPokedexSlug(currentEntry.species),
    typeof currentEntry.source_gen === 'string' ? currentEntry.source_gen : null,
  )
  if (!markdownPath) return null

  const parsedEntry = await parsePokedexMarkdownFile(markdownPath)
  return {
    ...parsedEntry,
    width: currentEntry.width,
    height: currentEntry.height,
    base: currentEntry.base,
    clearance: currentEntry.clearance,
    source_gen: basename(dirname(markdownPath)) || parsedEntry.source_gen,
  }
}
