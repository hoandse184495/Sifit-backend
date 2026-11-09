# Rà soát chức năng Sifit

**Cập nhật bản sửa R1–R3:** Đã ngắt socket khi khóa tài khoản, tuần tự hóa thay đổi admin và tách hạn mức tải/ghi/đăng nhập theo người dùng. Backend đạt 26 suites / 309 tests; Chrome tổng thể đạt khi không reset budget. Xem [SECURITY_FIXES_R1_R3.md](SECURITY_FIXES_R1_R3.md). Bằng chứng rà soát trước bản sửa được giữ tại [SYSTEM_RETEST.md](SYSTEM_RETEST.md).

**Cập nhật xác minh shop:** Đã có hồ sơ thủ công, ảnh chủ shop/ngân hàng riêng tư, bản nháp/gửi lại, duyệt có phiên bản và lý do, lịch sử/audit/thông báo. Chi trả thủ công mới cần hồ sơ đã duyệt khớp tài khoản; đổi ngân hàng yêu cầu xác minh lại. Backend đạt 24 suites / 285 tests; Chrome xác minh và integration tổng thể đạt. Xem [SELLER_VERIFICATION.md](SELLER_VERIFICATION.md).

**Cập nhật đối soát PayOS:** Đã có hàng đợi tiền thiếu/dư/đến muộn, truy vấn lại PayOS, quyết định tiếp tục đơn hoặc hoàn tiền chưa phân bổ, ngân hàng/chứng từ riêng tư và lịch sử. Backend đạt 23 suites / 261 tests, gồm 25 test mới cho ngoại lệ tiền. Xem [PAYMENT_EXCEPTIONS.md](PAYMENT_EXCEPTIONS.md).

**Cập nhật khiếu nại/trả hàng:** Đã có ảnh riêng tư, phản hồi hai bên, quyết định yêu cầu trả, vận đơn trả, xác nhận của người bán và bước admin xác minh trước hoàn tiền. Xem [DISPUTE_RETURNS.md](DISPUTE_RETURNS.md).

**Cập nhật hoàn tiền:** Đã bổ sung luồng hoàn PayOS thủ công theo từng đơn, tài khoản nhận tiền, duyệt chuyển khoản, chứng từ riêng tư, chống ghi trùng/vượt tiền, sổ cái và thông báo. Xem [MANUAL_REFUNDS.md](MANUAL_REFUNDS.md). Hoàn khoản thu bất thường đã được bổ sung; thu hồi tiền hàng đã chi vẫn là hạng mục riêng.

**Cập nhật bản sửa ngày 09/11/2026:** F1–F5 bên dưới đã được sửa. Chi tiết thay đổi và cách chạy kiểm thử nằm trong [BUG_FIXES_F1_F5.md](BUG_FIXES_F1_F5.md). Phần mô tả lỗi và số liệu rà soát ban đầu được giữ để đối chiếu; những chức năng bổ sung khác trong báo cáo vẫn là công việc tiếp theo.

Phạm vi: backend `C:/Sifit-backend`, frontend `C:/sifit-prototype`, cấu hình chế độ chạy, các tác vụ nền và bộ kiểm thử hiện có. Rà soát này kiểm tra mã và luồng ứng dụng; chưa xác minh cấu hình tài khoản bên ngoài Google Cloud/ngân hàng, backup ngoài repository hoặc khả năng phục vụ tải lớn trên production. Chỉ đọc cờ cấu hình, không đưa khóa hoặc mật khẩu vào báo cáo.

Luồng mua bán chính đã có. Việc cần ưu tiên hiện tại là sửa các lỗi đã tái hiện và khép kín xử lý tiền/khiếu nại, trước khi thêm tính năng thu hút khách.

**Kết quả kiểm tra tại thời điểm rà soát ban đầu, trước bản sửa**

