"use strict";
/**
 * Stage 6 — reports (Worker C).
 *
 * Pure functions only, DOM-free, Node-testable. Each takes engine
 * outputs (or loose summaries mapped from them by the caller) and
 * returns a printable HTML string.
 *
 * Governing spec: MASTER_PROMPT §15 (plan-level report, participant-
 * level report, export formats) and §19 (warnings before exporting
 * sensitive information). Monadic spec §8.3: the AMB acceptance
 * contribution publishes a concise summary in R1 Section 3
 * 'Data Issues' with references to the complete AMB memo, tested
 * workbook, and appendix; the full AMB analysis is never pasted into
 * the R1 main body by default.
 *
 * Rules:
 * - Money is integer minor units (cents); a blank is null, never 0.
 * - No invented labels, thresholds, or findings: every value shown
 *   comes from the input passed in. A value not supplied is stated
 *   as "Not supplied", never filled in.
 * - Every number states its denominator, units, and population where
 *   the input gives them.
 * - Every report states its input snapshot hash, rule/formula version,
 *   tolerance version, and engine version (reproducibility).
 * - ASD STE 100 minimal language. No fetch, no network, no CDN.
 * - Synthetic data only in tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_ISSUES_ITEMS = void 0;
exports.formatMoneyMinor = formatMoneyMinor;
exports.renderPlanReport = renderPlanReport;
exports.renderParticipantReport = renderParticipantReport;
exports.renderAmbMemo = renderAmbMemo;
const contribution_js_1 = require("../contribution.js");
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** HTML-escape text. Never render raw input into HTML. */
function esc(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
/** Text of a value, or "Not supplied" when absent. */
function text(value) {
    if (value === null || value === undefined || value === "")
        return "Not supplied";
    return String(value);
}
/** Money in integer minor units (cents) as dollars, or "blank (missing)". */
function formatMoneyMinor(minor) {
    if (minor === null || minor === undefined)
        return "blank (missing)";
    const sign = minor < 0 ? "-" : "";
    const abs = Math.abs(Math.trunc(minor));
    const dollars = Math.trunc(abs / 100);
    const cents = abs % 100;
    const dollarsText = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}$${dollarsText}.${cents < 10 ? "0" : ""}${cents}`;
}
/** "n of N (units)" with denominator; "n (population not stated)" when none. */
function countWithDenominator(count, population, units) {
    const u = units === null || units === undefined || units === "" ? "" : ` ${units}`;
    if (population === null || population === undefined)
        return `${count}${u} (population not stated)`;
    return `${count} of ${population}${u}`;
}
/** One report section: heading + body HTML. */
function section(title, body) {
    return `<section><h2>${esc(title)}</h2>${body}</section>`;
}
/** Paragraph, or "Not supplied." when the text is empty. */
function para(value) {
    const v = value === null || value === undefined || value.trim() === "" ? "Not supplied." : value;
    return `<p>${esc(v)}</p>`;
}
/** Key/value table. */
function kvTable(rows) {
    const body = rows
        .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`)
        .join("");
    return `<table><tbody>${body}</tbody></table>`;
}
/** Simple list, or "None recorded." when empty. */
function itemList(items, emptyText = "None recorded.") {
    if (items === undefined || items === null || items.length === 0)
        return `<p>${esc(emptyText)}</p>`;
    return `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}
/** Reproducibility footer: snapshot hash, rule/formula version,
 *  tolerance version, engine version. */
function reproFooter(repro) {
    const r = repro ?? {};
    return `<footer><h2>Reproducibility</h2>${kvTable([
        ["Input snapshot hash", text(r.inputSnapshotHash)],
        ["Rule version", text(r.ruleVersion)],
        ["Formula version", text(r.formulaVersion)],
        ["Tolerance version", r.toleranceVersion === null || r.toleranceVersion === undefined ? "Not supplied" : String(r.toleranceVersion)],
        ["Engine version", text(r.engineVersion)],
        ["Contribution protocol version", contribution_js_1.CONTRIBUTION_PROTOCOL_VERSION],
    ])}<p>Rebuild from the same input snapshot and rule versions gives the same report.</p></footer>`;
}
const PRINT_CSS = [
    "body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;margin:24px;line-height:1.4;}",
    "h1{font-size:20px;}h2{font-size:15px;margin-top:20px;border-bottom:1px solid #000;}",
    "table{border-collapse:collapse;width:100%;margin:8px 0;}th,td{border:1px solid #666;padding:4px 6px;text-align:left;vertical-align:top;font-size:13px;}",
    "th{background:#eee;}footer{margin-top:24px;border-top:1px solid #000;}",
    "@media print{body{margin:0;}section{page-break-inside:avoid;}}",
].join("\n");
/** Full printable HTML document shell. */
function reportShell(title, subtitle, body) {
    return [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="utf-8">',
        `<title>${esc(title)}</title>`,
        `<style>${PRINT_CSS}</style>`,
        `</head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${body}</body></html>`,
    ].join("\n");
}
// ---------------------------------------------------------------------------
// Plan-level report (MASTER_PROMPT §15)
// ---------------------------------------------------------------------------
/**
 * Plan-level report. Every section heading is the §15 heading, in order.
 * Every number states its denominator, units, and population where the
 * input gives them. Values not supplied are stated as "Not supplied",
 * never filled in.
 */
function renderPlanReport(input) {
    const pkg = input.casePackage ?? null;
    const val = input.validationSummary ?? null;
    const rec = input.reconciliationSummary ?? null;
    const stats = input.statisticsSummary ?? null;
    const population = pkg?.participantCount ?? rec?.participantsCompared ?? null;
    const caseLabel = [
        pkg?.planName ?? null,
        pkg?.caseNumber !== null && pkg?.caseNumber !== undefined ? `Case ${pkg.caseNumber}` : null,
        pkg?.dopt !== null && pkg?.dopt !== undefined ? `DOPT ${pkg.dopt}` : null,
    ]
        .filter((part) => part !== null)
        .join(" | ");
    const execLines = [];
    if (rec !== null) {
        execLines.push(`Compared: ${countWithDenominator(rec.participantsCompared ?? 0, population, "participants")}.`, `Matched: ${countWithDenominator(rec.matched ?? 0, rec.participantsCompared ?? null, "participants")}.`, `Within tolerance: ${countWithDenominator(rec.withinTolerance ?? 0, rec.participantsCompared ?? null, "participants")}.`, `Material differences: ${countWithDenominator(rec.materialDifferences ?? 0, rec.participantsCompared ?? null, "participants")}.`, `Not comparable: ${countWithDenominator(rec.notComparable ?? 0, rec.participantsCompared ?? null, "participants")}.`, `Indeterminate: ${countWithDenominator(rec.indeterminate ?? 0, rec.participantsCompared ?? null, "participants")}.`);
    }
    if (val !== null && val.blockingCount !== null && val.blockingCount !== undefined) {
        execLines.push(`Validation findings that block calculation: ${val.blockingCount} (population: ${population === null ? "not stated" : `${population} participants`}).`);
    }
    const validationRows = [];
    if (val?.totalFindings !== null && val?.totalFindings !== undefined) {
        validationRows.push(["Total findings", `${val.totalFindings} (population: ${population === null ? "not stated" : `${population} participants`})`]);
    }
    if (val?.bySeverity) {
        for (const [severity, count] of Object.entries(val.bySeverity)) {
            validationRows.push([`Severity: ${severity}`, countWithDenominator(count, population, "findings")]);
        }
    }
    if (val?.blockingCount !== null && val?.blockingCount !== undefined) {
        validationRows.push(["Blocking calculation", `${val.blockingCount} findings`]);
    }
    const validationFindingList = val?.findings === null || val?.findings === undefined || val.findings.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${val.findings
            .map((f) => `<li>${esc(text(f.ruleId))} — ${esc(text(f.severity))}: ${esc(text(f.discrepancy))} (blocks calculation: ${esc(text(f.blocksCalculation))})</li>`)
            .join("")}</ul>`;
    const reconRows = [];
    if (rec !== null) {
        const compared = rec.participantsCompared ?? null;
        reconRows.push(["Participants compared", countWithDenominator(rec.participantsCompared ?? 0, population, "participants")], ["Matched", countWithDenominator(rec.matched ?? 0, compared, "participants")], ["Within tolerance", countWithDenominator(rec.withinTolerance ?? 0, compared, "participants")], ["Material differences", countWithDenominator(rec.materialDifferences ?? 0, compared, "participants")], ["Not comparable", countWithDenominator(rec.notComparable ?? 0, compared, "participants")], ["Indeterminate", countWithDenominator(rec.indeterminate ?? 0, compared, "participants")], ["Blank PA_AMB", countWithDenominator(rec.blankPaAmb ?? 0, compared, "participants")], ["Mean absolute difference", rec.meanAbsDeltaMinor === null || rec.meanAbsDeltaMinor === undefined ? "Not supplied" : `${formatMoneyMinor(rec.meanAbsDeltaMinor)} per month (population: ${compared === null ? "not stated" : `${compared} participants compared`})`], ["Tolerance applied", text(rec.tolerance)]);
    }
    const dispositionList = input.dispositions === null || input.dispositions === undefined || input.dispositions.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.dispositions
            .map((d) => `<li>${esc(d.disposition)}: ${esc(countWithDenominator(d.count, d.population, "participants"))}</li>`)
            .join("")}</ul>`;
    const groupList = rec?.byGroup === null || rec?.byGroup === undefined || rec.byGroup.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${rec.byGroup
            .map((g) => `<li>${esc(g.group)}: ${esc(countWithDenominator(g.count, g.population, g.units ?? "participants"))}</li>`)
            .join("")}</ul>`;
    const outlierList = stats?.outliers === null || stats?.outliers === undefined || stats.outliers.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${stats.outliers
            .map((o) => `<li>${esc(o.label)}: ${esc(countWithDenominator(o.count, o.population, o.units ?? "participants"))}</li>`)
            .join("")}</ul>`;
    const findingList = input.findings === null || input.findings === undefined || input.findings.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.findings
            .map((f) => `<li>${esc(text(f.findingId))} (${esc(text(f.claimType))}, ${esc(text(f.reviewState))}${f.material === true ? ", material" : ""}): ${esc(text(f.findingStatement))}</li>`)
            .join("")}</ul>`;
    const missingList = input.missingData === null || input.missingData === undefined || input.missingData.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.missingData
            .map((m) => `<li>${esc(text(m.field))} (class ${esc(text(m.missingClass))}): ${esc(text(m.consequence))} Resolves by: ${esc(text(m.resolvesBy))}</li>`)
            .join("")}</ul>`;
    const body = [
        section("Executive summary", execLines.length === 0 ? "<p>Not supplied.</p>" : itemList(execLines)),
        section("Population and data completeness", kvTable([
            ["Case", caseLabel === "" ? "Not supplied" : caseLabel],
            ["Plan number", text(pkg?.planNumber)],
            ["Participants", population === null ? "Not supplied" : `${population} participants`],
            ["Completeness grade", text(pkg?.completenessGrade)],
        ])),
        section("Formula and provision complexity", para(null)),
        section("Historical administrative data quality", para(null)),
        section("Validation findings", (validationRows.length === 0 ? "<p>Not supplied.</p>" : kvTable(validationRows)) +
            validationFindingList +
            itemList(val?.notes ?? null)),
        section("Reconciliation statistics", reconRows.length === 0 ? "<p>Not supplied.</p>" : kvTable(reconRows)),
        section("Material discrepancy counts", `<p>Material differences: ${rec === null || rec.materialDifferences === null || rec.materialDifferences === undefined ? "Not supplied" : countWithDenominator(rec.materialDifferences, rec.participantsCompared ?? null, "participants")}.</p>` +
            `<p>Tolerance applied: ${esc(text(rec?.tolerance))}. No built-in acceptance tolerance is shipped; the tolerance is case-set by the actuary.</p>`),
        section("Analysis by employment group and status", groupList),
        section("Outlier analysis", outlierList + itemList(stats?.outlierNotes ?? null)),
        section("Statistical model diagnostics", itemList(stats?.modelDiagnostics ?? null)),
        section("Uncertainty and missing-data analysis", missingList + itemList(stats?.notes ?? null)),
        section("Recommended actuarial actions", itemList(input.actions ?? null)),
        section("Outstanding questions and data requests", itemList(input.openQuestions ?? null)),
        `<section><h2>Dispositions</h2>${dispositionList}</section>`,
        `<section><h2>Findings</h2>${findingList}</section>`,
        reproFooter(input.reproducibility),
    ].join("\n");
    return reportShell("PA_AMB Analysis — Plan-Level Report", caseLabel === "" ? "Plan-level report" : caseLabel, body);
}
// ---------------------------------------------------------------------------
// Participant-level report (MASTER_PROMPT §15)
// ---------------------------------------------------------------------------
/**
 * Participant-level report. Every section heading is the §15 heading,
 * in order. Blanks are null, never 0. Values not supplied are stated
 * as "Not supplied", never filled in.
 */
function renderParticipantReport(input) {
    const p = input.participant ?? null;
    const title = `PA_AMB Analysis — Participant-Level Report`;
    const subtitle = [
        p?.participantKey !== null && p?.participantKey !== undefined ? `Participant ${p.participantKey}` : null,
        p?.lastName !== null && p?.lastName !== undefined ? p.lastName : null,
    ]
        .filter((part) => part !== null)
        .join(" | ");
    const inputRows = input.inputs === null || input.inputs === undefined || input.inputs.length === 0
        ? "<p>None recorded.</p>"
        : kvTable(input.inputs.map((row) => [
            text(row.field),
            `${text(row.value)} (source: ${text(row.source)})`,
        ]));
    const provisionList = input.provisions === null || input.provisions === undefined || input.provisions.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.provisions
            .map((prov) => `<li>${esc(text(prov.section))} (effective ${esc(text(prov.effectiveDate))}, formula ${esc(text(prov.formulaType))}): ${esc(text(prov.text))}</li>`)
            .join("")}</ul>`;
    const rb = input.recordedBenefit ?? null;
    const traceList = input.calculationTrace === null || input.calculationTrace === undefined || input.calculationTrace.length === 0
        ? "<p>None recorded.</p>"
        : `<table><thead><tr><th>Step</th><th>Name</th><th>Output</th><th>Rule</th><th>Evidence grade</th><th>Assumption</th></tr></thead><tbody>${input.calculationTrace
            .map((s) => `<tr><td>${esc(text(s.step))}</td><td>${esc(text(s.name))}</td><td>${esc(text(s.output))}</td><td>${esc(text(s.ruleRef))}</td><td>${esc(text(s.evidenceGrade))}</td><td>${esc(text(s.assumption))}</td></tr>`)
            .join("")}</tbody></table>`;
    const eventList = input.events === null || input.events === undefined || input.events.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.events
            .map((e) => `<li>${esc(text(e.date))}: ${esc(text(e.event))} — ${esc(text(e.effect))}</li>`)
            .join("")}</ul>`;
    const cmp = input.comparison ?? null;
    const hypothesisList = input.hypotheses === null || input.hypotheses === undefined || input.hypotheses.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.hypotheses
            .map((h) => `<li>Rank ${esc(text(h.rank))} — ${esc(text(h.type))} (${esc(text(h.status))}): ${esc(text(h.counterfactual))} Evidence: ${esc(text(h.evidence))}</li>`)
            .join("")}</ul>`;
    const missingList = input.missingInfo === null || input.missingInfo === undefined || input.missingInfo.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.missingInfo
            .map((m) => `<li>${esc(text(m.field))} (class ${esc(text(m.missingClass))}): ${esc(text(m.consequence))} Resolves by: ${esc(text(m.resolvesBy))}</li>`)
            .join("")}</ul>`;
    const det = input.determination ?? null;
    const evidenceList = input.evidence === null || input.evidence === undefined || input.evidence.length === 0
        ? "<p>None recorded.</p>"
        : `<ul>${input.evidence
            .map((e) => `<li>${esc(text(e.title))} — ${esc(text(e.citation))} (${esc(text(e.location))})</li>`)
            .join("")}</ul>`;
    const body = [
        section("Relevant input data and sources", inputRows),
        section("Applicable plan provisions", provisionList),
        section("Recorded benefit and its documented basis", kvTable([
            ["Recorded PA_AMB", formatMoneyMinor(rb?.amountMinor) + " USD/month"],
            ["Measurement date", text(rb?.measurementDate)],
            ["Measurement basis", text(rb?.measurementBasis)],
            ["Annuity form", text(rb?.annuityForm)],
            ["Vesting treatment", text(rb?.vestingTreatment)],
            ["Source", text(rb?.source)],
            ["Recorded date", text(rb?.recordedDate)],
        ])),
        section("Independent calculation trace", traceList),
        section("Historical events affecting the benefit", eventList),
        section("Numerical comparison", kvTable([
            ["Delta (PA_AMB minus reconstructed)", formatMoneyMinor(cmp?.deltaMinor) + " USD/month"],
            ["Absolute difference", formatMoneyMinor(cmp?.absDeltaMinor) + " USD/month"],
            ["Relative difference", text(cmp?.relDelta)],
            ["Comparison basis", text(cmp?.basis)],
            ["Status", text(cmp?.status)],
            ["Within tolerance", cmp?.withinTolerance === null || cmp?.withinTolerance === undefined ? "Not supplied" : cmp.withinTolerance ? "Yes" : "No"],
            ["Tolerance applied", text(cmp?.tolerance)],
        ])),
        section("Diagnostic hypotheses", hypothesisList),
        section("Missing information", missingList),
        section("Recommended actuarial determination", kvTable([
            ["Disposition", text(det?.disposition)],
            ["Rationale", text(det?.rationale)],
            ["Reviewer", text(det?.reviewer)],
            ["Determination date", text(det?.determinationDate)],
            ["PA_AMB_ACCEPT", text(det?.paAmbAccept)],
            ["Corrected benefit", formatMoneyMinor(det?.correctedBenefitMinor) + " USD/month"],
        ])),
        section("Supporting evidence and reviewer annotations", evidenceList + itemList(input.annotations ?? null)),
        reproFooter(input.reproducibility),
    ].join("\n");
    return reportShell(title, subtitle === "" ? "Participant-level report" : subtitle, body);
}
// ---------------------------------------------------------------------------
// AMB acceptance memo (monadic spec §8.3)
// ---------------------------------------------------------------------------
/** The eight RECOMMENDED data_issues contents (spec §8.3). */
exports.DATA_ISSUES_ITEMS = [
    "Population",
    "Data availability and gaps",
    "Testing method",
    "Differences and observed patterns",
    "Supporting rationale",
    "Exception counts and unresolved cases",
    "Original memo, workbook and Image Viewer document numbers",
    "Reviewer determination",
];
/**
 * Pull one labelled line out of a data_issues fragment's content.
 * The fragment content is built by `buildAmbDataIssuesFragment` as
 * "Label: value" lines; a line not found is "Not established in the
 * AMB analysis.", never invented.
 */
function fragmentLine(content, labelPrefix) {
    for (const line of content.split("\n")) {
        if (line.startsWith(`${labelPrefix}:`)) {
            return line.slice(labelPrefix.length + 1).trim();
        }
    }
    return null;
}
/**
 * AMB acceptance memo: the concise data_issues summary for R1
 * Section 3 'Data Issues', with references to the complete AMB memo,
 * tested workbook, and appendix. The full AMB analysis is never
 * pasted into the R1 main body: findings are counted, not quoted.
 * Image Viewer numbers are shown only when verified; otherwise
 * "Image Viewer document number pending" plus a blocking issue note.
 */
function renderAmbMemo(input) {
    const pkg = input.contribution;
    const fragment = input.dataIssuesFragment;
    const content = fragment?.content ?? "";
    const population = fragmentLine(content, "Population");
    const dataAvailability = fragmentLine(content, "Data availability and gaps");
    const testingMethod = fragmentLine(content, "Testing method");
    const differences = fragmentLine(content, "Differences and observed patterns");
    const rationale = fragmentLine(content, "Rationale for accepting or correcting PA_AMB");
    const exceptions = fragmentLine(content, "Exceptions and unresolved cases");
    const reviewer = fragmentLine(content, "Reviewer determination");
    const memoCitation = input.memoRef !== null && input.memoRef !== undefined ? (0, contribution_js_1.renderCitation)(input.memoRef) : contribution_js_1.IMAGE_VIEWER_NUMBER_PENDING;
    const workbookCitation = input.workbookRef !== null && input.workbookRef !== undefined ? (0, contribution_js_1.renderCitation)(input.workbookRef) : contribution_js_1.IMAGE_VIEWER_NUMBER_PENDING;
    const appendixCitation = input.appendixRef !== null && input.appendixRef !== undefined ? (0, contribution_js_1.renderCitation)(input.appendixRef) : null;
    const missingRefs = [];
    if (input.memoRef === null || input.memoRef === undefined)
        missingRefs.push("Complete AMB memo reference not supplied.");
    if (input.workbookRef === null || input.workbookRef === undefined)
        missingRefs.push("Tested workbook reference not supplied.");
    if (memoCitation === contribution_js_1.IMAGE_VIEWER_NUMBER_PENDING)
        missingRefs.push("Image Viewer document number pending for the complete AMB memo — blocking issue: enter the number only from a verified source.");
    if (workbookCitation === contribution_js_1.IMAGE_VIEWER_NUMBER_PENDING)
        missingRefs.push("Image Viewer document number pending for the tested workbook — blocking issue: enter the number only from a verified source.");
    const blockingIssues = pkg.warnings.filter((w) => w.severity === "blocking").length;
    const rows = [
        ["Population", population ?? "Not established in the AMB analysis."],
        ["Data availability and gaps", dataAvailability ?? "Not established in the AMB analysis."],
        ["Testing method", testingMethod ?? "Not established in the AMB analysis."],
        ["Differences and observed patterns", differences ?? "Not established in the AMB analysis."],
        ["Supporting rationale", rationale ?? "Not established in the AMB analysis."],
        ["Exception counts and unresolved cases", exceptions ?? "Not established in the AMB analysis."],
        ["Original memo, workbook and Image Viewer document numbers", `Complete AMB memo: ${memoCitation}. Tested workbook: ${workbookCitation}.${appendixCitation === null ? "" : ` Appendix: ${appendixCitation}.`}`],
        ["Reviewer determination", reviewer ?? "No reviewer determination recorded."],
    ];
    const body = [
        section("AMB acceptance — data issues summary (R1 Section 3)", `<p>Concise summary only. The complete AMB memo, tested workbook, and appendix are referenced below; the full AMB analysis is not reproduced here.</p>` +
            kvTable(rows)),
        section("References", kvTable([
            ["Complete AMB memo", memoCitation],
            ["Tested workbook", workbookCitation],
            ["Appendix", appendixCitation ?? "Not supplied."],
        ]) + itemList(missingRefs.length === 0 ? null : missingRefs, "No missing references.")),
        section("Contribution package", kvTable([
            ["Product", `${pkg.productId} ${pkg.productVersion}`],
            ["Case", pkg.caseId],
            ["Status", pkg.status],
            ["Produced at", pkg.producedAt],
            ["Published by", pkg.publishedBy],
            ["Source snapshot", pkg.sourceSnapshotId],
            ["Calculation run", pkg.calculationRunId ?? "Not supplied"],
            ["Findings in package", `${pkg.findings.length} (count only; findings are not quoted here)`],
            ["Fragments in package", `${pkg.fragments.length} (count only)`],
            ["Blocking warnings", `${blockingIssues}`],
            ["Required follow-ups", pkg.requiredFollowups.length === 0 ? "None recorded." : pkg.requiredFollowups.join("; ")],
        ])),
        reproFooter({
            inputSnapshotHash: input.reproducibility?.inputSnapshotHash ?? pkg.sourceSnapshotId,
            ruleVersion: input.reproducibility?.ruleVersion ?? null,
            formulaVersion: input.reproducibility?.formulaVersion ?? null,
            toleranceVersion: input.reproducibility?.toleranceVersion ?? null,
            engineVersion: input.reproducibility?.engineVersion ?? null,
        }),
    ].join("\n");
    return reportShell("AMB Acceptance Memo — R1 Section 3 Data Issues", `Case ${pkg.caseId} | Product ${pkg.productId} ${pkg.productVersion} | Status ${pkg.status}`, body);
}
