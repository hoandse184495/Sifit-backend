# Sửa ba lỗi R1–R3 và lỗi Too many requests khi chạy local

Đã sửa các lỗi được xác nhận trong [SYSTEM_RETEST.md](SYSTEM_RETEST.md). Backend local đã được nạp lại và kiểm tra ở cổng 5000; không cần chờ hết cửa sổ hạn mức 15 phút của tiến trình cũ. Tải lại trang web một lần nếu giao diện còn giữ thông báo lỗi trước đó.

## R1: khóa tài khoản ngắt toàn bộ chat đang mở

- Sau khi giao dịch khóa tài khoản thành công, backend gửi sự kiện `account:suspended` rồi ngắt tất cả socket thuộc người đó, gồm nhiều tab trình duyệt.
- Frontend xóa access token trong bộ nhớ và kết thúc phiên hiển thị khi nhận sự kiện. Sau khi admin mở khóa, người dùng đăng nhập lại để có phiên mới.
- Socket kiểm tra lại User ACTIVE trong database cho mỗi packet, trước khi gửi tin, vào phòng, đánh dấu đọc hoặc phát typing. Đối tượng user giữ từ lần bắt tay không còn được coi là trạng thái hiện tại.
- Kiểm tra lại ngay sau khi tham gia phòng user để xử lý trường hợp tài khoản bị khóa giữa bước xác thực kết nối và bước khởi tạo socket.
- Handler chat được cài trước khi chờ presence để không làm rơi sự kiện đầu tiên khi mới kết nối; bộ đếm socket được dọn lúc ngắt kết nối.
- Không ngắt socket nếu transaction khóa tài khoản bị rollback. Lỗi database tạm thời khi kiểm tra packet không bị báo nhầm là quyết định khóa tài khoản.

## R2: luôn giữ ít nhất một admin hoạt động

`AdminGuard` có một bản ghi `_id=active-admins`. Mọi thay đổi trạng thái user được tuần tự hóa trên bản ghi này trong MongoDB transaction.

Trong cùng transaction, hệ thống kiểm tra lại actor vẫn là admin ACTIVE, chặn tự khóa, kiểm tra số admin hoạt động, cập nhật user, thu hồi refresh session và ghi audit. Hai admin khóa nhau đồng thời chỉ có một thao tác thành công; thao tác sau trả 403/409 và vẫn còn một admin ACTIVE.

Nếu audit hoặc cập nhật session lỗi, toàn bộ trạng thái/session/audit rollback. Việc ngắt socket chỉ diễn ra sau commit. Shop bị khóa qua trang quản lý cửa hàng cũng gọi cơ chế cập nhật user này.

Yêu cầu MongoDB replica set giống các luồng thanh toán hiện có. Bản ghi guard tự được tạo an toàn; không cần thay đổi thủ công tài khoản hoặc dữ liệu người dùng.

## R3: tách hạn mức theo tác vụ và người dùng

Đã bỏ ngân sách chung 100 request/15 phút/IP vốn khiến xem danh mục, thông báo hoặc polling làm chặn luôn đăng nhập.

| Nhóm | Mặc định | Khóa bộ đếm |
| --- | --- | --- |
| GET/HEAD, gồm danh mục và polling | 600/phút | User từ JWT đã kiểm tra chữ ký; chưa đăng nhập dùng IP |
| Thao tác ghi thông thường | 120/phút | User từ JWT đã kiểm tra chữ ký; chưa đăng nhập dùng IP |
| Đăng nhập mật khẩu sai | 60 lần/15 phút/IP và 12 lần/15 phút/IP + email | Hai bộ đếm riêng; lần đăng nhập thành công không tích lũy |
| Google thất bại | 30 lần/15 phút/IP | Tách khỏi đăng nhập mật khẩu; thành công không tích lũy |
| Đăng ký tài khoản | 60 lần/15 phút/IP | Vẫn đếm lần thành công để chống tạo tài khoản hàng loạt |
| Refresh/logout | 120/phút/IP | Tách khỏi tải dữ liệu và đăng nhập |
| REST tạo hội thoại/gửi chat | Theo CHAT_MAX_MESSAGES_PER_MINUTE, mặc định 30/phút | User thay vì cộng mọi người dùng cùng IP |
| Webhook thanh toán | 300/phút/IP | Ngân sách riêng như luồng thanh toán trước đó |

Health check và OPTIONS không tiêu hao ngân sách khách hàng. IPv6 dùng chuẩn hóa subnet; không dùng JWT chỉ decode hoặc ID do client tự khai báo để tách ngân sách.

Nếu thực sự vượt mức, response 429 có thông báo tiếng Việt, `Retry-After`, `retryAfterSeconds` và scope. Frontend có thể hiển thị đúng thời gian cần chờ. CORS cho phép đọc các header hạn mức.

Hai mức tải/ghi có thể điều chỉnh trong `.env`; nếu không khai báo sẽ dùng mặc định:

```dotenv
RATE_LIMIT_READ_PER_MINUTE=600
RATE_LIMIT_WRITE_PER_MINUTE=120
```

Không cần đổi khóa bí mật hoặc cấu hình PayOS để áp dụng bản sửa. Bộ đếm đang dùng trong bộ nhớ của một tiến trình backend; khi triển khai nhiều instance cần kho bộ đếm dùng chung và adapter socket phù hợp.

## Kiểm chứng

- **26 suites / 309 tests backend đạt**, gồm 24 kiểm thử mới cho rate limit và quyền/quản trị; lint backend đạt.
- Chrome integration tổng thể đạt với `SIFIT_TEST_KEEP_RATE_COUNTERS=true`: không reset budget giữa các tình huống, không dùng timer xóa hạn mức để làm test xanh.
- Kiểm thử browser mới xác nhận người bán đang mở web bị đăng xuất khi admin khóa; sau mở khóa có thể đăng nhập lại.
- Frontend lint không lỗi, còn hai cảnh báo Fast Refresh sẵn có; build đạt.
- Probe từng tái hiện lỗi: socket đã khóa không kết nối/gửi/nhận; 3 lượt hai admin khóa nhau đều còn một admin ACTIVE, chỉ một HTTP request thành công; 100 health check không chặn danh mục hoặc đăng nhập.
- Kiểm tra trên backend local vừa nạp: **110/110 health check HTTP 200**, danh mục HTTP 200, `/auth/me` khi không gửi token trả 401 đúng quyền thay vì 429; policy thực tế `api-read, q=600, w=60`.

Kiểm thử ghi dùng database tạm và dữ liệu giả, không chuyển tiền hoặc thao tác tài khoản thật. Smoke test trên backend đang dùng chỉ gọi các API đọc công khai/kiểm tra phiên không có token.

## Chạy lại

```powershell
# Backend
npm test
npm run lint
npm test -- --runTestsByPath tests/rateLimits.test.js tests/securityFixes.test.js
node scripts/auditLocalSystem.js

# Frontend
$env:SIFIT_TEST_KEEP_RATE_COUNTERS = 'true'
npm run test:integration
npm run lint
npm run build
```

Log backend ở `artifacts/security-fixes/`; log Chrome/build ở `C:/sifit-prototype/artifacts/security-fixes/`. Log tiến trình backend local được nạp ở `.local-tools/backend-runtime.stdout.log` và `.stderr.log`, PID ở `.local-tools/backend-runtime.pid`.
