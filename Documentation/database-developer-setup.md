# Database Setup for Other Developers

> Follow this after pulling `Vishula---Dev` (or whatever branch/main this has
> merged into). Ten minutes, no guessing. If any step's output doesn't match
> what's shown, stop and compare before continuing — a mismatch here means
> every step after it will also be wrong.

---

## 0. What you're setting up

One shared PostgreSQL database (running in Docker), five schemas — one per
service — with five separate login roles enforcing which schema each
service can touch. Full model: [plan-b-reads-cross-schemas.md](./plan-b-reads-cross-schemas.md).
What was actually built: [database-implementation-log.md](./database-implementation-log.md).

You do **not** need to understand the full isolation model to get running —
just follow the steps below.

## 1. Prerequisites

- Docker Desktop, running
- Node.js 22+, npm
- Nothing else already listening on **port 5433** (check with the command in
  step 2 if `docker compose up` fails oddly)

**If you already have a native PostgreSQL installed on this machine and it's
running on port 5432**, that's fine and expected to coexist — this project
deliberately uses port **5433** on the host specifically to avoid that
conflict. See §7 if you hit connection errors anyway.

## 2. Pull and check the port is free

```powershell
git pull

# confirm nothing else is on 5433
Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue
```

If that returns nothing, you're clear. If it returns something, stop and
figure out what — don't proceed until 5433 is free.

## 3. Copy the environment file

There is no `.env` in git (it's gitignored — real secrets go there in
production). Create your own at the **repo root**:

```powershell
# from the repo root
@"
DATABASE_URL=postgresql://marketplace:marketplace@localhost:5433/vehicle_marketplace

AUTH_DATABASE_URL=postgresql://auth_service_role:dev_auth@localhost:5433/vehicle_marketplace
MARKETPLACE_DATABASE_URL=postgresql://marketplace_service_role:dev_marketplace@localhost:5433/vehicle_marketplace
INGESTION_DATABASE_URL=postgresql://ingestion_service_role:dev_ingestion@localhost:5433/vehicle_marketplace
NOTIFICATION_DATABASE_URL=postgresql://notification_service_role:dev_notification@localhost:5433/vehicle_marketplace
ADMIN_DATABASE_URL=postgresql://admin_service_role:dev_admin@localhost:5433/vehicle_marketplace
"@ | Out-File -FilePath .env -Encoding utf8 -NoNewline
```

These are local development passwords, hardcoded intentionally — they only
ever work against your own Docker container on localhost. Production uses
AWS Secrets Manager, not this file.

**Six variables, six different roles.** `DATABASE_URL` is the superuser —
used *only* by the `database/` package to run migrations. The other five are
scoped, least-privilege roles — each service reads its own. Never point a
service's `TypeOrmModuleOptions` at `DATABASE_URL`.

## 4. Start Postgres

```powershell
docker compose up -d
docker compose ps
```

Wait until the `STATUS` column shows `healthy`, not just `Up`. If it's your
very first time running this, the container's init scripts
(`database/docker/init/*.sql`) run automatically on startup — they create
the five schemas, both extensions, and the five roles. You'll see none of
this directly; it's silent unless something fails.

**Important gotcha, know this before you ever need it:** those init scripts
only run when the data volume is empty. If you ever need to re-run them
(e.g. someone adds a sixth role later), the only way is:

```powershell
docker compose down -v   # -v DESTROYS all data in the volume
docker compose up -d
```

Only do this if you're fine losing whatever's in your local database — it's
your dev copy, not shared, so this is usually safe, but it is destructive.

## 5. Run migrations and grants

```powershell
cd database
npm install
npm run migration:run
npm run grants
```

Expect `npm run migration:run` to report 17 migrations executed. If it
reports 0, migrations already ran (safe, means someone or something already
set this container up) — don't worry, `npm run grants` is idempotent and
safe to run again regardless.

**Verify it actually worked:**

