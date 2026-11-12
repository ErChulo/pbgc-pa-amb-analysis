# Stage 1 — Output 3: Reconciliation and Statistical Methodology

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repository:** [ErChulo/pbgc-pa-amb-analysis](https://github.com/ErChulo/pbgc-pa-amb-analysis) (public, `main`)
**Governing spec:** `MASTER_PROMPT.md` (§9 rounding, §10 reconciliation, §11 statistical analysis, §12 missing-data analysis, §14 acceptance framework)
**Stage:** 1 — Source research (read-only; no code, no app, no repo writes)
**Date:** 2026-11-12
**Status:** Methodology specification. Nothing here is an official PBGC classification, tolerance, or rule unless a PBGC source is cited for it.

---

## 0. The requirement that governs this whole document

**The application must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible.**

That is what distinguishes this system from an ordinary pension benefit calculator. An ordinary calculator fails — or, worse, silently invents a number — when an input is missing. This system must not do either. When the evidence cannot support an exact reconstructed benefit B̂_i, the system must still deliver, for every participant:

1. A **defensible range** — mathematically justified bounds B_i^min ≤ B_i^possible ≤ B_i^max under explicit, stated assumptions (§12, Part C);
2. A **ranked set of diagnostic hypotheses** explaining any discrepancy, ranked by evidence and explanatory power, not by numerical closeness (§10, Part A);
3. A **documented disposition** — one of the five §14 states (Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate) — with the reasoning, assumptions, and missing evidence recorded, and the final decision made by an authorized human reviewer (§14, §0.4).

**No participant ends without a disposition.** "Indeterminate" is a legitimate, complete outcome: it means the evidence cannot support a conclusion, and it must say exactly what evidence would change that. A silent failure, a blank, or a made-up exact number is never an acceptable outcome.

### 0.1 What "reliable" means when reconstruction is impossible

| Situation | What the system delivers | What it must never do |
|---|---|---|
| Exact reconstruction possible | B̂_i, Δ_i, D_i, R_i, hypothesis test, disposition | — |
| Some inputs missing, bounds justifiable | B_i^min / B_i^max, scenario table, sensitivity ranking, disposition (usually Supported for acceptance / Requires investigation / Correction recommended) | Present a bound as an exact value; present a confidence interval as a guaranteed bound |
| Inputs missing, no bound justifiable | Explicit statement of indeterminacy, list of missing inputs ranked by decision impact, data requests, disposition Indeterminate | Fill the gap with a point estimate and proceed as if it were known |
| Recorded amount has no established measurement date | Flag: unresolved comparison basis. No Δ_i is computed against a benefit on a different basis | Compare amounts on different bases and report the difference as a discrepancy |
| Recorded amount is blank | Missing data, never zero (§7, MASTER_PROMPT). Enters the §12 framework, not the reconciliation arithmetic | Treat a blank as B_i^PA = 0 |

### 0.2 Notation (used throughout)

- B_i^PA — prior administrator's recorded accrued monthly benefit for participant *i* (BCV9 field PA_AMB; see §1.2).
- B̂_i — independently reconstructed accrued monthly benefit on the **same basis** as B_i^PA (same measurement date, retirement basis, annuity form, vesting treatment, plan-version).
- B_i^min, B_i^max — lower and upper bounds on the possible benefit under explicit assumptions (§12).
- Δ_i, D_i, R_i — defined in §2.1.
- t_i — measurement date of B_i^PA, when established; "unresolved" when it is not.

### 0.3 Source hierarchy applied in this document

Per MASTER_PROMPT §2.3: (1) statute/regulation, (2) PBGC policy / technical procedures / approved guidance, (3) governing plan documents, (4) historical admin records and valuation reports, (5) Defined Benefit Answer Book and professional references, (6) judgment, heuristics, statistical estimates. Where two sources conflict, this document flags the conflict; it never silently picks one. Every tolerance, threshold, and heuristic in this document is labelled with its source level — and anything at level 6 is labelled a heuristic, never a rule.

### 0.4 The §14 dispositions (proposed application states — NOT official PBGC classifications)

| Disposition | Meaning | Typical evidence state |
|---|---|---|
| Verified | Independent calculation agrees with the reported amount within the applicable documented tolerance | B̂_i exists; \|Δ_i\| within tolerance; basis established; no material unexplained item |
| Supported for acceptance | Available evidence supports accepting the administrator's benefit despite incomplete reconstruction | B̂_i not exact, but B_i^PA lies inside justified bounds and no competing hypothesis explains it better; residual uncertainty documented |
| Requires investigation | Material discrepancies or missing evidence remain unresolved | \|Δ_i\| outside tolerance with no supported explanation, or a key input missing whose effect on the decision is material |
| Correction recommended | Sufficient evidence supports a specific corrected accrued benefit | A supported hypothesis identifies the error and the corrected value; correction value, basis, and evidence recorded |
| Indeterminate | The evidence is insufficient to establish a defensible conclusion | Bounds cannot be justified, or the comparison basis is unresolved and cannot be resolved from available documents |

The final decision is always made and approved by an authorized human reviewer under applicable PBGC procedures. The system recommends; it does not decide.

---

## 1. Inputs, basis, and what was actually found in the Book of Job

### 1.1 Principal input

PA_AMB, BCV Data Dictionary, table BCV9:

> **PA_AMB — "Plan Administrator Accrued Monthly Benefit at DOTE"**, NUMBER, field category `Benefit | DOPT | Input`, classification `Input`. (BCV Data Dictionary, 2026-10-30 index: BCV9, source row 1031.)

Related field: **PA_AMB_ACCEPT** (BCV3) — "Indicator for identifying when plan administrator's AMB is being accepted (Y/N)". The existence of an explicit acceptance indicator in the dictionary confirms that acceptance of PA_AMB is a recorded decision, not an automatic consequence of loading the census.

**Open definitional point (owned by Stage 1 Output 2, recorded here because it controls all of Part A):** the dictionary description says "at DOTE" (DOTE itself is defined in the dictionary as BCV1.DOTE, "Participant's Date of Termination of Employment"), but the PA_AMB row does not state the annuity-form basis or the vesting treatment. Until Output 2 establishes those, every comparison in this methodology must treat the basis as *to be confirmed per case*, and a recorded amount whose measurement date cannot be established is flagged **unresolved comparison basis** — no Δ_i is computed for it.

### 1.2 Tolerance rules — what the Book of Job actually contains

**Finding 1 — No PBGC tolerance rule for PA_AMB reconciliation was found.** No document searched states a dollar or percentage tolerance for accepting a prior administrator's accrued benefit against an independent reconstruction. The reconciliation tolerances in this system must therefore be **configurable and documented per case** (§2.4), and no default in the application may present itself as a PBGC rule.

**Finding 2 — The only tolerance rules found are PBGC Operating Policy 5.8-1, Benefit Corrections, and they govern a different decision.** They govern whether PBGC *corrects a benefit or payment error* once a benefit determination has been issued or become effective — not whether a case actuary accepts PA_AMB during casework. They are recorded here in full because they are the nearest PBGC authority, they are repeatedly cross-referenced by other policies, and the actuary must not confuse the two decisions. Applying 5.8-1 tolerances as reconciliation acceptance tolerances would be a category error; the methodology below keeps them separate.

**Policy 5.8-1, Benefit Corrections, 3rd Edition, Issue Date 10/02/2014, Transmittal 2015-01** (source: `current-policies.txt`, local copy in `~/workspace/pbgc_review/eadj/`; identical text in `Benefit_Corrections.pdf`, downloaded 2026-11-12 to `~/workspace/pbgc_review/pa-amb/`):

- **General standard (§D):** PBGC corrects an error only when it is *reasonably certain* the error occurred and can accurately quantify it. "Where circumstances prevent PBGC from attaining a reasonable degree of certainty in establishing whether an error has occurred or the amount of the error, PBGC will not change the benefit or payment." This "reasonable certainty" standard is directly relevant to the §14 dispositions: a Correction recommended disposition requires the same standard — reasonable certainty about both the error and the corrected amount.
- **D.1 — Corrections at benefit-determination issuance (estimated → final benefit):**
  - Increases: made **regardless of the amount**.
  - Decreases: made only if the decrease is **$1.00 or more** in the monthly benefit. (Reduced from $5.00 in this edition.)
- **D.3 — Corrections after a benefit determination becomes effective:**
  - Benefit in pay status — increase: made only if **$1.00 or more** per month; decrease: made only if **$5.00 or more** per month.
  - Benefit not in pay status: same D.3.a rules apply, but PBGC may correct at pay commencement when practical (e.g. the original calculation program is no longer available).
- **D.4 — Lump sums:** increase only if **$1.00 or more**; decrease of an unpaid lump sum only if **$5.00 or more**; decrease of a paid lump sum only if the net overpayment is **≥ $25** (the amount the Treasury Department accepts to pursue recovery).
- **Scope note (§B):** the D.1 rules first apply to benefit determinations issued for plans trusteed on and after October 1, 2014; the 2nd edition continues to apply to determinations for plans trusteed before that date. The policy applies to benefits and payments under settlement agreements except as otherwise provided.
- **Cross-reference:** PBGC Operating Policy **6.3-1, Underpayment Reimbursement and Interest Payments** (§A Background; §C.2; §E.1) states PBGC "applies the 'tolerance rules' of Policy 5.8-1 Benefit Corrections to determination of pre-termination liabilities," and pays a net underpayment (with interest) when the net underpayment plus interest totals **$1 or more** (29 CFR §4022.81(c)). Pre-termination liabilities are amounts owed before DOPT, including missed payments and underpayments as of DOPT — a different quantity from PA_AMB, but the same tolerance rules are invoked, which is why 5.8-1 is the tolerance authority the caseworker will meet in practice.

**Finding 3 — The processing manual contains no tolerance rule (weak evidence, see qualifier).** `processing-manual.pdf` (Drive file 1w8DkFYkrfLfxURmbCuQIQFfFG6nKOzWX, downloaded 2026-11-12; extracted to `processing-manual.txt`, 4,084 lines) contains **zero** occurrences of "toleran-" in the extracted text. **Qualifier:** the Stage 1 source inventory (Output 00, §5) established that this PDF's text layer is garbled/unreadable, so a zero-hit count on that extraction is weak evidence — the manual's content was not actually reviewed. The finding stands only as "no tolerance rule found in the text that could be extracted"; the manual must be OCR'd or re-encoded before any stronger claim is made (see gap 4). `CASE_PROCESSING.txt` likewise contains no benefit-tolerance rule; its only "tolerance" hit is "risk tolerance" in the internal-controls discussion (§ on assessing plan administrator internal controls), which is not a benefit tolerance. CASE_PROCESSING.txt does, however, require reasonableness tests and Spectrum reconciliation of the participant database (Phase III; Leo reasonableness test; Spectrum Reconciliation Summary reports) — i.e. the case process already expects a reconciliation step, but it prescribes no numeric tolerance for it.

**Finding 4 — The Defined Benefit Answer Book gives no tolerance rule.** Chapters 9 (Plan Benefits / Accrued Benefits), 16 (Census Data and Demographics), 25 (PBGC), and 27 (Plan Termination) were located in Drive folder `14gW5FTu_sfIRylt8KtFPn_8u40kF64Do`; Chapters 9 and 16 were downloaded and searched (local copies `~/workspace/pbgc_review/pa-amb/DBAB-Ch09.pdf`, `DBAB-Ch16.pdf`). Chapter 9 covers fractional accrual, unit-credit accrual, and when an accrued benefit can decrease (compensation-average decreases, Social Security offset increases, covered-compensation increases) — all relevant to §10 hypotheses — but states no reconciliation tolerance. Chapter 16 (Q 16:6) states census and demographic history are used "to calculate accrued benefits and to determine the reasonableness of assumptions" — supporting reasonableness screening as a method, but giving no numeric threshold. No tolerance rule was found in either chapter.

**Consequence for the design (§2.4):** the application ships with **no built-in acceptance tolerance**. Tolerances are case-level configuration, set by the actuary, recorded with rationale, and versioned with the calculation run. The application may *suggest* starting values drawn from 5.8-1 ($1.00 / $5.00 monthly) only if it labels them explicitly as "borrowed from the benefit-correction policy, not a reconciliation rule" — and the default suggestion must be presented as a question to the actuary, not a silent default.

### 1.3 What else was searched

- Drive full-text search for `tolerance` across the Book of Job returned 20 files; the only benefit-tolerance content was Policy 5.8-1 / 6.3-1 and the Benefit Corrections PDFs (two copies of the same document). Other hits (e.g. `R1 Simplified Instructions.docx`, `Actuarial Case Memo Sample Language.docx`, V1 summary JSONs) contain the word only incidentally.
- `BCV-DataValidation-predicates.xlsx` was located in `~/workspace/pbgc_review/pa-amb/` (pre-existing local copy); its predicates are validation rules, not tolerances — owned by Stage 1 Output 2.
- The `PBGC_670_Path_Index.md` (local, `~/workspace/pbgc_review/`) contains no "tolerance" entry.
- Chapters 25 and 27 were located but their full text was not searched for tolerances in this output; Chapter 27 text (pre-existing local copy `DBAB-Ch27.txt`) was grep-checked for "prior administrator" / "accrued" and contains no tolerance discussion. **Gap:** a full-text tolerance search of Chapters 25 and 27 remains open (see §6).

---

## Part A — Reconciliation (§10)

### 2.1 Core definitions

For each participant *i*, only after the comparison basis has been established as equivalent (§2.2):

$$\Delta_i = B_i^{PA} - \hat{B}_i$$

$$D_i = |\Delta_i|$$

$$R_i = \Delta_i / \hat{B}_i$$

- Δ_i is signed: positive means the administrator's amount exceeds the reconstruction; negative means it is lower. The sign matters — a systematic one-sided pattern across a cohort is evidence of a methodological difference, while a symmetric scatter is more consistent with rounding or data noise.
- D_i is the absolute dollar discrepancy (monthly benefit dollars).
- R_i is the relative discrepancy. **R_i is defined only when the denominator is meaningful.**

### 2.2 Preconditions: no comparison without an established basis

Before any Δ_i is computed, the system must establish, per participant, that B_i^PA and B̂_i share:

1. **Measurement date** (t_i) — the date through which the benefit was calculated. The dictionary says PA_AMB is "at DOTE"; the case must establish what DOTE means for this plan and whether the recorded amount was in fact calculated through that date. Distinguish the date the administrator *recorded* the benefit from the date *through which* it was calculated (MASTER_PROMPT §5).
2. **Retirement basis** — normal retirement date / age.
3. **Annuity form** — e.g. straight life annuity vs. joint-and-survivor; a form conversion is not a discrepancy.
4. **Vesting treatment** — whether any vesting percentage is already applied in B_i^PA (see §2.5, double-vesting hypothesis).
5. **Plan-provision version** — the formula, amendments, and grandfathering applicable at t_i.

If any element cannot be established, the participant is flagged **unresolved comparison basis** and excluded from the Δ_i statistics (it is counted separately, in the missing-data reporting of Part C). A recorded amount without an established measurement date must never be compared to a reconstruction on an assumed date.

**Units and arithmetic:** all benefit arithmetic uses decimal-safe arithmetic (integer minor monetary units or a verified decimal representation). Ordinary binary floating-point artifacts must never affect a monetary comparison or a rounding decision (MASTER_PROMPT §8).

### 2.3 Zero and near-zero denominators

R_i is **never computed** when B̂_i is zero or near zero. The rule:

- If B̂_i = 0 exactly: R_i is undefined; record the case as `R_UNDEFINED_ZERO_DENOMINATOR`. (A zero reconstructed benefit with a non-zero B_i^PA is itself a finding — e.g. a participant the reconstruction says has no accrued benefit — and must be investigated as a case, not reduced to a ratio.)
- If 0 < |B̂_i| < ε_R, where ε_R is a configurable threshold (suggested starting value: the smallest monthly amount the plan can pay, or $1.00/month if no plan minimum is documented — configurable, never hard-coded): R_i is **flagged, not computed**. Report Δ_i and D_i only, with flag `R_UNSTABLE_SMALL_DENOMINATOR`.
- If B_i^PA = 0 and B̂_i > 0: Δ_i = −B̂_i; R_i = −1 (i.e. −100%). This is arithmetically defined but must be flagged `PA_ZERO`, because a recorded zero is usually a missing-data or status question, not a benefit of zero (see §5.1).
- If both are zero: Δ_i = D_i = 0, R_i undefined; disposition depends on whether zero is the correct benefit (e.g. non-vested participant with no benefit) — a facts question, not an arithmetic one.

The denominator threshold ε_R, like all tolerances, is case configuration, recorded with the run.

### 2.4 Tolerances: configurable, documented, never universal

**Rule T-1 — No universal tolerance.** The application must not impose an arbitrary universal dollar or percentage tolerance. There is none in PBGC sources (§1.2, Finding 1), and a universal tolerance would silently decide cases.

**Rule T-2 — Tolerances are case configuration.** Each case records a tolerance set, with rationale, author, and date, versioned with the calculation run:

| Tolerance parameter | Meaning | How set |
|---|---|---|
| τ_abs (dollars/month) | Absolute tolerance on D_i | Actuary-set per case; may be tiered by benefit size |
| τ_rel (proportion) | Relative tolerance on \|R_i\| | Actuary-set per case |
| τ_rule | Combination rule | e.g. "within tolerance if D_i ≤ τ_abs **or** \|R_i\| ≤ τ_rel" (either-leg) vs. "both legs" — must be stated explicitly; the choice changes outcomes and must be visible |
| τ_material | Materiality threshold for plan-level reporting | Actuary-set; drives the frequency counts in §3.1 |
| ε_R | Small-denominator threshold (§2.3) | Actuary-set |

**Rule T-3 — A tolerance is a screening device, not a proof.** Falling within tolerance supports a Verified disposition only together with an established basis and no material unexplained item. Falling outside tolerance never by itself proves an error — it triggers investigation (§2.6). Numerical agreement is not sufficient proof of correctness if the underlying calculations use incorrect provisions (MASTER_PROMPT §14).

**Rule T-4 — Reference values the actuary may borrow (labelled, never defaulted silently).** The only PBGC dollar thresholds found are the 5.8-1 correction tolerances (§1.2): $1.00/month (decreases at determination issuance; increases after effectiveness) and $5.00/month (decreases after effectiveness). If the actuary adopts them as reconciliation screening values, the record must state: *"Screening values borrowed from Policy 5.8-1 Benefit Corrections; that policy governs correction of issued benefit determinations, not acceptance of PA_AMB. Adopted as case screening values by [name, date, rationale]."* A percentage leg, if used, has no PBGC source and must be labelled as actuary judgment.

**Rule T-5 — Tolerance review.** The tolerance set is reviewed whenever the case's formula mix, amendment cohorts, or data completeness materially change, and the review is logged. A tolerance set copied from another case without review is flagged.

### 2.5 Discrepancy explanations (§10 catalogue)

Every discrepancy must be investigated against this catalogue. The catalogue is a checklist for hypothesis generation (§2.6), not a menu to pick from by feel. Each hypothesis must name the evidence that would confirm or refute it.

| # | Explanation | What to check / evidence |
|---|---|---|
| H1 | **Different measurement dates** | t_i of B_i^PA vs. reconstruction date. Accrual between the two dates, compensation changes, amendment effective dates in between. The most common recurring problem: benefit evaluated as of NRD vs. DOTE vs. termination date. If the dates differ, the amounts are not comparable until re-based. |
| H2 | **Different credited service** | Service history: hire/termination/rehire dates, breaks in service, part-time proration, service-credit rules, prior-service grants. Counterfactual: recompute with service ± 1 year (§2.6). |
| H3 | **Different compensation histories** | Census compensation vs. payroll/plan records; missing years; definition changes (e.g. includable compensation); bonuses/overtime treatment. |
| H4 | **Alternative compensation averaging period** | Final-average vs. highest-average; 3-year vs. 5-year; consecutive vs. non-consecutive; averaging period ending at a different date. Counterfactual: recompute under each documented averaging rule. |
| H5 | **Incorrect or different accrual rate** | Accrual percentage α, step-rate/tiered schedules, service-band rates. Check the rate actually in effect at t_i, not the current rate. |
| H6 | **Historical plan amendments** | Formula changes, restatements, amendment adoption vs. effective dates. Never apply the latest formula retroactively (MASTER_PROMPT §5). |
| H7 | **Grandfathered benefit floors** | Greater-of old vs. new formula; protected benefits under IRC §411(d)(6); transitional formulas. A reconstruction that omits a grandfathered floor will understate the benefit systematically for the affected cohort. |
| H8 | **Service or compensation caps** | Maximum credited service (e.g. 30/35 years), compensation caps (IRC §401(a)(17)), benefit maximums (IRC §415). A cap applied by one side only produces a one-sided discrepancy above the cap. |
| H9 | **Benefit freezes** | Full or partial freeze dates; accruals after the freeze must be zero (or limited). A reconstruction that projects accrual past a freeze overstates. |
| H10 | **Social Security integration** | Permitted disparity / excess formulas; covered-compensation tables; Primary Insurance Amount offsets; offset increases over time (Answer Book Ch. 9 notes an accrued benefit can decrease when a Social Security offset increases). |
| H11 | **Previously paid distributions** | Prior lump sums, in-service distributions, QDRO alternate-payee offsets, prior annuity payments; restoration on rehire. A benefit already partly paid must be reduced accordingly. |
| H12 | **Vesting applied twice or omitted** | B_i^PA may already be vested (or not); the reconstruction may apply the vesting percentage a second time, or omit it. Check the dictionary basis and the admin's convention. A discrepancy equal (approximately) to the benefit × (1 − vesting %) is the signature of this error. |
| H13 | **Different annuity forms** | Straight life vs. joint-and-survivor vs. certain-and-continuous; conversion factors; pop-up provisions. Not a discrepancy until both sides are expressed on the same form. |
| H14 | **Different retirement dates** | NRD vs. early/late retirement date; early-retirement reduction factors; late-retirement actuarial increases. |
| H15 | **Rounding at different stages** | See §2.7. Compensation rounding, average rounding, service rounding, accrual-rate rounding, intermediate-component rounding, factor rounding, final monthly rounding. |
| H16 | **Missing information** | Any input the reconstruction lacks that the administrator had (or vice versa). Enters the §12 framework; the discrepancy is bounded, not explained away. |
| H17 | **Prior administrator calculation errors** | Arithmetic, wrong table, wrong era's factors, transposed digits, duplicated records. Diagnosis of exclusion: only after H1–H16 have been tested and fail, and only with positive evidence (recomputation from source documents), never by elimination alone. |

**Cohort signature rule.** A discrepancy explanation that is real will usually show a *pattern*: same sign, similar magnitude, confined to a definable cohort (an amendment cohort, an employment group, a service band, a date range). A pattern confined to a cohort is evidence *for* a systematic explanation (H5–H10, H12); a scatter with no cohort structure is more consistent with rounding (H15), data noise (H16), or isolated errors (H17). The statistical module (Part B) exists to make these patterns visible; the reconciliation module must consume its output.

### 2.6 Counterfactual hypotheses and ranking

**Hypothesis as an object.** Every diagnostic hypothesis is a record, not a comment:

- `hypothesis_id`, participant(s) or cohort, explanation (H1–H17), the **counterfactual operation** (exactly what changes: e.g. "credited service +1 year", "averaging period 5-year highest instead of 3-year final", "apply 1989 restatement formula instead of 1994 amendment formula"), the recomputed benefit under the counterfactual, the residual discrepancy after the counterfactual, the **evidence for** (document citations with page/section), the **evidence against**, and the status (proposed / tested / supported / refuted / indeterminate).

**Counterfactual tests (minimum set the engine must support):**

1. Service ± 1 year (and ± the exact disputed period, if a specific period is in question).
2. Each documented alternative averaging period.
3. Each documented historical formula version applicable to the participant.
4. Vesting applied / not applied / applied once vs. twice.
5. Each documented rounding sequence (§2.7).
6. Cap applied / not applied (service cap, compensation cap, §415 limit).
7. Freeze respected / ignored (as a diagnostic only — the freeze is legally binding; the test shows the size of the effect, it does not license ignoring it).
8. Prior distribution deducted / not deducted.

**Ranking rule — evidence and explanatory power, not numerical proximity.** Hypotheses are ranked by:

1. **Document support** (highest weight): the hypothesis is stated in, or follows directly from, a governing plan document, amendment, valuation report, or administrator workpaper, cited precisely. A document-supported explanation outranks any numerical coincidence.
2. **Explanatory power**: the counterfactual eliminates (or reduces below tolerance) the discrepancy *for the whole affected cohort*, not just for one participant. A hypothesis that fixes one participant but leaves 40 identical discrepancies unexplained is weak.
3. **Parsimony and specificity**: the hypothesis invokes one documented mechanism, not a combination of undocumented adjustments. A hypothesis requiring two simultaneous undocumented changes is suspect.
4. **Falsifiability**: the hypothesis states what evidence would refute it, and that evidence was sought.
5. **Numerical closeness (lowest weight, tie-breaker only):** among hypotheses equal on 1–4, the smaller residual discrepancy ranks higher. Numerical closeness alone is never sufficient: a match obtained by an arbitrary change is a coincidence until documented (see §2.7).

**Document-supported vs. numerical coincidence.** The system must label every hypothesis with its support class:

- **Supported** — a cited source document states or entails the mechanism, and the counterfactual resolves the discrepancy (within tolerance) for the affected cohort.
- **Plausible** — the mechanism is consistent with the documents but no document directly confirms it for this participant/cohort; the counterfactual resolves the discrepancy.
- **Coincidence** — the counterfactual produces a numerical match but no document supports the mechanism. Recorded as such; it must never be presented as an explanation, and it must never move a disposition to Verified.
- **Refuted** — the counterfactual does not resolve the discrepancy, or a document contradicts the mechanism.

**Multiple-hypothesis rule.** When two hypotheses both resolve the discrepancy, both are recorded and ranked; the system does not silently pick one. If they imply different corrected benefits, the disposition cannot be Correction recommended — it is Requires investigation (or Indeterminate if the evidence cannot distinguish them).

### 2.7 Rounding as a diagnostic hypothesis (§9)

Rounding may explain differences — and it is the easiest explanation to fake. Rules:

- **Configurable rounding rules** for: compensation, average compensation, credited service, accrual percentages, Social Security offsets, intermediate benefit components, retirement factors, actuarial equivalence factors, final monthly benefits. Rounding may occur after individual operations, annual accruals, intermediate results, or final calculations — the plan or the evidence decides which, never an assumption.
- **Diagnostic procedure:** the engine evaluates *alternative plausible rounding sequences* as hypotheses (H15) and quantifies each one's effect on Δ_i: for each sequence, recompute B̂_i and record the residual. The maximum plausible rounding effect for a participant is bounded by the sum of the per-stage rounding units (e.g. rounding monthly benefits to the cent bounds any single-stage effect at $0.005; rounding service to whole years can move a benefit by a full year's accrual — much larger).
- **The anti-coincidence rule (mandatory):** *a successful numerical match obtained by arbitrary changes to rounding conventions must not be treated as proof of the administrator's actual methodology.* A rounding hypothesis is Supported only if (a) the rounding sequence is documented in the plan, the administrator's workpapers, or a valuation report, or (b) the same sequence resolves discrepancies across the cohort (not just one participant) and no document contradicts it. Otherwise it is Coincidence.
- **Rounding-stage attribution:** when rounding is the supported explanation, the report names the stage(s) (e.g. "final monthly benefit rounded to nearest cent; service rounded down to completed years per plan §X") and the quantified effect. "Rounding" without a stage and a number is not an explanation.

