# PA_AMB Analysis — Historical Plan-Provision Data Model

- **Project:** PA_AMB Analysis System — help a PBGC case actuary decide, with evidence, whether to accept, reject, or modify the prior administrator's accrued monthly benefit (PA_AMB) as recorded in the census data.
- **Repo:** ErChulo/pbgc-pa-amb-analysis (public, `main`; user-created 2026-11-12)
- **Local dir:** `~/workspace/pbgc-pa-amb-analysis`
- **Stage:** Stage 2, design specification 01 (data model)
- **Governing spec:** `MASTER_PROMPT.md` (§3 typed benefit, §5 temporal reconstruction, §6 data architecture, §17 state-driven design)
- **Stage 1 basis:** `stage1/00-source-inventory.md`, `stage1/01-formula-classification.md`, `stage1/02-data-requirements-validation.md`, `stage1/04-architecture-decision.md`
- **Status:** Design specification only. No code, no app, no repo writes, no Drive writes.
- **Date:** 2026-11-12

## 0. What this document is

This is the data-model specification for the PA_AMB Analysis System: the historical plan-provision data model (Stage 2 deliverable 4 in `MASTER_PROMPT.md` §22, and the design counterpart of Stage 1 output 02, `02-data-requirements-validation.md` Part A).

It fully specifies the 15 entities of §6 of the governing spec, in the form the TypeScript-first deterministic core (Stage 1 output 04, Option C staged) will implement them. Every entity is given as:

- fields, with types, required/optional, and BCV-field origin where one exists;
- relationships to other entities;
- versioning and provenance rules.

It also specifies, once and for all, the cross-cutting mechanisms every entity uses:

- §1 — identity, money, dates, and the naming rules that keep BCV fields and app fields apart;
- §2 — provenance: the precise-location record every source value carries;
- §3 — immutable source records vs normalised/corrected values;
- §4 — the event / revision mechanism, and how a prior calculation run stays reproducible;
- §5 — the typed benefit quantity;
- §6 — the temporal model `B_i(t) = F(X_i(≤t), P(≤t))`;
- §7 — the 15 entities;
- §8 — a worked synthetic example;
- §9 — invariants the model must enforce;
- §10 — open decisions.

## 0.1 Facts taken from Stage 1 (not re-derived, not contradicted)

1. **PA_AMB** (BCV9, NUMBER, Input) = "Plan Administrator Accrued Monthly Benefit at DOTE". DOTE is the participant's Date of Termination of Employment; DOTE ≠ DOPT.
2. The dictionary does **not** state PA_AMB's annuity form, vesting treatment, NRD/age basis, rounding, or what a blank means. None of these may be assumed. A blank PA_AMB is missing data, never zero unless a governing rule says so — and no rule found says so.
3. The comparison pair is **PA_AMB (Input, BCV9) vs BCV1.AMB (Calculated)**, both "at DOTE".
4. **BCV3.PA_AMB_ACCEPT (Y/N)** is the only accept-decision flag. It carries no criterion, no tolerance, and no rationale field. It is set only by an `ActuarialDecision`, never before one exists.
5. **No PBGC tolerance for PA_AMB reconciliation was found.** Policy 5.8-1 ($1.00/$5.00) governs correcting PBGC benefit determinations and payments, and Policy 6.3-1 applies it to pre-termination liabilities. Neither governs the PA_AMB accept/reject decision. The reconciliation tolerance is therefore a **case-level, documented, human-set parameter**, recorded on the case (see §7.1, `Case.toleranceRecord`), never a built-in constant.
6. **Architecture:** Option C (Hybrid), staged — TypeScript deterministic core first, Rust/WASM kernels only where proved, single HTML file, 0 fetch. The data model is therefore specified in TypeScript interfaces, with JSON Schemas for the case-package file format. No storage choice in this model depends on a database: the primary store is a versioned case-package file (§4.4 of Stage 1 output 04).
7. **Standing requirement (most important):** the app must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible — bounds, scenarios, documented dispositions, human decision; never a silent failure or a made-up exact number when the evidence cannot support one.
8. **Completeness grades** (Stage 1 output 02 §A.5): Complete / Partial / Insufficient, per participant; **missing-data classes** (a)–(e) (§A.6); **disposition reachability** (§A.7): the grade and the measurement-basis state decide which §14 dispositions may be recorded. This model enforces that matrix at the `ActuarialDecision` entity (§7.14).
9. **BCV field names are copied exactly from the dictionary.** No field identifier is invented. A field that exists only in the application is named in `snake_case` and prefixed `APP` in prose / unprefixed in TypeScript interfaces where the interface itself is app-only (see §1.1). It is never presented as a BCV field.
10. **DOPT and BPD are not BCV dictionary fields.** They are app-level case facts, sourced from the case file / R5 header. They are never presented as BCV fields.
11. **DOBF grain:** BCV1.DOBF is a participant-level field ("Participant's Date of Benefit Freeze"); the R5 Plan Summary shell header has a plan-level DOBF cell. The model always qualifies DOBF by grain (§7.2, §7.6).

## 0.2 Conventions used in this document

- **Required / optional:** `R` = the record or calculation cannot proceed without it (or a documented substitute); `C` = conditionally required (required when a stated condition holds); `O` = optional. "Required" means required by this spec for the stated purpose, not a BCV load requirement — the two are distinguished wherever they differ.
- **BCV types** are NUMBER, VARCHAR2(n), DATE, as in the dictionary. **App types** in TypeScript are `string`, `number`, `boolean`, `DateString` (ISO `YYYY-MM-DD`), enums, and interfaces. Money is **integer minor units** (see §1.2).
- **IDs:** every entity has a stable string `id`. IDs are app-generated, opaque, and never reused. They are not BCV fields and not participant data.
- **Dates** are ISO calendar dates (`YYYY-MM-DD`). No time-of-day is stored; no timestamp is used inside the calculation core (determinism, §9). Timestamps appear only in the audit/event log, recorded as ISO strings supplied by the caller, never generated inside a pure calculation.
- **"Unknown" is a value, not an absence.** Where the dictionary is silent (annuity form, vesting treatment, measurement basis), the model stores an explicit `unknown` / `unresolved` enum value. A field left blank in a source is `null` (missing); a field whose value has been investigated and not established is `unknown`. The two are different, and the model keeps them different.
- **Synthetic data only.** The worked example in §8 uses fictional participants and a fictional plan. No live case data, no participant-level census rows.

---

## 1. Common foundations

### 1.1 Identity and naming

```typescript
/** Opaque, app-generated, stable identifier. Never reused, never a BCV field. */
type EntityId = string;

/** ISO calendar date, YYYY-MM-DD. No time-of-day. */
type DateString = string;

/** BCV field names are copied exactly from the dictionary (e.g. "PA_AMB", "CSPA").
 *  App-only field names are snake_case and never presented as BCV fields. */
type BcvFieldName = string;
```

Rules:

1. **One stable key per participant across extracts.** `Participant.participantKey` is generated at first import from (CASE + SSN + DOB) and is the cross-extract linkage key. `BCV_REC_ID` is load-specific and must never be used as the cross-extract key (Stage 1 output 02 §A.2.5). A collision on `participantKey` quarantines the record (validation rule S-05 in Stage 1 output 02 Part B); the model does not silently merge colliding records.
2. **Leading zeros are data.** `CASE` is VARCHAR2(8), text, leading zeros kept. Any code that parses it as a number is a defect.
3. **Case identity is (CASE, planNumber).** A case package contains exactly one `Case` and one `Plan`. A second plan in the same case package is a different case, not a second `Plan` row — unless a plan merger has occurred, which is an open decision (§10, item OD-4).
4. **No BCV field name is invented.** Where this spec needs a concept the dictionary lacks (e.g. measurement basis, observation type, disposition), the field is app-only, named in `snake_case`, and marked `APP` in the field tables.

### 1.2 Money — integer minor units, always

```typescript
/** Money as integer minor units (cents for USD). Never a binary float.
 *  150000 means $1,500.00. A value of 0 is a real zero, never a blank. */
type MoneyMinor = number; // integer; enforced by validation, never by convention

interface Money {
  /** Integer minor units. Must satisfy Number.isInteger. */
  amountMinor: MoneyMinor;
  /** Minor units per major unit: 100 for USD cents. Recorded, not assumed. */
  minorUnitsPerMajor: 100;
  /** Currency. See §1.2.1 — the dictionary does not state a currency. */
  currency: CurrencyCode;
  /** Decimal places the source stated, if any (e.g. 2). null = not stated. */
  sourceDecimalPlaces: number | null;
}
```

Rules:

1. **All money in the core is integer minor units.** No binary floating point may touch a monetary amount. Percentages and rates are stored as exact rational pairs or as integer basis points where the plan states them that way; where a rate is a decimal (e.g. accrual rate 1.5%), it is stored as a string (`"0.015"`) or as integer basis points (`150`), never as a float that is then multiplied into money. The engine (Stage 4) defines the decimal arithmetic; this model only fixes the representation.
2. **A blank is `null`, never `0`.** `PA_AMB` blank = `amount: null` = missing. `0` is stored only when a source states zero, or a governing rule (cited in the record) requires zero. This applies to every money field in every entity, and to every service/compensation field: a blank salary year is missing, never zero.
3. **Monthly vs annual is part of the type, not a comment.** Every benefit quantity carries its periodicity (§5). A monthly amount and an annual amount are different values of the same type with different `periodicity`; they are never compared without conversion, and the conversion (÷12 or ×12) is recorded in the calculation trace.

#### 1.2.1 Currency — an app convention, not a dictionary fact

The dictionary states no currency for PA_AMB. The name says "Monthly Benefit" and the context is a U.S. plan, so USD is implied by context, not stated. The model therefore:

- stores `currency: "USD"` on every `Money` value as an **app-level convention**, recorded as such in the case package;
- does **not** present "USD" as a dictionary fact;
- records the convention in `Case.currencyConvention` (§7.1) so an auditor can see it was a convention, not a source statement.

```typescript
type CurrencyCode = "USD"; // The only value the app supports in this version.
```

### 1.3 Dates and date precision

1. **Measurement dates are dates, not datetimes.** A benefit measured "at DOTE" is measured at a calendar date.
2. **Partial dates are not silently completed.** If a source gives only a year (e.g. a salary year), it is stored as a year (`number`), not as a fabricated `YYYY-01-01` date. `CompensationHistory` stores salary by year for exactly this reason (§7.7).
3. **Adoption date ≠ effective date.** Every amendment records both, separately (§7.3). A provision's `effectiveDate` governs which version applies at a measurement date; its `adoptionDate` governs the legal question of when it was adopted. Confusing the two is a known error source and the model keeps them apart.
4. **DOTE may be null.** The dictionary permits DOTE NULL in stated circumstances (see Stage 1 output 02 rule M-01). A null DOTE is stored as `null`, and a `BenefitObservation` whose measurement date depends on a null DOTE is `measurementBasis: "unresolved"` until other evidence establishes a date (§7.9, §6.4).

### 1.4 Enumerations — closed lists, no coined values

Where the governing spec or a PBGC source gives a closed list, the model uses exactly that list. Where no source gives a list, the model says so and the list is marked as an app list, open to extension only by a recorded design decision. The closed lists in this model and their authority:

| Enum | Authority |
|---|---|
| `Disposition` (verified / supported-for-acceptance / requires-investigation / correction-recommended / indeterminate) | `MASTER_PROMPT.md` §14 — proposed application states, explicitly **not** official PBGC classifications. Labelled as such wherever shown. |
| `HypothesisType` (16 types) | `MASTER_PROMPT.md` §10 — closed list from §10. No coined types. |
| `SourceDocumentType` | Stage 1 output 02 §A.2.13 — closed list; `other` requires a description. |
| `MeasurementBasis` (dote / dopt / nrd / other-stated / unresolved) | Stage 1 output 02 §A.2.9. |
| `ComparisonBasis` (same-basis / basis-converted / unresolved) | Stage 1 output 02 §A.2.11. |
| `CompletenessGrade` (complete / partial / insufficient / excluded) | Stage 1 output 02 §A.5. |
| `MissingDataClass` (a / b / c / d / e) | `MASTER_PROMPT.md` §12; Stage 1 output 02 §A.6. |
| `RetirementStatus` (RETSTAT 1–5) | BCV dictionary (RETSTAT, BCV ALL, Input). Values copied exactly. |
| `ParticipantIdType` (ID 1 / 2 / 4) | BCV dictionary (ID, BCV ALL, Input). Values copied exactly. |
| `FormulaType` | Stage 1 output 01 (formula taxonomy). This model references the taxonomy; it does not redefine it. A formula type not in the taxonomy is not representable until the taxonomy is extended by a recorded decision. |

**Standing rule (user, 2026-11-11):** do not invent a name, code, or level. If no PBGC source gives a name, the model says so and leaves the item open (§10) instead of coining one.

---

## 2. Provenance — every source record carries a precise location

### 2.1 The rule

**Every imported value must carry a precise reference to its original location.** A value without provenance is not loadable into a calculation (Stage 1 output 02 §A.1.1, rule 2). "The census file" is not a precise location. "Census file, row 412" is. "The plan document" is not a precise location. "Plan document §5.01, p. 14" is.

### 2.2 The provenance record shape

```typescript
/** Precise location of one value in its original source. Exactly one
 *  location kind is present; `kind` says which. */
type SourceLocation =
  | {
      kind: "spreadsheet-cell";
      /** File name as imported (not a path the user cannot see). */
      fileName: string;
      /** Sheet name. null for CSV. */
      sheet: string | null;
      /** 1-based row number in the sheet as imported. */
      row: number;
      /** Cell address, e.g. "C1031". */
      cell: string;
      /** Column header text as imported, if any. */
      columnHeader: string | null;
    }
  | {
      kind: "csv-row";
      fileName: string;
      /** 1-based row number including the header row. */
      row: number;
      /** Column header text as imported. */
      columnHeader: string;
      /** Delimiter actually detected ("," / ";" / tab), recorded at import. */
      delimiter: string;
    }
  | {
      kind: "pdf-page";
      fileName: string;
      /** 1-based page number in the PDF as opened (not a Bates number). */
      page: number;
      /** Section / heading text on that page, if any. */
      section: string | null;
      /** Quoted text, short, only where the value needs a quote to be found. */
      quote: string | null;
    }
  | {
      kind: "document-section";
      fileName: string;
      /** Section reference as written in the document, e.g. "§5.01". */
      section: string;
      /** Page number, if the document is paginated. */
      page: number | null;
    }
  | {
      kind: "json-path";
      fileName: string;
      /** JSON path, e.g. "$.participants[3].paAmb". */
      path: string;
    }
  | {
      kind: "user-entered";
      /** Who entered it. */
      enteredBy: string;
      /** ISO date entered. */
      enteredDate: DateString;
      /** The form / screen used, e.g. "provision-entry". */
      entryForm: string;
    };

interface Provenance {
  /** The SourceDocument this location is in. */
  documentId: EntityId;
  /** Precise location inside that document. */
  location: SourceLocation;
  /** How the value was obtained: "imported" | "derived" | "user-entered" | "recovered". */
  acquisition: "imported" | "derived" | "user-entered" | "recovered";
  /** For "derived": the rule / function that derived it, e.g. "salary-year-derivation S-10".
   *  For "recovered": the other source it was recovered from (a second Provenance).
   *  null otherwise. */
  derivation: string | null;
  /** SHA-256 of the source file at import time. null for user-entered values. */
  sourceFileHash: string | null;
}
```

Rules:

1. **One provenance per value, not per record.** A participant row has many values from many places (census row for DOB, PA schedule page for PA_AMB, plan document § for the formula). The model stores provenance per value, on the value's holder (see §2.3). A record-level provenance is not enough.
2. **`acquisition: "derived"` must name the derivation.** The salary-year derivation is the canonical example: BCV2 S001–S050 carry no per-year date field; year = LASTYEAR − (n−1) for S00n. That derivation is recorded on every derived `salaryYear` (Stage 1 output 02 rule S-10), not silently assumed.
3. **`acquisition: "recovered"` keeps both provenances.** When a missing input is recovered from another document (missing-data class (b)), the recovered value carries its own provenance *and* a reference to the original (empty) location. The recovery is itself auditable (§A.6, class (b)).
4. **User-entered values are provenance too.** A provision entered by hand carries `kind: "user-entered"` with the entering user, date, and form — plus the `SourceDocument` + location it was taken from, stored on the provision itself (§7.3, §7.4). Entering a value never means editing an imported file; imported files are never edited.
5. **XLSM files are hashed before and after import.** Macros are neither executed nor modified. The hash must be identical before and after; any change aborts the import and is logged as a security event (Stage 1 output 02 §A.1). The hash is stored on the `SourceDocument` and repeated on each value's provenance.
6. **Unknown fields are retained, never dropped.** A JSON import with fields the schema does not know keeps them verbatim in an `_unmapped` bag with provenance (Stage 1 output 02 §A.1). The bag is part of the case package, not discarded.

