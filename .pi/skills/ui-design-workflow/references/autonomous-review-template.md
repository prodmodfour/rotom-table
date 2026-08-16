# Autonomous mockup review and quality gate

Inspect the actual PNG with `read`; never use the Codex worker's prose as evidence. Compare against `brief.md`, `DESIGN.md`, the authorised projection, relevant domain contracts, and structured tokens.

## Hard failures

Any hard failure blocks acceptance regardless of score:

- missing, malformed, duplicated, invented, or clipped required content/copy
- wrong actor, item count, interaction state, or information hierarchy
- unsupported PTU mechanic, permission, privacy behavior, or canonical claim
- information exposed outside the named authorised projection
- semantic colour or state treatment that contradicts `DESIGN.md`
- unclear primary task, blocking decision, actor, or committed action
- official Pokémon game imitation, unrequested branding, device-frame/perspective presentation, or watermark
- obvious generation artifact that would mislead implementation

## Score

Score each category from 0 to 2 using visible pixel evidence:

1. **Task, actor, and hierarchy** — the primary task/decision and actor/object are immediate; secondary tools remain quieter.
2. **Content, state, authority, and privacy fidelity** — exact copy, item counts, pending/accepted/corrected boundaries, authorised projection, and domain constraints match the brief.
3. **Density, responsive intent, and accessibility cues** — grouping, legibility, apparent target sizes, visible focus, non-colour cues, and breakpoint intent are credible.
4. **Rotom design-system fidelity and polish** — product context, semantic colour, matte surfaces, typography, signal spine/notch/electric motifs, alignment, and restraint follow `DESIGN.md` without arbitrary decoration.
5. **Implementation feasibility and artifact control** — the design decomposes into existing or plausible primitives, avoids needless nesting, and contains no clipping, malformed geometry, accidental text, or impossible visual logic.

The quality gate passes only at **9/10 or 10/10 with no hard failure**. Bitmap-invisible properties such as actual semantics, screen-reader output, focus order, measured contrast, responsive reflow, and reduced-motion behavior remain implementation checks; uncertainty there does not by itself fail the visual gate.

## Review file template

```markdown
# Review of vNNN

## Verdict
- Status: continue | accepted | blocked
- Score: N/10
- Hard failure: none | <failure>
- Primary finding:
- Current best: vNNN | vMMM remains best because ...

## Score
| Category | 0–2 | Pixel evidence |
|---|---:|---|
| Task, actor, and hierarchy | | |
| Content, state, authority, and privacy fidelity | | |
| Density, responsive intent, and accessibility cues | | |
| Rotom design-system fidelity and polish | | |
| Implementation feasibility and artifact control | | |

## Against authoritative inputs
| Criterion | Pass / fail / uncertain | Pixel evidence | Next action |
|---|---|---|---|
| Required regions, copy, and counts | | | |
| Required interaction state | | | |
| Authorised projection / privacy | | | |
| DESIGN.md semantics and component anatomy | | | |
| Obvious contrast/focus/non-colour cues | | | |
| Generation artifacts/clipping | | | |

## Preserve
- ...

## Highest-impact weakness
- ...

## Autonomous next action
- Accept, or describe exactly one targeted revision. Do not defer a reversible aesthetic decision to the user.

## Implementation-time checks
- semantic structure, keyboard behavior, screen-reader output, responsive behavior, localization, measured touch targets/contrast, motion, and liveplay behavior cannot be proven by this bitmap
```

## Selection rules

- Keep the highest-scoring version as the current best.
- If a revision regresses, base the next attempt on the current best rather than the newest image.
- Change one category per revision and repeat all invariants.
- There is no fixed render or retry budget. Continue while a material defect remains and another evidence-backed revision has a plausible path to improvement; stop as soon as the gate passes.
- If a concrete renderer, authority, or convergence blocker prevents productive progress, select the highest-scoring version, mark it `blocked`, and name the remaining failure. Never call the newest image final by default.
