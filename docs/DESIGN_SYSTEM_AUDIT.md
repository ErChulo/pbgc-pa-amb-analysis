# Design System Audit — PA_AMB Analysis System

**Audit only. No app file, style, or test was modified for this report.**
**Date:** 2026-11-12. **Auditor:** design-system audit worker. **Status:** ready for the implementing worker.

## 1. Design-system version applied

| Item | Value |
|---|---|
| Design system | PBGC Design System, ErChulo/pbgc-design-system |
| Version fetched | **v1.1.0** |
| Source | GitHub connector (`/opt/hatch/bin/github`, `get_file_contents`), repo `ErChulo/pbgc-design-system`, HEAD commit `84a7149d112ef26fcf1e5656b017b9e54f863cb2` (2026-11-08, "Add Badge, Accordion, SearchBar, and Footer") |
| Files fetched | `design.md` (16,492 bytes, header: Version 1.1.0, Status DRAFT, Last updated November 7, 2026), `tokens/tokens.json`, `tokens/tokens.css`, `tokens/contrast-report.md`, `CHANGELOG.md`, `README.md`, `OPEN-QUESTIONS.md`, `package.json` (version 1.1.0) |
| Path note | The spec lives at repo-root `design.md`, **not** `docs/DESIGN.md` — the `docs/` directory does not exist in this repo. Earlier references to `docs/DESIGN.md` are stale; use `design.md`. |

### Version check: is there anything newer than v1.1.0?

**No.** The latest commit (2026-11-08) did not bump the version: `design.md` still says v1.1.0, `package.json` still says 1.1.0, and the top `CHANGELOG.md` entry is still 1.1.0 (2026-11-07). No newer version exists.

Comparison with the local copies under `~/workspace/pbgc_review/r5/`:

- `PBGC_DESIGN_SYSTEM_tokens.json` — **byte-identical** to fetched `tokens/tokens.json` (after JSON normalisation).
- `PBGC_DESIGN_SYSTEM_tokens.css` — **byte-identical** to fetched `tokens/tokens.css`.
- `PBGC_DESIGN_SYSTEM_DESIGN.md` — **stale in one place only**: its §7 component table still lists Badge, Accordion, SearchBar and Footer as Backlog. The fetched `design.md` lists all four as **Built** (49 stories, axe gate in both themes). Everything else in the local copy matches the fetched spec.
- Action for the implementer: use the **fetched** v1.1.0 files above, not the local copies, for the component table. Tokens are the same either way.

### Standing facts about v1.1.0 (from the fetched spec itself)

- **Status: DRAFT for COLA and Section 508 review. NOT approved.** v1.0.0 was labelled "Approved / Release Candidate" while missing its color tokens; nothing is "approved" until `OPEN-QUESTIONS.md` is answered.
- **Target: WCAG 2.2 AA** (design.md §9.1). Legal floor: Section 508.
- **Authority order** (§1): PBGC Branding & Editorial Style Guide (Sept 2025) > this spec > implementation (`tokens/`, `src/`). `tokens/tokens.json` is the single source of truth; `tokens.css` and `contrast-report.md` are generated from it.
- **Derived values are not PBGC-approved** (§2.4, `OPEN-QUESTIONS.md` Q5): ink `#1A1A1A`, error `#B3001B`, warning `#8A5700`, all tints, focus ring, and the **entire dark theme** (Q6). They pass contrast but are unapproved.
- **Dark theme (§2.5): PROVISIONAL. "Do not ship it without COLA approval."** The style guide defines no dark theme. The header stays PBGC Blue in both themes.

## 2. What was audited

App repo: `~/workspace/pbgc-pa-amb-analysis`.

| File | Role in this audit |
|---|---|
| `src/ui/styles.css` | All theme tokens, base type, header, nav, buttons, tables, wizard panels, print |
| `src/ui/theme.ts` | `DARK_THEME_TOKENS` / `LIGHT_THEME_TOKENS`, default theme, toggle |
| `src/ui/template.html` | Header, wizard nav (7 steps), form labels, landmarks |
| `src/ui/charts.ts` | SVG charts — colours (all via CSS vars, no hard-coded colours), fonts, text sizes |
| `src/ui/reports.ts` | `PRINT_CSS` (printable report shell: black on white, Arial) |
| `src/ui/onboarding.ts` | Found during the audit: hard-coded inline dark colours (`#000000` / `#f2f0e9`) — included here, not in the original file list |
| `build/bundle.mjs` | Confirms `styles.css` is inlined into `template.html` at `<!--STYLES-->`; no separate CSS file ships |

Current app state, in one line: **dark by default with P-09 probe tokens** (bg `#000000`, fg `#f2f0e9`, muted `#b8b5ac`, accent `#7fb3ff`, header `#0a1f44`) and a **light toggle** (bg `#ffffff`, fg `#1a1a1a`, accent/header PBGC blue `#002d72`). The Playwright theme-rows test asserts the dark probe colours and the light header exactly.

## 3. Token-by-token mapping

Legend. **DS value** is from fetched v1.1.0 `tokens/tokens.json` / `design.md` (section cited). **Source** is the token's `$source` in `tokens.json`: `style-guide` = PBGC Branding & Editorial Style Guide; `derived` = filled a gap, passes contrast, **not PBGC-approved** (Q5). **Action**: `replace` = change the app value to the DS value; `keep` = app value already equals the DS value (rename the token only); `replace (provisional)` = change to a DS value that is itself provisional (dark theme, Q6) — adopt it, but keep it labelled provisional, never present it as design-system-approved.

### 3a. Light theme — colours (`styles.css` `[data-theme="light"]`, `theme.ts` `LIGHT_THEME_TOKENS`)

