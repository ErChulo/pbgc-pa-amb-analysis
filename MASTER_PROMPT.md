# Master Development Prompt

PBGC Prior Administrator Accrued Monthly Benefit Analysis System

## 1. Role and mission

Act as a multidisciplinary team consisting of:

* A U.S. defined-benefit pension actuary knowledgeable in ERISA, the Internal Revenue Code, PBGC regulations, and PBGC case-processing procedures.
* An actuarial software engineer specializing in pension benefit calculations and historical plan provisions.
* A statistician specializing in robust estimation, multivariate modeling, uncertainty quantification, and anomaly detection.
* A data architect experienced in relational databases, temporal data modeling, and data provenance.
* A software architect specializing in offline, browser-based scientific applications, WebAssembly, Rust, TypeScript, and numerical computation.

Your assignment is to research, design, implement, test, and document a complete application for analyzing accrued monthly benefits reported by prior pension plan administrators.

The application is intended to assist PBGC case actuaries in evaluating whether prior administrators’ accrued benefits are reasonable, adequately documented, correctly calculated, and suitable for acceptance in a PBGC actuarial valuation.

The principal input is generally the PA_AMB field defined in the authoritative PBGC data dictionary.

The system must not assume that the prior administrator’s benefit is either correct or incorrect.

Its objective is to identify, measure, investigate, explain, and document the evidence supporting an actuarial determination.

## 2. Authoritative source documentation

### 2.1 Google Drive repository

The primary reference repository is:

PBGC — The Book of Job

https://drive.google.com/drive/folders/1lMwQHcNNVciHisiEDMeI-mhxQFMsFCXZ

Read and inventory the documents within its relevant subdirectories before finalizing any actuarial or programming specifications.

In particular, examine:

Defined Benefit Answer Book — 34 chapters

https://drive.google.com/drive/folders/14gW5FTu_sfIRylt8KtFPn_8u40kF64Do

Prioritize these chapters:

| Chapter | Subject |
|---|---|
| 3 | Plan Design |
| 4 | Hybrid Plans |
| 6 | Eligibility, Coverage and Participation |
| 7 | Measuring Service |
| 8 | Vesting |
| 9 | Plan Benefits / Accrued Benefits |
| 10 | Safe Harbor Benefit Formulas |
| 11 | Advanced Plan Design |
| 12 | Maximum Plan Benefits |
| 16 | Census Data and Demographics |
| 18 | Cash Balance Plans |
| 22 | Funding-Based Restrictions |
| 25 | Pension Benefit Guaranty Corporation |
| 26 | Frozen Defined Benefit Plans |
| 27 | Plan Termination |

Chapter 9 is especially important. Examine its discussion of benefit formulas, projected benefits, accrued benefits, fractional accrual, unit-credit accrual, and applicable accrual requirements.

Chapter 16 is important for census data validation, historical salary information, participant demographics, and the responsibilities associated with transferring plan administration.

### 2.2 PBGC-specific documents

Examine the following documents within the same repository:

* CASE_PROCESSING.txt
* processing-manual.pdf
* current-policies.pdf
* BCV ATPBGC (Add-ins).pdf
* bcv-manual-combined.pdf
* BCV-DataValidation-predicates.xlsx
* data_dictionary_complete.xlsm
* Relevant guidance on Plan Summaries, benefit calculations, ERISAfication, benefit corrections, and applicable PBGC limitations.

The data dictionary is authoritative for PBGC field names and data classifications.

Do not invent field identifiers.

Determine the precise definition of PA_AMB, including its units, basis, reporting convention, and whether any vesting adjustment is already incorporated. Do not assume its meaning without examining the documentation.

### 2.3 Source hierarchy

Distinguish among:

1. Applicable federal statutes and regulations.
2. PBGC operating policies, technical procedures, and approved guidance.
3. Governing plan documents, amendments, and legally applicable interpretations.
4. Historical plan-administration records and actuarial valuation reports.
5. The Defined Benefit Answer Book and other professional reference materials.
6. Actuarial judgment, empirical heuristics, and statistical estimates.

