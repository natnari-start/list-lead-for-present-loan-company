import { buildDocumentView } from './document-workflow.ts';
import { company, contactPolicy, field, text, type ReadModel, type Row } from './crm-read-model.ts';
import { isOpenTask } from './follow-up-view.ts';

export function caseTasks(model: ReadModel, id: string) {
  return model.cases.has(id) ? [...model.tasks.values()].filter(row => text(field(row, 'tasks', 'รหัสเคส (ถ้ามี)')) === id) : [];
}
export function caseSummary(model: ReadModel, loan: Row) {
  const customerId = text(field(loan, 'cases', 'รหัสลูกค้า'));
  const tasks = caseTasks(model, loan.id);
  const documents = buildDocumentView(loan.id, [...model.documents.values()], 'prescreen');
  return { customerId, companyName: company(model, customerId), tasks, openCount: tasks.filter(isOpenTask).length,
    policy: contactPolicy(model.customers.get(customerId)), documents };
}
export function caseContacts(model: ReadModel, loan: Row) {
  const customerId = text(field(loan, 'cases', 'รหัสลูกค้า'));
  // Stable ISO order only; unparseable timestamps stay last and are never guessed.
  const sortable = (v: unknown) => {
    const s = text(v); const date = s.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date ? s : '';
  };
  const contacts = [...model.contacts.values()].filter(row => text(field(row, 'contacts', 'รหัสลูกค้า')) === customerId)
    .sort((a, b) => sortable(field(b, 'contacts', 'วันเวลาติดต่อ')).localeCompare(sortable(field(a, 'contacts', 'วันเวลาติดต่อ'))) || a.id.localeCompare(b.id));
  return { specific: contacts.filter(row => text(field(row, 'contacts', 'รหัสเคส (ถ้ามี)')) === loan.id),
    customerOnly: contacts.filter(row => field(row, 'contacts', 'รหัสเคส (ถ้ามี)') === null || field(row, 'contacts', 'รหัสเคส (ถ้ามี)') === '') };
}

