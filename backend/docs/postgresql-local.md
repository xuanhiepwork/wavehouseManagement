# Local PostgreSQL catalog (through Phase 2.4)

## Phase 2.4: PostgreSQL-only Catalog server lifecycle

All three stores must explicitly select PostgreSQL to remove the MongoDB runtime
dependency. Defaults and Recipe prerequisites remain unchanged:

| Ingredients | Products | Recipes | Required databases |
| --- | --- | --- | --- |
| MongoDB | MongoDB | MongoDB | MongoDB |
| PostgreSQL | MongoDB | MongoDB | PostgreSQL and MongoDB |
| MongoDB | PostgreSQL | MongoDB | PostgreSQL and MongoDB |
| PostgreSQL | PostgreSQL | MongoDB | PostgreSQL and MongoDB |
| PostgreSQL | PostgreSQL | PostgreSQL | PostgreSQL |

The three PostgreSQL-Recipe combinations with a MongoDB prerequisite are rejected
before resource allocation. All selections are validated again after environment
loading. Exported variables retain precedence. One Prisma runtime serves every
selected PostgreSQL store. Mixed startup connects PostgreSQL first, then MongoDB,
and listens only after both succeed. All-PostgreSQL startup never calls Mongoose
connect/disconnect, does not validate/use MONGO_URI, and ignores MongoDB readiness.
Legacy startup retains MongoDB-only behavior and its existing listening address.

Use the three-flag process-variable example in Phase 2.3 below. PostgreSQL remains
restricted to explicit development/test environments, approved local URLs/roles,
and loopback HTTP binding. Test mode never falls back to the development URL.
No schema repair, migration, record conversion, or production cutover occurs.

GET /health returns 200 with {"status":"ok"} only when required dependencies
are healthy, otherwise 503 with {"status":"unavailable"}. PostgreSQL readiness
uses a live probe; mixed readiness also requires MongoDB's connected state.
Routes, selected OpenAPI schemas and catalog persistence contracts are unchanged.

Application-construction, connection and listener failures clean up allocated
resources. Socket closure precedes database closure; every applicable database
cleanup is attempted even if another throws. SIGINT/SIGTERM share an idempotent
shutdown, with a ten-second deadline and sanitized failure logs. Mongoose remains
installed for legacy and mixed configurations.

Phase 2.4 verification must exclude write-capable integration suites unless
separately approved. The existing test:postgres command deploys migrations and
writes test fixtures. A read-only smoke check may start the compiled backend in
test mode with all three PostgreSQL flags and an unreachable process-only MongoDB
URI, then request /health and catalog GET routes and shut down cleanly. Do not
modify environment files or start migrations for that check.


Phase 2.4 verification (2026-11-01): Prisma validation/client generation and
TypeScript compilation PASSED. Focused app/lifecycle tests: 38 passed, zero failed,
zero skipped. The database-free backend suite explicitly excluded every integration
file: 109 passed, zero failed, zero skipped. No migration or write-capable suite ran.
A real compiled backend child process used the isolated test role, PostgreSQL
read-only sessions and an unreachable process-only MongoDB URI. GET /health and
all three catalog list endpoints returned 200. On Windows, a stdin bootstrap
invoked the installed SIGTERM handler; the child exited cleanly with code zero.
No OS-delivered Unix signal behavior is claimed by this smoke check.


## Phase 2.3: opt-in PostgreSQL Recipes

MongoDB remains the default. PostgreSQL Recipes require all three process flags
explicitly set to `postgres`, with `NODE_ENV=development` or `test`. The four
Ingredient/Product combinations with MongoDB Recipes remain supported; the
three combinations with PostgreSQL Recipes and either prerequisite in MongoDB
are rejected before connecting. No flag enables another flag implicitly.

```powershell
$env:NODE_ENV = 'development'
$env:CATALOG_INGREDIENT_STORE = 'postgres'
$env:CATALOG_PRODUCT_STORE = 'postgres'
$env:CATALOG_RECIPE_STORE = 'postgres'
npm run build
npm start
```

Use process variables rather than editing environment files. One existing
Prisma runtime/pool serves selected stores. Loopback binding, approved database
identity/role checks and test-only URL selection remain enforced. In Phase 2.3, even with all
three PostgreSQL flags, MongoDB startup and readiness remained required; Phase 2.4
removes that dependency for the all-PostgreSQL selection. This is
a staged local/test implementation, not a production Catalog cutover. There is
no record migration, ObjectId conversion, dual write or automatic schema repair.

Recipe routes, methods, envelopes, default filters and pagination remain the
same; no PATCH or DELETE Recipe endpoint exists. PostgreSQL contracts differ:

- `_id`, `productId` and `ingredientId` are UUIDs; `__v` is omitted. Memberships
  are returned in Ingredient UUID ascending order, independent of input order.
