# Arrakis: a Dune desert of agents for Pi Pocket

A Pi Pocket drop-in: every agent at work, shown as Arrakis. `README.md` says what it is and how to install it; the docs start at
[docs/README.md](docs/README.md): the user guide, the design, and the spec of what it reads, keeps and sends.

This file (`AGENTS.md`) is the canonical agent instruction file. `CLAUDE.md`, `GEMINI.md`, `.cursorrules` and
`.github/copilot-instructions.md` are relative symlinks to it, and `.claude/skills` is a symlink to `.agents/skills/`
([ADR-0002](docs/adr/0002-agent-portable-instruction-surface.md)). Edit only the canonical paths.

## Skills

Repeatable procedures live in [.agents/skills/](.agents/skills/) (start from `.agents/skills/TEMPLATE/SKILL.md`).
There are none yet.

## Code conventions

- **It records and shows only.** The module reads through its hooks (`beforeTool`, `afterTool`, `beforeRequest`,
  `afterResponse`, `onYield`) and its `meta` route (the spec lists what that route reads). Each hook only records,
  catches its own errors, returns `undefined`, and never waits. It makes no network call, no model call, and no
  change to a session. It sends only to the owner's open tabs (`web.send`). Keep it so: a change that would read more,
  keep more, or send anything is a decision for Brian first.
- **Privacy.** Text is masked (keys, tokens, `NAME=value` secrets, private keys) before it is kept. The routes and the
  page are owner-only, and a session shows only when Pi Pocket confirms that the owner may see it (its
  `conversationRoute`). The files in `<data folder>/dune/` are written with mode 0600. `test/dune.test.ts` covers the
  masking, the hidden unconfirmed session, and the file mode: keep it so when you touch them. The owner-only access
  is Pi Pocket's default for a route and a browser module with no `access` option (Pi Pocket's
  `docs/extensions/routes.md`), and `dune.ts` gives none; the test's mock does not enforce it, so never add an
  `access` option to a route or to `web.client` without a decision first.
- **The spec is the contract.** [docs/specs/what-it-reads-keeps-and-sends.md](docs/specs/what-it-reads-keeps-and-sends.md)
  states what the module reads, keeps and sends, and the README's `Privacy` section sums it up. A change to any of
  those changes both in the same PR.
- **Files.** `dune.ts` is the server module; `dune/` is the browser module (`index.js`, `world.js`, `model.js`,
  `cast.js`, `places.js`, `demo.js`, `sound.js`, `style.css`). `dev/` is the preview with no server; `docs/*.webp`
  are the pictures of the README and the user guide. `_pocket.d.ts` is a copy of `types/pocket.d.ts` from the Pi
  Pocket release that CI clones, for types only: update it by a copy, never by hand, when CI moves to a new release.
- **Develop.** The checks use Pi Pocket's packages: `ln -s ../pi-pocket/node_modules node_modules` with a Pi Pocket
  checkout beside this folder. `npm run preview` serves `dev/preview.html` on `127.0.0.1:8765`.
- **Gate.** Run `make verify` before you call a change done. It runs the template gate (`node scripts/check-template.mjs`
  and `node --test test/*.test.mjs`), then `npm run check` (TypeScript, and `node --check` of `dune/*.js`), `npm test`
  and `npm run format:check`. CI job `Check` runs `make ci`, which also checks that `.memory/corrections.jsonl` is
  append-only against the PR base; run `make ci BASE=origin/main` for the same check locally. `mise.toml` and
  `mise.lock` pin Node.

**Test reliability.** No sleeps for timing (wait on a condition or inject a clock). No network and no wall clock in
unit tests (inject them). A flaky test gets an issue, then a fix or a quarantine (skip with the issue link) in the
same PR. Never retry a job or a test until it is green.

**Blocker to guard.** When a review (agent cross-review, owner review, or a human) finds a blocking point, the PR that
fixes it also adds a guard: a targeted test that fails without the fix (preferred), or an `AGENTS.md` rule when no test
can catch it. The same PR appends 1 line to `.memory/corrections.jsonl` (`evidence`: the PR and the review;
`promoted_to`: the test or the rule). See `.memory/README.md`.

