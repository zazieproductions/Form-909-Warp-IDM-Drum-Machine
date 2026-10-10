# Deployment

**Form 909-WARP** — how the instrument is published, embedded and archived

There is no build, no artefact pipeline and nothing to compile. Deployment is
copying a file. This document covers the places it can be copied to and the
considerations for each.

---

## Contents

1. [What gets deployed](#1-what-gets-deployed)
2. [GitHub Pages](#2-github-pages)
3. [Self-hosting](#3-self-hosting)
4. [Embedding](#4-embedding)
5. [file:// and offline use](#5-file-and-offline-use)
6. [Caching and updates](#6-caching-and-updates)
7. [Environment considerations](#7-environment-considerations)
8. [Release process](#8-release-process)
9. [Verifying a deployment](#9-verifying-a-deployment)

---

## 1. What gets deployed

**One file.**

```
Form-909 Warp IDM Drum Machine.html     ~93 KB
```

That is the complete application: markup, styles, engine, presets and
everything else.

| Property | Value |
|---|---|
| Files | 1 |
| Total size | ~93 KB |
| Runtime dependencies | 0 |
| Build step | none |
| External requests | 3 webfonts (optional) |
| Server requirements | Any static file server |

Because the artefact *is* the source, there is no state in which the
repository is present but the application is not deployable.

---

## 2. GitHub Pages

The recommended deployment. A workflow is included.

### Enabling it

1. Repository **Settings → Pages**
2. **Source:** GitHub Actions
3. Push to `main`, or run the workflow manually

The included workflow (`.github/workflows/pages.yml`) then runs on every push
to `main` and on every `v*` tag.

### What the workflow does

```
1. Checkout
2. npm run validate          ← refuses to deploy a broken file
3. Assemble _site/
     index.html                              ← the app, at the root
     Form-909 Warp IDM Drum Machine.html    ← the original filename, preserved
     README.md
4. Upload the artefact
5. Deploy
```

The copy to `index.html` exists because the filename contains spaces. Serving
the app at the root avoids URL-encoding in every link; keeping the original
filename means existing deep links continue to resolve.

### Base path

The site deploys to:

```
https://zazieproductions.github.io/Form-909-Warp-IDM-Drum-Machine/
```

The application uses **no absolute paths** — there are no internal links, no
fetch calls and no asset references — so it works at any base path with no
`<base>` tag and no configuration.

### Current live state

Both URLs resolve to the instrument today — checked by fetching them:

| URL | Serves |
|---|---|
| `/` | The instrument, via the root `index.html` forwarder. |
| [`/Form-909%20Warp%20IDM%20Drum%20Machine.html`](https://zazieproductions.github.io/Form-909-Warp-IDM-Drum-Machine/Form-909%20Warp%20IDM%20Drum%20Machine.html) | The instrument, directly. |

Two details make that work, and both are load-bearing:

- **`.nojekyll` in the repository root.** The Pages source is **branch `main`,
  path `/`** (`GET /repos/:owner/:repo/pages` reports `build_type: legacy`,
  `cname: null`), so the branch is published by Jekyll unless told otherwise.
  Before `.nojekyll` existed, the root URL served *this README rendered as a
  web page*, because Jekyll promotes `README.md` to the site index when there
  is no `index.html` it recognises. Deleting that file brings the behaviour
  back.
- **`index.html` in the repository root**, a forwarder to the percent-encoded
  filename. It is what makes `/` work under branch publishing, and it is
  separate from the `index.html` the workflow writes into `_site/`.

The setup section above still applies if you want the artefact path to be the
one that publishes: set **Settings → Pages → Source: GitHub Actions** and
re-run the workflow. With the source left on branch publishing, run
`38004593207` of *Deploy to GitHub Pages* failed at its Deploy step while the
site continued to be served from the branch; the most recent run on `main`
succeeded.

### Required permissions

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

---

## 3. Self-hosting

Copy the file to any web server. There is nothing else to configure.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    root /var/www/form909;
    index index.html;

    location = / {
        try_files /index.html =404;
    }

    # The application is static and immutable per release.
    location ~* \.html$ {
        add_header Cache-Control "public, max-age=3600";
    }

    gzip on;
    gzip_types text/html text/css application/javascript;
}
```

If you only have the original filename with spaces, either rename it to
`index.html` or link with percent-encoding:

```html
<a href="/Form-909%20Warp%20IDM%20Drum%20Machine.html">Form 909-WARP</a>
```

### Apache

```apache
<VirtualHost *:443>
    DocumentRoot /var/www/form909
    DirectoryIndex index.html

    <Directory /var/www/form909>
        Require all granted
    </Directory>
</VirtualHost>
```

### Any static host

Netlify, Vercel, Cloudflare Pages, Surge, S3, Azure Static Web Apps — all work
with no configuration, because there is no build command and no output
directory to specify. Point the host at the repository root and publish.

### Docker

If you want a container, any static server image will do:

```dockerfile
FROM nginx:alpine
COPY "Form-909 Warp IDM Drum Machine.html" /usr/share/nginx/html/index.html
EXPOSE 80
```

A container is not required; it is listed because people ask.

---

## 4. Embedding

### In an iframe

```html
<iframe
  src="https://zazieproductions.github.io/Form-909-Warp-IDM-Drum-Machine/"
  title="Form 909-WARP drum machine"
  width="1200"
  height="700"
  loading="lazy"
  allow="autoplay"
  style="border: 1px solid #232c35; border-radius: 4px;">
</iframe>
```

Two attributes matter:

| Attribute | Why |
|---|---|
| `title` | Required for accessibility — an iframe without one is unlabelled |
| `allow="autoplay"` | Browser autoplay policies apply inside iframes. Without it, the `AudioContext` may not start. |

The application sets **no `X-Frame-Options` or CSP `frame-ancestors` directive
of its own**, because it is served by the host. If you control the host and
wish to prevent embedding, set those headers there.

### Responsive embedding

```css
.embed {
  position: relative;
  aspect-ratio: 12 / 7;
  width: 100%;
}
.embed iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

### In a CMS or notebook

Because it is a single HTML file with no external script dependencies, it can
be pasted into any environment that accepts raw HTML — a CMS block, a Jupyter
notebook, an Electron or Tauri wrapper, a documentation page.

---

## 5. file:// and offline use

Opening the file directly works. This is a deliberate property, not a fallback.

| Capability | Under `file://` | Note |
|---|---|---|
| Play and sequence | ✅ | |
| All synthesis and effects | ✅ | |
| Oscilloscope | ✅ | |
| Export to WAV | ✅ | `OfflineAudioContext` needs no hardware |
| Webfonts | ⚠️ | Loaded over the network; system fallbacks apply if offline |

For a fully offline copy, self-host the three fonts — tracked in
[ROADMAP.md](ROADMAP.md#34-self-hosted-fonts).

### Practical uses

- Distribute on a USB stick
- Attach to an email
- Archive alongside a project
- Run in a kiosk or installation with no network

---

## 6. Caching and updates

The application has no versioned asset names, because it has no assets. That
makes cache invalidation a question worth answering.

| Strategy | Setting | Trade-off |
|---|---|---|
| **Conservative** (recommended for the root) | `Cache-Control: public, max-age=3600` | Updates appear within an hour |
| **Aggressive** | `Cache-Control: public, max-age=31536000, immutable` | Requires a filename change per release |
| **No cache** | `Cache-Control: no-store` | Always current; no caching benefit |
| **ETag revalidation** | `Cache-Control: no-cache` + ETag | Always current; a round trip per load |

Recommendation: `max-age=3600` for the HTML, or `no-cache` with ETags if you
want immediacy. At ~93 KB, revalidation costs far less than a stale
instrument.

### The dev server

`tools/serve.mjs` sets `cache-control: no-store` so local edits always appear
without a hard refresh. That is correct for development and wrong for
production.

---

## 7. Environment considerations

### HTTPS

Not required — the application makes no privileged API calls and no network
requests beyond optional fonts. HTTPS is nevertheless recommended for any public
deployment, and is automatic on GitHub Pages.

### Content Security Policy

If your host sets a CSP, these are the directives the application needs:

```
default-src 'self';
style-src   'self' https://fonts.googleapis.com;
font-src    https://fonts.gstatic.com;
img-src     'self' data:;
script-src  'self' 'unsafe-inline';   ← the engine is an inline <script>
connect-src 'none';                   ← the app makes no network requests
media-src   'self' blob:;             ← the export produces a blob: download
```

The `'unsafe-inline'` for scripts is unavoidable while the engine is inline —
it is the direct cost of the single-file design. If your environment forbids
inline scripts, the options are a CSP nonce (which requires a server that can
inject one) or extracting the script to a separate file (which breaks the
single-file property).

**There is no `eval`, no `new Function`, no remote script loading and no
dynamic import.** The only `innerHTML` uses are from static templates and
engine-controlled strings; no user input reaches them in v1.1.

### Headers that would break it

| Header | Effect |
|---|---|
| `Content-Security-Policy: script-src 'self'` | Blocks the inline engine entirely |
| `X-Frame-Options: DENY` | Blocks embedding (only if you wanted it) |
| `Content-Type: text/plain` | The browser downloads instead of rendering |

### Cross-origin isolation

Not required. `SharedArrayBuffer` and high-resolution timers are not used.

---

## 8. Release process

```
1.  npm run check                          ← validate + link check
2.  Run the manual matrix (TESTING.md §4)  ← Chrome, Firefox, Safari
3.  Run the regression checklist (TESTING.md §6)
4.  Update CHANGELOG.md — Unreleased → a version heading with the date
5.  Bump the version in package.json
6.  Commit:  "Release vX.Y.Z"
7.  Tag:     git tag -a vX.Y.Z -m "vX.Y.Z — summary"
8.  Push the branch and the tag
9.  CI deploys to Pages
10. Create a GitHub Release from the changelog entry
```

### Rollback

Pages deployment is atomic. To roll back:

```bash
git revert <sha>          # or reset to a previous tag
git push origin main
```

The workflow redeploys. Because the artefact is one file, a bad deploy can also
be undone by re-uploading a known-good copy — which is worth keeping for any
deployment you cannot afford to lose.

### Versioning

See [MAINTAINABILITY.md §9](MAINTAINABILITY.md#9-release-process). The
project-specific rule: **a change that makes existing patterns sound materially
different is a major version bump**, even when no API moved.

---

## 9. Verifying a deployment

A short checklist, run against the live URL:

| # | Check | Pass criterion |
|---|---|---|
| 1 | Load the page | Renders; no console errors |
| 2 | Press <kbd>Space</kbd> | Audio starts |
| 3 | Load each of the nine presets | Each applies without error |
| 4 | Export 2 patterns | A `.wav` downloads |
| 5 | Tab to a step cell, press <kbd>Enter</kbd> | The step toggles and focus stays |
| 6 | Open the export modal, press <kbd>Esc</kbd> | Closes; focus returns |
| 7 | Load with the network disabled | Works; fonts fall back |
| 8 | Verify the response headers | `Content-Type: text/html` |
| 9 | Check the CSP, if any | The inline script is permitted |
| 10 | Load in a private window | No cached state from a previous version |

---

*See also: [MAINTAINABILITY.md](MAINTAINABILITY.md) ·
[SECURITY.md](../SECURITY.md) · [TESTING.md](TESTING.md)*
