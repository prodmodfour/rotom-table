---
name: ui-design-workflow
description: Rotom Table's autonomous UI design-and-implementation workflow for Nuxt/Vue pages, components, CSS, layouts, responsive/accessibility presentation, interactions, design-system primitives, and three.js visuals. Load proactively whenever work has a visible or interactive consequence, even when no mockup was requested. For substantive open visual decisions, generate and iteratively critique target-state mockups with the resource-capped Codex native image wrapper before coding; ground every result in DESIGN.md, authorised projections, domain contracts, tokens, current implementation, and liveplay validation.
compatibility: Requires Linux user systemd and an authenticated Codex CLI with native image generation.
---

# Rotom Table autonomous UI design workflow

This is an agent-selected project capability, not a user-command-only workflow. Load it whenever work touches visible or interactive UI. For substantive design work, own the visual decisions, iterate to the quality gate, select the best artifact, then continue through implementation and liveplay validation without waiting for aesthetic approval.

## Trigger and skip policy

This skill applies to:

- pages, layouts, Vue components, CSS, visual tokens, icons, and typography;
- interaction states, navigation, forms, overlays, responsive behavior, and accessibility presentation;
- three.js scenes, cameras, controls, visual effects, and UI layered over rendered worlds;
- visual bug fixes, UI reviews, screenshot changes, and frontend implementation plans.

Generate a target-state mockup before substantive visible changes when consequential hierarchy, composition, density, state presentation, or visual-language decisions remain open. Do not wait for the user to mention mockups, GPT Image, this skill, or a `/skill` command, and do not ask permission merely to invoke it.

Load the skill but skip image generation when it would add no material information:

- provably non-visual test, type, data, or refactoring work;
- an exact mechanical UI edit with no meaningful design choice;
- faithful implementation of an authoritative finished design;
- a deterministic SVG/HTML/CSS/canvas artifact that is more accurate than generated pixels;
- explicit user opt-out.

Record the skip reason briefly. Missing taste preferences are not blockers.

## Design authority

Before composing a brief:

1. Read `DESIGN.md`; it is normative.
2. Read the relevant current page/component/styles and active implementation-plan ticket when the task belongs to one.
3. For encounter UI, also inspect:
   - `docs/encounter-workspace/design-system.md`;
   - `data/encounter-workspace/design-tokens.v1.json`;
   - relevant `Encounter*` primitives and visual baselines.
4. Identify the product context: Field Guide, Workshop, or Live Encounter.
5. Identify the audience and authorised projection before choosing visible data.
6. Use only app-owned `data/reference/*.json` for PTU runtime facts.

A generated image is a design aid, never product authority. `DESIGN.md`, domain contracts, authorised projections, structured tokens, and canonical runtime data override current screenshots and generated pixels. Never let image generation invent mechanics, permissions, privacy behavior, canonical PTU text, product claims, or unreleased campaign content.

## Autonomous design contract

- Own reversible visual decisions: hierarchy, composition, spacing, density, type character, shape treatment, token-aligned palette refinement, and polish.
- Infer safe defaults from authoritative project context and record any remaining reversible assumptions in `brief.md`.
- Ask only when a consequential non-aesthetic product fact is genuinely blocking and no safe authoritative answer exists. Do not ask users to choose between ordinary visual treatments.
- Do not impose a fixed render or retry budget. Iterate for as many versions as materially useful, with every call sequential and resource-bounded. Stop when the quality gate passes, the user explicitly limits iteration, or a concrete blocker leaves no productive next change; never repeat an unchanged failed request or render merely to accumulate variants.
- Inspect every PNG with `read`, write pixel-evidenced reviews, and keep the highest-scoring version as the current best.
- If a revision regresses, branch the next revision from the current best rather than blindly using the newest image.
- Multiple speculative concepts are not required. Choose and refine one strong direction unless alternatives are explicitly required or the initial structure fundamentally fails.
- Do not expose campaign secrets, real player information, credentials, customer data, or unreleased story content to the child Codex process.

## Artifact layout

Keep every screen/state auditable under the ignored project artifact directory:

```text
.pi/artifacts/ui-mockups/<screen-slug>/
├── brief.md
├── v001-prompt.md
├── v001.png
├── v001-review.md
├── v002-prompt.md
├── v002.png
└── v002-review.md
```

Use lowercase kebab-case. Never overwrite an iteration. `brief.md` is the stable source of truth; each prompt and review must correspond to its PNG.

