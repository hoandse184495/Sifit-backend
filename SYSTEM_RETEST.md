# Kiểm thử lại toàn hệ thống Sifit trên local

**Cập nhật sau kiểm thử:** R1–R3 đã được sửa và có hồi quy: 309 tests backend đạt, Chrome tổng thể đạt khi không reset hạn mức, backend local đã nạp lại. Xem [SECURITY_FIXES_R1_R3.md](SECURITY_FIXES_R1_R3.md). Các mô tả/bằng chứng dưới đây ghi nhận tình trạng trước bản sửa; script probe hiện kiểm tra kết quả an toàn sau sửa.

Ngày rà soát: 09/11/2026. Phạm vi: backend `C:/Sifit-backend`, frontend `C:/sifit-prototype`, các luồng người mua/người bán/admin và các tình huống quyền/cạnh tranh bổ sung.

**Kết luận của lượt rà soát trước bản sửa:** Các luồng mua bán chính chạy được, nhưng đã xác nhận 2 lỗi ưu tiên cao về khóa tài khoản/quản trị và 1 vấn đề hạn mức API gây lỗi ngay trong demo local. Cả ba hiện đã được xử lý như cập nhật bên trên.

## Kết quả chạy thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ backend Jest | **24 suites / 285 tests đạt** |
| Backend lint | Đạt, gồm script probe mới |
| Frontend lint | Không có lỗi; 2 cảnh báo Fast Refresh sẵn có ở AppContext/LanguageContext |
| Frontend build | Đạt; có thông báo thời gian xử lý plugin, không làm build thất bại |
| Google, hồ sơ cá nhân, báo cáo sản phẩm, mặc cả | Các browser script riêng đều đạt |
| Danh mục shop, theo dõi shop | Các browser script riêng đều đạt |
| Hoàn tiền, khiếu nại/trả hàng, ngoại lệ thanh toán | Các browser script riêng đều đạt |
| Xác minh shop | Browser script đạt, gồm gửi lại và đổi ngân hàng |
| F5 chi tiết sản phẩm và bộ lọc/chuyển trang nhanh | Probe browser đạt; kiểm tra thời điểm lọc 3 lượt |
| Integration tổng thể nguyên trạng | **Không đạt** ở kiểm duyệt sản phẩm: API 429, trang admin không tải danh sách |
| Integration tổng thể với IP budget của app test được reset mỗi giây | Đạt toàn bộ luồng; kết quả này không xóa hoặc sửa lỗi hạn mức thực tế |
| Browser PayOS cũ | Ban đầu không tới chi trả vì fixture chỉ đặt cờ VERIFIED, không có hồ sơ thủ công được duyệt |
| Browser PayOS sau cập nhật fixture | Đạt từ checkout/QR/webhook có chữ ký đến giao nhận, admin hoàn tất và ghi nhận chi trả |
| Probe quyền socket, hạn mức và admin cạnh tranh | Tái hiện các lỗi R1–R3 bên dưới |

Đã chạy 13 kịch bản browser độc lập: 11 đạt ở lượt đầu, 2 thất bại do hạn mức và fixture cũ. Luồng PayOS đạt sau sửa fixture; luồng tổng thể đạt khi cô lập hạn mức test, còn cấu hình hạn mức của ứng dụng vẫn cần sửa.

Các kiểm thử dùng MongoDB tạm, tài khoản/dữ liệu giả, PayOS/Google/Cloudinary được cô lập ở điểm gọi ngoài. Không sửa database development, không đăng ký lại webhook, không gọi chuyển tiền/ngân hàng thật. Kết nối Vite của người dùng được giữ nguyên.

## Lỗi đã xác nhận

### R1 — Cao: tài khoản bị khóa vẫn gửi và nhận chat bằng socket đang mở

Tái hiện bằng server Socket.IO thật và API admin thật:

1. Người mua đăng nhập, mở socket và tham gia phòng chat khi còn ACTIVE.
2. Admin khóa tài khoản: API trả 200, trạng thái trong database thành SUSPENDED.
3. Cùng tài khoản gửi tin qua REST: bị chặn 403 như mong đợi.
4. Socket đã mở trước đó vẫn kết nối; `message:send` trả `ok=true`, tin được lưu vào database.
5. Khi người bán gửi trả lời, socket của tài khoản bị khóa vẫn nhận `message:new`.

Bằng chứng probe: `restSendHTTP=403`, `socketStillConnected=true`, `socketSendAccepted=true`, `messagePersisted=true`, `receivesNewMessages=true`.

Nguyên nhân: `src/socket/socketAuth.middleware.js:27` chỉ kiểm tra trạng thái khi kết nối; sau đó lưu `socket.user`. `src/socket/chat.handlers.js:75` tiếp tục sử dụng đối tượng này cho từng tin; `src/services/adminUser.service.js:55` thu hồi refresh session nhưng không ngắt socket đang tồn tại.

Hướng sửa: khi khóa tài khoản, ngắt toàn bộ socket của user; kiểm tra lại trạng thái/quyền trên các sự kiện ghi và trước khi cho vào phòng. Bổ sung hồi quy cho khóa khi đã mở chat, gửi/nhận sau khóa và kết nối lại.

### R2 — Cao: hai admin khóa nhau đồng thời có thể làm mất toàn bộ admin hoạt động

Tái hiện **3/3 lượt trong mỗi lần chạy probe**, bằng 2 HTTP request đồng thời:

1. Hệ thống có đúng 2 admin ACTIVE: A và B.
2. A khóa B cùng lúc B khóa A.
3. Cả hai request đều trả 200; số admin ACTIVE sau đó bằng 0.

Nguyên nhân: `src/services/adminUser.service.js:45` đọc số admin hoạt động rồi `save()` tài khoản đích ở bước riêng. Hai request đều có thể đọc số lượng 2 trước khi cập nhật.

