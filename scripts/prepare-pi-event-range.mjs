#!/usr/bin/env node

import { chmod, readFile, writeFile } from 'node:fs/promises'

const MAX_SEGMENT_BYTES = 8_000

function usage() {
  process.stderr.write('Usage: prepare-pi-event-range.mjs <input.jsonl> <first-line> <last-line> <output.txt>\n')
}

function parsePositiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value ?? '')) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}

function splitByUtf8Bytes(value, maxBytes) {
  const segments = []
  let segment = ''
  let segmentBytes = 0

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (segment && segmentBytes + characterBytes > maxBytes) {
      segments.push(segment)
      segment = ''
      segmentBytes = 0
    }
    segment += character
    segmentBytes += characterBytes
  }

  segments.push(segment)
  return segments
}

async function main() {
  if (process.argv.length !== 6) {
    usage()
    process.exitCode = 2
    return
  }

  const [, , inputPath, firstValue, lastValue, outputPath] = process.argv
  const firstLine = parsePositiveInteger(firstValue, 'first-line')
  const lastLine = parsePositiveInteger(lastValue, 'last-line')
  if (lastLine < firstLine) {
    throw new Error('last-line must be greater than or equal to first-line')
  }

  const input = await readFile(inputPath, 'utf8')
  const lines = input.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lastLine > lines.length) {
    throw new Error(`requested line ${lastLine}, but the event stream has only ${lines.length} complete lines`)
  }

  const output = []
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const segments = splitByUtf8Bytes(lines[lineNumber - 1], MAX_SEGMENT_BYTES)
    segments.forEach((segment, index) => {
      output.push(`--- PI EVENT LINE ${lineNumber} SEGMENT ${index + 1}/${segments.length} ---`)
      output.push(segment)
    })
  }

  await writeFile(outputPath, `${output.join('\n')}\n`, { mode: 0o600 })
  await chmod(outputPath, 0o600)
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Could not prepare Pi event range: ${reason}\n`)
  process.exitCode = 1
})
