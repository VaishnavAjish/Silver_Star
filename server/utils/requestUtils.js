/**
 * Extract client IP address from request object.
 * Handles proxies and common headers.
 */
function getClientIp(req) {
  if (!req) return null;
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    const ips = forwarded.split(',').map(s => s.trim());
    return ips[0] || null;
  }
  if (headers['x-real-ip']) return headers['x-real-ip'];
  if (headers['x-client-ip']) return headers['x-client-ip'];
  if (headers['cf-connecting-ip']) return headers['cf-connecting-ip'];
  return req.ip || req.connection?.remoteAddress || null;
}

module.exports = { getClientIp };
