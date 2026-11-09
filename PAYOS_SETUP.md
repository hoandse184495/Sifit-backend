# PayOS và luồng mua bán Sifit

## Luồng đã triển khai

1. Người mua đặt hàng; backend giữ sản phẩm theo hạn giữ chỗ (mặc định 15 phút), chốt tổng tiền và hoa hồng từ database.
2. Backend tạo một yêu cầu PayOS cho nhóm đơn và trả QR. Thử lại hoặc bấm đồng thời vẫn dùng cùng yêu cầu đang hoạt động. QR không nhận số tiền do frontend tự tính.
3. PayOS gửi webhook server-to-server. SDK chính thức xác minh HMAC-SHA256 bằng Checksum Key. Chữ ký sai bị từ chối trước khi ghi dữ liệu tiền.
4. `PaymentTransaction` lưu từng khoản tiền về với mã ngân hàng duy nhất; `PaymentWebhookEvent` lưu lịch sử sự kiện; `Payment` quản lý yêu cầu QR. `Order` quản lý đơn hàng. Các bút toán và thay đổi đơn/tiền được ghi trong MongoDB transaction.
5. Khi tổng khoản tiền đã xác minh đúng bằng tổng phải trả và đơn còn đủ điều kiện, đơn thành `PAID`. Chuyển thiếu/dư, chuyển thêm sau thanh toán hoặc sau khi đơn hết hạn đều giữ lịch sử và đánh dấu cần đối soát, không tự giao thêm hàng. Đối soát PayOS phục hồi trường hợp webhook đến chậm hoặc bị mất.
6. Người bán xác nhận chuẩn bị, đặt ship trực tiếp với hãng vận chuyển và nhập vận đơn. Lưu vận đơn là `PROCESSING`; xác nhận bàn giao kèm căn cứ mới thành `SHIPPED`. Phí ship người bán trả hãng vận chuyển trực tiếp, không thu lại từ QR đã thanh toán.
7. Người mua đã nhận hàng bấm xác nhận: `DELIVERED`, lưu thời điểm nhận và bắt đầu thời hạn bảo vệ. Với vận đơn thủ công đã bàn giao, chính người mua có thể xác nhận; người bán không thể tự xác nhận nhận hàng.
8. Admin kiểm tra đơn rồi bấm hoàn tất. Worker cũ không tự hoàn tất đơn nữa. Nếu người mua quên xác nhận, admin chỉ được dùng nhánh quá hạn khi đã có bằng chứng giao hàng và hết hạn phản hồi; cần ghi chú.
9. Khi hết hạn bảo vệ, không có khiếu nại/khoản hoàn/ngoại lệ, shop đã xác minh và hết thời gian giữ bổ sung, admin kiểm tra điều kiện chi trả để tạo khoản `ELIGIBLE`.
10. Người bán khai báo ngân hàng ở **Chi trả**. Admin duyệt khoản chi, hệ thống chụp thông tin ngân hàng tại thời điểm duyệt. Admin chuyển tiền thực tế qua ngân hàng, rồi nhập mã giao dịch và xác nhận đã đối chiếu. Đến lúc đó mới ghi `PAID`, ghi bút toán chi trả và ghi nhận hoa hồng. Nút duyệt không tự chuyển tiền.

Tiền về tài khoản ngân hàng Sifit liên kết PayOS. Website quản lý nghĩa vụ trả người bán; không có ví tiền PayOS hay cơ chế ký quỹ tự động. Tích hợp chi hộ PayOS tự động không được bật trong luồng này. Các khoản chuyển sai/thiếu/dư hoặc yêu cầu hoàn PayOS cần admin đối soát và thực hiện chuyển khoản hoàn thực tế; API thu tiền không tự hoàn tiền.

## Cấu hình local

Trong `.env` backend (không đưa khóa lên Git):

```dotenv
PAYMENT_PROVIDER=payos
PAYMENT_MODE=production
PAYOS_CLIENT_ID=
PAYOS_API_KEY=
PAYOS_CHECKSUM_KEY=
SHIPPING_PROVIDER=manual
PAYOUT_MODE=manual
PAYOUT_HOLD_DAYS=0
BUYER_PROTECTION_DAYS=3
```

Giữ ba khóa đã nhập trên máy. `PAYOUT_HOLD_DAYS=0` bỏ thời gian giữ bổ sung sau hoàn tất; thời hạn bảo vệ 3 ngày vẫn áp dụng. Không đổi thời hạn chỉ để thử trên đơn thật.

PayOS **không có sandbox riêng**. Các kiểm thử tự động trong dự án dùng database tạm và thay thế phần gọi dịch vụ ngoài, vẫn kiểm tra chữ ký bằng SDK thật; không gửi lệnh thanh toán hoặc chuyển tiền thực tế.

