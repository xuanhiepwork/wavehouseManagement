# Kiến trúc AI1 và pipeline nhu cầu nguyên liệu

## Mục đích và ranh giới

AI1 là lớp chuẩn bị dữ liệu chỉ đọc. Backend Node/Express/Prisma giữ quyền truy cập nghiệp vụ và các giao dịch kho; AI service không nhận credentials PostgreSQL và không có chức năng ghi `InventoryBalance`, `InventoryMovement`, `ShiftStockCount`, `StockDocument`, `TransferReceipt` hoặc trạng thái duyệt `SalesReport`.

Luồng dự kiến:

```text
Backend đã phân quyền / export có provenance (AI3, tương lai)
    -> DTO Pydantic, kiểm tra trường và số lượng (AI1)
    -> xác định report/revision duy nhất, cutoff, coverage (AI1)
    -> map sản phẩm + size sang công thức có bằng chứng (AI1)
    -> nhu cầu lý thuyết verified / approximate tách riêng (AI1)
    -> lag, rolling và missing flags theo thời điểm (AI1)
    -> model AI2 hoặc B7 rule-based adapter (tương lai)
    -> Backend kiểm soát phạm vi -> Website AI4 -> người quản lý duyệt
```

HTTP hiện vẫn chỉ có root/health từ foundation cũ. Không có route dự báo công khai, route export sales hoặc route tự tạo/chốt chuyển kho. Pipeline không tự tải Catalog, gọi B7, đọc file kinh doanh hay mở kết nối database.

## Chọn dữ liệu sales chính thức

Chỉ báo cáo `APPROVED` với approved revision hợp lệ mới đóng góp vào demand chính thức. Phải so khớp `SalesReport.approvedRevisionNumber`, `currentRevisionNumber`, `submittedRevisionNumber`, `SalesReportRevision.number` và đúng quan hệ report/revision; chỉ lấy một revision cho mỗi report. Không cộng mọi revision do một báo cáo có nhiều lần lưu.

Khóa nghiệp vụ từ schema là `(branchId, businessDate, shift)`; report có UUID riêng. Hai UUID report cùng khóa nghiệp vụ, hai revision trùng lặp hoặc payload mâu thuẫn phải tạo issue thay vì cộng đôi. Báo cáo DRAFT/SUBMITTED/RETURNED được giữ ở coverage nhưng không trở thành số sales bằng 0.

Báo cáo không có dòng bán chỉ biểu thị zero-sales khi payload approved đủ bằng chứng và do nguồn export tin cậy xác nhận. Backend W7.3 yêu cầu giải thích ca không bán trong note khi submit. AI không cần nhận note tự do có thể chứa thông tin cá nhân; adapter AI3 cần chuyển thành cờ xác nhận không bán hàng và giữ bằng chứng ở Backend.

## Tính nhu cầu lý thuyết

Với từng dòng bán hợp lệ và công thức tương ứng product/size:

```text
contribution = SalesReportLine.quantity × RecipeIngredient.quantity
theoreticalDemand(branch, date, shift, ingredient, unit)
    = tổng contribution của những dòng thuộc đúng nhóm
```

`RecipeIngredient.quantity` là lượng nguyên liệu cho một đồ uống của một `ProductVariant`; không suy diễn công thức M từ S/L. Dùng `Decimal` và precision cục bộ đủ lớn; không chuyển qua binary float. Chuỗi decimal được kiểm tra hữu hạn, dấu và độ chính xác theo domain. Với `piece`, phải tuân theo tính nguyên theo quy tắc Catalog/kho; không tự đổi đơn vị hoặc làm tròn lượng bán.

Giữ `g`, `ml`, `piece` thành các nhóm khác nhau. Không tự quy đổi khối lượng sang thể tích; cùng một ingredient xuất hiện với unit mâu thuẫn phải có issue và không được âm thầm cộng chung.

Kết quả là **nhu cầu lý thuyết từ đồ uống đã báo cáo**, không phải phép đo tiêu hao vật lý. Hao hụt, pha hỏng, đổ bỏ, điều chỉnh, nhận thiếu/hỏng và chênh lệch kiểm kê không được trộn làm ground truth sales demand. Không tạo InventoryMovement từ kết quả tính toán.

## Công thức lịch sử và provenance

W7.3 lưu `SalesReportLine.productNameSnapshot`, `unitPriceSnapshot`, `productId`, `size`, `quantity`; không lưu `recipeId`, version, active interval hoặc thành phần tại thời điểm bán. Catalog hiện tại có `Recipe.version` và `ProductVariant.activeRecipeId`, nhưng activeRecipeId là liên kết hiện tại. `createdAt` chỉ là thời điểm tạo record, không phải lịch sử kích hoạt công thức.

Vì vậy, mặc định dòng thiếu historical recipe evidence được đánh dấu thiếu mapping. Có thể cấp dữ liệu snapshot/bằng chứng lịch sử qua DTO để chuẩn bị verified theoretical demand trong tương lai; không gán nhãn verified chỉ vì recipe được tạo trước ngày bán. Chế độ approximation cần caller bật tường minh, sử dụng mapping hiện tại có provenance và tách giá trị approximate khỏi verified.

