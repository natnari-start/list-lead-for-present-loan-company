# Manual Google contact-search result

The customer-name cell includes a separate native checkbox labelled exactly
`seach google ไม่พบข้อมูลช่องทางติดต่อ`. Checking it records a human finding;
opening Google or leaving contact fields empty never marks it automatically.
Unchecking removes the mark and does not assert that contact details were found.

## Data contract

- Append `ค้นหา Google ไม่พบช่องทางติดต่อ` after the existing customer headers.
  The current 52-column schema becomes 53 columns (new column BA).
- Existing columns, record identifiers and linked tabs stay in their original positions.
- The app/API use `TRUE` and `FALSE` strings. The backend writes a native Boolean
  cell using RAW input, and reads it back as a normalized string. Legacy blanks
  are unmarked. Native checkbox validation may initialize the new cells as FALSE;
  the original customer columns are not rewritten.
- The field is editable in the existing customer form, displayed in the full
  profile and included in CSV export. Only the new status changes on row toggle.
- The existing authenticated admin route validates values, verifies headers,
  locates the stable customer ID and compares `expectedValues` before writing.
  This is an optimistic stale-read check, not an atomic Google Sheets transaction:
  Sheets has no compare-and-swap for a values write, so a narrow simultaneous
  external-edit window remains. Duplicate IDs and detected stale rows fail closed.

## Explicit migration (never on app startup or deployment)

1. Back up the target workbook and pause edits during migration. Confirm the
   target in the secret manager. First rehearse against the synthetic test sheet.
2. In a trusted admin terminal, inject `GOOGLE_SERVICE_ACCOUNT_JSON` and
   `GOOGLE_SPREADSHEET_ID` securely as environment variables. Do not paste their
   values into shell history, chat, repository files or logs. This script cannot
   read AppDeploy's encrypted secrets automatically; use approved local secret
   injection or apply the pure plan through the connected Sheets administrator.
3. With Node 22.18+ run the read-only preflight:

   ```sh
   node --experimental-strip-types scripts/migrate-contact-search.mjs
   ```

4. After checking the target and approving its maintenance window, apply:

   ```sh
   node --experimental-strip-types scripts/migrate-contact-search.mjs --apply
   ```

5. Run it again. It must report `Already migrated; no changes made.`
6. Check the original headers and values, the new header and native BOOLEAN
   validation, plus the visible header/checkbox layout. If a native customer
   table covers only part of the registry columns, extend that same table's
   range to include the full schema width before allowing status edits. Preserve
   its existing row bounds, column properties and banding; verify no unrelated
   table or banding overlaps. This keeps the flag with its customer when the
   native table is sorted. The header planner does not perform this table edit.
7. Deploy the matching application version only after the sheet header/table is
   ready, then confirm the integration status recognizes all five tabs.

The pure planner in `scripts/contact-search-migration.mjs` is shared with tests.
It refuses altered/duplicated headers or an occupied target column. It appends
only if needed, copies just the neighboring header format, writes one header,
adds checkbox validation and sizes only the new column. Repeating the completed
migration performs no writes. No new backend migration endpoint is exposed.

## Production release boundary and rollback

Production migration and deployment are separate owner-authorized actions.
Do not deploy this 53-column source against the old 52-column sheet: strict
header checks will stop loading. Verify the current source and back up the sheet
before applying the append-only migration, then deploy the matching source.

The production v9 snapshot (1792809757187) was inspected before release: its
header/data ranges end at the old schema width and its writes target only changed
cells. It ignores a new trailing BA column, so this specific version can continue
reading the original 52 columns while the new field is added. Avoid concurrent
structural edits and refresh open clients after deployment. Do not assume this
compatibility for another version without checking its source and headers.

Keep the pre-release app snapshot and private native sheet backup. For this
append-only release, restoring the verified v9 app can leave BA and any recorded
flags intact; do not automatically delete or restore customer data during an app
rollback. Sheet restoration is a separate owner-authorized recovery step. For
other rollback versions, verify header-range compatibility first and preserve
new flag values before any approved column removal or restoration.

## Verification boundaries

Unit tests cover encoding, stable-ID payloads, migration refusal/idempotency,
protected backend validation and one-cell writes. DOM interaction tests cover
pending/error/conflict handling and duplicate names. Live persistence and mobile
checks must be reported separately with their actual environment and evidence.
Test definitions are instructions, not proof they ran. Production smoke checks
inspect the control without changing real customer values.
