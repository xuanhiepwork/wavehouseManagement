# PostgreSQL-only runtime audit — 21/11/2026

Backend đã khởi động được bằng Prisma/Aiven khi chặn hoàn toàn việc tải
`mongoose` và `mongodb`. Đây là chuyển đổi **runtime**, chưa phải xác nhận đã
chuyển đầy đủ dữ liệu hay kiểm thử thành công mọi nghiệp vụ ghi.

Không chạy migration, reset, seed, GRANT, thay đổi role, sửa/xóa dữ liệu Aiven.
Mọi kết nối kiểm tra Aiven chỉ dùng `wavehouse_dev`, với session/transaction chỉ đọc.
Không có mật khẩu, token hay URI chứa credentials trong báo cáo này.

## 1. Phạm vi và bảo toàn working tree

Đã kiểm tra Git trước khi sửa. Working tree có sẵn thay đổi Backend, schema,
W7.2/W7.3/AI5, AI service, Web và tài liệu. Không reset/checkout/stash/commit các
thay đổi đó. Các route W7.2/W7.3/dashboard người dùng đã thêm trong `src/app.ts`
được giữ nguyên. Không sửa schema/migration, business service inventory/receiving/
sales/dashboard/AI, hoặc source Web/mobile/AI trong đợt chuyển runtime này.

Đã tìm kiếm repository, gồm file tracked/untracked, model/controller/service/
route/middleware/validation/test/script, package manifests/lockfiles, Docker,
Web/mobile/AI và tài liệu. Loại trừ `.git`, dependencies, build/generated client,
virtualenv, dữ liệu nhị phân MongoDB. Các env được đọc qua parser, chỉ kiểm tra
tên biến/trạng thái cấu hình; giá trị bí mật không được xuất.

## 2. Phân loại phụ thuộc và mức độ thay thế

Đường dẫn trong bảng tương đối với `backend/` trừ khi ghi rõ root/Web/mobile/AI.