---

## Part B — Statistical analysis (§11)

Purpose: make patterns visible across the population so that systematic explanations are found and isolated errors are not mistaken for patterns (or vice versa). **A statistical model estimates patterns; it does not establish any participant's legally correct benefit.** Every statistical output is an input to investigation, never a substitute for the plan formula.

All statistics are computed on the *reconciliation population* — participants with an established comparison basis — and reported alongside the counts excluded for unresolved basis or missing B_i^PA, so that denominators are never ambiguous.

### 3.1 Descriptive statistics

Report, for the population and for each stratum below:

- **Counts** by participant status (active, terminated vested, retired/in pay, deceased with beneficiary, alternate payee) and demographic group (age band, sex where recorded, employment group — union/non-union or other plan-defined groups).
- **Benefit levels:** mean, median, standard deviation, quantiles (p1, p5, p25, p50, p75, p95, p99), min, max — for B_i^PA and B̂_i separately.
- **Discrepancy distributions:** distribution of Δ_i, D_i, R_i (histograms; quantiles; share positive vs. negative — a one-sided share far from 50% is itself a finding).
- **Error summaries:** RMSE = √(mean(Δ_i²)) and MAE = mean(D_i), overall and by stratum. Report both: RMSE penalizes large errors and exposes a few big mistakes; MAE describes the typical error.
- **Materiality-threshold frequencies:** counts and shares of participants with D_i > τ_abs, |R_i| > τ_rel, and outside the combined tolerance rule (§2.4), at the case tolerance set and at the 5.8-1 reference values ($1.00 / $5.00) for comparability.
- **Missing-data patterns:** counts of blank B_i^PA, missing measurement date, missing service, missing compensation years — by status and cohort (see Part C).
- **Stratification (mandatory):** by formula type, amendment cohort, employment group, and status. A pooled statistic that hides a cohort effect is misleading; every headline number is accompanied by its stratified table.

