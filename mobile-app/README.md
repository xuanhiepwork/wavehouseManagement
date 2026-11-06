# Mobile Catalog foundation

The Mobile-owned client exposes six read operations:
`ingredients.list/detail`, `products.list/detail`, and `recipes.list/detail`.
It does not start requests on import. Ingredient and Product screens read on
focus with explicit API configuration. Recipe screens remain placeholders.

## Navigation foundation (Phase 2.5.5.3)

`index.ts` registers Expo Router through `expo-router/entry`. The root native
Stack lives in `src/app/_layout.tsx`; the original `App.tsx` starter is no longer
the active entry. Shared non-route components and route helpers live in
`src/navigation/`.

| Path | Current behavior |
| --- | --- |
| `/` | Catalog home with links to the three sections |
| `/ingredients` | Searchable Ingredient list with filters, sorting and pagination |
| `/ingredients/[id]` | Ingredient detail, validated UUID and explicit retry |
| `/products` | Searchable Product list with category/availability filters and pagination |
| `/products/[id]` | Product detail with supported size prices, validated UUID and retry |
| `/recipes` | List placeholder |
| `/recipes/[id]` | Detail placeholder with validated raw UUID context |
| Unmatched path | Screen-unavailable message and Catalog exit |

Normal navigation uses the native Stack header/back behavior. Detail placeholders
also provide list and Catalog exits for direct links without prior history.
Ingredient and Product details use the same exits. Invalid or ambiguous UUID parameters are
rejected before creating an API client or loading a record.
Content scrolls inside safe areas beneath the native header, supports font
scaling, and uses labelled native links with large touch targets.

The configured native deep-link scheme is `wavehouse`; for example, a native
build can open `wavehouse://ingredients/<uuid>`. Expo Go uses its development
server URL and `/--/ingredients/<uuid>` instead. Scheme registration and native
back/gesture behavior still need device verification. No native projects were
generated in this phase.

Five direct dependencies were added with Expo's SDK-compatible installer:
`expo-router`, `react-native-safe-area-context`, `react-native-screens`,
`expo-linking`, and `expo-constants`. The existing `expo-status-bar` is retained.
Only Router's required dependency graph is installed; there is no native test
stack, custom Babel configuration, or Metro configuration.

Six additional declarations pin Router's required peers to SDK 57-compatible
versions. Without these pins, their broad peer ranges selected React DOM 19.3, Expo Font
58, and newer gesture/animation/Worklets packages with React Native 0.88 tooling.
React, React Native, and Expo retain their original versions. The pins cover
React DOM, Expo Font, gesture handler, Reanimated, Worklets, and the matching
React Native Metro config. They were already required by Router's dependency
graph; no additional navigation features are enabled. Keep these declarations
in sync when the Expo SDK is upgraded. Direct peer declarations also avoid npm's
conflicting override contexts for shared Babel dependencies.

Optional generated typed routes remain disabled. Literal route helpers validate
resource names and singular UUID parameters without generating environment or
route declaration files.

## GET-only API foundation (Phase 2.5.5.2)

Pass `baseUrl` to `createCatalogClient`, or set
`EXPO_PUBLIC_API_BASE_URL` in the launching process before starting Expo.
The configuration must explicitly use a loopback HTTP(S) origin or its `/api`
path, for example `http://127.0.0.1:5000/api`. No host is assumed. Public Expo
configuration must contain no secrets. This phase adds no environment files.

```ts
import { createCatalogClient } from './src/api/catalog';

const catalog = createCatalogClient({ baseUrl: 'http://127.0.0.1:5000/api' });
const page = await catalog.ingredients.list({ isActive: false, page: 1 });
// Keep page.data costPrice/minStock strings intact when formatting later.
```

Each operation validates its query, envelope, record values, and request
identity before returning data. Decimal wire values remain strings, and empty
historical Recipe Ingredient membership is valid. Backend pagination and row
order are preserved; row counts are not assumed to be a single snapshot.
Omitted Ingredient status means active only; omitted Product/Recipe status means
both statuses, following the backend contract.

