# Contact history creation and local drafting

This release adds a protected contact-history create workflow to the existing
Google Sheets editor. It does not record audio, call an AI service, create tasks,
change customer contact permissions, or claim bank-approved consent evidence.

## Storage and form mapping

No header or column is added. `src/contact-log.ts` resolves all 15 contact fields
by their current header names. The server creates the contact ID. Customer and
case references are validated again on the protected POST route. New records
leave the existing business JSON field blank; the legacy editor hides its raw
JSON control and preserves the original JSON value on explicit edits.

Facts map to `สรุปข้อเท็จจริง`, confirmed agreements to `ข้อตกลงที่ยืนยันแล้ว`,
and pending suggestions to `ข้อเสนอ AI / รอตรวจ`. That existing header is retained
for compatibility even though this release uses local templates, not external AI.
The contact datetime is a Bangkok wall time regardless of browser or workbook
timezone, written as a native Sheets datetime serial and read back with seconds.
No new creation-time column is introduced.

Short outcomes can save the employee-selected outcome as the factual summary
without invented conversation details. Hidden agreements, suggestions and sales
sheet fields are not sent. A callback permission sentence appears only after the
employee explicitly selects its checkbox; it is not bank consent evidence.

## Idempotent create protocol

`POST /api/records` accepts only `part: contacts`, a UUID `requestId`, and the
15-value array with a null ID. The backend hashes the authenticated user ID and
request UUID to generate the stable contact ID and an opaque named-range receipt.
The receipt targets the contact header cell and contains no customer details.

One Sheets `spreadsheets.batchUpdate` adds the uniquely identified named range
and appends the native table row together. A duplicate receipt rejects the whole
batch, so racing requests on different workers cannot append twice. On retries
or a lost response, the backend reads the same contact ID and returns the existing
row. A different payload with that key is rejected; missing/duplicate rows require
review. Do not delete receipt named ranges independently of the associated data.

The dialog locks repeated submissions, retains input on error, and freezes an
ambiguous submission to retry the same payload. A successful create returns its
record directly; it does not depend on a subsequent all-data reload succeeding.
No application-specific customer IDs, sheet IDs or account emails are in this
runbook, fixtures or release notes.

Technical references:
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AddNamedRangeRequest
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AppendCellsRequest
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate

## Native table metadata migration

Inspect the live contact headers, native table range and all column properties.
`scripts/contact-log-migration.mjs` is a pure planner using that metadata. It only:

1. Expands an existing 14-column contact table to the existing 15-column schema,
   retaining its original row bounds and all other column properties.
2. Changes the contact/check datetime column types from DATE to DATE_TIME.
3. Adds the existing final JSON header as a TEXT table column when needed.

The planner adds no grid columns, writes no record values, and returns an empty
request list on already-compatible metadata. It refuses unexpected structures.
The create route uses the native table's append capability, preserving its typed
dropdown/date controls and automatically extending the table. For a plain sheet,
it appends complete cells with safe exemplar styles and validation; row-specific
links, rich chips and values are never copied.

Before Production migration, create and verify a private native workbook backup;
keep its link out of public GitHub. Preserve a private pre-migration cell snapshot
to verify record values have not changed. Apply the planner's exact scoped table
request, re-read headers/properties/values and confirm a second plan is empty.
No secret, permission or workbook timezone change is part of this release.

## QA and release sequence

1. Run `npm run verify:prelive` and inspect CI at the exact commit to deploy.
2. Deploy only changed runtime files to the existing synthetic app. Its
   `tests/tests.json` uses the repository's synthetic suite. Keep its existing
   mobile QA wrapper on that app only.
3. Use normal authenticated UI to create synthetic contacts for a known synthetic
   customer/case. Read back native values and table coverage, refresh in another
   view, and verify existing fixtures/tasks/customers did not change.
4. Unit tests exercise failed/ambiguous writes, concurrent replay, auth denial,
   invalid references, calendar validation and all six UI outcomes. Do not induce
   failures or write real customer rows to obtain Production evidence.
5. Verify the workbook backup and native metadata migration, then deploy the
   pinned source to the existing Production app. Map runtime `tests/tests.json`
   from repository `tests/production-smoke.json`; Production tests never POST.
6. Check AppDeploy ready state and errors since release, then authenticate and
   open/cancel the Production form. Report physical phone vs simulated viewport
   explicitly. Record actual results and limitations in GitHub/Notion.

Retain the pre-release AppDeploy snapshot for rollback. The previous reader can
still read the same 15 headers and datetime values; rollback disables creation
but does not require deleting new contacts or receipt metadata. Test any broader
data restore separately before using a backup. Main is not merged by this task.
