# Storyboard workflow for multi-frame flows

Use this workflow when the open design question is a sequence rather than a single screen: multi-step tasks, state progressions over time (pending → accepted / corrected), cross-actor or cross-projection exchanges, onboarding, and error/recovery paths. A storyboard is an ordered set of frames. Every frame is produced, inspected, and gated exactly like a single mockup; the flow adds continuity control on top. All single-mockup authority, privacy, renderer, and resource rules apply unchanged.

## Artifact layout

```text
.pi/artifacts/ui-storyboards/<flow-slug>/
├── flow.md                      # stable flow authority
├── f01-<step-slug>/
│   ├── v001-prompt.md
│   ├── v001.png
│   └── v001-review.md
├── f02-gm-<step-slug>/          # lane frame: GM projection of moment 2
├── f02-player-<step-slug>/      # lane frame: player projection of moment 2
├── f03-<step-slug>-narrow/      # breakpoint variant as its own frame
├── continuity-review.md
└── contact-sheet.png
```

- Frame directories are `fNN-<step-slug>` in flow order, lowercase kebab-case, never renumbered after a frame has rendered.
- Frames sharing `NN` depict the same moment under different authorised projections (lanes); put the lane slug immediately after the number.
- A materially different breakpoint of a step is its own frame with a `-narrow`/`-wide` suffix.
- Versions inside a frame follow single-mockup rules: sequential `vNNN`, never overwritten, failed invocations that produce no PNG do not advance the number.

## flow.md — the flow authority

`flow.md` plays the role `brief.md` plays for a single mockup: it is stable, and no frame prompt may weaken it. Frames illustrate `flow.md` and must not invent steps, actors, data, or state changes it does not define. Write it before rendering any pixels.

Template (omit irrelevant fields):

```markdown
# <flow name>

## Flow context
- Context: Field Guide | Workshop | Live Encounter
- Lanes / audiences: <one per authorised projection, e.g., GM, player>
- Entry point and precondition:
- Outcome / success state:
- Fidelity: polished product UI | structural wireframe — wireframe only while step structure is genuinely unsettled
- Viewport(s):

## Authoritative inputs inspected
- DESIGN.md sections:
- Design tokens / primitives:
- Relevant implementation:
- Domain contract / authorised projection per lane:
- Active ticket, when applicable:

## Flow diagram

<mermaid sequenceDiagram or stateDiagram-v2 defining every step and
transition the frames may depict — the authoritative step structure>

## Frame table
| Frame | Lane | Moment | Trigger (from previous frame) | State delta | Must show | Must not reveal | Implementation surface |
|---|---|---|---|---|---|---|---|
| f01-<slug> | player | ... | entry | — | ... | ... | <route/component/state> |

## Flow invariants
- Persistent regions that must not move between frames:
- Verbatim copy locked across frames:
- Data conservation: <objects that may not appear, vanish, or change except via a listed trigger>
- Legal state progressions: <e.g., pending → accepted | corrected; never backwards>

## Inferred design assumptions
- <reversible choices where authority is silent>

## Flow acceptance criteria
- <observable cross-frame conditions>

## Constraints / avoid
- every single-mockup brief constraint, applied to every frame
```

## Rendering and chaining

- Bring the current frame to a per-frame gate pass before rendering the next frame in its lane; chained references propagate defects otherwise.
- Render frame N+1 with the accepted frame N PNG from the same lane as `--reference`, labeled in the prompt: continuity reference — previous accepted frame in this flow lane; preserve persistent regions and visual language; change only what this frame's trigger and state delta dictate.
- The first frame of a second lane may take the accepted same-numbered frame from the sibling lane as a labeled supporting reference for moment parity; lane content must still match that lane's authorised projection.
- Within a frame, iterate exactly like a single mockup: targeted revisions branched from the frame's current best.
- One frame per call, all calls sequential.

## Per-frame review

Use [the autonomous review rubric](autonomous-review-template.md) for every version, and append these rows to its "Against authoritative inputs" table:

| Criterion | Pass / fail / uncertain | Pixel evidence | Next action |
|---|---|---|---|
| Continuity with previous accepted frame in lane | | | |
| Visible change fully explained by this frame's trigger and state delta | | | |

Continuity hard failures block acceptance like any other hard failure:

- a state progression `flow.md` does not allow (e.g., accepted → pending, skipped corrected)
- data appearing, vanishing, or mutating between frames with no listed trigger
- a persistent region jumping position or changing anatomy between consecutive frames in a lane
- a step, actor, or projection absent from the frame table
- verbatim-locked copy drifting between frames

## Flow-level continuity review

After every frame passes its gate, re-read every accepted PNG in flow order and write `continuity-review.md`:

```markdown
# Continuity review — <flow>

## Verdict
- Status: accepted | continue | blocked
- Primary finding:

## Frame lineup
| Frame | Accepted version | Score |
|---|---|---|

## Findings
| Check | Pass / fail | Pixel evidence | Frame(s) | Action |
|---|---|---|---|---|
| Persistent regions stable within each lane | | | | |
| Every visible change explained by trigger + state delta | | | | |
| State progressions legal per flow invariants | | | | |
| Locked copy verbatim across frames | | | | |
| Lane content matches each authorised projection | | | | |
| No invented steps, actors, or data | | | | |

## Revisions ordered
- <frame → next version and targeted change, or none>
```

If a finding implicates an already-accepted frame, revise that frame with a new version, then re-inspect its chained neighbors and re-render only those now inconsistent. The storyboard is accepted only when every frame passes its per-frame gate and the continuity review passes with no hard failure.

## Contact sheet

Assemble the accepted frames, in flow order, into `contact-sheet.png` — a review aid, never authority:

```bash
montage \
  f01-*/vNNN.png f02-*/vNNN.png ... \
  -tile 3x -geometry +12+12 -background '#101014' \
  .pi/artifacts/ui-storyboards/<flow-slug>/contact-sheet.png
```

List accepted versions explicitly; never glob across versions. If ImageMagick is unavailable, install it or skip the sheet.

## Implementation and liveplay validation

- Fill the frame table's implementation surface column (route, component, state) before or during implementation.
- Implement with existing tokens and primitives per the main skill; frames carry no more authority than single mockups.
- Walk the same sequence in liveplay with the Playwright browser skill, screenshot each step, and compare against the matching frame for hierarchy and intent, not pixel identity; document deliberate differences.
- Verify each lane against its authorised projection in liveplay, including that the other lane's private information stays hidden.

## Completion report additions

- `flow.md` path and whether the final implementation matches its diagram
- frame lineup: frame → accepted version, score, render count
- continuity review verdict and any frames revised because of it
- contact sheet path
- liveplay walk evidence per frame
