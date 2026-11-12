"use strict";
/**
 * Stage 4.5 contribution protocol — core record types, monoidal
 * WorkProductLog, R1 topic keys, and the Image Viewer citation builder.
 *
 * Sources:
 * - MONADIC_ARCHITECTURE_SPEC.md §7.2 (record types), §7.3 (two-level
 *   provenance), §7.4 (citation rendering), §9.3 (monoidal writer merge).
 * - MONADIC_ASSESSMENT.md §5.1 (file-level changes) and §6 corrections
 *   1–2 (topic keys `allocation_4022c` and `relevant_dates`, both proposed).
 *
 * Scope of this module (Worker A): the core protocol only. The publication
 * functions (`publishFindings`, `assembleContribution`,
 * `buildAmbDataIssuesFragment`) are built on top of these exports by a
 * later worker. No publication function lives here, and no test lives here.
 *
 * Rules that govern this file:
 * - An Image Viewer document number, a finding, or a citation must come
 *   from a verified source. Nothing here invents one: an unknown number
 *   renders as "Image Viewer document number pending" and is recorded as
 *   a blocking open issue (see `appendMissingImageViewerIssue`).
 * - The Writer carries provenance; it does not decide factual correctness,
 *   materiality, or location (spec §9.3). `mergeLogs` never silently
 *   discards a conflicting value: conflicts are escalated to an explicit
 *   review state plus a blocking open issue.
 * - Synthetic data only in any example. No live case data.
 * - Pure functions only. No clock, no storage, no network, no fetch.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRIBUTION_JSON_SCHEMAS = exports.WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA = exports.NARRATIVE_FRAGMENT_JSON_SCHEMA = exports.FINDING_JSON_SCHEMA = exports.EVIDENCE_REF_JSON_SCHEMA = exports.IMAGE_VIEWER_NUMBER_PENDING = exports.emptyLog = exports.CONTRIBUTION_PROTOCOL_VERSION = void 0;
exports.createEmptyLog = createEmptyLog;
exports.isEmptyLog = isEmptyLog;
exports.mergeLogs = mergeLogs;
exports.citationPageNumber = citationPageNumber;
exports.renderCitation = renderCitation;
exports.missingImageViewerIssue = missingImageViewerIssue;
exports.appendMissingImageViewerIssue = appendMissingImageViewerIssue;
exports.citeEvidence = citeEvidence;
exports.dedupeCitations = dedupeCitations;
exports.renderCitations = renderCitations;
/** Version of this contribution protocol. Additive changes bump minor;
 *  breaking changes bump major, always with a change note (Phase 0
 *  versioning rule). */
exports.CONTRIBUTION_PROTOCOL_VERSION = "0.1.0";
/**
 * The empty log: the identity element of the merge (spec §9.3).
 * `mergeLogs(emptyLog, x)` is `x` and `mergeLogs(x, emptyLog)` is `x`.
 * Never mutate this object; build logs with `mergeLogs` and the
 * publication functions, or start from a fresh `createEmptyLog()`.
 */
exports.emptyLog = {
    traceEvents: [],
    findings: [],
    fragments: [],
    evidenceRefs: [],
    warnings: [],
    decisions: [],
    openIssues: [],
};
/** A fresh, mutable empty log. Prefer this over copying `emptyLog` when
 *  a caller needs to accumulate entries before merging. */
function createEmptyLog() {
    return {
        traceEvents: [],
        findings: [],
        fragments: [],
        evidenceRefs: [],
        warnings: [],
        decisions: [],
        openIssues: [],
    };
}
/** True when a log carries no entries at all. */
function isEmptyLog(log) {
    return (log.traceEvents.length === 0 &&
        log.findings.length === 0 &&
        log.fragments.length === 0 &&
        log.evidenceRefs.length === 0 &&
        log.warnings.length === 0 &&
        log.decisions.length === 0 &&
        log.openIssues.length === 0);
}
// ---------------------------------------------------------------------------
// mergeLogs — associative append (spec §9.3)
// ---------------------------------------------------------------------------
/**
 * Deterministic JSON encoding with sorted object keys, so two records
 * with the same content compare equal regardless of key insertion order.
 * Bigint values (which plain JSON.stringify rejects) are encoded as
 * `bigint:<decimal>`; `undefined` as `undefined`.
 */
