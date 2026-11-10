# Deploy bản giới thiệu Sifit

Bộ này dành cho một máy chủ Linux chạy Docker Compose, một domain và MongoDB replica set (ví dụ Atlas). FE, REST API và Socket.IO cùng origin HTTPS; Caddy tự cấp/gia hạn TLS. Không yêu cầu mua thêm domain API. Chỉ chạy **một backend instance** cho bản demo; chưa bổ sung Redis hoặc cân bằng tải nhiều instance.

## Chuẩn bị

Đã kiểm tra local ngày 10/11/2026: 28 suites / 314 tests BE đạt, integration trình duyệt đạt, release bundle khoảng 2,35 MB. Docker build BE/FE và Caddy validate đạt. Container production thử trên database tách biệt đã kiểm tra health, đăng ký/đăng nhập, WebSocket qua proxy, cache static và chặn tạo thanh toán. HTTPS chứng chỉ/domain thực, MongoDB/Cloudinary/Google production và backup ngoài máy chủ vẫn cần kiểm tra sau khi có hosting. Audit dependency production của cả hai repo hiện không có cảnh báo; tooling dev BE vẫn có advisory transitive, không đưa vào image runtime.

- Giữ hai repo cạnh nhau: `Sifit-backend` (nhánh `main`) và `sifit-prototype` (nhánh `frontend-api-seller-ui`).
- Máy chủ cần Docker Engine và Compose plugin, mở cổng 80/443; backend 5000 không public trực tiếp.
- Trỏ DNS A của domain tới IP máy chủ. Chỉ thêm AAAA khi máy chủ thực sự có IPv6 hoạt động. Chọn một hostname chuẩn, chưa thêm www nếu chưa cấu hình redirect.
- Tạo database riêng `sifit_demo` trên MongoDB hỗ trợ transaction. Giới hạn kết nối DB theo IP máy chủ. Không copy dữ liệu cá nhân/đơn tiền thật từ local để làm demo.
- Cấu hình Cloudinary để đăng ảnh. Google login có thể để trống Client ID và dùng email/password trước; nếu bật, khai báo HTTPS origin trong Google Cloud.

## Cấu hình riêng cho máy chủ

Từ thư mục `Sifit-backend/deploy`:

```sh
cp .env.example .env
chmod 600 .env
```

Sửa DOMAIN, FRONTEND_URL, SOCKET_CORS_ORIGIN, MONGODB_URI và Cloudinary trong `.env`. URL origin không có dấu `/` cuối. Compose tự đặt hai origin theo DOMAIN cho backend; vẫn điền chúng trong file để các lệnh bootstrap dùng cùng cấu hình.

Tạo **bốn secret khác nhau** bằng cách chạy lệnh sau bốn lần, rồi điền vào JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PAYMENT_WEBHOOK_SECRET, SHIPPING_WEBHOOK_SECRET:

```sh
openssl rand -hex 32
```

Giữ PAYMENTS_ENABLED=false, SELLER_VERIFICATION_MODE=manual, SHIPPING_PROVIDER=manual, PAYOUT_MODE=manual. Không cần khóa PayOS khi thanh toán tắt. Không dùng `.env` development sẵn có vì hiện đang chứa cấu hình PayOS tiền thật. Bản FE mẫu hiển thị thông báo giới thiệu học tập và không tự gọi tạo QR sau checkout.

## Build, chuẩn bị DB và chạy

```sh
docker compose --env-file .env config --quiet
docker compose --env-file .env build --pull
docker compose --env-file .env run --rm backend npm run db:prepare
docker compose --env-file .env run --rm backend npm run seed:categories
```

`db:prepare` kiểm tra replica set/writable primary và tạo index còn thiếu cho mọi model; không dùng syncIndexes/drop để tránh xóa index có sẵn. Nếu dữ liệu trùng gây lỗi index, xử lý dữ liệu trước; không bỏ qua lỗi rồi mở website.

