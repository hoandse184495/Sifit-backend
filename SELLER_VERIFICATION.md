# Xác minh chủ shop và tài khoản nhận tiền

Luồng hiện tại dùng **MANUAL_REVIEW**: người bán gửi hồ sơ và ảnh riêng tư, admin trực tiếp kiểm tra. Không còn nút gửi yêu cầu rỗng để được duyệt mô phỏng. Đây không phải tích hợp xác thực tự động của ngân hàng hoặc cơ quan cấp giấy tờ.

## Người bán

Mở **Kênh người bán → Hồ sơ shop**:

1. Lưu ngân hàng nhận tiền: ngân hàng, BIN 6 số, số tài khoản và tên chủ tài khoản.
2. Điền họ tên chủ shop, số điện thoại và địa chỉ liên hệ; **Lưu bản nháp xác minh**. Họ tên cần khớp tên chủ tài khoản; so sánh bỏ dấu, khoảng trắng và chữ hoa/thường.
3. Tải **Ảnh xác minh chủ shop** và **Ảnh sở hữu tài khoản ngân hàng**. Mỗi loại một ảnh JPEG/PNG/WebP tối đa 5 MB. Ảnh phải đủ rõ để admin đối chiếu họ tên và tài khoản; có thể che số dư/giao dịch không liên quan. Không yêu cầu nhập số giấy tờ vào trường dữ liệu riêng.
4. Xác nhận là chủ tài khoản, thông tin chính xác và đồng ý sử dụng hồ sơ cho việc xác minh; bấm **Gửi hồ sơ xác minh shop**.
5. Khi đang chờ duyệt, hồ sơ và ảnh được khóa. Nếu cần bổ sung, đọc lý do của admin rồi lập hồ sơ mới. Hồ sơ/ảnh cũ vẫn được giữ để đối chiếu; không ghi đè hồ sơ đã gửi.

Tải lại trang vẫn giữ bản nháp, ảnh, ngân hàng và kết quả. Có thể xóa/thay ảnh hoặc sửa thông tin khi hồ sơ còn DRAFT. Một shop chỉ có một hồ sơ DRAFT/PENDING hiện hành.

## Admin

Mở **Xác minh shop → Kiểm tra hồ sơ xác minh** hoặc mở thông báo khi có hồ sơ mới:

- Xem thông tin chủ shop và ngân hàng chụp tại lúc lập hồ sơ.
- Bấm **Xem ảnh...** để xem riêng tư hoặc tải ảnh cần đối chiếu. Người mua và shop khác không có quyền xem.
- Ghi căn cứ ít nhất 10 ký tự, xác nhận đã kiểm tra ảnh/thông tin/ngân hàng rồi **Duyệt xác minh shop**; hoặc **Yêu cầu bổ sung hồ sơ** với lý do cụ thể.
- Danh sách có phân trang và bộ lọc chờ kiểm tra/đã xác minh/cần bổ sung. Mở lại hồ sơ để xem lịch sử và quyết định cũ.

Chỉ admin độc lập được duyệt; không được duyệt hồ sơ của chính mình. Hồ sơ mô phỏng cũ không có ảnh/đồng ý/ngân hàng được kiểm tra thì không được duyệt thành hồ sơ thật. Admin có thể từ chối hồ sơ cũ để người bán gửi lại.

## Đổi tài khoản và chi trả

Ngân hàng của hồ sơ được so sánh bằng dấu vân tay SHA-256 từ BIN, số tài khoản và tên chủ tài khoản đã chuẩn hóa:

