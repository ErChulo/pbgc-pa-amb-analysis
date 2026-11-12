# Defined Benefit Accrued Benefit Formula Taxonomy

Reference specification for an actuarial calculation engine

## 1. Base Benefit Formulas

### 1.1. Flat or Fixed Benefit Formulas

* Fixed monthly dollar benefit
* Fixed annual dollar benefit
* Fixed percentage of compensation
* Fixed benefit prorated by credited service
* Fixed benefit subject to service thresholds

Source: DB Answer Book, Chapter 3, Q 3:25; Chapter 9, Q 9:3.

### 1.2. Unit-Credit Benefit Formulas

* Fixed dollar amount per year of credited service
* Percentage of compensation per year of credited service
* Two-step unit-credit formulas
* Tiered accrual-rate formulas
* Different accrual rates for different service periods

Source: Chapters 9 (Q 9:4, 9:10), 10 (Q 10:25).

### 1.3. Salary-Related Benefit Formulas

* Final-average compensation
* Highest-average compensation
* Career-average compensation
* Fixed percentage of salary
* Salary-based unit-credit benefit
* Compensation averaging over specified years
* Compensation averaging over specified consecutive years
* Compensation averaging over highest-paid years

Source: Chapters 3, 9.

### 1.4. Social Security-Integrated Formulas

* Excess benefit formulas
    * Base accrual rate below integration level
    * Additional accrual above integration level
* Offset formulas
    * Social Security Primary Insurance Amount offset
    * Other permitted-disparity offset arrangements
* Covered-compensation integration
* Integration-level formulas
* Historical integration and offset provisions

Source: Chapter 9, Q 9:5–6; Chapter 10, Q 10:26–46.

## 2. Hybrid Defined Benefit Formulas

### 2.1. Cash Balance Plans

* Hypothetical account balance
* Principal or pay credits
* Fixed interest crediting rates
* Variable interest crediting rates
* Age- or service-dependent pay credits
* Opening account balances
* Account-to-annuity conversions
* Traditional-to-cash-balance conversions
* Protected preconversion accrued benefits

### 2.2. Pension Equity Plans

* Accumulated benefit credits
* Compensation-based benefit credits
* Age- or service-related credit schedules
* Final compensation-based account values
* Account-to-annuity conversions

### 2.3. Floor-Offset Arrangements

* Gross defined benefit formula
* Related defined contribution account offset
* Actuarial conversion of the offset
* Net defined benefit calculation
* Special treatment following a freeze

### 2.4. Combined Arrangements

* Defined benefit and defined contribution components
* Multiple benefit structures
* Separate benefit components and applicable offsets

Sources: Chapters 4 and 18.

## 3. Accrued Benefit Determination Methods

### 3.1. Fractional Accrual

* Projected benefit
* Completed benefit service
* Projected total benefit service
* Fractional service ratio
* Partial-year accrual

### 3.2. Unit-Credit Accrual

* Annual benefit accrual
* Cumulative accrued benefit
* Service-based benefit units
* Compensation-dependent accruals

### 3.3. Statutory Accrual Tests

* Three-percent rule
* 133⅓-percent rule
* Fractional accrual rule
* Multiple-formula accrual testing

Source: Chapter 9, Q 9:7–13.

Important: The statutory accrual tests are compliance requirements, not additional benefit formula types.

## 4. Formula Composition and Benefit Protections

### 4.1. Multiple-Formula Arrangements

* Greater of two or more benefit formulas
* Minimum benefit guarantees
* Additive benefit components
* Offsets against another benefit
* Formula-specific eligibility conditions

### 4.2. Historical Formula Changes

* Prior formula plus subsequent accruals
* Grandfathered accrued benefit
* Protected minimum benefit
* Historical fresh-start calculations
* Benefit formula replacement
* Different formulas by employment group
* Different formulas by service period
* Traditional-to-hybrid transitions
* Wear-away considerations

### 4.3. Plan Freezes

