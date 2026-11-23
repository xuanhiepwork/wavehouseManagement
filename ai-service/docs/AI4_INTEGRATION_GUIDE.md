# AI4 — WaveHouse AI Forecast Display (source-only, QA deferred)

## What this package does

Only adds the following desktop frontend files; existing W1–W7.5, Python AI1/AI2/AI3, B7, Catalog and mobile are not modified.

- `web/src/workspace/ai4/ai4.logic.ts`: strict parser for B7 forecast and optional AI3 overlay, decimal formatting without JS floating-point conversion.
- `web/src/workspace/ai4/ai4.api.ts`: authenticated ADMIN-only GET to existing B2 branch list and B7 recommendations, with pagination.
- `web/src/workspace/ai4/AIAdvisoryPage.tsx`: standalone read-only dashboard (date, shift, source, 1–10 destinations, per-ingredient comparison).
- `web/src/workspace/ai4/AIAdvisoryPage.css`: scoped styling.

## Critical prerequisite: AI3 B7 route wiring

The AI3 add-only package does NOT modify the live B7 router. Until route wiring is completed, `GET /api/restock-planning/recommendations` still typically returns `{ data: B7Forecast }` without `ai`; the AI4 UI **correctly displays B7 with `NOT_CONNECTED`** rather than invented ML values.

After authorized Backend wiring the response is expected to preserve the original B7 body and append a separate `ai` field:

```ts
{
  data: B7Forecast, // unmodified legacy B7 forecast with recommendation rows
  ai: {
    status: 'ML_AVAILABLE' | 'ML_PARTIAL' | 'B7_FALLBACK',
    deliveryQuantitiesRemainB7: true,
    demandEstimates: [
      {
        destinationBranchId, ingredientId, unit, predictedConsumption,
        effectiveDemand, source: 'AI2_ML' | 'B7_HEURISTIC',
        modelVersion, uncertaintyLower, uncertaintyUpper, reason
      }
    ],
    warnings: string[]
  }
}
```

`ai` is derived only by a trusted, ADMIN-authorized Backend projection from APPROVED sales revision + historically attested recipe, never browser-supplied historical observations. When absent/malformed, AI4 shows B7, clearly labeled as heuristic. **B7 proposedDeliveryQuantity remains unchanged.** No automatic stock document creation, inventory movement or approval.

The UI does not access Python directly; it calls the existing `GET /api/restock-planning/recommendations` via Vite `/api` proxy with W1 Bearer session.

## Mount into the CURRENT W7.5 frontend

Because the W7.5 `WorkspaceApp.tsx` and `WarehousePage.tsx` currently on the user's machine are not included in this package, the installer **does not edit them**. Do not transplant obsolete W5/W1 sources. Add to an ADMIN-only menu/mount manually after opening the exact current files:

```tsx
// In web/src/workspace/WorkspaceApp.tsx:
import AIAdvisoryPage from './ai4/AIAdvisoryPage';

// In your existing ADMIN-only 'planning' section or a new ADMIN-only menu branch:
<AIAdvisoryPage session={session} />
```

The above is only a JSX fragment. The exact `selected?.id`/`activeSection` mapping MUST match the user's latest W7.5 source; don't copy an old `WorkspaceApp.tsx`. Alternatively embed it in the existing ADMIN warehouse planning view:

```tsx
import AIAdvisoryPage from '../ai4/AIAdvisoryPage';
// only inside your current ADMIN planning subtree:
<AIAdvisoryPage session={session} />
```

If the current `WarehousePage` already shares the B7 planning input, use its existing data path instead of duplicate queries after QA, but do not silently change W7.5 delivery draft behavior during AI4 integration.

## To request an exact, no-guess integration patch

From the repository root, run `collect_AI4_wiring_sources.ps1` included next to the installer. It produces one TXT file containing only the current code for:

- `web/src/workspace/WorkspaceApp.tsx`
- `web/src/workspace/warehouse/WarehousePage.tsx`
- `web/src/workspace/warehouse/warehouse.api.ts`
- `backend/src/routes/restock-recommendation.routes.ts`

Review source for hard-coded secrets before sharing. This file is enough to write exact AI3 B7 endpoint and AI4 Website mount changes. No DB access, test or build required.

## Deferred QA, not yet done

No training/test/typecheck/build/runtime/migration or database action is performed in this package. QA should confirm:

- The B7 response shape used on the user's latest version matches `ai4.logic.ts`.
- React and TypeScript compatibility with W7.5.
- Role enforcement on B7 and branch directory endpoints.
- Correct B7 fallback when Python is offline/no trained model.
- No ML label when historical recipe evidence is absent.
- ML interval validation, decimals and data coverage.
- Old W5 dispatch amounts remain unchanged.