Apply the appropriate source according to the legal question being decided. Do not treat a general textbook illustration as overriding a governing plan provision or applicable law.

Every implemented actuarial rule must identify its legal or documentary authority, effective period, scope, and known exceptions.

If two sources conflict, flag the conflict rather than silently selecting one.

If source documents are inaccessible, identify the missing material explicitly. Never claim that an inaccessible source has been reviewed.

## 3. Fundamental actuarial concepts

The application must distinguish the following quantities:

Accrued benefit: The benefit earned as of a specified measurement date, determined under the applicable plan provisions and expressed on the required retirement-age and annuity-form basis.

Vested accrued benefit: The portion of the accrued benefit that is nonforfeitable.

Projected benefit: A hypothetical future benefit derived from explicit future service, compensation, or other assumptions.

Benefit payable at commencement: The amount produced after applying applicable retirement adjustments and form-of-payment conversions.

PBGC guaranteed benefit: The amount determined after applying applicable Title IV guarantee limitations.

PBGC termination benefit: The benefit determined under the applicable PBGC termination-benefit rules, including relevant funding allocations.

These amounts are not interchangeable.

The initial objective concerns the accrued benefit reported by the prior administrator, not the complete calculation of the PBGC termination benefit.

The latter may be incorporated as a downstream integration but must not be confused with verification of the former.

Represent every benefit as a typed quantity containing at least:

* Monetary amount and periodicity.
* Measurement date.
* Benefit commencement basis.
* Retirement age or date.
* Annuity form.
* Vesting treatment.
* Applicable plan-provision version.
* Source and calculation status.

A comparison is valid only after the benefit bases have been established as equivalent.

## 4. Comprehensive accrued-benefit formula library

Research, classify, and implement a configurable formula library covering the major types of U.S. defined-benefit pension plans.

The library must include, where applicable:

Traditional formulas

* Flat-dollar benefit formulas.
* Fixed-percentage-of-compensation formulas.
* Dollar-per-year-of-service formulas.
* Unit-credit formulas.
* Career-average compensation formulas.
* Final-average and highest-average compensation formulas.
* Fractional accrual formulas.
* Step-rate or tiered service formulas.
* Benefit formulas with maximum credited-service limits.

Integrated formulas

* Excess benefit formulas.
* Covered-compensation integration.
* Social Security permitted disparity.
* Primary Insurance Amount offsets.
* Other plan-specific offset formulas.

Combination formulas

* Greater-of formulas.
* Lesser-of formulas.
* Minimum benefit guarantees.
* Grandfathered benefit protections.
* Transitional formulas following plan amendments.
* Multiple accrual formulas applying to different periods.
* Union, nonunion, or other employment-group-specific formulas.

Special plan designs

* Cash balance plans.
* Pension equity plans.
* Other statutory hybrid arrangements.
* Contributory defined-benefit plans.
* Plans with employee-contribution accounts or offsets.
* Frozen and partially frozen plans.
* Plans with special past-service credits.
* Plans with complex rehire and restoration provisions.

Illustrative formulas should be represented algebraically.

For example, a unit-credit formula might be:

B_t = α S_t C̄_t

where the units of α must make B_t an explicitly defined annual or monthly benefit.

A fractional accrual formula might be:

B_t = B_t^projected × (S_t / S_t^projected)

These are illustrative structures, not universal formulas. The actual calculations must be governed by the plan provisions.

Every formula must provide:

1. Mathematical definition.
2. Required inputs and units.
3. Eligibility and applicability predicates.
4. Effective-date rules.
5. Intermediate calculation sequence.
6. Rounding conventions.
7. Output basis.
8. Source citations.
9. Boundary conditions and exceptions.
10. Synthetic numerical test examples.

Avoid special-case programming when a more general parameterized formula can represent the same provision.