| Thành phần | Trước audit | Phân loại hiện tại / thay thế |
| --- | --- | --- |
| `src/server.ts` | Kết nối Prisma và/hoặc Mongoose theo cờ | Đang sử dụng; chỉ khởi tạo/connect/readiness/disconnect Prisma |
| `src/app.ts` | Import cả router Mongo và PG; auth có thể bị bỏ qua khi thiếu client | Đang sử dụng; chỉ router PG, bắt buộc dependency auth và đủ ba service catalog |
| `src/config/postgres.ts` | Mặc định cả ba store là MongoDB | Đang sử dụng; mặc định PG, từ chối cờ Mongo/mixed mode |
| `src/db/prisma.ts` | Có local/Aiven identity guard | Đang sử dụng; giữ guard, CA/TLS, thêm session chỉ đọc và đường dẫn CA ổn định |
| `src/middleware/errorHandler.ts` | Import Mongoose để nhận diện lỗi | Đã loại phụ thuộc; dùng `RequestError` trung lập, giữ JSON/status lỗi parser và lỗi bất ngờ |
| `src/models/Ingredient.ts` | Mongoose model đang reachable từ app | Đã có PG thay thế: model Ingredient + `ingredient.postgres.service.ts`; giữ legacy để đối soát/test |
| `src/models/Product.ts` | Mongoose model và hằng số size | Đã có PG thay thế: Product/ProductVariant + `product.postgres.service.ts`; giữ legacy |
| `src/models/Recipe.ts` | Mongoose references, version/index/transaction | Đã có PG thay thế: Recipe/RecipeIngredient/active pointer + `recipe.postgres.service.ts`; giữ legacy |
| `src/services/{ingredient,product,recipe}.service.ts` | Mongo CRUD/recipe transaction | Mã cũ không được runtime gọi; service `.postgres.service.ts` thay thế toàn bộ operation đã có |
| `src/controllers/{ingredient,product,recipe}.controller.ts` | Cùng file chứa handler Mongo và PG, import Mongo service | Mã legacy/test; PG handlers chuyển sang `catalog.postgres.controller.ts`, re-export để giữ tương thích nội bộ |
| `src/routes/{ingredient,product,recipe}.routes.ts` | Import controller hỗn hợp | Mã legacy/test; app dùng riêng `catalog.postgres.routes.ts` |
| `src/validation/{ingredient,product,recipe}.validation.ts` | ObjectId, number, query/filter Mongo | Legacy/test; PG validator riêng dùng UUID/decimal; không import legacy validator từ runtime |
| `src/validation/product.postgres.validation.ts` | Query dùng legacy product validator, gián tiếp tải Mongoose qua hằng số model | Đã loại import gián tiếp; query rules trung lập ở `catalog-query.ts` |
| `src/validation/ingredient.postgres.validation.ts`, `decimal.ts` | Dùng legacy query/RequestError | Chuyển query/RequestError trung lập; giữ public validation contract PG |
| `src/serialization/{ingredient,product,recipe}.ts` | DTO PG đã có | Đang sử dụng; không thay đổi shape |
| `src/config/{ingredient,product,recipe}.openapi.ts` | Có template ObjectId và hàm chuyển PG | Đang sử dụng hàm PG; template cũ giữ cho regression fixture, không tải Mongoose |
| Auth/user/branch/password/middleware auth | Đã là Prisma/Argon2/session in-memory | Đang sử dụng; không tìm thấy Mongo persistence, không cần chuyển model |
| Inventory/goods receipts/stock documents/shift count | Đã là Prisma/transaction/raw SQL | Đang sử dụng; không thay nghiệp vụ/locking/ledger |
| Transfer receiving/sales/dashboard/restock/AI evidence/export | Đã là Prisma; chứa thay đổi chưa commit của người dùng | Giữ nguyên; quyền database mới chưa đầy đủ, xem mục 4 |
| `package.json`, `package-lock.json` | Mongoose thuộc dependencies production | Chuyển Mongoose sang devDependencies; MongoDB driver/BSON và nhánh phụ thuộc Mongo được đánh dấu dev trong lock |
| `test/models.test.cjs`, test catalog legacy | Import Mongoose/model/service | Giữ regression database-free; HTTP fixture legacy chỉ tồn tại trong test helper |
| `test/{ingredients,products,recipes}.integration.test.cjs` | Ghi Mongo khi có URI test | Giữ nhưng loại khỏi `npm test`; không chạy live Mongo test trong đợt này |
| `test/*.postgres.*`, runtime/app tests | Một số test kỳ vọng mixed stores | Cập nhật cho PG-only; giữ test CRUD/decimal/errors/race; test auth chạy app thật với DB mock |
| `scripts/test-postgres.cjs` | Guard local test rồi tự deploy migration | Chỉ guard và chạy test trên schema test có sẵn; bỏ tự chạy migration |
| `scripts/bootstrap-admin.cjs` | Script Prisma ghi user | Giữ nguyên; không được startup gọi và không chạy trong audit |
| root `docker-compose.yml` | Backend depends_on MongoDB | Gỡ phụ thuộc; MongoDB chuyển profile `legacy-mongo`, giữ volume/dữ liệu |
| root `mongodb_data/`, `.gitignore` | Dữ liệu Docker Mongo hiện có | Giữ nguyên để đối soát; không mở, chuyển hay xóa file dữ liệu |
| root/backend README, `docs/postgresql-local.md`, root `REVIEW.md` | Các mô tả Mongo mặc định và lịch sử migration | README/guide có chỉ dẫn hiện hành; ghi chú lịch sử/REVIEW được giữ, không phải runtime |
| Web/mobile source và dependencies | Client HTTP UUID/decimal/string `_id` | Không thấy Mongo driver; contract PG đã được client yêu cầu, không cần sửa source Frontend |
| `web/src/api/catalog.test.ts`, mobile navigation tests | Nhắc ObjectId/Mongo metadata | Test chủ động từ chối ObjectId/`__v`, không phải kết nối Mongo |
| AI service, requirements, API/features/data/ML/docs | FastAPI, Python/HTTP/file-backed pipeline | Không tìm thấy pymongo/motor/Mongo persistence; backend AI đọc dữ liệu qua Prisma |
| Chuyển dữ liệu ObjectId → UUID, đối soát Mongo ↔ PG | Không có bằng chứng đã hoàn tất | **Chưa có phương án chuyển dữ liệu được kiểm chứng**; không xóa Mongo source/model/data/dependency dev |

