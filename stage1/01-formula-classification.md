# Stage 1 — Actuarial Formula Classification

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repository:** ErChulo/pbgc-pa-amb-analysis — https://github.com/ErChulo/pbgc-pa-amb-analysis
**Document:** `stage1/01-formula-classification.md` (Stage 1 output 1 of 4)
**Date:** 2026-11-12
**Status:** Stage 1 research — read-only classification. No code, no app, no repo writes in this stage.
**Governing spec:** `MASTER_PROMPT.md` (§2 source hierarchy, §3 fundamental concepts, §4 formula library, §5 historical provisions, §9 rounding, §14 acceptance framework)

---

## 0. The standing requirement — read this first

**The application must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible.** That is what distinguishes this system from an ordinary pension benefit calculator.

Consequences applied throughout this document:

- Every formula entry below ends with item **(11) — when exact reconstruction is impossible**: what bounds or scenarios replace the exact value, and what disposition that supports. No formula entry is allowed to end with a made-up exact number.
- A reconstructed value is reported only with its evidence grade: **fact** (plan document + complete census), **assumption** (stated, sourced, sensitivity-tested), **estimate** (bounded range), or **unknown** (indeterminate — no number offered).
- Where the evidence cannot support an exact number, the system reports a **defensible bound** `B_i^min ≤ B_i^possible ≤ B_i^max` (§12 of the master prompt) or an explicit **scenario set** (e.g. "if the 2004 amendment applied the new rate to all service, B = $X; if only to post-amendment service, B = $Y"), and the disposition is **Requires investigation** or **Indeterminate** — never **Verified** on the strength of a guessed input.
- A numerical match obtained by arbitrarily changing rounding, a measurement date, or an assumption is **not** proof of the administrator's methodology (§9 of the master prompt). Agreement without a shared basis is coincidence, not verification.
- **Never a silent failure.** If a formula cannot be evaluated, the system says so, names the missing input, and records what would resolve it. A blank PA_AMB is missing data, never zero, unless a governing rule explicitly requires zero (§7 of the master prompt).
- The final disposition is always a **human decision** (§14 of the master prompt): Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate. The system proposes; the actuary decides.

---

## 1. The principal input: PA_AMB as defined in the BCV Data Dictionary

### 1.1 Dictionary definition (authoritative for field names)

| Field | Table | Description (verbatim from dictionary) | Type | Classification |
|---|---|---|---|---|
| `PA_AMB` | BCV9 | Plan Administrator Accrued Monthly Benefit at DOTE | NUMBER | Benefit \| DOPT \| Input |
| `PA_AMB_ACCEPT` | BCV3 | Indicator for identifying when plan administrator's AMB is being accepted (Y/N) | VARCHAR2(1) | Plan Admin (Release 6.3) |
| `AMB` | BCV1 | Accrued Monthly Benefit at DOTE | NUMBER | Benefit \| DOPT \| Calculated |
| `VB` | BCV1 | Vested Monthly Benefit in the Normal Single Form (NSF) at NRA at DOTE (before PBGC Limitations) | NUMBER | Benefit \| DOPT \| Calculated |
| `VBNF` | BCV1 | Vested Monthly Benefit in the Automatic Form (unless valid pre-DOPT election) at NRA at DOTE (before PBGC Limitations) | NUMBER | Benefit \| DOPT \| Calculated |
| `VP` | BCV1 | Participant's Vesting Percent at DOTE (enter as fraction, e.g. 1 not 100) | NUMBER | DOPT \| Calculated |
| `DOTE` | BCV1 | Participant's Date of Termination of Employment (DOPT used for default RBD calculation when NULL and RETSTAT is '3' or '4') | DATE | Service \| DOPT \| Input |
| `CSPA` / `CS` | BCV1 | Plan Administrator's Credited (Benefit) Service at DOTE / Years of Credited (Benefit) Service at DOTE | NUMBER | Service \| DOPT \| Input / Calculated |

Source: local copy `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` (2026-10-30 index: 1,172 field records). The `.json` twin in the same directory is not valid JSON (empty first bytes) and was not used; the CSV is the working copy.

### 1.2 What the dictionary establishes — and what it does not

**Established:**
- `PA_AMB` is an **Input** (reported by the plan administrator), while `AMB` is the corresponding **Calculated** value. The comparison `PA_AMB` vs `AMB` is the core of this system.
- The stated measurement basis is **at DOTE** (Date of Termination of Employment). The field name says monthly benefit; the unit is dollars per month (implied by the name and by the `AMB`/`VB`/`VBNF` family, all monthly).
- `PA_AMB_ACCEPT` (Y/N) is the recorded acceptance indicator — the field this system's decision feeds.

**NOT established by the dictionary — do not assume:**
- **Vesting treatment.** The description does not say whether `PA_AMB` is vested or unvested. `VB`/`VBNF` are explicitly vested; `PA_AMB` is not described that way. A PA_AMB that already reflects `VP`, and one that does not, differ by the vesting factor. **Rule: treat vesting treatment of PA_AMB as unknown until case evidence establishes it.** A common diagnostic hypothesis (§10 of the master prompt) is "vesting applied twice or omitted."
- **Annuity form.** The description does not state the normal form (single life, joint-and-survivor, etc.). `VB` is in the Normal Single Form; `VBNF` in the automatic form. PA_AMB's form is unstated.
- **Retirement age / commencement basis.** The description does not state normal retirement age or whether the amount is payable at NRD or at another date.
- **Whether the amount is the administrator's last calculation or a restated amount.** The dictionary gives no record date for the PA_AMB value itself.
- **Measurement date in practice.** Although the description says "at DOTE," the recurring casework problem is that the recorded amount may in fact have been evaluated as of NRD, as of the administrator's calculation date, as of a freeze date, or as of some other date — and the census record does not say which. **Rule (§5 of the master prompt): a recorded amount without an established benefit measurement date must be marked as having an unresolved comparison basis.** The dictionary label is a claim about basis, not proof of it.

### 1.3 PBGC policy corroboration

PBGC current policies (Book of Job, `current-policies.pdf`) use the same concept in worked examples: "Accrued monthly benefit = years of service (YOS) × benefit rate" (Policy example 17, PC3 §411(d)(6) wear-away), and "Sam's accrued monthly benefit is $1,500 as a J&50%S" (QPSA charge example). These confirm the monthly-benefit, at-a-date framing, and show PBGC itself computing accrued monthly benefits at several distinct dates (DOPT, DOPT/BPD-3, last day of old rate, PC3 calculation date) in a single case — the multi-date discipline this system must reproduce.

### 1.4 What PA_AMB is not

- **Not bet.** Benefit Estimation (an estimate of final benefits for a new participant while the case is incomplete) is a separate later work product. PA_AMB analysis verifies a *reported accrued* benefit; bet *projects* a future one.
- **Not the PBGC guaranteed benefit, not the termination benefit.** Those apply Title IV guarantee limits and funding allocations downstream (§3 below). Verifying PA_AMB comes first and must not be confused with computing them.
- **Not a projected benefit.** Any PA_AMB that embeds future service or future compensation is not an accrued benefit as defined in §2, and must be flagged, not accepted as one.

---

## 2. Typed benefits (§3 of the master prompt) — these are not interchangeable

Every benefit quantity in this system is a **typed quantity** carrying at least: monetary amount and periodicity; measurement date; benefit commencement basis; retirement age or date; annuity form; vesting treatment; applicable plan-provision version; source and calculation status. A comparison is valid only after the bases have been established as equivalent.

| # | Typed benefit | Definition | Governing authority |
|---|---|---|---|
| B1 | **Accrued benefit** | Portion of the total retirement benefit earned as of a specified measurement date, under the applicable plan provisions, expressed as an annual benefit commencing at normal retirement age — usually shown monthly, in the plan's normal form. IRC §411(a)(7)(A)(i). | DBAB Q 9:7; IRC §411(a)(7)(A)(i) |
| B2 | **Vested accrued benefit** | `VP × B1` — the nonforfeitable portion. Only the employer-contribution portion is subject to vesting (IRC §411(c)(1); DBAB Q 9:56). | DBAB Q 9:53–9:56; BCV `VP`, `VB`, `VBNF` |
| B3 | **Projected benefit** | Benefit calculated under the plan formula payable at NRD in the normal form, *assuming* the participant continues to NRA (future service/compensation assumed). Used to derive B1 under fractional accrual; never a substitute for B1. | DBAB Q 9:2 |
| B4 | **Benefit payable at commencement** | B1 after early/late retirement adjustments and form-of-payment conversions (ERF/LRF/BFCF; BCV `ERFAEQ`/`LRFAEQ`/`BFCFAEQ`). Depends on commencement age and elected form. | DBAB Q 9:23–9:28; BCV ATPBGC Add-ins |
| B5 | **PBGC guaranteed benefit** | B1 after Title IV guarantee limitations (ERISA §4022, maximum guaranteed benefit, phase-in, substantial-owner limits, PC3/PC4/PC5 allocation). Downstream of PA_AMB verification. | DBAB Ch. 25; PBGC current policies |
| B6 | **PBGC termination benefit** | Benefit under PBGC termination-benefit rules, including funding allocations (priority categories). Downstream of PA_AMB verification. | DBAB Ch. 25, Ch. 27; PBGC current policies |

**Diagnostic rules that follow:**
- If `PA_AMB` ≈ a projected benefit (e.g. matches B3 computed with service to NRA), the hypothesis is "administrator reported a projected benefit as accrued" — a basis error, not a rounding difference.
- If `PA_AMB` ≈ B4 (payable at early commencement) rather than B1, the hypothesis is "commencement adjustment already applied."
- If `PA_AMB` ≈ B2 (vested) while the reconstruction is B1 (unvested), the difference is exactly `VP` — testable, not a mystery.
- If `PA_AMB` matches no typed benefit on any plausible basis, the disposition is **Requires investigation** or **Indeterminate**, with the tested bases listed as evidence.

---

## 3. Temporal model (§5 of the master prompt)

### 3.1 The model

Plan provisions are a time-dependent system `P(t)`; participant history is `X_i(t)`. The accrued benefit is:

```
B_i(t) = F( X_i(≤ t), P(≤ t) )
```

- `P(t)` includes: original adoption, restatements, amendments (adoption date **and** effective date — these differ), formula changes, covered-group changes, compensation-definition changes, freezes, accrual/service-credit rule changes, grandfathering, mergers/transfers, statutory limits and their effective dates.
- `X_i(t)` includes: hire/termination/rehire/transfer dates, participation, credited/vesting/eligibility service, compensation by year, prior distributions, QDRO splits, contributions.
- **Never apply the latest formula retroactively.** Each period's accrual is governed by the provisions in effect for that period, subject to §411(d)(6) protection of benefits already accrued.

### 3.2 Reconstruction dates

The system must be able to reconstruct `B_i(t)` at: historical administrator calculation dates; dates before/after significant amendments; termination of employment (DOTE); benefit freeze dates; bankruptcy filing dates; DOPT; and user-selected dates. It must distinguish **the date an administrator recorded a benefit** from **the date through which that benefit was calculated** — these are different fields and are frequently confused in census data.

### 3.3 Anti-decrease guardrails (legal invariants the engine must enforce)