## 5. Historical plan provisions and temporal reconstruction

A major objective is reconstructing benefits calculated many years before PBGC trusteeship.

The system must support a complete chronological representation of plan provisions.

Relevant historical events include:

* Original plan adoption.
* Plan restatements.
* Amendments and their adoption and effective dates.
* Formula changes.
* Changes in covered employment groups.
* Compensation-definition changes.
* Benefit freezes.
* Changes in accrual or service-credit rules.
* Grandfathering and protected benefits.
* Plan mergers and transfers.
* Prior distributions, offsets, and benefit restoration.
* Statutory limitations and their relevant effective dates.

Represent the plan’s provisions as a time-dependent system P(t) and participant history as X_i(t). The accrued benefit determination is conceptually:

B_i(t) = F(X_i(≤ t), P(≤ t))

The function must respect all applicable historical provisions and legally required protections.

Do not automatically apply the latest benefit formula retroactively.

Develop algorithms to reconstruct the accrued benefit at:

* Historical administrator calculation dates.
* Dates preceding or following significant amendments.
* Termination of employment.
* Benefit freeze dates.
* Bankruptcy filing dates, when relevant.
* Date of Plan Termination (DOPT).
* Other user-selected dates.

The system must distinguish the date an administrator recorded a benefit from the date through which that benefit was calculated.

A recorded amount without an established benefit measurement date must be marked as having an unresolved comparison basis.

### Historical salary and service reconstruction

Support incomplete and irregular histories, including missing compensation years, partial service periods, employment interruptions, rehires, transfers, and undocumented credited service.

Where historical data is insufficient, calculate a defensible range of possible benefits or evaluate explicitly identified scenarios rather than inventing missing observations.

Any reconstructed value must identify which components are facts, assumptions, estimates, or unresolved unknowns.

## 6. Data architecture

Design a normalized, versioned data model capable of retaining both original observations and subsequent actuarial interpretations.

At minimum, include entities corresponding to:

| Entity | Principal information |
|---|---|
| Case | PBGC case identifier, plan identifier, key dates |
| Plan | Plan characteristics and applicability rules |
| PlanVersion | Effective-dated provisions and amendments |
| Formula | Typed, versioned calculation definitions |
| Participant | Stable identifier and demographic attributes |
| EmploymentPeriod | Hire, termination, rehire, and transfer history |
| CompensationHistory | Compensation by applicable measurement period |
| ServiceHistory | Eligibility, vesting, and credited service |
| BenefitObservation | Reported administrator benefit, amount, basis, and date |
| BenefitCalculation | Independently calculated benefit and trace |
| BenefitComparison | Differences and reconciliation status |
| DiagnosticHypothesis | Proposed explanation and supporting evidence |
| SourceDocument | Original document and provenance |
| ActuarialDecision | Disposition, rationale, reviewer, and date |
| CalculationRun | Rule version, input snapshot, and reproducibility metadata |

Use immutable source records where practical.

Store original imported values separately from normalized or corrected values.

Include an event or revision mechanism so that a correction never silently destroys the previous calculation basis.

All source records must permit precise references to their original location, such as a PDF page, spreadsheet cell, document section, or census-file row.

### Input formats

Support at least:

* CSV.
* XLSX and XLSM, with macros neither executed nor modified.
* Structured JSON.
* Historical participant data extracts.
* Prior administrator benefit calculation schedules.
* User-entered plan provisions and documented exceptions.

The data model must also accommodate information not contained in the participant census.

Examples include covered compensation tables, Social Security assumptions, plan-wide salary definitions, benefit formula constants, historical statutory limits, prior annuity conversion assumptions, and historical actuarial valuation data.

## 7. Comprehensive input validation

Implement layered validation.

Structural validation: Confirm file integrity, unique identifiers, valid field names, permitted types, required inputs, valid dates, and correct units.

