# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-10-21

Documentation and tooling only; plugin behaviour is unchanged from 1.0.0.

### Added

- Screenshots of the pill and the breakdown panel, shown at the top of the README.
- `scripts/check.cjs`, which enforces the package contract: every exported entry
  point exists, the bundle patch names this package, the factory id equals the
  package name, no Harness Client package is imported, and the locale files parse.
- A `check` GitHub Actions workflow running those checks plus `node --check` on
  Node 20 and 22 for every push and pull request.
- An `npm run check` script for local runs.

### Changed

- The README documents all three install routes, the peak schedule, the rate
  cards, and what the figure cannot include.
- `package.json` ships `docs/*.png` so README images resolve from the npm page.

## [1.0.0] - 2026-10-21

### Added

- A pill under the composer showing the chat cost in CNY and the live DeepSeek
  peak/off-peak rate, opening a breakdown panel on click.
- Costs cover the whole chat tree, subagent Sessions included, and the panel
  splits this chat from its subagents.
- Two-decimal amounts whose parts always add up to the printed total.
- Rate changes rendered in Moscow time; currency and zone are constants.
