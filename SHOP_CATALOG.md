# Trang shop: phân trang, tìm kiếm và bộ lọc

Trang shop hiện tải trực tiếp theo ID người bán, hiển thị 12 sản phẩm mỗi trang và cho phép xem toàn bộ sản phẩm đang bán. Không còn tải toàn bộ danh sách shop để tìm người bán, hoặc giới hạn tổng số hàng ở 20 sản phẩm.

Người xem có thể tìm tên, mô tả hoặc thương hiệu; lọc danh mục, thương hiệu, kích cỡ, tình trạng và khoảng giá; sắp xếp theo mới/cũ hoặc giá tăng/giảm. Nhấn **Áp dụng bộ lọc** để dùng các lựa chọn cùng lúc. Áp dụng bộ lọc hay đổi thứ tự sẽ trở về trang đầu. **Xóa bộ lọc** khôi phục danh sách mặc định.

Trạng thái bộ lọc, thứ tự, trang sản phẩm và tab/trang đánh giá được lưu trên đường dẫn bằng các tham số `shopSearch`, `shopCategory`, `shopBrand`, `shopSize`, `shopCondition`, `shopMin`, `shopMax`, `shopSort`, `shopPage`, `shopTab`, `shopReviewPage`. Tải lại, chia sẻ đường dẫn hoặc dùng Back/Forward sẽ khôi phục đúng trạng thái. Nếu trang không còn tồn tại sau khi số sản phẩm giảm, giao diện chuyển về trang cuối hợp lệ.

Theo dõi/bỏ theo dõi và lựa chọn thông báo của shop giữ nguyên. Card sản phẩm vẫn mở chi tiết, thêm giỏ và lưu yêu thích. Đánh giá được tải khi mở tab và phân trang 10 mục/lần, giữ tên người mua, ngày, điểm và nhận xét.

## API công khai

- `GET /api/v1/shops/by-seller/:sellerId`: trả `{ shop }` với hồ sơ công khai đúng người bán.
- `GET /api/v1/shops/:slug`: trả `{ shop, products, pagination, facets }`.
- `GET /api/v1/shops/:slug/ratings?page=1&limit=10`: API đánh giá hiện có, thêm tie-breaker `_id` để phân trang ổn định khi thời gian trùng nhau.

Các query cho danh sách sản phẩm:

| Tham số | Quy tắc |
| --- | --- |
| `page` | Số nguyên 1–100.000, mặc định 1 |
| `limit` | Số nguyên 1–50, mặc định 20 để giữ tương thích; giao diện dùng 12 |
| `search` | Tối đa 100 ký tự; tìm chuỗi con trong tên/mô tả/thương hiệu, không phân biệt hoa thường, ký tự regex được escape |
| `categoryId` | MongoDB ObjectId hợp lệ |
| `brand` | Tối đa 100 ký tự, khớp nguyên thương hiệu không phân biệt hoa thường |
| `size` | `XS`, `S`, `M`, `L`, `XL`, `XXL`, `FREE_SIZE` |
| `condition` | `NEW_WITH_TAGS`, `LIKE_NEW`, `GOOD`, `FAIR` |
| `minPrice`, `maxPrice` | Số nguyên VND an toàn, không âm, tính cả hai đầu; giá từ không lớn hơn giá đến |
| `sort` | `newest` (mặc định), `oldest`, `price_asc`, `price_desc` |

Tất cả điều kiện được áp dụng tại backend, trong phạm vi người bán của shop; không lọc riêng những món đã tải trong trình duyệt. `pagination.total` là tổng số món khớp bộ lọc, `pages` là số trang tương ứng. API giữ trang được yêu cầu và trả mảng rỗng nếu vượt cuối; giao diện tự chuyển về trang hợp lệ.

`facets` có `categories` (`_id`, `name`, `count`), `brands`, `sizes`, `conditions`, `minPrice`, `maxPrice`, `total`. Chúng được tính từ toàn bộ sản phẩm đang bán của chính shop, độc lập trang và bộ lọc hiện tại, nên các lựa chọn không mất đi khi tìm kiếm không có kết quả.

## Dữ liệu công khai và vận hành

Chỉ trả sản phẩm `ACTIVE`, chưa bị xóa. Bản nháp/chờ duyệt/bị từ chối, món đang giữ chỗ/đã bán/lưu trữ và thương hiệu của shop khác không xuất hiện trong sản phẩm hoặc facets. Shop hoặc tài khoản người bán không hoạt động trả `404`; không trả số liên hệ riêng tư hay trường kiểm duyệt sản phẩm như người duyệt/ghi chú từ chối.

Các lượt gọi được hủy khi đổi shop hoặc điều kiện; kết quả request cũ không thay thế kết quả mới. Danh sách có loading, lỗi/thử lại, shop trống và không có kết quả. Không tạo dữ liệu mẫu trong database development.

MongoDB development tự tạo các index mới. Production tắt auto-index nên cần tạo trước hai index được khai báo trong model `Product`:

```js
{ sellerId: 1, status: 1, deletedAt: 1, createdAt: -1, _id: -1 }
{ sellerId: 1, status: 1, deletedAt: 1, price: 1, _id: 1 }
```

Không cần đổi cấu hình thanh toán hay chỉnh `.env` để dùng tính năng này.

## Kiểm tra

```sh
npm run lint
npm test
```

Tại thư mục frontend:

```sh
node scripts/verify-shop-catalog.mjs
npm run test:integration
npm run build
```

Browser test chạy Express, Socket.IO và MongoDB replica set tạm, không giả lập API trong trình duyệt. Nó dùng shop hơn 20 sản phẩm và nhiều trang đánh giá, kiểm tra lọc/sắp xếp, reload/Back/Forward, phục hồi trang vượt cuối, shop trống/ngừng hoạt động, theo dõi/yêu thích/giỏ hàng/chi tiết và bố cục 320/390/768 px. Nhà cung cấp thanh toán bị cô lập; không dùng tiền hoặc dữ liệu development.
