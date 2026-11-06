# Documentation

Docs are split by the question they answer:

| Directory          | Question                             | Contents                                                                                                                                |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [adr/](adr/)       | **Why** did we choose this?          | Architecture Decision Records: immutable once accepted; superseded, never edited. Org-wide decisions are in [org-adrs.md](org-adrs.md) |
| [design/](design/) | **How** does it fit together?        | Living documents that describe the current architecture                                                                                 |
| [specs/](specs/)   | **What exactly** is the contract?    | Precise, testable interface definitions                                                                                                 |
| [plans/](plans/)   | **When, in what order** do we build? | Plans and phases; updated as work lands                                                                                                 |

The user documentation is [README.md](../README.md): what Arrakis shows, how to install and use it, what it reads,
keeps and sends, and how it is built. The pictures in this folder (`*.webp`) belong to it.

## Index

### Decisions (ADRs)

- [0001 — Record architecture decisions](adr/0001-record-architecture-decisions.md)
- [0002 — Agent-portable instruction surface](adr/0002-agent-portable-instruction-surface.md)
- [0003 — Verify gate, risk paths and corrections](adr/0003-verify-gate-risk-paths-and-corrections.md)
- [Org-wide decisions (frostyard/core ADRs)](org-adrs.md)

### Design

_(none yet: README.md, "How it is built")_

### Specs

_(none yet: README.md, "What it reads, keeps, and sends")_

### Plans

_(none yet)_

## Conventions

- **New docs start from their category's `TEMPLATE.md`** (in each directory).
- New decision → new ADR with the next number; if it reverses an old one, mark the old one `Superseded by NNNN` rather
  than editing it.
- Design docs are updated in place to always reflect reality.
- Specs change only alongside the code that implements them.
- Cross-links between categories are mandatory in both directions: see the documentation rules in
  [AGENTS.md](../AGENTS.md) (`CLAUDE.md`, `GEMINI.md`, `.cursorrules` and `.github/copilot-instructions.md` are symlinks to
  it, ADR-0002).
- Adding a doc means adding it to the index above.