The default timeout is ten seconds and covers both fetch and body parsing.
`timeoutMs` and a fetch implementation are injectable. Reads accept a second
`{ signal }` argument. Failures expose fixed `CatalogApiError` messages and codes,
without server bodies or original exceptions. There are no automatic retries.
`createCatalogRead` in `src/api/catalog.read.ts` provides explicit retry,
cancellation, and stale-result suppression for future native consumers; replacing
a read immediately clears its old data and errors.

From this directory, using the existing Node 24.12/npm tooling:

```text
npm test
npm run typecheck
npm run lint -- --no-cache
node node_modules/expo/bin/cli install --check --json
```

Tests use Node's built-in test runner. The original 245 API/read-state cases
remain unchanged; navigation helpers add 37 boundary cases. API fetch is mocked
throughout, and these tests do not render React Native or exercise native back
gestures. Explicit `.ts`
imports and the existing installed Node/React types allow the same modules to
run through Node's type stripping and Expo TypeScript checks without adding test
dependencies.

Device/emulator connectivity, cleartext HTTP behavior, and native rendering have
not been verified. Device loopback requires an appropriate forwarding setup.
Requests use native GET, an Accept header, and AbortController; browser-specific
credential/redirect options are not assumed to work across native transports.
Redirect metadata or a changed final response URL is rejected before data is
returned, but a native transport may already have followed that redirect, and
may omit URL metadata. Cookie isolation is not guaranteed by this wrapper.

Recipe data screens, reference lookup UI, native rendering tests, Android
device smoke testing, and deferred Web Browser QA remain later work. Metro
Android and iOS exports verify route bundling, without generating native projects or
performing a device build.

## Phase 2.5.5.3 verification — 2026-11-05

| Check | Result |
| --- | --- |
| `npm test` | 282 passed: all 245 original cases unchanged, plus 37 navigation cases |
| `npm run typecheck` | Passed |
| `npm run lint -- --no-cache` | Passed |
| `npm ls --all` | Passed; no invalid or missing dependencies |
| `npm ci --dry-run --ignore-scripts --no-audit` | Passed; final lockfile agrees with declarations |
| Installed SDK 57 compatibility matrix | 26 matching package paths, zero mismatches |
| Android and iOS Metro exports, `--no-bytecode` | Passed; JavaScript bundles, not native builds |
| Mobile diff whitespace check, including new files | Passed |

The online `expo install --check --json` recommends an Expo patch update from
57.0.31 to `~57.0.32` and therefore exits with an advisory mismatch. The installed
SDK's offline check reports no mismatches. Expo remains at 57.0.31 in this phase;
React remains 19.2.3 and React Native remains 0.86.3. The complete locked React
Native/tooling graph uses 0.86.3, with no 0.88 tooling.

The full repository `git diff --check` flags pre-existing root `README.md`
whitespace at lines 332, 333, 359, 360, and 361. That user edit was preserved
exactly; all Mobile changes pass the whitespace check. npm's installation audit
reports 20 findings (1 low, 14 moderate, 5 high); unrelated dependency upgrades
were not applied. Native rendering, device gestures, installed deep-link scheme
registration, and Web Browser QA remain unverified/deferred.

Exact phase files, relative to `mobile-app/`:

```text
README.md
app.json
index.ts
package.json
package-lock.json
__tests__/catalog-navigation.test.ts
src/app/_layout.tsx
src/app/index.tsx
src/app/+not-found.tsx
src/app/ingredients/index.tsx
src/app/ingredients/[id].tsx
src/app/products/index.tsx
src/app/products/[id].tsx
src/app/recipes/index.tsx
src/app/recipes/[id].tsx
src/navigation/CatalogPlaceholder.tsx
src/navigation/catalog.routes.ts
src/navigation/catalog.styles.ts
```

