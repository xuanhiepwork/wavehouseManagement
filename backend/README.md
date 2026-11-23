# WaveHouse Backend

Requires Node.js 24 LTS. The backend now uses PostgreSQL + Prisma for every runtime
module. MongoDB is retained only as legacy source/tests and optional data storage
pending data reconciliation. Read the current
[runtime guide and audit](docs/postgresql-runtime-audit.md) before testing.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and configure the `wavehouse_app` password and
Aiven CA certificate, then run `npm run dev`. An existing `.env.local` on this
workstation already enables Aiven read-only checks on port 5001. For compiled output,
run `npm run build` followed by `npm start`. Startup exits with an error if
a required database cannot be reached. SIGINT/SIGTERM close sockets and Prisma
database connections; repeated signals share one shutdown.

`PORT` defaults to 5000; use 5001 to match the existing Vite proxy. `MONGO_URI` is
ignored. `CORS_ORIGIN` optionally accepts a
comma-separated list of browser origins; otherwise all origins are allowed.

- `GET /`: process status.
- `GET /health`: 200 with `{"status":"ok"}` when PostgreSQL is reachable;
  otherwise 503 with `{"status":"unavailable"}`.
- `GET /api-docs/`: Swagger UI; `/api-docs.json`: OpenAPI schema.
- Socket.IO `update_inventory` relays its payload as `inventory_changed`.
  This is a scaffold event and does not validate or persist inventory.

Run `npm test` for compilation and database-free unit/regression tests.
`npm run prisma:validate` and client generation use the offline config.
`npm run audit:postgres` and `npm run smoke:postgres` force read-only PostgreSQL
sessions; smoke uses a transient login fixture and exits 2 for unavailable modules.
`npm run test:postgres` only accepts an isolated local test database with an existing
schema, never runs migrations, and writes test fixtures there. The local test
database is currently unavailable; no Aiven write tests have been performed.

From the repository root, Docker Compose now starts the PostgreSQL backend without
depending on MongoDB. It requires `backend/.env.local` and `ca.pem`; the legacy
database is opt-in with the `legacy-mongo` profile. Docker build/run was not tested.
Authentication and inventory modules use Prisma. Missing database permissions on
new receiving/sales tables currently block five read endpoints; see the audit.

## PostgreSQL runtime

All catalog stores default to PostgreSQL. Optional old `CATALOG_*_STORE` variables
must equal `postgres`; selecting MongoDB fails explicitly. Mixed modes are retired.

Configuration precedence is exported variables, `.env.local`, `.env`, then
`.env.postgres`, without overriding earlier values. Test mode loads no env files.
Runtime supports explicit development/test environments; Aiven requires development,
TLS and the non-elevated `wavehouse_app` identity in `wavehouse_dev`.
Local tests use only `TEST_DATABASE_URL` and the matching isolated test role/database.
The [older phase guide](docs/postgresql-local.md) and commands below are historical
references; they do not authorize migrations, role changes or Aiven writes.

---

#   KHỞI ĐỘNG BACKEND
Terminal 1 — Chạy Backend

## Tại thư mục backend, chạy:
cd D:\code\DoAn\WaveHouseManagement\backend

.\node_modules\.bin\tsc.cmd

if ($LASTEXITCODE -ne 0) {
    throw 'BACKEND BUILD FAILED'
}


## Sau đó, trong chính Terminal này, bảo đảm các biến môi trường dành cho Aiven đã được thiết lập:
```
$env:NODE_ENV='development'
$env:PORT='5000'
$env:CATALOG_POSTGRES_TARGET='aiven'
$env:CATALOG_INGREDIENT_STORE='postgres'
$env:CATALOG_PRODUCT_STORE='postgres'
$env:CATALOG_RECIPE_STORE='postgres'
$env:AIVEN_CA_PATH='D:\code\DoAn\WaveHouseManagement\ca.pem'

```


## Kiểm tra mật khẩu của wavehouse_app:
```
if (-not $env:AIVEN_DB_PASSWORD) {
    Write-Host 'CHUA CO MAT KHAU wavehouse_app TRONG TERMINAL NAY'
}
```

## Nếu hiện thông báo thiếu mật khẩu, nhập lại mật khẩu wavehouse_app bằng cách sau:
$secret = Read-Host 'Mat khau wavehouse_app' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:AIVEN_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secret.Dispose()
}


## NHẬP MẬT KHẨU ADMIN AIVEN
$secret = Read-Host 'Nhap mat khau Aiven avnadmin' -AsSecureString

$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)

try {
    $env:AIVEN_ADMIN_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secret.Dispose()
}

Write-Host 'AIVEN ADMIN ENV READY'


#### Lưu ý: AIVEN_ADMIN_DB_PASSWORD của avnadmin không thay thế được AIVEN_DB_PASSWORD của ứng dụng.

