# Momentum — Day Journey Timeline: Design Doc

วันที่: 2026-06-14
สถานะ: approved in chat, รอ review ไฟล์ spec ก่อนเขียน implementation plan

## 1. ภาพรวม

เพิ่มระบบย้อนดูว่าในวันหนึ่งเราทำอะไรไปบ้าง โดยเริ่มจากหน้า day detail ที่เปิดได้จาก Week/Month
แล้วเห็น timeline ของวันนั้นตั้งแต่ 00:00-23:59 แบบ activity lanes
(แยกแถวตามเสาหลัก) พร้อม checkpoint ตอนทำครบ target ของเสานั้น

ฟีเจอร์นี้ต้องวางฐานแบบ multi-user ตั้งแต่แรก เพราะอนาคตจะให้เพื่อนใช้ด้วย:

- diary, notes, timeline, sessions, score, hours เป็น private ของเจ้าของ
- เพื่อนเห็นได้เฉพาะ live status ตอนนี้ เช่น `Skill & Income · Code`
- note ใน live status แชร์ได้เฉพาะเมื่อเปิด toggle บน pillar card นั้น
- เพื่อนไม่เห็นชั่วโมง, เวลาเริ่ม, score, timeline, win หรือ reflection

หลักการ: **ข้อมูลส่วนตัว private ก่อน, social เฉพาะที่ตั้งใจแชร์**

## 2. Scope

### In scope

- แตะวันใน Week/Month เพื่อเปิด day detail
- day detail แสดง activity lanes 00:00-23:59
- timer sessions จริงแสดงเป็น bar สีตามเสา
- checkpoint เป็น check badge สีตามเสา ตอนเสานั้นครบ target/ได้คะแนนเต็ม
- ถ้าทำต่อหลังครบ target, bar ต่อได้ แต่คะแนนไม่เพิ่ม
- แตะ checkpoint badge เพื่อดูเวลาที่ทำครบ target เช่น `13:42`
- manual minutes นับคะแนนและยอดรวม แต่ไม่โชว์บน timeline
- แก้ win/reflection/note ของวันเก่าได้
- ไม่แก้ activity sessions ใน v1
- share card เป็น graph + summary: timeline, badges, score, ชั่วโมงรวมต่อเสา
- เพิ่ม friend live status แบบ minimal: เสา + tag + optional shared note
- เพิ่มฐานข้อมูล multi-user และ RLS ที่แยกข้อมูลของแต่ละ user

### Out of scope v1

- แก้ session start/end ย้อนหลัง
- ให้เพื่อนดู timeline/score/hours ของกันและกัน
- public feed
- full friend request UI ที่ซับซ้อน
- notification
- offline support
- export share card เป็นรูปภาพแบบ pixel-perfect ถ้ายังไม่จำเป็นในรอบแรก

## 3. Data Model

ระบบปัจจุบันใช้ `days` และ `app_state` แบบ single-user. รอบนี้ต้องเพิ่ม owner (`user_id`) และตารางใหม่
เพื่อรองรับหลายบัญชีอย่างปลอดภัย

### `profiles`

ข้อมูล public เล็ก ๆ ของ user

```sql
id uuid primary key references auth.users(id) on delete cascade,
display_name text not null,
created_at timestamptz not null default now()
```

เพื่อนที่ accepted อ่านได้เฉพาะข้อมูล public นี้

### `days`

เพิ่ม `user_id` และเปลี่ยน primary key เป็น `(user_id, date)`

```sql
user_id uuid not null references auth.users(id) on delete cascade,
date date not null,
data jsonb not null default '{}'::jsonb,
score int not null default 0,
updated_at timestamptz not null default now(),
primary key (user_id, date)
```

`days.data` ยังใช้ shape เดิม: minutes, tags, notes, win, reflect, points

### `app_state`

เพิ่ม `user_id` และเปลี่ยน primary key เป็น `(user_id, key)`

```sql
user_id uuid not null references auth.users(id) on delete cascade,
key text not null,
value jsonb,
primary key (user_id, key)
```

ใช้เก็บ `timer`, `targets`, `mission` แยกตาม user

### `activity_sessions`

