# Store listing

Texts and assets for the Chrome Web Store and addons.mozilla.org (AMO).

## Assets

| Asset | File | Status |
| --- | --- | --- |
| Icon 128×128 | `extension/icons/icon128.png` | Ready |
| Small promo tile 440×280 | `store/promo-440x280.png` (source: `store/promo.html`) | Ready |
| Screenshots 1280×800 (1–5) | — | To take: see below |
| Privacy policy URL | `PRIVACY.md` (publish it, e.g. on GitHub, and paste the link) | Ready |

### Taking the screenshots

The side panel can't be captured from a script, so take them by hand at 1280×800:

1. Resize the browser window to 1280×800 (DevTools device toolbar → *Responsive* → 1280×800, or a window-size extension).
2. Open a well-designed page, open DDinspect and dock the side panel on the right.
3. Suggested shots:
   1. *Inspect* with **Applied CSS rules** open, showing a struck-through declaration and a `fetched` stylesheet.
   2. The hover card over a button (picker on), showing **Contrast**.
   3. *Colors* with the **Text contrast** list open.
   4. **Export as component** with the preview and the React (JSX) code.
   5. *Images* with the grid and the ZIP button.
4. Save them as PNG (no alpha needed) in `store/`.

## Name

- **en:** DDinspect – Inspect CSS & extract assets
- **es:** DDinspect – Inspecciona CSS y extrae recursos

## Short description (132 characters max, from `_locales/*/messages.json` → `extDescription`)

- **en:** Pick any element to see its CSS and where it comes from, check contrast, export it as code and grab images, SVGs, colors and fonts.
- **es:** Elige un elemento y mira su CSS y su origen, revisa el contraste, expórtalo como código y extrae imágenes, SVG, colores y fuentes.

## Category

Developer Tools.

## Detailed description — English

DDinspect takes any web component apart. Turn on the picker, click an element, and the side panel shows what it is
made of and why it looks the way it does.

**See the CSS and where it comes from**
- Every rule that applies to the element, in cascade order, with the file, `<style>` tag or script that defines it.
- Declarations that lose the cascade are struck through, so you see at a glance which value wins.
- Stylesheets served from other domains (CDNs) are read too: DDinspect fetches them so their rules show up.
- Computed styles grouped by layout, box, typography, background and effects, with a filter.

**Check accessibility**
- WCAG contrast ratio of the text on hover and in the inspector.
- A list of every text / background pair on the page, worst first, with AA / AAA results.

**Export as code**
- Turn the element into standalone HTML + CSS, a React component (JSX + CSS) or Tailwind classes.
- Only the styles that matter are kept; page classes, scripts and event handlers are removed.
- Live preview before you copy or download.

**Grab the assets**
- Images (including CSS backgrounds and `srcset`), inline SVGs (cleaned so they work outside the page), colors by
  role and fonts with their files. Download one by one or as a ZIP.

**Your collection**
- Save elements with a thumbnail, view them later, export and import them as JSON.

**Private by design**
- No account, no tracking, no server. Everything stays in your browser.

Works in English and Spanish, with light and dark themes. Shortcut: Alt+Shift+D.

## Descripción detallada — Español

DDinspect desarma cualquier componente web. Activa el selector, haz clic en un elemento y el panel lateral muestra de
qué está hecho y por qué se ve así.

**Mira el CSS y de dónde viene**
- Cada regla que se aplica al elemento, en el orden de la cascada, con el archivo, la etiqueta `<style>` o el script
  que la define.
- Las declaraciones que pierden en la cascada aparecen tachadas: ves de un vistazo qué valor gana.
- También lee hojas de estilo de otros dominios (CDN): DDinspect las descarga para mostrar sus reglas.
- Estilos calculados agrupados por disposición, caja, tipografía, fondo y efectos, con filtro.

**Revisa la accesibilidad**
- Relación de contraste WCAG del texto al pasar el mouse y en el inspector.
- Lista de todos los pares texto / fondo de la página, primero los peores, con resultado AA / AAA.

**Exporta como código**
- Convierte el elemento en HTML + CSS independiente, un componente React (JSX + CSS) o clases de Tailwind.
- Solo se conservan los estilos que importan; se quitan las clases de la página, los scripts y los eventos.
- Vista previa antes de copiar o descargar.

**Extrae los recursos**
- Imágenes (incluidos fondos CSS y `srcset`), SVG en línea (limpios para que funcionen fuera de la página), colores
  por función y fuentes con sus archivos. Descárgalos de a uno o en un ZIP.

**Tu colección**
- Guarda elementos con miniatura, míralos después, expórtalos e impórtalos como JSON.

**Privado por diseño**
- Sin cuentas, sin rastreo, sin servidor. Todo queda en tu navegador.

En español e inglés, con tema claro y oscuro. Atajo: Alt+Mayús+D.

## Permission justifications (Chrome Web Store form)

- **Host permission `<all_urls>`:** the user can inspect any page; the content script reads the selected element's
  styles, and the extension fetches the page's own stylesheets, images and fonts to show and download them.
- **scripting / activeTab:** inject the content script into tabs opened before installation.
- **storage / unlimitedStorage:** saved elements (with thumbnails) and settings, stored locally.
- **contextMenus:** right-click entries to inspect an element.
- **sidePanel:** the extension's UI lives in the side panel.
- **Remote code:** none. All code ships in the package.
- **Data usage:** no user data is collected or transmitted.
