# Momentum — Life Dashboard: Design Doc

วันที่: 2026-06-12
สถานะ: รอเฮง approve
Mockups: `design/screens/*.html`, `design/foundation/design-system.html` (approve แล้ว 2026-06-12)

## 1. ภาพรวม

เว็บแอปส่วนตัว (ผู้ใช้คนเดียว) สำหรับติดตามชีวิตประจำวัน 7 เสาหลัก พร้อมระบบคะแนน 100 คะแนน/วัน,
จับเวลาจริง, streak, Mission, Balance Alert และ Life Trend
ใช้บนมือถือเป็นหลัก (desktop รองรับ), UI ภาษาอังกฤษล้วน, sync ข้ามเครื่อง

หลักการสูงสุด: **กรอกได้ใน 30 วินาที** — แตะชิป, กดปุ่มจับเวลา, จบ

## 2. สถาปัตยกรรม

- **Frontend**: เว็บ static — vanilla HTML/CSS/JS (ES modules) **ไม่มี build step, ไม่มี framework**
  (เหตุผล: debug ง่ายสุดสำหรับคนเริ่มเขียนโค้ด, ไฟล์น้อย, เปิดไฟล์ตรง ๆ ก็รันได้)
- **Backend**: [Supabase](https://supabase.com) free tier — Postgres + Auth
  (เหตุผล: ต้องการ sync ข้ามเครื่อง โดยไม่ต้องเขียน/ดูแล server เอง)
- **Hosting**: GitHub Pages (ฟรี, https, เปิดจากมือถือได้)
- **PWA แบบเบา**: มี `manifest.json` + icon ให้ "Add to Home Screen" บนมือถือได้
  แต่**ไม่มี** service worker ใน v1 (ตัดความซับซ้อนเรื่อง cache)
- ต้องต่อเน็ตเสมอ (offline mode = out of scope v1)

### ไฟล์ (ตั้งใจให้น้อยที่สุด)

```
index.html      — app shell + 4 หน้า (Today / Week / Month / Settings)
style.css       — สไตล์ทั้งหมด (ตาม design system ใน mockup)
app.js          — เปิดแอป, สลับหน้า, render UI
score.js        — pure functions: คะแนน, streak, alert, trend (ไม่มี DOM/network — เทสต์ได้)
db.js           — Supabase client + อ่าน/เขียนข้อมูล
config.js       — SUPABASE_URL + ANON_KEY (key ฝั่ง client เป็น public โดยดีไซน์ ปลอดภัยด้วย RLS)
manifest.json   — PWA manifest
tests/score.test.js — unit tests ของ score.js (รันด้วย node --test)
```

## 3. เสาหลักและคะแนน (รวม 100)

| เสา | สี | เป้า/วัน | คะแนน | วิธีคิด |
|---|---|---|---|---|
| 💰 Skill & Income | `#F5B83D` | 240 นาที | 40 | `round(40 × min(นาที,240)/240)` |
| 🎓 University | `#5BA8FF` | 120 นาที | 20 | `round(20 × min(นาที,120)/120)` |
| 💪 Health | `#3DDC84` | ออกกำลัง 60 นาที + นอนพอ | 20 | `round(15 × min(นาที,60)/60) + (นอนพอ ? 5 : 0)` |
| 📚 Financial Education | `#B98CF5` | 20 นาที | 5 | `round(5 × min(นาที,20)/20)` |
| 🇬🇧 English | `#FF8A8A` | 30 นาที | 5 | `round(5 × min(นาที,30)/30)` |
| 🧘 Mindfulness | `#8E9BFF` | 10 นาที | 5 | `round(5 × min(นาที,10)/10)` |
| 🌱 Reflection | `#34D3C3` | ตอบ 3 ช่อง | 5 | `round(5 × ช่องที่ตอบ/3)` — 3 ช่องคือ Win, What went wrong, One thing for tomorrow |

- ตัวเลขเป้าในสูตร (240/120/60/…) คือ**ค่าเริ่มต้น** — สูตรจริงใช้เป้าปัจจุบันจาก `app_state.targets`
  ซึ่งแก้ได้ในหน้า Settings (มีผลตั้งแต่วันนี้เป็นต้นไป — วันเก่าใช้คะแนนที่บันทึกแล้ว ไม่คิดย้อนหลัง)
- นาทีเกินเป้า **บันทึกไว้** (โชว์ในสถิติ) แต่ไม่ได้คะแนนเพิ่ม
- ชิปกิจกรรม (Learn/Code/Project…, Attend class/…, Meditate/…) เป็น **tag บอกว่าทำอะไร ไม่มีผลต่อคะแนน**
  — ยกเว้น "Slept 7h+" ใน Health ที่เป็น checkbox พิเศษมีคะแนน 5 (เก็บแยกใน `sleep_ok` ไม่ใช่ tag)
- น้ำหนักคะแนน (40/20/20/5/5/5/5) เป็นค่าคงที่ในโค้ด (v1 ไม่มี UI แก้)

### สถานะวัน
🟢 Green ≥ 80 · 🟡 Yellow 40–79 · 🔴 Red < 40

### Streak 🔥
จำนวนวันติดต่อกันที่คะแนน ≥ 40 (ไม่แดงก็นับ) นับถอยหลังจากวันนี้
ถ้าวันนี้ยังไม่ถึง 40 ให้เริ่มนับจากเมื่อวาน (วันนี้ยังไม่จบ ไม่ตัด streak)

## 4. Timer (จับเวลาจริง)

- จับได้ **ทีละ 1 เสา** — กด ▶ เสาใหม่ = หยุดเสาเก่าอัตโนมัติ (นาทีสะสมเข้าเสาเก่า ปัดลงเป็นนาทีเต็ม)
- เก็บเป็น `{pillar, started_at}` (timestamp) ใน database — **ไม่ใช่ตัวนับในหน้าเว็บ**
  ⇒ ปิดจอ / สลับแอป / refresh / เปลี่ยนเครื่อง เวลายังเดินถูกต้อง
- เวลาที่แสดงวิ่ง = `now − started_at` (อัปเดตทุกวินาทีฝั่ง client)
- timer ข้ามเที่ยงคืน: นาทีทั้งหมดเข้า**วันที่กดเริ่ม**
- ลืมจับเวลา: **แตะที่ตัวเลขนาที** (เช่น "90/120") เพื่อพิมพ์แก้ตรง ๆ ได้
- มือถือ: ป้ายลอย "🎓 23:41 · tap to stop" ติดขอบล่าง / desktop: การ์ดใน sidebar

## 5. โครงสร้างข้อมูล (Supabase)

```sql
-- หนึ่งแถว = หนึ่งวัน
create table days (
  date date primary key,
  data jsonb not null default '{}',   -- เนื้อหาทั้งวัน (ดูโครงด้านล่าง)
  score int not null default 0,        -- คำนวณฝั่ง client เก็บไว้ให้ query เร็ว
  updated_at timestamptz default now()
);

-- ค่าระบบ: timer, targets, mission (หนึ่ง key = หนึ่งแถว)
create table app_state (
  key text primary key,                -- 'timer' | 'targets' | 'mission'
  value jsonb not null
);
```

โครง `days.data`:
```json
{
  "minutes": {"skill":210,"uni":90,"health":45,"fin":20,"eng":25,"mind":10},
  "tags":    {"skill":["learn","code"],"uni":["class","review"],"mind":["meditate"]},
  "sleep_ok": false,
  "notes":   {"skill":"Built OAuth login","uni":"Calculus ch.4"},
  "win":     "Shipped the auth flow",
  "reflect": {"wrong":"Slept late","tomorrow":"Finish problem set"},
  "points":  {"skill":35,"uni":15,"health":11,"fin":5,"eng":4,"mind":5,"refl":5}
}
```

- `points` = คะแนนรายเสา คำนวณและบันทึกตอน save ทุกครั้ง — Week/Month/Alert/Trend อ่านค่านี้ตรง ๆ
  (วันเก่าไม่ถูกคำนวณใหม่แม้เป้าจะเปลี่ยนภายหลัง)

โครง `app_state`:
```json
"timer":   {"pillar":"uni","started_at":"2026-06-12T14:02:11Z"}   // null = ไม่ได้จับ
"targets": {"skill":240,"uni":120,"health":60,"fin":20,"eng":30,"mind":10}
"mission": {"title":"Launch TrueVibe MVP","deadline":"2026-08-31","progress":62}
```

- ใช้ jsonb คอลัมน์เดียว ⇒ เพิ่มฟิลด์ใหม่ภายหลังได้โดยไม่ต้อง migrate schema
- ข้อมูลเดือนละ ~31 แถว เล็กมาก — หน้า Week/Month ดึงเป็นช่วงวันที่แล้วคำนวณฝั่ง client

### Auth & ความปลอดภัย
- Supabase Auth แบบ email + password, มี **account เดียว** (ของเฮง), ปิดรับสมัครใหม่ใน Supabase settings
- เปิด RLS ทั้งสองตาราง: อนุญาตเฉพาะ `authenticated` ทุก operation
- login ครั้งเดียวต่อเครื่อง (session คงอยู่ใน localStorage)
- เขียนข้อมูลทันทีที่มีการแก้ (debounce 800ms สำหรับช่องพิมพ์ข้อความ)
- **error ห้ามกลืน**: บันทึกไม่สำเร็จ → แบนเนอร์แดง + ปุ่ม retry (ตามกติกา no empty catch)

## 6. หน้าจอ

### Today (หน้าหลัก — ตาม mockup)
บนลงล่าง: 🎯 Mission → Score ring + streak + month avg → 🏆 Biggest Win (ช่องเดียว = คำถาม
"ภูมิใจอะไรที่สุด" เดิม) → ⚠️ Balance Alert (ถ้ามี) → การ์ด 7 เสา → nav ล่าง 4 แท็บ

### Week
จุดคะแนน 7 วัน (จันทร์–อาทิตย์) · avg/green days/streak · ชั่วโมงต่อเสา (กราฟแท่งนอน) ·
Insight แบบ rule-based: "Best day: X" + เสาที่ % ต่ำสุดของสัปดาห์

### Month
สถิติ (avg, green days, best streak) → **Life Trend** → ปฏิทินสี → กราฟเส้นคะแนน (SVG) →
ชั่วโมงรวมต่อเสา → รายการ Wins ของเดือน (วันที่ + ข้อความ)

### Settings
แก้เป้านาทีต่อเสา · แก้ Mission (title / deadline / progress slider 0–100%) ·
Export ข้อมูลทั้งหมดเป็นไฟล์ JSON (สำรองข้อมูล) · Logout

## 7. กติกาฟีเจอร์อัจฉริยะ (rule-based ทั้งหมด ไม่มี AI)

### Balance Alert ⚠️
- เสาใดได้คะแนน **< 50% ของคะแนนเต็มเสานั้น** ติดต่อกัน **≥ 5 วัน** (นับถึงเมื่อวาน) → ขึ้นเตือน
- แสดงทีละ 1 อัน (เสาที่ขาดติดต่อกันนานที่สุด) เพื่อไม่ให้หน้ารก
- ข้อความ: `⚠️ {Pillar} below target — {N} days in a row`

### Life Trend 📈 (หน้า Month)
- ต่อเสา: รวม**คะแนนที่ได้** 30 วันล่าสุด เทียบ 30 วันก่อนหน้า → `%Δ = (cur−prev)/prev×100`
- Overall: %Δ ของคะแนนเฉลี่ยรายวัน
- prev = 0 หรือยังไม่มีข้อมูลครบ → แสดง "—" (ไม่โชว์ % หลอก)
- เขียว ▲ = ดีขึ้น, แดง ▼ = แย่ลง

## 8. กติกาเวลา

- Timezone: เวลาเครื่องผู้ใช้ (Asia/Bangkok) — ขอบเขตวันคือเที่ยงคืนตามเครื่อง
- เปิดแอปหลังเที่ยงคืน = ขึ้นแถววันใหม่อัตโนมัติ (แถวเก่าคงอยู่ตาม date)

## 9. การทดสอบ

- `score.js` เป็น pure functions ทั้งหมด → unit test ด้วย `node --test` ครอบคลุม:
  คะแนนรายเสา (ต่ำกว่า/เท่ากับ/เกินเป้า, ปัดเศษ), คะแนนรวม, สถานะสี, streak (รวมเคสวันนี้ยังไม่จบ),
  alert (4 วัน=ไม่เตือน, 5 วัน=เตือน, เลือกอันแย่สุด), trend (ปกติ, prev=0, ข้อมูลไม่ครบ)
- UI ทดสอบด้วยมือตาม checklist ใน implementation plan (เปิดจริงบนมือถือ + desktop)

## 10. สิ่งที่ผู้ใช้ต้องทำเอง (ครั้งเดียวตอน setup)

1. สมัคร supabase.com (ฟรี) → สร้าง project → ได้ URL + anon key มาใส่ `config.js`
2. รัน SQL สร้างตาราง (จะมีไฟล์ `setup.sql` ให้ copy-paste)
3. สร้าง account ตัวเองใน Supabase Auth แล้วปิดรับสมัคร
4. สร้าง GitHub repo + เปิด GitHub Pages (มีขั้นตอนละเอียดใน plan)

## 11. Out of scope (v1)

ทำงาน offline / service worker · หลาย mission พร้อมกัน · แก้ชิปกิจกรรมผ่าน UI ·
notification เตือน · ผู้ใช้หลายคน · แก้น้ำหนักคะแนนผ่าน UI · กราฟ interactive

## 12. ความเสี่ยงที่รู้ตัว

- **GitHub Pages เป็น public** (ฟรี tier) — โค้ดเห็นได้สาธารณะ แต่**ข้อมูลปลอดภัย**เพราะอยู่ใน
  Supabase หลัง login + RLS; anon key เป็น public key โดยดีไซน์
  (ถ้าไม่สบายใจ อัปเกรดเป็น private repo + Pages ได้ภายหลัง หรือย้ายไป Cloudflare Pages ฟรี)
- Supabase free tier หยุด project ที่ idle ~7 วัน — แอปนี้ใช้ทุกวันจึงไม่โดน แต่ถ้าหายไปเที่ยวยาว
  กลับมาแล้ว project ตื่นเองเมื่อมี request แรก (อาจช้าครั้งแรกครั้งเดียว)