ตารางใหม่สำหรับวาด timeline จริง

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
date date not null,
pillar text not null,
started_at timestamptz not null,
ended_at timestamptz not null,
minutes int not null,
tag_ids text[] not null default '{}',
note_snapshot text not null default '',
created_at timestamptz not null default now()
```

- `date` คือวันที่เริ่ม session ตาม local date ของ user
- ถ้า timer ข้ามเที่ยงคืน ยัง credit วันที่เริ่มเหมือนระบบเดิม
- `note_snapshot` เก็บ note ณ ตอนหยุด timer เพื่อให้ history ของวันนั้นไม่เปลี่ยนไปมา
- manual minutes ไม่สร้าง row ใน `activity_sessions`

### `friendships`

ความสัมพันธ์เพื่อน

```sql
requester_id uuid not null references auth.users(id) on delete cascade,
addressee_id uuid not null references auth.users(id) on delete cascade,
status text not null check (status in ('pending', 'accepted')),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
primary key (requester_id, addressee_id)
```

ใน v1 อาจเริ่มจาก seed/manual insert เพื่อไม่ทำ UI friend requests ใหญ่เกินไป

### `live_status`

ข้อมูลที่เพื่อนอ่านได้แบบจำกัด

```sql
user_id uuid primary key references auth.users(id) on delete cascade,
pillar text,
tag_ids text[] not null default '{}',
shared_note text not null default '',
is_tracking boolean not null default false,
updated_at timestamptz not null default now()
```

ไม่เก็บ score, hours, started_at, timeline, win, reflection ใน table นี้

## 4. RLS

RLS ต้องแยก private data กับ friend-visible data ชัดเจน

- `days`: owner อ่าน/เขียนได้เฉพาะ row ของตัวเอง
- `app_state`: owner อ่าน/เขียนได้เฉพาะ row ของตัวเอง
- `activity_sessions`: owner อ่าน/เขียนได้เฉพาะ row ของตัวเอง
- `profiles`: owner อ่าน/เขียนตัวเอง; accepted friends อ่านได้
- `friendships`: user อ่าน row ที่ตัวเองเป็น requester/addressee
- `live_status`: owner เขียนของตัวเอง; accepted friends อ่านได้
- non-friend อ่าน `live_status` ไม่ได้
- ไม่มี policy ที่เปิดให้ `authenticated` อ่าน private table ทั้งหมดอีกต่อไป

## 5. Timer And Session Flow

### Start timer

1. ถ้ามี timer เดิม ให้ stop และ bank session เดิมก่อน
2. ตั้ง `app_state.timer = {pillar, started_at}`
3. update `live_status`:
   - `is_tracking = true`
   - `pillar = current pillar`
   - `tag_ids = selected tags ของเสานั้น`
   - `shared_note = note ของเสานั้น เฉพาะถ้า toggle แชร์ note เปิดอยู่`

### Stop timer

1. verify timer กับ database เพื่อกัน cross-device race เหมือน logic เดิม
2. คำนวณ minutes จาก `started_at` ถึง now
3. เพิ่ม minutes เข้า `days.data.minutes[pillar]`
4. save day พร้อม score/points ใหม่
5. ถ้า minutes > 0 สร้าง `activity_sessions` row
6. clear `app_state.timer`
7. update `live_status` เป็น not tracking

### Cross-midnight

ถ้า session เริ่มก่อนเที่ยงคืนและหยุดหลังเที่ยงคืน:

- minutes ทั้งหมดเข้า date ที่เริ่ม session
- `activity_sessions.date` เป็น date ที่เริ่ม session
- timeline ของวันเริ่มอาจมี bar ที่ลากไปถึง 23:59 เท่านั้นใน v1 ถ้าต้อง render ส่วนหลังเที่ยงคืนให้ครบค่อยแยก logic ภายหลัง

## 6. Day Detail UI

เปิดจาก Week/Month โดยแตะวันที่

เนื้อหา:

- วันที่, score, status, ชั่วโมงรวมของตัวเอง
- activity lanes 00:00-23:59
- lane แยกตามเสา
- session bar สีตามเสา
- check badge สีตามเสาเมื่อครบ target
- แตะ badge แล้วโชว์ checkpoint time
- รายการ notes/win/reflection ด้านล่างแบบ minimal
- ปุ่ม share

ข้อจำกัด:

- ถ้ามี manual minutes แต่ไม่มี session จะเห็นใน summary/hours แต่ไม่เห็นบน timeline
- วันเก่าที่ไม่มี `activity_sessions` จะแสดงข้อความว่า timeline starts after this feature was added
- แก้ note/win/reflection ได้
- แก้ session ไม่ได้ใน v1

## 7. Checkpoint Logic

Checkpoint คำนวณจาก cumulative session minutes ของเสานั้นในวันนั้น

ตัวอย่าง:

- target Skill = 240 นาที
- ก่อน session มี 210 นาที
- session ใหม่ยาว 60 นาที
- checkpoint เกิด 30 นาทีหลัง session start
- badge อยู่ที่เวลานั้น
- bar ยังลากต่ออีก 30 นาทีหลัง badge

ถ้า manual minutes ทำให้ครบ target แต่ไม่มี session ที่ cross target:

- คะแนน/summary ครบ
- ไม่มี badge บน timeline เพราะไม่มีเวลาเกิด checkpoint จริง

## 8. Share Card

Share card ใช้แนว **Graph + summary**

แสดง:

- วันที่
- score/status ของเจ้าของ
- timeline แบบ activity lanes
- check badges
- ชั่วโมงรวมต่อเสา

ไม่แสดง:

- note ส่วนตัว
- win/reflection
- exact live started_at
- friend/private info

เป้าหมายคือให้ภาพการกระทำและความต่อเนื่องพูดแทนคำอธิบายยาว ๆ

## 9. Friend Live Status

เพิ่ม section เล็ก ๆ เช่น `Friends now`

แสดงเฉพาะ accepted friends:

- ถ้ากำลังจับเวลา: `Display Name · Pillar · Tag`
- ถ้าเปิด share note บน pillar card: `Display Name · Pillar · Tag — shared note`
- ถ้าไม่ได้จับเวลา: อาจแสดง `Not tracking` หรือซ่อนไว้ใน active list

ไม่แสดง:

- จำนวนชั่วโมง
- เวลาเริ่ม
- score
- timeline
- private note ถ้า toggle ปิด
- win/reflection

บน pillar card ของเรา:

- เพิ่ม toggle `Share note with friends`
- toggle เป็น per-pillar/per-current-context
- default ปิด
- เมื่อเปิด toggle แล้วกำลังจับเวลาเสานั้น `live_status.shared_note` ใช้ note ของเสานั้น
- เมื่อปิด toggle ให้ clear `shared_note`

## 10. Error Handling

- database errors ต้อง show error banner และ throw ต่อ เหมือน pattern เดิม
- ไม่มี empty `catch {}`
- ถ้า save day สำเร็จแต่ create session fail ต้อง surface error เพื่อไม่ให้ timeline หายเงียบ
- retry ควร retry operation ล่าสุดเท่าที่ทำได้
- RLS error ต้องแสดงเป็น error จริง ไม่ fallback ไปอ่านข้อมูลคนอื่น/ข้อมูล empty แบบเงียบ ๆ

## 11. Testing

### Unit tests

เพิ่ม pure helpers สำหรับ:

- session duration
- cross-midnight date credit
- checkpoint placement
- multiple sessions ในเสาเดียวกัน
- manual minutes ไม่สร้าง checkpoint
- target reached ก่อน session เริ่มแล้วไม่สร้าง badge ซ้ำ

### Manual UI tests

- start/stop timer แล้ว day detail มี bar
- ทำครบ target แล้ว check badge ขึ้นสีถูก
- ทำต่อหลังครบ target แล้ว bar ต่อหลัง badge
- แตะ badge แล้วเห็นเวลาที่ครบ target
- manual minutes เพิ่ม score/hours แต่ไม่ขึ้น timeline
- แก้ note/win/reflection ในวันเก่าแล้ว save ได้
- share card ไม่มี note ส่วนตัว
- friend เห็น live status pillar + tag
- friend ไม่เห็น hours/score/timeline
- friend เห็น shared note เฉพาะเมื่อ toggle เปิด

### SQL/RLS tests

ควร verify ใน Supabase SQL หรือ manual account test:

- user A อ่าน `days` ของ user B ไม่ได้
- user A อ่าน `activity_sessions` ของ user B ไม่ได้
- user A อ่าน `live_status` ของ accepted friend B ได้
- user A อ่าน `live_status` ของ non-friend C ไม่ได้
- user A update `live_status` ของ user B ไม่ได้

## 12. Migration Notes

ระบบเดิมเป็น single-user และตารางไม่มี `user_id`

ในการ migrate:

- เพิ่ม `user_id` ให้ rows เดิมโดย map ไปยัง account ปัจจุบัน
- เปลี่ยน primary keys ของ `days` และ `app_state`
- update RLS จาก authenticated full access เป็น owner-based policy
- existing days จะไม่มี `activity_sessions`; timeline จะเริ่มมีข้อมูลหลังฟีเจอร์นี้ถูกใช้

## 13. Open Decisions Locked In This Spec

- ใช้ activity lanes ไม่ใช้ cumulative hours line
- checkpoint ใช้ check badge สีตามเสา
- exact checkpoint time แสดงตอนแตะ badge
- manual minutes ไม่แสดงบน timeline
- share card เป็น graph + summary
- day detail แก้ note/win/reflection ได้ แต่ไม่แก้ sessions
- multi-user foundation ทำตอนนี้
- friend status เห็น pillar + tag + optional shared note
- note sharing เป็น toggle บน pillar card และ default ปิด