| Kiểm tra | Kết quả |
| --- | --- |
| Backend lint | Đạt |
| Backend Jest | 19 suites, 183 tests đạt |
| Frontend lint | Không có lỗi; còn 2 cảnh báo Fast Refresh sẵn có ở AppContext/LanguageContext |
| Frontend build | Đạt |
| Browser integration tổng thể | Lượt đầu lỗi chuyển trang danh mục (mong 3 card, nhận 20); chạy lại riêng đạt. Probe riêng tái hiện lỗi thời điểm 3/3 lần |
| Probe backend bổ sung | Tái hiện bỏ sót chi trả sau batch đầu, ghi đè quyết định khiếu nại, chưa hoàn được PayOS và hiển thị hàng của người bán bị khóa |
| Probe frontend bổ sung | Tái hiện đổi bộ lọc/chuyển trang nhanh và trang chi tiết trống sau tải lại |

Các probe dùng MongoDB tạm, khóa PayOS rỗng và nhà cung cấp được cô lập. Không tạo đơn, chuyển tiền hoặc chỉnh trạng thái dữ liệu development trong quá trình rà soát.

**Lỗi đã tái hiện trước bản sửa (F1–F5 hiện đã sửa)**

| Mã | Ưu tiên | Hiện tượng | Hướng hoàn thiện |
| --- | --- | --- | --- |
| F1 | Cao | Xét chi trả 51 đơn đủ điều kiện: lượt đầu tạo 50 khoản; lượt hai tạo 0; vẫn còn 1 đơn đủ điều kiện chưa có khoản chi | Quét tiếp bằng cursor hoặc loại các đơn đã xử lý trước khi giới hạn batch; bảo đảm đơn không đủ điều kiện tạm thời cũng không làm các đơn phía sau bị bỏ đói |
| F2 | Cao | Hai yêu cầu xử lý cùng một khiếu nại theo hai kết quả trái nhau đều thành công; lịch sử lưu 2 quyết định, kết quả cuối ghi đè kết quả trước | Chuyển trạng thái bằng điều kiện nguyên tử từ OPEN/UNDER_REVIEW, trong transaction cùng lịch sử/outbox và khóa đơn đối soát; yêu cầu đến sau trả 409 |
| F3 | Vừa | Từ card mở chi tiết rồi F5: URL chỉ có `view=detail`, không có ID sản phẩm; nội dung chính trống | Gắn ID vào đường dẫn, tải sản phẩm từ API khi truy cập/reload; có loading, 404 và nút quay lại |
| F4 | Vừa | Chọn thương hiệu rồi bấm Trang sau trong khoảng 250 ms: gửi request trang 2 với bộ lọc cũ, sau đó request mới kéo về trang 1; tái hiện 3/3 lần | Đồng bộ bộ lọc đã áp dụng với trạng thái trang; khóa chuyển trang khi đang chờ bộ lọc hoặc chỉ debounce trường cần thiết; tránh hiển thị kết quả cũ như đã áp dụng bộ lọc mới |
| F5 | Vừa | Khóa tài khoản người bán: API shop trả 404 nhưng danh mục chung vẫn trả sản phẩm ACTIVE của người bán đó | Dùng thống nhất quy tắc người bán/shop hoạt động cho danh mục, chi tiết, facets, gợi ý và yêu thích; checkout hiện có kiểm tra seller nên đây là lỗi hiển thị, không phải đã chứng minh mua được hàng của tài khoản bị khóa |

Bằng chứng mã và probe:

- F1: `src/services/settlementEligibility.service.js:52` lấy lại cùng batch đầu bằng `.limit(limit)` trước khi loại đơn đã có payout. Probe xác nhận `firstEligible=50`, `secondEligible=0`, `stillEligibleWithoutPayout=1`.
- F2: `src/services/dispute.service.js:99` đọc trạng thái rồi gán và `save()`, thiếu điều kiện cập nhật chặn lần xử lý thứ hai. Probe xác nhận hai promise `fulfilled`, `savedResolutionCount=2`, kết quả cuối `RESOLVED_SELLER`.
- F3: frontend `src/components/ProductCard.jsx:12` chỉ đưa sản phẩm vào state; `src/pages/ProductDetail.jsx:13` trả `null` khi mất state. Probe xác nhận không có ID trên URL, sản phẩm không hiện sau reload và `mainEmptyAfterReload=true`.
- F4: frontend `src/pages/Catalog.jsx:39` debounce 250 ms trong khi `src/hooks/usePagedResource.js:9` gắn vị trí trang với bộ query đã áp dụng. Probe ghi nhận request trang 2 chưa có thương hiệu rồi request trang 1 có thương hiệu.
- F5: `src/services/product.service.js:53` chỉ lọc trạng thái sản phẩm; `src/services/sellerProfile.service.js` đã kiểm tra tài khoản SELLER/ACTIVE. Probe cho `catalogueShowsProduct=true`, `publicShopStatus=404`.

