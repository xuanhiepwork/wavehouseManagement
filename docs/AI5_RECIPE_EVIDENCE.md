# WaveHouse AI5 — Bằng chứng công thức lịch sử cho AI

**Trạng thái:** mã nguồn và migration nháp; **chưa được chạy, validate, migrate, huấn luyện hoặc QA**.

## Mục tiêu

W7.3 lưu báo cáo đã duyệt và các dòng bán hàng cùng sản phẩm, size, giá/số lượng, nhưng **không lưu công thức nguyên liệu đã dùng vào lúc bán**. AI5 bổ sung bảng `sales_recipe_evidence` **độc lập, bất biến**, dành riêng cho AI. Không sửa bảng bán hàng đã có, không sửa dữ liệu lịch sử, không ghi kho. Chỉ ADMIN có quyền xác nhận.

## Kiến trúc

- `SalesRecipeEvidence` liên kết duy nhất với một `SalesReportLine` của revision **APPROVED**. Ghi lại recipeId, recipeVersion, variant, product, size, thời điểm tạo công thức, danh sách nguyên liệu + đơn vị + định lượng trong JSON, người xác nhận, thời gian xác nhận, ghi chú chứng cứ.
- Người xác nhận **phải có chứng cứ thực tế** rằng công thức đã dùng trong ca bán; không được chỉ dựa vào công thức Catalog đang active. Bản thân thao tác click xác nhận chỉ tạo dấu vết trách nhiệm, **không tự chứng minh chứng cứ ngoài đời là chính xác**.
- Công thức phải được tạo **trước 00:00 giờ Việt Nam của ngày kinh doanh** vì W7.3 không có thời gian bán từng ly. Trường hợp công thức mới bắt đầu trong ngày cần thiết kế có timestamp hiệu lực riêng ở giai đoạn sau.
- `ai5_guard_evidence_insert` chặn xác nhận khi report/revision không còn nhất quán, product/size không khớp, người xác nhận không phải active ADMIN, người xác nhận chính là người gửi báo cáo, hoặc snapshot nguyên liệu không khớp bản công thức được chọn.
- `ai5_evidence_append_only` cấm sửa/xóa bằng chứng; một dòng bán chỉ có tối đa một bản bằng chứng. Việc sai chứng cứ cần quy trình bổ sung có audit riêng, **không tự sửa SQL/ghi đè bản cũ**.
- `GET /api/restock-planning/ai-evidence?branchId=&from=&to=`: liệt kê các báo cáo APPROVED cần xác minh.
- `GET /api/restock-planning/ai-evidence/:id`: xem các dòng bán cùng công thức ứng viên.
- `POST /api/restock-planning/ai-evidence/:id/attest`: ADMIN tự chọn công thức và gửi acknowledgement, expectedVersion, expectedRevisionNumber, ghi chú chứng cứ, ánh xạ từng dòng. Xác nhận nguyên tử toàn bộ các dòng có số lượng bán >0.
- `GET /api/restock-planning/ai-training-export?branchId=&from=&to=`: xuất DTO AI1 `PreparationRequest` gồm báo cáo, revision APPROVED, recipeSnapshot đã xác minh, coverage và cảnh báo do AI1 phân loại. Chỉ là dữ liệu dự kiến đầu vào, **chưa được huấn luyện hoặc đánh giá**.
- B7 `GET /recommendations` vẫn giữ JSON `data` và `proposedDeliveryQuantity`; trường `ai` lấy từ exporter đã duyệt (chỉ các dòng thuộc báo cáo đầy đủ bằng chứng), hoặc dùng fallback B7 an toàn.

## Quyền, an toàn và giới hạn

- Toàn bộ route AI5 nằm trong router `/api/restock-planning`, vốn được gắn `requireAuth` + `requireAdmin` tại `app.ts`.
- Không trả password, thông tin thanh toán hay dữ liệu cá nhân trong bộ xuất ML. Chỉ sử dụng lượng đồ uống đã duyệt, công thức và mã chi nhánh.
- Một báo cáo đã duyệt không bị đếm trùng các revision; thiếu bằng chứng không bị biến thành 0 tiêu hao.
- Đối với ca **đã duyệt có 0 sản phẩm bán**, có thể xác nhận đó là 0 lý thuyết cho các nguyên liệu đã có từ trước; không cần chứng thực công thức cho dòng không bán.
- B6 variance không được dùng làm nhãn tiêu hao ML. B7 vẫn là **heuristic**, không phải mô hình học máy.
- Một bằng chứng xác nhận **sau ngày bán** chỉ được phép là dữ liệu biết tại thời điểm xác nhận. Khi backtest ngày lịch sử, không được dùng bằng chứng mà ở ngày đó chưa có.
- Bằng chứng cho công thức được gán sau ca không tự cho phép dự báo ML: vẫn cần **đủ mẫu**, artifact mô hình được huấn luyện và độ chính xác được QA đánh giá. Có thể nhiều báo cáo mới chưa đủ điều kiện.
- Ngày lịch sử hiện chỉ được lập `expectedSlots` từ các báo cáo đã có vì không có lịch ca chuẩn; không tự tạo bản ghi 0 cho ca thiếu.
- Mọi bảng mới/migration đều **chờ đánh giá và chạy trong QA cuối**. Thứ tự: W7.2, W7.3, sau đó AI5.

## Cần làm trong QA cuối

1. So khớp Prisma schema với SQL migration và trigger; review Aiven backup/transaction trước khi triển khai.
2. Generate Prisma Client theo schema, typecheck, build Backend/Website và kiểm thử UI.
3. Kiểm thử vòng đời W7.3, quyền ADMIN, bảo vệ append-only, cạnh tranh hai người xác nhận, gửi lại request sau mất mạng.
4. Kiểm chứng exporter AI1 bằng dữ liệu có chứng cứ; thử dữ liệu thiếu, bằng chứng mâu thuẫn, 0 ly, thay đổi giá, kích cỡ, revision sai.
5. Kiểm chứng đúng ranh giới thời gian (giờ Việt Nam) và train/test split không rò rỉ dữ liệu tương lai.
6. Huấn luyện và đánh giá AI2 trên dữ liệu thật hoặc bộ dữ liệu được người dùng cấp quyền; nếu không đủ dữ liệu thì hiển thị B7 fallback.
7. Kiểm tra B7 không hề thay đổi proposedDeliveryQuantity và không phát sinh inventory movement bởi AI.

**Không tự chạy migration Aiven hoặc sửa dữ liệu lịch sử để tạo nhãn giả.**
