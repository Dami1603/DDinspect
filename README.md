<p align="center"><img src="extension/icons/logo.svg" width="96" height="96" alt="DDinspect logo"></p>

# DDinspect

Browser extension (Manifest V3) to **take any web component apart**. Pick an element on a page and the side panel
shows:

- its **composition**: parents, children, attributes, text and HTML,
- its **size** and **box model** (margin / border / padding / content),
- the **resources** it uses: `src`, `srcset`, `href`, `poster`, background images… with their links,
- the **CSS rules that apply to it** and **where they come from** (`.css` file, page `<style>`, `@import`,
  `style=""` attribute, sheets created from JS), **including stylesheets served from other domains**, with the
  declarations that lose the cascade **struck through**,
- the **text contrast** (WCAG 2 ratio and AA / AAA result),
- its **computed styles** (grouped and filterable),
- an **export** of the element as standalone **HTML + CSS**, a **React** component (JSX + CSS) or **Tailwind** markup.

It also pulls the page's **assets** into their own tabs, each with a counter on its icon:

- **Images** (`<img>`, `srcset`, `<picture>`, CSS backgrounds, posters, favicons…) with preview, size, download and ZIP,
- **SVGs** (inline and sprite symbols) with preview, clean markup, `.svg` download and ZIP,
- **Colors** ranked by use, by role (text, background, border, SVG, shadow, gradient), exportable as CSS variables,
  plus every **text / background contrast pair**, worst first,
- **Fonts** grouped by family, rendered in the real font, with their `@font-face` files and CSS snippets.

Each asset tab scans the **selected element** and its descendants first, or the **whole page**.

Elements can be **saved** to a collection (with a thumbnail), renamed, viewed later, have their CSS copied, and be
exported to and imported from JSON.

The UI is in **English and Spanish** (follows the browser language), with light, dark or system theme.

**Requirements:** Chrome 121+ (Side Panel) or Firefox 128+ (Sidebar). The same `extension/` folder works in both.

---

## Installation in Chrome (developer mode)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder inside `DDTool` (the one containing `manifest.json`).
4. Pin the **DDinspect** icon to the toolbar (puzzle icon → pin).

A welcome page opens on the first install.

> Tabs that were already open before installing work too: the background script injects the content script the first time it is used.
> After changing the code, click **↻ Reload** in `chrome://extensions` and reload the page you are testing.

> **Coming from WebDAM?** When the extension id stays the same, saved elements and the theme move from the old
> `webdam:*` keys automatically. In Chrome, though, an unpacked extension's id depends on its folder, so loading
> `extension/` starts with an empty collection: export the old collection to JSON from WebDAM and use **Import JSON**.

## Installation in Firefox

In Firefox the panel opens in the **sidebar** (`sidebar_action`) instead of Chrome's side panel. Everything else works the same.

### For testing (removed when Firefox closes)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`.
3. If the page highlight doesn't appear, open `about:addons` → DDinspect → **Permissions** and turn on
   *Access your data for all websites*.
4. Click the **DDinspect** icon (or right click → DDinspect) to open the sidebar.

> After changing the code, click **Reload** next to DDinspect in `about:debugging` and reload the page.

### Permanent install

Release Firefox only keeps add-ons that are **signed by Mozilla**. Two options:

- **Sign it as unlisted (free, not published on the store):**
  1. Create API keys at <https://addons.mozilla.org/developers/addon/api/key/>.
  2. From the `DDTool` folder run:
     ```bash
     npx web-ext sign --source-dir extension --channel=unlisted --api-key=YOUR_JWT_ISSUER --api-secret=YOUR_JWT_SECRET
     ```
  3. Install the signed `.xpi` from `web-ext-artifacts/` (drag it onto Firefox or `about:addons` → ⚙ → *Install Add-on From File…*).
- **Firefox Developer Edition / Nightly only:** set `xpinstall.signatures.required` to `false` in `about:config`, zip the
  contents of the `extension` folder (with `manifest.json` at the root of the zip) and install it with
  `about:addons` → ⚙ → *Install Add-on From File…*.

To check the extension the way Firefox does: `npx web-ext lint --source-dir extension`.
The 4 expected warnings are Chrome-only keys and APIs (`sidePanel`, `background.service_worker`), which Firefox ignores.

## Usage

### Opening DDinspect

