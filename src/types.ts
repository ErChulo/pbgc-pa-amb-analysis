/**
 * Canonical shared types for the PA_AMB Analysis System (Stage 4 foundation).
 *
 * Transcribed from the Stage 2 / Stage 3 specifications. Nothing here is
 * renamed, redefined, or invented: where the spec is silent, the gap is
 * marked with an "OPEN:" note instead of a coined value.
 *
 * Sources (section numbers are the spec's own):
 * - stage2/01-data-model.md — §1 common foundations, §2 provenance,
 *   §3 immutable vs normalised, §4 event/revision, §5 typed benefit,
 *   §6 temporal model, §7 the 15 entities, §9 invariants.
 * - stage2/04-calculation-functions.md — §0–§3 pipeline/outcome/decimal
 *   types, §4 rounding types, §5 bounds types, §6 reconciliation hook,
 *   §11.1 common formula types (CalcResult, CalcContext, RoundingSpec).
 * - stage3/02-date-calculations.md — §5.1 ServiceResult, §5.5 decision
 *   D-5.1 (canonical DecimalString; rational retained alongside).
 *
 * Rules that govern this file:
 * - Money is integer minor units, never a binary float (01 §1.2).
 * - A blank is `null`, never 0 (01 §1.2 rule 2).
 * - "Unknown" is a value, not an absence (01 §0.2).
 * - BCV field names are copied exactly from the dictionary; app-only
 *   fields are snake_case in prose and never presented as BCV fields
 *   (01 §1.1).
 * - TypedBenefitQuantity is defined exactly once, here (01 §5).
 */

// Type-only import (erased at compile): the per-plan service inputs live
// in src/service.ts (Stage 3 §5.1). CalculationRequest carries them by
// reference only; this file never constructs one (rule D-0).
import type { EmploymentPeriodInput, ServiceDefinition } from "./service";

// ---------------------------------------------------------------------------
// Stage 2 output 01, §1.1 — Identity and naming
// ---------------------------------------------------------------------------

/** Opaque, app-generated, stable identifier. Never reused, never a BCV field. */
export type EntityId = string;

/** ISO calendar date, YYYY-MM-DD. No time-of-day. */
export type DateString = string;

/** BCV field names are copied exactly from the dictionary (e.g. "PA_AMB",
 *  "CSPA"). App-only field names are snake_case and never presented as
 *  BCV fields. */
export type BcvFieldName = string;

// ---------------------------------------------------------------------------
// Stage 2 output 01, §1.2 — Money: integer minor units, always
// ---------------------------------------------------------------------------

/** Money as integer minor units (cents for USD). Never a binary float.
 *  150000 means $1,500.00. A value of 0 is a real zero, never a blank. */
export type MoneyMinor = number; // integer; enforced by validation, never by convention

/** The only currency the app supports in this version. "USD" is an
 *  app-level convention, not a dictionary fact (01 §1.2.1). */
export type CurrencyCode = "USD";

export interface Money {
  /** Integer minor units. Must satisfy Number.isInteger. */
  amountMinor: MoneyMinor;
  /** Minor units per major unit: 100 for USD cents. Recorded, not assumed. */
  minorUnitsPerMajor: 100;
  /** Currency. See §1.2.1 — the dictionary does not state a currency. */
  currency: CurrencyCode;
  /** Decimal places the source stated, if any (e.g. 2). null = not stated. */
  sourceDecimalPlaces: number | null;
}

// ---------------------------------------------------------------------------
// Stage 2 output 01, §2 — Provenance: every source record carries a
// precise location
// ---------------------------------------------------------------------------

/** Precise location of one value in its original source. Exactly one
 *  location kind is present; `kind` says which. */
export type SourceLocation =
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

export interface Provenance {
  /** The SourceDocument this location is in. */
  documentId: EntityId;
  /** Precise location inside that document. */
  location: SourceLocation;
  /** How the value was obtained. */
  acquisition: "imported" | "derived" | "user-entered" | "recovered";
  /** For "derived": the rule / function that derived it, e.g. "salary-year-derivation S-10".
   *  For "recovered": the other source it was recovered from (a second Provenance).
   *  null otherwise. */
  derivation: string | null;
  /** SHA-256 of the source file at import time. null for user-entered values. */
  sourceFileHash: string | null;
}

/** A single imported/derived value with its provenance attached.
 *  `value` is null when the source field was blank (missing, never zero). */
