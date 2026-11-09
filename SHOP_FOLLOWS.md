# Theo dõi cửa hàng và sản phẩm mới

Người mua chọn **Theo dõi shop** trên trang cửa hàng. Mục **Shop đang theo dõi** có danh sách cửa hàng và bảng tin sản phẩm đang bán, có phân trang. Theo dõi được lưu trong MongoDB, không phụ thuộc trình duyệt.

## API

Các đường dẫn có tiền tố `/api/v1`. Ngoại trừ số người theo dõi công khai, mọi API yêu cầu tài khoản `BUYER` đang hoạt động.

| Phương thức | Đường dẫn | Chức năng |
| --- | --- | --- |
| GET | `/shops/:id/followers/count` | Số lượt theo dõi, không công khai danh tính người mua |
| GET | `/shops/:id/follow` | Trạng thái theo dõi của tài khoản hiện tại |
| PUT | `/shops/:id/follow` | Theo dõi; tùy chọn `notifyNewProducts` |
| DELETE | `/shops/:id/follow` | Bỏ theo dõi, cho phép thử lại an toàn |
| PATCH | `/shops/:id/follow` | Cập nhật `notifyNewProducts` khi đang theo dõi |
| GET | `/shop-follows/my?page=1&limit=12` | Danh sách cửa hàng đang theo dõi |
| GET | `/shop-follows/products?page=1&limit=12` | Sản phẩm đang bán từ cửa hàng được theo dõi |

`:id` là ID `SellerProfile`, không phải ID tài khoản người bán. Chỉ cửa hàng và người bán đang hoạt động mới nhận lượt theo dõi mới. Shop ngừng hoạt động vẫn hiện trong danh sách để người mua bỏ theo dõi; sản phẩm của shop đó không hiện trong bảng tin.

## Thông báo

- Chỉ lần đầu admin duyệt sản phẩm mới phát sinh thông báo `FOLLOWED_SHOP_NEW_PRODUCT`. Bản nháp, sản phẩm chờ duyệt hoặc được duyệt lại không gửi thông báo mới.
- Người mua phải theo dõi trước thời điểm duyệt; theo dõi hoặc theo dõi lại không gửi bù thông báo cũ.
- Người mua có thể tắt riêng từng shop hoặc tắt chung `followedShopNotifications` trong cài đặt thông báo. Tắt thông báo vẫn giữ danh sách theo dõi và bảng tin.
- Thông báo dẫn tới sản phẩm; chỉ dữ liệu công khai của shop được trả về.
- Duyệt sản phẩm và ghi sự kiện hàng đợi nằm trong cùng MongoDB transaction. Mỗi sản phẩm/người mua có khóa sự kiện riêng để tránh gửi trùng khi thử lại.
- Khi giao thông báo, backend kiểm tra lại lượt theo dõi, lựa chọn nhận tin và trạng thái người mua, người bán, shop, sản phẩm.

API cố gắng giao ngay sau khi duyệt. Backend hiện tự chạy hàng đợi định kỳ khi `BACKGROUND_JOBS_ENABLED=true` (mặc định bật ngoài test), xem [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md). Để xử lý một batch thủ công:

```sh
npm run worker:notification-outbox
```

Worker dùng khóa nhận việc nguyên tử; sự kiện bị kẹt ở `PROCESSING` được nhận lại sau 5 phút. Theo dõi sự kiện hết số lần thử theo `NOTIFICATION_OUTBOX_RETRY_LIMIT` để xử lý vận hành.

## Chỉ mục và kiểm tra

MongoDB phải hỗ trợ transaction (replica set hoặc Atlas). Trước khi bật tính năng trên production, tạo các index khai báo trong `ShopFollow`, đặc biệt index unique `{ buyerId: 1, shopId: 1 }`, cùng index unique `OutboxEvent.eventKey` và `Notification.{recipientId, eventKey}`. Production tắt `autoIndex`; môi trường development tự tạo index. Không cần sửa dữ liệu đơn hàng hay thanh toán.

```sh
npm run lint
npm test -- --runInBand tests/shopFollow.test.js
```

Trong thư mục frontend:

```sh
node scripts/verify-shop-follows.mjs
```

Kiểm tra trình duyệt dùng API thật, Socket.IO và MongoDB replica set tạm. Nó kiểm tra theo dõi, tải lại trang, bảng tin, thông báo sau duyệt, bật/tắt nhận tin, bỏ theo dõi và giao diện điện thoại; không dùng dữ liệu hay thanh toán thật của development.