| # | App value (current) | Design-system value | Token (design.md section) | Source | Action |
|---|---|---|---|---|---|
| L1 | `--bg: #ffffff` | `#FFFFFF` | `theme.light.bg.page` (§2.3) | derived (white) | replace (rename only; value identical) |
| L2 | `--fg: #1a1a1a` | `#1A1A1A` | `theme.light.text.default` — `palette.derived.ink` (§2.3) | derived | replace (rename only; value identical) |
| L3 | `--muted: #555555` | `#58585B` | `theme.light.text.muted` — `palette.support.gray-1` (§2.3) | style-guide | replace |
| L4 | `--accent: #002d72` | `#002D72` | `theme.light.text.link` — `palette.brand.blue` (§2.1, §2.3) | style-guide | keep |
| L5 | `--row-alt: #f2f2f2` | `#F2F2F2` | `theme.light.bg.subtle` — `palette.support.gray-4` (§2.3) | style-guide | replace (rename only; value identical) |
| L6 | `--border: #cccccc` | `#81807F` | `theme.light.border.input` — `palette.secondary.gray` (§2.3) | style-guide | replace — current `#cccccc` **fails** WCAG 1.4.11 (1.61:1, see §5) |
| L7 | `--header-bg: #002d72` | `#002D72` | `theme.light.bg.inverse` — `palette.brand.blue` (§2.3, §2.5) | style-guide | keep |
| L8 | `--header-fg: #ffffff` | `#FFFFFF` | `theme.light.text.inverse` (§2.3) | derived (white) | keep |
| L9 | `--button-bg: #002d72` | `#002D72` | `theme.light.action.primary-bg` (§2.3) | style-guide | keep |
| L10 | `--button-fg: #ffffff` | `#FFFFFF` | `theme.light.action.primary-fg` (§2.3) | derived (white) | keep |
| L11 | `--focus: #002d72` | `#004B8D` | `theme.light.focus.ring` — `palette.secondary.medium-blue` (§2.3, §9.2) | style-guide | replace — current focus ring is **invisible on the header/buttons** (1.00:1, see §5) |
| L12 | `--warn: #8a5a00` | `#8A5700` | `theme.light.status.warning-accent` — `palette.derived.warning` (§2.3) | derived | replace |
| L13 | `--fail: #a00000` | `#B3001B` | `theme.light.status.error-accent` — `palette.derived.error` (§2.3) | derived | replace — and use brand red `#E4002B` **never** for errors (§2.4) |
| L14 | `--pass: #006400` | `#008065` | `theme.light.status.success-accent` — `palette.secondary.medium-green` (§2.3) | style-guide | replace |

### 3b. Dark theme — colours (`styles.css` `:root, [data-theme="dark"]`, `theme.ts` `DARK_THEME_TOKENS`)

Every row here is a **P-09 probe token replaced by the design system's own provisional dark theme** (`theme.dark`, design.md §2.5, `OPEN-QUESTIONS.md` Q6). The DS dark theme is provisional and unapproved — adopt it as the single dark theme, but keep it labelled `PROVISIONAL` in code comments and docs. Do not present any dark value as design-system-approved.

| # | App value (current, P-09 probe) | Design-system value (provisional) | Token (design.md section) | Action |
|---|---|---|---|---|
| D1 | `--bg: #000000` | `#0B1B36` | `theme.dark.bg.page` — `palette.derived.night-0` (§2.5) | replace (provisional) |
| D2 | `--fg: #f2f0e9` | `#F2F2F2` | `theme.dark.text.default` — `palette.support.gray-4` (§2.5) | replace (provisional) |
| D3 | `--muted: #b8b5ac` | `#D2D2D2` | `theme.dark.text.muted` — `palette.support.gray-2` (§2.5) | replace (provisional) |
| D4 | `--accent: #7fb3ff` | `#BEC6DF` | `theme.dark.text.link` — `palette.support.blue-1` (§2.5) | replace (provisional) |
| D5 | `--row-alt: #141414` | `#12294D` | `theme.dark.bg.subtle` — `palette.derived.night-1` (§2.5) | replace (provisional) |
| D6 | `--border: #333333` | `#8B9FC7` | `theme.dark.border.input` — `palette.support.blue-2` (§2.5) | replace (provisional) — current `#333333` **fails** WCAG 1.4.11 (1.66:1, see §5) |
| D7 | `--header-bg: #0a1f44` | `#002D72` | `theme.dark.bg.inverse` — `palette.brand.blue` (§2.3, §2.5: "The header stays PBGC Blue in both themes") | replace — **this one is DS-defined, not provisional** |
| D8 | `--button-bg: #0a1f44` | `#BEC6DF` | `theme.dark.action.primary-bg` — `palette.support.blue-1` (§2.3) | replace (provisional) |
| D9 | `--button-fg: #ffffff` | `#002D72` | `theme.dark.action.primary-fg` — `palette.brand.blue` (§2.3) | replace (provisional) — note: dark primary button is light blue bg with blue text, the inverse of light theme |
| D10 | `--focus: #7fb3ff` | `#FFFFFF` | `theme.dark.focus.ring` (§2.3, §9.2) | replace (provisional) |
| D11 | `--warn: #ffb86b` | `#FFD27A` | `theme.dark.status.warning-accent` (§2.3) | replace (provisional) — status accent for icon/border on `night-1`; status text stays `#F2F2F2` |
| D12 | `--fail: #ff9d9d` | `#FFB3BD` | `theme.dark.status.error-accent` (§2.3) | replace (provisional) — same note as D11 |
| D13 | `--pass: #9ed69e` | `#B8D3A7` | `theme.dark.status.success-accent` — `palette.support.green-2` (§2.3) | replace (provisional) — same note as D11 |

Dark status backgrounds: all four dark status backgrounds are `night-1` `#12294D` (`theme.dark.status.{info,success,warning,error}-bg`). The app has no status/alert component today (see §4, gap G12); when one is added, use those, not the light tints.

