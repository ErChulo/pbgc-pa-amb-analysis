# PA_AMB Analysis — Data Requirements and Validation Specification

- **Project:** PA_AMB Analysis System
- **Repo:** [ErChulo/pbgc-pa-amb-analysis](https://github.com/ErChulo/pbgc-pa-amb-analysis) (public, main; user-created 2026-11-12)
- **Local dir:** `~/workspace/pbgc-pa-amb-analysis`
- **Stage:** Stage 1, output 2 of 4 (data requirements and validation)
- **Governing spec:** `MASTER_PROMPT.md` (§2 source hierarchy, §3 typed benefit, §5 temporal reconstruction, §6 data architecture, §7 validation, §10 reconciliation, §12 missing-data framework, §14 acceptance framework)
- **Status:** Research spec only. Read-only work. No code, no app, no repo writes.
- **Date:** 2026-11-12

## 0. What this document is

Part A defines the minimal and comprehensive input datasets for the PA_AMB analysis: the 15 entities of §6, the input formats, the non-census inputs, data-completeness grades, and the five-way missing-data split of §12.

Part B is the validation-rule catalog: layered validation per §7 (structural, participant-level, cross-field, longitudinal, cross-source), plus the PA_AMB blank-handling and measurement-date rules. Every rule carries: rule ID, source, fields examined, actual vs expected, severity, observed discrepancy, recommended investigation, and whether it blocks a calculation.

## 0.1 Source hierarchy and conflicts

Per §2.3, in order: (1) statute/regulation, (2) PBGC policy / technical procedure / approved guidance, (3) governing plan documents, (4) historical administration records and valuation reports, (5) Defined Benefit Answer Book and other professional references, (6) actuarial judgment / heuristics. Where two sources conflict, this document flags the conflict. It never silently picks one.

## 0.2 Sources actually consulted

| Source | What was used | Location |
|---|---|---|
| BCV Data Dictionary (2026-10-30 index: 1,172 field records, 1,152 distinct fields, 12 tables) | Authoritative for every BCV field name, type, and category in this document | `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` (+ `.json`) |
| `BCV-DataValidation-predicates.xlsx` | 249 official BCV validation predicates (235 enabled) | `~/workspace/pbgc_review/pa-amb/BCV-DataValidation-predicates.xlsx` (Drive file `1CCBAMkMVVS7G1axzegkIqCjS3TrE4Qkr`, downloaded 2026-11-12) |
| Defined Benefit Answer Book, 2024 ed. (updated 12/2023), Ch. 16 Census Data and Demographics | Q 16:1 census-data list; Q 16:2 annual reconciliation; Q 16:5 materiality; Q 16:7 takeover data; Q 16:11 sex-distinct mortality | `~/workspace/pbgc_review/pa-amb/DBAB-Ch16.pdf` |
| Defined Benefit Answer Book Ch. 7 Measuring Service; Ch. 8 Vesting; Ch. 9 Plan Benefits / Accrued Benefits | Service-credit, break-in-service, rehire, vesting-schedule, and accrued-benefit concepts grounding the service/vesting rules | `~/workspace/pbgc_review/pa-amb/DBAB-Ch07.pdf`, `DBAB-Ch08.pdf`, `DBAB-Ch09.pdf` |
| PBGC Operating Policy 5.8-1 Benefit Corrections (issue date 10/02/2014) | Tolerance rules and the "reasonably certain" standard — see §B.0.1 for the limit on how they apply here | `~/workspace/pbgc_review/pa-amb/Benefit_Corrections.pdf`; same text in `~/workspace/pbgc_review/eadj/current-policies.txt` §5.8-1 |
| `CASE_PROCESSING.txt` | Internal-controls review as evidence for source reliability (§B.5, rule C-10) | `~/workspace/pbgc_review/eadj/CASE_PROCESSING.txt` |
| DEL module material (`pbgc-del-extractor.md`, DEL v0.1.0 record) | Input-field universe (271 Input fields) and match-ranking design — cited, not duplicated | `~/workspace/pbgc_review/del/` |
| `BCV_ATPBGC_Add-ins.pdf` (Jul 2024) | Add-in functions behind Calculated service fields (COMPM, SERVYCA, etc.) | `~/workspace/pbgc_review/bcv/` |

## 0.3 Key finding 1 — PA_AMB has a stated measurement date in the dictionary

The dictionary defines PA_AMB (BCV9, NUMBER, Benefit / DOPT / Plan Admin / Input) as:

> "Plan Administrator Accrued Monthly Benefit at DOTE"

DOTE (BCV1, DATE, Input) is the participant's Date of Termination of Employment, with the note: "DOPT used for default RBD calculation when NULL and RETSTAT is '3' or '4'." The BCV-calculated counterpart AMB (BCV1, NUMBER, Calculated) is likewise "Accrued Monthly Benefit at DOTE."

Consequences:

1. The recurring "NRD or something else?" problem is partly resolved at the dictionary level: the **stated** basis of PA_AMB is DOTE, not NRD. A claim that a recorded PA_AMB is "as of NRD" contradicts the dictionary definition and must be evidenced, not assumed (rule M-04).
2. The measurement date is **unresolved in practice** whenever (a) DOTE is blank in the census record, (b) the PA extract does not state which date its amounts were calculated through, or (c) the extract's date disagrees with census DOTE. The dictionary gives the intended basis; it does not prove the PA used it. Rules M-01–M-06 (§B.4) govern this.
3. The DOPT-default note applies to the **required begin date (RBD) calculation**, not to PA_AMB. Do not treat "DOPT used when DOTE is NULL" as establishing that a blank-DOTE PA_AMB is measured at DOPT. That inference is not in the dictionary.

## 0.4 Key finding 2 — what the dictionary does NOT say about PA_AMB

The dictionary states no vesting treatment, no annuity form, no normal-retirement basis, and no explicit unit for PA_AMB. These are open questions, not assumptions:

| Question | Dictionary evidence | Status |
|---|---|---|
| Is PA_AMB vested or gross (pre-vesting)? | No statement. VPPA (BCV3, Input, "Plan Administrator's Calculated Vesting Percentage") is a separate field, which suggests PA_AMB is recorded before any vesting percentage is applied — but that is an inference, not a definition. | OPEN — must be established per case from the PA schedule or plan provisions. Rule X-09. |
| What annuity form / retirement basis? | No statement. FORM_CODE_NSF / FORM_CODE_NMF (BCV1, Calculated) give the plan normal forms; PA_AMB's form is not recorded in any BCV field. | OPEN — must come from the PA schedule. Rule X-10. |
| Units? | NUMBER. The name says "Monthly Benefit"; no explicit units or decimals statement exists in the dictionary. | ASSUMED monthly dollars, 2 decimal places — to be confirmed against the PA schedule at import. Rule S-09. |
| Is a blank PA_AMB zero? | No. Nothing in the dictionary equates blank with zero. | RULED — blank = missing, never zero (rule P-13 / §B.3). |

## 0.5 Key finding 3 — no official validation predicate covers PA_AMB

The predicates workbook contains 249 predicates. **None** mentions PA_AMB, AMB, CSPA, VSPA, ESPA, PA_ACOMP, PIA, or any salary-history field (S001–S050, FRSTYEAR, LASTYEAR). The predicates are BCV load/valuation predicates: they police BCV-calculated fields (XRD_MB_TERM, TERM_MB_ERD/EURD/NRD_NSF, LS_TERM, PVMB_*, FORM_CODE_*, dates, CS/VS, RETSTAT, ID). They do not validate the prior administrator's reported amounts.

Consequences:

1. Nearly all PA_AMB-specific validation in Part B is **application-specific analytical tests**, not official rules. Each rule is labelled OFFICIAL (adopted BCV predicate, with its BCV ID) or APP (application-specific test defined by this spec).
2. The workbook gives **no legend** for DATA_VLDTN_TYPE values 1–3 or for VLDTN_CAT_ID values 1–9. Only type 4 is interpretable: the report SQL decodes `DATA_VLDTN_TYPE = '4'` as critical error (`Crtcl_Err = 'Y'`). Type counts: 1 → 11, 2 → 66, 3 → 154, 4 → 18. This spec does not invent meanings for types 1–3; adopted official predicates keep their BCV type and receive an app severity under the rule in §B.1.3.
3. 7 predicates are disabled (ENABLE_FL = N: IDs 276, 293, 366, 400, 403, 445, 452), 4 are informational (I: 1000001–1000004), 3 are system-level (S: 1000005–1000007). Disabled predicates are **not** adopted; where a disabled predicate covers a real check (e.g. 276, credited service not populated), this spec re-states it as an APP rule with the reason noted.

## 0.6 Standing requirement — decisions without exact reconstruction (most important)

**The application must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible. That is what distinguishes this system from an ordinary pension benefit calculator.**

Design consequences, applied throughout this document:

1. **No silent failure.** A record that cannot be reconstructed exactly is never dropped, skipped, or zero-filled. It is graded (§A.5), its missing inputs are classified (§A.6), and it proceeds to a documented disposition.
2. **No invented exact number.** When the evidence cannot support an exact benefit, the system produces justified bounds (Bᵢ^min ≤ Bᵢ^possible ≤ Bᵢ^max), explicit scenarios, or no calculated benefit at all — never a made-up exact figure.
3. **Grades drive dispositions.** The completeness grade (§A.5) and the measurement-basis state (§B.4) determine which §14 dispositions are reachable. The reachability matrix is §A.7; no disposition outside the reachable set may be recorded for that participant.
4. **A record with an unresolved measurement date or insufficient data still yields a documented disposition** — `Indeterminate` or `Requires investigation` — with the reason, the missing evidence, and the data request recorded. The human reviewer makes the decision; the system documents it.
5. **Every validation failure routes somewhere.** A rule that blocks a calculation (§B.7) blocks the *exact calculation*, not the *case*. The participant is routed to bounds, scenarios, or an Indeterminate disposition with a full audit trail.

## 0.7 Conventions used in this document

- **Two different ID series — do not confuse them.** Dataset items (§A.3) use single-digit IDs with no leading zero: minimal items M-1–M-8, comprehensive items C-1–C-14. Validation rules (Part B) use two-digit IDs with a leading zero: S-01–S-12, P-01–P-16, X-01–X-14, M-01–M-06, L-01–L-08, C-01–C-10. "M-7" (the tolerance record, a dataset item) is not a rule and "M-07" does not exist; "C-1" (a dataset item) is not rule "C-01". Never cross-reference one series as the other.

- **BCV field names are copied exactly from the dictionary.** No field identifier is invented. A field that exists only in the application is marked `APP` and named in `snake_case` — it is never presented as a BCV field.
- **BCV types:** NUMBER, VARCHAR2(n), DATE — as in the dictionary. App types: `decimal(18,2)` money, `date`, `string`, `integer`, `boolean`, `enum`, `json`.
- **Required vs optional:** `R` = the record/calculation cannot proceed without it (or a documented substitute); `C` = conditionally required (required when a stated condition holds); `O` = optional. "Required" here means required by this spec for the stated purpose, not a BCV load requirement — the two are distinguished wherever they differ.
- **Provenance** names the source document or file each field comes from. Every imported value must also carry a precise location (file + row/cell, PDF page, document section) per §6.
- **Synthetic data only.** All examples use fictional participants (Harborview-style synthetic names are avoided here; examples use participant refs like `P-001`). No live case data, no golden case, no participant-level census rows.
- **This is NOT bet.** Benefit Estimation (a later work product) projects benefits for incomplete cases. This system verifies a recorded accrued benefit. No projection fields appear in the minimal dataset.

---

# PART A — DATA REQUIREMENTS

## A.1 Input formats

| Format | Accepted | Handling rules |
|---|---|---|
| CSV | Yes — census extracts, salary histories, PA benefit schedules, prior valuation extracts | One record per row; header row required; encoding UTF-8 (BOM tolerated, recorded); delimiter auto-detected from `,` / `;` / tab and recorded in the import record; quoted fields per RFC 4180. A row that fails to parse is quarantined with its raw text, never silently dropped (rule S-02). |
| XLSX | Yes — census extracts, salary histories, PA schedules, prior valuation reports | Read with a library that does not execute code. Sheet name, row number, and cell address are the provenance location for every value. Merged cells are unmerged explicitly and the merge is logged. |
| XLSM | Yes, read-only | **Macros are neither executed nor modified.** The file hash (SHA-256) is recorded before and after import and must be identical; any change aborts the import and is logged as a security event. Only cell values and formulas' cached values are read. No VBA project is opened. |
| Structured JSON | Yes — preferred for OCR-pipeline payloads, PA schedule exports, and app-to-app handoff | Validated against the canonical input schema (Stage 2 deliverable; this spec defines the fields it must cover). Unknown fields are retained verbatim in a `_unmapped` bag with provenance, never dropped. JSON is the handoff format for the source-agnostic proposal slot shared with the R5/DEL generators (Copilot or OCR-pipeline JSON proposals). |
| Historical participant extracts | Yes — prior census snapshots, prior valuation populations | Treated as separate CalculationRun snapshots, never merged into the current census without an explicit longitudinal reconciliation (rules L-01–L-08). Each extract carries its own as-of date and source. |
| Prior administrator benefit schedules | Yes — PDF, XLSX, CSV, or JSON | The schedule is a SourceDocument. Each PA_AMB value must be traceable to a schedule row/cell/page. A PA_AMB in the census with no schedule row is flagged (rule C-01). |
| User-entered provisions / exceptions | Yes — plan provisions, documented exceptions, manual corrections | Entered only through the app's provision/exception forms, never by editing an imported file. Each entry requires: the provision text or exception description, the source document + location, the effective dates, and the entering user. A correction never overwrites an original observation; it creates a revision event (§6, §17 of the master prompt). |

### A.1.1 Import invariants (apply to every format)

1. **Immutable sources.** Original imported values are stored separately from normalized or corrected values. A correction creates a new revision; the original is never destroyed.
2. **Provenance on every value.** File name + sheet/row/cell, or document + page/section, or JSON path. A value without provenance is not loadable into a calculation.
3. **No silent defaults.** Missing is missing. No field is defaulted to zero, to DOPT, or to any other value unless a governing rule (cited in the rule) requires it.
4. **Hash and snapshot.** Every imported file is hashed (SHA-256) and snapshotted per CalculationRun so any later result is reproducible from its inputs.
5. **PII handling.** SSN and full names are processed locally only, never leave the machine, and are redacted in exports and reports except where the export is the case package itself. Synthetic data only during development.

## A.2 The 15 entities

Field tables use: **Field** (BCV name exactly, or `APP` name) · **Type** · **Req** (R/C/O) · **BCV table / category** where applicable · **Provenance**.

### A.2.1 Case

Case-level metadata. DOPT and BPD are **not** BCV dictionary fields — there is no DOPT or BPD field in the 1,172-record dictionary. They are app-level case facts, sourced from the case file / R5 header. Do not present them as BCV fields.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `CASE` | VARCHAR2(8), leading zeros kept, text | R | Census file; R5 header; case file. Dictionary: ALL, Input, Data Validation (M) / Valuation Load (M). |
| `APP.dopt` | date | R | Case file / R5 header (Plan Summary Shell header: DOPT). Not a BCV field. |
| `APP.bpd` | date | C (required when a benefit freeze or BPD-dependent provision exists) | Case file / R5 header. Not a BCV field. |
| `APP.planName` | string | R | R5 header / plan documents. |
| `APP.planNumber` | string | R | R5 header / plan documents. |
| `APP.caseActuary`, `APP.auditor` | string | O | R5 header. |
| `APP.employerStatus`, `APP.successorPlan` | string | O | R5 header. |
| `APP.trusteeshipDate` | date | O | Case file. |
| `APP.valuationAsOfDate` | date | C (required for any longitudinal comparison) | Prior valuation report. |

### A.2.2 Plan

Plan characteristics and applicability rules. Sourced from plan documents via the R5 generator output (R5 JSON / filled Plan Summary Shell) where available; otherwise user-entered from plan documents with citations.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.planId` (links to Case) | string | R | R5 output / user entry. |
| `APP.normalRetirementAge` / `APP.normalRetirementDefinition` | string + rule ref | R | Plan document § (R5 provisions). |
| `APP.earlyRetirementRule` | string + rule ref | C (required if any early-retirement factor or ERD benefit is analysed) | Plan document §. |
| `APP.normalFormSingle` / `APP.normalFormMarried` | enum (BCV FORM_CODE values) | R | Plan document; cross-checked against BCV FORM_CODE_NSF / FORM_CODE_NMF (Calculated). |
| `APP.compensationDefinition` | string + rule ref | R | Plan document § (R5 provisions). |
| `APP.serviceDefinitions` (credited / vesting / eligibility) | string + rule refs | R | Plan document §; Ch. 7 (hours vs elapsed time). |
| `APP.vestingSchedule` | structured (schedule type, years, %) | R | Plan document §; Ch. 8. |
| `APP.freezeDate` (see also DOBF) | date | C (required if plan frozen) | Plan document / amendment. |
| `APP.integrationMethod` | enum: none / excess / offset / covered-comp / PIA-offset | C (required if formula is integrated) | Plan document §. |
| `APP.employeeContributionRule` | string + rule ref | C (required if MANDC / VOLC present) | Plan document §. |

### A.2.3 PlanVersion

Effective-dated provisions and amendments. One row per provision version; the provision in force at the measurement date governs (master prompt §5: never apply the latest formula retroactively).

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.versionId` | string | R | App-generated, stable. |
| `APP.effectiveDate` | date | R | Amendment / restatement (adoption date and effective date recorded separately). |
| `APP.adoptionDate` | date | R | Amendment document. |
| `APP.restatementDate` | date | O | Restatement document. |
| `APP.provisionText` | string | R | Plan document / amendment, section cited. |
| `APP.supersedesVersionId` | string (ref) | C (required except for the original version) | App linkage. |
| `APP.grandfatheredGroups` | list of employment-group refs | C (required if grandfathering exists) | Amendment text. |
| `APP.sourceDocumentId` (→ SourceDocument) | string (ref) | R | — |

### A.2.4 Formula

Typed, versioned calculation definitions. The formula taxonomy itself is Stage 1 output 1 (the formula worker's deliverable); this entity records which formula applies to whom and when. No formula is defined here.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.formulaId` | string | R | App-generated; taxonomy ref from Stage 1 output 1. |
| `APP.formulaType` | enum (per taxonomy) | R | Plan document §. |
| `APP.planVersionId` (→ PlanVersion) | string (ref) | R | — |
| `APP.appliesToGroup` | string (employment-group ref or `ALL`) | R | Plan document §. |
| `APP.accrualRate` / `APP.formulaConstants` | decimal / json | C (required for the formula type) | Plan document §. |
| `APP.averagingPeriodYears` | integer | C (required for average-pay formulas) | Plan document §. |
| `APP.maxServiceYears` / `APP.serviceCap` | decimal | C (required if a cap exists) | Plan document §. |
| `APP.roundingRule` | string (rule ref) | R | Plan document §, or "not stated — see §B.5 gap G-6". |
| `APP.sourceCitation` | string | R | Plan document § + page. |

### A.2.5 Participant

Stable identifier and demographic attributes. BCV fields are authoritative; app fields cover only what the dictionary lacks (stable cross-extract key, record linkage).

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `BCV_REC_ID` | NUMBER, system-generated | R | ALL, Data Validation (M) / Valuation Load (M) / System Generated | BCV load. The app's stable key per record. |
| `CASE` | VARCHAR2(8) | R | ALL, Input | Census file. |
| `ID` | VARCHAR2(1): 1 = Participant, 2 = Beneficiary, 4 = Alternate Payee | R | ALL, Input | Census file. Official predicates 1000006 (type 4/S) police validity. |
| `SSN` | VARCHAR2 | R | BCV1, Input | Census file. Dummy-SSN rule per dictionary (official dummy SSN if unknown and ID=1; `000000000` if ID=2 or 4). Never used as the app's stable key across extracts — see `APP.participantKey`. |
| `FNAME`, `MNAME`, `LNAME`, `ENAME` | VARCHAR2 | R (LNAME R; others C) | BCV1, Input | Census file. |
| `DOB` | DATE | R | BCV1, Input | Census file. Official predicates 360–362. |
| `PSEX` | VARCHAR2(1): M / F / U | R | BCV1, Input | Census file. Official predicates 388–390. |
| `MSTAT` | VARCHAR2(1): M / S / D / W / U | C (required for married-form / QPSA analysis) | BCV1, Input | Census file. |
| `PHS` | VARCHAR2(1): 0 = Healthy, 1 = Disabled w/o SS, 2 = Disabled w/ SS | C (required for disability benefits) | BCV1, Input | Census file. Official predicates 239, 242–243. |
| `SOWN` / `SOMOS` | VARCHAR2(1) Y/N; NUMBER months | O | BCV1, Input | Census file. |
| `DOM` | DATE | C (QPSA coverage charge) | BCV1, Input | Census file. |
| `DOD` | DATE | C (required if deceased) | BCV1, Input | Census file. |
| Spouse fields `SSSN`, `SFNAME`, `SMNAME`, `SLNAME`, `SENAME`, `SSEX`, `SDOB`, `SDOD` | as dictionary | C (required for married / survivor analysis) | BCV1, Input | Census file. |
| Beneficiary / AP fields (`BSSN`, `BFNAME`, …, `BDOB`, `APSSN`, `APFNAME`, …, `APDOB`, `APSEX`) | as dictionary | C (required for ID=2 / ID=4 records) | BCV9, Input | Census file. Official predicates 353, 355, 369–374, 391–396, 425–431. |
| `RETSTAT` | VARCHAR2(1): 1 Retired, 2 Separated Vested, 3 Active Vested, 4 Nonvested, 5 Not in valuation population | R | ALL, Input | Census file. Official predicates 282, 333, 335–337, 350–351, 1000007. |
| `RETTYP` | VARCHAR2: NR / ER / DR / DS / LR / SB | C (required for retirees) | BCV3, Calculated | BCV calculation; census may carry PA value — provenance must say which. |
| `APP.participantKey` | string, stable across extracts | R | APP | App-generated from (CASE + SSN + DOB) at first import; linkage across extracts is by this key, never by BCV_REC_ID (which is load-specific). Collisions are quarantined (rule S-05). |
| `APP.recordRole` | enum: participant / beneficiary / alternate-payee | R | APP (derived from ID) | Derived, with the ID=2-on-DOPT rule from the dictionary preserved verbatim. |

### A.2.6 EmploymentPeriod

Hire, termination, rehire, and transfer history. The dictionary carries only a single DOH / DOTE pair per record; multiple periods are app-level structure built from census history, prior extracts, and plan records. Ch. 7 (break in service, rehire, elapsed time) governs the semantics.

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `DOH` | DATE | R | BCV1, Input | Census file. Official predicates 214–220, 246, 259. |
| `DOTE` | DATE | C (required except where the dictionary permits NULL — see M-01) | BCV1, Input | Census file. Official predicates 221–227, 363. |
| `DOP` | DATE (participation) | C (required if participation date differs from hire) | BCV1, Input | Census file / plan records. |
| `DOBF` | DATE (benefit freeze) | C (required if frozen) | BCV1, Input | Census file / plan documents. |
| `DOR` | DATE (actual retirement) | C (required for RETSTAT=1 / pre-DOPT retirees) | BCV3, Input | Census file. Official predicates 247–252, 261, 401–402. |
| `POST_DOPT_DOTE` | DATE | C (ongoing plans, working-retirement issue) | BCV9, Input | Census file. |
| `APP.periodSeq` | integer | R | APP | App-generated per participant, chronological. |
| `APP.periodType` | enum: initial-hire / rehire / transfer-in / transfer-out / leave | R | APP | Census history / plan records / prior extracts. |
| `APP.periodStart`, `APP.periodEnd` | date | R | APP | Derived from DOH/DOTE/rehire records; each period's source cited. |
| `APP.breakInService` | boolean + rule ref | C (required when a gap between periods exists) | APP | Ch. 7 break-in-service rules; plan document §. |
| `APP.hoursPerPeriod` | decimal | C (required for hours-based service plans) | APP | Payroll / plan records. Ch. 7 Q 7:4 (hours) and equivalencies. |

### A.2.7 CompensationHistory

Compensation by applicable measurement period. The dictionary's salary history is BCV2 S001–S050 (S001 = most recent year's salary), bounded by FRSTYEAR / LASTYEAR. There is no per-year date field; year = LASTYEAR − (n−1) for S00n. That derivation must be recorded, not silently assumed (rule S-10).

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `FRSTYEAR` | NUMBER (year) | R | BCV2, Input | Census file. |
| `LASTYEAR` | NUMBER (year) | R | BCV2, Input | Census file. |
| `S001`–`S050` | NUMBER (annual salary, dollars) | C (each year present or explicitly missing; S001 R when LASTYEAR is present) | BCV2, Input | Census file. A blank S-year is missing, never zero (rule P-14). |
| `ANNACT` | VARCHAR2(1): A = Actual, B = Annualized (last year's salary) | C (required when LASTYEAR salary is present) | BCV2, Input | Census file. |
| `SALARYDESC` | VARCHAR2 (source: W-2, Payroll Records, etc.) | R | BCV2, Input | Census file. |
| `CUCOMP` | NUMBER (current monthly compensation) | C (required for active participants) | BCV1, Input | Census file. |
| `PA_ACOMP` | NUMBER (PA average compensation at DOTE) | C (required when PA_AMB is present — it is the PA's own average-pay input) | BCV9, Input | Census file / PA schedule. |
| `APP.salaryYear` | integer | R | APP | Derived: year for each S00n value, recorded explicitly per value. |
| `APP.compensationDefinitionApplied` | string (rule ref) | R | APP | Plan document § (which pay counts). |
| `APP.annualizedFlag` | boolean | C | APP | Derived from ANNACT. |

### A.2.8 ServiceHistory

Eligibility, vesting, and credited service. The dictionary distinguishes PA-reported service (CSPA / VSPA / ESPA, all Input, "at DOTE") from BCV-calculated service (CS / VS / ES, Calculated via add-in functions COMPM, COMPAM, COMPYM, COMPAYM, SERVBA, SERVBW, SERVYCA, SERVYCP, SERVYCW, SERVYPA, SERVYPP, SERVYPW). Both are retained; their difference is itself a diagnostic (rule X-07).

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `CSPA` | NUMBER (PA credited/benefit service at DOTE) | R | BCV1, Input | Census file / PA schedule. |
| `VSPA` | NUMBER (PA vesting service at DOTE) | R | BCV1, Input | Census file / PA schedule. |
| `ESPA` | NUMBER (PA eligibility service at DOTE) | C (required if eligibility service affects the formula) | BCV1, Input | Census file / PA schedule. |
| `CS` | NUMBER (years credited service at DOTE) | C (required for independent calculation; Calculated) | BCV1, Calculated | BCV add-in. Official predicates 276–278 (276 disabled — see §0.5). |
| `VS` | NUMBER (years vesting service at DOTE) | C (required for vesting analysis; Calculated) | BCV1, Calculated | BCV add-in. Official predicates 279–281, 420. |
| `ES` | NUMBER (years eligibility service at DOTE) | C | BCV1, Calculated | BCV add-in. |
| `VPPA` | NUMBER (PA calculated vesting %) | C (required when PA_AMB vesting treatment is in question) | BCV3, Input | Census file / PA schedule. |
| `APP.serviceMeasure` | enum: years / months / hours / elapsed-time | R | APP | Plan document §; Ch. 7. |
| `APP.servicePeriods` | list of (start, end, measure, source) | C (required when service is reconstructed rather than taken from CSPA) | APP | EmploymentPeriod + plan records. |
| `APP.breaksApplied` | list of break-in-service applications | C (required when breaks exist) | APP | Ch. 7; plan document §. |

### A.2.9 BenefitObservation

The reported administrator benefit: amount, basis, and date. This is the central entity of the system. A BenefitObservation without an established measurement date is stored with `measurementBasis = unresolved` — it is never silently assigned DOTE, DOPT, or NRD.

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `PA_AMB` | NUMBER (monthly dollars, assumed 2 dp — see §0.4) | C (required for every participant the PA reported a benefit for; blank = missing, rule P-13) | BCV9, Input | Census file + PA benefit schedule (row/cell). |
| `APP.measurementDate` | date | C (required; if unknown → `APP.measurementBasis = unresolved`) | APP | PA schedule / census DOTE / documented basis. |
| `APP.measurementBasis` | enum: dote / dopt / nrd / other-stated / unresolved | R | APP | Established by rules M-01–M-06. |
| `APP.annuityForm` | enum (BCV FORM_CODE values) | C (required for comparison; if unknown → unresolved basis) | APP | PA schedule / plan document. |
| `APP.vestingTreatment` | enum: gross / vested / unknown | R | APP | PA schedule / VPPA / plan document. Unknown is a valid stored value — it is not defaulted. |
| `APP.recordedDate` | date (when the PA recorded the amount) | C (required when known; distinct from measurement date per §5) | APP | PA schedule / valuation report. |
| `APP.sourceScheduleRow` | string (schedule + row/cell/page) | R | APP | PA benefit schedule. |
| `PA_AMB_ACCEPT` | VARCHAR2(1): Y / N | O (populated only after a determination) | BCV3, Input, New (Release 6.3) | Actuarial decision — must never be set before the determination exists (rule C-09). |
| `APP.observationType` | enum: census / schedule / valuation-report / payment-record | R | APP | Source type. |

### A.2.10 BenefitCalculation

The independently calculated benefit and its trace. Calculation rules belong to the engine (Stage 4); this entity defines what must be stored so a calculation is reproducible and auditable.

| Field | Type | Req | BCV | Provenance |
|---|---|---|---|---|
| `APP.calculationId` | string | R | APP | App-generated. |
| `APP.participantKey` (→ Participant) | string (ref) | R | APP | — |
| `APP.formulaId` + `APP.planVersionId` | string (refs) | R | APP | Formula / PlanVersion in force at the measurement date. |
| `APP.measurementDate` | date | R | APP | Same basis as the BenefitObservation it is compared with; otherwise the comparison is invalid (rule M-05). |
| `APP.calculatedMonthlyBenefit` | decimal(18,2) | R | APP | Engine output. |
| `APP.intermediateSteps` | json (ordered trace: service, compensation, base formula, caps, offsets, rounding) | R | APP | Engine trace (master prompt §8: every intermediate step inspectable). |
| `APP.roundingApplied` | string (rule ref + sequence) | R | APP | Formula.roundingRule. |
| `APP.inputsSnapshotId` (→ CalculationRun) | string (ref) | R | APP | Input snapshot hash. |
| `APP.calculationStatus` | enum: complete / partial / blocked / indeterminate | R | APP | Driven by validation outcomes and the §12 five-way split. |

BCV-calculated benefit fields that may be used as cross-checks (not as the independent calculation itself): `AMB` (BCV1, Calculated, at DOTE), `TERM_MB_ERD_NSF`, `TERM_MB_EURD_NSF`, `TERM_MB_NRD_NSF` (BCV1, Calculated), `XRD_MB_TERM` (BCV1, Calculated). Official predicates 228–237, 306–319, 432 police these fields' presence and range. They are **different bases** from PA_AMB (ERD/EURD/NRD/XRD vs DOTE) and must never be compared to PA_AMB without a basis conversion (rule C-03).

### A.2.11 BenefitComparison

Differences and reconciliation status (master prompt §10). Δᵢ = Bᵢ^PA − B̂ᵢ; Dᵢ = |Δᵢ|; Rᵢ = Δᵢ / B̂ᵢ only when the denominator is meaningful.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.comparisonId` | string | R | App-generated. |
| `APP.observationId` + `APP.calculationId` | string (refs) | R | — |
| `APP.delta` / `APP.absDelta` / `APP.relDelta` | decimal | R (relDelta C — only when B̂ᵢ is non-zero and meaningful; zero/near-zero denominators are flagged, never divided) | Computed. |
| `APP.comparisonBasis` | enum: same-basis / basis-converted / unresolved | R | Established by M-05. `unresolved` comparisons are stored but marked not-comparable. |
| `APP.toleranceApplied` | string (tolerance rule id + $/%) | R | Case tolerance record (§B.0.1). A comparison without a recorded tolerance is incomplete. |
| `APP.withinTolerance` | boolean | R | Computed. |
| `APP.reconciliationStatus` | enum: matched / within-tolerance / material-difference / not-comparable / indeterminate | R | Computed + reviewer-confirmed. |

### A.2.12 DiagnosticHypothesis

Proposed explanation and supporting evidence (master prompt §10). Ranked by evidence and explanatory power, not numerical proximity alone.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.hypothesisId` | string | R | App-generated. |
| `APP.comparisonId` (→ BenefitComparison) | string (ref) | R | — |
| `APP.hypothesisType` | enum: measurement-date / service / compensation / averaging-period / accrual-rate / amendment / grandfather-floor / cap / freeze / integration / distribution / vesting / annuity-form / retirement-date / rounding / missing-information / administrator-error | R | Closed list from §10 — no coined types. |
| `APP.counterfactual` | string (what changes, and the recomputed result) | R | Engine re-run with the stated change. |
| `APP.evidence` | list of (source document + location + quote/paraphrase) | R | SourceDocument refs. A hypothesis with no documentary evidence is labelled `numerical-coincidence`, never `supported`. |
| `APP.rank` / `APP.status` | integer / enum: proposed / tested-supported / tested-rejected / coincidence | R | Reviewer-assessed. |

### A.2.13 SourceDocument

Original document and provenance. Every other entity points here.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.documentId` | string | R | App-generated. |
| `APP.documentType` | enum: plan-document / amendment / restatement / census-file / pa-schedule / valuation-report / payment-record / r5-output / del-output / pf-output / actuarial-memo / policy / guidance / reference-book / other | R | Closed list; `other` requires a description. |
| `APP.title` | string | R | Document itself. |
| `APP.fileHash` | string (SHA-256) | R | Computed at import. |
| `APP.location` | string (Drive path / local path / file id) | R | Import record. |
| `APP.versionDate` / `APP.effectiveDate` | date | C | Document itself. |
| `APP.reliabilityGrade` | enum: high / medium / low / unassessed | R | Assessed per C-10 (internal-controls evidence); default `unassessed`, never defaulted to high. |

### A.2.14 ActuarialDecision

Disposition, rationale, reviewer, and date (master prompt §14). The human decision is the only thing that sets PA_AMB_ACCEPT.

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.decisionId` | string | R | App-generated. |
| `APP.participantKey` | string (ref) | R | — |
| `APP.disposition` | enum: verified / supported-for-acceptance / requires-investigation / correction-recommended / indeterminate | R | §14 proposed states — labelled as application states, not official PBGC classifications. |
| `APP.recordedBenefit` / `APP.calculatedBenefit` / `APP.correctedBenefit` | decimal | R / C / C | BenefitObservation / BenefitCalculation / reviewer entry. |
| `APP.rationale` | string | R | Reviewer-written. |
| `APP.missingEvidence` / `APP.assumptions` / `APP.sensitivity` | string | R | Reviewer-written; empty means "none", stated explicitly. |
| `APP.reviewer` / `APP.decisionDate` | string / date | R | Reviewer identity + date. |
| `PA_AMB_ACCEPT` | VARCHAR2(1) Y/N | C (set only by this decision, rule C-09) | BCV3. |

### A.2.15 CalculationRun

Rule version, input snapshot, and reproducibility metadata (master prompt §6, §17).

| Field | Type | Req | Provenance |
|---|---|---|---|
| `APP.runId` | string | R | App-generated. |
| `APP.ruleVersion` | string (validation-rule catalog version + formula-taxonomy version) | R | This document's version + Stage 1 output 1 version. |
| `APP.inputSnapshotHash` | string (SHA-256 over all input files + mapping) | R | Computed at run start. |
| `APP.runDate` / `APP.runBy` | date / string | R | System + user. |
| `APP.participantScope` | string (all / subset definition) | R | User selection, recorded. |
| `APP.resultsHash` | string | R | Computed at run end. |

## A.3 Minimal vs comprehensive datasets

### A.3.1 Minimal dataset — the smallest input that supports any PA_AMB decision

"Minimal" means: without any of these, no participant-level verification is possible at all. A case that fails the minimal set is graded **Insufficient** (§A.5) and the only available dispositions are `requires-investigation` or `indeterminate`.

| # | Item | Source |
|---|---|---|
| M-1 | Case identity (CASE) + DOPT + plan name/number | Case file / R5 header |
| M-2 | Census file with, per participant: BCV_REC_ID, ID, SSN, LNAME, DOB, PSEX, RETSTAT, DOH, DOTE (or documented NULL), DOBF if frozen | Census (BCV1/ALL) |
| M-3 | PA_AMB per participant (or an explicit statement that the PA reported no benefit for that participant — a blank with no statement is missing, not zero) | Census BCV9 + PA schedule |
| M-4 | PA service at DOTE: CSPA, VSPA | Census BCV1 |
| M-5 | The governing plan provisions in force at DOTE: formula type, accrual rate, compensation definition, averaging period, vesting schedule, normal forms | Plan documents (R5 output where available) |
| M-6 | Measurement-date evidence for PA_AMB: the PA schedule page/section stating the date the amounts were calculated through, or a documented DOTE basis | PA schedule |
| M-7 | The tolerance record for this case: the $/ % tolerance adopted, its authority, and who approved it (§B.0.1) | Case decision record |
| M-8 | Salary history sufficient to compute the plan's average compensation (S001–S050 + FRSTYEAR/LASTYEAR, or PA_ACOMP with its own provenance) | Census BCV2 / PA schedule |

### A.3.2 Comprehensive dataset — minimal plus everything needed for exact reconstruction

| # | Item | Source |
|---|---|---|
| C-1 | All minimal items | — |
| C-2 | Full employment history: all periods, rehires, transfers, leaves, breaks in service, hours | Census history / plan records / prior extracts |
| C-3 | Full salary history with no gaps across the averaging period + FRSTYEAR/LASTYEAR + ANNACT + SALARYDESC | Census BCV2 |
| C-4 | PA_ACOMP, PIA, VPPA, PA_QPSAF | Census BCV9/BCV1/BCV3 |
| C-5 | Complete PlanVersion chain: adoption, all restatements and amendments with adoption + effective dates, grandfathering | Plan documents |
| C-6 | Prior valuation reports (with XRD_MB_TERM, TERM_MB_*_NSF, LS_TERM, PVMB_* for cross-source checks) | Valuation reports |
| C-7 | PA benefit calculation schedules (participant-level arithmetic, not just the final PA_AMB) | PA schedules |
| C-8 | Payment records: PAY_AMT1/PAY_AMT2 with begin/end dates, LS_EST_AMT/DATE, PARTIAL_DIST_AMT/DATE | Census BCV3 / payment records |
| C-9 | Prior distributions and offsets (Ch. 16 Q 16:7 — especially for rehires) | PA records |
| C-10 | QDRO records where applicable (ID=4, AP fields, QDRO_TYPE) | Census BCV9 / QDRO |
| C-11 | Employee contributions: MANDC, MANDCWI, VOLC, VOLCWI, PVRETEEC | Census BCV1/BCV4 |
| C-12 | All non-census inputs of §A.4 | See §A.4 |
| C-13 | Prior census snapshots for longitudinal reconciliation | Historical extracts |
| C-14 | R5, DEL, PF, and §436 outputs for the same case where they exist (provisions, Input-field universe, factors, restrictions) | R5/DEL/PF/436 generators |

## A.4 Non-census inputs

These are plan-wide or reference inputs the census does not contain. Each is a first-class input with its own provenance and effective dates; none is embedded as a magic number.

| Input | Content | Provenance / authority | Status |
|---|---|---|---|
| Covered compensation tables | Year-by-year covered compensation by year of birth (for integrated / permitted-disparity formulas) | Social Security Administration tables, as incorporated in the plan document. The plan document's table (or its incorporation by reference) governs. | NOT YET SOURCED — no covered-compensation table was found in the Book of Job material reviewed. Gap G-3. |
| Social Security assumptions | PIA basis, bend points, wage-index assumptions used by the PA; PIA itself is a census Input (BCV1 PIA, "from Plan Administrator") | PA schedule / plan document. SSA bend points are reference data, not BCV fields. | PARTIAL — PIA field exists; bend-point tables not yet sourced. Gap G-3. |
| Plan-wide salary definitions | Which pay counts (base, bonus, overtime, commissions), compensation caps, annualization rules | Plan document §; R5 provisions. | Sourced per case from plan documents. |
| Formula constants | Accrual rates, tier thresholds, step rates, maximum service, grandfathered floors | Plan document §; Formula entity. | Sourced per case from plan documents. |
| Historical statutory limits | IRC §401(a)(17) compensation limit by year; IRC §415(b) maximum benefit by year; OBRA '93 frozen limits | IRS-published limits (statute/regulation, hierarchy level 1). The Answer Book Ch. 9 discusses these limits (Qs on §415 decreases and §401(a)(17) frozen benefits) but contains no limits table. | NOT YET SOURCED — no limits table found in reviewed material. Values must come from IRS publications, never invented. Gap G-4. |
| Prior annuity conversion assumptions | Early/late retirement factors, benefit conversion factors by era (ERF/LRF/BFCF), mortality and interest bases | PF generator output for the case; plan documents; BCV add-in functions ERFAEQ / LRFAEQ / BFCFAEQ. | Sourced per case from PF output / plan documents. |
| Historical valuation data | Prior valuation reports: liabilities, XRD_MB_TERM, TERM_MB_*_NSF, LS_TERM, PVMB_TITLE_IV / PVMB_4022C / PVMB_TERM, assumptions | Prior valuation reports (SourceDocument type `valuation-report`). | Sourced per case. |
| Mortality tables for equivalence | Table names/codes used in conversions (e.g. GM83, GF83, UP84 — confirmed in BCV_ATPBGC_Add-ins.pdf; UP84M2 confirmed in a second PBGC source) | Add-in doc; plan document. | Codes must come from a PBGC source; never coined (standing rule). |

## A.5 Data-completeness grades

Grades are assigned **per participant** (for exact reconstruction) and **per case** (for the population). A grade is a property of the evidence, not of the participant.

| Grade | Definition (per participant) | Consequence |
|---|---|---|
| **Complete** | Every field required for exact reconstruction under the governing PlanVersion is present, valid, and provenance-traced; the measurement basis is established; the formula's inputs are all present. | Exact reconstruction is possible. Dispositions `verified`, `correction-recommended` available. |
| **Partial** | At least one required input is missing, but the missing input falls in §A.6 classes (b), (c), or (d) — recoverable, boundable, or assumable — and the resulting uncertainty is quantified (bounds Bᵢ^min ≤ Bᵢ^possible ≤ Bᵢ^max). | Reconstruction as a range or under stated assumptions. Dispositions `supported-for-acceptance` (if the PA_AMB lies inside justified bounds and evidence supports it) or `requires-investigation`. |
| **Insufficient** | At least one required input is missing and falls in class (e) — reconstruction indeterminate — or the measurement basis is unresolved, or the governing formula cannot be identified. | No exact reconstruction and no defensible bounds. Only `requires-investigation` or `indeterminate`. A PA_AMB is never accepted on an Insufficient record. |

Case grade: the case is **Complete** only if every in-scope participant is Complete; **Partial** if any participant is Partial and none is Insufficient; **Insufficient** if any in-scope participant is Insufficient. In-scope = RETSTAT 1–4 (valuation population); RETSTAT 5 records are out of scope and graded separately as `excluded`.

## A.6 Five-way missing-data split (§12)

Every missing input is classified into exactly one class at import. The class determines what the system may do with the gap.

| Class | Meaning | What the system may do | Example |
|---|---|---|---|
| (a) **Required for exact reconstruction** | The input is needed and is present nowhere in the case file | Mark the participant Partial or Insufficient; request the data; no reconstruction past the gap | Missing averaging-period salary years with no PA_ACOMP and no schedule |
| (b) **Recoverable from other documents** | The input exists in another source in the case file | Recover it, record both provenances, and re-grade; the recovery is itself auditable | CSPA missing in census but stated on the PA benefit schedule |
| (c) **Reasonable bounds establishable** | The input is missing but a mathematically justified lower/upper bound exists under explicit assumptions | Compute Bᵢ^min / Bᵢ^max; evaluate PA_AMB against the feasible range; state the bounding assumptions | Missing one salary year bounded by adjacent years and the §401(a)(17) cap for that year |
| (d) **Requires assumptions** | The input is missing and only an actuarial assumption can fill it | Fill only with a documented, reviewer-approved assumption; the result is an estimate, labelled as such; sensitivity shown | Missing PIA for an integrated formula — assume from SSA bend points, flagged |
| (e) **Makes reconstruction indeterminate** | The input is missing and no bound or defensible assumption exists | Participant is Insufficient; no calculated benefit is produced; disposition `indeterminate` unless other evidence supports acceptance | Governing formula unidentifiable (no plan document for the era) or measurement basis unresolved with no DOTE |

Rules: a missing input is never silently treated as zero (class (a)–(e) all forbid it); a class-(d) assumption is never presented as a fact; a class-(c) bound is a justified bound under stated assumptions, not a confidence interval relabelled.

## A.7 Disposition reachability — grades and measurement basis decide what can be concluded

This matrix is the enforcement of §0.6. A disposition outside the reachable set for a participant's grade and measurement-basis state **must not be recorded**, and the app must refuse it with the reason shown. The human reviewer decides within the reachable set; the system never widens it.

| Completeness grade (§A.5) | Measurement basis (§B.4) | Reachable dispositions (§14) | What the system produces |
|---|---|---|---|
| Complete | Established (DOTE, or other stated basis with evidence) | Verified · Supported for acceptance · Requires investigation · Correction recommended | Exact reconstructed benefit B̂ᵢ + comparison Δᵢ against the case tolerance |
| Partial (classes b/c/d only) | Established | Supported for acceptance · Requires investigation · Correction recommended | Justified bounds Bᵢ^min / Bᵢ^max and/or assumption-based estimate, labelled as such; PA_AMB evaluated against the feasible range; sensitivity shown |
| Partial (classes b/c/d only) | Unresolved | Requires investigation · Indeterminate | Bounds only if the basis uncertainty itself can be bounded (e.g. benefit recomputed at each candidate date as scenarios); otherwise no calculated benefit, only the documented gap |
| Insufficient (any class-e gap) | Established or unresolved | Requires investigation · Indeterminate | No calculated benefit. Documented evidence list, missing-evidence list, prioritised data request (§12: prioritise by expected effect on the decision) |
| Complete or Partial | Unresolved **and** the PA_AMB is the only benefit evidence | Requires investigation · Indeterminate | No comparison is valid — a comparison requires equivalent bases (§3 of the master prompt). The record is held, not compared. |
| Any grade | RETSTAT = 5 (not in valuation population) | (Out of scope — no disposition) | Excluded from the population; graded separately as `excluded`, with the reason recorded |

Notes:

- `Verified` requires Complete + established basis + agreement within the documented case tolerance. Nothing less can be Verified.
- `Supported for acceptance` is the Partial-grade acceptance path: the evidence supports accepting the PA_AMB even though exact reconstruction is impossible — e.g. PA_AMB lies inside justified bounds and every material discrepancy has a documented explanation. It is a positive, evidence-based decision, not a default.
- `Correction recommended` requires sufficient evidence for a specific corrected benefit. On a Partial record that means the bounds collapse to a single defensible value under stated assumptions; on an Insufficient record it is unreachable.
- `Requires investigation` vs `Indeterminate`: investigation means a concrete next step exists (a document to request, a hypothesis to test); indeterminate means the evidence as it stands cannot support a conclusion and no further step is currently identified. The reviewer chooses; the system records which and why.
- The matrix is enforced at the ActuarialDecision entity (§A.2.14): an out-of-reach disposition is rejected at entry, not corrected after the fact.

---

# PART B — VALIDATION SPECIFICATION

## B.0 How to read the rule catalog

Every rule carries all eight items: **rule ID · source · fields examined · actual vs expected · severity · observed discrepancy (what is recorded) · recommended investigation · blocks calculation**.

### B.0.1 Tolerances — Policy 5.8-1 and the reconciliation tolerance are different things

PBGC Operating Policy 5.8-1 Benefit Corrections (issue date 10/02/2014; text also in `current-policies.txt` §5.8-1) states:

- PBGC must be **reasonably certain** that a benefit or payment error has occurred before a benefit or payment is changed.
- Errors must be corrected, except for certain de minimis errors, cost-benefit exceptions, and previously-identified uncorrected errors.
- **$1.00 tolerance** for errors **decreasing** benefits discovered when changing estimated benefits to final benefits (issuing benefit determinations); increases are made regardless of amount.
- After a benefit determination becomes effective: **$1.00 tolerance** for errors **increasing** benefits; **$5.00 tolerance** remains for errors **decreasing** benefits.
- PBGC applies the tolerance rules of Policy 5.8-1 to the determination of **pre-termination liabilities**.

**What this means for this system, and what it does not:**

1. Policy 5.8-1 governs **correcting PBGC benefit determinations and payments**. It does **not** govern whether a prior administrator's reported PA_AMB is accepted. Do not import its $1.00/$5.00 figures as the PA_AMB reconciliation tolerance.
2. The PA_AMB reconciliation tolerance is **configurable and documented per case** (master prompt §10: "Do not impose an arbitrary universal dollar or percentage tolerance"). Each case records: the tolerance value(s), whether it is absolute, relative, or both, its authority (case decision, not Policy 5.8-1 unless the case actuary explicitly adopts it), and who approved it (minimal dataset item M-7).
3. Policy 5.8-1 **is** relevant downstream: once a corrected benefit is determined, the question whether the correction is applied follows 5.8-1. The system records the 5.8-1 figures as reference data so the reviewer can see both tolerances side by side — but they are stored in separate fields and never conflated.
4. The "reasonably certain" standard **does** carry over as a decision principle: a `correction-recommended` disposition requires the reviewer to be reasonably certain an error occurred (rule C-08, §B.7). A numerical difference alone, without evidence, is not reasonable certainty.

**Flagged, not resolved:** the current-policies text and the standalone Benefit_Corrections.pdf are the same 2014 edition. Whether a newer edition of Policy 5.8-1 exists was not verified in this stage (gap G-7). The case actuary must confirm the current edition before relying on the figures above.

### B.0.2 Validation-result record (every finding, every rule)

| Field | Content |
|---|---|
| `ruleId` | e.g. `S-01`, `P-13`, `M-02` (this spec) or `BCV-214` (adopted official predicate) |
| `ruleSource` | OFFICIAL (BCV predicate ID) or APP (this spec, with the grounding source cited) |
| `fieldsExamined` | BCV field names exactly as in the dictionary |
| `actual` / `expected` | Observed value(s) vs the condition the rule requires |
| `severity` | Critical / Error / Warning / Info (§B.0.3) |
| `discrepancy` | The observed discrepancy, recorded verbatim (values, dates, counts) |
| `investigation` | Recommended investigation (what to check, in which document) |
| `blocksCalculation` | Yes / Exact-only / No (§B.0.3) |
| `participantKey`, `runId`, `recordedDate` | Linkage and audit |
| `dispositionRoute` | Where the participant goes if blocked (§B.7) — never blank when `blocksCalculation` ≠ No |

A validation finding is never deleted. A finding resolved by a correction or a recovery is marked `resolved` with the resolution evidence linked; the original finding remains in the audit log.

### B.0.3 Severity and blocking

| Severity | Meaning | Blocks calculation |
|---|---|---|
| **Critical** | The record cannot be loaded or compared as it stands (identity, population membership, or measurement basis is indeterminate) | **Yes** — no calculation of any kind for this participant; routes to a documented disposition (§B.7) |
| **Error** | The exact calculation cannot proceed for this participant | **Exact-only** — exact reconstruction blocked; bounds/scenario path may proceed if the missing input is class (c) or (d) |
| **Warning** | The calculation proceeds, but the finding must be reviewed before any acceptance disposition | **No** |
| **Info** | Recorded for audit; no action required | **No** |

Official predicates: BCV type 4 = Critical (per the report SQL, type 4 decodes to critical error). BCV types 1–3 have no legend in the workbook, so adopted official predicates keep their BCV type and receive the app severity shown in the adoption table (§B.0.4). Where an adopted predicate's app severity differs from a naive reading, the reason is stated.

### B.0.4 Official BCV predicates adopted by this spec

The predicates workbook has 249 predicates; 235 are enabled. This spec adopts the subset that touches fields the PA_AMB analysis depends on. Adoption means: the predicate's condition is implemented as a rule in this catalog (cross-referenced by BCV ID), with the app severity assigned below. **Adoption does not mean the predicate validates PA_AMB** — no predicate does (§0.5). Predicates outside the adopted set are out of scope for this system (they police BCV load/valuation fields such as XRD_MB_TERM, PVMB_*, TERM_SURV_MB_*); the full workbook remains the reference for BCV load validation.

| BCV predicate IDs | Subject | App severity | Adopted as |
|---|---|---|---|
| 200, 266, 274 | FORM_CODE / FORM_CODE_NSF validity and presence | Error | X-11 |
| 201–203, 267–269 | ARD / expected form vs plan normal forms and PBGC optional forms | Warning | X-11 |
| 209–213, 264–265, 270–273, 320–331, 375–380, 385–387 | Survivor % / months-certain validity and form consistency | Error (range) / Warning (consistency) | X-11 |
| 214–220, 246, 259 | DOH missing / invalid / chronology | Error (214, 216–220); Warning (215, 246, 259) | P-03 |
| 221–227, 363 | DOTE missing / invalid / chronology | Error (221, 223–226); Warning (222, 227, 363) | P-04, M-01 |
| 247–252, 261 | DOR missing / invalid / chronology | Error (249–252); Warning (247–248, 261) | P-05 |
| 276–281, 420 | CS / VS missing / invalid / range (276 is ENABLE_FL=N — adopted as APP rule P-06 with the reason noted) | Error | P-06 |
| 282, 333, 416 | RETSTAT vs MANDCWI / employee contributions | Warning | X-03 |
| 283–286 | ANB / SANB missing / range | Error | P-07 |
| 304–305 | NRD missing / invalid | Error | P-08 |
| 308 | RBD cannot be determined (missing/bad DOB, DOD, DOPT, DOTE, ID, NON_SPOUSE_BENF, RETSTAT) | Error | P-09 |
| 350–351 | RETSTAT vs DOTE / RBD inconsistency | Warning (350); Error (351) | X-02 |
| 353, 355, 369–374, 391–396, 425–431 | Beneficiary / AP identity fields | Error (missing); Warning (unknown sex) | P-10 |
| 360–362 | DOB missing / invalid / on-or-after DOPT | Error | P-02 |
| 388–390 | PSEX unknown / missing / invalid | Warning (388); Error (389–390) | P-11 |
| 434 | Critical valuation fields not populated (FORM_CODE, LS_TERM, XRD, XRD_MB_TERM) | Error | X-12 (cross-source scope only) |
| 1000005–1000007 | Missing CASE_CUST_ID; record type / record status invalid (system-level, ENABLE_FL=S) | Critical | S-04, S-05 |

Not adopted, with reason: predicates 228–237, 306–319, 404–412, 417–419, 432–433, 436–448 (XRD_MB_TERM, TERM_MB_*, XRD_MB_TITLE_IV/4022C/QPSA, LS_TERM ranges) police BCV-calculated valuation outputs. They are **reference data** for cross-source checks (rule C-03), not validation rules of this system, because this system does not calculate XRD benefits. Predicates 253–258 (CE_TRACK1–6) and 287–303, 334–349, 352–359, 364–368, 381–384, 397–403, 405–415, 421–424, 449–452 concern BCV load mechanics (earliest retirement dates, supplements, offsets, lump sums, QPSA values) outside the PA_AMB verification scope; they are listed here so a later stage can adopt them deliberately rather than discover them by accident.

## B.1 Structural validation (S-01–S-12)

Structural rules run at import, before any participant-level rule. A structural Critical failure quarantines the affected records; the rest of the file still loads.

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| S-01 | APP (master prompt §7 structural) | (file) | Actual: file unreadable, truncated, or hash mismatch. Expected: file opens, hash matches the import record | Critical | File name, error, byte count if known | Re-obtain the file from the source; check transfer / storage | Yes |
| S-02 | APP (§7 structural; §A.1.1) | (row) | Actual: row fails to parse. Expected: every row parses or is quarantined with raw text | Error | Raw row text, line number, parse error | Inspect the source row; fix the extract, never hand-edit the quarantined row into the data | Exact-only (that row) |
| S-03 | APP (§7 structural) | Field names | Actual: header/field name not in the dictionary (for census fields) or not in the canonical schema (for JSON). Expected: every field name resolves to a dictionary field or a declared app field | Warning | Unknown name, file, location | Confirm whether it is a PA-specific column (map it as `_unmapped` with provenance) or a typo (confirm with the source) | No |
| S-04 | OFFICIAL BCV-1000007 (type 4/S) | RETSTAT | Actual: RETSTAT blank or not in {1,2,3,4,5}. Expected: one of 1–5 | Critical | Value found, participantKey | Check the census extract; a record with no status cannot be placed in or out of the valuation population | Yes |
| S-05 | OFFICIAL BCV-1000006 (type 4/S); APP for key collision | ID; APP.participantKey | Actual: ID blank or not in {1,2,4}; or two records share one APP.participantKey. Expected: ID ∈ {1,2,4}; participantKey unique | Critical | Value(s) found, colliding keys | Verify record type against the DOPT-death rule in the dictionary (ID=2 vs 1); resolve key collisions by identity review, never by deleting a record | Yes |
| S-06 | APP (§7 structural) | CASE | Actual: CASE blank, wrong length, or inconsistent within one file. Expected: 8 characters, leading zeros kept, text type (never numeric — leading zeros must survive import) | Error | Value found, file | Re-import with CASE forced to text; confirm the case number against the case file | Exact-only |
| S-07 | APP (§7 structural) | (all DATE fields) | Actual: date unparseable, or in a non-ISO format with ambiguous day/month. Expected: valid calendar date, stored ISO-8601 | Error | Raw value, field, participantKey | Confirm the source format (US MM/DD/YYYY vs ISO) from the file's own evidence; ambiguous dates are quarantined, never guessed | Exact-only |
| S-08 | APP (§7 structural) | (all NUMBER fields) | Actual: non-numeric text in a NUMBER field, or a number with the wrong sign/scale (e.g. PA_AMB in cents). Expected: numeric, in the dictionary's units | Error | Raw value, field, participantKey | Check the source's units (dollars vs cents, years vs months — notably CS/VS are years; S001–S050 are annual dollars); confirm against the PA schedule | Exact-only |
| S-09 | APP (§0.4: units assumption) | PA_AMB, PA_ACOMP, CUCOMP | Actual: value scale inconsistent with monthly dollars (e.g. PA_AMB > $25,000/month — the same plausibility bound official predicates 231/310/314/318 use for monthly benefits — with no supporting evidence). Expected: monthly dollars, 2 dp | Warning | Value, field, participantKey | Confirm units and decimals against the PA schedule; do not rescale on assumption | No |
| S-10 | APP (§A.2.7: S001 year derivation) | FRSTYEAR, LASTYEAR, S001–S050 | Actual: LASTYEAR − FRSTYEAR + 1 ≠ count of populated S-years, or S001 year cannot be derived. Expected: S00n maps to year LASTYEAR − (n−1), and the populated span matches FRSTYEAR–LASTYEAR | Error | FRSTYEAR, LASTYEAR, populated S-years | Reconcile against the census extract; a gap inside the span is missing data (rule P-14), a span mismatch is a structural error | Exact-only |
| S-11 | APP (§A.1.1: XLSM rule) | (file) | Actual: XLSM hash differs before vs after import, or a macro ran. Expected: hash identical; macros neither executed nor modified | Critical | Hashes, file name | Abort the import; investigate how the file was opened; re-import read-only | Yes (file) |
| S-12 | APP (§6 immutable sources) | (all fields) | Actual: an imported value has no provenance (no file/row/cell or document/page). Expected: every value carries provenance | Error | Field, participantKey, import batch | Reject the batch or attach provenance from the import record; a value without provenance is not loadable into a calculation | Exact-only |

## B.2 Participant-level validation (P-01–P-16)

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| P-01 | APP (§7 participant-level; Ch. 16 Q 16:2) | BCV_REC_ID, APP.participantKey | Actual: duplicate BCV_REC_ID within one load, or one participantKey with two different SSN/DOB pairs. Expected: one record per participant per load; identity stable | Error | Duplicated IDs/keys, values | Possible duplicate participants (see also L-02): compare names, DOB, DOH, DOTE across the duplicates; merge only on documented identity evidence, never on name alone | Exact-only |
| P-02 | OFFICIAL BCV-360–362 (type 3) | DOB | Actual: DOB blank (360); before 1/1/1900 (361); on/after DOPT (362). Expected: populated, ≥ 1/1/1900, < DOPT | Error | DOB value, DOPT | Ch. 16 Q 16:2/Q 16:5 — DOB errors are the highest-impact census errors (e.g. transposed year digits 1937→1973). Verify against the plan's enrollment/employment records | Exact-only |
| P-03 | OFFICIAL BCV-214–220, 246, 259 (type 1/2/3) | DOH, DOB, DOTE, DOD, DOR | Actual: DOH blank (214); before 1/1/1930 (215) or 1/1/1800 (246); before DOB (216); after DOTE (217); on/after DOPT (218); after DOD (219); after DOR (220); after current date (259). Expected: DOB ≤ DOH ≤ min(DOTE, DOR, DOD, DOPT) | Error (214, 216–220); Warning (215, 246, 259) | Values of all dates involved | Verify against employment records; a DOH after DOTE usually means a rehire was recorded as the hire date (see EmploymentPeriod) | Exact-only |
| P-04 | OFFICIAL BCV-221–227, 363 (type 2/3) | DOTE, DOB, DOD, DOR | Actual: DOTE blank (221 — see M-01 for the measurement-date consequence); before 1/1/1930 (222); before DOB (223); on/after DOPT (224 — see note); before DOPT (225 — see note); after DOD (226); after DOR (227); later than today (363). Expected: DOB ≤ DOTE, DOTE ≤ DOD, DOTE ≤ DOR where applicable | Error (221, 223–226); Warning (222, 227, 363) | DOTE value, related dates | NOTE — predicates 224 and 225 appear contradictory (DOTE on/after DOPT vs DOTE before DOPT); both are type 3 and both are recorded here as written in the workbook. FLAGGED CONFLICT: the two predicates cannot both be errors for the same record; Stage 2 must determine which applies by RETSTAT/population before implementing. Do not silently pick one. For actives (RETSTAT=3) DOTE is legitimately blank or after DOPT. | Exact-only |
| P-05 | OFFICIAL BCV-247–252, 261 (type 2/3) | DOR, SBCD, FORM_CODE_ARD | Actual: DOR before 1/1/1930 (247); after current date + 4 months (248); missing for a pre-DOPT retiree (249); on/after DOPT for a pre-DOPT retiree (250); before DOPT for a deferred record (251); FORM_CODE_ARD populated but DOR blank for a deferred record (252); SBCD populated but DOR missing (261). Expected: DOR consistent with RETSTAT and pay status | Error (249–252); Warning (247–248, 261) | DOR, RETSTAT, related fields | Verify retirement date against payment records and the PA schedule; a DOR before DOPT for a deferred record usually means the record is a retiree misclassified | Exact-only |
| P-06 | OFFICIAL BCV-277–281, 420 (type 2/3); APP restatement of disabled BCV-276 (ENABLE_FL=N) | CS, VS | Actual: CS blank (276 — disabled in BCV; re-stated here as APP because credited service is required for reconstruction); CS not in years (277); CS×12 outside 0–999 (278); VS blank (279); VS not in years (280); VS×12 outside 0–999 (281); VS = 0 (420). Expected: populated, in years, 0 ≤ service ≤ 83.25 years (999 months) | Error | CS/VS values | Compare with CSPA/VSPA (rule X-07); verify service against EmploymentPeriod and plan records; VS=0 with a positive PA_AMB is a vesting question (rule X-09), not automatically an error | Exact-only |
| P-07 | OFFICIAL BCV-283–286 (type 3) | ANB, SANB | Actual: ANB blank (283) or outside 0–999 (284); SANB blank (285) or outside 0–999 (286). Expected: populated, 0–999 | Error | ANB/SANB values | Recompute age nearest birthday at DOPT from DOB; a mismatch points to a DOB error (rule P-02) | Exact-only |
| P-08 | OFFICIAL BCV-304–305 (type 3) | NRD | Actual: NRD not later than 1/1/1800 (304); NRD blank (305). Expected: populated, > 1/1/1800 | Error | NRD value | NRD is Calculated (RETDATE) — a blank NRD means the BCV calculation did not run or lacked inputs; check DOB and plan normal-retirement definition | Exact-only |
| P-09 | OFFICIAL BCV-308 (type 3) | DOB, DOD, DOPT, DOTE, ID, NON_SPOUSE_BENF, RETSTAT | Actual: required begin date cannot be determined because one of these is missing or bad. Expected: RBD determinable | Error | Which field(s) missing/bad | Fix the underlying field(s) via their own rules; RBD failure is a symptom, not a root cause — never "fix" it by inventing a date | Exact-only |
| P-10 | OFFICIAL BCV-353, 355, 369–374, 391–396, 425–431 (type 2/3) | BSSN, SSSN, BLNAME, SLNAME, BDOB, SDOB, APDOB, BSEX, SSEX, APSEX, BDOD, SDOD, APDOD | Actual: beneficiary/AP identity fields missing or invalid for ID=2/4 records; DOB before 1/1/1900 or after DOPT; death on/before birth; death populated but birth blank. Expected: complete, chronologically consistent beneficiary/AP identity | Error (missing/invalid); Warning (unknown sex) | Fields and values | Verify against the QDRO / beneficiary designation / death records; an ID=2 record without a beneficiary DOB cannot produce a survivor benefit | Exact-only |
| P-11 | OFFICIAL BCV-388–390 (type 2/3) | PSEX | Actual: PSEX unknown (388); blank (389); invalid (390). Expected: M or F (U is permitted by the dictionary but is a Warning — see note) | Warning (U); Error (blank/invalid) | PSEX value | NOTE: the dictionary permits U (Unknown) and the add-in mortality for equivalence is unisex per Ch. 16 Q 16:11 (Arizona v. Norris), so U does not block a calculation — but it blocks any sex-dependent PA factor check and must be resolved from plan records. | No (U); Exact-only (blank/invalid) |
| P-12 | APP (§7 participant-level: eligibility) | DOP, DOH, APP.serviceMeasure | Actual: DOP before DOH; participation before eligibility is met under the plan's rules; credited service accrues before DOP. Expected: DOH ≤ DOP ≤ accrual start; service consistent with the plan's eligibility rule | Warning | DOP, DOH, service values | Check the plan's eligibility provision (R5) and Ch. 7 (eligibility / participation); pre-participation service is usually a plan-records question | No |
| P-13 | APP (§7; §0.4; master prompt §7 "Do not replace missing input data with zero") | PA_AMB | Actual: PA_AMB blank. Expected: a populated amount, OR an explicit documented statement that the PA reported no benefit for this participant. A blank with no statement is missing data. | Error | ParticipantKey, RETSTAT, CSPA | **Blank = missing, never zero.** Classify per §A.6: (a) if the PA should have reported one (RETSTAT 1–3, CSPA > 0); (b) recoverable if the PA schedule states the amount; (e) if no source states any benefit and none can be reconstructed. A blank PA_AMB for a RETSTAT=4 (nonvested) participant with VSPA below the vesting threshold may be a legitimate zero benefit — but that is a documented determination (rule X-09), not a default. | Exact-only |
| P-14 | APP (§7 participant-level: missing compensation; Ch. 16 Q 16:7 salary history) | S001–S050, FRSTYEAR, LASTYEAR, PA_ACOMP | Actual: a salary year inside FRSTYEAR–LASTYEAR is blank; or all salary years are blank while the formula needs average pay; or ANNACT = B (annualized) with no note of the annualization basis. Expected: every year in the averaging period populated, or its absence classified per §A.6 | Error (averaging-period gap); Warning (gap outside the averaging period) | Missing years, averaging period, PA_ACOMP presence | Recover from payroll/W-2 records (class b) or bound it (class c — adjacent years and the §401(a)(17) cap for that year); PA_ACOMP may substitute only if its own provenance and averaging period are documented | Exact-only (averaging-period gap) |
| P-15 | APP (§7 participant-level: service limits; Ch. 7/8) | CSPA, VSPA, ESPA, DOH, DOTE | Actual: CSPA exceeds elapsed time DOH→DOTE (allowing the plan's service-credit rule, e.g. past-service credit); VSPA > CSPA by more than the plan's rules allow; ESPA > elapsed time. Expected: each service measure ≤ elapsed time + documented credits | Warning | Service values, elapsed time, credits | Verify against plan records; past-service credits and special credits must be documented (plan document §), not assumed — an undocumented excess is a diagnostic hypothesis (service), not a correction | No |
| P-16 | APP (§7 participant-level: duplicates; Ch. 16 Q 16:2 reconciliation) | SSN, DOB, FNAME, LNAME, DOH | Actual: two records share SSN but differ in DOB/name, or share (name + DOB) but differ in SSN. Expected: one person, one record (plus separate ID=2/4 records linked by family, not duplicated as participants) | Error | The conflicting records and fields | Identity review against employment records; possible causes: SSN typo, remarriage name change, or a genuine duplicate. Merge only on documented identity evidence. | Exact-only |

## B.3 Cross-field validation (X-01–X-14)

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| X-01 | APP (§7 cross-field: status vs benefit) | RETSTAT, PA_AMB | Actual: RETSTAT=5 (not in valuation population) with a populated PA_AMB; or RETSTAT=1–4 with PA_AMB blank and no statement (see P-13). Expected: RETSTAT=5 → no PA_AMB in the valuation population; RETSTAT 1–4 → PA_AMB present or explicitly stated absent | Error | RETSTAT, PA_AMB | RETSTAT=5 with a benefit usually means the record belongs in the population (status error) or the benefit belongs to a different record; check the census extract and the PA schedule | Exact-only |
| X-02 | OFFICIAL BCV-350 (type 2), BCV-351 (type 4) | DOTE, RETSTAT, DOB, DOD | Actual: RETSTAT inconsistent with DOTE (350); RBD on/before DOPT but RETSTAT ≠ 1 (351). Expected: RETSTAT=1 → in pay at DOPT; RETSTAT=2 → separated, DOTE < DOPT; RETSTAT=3 → active, DOTE blank or ≥ DOPT; RETSTAT=4 → nonvested | Warning (350); Error (351) | RETSTAT, DOTE, RBD | Verify employment status against plan records; status errors cascade into every benefit comparison, so fix status before calculating | No (350); Exact-only (351) |
| X-03 | OFFICIAL BCV-282 (type 3), BCV-333/416 (type 4/7) | MANDCWI, RETSTAT, PVRETEEC | Actual: record status inconsistent with mandatory-contribution balance at DOPT; participant not fully vested in employee contributions. Expected: participants are always fully vested in their own contributions; RETSTAT consistent with MANDCWI > 0 | Warning (282); Error (333/416 as written) | MANDCWI, RETSTAT | Check the contributions record; a nonvested participant with MANDCWI > 0 still owns the contributions — this affects the benefit floor, not the PA_AMB itself | No |
| X-04 | APP (§7 cross-field: age/service/comp/status/benefit plausibility) | DOB, CSPA, PA_ACOMP, PA_AMB, RETSTAT | Actual: PA_AMB implies a benefit-to-compensation ratio outside the plausible range for the plan's formula (e.g. monthly benefit exceeding monthly average compensation with no documented cause). Expected: ratio consistent with accrual rate × service for the plan's formula | Warning | Ratio, inputs, formula | HEURISTIC ONLY (§11 of the master prompt: a heuristic never overrides the governing formula). Investigate; do not auto-correct. Plausible causes: high accrual rate, grandfathered floor, or a data error in PA_ACOMP/CSPA. | No |
| X-05 | APP (§7 cross-field) | PA_AMB, CSPA | Actual: CSPA = 0 (or blank) with PA_AMB > 0. Expected: zero credited service → zero formula benefit, unless a documented minimum benefit, grandfathered benefit, or past-service credit applies | Error | CSPA, PA_AMB | Check for a minimum-benefit provision, grandfathered floor, or past-service credit in the plan document; if none exists, the PA_AMB is unsupported on its face — a diagnostic hypothesis (service), and the record routes per §B.7 | Exact-only |
| X-06 | APP (§7 cross-field) | PA_AMB, PA_ACOMP, CSPA, APP.formulaId | Actual: PA_AMB is inconsistent with the plan's formula applied to the PA's own inputs (PA_ACOMP × accrual × CSPA) by more than the case tolerance, where all three PA inputs are present. Expected: the PA's own arithmetic reconciles within tolerance | Warning | PA_AMB, PA_ACOMP, CSPA, computed check value | Recompute from the PA's own inputs; a mismatch here means the PA's schedule used different inputs than the census carries — the schedule is the next document to read (rule C-01) | No |
| X-07 | APP (§A.2.8: PA vs BCV service) | CSPA, CS, VSPA, VS, ESPA, ES | Actual: \|CSPA − CS\|, \|VSPA − VS\|, or \|ESPA − ES\| exceeds the case's service tolerance (documented; default 0 unless the case record states otherwise — service is a fact, not an estimate). Expected: PA-reported and BCV-calculated service agree, or the difference is explained (different service-credit rule, different measurement date) | Warning | Both values, difference, measurement dates | Determine which service-credit rule each side used (plan document §, Ch. 7); the difference is itself a diagnostic hypothesis (service) for the reconciliation | No |
| X-08 | APP (§7 cross-field: PIA/integration) | PIA, PA_AMB, APP.integrationMethod | Actual: formula is integrated (offset / covered-comp) but PIA is blank; or PIA is populated but the formula is not integrated. Expected: PIA present iff the governing formula uses a Social Security offset; PIA consistent with the PA schedule | Error (missing PIA for integrated formula); Warning (PIA present, formula not integrated) | PIA, formula type | Obtain the PIA from the PA schedule or SSA records (class b); if unrecoverable, class (d) assumption with sensitivity — an integrated formula cannot be reconstructed without it | Exact-only (missing PIA) |
| X-09 | APP (§0.4 open question; Ch. 8 vesting) | PA_AMB, VPPA, VS, VSPA, RETSTAT | Actual: PA_AMB > 0 for a participant whose vesting percentage (VPPA) or vesting service (VS/VSPA) shows nonvested, with no documented vesting treatment of PA_AMB. Expected: the vesting treatment of PA_AMB is established (gross / vested / unknown) before any comparison; a nonvested participant's vested benefit is zero, but the gross accrued benefit may be positive | Error (treatment unknown and participant nonvested) | PA_AMB, VPPA, VS, RETSTAT | Establish from the PA schedule whether PA_AMB is gross or vested. **Never assume**: applying VPPA twice (once by the PA, once by the app) is a known error mode (master prompt §10). Until established, the record is Partial at best and `Verified` is unreachable (§A.7). | Exact-only |
| X-10 | APP (§0.4 open question; §3 typed benefit) | PA_AMB, FORM_CODE_NSF, FORM_CODE_NMF, APP.annuityForm | Actual: PA_AMB's annuity form is unknown, or the PA schedule states a form that is not the plan's normal form with no conversion documented. Expected: the annuity form of PA_AMB is recorded; if it differs from the normal form, the conversion factor and its source are recorded | Error (form unknown) | PA_AMB, stated form (if any), normal forms | Obtain the form from the PA schedule; a comparison between different annuity forms without conversion is invalid (rule M-05) | Exact-only |
| X-11 | OFFICIAL BCV-200–203, 209–213, 264–274, 320–331, 375–380, 385–387 (type 2/3) | FORM_CODE, FORM_CODE_NSF, FORM_CODE_NMF, FORM_CODE_QPSA, FORM_CODE_ARD, SPC_VAL, SPCNSF, SPC_ARD, MTHS, MTHSNSF, MTHS_ARD | Actual: form code not in the valid list; survivor % outside 0–1; months-certain > 180 or not in the permitted set for the form; ARD form inconsistent with the plan normal form / PBGC optional forms; joint-life code on a single-life record. Expected: codes, survivor %, and months-certain mutually consistent and within the dictionary's permitted values | Error (invalid code/range); Warning (consistency) | Codes and values found | Verify the form against the plan document and the PA schedule; form errors usually indicate the wrong normal form was loaded, which affects every benefit on that form | Exact-only (invalid); No (consistency) |
| X-12 | OFFICIAL BCV-434 (type 4) | FORM_CODE, LS_TERM, XRD, XRD_MB_TERM | Actual: critical valuation fields not populated. Expected: populated for records in the valuation population | Error | Which fields blank | NOTE: adopted for cross-source scope only (rule C-03) — this system does not calculate XRD benefits. A blank here blocks a cross-source check, not the PA_AMB calculation itself. | No (for PA_AMB calc) |
| X-13 | APP (§7 cross-field: contributions vs benefit) | MANDCWI, VOLCWI, PA_AMB, CASH_BAL_DOPT | Actual: MANDCWI/VOLCWI > 0 with no corresponding benefit floor or return-of-contributions treatment in the calculation; or CASH_BAL_DOPT > 0 for a non-cash-balance formula with no explanation. Expected: contributions and cash-balance amounts are either reflected in the benefit or explicitly documented as not applicable | Warning | Contribution/balance values | Check the plan's contribution provisions (Ch. 9 Qs on mandatory contributions) and whether the formula is cash-balance (Ch. 18) | No |
| X-14 | APP (§7 cross-field: freeze) | DOBF, DOTE, PA_AMB, APP.freezeDate | Actual: DOBF (or plan freeze date) is after DOTE but service/benefit accrues past it; or PA_AMB reflects accrual after the freeze date. Expected: no accrual after the benefit freeze date; DOBF ≤ DOTE for frozen participants | Error | DOBF, freeze date, DOTE, PA_AMB | Verify the freeze provision (plan document / amendment) and the freeze date; post-freeze accrual is a diagnostic hypothesis (freeze) — see also Ch. 26 (frozen plans) | Exact-only |

## B.4 Measurement-date resolution (M-01–M-06)

These rules implement master prompt §5 ("A recorded amount without an established benefit measurement date must be marked as having an unresolved comparison basis") and §0.3 of this document.

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| M-01 | APP (§5; dictionary DOTE note) | DOTE, PA_AMB, RETSTAT | Actual: PA_AMB populated but DOTE blank. Expected: DOTE populated for RETSTAT 1, 2, 4 (separated/retired); for RETSTAT 3 (active) DOTE blank is legitimate and the measurement date must be established another way (schedule statement, or DOPT as the as-of date — documented, not assumed). | Error (RETSTAT 1/2/4); Warning (RETSTAT 3) | DOTE blank, RETSTAT, PA_AMB | Obtain DOTE from employment records (class b) or the PA schedule's as-of statement. Until then the measurement basis is unresolved (§A.7: `Verified` unreachable). | Exact-only |
| M-02 | APP (§5: recorded date vs measurement date) | APP.recordedDate, APP.measurementDate, PA_AMB | Actual: the PA schedule or census gives only a recorded/filed date, with no statement of the date through which the benefit was calculated. Expected: measurement date and recorded date stored as separate fields; a recorded date is never used as a measurement date | Error | Dates as stated in the source, source location | Read the schedule's heading / as-of language; if the schedule states no as-of date, the basis is unresolved — do not infer it from the file date or the valuation date | Exact-only |
| M-03 | APP (§5) | APP.measurementDate, DOTE, APP.dopt | Actual: the established measurement date disagrees with census DOTE (e.g. schedule says "as of 12/31/2019" but DOTE is 06/15/2019). Expected: measurement date = DOTE, or the disagreement is documented with the reason (e.g. benefit calculated through a later payroll date) | Warning | Both dates, source locations | Determine which date the PA actually used (schedule arithmetic, salary-through date); the comparison must use the PA's date, not the census date, and the independent calculation must be run at the same date (rule M-05) | No |
| M-04 | APP (§0.3; dictionary PA_AMB definition) | PA_AMB, NRD, DOTE, APP.measurementBasis | Actual: a source (or a user) asserts PA_AMB is "as of NRD" or "at NRD". Expected: PA_AMB basis is DOTE per the dictionary; an NRD-basis claim requires documentary evidence (schedule statement or PA letter) and, if accepted, the basis is recorded as `other-stated` with the evidence linked — never silently re-based | Error | The NRD-basis claim, its source | Obtain the evidence; without it the claim is rejected and the basis stays DOTE (or unresolved if DOTE is blank). Note the related confusion: NRD is the date the *termination* benefit is often expressed at (TERM_MB_NRD_NSF), which is a different quantity from PA_AMB. | Exact-only (until resolved) |
| M-05 | APP (§3 typed benefit; §10 comparison validity) | APP.measurementDate (observation), APP.measurementDate (calculation), APP.annuityForm, APP.vestingTreatment | Actual: BenefitObservation and BenefitCalculation have different measurement dates, annuity forms, or vesting treatments. Expected: bases equivalent before any comparison; otherwise the comparison is stored with `comparisonBasis = unresolved` and is not comparable | Critical | Both bases, side by side | Convert (re-run the calculation at the observation's date/form) or hold the comparison. **A comparison across unequal bases is never computed as if it were valid.** | Yes (the comparison; the calculation itself may proceed) |
| M-06 | APP (§5: multiple candidate dates) | DOTE, POST_DOPT_DOTE, DOBF, APP.dopt | Actual: more than one candidate measurement date exists (e.g. DOTE and POST_DOPT_DOTE for an ongoing plan; DOBF before DOTE for a frozen plan). Expected: one measurement date is established with evidence, and the rejected candidates are recorded with the reason they were rejected | Warning | All candidate dates, evidence for each | Working-retirement / post-DOPT employment cases need the plan's rule on post-DOPT accrual; frozen plans need the freeze-date rule. Record the decision; do not average candidate dates. | No |

## B.5 Longitudinal validation (L-01–L-08)

Longitudinal rules reconcile records across valuation dates and participant statuses, distinguishing legitimate changes from inconsistencies (master prompt §7; Ch. 16 Q 16:2 — each year the data should be reconciled: new participants, terminations, deaths, disabilities, retirees, end-of-period actives; terminated-vested, disabled, and retired counts also reconciled).

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| L-01 | APP (Ch. 16 Q 16:2 population reconciliation) | (counts by RETSTAT) | Actual: current census counts do not reconcile to the prior extract: opening actives + new participants − terminations − deaths − disabilities − retirees ≠ closing actives. Expected: full reconciliation with every movement accounted for | Error (unreconciled movement > 0 with no explanation) | Counts by status, both extracts, the unexplained difference | Obtain the missing movement records (new hires, deaths, retirements) from plan records; an unreconciled population means participants may be missing from the PA_AMB analysis entirely | Exact-only (affected participants) |
| L-02 | APP (Ch. 16 Q 16:2; §B.2 P-01/P-16) | SSN, DOB, APP.participantKey | Actual: a participant appears in one extract but not the next with no movement record, or appears twice across extracts with different keys. Expected: every disappearance has a movement (termination, death, retirement, exclusion with reason); identity is stable across extracts | Warning | ParticipantKey, extracts involved | Trace the participant through plan records; a disappearance without a movement is usually a data error, not a real exit | No |
| L-03 | APP (§7 longitudinal) | RETSTAT (across extracts) | Actual: status moves backwards without explanation (e.g. Retired → Active Vested; Separated Vested → Active). Expected: status transitions follow the plan's rules (active → separated/retired/deceased; separated → retired/deceased) | Warning | Statuses by extract, dates | Verify against employment/payment records; a backwards move is usually a status-correction (record it as a correction with evidence) or a misclassification | No |
| L-04 | APP (§7 longitudinal) | DOTE, DOH (across extracts) | Actual: DOTE or DOH changes between extracts for the same participant with no documented correction. Expected: historical dates are stable; a change is a revision event with evidence, never a silent edit | Warning | Old and new values, extracts | Check for a rehire (new period — see EmploymentPeriod) vs a data correction; a changed DOTE changes the measurement date and therefore the comparison basis (rule M-03) | No |
| L-05 | APP (§7 longitudinal) | S001–S050, LASTYEAR (across extracts) | Actual: salary history changes between extracts for the same year (restated pay), or the salary span shifts without a new year passing. Expected: historical salary years are stable; restatements are revision events with the reason recorded | Warning | Year, old/new values, extracts | Determine whether the restatement is a payroll correction (accept with evidence) or an error; restated pay changes PA_ACOMP and the reconstructed benefit | No |
| L-06 | APP (§7 longitudinal) | PA_AMB (across extracts) | Actual: PA_AMB for the same participant changes between extracts with no amendment, correction, or measurement-date change. Expected: PA_AMB is stable across extracts unless a documented event explains the change | Warning | Old/new PA_AMB, extracts, events between them | Check for a plan amendment, a PA correction letter, or a measurement-date change; an unexplained change is itself a diagnostic hypothesis (administrator-error) | No |
| L-07 | APP (§7 longitudinal) | CSPA, VS (across extracts) | Actual: credited or vesting service decreases between extracts, or increases by more than the elapsed time between extracts. Expected: service is non-decreasing and grows by at most the elapsed time (plus documented credits) | Warning | Service values by extract, elapsed time | Verify against EmploymentPeriod; a service decrease usually means a break-in-service rule was applied (Ch. 7) or a prior error was corrected — either way it must be documented | No |
| L-08 | APP (§7 longitudinal; Ch. 16 Q 16:2 materiality) | DOB, DOH, DOTE (across extracts) | Actual: a high-impact date (DOB, DOH, DOTE) differs between extracts. Expected: stable; any change is a revision event. (Ch. 16 Q 16:5: dates of birth, dates of employment, and compensation histories matter most and are reviewed in greatest detail.) | Error | Old/new values, extracts | Verify against the earliest source (enrollment/employment records); a changed DOB changes age, NRD, service, and the benefit — it is the single most consequential longitudinal finding | Exact-only |

## B.6 Cross-source validation (C-01–C-10)

Cross-source rules reconcile census data with prior valuation reports, historical benefit schedules, payment records, and the other generators' outputs for the same case.

| Rule | Source | Fields | Actual vs expected | Sev. | Discrepancy recorded | Investigation | Blocks |
|---|---|---|---|---|---|---|---|
| C-01 | APP (§A.2.9; §7 cross-source) | PA_AMB, APP.sourceScheduleRow | Actual: PA_AMB in the census has no matching row in the PA benefit schedule (or no schedule was provided). Expected: every census PA_AMB traces to a schedule row/cell/page | Error (no schedule at all: Warning — see note) | ParticipantKey, PA_AMB, schedule searched | NOTE: no schedule → Warning (the census is still evidence, but weaker); a schedule that exists but lacks the participant → Error (the census value is unsupported). Obtain the schedule; without it the measurement basis can only be DOTE-by-definition, never evidenced. | Exact-only (Error case) |
| C-02 | APP (§7 cross-source) | PA_AMB (census) vs PA_AMB (schedule) | Actual: census PA_AMB ≠ schedule PA_AMB for the same participant. Expected: equal, or the difference is explained (different as-of date, different schedule version) | Error | Both values, both sources, dates | Determine which is later / which the PA stands behind; the schedule usually governs (it is the PA's own arithmetic) — record the decision and the reason | Exact-only |
| C-03 | APP (§A.2.10; official predicates 228–237, 306–319 as reference) | PA_AMB vs XRD_MB_TERM, TERM_MB_ERD_NSF, TERM_MB_EURD_NSF, TERM_MB_NRD_NSF, AMB | Actual: PA_AMB is compared directly to a BCV-calculated benefit at a different date/form (XRD, ERD, EURD, NRD) with no basis conversion. Expected: BCV-calculated benefits are used only as cross-checks after conversion to the PA_AMB basis (DOTE, same form, same vesting treatment); AMB (at DOTE, Calculated) is the closest comparator and still differs by construction (BCV's calculation vs the PA's) | Warning | Values compared, bases of each | Convert bases first (rule M-05) or do not compare. A raw PA_AMB-vs-TERM_MB_NRD_NSF difference is not a discrepancy — it is a category error. | No |
| C-04 | APP (§7 cross-source: payment records) | PA_AMB, PAY_AMT1, PAY_AMT2, DOR, LEV_MB_ARD | Actual: participant in pay (RETSTAT=1, DOR populated) whose payment amount (PAY_AMT1/2 or LEV_MB_ARD) is inconsistent with PA_AMB after applying the ARD factors (ERF_ARD, BFCF_ARD, ME_ARD, FORM_CODE_ARD). Expected: payment = PA_AMB converted to the ARD form/date within tolerance, or the difference is explained | Warning | PA_AMB, payment amounts, ARD factors | Reconstruct the ARD conversion from the PA's own factors (BCV3 fields); a mismatch points to a different commencement date or form than the one recorded | No |
| C-05 | APP (§7 cross-source: prior distributions) | PA_AMB, LS_EST_AMT, PARTIAL_DIST_AMT, MANDCWI | Actual: prior lump-sum or partial distribution exists but PA_AMB shows no offset/reduction for it; or a distribution is recorded in one source but not the other. Expected: distributions are reflected in the accrued benefit or explicitly documented as not affecting it (e.g. distribution of employee contributions only) | Warning | Distribution amounts/dates, PA_AMB | Ch. 16 Q 16:7 — past distributions are essential takeover data, especially for rehires. Obtain the distribution record; an unreflected distribution is a diagnostic hypothesis (distribution). | No |
| C-06 | APP (§7 cross-source: plan provisions) | PA_AMB, APP.formulaId, APP.planVersionId | Actual: PA_AMB cannot be produced by any governing formula version for the participant's group and era. Expected: at least one applicable formula version produces a benefit in the neighbourhood of PA_AMB (within the case tolerance, or explainable by a documented hypothesis) | Warning | PA_AMB, applicable formulas, computed values | Check whether the wrong PlanVersion was applied (a later formula applied retroactively — §5 forbids this), whether the participant belongs to a different employment group, or whether a grandfathered floor applies | No |
| C-07 | APP (§7 cross-source: PF factors) | PA_AMB, ERF_ARD, BFCF_ARD, APP.factorSets | Actual: the PA's ARD conversion factors (ERF_ARD, BFCF_ARD) disagree with the PF generator's factors for the same era/form. Expected: agreement, or the difference is documented (different mortality/interest basis, different era) | Warning | Factors from each source, era, form | Compare against the PF output for the case; factor disagreements are usually era mismatches (factors from the wrong historical regime) — see PF v0.3.0 direction on per-regime sets | No |
| C-08 | APP (§B.0.1: "reasonably certain" standard) | PA_AMB, APP.calculatedMonthlyBenefit, APP.evidence | Actual: a correction is proposed on a numerical difference alone, with no documentary evidence of an error. Expected: `correction-recommended` requires the reviewer to be reasonably certain an error occurred — a difference plus a documented cause (wrong service, wrong averaging period, wrong formula version), not a difference alone | Error (disposition blocked, not data blocked) | Proposed correction, evidence list | Gather the evidence (schedule arithmetic, plan provision, service record). Without it the disposition is `requires-investigation`, never `correction-recommended`. Numerical agreement is likewise not proof of correctness if the provisions used were wrong (§14 of the master prompt). | Exact-only (the correction disposition) |
| C-09 | APP (§A.2.14: PA_AMB_ACCEPT) | PA_AMB_ACCEPT, APP.disposition | Actual: PA_AMB_ACCEPT = Y with no ActuarialDecision on file; or = Y while the participant's disposition is `requires-investigation` / `indeterminate`; or = N with disposition `verified`. Expected: PA_AMB_ACCEPT is set only by a recorded human decision, and is consistent with it (Y ⟺ verified / supported-for-acceptance; N ⟺ correction-recommended / indeterminate-with-rejection — per the reviewer's rationale) | Critical | PA_AMB_ACCEPT value, disposition, decision record | The accept flag is an outcome, not an input. Remove or correct it through a decision record; never edit the flag directly. | Yes (the decision record) |
| C-10 | APP (CASE_PROCESSING.txt: internal-controls review) | APP.reliabilityGrade (SourceDocument) | Actual: a source document is used in a calculation or a decision while its reliability grade is `unassessed` or `low`, with no note of the limitation. Expected: every source used in a decision carries a reliability grade; `low` sources are corroborated by a second source or the limitation is stated in the decision | Warning | Document, grade, where it was used | Assess internal controls per CASE_PROCESSING.txt (review the PA's and service providers' controls to judge the reliability of electronic and hard-copy records). A low-reliability source does not invalidate the analysis — it caps the disposition (§A.7: an uncorroborated low-reliability PA_AMB cannot be `verified`). | No |

## B.7 Validation-to-disposition routing (the standing requirement, enforced)

A validation failure never silently drops a participant and never produces a made-up exact benefit. Routing:

1. **Critical failure (blocks = Yes).** No calculation of any kind for this participant. The participant is routed to a documented disposition: `requires-investigation` if a concrete next step exists (a document to obtain, an identity to resolve), otherwise `indeterminate`. The finding, the missing evidence, and the data request are recorded in the ActuarialDecision record.
2. **Error failure (blocks = Exact-only).** Exact reconstruction is blocked. The system attempts the bounds/scenario path: if the missing input is class (b), recover it and re-run; if class (c), compute justified bounds; if class (d), apply a documented, reviewer-approved assumption and label the result an estimate; if class (e), route as in (1). The reachable dispositions follow §A.7.
3. **Warning.** Calculation proceeds; the finding must be reviewed before any acceptance disposition. An acceptance disposition (`verified` / `supported-for-acceptance`) with an unreviewed Warning is refused at entry.
4. **Info.** Recorded; no routing effect.
5. **Unresolved measurement basis (rules M-01–M-06).** The comparison is not computed. The participant is routed to `requires-investigation` (if the basis can be established by obtaining a document) or `indeterminate` (if it cannot). The record still appears in every report, with its reason — it is never omitted from counts or denominators.
6. **Every participant in scope ends with a disposition.** The plan-level report (§15 of the master prompt) shows the count of participants by disposition, including `indeterminate`. A run that leaves any in-scope participant without a disposition is incomplete and is reported as such.

## B.8 Rule counts

- Structural: 12 rules (S-01–S-12)
- Participant-level: 16 rules (P-01–P-16)
- Cross-field: 14 rules (X-01–X-14)
- Measurement-date: 6 rules (M-01–M-06)
- Longitudinal: 8 rules (L-01–L-08)
- Cross-source: 10 rules (C-01–C-10)
- **Total: 66 validation rules**, of which 17 adopt (in whole or part) official BCV predicates (S-04, S-05; P-02–P-11; X-02, X-03, X-11, X-12; C-03 as reference only) and 49 are application-specific analytical tests defined by this spec. Every rule carries all eight required items (§B.0).

## B.9 Gaps, conflicts, and inaccessible sources

| # | Item | Status |
|---|---|---|
| G-1 | Vesting treatment of PA_AMB (gross vs vested) | OPEN — not stated in the dictionary; must be established per case (§0.4, rule X-09) |
| G-2 | Annuity form / normal-retirement basis of PA_AMB | OPEN — not stated in the dictionary; must come from the PA schedule (§0.4, rule X-10) |
| G-3 | Covered-compensation tables; SSA bend-point tables | NOT YET SOURCED — no table found in the Book of Job material reviewed (§A.4) |
| G-4 | Historical statutory limits (IRC §401(a)(17), §415(b)) by year | NOT YET SOURCED — discussed in Answer Book Ch. 9 but no limits table found (§A.4). Values must come from IRS publications. |
| G-5 | BCV predicate type 1–3 meanings and category 1–9 legend | NOT IN THE WORKBOOK — only type 4 (critical) is interpretable (§0.5, §B.0.3) |
| G-6 | Rounding conventions per plan | NOT YET SOURCED — no written PBGC rounding policy found; the PF file's practice (4 dp) is a file practice, not a policy. Per-plan rounding must be established from the plan document or the PA schedule. |
| G-7 | Current edition of Policy 5.8-1 Benefit Corrections | UNVERIFIED — the 2014 edition is the latest seen; the case actuary must confirm no newer edition exists (§B.0.1) |
| G-8 | No filled example, prior valuation report, or PA benefit schedule available for this project | BY DESIGN — synthetic data only; Stage 4 tests must use synthetic schedules constructed for the purpose |
| C-1 (conflict) | BCV predicates 224 vs 225 (DOTE on/after DOPT vs DOTE before DOPT) | FLAGGED — both type 3, apparently contradictory; Stage 2 must determine applicability by RETSTAT/population before implementing (rule P-04). Neither was silently picked. |
| C-2 (conflict) | BCV-276 (credited service not populated) is ENABLE_FL=N, but credited service is required for reconstruction | FLAGGED — adopted as APP rule P-06 with the reason stated (§B.0.4), not as an official predicate |
| — | `processing-manual.pdf`, `bcv-manual-combined.pdf`, `BCV ATPBGC (Add-ins).pdf` full text; `data_dictionary_complete.xlsm` (Drive Current_Selected) vs local CSV cross-check | NOT REVIEWED in this stage — the local CSV (2026-10-30 index) was treated as authoritative; Stage 2 must cross-check the .xlsm and review the manuals for any validation predicates they contain |
| — | Answer Book Ch. 6, 7, 8, 9, 18, 25, 26, 27 | Ch. 7/8/9/16 read for this spec; Ch. 6, 18, 25, 26, 27 not read in this stage — cited where the master prompt prioritises them, to be read at Stage 2 for the formula and provisions work |

## Sources for this document

- `~/workspace/pbgc-pa-amb-analysis/MASTER_PROMPT.md` (§2, §3, §5, §6, §7, §10, §12, §14, §15, §17)
- `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` / `.json` (2026-10-30 index)
- `~/workspace/pbgc_review/pa-amb/BCV-DataValidation-predicates.xlsx` (249 predicates; Drive `1CCBAMkMVVS7G1axzegkIqCjS3TrE4Qkr`)
- `~/workspace/pbgc_review/pa-amb/DBAB-Ch16.pdf` (Ch. 16, 2024 ed.), `DBAB-Ch07.pdf`, `DBAB-Ch08.pdf`, `DBAB-Ch09.pdf`
- `~/workspace/pbgc_review/pa-amb/Benefit_Corrections.pdf` (Policy 5.8-1, 10/02/2014); `~/workspace/pbgc_review/eadj/current-policies.txt` §5.8-1
- `~/workspace/pbgc_review/eadj/CASE_PROCESSING.txt`
- `~/workspace/pbgc_review/del/pbgc-del-extractor.md` (prior DEL intent; DEL v0.1.0 is the wrapped-up record)
- `~/workspace/pbgc_review/bcv/BCV_ATPBGC_Add-ins.pdf` (Jul 2024)

## Handoff notes for Stage 2

1. The canonical input schema must cover every field in §A.2, with the R/C/O requirements enforced at import and the §A.6 class recorded for every missing input.
2. The validation engine must implement all 66 rules with the eight-item result record (§B.0.2) and the routing of §B.7. Rule P-04's flagged conflict (predicates 224 vs 225) must be resolved before implementation.
3. The disposition-reachability matrix (§A.7) must be enforced at ActuarialDecision entry, not as a reporting afterthought.
4. The tolerance record (M-7) is a case-level input; the engine must refuse to compare without one.
5. Nothing in this document authorises a live-case import. All Stage 2+ testing uses synthetic data only.
