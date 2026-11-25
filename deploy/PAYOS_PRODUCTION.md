# Thanh toán PayOS trên sifit.id.vn

## Kết quả kiểm tra ngày 25/11/2026

- Đã fetch toàn bộ remote branch của hai repository. PayOS, QR, webhook có xác minh chữ ký và đối soát đã có trên `main`.
- FE: `fix`, `quan_W10` là tổ tiên của `main`; `frontend-api-seller-ui` trùng `main` tại `715b7b4`. `fe-redesign` có một commit riêng từ 18/10, trong khi `main` có thêm 12 commit. Đây là nhánh thiết kế cũ, khác 1.002 file và xung đột nhiều file nếu gộp; không cần gộp để có thanh toán.
- BE: `quan_W10` có một commit AI cũ chưa nằm trong lịch sử `main`. Phần AI đã được triển khai lại trên `main`; nhánh cũ còn thêm fallback bỏ MongoDB transaction và lưu ảnh local, không phù hợp luồng tiền đang dùng Atlas/Cloudinary. Không gộp nguyên trạng.
- Website và API health trả HTTP 200, MongoDB báo connected. JavaScript checkout đang public có lệnh tạo thanh toán tự động; không chứa nhánh chặn checkout của demo. Điều này không chứng minh Render đã bật PayOS hoặc nhập đủ khóa.
- `GET /api/v1/payments/config` trả 401 khi chưa đăng nhập, đúng thiết kế. Chưa đọc được biến môi trường/log trên Render hay cấu hình project Cloudflare.
- File local FE `.env.production` vẫn có `VITE_DEMO_MODE=true`; file local BE `.env.production` có `PAYMENTS_ENABLED=false` và ba khóa PayOS trống. Các file này được ignore; chúng không tự cập nhật dashboard.
- Đã sửa lỗi `src/config/env.js`: thiếu khai báo `PAYOS_WEBHOOK_URL` trong Zod schema. Trước bản sửa, bật PayOS production với đủ khóa có thể lỗi `TypeError` khi khởi động, kể cả đã nhập webhook trong dashboard. Bản sửa giữ lại biến và kiểm tra URL với thông báo cấu hình rõ ràng.

## 1. Render: deploy backend main và nhập biến

Trong service backend, chọn repository `hoandse184495/Sifit-backend`, branch `main`.
Deploy commit chứa bản sửa cấu hình trước khi mở thanh toán. Giữ nguyên các biến
MongoDB, JWT, Cloudinary hiện có và cập nhật các biến sau trong **Environment**:

```dotenv
NODE_ENV=production
FRONTEND_URL=https://sifit.id.vn
SOCKET_CORS_ORIGIN=https://sifit.id.vn
PAYMENT_PROVIDER=payos
PAYMENT_MODE=production
PAYMENTS_ENABLED=false
PAYOS_CLIENT_ID=<Client ID của kênh thanh toán>
PAYOS_API_KEY=<API Key cùng kênh>
PAYOS_CHECKSUM_KEY=<Checksum Key cùng kênh>
PAYOS_WEBHOOK_URL=https://api.sifit.id.vn/api/v1/webhooks/payments/payos
SHIPPING_PROVIDER=manual
PAYOUT_MODE=manual
SELLER_VERIFICATION_MODE=manual
BACKGROUND_JOBS_ENABLED=true
```

Lấy ba khóa từ kênh thanh toán trên `my.payos.vn`, liên kết tài khoản ngân hàng nhận
tiền của Sifit. Nhập trực tiếp vào Render; không đưa vào Git hay bất kỳ biến `VITE_` nào.
Chọn **Save and deploy** để áp dụng biến runtime. **Save only** chưa áp dụng vào tiến trình đang chạy.

PayOS provider hiện dựng return/cancel URL từ `FRONTEND_URL`:
`https://sifit.id.vn/?view=payment-result&paymentId=...`, thêm `cancelled=1` khi hủy.
`PAYMENT_RETURN_URL` và `PAYMENT_CANCEL_URL` hiện dùng cho simulator, không quyết định
callback của PayOS. Return URL không phải webhook và không tự xác nhận đã thu tiền.

## 2. Chuẩn bị index và đăng ký webhook production

Database cần hỗ trợ transaction (Atlas hoặc replica set). Chạy `npm run db:prepare`
trong môi trường backend production để kiểm tra database và tạo index thiếu; script
không xóa index cũ. Nếu pre-deploy trên gói Render hiện tại không được hỗ trợ, chạy
một lần bằng shell/job có cùng cấu hình production trước khi mở thanh toán.

Sau khi backend hoạt động với ba khóa mới, chạy trong Render Shell:

```sh
npm run payos:confirm-webhook -- https://api.sifit.id.vn/api/v1/webhooks/payments/payos
```