- Quantities are canonical decimal strings, strictly positive NUMERIC(18,6),
  with at most 12 integer and six fractional digits. Inputs accept validated
  plain decimal strings or bounded JSON numbers under the shared decimal rules.
  Excess scale (including trailing fractional zeroes), overflow, unsafe numeric
  conversions, zero and non-finite values are rejected without rounding.
- Contents and versions remain immutable. POST requires at least one Ingredient.
  Existing SQL-created empty drafts are readable but activation returns 409.
- Lists order by Product UUID, lexical size L/M/S, descending version and UUID.
  GET and list data use repeatable-read snapshots, including activation pointers.
  Pagination totals remain separate reads, matching existing behavior.

Mutations use read-committed transactions and acquire locks in order: Product,
ProductVariant, Ingredients by UUID, then affected Recipes by UUID. Product and
Ingredient share locks coordinate with existing availability updates. The
variant update lock coordinates even the first Recipe creation. Version
allocation reads MAX(version) per variant and atomically inserts the next Recipe
and all memberships. Versions beyond PostgreSQL's 2147483647 limit fail before
writes with a sanitized 500. Definite transaction conflicts and verified version
uniqueness conflicts permit at most three whole-transaction attempts. Unknown
or uncertain commit outcomes return sanitized 500 without blind retries.
Repeated POST is not idempotent; no idempotency-key protocol is introduced.

Creation permits unavailable Products and inactive Ingredients, returns 404 for
missing Product/Ingredient references and 409 for an unsupported size. Activation
rechecks Product availability, active Ingredients and nonempty membership, even
when already active. The variant's activeRecipeId is authoritative. Switching
updates the pointer and old/new Recipe timestamps atomically; unchanged active
states retain timestamps. Deactivation requires no availability and clears only
the requested pointer, preserving newer activations and stale/repeated action
timestamps. Later Ingredient/Product deactivation leaves an existing pointer
intact. Ingredient units are current values, without historical unit snapshots.
Restrictive foreign keys and existing Product variant-removal guards preserve
all referenced Recipe history. Ingredient and Product persistence are unchanged.

Every Recipe mutation first reads required constraint/index definitions, numeric
precision, timestamp-trigger protections and replication mode. Missing, invalid
or disabled protections fail closed without schema changes. These checks assume
the approved local schema and are not a defense against concurrent privileged
DDL or direct SQL edits of immutable Recipe contents.

`npm run test:postgres` now includes real Recipe HTTP tests. Independent pooled
connections and observed PostgreSQL lock waits exercise first/later version
creation, first activation, competing switches, stale deactivation, both orders
of availability races, and both Recipe-create/variant-removal orders. Real
transactions verify membership/pointer/timestamp rollback and coherent reads.
Test-only client wrappers inject failures and metadata faults; the post-commit
lost-acknowledgement simulation is explicitly not a real network-failure test.
Lifecycle/readiness checks use mocked dependencies rather than a live MongoDB
server. Cleanup re-verifies test identity and removes only registered fixtures,
clearing their pointers before deleting their memberships and parent records.
No reset, truncation, development/shadow migration or baseline change is used.


Phase 2.3 verification (2026-11-01): Prisma validation/generation, TypeScript
build, compiled CommonJS import/startup checks and existing Recipe regressions
PASSED. The PostgreSQL runner passed 52 tests, failed zero and skipped zero;
18 are Recipe HTTP checks including their parent test. The complete backend
suite passed 138 tests, failed zero and skipped three legacy MongoDB integration
tests because `MONGODB_TEST_URI` was absent. Development, shadow and test
table-content/migration fingerprints and secret-file hashes matched pre-test
values after cleanup. The Prisma schema and baseline SQL are unchanged; baseline
SHA-256: `2ba20138f93a57188d0c802bf2a861a3d7d417d80afd24940da4f1f6f10778b4`.

## Phase 2.2: opt-in PostgreSQL Products

MongoDB remains the default. `CATALOG_PRODUCT_STORE=postgres` independently opts
Products into the existing local PostgreSQL runtime. Ingredient selection retains
its existing behavior. All four Ingredient/Product combinations are supported.
When either selects PostgreSQL, one client/pool serves both selected stores;
the server binds to loopback and readiness requires MongoDB plus PostgreSQL.
Unknown flags, missing/production/unsupported environments and unsafe database
targets fail before accepting traffic. Neither flag changes the other implicitly.

From `backend`, use process variables only (do not edit secret files):

```powershell
$env:NODE_ENV = 'development'
$env:CATALOG_PRODUCT_STORE = 'postgres'
# Optional independent Ingredient opt-in:
# $env:CATALOG_INGREDIENT_STORE = 'postgres'
npm run build
npm start
```

