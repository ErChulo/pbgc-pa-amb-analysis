# PA_AMB Analysis — Canonical Input Schema and Data Dictionary Mappings

- **Project:** PA_AMB Analysis System — help a PBGC case actuary decide, with evidence, whether to accept, reject, or modify the prior administrator's accrued monthly benefit (PA_AMB) as recorded in the census data.
- **Repo:** ErChulo/pbgc-pa-amb-analysis (public, main; user-created 2026-11-12)
- **Local dir:** `~/workspace/pbgc-pa-amb-analysis`
- **Stage:** Stage 2, deliverable 5 of §22 (canonical input schema and data dictionary mappings)
- **Governing spec:** `MASTER_PROMPT.md` (§3 typed benefit, §5 temporal reconstruction, §6 data architecture and input formats, §7 validation, §10 reconciliation, §12 missing-data framework, §14 acceptance framework, §17 state-driven design)
- **Stage 1 basis:** `stage1/00-source-inventory.md`, `stage1/02-data-requirements-validation.md` (Part A data requirements, Part B validation catalog), `stage1/04-architecture-decision.md` (Option C Hybrid, staged; single HTML file, 0 fetch)
- **Status:** Design specification only. No code, no app, no UI, no tests. Interfaces and JSON Schemas in this file are design artefacts, not runnable code.
- **Date:** 2026-11-12

## 0. What this document is

This document is the canonical input schema: the single shape every import format maps into, the field-by-field mapping to the BCV Data Dictionary, and the rules for representing what is missing or unresolved. Stage 1 output 02 defined *what* must be collected (minimal vs comprehensive datasets, the 8 non-census inputs, completeness grades, the five-way missing-data split, the measurement-date rules M-01–M-06). This document defines *how* that material is represented in the system, so that Stage 3 (feasibility) and Stage 4 (engine) can be built against a fixed contract.

Nothing in this document changes a Stage 1 finding. Where Stage 1 left a question open, this document carries it forward as an open decision (§12) — it does not resolve it by a silent default.

## 0.1 Sources and authority

| Source | Role in this document |
|---|---|
| BCV Data Dictionary, Current Selected (2026-10-30 index: 1,172 field records, 1,152 distinct fields, 12 tables) | Authoritative for every BCV field name, type, and class. Field names are copied exactly. No field identifier is invented. |
| Stage 1 output 02 (`stage1/02-data-requirements-validation.md`) | Authoritative for the minimal/comprehensive datasets, the 8 non-census inputs, the completeness grades, the five-way missing-data split (§A.6), the validation rules (S/P/X/M/L/C series), and the disposition-reachability matrix (§A.7). Section references such as "02 §A.2.5" mean that document. |
| Stage 1 output 00 (`stage1/00-source-inventory.md`) | Authoritative for the PA_AMB definition, the tolerance finding (no PBGC tolerance for PA_AMB reconciliation exists; Policy 5.8-1 $1/$5 governs benefit corrections, a different decision), and the gaps list. |
| MASTER_PROMPT.md §6 | Authoritative for the 15 entities, the input-format list, and the immutable-source / provenance requirements. |
| Defined Benefit Answer Book, Ch. 16 (2024 ed.) | Reference only (hierarchy level 5). Cited where it grounds a census concept; it never overrides the dictionary or a plan document. |

## 0.2 Conventions

