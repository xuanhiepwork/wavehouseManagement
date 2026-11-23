# AI2 — Mô hình học máy dự báo nhu cầu nguyên liệu (chưa chạy QA)

## Trạng thái triển khai

Bộ AI2 này **chỉ thêm mã nguồn**, không huấn luyện, thử nghiệm, đo độ chính xác thực tế, chạy service hoặc kết nối Aiven. Không thay đổi Backend B1–B7, Website, migration hay AI1. Mô hình ở trạng thái **chưa có artifact đã huấn luyện** cho đến khi QA/training được phê duyệt.

## Những file mới

- `app/ml/dataset.py`: nhận `PreparedDataset` AI1, chỉ tạo mẫu với `VERIFIED_HISTORICAL_THEORETICAL`, `COMPLETE`, approved report/revision và coverage phù hợp. Không tự điền 0 vào ngày thiếu; loại quan sát xấp xỉ; lấy đặc trưng như tại đầu ngày Việt Nam.
- `app/ml/ridge.py`: Ridge Regression có L2 regularization, chuẩn hóa đặc trưng và `log1p(target)`, dùng thư viện chuẩn Python; training chỉ xảy ra khi một bên gọi `fit_ridge(...)`. Không cài thêm thư viện.
- `app/ml/training.py`: huấn luyện độc lập cho từng (chi nhánh, nguyên liệu, đơn vị, ca), chia train và holdout theo **ngày tăng dần**, tính MAE/RMSE/WAPE; radius từ phân vị lỗi tuyệt đối trên holdout. Sau khi đánh giá mới refit trên toàn bộ lịch sử đủ điều kiện. Số mẫu tối thiểu mặc định 32 (trong đó 8 ngày cuối làm validation, 24 mẫu train).
- `app/ml/provider.py`: implement `ForecastProvider` AI1, trả `ForecastResponse` có prediction, khoảng bất định mang tính **ước lượng thực nghiệm**, version mô hình và coverage; thiếu dữ liệu hoặc mô hình trả trạng thái rõ ràng **không có giá trị dự báo giả**.
- `app/ml/__init__.py`: package marker.

## Dữ liệu huấn luyện

Nguồn nhãn: lượng nguyên liệu **lý thuyết** tính từ các báo cáo W7.3 đã APPROVED với **bằng chứng công thức lịch sử**. Không dùng `B6 variance` làm nhãn tiêu hao. AI1 hiện yêu cầu chứng cứ recipe id/version tương ứng sản phẩm và size; W7.3 chưa lưu snapshot công thức nên rất có thể **chưa có đủ nhãn verified để huấn luyện**. Đây là thiếu dữ liệu thật, không phải lý do để phát sinh giá trị mô phỏng và gắn nhãn thật.

Một ví dụ dữ liệu bắt đầu dùng được: report đã duyệt, sản phẩm có số lượng bán thực và recipe snapshot/định danh phiên bản tại thời điểm bán, metadata nguyên liệu và thời điểm có thể biết của từng bản ghi. `availableAt` của nhãn phải có trước mốc training; đối với đặc trưng tại ngày D chỉ dùng các bản ghi đã sẵn có trước 00:00 ngày D (Asia/Ho_Chi_Minh). Nếu metadata của nguyên liệu chỉ được cung cấp với timestamp hiện tại, các dòng training quá khứ sẽ không được tự sửa mốc thời gian để đủ điều kiện.

## Đặc trưng

Dùng nguyên `FeatureSettings` và `prepare_features()` của AI1. Đầu vào bao gồm ngày thứ trong tuần, cuối tuần, loại ngày, special-day flag, số ngày verified, các độ trễ 1/7/14 ngày và trung bình trượt 7/28 ngày. Mỗi độ trễ/trung bình bị thiếu có **cờ thiếu riêng**: giá trị 0 nội bộ trong vector không được hiểu là label bằng 0.

Chuỗi training là độc lập theo chi nhánh, ingredient, unit và ca. Nếu một chuỗi thiếu nhãn, bị lặp ngày hay chưa đủ dữ liệu, bộ huấn luyện không tạo model cho chuỗi đó; AI3 sau này có thể chọn baseline B7 một cách minh bạch.

## Đánh giá và khoảng dự báo

Holdout lấy các ngày cuối, không trộn ngẫu nhiên. MAE và RMSE cùng đơn vị với nguyên liệu; WAPE bằng tổng sai số tuyệt đối / tổng nhu cầu thực nếu tổng thực > 0, ngược lại là `null`. Khoảng uncertainty là `prediction ±` phân vị lỗi tuyệt đối trên holdout, **không phải khoảng tin cậy thống kê được bảo đảm**. Khi huấn luyện lại trên toàn bộ lịch sử, các chỉ số holdout chỉ phản ánh giai đoạn trước khi refit. Cần backtesting nhiều mốc thời gian và so sánh B7 trong QA trước khi đánh giá hiệu quả thật.

AI2 sử dụng float bên trong phép học máy; kết quả xuất API được đưa về Decimal và chuỗi tối đa 6 chữ số sau dấu phẩy. Với nguyên liệu `piece`, lượng dự báo làm tròn **lên** số nguyên cho mục đích chuẩn bị, và khoảng dự báo được làm tròn ra ngoài. Không cộng `g/ml/piece` vào một số duy nhất.

## Hợp đồng mã nguồn (không tự thực thi)

```python
# Các entry point sẽ dùng sau giai đoạn QA/AI3:
from app.ml.training import train_ridge_registry, registry_from_document
from app.ml.provider import TrainedRidgeForecastProvider

# registry = train_ridge_registry(
#     prepared=prepared_ai1,
#     ingredients=authorized_ingredients,
#     trained_at=known_utc_training_cutoff,
# )
# artifact = registry.to_document()  # JSON-safe; không ghi file tự động
# restored = registry_from_document(artifact)
# provider = TrainedRidgeForecastProvider(restored)
# response = provider.forecast(authorized_forecast_request)
```

Artifact chứa hệ số mô hình và metrics, không chứa token, thông tin khách hàng, raw report hoặc quyền ghi. `modelVersion` là hash định danh nội dung, **không phải chữ ký xác thực**; AI3 phải có cơ chế lưu/cấp artifact đáng tin cậy. Không dùng Python pickle với artifact đến từ mạng.

## Giới hạn và yêu cầu QA cuối

- **Chưa có mô hình đã học** và chưa có một dự báo nào được tính trong đợt này.
- Ridge tuyến tính là mô hình học máy MVP; hiệu quả trên dữ liệu thực chưa biết.
- Data quality nghiêm ngặt có thể khiến chưa có model theo chi nhánh/ca; B7 phải được giữ làm fallback riêng với nhãn heuristic.
- Lấy nhãn từ công thức hiện tại dù bật AI1 approximation **không được phép** trong training AI2.
- Không có HTTP route, job scheduler, kết nối database, endpoint huấn luyện hay trang web ở AI2; những phần đó thuộc AI3/AI4.
- Trước khi huấn luyện thật: QA schema Pydantic, khả năng chạy của solver, kiểm tra duplicate/leakage/missing vs zero, dữ liệu lịch sử đã duyệt, timestamp và unit, phân tách train/validation, baseline B7, khoảng dự báo, quy mô xử lý, điều kiện dừng, version và bảo mật artifact.
- Backend AI3 không được để AI ghi số dư, ledger, B5, B6 hoặc tự phê duyệt chứng từ.
