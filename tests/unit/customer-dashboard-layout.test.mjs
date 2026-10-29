import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');

describe('customer registry dashboard layout contract', () => {
  it('uses five decision-focused columns in visible and keyboard order', () => {
    const labels = ['บริษัท', 'เบอร์โทรศัพท์', 'งบปีล่าสุด', 'เกณฑ์ก่อนติดต่อ', 'การดำเนินการ'];
    let previous = -1;
    for (const label of labels) {
      const next = app.indexOf(`data-label="${label}"`);
      assert.ok(next > previous, `${label} must follow the visible order`);
      previous = next;
    }
  });

  it('switches the table to non-scrolling cards with touch-sized actions on mobile', () => {
    assert.match(css, /\.customer-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)[\s\S]*?\.customer-registry-wrap\s*\{[^}]*overflow:\s*visible/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)[\s\S]*?\.customer-registry-table\s*\{[^}]*min-width:\s*0/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)[\s\S]*?\.registry-row-actions \.button\s*\{[^}]*min-height:\s*44px/);
  });
});
