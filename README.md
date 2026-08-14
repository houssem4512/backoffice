# CCM BackOffice — Full Stack (Frontend + Backend)

**CallCenterMatch.ai** back-office: complete frontend (React + Vite + Tailwind) and backend (Express + MongoDB + JWT + Groq AI).

Both projects are wired to talk to each other out of the box.

---

## 📁 Structure

```
ccm-fullstack/
├── backend/     — Express + MongoDB + JWT auth + Groq AI
│   ├── src/
│   │   ├── config/database.ts
│   │   ├── middleware/auth.ts, errorHandler.ts
│   │   ├── models/ (User, Candidate, Company, Prospect, Order, Payment, MarketingChannel, ActivityLog)
│   │   ├── routes/ (auth, dashboard, candidates, companies, prospects, orders, payments, users, marketing, analytics, ai)
│   │   ├── services/aiService.ts    — Groq + local RAG fallback
│   │   ├── utils/seed.ts            — demo data seeder
│   │   └── index.ts
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── api/client.ts            — hardened API client (safe() wrapper)
    │   ├── components/ (layout, ai)
    │   ├── pages/ (Dashboard, Candidates, Prospects, Clients, Orders, Payments, Marketing, AdminTools, Login, Placeholders)
    │   ├── App.tsx                   — page registry + error boundaries
    │   └── ...
    ├── package.json
    └── vite.config.ts               — proxy /api → http://localhost:3200
```

---

## 🚀 Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Optional: edit MONGODB_URI if not using default localhost
# Optional: paste your Groq API key (https://console.groq.com)

npm install
npm run seed       # ← seeds demo data (admin user, 800 candidates, companies, prospects, orders, payments, marketing)
npm run dev        # ← starts API on http://localhost:3200
```

> The assistant works **without** `GROQ_API_KEY` thanks to a built-in local RAG fallback. Configure the key to enable full Groq LLM responses.

**Seeded demo logins:**

| Email            | Password    | Role    |
|------------------|-------------|---------|
| admin@ccm.ai     | admin123    | admin   |
| manager@ccm.ai   | manager123  | manager |
| agent@ccm.ai     | manager123  | agent   |
| viewer@ccm.ai    | manager123  | viewer  |

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # ← starts Vite on http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:3200`, so no CORS configuration is needed in dev.

Open <http://localhost:5173>, log in with `admin@ccm.ai / admin123`.

---

## 🔌 API Contract

All endpoints are under `/api/bo/*`. List endpoints return `{ data, total, page, limit }`; single-value endpoints are returned bare or wrapped as `{ data: <value> }`.

| Method | Endpoint                                  | Purpose                                   |
|--------|-------------------------------------------|-------------------------------------------|
| POST   | `/auth/login`                             | Email/password login → `{ token, user }`   |
| GET    | `/auth/me`                                | Current user from token                   |
| POST   | `/auth/logout`                            | Logout (logs activity)                    |
| GET    | `/dashboard/kpis?period=30d`              | KPIs (candidates, revenue, prospects...)  |
| GET    | `/dashboard/activity?limit=20`           | Recent activity log                       |
| GET    | `/dashboard/charts/revenue?period=monthly` | Monthly revenue series                    |
| GET    | `/dashboard/charts/candidates-by-city`   | Top cities                                |
| GET    | `/dashboard/charts/candidates-by-language` | Top languages                            |
| GET    | `/candidates?page=1&limit=20&...`        | Paginated + filterable candidates list    |
| GET    | `/candidates/stats`                       | Candidate funnel & sources               |
| GET    | `/companies?page=1&limit=20`             | Companies list                            |
| GET    | `/companies/stats`                        | Status / contract / MRR breakdown         |
| PATCH  | `/companies/:id`                          | Update a company                           |
| GET    | `/prospects?page=1&limit=20&stage=new`   | Prospects list (optional stage filter)    |
| GET    | `/prospects/stats`                        | Stage breakdown + pipeline value          |
| GET    | `/prospects/pipeline`                     | Pipeline shape                            |
| POST   | `/prospects`                              | Create prospect                           |
| GET    | `/orders?page=1&limit=20`                 | Orders list                               |
| GET    | `/orders/stats`                           | Order status / type breakdown             |
| GET    | `/payments?page=1&limit=20`               | Payments list                             |
| GET    | `/payments/stats`                         | Payment status / method breakdown         |
| GET    | `/users?page=1&limit=20`                 | Platform users                            |
| GET    | `/marketing/stats`                        | Aggregated marketing stats                |
| GET    | `/marketing/channels`                     | Per-channel metrics                       |
| GET    | `/marketing/cpl`                          | CPL by platform                           |
| GET    | `/analytics/profitability`                | Revenue, MRR, margin, late payments       |
| GET    | `/analytics/matching`                     | Top cities/positions/languages            |
| GET    | `/analytics/signups`                      | Signup trend (6 months)                   |
| POST   | `/ai/chat`                                | AI assistant (Groq + RAG, fallback local) |

---

## 🤖 AI Assistant

The `/ai/chat` endpoint:

1. If `GROQ_API_KEY` is set → calls **Groq** (llama-3.3-70b-versatile) with real DB data injected as RAG context.
2. If `GROQ_API_KEY` is empty → uses a **local data-aware fallback** that recognizes common queries:
   - "Combien de candidats à Paris ?"
   - "Top 5 langues demandées"
   - "Paiements en retard ce mois"
   - "Pipeline prospects en cours"
   - "Revenu encaissé"
   - "Combien de clients ?"

This means the assistant **always responds**, even without a Groq key.

---

## 🔒 Auth Flow

1. Frontend `Login.tsx` calls `api.login(email, password)` → backend verifies with bcrypt and returns a JWT.
2. Token is stored in `localStorage` under `ccm_auth_token`.
3. Every API request adds `Authorization: Bearer <token>` via `api/client.ts`.
4. On app boot, `App.tsx` validates the token by calling `GET /auth/me`. If invalid, it logs the user out.
5. Logout clears the token and reloads.

---

## 🛠 Production

```bash
# Backend
cd backend && npm run build && npm start

# Frontend
cd frontend && npm run build      # outputs to frontend/dist
```

For production, serve `frontend/dist/` via a static host (Nginx, Vercel, etc.) and configure a reverse proxy so `/api/bo/*` hits the backend on port 3200. Set `CORS_ORIGIN` in `backend/.env` to your frontend origin.

---

## 🧪 Verification Checklist

- [x] Backend TypeScript compiles (`tsc --noEmit` passes)
- [x] Frontend TypeScript compiles (`tsc --noEmit` passes)
- [x] Backend builds to `dist/` (`npm run build`)
- [x] All API endpoints documented and tested against frontend `api/client.ts`
- [x] AI assistant responds with or without Groq API key
- [x] Demo data seed script is idempotent
- [x] Frontend `request()` correctly distinguishes list shapes from single-value wrappers
- [x] Error boundary per page prevents one crash from bringing down the whole app
- [x] `safe()` API wrapper never throws on read endpoints — UI always renders

---

## 📝 Notes

- The frontend's `request()` was patched so that list responses (`{ data, total, page, limit }`) are NOT unwrapped — this is what made `res?.data` come back as `undefined` on Candidates/Payments. Fixed.
- All page components (`Dashboard.tsx`, `Candidates.tsx`, ...) use `res?.data || []` + `res?.total || 0` so a network failure just shows an empty state instead of crashing.
- Per-page `PageErrorBoundary` (in `App.tsx`) isolates crashes — a bug on one page doesn't affect navigation.