## URL webhook khi chỉ có localhost

Cloudflare Quick Tunnel đã được tải từ bản phát hành chính thức, kiểm tra SHA-256 khi có digest, đặt tại `.local-tools/cloudflared.exe` (được bỏ qua bởi Git). Proxy chỉ chuyển tiếp `POST /api/v1/webhooks/payments/payos`, các đường dẫn khác trả 404.

Mở các terminal tại `C:\Sifit-backend`:

```powershell
# Terminal 1: backend
npm start

# Terminal 2: proxy chỉ phục vụ webhook
npm run payos:webhook-proxy

# Terminal 3: URL HTTPS thử (giữ terminal này chạy)
.\.local-tools\cloudflared.exe tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:5001
```

Lấy URL `https://...trycloudflare.com` từ terminal 3, thêm `/api/v1/webhooks/payments/payos`, rồi đăng ký:

```powershell
npm run payos:confirm-webhook -- https://YOUR-URL.trycloudflare.com/api/v1/webhooks/payments/payos
```

Lệnh chỉ đăng ký webhook và nhận dữ liệu kiểm tra từ PayOS, không tạo thanh toán. Có thể đặt URL mới trong `PAYOS_WEBHOOK_URL` của `.env` và chạy `npm run payos:confirm-webhook`.

URL thử thay đổi khi chạy lại tunnel; phải đăng ký lại. Khi tắt máy/tunnel, PayOS không thể gọi localhost. Dùng domain HTTPS ổn định cho môi trường vận hành; Quick Tunnel phục vụ kiểm thử. Nếu thiếu webhook, backend vẫn có thể đối soát qua nút **Kiểm tra thanh toán**.

## Kiểm tra và vận hành

Backend hiện tự đối soát thanh toán và xét hủy đơn hết hạn mỗi 60 giây, xử lý hàng đợi thông báo mỗi 15 giây khi đang chạy. Nếu không xác minh được PayOS chưa nhận tiền, hàng vẫn được giữ để thử lại/đối soát. Xem [BACKGROUND_JOBS.md](BACKGROUND_JOBS.md) để cấu hình và kiểm tra lịch; các lệnh worker dưới đây dùng để chạy thêm một lượt thủ công.

- Người mua: đặt hàng → QR → thanh toán → theo dõi đơn → xác nhận nhận hàng.
- Người bán: **Đơn bán** → xác nhận chuẩn bị → **Tạo vận đơn** → nhập mã đã đặt → ghi căn cứ và xác nhận bàn giao. **Chi trả** → nhập ngân hàng.
- Xác minh nhận tiền: **Hồ sơ shop** → lưu ngân hàng, lập nháp, tải ảnh chủ shop/ngân hàng, đồng ý và gửi duyệt; admin xử lý tại **Xác minh shop**. Khoản chi thủ công mới cần hồ sơ đã duyệt khớp tài khoản hiện tại. Xem [SELLER_VERIFICATION.md](SELLER_VERIFICATION.md).
- Admin: **Đơn hàng** → **Xem & hoàn tất đơn** → kiểm tra và duyệt. **Tài chính → Chi trả người bán** → kiểm tra điều kiện → duyệt → chuyển khoản thực tế → ghi nhận.
- **Tài chính → Tiền thực nhận**: mã ngân hàng và từng khoản nhận; **Giao dịch thanh toán**: yêu cầu QR; **Thanh toán bất thường**: xử lý tiền thiếu/dư/đến muộn, tiếp tục đơn hoặc lập khoản hoàn chưa phân bổ. Xem [PAYMENT_EXCEPTIONS.md](PAYMENT_EXCEPTIONS.md).

```powershell
npm test
npm run lint
npm run worker:reconcile-payments
npm run worker:notification-outbox
```

Ở frontend:

```powershell
node scripts/verify-payos-workflow.mjs
npm run test:integration
npm run build
```

MongoDB cần replica set để dùng transaction. Production tắt auto-index thì tạo index cho các model mới (`PaymentTransaction`, `SellerBankAccount`, `PaymentReviewAction`, `SellerVerificationDocument`, các index bổ sung của `SellerVerification`, `SellerPayout`, `Refund`, `Payment`, `Product`) trước khi mở tính năng. Các bút toán receipt/settlement là bất biến về nguồn và có khóa chống ghi trùng; không sửa tay trạng thái tiền trong database.

Tài liệu chính thức: [PayOS API](https://payos.vn/docs/api/), [xác minh chữ ký](https://payos.vn/docs/tich-hop-webhook/kiem-tra-du-lieu-voi-signature/), [môi trường kiểm thử](https://payos.vn/docs/moi-truong-test/), [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
