# Hoàn tiền PayOS bằng chuyển khoản có kiểm soát

## Cách sử dụng

1. Admin vào **Tài chính → Giao dịch thanh toán → Tạo yêu cầu hoàn tiền**. Chọn đúng đơn thuộc giao dịch, số tiền và lý do. Có thể đi từ khiếu nại đã chấp nhận bên mua bằng nút **Xử lý hoàn tiền cho đơn này**.
2. Người mua mở thông báo hoặc **Đơn mua → Xem khoản hoàn và tài khoản nhận tiền**, chọn ngân hàng, nhập số tài khoản/chủ tài khoản và xác nhận thông tin.
3. Admin vào **Tài chính → Hoàn tiền người mua → Chi tiết và xử lý hoàn tiền**, kiểm tra tài khoản rồi duyệt. Thông tin nhận tiền được chụp vào `bankSnapshot` và không thể bị người mua sửa sau khi duyệt. Nếu người mua đã sửa thông tin trong lúc admin đang xem, yêu cầu duyệt trả 409; dùng **Tải lại thông tin hoàn tiền** để kiểm tra bản mới.
4. Admin chuyển khoản ngoài ứng dụng đến đúng tài khoản đã chốt, tải ảnh chứng từ, nhập mã giao dịch, thời gian và ghi chú đối chiếu; đánh dấu đã kiểm tra rồi **Ghi nhận đã hoàn tiền**.
5. Hệ thống cập nhật tiền hoàn, đơn, hoa hồng, khoản chi còn lại, sổ cái, lịch sử và thông báo. Người mua xem/tải chứng từ qua chi tiết khoản hoàn.

Ứng dụng không thực hiện chuyển khoản ngân hàng thay admin. Việc duyệt/lưu chứng từ chưa làm tiền chuyển đi; chỉ lần ghi nhận hoàn tất mới tăng `refundedAmount` và ghi bút toán chi tiền. Kiểm thử không chuyển tiền thật và không gọi API thu/hoàn PayOS.

## Trạng thái và dữ liệu

| Trạng thái | Ý nghĩa |
| --- | --- |
| REQUESTED | Admin đã xác định số tiền cần hoàn, chờ người mua cung cấp tài khoản |
| PENDING | Người mua đã gửi tài khoản, chờ admin kiểm tra |
| APPROVED | Tài khoản đã chốt, chờ chuyển khoản và ghi nhận chứng từ |
| SUCCEEDED | Admin đã xác nhận chuyển khoản thực tế, tài chính đã cập nhật |
| CANCELLED | Admin hủy trước bước duyệt chuyển khoản; tiền giữ hoàn được giải phóng |

Có thể yêu cầu sửa tài khoản ở PENDING/APPROVED khi chưa có chứng từ và admin xác nhận chưa chuyển tiền. Yêu cầu này xóa thông tin nhận tiền đã chốt và quay về REQUESTED. Không cho đổi tài khoản/hủy tùy ý sau khi có chứng từ hoặc đã hoàn tất.

Khoản hoàn tiền hàng `kind=MANUAL_BANK` thuộc một `orderId`, `paymentId`, người mua và shop cụ thể. Tại một thời điểm chỉ có một khoản hoàn đang xử lý trên mỗi đơn. `Payment.refundReservedAmount` và `Order.refundPendingAmount` giữ phần tiền chờ hoàn; không tính nó thành tiền đã chi. Khi tạo, duyệt và ghi nhận phải có thanh toán PayOS thành công, biên nhận ngân hàng MATCHED sau trừ tiền chênh lệch đã hoàn đủ đúng tổng đơn, không có ngoại lệ đối soát và chưa duyệt/chi trả tiền cho người bán.

