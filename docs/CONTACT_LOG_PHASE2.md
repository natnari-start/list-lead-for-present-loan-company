# Phase 2: structured employee contact notes

This feature changes the existing contact dialog and protected contact creation.
It is a CRM recording proposal, not a bank form, a credit decision or consent evidence.
No external AI, audio recording, document upload or task creation is introduced.

## Storage

The existing 15 headers remain unchanged. Column O stores a JSON object with the
namespace `crmContactV1` and `version: 1`. Optional fields are `fundingPlan`,
`answers`, `quality`, `qualityNote`, `documentStage` and `callback`.
The five answer keys are `businessType`, `monthlySales`, `currentLoans`,
`newLoansSixMonths` and `ownership`. Text is employee-entered, never calculated.
The eight quality keys are `entity`, `businessAge`, `financialResults`, `equity`,
`directors`, `margin`, `revenue` and `serviceArea`. Unknown is the UI default;
failed employee observations do not block a contact save or change a loan case.
Document stages are explicit employee selections, with no automatic task or case update.

The create endpoint validates JSON shape, version, enum values, field lengths,
calendar dates and compatibility with the contact outcome before any write.
Short outcomes omit hidden business data. No existing history JSON is updated.
`mergeBusinessJson` preserves unrelated legacy keys and refuses to overwrite an
existing namespace or silently convert malformed/scalar/array legacy data.
The existing legacy contact editor continues to hide and preserve raw JSON.
No migration or new column is required by this change.

## Drafting and review

Drafting runs locally only after an explicit button click. Only entered answers
are included. The preview is editable; applying replacement text requires
confirmation. Save writes the reviewed text without re-running the template.
Changing draft inputs after applying a generated draft requires re-review or
manual text editing before a full/callback contact can be saved. Empty answer
fields are not interpreted as zero sales, no loans or permission.

## Source references and limits

User-provided internal Team.Su posters supply question/category labels only.
The business-age poster conflicts: its criterion says 8 years, its mnemonic
says 6 years. The UI shows the conflict and makes no automatic eligibility choice.
Poster product amounts, rates and terms are not used as defaults or promises.
Selling Guideline All Product V.022026 supplies Call Verify and escalation guidance;
the employee must verify the correct role/channel with TM before escalating.
The application does not claim a number has been blocked in the bank system.

## Validation and phase boundary

Run `npm run verify:prelive`: build, executable unit/backend/DOM tests,
synthetic/Production test-definition validation and public-source checks.
Run a scoped strict TypeScript check for the contact components with temporary
declarations for the platform-injected client SDK. Repository-wide `tsc` has
pre-existing App.tsx typing/unused-symbol errors and absent injected SDK types;
do not claim that a full repository typecheck passes.
The DOM/backend tests cover structured JSON round-trip, legacy preservation,
duplicate/replayed/lost-response requests, auth/ref validation, editable preview,
overwrite cancellation, failed-write input retention and hidden-field omission.

Deploy and write QA only to the existing synthetic app/workbook. The owner
confirmed its spreadsheet binding in this conversation; the connector cannot
independently read encrypted secret values. Verify the rendered app and read
the appended synthetic record back through Sheets. Record actual mobile viewport
results separately from physical-device certification and test definitions.

Do not deploy Production, run Production migration, write Notion or merge main
as part of Phase 2. Any Production release requires separate approval of the
exact commit, destination, migration scope, snapshot and rollback.
