const httpStatus = require('../constants/httpStatus');
const productService = require('../services/product.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listProducts = asyncHandler(async (req, res) => {
  const result = await productService.listPublicProducts(req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Products retrieved');

  res.status(response.statusCode).json(response);
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getPublicProductById(req.params.id);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product retrieved');

  res.status(response.statusCode).json(response);
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(req.body, req.user);
  const response = new ApiResponse(httpStatus.CREATED, { product }, 'Product created');

  res.status(response.statusCode).json(response);
});

const listMyProducts = asyncHandler(async (req, res) => {
  const result = await productService.listMyProducts(req.user, req.query);
  const response = new ApiResponse(httpStatus.OK, result, 'Products retrieved');

  res.status(response.statusCode).json(response);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.params.id, req.body, req.user);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product updated');

  res.status(response.statusCode).json(response);
});

const deleteProduct = asyncHandler(async (req, res) => {
  await productService.softDeleteProduct(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, {}, 'Product deleted');

  res.status(response.statusCode).json(response);
});

const submitProduct = asyncHandler(async (req, res) => {
  const product = await productService.submitProduct(req.params.id, req.user);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Product submitted for approval');

  res.status(response.statusCode).json(response);
});

const uploadImages = asyncHandler(async (req, res) => {
  const product = await productService.uploadImages(req.params.id, req.user, req.files);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Images uploaded');

  res.status(response.statusCode).json(response);
});

const deleteImage = asyncHandler(async (req, res) => {
  const product = await productService.deleteImage(req.params.id, req.params.publicId, req.user);
  const response = new ApiResponse(httpStatus.OK, { product }, 'Image deleted');

  res.status(response.statusCode).json(response);
});

module.exports = {
  createProduct,
  deleteImage,
  deleteProduct,
  getProduct,
  listMyProducts,
  listProducts,
  submitProduct,
  updateProduct,
  uploadImages,
};
