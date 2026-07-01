This is a Nuxt 3 and three.js project.

## Production deployment boundaries

When fixing production issues, modify this repository and validate locally/prodlike. Do not directly edit, copy files into, rebuild, restart, or otherwise change the production app runtime as a code deployment mechanism. Production app-code deployment is handled by the user through the project's GitHub-based deployment path.

## Software Practices
When writing software, we explicitly always adhere to the following principles:
  - Single Responsibility Principle
  - Open/Closed Principle
  - Liskov Substitution Principle
  - Interface Segregation Principle
  - Dependency Inversion Principle
  - DRY principle
  - Law of Demeter

  Violations of these principles should be seen as codebase corruption. If you spot violations while doing work, ensure that you clean up corruption in order to keep a pure codebase.

## Liveplay
This is a lvieplay only app. Local hosting is deprecated. All features implemented should work for liveplay.

## Autonomous build loop rules

This repository can be driven by the local autonomous build loop in `scripts/build-loop.sh`.
When invoked by that loop, follow these additional rules.

### Required reading

Before making changes, read:

* `AGENTS.md`
* `PROJECT_BRIEF.md`
* `BUILD_TICKETS.md`

### Core workflow

1. Select the lowest-numbered `TODO` ticket from `BUILD_TICKETS.md`.
2. Say what you are working on now, including the selected ticket and immediate action.
3. Implement only that ticket.
4. Do not start future tickets.
5. Do not broaden scope.
6. Add or update tests/validation where appropriate.
7. Add or update docs where appropriate.
8. Run `scripts/quality-gate.sh`.
9. Update only the selected ticket status in `BUILD_TICKETS.md`.
10. Commit the completed ticket with a conventional commit message.
11. Leave the working tree clean.

Do not add cycle notes, validation summaries, blocker notes, or other commentary to `BUILD_TICKETS.md`; it should contain ticket descriptions plus status only. The outer build loop handles pushing and optional PR creation/merge when configured. Do not create or merge PRs from inside an agent run unless a ticket explicitly asks for it.

The final ticket may set the top-level `AUTOMATION_STATUS: DONE` after all issue tickets are complete and the final quality gate passes.

### If blocked

If you cannot complete the ticket safely:

* print the blocker in the agent response;
* leave the ticket status as not done;
* do not add blocker notes to `BUILD_TICKETS.md`;
* do not mark it `DONE`;
* do not commit broken partial work;
* leave the working tree clean if possible.

### Scope and safety

Do not:

* start future tickets;
* silently change project goals;
* rewrite unrelated code;
* add unnecessary dependencies;
* add speculative features;
* remove safety checks;
* bypass quality gates;
* commit generated/private files unless explicitly required.

Never commit real secrets, credentials, access tokens, private keys, real `.env` files, private campaign data, internal hostnames/URLs, generated cloud plans, Terraform state, or machine-specific configuration.

### Commit style

Use conventional commits such as `chore:`, `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `ci:`, or `build:`.
