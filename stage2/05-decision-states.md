# Stage 2 — Output 5: Decision States — Decision State Machine and Invariants

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repository:** ErChulo/pbgc-pa-amb-analysis (public, `main`)
**Governing spec:** `MASTER_PROMPT.md` (§14 actuarial acceptance framework; §17 state-driven
computational design; §10 reconciliation; §12 missing-data analysis)
**Stage:** 2 — Mathematical and data architecture (design work only; no code, no app, no tests)
**Date:** 2026-11-12
**Status:** Design specification. Nothing here is an official PBGC classification, tolerance, or rule
unless a PBGC source is cited for it.
**Depends on:** Stage 1 outputs 00 (source inventory), 02 (data requirements and validation),
03 (reconciliation and statistical methodology), 04 (architecture decision).

---

## 0. Status and scope

This file defines the decision state machine for one participant's PA_AMB determination:
the five dispositions as a versioned state machine, the human approval gate, Indeterminate as
a legitimate terminal outcome, the §17 state-driven design (`S_{t+1} = T(S_t, E_t)`), the
invariants, and the determination record that carries the ten §14 documentation items.

It does **not** define the calculation engine (Stage 4), the reconciliation or statistical
engines (Stage 5), the user interface (Stage 6), or any test. Interfaces, tables, and state
definitions in this file are specifications; they are not runnable code.

### 0.1 Standing requirement (§0)

**The application must still produce reliable actuarial calculations and documented acceptance
decisions when exact historical reconstruction is impossible.** That requirement governs this
whole file. It is recorded here as Invariant 9 (§6.9), in addition to the eight invariants
from Stage 1 output 04.

### 0.2 What is settled, and what is not

Settled in Stage 1 (do not re-derive here):

- PA_AMB = "Plan Administrator Accrued Monthly Benefit at DOTE", BCV9, Input, NUMBER.
  The dictionary does **not** state annuity form, vesting treatment, NRD/age basis, rounding,
  or what a blank means — none may be assumed.
- Comparison pair: PA_AMB (Input, BCV9) vs BCV1.AMB (Calculated), both "at DOTE"
  (termination of employment, ≠ DOPT). BCV3.PA_AMB_ACCEPT (Y/N) is the only
  accept-decision flag; it carries no criterion.
- No PBGC tolerance for PA_AMB reconciliation exists. Policy 5.8-1 Benefit Corrections
  ($1/$5) governs correction of issued benefit determinations, a different decision.
  The app ships with no built-in acceptance tolerance; tolerance is a human-set per-case
  parameter, recorded with rationale, author, and date.
- Blanks in PA_AMB are missing data, never zero unless a governing rule says so.
  An unresolved measurement date means `comparison_basis = UNRESOLVED` and no Δ is computed.
- Architecture: Option C (Hybrid), staged — TypeScript deterministic core first, Rust/WASM
  kernels only where proved, single HTML file, 0 fetch.

**The five dispositions are proposed application states, not official PBGC classifications.**
That is stated in MASTER_PROMPT §14 and repeated here because the whole state machine
rests on it: no disposition name, transition, or downstream rule in this file is a PBGC
classification. Whether a PBGC-official mapping is needed before use on a real case is
Open Decision OD-1 (§9).

### 0.3 Conventions

- Money is `decimal(18,2)` monthly dollars in the specification; the engine stores it as
  integer minor units (cents) — see Stage 1 output 04, §6.1. No binary floating-point
  money ever affects a comparison or a disposition.
- `B_i^PA` = recorded PA_AMB; `B̂_i` = independently reconstructed benefit on the same basis;
  `Δ_i = B_i^PA − B̂_i`; `D_i = |Δ_i|`; `R_i = Δ_i / B̂_i` only when the denominator is
  meaningful (Stage 1 output 03, §2.3).
- `B_i^min ≤ B_i^possible ≤ B_i^max` = mathematically justified bounds under explicit,
  stated assumptions — not confidence intervals (Stage 1 output 03, §4.3).
- Field names in capitals (`PA_AMB`, `PA_AMB_ACCEPT`, `AMB`, `DOTE`, `CSPA`, `VSPA`,
  `PA_ACOMP`) are BCV dictionary fields, copied exactly. Names in `snake_case` marked `APP`
  are application fields, never presented as BCV fields (Stage 1 output 02, §0.7).
- Completeness grades are per Stage 1 output 02, §A.5: **Complete / Partial / Insufficient**,
  per participant. Missing inputs are classified M1–M5 per Stage 1 output 03, §4.1
  (M1 required for exact reconstruction; M2 recoverable; M3 boundable; M4 requires
  assumptions; M5 makes reconstruction indeterminate).
- "Reasonably certain" is the standard from PBGC Operating Policy 5.8-1 Benefit Corrections,
  §D: PBGC corrects an error only when it is reasonably certain the error occurred and can
  accurately quantify it; where that certainty cannot be attained, PBGC does not change the
  benefit. This file applies the same standard to Correction recommended (and, by extension,
  to Verified): a disposition that asserts a specific amount requires reasonable certainty
  about both the fact and the amount.

---

## 1. The five dispositions

### 1.1 The state set

```typescript
/** Proposed application states — NOT official PBGC classifications (MASTER_PROMPT §14). */
type Disposition =
  | "verified"                 // Verified
  | "supported-for-acceptance" // Supported for acceptance
  | "requires-investigation"   // Requires investigation
  | "correction-recommended"   // Correction recommended
  | "indeterminate";           // Indeterminate

/** A disposition is never a bare label. It is always a versioned record (§3, §7). */
type DispositionStatus =
  | "recommended"  // proposed by the system and/or drafted by the actuary; not final
  | "approved"     // final determination: passed the human approval gate (§4)
  | "superseded";  // replaced by a later determination; retained in history, never deleted

type DispositionState = "unassessed" | Disposition; // "unassessed" = no disposition yet
```

A participant has **exactly one current disposition record** at any time: either
`unassessed` (no record yet), or one of the five dispositions in status `recommended` or
`approved`. A superseded record is history, not a current state. A participant in a
finished run has exactly one approved disposition, or one recommended disposition that is
explicitly recorded as unapproved (see §1.5 and §5). **No participant ends without a
disposition.** "Undispositioned" is not a state the case can close in.

### 1.2 Entry conditions, meaning, and downstream permission — per disposition

Entry conditions are **guards**: the transition function `T` (§5) refuses a disposition
whose entry conditions do not hold, and logs the refusal (see §6). The guards below
implement the reachability matrix of Stage 1 output 02, §A.7, and the evidence-state
mapping of Stage 1 output 03, §4.7. Where the two Stage 1 sources agree, this file
states the combined rule once; where they differ in emphasis, the stricter condition
governs and the difference is noted.

#### 1.2.1 Verified

| Item | Rule |
|---|---|
| **Meaning** | The independent calculation agrees with the recorded amount within the applicable documented tolerance, on an established basis, with no material unexplained item. The administrator's amount is accepted as the accrued benefit. |
| **Entry conditions (all must hold)** | 1. Completeness grade **Complete** (Stage 1 output 02, §A.5). 2. Comparison basis **established**: measurement date, retirement basis, annuity form, vesting treatment, and plan-provision version are all established and equivalent between `B_i^PA` and `B̂_i` (`comparison_basis ≠ UNRESOLVED`). 3. `B̂_i` exists (exact reconstruction). 4. `D_i` is within the case tolerance set under the case's stated combination rule (`τ_abs` / `τ_rel` / `τ_rule`), with the tolerance record cited (tolerance id, author, date, rationale). 5. No material unexplained item: every hypothesis H1–H17 tested against the discrepancy is either Supported with a documented explanation, or Refuted; no hypothesis remains `proposed`/`indeterminate` that could change the amount by more than the tolerance. A rounding explanation (H15) counts only if it meets the anti-coincidence rule (Stage 1 output 03, §2.7): the rounding sequence is documented in the plan, the administrator's workpapers, or a valuation report, or the same sequence resolves discrepancies across the cohort. 6. No validation rule that blocks calculation is outstanding for this participant. |
| **What it permits downstream** | The benefit **may be used in the valuation**: `B_i^PA` is the benefit carried forward. The approved determination may set `PA_AMB_ACCEPT = "Y"` (see §1.4). The participant needs no further investigation for this decision. |
| **What it does not permit** | It does not certify the legal correctness of the plan provisions themselves, and it does not authorise use of the amount on any other basis (different date, form, or vesting treatment) without a new comparison. Numerical agreement is not proof of correctness if the underlying provisions are wrong (MASTER_PROMPT §14). |

#### 1.2.2 Supported for acceptance

| Item | Rule |
|---|---|
| **Meaning** | The available evidence supports accepting the administrator's benefit **despite incomplete reconstruction**. This is a positive, evidence-based decision, not a default and not a weaker Verified. |
| **Entry conditions (all must hold)** | 1. Completeness grade **Partial** (classes M2/M3/M4 only; no class-M5 gap) — or Complete where a Verified entry condition other than exact agreement fails on a documented, immaterial ground recorded by the reviewer (the reviewer must name the ground; the system never widens this on its own). 2. Comparison basis **established**. If the basis is unresolved, Supported for acceptance is unreachable (Stage 1 output 02, §A.7). 3. `B_i^PA` lies **inside justified bounds** `[B_i^min, B_i^max]` computed under explicit, stated assumptions (Stage 1 output 03, §4.3, rules B-1–B-5), and the bound width is **narrow relative to materiality**: `B_i^max − B_i^min` is small relative to the case materiality threshold `τ_material`, or the reviewer records why the width is immaterial to the decision. 4. No competing hypothesis explains the evidence better: every material discrepancy has a documented explanation, or the residual uncertainty is bounded and documented. A hypothesis with support class `coincidence` (numerical match, no document support) never supports this disposition. 5. Missing evidence is listed, with its class (M1–M5) and its quantified contribution to uncertainty (Stage 1 output 03, §4.5); the sensitivity analysis shows the missing inputs cannot move the decision (disposition sensitivity, §4.4 of output 03). 6. No validation rule that blocks the bound computation is outstanding. |
| **What it permits downstream** | The benefit **may be used in the valuation**: `B_i^PA` is the benefit carried forward, **labelled as accepted on bounded evidence**, with the bound width and the missing evidence carried alongside it in the determination record so a later reviewer can see what was not exactly reconstructed. The approved determination may set `PA_AMB_ACCEPT = "Y"` (see §1.4). |
| **What it does not permit** | It does not permit the bounds to be reported as an exact reconstructed benefit, and it does not permit the missing evidence to be dropped from the record. The participant's valuation use is conditional on the recorded bounds and assumptions travelling with it. |

#### 1.2.3 Requires investigation