- An accrued benefit may **never decrease on account of increasing age or service** — IRC §411(b)(1)(G) (DBAB Q 9:14).
- An accrued benefit may **never decrease by plan amendment** — IRC §411(d)(6) (DBAB Q 9:14; Ch. 8). A formula change that would reduce an already-accrued benefit must carry the old benefit forward as a protected floor (see C-04, C-05).
- Apparent decreases are possible only through narrow, documented channels, each a diagnostic hypothesis, not a default: a falling final-average compensation (IRS position changed; 2015 Gray Book Q&A 35 — see DBAB Q 9:15); a rising Social Security offset within Rev. Rul. 84-45 / IRC §401(a)(15) limits, and never for a participant separated after 1974-09-02 (DBAB Q 9:16); a rising covered compensation (DBAB Q 9:17); a §415 limit change insulating pre-change accruals (DBAB Q 9:18). If a reconstructed series decreases and none of these applies, the reconstruction (or the administrator's number) is wrong.
- Normal retirement benefit must be the greater of (1) the benefit under the formula at NRA, or (2) the largest benefit payable at any earlier date — IRC §411(a)(9) (DBAB Q 9:15).

### 3.4 Accrual-method floor

Every plan's accrued benefit must satisfy one of the three IRC §411(b)(1) accrual tests — the **3% rule**, the **133⅓% rule**, or the **fractional accrual rule** (DBAB Q 9:11–9:12). These are anti-backloading floors, not formulas: a reconstruction that accrues slower than the applicable test is not a valid accrued benefit, and a plan formula that fails all three is not a qualified formula. The engine must test the applicable rule for the plan's accrual method; where the plan's method is unknown, the fractional rule is the diagnostic default (it is the method that applies to flat formulas and the one most often misapplied — see T-07).

### 3.5 Measurement-date-unresolved flag

**Rule:** any `BenefitObservation` (a recorded PA_AMB) whose measurement date cannot be established from the census record, the administrator's schedule, or the plan documents is flagged `comparison_basis = UNRESOLVED`. An unresolved-basis observation:
- may be compared only against a **range** of reconstructions (one per plausible measurement date), never against a single date as if that date were known;
- cannot support a **Verified** disposition;
- is the single most common reason a case lands in **Requires investigation** rather than **Supported for acceptance**.

---

## 4. Notation used in every formula entry

| Symbol | Meaning | Units |
|---|---|---|
| `B_t` | Accrued benefit at measurement date `t` | $/year unless stated $/month |
| `B_t^proj` | Projected benefit at NRD (same formula, service/comp to NRA) | $/year |
| `B_t^PA` | Prior administrator's recorded accrued monthly benefit (`PA_AMB`) | $/month |
| `B̂_t` | Independently reconstructed accrued benefit on the same basis | $/month |
| `S_t` | Credited (benefit) service through `t` | years (may be fractional) |
| `S_t^proj` | Total credited service the participant would have at NRD | years |
| `S_max` | Maximum credited service the formula counts | years |
| `C̄_t` | Applicable average compensation at `t` (averaging period per plan) | $/year |
| `C_y` | Compensation in year `y` (after §401(a)(17) cap for that year) | $/year |
| `α`, `α_k` | Accrual rate (unit rate; `k` = service band) | % of compensation per year, or $/month per year |
| `D` | Flat benefit amount | $/month or $/year |
| `L` | Integration / offset level (e.g. covered compensation) | $/year |
| `PIA_t` | Social Security Primary Insurance Amount at `t` | $/month or $/year |
| `VP` | Vesting percent at DOTE (fraction, 0–1) | — |
| `APR_x` | Annuity purchase rate at age/form `x` (plan or PBGC factors) | $ of present value per $1/month |
| `NRA`, `NRD` | Normal retirement age / date | age / date |

**Conventions.** Annual benefits are converted to monthly by ÷12 unless the plan states otherwise. "Monthly benefit" in every test example is the amount payable per month in the plan's normal form at NRD, before vesting, unless the entry says otherwise. All test participants are **fictional**. Where an entry reuses a Defined Benefit Answer Book worked example, that is stated; those examples use fictional companies and people.

---

## 5. Traditional formulas

### T-01 — Flat-dollar benefit

1. **Mathematical definition.** `B_t = D × (S_t / S_full)` (monthly if `D` is monthly), where `D` is the plan's flat amount and `S_full` the service required for the unreduced flat benefit. If the plan states the flat benefit with no service reduction, `B_t = D`.
2. **Required inputs and units.** `D` ($/month or $/year); `S_t` (years); `S_full` (years).
3. **Eligibility/applicability predicates.** Participant meets the plan's participation and normal-retirement conditions; service counted is benefit service as defined (not necessarily vesting or eligibility service).
4. **Effective-date rules.** `D` is the amount in effect under `P(t)` at the measurement date; later amendments increasing `D` apply only as the amendment provides (see C-04/C-05).
5. **Intermediate calculation sequence.** (a) Determine `S_t` and `S_full` at `t`. (b) Compute the service fraction. (c) Multiply by `D`. (d) Convert annual↔monthly.
6. **Rounding conventions.** Plan-stated rounding governs; none is assumed. (Real-plan example: Blonder-Tongue §5.01 rounds the determined benefit to the nearest whole dollar — see C-06.)
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:3 (flat/fixed formula); Q 9:7 (accrued benefit); IRC §411(a)(7)(A)(i).
9. **Boundary conditions and exceptions.** `S_t ≥ S_full` ⇒ full `D` (no extra benefit for excess service unless the plan says so). `S_t = 0` ⇒ `B_t = 0` only if the plan's accrual method yields zero (a participant with participation but no benefit service may still accrue a top-heavy minimum — see C-03). Accrual must satisfy an IRC §411(b)(1) test; the fractional rule is the usual method for flat formulas (see T-07).
10. **Synthetic numerical test example (Answer Book example, fictional).** Reese Company plan: flat `$1,000/month`, `S_full = 25`. Participant Dane, `S_t^proj = 10`: `B^proj = $1,000 − ($1,000 × 15/25) = $400/month`. Participant Brittany, 30 years: full `$1,000/month`. (DBAB Q 9:3, Ex. 1.)
11. **When exact reconstruction is impossible.** If `D` at date `t` is unknown (e.g. the amendment history of the flat amount is missing), report the range over the known candidate `D` values in `P(t)`: `B^min = D_min × (S_t/S_full)`, `B^max = D_max × (S_t/S_full)`. If `S_full` is unknown, scenario-test the plausible values (commonly 25 or 30). Do not pick one `D` and present the result as exact.

### T-02 — Fixed-percentage-of-compensation benefit

1. **Mathematical definition.** `B_t = p × C̄_t × (S_t / S_full)` (annual), where `p` is the fixed percentage and `C̄_t` the applicable average compensation.
2. **Required inputs and units.** `p` (%); `C̄_t` ($/year); `S_t`, `S_full` (years).
3. **Eligibility/applicability predicates.** Same as T-01; the compensation definition in effect at `t` governs `C̄_t` (see §6, compensation measures).
4. **Effective-date rules.** `p` and the averaging period are those in `P(t)`; a change in `p` is an amendment subject to §411(d)(6) (see C-04).
5. **Intermediate calculation sequence.** (a) Compute `C̄_t` over the plan's averaging period. (b) Apply `p`. (c) Apply the service fraction. (d) ÷12 for monthly.
6. **Rounding conventions.** Plan-stated rounding governs; none assumed. Average compensation is rounded only if the plan says so — rounding the average before applying `p` is a distinct hypothesis from rounding the final benefit (§9).
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:3, Ex. 2; Q 9:37–9:45 (compensation definitions); IRC §414(s), §401(a)(17).
9. **Boundary conditions and exceptions.** If `C̄_t` falls (e.g. a low final year enters the average), `B_t` may fall — the only recognized channel is a compensation decrease, and then only as in DBAB Q 9:15. The §401(a)(17) cap applies per compensation year (see X-02).
10. **Synthetic numerical test example (Answer Book example, fictional).** Robby Company plan: `p = 75%` of final 3-year average compensation, `S_full = 30`. Participant Reese, `S_t^proj = 10`: reduction `20/30`; `B^proj = 75% − (75% × 20/30) = 25%` of 3-year average compensation. With `C̄ = $60,000`: `$15,000/year = $1,250/month`. (DBAB Q 9:3, Ex. 2.)
11. **When exact reconstruction is impossible.** If the averaging period is unknown, compute the scenario set over the plausible periods (final 3-year, highest 3-year, final 5-year, career — see T-05/T-06) and report the range. If one or more compensation years are missing, bound `C̄_t` by carrying the known years forward at their observed values (lower bound uses the lowest plausible fill, upper bound the highest) — never fill a missing year with zero unless the plan rule requires it.

### T-03 — Dollar-per-year-of-service benefit

1. **Mathematical definition.** `B_t = d × S_t` (monthly if `d` is $/month per year of service), where `d` is the plan's dollar unit.
2. **Required inputs and units.** `d` ($/month per year, or $/year per year); `S_t` (years, possibly fractional).
3. **Eligibility/applicability predicates.** Participant in a covered group with benefit service; `d` may vary by period (see C-06) or by group (see C-07).
4. **Effective-date rules.** `d` is the rate in effect for each service period under `P(t)`; a rate change mid-career does not re-price earlier service unless the amendment says so (PBGC Policy Ex. 17: a rate decrease from $50 to $25 per month applied prospectively, with the old-rate accrual protected — see C-05).
5. **Intermediate calculation sequence.** (a) Determine `S_t` (and period splits if `d` varies). (b) Multiply each period's service by its `d`. (c) Sum. (d) Apply any service cap (see T-09).
6. **Rounding conventions.** Plan-stated rounding governs. Fractional service years: the plan's service-crediting rule (hours vs elapsed time, Ch. 7) determines whether `S_t` is whole or fractional — do not round service to whole years unless the plan does.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1). This is the most common formula in PBGC trusteed plans and the one PBGC policy examples use ("Accrued monthly benefit = YOS × benefit rate").
8. **Source citations.** DBAB Q 9:4, Ex. 2 ($100/month per year); Q 9:10, Ex. 2; PBGC current policies Ex. 17 (PC3 §411(d)(6) wear-away); DBAB Ch. 7 (service measurement).
9. **Boundary conditions and exceptions.** Service cap (T-09) is the usual limit. A rate decrease is an amendment: the pre-decrease accrual is protected (C-04). Prior distributions offset the benefit (see I-05).
10. **Synthetic numerical test example (Answer Book example, fictional).** Brittany & Associates plan: `$100/month` per year of service. Participant Robby, 35 years at retirement: `$3,500/month`. Accrued with 20 years: `$2,000/month`. (DBAB Q 9:4, Ex. 2; Q 9:10, Ex. 2.)
11. **When exact reconstruction is impossible.** If the historical `d` schedule is incomplete, the bound is `[d_min, d_max] × S_t` over the documented rates; if `S_t` itself is uncertain (e.g. pre-break service disputed — see S-08), bound over the service scenarios. A single-point estimate from an assumed `d` is not a reconstruction.

### T-04 — Unit-credit benefit (percentage of compensation per year of service)

1. **Mathematical definition.** `B_t = α × C̄_t × S_t` (annual), the master-prompt's canonical form `B_t = α S_t C̄_t`, with units of `α` making `B_t` an explicitly annual (÷12 monthly) benefit.
2. **Required inputs and units.** `α` (% of compensation per year, e.g. 1% or 2%); `C̄_t` ($/year); `S_t` (years).
3. **Eligibility/applicability predicates.** Participant with benefit service; the formula applies to service as of the determination date — this is the unit-credit *accrual method* (DBAB Q 9:10), distinct from fractional accrual (T-07).
4. **Effective-date rules.** `α` and the compensation definition are those in `P(t)`; `C̄_t` is measured as of `t` (current average, not projected).
5. **Intermediate calculation sequence.** (a) Compute `C̄_t`. (b) Multiply by `α`. (c) Multiply by `S_t`. (d) ÷12. Each step's rounding is a separate hypothesis (§9).
6. **Rounding conventions.** Plan-stated rounding governs; none assumed. Note the PF precedent: no written PBGC rounding policy exists for benefit amounts; do not import the PF 4-decimal factor convention into benefit rounding.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1). The §411(b)(1) 3% and 133⅓% tests are the natural accrual tests for this method (DBAB Q 9:12).
8. **Source citations.** DBAB Q 9:4; Q 9:10; Q 10:17 (first safe harbor — unit-credit plans); IRC §411(b)(1)(A)–(B).
9. **Boundary conditions and exceptions.** Step rates (T-08) are a generalization; a service cap (T-09) truncates `S_t`. If `C̄_t` decreases, `B_t` can decrease (DBAB Q 9:15 channel only). §415 (X-01) and §401(a)(17) (X-02) cap the result.
10. **Synthetic numerical test example (Answer Book example, fictional).** Dane Company plan: `2%` of final 3-year average compensation per year. Participant Reese, 10 years: `20%` of average. Participant Frank: `C̄ = $60,000`, 20 years, `α = 1%`: `$12,000/year = $1,000/month` accrued; projected with 40 years: `$24,000/year`. (DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1.)
11. **When exact reconstruction is impossible.** The two failure modes are independent: unknown `α` history (bound over the documented rates) and unknown `C̄_t` (bound over averaging-period and missing-year scenarios). Report the bound as the product of the input bounds, and name which input drives the width — do not collapse to a midpoint and call it the benefit.

### T-05 — Career-average compensation benefit

