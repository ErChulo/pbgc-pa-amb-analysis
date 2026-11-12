# PBGC PRIOR ADMINISTRATOR ACCRUED MONTHLY BENEFIT (PA_AMB)
# MONADIC CALCULATION ARCHITECTURE - DEVELOPMENT SPECIFICATION
# Version 1.1 | 2026-11-12
# Scope: PA_AMB analysis + work-product evidence propagation + R1 memo assembly

## OBJECTIVE
Build a deterministic, auditable calculation and analysis system for prior
administrator accrued monthly benefits. Use the following computational
abstractions. Keep the actuarial rules independent of the user interface,
database, and file operations. Every relevant upstream work product must also
produce reusable, traceable findings for the final R1 Actuarial Case Memo.

## 1. PRIMITIVE MONADIC EFFECTS

### 1.1 Reader<Context, A>
    Read an explicit, immutable calculation context. The context contains
    participant inputs, historical plan rules, source references, dates,
    benefit basis, rounding policy, and configured assumptions.

### 1.2 State<RunState, A>
    Carry calculation-run state between explicit steps. Track selected
    historical periods, computed intermediates, scenario identity, and
    calculation status. Do not mutate original evidence or source records.

### 1.3 Result<A, CalcError>
    Return either a valid value or a typed calculation failure. Include error
    codes, field names, source locations, and the rule that failed.

### 1.4 Option<A>
    Represent an unavailable value explicitly. Do not replace missing
    compensation, service, dates, or benefit amounts with zero. Distinguish
    absence from errors and from an actual numerical zero.

### 1.5 Writer<A, WorkProductLog>
    Attach an ordered calculation trace AND reusable report contributions.
    WorkProductLog contains trace events, typed facts, findings, decisions,
    reusable narrative fragments, R1 section targets, and evidence links.
    Record input values, rules, intermediate results, effective dates, units,
    assumptions, rounding, source citations, and the outcome of each step.
    Combine logs with a deterministic, associative append/merge operation.
    Never discard a finding or its evidence when chaining calculations.

### 1.6 List<A> (or NonEmptyList<A>)
    Carry alternative scenarios or candidate explanations. Do not combine
    mutually exclusive historical assumptions into one unlabelled result.
    Assign each scenario its own provenance, assumptions, and trace.

NOTE: These are conceptual effect abstractions. A production TypeScript or
Rust system can implement them using typed functions and explicit result
objects. It does not need a general-purpose monad-transformer library.

## 2. COMPOSED DOMAIN CALCULATIONS

### 2.1 HistoricalCalc
    Compose Reader + State + Result + Writer.
    Select the plan provisions and statutory rules that apply at each
    measurement date. Keep the history of amendments, freezes, and protected
    benefits visible.

### 2.2 AccruedBenefitCalc
    Compose HistoricalCalc + Option + Writer.
    Calculate benefit service, compensation, and the governing accrual
    formula. Return an accrued benefit on a stated date and annuity basis.

### 2.3 ProtectedBenefitCalc
    Compose AccruedBenefitCalc + Result + Writer.
    Apply applicable grandfathered benefits, formula floors, offsets, and
    accrued-benefit limits under plan provisions and governing law.
    Do not mix PBGC guarantee limits into the basic plan AMB calculation.

### 2.4 ScenarioCalc
    Compose List + Reader + Result + Writer.
    Evaluate distinct, explicitly labelled alternatives for incomplete
    historical data, competing plan interpretations, or rounding methods.
    Preserve separate results and uncertainty; never silently select the
    scenario with the smallest PA_AMB difference.

### 2.5 ReconciliationCalc
    Compose ProtectedBenefitCalc + ScenarioCalc + Result + Writer.
    Normalize the reported PA_AMB and reconstructed AMB to the SAME
    measurement date, annuity form, vesting basis, and payment frequency.
    Calculate signed, absolute, and conditional relative differences.
    Test hypotheses for documented discrepancies.