| Item | Rule |
|---|---|
| **Meaning** | Material discrepancies or missing evidence remain unresolved, **and a concrete next step exists** (a document to request, a hypothesis to test, a source to re-check). Investigation is the state of "not yet decidable, but decidable in principle". |
| **Entry conditions (any one suffices, and at least one concrete next step must be named)** | 1. `D_i` outside the case tolerance with no supported explanation; **or** 2. a key input is missing whose effect on the decision is material (grade Partial or Insufficient, classes M1/M2/M3/M4); **or** 3. `B_i^PA` lies outside justified bounds but the assumptions behind the bounds are themselves in doubt (re-examine assumptions before any correction is recommended — Stage 1 output 03, §4.7); **or** 4. two or more hypotheses both resolve the discrepancy but imply different corrected benefits (Stage 1 output 03, §2.6, multiple-hypothesis rule) — the disposition cannot be Correction recommended while they are tied; **or** 5. a statistical screen or validation finding flags the participant and the flag is not yet investigated (outlier flag, duplicate record, status/benefit inconsistency). |
| **What it permits downstream** | **Blocks use in the valuation.** `B_i^PA` must not be carried forward as the benefit, and no corrected value may be used either, until the investigation resolves into another disposition. The participant is on the investigation work-list, with its named next steps and their owners. `PA_AMB_ACCEPT` must not be set to `"Y"` while Requires investigation is current. |
| **What it requires** | A named next step for each open item: the hypothesis to test, the document to request, or the source to re-check, with a data request where a document is missing (§8, DataRequest). A Requires investigation record with no next step is incomplete and must be corrected to Indeterminate or completed — the system refuses a transition to Requires investigation that names no next step (guard G-INV-3, §6). |

#### 1.2.4 Correction recommended

| Item | Rule |
|---|---|
| **Meaning** | Sufficient evidence supports a **specific corrected accrued benefit**, different from `B_i^PA`. The error and the corrected amount are both established to the "reasonably certain" standard (Policy 5.8-1 §D). |
| **Entry conditions (all must hold)** | 1. A supported hypothesis (support class `supported`, Stage 1 output 03, §2.6) identifies the error: the mechanism is stated in, or follows directly from, a governing plan document, amendment, valuation report, or administrator workpaper, cited precisely; the counterfactual recomputation resolves the discrepancy within tolerance for the affected cohort, not just this participant. 2. The **corrected value is specific and single**: one corrected monthly benefit, on a stated basis, with its calculation trace. If two supported hypotheses imply different corrected values, Correction recommended is unreachable — the state is Requires investigation. 3. The corrected value is established with **reasonable certainty** about both the error and the amount. "Reasonably certain" is judged by the human reviewer against the evidence; the system records the reviewer's statement of certainty, it does not compute it. 4. Completeness grade Complete, or Partial where the bounds collapse to a single defensible value under stated assumptions (Stage 1 output 02, §A.7, note on Correction recommended). On an Insufficient record Correction recommended is unreachable. 5. Comparison basis established. 6. The correction's downstream consequence is recorded: whether the correction is an increase or a decrease, and its size, so the reviewer can see it against the Policy 5.8-1 $1/$5 correction tolerances **as a separate, later decision** — the 5.8-1 tolerances do not decide whether the correction is recommended here; they govern whether a PBGC benefit determination/payment is later corrected. The two decisions must not be conflated in the record. |
| **What it permits downstream** | The benefit **may be used in the valuation as the corrected value** — not as `B_i^PA`. The determination record carries `correctedBenefit` as the benefit to use, with its basis and trace. The approved determination sets `PA_AMB_ACCEPT = "N"` for the recorded amount as recorded (see §1.4), because the recorded amount is not accepted; the corrected amount is what is used. |
| **What it does not permit** | It does not permit `B_i^PA` itself to be used, and it does not permit a corrected value to be used before human approval (§4). A recommended correction is a proposal until approved. |

#### 1.2.5 Indeterminate