## Bây giờ khởi động Backend:
node .\dist\server.js


#### Kết quả mong đợi:
Backend listening on http://localhost:5000



---

# SAO LƯU PRIMA SCHMA TRƯỚC KHI SỬA DATABASE

cd D:\code\DoAn\WaveHouseManagement\backend

$b4Baseline = Join-Path $env:TEMP (
    'wavehouse_before_B4_' +
    (Get-Date -Format 'yyyyMMdd_HHmmss') +
    '.prisma'
)

Copy-Item .\prisma\schema.prisma $b4Baseline

Write-Host "B4 BASELINE: $b4Baseline"

## W7.3 — báo cáo doanh thu và đối soát tiền (chưa thực hiện QA)

Phần triển khai nằm trong `src/services/sales-report.service.ts`,
`src/routes/sales-report.routes.ts` và các model Sales trong `prisma/schema.prisma`.
Migration mới duy nhất: `prisma/migrations/20261121000000_w7_sales_reporting/migration.sql`.
Migration này chỉ được soạn, chưa chạy. Không thay đổi các migration trước đó.

### Hợp đồng API

Tất cả endpoint dùng Bearer token và middleware xác thực hiện có:

| Phương thức | Đường dẫn | Chức năng |
| --- | --- | --- |
| GET | `/api/sales-reports` | Lọc `branchId`, `from`, `to`, `shift`, `status`, `page`; 20 báo cáo/trang |
| POST | `/api/sales-reports` | Tạo bản nháp và snapshot đầu tiên |
| GET | `/api/sales-reports/:id` | Báo cáo, snapshot hiện tại, tổng tiền và quyền thao tác |
| PATCH | `/api/sales-reports/:id` | Thay toàn bộ nội dung nháp bằng snapshot mới, kèm `expectedVersion` |
| POST | `/api/sales-reports/:id/submit` | Gửi snapshot đã lưu, kèm `expectedVersion` |
| POST | `/api/sales-reports/:id/return` | Trả lại, kèm `expectedVersion`, `revisionNumber`, `reason` bắt buộc |
| POST | `/api/sales-reports/:id/approve` | Duyệt, kèm `expectedVersion` và `revisionNumber` đã gửi |
| GET | `/api/sales-reports/:id/revisions` | `{ data: { revisions, events } }`, gồm chi tiết mọi snapshot và nhật ký |

Danh sách trả `{ items, page, total }`; chi tiết và mutation trả `{ data: report }`.
`currentRevision.totals` là tổng chính thức của bản đang lưu. Lỗi dữ liệu trả 400;
401/403 cho phiên/quyền, 404 khi không tìm thấy hoặc không được truy cập chi nhánh,
409 cho trùng báo cáo, phiên bản cũ hoặc xung đột transaction; 503 khi chưa dùng được DB.
Không tự thử lại các lệnh ghi khi mất kết nối hoặc gặp xung đột.

Body tạo/cập nhật gồm `branchId`, `businessDate` (YYYY-MM-DD),
`shift` (MORNING/AFTERNOON/EVENING), `note`, `discounts`, `lines`, `payments`,
`expenses`, `cash`. PATCH giữ nguyên chi nhánh/ngày/ca và thay toàn bộ chi tiết.
Một dòng có `productId` (UUID hoặc null khi nhập tay), `productName`, `size`,
`quantity` (số nguyên), `unitPrice` (chuỗi nguyên VND), `note`.
Payment có `channel`, `collectedAmount`, `refundedAmount`, `platformFee`,
`settlementDifference`, `note`. Expense có `channel`, `description`, `amount`.
Cash có `openingCash`, `cashHandovers`, `closingCashActual` (có thể null khi nháp).
Không nhận actor, trạng thái, số revision hoặc tổng tính toán do client tự đặt.

### Giả định nghiệp vụ và giới hạn ban đầu

- Mỗi chi nhánh/ngày/ca có đúng một báo cáo; không có xóa hoặc mở lại báo cáo đã duyệt.
  Ngày kinh doanh do người dùng chọn; UI mặc định ngày Việt Nam, DB lưu kiểu DATE.
  Chưa áp đặt hạn chốt ca hay ngày kết thúc sổ vì mã nguồn chưa định nghĩa quy tắc này.
- Người tạo sở hữu quyền sửa/gửi nháp, áp dụng cho cả STAFF, BRANCH_MANAGER và ADMIN.
  STAFF và BRANCH_MANAGER chỉ truy cập chi nhánh được phân công. ADMIN truy cập toàn hệ thống.
  Manager/Admin được trả lại/duyệt báo cáo SUBMITTED thuộc phạm vi; không được tự duyệt báo cáo mình gửi.
  Chi nhánh ngừng hoạt động chỉ xem được lịch sử; không ghi hoặc xét duyệt tiếp.
