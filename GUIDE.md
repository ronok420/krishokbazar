# 🌾 কৃষকবাজার — সম্পূর্ণ Setup গাইড
## Node.js + Express + PostgreSQL + HTML Frontend

---

## 📁 Project এর ভেতরে কী আছে?

```
krishokbazar-node/
│
├── 📁 backend/                     ← Node.js Backend (API Server)
│   ├── 📁 src/
│   │   ├── 📁 config/
│   │   │   ├── db.js               ← PostgreSQL সংযোগ
│   │   │   └── migrate.js          ← Database Table তৈরি করার script
│   │   ├── 📁 middleware/
│   │   │   ├── auth.js             ← JWT Token চেক
│   │   │   └── upload.js           ← ছবি আপলোড (Multer)
│   │   ├── 📁 controllers/
│   │   │   ├── authController.js   ← Register, Login, Profile
│   │   │   ├── productController.js← পণ্য যোগ, দেখা, আপডেট
│   │   │   ├── orderController.js  ← অর্ডার, status, দরদাম
│   │   │   └── chatController.js   ← Direct messaging
│   │   ├── 📁 routes/
│   │   │   ├── auth.js             ← /api/auth/* routes
│   │   │   ├── products.js         ← /api/products/* routes
│   │   │   ├── orders.js           ← /api/orders/* routes
│   │   │   └── chat.js             ← /api/chat/* routes
│   │   └── server.js               ← Express App শুরু হয় এখান থেকে
│   ├── package.json                ← Node.js packages list
│   └── .env.example                ← Environment config template
│
└── 📁 frontend/
    ├── index.html                  ← পুরো Website (5 pages)
    └── api.js                      ← Backend ↔ Frontend সংযোগ

```

---

# ═══════════════════════════════════════
# STEP 1 — প্রয়োজনীয় Software Install
# ═══════════════════════════════════════

## ① Node.js Install করুন
- লিংক: https://nodejs.org
- **LTS version** download করুন (যেমন: 20.x.x)
- Install করুন (সব default রাখুন)

✅ চেক করুন:
```bash
node --version    # v20.x.x দেখাবে
npm --version     # 10.x.x দেখাবে
```

## ② PostgreSQL Install করুন
- লিংক: https://www.postgresql.org/download/
- Windows হলে installer দিয়ে install করুন
- **Install এর সময় একটা password দিন — মনে রাখুন!**
- Default port: **5432** (পরিবর্তন করবেন না)

---

# ═══════════════════════════════════════
# STEP 2 — Database তৈরি করুন
# ═══════════════════════════════════════

## pgAdmin দিয়ে (সহজ):
1. pgAdmin খুলুন
2. বাম দিকে **Servers → PostgreSQL → Databases** তে right-click
3. **Create → Database** click করুন
4. Name দিন: `krishokbazar`
5. **Save** করুন

## অথবা Terminal দিয়ে:
```bash
psql -U postgres
```
Password দিন, তারপর:
```sql
CREATE DATABASE krishokbazar;
\q
```

---

# ═══════════════════════════════════════
# STEP 3 — Project Setup
# ═══════════════════════════════════════

## ZIP extract করুন
`krishokbazar-node.zip` extract করুন।

## Terminal খুলুন — backend folder এ যান:
```bash
cd krishokbazar-node/backend
```

## Packages install করুন:
```bash
npm install
```
> ⏳ একটু সময় লাগবে। `node_modules` folder তৈরি হবে।

---

# ═══════════════════════════════════════
# STEP 4 — Environment Variables (.env)
# ═══════════════════════════════════════

```bash
# .env.example কপি করুন
copy .env.example .env        # Windows
cp .env.example .env          # Mac/Linux
```

`.env` file খুলুন (Notepad বা VS Code দিয়ে) এবং এভাবে পূরণ করুন:

```env
PORT=8000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=5432
DB_NAME=krishokbazar
DB_USER=postgres
DB_PASSWORD=আপনার_postgresql_password_এখানে

JWT_SECRET=krishokbazar-secret-key-2025-xyz
JWT_EXPIRES_IN=7d

FRONTEND_URL=http://127.0.0.1:5500
```

> ⚠️ **গুরুত্বপূর্ণ:** `DB_PASSWORD` তে PostgreSQL install এর সময় দেওয়া password লিখুন।

---

# ═══════════════════════════════════════
# STEP 5 — Database Table তৈরি করুন
# ═══════════════════════════════════════

