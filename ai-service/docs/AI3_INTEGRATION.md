# AI3 — HTTP Python service nội bộ (QA để sau)

## Mã nguồn bổ sung

- `app/api/internal.py`: GET `/internal/ai/v1/status`, POST `/internal/ai/v1/forecast`.
- `app/ai3_main.py`: FastAPI entrypoint mới; không thay `app/main.py` nếu có.
- Phụ thuộc những package có sẵn theo yêu cầu AI1: FastAPI, Pydantic và `app/ml` AI2.

## An ninh

- Các route yêu cầu header `X-WaveHouse-AI-Key` trùng shared secret cấu hình tại runtime.
- Mặc định không có secret → service từ chối; không có endpoint suy luận công khai.
- Request JSON tối đa 8 MiB, artifact mô hình tối đa 12 MiB.
- Artifact chỉ được nạp từ đường dẫn do nhà triển khai cấu hình, không dùng pickle hay nhận model từ API.
- AI chỉ trả dự báo mang tính tham khảo, không kết nối DB, không tác động tồn kho.

## Dữ liệu

Request: `ForecastRequest` AI1 (`schemaVersion: 'AI1'`), per branch/date/shift + ingredient metadata, approved historical observations có provenance, context.
Response: `ForecastResponse` AI1 với trạng thái từng nguyên liệu, `modelVersion`, khoảng dự báo và `advisoryOnly: true`.

Chưa có artifact đã huấn luyện → Python trả trạng thái không sẵn sàng, không tạo dự báo tùy tiện. Để ML hoạt động cần cả artifact AI2 và các quan sát có bằng chứng công thức lịch sử.

## Khi QA/deploy (CHƯA chạy)

Cấu hình secret qua môi trường; khởi chạy nội bộ ví dụ `uvicorn app.ai3_main:app --host 127.0.0.1 --port 8001` trong thư mục ai-service. Có thể chạy trên mạng nội bộ HTTPS được quản trị. **Đây là hướng dẫn sau này, không phải bước cài đặt hiện tại.**

Không ghi token vào source, không thay quyền B7 ADMIN, không expose service ra Internet.
