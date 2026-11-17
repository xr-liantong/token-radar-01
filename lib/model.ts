// Token Radar model, version radar-1.0 (Node 22, no dependencies).
// Model: parses the snapshot and scores, ranks and gates the pre-token board.
//
//   parseSnapshot(raw)        sealed snapshot text -> validated Snapshot, or SnapshotError
//   buildRadar(snapshot)      Snapshot -> ranked board rows + the dashboard's RadarData
//   boardIssue(board, snap)    the gate's invariants; null means the board may be written
//   dataScript(radar)         RadarData -> the `window.RADAR = ...;` file the page loads
//
// The value of a pre-token protocol is one function of snapshot fields, never of its name:
//   growth   = 1 + growth_weight * clamp(change_7d, growth_floor, growth_cap) / 100
//   maturity = maturity_floor + (min(age_days, maturity_days) / maturity_days) * maturity_range
//   implied  = max(1, round(tvl_usd * base_multiple * growth * maturity))
// Every derived number is rounded at the point it is written, so two runs write the same bytes.

const DAY_MS = 86_400_000;

/** Early candidates are pre-token protocols with this much TVL, ranked below the watchlist. */
const FLOOR_USD = 5_000_000;
const MAX_EARLY_ROWS = 160;

/** Board shape the gate accepts (reference/gate.json). */
const MIN_BOARD_ROWS = 100;
const MAX_BOARD_ROWS = 4_000;
const MIN_FARM_STEPS = 3;
const MAX_FARM_STEPS = 12;
const MIN_STEP_CHARS = 20;
const MAX_STEP_CHARS = 600;
const MAX_IMPLIED_USD = 100_000_000_000_000;

/** Categories that are a wrapper, a bridge or a venue rather than a protocol that can launch. */
const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_cap: number;
  growth_floor: number;
  growth_weight: number;
  maturity_floor: number;
  maturity_days: number;
  maturity_range: number;
  unknown_age_days: number;
}

export interface DisqualifierCheck {
  category: string | null;
  category_excluded: boolean;
  version_marker: boolean;
  wrapped_staked_word: boolean;
  exchange_prefix: boolean;
  parent_protocol: string;
  visible_reasons: string[];
  verdict: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  watchlist_member: boolean;
  age_days: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  why_no_token: string;
  disqualifier_check: DisqualifierCheck;
  value_model: ModelConstants;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  mcap_usd: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
  why_no_token: string;
  disqualifier_check: DisqualifierCheck;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  early_size: number;
  board_size: number;
  live_size: number;
  model: ModelConstants;
  rows: RadarRow[];
  live: LiveRow[];
}

export interface RadarBundle {
  board: BoardRow[];
  radar: RadarData;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_cap: 100,
  growth_floor: -50,
  growth_weight: 0.35,
  maturity_floor: 0.55,
  maturity_days: 1200,
  maturity_range: 0.45,
  unknown_age_days: 365,
};

export const MODEL_VERSION = "radar-1.0";

// --- snapshot parsing -------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new SnapshotError(`${field} is not a non-empty string`);
  return value;
}

function textOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  return text(value, field);
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SnapshotError(`${field} is not a finite number`);
  return value;
}

function numberOrNull(value: unknown, field: string): number | null {
  if (value === null) return null;
  return numberValue(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new SnapshotError(`${field} is not a string array`);
  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item: unknown = value[index];
    if (typeof item !== "string") throw new SnapshotError(`${field} is not a string array`);
    items.push(item);
  }
  return items;
}

/** One protocol record; `at` prefixes every error, as `protocols[7].tvl_usd`. */
function parseProtocol(item: unknown, at: string): SnapshotProtocol {
  const row = asRecord(item);
  if (row === null) throw new SnapshotError(`${at} is not an object`);
  return {
    slug: text(row.slug, `${at}.slug`),
    name: text(row.name, `${at}.name`),
    category: textOrNull(row.category, `${at}.category`),
    chains: stringArray(row.chains, `${at}.chains`),
    tvl_usd: numberValue(row.tvl_usd, `${at}.tvl_usd`),
    change_7d: numberOrNull(row.change_7d, `${at}.change_7d`),
    mcap_usd: numberOrNull(row.mcap_usd, `${at}.mcap_usd`),
    listed_at: textOrNull(row.listed_at, `${at}.listed_at`),
    gecko_id: textOrNull(row.gecko_id, `${at}.gecko_id`),
    symbol: textOrNull(row.symbol, `${at}.symbol`),
  };
}

