import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheets = readFileSync(new URL('../backend/googleSheets.ts', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../backend/index.ts', import.meta.url), 'utf8');

assert.match(sheets, /secrets\.readSecret\(['"]GOOGLE_SPREADSHEET_ID['"]\)/);
assert.doesNotMatch(sheets, /const\s+SPREADSHEET_ID\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/);
assert.doesNotMatch(sheets, /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{100,}-----END [A-Z ]*PRIVATE KEY-----/);
assert.match(backend, /secrets\.readSecret\(['"]ADMIN_EMAILS['"]\)/);
assert.doesNotMatch(backend, /requireAdminEmailAllowlist\(\s*\[['"][^'"]+@[^'"]+['"]/);

console.log('Public-source configuration checks passed.');