**Worked synthetic example (fictional participants — no real data):**

| Participant (fictional) | B_i^PA | B̂_i | Δ_i | D_i | R_i |
|---|---|---|---|---|---|
| A-101 | $1,240.00 | $1,238.50 | +$1.50 | $1.50 | +0.12% |
| A-102 | $860.00 | $860.00 | $0.00 | $0.00 | 0.00% |
| A-103 | $2,150.00 | $1,930.00 | +$220.00 | $220.00 | +11.40% |
| A-104 | $0.00 (recorded) | $412.75 | −$412.75 | $412.75 | −100% (flag `PA_ZERO`) |
| A-105 | $975.40 | $4.10 | +$971.30 | $971.30 | R flagged `R_UNSTABLE_SMALL_DENOMINATOR` (B̂_i < ε_R) |

A-103's +11.4% is the kind of case that enters hypothesis testing (§2.6); A-104's recorded zero is a missing-data/status question (§5.1), not a −100% error; A-105's ratio is suppressed because the denominator is not meaningful.

### 3.2 Outlier detection

**Principle:** outliers are investigated, never auto-corrected. An outlier flag is a work-list entry, not a correction.

**Univariate methods (applied to Δ_i, D_i, and R_i where defined, and to B_i^PA and B̂_i):**

- **Robust z-score (modified z-score) via median and MAD** — the primary method. M_i = 0.6745 × (x_i − median(x)) / MAD, where MAD = median(|x_i − median(x)|). Flag |M_i| > 3.5 (Iglewicz & Hoaglin, 1993). The 0.6745 factor puts the score on the standard-deviation scale for normal data; the median and MAD have a 50% breakdown point, so a few extreme values cannot mask each other. **Degenerate case:** if MAD = 0 (more than half the values identical — common when many participants share Δ_i = 0), fall back to the mean absolute deviation from the median, and record the fallback. Never divide by zero.
- **IQR (Tukey) fences:** flag x outside [Q1 − 1.5×IQR, Q3 + 1.5×IQR]; "far out" beyond 3×IQR flagged separately (Tukey, 1977).
- **Percentile screening:** flag the top/bottom 0.5% and 1% of Δ_i and R_i as a review list, with the percentile cut points reported so the actuary can see how arbitrary the cut is.
- **Classical z-score** (|z| > 3) may be reported for reference but must not be the decision rule: the mean and SD are themselves distorted by the outliers being hunted (masking).

