# Pull request

## What

<!-- One paragraph. What changed. -->

## Why

<!-- One paragraph. The reasoning, or a link to the issue. -->

Closes #

## Type of change

- [ ] **Documentation** — no behaviour change
- [ ] **Interface** — layout, styling, labelling, interaction
- [ ] **Structural** — audio graph, scheduler, state model
- [ ] **Sonic** — a voice, the master bus, or a preset
- [ ] **Tooling** — validators, CI, dev server

## Testing

<!-- Which rows of the manual matrix in docs/TESTING.md §4 did you run? -->

- [ ] `npm run check` passes
- [ ] Runs from `file://` with no network
- [ ] All nine presets load without error
- [ ] Transport starts and stops cleanly
- [ ] Lane-length round-trip (16 → 7 → 16)
- [ ] The bounce still matches live playback
- [ ] Keyboard focus survives a step toggle
- [ ] Export modal opens, traps focus, restores focus on close
- [ ] Accessibility rows A1–A9 (for interface changes)

## For sonic changes

<!-- Which presets change, and how? All nine must be listened to before and after. -->

| Preset | Changes | How |
|---|---|---|

## For interface changes

<!-- Attach screenshots. -->

## Checklist

- [ ] No dependencies added
- [ ] No build step introduced
- [ ] Live and offline graphs remain in parity (invariant I5)
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] Documentation updated if behaviour changed
- [ ] Commit messages follow Conventional Commits