Dark danger button (no app equivalent today; for completeness): `theme.dark.action.danger-bg #FFB3BD`, `danger-fg #4D000B`, `danger-bg-hover #FFFFFF`. The hexes `#FFB3BD`, `#FFD27A`, `#4D000B` appear only in `theme.dark` in `tokens.json` (not in the palette) — cite them as `theme.dark.*`, not as palette tokens.

### 3c. Typography, spacing, layout, components (`styles.css`, `template.html`, `charts.ts`, `reports.ts`)

| # | App value (current) | Design-system value | Token / rule (design.md section) | Action |
|---|---|---|---|---|
| T1 | `body font-family: "Helvetica Neue", Helvetica, Arial, sans-serif` | `"Helvetica Neue", Arial, sans-serif` | `static.font.sans` (§3) | replace — drop the bare `Helvetica` |
| T2 | `body font-size: 14px` | `1rem` (16px) | `static.font.size-base` (§3) | replace |
| T3 | `body line-height: 1.45` | `1.5` | `static.font.leading-body` (§3) | replace |
| T4 | `h1 { font-size: 20px }` | `2.25rem` (36px), weight 700, leading 1.25 | `static.font.size-h1`, `weight-bold`, `leading-tight` (§3) | replace |
| T5 | `h2 { font-size: 16px }` | `1.75rem` (28px), weight 700, leading 1.25 | `static.font.size-h2` (§3) | replace |
| T6 | `h3 { font-size: 14px }` | `1.375rem` (22px), weight 700, leading 1.25 | `static.font.size-h3` (§3) | replace |
| T7 | `#status-line`, `table`: `font-size: 13px` | `0.875rem` (14px) | `static.font.size-small` (§3) | replace — 13px is below the DS floor: "Nothing below 14px carries content" (§3) |
| T8 | `button { font-size: 13px }` | `1rem` (16px) | `static.font.size-base` (§3) | replace |
| T9 | `button { padding: 6px 12px }` | min target `44px` × `44px` | `static.target.min` (§5); "There is no 'small' button" (§5, §7) | replace — buttons must be at least 44px tall; keep padding, add `min-height: 44px` |
| T10 | `button { border-radius: 3px }` | `4px` | `static.radius.default` (§3/§5 via `tokens.json`) | replace |
| T11 | `button:hover { filter: brightness(1.15) }` | hover bg `#004B8D` (light) / `#FFFFFF` (dark) | `theme.{light,dark}.action.primary-bg-hover` (§2.3) | replace — no brightness filter; set the hover background token |
| T12 | `button.secondary { background: transparent; color: var(--fg) }` | bg `#FFFFFF`, fg `#002D72`, border `#002D72`, hover bg `#F2F2F2` (light); bg `#0B1B36`, fg `#BEC6DF`, border `#BEC6DF`, hover `#12294D` (dark) | `theme.{light,dark}.action.secondary-*` (§2.3) | replace |
| T13 | `button:disabled { opacity: 0.45 }` | disabled "is not conveyed by opacity alone" | §7 Button accessibility contract | replace — keep opacity if wanted, but add a non-colour cue (e.g. `cursor: not-allowed` already present; add visible text such as "(unavailable)" or a disabled label — do not rely on opacity alone) |
| T14 | `button:focus-visible, a:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }` | `outline: 3px solid var(--pbgc-focus-ring); outline-offset: 2px`; on blue surfaces the ring is white | `static.focus.width/offset`, `theme.focus.ring`, `focus.ring-on-inverse` (§9.2) | keep (geometry matches exactly); change only the colour token (L11/D10) and add the on-inverse white ring for focus inside the header |
| T15 | `a { color: var(--accent) }` — no underline | links are **always underlined** | §2.4 ("Link blue versus body text is below 3:1, so color alone cannot mark a link") | replace — add `text-decoration: underline` |
| T16 | `#pa-amb-app { max-width: 1100px }` | `1400px` | `static.container.max` (§5) | replace |
| T17 | Spacing `4px / 8px / 12px / 16px / 32px` | 8-point grid: `8, 16, 24, 32, 48, 64px` (`--pbgc-space-1` to `-8`) | §5 | replace — `4px` gaps and `12px` paddings are off-grid; map 4→8, 12→16, keep 8/16/32, use 24 where a step between 16 and 32 is needed |
| T18 | No breakpoints / no responsive rules (except print) | mobile <640px, tablet 640–1023px, desktop 1024–1439px, wide ≥1440px; nav collapses to a disclosure menu below 1024px | §5 (`static.breakpoint.md/lg/xl`) | replace (add) — at minimum the wizard nav must wrap/collapse below 1024px; content must work at 320px wide and 400% zoom without horizontal scrolling (except data tables, which scroll inside a labelled region) |
| T19 | `th, td { padding: 4px 8px }` | spacing scale (§5); numbers use tabular figures and right-align | §3 ("Numbers in tables and forms use tabular figures (`font-variant-numeric: tabular-nums`) and right-align") | replace — add `font-variant-numeric: tabular-nums` and right-align numeric cells |
| T20 | `charts.ts`: `font-family="Arial, Helvetica, sans-serif"`, text `10px / 11px / 12px / 14px` | font-sans `"Helvetica Neue", Arial, sans-serif`; minimum 14px for content | `static.font.sans`, `size-small` (§3) | replace — chart axis/tick labels at 10–11px are below the 14px floor; raise to 14px (titles may stay 14px bold) |
| T21 | `charts.ts`: colours only via `var(--fg) / var(--muted) / var(--accent) / var(--border) / var(--bg)` — no hard-coded colours | components read semantic tokens, never raw palette values | §2.3 | keep — the mechanism is already correct; the values change when the tokens change (L1–L14, D1–D13). Note: charts are **backlog** in the DS (§7: "Tabs, modal, charts — custom widgets: full keyboard model required before building"), so no DS chart component exists to copy |
| T22 | `reports.ts` `PRINT_CSS`: `font-family: Arial, Helvetica, sans-serif` | font-sans `"Helvetica Neue", Arial, sans-serif`; print: black on white, 12pt | `static.font.sans` (§3), §11 Print | replace |
| T23 | `reports.ts` `PRINT_CSS`: `h1 20px; h2 15px; table 13px` | print body 12pt; headings per §3 scale | §11, §3 | replace — print body to 12pt; table text to at least 14px (13px is below the floor) |
| T24 | `reports.ts` `PRINT_CSS`: no link URLs printed | "links show their URLs" in print | §9.4 manual checks, §11 | replace (add) — print `a[href]::after { content: " (" attr(href) ")" }` or equivalent |
| T25 | `reports.ts` `PRINT_CSS`: `th { background: #eee }` | print: black on white | §11 | replace — `th` background to `#FFFFFF` (contrast already passes at 18.10:1, but §11 says black on white) |
| T26 | `onboarding.ts` inline styles: `background:#000000; color:#f2f0e9` (tour overlay, help centre, help paragraphs) | dark `bg.page #0B1B36`, `text.default #F2F2F2` | `theme.dark.*` (§2.5) | replace (provisional) — and move these into `styles.css` classes instead of inline styles so the theme toggle reaches them; today the onboarding overlay is hard-coded dark in both themes |