Không tìm thấy module nghiệp vụ đang chạy nào chỉ có implementation Mongo mà
không có implementation Prisma. Điều đó không chứng minh dữ liệu hoặc mọi nhánh
nghiệp vụ đã tương đương; cần integration test ghi trên database test riêng.

## 3. So sánh hợp đồng API

| Hành vi | Mongo legacy | PostgreSQL runtime / kiểm tra |
| --- | --- | --- |
| Paths/methods | Ingredients/Products POST, GET list/detail, PATCH, DELETE; Recipes POST/list/detail/activate/deactivate | Giữ nguyên; Recipe vẫn không có PATCH/DELETE |
| Status/envelope | POST 201 `{data}`, GET/PATCH/soft DELETE/action 200, list `{data,pagination}` | Giữ nguyên; validation 400, missing record/reference 404, business/unique conflict 409, lỗi bất ngờ 500 đã làm sạch |
| Auth | Catalog legacy có thể public trong chế độ không có Prisma auth | Runtime luôn yêu cầu auth; ADMIN sửa catalog, role khác chỉ đọc; business routes giữ guard/branch scope cũ của PG |
| IDs | ObjectId 24 hex; `__v` có thể xuất hiện | `_id` vẫn giữ tên nhưng giá trị UUID, không `__v`; không tự chuyển ObjectId hoặc tạo ID mapping |
| Số liệu | JSON numbers | Decimal canonical strings, cost/price 4 chữ số lẻ, quantity/minStock 6; number chỉ được nhận trong phạm vi chính xác. Web/mobile đã dùng contract này |
| Validation | Chống field lạ/protected, type coercion, duplicate size/ingredient, filter/query không hợp lệ | Giữ các quy tắc; thêm giới hạn schema, NUL, precision và offset PostgreSQL. Không chấp nhận input cũ vượt giới hạn SQL |
| Phân trang | page 1, limit 20, tối đa 100; filter/count đồng nhất; stable tie-break | Giữ mặc định/envelope; offset tối đa 2147483647. Count và data là read riêng như trước, có thể lệch khi có ghi đồng thời |
| Tìm kiếm | Literal escaped regex, không phân biệt hoa thường | Literal escaped LIKE (`%`, `_`, backslash); collation/Unicode DB có thể khác, chưa có đối soát toàn bộ dữ liệu |
| Xóa | Soft delete ingredient/product; idempotent | Giữ `isActive=false` / `isAvailable=false`; không xóa row; recipe history giữ bằng FK |
| Product prices | Mảng price entries trong document | Variants trong transaction; giữ S/M/L DTO ordering; chặn xóa variant được Recipe tham chiếu bằng 409 |
| Recipe version/active | Unique indexes, Mongo sessions/transaction | Unique/FK/active pointer, row locking theo thứ tự và transaction SQL; create version mới inactive, activate/deactivate giữ lịch sử và idempotency |
| Retry/lỗi | Mongo duplicate/transaction classification | Chỉ retry lỗi abort/version collision đã xác định; không retry uncertain commit; sanitize SQL/adapter/cause |
| Transactions khác | Các module inventory hiện tại đã dùng Prisma | Không thay đổi transaction, branch revision, CAS/version, ledger, giới hạn quyền hoặc AI attestation |

UUID/decimal/`__v` là khác biệt thật so với API Mongo cũ, đã tồn tại trong contract
PG trước audit và được Web/mobile hiện tại kiểm tra. Client cũ dùng ObjectId không
tự tương thích. Không cam kết tương thích tuyệt đối với client ngoài repository.

## 4. Kiểm tra Aiven chỉ đọc