### 2.6 StatisticalCalc
    Compose List + Result + Writer over a population of reconciliations.
    Calculate summary statistics, robust residuals, cohort comparisons,
    outlier indicators, and uncertainty. Statistical predictions are
    diagnostic evidence, not legally determined benefit amounts.

### 2.7 DecisionCalc
    Compose ReconciliationCalc + StatisticalCalc + Result + Writer.
    Prepare a proposed disposition: verified, supported for acceptance,
    investigation required, correction recommended, or indeterminate.
    Require explicit human review and approval for the final determination.

### 2.8 AuditedCalc
    Wrap every domain calculation with Writer and reproducibility metadata.
    Preserve original inputs, source version, plan-rule version, run identity,
    calculation trace, errors, decisions, and reviewer approvals.

### 2.9 FindingPublicationCalc
    Compose domain calculations + Writer + Result. Convert supported
    calculations, validations, interpretations, and decisions into structured
    findings. Attach evidence and candidate R1 destinations. Do not publish
    unsupported assertions as established facts.

### 2.10 WorkProductContributionCalc
    Compose Reader + Writer + State + Result. Each R5/Plan Summary/PF/DEL/
    Section 436/Estimated Administration/Estimated Adjustment/V1/BSRS/AMB
    module publishes versioned report contributions to one shared ledger.
    Preserve both its work-product citation and the primary source citation.

### 2.11 R1AssemblyCalc
    Compose Reader<R1TemplateRegistry> + State<R1DraftState> +
    Writer<WorkProductLog> + Result<R1Draft, R1BuildError>.
    Collect eligible contributions from all earlier products; map them to
    actual sections in the selected native R1 template; summarize, deduplicate,
    reconcile, and insert them while preserving the template's layout.
    Produce an evidence checklist, unresolved-items list, and citation index.
    Never invent an Image Viewer document number or silently resolve conflicts.

NOTE: Sections 2.9-2.11 are DOMAIN WORKFLOWS, not new primitive monads.

NOTE: The eight names above identify DOMAIN WORKFLOWS, not eight distinct
mathematical monads. Implement them by composing the six primitive effects.

## 3. PURE ACTUARIAL OPERATORS (NOT MONADS)

Accrue, Average, Prorate, Sum, Multiply, Min, Max, Offset, Cap, Floor,
Protect, Convert, Normalize, Round, Compare, Discount (if applicable).

Each operator must specify input types, units, output type, dates,
preconditions, rounding rules, and authority. Keep formula definitions
parameterized and effective-dated. Avoid plan-specific hard-coded branches.

## 4. SUGGESTED COMPOSITION

HistoricalCalc
  -> AccruedBenefitCalc
  -> ProtectedBenefitCalc
  -> ReconciliationCalc
  -> StatisticalCalc
  -> DecisionCalc
  -> FindingPublicationCalc
  -> WorkProductContributionCalc
  -> R1AssemblyCalc

ScenarioCalc explores specified alternatives when necessary.
AuditedCalc captures the provenance and trace of each operation.

One concrete functional encoding (illustrative TypeScript):

  type Calc<A> = (
    context: Readonly<Context>,
    state: Readonly<RunState>
  ) => {
    result: Result<Option<A>, CalcError>;
    nextState: RunState;
    log: WorkProductLog;  // trace + facts + findings + R1 fragments
  };

  type ScenarioCalc<A> = ReadonlyArray<{
    scenarioId: string;
    assumptions: ReadonlyArray<Assumption>;
    calculation: Calc<A>;
  }>;

Provide map, flatMap, and/or bind-like composition helpers where useful.
Do not lose typed errors, missing-value status, or source provenance during
composition.

## 5. MANDATORY INVARIANTS

A. Never change the raw prior-administrator PA_AMB record in place.
B. Identify the reported benefit's measurement date and benefit basis before
   comparing it with an independently calculated accrued benefit.
C. Distinguish accrued benefit from vested benefit, commenced benefit,
   PBGC-guaranteed benefit, and PBGC termination benefit.
