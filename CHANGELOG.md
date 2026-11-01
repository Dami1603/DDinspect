# Changelog

All notable changes to DDinspect (called WebDAM up to 1.6.0) are documented here.

## [2.0.0] - 2026-11-01

WebDAM is now **DDinspect**: new name, new logo, a cleaner panel in English and Spanish, and five new features.

### Added

- **Cross-origin stylesheets**: CSS from other domains that the page can't read (CORS) is fetched by the background
  script (`ddinspect:fetch-css`: http(s), no cookies, CSS only, 5 MB cap), parsed into a constructed sheet and shown in
  *Applied CSS rules* with a **fetched** badge. Cross-origin `@import`s too.
- **Overridden declarations** struck through in *Applied CSS rules* (`DDinspectShared.overriddenFlags`: `style=""`,
  `!important`, cascade layers, specificity, order and shorthands). *Copy CSS* marks them with `/* overridden */`.
- **Export as component** (`content/export.js`, `sidepanel/export-format.js`): standalone HTML + CSS, React (JSX + CSS,
  downloaded as a ZIP) or Tailwind (arbitrary properties), built from computed styles diffed against browser defaults,
  with `@font-face` rules for the fonts used and a sandboxed live preview.
- **WCAG contrast**: ratio and AA / AAA result in the hover card and as a pill in Inspect; *Colors* lists every text /
  background pair of the scope, worst first, with hover highlight and locate.
- **Import JSON** in *Saved* (DDinspect and WebDAM exports). Items are rebuilt field by field; duplicates are skipped,
  broken entries rejected and only embedded `data:image` thumbnails kept.
- **Spanish and English** UI via `_locales/` (also the context menu, shortcut and manifest).
- **Options page**: color format (HEX / RGB / HSL / OKLCH) for the panel and hover card, default scan scope, theme
  (light / dark / system) and the current shortcut.
- **Welcome page** opened on first install.
- Store material: `PRIVACY.md`, `store/listing.md` (en / es texts, permission justifications, screenshot guide) and
  the 440×280 promo tile.
- `tools/test-shared.js` (unit checks) and `tools/check-i18n.js` (message keys in every locale).

### Changed

- **Renamed to DDinspect** everywhere: UI, manifest, docs, message types (`ddinspect:*`), globals (`DDinspectShared`,
  `DDinspectScan`, `DDinspectZip`, `DDinspectTheme`), the overlay host (`<ddinspect-root>`), storage keys
  (`ddinspect:saved`, `ddinspect:theme`; the old `webdam:*` values move automatically) and the Firefox add-on id
  (`ddinspect@ddinspect.local`).
- **Shortcut** is now <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>.
- **Logo**: selection corners around box model layers instead of the "WD" letters, with a simplified flat version for
  16 and 32 px. SVG masters (`extension/icons/logo.svg`, `logo-small.svg`); `tools/generate-icons.ps1` renders them
  with headless Edge / Chrome.
- **Header**: one **Picker** switch (`role="switch"`) replaces the ON/OFF badge plus button; options, theme and close
  are SVG icon buttons.
- SVG line icons replace the text glyphs (⧉ ⤓ ↗ ◎ ↻ ☆) on every button.
- **Accessibility**: tabs follow the ARIA tabs pattern (`tablist`, `aria-selected`, roving tabindex, arrow keys,
  Home / End), visible focus ring, labels on icon-only buttons, `aria-pressed` on segmented controls, live regions for
  the status line and toasts; children and breadcrumbs open with <kbd>Enter</kbd>.
- Numbers use tabular figures.
- The extension moved to `extension/` so the project root can hold tooling and docs that must not ship in the
  package. Load, lint and sign `extension/` (`npx web-ext lint --source-dir extension`).

### Fixed

- The picker's own crosshair cursor sheet showed up as a page rule (`*, ::before, ::after { cursor: crosshair }`).

## [1.6.0] - 2026-10-30

Parent-first picking and "Selected element" as the first scope.

### Changed