- Database xác minh: `wavehouse_dev`; runtime role và session role `wavehouse_app`.
- TLS thực tế bật, xác minh CA với `rejectUnauthorized=true`.
- `wavehouse_app` không có superuser/createdb/createrole/replication/bypassrls.
- `avnadmin` và `wavehouse_app` có LOGIN. Admin chỉ dùng cho kiểm tra metadata/count
  chỉ đọc; runtime tuyệt đối không sử dụng admin credential.
- 10 migrations có finished_at và không rolled back, gồm W7.2, W7.3 và AI5.
- 26 model / 226 scalar columns có mặt theo tên mapping trong schema hiện tại.
  Đây là kiểm tra tồn tại, không phải xác nhận mọi type/default/trigger của 26 model.
- Recipe foundation đã kiểm tra definitions, validity của FK/check/unique index,
  enabled triggers và precision; không tự tạo/sửa schema.
- Public tables không bật RLS. Schema USAGE có; các bảng bị chặn cũng không có
  quyền SELECT theo cột, nên không thể giải thích lỗi bằng quyền cột/RLS.

Số lượng snapshot: Ingredients **1**, Users **1** (ADMIN active **1**). Branches,
Products, ProductVariants, Recipes, RecipeIngredients, balances/movements, goods
receipts, stock documents, shift counts, transfers, sales và evidence đều **0**.
Các bảng mới không đọc được bằng app role đã được đếm riêng qua admin **chỉ đọc**.
MongoDB port local không mở; chưa thể đếm/so sánh Mongo. **Không kết luận dữ liệu
đã được chuyển đủ.**

**Blocker quyền chưa sửa:** `wavehouse_app` thiếu toàn bộ SELECT/INSERT/UPDATE/DELETE
trên `transfer_receipts`, `transfer_receipt_items`, `sales_reports`,
`sales_report_revisions`, `sales_report_lines`, `sales_report_payments`,
`sales_report_expenses`, `sales_cash_reconciliations`, `sales_report_events`,
`sales_recipe_evidence`. Không tự chạy GRANT hoặc đổi role.

App role không đọc được `_prisma_migrations`; điều này phù hợp với tách biệt runtime
và schema management. Việc thiếu UPDATE trên goods/stock document items không tự
động là lỗi: source hiện thay items bằng delete/create. Inventory movements không
có UPDATE/DELETE phù hợp ledger bất biến; không đề nghị cấp quyền rộng.

Smoke HTTP với login fixture cục bộ tạm thời (Argon2/token in-memory, không đọc
password hash thật; guard đọc user/role thật; mọi business service dùng PG thật):

| GET endpoint | HTTP | Ý nghĩa |
| --- | --- | --- |
| `/health` | 200 | DB reachable; không chứng minh đủ quyền mọi module |
| `/api/auth/me` | 200 | Fixture session được xác thực, guard truy vấn PG |
| `/api/ingredients`, `/api/products`, `/api/recipes` | 200 | Đọc/list/serialize PG hoạt động; Products/Recipes rỗng |
| `/api/branches`, `/api/users` | 200 | Admin read được; không xuất PII trong log |
| `/api/inventory/balances` | 200 | Query đọc với UUID scope test, rỗng; chưa có branch thật để kiểm thử nghiệp vụ |
| `/api/goods-receipts`, `/api/shift-stock-counts` | 200 | Đọc danh sách rỗng |
| `/api/stock-issues`, `/api/stock-transfers` | 503 | Query include receiving relation bị thiếu quyền, ảnh hưởng cả danh sách nghiệp vụ cũ |
| `/api/transfer-receipts`, `/api/sales-reports`, `/api/dashboard/summary` | 503 | Thiếu quyền các bảng W7.2/W7.3/AI5 |

Login/logout chỉ ghi session Map trong process. Không thử CRUD/attest/approve/post
trên Aiven, kể cả với transaction rollback. Chưa xác minh mật khẩu tài khoản thật.
Restock/AI dùng bảng sales/evidence cũng có nguy cơ bị chặn; chưa chạy AI server
hoặc toàn bộ luồng restock. Không thay thế lỗi bằng dữ liệu rỗng hoặc fallback Mongo.

## 5. Build/test và giới hạn