1. **Mathematical definition.** `B_t = α × C̄_t^career × S_t`, where `C̄_t^career = (1/S_t) Σ_y C_y` over all credited years (equivalently `B_t = α × Σ_y C_y` when each year's compensation is credited at rate `α` — the year-by-year form is the safer implementation because it preserves the §401(a)(17) per-year cap).
2. **Required inputs and units.** `α` (%/year); full compensation history `C_y` ($/year by year); `S_t` (years).
3. **Eligibility/applicability predicates.** Plan defines benefits on career-average pay; every credited year contributes.
4. **Effective-date rules.** Each year's compensation is capped at that year's §401(a)(17) limit (X-02); compensation-definition changes apply year by year.
5. **Intermediate calculation sequence.** (a) Assemble `C_y` for each credited year. (b) Apply the per-year §401(a)(17) cap. (c) Average (or accumulate year-by-year). (d) Apply `α × S_t`. (e) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs. Rounding each year's compensation vs rounding only the final average are different hypotheses with different results.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:12 (fractional rule "will not be satisfied" if the average exceeds 10 years — career-average plans cannot use fractional accrual); Q 10:18; IRC §411(b)(1)(C).
9. **Boundary conditions and exceptions.** **The fractional accrual method does not apply** to career-average plans (average period > 10 years); the accrued benefit must be determined by unit credit or another method satisfying an accrual test. Missing early compensation years are the characteristic failure (see item 11). A plan may define career average over compensation *while a participant*, excluding pre-participation years.
10. **Synthetic numerical test example (fictional).** Participant Ana Ruiz (fictional): `α = 1.5%`, 20 years, career-average compensation `$50,000` (sum of capped yearly pay ÷ 20). `B_t = 1.5% × $50,000 × 20 = $15,000/year = $1,250/month`.
11. **When exact reconstruction is impossible.** Missing compensation years are the norm in old cases. Do **not** invent the missing years. Bound `C̄_t^career`: lower bound treats each missing year at the lowest plausible value supported by evidence (e.g. the plan's minimum or the lowest observed year in the same era — stated as an assumption); upper bound at the highest plausible value (e.g. the §401(a)(17) cap for that year, or the highest observed year). If the bound is wider than the acceptance tolerance, the disposition is **Indeterminate** for that participant, with a data request for the missing years — not a point estimate.

### T-06 — Final-average / highest-average compensation benefit

1. **Mathematical definition.** `B_t = α × C̄_t^(n) × S_t`, where `C̄_t^(n)` is the average of the highest `n` consecutive years' compensation (or the final `n` years, if the plan says final rather than highest) through `t`.
2. **Required inputs and units.** `α` (%/year); `n` (years, commonly 3 or 5); compensation history for the averaging window; `S_t` (years).
3. **Eligibility/applicability predicates.** Plan defines the averaging period; "highest" vs "final" is a plan term — the two differ whenever pay falls late in the career, and the distinction is a first-order diagnostic.
4. **Effective-date rules.** Each year in the window is capped at its own year's §401(a)(17) limit (DBAB Q 9:50, Ex. 1–2). A change in `n` is an amendment (fresh-start rules may apply — see C-05).
5. **Intermediate calculation sequence.** (a) Identify the window (highest `n` consecutive years through `t`, or final `n`). (b) Cap each year. (c) Average. (d) Apply `α × S_t`. (e) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs. The average is commonly rounded to whole dollars in plan practice; verify against the plan document, do not assume.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1; Q 9:50–9:52 (§401(a)(17) averaging); Q 10:32 (average annual compensation).
9. **Boundary conditions and exceptions.** A falling average can reduce `B_t` (DBAB Q 9:15 — IRS position changed; treat as a flagged hypothesis, not a routine outcome). Short-service participants may have fewer than `n` years: the plan's rule for short averaging windows (e.g. average over actual years) must be found in the document; if absent, the window is an open item.
10. **Synthetic numerical test example (fictional).** Participant Ben Okafor (fictional): `α = 1.5%`, highest-3-year average `$80,000`, 25 years. `B_t = 1.5% × $80,000 × 25 = $30,000/year = $2,500/month`.
11. **When exact reconstruction is impossible.** If the window years are partly missing, the scenario set is: (i) window = the known years only (plan's short-window rule, if any); (ii) window completed with bounded fills. Report both. If "highest" vs "final" is undocumented, compute both — the difference is itself a diagnostic: if PA_AMB matches one and not the other, that identifies the administrator's convention.

### T-07 — Fractional accrual

1. **Mathematical definition.** `B_t = B_t^proj × (S_t / S_t^proj)`, where `B_t^proj` is the projected benefit at NRD computed on *current* compensation (assumed to continue to NRA) and `S_t^proj` the total service the participant would have at NRD.
2. **Required inputs and units.** `B_t^proj` ($/year); `S_t`, `S_t^proj` (years). The service measure for the fraction may be benefit service, participation, or participation plus pre-participation years, per the plan (DBAB Q 9:8).
3. **Eligibility/applicability predicates.** Plan uses the fractional accrual method (IRC §411(b)(1)(C)); not available for career-average plans (average > 10 years).
4. **Effective-date rules.** `B_t^proj` is recomputed at each measurement date on the compensation then current; the fraction uses service then completed vs service projected to NRA under the plan then in effect.
5. **Intermediate calculation sequence.** (a) Compute `B_t^proj` from the plan formula on current compensation and projected service. (b) Compute the fraction. (c) Multiply. (d) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs. The fraction itself is a source of rounding hypotheses (exact fraction vs rounded percentage).
7. **Output basis.** Monthly benefit in the normal form at NRD (B1). This method accrues in equal portions over total service — it is the method that makes a flat formula (T-01/T-02) produce a smooth accrual.
8. **Source citations.** DBAB Q 9:8 (fractional method); Q 9:9 (partial-year rule, Rev. Rul. 81-11); Q 9:12 (fractional rule); Q 10:18–10:19 (safe harbors); Treas. Reg. §1.411(b)-1(b)(3).
9. **Boundary conditions and exceptions.** **Partial years of participation:** the accrued benefit must be at least the "fractional rule benefit" × an "accrual ratio" that ratchets forward after a partial year (DBAB Q 9:9, Ex. 1: ratio .1125 after a half year, .1379 the next full year; Ex. 2 alternative: 5.5/39.5 = .1392). A plan that simply uses `S_t/S_t^proj` with fractional `S_t` may under-accrue after a partial year — a testable hypothesis when PA_AMB exceeds the naive reconstruction. The denominator may not exceed the plan's service cap (DBAB Q 9:21, Ex. 2: denominator capped at 30).
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Andrew: projected benefit `50%` of final 3-year average compensation; 20 of 30 total years: `B_t = 50% × 20/30 = 33.33%` of average. With average `$60,000`: `$20,000/year = $1,666.67/month`. (DBAB Q 9:8.)
11. **When exact reconstruction is impossible.** The fragile input is `S_t^proj` — it requires the participant's *future* service to NRA, which for a terminated participant is a counterfactual (would they have stayed to NRA?). If the plan's projected-service convention is undocumented, scenario-test: (i) service to NRA at the hire-date pattern; (ii) service to NRA capped at the plan maximum; (iii) service frozen at DOTE. If PA_AMB matches one scenario, that is evidence for the administrator's convention — record it as a hypothesis with its evidence, not as a verified fact.

### T-08 — Step-rate / tiered service formulas

1. **Mathematical definition.** `B_t = C̄_t × Σ_k α_k × S_{t,k}`, where `k` indexes service bands (e.g. first 10 years at `α_1`, next 10 at `α_2`), and `S_{t,k}` is service in band `k` through `t`. Dollar form: `B_t = Σ_k d_k × S_{t,k}`.
2. **Required inputs and units.** Band boundaries (years); `α_k` (%/year) or `d_k` ($/month/year) per band; `C̄_t` ($/year); service split by band.
3. **Eligibility/applicability predicates.** Plan states tiered rates; bands are defined by service (or sometimes by age — an age-banded rate is a different predicate and must not be confused with a service band).
4. **Effective-date rules.** Band rates are those in `P(t)`; an amendment changing a band rate protects accruals already earned in that band (§411(d)(6)).
5. **Intermediate calculation sequence.** (a) Split `S_t` into bands. (b) Apply each band's rate. (c) Sum. (d) ÷12 (percentage form).
6. **Rounding conventions.** Plan-stated rounding governs; rounding per band vs rounding the total are distinct hypotheses.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:12, Ex. 1 (1% / 1.4% / 1.65% tiers, 3% rule test); Q 10:17 (first safe harbor example: 2% / 1.5% / 2% tiers); IRC §411(b)(1)(B) (133⅓% rule — a later band's rate may not exceed 133⅓% of any earlier band's rate).
9. **Boundary conditions and exceptions.** The **133⅓% rule** is the binding constraint: e.g. 1% then 1.5% fails (150% > 133⅓%) — DBAB Q 9:12, Ex. 2. A tiered formula that violates it is not a valid qualified formula; if the administrator's numbers imply such rates, the hypothesis is that the administrator used a different band split. Bands may also be defined by compensation level (that is integration — see I-01, not this entry).
10. **Synthetic numerical test example (Answer Book example, fictional).** Dane Company plan: `1%` first 15 years, `1.4%` next 5, `1.65%` last 5, max 25 years; maximum `30.25%` of compensation. Participant with `C̄ = $60,000`, 25 years: `30.25% × $60,000 = $18,150/year = $1,512.50/month`. (DBAB Q 9:12, Ex. 1.)
11. **When exact reconstruction is impossible.** If band boundaries are undocumented, the service split is unknown and the benefit is bounded by the all-lowest-rate and all-highest-rate extremes — usually too wide to accept. The useful fallback is the *pattern* test: if PA_AMB is consistent with only one band split among the plausible ones, that split becomes a documented hypothesis (ranked by evidence, §10 of the master prompt), and the disposition stays **Requires investigation** until the plan document confirms it.

### T-09 — Maximum credited-service limits

1. **Mathematical definition.** `B_t = F(C̄_t, min(S_t, S_max))` — the underlying formula `F` (any of T-01–T-08) evaluated with service capped at `S_max`. The cap applies to *service counted*, not to the benefit directly.
2. **Required inputs and units.** `S_max` (years); the underlying formula's inputs.
3. **Eligibility/applicability predicates.** Plan states a maximum; the cap is a plan term, not a statutory limit (statutory caps are X-01/X-02).
4. **Effective-date rules.** The cap in effect at `t` under `P(t)`; a cap introduced by amendment protects prior accruals (C-04).
5. **Intermediate calculation sequence.** (a) Compute `S_t`. (b) Cap at `S_max`. (c) Evaluate the underlying formula. (d) Note: in a final-average plan the benefit can still grow after the cap through `C̄_t` increases (DBAB Q 9:21, Ex. 1).
6. **Rounding conventions.** As the underlying formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:21 (service limits; flat-formula denominator cap); Blonder-Tongue plan §5.01 (30-year cap, "30 years immediately preceding termination of employment").
9. **Boundary conditions and exceptions.** The cap interacts with the *period* rule: Blonder-Tongue counts the 30 years immediately preceding termination — so which years' rates apply depends on the cap, not just the total. A cap on service is not a cap on compensation. For flat formulas the *denominator* of the fractional accrual is capped, not the numerator alone (DBAB Q 9:21, Ex. 2).
10. **Synthetic numerical test example (fictional).** Participant Carla Mendes (fictional): `1%` of highest-3-year average `$80,000`, cap 25 years, actual service 35 years. `B_t = 1% × $80,000 × 25 = $20,000/year = $1,666.67/month` — the extra 10 years add nothing, but a later rise in the average would still raise the benefit.
11. **When exact reconstruction is impossible.** If `S_max` is unknown, the bound is `[F(S_t uncapped) as max, F(min plausible cap) as min]` — wide and usually indeterminate. If the *which-years* rule is unknown (last-N-years vs first-N-years), compute both: in a period-rated plan (C-06) they differ materially, and the difference is a diagnostic, not a rounding error.

---

## 6. Integrated formulas

General note: integration is where PA_AMB verification most often fails on *inputs* rather than arithmetic. Covered compensation, PIA, and offset levels are non-census inputs (master prompt §6) that must be sourced from SSA tables, the plan document, or the administrator's schedule — and their absence is the commonest reason for an **Indeterminate** disposition on an integrated formula.

### I-01 — Excess benefit formula

1. **Mathematical definition.** Unit-credit form: `B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × S_t`. Flat form: `B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × (S_t / S_full)`.
2. **Required inputs and units.** Base rate `β_b` (%/year); excess rate `β_e` (%/year); integration level `L` ($/year); `C̄_t` ($/year); `S_t` (years).
3. **Eligibility/applicability predicates.** Plan is an excess plan under IRC §401(l); the excess rate must satisfy the permitted-disparity limits (see I-03).
4. **Effective-date rules.** `L` and the rates are those in `P(t)`; if `L` is covered compensation it changes annually by birth year (see I-02).
5. **Intermediate calculation sequence.** (a) Split `C̄_t` at `L`. (b) Apply `β_b` below, `β_e` above. (c) Sum. (d) Multiply by service (and service fraction for flat form). (e) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs. The split point `L` is not rounded; the two components may be rounded separately or jointly — distinct hypotheses.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:5 (excess fixed and excess unit-credit examples); Q 10:26–10:30 (permitted disparity); Treas. Reg. §1.401(l)-3.
9. **Boundary conditions and exceptions.** If `C̄_t ≤ L`, the formula collapses to the base rate — an administrator's number consistent with the base rate alone may mean the participant was below the integration level, not that integration was ignored. The excess rate may not exceed the base rate by more than the maximum excess allowance (I-03).
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Frank: average compensation `$80,000`, covered compensation `$45,000`, 25 years. Excess unit-credit: `1%` up to CC + `1.65%` excess: `1% × $45,000 = $450`; `1.65% × ($80,000 − $45,000) = $578`; sum `$1,028 × 25 = $25,700/year = $2,142/month`. Excess fixed: `20%` up to CC + `40%` excess, reduced for service under 35: `$23,000 × (1 − 10/35) = $16,429/year = $1,369/month`. (DBAB Q 9:5.)
11. **When exact reconstruction is impossible.** If `L` is unknown, bound the benefit between the all-base-rate value (`β_b × C̄_t × S_t`) and the all-excess-rate value (`β_e × C̄_t × S_t`). If `C̄_t` is near the plausible range of `L`, the bound is wide and the case is indeterminate on this formula alone — the data request is for the plan's integration level, a single document fact that collapses the range.

### I-02 — Covered-compensation integration

1. **Mathematical definition.** Same structure as I-01 with `L = CC_i(t)`, the participant's **covered compensation**: the average of the Social Security taxable wage bases over the participant's working lifetime (or 35 years if less), determined by birth year and calculation date.
2. **Required inputs and units.** Birth year; calculation date; the covered-compensation table for that year (IRS-published, Appendix A of the Answer Book); `C̄_t`; `S_t`.
3. **Eligibility/applicability predicates.** Plan uses covered compensation as its integration level (the common case) rather than a fixed dollar level.
4. **Effective-date rules.** Covered compensation is determined as of the benefit calculation date and changes when the table is updated; a later table must not be applied to an earlier calculation date.
5. **Intermediate calculation sequence.** (a) Look up `CC_i(t)` by birth year and calculation year. (b) Proceed as I-01.
6. **Rounding conventions.** Covered-compensation tables are published in whole dollars; do not re-derive or round them.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:5 ("The average of the taxable wage bases is known as covered compensation"); Q 10:31–10:35 (covered compensation); IRC §401(l).
9. **Boundary conditions and exceptions.** **Accrued benefit and covered compensation:** IRC §401(a)(15) prohibits reducing an accrued benefit because covered compensation or the taxable wage base increased, for anyone separated after 1974-09-02 (DBAB Q 9:16–9:17). If a reconstruction shows `B_t` falling as `CC` rises for a separated participant, the reconstruction is wrong — or the administrator's number is. Rev. Rul. 84-45 limits offsets when estimated (not actual) wage history is used.
10. **Synthetic numerical test example.** Same arithmetic as I-01 (Frank: `CC = $45,000`): `$25,700/year = $2,142/month`. The test value of this entry is the *lookup*: for a fictional participant born 1960 with calculation date 2024, the covered-compensation table value must be taken from the IRS table for 2024 — the engine must fail loudly if that table is not loaded, not substitute a neighboring year.
11. **When exact reconstruction is impossible.** If birth year is missing, `CC` is unknown and the benefit is bounded by the `CC` range over the plausible birth years — often the widest bound in the system. **Do not estimate a birth year from age bands.** The disposition is **Indeterminate** until the birth year is established; the data request is a single field.

### I-03 — Social Security permitted disparity (IRC §401(l))

1. **Mathematical definition.** Excess plan: `B_t = [β_base × C̄_t + β_excess × max(C̄_t − L, 0)] × S_t`, with `β_excess ≤ min(0.75%, β_base)` (maximum excess allowance), adjusted when the integration level exceeds covered compensation. Offset plan: `B_t = [γ_gross × C̄_t − γ_offset × min(C̄_t, L)] × S_t`, with `γ_offset ≤ min(0.75%, ½ γ_gross × C̄_t / min(C̄_t, L))` (maximum offset allowance).
2. **Required inputs and units.** Base/gross rate, excess/offset rate (%/year); integration or offset level `L` ($/year); `C̄_t`; `S_t` (max 35 years counted for disparity purposes).
3. **Eligibility/applicability predicates.** Plan is a §401(l) plan; disparity provided on a uniform basis (Treas. Reg. §1.401(l)-3(f)); the two-step unit-credit formula (DBAB Q 10:25) is the common design.
4. **Effective-date rules.** The 0.75% allowances and the 35-year cap are statutory; the plan's rates and level are those in `P(t)`.
5. **Intermediate calculation sequence.** (a) Determine gross/base component. (b) Determine excess/offset component subject to the allowance caps. (c) Combine. (d) Apply service (≤35 years for disparity). (e) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs; the allowance caps are exact percentages — do not round `0.75%` to `0.8%`.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 10:25 (two-step unit-credit formula); Q 10:26 (permitted disparity); Q 10:27–10:30 (integration level, offset level, maximum excess/offset allowances); IRC §401(l); Treas. Reg. §1.401(l)-3; DBAB Ch. 11 (advanced design, accrual rates).
9. **Boundary conditions and exceptions.** If `β_base < 0.75%`, the maximum excess allowance is `β_base`, not 0.75% (DBAB Q 10:29 example: base 0.5% ⇒ excess allowance 0.5%). Service beyond 35 years earns no additional disparity. Uniformity: a benefit, right, or feature provided on excess compensation must also be provided below the level (DBAB Q 10:26, Wacky Widgets example — a death benefit on excess only fails uniformity).
10. **Synthetic numerical test example (fictional, modeled on DBAB Q 10:26).** Participant Dana Kim (fictional): base `0.75%` of average compensation + `0.65%` of compensation over integration level `$10,000`, 20 years, `C̄ = $60,000`. `B_t = [0.75% × $60,000 + 0.65% × $50,000] × 20 = [$450 + $325] × 20 = $15,500/year = $1,291.67/month`. Excess allowance check: `0.65% ≤ min(0.75%, 0.75%)` ✓.
11. **When exact reconstruction is impossible.** If the plan's integration level is a fixed dollar amount that is undocumented, the bound is the same as I-01. If the plan's disparity *method* (excess vs offset) is undocumented, compute both — they are algebraically close by construction (DBAB Q 9:5: excess and offset examples give `$16,429` identically in the fixed form) so a match to either does not identify the method; record the method as unresolved and the amount as supported-only-if-both-agree.

### I-04 — Primary Insurance Amount (PIA) offsets

1. **Mathematical definition.** `B_t = B_t^gross − γ × PIA_t × (S_t / S_ref)`, where `B_t^gross` is the benefit before offset, `γ` the offset fraction, and `S_t/S_ref` the plan's service proration of the offset if any. Some plans offset a flat percentage of PIA with no proration; the plan term governs.
2. **Required inputs and units.** `B_t^gross` ($/year); `PIA_t` ($/month or $/year — units must match); `γ` (%); proration denominator `S_ref` (years) if any.
3. **Eligibility/applicability predicates.** Plan contains a PIA-offset formula (DBAB Q 9:6); PIA is the participant's Social Security benefit, estimated or actual per the plan.
4. **Effective-date rules.** PIA is determined under the Social Security Act in effect at the relevant date (BCV `IACT` field records which Act version applies); an estimated PIA uses the plan's estimation method, which must be documented.
5. **Intermediate calculation sequence.** (a) Compute gross benefit. (b) Determine PIA (actual wage history preferred; estimated only per plan rule). (c) Apply `γ` and proration. (d) Subtract. (e) Floor at zero unless the plan provides otherwise. (f) ÷12.
6. **Rounding conventions.** Plan-stated rounding governs. PIA itself is a whole-dollar monthly amount under SSA rules; do not round the offset before subtracting unless the plan says so.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:6 (PIA offset formula); Q 9:16 (Rev. Rul. 84-45; IRC §401(a)(15)); BCV `IACT`, `PIASSNRA` (PIA-related add-in inputs).
9. **Boundary conditions and exceptions.** **Never offset with an estimated PIA in a way that forfeits accrued benefits:** Rev. Rul. 84-45 — an offset may cause an impermissible forfeiture when the employer uses estimated rather than actual wage history. **Never reduce a separated participant's accrued benefit because the offset grew** (IRC §401(a)(15), DBAB Q 9:16). The offset applies to the accrued benefit, not to the projected benefit, unless the plan says otherwise.
10. **Synthetic numerical test example (fictional).** Participant Eli Torres (fictional): gross `2% × $72,000 × 20 = $28,800/year`; PIA `$18,000/year`; offset `50% × PIA = $9,000/year`. `B_t = $28,800 − $9,000 = $19,800/year = $1,650/month`.
11. **When exact reconstruction is impossible.** PIA is very often unreconstructable from census data alone (it needs the full SSA wage history). The bound: lower bound uses the maximum plausible PIA (largest offset ⇒ smallest benefit), upper bound uses the minimum plausible PIA — with the plan's PIA estimation method as the documented middle scenario if the plan states one. If no PIA evidence exists at all, the entry is **Indeterminate** and the data request is the administrator's PIA worksheet, not a re-estimate by the system.

### I-05 — Other plan-specific offsets (floor-offset, prior distributions, other-plan offsets)

1. **Mathematical definition.** `B_t^net = max(B_t^gross − Offset_t, 0)`, where `Offset_t` is the monthly benefit deemed provided by the offsetting source. Floor-offset: `Offset_t = ProjDC_t / APR`, with `ProjDC_t` the defined-contribution account projected to NRA at the DB plan's interest rate assuming **no future contributions**. Prior-distribution offset: `Offset_t = actuarial equivalent of prior distributions` (see X-04, Option 3). Other-plan offset: as the plan defines.
2. **Required inputs and units.** Gross accrued benefit ($/month); DC account balance ($); projection interest rate; APR at NRA; vesting percent of the DC account; prior distribution amounts and dates.
3. **Eligibility/applicability predicates.** Plan is a floor-offset arrangement (DBAB Q 4:15–4:31) or otherwise states an offset; only the **vested** portion of a DC account may offset (Rev. Rul. 76-259).
4. **Effective-date rules.** The offset is determined as of the plan's stated determination date; in a frozen DB plan subject to a floor-offset, the offset is frozen too — future DC contributions after the freeze may **not** reduce the accrued benefit (DBAB Q 4:29, 2005 ASPPA Q&A 5, informal IRS position; §411(d)(6)).
5. **Intermediate calculation sequence.** (a) Compute gross accrued benefit ignoring the offset (it must satisfy §411(b)(1) on its own — Rev. Rul. 76-259). (b) Project the DC balance to NRA with interest only. (c) Divide by the plan APR to get the monthly offset. (d) Subtract from the gross accrued benefit. (e) Floor at zero.
6. **Rounding conventions.** Plan-stated rounding governs.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1), net of offset.
8. **Source citations.** DBAB Q 4:16 (accrual rules for floor-offset); Q 4:27 (accrued benefit determination, worked example); Q 4:28 (current-accrual offset is **not** acceptable); Q 4:29 (frozen-plan offset); Q 4:31 (cash-balance floor-offset); Rev. Rul. 76-259.
9. **Boundary conditions and exceptions.** **It is not acceptable** to determine the net benefit as the current accrual offset by the current DC contribution (DBAB Q 4:28) — the offset is on an accumulated basis. A participant whose entire benefit is offset is still treated as benefiting for §410(b)/§401(a)(4) (DBAB Q 4:18). For §401(a)(26) meaningful-benefit testing, a concurrent offset arrangement is tested on the gross benefit (DBAB Q 4:19–4:20).
10. **Synthetic numerical test example (Answer Book example, fictional).** Floor-offset plan (DBAB Q 4:27): Employee A — DC account `$50,000`, projected `$98,358`, APR `120` ⇒ offset `$820/month`; gross accrued `$1,000/month`; net `$180/month`. Employee B — account `$490`, projected `$3,730`, offset `$31`; gross accrued `$33`; net `$2/month`.
11. **When exact reconstruction is impossible.** The DC account history is usually absent from the census. Without it, the gross benefit can still be reconstructed exactly, and the *net* benefit is bounded: `[max(B^gross − Offset_max, 0), B^gross]`, where `Offset_max` is the largest offset consistent with any evidence (e.g. the administrator's own offset figure, if recorded). Report the gross and the bound separately — never present the gross as the net.

---

## 7. Combination formulas

### C-01 — Greater-of formulas

1. **Mathematical definition.** `B_t = max(B_t^(1), B_t^(2), …, B_t^(n))`, each `B_t^(k)` computed under its own formula (different bases, e.g. highest-average vs career-average, or DB vs hybrid).
2. **Required inputs and units.** The inputs of each component formula.
3. **Eligibility/applicability predicates.** Plan states a greater-of benefit for a specified group; each component formula must be evaluated for that participant.
4. **Effective-date rules.** Each component uses the provisions in effect for its own period; a later amendment may add a component without removing an earlier one (§411(d)(6)).
5. **Intermediate calculation sequence.** (a) Compute each component on its own basis. (b) Take the maximum. (c) Record which component won, and by how much — the margin is diagnostic evidence.
6. **Rounding conventions.** As the winning component's formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:13 (multiple formulas; Rev. Rul. 2008-7 relief; Prop. Treas. Reg. §1.411(b)-1(b)(2)(ii)(G) separate-bases rule and anti-abuse rule); Q 10:18–10:19.
9. **Boundary conditions and exceptions.** Accrual testing: the components are generally aggregated, except that a greater-of plan may test each formula separately if each uses a **different basis** and each satisfies an accrual rule (separate-bases requirement). If two formulas share a basis they must be aggregated. An anti-abuse rule denies separate testing if the different bases are structured to evade aggregation.
10. **Synthetic numerical test example (fictional).** Participant Fatima Diallo (fictional): formula A (unit-credit) `1.5% × $60,000 × 20 = $18,000/year`; formula B (flat) `$1,000/month = $12,000/year`. `B_t = max($18,000, $12,000) = $18,000/year = $1,500/month` (formula A wins by `$500/month`).
11. **When exact reconstruction is impossible.** If one component cannot be computed, the greater-of is bounded below by the best computable component and above by the best computable component plus the maximum plausible value of the uncomputable one. If PA_AMB exceeds every computable component, the uncomputable component is implicated — that is evidence, and the disposition is **Requires investigation** with the missing component named.

### C-02 — Lesser-of formulas

1. **Mathematical definition.** `B_t = min(B_t^(1), B_t^(2), …, B_t^(n))`.
2. **Required inputs and units.** The inputs of each component formula.
3. **Eligibility/applicability predicates.** Plan states a lesser-of benefit; the commonest instance is statutory — the §415 limit is a lesser-of (see X-01) — but a plan may also state one (e.g. lesser of the formula benefit and a collectively-bargained cap).
4. **Effective-date rules.** Each component as in effect at `t`.
5. **Intermediate calculation sequence.** (a) Compute each component. (b) Take the minimum. (c) Record which component bound, and by how much.
6. **Rounding conventions.** As the binding component's formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:13 (aggregation of multiple formulas); Q 12:4–12:5 (§415 lesser-of); IRC §415(b).
9. **Boundary conditions and exceptions.** A lesser-of with a §415 component can only bind downward; if the administrator's number exceeds the §415 component, the administrator's number is wrong (or the §415 inputs are). A lesser-of that binds on a component the actuary cannot compute yields an upper bound only.
10. **Synthetic numerical test example (fictional).** Participant George Park (fictional): formula benefit `$2,000/month`; §415-limited benefit `$1,800/month`. `B_t = min($2,000, $1,800) = $1,800/month` (§415 binds by `$200/month`).
11. **When exact reconstruction is impossible.** If the binding component is uncomputable, only an upper bound exists (`B_t ≤` the smallest computable component). Report the bound and the missing component; do not assume the uncomputable component does not bind.

### C-03 — Minimum benefit guarantees (including top-heavy minimum)

1. **Mathematical definition.** `B_t = max(B_t^formula, B_t^min)`. Top-heavy minimum (IRC §416(c)(1)(B)): `B_t^TH = 2% × C̄_t^(5yr-highest) × S_t^TH`, capped at `20%` of average compensation.
2. **Required inputs and units.** Formula benefit ($/month); minimum benefit ($/month or its parameters); for top-heavy: 5-year highest average compensation ($/year); top-heavy service `S_t^TH` (years).
3. **Eligibility/applicability predicates.** Top-heavy minimum applies to each non-key employee with ≥1,000 hours in an accrual period in a top-heavy plan year — even if otherwise excluded from participation (DBAB Q 9:35). Plan minimums apply per plan terms.
4. **Effective-date rules.** Only years in which the plan was top-heavy count (and, after 2001, only years a key employee benefited); pre-1984 years may be disregarded (DBAB Q 9:32). The plan must track top-heavy years.
5. **Intermediate calculation sequence.** (a) Compute the formula benefit. (b) Compute the minimum. (c) Take the greater. (d) If the formula benefit already exceeds the minimum, no additional benefit is required (DBAB Q 9:33).
6. **Rounding conventions.** Plan-stated rounding governs.
7. **Output basis.** Monthly benefit, single life annuity at NRA for the top-heavy minimum (DBAB Q 9:34); the plan minimum in the normal form.
8. **Source citations.** DBAB Q 9:29–9:36 (top-heavy); IRC §416(c); Treas. Reg. §1.416-1 Q&A M-2–M-12; Q 9:36 (DB+DC top-heavy options, including the floor-offset approach under Rev. Rul. 76-259).
9. **Boundary conditions and exceptions.** Top-heavy minimum is 2% per year **to 20% maximum**; a participant with 5 top-heavy years gets 10%. Benefits already accrued can satisfy the minimum. If the employer has both a top-heavy DB and DC plan, four options exist (DB minimum alone; floor-offset; comparability; 5% DC contribution) — the plan's election must be found.
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Nick: 5-year highest average `$40,000`, 5 top-heavy years: minimum `2% × 5 × $40,000 = $4,000/year = $333.33/month`. Nick's formula benefit is 30% of average, so no additional top-heavy benefit is required. (DBAB Q 9:30–9:33.)
11. **When exact reconstruction is impossible.** Top-heavy years are often undocumented in old cases. Bound the minimum over the plausible top-heavy-year counts (0 to all years). If the formula benefit exceeds even the maximum plausible minimum, the minimum is moot and the case can proceed — record that reasoning. If it does not, the disposition depends on the top-heavy history and is **Requires investigation** until that history is found.

### C-04 — Grandfathered benefit protections (IRC §411(d)(6))

1. **Mathematical definition.** `B_t = max(B_t^current-formula, B_t^protected)`, where `B_t^protected` is the accrued benefit under the pre-amendment provisions as of the amendment date, preserved against reduction.
2. **Required inputs and units.** Protected benefit at the amendment date ($/month); current-formula benefit ($/month); amendment adoption and effective dates.
3. **Eligibility/applicability predicates.** A plan amendment reduced the rate of future accrual or an early-retirement benefit/retirement-type subsidy; participants who had accrued under the old provisions are protected.
4. **Effective-date rules.** Protection attaches at the amendment's applicable date; the protected benefit is frozen in its own terms (it may still grow through compensation increases only if the plan's protection method allows — see C-05 wear-away variants).
5. **Intermediate calculation sequence.** (a) Compute the accrued benefit as of the day before the amendment under the old provisions. (b) Compute the benefit under the new provisions. (c) Pay the greater (subject to the plan's wear-away method).
6. **Rounding conventions.** As the underlying formulas.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** IRC §411(d)(6); DBAB Q 9:14; Q 9:27 (optional-form protection on assumption changes, Treas. Reg. §1.411(d)-4); PBGC current policies Ex. 17 (PC3 recognition of §411(d)(6)-protected decreases); DBAB Q 26:1 (freeze amendments must comply with §411(d)(6)).
9. **Boundary conditions and exceptions.** Adding a suspension-of-benefits clause for benefits already earned is a §411(d)(6) cutback (Central Laborers' Pension Fund v. Heinz, 124 S. Ct. 2230 (2004) — DBAB Q 9:60). Changing actuarial equivalence assumptions may not reduce any optional form below its pre-amendment value (DBAB Q 9:27, Kelly example). Protection is participant-specific: a participant with no pre-amendment accrual has nothing protected.
10. **Synthetic numerical test example (fictional).** Participant Hannah Weiss (fictional): old formula gives `$2,000/month` accrued at the amendment date; new formula gives `$1,800/month` on the same service. `B_t = max($2,000, $1,800) = $2,000/month` (protected benefit wins by `$200/month`).
11. **When exact reconstruction is impossible.** If the pre-amendment benefit cannot be computed (old formula or old compensation missing), the protected amount is bounded below by the earliest documented accrued benefit and above by the current-formula benefit recomputed on the most generous plausible old terms. If PA_AMB exceeds the current-formula benefit, grandfathering is the leading hypothesis — test it before assuming administrator error.

### C-05 — Transitional formulas following plan amendments (fresh-start formulas)

1. **Mathematical definition.** Three statutory methods (Treas. Reg. §1.401(a)(4)-13(c)(4); DBAB Q 9:51), for the §401(a)(17) and OBRA '93 fresh-start dates (see X-02): **Method 1 — without wear-away:** `B_t = B^frozen + B^post-fresh-start` (frozen benefit plus accruals on post-fresh-start service only). **Method 2 — with wear-away:** `B_t = max(B^frozen, B^current-formula-on-total-service)`. **Method 3 — extended wear-away:** `B_t = max(Method 1, Method 2)`.
2. **Required inputs and units.** Frozen accrued benefit at the fresh-start date ($/year); post-fresh-start service (years); current compensation average ($/year); total service (years); the plan's elected method.
3. **Eligibility/applicability predicates.** The plan's compensation limit changed by statute (1989, OBRA '93 1994, EGTRRA 2002) or the plan was otherwise amended with a fresh-start provision; the plan document elects one of the three methods.
4. **Effective-date rules.** The frozen benefit is computed as if the plan had been frozen the day before the fresh-start date, using the compensation, formula, and limit then in effect. The fresh-start date is the day after. EGTRRA offers a separate election: apply the new $200,000 limit to prior years or only prospectively (DBAB Q 9:50, Ex. 3).
5. **Intermediate calculation sequence.** (a) Compute `B^frozen` at the fresh-start date. (b) Compute the post-fresh-start accrual (Method 1) or the total-service recomputation (Method 2). (c) Apply the elected method's combination rule. (d) ÷12.
6. **Rounding conventions.** As the underlying formulas. The frozen benefit is a fixed anchor — do not re-round it when combining.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:50–9:52 (compensation-limit fresh starts; frozen-benefit increase fraction); Treas. Reg. §1.401(a)(17)-1(e)(5); PBGC current policies Ex. 17 (wear-away protection in a rate decrease — same structure, different trigger).
9. **Boundary conditions and exceptions.** A frozen benefit **can** be increased after the fresh-start date if the plan provides: multiply by `current average compensation ÷ compensation used for the frozen benefit` (DBAB Q 9:52). The OBRA '93 fresh-start date differs from the statutory effective date; both must be tracked. The EGTRRA retroactivity election must be in the plan document.
10. **Synthetic numerical test example (Answer Book example, fictional).** D&R Pension Plan, `2%` of highest-3-year average per year; statutory fresh-start 1988-12-31; participant Dane: frozen benefit `$25,000/year` (2% × 5 × $250,000). Method 1 (without wear-away), end of 1989: `$25,000 + (2% × 1 × $200,000) = $29,000/year = $2,416.67/month`. Method 2 (with wear-away): `max($25,000, 2% × 6 × $200,000 = $24,000) = $25,000/year = $2,083.33/month`. (DBAB Q 9:51, Ex. 1–2.)
11. **When exact reconstruction is impossible.** The frozen benefit is the anchor: if it cannot be computed (pre-fresh-start compensation missing), the whole post-fresh-start benefit is unbounded above by the total-service recomputation and below by nothing documented — **Indeterminate** unless some earlier administrator schedule states the frozen amount. If the plan's elected method is unknown, compute all three methods as scenarios; if PA_AMB matches exactly one, that method becomes a ranked hypothesis.

### C-06 — Multiple accrual formulas by period

1. **Mathematical definition.** `B_t = Σ_p F_p(C̄_t^(p), S_{t,p})`, where `p` indexes historical periods, each with its own formula `F_p` and service `S_{t,p}` in that period. (Generalizes T-03 period rates and T-08 bands: here the *formula itself* changes, not just its rate.)
2. **Required inputs and units.** Period boundaries (dates); each period's formula and its inputs; service split by period.
3. **Eligibility/applicability predicates.** Plan history contains formula changes (restatements/amendments) with stated effective dates; each period's accrual is governed by its own period's provisions.
4. **Effective-date rules.** The period's formula applies to service in that period; a new formula does not re-price earlier periods except through a stated fresh-start or grandfathering rule (C-04/C-05). Amendment adoption date ≠ effective date — use the effective date for the period split.
5. **Intermediate calculation sequence.** (a) Split service into periods at each formula-change effective date. (b) Evaluate each period's formula on its period service (and, where the period formula is compensation-based, the compensation measure applicable to that period). (c) Sum the period benefits. (d) Apply caps and minima to the total as the plan provides.
6. **Rounding conventions.** Plan-stated rounding governs, per period and on the total — distinct hypotheses.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Ch. 9 generally; Blonder-Tongue Laboratories plan §5.01 (real plan in the local review set, `~/workspace/pbgc_review/plan_docs/Blond-2006-plan.txt`): period unit-benefit table `$42.00` (hire–2/5/82) rising by amendment to `$222.00` (2/6/04 and after), 30-year cap, "30 years immediately preceding termination of employment," benefit "rounded to the nearest whole dollar."
9. **Boundary conditions and exceptions.** The 30-years-immediately-preceding-termination rule (Blonder-Tongue) means the *cap* selects which periods count — a participant with 35 years uses only the last 30 years' rates. Service before the plan's effective date is excluded unless past-service credit was granted (S-07). Overlapping periods (e.g. a restatement with a retroactive effective date) must be resolved by the amendment's own terms, never by assumption.
10. **Synthetic numerical test example (fictional, Blonder-Tongue structure).** Participant Ivan Petrov (fictional): 10 years at `$90/month` per year (1986–1988 period rate) + 10 years at `$150/month` per year (1991–1994 period rate). `B_t = (10 × $90) + (10 × $150) = $900 + $1,500 = $2,400/month`, rounded to the nearest whole dollar (already whole).
11. **When exact reconstruction is impossible.** If a period's formula is missing, that period's accrual is bounded by `[0, max plausible period rate × S_{t,p}]` — and the total is a range, not a number. If period boundaries are uncertain (adoption vs effective date), compute both splits. The most useful output in this situation is often the *period attribution table* (service and rate per period, with unknowns marked) rather than any total.

### C-07 — Union / nonunion / group-specific formulas

1. **Mathematical definition.** `B_t = F_{g(i)}(X_i(≤t), P(≤t))`, where `g(i)` is the participant's employment group (union local, nonunion, salaried/hourly, division, location) and `F_g` that group's formula.
2. **Required inputs and units.** Group identifier; each group's formula and inputs; group-membership history (participants change groups — the group at each service date governs that service).
3. **Eligibility/applicability predicates.** Plan (or CBA) defines different formulas by group; group membership is determined by employment records.
4. **Effective-date rules.** Group formulas change by CBA effective dates as well as plan amendments; a group transfer moves the participant to the new group's formula prospectively (prior service stays under the old group's formula unless the plan says otherwise).
5. **Intermediate calculation sequence.** (a) Determine the participant's group at each service date. (b) Split service by group. (c) Evaluate each group's formula on its service. (d) Combine as the plan provides (usually summed; sometimes greater-of).
6. **Rounding conventions.** As each group's formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:13 (separate accrual testing by classification of employees, Treas. Reg. §1.411(b)-1(a)(1)); Q 10:16 (features that do not disqualify safe harbors); Ch. 7 (service by group); the R5 plan-summary provisions A–S include group/coverage provisions (local `~/workspace/pbgc_review/r5/`).
9. **Boundary conditions and exceptions.** Separate accrual testing by classification is allowed only if the classifications are not structured to evade §411(b)/§401(a)(4). A participant with service in two groups may have two different benefit rates for different periods — the same structure as C-06 with group boundaries instead of date boundaries. Missing group history is a common census gap.
10. **Synthetic numerical test example (fictional).** Participant Julia Santos (fictional): 25 years union service at `$80/month` per year = `$2,000/month` under the union formula; the nonunion formula would give `1.5% × $60,000 × 25 ÷ 12 = $1,875/month`. As a union participant, `B_t = $2,000/month`.
11. **When exact reconstruction is impossible.** If group membership is unknown for some service, bound the benefit over the groups the participant could have belonged to, and use any corroborating field (e.g. CBA coverage dates, job title, location) to narrow it. If the group cannot be narrowed, the disposition is **Requires investigation** — the group is a single document fact that resolves the range.

---

## 8. Special plan designs

### S-01 — Cash balance plans

1. **Mathematical definition.** Hypothetical account: `H_t = Σ_y [PC_y × Π_{k>y} (1 + i_k)]`, where `PC_y` is the pay (principal) credit for year `y` and `i_k` the interest credit for year `k`. Accrued benefit (annual, at NRA): `B_t = H_t × (1 + i)^(NRA − age_t) / APR_NRA`, projecting with **interest credits only, not future pay credits**.
2. **Required inputs and units.** Opening balance (if converted — see below); pay-credit schedule (% of pay, flat $, or points-based); interest-crediting rate(s) and their history; current age and NRA; the plan's APR at NRA (interest + mortality).
3. **Eligibility/applicability predicates.** Plan is an applicable defined benefit plan (statutory hybrid) under IRC §411(a)(13); pay credits are principal credits (Treas. Reg. §1.411(b)(5)-1(d)(1)(ii)(D)); anything conditioned on current service is a principal credit, not an interest credit (DBAB Q 18:4 — e.g. 6% for actives vs 4% for terminated: the plan rate is 4%, the extra 2% is principal).
4. **Effective-date rules.** Interest credits continue after plan termination until benefit commencement; pay credits cease at termination (DBAB Q 27:6). For a variable crediting rate at termination, PBGC uses the **average of the rates during the 5-year period ending on the termination date** (PPA §411(b)(5)(B); PBGC regulations — DBAB Q 27:6).
5. **Intermediate calculation sequence.** (a) Roll the account forward year by year (pay credit + interest credit on the opening balance). (b) At `t`, project `H_t` to NRA with interest only (variable rate ⇒ current year's rate, per IRS position — DBAB Q 18:24). (c) Divide by the plan APR at NRA. (d) ÷12 for monthly.
6. **Rounding conventions.** Plan-stated rounding governs. Interest credits are typically applied to whole-dollar balances; the projection exponent uses exact years/months per the plan.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1) — the accrued benefit must be expressible as an annual benefit at NRA (IRC §411(a)(7)); the account balance itself is the accrued benefit only for lump-sum payment and age-discrimination purposes (IRC §411(a)(13)(A)).
8. **Source citations.** DBAB Ch. 18 (esp. Q 18:1–18:6, Q 18:24–18:26); DBAB Q 27:6 (terminating cash balance, variable rate); IRC §411(a)(13), §411(b)(5); Treas. Reg. §1.411(b)(5)-1; DBAB Ch. 4 (cash balance as floor-offset, Q 4:31).
9. **Boundary conditions and exceptions.** **Conversion protection:** on conversion from a traditional formula, the prior accrued benefit is protected — it becomes the opening balance (DBAB Q 18:2, Q 18:43); the greater-of (old annuity vs new account) applies. **Wear-away** on conversion is the classic failure: if the opening balance is set below the protected annuity's value, the participant accrues nothing until the account catches up — a diagnostic hypothesis when PA_AMB is flat across years. The subsidized portion of any early-retirement benefit is disregarded in determining the accrued benefit (DBAB Q 18:24). Interest credits must satisfy the market-rate-of-return and §411(b)(1)(H) age-discrimination rules.
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Neff: account `$50,000` at 2022-12-31, age 45, NRA 65, interest credit 5%, APR `151.458`. `B_t = $50,000 × 1.05^20 / 151.458 = $875.92/month`. (DBAB Q 18:24.) Pay-credit illustration (DBAB Q 18:2): 5% of pay + 4% interest; salary `$20,000` → `$1,000` credit, balance `$1,000`; next year `$1,150` credit + `$40` interest → `$2,190`.
11. **When exact reconstruction is impossible.** The common gaps are the interest-crediting history (variable rates) and the opening balance on conversion. Bound the projection over the documented rate range; for a variable rate at termination, the 5-year-average rule gives a *determinate* PBGC number even when the plan's own rate path is unknown — use it as the PBGC-basis scenario and label it as such. If the opening balance is unknown, the account is unbounded below by zero and above by the protected-annuity value — **Indeterminate** until the conversion amendment is found.

### S-02 — Pension equity plans (PEP)

1. **Mathematical definition.** Accumulated percentage: `κ_t = Σ_y κ_y` (percentage points credited per year, often age/service-graded). Lump-sum value: `L_t = κ_t × C̄_t^FAC` (final average compensation). Annuity: `B_t = L_t / APR_NRA` (monthly, using the plan's conversion factors).
2. **Required inputs and units.** Annual percentage credits `κ_y` (% points); `C̄_t^FAC` ($/year); the plan's annuity conversion basis (APR or factor table).
3. **Eligibility/applicability predicates.** Plan is a statutory hybrid (IRC §411(a)(13)(C)); the benefit is defined as a percentage of final average compensation, not as an account.
4. **Effective-date rules.** Percentage credits accrue by year under `P(t)`; final average compensation is measured at `t`.
5. **Intermediate calculation sequence.** (a) Accumulate percentage points through `t`. (b) Multiply by final average compensation to get the lump-sum value. (c) Convert to an annuity at NRA using the plan factors. (d) ÷12 if the APR is monthly.
6. **Rounding conventions.** Plan-stated rounding governs. Percentage points are typically whole or half points; do not round the accumulated percentage before multiplying.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1); the lump-sum value `L_t` is a separate typed quantity and must not be compared to a monthly PA_AMB.
8. **Source citations.** IRC §411(a)(13)(C); DBAB Q 9:15 (PEP accrued benefit may decline with final average compensation — 2015 Gray Book Q&A 35); DBAB Ch. 4 (hybrid plans); DBAB Ch. 18 (PEP referenced as a statutory hybrid alongside cash balance).
9. **Boundary conditions and exceptions.** **The accumulated PEP benefit may decline when final average compensation declines** — the IRS's stated position for PEPs (DBAB Q 9:15). This is the one design where a falling accrued benefit is *expected* behavior, and it must not be misread as an administrator error. Vesting for applicable DB plans is 3-year cliff (DBAB Ch. 8, Q 8:10–8:11).
10. **Synthetic numerical test example (fictional).** Participant Karen Osei (fictional): `2%` per year × 20 years = `40%` accumulated; final average compensation `$75,000`; lump sum `40% × $75,000 = $30,000`; annuity at 65 with APR `151.458`: `$30,000 / 151.458 = $198.07/month`.
11. **When exact reconstruction is impossible.** If the annuity conversion factors are unknown, report the lump-sum value `L_t` exactly (it needs only the percentage and FAC) and bound the annuity by the plausible APR range — and compare PA_AMB against the *lump-sum-implied* range, not against a single assumed conversion. If FAC is unknown, the same missing-year bounds as T-06 apply.

### S-03 — Other statutory hybrid arrangements (including target benefit and floor-offset hybrids)

1. **Mathematical definition.** Target benefit: the *benefit* is stated by formula (usually `B^target = α × C̄ × S^proj` at NRA); contributions are actuarially determined to fund it and vary. Accrued benefit: `B_t = B^target × (S_t / S_t^proj)` (fractional) or as the plan defines. Floor-offset hybrid: see I-05. Cash-balance-as-floor: the offset is the annuitized cash-balance account, not the account itself (DBAB Q 4:31).
2. **Required inputs and units.** Target benefit parameters; contribution/actuarial assumptions (for the funding side only — they do not define the accrued benefit); for floor-offset hybrids, the DC account and APR.
3. **Eligibility/applicability predicates.** Plan is an applicable defined benefit plan or a stated hybrid design; the document must define the accrued benefit (IRC §411(a)(7)).
4. **Effective-date rules.** As the underlying design; target-benefit plans in effect before 1991-09-19 have special rules (DBAB Ch. 4, Q 4:12).
5. **Intermediate calculation sequence.** Target: (a) compute the target benefit at NRA. (b) Apply the plan's accrual method. Floor-offset hybrid: as I-05.
6. **Rounding conventions.** Plan-stated rounding governs.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Ch. 4 (target benefit Q 4:8–4:14; floor-offset Q 4:15–4:31; cash balance Q 4:32+); IRC §411(a)(13); Treas. Reg. §1.411(a)(13)-1(d)(3) (statutory hybrid definition).
9. **Boundary conditions and exceptions.** In a target benefit plan, **contributions do not define the benefit** — a low contribution year does not reduce the accrued benefit. In a cash-balance floor-offset, an invalid offset is one that defines principal credits as a net of the DC contribution (DBAB Q 4:31) — if the plan's offset looks like that, the design itself is suspect and the case needs a legal read, not a recalculation.
10. **Synthetic numerical test example (fictional).** Participant Luis Herrera (fictional), target benefit plan: target `40%` of FAC `$75,000 = $30,000/year` at NRA with 30 projected years; 15 years accrued: `B_t = $30,000 × 15/30 = $15,000/year = $1,250/month`.
11. **When exact reconstruction is impossible.** Target-benefit accruals depend on the plan's stated accrual method; if unstated, scenario-test fractional vs unit-credit. Never infer the accrued benefit from the contribution history — that reverses the design.

### S-04 — Contributory defined-benefit plans

1. **Mathematical definition.** Total accrued benefit `B_t^total` under the plan formula; split into `B_t^ee` (from mandatory employee contributions, see S-05) and `B_t^er = max(B_t^total − B_t^ee, 0)`.
2. **Required inputs and units.** Contribution rate and history; total formula benefit; the S-05 accumulation.
3. **Eligibility/applicability predicates.** Plan requires mandatory employee contributions as a condition of employment, participation, or benefits (IRC §411(c)(2)(C)). Voluntary contributions do not create this split.
4. **Effective-date rules.** Contribution rates and the plan's interest-crediting rules for contributions are those in `P(t)`; the statutory accumulation rates changed in 1988 (5% → 120% of the federal midterm rate) and again with §417(e) (DBAB Q 9:54).
5. **Intermediate calculation sequence.** (a) Compute total accrued benefit. (b) Compute the employee portion (S-05). (c) Subtract for the employer portion.
6. **Rounding conventions.** As S-05 and the total formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1), split into employee and employer portions. **Only the employer portion is subject to vesting** (DBAB Q 9:56).
8. **Source citations.** DBAB Q 9:53–9:56; IRC §411(c)(1)–(2); Treas. Reg. §1.417(e)-1(d)(1).
9. **Boundary conditions and exceptions.** A participant who withdraws mandatory contributions may forfeit the employer benefit attributable to them per plan terms — check the withdrawal provisions before treating a low PA_AMB as an error. Mandatory contributions are always fully vested in themselves (the employee portion is never forfeitable).
10. **Synthetic numerical test example.** See S-05 (Diane): total `$500/month`, employee portion `$231.83/month`, employer portion `$268.17/month`.
11. **When exact reconstruction is impossible.** If the contribution history is missing, the employee portion is bounded by `[0, B_t^total]` and the split is indeterminate — but the *total* may still be verifiable. Report the total and the split separately; a PA_AMB that matches the total is not evidence about the split, and a PA_AMB that matches only the employer portion suggests the administrator reported a vested/employer-only figure (see §2, B2).

### S-05 — Employee-contribution accounts / offsets (IRC §411(c))

1. **Mathematical definition.** Accumulated contributions at NRA: `AC_NRA = Σ_y c_y × Π (1 + r_k)`, with `r = 5%` compounded annually before the first plan year beginning after 1987-12-31; `r = 120% of the federal midterm rate` from then to distribution; `r = §417(e) applicable rate` from the determination date to NRA. Employee benefit: `B_t^ee = AC_NRA / APR_417(e)` (monthly). Employer benefit: `B_t^er = max(B_t^total − B_t^ee, 0)`.
2. **Required inputs and units.** Annual mandatory contributions `c_y` ($); federal midterm rates by year; §417(e) rates; APR at NRA under §417(e) (monthly factor).
3. **Eligibility/applicability predicates.** Mandatory contributions as defined in IRC §411(c)(2)(C).
4. **Effective-date rules.** The three interest regimes are date-bound as above; the plan's RPA '94 amendment determines whether the applicable interest rate applies.
5. **Intermediate calculation sequence.** (a) Accumulate contributions year by year at the regime rates. (b) Project to NRA at the §417(e) rate. (c) Divide by the §417(e) APR. (d) Subtract from the total for the employer portion.
6. **Rounding conventions.** Plan-stated rounding governs; the §417(e) APR is a plan/document figure — use the documented value, do not recompute it from first principles unless the plan requires it.
7. **Output basis.** Monthly benefit at NRA (B1), employee portion.
8. **Source citations.** DBAB Q 9:53–9:56 (worked Diane example); IRC §411(c)(2)(B)–(C); Treas. Reg. §1.417(e)-1(d)(1) (converted benefit never less than the §417(e) computation).
9. **Boundary conditions and exceptions.** The converted benefit using plan factors can never be less than the benefit using §417(e) rates — the §417(e) figure is a floor. Interest after termination to NRA uses the §417(e) rate even if the plan's rate differs.
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Diane (DBAB Q 9:54–9:56): contributions 1986–1999, accumulated to NRA (2005) `$28,832`; APR `124.366`; employee benefit `$28,832 / 124.366 = $231.83/month`; total benefit `$500/month`; employer benefit `$500.00 − $231.83 = $268.17/month`.
11. **When exact reconstruction is impossible.** Contribution histories are rarely in the census. Without them, `B_t^ee` is bounded by `[0, B_t^total]`; the useful test is the *ratio*: if PA_AMB ≈ `B_t^total − B_t^ee` for a plausible `B_t^ee`, the administrator may have reported the employer portion only. Record that hypothesis; do not assert it without the contribution record.

### S-06 — Frozen and partially frozen plans

1. **Mathematical definition.** **Hard freeze** (DBAB Q 26:4): `B_t = F(X_i(≤ t_freeze), P(≤ t_freeze))` for all `t ≥ t_freeze` — no new accruals, no compensation growth. **Soft freeze, closed to new entrants** (Q 26:3): existing participants continue accruing normally; `B_t` computed under the live formula. **Soft freeze, accrual rate zero but compensation grows** (Q 26:3): `B_t = α × C̄_t × S_{t_freeze}` — service frozen, average compensation current.
2. **Required inputs and units.** Freeze date and type; the formula and inputs as of the freeze date; for soft freezes, post-freeze compensation history.
3. **Eligibility/applicability predicates.** A plan amendment freezing benefits, with ERISA §204(h) notice; the freeze type is stated in the amendment.
4. **Effective-date rules.** The freeze amendment's effective date is the cutoff; accruals after it are zero (hard) or as the amendment provides (soft). A freeze is not a termination (Q 26:1) — the plan continues.
5. **Intermediate calculation sequence.** (a) Identify freeze type and date from the amendment. (b) Compute the benefit as of the freeze date. (c) For soft freezes, update only the inputs the amendment leaves live. (d) For `t > t_freeze`, verify no post-freeze service or compensation leaked into a hard-frozen benefit — the commonest administrator error in frozen plans.
6. **Rounding conventions.** As the underlying formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1), frozen at the freeze date (hard) or partially live (soft).
8. **Source citations.** DBAB Ch. 26 (Q 26:1–26:4 freeze types; Q 26:7 amendment mechanics; Q 26:9–26:10 §204(h) notice); DBAB Q 4:29 (frozen floor-offset); IRC §411(d)(6); ERISA §204(h).
9. **Boundary conditions and exceptions.** A freeze may not take away benefits already accrued (§411(d)(6)). In a frozen DB plan with a floor-offset, the offset is also frozen (Q 4:29). Top-heavy and §415 rules continue to apply. A freeze amendment that eliminates an early-retirement subsidy needs §204(h) notice and may be a §411(d)(6) issue.
10. **Synthetic numerical test example (fictional).** Participant Maria Chen (fictional), hard freeze 2015-12-31: `1.5% × $60,000 × 15 = $13,500/year = $1,125/month` at the freeze date; at DOPT 2024 the benefit is still `$1,125/month` — 9 further years of service and pay growth add nothing.
11. **When exact reconstruction is impossible.** If the freeze type is undocumented, compute all three variants (hard / closed-to-new-entrants / rate-zero-comp-grows) as scenarios. If PA_AMB exceeds the hard-freeze value but matches a soft-freeze value, that identifies the freeze type — as a hypothesis, pending the amendment. If the freeze *date* is unknown, the benefit is bounded between the earliest and latest plausible freeze dates' values.