### 3d. Mapping counts

53 rows total (L1–L14, D1–D13, T1–T26)

- **Keep: 7** — L4, L7, L8, L9, L10, T14 (focus geometry only), T21 (charts var mechanism).
- **Replace (DS-defined value): 33** — L1, L2, L3, L5, L6, L11, L12, L13, L14, D7, T1–T13, T15–T20, T22–T25. (D7 is the one dark row that is DS-defined, not provisional.)
- **Replace (provisional — DS provisional dark theme): 13** — D1–D6, D8–D13, T26.
- No row was invented: every replacement value is cited to a token in fetched v1.1.0 `tokens/tokens.json` or a rule in fetched `design.md`.

## 4. Gaps — app values / behaviours with NO design-system source

Each item below has no DS token or component to map to. All are marked **provisional** (or "no DS source — do not present as DS") until the design system defines them.

| # | Gap | Detail | Status |
|---|---|---|---|
| G1 | **The entire dark theme** | v1.1.0 has no dark theme in the style guide; `theme.dark` is provisional (§2.5, Q6). The app's current dark tokens are P-09 probe tokens, also not DS tokens. Whichever dark values ship, they are provisional. | Provisional — see D1–D13, T26 |
| G2 | **Dark default** | The app defaults to dark (MASTER_PROMPT §18). The DS light theme is the default (`:root`, `color-scheme: light`); its dark theme applies via `prefers-color-scheme: dark` or `data-theme="dark"`. No DS rule says which theme an app should default to. | Provisional — product decision, not a DS decision. Keep dark-by-default only if the parent confirms; record the choice |
| G3 | **Wizard steps component** | The DS has no wizard/stepper component (§7). The 7-step nav (`template.html` `#wizard-nav`, `aria-current="step"`) has no DS source. Closest DS contract is HeaderNav (§7): skip link first, links not buttons, `aria-current="page"`, disclosure menu below 1024px. | Provisional — keep the app's own stepper; do not claim it is a DS component. Apply the HeaderNav a11y ideas that fit (see §6, items I-9, I-10) |
| G4 | **P-09 probe tokens** | Dark bg `#000000`, fg `#f2f0e9`, muted `#b8b5ac`, accent `#7fb3ff`, header `#0a1f44`, row-alt `#141414`, border `#333333`, warn `#ffb86b`, fail `#ff9d9d`, pass `#9ed69e` — none is a DS token. Superseded by D1–D13 if the DS provisional dark theme is adopted. | Provisional — must not be presented as DS tokens; delete them when D1–D13 land, do not keep both sets |
| G5 | **Light warn/fail/pass** | `#8a5a00`, `#a00000`, `#006400` are app-invented; DS has derived status accents `#8A5700`, `#B3001B`, `#008065` (L12–L14). The app values are close but not equal. | Replace with derived DS values (L12–L14); the DS values are themselves derived/unapproved (Q5) |
| G6 | **Light muted `#555555`** | App-invented; DS muted is `#58585B` (L3). | Replace (L3) |
| G7 | **Light border `#cccccc`** | App-invented; DS input border is `#81807F` (L6). Current value fails WCAG 1.4.11. | Replace (L6) |
| G8 | **Chart text sizes 10–11px** | No DS token allows text below 14px (§3 floor). | Replace (T20) |
| G9 | **No logo in the app header** | DS §4: the header uses the official logo (horizontal, agency name), white (`wt`) artwork on PBGC Blue, min width 60px, alt "Pension Benefit Guaranty Corporation". The app header is text-only (`<h1>PA_AMB Analysis</h1>`). No logo asset exists in this repo. | Gap — no DS source in-repo. Do **not** draw a substitute logo (§4: "Reproduce, never redraw"). Add the logo only when the official file is available; until then the header stays text-only and that is recorded as a gap, not a DS deviation to fix by drawing one |
| G10 | **No skip link** | DS HeaderNav contract (§7): "Skip link first". `template.html` has none. | Gap — add (see §6, I-9). DS-defined behaviour, app-missing |
| G11 | **DataTable contract not met** | DS DataTable (§7): `<caption>`, `scope="col"`, `aria-sort`, polite announcement, focusable labelled scroll region. App tables (in `styles.css` scope and in `reports.ts` output) have no `<caption>`, no `scope`, no `aria-sort`, and no labelled scroll region. | Gap — add (see §6, I-11). DS-defined behaviour, app-missing |
| G12 | **No Alert / status component** | DS Alert (§7): no live region by default; `polite` → `role="status"`, `assertive` → `role="alert"`, never both; status uses icon shape + text + heavy left border, never colour alone (§2.4); errors read "Error: ...". The app's `#status-line` uses `role="status"` (fine) but there is no Alert component, no status tint/icon/border system, and no "Error: …" wording rule. | Gap — when a status/alert UI is added, use `theme.status-*` tokens and the §7 contract; do not invent status colours |
| G13 | **Form-field error contract not implemented** | DS TextField/Select (§7): visible label; hint and error both in `aria-describedby`; "(required)" in words; error is text + icon + border. `template.html` has visible labels (good) but no `aria-describedby`, no hint/error wiring, and no "(required)" marking (the calculation-date input has no required indication). | Gap — add when form validation UI is built; labels alone are not the full contract |
| G14 | **No motion / reduced-motion handling** | DS §6: CSS transitions only, 150ms state / 250ms elevation; under `prefers-reduced-motion: reduce` durations become 0.01ms at token level. The app has no transitions and no reduced-motion rule. | Gap — add the DS motion tokens and the reduced-motion media query; no animation exists today, so this is additive, not a fix |
| G15 | **No 320px / 400% zoom handling** | DS §5: content must work at 320px wide and 400% zoom without horizontal scrolling (except data tables in a labelled region). Untested in this app; no breakpoints exist (T18). | Gap — verify after T18; do not claim it passes |
| G16 | **Prose measure 60ch not applied** | DS §3: line length capped at 60 characters for prose (`--pbgc-measure-prose: 60ch`). App has no measure cap. | Gap — add `max-width: 60ch` to prose paragraphs where it fits; not a token replacement |
| G17 | **Serif long-form not used in reports** | DS §3: serif long-form (Garamond, 20px) for fact sheets and reports. `reports.ts` renders reports in sans at 13px. | Gap — reports are the DS's "long-form" case; switching report body to the serif stack at 20px/1.5 is a content decision for the parent, not a mechanical token swap. Flag it; do not silently change report typography without that decision |
| G18 | **Brand red as accent** | DS §2.1: brand red `#E4002B` is accent only (rules, highlights), never an error state. The app uses no brand red anywhere today — that is compliant by omission, but any future red accent must be `#E4002B` from `border-accent`, not an invented red. | No action; recorded so a future red is not invented |

