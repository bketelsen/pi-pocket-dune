<!-- readme-kind: extension -->

# Arrakis

**Every agent at work, as a Dune desert.**

Arrakis is a Pi Pocket extension for the owner of a server: it draws every agent at work as the desert of Arrakis.
Sessions are sietches, tool calls are walks to the places of the desert, model providers are spice fields, and
messages fly by ornithopter.

![The demo desert: Odrade's order at work around the Arrakeen Citadel, with the Chronicle beside it](docs/desert.webp)

**Status:** pre-release. It needs Pi Pocket 0.19.0 or later (extension API 2), and no outside service or setting.

**Documentation:** [docs/README.md](docs/README.md)

## What it does

- **A desert of your agents.** Each session is a sietch, each subagent a stilltent, each linked session an allied
  sietch on a trail. See [what you see](docs/guide.md#what-you-see).
- **A walk for each tool call.** An agent walks to the place of its tool (the Archives, the Ixian Foundry, the Guild
  Heighliner Port) and back. See [the guide](docs/guide.md#open-it).
- **A work for each task.** A message to an agent raises a work beside its sietch, built from its tool calls. See
  [every task is a work](docs/guide.md#every-task-is-a-work).
- **People of the books.** A session titled with a name from the books (`Duncan Idaho: CI fixes`) brings that person,
  with their faction and title. See [the cast](docs/guide.md#the-cast).
- **Dossiers, replays and the night.** Tap anyone for a dossier; replay the day, or the last night from the 24-hour
  history. See [the guide](docs/guide.md#open-it).

## Install

Copy `dune.ts` and the folder `dune/` into the `extensions/` folder of Pi Pocket's data folder (by default
`~/.pi-pocket/extensions/`), then turn it on in Menu → Extensions:

```sh
cp dune.ts ~/.pi-pocket/extensions/
cp -R dune ~/.pi-pocket/extensions/
```

Do not copy `test/`, `dev/`, `docs/`, `scripts/`, `package.json`, or `_pocket.d.ts`. Then open **Arrakis** in the rail.

## Privacy

- It reads every tool call and model request in every session, cut short; no files, settings, sign-ins or session
  documents.
- It masks what looks like a secret before it keeps any text. Masking is a best effort.
- It shows what it reads only to the owner, and only for sessions that Pi Pocket confirms the owner may see.
- It keeps events in memory and in `<data folder>/dune/` (file mode 0600), with a 24-hour history for the Night replay.
- It sends nothing over the network, makes no model calls of its own, and changes nothing: each hook only records.
- The full contract: [what it reads, keeps, and sends](docs/specs/what-it-reads-keeps-and-sends.md).

## How it works

A server module (`dune.ts`) turns what its hooks see into small events and counts, keeps them, and sends them to the
owner's open tabs; a browser module (`dune/`) lays out the desert and draws it on a canvas. See
[the design overview](docs/design/overview.md).

## Remove

Turn it off in Menu → Extensions, delete `dune.ts` and `dune/` from the `extensions/` folder, and delete the `dune`
folder in Pi Pocket's data folder: it holds the saved events and the history.

## Credits

The server half is forked from [Agent Civilization](https://github.com/TannerMidd/pi-pocket-agent-civilization) by
Tanner Middleton (MIT). Dune and its characters belong to the estate of Frank Herbert; this is an unofficial fan work.

## Develop

With a Pi Pocket checkout beside this folder:

```sh
ln -s ../pi-pocket/node_modules node_modules
mise install     # the pinned Node
make ci          # what CI runs: the template gate, check, tests, format check
npm run preview  # then open http://127.0.0.1:8765/dev/preview.html: the page on its demo, with no server
```

The full setup, each check, and CI: [docs/develop.md](docs/develop.md).

## Where to go next

- [AGENTS.md](AGENTS.md): the rules for agents and contributors.
- [docs/README.md](docs/README.md): the user guide, the design, the specs and the decisions.
- [SECURITY.md](SECURITY.md): report a vulnerability privately.
- [LICENSE](LICENSE): MIT, with the Agent Civilization notice.
