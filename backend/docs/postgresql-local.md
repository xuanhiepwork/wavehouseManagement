# Local PostgreSQL catalog (Phase 1 and Phase 2.1)

## Phase 2.1: opt-in PostgreSQL Ingredients

MongoDB remains the default for all endpoints. No data is copied, IDs are not
converted, and no dual writes occur. PostgreSQL Ingredients are an explicitly
selected local/test implementation; MongoDB Product and Recipe endpoints remain
unchanged and cannot reference PostgreSQL Ingredient UUIDs. Do not deploy this
mixed catalog as a production cutover.

After installing dependencies, `npm run build` explicitly generates the pinned
Prisma 7 CommonJS client and compiles it. Generated files under
`src/generated/prisma` are ignored. Generation/build never apply migrations.
The baseline SQL and its constraints remain unchanged.

To opt in locally from `backend` (process variables only):

```powershell
$env:NODE_ENV = 'development'
$env:CATALOG_INGREDIENT_STORE = 'postgres'
npm run build
npm start
```

The opt-in requires explicit `development` or `test`; absent/production/unknown
environments and unknown store values fail before connecting. PostgreSQL mode
binds the HTTP server to `127.0.0.1`. Development uses only the approved local
`DATABASE_URL`/development role. Test mode uses only `TEST_DATABASE_URL`/test role,
never a fallback. Runtime loads `backend/.env.postgres` explicitly in PostgreSQL
mode; exported values take precedence. It never uses the shadow URL. Startup
verifies PostgreSQL identity/role isolation before accepting traffic, then retains
the MongoDB connection for Product/Recipe. In this mode `/health` requires both
MongoDB connectivity and a successful live PostgreSQL probe. Legacy mode keeps
its MongoDB startup/readiness and listening behavior. Shutdown closes both clients.
Neither startup nor requests create schemas, indexes or migrations.

To return to the default, remove `CATALOG_INGREDIENT_STORE` from the process.
Do not edit environment files to run tests. `npm run test:postgres` verifies the
isolated test role before deploying reviewed migrations **to test only**, then
runs both rollback-only SQL fixtures and the real Prisma Ingredient HTTP suite.
The HTTP suite verifies the role again and removes only its own random exact
codes within its own category; it never truncates, resets or uses development.
Independent clients exercise duplicate POST/PATCH, partial updates and DELETE
concurrency. MongoDB is not needed for these HTTP fixtures.

PostgreSQL Ingredient contracts intentionally differ:

- `_id` is a UUID; `__v` is omitted. Existing ObjectIds are not translated.
- `costPrice` and `minStock` responses are canonical unsigned decimal strings:
  no exponent, redundant leading zeroes, or trailing fractional zeroes.
- Input accepts unsigned plain decimal strings and bounded finite JSON numbers.
  Prices allow 14 integer/4 fractional digits; minimum stock allows 12 integer/6
  fractional digits. Excess fractional digits, even trailing zeroes, are rejected
  before writing. No rounding is performed. Strings have at most 100 characters.
  Numeric inputs must round-trip through their decimal representation, and their
  scaled integer units must be at most `Number.MAX_SAFE_INTEGER`; negative zero
  is rejected. Send strings for large exact values. JSON parsing has already
  interpreted numeric tokens as JavaScript numbers, so strings are the reliable
  representation when original decimal spelling/precision matters.
- Normalized code/name/category limits are 64/200/100 PostgreSQL characters;
  embedded NULs are rejected. Codes remain reserved across inactive records.
- Existing query defaults and envelopes remain. SQL collation can differ from
  MongoDB; literal `%`, `_`, backslash and regex characters are supported in
  search. Pagination offset is limited to 2147483647 in this implementation.
- PATCH updates supplied fields atomically. DELETE locks the target and changes
  `isActive` only when needed, preserving timestamps on repeated deletion.

The selected mode's `/api-docs.json` describes its actual Ingredient contract.
Product/Recipe documentation and validators retain their legacy contracts.
Unexpected database errors are replaced with generic failures before reaching
the shared handler; logs never include raw database errors or URLs.

Verification commands: `npm run prisma:validate`, `npm run prisma:generate`,
`npm run build`, `npm run test:postgres`, and `npm test`. Ordinary `npm test`
does not load the PostgreSQL env file; explicitly export only the dedicated test
URL into the process to include live PostgreSQL suites. Missing integration
configuration is a reported skip, not a database test pass.

Phase 2.1 implementation verification (2026-11-01): Prisma validation, client
generation, TypeScript build, CommonJS source/compiled imports, startup lifecycle
checks and existing Ingredient regressions passed. The dedicated PostgreSQL
runner passed 17 tests with no failures/skips. The full backend suite, with the
dedicated test URL explicitly supplied, passed 88 tests with zero failures and
three MongoDB integration skips (`MONGODB_TEST_URI` absent). Development, shadow
and test table-content/migration fingerprints were unchanged after fixture
cleanup. The baseline SHA-256 remains
`2ba20138f93a57188d0c802bf2a861a3d7d417d80afd24940da4f1f6f10778b4`.
The dependency audit reports five moderate findings in existing Swagger/dev-tool
dependency chains; no existing package versions were upgraded in this phase.