## 5. WCAG 2.2 AA contrast — computed by the auditor

**Method.** Ratios were computed by a script (`/tmp/contrast_audit.py`, kept outside the repo) implementing the WCAG 2.x relative-luminance formula: linearise each sRGB channel (`c/12.92` if `c ≤ 0.04045`, else `((c+0.055)/1.055)^2.4`), luminance `L = 0.2126R + 0.7152G + 0.0722B`, ratio `(L1+0.05)/(L2+0.05)`. Thresholds: **4.5:1** normal text, **3:1** large text / UI components and focus indicators (design.md §9.1). **No ratio below was copied from any report; every value was computed by that script.** Cross-check: the script's light-theme results reproduce the DS's own `contrast-report.md` exactly (e.g. body 17.40, muted 7.09, link 12.98, input border 3.94), which validates the computation.

### 5a. Design-system pairs (from `tokens.json` `pairs`, resolved per theme) — 30 pairs per theme

**Light theme: 30 / 30 PASS. Dark theme (provisional): 30 / 30 PASS.** The DS's own report claims "ALL PAIRS PASS (59 checks)" — 59, not 60, because the theme-independent pair (white on brand red) is counted once. My independent computation agrees on every pair.

| Pair | Light fg on bg | Ratio | Min | Dark fg on bg | Ratio | Min |
|---|---|---|---|---|---|---|
| Body text on page | `#1A1A1A` / `#FFFFFF` | 17.40 | 4.5 PASS | `#F2F2F2` / `#0B1B36` | 15.32 | 4.5 PASS |
| Body text on subtle surface | `#1A1A1A` / `#F2F2F2` | 15.55 | 4.5 PASS | `#F2F2F2` / `#12294D` | 12.94 | 4.5 PASS |
| Muted text on page | `#58585B` / `#FFFFFF` | 7.09 | 4.5 PASS | `#D2D2D2` / `#0B1B36` | 11.35 | 4.5 PASS |
| Muted text on subtle surface | `#58585B` / `#F2F2F2` | 6.33 | 4.5 PASS | `#D2D2D2` / `#12294D` | 9.58 | 4.5 PASS |
| Link on page | `#002D72` / `#FFFFFF` | 12.98 | 4.5 PASS | `#BEC6DF` / `#0B1B36` | 10.07 | 4.5 PASS |
| Link on subtle surface | `#002D72` / `#F2F2F2` | 11.59 | 4.5 PASS | `#BEC6DF` / `#12294D` | 8.50 | 4.5 PASS |
| Link hover on page | `#004B8D` / `#FFFFFF` | 8.78 | 4.5 PASS | `#FFFFFF` / `#0B1B36` | 17.15 | 4.5 PASS |
| Text on PBGC Blue header | `#FFFFFF` / `#002D72` | 12.98 | 4.5 PASS | `#FFFFFF` / `#002D72` | 12.98 | 4.5 PASS |
| Input border on page (1.4.11) | `#81807F` / `#FFFFFF` | 3.94 | 3 PASS | `#8B9FC7` / `#0B1B36` | 6.44 | 3 PASS |
| Input border on subtle (1.4.11) | `#81807F` / `#F2F2F2` | 3.52 | 3 PASS | `#8B9FC7` / `#12294D` | 5.44 | 3 PASS |
| Primary button label | `#FFFFFF` / `#002D72` | 12.98 | 4.5 PASS | `#002D72` / `#BEC6DF` | 7.62 | 4.5 PASS |
| Primary button label, hover | `#FFFFFF` / `#004B8D` | 8.78 | 4.5 PASS | `#002D72` / `#FFFFFF` | 12.98 | 4.5 PASS |
| Secondary button label | `#002D72` / `#FFFFFF` | 12.98 | 4.5 PASS | `#BEC6DF` / `#0B1B36` | 10.07 | 4.5 PASS |
| Secondary button label, hover | `#002D72` / `#F2F2F2` | 11.59 | 4.5 PASS | `#BEC6DF` / `#12294D` | 8.50 | 4.5 PASS |
| Secondary button boundary | `#002D72` / `#FFFFFF` | 12.98 | 3 PASS | `#BEC6DF` / `#0B1B36` | 10.07 | 3 PASS |
| Danger button label | `#FFFFFF` / `#B3001B` | 7.16 | 4.5 PASS | `#4D000B` / `#FFB3BD` | 9.42 | 4.5 PASS |
| Danger button label, hover | `#FFFFFF` / `#8F0016` | 9.64 | 4.5 PASS | `#4D000B` / `#FFFFFF` | 15.90 | 4.5 PASS |
| Focus ring on page | `#004B8D` / `#FFFFFF` | 8.78 | 3 PASS | `#FFFFFF` / `#0B1B36` | 17.15 | 3 PASS |
| Focus ring on subtle surface | `#004B8D` / `#F2F2F2` | 7.85 | 3 PASS | `#FFFFFF` / `#12294D` | 14.48 | 3 PASS |
| Focus ring on PBGC Blue header | `#FFFFFF` / `#002D72` | 12.98 | 3 PASS | `#FFFFFF` / `#002D72` | 12.98 | 3 PASS |
| Alert text on info bg | `#1A1A1A` / `#EAF0F8` | 15.18 | 4.5 PASS | `#F2F2F2` / `#12294D` | 12.94 | 4.5 PASS |
| Info icon and border | `#004B8D` / `#EAF0F8` | 7.66 | 3 PASS | `#BEC6DF` / `#12294D` | 8.50 | 3 PASS |
| Alert text on success bg | `#1A1A1A` / `#E6F2EF` | 15.18 | 4.5 PASS | `#F2F2F2` / `#12294D` | 12.94 | 4.5 PASS |
| Success icon and border | `#008065` / `#E6F2EF` | 4.28 | 3 PASS | `#B8D3A7` / `#12294D` | 8.91 | 3 PASS |
| Alert text on warning bg | `#1A1A1A` / `#FFF4D6` | 15.88 | 4.5 PASS | `#F2F2F2` / `#12294D` | 12.94 | 4.5 PASS |
| Warning icon and border | `#8A5700` / `#FFF4D6` | 5.56 | 3 PASS | `#FFD27A` / `#12294D` | 10.17 | 3 PASS |
| Alert text on error bg | `#1A1A1A` / `#FDECEF` | 15.27 | 4.5 PASS | `#F2F2F2` / `#12294D` | 12.94 | 4.5 PASS |
| Error icon and border | `#B3001B` / `#FDECEF` | 6.28 | 3 PASS | `#FFB3BD` / `#12294D` | 8.58 | 3 PASS |
| Error message text on page | `#B3001B` / `#FFFFFF` | 7.16 | 4.5 PASS | `#FFB3BD` / `#0B1B36` | 10.16 | 4.5 PASS |
| White text on PBGC Red | `#FFFFFF` / `#E4002B` | 4.85 | 4.5 PASS | (same pair) | 4.85 | 4.5 PASS |