D. Do not apply the vesting percentage twice. First establish whether PA_AMB
   already incorporates vesting, based on the actual data definition.
E. Apply plan provisions according to their documented effective dates.
F. Apply monetary rounding at the prescribed calculation stages.
G. Represent missing information explicitly. Do not fabricate records.
H. Require source support for material legal and actuarial interpretations.
I. Treat statistical outliers and close numeric matches as investigation
   signals, not proof of error or correctness.
J. Keep all calculations reproducible from a versioned input snapshot,
   versioned rules, and an explicit calculation date.
K. Final acceptance, correction, or rejection remains a human actuarial
   decision under applicable PBGC procedures.

## 6. IMPLEMENTATION DIRECTION

Develop a small, typed, pure functional core first. Add domain workflows as
combinations of the primitive effects. Keep browser UI, local persistence,
file imports, report exports, and any optional WebAssembly code at the
system boundary. Test every effect and composite workflow with fictional
participant records and historical plan-rule examples.

## 7. CROSS-WORK-PRODUCT EVIDENCE AND FINDING PROTOCOL

### 7.1 Shared ledger - the essential new requirement

    A completed work product is NOT the only output of a module. Every module
    must also publish structured, reusable contributions to a case-level
    WorkProductLedger. This ledger is the input to the R1 memo constructor.

    Work-product flow (the precise dependency DAG is case-configurable):

      R5 / Plan Summary -----------+
      Plan Factors (PF) -----------+
      Data Element List (DEL) ----+
      Section 436 Analysis -------+
      Estimated Administration ---+----> WorkProductLedger
      Estimated Adjustments ------+               |
      PA_AMB Acceptance Analysis -+               |
      V1 / DOPT Valuation --------+               v
      BSRS and Case Findings -----+----> R1AssemblyCalc
                                      |
                                      v
                             Native R1 Template
                                      |
                                      v
                          Draft R1 + Citation Index
                          + Open Issues + Audit Log

    The listed sources are candidate contributors, not a claim that each
    document belongs in every R1 section. The module decides what is material;
    the verified section registry determines where it belongs.

### 7.2 Required record types

    EvidenceRef:
      evidenceId                 Stable internal reference.
      sourceDocumentId           Internal immutable document identity.
      sourceKind                 plan document | census | valuation report |
                                 PBGC policy | work product | other.
      title                      Original document title.
      versionOrDate              Applicable source version/date.
      imageViewerDocumentNumber  Exact Image Viewer document number; nullable.
      documentLocation           Page, section, table, paragraph, sheet/cell,
                                 or other precise original source location.
      originalExcerpt            Short source excerpt or exact source values,
                                 if permitted; never uncited invented text.
      sourceHash                 Optional content-integrity fingerprint.
      accessStatus               verified | available | missing | pending.

    Finding:
      findingId                  Stable key not based on document ordering.
      caseId                     PBGC case number.
      originatingWorkProduct     R5 | PlanSummary | PF | DEL | 436 | EstimatedAdmin
                                 | EstimatedAdjustment | AMB | V1 | BSRS | other.
      originatingVersion        Work-product version and calculation-run ID.
      claimType                 fact | derived_result | assumption |
                                 interpretation | decision | exception | risk.
      subjectScope              plan | participant | cohort | valuation.
      subjectIds                Participant IDs only when required.
      effectivePeriod           Date range to which the claim applies.
      valueAndUnits             Structured value, amount, units, and basis.
      findingStatement          Concise, factually bounded claim.
      rationale                 How the claim was reached.
      evidenceRefs              One or more source EvidenceRef IDs, or an
                                 explicit missing-evidence exception.
      derivedFromFindingIds     Upstream finding IDs; maintain full lineage.
      reviewState               draft | reviewed | approved | superseded |
                                 disputed.
      materiality               Explicit case-level review flag/rule.
      intendedR1Topics          Semantic R1 target keys (NOT bare numbers).
      supersedes                Previous finding ID, when revised.

    NarrativeFragment:
      fragmentId                 Stable identity and version.
      findingIds                Supporting Finding IDs (one-to-many).
      targetTopicKeys           Requested R1 semantic destination(s).
      form                       summary | detail | table | footnote |
                                 appendix | citation | open_issue.
      content                    A proposed paragraph, table, or structured
                                 narrative; not an unreviewed final decision.
      evidenceRefs              References that support each material claim.
      inclusionState            candidate | selected | rejected | superseded.
      approvalState             Proposed | reviewed | approved, as required.
      displayOrder              Relative placement inside target section.
      conflictGroup             Shared subject/topic used for reconciliation.

    WorkProductContribution:
      productId, productVersion, caseId, producedAt, publishedBy,
      sourceSnapshotId, status, findings[], fragments[], citations[],
      warnings[], requiredFollowups[], downstreamDependencies[].

    R1Placement:
      templateId, templateVersion, sectionKey, anchorId, fragmentId,
      renderedTextOrTable, renderedCitations[], placementStatus.