**Multivariate and model-based methods:**

- **Mahalanobis distance** on (age, service, compensation, benefit) with a robust covariance estimate (e.g. Minimum Covariance Determinant); flag by chi-square quantile. Use a robust covariance — the classical covariance is distorted by the same outliers.
- **Isolation forest** (Liu, Ting & Zhou, 2008) as a secondary screen on the same variables; report anomaly scores, not just a binary flag, and record the contamination parameter used.
- **Model residual diagnostics:** residuals from the §3.3 models, with leverage (hat values) and influence (Cook's distance, Cook 1977). A participant with a large residual *and* high leverage deserves investigation of both the data and the model.
- **Group/cohort-specific outliers (mandatory):** every univariate and multivariate screen is run **within** each formula type and amendment cohort as well as pooled. A benefit that is ordinary in its own formula group but extreme in the pooled population is not an error; conversely, a participant ordinary in the pooled population may be extreme within a small, homogeneous cohort. **Never classify legitimate formula-group differences as errors merely because they are unusual in the pooled population.**

**Outlier disposition:** each flagged participant gets: the method(s) that flagged it, the score(s), the cohort context, the investigation outcome (explained by H1–H17 / data error confirmed / legitimate but unusual / unresolved), and the §14 disposition. An outlier with a legitimate explanation (e.g. a grandfathered floor, a QDRO split) is closed as explained, with the citation — the flag is not removed from history, it is resolved.

### 3.3 Multivariate modeling

Models are exploratory and diagnostic. They answer "what predicts the discrepancy?" and "which participants look like known problem patterns?" — never "what is the correct benefit?"

**Candidate models (use as justified by sample size and data; not all on every case):**

| Model | Use in this system | Key caution |
|---|---|---|
| Robust linear regression (Huber M-estimation; Huber, 1981/2009) | Model Δ_i or R_i on candidate predictors; resistant to the outliers being investigated | Check for heteroscedasticity (residuals grow with benefit size — model R_i or log-benefit, or weight); report robust standard errors |
| Regularized regression (ridge / lasso) | Predictor selection when many candidate variables; lasso drops irrelevant predictors | Coefficients are shrunken — do not interpret them as actuarial effects; use for screening, not for benefit formulas |
| Generalized additive models (GAMs; Hastie & Tibshirani, 1990; Wood, 2017) | Nonlinear effects (e.g. discrepancy vs. service or age may be non-monotone near caps and freezes) | Smoothness choices must be recorded; a GAM that fits a cap as a smooth curve has not "discovered" the cap — the cap is a plan rule |
| Mixed-effects / hierarchical models (Gelman & Hill, 2007) | Participants nested in employment groups, locations, or amendment cohorts; partial pooling across small cohorts | Random effects are descriptive grouping, not evidence about any individual |
| Bayesian models (when useful) | Principled uncertainty on coefficients and predictions; prior must be stated and justified | A prior is an assumption, not a fact; sensitivity to the prior must be reported |
| Interpretable classification (decision trees / rule lists; Breiman et al., 1984) | Classify recurring discrepancy patterns (e.g. "service > 30 years AND amendment cohort 1994 ⇒ Δ > 0") | Trees overfit readily — prune, cross-validate, and require a minimum leaf size; a tree split is a hypothesis, not a rule |

**Candidate explanatory variables** (MASTER_PROMPT §11): age, service, compensation, employment group, retirement status, benefit formula, amendment cohort, data completeness, time since the benefit was calculated. Additional candidates: measurement-date era, data source (which administrator / which file), number of employment periods, presence of a QDRO, prior-distribution indicator. **Never include as a predictor any variable derived from B_i^PA or B̂_i themselves** (e.g. Δ_i components) — that is leakage.

**Model evaluation and discipline:**

- **Fit and predictive performance:** report R² (or robust equivalent), residual scale, and out-of-sample performance via k-fold cross-validation stratified by cohort. In-sample fit alone is not evidence.
- **Uncertainty:** report coefficient uncertainty (robust SEs / credible intervals) and prediction intervals where the model produces them.
- **Sample size:** small cohorts (n < 30, or fewer than ~10 observations per predictor) get descriptive treatment only — no multivariate model, or a model explicitly labelled underpowered. Do not fit a 12-predictor model to 40 participants.
- **Influential observations:** report Cook's distance / DFBETAS; refit without the top influencers and report whether conclusions change. If they do, the model is not stable and the finding is not reported as established.
- **Leakage and overfitting:** predictors must be knowable without the outcome; no peeking at Δ_i when constructing predictors; cross-validation folds must respect cohort structure (grouped folds by cohort where cohorts are the generalisation unit); regularisation and pruning are mandatory for flexible models.
- **Interpretation rule:** a model coefficient is a pattern in the data. It becomes an actuarial finding only when a plan document, amendment, or valuation report explains it. The model proposes; the documents dispose.

### 3.4 Heuristics

Heuristics are screening aids only. Each heuristic in the application must be labelled as a heuristic, with its reference or empirical basis, and must never override the governing plan formula.

**Heuristics adopted in this methodology (each is a screening flag, not a rule):**

| Heuristic | Statement | Basis / status |
|---|---|---|
| Benefit-to-compensation ratio | Monthly accrued benefit vs. final-average monthly compensation: a ratio far outside the plan's accrual design (e.g. an accrued benefit exceeding ~100% of final-average pay for a non-grandfathered formula, or a ratio near zero for a long-service participant) is flagged for review | Plan-design arithmetic: B ≈ α × S × C̄ implies B/C̄ ≈ α×S; the flag threshold must be set from the plan's own α and service range. **No universal ratio is asserted.** The ratio's plausibility is plan-specific by construction. |
| Accrual-pattern check | Benefit per year of service (B̂_i / S_i) should be broadly comparable within a formula group; a participant whose per-year accrual is an order of magnitude off the group median is flagged | Empirical within-cohort comparison (median/MAD on the per-year rate, §3.2). The reference is the cohort itself, not an external standard. |
| Service sensitivity | Changing credited service by one year changes the benefit by approximately one year's accrual (α × C̄); a discrepancy much larger than a few years' accrual is unlikely to be a service error alone | Formula arithmetic; used to size hypotheses (§2.6), not to decide them. |
| Reasonableness of assumptions | Census and demographic history are used "to calculate accrued benefits and to determine the reasonableness of assumptions" | Defined Benefit Answer Book, Ch. 16, Q 16:6 (Donovan et al., 2024 ed.). This supports reasonableness screening as a method; it supplies no numeric threshold. |
| Small-benefit attention | Very small benefits deserve the same scrutiny as large ones in absolute dollars they are immaterial, but a pattern of small-benefit errors can indicate a systematic data problem | Judgment (level 6). Labelled as such; the materiality threshold τ_material (§2.4) is the actuary's, not the heuristic's. |

**Heuristics NOT adopted:** no invented industry standard, no "typical" accrual rate, no universal benefit-to-pay ratio, no rule of thumb taken from a textbook illustration. If a future heuristic is proposed, it enters only with a cited reference or a documented empirical basis from the case's own data, and it is labelled with that basis.

---

## Part C — Missing-data analysis and uncertainty (§12)

This part exists so that the system keeps working when exact reconstruction is impossible (§0). Missing data is the normal condition of historical reconstruction, not an exception.

### 4.1 The five-way framework

Every missing input for a participant is classified into exactly one of:

| Class | Meaning | Consequence |
|---|---|---|
| **M1 — Required for exact reconstruction** | The benefit cannot be computed exactly without it, and no substitute exists | B̂_i does not exist; go to bounds (§4.3) or Indeterminate |
| **M2 — Recoverable from other documents** | The value exists in another source (valuation report, prior benefit schedule, payment record, plan document) | A data request / retrieval task is created; the reconstruction is pending, not failed |
| **M3 — Reasonable bounds establishable** | The value is unknown but constrained (e.g. compensation between two known years; service between hire and termination dates) | Bounds B_i^min / B_i^max are computed (§4.3) |
| **M4 — Requires assumptions** | No document constrains the value; an actuarial assumption is needed | The assumption is stated explicitly, with its basis and its effect on the result (sensitivity, §4.4); the result is labelled assumption-dependent |
| **M5 — Makes reconstruction indeterminate** | The missing input is load-bearing and unconstrained (e.g. the formula itself is unknown for the participant's era; no compensation history at all and no bound) | No B̂_i and no justified bounds; disposition Indeterminate unless another line of evidence supports acceptance |

**Classification is per input, per participant, and recorded.** A participant's record lists each missing input, its class, its source (or absence of source), and the classification rationale. A missing input is never silently dropped from the calculation.

**Missing-data mechanism (statistical characterisation).** Where the statistical module analyses missingness, it uses Rubin's taxonomy (Little & Rubin, 2019, 3rd ed.; Rubin, 1976):

- **MCAR** (missing completely at random): missingness unrelated to observed or unobserved values. Testable (Little's MCAR test, Little, 1988). If MCAR holds, complete-case summaries are unbiased (but inefficient).
- **MAR** (missing at random): missingness depends on observed data only. Not testable against MNAR from the observed data. Multiple imputation (Rubin, 1987) under a correctly specified imputation model is the standard approach — for *statistical summaries and models*, not for individual benefit determinations.
- **MNAR** (missing not at random): missingness depends on the missing value itself (e.g. benefits missing precisely because the administrator could not compute them — the most dangerous case here). Not identifiable from observed data; requires sensitivity analysis (§4.4) and documented judgment.

**Critical boundary:** multiple imputation and other statistical missing-data methods may be used for population-level summaries and for the §3.3 models. They must **never** be used to fill in an individual participant's benefit inputs and then present the result as that participant's reconstructed benefit. An imputed compensation year is a statistical device; a reconstructed benefit must be built from facts, documented bounds, or stated assumptions — and labelled as such.

### 4.2 Blanks are missing, never zero

- A blank PA_AMB is **missing data**, never B_i^PA = 0, unless a governing rule explicitly requires zero treatment — and no such rule was found in the sources searched (§1.2). The same applies to blank service, blank compensation, and blank dates.
- A recorded zero is different from a blank: a recorded zero is a value and is investigated as one (e.g. non-vested participant, prior distribution exhausted the benefit). The system must distinguish blank from zero at import and preserve the distinction permanently (original values stored separately from normalized values, MASTER_PROMPT §6).
- Counts of blanks, by field and by cohort, are reported in every plan-level summary (§3.1). A cohort with a high blank rate for B_i^PA is a data-quality finding in its own right.

### 4.3 Mathematically justified bounds

Where exact reconstruction is impossible but the missing inputs are constrained (class M3), the system computes bounds:

$$B_i^{min} \le B_i^{possible} \le B_i^{max}$$

**Rules for bounds:**

- **B-1 — Bounds are derived, not estimated.** Each bound is computed by evaluating the benefit formula at the extreme values of the missing inputs that are consistent with the known facts and the plan provisions. E.g. if one compensation year is missing but the two adjacent years are known and the plan's compensation definition is known, the missing year is bounded by [min(adjacent years) adjusted for any documented cap, max(adjacent years)] — or by a wider interval if the plan permits bonuses in that year. Every bound states the assumptions that produce it.
- **B-2 — Bounds are not confidence intervals.** A 95% confidence interval from a statistical model is a statement about sampling uncertainty; it is not a guarantee that the true benefit lies inside it. Bounds in this system are guarantees *conditional on the stated assumptions*: if the assumptions hold, the true benefit (under the correct formula) lies in [B_i^min, B_i^max]. The two must never be confused or relabelled.
- **B-3 — Monotonicity must be verified.** Bounds computed by plugging in extreme inputs are valid only if the benefit is monotone in each missing input over the relevant range. Most formulas are monotone in service and compensation, but grandfathered greater-of formulas, caps, and offsets can break monotonicity. The engine must verify monotonicity (by evaluating the formula at the endpoints *and* at any internal kink points — cap thresholds, freeze dates, formula-change dates) or fall back to a grid/optimisation over the feasible region. A bound computed at endpoints only, for a non-monotone formula, is wrong.
- **B-4 — Bounds widen honestly.** As more inputs go missing, bounds widen. The system must not narrow bounds by importing an unstated assumption (e.g. "compensation probably grew 3% a year"). If an assumption narrows the bounds, it is stated as an assumption (class M4) and the assumption-free bounds are also reported, so the actuary can see what the assumption bought.
- **B-5 — Evaluating the reported benefit against the range:**
  - B_i^PA inside [B_i^min, B_i^max]: consistent with the evidence. Supports (does not prove) acceptance; disposition depends on the width of the range and the hypotheses (§4.5).
  - B_i^PA outside the range: inconsistent with the known facts under the stated assumptions. Either an assumption is wrong, the formula version is wrong, or the administrator's amount is wrong — investigation required. This is a strong finding precisely because the range is a guarantee conditional on the assumptions.
  - Range width vs. materiality: if B_i^max − B_i^min is small relative to τ_material, the uncertainty is immaterial and the case can proceed; if it is large, the uncertainty itself is the finding, and the disposition reflects it.

**Worked synthetic example (fictional):** Participant B-207, formula 1.5% × service × final-3-year average monthly compensation. Service is 22 years (documented). Two of the three averaging years are known ($5,000 and $5,200/month); the third year is missing (class M3) but is bounded by the plan's compensation records: no less than $4,800 (lowest monthly compensation in any known year) and no more than $5,400 (the §401(a)(17) cap in effect, expressed monthly). Then the average is bounded by [($4,800+$5,000+$5,200)/3, ($5,400+$5,000+$5,200)/3] = [$5,000.00, $5,200.00], and B_i^possible ∈ [0.015 × 22 × $5,000, 0.015 × 22 × $5,200] = [$1,650.00, $1,716.00]. If B_i^PA = $1,680.00, it lies inside the range — consistent. If B_i^PA = $1,900.00, it lies outside — inconsistent under the stated assumptions, and the assumptions (or the administrator's amount) must be re-examined. Note the bound used only documented facts and a stated cap; no imputed year was invented.

### 4.4 Scenario and sensitivity analysis

- **Scenario analysis:** for each participant with missing inputs, the system evaluates a defined set of scenarios — e.g. "missing year at lower bound", "missing year at upper bound", "missing year at the average of known years (labelled assumption)", "alternative formula version", "alternative measurement date" — and reports the benefit under each, with the scenario definition attached. Scenarios are discrete, named, and reproducible.
- **Sensitivity analysis:** one-input-at-a-time variation over each missing input's plausible range, reporting the change in the benefit (in dollars/month) and the change in the *disposition* (does the participant cross a tolerance or materiality threshold?). A tornado-style ranking (largest disposition-changing effect first) is the primary output.
- **Disposition sensitivity:** the key question is not "how much does the benefit move?" but "does the decision change?" A missing input that moves the benefit by $200/month but never moves the participant out of tolerance is less important than one that moves it by $3/month across a disposition boundary. Sensitivity is reported in decision terms.
- **MNAR sensitivity:** where missingness may be MNAR (e.g. benefits missing for participants whose records were lost in a specific era), the system runs the analysis under alternative missingness assumptions (e.g. missing benefits assumed systematically higher / lower than observed) and reports how the plan-level conclusions move. This is a stress test, not a correction.

### 4.5 Contribution of each missing input to uncertainty

For each participant, the report attributes the width of [B_i^min, B_i^max] (or the disposition uncertainty) to individual missing inputs:

- **Method:** leave-one-out bounding — recompute the bounds with each missing input hypothetically known at its midpoint (or at its most likely value, labelled as assumption) and record how much the interval narrows. The inputs are then ranked by interval-narrowing.
- **Output:** a per-participant table — missing input, class (M1–M5), contribution to interval width (dollars/month and share), and whether resolving it could change the disposition.
- **Plan-level aggregation:** sum of interval widths by missing-input type, showing which data gap matters most across the case. This is the evidence base for prioritising data requests (§4.6).

### 4.6 Prioritising additional data requests

Data requests are prioritised by **expected effect on the decision**, not by completeness for its own sake:

1. **Disposition-changing potential first:** inputs whose resolution could move a participant between dispositions (especially out of Indeterminate / Requires investigation into a decidable state) rank highest.
2. **Breadth second:** an input missing for many participants (e.g. a whole compensation year for an amendment cohort) outranks a one-participant gap of the same size.
3. **Recoverability third:** class M2 (recoverable from other documents) outranks M4/M5 of equal decision impact, because the request has a known source and a high success probability.
4. **Cost/effort last:** where the actuary records retrieval effort, high-effort requests need proportionally higher decision impact.

Each data request records: the input, the participants affected, the expected decision effect, the source to ask, and the status. A request that returns no data is recorded as such — the Indeterminate disposition then stands on a documented exhausted search, which is itself a defensible outcome.

### 4.7 Linking missing-data outcomes to the §14 dispositions

Every participant ends with exactly one disposition (§0.4). The mapping from the missing-data analysis:

| Evidence state | Disposition |
|---|---|
| B̂_i exact; Δ within tolerance; basis established | **Verified** |
| B̂_i not exact; B_i^PA inside justified bounds; bounds narrow relative to materiality; no better competing hypothesis | **Supported for acceptance** |
| B̂_i not exact; B_i^PA inside bounds but bounds wide relative to materiality, or a competing hypothesis is unresolved | **Requires investigation** |
| B_i^PA outside justified bounds, or a supported hypothesis identifies a specific error and the corrected value | **Correction recommended** (only if the corrected value itself is established with reasonable certainty, per Policy 5.8-1 §D) |
| B_i^PA outside bounds but the assumptions behind the bounds are themselves in doubt | **Requires investigation** (re-examine assumptions before recommending a correction) |
| No B̂_i and no justifiable bounds (class M5, or unresolved comparison basis that cannot be resolved) | **Indeterminate** — with the missing inputs, their classes, and the data requests that would change the outcome |
| B_i^PA blank (missing) | **Indeterminate** until the administrator's amount is obtained or the benefit is established independently; if the independent reconstruction is exact and the blank is a data-transfer failure, the disposition follows the reconstruction with the blank recorded as a data-quality finding |

**Indeterminate is a complete outcome.** It is not a failure of the system; it is the system correctly reporting the limits of the evidence. An Indeterminate disposition must name the evidence that would resolve it — otherwise it is an incomplete report, not a disposition.

---

## 5. Cross-cutting rules

### 5.1 Blanks, zeros, and status

- Blank ≠ zero (§4.2). A blank PA_AMB enters the missing-data framework; a recorded zero is investigated as a value.
- A participant whose status says "terminated vested" with a blank benefit and a participant whose status says "non-vested, no benefit" with a recorded zero are different cases; the validation module (Stage 1 Output 2) owns the status/benefit consistency checks, and this module consumes its results.
- Duplicate participant records, if found, are a data-quality finding; the reconciliation must not double-count them. (Owned by Output 2; flagged here because duplicates corrupt every statistic in Part B.)

### 5.2 Reproducibility and audit

- Every number in this methodology is reproducible from the retained input snapshot and the approved rule/tolerance version (MASTER_PROMPT §15, §17). The tolerance set, the rounding sequences tested, the hypothesis records, the bound assumptions, and the model specifications are all part of the run record.
- No statistical result may automatically become an approved participant benefit (invariant, MASTER_PROMPT §17). A model output is a work-list entry; a disposition is a human decision.
- Corrections never silently destroy the previous calculation basis: original imported values are stored separately from normalized or corrected values, with a revision/event mechanism (MASTER_PROMPT §6).

### 5.3 Scale and performance notes for the statistical module

- Descriptive statistics and univariate screens are O(n) or O(n log n) and must run interactively at the benchmark sizes (100 / 1,000 / 10,000 / 100,000 participants, MASTER_PROMPT §21).
- Multivariate models and isolation forests are the expensive steps; they run on demand (not on every import), with progress reporting, and their results are cached against the input snapshot + model specification.
- All statistics must be computable offline, in the browser, under file://, with no server — the architecture decision (Stage 1 Output 4) must confirm which statistical routines are feasible in the chosen stack; if a method (e.g. full Bayesian MCMC) is not feasible offline, this methodology degrades gracefully to the robust/regularized methods, and the degradation is documented rather than silently substituted.

---

## 6. Gaps, open questions, and what was not established

1. **No PBGC reconciliation tolerance for PA_AMB exists in the sources searched.** The tolerance framework in §2.4 is a design requirement, not a PBGC rule. The actuary must set tolerances per case. (Highest-priority open item.)
2. **PA_AMB basis not fully established.** "At DOTE", annuity form, and vesting treatment are not defined in the dictionary row text. Owned by Stage 1 Output 2; until resolved, §2.2's unresolved-basis flag is the operative rule.
3. **Chapters 25 and 27 of the Answer Book not fully searched for tolerance language.** Located in Drive; Chapter 27 text was spot-checked only. A full-text search remains open.
4. **`processing-manual.pdf` vs. `CASE_PROCESSING.txt`.** The manual was downloaded and text-searched (no tolerance hits); whether CASE_PROCESSING.txt is a complete extraction of it was not verified. If the manual contains material not in the .txt, it could contain relevant guidance — low probability for tolerances, given the zero-hit search, but recorded.
5. **Benefit Corrections PDF — two copies in Drive** (12O_H1mXghYEDs8i8eILqYn5C2EocGmrJ and 1x5KlGUK5yZsENpfKUSOSScoLLHT6KnQk). Only the first was downloaded; the second was assumed identical by name. If they differ, the tolerance record must be corrected.
6. **Policy 5.8-1 edition currency.** The 3rd edition (10/02/2014) is the latest found in `current-policies.txt`. Whether a later edition exists was not verified against PBGC's current policy set; the file's currency should be confirmed before the application cites it to a user.
7. **Heuristic thresholds are plan-specific by design.** No external "typical" benefit-to-pay ratio or accrual benchmark is adopted (§3.4). If the actuary wants a cross-plan empirical reference, that is a separate research task with its own sourcing.
8. **Statistical reference implementations.** The methods in Part B are specified mathematically; their implementation, numerical verification against trusted reference calculations, and offline feasibility are Stage 3–5 work. No statistical routine is claimed production-ready on the basis of this document.
9. **Small-cohort rule needs a numeric floor.** §3.3 says small cohorts get descriptive treatment only; the exact floor (suggested: n < 30, or < 10 observations per predictor) is a starting point for the actuary to confirm, not a PBGC rule.
10. **The §401(a)(17) cap figure in the §4.3 example** is illustrative and synthetic; the bound machinery must pull the cap in effect for the relevant year from the plan's own data, not from this document.

---

## 7. Sources consulted

### PBGC sources (Book of Job)

| Source | What was taken from it | Location |
|---|---|---|
| PBGC Operating Policy 5.8-1, Benefit Corrections, 3rd Ed., 10/02/2014, Transmittal 2015-01 | Tolerance rules ($1.00 / $5.00), "reasonable certainty" standard, scope dates | `current-policies.txt` (~lines 7400–7560); `Benefit_Corrections.pdf` (Drive 12O_H1mXghYEDs8i8eILqYn5C2EocGmrJ; local `~/workspace/pbgc_review/pa-amb/Benefit_Corrections.pdf`) |
| PBGC Operating Policy 6.3-1, Underpayment Reimbursement and Interest Payments (eff. 10/01/2017) | Applies 5.8-1 tolerances to pre-termination liabilities; $1 net-underpayment payment rule; 29 CFR §4022.81(c) | `current-policies.txt` (~lines 14520–14610, 14810–14860) |
| CASE_PROCESSING.txt | Reasonableness tests, Spectrum reconciliation, Leo validation; no tolerance rule; Policy 5.8-1 cross-references (lines 755, 2616, 2655, 2691, 2732) | Local `~/workspace/pbgc_review/eadj/CASE_PROCESSING.txt` |
| processing-manual.pdf | Text-searched: zero "toleran-" hits; zero "reasonableness / prior administrator / accrued monthly" hits (extraction may be incomplete — see gap 4) | Drive 1w8DkFYkrfLfxURmbCuQIQFfFG6nKOzWX; local `~/workspace/pbgc_review/pa-amb/processing-manual.pdf` + `.txt` (4,084 lines) |
| BCV Data Dictionary (2026-10-30 index) | PA_AMB (BCV9, row 1031), PA_AMB_ACCEPT (BCV3, row 629) | Local `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` |
| Defined Benefit Answer Book, Ch. 9 (Plan Benefits / Accrued Benefits) | Fractional/unit-credit accrual; when accrued benefits decrease | Drive 1IcoqAA-T7qt-hiMh498EMwEIV30LrXdt; local `~/workspace/pbgc_review/pa-amb/DBAB-Ch09.pdf` |
| Defined Benefit Answer Book, Ch. 16 (Census Data and Demographics), Q 16:6 | Census data used "to calculate accrued benefits and to determine the reasonableness of assumptions" | Drive 1iZEkzRm8VkSNo1zKxXufyLaCUBjnpqjR; local `~/workspace/pbgc_review/pa-amb/DBAB-Ch16.pdf` |
| Defined Benefit Answer Book, Ch. 27 (Plan Termination) | Spot-checked; no tolerance discussion found | Drive 13ZDypWmj1MlCpbnjpuPOmqVQhqodJJFg |
| PBGC_670_Path_Index.md | Searched for "tolerance": no entry | Local `~/workspace/pbgc_review/PBGC_670_Path_Index.md` |

### Statistical references (standard methodology)

| Reference | Used for |
|---|---|
| Iglewicz, B. & Hoaglin, D. C. (1993). *How to Detect and Handle Outliers*. ASQC Quality Press. | Modified z-score (median/MAD), flag \|M\| > 3.5 |
| Tukey, J. W. (1977). *Exploratory Data Analysis*. Addison-Wesley. | IQR fences (1.5× / 3×) |
| Huber, P. J. (1981; 2nd ed. 2009). *Robust Statistics*. Wiley. | Huber M-estimation, robust regression |
| Hastie, T. & Tibshirani, R. (1990). *Generalized Additive Models*. Chapman & Hall. | GAMs |
| Wood, S. N. (2017). *Generalized Additive Models: An Introduction with R* (2nd ed.). Chapman & Hall/CRC. | GAM implementation and diagnostics |
| Gelman, A. & Hill, J. (2007). *Data Analysis Using Regression and Multilevel/Hierarchical Models*. Cambridge. | Mixed-effects / hierarchical models |
| Breiman, L., Friedman, J., Olshen, R. & Stone, C. (1984). *Classification and Regression Trees*. Wadsworth. | Interpretable classification |
| Liu, F. T., Ting, K. M. & Zhou, Z.-H. (2008). Isolation Forest. *ICDM '08*. | Multivariate anomaly detection |
| Cook, R. D. (1977). Detection of Influential Observation in Linear Regression. *Technometrics* 19(1). | Cook's distance |
| Mahalanobis, P. C. (1936). On the generalised distance in statistics. *Proc. Nat. Inst. Sci. India* 2(1). | Mahalanobis distance |
| Little, R. J. A. & Rubin, D. B. (2019). *Statistical Analysis with Missing Data* (3rd ed.). Wiley. | MCAR/MAR/MNAR taxonomy; missing-data methods |
| Little, R. J. A. (1988). A test of missing completely at random. *JASA* 83(404). | Little's MCAR test |
| Rubin, D. B. (1976). Inference and missing data. *Biometrika* 63(3). | Missing-data mechanism framework |
| Rubin, D. B. (1987). *Multiple Imputation for Nonresponse in Surveys*. Wiley. | Multiple imputation; Rubin's rules |
| Rousseeuw, P. J. & Croux, C. (1993). Alternatives to the median absolute deviation. *JASA* 88(424). | Robust scale estimators (MAD alternatives; degenerate-MAD fallback) |

### Not consulted / not relied on

- **Chapters 3, 4, 25 of the Answer Book** — located, not searched for this output (formula content belongs to Stage 1 Output 1).
- **BCV-DataValidation-predicates.xlsx** — located in `~/workspace/pbgc_review/pa-amb/`; validation predicates belong to Stage 1 Output 2 and were not used as tolerance authority.
- **No live case data, no participant-level census rows, no golden case** were used or requested. All worked examples are synthetic and fictional.

---

## 8. Handoff notes for Stages 2–5

1. **Tolerance configuration is a Stage 2 data-model item:** the tolerance set (§2.4) must be a versioned case-level entity, not a constant in code.
2. **Hypotheses are first-class entities** (§2.6): the Stage 2 data model must carry DiagnosticHypothesis with support class, counterfactual operation, and evidence citations — it already appears in the MASTER_PROMPT §6 entity list; this document specifies its fields.
3. **Bounds engine before point-estimate engine (Stage 4):** the bound computation (§4.3, with monotonicity/kink handling) is a core engine requirement, not an add-on. A Stage 4 engine that can only produce point estimates does not meet §0.
4. **Disposition completeness is a testable invariant (Stage 7):** every participant in a finished run has exactly one §14 disposition, including Indeterminate. Test it.
5. **Statistical module scope (Stage 5):** descriptive + univariate screens first; multivariate models on demand; Bayesian/MCMC only if the Stage 3 architecture decision confirms offline feasibility.
6. **Rounding sequences are hypotheses, not settings to tune until a match appears** (§2.7). The UI must make the anti-coincidence rule visible: a rounding match with no document support is labelled Coincidence.
