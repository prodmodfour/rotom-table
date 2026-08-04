# Encounter design system v1

The encounter design system converts the normative semantics in `DESIGN.md` into one versioned implementation contract. It is shared by the Field Guide, Workshop, and Live Encounter contexts; mechanics and privacy remain owned by authorised domain projections.

## Authority and files

- Structured token authority: `data/encounter-workspace/design-tokens.v1.json`
- Typed token/contrast API: `shared/encounterWorkspace/designTokens.ts`
- CSS implementation: `src/assets/css/encounter-design-system.css`
- Primitive contracts: `shared/encounterWorkspace/primitives.ts`
- Vue primitives: `src/components/encounter/Encounter*.vue`
- Gallery: `/design-system/encounter`
- Static checks: `npm run check:encounter-design`
- Visual baselines: `tests/e2e/encounter-design-system.spec.ts-snapshots/`

`schemaVersion: 1` and `tokenSetId: rotom-encounter-design-v1` are explicit. Material semantic changes require a reviewed token-version change rather than an untracked local colour, radius, shadow, motion, or z-index.

## Contexts

Set `data-rt-design-system="1"` and exactly one context on a containing surface:

```html
<main class="rt-design-system" data-rt-design-system="1" data-rt-context="live-encounter">
  …
</main>
```

- `field-guide`: reading-first, comfortable, opaque, with the book family reserved for sparse display hierarchy.
- `workshop`: compact, fully labelled authoring and maintenance controls with explicit state.
- `live-encounter`: actor/decision-led hierarchy over a restrained world treatment.

A context does not change the meanings of brand, focus, pending, success, danger, or information.

## Theme, density, and type

The app’s existing `data-theme="dark|light"` selector drives both old aliases and the new `--rt-*` roles. Isolated fixture regions can use `data-rt-theme`. All reviewed foreground/background pairs are programmatically checked against their declared WCAG threshold. Primary actions use a theme-specific `onBrand` colour because white does not meet 4.5:1 against the dark-theme brand red.

Density is `comfortable`, `standard`, or `compact`. It changes control height, card padding, and region rhythm—not information hierarchy. Primary live controls remain at least 44px where practical and rise to 48px on narrow layouts.

Type roles are `display-xl`, `display-lg`, `heading-md`, `action-md`, `body-md`, `body-sm`, `label-sm`, and `meta-xs`. `.rt-numeric` uses JetBrains Mono with tabular numerals for HP, initiative, distance, damage, resources, quantities, rounds, and durations. `.rt-table-distance` raises important interface sizes without making metadata carry essential meaning.

## Surfaces and shape grammar

`EncounterSurface` binds the closed world/persistent/decision/system/inspector layer and elevation scales. `.rt-surface` is matte and solid. `.rt-world-overlay` is the only shared backdrop-blur primitive and is reserved for compact controls physically floating over a rendered world. The checker rejects local glass in encounter components.

The signal spine carries affiliation, actor/category, or responder ownership. The controlled notch is available only on participant/action/decision-level surfaces. Neither cue replaces a text label, symbol, or accessible state.

## Components

- `EncounterParticipantCard`: portrait/fallback, name, role, named/symbolled side, HP/temp HP, urgent conditions, current turn, selection, and inspect path.
- `EncounterActionCard`: name, intent group, source provenance, timing, cost, usage, scope, availability, safe unavailable reason, activate, and explain paths.
- `EncounterDecisionCard`: responder, trigger headline, prompt, public waiting summary, options, disabled reasons, timing, pass, and cancel. An active card focuses its heading.
- `EncounterStatusChip`: compact noun/value state. Interactive chips are native buttons and visually distinct.
- `EncounterUtilityControl`: ordinary labelled control with optional icon, shortcut, expansion state, busy state, and proportional primary/danger treatment.
- `EncounterInspectorPanel`: native details/summary disclosure. It renders no DOM at all when its projection is unauthorised.
- `EncounterMotionCue`: finite pulse, lock, sweep, travel, impact, settle, or correct cue.

These are presentation primitives. IDs may be retained as event keys or command values, but raw IDs are not their user-visible labels.

## State contract

The common state set is idle, hover, focused, selected, pending, accepted, corrected, and unavailable.

- Focus uses an electric-cyan three-pixel outline plus an adjacent separation ring.
- Selected adds focus border and signal treatment.
- Pending uses amber and decision elevation.
- Accepted uses mint alongside accepted copy.
- Corrected uses information colour and a double border, distinct from voluntary travel.
- Unavailable stays legible with a dashed frame and an explicit reason; it is not hidden or reduced to opacity.

## Motion and accessibility

Every named animation is finite (`animation-iteration-count: 1`). Reduced motion turns cues into a one-millisecond settle and suppresses travel while preserving sequence and state. Forced-colour rules retain borders and signal structure.

Native buttons, links, details/summary, headings, groups, labels, pressed state, and disabled state provide the baseline semantics. The workspace owns higher-level focus restoration and live-region arbitration. Side colour always accompanies a name/symbol. Hover is never the only access path.

## Enforcement

`check_encounter_design_system.ts` validates token schema and contrast, all contexts/densities/states, required primitives, finite motion, reduced/forced-colour handling, the one permitted glass primitive, semantic colour separation, and absence of local colours/glass/infinite motion in encounter components.

Focused Vitest coverage checks contrast math and component semantics. Playwright runs the gallery at desktop and mobile sizes, checks serious/critical axe findings, keyboard paths and target size, and compares token/theme, component, and state sections with reviewed screenshots. The main quality gate runs the non-plan design check; final encounter acceptance also runs `check:encounter-design-complete` after EUX-010 through EUX-019 are archived as done.