### 7.3 Two-level provenance (mandatory)

    Track BOTH:
       (a) the primary evidence (e.g., plan amendment or census record);
       (b) the intermediate work product (e.g., R5 paragraph, AMB memo,
           Section 436 analysis, or V1 worksheet) that interprets it.

    Example (synthetic; the number is NOT an actual case citation):
       Primary source: Plan amendment, Image Viewer Document #EXAMPLE,
                       page 4, effective 01/01/20XX.
       Interpreted in: R5 Section 'Plan Benefits', revision 3.
       Calculated in: AMB analysis, run 19.
       Placed in: R1 'Plan Benefit Formula Summary'.

    A Google Drive file ID, a local filename, an internal evidenceId, and an
    Image Viewer document number are DIFFERENT identifiers. Never substitute
    one for another. The actual Image Viewer document number is entered or
    imported only from a verified source; it is never inferred or invented.
    Store it as text to preserve the exact identifier.

### 7.4 Citation rendering

    Use the citation wording required by the selected R1 guidance, e.g.:
       "Image Viewer Document #123"
       "Image Viewer Document #123, page 5"
    These strings are examples of FORMAT ONLY.

    When a document number is not known:
       - retain the source and exact location in the internal record;
       - show "Image Viewer document number pending" in the R1 draft;
       - add a distinct blocking issue for every material unsupported
         Image Viewer citation required for final review;
       - do not generate fictional citations or approve the draft as final.

    The citation builder must avoid duplicating identical references and must
    preserve distinct page/cell citations when claims rely on different parts
    of the same document. Citation requirements can vary by section.

## 8. R1 TEMPLATE SECTION REGISTRY

### 8.1 Template-driven placement, not hardcoded paragraph insertion

    Parse the user's official native R1 memo template and identify stable
    semantic section keys, headings, and insertion anchors. Preserve native
    document styles, page layout, tables, heading numbering, and fixed text.
    Treat section NUMBERS as display labels that may change with templates.
    An R1 shell and/or approved instruction document controls the actual
    hierarchy. Unknown sections must be marked for mapping, not guessed.