### S-07 — Special past-service credits

1. **Mathematical definition.** `B_t = F(C̄_t, S_t^current + S^past)`, where `S^past` is service before the plan's effective date (or before a stated date) credited by the plan.
2. **Required inputs and units.** `S^past` (years); the crediting rule (which pre-effective-date service counts); current service; compensation measure.
3. **Eligibility/applicability predicates.** Plan grants past-service credit (by adoption or by amendment); a grant over 5 years must be shown not to discriminate in favor of HCEs (Treas. Reg. §1.401(a)(4)-5(a)(3)); a pattern of discriminatory amendments defeats the 5-year safe harbor.
4. **Effective-date rules.** Past-service credit is granted as of the plan's effective date or the amendment date; it is not retroactive service for §415 participation purposes beyond the regulatory floor (see item 9).
5. **Intermediate calculation sequence.** (a) Determine credited past service. (b) Add to current benefit service. (c) Evaluate the formula. (d) Apply §415 with the participation floor.
6. **Rounding conventions.** As the underlying formula.
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Q 9:19 (past-service credit); Q 9:20 (§415); Q 9:22 (excluding service before a date — the mirror image); Treas. Reg. §1.401(a)(4)-5(a)(3).
9. **Boundary conditions and exceptions.** **§415:** the dollar limit's participation numerator is never less than 1, so a participant can receive a past-service benefit at inception (≥ 1/10 of the dollar limit); but the 100%-of-compensation limit can still be zero if there is no past salary history (DBAB Q 9:20). A plan may also *exclude* service before a date (Q 9:22) — the administrator's service figure must be checked against the plan's exclusion date, not just the hire date.
10. **Synthetic numerical test example (fictional).** Participant Noah Williams (fictional): `1% × $50,000 × (8 past + 12 current) = 1% × $50,000 × 20 = $10,000/year = $833.33/month`. Without the past-service credit the benefit would be `$500/month` — the credit is worth `$333.33/month` and must be separately evidenced.
11. **When exact reconstruction is impossible.** Past service is usually the least-documented service in a case. If the credit is undocumented, the bound is `[F(S^current), F(S^current + S^past_max)]`, where `S^past_max` is the maximum creditable pre-effective service (hire date to effective date). A PA_AMB at the top of that range with no credit documentation is a **Requires investigation** finding, not a verification.

