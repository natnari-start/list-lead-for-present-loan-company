# Google Sheets migration status

## Current state

The deployed app currently uses AppDeploy's database. The attached workbook is an XLSX schema reference with seven tabs. It is not a verified native Google Sheets URL or database connection. No live Sheet ID or Google API credentials are configured in this repository.

## Required before implementation

1. Confirm the exact native Google Sheets file that will be the system of record.
2. Inspect tab names, header rows, formulas, validation, and protections without exposing row values in logs or GitHub.
3. Choose an approved server-side authentication method for the app runtime and grant only the access required.
4. Store credentials in the platform's encrypted secret store. Never put credentials, private Spreadsheet IDs, or customer rows in frontend code or this public repository.
5. Back up the target sheet and validate a schema mapping with synthetic records before enabling writes.
6. Define rollback and avoid dual-writing to AppDeploy DB and Sheets unless consistency handling and reconciliation are implemented and tested.

## Schema observations

The workbook contains: ทะเบียนลูกค้า (52 columns), เคสสินเชื่อ (16), ประวัติการติดต่อ (15), งานติดตาม (11), รายการเอกสาร (10), วิธีใช้ (2), and ข้อมูลนำเข้า_43210 (18).

The AppDeploy snapshot's contact-history schema had 14 columns. The source-sync branch adds the missing final field, รายละเอียดธุรกิจจากการติดต่อ (JSON), and validates non-empty values as JSON. No workbook row values were copied.

## Storage boundary

`backend/storage-port.ts` defines a backend-neutral storage contract. `backend/mock-storage.ts` provides an in-memory implementation for synthetic tests only. The mock is not connected to production routes and does not persist data. The current backend still uses AppDeploy DB.

## Data relationships to preserve

- Customer ID joins the customer register to cases, contacts, and follow-up tasks.
- Case ID joins cases to documents and optional contact/task records.
- One customer may have multiple cases.
- Editing a customer must not overwrite contact history or delete linked records.
- Dashboard amounts must aggregate at case grain, and customer counts must use unique customer IDs.
- Completed and cancelled tasks must not be shown as overdue.

## Not yet connected

There is no Google Sheets adapter, live Sheet ID, credential, migration, or write test in this branch. Keep the current AppDeploy repository as the active backend until the native Sheet and the server-side access method are confirmed and tested with synthetic data.