- `version` tăng mỗi thao tác ghi, độc lập với số revision. Mỗi lần lưu nháp tạo toàn bộ
  snapshot mới; gửi/duyệt chỉ trỏ tới snapshot đã lưu. Báo cáo RETURNED vẫn giữ snapshot
  đã gửi và lý do cũ cho đến khi gửi lại; lịch sử sự kiện giữ đầy đủ các lần trả/gửi.
- Tất cả tiền nhận bằng chuỗi nguyên VND không âm, tối đa 12 chữ số cho mỗi khoản nhập.
  `settlementDifference` cho phép âm. DB dùng Decimal(18,0), tổng có thể âm khi thích hợp;
  không dùng số thực JavaScript cho phép tính tiền. Tối đa 100 dòng bán hàng, 100 khoản chi,
  5 kênh thanh toán và 999999 ly/dòng. Phân trang báo cáo tối đa trang 10000.
- `recognizedRefunds = SUM(refundedAmount)` của các kênh. Chỉ ghi hoàn của doanh thu
  đã nằm trong grossSales của cùng báo cáo; chưa xử lý hoàn thuộc ca khác, đối chiếu
  từng đơn, hoặc tích hợp chứng từ từ nền tảng. Tiền hoàn không bị trừ hai lần khỏi
  cùng chỉ tiêu. Số hoàn có thể lớn hơn số thu ở một kênh; chênh lệch vẫn được hiển thị.
- Thu qua nền tảng là số thu trước phí. Phí nền tảng và chênh lệch thanh toán chỉ là
  các trường theo dõi riêng, không tự giảm doanh thu hay tự biến thành chi phí tiền mặt.
  Khoản chi tiền mặt phải được ghi rõ trong expenses; không ghi trùng phí ở hai nơi.
- Cash handover là số đã bàn giao trong ca, không bao gồm tiền còn lại thực đếm.
  Expected cash âm vẫn được hiển thị để đối chiếu; chênh lệch không tự chặn duyệt
  và không được coi là kết luận gian lận hay vi phạm.
- Nháp cho phép không có dòng, dòng nhập tay/OTHER, số lượng 0 và thiếu actual cash.
  Trước gửi, mọi dòng hiện có phải có số lượng dương và liên kết rõ ràng với
  sản phẩm/size Catalog đang bán, actual cash đã nhập, netExpected không âm.
  Ca không phát sinh bán hàng được gửi với danh sách dòng trống và ghi chú giải thích.
- Catalog PostgreSQL dùng `_id` ở API nhưng báo cáo dùng `id`. Dòng được giải bằng
  productId + size, không yêu cầu variant ID. ID sai hoặc size không tồn tại bị từ chối;
  không chuyển ID MongoDB hoặc tự ghép tên với sản phẩm. Giá thực tế được nhập rõ,
  có thể khác Catalog; việc đọc/gửi/duyệt không tính lại theo giá hiện tại.
  Tên snapshot được giữ ở các lần sửa cùng product/size. Giá lẻ VND từ Catalog
  cần được người dùng sửa thành giá nguyên rõ ràng; không tự làm tròn.
- Hai menu web dùng cùng `PersistentSalesReportPage`, giữ mounted để không mất
  nội dung khi điều hướng. Tổng hiển thị là bản đã lưu từ server; nháp chưa lưu
  được đánh dấu. Reload/đăng xuất có cảnh báo mất thay đổi; không lưu token vào file.
  JSON W7.3/W4 chỉ nhập dữ liệu nháp, không nhận quyền duyệt, trạng thái hay tổng tiền.
  Hoàn tổng trong file W4 phải phân bổ và xác nhận theo kênh trước khi lưu; dòng nhập
  tay cần chọn Catalog trước gửi. Các component W4 cũ được giữ để tương thích.
- Snapshot, collections và event có trigger chống sửa/xóa. Child collections chỉ
  được INSERT cùng transaction tạo snapshot, dựa trên PostgreSQL xmin; không dùng
  savepoint/subtransaction khi tạo snapshot. Trigger deferred kiểm tra con trỏ
  revision và tổng tiền sau khi hoàn tất các nested insert.
- Không có mutation inventory, recipe consumption hay tự trừ nguyên liệu ở W7.3.
  B6 vẫn phụ trách điều chỉnh kiểm kê; B5/W7.2 nhận/chuyển hàng được giữ nguyên.
  Dashboard tương lai chỉ lấy report APPROVED và revision khớp approvedRevisionNumber;
  không cộng tất cả revisions hoặc coi JSON nháp là dữ liệu đã duyệt. AI/dashboard chưa triển khai.

### Công thức phía server