| Kiểm tra | Kết quả |
| --- | --- |
| Backend TypeScript build + Prisma generate | Đạt, dùng `prisma.offline.config.ts`, không kết nối DB |
| `npm run prisma:validate` | Đạt offline |
| Unit/regression Backend | **104 đạt, 0 lỗi**, gồm mock Mongoose legacy và mock Prisma; không live DB |
| Integration discovery/URL guard | **1 đạt, 7 bỏ qua** do không cấu hình live test URLs; không phải integration ghi đã đạt |
| Database test local `127.0.0.1:5433` | Không chạy; port không mở. Không tạo database, migrate hoặc dùng Aiven thay thế |
| `npm run audit:postgres` | Đạt identity/TLS/count/privilege/Recipe foundation, session chỉ đọc |
| `npm run smoke:postgres` | Hoàn tất; **5 endpoint bị chặn**, exit code **2** có chủ đích, không báo test xanh |
| Compiled `startServer` + `/health`, chặn Mongo imports | Đạt với Aiven thật ở cổng kiểm tra tạm 5101; đã shutdown |
| Docker Compose config | `docker compose config --quiet` ??t; kh?ng build/ch?y container |
| Dependency production | `npm ls --omit=dev mongoose mongodb` rỗng; lock xác nhận Mongo branch dev; chưa chạy clean `npm ci --omit=dev`/Docker build |
| Web `npm run build` | Đạt TypeScript/Vite; có warning chunk trên 500 kB |
| Web API tests | **168/186 đạt, 18 lỗi** trong source/test đang có trước thay đổi Backend |
| Web full UI suite | Chưa hoàn tất; catalog UI suite không kết thúc trong lượt chạy, đã dừng process test do tác vụ này tạo |

16 lỗi API Web so sánh plain object headers với `Headers` của transport hiện tại;
1 lỗi receiving đọc `.Authorization` như property thay vì `Headers.get`; 1 lỗi
receiving 401 do window/event fixture không đáp ứng transport session-expired.
Không sửa source/test Web của người dùng để che các lỗi này. Các test đó dùng
HTTP mock, không kết nối Backend/Aiven.

## 6. Biến môi trường và chạy localhost

Thứ tự ưu tiên: process environment → `backend/.env.local` → `backend/.env` →
`backend/.env.postgres`, không override. `NODE_ENV=test` bỏ qua tất cả env files.
Đường dẫn CA tương đối được tính từ `backend/`, không phụ thuộc shell cwd.

`backend/.env.local` đã được tạo mới từ application credential có sẵn trên máy,
được Git ignore; không thay/ghi đè các env cũ. Nội dung cấu hình cần thiết:

```dotenv
NODE_ENV=development
PORT=5001
CORS_ORIGIN=http://localhost:3000
CATALOG_POSTGRES_TARGET=aiven
AIVEN_DB_PASSWORD=<password của wavehouse_app, chỉ lưu trong file local được ignore>
AIVEN_CA_PATH=../ca.pem
POSTGRES_READ_ONLY=true
```

Ba cờ `CATALOG_INGREDIENT_STORE`, `CATALOG_PRODUCT_STORE`, `CATALOG_RECIPE_STORE`
không cần đặt; nếu đã export phải là `postgres`. `MONGO_URI` bị bỏ qua. Aiven runtime
chỉ trỏ đúng `wavehouse_dev` và role `wavehouse_app`, không sử dụng DATABASE_URL để
chuyển sang admin hoặc database khác. Không tắt chế độ chỉ đọc để thử ghi trên Aiven
khi chưa có sự cho phép riêng.

Local target `CATALOG_POSTGRES_TARGET=local` chỉ nhận URL dev với role/database
`wavehouse_dev` trên `127.0.0.1:5433`. Test chỉ nhận `TEST_DATABASE_URL` với
role/database `wavehouse_test` trên cùng host/port và phải qua kiểm tra cách ly
role. Không fallback TEST → DATABASE_URL. Không dùng admin role trong runtime.

Terminal Backend:

```powershell
Set-Location D:\code\DoAn\WaveHouseManagement\backend
npm ci
npm run dev
# Hoặc: npm run build, rồi npm start
```

