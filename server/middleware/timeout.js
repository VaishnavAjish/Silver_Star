const { logger } = require('./logger');

function requestTimeout(ms = 30000) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn('Request timeout', {
          url: req.originalUrl,
          method: req.method,
          timeout: ms,
          correlationId: req.correlationId,
        });
        res.status(408).json({
          error: 'Request timeout',
          message: `Request exceeded ${ms}ms limit`,
          correlationId: req.correlationId,
        });
      }
    }, ms);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
}

module.exports = { requestTimeout };
