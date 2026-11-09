// Tests never inherit live payment credentials or providers from the developer .env.
const process = require('node:process');
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'simulator';
process.env.SHIPPING_PROVIDER = 'simulator';
process.env.PAYOUT_MODE = 'simulation';
process.env.PAYOS_CLIENT_ID = '';
process.env.PAYOS_API_KEY = '';
process.env.PAYOS_CHECKSUM_KEY = '';
process.env.BACKGROUND_JOBS_ENABLED = 'false';