### 2.3 How provenance attaches to a value

Values that need provenance are stored as a **provenance-carrying value**, not as a bare scalar:

```typescript
/** A single imported/derived value with its provenance attached.
 *  `value` is null when the source field was blank (missing, never zero). */
interface SourcedValue<T> {
  value: T | null;
  provenance: Provenance;
}
```

In the entity tables in §7, a field marked **"sourced"** is stored as a `SourcedValue<T>`. A field marked **"plain"** is app-generated or derived inside the app (e.g. an `id`, a computed delta) and carries no source provenance — its provenance is the calculation run that produced it (§7.15).

**Design decision (recorded, not a PBGC rule):** provenance is stored per value, not per field definition. This costs storage (one provenance record per value) and buys the property the audit requires: any single number in any report can be traced to a page, cell, or row. The alternative — record-level provenance only — was rejected because it cannot answer "where did *this* PA_AMB come from?" when the census row and the PA schedule disagree (Stage 1 output 02 rule C-01).

---

## 3. Immutable source records vs normalised / corrected values

### 3.1 The two layers

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — SOURCE RECORDS (immutable)                       │
│  Exactly what was imported, byte-for-byte in meaning.       │
│  Never edited, never overwritten, never deleted.            │
│  One SourceRecord per imported row / document extract.      │
└─────────────────────────────────────────────────────────────┘
                              │ normalised by
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2 — NORMALISED RECORDS (versioned)                   │
│  The working data: typed, validated, linked, corrected.     │
│  Every normalised record points at its source record(s).    │
│  A correction creates a new version; the old version stays. │
└─────────────────────────────────────────────────────────────┘
```

```typescript
/** Layer 1. One row of one imported file, exactly as imported. */
interface SourceRecord {
  id: EntityId;
  /** The SourceDocument it came from. */
  documentId: EntityId;
  /** Import batch: which import run created this record. */
  importId: EntityId;
  /** Row / location in the source file (see §2.2). */
  location: SourceLocation;
  /** The raw field values, exactly as imported. Keys are the source's own
   *  field names (BCV names where the source is a census; the source's
   *  headers otherwise). Values are strings as imported — no parsing,
   *  no type coercion, no trimming of significant characters. */
  rawFields: Record<string, string | null>;
  /** SHA-256 of the source file at import. */
  sourceFileHash: string;
  /** ISO date of import. */
  importedDate: DateString;
  /** "quarantined" when the row failed to parse (raw text kept, never dropped). */
  status: "imported" | "quarantined";
  /** For quarantined rows: the parse failure, verbatim. */
  quarantineReason: string | null;
}
```

Rules:

1. **Layer 1 is append-only.** No operation in the app edits a `SourceRecord`. A re-import creates new `SourceRecord`s under a new `importId`; it never overwrites the old ones. The old import remains in the case package so a prior run can be reproduced from it (§4).
2. **Layer 2 is versioned, not mutated.** Every normalised entity carries `version: number` (starting at 1) and `supersedesId: EntityId | null`. A correction creates a new version of the entity with `version + 1` and `supersedesId` pointing at the previous version. The previous version is retained, addressable, and is the version a prior `CalculationRun` pinned (§4.3).
3. **The link is explicit and permanent.** Every normalised entity carries `sourceRecordIds: EntityId[]` — the Layer 1 records it was built from. A normalised value with no source record is a defect, except for values that are genuinely app-generated (IDs, derived keys, computed results), which are marked as such.
4. **Normalisation is a named, versioned transformation.** Each normalisation step has an id and a version (e.g. `normalise-census v1.2`), recorded on the entity it produces. Two runs of the same normaliser version over the same source records produce the same normalised records. A normaliser change is a new version, not a silent edit.
5. **A correction is a RevisionEvent, not an edit** (§4.2). The correction records: what changed, from what to what, why, on whose authority, and with what evidence. The original normalised value stays in the previous version; the corrected value is in the new version.
6. **Computed values are neither layer.** A `BenefitCalculation` or `BenefitComparison` is a computed result, not a source and not a normalisation. It is reproducible from its inputs + rule version (§4.3) and is stored as its own entity with its own snapshot reference. It is never edited; a re-run creates a new calculation under a new `CalculationRun`.

### 3.2 What "normalised" means, concretely

Normalisation is the mapping from raw imported text to typed working data. It includes, and only includes:

| Step | Example | Recorded as |
|---|---|---|
| Type parsing | `"1985-07-01"` → `DateString`; `"1500.00"` → `Money` 150000 minor | Normaliser id + version on the entity |
| Leading-zero preservation | `CASE` `"00012345"` stays text | Same |
| Salary-year derivation | S00n → year = LASTYEAR − (n−1) | `acquisition: "derived"`, derivation named (S-10) |
| Participant-key generation | (CASE + SSN + DOB) → `participantKey` | Derivation named on the field |
| Blank handling | blank → `null` (missing), never `0` | Rule id (P-13 / P-14) on the field |
| Enum mapping | RETSTAT `"3"` → `3` | The dictionary value, copied exactly |
| `_unmapped` retention | unknown JSON fields → `_unmapped` bag | Provenance kept on the bag |

Normalisation never includes: choosing a value when two sources disagree (that is a correction, §4.2, with a human decision); filling a missing value (that is a missing-data classification, §A.6 of Stage 1 output 02); or applying a tolerance (that is a case parameter, §7.1).

### 3.3 The corrected value and the original value, side by side

A normalised entity that has been corrected carries both:

```typescript
interface CorrectedField<T> {
  /** The value as imported / as first normalised. Never changes. */
  original: SourcedValue<T>;
  /** The current (corrected) value. Equal to `original` when uncorrected. */
  current: SourcedValue<T>;
  /** The revision that produced `current`, if any. null when uncorrected. */
  correctedByRevisionId: EntityId | null;
}
```

In practice, most fields are plain `SourcedValue<T>`; a field becomes a `CorrectedField<T>` only when a correction has been applied to it. The entity's `version` still increments on any correction, so the whole-entity history and the per-field history agree.

---

## 4. The event / revision mechanism

### 4.1 State transitions (§17 of the governing spec)

The application is a system that evolves through explicit, auditable state transitions:

```
S_{t+1} = T(S_t, E_t)
```

- `S_t` is the complete case-analysis state: the immutable input snapshot, the normalised working data, plan provisions `P(t)`, rule/tolerance versions, per-participant calculation results (including bounds and scenarios), per-participant disposition + evidence, the audit log, and UI/workflow position.
- `E_t` is an event: a user action (import, map, edit a provision, run, approve), a source update (re-import, correction), a rule revision (new tolerance, amended formula), or a calculation event (run completed, kernel fallback used).
- `T` is a defined transition function: for each event type, exactly what changes, what is recomputed, and what is recorded. Every transition appends an audit event; no transition silently rewrites history.

This model implements `S_t` as the **case package** (§4.4) and `E_t` as the **event log** (§4.2). The transition function `T` itself is Stage 4/Stage 6 work; this model fixes what `T` must record and what it must never do.

### 4.2 The event log — append-only, and the revision record

```typescript
/** One event in the case's history. Append-only. Never edited, never deleted. */
interface CaseEvent {
  id: EntityId;
  /** Monotonic sequence number within the case (1, 2, 3, …). */
  sequence: number;
  /** ISO date the event occurred (caller-supplied; the core never calls a clock). */
  eventDate: DateString;
  /** Who or what caused it: user id, or "system" for a calculation event. */
  actor: string;
  /** Event kind. Closed list — a new kind needs a recorded design decision. */
  kind:
    | "case-created"
    | "source-imported"
    | "source-reimported"
    | "provision-entered"
    | "provision-amended"
    | "correction-applied"
    | "tolerance-set"
    | "rule-version-changed"
    | "calculation-run-started"
    | "calculation-run-completed"
    | "comparison-computed"
    | "hypothesis-recorded"
    | "hypothesis-tested"
    | "disposition-recorded"
    | "disposition-approved"
    | "disposition-reopened"
    | "report-generated"
    | "case-package-exported";
  /** Human-readable summary, one sentence. */
  summary: string;
  /** Entity ids this event touched. Empty for case-level events. */
  affectedEntityIds: EntityId[];
  /** Participant keys affected. Empty when the event is plan-level or case-level;
   *  when a plan-level input changes, this lists the participants recomputed
   *  (computed explicitly, logged — invariant §9.6). */
  affectedParticipantKeys: string[];
  /** For a correction: the full revision record. null otherwise. */
  revision: RevisionRecord | null;
  /** Input snapshot hash after this event (see §4.3). */
  snapshotHashAfter: string;
}

/** A correction. Attached to a CaseEvent of kind "correction-applied". */
interface RevisionRecord {
  id: EntityId;
  /** The entity corrected (entity type + id). */
  entityType: string;
  entityId: EntityId;
  /** The entity version before the correction, and the new version after it. */
  versionBefore: number;
  versionAfter: number;
  /** Field-level changes. One entry per field changed. */
  changes: Array<{
    field: string;
    /** Value before, as stored (null when the field was blank/missing). */
    valueBefore: unknown;
    /** Value after. */
    valueAfter: unknown;
    /** Provenance of the new value (the evidence for the correction). */
    newValueProvenance: Provenance;
  }>;
  /** Why the correction was made, in the reviewer's words. */
  reason: string;
  /** Authority for the correction: the source document + location that
   *  justifies the new value. A correction without cited authority is
   *  not recordable. */
  authority: Provenance;
  /** Who made it. */
  correctedBy: string;
  /** ISO date. */
  correctedDate: DateString;
}
```

Rules:

1. **A correction never silently destroys the previous calculation basis.** The previous entity version stays in the case package; the `RevisionRecord` names it (`versionBefore`); any `CalculationRun` that used it still points at it (§4.3). A reviewer can always re-open the old version and see exactly what the old calculation was based on.
2. **A correction requires authority.** `RevisionRecord.authority` is mandatory. "I think the census is wrong" without a cited source is not a correction; it is a hypothesis (`DiagnosticHypothesis`, §7.12) or a data request.
3. **A correction is not a hypothesis test.** Changing a value and re-running is a new calculation under a new run; the hypothesis that the change explains a discrepancy is recorded separately and tested by the re-run's result.
4. **Disposition re-opening is an event.** When new evidence or a rule change re-opens an approved disposition, the event is `disposition-reopened`, the previous `ActuarialDecision` stays (with its `status: "superseded"`), and a new decision is recorded. An approved decision is never edited in place.
5. **The event log is the audit trail.** Reports (§15 of the governing spec) are reproducible from the retained input snapshot and approved rule versions; the event log is what makes that claim checkable.

### 4.3 Reproducibility — the input snapshot and the run pin

```typescript
/** A frozen snapshot of everything a calculation run depended on. */
interface InputSnapshot {
  /** SHA-256 over: all input files + field mapping + normaliser versions
   *  + plan-provision versions + tolerance record + rule versions.
   *  Computed at run start. */
  snapshotHash: string;
  /** The import ids included. */
  importIds: EntityId[];
  /** The normalised entity versions included, as (entityType, id, version).
   *  This is the pin: a prior run is reproducible because it names the
   *  exact versions it used, not "whatever is current now". */
  entityVersions: Array<{ entityType: string; entityId: EntityId; version: number }>;
  /** PlanVersion ids in force for the run, with their versions. */
  planVersionIds: Array<{ planVersionId: EntityId; version: number }>;
  /** Formula ids in force for the run, with their versions. */
  formulaIds: Array<{ formulaId: EntityId; version: number }>;
  /** Rule catalog version + formula-taxonomy version + engine version. */
  ruleVersion: string;
  formulaTaxonomyVersion: string;
  engineVersion: string;
  /** The tolerance record version applied. */
  toleranceRecordVersion: number;
}
```

Rules:

1. **A `CalculationRun` pins its `InputSnapshot`.** Re-running with the same snapshot hash and the same versions yields byte-identical results. If any pinned version has since been superseded, the old version is still in the case package, so the re-run can use it.
2. **A correction invalidates nothing retroactively.** A correction creates a new entity version. Existing runs keep pointing at the old version and their results stand. A new run uses the new version and records that it does. The case package can therefore hold two runs that disagree — and say exactly why (different input versions), which is the correct behaviour, not a bug.
3. **Selective recalculation is dependency-driven.** When an event changes a plan-level input, the affected participant set is computed explicitly (which participants' formulas, service, or compensation depend on that input) and logged on the event. Unchanged participants' results are untouched (invariant §9.6).

### 4.4 The case package — the unit of persistence

The primary store is a **versioned case-package file** (Stage 1 output 04 §4.1): a single JSON file the actuary saves, copies, and hands over. It contains:

- the `Case`, `Plan`, and all 15 entities (current versions plus all superseded versions retained);
- all `SourceRecord`s (Layer 1);
- the `CaseEvent` log;
- all `CalculationRun`s with their `InputSnapshot`s;
- the case-package format version.

```typescript
interface CasePackage {
  /** Format version, e.g. "1.0.0". Additive changes bump minor; breaking
   *  changes bump major, always with a change note (Phase 0 versioning rule). */
  formatVersion: string;
  case: Case;
  plan: Plan;
  planVersions: PlanVersion[];
  formulas: Formula[];
  participants: Participant[];
  employmentPeriods: EmploymentPeriod[];
  compensationHistories: CompensationHistory[];
  serviceHistories: ServiceHistory[];
  benefitObservations: BenefitObservation[];
  benefitCalculations: BenefitCalculation[];
  benefitComparisons: BenefitComparison[];
  diagnosticHypotheses: DiagnosticHypothesis[];
  sourceDocuments: SourceDocument[];
  actuarialDecisions: ActuarialDecision[];
  calculationRuns: CalculationRun[];
  sourceRecords: SourceRecord[];
  events: CaseEvent[];
  /** Fields the import schema did not know, retained verbatim with provenance. */
  unmapped: Array<{ path: string; value: unknown; provenance: Provenance }>;
}
```

Browser storage (localStorage / IndexedDB) is never the source of truth and never holds PII by default; it may be used only as a best-effort, explicitly labelled session cache, guarded by a defensive try/catch storage wrapper with a no-persistence fallback (the DEL `delSafeStorage()` precedent, Stage 1 output 04 §4.1). The case package file is the durable record.

---

## 5. The typed benefit quantity

`MASTER_PROMPT.md` §3: every benefit is a typed quantity containing at least monetary amount and periodicity, measurement date, benefit commencement basis, retirement age or date, annuity form, vesting treatment, applicable plan-provision version, source and calculation status. A comparison is valid only after the benefit bases have been established as equivalent.

### 5.1 The interface

```typescript
/** Annuity form. Values are BCV FORM_CODE values where the dictionary
 *  gives them; "unknown" is a valid stored value, never a default. */
type AnnuityForm =
  | "NSF" // Normal Single Form — value as in BCV FORM_CODE_NSF
  | "NMF" // Normal (automatic/married) form — value as in BCV FORM_CODE_NMF
  | string; // Any other BCV FORM_CODE value, copied exactly from the source.
            // A form not in any BCV source is "unknown", never a coined code.

/** Vesting treatment of a benefit amount. */
type VestingTreatment =
  | "gross" // Before any vesting percentage is applied.
  | "vested" // After the vesting percentage is applied (VP × gross).
  | "unknown"; // Not established. A valid stored value, never defaulted.

/** How the benefit's measurement date was established. */
type MeasurementBasis =
  | "dote" // Measured at DOTE (the dictionary's stated basis for PA_AMB).
  | "dopt" // Measured at DOPT.
  | "nrd" // Measured at NRD.
  | "other-stated" // Measured at another stated date (the date is in `measurementDate`,
                   // the basis description is in `basisNote`).
  | "unresolved"; // No measurement date established. No Δ is computed (§6.4).

/** Where a benefit quantity came from, and what state it is in. */
type BenefitSource =
  | "prior-administrator" // Reported by the prior administrator (PA_AMB).
  | "bcv-calculated" // A BCV Calculated field (e.g. BCV1.AMB), used as a cross-check only.
  | "independent-calculation" // Computed by this system's engine.
  | "bound" // A justified bound (B_i^min or B_i^max), not an exact benefit.
  | "scenario"; // One named scenario's value, not the benefit.