- Đổi BIN, số tài khoản hoặc đổi chủ tài khoản làm shop cần xác minh lại. Nếu hồ sơ đang PENDING, hồ sơ đó bị từ chối với lý do tài khoản thay đổi; nếu đã VERIFIED, giữ nguyên bằng chứng/quyết định cũ và đổi trạng thái hiện tại của shop thành NOT_SUBMITTED.
- Nếu đổi tài khoản khi hồ sơ còn DRAFT, **Lưu thay đổi hồ sơ nháp** sẽ chụp tài khoản mới và xóa ảnh ngân hàng cũ; cần tải ảnh ngân hàng mới.
- Đổi cách viết tên ngân hàng hoặc viết tên chủ tài khoản có/không dấu nhưng vẫn cùng thông tin nhận tiền không làm mất xác minh.
- Xét tạo và duyệt khoản chi thủ công mới cần hồ sơ MANUAL_REVIEW đã được duyệt khớp tài khoản hiện tại, cùng các điều kiện đơn hàng, thời hạn bảo vệ và không có khiếu nại/hoàn tiền như trước.
- Khi duyệt chi, khoản chi lưu `verificationId` và `bankSnapshot`. Đổi ngân hàng sau đó không đổi người nhận của khoản đã duyệt. Ghi nhận chuyển tiền vẫn đối chiếu hồ sơ/tài khoản đã chốt, đồng thời kiểm tra đơn/shop/người bán còn đủ điều kiện.
- Khoản APPROVED cũ chưa gắn `verificationId` chỉ được gắn hồ sơ sau khi shop đã được xác minh thủ công và hồ sơ khớp chính xác ngân hàng đã chốt của khoản đó. Thông tin người nhận không bị sửa theo ngân hàng mới. Nếu không khớp, hệ thống chặn và yêu cầu đối soát.

Không tự chuyển tiền, không tự duyệt ngân hàng và không bỏ qua điều kiện bảo vệ người mua.

## Hồ sơ mô phỏng cũ và cấu hình

`SELLER_VERIFICATION_MODE` hỗ trợ `manual` (mặc định), `production` và giá trị `simulation` cũ. Các endpoint gửi/duyệt mới luôn dùng MANUAL_REVIEW; `simulation` không cho phép bỏ qua hồ sơ để nhận khoản chi thủ công.

Shop trước đây được đặt VERIFIED bằng mô phỏng vẫn cần gửi hồ sơ thủ công trước khi được xét khoản chi mới. Trạng thái dữ liệu cũ không tự được coi là bằng chứng. Nếu có hồ sơ mô phỏng đang chờ, admin cần yêu cầu bổ sung/từ chối trước khi người bán lập hồ sơ thay thế. Bản cập nhật không sửa trực tiếp dữ liệu development hoặc `.env` hiện có.

MongoDB phải hỗ trợ transaction (replica set). Khi production tắt auto-index, cần tạo index cho `SellerVerification` (một hồ sơ đang mở/owner), `SellerVerificationDocument` (một ảnh/loại/hồ sơ), cùng các trường bổ sung của SellerProfile/SellerPayout trước khi bật luồng mới.

## Dữ liệu, quyền và cạnh tranh

- Ảnh lưu trong collection `SellerVerificationDocument`, tách khỏi hồ sơ, mặc định không chọn trường `data`. Không có URL Cloudinary công khai; xem/tải qua API kiểm tra chủ sở hữu hoặc admin, trả `Cache-Control: private, no-store` và dạng attachment.
- Kiểm tra chữ ký định dạng ảnh trên server; không tin MIME/đuôi tệp từ trình duyệt. Xác thực quyền trước khi nhận upload vào bộ nhớ; giới hạn một tệp/5 MB/không nhận trường phụ.
- Danh sách admin chỉ chứa tóm tắt và tên shop, không trả họ tên pháp lý, địa chỉ, số tài khoản hoặc dữ liệu ảnh. Hồ sơ công khai của shop không chứa thông tin xác minh riêng tư.
- `contentVersion` tăng khi sửa/thêm/xóa ảnh/gửi/duyệt. Submit và quyết định admin cần phiên bản đã đọc; dữ liệu cũ trả 409 thay vì ghi đè quyết định.
- Ngân hàng, gửi/duyệt hồ sơ và duyệt chi trả cùng khóa owner trong transaction. Hai admin xử lý trái nhau chỉ có một quyết định được lưu. Đổi ngân hàng đồng thời duyệt không để lại shop VERIFIED với tài khoản khác.
- Lịch sử, cập nhật hồ sơ/shop, audit admin và notification outbox cùng transaction; lỗi outbox/audit rollback thay đổi. Không tự động đưa ảnh hoặc thông tin ngân hàng thô vào audit chung.
- Thông báo xác minh là thông báo quan trọng, có đường dẫn đến đúng hồ sơ cho người bán/admin. Hồ sơ cũ vẫn truy cập theo đường dẫn đã lưu nếu còn quyền.

