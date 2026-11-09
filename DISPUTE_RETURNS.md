# Bằng chứng khiếu nại và trả hàng trước hoàn tiền

## Cách sử dụng

1. Người mua mở khiếu nại trong **Đơn mua & giỏ hàng → Đơn mua**. Sau khi gửi, chọn **Bổ sung bằng chứng và theo dõi trả hàng**. Cũng có thể mở từ mục Khiếu nại hoặc thông báo.
2. Người mua/người bán gửi ảnh và phản hồi trong hồ sơ. Người bán mở **Khiếu nại → Xem chi tiết**. Admin mở **Khiếu nại → Chi tiết, bằng chứng và trả hàng** để xem nội dung của hai bên.
3. Admin chọn kết quả trong hồ sơ. Nếu chấp nhận bên mua, chọn **Hoàn tiền trực tiếp** hoặc **Yêu cầu trả hàng trước khi hoàn tiền**. Trường hợp trả hàng phải có địa chỉ nhận đã xác nhận với người bán, hướng dẫn đóng gói/gửi trả, bên chịu phí và hạn gửi.
4. Người mua đặt vận chuyển bên ngoài, khai báo vận đơn và bổ sung biên nhận ở loại **Bằng chứng gửi trả**. Người bán kiểm tra rồi xác nhận đã nhận lại hàng.
5. Admin đối chiếu vận đơn/bằng chứng và xác minh việc nhận lại. Chỉ sau bước này, nút xử lý hoàn trong danh sách khiếu nại mới mở luồng [hoàn tiền hiện có](MANUAL_REFUNDS.md).

Nút **Chấp nhận bên mua** ở danh sách admin vẫn áp dụng hoàn trực tiếp, không yêu cầu trả hàng, và có mô tả rõ trên giao diện. Để yêu cầu trả hàng, dùng biểu mẫu quyết định trong hồ sơ chi tiết. Không có chuyển tiền tự động từ quyết định khiếu nại hay việc xác minh trả hàng.

## Trạng thái

Kết quả khiếu nại vẫn dùng OPEN/UNDER_REVIEW/RESOLVED_BUYER/RESOLVED_SELLER/CLOSED. Tiến độ trả hàng được lưu riêng trong `returnFlow`:

| Trạng thái trả hàng | Ý nghĩa |
| --- | --- |
| NOT_REQUIRED | Không yêu cầu trả hàng |
| AWAITING_SHIPMENT | Admin đã yêu cầu trả, chờ người mua khai báo gửi |
| SHIPPED | Người mua đã nhập vận đơn gửi trả |
| SELLER_RECEIVED | Người bán xác nhận nhận lại, chờ admin kiểm tra |
| VERIFIED | Admin độc lập đã kiểm tra việc nhận lại; có thể tiếp tục duyệt hoàn tiền |

Chỉ yêu cầu trả hàng khi đơn đã được ghi nhận giao/nhận. Hạn gửi do admin đặt, phải ở tương lai và tối đa 90 ngày; giao diện gợi ý 7 ngày. Quá hạn chỉ hiển thị cảnh báo để admin xem xét, không tự tước quyền khiếu nại, hoàn tiền hay chi trả.

Người mua có thể sửa vận đơn trước khi người bán xác nhận nhận lại, tối đa 10 lần ghi/cập nhật. Các lần gửi lại cùng nội dung không nhân đôi lịch sử. Sau nhận lại/xác minh, vận đơn được khóa. Quyết định khiếu nại và xác minh cuối không bị ghi đè bởi thao tác đến sau.

Nếu người bán chưa xác nhận, admin có thể xử lý ngoại lệ ở bước SHIPPED: phải chọn rõ việc kiểm tra thay xác nhận của người bán, có ảnh thuộc loại RETURN_SHIPPING/RETURN_RECEIPT và ghi căn cứ ít nhất 30 ký tự. Hệ thống lưu admin, thời điểm, nội dung và cờ ngoại lệ trong hồ sơ, audit và thông báo. Đây là kiểm tra thủ công, không phải API vận chuyển xác nhận tự động.