### 8.2 Verified examples from 'Actuarial Case Memo Sample Language_06042026'
    and 'R1 Simplified Instructions' (Google Drive, Book of Job):

    R1 topic key             Example section       Typical contributing product
    ----------------------   -------------------   ----------------------------
    participant_counts       Count reconciliation  DEL / participant database
    data_issues              3. Data Issues        PDR / DEL / AMB acceptance
    plan_documents           4. Plan Documents     R5 / Plan Summary
    benefit_formula          5. Plan Benefit       R5 / Plan Summary / AMB
                             Formula Summary
    retirement_rules         6. Normal, Early,     R5 / Plan Factors
                             and Late Retirement
    vesting                  7. Vesting            R5 / Plan Summary
    preretirement_death      8. QPSA and other     R5 / Plan Summary / V1
    benefit_offsets          9. Offsets to Plan    R5 / AMB / V1
                             Benefits
    annuity_forms           10. Forms of Annuity   R5 / PF / V1
    interpretations         11. Benefit / Plan     R5 / 436 / AMB / V1
                             Document Interprets.
    expected_retirement     12. Expected           PF / V1
                             Retirement Age
    accrued_at_normal       13. Accrued-at-Normal  436 / V1
    max_guarantee           14. Maximum Guarantee  V1 / limitations
    phase_in                15. Phase-In           R5 / V1 / limitations
    ownership_limit         16. Majority Owner     V1 / limitations
    asset_allocation        17. Asset Allocation   V1 / allocation results
    pre_dopt_adjustments    19. Pre-DOPT Retiree   Estimated Adjustment / V1
    post_dopt_retirees      20. Post-DOPT Retirees V1 / Estimated Admin
    lump_sums               21. Estimated Lump     V1 / Estimated Admin
                             Sums paid Post-DOPT
    estimated_adjustments   22. Estimated Benefit  Estimated Adjustment
                             Adjustments
    post_nrd                23. Post-NRD Benefits  R5 / PF / V1
    qdros                   24. QDROs              DEL / V1
    bsrs                    25. BSRS               BSRS / V1
    additional_comments     26. Additional         All relevant modules
                             Comments
    expense_loading         27. Expense Loading    Valuation results
    liability_analysis      28. Liability-Weighted V1 / valuation summaries
                             Average Age, etc.
    valuation_rates         29. Valuation Interest V1 / PF / valuation inputs
                             Rates

    These are mappings to the reviewed 2026 sample, not universal guarantees.
    Re-validate against the user's actual selected R1 template every time.
    Missing section 18 or other template-specific sections must be resolved
    from that template, not invented by the engine.

### 8.3 Explicit AMB acceptance placement

    The reviewed R1 sample states that Section 3, 'Data Issues', must say
    whether accrued benefits were accepted and support that decision.
    Thus AMB Acceptance Analysis MUST publish at least:
       - Population to which acceptance/reconstruction applies.
       - Data availability and important data gaps.
       - Sample or full-population AMB testing method.
       - Differences and observed patterns.
       - Supporting rationale for accepting or correcting PA_AMB.
       - Exception counts and unresolved cases.
       - Original AMB memo/workbook and supporting Image Viewer document #s.
       - Reviewer determination, when applicable.

    The R1 builder places a concise supported summary in 'data_issues',
    with references to the complete AMB acceptance memo, the tested workbook,
    and any appropriate Appendix. Material interpretation of the benefit
    formula also contributes to 'benefit_formula' and 'interpretations'.
    Do not paste the entire AMB analysis into the R1 main body by default.

## 9. COMPOSITION, CONFLICT, AND DRAFTING RULES

### 9.1 Collector -> reconciler -> renderer

    Work-product modules PUBLISH findings to the ledger. The R1 constructor
    CONSUMES an immutable approved snapshot of that ledger.

       ingest contributions
        -> validate types, citations, and provenance
        -> resolve superseded versions
        -> group by semantic topic and subject
        -> detect contradictions and incompatible measurement bases
        -> select current reviewed/approved contributions
        -> summarize and order findings
        -> render citations and tables
        -> insert into matched R1 anchors
        -> produce placement/citation/omissions reports.

    The R1 constructor must not independently reinterpret source material,
    revise actuarial rules, change calculations, or declare review approvals.
    Those actions belong to upstream work-product modules and human review.

### 9.2 Dependency graph and incremental refresh

    Model all dependencies as a directed acyclic graph whenever possible:

      SourceDocument -> PlanRule -> Calculation -> Finding
                     -> NarrativeFragment -> R1Placement -> R1Draft.

    On any source, calculation, or interpretation revision:
       - identify affected descendants;
       - invalidate stale findings and placements;
       - recalculate only required modules;
       - regenerate affected sections;
       - preserve the old approved draft and audit history.

    Prevent duplicate insertion when the same finding appears in R5, AMB, V1,
    and an Estimated Adjustment memo. One fact may support several sections;
    publish a single canonical finding with multiple approved placements.

