# Database migrations

This package owns the shared PostgreSQL database schema for the platform.
Migrations are written and executed with TypeORM.

## Configuration

Set `DATABASE_URL` before running a migration, for example:

```text
postgresql://user:password@localhost:5432/marketplace
```

## Commands

```bash
npm install
npm run migration:create -- src/migrations/create-users
npm run migration:generate -- src/migrations/schema-change
npm run migration:run
npm run migration:revert
npm run db:setup    # migration:run + grants
npm run verify      # smoke-test all five service roles (requires repo root .env)
npm run seed:dev    # local buyer / dealer / admin accounts (password: Password1)
```

Keep `synchronize: false`, and run migrations once through the deployment pipeline.