```text
grossSales      = SUM(quantity * unitPriceSnapshot)
recognizedRefunds = SUM(payments.refundedAmount)
netExpected     = grossSales - discounts - recognizedRefunds
netRecorded     = SUM(collectedAmount - refundedAmount)
salesDifference = netRecorded - netExpected
expectedCash    = openingCash + cashCollected - cashRefunded - cashExpenses - cashHandovers
cashDifference  = closingCashActual - expectedCash
```

Khi chưa nhập actual cash, cashDifference là null. Mọi tổng được lưu trong snapshot,
và migration có kiểm tra tổng so với chi tiết tại cuối transaction.

### Để lại cho QA cuối ứng dụng

Chưa chạy test, build, typecheck, Prisma validate/generate, migration, server,
thử nghiệm UI hoặc kết nối DB/Aiven. Generated Prisma client chưa được cập nhật;
cần tạo lại từ schema mới trong giai đoạn QA được cho phép trước khi compile/run.
QA cần đánh giá migration/trigger/grants trong DB thử nghiệm, các luồng phân quyền,
concurrent save/submit/review và xung đột 409, tính tiền/overflow/refund/phí,
Catalog đổi tên/giá/size, nhập W4, trạng thái lỗi 401/403/404/503, phục hồi khi mạng
gián đoạn, giữ nội dung khi điều hướng và giao diện lịch sử/đối soát.
Không commit, push hoặc triển khai trong công việc W7.3 này.

## W7.4 — Dashboard quản lý dùng dữ liệu server (QA để sau)

Endpoint mới: `GET /api/dashboard/summary?branchId=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD`.
Nếu không truyền cả hai ngày, mặc định 14 ngày Việt Nam gần nhất (gồm hôm nay).
Nếu truyền ngày, phải truyền đủ from/to, đúng ngày lịch, from <= to và tối đa 93 ngày
bao gồm cả hai đầu. Tất cả mốc thời gian nhận hàng sử dụng ranh giới ngày UTC+07.
SalesReport và ShiftStockCount lọc theo businessDate kiểu DATE.

ADMIN được xem một chi nhánh hoặc tất cả chi nhánh, gồm lịch sử của chi nhánh đã ngừng
hoạt động. Hiện chưa có model phân vùng khu vực, nên “khu vực” của ADMIN là toàn bộ
chi nhánh trong hệ thống. BRANCH_MANAGER luôn bị giới hạn bởi branchId trong phiên;
yêu cầu branchId khác bị trả 403 trước khi đọc dữ liệu chi nhánh đó. STAFF không được
gọi dashboard. Giữ nguyên middleware xác thực và quyền ADMIN-only của B7.
Không trả thông tin tài khoản, tên nhân viên hoặc nội dung ghi chú cá nhân.

### DTO thực tế

```ts
{
  data: {
    scope: {
      mode: 'BRANCH' | 'ALL_BRANCHES', branchId: string | null,
      branches: Array<{ id, code, name, isActive }>,
      from: string, to: string, timeZone: 'Asia/Ho_Chi_Minh', maxRangeDays: 93
    },
    asOf: string,
    coverage: {
      statuses: StatusCounts,
      representedBranchIds: string[], approvedBranchIds: string[],
      coveredDates: string[], coveredShifts: WorkShift[],
      reportedSlots: Array<{ reportId, branchId, businessDate, shift, status }>,
      scheduleKnown: false, completionPercentage: null
    },
    kpis: Financials | null,
    salesSeries: Array<{ date, approvedReports, totals: Financials | null }>,
    salesByShift: Array<{ shift, totals: Financials | null }>,
    paymentChannels: Array<{
      channel, paymentRecords, collectedAmount, refundedAmount,
      netRecorded, platformFee, settlementDifference
    }>,
    branchSummaries: Array<{
      branch, coverage: StatusCounts, kpis: Financials | null,
      inventory: InventoryStats, latestSalesUpdate: string | null
    }>,
    stockCountSummary: {
      period: StatusCounts, items: CountRow[], currentUnresolved: CountRow[],
      latestUpdatedAt: string | null, scheduleKnown: false,
      missingRequiredRecords: null, varianceMeaning: 'COUNT_DIFFERENCE_NOT_CONSUMPTION'
    },
    receivingSummary: {
      period: {
        basis: 'TRANSFER_POSTED_AT', ...ReceivingStats,
        confirmedDuringPeriod: number, confirmedDuringPeriodWithDiscrepancy: number,
        damageBasis: 'RECEIPT_CONFIRMED_AT', confirmedDamage: IngredientDamage[]
      },
      backlog: {
        basis: 'CURRENT_UNCONFIRMED', asOf: string, ...ReceivingStats,
        undatedTransfers: number, items: PendingTransfer[]
      },
      discrepancies: ReceivingDiscrepancy[], latestUpdatedAt: string | null
    },
    inventorySummary: {
      basis: 'CURRENT_BALANCES', asOf: string, ...InventoryStats,
      activeIngredients: number, latestUpdatedAt: string | null, rows: InventoryRow[]
    },
    restockPlanning: {
      available: boolean, mode: 'RULE_BASED', requiresExplicitParameters: true,
      endpoint: string | null, requiredParameters: string[],
      maxDestinationBranches: 10, forecast: null
    },
    exceptions: { total: number, limit: 100, truncated: boolean, items: Exception[] },
    warnings: Array<{ code, message }>
  }
}
```

