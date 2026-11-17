# DOSSIER — Token Radar (token-radar-01)

This repository is the runnable entry. `main.ts` reads the sealed snapshot, builds the board and page data, copies the differentiated dashboard and screenshots, and writes `dossier.json` with the vendored `buildDossier`. The judge reads the dossier's three screenshots and the dashboard source.

## 1. What the entry claims

- **178 pre-token protocols** ranked by a stated implied launch value.
- **40/40 watchlist coverage**, plus **138 below-floor early candidates**.
- **416 live-token protocols** set aside in the Live token view with their recorded market caps; they never mix into the pre-token ranking.
- Every board row has six concrete farm steps with cost and duration, derived from the protocol's category, chain, TVL and age.

## 2. Gate rows (seven)

| Gate row | Requirement | How this entry satisfies it | Evidence |
|---|---|---|---|
| `board_file` | object with `rows`, 100–4,000 rows, ≤8 MiB; slug/name/rank/implied/farm_steps | 178 rows; 359,505 B; unique snapshot slugs; all fields present | `board.json`; `main.ts` run log |
| `sorted_by_value` | ranks 1..N; implied never rises; not all equal | rank 1..178 exactly; rank 1 $453,097,790, rank 178 $607,271 | `board.json`; `boardIssue` = null |
| `coverage` | every watchlist slug appears | 40/40 covered | `board.json`; `data.js` |
| `farm_steps` | 3–12 strings, each 20–600 characters | every row 6 steps; 119–237 characters; category-specific mechanisms; no two rows share the first three steps | `board.json` |
| `screenshots` | 3–4 whole PNG/JPEG, ≤512 KiB, long side ≤1440, short side ≥800 | three 1440×800 images: `1-board.png` 69,264 B sha256 `3d192e59…`, `2-detail.png` 89,942 B sha256 `8bdc6bb8…`, `3-filtered.png` 65,339 B sha256 `db4ac2a7…` | `screenshots/` |
| `dossier_matches` | `dossier.json` byte-for-byte from `buildDossier` | `buildDossier(out,{text_max_bytes:65536,...})` recomputed byte-identically: 334,165 B sha256 `e1e47d29…`; text 33,664 B, 3 images, no http; two runs identical | `VERIFICATION.md` |
| `dashboard` | `dashboard/` ≤400 files/4 MiB, no network address | 3 files, 33,400 B; no http(s) in HTML/CSS/JS; no fetch | `dashboard/index.html` 448 B, `app.js` 24,072 B, `app.css` 8,880 B |

## 3. Judge criteria

### 3.1 A working radar

- Board covers the watchlist and ranks pre-token protocols by a stated implied value.
- The static page is differentiated from the starter:
  - **Method & exclusions** disclosure at the top with the formula, constants, `as_of`, watchlist semantics and exclusion rules;
  - **Why this rank** in the drawer: `tvl × base multiple`, `× growth`, `× maturity`, then the rounded implied value;
  - **why_no_token** and **disqualifier** explanations in plain language;
  - **Farm plan** rendered from the row's own `farm_steps`;
  - top-3 rank badges and tinted rows, chain count, 7d arrows;
  - existing `#q`/`#category`/`#p` hash routes and pre-token/live tabs preserved.
- The page recomputes `implied_value_usd` with the same 8-key model; the page self-check reports 178/178 with **0 mismatch**, 0 bad farm steps, 0 duplicate first-three-step sets.
- `boardIssue(board, snapshot) === null`.
- `main.ts` runs twice with byte-identical board, data and dossier.

### 3.2 The value model (radar-1.0)

```
growth   = 1 + 0.35 * clamp(change_7d, -50, 100) / 100
maturity = 0.55 + 0.45 * min(age_days, 1200) / 1200
implied  = max(1, round(tvl_usd * 0.22 * growth * maturity))
```

Only snapshot fields: `tvl_usd`, `change_7d`, `age_days` (from `listed_at`). No name is special-cased. `age_days` is null for six rows and the page uses `unknown_age_days=365`. The 0.22 base multiple is an explicit assumption, not a prediction. `data.js` carries the rows, live set, model and per-row farm steps.

### 3.3 Farm plans

Six steps per row: wallet and gas, category mechanism, weekly qualifying action, hold period, official claim check, and a farm log. Every step includes `Cost:` and `Time:`. Category mechanisms include:

