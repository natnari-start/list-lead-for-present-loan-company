import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const testPath = process.argv[2] || 'tests/tests.json';
const path = new URL(`../${testPath}`, import.meta.url);
const suite = JSON.parse(readFileSync(path, 'utf8'));

assert.ok(Array.isArray(suite), `${testPath} must contain a JSON array`);
assert.ok(suite.length >= 3 && suite.length <= 5, 'AppDeploy expects 3-5 focused tests');

const allowed = new Set([
  'name',
  'description',
  'viewport',
  'covers',
  'steps',
  'expected',
  'sanity',
  'setup',
  'qa_faults',
]);

for (const [index, testCase] of suite.entries()) {
  assert.ok(testCase && typeof testCase === 'object' && !Array.isArray(testCase), `test ${index + 1} must be an object`);
  for (const key of Object.keys(testCase)) {
    assert.ok(allowed.has(key), `test ${index + 1} has unsupported field: ${key}`);
  }
  for (const key of ['name', 'description', 'expected']) {
    assert.equal(typeof testCase[key], 'string', `test ${index + 1} needs string ${key}`);
    assert.ok(testCase[key].trim(), `test ${index + 1} needs non-empty ${key}`);
  }
  assert.ok(['desktop', 'mobile'].includes(testCase.viewport), `test ${index + 1} needs desktop or mobile viewport`);
  for (const key of ['covers', 'steps']) {
    assert.ok(Array.isArray(testCase[key]) && testCase[key].length > 0, `test ${index + 1} needs non-empty ${key}`);
    assert.ok(testCase[key].every(item => typeof item === 'string' && item.trim()), `test ${index + 1} ${key} must contain non-empty strings`);
  }
  if ('sanity' in testCase) assert.equal(typeof testCase.sanity, 'boolean', `test ${index + 1} sanity must be boolean`);
  if ('setup' in testCase) assert.ok(Array.isArray(testCase.setup) && testCase.setup.length > 0, `test ${index + 1} setup must be a non-empty array`);
  if ('qa_faults' in testCase) assert.ok(Array.isArray(testCase.qa_faults) && testCase.qa_faults.length > 0, `test ${index + 1} qa_faults must be a non-empty array`);
}
assert.equal(suite.filter(testCase => testCase.sanity === true).length, 1, 'exactly one test must be marked sanity');

console.log(`Validated ${suite.length} AppDeploy E2E test definitions (${testPath}).`);