## Ảnh và phản hồi riêng tư

- Ảnh JPEG/PNG/WebP tối đa 5 MB, kiểm tra chữ ký định dạng. Mỗi người gửi tối đa 10 ảnh sản phẩm; cả hồ sơ tối đa 20 ảnh sản phẩm.
- Khi có yêu cầu trả, mở thêm hạn mức riêng: tối đa 5 ảnh trả hàng/người gửi và 10 ảnh trả hàng/hồ sơ. Tổng tối đa 30 ảnh. Việc gửi đủ ảnh sản phẩm không làm mất chỗ cho biên nhận trả hàng.
- Ảnh lưu ở `DisputeEvidence` trong MongoDB, trường nhị phân bị loại khỏi truy vấn mặc định. Không có URL ảnh công khai. Chỉ người mua/người bán của hồ sơ và admin được xem/tải, kể cả sau khi hồ sơ đã chốt. API tải trả attachment và `Cache-Control: private, no-store`.
- Kiểm tra quyền sở hữu hồ sơ trước khi nhận multipart vào bộ nhớ. ID tệp phải thuộc đúng hồ sơ. Tên tải xuống được tạo bởi hệ thống; không dùng tên tệp người dùng cung cấp.
- Ảnh có người gửi/vai trò, mô tả, loại, thời điểm và SHA-256. Cùng người gửi tải lại cùng ảnh/nội dung nhận lại bản đã lưu; đổi mô tả/loại cho một ảnh đã có trả xung đột. Không sửa/xóa ảnh đã dùng làm bằng chứng.
- `DisputeMessage` lưu phản hồi bất biến, có người gửi/vai trò/thời điểm. Có phân trang; mỗi người tối đa 20 phản hồi/24 giờ và mỗi hồ sơ tối đa 100 phản hồi. Idempotency key chống nhân đôi khi gửi lại.
- Cho bổ sung khi còn OPEN/UNDER_REVIEW hoặc đang trả hàng chưa được admin xác minh. Sau khi chốt các bước tương ứng, giao diện chuyển nội dung sang chỉ đọc. Các chuỗi `evidence` cũ được giữ và hiển thị dưới dạng tham chiếu văn bản; hệ thống không tự truy cập URL bên ngoài để nhập ảnh cũ.

## Chốt quyết định và an toàn tài chính

`contentVersion` tăng khi có phản hồi, ảnh, ghi chú review, quyết định hoặc cập nhật trả hàng. Giao diện gửi `expectedVersion` khi admin chốt và khi xác nhận các mốc trả hàng. Nếu có cập nhật mới, API trả 409; dùng **Tải lại hồ sơ khiếu nại** để đọc bản mới. Biểu mẫu cũng bỏ dấu xác nhận khi phiên bản hồ sơ thay đổi.

Yêu cầu quyết định cũ không có phiên bản vẫn tương thích cho hồ sơ chưa có ảnh/phản hồi mới; nếu hồ sơ có nội dung mới hoặc yêu cầu trả hàng thì bắt buộc dùng phiên bản đã kiểm tra. Các quyết định trái nhau vẫn chỉ có một kết quả thành công.

Các thao tác ghi khóa Order bằng `settlementVersion`, cập nhật hồ sơ/tệp/phản hồi/lịch sử và outbox trong cùng MongoDB transaction. Tác vụ lỗi sẽ rollback; các bên nhận thông báo dẫn tới hồ sơ riêng tư. Admin liên quan trực tiếp tới đơn không được ra quyết định hoặc xác minh trả hàng cho đơn đó.