### 9.3 Monoidal writer merge

    The WorkProductLog has at least:
       traceEvents[], findings[], fragments[], evidenceRefs[],
       warnings[], decisions[], openIssues[].

    Its append/merge operation must be associative and must have an empty
    identity log. Preserve deterministic ordering. Deduplicate by stable ID
    and version; do not discard conflicting values with the same semantic
    key. Escalate conflicts to an explicit review state.

    Writer(logA) + Writer(logB) -> Writer(merge(logA, logB))

    IMPORTANT: A 'Writer' effect carries provenance; it does not decide the
    factual correctness, materiality, or location of the conclusion.

### 9.4 Deterministic R1 assembly

    Illustrative TypeScript interfaces (not a required library):

      type IVDocumentNo = string; // verified; never guessed
      type R1TopicKey = string;    // semantic, template-independent
      type Approval = 'draft'|'reviewed'|'approved'|'superseded'|'disputed';

      interface EvidenceRef {
        evidenceId: string;
        sourceDocumentId: string;
        imageViewerDocumentNumber: IVDocumentNo | null;
        location: { page?: string; section?: string;
                    sheet?: string; cell?: string };
      }
      interface Finding {
        findingId: string;
        caseId: string;
        workProductId: string;
        workProductVersion: string;
        statement: string;
        evidenceIds: readonly string[];
        derivedFromFindingIds: readonly string[];
        targetTopics: readonly R1TopicKey[];
        approval: Approval;
      }
      interface R1BuildResult {
        draft: DocumentModel;
        placementIndex: readonly R1Placement[];
        citationIndex: readonly EvidenceRef[];
        unresolvedIssues: readonly BuildIssue[];
      }

      assembleR1(
        template: Readonly<R1TemplateRegistry>,
        contributions: ReadonlyArray<WorkProductContribution>,
        approvalPolicy: Readonly<ApprovalPolicy>
      ): Result<R1BuildResult, R1BuildError>

    Keep the R1 document renderer at the side-effect boundary. The pure
    assembler first constructs a typed DocumentModel. A file adapter then
    applies insertions to a COPY of the official R1 template.

## 10. R1 QUALITY GATES - REQUIRED TESTS

    G1. Every inserted material claim links to one or more evidence records.
    G2. All cited Image Viewer numbers are verified and exactly preserved.
    G3. Missing Image Viewer numbers appear as explicit unresolved issues;
        never fabricate or silently omit them.
    G4. Every selected contribution has a valid section anchor in the
        current official R1 template, or is listed as unplaced.
    G5. No superseded finding silently replaces a current approved finding.
    G6. Conflicting work products stop silent publication of the affected
        assertion and identify the conflicting sources and calculation runs.
    G7. Repeated facts are deduplicated without losing their citations.
    G8. Final R1 text distinguishes verified results, assumptions, unresolved
        issues, and approved actuarial interpretations.
    G9. Changes to R5, AMB analysis, 436, or V1 invalidate downstream R1
        placements that depend on those changes.
    G10. The produced R1 preserves the native template's required structure,
         sections, tables, style, and untouched template content.
    G11. A citation index traces each R1 sentence/table to its source
         Image Viewer document, location, and originating work product.
    G12. A test rebuild from the same source snapshot and rule versions
         produces the same placements and narrative values.
    G13. No draft can claim a human approval that was not recorded.
    G14. Human-authored edits in an existing draft are not silently erased;
         preserve edits or flag conflicts before replacing generated text.