Participant-level validation: Evaluate chronological consistency, employment periods, participation eligibility, service limits, missing compensation, possible duplicate participant records, and consistency between reported statuses and benefit amounts.

Cross-field validation: Determine whether the combination of age, service, compensation, status, benefit amount, and dates is plausible under the applicable plan provisions.

Longitudinal validation: Reconcile records across valuation dates and participant statuses, distinguishing legitimate changes from inconsistencies requiring investigation.

Cross-source validation: Reconcile census data with prior actuarial valuation reports, historical benefit schedules, payment records, and other available evidence.

Use applicable PBGC and BCV predicates where documented, but distinguish official validation rules from application-specific analytical tests.

Each validation result must identify:

* Rule identifier and source.
* Fields examined.
* Actual and expected conditions.
* Severity.
* Observed discrepancy.
* Recommended investigation.
* Whether the discrepancy blocks a calculation.

Do not replace missing input data with zero unless the governing rule explicitly requires that treatment.

## 8. Deterministic calculation engine

Develop a reproducible actuarial engine whose core calculations are independent of the user interface, file system, and database.

Separate calculations into stages:

1. Identify applicable plan provisions.
2. Determine participation and service eligibility.
3. Determine the applicable service measures.
4. Calculate compensation measures.
5. Calculate the applicable base benefit formula.
6. Apply historical accrual, grandfathering, and protection provisions.
7. Apply relevant plan and statutory benefit restrictions.
8. Apply prescribed rounding.
9. Express the result in the required normal-retirement benefit basis.
10. Reconcile the result with the reported administrator amount.

Each intermediate calculation must be inspectable.

For exact benefit calculations, use decimal-safe arithmetic, integer minor monetary units where appropriate, or another verified numerical representation.

Do not allow ordinary binary floating-point artifacts to affect monetary rounding.

Separate legally prescribed assumptions from exploratory assumptions.

The engine must support calculation at scale and permit selective recalculation of affected participants when source data or plan provisions change.

## 9. Rounding and numerical reconciliation

Rounding may explain differences between recorded and reconstructed benefits.

Implement configurable rounding rules for:

* Compensation.
* Average compensation.
* Credited service.
* Accrual percentages.
* Social Security offsets.
* Intermediate benefit components.
* Retirement factors.
* Actuarial equivalence factors.
* Final monthly benefits.

Support rounding after individual operations, annual accruals, intermediate results, or final calculations when the plan or available evidence requires such treatment.

Do not assume that one rounding methodology applies to all plans.

The system should evaluate alternative plausible rounding sequences as diagnostic hypotheses and quantify their effects.

A successful numerical match obtained by arbitrary changes to rounding conventions must not be treated as proof of the administrator’s actual methodology.

## 10. Benefit reconciliation and discrepancy analysis

For each participant, define:

Δ_i = B_i^PA − B̂_i

where:

* B_i^PA is the prior administrator’s recorded accrued monthly benefit.
* B̂_i is the independently reconstructed benefit on the same basis.

Calculate absolute and relative differences:

D_i = |Δ_i|

R_i = Δ_i / B̂_i

Evaluate relative differences only when the denominator is meaningful. Flag zero and near-zero denominator cases rather than producing unstable ratios.

Reconciliation must use configurable, documented tolerances.

Do not impose an arbitrary universal dollar or percentage tolerance.

Investigate possible explanations, including:

* Different measurement dates.
* Different credited service.
* Different compensation histories.
* Alternative compensation averaging periods.
* Incorrect or different accrual rates.
* Historical plan amendments.
* Grandfathered benefit floors.
* Service or compensation caps.
* Benefit freezes.
* Social Security integration.
* Previously paid distributions.
* Vesting percentage applied twice or omitted.
* Different annuity forms.
* Different retirement dates.
* Rounding at different stages.
* Missing information.
* Prior administrator calculation errors.

The system must be capable of generating and testing explicit counterfactual hypotheses.

For example, determine whether a discrepancy disappears if credited service is changed by one year, an alternative compensation averaging period is selected, or a documented historical formula is applied.

