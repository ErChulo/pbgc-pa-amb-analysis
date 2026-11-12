"use strict";
/**
 * Entity constructors and helpers for the case package.
 *
 * Governing rules (Stage 2 output 01):
 * - §3.1: Layer 1 source records are append-only; Layer 2 entities are
 *   versioned, never mutated. A correction creates a new version; the old
 *   version stays and is the version a prior CalculationRun pinned.
 * - §4.2: every state transition appends an audit event; no transition
 *   silently rewrites history. A correction requires cited authority.
 * - §4.3: a CalculationRun pins its InputSnapshot (exact entity versions).
 * - §6.2: the PlanVersionTimeline is a partition by effectiveDate.
 *   Adoption date is stored separately and NEVER selects the version.
 *
 * Every function here is pure: explicit inputs in, a new value out. No
 * clock, no randomness, no storage, no network. IDs and dates are
 * caller-supplied (the core never generates them), so two runs over the
 * same inputs produce byte-identical outputs. Hashing is a boundary
 * concern: callers supply snapshot hashes; this module never computes one.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEntityCommon = createEntityCommon;
exports.nextEntityVersion = nextEntityVersion;
exports.createEmptyCasePackage = createEmptyCasePackage;
exports.appendSourceRecord = appendSourceRecord;
exports.appendCaseEvent = appendCaseEvent;
exports.makeSourceRecord = makeSourceRecord;
exports.makeRevisionRecord = makeRevisionRecord;
exports.applyCorrection = applyCorrection;
exports.currentVersion = currentVersion;
exports.createInputSnapshot = createInputSnapshot;
exports.snapshotCurrentVersions = snapshotCurrentVersions;
exports.buildPlanVersionTimeline = buildPlanVersionTimeline;
exports.planVersionAtDate = planVersionAtDate;
/** The entity-type names used in InputSnapshot.entityVersions, one per collection. */
const COLLECTION_ENTITY_TYPE = {
    planVersions: "PlanVersion",
    formulas: "Formula",
    participants: "Participant",
    employmentPeriods: "EmploymentPeriod",
    compensationHistories: "CompensationHistory",
    serviceHistories: "ServiceHistory",
    benefitObservations: "BenefitObservation",
    benefitCalculations: "BenefitCalculation",
    benefitComparisons: "BenefitComparison",
    diagnosticHypotheses: "DiagnosticHypothesis",
    sourceDocuments: "SourceDocument",
    actuarialDecisions: "ActuarialDecision",
    calculationRuns: "CalculationRun",
};
// ---------------------------------------------------------------------------
// EntityCommon
// ---------------------------------------------------------------------------
/** Build the common block for a new version-1 entity. */
function createEntityCommon(id, createdDate, createdBy) {
    return {
        id,
        version: 1,
        supersedesId: null,
        sourceRecordIds: [],
        createdDate,
        createdBy,
    };
}
/** Build the next version of an entity from its previous version.
 *  The new version keeps the SAME id (one entity, many versions — 01 §3.1:
 *  a correction creates "a new version of the entity"; RevisionRecord
 *  addresses one entityId with versionBefore/versionAfter) and carries
 *  version + 1 and supersedesId = previous id. Versions of one entity are
 *  distinguished by `version`, which is why InputSnapshot pins (id, version)
 *  pairs. The previous version object is returned untouched. */
function nextEntityVersion(previous, changes) {
    const { createdDate, createdBy, ...rest } = changes;
    return {
        ...previous,
        ...rest,
        version: previous.version + 1,
        supersedesId: previous.id,
        createdDate,
        createdBy,
    };
}
/** Create an empty CasePackage: one Case, one Plan, empty collections, and
 *  a single "case-created" event (sequence 1). The seed facts are stored
 *  as SourcedValues under the caller's provenance. */
