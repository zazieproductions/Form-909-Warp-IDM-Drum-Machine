# Security Policy

## Scope

Form 909-WARP is a client-side, single-file web application with **no server,
no accounts, no persistence and no network requests** beyond three webfonts.
The practical attack surface is therefore very small.

Nevertheless, client-side code can have real security issues — most plausibly
cross-site scripting through any future handling of untrusted input (imported
pattern files, URL-fragment state), or unsafe use of `innerHTML`.

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | ✅ |
| 1.0.x | ❌ |
| < 1.0 | ❌ |

Security fixes are released as patch versions on the latest minor line.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report privately using GitHub's private vulnerability reporting:
<https://github.com/zazieproductions/Form-909-Warp-IDM-Drum-Machine/security/advisories/new>

Include:

- A description of the issue and its impact
- Steps to reproduce, ideally with a minimal HTML file or a pattern document
- The browser and version affected
- Any suggested remediation

**What to expect:**

| Stage | Target |
|---|---|
| Acknowledgement | 7 days |
| Initial assessment | 14 days |
| Fix and release, or a decision with rationale | 30 days |

Credit is given on request in the release notes and the security advisory.

## Threat model

| Vector | Status | Notes |
|---|---|---|
| Server-side code execution | N/A | There is no server |
| Data exfiltration | N/A | No network requests carry user data |
| Persistence / stored XSS | N/A | No storage in v1.1. **This changes when pattern save/load ships** — see below |
| Third-party dependencies | Minimal | Zero runtime dependencies; three Google Fonts requests |
| Exported files | Out of scope | `.wav` files contain PCM data only and no executable content |
| Denial of service | Low | A pathological pattern can consume CPU. Recovery is a page reload |

## Forward-looking notes

Two planned features introduce the first meaningful client-side input surface:

- **Pattern import** ([roadmap](docs/ROADMAP.md#21-pattern-save-and-load)) will
  parse untrusted JSON. It must be schema-validated with strict bounds on every
  numeric field before being applied to state.
- **URL-fragment state** will decode untrusted data from the address bar. The
  same validation applies, and decoded values must never be interpolated into
  `innerHTML`.

Both must be reviewed with this in mind before merging.

## Dependencies

None at runtime. The three webfonts are the only external requests, loaded over
HTTPS from `fonts.googleapis.com` and `fonts.gstatic.com` with `preconnect`
hints. The application degrades gracefully if they are unavailable.

Self-hosting the fonts is tracked in the
[roadmap](docs/ROADMAP.md#34-self-hosted-fonts), which would remove the last
external request.