function parseProtocols(value: unknown): SnapshotProtocol[] {
  if (!Array.isArray(value)) throw new SnapshotError("protocols is not an array");
  return value.map((item, index) => parseProtocol(item, `protocols[${index}]`));
}

function parseWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) throw new SnapshotError("watchlist is not an array");
  return value.map((slug, index) => text(slug, `watchlist[${index}]`));
}

export function parseSnapshot(raw: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown parse error";
    throw new SnapshotError(`snapshot is not JSON: ${cause}`);
  }
  const root = asRecord(parsed);
  if (root === null) throw new SnapshotError("snapshot is not an object");
  const asOf = text(root.as_of, "as_of");
  if (!Number.isFinite(Date.parse(`${asOf}T00:00:00Z`))) throw new SnapshotError("as_of is not YYYY-MM-DD");
  const source = text(root.source, "source");
  const floor = numberValue(root.floor_usd, "floor_usd");
  if (floor <= 0) throw new SnapshotError("floor_usd is not positive");
  return {
    as_of: asOf,
    source,
    floor_usd: floor,
    protocols: parseProtocols(root.protocols),
    watchlist: parseWatchlist(root.watchlist),
  };
}

// --- shared helpers ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function byText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(listed)) return null;
  return Math.max(0, Math.floor((start - listed) / DAY_MS));
}

function holdsNoToken(protocol: SnapshotProtocol): boolean {
  return protocol.gecko_id === null && protocol.symbol === null;
}

function visibleReasons(protocol: SnapshotProtocol): string[] {
  const reasons: string[] = [];
  if (protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category)) reasons.push(`category:${protocol.category}`);
  if (VERSION_MARKER.test(protocol.name)) reasons.push("name:version-marker");
  if (WRAPPED_WORD.test(protocol.name)) reasons.push("name:wrapped-or-staked-word");
  if (EXCHANGE_PREFIX.test(protocol.name)) reasons.push("name:exchange-prefix");
  return reasons;
}

function chainOf(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0] : "its main chain";
}

// --- farm plans -------------------------------------------------------------------------------