## API

| Phương thức và đường dẫn | Mục đích |
| --- | --- |
| POST /api/v1/seller/verification/draft | Người bán lập nháp: legalName, phone, contactAddress; lấy ngân hàng hiện có |
| PUT /api/v1/seller/verification/:id | Sửa ba trường thông tin và expectedVersion; cập nhật snapshot ngân hàng |
| POST /api/v1/seller/verification/:id/documents/:kind | Multipart một trường document |
| DELETE /api/v1/seller/verification/:id/documents/:kind | Xóa ảnh của bản nháp |
| POST /api/v1/seller/verification/submit | verificationId, expectedVersion, ownsAccount=true, consent=true |
| GET /api/v1/seller/verification/status | Trạng thái shop, hồ sơ gần nhất và payoutVerified |
| GET /api/v1/seller-verifications/:id | Chủ shop/admin xem chi tiết và metadata ảnh |
| GET /api/v1/seller-verifications/:id/documents/:kind | Chủ shop/admin tải ảnh riêng tư |
| GET /api/v1/admin/seller-verifications | Phân trang, lọc status=PENDING/VERIFIED/REJECTED |
| PATCH /api/v1/admin/seller-verifications/:id/approve | expectedVersion, reason, checkedDocuments=true |
| PATCH /api/v1/admin/seller-verifications/:id/reject | expectedVersion, reason |

`kind`: OWNER_IDENTITY hoặc BANK_OWNERSHIP. Các endpoint ghi của người bán yêu cầu role SELLER; endpoint xem chi tiết/tải ảnh cho chủ hồ sơ hoặc ADMIN.

## Kiểm thử

Kết quả cuối: **24 suites / 285 tests backend đạt**, gồm 24 test cho xác minh shop; lint backend đạt. Chrome chạy luồng xác minh và integration tổng thể đều đạt, không có lỗi runtime. Frontend build đạt, lint không có lỗi; còn hai cảnh báo Fast Refresh sẵn có trong AppContext/LanguageContext.

```powershell
# C:/Sifit-backend
npm test
npm test -- --runTestsByPath tests/sellerVerification.test.js
npm run lint

# C:/sifit-prototype
npm run test:verification
npm run test:integration
npm run lint
npm run build
```

24 test chuyên biệt bao gồm hồ sơ/ảnh/đồng ý đầy đủ, quyền xem riêng tư, ảnh giả/quá cỡ, cạnh tranh lập nháp/duyệt/đổi ngân hàng, phiên bản cũ, hồ sơ mô phỏng, rollback, chi trả mới bị chặn, giữ ngân hàng của khoản chi đã duyệt và gắn hồ sơ cho khoản chi cũ đúng tài khoản.

Chrome kiểm thử API thật trên MongoDB replica set tạm: đăng nhập người bán/admin, nhập ngân hàng, lưu nháp, upload, gửi duyệt, F5, thông báo, xem/tải ảnh riêng tư, yêu cầu bổ sung, gửi hồ sơ mới, duyệt, lọc lịch sử và đổi ngân hàng. Giao diện desktop/390px không tràn ngang; ảnh ở `C:/sifit-prototype/artifacts/verification`. Không dùng giấy tờ/ngân hàng thật hoặc gọi dịch vụ ngân hàng trong kiểm thử.
