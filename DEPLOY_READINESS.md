# Đánh giá khả năng deploy Sifit

Rà soát ngày 09/11/2026 trên backend và frontend hiện tại. Chỉ đọc cấu hình và metadata database; không thay `.env`, không tạo giao dịch hoặc chuyển tiền.

**Kết luận:** Chức năng cốt lõi đủ để triển khai bản dùng thử/đồ án có người quản trị theo dõi. Cấu hình hiện tại chưa sẵn sàng mở bán công khai với giao dịch thật. Việc cần làm tiếp là chuẩn bị và kiểm chứng môi trường triển khai.

## Các luồng đã có

- Đăng ký buyer/seller, đăng nhập thường/Google, phiên đăng nhập và sửa hồ sơ.
- Shop, quản lý sản phẩm/ảnh, kiểm duyệt, tìm/lọc/phân trang, yêu thích, theo dõi shop.
- Giỏ hàng, địa chỉ, mặc cả có quy trình, checkout nhiều người bán, giữ hàng và hủy đơn hết hạn.
- Thu PayOS, chữ ký webhook, chống ghi trùng, biên nhận, sổ cái và xử lý tiền thiếu/dư/đến muộn.
- Người bán đặt ship, bàn giao, xác minh giao/nhận, admin hoàn tất và chi trả thủ công có kiểm soát.
- Báo cáo vi phạm, khiếu nại/ảnh/trả hàng, hoàn tiền có ngân hàng/chứng từ riêng tư.
- Xác minh shop thủ công, chat, thông báo, đánh giá, tài chính và nhật ký admin.

Lần kiểm thử hoàn thiện gần nhất: 24 suites / 285 tests backend, Chrome xác minh và integration tổng thể đạt; lint/build đạt, frontend còn hai cảnh báo Fast Refresh sẵn có. Lượt rà soát này không chạy lại toàn bộ test và chưa kiểm thử tải hoặc môi trường production.

## Kết quả kiểm tra trực tiếp

| Mục | Hiện trạng |
| --- | --- |
| Chế độ chạy | NODE_ENV=development; PayOS, shipping/payout manual |
| Kiểm tra cấu hình khi đổi sang production trong tiến trình kiểm tra | Không đạt vì SELLER_VERIFICATION_MODE vẫn là simulation |
| URL frontend, socket origin, payment return/cancel | Đều còn trỏ localhost |
| URL webhook được khai báo | Tunnel thử tạm thời |
| URL API build frontend | Localhost; socket sẽ dùng origin của API nếu không khai báo riêng |
| MongoDB đang cấu hình | Local, kết nối được, là replica set và có writable primary |
| Index chống trùng quan trọng | Những index đã kiểm tra trên payment receipt/event, refund, outgoing transfer và verification/document đều có; chưa xác nhận database production |
| Khóa Google/PayOS/Cloudinary | Có giá trị cấu hình; chưa kiểm chứng dịch vụ ngoài/domain production |
| Đăng ký admin công khai | Bị chặn ở validation và service; chỉ cho BUYER/SELLER |
| Job nền | Có scheduler/lease, chạy cùng tiến trình backend; cần backend hoạt động liên tục |
| Hạn mức API | Đã sửa: tải dữ liệu 600/phút, ghi 120/phút theo JWT user hoặc IP; auth/chat/webhook riêng, health không tính vào hạn mức |

Không ghi giá trị khóa, mật khẩu, địa chỉ database có thông tin đăng nhập hoặc dữ liệu hồ sơ cá nhân trong báo cáo.

## Việc cần hoàn thành trước khi mở công khai

1. **Cấu hình production:** NODE_ENV=production, SELLER_VERIFICATION_MODE=manual; giữ PayOS/manual theo luồng hiện có. Điền URL HTTPS của frontend, API, socket và return/cancel. Frontend cần build lại với VITE_API_BASE_URL đúng môi trường.
2. **Webhook ổn định:** đăng ký địa chỉ HTTPS của backend production với PayOS, không dùng tunnel thử cho vận hành thường xuyên. Kiểm tra nhận webhook khi người mua đã đóng trang.
3. **Đăng nhập trên domain thật:** cấu hình Google OAuth origin theo frontend thực tế; kiểm tra CORS, refresh cookie/SameSite theo quan hệ domain, login, F5, refresh và logout trên trình duyệt. Có Client ID trong `.env` chưa chứng minh cấu hình Google Cloud đã đúng production.
4. **Database production:** replica set, index unique/partial cần được tạo trước khi mở tính năng vì `autoIndex` tắt trong production. Thiết lập backup và kiểm chứng phục hồi; không giả định index/database local tự xuất hiện ở máy chủ mới.
5. **Vận hành:** tiến trình backend chạy liên tục, tự khởi động lại sau lỗi/restart; kiểm tra Socket.IO và tác vụ nền. Theo dõi health check, lỗi webhook/job và các thông báo hết lượt thử. Chưa thấy cấu hình backup/giám sát tự động trong repo; cần xác nhận cả phần hạ tầng bên ngoài.
6. **Hạn mức đã được sửa:** đã tách ngân sách và kiểm tra integration không reset bộ đếm. Trước khi mở rộng production, kiểm thử tải thực tế và dùng kho đếm/adapter socket chung nếu chạy nhiều instance. Xem SECURITY_FIXES_R1_R3.md.
7. **Kiểm thử sau deploy:** hai tài khoản buyer/seller và admin độc lập; kiểm tra ảnh, chat, refresh, checkout, callback, webhook lặp, đối soát, giao/nhận, khiếu nại, hoàn tiền và chi trả. Tác vụ có tiền thật chỉ thực hiện có kiểm soát; test tự động hiện tại không gọi ngân hàng.

Docker, CI/CD hoặc một cổng thanh toán khác không phải điều kiện chức năng bắt buộc để có bản deploy đầu tiên. Cần có cách build/chạy và quy trình cập nhật/khôi phục đáng tin cậy phù hợp nơi triển khai.

## Những chức năng nên hoàn thiện khi có người dùng thật

- Quên mật khẩu và xác minh email cho tài khoản thường: chưa có luồng hoàn chỉnh; trước đây người dùng yêu cầu tạm hoãn.
- Hạn chuẩn bị/gửi hàng, nhắc việc và danh sách đơn quá hạn; hiện cần admin theo dõi thủ công. Worker deadline khiếu nại chưa có chính sách xử lý tự động.
- Màn hình vận hành job lỗi/thông báo hết retry để admin dễ xử lý.
- Quy trình thu hồi tiền hàng đã chi cho người bán nếu phát sinh tranh chấp sau chi trả; hoàn tiền chưa chi và hoàn phần thu dư đã có luồng riêng.

AI Stylist và một số lựa chọn đăng nhập chưa hỗ trợ không chặn luồng mua bán cốt lõi; nên ẩn hoặc ghi rõ trạng thái trong bản công khai.

## Phạm vi chưa xác nhận

Chưa truy cập hạ tầng hosting, Google Cloud, dashboard PayOS hoặc backup ngoài repo. Chưa kiểm tra cấu hình domain thật, tải đồng thời hoặc rà soát toàn bộ lỗ hổng phụ thuộc. Vì vậy kết quả test local không phải chứng nhận sẵn sàng production.