| Item | Rule |
|---|---|
| **Meaning** | The evidence is insufficient to establish a defensible conclusion. This is a **legitimate, complete, terminal outcome** (§5), not a failure, not an error state, and not a gap in the workflow. |
| **Entry conditions (any one suffices)** | 1. No `B̂_i` and **no justifiable bounds**: a class-M5 gap (e.g. the governing formula for the participant's era cannot be identified; no compensation history at all and no bound can be justified), **or** 2. the comparison basis is **unresolved and cannot be resolved** from available documents (measurement date cannot be established; `comparison_basis = UNRESOLVED` with no candidate basis that can be evidenced), **or** 3. `B_i^PA` is blank (missing) and no independent reconstruction exists that could stand in its place — the blank is missing data, never zero; **or** 4. the evidence that exists is mutually contradictory in a way no available document resolves, and no further step is currently identified (distinguished from Requires investigation, which requires a concrete next step — see §1.2.3). |
| **What it permits downstream** | **Blocks use in the valuation.** Neither `B_i^PA` nor any reconstructed or corrected value may be carried forward as the benefit for this participant. The participant is reported as Indeterminate, with its bounds (where any exist), missing evidence, and data requests (§5.3). `PA_AMB_ACCEPT` must not be set to `"Y"` while Indeterminate is current. |
| **What it carries** | See §5.3: the bounds (or the explicit statement that no justified bounds exist, with the reason), the missing evidence with classes, and the prioritised data requests. An Indeterminate record that does not name what evidence would resolve it is incomplete — the system refuses it (guard G-IND-1, §6). |

### 1.3 Summary: entry conditions and downstream permission

| Disposition | Grade needed | Basis | `B̂_i` / bounds | `B_i^PA` usable in valuation? | Value used |
|---|---|---|---|---|---|
| Verified | Complete | Established | Exact `B̂_i`; `D_i` within tolerance | Yes | `B_i^PA` |
| Supported for acceptance | Partial (M2/M3/M4) | Established | `B_i^PA` inside justified bounds; width immaterial | Yes, labelled as bounded-evidence acceptance | `B_i^PA` (with bounds + missing evidence attached) |
| Requires investigation | Any | Established or unresolved | Exact, bounded, or absent | **No — blocked** | None |
| Correction recommended | Complete, or Partial with bounds collapsing to one value | Established | Specific corrected value, reasonably certain | Yes, as the **corrected** value only | `correctedBenefit` (not `B_i^PA`) |
| Indeterminate | Insufficient, or any grade with unresolved basis | Unresolved, or established but no bound justifiable | No `B̂_i` and no justifiable bounds (or per-scenario bounds only — §5.3) | **No — blocked** | None |

### 1.4 Downstream mapping to `PA_AMB_ACCEPT` (proposed, not a PBGC rule)

`PA_AMB_ACCEPT` (BCV3, Y/N) is the only dictionary field that records the accept decision.
No PBGC source states how the five dispositions map to Y/N, so the mapping below is a
**proposed application mapping**, to be confirmed before use on a real case (Open Decision
OD-2, §9). It is stated here so the design is explicit rather than silently assumed:

| Approved disposition | Proposed `PA_AMB_ACCEPT` | Note |
|---|---|---|
| Verified | `"Y"` | The recorded amount is accepted. |
| Supported for acceptance | `"Y"` | The recorded amount is accepted on bounded evidence; the determination record (not the flag) carries the bounds and missing evidence. |
| Requires investigation | `"N"` (or left unset until the investigation resolves — see OD-2) | The recorded amount is not accepted while the investigation is open. |
| Correction recommended | `"N"` | The recorded amount as recorded is not accepted; the corrected value is used instead. The flag records acceptance of `B_i^PA`, not acceptance of the corrected value. |
| Indeterminate | `"N"` (or left unset until resolved — see OD-2) | The recorded amount is not accepted; no value is used. |

Rules: `PA_AMB_ACCEPT` is set **only** by an approved determination (Stage 1 output 02,
rule C-09); it is never set by a recommendation, never set by the system on its own, and
never set before the determination exists. Changing the disposition by re-opening (§3.3)
requires the flag to be re-decided as part of the new determination; the old flag value is
retained in the superseded record, not silently overwritten.

### 1.5 Unassessed, and the case-closure rule

`unassessed` is the initial state for every participant: no calculation has been run, or no
disposition has been proposed. It is not a disposition and it is not a terminal outcome.

**Case-closure rule.** A case cannot close while any in-scope participant (RETSTAT 1–4;
RETSTAT 5 records are out of scope and graded `excluded`, Stage 1 output 02, §A.5) is
`unassessed`. The case **can** close with participants in Requires investigation or
Indeterminate — those are documented decisions. It cannot close with participants that
have no disposition at all. A finished run therefore has, for every in-scope participant,
exactly one current disposition; the run report lists the count in each disposition and
the count approved vs recommended, so an unapproved recommended disposition is visible
as unfinished business, not hidden.

---

## 2. The disposition record (versioned state)

```typescript
type DispositionId = string;        // app-generated, stable
type ParticipantKey = string;       // APP.participantKey (Stage 1 output 02, §A.2.5)
type EvidenceRef = string;          // reference to a SourceDocument + location, or to a
                                    // BenefitCalculation / BenefitComparison / DiagnosticHypothesis record
type RuleVersion = string;          // e.g. "validation-rules v1.0.0", "formula-taxonomy v1.0.0"
type ToleranceSetId = string;       // case tolerance record id (Stage 1 output 03, §2.4)

interface DispositionRecord {
  dispositionId: DispositionId;
  schemaVersion: string;            // disposition state-machine version, e.g. "1.0.0" (§2.1)
  participantKey: ParticipantKey;
  caseId: string;                   // CASE (BCV, VARCHAR2(8), leading zeros kept)

  disposition: Disposition;
  status: DispositionStatus;        // "recommended" | "approved" | "superseded"

  /** Evidence state at the time of this record (Stage 1 output 03, §0.4 / §4.7). */
  evidenceState: {
    completenessGrade: "complete" | "partial" | "insufficient" | "excluded";
    comparisonBasis: "established" | "unresolved";
    reconstructedBenefitCents: number | null;   // B̂_i in integer cents; null if none
    boundsCents: { min: number; max: number } | null; // justified bounds; null if none justifiable
    deltaCents: number | null;      // Δ_i; null when comparison_basis is UNRESOLVED or B̂_i is null
    withinTolerance: boolean | null;
    toleranceSetId: ToleranceSetId;
  };

  /** What downstream may use, per §1.2. Null when use is blocked. */
  downstreamUse: {
    usableInValuation: boolean;
    valueCents: number | null;      // B_i^PA, or correctedBenefit, or null when blocked
    valueKind: "recorded" | "corrected" | "none";
    paAmbAccept: "Y" | "N" | null;  // BCV3.PA_AMB_ACCEPT; null until an approved determination sets it
  };

  /** Pointer to the full determination record (§7). Null while only recommended on
      system-generated evidence with no reviewer-drafted determination yet. */
  determinationId: string | null;

  /** Versioning / provenance (MASTER_PROMPT §17; Stage 1 output 04, §7.2). */
  version: number;                  // 1, 2, 3, … — increments on every transition
  supersedesId: DispositionId | null;
  createdBy: "system" | "actuary";  // who proposed it; approval is always a human (§4)
  createdAt: string;                // ISO date-time of the transition (audit clock, not calculation input)
  inputSnapshotHash: string;        // SHA-256 of the input snapshot this record rests on
  ruleVersion: RuleVersion;
  calculationRunId: string | null;  // CalculationRun this record rests on, if any
  auditEventId: string;             // the audit-log event that recorded this transition
}
```

### 2.1 Versioning

- The state machine itself is versioned: `DISPOSITION_SCHEMA_VERSION = "1.0.0"` for this
  specification. A later revision that adds a disposition, changes an entry condition, or
  changes a transition requires a new schema version, a change note, and re-validation of
  existing records against the new version (they are not silently re-interpreted).
- Each participant's disposition history is a **chain**: every record carries `version` and
  `supersedesId`. A transition creates a new record; it never edits the previous record
  in place. The previous record's status becomes `superseded`; its evidence, rationale,
  and approval remain readable forever (Invariant 1, §6.1).
- The current disposition for a participant is the newest record in the chain whose status
  is `recommended` or `approved`. There is at most one such record per participant.

---

## 3. Allowed transitions

### 3.1 Transition table

`Actor` is who may initiate the transition. `System` means the application acting on its
own computation; it may only ever produce a `recommended` record, never an `approved` one
(§4). `Actuary` means the authorized human reviewer (case actuary); the exact definition
of "authorized" is Open Decision OD-3 (§9). `Evidence` in the table is what the transition
requires — the guard checks it, and the transition is refused if it is absent (§6).

| # | From | Event | To | Actor | Evidence required for the transition |
|---|---|---|---|---|---|
| T1 | `unassessed` | `RunCalculation` + `ProposeDisposition` | `recommended` (any of the five) | System (proposal) or Actuary (draft) | Calculation run (or bounds computation) on the current input snapshot; evidence state (§2) complete enough to test the target disposition's entry conditions (§1.2). |
| T2 | `recommended` (any) | `ProposeDisposition` (re-propose) | `recommended` (same or different disposition) | System or Actuary | New or revised evidence that changes the evidence state; the re-proposal records what changed and why. A re-proposal with no change in evidence is refused as a no-op (it would create history without content). |
| T3 | `recommended` (any) | `ApproveDisposition` | `approved` (same disposition) | **Actuary only** | A complete determination record (§7) with all ten §14 items; the approval record (§4.2); the disposition's entry conditions still hold on the current input snapshot and rule version (re-checked at approval time, not assumed from proposal time). |
| T4 | `recommended` (any) | `RejectRecommendation` | `recommended` (different disposition) or `unassessed` | Actuary only | Reviewer rationale for rejecting the recommendation; the replacement disposition's entry conditions, if a replacement is proposed at the same time. Rejecting without a replacement returns the participant to `unassessed` only if no evidence state exists yet; otherwise the reviewer must propose a replacement — a participant with an evidence state must not be left without a proposed disposition. |
| T5 | `approved` (any) | `ReopenDisposition` | `recommended` (same disposition, new version) | **Actuary only** | A stated reason: new evidence, a source correction, a rule/tolerance revision, or a discovered error in the earlier determination. The approved record becomes `superseded`; it is retained, and the re-opening is itself an audited event. Re-opening does not delete the approval. |
| T6 | `approved` (any) | `ReopenDisposition` + `ProposeDisposition` | `recommended` (different disposition) | **Actuary only** | As T5, plus the new disposition's entry conditions on the current evidence. |
| T7 | `recommended` / `approved` (any) | `SourceUpdate` (correction, re-import, new document) | `recommended` (re-proposed; see §3.2) | System (re-computation) then Actuary (re-approval) | The source update's provenance; the affected participant set, computed explicitly and logged (Invariant 6); a fresh calculation/bounds run on the new snapshot. The previous disposition is **not** silently carried forward: it is re-proposed and must be re-approved. |
| T8 | `recommended` / `approved` (any) | `RuleRevision` (tolerance, formula, validation rule, or disposition-schema revision) | `recommended` (re-proposed) | System (re-computation) then Actuary (re-approval) | The rule revision's version and change note; the affected participant set, computed explicitly and logged; a fresh comparison against the new tolerance/rule. As T7, the previous disposition is not silently carried forward. |
| T9 | `requires-investigation` (`recommended` or `approved`) | `InvestigationStepCompleted` (hypothesis tested, document received, data request answered) | `recommended` (any of the five, per the new evidence) | System (re-computation) or Actuary | The investigation outcome: hypothesis status change (supported/refuted), the received document with its citation, or the data-request response. The transition records which next step was completed and what it showed. |
| T10 | `indeterminate` (`recommended` or `approved`) | `NewEvidenceReceived` | `recommended` (any of the five, per the new evidence) | System or Actuary | The new evidence itself, with provenance. Indeterminate is terminal for the analysis as it stands (§5.1), not terminal against new evidence: it is re-opened only by new evidence, never by re-arguing the old evidence. |
| T11 | `verified` / `supported-for-acceptance` / `correction-recommended` (`approved`) | `ValuationUseRecorded` | (no disposition change) | Actuary | A record that the benefit was used in the valuation, referencing the approved determination. This is an audit event on the disposition, not a transition; it does not change the disposition. It exists so use is traceable to the determination that authorised it. |
| T12 | any | `RefusedTransition` | (no change; audit event only) | System | A transition attempt that failed a guard (§6). The analytic state is unchanged; only the audit log gains a refusal event. This is a defined outcome of `T`, not an error path. |

### 3.2 What a source update or rule revision does to an approved disposition

This is the point most likely to be implemented wrong, so it is stated as a rule, not
left to implication:

1. A source update or rule revision that affects a participant **invalidates the
   resting basis** of that participant's approved disposition. The disposition does not
   silently stay approved on evidence that is no longer current.
2. The system re-computes the affected participants, re-proposes a disposition
   (which may be the same disposition or a different one), and marks it `recommended`.
   The previous approved record becomes `superseded` **only when the new recommendation
   is created** — until then it remains the current approved record, so there is never
   a moment when the participant has no disposition.
3. The re-proposed disposition must be re-approved by a human reviewer (T3) before it
   is final again. There is no auto-re-approval, even if the re-proposed disposition is
   identical to the superseded one and the change was trivial. The reviewer confirms
   that the change does not alter the decision; that confirmation is itself the approval.
4. A source update or rule revision that does **not** affect a participant (not in the
   computed affected set) leaves that participant's disposition untouched, and the run
   log records that the participant was assessed and found unaffected (Invariant 6).

### 3.3 Who may make each transition

| Actor | May do | May never do |
|---|---|---|
| **System** (the application) | Propose a disposition (`recommended`) from a calculation/bounds run; re-propose after a source update, rule revision, or investigation step; refuse a transition that fails a guard and log the refusal; record that a benefit was used in the valuation (T11, as an audit event). | Approve, reject, or re-open a disposition; set `PA_AMB_ACCEPT`; use a benefit in the valuation on its own authority; change an approved disposition without re-proposal and re-approval. |
| **Authorized human reviewer** (case actuary; exact authorization — Open Decision OD-3) | Draft or amend a recommendation; approve a recommendation (T3); reject a recommendation (T4); re-open an approved disposition (T5/T6); record the valuation use (T11); write the rationale and the determination record. | Approve a disposition whose entry conditions do not hold on the current snapshot; approve without a complete determination record (§7); approve another reviewer's determination without recording themselves as the reviewer (the approval record names the approver). |
| **No one** | — | Delete a disposition record or an audit event; edit a superseded record in place; finalise a disposition by editing a file outside the state machine; set `PA_AMB_ACCEPT` except through an approved determination. |

Where the AMB Acceptance Template is the work product, the roles it names — the actuary
(ASD/ACPC) as author, the Acting Associate Division Manager (PADMD) as addressee, the
auditor (PADMD) and EBLS/PSD as copied — are the only role names found in a PBGC source
for this decision (Stage 1 output 00, source #10). This file does not invent further
roles, and it does not assign the approval to any of those roles: which of them (or
which other authorised person) is the approver is Open Decision OD-3.

---

## 4. The human approval gate

### 4.1 The rule

**No disposition becomes final without an authorized human reviewer. The application may
recommend but never finalize a disposition on its own.**

Formally: a disposition record with `status = "approved"` can only be created by the
`ApproveDisposition` event (T3), which only a human reviewer can initiate. There is no
event, code path, or configuration by which the system creates an `approved` record.
A system-proposed disposition is a `recommended` record. A recommended record has no
downstream effect: it does not authorise valuation use, it does not set `PA_AMB_ACCEPT`,
and it is not the determination of record. The case report distinguishes approved from
recommended counts for exactly this reason (§1.5).

### 4.2 The approval record

Approval is itself a record, not a flag:

```typescript
interface ApprovalRecord {
  approvalId: string;
  dispositionId: DispositionId;      // the disposition record being approved
  determinationId: string;           // the determination record (§7) being approved

  reviewer: string;                  // name/identity of the authorized human reviewer
  reviewerRole: string;              // role as recorded (see OD-3; not invented here)
  approvalDate: string;              // ISO date of approval

  /** The reviewer's own rationale, in their own words. May be short; must be present.
      "Agreed" without a reason is not a rationale. */
  rationale: string;

  /** The evidence snapshot the decision rests on — frozen at approval time (§4.3). */
  evidenceSnapshot: EvidenceSnapshot;

  /** The reviewer confirms each of these; the approval is refused if any is false. */
  confirmations: {
    entryConditionsHold: boolean;    // §1.2 entry conditions re-checked on the current snapshot
    determinationComplete: boolean;  // all ten §14 items present (§7)
    toleranceIdentified: boolean;    // the tolerance set applied is identified, with its authority
    noMaterialUnexplainedItem: boolean; // or the unexplained item is named and judged immaterial, with reasons
  };

  supersedesApprovalId: string | null; // set when re-approving after a re-opening (T5/T6 → T3)
}
```

### 4.3 The evidence snapshot

The approval rests on a frozen snapshot, so that a later source update cannot silently
change what the approval meant:

```typescript
interface EvidenceSnapshot {
  snapshotId: string;
  inputSnapshotHash: string;         // SHA-256 of all input files + field mapping, at approval time
  calculationRunId: string | null;
  ruleVersion: RuleVersion;          // validation-rule catalog + formula-taxonomy versions
  toleranceSetId: ToleranceSetId;    // tolerance record: values, authority, author, date
  dispositionSchemaVersion: string;  // §2.1
  determinationId: string;           // §7 record, with its own content hash
  sourceDocumentIds: string[];       // every SourceDocument cited in the determination
  calculationTraceHash: string | null; // hash of the BenefitCalculation trace, if any
  boundsAssumptionsHash: string | null; // hash of the bound assumptions, if bounds were used
}
```

If any element of the snapshot changes (new input hash, new rule version, new tolerance
set), the approval no longer rests on current evidence: §3.2 applies, the disposition is
re-proposed as `recommended`, and re-approval is required. The old approval and its
snapshot remain in history, so an auditor can always reconstruct exactly what was
approved, on what evidence, and when.

### 4.4 Recommendation vs final determination

| Aspect | Recommendation (`recommended`) | Final determination (`approved`) |
|---|---|---|
| Who creates it | System (from a run) or actuary (draft) | Authorized human reviewer only, via `ApproveDisposition` |
| Downstream effect | None. Does not authorise valuation use; does not set `PA_AMB_ACCEPT`. | Authorises the downstream use in §1.2 (valuation use, or blocked use, as the disposition states); sets `PA_AMB_ACCEPT` per §1.4. |
| Evidence required | Enough to test the entry conditions (§1.2). | A complete determination record (§7, all ten §14 items) plus the approval record (§4.2) plus a frozen evidence snapshot (§4.3). |
| Can it change? | Freely, by re-proposal (T2), on new or revised evidence. | Only by re-opening (T5/T6) by a human reviewer, with a stated reason; the old determination is superseded, never edited. |
| What it is, in one line | "On the current evidence, this is the disposition the evidence points to." | "I, the named reviewer, on the named date, on the frozen evidence snapshot, determine that this is the disposition, for the recorded reasons." |

A recommendation that is never approved is not a failed determination; it is unfinished
work, and the case report must show it as such. A case must not be reported as decided
for a participant whose disposition is only recommended.

---

## 5. Indeterminate as a legitimate terminal outcome

### 5.1 Terminal — for the analysis as it stands

Indeterminate is terminal in this sense: once a participant is Indeterminate (recommended
or approved), **no further transition is available on the same evidence**. The analysis
for that participant is complete — it has produced its answer, which is that the evidence
cannot support a conclusion — and the case can close with that participant Indeterminate.
The only transitions out of Indeterminate are T10 (new evidence received) and T5/T6
(re-opening by a human reviewer with a stated reason). Re-arguing the same evidence,
re-running the same calculation, or changing a tolerance to force a decidable outcome
are not transitions out of Indeterminate; the guard refuses them, and the refusal is
logged. In particular:

- Indeterminate is never "upgraded" to Requires investigation by re-labelling it.
  The two differ by a testable fact: Requires investigation has a concrete next step
  (§1.2.3); Indeterminate has none currently identified, or the steps that exist have
  been exhausted (see §5.3, data-request status `exhausted`).
- Indeterminate is never resolved by inventing a value. If the evidence cannot support
  an exact benefit, the system produces bounds, scenarios, or no number — never a
  made-up exact number (Invariant 9).
- A case with Indeterminate participants is not a failed case. The plan-level report
  lists them with their missing evidence and data requests, so the Indeterminate outcome
  is itself the documented product for those participants.

### 5.2 Exactly when a case may end Indeterminate

A participant may end Indeterminate (approved) only when **all** of the following hold:

1. One of the §1.2.5 entry conditions holds (no `B̂_i` and no justifiable bounds; or
   unresolved comparison basis that cannot be resolved; or blank `B_i^PA` with no
   independent reconstruction; or mutually contradictory evidence with no available
   resolution).
2. The missing evidence has been **sought, not merely listed**: every data request in
   §5.3 has a status, and at least one of these is true — (a) the requests have been
   issued and answered without resolving the gap (status `answered-no-data` or
   `exhausted`), or (b) the reviewer records, with reasons, that no further request
   can currently be made (e.g. the source no longer exists, the document is known to
   have been destroyed — the reason must be stated, not assumed). An Indeterminate
   record whose data requests are all still `not-issued` is refused: that participant
   is Requires investigation, not Indeterminate (guard G-IND-2, §6).
3. The reviewer has considered and recorded why the participant is not Requires
   investigation: the concrete-next-step test (§5.1) has been applied and the answer
   recorded. This is one sentence in the determination record; it is what keeps the
   two states from being interchangeable labels.
4. The determination record (§7) is complete, including the bounds position (§5.3)
   and the prioritised data requests (§5.3).

### 5.3 What an Indeterminate record carries

An Indeterminate disposition is a documented decision, not a failure, only if it carries
all of the following. The guard G-IND-1 (§6) refuses an Indeterminate transition that
lacks any of them.

```typescript
interface IndeterminateContent {
  /** Bounds, or the explicit statement that none can be justified. */
  bounds: {
    justifiedBoundsCents: { min: number; max: number } | null;
    /** If null: why no justified bound exists (e.g. "governing formula for the
        participant's era cannot be identified; monotonicity cannot be verified;
        no bound is justifiable"). Never silently null. */
    noBoundsReason: string | null;
    /** Per-scenario bounds, where scenarios can be defined (e.g. one bound pair
        per candidate formula version or per candidate measurement date). Each
        scenario is labelled with its assumptions. Per-scenario bounds are NOT
        a single justified bound for the participant; the record must say so. */
    scenarioBounds: Array<{
      scenarioName: string;
      assumptions: string[];
      minCents: number;
      maxCents: number;
    }>;
  };

  /** Missing evidence: every missing input, its class, and its decision impact. */
  missingEvidence: Array<{
    input: string;               // e.g. "compensation year 2017", "plan document for era 1994–1998"
    missingClass: "M1" | "M2" | "M3" | "M4" | "M5"; // Stage 1 output 03, §4.1
    /** What resolving it could change (disposition sensitivity, output 03 §4.4). */
    decisionImpact: string;
    /** Contribution to uncertainty, where quantifiable (output 03, §4.5). */
    uncertaintyContributionCents: number | null;
  }>;

  /** Prioritised data requests (Stage 1 output 03, §4.6). */
  dataRequests: DataRequest[];

  /** Why this is Indeterminate and not Requires investigation (§5.2, item 3). */
  indeterminateRationale: string;
}
```

```typescript
type DataRequestStatus =
  | "not-issued"
  | "issued"
  | "answered-no-data"   // asked; the source has no data — recorded, not re-asked silently
  | "answered-with-data" // data received; triggers T10 (re-assessment on the new evidence)
  | "exhausted";         // no further source exists to ask; the reason is recorded

interface DataRequest {
  requestId: string;
  input: string;                    // the missing input being sought
  participantKeys: string[];        // participants affected (breadth — prioritisation factor 2)
  sourceToAsk: string;              // the document, file, or holder to ask (M2 recoverability)
  expectedDecisionEffect: string;   // disposition-changing potential (prioritisation factor 1)
  priority: number;                 // 1 = highest; ordered by expected effect on the decision (§4.6)
  status: DataRequestStatus;
  statusReason: string;             // why this status, and what was done
  requestedDate: string | null;
  answeredDate: string | null;
}
```

Prioritisation (Stage 1 output 03, §4.6), in order: (1) disposition-changing potential
first; (2) breadth (participants affected) second; (3) recoverability (class M2 first)
third; (4) retrieval effort last, where recorded. A request that returns no data is
recorded as such — the Indeterminate disposition then stands on a documented exhausted
search, which is itself a defensible outcome.

---

## 6. The §17 state-driven design

### 6.1 The case-analysis state `S_t`

```typescript
interface CaseAnalysisState {
  stateVersion: string;             // state schema version (distinct from disposition schema version)
  caseId: string;

  /** Immutable input snapshot: imported source values + provenance. Never mutated (§6.1,
      Invariant 1). Corrections create new versions that reference the original. */
  inputSnapshot: {
    snapshotHash: string;           // SHA-256 over all input files + field mapping
    sourceDocuments: SourceDocument[]; // §6 entity (MASTER_PROMPT §6)
    importedValues: unknown;        // normalised working data derived from the snapshot
  };

  /** Plan provisions P(t): effective-dated provisions, amendments, freezes,
      grandfathering (MASTER_PROMPT §5). */
  planProvisions: PlanVersion[];    // effective-dated; the version in force at t_i governs

  /** Rule and tolerance versions in force for this state. */
  ruleVersions: {
    validationRules: RuleVersion;
    formulaTaxonomy: RuleVersion;
    dispositionSchema: string;      // §2.1
    toleranceSetId: ToleranceSetId;
  };

  /** Per-participant analysis. One entry per in-scope participant. */
  participants: Record<ParticipantKey, ParticipantAnalysis>;

  /** The audit log: append-only. Every transition appends an event (§6.5). */
  auditLog: AuditEvent[];

  /** UI / workflow position: wizard step, filters, drill-down selection.
      Workflow position is state, not a side channel: two interfaces (wizard and
      advanced) read and write the same S_t (Stage 1 output 04, §8). */
  workflow: {
    currentStep: string;
    selectedParticipantKey: ParticipantKey | null;
  };
}

interface ParticipantAnalysis {
  participantKey: ParticipantKey;
  benefitObservation: BenefitObservation | null; // PA_AMB + basis; null if no observation
  benefitCalculation: BenefitCalculation | null; // B̂_i + trace; null if not reconstructible
  bounds: { minCents: number; maxCents: number } | null;
  benefitComparison: BenefitComparison | null;   // Δ_i, D_i, R_i; null if basis unresolved
  hypotheses: DiagnosticHypothesis[];           // ranked, with support class (§2.6, output 03)
  completenessGrade: "complete" | "partial" | "insufficient" | "excluded";
  disposition: DispositionRecord | null;        // null = unassessed
  dataRequests: DataRequest[];
}
```

Entity names (`BenefitObservation`, `BenefitCalculation`, `BenefitComparison`,
`DiagnosticHypothesis`, `SourceDocument`, `PlanVersion`) are the MASTER_PROMPT §6
entities, with the fields defined in Stage 1 output 02, §A.2. This file does not
redefine them; it states how they sit inside `S_t`.

### 6.2 The event types `E_t`

```typescript
type CaseEvent =
  | { kind: "user-action"; action: UserAction }
  | { kind: "source-update"; update: SourceUpdate }
  | { kind: "rule-revision"; revision: RuleRevision }
  | { kind: "calculation-event"; event: CalculationEvent };

type UserAction =
  | "import-case" | "map-fields" | "enter-provision" | "enter-exception"
  | "run-calculation" | "propose-disposition" | "approve-disposition"
  | "reject-recommendation" | "reopen-disposition" | "record-data-request"
  | "record-data-received" | "record-valuation-use";

type SourceUpdate =
  | "source-corrected"      // a correction to an imported value (new version; original retained)
  | "source-reimported"     // a file re-imported; new snapshot hash
  | "document-added";       // a new SourceDocument (plan document, schedule, valuation report)

type RuleRevision =
  | "tolerance-revised" | "formula-version-revised" | "validation-rule-revised"
  | "disposition-schema-revised";

type CalculationEvent =
  | "calculation-completed" | "bounds-computed" | "hypothesis-tested"
  | "statistical-screen-completed"; // advisory only; never writes a benefit or a disposition (§6.5)
```

Every event carries: `eventId`, `actor` (`"system"` or the reviewer's identity),
`occurredAt`, and the payload the transition needs. An event without an actor and a
timestamp is not a valid `E_t` and is refused.

### 6.3 The transformation `T`

```
S_{t+1} = T(S_t, E_t)
```

`T` is a defined, total transition function in this sense: for every event type in §6.2,
this specification states exactly what changes, what is recomputed, and what is recorded
(§3.1 is the disposition part of that definition; the calculation, validation, and
reporting parts belong to the Stage 4/5/6 specifications that consume this file).
`T` is pure where it touches calculations and explicit where it touches side effects
(Stage 1 output 04, §7.3): file import/export, persistence, UI rendering, and WASM
instantiation live outside `T`, as thin adapters that call pure functions and record
the event. `T` itself reads no DOM, no storage, no clock, and no network — the timestamp
on an event is supplied by the caller, not read by `T`.

**Refusal is part of `T`, not an exception to it.** If a guard fails (§6.6), `T` returns
a state in which the analytic content is unchanged and only the audit log gains a
refusal event (T12). A refused transition never partially applies: there is no state in
which a disposition changed but its evidence did not, or a benefit changed but its
provenance did not.

**Recomputation scope.** `T` recomputes exactly the affected set, computed explicitly
from the event and logged (Invariant 6): a single-participant correction recomputes
that participant; a plan-level provision or tolerance change recomputes the participants
the change's applicability predicate selects, and the run log names them. A run reports
exactly which participants changed and why; an unchanged participant's results are
untouched.

### 6.4 The transitions that matter (summary of `T` for the decision workflow)

| Event `E_t` | What `T` does | What is recomputed | What is recorded |
|---|---|---|---|
| `import-case` / `map-fields` | Creates the input snapshot; validates structurally (Stage 1 output 02, Part B). | Nothing yet (no calculation). | Import record: file hashes, mapping, quarantined rows. |
| `enter-provision` / `enter-exception` | Adds a PlanVersion or an exception, with source citation and effective dates. | Participants whose measurement date falls under the new provision version. | Provision record; affected set. |
| `run-calculation` | Runs the deterministic engine for the affected set: `B̂_i`, bounds, comparison, hypotheses. | Affected participants only (Invariant 6). | CalculationRun: rule version, input snapshot hash, results hash. |
| `propose-disposition` | Applies §1.2 entry conditions to the evidence state; creates a `recommended` DispositionRecord (T1/T2). | None (proposal reads the evidence state; it does not recompute it). | DispositionRecord (versioned); the entry-condition check result. |
| `approve-disposition` | Re-checks entry conditions on the current snapshot; creates the ApprovalRecord (§4.2) and the approved DispositionRecord (T3). | None, except the entry-condition re-check. | ApprovalRecord + frozen EvidenceSnapshot (§4.3). |
| `reopen-disposition` | Supersedes the approved record; creates a new `recommended` record (T5/T6). | None until a new calculation is run. | Re-opening reason; superseded record retained. |
| `source-corrected` / `source-reimported` / `document-added` | New input snapshot; §3.2 applies (re-propose, re-approve). | Affected participants (computed explicitly). | New snapshot hash; affected set; re-proposal. |
| `tolerance-revised` / `formula-version-revised` / `validation-rule-revised` | New rule version; §3.2 applies. | Affected participants. | Revision change note; affected set; re-proposal. |
| `calculation-completed` / `bounds-computed` / `hypothesis-tested` | Stores the calculation/bounds/hypothesis result in `S_t`. | The participant(s) named in the event. | CalculationRun / hypothesis record with support class. |
| `statistical-screen-completed` | Stores advisory output (outlier flags, model diagnostics) as work-list entries. | None (statistics never recompute a benefit). | Screen result, labelled as statistical/advisory. |
| `record-data-request` / `record-data-received` | Updates the DataRequest status; a receipt triggers re-assessment (T9/T10). | The requesting participant(s), on receipt. | DataRequest status change with reason. |
| `record-valuation-use` | Audit event only (T11). | None. | Use record referencing the approved determination. |

### 6.5 Audit log

```typescript
type AuditEventKind =
  | "import" | "calculation-run" | "disposition-proposed" | "disposition-approved"
  | "disposition-rejected" | "disposition-reopened" | "source-update" | "rule-revision"
  | "data-request" | "data-received" | "valuation-use-recorded"
  | "transition-refused";   // a guard refusal (T12); the reason is in the event

interface AuditEvent {
  auditEventId: string;
  occurredAt: string;               // supplied by the caller, not read by T (§6.3)
  actor: "system" | string;         // system, or the reviewer's identity
  kind: AuditEventKind;
  participantKeys: string[];        // affected participants (empty for case-level events)
  summary: string;                  // one-line, human-readable
  detail: {
    fromDisposition?: DispositionState;
    toDisposition?: DispositionState;
    ruleVersion?: RuleVersion;
    inputSnapshotHash?: string;
    refusalReason?: string;         // for "transition-refused": which guard, and why
  };
}
```

The audit log is append-only. No event is deleted or edited. A correction to the record
is a new event that references the old one.

### 6.6 The invariants — and what happens when a transition would violate one

The eight invariants are from Stage 1 output 04, §7.2 (which states each is a property
the test suite checks, not a comment). Invariant 9 is the §0 standing requirement,
added here as an invariant in its own right, as the task for this file requires.

**General violation rule (applies to all nine).** Before `T` applies a transition, it
checks the guards that enforce the invariants. If a transition would violate an
invariant, **the transition is refused and logged, never silently applied**: `T`
returns the prior analytic state unchanged plus a `transition-refused` audit event
naming the invariant, the guard, and the reason (T12). The refusal is visible in the
audit log and in the workflow (the user is told what was refused and why); it is never
a silent no-op. There is no override, no "approve anyway" path, and no configuration
that disables a guard.

#### Invariant 1 — Original source observations remain unchanged

- **Statement.** Imported values are stored immutably, separately from normalised/corrected
  values. A correction creates a new version that references the original; it never
  overwrites it. Provenance (file, row/cell, page/section) is retained.
- **Preserved by.** The input snapshot in `S_t` (§6.1) is immutable: `T` never writes to
  it. `source-corrected` appends a correction record linked to the original value; the
  original stays readable. Every derived value carries the snapshot hash it was computed
  from, so a value can never be mistaken for a value computed from different inputs.
- **If violated.** A transition that would write to the input snapshot, or that presents
  a corrected value without its original, is refused (guard G-INV-1) and logged.

#### Invariant 2 — A calculation is reproducible from its inputs and rules

- **Statement.** Every `BenefitCalculation` / `CalculationRun` records the input snapshot
  hash, the rule/formula version, the tolerance version, and the engine version.
  Re-running with the same snapshot and versions yields byte-identical results
  (deterministic: no `Date.now()`, no randomness, no iteration over unordered structures
  inside the core).
- **Preserved by.** The evidence snapshot (§4.3) freezes exactly those versions at
  approval time. `T` refuses to approve a disposition whose calculation run cannot be
  reproduced from its recorded snapshot and versions (the re-check at approval time, §4.2).
  A rule revision creates a new version and triggers re-computation (§3.2); it never
  re-labels old results as if computed under the new rule.
- **If violated.** A transition that would approve, or carry forward, a result whose
  snapshot hash or rule version is missing or does not match the current state is
  refused (guard G-INV-2) and logged.

#### Invariant 3 — Benefit quantities retain their units and measurement bases

- **Statement.** Every benefit is a typed quantity: amount + periodicity + measurement
  date + commencement basis + retirement age/date + annuity form + vesting treatment +
  plan-version + source/status. A comparison is only valid after bases are established
  equivalent; a recorded amount without an established measurement date is flagged
  "unresolved comparison basis" and cannot be Verified.
- **Preserved by.** The entry conditions (§1.2) require an established basis for Verified,
  Supported for acceptance, and Correction recommended. `BenefitComparison` stores
  `comparisonBasis`; when it is `UNRESOLVED`, `deltaCents` is null — no Δ exists to
  compare. `T` refuses any transition that would compute or store a Δ across
  non-equivalent bases.
- **If violated.** A transition that would set a disposition requiring an established
  basis while the basis is unresolved, or that would store a comparison across
  different bases, is refused (guard G-INV-3) and logged. The participant stays in
  Requires investigation or Indeterminate, as its evidence state dictates.

#### Invariant 4 — A rule cannot apply outside its applicability conditions

- **Statement.** Every formula and tolerance carries its applicability predicate (dates,
  employment group, formula type, status); the engine refuses to apply it outside, and
  the refusal is recorded — not silently skipped.
- **Preserved by.** `T` checks applicability predicates before applying a rule version
  or tolerance set to a participant. A provision version governs only participants whose
  measurement date falls in its effective period (never apply the latest formula
  retroactively, MASTER_PROMPT §5). A tolerance set applies only to the case and the
  participants it was recorded for; a tolerance copied from another case without review
  is flagged (Stage 1 output 03, §2.4, rule T-5).
- **If violated.** A transition that would apply a rule outside its predicate — e.g. a
  formula version to a participant outside its effective dates — is refused
  (guard G-INV-4) and logged, and the refusal is recorded against the participant
  (not silently skipped).

#### Invariant 5 — Unverified statistical results cannot become approved participant benefits

- **Statement.** The statistics module has no write path to benefits or dispositions.
  A disposition of Verified / Supported for acceptance / Correction recommended must cite
  a deterministic calculation or documented evidence, never a model output alone.
  Model outputs are labelled as such wherever shown.
- **Preserved by.** The state shape enforces it structurally: `statistical-screen-completed`
  (§6.2) writes only to an advisory work-list, never to `benefitCalculation`,
  `benefitComparison`, or `disposition`. The determination record (§7) has no field
  that accepts a statistical model output as the calculated benefit; a hypothesis with
  support class `coincidence` can never support a disposition (§1.2). The approval
  re-check (§4.2) requires a deterministic calculation or documented evidence citation.
- **If violated.** A transition that would set a disposition, a benefit, or a corrected
  value citing only a statistical output is refused (guard G-INV-5) and logged.
  Statistical findings remain visible as investigation leads; they never become benefits.

#### Invariant 6 — Updating one participant must not silently change others

- **Statement.** Recalculation is dependency-driven: an event names the affected
  participants (or the affected plan-level input, in which case the affected set is
  computed explicitly and logged). A run reports exactly which participants changed and
  why; an unchanged participant's results are untouched.
- **Preserved by.** `T` computes the affected set from the event before recomputing
  (§6.3), and the run log names the set. A participant outside the set keeps its
  calculation, comparison, and disposition records byte-identical. The audit event for
  the run lists the affected keys and the reason each was affected.
- **If violated.** A transition that would recompute or alter a participant outside the
  computed affected set, or that cannot name its affected set, is refused
  (guard G-INV-6) and logged. (In practice this guard catches implementation errors,
  not reviewer actions; it is enforced in `T`, not left to the UI.)

#### Invariant 7 — Every approved determination retains its supporting evidence

- **Statement.** A disposition cannot transition to approved without its evidence set
  (recorded benefit, reconstructed benefit or bounds, comparison basis, hypotheses
  considered, missing evidence, assumptions, reviewer, date — the §14 items 1–10, §7).
  The transition is rejected if any required item is missing.
- **Preserved by.** The approval gate (§4): `ApproveDisposition` (T3) requires a complete
  determination record (§7) and a frozen evidence snapshot (§4.3). The check is
  re-run at approval time against the current snapshot, not trusted from proposal time.
  The determination record and its evidence are retained with the approved disposition
  record (§2), and superseded determinations remain readable (§2.1).
- **If violated.** An approval attempt with any §14 item missing, or whose evidence
  snapshot no longer matches the current state, is refused (guard G-INV-7) and logged.
  The disposition stays `recommended`; the reviewer is told exactly which item is missing.

#### Invariant 8 — No silent failure, no invented exactness

- **Statement.** If exact reconstruction is impossible, the engine produces
  bounds/scenarios and the disposition moves toward Requires investigation /
  Indeterminate — it never emits an exact number the evidence cannot support, and never
  leaves a participant without a disposition.
- **Preserved by.** The evidence state (§2) distinguishes "no `B̂_i`" (null) from a
  zero benefit; blanks are missing, never zero. The bounds machinery (§5.3) and the
  reachability matrix (§1.3) force the disposition toward Requires investigation /
  Indeterminate when exactness is unavailable. The case-closure rule (§1.5) forbids
  closing with an undispositioned participant.
- **If violated.** A transition that would store an exact reconstructed benefit where the
  evidence supports only bounds, or that would close a case with an `unassessed`
  participant, or that would fill a missing input with zero or an invented value, is
  refused (guard G-INV-8) and logged.

#### Invariant 9 — (§0 standing requirement) Reliable calculation and documented disposition even when exact reconstruction is impossible

- **Statement.** The application must still produce reliable actuarial calculations and
  documented acceptance decisions when exact historical reconstruction is impossible —
  bounds, scenarios, documented dispositions, human decision; never a silent failure or
  a made-up exact number when the evidence cannot support one.
- **Preserved by.** This is Invariant 8 made into a positive delivery obligation, and it
  is preserved by the same machinery plus one addition: **the output obligation**.
  For every in-scope participant, in every finished run, `S_t` must contain at least
  one of (a) an exact `B̂_i` with its trace, (b) justified bounds with their stated
  assumptions, or (c) an explicit statement that no justified bound exists with the
  reason — together with exactly one disposition (approved, or recommended and flagged
  as unapproved). A run whose output lacks any of these for any participant is
  incomplete: it cannot be reported as finished, and the case cannot close on it.
  Scenarios are named, discrete, and reproducible (Stage 1 output 03, §4.4); sensitivity
  is reported in decision terms (does the decision change?), not only in dollars.
- **If violated.** A transition that would finish a run, close a case, or export a report
  while any in-scope participant lacks a calculation/bounds/no-bounds-statement and a
  disposition is refused (guard G-INV-9) and logged. The run is reported as incomplete,
  with the participants and the missing pieces named — the incompleteness is itself
  the output, never hidden.

### 6.7 Guard catalogue (summary)

| Guard | Enforces | Refuses when |
|---|---|---|
| G-INV-1 | Invariant 1 | A transition would write to the immutable input snapshot or present a correction without its original. |
| G-INV-2 | Invariant 2 | A result's snapshot hash or rule version is missing or mismatched at approval / carry-forward. |
| G-INV-3 | Invariant 3 | A disposition requiring an established basis is attempted while the basis is unresolved, or a Δ is computed across non-equivalent bases. Also: a Requires investigation record naming no next step. |
| G-INV-4 | Invariant 4 | A rule is applied outside its applicability predicate. |
| G-INV-5 | Invariant 5 | A disposition/benefit/corrected value would rest on a statistical output alone. |
| G-INV-6 | Invariant 6 | A transition would alter a participant outside the computed affected set, or cannot name its affected set. |
| G-INV-7 | Invariant 7 | Approval is attempted with any §14 item missing, or the evidence snapshot no longer matches. |
| G-INV-8 | Invariant 8 | An exact number would be emitted where only bounds are supported; a case would close with an `unassessed` participant; a missing input would be filled with zero/an invented value. |
| G-INV-9 | Invariant 9 | A run/case/report would finish while a participant lacks a calculation/bounds/no-bounds-statement and a disposition. |
| G-IND-1 | §5.3 | An Indeterminate transition lacks bounds (or a no-bounds reason), missing evidence, data requests, or the indeterminate rationale. |
| G-IND-2 | §5.2 | An Indeterminate transition is attempted while all data requests are still `not-issued` with no recorded reason why no request can be made. |

Guards are checked in `T`, in the order above, before any state change. The first failing
guard stops the transition; its refusal is the audit event. Guards are not configurable,
not skippable, and not overridable by any role.

---

## 7. The determination record (the ten §14 items)

Every approved determination retains its supporting evidence (Invariant 7). The record
below carries the ten documentation items from MASTER_PROMPT §14, numbered as in §14.
It is the record the approval gate (§4) requires, and the record the AMB Acceptance
Template memo is written from (the template itself is a blank shell with a `<body>`
placeholder — Stage 1 output 00, source #10 — so the memo's substantive content is
this record, not the template).

```typescript
interface DeterminationRecord {
  determinationId: string;
  dispositionId: DispositionId;
  participantKey: ParticipantKey;
  caseId: string;
  schemaVersion: string;            // disposition schema version (§2.1)
  createdAt: string;
  createdBy: string;                // reviewer identity (drafted by); approval is separate (§4.2)

  /** §14 item 1 — Recorded administrator benefit. */
  recordedBenefit: {
    amountCents: number | null;     // B_i^PA in integer cents; null if blank (blank = missing, never 0)
    isBlank: boolean;
    sourceScheduleRef: string;      // PA benefit schedule row/cell/page, or census location
    recordedDate: string | null;    // when the PA recorded it (distinct from measurement date, §5)
  };

  /** §14 item 2 — Independently calculated benefit, if available. */
  calculatedBenefit: {
    amountCents: number | null;     // B̂_i; null if not reconstructible
    calculationId: string | null;
    calculationStatus: "complete" | "partial" | "blocked" | "indeterminate";
    /** Justified bounds where exact reconstruction is impossible (§5.3). */
    boundsCents: { min: number; max: number } | null;
    noBoundsReason: string | null;
    correctedBenefitCents: number | null; // set only for Correction recommended
  };

  /** §14 item 3 — Comparison basis and applicable provisions. */
  comparisonBasis: {
    basis: "established" | "unresolved";
    measurementDate: string | null; // t_i; null if unresolved
    retirementBasis: string | null; // normal retirement date/age basis
    annuityForm: string | null;     // e.g. plan normal form; null if unknown (unknown is stored, not defaulted)
    vestingTreatment: "gross" | "vested" | "unknown";
    planVersionIds: string[];       // PlanVersion(s) in force at t_i
    comparisonBasisState: "same-basis" | "basis-converted" | "unresolved"; // output 02, §A.2.11
    toleranceSetId: ToleranceSetId;
    deltaCents: number | null;      // null when basis is unresolved
    withinTolerance: boolean | null;
  };

  /** §14 item 4 — Differences and their possible explanations. */
  differencesAndExplanations: {
    deltaCents: number | null;
    absDeltaCents: number | null;
    relDelta: number | null;        // null when the denominator is zero/near-zero (output 03, §2.3)
    denominatorFlag: "ok" | "R_UNDEFINED_ZERO_DENOMINATOR" | "R_UNSTABLE_SMALL_DENOMINATOR" | "PA_ZERO" | null;
    hypotheses: DiagnosticHypothesis[]; // each with counterfactual, evidence, support class, status
    /** The ranked explanation, or "none supported" — never a silent omission. */
    leadingExplanation: string;
  };

  /** §14 item 5 — Missing evidence. */
  missingEvidence: Array<{
    input: string;
    missingClass: "M1" | "M2" | "M3" | "M4" | "M5";
    decisionImpact: string;
  }>;

  /** §14 item 6 — Material assumptions. */
  materialAssumptions: Array<{
    assumption: string;
    basis: string;                  // what the assumption rests on (document, or "reviewer judgment")
    effectIfWrong: string;          // what changes if the assumption is wrong
  }>;
  /** "None" is a valid value, stated explicitly — an empty list means "no material
      assumptions", and the record says so rather than leaving the question open. */

  /** §14 item 7 — Sensitivity and uncertainty. */
  sensitivityAndUncertainty: {
    /** Per-scenario benefits (named, discrete, reproducible — output 03, §4.4). */
    scenarios: Array<{ scenarioName: string; assumptions: string[]; benefitCents: number | null }>;
    /** Disposition sensitivity: does any missing input move the decision? (output 03, §4.4) */
    dispositionSensitivity: string;
    /** Contribution of each missing input to the bound width (output 03, §4.5). */
    uncertaintyAttribution: Array<{ input: string; contributionCents: number | null; share: number | null }>;
    statisticalNotes: string | null; // advisory only; labelled as such (Invariant 5)
  };

  /** §14 item 8 — Supporting documents and precise citations. */
  supportingDocuments: Array<{
    documentId: string;             // SourceDocument id
    citation: string;               // precise location: page/section/cell/row (MASTER_PROMPT §6)
    whatItSupports: string;         // which item above this document supports
  }>;

  /** §14 item 9 — Recommended disposition. */
  recommendedDisposition: {
    disposition: Disposition;
    recommendedBy: "system" | string; // system, or the drafting reviewer's identity
    recommendedAt: string;
    recommendationRationale: string;
  };

  /** §14 item 10 — Human determination, rationale, reviewer, and date. */
  humanDetermination: {
    disposition: Disposition;       // the determined disposition (may differ from the recommendation)
    rationale: string;              // reviewer-written; "agreed" without a reason is not a rationale
    reviewer: string;
    reviewerRole: string;           // see OD-3
    determinationDate: string;      // ISO date
    approvalId: string | null;      // ApprovalRecord (§4.2); null until approved
  };

  /** Carried forward for Indeterminate / Requires investigation (§5.3). */
  dataRequests: DataRequest[];

  /** Downstream consequence of this determination (§1.2, §1.4). */
  downstream: {
    usableInValuation: boolean;
    valueCents: number | null;
    valueKind: "recorded" | "corrected" | "none";
    paAmbAccept: "Y" | "N" | null;
  };

  /** Integrity: the record's own content hash, so a later reader can verify it
      has not changed since approval. */
  contentHash: string;
}
```

**Completeness rule.** A determination record is complete only when all ten items are
present. Items that do not apply are stated as not applying, with the reason — e.g.
item 2 with `amountCents: null` and `calculationStatus: "indeterminate"` plus a
`noBoundsReason`; item 6 as an explicitly empty list meaning "no material assumptions".
A missing item and a stated "none" are different things, and the guard G-INV-7 checks
for the former, not the latter. A record with a missing item cannot be approved; a
record with a stated "none" can.

**Note on item 2 and Policy 5.8-1.** Where the determination is Correction recommended,
the record states the corrected amount and the direction/size of the correction. The
Policy 5.8-1 $1/$5 tolerances are recorded, where relevant, as the tolerances that will
govern a *later* decision about correcting an issued benefit determination — not as the
reason the correction is recommended here. The recommendation rests on the "reasonably
certain" standard (§0.3, §1.2.4).

---

## 8. Worked synthetic examples

Both examples are **fictional participants in a fictional plan**. No live case data, no
participant-level census rows. Names, dates, and amounts are invented for illustration
only. The fictional plan's provisions are stated inside each example so the example is
self-contained; they are not PBGC provisions and must not be cited as such.

Case context shared by both examples (fictional): case `CASE 00000001` (synthetic case
number, leading zeros kept as text), plan "Synthetic Plan A" (fictional), DOPT
2020-12-31 (fictional). Case tolerance set (actuary-set, recorded with rationale —
not a PBGC rule): `τ_abs = $5.00/month`, `τ_rel = 1%`, combination rule "within
tolerance if `D_i ≤ τ_abs` **or** `|R_i| ≤ τ_rel`" (either-leg), `τ_material = $25.00/month`,
`ε_R = $1.00/month`. The $5.00 figure is borrowed from Policy 5.8-1 as a screening value
and labelled as such in the tolerance record (Stage 1 output 03, §2.4, rule T-4);
it is not presented as a PBGC reconciliation rule.

### 8.1 Example 1 — Verified (SYN-V-01)

**Participant (fictional):** `SYN-V-01`, RETSTAT 2 (separated vested), DOB 1960-04-15,
DOTE 2019-06-30 (established from the census and confirmed on the PA benefit schedule,
p. 4). Fictional plan provision (synthetic example only): unit-credit formula,
1.25% × credited service × final-3-year average monthly compensation; final monthly
benefit rounded to the nearest dollar per plan §7.3 (fictional plan section, stated in
the example's source document, not a PBGC source).

**Evidence state.**

| Item | Value |
|---|---|
| Completeness grade | Complete |
| `B_i^PA` (PA_AMB, BCV9) | $850.00/month (recorded 2019-07-12 on the PA schedule, p. 4) |
| Credited service (CSPA) | 20.0 years (documented; BCV-calculated CS agrees) |
| Final-3-year average monthly compensation | $3,398.00 (2017–2019 salary years present; PA_ACOMP $3,398.00 agrees) |
| `B̂_i` (reconstructed, same basis) | $849.50 = 1.25% × 20 × $3,398.00; trace: service 20.0, average $3,398.00, base $849.50, no caps/offsets apply, rounding (final monthly to nearest dollar) → $850.00 |
| Comparison basis | Established: measurement date DOTE 2019-06-30; normal form (straight life annuity at NRD); vesting treatment gross (vesting 100% at DOTE, VP = 1.0, so gross = vested — no double-vesting question); plan version in force at DOTE |
| Δ_i / D_i / R_i | +$0.50 / $0.50 / +0.06% |
| Tolerance | `D_i` $0.50 ≤ `τ_abs` $5.00 → within tolerance (either-leg rule) |
| Hypotheses | H15 (rounding at different stages): **Supported** — the plan's documented final-monthly rounding to the nearest dollar explains the $0.50 exactly, and the same sequence resolves the small discrepancies across the cohort (12 of 12 participants within $1.00). H12 (vesting applied twice): **Refuted** — VP = 1.0, so a second vesting application changes nothing. No other hypothesis proposed. |
| Missing evidence | None. |

**State-machine walk.**

1. `unassessed` → (run-calculation) → system proposes `verified`, status `recommended`
   (T1). Entry conditions §1.2.1 all hold: Complete, basis established, exact `B̂_i`,
   within tolerance, no material unexplained item (H15 supported, H12 refuted).
2. Actuary reviews the determination record (§7, all ten items present), confirms the
   rounding explanation against the cited plan section, and approves (T3):
   `verified`, status `approved`. Approval record names the reviewer, the date, the
   rationale ("Independent reconstruction $849.50; recorded $850.00; $0.50 difference
   is the plan's documented final-monthly rounding to the nearest dollar; no other
   discrepancy."), and the frozen evidence snapshot (input hash, calculation run id,
   rule version, tolerance set id).
3. Downstream: `usableInValuation = true`, `valueCents = 85000` (recorded),
   `paAmbAccept = "Y"`. The benefit is used in the valuation as `B_i^PA`.

**What this example proves about the design.** Verified is reachable only with a complete
evidence state and a documented explanation for the (small) difference; the $0.50 is
explained, not ignored, and the explanation is a document-supported rounding rule, not
a numerical coincidence (anti-coincidence rule, output 03 §2.7).

### 8.2 Example 2 — Indeterminate, with bounds and a prioritised data request (SYN-I-01)

**Participant (fictional):** `SYN-I-01`, RETSTAT 2 (separated vested), DOB 1958-11-02.
DOTE is **blank** in the census. No PA benefit schedule was received for this participant.
The plan document for the participant's era is missing from the case file.

**Evidence state.**

| Item | Value |
|---|---|
| Completeness grade | Insufficient (class-M5 gap: governing formula unidentifiable for the era; measurement basis unresolved) |
| `B_i^PA` (PA_AMB, BCV9) | $1,120.00/month (in the census; no schedule row traces to it — rule C-01 flag, output 02) |
| Measurement date | **Unresolved.** DOTE blank; the PA extract states no date its amounts were calculated through; the extract's date disagrees with no census date because there is none to compare. `comparison_basis = UNRESOLVED`; **no Δ is computed**. |
| Credited service | 20.0 years (documented, hire/termination dates present) |
| Compensation | Final-average monthly compensation bounded: two of three averaging years known ($5,000, $5,200); the third year is missing (class M3) but bounded by the plan's compensation records: no less than $4,800 (lowest monthly compensation in any known year) and no more than $5,400 (the §401(a)(17) cap in effect, expressed monthly — synthetic cap figure, stated as synthetic). Then the average is bounded by [($4,800+$5,000+$5,200)/3, ($5,400+$5,000+$5,200)/3] = [$5,000.00, $5,200.00] (method of output 03, §4.3, worked example B-207) |
| Formula | **Two candidate versions, unresolvable from available documents.** Pre-amendment formula 1.50% × service × average; post-amendment formula 1.25% × service × average. The amendment's effective date is unknown (amendment document missing), so neither version can be established as the version in force at the (unknown) measurement date. |
| Per-scenario bounds (labelled, not a single justified bound) | Under 1.50%: [1.50% × 20 × $5,000, 1.50% × 20 × $5,200] = [$1,500.00, $1,560.00]. Under 1.25%: [1.25% × 20 × $5,000, 1.25% × 20 × $5,200] = [$1,250.00, $1,300.00]. `B_i^PA` $1,120.00 lies outside **both** scenario ranges — but that is **not** treated as proof of error, because the comparison basis is unresolved (annuity form and vesting treatment of `B_i^PA` are also unknown) and the formula version is unidentified. The outside-range finding is recorded as an investigation lead, not a conclusion. |
| Single justified bound | **None.** No single `[B_i^min, B_i^max]` can be justified: the formula version is unknown, so monotonicity/bound validity cannot be established across versions, and the basis is unresolved. `noBoundsReason`: "Governing formula version for the participant's era cannot be identified and the measurement date is unresolved; no single bound is justifiable." |
| Hypotheses | H1 (different measurement dates): **indeterminate** — cannot be tested without a measurement date. H6 (historical plan amendments): **indeterminate** — cannot be tested without the amendment document. H16 (missing information): **supported as a description of the state** — the gap is documented, not explained away. No hypothesis is recorded as `supported` for a corrected value; Correction recommended is unreachable (no reasonable certainty about either an error or an amount). |
| Missing evidence | (a) PA benefit schedule for this participant — class M2 (recoverable: the schedule exists with the prior administrator; request issued, see below). (b) Plan document / amendment for the era, with adoption and effective dates — class M5 as it stands (no copy in the case file; the holder is unknown). (c) Missing compensation year — class M3 (bounded, contributes $60.00 of bound width under the 1.50% scenario and $50.00 under the 1.25% scenario: average width $200.00 × 0.30 and × 0.25 respectively). (d) Annuity form and vesting treatment of `B_i^PA` — class M1 (required for exact reconstruction; no source states them). |

**Prioritised data requests (§5.3, ordered by expected effect on the decision).**

| Priority | Input | Source to ask | Expected decision effect | Status |
|---|---|---|---|---|
| 1 | PA benefit schedule (measurement date, annuity form, vesting treatment, schedule row for $1,120.00) | Prior plan administrator (holder of the schedule) | Disposition-changing: establishes the basis; could move the participant from Indeterminate to a decidable state, or confirm the basis is unresolvable. | `issued` 2026-11-12; awaiting response. (If answered with no data → `answered-no-data`; the Indeterminate disposition then stands on a documented exhausted search.) |
| 2 | Plan document / amendment for the era (formula version, effective date) | Plan sponsor records / prior administrator | Disposition-changing: identifies the governing formula; collapses the two scenario ranges to one. | `issued` 2026-11-12; awaiting response. |
| 3 | Missing compensation year | Payroll records via the prior administrator | Narrows the per-scenario bound width by up to $60.00; does not by itself change the disposition while the formula and basis are unresolved. | `not-issued` — held until requests 1–2 are answered, because its decision effect depends on which formula governs. (Recorded as held, with the reason — not silently unissued.) |

**State-machine walk.**

1. `unassessed` → (run-calculation: bounds/scenarios only; no exact `B̂_i`, no Δ)
   → system proposes `indeterminate`, status `recommended` (T1). Entry conditions
   §1.2.5 hold: no `B̂_i`, no single justifiable bound, unresolved basis.
2. The actuary reviews: the participant is **not** Requires investigation, because the
   concrete next steps (requests 1–2) have been issued and are awaiting response — the
   determination records this explicitly, and the disposition will be re-assessed
   (T10) when the responses arrive. The reviewer records the §5.2 item-3 statement:
   "No further step is currently available beyond the two issued requests; the
   participant cannot be decided on the evidence as it stands."
3. **Approval timing (stated explicitly, because it is the subtle point).** The
   Indeterminate disposition is approved (T3) only when §5.2 is satisfied — i.e. when
   the requests have been answered without resolving the gap, or the reviewer records
   why no further request can currently be made. While requests 1–2 are still
   `issued` and awaiting response, the correct current state is `indeterminate`,
   status `recommended` — an honest record of where the analysis stands — and the
   case report shows it as unapproved. Approving Indeterminate while a live request
   could still resolve the case would misrepresent an open investigation as a closed
   decision. (Guard G-IND-2 enforces the boundary: approval is refused while all
   requests are `not-issued` with no reason; the `issued`-awaiting-response case is
   governed by this paragraph, not by the guard alone — the reviewer judges it.)
4. Downstream: `usableInValuation = false`, `valueCents = null`, `valueKind = "none"`,
   `paAmbAccept = "N"`. No benefit is carried forward for this participant. The
   plan-level report lists the participant as Indeterminate with its scenario bounds,
   missing evidence, and data requests.
5. When a response arrives (`record-data-received`, T10): if the schedule establishes
   the basis and the amendment identifies the formula, the system re-computes and
   re-proposes (possibly Verified / Supported / Correction recommended / Requires
   investigation, per the new evidence); the Indeterminate record becomes
   `superseded`, retained in history. If the response is "no data", the request status
   becomes `answered-no-data`, and the Indeterminate disposition can then be approved
   on a documented exhausted search.

**What this example proves about the design.** Indeterminate carries real content —
per-scenario bounds with their assumptions, a no-single-bound reason, classified missing
evidence, prioritised requests with statuses — and the line between Indeterminate and
Requires investigation is a recorded judgment (live requests outstanding vs exhausted
search), not a label chosen by feel. The $1,120.00 sitting outside both scenario ranges
does not become a correction, because reasonable certainty about the error and the
amount is unattainable while the basis and the formula are unresolved.

---

## 9. Open decisions

Recorded as open decisions, not silent defaults. Each names the question, why it is
open, and who decides it. Nothing in this file decides any of them.

| # | Open decision | Why it is open | Decided by |
|---|---|---|---|
| OD-1 | **Does the five-disposition set need a PBGC-official mapping before the app is used on a real case?** I.e. must each of Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate be mapped to an official PBGC classification, procedure, or work-product step (e.g. a step in case processing or a section of the AMB Acceptance Template memo), or is the proposed application-state set sufficient as the app's internal language with the memo as the official record? | The dispositions are proposed application states (§0.2), and no PBGC source states them. The AMB Acceptance Template is a blank shell with no criteria (Stage 1 output 00, source #10). Mapping them to official procedure without a PBGC source would invent the mapping. | User (with PBGC procedure, if applicable). Stage 3 must not assume an answer. |
| OD-2 | **The `PA_AMB_ACCEPT` mapping for Requires investigation and Indeterminate** (§1.4): set to `"N"` at the time the disposition is approved, or leave unset (blank) until the investigation resolves / the case is decided? | BCV3.PA_AMB_ACCEPT carries no criterion and no instruction for pending cases. Setting `"N"` records "not accepted (yet)"; leaving it unset records "no decision yet". The two read differently in BCV, and no source distinguishes them. The Verified / Supported → `"Y"` and Correction recommended → `"N"` limbs are likewise proposed, not sourced. | User. Until decided, the app must record the flag as set by the approved determination and must show, alongside it, that the mapping is provisional. |
| OD-3 | **Who is the "authorized human reviewer"?** Which person/role may approve a disposition — the case actuary alone, the case actuary with a second reviewer, the Acting Associate Division Manager (PADMD) as addressee of the acceptance memo, or another role under applicable PBGC procedures? What qualifies a reviewer (case assignment, grade, delegation)? | The AMB Acceptance Template names roles (actuary ASD/ACPC as author; Acting Associate Division Manager PADMD as addressee; auditor PADMD and EBLS/PSD copied) but does not state who approves. MASTER_PROMPT §14 says only "an authorized human reviewer according to applicable PBGC procedures". Inventing the authorisation would invent a control. | User (per applicable PBGC procedures). Until decided, the approval record (§4.2) captures reviewer identity and role as free text, and the app enforces "a named human, not the system" without enforcing a particular role. |
| OD-4 | **Tolerance defaults and the suggestion question.** The app ships with no built-in acceptance tolerance (§0.2). May it *suggest* starting values drawn from Policy 5.8-1 ($1.00/$5.00) — labelled as borrowed from the benefit-correction policy, not a reconciliation rule — and presented as a question to the actuary, not a silent default (Stage 1 output 03, §2.4, rule T-4)? Or must every case start from a blank tolerance record with no suggestion at all? | Stage 1 output 03 permits the suggestion only if labelled and presented as a question. Whether even a labelled suggestion is acceptable in the product is a user judgment about how the tool will be read in practice. | User. |
| OD-5 | **Re-approval after a trivial change.** §3.2 requires re-approval even when a source update or rule revision re-proposes the identical disposition. Is that proportionate for trivially immaterial changes (e.g. a corrected typo in a document title that changes the input hash but no value), or should there be a defined "immaterial change" path with a lighter confirmation? | The strict rule protects Invariant 2 (reproducibility) and Invariant 7 (evidence retention), but it may create approval fatigue. Any lighter path would need a definition of "immaterial" and a record of who judged it so — which is itself a decision, not a default. | User. Until decided, the strict rule (§3.2) stands. |
| OD-6 | **Case closure with unapproved recommendations.** §1.5 forbids closing with `unassessed` participants but permits closing with `recommended` (unapproved) dispositions flagged as unfinished business. Is that the right closure rule, or must every in-scope participant be `approved` before the case closes? | The distinction matters for reporting: a case closed with unapproved recommendations is a case with known unfinished work. Whether PBGC procedure permits that, or requires approval first, is not stated in any source consulted. | User. |
| OD-7 | **The disposition schema version and its change process.** Who approves a new disposition-schema version (§2.1), and must existing approved determinations be re-validated (re-proposed and re-approved) or grandfathered when the schema changes? | A schema change can change entry conditions and therefore change what past approvals meant. The versioning machinery is defined here; the governance of a version change is not. | User (Stage 3 governance decision). |
| OD-8 | **RETSTAT 5 and out-of-scope participants.** Stage 1 output 02 grades RETSTAT 5 as `excluded` with no disposition. Is exclusion the right treatment for every RETSTAT 5 record, or are there RETSTAT 5 records that still need a disposition (e.g. a record excluded from the valuation population but still carrying a `PA_AMB` that must be dispositioned for the file)? | The exclusion follows output 02, §A.5, but the boundary case (a `PA_AMB` present on an excluded record) is not addressed in any source consulted. | User / Stage 3 data-model review. |

**Out of scope here, by instruction — not decided in this file.** The dark-theme-vs-design-system
question (Stage 1 output 04, §8: the PBGC Design System v1.1.0 has no dark theme of its
own; MASTER_PROMPT §18 requires dark by default) is a UI/theme decision for the user.
It is recorded here only to state that it is **not** decided by this file and that nothing
in the state machine depends on it.

---

## 10. Handoff notes for Stages 3–7

1. **Guards are the testable core of this file.** Stage 7 property-based tests should test
   each guard in §6.7 directly: attempt the forbidden transition, assert refusal, assert
   the analytic state is unchanged, assert the refusal is in the audit log.
2. **Indeterminate test cases must be genuinely indeterminate** (Stage 1 output 04, §11):
   synthetic cases like §8.2, where the formula version and the measurement date are both
   unresolvable — not cases merely missing one field. A test that only deletes a salary
   year does not test Indeterminate.
3. **The approval gate is a negative test, not just a positive one.** Stage 7 must test
   that no code path — including re-import, rule revision, and bulk operations — can
   create an `approved` record without an `ApproveDisposition` event by a named human.
4. **The `PA_AMB_ACCEPT` mapping (§1.4) and OD-1/OD-2/OD-3 must be resolved before the
   app is used on a real case.** Until then, the app is a design and test artefact that
   records its provisional mappings visibly.
5. **Stage 4 (deterministic engine) consumes §1.2 and §6.1–§6.4:** the engine must emit
   the evidence state (§2) in exactly the shape the entry conditions test, including
   `comparisonBasis`, bounds with stated assumptions, and hypothesis support classes.
   If the engine cannot emit a field, the entry condition that needs it cannot be tested,
   and the disposition that needs it is unreachable — the engine must report that, not
   work around it.
6. **Stage 6 (UI) consumes §3 and §4:** the workflow must show, for every participant,
   the current disposition *and* its status (recommended vs approved), the entry
   conditions and which ones hold, and the refusal reason when a transition is refused.
   A UI that shows only the disposition label hides the distinction this file exists
   to make.

---

## 11. Sources

- MASTER_PROMPT.md, §§ 3, 5–7, 10, 12, 14, 17 — governing spec (dispositions §14;
  state-driven design §17; typed benefit quantities §3; reconciliation §10;
  missing-data framework §12).
- Stage 1 output 00, `stage1/00-source-inventory.md` — PA_AMB definition (BCV9, row 1031);
  PA_AMB_ACCEPT (BCV3); AMB Acceptance Template as a blank memo shell (source #10);
  Policy 5.8-1 / 6.3-1 tolerance scope; gaps (annuity form, vesting, rounding, NRD basis
  unstated; processing manual and BCV manual text layers unreadable).
- Stage 1 output 02, `stage1/02-data-requirements-validation.md` — entities (§A.2);
  completeness grades and disposition reachability (§A.5, §A.7); validation rules
  including C-09 (PA_AMB_ACCEPT set only by a determination) and the measurement-date
  rules M-01–M-06; blank = missing (P-13).
- Stage 1 output 03, `stage1/03-reconciliation-statistical-methodology.md` — the five
  dispositions and evidence-state mapping (§0.4, §4.7); tolerance rules T-1–T-5 (§2.4);
  hypothesis catalogue H1–H17 and ranking (§2.5–§2.6); anti-coincidence rule (§2.7);
  bounds rules B-1–B-5 (§4.3); scenario/sensitivity (§4.4); uncertainty attribution
  (§4.5); data-request prioritisation (§4.6); "reasonably certain" standard from
  Policy 5.8-1 (§1.2).
- Stage 1 output 04, `stage1/04-architecture-decision.md` — Option C (Hybrid), staged;
  the eight invariants (§7.2); dispositions as versioned state (§7.4); state-driven
  design at Stage 1 level (§7.1); dark-theme/design-system question (§8, recorded as
  open, not decided here).

---

*Stage 2 output 5. Design specification only — read-only design work. No app, no engine
code, no UI, no tests were built. All worked examples are synthetic and fictional.*