function capitalFor(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 250;
  if (protocol.tvl_usd >= 1_000_000_000) return 150;
  if (protocol.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function fmtUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function fmtPct(value: number | null): string {
  if (value === null) return "n/a";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function marketFacts(protocol: SnapshotProtocol): string {
  return `TVL ${fmtUsd(protocol.tvl_usd)}, 7d ${fmtPct(protocol.change_7d)}`;
}

interface CategoryPlan {
  action: string;
  weekly: string;
}

function matchesCategory(category: string, needles: string[]): boolean {
  for (const needle of needles) if (category.includes(needle)) return true;
  return false;
}

/** The mechanism, cost and time a farm of this category uses; the first matching rule wins. */
function categoryPlan(protocol: SnapshotProtocol, capital: number): CategoryPlan {
  const category = (protocol.category ?? "").toLowerCase();
  const chain = chainOf(protocol);
  const name = protocol.name;
  const facts = marketFacts(protocol);
  if (category.includes("restak")) {
    return {
      action: `Stake $${capital} of ${chain}'s staking asset through ${name} (${facts}), take the liquid receipt, then restake that receipt into an active AVS.`,
      weekly: "Check AVS rewards and slash risk weekly, claim rewards, and keep the receipt liquid. Cost: $1-3 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (matchesCategory(category, ["staking", "staking pool"])) {
    return {
      action: `Stake $${capital} of ${chain}'s staking asset through ${name} (${facts}), mint the liquid staking receipt, and hold both the receipt and the reward record.`,
      weekly: "Check the validator set, rewards and unstaking queue weekly; claim only from the protocol's own page. Cost: $1-3 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (matchesCategory(category, ["cdp", "collateral"])) {
    return {
      action: `Deposit $${capital} of blue-chip collateral into ${name} on ${chain} (${facts}), mint 25-35% of its value in the protocol stable, and keep the collateral ratio above 160%.`,
      weekly: "Repay a little or add collateral weekly to keep the ratio safe, and check the stability fee. Cost: $2-4 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (category.includes("lend")) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain} (${facts}) as collateral, then borrow 30-40% against it and keep the health factor above 1.5.`,
      weekly: "Borrow or repay a small amount weekly to create activity, and check the health factor. Cost: $2-4 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (matchesCategory(category, ["dex", "liquidity manager", "leveraged"])) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} (${facts}) inside a range around the current price; collect fees and rebalance when the price leaves the range.`,
      weekly: "Rebalance the range or compound fees weekly, and record the pool's fee tier and volume. Cost: $2-5 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (matchesCategory(category, ["derivative", "perpetual", "basis", "interest rate"])) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} (${facts}), open one small hedge, and keep leverage below 2x.`,
      weekly: "Check funding, margin and liquidation price every few days; roll or reduce the hedge weekly. Cost: $2-5 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (category.includes("prediction")) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} (${facts}), buy the side with the tightest spread, and hold to settlement or exit at the quoted bid.`,
      weekly: "Mark the position to the quoted bid and exit if the edge closes; claim winnings only on the protocol. Cost: $1-3 of gas a week. Time: 10 minutes a week.",
    };
  }
  if (category.includes("rwa")) {
    return {
      action: `Mint or subscribe $${capital} of ${name}'s yield asset on ${chain} (${facts}); confirm eligibility, redemption window and transfer limits before locking capital.`,
      weekly: "Check NAV, redemption window and transfer limits weekly; do not proceed with any identity step you cannot complete yourself. Cost: $0-2. Time: 10 minutes a week.",
    };
  }
  if (category.includes("insurance")) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} (${facts}); check the covered event, waiting period and claim conditions before paying the premium.`,
      weekly: "Review the covered event and policy status weekly; claim only through the protocol's own process. Cost: $0-2. Time: 10 minutes a week.",
    };
  }
  if (matchesCategory(category, ["curator", "allocator"])) {
    return {
      action: `Deposit $${capital} into a ${name} curated vault on ${chain} (${facts}); read the curator fee, allocation caps and exit queue before entering.`,
      weekly: "Check the curator report, allocation changes and exit queue weekly; keep the vault shares. Cost: $0-2. Time: 10 minutes a week.",
    };
  }
  if (category.includes("stable")) {
    return {
      action: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} (${facts}); check the peg, collateral and redemption path before entering.`,
      weekly: "Check the peg and redemption path weekly; repay or unwind if the peg moves. Cost: $1-3. Time: 10 minutes a week.",
    };
  }
  if (category.includes("bridge")) {
    return {
      action: `Bridge $${capital} of USDC to ${chain} through ${name} (${facts}), then use the funds in the destination app; compare the fee with a native bridge first.`,
      weekly: "Check the bridge's finality and destination balance weekly; move only what you will use. Cost: $2-5. Time: 10 minutes a week.",
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} (${facts}); confirm the withdrawal path and lock terms before entering.`,
    weekly: "Make one qualifying deposit, borrow, swap or vote weekly; check the withdrawal path. Cost: $2-4 of gas a week. Time: 10 minutes a week.",
  };
}

/** Six steps: wallet and gas, the category mechanism, the weekly action, the hold, the claim, the log. */
function farmSteps(protocol: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(protocol);
  const capital = capitalFor(protocol);
  const hold = holdDaysFor(age);
  const plan = categoryPlan(protocol, capital);
  const gasIfOpening = capital >= 150 ? 8 : 4;
  return [
    `Open ${protocol.name} on ${chain} with ${marketFacts(protocol)} in a dedicated wallet funded only with the farm capital; keep the recovery phrase offline. Cost: about $3-5 of gas for the first transaction. Time: 10 minutes.`,
    `${plan.action} Cost: $${capital} of capital plus about $${gasIfOpening} of gas. Time: 15 minutes to set up.`,
    plan.weekly,
    `Keep the position for at least ${hold} days so it appears in more than one snapshot. Cost: the $${capital} stays at risk in the position. Time: ${hold} days.`,
    `Check ${protocol.name}'s own site for a points or launch page and claim only there; never pay to claim. Cost: $0. Time: 10 minutes.`,
    `Log the wallet, dates, transaction hashes and an exit trigger so the position can be repeated or unwound. Cost: $0. Time: 5 minutes.`,
  ];
}

// --- scoring and rows -------------------------------------------------------------------------

interface Scored {
  protocol: SnapshotProtocol;
  age: number | null;
  growthMultiplier: number;
  maturityMultiplier: number;
  implied: number;
}

function scoreProtocol(protocol: SnapshotProtocol, asOf: string): Scored {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = protocol.change_7d ?? 0;
  const growthMultiplier = 1 + MODEL.growth_weight * (clamp(growthPct, MODEL.growth_floor, MODEL.growth_cap) / 100);
  const modelAge = age === null ? MODEL.unknown_age_days : Math.max(age, 0);
  const maturityMultiplier =
    MODEL.maturity_floor + (Math.min(modelAge, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * MODEL.base_multiple * growthMultiplier * maturityMultiplier));
  return { protocol, age, growthMultiplier, maturityMultiplier, implied };
}

function disqualifierOf(protocol: SnapshotProtocol, reasons: string[], onWatchlist: boolean): DisqualifierCheck {
  // The watchlist is the house's call; a below-floor protocol is shown only if no visible check trips.
  let verdict: string;
  if (onWatchlist) verdict = "house-watchlist (authoritative)";
  else if (reasons.length === 0) verdict = "below-floor visible checks pass";
  else verdict = "visible disqualifier";
  return {
    category: protocol.category,
    category_excluded: protocol.category !== null && EXCLUDED_CATEGORIES.has(protocol.category),
    version_marker: VERSION_MARKER.test(protocol.name),
    wrapped_staked_word: WRAPPED_WORD.test(protocol.name),
    exchange_prefix: EXCHANGE_PREFIX.test(protocol.name),
    parent_protocol: "not in snapshot",
    visible_reasons: reasons,
    verdict,
  };
}

function toBoardRow(scored: Scored, rank: number, watchlist: ReadonlySet<string>): BoardRow {
  const protocol = scored.protocol;
  const member = watchlist.has(protocol.slug);
  return {
    rank,
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    mcap_usd: protocol.mcap_usd,
    listed_at: protocol.listed_at,
    gecko_id: protocol.gecko_id,
    symbol: protocol.symbol,
    token_status: "pre-token (snapshot records no token)",
    watchlist_member: member,
    age_days: scored.age,
    growth_multiplier: round4(scored.growthMultiplier),
    maturity_multiplier: round4(scored.maturityMultiplier),
    why_no_token: `snapshot.json records gecko_id=${protocol.gecko_id}, symbol=${protocol.symbol}, mcap_usd=${protocol.mcap_usd}: the DefiLlama record carries no token, which is not proof the protocol has none.`,
    disqualifier_check: disqualifierOf(protocol, visibleReasons(protocol), member),
    value_model: MODEL,
    implied_value_usd: scored.implied,
    farm_steps: farmSteps(protocol, scored.age),
  };
}

function indexProtocols(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const bySlug = new Map<string, SnapshotProtocol>();
  for (const protocol of protocols) {
    if (bySlug.has(protocol.slug)) throw new SnapshotError(`duplicate protocol slug ${protocol.slug}`);
    bySlug.set(protocol.slug, protocol);
  }
  return bySlug;
}

function lookupProtocol(bySlug: ReadonlyMap<string, SnapshotProtocol>, slug: string): SnapshotProtocol {
  const protocol = bySlug.get(slug);
  if (protocol === undefined) throw new SnapshotError(`watchlist slug ${slug} is not in protocols`);
  return protocol;
}

/** Watchlist first, then the largest below-floor pre-token protocols that pass every visible check. */
function collectChosen(snapshot: Snapshot, bySlug: ReadonlyMap<string, SnapshotProtocol>): Map<string, SnapshotProtocol> {
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) chosen.set(slug, lookupProtocol(bySlug, slug));
  const early = snapshot.protocols.filter((protocol) => {
    if (chosen.has(protocol.slug)) return false;
    if (!holdsNoToken(protocol)) return false;
    if (protocol.tvl_usd < FLOOR_USD) return false;
    if (protocol.tvl_usd >= snapshot.floor_usd) return false;
    return visibleReasons(protocol).length === 0;
  });
  early.sort((a, b) => b.tvl_usd - a.tvl_usd || byText(a.slug, b.slug));
  for (const protocol of early.slice(0, MAX_EARLY_ROWS)) chosen.set(protocol.slug, protocol);
  return chosen;
}

/** Implied value first, then TVL, then slug: a total order, so ranks never depend on input order. */
function rankScored(scored: Scored[]): Scored[] {
  return scored.sort(
    (a, b) => b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || byText(a.protocol.slug, b.protocol.slug),
  );
}

function liveRows(protocols: SnapshotProtocol[]): LiveRow[] {
  const live = protocols.filter((protocol) => !holdsNoToken(protocol));
  live.sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || byText(a.slug, b.slug));
  return live.map((protocol) => ({
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    change_7d: protocol.change_7d,
    mcap_usd: protocol.mcap_usd,
    gecko_id: protocol.gecko_id,
    symbol: protocol.symbol,
  }));
}

function toRadarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    mcap_usd: row.mcap_usd,
    growth_multiplier: row.growth_multiplier,
    maturity_multiplier: row.maturity_multiplier,
    farm_steps: row.farm_steps,
    why_no_token: row.why_no_token,
    disqualifier_check: row.disqualifier_check,
  };
}

export function buildRadar(snapshot: Snapshot): RadarBundle {
  const bySlug = indexProtocols(snapshot.protocols);
  const watchlist: ReadonlySet<string> = new Set(snapshot.watchlist);
  const chosen = collectChosen(snapshot, bySlug);
  const scored = rankScored([...chosen.values()].map((protocol) => scoreProtocol(protocol, snapshot.as_of)));
  const board = scored.map((item, index) => toBoardRow(item, index + 1, watchlist));
  const live = liveRows(snapshot.protocols);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    early_size: board.filter((row) => !watchlist.has(row.slug)).length,
    board_size: board.length,
    live_size: live.length,
    model: MODEL,
    rows: board.map((row) => toRadarRow(row)),
    live,
  };
  return { board, radar };
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// --- board gate -------------------------------------------------------------------------------

function stepIssue(row: BoardRow): string | null {
  if (!Array.isArray(row.farm_steps) || row.farm_steps.length < MIN_FARM_STEPS || row.farm_steps.length > MAX_FARM_STEPS) {
    return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
  }
  for (const step of row.farm_steps) {
    const length = step.trim().length;
    if (length < MIN_STEP_CHARS || length > MAX_STEP_CHARS) return `row ${row.slug} has a farm step of ${length} characters`;
  }
  return null;
}