`StatusCounts` gồm total và bốn trạng thái DRAFT/SUBMITTED/RETURNED/APPROVED.
`Financials` gồm grossSales, discounts, recognizedRefunds, netExpected, netRecorded,
salesDifference, cashDifference, beveragesSold (đều là chuỗi số nguyên), cùng số
approvedReports, salesDiscrepancyReports và cashDiscrepancyReports.
`InventoryStats` gồm availableBalances, missingBalances, zeroStock, belowMinimum,
negativeStock. `InventoryRow` giữ branchId/ingredientId, code/name/unit/isActive,
quantity (chuỗi hoặc null), minStock, updatedAt và các cờ cảnh báo độc lập.
`ReceivingStats` gồm postedTransfers, confirmed, draft, awaiting, legacyUnresolved,
discrepancyReceipts và draftDiscrepancyReceipts. Chi tiết kiểu frontend nằm tại
`web/src/workspace/dashboard/dashboard.api.ts`; backend tại `src/services/dashboard.service.ts`.

### Quy tắc toàn vẹn và cách đọc số liệu

- Chỉ report APPROVED trong kỳ mới góp vào tài chính. Bắt buộc approvedRevisionNumber
  khớp currentRevisionNumber và submittedRevisionNumber; tải đúng một cặp reportId/number.
  Thiếu snapshot hoặc con trỏ bất nhất trả lỗi thay vì bỏ qua và làm giảm tổng.
  Đọc tổng W7.3 đã lưu, không tính lại giá Catalog hoặc cộng các revision cũ.
- Các phép cộng tiền/số lượng dùng Decimal riêng có precision 60, không thay cấu hình
  Decimal toàn cục của B5/B6/B7/W7.3. Trả tiền nguyên VND dạng chuỗi; lượng nguyên liệu
  dạng chuỗi 6 chữ số thập phân. Số ly được lấy từ SUM(quantity) của đúng revision,
  kiểm tra số nguyên an toàn trước khi cộng vào Decimal. Phí/settlement giữ riêng.
- Không có bản duyệt thì kpis/totals tương ứng là null. Ngày không có bản duyệt vẫn
  xuất hiện trong salesSeries với totals null. Báo cáo duyệt thực sự có doanh thu 0
  vẫn trả chuỗi "0". Không dùng JSON W4/W7.3, dữ liệu local, tổng nội suy hoặc lịch ca giả.
  Coverage chỉ liệt kê bản ghi thực có, không tính phần trăm hoàn thành.
- Tất cả truy vấn summary dùng cùng transaction RepeatableRead và READ ONLY;
  asOf lấy từ transaction_timestamp. Không có thao tác thay đổi sổ kho, số dư,
  phiếu nhận hàng, kiểm kê hay trạng thái báo cáo.
- Tồn kho là số dư hiện tại, gồm cả số dư nguyên liệu đã ngừng hoạt động (có cờ rõ).
  Với nguyên liệu đang hoạt động chưa có số dư ở chi nhánh, tạo dòng DTO quantity null;
  không ghi thêm balance và không coi là tồn 0. Cảnh báo zeroStock/belowMinimum có
  thể cùng đúng ở một dòng. Cặp chưa có số dư chỉ thể hiện độ phủ dữ liệu Catalog,
  không khẳng định chi nhánh bắt buộc kinh doanh hoặc dự trữ mọi nguyên liệu.
  Không cộng các số đếm cảnh báo như các tập không giao nhau.
  Không tạo tổng lượng nguyên liệu khác đơn vị.
- B6 hiển thị trạng thái theo ngày kinh doanh và danh sách hồ sơ hiện chưa hoàn tất
  trên mọi ngày, kể cả ngoài kỳ lọc. Không có lịch ca chuẩn nên số phiếu bắt buộc còn
  thiếu là null. Không dùng variance âm làm chỉ tiêu tiêu thụ.
- Nhóm nhận hàng period dùng tập phiếu chuyển POSTED có postedAt trong kỳ, phân loại
  bằng trạng thái biên bản tại asOf. confirmedDuringPeriod dùng confirmedAt trong kỳ,
  nên vẫn nhận ra biên bản vừa xác nhận cho phiếu chuyển ghi sổ từ kỳ trước.
  confirmedDamage cũng theo confirmedAt, chỉ dùng snapshot CONFIRMED và nhóm theo
  ingredientId + unit; nháp không góp vào tổng hư hỏng đã xác nhận.