`assertReturnSatisfied` được gọi ở cả tạo khoản hoàn, duyệt tài khoản nhận hoàn và ghi nhận chuyển tiền, đồng thời ở endpoint hoàn nhà cung cấp cũ. Không thể bỏ `disputeId` hoặc dùng endpoint hoàn cũ để vượt bước trả hàng. Mốc người bán nhận lại vẫn chưa đủ: phải có trạng thái VERIFIED và admin xác minh. Quyết định chấp nhận bên mua tiếp tục giữ khoản chi cho người bán cho đến khi khoản hoàn liên quan được ghi nhận hoàn tất.

Không mở khiếu nại trùng trong lúc một quyết định chấp nhận bên mua còn chờ xử lý tiền/trả hàng. Không tự đưa sản phẩm đã bán về kho hay đăng bán lại khi trả hàng; việc kiểm tra hàng/đăng bán lại là bước riêng.

## API

| API | Mục đích |
| --- | --- |
| GET /api/v1/disputes/:id/messages | Phân trang phản hồi, riêng tư |
| POST /api/v1/disputes/:id/messages | Gửi body và idempotencyKey |
| GET /api/v1/disputes/:id/evidence | Metadata ảnh, không có dữ liệu nhị phân |
| POST /api/v1/disputes/:id/evidence | Multipart: evidence, caption, category |
| GET /api/v1/disputes/:id/evidence/:fileId | Tải ảnh có xác thực và kiểm tra hồ sơ |
| PATCH /api/v1/admin/disputes/:id/resolve | status, resolution, expectedVersion; returnRequired/returnDetails khi cần trả |
| POST /api/v1/disputes/:id/return-shipment | Người mua gửi carrierName, trackingNumber, shippedAt, note, expectedVersion; trackingUrl HTTPS tùy chọn |
| POST /api/v1/disputes/:id/return-receipt | Người bán xác nhận với note, expectedVersion |
| POST /api/v1/admin/disputes/:id/verify-return | Admin xác minh với note, expectedVersion, overrideSellerConfirmation |

`returnDetails`: `address` (recipientName, phone, addressLine, ward, province), `instructions`, `shippingPayer` (BUYER/SELLER), `shipBy` (ISO). `category`: GENERAL/RETURN_SHIPPING/RETURN_RECEIPT. API role và quyền sở hữu được kiểm tra trên server.

## Chạy kiểm thử

Kết quả cuối: **22 suites / 236 test backend đạt**, gồm 20 test chuyên biệt cho bằng chứng/trả hàng. Lint backend đạt. Kiểm thử Chrome luồng mới và integration tổng thể đạt, không có lỗi runtime; frontend build đạt và lint không có lỗi (còn 2 cảnh báo Fast Refresh sẵn có ở AppContext/LanguageContext).

Backend:

```powershell
npm test -- --runTestsByPath tests/disputeCase.test.js
npm test
npm run lint
```

Frontend:

```powershell
npm run test:returns
npm run test:integration
npm run lint
npm run build
```

20 test chuyên biệt kiểm tra quyền xem ảnh, MIME/kích thước, retry, hạn mức riêng cho bằng chứng trả hàng, phản hồi/phân trang, quyết định cũ, cập nhật đồng thời, rollback, các vai trò, vận đơn/thời gian/URL, xác minh thông thường/ngoại lệ và việc chặn hoàn trước xác minh. Browser test dùng đăng nhập và API thật, mở khiếu nại từ đơn mua, gửi ảnh/phản hồi hai bên, ra quyết định, gửi trả/nhận lại/xác minh và chuyển sang tạo khoản hoàn liên kết. Có kiểm tra reload, tải ảnh, thông báo, bố cục điện thoại và lỗi runtime.

Môi trường kiểm thử dùng MongoDB replica set tạm, khóa PayOS rỗng; không tạo vận đơn ngoài hệ thống hoặc chuyển tiền thật. Ảnh kiểm thử nằm ở `C:/sifit-prototype/artifacts/dispute-returns`.
