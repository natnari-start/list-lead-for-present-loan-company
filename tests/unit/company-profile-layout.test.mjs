import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const css = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const rule = selector => {
  const start = css.indexOf(selector + ' {');
  if (start < 0) return '';
  return css.slice(start, css.indexOf('}', start) + 1);
};

describe('company profile responsive layout contract', () => {
  it('uses one bounded scroll region and keeps the financial section in normal flow', () => {
    assert.match(rule('.details-modal'), /max-height:\s*90dvh/);
    assert.match(rule('.company-profile-content'), /min-height:\s*0/);
    assert.match(rule('.company-profile-content'), /overflow-y:\s*auto/);
    assert.doesNotMatch(rule('.details-grid'), /overflow/);
    assert.doesNotMatch(rule('.company-financial-section'), /position:\s*(?:fixed|absolute|sticky)/);
    assert.doesNotMatch(rule('.financial-profile-panel'), /position:\s*(?:fixed|absolute|sticky)/);
  });

  it('keeps company fields at two columns on desktop and one column on narrow screens', () => {
    assert.match(rule('body'), /min-width:\s*320px/);
    assert.match(rule('.details-grid'), /grid-template-columns:\s*repeat\(2,/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)[\s\S]*?\.details-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    assert.match(css, /@media\s*\(max-width:\s*780px\)[\s\S]*?\.company-financial-layout\s*\{\s*grid-template-columns:\s*1fr/);
  });
});
