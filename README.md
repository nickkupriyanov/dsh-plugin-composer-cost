# dsh-plugin-composer-cost

A DSH Web UI plugin that adds one pill to `conversation.composer.dock` — the row
under the composer that already carries the built-in token statistics
(`StatsPills` in `dsh-client-ui-chat`) and the context meter.

The pill shows:

- `~¥1.00` — what this session has cost so far, in CNY;
- `Peak` / `Off-peak` — which DeepSeek tariff applies right now, with a coloured
  dot (amber = peak, green = off-peak).

Clicking it opens an anchored panel in the same style as the neighbouring
statistic pills: a portaled dialog above the trigger, closed by an outside
pointer or Escape. The panel lists the model, the tariff, each token bucket with
its applied per-million rate, the estimated total, and when the tariff next
changes — in Moscow time.

## Files

| File | Role |
| --- | --- |
| `package.json` | Bundle manifest: `dsh.bundle.patch` plus the `dsh.client` web half |
| `cordis.patch.yml` | Inserts the `composer-cost` loader row |
| `index.js` | Host half — intentionally empty |
| `client.js` | The pill, its panel, its styles, its dictionaries, and its slot registration |

## Peak schedule

Verified against <https://api-docs.deepseek.com/quick_start/pricing> on
2026-10-14.

| Window (UTC) | Rate |
| --- | --- |
| Monday–Friday 01:00–04:00 | peak |
| Monday–Friday 06:00–10:00 | peak |
| every other instant, including the whole weekend | off-peak, exactly 50 % of peak |

Chinese statutory public holidays are off-peak for the full day. The plugin
carries the official 2026 list (State Council notice 国办发明电〔2025〕7号).
The 2027 notice is published in early November 2026 — **add those dates to
`CN_HOLIDAYS` in `client.js` when it lands**, otherwise January 2027 will be
priced as if it were an ordinary week.

DeepSeek ignores 调休 (make-up working days): an adjusted working Saturday is
still a weekend and therefore off-peak.

All displayed wall-clock times use `Europe/Moscow` (fixed UTC+3), independent of
the browser's own time zone. Change `RATE_ZONE` in `client.js` to move it.

## Rates

`RATE_CARDS` in `client.js` holds one table per currency, both taken verbatim
from the published rate cards — DeepSeek rounds CNY and USD independently, so
neither is derived from the other. `DISPLAY_CURRENCY` selects the one shown; it
is `'CNY'` by default. Peak rates per 1,000,000 tokens:

| Currency | Model | Cache hit | Cache miss | Output |
| --- | --- | ---: | ---: | ---: |
| CNY | `deepseek-flash` | 0.04 | 2 | 8 |
| CNY | `deepseek-v4-pro` | 0.30 | 9 | 27 |
| USD | `deepseek-flash` | 0.006 | 0.30 | 1.20 |
| USD | `deepseek-v4-pro` | 0.044 | 1.32 | 3.96 |

Off-peak is half of each figure. Cache-write tokens are reported by the harness
but DeepSeek bills no separate cache-write rate, so they are listed and never
charged. Unknown and legacy model ids fall back to the `deepseek-flash` row.
Update these tables when DeepSeek changes its rate card.

## Scope: the whole chat tree

A subagent runs as its own Session with its own durable usage, billed to the same
account, so a per-session total alone under-reports what a chat cost. The pill
therefore sums the bound Session **and every subagent it spawned**, reading each
child Session `tokenUsage` and `modelSelection` projections from the session roster
(`useSessions` -> `projectionsBySession` / `byId`). The panel splits the figure into
**This chat** and **Subagents (n)** so the total stays explainable.

Verified against a real day: two top-level chats priced at CNY 1.1338 and 0.1458,
two subagent Sessions at 0.3472 and 0.1883, giving 1.8150 in the harness logs while
each pill on its own showed only 1.1338 and 0.1458.

## What the figure still cannot include

- **Session titles and web search.** Both are billed API calls that the log
  records as `session/title-llm-request` and `web/deepseek-search-llm-request` -
  requests only, with no usage attached, so no local computation can price them.
- **Other clients on the same account.** `platform.deepseek.com/usage` is
  account-wide; this pill is per chat.

## Comparing with the billing console

A console total and a sum of pills differ for two structural reasons.

1. **Scope.** A pill is the lifetime of one chat tree, not a day. A chat that
   ran across midnight keeps its whole total.
2. **The day boundary is Beijing time.** The console day starts at 00:00
   Beijing = 16:00 UTC of the previous day, so a session that ran at 00:01
   Beijing already belongs to "today" while a UTC-day total excludes it.

Measured on 2026-10-14 at 12:34 UTC by folding every session log on this
machine and pricing it at the off-peak CNY card:

| Window | Total |
| --- | ---: |
| UTC day, 2026-10-14 00:00Z to now | CNY 2.0752 |
| Beijing day, 2026-10-13 16:00Z to now | CNY 2.2944 |
| console reported | CNY 2.3300 |

The Beijing-day window lands within 1.5 % of the console; the residual is the
helper calls above. The UTC window is 11 % low only because two sessions that
ended at 16:06 and 16:11 UTC on 13 October (00:06 and 00:11 Beijing on the 14th)
fall inside the console day and outside the UTC one.

## Why the amount is still an estimate

The durable `tokenUsage` projection carries whole-session totals with no
per-request timestamps, so the cost is priced at the tariff in force at render
time. A session that spans a peak boundary lands between the peak and off-peak
figure; for a session that never crosses one, the number is exact. On the day
measured above every request fell between 11:38 and 12:16 UTC - outside both peak
windows - so the tariff approximation contributed nothing to the difference.
Making it exact in general needs a host-side session projection that folds usage
per `(model, peak | off-peak at event time)`; `dsh-session-stats` is a working
template for that.

## Rounding

Amounts print two decimals, the precision the billing console itself shows, and
each part is rounded before summing so **This chat + Subagents** always equals
the printed total. An amount that would round to zero prints `<¥0.01` rather
than claiming to be free. Per-million rates use two decimals as well, and fall
back to four only for sub-cent rows such as the USD cache-hit prices.

## Styling

The trigger and the panel copy the shipped `StatsPills` and `stat-dialog` CSS,
renamed under the `cc-` prefix, and reference only `--dsw-*` design tokens and
`--dsh-content-*` metrics. No Harness Client package is imported: the anchoring,
outside-pointer dismissal, Escape handling, and the coin glyph are implemented
here. `react-dom` is resolved defensively — if a shell cannot provide it, the
panel renders in place with fixed positioning instead of a portal.

## Install

Authored as an ordinary workspace package; install it into the profile with the
Harness `plugin_manager` tool (`action: install_bundle`) or the equivalent
profile wiring, then reload the page.
