# WaveHouse AI Service — AI1

AI1 chuẩn bị dữ liệu nhu cầu nguyên liệu lý thuyết theo **chi nhánh, ngày kinh doanh, ca và nguyên liệu**. Kết quả phục vụ mô hình AI2 trong tương lai và người quản lý duyệt đề xuất. AI1 chưa huấn luyện mô hình, chưa kết nối Backend/Website và không thao tác kho.

## Hiện trạng và phạm vi đã triển khai

Trước AI1, thư mục đã có `app/main.py`, `requirements.txt`, `Dockerfile` và README. `app/main.py` là FastAPI shell với `GET /` trả thông tin service và `GET /health` trả trạng thái; `/docs` là tài liệu API mặc định của FastAPI. `requirements.txt` đã khai báo FastAPI và Uvicorn; Dockerfile dùng Python 3.10 và Uvicorn. Không có Pandas, scikit-learn, mô hình huấn luyện hoặc adapter database trong foundation này.

AI1 bổ sung thư viện Python tách module để xác thực DTO, chuẩn bị dữ liệu approved sales, truy vết công thức, tính nhu cầu bằng Decimal, kiểm tra chất lượng, tạo đặc trưng theo thời điểm và định nghĩa giao diện dự báo. Pydantic 2 được khai báo trực tiếp cho hợp đồng dữ liệu. Không thêm endpoint HTTP cho dữ liệu bán hàng/dự báo: các hàm pipeline hiện được gọi nội bộ bằng dữ liệu đã được bên tích hợp cấp quyền.

| Phần | Trạng thái AI1 |
|---|---|
| FastAPI root/health, Dockerfile | Có sẵn, giữ nguyên chức năng |
| Hợp đồng dữ liệu, kiểm tra chất lượng, demand pipeline, feature pipeline | Đã viết source |
| Giao diện model và adapter B7 do caller cung cấp | Đã viết source; không tự gọi B7 |
| Mô hình ML, training, evaluation, persistence mô hình | AI2, chưa triển khai |
| Export dữ liệu đã phân quyền từ Backend; snapshot công thức lịch sử | AI3, chưa triển khai |
| Website hiển thị dự báo và người dùng duyệt | AI4, chưa triển khai |
| Gemini, RAG, API key AI hoặc kết nối Aiven trực tiếp | Không được thêm trong AI1 |

## Cấu trúc

```text
ai-service/
  app/
    main.py             # HTTP shell có sẵn; root và health
    schemas/            # DTO đầu vào/đầu ra và validation
    data/               # chọn báo cáo hợp lệ, chuẩn bị nhu cầu lý thuyết
    quality/            # warning có cấu trúc và coverage
    features/           # thời gian, lịch sử, lag, rolling, missing flags
    forecasting/        # protocol và adapter không huấn luyện
    config/             # cấu hình phi nhạy cảm
  documentation/
    architecture.md
    data-contracts.md
    integration-roadmap.md
  requirements.txt
  Dockerfile
```

## Đọc tài liệu

- [Kiến trúc, tính nhu cầu, đặc trưng và chất lượng dữ liệu](documentation/architecture.md).
- [Hợp đồng dữ liệu và mapping chính xác từ Prisma/W7.3](documentation/data-contracts.md).
- [B7 fallback, bảo mật và các phụ thuộc AI2–AI4](documentation/integration-roadmap.md).

Điểm cần chú ý: W7.3 chỉ lưu snapshot tên sản phẩm/đơn giá, **chưa lưu snapshot công thức nguyên liệu tại thời điểm bán**. Mặc định dữ liệu thiếu công thức lịch sử không sinh giá trị verified. Chế độ dùng công thức hiện tại phải bật rõ ràng và được giữ riêng dưới dạng approximation; `Recipe.createdAt` không chứng minh công thức có hiệu lực tại ngày bán.

Ngày kinh doanh có dạng `YYYY-MM-DD`, timezone nghiệp vụ cố định `Asia/Ho_Chi_Minh`, ca là `MORNING`, `AFTERNOON`, `EVENING`; đơn vị đúng Catalog là `g`, `ml`, `piece`. Số lượng nguyên liệu truyền bằng chuỗi thập phân, không dùng float để tính. Thiếu báo cáo hoặc chưa duyệt không đồng nghĩa bán bằng 0.

## Chính sách giai đoạn này

Chỉ triển khai source và tài liệu. Chưa chạy code, test, build, lint, typecheck, training, evaluation, cài dependency, dịch vụ, HTTP hoặc database. Chưa thực hiện Prisma/migration; không sửa môi trường hoặc credentials. Mọi kiểm tra được hoãn đến QA cuối toàn hệ thống. Các giá trị minh họa trong tài liệu là hợp đồng cấu trúc, không phải dữ liệu kinh doanh thật.
