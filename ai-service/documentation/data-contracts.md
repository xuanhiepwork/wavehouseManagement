# Hợp đồng dữ liệu AI1 và mapping Backend

## Quy ước hợp đồng

Các DTO trong `app/schemas/` là hợp đồng thư viện nội bộ cho AI1, **chưa phải endpoint Backend hoặc endpoint AI công khai**. Python dùng snake_case trong source; wire payload/serialization dùng camelCase theo Backend. Cấu hình model từ chối trường lạ để tránh đưa nhầm thông tin nhạy cảm vào dataset. UUID phải là UUID hợp lệ, ngày đúng `YYYY-MM-DD`, timestamp có timezone, quantity hữu hạn và đúng domain; decimal được truyền dưới dạng chuỗi, không dùng float cho số lượng nguyên liệu.

Timezone nghiệp vụ là `Asia/Ho_Chi_Minh`. `businessDate` là ngày kinh doanh, không phải timestamp UTC bị cắt chuỗi theo timezone máy. `Shift` chỉ nhận `MORNING`, `AFTERNOON`, `EVENING`; ingredient unit chỉ nhận `g`, `ml`, `piece`; product size phản ánh `S`, `M`, `L`. Các trạng thái mapping, coverage, availability và forecast dùng enum định nghĩa trong source, không diễn giải bằng chuỗi tùy ý của client.

## Nguồn dữ liệu thực tế

| Model/trường Backend | Mapping và giới hạn AI1 |
|---|---|
| `Branch.id` | `branchId` UUID; Backend xác nhận quyền/scope trước khi cấp dữ liệu |
| `Product.id` | `productId`; không join bằng tên hiển thị |
| `ProductVariant.id`, `productId`, `size` | Variant được xác định bởi sản phẩm + size; schema có unique `(productId, size)` |
| `ProductVariant.activeRecipeId` | Chỉ biểu thị recipe hiện tại, không chứng minh recipe dùng trong quá khứ |
| `Recipe.id`, `productVariantId`, `version` | Tham chiếu recipe; unique `(productVariantId, version)` |
| `Recipe.createdAt`, `updatedAt` | Metadata record, không phải lịch sử hiệu lực công thức |
| `RecipeIngredient.recipeId`, `ingredientId`, `quantity` | Quantity cho một đồ uống; database `Decimal(18,6)` |
| `Ingredient.id`, `unit`, `minStock` | Unit `BaseUnit` gồm g/ml/piece; minStock `Decimal(18,6)`, không suy ra từ tên |
| `SalesReport.id`, `branchId`, `businessDate`, `shift`, `status` | Khóa nguồn và khóa nghiệp vụ; unique branch/date/shift |
| `SalesReport.currentRevisionNumber`, `submittedRevisionNumber`, `approvedRevisionNumber`, `approvedAt` | Chỉ revision approved chính xác, sẵn có tại cutoff mới được dùng chính thức |
| `SalesReportRevision.id`, `reportId`, `number`, `createdAt` | Một report chỉ đóng góp một approved revision; createdAt riêng không chứng minh đã duyệt |
| `SalesReportLine.id`, `position`, `productId`, `size`, `quantity` | Dòng nguồn; productId nullable và size cho phép OTHER ở bản nháp, phải kiểm tra trước khi map demand |
| `SalesReportLine.productNameSnapshot`, `unitPriceSnapshot` | W7.3 có snapshot tên/giá; không phải snapshot công thức. AI1 không cần giá để tính demand |
| `InventoryBalance.branchId`, `ingredientId`, `quantity`, `updatedAt` | Số dư hiện tại; không phải tồn kho lịch sử tại mỗi ngày bán |
| `InventoryMovement.kind`, `sourceId`, `delta`, `quantityAfter`, `createdAt` | Dòng nghiệp vụ kho, không đồng nhất delta âm với tiêu hao đồ uống |
| `ShiftStockCount.status`, `businessDate`, `shift`, `approvedAt` | Chỉ kiểm kê approved có giá trị đối chiếu trong phạm vi; không là sales report |
| `ShiftStockCountItem.countedQuantity`, `expectedQuantity`, `variance` | Chênh lệch kho chỉ là proxy/cảnh báo, không nhận làm actual consumption verified |
| `DemandCalendarOverride.businessDate`, `dayType` | Nguồn ngày đặc biệt do Backend quản lý; phải có availability thích hợp nếu dùng backtest |

AI1 không truy vấn những bảng này. Đây là mapping để Backend adapter AI3 trong tương lai xây payload có quyền; source không giả định W7.3 đã xuất tất cả metadata mới của AI1.

## Input chuẩn bị dataset

`PreparationRequest` có schema version `AI1`, timezone, `exportedAt`, danh sách ingredient metadata, reports, historicalRecipes/currentRecipes, expectedSlots, mappingMode, cờ exportComplete và stockCountProxies tùy chọn. Payload không chứa tài khoản, khách hàng hoặc token.