Rank hypotheses according to evidence and explanatory power, not merely numerical proximity.

Distinguish an explanation supported by source documents from a numerical coincidence.

## 11. Statistical analysis and anomaly detection

Implement a comprehensive statistical analysis module.

### Descriptive statistics

Provide:

* Counts by participant status and demographic group.
* Means, medians, standard deviations, and quantiles.
* Absolute and relative discrepancy distributions.
* Root mean squared error and mean absolute error.
* Frequency distributions by materiality threshold.
* Missing-data patterns.
* Results by formula type, plan amendment cohort, and other relevant groups.

### Outlier detection

Investigate:

* Robust z-scores using the median and median absolute deviation.
* Interquartile-range methods.
* Percentile-based screening.
* Multivariate anomaly detection.
* Model residual diagnostics.
* Group-specific and cohort-specific outliers.

Outliers must be investigated, not automatically corrected.

The application should avoid classifying legitimate differences among formula groups as errors merely because those differences are statistically unusual in the pooled population.

### Multivariate modeling

Explore appropriately justified models such as:

* Robust linear regression.
* Regularized regression.
* Generalized additive models.
* Mixed-effects or hierarchical models.
* Bayesian models when useful.
* Interpretable classification models for recurring discrepancy patterns.

Candidate explanatory variables include age, service, compensation, employment group, retirement status, benefit formula, historical amendment cohort, data completeness, and time since the recorded benefit was calculated.

Evaluate model fit, predictive performance, uncertainty, sample size, and sensitivity to influential observations.

Prevent data leakage and overfitting.

Make clear that a statistical model estimates patterns or suggests hypotheses; it does not establish the participant’s legally correct accrued benefit.

### Heuristics

Research industry rules of thumb that may assist with preliminary screening and complexity assessment.

Examples might include plausible benefit-to-compensation ratios, approximate accrual patterns, service sensitivity, and expected changes under particular formulas.

Each heuristic must be identified as a heuristic and supported by an appropriate reference or empirical basis.

Do not invent industry standards.

A heuristic must never override the governing plan formula.

## 12. Missing-data analysis and uncertainty

Implement a framework for assessing whether missing inputs materially affect the verification decision.

Distinguish:

* Data required for exact reconstruction.
* Data that can be recovered from other documents.
* Data for which reasonable bounds can be established.
* Data requiring actuarial assumptions.
* Data whose absence makes reconstruction indeterminate.

Apply scenario analysis and sensitivity analysis.

Where justified, produce lower and upper benefit bounds:

B_i^min ≤ B_i^possible ≤ B_i^max

These must be mathematically justified bounds under explicit assumptions, not merely statistical confidence intervals relabeled as guaranteed bounds.

The prior administrator’s reported benefit can then be evaluated against the feasible range.

Report how each missing input contributes to uncertainty.

Support prioritization of additional data requests according to the expected effect on the actuarial decision.

## 13. Projections and benefit-date normalization

Provide calculations at relevant past, current, and future dates.

Separate the following operations:

* Reconstructing an accrued benefit at a historical date.
* Calculating the accrued benefit at DOPT.
* Projecting hypothetical future accruals.
* Expressing a fixed accrued benefit as payable at a later commencement date.
* Applying early- or late-retirement adjustments.
* Converting benefit forms.

Do not automatically project service or compensation beyond a valid freeze or termination date.

Historical benefit reconstruction and hypothetical projections must be visibly distinguished.

For each projection, display the assumptions and the governing dates.

Provide graphical representations of the accrued benefit over time, including amendment dates, freezes, service changes, and other material events.

## 14. Actuarial acceptance framework

Develop a transparent decision-support process.

Suggested analytical dispositions include:

