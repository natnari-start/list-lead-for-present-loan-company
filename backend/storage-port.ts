export type CrmPart =
  | 'customers'
  | 'cases'
  | 'contacts'
  | 'tasks'
  | 'documents';

export type CrmRecord = {
  id: string;
  values: unknown[];
};

/**
 * Storage contract for the CRM backend.
 *
 * Implementations must scope every operation to the authenticated user, keep
 * record IDs stable, and preserve linked records when a customer is edited.
 */
export interface CrmStoragePort {
  listPart(part: CrmPart, userId: string): Promise<CrmRecord[]>;
  getRecord(part: CrmPart, userId: string, id: string): Promise<CrmRecord | null>;
  createRecord(part: CrmPart, userId: string, record: CrmRecord): Promise<boolean>;
  updateRecord(part: CrmPart, userId: string, record: CrmRecord): Promise<boolean>;
  deleteRecord(part: CrmPart, userId: string, id: string): Promise<boolean>;
}