- Backlog nhận hàng là tất cả POSTED transfer tới chi nhánh trong phạm vi nhưng chưa
  có receipt hoặc receipt còn DRAFT, không giới hạn ngày. Phiếu lịch sử chưa xác nhận
  được giữ nguyên và đánh dấu. Phiếu thiếu postedAt có cảnh báo/undatedTransfers,
  không được tự gán ngày vào nhóm phiếu ghi sổ theo kỳ. Đây không phải backlog tại
  ngày cuối kỳ trong quá khứ. Hàng ghi sổ, hàng thực nhận, hư/thiếu và sửa tồn qua B6
  được trình bày riêng; không tự bù trừ.
- Dashboard cung cấp form B7 riêng cho ADMIN: phải chọn rõ businessDate, shift,
  sourceBranchId và 1–10 destinationBranchIds khác nguồn. Gọi lại loadForecast/API B7
  có sẵn khi người dùng yêu cầu; summary không tự suy diễn đầu vào hoặc gọi dự báo.
  B7 vẫn là baseline theo quy tắc từ kiểm kê, không phải mô hình ML hoặc số tiêu thụ
  được chứng minh. Không triển khai AI1–AI4, không đổi thuật toán B7.

### Giới hạn và UI

Summary từ chối 413 nếu vượt 100 chi nhánh, 10000 sales reports, 10000 stock counts,
5000 transfers liên quan, 25000 receipt items, 2000 active ingredients hoặc 20000 dòng
inventory/matrix. Không trả KPI một phần và không tự cắt tổng. Exceptions là bản xem
trước tối đa 100 mục với total/truncated rõ ràng; các bảng nguồn được trả đầy đủ trong
giới hạn và UI phân trang 25 dòng. Dropdown ADMIN đọc đủ các trang B2, tối đa 1000
chi nhánh; vượt giới hạn báo lỗi thay vì âm thầm lấy một phần.

Lỗi 400/401/403/404/413/503 có trạng thái giao diện phù hợp. Khi nguồn bắt buộc không
đọc được hoặc W7.2/W7.3 schema chưa sẵn sàng, summary thất bại toàn bộ; không thay bằng
số 0. Request gắn với bộ lọc, hủy/loại phản hồi cũ khi đổi phạm vi. UI chỉ định dạng
và trực quan hóa tổng server; dùng BigInt cho tỷ lệ chiều dài biểu đồ trước khi đổi
thành số phần trăm nhỏ phục vụ CSS, không tính lại tiền ở trình duyệt.

AreaDashboard, dashboard.logic và AreaDashboard.css của W6 được cập nhật, loại bỏ
nguồn doanh thu JSON và giới hạn 12 chi nhánh phía trình duyệt. Tổng quan nối dashboard
cho ADMIN/BRANCH_MANAGER; STAFF giữ trang công việc cũ. Giữ mounted editor W7.3 và
các chặn chuyển trang/đăng xuất W7.2; không sửa mobile, Catalog hoặc auth.
Các nút mở khu vực dẫn tới module hiện có, chưa chọn tự động một chứng từ theo ID.

W7.4 không đổi schema và không tạo migration. W7.2/W7.3 chưa deploy và generated
Prisma Client có thể cũ; việc generate/deploy chỉ được làm trong QA được cho phép.
Chưa chạy test/build/typecheck/lint/Prisma validation/generation, server, HTTP request,
database/migration hoặc Aiven. QA cuối cần kiểm tra hợp đồng DTO, quyền và chống lộ
dữ liệu giữa chi nhánh, biên ngày Việt Nam, chỉ chọn một approved revision, tổng lớn,
no-data/null/zero, unit/damage/current-backlog, lỗi schema/quyền DB, thay bộ lọc nhanh,
timeout và pagination, biểu đồ desktop/accessibility, luồng B7 cùng W7.2/W7.3.
Không commit, push, merge, đổi nhánh hoặc deploy trong công việc W7.4 này.

## W7.5 — Desktop Website và Backend integration (implementation only)

W7.5 hoàn thiện mã tích hợp trên nhánh `test`. Chỉ đọc và sửa nguồn; không chạy
test/build/typecheck/lint, Prisma validate/generate/migration, server, HTTP, browser
automation, DB hoặc Aiven. Không commit/push/merge/đổi nhánh/deploy, không sửa mobile,
`.env`, schema hoặc migration trong W7.5. Các thay đổi W7.2–W7.4 đang có được giữ lại.
Các mô tả dưới đây là hành vi đã triển khai trong nguồn, chưa phải kết quả QA.

### Menu và hợp đồng API