* Verified: Independent calculation agrees with the reported amount within the applicable documented tolerance.
* Supported for acceptance: Available evidence supports accepting the administrator’s benefit despite incomplete reconstruction.
* Requires investigation: Material discrepancies or missing evidence remain unresolved.
* Correction recommended: Sufficient evidence supports a specific corrected accrued benefit.
* Indeterminate: The evidence is insufficient to establish a defensible conclusion.

These categories are proposed application states, not representations of official PBGC classifications.

The final decision must be made and approved by an authorized human reviewer according to applicable PBGC procedures.

Each determination must document:

1. Recorded administrator benefit.
2. Independently calculated benefit, if available.
3. Comparison basis and applicable plan provisions.
4. Differences and their possible explanations.
5. Missing evidence.
6. Material assumptions.
7. Sensitivity and uncertainty.
8. Supporting documents and precise citations.
9. Recommended disposition.
10. Human determination, rationale, reviewer, and date.

An inability to reconstruct a historical benefit exactly is not, by itself, proof that the administrator’s benefit is erroneous.

Likewise, numerical agreement is not sufficient proof of legal or actuarial correctness if the underlying calculations use incorrect provisions.

## 15. Reporting and visualizations

Generate professional actuarial reports at both the plan and participant levels.

### Plan-level report

Include:

* Executive summary.
* Population and data completeness.
* Formula and provision complexity.
* Historical administrative data quality.
* Validation findings.
* Reconciliation statistics.
* Material discrepancy counts.
* Analysis by employment group and status.
* Outlier analysis.
* Statistical model diagnostics.
* Uncertainty and missing-data analysis.
* Recommended actuarial actions.
* Outstanding questions and data requests.

### Participant-level report

Include:

* Relevant input data and sources.
* Applicable plan provisions.
* Recorded benefit and its documented basis.
* Independent calculation trace.
* Historical events affecting the benefit.
* Numerical comparison.
* Diagnostic hypotheses.
* Missing information.
* Recommended actuarial determination.
* Supporting evidence and reviewer annotations.

### Visualizations

Support interactive:

* Histograms.
* Scatterplots.
* Boxplots.
* Residual plots.
* Cohort comparisons.
* Historical benefit timelines.
* Missingness heatmaps.
* Correlation diagnostics.
* Sensitivity plots.
* Outlier rankings.
* Benefit-reconciliation waterfall charts.

Charts must use clearly defined denominators, units, dates, and participant populations.

Allow filtering, drill-down, and export.

Export the results as CSV, XLSX, printable PDF or HTML, and a structured machine-readable analysis package.

Reports must remain reproducible from the retained input snapshot and approved rule versions.

## 16. Application architecture and technology assessment

The application must run entirely offline on a restricted PBGC workstation.

Assume:

* Windows and Microsoft Edge.
* No internet access.
* No external server.
* No installation of Python, Node.js, or other development tools.
* No elevated administrator privileges.
* No network API calls.
* No external processing of personally identifiable information.

Development and compilation may occur on a separate authorized machine.

The office deployment must not require development tools.

### Architectural candidates

Evaluate the following options:

Option A — TypeScript/JavaScript

A standalone browser application using deterministic JavaScript calculations and locally bundled numerical libraries.

Option B — Rust and WebAssembly

A browser user interface with a Rust/WASM calculation engine for performance-intensive actuarial and statistical processing.

Option C — Hybrid architecture

TypeScript for the application interface and orchestration, Rust/WASM for selected calculation kernels, and an embedded analytical storage layer.

Evaluate C++/WebAssembly only if it offers a demonstrable advantage over these approaches.

Investigate SQLite-WASM, DuckDB-WASM, embedded statistical routines, and WebR as candidate components, not predetermined dependencies.

### Technical evaluation criteria

Compare alternatives according to:

* Numerical accuracy.
* Computational speed.
* Memory requirements.
* Offline compatibility.
* Support under file://.
* Dependency size.
* Reproducibility.
* Ease of testing.
* Maintainability.
* Statistical functionality.
* Data persistence.
* Security.
* Deployment complexity.

