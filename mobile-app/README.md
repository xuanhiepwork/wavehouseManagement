# Mobile Catalog API foundation

The Mobile-owned client exposes six read operations:
`ingredients.list/detail`, `products.list/detail`, and `recipes.list/detail`.
It does not start requests on import or integrate with the starter app yet.

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
```

Tests use Node's built-in test runner and mocked fetch only. Explicit `.ts`
imports and the existing installed Node/React types allow the same modules to
run through Node's type stripping and Expo TypeScript checks without dependencies.

Device/emulator connectivity, cleartext HTTP behavior, and native rendering have
not been verified. Device loopback requires an appropriate forwarding setup.
Requests use native GET, an Accept header, and AbortController; browser-specific
credential/redirect options are not assumed to work across native transports.
Redirect metadata or a changed final response URL is rejected before data is
returned, but a native transport may already have followed that redirect, and
may omit URL metadata. Cookie isolation is not guaranteed by this wrapper.

Router, navigation, screens, reference lookup UI, native rendering tests,
Android smoke testing, and deferred Web Browser QA remain later work.