* Hard freeze
* Soft freeze
* Participation freeze
* Benefit accrual freeze
* Compensation freeze
* Continued service recognition
* Post-freeze benefit calculations

Sources: Chapters 9, 18, 26.

## 5. Service-Related Formula Parameters

* Eligibility service
* Vesting service
* Benefit accrual service
* Years of participation
* Elapsed-time service
* Hours-of-service methods
* Partial-year credit
* Service caps
* Past-service credits
* Excluded service periods
* Breaks in service
* Rehire and service restoration
* Employment-group-specific service

Sources: Chapters 6–9.

## 6. Compensation-Related Formula Parameters

* Base compensation
* Total eligible compensation
* Final-average compensation
* Highest-average compensation
* Career-average compensation
* Annual compensation caps
* Excluded compensation components
* Compensation measurement periods
* Historical salary adjustments
* Covered compensation
* Compensation following plan amendments
* Historical IRC §401(a)(17) limitations

Sources: Chapters 9 and 10.

## 7. Statutory and Plan Limitations

* IRC §415 benefit limitations
* IRC §401(a)(17) compensation limits
* Top-heavy minimum benefits
* Accrual restrictions
* Plan-specific maximum benefits
* Plan-specific minimum benefits
* Protected accrued benefits
* Mandatory employee-contribution benefits
* Previously distributed benefit offsets
* Historical limitation changes

Sources: Chapters 9, 12, 22.

## 8. Benefit Normalization and Conversion

* Annual-to-monthly benefit conversion
* Normal retirement age determination
* Normal form of benefit
* Early-retirement adjustment
* Late-retirement adjustment
* Actuarial equivalence
* Annuity-form conversion
* Employee-contribution annuity conversion
* Cash balance account-to-annuity conversion
* Historical actuarial assumptions
* Rounding of intermediate calculations
* Rounding of the final monthly benefit

Sources: Chapters 9, 18, 21.

## 9. Calculation Engine Requirements

Implement the above as composable, effective-dated actuarial operations, not as one separate program for every possible plan formula.

The general calculation model should be:

[
\boxed{
AMB_i(t)=
\operatorname{Normalize}
\left(
\operatorname{Limit}
\left(
\operatorname{Protect}
\left(
\operatorname{Compose}
\left(
F_1,F_2,\ldots,F_n
\right)
\right)
\right)
\right)
}
]

All operations depend on the participant, applicable plan provisions, historical data, and measurement date.

For each operation, preserve:

* Mathematical formula and required parameters
* Units and benefit measurement basis
* Eligibility and applicability conditions
* Effective dates
* Governing plan and statutory references
* Intermediate values
* Applicable rounding rules
* Exceptions and unresolved inputs

Design constraint: Formula types, accrual methodologies, service definitions, compensation definitions, historical protections, statutory limits, and annuity conversions must remain independent, reusable modules.

Scope constraint: The taxonomy covers accrued-benefit determination. PBGC guarantee limitations and termination-benefit calculations must remain separate downstream calculations.

---

## Primary References

Defined Benefit Answer Book, 2024 edition:

* Chapter 3 — Plan Design
* Chapter 4 — Hybrid Plans
* Chapter 6 — Eligibility, Coverage and Participation
* Chapter 7 — Measuring Service
* Chapter 8 — Vesting
* Chapter 9 — Plan Benefits / Accrued Benefits
* Chapter 10 — Safe Harbor Benefit Formulas
* Chapter 12 — Maximum Plan Benefits
* Chapter 18 — Cash Balance Plans
* Chapter 21 — Distribution of Benefits
* Chapter 22 — Funding-Based Restrictions
* Chapter 26 — Frozen Defined Benefit Plans

This is an implementation-oriented taxonomy. The main formula families are grounded in the cited chapters; detailed subdivisions and the modular architecture are engineering classifications derived from them, rather than a single formal classification published in the book.

Key architectural principle: A given plan may combine several branches simultaneously. The LLM should therefore build a formula composition engine, not a collection of mutually exclusive formula calculators.