- **Parent first** (`content/content.js`): hovering and clicking grab the parent of the element under the pointer
  (never `body` / `html`), so you get the component instead of its inner `<span>` or `<path>`. *Inspect this element*
  from the context menu uses the same rule.
- <kbd>↓</kbd> now walks back toward the exact element under the pointer before going into first children;
  <kbd>↑</kbd> keeps going up. A click keeps the level chosen with ↑ / ↓.
- The hover card shows a hint line (`↓ inner element · ↑ parent · click to select`).
- **Selected element first** in the asset tabs: the scope switch reads *Selected element / Whole page* and every tab
  (Images, SVGs, Colors, Fonts) starts on the selected element, falling back to the page while nothing is selected.
- Inspect empty state explains the parent-first behavior and the new ↑ / ↓ meaning.

## [1.5.0] - 2026-10-30

Hover card and page assets (images, SVGs, colors, fonts) with counters, modeled on asset-extractor tools such as
AssetPullKit.

### Added

- **Hover card** in picker mode (`content/content.js`, `content/overlay.css`): tag, size, position (page x, y and
  `position`), color, background, font family, font size, weight, line height, padding and margin (as CSS shorthands).
- **Asset scanner** `content/scan.js` (new content script, also injected on demand):
  - Images from `<img>` (current source and fallback), `srcset`, `<picture>`, `poster`, `<input type=image>`, SVG
    `<image>`, CSS `background-image` / `mask-image` / `list-style-image` / `border-image-source`, `::before` /
    `::after`, and on page scope favicons and `og:image` / `twitter:image`. Deduplicated by URL with use counts.
  - Inline SVGs with cleaned, self-contained markup (inlined paint and `currentColor`, resolved `<use>`, no scripts or
    event handlers), sprite-sheet symbols, deduplication with counts.
  - Colors by role (text, background, border, svg, shadow, gradient), normalized to HEX, only from rendered elements.
  - Fonts grouped by family and style, plus `@font-face` sources from readable stylesheets.
  - Scope: whole document or selected element subtree. New messages `webdam:scan-assets`, and `webdam:highlight` /
    `webdam:select-related` accept `kind: 'image' | 'svg'` with a `scope`.
- **Side panel tabs with icons and counter badges**: Inspect, Images, SVGs, Colors, Fonts, Saved.
- `sidepanel/assets.js`: the four asset tabs, with
  - *Whole page / Selected element* scope per tab (Colors defaults to the selected element) and a rescan button;
  - Images: type chips with counts, URL / alt filter, previews with natural size, copy URL, download, open, locate,
    ZIP of the listed images, copy all URLs;
  - SVGs: safe previews (`<img>` + data URI), light / dark preview background, copy markup, download `.svg`, ZIP;
  - Colors: role chips, proportional palette strip, HEX / `rgb()` cards, copy CSS variables, copy HEX list;
  - Fonts: samples in the real font (font files fetched and registered with `FontFace`), `@font-face` file downloads,
    copy CSS per style.
- `sidepanel/zip.js`: dependency-free ZIP writer (stored entries, UTF-8 names, CRC-32).
- Hovering an image or SVG card highlights its element on the page; ◎ selects it and opens Inspect.

### Changed

- Selecting an element while on an asset tab keeps that tab and rescans the selection (Inspect still opens from the
  other tabs and after ◎).
- Tab bar redesigned: six icon tabs with labels and counter bubbles (the Saved count moved into its bubble).
- `manifest.json` and the on-demand injection in `background.js` load `content/scan.js` before `content/content.js`.
- Dark mode: color swatches and the palette strip get a light border so dark colors stay visible.

## [1.4.0] - 2026-10-30

Firefox support from the same folder.

### Added

- **Firefox support** (128+), where the panel opens in the sidebar:
  - `sidebar_action` in the manifest, pointing to the same `sidepanel/sidepanel.html`.
  - `background.scripts` next to `background.service_worker` (Firefox doesn't run extension service workers).
  - `browser_specific_settings.gecko` with the add-on id `webdam@webdam.local`, `strict_min_version` 128.0 and
    `data_collection_permissions: none` (WebDAM sends no data anywhere).
  - `background.js`: falls back to `sidebarAction` when `chrome.sidePanel` doesn't exist (`toggle()` on icon click,
    `open()` from the context menu and shortcut).