**Risk paths.** `.github/risk-paths.json` lists the high-risk paths. The list is version 2: each glob has a level,
`L1` to `L4`, and the default level is `L3` ([frostyard/core ADR-0078](https://github.com/frostyard/core/blob/main/docs/adr/0078-sort-pull-requests-by-levels-l1-to-l4.md)).
The caller `.github/workflows/risk-paths.yml` runs core's `pr-triage.yml`, which adds 1 label `level:L1` to `level:L4`
(when those labels exist) and `risk:high` at `L1` and `L2`. It also removes `ready-for-human` when the head moves after
the label, or when CI was not green when the label came
([ADR-0077](https://github.com/frostyard/core/blob/main/docs/adr/0077-bind-ready-for-human-to-the-head-commit.md), ADR-0078).
A PR with `risk:high` declares tier 3. Add a path when you add a file of that kind (signing, auth, publication,
secrets, destructive operations, CI), with the strictest level it deserves.

**Vendored files.** `scripts/lib/risk-paths.mjs` and `scripts/check-corrections.mjs` are copies from frostyard/core;
never edit them by hand (`make verify` checks their hashes). `scripts/check-template.mjs` and
`test/check-template.test.mjs` are copies from bketelsen/agentic-template.

**Labels.** Issues are in GitHub Issues. The labels the team uses: `ready-for-human`, `risk:high`, `level:L1` to
`level:L4` and `sweep`.

## Releases and installs

- Tag format: none. This repository has no tags and no GitHub releases.
- An install is a copy: `dune.ts` and `dune/` go into `~/.pi-pocket/extensions/` (README "Install"); `test/`, `dev/`,
  `docs/`, `package.json` and `_pocket.d.ts` do not. Brian installs it and turns it on in Menu → Extensions; agents
  never install, enable or restart.
- Internal dependency: Pi Pocket (bketelsen/pi-pocket, upstream TannerMidd/pi-pocket). CI clones the fork at tag
  `v0.28.1-bk.1`, the server's release, and checks the tag's commit (`.github/workflows/ci.yml`): move the tag, the
  commit and `_pocket.d.ts` together when the server moves to a new Pi Pocket release. README names the
  oldest Pi Pocket that works (0.19.0, extension API 2).
- Dune and its characters belong to the estate of Frank Herbert; this is an unofficial fan work. The server module is
  adapted from Agent Civilization (MIT); keep its notice in `LICENSE` and the README.

## Documentation rules

Docs live in `docs/` in 4 categories ([docs/README.md](docs/README.md), frostyard/core ADR-0025). Every new doc starts
from its category's `TEMPLATE.md`:

- `docs/adr/`: why we decided. Immutable once Accepted; a reversal is a new ADR that marks the old one Superseded. A
  decision that binds only this repository gets an ADR here; an org-wide one goes to frostyard/core and a line in
  [docs/org-adrs.md](docs/org-adrs.md).
- `docs/design/`: how it fits together. Living; updated in place to match the code.
- `docs/specs/`: exact contracts. Change only with the code that implements them.
- `docs/plans/`: order of work, with "Done when" outcomes.

- A new doc gets a line in the index in [docs/README.md](docs/README.md); `make verify` fails on a doc under `docs/`
  that the index does not link. The pictures in `docs/*.webp` belong to `README.md` and `docs/guide.md`.
- Cross-links go both ways: an ADR links the design docs and specs it shapes; a design doc links its ADRs and specs; a
  spec links its ADRs and design doc; a plan links what it builds. Use relative paths.
- Write absolute dates, not relative ones.
- When text moves out of `README.md` (core's README spec), every fact keeps a home, and the PR lists where each old
  part went. A guarantee keeps its exact scope when it moves: "both saved files keep no words" is not "the module
  keeps no words". Check each moved guarantee against `dune.ts`.