```bash
npm run migrate
```

Terminal এ এরকম দেখাবে:
```
✅ PostgreSQL সংযুক্ত!
📦 Migration শুরু হচ্ছে...
  ✅ users table
  ✅ farmer_profiles table
  ✅ categories table
  ✅ products table
  ✅ product_reviews table
  ✅ orders table
  ✅ conversations table
  ✅ messages table
  ✅ Default categories inserted
🎉 Migration সফল!
```

---

# ═══════════════════════════════════════
# STEP 6 — Backend Server চালু করুন
# ═══════════════════════════════════════

## Development mode (auto-restart):
```bash
npm run dev
```

## অথবা Normal mode:
```bash
npm start
```

Terminal এ দেখবেন:
```
🌾 ================================
   কৃষকবাজার Backend চলছে!
   http://localhost:8000
   API: http://localhost:8000/api/health
🌾 ================================
```

## ✅ Test করুন:
Browser এ যান: **http://localhost:8000/api/health**

এই JSON দেখলে সফল:
```json
{
  "status": "ok",
  "message": "🌾 কৃষকবাজার API চলছে!",
  "time": "2025-04-13T..."
}
```

---

# ═══════════════════════════════════════
# STEP 7 — Frontend চালু করুন
# ═══════════════════════════════════════

## VS Code Live Server দিয়ে (সবচেয়ে ভালো):
1. VS Code install করুন: https://code.visualstudio.com
2. Extension install করুন: **Live Server** (Ritwick Dey)
3. `frontend/index.html` file খুলুন VS Code এ
4. নিচে **"Go Live"** বোতামে click করুন
5. Browser এ **http://127.0.0.1:5500** খুলবে

## অথবা সরাসরি:
`frontend/index.html` ফাইলটি browser এ drag করুন।

> ✅ Backend চললে yellow banner **দেখাবে না** — সব ঠিকঠাক!
> ⚠️ Backend না চললে yellow banner দেখাবে — Demo mode এ চলবে।

---

# ═══════════════════════════════════════
# STEP 8 — সব কিছু Test করুন
# ═══════════════════════════════════════

## 🧪 Test 1: কৃষক হিসেবে Register
1. Frontend এ **লগইন / রেজিস্টার** click করুন
2. **নিবন্ধন** tab এ যান
3. **কৃষক** select করুন
4. নাম, ফোন, জেলা, পাসওয়ার্ড দিন
5. **অ্যাকাউন্ট তৈরি করুন** click করুন
6. ✅ "অ্যাকাউন্ট তৈরি হয়েছে!" toast দেখবেন
7. কৃষক Dashboard এ চলে যাবে

## 🧪 Test 2: পণ্য যোগ করুন
1. কৃষক Dashboard এ **নতুন পণ্য যোগ করুন** section খুঁজুন
2. পণ্যের নাম, পরিমাণ, দাম দিন
3. **প্রকাশ করুন** click করুন
4. ✅ "পণ্য প্রকাশিত হয়েছে!" দেখবেন

## 🧪 Test 3: ক্রেতা হিসেবে Login ও Order
1. **লগআউট** করুন (নাম এ click করুন)
2. আবার Register করুন — এবার **ক্রেতা** select করুন
3. **পণ্য** page এ যান
4. যেকোনো পণ্যে **অর্ডার** click করুন
5. পরিমাণ ও ঠিকানা দিয়ে **নিশ্চিত করুন**
6. ✅ "অর্ডার দেওয়া হয়েছে!" দেখবেন

## 🧪 Test 4: কৃষকের Dashboard এ Order দেখুন
1. কৃষক account এ login করুন
2. Dashboard এ অর্ডার টেবিলে নতুন order দেখবেন
3. **✅ গ্রহণ** বা **❌ বাতিল** করুন

---

# ═══════════════════════════════════════
# STEP 9 — Railway তে Free Deploy
# ═══════════════════════════════════════

## ① GitHub এ code push করুন:
```bash
cd krishokbazar-node/backend
git init
git add .
git commit -m "Initial commit"
```
GitHub এ নতুন repository তৈরি করুন, তারপর:
```bash
git remote add origin https://github.com/YOUR_USERNAME/krishokbazar.git
git push -u origin main
```

## ② Railway.app এ যান:
1. **railway.app** এ GitHub দিয়ে signup করুন
2. **New Project** click করুন
3. **Deploy from GitHub repo** select করুন
4. আপনার `krishokbazar` repository select করুন
5. Railway নিজেই deploy শুরু করবে

