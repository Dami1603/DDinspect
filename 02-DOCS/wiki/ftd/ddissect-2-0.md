---
author: Damian Dandrade
branch: main
status: in-progress
---
# DDissect 2.0 — rename, new identity, polish and five features

## Intent

WebDAM becomes **DDissect**. "WebDAM" is a registered product (Bynder) and says nothing about the tool.
At the same time: a logo that reads at 16 px, a cleaner and accessible panel, Spanish + English,
welcome and options pages, store material, and the five features proposed in the review.

## Scope

In:
- Rename everywhere (UI, manifest, docs, internal ids, overlay host element). Saved elements and theme
  migrate from the old `webdam:*` keys.
- Logo: selection corners + box model layers. SVG masters (large + small), PNGs rendered from them.
- UI: SVG icons instead of text glyphs, one picker switch instead of badge + button, tabs with
  `tablist` ARIA + arrow keys, visible focus, tabular numbers.
- Welcome page on install; options page (color format, default scope, theme).
- i18n with `_locales/en` and `_locales/es`.
- Store: privacy policy, listing text (en/es), 440×280 promo tile.
- Features: cross-origin CSS (fetched by the background), overridden declarations struck through,
  export element as component (HTML+CSS / JSX / Tailwind), WCAG contrast, import JSON into Saved.

Not in:
- Store screenshots (need the real side panel running; documented how to take them).
- Fixing "picker stays ON in the previous tab", Lottie, shadow DOM / iframe scanning.
- Publishing, git commits or pushing.

## Checklist

- [x] Rename → `grep -ri webdam extension/` only hits the documented migration keys.
- [x] Logo → SVG masters + PNGs 16/32/48/128 rendered; viewed at each size.
- [x] UI polish → panel opens with new header, icons, tabs ARIA; checked in a browser.
- [x] Welcome + options pages → open from install / options and save settings.
- [x] i18n → no hard-coded UI strings; `en` and `es` messages have identical keys (script check).
- [x] Store material → `PRIVACY.md`, `store/listing.md`, `store/promo-440x280.png`.
- [x] Cross-origin CSS → rules from a CDN stylesheet show up in Inspect (browser check).
- [x] Overridden declarations → unit check of the cascade function + visual check.
- [x] Export component → output renders standalone (browser check).
- [x] WCAG contrast → unit check of the ratio function against known pairs.
- [x] Import JSON → round-trip export → import, invalid file rejected.
- [x] `node --check` on every script, `web-ext lint --source-dir extension` clean apart from the known Chrome-only warnings.
- [x] README + CHANGELOG (2.0.0) updated.
- [ ] Manual check in real Chrome side panel and real Firefox sidebar (not run: needs the person's browser).
- [ ] Store screenshots 1280×800 (manual, guide in `store/listing.md`).
- [x] Replace `CONTACT_EMAIL` in `PRIVACY.md` before publishing → GitHub Issues link (see `github-repo-links.md`).

## Evidence

- Rename: `grep -rni webdam extension/` → 3 hits, all legacy-key migration (`webdam:saved`, `webdam:theme`) and one comment.
- Logo: `tools/generate-icons.ps1` rendered icon16/32/48/128 from the SVG masters with headless Edge; each PNG viewed.
- Unit: `node tools/test-shared.js` → 17 checks passed (OKLCH red = `oklch(62.8% 0.258 29.2)`, #767676/white 4.54 AA,
  #777777/white 4.48 fail, layers, `!important`, shorthands, border vs radius, pseudo-elements, import round trip,
  remote thumbnail dropped, `/* overridden */` in Copy CSS).
- i18n: `node tools/check-i18n.js` → en 258 / es 258, missing 0, unused 0, empty 0. Spanish description 130 chars.
- Lint: `npx web-ext lint --source-dir extension` → 0 errors, 0 notices, 4 warnings (sidePanel / service_worker, known).
- Browser smoke (headless Edge, unpacked extension, local page with Bootstrap from jsDelivr): 24/24 in `es` and in
  `en-US`. Highlights: welcome tab opened on install; 14 Bootstrap rules shown as fetched, 0 blocked; button contrast
  #fff on #0d6efd 4.5 AA; layered `color: red` / `padding: 20px` struck through, `#hero .card-x padding-top` and
  `.card-x padding` kept; picker cursor no longer listed; export 8 elements / 9 rules, no page classes, `::after`
  kept, `border-radius: 12px` folded, no logical radius / caret-color; standalone export page renders like the
  original; contrast list `Low contrast text here 2.32 fail`; options → OKLCH reaches the open panel; import 1, re-import
  skips 1, invalid file rejected; ArrowRight moves tabs with ARIA state. Screenshots reviewed: inspector, rules,
  export, colors, saved, dark theme, options, welcome, hover card (Spanish, red contrast row).
- Fixed during checks: button contrast empty (text inside `<span>`) → first text descendant; "1 children" plural;
  Spanish tab labels truncated; picker cursor sheet in rules and export; logical radius and currentColor repeats in export.

## Next

Load `extension/` in the real Chrome side panel and Firefox sidebar and try it on a few real sites; then take the
store screenshots.
