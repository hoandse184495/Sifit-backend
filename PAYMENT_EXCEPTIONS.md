# Đối soát thanh toán PayOS bất thường

## Cách sử dụng

Admin mở **Tài chính → Thanh toán bất thường → Xem và xử lý đối soát**. Hồ sơ hiển thị số phải thu, biên nhận ngân hàng đã xác minh, tiền đã phân bổ cho đơn, tiền đang giữ hoàn, tiền đã hoàn và số còn có thể xử lý. Danh sách có phân trang và lọc trạng thái; mặc định chỉ hiện hồ sơ chưa xử lý xong.

Ba hướng xử lý:

1. **Chờ người mua bổ sung tiền**: chỉ áp dụng cho đơn chưa đủ tiền và hàng vẫn đang được giữ. Admin ghi hướng dẫn cụ thể; người mua nhận thông báo, xem số còn thiếu và lịch sử. Nếu tiền bổ sung được xác minh, đủ đúng tổng và đơn còn hợp lệ thì hệ thống phân bổ tự động. Quyết định này không gia hạn thời gian giữ hàng.
2. **Tiếp tục đơn sau khi kiểm tra hàng**: admin xác nhận hàng còn sẵn và người mua đồng ý tiếp tục. Hệ thống kiểm tra lại toàn bộ sản phẩm, người bán, đơn và số tiền trong transaction. Có thể tiếp tục đơn đã hết hạn/hủy nếu hàng thực sự còn sẵn; không lấy hàng đã bán hoặc đang giữ cho đơn khác. Chỉ phân bổ đúng tổng đơn; tiền dư vẫn ở hàng đợi.
3. **Lập khoản hoàn tiền chưa phân bổ**: hệ thống tính toàn bộ số dư có thể hoàn từ biên nhận, không nhận số tiền do trình duyệt tự chọn. Người mua gửi ngân hàng, admin duyệt tài khoản, chuyển khoản ngoài ứng dụng, tải chứng từ và ghi nhận hoàn tất theo [MANUAL_REFUNDS.md](MANUAL_REFUNDS.md). Đơn đang chờ và chưa được thanh toán sẽ bị hủy, giải phóng phần hàng thuộc chính đơn đó. Đơn đã trả tiền tiếp tục được giữ nguyên.

Nút **Truy vấn lại PayOS** chỉ đọc dữ liệu thanh toán từ PayOS rồi đưa biên nhận qua cùng bộ xác minh/đối soát. Không tự đổi trạng thái thành đã trả tiền từ dữ liệu trình duyệt. Có giới hạn truy vấn lại theo từng thanh toán.

Người mua mở thông báo thanh toán hoặc nút **Theo dõi đối soát thanh toán**; có thể xem số tiền, biên nhận, hướng dẫn, lịch sử và khoản hoàn. Chỉ admin được ra quyết định; admin có liên quan với tư cách người mua/người bán của đơn không được xử lý tiền đó.

## Phân biệt tiền đơn và tiền chưa phân bổ

Ví dụ đơn 100.000đ, người bán nhận 90.000đ và hoa hồng 10.000đ:

- Ngân hàng nhận 120.000đ. Admin tiếp tục đơn: chỉ 100.000đ được phân bổ, 20.000đ còn chờ xử lý.
- Lập và hoàn 20.000đ dư: người bán vẫn nhận 90.000đ, hoa hồng vẫn 10.000đ. `Payment.refundedAmount` (tiền hàng đã hoàn) vẫn bằng 0.
- Nếu chỉ nhận 30.000đ và hủy/hoàn trước khi phân bổ: hoàn đúng 30.000đ. Không tạo khoản chi hay hoa hồng cho đơn chưa được thanh toán.

`Refund.kind=MANUAL_BANK` dùng cho tiền đã phân bổ theo đơn; `RECEIPT_ADJUSTMENT` dùng cho tiền chưa phân bổ theo thanh toán, không có `orderId`. Khoản hoàn chênh lệch giữ danh sách người bán liên quan để kiểm tra admin độc lập. Cả hai dùng chung quy trình ngân hàng/chứng từ riêng tư và sổ đăng ký mã chuyển khoản chống trùng.

Các số dư được kiểm tra bằng tiền VND nguyên:

```text
chưa phân bổ = tổng biên nhận MATCHED - tổng đã phân bổ - tổng đã hoàn chênh lệch
có thể xử lý = chưa phân bổ - đang giữ để hoàn chênh lệch
```

`Payment.exceptionRefundReservedAmount` giữ tiền cho khoản hoàn REQUESTED/PENDING/APPROVED. `exceptionRefundedAmount` chỉ tăng sau khi admin ghi nhận chuyển khoản hoàn tất. Không dùng các bộ đếm tiền hàng `refundReservedAmount/refundedAmount` cho tiền dư.

Sổ cái ghi nhận tiền vào tài khoản `customer_funds_unallocated`; lúc tiếp tục đơn mới chuyển đúng tổng đơn sang nghĩa vụ trả người bán và hoa hồng. Hoàn chênh lệch chỉ ghi nợ `customer_funds_unallocated`, ghi có `provider_clearing`. Không giảm Commission, SellerPayout hoặc trạng thái thanh toán của đơn đã trả tiền, kể cả người bán đã nhận tiền hàng.