Remove `CATALOG_PRODUCT_STORE` from the process to restore default Product
persistence. The existing approved local database/role guards, explicit env
loading, test-only URL selection, shutdown, CommonJS generation, and secret-safe
error handling are reused. No dependencies, Prisma models, migrations or
Ingredient persistence contracts are changed. No data is copied or dual-written.
Recipe persistence and its ObjectId contracts remain MongoDB-backed; Recipes
cannot reference PostgreSQL Product UUIDs. This is not a full Catalog cutover.

Product contracts preserve the same routes, methods, envelopes and pagination
shape. PostgreSQL mode intentionally differs as follows:

- `_id` contains a UUID; `__v` is omitted. Internal variant IDs, foreign keys and
  active-recipe pointers are never included in Product responses.
- Prices are canonical decimal strings. Input accepts plain decimal strings and
  bounded numbers using the unchanged Phase 2.1 decimal rules: NUMERIC(18,4),
  14 integer/4 fractional digits, no silent rounding, and no unsafe scaled numeric
  conversions. Excess scale, including trailing fractional zeroes, is rejected.
- `prices` always returns S, M, L order, regardless of input ordering. There is
  no insertion-position column and no additive migration in this phase.
- Omitted optional text on creation is stored as null and omitted from responses.
  Omitted PATCH fields are preserved; empty/whitespace text stores an empty
  string; explicit null and embedded NULs are rejected. imageUrl has no new
  URL-format restriction. Normalized code/name/category limits are 64/200/100.
- Codes remain globally reserved across availability states. Lists still include
  both states by default, sort by code/UUID, and use literal case-insensitive
  code/name search and exact case-sensitive category filters. SQL collation may
  differ from MongoDB. Maximum pagination offset is 2147483647.

Create and PATCH are atomic Product/variant transactions. Mutations lock Product
first, then variants in UUID order. A complete prices PATCH reconciles by size:
retained variants keep IDs, creation timestamps, all Recipe references and active
pointers; new sizes receive new IDs. An omitted size is removed only if it has
no Recipe references, including drafts and inactive history. Otherwise the entire
PATCH returns `409 {error: "Cannot remove a size referenced by recipes"}` with no
changes to fields, prices, timestamps, pointers or history. Reintroducing a removed
unreferenced size creates a new ID. There is no variant-retirement mechanism.

PATCH writes only supplied scalar fields, and prices-only PATCH advances the
Product timestamp. Concurrent price replacements serialize; the later successful
writer determines the complete set. Definite retryable transaction aborts have
at most three attempts; unknown/uncertain outcomes return sanitized 500 without
blind retries. Duplicate Product codes retain their specific 409 response;
unrelated variant constraint failures are not mislabeled as duplicate codes.
GET/list aggregates use repeatable-read snapshots so metadata and prices belong
to one committed revision. Pagination counts remain separate reads as documented.

DELETE only sets isAvailable=false. It preserves variants, pointers and history,
keeps the code reserved, and does not change timestamps on repeated calls.
PATCH may explicitly reactivate the Product. No Product operation changes Recipe
activation state. Mode-specific OpenAPI describes the selected contract while
Ingredient and Recipe documentation retain their selected/existing contracts.

`npm run test:postgres` builds first, verifies test-role isolation, deploys only
reviewed migrations to the dedicated test database, and runs SQL, Ingredient HTTP
and Product HTTP suites. The Product suite uses real transactions and observed
PostgreSQL lock waits to verify both Recipe-insertion/removal race orders, full
price replacements, both PATCH/DELETE orders, rollback, identity and consistent
reads. Failure injection exists only in test-client wrappers. Fixture cleanup
rechecks isolation, clears only owned pointers, and deletes only owned memberships,
Recipes, variants, Products and the owned Ingredient in reference-safe order.
No database reset, truncation or development/shadow migration is used.

Phase 2.2 verification (2026-11-01): Prisma validation/generation, TypeScript
build, compiled CommonJS startup/import checks and existing Product regressions
PASSED. The PostgreSQL runner passed 34 tests (zero failed/skipped), including
17 Product HTTP checks counted with their parent test. The full backend suite
passed 112 tests, failed zero, and skipped three legacy MongoDB integration tests
because `MONGODB_TEST_URI` was absent. All four store combinations, identity,
draft/inactive/active Recipe protection, forced and constraint-failure rollback,
duplicate codes, independent PATCH, serialized price replacements, both observed
Recipe-insertion/removal lock races, both PATCH/DELETE orders, timestamp-stable
repeated DELETE, coherent reads, and error redaction PASSED. Development, shadow,
test table-content/migration fingerprints and secret-file hashes remained
unchanged after cleanup. Prisma schema and baseline SQL are unchanged; baseline
SHA-256: `2ba20138f93a57188d0c802bf2a861a3d7d417d80afd24940da4f1f6f10778b4`.

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