## 11. DELIVERY REQUIREMENT FOR ALL WORK-PRODUCT MODULES

    Every product must export BOTH:
      (1) its traditional file (R5, 436 memo, AMB memo, V1, BSRS, etc.); and
      (2) a versioned, machine-readable WorkProductContribution package.

    The package is not a summary of a finished document. It is structured
    evidence and conclusions captured DURING the analysis, including precise
    source references and a proposed R1 destination.

    Final R1 delivery must include:
      - Native R1 memo generated from the verified case template.
      - Mapping of fragments to actual template sections.
      - Cross-reference index of Image Viewer document numbers.
      - Open issues, missing references, and conflict report.
      - Build manifest with product versions and source hashes/IDs.
      - Reviewer approval states and an auditable revision trail.

    R1 composition is a case-level finalization step, not a feature limited
    to the PA_AMB module. The AMB app must implement the common contribution
    protocol so it can later integrate with the broader Case Workbench.

## SOURCE BASIS FOR THE R1 EXTENSION

    'R1 Simplified Instructions.docx' (Google Drive, Book of Job).
    'Actuarial Case Memo Sample Language_06042026.docx' (same repository).
    Reviewed statements: Section 3 requires supporting AMB acceptance;
    Section 5 describes formulas; Section 11 records interpretations;
    illustrative citations use 'Image Viewer Document #123'.

    The record schemas, monadic composition, mapping contract, and test gates
    above are software design RECOMMENDATIONS. They are not official PBGC
    technical specifications and must be checked against the current approved
    R1 template and policies for each case.

## REFERENCE MATERIAL
Use the DB Answer Book, especially Chapters 3, 4, 7-10, 16, 18, and 26,
and the applicable PBGC documentation in Google Drive:
https://drive.google.com/drive/folders/1lMwQHcNNVciHisiEDMeI-mhxQFMsFCXZ

This architecture is a design recommendation, not a classification or
instruction published by the DB Answer Book or PBGC.


---

# Addendum — spec corrections, 2026-11-12 (Stage 4.5)

This addendum corrects the spec above. It appends only; no existing spec
text was edited, deleted, or rewritten. Each correction was re-verified
against the actual R1 source files in `~/workspace/pbgc_review/r1/`
(Sample Language 06042026, Shell 08062026, Simplified Instructions) and the
R1 Definition and Dependency Map. All six corrections verified; none was
left unverifiable.

## Correction 1 — Section 18 exists; add it to the registry

Section 18, "4022(c) Allocation", EXISTS in both controlling sources. The
spec §8.2 sentence "Missing section 18 or other template-specific sections
must be resolved from that template, not invented by the engine" is
WITHDRAWN as it concerns §18 — §18 is resolved from the shell and sample
language, not invented.

- Shell, line 166: "18.  4022(c) Allocation".
- Sample Language, P683–P717: "18.  4022(c) Allocation" with full
  three-paragraph format (UNGB by priority category; SPARR / Non-SPARR
  alternatives; 4022(c) amount and allocation).
- Definition Map §4, row 18: full §18 content and dependencies; §6:
  "PF → §17/§18 financial / allocation inputs" and "V1 → front-page PVs,
  §§12–18, §§27–29".

Registry row to add (spec §8.2):

    allocation_4022c   18. 4022(c) Allocation   V1 / allocation results

Topic key `allocation_4022c` is PROPOSED — it follows the spec's own
semantic-key convention; it is a design proposal, not a sourced term.
Contributing product "V1 / allocation results" follows the Definition Map
§6 (authored spec, not a PBGC source); see Correction 3.

Note: the "missing §18" claim is true only of the partial Simplified
Instructions, which marks "[Section 18 ommited]" (P119). See Correction 5.

## Correction 2 — Add §§1–2 to the registry

The §8.2 table does not cover the full §§1–29 registry it maps.

- §1 Relevant Dates / Termination Information has no topic key. Propose
  `relevant_dates` (proposed, same caveat as Correction 1 — a design
  proposal, not a sourced term). Sources: Shell, line 132; Sample
  Language, P74: "1.  Relevant Dates / Termination Information".
- §2 Participant Count Reconciliation exists in the table only as the
  unnumbered "Count reconciliation" row. Give it the §2 anchor explicitly.
  Sources: Shell, line 134: "2.  Participant Count Reconciliation";
  Sample Language, P120: "Participant Count Reconciliation" (heading
  unnumbered in the sample text; the §2 number is from the shell).

