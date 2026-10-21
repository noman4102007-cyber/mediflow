# MediFlow Backend

Node.js + Express + SQLite backend for MediFlow.

## Setup

```bash
npm install
cp .env.example .env
npm start
```

Server runs on `http://localhost:4000`. Database file `mediflow.db` is created
and seeded automatically on first run.

**Demo login:** `clinic-a` / `demo1234`
(other seeded clinics: `city-care`, `lifeline`, `green-valley`, `sunrise`, `apollo`, `careplus` — all use the same password `demo1234`)

## API Reference

All routes except `/api/auth/login` require header: `Authorization: Bearer <token>`

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/login` | `{ clinicId, password }` → `{ token, clinic }` |
| GET | `/api/dashboard/summary` | Critical/Medium/Stable counts for dashboard.html |
| GET | `/api/medicines` | Full inventory with computed risk (inventory.html) |
| GET | `/api/medicines/:name/risk` | Single medicine detail + recommendation (risk.html) |
| POST | `/api/medicines` | Add a medicine `{ name, stock, dailyUsage, unit }` |
| PUT | `/api/medicines/:id` | Update stock/usage |
| DELETE | `/api/medicines/:id` | Remove a medicine |
| GET | `/api/surplus/medicines` | List of medicine names for the dropdown |
| GET | `/api/surplus/:medicineName` | Nearby clinics with genuine surplus, sorted by real distance |
| POST | `/api/transfers` | Request a transfer `{ providerClinicId, medicineName, quantity }` |
| GET | `/api/transfers` | List transfer requests involving this clinic |
| PUT | `/api/transfers/:id` | Provider accepts/rejects/completes `{ status }` |

## What changed vs. the original static prototype

- Risk calculation (days remaining, CRITICAL/MEDIUM/STABLE) now lives in one place
  (`utils/risk.js`) instead of being copy-pasted in 3 different HTML files.
- Real authentication (bcrypt + JWT) instead of a client-side "is field empty" check.
- Surplus distances are computed with the Haversine formula from real clinic
  coordinates, instead of hardcoded numbers.
- "Surplus" now means the donor clinic's own stock is STABLE — sharing won't
  put them at risk too.
- New: transfer requests let a clinic actually act on a surplus match
  (request → accept/reject → completed, which moves stock between clinics),
  not just view a read-only list.
