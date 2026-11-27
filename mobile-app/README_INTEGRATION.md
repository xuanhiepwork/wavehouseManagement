# WaveHouse Mobile — field operations integration on `test`

This updates the **existing** Expo Router / React Native Mobile project from `origin/mobile-frontend`; it is not a new application. All authoring belongs to the `test` branch and changes only `mobile-app/`.

## Implemented workflows

- **Authentication:** `/api/auth/login` and best-effort `/api/auth/logout`, in-memory session, Bearer on the six existing Catalog GETs and field-operation endpoints; 401 clears the active session. No password/token in Expo public config or persistent device storage.
- **Counter sales (`STAFF` / `SALES`):** today’s actual shift/booth assignments, daily sales report, search Catalog products/sizes/prices, edit a DRAFT/RETURNED report, reconcile multiple payment channels, expenses, cash closing, submit for approval; editability and scope verified by Backend.
- **Receiving at booth:** see the dispatched stops in permitted locations, explicitly check every SKU and quantities/damages, record discrepancies with a reason. The courier cannot confirm receiving in place of booth staff.
- **Inventory & shift counts:** browse authorized booth balances, count every ingredient without defaulting to theoretical stock, create/edit DRAFT/RETURNED counts, submit, manager approval/return (may affect stock; two-stage confirmation).
- **Delivery personnel (`STAFF` / `KITCHEN_DELIVERY`):** assigned trips and ordered stops, pick/dispatch approved trips only when authorized. No separate direct-trip creation shortcut and no courier-side receiving shortcut.
- **Area managers (`BRANCH_MANAGER`) and `ADMIN`:** area overview, list/review sales reports, shift-count approval/return, schedule/availability list, assign or cancel sales-staff shifts with confirmations, area restock plans and discrepancy overview; a different ADMIN can approve/reject eligible plans. The next Backend approval/convert steps are not bypassed.
- **Field UX:** larger buttons (~58 px), readable outdoor contrast, font scaling, low-distraction Vietnamese labels, explicit retries for reads, no automatic retries for stock or sales writes, unknown write outcomes require checking server state first.

## Key safety constraints

- Do not operate the mobile screen while riding/driving. Every delivery action must happen after stopping in a safe location.
- Only **the Backend** authorizes a user’s role, area, branch, shift, and actions. Frontend controls are for convenience, not access control.
- Mobile API operations are online-only and a server response is required. This patch does **not** promise offline sync; it deliberately never queues/retries financial/inventory writes after a timeout.
- The JS session exists in process memory only, so users sign in again after restarting the App. The Backend session store is also process-local and may invalidate sessions on a Backend restart.
- `EXPO_PUBLIC_API_BASE_URL` is a NON-SECRET Backend address ending in `/api` (e.g. `https://api.example.com/api`). For development via USB/ADB reverse only, `http://127.0.0.1:5001/api` is allowed. Public HTTP is not permitted for sign-in.
- The existing Web frontend remains the interface for advanced/admin-only workflows not exposed on Mobile. Avoid changing operational DB state until the separate acceptance phase.

## Development deployment (after code is pushed to `test`)

1. Configure an authorized development/staging Backend and permitted test users for SALES, KITCHEN_DELIVERY, BRANCH_MANAGER, ADMIN.
2. Set `EXPO_PUBLIC_API_BASE_URL` only to a trusted HTTPS Backend; use Android USB `adb reverse` for loopback-only local development if supported.
3. Start Expo from `mobile-app/`; sign in and operate within the user’s server-granted assignments. Do not assume any data exists until fetched from Backend.
4. Run **all** TypeScript, ESLint, Node tests, Android real-device tests, role-based business scenarios and final acceptance **only after the coding/push milestone**, as requested by the project owner.

## Coding/acceptance milestone status

Authoring package contains implementation code, not a claim of current environment validation. No new tests, build or QA have been run for this full integration. Previous Catalog/Mobile test results do not establish that these new operational workflows work on a real device. Push to `test`, not `main`; postpone formal QA until all code is complete.