## Resolve and check the renderer

`SKILL_DIR` means the directory containing this `SKILL.md`. Run from the repository root with the absolute script path:

```bash
RENDERER="$SKILL_DIR/scripts/pi-codex-ui-mockup"
"$RENDERER" --check
```

Run `--check` once before the first render in a session. If it fails, report the diagnostic and continue from normative design authority only when visual ambiguity does not block safe implementation. Never bypass the cgroup, lock, sandbox, or wrapper by invoking raw `codex`.

## Workflow

### 1. Establish current state

Inspect the relevant implementation and visual state. When it materially improves the target, use the Playwright browser skill against liveplay and save a privacy-safe screenshot. Never start deprecated local hosting. Label every image role explicitly: edit target, current-state reference, style reference, or supporting asset.

### 2. Write the stable brief and baseline prompt

Use [the design brief template](references/design-brief-template.md). Separate authoritative requirements, inferred assumptions, acceptance criteria, and forbidden patterns. Then write `v001-prompt.md` as a concise rendering specification derived from `brief.md`; it may not weaken the brief or authority sources.

### 3. Render one version at a time

Initial render:

```bash
"$RENDERER" \
  --prompt-file .pi/artifacts/ui-mockups/<screen-slug>/v001-prompt.md \
  --output .pi/artifacts/ui-mockups/<screen-slug>/v001.png
```

Targeted revision from the current best:

```bash
"$RENDERER" \
  --reference .pi/artifacts/ui-mockups/<screen-slug>/v001.png \
  --prompt-file .pi/artifacts/ui-mockups/<screen-slug>/v002-prompt.md \
  --output .pi/artifacts/ui-mockups/<screen-slug>/v002.png
```

Generate one screen/state/breakpoint per call and run calls sequentially. A failed invocation that produces no PNG does not advance the version number. Diagnose it, preserve the same version number while no artifact exists, and retry whenever a concrete fix, materially changed strategy, or recovered transient dependency makes another attempt useful. There is no fixed retry count, but never evade resource controls or spin on an unchanged unresolved failure.

### 4. Inspect, score, and iterate autonomously

Open the actual image with `read`; the Codex worker's prose is not evidence. Use [the autonomous review rubric](references/autonomous-review-template.md) and write the matching `vNNN-review.md`.

The gate passes only at **9/10 or 10/10 with no hard failure**. Hard failures include unsupported mechanics or privacy, wrong state/copy/counts, contradiction of `DESIGN.md`, unclear primary decision, unauthorised information, and misleading generation artifacts.

When the gate fails, choose the single highest-impact weakness, create the next targeted prompt, repeat every invariant, render from the highest-scoring image, and inspect again. Continue without requesting aesthetic approval for as many evidence-backed revisions as remain useful, until the gate passes or a concrete renderer, authority, or convergence blocker leaves no productive next change.

### 5. Select, implement, and validate

Select the highest-scoring passing artifact; if a concrete blocker stops iteration without a pass, record it and use generated pixels only where they remain trustworthy. Implement with existing tokens and primitives—never sample arbitrary colours, radii, shadows, fonts, or spacing from the bitmap. Preserve pending/accepted/corrected boundaries, authorised projections, liveplay behavior, and accessibility contracts.

Run focused validation appropriate to the touched UI. For encounter design-system changes, run `npm run check:encounter-design` and focused tests where relevant. Validate completed browser behavior and responsive presentation in liveplay with Playwright. Follow the repository's bounded-worker and closure-only full-suite rules.

Compare implementation screenshots against the selected mock for hierarchy and intent, not pixel identity. Document deliberate differences where domain authority, accessibility, responsive behavior, or existing primitives require them.

## Completion report

Report only after autonomous design and requested implementation work stop:

- selected mockup path, score, render count, and reference lineage;
- stable brief and selected prompt/review paths;
- implementation files changed;
- focused checks and liveplay/Playwright validation performed;
- deliberate implementation differences from the mock;
- if blocked, the concrete unresolved hard failure.

Do not end by requesting aesthetic review or recommending another evidence-backed render that can be performed now—perform it instead.

## Model provenance

The native Codex image tool does not expose a model-selection parameter or report its backend image model. Never claim that a particular GPT Image model was selected. Explicit model selection requires a separate Images API workflow and API credentials, which this skill forbids.
