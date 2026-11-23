# Tích hợp B7, bảo mật và lộ trình AI2–AI4

## B7 hiện có là heuristic

`backend/src/services/restock-forecast.service.ts` đang triển khai `buildRestockRecommendations`; router ở `backend/src/routes/restock-recommendation.routes.ts`. `GET /api/restock-planning/recommendations` được đăng ký qua `requireAuth` và `requireAdmin`. Request bắt buộc có `sourceBranchId`, 1–10 `destinationBranchIds` khác nguồn, `businessDate` và `shift` hợp lệ.

B7 đọc chi nhánh/nguyên liệu hoạt động, tồn kho hiện tại, minimum stock, lịch ngày đặc biệt và B6 APPROVED trong cửa sổ 90 ngày. Nó chỉ lấy mẫu trước ca đích khi có kiểm kê approved ở ca liền trước; lượng mẫu dựa trên phần âm của variance. Khi có đủ mẫu cùng loại ngày/ca, dùng tối đa 8 mẫu gần nhất; nếu thiếu, dùng cùng ca kèm hệ số heuristic, hoặc MIN_STOCK_ONLY. Nhu cầu bổ sung gồm forecast × 1.20 + minStock − onHand; nguồn hạn chế được chia tỷ lệ.

Đó là rule-based planning dựa trên proxy chênh lệch kho, **không phải mô hình ML được huấn luyện**. Negative variance có thể bao gồm hao hụt, sai số hoặc giao dịch chưa phản ánh; không chứng minh tiêu hao thực. Những hạn chế đó phải hiển thị khi dùng B7 fallback. AI1 không sửa code/thuật toán B7, không gọi endpoint B7 và không chuyển variance thành nhãn demand sales chính thức.

## Hợp đồng adapter và fallback tương lai

AI1 định nghĩa protocol chung cho model và adapter đọc kết quả baseline được caller truyền vào. Adapter phải đối chiếu branch/date/shift/ingredient/unit, lượng không âm, số mẫu, forecastMethod và provenance trước khi chuẩn hóa. Không thể dùng kết quả fallback của điểm nhận A cho điểm nhận B hoặc dùng requestedQuantity/proposedDeliveryQuantity làm predicted demand.

AI3 sẽ điều phối theo chính sách công khai: ưu tiên model AI2 có artifact/version và dữ liệu đủ coverage; nếu không khả dụng thì cân nhắc B7 rule-based trong đúng phạm vi được cấp quyền. Nếu cả hai đều không đủ điều kiện, trả insufficient data. Không che giấu việc fallback, không tự retry theo cách tạo hoạt động kho và không biến minStock-only thành tín hiệu confidence cao.

Con người xem demand, tồn kho, minStock, hạn chế nguồn, model/fallback, warnings và độ mới dữ liệu trước khi quyết định. Dự báo nhu cầu và đề xuất lượng giao là hai bước khác nhau. Việc tạo DRAFT, ghi sổ hoặc ký nhận vẫn chạy qua nghiệp vụ Backend/Website hiện có với quyền và xác nhận của người dùng.

## Bảo mật và an toàn dữ liệu

- Backend cấp quyền đọc theo actor, vai trò, chi nhánh, thời gian và mục đích trước khi xuất dữ liệu. AI không quyết định phạm vi bằng UUID caller tự khai.
- Không trao credentials Aiven, Prisma client, database driver hoặc write token cho AI service. AI1 không thêm env/secret và không cần API key.
- Không đưa customer PII, mật khẩu/hash, token phiên đăng nhập, email nhân sự, note tự do hay dữ liệu đối soát tiền không cần thiết vào dataset. Chỉ giữ UUID domain và provenance cần cho phép tính.
- Không thêm endpoint dự báo/export công khai chưa xác thực. Khi AI3 thêm transport, cần service authentication, phân quyền scope, giới hạn payload/thời gian, audit, error handling và lưu trữ có kiểm soát.
- Không cho model tự ghi InventoryBalance/InventoryMovement, thay trạng thái approved hoặc tạo/chốt StockDocument/TransferReceipt. Output chỉ mang tính tư vấn.
- Log chỉ ghi mã lỗi, correlation và khóa nguồn tối thiểu theo chính sách; không ghi toàn payload, Authorization header hoặc credentials. AI1 không tự bật dữ liệu nghiệp vụ qua HTTP.