| How | What it does |
| --- | --- |
| **Click the DDinspect icon** | Opens the side panel. From there, turn on the **Picker** switch. |
| **Right click → DDinspect → Turn the DDinspect picker on / off** | Opens the side panel and switches the click to picker mode. |
| **Right click → DDinspect → Inspect this element with DDinspect** | Opens the side panel and shows the element you right-clicked straight away. |
| **Right click → DDinspect → Open saved elements** | Opens the side panel on the *Saved* tab. |
| **Shortcut** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | Opens the side panel and turns the picker on / off. Can be changed in `chrome://extensions/shortcuts`. |

While picker mode is on, the icon badge shows **ON** and the cursor becomes a crosshair.

### Picker mode (on the page)

- **Hover**: highlights the element's box model with DevTools-like colors (orange = margin, yellow = border,
  green = padding, blue = content) and shows a card with:
  `tag#id.class`, `width × height`, **position** (page x, y and the `position` value if not static), **color**,
  **background** (in the color format picked in the options), **contrast** of its text (green when it passes AA,
  red when it fails; `≈` when a background image makes it an estimate), **font** family, **font size**, **weight**,
  **line height**, **padding** and **margin**.
- **Click**: selects the element (it gets a dashed violet outline) and shows its layout in **Inspect**.
  If you are on an asset tab (e.g. *Colors*), the panel stays there and shows that element's assets instead.
  The page does **not** receive the click (no navigation, no form submission).
- **Parent first**: hover and click grab the **parent** of the element under the pointer (the button rather than the
  `<span>` with its text, the `<svg>` rather than its `<path>`), never `body` or `html`. *Inspect this element* from the
  right-click menu follows the same rule.
- <kbd>↑</kbd> goes up one more level, <kbd>↓</kbd> goes back down toward the exact element under the pointer (then into
  first children), <kbd>Enter</kbd> selects the highlighted element. Clicking keeps what ↑ / ↓ chose. The hover card
  shows these hints at the bottom.
- <kbd>Esc</kbd> exits picker mode.

### The side panel

The header shows the logo, the picker state, the **Picker** switch, the options button, the theme button and ✕ to close.

**Theme**: light by default. The moon / sun button switches between light and dark; the options page also offers
*Same as the system*. The choice is shared by the panel, the options page and the welcome page.

**Closing the panel** turns the picker off and removes the highlight from the page.
**Switching tabs** makes the panel show the new tab (and its selection, if any).

**Tabs**: *Inspect*, *Images*, *SVGs*, *Colors*, *Fonts* and *Saved*. The bubble on each icon shows how many items
were found. With the keyboard: <kbd>←</kbd> / <kbd>→</kbd> move between tabs, <kbd>Home</kbd> / <kbd>End</kbd> jump to
the first / last one.

**Inspect** (sections in this order)

1. **Composition** (open by default):
   - Element summary: thumbnail (for saved elements), tag, size, **contrast pill** ("Aa" in the element's colors,
     ratio and WCAG level; for a wrapper like a button around a `<span>` it uses the first text inside), unique CSS
     selector and breadcrumbs (click an ancestor to select it; hovering highlights it on the page).
   - Actions: *Save*, *Copy selector*, *Copy CSS*, *Copy HTML*, *Parent*.
   - Direct children (hover to highlight them on the page, click or <kbd>Enter</kbd> to select), descendants, depth,
     attributes, text and HTML.
2. **Size & box model**: width, height, page position, `display`, `position`, `box-sizing`, area and box diagram.
3. **Resources & links**: every `src`/`srcset`/`href`/`poster`/`data`/`action`, the image actually loaded (`currentSrc`),
   background images (including `::before`/`::after`), `mask-image`, etc. Includes those of descendants (showing which one
   they come from), with image previews, a link to open them and a button to copy the URL.
4. **Applied CSS rules**: sorted like the cascade (`style=""` first, then higher specificity and, on ties, the later one).
   Each rule shows the selector (highlighting the part that matches), specificity, **origin** (with a link to the file),
   `@media` / `@supports` / `@layer` / `@container` conditions and its declarations.
   - Declarations that another one beats are **struck through** (see *How it works → Overridden declarations*).
     *Copy CSS* marks them with `/* overridden */`.
   - Stylesheets from other domains that the page can't read (CORS) are **fetched by DDinspect** and their rules are
     listed with a **fetched** badge. Only sheets that can't be fetched either stay in a collapsed block at the top.