type BenefitStatus =
  | "recorded" // Reported and stored; not yet compared.
  | "calculated" // Independently calculated; trace available.
  | "compared" // Compared against another benefit on an equivalent basis.
  | "not-comparable" // Bases not equivalent (incl. unresolved measurement basis).
  | "indeterminate"; // No defensible value could be produced.

/** THE typed benefit quantity. Every benefit in the system is one of these.
 *  Two benefits are comparable only when their bases are equivalent (§5.3). */
interface TypedBenefitQuantity {
  /** Monetary amount, integer minor units. null when no amount exists
   *  (missing observation, or indeterminate — never 0 by default). */
  amount: Money | null;
  /** "monthly" for PA_AMB and AMB; "annual" where a source states annual.
   *  The dictionary's PA_AMB is monthly by name. */
  periodicity: "monthly" | "annual";
  /** Date the benefit is measured through. null when unresolved. */
  measurementDate: DateString | null;
  /** How the measurement date was established. */
  measurementBasis: MeasurementBasis;
  /** Free text only when measurementBasis is "other-stated": what the
   *  other basis is, and where it was stated. */
  basisNote: string | null;
  /** Benefit commencement basis: e.g. "payable at NRD", "payable at DOTE",
   *  "payable at early retirement date". null when not established. */
  commencementBasis: string | null;
  /** Normal retirement age (years, may be fractional per plan) or null. */
  retirementAge: number | null;
  /** Normal retirement date, or null when not established. */
  retirementDate: DateString | null;
  /** Annuity form. "unknown" is valid; a form is never assumed. */
  annuityForm: AnnuityForm | "unknown";
  /** Vesting treatment. "unknown" is valid; never assumed. */
  vestingTreatment: VestingTreatment;
  /** The PlanVersion whose provisions govern this benefit. */
  planVersionId: EntityId | null;
  /** The Formula whose definition produced (or would produce) this benefit. */
  formulaId: EntityId | null;
  /** Source and status. */
  source: BenefitSource;
  status: BenefitStatus;
  /** The BenefitObservation or BenefitCalculation this quantity belongs to. */
  ownerId: EntityId;
}
```

### 5.2 The six typed benefits (Stage 1 output 01 §2) — which entity holds which

Stage 1 output 01 distinguishes six typed benefits. They are not interchangeable, and the model keeps them in different places:

| Typed benefit | Meaning | Held in |
|---|---|---|
| B1 Accrued benefit | Earned as of a measurement date, in the normal form at NRD | `BenefitObservation` (PA's B1 claim) and `BenefitCalculation` (independent B1) |
| B2 Vested accrued benefit | `VP × B1`, the nonforfeitable portion | `BenefitCalculation` when the engine computes it; never stored as if it were B1 |
| B3 Projected benefit | Hypothetical, assuming continuation to NRA | `BenefitCalculation` with `calculationKind: "projected"` — never stored in a `BenefitObservation`, and never compared to PA_AMB as if it were accrued |
| B4 Benefit payable at commencement | B1 after early/late retirement adjustments and form conversions | `BenefitCalculation` with `calculationKind: "payable-at-commencement"`; BCV `TERM_MB_*` fields are cross-checks of this kind, on different bases (ERD/EURD/NRD/XRD vs DOTE) |
| B5 PBGC guaranteed benefit | B1 after Title IV guarantee limitations | Out of scope for this system (downstream). Not modelled. A field for it must not be added by analogy. |
| B6 PBGC termination benefit | Under PBGC termination-benefit rules, incl. funding allocations | Out of scope for this system (downstream). Not modelled. |

**Rule:** a `BenefitObservation` holds a B1 claim only. If a PA schedule turns out to state a projected benefit or a payable-at-commencement amount, that is recorded as a `DiagnosticHypothesis` ("administrator reported a projected benefit as accrued" / "commencement adjustment already applied"), not by relabelling the observation.

### 5.3 When two benefits may be compared

Two `TypedBenefitQuantity` values are comparable only when **all** of the following hold:

1. Same `periodicity` (or a recorded conversion, ÷12 / ×12, in the trace).
2. Same `measurementDate`, or a documented basis conversion between them (recorded on the `BenefitComparison` as `comparisonBasis: "basis-converted"`, with the conversion stated).
3. Same `annuityForm`, or a documented form conversion with its factors cited.
4. Same `vestingTreatment`, or a documented vesting conversion (`VP` applied once, with the factor cited).
5. Same `planVersionId` (or the comparison states explicitly that the versions differ and why that is acceptable — which is normally never).
6. Neither has `measurementBasis: "unresolved"`.

If any condition fails, the comparison is `comparisonBasis: "unresolved"`, `reconciliationStatus: "not-comparable"`, and no Δ is computed. The record is held, not compared (§A.7 of Stage 1 output 02).

### 5.4 JSON Schema — TypedBenefitQuantity

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/pbgc-pa-amb/typed-benefit-quantity.schema.json",
  "title": "TypedBenefitQuantity",
  "type": "object",
  "required": ["amount", "periodicity", "measurementDate", "measurementBasis",
               "annuityForm", "vestingTreatment", "source", "status", "ownerId"],
  "properties": {
    "amount": {
      "type": ["object", "null"],
      "required": ["amountMinor", "minorUnitsPerMajor", "currency"],
      "properties": {
        "amountMinor": { "type": "integer" },
        "minorUnitsPerMajor": { "type": "integer", "const": 100 },
        "currency": { "type": "string", "const": "USD" },
        "sourceDecimalPlaces": { "type": ["integer", "null"] }
      }
    },
    "periodicity": { "type": "string", "enum": ["monthly", "annual"] },
    "measurementDate": { "type": ["string", "null"], "format": "date" },
    "measurementBasis": { "type": "string",
      "enum": ["dote", "dopt", "nrd", "other-stated", "unresolved"] },
    "basisNote": { "type": ["string", "null"] },
    "commencementBasis": { "type": ["string", "null"] },
    "retirementAge": { "type": ["number", "null"] },
    "retirementDate": { "type": ["string", "null"], "format": "date" },
    "annuityForm": { "type": "string" },
    "vestingTreatment": { "type": "string", "enum": ["gross", "vested", "unknown"] },
    "planVersionId": { "type": ["string", "null"] },
    "formulaId": { "type": ["string", "null"] },
    "source": { "type": "string", "enum": ["prior-administrator", "bcv-calculated",
      "independent-calculation", "bound", "scenario"] },
    "status": { "type": "string", "enum": ["recorded", "calculated", "compared",
      "not-comparable", "indeterminate"] },
    "ownerId": { "type": "string" }
  },
  "allOf": [
    { "if": { "properties": { "measurementBasis": { "const": "unresolved" } } },
      "then": { "properties": { "measurementDate": { "type": "null" } } } },
    { "if": { "properties": { "measurementBasis": { "const": "other-stated" } } },
      "then": { "required": ["basisNote"] } }
  ]
}
```

**Note on the schema:** `annuityForm` is a plain string because the full BCV FORM_CODE list is not reproduced in this spec; the value must be a BCV FORM_CODE value copied from a source, or `"unknown"`. A form code not traceable to a PBGC source is a validation failure, not a new code.

---

## 6. The temporal model — B_i(t) = F(X_i(≤t), P(≤t))

### 6.1 The model, as data

Plan provisions are a time-dependent system `P(t)`; participant history is `X_i(t)`. The accrued benefit is:

```
B_i(t) = F( X_i(≤t), P(≤t) )
```

In this data model:

- **`P(t)` is the `PlanVersion` timeline** (§7.3) plus the `Formula` versions attached to it (§7.4). `P(t)` at a date `t` is exactly one `PlanVersion` (the one in force at `t`) and the set of `Formula`s attached to that version.
- **`X_i(t)` is the participant's dated history:** `EmploymentPeriod`s (§7.6), `CompensationHistory` by year (§7.7), `ServiceHistory` (§7.8), plus prior distributions, QDRO splits, and contributions where the case has them. Each history element carries its own dates, so `X_i(≤t)` is the subset of elements dated on or before `t`.
- **`F` is the formula** (§7.4) — a typed, versioned calculation definition. The engine (Stage 4) implements `F`; this model only fixes what `F` reads and what it must record.

### 6.2 PlanVersion timeline — how P(t) is represented

```typescript
/** The provision timeline for one plan. Sorted by effectiveDate, ascending.
 *  Intervals are [effectiveDate, nextEffectiveDate): a version governs from
 *  its effectiveDate until (not including) the next version's effectiveDate.
 *  The last version governs from its effectiveDate with no end. */
interface PlanVersionTimeline {
  planId: EntityId;
  versions: PlanVersion[]; // sorted by effectiveDate ascending; no gaps, no overlaps
}
```

Rules:

1. **No gaps, no overlaps.** The timeline is a partition of time from the plan's adoption date onward. If a gap is found in the source documents (a missing amendment), the gap is recorded as a missing-data item (class (e) if it makes reconstruction indeterminate for the affected era), not papered over by extending a neighbouring version.
2. **Effective date governs, not adoption date.** `P(t)` is selected by `effectiveDate`. The `adoptionDate` is stored alongside for the legal record, and for the question of whether a provision was adopted before or after a measurement date — but it never selects the version.
3. **A restatement is a new version.** A restatement that changes no provision text still creates a new `PlanVersion` (with `restatementDate` set and `provisionText` carried forward), because the restatement is a dated source document and the timeline must be able to cite it. A restatement that changes provisions creates a new version with the changed text.
4. **A formula change creates a new version.** Any change to a formula — rate, averaging period, cap, integration level, rounding rule — creates a new `PlanVersion` (the provision changed) and a new `Formula` version attached to it (§7.4). A `Formula` never changes in place.
5. **Grandfathering is data, not a comment.** `PlanVersion.grandfatheredGroups` lists the employment groups whose prior benefit is protected, and `Formula.grandfatherFloor` (where the plan provides one) records the protected amount's rule. The engine applies the floor; the model records that a floor exists and for whom.
6. **Freezes are versions.** A benefit freeze (partial or full) is a `PlanVersion` whose `freeze` block records the freeze date, scope (full / partial / accrual-only), and the DOBF (plan-level grain, §1.1 rule 11). Accrual after the freeze date is zero for the frozen scope — the engine enforces this by selecting the frozen version for dates after the freeze, not by a special case in the formula.

### 6.3 Participant history — how X_i(t) is represented

`X_i(t)` is not a single record. It is the union, for participant `i`, of:

| History element | Entity | Date fields that place it in time |
|---|---|---|
| Employment periods | `EmploymentPeriod` (§7.6) | `periodStart`, `periodEnd`, `breakInService` |
| Compensation by year | `CompensationHistory` (§7.7) | `salaryYear` per value |
| Service measures | `ServiceHistory` (§7.8) | `asOfDate` per service value |
| Benefit observations | `BenefitObservation` (§7.9) | `measurementDate`, `recordedDate` |
| Prior distributions / offsets | `ServiceHistory.distributions` / case-level records (§7.8) | distribution dates |
| QDRO splits | Participant beneficiary/AP fields + `BenefitObservation` (§7.5, §7.9) | split date (`AMB_SPLIT_DATE`, BCV9) |

Rules:

1. **Every history element is dated.** An element with no date cannot be placed in `X_i(≤t)` and is therefore unusable for reconstruction at any `t`. It is stored (with its provenance) and flagged, not dropped — but a calculation that needs it is blocked until the date is established or the element is excluded by a documented decision.
2. **Service is a dated measure, not a single number.** `CSPA`/`CS` are "service at DOTE" — one point on a service curve. Reconstruction at a date `t ≠ DOTE` needs service through `t`, which comes from the `EmploymentPeriod` + `ServiceHistory` timeline, not from the DOTE value. The model stores both: the DOTE values (as reported/calculated) and the period timeline (for reconstruction at any date).
3. **Compensation is by year, not by average.** The average is computed, not stored as the only record. `CompensationHistory` stores each year's compensation with its year; `PA_ACOMP` (the PA's average) is stored alongside as the PA's own input, not as a replacement for the yearly history.
4. **Rehires, transfers, and breaks are first-class.** A participant with two employment periods is two `EmploymentPeriod` rows, not one row with a note. A break in service is a boolean + rule reference on the period boundary, not an assumption. Prior service restoration (if the plan provides it) is a `ServiceHistory` entry with its rule citation.

### 6.4 Reconstruction at a date t — the rules the model enforces

```typescript
/** A request to reconstruct a benefit at a date. The engine (Stage 4)
 *  implements this; the model fixes the inputs and the failure modes. */
interface ReconstructionRequest {
  participantKey: string;
  /** The date to reconstruct at. */
  asOfDate: DateString;
  /** The kind of date, so the report can say what it is. */
  asOfKind:
    | "historical-admin-calculation-date"
    | "amendment-date"
    | "termination-of-employment" // DOTE
    | "benefit-freeze-date"
    | "bankruptcy-filing-date"
    | "dopt"
    | "user-selected";
  /** Which PlanVersion the caller believes governs. null = "select by date".
   *  If supplied and it is not the version in force at asOfDate, the engine
   *  refuses and records the refusal — it never silently uses the wrong version. */
  pinnedPlanVersionId: EntityId | null;
}
```

Rules (these are model invariants, enforced by validation before any calculation runs):