function createEmptyCasePackage(seed) {
    const sourced = (value) => ({
        value,
        provenance: seed.provenance,
    });
    const plan = {
        ...createEntityCommon(seed.planId, seed.createdDate, seed.createdBy),
        caseId: seed.caseId,
        planId: seed.planNumber,
        normalRetirementAge: sourced(null),
        normalRetirementDefinition: sourced(""),
        earlyRetirementRule: sourced(null),
        normalFormSingle: sourced(""),
        normalFormMarried: sourced(""),
        compensationDefinition: sourced(""),
        serviceDefinitions: sourced(""),
        vestingSchedule: sourced(null),
        freezeDatePlanLevel: sourced(null),
        integrationMethod: sourced(null),
        employeeContributionRule: sourced(null),
        planVersionIds: [],
    };
    const caseEntity = {
        ...createEntityCommon(seed.caseId, seed.createdDate, seed.createdBy),
        caseNumber: sourced(seed.caseNumber),
        dopt: sourced(seed.dopt),
        bpd: sourced(null),
        planName: sourced(seed.planName),
        planNumber: sourced(seed.planNumber),
        caseActuary: sourced(null),
        auditor: sourced(null),
        employerStatus: sourced(null),
        successorPlan: sourced(null),
        trusteeshipDate: sourced(null),
        valuationAsOfDate: sourced(null),
        currencyConvention: "USD",
        toleranceRecord: seed.tolerance,
        completenessGrade: "insufficient",
        planId: seed.planId,
    };
    const createdEvent = {
        id: `${seed.caseId}-event-1`,
        sequence: 1,
        eventDate: seed.createdDate,
        actor: seed.createdBy,
        kind: "case-created",
        summary: `Case ${seed.caseNumber} created.`,
        affectedEntityIds: [seed.caseId, seed.planId],
        affectedParticipantKeys: [],
        revision: null,
        snapshotHashAfter: seed.initialSnapshotHash,
    };
    return {
        formatVersion: seed.formatVersion,
        case: caseEntity,
        plan,
        planVersions: [],
        formulas: [],
        participants: [],
        employmentPeriods: [],
        compensationHistories: [],
        serviceHistories: [],
        benefitObservations: [],
        benefitCalculations: [],
        benefitComparisons: [],
        diagnosticHypotheses: [],
        sourceDocuments: [],
        actuarialDecisions: [],
        calculationRuns: [],
        sourceRecords: [],
        events: [createdEvent],
        unmapped: [],
    };
}
// ---------------------------------------------------------------------------
// Append-only writes (Layer 1 and the event log)
// ---------------------------------------------------------------------------
/** Append a Layer 1 SourceRecord. The package is returned as a new object;
 *  the input package is untouched. Throws on a duplicate record id:
 *  a re-import creates new SourceRecords under a new importId, it never
 *  overwrites the old ones (§3.1 rule 1). */
function appendSourceRecord(pkg, record) {
    if (pkg.sourceRecords.some((r) => r.id === record.id)) {
        throw new Error(`appendSourceRecord: duplicate SourceRecord id ${record.id}`);
    }
    return { ...pkg, sourceRecords: [...pkg.sourceRecords, record] };
}
/** Append a CaseEvent. The event's sequence must be exactly one more than
 *  the last event's sequence (monotonic 1, 2, 3, …); anything else throws,
 *  so a gap or a reorder in the audit log is impossible. */
function appendCaseEvent(pkg, event) {
    const expected = pkg.events.length + 1;
    if (event.sequence !== expected) {
        throw new Error(`appendCaseEvent: expected sequence ${expected}, got ${event.sequence}`);
    }
    if (pkg.events.some((e) => e.id === event.id)) {
        throw new Error(`appendCaseEvent: duplicate CaseEvent id ${event.id}`);
    }
    return { ...pkg, events: [...pkg.events, event] };
}
/** Build a Layer 1 SourceRecord for one imported row. The caller supplies
 *  the hash and the import batch id; raw fields are stored exactly as
 *  imported (strings, no parsing). */
function makeSourceRecord(args) {
    return {
        id: args.id,
        documentId: args.documentId,
        importId: args.importId,
        location: args.location,
        rawFields: args.rawFields,
        sourceFileHash: args.sourceFileHash,
        importedDate: args.importedDate,
        status: args.status ?? "imported",
        quarantineReason: args.quarantineReason ?? null,
    };
}
/** Build a RevisionRecord from its inputs. Does not write it anywhere. */
function makeRevisionRecord(input) {
    if (input.versionAfter !== input.versionBefore + 1) {
        throw new Error(`makeRevisionRecord: versionAfter (${input.versionAfter}) must be versionBefore + 1 (${input.versionBefore + 1})`);
    }
    if (input.changes.length === 0) {
        throw new Error("makeRevisionRecord: a correction with no field changes is not recordable");
    }
    return {
        id: input.revisionId,
        entityType: input.entityType,
        entityId: input.entityId,
        versionBefore: input.versionBefore,
        versionAfter: input.versionAfter,
        changes: input.changes,
        reason: input.reason,
        authority: input.authority,
        correctedBy: input.correctedBy,
        correctedDate: input.correctedDate,
    };
}
/**
 * Apply a correction to a versioned entity collection.
 *
 * - `previous` must be the entity version currently in the package;
 *   `next` must be its successor (version + 1, supersedesId = previous id).
 * - The old version STAYS in the collection; the new version is appended.
 *   A prior CalculationRun pinned the old version, and its basis is
 *   therefore untouched (§4.2 rule 1, §4.3 rule 2).
 * - A "correction-applied" CaseEvent carrying the RevisionRecord is
 *   appended (sequence = events.length + 1).
 * - The input package is untouched; a new package is returned.
 */