### S-08 — Rehire and restoration provisions

1. **Mathematical definition.** Service after rehire: `S_t = S^pre-break (if restored) + S^post-rehire`. Restoration of a prior distribution: `B_t = B_t^gross-before-distribution` if the participant repaid the distribution plus interest per the plan; otherwise `B_t = B_t^gross − AE(prior distributions)` (see X-04 Option 3). Break-in-service: a 1-year break (≤500 hours) suspends credit; pre-break service is restored after the participant completes 1 year of service after rehire (with the 5-year rule / rule of parity governing forfeiture of pre-break service for nonvested participants).
2. **Required inputs and units.** Employment periods with dates; hours per computation period; prior distribution amounts and dates; repayment amounts and dates; vesting status at each break.
3. **Eligibility/applicability predicates.** Plan's break-in-service, rehire, and restoration provisions (DBAB Ch. 7); ERISA §203 / IRC §411(a)(6) (5-year break rule, rule of parity); suspension-of-benefits provisions (DBAB Q 9:60–9:63).
4. **Effective-date rules.** Each employment period is governed by the provisions in effect during it; a restoration repayment reinstates the benefit as of the repayment date, not retroactively to the distribution date.
5. **Intermediate calculation sequence.** (a) Build the employment-period timeline. (b) Apply break rules period by period. (c) Determine restored vs forfeited pre-break service. (d) Apply prior-distribution offsets. (e) Evaluate the formula on the resulting service.
6. **Rounding conventions.** As the underlying formula. Service periods are measured per the plan's computation period (hours or elapsed time — DBAB Ch. 7).
7. **Output basis.** Monthly benefit in the normal form at NRD (B1).
8. **Source citations.** DBAB Ch. 7 (measuring service; breaks in service Q 7:25+; rehire Q 7:28+); DBAB Q 9:58–9:68 (post-NRA and suspension); DOL Reg. §2530.203-3 (suspension, 25%-per-month offset cap — Q 9:63).
9. **Boundary conditions and exceptions.** A plan requiring 2 years of service may disregard pre-break service under specified conditions (DBAB Ch. 7). A retiree in pay who returns to work may have benefits suspended (≥40 hours/month) with notice; on resumption, withheld amounts are repaid (less offsets capped at 25% of the monthly benefit — Q 9:63). A suspension clause added for already-earned benefits is a §411(d)(6) cutback (Q 9:60).
10. **Synthetic numerical test example (fictional).** Participant Olga Petrova (fictional): 6 years pre-break, 3-year break, rehired, completes 1 year post-rehire → pre-break service restored. `S_t = 7` years; `1% × $55,000 × 7 = $3,850/year = $320.83/month`. If pre-break service were forfeited, `S_t = 1` and the benefit would be `$45.83/month`.
11. **When exact reconstruction is impossible.** Employment gaps are the characteristic census gap. Bound service over the restoration scenarios (restored / forfeited) and report both benefits. If the census shows a gap with no rehire record, do not assume continuous employment and do not assume a break — mark the period unknown and bound it.