Mỗi contribution lưu nguồn report/revision/line, chi nhánh/ngày/ca, product/size, quantity sold, recipe reference/version/mode, ingredient/unit và trạng thái chất lượng. Observation lưu coverage và thời điểm sẵn có. Warning phải đủ khóa để truy được record lỗi mà không đưa tên khách hàng, token, password hoặc thông tin tài khoản vào dataset.

## Đặc trưng và chống rò rỉ tương lai

Ngày kinh doanh được xử lý là lịch địa phương `Asia/Ho_Chi_Minh`, không đoán từ timezone máy chạy. Feature thời gian gồm thứ trong tuần, cuối tuần, ca và tín hiệu ngày đặc biệt do caller cung cấp; không tự chế lịch nghỉ lễ Việt Nam.

Lịch sử cho ngày dự báo D phải thỏa **cả hai** điều kiện:

1. `observation.businessDate < D` — không dùng ca cùng ngày hoặc ngày tương lai.
2. Thông tin nguồn đã sẵn có trước cutoff dự báo — report đã duyệt, recipe evidence và dữ liệu nguồn không đến sau thời điểm dự báo.

`businessDate` cũ không đủ: report được duyệt muộn hoặc snapshot xuất sau cutoff không được đưa vào backtest như thể đã biết sớm. Thời điểm export không tự chứng minh thời điểm lịch sử có thể sử dụng; AI3 cần cung cấp timestamp nguồn phù hợp. Inventory/minStock hoặc special-day context cũng cần availability timestamp trước cutoff; số dư hiện tại không thay thế snapshot tồn kho lịch sử.

Lag và rolling chỉ lấy đúng chi nhánh, nguyên liệu, đơn vị, loại observation và ca. Lag theo ngày bị thiếu giữ `null`; không lấy quan sát gần nhất thay cho ngày thiếu mà không ghi rõ. Rolling có số mẫu, expected/available/missing history và coverage riêng. Không trộn approximate vào verified nếu caller không chọn chế độ phù hợp. Các cờ phân biệt NO_REPORT, UNAPPROVED, APPROVED_ZERO_SALES và APPROVED_RECORDED_SALES giúp mô hình sau này không học rằng thiếu dữ liệu là cầu bằng 0.

Không có lịch ca bắt buộc đầy đủ trong schema hiện tại. Caller phải cung cấp các slot dự kiến, phạm vi chi nhánh/ca/nguyên liệu và lịch hoạt động để kết luận coverage; khi chưa có, chỉ báo lượng dữ liệu có thật và cảnh báo không đủ lịch, không tuyên bố tỷ lệ hoàn thành của toàn hệ thống.

## Chất lượng dữ liệu

| Nhóm kiểm tra | Cách xử lý |
|---|---|
| UUID/ngày/ca/enum/decimal không hợp lệ, trường ngoài hợp đồng | Validation có cấu trúc; không chấp nhận âm thầm |
| Thiếu report hoặc chưa approved | Giữ coverage/missing status, không thay bằng 0 |
| Trùng report/revision hoặc khóa nghiệp vụ mâu thuẫn | Issue chỉ rõ nguồn; loại khỏi phép cộng để tránh đếm hai lần |
| Quantity sales âm, không nguyên hoặc mâu thuẫn zero-sales | Issue, không tạo contribution hợp lệ |
| Thiếu product/size/Catalog mapping | Issue giữ report/line; không đoán sản phẩm từ tên |
| Thiếu recipe evidence/version lịch sử | Mặc định chưa verified; approximation chỉ khi opt-in |
| Thiếu unit hoặc unit không tương thích | Issue; không quy đổi hoặc cộng lẫn |
| Ingredient quantity âm/không hợp lệ | Issue hoặc validation; không tự sửa số |
| Lịch sử thiếu branch/shift hoặc đến muộn | Coverage và availability warning |
| Dùng inventory variance làm actual demand | Warning/không nhận làm nhãn sales verified |

Validation ở biên có thể từ chối payload không hợp lệ; wrapper chuẩn bị dataset chuyển lỗi thành structured issues. Record bị bỏ khỏi phép tính phải có issue đi kèm. Dữ liệu tốt còn lại chỉ được giữ khi không làm demand trông như đầy đủ; coverage và giá trị tổng hợp phải phân biệt partial, missing và complete.

## Giao diện dự báo

AI1 có hợp đồng request/response và protocol cho model tương lai. Predicted demand, uncertainty và model version phải gắn đúng branch/date/shift/ingredient/unit; thiếu dữ liệu được trả thành trạng thái insufficient data với demand/bounds `null`, không chèn 0 hoặc giá trị tùy ý. Các trường uncertainty chỉ có giá trị khi model sau này đã định nghĩa/đánh giá phương pháp; không mặc định tỷ lệ phần trăm tùy ý.

Adapter B7 nhận đầu ra heuristic do caller đã có quyền cung cấp; không thực hiện HTTP hoặc truy cập DB. Đầu ra B7 được gắn loại rule-based, nguồn variance proxy và cảnh báo giới hạn, không được đổi nhãn thành mô hình ML hay verified sales demand.

## Trạng thái kiểm chứng

Đây là source triển khai trong chế độ QA deferred. Chưa chạy pipeline, training, evaluation, dependency install, tests hoặc service. Tài liệu mô tả hợp đồng và ý định xử lý của source; độ đúng khi chạy, tương thích phiên bản và các tình huống biên được dành cho final QA.
