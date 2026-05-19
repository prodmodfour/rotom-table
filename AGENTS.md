This is a Nuxt 3 and three.js project.

## Rotom Table authoritative reference JSON

Runtime app knowledge is authoritative under `data/reference/`. Treat `ptu-data/` as documentary upstream/source material and parser output, not as a runtime source of truth.

- `data/reference/abilities.json`
- `data/reference/capabilities.json`
- `data/reference/conditions.json`
- `data/reference/edges.json`
- `data/reference/features.json`
- `data/reference/items.json`
- `data/reference/maneuvers.json`
- `data/reference/moves.json`
- `data/reference/pokedex.json`
- `data/reference/rules.json`

## Software Practices
When writing software, we explicitly always adhere to the following principles:
  - Single Responsibility Principle
  - Open/Closed Principle
  - Liskov Substitution Principle
  - Interface Segregation Principle
  - Dependency Inversion Principle
  - DRY principle
  - Law of Demeter

  Viiolations of these principles should be seen as codebase corruption. If you spot violations while doing work, ensure that you clean up corruption in order to keep a pure codebase.
