# DDinspect privacy policy

_Last updated: 1 November 2026_

DDinspect is a browser extension for inspecting web pages. It does not collect, sell or share any personal data.

## What DDinspect stores

- **Saved elements** you choose to save (selector, styles, page URL and title, a thumbnail of the element), and
  your **settings** (color format, default scan scope). They are kept in your browser with `chrome.storage.local`.
- **Theme** preference, kept in the extension's own `localStorage`.

This data never leaves your browser. You can export it as JSON, import it again, or delete it from the *Saved* tab.
Uninstalling the extension deletes it.

## Network requests

DDinspect has no server and sends nothing to its developer. It only requests files that belong to the page you are
inspecting, directly from where that page loads them, and only when you use a feature that needs them:

- stylesheets the page loads from another domain, so their rules can be shown in *Applied CSS rules*;
- images, SVGs and font files, to preview them and to download them when you ask.

These requests are sent without cookies or credentials (stylesheets) or as a normal download (images, fonts).

## Permissions

| Permission | Why |
| --- | --- |
| Access to all sites | Pick elements on any page, read their styles, fetch the page's stylesheets, images and fonts. |
| `scripting`, `activeTab` | Start DDinspect on tabs that were open before it was installed. |
| `storage`, `unlimitedStorage` | Keep saved elements (thumbnails take space) and settings on your device. |
| `contextMenus` | The right-click entries. |
| `sidePanel` | Show DDinspect in Chrome's side panel. |

## Contact

Questions about this policy: CONTACT_EMAIL (replace with the address you want to publish before submitting).
