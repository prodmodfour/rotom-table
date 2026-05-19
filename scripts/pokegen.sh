#!/usr/bin/env bash
# PTU Pokémon sheet generator — convenience wrapper.
# Usage: ./scripts/pokegen.sh [options]
# Run with --help for full options.
python3 "$(dirname "$0")/../ptu-data/cli.py" "$@"
