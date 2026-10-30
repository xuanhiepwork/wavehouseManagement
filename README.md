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

`
  code --install-extension openai.chatgpt@26.1007.21434 --force
`