function applyCorrection(pkg, collection, previous, next, revision, eventFields) {
    if (next.version !== previous.version + 1) {
        throw new Error(`applyCorrection: next version (${next.version}) must be previous version + 1 (${previous.version + 1})`);
    }
    if (next.supersedesId !== previous.id) {
        throw new Error(`applyCorrection: next supersedesId (${next.supersedesId}) must be the previous id (${previous.id})`);
    }
    if (revision.entityId !== previous.id || revision.versionBefore !== previous.version) {
        throw new Error("applyCorrection: revision does not describe this entity version");
    }
    const current = pkg[collection];
    if (!current.some((e) => e.id === previous.id && e.version === previous.version)) {
        throw new Error(`applyCorrection: previous version ${previous.version} of ${previous.id} is not in the package`);
    }
    if (current.some((e) => e.id === next.id && e.version === next.version)) {
        throw new Error(`applyCorrection: version ${next.version} of ${next.id} is already in the package`);
    }
    const event = {
        id: eventFields.eventId,
        sequence: pkg.events.length + 1,
        eventDate: eventFields.eventDate,
        actor: eventFields.actor,
        kind: "correction-applied",
        summary: eventFields.summary,
        affectedEntityIds: [previous.id],
        affectedParticipantKeys: eventFields.affectedParticipantKeys,
        revision,
        snapshotHashAfter: eventFields.snapshotHashAfter,
    };
    // Generic collection update: the K constraint at the call site keeps
    // this type-safe (the entity type matches the collection); the cast is
    // only because TypeScript cannot index a union of arrays by a generic key.
    const nextPkg = { ...pkg };
    nextPkg[collection] = [...current, next];
    const withEntity = nextPkg;
    return { ...withEntity, events: [...withEntity.events, event] };
}
/** The current (highest-version) record for one entity id, or null when
 *  the id is not in the collection. Superseded versions are retained in
 *  the package but are not current. */
function currentVersion(versions, id) {
    let best = null;
    for (const v of versions) {
        if (v.id !== id)
            continue;
        if (best === null || v.version > best.version)
            best = v;
    }
    return best;
}
// ---------------------------------------------------------------------------
// Input snapshots (reproducibility pins, 01 §4.3)
// ---------------------------------------------------------------------------
/** Build an InputSnapshot from explicit inputs. The snapshot hash is
 *  caller-supplied (hashing is a boundary concern, not core logic). */
function createInputSnapshot(args) {
    return { ...args };
}
const COLLECTIONS = [
    "planVersions",
    "formulas",
    "participants",
    "employmentPeriods",
    "compensationHistories",
    "serviceHistories",
    "benefitObservations",
    "benefitCalculations",
    "benefitComparisons",
    "diagnosticHypotheses",
    "sourceDocuments",
    "actuarialDecisions",
    "calculationRuns",
];
/** Pin an InputSnapshot for a CalculationRun from the package's CURRENT
 *  entity versions: for each entity id, the highest version in the
 *  package. Superseded versions are not pinned. Import ids are the
 *  distinct importIds of the package's source records, in first-seen order.
 *  The snapshot hash and the version strings are caller-supplied. */