## Correction 3 — The §8.2 product column is inference, not verified

The "Typical contributing product" column of §8.2 is the spec author's
inference. It is NOT stated in any PBGC source. Term checks in the Sample
Language: "DEL" as a product — 0 hits; "V1" — 0 hits (sources say "BCV
6.x" / "BCV", never "V1"); "Estimated Admin/Administration" — 0 hits.

Mark the column "inferred from the Definition Map §4/§6 (authored spec,
not a PBGC source)" — or re-derive it from the Definition Map and say so.
Do NOT keep the "Verified examples" label (§8.2 heading) for the table as
a whole: the section numbers and headings are verified; the product column
is not.

## Correction 4 — §8.3's MUST list is recommended content, not sourced

Only ONE sentence in §8.3 is sourced: Section 3 must say whether accrued
benefits were accepted and support that decision.

- Sample Language, §3 guidance (P169): "Also, indicate if you accepted
  accrued benefits for any group of (or all) participants and support the
  decision."
- Simplified Instructions, §3 (P26): "Indicate if you accepted accrued
  benefits and support the decision."

The eight items in §8.3 ("AMB Acceptance Analysis MUST publish at least")
are NOT requirements in the sources. The sample §3 example (P182)
illustrates testing method, acceptance where data were lacking, and a list
of accepted AMBs (Attachment A, 25 participants) — but the sources never
require "exception counts" or a "reviewer determination" in §3.

The eight items are kept as the AMB module's RECOMMENDED publication
contents. They must not be presented as what "the reviewed R1 sample
states" (spec §8.3, first sentence). The §8.3 opening is corrected to:
the reviewed R1 sample states only the accept-and-support sentence; the
eight items are the AMB module's recommended elaboration of it.

## Correction 5 — One sourcing rule, applied uniformly

The spec took §17 from the shell/sample but treated §18 as missing from
the partial Simplified Instructions. That is internally inconsistent: the
Instructions omit BOTH §17 (P118: "[Section 17 ommited]") and §18 (P119:
"[Section 18 ommited]"), yet the spec's table includes §17 Asset
Allocation.

The rule, stated once per the Definition Map §1, is: where the
Instructions are silent, the shell + sample language govern. (Definition
Map §1: "It is partial: Part 1 is marked omitted, Sections 17–18 are
marked omitted, and it ends at Section 22. Where it is silent, the shell
+ sample language govern. It does not override the shell.")

Applied uniformly, this rule is why §17 is in AND §18 is in, even though
the partial Simplified Instructions omit both.

## Correction 6 — Headings: source wording or marked paraphrase

The §8.2 headings below are paraphrases in the spec. Use the source
wording, or mark them as paraphrase:

- §13: "Accrued-at-Normal Limitation" (spec: "Accrued-at-Normal").
  Sample Language, P539.
- §14: "Maximum Guaranteeable Benefit / Aggregate Maximum Benefit"
  (spec: "Maximum Guarantee"). Sample Language, P568.
- §24: "Qualified Domestic Relations Orders (QDROs)" (spec: "QDROs").
  Sample Language, P918.
- §25: "Benefit Statement and Recalculation System (BSRS)" (spec:
  "BSRS"). Sample Language, P936.
- §29: "Table of Valuation Interest Rates" (spec: "Valuation Interest
  Rates"). Shell, line 188; Sample Language, P47 (cross-reference).

Substance matches in each case; only the wording is corrected.

## Verification statement

All six corrections above were verified by direct grep against the source
files listed at the top of this addendum. No correction in this addendum
was left unverifiable, and no source file was inaccessible. No live case
data was used; all examples cited are from the PBGC-produced sample/shell
documents. No Image Viewer document number was invented; "#123" citations
in the spec remain format-only examples, confirmed in the Sample Language
(11 occurrences, e.g. P134; ", page 5" variant at P274).
