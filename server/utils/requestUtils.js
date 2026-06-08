/**
 * Extract client IP address from request object.
 * Handles proxies and common headers.
 */
function getClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(s => s.trim());
    return ips[0] || null;
  }
  if (req.headers['x-real-ip']) return req.headers['x-real-ip'];
  if (req.headers['x-client-ip']) return req.headers['x-client-ip'];
  if (req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
  return req.ip || req.connection?.remoteAddress || null;
}

module.exports = { getClientIp };