| Màn hình | API đã nối | Quyền |
| --- | --- | --- |
| Tổng quan | `GET /api/dashboard/summary` | ADMIN, BRANCH_MANAGER; STAFF mở trang công việc |
| Chi nhánh | `GET/POST /api/branches`, `GET/PATCH /api/branches/:id` | ADMIN |
| Tài khoản nhân viên | `GET/POST /api/users`, `GET/PATCH /api/users/:id`, `POST /api/users/:id/reset-password` | ADMIN; chỉ quản lý STAFF/BRANCH_MANAGER |
| Catalog | `/api/ingredients`, `/api/products`, `/api/recipes` và các endpoint lifecycle sẵn có | Menu ADMIN; gửi Bearer session hiện tại |
| Kho và lịch sử biến động | `GET /api/inventory/balances`, `GET /api/inventory/movements` | ADMIN chọn chi nhánh; các vai trò khác chỉ chi nhánh được gán |
| Nhập nhà cung cấp | `GET/POST /api/goods-receipts`, `GET/PATCH /:id`, `POST /:id/post`, `POST /:id/cancel` | ADMIN/manager ghi trong phạm vi; STAFF chỉ xem |
| Xuất kho | Các endpoint tương ứng dưới `/api/stock-issues` | ADMIN/manager ghi trong phạm vi; STAFF chỉ xem |
| Chuyển kho | Các endpoint tương ứng dưới `/api/stock-transfers` | Chỉ ADMIN ghi; manager/STAFF xem nguồn hoặc đích được phép |
| Chốt ca và kiểm kê | Template, list/detail/create/update/submit/return/approve dưới `/api/shift-stock-counts` | Giữ quyền và receiving guards B6/W7.2 |
| Nhận hàng đầu ca | Incoming POSTED transfers, receipt draft/detail/update/confirm của W7.2 | Giữ phạm vi chi nhánh nhận và quyền server |
| Báo cáo bán hàng / Đối soát tiền | `/api/sales-reports` và submit/return/approve/revisions | Một editor W7.3 dùng chung; STAFF nhập tiền qua báo cáo |
| Đề xuất bổ sung | `GET /api/restock-planning/recommendations` | ADMIN chọn rõ ngày/ca/nguồn/1–10 điểm nhận |
| Điều phối giao hàng | B7 → `POST /api/stock-transfers`, đọc đối chiếu mã, mở phiếu B5/nhận hàng | ADMIN; tạo DRAFT riêng với POST ghi sổ |

Chi nhánh hỗ trợ chi tiết, tạo, sửa tên, kích hoạt/ngừng hoạt động. Mã không sửa sau
khi tạo. Nhân sự hỗ trợ lọc `q` (tên/email), `role`, `branchId`, `isActive`, tạo và
sửa trường được API cho phép, vô hiệu hóa/kích hoạt và reset mật khẩu 12–128 ký tự.
Email đã tạo không sửa. ADMIN chỉ xem; không có tạo/sửa/reset ADMIN hoặc hiển thị hash.
Backend vẫn áp dụng `requireAuth`/`requireAdmin` và thu hồi session của user bị sửa/reset.

B4/B5 có danh sách phân trang, chi tiết, trạng thái và mốc truy vết hiện có, tạo/sửa
nháp, chọn nguyên liệu, số lượng và đơn giá cho B4; xem tồn nguồn. POST và hủy cần
xác nhận rõ ràng; mở trang, tải chi tiết, sửa hoặc lưu DRAFT không tự ghi sổ.
TRANSFER POST vẫn trừ nguồn và cộng đích trong cùng giao dịch. W7.2 chỉ ghi thực nhận,
thiếu/thừa/hỏng, không cộng tồn lần nữa. Danh sách chuyển kho hiện tình trạng biên bản
nhận hàng và dấu phiếu lịch sử. Tài khoản chỉ có phạm vi nguồn không được ký nhận đích.

Điều phối tạo đúng một phiếu DRAFT cho mỗi điểm nhận có lượng giao dương. Mã phiếu
duy nhất và nội dung bộ phiếu được lưu vào sessionStorage trước khi gửi từng request.
Kết quả chưa rõ phải đối chiếu bằng GET; gửi tiếp chỉ sau xác nhận và giữ nguyên mã.
Không tự retry POST. Bộ mã có thể khôi phục sau reload trong cùng tab ngay cả khi
chưa tải lại B7. Từng phiếu đã tạo mở được trong B5 để POST bằng thao tác riêng.
Giờ giao/người phụ trách và JSON là nháp cục bộ, chưa phải lịch giao hay phân công
trên server. Một bộ mã không thay thế giao dịch nguyên tử cho toàn đợt: có thể lưu
thành công một phần, kết quả từng phiếu được giữ để tiếp tục đối chiếu.

### Transport, phân trang và trạng thái biểu mẫu

