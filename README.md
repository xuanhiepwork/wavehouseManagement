# ĐỒ ÁN CHUYÊN NGÀNH
## TÊN ĐỒ ÁN: WAVEHOUSE MANAGEMENT SYSTEM
### CHỨC NĂNG:
#### Quản lý nhập hàng
#### Quản lý kho
#### Quản lý xuất kho
#### Ứng dụng AI: Tổng kết cuối ngày, đề xuất gom hàng, đề xuất tuyền đường, số nguyên liệu cần giao cho mỗi quầy vào ngày tiếp theo
---
##  Công Nghệ Sử Dụng
*   **Backend Main API:** Node.js + ExpressJS + TypeScript
*   **AI Service:** Python + FastAPI + Gemini API + RAG (Retrieval-Augmented Generation)
*   **Frontend Web (Admin):** React + Vite + TypeScript
*   **Mobile App (Kiểm kho):** React Native + Expo Go + TypeScript
*   **Database & Tools:** MongoDB (Docker), Socket.io (Real-time), Swagger (API Docs), Postman, Jira, GitHub.
---
## 📁 Kiến Trúc Thư Mục Dự Án (Monorepo)

```text
📁 WaveHouseManagement
├── 📁 backend           # Mã nguồn Node.js API chính (Cổng 5000)
├── 📁 web               # Giao diện Web Admin dành cho chủ quán (Cổng 3000)
├── 📁 mobile-app        # Ứng dụng di động Expo Go cho nhân viên kiểm kho
├── 📁 ai-service        # Dịch vụ Python RAG & Xử lý AI Gemini (Cổng 8000)
├── 📁 mongodb_data      # Thư mục chứa dữ liệu cứng của MongoDB (Docker tự quản lý)
└── docker-compose.yml   # File cấu hình khởi chạy toàn bộ hệ thống bằng Docker
```

---

## 🚀 Hướng Dẫn Cài Đặt và Khởi Chạy Dự Án (Setup Guide)

Dành cho người mới tiếp cận dự án, hãy làm theo tuần tự các bước dưới đây để chạy thử hệ thống trên máy cá nhân:

### 1. Yêu Cầu Cài Đặt Sẵn Trên Máy (Prerequisites)
*   [Node.js](https://nodejs.org) (Phiên bản v18 trở lên)
*   [Python](https://python.org) (Phiên bản 3.10 trở lên)
*   [Docker Desktop](https://docker.com)
*   Ứng dụng **Expo Go** trên điện thoại (để chạy thử App Mobile)

### 2. Tải Mã Nguồn Về Máy
```bash
git clone https://github.com/xuanhiepwork/wavehouseManagement.git
cd wavehouseManagement
```

### 3. Cấu Hình Biến Môi Trường (.env)
*   Vào thư mục `backend/` tạo file `.env` và điền cấu hình database kết nối.
*   Vào thư mục `ai-service/` tạo file `.env` và điền `GEMINI_API_KEY=your_key_here`.

### 4. Khởi Chạy Database & Hệ Thống Bằng Docker (Cách nhanh nhất)
Mở Docker Desktop lên, sau đó tại thư mục gốc chạy lệnh:
```bash
docker-compose up --build
```
*Lệnh này sẽ tự động tải MongoDB, cài đặt và chạy Backend cùng AI Service.*

### 5. Khởi Chạy Các Ứng Dụng Frontend Để Phát Triển (Local Development)

#### Chạy Giao Diện Web Admin:
```bash
cd web
npm run dev
```

#### Chạy Ứng Dụng Mobile App:
```bash
cd mobile-app
npm start
```
*Sau khi chạy, dùng điện thoại quét mã QR hiển thị trên màn hình máy tính thông qua ứng dụng Expo Go để test App.*

---

## 📝 Nhật Ký Phát Triển & Quy Định Git

*   **Nhánh chính (`main`):** Nơi chứa code ổn định nhất, chỉ gộp code khi đã kiểm thử kỹ.
*   **Nhánh phát triển (`test` hoặc các nhánh tính năng con):** Thực hiện tính năng mới trên các nhánh này trước khi tạo Pull Request vào `main`.
*   **Tài liệu API:** Khi backend chạy, truy cập đường dẫn `http://localhost:5000/api-docs` để xem tài liệu Swagger đầy đủ.

---
# ĐẨY CODE LÊN GITHUB
  1. git status
  * Kiểm tra xem có thư mục node_modules hay venv, thì phải kiểm tra lại gitignore
  2. git add .
  3. git commit -m "ĐẶT TÊN NHÁNH"
  4. git push origin HEAD hoặc git push origin test(tên nhánh)           
  * Đẩy code lên nhánh hiện tại


---

## FIX CODEX ERROR
`
  code --install-extension openai.chatgpt@26.1007.21434 --force
`


---

# Công nghệ sử dụng và thiết kế cơ sở dữ liệu

## 1. Công nghệ sử dụng (Technology Stack)

Dự án **WaveHouse Management** được xây dựng theo kiến trúc Client–Server, sử dụng một Backend API chung để phục vụ hệ thống quản trị Web Admin và ứng dụng Mobile.

Hệ thống hướng đến khả năng mở rộng, quản lý dữ liệu tập trung, đảm bảo tính toàn vẹn dữ liệu và thuận tiện trong quá trình triển khai lên môi trường cloud.

### 1.1. Danh sách công nghệ

| Thành phần | Công nghệ lựa chọn | Vai trò |
|---|---|---|
| Database | PostgreSQL | Hệ quản trị cơ sở dữ liệu quan hệ, lưu trữ và quản lý dữ liệu tập trung |
| ORM | Prisma ORM | Tương tác với PostgreSQL, quản lý schema và database migrations |
| Database Viewer | Database Client (VS Code Extension) | Kết nối, truy vấn và quản lý dữ liệu trực tiếp trong Visual Studio Code |
| Local Development | Docker & Docker Compose | Xây dựng và quản lý môi trường phát triển bằng containers |
| Backend | Node.js + Express.js + TypeScript | Xây dựng RESTful API và xử lý nghiệp vụ |
| Web Admin | React + Vite + TypeScript | Phát triển giao diện quản trị trên trình duyệt |
| Mobile Application | React Native + Expo | Phát triển ứng dụng di động đa nền tảng |
| AI Service | Python + FastAPI + Google Gemini API | Xử lý AI, dự báo nhu cầu và hỗ trợ lập kế hoạch phân phối |
| AI Techniques | Machine Learning, Algorithms, LLM, RAG | Phân tích dữ liệu, dự báo và đề xuất phương án |
| Realtime Communication | Socket.IO | Đồng bộ trạng thái và gửi thông báo thời gian thực |
| API Documentation | Swagger / OpenAPI | Tài liệu hóa và kiểm thử API |
| API Testing | Postman | Kiểm thử các API endpoints |
| Cloud Database | Managed PostgreSQL (Neon hoặc Supabase) | Lưu trữ cơ sở dữ liệu khi triển khai production |
| Version Control | Git + GitHub | Quản lý phiên bản mã nguồn và cộng tác phát triển |
| Project Management | Jira | Quản lý công việc, tiến độ và các giai đoạn phát triển |

### 1.2. Kiến trúc hệ thống

Hệ thống sử dụng mô hình **Client–Server với một Backend API dùng chung**.

**Web Admin (React) / Mobile App (React Native)**

↓ HTTPS / REST API / Socket.IO

**Backend Server (Node.js + Express.js + TypeScript)**

- Xử lý các quy tắc nghiệp vụ.
- Quản lý xác thực và phân quyền.
- Quản lý nhập hàng, tồn kho và điều chuyển.
- Cung cấp API cho Web Admin và Mobile.
- Giao tiếp với PostgreSQL thông qua Prisma ORM.
- Kết nối AI Service để xử lý dự báo và lập kế hoạch.

**Các dịch vụ phía sau Backend:**

- **PostgreSQL:** Lưu trữ dữ liệu nghiệp vụ.
- **AI Service (Python + FastAPI):** Xử lý thuật toán, Gemini, LLM và RAG.
- **Socket.IO:** Đồng bộ trạng thái và thông báo thời gian thực.

Web Admin và Mobile App không truy cập trực tiếp vào cơ sở dữ liệu. Mọi thao tác đọc và ghi dữ liệu đều được thực hiện thông qua Backend API.

### 1.3. Môi trường phát triển và triển khai

**Development Environment**

- Docker Desktop và Docker Compose được sử dụng để chạy các dịch vụ tại máy phát triển.
- PostgreSQL chạy trong Docker container.
- Backend kết nối PostgreSQL thông qua Prisma ORM.
- Database Client Extension trong VS Code được sử dụng để xem dữ liệu, kiểm tra bảng và thực hiện truy vấn SQL.
- Các thông tin kết nối được quản lý bằng environment variables.

**Production Environment**

- Web Admin được triển khai trên nền tảng hosting hỗ trợ ứng dụng React.
- Backend và AI Service được triển khai dưới dạng các dịch vụ độc lập, có thể sử dụng Docker containers.
- PostgreSQL sử dụng dịch vụ managed database như Neon hoặc Supabase.
- Mobile App kết nối đến Backend thông qua HTTPS.
- Thông tin kết nối, API keys và credentials được lưu trữ bằng environment variables hoặc secret management.

---

## 2. Thiết kế cơ sở dữ liệu (Database Design)

### 2.1. Hệ quản trị cơ sở dữ liệu

Hệ thống sử dụng **PostgreSQL** làm cơ sở dữ liệu chính và **Prisma ORM** để quản lý các mô hình dữ liệu.

PostgreSQL được lựa chọn nhằm đáp ứng các yêu cầu:

- Quản lý dữ liệu có quan hệ giữa nhiều bảng.
- Đảm bảo tính toàn vẹn dữ liệu bằng Primary Key, Foreign Key và Constraints.
- Hỗ trợ Transactions cho các nghiệp vụ nhập, xuất và điều chuyển kho.
- Theo dõi lịch sử biến động tồn kho.
- Hỗ trợ truy vấn SQL, thống kê và báo cáo.
- Dễ dàng triển khai trên môi trường cloud.

### 2.2. Các nhóm dữ liệu dự kiến

Cơ sở dữ liệu được tổ chức thành sáu nhóm chính, phục vụ bốn module nghiệp vụ của hệ thống.

#### Nhóm 1 — Danh mục sản phẩm và nguyên liệu (Master Data)

Quản lý các dữ liệu nền tảng được sử dụng trong toàn hệ thống.

| Bảng dự kiến | Chức năng |
|---|---|
| `ingredients` | Danh mục nguyên liệu, đơn vị tính, giá tham khảo và ngưỡng tồn tối thiểu |
| `products` | Danh mục sản phẩm, đồ uống và thông tin kinh doanh |
| `product_prices` | Giá bán của sản phẩm theo kích thước |
| `recipes` | Công thức pha chế, phiên bản và trạng thái kích hoạt |
| `recipe_ingredients` | Danh sách nguyên liệu và định lượng của từng công thức |

#### Nhóm 2 — Chi nhánh và địa điểm lưu trữ (Organization & Locations)

Quản lý cấu trúc tổ chức và các địa điểm lưu trữ hàng hóa.

| Bảng dự kiến | Chức năng |
|---|---|
| `branches` | Thông tin chi nhánh, quầy bán hàng |
| `warehouses` | Thông tin kho tổng và các kho trực thuộc |
| `stock_locations` | Vị trí lưu trữ và phân loại địa điểm quản lý tồn kho |

#### Nhóm 3 — Quản lý nhập hàng (Purchasing & Receiving)

Phục vụ Module 1 — Quản lý nhập hàng.

| Bảng dự kiến | Chức năng |
|---|---|
| `suppliers` | Quản lý thông tin nhà cung cấp |
| `purchase_orders` | Quản lý đơn đặt hàng nhập |
| `purchase_order_items` | Chi tiết nguyên liệu, số lượng và giá đặt mua |
| `goods_receipts` | Quản lý phiếu nhập hàng thực tế |
| `goods_receipt_items` | Chi tiết số lượng thực nhận, giá nhập và chênh lệch |
| `batches` | Quản lý lô hàng, ngày nhập và hạn sử dụng |

**Nghiệp vụ chính:**

- Tạo và quản lý đơn đặt hàng.
- Ghi nhận hàng thực nhận.
- Đối chiếu số lượng đặt và số lượng nhận.
- Theo dõi giá nhập và lô nguyên liệu.
- Cập nhật tồn kho sau khi xác nhận nhập hàng.

#### Nhóm 4 — Quản lý tồn kho (Inventory Management)

Phục vụ Module 2 — Quản lý tồn kho.

| Bảng dự kiến | Chức năng |
|---|---|
| `stock_movements` | Ghi nhận lịch sử tăng, giảm và dịch chuyển tồn kho |
| `stock_balances` | Theo dõi số lượng tồn tại từng địa điểm và theo lô |
| `stock_adjustments` | Quản lý phiếu điều chỉnh tồn kho |
| `stock_adjustment_items` | Chi tiết nguyên liệu, số lượng điều chỉnh và nguyên nhân |

**Nghiệp vụ chính:**

- Theo dõi tồn kho theo từng kho và chi nhánh.
- Quản lý tồn kho theo nguyên liệu và lô hàng.
- Theo dõi hạn sử dụng.
- Ghi nhận hao hụt, hư hỏng và điều chỉnh kho.
- Cảnh báo tồn kho thấp và nguyên liệu sắp hết hạn.
- Truy xuất lịch sử biến động tồn kho.

**Nguyên tắc thiết kế:** Không chỉ lưu số lượng tồn hiện tại mà cần lưu lịch sử các giao dịch làm thay đổi tồn kho để phục vụ đối soát và truy vết.

#### Nhóm 5 — Quản lý xuất hàng và điều chuyển (Stock Transfers & Distribution)

Phục vụ Module 3 — Quản lý xuất hàng và điều chuyển.

| Bảng dự kiến | Chức năng |
|---|---|
| `stock_transfers` | Quản lý phiếu điều chuyển giữa các kho và chi nhánh |
| `transfer_items` | Chi tiết nguyên liệu, số lượng yêu cầu, xuất và nhận |
| `transfer_events` | Lịch sử thay đổi trạng thái và xử lý điều chuyển |

**Nghiệp vụ chính:**

- Tạo yêu cầu xuất và điều chuyển hàng.
- Phê duyệt hoặc từ chối yêu cầu.
- Soạn hàng và xác nhận xuất kho.
- Theo dõi trạng thái giao hàng.
- Xác nhận số lượng thực nhận.
- Ghi nhận hàng thiếu hoặc hư hỏng.
- Cập nhật tồn kho tại kho nguồn và kho đích.

Các thao tác làm thay đổi tồn kho cần được xử lý bằng database transactions để hạn chế tình trạng dữ liệu không nhất quán.

#### Nhóm 6 — AI Daily Inventory & Distribution Planning

Phục vụ Module 4 — AI Daily Inventory & Distribution Planning.

| Bảng dự kiến | Chức năng |
|---|---|
| `daily_inventory_snapshots` | Lưu dữ liệu tổng kết tồn kho theo ngày |
| `demand_forecasts` | Lưu kết quả dự báo nhu cầu nguyên liệu |
| `distribution_plans` | Lưu kế hoạch phân phối do AI đề xuất |
| `distribution_plan_items` | Chi tiết nguyên liệu, số lượng đề xuất và địa điểm nhận |
| `plan_approvals` | Lưu quyết định phê duyệt, chỉnh sửa hoặc từ chối đề xuất AI |

**Nghiệp vụ chính:**

- Tổng hợp tồn kho và mức tiêu thụ cuối ngày.
- Phân tích dữ liệu tiêu thụ lịch sử.
- Dự báo nhu cầu theo ngày thường, cuối tuần và ngày lễ.
- Đề xuất lượng nguyên liệu cần bổ sung cho từng chi nhánh.
- Hỗ trợ xây dựng kế hoạch và tuyến giao hàng.
- Cho phép người quản lý phê duyệt, điều chỉnh hoặc từ chối đề xuất AI.

Các kết quả AI chỉ đóng vai trò đề xuất; những thao tác làm thay đổi tồn kho thực tế phải được xác nhận và xử lý thông qua Backend.

---

## 3. Nguyên tắc thiết kế dữ liệu

Cơ sở dữ liệu sẽ tuân theo các nguyên tắc:

1. **Data Integrity:** Sử dụng khóa chính, khóa ngoại, unique constraints và các ràng buộc dữ liệu phù hợp.
2. **Transactional Consistency:** Các nghiệp vụ nhập, xuất, điều chuyển và cập nhật tồn kho phải đảm bảo tính nhất quán.
3. **Traceability:** Lưu lịch sử giao dịch và biến động tồn kho để hỗ trợ kiểm tra, đối soát.
4. **Batch Tracking:** Theo dõi nguyên liệu theo lô và hạn sử dụng.
5. **Multi-Location Inventory:** Quản lý tồn kho độc lập theo từng kho, chi nhánh và địa điểm lưu trữ.
6. **Recipe Versioning:** Lưu các phiên bản công thức pha chế và quản lý công thức đang hoạt động.
7. **Scalability:** Thiết kế cho phép mở rộng thêm chi nhánh, kho và nghiệp vụ trong tương lai.
8. **AI Separation:** AI Service xử lý dự báo và đề xuất, còn Backend chịu trách nhiệm kiểm tra và thực thi nghiệp vụ.
9. **Security:** Không lưu credentials, mật khẩu hoặc API keys trực tiếp trong mã nguồn.
10. **Migration Management:** Các thay đổi cấu trúc database được quản lý bằng Prisma Migrate.

---

## 4. Trạng thái thiết kế

**Trạng thái: Proposed Architecture — Chưa triển khai hoàn chỉnh.**

Danh sách bảng ở trên là thiết kế dự kiến, được sử dụng làm cơ sở cho việc xây dựng Entity Relationship Diagram (ERD), Prisma Schema và Database Migrations.

Tên bảng, quan hệ, thuộc tính và các ràng buộc có thể được điều chỉnh sau khi hoàn thành phân tích nghiệp vụ chi tiết.

Kiến trúc PostgreSQL + Prisma là công nghệ mục tiêu cho giai đoạn phát triển tiếp theo. Các thành phần MongoDB/Mongoose còn tồn tại trong repository sẽ được đánh giá và chuyển đổi theo kế hoạch migration đã được phê duyệt.






---

## Quy tắc đặt tên nhánh

Cấu trúc:

```text
<loại>/<phạm-vi>-<nội-dung>
```

Ví dụ: `feature/backend-stock-import`

### Loại công việc

| Tiền tố | Mục đích | Ví dụ |
| --- | --- | --- |
| `feature/` | Thêm chức năng | `feature/backend-stock-import` |
| `fix/` | Sửa lỗi | `fix/web-inventory-filter` |
| `refactor/` | Cải tổ code, giữ nguyên hành vi | `refactor/backend-stock-service` |
| `chore/` | Cấu hình, cập nhật thư viện, bảo trì | `chore/backend-eslint` |
| `docs/` | Viết hoặc sửa tài liệu | `docs/backend-stock-import-api` |
| `tests/` | Thêm hoặc sửa kiểm thử | `tests/backend-stock-import` |
| `feature/web-` | Thêm giao diện hoặc chức năng trên web | `feature/web-login-page` |
| `feature/mobile-` | Thêm giao diện hoặc chức năng trên mobile | `feature/mobile-login-screen` |.






---
## SỬ DỤNG GITHUB

### Bước 1 — Kiểm tra và cập nhật thông tin Git
```
git status
git fetch origin
```

### Bước 2 — Chuyển sang nhánh test
```
git switch test
```

### Bước 3 — Cập nhật nhánh test từ GitHub
```
git pull --ff-only origin test
```

### Bước 4 — Merge code từ backend sang test
```
git merge backend
```

### Bước 5 — Push nhánh test lên GitHub (Sau khi merge thành công)
```
git push origin test
```

---

# SỬ DỤNG ĐIỆN THOẠI DEBBUG

## BƯỚC 1:KẾT NỐI VỚI ĐIỆN THOẠI ANDROI

### CHẾ ĐỘ NHÀ PHÁT TRIỂN >>> GỠ LỖI KHÔNG DÂY >>> GHÉP NỐI THIẾT BỊ BẰNG MÃ GHÉP NỐI

```
$adb = 'C:\Android\Sdk\platform-tools\adb.exe'

& $adb pair 192.168.2.57:37319
```

#### Nhập mã trên điện thoại vào khi terminal hỏi


## BƯỚC 2: KẾT NỐI ADB
```
$adb = 'C:\Android\Sdk\platform-tools\adb.exe'

# Thay CONNECTION_PORT bằng Cổng & Địa chỉ IP trên màn hình Gỡ lỗi không dây
Test-NetConnection 192.168.2.57 -Port 42441

& $adb connect 192.168.2.57:42441
& $adb devices -l

```

## BƯỚC 3: KẾT NỐI
### CHẠY CÂU LỆNH SAU ĐỂ KIỂM TRA VÀ LẤY SỐ SERIES:
```
$adb = 'C:\Android\Sdk\platform-tools\adb.exe'
& $adb devices -l
```

### MÃ TRƯỚC CHỮ DEVICE LÀ SERIES...

### Nhập câu lệnh sau khi đã có số series:
```
$phoneSerial = 'THAY_BANG_SERIAL_THUC_TE'
# Không được bỏ dấu '  '

& $adb -s $phoneSerial get-state
& $adb -s $phoneSerial shell getprop ro.product.brand
& $adb -s $phoneSerial shell getprop ro.product.model
```

### Kiểm tra không có dịch vụ laptop đang dùng cổng thử nghiệm
Get-NetTCPConnection -LocalPort 17500 -State Listen `
  -ErrorAction SilentlyContinue

### Kiểm tra các mapping hiện có trên điện thoại
```
& $adb -s $phoneSerial reverse --list

$created = $false

try {
    & $adb -s $phoneSerial reverse --no-rebind tcp:17500 tcp:17500

    if ($LASTEXITCODE -ne 0) {
        throw 'Không tạo được mapping thử nghiệm.'
    }

    $created = $true

    Write-Host '=== ADB reverse mappings ==='
    & $adb -s $phoneSerial reverse --list

    Write-Host '=== Phone TCP listeners ==='
    & $adb -s $phoneSerial shell ss -ltn
}
finally {
    if ($created) {
        & $adb -s $phoneSerial reverse --remove tcp:17500
        Write-Host 'Đã gỡ mapping thử nghiệm 17500.'
    }
}
```
---

# CÁC BƯỚC KHỞI ĐỘNG DỰ ÁN - CHẠY DEMO

