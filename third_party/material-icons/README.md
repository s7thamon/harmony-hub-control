# Material Icons

The web UI draws its icons with path data from Google's Material Icons
(filled and outlined styles), taken from the npm package
`@material-design-icons/svg` 0.14.15. These are the same glyphs the
Melodious Android app uses through Compose's `material-icons-extended`.

- Licence: Apache License 2.0 (`LICENSE` in this folder).
- Used by: `tools/webui-sim/public/js/ui/icons.js`, which is bundled into
  `codex_webui`.
- Only the icons the UI uses are kept. The `<path>` and `<circle>` data is
  unmodified.