```powershell
docker exec vehicle_marketplace_postgres psql -U marketplace -d vehicle_marketplace -c "\dn"
```

You should see five schemas: `auth`, `marketplace`, `ingestion`,
`notification`, `admin` (plus the default `public`).

## 6. Install and boot-test each service

Repeat for all five: `auth-user-service`, `marketplace-service`,
`ingestion-service`, `notification-service`, `admin-service`.

```powershell
cd ../auth-user-service    # adjust per service
npm install
npm run build
npm run start
```

Then, in another terminal (or just check the console — no errors means it
worked):

```powershell
curl http://localhost:3000/health   # port varies per service, see table below
```

Expect `{"status":"ok","service":"<name>"}`. If you instead see a stack
trace mentioning `ECONNREFUSED`, `password authentication failed`, or
`SASL`, see §7.

| Service | Port |
|---|---|
| auth-user-service | 3000 |
| marketplace-service | 3002 |
| admin-service | 3004 |
| ingestion-service | 3003 |
| notification-service | 3005 |

Stop each with `Ctrl+C` once confirmed — you don't need all five running
simultaneously unless you're actively testing cross-service behavior.

## 7. If something goes wrong

**`password authentication failed for user "marketplace"` or similar, on a
machine you know is running Docker correctly** — almost certainly a native
Postgres install on this machine is intercepting port 5432 (not 5433, so
this specific project shouldn't hit it — but if you changed the compose
port back to 5432 for any reason, this is why). Check:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { (Get-Process -Id $_.OwningProcess).ProcessName }
```

If that shows `postgres`, leave this project on 5433 — don't change it back.

**`SASL: ... client password must be a string` or `DATABASE_URL is
undefined`** — your `.env` file is missing or not being read. Confirm it
exists at the **repo root** (not inside `database/`), and confirm you're
running npm commands from inside `database/` (the `dotenv` path in
`data-source.ts` is `../.env`, relative to where npm runs from).

**`permission denied for table X`** — this might be Plan B working exactly
as intended, not a bug. Check whether the operation you're attempting is
actually allowed for that service — see
[plan-b-reads-cross-schemas.md](./plan-b-reads-cross-schemas.md) §3 for the
full grant list. If you're trying something that should be allowed and
isn't, the grant might be missing after a migration — re-run:

```powershell
cd database
npm run grants
```

**Container won't report healthy** — check its logs:

```powershell
docker compose logs postgres
```

## 8. What you should NOT do

- **Don't set `synchronize: true` anywhere.** Every `database.config.ts`
  has it hardcoded `false` with a comment explaining why — five services
  share one database, and a sync would reshape tables out from under the
  others. If you're tempted to flip it for convenience while developing,
  don't; write a migration instead.
- **Don't add a table to a schema you don't own.** Check
  [plan-b-reads-cross-schemas.md](./plan-b-reads-cross-schemas.md) §2 for
  the ownership map. If your feature needs data from another service's
  schema, either it's already a read-only view-entity (check that service's
  `entities/` folder for a `.view-entity.ts` file), or it needs a new
  cross-schema grant — which needs an FK justification (§3.1) and should be
  discussed, not added silently.
- **Don't hand-write SQL against the database outside of migrations** for
  anything that should persist — pgAdmin/DBeaver changes exist only on your
  machine and nobody else will ever see them. If the schema needs to
  change, write a migration:

  ```powershell
  cd database
  npm run migration:create -- src/migrations/YourDescriptiveName
  ```

- **Don't commit your `.env` file.** It's gitignored already; this is just
  a reminder not to force-add it.

## 9. Confirming you're in sync with everyone else

```powershell
cd database
npm run migration:show
```

Every migration should show `[X]` (applied). If any show `[ ]` (pending),
run `npm run migration:run` again. This is the fast way to check "am I on
the same schema version as everyone else" without comparing file lists by
hand.
