# Mobile Catalog foundation

The Mobile-owned client exposes six read operations:
`ingredients.list/detail`, `products.list/detail`, and `recipes.list/detail`.
It does not start requests on import. The navigation placeholders do not create
a client or issue Catalog requests.

## Navigation foundation (Phase 2.5.5.3)

`index.ts` registers Expo Router through `expo-router/entry`. The root native
Stack lives in `src/app/_layout.tsx`; the original `App.tsx` starter is no longer
the active entry. Shared non-route components and route helpers live in
`src/navigation/`.

| Path | Current behavior |
| --- | --- |
| `/` | Catalog home with links to the three sections |
| `/ingredients`, `/products`, `/recipes` | List placeholders |
| `/ingredients/[id]`, `/products/[id]`, `/recipes/[id]` | Detail placeholders with validated raw UUID context |
| Unmatched path | Screen-unavailable message and Catalog exit |

Normal navigation uses the native Stack header/back behavior. Detail placeholders
also provide list and Catalog exits for direct links without prior history.
Invalid or ambiguous UUID parameters are rejected without loading a record.
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

Full Catalog data screens, reference lookup UI, native rendering tests, Android
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