---

## 9. Cross-cutting caps and conversions (apply on top of any formula)

### X-01 — IRC §415 maximum benefit limit

1. **Mathematical definition.** `B_t ≤ min( L$_t × max(YOP_t, 1)/10 , 100% × C̄_t^(high-3) × max(YOS_t, 1)/10 )`, where `L$_t` is the indexed dollar limit for the limitation year (2023: `$265,000`), `YOP` years of participation, `YOS` years of service. The dollar limit is reduced 1/10 per year of participation under 10; the compensation limit 1/10 per year of service under 10; neither denominator is ever below 1.
2. **Required inputs and units.** Dollar limit table by limitation year; high-3-year average compensation ($/year); YOP and YOS (years).
3. **Eligibility/applicability predicates.** Applies to every defined benefit plan; all DB plans of the employer (and predecessor) are aggregated as one plan (Treas. Reg. §1.415(f)-1(a)(1)), except multiemployer plans.
4. **Effective-date rules.** The limit in effect for the limitation year; adjustments apply if benefits begin before 62 or after 65 (Q 12:22). A benefit is tested in the straight-life-annuity form; other forms are converted to that basis first.
5. **Intermediate calculation sequence.** (a) Compute the formula benefit as a straight life annuity at NRA. (b) Compute both limits. (c) Take the lesser. (d) Express monthly.
6. **Rounding conventions.** The dollar limit increases in `$5,000` multiples, rounded down (IRC §415(d)(1)). The benefit itself follows plan rounding.
7. **Output basis.** Monthly straight-life annuity at NRA (B1, capped).
8. **Source citations.** DBAB Q 12:4 (limit table 1987–2023); Q 12:5 (participation/service reductions); Q 12:13–12:22 (form and age adjustments); IRC §415(b), (d); Treas. Reg. §1.415(b)-1.
9. **Boundary conditions and exceptions.** Employee-contribution and rollover benefits are excluded from the limit. A post-65 actuarial increase limited by §401(a)(17) must be handled by starting or suspending benefits to avoid forfeiture (DBAB Q 9:18). Pre-change accruals are insulated from a later limit reduction.
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Jan: 7 years' participation, 25 years' service, 3-year average `$280,000`, formula `3% × $280,000 × 25 = $210,000/year`. Limit 1: `$265,000 × (1 − 3/10) = $185,500`. Limit 2: `100% × $280,000` (no service reduction, 25 ≥ 10). `B_t = min($210,000, $185,500, $280,000) = $185,500/year = $15,458.33/month`. (DBAB Q 12:5, Ex. 1.)
11. **When exact reconstruction is impossible.** If YOP is unknown, the dollar limit is bounded by `[$265,000 × 1/10, $265,000]` (for the 2023 table) — usually too wide to be useful; the data request is the participation history. If the limitation year is a non-calendar year, the limit in effect at the benefit's start date governs (Treas. Reg. §1.415(d)-1(a)(3)).