- README: Firefox install steps (temporary, signed unlisted `.xpi`, Developer Edition / Nightly) and `web-ext lint`.

### Changed

- `minimum_chrome_version` 116 → 121 (first Chrome that accepts `background.scripts` next to `service_worker`).
- Side panel ✕ uses `sidebarAction.close()` in Firefox.
- *Delete all* asks for a second click instead of `confirm()` (Firefox sidebars don't reliably show dialogs).
- Content script detects CSS rule types with `Object.prototype.toString` instead of `constructor.name`
  (reliable through Firefox's Xray wrappers).
- The overlay stylesheet falls back to a `<link>` to `content/overlay.css` if constructable stylesheets are refused.
- Restricted-page notice no longer mentions only Chrome.

## [1.3.0] - 2026-10-30

Original colors back, with a light theme by default and an optional dark theme.

### Added

- **Light / dark mode** in the side panel. Light is the default; the ☾ / ☀ button in the header switches theme and
  the choice is stored in `localStorage` (`webdam:theme`).
- `sidepanel/theme.js`: loaded in `<head>` to apply the saved theme before first paint (no flash).

### Changed

- Back to the original **violet / turquoise** palette (`#7c4dff` / `#00d1b2`) instead of green:
  - `sidepanel/sidepanel.css` rewritten on CSS variables: a new light theme (white surfaces, violet accents, darker
    turquoise and code colors tuned for contrast on white) and the previous dark theme under `data-theme="dark"`.
  - `content/overlay.css`: DevTools box model colors again, violet selection outline, and a light hover label
    (white with violet / turquoise text) instead of the dark one.
  - Box model diagram back to the DevTools colors (slightly lighter so it reads well in both themes).
  - Violet ON badge and violet-to-turquoise icon again (`tools/generate-icons.ps1`).

### Fixed

- Breadcrumbs in the inspector showed `[object HTMLSpanElement]` instead of the ancestor names: the side panel's
  `h()` helper now flattens nested child arrays at any depth (`flat(Infinity)`).

## [1.2.0] - 2026-10-30

English, white and green theme, and a reorganized inspector.

### Changed

- **Everything in English**: side panel UI, context menu, manifest, toasts, labels collected from the page
  (resource types, computed style groups, stylesheet origins), generated CSS comments, code comments and docs.
  Dates and numbers use the `en` locale.
- **White and green theme**:
  - `sidepanel/sidepanel.css` rewritten with a white background and green accents (`#16a34a`).
  - `content/overlay.css`: the hover box model uses shades of green (lighter outside, stronger inside), the selection
    outline is green and the label is white with green text.
  - Box model diagram in green tones.
  - ON badge in green.
  - Icon regenerated with a green gradient and white "WD" (`tools/generate-icons.ps1`).
- **Composition is now the first inspector section** (open by default) and contains the element summary that used to be
  the first box: thumbnail, tag, size, selector, breadcrumbs and the *Save*, *Copy selector*, *Copy CSS*, *Copy HTML*,
  *↑ Parent* buttons. The separate first box was removed.
- Section order: Composition → Size & box model → Resources & links → Applied CSS rules → Computed styles.
- **Cross-origin (CORS) stylesheets are collapsed by default** in *Applied CSS rules*; the open/closed state is
  remembered while the panel is open.

### Compatibility

- Items saved with earlier versions still open; their stored labels stay in Spanish. Image previews keep working for
  them (`imagen` is still recognized as an image type).

## [1.1.0] - 2026-10-30

The UI moves to Chrome's native **Side Panel**.

### Added

- `sidepanel/sidepanel.html`, `sidepanel.css`, `sidepanel.js`: Chrome side panel with a state header
  (ON/OFF, start/pause, close), an **Inspector** tab and a **Saved** tab (with search).
- `sidePanel` permission, `side_panel` key in the manifest and `minimum_chrome_version: 116`.
- The extension icon opens the side panel (`setPanelBehavior({ openPanelOnActionClick: true })`).
- The context menu and the `Alt+Shift+W` shortcut also open the side panel (`chrome.sidePanel.open`).
- The panel follows the active tab (`tabs.onActivated` / `tabs.onUpdated`) and shows its current selection.
- Closing the panel turns the picker off and removes the highlight from the page (`webdam-sidepanel` port
  + `webdam:panel-closed` message).
- New panel-to-tab messages: `webdam:get-state` (also returns the selection), `webdam:select-related`,
  `webdam:highlight`, `webdam:unhighlight`, `webdam:save`.
- Notice in the panel when the tab is a page where Chrome doesn't allow extensions.
- `splitTopLevel` and `fileName` moved to `shared/webdam-shared.js` (used by both the content script and the panel).

### Changed

- `content/content.js` no longer draws the floating panel: it keeps picker mode, the highlight overlay and data
  collection, and sends the selection to the side panel with `webdam:selected`.
- The element's ancestors and children are navigated by index from the panel (DOM nodes don't travel in messages).
- Saving returns the result to the panel, which shows the confirmation.
- `content/panel.css` → `content/overlay.css` (highlight styles only); panel styles moved to `sidepanel.css`.
- `webdam:popup-command` → `webdam:panel-command` in the service worker.

### Removed

- Popup (`popup/`): its features (start, state, collection, export) now live in the side panel.
- Floating in-page panel and its `webdam:open-panel` / `webdam:show-saved` messages.

## [1.0.0] - 2026-10-30

First release.

### Added

- **Manifest V3** (`manifest.json`) with `contextMenus`, `storage`, `unlimitedStorage`, `activeTab`, `scripting`
  permissions and access to all URLs; `Alt+Shift+W` shortcut.
- **Service worker** (`background.js`):
  - Context menu with three entries: turn picker on / off, inspect this element, open saved elements.
  - Keyboard shortcut to turn the picker on / off.
  - Per-tab **ON** badge, cleared on navigation.
  - Injection of the content script into tabs opened before installing the extension.
  - Thumbnail capture: `captureVisibleTab` + crop with `OffscreenCanvas` to a JPEG of max 480×360.
- **Picker mode** (`content/content.js`):
  - Blocks page clicks in the capture phase and uses them to select.
  - Box model overlay and a label with `tag#id.class` and size.
  - Crosshair cursor across the page (via `adoptedStyleSheets`).
  - Keyboard navigation: `↑` parent, `↓` first child, `Enter` select, `Esc` exit.
- **Inspector**:
  - Size, page position, `display`, `position`, `box-sizing`, area and box model diagram.
  - Applied CSS rules with their origin (file, `<style>`, `@import`, `style=""`, `adoptedStyleSheets`, shadow DOM),
    `@media`/`@supports`/`@layer`/`@container` conditions, nested CSS support and approximate specificity.
  - Notice with links to cross-origin sheets that can't be read due to CORS.
  - Grouped computed styles, color swatches with hex and a filterable full list.
  - Resources: `src`, `srcset`, `currentSrc`, `href`, `poster`, `data`, `action`, `xlink:href`, background images
    (including `::before`/`::after`), `mask-image`, `list-style-image`, `border-image-source`; also from descendants.
  - Composition: navigable breadcrumbs and children (highlighted on hover), attributes, text and HTML.
  - Actions: Save, Copy selector, Copy CSS, Copy HTML, select parent.
- **Floating panel** in a closed Shadow DOM, dockable left or right, with *Inspector* and *Saved* tabs.
- **Saved collection** in `chrome.storage.local` (`webdam:saved`): thumbnail, rename, view detail, copy CSS, delete,
  export JSON and delete all.
- **Popup**: ON/OFF state, start/stop, open panel, search and collection management.
- **Shared utilities** (`shared/webdam-shared.js`): storage access, readable CSS builder, JSON export.
- **WD icon** at 16/32/48/128 px and `tools/generate-icons.ps1` to regenerate it.
- Docs: `README.md` and this `CHANGELOG.md`.