## AI2 — training và evaluation, chưa triển khai

Cần dữ liệu lịch sử được cấp quyền, recipe snapshots có bằng chứng, expected slots đáng tin cậy và feature definitions cố định. Chuẩn bị split theo thời gian và giữ riêng nhóm chi nhánh/nguyên liệu khi thích hợp; không random split khiến cùng thời kỳ rò rỉ vào train/validation. Cutoff availability phải áp dụng cả trước/sau khi tính features.

AI2 cần xác định mục tiêu là verified theoretical demand hoặc approximation riêng; không dùng variance làm ground truth thực đo. Chọn mô hình và dependency dựa trên dữ liệu thực sau này, lưu feature schema/model version, dữ liệu huấn luyện, cutoff, phạm vi, quality metrics và artifact provenance. Đánh giá cùng B7 với cảnh báo proxy khác mục tiêu, đo theo chi nhánh/ca/nguyên liệu, theo dõi leakage, bias do thiếu report và uncertainty calibration. AI1 chưa chạy bất cứ training/evaluation nào và chưa tạo artifact mô hình.

## AI3 — Backend read-only integration, chưa triển khai

AI3 cần export có phân quyền các revision đúng trạng thái approved thay vì gọi endpoint AI với toàn lịch sử chưa lọc. Pagination/snapshot isolation, giới hạn thời gian, scope và bản ghi bị loại phải được minh bạch. Backend xác nhận report/revision đã sẵn có tại cutoff, khóa nghiệp vụ duy nhất, approved zero-sales và mapping product-size sang ProductVariant.

Khoảng trống quan trọng là historical recipe contract. Cần thiết kế snapshot immutable tại thời điểm thích hợp trong luồng sales: recipeId/version, productVariantId, ingredientId/unit/quantity per beverage, thời điểm hiệu lực, bằng chứng nguồn và thời điểm snapshot sẵn có. Recipe.createdAt hoặc activeRecipeId hiện tại không thay thế activation history. Cần quy định xử lý recipe sửa muộn, đổi đơn vị, recipe bị vô hiệu hóa, report nhập hồi tố và revision được duyệt muộn. Đây là thay đổi Backend tương lai; AI1 không thêm migration hoặc dựng historical data giả.

Tồn kho/minStock/context đưa vào backtest cần historical snapshots hoặc event reconstruction có bằng chứng và timestamp sẵn có. `InventoryBalance` hiện tại chỉ là trạng thái hiện tại. Nếu chưa có nguồn như vậy, chỉ dùng chúng ở inference hiện tại trong phạm vi thời điểm hợp lệ, không gán ngược về quá khứ.

AI3 cũng cần lịch hoạt động chi nhánh/ca để định nghĩa report đáng lẽ phải có, contract special-day có timestamp, giao thức service-to-service, trạng thái insufficient data/fallback, và phương án hiển thị provenance. Không tự tạo ADMIN/driver role mới cho AI.

## AI4 — Website và human review, chưa triển khai

Website cần hiển thị nhu cầu dự báo riêng với lượng giao, ngày/ca/chi nhánh/đơn vị, model version hoặc B7 method, generatedAt/cutoff, data coverage, approximate/verified status và warnings. Không gọi output approximation là tiêu hao thực.

Quản lý chọn đầu vào rõ ràng, yêu cầu dự báo và xem giới hạn dữ liệu; không chạy planning ngầm chỉ vì mở dashboard. Người dùng duyệt lượng giao trước khi tạo DRAFT chuyển kho theo W7.5. POST chuyển kho vẫn ghi sổ nguồn−/đích+ theo Backend, physical receiving W7.2 không ghi lần hai. Approval/report revision và dirty-form safeguards W7.2–W7.5 tiếp tục do các module hiện có xử lý.

## Final QA được hoãn

Chưa chạy tests, type/lint/build, compile Python, dependency install, training/evaluation, HTTP, dịch vụ hoặc database. QA cuối cần bao phủ validation/serialization Decimal và timezone; duplicate/conflict; recipe proof/current approximation; zero vs missing; availability cutoff; lag/rolling; unit/piece; B7 normalization; payload limits; authorization và hồi quy W7.2–W7.5. Danh sách này là công việc tương lai, không phải kết quả kiểm chứng AI1.
