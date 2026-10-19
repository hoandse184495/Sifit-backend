class ApiResponse {
  constructor(statusCode, data = {}, message = 'Operation successful') {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
  }
}

module.exports = ApiResponse;