5. **Computed styles**: groups (Layout, Box, Borders, Typography, Background, Effects) with color swatches and the color
   in the picked format, plus the full property list with a filter.
6. **Export as component** (live selection only): *Generate code* builds standalone code for the element and its
   descendants. Pick **HTML + CSS**, **React (JSX)** or **Tailwind**; a sandboxed **preview** shows the result. *Copy
   code*, *Copy CSS*, *Download .html* (HTML and Tailwind; the Tailwind file includes the Play CDN so it opens as is) or
   *Download ZIP* (`Component.jsx` + `Component.css`).

**Asset tabs** share a toolbar: **Selected element / Whole page** (scope; the default comes from the options) and
**↻** to rescan content loaded later. Hovering a card highlights its element on the page; the locate button selects it
and opens Inspect.

- **Images**: filter chips (*All*, `<img>`, *CSS*, *SVG*, *Other*) with counts and a URL / alt filter. Each card shows a
  preview, file name, type, natural size and how many times it's used (×N), with *Copy URL*, *Download*, *Open* and
  *Locate*. **ZIP** downloads the listed images in one file; *Copy URLs* copies them all.
- **SVGs**: one tile per distinct SVG (duplicates merged, ×N). The markup is cleaned so it works outside the page: paint
  coming from page CSS and `currentColor` are inlined, `<use href="#…">` is resolved, scripts and event handlers removed.
  Sprite sheets list each `<symbol>`. *Copy markup*, *Download .svg*, **ZIP**, and a light / dark preview background.
- **Colors**: role chips (*Text*, *Background*, *Border*, *SVG*, *Shadow*, *Gradient*), a strip where each color's width
  follows its use, cards with the value in the picked format plus a second format, uses and roles. Click to copy; *Copy
  CSS vars* exports `:root { --color-1: …; }` and *Copy list* the plain list.
  **Text contrast** lists every text color / background pair (worst first) with its sample, ratio, AA / AAA / *Fails*
  badge, *large text* note and how many elements use it; hover highlights one on the page and *Locate* selects it.
- **Fonts**: one card per family with its stack, its `@font-face` files (download), and every style used
  (weight · size / line height · uses) rendered in the real font, with *Copy CSS*.

**Saved**

Search box and list of saved elements with thumbnails: rename (click the name), *View* (opens the full detail, even if it
belongs to another page), *Copy CSS*, *Delete*, *Export JSON*, **Import JSON** and *Delete all*. Importing accepts
DDinspect and WebDAM exports; elements whose id is already saved are skipped and broken entries are rejected.

On tabs where the browser doesn't allow extensions (`chrome://`, Web Store, PDF viewer) the panel says so, but the saved
elements are still available.

### Options

Open them from the panel (sliders button), from `chrome://extensions` → DDinspect → *Extension options*, or from the
welcome page:

- **Color format**: HEX, RGB, HSL or OKLCH, for the panel and the hover card.
- **Default scan scope**: *Selected element* or *Whole page*.
- **Theme**: light, dark or same as the system.
- **Keyboard shortcut**: shows the current one and links to the browser's shortcut settings.

Changes apply immediately, also in an open panel.

---

## Project structure

