const httpStatus = require('../constants/httpStatus');
const categoryService = require('../services/category.service');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

const listCategories = asyncHandler(async (req, res) => {
  const categories = await categoryService.listActiveCategories();
  const response = new ApiResponse(httpStatus.OK, { categories }, 'Categories retrieved');

  res.status(response.statusCode).json(response);
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await categoryService.createCategory(req.body);
  const response = new ApiResponse(httpStatus.CREATED, { category }, 'Category created');

  res.status(response.statusCode).json(response);
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await categoryService.updateCategory(req.params.id, req.body);
  const response = new ApiResponse(httpStatus.OK, { category }, 'Category updated');

  res.status(response.statusCode).json(response);
});

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
};