Khoản hoàn tiền chưa phân bổ `kind=RECEIPT_ADJUSTMENT` được tạo từ **Tài chính → Thanh toán bất thường**, gắn với payment/người mua, không có `orderId`. Luồng ngân hàng/chứng từ dùng chung, nhưng số dư giữ/đã hoàn nằm trong `exceptionRefundReservedAmount/exceptionRefundedAmount`, không điều chỉnh tiền hàng, hoa hồng hay khoản chi người bán. Chi tiết và ví dụ tại [PAYMENT_EXCEPTIONS.md](PAYMENT_EXCEPTIONS.md).

Nếu quyết định khiếu nại yêu cầu trả hàng, phải hoàn thành bước admin xác minh nhận lại ở [quy trình trả hàng](DISPUTE_RETURNS.md). Kiểm tra này được áp dụng cả lúc tạo khoản hoàn, duyệt tài khoản và ghi nhận chuyển tiền; xác nhận của riêng người bán chưa mở khóa hoàn tiền.

Hoàn tiền theo khiếu nại phải liên kết quyết định RESOLVED_BUYER chưa được hoàn; khi ghi nhận xong, lưu `Dispute.refundSettledAt` và `refundId`. Nếu đơn còn trong quá trình xem xét khiếu nại, phải chốt quyết định trước.

## Phân bổ và chống ghi trùng

- Khóa payment/refund/order và cập nhật tất cả dữ liệu trong MongoDB transaction. Cả duyệt chi trả và ghi nhận chi trả dùng khóa đơn tương ứng để không chạy xuyên qua khoản hoàn đang giữ.
- So sánh giới hạn hoàn ở cả từng đơn và thanh toán; số tiền phải là VND nguyên. Hoàn một phần theo số lũy kế, phân bổ tiền hàng/hoa hồng/phí vận chuyển bằng phép tính số nguyên, tránh sai số khi nhiều lần hoàn nhỏ. Snapshot giá/hoa hồng ban đầu của Order được giữ; Commission lưu số tiền còn lại và các phần đã hoàn.
- Khoản chi chưa duyệt được giảm theo tiền người bán đã hoàn. Hoàn toàn bộ một đơn loại đơn đó khỏi khoản chi gộp; nếu không còn số dư thì hủy khoản chi. Các đơn khác trong cùng lần thanh toán tiếp tục được xét bình thường. Khoản chi APPROVED/PROCESSING/PAID cần quy trình thu hồi/đối soát riêng trước khi hoàn.
- Mã yêu cầu tạo khoản hoàn có idempotency key; ghi nhận giao dịch cùng nội dung được trả lại kết quả cũ. Mã chuyển khoản được chuẩn hóa và giữ trong `OutgoingBankTransfer`, chống dùng lại giữa hoàn tiền và chi trả người bán, kể cả khác chữ hoa/thường. Những mã chi đã ghi từ trước bản cập nhật cũng được đối chiếu.
- Bút toán hoàn chỉ phát sinh khi hoàn tất: giảm nghĩa vụ trả người bán/hoa hồng chờ ghi nhận/phí giao hàng tương ứng và giảm tiền ở `provider_clearing`. Bút toán cân bằng và có khóa sự kiện duy nhất. Outbox và audit được ghi cùng transaction; lỗi ở bất kỳ bước nào sẽ rollback.

Ngoại lệ tiền thu được xử lý qua [hàng đợi đối soát](PAYMENT_EXCEPTIONS.md), không sửa tay trạng thái. Khoản hoàn cũ chưa phân bổ theo đơn vẫn cần kiểm tra riêng. Thu hồi tiền hàng đã chuyển cho người bán chưa thuộc luồng này. Không tự đưa hàng đã bán trở lại kho khi hoàn tiền vì cần xác minh hàng đã được trả lại.

## Riêng tư và chứng từ

Chỉ admin và người mua sở hữu khoản hoàn được truy cập chi tiết. Người bán nhận thông báo/số tiền điều chỉnh trên đơn, không được truy cập tài khoản nhận hoàn hay chứng từ. Không đưa ngân hàng/chứng từ vào dữ liệu tóm tắt của danh sách đơn.

