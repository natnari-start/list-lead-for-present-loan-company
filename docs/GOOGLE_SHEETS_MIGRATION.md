# Google Sheets integration status

## Current state

The deployed AppDeploy snapshot is `1792637669571` (22 Oct 2026). The application reads live records from the native Google Sheet through server-side Google Sheets API calls. The frontend has no Sandbox fallback when the Google connection fails.

The app supports editing existing rows through `PUT /api/records/:part/:id`. Record IDs are immutable, task formula columns are protected, input values are validated, and stale edits are rejected if the row changed after it was loaded. Create and delete routes are disabled.

Service-account access was checked through Google Drive permissions: the service account has the `writer` role, equivalent to Editor. A live write test has not been run because it would require changing a real customer row; no customer data was altered during the permission check.

## Backend configuration

Set these values through AppDeploy's encrypted secret-entry flow. Do not include them in this public repository or frontend bundle.

- `ADMIN_EMAILS`: admin allowlist, as a JSON string array or a comma/newline-delimited list.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: full service-account JSON. The backend reads it only to create a short-lived Google OAuth token.
- `GOOGLE_SPREADSHEET_ID`: target spreadsheet ID. The backend validates and reads it as a secret; it is not hardcoded in the public source.

Missing secrets fail closed. The data API does not return demo data as a fallback.

## Sheets and relationships

The app expects these tabs and headers, as defined in `src/schema.ts`:

- `ทะเบียนลูกค้า`
- `เคสสินเชื่อ`
- `ประวัติการติดต่อ`
- `งานติดตาม`
- `รายการเอกสาร`

Customer IDs connect cases, contacts and follow-up tasks. Case IDs connect documents and optional case-related contact/task records. One customer can have multiple cases. Editing a customer does not delete linked rows.

## Verification completed

- Live Sheet metadata and expected tab headers were checked through the app integration status endpoint.
- The service-account permission metadata reports `writer`.
- AppDeploy snapshot `1792637669571` reached `ready`; the stored QA snapshot had no frontend or network errors.
- UI editor was opened and canceled; the identifier was read-only, and cancel caused no write.
- No actual write request against customer data has been used as a permission test.

## CI scope

GitHub preflight checks the Vite build, existing unit tests, AppDeploy E2E test-file schema and public-source secret rules. It does not replace AppDeploy backend execution or a controlled write test against an approved test row.
