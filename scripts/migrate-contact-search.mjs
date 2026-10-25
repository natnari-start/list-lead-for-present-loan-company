import { createSign } from 'node:crypto';
import { schemas } from '../src/schema.ts';
import { planContactSearchMigration } from './contact-search-migration.mjs';

// Run in a trusted admin terminal with environment values injected securely.
// No credential, token, spreadsheet identifier or Google response body is logged.
const apply = process.argv.includes('--apply');
const allowed = new Set(['--apply']);
if (process.argv.slice(2).some(argument => !allowed.has(argument))) {
  console.error('Usage: node --experimental-strip-types scripts/migrate-contact-search.mjs [--apply]');
  process.exit(1);
}

function columnName(number) {
  let result = '';
  while (number > 0) {
    result = String.fromCharCode(65 + ((number - 1) % 26)) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim();
  let account;
  try { account = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''); }
  catch { throw new Error('Missing or invalid service-account environment configuration'); }
  if (!spreadsheetId || !/^[A-Za-z0-9_-]+$/.test(spreadsheetId) || !account.client_email || !account.private_key) {
    throw new Error('Missing or invalid migration environment configuration');
  }
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  let signature;
  try { signature = createSign('RSA-SHA256').update(payload).sign(account.private_key, 'base64url'); }
  catch { throw new Error('Invalid service-account signing configuration'); }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: payload + '.' + signature }),
  });
  if (!tokenResponse.ok) throw new Error('Migration authentication failed');
  const { access_token: token } = await tokenResponse.json();
  if (!token) throw new Error('Migration authentication returned no token');
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
  const request = async (suffix, body) => {
    const response = await fetch(base + suffix, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Migration Google API request failed with status ' + response.status);
    return response.json();
  };
  const spec = schemas.find(item => item.key === 'customers');
  const metadata = await request('?fields=sheets(properties)');
  const sheet = metadata.sheets?.find(item => item.properties.title === spec.sheetName)?.properties;
  if (!sheet || sheet.gridProperties.rowCount > 5000) throw new Error('Missing target tab or unsafe grid size');
  const quoted = "'" + spec.sheetName.replaceAll("'", "''") + "'";
  const header = await request('/values/' + encodeURIComponent(quoted + '!1:1'));
  const target = spec.headers.length;
  let targetCells = [];
  if (sheet.gridProperties.columnCount >= target) {
    const range = quoted + '!' + columnName(target) + '1:' + columnName(target) + sheet.gridProperties.rowCount;
    const cells = await request('?includeGridData=true&ranges=' + encodeURIComponent(range) +
      '&fields=sheets(data(rowData(values(userEnteredValue,dataValidation,chipRuns,note))))');
    const rows = cells.sheets?.[0]?.data?.[0]?.rowData || [];
    targetCells = Array.from({ length: sheet.gridProperties.rowCount }, (_, index) => rows[index]?.values?.[0] || {});
  }
  const options = { sheet, headers: header.values?.[0] || [], expectedHeaders: spec.headers, targetCells };
  const requests = planContactSearchMigration(options);
  if (!requests.length) { console.log('Already migrated; no changes made.'); return; }
  if (!apply) { console.log('Dry run passed: append the contact-search field and native checkbox validation. No changes made.'); return; }
  // Refresh both metadata and header immediately before applying the structural edit.
  const latest = await request('?fields=sheets(properties)');
  const latestSheet = latest.sheets?.find(item => item.properties.title === spec.sheetName)?.properties;
  const latestHeader = await request('/values/' + encodeURIComponent(quoted + '!1:1'));
  if (JSON.stringify(latestSheet) !== JSON.stringify(sheet) ||
      JSON.stringify(latestHeader.values) !== JSON.stringify(header.values)) {
    throw new Error('Sheet structure changed during migration; no changes made');
  }
  await request(':batchUpdate', { requests });
  const verified = await request('/values/' + encodeURIComponent(quoted + '!1:1'));
  if (planContactSearchMigration({ ...options, headers: verified.values?.[0] || [] }).length) {
    throw new Error('Migration verification failed');
  }
  console.log('Migration verified. Existing record values were not rewritten.');
}

main().catch(cause => {
  const message = cause instanceof Error && /^(Missing|Invalid|Migration|Existing|Target|Inspect|Sheet)/.test(cause.message)
    ? cause.message : 'Migration failed; inspect configuration and connectivity in the trusted terminal';
  console.error(message);
  process.exitCode = 1;
});