- **BCV field names are copied exactly from the dictionary.** A field that exists only in the application is prefixed `APP.` and named in `camelCase` — it is never presented as a BCV field. Every canonical field in this document traces to one of three origins, stated in its mapping row: (a) a BCV dictionary field, (b) a Stage 1 output 02 field, or (c) an application-defined (`APP`) field with a stated reason.
- **BCV types:** `NUMBER`, `VARCHAR2(n)`, `DATE` — as in the dictionary. App types: `decimal(18,2)` money (stored as integer minor units in the engine; see §9.1), `date` (ISO-8601 `YYYY-MM-DD`), `string`, `integer`, `boolean`, `enum`, `json`.
- **Required vs optional:** `R` = the record/calculation cannot proceed without it (or a documented substitute); `C` = conditionally required (required when a stated condition holds); `O` = optional. "Required" here means required by this spec for the stated purpose, not a BCV load requirement — the two are distinguished wherever they differ.
- **Two ID series — do not confuse them.** Dataset items (02 §A.3) use single-digit IDs with no leading zero: minimal M-1–M-8, comprehensive C-1–C-14. Validation rules (02 Part B) use two-digit IDs with a leading zero: S-01–S-12, P-01–P-16, X-01–X-14, M-01–M-06, L-01–L-08, C-01–C-10. "M-7" (the tolerance record) is not a rule and "M-07" does not exist.
- **Grain matters.** `DOBF` exists at two grains: plan-level (R5 Plan Summary shell header — the plan's date of benefit freeze) and participant-level (BCV1.DOBF, "Participant's Date of Benefit Freeze"). Every DOBF reference in this schema is qualified by grain. The same rule applies to any field name that appears at more than one grain.
- **Synthetic data only.** The worked example in §10 uses a fictional participant. No live case data, no participant-level census rows.
- **Currency.** The dictionary states no currency for PA_AMB. Amounts are recorded as dollars as assumed in 02 §0.4 (monthly dollars, 2 decimal places, to be confirmed against the PA schedule at import — rule S-09). USD is implied by context, not stated as a dictionary fact; do not assert it as one.

## 0.3 The standing requirement, as a schema requirement

The application must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible. In schema terms that means:

1. **No silent failure.** A record that cannot be reconstructed exactly is never dropped, skipped, or zero-filled. It is graded (§6), its missing inputs are classified (§7), and it proceeds to a documented disposition.
2. **No invented exact number.** When the evidence cannot support an exact benefit, the schema carries justified bounds or no calculated benefit at all — never a made-up exact figure. The schema therefore has explicit places for bounds, scenarios, and "no calculated benefit" (§9.4).
3. **Grades and basis state gate dispositions.** The completeness grade (§6) and the measurement-basis state (§8) determine which §14 dispositions are reachable (02 §A.7). The schema enforces this by carrying grade and basis as stored fields, not as derived-after-the-fact annotations.
4. **Every value carries provenance.** A value without provenance (file + row/cell, PDF page, document section, or JSON path) is not loadable into a calculation (02 rule S-12).

---

## 1. Canonical record shape — overview

### 1.1 The case package

All inputs for one case are held in one versioned **CasePackage**. The package is the unit of import, save, load, and audit (Stage 1 output 04 §4.1: explicit, versioned case-package files owned by the user; no browser database is the source of truth).

```typescript
interface CasePackage {
  schemaVersion: string;          // e.g. "1.0.0" — this schema's version; see §1.4
  packageId: string;              // APP-generated, stable
  case: CaseRecord;               // §3.1
  plan: PlanRecord;               // §3.2
  planVersions: PlanVersionRecord[];
  formulas: FormulaRecord[];
  participants: ParticipantRecord[];   // §3.5 — one per census record (ID 1, 2, or 4)
  benefitObservations: BenefitObservation[];  // §3.9 — one per reported PA_AMB (or per explicit no-benefit statement)
  benefitCalculations: BenefitCalculation[];  // engine output, §9.4
  benefitComparisons: BenefitComparison[];    // engine output, §9.4
  diagnosticHypotheses: DiagnosticHypothesis[];
  sourceDocuments: SourceDocument[];
  decisions: ActuarialDecision[];      // §3.14 — the only writer of PA_AMB_ACCEPT
  toleranceRecord: ToleranceRecord;     // dataset item M-7; §4.1
  nonCensusInputs: NonCensusInput[];    // §5
  calculationRuns: CalculationRun[];
  imports: ImportRecord[];              // one per imported file; §2.8
  missing: MissingRegistry;             // §7 — every missing value in the package, in one place
  unmapped: UnmappedField[];            // §2.8 — unknown fields retained verbatim, never dropped
}
```

### 1.2 The 15 entities (§6 of the governing spec)

The package holds the 15 entities defined in 02 §A.2: Case, Plan, PlanVersion, Formula, Participant, EmploymentPeriod, CompensationHistory, ServiceHistory, BenefitObservation, BenefitCalculation, BenefitComparison, DiagnosticHypothesis, SourceDocument, ActuarialDecision, CalculationRun. Their field lists are given in §3 of this document (canonical field, BCV table + field, BCV type, BCV class, notes). The entity definitions in 02 §A.2 are not repeated here except where this schema adds precision (missing-value representation, measurement-date state, completeness grading).

### 1.3 Immutable sources vs normalised working data

Three layers, never merged:

| Layer | Content | Mutability |
|---|---|---|
| **Source layer** (`imports[]` + `sourceDocuments[]` + raw values) | Imported values exactly as read, with provenance and file hash. | Immutable. A correction never overwrites an original observation; it creates a revision event (governing spec §6, §17). |
| **Canonical layer** (`participants[]`, `benefitObservations[]`, …) | Normalised values in the shapes defined in §3 and §9, each with provenance and a missing-entry where applicable (§7). | Versioned. Changes are named transformations with a version number, recorded in the audit log. |
| **Derived layer** (`benefitCalculations[]`, `benefitComparisons[]`, grades) | Engine output, reproducible from the canonical layer + rule/formula/tolerance versions. | Regenerated. Never hand-edited. |

A value in the canonical layer always points back to its source-layer location. A canonical value that cannot point back is not loadable into a calculation (02 rule S-12).

### 1.4 Schema versioning

- `schemaVersion` follows the Phase 0 versioning rule recorded in the project memory: additive change → minor version (v1.1.0), breaking change → major version (v2.0.0), always with a change note, and golden tests re-run.
- A case package records the schema version it was written under. A newer reader must either migrate it through a named, versioned transformation (recorded in the audit log) or refuse it with the reason — never silently reinterpret it.
- The tolerance record, the formula taxonomy version, and the validation-rule catalog version are recorded separately from the schema version (they change on different cycles); all three are part of every `CalculationRun` (§3.15).

---

## 2. Import formats

Every format maps into the same canonical record shape (§1.1). The importer never writes a benefit, a disposition, or a tolerance; it only loads, maps, and validates structure. Import-time checks are structural (02 rules S-01–S-12) and run before any participant-level rule.

### 2.1 Common import contract (all formats)

These invariants apply to every format (02 §A.1.1):

1. **Immutable sources.** Original imported values are stored separately from normalised or corrected values.
2. **Provenance on every value.** File name + sheet/row/cell, or document + page/section, or JSON path. A value without provenance is not loadable into a calculation.
3. **No silent defaults.** Missing is missing (§7). No field is defaulted to zero, to DOPT, or to any other value unless a governing rule (cited in the rule) requires it.
4. **Hash and snapshot.** Every imported file is hashed (SHA-256) and snapshotted per CalculationRun so any later result is reproducible from its inputs.
5. **PII handling.** SSN and full names are processed locally only, never leave the machine, and are redacted in exports and reports except where the export is the case package itself. Synthetic data only during development.
6. **Quarantine, never silent drop.** A row, cell, or record that fails to parse or to map is quarantined with its raw text and location, and counted in the import record. The rest of the file still loads (02 rule S-02).
7. **Unknown fields are retained.** A field name that resolves to no dictionary field and no declared app field is kept verbatim in the `_unmapped` bag with provenance (02 rule S-03), never dropped. It is available for later mapping; it never enters a calculation unmapped.

An `ImportRecord` is written for every imported file:

```typescript
interface ImportRecord {
  importId: string;
  fileName: string;
  fileHashSha256: string;        // before import; for XLSM also after import — must match (§2.3)
  fileSizeBytes: number;
  format: "csv" | "xlsx" | "xlsm" | "json" | "pdf-schedule" | "user-entered";
  encoding: string;              // e.g. "UTF-8", "UTF-8-BOM"; recorded, see §2.2
  delimiter?: string;            // CSV only; auto-detected value recorded
  sheetName?: string;            // XLSX/XLSM only
  importedAt: string;            // ISO-8601 timestamp (import metadata only; never used inside a calculation)
  importedBy: string;
  rowsRead: number;
  rowsLoaded: number;
  rowsQuarantined: number;
  unmappedFields: string[];      // field names retained in the _unmapped bag
  provenanceBase: string;        // file / document reference every value in this import points to
}
```

### 2.2 CSV — census extracts, salary histories, PA benefit schedules, prior valuation extracts

**Canonical shape it maps into:** `ParticipantRecord` (+ `EmploymentPeriod`, `CompensationHistory`, `ServiceHistory`, `BenefitObservation`) for census/salary rows; `BenefitObservation` (+ `SourceDocument` of type `pa-schedule`) for PA schedule rows; `BenefitCalculation` cross-check fields only for prior valuation extracts (never as the independent calculation itself).

**Import-time checks:**

| Check | Rule |
|---|---|
| Header row required. Every header name must resolve to a dictionary field, a declared app field, or be retained in `_unmapped` with provenance. | S-03 |
| Encoding UTF-8 (BOM tolerated, recorded in `ImportRecord.encoding`). A file in another encoding is not silently re-interpreted; the importer records the detected encoding and, if it cannot be established, quarantines the file. | S-01 |
| Delimiter auto-detected from `,` / `;` / tab; the detected delimiter is recorded in `ImportRecord.delimiter`. Quoted fields per RFC 4180. | S-02 |
| One record per row. A row that fails to parse is quarantined with its raw text and line number, never silently dropped. | S-02 |
| `CASE` is read as text, never numeric — leading zeros must survive import (8 characters). A blank, wrong-length, or file-inconsistent CASE is an Error. | S-06 |
| DATE fields must parse to a valid calendar date and be stored ISO-8601. An unparseable date, or a non-ISO format with ambiguous day/month, is quarantined, never guessed. The source's date format is confirmed from the file's own evidence. | S-07 |
| NUMBER fields must be numeric, in the dictionary's units. Non-numeric text, or a number with the wrong sign/scale (e.g. PA_AMB in cents), is an Error; the source's units are confirmed against the PA schedule, never rescaled on assumption. | S-08, S-09 |
| Salary-year span check: `LASTYEAR − FRSTYEAR + 1` must equal the count of populated S-years, and S00n must map to year `LASTYEAR − (n−1)` (§3.7). A span mismatch is a structural Error; a gap inside the span is missing data (rule P-14), not a structural error. | S-10 |
| Every value carries provenance: file name + row number (+ column/header name). | S-12 |

### 2.3 XLSX and XLSM — census extracts, salary histories, PA schedules, prior valuation reports

**Canonical shape it maps into:** same as §2.2 (participant, employment, compensation, service, observation records; valuation cross-check fields for prior valuation reports).

**Import-time checks (both):**

| Check | Rule |
|---|---|
| Read with a library that does not execute code. Only cell values and formulas' cached values are read. | S-01, §6 |
| Sheet name, row number, and cell address are the provenance location for every value. | §2.1 |
| Merged cells are unmerged explicitly and the merge is logged in the import record. A value that exists only by virtue of a merge is attributed to its top-left cell, and the merge is recorded. | §2.1 (02 §A.1) |
| Header/field-name validation as in §2.2 (rule S-03). | S-03 |
| DATE / NUMBER checks as in §2.2 (rules S-07, S-08, S-09, S-10). | S-07–S-10 |
| `CASE` as text with leading zeros kept (rule S-06). | S-06 |

**XLSM — additional handling (macros neither executed nor modified):**

| Requirement | How the importer handles it |
|---|---|
| Macros are never executed. | The importer opens the file read-only through a library that does not run VBA. No macro, formula, or embedded code path is invoked at any point. |
| Macros are never modified. | The importer performs no write of any kind to the file: no save, no save-as, no cell edit, no VBA-project edit, no removal or addition of any part. The file is opened read-only and closed without saving. |
| The file must be provably unchanged. | The SHA-256 hash is recorded **before** import and **after** import. The two hashes must be identical. Any difference aborts the import, logs a security event (file name, both hashes, timestamp, user), and quarantines the file — the partial import is discarded, not kept. (02 rule S-11.) |
| No VBA project is opened. | The importer reads only the worksheet XML (cell values and formulas' cached values). The VBA project part (`vbaProject.bin`) is never opened, parsed, or extracted. Its presence is recorded in the import record (`vbaProjectPresent: boolean`) as a fact, not as content. |
| Only cached formula values are read. | A formula cell contributes its cached value. A formula cell with no cached value is treated as missing (null + missing-reason code, §7), never evaluated by the importer. |
| A macro-bearing file that cannot be read read-only is refused, not worked around. | If the available library cannot open the file without executing or modifying macros, the import is refused with the reason recorded. The user is not asked to "enable macros" or to re-save the file. |

```typescript
interface XlsmImportRecord extends ImportRecord {
  format: "xlsm";
  hashBeforeSha256: string;
  hashAfterSha256: string;
  hashesMatch: boolean;          // must be true or the import is aborted (rule S-11)
  vbaProjectPresent: boolean;    // recorded as a fact; the project is never opened
  macrosExecuted: false;         // invariant: always false, asserted by the importer
  macrosModified: false;         // invariant: always false, asserted by the importer
}
```

### 2.4 Structured JSON — preferred for OCR-pipeline payloads, PA schedule exports, and app-to-app handoff

**Canonical shape it maps into:** any canonical entity, as declared by the payload's `schemaVersion` and `entity` fields. JSON is the handoff format for the source-agnostic proposal slot shared with the R5/DEL generators (a Copilot or OCR-pipeline JSON proposal is a *proposal only*: the app validates it against this schema, a human reviews and approves it, and only approved JSON enters the canonical layer — no LLM output enters the calculation path).

**Import-time checks:**

| Check | Rule |
|---|---|
| Validated against the canonical input schema in §9 (JSON Schemas). A payload that fails schema validation is rejected as a whole, with the failing paths listed; it is never partially loaded. | S-01, S-03 |
| `schemaVersion` must be present and must be a version this reader understands. An unknown or missing version is rejected with the reason, never silently reinterpreted (§1.4). | §1.4 |
| Unknown fields are retained verbatim in a `_unmapped` bag with provenance (JSON path), never dropped. | S-03, 02 §A.1 |
| Every value carries provenance: file name + JSON path. | S-12 |
| Money is a JSON number in dollars (2 dp) or an integer-minor-unit object — never a string, never a float with more precision than the source states. The payload must declare its money representation; the importer does not guess. | S-08, S-09 |
| Dates are ISO-8601 strings (`YYYY-MM-DD`). Any other date representation is rejected, never re-parsed by guessing. | S-07 |

```typescript
interface JsonImportEnvelope {
  schemaVersion: string;         // must match a known canonical schema version
  entity: string;                // e.g. "participant", "benefitObservation", "planVersion"
  sourceDocumentId: string;      // the SourceDocument this payload came from
  records: unknown[];            // validated against the §9 JSON Schema for that entity
  _unmapped?: Record<string, unknown>; // retained verbatim, with JSON paths
}
```

### 2.5 Historical participant data extracts — prior census snapshots, prior valuation populations

**Canonical shape it maps into:** a separate `CalculationRun` snapshot. A historical extract is **never merged into the current census** without an explicit longitudinal reconciliation (02 rules L-01–L-08). Each extract carries its own as-of date and source, and is stored as its own import batch with its own `ImportRecord`.

**Import-time checks:** the format checks of §2.2–§2.4 according to the extract's file format, plus:

| Check | Rule |
|---|---|
| Each extract must state its as-of date (`APP.valuationAsOfDate`) and its source. An extract with no as-of date is quarantined — a snapshot without a date cannot be reconciled. | L-01 |
| Participant linkage across extracts is by `APP.participantKey` (CASE + SSN + DOB at first import), never by `BCV_REC_ID` (which is load-specific). A key collision is quarantined (rule S-05). | S-05, 02 §A.2.5 |
| Historical dates (DOB, DOH, DOTE) and salary years are expected to be stable across extracts. A change is stored as a revision event with evidence, never as a silent edit; longitudinal rules L-04, L-05, L-08 fire on it. | L-04, L-05, L-08 |
| A participant who appears in one extract but not the next, with no movement record, is flagged (L-02), not dropped. | L-02 |

### 2.6 Prior administrator benefit calculation schedules — PDF, XLSX, CSV, or JSON

**Canonical shape it maps into:** a `SourceDocument` (type `pa-schedule`) plus one `BenefitObservation` per schedule row, each traceable to a schedule row/cell/page. The schedule is the evidence for the measurement date (§8), the annuity form, and the vesting treatment — the three things the dictionary does not state about PA_AMB.

**Import-time checks:**

| Check | Rule |
|---|---|
| The schedule is registered as a `SourceDocument` first (file hash, type, title, location, version/effective dates where stated). No observation may point to an unregistered schedule. | §3.13 |
| Each PA_AMB value must be traceable to a schedule row/cell/page, recorded in `BenefitObservation.sourceScheduleRow`. A census PA_AMB with no schedule row is flagged (rule C-01): Warning if no schedule was provided at all, Error if a schedule exists but lacks the participant. | C-01 |
| Census PA_AMB ≠ schedule PA_AMB for the same participant is an Error (rule C-02). The difference is recorded with both values and both sources; the schedule usually governs (it is the PA's own arithmetic) — the decision and its reason are recorded, never silently picked. | C-02 |
| A PDF schedule contributes values only with a page/section location per value. A value extracted from a PDF without a page reference is not loadable into a calculation (rule S-12). PDF text extraction is an import step, not a calculation step; an unreadable text layer is recorded as such and routed to the OCR pipeline as a proposal (JSON, §2.4), never guessed from. | S-12 |
| The schedule's as-of / "calculated through" language is captured verbatim in `BenefitObservation.calculatedThroughDate` and `BenefitObservation.calculatedThroughStatement` (§8). The recorded/filed date is never used as the measurement date (rule M-02). | M-02 |

### 2.7 User-entered plan provisions and documented exceptions

**Canonical shape it maps into:** `PlanRecord`, `PlanVersionRecord`, `FormulaRecord`, and `ActuarialDecision` exception entries. Entered only through the app's provision/exception forms, never by editing an imported file.

**Import-time checks (entry-time checks):**

| Check | Rule |
|---|---|
| Each entry requires: the provision text or exception description, the source document + location, the effective dates (adoption date and effective date recorded separately), and the entering user. An entry missing any of these is refused. | 02 §A.1 |
| A correction never overwrites an original observation; it creates a revision event (§1.3, governing spec §6, §17). | §1.3 |
| A user-entered provision that contradicts a BCV dictionary field definition is flagged, not silently applied (source hierarchy, §0.1: the dictionary governs field meaning; the plan document governs the provision). | §0.1 |
| An exception that sets a value (e.g. a documented zero benefit for a nonvested participant) must cite the governing rule. A blank is never turned into zero by an exception that cites no rule (§7). | P-13 |

### 2.8 What every import produces

Regardless of format, a completed import produces: (1) canonical records in §3 shapes, (2) an `ImportRecord`, (3) a `MissingRegistry` update (§7) for every blank, (4) an `_unmapped` bag for every unknown field, (5) a quarantine list for every failed row/record, and (6) structural validation findings (rules S-01–S-12) with severity and blocking effect. The import never produces a calculation, a comparison, a grade, or a disposition — those are downstream stages that read the canonical layer.

```typescript
interface UnmappedField {
  fieldName: string;             // as it appeared in the source
  sourceLocation: string;        // file + row/cell, or JSON path
  rawValue: unknown;             // retained verbatim
  importId: string;
  resolution?: string;           // filled later when the field is mapped or confirmed as PA-specific
}
```

---

## 3. Field-by-field mapping to the BCV dictionary

Each table gives: **canonical field** · **BCV table + field** · **BCV type** · **BCV class** (Input / Calculated / System Generated / —) · **notes**. "APP" in the BCV column means the field exists only in the application; the reason is stated in the notes. BCV field names are copied exactly from the dictionary (2026-10-30 index). Where Stage 1 output 02 states a BCV table that this document could not re-verify against the dictionary index, the row says so and the item is an open decision (§12).

### 3.1 Case

DOPT and BPD are **not** BCV dictionary fields — there is no DOPT or BPD field in the 1,172-record dictionary. They are app-level case facts, sourced from the case file / R5 header. Do not present them as BCV fields.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `CASE` | ALL · `CASE` | VARCHAR2(8) | Input | Leading zeros kept, text type, never numeric (rule S-06). |
| `APP.dopt` | — (APP) | date | — | Date of Plan Termination. From case file / R5 header. Not a BCV field. |
| `APP.bpd` | — (APP) | date | — | Benefit determination date / BPD. Conditionally required when a benefit freeze or BPD-dependent provision exists. Not a BCV field. |
| `APP.planName` | — (APP) | string | — | R5 header / plan documents. |
| `APP.planNumber` | — (APP) | string | — | R5 header / plan documents. |
| `APP.caseActuary`, `APP.auditor` | — (APP) | string | — | R5 header. Optional. |
| `APP.employerStatus`, `APP.successorPlan` | — (APP) | string | — | R5 header. Optional. |
| `APP.trusteeshipDate` | — (APP) | date | — | Case file. Optional. |
| `APP.valuationAsOfDate` | — (APP) | date | — | Prior valuation report. Conditionally required for any longitudinal comparison. |

### 3.2 Plan

Sourced from plan documents via the R5 generator output (R5 JSON / filled Plan Summary Shell) where available; otherwise user-entered from plan documents with citations (§2.7).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.planId` | — (APP) | string | — | Links to Case. App-generated or from R5 output. |
| `APP.normalRetirementAge`, `APP.normalRetirementDefinition` | — (APP) | string + rule ref | — | Plan document § (R5 provisions). The BCV Calculated field `NRD` (BCV1, RETDATE) is the computed normal retirement *date*; the plan's definition is an APP provision. |
| `APP.earlyRetirementRule` | — (APP) | string + rule ref | — | Conditionally required if any early-retirement factor or ERD benefit is analysed. |
| `APP.normalFormSingle`, `APP.normalFormMarried` | BCV1 · `FORM_CODE_NSF`, `FORM_CODE_NMF` (cross-check) | VARCHAR2 | Calculated | Canonical values are APP enums holding BCV FORM_CODE values. Cross-checked against BCV1 FORM_CODE_NSF / FORM_CODE_NMF. |
| `APP.compensationDefinition` | — (APP) | string + rule ref | — | Plan document § (R5 provisions). |
| `APP.serviceDefinitions` | — (APP) | string + rule refs | — | Credited / vesting / eligibility. Plan document §; Answer Book Ch. 7. |
| `APP.vestingSchedule` | — (APP) | structured | — | Schedule type, years, %. Plan document §; Ch. 8. BCV1 `VP` is the *computed* vesting percent, not the schedule. |
| `APP.freezeDate` | BCV1 · `DOBF` (participant grain, cross-check) | DATE | Input | Plan-level freeze date. Conditionally required if plan frozen. Qualify grain: plan-level here, participant-level in BCV1.DOBF (§0.2). |
| `APP.integrationMethod` | — (APP) | enum: none / excess / offset / covered-comp / PIA-offset | — | Conditionally required if formula is integrated. Plan document §. |
| `APP.employeeContributionRule` | — (APP) | string + rule ref | — | Conditionally required if MANDC / VOLC present (§3.12). |

### 3.3 PlanVersion

One row per provision version; the provision in force at the measurement date governs (governing spec §5: never apply the latest formula retroactively).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.versionId` | — (APP) | string | — | App-generated, stable. |
| `APP.effectiveDate` | — (APP) | date | — | Amendment / restatement effective date. |
| `APP.adoptionDate` | — (APP) | date | — | Amendment adoption date, recorded separately from effective date. |
| `APP.restatementDate` | — (APP) | date | — | Optional. Restatement document. |
| `APP.provisionText` | — (APP) | string | — | Plan document / amendment, section cited. |
| `APP.supersedesVersionId` | — (APP) | string (ref) | — | Conditionally required except for the original version. |
| `APP.grandfatheredGroups` | — (APP) | list of refs | — | Conditionally required if grandfathering exists. Amendment text. |
| `APP.sourceDocumentId` | — (APP) | string (ref) | — | → SourceDocument. Required. |

### 3.4 Formula

The formula taxonomy itself is Stage 1 output 01; this entity records which formula applies to whom and when. No formula is defined here.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.formulaId` | — (APP) | string | — | App-generated; taxonomy ref from Stage 1 output 01. |
| `APP.formulaType` | — (APP) | enum (per taxonomy) | — | Plan document §. |
| `APP.planVersionId` | — (APP) | string (ref) | — | → PlanVersion. |
| `APP.appliesToGroup` | — (APP) | string (ref or `ALL`) | — | Employment-group ref or `ALL`. Plan document §. |
| `APP.accrualRate`, `APP.formulaConstants` | — (APP) | decimal / json | — | Conditionally required for the formula type. Plan document §. |
| `APP.averagingPeriodYears` | — (APP) | integer | — | Conditionally required for average-pay formulas. |
| `APP.maxServiceYears`, `APP.serviceCap` | — (APP) | decimal | — | Conditionally required if a cap exists. |
| `APP.roundingRule` | — (APP) | string (rule ref) | — | Required. Plan document §, or "not stated — see 02 §B.9 gap G-6". A missing rounding rule is a recorded gap, not a default (see §12). |
| `APP.sourceCitation` | — (APP) | string | — | Plan document § + page. Required. |

### 3.5 Participant — census / demographic fields

BCV fields are authoritative; app fields cover only what the dictionary lacks (stable cross-extract key, record linkage, derived role).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `BCV_REC_ID` | ALL · `BCV_REC_ID` | NUMBER | System Generated | The app's stable key per record *within one load*. Never used for linkage across extracts — see `APP.participantKey`. |
| `CASE` | ALL · `CASE` | VARCHAR2(8) | Input | See §3.1. |
| `ID` | ALL · `ID` | VARCHAR2(1) | Input | 1 = Participant, 2 = Beneficiary, 4 = Alternate Payee. Official predicate 1000006 polices validity (rule S-05). |
| `SSN` | BCV1 · `SSN` | VARCHAR2 | Input | Dummy-SSN rule per dictionary (official dummy SSN if unknown and ID=1; `000000000` if ID=2 or 4). Never the app's stable key across extracts. PII — local only (§2.1). |
| `FNAME`, `MNAME`, `LNAME`, `ENAME` | BCV1 · `FNAME`, `MNAME`, `LNAME`, `ENAME` | VARCHAR2 | Input | LNAME required; others conditional. |
| `DOB` | BCV1 · `DOB` | DATE | Input | Official predicates 360–362 (rule P-02). |
| `PSEX` | BCV1 · `PSEX` | VARCHAR2(1) | Input | M / F / U. Official predicates 388–390 (rule P-11). U is permitted by the dictionary; it is a Warning, not a block. |
| `MSTAT` | BCV1 · `MSTAT` | VARCHAR2(1) | Input | M / S / D / W / U. Conditionally required for married-form / QPSA analysis. |
| `PHS` | BCV1 · `PHS` | VARCHAR2(1) | Input | 0 = Healthy, 1 = Disabled w/o SS, 2 = Disabled w/ SS. Conditionally required for disability benefits. Official predicates 239, 242–243. |
| `SOWN`, `SOMOS` | BCV1 · `SOWN`, `SOMOS` | VARCHAR2(1); NUMBER | Input | Y/N; months. Optional. |
| `DOM` | BCV1 · `DOM` | DATE | Input | Conditionally required (QPSA coverage charge). |
| `DOD` | BCV1 · `DOD` | DATE | Input | Conditionally required if deceased. |
| `SSSN`, `SFNAME`, `SMNAME`, `SLNAME`, `SENAME`, `SSEX`, `SDOB`, `SDOD` | BCV1 · (same names) | as dictionary | Input | Spouse fields. Conditionally required for married / survivor analysis. |
| `BSSN`, `BFNAME`, …, `BDOB`, `APSSN`, `APFNAME`, …, `APDOB`, `APSEX` | BCV9 · (same names) | as dictionary | Input | Beneficiary / AP fields. Conditionally required for ID=2 / ID=4 records. Official predicates 353, 355, 369–374, 391–396, 425–431 (rule P-10). |
| `RETSTAT` | ALL · `RETSTAT` | VARCHAR2(1) | Input | 1 Retired, 2 Separated Vested, 3 Active Vested, 4 Nonvested, 5 Not in valuation population. Official predicates 282, 333, 335–337, 350–351, 1000007 (rules S-04, X-02). |
| `RETTYP` | BCV3 · `RETTYP` | VARCHAR2 | Calculated | NR / ER / DR / DS / LR / SB. BCV calculation; a census value may carry the PA value — provenance must say which. |
| `APP.participantKey` | — (APP) | string | — | Stable across extracts. App-generated from (CASE + SSN + DOB) at first import. Collisions are quarantined (rule S-05). |
| `APP.recordRole` | — (APP) | enum: participant / beneficiary / alternate-payee | — | Derived from ID, with the ID=2-on-DOPT rule from the dictionary preserved verbatim. |

### 3.6 EmploymentPeriod — hire, termination, rehire, transfer history

The dictionary carries only a single DOH / DOTE pair per record; multiple periods are app-level structure built from census history, prior extracts, and plan records. Answer Book Ch. 7 (break in service, rehire, elapsed time) governs the semantics.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `DOH` | BCV1 · `DOH` | DATE | Input | Official predicates 214–220, 246, 259 (rule P-03). |
| `DOTE` | BCV1 · `DOTE` | DATE | Input | "Participant's Date of Termination of Employment (DOPT used for default RBD calculation when NULL and RETSTAT is '3' or '4')". Conditionally required except where the dictionary permits NULL — see §8 / rule M-01. Official predicates 221–227, 363 (rule P-04). **The DOPT-default note applies to the RBD calculation, not to PA_AMB.** Do not treat a blank DOTE as establishing that PA_AMB is measured at DOPT. |
| `DOP` | BCV1 · `DOP` | DATE | Input | Participation date. Conditionally required if participation date differs from hire. |
| `DOBF` | BCV1 · `DOBF` | DATE | Input | Participant's Date of Benefit Freeze (participant grain). Conditionally required if frozen. See §0.2 grain note. |
| `DOR` | BCV3 · `DOR` | DATE | Input | Actual retirement date. Conditionally required for RETSTAT=1 / pre-DOPT retirees. Official predicates 247–252, 261, 401–402 (rule P-05). |
| `POST_DOPT_DOTE` | BCV9 · `POST_DOPT_DOTE` | DATE | Input | Conditionally required (ongoing plans, working-retirement issue). A candidate measurement date — see §8 / rule M-06. |
| `APP.periodSeq` | — (APP) | integer | — | App-generated per participant, chronological. |
| `APP.periodType` | — (APP) | enum: initial-hire / rehire / transfer-in / transfer-out / leave | — | Census history / plan records / prior extracts. |
| `APP.periodStart`, `APP.periodEnd` | — (APP) | date | — | Derived from DOH/DOTE/rehire records; each period's source cited. |
| `APP.breakInService` | — (APP) | boolean + rule ref | — | Conditionally required when a gap between periods exists. Ch. 7 break-in-service rules; plan document §. |
| `APP.hoursPerPeriod` | — (APP) | decimal | — | Conditionally required for hours-based service plans. Payroll / plan records. |

### 3.7 CompensationHistory

The dictionary's salary history is BCV2 S001–S050 (S001 = most recent year's salary), bounded by FRSTYEAR / LASTYEAR. There is no per-year date field; year = `LASTYEAR − (n−1)` for S00n. That derivation is recorded explicitly per value, not silently assumed (rule S-10).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `FRSTYEAR` | BCV2 · `FRSTYEAR` | NUMBER | Input | Year (first salary year). |
| `LASTYEAR` | BCV2 · `LASTYEAR` | NUMBER | Input | Year (last salary year). |
| `S001`–`S050` | BCV2 · `S001`–`S050` | NUMBER | Input | Annual salary, dollars. Each year present or explicitly missing; S001 required when LASTYEAR is present. A blank S-year is missing, never zero (rule P-14). |
| `ANNACT` | BCV2 · `ANNACT` | VARCHAR2(1) | Input | A = Actual, B = Annualized (last year's salary). Conditionally required when LASTYEAR salary is present. |
| `SALARYDESC` | BCV2 · `SALARYDESC` | VARCHAR2 | Input | Source: W-2, Payroll Records, etc. |
| `CUCOMP` | BCV1 · `CUCOMP` | NUMBER | Input | Current monthly compensation. Conditionally required for active participants. |
| `PA_ACOMP` | BCV9 · `PA_ACOMP` | NUMBER | Input | "Plan Administrator Average Compensation at DOTE". Conditionally required when PA_AMB is present — it is the PA's own average-pay input. |
| `APP.salaryYear` | — (APP) | integer | — | Derived year for each S00n value, recorded explicitly per value. |
| `APP.compensationDefinitionApplied` | — (APP) | string (rule ref) | — | Which pay counts. Plan document §. |
| `APP.annualizedFlag` | — (APP) | boolean | — | Derived from ANNACT. |

### 3.8 ServiceHistory

The dictionary distinguishes PA-reported service (`CSPA` / `VSPA` / `ESPA`, all Input, "at DOTE") from BCV-calculated service (`CS` / `VS` / `ES`, Calculated via add-in functions). Both are retained; their difference is itself a diagnostic (rule X-07).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `CSPA` | BCV1 · `CSPA` | NUMBER | Input | PA credited/benefit service at DOTE. |
| `VSPA` | BCV1 · `VSPA` | NUMBER | Input | PA vesting service at DOTE. |
| `ESPA` | BCV1 · `ESPA` | NUMBER | Input | PA eligibility service at DOTE. Conditionally required if eligibility service affects the formula. |
| `CS` | BCV1 · `CS` | NUMBER | Calculated | Years credited service at DOTE (BCV add-in). Official predicates 276–278 (276 disabled — see 02 §0.5; re-stated as APP rule P-06). |
| `VS` | BCV1 · `VS` | NUMBER | Calculated | Years vesting service at DOTE. Official predicates 279–281, 420 (rule P-06). |
| `ES` | BCV1 · `ES` | NUMBER | Calculated | Years eligibility service at DOTE. |
| `VPPA` | BCV3 · `VPPA` | NUMBER | Input | "Plan Administrator's Calculated Vesting Percentage". Conditionally required when PA_AMB vesting treatment is in question (rule X-09). |
| `APP.serviceMeasure` | — (APP) | enum: years / months / hours / elapsed-time | — | Plan document §; Ch. 7. |
| `APP.servicePeriods` | — (APP) | list of (start, end, measure, source) | — | Conditionally required when service is reconstructed rather than taken from CSPA. |
| `APP.breaksApplied` | — (APP) | list of break-in-service applications | — | Conditionally required when breaks exist. Ch. 7; plan document §. |

### 3.9 BenefitObservation — the reported administrator benefit (central entity)

A BenefitObservation without an established measurement date is stored with `measurementBasis = unresolved` — it is never silently assigned DOTE, DOPT, or NRD. The measurement-date fields are defined in full in §8.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `PA_AMB` | BCV9 · `PA_AMB` | NUMBER | Input | "Plan Administrator Accrued Monthly Benefit at DOTE". Assumed monthly dollars, 2 dp — to be confirmed against the PA schedule at import (02 §0.4; rule S-09). Blank = missing, never zero (rule P-13; §7). |
| `BCV1.AMB` (cross-check) | BCV1 · `AMB` | NUMBER | Calculated | "Accrued Monthly Benefit at DOTE". The PBGC-calculated counterpart — the core comparison pair is PA_AMB (Input, BCV9) vs AMB (Calculated, BCV1), both "at DOTE". AMB is a cross-check, not the independent calculation itself (§3.10). |
| `PA_AMB_ACCEPT` | BCV3 · `PA_AMB_ACCEPT` | VARCHAR2(1) | (New, Release 6.3; no I/C tag) | "Indicator for identifying when plan administrator's AMB is being accepted (Y/N)". **Output only.** Populated only after a determination; must never be set before the determination exists (rule C-09). Set only by an `ActuarialDecision` (§3.14). |
| `APP.measurementDate` | — (APP) | date | — | See §8. Required; if unknown, `APP.measurementBasis = unresolved` and no Δ is computed. |
| `APP.measurementBasis` | — (APP) | enum: dote / dopt / nrd / other-stated / unresolved | — | Established by rules M-01–M-06. |
| `APP.annuityForm` | — (APP) | enum (BCV FORM_CODE values) | — | Conditionally required for comparison; if unknown, the basis is unresolved (rule X-10). PA_AMB's form is not recorded in any BCV field. |
| `APP.vestingTreatment` | — (APP) | enum: gross / vested / unknown | — | Required. Unknown is a valid stored value — it is not defaulted (rule X-09). |
| `APP.recordedDate` | — (APP) | date | — | When the PA recorded the amount. Distinct from the measurement date (§8; rule M-02). Conditionally required when known. |
| `APP.sourceScheduleRow` | — (APP) | string | — | Schedule + row/cell/page. Required. Every census PA_AMB must trace to a schedule row (rule C-01). |
| `APP.observationType` | — (APP) | enum: census / schedule / valuation-report / payment-record | — | Source type. Required. |

**What the dictionary does NOT state about PA_AMB (02 §0.4, 00 §1.3) — carried as schema unknowns, never assumed:** annuity form; vesting treatment (gross vs vested); normal-retirement / NRD basis; rounding / precision; what a blank means (ruled: missing, never zero); for which RETSTAT values PA_AMB is expected to be populated. The Answer Book Ch. 9, Q 9:7 definition of accrued benefit generally ("before the application of a vesting schedule", monthly, in the plan's normal form at normal retirement age) is a textbook statement (hierarchy level 5) and must not be read into the PA_AMB field.

### 3.10 BenefitCalculation — independently calculated benefit and trace (engine output)

Calculation rules belong to the engine (Stage 4); this entity defines what must be stored so a calculation is reproducible and auditable. Its canonical shape is given here so imports and cross-checks do not confuse it with an observation.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.calculationId` | — (APP) | string | — | App-generated. |
| `APP.participantKey` | — (APP) | string (ref) | — | → Participant. |
| `APP.formulaId`, `APP.planVersionId` | — (APP) | string (refs) | — | Formula / PlanVersion in force at the measurement date. |
| `APP.measurementDate` | — (APP) | date | — | Same basis as the BenefitObservation it is compared with; otherwise the comparison is invalid (rule M-05). |
| `APP.calculatedMonthlyBenefit` | — (APP) | decimal(18,2) | — | Engine output. Null when no exact benefit can be produced — see §9.4 (bounds instead). |
| `APP.benefitBounds` | — (APP) | json: { min, max, assumptions } | — | Justified bounds Bᵢ^min ≤ Bᵢ^possible ≤ Bᵢ^max (§12 of the governing spec). Present when an exact benefit cannot be produced but bounds can. |
| `APP.intermediateSteps` | — (APP) | json (ordered trace) | — | Service, compensation, base formula, caps, offsets, rounding. Every intermediate step inspectable (governing spec §8). |
| `APP.roundingApplied` | — (APP) | string (rule ref + sequence) | — | Formula.roundingRule. |
| `APP.inputsSnapshotId` | — (APP) | string (ref) | — | → CalculationRun. Input snapshot hash. |
| `APP.calculationStatus` | — (APP) | enum: complete / partial / blocked / indeterminate | — | Driven by validation outcomes and the §12 five-way split. |

**BCV-calculated benefit fields usable as cross-checks only** (never as the independent calculation itself, and never compared to PA_AMB without a basis conversion — rule C-03): `AMB` (BCV1, Calculated, at DOTE); `TERM_MB_ERD_NSF`, `TERM_MB_EURD_NSF`, `TERM_MB_NRD_NSF` (BCV1, Calculated); `XRD_MB_TERM` (BCV1, Calculated). These are different bases from PA_AMB (ERD/EURD/NRD/XRD vs DOTE). Official predicates 228–237, 306–319, 432 police these fields' presence and range; they are reference data for cross-source checks, not validation rules of this system.

### 3.11 BenefitComparison (engine output)

Δᵢ = Bᵢ^PA − B̂ᵢ; Dᵢ = |Δᵢ|; Rᵢ = Δᵢ / B̂ᵢ only when the denominator is meaningful (zero/near-zero denominators are flagged, never divided).

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.comparisonId` | — (APP) | string | — | App-generated. |
| `APP.observationId`, `APP.calculationId` | — (APP) | string (refs) | — | — |
| `APP.delta`, `APP.absDelta`, `APP.relDelta` | — (APP) | decimal | — | `relDelta` conditional — only when B̂ᵢ is non-zero and meaningful. |
| `APP.comparisonBasis` | — (APP) | enum: same-basis / basis-converted / unresolved | — | Established by M-05. `unresolved` comparisons are stored but marked not-comparable. **When `comparisonBasis = unresolved`, no Δ is computed** (§8). |
| `APP.toleranceApplied` | — (APP) | string (tolerance rule id + $/%) | — | Case tolerance record (§4.1, dataset item M-7). A comparison without a recorded tolerance is incomplete. The 5.8-1 $1/$5 figures are stored in separate reference fields and never conflated with this tolerance. |
| `APP.withinTolerance` | — (APP) | boolean | — | Computed. |
| `APP.reconciliationStatus` | — (APP) | enum: matched / within-tolerance / material-difference / not-comparable / indeterminate | — | Computed + reviewer-confirmed. |

### 3.12 DiagnosticHypothesis, payment / contribution / QDRO cross-check fields

Hypothesis types are a closed list from governing spec §10 — no coined types: measurement-date / service / compensation / averaging-period / accrual-rate / amendment / grandfather-floor / cap / freeze / integration / distribution / vesting / annuity-form / retirement-date / rounding / missing-information / administrator-error. A hypothesis with no documentary evidence is labelled `numerical-coincidence`, never `supported`.

Fields that enter the comprehensive dataset as cross-checks (02 §A.3.2 C-8, C-10, C-11) and their BCV mapping:

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `PAY_AMT1`, `PAY_AMT2` | BCV3 · `PAY_AMT1`, `PAY_AMT2` | NUMBER | Input (per 02 §A.3.2 C-8) | Payment records. Begin/end dates travel with them. Rule C-04. |
| `LS_EST_AMT`, `LS_EST_DATE` | BCV3 · `LS_EST_AMT`, `LS_EST_DATE` | NUMBER / DATE | Input (per 02 §A.3.2 C-8) | Prior lump-sum estimates. Rule C-05. |
| `PARTIAL_DIST_AMT`, `PARTIAL_DIST_DATE` | BCV3 · `PARTIAL_DIST_AMT`, `PARTIAL_DIST_DATE` | NUMBER / DATE | Input (per 02 §A.3.2 C-8) | Prior partial distributions. Rule C-05. |
| `MANDC`, `MANDCWI`, `VOLC`, `VOLCWI` | BCV1/BCV4 · `MANDC`, `MANDCWI`, `VOLC`, `VOLCWI` | NUMBER | Input (per 02 §A.3.2 C-11) | Employee contributions. Rule X-03, X-13. BCV table split (BCV1 vs BCV4) as stated in 02 §A.3.2 C-11; re-verify against the dictionary index before implementation (§12). |
| `PVRETEEC` | BCV4 · `PVRETEEC` | NUMBER | Calculated (per 02 §A.3.2 C-11) | Present value of returned employee contributions. |
| `CASH_BAL_DOPT` | BCV1 · `CASH_BAL_DOPT` | NUMBER | (per 02 rule X-13) | Cash-balance amount at DOPT. Rule X-13. |
| `PIA` | BCV1 · `PIA` | NUMBER | Input | "From Plan Administrator". Rule X-08. Required iff the governing formula uses a Social Security offset. |
| `PA_QPSAF` | BCV3 · `PA_QPSAF` (per 02 §A.3.2 C-4) | NUMBER | Input | Listed in 02 §A.3.2 C-4 alongside PA_ACOMP, PIA, VPPA. BCV table stated there as BCV9/BCV1/BCV3 collectively; the exact table for PA_QPSAF was not separately verified — see §12 open decision. |
| `QDRO_TYPE` (+ AP fields in §3.5) | BCV9 · `QDRO_TYPE` | VARCHAR2 | Input | QDRO records where applicable (ID=4). 02 §A.3.2 C-10. |
| `FORM_CODE`, `FORM_CODE_NSF`, `FORM_CODE_NMF`, `FORM_CODE_QPSA`, `FORM_CODE_ARD` | BCV1 · (same names) | VARCHAR2 | Calculated | Form-code validity and consistency. Official predicates 200–203, 209–213, 264–274, 320–331, 375–380, 385–387 (rule X-11). |
| `ANB`, `SANB` | BCV1 · `ANB`, `SANB` | NUMBER | Calculated | Age nearest birthday at DOPT (participant / spouse). Official predicates 283–286 (rule P-07). |
| `NRD` | BCV1 · `NRD` | DATE | Calculated (add-in RETDATE) | Normal Retirement Date. Official predicates 304–305 (rule P-08). PA_AMB's description does not reference NRD (§3.9). |
| `VP` | BCV1 · `VP` | NUMBER | Calculated | Participant's vesting percent at DOTE (enter as fraction, e.g. 1 not 100). Distinct from VPPA (PA's vesting %, BCV3 Input). |

### 3.13 SourceDocument

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.documentId` | — (APP) | string | — | App-generated. |
| `APP.documentType` | — (APP) | enum: plan-document / amendment / restatement / census-file / pa-schedule / valuation-report / payment-record / r5-output / del-output / pf-output / actuarial-memo / policy / guidance / reference-book / other | — | Closed list; `other` requires a description. |
| `APP.title` | — (APP) | string | — | Document itself. |
| `APP.fileHash` | — (APP) | string (SHA-256) | — | Computed at import. |
| `APP.location` | — (APP) | string | — | Drive path / local path / file id. |
| `APP.versionDate`, `APP.effectiveDate` | — (APP) | date | — | Conditional. Document itself. |
| `APP.reliabilityGrade` | — (APP) | enum: high / medium / low / unassessed | — | Assessed per rule C-10 (internal-controls evidence); default `unassessed`, never defaulted to high. |

### 3.14 ActuarialDecision

Dispositions are the §14 proposed application states (Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate) — labelled as application states, not official PBGC classifications. The human decision is the only thing that sets `PA_AMB_ACCEPT`.

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.decisionId` | — (APP) | string | — | App-generated. |
| `APP.participantKey` | — (APP) | string (ref) | — | → Participant. |
| `APP.disposition` | — (APP) | enum: verified / supported-for-acceptance / requires-investigation / correction-recommended / indeterminate | — | Reachability enforced per §6 / 02 §A.7. An out-of-reach disposition is rejected at entry, not corrected after the fact. |
| `APP.recordedBenefit`, `APP.calculatedBenefit`, `APP.correctedBenefit` | BCV9 · `PA_AMB` / — / — | NUMBER | Input / — / — | Recorded = BenefitObservation; calculated = BenefitCalculation (conditional); corrected = reviewer entry (conditional). |
| `APP.rationale` | — (APP) | string | — | Reviewer-written. Required. |
| `APP.missingEvidence`, `APP.assumptions`, `APP.sensitivity` | — (APP) | string | — | Reviewer-written. Required; empty means "none", stated explicitly. |
| `APP.reviewer`, `APP.decisionDate` | — (APP) | string / date | — | Reviewer identity + date. Required. |
| `PA_AMB_ACCEPT` | BCV3 · `PA_AMB_ACCEPT` | VARCHAR2(1) | (New, Release 6.3) | Set only by this decision (rule C-09). Y ⟺ verified / supported-for-acceptance; N ⟺ correction-recommended / indeterminate-with-rejection, per the reviewer's rationale. |

### 3.15 CalculationRun

| Canonical field | BCV table + field | BCV type | BCV class | Notes |
|---|---|---|---|---|
| `APP.runId` | — (APP) | string | — | App-generated. |
| `APP.ruleVersion` | — (APP) | string | — | Validation-rule catalog version + formula-taxonomy version. |
| `APP.inputSnapshotHash` | — (APP) | string (SHA-256) | — | Over all input files + mapping. Computed at run start. |
| `APP.runDate`, `APP.runBy` | — (APP) | date / string | — | System + user. |
| `APP.participantScope` | — (APP) | string | — | All / subset definition. Recorded. |
| `APP.resultsHash` | — (APP) | string | — | Computed at run end. |
| `APP.schemaVersion` | — (APP) | string | — | This schema's version (§1.4). A run records the schema it ran under. |

---

## 4. Minimal vs comprehensive datasets — canonical shapes

### 4.1 Minimal dataset (8 items, 02 §A.3.1)

"Minimal" means: without any of these, no participant-level verification is possible at all. A case that fails the minimal set is graded **Insufficient** (§6) and the only available dispositions are `requires-investigation` or `indeterminate`.

| # | Item | Canonical shape | Source |
|---|---|---|---|
| M-1 | Case identity (CASE) + DOPT + plan name/number | `CaseRecord` (§3.1): `CASE`, `APP.dopt`, `APP.planName`, `APP.planNumber` — all present, `CASE` as text | Case file / R5 header |
| M-2 | Census file, per participant: BCV_REC_ID, ID, SSN, LNAME, DOB, PSEX, RETSTAT, DOH, DOTE (or documented NULL), DOBF if frozen | `ParticipantRecord` (§3.5) + `EmploymentPeriod` (§3.6) — the listed fields present or explicitly missing with a reason code (§7); a DOTE blank is a missing entry, not an absent field | Census (BCV1/ALL) |
| M-3 | PA_AMB per participant (or an explicit statement that the PA reported no benefit for that participant — a blank with no statement is missing, not zero) | `BenefitObservation` (§3.9): `PA_AMB` present, or `PA_AMB` null + a missing entry (§7) + an explicit no-benefit statement recorded as a `SourceDocument` reference where one exists | Census BCV9 + PA schedule |
| M-4 | PA service at DOTE: CSPA, VSPA | `ServiceHistory` (§3.8): `CSPA`, `VSPA` present or explicitly missing (§7) | Census BCV1 |
| M-5 | Governing plan provisions in force at DOTE: formula type, accrual rate, compensation definition, averaging period, vesting schedule, normal forms | `PlanVersionRecord` (§3.3) + `FormulaRecord` (§3.4) in force at DOTE — at least one version covering DOTE, with formula type, accrual rate, compensation definition, averaging period, vesting schedule, normal forms all present | Plan documents (R5 output where available) |
| M-6 | Measurement-date evidence for PA_AMB: the PA schedule page/section stating the date the amounts were calculated through, or a documented DOTE basis | `BenefitObservation` measurement-date fields (§8): `calculatedThroughDate` + `calculatedThroughStatement`, or a documented DOTE basis with evidence link. If neither exists, `measurementBasis = unresolved` (§8). | PA schedule |
| M-7 | Tolerance record for this case: the $/% tolerance adopted, its authority, and who approved it | `ToleranceRecord` (below) — present and approved before any comparison is computed. A comparison without a recorded tolerance is incomplete (§3.11). | Case decision record |
| M-8 | Salary history sufficient to compute the plan's average compensation (S001–S050 + FRSTYEAR/LASTYEAR, or PA_ACOMP with its own provenance) | `CompensationHistory` (§3.7): S-years + FRSTYEAR/LASTYEAR present for the averaging period, or `PA_ACOMP` present with its own provenance and averaging period documented | Census BCV2 / PA schedule |

```typescript
interface ToleranceRecord {
  toleranceId: string;
  caseId: string;                    // → CaseRecord
  absoluteToleranceDollars: number | null;  // monthly dollars, e.g. null if relative-only
  relativeTolerancePercent: number | null;  // e.g. null if absolute-only
  toleranceAppliesTo: "delta" | "relative-delta" | "both";
  authority: string;                 // case decision — NOT Policy 5.8-1 unless the case actuary explicitly adopts it
  approvedBy: string;
  approvedDate: string;              // ISO-8601 date
  // Reference only, stored separately and never conflated with the tolerance above:
  policy581Reference: {
    increaseAtDetermination: string; // "$1.00 or more" (Policy 5.8-1 D.1, issue date 10/02/2014)
    decreaseAtDetermination: string; // "$1.00 or more" (D.1)
    increaseAfterEffective: string;  // "$1.00 or more" (D.3.a)
    decreaseAfterEffective: string;  // "$5.00 or more" (D.3.a)
    scopeNote: string;               // "Governs correcting PBGC benefit determinations/payments. Does NOT govern PA_AMB acceptance."
  } | null;
}
```

**No built-in acceptance tolerance.** The app ships with no built-in acceptance tolerance. If a case has no approved tolerance record, no comparison is computed as "within tolerance" — `APP.withinTolerance` stays null and the disposition `verified` is unreachable. A default tolerance, if a future version provides one, must be explicitly labelled as a default, not as a PBGC rule.

### 4.2 Comprehensive dataset (14 items, 02 §A.3.2)

Comprehensive = minimal plus everything needed for exact reconstruction. Each item maps to canonical shapes already defined in §3; the table states which.

| # | Item | Canonical shape |
|---|---|---|
| C-1 | All minimal items | §4.1 |
| C-2 | Full employment history: all periods, rehires, transfers, leaves, breaks in service, hours | `EmploymentPeriod[]` (§3.6) — every period with `APP.periodType`, `APP.periodStart/End`, `APP.breakInService`, `APP.hoursPerPeriod` where applicable |
| C-3 | Full salary history with no gaps across the averaging period + FRSTYEAR/LASTYEAR + ANNACT + SALARYDESC | `CompensationHistory` (§3.7) — every S-year in the averaging period present (no missing entries inside the period) |
| C-4 | PA_ACOMP, PIA, VPPA, PA_QPSAF | `CompensationHistory.PA_ACOMP` (§3.7); `PIA` (§3.12); `ServiceHistory.VPPA` (§3.8); `PA_QPSAF` (§3.12 — BCV table to confirm, §12) |
| C-5 | Complete PlanVersion chain: adoption, all restatements and amendments with adoption + effective dates, grandfathering | `PlanVersionRecord[]` (§3.3) — unbroken chain from adoption to DOPT, each with `APP.adoptionDate`, `APP.effectiveDate`, `APP.grandfatheredGroups` where applicable |
| C-6 | Prior valuation reports (with XRD_MB_TERM, TERM_MB_*_NSF, LS_TERM, PVMB_* for cross-source checks) | `SourceDocument` (type `valuation-report`) + cross-check fields (§3.10). Cross-checks only — never the independent calculation. |
| C-7 | PA benefit calculation schedules (participant-level arithmetic, not just the final PA_AMB) | `SourceDocument` (type `pa-schedule`) + `BenefitObservation` per row (§2.6), with the schedule's arithmetic retained as evidence on the observation |
| C-8 | Payment records: PAY_AMT1/PAY_AMT2 with begin/end dates, LS_EST_AMT/DATE, PARTIAL_DIST_AMT/DATE | §3.12 fields, each with its dates |
| C-9 | Prior distributions and offsets (Answer Book Ch. 16 Q 16:7 — especially for rehires) | §3.12 fields + `SourceDocument` (type `payment-record`); linked to the affected `EmploymentPeriod` where the distribution relates to a rehire |
| C-10 | QDRO records where applicable (ID=4, AP fields, QDRO_TYPE) | §3.5 AP fields + `QDRO_TYPE` (§3.12) |
| C-11 | Employee contributions: MANDC, MANDCWI, VOLC, VOLCWI, PVRETEEC | §3.12 fields |
| C-12 | All non-census inputs of §5 | §5 — each as a `NonCensusInput` with provenance and effective dates |
| C-13 | Prior census snapshots for longitudinal reconciliation | §2.5 — separate `CalculationRun` snapshots, never merged without reconciliation (rules L-01–L-08) |
| C-14 | R5, DEL, PF, and §436 outputs for the same case where they exist | `SourceDocument` (types `r5-output`, `del-output`, `pf-output`) + the §436 output as a source document; provisions from R5 feed §3.2–§3.4, factors from PF feed §5 |

---

## 5. Non-census inputs (8 inputs, 02 §A.4)

These are plan-wide or reference inputs the census does not contain. Each is a first-class input with its own provenance and effective dates; none is embedded as a magic number. Canonical shape for all eight:

```typescript
interface NonCensusInput {
  inputId: string;
  inputKind:
    | "covered-compensation-table"
    | "social-security-assumptions"
    | "plan-wide-salary-definition"
    | "formula-constants"
    | "historical-statutory-limits"
    | "annuity-conversion-assumptions"
    | "historical-valuation-data"
    | "mortality-table-for-equivalence";
  title: string;
  effectiveFrom: string | null;      // ISO-8601 date; null only if the input has no date scope (stated, not assumed)
  effectiveTo: string | null;
  sourceDocumentId: string;          // → SourceDocument; required — an input with no source is not loadable
  authority: string;                 // e.g. "SSA table as incorporated in plan document §X", "IRS publication", "PF generator output"
  payload: Record<string, unknown>;  // the table / constants, in the shape stated per input below
  provenance: string;                // precise location inside the source document
}
```

| # | Input | Canonical shape (`payload`) | Where it comes from | Status (Stage 1) |
|---|---|---|---|---|
| 1 | Covered compensation tables | Year-by-year covered compensation by year of birth: `{ birthYear: number; tableYear: number; coveredCompensation: decimal }[]` | Social Security Administration tables, as incorporated in the plan document. The plan document's table (or its incorporation by reference) governs. | **NOT YET SOURCED** — no covered-compensation table was found in the Book of Job material reviewed (02 gap G-3). The input slot exists; it must not be filled with invented values. |
| 2 | Social Security assumptions | PIA basis, bend points, wage-index assumptions used by the PA: `{ bendPoints: { year: number; first: decimal; second: decimal }[]; wageIndexBasis: string; piaSource: string }`. PIA itself is a census Input (BCV1 `PIA`, "from Plan Administrator") — see §3.12. | PA schedule / plan document. SSA bend points are reference data, not BCV fields. | **PARTIAL** — PIA field exists; bend-point tables not yet sourced (02 gap G-3). |
| 3 | Plan-wide salary definitions | Which pay counts (base, bonus, overtime, commissions), compensation caps, annualization rules: `{ includedPayTypes: string[]; excludedPayTypes: string[]; compensationCap: decimal \| null; annualizationRule: string }` | Plan document §; R5 provisions. | Sourced per case from plan documents. |
| 4 | Formula constants | Accrual rates, tier thresholds, step rates, maximum service, grandfathered floors: `{ accrualRate: decimal \| null; tierThresholds: json; maxServiceYears: decimal \| null; grandfatheredFloor: decimal \| null }` | Plan document §; `FormulaRecord` (§3.4). | Sourced per case from plan documents. |
| 5 | Historical statutory limits | IRC §401(a)(17) compensation limit by year; IRC §415(b) maximum benefit by year; OBRA '93 frozen limits: `{ year: number; section401a17Limit: decimal \| null; section415bLimit: decimal \| null; obra93FrozenLimit: decimal \| null }[]` | IRS-published limits (statute/regulation, hierarchy level 1). | **NOT YET SOURCED** — no limits table found in reviewed material (02 gap G-4). Values must come from IRS publications, never invented. |
| 6 | Prior annuity conversion assumptions | Early/late retirement factors, benefit conversion factors by era (ERF/LRF/BFCF), mortality and interest bases: `{ era: string; factorType: "ERF" \| "LRF" \| "BFCF"; mortalityBasis: string; interestBasis: string; factors: json }[]` | PF generator output for the case; plan documents; BCV add-in functions ERFAEQ / LRFAEQ / BFCFAEQ. | Sourced per case from PF output / plan documents. |
| 7 | Historical valuation data | Prior valuation reports: liabilities, XRD_MB_TERM, TERM_MB_*_NSF, LS_TERM, PVMB_TITLE_IV / PVMB_4022C / PVMB_TERM, assumptions: `{ valuationDate: string; liabilities: json; calculatedBenefits: json; assumptions: json }` | Prior valuation reports (`SourceDocument` type `valuation-report`). | Sourced per case. Cross-checks only (§3.10). |
| 8 | Mortality tables for equivalence | Table names/codes used in conversions: `{ tableCode: string; tableName: string; source: string }[]` — e.g. GM83, GF83, UP84 (confirmed in BCV_ATPBGC_Add-ins.pdf, Jul 2024); UP84M2 (confirmed in a second PBGC source, the V1 engine file for the same case). | Add-in doc; plan document. Codes live in the ATPBGC MORTNAME table (via MORTCODE / MORTDESC). | Codes must come from a PBGC source; never coined (standing rule). The add-in doc has no full code list — see §12. |

---

## 6. Completeness grades — defined in schema terms

Grades are assigned **per participant** (for exact reconstruction) and **per case** (for the population). A grade is a property of the evidence, not of the participant. The grade is stored on the participant record as `APP.completenessGrade` with the reason (which fields are missing, which missing-data class each falls in).

```typescript
type CompletenessGrade = "complete" | "partial" | "insufficient" | "excluded";
interface ParticipantRecord {
  // ... fields from §3.5–§3.8 ...
  completenessGrade: CompletenessGrade;
  gradeReason: string;               // which fields are missing / unresolved, and their §A.6 classes
  gradeDeterminedBy: string;         // rule version + run id that assigned the grade
}
```

### 6.1 What each grade means in schema terms

| Grade | Schema condition (per participant) | Permits | Blocks |
|---|---|---|---|
| **Complete** | Every field required for exact reconstruction under the governing `PlanVersion` is present, valid, and provenance-traced; `measurementBasis` is established (not `unresolved`); the governing formula is identified (`APP.formulaId` present); no required field carries a missing entry (§7) in classes (a) or (e); no unresolved Warning blocks acceptance (02 §B.7 item 3). | Exact reconstruction. Dispositions `verified`, `correction-recommended` available (with established basis + agreement within the documented case tolerance for `verified`). | Nothing — except that `verified` additionally requires agreement within the case tolerance and an established basis. |
| **Partial** | At least one required input is missing, but every missing input falls in §A.6 classes (b) recoverable, (c) boundable, or (d) assumable — and the resulting uncertainty is quantified (bounds Bᵢ^min ≤ Bᵢ^possible ≤ Bᵢ^max, or a labelled assumption-based estimate with sensitivity shown). The measurement basis may be established or unresolved (see §6.2). | Reconstruction as a range or under stated assumptions. Disposition `supported-for-acceptance` (if PA_AMB lies inside justified bounds and evidence supports it) or `requires-investigation`. `correction-recommended` only if the bounds collapse to a single defensible value under stated assumptions. | `verified` is unreachable. An exact `calculatedMonthlyBenefit` is not produced — bounds or a labelled estimate instead (§9.4). |
| **Insufficient** | At least one required input is missing and falls in class (e) — reconstruction indeterminate — **or** the measurement basis is unresolved, **or** the governing formula cannot be identified (`APP.formulaId` absent with no identifiable formula). | Only `requires-investigation` or `indeterminate`. A PA_AMB is never accepted on an Insufficient record. No calculated benefit is produced. | Exact reconstruction, bounds (unless the basis uncertainty itself can be bounded — see §6.2), `verified`, `supported-for-acceptance`, `correction-recommended`. |
| **`excluded`** (case-level grading only) | RETSTAT = 5 (not in valuation population). | Exclusion from the population, with the reason recorded. | Any disposition. Excluded records are graded separately and counted separately in every report. |

### 6.2 Grade × measurement basis — what each combination permits

This is the schema-level restatement of the disposition-reachability matrix (02 §A.7). The app must refuse a disposition outside the reachable set, with the reason shown.

| Completeness grade | Measurement basis (§8) | Reachable dispositions (§14) | What the system produces |
|---|---|---|---|
| Complete | Established (DOTE, or other stated basis with evidence) | Verified · Supported for acceptance · Requires investigation · Correction recommended | Exact reconstructed benefit B̂ᵢ + comparison Δᵢ against the case tolerance |
| Partial (classes b/c/d only) | Established | Supported for acceptance · Requires investigation · Correction recommended | Justified bounds Bᵢ^min / Bᵢ^max and/or assumption-based estimate, labelled as such; PA_AMB evaluated against the feasible range; sensitivity shown |
| Partial (classes b/c/d only) | Unresolved | Requires investigation · Indeterminate | Bounds only if the basis uncertainty itself can be bounded (e.g. benefit recomputed at each candidate date as scenarios); otherwise no calculated benefit, only the documented gap |
| Insufficient (any class-e gap) | Established or unresolved | Requires investigation · Indeterminate | No calculated benefit. Documented evidence list, missing-evidence list, prioritised data request (§12 of the governing spec) |
| Complete or Partial | Unresolved **and** the PA_AMB is the only benefit evidence | Requires investigation · Indeterminate | No comparison is valid — a comparison requires equivalent bases (governing spec §3). The record is held, not compared. |
| Any grade | RETSTAT = 5 | (Out of scope — no disposition) | Excluded; graded `excluded`, reason recorded |

Notes (from 02 §A.7, restated as schema rules):

- `Verified` requires Complete + established basis + agreement within the documented case tolerance. Nothing less can be Verified.
- `Supported for acceptance` is the Partial-grade acceptance path: the evidence supports accepting the PA_AMB even though exact reconstruction is impossible. It is a positive, evidence-based decision, not a default.
- `Correction recommended` requires sufficient evidence for a specific corrected benefit (and the "reasonably certain" standard, 02 rule C-08). On an Insufficient record it is unreachable.
- `Requires investigation` vs `Indeterminate`: investigation means a concrete next step exists (a document to request, a hypothesis to test); indeterminate means the evidence as it stands cannot support a conclusion and no further step is currently identified. The reviewer chooses; the system records which and why.
- The matrix is enforced at the `ActuarialDecision` entity (§3.14): an out-of-reach disposition is rejected at entry, not corrected after the fact.

### 6.3 Case grade

- The case is **Complete** only if every in-scope participant is Complete.
- **Partial** if any participant is Partial and none is Insufficient.
- **Insufficient** if any in-scope participant is Insufficient.
- In-scope = RETSTAT 1–4 (valuation population); RETSTAT 5 records are out of scope and graded `excluded`.

---

## 7. How blanks are represented — missing-value representation

### 7.1 The rule

**A blank is `null` with a missing-reason code. Never zero unless a governing rule says so.** No field is defaulted to zero, to DOPT, or to any other value unless a governing rule (cited in the rule) requires it (02 §A.1.1, rule P-13, governing spec §7). This applies to every nullable field in the canonical layer: money, dates, service, salary years, codes.

### 7.2 Representation

Each nullable canonical field is stored as `null` when missing, and the missingness is recorded once, in the package-level `MissingRegistry`, keyed by participant + field. The registry entry carries the reason, the §A.6 class, and the provenance of the blank itself (the source location where the blank was observed — a blank in a named cell is evidence, not absence of evidence).

```typescript
type MissingReasonCode =
  | "NOT_REPORTED"          // field blank in the source, no statement about it
  | "NOT_APPLICABLE"        // field does not apply to this participant (e.g. DOTE for an active; spouse fields for a single participant)
  | "NOT_YET_OBTAINED"      // known to exist, requested, not yet received
  | "RECOVERABLE_ELSEWHERE" // exists in another source in the case file, not yet recovered
  | "CONFLICTING_SOURCES"   // sources disagree, or the value is unreadable / ambiguous
  | "NOT_STATED_BY_SOURCE"  // the source (e.g. PA schedule) does not state it — e.g. annuity form, vesting treatment
  | "INDETERMINATE";        // no source states it and no bound or defensible assumption exists

type MissingDataClass = "a" | "b" | "c" | "d" | "e"; // 02 §A.6 five-way split

interface MissingEntry {
  participantKey: string;
  field: string;                 // canonical field name, e.g. "PA_AMB", "DOTE", "S023"
  reasonCode: MissingReasonCode;
  missingClass: MissingDataClass; // (a) required for exact reconstruction · (b) recoverable · (c) boundable · (d) requires assumption · (e) indeterminate
  sourceLocation: string;        // file + row/cell (or document + page) where the blank was observed
  detail: string;                // what was looked for and not found, in one sentence
  recordedAt: string;            // ISO-8601 timestamp (import metadata only)
  resolution?: string;           // filled when recovered / bounded / assumed, with evidence link; original entry retained
}

interface MissingRegistry {
  entries: MissingEntry[];
}
```

These reason codes are **application-defined** (`APP`) codes for this system. They are not PBGC codes — no PBGC missing-reason code list was found in Stage 1 — and they must never be presented as PBGC codes.

### 7.3 Missing-reason codes — definitions and use

| Code | Meaning | Which fields it applies to | Completeness effect |
|---|---|---|---|
| `NOT_REPORTED` | The field is blank in its source and the source makes no statement about it. The common case: a blank PA_AMB with no statement that the PA reported no benefit (rule P-13). | Any field, most commonly `PA_AMB`, `CSPA`, S-years, `PIA`. | Class (a) by default; re-classified to (b)/(c)/(d)/(e) when the investigation establishes which. |
| `NOT_APPLICABLE` | The field does not apply to this participant. This is **not** missing data for grading purposes — the field is excluded from the required set for that participant. | `DOTE` for RETSTAT=3 actives (legitimate blank, rule M-01); spouse/beneficiary/AP fields where no spouse/beneficiary/AP exists; `DOR` for non-retirees; `DOBF` where the plan is not frozen. | No grade effect. Must not be counted as a gap in any report. |
| `NOT_YET_OBTAINED` | The value is known to exist (a document or record that should hold it is identified) but has not been received. | Any field with an identified outstanding data request. | Class (a) until obtained; the data request is prioritised by expected effect on the decision (governing spec §12). |
| `RECOVERABLE_ELSEWHERE` | The value exists in another source already in the case file. | E.g. CSPA missing in census but stated on the PA benefit schedule (02 §A.6 class (b) example). | Class (b). Recovery is auditable (both provenances recorded) and the participant is re-graded. |
| `CONFLICTING_SOURCES` | Two or more sources give different values, or the value is unreadable/ambiguous in its source. | Any field; commonly dates (DOTE, DOB) and PA_AMB (census vs schedule, rule C-02). | Class (a) until resolved; the conflict itself is a validation finding, not a value. Never resolved by averaging or by silently picking one source. |
| `NOT_STATED_BY_SOURCE` | The source does not state the item at all. The dictionary-level unknowns live here. | `APP.annuityForm`, `APP.vestingTreatment` (no BCV field records them); rounding rule where the plan document is silent (02 gap G-6); the PA schedule's as-of statement where the schedule states none (rule M-02). | Class (a) or (e) depending on whether the item can be established another way; if it cannot, class (e). |
| `INDETERMINATE` | No source states the item and no bound or defensible assumption exists. | Any field where the investigation has exhausted the case file. | Class (e). Participant is Insufficient (§6.1). |

### 7.4 Rules

1. A missing entry is created at import for every blank in a required or conditionally-required field. A blank in an optional field gets an entry only if the field is later needed (e.g. an optional field becomes required when a condition fires).
2. A missing entry is never deleted. When the value is recovered, bounded, or assumed, the entry gains a `resolution` with the evidence link; the original entry remains in the audit log (02 §B.0.2).
3. A class-(d) assumption is never presented as a fact; the result it feeds is labelled an estimate, with sensitivity shown.
4. A class-(c) bound is a mathematically justified bound under stated assumptions, not a statistical confidence interval relabelled.
5. The one legitimate zero: a blank PA_AMB for a RETSTAT=4 (nonvested) participant with VSPA below the vesting threshold **may** be a legitimate zero benefit — but that is a documented determination (rule X-09, recorded as an `ActuarialDecision` with rationale), not a default. Until that determination exists, the blank is `NOT_REPORTED`, class (a).
6. Salary years: a blank S-year inside FRSTYEAR–LASTYEAR is a missing entry (rule P-14), never zero. A gap inside the averaging period is an Error; a gap outside it is a Warning.

---

## 8. How an unresolved measurement date is represented

### 8.1 The rule

A recorded amount without an established benefit measurement date has an unresolved comparison basis (governing spec §5). **When the measurement date is unresolved, `comparison_basis = UNRESOLVED` and no Δ is computed** — the comparison is stored but marked not-comparable (02 rule M-05). The record is held, not compared. The DOPT-default note on BCV1.DOTE applies to the RBD calculation, not to PA_AMB, and must never be used to supply a measurement date.

### 8.2 The schema fields that carry measurement-date state

All on `BenefitObservation` (§3.9). No other entity carries measurement-date state; the `BenefitCalculation` carries its own `APP.measurementDate` (§3.10) so the two can be compared for equivalence (rule M-05).

| Canonical field | Type | Required | Meaning |
|---|---|---|---|
| `APP.recordedDate` | date \| null | C (when known) | **The date the PA recorded the amount** — when the schedule was written / filed / the census was loaded. Distinct from the date through which the benefit was calculated. A recorded date is never used as a measurement date (rule M-02). Null + missing entry (§7) when unknown. |
| `APP.calculatedThroughDate` | date \| null | C (when stated) | **The date through which the benefit was calculated** — the schedule's as-of date (e.g. "amounts calculated through 12/31/2019"). Captured verbatim from the schedule's as-of language. This is the measurement date when it is established from the schedule. Null when the schedule states no as-of date. |
| `APP.calculatedThroughStatement` | string \| null | C (when `calculatedThroughDate` is present) | The schedule's as-of language verbatim (e.g. "as of December 31, 2019"), with the source location. The verbatim statement is the evidence; the parsed date is the interpretation. |
| `APP.measurementDate` | date \| null | R | **The established measurement date for this observation.** Equals `calculatedThroughDate` when the schedule states one; equals census `DOTE` when the DOTE basis is documented; otherwise null. Null means unresolved. |
| `APP.measurementBasis` | enum: `dote` / `dopt` / `nrd` / `other-stated` / `unresolved` | R | The basis of `APP.measurementDate`. `dote` = DOTE per the dictionary definition. `dopt` / `nrd` require documentary evidence and are recorded with the evidence linked (rule M-04: an NRD-basis claim without evidence is rejected). `other-stated` = a stated basis other than DOTE/DOPT/NRD, with the statement linked. `unresolved` = no basis established. |
| `APP.basisResolved` | boolean | R | **The basis-resolved flag.** `true` iff `APP.measurementDate` is non-null and `APP.measurementBasis` is not `unresolved`. `false` otherwise. This is the single flag downstream stages test: if `basisResolved` is `false`, no Δ is computed and the comparison is `not-comparable`. |
| `APP.basisEvidence` | string (source ref) \| null | R when resolved; null when unresolved | The source document + location that establishes the basis (schedule page/section, PA letter, plan provision). When unresolved, null — and the missing evidence is recorded in the `MissingRegistry` (§7) and the `ActuarialDecision` (§3.14). |
| `APP.candidateDates` | json: `{ date, source, reasonRejected \| null }[]` | C (when >1 candidate exists) | All candidate measurement dates when more than one exists (e.g. DOTE and POST_DOPT_DOTE; DOBF before DOTE for a frozen plan). The established date is one of them; the rejected candidates are recorded with the reason they were rejected (rule M-06). Dates are never averaged. |

```typescript
interface MeasurementDateState {
  recordedDate: string | null;            // APP.recordedDate — when the PA recorded the amount
  calculatedThroughDate: string | null;   // APP.calculatedThroughDate — date through which the benefit was calculated
  calculatedThroughStatement: string | null;
  measurementDate: string | null;         // APP.measurementDate — the established measurement date (null = unresolved)
  measurementBasis: "dote" | "dopt" | "nrd" | "other-stated" | "unresolved";
  basisResolved: boolean;                 // the basis-resolved flag
  basisEvidence: string | null;           // source document + location, or null
  candidateDates: { date: string; source: string; reasonRejected: string | null }[];
}
```

### 8.3 Resolution rules (M-01–M-06, restated as schema transitions)

| Situation | Schema state |
|---|---|
| PA_AMB populated but DOTE blank, RETSTAT 1/2/4 | Error (rule M-01). `measurementDate` null, `measurementBasis = unresolved`, `basisResolved = false`. Obtain DOTE from employment records (class (b)) or the schedule's as-of statement. |
| PA_AMB populated but DOTE blank, RETSTAT 3 (active) | Warning (rule M-01). DOTE blank is legitimate. The measurement date must be established another way (schedule statement, or DOPT as the as-of date — documented, not assumed). Until established, `basisResolved = false`. |
| Only a recorded/filed date is known, no as-of statement | Error (rule M-02). `recordedDate` populated, `calculatedThroughDate` null, `basisResolved = false`. Do not infer the measurement date from the file date or the valuation date. |
| Established measurement date disagrees with census DOTE | Warning (rule M-03). Both dates recorded; the comparison uses the PA's date, and the independent calculation is run at the same date (rule M-05). `candidateDates` records both, with the reason the census date was not used. |
| A source asserts PA_AMB is "as of NRD" | Error until resolved (rule M-04). The dictionary anchors PA_AMB at DOTE. An NRD-basis claim requires documentary evidence; if accepted, `measurementBasis = other-stated` with the evidence linked — never silently re-based. Without evidence the claim is rejected and the basis stays DOTE (or unresolved if DOTE is blank). |
| Observation and calculation have different dates, forms, or vesting treatments | Critical for the comparison (rule M-05). `BenefitComparison.comparisonBasis = unresolved`, no Δ computed. Convert (re-run the calculation at the observation's date/form) or hold the comparison. |
| More than one candidate measurement date exists | Warning (rule M-06). `candidateDates` lists all candidates with evidence; one is established, the rest are recorded with rejection reasons. |

### 8.4 What "unresolved" blocks

When `basisResolved = false`: no Δ is computed; `BenefitComparison.comparisonBasis = unresolved`; the participant is routed to `requires-investigation` (if the basis can be established by obtaining a document) or `indeterminate` (if it cannot) per 02 §B.7 item 5; the record still appears in every report with its reason — it is never omitted from counts or denominators. `Verified` is unreachable (§6.2).

---

## 9. TypeScript interfaces and JSON Schemas

Interfaces in this section are design artefacts. They define the canonical shapes precisely; they are not runnable code, and no implementation is implied. Money is `decimal(18,2)` in the schema; the engine (Stage 4) stores money as integer minor units — the interface type is the *logical* type, and the physical representation is an engine decision recorded in the Stage 4 spec.

### 9.1 Core interfaces

```typescript
// A typed benefit quantity (governing spec §3): every benefit carries its basis.
interface TypedBenefit {
  amountMonthly: number | null;          // decimal(18,2), monthly dollars; null when missing (§7)
  measurementDate: string | null;        // ISO-8601 date; null = unresolved (§8)
  measurementBasis: "dote" | "dopt" | "nrd" | "other-stated" | "unresolved";
  basisResolved: boolean;
  annuityForm: string | null;            // BCV FORM_CODE value, or null when unknown
  vestingTreatment: "gross" | "vested" | "unknown";
  retirementDate: string | null;         // NRD or retirement age/date basis, when established
  planVersionId: string | null;          // governing PlanVersion
  source: string;                        // SourceDocument id + location
  calculationStatus: "complete" | "partial" | "blocked" | "indeterminate";
}

interface ParticipantRecord {
  bcvRecId: number;                      // BCV_REC_ID (ALL, System Generated)
  caseId: string;                        // CASE (ALL, Input, VARCHAR2(8), text)
  id: "1" | "2" | "4";                   // ID (ALL, Input)
  ssn: string | null;                    // SSN (BCV1, Input) — PII, local only
  firstName: string | null;              // FNAME
  middleName: string | null;             // MNAME
  lastName: string;                      // LNAME
  nameSuffix: string | null;             // ENAME
  dob: string | null;                    // DOB (BCV1, Input)
  sex: "M" | "F" | "U" | null;           // PSEX (BCV1, Input)
  maritalStatus: "M" | "S" | "D" | "W" | "U" | null; // MSTAT
  healthStatus: "0" | "1" | "2" | null;  // PHS
  spouseOwn: string | null;              // SOWN
  spouseMonths: number | null;           // SOMOS
  dateOfMarriage: string | null;         // DOM
  dateOfDeath: string | null;            // DOD
  spouse: SpouseFields | null;           // SSSN, SFNAME, SMNAME, SLNAME, SENAME, SSEX, SDOB, SDOD
  beneficiary: BeneficiaryFields | null; // BSSN, BFNAME, …, BDOB
  alternatePayee: AlternatePayeeFields | null; // APSSN, APFNAME, …, APDOB, APSEX
  retstat: "1" | "2" | "3" | "4" | "5";  // RETSTAT (ALL, Input)
  rettyp: string | null;                 // RETTYP (BCV3, Calculated)
  participantKey: string;                // APP.participantKey — stable across extracts
  recordRole: "participant" | "beneficiary" | "alternate-payee"; // APP.recordRole, derived from ID
  employment: EmploymentPeriod[];        // §3.6
  compensation: CompensationHistory;     // §3.7
  service: ServiceHistory;               // §3.8
  completenessGrade: CompletenessGrade;  // §6
  gradeReason: string;
  provenance: Provenance;                // every value's source location (§2.1)
}

interface BenefitObservation {
  observationId: string;
  participantKey: string;
  paAmb: number | null;                  // PA_AMB (BCV9, Input, NUMBER) — null = missing (§7), never 0
  paAmbAccept: "Y" | "N" | null;         // PA_AMB_ACCEPT (BCV3) — output only, set by decision (§3.14)
  measurement: MeasurementDateState;     // §8.2 — recorded date, calculated-through date, basis-resolved flag
  annuityForm: string | null;            // APP.annuityForm — BCV FORM_CODE value or null
  vestingTreatment: "gross" | "vested" | "unknown";
  sourceScheduleRow: string;             // schedule + row/cell/page (rule C-01)
  observationType: "census" | "schedule" | "valuation-report" | "payment-record";
  provenance: Provenance;
}

interface Provenance {
  sourceDocumentId: string;
  location: string;                      // file + row/cell, PDF page, document section, or JSON path
  importId: string;
}
```

### 9.2 JSON Schema — BenefitObservation (normative for JSON import, §2.4)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/pa-amb/benefit-observation/1.0.0",
  "title": "BenefitObservation",
  "type": "object",
  "required": ["observationId", "participantKey", "measurement", "vestingTreatment", "sourceScheduleRow", "observationType", "provenance"],
  "properties": {
    "observationId": { "type": "string" },
    "participantKey": { "type": "string" },
    "paAmb": { "type": ["number", "null"], "description": "PA_AMB (BCV9, Input). Null = missing, never zero (rule P-13)." },
    "paAmbAccept": { "type": ["string", "null"], "enum": ["Y", "N", null], "description": "PA_AMB_ACCEPT (BCV3). Output only; set by ActuarialDecision (rule C-09)." },
    "measurement": {
      "type": "object",
      "required": ["measurementDate", "measurementBasis", "basisResolved", "candidateDates"],
      "properties": {
        "recordedDate": { "type": ["string", "null"], "format": "date" },
        "calculatedThroughDate": { "type": ["string", "null"], "format": "date" },
        "calculatedThroughStatement": { "type": ["string", "null"] },
        "measurementDate": { "type": ["string", "null"], "format": "date" },
        "measurementBasis": { "enum": ["dote", "dopt", "nrd", "other-stated", "unresolved"] },
        "basisResolved": { "type": "boolean" },
        "basisEvidence": { "type": ["string", "null"] },
        "candidateDates": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["date", "source"],
            "properties": {
              "date": { "type": "string", "format": "date" },
              "source": { "type": "string" },
              "reasonRejected": { "type": ["string", "null"] }
            }
          }
        }
      }
    },
    "annuityForm": { "type": ["string", "null"], "description": "APP.annuityForm. BCV FORM_CODE value, or null when unknown (rule X-10)." },
    "vestingTreatment": { "enum": ["gross", "vested", "unknown"] },
    "sourceScheduleRow": { "type": "string" },
    "observationType": { "enum": ["census", "schedule", "valuation-report", "payment-record"] },
    "provenance": {
      "type": "object",
      "required": ["sourceDocumentId", "location", "importId"],
      "properties": {
        "sourceDocumentId": { "type": "string" },
        "location": { "type": "string" },
        "importId": { "type": "string" }
      }
    }
  }
}
```

### 9.3 JSON Schema — MissingEntry (normative for JSON import of missingness)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/pa-amb/missing-entry/1.0.0",
  "title": "MissingEntry",
  "type": "object",
  "required": ["participantKey", "field", "reasonCode", "missingClass", "sourceLocation", "detail"],
  "properties": {
    "participantKey": { "type": "string" },
    "field": { "type": "string", "description": "Canonical field name, e.g. PA_AMB, DOTE, S023." },
    "reasonCode": { "enum": ["NOT_REPORTED", "NOT_APPLICABLE", "NOT_YET_OBTAINED", "RECOVERABLE_ELSEWHERE", "CONFLICTING_SOURCES", "NOT_STATED_BY_SOURCE", "INDETERMINATE"] },
    "missingClass": { "enum": ["a", "b", "c", "d", "e"], "description": "02 §A.6 five-way split." },
    "sourceLocation": { "type": "string" },
    "detail": { "type": "string" },
    "recordedAt": { "type": "string", "format": "date-time" },
    "resolution": { "type": ["string", "null"] }
  }
}
```

### 9.4 JSON Schema — BenefitCalculation (engine output; bounds instead of an invented exact number)

When an exact benefit cannot be produced, `calculatedMonthlyBenefit` is null and `benefitBounds` carries the justified bounds (or is null when no defensible bounds exist). An exact number is never invented to fill the field.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/pa-amb/benefit-calculation/1.0.0",
  "title": "BenefitCalculation",
  "type": "object",
  "required": ["calculationId", "participantKey", "formulaId", "planVersionId", "measurementDate", "calculationStatus", "inputsSnapshotId"],
  "properties": {
    "calculationId": { "type": "string" },
    "participantKey": { "type": "string" },
    "formulaId": { "type": "string" },
    "planVersionId": { "type": "string" },
    "measurementDate": { "type": "string", "format": "date" },
    "calculatedMonthlyBenefit": { "type": ["number", "null"], "description": "Null when no exact benefit can be produced. Never an invented exact number." },
    "benefitBounds": {
      "type": ["object", "null"],
      "required": ["min", "max", "assumptions"],
      "properties": {
        "min": { "type": "number" },
        "max": { "type": "number" },
        "assumptions": { "type": "string", "description": "Explicit assumptions under which the bounds are justified. A bound is not a confidence interval relabelled." }
      }
    },
    "intermediateSteps": { "type": "array", "items": { "type": "object" } },
    "roundingApplied": { "type": "string" },
    "inputsSnapshotId": { "type": "string" },
    "calculationStatus": { "enum": ["complete", "partial", "blocked", "indeterminate"] }
  }
}
```

---

## 10. Worked synthetic example

Fictional participant. No live case data. The census row below is invented for this spec; the participant, plan, and amounts are synthetic.

### 10.1 Source census row (CSV, as imported)

```csv
CASE,BCV_REC_ID,ID,SSN,LNAME,DOB,PSEX,RETSTAT,DOH,DOTE,CSPA,VSPA,PA_AMB,PA_ACOMP,FRSTYEAR,LASTYEAR,S001,S002,S003
01234567,101,1,***-**-1234,Alder,1958-04-12,F,2,1985-06-01,,18.50,18.50,,2450.00,2017,2019,29400.00,30100.00,
```

Notes on the row: `DOTE` is blank; `PA_AMB` is blank; `S003` (salary year 2017, since LASTYEAR 2019 − 2 = 2017) is blank. The PA schedule for this case was provided but states no as-of date: its heading reads "Accrued Benefits — Final" with no "calculated through" language. The plan document states a unit-credit formula, 1.5% accrual, 5-year final-average pay, cliff vesting at 5 years.

### 10.2 Canonical mapping (JSON, abridged to the fields this example exercises)

```json
{
  "schemaVersion": "1.0.0",
  "case": {
    "CASE": "01234567",
    "APP.dopt": "2020-03-31",
    "APP.planName": "Synthetic Plan A (fictional)",
    "APP.planNumber": "001"
  },
  "participants": [
    {
      "bcvRecId": 101,
      "caseId": "01234567",
      "id": "1",
      "ssn": null,
      "lastName": "Alder",
      "dob": "1958-04-12",
      "sex": "F",
      "retstat": "2",
      "employment": [
        { "DOH": "1985-06-01", "DOTE": null, "DOP": null, "DOBF": null, "DOR": null, "POST_DOPT_DOTE": null }
      ],
      "compensation": {
        "FRSTYEAR": 2017,
        "LASTYEAR": 2019,
        "S001": 29400.00,
        "S002": 30100.00,
        "S003": null,
        "ANNACT": null,
        "SALARYDESC": "Payroll Records",
        "CUCOMP": null,
        "PA_ACOMP": 2450.00
      },
      "service": { "CSPA": 18.50, "VSPA": 18.50, "ESPA": null, "CS": null, "VS": null, "ES": null, "VPPA": null },
      "completenessGrade": "insufficient",
      "gradeReason": "DOTE blank (RETSTAT 2) — measurement basis unresolved; S003 blank inside the averaging period; PA_AMB blank with no statement.",
      "provenance": { "sourceDocumentId": "doc-census-001", "location": "census-2020.csv row 2", "importId": "imp-001" }
    }
  ],
  "benefitObservations": [
    {
      "observationId": "obs-101",
      "participantKey": "01234567:***-**-1234:1958-04-12",
      "paAmb": null,
      "paAmbAccept": null,
      "measurement": {
        "recordedDate": "2020-02-14",
        "calculatedThroughDate": null,
        "calculatedThroughStatement": null,
        "measurementDate": null,
        "measurementBasis": "unresolved",
        "basisResolved": false,
        "basisEvidence": null,
        "candidateDates": [
          { "date": "2020-03-31", "source": "Case file DOPT", "reasonRejected": "DOPT is the plan termination date, not evidence of the date through which the PA calculated the benefit." }
        ]
      },
      "annuityForm": null,
      "vestingTreatment": "unknown",
      "sourceScheduleRow": "pa-schedule-2020.xlsx, sheet 'Benefits', row 42 (participant listed; PA_AMB cell blank; no as-of statement on the sheet)",
      "observationType": "schedule",
      "provenance": { "sourceDocumentId": "doc-schedule-001", "location": "pa-schedule-2020.xlsx Benefits!B42", "importId": "imp-002" }
    }
  ],
  "missing": {
    "entries": [
      { "participantKey": "01234567:***-**-1234:1958-04-12", "field": "DOTE", "reasonCode": "NOT_REPORTED", "missingClass": "a", "sourceLocation": "census-2020.csv row 2, DOTE cell (blank)", "detail": "DOTE blank for a RETSTAT 2 (Separated Vested) participant; DOTE is required for RETSTAT 1/2/4 (rule M-01)." },
      { "participantKey": "01234567:***-**-1234:1958-04-12", "field": "PA_AMB", "reasonCode": "NOT_REPORTED", "missingClass": "a", "sourceLocation": "census-2020.csv row 2, PA_AMB cell (blank); pa-schedule-2020.xlsx Benefits!B42 (blank)", "detail": "PA_AMB blank in census and on the PA schedule, with no statement that the PA reported no benefit (rule P-13). Blank = missing, never zero." },
      { "participantKey": "01234567:***-**-1234:1958-04-12", "field": "S003", "reasonCode": "NOT_REPORTED", "missingClass": "a", "sourceLocation": "census-2020.csv row 2, S003 cell (blank)", "detail": "Salary year 2017 (LASTYEAR 2019 − 2) blank inside the averaging period (rule P-14)." },
      { "participantKey": "01234567:***-**-1234:1958-04-12", "field": "APP.annuityForm", "reasonCode": "NOT_STATED_BY_SOURCE", "missingClass": "a", "sourceLocation": "pa-schedule-2020.xlsx Benefits sheet (no form column; no form statement)", "detail": "PA_AMB annuity form not stated anywhere in the case file (rule X-10)." },
      { "participantKey": "01234567:***-**-1234:1958-04-12", "field": "APP.measurementDate", "reasonCode": "NOT_STATED_BY_SOURCE", "missingClass": "e", "sourceLocation": "pa-schedule-2020.xlsx Benefits sheet heading 'Accrued Benefits — Final' (no as-of language)", "detail": "No as-of / calculated-through statement on the PA schedule and DOTE is blank; measurement basis unresolved (rules M-01, M-02)." }
    ]
  },
  "benefitCalculations": [],
  "benefitComparisons": []
}
```

### 10.3 What the example proves about the schema

1. **Blank PA_AMB is null, not zero.** `paAmb: null` with a `NOT_REPORTED` missing entry (rule P-13). No Δ is computed, because there is no recorded benefit to compare.
2. **Unresolved measurement date is explicit.** `measurementBasis: "unresolved"`, `basisResolved: false`, `measurementDate: null`, `calculatedThroughDate: null`. The recorded date (`2020-02-14`, when the schedule was filed) is stored separately and was not used as a measurement date (rule M-02). The DOPT date (`2020-03-31`) appears only as a rejected candidate, with the reason it was rejected — it was not silently adopted as the measurement date.
3. **The grade follows from the schema state.** The participant is `insufficient`: a class-(e) gap (unresolved measurement basis) is present, so no exact reconstruction and no defensible bounds are produced (`benefitCalculations: []`, `benefitComparisons: []`). The reachable dispositions are `requires-investigation` or `indeterminate` (§6.2) — here `requires-investigation`, because concrete next steps exist (obtain DOTE from employment records; obtain the schedule's as-of statement or a PA letter; obtain the 2017 salary year).
4. **The annuity form and vesting treatment are unknown, and stored as unknown.** `annuityForm: null`, `vestingTreatment: "unknown"` — not defaulted to the plan normal form or to gross/vested (rules X-09, X-10).
5. **A salary gap inside the averaging period is missing data, not zero.** `S003: null` with a `NOT_REPORTED` entry. `PA_ACOMP` (2450.00) is present, but it may substitute only if its own provenance and averaging period are documented (rule P-14) — the schema carries `PA_ACOMP` with its provenance; it does not silently fill the gap.
6. **The record is not dropped.** The participant appears in the package, in the missing registry, and in every report's denominators, with the reason for each gap. That is the standing requirement in schema form.

---

## 11. Validation hooks — how this schema connects to the rule catalog

This schema does not re-define validation; it gives validation rules the fields they examine. The mapping is:

| Schema area | Rules that read it (02 Part B) |
|---|---|
| Import formats, file integrity, encoding, header/field-name validation | S-01–S-12 (§2) |
| Participant identity, dates, service, salary | P-01–P-16 (§3.5–§3.8) |
| Cross-field plausibility (status vs benefit, PA inputs vs PA_AMB, PA vs BCV service, vesting, form, freeze) | X-01–X-14 (§3.9, §3.12) |
| Measurement-date state (§8) | M-01–M-06 |
| Longitudinal reconciliation across extracts (§2.5) | L-01–L-08 |
| Cross-source reconciliation (schedule, valuation, payments, PF factors, PA_AMB_ACCEPT) | C-01–C-10 |
| Routing after a finding (Critical → no calculation; Error → exact-only, bounds/scenario path; Warning → review before acceptance) | 02 §B.7 |

Every validation finding carries the eight items of 02 §B.0 (rule ID, source, fields examined, actual vs expected, severity, observed discrepancy, recommended investigation, whether it blocks a calculation) plus `participantKey`, `runId`, `recordedDate`, and `dispositionRoute`. A finding is never deleted; a finding resolved by a correction or a recovery is marked `resolved` with the resolution evidence linked, and the original finding remains in the audit log.

---

## 12. Open decisions

Anything unresolved is recorded here as an open decision, not a silent default. Items carried forward from Stage 1 are marked with their Stage 1 reference.

| # | Open decision | Stage 1 reference | What is needed to close it |
|---|---|---|---|
| OD-1 | **Vesting treatment of PA_AMB (gross vs vested).** The dictionary does not state it. The schema stores `vestingTreatment: unknown` until established per case from the PA schedule or plan provisions. | 02 §0.4, gap G-1; rule X-09 | Per-case evidence (PA schedule or plan provision). No system-wide default is set. |
| OD-2 | **Annuity form / normal-retirement basis of PA_AMB.** The dictionary does not state it. The schema stores `annuityForm: null` until established from the PA schedule. | 02 §0.4, gap G-2; rule X-10 | Per-case evidence (PA schedule). No default to the plan normal form. |
| OD-3 | **Per-plan rounding policy.** No written PBGC rounding policy was found; the PF file's practice (4 dp) is a file practice, not a policy. `FormulaRecord.roundingRule` records "not stated" where the plan document is silent. | 02 §B.9 gap G-6 | Per-plan rounding established from the plan document or the PA schedule. Whether the engine should offer a configurable rounding-sequence diagnostic (governing spec §9) is a Stage 3/4 decision. |
| OD-4 | **Units and decimals of PA_AMB.** Assumed monthly dollars, 2 dp, to be confirmed against the PA schedule at import (rule S-09). The assumption is recorded on the observation; it is not a dictionary fact. | 02 §0.4 | Confirmation against the PA schedule at import, per case. If a schedule states different units, the schema needs a `units` field on the observation — not yet added, pending the first such case. |
| OD-5 | **BCV table for `PA_QPSAF`.** Listed in 02 §A.3.2 C-4 with the tables given collectively as BCV9/BCV1/BCV3; the exact table for this field was not separately verified against the dictionary index. | 02 §A.3.2 C-4 | Dictionary cross-check (Stage 2 follow-up): confirm the table for `PA_QPSAF` in `data_dictionary_complete.xlsm` and correct §3.12. |
| OD-6 | **BCV table split for contribution fields.** `MANDC`/`MANDCWI`/`VOLC`/`VOLCWI` are stated in 02 §A.3.2 C-11 as BCV1/BCV4; the per-field split was not separately verified. | 02 §A.3.2 C-11 | Dictionary cross-check as OD-5. |
| OD-7 | **BCV predicates 224 vs 225 (DOTE on/after DOPT vs DOTE before DOPT).** Both type 3, apparently contradictory. Neither was silently picked. | 02 §B.9 conflict C-1; rule P-04 | Determination of which applies by RETSTAT/population before implementation (Stage 4). The schema carries both dates; it does not encode a choice. |
| OD-8 | **BCV predicate type 1–3 meanings and category 1–9 legend.** The workbook gives no legend; only type 4 (critical error) is interpretable. | 02 §0.5, gap G-5 | A legend from a PBGC source, or a decision to keep the adopted predicates' app severities as assigned in 02 §B.0.4 without claiming BCV meanings for types 1–3. |
| OD-9 | **Covered-compensation tables and SSA bend-point tables (non-census inputs 1–2).** Not yet sourced; no table was found in the Book of Job material reviewed. | 02 §A.4, gap G-3 | Sourcing from SSA tables as incorporated in the plan document (input 1) and from the PA schedule / SSA publications (input 2). The schema slots exist; they must not be filled with invented values. |
| OD-10 | **Historical statutory limits (non-census input 5).** IRC §401(a)(17) / §415(b) limits by year not yet sourced; no limits table was found in reviewed material. | 02 §A.4, gap G-4 | Values from IRS publications, never invented. |
| OD-11 | **Full mortality-table code list.** The add-in doc confirms GM83/GF83/UP84 and a second PBGC source confirms UP84M2, but the doc has no full code list (codes live in the ATPBGC MORTNAME table via MORTCODE/MORTDESC). | 02 §A.4; 00 §3.4 | A complete code list from a PBGC source before any conversion assumption can reference a code not already confirmed. |
| OD-12 | **Current edition of Policy 5.8-1.** The 2014 edition (issue date 10/02/2014) is the latest seen; whether a newer edition exists was not verified. | 02 §B.9 gap G-7; §B.0.1 | The case actuary must confirm the current edition before relying on the $1/$5 reference figures in the `ToleranceRecord`. |
| OD-13 | **Salary-year derivation edge cases.** Year = `LASTYEAR − (n−1)` for S00n is the stated derivation (rule S-10). What the schema does when FRSTYEAR/LASTYEAR are themselves missing or inconsistent with the populated S-years beyond a span mismatch (e.g. LASTYEAR blank but S-years populated) is not yet specified. | 02 §A.2.7; rule S-10 | A Stage 3/4 decision: whether a missing LASTYEAR blocks the compensation import (Error) or is recoverable from the S-year count. |
| OD-14 | **XLSX/XLSM reading library.** The importer must use a library that does not execute code and can read cached formula values read-only under `file://` with 0 fetch. No library is selected in this design spec; selection is a Stage 3 feasibility item (the library must be vendored, pinned, and inlined as classic script). | 04 §5.2, §5.7 | Stage 3 proof: the chosen library loads under `file://` in Edge, reads XLSM read-only with hashes matching, and never executes macros. |
| OD-15 | **JSON `_unmapped` retention shape.** Unknown JSON fields are retained verbatim with JSON paths (§2.4). Whether the `_unmapped` bag is stored inside the case package or as a sidecar import artefact is not decided. | 02 §A.1 (JSON row) | Stage 3/4 decision, driven by case-package size and audit needs. Either way, the bag is never dropped and never enters a calculation unmapped. |
| OD-16 | **`APP.participantKey` collision handling.** The key is generated from (CASE + SSN + DOB) at first import; collisions are quarantined (rule S-05). The identity-review procedure that resolves a collision (which evidence, who decides, what the merged key becomes) is not specified here. | 02 §A.2.5; rule S-05 | Stage 3/4 decision, with the constraint that a collision is never resolved by deleting a record. |
| OD-17 | **DOPT-default note scope.** The BCV1.DOTE note ("DOPT used for default RBD calculation when NULL and RETSTAT is '3' or '4'") is recorded in §3.6 as applying to the RBD calculation only. Whether any other BCV field carries a similar default that affects PA_AMB was not exhaustively checked. | 02 §0.3 | Dictionary cross-check (Stage 2 follow-up): search the dictionary index for other "DOPT used for default" notes and record any that touch PA_AMB-adjacent fields. |
| OD-18 | **Per-case tolerance default.** The app ships with no built-in acceptance tolerance (§4.1). Whether a future version offers an explicitly-labelled default tolerance (and what value, if any) is undecided and must not be decided silently. | 00 §2.3; 02 §B.0.1 | User / case-actuary decision. Any default must be labelled as a default, not as a PBGC rule, and must be recorded in the `ToleranceRecord` with its authority. |

---

## Sources for this document

- `~/workspace/pbgc-pa-amb-analysis/MASTER_PROMPT.md` (§2, §3, §5, §6, §7, §10, §12, §14, §17)
- `~/workspace/pbgc-pa-amb-analysis/stage1/00-source-inventory.md` (PA_AMB definition, tolerance finding, gaps)
- `~/workspace/pbgc-pa-amb-analysis/stage1/02-data-requirements-validation.md` (minimal/comprehensive datasets, non-census inputs, completeness grades, five-way missing-data split, validation catalog, disposition-reachability matrix)
- `~/workspace/pbgc-pa-amb-analysis/stage1/04-architecture-decision.md` (Option C Hybrid, staged; single HTML file, 0 fetch; case-package file as primary store)
- `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` (2026-10-30 index: 1,172 field records, 1,152 distinct fields, 12 tables)
- `~/workspace/pbgc_review/pa-amb/BCV-DataValidation-predicates.xlsx` (249 predicates; Drive `1CCBAMkMVVS7G1axzegkIqCjS3TrE4Qkr`)
