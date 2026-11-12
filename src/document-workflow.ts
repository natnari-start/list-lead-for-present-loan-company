import { catalogForStage, type DocumentStage, type CatalogItem } from './document-catalog.ts';
export type SheetRow = { id: string; values: unknown[] };
export type LegacyDocumentStatus = 'ยังไม่ได้รับ' | 'ได้รับแล้วรอตรวจ' | 'ต้องแก้ไข' | 'ตรวจครบแล้ว' | 'ไม่ทราบสถานะ';
export interface LegacyDocument {
  id: string;
  caseId: string;
  category: string;
  coverage: string;
  receivedAt: string;
  status: LegacyDocumentStatus;
  issue: string;
  reviewer: string;
  storageReference: string;
  updatedAt: string;
  classification: 'legacy_unclassified';
}
function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
function legacyStatus(value: unknown): LegacyDocumentStatus {
  const candidate = asText(value);
  return candidate === 'ยังไม่ได้รับ' || candidate === 'ได้รับแล้วรอตรวจ' || candidate === 'ต้องแก้ไข' || candidate === 'ตรวจครบแล้ว' ? candidate : 'ไม่ทราบสถานะ';
}
export function buildDocumentView(caseId: string, rows: readonly SheetRow[], stage: DocumentStage): {
  catalog: readonly CatalogItem[];
  legacyDocuments: LegacyDocument[];
  legacyCounts: { total: number; receivedPending: number; verified: number; needsRevision: number; unknown: number };
  catalogVerifiedCount: null;
} {
  const key = caseId.trim();
  // A blank selection must never accidentally display records with missing case IDs.
  const legacyDocuments = rows.filter(row => key !== '' && asText(row.values?.[1]) === key)
    .map(row => ({
      id: asText(row.id), caseId, category: asText(row.values[2]), coverage: asText(row.values[3]),
      receivedAt: asText(row.values[4]), status: legacyStatus(row.values[5]), issue: asText(row.values[6]),
      reviewer: asText(row.values[7]), storageReference: asText(row.values[8]), updatedAt: asText(row.values[9]),
      classification: 'legacy_unclassified' as const,
    }));
  return {
    catalog: catalogForStage(stage), legacyDocuments,
    legacyCounts: {
      total: legacyDocuments.length,
      receivedPending: legacyDocuments.filter(d => d.status === 'ได้รับแล้วรอตรวจ').length,
      verified: legacyDocuments.filter(d => d.status === 'ตรวจครบแล้ว').length,
      needsRevision: legacyDocuments.filter(d => d.status === 'ต้องแก้ไข').length,
      unknown: legacyDocuments.filter(d => d.status === 'ไม่ทราบสถานะ').length,
    },
    // Do not compute per-catalog completion from unclassified legacy rows.
    catalogVerifiedCount: null,
  };
}