function stableJson(value) {
    if (value === null)
        return "null";
    if (typeof value === "bigint")
        return `bigint:${value.toString()}`;
    if (typeof value === "undefined")
        return "undefined";
    if (typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    const record = value;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(",")}}`;
}
/** One conflict issue for two entries that share a stable id but carry
 *  different content. The issue id is deterministic in the stable id, so
 *  repeated merges never duplicate the issue. */
function conflictIssue(collection, stableId, detail, related) {
    return {
        issueId: `conflict:${collection}:${stableId}`,
        kind: "conflict",
        severity: "blocking",
        status: "open",
        message: `Conflicting ${collection} entries share stable id ${stableId} with different content: ${detail}. ` +
            `The first entry was kept and the conflicting entry was escalated to review; neither was silently discarded.`,
        relatedFindingIds: related.findingIds ?? [],
        relatedEvidenceIds: related.evidenceIds ?? [],
        relatedFragmentIds: related.fragmentIds ?? [],
    };
}
/**
 * Merge two arrays by stable key, first occurrence wins, in first-seen
 * order (deterministic for given inputs). An exact duplicate (same key,
 * same content) is dropped silently — it is the same entry twice, not a
 * conflict. Same key with different content is a conflict: the kept entry
 * is escalated through `onConflict` and a blocking conflict issue is
 * raised. Neither input array is mutated.
 */
function mergeDeduped(a, b, keyOf, onConflict) {
    const items = [];
    const indexByKey = new Map();
    const issues = [];
    const append = (item) => {
        const key = keyOf(item);
        const existingIndex = indexByKey.get(key);
        if (existingIndex === undefined) {
            indexByKey.set(key, items.length);
            items.push(item);
            return;
        }
        const kept = items[existingIndex];
        if (kept === undefined)
            return;
        if (stableJson(kept) === stableJson(item))
            return;
        if (onConflict === undefined)
            return;
        const outcome = onConflict(kept, item);
        items[existingIndex] = outcome.kept;
        issues.push(outcome.issue);
    };
    for (const item of a)
        append(item);
    for (const item of b)
        append(item);
    return { items, issues };
}
/**
 * Associative append of two WorkProductLogs (spec §9.3):
 * `mergeLogs(mergeLogs(a, b), c)` equals `mergeLogs(a, mergeLogs(b, c))`,
 * and `emptyLog` is the identity. Ordering is deterministic: first-seen
 * order within each collection. Entries are deduplicated by stable ID +
 * version (findings by `findingId` + `originatingVersion`; fragments,
 * evidence, warnings, decisions, and issues by their stable id; trace
 * events by full content).
 *
 * Conflicting values with the same semantic key are NEVER silently
 * discarded: the first entry is kept, escalated to an explicit review
 * state (a conflicting finding becomes `disputed`; a conflicting fragment
 * returns to `candidate`), and a blocking `conflict` open issue is added
 * naming the stable id. A finding superseded by a newer version is NOT a
 * conflict — different versions of one finding are both kept, and the R1
 * module resolves supersession (gate G5); this merge does not re-decide it.
 *
 * Neither input log is mutated.
 */
function mergeLogs(a, b) {
    const traceEvents = mergeDeduped(a.traceEvents, b.traceEvents, (step) => stableJson(step));
    const findings = mergeDeduped(a.findings, b.findings, (f) => `${f.findingId}\u0000${f.originatingVersion}`, (kept) => ({
        kept: { ...kept, reviewState: "disputed" },
        issue: conflictIssue("finding", `${kept.findingId}@${kept.originatingVersion}`, `finding ${kept.findingId} version ${kept.originatingVersion} was published with different content`, { findingIds: [kept.findingId] }),
    }));
    const fragments = mergeDeduped(a.fragments, b.fragments, (f) => f.fragmentId, (kept) => ({
        kept: { ...kept, inclusionState: "candidate" },
        issue: conflictIssue("fragment", kept.fragmentId, `fragment ${kept.fragmentId} was published with different content`, { fragmentIds: [kept.fragmentId] }),
    }));
    const evidenceRefs = mergeDeduped(a.evidenceRefs, b.evidenceRefs, (e) => e.evidenceId, (kept) => ({
        kept,
        issue: conflictIssue("evidence", kept.evidenceId, `evidence ${kept.evidenceId} was published with different content`, { evidenceIds: [kept.evidenceId] }),
    }));
    const warnings = mergeDeduped(a.warnings, b.warnings, (w) => w.warningId, (kept) => ({
        kept,
        issue: conflictIssue("warning", kept.warningId, `warning ${kept.warningId} was published with different content`, { findingIds: kept.relatedFindingIds, evidenceIds: kept.relatedEvidenceIds }),
    }));
    const decisions = mergeDeduped(a.decisions, b.decisions, (d) => d.decisionId, (kept) => ({
        kept,
        issue: conflictIssue("decision", kept.decisionId, `decision ${kept.decisionId} was published with different content`, { findingIds: kept.basisFindingIds }),
    }));
    const openIssues = mergeDeduped(a.openIssues, b.openIssues, (i) => i.issueId, (kept) => ({
        kept,
        issue: conflictIssue("open-issue", kept.issueId, `open issue ${kept.issueId} was published with different content`, {
            findingIds: kept.relatedFindingIds,
            evidenceIds: kept.relatedEvidenceIds,
            fragmentIds: kept.relatedFragmentIds,
        }),
    }));
    // Conflict issues raised by this merge go after the pre-existing open
    // issues, deduplicated by issue id (a conflict already recorded in
    // either input is kept as recorded, not duplicated).
    const allIssues = [...openIssues.items];
    const seenIssueIds = new Set(allIssues.map((i) => i.issueId));
    for (const issue of [
        ...findings.issues,
        ...fragments.issues,
        ...evidenceRefs.issues,
        ...warnings.issues,
        ...decisions.issues,
        ...openIssues.issues,
    ]) {
        if (!seenIssueIds.has(issue.issueId)) {
            seenIssueIds.add(issue.issueId);
            allIssues.push(issue);
        }
    }
    return {
        traceEvents: traceEvents.items,
        findings: findings.items,
        fragments: fragments.items,
        evidenceRefs: evidenceRefs.items,
        warnings: warnings.items,
        decisions: decisions.items,
        openIssues: allIssues,
    };
}
// ---------------------------------------------------------------------------
// Citation builder (spec §7.3, §7.4)
// ---------------------------------------------------------------------------
/** Rendered when an Image Viewer document number is not known. The source
 *  and its exact location stay in the internal record; this string is what
 *  the R1 draft shows. Never a fabricated number. */
exports.IMAGE_VIEWER_NUMBER_PENDING = "Image Viewer document number pending";
/**
 * Page number a citation can carry, from the evidence location. Only
 * paginated locations carry a page: `pdf-page` always, `document-section`
 * when its page is known. Spreadsheet cells, CSV rows, JSON paths, and
 * user-entered locations have no page.
 */
function citationPageNumber(ref) {
    const location = ref.location;
    if (location.kind === "pdf-page")
        return location.page;
    if (location.kind === "document-section")
        return location.page;
    return null;
}
/**
 * Render one citation in the confirmed format (assessment §4.4):
 * "Image Viewer Document #123", or "Image Viewer Document #123, page 5"
 * when a page number is known. The document number is stored as TEXT and
 * rendered exactly as recorded — never reformatted, never inferred.
 *
 * When the document number is null or empty, returns
 * `IMAGE_VIEWER_NUMBER_PENDING` ("Image Viewer document number pending").
 * That rendering alone is not enough: for a material citation the caller
 * must also record a blocking open issue — see
 * `appendMissingImageViewerIssue` / `citeEvidence`.
 */
function renderCitation(ref) {
    const number = ref.imageViewerDocumentNumber;
    if (number === null || number === "")
        return exports.IMAGE_VIEWER_NUMBER_PENDING;
    const page = citationPageNumber(ref);
    if (page === null)
        return `Image Viewer Document #${number}`;
    return `Image Viewer Document #${number}, page ${page}`;
}
/**
 * The distinct blocking open issue for one material unsupported citation
 * (spec §7.4): one issue per citation, keyed by evidence id so repeated
 * handling never duplicates it. The issue is blocking and stays open
 * until the number is verified from a source or the citation is withdrawn.
 */
