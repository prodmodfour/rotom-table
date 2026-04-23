#!/usr/bin/env bash
# PTU 1.05 Pokémon Generator — convenience wrapper
# Usage: ./generate_pokemon.sh [options]
# Run with --help for full options
cd "$(dirname "$0")/../ptu-data" && python3 cli.py "$@"
