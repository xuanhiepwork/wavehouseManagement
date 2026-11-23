# AI1 — Nền tảng xử lý dữ liệu dự báo nguyên liệu (bản bổ sung thủ công)

## Phạm vi và trạng thái

Bộ file này **chỉ bổ sung module Python** cho 8 file AI1 mà Codex đã tạo dở. Không ghi đè các file `app/schemas/*`, `app/config/*`, `requirements.txt`. Chưa huấn luyện ML, chưa thực thi, chưa QA, chưa kết nối Backend hay Aiven.

Tất cả tính toán là **tham vấn**. Không có code ghi `InventoryBalance`, `InventoryMovement`, B5, B6 hoặc duyệt giao nhận/bán hàng. B7 heuristic được giữ nguyên.

## Thành phần mới

- `app/data/prepare.py`: `prepare_demand(PreparationRequest) -> PreparedDataset`.
- `app/quality/audit.py`: tập hợp cảnh báo có mã và bối cảnh, không ghi log dữ liệu nhạy cảm.
- `app/features/engineer.py`: `prepare_features(ForecastRequest, FeatureSettings) -> tuple[FeatureRow, ...]`.
- `app/forecasting/interface.py`: `ForecastProvider` Protocol và `unconfigured_forecast` trả trạng thái rõ ràng, **không tạo số dự báo giả**.

## Nguồn dữ liệu và tính đúng

1. Chỉ báo cáo `APPROVED` có `approved_revision_number == submitted_revision_number == current_revision_number`, revision duy nhất và timestamp hợp lệ mới được tính. Báo cáo `DRAFT`, `RETURNED`, `SUBMITTED` không trở thành nhãn tiêu hao.
2. Mỗi chi nhánh/ngày/ca chỉ chấp nhận một report. Trùng slot, trùng report ID hoặc bất nhất revision được đánh dấu lỗi; không chọn ngẫu nhiên một report.
3. `theoreticalDemand = SUM(quantitySold × recipeQuantityPerBeverage)` bằng `Decimal`, theo từng nguyên liệu và đơn vị. Không cộng `g`, `ml`, `piece` chung.
4. Chế độ mặc định `VERIFIED_ONLY`: mỗi line cần `recipeReference` có bằng chứng khớp **chính xác** recipe ID/version/variant/product/size và mốc thời gian. **W7.3 chưa lưu snapshot recipe**, vì vậy tập dữ liệu thật có thể không sinh nhãn verified. Đây là hành vi an toàn, không phải lỗi.
5. `ALLOW_CURRENT_APPROXIMATION`: có thể ước tính từ recipe hiện tại khi line không có bằng chứng lịch sử. Kết quả mang `APPROXIMATE_CURRENT_RECIPE`, coverage không được coi là verified. Không trộn với nhãn verified để huấn luyện.
6. Line thiếu product/size hoặc recipe/ingredient unit không khớp sẽ được ghi cảnh báo và đánh dấu coverage thiếu/chưa đủ. Không tự sửa đơn vị, không tự điền số 0.
7. `APPROVED_ZERO_SALES` có thể tạo nhãn 0 **tiêu hao lý thuyết từ bán đồ uống** cho từng nguyên liệu; không đồng nghĩa 0 thất thoát thực tế.
8. Stock count variance B6 **không được dùng làm nhãn**. `stock_count_proxies` chỉ dành cho chất lượng/ngữ cảnh và không đi vào phép tính.
9. Dữ liệu chỉ lấy từ projection đã được Backend cấp quyền. Không đưa thông tin khách hàng, mật khẩu, token vào AI.

## Chống data leakage

`prepare_features` lấy điểm cắt **00:00 tại Asia/Ho_Chi_Minh** của ngày dự báo. Chỉ quan sát với `businessDate` trước ngày dự báo và `availableAt` trước điểm cắt mới được xem xét. Nhãn lịch sử phải có coverage COMPLETE, basis VERIFIED và approval hợp lệ. Một ngày thiếu report không phải doanh số 0. Rolling mean được trả `None` nếu thiếu bất kỳ ngày nào trong cửa sổ; lag cũng `None` nếu thiếu quan sát.

**Giới hạn của AI1:** Không có lịch giờ ca thực tế, do đó ngày hiện tại bị loại toàn bộ kể cả khi dự báo ca chiều; AI2 có thể cải tiến khi có mốc thời gian ra quyết định đủ tin cậy. Đối với dữ liệu cũ không có recipe snapshot, không thể suy ra lịch sử chuẩn chỉ từ recipe hiện tại.

## Hợp đồng cho AI2–AI4

- AI2: Xây dựng mô hình, huấn luyện/đánh giá trên `FeatureRow` hợp lệ và nhãn verified, đặt tên/version model, hiệu chuẩn khoảng tin cậy; không train khi không đủ dữ liệu.
- AI3: Backend xuất `PreparationRequest` từ báo cáo đã duyệt (chỉ revision hiệu lực), recipe evidence có nguồn rõ ràng, `expectedSlots`, metadata `availableAt`; Backend tự kiểm tra scope/role. API trao đổi nên có xác thực machine-to-machine, không cho AI kết nối DB trực tiếp.
- AI4: Website gọi Backend xem `ForecastResponse` và xuất kế hoạch B5 DRAFT theo thao tác ADMIN xác nhận. AI không tự POST chuyển kho.
- B7: Giữ làm fallback heuristic riêng, với nhãn "ước tính từ kiểm kê". Không đánh đồng B7 và ML, không xem variance âm là tiêu hao thực.

## Lưu ý về thuật toán đang có

`PreparedDataset.validationFailed == true` nghĩa là export có bất nhất; không đưa các hàng vào huấn luyện cho đến khi xử lý. `DemandObservation.coverage = PARTIAL` không phải nhãn đầy đủ. Đếm số điểm trong `ForecastCoverage` là thông tin chất lượng, không phải độ tin cậy thống kê/độ chính xác mô hình.

## QA cuối cùng — chưa thực hiện

Kiểm tra schema Pydantic và dependency Python, quan hệ revision W7.3, recipe historical, các input cận biên và mã lỗi, tính toán Decimal, lọc đồng thời theo branch/shift, múi giờ, missing vs zero, duplicate, unit mismatch, dữ liệu nhiều chi nhánh, leakage, mapping current approximation, trạng thái thiếu mô hình, contract AI3 và quyền. Không chạy bất kỳ phép kiểm tra nào trong đợt cài này.
