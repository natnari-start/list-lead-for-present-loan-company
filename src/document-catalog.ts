/** SME Freedom Desk: display-only document requirements. NOT approved bank policy. */
export type DocumentStage = 'prescreen' | 'full_doc';
export type PolicyStatus = 'pending_confirmation';
export type Applicability = 'required_proposed' | 'conditional_proposed' | 'alternative_proposed';
export interface CatalogItem {
  code: string;
  stage: DocumentStage;
  group: string;
  label: string;
  applicability: Applicability;
  policyStatus: PolicyStatus;
  note?: string;
}
export const DOCUMENT_CATALOG: readonly CatalogItem[] = [
  { code: 'PRE-01', stage: 'prescreen', group: 'กรรมการ', label: 'สำเนาบัตรประชาชนกรรมการ', applicability: 'required_proposed', policyStatus: 'pending_confirmation', note: 'ข้อเสนอ: เซ็นชื่ออย่างเดียว' },
  { code: 'PRE-02', stage: 'prescreen', group: 'กรรมการ', label: 'สำเนาทะเบียนบ้านกรรมการ', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'PRE-03', stage: 'prescreen', group: 'บริษัท', label: 'ชุดหนังสือรับรองบริษัท', applicability: 'required_proposed', policyStatus: 'pending_confirmation', note: 'ข้อเสนอ: ไม่เกิน 3 เดือน เซ็นรับรองและประทับตรา; ยังไม่ยืนยันนโยบาย' },
  { code: 'PRE-04', stage: 'prescreen', group: 'บัญชี', label: 'หน้าสมุดบัญชีธนาคาร', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'PRE-05', stage: 'prescreen', group: 'ภาษี', label: 'ภพ.30 หรือ 50 ทวิ', applicability: 'alternative_proposed', policyStatus: 'pending_confirmation', note: 'ต้องตรวจความเหมาะสมและนโยบาย Prescreen' },
  { code: 'FULL-01A', stage: 'full_doc', group: 'กรรมการ', label: 'สำเนาเปลี่ยนชื่อ-สกุล (ถ้ามี)', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-01B', stage: 'full_doc', group: 'กรรมการ', label: 'เอกสารสมรส (ถ้ามี)', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-02A', stage: 'full_doc', group: 'บริษัท', label: 'บอจ.2', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-02B', stage: 'full_doc', group: 'บริษัท', label: 'บอจ.3 หน้า 1–2 / หส.2 ตามประเภทนิติบุคคล', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-02C', stage: 'full_doc', group: 'บริษัท', label: 'บอจ.1 และ บอจ.4', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-02D', stage: 'full_doc', group: 'บริษัท', label: 'บอจ.5 / บัญชีรายชื่อผู้ถือหุ้น', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-02E', stage: 'full_doc', group: 'บริษัท', label: 'บริคณฑ์สนธิและข้อบังคับ (ตามกรณี)', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-03A', stage: 'full_doc', group: 'งบการเงิน', label: 'รายงานผู้สอบบัญชี', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-03B', stage: 'full_doc', group: 'งบการเงิน', label: 'งบแสดงฐานะการเงิน', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-03C', stage: 'full_doc', group: 'งบการเงิน', label: 'งบกำไรขาดทุน', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-03D', stage: 'full_doc', group: 'งบการเงิน', label: 'หมายเหตุประกอบงบ', applicability: 'required_proposed', policyStatus: 'pending_confirmation', note: 'ปีเอกสาร: ผู้ใช้เสนอปีล่าสุด, Sales Sheet ระบุ 2 ปีล่าสุด; รอยืนยัน' },
  { code: 'FULL-04A', stage: 'full_doc', group: 'บัญชี', label: 'หน้าสมุดบัญชีสำหรับรายได้ (สูงสุด 4 เล่มตามข้อเสนอ)', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-04B', stage: 'full_doc', group: 'บัญชี', label: 'Statement ย้อนหลัง', applicability: 'required_proposed', policyStatus: 'pending_confirmation', note: '6 หรือ 12 เดือนตามกรณี; รอยืนยัน' },
  { code: 'FULL-04C', stage: 'full_doc', group: 'บัญชี', label: 'บัญชีรับโอนเงินชื่อผู้กู้', applicability: 'required_proposed', policyStatus: 'pending_confirmation' },
  { code: 'FULL-05', stage: 'full_doc', group: 'ธุรกิจ', label: 'ตัวอย่างบิลซื้อ-ขาย / เอกสารบริการ / สัญญาจ้าง', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation', note: 'ข้อเสนอ: รอบเดือนล่าสุด 3–5 รายการ' },
  { code: 'FULL-06', stage: 'full_doc', group: 'ภาษี', label: 'ภพ.20 หรือ ภพ.30 (สำหรับกิจการจด VAT)', applicability: 'conditional_proposed', policyStatus: 'pending_confirmation' },
];
export function catalogForStage(stage: DocumentStage): readonly CatalogItem[] {
  return DOCUMENT_CATALOG.filter(item => item.stage === stage);
}

