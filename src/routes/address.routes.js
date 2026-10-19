const express = require('express');
const addressController = require('../controllers/address.controller');
const authenticate = require('../middlewares/auth.middleware');
const {
  createAddressSchema,
  idParamSchema,
  updateAddressSchema,
  validate,
} = require('../validations/address.validation');

const router = express.Router();

router.use(authenticate);
router.get('/', addressController.listAddresses);
router.post('/', validate(createAddressSchema), addressController.createAddress);
router.patch('/:id', validate(updateAddressSchema), addressController.updateAddress);
router.delete('/:id', validate(idParamSchema), addressController.deleteAddress);
router.patch('/:id/default', validate(idParamSchema), addressController.setDefaultAddress);

module.exports = router;