- `reports`: danh sách report cùng đúng revision và dòng bán. Giữ trạng thái chưa approved để coverage phân biệt thiếu/chưa duyệt; không đưa chúng vào demand chính thức.
- `ingredients`: metadata ingredientId/unit và minimum stock nếu hợp đồng yêu cầu. Không đoán unit từ số lượng hoặc tên nguyên liệu.
- `expectedSlots`: những slot branch/date/shift đáng lẽ có report theo phạm vi/lịch hoạt động do caller cung cấp; AI1 không tự biết lịch mở cửa toàn hệ thống.
- `exportComplete`: xác nhận payload bao phủ đủ phạm vi đã khai báo, không phải lời khẳng định toàn bộ database đầy đủ. Pagination chưa tải đủ không được đặt thành true.
- `historicalRecipes`: composition lịch sử và evidence được tin cậy cấp từ tương lai AI3; không tự suy ra từ activeRecipeId.
- `currentRecipes`: catalog hiện tại chỉ dùng khi opt-in approximation.
- `mappingMode`: mặc định `VERIFIED_ONLY`; `ALLOW_CURRENT_APPROXIMATION` là opt-in rõ ràng và không đổi nhãn approximation thành verified.
- `stockCountProxies`: nguồn tham khảo chênh lệch kho được cảnh báo, không dùng làm nhãn consumption chính thức.

Tham chiếu `historicalRecipeReference` ở dòng sale là metadata projection **AI1/AI3**, không phải trường đang có của `SalesReportLine`. Nó cần `evidenceId`, `recipeId`, version, `productVariantId` và `availableAt` đối chiếu composition. Chỉ caller có nguồn chứng cứ thực mới được cấp; không tạo reference giả từ `Recipe.createdAt`.

`prepare_payload(raw)` là biên xử lý payload thô: lỗi validation được chuyển thành issues có đường dẫn trường/mã lỗi, không sao chép giá trị payload có thể nhạy cảm. `prepare_dataset(request)` làm việc với DTO đã xác thực; caller chịu trách nhiệm lấy dữ liệu qua đường phân quyền trước đó. Hai hàm không tự đọc network, database hay credentials.

## Output chuẩn bị dataset

`PreparedDataset` gồm observations, contributions, coverage, warnings, số lượng accepted/rejected và `validationFailed`. Dataset lỗi không được diễn giải thành dataset thành công có demand bằng 0.

`DemandContribution` giữ UUID report/revision/line, approved revision number, branch/date/shift, product/size, quantity sold, recipe ID/version/evidence, ingredient ID/unit, lượng tính bằng Decimal, basis verified/approximate, availability và quality provenance. Đây là dấu vết từng phép nhân, giúp truy ngược tổng theo ca mà không cần tên người tạo báo cáo.

`DemandObservation` gộp đúng branch/date/shift/ingredient/unit, kèm basis, trạng thái coverage và `availableAt`. Giá trị chưa xác định/không đủ không thay bằng zero. Approximate observation được giữ riêng với verified observation để caller/model chọn mục tiêu rõ ràng.

`SlotCoverage` phân biệt:

| Trạng thái | Ý nghĩa |
|---|---|
| `NO_REPORT` | Slot dự kiến nhưng không có report trong export đủ phạm vi |
| `UNAPPROVED_REPORT` | Có report nhưng chưa là revision approved chính thức |
| `APPROVED_ZERO_SALES` | Có approved report xác nhận không bán; không suy ra từ việc thiếu dòng do export lỗi |
| `APPROVED_RECORDED_SALES` | Có approved report ghi nhận sales; vẫn phải kiểm tra recipe coverage |
| `INVALID` | Nguồn mâu thuẫn/không hợp lệ nên không thể sử dụng an toàn |

Coverage về report và coverage về recipe là hai thông tin khác nhau: report approved đầy đủ vẫn có thể thiếu composition lịch sử. Structured warning có code, severity và khóa nguồn thích hợp; downstream phải giữ warnings đi cùng output thay vì chỉ lấy cột số lượng.

## Forecast request/response

`ForecastRequest` nhận `branchId`, `businessDate`, `shift`, danh sách `ingredients`, `historicalObservations` và `contextualFeatures` cho calendar/inventory. Danh sách ingredients gồm unit metadata, thay vì chỉ UUID rồi đoán đơn vị. Timestamp cutoff và availability được dùng để chặn thông tin chưa biết tại thời điểm dự báo.

`ForecastResponse` nhận dạng cùng branch/date/shift, `predictions` và `generatedAt`. Mỗi prediction có ingredient/unit, status, predictedDemand, uncertaintyLower/Upper, modelVersion, dataCoverage và warnings theo schema. Các số lượng xuất dạng decimal string; predictedDemand/bounds có thể `null` khi chưa có model hoặc dữ liệu không đủ.

AI1 không tạo trained forecast. Adapter không có model trả trạng thái `MODEL_NOT_CONFIGURED` hoặc `INSUFFICIENT_DATA` với giá trị null. Caller không được chuyển null thành 0 để trình bày dự báo. B7 supplied-output adapter chỉ chuẩn hóa heuristic đã có nguồn và trạng thái rõ ràng; không tải dữ liệu hoặc gọi endpoint.

## Điều kiện nguồn sẵn có theo thời điểm

Để tạo feature cho ngày D, observation phải có businessDate trước D **và** availableAt trước cutoff dự báo. Revision được tạo hôm trước nhưng duyệt sau cutoff không hợp lệ cho lần dự báo đó. Cùng nguyên tắc áp dụng cho recipe evidence, calendar context, inventory context và export mà caller xác nhận.

Không dùng generatedAt hiện tại để giả định lịch sử đã được biết sớm hơn. Nếu nguồn không chứng minh được availability, giữ unknown/incomplete và cảnh báo. Khi AI3 bổ sung snapshot thực, cần version hợp đồng và quy tắc import rõ ràng; AI1 không thêm migration để giả lập lịch sử này.