Hướng sửa: tuần tự hóa quyết định thay đổi tập admin bằng một khóa/bản ghi điều phối dùng chung, kiểm tra còn ít nhất một admin ACTIVE và cập nhật/audit trong transaction. Transaction chỉ khóa hai tài khoản khác nhau vẫn chưa đủ ngăn hai quyết định cùng thông qua. Request đến sau cần bị từ chối khi không còn đủ admin.

Đây là lỗi quản lý tài khoản admin, khác với lỗi ghi đè quyết định khiếu nại F2 đã sửa trước đây.

### R3 — Vừa: hạn mức REST dùng chung làm chặn cả thao tác bình thường và đăng nhập

`src/middlewares/rateLimit.middleware.js:5` đặt giới hạn **100 request/15 phút/IP**. `src/app.js:29` áp dụng lên hầu hết REST API, cả danh mục, health và đăng nhập.

Bằng chứng:

- Integration browser nguyên trạng bị 429 khi vừa thực hiện luồng đăng sản phẩm/kiểm duyệt với các vai trò cùng localhost. Trang admin hiển thị `Too many requests, please try again later`.
- Probe gửi 100 GET health thành công; request danh mục kế tiếp trả 429, request đăng nhập sau đó cũng trả 429.

Hướng sửa: tách ngân sách cho đăng nhập/thao tác nhạy cảm, truy vấn danh mục/polling và webhook; dùng khóa theo người dùng khi phù hợp và giữ cơ chế chống spam. Không chỉ tắt limiter để làm test xanh. Health check nên có cách kiểm tra không tiêu hao ngân sách của khách.

## Vấn đề trong bộ kiểm thử đã xử lý

`scripts/verify-payos-workflow.mjs` từng tạo profile VERIFIED trực tiếp nhưng không tạo hồ sơ MANUAL_REVIEW khớp ngân hàng. Quy tắc ứng dụng mới chặn chi trả này là đúng.

Đã cập nhật fixture của script bằng service lập nháp → tải hai ảnh giả → gửi → admin duyệt đúng tài khoản. Sau đó script đạt tới ghi nhận chi trả PAID. Không hạ điều kiện xác minh trong ứng dụng.

Đã thêm `scripts/audit-rate-isolated-integration.mjs` để tiếp tục kiểm tra các tính năng sau điểm bị 429. Script chỉ reset bộ đếm trong app/database tạm; middleware sản phẩm không thay đổi. Kết quả nguyên trạng bị lỗi được giữ trong log riêng.

## Chức năng còn thiếu hoặc chưa trọn luồng

| Chức năng | Hiện trạng xác nhận |
| --- | --- |
| Quên mật khẩu, xác minh email thường | Chưa có API/token/form gửi và xác minh hoàn chỉnh; phần người dùng đã tạm hoãn. Google có xác thực riêng |
| Nhắc chuẩn bị/gửi hàng, quản lý đơn quá hạn | Chưa có luồng nhắc/escalation đầy đủ; cần admin theo dõi thủ công. Worker deadline khiếu nại mới ghi log |
| Gửi ảnh trong chat | API/model hỗ trợ IMAGE, giao diện xem ảnh có sẵn; ô soạn hiện chỉ gửi text, chưa có nút upload ảnh |
| Sửa/tạm ngừng tin đang bán từ phía người bán | Chỉ DRAFT/REJECTED có nút sửa và API cho sửa. Chưa có quy trình sửa tin ACTIVE rồi kiểm duyệt lại |
| Màn hình quản trị job lỗi/thông báo hết retry | Có lưu job/retry trong backend, chưa có màn hình xử lý dành cho admin |
| AI Stylist, Facebook/Apple | AI Stylist hiện báo chưa khả dụng; hai nút đăng nhập chỉ báo chưa hỗ trợ |

Giao hàng và chi trả thủ công là lựa chọn đã thống nhất; không coi việc chưa tự đặt ship/chuyển tiền là lỗi. Chưa thực hiện đánh giá hosting/production trong lượt kiểm thử local này.

## Bằng chứng và cách chạy lại

Backend:

```powershell
npm test
npm run lint
node scripts/auditLocalSystem.js
```

Frontend:

```powershell
npm run lint
npm run build
npm run test:integration
node scripts/audit-rate-isolated-integration.mjs
node scripts/verify-payos-workflow.mjs
npm run test:verification
npm run test:refunds
npm run test:returns
npm run test:payment-exceptions
node scripts/audit-catalog-timing.mjs
```

- Backend: `artifacts/system-audit/backend-tests.log`, `backend-lint.log`, `local-probes.log`, `local-probes.json`.
- Frontend: `C:/sifit-prototype/artifacts/system-audit/browser-results.json` lưu kết quả lượt chạy đầu; các log từng script nằm cùng thư mục. Log chạy lại là `integration-rate-isolated.log` và `payos-workflow-current-fixture.log`.
- Các script riêng còn lại: `verify-google-auth.mjs`, `verify-profile.mjs`, `verify-product-reports.mjs`, `verify-offers.mjs`, `verify-shop-catalog.mjs`, `verify-shop-follows.mjs`.

Các probe mới chưa được thêm vào 285 test Jest cũ, nên việc toàn bộ test cũ đạt không chứng minh R1–R3 đã được sửa. Trong lượt này chỉ cập nhật công cụ/fixture kiểm thử và báo cáo; ba lỗi nghiệp vụ vẫn cần xử lý.

**Thứ tự sửa đề xuất:** R1 (socket sau khóa) → R2 (giữ admin hoạt động) → R3 (hạn mức), sau đó chọn các tính năng còn thiếu theo yêu cầu bài.