### 5b. Brand palette on white (design.md §2.2 — recomputed, matches the spec's table)

| Colour | Ratio vs white | Text 4.5 | UI 3 |
|---|---|---|---|
| brand.blue `#002D72` | 12.98 | PASS | PASS |
| brand.red `#E4002B` | 4.85 | PASS (white only) | PASS |
| medium-blue `#004B8D` | 8.78 | PASS | PASS |
| medium-green `#008065` | 4.91 | PASS | PASS |
| gray-1 `#58585B` | 7.09 | PASS | PASS |
| gray-425 `#81807F` | 3.94 | **FAIL text** (UI only) | PASS |
| blue-3 `#4A7DBA` | 4.26 | **FAIL text** (UI / large text only) | PASS |
| light-blue-gray `#6E93C2` | 3.17 | **FAIL text** (UI / large graphics only) | PASS |
| teal `#00A9A1` | 2.92 | **FAIL text** (decorative only) | FAIL |
| light-green `#88B672` | 2.34 | **FAIL text** (decorative only) | FAIL |
| brand.red `#E4002B` on `#F2F2F2` | 4.33 | **FAIL text** — red text only on white (§2.2) | — |

### 5c. Current app pairs — dark theme (P-09 probe tokens)

All text pairs pass. **Two failures, both borders.**

| Pair | Ratio | Min | Result |
|---|---|---|---|
| body `#f2f0e9` on `#000000` | 18.42 | 4.5 | PASS |
| muted `#b8b5ac` on `#000000` | 10.24 | 4.5 | PASS |
| accent/link `#7fb3ff` on `#000000` | 9.79 | 4.5 | PASS |
| header text `#ffffff` on `#0a1f44` | 16.25 | 4.5 | PASS |
| button text `#ffffff` on `#0a1f44` | 16.25 | 4.5 | PASS |
| table header text `#ffffff` on `#0a1f44` | 16.25 | 4.5 | PASS |
| focus `#7fb3ff` on `#000000` | 9.79 | 3 | PASS |
| focus `#7fb3ff` on `#0a1f44` | 7.58 | 3 | PASS |
| warn `#ffb86b` on `#000000` | 12.32 | 4.5 | PASS |
| fail `#ff9d9d` on `#000000` | 10.56 | 4.5 | PASS |
| pass `#9ed69e` on `#000000` | 12.57 | 4.5 | PASS |
| muted `#b8b5ac` on row-alt `#141414` | 8.99 | 4.5 | PASS |
| body `#f2f0e9` on row-alt `#141414` | 16.16 | 4.5 | PASS |
| accent `#7fb3ff` on row-alt `#141414` | 8.59 | 4.5 | PASS |
| header subtitle (white at opacity 0.85 on `#0a1f44`, effective `#d9e2f2`) | 12.47 | 4.5 | PASS |
| **border `#333333` on `#000000`** | **1.66** | 3 | **FAIL** (WCAG 1.4.11) |
| **border `#333333` on row-alt `#141414`** | **1.46** | 3 | **FAIL** (WCAG 1.4.11) |