export interface SourcedValue<T> {
  value: T | null;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Stage 2 output 01, §3 — Immutable source records vs normalised /
// corrected values
// ---------------------------------------------------------------------------

/** Layer 1. One row of one imported file, exactly as imported. */
export interface SourceRecord {
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

/** A normalised entity field that has been corrected: original and current
 *  side by side. The original never changes. */
export interface CorrectedField<T> {
  /** The value as imported / as first normalised. Never changes. */
  original: SourcedValue<T>;
  /** The current (corrected) value. Equal to `original` when uncorrected. */
  current: SourcedValue<T>;
  /** The revision that produced `current`, if any. null when uncorrected. */
  correctedByRevisionId: EntityId | null;
}

// ---------------------------------------------------------------------------
// Stage 2 output 01, §4 — The event / revision mechanism
// ---------------------------------------------------------------------------

/** One event in the case's history. Append-only. Never edited, never deleted. */
export interface CaseEvent {
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
export interface RevisionRecord {
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

/** A frozen snapshot of everything a calculation run depended on. */
export interface InputSnapshot {
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

/** The case package — the unit of persistence (01 §4.4). A single versioned
 *  JSON file. Browser storage is never the source of truth. */
export interface CasePackage {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §5 — The typed benefit quantity
// ---------------------------------------------------------------------------

/** Annuity form. Values are BCV FORM_CODE values where the dictionary
 *  gives them; "unknown" is a valid stored value, never a default.
 *  (`string & {}` keeps the "NSF" / "NMF" literals visible while allowing
 *  any other BCV FORM_CODE value copied exactly from a source.) */
export type AnnuityForm = "NSF" | "NMF" | (string & {});

/** Vesting treatment of a benefit amount. */
export type VestingTreatment =
  | "gross" // Before any vesting percentage is applied.
  | "vested" // After the vesting percentage is applied (VP × gross).
  | "unknown"; // Not established. A valid stored value, never defaulted.

/** How the benefit's measurement date was established. */
export type MeasurementBasis =
  | "dote" // Measured at DOTE (the dictionary's stated basis for PA_AMB).
  | "dopt" // Measured at DOPT.
  | "nrd" // Measured at NRD.
  | "other-stated" // Measured at another stated date (the date is in `measurementDate`,
                   // the basis description is in `basisNote`).
  | "unresolved"; // No measurement date established. No Δ is computed (§6.4).

/** Where a benefit quantity came from, and what state it is in. */
export type BenefitSource =
  | "prior-administrator" // Reported by the prior administrator (PA_AMB).
  | "bcv-calculated" // A BCV Calculated field (e.g. BCV1.AMB), used as a cross-check only.
  | "independent-calculation" // Computed by this system's engine.
  | "bound" // A justified bound (B_i^min or B_i^max), not an exact benefit.
  | "scenario"; // One named scenario's value, not the benefit.

export type BenefitStatus =
  | "recorded" // Reported and stored; not yet compared.
  | "calculated" // Independently calculated; trace available.
  | "compared" // Compared against another benefit on an equivalent basis.
  | "not-comparable" // Bases not equivalent (incl. unresolved measurement basis).
  | "indeterminate"; // No defensible value could be produced.

/** THE typed benefit quantity. Every benefit in the system is one of these.
 *  Two benefits are comparable only when their bases are equivalent (§5.3).
 *  Defined exactly once, here — never redefined elsewhere. */
export interface TypedBenefitQuantity {
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

/** Basis statement for a comparison (01 §1.4, §5.3; 04 §6.1). */
export type ComparisonBasis = "same-basis" | "basis-converted" | "unresolved";

// ---------------------------------------------------------------------------
// Stage 2 output 01, §6 — The temporal model B_i(t) = F(X_i(≤t), P(≤t))
// ---------------------------------------------------------------------------

/** The provision timeline for one plan. Sorted by effectiveDate, ascending.
 *  Intervals are [effectiveDate, nextEffectiveDate): a version governs from
 *  its effectiveDate until (not including) the next version's effectiveDate.
 *  The last version governs from its effectiveDate with no end. */
export interface PlanVersionTimeline {
  planId: EntityId;
  versions: PlanVersion[]; // sorted by effectiveDate ascending; no gaps, no overlaps
}

/** A request to reconstruct a benefit at a date. The engine (Stage 4)
 *  implements this; the model fixes the inputs and the failure modes. */
export interface ReconstructionRequest {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.0 — Common block: every entity carries this
// ---------------------------------------------------------------------------

export interface EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.1 — Case
// ---------------------------------------------------------------------------

export type CompletenessGrade = "complete" | "partial" | "insufficient" | "excluded";

/** The reconciliation tolerance for this case. There is no PBGC tolerance
 *  for PA_AMB reconciliation. This record IS the tolerance: a human-set,
 *  documented, approved parameter. It is versioned with the Case, and every
 *  BenefitComparison names the version it used. */
export interface ToleranceRecord {
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
   *  for this decision. */
  authority: string;
  /** Who approved it. */
  approvedBy: string;
  /** ISO date approved. */
  approvedDate: DateString;
}

export interface Case extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.2 — Plan
// ---------------------------------------------------------------------------

export interface VestingSchedule {
  /** Schedule type as stated in the plan document, e.g. "graded", "cliff".
   *  The words are the plan's words, copied — not a coined code. */
  scheduleType: string;
  /** Ordered (yearsOfService, percent) pairs. Percent as a decimal string. */
  steps: Array<{ yearsOfService: number; percentDecimal: string }>;
  /** Plan document section cited. */
  sourceSection: string;
}

export interface Plan extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.3 — PlanVersion
// ---------------------------------------------------------------------------

export interface FreezeBlock {
  /** Plan-level freeze date (grain: plan). Participant-level DOBF is BCV1.DOBF. */
  freezeDate: DateString;
  /** Scope of the freeze, in the amendment's words. */
  scope: "full" | "accrual-only" | "partial";
  /** For a partial freeze: which groups / accruals are frozen, in the amendment's words. */
  partialScopeNote: string | null;
  /** Amendment section cited. */
  sourceSection: string;
}

export interface PlanVersion extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.4 — Formula
// ---------------------------------------------------------------------------

export interface Formula extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.5 — Participant
// ---------------------------------------------------------------------------

export type MissingDataClass = "a" | "b" | "c" | "d" | "e";

export interface MissingDataItem {
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

/** Spouse fields (BCV SSSN, SFNAME, SMNAME, SLNAME, SENAME, SSEX, SDOB,
 *  SDOD — BCV1, Input). Field list from 01 §7.5; full definitions live in
 *  the BCV Data Dictionary. */
export interface SpouseFields {
  ssn: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  nameSuffix: string | null;
  sex: "M" | "F" | "U";
  dob: DateString | null;
  dateOfDeath: DateString | null;
}

/** Beneficiary fields (BCV BSSN, BFNAME, …, BDOB — BCV1, Input).
 *  Field list from 01 §7.5; full definitions live in the BCV Data Dictionary. */
export interface BeneficiaryFields {
  ssn: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  dob: DateString | null;
}

/** Alternate-payee fields (BCV APSSN, APFNAME, …, APDOB, APSEX — BCV9, Input).
 *  Field list from 01 §7.5; full definitions live in the BCV Data Dictionary. */
export interface AlternatePayeeFields {
  ssn: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  sex: "M" | "F" | "U";
  dob: DateString | null;
}

export interface Participant extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.6 — EmploymentPeriod
// ---------------------------------------------------------------------------

export interface BreakInService {
  /** Whether a break occurred under the plan's rule. */
  occurred: boolean;
  /** Plan document section + DBAB Ch. 7 reference for the rule applied. */
  ruleRef: string;
  /** Whether prior service is restored on rehire, per the plan. */
  priorServiceRestored: boolean | "unknown";
}

export interface EmploymentPeriod extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.7 — CompensationHistory
// ---------------------------------------------------------------------------

export interface SalaryYearValue {
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

export interface NonCensusInputRef {
  /** What it is, e.g. "covered-compensation-table", "ssa-bend-points",
   *  "statutory-limit-401a17", "statutory-limit-415b". */
  inputKind: string;
  /** The SourceDocument it lives in, or null when not yet sourced. */
  documentId: EntityId | null;
  /** "sourced" | "not-yet-sourced" | "partial". */
  status: "sourced" | "not-yet-sourced" | "partial";
}

export interface CompensationHistory extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.8 — ServiceHistory
// ---------------------------------------------------------------------------

export interface ServicePeriod {
  start: DateString;
  end: DateString | null; // null = open at DOTE / DOPT
  measure: number; // service credited for this period, in `serviceMeasure` units
  provenance: Provenance; // EmploymentPeriod + plan records
}

export interface BreakApplication {
  /** The break (from EmploymentPeriod.breakInService). */
  employmentPeriodSeq: number;
  /** What the plan rule did with the break: service before the break
   *  kept / forfeited / restored, per the cited rule. */
  effect: string;
  ruleRef: string;
}

export interface Distribution {
  /** Kind, in the source's words: e.g. "lump-sum", "partial-distribution". */
  kind: string;
  amount: Money;
  distributionDate: DateString;
  /** Whether this distribution offsets the accrued benefit, per the plan. */
  offsetsBenefit: boolean;
  provenance: Provenance;
}

export interface ServiceHistory extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.9 — BenefitObservation
// ---------------------------------------------------------------------------

export interface BenefitObservation extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.10 — BenefitCalculation
// ---------------------------------------------------------------------------

/** One inspectable intermediate step. Every step names its evidence grade. */
export interface CalculationStep {
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

export interface Scenario {
  /** Name, e.g. "2004-amendment-applies-to-all-service". */
  name: string;
  /** The assumption(s) this scenario makes, stated explicitly. */
  assumptions: string;
  /** The benefit under this scenario, or null when the scenario is indeterminate. */
  benefit: Money | null;
  /** The PlanVersion / Formula this scenario uses, when it differs from the base. */
  planVersionId: string | null;
  formulaId: string | null;
  /** Per-scenario derivation trace (spec §1.6; Stage 4.5 fix): the
   *  CalculationSteps that produced this scenario's benefit, so the
   *  scenario is independently auditable. Optional/nullable — scenarios
   *  built before this field existed carry no trace. */
  trace?: CalculationTrace | null;
}

export interface BenefitCalculation extends EntityCommon {
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
  /** BCV-calculated benefit fields as cross-checks (BCV1.AMB, TERM_MB_*,
   *  XRD_MB_TERM), stored as TypedBenefitQuantity values with source
   *  "bcv-calculated". Optional field, default []. Never compared to PA_AMB
   *  without a basis conversion (rule C-03). */
  bcvCrossChecks?: TypedBenefitQuantity[];
}

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.11 — BenefitComparison
// ---------------------------------------------------------------------------

export interface BenefitComparison extends EntityCommon {
  comparisonId: string;
  observationId: EntityId;
  calculationId: EntityId;
  delta: Money | null;
  absDelta: Money | null;
  relDelta: string | null;
  comparisonBasis: ComparisonBasis;
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.12 — DiagnosticHypothesis
// ---------------------------------------------------------------------------

export type HypothesisType =
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

export interface EvidenceItem {
  /** → SourceDocument. */
  documentId: EntityId;
  /** Precise location (§2.2). */
  location: SourceLocation;
  /** Quote or paraphrase, short. Labelled as quote vs paraphrase. */
  text: string;
  isQuote: boolean;
}

export interface DiagnosticHypothesis extends EntityCommon {
  hypothesisId: string;
  comparisonId: EntityId;
  hypothesisType: HypothesisType;
  counterfactual: string;
  counterfactualCalculationId: EntityId | null;
  evidence: EvidenceItem[];
  rank: number;
  status: "proposed" | "tested-supported" | "tested-rejected" | "coincidence";
}

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.13 — SourceDocument
// ---------------------------------------------------------------------------

export type SourceDocumentType =
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

export interface SourceDocument extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.14 — ActuarialDecision
// ---------------------------------------------------------------------------

/** Disposition names are the MASTER_PROMPT §14 proposed application states,
 *  explicitly NOT official PBGC classifications. Labelled as such wherever shown. */
export type Disposition =
  | "verified"
  | "supported-for-acceptance"
  | "requires-investigation"
  | "correction-recommended"
  | "indeterminate";

export interface ActuarialDecision extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 01, §7.15 — CalculationRun
// ---------------------------------------------------------------------------

export interface CalculationRun extends EntityCommon {
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

// ---------------------------------------------------------------------------
// Stage 2 output 04, §3 — Decimal-safe arithmetic (representation)
// ---------------------------------------------------------------------------

/** Exact decimal value, canonical string form (e.g. "0.015", "1234.56",
 *  "22.5"). The string is the value; it is never parsed into a binary
 *  float for arithmetic. Canonical form (Stage 3 §5.5, decision D-5.1):
 *  no leading zeros, no trailing zeros in the fraction, "-0" is "0",
 *  no exponent notation. */
export type DecimalString = string;

/** Exact decimal as a scaled integer. `value` is an integer (bigint);
 *  the real value is value / 10^scale. This is the in-engine working form
 *  of a DecimalString. */
export interface ScaledInt {
  value: bigint;
  scale: number; // decimal places; 2 for cents, 0 for whole units
}

/** Exact rational, retained alongside the decimal wherever the plan
 *  defines a credit as a fraction (Stage 3 §5.5, decision D-5.1):
 *  Blond quarters (3/4, 1/2), hours fractions (1800/2000),
 *  fractional-accrual fractions (S_t / S_t^proj). The rational is the
 *  provenance of the decimal. */
export interface Rational {
  numerator: bigint;
  denominator: bigint; // never 0
}

// ---------------------------------------------------------------------------
// Stage 2 output 04, §4 — Configurable rounding rules (MASTER_PROMPT §9)
// ---------------------------------------------------------------------------

/** How a single value is rounded. The mode list is closed; a mode not in
 *  this list is not representable until a recorded decision adds it. */
export type RoundingMode =
  | "half-up" // 0.5 rounds away from zero (nearest, ties away from zero)
  | "half-even" // 0.5 rounds to the even neighbour (banker's rounding)
  | "down" // toward zero (truncation)
  | "up" // away from zero
  | "floor" // toward negative infinity
  | "ceiling"; // toward positive infinity

/** One rounding rule, applied at one point in the calculation. */
export interface RoundingRule {
  /** Which quantity this rule rounds. Closed list from MASTER_PROMPT §9. */
  target:
    | "compensation"
    | "average-compensation"
    | "credited-service"
    | "accrual-percentage"
    | "social-security-offset"
    | "intermediate-component"
    | "retirement-factor"
    | "actuarial-equivalence-factor"
    | "final-monthly-benefit";
  /** The unit to round to, as an exact decimal (e.g. "0.01" = nearest cent,
   *  "1" = nearest dollar or nearest whole year, "0.001" = three places). */
  unit: DecimalString;
  mode: RoundingMode;
  /** When it is applied: after an individual operation, after an annual
   *  accrual, after an intermediate result, or at the final calculation. */
  stage: "after-operation" | "after-annual-accrual" | "after-intermediate" | "final";
  /** Source: plan provision, administrator workpaper, valuation report, or
   *  "not-documented" (see §4.4 — an undocumented rule may be tested as a
   *  hypothesis, never applied as the prescribed sequence). */
  source: { kind: "plan-provision" | "workpaper" | "valuation-report" | "not-documented";
            citation: string | null };
}

/** A rounding sequence: the ordered list of rules applied in one calculation.
 *  The plan's prescribed sequence is one sequence; alternative plausible
 *  sequences are hypotheses (§4.4), each a different RoundingSequence. */
export interface RoundingSequence {
  sequenceId: string;
  rules: RoundingRule[];
}

/** Per-plan, versioned rounding configuration. Part of the case package,
 *  pinned to the calculation run like the tolerance record. */
export interface RoundingConfig {
  configId: string;
  version: string; // e.g. "rounding-config v1.0.0"
  planVersionId: EntityId;
  /** The prescribed sequence — the one the plan or the evidence states.
   *  null when no rounding rule is documented for this plan version. */
  prescribedSequence: RoundingSequence | null;
  /** Alternative plausible sequences, each labelled with its source and
   *  status. Tested as diagnostic hypotheses only (§4.4). */
  alternativeSequences: RoundingSequence[];
  /** Who set this configuration, when, and on what evidence. */
  setBy: string;
  setDate: DateString;
  rationale: string;
}

/** Attached to BenefitCalculation as `roundingApplied`. */
export interface RoundingRecord {
  sequenceId: string | "none-prescribed";
  /** Every rounding operation actually applied, in order. */
  operations: Array<{
    target: RoundingRule["target"];
    before: DecimalString;
    after: DecimalString;
    unit: DecimalString;
    mode: RoundingMode;
    ruleRef: string;
  }>;
  /** Maximum plausible rounding effect for this participant: the sum of the
   *  per-stage rounding units, in money (Stage 1 output 03, §2.7). A
   *  discrepancy larger than this cannot be explained by rounding alone. */
  maxPlausibleEffect: Money;
}

// ---------------------------------------------------------------------------
// Stage 2 output 04, §1 — Pipeline overview
// ---------------------------------------------------------------------------

/** Everything a calculation needs, assembled by the caller from the case
 *  package. The engine never fetches data itself. */
export interface CalculationRequest {
  /** Participant whose benefit is calculated. */
  participantKey: string;
  /** Participant history X_i(≤t): employment, service, compensation,
   *  distributions, prior benefit observations. */
  participantHistory: ParticipantHistory;
  /** Plan provisions P(≤t): the effective-dated provision timeline. */
  provisionTimeline: PlanVersionTimeline;
  /** The measurement date t. null = not established; the pipeline then
   *  returns an unresolved-basis outcome (§1.4) and does not calculate. */
  measurementDate: DateString | null;
  /** How the measurement date was established (output 01 §5.1). */
  measurementBasis: MeasurementBasis;
  /** Calculation kind: accrued (B1) is the only kind compared to PA_AMB.
   *  Projected and payable-at-commencement are separate kinds (output 01 §5.2). */
  calculationKind: "accrued" | "projected" | "payable-at-commencement";
  /** The formula definition to apply (from the §11 catalog). */
  formulaId: EntityId;
  /** Rounding configuration for this plan version (§4). */
  roundingConfig: RoundingConfig;
  /** Case tolerance record, pinned at run time (output 01 §7.1). */
  tolerance: ToleranceRecord;
  /** Caller-supplied per-plan service definitions (Stage 3 §5.1:
   *  crediting methods, fractional-conversion rule, accrual start,
   *  vesting schedule, break rules, cap, freeze). Absent/null = not
   *  supplied: Stage 3 then derives service from the ServiceHistory
   *  exactly as before. When present, Stage 3 derives service from
   *  service.ts using this definition and `employmentPeriods` below.
   *  The definition is a caller-supplied per-plan input — the engine
   *  NEVER invents plan rules (rule D-0): a definition that cannot
   *  derive service is refused, never completed with a default. */
  serviceDefinition?: ServiceDefinition | null;
  /** Employment periods for the Stage 3 service computation
   *  (Stage 3 §5.1 EmploymentPeriodInput), parallel to
   *  participantHistory.employmentPeriods but carrying the hours and
   *  accrual-start data service.ts needs. Absent/null = not supplied.
   *  Required alongside `serviceDefinition` for the definition path;
   *  a definition without periods is refused, not guessed. */
  employmentPeriods?: EmploymentPeriodInput[] | null;
  /** Input snapshot + rule versions, for reproducibility (§6, output 01 §4.3). */
  runContext: RunContext;
}

/** A stage that cannot produce its output. Returned, never thrown past the
 *  pipeline boundary, and never replaced by a guessed value. */
export interface StageFailure {
  stage: StageNumber; // 1–10
  /** Why the stage could not proceed: missing input, inapplicable rule,
   *  unresolved basis, or a rule applied outside its applicability. */
  reason: "missing-input" | "inapplicable-rule" | "unresolved-basis" | "rule-refused";
  /** The missing input(s) or the rule, by id. */
  detail: string;
  /** What the pipeline does next: widen to bounds (§5) or go indeterminate. */
  next: "bounds" | "indeterminate";
}

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** The pipeline's single return type. Exactly one of the three shapes is
 *  present; the other two are null. A function must never return a single
 *  made-up number when the evidence cannot support one (§5). */
export type CalculationOutcome =
  | { kind: "exact"; benefit: TypedBenefitQuantity; trace: CalculationTrace }
  | { kind: "bounds"; bounds: BoundsResult; trace: CalculationTrace }
  | { kind: "indeterminate"; reason: IndeterminateReason; trace: CalculationTrace };

/** Accumulates as the pipeline runs. Each stage reads what it needs and
 *  writes its own output; it never rewrites an earlier stage's output. */
export interface PipelineState {
  request: CalculationRequest;
  /** Stage 1 output: the applicable provisions at the measurement date. */
  provisions: ApplicableProvisions | null;
  /** Stage 2 output: eligibility findings. */
  eligibility: EligibilityResult | null;
  /** Stage 3 output: service measures. */
  service: ServiceMeasures | null;
  /** Stage 4 output: compensation measures. */
  compensation: CompensationMeasures | null;
  /** Stage 5 output: base benefit, before protections/restrictions. */
  baseBenefit: TypedBenefitQuantity | null;
  /** Stage 6 output: benefit after accrual/grandfathering/protection. */
  protectedBenefit: TypedBenefitQuantity | null;
  /** Stage 7 output: benefit after plan/statutory restrictions. */
  restrictedBenefit: TypedBenefitQuantity | null;
  /** Stage 8 output: benefit after prescribed rounding. */
  roundedBenefit: TypedBenefitQuantity | null;
  /** Stage 9 output: benefit on the normal-retirement basis. */
  normalRetirementBenefit: TypedBenefitQuantity | null;
  /** Stage 10 output: comparison inputs for §10 (§6). */
  reconciliation: ReconciliationInputs | null;
  /** Every stage appends its CalculationSteps here, in order. */
  trace: CalculationTrace;
  /** Missing inputs encountered, each classified M1–M5 (MASTER_PROMPT §12;
   *  Stage 1 output 03, §4.1). Drives the exact/bounds/indeterminate fork. */
  missingInputs: MissingDataItem[];
}

/** The ordered trace of a calculation: every stage's CalculationSteps,
 *  in evaluation order. */
export type CalculationTrace = CalculationStep[];

/** Stage 1 output: the applicable provisions at the measurement date. */
export interface ApplicableProvisions {
  planVersionId: EntityId;
  formulaId: EntityId;
  /** Effective-dated provision set in force at the measurement date. */
  provisionsAtDate: PlanVersion;
  /** Amendments/restatements whose effective date is ≤ measurement date,
   *  in effective-date order, each with adoption and effective dates. */
  amendmentHistory: PlanVersion[];
  /** Freeze in effect at the measurement date, or null. */
  freeze: FreezeBlock | null;
  /** Statutory limits in effect at the measurement date (e.g. IRC §415,
   *  §401(a)(17)), as stated values with their source citations. */
  statutoryLimits: StatutoryLimit[];
}

/** Stage 2 output: eligibility findings. */
export interface EligibilityResult {
  isParticipant: boolean;
  participationDate: DateString | null;
  /** Eligibility rule applied, with its source citation. */
  eligibilityRuleRef: string;
  /** Exclusion that applies, if any (employment group, plan provision). */
  exclusion: string | null;
  /** Rehire/restoration finding, if the history contains a rehire. */
  rehireFinding: string | null;
}

/** Stage 3 output: service measures. */
export interface ServiceMeasures {
  /** Credited service for benefit accrual, as an exact decimal (§3).
   *  null when it cannot be established. */
  creditedService: DecimalString | null;
  /** Vesting service, as an exact decimal, or null. */
  vestingService: DecimalString | null;
  /** Eligibility service, as an exact decimal, or null. */
  eligibilityService: DecimalString | null;
  /** Vesting percentage VP (exact decimal, 0–1), or null when not established. */
  vestingPercentage: DecimalString | null;
  /** Service periods used, with breaks and prorations applied, each with
   *  its source. */
  servicePeriods: ServicePeriod[];
  /** Service cap applied (e.g. maximum credited service), or null. */
  serviceCap: { capYears: DecimalString; ruleRef: string } | null;
}

/** Stage 4 output: compensation measures. */
export interface CompensationMeasures {
  /** Compensation by year used in the average, each with its source and
   *  evidence grade. A missing year is present with value null. */
  compensationYears: SalaryYearValue[];
  /** The averaging period applied (e.g. "final-3-year", "highest-5-year"),
   *  as stated in the plan provisions. */
  averagingPeriod: { description: string; ruleRef: string };
  /** Average compensation, integer minor units, or null when a required
   *  year is missing. */
  averageCompensation: Money | null;
  /** Compensation cap applied (e.g. IRC §401(a)(17) in effect), or null. */
  compensationCap: { capAnnual: Money; ruleRef: string } | null;
  /** Documented alternative averaging periods available for counterfactual
   *  testing (§6.2). */
  alternativeAveragingPeriods: string[];
}

/** Stage 6 output: protection application. */
export interface ProtectionApplication {
  /** Which protection applied, with its source citation. */
  protection: { kind: string; ruleRef: string } | null;
  /** The pre-protection benefit (Stage 5 output), retained for the trace. */
  preProtection: TypedBenefitQuantity;
  /** The greater-of / lesser-of comparison, when one was evaluated. */
  comparison: { candidates: Money[]; selected: Money; ruleRef: string } | null;
}

/** Stage 7 output: restriction application. */
export interface RestrictionApplication {
  /** Each restriction applied, in application order, with its effect. */
  applied: Array<{
    restriction: string; // e.g. "IRC §415 limit", "Social Security offset"
    ruleRef: string;
    before: Money;
    after: Money;
  }>;
  /** Restrictions evaluated and not applied, with the reason. */
  notApplied: Array<{ restriction: string; reason: string }>;
}

/** Stage 9 output: basis conversion. */
export interface BasisConversion {
  /** Each conversion applied, in order, with its factor and citation. */
  conversions: Array<{
    conversion: string; // e.g. "annual-to-monthly", "form conversion", "vesting"
    factor: DecimalString;
    ruleRef: string;
    before: Money;
    after: Money;
  }>;
}

// ---------------------------------------------------------------------------
// Stage 2 output 04, §5 — The bounds / scenarios path
// ---------------------------------------------------------------------------

/** The bounds result. The output of the pipeline when exact reconstruction
 *  is impossible but justified bounds are. */
export interface BoundsResult {
  /** Lower bound B_i^min, integer minor units. */
  min: Money;
  /** Upper bound B_i^max, integer minor units. */
  max: Money;
  /** The assumption set under which the bounds are guaranteed: every bound
   *  is conditional on these assumptions holding. */
  assumptions: string[];
  /** How each bound was derived (§5.2): endpoint evaluation, kink
   *  evaluation, or grid/optimisation over the feasible region. */
  derivation: BoundsDerivation;
  /** The missing inputs that widen the interval, each with its class and
   *  its contribution to the width (§5.4). */
  widthAttribution: WidthAttribution[];
  /** Named scenarios evaluated (§5.3), each with its stated assumptions. */
  scenarios: Scenario[];
  /** Where the recorded PA_AMB falls relative to the range. */
  recordedPosition: "inside" | "below-min" | "above-max" | "recorded-missing";
  /** The reconstructed benefit as a typed quantity with source "bound"
   *  (output 01, §5.1) — for the min and the max separately, so neither
   *  is ever mistaken for an exact benefit. */
  minBenefit: TypedBenefitQuantity;
  maxBenefit: TypedBenefitQuantity;
}

export interface BoundsDerivation {
  method: "endpoint-evaluation" | "endpoint-plus-kinks" | "grid" | "optimisation";
  /** Kink points evaluated (cap thresholds, freeze dates, formula-change
   *  dates) — required when the method is endpoint-plus-kinks or finer. */
  kinkPoints: Array<{ description: string; value: DecimalString }>;
  /** Monotonicity verification (§5.2): per missing input, whether the
   *  benefit is monotone in that input over its feasible range, and how
   *  that was established. */
  monotonicity: Array<{
    input: string;
    monotone: boolean;
    verifiedBy: string; // e.g. "formula structure", "endpoint+kink evaluation"
  }>;
  /** Feasible region of the missing inputs, stated explicitly. */
  feasibleRegion: string;
}

export interface WidthAttribution {
  missingInput: string;
  missingClass: "a" | "b" | "c" | "d" | "e"; // output 01 §7.6 (M1–M5)
  widthContribution: Money;
  widthShare: DecimalString; // proportion of total width, exact decimal
  couldChangeDisposition: boolean;
}

// ---------------------------------------------------------------------------
// Stage 2 output 04, §6 — The reconciliation hook
// ---------------------------------------------------------------------------

/** The comparison inputs Stage 10 hands to the reconciliation module.
 *  The reconciliation module (Stage 5 build) owns Δ/D/R, the tolerance
 *  test, and the disposition recommendation; this interface only supplies
 *  its inputs, so a tolerance change never requires re-running the
 *  calculation. */
export interface ReconciliationInputs {
  /** The reconstructed benefit B̂_i, on the same basis as PA_AMB — or null
   *  when the basis is unresolved or the outcome is bounds/indeterminate. */
  reconstructed: TypedBenefitQuantity | null;
  /** The recorded PA_AMB, as a typed benefit quantity with
   *  source "prior-administrator". null when the recorded amount is blank
   *  (missing data — never zero). */
  recorded: TypedBenefitQuantity | null;
  /** Basis statement: same-basis, basis-converted (with the conversion
   *  stated), or unresolved. Unresolved ⇒ no Δ is computed. */
  comparisonBasis: ComparisonBasis;
  /** The conversion applied, when the basis was converted (e.g. annual→
   *  monthly ÷12, form conversion with factors cited, vesting conversion
   *  with VP cited). Required when comparisonBasis is "basis-converted". */
  basisConversion: string | null;
  /** Bounds, when the outcome is bounds (§5). The reconciliation module
   *  uses the recorded-position test, not a Δ. */
  bounds: BoundsResult | null;
  /** Counterfactual results (§6.2). */
  counterfactuals: CounterfactualResult[];
  /** Denominator flag, when B̂_i is zero or near zero (Stage 1 output 03,
   *  §2.3): "R_UNDEFINED_ZERO_DENOMINATOR", "R_UNSTABLE_SMALL_DENOMINATOR",
   *  or "PA_ZERO". A flag is recorded instead of a relative difference. */
  denominatorFlag: string | null;
  /** The tolerance record version applied (a copy, pinned at run time). */
  toleranceApplied: ToleranceRecord;
}

/** One counterfactual operation. The union is closed to the Stage 1 §2.6
 *  minimum set; a new operation type enters only by a recorded decision. */
export type CounterfactualOperation =
  | { kind: "service-delta-years"; years: DecimalString } // e.g. "+1", "-1"
  | { kind: "averaging-period"; period: string } // a documented alternative period
  | { kind: "formula-version"; formulaId: EntityId } // a documented historical formula
  | { kind: "vesting"; mode: "applied-once" | "not-applied" | "applied-twice-diagnostic" }
  | { kind: "rounding-sequence"; sequence: RoundingSequence } // §4.4, hypothesis only
  | { kind: "cap"; cap: "service-cap" | "compensation-cap" | "section-415-limit";
      applied: boolean }
  | { kind: "freeze"; respected: boolean } // diagnostic only; the freeze is binding
  | { kind: "prior-distribution"; deducted: boolean };

/** A tested hypothesis: the operation, the recomputed benefit, the residual
 *  discrepancy, and the support class. Ranking (by evidence and explanatory
 *  power, not numerical proximity) belongs to the reconciliation module. */
export interface CounterfactualResult {
  operation: CounterfactualOperation;
  /** The explanation this tests (H1–H17, MASTER_PROMPT §10). */
  hypothesisCode: string; // e.g. "H2", "H4", "H15"
  /** Recomputed benefit under the counterfactual, or null when the
   *  counterfactual cannot be evaluated. */
  benefit: TypedBenefitQuantity | null;
  /** Residual discrepancy after the counterfactual (Δ under the
   *  counterfactual), or null when not computable. */
  residualDelta: Money | null;
  /** Support class (Stage 1 output 03, §2.6): Supported / Plausible /
   *  Coincidence / Refuted. A Coincidence is never presented as an
   *  explanation and never moves a disposition to Verified. */
  supportClass: "supported" | "plausible" | "coincidence" | "refuted";
  /** Evidence for and against, with precise citations. */
  evidenceFor: string[];
  evidenceAgainst: string[];
}

// ---------------------------------------------------------------------------
// Stage 2 output 04, §11.1 — Common types used by every formula signature
// ---------------------------------------------------------------------------

export type EvidenceGrade = "fact" | "assumption" | "estimate" | "unknown";

/** Shared calculation context: the plan-version in force, the measurement date,
 *  and plan-stated rounding. */
export interface CalcContext {
  planVersionId: string; // PlanVersion.versionId (01 §7); pins P(t). Never "latest".
  measurementDate: string; // ISO date t in B_i(t) = F(X_i(≤t), P(≤t)).
  rounding: RoundingSpec; // Plan-stated rounding; see below. No default rounding is assumed.
}

/** Plan-stated rounding only. No universal PBGC benefit-rounding policy was found. */
export interface RoundingSpec {
  stage: "per-operation" | "per-annual-accrual" | "per-intermediate" | "final-only";
  mode: "nearest-dollar" | "nearest-cent" | "truncate" | "none";
  source: string; // Plan-document section, or "unknown" — never an invented default.
}

/** A named alternative outcome, for scenario results. */
export interface NamedScenario<T> {
  name: string;
  value: T;
  basis: string;
  /** Per-scenario derivation trace (spec §1.6; Stage 4.5 fix): the
   *  CalculationSteps that produced this scenario's value, so the
   *  scenario is independently auditable. Optional/nullable — scenarios
   *  built before this field existed carry no trace. */
  trace?: CalculationTrace | null;
}

/**
 * First-class result of every formula function. `exact` only when the evidence supports an exact
 * number. Otherwise a bound, an explicit scenario set, or indeterminate — with the missing inputs
 * named so the system can say what would resolve it. Dispositions (Verified / Supported for
 * acceptance / Requires investigation / Correction recommended / Indeterminate) are human decisions
 * recorded on ActuarialDecision; they are NOT returned by these functions.
 */
export type CalcResult<T> =
  | { kind: "exact"; value: T; evidenceGrade: EvidenceGrade }
  | { kind: "bound"; min: T; max: T; evidenceGrade: "estimate"; missingInputs: string[] }
  | { kind: "scenarios"; scenarios: NamedScenario<T>[]; evidenceGrade: "estimate"; missingInputs: string[] }
  | { kind: "indeterminate"; evidenceGrade: "unknown"; missingInputs: string[]; wouldResolve: string[] };

/** A dated plan provision in force at the measurement date: value + the PlanVersion that supplies it. */
export interface DatedValue<T> { value: T; effectiveFrom: string; planVersionId: string; }

/** Function-type form of the pipeline entry point (04 §1.1). The engine
 *  worker implements this; this file only fixes the contract. */
export type CalculateAccruedBenefitFn = (request: CalculationRequest) => CalculationOutcome;

/** Function-type form of the counterfactual interface (04 §6.2). */
export type TestCounterfactualFn = (
  request: CalculationRequest,
  operation: CounterfactualOperation,
) => CounterfactualResult;

// ---------------------------------------------------------------------------
// Stage 3, §5.1 / §5.5 — Service result (decision D-5.1)
// ---------------------------------------------------------------------------

/** One period's service trace, from the plan's service computation. */
export interface ServicePeriodTrace {
  periodStart: DateString;
  periodEnd: DateString;
  method: "hours-based" | "elapsed-time";
  rawCredit: DecimalString; // before break / proration / cap
  creditAfterBreaks: DecimalString;
  creditAfterProration: DecimalString;
  ruleRef: string;
}

/** A service result: exact decimal years plus the full trace inputs.
 *  `value` is null when the quantity cannot be established. */
export interface ServiceResult {
  value: DecimalString | null;
  /** Exact rational form, kept alongside the decimal where the plan defines
   *  the credit as a fraction (e.g. 3/4 year, 1800/2000). See §5.5. */
  rational: Rational | null;
  periods: ServicePeriodTrace[];
  missingInputs: string[]; // ids of the ServiceDefinition fields that were null
  roundingApplied: Array<{ rule: string; before: DecimalString; after: DecimalString }>;
}

// ---------------------------------------------------------------------------
// Minimal transcriptions — shapes the specs reference but do not fully
// define. Marked OPEN; extend only by a recorded decision, never silently.
// ---------------------------------------------------------------------------

/** OPEN (04 §1.1): `runContext` is named in CalculationRequest but its
 *  fields are not listed in 04 §§0–3. Minimal transcription: the version
 *  fields InputSnapshot (§4.3) pins for a run. */
export interface RunContext {
  engineVersion: string;
  ruleVersion: string;
  formulaTaxonomyVersion: string;
  inputSnapshotHash: string;
}

/** OPEN (04 §1.4): the indeterminate reason's shape is shown only by
 *  example (`{ code: "unresolved-comparison-basis", ... }`). Minimal
 *  transcription: a code, a human-readable detail, and the missing inputs
 *  with what would resolve them. */
export interface IndeterminateReason {
  code: string;
  detail: string;
  missingInputs: string[];
  wouldResolve: string[];
}

/** OPEN (04 §5.2): the feasible region of the missing inputs is named but
 *  its shape is not specified. Minimal transcription: a stated description.
 *  A structured feasible region (per-input ranges) is Stage 5 work. */
export interface FeasibleRegion {
  description: string;
}

/** OPEN (04 §1.1): ParticipantHistory is named as "participant history
 *  X_i(≤t)" but its fields are not listed in 04 §§0–3. Minimal
 *  transcription: the dated history elements of 01 §6.3. */
export interface ParticipantHistory {
  participantKey: string;
  employmentPeriods: EmploymentPeriod[];
  compensationHistory: CompensationHistory | null;
  serviceHistory: ServiceHistory | null;
  benefitObservations: BenefitObservation[];
}

/** OPEN (04 §2 Stage 1): a statutory limit "as a stated value with its
 *  source citation". Minimal transcription; the limits tables themselves
 *  are unsourced (01 OD-2, gaps G-4). */
export interface StatutoryLimit {
  limitId: string; // e.g. "IRC §415(b) 2020", "IRC §401(a)(17) 2020"
  description: string;
  sourceCitation: string;
}