```
DDTool/
├── extension/               The extension itself: load / sign / zip this folder
│   ├── manifest.json        MV3 config: side panel, permissions, menu, shortcut, scripts, options page
│   ├── background.js        Service worker: opens the side panel, context menu, shortcut, badge, forwards
│   │                        commands to the tab, captures thumbnails, fetches cross-origin CSS, welcome page
│   ├── _locales/            en and es messages (UI, menus, manifest)
│   ├── shared/
│   │   └── ddinspect-shared.js  i18n, storage, settings, color formats, WCAG contrast, cascade, CSS builder,
│   │                           JSON import / export
│   ├── content/
│   │   ├── scan.js          Asset scanner: images, SVGs, colors, contrast pairs, fonts (one pass over the DOM)
│   │   ├── export.js        "Export as component": computed styles → markup + one rule per element
│   │   ├── content.js       Picker mode, hover card, highlight overlay and element data
│   │   └── overlay.css      Overlay and hover card styles (inside Shadow DOM)
│   ├── sidepanel/
│   │   ├── sidepanel.html   Side panel: header with the picker switch, tab bar with counters
│   │   ├── sidepanel.css    Light and dark themes via CSS variables (also used by the options / welcome pages)
│   │   ├── sidepanel.js     Core: tabs, Inspect, export, Saved, messaging, icons
│   │   ├── assets.js        Images / SVGs / Colors / Fonts tabs, scan cache, downloads
│   │   ├── export-format.js HTML document, JSX and Tailwind writers for the export
│   │   ├── zip.js           Minimal ZIP writer (stored, no dependencies)
│   │   └── theme.js         Applies the saved theme before first paint (light / dark / system)
│   ├── options/             Options page
│   ├── welcome/             Welcome page (first install)
│   └── icons/               logo.svg, logo-small.svg (masters) and icon16/32/48/128.png
├── store/                   Store listing texts, promo tile (promo.html → promo-440x280.png)
├── tools/
│   ├── generate-icons.ps1   Renders the SVG masters and the promo tile to PNG
│   ├── check-i18n.js        Checks that every message key used exists in each locale
│   └── test-shared.js       Unit checks for the shared helpers
├── PRIVACY.md
├── README.md
└── CHANGELOG.md
```

### How it works

```
 Page (content.js)                   Service worker (background.js)            Side panel (sidepanel.js)
 ─────────────────                   ──────────────────────────────            ─────────────────────────
 click on element ── ddinspect:selected { info } ────────────────────────────▶  renders the inspector
 ddinspect:state { active } ────────▶ ON/OFF badge ─────────────────────────▶  ON/OFF state
                      ◀── tabs.sendMessage ── ddinspect:panel-command ◀───────  start, save, highlight,
                                             (injects the script if missing)    select parent/child, export
 ddinspect:fetch-css ───────────────▶ fetch() the stylesheet (no cookies)
 ddinspect:capture ─────────────────▶ captureVisibleTab + crop
                                     "ddinspect-sidepanel" port ◀─────────────  reports the shown tab
 ddinspect:panel-closed ◀─────────── when the port disconnects (panel closed)
```

- **Side panel**: declared in `side_panel.default_path`. `setPanelBehavior({ openPanelOnActionClick: true })` makes the
  icon open it. The context menu and the shortcut call `chrome.sidePanel.open()` *before* any `await`, because Chrome
  only allows it as a direct response to a user gesture.
- **Chrome + Firefox from one folder**:
  - The manifest has keys for both; each browser ignores the other's: `side_panel` (Chrome) and `sidebar_action`
    (Firefox) point to the same page; `background` has `service_worker` (Chrome) and `scripts` (Firefox);
    `browser_specific_settings.gecko` holds the Firefox add-on id, minimum version and data-collection declaration.
  - `background.js` uses `chrome.sidePanel` when it exists and otherwise `sidebarAction` (`toggle()` on icon click,
    `open()` from the menu and shortcut, also before any `await`).
  - The panel's ✕ uses `sidebarAction.close()` in Firefox and `window.close()` in Chrome. *Delete all* uses a
    two-click confirm instead of `confirm()`, which Firefox sidebars don't reliably show.
  - The content script detects CSS rule types with `Object.prototype.toString` (works through Firefox's Xray
    wrappers) and falls back to a `<link>` to `overlay.css` if constructable stylesheets are refused.
- **i18n**: every visible string comes from `_locales/<lang>/messages.json` through `DDinspectShared.t(key, …args)`
  (placeholders are `{0}`, `{1}`…). Static pages use `data-i18n`, `data-i18n-title`, `data-i18n-placeholder` and
  `data-i18n-aria-label`. `node tools/check-i18n.js` fails if a key is missing, unused or empty in any locale.
- **Active tab**: the panel is per window; it follows the active tab with `tabs.onActivated` / `tabs.onUpdated` and asks
  it for its state (`ddinspect:get-state`, which also returns the current selection).
- **Cross-origin stylesheets**: reading `cssRules` of a sheet from another domain without CORS throws. The content
  script collects those URLs (and cross-origin `@import`s), asks the background script for their text
  (`ddinspect:fetch-css`: http(s) only, `credentials: 'omit'`, CSS content types, 5 MB cap; the extension's host
  permissions skip CORS), parses it into a constructed `CSSStyleSheet` and walks it like any other sheet, in its
  original position. Each URL is fetched once per page.
