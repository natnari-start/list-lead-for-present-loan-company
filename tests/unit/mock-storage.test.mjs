import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockCrmStorage } from '../../backend/mock-storage.ts';

describe('MockCrmStorage', () => {
  it('keeps records isolated by user and record type', async () => {
    const storage = new MockCrmStorage();
    const record = { id: 'SYN-CUST-001', values: ['SYN-CUST-001', 'Synthetic company'] };

    assert.equal(await storage.createRecord('customers', 'user-a', record), true);
    assert.deepEqual(await storage.listPart('customers', 'user-a'), [record]);
    assert.deepEqual(await storage.listPart('customers', 'user-b'), []);
    assert.deepEqual(await storage.listPart('cases', 'user-a'), []);
  });

  it('rejects duplicate IDs and supports read, update, and delete', async () => {
    const storage = new MockCrmStorage();
    const initial = { id: 'SYN-CUST-002', values: ['SYN-CUST-002', 'Before'] };
    const updated = { id: initial.id, values: [initial.id, 'After'] };

    assert.equal(await storage.createRecord('customers', 'user-a', initial), true);
    assert.equal(await storage.createRecord('customers', 'user-a', initial), false);
    assert.deepEqual(await storage.getRecord('customers', 'user-a', initial.id), initial);
    assert.equal(await storage.updateRecord('customers', 'user-a', updated), true);
    assert.deepEqual(await storage.getRecord('customers', 'user-a', initial.id), updated);
    assert.equal(await storage.deleteRecord('customers', 'user-a', initial.id), true);
    assert.equal(await storage.getRecord('customers', 'user-a', initial.id), null);
  });
});
