# Tác vụ tự động

Khi chạy `npm start` hoặc `npm run dev`, backend kết nối MongoDB, mở API/Socket.IO rồi tự khởi động hai tác vụ độc lập. Không cần mở thêm terminal chạy worker.

| Tác vụ | Chu kỳ mặc định | Công việc |
| --- | --- | --- |
| `marketplace-maintenance` | 60 giây sau khi lượt trước kết thúc | Đối soát thanh toán PayOS, hủy đơn hết hạn đủ điều kiện, mở bán lại sản phẩm và đóng đề nghị giá hết hạn |
| `notification-outbox` | 15 giây sau khi lượt trước kết thúc | Giao thông báo đã lưu, thử lại lỗi tạm thời và phục hồi sự kiện bị kẹt |

Lượt đầu được lên lịch ngay khi API bắt đầu lắng nghe; khóa hoặc lịch còn lưu từ tiến trình trước vẫn được tôn trọng. Đây là xử lý theo batch, không cam kết hủy chính xác tới từng giây. Đơn đông, lỗi PayOS hoặc tồn đọng có thể cần thêm vài lượt.

## Cấu hình

Các giá trị sau đã có mặc định; chỉ cần thêm vào `.env` khi muốn thay đổi, rồi khởi động lại backend:

```dotenv
BACKGROUND_JOBS_ENABLED=true
BACKGROUND_MAINTENANCE_INTERVAL_SECONDS=60
BACKGROUND_NOTIFICATION_INTERVAL_SECONDS=15
BACKGROUND_JOB_BATCH_SIZE=20
NOTIFICATION_OUTBOX_BATCH_SIZE=100
NOTIFICATION_OUTBOX_RETRY_LIMIT=5
```

Khoảng chạy chấp nhận 5–3.600 giây; batch bảo trì 1–1.000. Không đặt chu kỳ quá ngắn với PayOS vì có giới hạn truy cập API. `BACKGROUND_JOBS_ENABLED=false` tắt lịch trong API; môi trường test mặc định tắt, bộ kiểm thử lịch mới bật riêng trên database tạm.

## Hủy đơn và bảo vệ thanh toán

- Chỉ nhóm đơn `PENDING_PAYMENT`, `UNPAID`, đã qua `reservationExpiresAt` mới được xét hủy. Đơn đã thanh toán hoặc chưa đến hạn được giữ nguyên.
- Với mọi lần thanh toán PayOS gắn với nhóm đơn, backend truy vấn kênh thanh toán. Chỉ phản hồi kết thúc và chưa nhận tiền mới đủ điều kiện mở bán lại. PayOS chưa kết nối được, còn `PENDING`, đang tạo link hoặc trả dữ liệu không khớp thì giữ hàng và thử lại sau.
- Tiền nhận thiếu, nhận muộn hoặc khoản có dấu hiệu cần đối soát không tự động làm đơn thành công và không tự mở bán lại hàng. Tiền xác minh được vẫn được lưu qua luồng biên nhận/sổ cái hiện có; admin kiểm tra các khoản `requiresReview`. Quy tắc nhận tiền ngoài hạn vẫn giữ như trước.
- Timer cục bộ không tự đánh dấu PayOS hết hạn khi truy vấn thất bại. Đồng hồ giao diện không quyết định trạng thái tiền.
- Ngay trước khi hủy, MongoDB transaction khóa và đọc lại nhóm đơn, các lần thanh toán và biên nhận. Nếu webhook hoặc một lần tạo thanh toán khác ghi đồng thời, transaction sẽ thử lại trên dữ liệu mới.
- Hủy nhóm đơn, các đơn con, hết hạn lần thanh toán, chuyển sản phẩm `RESERVED` về `ACTIVE` và ghi thông báo cho người mua/người bán cùng commit hoặc cùng rollback.
- Lỗi ở một nhóm đơn không chặn việc xét những nhóm còn lại. Nhóm bị trì hoãn được đặt thời gian thử lại để tránh chiếm toàn bộ batch.

PayOS mô tả các trường trạng thái, số tiền đã nhận và lịch sử giao dịch trong [API lấy thông tin link thanh toán](https://payos.vn/docs/api/).

## Khóa, phục hồi và vận hành

Mỗi tác vụ có một bản ghi trong collection `backgroundjobs`, dùng `_id` duy nhất. Các tiến trình API chung database nhận việc bằng thao tác nguyên tử; một tác vụ chưa xong hoặc chưa đến lịch không được nhận lại. Lease mặc định 3 phút, gia hạn mỗi phút khi đang chạy. Nếu tiến trình bị dừng đột ngột, tiến trình khác nhận lại sau khi lease hết hạn. Các luồng xử lý từng đơn/sự kiện vẫn có cơ chế chống xử lý trùng riêng.

Khi nhận `SIGINT`/`SIGTERM`, backend hủy lịch tương lai, chờ lượt đang chạy kết thúc rồi đóng Socket.IO, HTTP và MongoDB. Khi máy hoặc backend tắt, không có tiến trình xử lý; lần khởi động tiếp theo tiếp tục quét dữ liệu tồn đọng. Khi triển khai, cần giữ backend chạy bằng trình quản lý dịch vụ của môi trường triển khai.

`backgroundjobs` lưu `lastStartedAt`, `lastFinishedAt`, `lastSucceededAt`, `nextRunAt`, `runCount`, `failureCount`, `lastResult` và loại lỗi gần nhất. Không lưu nguyên văn lỗi nhà cung cấp có thể chứa khóa hoặc dữ liệu riêng tư. Kết quả bảo trì có `failedCount`/`deferredCount` để nhận biết nhóm cần thử lại dù cả batch đã hoàn tất. Có thể kiểm tra trong MongoDB Compass; không có API công khai cho thông tin vận hành này.

Các lệnh một lần `npm run worker:expire-reservations`, `npm run worker:reconcile-payments`, `npm run worker:notification-outbox` vẫn dùng được khi cần xử lý thủ công. Thông báo hết số lần thử giữ lại trong outbox để vận hành kiểm tra; không tự xóa lịch sử.

Không tự hoàn thành đơn, hoàn tiền, phê duyệt hay chuyển tiền cho người bán. Các thao tác admin và luồng đối soát đã có vẫn được giữ.

## Kiểm tra

```sh
npm run lint
npm test
```

`tests/backgroundScheduler.test.js` kiểm tra chu kỳ, tác vụ chậm, lỗi, tính độc lập và dừng lịch. `tests/backgroundJobs.test.js` dùng MongoDB replica set tạm để kiểm tra hủy đơn/trả kho, thông báo, rollback, lease và hai tiến trình API thật cùng khởi động/tắt. `tests/payosWorkflow.test.js` kiểm tra PayOS hết hạn, mất kết nối, nhận thiếu/nhận muộn và cạnh tranh trạng thái. Các kiểm thử không sử dụng tiền hay dữ liệu development.