- **Overridden declarations** (`DDinspectShared.overriddenFlags`): every declaration gets a priority
  `[tier, layer, specificity, source order, position]`. Normal: `style=""` > unlayered > layered (later layer wins).
  `!important` flips layers: `style=""` > layered (earlier layer wins) > unlayered. A declaration is struck through
  when another one with higher priority sets the same property or a shorthand that includes it (`padding` beats
  `padding-top`, `border` never touches `border-radius`). A stronger longhand doesn't strike a shorthand, since it only
  overrides part of it. Pseudo-element rules are compared only among themselves.
- **Contrast**: the text color is blended over the opaque color behind the element (its background blended over its
  ancestors', white at the root) and the WCAG 2 ratio is computed from relative luminance. Large text is 24 px, or
  18.66 px bold. A background image anywhere in that stack marks the value as an estimate (`≈`).
- **Export as component** (`content/export.js`): clones the element, keeps only safe attributes (URLs made absolute;
  scripts, styles, event handlers, page classes and ids removed) and gives each element a class `dd-N`. Its CSS comes
  from computed styles diffed against the browser default for that tag (read from a hidden blank iframe in our shadow
  root); inherited properties are kept only when they differ from the parent, logical duplicates and colors equal to
  `color` are dropped, longhands fold into `margin` / `padding` / `border` / `border-radius`, the root loses its page
  placement (`position`, offsets, `z-index`), `::before` / `::after` with content get their own rules, and the
  `@font-face` rules of the families used are added. The picker's crosshair cursor is removed while it runs.
  `sidepanel/export-format.js` writes the HTML document, the JSX (via `DOMParser`, never executed) and the Tailwind
  markup (arbitrary properties like `[display:flex]`).
- **Asset scan** (`content/scan.js`): the panel sends `ddinspect:scan-assets { scope }`; the content script scans the
  document or the selected element's subtree, reading each element's computed style **once** for CSS images, colors,
  contrast pairs and fonts. Colors are normalized to HEX (rgb() parsed directly, anything else through a 1×1 canvas)
  and only count for rendered elements; text color only for elements with their own text, borders only when visible.
  Results are cached per scope in the panel (that feeds the badges) and cleared on tab switch, navigation, new
  selection or ↻.
- **Settings**: `chrome.storage.local` under `ddinspect:settings` (`colorFormat`, `scope`). The panel and the content
  script listen to `storage.onChanged`, so the options page applies at once. The theme stays in `localStorage`
  (`ddinspect:theme`) so `theme.js` can apply it before the first paint; the `storage` event syncs open pages.
- **Downloads**: the panel fetches files itself (extension pages may fetch cross-origin with the host permissions),
  saves them through a blob link, and builds ZIPs with `zip.js` (6 downloads in parallel, failures counted).
  SVG previews use `<img src="data:image/svg+xml,…">`, so scripts inside an SVG can never run in the panel.
- **Font previews**: `@font-face` files are fetched as bytes and registered with `FontFace` under an alias, so samples
  render in the real font even when the font server doesn't allow CORS.
- **Navigation by index**: DOM nodes can't travel in messages, so the content script keeps references to the selected
  element's ancestors and children, and to the elements behind scanned images, SVGs and text pairs; the panel asks for
  them by index (`ddinspect:select-related`, `ddinspect:highlight`).
- **Panel close**: the panel keeps a port open with the service worker; when it closes the port disconnects and the
  service worker sends `ddinspect:panel-closed` to the tab (turns the picker off and removes the outline). If the service
  worker goes idle, the panel reconnects the port.
- **Themes**: every color in `sidepanel.css` is a CSS variable defined on `:root` (light) and overridden in
  `:root[data-theme='dark']`.
- **Overlay isolation**: the highlight lives in a `<ddinspect-root>` element with a **closed Shadow DOM**. Its CSS is
  loaded as a *constructable stylesheet* (`adoptedStyleSheets`), which the page CSP doesn't block.
- **Security**: the UI is built with `textContent`/`createElement`, never `innerHTML`, because it shows page data
  (classes, attributes, URLs). Clickable links are only created for `http(s)`, `blob`, `ftp` and `data:` images. The
  export preview is an `<iframe sandbox>` without scripts. Imported JSON is rebuilt field by field, and only embedded
  `data:image` thumbnails are kept.
- **Click blocking**: in picker mode `click`, `mousedown`, `pointerdown`, etc. are listened to in the capture phase on
  `window` and cancelled (`preventDefault` + `stopImmediatePropagation`).
- **CSS rules**: walks `document.styleSheets`, `document.adoptedStyleSheets` (except the picker's own cursor sheet) and,
  if the element is inside an open shadow DOM, that root's sheets. It goes into `@media` (only if it matches now),
  `@supports`, `@layer`, `@container`, `@scope`, `@import` and **nested CSS** (`&`). Each selector is checked with
  `element.matches()`; pseudo-elements (`::before`, `::after`…) are tested without the pseudo part and tagged with a badge.
- **Thumbnails**: on save the overlay is hidden, `background.js` calls `captureVisibleTab`, crops the element rectangle
  with `OffscreenCanvas` and returns a JPEG (max 480×360). Only the part visible on screen is captured.
- **Storage**: `chrome.storage.local` under the `ddinspect:saved` key (with `unlimitedStorage`); data saved by WebDAM
  under `webdam:saved` is moved on first load. The panel refreshes itself with `chrome.storage.onChanged`. The initial
  tab requested from the context menu is passed via `chrome.storage.session`.

### Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Show DDinspect in Chrome's side panel (Firefox ignores it and uses `sidebar_action`). |
| `contextMenus` | DDinspect entries in the right-click menu. |
| `storage`, `unlimitedStorage` | Store the collection (thumbnails take space) and the settings. |
| `activeTab`, `scripting` | Inject the script into tabs opened before installing. |
| `host_permissions: <all_urls>` | The content script works on any site; `captureVisibleTab` for thumbnails; fetching cross-origin stylesheets, images and fonts. |

See [PRIVACY.md](PRIVACY.md): no data leaves the browser.

## Checks

```bash
node tools/test-shared.js     # color formats, WCAG contrast, cascade, JSON import
node tools/check-i18n.js      # every message key exists in en and es
npx web-ext lint --source-dir extension
```

## Known limitations

- Stylesheets that can't be fetched either (offline, blocked by the server, not `text/css`) are listed in a collapsed
  block without their declarations. **Computed styles** still reflect the final result. Stylesheets fetched this way
  don't follow their own `@import`s.
- Overridden detection is an approximation of the cascade: specificity is approximate, `revert-layer` and explicit
  `@layer a, b;` order statements aren't modeled (layer order follows first appearance), and browser (*user agent*)
  styles aren't shown.
- `@container` can't be evaluated from JS: those rules are listed with the note "(not evaluated)".
- Contrast uses solid colors: background images, gradients, `opacity`, `mix-blend-mode` and text shadows aren't taken
  into account (images and gradients mark the value with `≈`).
- The export is a snapshot of computed styles at the current window size: no media queries, hover states or
  animations, sizes are in px, and only the first 400 elements get styles. Hidden (`display: none`) descendants are left out.
- Only works in the main document: an `<iframe>` can be selected as an element, but not its content.
- Chrome doesn't allow extensions on `chrome://`, the Chrome Web Store or the PDF viewer.
- `:hover` rules show up because the mouse is over the element when you click it.
- If you switch tabs with the picker on, the previous tab keeps it on (**ON** badge) until you go back to it and pause it,
  press <kbd>Esc</kbd> or close the panel while on it.
- Asset scans are a **snapshot**: content loaded later (lazy images, infinite scroll) needs **↻**.
- Very large pages: computed styles are read for the first 8000 elements, and `::before`/`::after` only when the scope
  has 3000 elements or fewer. `data:` images over 300 KB and SVGs over 150 KB of markup are skipped.
- Content inside shadow DOMs and iframes isn't scanned.
- Some servers block hot-linking or downloads without their cookies: the preview may fail ("No preview") and
  *Download* then opens the file in a new tab instead.
- Lottie animations aren't detected (yet).

## Regenerating the icons and the promo tile

```powershell
powershell -ExecutionPolicy Bypass -File tools\generate-icons.ps1
```

Renders `extension/icons/logo-small.svg` (16, 32 px) and `logo.svg` (48, 128 px) with headless Microsoft Edge or
Chrome at 512 px and scales them down, then renders `store/promo.html` to `store/promo-440x280.png`.