**Các chức năng quan trọng còn thiếu hoặc mới có một phần**

| Chức năng | Hiện trạng xác nhận | Cần bổ sung |
| --- | --- | --- |
| Hoàn tiền PayOS thực tế | Đã có luồng hoàn chuyển khoản theo từng đơn: admin duyệt khoản, người mua gửi ngân hàng, admin chốt tài khoản/tải chứng từ/ghi nhận chuyển tiền; phân bổ tiền và điều chỉnh khoản chi còn lại, lịch sử, outbox, audit và ledger cùng transaction. Đơn cần trả được chặn đến khi admin xác minh nhận lại | Đã có đối soát khoản thu bất thường riêng. Thu hồi tiền hàng đã chi vẫn cần làm riêng. Không chuyển khoản tự động thay admin |
| Xử lý tiền thiếu/thừa/đến muộn | Đã có hàng đợi admin, biên nhận và số dư xác minh, chờ bổ sung, tiếp tục đơn khi hàng còn sẵn, hoàn tiền chưa phân bổ, lịch sử/audit/outbox, chống ghi đè và hoàn trùng. Tiền dư không làm giảm khoản người bán nhận | Theo dõi vận hành và quy trình thu hồi tiền hàng đã chi; không sửa tay metadata/trạng thái tiền. Chi tiết tại PAYMENT_EXCEPTIONS.md |
| Bằng chứng và trả hàng khi khiếu nại | Đã có ảnh riêng tư JPEG/PNG/WebP, phản hồi hai bên, phiên bản hồ sơ, quyết định trả hàng, vận đơn, xác nhận nhận lại và admin xác minh; chặn hoàn trước xác minh và lưu lịch sử/outbox/audit | Chưa tự kết nối đơn vị vận chuyển, không tự xử lý tiền thu bất thường hoặc tự đăng bán lại hàng trả |
| Xác minh shop | Đã có hồ sơ MANUAL_REVIEW, ảnh riêng tư, đối chiếu chủ shop/ngân hàng, đồng ý của người bán, admin duyệt/yêu cầu bổ sung, lịch sử/thông báo và chặn chi trả nếu chưa xác minh đúng tài khoản | Shop/hồ sơ mô phỏng cũ cần gửi lại. Đây là kiểm tra thủ công, chưa kết nối dịch vụ xác thực danh tính/ngân hàng tự động; hướng dẫn tại SELLER_VERIFICATION.md |
| Quên mật khẩu | Đổi mật khẩu khi đã đăng nhập đã có; reset khi quên chưa có API/token/form | Email đặt lại, token một lần có hạn, chống dò tài khoản và giới hạn gửi. Mục này trước đó được người dùng yêu cầu tạm hoãn |
| Xác minh email tài khoản thường | Có trường `emailVerified`; Google đặt true khi xác thực Google. Đăng ký email/mật khẩu chưa có gửi/xác minh/gửi lại email | Token xác minh một lần, gửi lại có hạn mức, hiển thị trạng thái. Có nodemailer trong dependencies chưa chứng minh luồng gửi mail đã được triển khai |
| Đơn chậm chuẩn bị/giao và khiếu nại tồn | Người bán nhận đơn/bàn giao và admin xử lý giao hàng thủ công đã có. Chưa thấy hạn chuẩn bị/nhắc việc/escalation. Worker deadline khiếu nại hiện chỉ ghi log chưa có chính sách | Mốc thời gian, nhắc người bán, danh sách quá hạn, thông báo admin và quy trình xử lý. Giữ quyết định hoàn tiền/hoàn tất ở admin như luồng đã chọn |
| Quản trị tác vụ và thông báo lỗi | Có lease, retry, phục hồi và lưu kết quả vào MongoDB; chưa có màn hình admin xem job lỗi/hàng đợi hết retry và thao tác giao lại có kiểm soát | Bộ lọc tác vụ lỗi/chậm, cảnh báo và retry có audit; không tự phát lại thao tác chuyển tiền |
| Sửa tin đang bán | Mới sửa được DRAFT/REJECTED; chưa có luồng cập nhật nội dung/giá một tin ACTIVE và gửi duyệt lại hoặc tạm ngừng bán/đăng lại từ giao diện | Trạng thái chỉnh sửa và kiểm duyệt lại, giữ snapshot đơn/giá đã thỏa thuận, thông báo thay đổi; không sửa trực tiếp món RESERVED/SOLD |
| Gửi ảnh trong chat | Model/API có IMAGE và attachments, UI xem được ảnh có sẵn; chưa có nút chọn/tải ảnh lên rồi gửi | Upload ảnh có giới hạn/quyền, xem trước, retry và kiểm tra nội dung. Không nhầm việc có schema attachments với đã có luồng gửi ảnh hoàn chỉnh |