Terminal Web, proxy hiện tại đã trỏ `127.0.0.1:5001`:

```powershell
Set-Location D:\code\DoAn\WaveHouseManagement\web
npm ci
npm run dev -- --host 127.0.0.1
```

Mở `http://localhost:3000`, `http://localhost:5001/health` và
`http://localhost:5001/api-docs/`. Nếu cổng đã có dev server, dùng process đang
chạy, tránh khởi động trùng. Authenticated UI vẫn cần mật khẩu người dùng thật;
audit không tạo/sửa/reset tài khoản. Các thao tác ghi bị DB chỉ đọc từ chối.

Kiểm tra lại an toàn sau build: `npm test`, `npm run prisma:validate`,
`npm run audit:postgres`, `npm run smoke:postgres`. Chỉ chạy `npm run test:postgres`
khi có database test local riêng với schema chuẩn bị sẵn. Script đó ghi fixtures
test; không chạy migration nữa. Không chạy migrate/reset/db push/bootstrap-admin
để khắc phục các blocker trong phạm vi công việc này.

## 7. Danh sách file thay đổi trong đợt runtime

Những file có thay đổi từ trước vẫn giữ các phần người dùng đã làm.

- Runtime/config: `src/server.ts`, `src/app.ts`, `src/config/postgres.ts`,
  `src/db/prisma.ts`, `src/middleware/errorHandler.ts`.
- Controller legacy re-export: `src/controllers/ingredient.controller.ts`,
  `product.controller.ts`, `recipe.controller.ts`.
- Runtime mới: `src/controllers/catalog.postgres.controller.ts`,
  `src/routes/catalog.postgres.routes.ts`, `src/validation/request-error.ts`,
  `src/validation/catalog-query.ts`.
- Import error/query trung lập: `src/services/ingredient.postgres.service.ts`,
  `product.postgres.service.ts`, `recipe.postgres.service.ts`,
  `src/validation/ingredient.validation.ts`, `ingredient.postgres.validation.ts`,
  `product.postgres.validation.ts`, `recipe.postgres.validation.ts`, `decimal.ts`.
- Dependency/build/config: `package.json`, `package-lock.json`, `Dockerfile`,
  `.env.example`; root `.gitignore`, `docker-compose.yml`.
- Script: `scripts/test-postgres.cjs`, mới `scripts/test-unit.cjs`,
  `scripts/audit-postgres-readonly.cjs`, `scripts/smoke-postgres-readonly.cjs`.
- Test: `test/app.test.cjs`, `test/prisma-runtime.test.cjs`, mới
  `test/postgres-only.test.cjs`, `test/helpers/catalog-app.cjs`; import fixture
  cập nhật trong `test/{ingredients,products,recipes}.test.cjs`,
  `test/{ingredients,products,recipes}.integration.test.cjs`,
  `test/{ingredients,products,recipes}.postgres.test.cjs`,
  `test/{ingredients,products,recipes}.postgres.integration.test.cjs`.
- Tài liệu: root `README.md`, `backend/README.md`, `docs/postgresql-local.md`,
  báo cáo này và `docs/mongodb-dependency-audit.tsv`.
- File local không commit: mới `backend/.env.local`; chứa application secret nên
  không liệt kê nội dung hay copy vào báo cáo. `prisma.offline.config.ts` đã có
  trong working tree trước audit, được tái sử dụng, không sửa nội dung.

## 8. Việc còn lại

Chưa xóa Mongoose khỏi devDependencies hoặc xóa legacy model/service/test/data:
phải đối soát dữ liệu Mongo ↔ PG và quyết định mapping ID trước. Cần người quản trị
review quyền tối thiểu theo từng service cho bảng mới; không suy diễn cấp toàn bộ
quyền DELETE/UPDATE. Sau đó cần integration test ghi trên database test riêng cho
auth/catalog/inventory/receiving/sales/AI và kiểm thử Web với tài khoản thật.
Hiện có thể khởi động/đọc một phần trên localhost mà không MongoDB, nhưng chưa thể
xác nhận toàn bộ Backend đã sẵn sàng kiểm thử nghiệp vụ đầu cuối.
