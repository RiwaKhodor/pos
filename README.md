# Store POS

Retail POS + back office with fixed roles: **OWNER** and **EMPLOYEE**.

Style matches a classic desktop retail app. No company profiles, banks, suppliers, salesmen, help center, or customer personal data.

## Stack

- Next.js (App Router) + React + TypeScript
- Prisma ORM → **Supabase PostgreSQL**
- JWT cookie auth (`JWT_SECRET`) with OWNER / EMPLOYEE roles

## Database setup (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → Database** and copy:
   - **Connection string (Transaction / pooler, port 6543)** → `DATABASE_URL`
   - **Direct connection (port 5432)** → `DIRECT_URL`
3. Copy env template and fill values:

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...@db.[PROJECT-REF].supabase.co:5432/postgres"
JWT_SECRET="a-long-random-secret"
```

Do **not** put the Supabase **service role** key in this app. Prisma uses `DATABASE_URL` only on the server.

4. Apply schema and seed demo data (fresh DB — no SQLite import):

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Local `prisma/dev.db` (old SQLite) is unused and ignored. Do not point `DATABASE_URL` at a `file:` SQLite path.

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| OWNER | owner@store.com | owner123 |
| EMPLOYEE | cashier@store.com | employee123 |

## What owners get

- **List of Items** / **New Item**
- **Sales Statistics**
- **Profit & Loss**
- Sales list, expenses, categories, stock adjust, cashiers, payment methods, preferences
- Full POS

## What cashiers get

- POS
- Their own sales / receipts

## Intentionally not included

- Suppliers / purchases
- Banks / cash accounts / transfers
- Salesmen
- Customer personal info
- Help / company profile modules