Tạo admin đầu tiên bằng thông tin riêng, không dùng mật khẩu ví dụ công khai. Tạm thêm ADMIN_BOOTSTRAP_EMAIL và ADMIN_BOOTSTRAP_PASSWORD (ít nhất 8 ký tự, hoa/thường/số/ký tự đặc biệt) vào `.env` rồi chạy:

```sh
docker compose --env-file .env run --rm backend npm run bootstrap:admin
```

Script từ chối nếu đã có admin hoặc email đó đã tồn tại; không đổi quyền tài khoản cũ. Xóa hai biến bootstrap khỏi `.env` sau khi thành công.

```sh
docker compose --env-file .env up -d
docker compose ps
curl --fail https://YOUR_DOMAIN/api/v1/health
```

Tạo tài khoản seller và buyer thử nghiệm qua website. Seller tạo shop, đăng ít nhất 6 sản phẩm có ảnh; admin duyệt sản phẩm trước khi gửi link cho thầy. Không có dữ liệu mẫu tự chèn hoặc tài khoản/mật khẩu dùng chung trong code. Admin chỉ cần chia sẻ riêng khi thực sự muốn người xem kiểm tra phần quản trị.

## Kiểm tra trước khi gửi link

1. Mở domain từ điện thoại bằng 4G; chứng chỉ HTTPS hợp lệ, danh mục/ảnh tải được.
2. Đăng nhập email, F5, logout, đăng nhập lại; thử hai trình duyệt buyer/seller và chat.
3. Thử seller đăng ảnh và admin duyệt; buyer thêm giỏ, địa chỉ, tạo đơn. Thanh toán phải bị tắt, không hiện QR mới hoặc yêu cầu chuyển tiền.
4. Kiểm tra log backend, outbox và tác vụ nền. Health chỉ kiểm tra MongoDB, không thay thế kiểm tra Cloudinary/Google/job.
5. Dùng giám sát HTTPS ngoài máy chủ cho `/api/v1/health`; cấu hình thông báo khi down. Chạy `docker compose logs --tail=100 backend` khi cần chẩn đoán; không đăng log chứa dữ liệu riêng tư.

## Backup và cập nhật

Thiết lập backup ở nhà cung cấp MongoDB hoặc dùng mongodump với URI lấy từ nơi quản lý secret; không lưu URI vào Git/shell history. Sao lưu riêng cấu hình server và bảo vệ secret. **Thử restore sang database khác trước**, không thử đè database đang chạy. Giữ volume caddy_data để giữ chứng chỉ; không dùng `docker compose down -v` cho cập nhật thông thường.

Trước mỗi lần cập nhật, ghi lại commit cả hai repo và giữ image tag cũ. Đổi RELEASE_TAG sang giá trị mới (ví dụ demo-2), build, chạy db:prepare nếu schema thay đổi rồi up -d. Để rollback code, đổi RELEASE_TAG về tag cũ và chạy `docker compose up -d --no-build`; phải còn image cũ trên máy. Rollback code không tự rollback dữ liệu, cần kiểm tra tương thích schema trước.

Container tự restart khi tiến trình thoát; healthcheck báo unhealthy **không tự restart** tiến trình đang sống. Cần giám sát ngoài để phát hiện và xử lý trường hợp đó. Log Docker đã giới hạn dung lượng.

## Mở thanh toán thật sau này

Đây là bước riêng: cấu hình đầy đủ khóa PayOS, HTTPS webhook ổn định, đăng ký webhook rồi kiểm tra thu/đối soát có kiểm soát trước khi đặt PAYMENTS_ENABLED=true. Đồng thời đổi VITE_DEMO_MODE trong compose thành false và build lại FE. Không chỉ bật cờ rồi coi như đã kiểm chứng giao dịch thật.

Nguồn: [Caddy reverse proxy/WebSocket](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Compose env](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