Ảnh JPEG/PNG/WebP tối đa 5 MB, kiểm tra chữ ký loại tệp và giới hạn đúng một tệp. Dữ liệu được lưu trong `RefundProof` ở MongoDB, không có URL công khai; tệp không được nạp trong truy vấn mặc định. API tải có kiểm tra quyền, `Cache-Control: private, no-store`, trả dạng attachment. Người mua chỉ tải được sau khi đã hoàn tất. Hash SHA-256 của chứng từ gắn với khoản hoàn; không âm thầm thay ảnh đã lưu.

Danh sách ngân hàng trên giao diện được lấy từ [API công khai VietQR](https://api.vietqr.io/v2/banks), lưu tại `src/data/refundBanks.json` trong frontend để không phụ thuộc mạng khi mở biểu mẫu. Chỉ xác nhận thông tin người mua cung cấp và admin kiểm tra; không xác minh tự động tên chủ tài khoản với ngân hàng.

## API chính

| Phương thức và đường dẫn | Quyền / mục đích |
| --- | --- |
| GET /api/v1/admin/manual-refunds/payment/:id/context | Admin lấy các đơn/khiếu nại có thể liên kết trong thanh toán |
| POST /api/v1/admin/manual-refunds | Admin tạo: paymentId, orderId, amount, reason, idempotencyKey, disputeId tùy chọn |
| GET /api/v1/admin/manual-refunds | Admin phân trang/lọc trạng thái |
| GET /api/v1/refunds | Người mua xem khoản hoàn của mình; admin xem tất cả. Có lọc orderId/status và phân trang |
| GET /api/v1/refunds/:id | Người mua sở hữu hoặc admin xem chi tiết |
| PUT /api/v1/refunds/:id/bank | Người mua gửi bankName, bankBin, accountNumber, accountName, ownsAccount=true |
| POST /api/v1/admin/manual-refunds/:id/approve | Admin duyệt với expectedVersion lấy từ __v của bản chi tiết đã kiểm tra |
| POST /api/v1/admin/manual-refunds/:id/request-bank-correction | Admin yêu cầu sửa: note, notTransferred=true |
| POST /api/v1/admin/manual-refunds/:id/cancel | Admin hủy khoản chưa duyệt, bắt buộc note |
| POST /api/v1/admin/manual-refunds/:id/proof | Admin multipart, trường proof |
| POST /api/v1/admin/manual-refunds/:id/record-transfer | Admin ghi nhận: amount, reference, transferredAt (ISO), note, transferred=true |
| GET /api/v1/refunds/:id/proof | Tải chứng từ riêng tư |

Endpoint cũ `/admin/refunds` vẫn dành cho nhà cung cấp mô phỏng. Luồng PayOS mới dùng `/admin/manual-refunds`; không gọi `PayosProvider.refundPayment()`.

## Kiểm thử

Kết quả ở bản hoàn tiền ban đầu: **21 suites / 216 tests backend đạt**, gồm 21 test chuyên biệt cho hoàn tiền thủ công. Lint backend đạt. Luồng Chrome hoàn tiền và integration tổng thể đạt, không có lỗi runtime. Frontend build đạt, lint không có lỗi; còn 2 cảnh báo Fast Refresh sẵn có trong AppContext/LanguageContext. Bản bổ sung trả hàng có kết quả kiểm tra mới nhất tại [DISPUTE_RETURNS.md](DISPUTE_RETURNS.md).

Backend:

```powershell
npm run lint
npm test
npm test -- --runTestsByPath tests/manualRefund.test.js
```

Frontend:

```powershell
npm run test:refunds
npm run test:integration
npm run lint
npm run build
```

Các test dùng MongoDB replica set tạm và API thật; khóa PayOS rỗng, không gửi/chuyển tiền thật. Bộ browser test có đăng nhập thật, thông báo, nhập ngân hàng, khóa tài khoản đã duyệt, upload/download chứng từ, reload, đối chiếu số tiền/hoa hồng, ảnh desktop/mobile và kiểm tra lỗi runtime. Ảnh nằm trong `C:/sifit-prototype/artifacts/refunds`.
