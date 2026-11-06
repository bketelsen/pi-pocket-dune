# Arrakis: overview

Living document. Contracts: [specs/what-it-reads-keeps-and-sends.md](../specs/what-it-reads-keeps-and-sends.md).
User guide: [guide.md](../guide.md).

## Overview

Arrakis is a Pi Pocket drop-in in 2 parts: a server module that turns what its hooks see into small events, and a
browser module that draws them as a desert. The server half is forked from
[Agent Civilization](https://github.com/TannerMidd/pi-pocket-agent-civilization); the desert, its engine, the cast and
the demo are new.

## Design

- `dune.ts`: the server module. Hooks `beforeTool`, `afterTool`, `beforeRequest`, `afterResponse`, and `onYield`
  turn what they see into small events (`tool`, `done`, `think`, `reply`, `msg`, `link`, `idle`) and running counts.
  Routes: `GET world` (the sessions active in the last 12 hours), `GET history?from=&to=` (the compact history in a
  window, for the Night replay), `GET meta/:source` (a `conversationRoute`), and `POST reset`.
- `dune/index.js`: the page (Preact and htm from Pi Pocket): status bar, Chronicle, dossiers, glossary, and splash.
- `dune/world.js`: the engine. It lays the desert out, paints the dunes once from a height field, walks the agents,
  flies the ornithopters, raises the works, and draws day, night, worms, and storms on a canvas.
- `dune/model.js`: what the events mean, with no drawing: tasks and their works, and the Chronicle.
- `dune/cast.js` and `dune/places.js`: who is who, and what each place is called.
- `dune/demo.js`: Odrade's order at work, in the server's event format.
- `dune/sound.js`: a drone, the wind, and effects, made with Web Audio; no sound files. Off until you turn it on.

## Operational notes

- The module keeps its files in `<data folder>/dune/` (`world.json`, `history.json`); after an uninstall, delete that
  folder too.
- It reads shapes that are internal to Pi Pocket and the team extension; if one changes, the desert fails soft
  ([spec, "What can change under it"](../specs/what-it-reads-keeps-and-sends.md#what-can-change-under-it)).
- `npm run preview` serves `dev/preview.html` on `127.0.0.1:8765`: the page on its demo, with no server.

## References

- Contracts: [specs/what-it-reads-keeps-and-sends.md](../specs/what-it-reads-keeps-and-sends.md)
- Rationale: none recorded yet; repository ADRs are in [adr/](../adr/)