function snapshotCurrentVersions(pkg, args) {
    const entityVersions = [];
    const planVersionIds = [];
    const formulaIds = [];
    for (const key of COLLECTIONS) {
        const entities = pkg[key];
        const seen = new Map();
        for (const e of entities) {
            const prev = seen.get(e.id);
            if (prev === undefined || e.version > prev)
                seen.set(e.id, e.version);
        }
        for (const [id, version] of seen) {
            entityVersions.push({ entityType: COLLECTION_ENTITY_TYPE[key], entityId: id, version });
        }
    }
    // PlanVersion and Formula pins use their business ids (versionId /
    // formulaId), not the row ids (§7.3 rule 2, §7.4 rule 1).
    const planVersionSeen = new Map();
    for (const pv of pkg.planVersions) {
        const prev = planVersionSeen.get(pv.versionId);
        if (prev === undefined || pv.version > prev)
            planVersionSeen.set(pv.versionId, pv.version);
    }
    for (const [planVersionId, version] of planVersionSeen) {
        planVersionIds.push({ planVersionId, version });
    }
    const formulaSeen = new Map();
    for (const f of pkg.formulas) {
        const prev = formulaSeen.get(f.formulaId);
        if (prev === undefined || f.version > prev)
            formulaSeen.set(f.formulaId, f.version);
    }
    for (const [formulaId, version] of formulaSeen) {
        formulaIds.push({ formulaId, version });
    }
    const importIds = [];
    for (const r of pkg.sourceRecords) {
        if (!importIds.includes(r.importId))
            importIds.push(r.importId);
    }
    return {
        snapshotHash: args.snapshotHash,
        importIds,
        entityVersions,
        planVersionIds,
        formulaIds,
        ruleVersion: args.ruleVersion,
        formulaTaxonomyVersion: args.formulaTaxonomyVersion,
        engineVersion: args.engineVersion,
        toleranceRecordVersion: pkg.case.toleranceRecord.version,
    };
}
// ---------------------------------------------------------------------------
// PlanVersionTimeline (01 §6.2) — partition by effectiveDate
// ---------------------------------------------------------------------------
/**
 * Build the gap-free provision timeline for one plan.
 *
 * - Versions are sorted by effectiveDate ascending. The sort key is the
 *   EFFECTIVE date; the adoption date is stored on each version and never
 *   selects the version (§6.2 rule 2, §1.3 rule 3).
 * - Two versions with the same effectiveDate are rejected: the timeline
 *   is a partition, and a duplicate effective date is not a partition.
 * - When `planAdoptionDate` is supplied, the first version's effectiveDate
 *   must equal it; otherwise the timeline starts after the plan existed,
 *   which is a gap, and the gap is refused here rather than papered over
 *   (§6.2 rule 1). Without an adoption date the timeline is built as
 *   given and the caller owns the gap question.
 * - The input array is copied; it is never sorted in place.
 */
function buildPlanVersionTimeline(planId, versions, planAdoptionDate) {
    if (versions.length === 0) {
        throw new Error("buildPlanVersionTimeline: a plan with no PlanVersion has no provisions");
    }
    const sorted = [...versions].sort((a, b) => {
        const ea = a.effectiveDate.value;
        const eb = b.effectiveDate.value;
        if (ea === null || eb === null) {
            throw new Error("buildPlanVersionTimeline: a PlanVersion with a null effectiveDate cannot be placed in a timeline");
        }
        return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (prev === undefined || curr === undefined)
            continue; // unreachable; strict-index guard
        if (prev.effectiveDate.value === curr.effectiveDate.value) {
            throw new Error(`buildPlanVersionTimeline: duplicate effectiveDate ${curr.effectiveDate.value} (${prev.versionId} / ${curr.versionId})`);
        }
    }
    if (planAdoptionDate !== undefined) {
        const first = sorted[0];
        if (first === undefined)
            throw new Error("buildPlanVersionTimeline: empty timeline");
        if (first.effectiveDate.value !== planAdoptionDate) {
            throw new Error(`buildPlanVersionTimeline: timeline starts ${first.effectiveDate.value} but the plan was adopted ${planAdoptionDate} — gap refused, not papered over`);
        }
    }
    return { planId, versions: sorted };
}
/**
 * The PlanVersion in force at a date: the last version whose effectiveDate
 * is on or before the date. Returns null when the date precedes every
 * version (a gap — the caller must name it as missing evidence, never
 * approximate with the nearest version, §6.5).
 *
 * Selection uses effectiveDate ONLY. The adoption date is never read here.
 */
function planVersionAtDate(timeline, date) {
    let inForce = null;
    for (const v of timeline.versions) {
        const effective = v.effectiveDate.value;
        if (effective === null)
            continue;
        if (effective <= date)
            inForce = v;
        else
            break;
    }
    return inForce;
}