The GET-only client, original API/read-state tests and fixtures, Mobile API
configuration, `tsconfig.json`, and inactive `App.tsx` starter are unchanged.
Web, backend, Prisma, migrations, environment files, and PostgreSQL were not
modified. No Catalog API requests or Git commits, merges, pushes, or branch
switches were performed. Branch `test` and HEAD
`2232f3f176e8f229355539a5ebfd6e87393fa416` remain unchanged.

## Phase 2.5.5.4 — Ingredient list and detail

Ingredient cards show name, code, category, unit, active/inactive status, cost
price and minimum stock. Details add the raw UUID and created/updated UTC
timestamps. Presentation uses the wire strings directly, including decimal
values; no floating-point conversion or truncation is applied.

Search and filter controls have separate drafts. Apply trims optional search
and category, omits blanks, applies the chosen filters/sort, and resets to page
one. Category is an exact match. Unit supports any/g/ml/piece. Status supports
the omitted backend default (active), explicit active, or inactive; there is no
combined all-status request. All eight backend sort fields and asc/desc are
available. Page size is 20. Previous/Next use the applied query, not unsaved
drafts, and respect valid server pagination, including empty pages/count drift.

`IngredientStateProvider` retains list drafts, applied filters, page and settled
results/errors within the mounted Catalog stack. Pending reads are cancelled on
blur/unmount, and superseded outcomes are ignored. Returning from detail reuses
settled list state; cancelled reads resume on focus. Settled errors require an
explicit retry. State is in memory and does not persist across app restarts.
Changing a detail UUID switches read state before rendering old data. Invalid
UUIDs never create a client or request a record. Missing/invalid configuration,
timeouts, missing records and malformed responses use fixed safe error messages.

Verification (2026-11-05):

| Check | Result |
| --- | --- |
| `npm test` | 344 passed: all 282 original cases unchanged plus 62 Ingredient cases |
| `npm run typecheck` | Passed |
| `npm run lint -- --no-cache` | Passed |
| Android and iOS Metro exports, `--no-bytecode` | Passed; JavaScript bundling only |
| Mobile diff whitespace check, including new files | Passed |

New tests cover query/filter/sort/status mapping, real-client mocked GET reads,
pagination, exact field presentation, invalid UUIDs, configuration/error/retry,
deadlines/cancellation, stale responses and retained list state. They do not
render React Native or execute Router navigation. Device/simulator rendering,
keyboard behavior, screen-reader announcements, gestures and hardware back
navigation remain unverified. Web Browser QA remains deferred.