`workspace/api.ts` tập trung Bearer transport, thông báo 401, lỗi 403/404/409/network,
timeout cho client mới và không tự retry request ghi. Giữ duy nhất token store W1.
Xác thực lại cùng tài khoản/role/branch giữ các editor đang mở; kiểm tra scope trước
khi thay token lưu trữ. Phản hồi 401 muộn của token cũ không làm hết hạn token mới.
Các adapter W7.2/W7.3/W7.4 giữ kiểm tra DTO/lỗi đặc thù và dùng transport chung.
Catalog thêm tùy chọn same-origin và Bearer động; vẫn giữ `_id`, `{data,pagination}`,
URL, endpoint, schema giá và quy trình tạo/lifecycle đã có, cùng cấu hình standalone.

Danh sách nghiệp vụ dùng `{items,page,total}` và 50 dòng/trang. Dropdown cần đầy đủ
đọc tiếp các trang thay vì dừng ở trang 1. Catalog nguyên liệu cho chứng từ đọc cả
active/inactive để giữ metadata lịch sử. B3 trả metadata ingredient từ Prisma relation
(mã, tên, đơn vị, minStock, trạng thái), timestamp và filter `ingredientId`; UI không
đoán đơn vị. Lịch sử giữ delta/số dư có dấu, so sánh ngưỡng bằng số thập phân chính xác.
GET users bổ sung các bộ lọc trên; GET stock issues/transfers có thêm exact `code`
để đối chiếu kết quả tạo phiếu mà không nới phạm vi truy cập.

Editor được giữ mounted sau lần mở menu đầu tiên; hai mục bán hàng/tiền dùng đúng
một editor persist W7.3. Có khóa đồng bộ chống ghi trùng, loading/empty/error/success,
cảnh báo trước bỏ thay đổi, logout/reload và đối chiếu sau kết quả ghi chưa rõ.
W2 không bỏ số đang nhập khi refresh token, có pagination và giữ nguyên các mã lỗi
receiving/inventory snapshot. W7.4 vẫn chỉ dùng approved revision chính thức; không
phục hồi JSON doanh thu làm nguồn chính thức, không coi sai lệch kiểm kê là tiêu thụ.

### Files của W7.5

Tạo mới trong `web/src/workspace/`:

- `api.ts`, `SessionRefresh.tsx`, `useWorkspaceForms.ts`.
- `management/ManagementPage.tsx`, `ManagementPage.css`, `BranchManagement.tsx`,
  `UserManagement.tsx`, `management.api.ts`, `management.shared.tsx`.
- `inventory/InventoryPage.tsx`, `InventoryPage.css`, `inventory.api.ts`.
- `stock-documents/StockDocumentsPage.tsx`, `StockDocumentsPage.css`, `stock-documents.api.ts`.
- `warehouse/DispatchTransfersPanel.tsx`.

Sửa trong W7.5: `web/src/App.tsx`, `web/src/api/catalog.ts`, `web/src/catalog/Catalog.tsx`;
`workspace/WorkspaceApp.tsx`, `WorkspaceApp.css`, `auth.ts`; `receiving/ReceivingPage.tsx`,
`receiving.api.ts`; `shift/ShiftStockCountPage.tsx`, `shift-count.api.ts`;
`warehouse/WarehousePage.tsx`, `WarehousePage.css`, `warehouse.api.ts`, `delivery-draft.ts`;
`sales/sales.api.ts`, `dashboard/dashboard.api.ts`; `backend/src/routes/inventory.routes.ts`,
`stock-document.routes.ts`, `user.routes.ts` và README này. Những thay đổi schema,
migration, services và files W7.2–W7.4 đã có trước không phải schema mới của W7.5.

### Giới hạn và QA cuối được hoãn

Không còn placeholder menu cho chức năng B1–B7 đã được nối. Backend chưa có lịch giao
bền vững, driver role, trạng thái đang vận chuyển, lịch sử sửa từng phiên bản chứng từ
B4/B5 hay chỉnh tồn tự do; UI không tạo các khả năng này. Metadata chứng từ cũ lấy
Catalog hiện tại, không khẳng định là snapshot tại thời điểm chứng từ nếu backend
không lưu snapshot đó. Biểu mẫu chưa lưu nằm trong bộ nhớ tab; riêng bộ mã dispatch
có journal sessionStorage, không đồng bộ giữa tab/máy và cần đối chiếu nếu bộ nhớ bị mất.

Không có schema/migration mới. Migration W7.2/W7.3 chưa apply, Prisma Client có thể
cũ; không được coi ứng dụng đã chạy được. QA cuối cần thực hiện generate/migration
theo quy trình được cho phép rồi kiểm tra biên dịch, DTO, auth/role/branch, CRUD và
phân trang, active/inactive metadata, decimal/piece, POST/hủy, concurrent writes,
timeout/mất phản hồi, khôi phục bộ phiếu, refresh session, unsaved state, keyboard/UI
desktop và toàn bộ hồi quy W7.2/W7.3/W7.4. Không có kiểm tra nào được tuyên bố đã pass.
