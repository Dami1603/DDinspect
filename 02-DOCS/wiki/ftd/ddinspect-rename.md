---
author: Damian Dandrade
branch: main
status: in-progress
---
# Rename DDissect → DDinspect

## Intent

The extension is called **DDinspect** from now on. Requested by the owner on 2026-11-01. "Inspect" says what
the tool does more plainly than "dissect".

## Scope

In:
- Every `DDissect` → `DDinspect` and `ddissect` → `ddinspect` in `extension/`, `tools/`, `store/`, `README.md`,
  `CHANGELOG.md`, `PRIVACY.md`: visible name, manifest (incl. Firefox id `ddinspect@ddinspect.local` and the
  `toggle-ddinspect` command), storage keys, message types, globals, CSS classes.
- File `extension/shared/ddissect-shared.js` → `ddinspect-shared.js`.
- Regenerate `store/promo-440x280.png` (the name is drawn in it).

Not in:
- Migrating `ddissect:*` storage keys: 2.0 was never published, so no user has them. The WebDAM 1.x migration
  (`webdam:saved`, `webdam:theme`) stays.
- The PNG icons (no text in them), the workspace folder `DDTool`, the history doc `ddissect-2-0.md`.

## Checklist

- [x] Rename in all files → `grep -ri dissect` over those paths returns nothing.
- [x] Rename the shared file and its references → manifest, background, pages and tests load `ddinspect-shared.js`.
- [x] Unit checks → `node tools/test-shared.js` passes.
- [x] i18n check → `node tools/check-i18n.js` passes.
- [x] JS syntax → `node --check` on every extension script passes.
- [x] Promo tile regenerated → PNG shows "DDinspect".
- [ ] Load in the real browser (manual, owner).

## Evidence

2026-11-01:
- 30 files rewritten; `grep -rniI dissect extension tools store README.md CHANGELOG.md PRIVACY.md` → no output.
- `ddinspect-shared.js` referenced by manifest.json:56, background.js:19, options/sidepanel/welcome HTML and
  test-shared.js:12; the file exists, the old one does not.
- `node tools/test-shared.js` → `17 checks passed`.
- `node tools/check-i18n.js` → en / es: 258 messages, missing 0, unused 0, empty 0.
- `node --check` on every `.js` in `extension/` and `tools/` → no failures; manifest and both locale JSON parse.
- `tools/generate-icons.ps1` → icons and `store/promo-440x280.png` rendered; the tile reads "DDinspect".
- Not run: loading the extension in Chrome / Firefox.

## Next

Owner: reload `extension/` in Chrome (chrome://extensions → reload). The keyboard shortcut must be set again,
because the command is now `toggle-ddinspect`. Elements saved while testing as DDissect stay under the old key
and won't show; export them as JSON before reloading and import them afterwards if you want them.
