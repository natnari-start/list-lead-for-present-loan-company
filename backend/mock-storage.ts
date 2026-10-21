import type { CrmPart, CrmRecord, CrmStoragePort } from './storage-port';

/**
 * In-memory storage for isolated development and tests only.
 * This class is not wired into production routes and stores no durable data.
 */
export class MockCrmStorage implements CrmStoragePort {
  private readonly tables = new Map<string, Map<string, CrmRecord>>();

  private table(part: CrmPart, userId: string): Map<string, CrmRecord> {
    const key = `${userId}:${part}`;
    let table = this.tables.get(key);
    if (!table) {
      table = new Map<string, CrmRecord>();
      this.tables.set(key, table);
    }
    return table;
  }

  async listPart(part: CrmPart, userId: string): Promise<CrmRecord[]> {
    return [...this.table(part, userId).values()].map(record => ({
      id: record.id,
      values: [...record.values],
    }));
  }

  async getRecord(
    part: CrmPart,
    userId: string,
    id: string
  ): Promise<CrmRecord | null> {
    const record = this.table(part, userId).get(id);
    return record ? { id: record.id, values: [...record.values] } : null;
  }

  async createRecord(
    part: CrmPart,
    userId: string,
    record: CrmRecord
  ): Promise<boolean> {
    const table = this.table(part, userId);
    if (table.has(record.id)) return false;
    table.set(record.id, { id: record.id, values: [...record.values] });
    return true;
  }

  async updateRecord(
    part: CrmPart,
    userId: string,
    record: CrmRecord
  ): Promise<boolean> {
    const table = this.table(part, userId);
    if (!table.has(record.id)) return false;
    table.set(record.id, { id: record.id, values: [...record.values] });
    return true;
  }

  async deleteRecord(
    part: CrmPart,
    userId: string,
    id: string
  ): Promise<boolean> {
    return this.table(part, userId).delete(id);
  }
}
