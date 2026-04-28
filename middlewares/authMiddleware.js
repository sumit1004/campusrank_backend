const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token and protect routes
 */
const protect = (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer')) {
    try {
      token = authHeader.split(' ')[1];
      
      if (!token || token === 'null' || token === 'undefined') {
        res.status(401);
        return next(new Error('Not authorized, token is null or undefined'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (error) {
      console.error(`[Auth] Token verification failed: ${error.message}`);
      res.status(401);
      return next(new Error('Not authorized, token invalid or expired'));
    }
  }

  if (!token) {
    res.status(401);
    return next(new Error('Not authorized, no token provided'));
  }
};


/**
 * Middleware to restrict access based on user role
 * @param  {...string} roles - Dynamic roles allowed to pass
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403);
      return next(new Error(`Role: '${req.user ? req.user.role : 'guest'}' is not authorized`));
    }
    next();
  };
};

const optionalProtect = (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Fail silently for optional auth
    }
  }
  next();
};

module.exports = { protect, optionalProtect, authorize, allowRoles: authorize };