- Lending: supply collateral + borrow, health factor >1.5;
- CDP: deposit collateral + mint stable at 25–35%, repay/stability fee;
- DEX: range LP, fees, rebalance;
- Perps/Derivatives: USDC margin, hedge, funding and liquidation checks;
- Yield: vault deposit, lock/withdrawal queue;
- Staking/Restaking: stake + liquid receipt + AVS restake;
- Bridge: bridge + destination use + fee comparison;
- Prediction: quoted spread + settlement;
- RWA: mint/redeem + eligibility/redemption window;
- Insurance: cover terms + claim;
- Curator/Allocator: vault fee, caps, exit queue.

Examples:

**Steakhouse Financial (Risk Curators, rank 1)**
1. Open Steakhouse Financial on Base with TVL $2,753,981,495, 7d -2.19% in a dedicated wallet; keep the phrase offline. Cost $3-5 gas; 10 minutes.
2. Deposit $150 into a Steakhouse Financial curated vault on Base; read the curator fee, caps and exit queue. Cost $150 capital + about $8 gas; 15 minutes.
3. Check the curator report, allocation changes and exit queue weekly. Cost $0-2; 10 minutes a week.
4. Hold at least 30 days. Cost: the $150 stays at risk; 30 days.
5. Claim only on the protocol's own page; never pay to claim. Cost $0; 10 minutes.
6. Log wallet, dates, hashes and exit trigger. Cost $0; 5 minutes.

**Decibel (Derivatives, rank 71)**
1. Open Decibel on Aptos with TVL $29,253,135, 7d +0.22% in a dedicated wallet. Cost $3-5 gas; 10 minutes.
2. Deposit $50 USDC margin on Decibel, open one small hedge, keep leverage below 2x. Cost $50 + about $4 gas; 15 minutes.
3. Check funding, margin and liquidation price every few days; roll or reduce weekly. Cost $2-5 a week; 10 minutes.
4. Hold at least 45 days. Cost: $50 at risk; 45 days.
5. Claim only on the protocol's own page. Cost $0; 10 minutes.
6. Log wallet, dates, hashes and exit trigger. Cost $0; 5 minutes.

## 4. Selection and exclusions

- 40 watchlist rows, every slug in watchlist order; a slug missing from `protocols` stops the run with exit `2`.
- 138 below-floor early rows: no token record, $5M ≤ TVL < $50M, no visible disqualifier.
- The other no-token protocols are left off the board: above the floor and outside the watchlist, or below it with a visible disqualifier (bridge/CEX/liquid-staking/restaking category, version marker, wrapped/staked word, exchange prefix). The snapshot has no `parentProtocol`, so the watchlist is authoritative; each row's `disqualifier_check` states its verdict.

The board says "the snapshot records no token", never "the protocol has no token".

## 5. Transcripts

The transcript bundle is **outside this repository** (a manifest, the redacted sessions, a redaction report and a tar.gz). It is uploaded with the submission, not committed to the repo.

Declared facts: `harness=DeepSeek Harness`, `harness_version=0.2.2-rc.1`, `provider=magpie`, `model=scnet-client/SCNet-Max`, `reasoning_effort=default`; notes say effort is not recorded and declared as default. Redaction removed internal instruction sections, instruction-file bodies, the system reminder, absolute user paths, run ids and `af_`-like references; leak scan passed.

## 6. Ownership, license and submission form

- The entry is submitted as a **source bundle**, not a GitHub repository: single-root git history, `git bundle create source.bundle HEAD`, `repo_url=bundle:<root sha>`, `source_bundle=@source.bundle`, and `Source: bundle sha256:<sha256(source.bundle)>` in the entry message.
- `.makefun/owner.json` holds the owner's wallet, written after the wallet is authorized, as `{"wallet":"<address>"}`. No placeholder is committed.
- LICENSE is MIT with `SPDX-License-Identifier: MIT`.

## 7. Verification and limits

- Two runs with `--input ..\work\snapshot.json` into separate output directories: `board.json` 359,505 B sha256 `0ff9e2ea…`, `data.js` 398,273 B sha256 `e22be280…`, `dossier.json` 334,165 B sha256 `e1e47d29…`; all three byte-identical between runs.
- `dossier.json`: text 33,664 B (≤65,536), 3 images, no http(s); rebuilding it with `buildDossier` gives the same bytes.
- Browser run: 0 console errors, 0 page errors, `scrollWidth == clientWidth == 1425`, detail `dialog[open]`, `#q=lending` 15 rows.
- Error boundary: a missing `--input`, a missing snapshot file and a corrupt snapshot each exit `2` with one line of reason; no `--input` reads `/input/snapshot.json`.
- No local grader (`reproduce:null`); structure and byte checks only.
- Snapshot date 2026-11-14; implied value is an estimate, not a price or a launch promise.
- Six rows have no `listed_at`; their age uses 365 days.
- A protocol may have a token that DefiLlama's record does not carry.