## Phase 1 foundation reference

The API remains CommonJS and defaults to MongoDB/Mongoose. Phase 1 added
only PostgreSQL catalog schema, reviewed migrations, tooling, and direct `pg`
integration tests. It does not migrate MongoDB records or integrate a Prisma
runtime client. Use Node.js 24 LTS, Docker Desktop with Linux containers, and
Docker Compose. Prisma CLI is pinned to version 7 in `package-lock.json`.

## Configure local credentials

From the repository root, copy `.env.postgres.example` to `.env.postgres` and
replace all three placeholders with distinct local passwords. These files are
ignored; never commit them. Copy only the PostgreSQL entries from
`backend/.env.example` into `backend/.env.postgres`, supplying the matching role
passwords. URL-encode special characters in connection URL passwords. Prisma
loads `backend/.env.postgres` explicitly; it does not load the API's `.env`.
Exported environment variables take precedence.

The example files contain placeholders, not working credentials. Do not use
`wavehouse_admin` for application development or tests. Do not print resolved
Compose configuration, connection URLs, or environment files containing secrets.

## Start and check PostgreSQL

Run these commands from the repository root:

```powershell
docker compose --env-file .env.postgres -f docker-compose.postgres.yml config --quiet
docker compose --env-file .env.postgres -f docker-compose.postgres.yml up -d --wait
docker compose --env-file .env.postgres -f docker-compose.postgres.yml ps
docker compose --env-file .env.postgres -f docker-compose.postgres.yml exec -T postgres pg_isready -U wavehouse_admin -d postgres
```

This independent Compose project uses `postgres:17-bookworm`, loopback port
`127.0.0.1:5433`, and named volume `wavehouse_postgres_data`. The MongoDB stack
in `docker-compose.yml` is untouched. No cloud resources are used.

On the first initialization of an empty PostgreSQL volume, the mounted Bash
script creates these databases and roles:

| Database | Owner/login | Purpose |
| --- | --- | --- |
| wavehouse_dev | wavehouse_dev | Local catalog development |
| wavehouse_test | wavehouse_test | Isolated integration fixtures |
| wavehouse_shadow | wavehouse_dev | Prisma migration development shadow |

PUBLIC database and schema privileges are revoked for these databases. The test
role has no CONNECT permission on development or shadow, no development-role
membership, and no elevated role attributes. Development cannot connect to test.
The admin role is reserved for initialization and local maintenance.

Initialization scripts run only once on an empty volume. Changing passwords in
an env file does not change existing database passwords. If initialization,
credentials, or isolation is wrong, stop and inspect with the local administrator;
do not delete volumes or reset databases as a workaround. Preserve LF line
endings in `docker/postgres/init/01-local-databases.sh`.

## Validate and apply the reviewed baseline

From `backend`:

```powershell
npm ci
npm run prisma:validate
```

The baseline was generated offline with:

```powershell
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

Inspect `prisma/migrations/20261031000000_catalog_baseline/migration.sql` before
applying it. Prisma generates tables, enums, indexes, and foreign keys. Reviewed
SQL additions enforce nonempty normalized codes/names/categories, nonnegative
finite prices and minimum-stock thresholds, positive finite ingredient
quantities, positive recipe versions, and SQL-maintained `updated_at` timestamps.
PostgreSQL numeric `NaN` is rejected explicitly; bounded numeric types reject
infinities and overflow. Excess fractional digits are rounded by PostgreSQL to
the declared scale; future API input validation must enforce its precision policy.

Before migration, verify the development connection in Database Client:

```sql
SELECT current_database(), current_user, session_user,
       inet_server_addr(), inet_server_port();