## ③ PostgreSQL database যোগ করুন:
1. Project dashboard এ **+ New** click করুন
2. **Database → Add PostgreSQL** click করুন
3. Railway নিজেই database তৈরি করবে

## ④ Environment Variables দিন:
Railway Dashboard → **Variables** tab:
```
PORT               = 8000
NODE_ENV           = production
JWT_SECRET         = krishokbazar-production-secret-key
JWT_EXPIRES_IN     = 7d
FRONTEND_URL       = https://আপনার-frontend-url.vercel.app
```

Database variables Railway নিজেই দেবে (DB_HOST, DB_PORT, etc.)

## ⑤ Deploy হওয়ার পর Migrate করুন:
Railway Dashboard → **Shell** tab:
```bash
npm run migrate
```

## ⑥ Frontend এর api.js আপডেট করুন:
```javascript
// আপনার Railway URL দিন
const API_BASE = 'https://krishokbazar-production.railway.app/api';
```

## ⑦ Frontend Vercel এ Deploy:
1. **vercel.com** এ যান
2. **frontend** folder drag & drop করুন
3. Deploy হয়ে যাবে!

---

# ═══════════════════════════════════════
# ❌ সমস্যা সমাধান (Troubleshooting)
# ═══════════════════════════════════════

## সমস্যা: "Cannot find module 'express'"
```bash
# backend folder এ আছেন কিনা চেক করুন
cd krishokbazar-node/backend
npm install
```

## সমস্যা: "password authentication failed for user postgres"
- `.env` file এ `DB_PASSWORD` সঠিক দিন
- PostgreSQL service চলছে কিনা চেক করুন

## সমস্যা: Browser এ "CORS error"
- `.env` এ `FRONTEND_URL=http://127.0.0.1:5500` আছে কিনা দেখুন
- Backend চলছে কিনা দেখুন: http://localhost:8000/api/health

## সমস্যা: Frontend এ পণ্য দেখাচ্ছে না
- Backend চালু আছে কিনা দেখুন
- Browser Console (F12) এ error দেখুন
- পণ্য যোগ করা আছে কিনা নিশ্চিত করুন

## সমস্যা: "relation does not exist"
```bash
# Migration আবার চালান
npm run migrate
```

---

# 📡 সব API Endpoints

```
🔐 AUTH
POST   /api/auth/register          → নিবন্ধন
POST   /api/auth/login             → লগইন (token পাবেন)
GET    /api/auth/me                → নিজের profile
PATCH  /api/auth/me                → profile আপডেট
GET    /api/auth/farmers           → সব কৃষক
GET    /api/auth/farmers/:id       → একজন কৃষক
GET    /api/health                 → Server status

🌾 PRODUCTS
GET    /api/products               → সব পণ্য
GET    /api/products?search=টমেটো → সার্চ
GET    /api/products?district=ঢাকা → জেলা filter
GET    /api/products?is_organic=true → জৈব filter
GET    /api/products?ordering=price_asc → সস্তা আগে
POST   /api/products               → পণ্য যোগ (কৃষক)
GET    /api/products/mine          → আমার পণ্য
GET    /api/products/categories    → category list
GET    /api/products/:id           → একটি পণ্য
PATCH  /api/products/:id           → পণ্য আপডেট
DELETE /api/products/:id           → পণ্য মুছুন
POST   /api/products/:id/review    → রিভিউ দিন
GET    /api/products/:id/reviews   → রিভিউ দেখুন

📦 ORDERS
POST   /api/orders                 → অর্ডার দিন
GET    /api/orders                 → আমার অর্ডার (ক্রেতা)
GET    /api/orders/incoming        → incoming অর্ডার (কৃষক)
GET    /api/orders/:id             → একটি অর্ডার
PATCH  /api/orders/:id/status      → accepted/rejected/delivered
POST   /api/orders/:id/bargain     → দরদামের প্রস্তাব

💬 CHAT
GET    /api/chat                   → সব conversation
POST   /api/chat/start             → নতুন chat শুরু
GET    /api/chat/:id/messages      → বার্তা দেখুন
POST   /api/chat/:id/messages      → বার্তা পাঠান
```

---

# 🆘 কোনো সমস্যা হলে?
Error message copy করে আমাকে দেখান। সাথে সাথে সমাধান করে দেব! 🤝
