# Shop post-checkout actions

P8-066 turns an accepted shop delivery into useful next steps without creating a second item, equipment, or transfer runtime. The accepted checkout remains the authority for which rows were delivered; current action projections decide what is legal now.

## Exact continuation authority

A fresh accepted checkout records one opaque continuation for every exact delivered inventory row. Stackable purchases that merge into an existing row retain that stable row as their source. Whole-item purchases such as equipment create one continuation for each distinct delivered row.

A continuation is bound to the checkout operation, delivery container, accepted target revision, section, stable row, and receipt position. The public receipt exposes only:

- the purchased item and quantity;
- a safe container label;
- a section label;
- a presentation row label;
- an opaque protocol identity that the UI never displays.

The server does not search an inventory by item name after checkout. `POST /api/shops/post-checkout-actions` first loads the stored terminal checkout result, verifies that each requested continuation belongs to that receipt, recovers the exact accepted row privately, and then reauthorizes its current custody through existing inventory projections. Accepted checkouts created before this schema remain valid purchases, but fail closed for post-checkout actions because they have no exact continuation evidence. An otherwise valid checkout that creates more than 64 exact whole-item rows also remains accepted without a continuation receipt rather than failing commerce to exceed the bounded public projection.

Exact command replay returns the stored receipt and never delivers or charges twice.

## Current action projection

The endpoint projects only handoffs that existing authority currently supports:

- **Inspect** opens the canonical item reference.
- **Use now** opens the existing Trainer item decision or delegated shared-inventory item decision when legal.
- **Equip now** opens the existing equipment decision.
- **Give now** opens the existing Pokémon equipment-custody decision.
- **Move to group** opens the existing Trainer-to-group transfer decision.
- **Transfer to Trainer** opens the existing group-to-Trainer transfer decision.

Navigation does not commit a mutation. The destination workspace rechecks its current opaque offer, source row, revisions, reservations, target eligibility, equipment compatibility, Profile delegation, and bounded choices. The user must explicitly confirm there.

If the exact row moved, was consumed, became reserved, lost a legal target, or no longer has a supported canonical offer, the receipt remains visible and the corresponding action is disabled with a textual reason. The client never substitutes another copy with the same name.

## Privacy and authorization

A GM receives actions allowed by current campaign authority. A player must re-submit the selected Profile context; Trainer custody and delegated group use are reauthorized through the existing Profile policies. The projection and UI do not display stable row IDs, inventory-instance IDs, checkout operation IDs, Profile IDs, hashes, serialized equipment identity, private delegation evidence, shop audit fields, or provenance.

App-relative handoffs carry only bounded opaque offer identities. Query parsing rejects arrays, unsupported action names, malformed source identities, and malformed group actor identities.

## Interaction and recovery

The selected target is `.pi/artifacts/ui-mockups/shop-post-checkout-actions/v002.png` (9.7/10). The checkout panel presents:

1. the accepted checkout fact;
2. exact purchased-source continuity;
3. current action handoffs and adjacent unavailable reasons;
4. **Done shopping** and **Retry action options**.

The accepted receipt stays on screen while current authority loads or fails. Retrying only reloads action offers; it never retries checkout or starts an inventory mutation. Dismissal is local presentation state. Controls are at least 44px high, availability is not communicated by colour alone, keyboard focus is visible, and two desktop item columns reflow to one ordered mobile column without page-level horizontal overflow.

## Acceptance evidence

The versioned contract is `data/complete-play-loop/shop-post-checkout-actions.v1.json`. Focused evidence covers strict receipt and projection parsing, exact merged and whole-item delivery tracing, terminal replay, Trainer and group authorization, stale and foreign continuations, route privacy, client loading and dismissal, component accessibility anatomy, deep-link parsing, and desktop/mobile liveplay handoffs in `tests/e2e/shop-post-checkout-actions.spec.ts`.
