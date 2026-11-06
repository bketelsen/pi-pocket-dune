# Spec: What Arrakis reads, keeps, and sends

This contract states what the Arrakis server module (`dune.ts`) reads through its hooks, what it keeps in memory and
on disk, and what it sends, and to whom. Owners, agents and reviewers hold the code to it: a change to what the module
reads, keeps or sends changes this spec in the same pull request (`AGENTS.md`). `test/dune.test.ts` covers the
masking, the hidden unconfirmed session, the history limits and the file mode.

## Interface

The same as Agent Civilization, whose server half this is:

- **Reads**, through its hooks, every tool call and model request in **every** session: the tool's name and its
  arguments, the model, token counts and cost, the start of each message and answer, the end of the model's
  reasoning, and the text of failed tool calls and model errors, all cut short. It reads no files, settings, sign-ins,
  or environment variables, and no session documents.
- **Masks** what looks like a secret before it keeps any text: API keys and tokens, `NAME=value` settings whose name
  says key, token, secret, or password, and private keys. Masking is a best effort.
- **Shows** what it reads only to the owner (its routes and page are owner-only), and only for sessions that Pi Pocket
  confirms the owner may see (through its `conversationRoute`), or subagents that such a session's own tool call
  started.
- **Keeps** the last 3000 events and some counts in memory, and saves the last 1500 every few seconds to
  `<data folder>/dune/world.json` (file mode 0600). It also keeps a compact history of the last 24 hours, for the
  Night replay: only the tool calls and their results, messages, links, and the ends of turns, with labels cut to 60
  characters and messages to 80, no error text, no thoughts, and no answers. It keeps at most 40,000 such events, and
  saves them once a minute to `<data folder>/dune/history.json` (file mode 0600, 4 MB at most: the oldest go first).
  For a session not yet confirmed, both files keep no words, paths, titles, or names. **Glossary → Forget all
  history** clears it all. After you uninstall it, delete the `dune` folder in the data folder too.
- **Sends** nothing over the network: only the town, to the owner's open Pi Pocket tabs (`web.send`). In the browser
  it keeps a few view choices in `localStorage`, under `x.dune.*`.
- **Changes** nothing: each hook only records, catches its own errors, returns `undefined`, and never waits.

## Rules

- Each hook only records, catches its own errors, returns `undefined`, and never waits.
- The module makes no network call and no model call, and changes no session.
- Text is masked before it is kept, in memory and on disk.
- A session that Pi Pocket has not confirmed is not shown. Its masked events stay in memory, and both saved files
  (`world.json`, `history.json`) keep no words, paths, titles or names for it.
- The routes and the page are owner-only: Pi Pocket's default for a route and a browser module with no `access`
  option, which `dune.ts` does not give.

## What can change under it


It reads some shapes that are internal to Pi Pocket or to other extensions, and that can change in any release: the
arguments and results of the built-in tools, the markers Pi Pocket puts on messages (`[from: …]`, `[subagent …]`,
`[scheduled]`, `[via PR watch]`, the linked-session wrapper), and the team extension's tools (`team_delegate`,
`team_message`, its "Task from the source session:" preamble) and markers (`[night-shift]`, `[desk]`). If one
changes, the desert fails soft: it loses a link, a label, or a work, never a call.

## References

- Context: [design/overview.md](../design/overview.md), the user guide [guide.md](../guide.md)
- Rules for agents: [AGENTS.md](../../AGENTS.md), "It records and shows only"