### 5d. Current app pairs — light theme

All text pairs pass. **Three failures: the focus ring on blue surfaces, and both borders.**

| Pair | Ratio | Min | Result |
|---|---|---|---|
| body `#1a1a1a` on `#ffffff` | 17.40 | 4.5 | PASS |
| muted `#555555` on `#ffffff` | 7.46 | 4.5 | PASS |
| accent/link `#002d72` on `#ffffff` | 12.98 | 4.5 | PASS |
| header text `#ffffff` on `#002d72` | 12.98 | 4.5 | PASS |
| button text `#ffffff` on `#002d72` | 12.98 | 4.5 | PASS |
| focus `#002d72` on `#ffffff` | 12.98 | 3 | PASS |
| **focus `#002d72` on header/button `#002d72`** | **1.00** | 3 | **FAIL — the focus ring is invisible on every blue surface** |
| warn `#8a5a00` on `#ffffff` | 5.93 | 4.5 | PASS |
| fail `#a00000` on `#ffffff` | 8.42 | 4.5 | PASS |
| pass `#006400` on `#ffffff` | 7.44 | 4.5 | PASS |
| muted `#555555` on row-alt `#f2f2f2` | 6.66 | 4.5 | PASS |
| body `#1a1a1a` on row-alt `#f2f2f2` | 15.55 | 4.5 | PASS |
| **border `#cccccc` on `#ffffff`** | **1.61** | 3 | **FAIL** (WCAG 1.4.11) |
| **border `#cccccc` on row-alt `#f2f2f2`** | **1.43** | 3 | **FAIL** (WCAG 1.4.11) |

### 5e. Other app surfaces computed

| Pair | Ratio | Min | Result |
|---|---|---|---|
| Onboarding overlay `#f2f0e9` on `#000000` (`onboarding.ts` inline) | 18.42 | 4.5 | PASS (but hard-coded dark in both themes — see T26) |
| Report print body `#000000` on `#FFFFFF` | 21.00 | 4.5 | PASS |
| Report print `th` text `#000000` on `#EEEEEE` | 18.10 | 4.5 | PASS |
| Report print table border `#666666` on `#FFFFFF` | 5.74 | 3 | PASS |

### 5f. Contrast verdicts

- The design system's own pairs all pass AA in both themes (my computation agrees with its report). Adopting them fixes the app's failures.
- The app's **text** contrast already passes in both themes; the failures are all **non-text**: borders in both themes (1.43–1.66:1 vs 3:1 required) and the light-theme focus ring on blue surfaces (1.00:1 — invisible). L6, D6 and L11 fix exactly those three.
- The 13px body/table text is a DS **size** failure (§3 floor 14px), not a contrast failure — fix via T2/T7, not via colour.

## 6. Exact instructions for the implementing worker

### Files to change

1. **`src/ui/styles.css`** — replace the token blocks and the rules in §3a–§3c (L1–L14, D1–D13, T1–T19). Keep the `:root, [data-theme="dark"]` / `[data-theme="light"]` structure and the `var(--*)` names the charts use, so `charts.ts` needs no colour changes. Add the DS token names in comments next to each value (e.g. `/* --pbgc-text-default (DS v1.1.0, derived) */`). Mark every dark-theme value `PROVISIONAL — DS v1.1.0 §2.5, OPEN-QUESTIONS Q6, not COLA-approved`.
2. **`src/ui/theme.ts`** — replace `DARK_THEME_TOKENS` with D1–D13 and `LIGHT_THEME_TOKENS` with L1–L14 (same values as `styles.css`; the two must not drift). Update the file header comment: P-09 probe tokens are superseded, not kept alongside. Do not change the storage/toggle logic (`THEME_STORAGE_KEY`, `resolveTheme`, `safeStorage`, `applyThemeToDocument`).
3. **`src/ui/template.html`** — (a) add a skip link as the first element inside `<body>` (DS HeaderNav contract, §7; gap G10); (b) wizard nav: keep the 7 steps and `aria-current="step"` (no DS wizard exists — G3), but add the disclosure/collapse behaviour below 1024px (T18); (c) do **not** add a logo — no official asset is available (G9); (d) no colour changes here (all colours come from `styles.css`).
4. **`src/ui/charts.ts`** — colours: no change (vars only, T21). Fonts/sizes only: `font-family="Arial, Helvetica, sans-serif"` → `"Helvetica Neue", Arial, sans-serif`; raise `font-size="10"` and `"11"` text to `14` (T20). Update the header comment (lines ~19–22) to the new token values.
5. **`src/ui/reports.ts`** — `PRINT_CSS` only: font stack (T22), sizes to 12pt body / ≥14px tables (T23), add link-URL printing (T24), `th` background `#eee` → `#FFFFFF` (T25). Do not change report content or structure.
6. **`src/ui/onboarding.ts`** — remove the three hard-coded inline dark styles (`background:#000000;color:#f2f0e9`, lines ~109, ~182, ~216) and replace with classes in `styles.css` driven by the theme tokens (T26). Do not change onboarding copy or behaviour.
7. **`docs/STAGE6_BUILD.md`** — update the P-09 token references to the adopted DS values (doc-only; the audit did not verify this file line by line — the implementer should grep it for `#000000`, `#f2f0e9`, `#7fb3ff`, `#0a1f44`).
8. **Do not touch** `build/bundle.mjs` (it inlines `styles.css` unchanged) or any engine/stage file. Rebuild with `node build/bundle.mjs` after the style changes and re-run the full test suites.

