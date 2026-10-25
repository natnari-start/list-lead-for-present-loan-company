# SME Freedom Desk

เว็บแอปติดตามลูกค้าและงานสินเชื่อ SME

## สถานะล่าสุด

- Source code ซิงก์จาก AppDeploy snapshot รุ่น `1792637669571` (22 ต.ค. 2026)
- Frontend ใช้ React, Vite และ TypeScript; backend ใช้ AppDeploy SDK
- ข้อมูลจริงอ่านจาก Google Sheets ผ่าน backend เท่านั้น ไม่มีข้อมูล Sandbox สำรองมาแสดงเมื่อเชื่อมต่อไม่สำเร็จ
- ผู้ดูแลแก้ไขรายการเดิมใน Google Sheets ผ่าน WebApp ได้ โดยล็อกรหัสรายการและป้องกันการเขียนทับเมื่อข้อมูลเปลี่ยนหลังโหลด
- ปิดการเพิ่มและลบข้อมูลจาก WebApp ในเวอร์ชันนี้
- ตรวจสิทธิ์ service account แล้วพบ `writer` (ระดับ Editor) บนชีต การทดสอบเขียนจริงยังไม่ได้ทำเพื่อไม่แตะแถวลูกค้าโดยไม่เลือกข้อมูลทดสอบ
- Live app: [SME Freedom Desk](https://sme-freedom-desk-vofbzr.v2.appdeploy.ai/)

## โครงสร้าง

- `src/` หน้าจอและ schema ของข้อมูล 5 ส่วน
- `backend/googleSheets.ts` การยืนยันตัวตน service account การอ่าน และการแก้ไข Google Sheets
- `backend/index.ts` API, admin allowlist และการตรวจสอบข้อมูลก่อนบันทึก
- `tests/tests.json` กรณีทดสอบ E2E ที่ AppDeploy ใช้ตอน deploy/QA
- `docs/GOOGLE_SHEETS_MIGRATION.md` สถานะการเชื่อมต่อ ขอบเขตการเขียน และการตั้งค่า

## ตั้งค่า AppDeploy secrets

ข้อมูลต่อไปนี้ต้องตั้งเป็น secrets ฝั่ง backend ผ่าน secret-entry ของ AppDeploy ก่อน deploy source จาก branch นี้:

- `ADMIN_EMAILS` — รายชื่ออีเมลผู้ดูแล รูปแบบ JSON array หรือคั่นด้วย comma/newline
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service-account JSON ทั้งชุด
- `GOOGLE_SPREADSHEET_ID` — ID ของ Google Sheet เป้าหมาย

ห้ามใส่ secret, Spreadsheet ID, private key, token หรือข้อมูลลูกค้าใน source code, frontend, log, issue หรือ repository สาธารณะ

## พัฒนาและตรวจสอบ

Runtime ของ AppDeploy จัดเตรียม `@appdeploy/client` และ `@appdeploy/sdk`; CI ใช้ Vite preflight build, unit tests, ตรวจโครงสร้าง `tests/tests.json` และสแกน source สำหรับค่าลับที่ไม่ควรอยู่ใน public repo

```sh
npm install
npm run verify:prelive
```

Vite preflight ไม่แทนการทดสอบ backend ใน AppDeploy runtime การทดสอบ E2E จริงจะทำในขั้น Deploy/QA ของ AppDeploy

## แนวทางพัฒนา

สร้าง branch แยกจาก `main` สำหรับการอัปเดต source และเปิด Pull Request เพื่อตรวจทานก่อน merge ห้าม push source ที่มีข้อมูลจริงหรือ credential ขึ้น repository นี้
