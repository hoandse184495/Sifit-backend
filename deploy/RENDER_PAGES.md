# Deploy hai repo, khong can Docker

FE va BE giu nguyen hai repository rieng. Khong gop code va khong copy secret BE sang FE.

| Thanh phan | Repository | Branch | Hosting |
| --- | --- | --- | --- |
| FE | TuanKhang-SE/sifit-prototype | frontend-api-seller-ui | Cloudflare Pages |
| BE | hoandse184495/Sifit-backend | main | Render Web Service, runtime Node |

## File env rieng

- `Sifit-backend/.env`: local development, da bo sung key con thieu; giu nguyen gia tri cu.
- `Sifit-backend/.env.production`: file rieng de import vao Environment cua Render. Da tao secret production khac local va dien Cloudinary tu cau hinh hien co. Khong co PORT co dinh; Render tu cap PORT. Node dotenv khong tu dong doc file nay: phai import tren hosting.
- `sifit-prototype/.env`: local development.
- `sifit-prototype/.env.production`: gia tri production FE; co the build local hoac nhap cac bien vao Cloudflare Pages. Bien tren dashboard uu tien hon file local.

Tat ca file `.env` va `.env.production` deu bi Git ignore. Push code khong tu dong chuyen env len hosting. Khong bo ignore va khong commit secret. Ban backup local truoc khi them key la `.env.before-deploy.local` neu co thay doi.

## Thong tin can thay

1. Thay `your-domain.example` bang domain thuc trong ca hai file production. FE dung domain goc; BE dung `api.DOMAIN`.
2. Thay MONGODB_URI trong BE bang Atlas URI thuc (database rieng sifit_demo), bao gom user/password da URL encode khi can. Khong dung localhost cho database tren Render.
3. Xac nhan tai khoan Cloudinary hien co duoc dung cho ban demo. Google va khoa PayOS de trong; thanh toan tat.

## Render

- Repo BE, branch main, runtime Node, root directory de trong.
- Build: `npm ci --omit=dev`
- Pre-deploy: `npm run db:prepare && npm run seed:categories`
- Start: `npm start`
- Health: `/api/v1/health`
- Import noi dung `Sifit-backend/.env.production` vao Environment sau khi thay placeholder. Khong upload file nay vao GitHub.
- Them custom domain `api.DOMAIN`. Tao DNS record theo Render va verify HTTPS.
- Dung instance khong sleep neu can truy cap on dinh va job nen lien tuc. Pre-deploy command tren Render can loai dich vu tra phi ho tro tinh nang nay.

## Cloudflare Pages

- Repo FE, production branch frontend-api-seller-ui, root directory de trong.
- Build: `npm run build`; output: `dist`.
- Nhap cac key/value trong `sifit-prototype/.env.production` vao Production environment truoc khi build.
- Them custom domain DOMAIN trong Pages. Hai URL FE/API phai deu la HTTPS va cung domain goc.
- Khong dat JWT, database password, Cloudinary secret hay PayOS secret vao VITE_ variables.
- Moi khi doi VITE_ variables, tao deploy moi de build lai FE.

Kiem tra API health, login/F5/logout, anh va chat qua domain thuc. Tao admin bang bootstrap script theo README deploy, sau do seller dang san pham va admin duyet. Auto-deploy cua moi dich vu theo doi branch rieng; khi thay ca BE/FE, deploy BE truoc va giu API tuong thich cho den khi FE deploy xong.

Nguon: https://render.com/docs/deploy-node-express-app ; https://render.com/docs/deploys ; https://developers.cloudflare.com/pages/configuration/custom-domains/