**Những phần đã có, không cần làm lại từ đầu**

| Nhóm | Mức hiện tại |
| --- | --- |
| Tài khoản | Đăng ký/phân vai, đăng nhập thường và Google, refresh/logout, sửa tên/điện thoại/avatar, đổi mật khẩu đang đăng nhập |
| Shop | Tạo/sửa hồ sơ, trang công khai, theo dõi và thông báo sản phẩm mới, tìm/lọc/sắp xếp/phân trang sản phẩm, đánh giá có phân trang |
| Sản phẩm | Bản nháp, ảnh Cloudinary, gửi duyệt, admin duyệt/từ chối/ẩn, báo cáo vi phạm/chống spam/lịch sử |
| Mua hàng | Yêu thích, giỏ, sổ địa chỉ, checkout nhiều người bán, giá/tổng/hoa hồng tính trên server, giữ hàng, hủy đơn hết hạn/trả kho |
| Mặc cả | Gửi/chấp nhận/từ chối/rút/hết hạn, lịch sử riêng tư, giới hạn gửi, áp dụng giá một lần khi checkout |
| Thu tiền | QR PayOS, xác minh chữ ký webhook, chống ghi trùng, biên nhận ngân hàng và bút toán, đối soát định kỳ |
| Giao hàng | Người bán đặt ship ngoài hệ thống rồi ghi mã/bàn giao; theo dõi nội bộ, admin xác minh giao/không giao, người mua xác nhận nhận |
| Hoàn tất/chi trả | Admin hoàn tất, hạn bảo vệ/hold, kiểm tra điều kiện, ngân hàng người bán, duyệt và ghi nhận chuyển khoản có mã tham chiếu; F1 đã sửa bằng cursor lưu trong MongoDB |
| Chat/thông báo | Lịch sử REST, realtime, phân trang tin cũ, đọc/chặn/báo cáo, thông báo trong app và cài đặt, outbox định kỳ |
| Đánh giá | Đánh giá sau mua, ảnh, sửa/xóa trong hạn, trả lời người bán, kiểm duyệt admin, tổng hợp điểm shop |
| Quản trị | Người dùng/shop, danh mục, kiểm duyệt sản phẩm/đánh giá/báo cáo, đơn, tài chính, số liệu theo kỳ, CSV, nhật ký |
| Tự động | Hết hạn đơn/thanh toán và đề nghị giá, trả hàng về kho, giao/thử lại thông báo; cần màn hình vận hành và luồng ngoại lệ |

Giao hàng và chi trả thủ công là lựa chọn đã thống nhất, không coi việc chưa tích hợp GHN/GHTK hay chưa tự chuyển tiền là lỗi. Không cần thêm COD/Momo/VNPAY chỉ để lấp danh sách chức năng khi PayOS là phương thức đã chọn.

**Trước khi vận hành công khai**