### Values to set (summary — full table is §3)

- Light: bg `#FFFFFF`, fg `#1A1A1A`, muted `#58585B`, accent/link `#002D72`, row-alt `#F2F2F2`, border `#81807F`, header `#002D72` / `#FFFFFF`, button `#002D72` / `#FFFFFF` with hover `#004B8D`, focus `#004B8D`, warn `#8A5700`, fail `#B3001B`, pass `#008065`; body 16px/1.5, H1 36px / H2 28px / H3 22px at weight 700, small 14px, radius 4px, buttons min-height 44px, container 1400px, links underlined, spacing on the 8/16/24/32/48/64 grid.
- Dark (provisional): bg `#0B1B36`, fg `#F2F2F2`, muted `#D2D2D2`, accent/link `#BEC6DF`, row-alt `#12294D`, border `#8B9FC7`, header `#002D72` / `#FFFFFF` (DS-defined, both themes), button `#BEC6DF` / `#002D72` with hover `#FFFFFF`, focus `#FFFFFF`, warn `#FFD27A`, fail `#FFB3BD`, pass `#B8D3A7`.
- Focus on blue surfaces (header, primary buttons): white ring (`focus-ring-on-inverse #FFFFFF`) in **both** themes — this is what fixes the 1.00:1 failure in §5d.

### Decisions the implementer must NOT make alone (flag to the parent)

- **D-A:** Adopting the DS provisional dark theme changes the default look (page bg `#000000` → `#0B1B36`, fg `#f2f0e9` → `#F2F2F2`). The alternative is keeping the P-09 dark tokens and adopting the DS only in light theme. This audit recommends the DS provisional dark theme (one token set, all pairs pass, §2.5 is the DS's own provisional answer), but the visible change needs the parent's confirmation before the implementer lands it.
- **D-B:** Report typography (gap G17): switching `reports.ts` output to the DS serif long-form stack (Garamond, 20px) is a content decision, not a token swap. Leave reports in sans unless the parent says otherwise.
- **D-C:** The dark theme remains **provisional and unapproved** (COLA Q6) after this work. The app must not claim DS compliance for dark mode; keep the `PROVISIONAL` comments.

### Tests that assert the old probe colours — must be updated

| Test | What it asserts today | What must change |
|---|---|---|
| `test/ui-playwright/theme-rows.test.mjs` | Dark body bg `rgb(0, 0, 0)`, fg `rgb(242, 240, 233)`; light header bg `rgb(0, 45, 114)`; even row `rgb(20, 20, 20)`; header comment and PASS line name the P-09 values | **Dark asserts change** to the DS provisional dark values: body bg `rgb(11, 27, 54)` (`#0B1B36`), body fg `rgb(242, 242, 242)` (`#F2F2F2`), even row `rgb(18, 41, 77)` (`#12294D`). **Light header assert stays** — `rgb(0, 45, 114)` is `#002D72`, which the DS defines (`palette.brand.blue`, style-guide source; §2.5 header stays PBGC Blue in both themes). Also update the file's header comment (P-09 probe note) and the PASS log line. The 1,000-row render probe itself is unchanged |
| `test/charts.test.ts` ("uses CSS variables, never hardcoded theme colours") | SVG contains `var(--fg)` / `var(--muted)` / `var(--accent)` and **not** `#000000`, `#f2f0e9`, `#002d72` | **No change needed** — charts still use vars only. It must still pass after the token change; if it fails, the charts regressed, not the test |
| `test/ui-playwright/defensive-loading.test.mjs` | Only `data-theme` is `"dark"`/`"light"`; no colours asserted | **No change needed** |
| Node tests (`test/*.test.ts`) | No other colour assertions found (grep for `#000000`, `#f2f0e9`, `#002d72`, `#7fb3ff` across `test/` and `src/ui/charts.ts`, `reports.ts`, `main.ts` found only the files above) | **No change needed** — but re-run the full suites (`npm test` and the Playwright runner) after the change; the theme-rows test is the only one expected to change |

### Verification the implementer must do (not done by this audit)

1. `npm test` (tsc + Node tests) — all green.
2. Playwright suite (`test/ui-playwright/run.mjs`) — all green, including the updated theme-rows test.
3. Recompute contrast for any value the implementer changes beyond §3 — do not assert a ratio without computing it.
4. Manual checks per DS §9.4 that automation cannot do: keyboard-only run, 200%/400% zoom at 320px, `prefers-reduced-motion`, print preview with link URLs visible.
5. Confirm the rebuilt single file still has 0 fetch (existing `zero-fetch` test).

## 7. Sources

- Fetched 2026-11-12 via the GitHub connector from `ErChulo/pbgc-design-system` @ `84a7149d112ef26fcf1e5656b017b9e54f863cb2`: `design.md` v1.1.0, `tokens/tokens.json`, `tokens/tokens.css`, `tokens/contrast-report.md`, `CHANGELOG.md`, `OPEN-QUESTIONS.md`, `package.json`.
- Local comparison copies: `~/workspace/pbgc_review/r5/PBGC_DESIGN_SYSTEM_DESIGN.md`, `PBGC_DESIGN_SYSTEM_tokens.json`, `PBGC_DESIGN_SYSTEM_tokens.css` (tokens identical; local DESIGN.md stale only in the §7 component table).
- App files read: `src/ui/styles.css`, `src/ui/theme.ts`, `src/ui/template.html`, `src/ui/charts.ts`, `src/ui/reports.ts`, plus `src/ui/onboarding.ts` (found in scope), `build/bundle.mjs`, `test/ui-playwright/theme-rows.test.mjs`, `test/charts.test.ts`, `test/ui-playwright/defensive-loading.test.mjs`.
- Contrast script: `/tmp/contrast_audit.py` (outside the repo; full output `/tmp/contrast_results.txt`). Method: WCAG 2.x relative luminance, thresholds 4.5:1 text / 3:1 UI.
