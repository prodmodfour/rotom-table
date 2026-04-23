trainer +name:
    @python3 scripts/trainer_lookup.py {{quote(name)}}
    
# Roll on an encounter table and generate PTU stat blocks into a dedicated folder.
# Usage:
#   just encounter                                          # list regions
#   just encounter <region>                                 # list tables in region
#   just encounter <region> <table>                         # show the table
#   just encounter <region> <table> <count>                 # roll & generate stat blocks
#   just encounter <region> <table> <count> <preview>       # stream to stdout, no files
#   just encounter <region> <table> <count> <preview> <out_root>
#   just encounter --clear                                  # remove all generated subfolders
#   just encounter --clear <out_root>                       # clear a specific root
# Creates <out_root>/<table>_<count>/ (auto-suffixed -2, -3, ... if it already exists).
# <preview>: anything non-empty (e.g. "preview", "1", "dry") enables preview mode.
encounter region="" table="" count="" preview="" out_root="generated_pokemon":
    #!/usr/bin/env bash
    set -euo pipefail

    # --clear: wipe generated subfolders from an out_root.
    # Second positional (normally <table>) overrides the target root.
    if [ "{{region}}" = "--clear" ]; then
        target="{{table}}"
        [ -z "$target" ] && target="generated_pokemon"
        if [ ! -d "$target" ]; then
            echo "Nothing to clear: '$target' does not exist."
            exit 0
        fi
        shopt -s nullglob
        victims=("$target"/*/)
        if [ "${#victims[@]}" -eq 0 ]; then
            echo "Nothing to clear in '$target/'."
            exit 0
        fi
        for v in "${victims[@]}"; do
            echo "  rm -rf $v"
            rm -rf "$v"
        done
        echo ">>> Cleared ${#victims[@]} folder(s) from $target/"
        exit 0
    fi

    # Info modes: fall back to roll.py when not enough args were given.
    if [ -z "{{region}}" ]; then
        exec ./scripts/roll.py
    fi
    if [ -z "{{table}}" ]; then
        exec ./scripts/roll.py "{{region}}"
    fi
    if [ -z "{{count}}" ]; then
        exec ./scripts/roll.py "{{region}}" "{{table}}"
    fi

    roll=./scripts/roll.py
    pokegen=./scripts/pokegen.sh

    # Preview mode: stream stat blocks to stdout, write nothing permanent.
    if [ -n "{{preview}}" ]; then
        dir=$(mktemp -d)
        trap 'rm -rf "$dir"' EXIT
        abs_dir="$dir"
        echo ">>> Rolling {{count}}x on {{region}}/{{table}} (preview, no files written)"
    else
        # Pick a unique output folder so repeat runs don't clobber.
        base="{{out_root}}/{{table}}_{{count}}"
        dir="$base"
        n=2
        while [ -e "$dir" ]; do
            dir="${base}-${n}"
            n=$((n + 1))
        done
        mkdir -p "$dir"
        # pokegen.sh cd's into ptu-data/ before running cli.py, so we must
        # pass an absolute path for --output-dir.
        abs_dir=$(cd "$dir" && pwd)
        echo ">>> Rolling {{count}}x on {{region}}/{{table}} → $dir"
    fi
    roll_out=$($roll {{region}} {{table}} {{count}})
    echo "$roll_out"
    echo

    # Parse "Species Name (Lv N)" lines (skip the "--- ... ---" header).
    failures=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        species=$(printf '%s' "$line" | sed -E 's/ \(Lv [0-9]+\)$//')
        level=$(printf '%s'   "$line" | sed -nE 's/.*\(Lv ([0-9]+)\)$/\1/p')
        if [ -z "$species" ] || [ -z "$level" ]; then
            echo "!! could not parse: $line" >&2
            failures=$((failures + 1))
            continue
        fi
        # Silence pokegen's own per-file summary; the roll output above
        # already lists what was generated, and we print the final ls.
        if ! $pokegen --species "$species" --level "$level" --output-dir "$abs_dir" >/dev/null; then
            echo "!! pokegen failed for '$species' Lv $level (skipping)" >&2
            failures=$((failures + 1))
        fi
    done < <(printf '%s\n' "$roll_out" | grep -v '^---')

    echo
    if [ -n "{{preview}}" ]; then
        # Stream generated stat blocks to stdout, then discard the tempdir.
        for f in "$abs_dir"/*.md; do
            [ -e "$f" ] || continue
            echo "======== $(basename "$f") ========"
            cat "$f"
            echo
        done
        echo ">>> Preview complete (no files written)"
    else
        echo ">>> Done. Files in $dir/"
        ls "$dir"
    fi
    if [ "$failures" -gt 0 ]; then
        echo "(!) $failures encounter(s) skipped" >&2
    fi

# Lookup a Pokémon from ptu-data/data/pokedex.json.
# Usage: just pokemon <pokemon name>
pokemon +name:
    @python3 scripts/lookup_ptu.py pokemon "{{name}}"

# Lookup an Ability from ptu-data/data/abilities.json.
# Usage: just ability <ability name>
ability +name:
    @python3 scripts/lookup_ptu.py ability "{{name}}"

# Lookup a Move from ptu-data/data/moves.json.
# Usage: just move <move name>
move +name:
    @python3 scripts/lookup_ptu.py move "{{name}}"

# Lookup a Capability from ptu-data/data/capabilities.json.
# Usage: just capability <capability name>
capability +name:
    @python3 scripts/lookup_ptu.py capability "{{name}}"

# Lookup a Condition from ptu-data/data/conditions.json.
# Usage: just condition <condition name>
condition +name:
    @python3 scripts/lookup_ptu.py condition "{{name}}"

# Lookup an Item from ptu-data/data/items.json.
# Usage: just item <item name>
item +name:
    @python3 scripts/lookup_ptu.py item "{{name}}"

# Lookup a Rule from ptu-data/data/rules.json.
# Usage: just rule <rule name>
rule +name:
    @python3 scripts/lookup_ptu.py rule "{{name}}"

# Rebuild the reference caches used by capability/condition/item/rule lookups.
rebuild-reference-cache:
    python3 ptu-data/parse_capabilities.py
    python3 ptu-data/parse_conditions.py
    python3 ptu-data/parse_items.py
    python3 ptu-data/parse_rules.py
