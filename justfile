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
      '      Run the project quality gate.' \
      '' \
      '  just dan-usage' \
      '      Send one minimal request and report Dan Codex five-hour/weekly usage.'

help:
    @just default

# Run the project-specific quality gate.
quality:
    bash scripts/quality-gate.sh

# Report Dan Codex five-hour and weekly usage with one minimal request.
dan-usage:
    bash scripts/dan-usage.sh

# Start Nuxt dev mode against the local production-like Ranger workspace data.
prod-dev:
    ../bin/start-dev.sh

trainer +name:
    @python3 scripts/trainer_lookup.py {{quote(name)}}
    
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