function missingImageViewerIssue(ref) {
    return {
        issueId: `missing-image-viewer-number:${ref.evidenceId}`,
        kind: "missing-image-viewer-number",
        severity: "blocking",
        status: "open",
        message: `Image Viewer document number pending for evidence ${ref.evidenceId} (${ref.title}). ` +
            `The citation is required for final review; enter the number only from a verified source — never invent one.`,
        relatedFindingIds: [],
        relatedEvidenceIds: [ref.evidenceId],
        relatedFragmentIds: [],
    };
}
/**
 * Append the blocking open issue for a material unsupported citation to a
 * log, returning a new log (the input is not mutated). No-op when the
 * reference carries a document number, when the citation is not material
 * (`opts.material === false`), or when the issue is already recorded.
 * Distinct citations get distinct issues: the issue id carries the
 * evidence id.
 */
function appendMissingImageViewerIssue(log, ref, opts) {
    const number = ref.imageViewerDocumentNumber;
    if (number !== null && number !== "")
        return log;
    if (opts?.material === false)
        return log;
    const issue = missingImageViewerIssue(ref);
    if (log.openIssues.some((i) => i.issueId === issue.issueId))
        return log;
    return { ...log, openIssues: [...log.openIssues, issue] };
}
/**
 * Render one citation and, when its document number is unknown and the
 * citation is material, record the blocking open issue in the log — the
 * two halves of spec §7.4 in one call. Returns the rendered citation and
 * the (possibly extended) log. The input log is not mutated.
 */