Môi trường hiện là development, frontend localhost, PayOS đã có cấu hình, shipping/payout manual, background jobs bật, Google/Cloudinary có giá trị cấu hình, webhook dùng Quick Tunnel tạm. Việc có giá trị cấu hình không xác nhận rằng mọi tài khoản/dịch vụ bên ngoài đã sẵn sàng production.

- Dùng URL HTTPS ổn định cho frontend/API/webhook, cài quy trình chạy lại backend và job sau restart, kiểm tra biến môi trường và index production.
- Chưa thấy cấu hình backup/restore, giám sát/cảnh báo, CI/CD hoặc quy trình khôi phục trong các repository đã đọc; cần kiểm tra cả hạ tầng bên ngoài và diễn tập khôi phục dữ liệu.
- Đã tách hạn mức đăng nhập/read/write theo tác vụ và user có JWT hợp lệ; health check không tiêu hao ngân sách. Integration đã đạt với bộ đếm thật không reset. Nếu triển khai nhiều instance, bổ sung kho đếm và adapter socket dùng chung.
- Bổ sung kiểm thử các F1–F5, hoàn PayOS thủ công, ngoại lệ tiền, tệp riêng tư, job hết retry và tải nhiều người dùng; không lấy 183 test hiện tại làm bằng chứng các tình huống chưa được kiểm tra đã đúng.
- Cập nhật nội dung/hướng dẫn còn cũ: đầu README vẫn mô tả foundation/simulation, một số tài liệu chưa theo kịp workflow hiện tại; thông tin liên hệ cần được chủ dự án xác nhận. Đây là việc nội dung/kỹ thuật, không thay thế việc kiểm tra các yêu cầu triển khai bên ngoài dự án.

**Tính năng tùy chọn, làm sau luồng cốt lõi**

AI Stylist hiện là màn hình thông báo chưa khả dụng. Facebook/Apple trên form đăng nhập hiện chỉ báo chưa hỗ trợ. Voucher/khuyến mãi, gợi ý cá nhân hóa, quảng cáo/đẩy tin, push/email thông báo ngoài app, ticket hỗ trợ, phân quyền admin chi tiết và bổ sung bản dịch có thể xem xét theo yêu cầu bài/định hướng kinh doanh. Chúng chưa cần được ưu tiên hơn sửa lỗi và hoàn tiền/khiếu nại.

**Thứ tự triển khai đề xuất**

1. Đã sửa F1 và F2, bổ sung kiểm thử batch lớn/cạnh tranh ghi quyết định.
2. Đã có hoàn tiền PayOS bằng chuyển khoản có chứng từ và đối soát khoản thu bất thường; thu hồi tiền hàng đã chi cần quy trình riêng.
3. Đã sửa F3–F5 để đường dẫn, bộ lọc và tình trạng shop nhất quán.
4. Đã có bằng chứng khiếu nại/trả hàng và xác minh thủ công người bán; tiếp theo nhắc giao hàng và quản lý đơn quá hạn.
5. Mail xác minh/khôi phục mật khẩu khi tiếp tục phần đã tạm hoãn; chuẩn bị vận hành/giám sát/backup.
6. Các tính năng tùy chọn khi luồng trên đã ổn định.

**Chạy lại chẩn đoán**

Trong backend:

```sh
node scripts/auditSystemChecks.js
```

Trong frontend:

```sh
node scripts/audit-catalog-timing.mjs
```

Script backend in kết quả đối chiếu; script frontend có assertion để kiểm tra F3/F4 và các trạng thái lỗi. Bộ hồi quy backend cho F1/F2/F5 nằm trong `tests/systemFixes.test.js`. Hoàn PayOS thủ công có bộ kiểm thử riêng tại `tests/manualRefund.test.js` và frontend `scripts/verify-manual-refunds.mjs`. Khiếu nại/trả hàng có `tests/disputeCase.test.js` và frontend `scripts/verify-dispute-returns.mjs`. Ngoại lệ tiền có `tests/paymentExceptions.test.js` và frontend `scripts/verify-payment-exceptions.mjs`.