Hoặc đăng ký URL này trong kênh thanh toán tại dashboard PayOS. Lệnh SDK đăng ký URL
và PayOS gửi request kiểm tra; nó không tạo lệnh thu tiền. Không dùng URL tunnel
localhost cũ. Ba khóa và webhook phải thuộc cùng kênh.

Webhook là **POST** công khai từ PayOS, không cần cookie đăng nhập Sifit; backend
xác minh chữ ký. Mở URL bằng trình duyệt là GET nên không xác minh được webhook.
Nếu Cloudflare đang proxy API, kiểm tra WAF/Access/bot challenge khi PayOS xác nhận
thất bại: đường dẫn webhook phải nhận được POST server-to-server, không bị trang
đăng nhập hoặc challenge chặn. Chỉ điều chỉnh rule ảnh hưởng đúng đường dẫn khi cần.

Khi confirm thành công, đổi `PAYMENTS_ENABLED=true` trên Render và **Save and deploy**.
Kiểm tra log khởi động và health sau deploy. Backend cần chạy liên tục để webhook,
đối soát và lịch hết hạn hoạt động; service sleep có thể làm chậm các bước này.

## 3. Cloudflare Pages: chọn main và build lại

Project FE dùng repository `zaming3007/sifit-prototype`, production branch `main`.
Build command `npm run build`, output directory `dist`. Trong biến **Production**:

```dotenv
NODE_VERSION=22
VITE_API_BASE_URL=https://api.sifit.id.vn/api/v1
VITE_SOCKET_URL=https://api.sifit.id.vn
VITE_PUBLIC_SITE_URL=https://sifit.id.vn
VITE_DEMO_MODE=false
```

Deploy/build lại sau khi đổi biến. Vite đóng các biến này vào JavaScript lúc build;
đổi biến hoặc sửa file `.env.production` trên máy không thay đổi bundle đã public.
Backend và frontend phải cùng dùng các domain HTTPS trên.

## 4. Xác nhận sau deploy

1. Mở `https://api.sifit.id.vn/api/v1/health`: cần HTTP 200 và database connected.
2. Đăng nhập buyer trên website. Trong DevTools → Network, xem response
   `GET https://api.sifit.id.vn/api/v1/payments/config` bằng phiên đăng nhập của ứng dụng.
   API dùng access token Bearer; chỉ mở URL trên thanh địa chỉ có thể vẫn trả 401.
   Nếu ứng dụng chưa gọi endpoint này, dùng Axios `apiClient.get('/payments/config')`
   trong môi trường debug đã khôi phục phiên, hoặc gọi HTTP bằng access token hiện tại.
   Kết quả cần `enabled: true`, `provider: "payos"`, `configured: true`.
   `configured` chỉ kiểm tra ba khóa có giá trị, không chứng minh khóa hợp lệ.
3. Đặt một đơn thử có kiểm soát, kiểm tra QR, ngân hàng/người nhận, số tiền và nội dung.
   Cần người vận hành thực hiện chuyển khoản thử và đối chiếu tiền thực nhận; các
   kiểm thử tự động không thực hiện giao dịch ngân hàng thật.
4. Xem request webhook trong log, xác nhận đơn `PAID`, biên nhận trong admin và
   không ghi trùng nếu PayOS gửi lại. Kiểm tra nút **Kiểm tra thanh toán** khi webhook chậm.
5. Kiểm tra return/cancel về website chính. Chỉ trở về trang kết quả không được làm
   đơn thành PAID khi chưa xác minh với PayOS.

Chẩn đoán nhanh:

| Hiện tượng | Kiểm tra |
| --- | --- |
| Checkout báo bản giới thiệu, không tạo QR | `VITE_DEMO_MODE=false` và build/deploy FE mới |
| POST payments trả 503 “Không cần chuyển tiền” | `PAYMENTS_ENABLED` trên Render vẫn false |
| Backend không khởi động sau khi bật PayOS | Đã deploy bản sửa env; đủ ba khóa, mode production và đúng webhook HTTPS |
| Tạo QR trả lỗi cấu hình hoặc 502 | Ba khóa cùng kênh, tài khoản nhận tiền, kết nối/API PayOS; xem log không chia sẻ secret |
| QR có nhưng đơn chưa PAID | Webhook đăng ký đúng kênh/domain, POST không bị chặn, chữ ký đúng Checksum Key; dùng đối soát |
| Sửa code main nhưng website không đổi | Production branch và commit đang deploy trên cả hai hosting; build cache/artifact |

Luồng hiện tại thu tiền về tài khoản Sifit liên kết PayOS. Chi trả seller và hoàn tiền
được admin chuyển khoản thủ công rồi ghi nhận mã giao dịch; nút duyệt không tự chuyển tiền.

Nguồn: [Render Environment](https://render.com/docs/configure-environment-variables),
[Cloudflare Pages build](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[PayOS API](https://payos.vn/docs/api/), [PayOS test](https://payos.vn/docs/moi-truong-test/).
