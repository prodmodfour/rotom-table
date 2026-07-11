# Show available just commands and common usage.
default:
    @printf '%s\n' \
      'Available just commands:' \
      '' \
      '  just' \
      '  just default' \
      '      Show this help.' \
      '' \
      '  just trainer "<name>"' \
      '      Lookup a trainer sprite entry.' \
      '' \
      '  just encounter' \
      '      List available regions.' \
      '' \
      '  just encounter <region>' \
      '      List encounter tables in a region.' \
      '' \
      '  just encounter <region> <table>' \
      '      Show entries in an encounter table.' \
      '' \
      '  just encounter <region> <table> <count>' \
      '      Roll encounters and generate PTU CharacterSheet JSON.' \
      '      Files land in the campaign data/sheets/wild/<table>_<count>/ and show up' \
      '      on the /sheets page automatically.' \
      '' \
      '  just encounter <region> <table> <count> preview' \
      '      Preview generated sheets in stdout without writing files.' \
      '' \
      '  just encounter <region> <table> <count> "" <out_root>' \
      '      Write generated files under a custom output root.' \
      '' \
      '  just encounter --clear' \
      '  just encounter --clear <out_root>' \
      '      Clear generated encounter output folders.' \
      '' \
      '  just pokemon "<pokemon name>"' \
      '  just ability "<ability name>"' \
      '  just move "<move name>"' \
      '  just capability "<capability name>"' \
      '  just condition "<condition name>"' \
      '  just item "<item name>"' \
      '  just rule "<rule name>"' \
      '      Lookup app-owned PTU reference data.' \
      '' \
      '  ROTOM_CAMPAIGN_ROOT=/path/to/campaign-repo npm run dev' \
      '      Read/write maps, sheets, profiles, sessions, and encounter tables from a separate campaign repo.' \
      '' \
      '  just prod-dev' \
      '      Start Nuxt dev mode with the local production-like Ranger workspace env.' \
      '' \
      '  just rebuild-ptu-data-cache' \
      '      Rebuild documentary ptu-data parser output (not app runtime reference).' \
      '' \
      '  just quality' \
      '      Run the autonomous build quality gate.' \
      '' \
      '  just autobuild' \
      '      Run one no-push autonomous ticket cycle from a clean tree.' \
      '' \
      '  just autobuild <cycles>' \
      '      Run multiple no-push autonomous ticket cycles.' \
      '' \
      '  just refresh <ticket-file-name>' \
      '      Refresh BUILD_TICKETS.md and PROJECT_BRIEF.md from a ticket planning file,' \
      '      delete the planning file, commit the refresh, and push the current branch.' \
      '' \
      '  just run' \
      '      Run the default 180-cycle loop with high-level status; use just follow for agent details.' \
      '' \
      '  just follow' \
      '  just follow <lines>' \
      '      Follow the active build loop, showing 40 recent lines by default.' \
      '' \
      '  just monitor' \
      '  just monitor <minutes>' \
      '      Immediately summarize and interpret build progress, then repeat every 10 minutes by default.' \
      '' \
      '  just stop' \
      '      Gracefully stop the active build loop after its current attempt/cycle.'

help:
    @just default

# Run the project-specific autonomous build quality gate.
quality:
    bash scripts/quality-gate.sh

# Run the autonomous ticket loop locally without pushing.
autobuild cycles="1":
    bash scripts/build-loop.sh --max-cycles {{cycles}} --no-push

# Compatibility recipe from the autonomous build template.
run cycles="180":
    bash scripts/build-loop.sh --max-cycles {{cycles}}

# Follow the active autonomous build loop without interrupting it.
follow lines="40":
    bash scripts/build-loop-follow.sh --lines {{quote(lines)}}

# Periodically summarize and interpret active autonomous build progress.
monitor minutes="10":
    bash scripts/build-loop-monitor.sh --interval-minutes {{quote(minutes)}}

# Request a graceful stop after the active attempt/cycle reaches a safe boundary.
stop:
    bash scripts/build-loop-stop.sh

# Refresh the autonomous queue and project brief from a ticket planning file.
refresh ticket_file:
    python3 scripts/refresh_build_queue.py {{quote(ticket_file)}}

# Start Nuxt dev mode against the local production-like Ranger workspace data.
prod-dev:
    ../bin/start-dev.sh

trainer +name:
    @python3 scripts/trainer_lookup.py {{quote(name)}}
    
