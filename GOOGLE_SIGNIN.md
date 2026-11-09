# Đăng nhập Google cho Sifit

## Tạo Client ID

1. Mở https://console.cloud.google.com/auth/clients và đăng nhập tài khoản quản lý Sifit.
2. Tạo/chọn project. Trong Google Auth Platform → Branding, nhập tên Sifit, email hỗ trợ và email liên hệ.
3. Chọn Audience phù hợp. Với ứng dụng External đang Testing, thêm tài khoản thử nghiệm nếu Google yêu cầu.
4. Vào Clients → Create client → Web application.
5. Thêm Authorized JavaScript origins: `http://localhost` và `http://localhost:5173`.
6. Tạo client, sao chép Client ID có đuôi `.apps.googleusercontent.com`.

Popup/callback được sử dụng, không cần Authorized redirect URI cho luồng này. Không cần Client Secret. Không dùng service-account key, API key hoặc access token thay cho Client ID.

## Cấu hình dự án

Trong `C:/Sifit-backend/.env`, điền:

```dotenv
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

Giữ `FRONTEND_URL=http://localhost:5173` khi chạy local. Backend và frontend cần dùng cùng hostname để cookie hoạt động.

Khởi động lại backend (`npm run dev`), tải lại trang đăng nhập. Frontend lấy Client ID và nonce từ backend; không cần thêm biến Google vào `.env` frontend.

## Hành vi

- Nút chính thức Google Identity Services tải từ Google khi tính năng đã được cấu hình.
- Người mới được tạo tài khoản BUYER hoặc SELLER theo lựa chọn đăng ký. Không tự đăng ký ADMIN.
- Người đã liên kết được tìm bằng Google `sub`; vai trò tài khoản được giữ nguyên.
- Email trùng tài khoản mật khẩu yêu cầu xác nhận mật khẩu Sifit trước khi liên kết, giữ nguyên id và dữ liệu tài khoản.
- Backend xác minh Google ID token bằng google-auth-library (chữ ký, audience, issuer, thời hạn), email đã xác minh và nonce trùng cookie.
- Nonce lưu dưới dạng hash trong MongoDB, hết hạn sau 10 phút, chỉ dùng thành công một lần. POST yêu cầu Origin frontend chính xác và có giới hạn tần suất.
- Phiên Sifit dùng access JWT và refresh cookie HttpOnly. Google credential không lưu vào localStorage hoặc URL.
- Tài khoản chỉ dùng Google không có mật khẩu Sifit; trang tài khoản hiển thị hướng dẫn phù hợp. Đăng nhập mật khẩu cũ vẫn hoạt động cho tài khoản được liên kết.

## Khi đưa lên hosting

- Thêm origin HTTPS thật vào Google Cloud và cập nhật `FRONTEND_URL`.
- Host phục vụ frontend cần `Cross-Origin-Opener-Policy: same-origin-allow-popups` cho popup khi không dùng FedCM. Vite dev/preview đã cấu hình header này; cấu hình hosting phải làm riêng.
- Nếu host có CSP, cho phép các nguồn Google theo tài liệu chính thức bên dưới.
- Khi `autoIndex` bị tắt ở production, tạo index mới trước khi bật: `users.googleId` unique+sparse; `googleloginchallenges.nonceHash` unique; `googleloginchallenges.expiresAt` TTL với expireAfterSeconds 0. Không dùng syncIndexes để xóa index hiện có.
- Hoàn thành các yêu cầu Branding/Audience/verification mà Google Console hiển thị cho ứng dụng.

## Kiểm thử

```text
# Backend
npm test -- --runTestsByPath tests/googleAuth.test.js tests/auth.test.js --silent

# Frontend, dùng Express + MongoDB tạm và Chrome
node scripts/verify-google-auth.mjs
npm run build
npm run test:integration
```

Kiểm thử trình duyệt Google thay riêng giao diện Google và nguồn khóa bên ngoài, ký token RSA thử nghiệm và dùng bộ kiểm chữ ký thật của Google. Nó không đăng nhập tài khoản Google thật và không dùng database phát triển. Cần Client ID và thao tác đăng nhập Google thật để xác nhận end-to-end với dịch vụ Google.

## Tài liệu chính thức

- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- https://developers.google.com/identity/gsi/web/guides/display-button
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