```

Expect database and role `wavehouse_dev`. The host connection is
`127.0.0.1:5433`; PostgreSQL reports its internal container address and port 5432.
The Prisma config additionally rejects URLs outside the approved host, port,
database/role pairs and public schema. No URL is supplied by default, allowing
offline schema validation without credentials.

Only after reviewing SQL and verifying identity, run:

```powershell
npm run prisma:deploy
npm run prisma:status
```

Do not run `migrate reset` or `db push`. Later migration development must use
the dedicated `SHADOW_DATABASE_URL`, never the development or test database as
shadow. Do not use the test database as the development migration target.

## Catalog design

- Every row has a PostgreSQL-generated UUID `id` and timestamptz timestamps.
- `ingredients`: unique uppercase trimmed code, base unit `g`, `ml`, or `piece`,
  reference `cost_price` NUMERIC(18,4), `min_stock` NUMERIC(18,6), active flag.
- `products`: unique uppercase trimmed code, name/category, optional description
  and image URL, availability flag.
- `product_variants`: one size S/M/L per product, current `price` NUMERIC(18,4),
  nullable `active_recipe_id`.
- `recipes`: unique positive version per variant. The composite active-pointer
  foreign key `(active_recipe_id, id) -> recipes(id, product_variant_id)` ensures
  that the active recipe belongs to that exact variant, including on updates.
- `recipe_ingredients`: unique ingredient per recipe and positive quantity
  NUMERIC(18,6), expressed in the referenced ingredient's base unit.

All reference deletion and key update rules are RESTRICT. Clear an active
pointer explicitly before deleting an otherwise unreferenced recipe. Use
deactivation and version creation to preserve history. These constraints protect
referenced rows; immutable history and activation transactions belong to later
service implementation. Draft recipes can initially have no ingredients;
activation completeness will require a later service rule. Category/availability,
foreign-key and active-pointer indexes support catalog lookups.

Prisma models use `Decimal`, never floating-point columns. Future Prisma runtime
integration and canonical decimal-string API serialization are deferred to Phase 2.
Direct `pg` tests retain its default numeric-to-string parser. There are no stock
balances or inventory operations in this phase. Nonnegative stock enforcement
remains a requirement for the later inventory phase; `min_stock` is a threshold,
not on-hand stock. Valuation, purchasing, transfers, and AI are deferred.

## Run isolated integration fixtures

Review the baseline first, then from `backend`:

```powershell
npm run test:postgres
npm run build
npm test
```

`test:postgres` requires an explicit `TEST_DATABASE_URL` with role/database
`wavehouse_test` at `127.0.0.1:5433` and no query parameters. It never falls back
to `DATABASE_URL`. Before migration or fixture insertion it verifies the live
database, session role, ownership, role attributes, membership and inability to
connect to development/shadow. It deploys committed migrations only to that
verified test target, then runs the direct PostgreSQL tests. Migration failure
output is withheld to avoid leaking credentials.

Fixtures use fresh UUIDs and a single rollback-only transaction. They do not
truncate tables, drop schemas, delete volumes, or import MongoDB records. Tests
verify exact decimals, UUID/timestamp defaults, unique keys, enums, checks,
missing references, restrictive deletion, active-pointer ownership, version
transitions and SQL timestamp updates. The ordinary `npm test` skips the
PostgreSQL test if `TEST_DATABASE_URL` is absent. Such a skip is not a database
test pass. The explicit `test:postgres` command fails when credentials are absent.
Existing MongoDB integration tests still require their own `MONGODB_TEST_URI`.

## VS Code Database Client

Create a PostgreSQL connection using host `127.0.0.1`, port `5433`, database
`wavehouse_dev`, username `wavehouse_dev`, and the development password from
your ignored env file. Use schema `public` and disable SSL for this loopback-only
Docker setup. Store the password locally using the extension's credential store;
do not export it into tracked workspace configuration.

For test inspection, create a separate connection with database and username
`wavehouse_test` and its distinct password. Verify `current_database()` and
`current_user` before any write. Never run test cleanup using a development or
admin connection.

## Initial verification limitations

During implementation Docker's CLI and Compose were present, but the Docker
Desktop Linux daemon was unavailable. Neither `.env.postgres` file existed.
Compose configuration can be validated using temporary process-only placeholders;
database health, migration application/status and live constraint tests must be
reported as BLOCKED until Docker is running and local credentials are configured.

| Implementation check | Result |
| --- | --- |
| Compose configuration with process-only placeholders | PASSED |
| PostgreSQL health | BLOCKED: Docker daemon unavailable |
| Prisma 7 schema validation | PASSED |
| Offline baseline generation and SQL review | PASSED |
| Prisma migration status/application | BLOCKED: daemon and credentials unavailable |
| Live PostgreSQL constraint tests | BLOCKED; SKIPPED in ordinary suite |
| Backend build | PASSED |
| Backend test suite | PASSED: 59 passed, 4 skipped, 0 failed |
| Authorized changed-file scope and whitespace review | PASSED |

The four skipped tests comprise three existing MongoDB integration tests without
`MONGODB_TEST_URI` and one PostgreSQL integration test without
`TEST_DATABASE_URL`. The new offline URL safety test passed. Explicit
`npm run test:postgres` exited with an error requiring `TEST_DATABASE_URL`, as
designed, before any connection or preparation. The baseline has not been applied
to any database. Scope review confirmed 10 authorized new files, five authorized
modified files, and preservation of the pre-existing root README change. Git
whitespace review used `core.whitespace=cr-at-eol` for existing Windows line endings.

Prisma 7 configuration follows the official
[Prisma config reference](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
and [Prisma 7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).