## Trạng thái và an toàn cạnh tranh

| Trạng thái | Ý nghĩa |
| --- | --- |
| NONE | Chưa có hồ sơ đối soát thủ công |
| OPEN | Có tiền chưa phân bổ cần admin kiểm tra |
| WAITING_TOPUP | Admin hướng dẫn bổ sung cho đơn đang giữ hàng |
| REFUND_PENDING | Có khoản hoàn tiền chưa phân bổ đang chờ chuyển |
| RESOLVED | Tiền đã phân bổ/hoàn hết, không còn khoản hoàn chờ |

- Webhook vẫn xác minh chữ ký, khớp mã thanh toán, lưu biên nhận chống trùng và ghi sổ cái như luồng hiện có. Webhook sai chữ ký không tạo hồ sơ đối soát.
- Biên nhận mới làm tăng `reviewVersion`. Quyết định phải gửi `expectedVersion`; hồ sơ đã thay đổi trả 409 và yêu cầu tải lại, tránh dùng số dư cũ.
- Quyết định dùng UUID `idempotencyKey`; gửi lại cùng nội dung trả kết quả trước, cùng khóa nhưng khác quyết định bị từ chối. Các thao tác đồng thời khóa Payment/CheckoutGroup/Order cùng transaction, kiểm tra quyền giữ sản phẩm bằng `reservationGroupId`.
- Khi đã lựa chọn hoàn tiền, khoản nhận thêm không tự bật lại đơn hoặc dùng phần đang giữ hoàn để thanh toán. Hoàn xong mà vẫn còn tiền mới thì hồ sơ trở lại OPEN.
- Hủy một khoản hoàn chưa duyệt giải phóng số tiền đang giữ, lưu lịch sử và mở lại hồ sơ; không tự khôi phục đơn đã hủy.
- Quyết định, tài chính, lịch sử bất biến, audit và notification outbox cùng transaction. Lỗi ghi outbox/sổ cái/chứng từ không được để lại thay đổi tiền hoặc kho một phần.
- Hồ sơ RESOLVED rời danh sách mặc định nhưng vẫn truy cập bằng bộ lọc/lịch sử và đường dẫn đã lưu. Tiền mới về sau đó mở lại hồ sơ.

Đây là hoàn tiền chuyển khoản có admin xác nhận; không tự chuyển tiền qua ngân hàng. Thu hồi tiền hàng đã chi cho người bán vẫn cần quy trình riêng. Bản này không tự đăng bán lại món hàng đã trả hoặc thay thế quy trình xác minh giao/nhận hàng.

## API

| Phương thức và đường dẫn | Mục đích |
| --- | --- |
| GET /api/v1/admin/payment-exceptions | Admin phân trang/lọc `status` |
| GET /api/v1/payments/:id/review | Admin hoặc người mua sở hữu xem hồ sơ |
| POST /api/v1/admin/payment-exceptions/:id/decisions | `action`, `expectedVersion`, UUID `idempotencyKey`, `note`; ACCEPT_PAYMENT cần `confirmStock=true` |
| POST /api/v1/admin/payment-exceptions/:id/recheck | Đọc lại biên nhận PayOS và lưu lịch sử |
| GET /api/v1/admin/manual-refunds?paymentId=:id | Khoản hoàn theo thanh toán, gồm chênh lệch |

`action`: WAIT_TOPUP, ACCEPT_PAYMENT, REFUND_UNALLOCATED. Các API duyệt khoản hoàn, cập nhật ngân hàng và tải chứng từ giữ nguyên ở tài liệu hoàn tiền.

## Kiểm thử

Backend: **23 suites, 261 tests đạt**, trong đó **25 tests** cho ngoại lệ thanh toán; lint đạt. Chrome chạy trọn luồng ngoại lệ và integration tổng thể đều đạt, không có lỗi runtime; giao diện desktop/mobile đã được kiểm tra. Frontend build đạt, lint không có lỗi; còn hai cảnh báo Fast Refresh sẵn có ở AppContext/LanguageContext.

```powershell
# C:/Sifit-backend
npm test
npm run lint
npm test -- --runTestsByPath tests/paymentExceptions.test.js

# C:/sifit-prototype
npm run test:payment-exceptions
npm run test:integration
npm run lint
npm run build
```

Các test cô lập MongoDB replica set tạm, PayOS SDK dùng khóa giả, không gọi ngân hàng/PayOS bên ngoài. Kiểm thử backend bao gồm tiền thiếu/dư/đến muộn, nhiều lần thanh toán, nhận thêm sau chi trả, giả mạo webhook, quyết định dùng số dư cũ, hai admin đồng thời, chống ghi trùng, giữ kho giữa hai checkout, lỗi rollback và truy vấn lại nhà cung cấp được mock.

Script Chrome dùng webhook có chữ ký thật với khóa giả, đăng nhập buyer/admin, phân bổ tiền đơn, lập và hoàn phần dư có chứng từ, theo dõi thông báo, tải lại trang, tải chứng từ, lọc lịch sử và giao diện 390px/desktop. Ảnh kiểm thử lưu ở `C:/sifit-prototype/artifacts/payment-exceptions`.