### X-02 — IRC §401(a)(17) compensation limit (and its fresh-start machinery)

1. **Mathematical definition.** Each year's compensation entering any average is capped: `C_y^used = min(C_y, L^comp_y)`, where `L^comp_y` is the limit for the plan year beginning in calendar year `y` ($200,000 base; $235,840 in 1993; $150,000 in 1994–2001; $200,000 from 2002, indexed — full table DBAB Q 9:47, through $330,000 in 2023).
2. **Required inputs and units.** Compensation by year ($/year); the §401(a)(17) table by year.
3. **Eligibility/applicability predicates.** Applies to all qualified DB plans from plan years beginning on or after 1989-01-01.
4. **Effective-date rules.** **Per-year application:** a cost-of-living increase applies only to compensation for the year it takes effect; prior years keep their own year's limit (DBAB Q 9:50). **Law changes differ:** OBRA '93 ($150,000) applies to prior years too; EGTRRA ($200,000) applies to prior years only if the plan elects retroactivity (Notice 2001-56). Frozen benefits and fresh-start methods: see C-05.
5. **Intermediate calculation sequence.** (a) Cap each compensation year at its year's limit. (b) Compute the average. (c) Apply the formula. The cap is applied to *years*, not to the *average* (DBAB Q 9:50, Ex. 1: three years capped individually give an average of `$145,000`, not `$150,000`).
6. **Rounding conventions.** The limit is indexed in `$5,000` multiples, rounded down (Treas. Reg. §1.401(a)(17)-1(a)(3)(ii)–(iii)).
7. **Output basis.** As the underlying formula (B1), with capped compensation.
8. **Source citations.** DBAB Q 9:46–9:52; IRC §401(a)(17); Treas. Reg. §1.401(a)(17)-1; Notice 2001-56; Rev. Rul. 2003-11.
9. **Boundary conditions and exceptions.** Before 1989 the limit is deemed `$200,000`. A plan that retroactively applies the EGTRRA increase must satisfy §401(a)(26) (lesser of 40% or 50 former employees with an actual increase — Rev. Rul. 2003-11). Self-employed earned income is determined under §401(c)(2) (DBAB Q 9:48).
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Reese (DBAB Q 9:50, Ex. 1): high-3 compensation `$160,000` (1994), `$155,000` (1993), `$135,000` (1992); 1994 limit `$150,000` applied per year: `($150,000 + $150,000 + $135,000) / 3 = $145,000` average.
11. **When exact reconstruction is impossible.** If the plan's EGTRRA retroactivity election is undocumented, compute both options (DBAB Q 9:50, Ex. 3: `$190,000` vs `$180,000` average) as scenarios. The election is a single plan-document fact; until found, the case is **Requires investigation** for affected high earners only — not for the whole population.

### X-03 — Form-of-payment and commencement-age conversion (actuarial equivalence)

1. **Mathematical definition.** Alternate form: `B^alt = B^normal × APR^normal / APR^alt` (APR at the payment age). Alternate retirement age (mortality ignored pre-retirement, per plan): `B^early = B^NRA × APR^NRA × v^n / APR^early`, where `v^n = (1+i)^(−n)`, `n` = years early. Both steps in sequence if both apply (DBAB Q 9:24).
2. **Required inputs and units.** Plan interest rate(s); mortality table (unisex — sex-distinct tables are prohibited, Arizona v. Norris, 463 U.S. 1073 (1983), DBAB Q 9:25); APRs at the relevant ages; months early/late; form codes and certain/survivor parameters.
3. **Eligibility/applicability predicates.** Plan must specify its actuarial equivalence assumptions (IRC §401(a)(25)); a plan amendment may not reduce any optional form below its pre-amendment value (Treas. Reg. §1.411(d)-4, DBAB Q 9:27).
4. **Effective-date rules.** The assumptions in effect at the commencement (or measurement) date govern; the plan must state whether mortality applies pre-retirement, post-retirement, or both.
5. **Intermediate calculation sequence.** (a) Start from B1 (normal form at NRA). (b) Convert to the alternate age. (c) Convert to the alternate form. (d) Apply any plan early/late retirement factors (ERF/LRF) — which may be *subsidized* (see below) rather than actuarially equivalent.
6. **Rounding conventions.** BCV factor functions round to 4 decimals by file practice (PF precedent — a file convention, not a PBGC policy). Plan-stated rounding governs the benefit; factor rounding is a diagnostic hypothesis.
7. **Output basis.** B4 (benefit payable at commencement) in the elected form. **This entry converts B1 to B4; it does not create an accrued benefit.**
8. **Source citations.** DBAB Q 9:23–9:28 (normal form, equivalence, subsidized forms); BCV ATPBGC Add-ins (Jul 2024): `ERFAEQ(XBRD, sex, theNRA, EarlyMonths, TheCPeriod, TheMNameHandle, TheFNameHandle, CalcMethod, DeferralMort, intMethod, …)` — e.g. `ERFAEQ(.06,"M",65,120,0,"GM83","GF83","MP","Y") = 0.4073`; `LRFAEQ(…)` late factor, e.g. `0.06,"M",65,120,0,"GM83","GF83","MP","Y" = 3.2925`; `BFCFAEQ(FromBftForm, FromSurvPct, FromMthsCert, FromMthsTemp, ToBftForm, ToSurvPct, ToMthsCert, ToMthsTemp, PXRAge, SXRAge, Psex, Ssex, XBRD, MMortality, FMortality, AnnuityType, Method, …)` — e.g. `BFCFAEQ("SLA",0,0,0,"JSC",0.5,0,0,65,61,"M","F",0.06,"LS00SU2015","LS00SU2015","MP","N") = 0.9112`. PBGC optional forms convert with PBGC factors (6%, unisex 1983 GAM), not plan factors (Book of Job, Annuity Benefit Forms §G.1).
9. **Boundary conditions and exceptions.** **Subsidized optional forms** (DBAB Q 9:28) are worth more than the actuarially equivalent benefit — the excess is an employer subsidy, and it is *excluded* from the accrued benefit for §411 purposes. A PA_AMB that matches a subsidized early-retirement amount is not the accrued benefit; it is B4 with a subsidy. Certain-and-continuous forms: `n` years certain-and-continues writes as code SLA with months-certain `= n×12` (36 months certain-and-continues = SLA, 0, 36); pure certain (no life) is code CTN (PF v0.4.2 finding, verified in the add-in doc and BCV dictionary). The deferral flag is Y or N only (mortality counts during deferral or not) — never assume it.
10. **Synthetic numerical test example (Answer Book examples, fictional).** (a) Form conversion: `$1,000/month` life annuity, APR `110.905`; 10-year certain-and-life APR `118.708` ⇒ `$1,000 × 110.905 / 118.708 = $934.27/month`. (b) Early commencement: `$1,000/month` at 65, APR 65 `126.910`, APR 60 `141.335`, 6%, mortality ignored pre-retirement: `$1,000 × 126.910 × 0.747258 / 141.335 = $670.99/month` at 60. (DBAB Q 9:23–9:24.)
11. **When exact reconstruction is impossible.** If the plan's equivalence assumptions are undocumented, the conversion is bounded by the plausible assumption set (e.g. PBGC factors vs plan factors) — and a PA_AMB that matches B1 under one set and B4 under another is evidence about the administrator's basis, not an error. The conversion layer is the system's main tool for testing "wrong basis" hypotheses; it must never be used to force a match.

### X-04 — Benefit accruals after normal retirement age

1. **Mathematical definition.** Three plan options (DBAB Q 9:58): **Option 1 — additional accruals with suspension:** `B = F(S_{t}, C̄_t)` with payments suspended (ERISA §203(a)(3)(B)). **Option 2 — greater of:** `B = max(F(S_t, C̄_t), AE(B_NRA to t))` (actuarial equivalent of the NRA benefit carried to `t`). **Option 3 — additional accruals offset by benefits paid:** `B = F(S_t, C̄_t) − AE(payments made since NRA)`, floored at the benefit already in pay.
2. **Required inputs and units.** NRA benefit; post-NRA service and compensation; actuarial equivalence basis; payments made since NRA.
3. **Eligibility/applicability predicates.** Participant works beyond NRA; the plan elects one of the three options.
4. **Effective-date rules.** The option is a plan term; the §411(b)(1)(H) rule forbids reducing accrual rates by age, but a service cap is allowed (DBAB Q 9:57). §415 limits can still bind post-NRA increases (Q 9:57 note).
5. **Intermediate calculation sequence.** Per the elected option; Option 2 requires tracking both the accrual path and the actuarial-equivalence path year by year (DBAB Q 9:67 table).
6. **Rounding conventions.** As the underlying formula.
7. **Output basis.** Monthly benefit in the normal form at the actual retirement date (B4, not B1 — the accrued benefit at NRA is the input, the post-NRA amount is a commencement amount).
8. **Source citations.** DBAB Q 9:57–9:68; Prop. Treas. Reg. §1.411(b)-2(b)(4)(iv) (worked Brenden examples); ERISA §203(a)(3)(B); DOL Reg. §2530.203-3.
9. **Boundary conditions and exceptions.** Suspension requires timely notice (first calendar month/payroll period — Q 9:61) and a plan provision; resumption no later than the first day of the third month after employment ceases (Q 9:62); offsets capped at 25% of the monthly benefit (Q 9:63). A suspension clause added for already-earned benefits is a §411(d)(6) cutback (Q 9:60).
10. **Synthetic numerical test example (Answer Book example, fictional).** Participant Brenden, Warrior Helmet plan, `$20/month` per year: at 65, 30 years ⇒ `$600/month`. Option 1 (suspension): retires at 67 with 32 years ⇒ `$640/month`. Option 2 (greater-of): at 66, accrual `$620/month` vs actuarial equivalent of the 65 benefit `$672/month` ⇒ pays `$672/month`. Option 3 (offset): 24 payments of `$600 = $14,400`, actuarial value at 67 `$15,839` ⇒ `$156/month` offset vs `$40/month` new accrual ⇒ no increase; benefit stays `$600/month`. (DBAB Q 9:59, 9:67–9:68.)
11. **When exact reconstruction is impossible.** If the plan's elected option is unknown, compute all three — they diverge materially (here `$640` vs `$672` vs `$600`). If PA_AMB matches one, that is evidence for the option. If the post-NRA work history is missing, the bound is `[B_NRA, max(Option 2 path)]` and the case needs the employment record.

### X-05 — Vesting application (accrued → vested accrued)

1. **Mathematical definition.** `B_t^vested = VP_t × B_t`, where `VP_t` is the vesting percent from the plan's schedule at `t`. Only the employer-contribution portion is subject to vesting (S-04).
2. **Required inputs and units.** Vesting schedule (cliff or graded, by years of vesting service); vesting service `VS_t` (years); `B_t` ($/month).
3. **Eligibility/applicability predicates.** Plan's vesting schedule (DBAB Ch. 8); applicable DB plans (cash balance, pension equity) use 3-year cliff (IRC §411(a)(13)(B)); top-heavy plans use the top-heavy vesting schedule (2-year cliff or 6-year graded is the statutory minimum — verify in Ch. 8, not assumed here).
4. **Effective-date rules.** The schedule in effect at `t`; a schedule change protects the vested percentage already earned (§411(a)(10) election rules — DBAB Ch. 8).
5. **Intermediate calculation sequence.** (a) Compute `B_t`. (b) Determine `VS_t`. (c) Look up `VP_t`. (d) Multiply. (e) Compare with BCV `VB`/`VBNF` (vested, before PBGC limitations).
6. **Rounding conventions.** `VP` is entered as a fraction (e.g. 1, not 100) per the BCV dictionary; vesting percents are schedule values, not rounded computations.
7. **Output basis.** B2 (vested accrued benefit), monthly, in the normal single form (`VB`) or automatic form (`VBNF`).
8. **Source citations.** DBAB Ch. 8 (vesting); IRC §411(a); BCV `VP`, `VB`, `VBNF`, `VSPA`/`VS`.
9. **Boundary conditions and exceptions.** `VP` may be 0 even when the participant receives a benefit in Priority Category 2 or 6 (BCV dictionary note on `VP`). A participant 100% vested has `B^vested = B_t` — the distinction vanishes and cannot explain a discrepancy. Different schedules may apply to different groups or to benefits accrued at different times (DBAB Ch. 8, Q 8:47+).
10. **Synthetic numerical test example (fictional).** Participant Priya Nair (fictional): accrued `$1,000/month`, vesting schedule 20% per year from year 3 (graded), 3 years' vesting service ⇒ `VP = 0.60`. `B^vested = $600/month`.
11. **When exact reconstruction is impossible.** If the schedule is unknown, `VP` is bounded by `[0, 1]` — useless alone. The testable content is the *ratio* `PA_AMB / B̂_t`: if it equals a plausible schedule value (e.g. 0.60, 0.80) for the participant's service, the hypothesis "administrator reported the vested benefit" is supported and the disposition can be **Supported for acceptance** on the vested basis — with the hypothesis documented, not hidden.

---

## 10. Compensation measures (shared inputs to T-02, T-04–T-06, I-01–I-04)

