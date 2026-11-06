# Security policy

Arrakis runs inside a Pi Pocket server. Its hooks read the tool calls and model requests of every session, it masks what looks like a secret before it keeps text, it keeps files in `<data folder>/dune/` with mode 0600, and its routes and page are owner-only.

A bug in the masking, in an owner check, or in the check of which sessions the owner may see is a security bug.

## Supported versions

Only the `main` branch gets fixes. This repository has no releases and no tags.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open https://github.com/bketelsen/pi-pocket-dune/security and press **Report a vulnerability**. Do not open a public issue with the details. Do not post tokens, session text, or the content of `world.json` or `history.json`.

## What to include

The commit, the file, the impact, and the steps to reproduce.
