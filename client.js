/**
 * Composer cost pill.
 *
 * Renders beside the built-in token statistics under the composer
 * (`conversation.composer.dock`, the slot `StatsPills` already occupies) and
 * shows two things:
 *
 *   1. what this session has cost so far, in CNY;
 *   2. whether DeepSeek is billing at peak rates right now.
 *
 * Clicking the pill opens the same kind of anchored dialog its neighbours use:
 * a portaled panel above the trigger, closed by an outside pointer or Escape.
 *
 * Peak / off-peak schedule, all instants UTC
 * (https://api-docs.deepseek.com/quick_start/pricing):
 *
 *   peak     Monday-Friday 01:00-04:00 and 06:00-10:00 UTC
 *            (= Beijing 09:00-12:00 and 14:00-18:00), excluding Chinese
 *            statutory public holidays;
 *   off-peak every other instant - including the whole weekend - at exactly
 *            half of the peak rate.
 *
 * The amount is an estimate: it prices the session's durable token totals
 * (`tokenUsage` projection) at the tariff in force *now*, because those totals
 * carry no per-request timestamps. A session that spans a rate change is
 * therefore approximate; the leading "~" says so.
 */
window.__ModuleLoader__.load({
	id: 'dsh-plugin-composer-cost',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		/**
		 * Portals keep the panel out of the composer's stacking context, the way
		 * the shipped stat dialogs do. Resolved defensively so a shell without
		 * `react-dom` degrades to an in-place fixed panel instead of failing.
		 */
		let createPortal = null;
		try {
			const reactDom = require('react-dom');
			if (reactDom !== null && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal;
		} catch (error) {
			createPortal = null;
		}

		/** Currency shown in the pill and the panel. */
		const DISPLAY_CURRENCY = 'CNY';

		/**
		 * Peak rates per 1,000,000 tokens, one table per billing currency.
		 *
		 * Both tables are the published rate cards, taken verbatim: DeepSeek
		 * rounds CNY and USD independently, so neither is derived from the other.
		 * `cacheMiss` prices uncached prompt tokens, `cacheHit` prices cache-read
		 * prompt tokens, `output` prices completion tokens. DeepSeek bills no
		 * separate cache-write rate, so `cacheWriteTokens` are listed but never
		 * charged.
		 */
		const RATE_CARDS = {
			CNY: {
				symbol: '¥',
				models: {
					'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
					'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 }
				}
			},
			USD: {
				symbol: '$',
				models: {
					'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 },
					'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 }
				}
			}
		};

		/** Price row used for a model id the card does not name. */
		const FALLBACK_MODEL_ID = 'deepseek-flash';

		/** Off-peak is exactly half of peak. */
		const OFF_PEAK_FACTOR = 0.5;

		/** Peak windows in UTC minutes from midnight, as [from, to). */
		const PEAK_WINDOWS_UTC = [[60, 240], [360, 600]];

		/** Zone every displayed wall-clock time is expressed in. */
		const RATE_ZONE = 'Europe/Moscow';

		/** Fallback offset for shells without `Intl` time zones. Moscow is a fixed UTC+3. */
		const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

		/** Panel clamp margin and trigger gap, matching the shipped stat dialog. */
		const PANEL_MARGIN = 12;
		const PANEL_GAP = 8;

		/** Laid-out but hidden: measures real panel size before the first placement. */
		const MEASURE_STYLE = { visibility: 'hidden', left: '0px', top: '0px' };

		/** Dictionary namespace owned by this plugin. */
		const NS = 'composer-cost';

		const en = {
			'cost.title': 'Session cost',
			'cost.estimated': 'estimate',
			'cost.peak': 'Peak',
			'cost.offPeak': 'Off-peak',
			'cost.model': 'Model',
			'cost.tariff': 'Tariff',
			'cost.peakRates': 'peak rates',
			'cost.offPeakRates': 'off-peak rates (−50%)',
			'cost.inMiss': 'Input (cache miss)',
			'cost.inHit': 'Input (cache hit)',
			'cost.inWrite': 'Input (cache write)',
			'cost.out': 'Output',
			'cost.total': 'Estimated total',
			'cost.thisChat': 'This chat',
			'cost.subagents': 'Subagents',
			'cost.nextChange': 'Rates change',
			'cost.zone': 'MSK',
			'cost.note': 'Durable token totals priced at the current tariff. Harness helper calls (session titles, web search) are not included.'
		};

		const zh = {
			'cost.title': '会话费用',
			'cost.estimated': '估算',
			'cost.peak': '高峰时段',
			'cost.offPeak': '优惠时段',
			'cost.model': '模型',
			'cost.tariff': '计费时段',
			'cost.peakRates': '高峰价格',
			'cost.offPeakRates': '优惠价格（五折）',
			'cost.inMiss': '输入（缓存未命中）',
			'cost.inHit': '输入（缓存命中）',
			'cost.inWrite': '输入（缓存写入）',
			'cost.out': '输出',
			'cost.total': '预估合计',
			'cost.thisChat': '本次会话',
			'cost.subagents': '子代理',
			'cost.nextChange': '价格变更',
			'cost.zone': '莫斯科时间',
			'cost.note': '按当前时段价格对持久化 token 累计估算；不含标题生成、联网搜索等辅助调用。'
		};

		/**
		 * Component styles, copied from the shipped `StatsPills` and
		 * `stat-dialog` modules and renamed under this plugin's prefix so nothing
		 * collides. Only `--dsw-*` tokens and `--dsh-content-*` metrics are shared.
		 */
		const CSS = [
			// trigger: the neighbouring pill
			'.cc-root{min-width:0;display:inline-flex}',
			'.cc-pill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}',
			'.cc-pill:hover,.cc-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.cc-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-text);outline-offset:2px}',
			'.cc-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
			'.cc-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
			'.cc-state{align-items:center;gap:5px;display:inline-flex}',
			'.cc-icon{flex:none;width:14px;height:14px}',
			'.cc-dot{flex:none;width:7px;height:7px;border-radius:999px;display:inline-block}',
			'.cc-dot[data-state=peak]{background:var(--dsw-alias-state-warn-primary,#e8a33d)}',
			'.cc-dot[data-state=off-peak]{background:var(--dsw-alias-state-success-primary,#3fa66a)}',
			// panel: the shipped stat dialog
			'.cc-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed}',
			'.cc-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}',
			'.cc-titleRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
			'.cc-titleValue{font-variant-numeric:tabular-nums}',
			'.cc-titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}',
			'.cc-titleLabel svg{flex:none;width:14px;height:14px}',
			'.cc-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}',
			'.cc-details dt,.cc-details dd{min-width:0;margin:0}',
			'.cc-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
			'.cc-note{color:var(--dsw-alias-label-tertiary);margin-top:10px;font-size:11px}'
		].join('');

		/**
		 * Chinese statutory public holidays, as UTC `YYYY-MM-DD`. A listed day is
		 * off-peak for its whole 24 hours.
		 *
		 * Peak windows never straddle a UTC date boundary (01:00-04:00 and
		 * 06:00-10:00 UTC are 09:00-12:00 and 14:00-18:00 Beijing on the same
		 * calendar day), so the UTC date is the correct key here.
		 */
		const CN_HOLIDAYS = new Set([
			// 元旦 New Year
			'2026-01-01', '2026-01-02', '2026-01-03',
			// 春节 Spring Festival
			'2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
			'2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
			// 清明节 Qingming
			'2026-04-04', '2026-04-05', '2026-04-06',
			// 劳动节 Labor Day
			'2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
			// 端午节 Dragon Boat
			'2026-06-19', '2026-06-20', '2026-06-21',
			// 中秋节 Mid-Autumn
			'2026-09-25', '2026-09-26', '2026-09-27',
			// 国庆节 National Day
			'2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
			'2026-10-06', '2026-10-07'
		]);

		/**
		 * Whether DeepSeek bills peak rates at one instant.
		 * @param ms - epoch milliseconds.
		 * @returns true during a weekday peak window outside Chinese holidays.
		 */
		function isPeakAt(ms) {
			const date = new Date(ms);
			const day = date.getUTCDay();
			if (day === 0 || day === 6) return false;
			const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
			let inWindow = false;
			for (const window of PEAK_WINDOWS_UTC) {
				if (minutes >= window[0] && minutes < window[1]) {
					inWindow = true;
					break;
				}
			}
			if (!inWindow) return false;
			return !CN_HOLIDAYS.has(date.toISOString().slice(0, 10));
		}

		/**
		 * The next instant the tariff changes, searching minute by minute.
		 * @param ms - epoch milliseconds to start from.
		 * @returns the boundary, or null when none is found within eight days.
		 */
		function nextTransition(ms) {
			const peak = isPeakAt(ms);
			const probe = new Date(Math.floor(ms / 60000) * 60000 + 60000);
			for (let step = 0; step < 8 * 24 * 60; step += 1) {
				if (isPeakAt(probe.getTime()) !== peak) {
					return { at: probe.getTime(), becomesPeak: !peak };
				}
				probe.setUTCMinutes(probe.getUTCMinutes() + 1);
			}
			return null;
		}

		/**
		 * Calendar day and wall-clock time of one instant in {@link RATE_ZONE}.
		 * @param ms - epoch milliseconds.
		 * @returns `{ date: 'DD.MM', time: 'HH:MM' }`.
		 */
		function zoneStamp(ms) {
			try {
				const parts = new Intl.DateTimeFormat('en-GB', {
					timeZone: RATE_ZONE,
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					hourCycle: 'h23'
				}).formatToParts(new Date(ms));
				const pick = (type) => {
					for (const part of parts) {
						if (part.type === type) return part.value;
					}
					return '';
				};
				return { date: pick('day') + '.' + pick('month'), time: pick('hour') + ':' + pick('minute') };
			} catch (error) {
				const shifted = new Date(ms + MOSCOW_OFFSET_MS);
				return {
					date: String(shifted.getUTCDate()).padStart(2, '0') + '.' + String(shifted.getUTCMonth() + 1).padStart(2, '0'),
					time: String(shifted.getUTCHours()).padStart(2, '0') + ':' + String(shifted.getUTCMinutes()).padStart(2, '0')
				};
			}
		}

		/**
		 * Wall-clock text for a boundary in {@link RATE_ZONE}, carrying the date
		 * only when the boundary falls on a later local day.
		 * @param at - the boundary instant.
		 * @param now - the render instant.
		 * @returns display text.
		 */
		function zoneBoundary(at, now) {
			const boundary = zoneStamp(at);
			const today = zoneStamp(now);
			return boundary.date === today.date ? boundary.time : boundary.time + ' (' + boundary.date + ')';
		}

		/**
		 * Peak rates for a model id, tolerating legacy and unknown ids.
		 * @param modelId - the session's selected model id.
		 * @returns the peak rate row, never undefined.
		 */
		function rowFor(modelId) {
			const models = RATE_CARDS[DISPLAY_CURRENCY].models;
			if (typeof modelId === 'string') {
				if (models[modelId] !== undefined) return models[modelId];
				if (modelId.indexOf('pro') >= 0) return models['deepseek-v4-pro'];
			}
			return models[FALLBACK_MODEL_ID];
		}

		/** Coerce an optional projected count to a non-negative number. */
		function count(value) {
			return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
		}

		/** Group-separated token count. */
		function tokens(value) {
			return Math.round(value).toLocaleString('en-US');
		}

		/**
		 * Currency text rounded to two decimals, the precision the billing
		 * console itself shows. An amount that would round to zero keeps a
		 * lower bound instead of claiming to be free.
		 */
		function money(value, symbol) {
			if (!Number.isFinite(value) || value <= 0) return symbol + '0.00';
			if (value < 0.005) return '<' + symbol + '0.01';
			return symbol + value.toFixed(2);
		}

		/**
		 * Per-million rate text: two decimals for ordinary rates, more only for
		 * sub-cent ones such as the USD cache-hit rows.
		 */
		function rate(value, symbol) {
			const fixed = value >= 0.01 ? value.toFixed(2) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
			return symbol + fixed + '/M';
		}

		/** The coin glyph the trigger and the panel title share. */
		function coinIcon() {
			return h('svg', { viewBox: '0 0 16 16', 'aria-hidden': true, className: 'cc-icon' },
				h('circle', { cx: 8, cy: 8, r: 6.25, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
				h('path', {
					d: 'M8 4.9v6.2M5.8 7.3h4.4M5.8 9.5h4.4',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round'
				})
			);
		}

		/**
		 * Trigger anchoring and light dismissal, the parts the shipped dialog
		 * borrows from `ui-primitives` and this plugin therefore implements
		 * itself.
		 * @param open - whether the panel is mounted.
		 * @param setOpen - closes the panel.
		 * @returns the two refs and the clamped placement, null until measured.
		 */
		function usePanelSeat(open, setOpen) {
			const rootRef = React.useRef(null);
			const panelRef = React.useRef(null);
			const [pos, setPos] = React.useState(null);

			React.useLayoutEffect(() => {
				if (!open) {
					setPos(null);
					return undefined;
				}
				const place = () => {
					const anchor = rootRef.current;
					const panel = panelRef.current;
					if (anchor === null || panel === null) return;
					const a = anchor.getBoundingClientRect();
					const p = panel.getBoundingClientRect();
					const width = window.innerWidth;
					const height = window.innerHeight;
					let left = a.left + a.width / 2 - p.width / 2;
					left = Math.max(PANEL_MARGIN, Math.min(left, width - p.width - PANEL_MARGIN));
					let top = a.top - p.height - PANEL_GAP;
					if (top < PANEL_MARGIN) top = Math.min(a.bottom + PANEL_GAP, height - p.height - PANEL_MARGIN);
					setPos({ left: Math.round(left) + 'px', top: Math.round(Math.max(PANEL_MARGIN, top)) + 'px' });
				};
				place();
				window.addEventListener('resize', place);
				window.addEventListener('scroll', place, true);
				return () => {
					window.removeEventListener('resize', place);
					window.removeEventListener('scroll', place, true);
				};
			}, [open]);

			React.useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const root = rootRef.current;
					const panel = panelRef.current;
					if (root !== null && root.contains(event.target)) return;
					if (panel !== null && panel.contains(event.target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === 'Escape') setOpen(false);
				};
				document.addEventListener('pointerdown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown);
				return () => {
					document.removeEventListener('pointerdown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown);
				};
			}, [open, setOpen]);

			return { rootRef, panelRef, pos };
		}

		/**
		 * The pill and its panel. Reads the two durable session projections the
		 * Host already publishes and keeps its own clock for the rate window.
		 * @param props - slot props carrying the session standard kit.
		 */
		/**
		 * One projection value for one session, read from whichever roster face
		 * carries it: the client keeps per-session projection values both beside
		 * the session summary and in the projection store.
		 * @returns the value, or undefined when that session publishes none.
		 */
		function pickValue(projections, byId, id, key) {
			const entry = byId[id];
			const summaryValues = entry !== undefined && entry !== null ? entry.projectionValues : undefined;
			if (summaryValues !== undefined && summaryValues !== null && summaryValues[key] !== undefined) return summaryValues[key];
			const snapshot = projections[id];
			const values = snapshot !== undefined && snapshot.values !== undefined ? snapshot.values : undefined;
			return values === undefined ? undefined : values[key];
		}

		/** Session ids of one chat tree: the bound session first, then its subagents breadth-first. */
		function collectTree(rootId, projections, byId) {
			const ids = [];
			const seen = new Set();
			const queue = typeof rootId === 'string' ? [rootId] : [];
			while (queue.length > 0 && ids.length < 200) {
				const id = queue.shift();
				if (typeof id !== 'string' || seen.has(id)) continue;
				seen.add(id);
				ids.push(id);
				const catalog = pickValue(projections, byId, id, 'subagentCatalog');
				if (Array.isArray(catalog)) {
					for (const entry of catalog) {
						if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') queue.push(entry.id);
					}
				}
			}
			return ids;
		}

		/**
		 * One session's durable token buckets.
		 * @returns the buckets, or null while that session's projection is absent.
		 */
		function sessionBuckets(projections, byId, id) {
			const usage = pickValue(projections, byId, id, 'tokenUsage');
			if (usage === undefined || usage === null) return null;
			return {
				cacheMiss: count(usage.uncachedInputTokens),
				cacheHit: count(usage.cacheReadTokens),
				cacheWrite: count(usage.cacheWriteTokens),
				output: count(usage.outputTokens)
			};
		}

		/** One session's selected model id, or the fallback when it publishes none. */
		function sessionModel(projections, byId, id) {
			const selection = pickValue(projections, byId, id, 'modelSelection');
			const next = selection !== undefined && selection !== null ? selection.next : undefined;
			if (next !== undefined && next !== null && typeof next.model === 'string') return next.model;
			const lastUsed = selection !== undefined && selection !== null ? selection.lastUsed : undefined;
			if (lastUsed !== undefined && lastUsed !== null && typeof lastUsed.model === 'string') return lastUsed.model;
			return FALLBACK_MODEL_ID;
		}

		/** Currency amount for one session's buckets at the given tariff factor. */
		function sessionCost(buckets, modelId, factor) {
			const price = rowFor(modelId);
			return ((buckets.cacheMiss * price.cacheMiss) + (buckets.cacheHit * price.cacheHit) + (buckets.output * price.output)) * factor / 1e6;
		}

		/**
		 * The pill and its panel.
		 *
		 * The amount covers the whole chat tree: the bound session plus every
		 * subagent it spawned, because a subagent runs as its own Session with
		 * its own durable usage and is billed to the same account. Their
		 * projections arrive through the session roster.
		 * @param props - slot props carrying the session standard kit.
		 */
		function ComposerCost(props) {
			const useProjection = props.useProjection;
			const useSessions = props.useSessions;
			const t = props.t;
			const sessionId = props.sessionId;
			const usage = useProjection('tokenUsage');
			const selection = useProjection('modelSelection');
			const projections = useSessions((state) => state.projectionsBySession);
			const byId = useSessions((state) => state.byId);
			const [nowMs, setNowMs] = React.useState(Date.now);
			const [open, setOpen] = React.useState(false);
			const seat = usePanelSeat(open, setOpen);

			React.useEffect(() => {
				const timer = window.setInterval(() => setNowMs(Date.now()), 15000);
				return () => window.clearInterval(timer);
			}, []);

			const minuteMs = Math.floor(nowMs / 60000) * 60000;
			const peak = React.useMemo(() => isPeakAt(minuteMs), [minuteMs]);
			const next = React.useMemo(() => nextTransition(minuteMs), [minuteMs]);
			const tree = React.useMemo(() => collectTree(sessionId, projections, byId), [sessionId, projections, byId]);
			if (usage === undefined) return null;

			const tr = (key, fallback) => {
				if (typeof t !== 'function') return fallback;
				try {
					const value = t(key);
					return typeof value === 'string' && value.length > 0 && value !== key ? value : fallback;
				} catch (error) {
					return fallback;
				}
			};

			const card = RATE_CARDS[DISPLAY_CURRENCY];
			const symbol = card.symbol;
			const selected = selection !== undefined && selection !== null ? selection.next : undefined;
			const ownModel = selected !== undefined && selected !== null && typeof selected.model === 'string'
				? selected.model
				: FALLBACK_MODEL_ID;
			const own = {
				cacheMiss: count(usage.uncachedInputTokens),
				cacheHit: count(usage.cacheReadTokens),
				cacheWrite: count(usage.cacheWriteTokens),
				output: count(usage.outputTokens)
			};
			const factor = peak ? 1 : OFF_PEAK_FACTOR;
			const ownCost = sessionCost(own, ownModel, factor);

			const combined = { cacheMiss: own.cacheMiss, cacheHit: own.cacheHit, cacheWrite: own.cacheWrite, output: own.output };
			const models = [ownModel];
			let childCost = 0;
			let childCount = 0;
			for (let index = 1; index < tree.length; index += 1) {
				const buckets = sessionBuckets(projections, byId, tree[index]);
				if (buckets === null) continue;
				const modelId = sessionModel(projections, byId, tree[index]);
				childCost += sessionCost(buckets, modelId, factor);
				childCount += 1;
				if (models.indexOf(modelId) < 0) models.push(modelId);
				combined.cacheMiss += buckets.cacheMiss;
				combined.cacheHit += buckets.cacheHit;
				combined.cacheWrite += buckets.cacheWrite;
				combined.output += buckets.output;
			}

			// Round each part before summing: two displayed parts that do not add
			// up to the displayed total read as an arithmetic error, while a
			// sub-cent part keeps its lower bound so it never claims to be free.
			const ownShown = ownCost < 0.005 ? ownCost : Math.round(ownCost * 100) / 100;
			const childShown = childCost < 0.005 ? childCost : Math.round(childCost * 100) / 100;
			const amount = money(ownShown + childShown, symbol);
			const uniformModel = models.length === 1;
			const stateText = peak ? tr('cost.peak', 'Peak') : tr('cost.offPeak', 'Off-peak');
			const tariffText = peak ? tr('cost.peakRates', 'peak rates') : tr('cost.offPeakRates', 'off-peak rates (−50%)');
			const nextText = next === null
				? null
				: (next.becomesPeak ? tr('cost.peak', 'Peak') : tr('cost.offPeak', 'Off-peak'))
					+ ' ' + zoneBoundary(next.at, minuteMs) + ' ' + tr('cost.zone', 'MSK');
			const label = amount + ' ' + stateText + (nextText === null ? '' : ', ' + tr('cost.nextChange', 'Rates change') + ' ' + nextText);

			const ownPrice = rowFor(ownModel);
			const rateText = (value) => (uniformModel ? ' × ' + rate(value * factor, symbol) : '');
			const rows = [
				[tr('cost.model', 'Model'), models.join(', ')],
				[tr('cost.tariff', 'Tariff'), tariffText],
				[tr('cost.inMiss', 'Input (cache miss)'), tokens(combined.cacheMiss) + rateText(ownPrice.cacheMiss)],
				[tr('cost.inHit', 'Input (cache hit)'), tokens(combined.cacheHit) + rateText(ownPrice.cacheHit)],
				[tr('cost.out', 'Output'), tokens(combined.output) + rateText(ownPrice.output)]
			];
			if (combined.cacheWrite > 0) rows.splice(4, 0, [tr('cost.inWrite', 'Input (cache write)'), tokens(combined.cacheWrite) + ' × ' + rate(0, symbol)]);
			if (childCount > 0) {
				rows.push([tr('cost.thisChat', 'This chat'), money(ownShown, symbol)]);
				rows.push([tr('cost.subagents', 'Subagents') + ' (' + childCount + ')', money(childShown, symbol)]);
			}
			rows.push([tr('cost.total', 'Estimated total'), amount]);
			if (nextText !== null) rows.push([tr('cost.nextChange', 'Rates change'), nextText]);

			const panel = h('div', {
				ref: seat.panelRef,
				className: 'cc-panel',
				role: 'dialog',
				'aria-label': tr('cost.title', 'Session cost'),
				style: seat.pos === null ? MEASURE_STYLE : seat.pos
			},
				h('div', { className: 'cc-title' },
					h('span', { className: 'cc-titleLabel' }, coinIcon(), tr('cost.title', 'Session cost')),
					h('span', { className: 'cc-titleValue' }, amount)
				),
				h('div', { className: 'cc-titleRule', 'aria-hidden': true }),
				h('dl', { className: 'cc-details' },
					rows.map((row) => h(React.Fragment, { key: row[0] },
						h('dt', null, row[0]),
						h('dd', null, row[1])
					))
				),
				h('div', { className: 'cc-note' }, tr('cost.note', 'Durable token totals priced at the current tariff.'))
			);

			return h('span', { className: 'cc-root', ref: seat.rootRef },
				h('button', {
					type: 'button',
					className: 'cc-pill',
					'aria-haspopup': 'dialog',
					'aria-expanded': open,
					'aria-label': label,
					onClick: () => setOpen(!open)
				},
					coinIcon(),
					h('span', { className: 'cc-label' }, '~' + amount),
					h('span', { className: 'cc-sep', 'aria-hidden': true }, '·'),
					h('span', { className: 'cc-state' },
						h('span', { className: 'cc-dot', 'data-state': peak ? 'peak' : 'off-peak', 'aria-hidden': true }),
						stateText
					)
				),
				open ? (createPortal === null ? panel : createPortal(panel, document.body)) : null
			);
		}

		/**
		 * Client plugin body: own the copy in one locale namespace and contribute
		 * the pill beside the built-in composer statistics.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'composer-cost: dictionaries');
			ctx.effect(() => {
				if (typeof document === 'undefined') return () => {};
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-plugin-composer-cost';
				tag.dataset.pluginCss = 'dsh-plugin-composer-cost/composer-cost.css';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => { tag.remove(); };
			}, 'composer-cost: styles');
			ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
				name: 'conversation.composer.dock',
				id: 'composer-cost',
				order: 10,
				locale: NS
			}, ComposerCost));
		}

		return {
			inject: ['slots', 'locale'],
			apply
		};
	}
});