Read-only security review still reports 20 affected package entries (5 high,
14 moderate, 1 low), rather than 20 independent bugs. The installed Router →
query-string → decode-uri-component path reaches the affected decoder before
screen UUID validation. This is a runtime-relevant malformed-link availability
risk; exploitation on this app/device was not tested. See the
[decoder maintainer advisory](https://github.com/SamVerschueren/decode-uri-component/security/advisories/GHSA-qr28-fpjm-wq7f).
Sixteen entries concern Expo/ESLint tooling; app runtime reachability was not
confirmed for those paths. The low deepmerge entry refers to a
[CVE rejected on November 2](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json).
No dependencies, SDK/runtime/compiler versions, lockfiles or audit fixes were
changed in this phase.

Modified files, relative to `mobile-app/`:

```text
README.md
src/app/_layout.tsx
src/app/ingredients/index.tsx
src/app/ingredients/[id].tsx
src/navigation/CatalogPlaceholder.tsx
```

Created files:

```text
src/ingredients/IngredientScreens.tsx
src/ingredients/IngredientState.tsx
src/ingredients/ingredient.controller.ts
src/ingredients/ingredient.model.ts
src/ingredients/ingredient.styles.ts
__tests__/catalog-ingredients.test.ts
```

The existing API/read utilities, contracts, all 282 existing tests/fixtures,
Product/Recipe routes, Web, backend, Prisma, migrations, environment files and
PostgreSQL data are unchanged. The root README was preserved byte-for-byte. No
live Catalog API requests, database writes, deployment, commits, merges, pushes
or branch switches were performed. Branch `test` and HEAD
`c5ec2cff40e752f2f09040ee88c060b774e4056f` are preserved. Stopped after
Phase 2.5.5.4 for review.

## Phase 2.5.5.5 — Product list and detail

Product cards show name, code, category, availability and each supported size's
exact price. Details also show the raw UUID and created/updated UTC timestamps.
Only returned sizes are presented, in S/M/L order, using a derived array that
does not change the wire data. Prices remain strings without Number, parseFloat
or toFixed conversion. Products with one or two sizes do not gain missing sizes
or substitute prices. The Product row ordering remains the backend's ordering.

Search (code/name) and exact category filters have independent drafts. All
availability omits `isAvailable`; Available sends true and Unavailable sends
false. Apply and Reset return to page 1, with page size 20. Previous/Next use
applied filters rather than unsaved drafts. There are no Product sort controls
or sorting query parameters. Empty pages and count/row drift remain valid.

Product controllers and their provider follow the Ingredient lifecycle pattern
but retain separate state. Applied filters, page, and settled results/errors
survive list/detail navigation within the mounted Catalog stack. Pending reads
cancel on blur/unmount, and old outcomes cannot replace a newer query or UUID.
Settled errors require explicit retry; there are no automatic retry loops.
Invalid UUID parameters never create the API client. Direct detail links have
list and Catalog exits. Configuration, missing-record, malformed-response,
network and timeout failures use the existing sanitized GET client/read state.

Verification (2026-11-06):

| Check | Result |
| --- | --- |
| `npm test` | 400 passed: all 344 existing cases unchanged plus 56 Product cases |
| `npm run typecheck` | Passed |
| `npm run lint -- --no-cache` | Passed |
| Android and iOS Metro exports, `--no-bytecode` | Passed; JavaScript bundling only |
| Mobile diff whitespace check, including new files | Passed |

New cases cover omitted/true/false availability, search/category, no sort
parameters, paging and filter reset, preserved backend row order, one/two/three
size subsets, nonmutating S/M/L price presentation, exact strings, invalid UUIDs,
loading/empty/configuration/error/timeout/retry, cancellation, stale outcomes and
Product state independent of Ingredient state. Automated coverage uses mocked
GET requests and dependency-free model/controller tests. It does not render
React Native or execute device navigation. Native layout, long-value wrapping,
font scaling, keyboard/screen-reader behavior, deep links and hardware back
navigation remain unverified. Web Browser QA remains deferred.

The previously documented malformed-link availability risk in Router's decoder
dependency path remains unresolved and requires separate assessment before
release. This phase does not remediate it or change dependencies. No audit fix,
SDK, React Native, React or TypeScript update was performed.

Modified files, relative to `mobile-app/`:

```text
README.md
src/app/_layout.tsx
src/app/products/index.tsx
src/app/products/[id].tsx
src/navigation/CatalogPlaceholder.tsx
```

Created files:

```text
src/products/ProductScreens.tsx
src/products/ProductState.tsx
src/products/product.controller.ts
src/products/product.model.ts
src/products/product.styles.ts
__tests__/catalog-products.test.ts
```

The root layout adds only the independent Product provider, and Home copy now
identifies Products as available for browsing. Ingredient source/behavior and
its tests, all existing API/read/navigation tests and fixtures, the GET-only API
client/configuration, Recipe routes, package manifests/lockfile, and the root
README are preserved. Web, backend, Prisma, migrations, environment files and
PostgreSQL data remain unchanged. No live Catalog requests, deployments or Git
write operations were performed by the implementation agents.

Work began on branch `test` at `c5ec2cff40e752f2f09040ee88c060b774e4056f`
with the prior Ingredient phase staged. During implementation an external commit
advanced HEAD to `c89c29e103ffc0f4442ec2d5d47d271b87c95c6e`; its complete diff
matches the initially staged patch exactly. Product work remains separate from
that preserved baseline. Stopped after Phase 2.5.5.5 for review.
