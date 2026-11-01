# WaveHouse Backend

Requires Node.js 24 LTS. MongoDB is the default persistence backend; an explicitly
selected all-PostgreSQL catalog can run without MongoDB in local development/test. From this directory:

```sh
npm ci
```

Copy `.env.example` to `.env`, then run `npm run dev`. For compiled output,
run `npm run build` followed by `npm start`. Startup exits with an error if
a required database cannot be reached. SIGINT/SIGTERM close sockets and all selected
database connections; repeated signals share one shutdown.

`PORT` defaults to 5000. `MONGO_URI` defaults to
`mongodb://127.0.0.1:27017/wavehouse_db`. `CORS_ORIGIN` optionally accepts a
comma-separated list of browser origins; otherwise all origins are allowed.

- `GET /`: process status.
- `GET /health`: 200 with `{"status":"ok"}` when all selected databases are ready;
  otherwise 503 with `{"status":"unavailable"}`.
- `GET /api-docs/`: Swagger UI; `/api-docs.json`: OpenAPI schema.
- Socket.IO `update_inventory` relays its payload as `inventory_changed`.
  This is a scaffold event and does not validate or persist inventory.

Run `npm test` for compilation and regression tests. Live integration suites can
write fixtures when database test URLs are configured. For database-free checks,
run the build and explicitly select `test/*.test.cjs` excluding every
`*.integration.test.cjs` file; do not run `test:postgres` without migration/write approval.

From the repository root, `docker compose up --build` starts all services.
Warehouse CRUD and authentication are not implemented yet.

## Local PostgreSQL catalog (through Phase 2.4)

The separate [PostgreSQL setup guide](docs/postgresql-local.md) covers the
local catalog schema, Prisma 7 migrations, isolated integration tests, and
VS Code Database Client connections. MongoDB remains the default. Explicitly set
`NODE_ENV=development` (or `test`) and all three `CATALOG_INGREDIENT_STORE`,
`CATALOG_PRODUCT_STORE`, and `CATALOG_RECIPE_STORE` process variables to `postgres`
to run the complete catalog without MongoDB. No additional flag is needed.

PostgreSQL mode remains loopback-only with approved local URLs and isolated roles.
Development uses `DATABASE_URL`; test uses only `TEST_DATABASE_URL`. Runtime loads
`backend/.env.postgres` without overriding exported variables. Mixed configurations
still require MongoDB and PostgreSQL; PostgreSQL Recipes require both prerequisites
in PostgreSQL. The default Docker Compose workflow remains MongoDB-based; this
local/test mode does not enable PostgreSQL in production or migrate existing data.
