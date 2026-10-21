# SME Freedom Desk

แอปติดตามลูกค้าและงานสินเชื่อ SME

## สถานะปัจจุบัน

- Source code ใน branch นี้ซิงก์จาก AppDeploy snapshot รุ่น 1792379512062
- Frontend ใช้ React, Vite และ TypeScript
- Backend ใช้ AppDeploy SDK และฐานข้อมูล AppDeploy
- Google Sheets ยังไม่ได้เชื่อมต่อ
- หน้าระบบและ AppDeploy metadata ระบุว่าเป็น Sandbox สำหรับข้อมูลจำลอง
- การตรวจสิทธิ์ผู้ดูแลฝั่ง server อ่านจาก AppDeploy secret ชื่อ `ADMIN_EMAILS` และปฏิเสธคำขอเมื่อยังไม่ตั้งค่า

## โครงสร้าง

- `src/` หน้าจอและ schema ของข้อมูล 5 ส่วน
- `backend/` API และ realtime handlers
- `tests/tests.json` กรณีทดสอบสำหรับ AppDeploy
- `docs/CRAFT_MASTER_PROMPT.md` prompt สำหรับการพัฒนาต่อ
- `docs/GOOGLE_SHEETS_MIGRATION.md` สถานะและแนวทางเชื่อมชีต

## พัฒนา

โครงการนี้อาศัย `@appdeploy/client` และ `@appdeploy/sdk` ซึ่งจัดให้โดย runtime ของ AppDeploy จึงต้องตรวจวิธี build และ test ตามคู่มือปัจจุบันของ AppDeploy ก่อนรันนอกแพลตฟอร์ม

## ความปลอดภัย

ห้าม commit ข้อมูลลูกค้าจริง, Spreadsheet ID ภายใน, OAuth token, service-account key, `.env` หรือ credentials เข้าสู่ repository นี้ ซึ่งเป็น public repository ใช้ข้อมูลจำลองในการพัฒนาและทดสอบเท่านั้น

## ตรวจสอบก่อน merge และก่อน Live

GitHub Actions workflow `.github/workflows/appdeploy-preflight.yml` จะรัน `npm run verify:prelive` เมื่อ push เข้า branch นี้หรือเปิด Pull Request เข้า `main` โดยตรวจ Vite build, unit tests ของ mock storage และรูปแบบไฟล์ `tests/tests.json` ตามสัญญา AppDeploy ทั้งนี้ build ใน CI จะ externalize `@appdeploy/client` ซึ่ง AppDeploy จัดให้ตอน runtime จึงเป็น preflight build ไม่ใช่การยืนยัน production runtime ส่วน AppDeploy E2E จาก `tests/tests.json` จะรันในขั้น Deploy/QA ของ AppDeploy เท่านั้น