function citeEvidence(log, ref, opts) {
    return {
        citation: renderCitation(ref),
        log: appendMissingImageViewerIssue(log, ref, opts),
    };
}
/**
 * Deduplicate identical references while preserving distinct page/cell
 * citations for the same document (spec §7.4). Two references are
 * identical when they cite the same source document, the same Image
 * Viewer number, and the same precise location; the first is kept.
 * References to different pages or cells of one document have different
 * locations and are all preserved. The `evidenceId` is deliberately NOT
 * part of the key: two internal ids for the same cited passage are one
 * citation, not two.
 */
function dedupeCitations(refs) {
    const seen = new Set();
    const out = [];
    for (const ref of refs) {
        const key = stableJson([
            ref.documentId,
            ref.imageViewerDocumentNumber,
            ref.location,
        ]);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(ref);
        }
    }
    return out;
}
/**
 * Render a list of citations, deduplicated as in `dedupeCitations`, in
 * first-seen order. This is the list an `R1Placement.renderedCitations`
 * carries.
 */
function renderCitations(refs) {
    return dedupeCitations(refs).map((ref) => renderCitation(ref));
}
const SCHEMA_DRAFT = "https://json-schema.org/draft/2020-12/schema";
/** JSON Schema for `EvidenceRef`. */
exports.EVIDENCE_REF_JSON_SCHEMA = {
    $schema: SCHEMA_DRAFT,
    $id: "https://pbgc-caseworkbench/contribution/evidence-ref.json",
    type: "object",
    title: "EvidenceRef",
    required: [
        "evidenceId",
        "documentId",
        "location",
        "acquisition",
        "sourceKind",
        "title",
        "imageViewerDocumentNumber",
        "accessStatus",
    ],
    properties: {
        evidenceId: { type: "string" },
        documentId: { type: "string" },
        location: { type: "object" },
        acquisition: { type: "string", enum: ["imported", "derived", "user-entered", "recovered"] },
        derivation: { type: ["string", "null"] },
        sourceFileHash: { type: ["string", "null"] },
        sourceKind: {
            type: "string",
            enum: ["plan document", "census", "valuation report", "PBGC policy", "work product", "other"],
        },
        title: { type: "string" },
        versionOrDate: { type: ["string", "null"] },
        imageViewerDocumentNumber: { type: ["string", "null"] },
        originalExcerpt: { type: ["string", "null"] },
        accessStatus: { type: "string", enum: ["verified", "available", "missing", "pending"] },
        workProductRef: { type: ["object", "null"] },
    },
};
/** JSON Schema for `Finding`. */
exports.FINDING_JSON_SCHEMA = {
    $schema: SCHEMA_DRAFT,
    $id: "https://pbgc-caseworkbench/contribution/finding.json",
    type: "object",
    title: "Finding",
    required: [
        "findingId",
        "caseId",
        "originatingWorkProduct",
        "originatingVersion",
        "claimType",
        "subjectScope",
        "findingStatement",
        "rationale",
        "evidenceRefs",
        "reviewState",
        "materiality",
        "intendedR1Topics",
    ],
    properties: {
        findingId: { type: "string" },
        caseId: { type: "string" },
        originatingWorkProduct: {
            type: "string",
            enum: ["R5", "PlanSummary", "PF", "DEL", "436", "EstimatedAdmin", "EstimatedAdjustment", "AMB", "V1", "BSRS", "other"],
        },
        originatingVersion: { type: "string" },
        claimType: {
            type: "string",
            enum: ["fact", "derived_result", "assumption", "interpretation", "decision", "exception", "risk"],
        },
        subjectScope: { type: "string", enum: ["plan", "participant", "cohort", "valuation"] },
        subjectIds: { type: "array", items: { type: "string" } },
        effectivePeriod: { type: "object" },
        valueAndUnits: { type: "object" },
        findingStatement: { type: "string" },
        rationale: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        missingEvidenceException: { type: ["string", "null"] },
        derivedFromFindingIds: { type: "array", items: { type: "string" } },
        reviewState: { type: "string", enum: ["draft", "reviewed", "approved", "superseded", "disputed"] },
        materiality: { type: "object" },
        intendedR1Topics: { type: "array", items: { type: "string" } },
        supersedes: { type: ["string", "null"] },
    },
};
/** JSON Schema for `NarrativeFragment`. */
exports.NARRATIVE_FRAGMENT_JSON_SCHEMA = {
    $schema: SCHEMA_DRAFT,
    $id: "https://pbgc-caseworkbench/contribution/narrative-fragment.json",
    type: "object",
    title: "NarrativeFragment",
    required: [
        "fragmentId",
        "findingIds",
        "targetTopicKeys",
        "form",
        "content",
        "inclusionState",
        "approvalState",
        "displayOrder",
    ],
    properties: {
        fragmentId: { type: "string" },
        findingIds: { type: "array", items: { type: "string" } },
        targetTopicKeys: { type: "array", items: { type: "string" } },
        form: {
            type: "string",
            enum: ["summary", "detail", "table", "footnote", "appendix", "citation", "open_issue"],
        },
        content: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        inclusionState: { type: "string", enum: ["candidate", "selected", "rejected", "superseded"] },
        approvalState: { type: "string", enum: ["proposed", "reviewed", "approved"] },
        displayOrder: { type: "number" },
        conflictGroup: { type: ["string", "null"] },
    },
};
/** JSON Schema for `WorkProductContribution`. */
exports.WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA = {
    $schema: SCHEMA_DRAFT,
    $id: "https://pbgc-caseworkbench/contribution/work-product-contribution.json",
    type: "object",
    title: "WorkProductContribution",
    required: [
        "productId",
        "productVersion",
        "caseId",
        "producedAt",
        "publishedBy",
        "sourceSnapshotId",
        "status",
        "findings",
        "fragments",
        "citations",
        "warnings",
        "requiredFollowups",
        "downstreamDependencies",
    ],
    properties: {
        productId: { type: "string" },
        productVersion: { type: "string" },
        caseId: { type: "string" },
        producedAt: { type: "string" },
        publishedBy: { type: "string" },
        sourceSnapshotId: { type: "string" },
        calculationRunId: { type: ["string", "null"] },
        status: { type: "string", enum: ["draft", "reviewed", "approved", "superseded"] },
        findings: { type: "array", items: { $ref: "finding.json" } },
        fragments: { type: "array", items: { $ref: "narrative-fragment.json" } },
        citations: { type: "array", items: { $ref: "evidence-ref.json" } },
        warnings: { type: "array", items: { type: "object" } },
        requiredFollowups: { type: "array", items: { type: "string" } },
        downstreamDependencies: { type: "array", items: { type: "string" } },
    },
};
/** All contribution JSON Schemas, keyed by record type. */
exports.CONTRIBUTION_JSON_SCHEMAS = {
    EvidenceRef: exports.EVIDENCE_REF_JSON_SCHEMA,
    Finding: exports.FINDING_JSON_SCHEMA,
    NarrativeFragment: exports.NARRATIVE_FRAGMENT_JSON_SCHEMA,
    WorkProductContribution: exports.WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA,
};
// ---------------------------------------------------------------------------
// Publication functions (Worker C, Stage 4.5) — src/publication.ts
// ---------------------------------------------------------------------------
/**
 * Re-exported here so the test worker has one import surface: everything
 * in `src/index.ts` comes through this module. `publication.ts` imports
 * only types and pure helpers from this file and uses them inside
 * function bodies, so this trailing re-export is safe: every export
 * above is already assigned by the time it runs.
 */
__exportStar(require("./publication"), exports);
