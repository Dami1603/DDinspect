---
author: Damian Dandrade
branch: main
status: in-progress
---
# Point the project at its GitHub repo

## Intent

The code now lives in a public repo: <https://github.com/Dami1603/DDinspect>. Docs, manifest and store material
still assume a local `DDTool` folder and have placeholders where a public URL belongs.

## Scope

In:
- `manifest.json`: `homepage_url` → the repo (Chrome shows it as "Website", Firefox as "Homepage").
- `README.md`: a "Get the code" step (clone or ZIP), `DDTool` → `DDinspect` folder, link to Issues.
- `PRIVACY.md`: `CONTACT_EMAIL` placeholder → the repo's Issues page (no personal email published).
- `store/listing.md`: privacy policy URL and homepage / support URL.

Not in (owner decides):
- ~~A LICENSE file~~ → added on request: MIT, © 2026 Damian Dandrade.
- Whether rsc harness files (`.claude/`, `.rsc.json`, `01-TOOLS/`, `02-DOCS/`) stay in the public repo.
- Committing / pushing.

## Checklist

- [x] `homepage_url` in manifest → manifest parses; field present.
- [x] README → no `DDTool`; clone URL and Issues link present.
- [x] PRIVACY → no `CONTACT_EMAIL`; Issues link present.
- [x] listing → privacy URL is the GitHub `PRIVACY.md` link.
- [x] Unit + i18n checks still pass.
- [x] LICENSE (MIT) at the root, linked from README → file present, README "License" section and tree entry.

## Evidence

2026-11-01:
- `grep DDTool|CONTACT_EMAIL` over README, PRIVACY, listing, manifest → no output.
- manifest parses, `homepage_url` = `https://github.com/Dami1603/DDinspect`.
- `node tools/test-shared.js` → 17 checks passed; `node tools/check-i18n.js` → 258 keys, nothing missing.
- GitHub API: repo public, `has_issues: true`; `.../blob/main/PRIVACY.md` → HTTP 200 (current pushed version
  still has the placeholder until these edits are pushed).
- `LICENSE` written (standard MIT text); README ends with `## License` → `[MIT](LICENSE)`, tree lists `LICENSE`.

## Next

Owner: commit and push (GitHub then shows "MIT license" on the repo), and decide on keeping the rsc harness files in the public repo.
