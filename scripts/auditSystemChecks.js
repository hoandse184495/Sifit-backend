// Audit probes use a disposable replica set and never inherit live payment keys.
Object.assign(process.env, {
  NODE_ENV: 'test',
  BACKGROUND_JOBS_ENABLED: 'false',
  PAYMENT_PROVIDER: 'simulator',
  SHIPPING_PROVIDER: 'simulator',
  PAYOUT_MODE: 'simulation',
  PAYOUT_HOLD_DAYS: '0',
  PAYOS_CLIENT_ID: '',
  PAYOS_API_KEY: '',
  PAYOS_CHECKSUM_KEY: '',
});
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const run = async () => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = mongo.getUri();
  try {
    require('../src/app');
    const User = require('../src/models/user.model');
    const Shop = require('../src/models/sellerProfile.model');
    const Order = require('../src/models/order.model');
    const Group = require('../src/models/checkoutGroup.model');
    const Payment = require('../src/models/payment.model');
    const Commission = require('../src/models/commission.model');
    const Payout = require('../src/models/sellerPayout.model');
    const Dispute = require('../src/models/dispute.model');
    const settlements = require('../src/services/settlementEligibility.service');
    const refunds = require('../src/services/refund.service');
    const disputes = require('../src/services/dispute.service');
    await mongoose.connect(mongo.getUri());
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    const [buyer, seller, admin] = await User.create(
      ['BUYER', 'SELLER', 'ADMIN'].map((role, index) => ({
        role,
        fullName: `Audit ${role}`,
        email: `audit${index}@fixture.test`,
        passwordHash: 'fixture',
      })),
    );
    await Shop.create({
      userId: seller._id,
      shopName: 'Audit Shop',
      shopSlug: 'audit-shop',
      verificationStatus: 'VERIFIED',
    });
    const past = new Date(Date.now() - 10 * 86400000);
    const groups = await Group.create(
      Array.from({ length: 51 }, () => ({
        buyerId: buyer._id,
        idempotencyKey: crypto.randomUUID(),
        requestFingerprint: 'audit',
        subtotal: 100000,
        buyerTotal: 100000,
        paymentStatus: 'PAID',
        orderStatus: 'COMPLETED',
        reservationExpiresAt: past,
      })),
    );
    const orders = await Order.create(
      groups.map((group) => ({
        checkoutGroupId: group._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        items: [
          {
            productId: new mongoose.Types.ObjectId(),
            title: 'Audit item',
            price: 100000,
            quantity: 1,
          },
        ],
        shippingAddress: {
          recipientName: 'Audit Buyer',
          phone: '0901234567',
          addressLine: 'Test street',
          ward: 'Ward',
          city: 'City',
        },
        subtotal: 100000,
        buyerTotal: 100000,
        commissionRateBasisPoints: 1000,
        commissionAmount: 10000,
        sellerProceeds: 90000,
        paymentStatus: 'PAID',
        orderStatus: 'COMPLETED',
        deliveredAt: past,
        protectionEndsAt: past,
        completedAt: past,
        completedBy: admin._id,
        reservationExpiresAt: past,
      })),
    );
    await Commission.create(
      orders.map((order) => ({
        orderId: order._id,
        sellerId: seller._id,
        subtotal: 100000,
        commissionRateBasisPoints: 1000,
        commissionAmount: 10000,
        sellerProceeds: 90000,
      })),
    );
    const first = await settlements.evaluateEligibleOrders();
    const second = await settlements.evaluateEligibleOrders();
    const payoutCount = await Payout.countDocuments();
    const report = {
      payoutBatch: {
        completedOrders: orders.length,
        firstEligible: first.eligibleCount,
        secondEligible: second.eligibleCount,
        totalPayouts: payoutCount,
        stillEligibleWithoutPayout: 0,
      },
    };
    for (const order of orders)
      if ((await settlements.explainEligibility(order)).eligible)
        report.payoutBatch.stillEligibleWithoutPayout += 1;

    const payment = await Payment.create({
      checkoutGroupId: groups[50]._id,
      buyerId: buyer._id,
      provider: 'payos',
      providerPaymentId: 'audit-local-only',
      merchantReference: '12345678',
      amount: 100000,
      status: 'SUCCEEDED',
      idempotencyKey: crypto.randomUUID(),
      requestFingerprint: 'audit',
      expiresAt: past,
    });
    try {
      await refunds.requestRefund({
        paymentId: payment._id,
        amount: 100000,
        idempotencyKey: crypto.randomUUID(),
        reason: 'Audit local probe',
      });
      report.payosRefund = { unexpectedlySucceeded: true };
    } catch (error) {
      report.payosRefund = { statusCode: error.statusCode, message: error.message };
    }

    const dispute = await Dispute.create({
      orderId: orders[50]._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      reason: 'ITEM_NOT_AS_DESCRIBED',
      description: 'Audit concurrent admin decisions',
      status: 'UNDER_REVIEW',
    });
    const decisions = await Promise.allSettled([
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_BUYER',
        resolution: 'Buyer decision from tab one',
      }),
      disputes.resolveDispute(dispute._id, admin, {
        status: 'RESOLVED_SELLER',
        resolution: 'Seller decision from tab two',
      }),
    ]);
    const persisted = await Dispute.findById(dispute._id);
    report.concurrentDispute = {
      responses: decisions.map((result) => result.status),
      savedResolutionCount: persisted.auditHistory.filter((item) => item.action === 'RESOLVE')
        .length,
      finalStatus: persisted.status,
    };
    const Product = require('../src/models/product.model');
    const Category = require('../src/models/category.model');
    const category = await Category.create({ name: 'Audit category', slug: 'audit-category' });
    const product = await Product.create({
      sellerId: seller._id,
      categoryId: category._id,
      title: 'Audit active garment',
      description: 'Visibility fixture',
      price: 100000,
      size: 'M',
      condition: 'GOOD',
      status: 'ACTIVE',
    });
    await User.updateOne({ _id: seller._id }, { status: 'SUSPENDED' });
    const listing = await require('../src/services/product.service').listPublicProducts({
      page: 1,
      limit: 20,
    });
    let shopStatus = 200;
    try {
      await require('../src/services/sellerProfile.service').getPublicShop('audit-shop');
    } catch (error) {
      shopStatus = error.statusCode;
    }
    report.suspendedSellerVisibility = {
      catalogueShowsProduct: listing.items.some((item) => item._id.equals(product._id)),
      publicShopStatus: shopStatus,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
};
run().catch((error) => {
  console.error(`Audit probe failed: ${error.name}`);
  process.exitCode = 1;
});
