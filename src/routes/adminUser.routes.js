const express = require('express');
const userController = require('../controllers/adminUser.controller');
const sellerController = require('../controllers/adminSeller.controller');
const roles = require('../constants/roles');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/authorize.middleware');
const {
  idParamSchema,
  sellerListSchema,
  updateStatusSchema,
  userListSchema,
  validate,
} = require('../validations/adminUser.validation');

const router = express.Router();

router.use(authenticate, authorize(roles.ADMIN));

router.get('/users', validate(userListSchema), userController.listUsers);
router.get('/users/:id', validate(idParamSchema), userController.getUser);
router.patch('/users/:id/status', validate(updateStatusSchema), userController.updateUserStatus);
router.get('/sellers', validate(sellerListSchema), sellerController.listSellers);
router.get('/sellers/:id', validate(idParamSchema), sellerController.getSeller);
router.patch(
  '/sellers/:id/status',
  validate(updateStatusSchema),
  sellerController.updateSellerStatus,
);

module.exports = router;