The formula entries above take `C̄_t` as an input. The compensation measure is itself a classification problem; the wrong measure is the commonest single cause of a PA_AMB discrepancy.

| Measure | Definition | When it applies |
|---|---|---|
| Final `n`-year average | Average of the last `n` consecutive years through `t` | Plan says "final" |
| Highest `n`-year average | Average of the highest `n` consecutive years through `t` | Plan says "highest" (commonest) |
| Career average | Average over all credited years | T-05 |
| 5-year highest (top-heavy) | Highest 5 consecutive years, disregarding years without a year of service | C-03 minimum |
| High-3 (415) | Highest 3 consecutive years | X-01 compensation limit |
| §415(c)(3) compensation | Statutory definition (wages + includible amounts, listed exclusions) | §415, HCE/key-employee status |
| §414(s) compensation | Safe-harbor or reasonable nondiscriminatory definition | Nondiscrimination, safe-harbor designs |

Rules: the plan's definition governs the benefit; §414(s) must be used for safe-harbor and §401(a)(4) testing (DBAB Q 9:38–9:39); §415(c)(3) must be used for §415 limits, HCE/key status, top-heavy contributions, and deductions (Q 9:41); a non-safe-harbor definition is allowed only if reasonable, non-discriminatory, and passing the annual test (Q 9:42–9:45); a definition as a percentage of another definition, or as one month's pay, is per se unreasonable (Q 9:44). Each compensation year is capped at its year's §401(a)(17) limit (X-02). Self-employed earned income follows §401(c)(2) (Q 9:48).

**Missing compensation years** are handled per the standing requirement (§0): bound, scenario-test, never fill with zero unless the plan rule requires it.

---

## 11. Rounding (§9 of the master prompt)

- **No universal PBGC rounding policy for benefit amounts was found.** The Blonder-Tongue plan rounds the determined benefit to the nearest whole dollar (plan term). The PF file practice of rounding factors to 4 decimals is a *factor* convention, not a benefit rounding policy, and must not be imported.
- **Rounding is plan-specific and stage-specific.** The engine must support configurable rounding for: compensation, average compensation, credited service, accrual percentages, Social Security offsets, intermediate benefit components, retirement factors, actuarial equivalence factors, and final monthly benefits — applied after individual operations, annual accruals, intermediate results, or final calculation, as the plan or the evidence requires.
- **Rounding as a diagnostic hypothesis.** When `|PA_AMB − B̂|` is small, test the plausible rounding sequences (round the average vs round the final benefit; round service vs keep fractional; round the factor to 4 decimals vs keep full precision). A match under one sequence is a hypothesis with a stated prior, not proof — and a match obtained by *arbitrarily* changing rounding conventions must not be treated as proof of the administrator's methodology.
- **Decimal safety.** Exact benefit calculations use decimal-safe arithmetic (integer minor units or equivalent); binary floating-point artifacts must never affect monetary rounding (§8 of the master prompt).

---

## 12. Formula-classification key (how to identify the formula from plan evidence)

Use this decision order when classifying a plan from its documents (Stage 2/4 implementation; the key itself is a Stage 1 deliverable):

1. **Is the benefit stated as a hypothetical account or a percentage of pay?** Account ⇒ S-01 (cash balance). Percentage of final average pay ⇒ S-02 (pension equity). Otherwise traditional.
2. **Is there a defined-contribution offset?** Yes ⇒ I-05 (floor-offset); the gross formula is classified separately.
3. **Is there a Social Security integration or PIA offset?** Covered-compensation split ⇒ I-01/I-02; §401(l) allowances ⇒ I-03; direct PIA subtraction ⇒ I-04.
4. **Is the benefit the greater/lesser of two or more computations?** ⇒ C-01/C-02; classify each component, then the combiner.
5. **Is there a minimum?** Top-heavy or plan minimum ⇒ C-03 (applied last).
6. **Did a formula change, freeze, or compensation-limit change occur?** ⇒ C-04/C-05/C-06/S-06 as applicable; the *period* structure is part of the classification, not an afterthought.
7. **Does the formula vary by group?** ⇒ C-07.
8. **Are employee contributions mandatory?** ⇒ S-04/S-05 split.
9. **What is the accrual method?** Unit-credit (T-04) vs fractional (T-07) — determined by the plan document, not by which fits the numbers better. If the document is silent, compute both and report the method as unresolved.
10. **Apply caps last:** §415 (X-01), §401(a)(17) (X-02), service cap (T-09), then vesting (X-05), then form/age conversion (X-03) only when the comparison basis requires B4.

**Classification output for a case** is a per-participant formula assignment: `{formula_id, period_structure, accrual_method, integration, offsets, caps, vesting, basis}` — with each element sourced to a document page/section or marked unknown.

---

## 13. Source hierarchy, conflicts, and gaps

### 13.1 Hierarchy applied (§2.3 of the master prompt)

1. Statute/regulation (IRC §§401(a)(17), 401(l), 411, 415, 416, 417; ERISA §§203, 204; Treas. Regs.).
2. PBGC policy / technical procedures / approved guidance (current policies; Policy 5.8-1 Benefit Corrections; CASE_PROCESSING.txt).
3. Governing plan documents, amendments, interpretations.
4. Historical administration records and valuation reports.
5. Defined Benefit Answer Book and other professional references.
6. Actuarial judgment, heuristics, statistical estimates.

### 13.2 Sources actually used for this document

| Source | What was taken from it | Location |
|---|---|---|
| BCV Data Dictionary (2026-10-30 index) | `PA_AMB`, `PA_AMB_ACCEPT`, `AMB`, `VB`, `VBNF`, `VP`, `DOTE`, `CSPA`/`CS` definitions | `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` |
| Defined Benefit Answer Book, Ch. 9 (2024 Ed., updated 12/2023) | Core: formulas, projected vs accrued, fractional/unit-credit accrual, accrual tests, decreases, service limits, normal form/conversion, top-heavy, compensation, §401(a)(17) fresh starts, employee contributions, post-NRA accruals | `~/workspace/pbgc_review/pa-amb/DBAB-Ch09.pdf` (Drive 1IcoqAA-T7qt-hiMh498EMwEIV30LrXdt) |
| Answer Book Ch. 4 | Hybrid plans: target benefit, floor-offset, cash balance | DBAB-Ch04.pdf (Drive 1pNpLRc7rSBpgb3PXmlsFzMoqgGYSVnSL) |
| Answer Book Ch. 10 | Safe-harbor formulas, permitted disparity, covered compensation | DBAB-Ch10.pdf (Drive 1Kead6ozo_Na0XVp6ikv_OxM6cMtv1j9o) |
| Answer Book Ch. 11 | Advanced design, accrual rates (consulted for I-03) | DBAB-Ch11.pdf (Drive 1hfNYWafr0YiVPnHtD8HQqMD70fYb-Oz9) |
| Answer Book Ch. 12 | §415 maximum benefits | DBAB-Ch12.pdf (Drive 18kOCZplM-I5JBvmZVyIdV-_iluHfN-X_) |
| Answer Book Ch. 18 | Cash balance plans (accrued benefit, conversion) | DBAB-Ch18.pdf (Drive 1ihWZj4z4tHMEoFpNvtXaDV7RpMOPxjzB) |
| Answer Book Ch. 26 | Frozen plans (hard/soft freeze) | DBAB-Ch26.pdf (Drive 1MXoEmNu92MyZY6hRHH3fdKSJY5l7LXkL) |
| Answer Book Ch. 27 | Plan termination; terminating cash balance, variable rate, 5-year average | DBAB-Ch27.pdf (Drive 13ZDypWmj1MlCpbnjpuPOmqVQhqodJJFg) |
| Answer Book Ch. 16, 7, 8, 6 | Census data; service measurement; vesting; eligibility (consulted) | DBAB-Ch16/07/08/06.pdf |
| BCV ATPBGC Add-ins (Jul 2024) | `ERFAEQ` / `LRFAEQ` / `BFCFAEQ` signatures and examples | `~/workspace/pbgc_review/bcv/BCV_ATPBGC_Add-ins.pdf` |
| PBGC current policies | Ex. 17 (§411(d)(6) wear-away, "YOS × benefit rate"); QPSA charge example; Policy 5.8-1 tolerance rules applied to pre-termination liabilities | `~/workspace/pbgc_review/pa-amb/current-policies.pdf` (Drive 1pXWymeJJBH6bNGq8rA11yBev1HheThmE) |
| PBGC Benefit Corrections (10/02/2014) | $1.00 / $5.00 tolerances; "reasonably certain" standard before changing a benefit | `~/workspace/pbgc_review/pa-amb/Benefit_Corrections.pdf` |
| CASE_PROCESSING.txt | Searched for PA_AMB — no PA_AMB definition found (see §13.4) | `~/workspace/pbgc_review/eadj/CASE_PROCESSING.txt` |
| Blonder-Tongue plan (eff. 2006-02-01) | Real-plan period unit-benefit table, 30-year cap, nearest-dollar rounding | `~/workspace/pbgc_review/plan_docs/Blond-2006-plan.txt` |
| College of St. Rose plan (eff. 1985-07-01) | Real-plan formula structure (1% of average monthly compensation × years; early-reduction 1/15) — OCR text partially garbled, used only for structure | `~/workspace/pbgc_review/plan_docs/1985_Plan_Document.txt` |
| PF example file 24884900PF.v0.7.13.xlsx | Layout reference only for ERF/LRF/BFCF formulas; no data reused | `~/workspace/pbgc_review/pf/` |

### 13.3 Conflicts flagged (not silently resolved)

1. **Accrued-benefit decreases on falling compensation.** The 2003 Gray Book (Q&A 33) said an accrued benefit cannot fall when the average falls; the 2015 Gray Book (Q&A 35) says it can for pension equity plans, and the Answer Book (Q 9:15) treats this as a general change of IRS position. **Flag:** the engine must treat a falling-average decrease as a *hypothesis to be tested against the plan's design* (PEP vs traditional), not as a settled rule either way.
2. **Offset in a frozen floor-offset plan.** The IRS position (2005 ASPPA Q&A 5, informal) is that the offset freezes with the DB plan; the Answer Book notes it is "not entirely clear" whether interest-only growth of the DC account may still reduce the benefit (Q 4:29). **Flag:** both readings are scenarios.
3. **Benefit Corrections tolerances vs reconciliation tolerances.** Policy 5.8-1 sets $1.00/$5.00 tolerances for *correcting benefit errors* and for *pre-termination liabilities*. The master prompt (§10) requires reconciliation tolerances to be configurable and documented, never an arbitrary universal tolerance. **Flag:** the $1/$5 figures are PBGC correction tolerances; they are **not** adopted here as PA_AMB acceptance tolerances. Acceptance tolerances are a Stage 2/5 decision (see the reconciliation methodology output), documented per case.
4. **Dictionary label vs case reality on measurement date.** The dictionary says PA_AMB is "at DOTE"; casework experience (and the master prompt §5) says the recorded amount's actual measurement date is often unresolved. **Flag:** the dictionary label is the *stated* basis; the *established* basis is a per-case finding. The two must not be conflated.

### 13.4 Gaps and inaccessible material (stated explicitly, per §2.3)

- **`bcv-manual-combined.pdf`** (Drive 1zWGDDGbtjSHVZrdK3ynfFRMpB_oop-NU, 15.3 MB): downloaded to `~/workspace/pbgc_review/pa-amb/` after one failed (0-byte) attempt, but its text extraction is garbled (embedded custom font encoding; `pdftotext` output unreadable in both `-layout` and `-raw` modes). It was **not** relied on for any formula in this document. It is a BCV *system/data-loading* manual, not a formula source, so the loss is limited — but any PA_AMB-adjacent BCV manual guidance it contains is unverified.
- **`processing-manual.pdf`** (Drive 1w8DkFYkrfLfxURmbCuQIQFfFG6nKOzWX): downloaded (3,680 lines extracted); searched for PA_AMB / accrued monthly benefit / prior administrator — **no PA_AMB definition found**. No formula content was taken from it.
- **`current-policies.pdf`**: searched and used as cited above; it is 23,124 lines and was **not read in full** — only the sections found by targeted search (PC3 examples, QPSA charges, underpayment/tolerance rules). Other PA_AMB-relevant policy sections may exist and should be swept in Stage 2.
- **Answer Book Ch. 3 (Plan Design) and Ch. 25 (PBGC)** were listed in the folder and downloaded (Ch. 3) but not read in depth; Ch. 25 (PBGC guarantee/termination benefit) is downstream of PA_AMB verification and belongs to the B5/B6 work, not this classification.
- **PBGC Policy 5.8-1 Benefit Corrections** was read via the `Benefit_Corrections.pdf` copy and the current-policies excerpts; the standalone policy document itself was not separately located in Drive.
- **Covered-compensation tables** (IRS, by year) and **§415 / §401(a)(17) tables after 2023** are referenced but not embedded in this document — they are non-census inputs the engine must load as versioned tables (Stage 2 data architecture).
- **No PBGC source was found stating the vesting treatment or annuity form of PA_AMB.** That absence is itself a finding (§1.2) and the reason the system must treat both as unknowns until case evidence establishes them.
- **The BCV Data Dictionary `.json` twin** is not valid JSON and was not used; the CSV is the working copy.

### 13.5 Formula count

**34 formula types classified:** 9 traditional (T-01–T-09), 5 integrated (I-01–I-05), 7 combination (C-01–C-07), 8 special designs (S-01–S-08), 5 cross-cutting caps/conversions (X-01–X-05). Every entry provides all 10 items required by §4 of the master prompt, plus item (11) on bounds/scenarios when exact reconstruction is impossible, per the standing requirement (§0).

---

## 14. What Stage 2 needs from this document

1. **Formula registry:** the 34 IDs (T-01…X-05) become the engine's formula-type enum; each formula's inputs, predicates, and effective-date rules become its parameter schema.
2. **Typed-benefit model:** the six typed benefits (§2) and the typed-quantity fields become the `BenefitObservation` / `BenefitCalculation` value types.
3. **Temporal model:** `P(t)` / `X_i(t)` / `B_i(t) = F(X_i(≤t), P(≤t))` and the reconstruction-date list (§3) become the PlanVersion / EmploymentPeriod / CompensationHistory model.
4. **Impossibility handling:** every formula's item (11) becomes a bounds/scenario rule in the engine — the engine must be able to return a *range with a disposition* as a first-class result, not only a point value.
5. **Open questions for the user (not decided here):** (a) the acceptance tolerance framework (Stage 1 output 3 owns it — the $1/$5 correction tolerances are flagged, not adopted); (b) whether the PBGC Design System's dark-page precedent or the master prompt's dark-theme default governs the UI (Stage 4); (c) confirmation that the repo ErChulo/pbgc-pa-amb-analysis is where Stage 2+ work lands.

---

*End of Stage 1 output 1 — formula classification. Companion outputs: 00-source-inventory.md, 02-data-requirements-validation.md, 03-reconciliation-statistical-methodology.md, 04-architecture-decision.md.*