# Roll on an encounter table and generate PTU CharacterSheet JSON into a
# dedicated folder under the campaign data/sheets/ (the Nuxt /sheets page reads
# that tree recursively, so the rolled mons appear there immediately).
# Usage:
#   just encounter                                          # list regions
#   just encounter <region>                                 # list tables in region
#   just encounter <region> <table>                         # show the table
#   just encounter <region> <table> <count>                 # roll & generate sheets
#   just encounter <region> <table> <count> <preview>       # stream to stdout, no files
#   just encounter <region> <table> <count> <preview> <out_root>
#   just encounter --clear                                  # remove all generated subfolders
#   just encounter --clear <out_root>                       # clear a specific root
# Creates <out_root>/<table>_<count>/ (auto-suffixed -2, -3, ... if it already exists).
# <preview>: anything non-empty (e.g. "preview", "1", "dry") enables preview mode.
encounter region="" table="" count="" preview="" out_root="data/sheets/wild":
    #!/usr/bin/env bash
    set -euo pipefail

    campaign_root="${ROTOM_CAMPAIGN_ROOT:-.}"
    campaign_root="${campaign_root%/}"
    resolve_campaign_path() {
        case "$1" in
            /*) printf '%s\n' "$1" ;;
            *) printf '%s/%s\n' "$campaign_root" "$1" ;;
        esac
    }

    # --clear: wipe generated subfolders from an out_root.
    # Second positional (normally <table>) overrides the target root.
    if [ "{{region}}" = "--clear" ]; then
        target="{{table}}"
        [ -z "$target" ] && target="data/sheets/wild"
        target=$(resolve_campaign_path "$target")
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

    # Preview mode: stream sheets to stdout, write nothing permanent.
    if [ -n "{{preview}}" ]; then
        dir=$(mktemp -d)
        trap 'rm -rf "$dir"' EXIT
        abs_dir="$dir"
        slug_prefix="preview-{{table}}-$(date +%s)"
        echo ">>> Rolling {{count}}x on {{region}}/{{table}} (preview, no files written)"
    else
        # Pick a unique output folder so repeat runs don't clobber.
        out_root_path=$(resolve_campaign_path "{{out_root}}")
        base="$out_root_path/{{table}}_{{count}}"
        dir="$base"
        n=2
        while [ -e "$dir" ]; do
            dir="${base}-${n}"
            n=$((n + 1))
        done
        mkdir -p "$dir"
        # pokegen.sh may be invoked from any working directory, so pass an
        # absolute path for --output-dir.
        abs_dir=$(cd "$dir" && pwd)
        # Slug prefix derived from the per-run path under data/sheets so each
        # generated sheet's slug stays globally unique. Strip the data/sheets/
        # prefix when present so the slug doesn't get a redundant ``data-sheets-``.
        rel="${dir#$campaign_root/}"
        rel="${rel#./}"
        rel="${rel#data/sheets/}"
        slug_prefix=$(printf '%s' "$rel" | tr '/_' '-' | tr -cd 'a-zA-Z0-9-' | tr 'A-Z' 'a-z')
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
        if ! $pokegen --species "$species" --level "$level" \
                       --output-dir "$abs_dir" \
                       --slug-prefix "$slug_prefix" >/dev/null; then
            echo "!! pokegen failed for '$species' Lv $level (skipping)" >&2
            failures=$((failures + 1))
        fi
    done < <(printf '%s\n' "$roll_out" | grep -v '^---')

    echo
    if [ -n "{{preview}}" ]; then
        # Stream generated sheets to stdout, then discard the tempdir.
        for f in "$abs_dir"/*.json; do
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

# Lookup a Pokémon from data/reference/pokedex.json.
# Usage: just pokemon <pokemon name>
pokemon +name:
    @python3 scripts/lookup_ptu.py pokemon "{{name}}"

# Lookup an Ability from data/reference/abilities.json.
# Usage: just ability <ability name>
ability +name:
    @python3 scripts/lookup_ptu.py ability "{{name}}"

# Lookup a Move from data/reference/moves.json.
# Usage: just move <move name>
move +name:
    @python3 scripts/lookup_ptu.py move "{{name}}"

# Lookup a Capability from data/reference/capabilities.json.
# Usage: just capability <capability name>
capability +name:
    @python3 scripts/lookup_ptu.py capability "{{name}}"

# Lookup a Condition from data/reference/conditions.json.
# Usage: just condition <condition name>
condition +name:
    @python3 scripts/lookup_ptu.py condition "{{name}}"

# Lookup an Item from data/reference/items.json.
# Usage: just item <item name>
item +name:
    @python3 scripts/lookup_ptu.py item "{{name}}"

# Lookup a Rule from data/reference/rules.json.
# Usage: just rule <rule name>
rule +name:
    @python3 scripts/lookup_ptu.py rule "{{name}}"

# Rebuild documentary upstream ptu-data caches. Review and copy intentional
# Rotom Table PTU implementation changes into data/reference/ rather than treating
# this as runtime sync.
rebuild-ptu-data-cache:
    python3 ptu-data/parse_capabilities.py
    python3 ptu-data/parse_conditions.py
    python3 ptu-data/parse_items.py
    python3 ptu-data/parse_rules.py
