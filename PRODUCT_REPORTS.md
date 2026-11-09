# Báo cáo sản phẩm

Người mua và người bán đã đăng nhập có thể báo cáo sản phẩm đang hiển thị của người khác. Báo cáo không tự động làm ẩn sản phẩm. Admin kiểm tra thông tin, ghi rõ căn cứ và chọn giữ hiện trạng hoặc ẩn sản phẩm.

## API

| Phương thức | Đường dẫn (sau `/api/v1`) | Chức năng |
| --- | --- | --- |
| POST | `/products/:productId/reports` | Gửi `{ reason, description }` |
| GET | `/product-reports/my` | Lịch sử của chính tài khoản; lọc `productId`, phân trang `page`, `limit` |
| GET | `/admin/product-reports` | Admin lọc `status`, `reason`, `productId`; phân trang |
| PATCH | `/admin/product-reports/:id/resolve` | Admin gửi `{ decision: "KEEP" hoặc "HIDE", note }` |
| PATCH | `/admin/product-reports/:id/reporter` | Admin gửi `{ action: "WARN", "BLOCK" hoặc "UNBLOCK", note, days? }` |

Lý do: `COUNTERFEIT`, `MISLEADING`, `PROHIBITED`, `INAPPROPRIATE`, `SPAM`, `OTHER`. Mô tả và ghi chú yêu cầu 10–1.000 ký tự sau khi bỏ khoảng trắng đầu/cuối. `BLOCK` yêu cầu `days` là số nguyên từ 1 đến 30. `KEEP` đóng báo cáo và giữ trạng thái hiện tại, không khôi phục sản phẩm đã ẩn.

## Chống spam và tính nhất quán

- Mỗi tài khoản có tối đa một báo cáo `OPEN` cho mỗi sản phẩm (unique partial index).
- Tối đa 3 báo cáo trong 10 phút và 10 báo cáo trong 24 giờ trượt, bao gồm báo cáo đã xử lý. Báo cáo lỗi hoặc trùng không chiếm hạn mức.
- Mỗi lần gửi khóa ghi trên tài khoản trong MongoDB transaction trước khi đếm, nên nhiều tab hoặc nhiều tiến trình API không vượt hạn mức.
- Admin có thể gửi nhắc nhở, tạm khóa riêng quyền báo cáo hoặc mở lại quyền đó. Việc khóa không đổi trạng thái tài khoản, không chặn mua hàng. Thời hạn khóa tự hết hiệu lực.
- Báo cáo không hợp lệ không tự động bị coi là spam. Admin cần căn cứ và ghi chú trước khi xử lý người gửi; toàn bộ thao tác có nhật ký.
- Báo cáo lưu ảnh chụp dữ liệu sản phẩm tại thời điểm gửi. Lịch sử vẫn còn khi sản phẩm đổi nội dung hoặc bị ẩn.
- Xử lý báo cáo, ẩn sản phẩm, nhật ký và notification outbox cùng một transaction. Xử lý lại hoặc hai admin xử lý đồng thời nhận `409`.
- Không ẩn sản phẩm `RESERVED`, `SOLD`, `ARCHIVED` hoặc đã xóa. Admin có thể đóng báo cáo bằng `KEEP` với ghi chú phù hợp.
- Thông báo cho người bán khi bị ẩn và người gửi khi có kết quả. Thông báo kiểm duyệt bắt buộc được giữ kể cả khi người dùng tắt thông báo thông thường. Hệ thống thử giao ngay sau commit; worker notification outbox hiện có sẽ thử lại khi lỗi.
- Admin không được xử lý báo cáo liên quan đến chính họ. Người bán không nhận danh tính người báo cáo.

## Chạy và kiểm tra

MongoDB cần replica set (như các chức năng đặt hàng hiện có). Cơ sở dữ liệu local đã hỗ trợ cấu hình này. Development tự tạo index; khi triển khai production (`autoIndex: false`), tạo index của model `ProductReport` trước khi mở chức năng, ví dụ `await require('./src/models/productReport.model').createIndexes()` trong script kết nối database. Chạy worker `npm run worker:notification-outbox` để xử lý lại thông báo chưa giao được.

```powershell
npm test -- --runInBand tests/productReport.test.js
```

Tại thư mục frontend:

```powershell
node scripts/verify-product-reports.mjs
```

Kiểm thử dùng MongoDB replica set tạm thời và trình duyệt Chrome; không tạo báo cáo hay khóa tài khoản trong dữ liệu thật.
