"use client";

import { createContext, useContext, type ReactNode } from "react";

// [English, Thai] for each UI string.
const S: Record<string, [string, string]> = {
  tagline: ["autonomous pentest orchestration · human-in-the-loop", "ระบบสั่งการ pentest อัตโนมัติ · มีคนอนุมัติทุกขั้น"],
  "nav.console": ["Console", "คอนโซล"],
  "nav.terminal": ["Terminal", "เทอร์มินัล"],
  "nav.desktop": ["Desktop", "เดสก์ท็อป"],
  "nav.settings": ["Settings", "ตั้งค่า"],
  "hdr.changePw": ["🔑 Pass", "🔑 รหัสผ่าน"],
  "hdr.logout": ["⏻ Logout", "⏻ ออกจากระบบ"],

  // terminal
  "term.title": ["Operator Terminal · Kali worker", "เทอร์มินัลผู้ปฏิบัติงาน · เครื่อง Kali"],
  "term.selectFirst": ["Select an engagement first.", "เลือกงาน (engagement) ก่อน"],
  "term.warn": ["Runs on the worker within the selected engagement. Every command is audit-logged. Stay within scope.", "รันบน worker ภายในงานที่เลือก — ทุกคำสั่งถูกบันทึกใน audit log · อยู่ในขอบเขตที่อนุญาต"],
  "term.noCmds": ["No commands yet.", "ยังไม่มีคำสั่ง"],
  "term.noOutput": ["(no output)", "(ไม่มีผลลัพธ์)"],
  "term.running": ["running…", "กำลังรัน…"],
  "term.run": ["Run", "รัน"],

  // desktop
  "desk.title": ["Kali Desktop · VNC", "เดสก์ท็อป Kali · VNC"],
  "desk.hint": ["Full XFCE desktop on the worker (Burp, Firefox, GUI tools). Access is protected by localhost-only binding (use an SSH tunnel on a remote server).", "เดสก์ท็อป XFCE เต็มบนเครื่อง worker (Burp, Firefox, เครื่องมือ GUI) — จำกัดการเข้าถึงไว้ที่ localhost เท่านั้น (บนเซิร์ฟเวอร์ระยะไกลให้ใช้ SSH tunnel)"],

  // login
  "login.subtitle": ["pentest orchestration console", "คอนโซลสั่งการ pentest"],
  "login.signin": ["Sign in", "เข้าสู่ระบบ"],
  "login.email": ["Email", "อีเมล"],
  "login.password": ["Password", "รหัสผ่าน"],
  "login.failed": ["Login failed: ", "เข้าสู่ระบบไม่สำเร็จ: "],

  // engagements
  "eng.title": ["Engagements", "งาน (Engagements)"],
  "eng.new": ["+ New", "+ สร้างใหม่"],
  "eng.refresh": ["Refresh", "รีเฟรช"],
  "eng.noClient": ["no client", "ไม่มีลูกค้า"],
  "eng.auth": ["Authorization:", "การอนุญาต:"],
  "eng.granted": ["GRANTED", "อนุญาตแล้ว"],
  "eng.none": ["NONE", "ยังไม่มี"],
  "eng.recordAuth": ["Record authorization", "บันทึกการอนุญาต"],
  "eng.worker": ["Kali worker", "เครื่อง Kali"],
  "eng.defaultWorker": ["Default worker", "เครื่องเริ่มต้น"],
  "eng.scopeIn": ["Scope — in", "ขอบเขต — อนุญาต"],
  "eng.scopeEx": ["Scope — excluded", "ขอบเขต — ยกเว้น"],
  "eng.noneList": ["none", "ไม่มี"],
  "eng.addIn": ["+ in-scope", "+ เพิ่มในขอบเขต"],
  "eng.addEx": ["+ exclude", "+ ยกเว้น"],
  "eng.delete": ["🗑 Delete engagement", "🗑 ลบงานนี้"],
  "eng.confirmDelete": ["Delete engagement \"{name}\" and all its sessions, findings and report? This cannot be undone.", "ลบงาน \"{name}\" พร้อม session, finding และรายงานทั้งหมด? ลบแล้วกู้คืนไม่ได้"],
  "eng.deleteRunning": ["A session is still running — stop it first, then delete.", "ยังมี session ทำงานอยู่ — หยุดก่อนแล้วค่อยลบ"],

  // template
  "tpl.label": ["Objective template", "เทมเพลตเป้าหมาย"],
  "tpl.hint": ["(built-in + custom · pick then Use)", "(built-in + custom · เลือกแล้วกด Use)"],
  "tpl.pick": ["— pick a template —", "— เลือก template —"],
  "tpl.use": ["⬇ Use", "⬇ ใช้"],
  "tpl.manageHint": ["Create / manage / import-export custom templates in ", "สร้าง / จัดการ / นำเข้า-ส่งออก template ที่ "],
  "tpl.settingsLink": ["Settings → Objective Templates", "Settings → Objective Templates"],

  // objective + spawn
  "obj.label": ["Objective for the agent", "เป้าหมายให้ AI"],
  "obj.placeholder": ["Pick a template above, or type your own", "เลือก template ด้านบน หรือพิมพ์เอง"],
  "auto.label": ["Auto-approve", "อนุมัติอัตโนมัติ"],
  "auto.hint": ["(run every tool without approval)", "(รันทุก tool โดยไม่ต้องกดอนุมัติ)"],
  "auto.warn": ["⚠ Approval gate off — the AI runs on its own (still limited by scope). Use only on lab / authorized targets.", "⚠ ปิด approval gate — AI ยิงเองอัตโนมัติ (ยังจำกัดด้วย scope) ใช้เฉพาะ lab / เป้าที่อนุญาต"],
  "spawn.run": ["▶ Spawn session", "▶ เริ่ม session"],
  "spawn.stop": ["⏹ Stop session", "⏹ หยุด session"],
  "spawn.needAuth": ["Record authorization before running the agent.", "ต้องบันทึกการอนุญาตก่อนรัน AI"],

  // findings + report
  "find.title": ["Findings", "ช่องโหว่ที่พบ (Findings)"],
  "find.none": ["no findings yet", "ยังไม่มี finding"],
  "find.viewReport": ["📄 View report", "📄 ดูรายงาน"],
  "find.exportPdf": ["⬇ Export PDF", "⬇ ส่งออก PDF"],

  // session history
  "hist.title": ["Session history", "ประวัติ session"],
  "hist.none": ["no sessions yet", "ยังไม่มี session"],
  "hist.entries": ["entries", "รายการ"],

  // session panel
  "sess.title": ["Session", "Session"],
  "sess.report": ["Report", "รายงาน"],
  "sess.back": ["← Back to session", "← กลับไป session"],
  "sess.empty": ["No active session. Configure an engagement, spawn one, or open a past session from the left.", "ยังไม่มี session ที่ทำงานอยู่ — ตั้งค่างาน แล้ว spawn หรือเปิด session เก่าจากด้านซ้าย"],
  "sess.approvalReq": ["⚠ Approval required — active tool", "⚠ ต้องอนุมัติ — active tool"],
  "sess.approve": ["APPROVE", "อนุมัติ"],
  "sess.reject": ["REJECT", "ปฏิเสธ"],

  // vuln feeds
  "feeds.title": ["Vuln Feeds", "ฐานช่องโหว่ (Vuln Feeds)"],
  "feeds.updateAll": ["⟳ Update all", "⟳ อัปเดตทั้งหมด"],
  "feeds.updating": ["Updating…", "กำลังอัปเดต…"],
  "feeds.refresh": ["Refresh", "รีเฟรช"],
  "feeds.auto": ["Auto-update", "อัปเดตอัตโนมัติ"],
  "feeds.every": ["every", "ทุก"],
  "feeds.hours": ["hours", "ชั่วโมง"],
  "feeds.allWorkers": ["Updates run on all", "อัปเดตบนทุก worker ที่เปิดใช้ ทั้งหมด"],
  "feeds.workersSuffix": ["enabled workers.", "ตัว"],
  "feeds.never": ["never updated", "ยังไม่เคยอัปเดต"],

  // template manager (Settings)
  "tm.title": ["Objective Templates (Custom)", "เทมเพลตเป้าหมาย (กำหนดเอง)"],
  "tm.intro": ["Build your own templates — one template can hold multiple levels (Basic/Medium/Advanced) · copy from built-in or custom then edit · built-ins are read-only", "สร้าง template ของคุณเอง — 1 template มีได้หลายระดับ (Basic/Medium/Advanced) · copy จาก built-in หรือ custom แล้วแก้ · built-in แก้ไม่ได้"],
  "tm.exportAll": ["⬇ Export all", "⬇ ส่งออกทั้งหมด"],
  "tm.import": ["⬆ Import (.json)", "⬆ นำเข้า (.json)"],
  "tm.saved": ["Saved templates", "Template ที่สร้างไว้"],
  "tm.savedNone": ["no custom templates yet", "ยังไม่มี custom template"],
  "tm.edit": ["Edit", "แก้ไข"],
  "tm.delete": ["Delete", "ลบ"],
  "tm.editHead": ["Edit template", "แก้ไข template"],
  "tm.newHead": ["Create a new template", "สร้าง template ใหม่"],
  "tm.name": ["Template name", "ชื่อ Template"],
  "tm.namePlaceholder": ["e.g. Web SQLi deep-dive", "เช่น Web SQLi deep-dive"],
  "tm.copyFrom": ["Copy from a source (copies all 3 levels)", "Copy จากต้นแบบ (คัดลอกมาทั้ง 3 ระดับ)"],
  "tm.copyPick": ["— pick a source template —", "— เลือก template ต้นแบบ —"],
  "tm.copyBtn": ["Copy →", "คัดลอก →"],
  "tm.cmdHint": ["Enter a command per level (at least 1) · use <TARGET> as the target placeholder", "กรอก command ต่อระดับ (อย่างน้อย 1 ระดับ) · ใช้ <TARGET> เป็นตัวแทนเป้าหมาย"],
  "tm.levelPlaceholder": ["command for this level (leave blank to skip this level)", "command สำหรับระดับนี้ (เว้นว่างได้ถ้าไม่ใช้ระดับนี้)"],
  "tm.create": ["Create", "สร้าง"],
  "tm.update": ["Update", "อัปเดต"],
  "tm.newForm": ["+ New (clear form)", "+ ใหม่ (ล้างฟอร์ม)"],
  "tm.needOne": ["Fill in at least 1 level", "ต้องกรอกอย่างน้อย 1 ระดับ"],
  "tm.copied3": ["Copied all 3 levels — edit as needed", "คัดลอกทั้ง 3 ระดับแล้ว — แก้ต่อได้"],
  "tm.copied3Builtin": ["Copied all 3 levels from built-in — edit as needed", "คัดลอกทั้ง 3 ระดับจาก built-in แล้ว — แก้ต่อได้"],
  "tm.updated": ["Updated", "อัปเดตแล้ว"],
  "tm.created": ["Template created", "สร้าง template แล้ว"],
  "tm.confirmDelete": ["Delete this template?", "ลบ template นี้?"],
  "tm.imported": ["Imported {n} templates", "นำเข้า {n} template"],
  "tm.badFile": ["Invalid file: ", "ไฟล์ไม่ถูกต้อง: "],

  // settings — common
  "set.adminOnly": ["Settings are admin-only. You are signed in as ", "หน้าตั้งค่าใช้ได้เฉพาะ admin — คุณเข้าสู่ระบบเป็น "],
  "set.edit": ["Edit", "แก้ไข"],
  "set.delete": ["Delete", "ลบ"],
  "set.cancel": ["Cancel", "ยกเลิก"],
  "set.add": ["Add", "เพิ่ม"],
  "set.update": ["Update", "อัปเดต"],
  "set.setDefault": ["Set default", "ตั้งเป็นค่าเริ่มต้น"],
  "set.name": ["Name", "ชื่อ"],
  "set.keepBlank": ["(leave blank to keep current)", "(เว้นว่าง = ใช้ค่าเดิม)"],
  // AI providers
  "set.ai.title": ["AI Providers", "ผู้ให้บริการ AI"],
  "set.ai.add": ["+ Add provider", "+ เพิ่ม provider"],
  "set.ai.desc": ["The reasoning engine that plans and drives engagements. Add several and pick one as the default (active) — the agent uses the default.", "สมองที่ใช้วางแผนและขับเคลื่อนงาน เพิ่มได้หลายตัวแล้วเลือกหนึ่งเป็นค่าเริ่มต้น (active) — agent จะใช้ตัวเริ่มต้น"],
  "set.ai.none": ["No providers yet. Click “+ Add provider”.", "ยังไม่มี provider — กด “+ เพิ่ม provider”"],
  "set.ai.editHead": ["Edit provider", "แก้ไข provider"],
  "set.ai.addHead": ["Add provider", "เพิ่ม provider"],
  "set.ai.test": ["Test", "ทดสอบ"],
  "set.ai.apiKey": ["API key", "API key"],
  "set.ai.model": ["Model", "โมเดล"],
  // workers
  "set.wk.title": ["Kali Workers", "เครื่อง Kali (Workers)"],
  "set.wk.add": ["+ Add worker", "+ เพิ่ม worker"],
  "set.wk.desc": ["Run several Kali workers in parallel and assign engagements to different ones (isolation per client / reach different networks). The agent uses the engagement’s worker, or the default.", "รัน worker Kali หลายตัวพร้อมกันและกำหนดงานให้แต่ละตัว (แยกตามลูกค้า / เข้าถึงเครือข่ายต่างกัน) — agent ใช้ worker ของงานนั้น หรือค่าเริ่มต้น"],
  "set.wk.editHead": ["Edit worker", "แก้ไข worker"],
  "set.wk.addHead": ["Add worker", "เพิ่ม worker"],
  "set.wk.health": ["Health", "ตรวจสถานะ"],
  // proxy
  "set.px.title": ["Proxy · Burp / Caido", "Proxy · Burp / Caido"],
  "set.px.desc": ["Routes active web tools (nuclei, ffuf) through an intercepting proxy so you see every request.", "ส่ง web tool ที่ active (nuclei, ffuf) ผ่าน proxy ดักจับ เพื่อให้เห็นทุก request"],
  "set.px.type": ["Type", "ประเภท"],
  "set.px.url": ["Proxy URL", "Proxy URL"],
  "set.enableSave": ["Enable & save", "เปิดใช้ & บันทึก"],
  "set.disable": ["Disable", "ปิด"],
  "set.status": ["Status:", "สถานะ:"],
  // telegram
  "set.tg.title": ["Telegram Gateway", "Telegram Gateway"],
  "set.tg.desc": ["Get approval requests on your phone with Approve/Reject buttons. Create a bot with @BotFather, then paste its token and your chat id.", "รับคำขออนุมัติบนมือถือพร้อมปุ่ม Approve/Reject — สร้าง bot ด้วย @BotFather แล้ววาง token และ chat id ของคุณ"],
  "set.tg.botToken": ["Bot token", "Bot token"],
  "set.tg.chatId": ["Chat id", "Chat id"],
  "set.tg.sendTest": ["Send test", "ส่งข้อความทดสอบ"],
  // users
  "set.us.title": ["Operators", "ผู้ใช้งาน (Operators)"],
  "set.us.add": ["Add user", "เพิ่มผู้ใช้"],
  // audit
  "set.au.title": ["Audit Log", "บันทึกการตรวจสอบ (Audit Log)"],
  "set.au.none": ["No entries.", "ยังไม่มีรายการ"],

  // prompts
  "prompt.engName": ["Engagement name?", "ชื่องาน (engagement)?"],
  "prompt.client": ["Client?", "ลูกค้า?"],
  "prompt.authBy": ["Authorized by (name/role)?", "ผู้อนุญาต (ชื่อ/ตำแหน่ง)?"],
  "prompt.authRef": ["Authorization ref (SOW/ticket)?", "เลขอ้างอิงการอนุญาต (SOW/ticket)?"],
  "prompt.scopeAdd": ["In-scope target (host/domain):", "เป้าหมายในขอบเขต (host/domain):"],
  "prompt.scopeEx": ["Excluded target:", "เป้าหมายที่ยกเว้น:"],
  "prompt.pwCur": ["Current password?", "รหัสผ่านปัจจุบัน?"],
  "prompt.pwNew": ["New password (min 8 chars)?", "รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)?"],
  "prompt.pwChanged": ["Password changed.", "เปลี่ยนรหัสผ่านแล้ว"],
  "prompt.popupBlocked": ["Popup blocked — allow popups for this site to export PDF", "เปิด popup ไม่ได้ — อนุญาต popup ของเว็บนี้เพื่อ export PDF"],
};

// The UI is English-only. We keep this tiny t() indirection (English is slot 0 of
// each dictionary entry) so the components don't need a churny revert; the Thai
// slot is retained only as reference for the bilingual user manuals.
const t = (k: string) => {
  const e = S[k];
  return e ? e[0] : k;
};

const Ctx = createContext<{ t: (k: string) => string }>({ t });

export function LangProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={{ t }}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