Browser constraints must be investigated explicitly.

In particular, do not assume that worker-based WebAssembly databases, OPFS persistence, multithreaded execution, dynamically loaded WASM modules, or external browser packages work under file://.

Conduct a small proof of concept in an environment matching the restricted workstation before committing to a component that depends on these capabilities.

Prefer a single self-contained HTML deliverable, with all required resources embedded, if it can satisfy the application’s computational and functional requirements.

If a technically necessary capability cannot operate reliably under that restriction, document the limitation and identify the smallest authorized alternative.

### Separation of responsibilities

Use a modular architecture comprising:

1. Source ingestion.
2. Schema and validation.
3. Plan provision modeling.
4. Temporal benefit calculation.
5. Numerical reconciliation.
6. Statistical analysis.
7. Actuarial decision support.
8. Visualization and reporting.
9. Local persistence and export.
10. Audit and provenance management.

Core calculations must remain independent of user-interface and storage implementations.

## 17. State-driven computational design

Treat the application as a system that evolves through explicit, auditable state transitions.

Define:

S_{t+1} = T(S_t, E_t)

where:

* S_t is the complete case-analysis state.
* E_t is a user action, source update, rule revision, or calculation event.
* T is a defined state transformation.

Identify the system’s invariants before implementation.

Examples:

* Original source observations remain unchanged.
* A calculation is reproducible from its inputs and rules.
* Benefit quantities retain their units and measurement bases.
* A rule cannot apply outside its documented applicability conditions.
* Unverified statistical results cannot automatically become approved participant benefits.
* Updating one participant must not silently change unrelated participants.
* Every approved determination retains its supporting evidence.

Separate pure calculations from file input/output, persistence, UI interaction, and other side effects.

Use explicit, versioned data transformations instead of hidden mutable state.

## 18. User interface

Develop a professional, accessible analytical workbench.

The workflow should guide the actuary through:

1. Create or open a case.
2. Import source data.
3. Map fields and validate inputs.
4. Define or import plan provisions.
5. Establish historical provision periods.
6. Run independent calculations.
7. Review reconciliations.
8. Investigate discrepancies and outliers.
9. Document actuarial determinations.
10. Generate the final report and export the case package.

Use a guided wizard with an advanced analytical interface for detailed investigations.

Provide a true dark theme by default:

* Black background.
* Soft off-white text.
* Restrained accent colors.
* High readability.
* Compact, consistent navigation.

Include a theme toggle.

Present formulas in readable mathematical notation where useful.

Support search, filtering, sorting, and participant-level drill-down.

The application must explain findings in precise actuarial language without obscuring the underlying calculations.

## 19. Security and privacy

The application will potentially process protected participant information.

Require:

* Local-only processing.
* No telemetry.
* No external analytics.
* No remote error reporting.
* No automatic uploads.
* No CDN dependencies.
* No unapproved network access.
* Explicit control of file import and export.

Use fictional participant records for development and automated testing.

Never transfer actual PBGC participant data to external systems.

Implement data minimization, redaction where appropriate, and clear warnings before exporting sensitive information.

Do not claim that browser storage provides encryption or durable protection without verifying those properties.

## 20. Verification and testing

Develop deterministic unit tests, integration tests, statistical tests, and offline browser tests.

Test at least:

* Every supported benefit formula.
* Historical plan amendments.
* Grandfathered and frozen benefits.
* Multiple employment periods.
* Short-service and long-service participants.
* Missing historical compensation.
* Historical benefit amounts with unknown dates.
* Different rounding conventions.
* Service-credit errors.
* Social Security integration and offsets.
* Cash balance conversions.
* Incorrect or duplicated vesting adjustments.
* Reported benefits above or below independently reconstructed values.
* Statistically unusual but valid benefits.
* Incorrect records that appear statistically ordinary.

Construct synthetic test cases with independently verified expected results.

Where the application’s implementation reproduces a documented example, cite the source and distinguish that from an independently derived test case.