1. **Never apply the latest formula retroactively.** The version selected for a reconstruction at `t` is the version in force at `t` — or, for accrual earned in an earlier period, the version in force during that period, with §411(d)(6) protection of benefits already accrued (Stage 1 output 01 §3.3). The engine must apply each period's accrual under the provisions in effect for that period. A calculation that uses the current version for all periods is invalid and must be rejected, not warned about.
2. **A recorded amount without an established measurement date is flagged unresolved.** `BenefitObservation.measurementBasis = "unresolved"` means `comparisonBasis = UNRESOLVED` and **no Δ is computed** (§5.3). The observation may be compared only against a *range* of reconstructions (one per plausible measurement date), never against a single date as if that date were known. It cannot support a `verified` disposition (Stage 1 output 01 §3.5).
3. **Recorded date ≠ measurement date.** `BenefitObservation.recordedDate` (when the PA recorded the amount) and `measurementDate` (the date the benefit was calculated through) are different fields. They are frequently confused in census data; the model keeps them apart and validation flags a record where they have been conflated (Stage 1 output 02 rule M-02).
4. **Do not project past a freeze or termination date.** A reconstruction at a date after a freeze (for the frozen scope) or after DOTE accrues no further service or compensation for that participant. A projection is a different operation from a reconstruction and is labelled as one (§5.2, B3): a hypothetical future accrual is never stored as an accrued benefit.
5. **An accrued benefit never decreases on account of increasing age or service** (IRC §411(b)(1)(G)), and never decreases by plan amendment (IRC §411(d)(6)). Apparent decreases are possible only through the narrow, documented channels in Stage 1 output 01 §3.3 (falling final-average compensation, rising Social Security offset within Rev. Rul. 84-45 / IRC §401(a)(15) limits, rising covered compensation, §415 limit change). If a reconstructed series decreases and none of these applies, the reconstruction (or the administrator's number) is wrong — the model requires the decrease to be flagged as a diagnostic, not stored as a fact.
6. **When exact reconstruction is impossible, the model still produces a result.** The `BenefitCalculation` for a participant who cannot be reconstructed exactly carries `calculationStatus: "partial"` or `"indeterminate"`, with `bounds` (B_i^min / B_i^max) and/or `scenarios` (named, with their assumptions) instead of a single exact number (§7.10). A participant with no defensible number still gets a documented disposition (§7.14) — never a silent failure, never a made-up exact number.
7. **Every reconstructed value names its components' evidence grade.** Each intermediate step in the trace (§7.10) carries an evidence grade: `fact` (plan document + complete census), `assumption` (stated, sourced, sensitivity-tested), `estimate` (bounded range), or `unknown` (indeterminate — no number offered). A calculation whose trace contains an `unknown` for a required input cannot have `calculationStatus: "complete"`.

### 6.5 Dates the system must reconstruct at

Per `MASTER_PROMPT.md` §5, the model must support reconstruction at: historical administrator calculation dates; dates before/after significant amendments; termination of employment (DOTE); benefit freeze dates; bankruptcy filing dates (when relevant); DOPT; and user-selected dates. The `ReconstructionRequest.asOfKind` enum is exactly this list. A reconstruction at a date for which no `PlanVersion` exists (a gap in the timeline) is blocked, with the gap named as the missing evidence — not approximated by the nearest version.

---

## 7. The 15 entities

Field tables use: **Field** · **Type** · **Req** (R/C/O) · **BCV / source** · **Notes**. A field marked **sourced** is stored as `SourcedValue<T>` (§2.3). A field marked **plain** is app-generated or computed. Every entity carries the common versioning block in §7.0. Relationships are stated as "→ Entity" references by `EntityId`.

### 7.0 Common block — every entity carries this

```typescript
interface EntityCommon {
  /** Stable, app-generated, opaque id. Never reused. */
  id: EntityId;
  /** Version of this entity record. Starts at 1. Increments on any correction. */
  version: number;
  /** The previous version's id, or null for version 1. */
  supersedesId: EntityId | null;
  /** Layer 1 source records this entity was built from. */
  sourceRecordIds: EntityId[];
  /** ISO date this version was created (caller-supplied). */
  createdDate: DateString;
  /** Who created this version (user id, or "system" for a derived record). */
  createdBy: string;
}
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/pbgc-pa-amb/entity-common.schema.json",
  "title": "EntityCommon",
  "type": "object",
  "required": ["id", "version", "supersedesId", "sourceRecordIds", "createdDate", "createdBy"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "version": { "type": "integer", "minimum": 1 },
    "supersedesId": { "type": ["string", "null"] },
    "sourceRecordIds": { "type": "array", "items": { "type": "string" } },
    "createdDate": { "type": "string", "format": "date" },
    "createdBy": { "type": "string", "minLength": 1 }
  }
}
```

### 7.1 Case

Case-level metadata. One `Case` per case package. DOPT and BPD are **not** BCV dictionary fields — they are app-level case facts, sourced from the case file / R5 header. They are never presented as BCV fields.

| Field | Type | Req | BCV / source | Notes |
|---|---|---|---|---|
| `id`, `version`, `supersedesId`, `sourceRecordIds`, `createdDate`, `createdBy` | §7.0 | R | plain | |
| `caseNumber` | `string` (VARCHAR2(8), text, leading zeros kept) | R | BCV `CASE`, ALL, Input | Sourced. The census `CASE` value, copied exactly. |
| `dopt` | `DateString` | R | APP — case file / R5 header (Plan Summary Shell header: DOPT) | Sourced. Not a BCV field. |
| `bpd` | `DateString \| null` | C (required when a benefit freeze or BPD-dependent provision exists) | APP — case file / R5 header | Sourced. Not a BCV field. |
| `planName` | `string` | R | APP — R5 header / plan documents | Sourced. |
| `planNumber` | `string` | R | APP — R5 header / plan documents | Sourced. |
| `caseActuary` | `string \| null` | O | APP — R5 header | Sourced. |
| `auditor` | `string \| null` | O | APP — R5 header | Sourced. |
| `employerStatus` | `string \| null` | O | APP — R5 header | Sourced. |
| `successorPlan` | `string \| null` | O | APP — R5 header | Sourced. |
| `trusteeshipDate` | `DateString \| null` | O | APP — case file | Sourced. |
| `valuationAsOfDate` | `DateString \| null` | C (required for any longitudinal comparison) | APP — prior valuation report | Sourced. |
| `currencyConvention` | `"USD"` | R | APP convention (§1.2.1) | Plain. Records that USD is an app convention, not a dictionary fact. |
| `toleranceRecord` | `ToleranceRecord` | R | APP — case decision record (Stage 1 output 02 dataset item M-7) | **The reconciliation tolerance.** Human-set, documented, versioned. See below. |
| `completenessGrade` | `CompletenessGrade` | R | APP — computed (§A.5) | Plain. Case grade: Complete only if every in-scope participant is Complete; Partial if any is Partial and none Insufficient; Insufficient if any in-scope participant is Insufficient. RETSTAT 5 records are out of scope, graded `excluded`. |

```typescript
type CompletenessGrade = "complete" | "partial" | "insufficient" | "excluded";

/** The reconciliation tolerance for this case. There is no PBGC tolerance
 *  for PA_AMB reconciliation (Stage 1 output 00 §2.2). This record IS the
 *  tolerance: a human-set, documented, approved parameter. It is versioned
 *  with the Case, and every BenefitComparison names the version it used. */
interface ToleranceRecord {
  /** Version of this tolerance record (increments when the tolerance changes). */
  version: number;
  /** Absolute tolerance in minor units (cents), or null if none. */
  absoluteMinor: MoneyMinor | null;
  /** Relative tolerance as a decimal string, e.g. "0.01" for 1%, or null. */
  relativeDecimal: string | null;
  /** How the tolerance is applied: either limb, both limbs, or the larger. */
  application: "either" | "both" | "larger-of";
  /** Authority: who set it, and on what basis. Must cite a document or a
   *  recorded decision — never "PBGC policy", because no such policy exists
   *  for this decision. The 5.8-1 $1/$5 figures must not be cited here as
   *  authority for PA_AMB reconciliation; if they are mentioned, the scope
   *  difference must be stated. */
  authority: string;
  /** Who approved it. */
  approvedBy: string;
  /** ISO date approved. */
  approvedDate: DateString;
}

interface Case extends EntityCommon {
  caseNumber: SourcedValue<string>;
  dopt: SourcedValue<DateString>;
  bpd: SourcedValue<DateString | null>;
  planName: SourcedValue<string>;
  planNumber: SourcedValue<string>;
  caseActuary: SourcedValue<string | null>;
  auditor: SourcedValue<string | null>;
  employerStatus: SourcedValue<string | null>;
  successorPlan: SourcedValue<string | null>;
  trusteeshipDate: SourcedValue<DateString | null>;
  valuationAsOfDate: SourcedValue<DateString | null>;
  currencyConvention: CurrencyCode;
  toleranceRecord: ToleranceRecord;
  completenessGrade: CompletenessGrade;
  /** → Plan (exactly one). */
  planId: EntityId;
}
```

**Relationships:** Case → Plan (1:1). Case → CalculationRun (1:many, via `CalculationRun.caseId`). Case → CaseEvent (1:many, via the event log).

### 7.2 Plan

Plan characteristics and applicability rules. Sourced from plan documents via the R5 generator output (R5 JSON / filled Plan Summary Shell) where available; otherwise user-entered from plan documents with citations.

| Field | Type | Req | BCV / source | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `caseId` | `EntityId` → Case | R | plain | |
| `planId` | `string` (app id; links to Case) | R | APP | Stable within the case package. |
| `normalRetirementAge` | `number \| null` (years, may be fractional per plan) | R | APP — plan document § (R5 provisions) | Sourced. |
| `normalRetirementDefinition` | `string` (rule ref + text) | R | APP — plan document § | Sourced. |
| `earlyRetirementRule` | `string \| null` | C (required if any early-retirement factor or ERD benefit is analysed) | APP — plan document § | Sourced. |
| `normalFormSingle` | `string` (BCV FORM_CODE value) | R | APP — plan document; cross-checked against BCV `FORM_CODE_NSF` (Calculated) | Sourced. |
| `normalFormMarried` | `string` (BCV FORM_CODE value) | R | APP — plan document; cross-checked against BCV `FORM_CODE_NMF` (Calculated) | Sourced. |
| `compensationDefinition` | `string` (rule ref + text) | R | APP — plan document § (R5 provisions) | Sourced. |
| `serviceDefinitions` | `string` (credited / vesting / eligibility, with rule refs) | R | APP — plan document §; DBAB Ch. 7 | Sourced. |
| `vestingSchedule` | `VestingSchedule` (structured) | R | APP — plan document §; DBAB Ch. 8 | Sourced. See below. |
| `freezeDatePlanLevel` | `DateString \| null` | C (required if plan frozen) | APP — plan document / amendment | Sourced. **Plan-level grain.** Distinct from BCV1.DOBF (participant-level). The field name says so. |
| `integrationMethod` | `"none" \| "excess" \| "offset" \| "covered-comp" \| "pia-offset"` | C (required if formula is integrated) | APP — plan document § | Sourced. |
| `employeeContributionRule` | `string \| null` | C (required if `MANDC` / `VOLC` present) | APP — plan document § | Sourced. |

```typescript
interface VestingSchedule {
  /** Schedule type as stated in the plan document, e.g. "graded", "cliff".
   *  The words are the plan's words, copied — not a coined code. */
  scheduleType: string;
  /** Ordered (yearsOfService, percent) pairs. Percent as a decimal string. */
  steps: Array<{ yearsOfService: number; percentDecimal: string }>;
  /** Plan document section cited. */
  sourceSection: string;
}

interface Plan extends EntityCommon {
  caseId: EntityId;
  planId: string;
  normalRetirementAge: SourcedValue<number | null>;
  normalRetirementDefinition: SourcedValue<string>;
  earlyRetirementRule: SourcedValue<string | null>;
  normalFormSingle: SourcedValue<string>;
  normalFormMarried: SourcedValue<string>;
  compensationDefinition: SourcedValue<string>;
  serviceDefinitions: SourcedValue<string>;
  vestingSchedule: SourcedValue<VestingSchedule>;
  freezeDatePlanLevel: SourcedValue<DateString | null>;
  integrationMethod: SourcedValue<
    "none" | "excess" | "offset" | "covered-comp" | "pia-offset" | null>;
  employeeContributionRule: SourcedValue<string | null>;
  /** → PlanVersion (1:many). The timeline, sorted by effectiveDate. */
  planVersionIds: EntityId[];
}
```

**Relationships:** Plan → Case (many:1). Plan → PlanVersion (1:many). Plan → Formula (1:many, via PlanVersion).

### 7.3 PlanVersion

Effective-dated provisions and amendments. One row per provision version; the provision in force at the measurement date governs. **Never apply the latest formula retroactively.**

| Field | Type | Req | BCV / source | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | `version` here is the *record* version (corrections to this row). It is distinct from the provision timeline position, which is `effectiveDate`. |
| `planId` | `EntityId` → Plan | R | plain | |
| `versionId` | `string` (stable, app-generated) | R | APP | The business identifier cited by calculations (`TypedBenefitQuantity.planVersionId`). Stable across record corrections. |
| `effectiveDate` | `DateString` | R | APP — amendment / restatement | Sourced. **Governs selection.** Adoption date and effective date recorded separately. |
| `adoptionDate` | `DateString` | R | APP — amendment document | Sourced. Legal record; never selects the version. |
| `restatementDate` | `DateString \| null` | O | APP — restatement document | Sourced. |
| `provisionText` | `string` | R | APP — plan document / amendment, section cited | Sourced. The provision text itself, or a faithful summary with the section cited. |
| `provisionSection` | `string` (e.g. "§5.01") | R | APP — plan document | Sourced. |
| `supersedesVersionId` | `string \| null` (ref to `versionId`) | C (required except for the original version) | APP linkage | Plain. The timeline link. |
| `grandfatheredGroups` | `string[]` (employment-group refs) | C (required if grandfathering exists) | APP — amendment text | Sourced. Empty list = no grandfathering stated. |
| `freeze` | `FreezeBlock \| null` | C (required if this version introduces or changes a freeze) | APP — amendment / plan document | See below. |
| `sourceDocumentId` | `EntityId` → SourceDocument | R | plain | |
| `changeSummary` | `string` | R | APP — reviewer-written | What changed vs the superseded version, in one paragraph. A version with no change summary is incomplete. |
| `statutoryLimitsInForce` | `string[]` (limit ids, e.g. IRC §415(b) year) | O | APP — see §10 OD-2 | References to the statutory-limits table, once sourced. Until then, empty with a note. |

```typescript
interface FreezeBlock {
  /** Plan-level freeze date (grain: plan). Participant-level DOBF is BCV1.DOBF. */
  freezeDate: DateString;
  /** Scope of the freeze, in the amendment's words. */
  scope: "full" | "accrual-only" | "partial";
  /** For a partial freeze: which groups / accruals are frozen, in the amendment's words. */
  partialScopeNote: string | null;
  /** Amendment section cited. */
  sourceSection: string;
}

interface PlanVersion extends EntityCommon {
  planId: EntityId;
  versionId: string;
  effectiveDate: SourcedValue<DateString>;
  adoptionDate: SourcedValue<DateString>;
  restatementDate: SourcedValue<DateString | null>;
  provisionText: SourcedValue<string>;
  provisionSection: SourcedValue<string>;
  supersedesVersionId: string | null;
  grandfatheredGroups: SourcedValue<string[]>;
  freeze: SourcedValue<FreezeBlock | null>;
  sourceDocumentId: EntityId;
  changeSummary: string;
  statutoryLimitsInForce: string[];
  /** → Formula (1:many). The formulas attached to this version. */
  formulaIds: EntityId[];
}
```

**Versioning rules (the heart of the temporal model):**

1. A provision change creates a new `PlanVersion` with a new `versionId`, a new `effectiveDate`, and `supersedesVersionId` pointing at the previous version's `versionId`. The previous version is retained.
2. A correction to a `PlanVersion` row (e.g. a wrong effective date was entered) increments the row's `version` (§7.0) but does **not** change its `versionId`. A `CalculationRun` pins both: the `versionId` and the row `version` (§4.3).
3. **A calculation pins the version it used.** Every `BenefitCalculation` and every `TypedBenefitQuantity` carries `planVersionId` (the `versionId`, not the row `id`). A later amendment never changes what a past calculation used.
4. **Timeline integrity is validated, not assumed.** On import/entry, the app checks: versions sorted by `effectiveDate`; no two versions with the same `effectiveDate` (unless one is a restatement with identical provisions, in which case the later one supersedes and the reason is recorded); every version except the first has a `supersedesVersionId`; no gaps (see §6.2 rule 1).

**Relationships:** PlanVersion → Plan (many:1). PlanVersion → SourceDocument (many:1). PlanVersion → Formula (1:many). PlanVersion → BenefitCalculation / TypedBenefitQuantity (referenced by `planVersionId`).

### 7.4 Formula

Typed, versioned calculation definitions. The formula taxonomy itself is Stage 1 output 01; this entity records which formula applies to whom and when. **No formula is defined here** — a `Formula` row references the taxonomy and the plan document; it does not invent a formula.

| Field | Type | Req | BCV / source | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `formulaId` | `string` (stable, app-generated) | R | APP | The business identifier cited by calculations. Stable across record corrections. |
| `formulaType` | `string` (enum per taxonomy, Stage 1 output 01) | R | APP — plan document § | Sourced. Must be a taxonomy entry. A type not in the taxonomy is not representable until the taxonomy is extended by a recorded decision. |
| `planVersionId` | `string` (ref to `PlanVersion.versionId`) | R | plain | The version this formula belongs to. |
| `appliesToGroup` | `string` (employment-group ref or `"ALL"`) | R | APP — plan document § | Sourced. |
| `accrualRate` | `string \| null` (decimal string, e.g. `"0.015"`) | C (required for the formula type) | APP — plan document § | Sourced. Decimal string, never a float. |
| `formulaConstants` | `Record<string, string> \| null` (JSON, values as strings) | C (required for the formula type) | APP — plan document § | Sourced. All numeric constants as strings (exact decimals). |
| `averagingPeriodYears` | `number \| null` (integer) | C (required for average-pay formulas) | APP — plan document § | Sourced. |
| `averagingMethod` | `"final" \| "highest" \| "career" \| null` | C (required for average-pay formulas) | APP — plan document § | Sourced. "Highest" vs "final" is a plan term; the distinction is a first-order diagnostic (Stage 1 output 01 T-06). `null` = not stated — an open item, not a default. |
| `maxServiceYears` | `number \| null` | C (required if a cap exists) | APP — plan document § | Sourced. |
| `serviceCap` | `string \| null` (rule text) | C (required if a cap exists) | APP — plan document § | Sourced. Which years the cap counts (e.g. last N years) is part of the rule. |
| `integrationLevel` | `string \| null` (rule ref; value resolved via the covered-comp table when sourced) | C (required if formula is integrated) | APP — plan document § | Sourced. The level itself lives in the non-census inputs (§7.7 note); this field is the rule that names it. |
| `roundingRule` | `string` (rule ref) | R | APP — plan document §, or `"not stated — see gap G-6"` | Sourced. "Not stated" is a valid stored value; it is never defaulted to a rounding convention. |
| `grandfatherFloor` | `string \| null` (rule text) | C (required if a grandfathered floor exists) | APP — plan document § | Sourced. |
| `sourceCitation` | `string` | R | APP — plan document § + page | Sourced. |
| `applicabilityPredicate` | `string` (rule text: dates, group, status) | R | APP — derived from the plan document | Plain. The engine refuses to apply the formula outside it, and records the refusal (§9.4). |

```typescript
interface Formula extends EntityCommon {
  formulaId: string;
  formulaType: SourcedValue<string>;
  planVersionId: string;
  appliesToGroup: SourcedValue<string>;
  accrualRate: SourcedValue<string | null>;
  formulaConstants: SourcedValue<Record<string, string> | null>;
  averagingPeriodYears: SourcedValue<number | null>;
  averagingMethod: SourcedValue<"final" | "highest" | "career" | null>;
  maxServiceYears: SourcedValue<number | null>;
  serviceCap: SourcedValue<string | null>;
  integrationLevel: SourcedValue<string | null>;
  roundingRule: SourcedValue<string>;
  grandfatherFloor: SourcedValue<string | null>;
  sourceCitation: SourcedValue<string>;
  applicabilityPredicate: string;
}
```

**Versioning rules:**

1. Any change to a formula — rate, averaging period, cap, integration level, rounding rule — creates a **new `Formula` row with a new `formulaId`** attached to a new `PlanVersion`. A `Formula` row never changes in place; a correction to a `Formula` row (a transcription error) increments its record `version` (§7.0) but keeps its `formulaId`.
2. A calculation pins the `formulaId` it used, alongside the `planVersionId` (§7.10). A later formula change never changes what a past calculation used.

**Relationships:** Formula → PlanVersion (many:1, via `planVersionId`). Formula → BenefitCalculation (referenced by `formulaId`).

### 7.5 Participant

Stable identifier and demographic attributes. BCV fields are authoritative; app fields cover only what the dictionary lacks (stable cross-extract key, record linkage).

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `bcvRecId` | `number` (system-generated) | R | BCV `BCV_REC_ID`, ALL, Data Validation (M) / Valuation Load (M) / System Generated | Sourced. The app's stable key **per record** — not the cross-extract key. |
| `caseNumber` | `string` (VARCHAR2(8), leading zeros kept) | R | BCV `CASE`, ALL, Input | Sourced. |
| `idType` | `"1" \| "2" \| "4"` | R | BCV `ID`, ALL, Input (1 = Participant, 2 = Beneficiary, 4 = Alternate Payee) | Sourced. |
| `ssn` | `string \| null` | R | BCV `SSN`, BCV1, Input | Sourced. Dummy-SSN rule per dictionary (official dummy SSN if unknown and ID=1; `000000000` if ID=2 or 4). **Never used as the app's stable key across extracts.** PII: local only, redacted in exports except the case package itself. |
| `firstName`, `middleName`, `lastName`, `nameSuffix` | `string \| null` | R (lastName R; others C) | BCV `FNAME`, `MNAME`, `LNAME`, `ENAME`, BCV1, Input | Sourced. |
| `dob` | `DateString` | R | BCV `DOB`, BCV1, Input | Sourced. |
| `sex` | `"M" \| "F" \| "U"` | R | BCV `PSEX`, BCV1, Input | Sourced. |
| `maritalStatus` | `"M" \| "S" \| "D" \| "W" \| "U" \| null` | C (required for married-form / QPSA analysis) | BCV `MSTAT`, BCV1, Input | Sourced. |
| `healthStatus` | `"0" \| "1" \| "2" \| null` | C (required for disability benefits) | BCV `PHS`, BCV1, Input | Sourced. 0 = Healthy, 1 = Disabled w/o SS, 2 = Disabled w/ SS. |
| `survivorOwner` / `survivorMonths` | `string \| null` / `number \| null` | O | BCV `SOWN` / `SOMOS`, BCV1, Input | Sourced. |
| `dateOfMarriage` | `DateString \| null` | C (QPSA coverage charge) | BCV `DOM`, BCV1, Input | Sourced. |
| `dateOfDeath` | `DateString \| null` | C (required if deceased) | BCV `DOD`, BCV1, Input | Sourced. |
| Spouse fields | as dictionary | C (required for married / survivor analysis) | BCV `SSSN`, `SFNAME`, `SMNAME`, `SLNAME`, `SENAME`, `SSEX`, `SDOB`, `SDOD`, BCV1, Input | Sourced. Stored as a nested `spouse` object, each field sourced. |
| Beneficiary / AP fields | as dictionary | C (required for ID=2 / ID=4 records) | BCV `BSSN`, `BFNAME`, …, `BDOB`, `APSSN`, `APFNAME`, …, `APDOB`, `APSEX`, BCV9, Input | Sourced. Stored as nested `beneficiary` / `alternatePayee` objects. |
| `retstat` | `"1" \| "2" \| "3" \| "4" \| "5"` | R | BCV `RETSTAT`, ALL, Input (1 Retired, 2 Separated Vested, 3 Active Vested, 4 Nonvested, 5 Not in valuation population) | Sourced. RETSTAT 5 = out of scope (§7.1). |
| `rettyp` | `string \| null` | C (required for retirees) | BCV `RETTYP`, BCV3, Calculated (NR / ER / DR / DS / LR / SB) | Sourced. **Provenance must say whether the value came from BCV or from the PA** — the census may carry a PA value. |
| `participantKey` | `string` (stable across extracts) | R | APP | Plain, app-generated from (CASE + SSN + DOB) at first import. Linkage across extracts is by this key, never by `BCV_REC_ID`. Collisions quarantined (rule S-05). |
| `recordRole` | `"participant" \| "beneficiary" \| "alternate-payee"` | R | APP (derived from ID) | Plain, derived. The ID=2-on-DOPT rule from the dictionary is preserved verbatim. |
| `completenessGrade` | `CompletenessGrade` | R | APP — computed (§A.5) | Plain. Per participant, for exact reconstruction. |
| `missingData` | `MissingDataItem[]` | R | APP — computed (§A.6) | Plain. Every missing required input, classified (a)–(e). Empty list = none missing (stated explicitly). |

```typescript
type MissingDataClass = "a" | "b" | "c" | "d" | "e";

interface MissingDataItem {
  /** The field or input that is missing, e.g. "CompensationHistory.salaryYear 2021". */
  field: string;
  /** (a) required for exact reconstruction · (b) recoverable · (c) boundable ·
   *  (d) requires assumption · (e) makes reconstruction indeterminate. */
  missingClass: MissingDataClass;
  /** What the system may do with this gap (per §A.6 of Stage 1 output 02). */
  consequence: string;
  /** What would resolve it (the data request), or null when nothing is identified. */
  resolvesBy: string | null;
}

interface Participant extends EntityCommon {
  bcvRecId: SourcedValue<number>;
  caseNumber: SourcedValue<string>;
  idType: SourcedValue<"1" | "2" | "4">;
  ssn: SourcedValue<string | null>;
  firstName: SourcedValue<string | null>;
  middleName: SourcedValue<string | null>;
  lastName: SourcedValue<string>;
  nameSuffix: SourcedValue<string | null>;
  dob: SourcedValue<DateString>;
  sex: SourcedValue<"M" | "F" | "U">;
  maritalStatus: SourcedValue<"M" | "S" | "D" | "W" | "U" | null>;
  healthStatus: SourcedValue<"0" | "1" | "2" | null>;
  survivorOwner: SourcedValue<string | null>;
  survivorMonths: SourcedValue<number | null>;
  dateOfMarriage: SourcedValue<DateString | null>;
  dateOfDeath: SourcedValue<DateString | null>;
  spouse: SourcedValue<SpouseFields | null>;
  beneficiary: SourcedValue<BeneficiaryFields | null>;
  alternatePayee: SourcedValue<AlternatePayeeFields | null>;
  retstat: SourcedValue<"1" | "2" | "3" | "4" | "5">;
  rettyp: SourcedValue<string | null>;
  participantKey: string;
  recordRole: "participant" | "beneficiary" | "alternate-payee";
  completenessGrade: CompletenessGrade;
  missingData: MissingDataItem[];
}
```

**Relationships:** Participant → Case (many:1, via `caseNumber`). Participant → EmploymentPeriod / CompensationHistory / ServiceHistory / BenefitObservation / BenefitCalculation / BenefitComparison / ActuarialDecision (1:many, via `participantKey`).

### 7.6 EmploymentPeriod

Hire, termination, rehire, and transfer history. The dictionary carries only a single DOH / DOTE pair per record; multiple periods are app-level structure built from census history, prior extracts, and plan records. DBAB Ch. 7 (break in service, rehire, elapsed time) governs the semantics.

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `participantKey` | `string` → Participant | R | plain | |
| `doh` | `DateString` | R | BCV `DOH`, BCV1, Input | Sourced. |
| `dote` | `DateString \| null` | C (required except where the dictionary permits NULL — see rule M-01) | BCV `DOTE`, BCV1, Input | Sourced. |
| `dop` | `DateString \| null` | C (required if participation date differs from hire) | BCV `DOP`, BCV1, Input | Sourced. Participation date. |
| `dobfParticipant` | `DateString \| null` | C (required if frozen) | BCV `DOBF`, BCV1, Input | Sourced. **Participant-level grain.** Distinct from the plan-level freeze date (§7.2). The field name says so. |
| `dor` | `DateString \| null` | C (required for RETSTAT=1 / pre-DOPT retirees) | BCV `DOR`, BCV3, Input | Sourced. Actual retirement date. |
| `postDoptDote` | `DateString \| null` | C (ongoing plans, working-retirement issue) | BCV `POST_DOPT_DOTE`, BCV9, Input | Sourced. |
| `periodSeq` | `number` (integer) | R | APP | Plain, app-generated per participant, chronological (1, 2, 3, …). |
| `periodType` | `"initial-hire" \| "rehire" \| "transfer-in" \| "transfer-out" \| "leave"` | R | APP | Plain. Census history / plan records / prior extracts. |
| `periodStart` | `DateString` | R | APP | Plain, derived from DOH/DOTE/rehire records; each period's source cited in its provenance. |
| `periodEnd` | `DateString \| null` | R | APP | Plain. `null` = still employed at DOPT (open period). |
| `breakInService` | `BreakInService \| null` | C (required when a gap between periods exists) | APP | See below. |
| `hoursPerPeriod` | `number \| null` | C (required for hours-based service plans) | APP | Sourced. DBAB Ch. 7 Q 7:4 (hours) and equivalencies. |

```typescript
interface BreakInService {
  /** Whether a break occurred under the plan's rule. */
  occurred: boolean;
  /** Plan document section + DBAB Ch. 7 reference for the rule applied. */
  ruleRef: string;
  /** Whether prior service is restored on rehire, per the plan. */
  priorServiceRestored: boolean | "unknown";
}

interface EmploymentPeriod extends EntityCommon {
  participantKey: string;
  doh: SourcedValue<DateString>;
  dote: SourcedValue<DateString | null>;
  dop: SourcedValue<DateString | null>;
  dobfParticipant: SourcedValue<DateString | null>;
  dor: SourcedValue<DateString | null>;
  postDoptDote: SourcedValue<DateString | null>;
  periodSeq: number;
  periodType: "initial-hire" | "rehire" | "transfer-in" | "transfer-out" | "leave";
  periodStart: DateString;
  periodEnd: DateString | null;
  breakInService: BreakInService | null;
  hoursPerPeriod: SourcedValue<number | null>;
}
```

**Relationships:** EmploymentPeriod → Participant (many:1, via `participantKey`). EmploymentPeriod → ServiceHistory (referenced when service is reconstructed from periods, §7.8).

### 7.7 CompensationHistory

Compensation by applicable measurement period. The dictionary's salary history is BCV2 S001–S050 (S001 = most recent year's salary), bounded by FRSTYEAR / LASTYEAR. There is no per-year date field; year = LASTYEAR − (n−1) for S00n. That derivation must be recorded, not silently assumed (rule S-10).

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `participantKey` | `string` → Participant | R | plain | |
| `firstYear` | `number` (year) | R | BCV `FRSTYEAR`, BCV2, Input | Sourced. |
| `lastYear` | `number` (year) | R | BCV `LASTYEAR`, BCV2, Input | Sourced. |
| `salaryByYear` | `SalaryYearValue[]` | R | BCV `S001`–`S050`, BCV2, Input | Sourced. One entry per S-year present **or explicitly missing**. A blank S-year is missing, never zero (rule P-14). S001 required when LASTYEAR is present. |
| `annualizedFlagSource` | `"A" \| "B" \| null` | C (required when LASTYEAR salary is present) | BCV `ANNACT`, BCV2, Input (A = Actual, B = Annualized) | Sourced. |
| `salaryDesc` | `string` | R | BCV `SALARYDESC`, BCV2, Input | Sourced. Source of salary data: W-2, Payroll Records, etc. |
| `currentMonthlyComp` | `Money \| null` | C (required for active participants) | BCV `CUCOMP`, BCV1, Input | Sourced. Current monthly compensation. |
| `paAverageComp` | `Money \| null` | C (required when PA_AMB is present — it is the PA's own average-pay input) | BCV `PA_ACOMP`, BCV9, Input | Sourced. The PA's average compensation at DOTE. Stored alongside the yearly history, never as a replacement for it. |
| `compensationDefinitionApplied` | `string` (rule ref) | R | APP | Plain. Plan document § stating which pay counts. |
| `nonCensusInputs` | `NonCensusInputRef[]` | C (required when the formula needs them) | APP | References to the non-census inputs in §7.7.1. |

```typescript
interface SalaryYearValue {
  /** Calendar year. Derived: year = LASTYEAR − (n−1) for S00n.
   *  Derivation recorded in `provenance.derivation` (rule S-10). */
  salaryYear: number;
  /** The S-field this came from, e.g. "S001". */
  sourceField: string;
  /** Annual salary, dollars, integer minor units. null = blank = missing, never zero. */
  amount: Money | null;
  /** Whether this year's amount was annualised (from ANNACT). */
  annualized: boolean;
  provenance: Provenance;
}

interface NonCensusInputRef {
  /** What it is, e.g. "covered-compensation-table", "ssa-bend-points",
   *  "statutory-limit-401a17", "statutory-limit-415b". */
  inputKind: string;
  /** The SourceDocument it lives in, or null when not yet sourced. */
  documentId: EntityId | null;
  /** "sourced" | "not-yet-sourced" | "partial". */
  status: "sourced" | "not-yet-sourced" | "partial";
}

interface CompensationHistory extends EntityCommon {
  participantKey: string;
  firstYear: SourcedValue<number>;
  lastYear: SourcedValue<number>;
  salaryByYear: SalaryYearValue[];
  annualizedFlagSource: SourcedValue<"A" | "B" | null>;
  salaryDesc: SourcedValue<string>;
  currentMonthlyComp: SourcedValue<Money | null>;
  paAverageComp: SourcedValue<Money | null>;
  compensationDefinitionApplied: string;
  nonCensusInputs: NonCensusInputRef[];
}
```

#### 7.7.1 Non-census inputs — first-class inputs, not magic numbers

Per `MASTER_PROMPT.md` §6, the data model must accommodate information not contained in the participant census. Each non-census input is a first-class input with its own provenance and effective dates; none is embedded as a magic number. The kinds the model must support (Stage 1 output 02 §A.4):

| Input kind | Content | Status (Stage 1) |
|---|---|---|
| `covered-compensation-table` | Year-by-year covered compensation by year of birth | **NOT YET SOURCED** — no table found in the Book of Job material reviewed (gap G-3). |
| `ssa-bend-points` | Social Security bend points / PIA basis | **PARTIAL** — PIA field exists (BCV1 PIA, Input, "from Plan Administrator"); bend-point tables not yet sourced (gap G-3). |
| `plan-wide-salary-definitions` | Which pay counts, compensation caps, annualisation rules | Sourced per case from plan documents. |
| `formula-constants` | Accrual rates, tier thresholds, step rates, maximum service, grandfathered floors | Sourced per case from plan documents (held on `Formula`, §7.4). |
| `statutory-limit-401a17` | IRC §401(a)(17) compensation limit by year | **NOT YET SOURCED** — no limits table found in reviewed material; values must come from IRS publications, never invented (gap G-4). |
| `statutory-limit-415b` | IRC §415(b) maximum benefit by year | **NOT YET SOURCED** (gap G-4). |
| `annuity-conversion-assumptions` | Early/late retirement factors, benefit conversion factors by era (ERF/LRF/BFCF), mortality and interest bases | Sourced per case from PF generator output / plan documents; BCV add-in functions ERFAEQ / LRFAEQ / BFCFAEQ. |
| `historical-valuation-data` | Prior valuation reports: liabilities, XRD_MB_TERM, TERM_MB_*_NSF, LS_TERM, PVMB_* | Sourced per case (SourceDocument type `valuation-report`). |
| `mortality-table` | Table names/codes used in conversions (e.g. GM83, GF83, UP84 — confirmed in BCV_ATPBGC_Add-ins.pdf; UP84M2 confirmed in a second PBGC source) | Codes must come from a PBGC source; never coined. |

A `NonCensusInputRef` with `status: "not-yet-sourced"` blocks any calculation that needs it: the engine fails loudly (names the missing table) rather than substituting a neighbouring year's value (Stage 1 output 01 I-02).

**Relationships:** CompensationHistory → Participant (many:1, via `participantKey`). CompensationHistory → SourceDocument (many:many, via `NonCensusInputRef.documentId`).

### 7.8 ServiceHistory

Eligibility, vesting, and credited service. The dictionary distinguishes PA-reported service (`CSPA` / `VSPA` / `ESPA`, all Input, "at DOTE") from BCV-calculated service (`CS` / `VS` / `ES`, Calculated via add-in functions). **Both are retained; their difference is itself a diagnostic** (rule X-07).

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `participantKey` | `string` → Participant | R | plain | |
| `asOfDate` | `DateString` | R | APP | The date this service measure is as of. Normally DOTE; for reconstruction at other dates, the date reconstructed to. |
| `paCreditedService` | `number \| null` (years, may be fractional) | R | BCV `CSPA`, BCV1, Input | Sourced. PA credited (benefit) service at DOTE. |
| `paVestingService` | `number \| null` | R | BCV `VSPA`, BCV1, Input | Sourced. PA vesting service at DOTE. |
| `paEligibilityService` | `number \| null` | C (required if eligibility service affects the formula) | BCV `ESPA`, BCV1, Input | Sourced. PA eligibility service at DOTE. |
| `bcvCreditedService` | `number \| null` | C (required for independent calculation) | BCV `CS`, BCV1, Calculated (add-in) | Sourced. BCV-calculated years of credited service at DOTE. |
| `bcvVestingService` | `number \| null` | C (required for vesting analysis) | BCV `VS`, BCV1, Calculated (add-in) | Sourced. |
| `bcvEligibilityService` | `number \| null` | C | BCV `ES`, BCV1, Calculated (add-in) | Sourced. |
| `paVestingPercent` | `string \| null` (decimal string, fraction 0–1) | C (required when PA_AMB vesting treatment is in question) | BCV `VPPA`, BCV3, Input | Sourced. PA calculated vesting %. Decimal string, never a float. |
| `bcvVestingPercent` | `string \| null` (decimal string, fraction 0–1) | C | BCV `VP`, BCV1, Calculated | Sourced. Participant's vesting percent at DOTE. |
| `serviceMeasure` | `"years" \| "months" \| "hours" \| "elapsed-time"` | R | APP | Plain. Plan document §; DBAB Ch. 7. |
| `servicePeriods` | `ServicePeriod[]` | C (required when service is reconstructed rather than taken from CSPA) | APP | See below. |
| `breaksApplied` | `BreakApplication[]` | C (required when breaks exist) | APP | See below. |
| `distributions` | `Distribution[]` | C (required when prior distributions exist) | APP | Prior distributions / offsets. See below. |

```typescript
interface ServicePeriod {
  start: DateString;
  end: DateString | null; // null = open at DOTE / DOPT
  measure: number; // service credited for this period, in `serviceMeasure` units
  provenance: Provenance; // EmploymentPeriod + plan records
}

interface BreakApplication {
  /** The break (from EmploymentPeriod.breakInService). */
  employmentPeriodSeq: number;
  /** What the plan rule did with the break: service before the break
   *  kept / forfeited / restored, per the cited rule. */
  effect: string;
  ruleRef: string;
}

interface Distribution {
  /** Kind, in the source's words: e.g. "lump-sum", "partial-distribution". */
  kind: string;
  amount: Money;
  distributionDate: DateString;
  /** Whether this distribution offsets the accrued benefit, per the plan. */
  offsetsBenefit: boolean;
  provenance: Provenance;
}

interface ServiceHistory extends EntityCommon {
  participantKey: string;
  asOfDate: SourcedValue<DateString>;
  paCreditedService: SourcedValue<number | null>;
  paVestingService: SourcedValue<number | null>;
  paEligibilityService: SourcedValue<number | null>;
  bcvCreditedService: SourcedValue<number | null>;
  bcvVestingService: SourcedValue<number | null>;
  bcvEligibilityService: SourcedValue<number | null>;
  paVestingPercent: SourcedValue<string | null>;
  bcvVestingPercent: SourcedValue<string | null>;
  serviceMeasure: string;
  servicePeriods: ServicePeriod[];
  breaksApplied: BreakApplication[];
  distributions: Distribution[];
}
```

**Relationships:** ServiceHistory → Participant (many:1, via `participantKey`). ServiceHistory → EmploymentPeriod (via `ServicePeriod.provenance` and `BreakApplication.employmentPeriodSeq`).

### 7.9 BenefitObservation

The reported administrator benefit: amount, basis, and date. **This is the central entity of the system.** A `BenefitObservation` without an established measurement date is stored with `measurementBasis: "unresolved"` — it is never silently assigned DOTE, DOPT, or NRD.

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `participantKey` | `string` → Participant | R | plain | |
| `paAmb` | `Money \| null` | C (required for every participant the PA reported a benefit for; blank = missing, rule P-13) | BCV `PA_AMB`, BCV9, Input (monthly dollars, assumed 2 dp — see Stage 1 output 02 §0.4) | Sourced. `null` = blank = missing, never zero. |
| `benefit` | `TypedBenefitQuantity` | R | APP (§5) | The typed quantity for this observation. `source: "prior-administrator"`, `status: "recorded"` (then `"compared"` / `"not-comparable"` after comparison). |
| `measurementDate` | `DateString \| null` | C (required; if unknown → `measurementBasis: "unresolved"`) | APP | Sourced. PA schedule / census DOTE / documented basis. Mirrors `benefit.measurementDate`; stored here for query convenience. The two must agree — validation enforces it. |
| `measurementBasis` | `MeasurementBasis` | R | APP | Established by rules M-01–M-06 (Stage 1 output 02 §B.4). Mirrors `benefit.measurementBasis`. |
| `annuityForm` | `string \| "unknown"` | C (required for comparison; if unknown → unresolved basis) | APP | Sourced. PA schedule / plan document. Mirrors `benefit.annuityForm`. |
| `vestingTreatment` | `VestingTreatment` | R | APP | Sourced. PA schedule / VPPA / plan document. `unknown` is valid — not defaulted. Mirrors `benefit.vestingTreatment`. |
| `recordedDate` | `DateString \| null` | C (required when known; distinct from measurement date per §5) | APP | Sourced. When the PA recorded the amount. |
| `sourceScheduleRow` | `string` | R | APP | PA benefit schedule + row/cell/page. A precise location (§2.2), in text form for display. |
| `observationType` | `"census" \| "schedule" \| "valuation-report" \| "payment-record"` | R | APP | Source type. |
| `paAmbAccept` | `"Y" \| "N" \| null` | O (populated only after a determination) | BCV `PA_AMB_ACCEPT`, BCV3, Input, New (Release 6.3) | **Must never be set before the determination exists** (rule C-09). Set only by an `ActuarialDecision`. `null` = no determination yet. |
| `qdroSplitDate` | `DateString \| null` | C (required for QDRO-split benefits) | BCV `AMB_SPLIT_DATE`, BCV9, Input | Sourced. Different date anchor — not interchangeable with PA_AMB. |

```typescript
interface BenefitObservation extends EntityCommon {
  participantKey: string;
  paAmb: SourcedValue<Money | null>;
  benefit: TypedBenefitQuantity;
  measurementDate: DateString | null;
  measurementBasis: MeasurementBasis;
  annuityForm: string | "unknown";
  vestingTreatment: VestingTreatment;
  recordedDate: SourcedValue<DateString | null>;
  sourceScheduleRow: string;
  observationType: "census" | "schedule" | "valuation-report" | "payment-record";
  paAmbAccept: "Y" | "N" | null;
  qdroSplitDate: SourcedValue<DateString | null>;
  /** → SourceDocument (the PA schedule / census file this came from). */
  sourceDocumentId: EntityId;
}
```

**Relationships:** BenefitObservation → Participant (many:1, via `participantKey`). BenefitObservation → SourceDocument (many:1). BenefitObservation → BenefitComparison (1:many, via `comparisonId`'s `observationId`). BenefitObservation → ActuarialDecision (referenced by the decision).

### 7.10 BenefitCalculation

The independently calculated benefit and its trace. Calculation rules belong to the engine (Stage 4); this entity defines what must be stored so a calculation is reproducible and auditable.

| Field | Type | Req | BCV | Notes |
|---|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain | |
| `calculationId` | `string` (stable, app-generated) | R | APP | The business identifier cited by comparisons and decisions. |
| `participantKey` | `string` → Participant | R | plain | |
| `formulaId` | `string` (ref to `Formula.formulaId`) | R | APP | The formula used. |
| `planVersionId` | `string` (ref to `PlanVersion.versionId`) | R | APP | The version in force at the measurement date. **Pinned.** |
| `measurementDate` | `DateString` | R | APP | Same basis as the `BenefitObservation` it is compared with; otherwise the comparison is invalid (rule M-05). |
| `asOfKind` | `ReconstructionRequest["asOfKind"]` | R | APP (§6.4) | What kind of date this reconstruction is at. |
| `calculationKind` | `"accrued" \| "projected" \| "payable-at-commencement" \| "bound" \| "scenario"` | R | APP | B1 / B3 / B4 / bound / scenario (§5.2). A projected value is never stored as accrued. |
| `benefit` | `TypedBenefitQuantity` | R | APP (§5) | The typed quantity for this calculation. `source: "independent-calculation"` (or `"bound"` / `"scenario"`). |
| `calculatedMonthlyBenefit` | `Money \| null` | R | APP | Engine output. `null` when indeterminate (no defensible number). |
| `bounds` | `{ min: Money \| null; max: Money \| null; boundingAssumptions: string } \| null` | C (required when `calculationStatus` is `partial`) | APP | Justified bounds B_i^min ≤ B_i^possible ≤ B_i^max (§12). `null` when an exact value was produced. A bound is a justified bound under stated assumptions, not a confidence interval relabelled. |
| `scenarios` | `Scenario[]` | C (required when the result is scenario-based) | APP | Named scenarios with their assumptions and values. |
| `intermediateSteps` | `CalculationStep[]` (ordered trace) | R | APP | Engine trace (§8 of the governing spec: every intermediate step inspectable). |
| `roundingApplied` | `string` (rule ref + sequence) | R | APP | From `Formula.roundingRule`. The sequence (which step was rounded, and how) is part of the trace. |
| `inputsSnapshotId` | `string` (ref to `CalculationRun`) | R | APP | Input snapshot hash (§4.3). |
| `calculationStatus` | `"complete" \| "partial" \| "blocked" \| "indeterminate"` | R | APP | Driven by validation outcomes and the §12 five-way split. |
| `blockingReasons` | `string[]` | C (required when status is `blocked` or `indeterminate`) | APP | The validation rules / missing inputs that blocked it, by id. Empty = not blocked. |

```typescript
/** One inspectable intermediate step. Every step names its evidence grade. */
interface CalculationStep {
  /** Step number, 1-based, in evaluation order. */
  step: number;
  /** What this step computes, e.g. "credited-service", "average-compensation",
   *  "base-formula", "service-cap", "offset", "rounding", "final-monthly". */
  name: string;
  /** Inputs this step read (field refs + values). */
  inputs: Array<{ field: string; value: unknown }>;
  /** Output of this step (money as integer minor units; service as a number). */
  output: unknown;
  /** The rule applied, with its source citation. */
  ruleRef: string;
  /** Evidence grade of this step's inputs: fact / assumption / estimate / unknown. */
  evidenceGrade: "fact" | "assumption" | "estimate" | "unknown";
  /** The assumption, if the grade is "assumption" — stated, not implied. */
  assumption: string | null;
}

interface Scenario {
  /** Name, e.g. "2004-amendment-applies-to-all-service". */
  name: string;
  /** The assumption(s) this scenario makes, stated explicitly. */
  assumptions: string;
  /** The benefit under this scenario, or null when the scenario is indeterminate. */
  benefit: Money | null;
  /** The PlanVersion / Formula this scenario uses, when it differs from the base. */
  planVersionId: string | null;
  formulaId: string | null;
}

interface BenefitCalculation extends EntityCommon {
  calculationId: string;
  participantKey: string;
  formulaId: string;
  planVersionId: string;
  measurementDate: DateString;
  asOfKind: ReconstructionRequest["asOfKind"];
  calculationKind: "accrued" | "projected" | "payable-at-commencement" | "bound" | "scenario";
  benefit: TypedBenefitQuantity;
  calculatedMonthlyBenefit: Money | null;
  bounds: { min: Money | null; max: Money | null; boundingAssumptions: string } | null;
  scenarios: Scenario[];
  intermediateSteps: CalculationStep[];
  roundingApplied: string;
  inputsSnapshotId: string;
  calculationStatus: "complete" | "partial" | "blocked" | "indeterminate";
  blockingReasons: string[];
  /** → CalculationRun that produced this calculation. */
  runId: EntityId;
}
```

**BCV-calculated benefit fields as cross-checks (not the independent calculation):** `AMB` (BCV1, Calculated, at DOTE), `TERM_MB_ERD_NSF`, `TERM_MB_EURD_NSF`, `TERM_MB_NRD_NSF` (BCV1, Calculated), `XRD_MB_TERM` (BCV1, Calculated). They are **different bases** from PA_AMB (ERD/EURD/NRD/XRD vs DOTE) and must never be compared to PA_AMB without a basis conversion (rule C-03). When used, they are stored as `TypedBenefitQuantity` values with `source: "bcv-calculated"` on the `BenefitCalculation` as `bcvCrossChecks: TypedBenefitQuantity[]` (optional field, default `[]`).

**Relationships:** BenefitCalculation → Participant (many:1). BenefitCalculation → Formula / PlanVersion (via pinned ids). BenefitCalculation → CalculationRun (many:1, via `runId`). BenefitCalculation → BenefitComparison (1:many, via `comparisonId`'s `calculationId`).

### 7.11 BenefitComparison

Differences and reconciliation status (`MASTER_PROMPT.md` §10). Δ_i = B_i^PA − B̂_i; D_i = |Δ_i|; R_i = Δ_i / B̂_i only when the denominator is meaningful.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain |
| `comparisonId` | `string` (stable, app-generated) | R | APP |
| `observationId` | `EntityId` → BenefitObservation | R | plain |
| `calculationId` | `EntityId` → BenefitCalculation | R | plain |
| `delta` | `Money \| null` (Δ_i, signed, integer minor units) | R | Plain, computed. `null` when not comparable. |
| `absDelta` | `Money \| null` (D_i) | R | Plain, computed. `null` when not comparable. |
| `relDelta` | `string \| null` (R_i as a decimal string) | C (only when B̂_i is non-zero and meaningful; zero/near-zero denominators are flagged, never divided) | Plain, computed. Decimal string, never a float. |
| `comparisonBasis` | `"same-basis" \| "basis-converted" \| "unresolved"` | R | APP. Established by M-05. `unresolved` comparisons are stored but marked not-comparable. |
| `basisConversion` | `string \| null` | C (required when `comparisonBasis` is `"basis-converted"`) | The conversion applied (e.g. annual→monthly ÷12, form conversion with factors cited, vesting conversion with VP cited). |
| `toleranceApplied` | `ToleranceRecord` (a copy of the case tolerance record version used) | R | APP. A comparison without a recorded tolerance is incomplete. The copy is the version pinned at run time (§4.3). |
| `withinTolerance` | `boolean` | R | Plain, computed. |
| `reconciliationStatus` | `"matched" \| "within-tolerance" \| "material-difference" \| "not-comparable" \| "indeterminate"` | R | Plain, computed + reviewer-confirmed. |
| `denominatorFlag` | `string \| null` | C (required when B̂_i is zero or near-zero) | The flag recorded instead of a relative difference. |

```typescript
interface BenefitComparison extends EntityCommon {
  comparisonId: string;
  observationId: EntityId;
  calculationId: EntityId;
  delta: Money | null;
  absDelta: Money | null;
  relDelta: string | null;
  comparisonBasis: "same-basis" | "basis-converted" | "unresolved";
  basisConversion: string | null;
  toleranceApplied: ToleranceRecord;
  withinTolerance: boolean;
  reconciliationStatus:
    | "matched"
    | "within-tolerance"
    | "material-difference"
    | "not-comparable"
    | "indeterminate";
  denominatorFlag: string | null;
  /** → CalculationRun that produced this comparison. */
  runId: EntityId;
}
```

**Relationships:** BenefitComparison → BenefitObservation (many:1). BenefitComparison → BenefitCalculation (many:1). BenefitComparison → CalculationRun (many:1). BenefitComparison → DiagnosticHypothesis (1:many).

### 7.12 DiagnosticHypothesis

Proposed explanation and supporting evidence (`MASTER_PROMPT.md` §10). Ranked by evidence and explanatory power, not numerical proximity alone.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain |
| `hypothesisId` | `string` (stable, app-generated) | R | APP |
| `comparisonId` | `EntityId` → BenefitComparison | R | plain |
| `hypothesisType` | `HypothesisType` (closed list, §10) | R | APP. No coined types. |
| `counterfactual` | `string` | R | What changes, and the recomputed result. An engine re-run with the stated change — the re-run is a new `BenefitCalculation` linked here. |
| `counterfactualCalculationId` | `EntityId \| null` → BenefitCalculation | C (required when the counterfactual was run) | The re-run's id. `null` when the counterfactual could not be run (and the reason is in `status`). |
| `evidence` | `EvidenceItem[]` | R | SourceDocument refs. A hypothesis with no documentary evidence is labelled `numerical-coincidence`, never `supported`. |
| `rank` | `number` (integer, 1 = strongest) | R | Plain, reviewer-assessed. Ranked by evidence and explanatory power, not numerical proximity. |
| `status` | `"proposed" \| "tested-supported" \| "tested-rejected" \| "coincidence"` | R | Plain, reviewer-assessed. |

```typescript
type HypothesisType =
  | "measurement-date"
  | "service"
  | "compensation"
  | "averaging-period"
  | "accrual-rate"
  | "amendment"
  | "grandfather-floor"
  | "cap"
  | "freeze"
  | "integration"
  | "distribution"
  | "vesting"
  | "annuity-form"
  | "retirement-date"
  | "rounding"
  | "missing-information"
  | "administrator-error";

interface EvidenceItem {
  /** → SourceDocument. */
  documentId: EntityId;
  /** Precise location (§2.2). */
  location: SourceLocation;
  /** Quote or paraphrase, short. Labelled as quote vs paraphrase. */
  text: string;
  isQuote: boolean;
}

interface DiagnosticHypothesis extends EntityCommon {
  hypothesisId: string;
  comparisonId: EntityId;
  hypothesisType: HypothesisType;
  counterfactual: string;
  counterfactualCalculationId: EntityId | null;
  evidence: EvidenceItem[];
  rank: number;
  status: "proposed" | "tested-supported" | "tested-rejected" | "coincidence";
}
```

**Relationships:** DiagnosticHypothesis → BenefitComparison (many:1). DiagnosticHypothesis → BenefitCalculation (via `counterfactualCalculationId`). DiagnosticHypothesis → SourceDocument (via `evidence`).

### 7.13 SourceDocument

Original document and provenance. Every other entity points here.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain |
| `documentId` | `string` (stable, app-generated) | R | APP. The business identifier cited by provenance records. |
| `documentType` | `SourceDocumentType` (closed list) | R | APP. `other` requires a description. |
| `title` | `string` | R | Document itself. |
| `fileHash` | `string` (SHA-256) | R | Computed at import. For XLSM, verified before and after import. |
| `location` | `string` (Drive path / local path / file id) | R | Import record. |
| `versionDate` | `DateString \| null` | C | Document itself. |
| `effectiveDate` | `DateString \| null` | C | Document itself. |
| `reliabilityGrade` | `"high" \| "medium" \| "low" \| "unassessed"` | R | Assessed per rule C-10 (internal-controls evidence); default `unassessed`, never defaulted to high. |
| `otherTypeDescription` | `string \| null` | C (required when `documentType` is `"other"`) | Plain. |

```typescript
type SourceDocumentType =
  | "plan-document"
  | "amendment"
  | "restatement"
  | "census-file"
  | "pa-schedule"
  | "valuation-report"
  | "payment-record"
  | "r5-output"
  | "del-output"
  | "pf-output"
  | "actuarial-memo"
  | "policy"
  | "guidance"
  | "reference-book"
  | "other";

interface SourceDocument extends EntityCommon {
  documentId: string;
  documentType: SourceDocumentType;
  title: string;
  fileHash: string;
  location: string;
  versionDate: DateString | null;
  effectiveDate: DateString | null;
  reliabilityGrade: "high" | "medium" | "low" | "unassessed";
  otherTypeDescription: string | null;
}
```

**Relationships:** SourceDocument → (referenced by) every entity's provenance. SourceDocument → PlanVersion (via `PlanVersion.sourceDocumentId`). SourceDocument → BenefitObservation (via `sourceDocumentId`).

### 7.14 ActuarialDecision

Disposition, rationale, reviewer, and date (`MASTER_PROMPT.md` §14). **The human decision is the only thing that sets `PA_AMB_ACCEPT`.**

| Field | Type | Req | Notes |
|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain |
| `decisionId` | `string` (stable, app-generated) | R | APP |
| `participantKey` | `string` → Participant | R | plain |
| `disposition` | `Disposition` | R | APP (§14 proposed states — labelled as application states, not official PBGC classifications). |
| `recordedBenefit` | `Money \| null` | R | From `BenefitObservation`. `null` when no benefit was recorded. |
| `calculatedBenefit` | `Money \| null` | C (required when a calculation exists) | From `BenefitCalculation`. `null` when indeterminate. |
| `correctedBenefit` | `Money \| null` | C (required when disposition is `correction-recommended`) | Reviewer-entered. The specific corrected benefit the evidence supports. |
| `bounds` | `{ min: Money \| null; max: Money \| null } \| null` | C (required when the decision rests on bounds) | The bounds the decision relied on, copied from the calculation. |
| `rationale` | `string` | R | Reviewer-written. |
| `missingEvidence` | `string` | R | Reviewer-written; empty string means "none", stated explicitly. |
| `assumptions` | `string` | R | Reviewer-written; empty string means "none". |
| `sensitivity` | `string` | R | Reviewer-written; empty string means "none". |
| `comparisonBasis` | `string` | R | The comparison basis and applicable plan provisions (decision item 3 of §14). |
| `hypothesesConsidered` | `EntityId[]` → DiagnosticHypothesis | R | The hypotheses considered (decision item 4). Empty = none considered (stated explicitly). |
| `supportingDocuments` | `EvidenceItem[]` | R | Supporting documents and precise citations (decision item 8). |
| `reviewer` | `string` | R | Reviewer identity. |
| `decisionDate` | `DateString` | R | Date of the decision. |
| `paAmbAccept` | `"Y" \| "N" \| null` | C (set only by this decision, rule C-09) | BCV `PA_AMB_ACCEPT`, BCV3. Written back to the `BenefitObservation` only when this decision is approved. |
| `status` | `"recorded" \| "approved" \| "superseded"` | R | Plain. A decision is `recorded` when the reviewer writes it, `approved` when the approval gate passes, `superseded` when a later decision replaces it. An approved decision is never edited in place (§4.2 rule 4). |
| `approvedBy` | `string \| null` | C (required when `status` is `"approved"`) | The approver, when the approver differs from the reviewer. |
| `approvedDate` | `DateString \| null` | C (required when `status` is `"approved"`) | Date of approval. |

```typescript
type Disposition =
  | "verified"
  | "supported-for-acceptance"
  | "requires-investigation"
  | "correction-recommended"
  | "indeterminate";

interface ActuarialDecision extends EntityCommon {
  decisionId: string;
  participantKey: string;
  disposition: Disposition;
  recordedBenefit: Money | null;
  calculatedBenefit: Money | null;
  correctedBenefit: Money | null;
  bounds: { min: Money | null; max: Money | null } | null;
  rationale: string;
  missingEvidence: string;
  assumptions: string;
  sensitivity: string;
  comparisonBasis: string;
  hypothesesConsidered: EntityId[];
  supportingDocuments: EvidenceItem[];
  reviewer: string;
  decisionDate: DateString;
  paAmbAccept: "Y" | "N" | null;
  status: "recorded" | "approved" | "superseded";
  approvedBy: string | null;
  approvedDate: DateString | null;
  /** → BenefitObservation / BenefitCalculation / BenefitComparison relied on. */
  observationId: EntityId | null;
  calculationId: EntityId | null;
  comparisonId: EntityId | null;
}
```

**Reachability enforcement (Stage 1 output 02 §A.7).** The disposition recorded here must be inside the reachable set for the participant's completeness grade and measurement-basis state. The app refuses an out-of-reach disposition at entry, with the reason shown — it does not correct it after the fact:

| Completeness grade | Measurement basis | Reachable dispositions |
|---|---|---|
| Complete | Established | Verified · Supported for acceptance · Requires investigation · Correction recommended |
| Partial (classes b/c/d only) | Established | Supported for acceptance · Requires investigation · Correction recommended |
| Partial (classes b/c/d only) | Unresolved | Requires investigation · Indeterminate |
| Insufficient (any class-e gap) | Established or unresolved | Requires investigation · Indeterminate |
| Complete or Partial | Unresolved **and** PA_AMB is the only benefit evidence | Requires investigation · Indeterminate |
| Any grade | RETSTAT = 5 | (Out of scope — no disposition) |

Notes: `Verified` requires Complete + established basis + agreement within the documented case tolerance. `Supported for acceptance` is the Partial-grade acceptance path (PA_AMB inside justified bounds, every material discrepancy explained). `Correction recommended` requires sufficient evidence for a specific corrected benefit — on a Partial record that means the bounds collapse to a single defensible value under stated assumptions; on an Insufficient record it is unreachable. `Requires investigation` means a concrete next step exists; `Indeterminate` means the evidence as it stands cannot support a conclusion and no further step is currently identified.

**Relationships:** ActuarialDecision → Participant (many:1). ActuarialDecision → BenefitObservation / BenefitCalculation / BenefitComparison (via ids). ActuarialDecision → DiagnosticHypothesis (via `hypothesesConsidered`). ActuarialDecision → SourceDocument (via `supportingDocuments`).

### 7.15 CalculationRun

Rule version, input snapshot, and reproducibility metadata (`MASTER_PROMPT.md` §6, §17).

| Field | Type | Req | Notes |
|---|---|---|---|
| `id`, `version`, … | §7.0 | R | plain |
| `runId` | `string` (stable, app-generated) | R | APP |
| `caseId` | `EntityId` → Case | R | plain |
| `ruleVersion` | `string` (validation-rule catalog version + formula-taxonomy version) | R | APP. This document's version + Stage 1 output 01 version. |
| `inputSnapshot` | `InputSnapshot` (§4.3) | R | Plain. The pin that makes the run reproducible. |
| `inputSnapshotHash` | `string` (SHA-256) | R | Plain. Computed at run start. Mirrors `inputSnapshot.snapshotHash`. |
| `runDate` | `DateString` | R | Plain. Caller-supplied. |
| `runBy` | `string` | R | Plain. System + user. |
| `participantScope` | `string` (all / subset definition) | R | Plain. User selection, recorded. |
| `resultsHash` | `string` | R | Plain. Computed at run end, over all results produced. |
| `engineVersion` | `string` | R | Plain. The deterministic-core version that ran. |
| `participantsComputed` | `number` (integer) | R | Plain. How many participants this run computed. |
| `participantsChanged` | `string[]` (participant keys) | R | Plain. Exactly which participants changed vs the previous run, and why (logged per invariant §9.6). Empty = none changed. |

```typescript
interface CalculationRun extends EntityCommon {
  runId: string;
  caseId: EntityId;
  ruleVersion: string;
  inputSnapshot: InputSnapshot;
  inputSnapshotHash: string;
  runDate: DateString;
  runBy: string;
  participantScope: string;
  resultsHash: string;
  engineVersion: string;
  participantsComputed: number;
  participantsChanged: string[];
}
```

**Relationships:** CalculationRun → Case (many:1). CalculationRun → BenefitCalculation / BenefitComparison (1:many, via `runId`).

---

## 8. Worked synthetic example

All persons, plans, and numbers below are **fictional**. They illustrate the model; they are not a real case and not a PBGC source.

### 8.1 The fictional plan and its version timeline

**Plan:** Harborview Manufacturing Hourly Pension Plan (fictional). Plan number `0042`. Case `00098765`. DOPT 2024-06-30. Normal retirement age 65. Normal forms: single life (NSF) / joint-and-50%-survivor (NMF).

| PlanVersion | Effective | Adoption | What changed | Formula attached |
|---|---|---|---|---|
| `pv-1985-orig` | 1985-07-01 | 1985-06-15 | Original adoption. Flat $40/month per year of service, max 30 years. | `f-1985-flat` — type `flat-dollar`, `d = $40/month/year`, `S_max = 30` |
| `pv-2004-amend` | 2004-01-01 | 2003-11-20 | Rate raised to $55/month per year, prospectively; pre-2004 accrual protected at the old rate (§411(d)(6)). Grandfathered: participants with 20+ years at 2003-12-31 keep the $40 rate on pre-2004 service **plus** the $55 rate on post-2003 service (i.e. the amendment as written). | `f-2004-flat` — type `flat-dollar`, `d = $55/month/year`, `S_max = 30`, grandfather floor rule cited to amendment §3 |
| `pv-2019-freeze` | 2019-01-01 | 2018-10-05 | Benefit freeze (accrual-only). No service after 2018-12-31 counts. Plan-level freeze date 2019-01-01. | `f-2019-flat` — same $55 rate, `freeze` block set, accrual after freeze = 0 |

Timeline check: `[1985-07-01, 2004-01-01)` → `pv-1985-orig`; `[2004-01-01, 2019-01-01)` → `pv-2004-amend`; `[2019-01-01, …)` → `pv-2019-freeze`. No gaps, no overlaps. A reconstruction at 2010-06-30 uses `pv-2004-amend` and prices pre-2004 service at $40 and post-2003 service at $55. A reconstruction at 2024-06-30 (DOPT) uses `pv-2019-freeze` and counts no service after 2018-12-31. **The latest formula ($55) is never applied retroactively to pre-2004 service.**

### 8.2 The fictional participant

**Participant:** Ana Ruiz (fictional), `participantKey: "P-SYN-001"`, DOB 1960-03-14, hired 1986-04-01, terminated employment (DOTE) 2010-06-30, RETSTAT 2 (Separated Vested). One employment period, no breaks, no rehire. Vesting percent at DOTE: 1.0 (fully vested).

Service: 1986-04-01 → 2010-06-30 = 24.25 years credited service (plan counts fractional years). Split by version: pre-2004 service 17.75 years (1986-04-01 → 2003-12-31); post-2003 service 6.5 years (2004-01-01 → 2010-06-30). Total 24.25 ≤ 30 cap.

### 8.3 The BenefitObservation with provenance

The PA reported PA_AMB $1,232.50/month. The census row says so; the PA schedule says so too — on different pages, and the model records both:

```json
{
  "id": "obs-syn-001",
  "version": 1,
  "supersedesId": null,
  "participantKey": "P-SYN-001",
  "paAmb": {
    "value": {
      "amountMinor": 123250,
      "minorUnitsPerMajor": 100,
      "currency": "USD",
      "sourceDecimalPlaces": 2
    },
    "provenance": {
      "documentId": "doc-pa-schedule-2010",
      "location": {
        "kind": "spreadsheet-cell",
        "fileName": "Harborview_PA_Benefit_Schedule_2010.xlsx",
        "sheet": "Accrued Benefits",
        "row": 412,
        "cell": "F412",
        "columnHeader": "Accrued Monthly Benefit"
      },
      "acquisition": "imported",
      "derivation": null,
      "sourceFileHash": "sha256:9f2c…(truncated in this example)"
    }
  },
  "benefit": {
    "amount": {
      "amountMinor": 123250,
      "minorUnitsPerMajor": 100,
      "currency": "USD",
      "sourceDecimalPlaces": 2
    },
    "periodicity": "monthly",
    "measurementDate": "2010-06-30",
    "measurementBasis": "dote",
    "basisNote": null,
    "commencementBasis": "payable at NRD in the normal single form",
    "retirementAge": 65,
    "retirementDate": "2025-03-14",
    "annuityForm": "NSF",
    "vestingTreatment": "gross",
    "planVersionId": "pv-2004-amend",
    "formulaId": "f-2004-flat",
    "source": "prior-administrator",
    "status": "recorded",
    "ownerId": "obs-syn-001"
  },
  "measurementDate": "2010-06-30",
  "measurementBasis": "dote",
  "annuityForm": "NSF",
  "vestingTreatment": "gross",
  "recordedDate": "2010-09-15",
  "sourceScheduleRow": "Harborview_PA_Benefit_Schedule_2010.xlsx, sheet 'Accrued Benefits', row 412, cell F412",
  "observationType": "schedule",
  "paAmbAccept": null,
  "qdroSplitDate": null,
  "sourceDocumentId": "doc-pa-schedule-2010"
}
```

Notes on the example: `measurementBasis: "dote"` is established here because the PA schedule states the amounts were calculated through DOTE (a stated basis, cited at the schedule's cover page — that citation lives on the `SourceDocument` and in the observation's provenance chain). `vestingTreatment: "gross"` is established because the schedule's column header and the plan document state the amount is before vesting; had the schedule not stated it, the value would be `"unknown"` and the comparison would be `not-comparable` until established. `paAmbAccept: null` — no determination exists yet, so the flag is unset.

### 8.4 The independent calculation (same participant, same date)

Engine reconstruction at DOTE 2010-06-30 under `pv-2004-amend`:

- Pre-2004 service 17.75 years × $40.00 = $710.00/month.
- Post-2003 service 6.50 years × $55.00 = $357.50/month.
- Total $1,067.50/month, gross, NSF, at NRD.

The PA reported $1,232.50. Δ = $1,232.50 − $1,067.50 = **+$165.00/month**. That is a material difference under any plausible case tolerance, so `reconciliationStatus: "material-difference"`.

The diagnostic work (illustrative, not a conclusion): $165.00 ÷ $55.00 = 3.0 years. A hypothesis of type `"service"` — "administrator counted 3 extra years of service" — is proposed, with the counterfactual re-run at 27.25 years producing exactly $1,232.50. But a numerical match is not proof: the hypothesis stays `"proposed"` until documentary evidence is found (e.g. the PA schedule's service column, or a service record showing pre-hire service credited). If the evidence shows the PA credited 3 years of pre-participation service the plan does not allow, the hypothesis becomes `"tested-supported"` and the disposition is `correction-recommended` with `correctedBenefit: $1,067.50`. If no evidence is found, the disposition is `requires-investigation`, with the data request recorded. **The model holds the number, the hypothesis, and the decision apart — the match alone decides none of them.**

### 8.5 What the example shows about the model

1. The version timeline makes the $40/$55 split mechanical: each period's service is priced under the version in force for that period.
2. The observation carries its provenance to a single spreadsheet cell; the calculation carries its trace to the same granularity.
3. The $165.00 difference is a fact (Δ). Its explanation is a hypothesis. Its disposition is a human decision. The model stores all three, separately.

---

## 9. Invariants the model must enforce

These are properties the test suite checks (Stage 1 output 04 §7.2), not comments. Each is stated with the entity or mechanism that enforces it.

1. **Original source observations remain unchanged.** `SourceRecord`s are append-only (§3.1 rule 1). A correction creates a new entity version referencing the original; it never overwrites it. Provenance is retained.
2. **A calculation is reproducible from its inputs and rules.** Every `BenefitCalculation` / `CalculationRun` records the input snapshot hash, the rule/formula version, the tolerance version, and the engine version (§4.3, §7.15). Re-running with the same snapshot and versions yields byte-identical results. No clock, no randomness, no iteration over unordered structures inside the core.
3. **Benefit quantities retain their units and measurement bases.** Every benefit is a `TypedBenefitQuantity` (§5). A comparison is only valid after bases are established equivalent (§5.3); a recorded amount without an established measurement date is flagged unresolved and no Δ is computed (§6.4 rule 2).
4. **A rule cannot apply outside its applicability conditions.** Every `Formula` carries `applicabilityPredicate` (§7.4); the engine refuses to apply it outside, and the refusal is recorded — not silently skipped. The same holds for the tolerance record (it applies to the case it was set for) and for statutory limits (effective dates).
5. **Unverified statistical results cannot become approved participant benefits.** The statistics module has no write path to benefits or dispositions (Stage 1 output 04 §6.1, module 6). A disposition of Verified / Supported / Correction recommended must cite a deterministic calculation or documented evidence, never a model output alone.
6. **Updating one participant must not silently change others.** Recalculation is dependency-driven: an event names the affected participants (or the affected plan-level input, in which case the affected set is computed explicitly and logged) (§4.2, §4.3 rule 3). A run reports exactly which participants changed and why; an unchanged participant's results are untouched.
7. **Every approved determination retains its supporting evidence.** A disposition cannot transition to `approved` without its evidence set (recorded benefit, reconstructed benefit or bounds, comparison basis, hypotheses considered, missing evidence, assumptions, reviewer, date — §14 items 1–10). The transition is rejected if any required item is missing (§7.14).
8. **No silent failure, no invented exactness.** If exact reconstruction is impossible, the engine produces bounds/scenarios and the disposition moves toward Requires investigation / Indeterminate — it never emits an exact number the evidence cannot support, and never leaves a participant without a disposition (§6.4 rules 6–7).
9. **A blank is missing, never zero.** Enforced at the type level: blank source fields become `null` in `SourcedValue` (§2.3, §3.2), and money `0` is stored only when a source states zero or a cited governing rule requires it (§1.2 rule 2).
10. **No disposition outside the reachable set.** Enforced at `ActuarialDecision` entry (§7.14): the grade + measurement-basis matrix decides what may be recorded, and the app refuses anything outside it with the reason shown.

---

## 10. Open decisions

Anything unresolved is recorded here as an open decision, not a silent default. Each item names what is unresolved, what Stage 1 found (or did not find), and what would resolve it.

### OD-1 — Covered-compensation / SSA bend-point tables not yet sourced

- **Unresolved:** the covered-compensation tables (year-by-year covered compensation by year of birth) and the SSA bend-point tables were **not found** in the Book of Job material reviewed in Stage 1 (gaps G-3, Stage 1 output 02 §A.4). The PIA field exists (BCV1 PIA, Input, "from Plan Administrator"); the tables behind it do not.
- **Design consequence:** `CompensationHistory.nonCensusInputs` carries `status: "not-yet-sourced"` for these kinds (§7.7.1). Any calculation needing them fails loudly, naming the missing table — it never substitutes a neighbouring year's value.
- **What would resolve it:** sourcing the tables from the SSA / IRS publications the plan document incorporates by reference, or from the plan document's own table, and recording the source document, version date, and effective dates. Until then, integrated formulas (I-01–I-04 in Stage 1 output 01) cannot be exactly reconstructed for participants whose integration level depends on these tables.

### OD-2 — Historical statutory limits tables not yet sourced

- **Unresolved:** no IRC §401(a)(17) compensation-limit-by-year table and no IRC §415(b) maximum-benefit-by-year table were found in the reviewed material (gap G-4). The Answer Book Ch. 9 discusses these limits but contains no limits table.
- **Design consequence:** `PlanVersion.statutoryLimitsInForce` (§7.3) is an empty list with a note until the tables are sourced. A calculation that needs a limit for a given year is blocked with the limit named.
- **What would resolve it:** IRS-published limits tables (statute/regulation, hierarchy level 1), recorded as `SourceDocument`s with version dates. Values must come from IRS publications, never invented.

### OD-3 — How PlanVersion handles a plan merger

- **Unresolved:** the model assumes one `Plan` per `Case` (§1.1 rule 3). A plan merger (or transfer) — where two plans' provision timelines merge into one, or one plan's participants move into another plan — has no representation yet.
- **What Stage 1 found:** plan mergers and transfers are listed as historical events in `MASTER_PROMPT.md` §5, but no merger case was examined and no source gives the data shape.
- **Design consequence:** none yet. A case involving a merger must not be modelled by merging two `Plan` rows ad hoc.
- **What would resolve it:** a user decision on the merger representation (candidate: a `PlanMerger` event linking two `PlanVersion` timelines with a merger date and a successor-plan rule; or a second `Plan` in the case package with a defined relationship). Recorded here for Stage 3 / the user, not decided silently.

### OD-4 — PlanVersion gap: what a missing amendment means

- **Unresolved:** §6.2 rule 1 requires the timeline to have no gaps, and a gap is recorded as a missing-data item. But the *severity* of a gap depends on whether any participant's accrual falls in the gap era — which is a per-participant question, not a timeline question.
- **What would resolve it:** a Stage 4 rule stating how a gap is graded per participant (class (a) vs (e) in the §A.6 split) and whether a gap-era benefit can be bounded from the neighbouring versions. Until then, any gap blocks reconstruction for participants with service in the gap era, and the disposition is `requires-investigation` or `indeterminate`.

### OD-5 — Currency is an app convention, not a dictionary fact

- **Unresolved (by design):** the dictionary states no currency for PA_AMB. The model stores `"USD"` as an app-level convention (§1.2.1), recorded in `Case.currencyConvention`.
- **What would resolve it:** nothing further is needed unless a case involves a non-USD plan (not expected for PBGC trusteed plans). If one ever does, the `CurrencyCode` type must be extended by a recorded decision — not by editing a single record.

### OD-6 — Rounding rule "not stated" has no default

- **Unresolved:** many plan documents do not state a rounding rule. The model stores `"not stated — see gap G-6"` (§7.4) and never defaults to a rounding convention.
- **What would resolve it:** a Stage 4 decision on the fallback when the plan is silent — e.g. "round the final monthly benefit to the nearest cent, record the assumption, and test the alternative rounding sequences as diagnostic hypotheses" (per `MASTER_PROMPT.md` §9). The fallback must be a documented, reviewer-visible assumption, not a silent default. A numerical match obtained by arbitrarily changing rounding is not proof of the administrator's methodology.

### OD-7 — Participant-key collision handling

- **Unresolved:** `Participant.participantKey` is generated from (CASE + SSN + DOB). Two different people could in principle share all three (e.g. a data error), and the same person could appear with two different SSNs (e.g. a corrected SSN).
- **What Stage 1 found:** collisions are quarantined (rule S-05), but the quarantine's resolution workflow is not specified.
- **What would resolve it:** a Stage 4 / Stage 6 decision on the quarantine UI and the merge/split procedure (which requires human review, cites the evidence, and is recorded as a `RevisionRecord`).

### OD-8 — The BCV manuals' PA_AMB content is unknown

- **Unresolved:** `processing-manual.pdf` and `bcv-manual-combined.pdf` have unreadable text layers (Stage 1 output 00 §5). Their content — including any AMB loading/validation procedure — was **not reviewed**.
- **Design consequence:** this model must not assume the manuals are silent. Any procedure derived without them is flagged as such. If OCR or a re-encoded copy later reveals a PA_AMB procedure, this model and the validation catalog must be revised — the revision is a new version of this document, not a silent edit.
- **What would resolve it:** OCR (or a re-encoded copy) of both PDFs, and a Stage 1 follow-up inventory of what they say about PA_AMB.

### OD-9 — DOBF grain in formulas that cite "DOBF" without qualification

- **Unresolved:** the plan document or a formula may cite "DOBF" without saying plan-level or participant-level. The model qualifies DOBF by grain everywhere it stores it (§7.2 `freezeDatePlanLevel`, §7.6 `dobfParticipant`), but a source that cites bare "DOBF" cannot be stored until the grain is established.
- **What would resolve it:** per-case establishment from the document context (a plan-level freeze date in a plan document vs a participant-level date in a census row), recorded in the provenance note. A bare "DOBF" with unestablished grain is stored as `unknown` with a data request, not guessed.

### OD-10 — Historical valuation data as a cross-check: which fields, and when they block

- **Unresolved:** prior valuation reports carry `XRD_MB_TERM`, `TERM_MB_*_NSF`, `LS_TERM`, `PVMB_*` fields that can cross-check a reconstruction — but they are different bases from PA_AMB (ERD/EURD/NRD/XRD vs DOTE). Stage 1 output 02 rule C-03 forbids comparing them to PA_AMB without a basis conversion, but the conversion rules for each field are not yet specified.
- **What would resolve it:** a Stage 4 specification of the basis conversion for each BCV-calculated field (which factors, which citations), or a decision that a given field is not usable as a cross-check in this system. Until then, BCV-calculated fields are stored as `bcvCrossChecks` (§7.10) and shown, but never compared to PA_AMB.

---

## Appendix A — Entity relationship summary

```
Case ──1:1── Plan ──1:many── PlanVersion ──1:many── Formula
  │                              │                      │
  │                              │ (pinned by)          │ (pinned by)
  │                              ▼                      ▼
  │                    BenefitCalculation ◄── BenefitComparison ──► BenefitObservation
  │                              │                      ▲                  │
  │                              │                      │                  │
  │                              ▼                      │                  ▼
  │                    CalculationRun ──────────────────┘          Participant
  │                              ▲                                  ▲  ▲  ▲
  │                              │                                  │  │  │
  │                    (pins snapshot)                             │  │  │
  │                                                                 │  │  │
  │              EmploymentPeriod ── CompensationHistory ── ServiceHistory
  │                                                                 │
  │              DiagnosticHypothesis ──► BenefitComparison         │
  │                              │                                  │
  │                              ▼                                  ▼
  │                    SourceDocument ◄── (provenance of everything)
  │                              │
  │              ActuarialDecision ──► Participant (sets PA_AMB_ACCEPT)
  │
  └── CaseEvent (append-only log) ──► RevisionRecord (corrections)
```

**Cardinalities, stated once:** one `Case` per package; one `Plan` per `Case`; many `PlanVersion`s per `Plan`; many `Formula`s per `PlanVersion`; many `Participant`s per `Case`; many `EmploymentPeriod` / `CompensationHistory` / `ServiceHistory` / `BenefitObservation` / `BenefitCalculation` / `BenefitComparison` / `ActuarialDecision` per `Participant`; many `DiagnosticHypothesis` per `BenefitComparison`; many `CalculationRun`s per `Case`; many `SourceRecord`s and `CaseEvent`s per `Case`.

## Appendix B — Traceability to the governing spec and Stage 1

| This document | Source |
|---|---|
| §1.1–1.4 common foundations | Stage 1 output 02 §0.7 (conventions), §A.1.1 (import invariants) |
| §2 provenance | `MASTER_PROMPT.md` §6; Stage 1 output 02 §A.1.1 rule 2, §A.2 (provenance column) |
| §3 immutable vs normalised | `MASTER_PROMPT.md` §6, §17; Stage 1 output 02 §A.1.1 rule 1; Stage 1 output 04 §7.2 invariant 1 |
| §4 event / revision | `MASTER_PROMPT.md` §6, §17; Stage 1 output 04 §7.1–7.4 |
| §5 typed benefit quantity | `MASTER_PROMPT.md` §3; Stage 1 output 01 §2 |
| §6 temporal model | `MASTER_PROMPT.md` §5; Stage 1 output 01 §3 |
| §7.1 Case | Stage 1 output 02 §A.2.1, §A.3.1 item M-7, §B.0.1 (tolerances) |
| §7.2 Plan | Stage 1 output 02 §A.2.2 |
| §7.3 PlanVersion | Stage 1 output 02 §A.2.3; `MASTER_PROMPT.md` §5 |
| §7.4 Formula | Stage 1 output 02 §A.2.4; Stage 1 output 01 (taxonomy) |
| §7.5 Participant | Stage 1 output 02 §A.2.5 |
| §7.6 EmploymentPeriod | Stage 1 output 02 §A.2.6; DBAB Ch. 7 |
| §7.7 CompensationHistory | Stage 1 output 02 §A.2.7, §A.4 (non-census inputs) |
| §7.8 ServiceHistory | Stage 1 output 02 §A.2.8 |
| §7.9 BenefitObservation | Stage 1 output 02 §A.2.9, §B.4 (measurement-date rules M-01–M-06) |
| §7.10 BenefitCalculation | Stage 1 output 02 §A.2.10; `MASTER_PROMPT.md` §8 |
| §7.11 BenefitComparison | Stage 1 output 02 §A.2.11; `MASTER_PROMPT.md` §10 |
| §7.12 DiagnosticHypothesis | Stage 1 output 02 §A.2.12; `MASTER_PROMPT.md` §10 |
| §7.13 SourceDocument | Stage 1 output 02 §A.2.13 |
| §7.14 ActuarialDecision | Stage 1 output 02 §A.2.14, §A.7 (reachability); `MASTER_PROMPT.md` §14 |
| §7.15 CalculationRun | Stage 1 output 02 §A.2.15; `MASTER_PROMPT.md` §6, §17 |
| §9 invariants | Stage 1 output 04 §7.2 |
| §10 open decisions | Stage 1 output 00 §5; Stage 1 output 02 §A.4 gaps G-3, G-4, §B.5 gap G-6 |
