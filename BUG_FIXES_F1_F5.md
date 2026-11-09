# Bản sửa F1–F5 — 09/11/2026

## Thay đổi

| Mã | Hành vi sau bản sửa |
| --- | --- |
| F1 | Tác vụ chi trả lưu cursor trong `WorkerCursor`, đọc các lô theo `_id` tăng dần, giới hạn điểm cuối mỗi vòng quét và quay lại đơn chưa đủ điều kiện ở vòng tiếp theo. Hai tiến trình đồng thời không được ghi lùi cursor; payout và thông báo được lưu cùng transaction. Cơ chế admin duyệt/ghi nhận chuyển tiền được giữ nguyên. |
| F2 | Review/resolve khóa đơn bằng `settlementVersion`, chỉ cập nhật khiếu nại còn OPEN/UNDER_REVIEW. Quyết định, lịch sử và hai sự kiện thông báo cùng transaction. Yêu cầu xử lý sau khi đã chốt nhận HTTP 409; review cũ không thể mở lại kết quả. |
| F3 | Card, chat và trang tài nguyên mở `?view=detail&id=<productId>`. Chi tiết tải từ API khi truy cập trực tiếp, F5 hoặc quay lại/tiến tới. Có trạng thái đang tải, lỗi, thử lại và tiếp tục mua sắm; phản hồi cũ không ghi đè sản phẩm khác. Lỗi tải đánh giá không chặn nội dung sản phẩm. |
| F4 | Khi thay đổi bộ lọc, giao diện lập tức hiển thị đang tải và khóa phân trang cho đến khi truy vấn mới hoàn tất. Các request cũ bị hủy/bỏ qua; không thể gửi trang 2 với bộ lọc cũ rồi tự nhảy về trang 1. |
| F5 | Danh mục, số lượng kết quả và facets lọc người bán trước khi phân trang: chỉ tài khoản SELLER/ACTIVE và shop chưa bị khóa. Chi tiết trả 404 khi người bán/shop không còn công khai. Giỏ/yêu thích đánh dấu món đã lưu là không khả dụng; thêm mới và checkout cũng bị chặn. Tài khoản người bán cũ chưa có hồ sơ shop vẫn được hỗ trợ. |

Không cần di chuyển dữ liệu cũ. Cursor được tạo tự động khi tác vụ chạy lần đầu; không xóa cursor trong lúc worker đang hoạt động. Những đơn chưa được tạo khoản chi sẽ được xét trong các lô kế tiếp theo lịch tác vụ hiện có.

## Kiểm thử hồi quy

Kết quả cuối: **20 suites / 195 tests backend đạt**, lint backend đạt; Chrome regression và integration tổng thể đạt, không có lỗi runtime; frontend build đạt, lint không có lỗi (còn 2 cảnh báo Fast Refresh sẵn có trong AppContext/LanguageContext).

Trong backend:

```powershell
npm test -- --runTestsByPath tests/systemFixes.test.js
npm test
npm run lint
node scripts/auditSystemChecks.js
```

Probe backend sau bản sửa: 51 đơn đủ điều kiện → lượt đầu 50, lượt tiếp theo 1, không còn đơn bị bỏ sót; hai quyết định trái nhau → một thành công, một xung đột, lịch sử chỉ có một quyết định; sản phẩm của tài khoản bị khóa không xuất hiện trong danh mục.

Bộ hồi quy kiểm tra thêm 50 đơn chưa đủ điều kiện ở đầu hàng đợi, điều kiện thay đổi, đơn mới đến giữa vòng quét, hai worker chạy đồng thời, rollback khi lưu outbox lỗi, quyền admin, review/resolve đồng thời, payout/khiếu nại đồng thời và giỏ/yêu thích/checkout sau khóa shop. Các kiểm thử dùng MongoDB replica set tạm và nhà cung cấp thanh toán mô phỏng.

Trong `C:/sifit-prototype`:

```powershell
node scripts/audit-catalog-timing.mjs
npm run test:integration
npm run lint
npm run build
```

Kiểm thử Chrome xác nhận thao tác lọc/chuyển trang nhanh 3 lần đều giữ trang 2 với 3/23 sản phẩm, F5 không trống, mở link ở tab mới, quay lại/tiến tới, thiếu/sai ID, sản phẩm ẩn, người bán bị khóa, thử lại và API đánh giá lỗi. Kịch bản tích hợp tổng thể kiểm tra lại checkout nhiều shop, thanh toán mô phỏng, giao hàng, khiếu nại, chi trả, báo cáo và quyền truy cập.

Hạn mức IP được đặt lại giữa các tình huống trình duyệt trong ứng dụng kiểm thử tạm; cấu hình giới hạn API thực tế không thay đổi. Bộ kiểm thử không xác nhận việc chuyển tiền/ngân hàng thật hoặc cấu hình PayOS bên ngoài. Hoàn PayOS thủ công và xử lý ngoại lệ tiền vẫn là hạng mục riêng trong `SYSTEM_REVIEW.md`.
