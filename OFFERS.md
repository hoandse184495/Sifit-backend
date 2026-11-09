# Mặc cả theo đề nghị giá

Người mua chọn **Mặc Cả** trên trang sản phẩm, nhập giá và lời nhắn. Người bán mở **Đề nghị giá** trong Seller Studio để chấp nhận hoặc từ chối, kèm ghi chú. Người mua xem lịch sử ở mục **Đề nghị giá**, có thể rút đề nghị hoặc đặt hàng theo giá được chấp nhận. **Nhắn tin cho shop** vẫn mở hội thoại riêng.

## Quy tắc

- Giá là số nguyên VND dương, thấp hơn giá niêm yết. Giá đề nghị và giá niêm yết tại lúc gửi được lưu bất biến.
- Đề nghị chờ phản hồi có hạn 24 giờ. Khi chấp nhận, người mua có 24 giờ mới để bắt đầu checkout. Sau khi tạo đơn, thời hạn thanh toán lấy theo thời gian giữ hàng của đơn hiện có (mặc định 15 phút).
- Gửi hoặc chấp nhận đề nghị không giữ hàng. Nhiều người mua có thể được chấp nhận; người tạo đơn thành công trước mới giữ sản phẩm duy nhất. Không có cam kết giữ hàng chỉ vì shop đã đồng ý giá.
- Mỗi người mua chỉ có một đề nghị mở (`PENDING` hoặc `ACCEPTED`) cho một sản phẩm. Tối đa 3 đề nghị/sản phẩm/24 giờ và 10 đề nghị/tài khoản/24 giờ, kể cả đã rút hoặc bị từ chối. Thử lại cùng idempotency key không tạo bản ghi mới hoặc chiếm thêm hạn mức.
- Sản phẩm không còn đang bán, thay đổi giá, người bán/shop bị đình chỉ, sai chủ sở hữu hoặc đề nghị hết hạn đều không được áp dụng vào checkout.
- Giá đã chấp nhận chỉ dùng một lần. Tạo đơn chuyển đề nghị thành `CHECKED_OUT`; hủy đơn hoặc hết hạn thanh toán không tự phục hồi đề nghị đó. Muốn mặc cả lại cần gửi đề nghị mới, vẫn chịu hạn mức.
- Chỉ hai bên xem được đề nghị; không trả email, số điện thoại, idempotency key hoặc request fingerprint của bên kia. Lịch sử và ảnh chụp tên/ảnh/giá sản phẩm vẫn còn khi sản phẩm bị xóa.

## Checkout và tiền

Giỏ hàng tải các đề nghị đã chấp nhận và hiển thị giá niêm yết, giá thống nhất, hạn sử dụng và lựa chọn **Áp dụng giá đã thống nhất**. Người mua có thể chủ động bỏ chọn để mua theo giá niêm yết. Nếu không tải được thông tin đề nghị, giao diện yêu cầu thử lại trước khi tạo đơn.

`POST /api/v1/orders` nhận thêm `offerIds` (tối đa 30, không trùng). Các trường giá từ trình duyệt không quyết định giá đơn. Backend kiểm tra đúng người mua, trạng thái, thời hạn, sản phẩm trong giỏ, shop/người bán và giá niêm yết; không tự giảm giá bằng một đề nghị không được chọn.

Checkout vẫn xử lý toàn bộ giỏ và chia đơn theo người bán như trước. Trong cùng MongoDB transaction, backend giữ sản phẩm, sử dụng đề nghị, lưu snapshot giá, tính tổng/hoa hồng/tiền người bán, ghi thông báo và xóa các món đã checkout khỏi giỏ. Lỗi bất kỳ bước nào rollback toàn bộ. Hai người checkout cùng sản phẩm hoặc người mua rút đề nghị đồng thời không thể làm hai đơn cùng giữ hàng.

Snapshot item lưu `price` đã thống nhất, `listingPrice` và `offerId`. PayOS nhận tổng từ nhóm đơn đã lưu; không nhận giá tự khai từ trình duyệt. Hóa đơn, hoa hồng và tiền chi trả tiếp tục dựa trên snapshot của đơn. Không thay đổi giá công khai của sản phẩm.

## API

Các đường dẫn có tiền tố `/api/v1`, yêu cầu tài khoản đang hoạt động.

| Phương thức | Đường dẫn | Vai trò / dữ liệu |
| --- | --- | --- |
| POST | `/products/:id/offers` | BUYER: `{ amount, message?, idempotencyKey }` |
| GET | `/offers/my` | BUYER: lịch sử của chính mình |
| GET | `/seller/offers` | SELLER: đề nghị cho sản phẩm của mình |
| GET | `/offers/:id` | BUYER/SELLER là một trong hai bên |
| POST | `/seller/offers/:id/respond` | SELLER sở hữu: `{ decision: "ACCEPT" hoặc "REJECT", note? }` |
| POST | `/offers/:id/withdraw` | BUYER sở hữu đề nghị còn mở/còn hạn |

Danh sách hỗ trợ `page`, `limit`, `status`, `productId`. Trạng thái: `PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`, `CHECKED_OUT`. Phản hồi có `effectiveStatus`, `available`, `actionable`; đề nghị quá hạn bị vô hiệu ngay cả khi worker chưa chạy.

API thay đổi trạng thái ghi lịch sử và sự kiện outbox cùng transaction. Thông báo `OFFER_UPDATED` dẫn tới chi tiết `OFFER` đúng quyền và dùng tùy chọn thông báo **Đơn hàng**. Hệ thống thử giao ngay; hàng đợi định kỳ xử lý lại khi lỗi. Tác vụ `marketplace-maintenance` hiện tự đóng đề nghị hết hạn và ghi thông báo cho hai bên, xem [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md).

## Chỉ mục và kiểm tra

MongoDB cần replica set hoặc Atlas. Development tự tạo index. Production tắt auto-index nên phải tạo các index khai báo trong model `Offer` trước khi bật, đặc biệt unique `{ buyerId, idempotencyKey }` và unique partial `{ buyerId, productId }` khi `open: true`. Hạn mức gửi được đếm sau khóa ghi tài khoản trong transaction, có hiệu lực giữa nhiều tiến trình API.

```sh
npm run lint
npm test
```

Trong frontend:

```sh
node scripts/verify-offers.mjs
npm run test:integration
npm run build
```

Kiểm tra browser dùng API, Socket.IO và database tạm thật, mô phỏng riêng nhà cung cấp thanh toán; không dùng dữ liệu hay tiền development. Có kiểm tra chấp nhận/từ chối/rút/hết hạn, thông báo và tải lại đường dẫn, lựa chọn giá trong giỏ, tổng thanh toán, lọc lịch sử và giao diện 320/390/768 px.
