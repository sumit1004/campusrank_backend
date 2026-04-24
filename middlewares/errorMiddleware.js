/**
 * Global Error Handling Middleware
 * Returns uniform JSON error responses across all routes
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  // Structured logging for better debugging
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} - Error: ${err.message}`);
  if (statusCode === 500) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};

module.exports = { errorHandler };