function rowIssue(
  row: BoardRow,
  index: number,
  previous: BoardRow | undefined,
  slugs: ReadonlySet<string>,
  seen: Set<string>,
): string | null {
  if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
  seen.add(row.slug);
  if (!slugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
  if (row.rank !== index + 1) return `row ${index + 1} has rank ${row.rank}`;
  const implied = row.implied_value_usd;
  if (!Number.isSafeInteger(implied) || implied < 1 || implied > MAX_IMPLIED_USD) return `row ${row.slug} has implied ${implied}`;
  if (previous !== undefined && implied > previous.implied_value_usd) return `row ${row.slug} implied rises`;
  return stepIssue(row);
}

/** The first invariant the board breaks, or null. The gate's shape, checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (!Array.isArray(board) || board.length < MIN_BOARD_ROWS || board.length > MAX_BOARD_ROWS) {
    return `board has ${board.length} rows, expected ${MIN_BOARD_ROWS} to ${MAX_BOARD_ROWS}`;
  }
  const slugs: ReadonlySet<string> = new Set(snapshot.protocols.map((protocol) => protocol.slug));
  const seen = new Set<string>();
  for (let index = 0; index < board.length; index += 1) {
    const issue = rowIssue(board[index], index, index === 0 ? undefined : board[index - 1], slugs, seen);
    if (issue !== null) return issue;
  }
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `board misses watchlist slug ${slug}`;
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return "all implied values are the same";
  }
  return null;
}