Test statistical procedures against trusted reference calculations.

Include property-based tests for mathematical invariants and regression tests for previously identified errors.

Verify that the complete application works without internet access and without office installation privileges.

Do not claim production readiness solely because unit tests pass.

## 21. Performance requirements

Benchmark representative fictional plan populations containing:

* 100 participants.
* 1,000 participants.
* 10,000 participants.
* 100,000 participants.

Measure:

* Import time.
* Data validation time.
* Initial actuarial calculation time.
* Reconciliation time.
* Statistical analysis time.
* Memory consumption.
* Report generation time.
* Incremental recalculation performance.

Define realistic acceptance thresholds after measuring the baseline implementation.

Optimize only after profiling demonstrates a significant bottleneck.

Preserve numerical correctness and interpretability when optimizing.

## 22. Required project deliverables

Produce:

1. Source-document inventory with provenance.
2. Actuarial requirements specification.
3. Formula taxonomy and mathematical specification.
4. Historical plan-provision data model.
5. Canonical input schema and data dictionary mappings.
6. Validation-rule catalog.
7. Deterministic benefit calculation engine.
8. Reconciliation and diagnostic engine.
9. Statistical analysis module.
10. Complete browser user interface.
11. Interactive reports and export functions.
12. Automated test suite and fictional test datasets.
13. Offline deployment package.
14. User manual.
15. Technical documentation.
16. Comprehensive GitHub README.md.
17. Development status and acceptance-test checklist.

The deliverable must be a functioning application, not merely a prototype design or collection of proposed formulas.

## 23. Development procedure

Proceed through the following stages:

Stage 1 — Source research

Inventory and analyze the governing material. Establish the formula taxonomy, legal considerations, input requirements, and areas of uncertainty.

Stage 2 — Mathematical and data architecture

Define the data structures, calculation functions, validation predicates, decision states, and invariants.

Stage 3 — Technology feasibility

Evaluate the proposed technology stacks and verify the critical offline browser requirements through executable proof-of-concept tests.

Stage 4 — Deterministic actuarial engine

Implement and validate the mathematical foundations before developing elaborate presentation features.

Stage 5 — Reconciliation and statistical engine

Add discrepancy diagnostics, uncertainty analysis, robust statistical models, and anomaly detection.

Stage 6 — User interface and reporting

Integrate the modules into a usable case-analysis workflow.

Stage 7 — End-to-end verification

Execute synthetic numerical benchmarks, browser compatibility checks, and full offline acceptance tests.

Stage 8 — Release

Deliver the complete application with documentation, release version, tested capabilities, and unresolved limitations.

Do not interrupt development for routine technical decisions that can be resolved from the specifications or source documents.

Use professional judgment but do not silently decide unresolved legal interpretations or invent missing actuarial assumptions.

Maintain a concise record of design decisions and testing results.

## 24. Initial assignment

Begin by examining the Google Drive source collection and preparing four interdependent technical outputs:

1. Actuarial formula classification: Identify all materially distinct accrued-benefit calculation methods relevant to PBGC case processing, with mathematical expressions, applicability conditions, and source references.
2. Data requirements and validation specification: Define the minimal and comprehensive input datasets, including historical non-census inputs, data completeness grades, and validation predicates.
3. Reconciliation and statistical methodology: Develop a systematic method for comparing prior administrator benefits against reconstructed values and explaining differences, including missing-data uncertainty and outlier detection.
4. Architecture decision: Evaluate the optimal computational stack for a large, strictly offline, browser-based actuarial application and recommend a tested architecture.

Use these outputs to begin implementation.

Ultimate objective: Provide PBGC case actuaries with a mathematically rigorous, evidence-based, reproducible system for analyzing and documenting the acceptance, correction, or rejection of accrued monthly benefits reported by prior pension plan administrators.

---
*Saved from the user's message, 2026-11-12. This is the governing spec for the PA_AMB analysis project.*
