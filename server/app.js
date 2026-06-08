'use strict';

require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { logger, correlationIdMiddleware } = require('./middleware/logger');
const { requestDedupMiddleware } = require('./middleware/requestDedup');
const { requestTimeout } = require('./middleware/timeout');
const { streamResponse } = require('./middleware/streamResponse');
const { metricsMiddleware, metricsEndpoint } = require('./middleware/metrics');
const { healthCheck } = require('./db/pool');
const { authenticate } = require('./middleware/auth');
const { initTelemetry, shutdownTelemetry } = require('./middleware/tracing');
const { setRLSContext } = require('./middleware/rls');

const app = express();
app.set('trust proxy', 1); // Trust first proxy to allow express-rate-limit to work behind Vite proxy

const helmet = require('helmet');
const securityConfig = require('./config/security');

// ── Security Headers (Helmet & CSP) ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: securityConfig.cspDirectives,
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// ── Compression ───────────────────────────────────────────────────────────
app.use(compression({ level: 6, threshold: 1024 }));

// ── CORS ──────────────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({ origin: corsOrigins, credentials: true }));

// ── Body Parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Observability ─────────────────────────────────────────────────────────
app.use(correlationIdMiddleware);
app.use(metricsMiddleware);

// ── Request Deduplication ──────────────────────────────────────────────────
app.use(requestDedupMiddleware);

// ── Streaming Support ──────────────────────────────────────────────────────
app.use(streamResponse);

// ── Rate Limiting ──────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 30 * 1000, // 30-second window
  max: 5,              // 5 attempts per window
  message: { error: 'Too many login attempts, please try again in 30 seconds' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // don't count successful logins toward the limit
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  message: { error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api', globalLimiter);

// ── Timeout ────────────────────────────────────────────────────────────────
app.use(requestTimeout(parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000));

// ── Metrics Endpoint (authenticated) ──────────────────────────────────────────────
// SECURITY: Prometheus metrics expose request counts, error rates, and query
// patterns. Restrict to authenticated users only.
app.get('/metrics', authenticate, metricsEndpoint);

// ── Health Check (authenticated) ───────────────────────────────────────────────
app.get('/api/health', authenticate, async (req, res) => {
  const health = await healthCheck();
  health.uptime = process.uptime();
  health.memory = process.memoryUsage();
  health.correlationId = req.correlationId;
  res.json(health);
});

// ── Global Pagination ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method === 'GET' && req.url.startsWith('/api/')) {
    let { page, pageSize, limit, offset } = req.query;

    if (!limit && !offset && (page || pageSize)) {
      if (!pageSize) pageSize = 500;
      const limitVal = parseInt(pageSize, 10);
      const pageVal = parseInt(page, 10) || 1;

      req.query.limit = String(limitVal > 0 ? limitVal : 500);
      req.query.offset = String((pageVal - 1) * limitVal);
    } else if (!limit && !page && !pageSize) {
      req.query.limit = '500';
      req.query.offset = '0';
    }
  }
  next();
});

// ── Route Registrations ───────────────────────────────────────────────────
const authRoutes = require('./routes/auth');

// Auth routes FIRST (no auth required for login/register)
app.use('/api/auth', authRoutes);

// ── RLS Context Middleware (applies to authenticated routes needing row-level security) ────────────────
// Apply to all other /api routes (skip auth routes which handle their own auth)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) { console.log('[MW] auth path, skipping'); return next(); }
  console.log('[MW] authenticating path=' + req.path + ' hasAuth=' + !!req.headers.authorization);
  authenticate(req, res, (err) => {
    if (err) { console.log('[MW] auth error=' + err); return next(err); }
    console.log('[MW] auth success, calling setRLSContext for path=' + req.path);
    setRLSContext(req, res, next);
  });
});
const accountsRoutes = require('./routes/accounts');
const journalRoutes = require('./routes/journalEntries');
const dashboardRoutes = require('./routes/dashboard');
const inventoryRoutes = require('./routes/inventory');
const purchaseRoutes = require('./routes/purchaseNotes');
const salesRoutes = require('./routes/invoices');
const vendorRoutes = require('./routes/vendors');
const customerRoutes = require('./routes/customers');
const reportsRoutes = require('./routes/reports');
const processRoutes = require('./routes/processTransactions');
const roughRoutes = require('./routes/roughGrowth');
const growthRunRoutes = require('./routes/growthRuns');
const fixedAssetRoutes = require('./routes/fixedAssets');
const expenseRoutes = require('./routes/expenses');
const paymentRoutes = require('./routes/payments');
const receiptRoutes = require('./routes/receipts');
const bankDepositRoutes = require('./routes/bankDeposits');
const depreciationRoutes = require('./routes/depreciationRuns');
const userRoutes = require('./routes/adminUsers');
const permsRoutes = require('./routes/adminPermissions');
const clipboardRoutes = require('./routes/clipboard');
const createMasterRouter = require('./routes/masterFactory');
const processMasterRoutes = require('./routes/processMaster');
const manufacturingRoutes = require('./routes/manufacturingProcesses');
const costCenterRoutes = require('./routes/costCenters');
const assetTemplateRoutes = require('./routes/assetTemplates');
const bankReconRoutes = require('./routes/bankRecon');
const lotMovementRoutes = require('./routes/lotMovements');
const lotIssueRoutes = require('./routes/lotProcessIssues');
const searchRoutes = require('./routes/search');
const quickCreateRoutes = require('./routes/quickCreate');
const fixedAssetCatsRoutes = require('./routes/fixedAssetCategories');
const jeAllocationsRoutes = require('./routes/jeAllocations');
const debugAccRoutes = require('./routes/debugAccounting');
const jobRoutes = require('./routes/jobs');
const stockTransferRoutes = require('./routes/stockTransfer');
const roleRoutes = require('./routes/roles');

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
// Journal entries: canonical path + legacy alias, single handler via array mount
app.use(['/api/journal', '/api/journal-entries', '/api/general-ledger'], journalRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/inventory', inventoryRoutes);
// Purchase notes: canonical path + legacy alias
app.use(['/api/purchase', '/api/purchase-notes'], purchaseRoutes);
// Sales/invoices: canonical path + legacy alias
app.use(['/api/sales', '/api/invoices'], salesRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/reports', reportsRoutes);
app.use(['/api/process', '/api/process-transactions'], processRoutes);
app.use(['/api/rough', '/api/rough-growth'], roughRoutes);
app.use('/api/growth-runs', growthRunRoutes);
app.use('/api/fixed-assets', fixedAssetRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/bank-deposits', bankDepositRoutes);
app.use('/api/depreciation-runs', depreciationRoutes);
app.use('/api/admin', userRoutes);
app.use('/api/permissions', permsRoutes);
app.use('/api/clipboard', clipboardRoutes);
app.use('/api/master', createMasterRouter('master', {
  alias: 'mst',
}));

// ── Backward-compatible aliases (frontend still uses v1.4 paths) ──────
app.use('/api/items', createMasterRouter('items', {
  columns: ['code', 'name', 'category', 'type', 'default_uom', 'hsn_code', 'reorder_level', 'description', 'status', 'is_capital_asset', 'fixed_asset_category_id'],
  orderBy: 'code',
  joins: 'LEFT JOIN fixed_asset_categories fac ON i.fixed_asset_category_id = fac.id',
  selectExtra: 'fac.name as asset_category_name',
  filterColumns: ['category', 'type', 'status'],
  searchFields: ['name', 'code', 'hsn_code', 'description'],
  alias: 'i',
}));
app.use('/api/departments', createMasterRouter('departments', {
  columns: ['code', 'name', 'head', 'location_id', 'staff_count', 'status'],
  orderBy: 'code',
  joins: 'LEFT JOIN locations l ON d.location_id = l.id',
  selectExtra: 'l.name as location_name',
  searchFields: ['name', 'code', 'head'],
  alias: 'd',
}));
app.use('/api/locations', createMasterRouter('locations', {
  columns: ['code', 'name', 'type', 'address', 'city', 'state', 'manager', 'status'],
  orderBy: 'code',
  searchFields: ['name', 'code', 'city', 'state', 'manager'],
  alias: 'loc',
}));
app.use('/api/machines', createMasterRouter('machines', {
  columns: ['code', 'name', 'type', 'department_id', 'location_id', 'capacity', 'last_service', 'next_service', 'status'],
  orderBy: 'code',
  joins: 'LEFT JOIN departments d2 ON mch.department_id = d2.id LEFT JOIN locations l2 ON mch.location_id = l2.id',
  selectExtra: 'd2.name as department_name, l2.name as location_name',
  searchFields: ['name', 'code', 'type'],
  alias: 'mch',
}));
app.use('/api/uom', createMasterRouter('uom', {
  columns: ['code', 'name', 'symbol', 'type', 'status'],
  orderBy: 'code',
  searchFields: ['name', 'code', 'symbol'],
  alias: 'u',
}));
app.use('/api/expense-categories', createMasterRouter('expense_categories', {
  columns: ['code', 'name', 'gl_account_id', 'monthly_budget', 'status'],
  orderBy: 'code',
  joins: 'LEFT JOIN accounts a2 ON ec.gl_account_id = a2.id',
  selectExtra: 'a2.code as gl_account_code, a2.name as gl_account_name',
  searchFields: ['name', 'code'],
  alias: 'ec',
}));
// ── Admin routes ─────────────────────────────────────────────────────────
// userRoutes has /users/* prefix internally → mount at /api/admin so that
//   GET /api/admin/users, POST /api/admin/users, PUT /api/admin/users/:id, etc. resolve correctly
app.use('/api/admin', userRoutes);
// permsRoutes has /:id/* prefix internally → mount at /api/admin/users
app.use('/api/admin/users', permsRoutes);
app.use('/api/roles', roleRoutes.router);
app.use('/api/debug', debugAccRoutes);

app.use('/api/process-master', processMasterRoutes);
app.use('/api/manufacturing', manufacturingRoutes);
app.use('/api/cost-centers', costCenterRoutes);
app.use('/api/asset-templates', assetTemplateRoutes);
app.use('/api/bank-recon', bankReconRoutes);
app.use('/api/lot-movements', lotMovementRoutes);
app.use('/api/lot-process-issues', lotIssueRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/quick-create', quickCreateRoutes);
app.use('/api/fixed-asset-categories', fixedAssetCatsRoutes);
app.use('/api/je-allocations', jeAllocationsRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/stock-transfer', stockTransferRoutes);

// ── WebSocket Stats (authenticated) ──────────────────────────────────────────
app.get('/api/ws/stats', authenticate, async (req, res) => {
  try {
    const { getMetrics } = require('./services/socketService');
    const metrics = await getMetrics();
    res.json({ ok: true, ...metrics });
  } catch (err) {
    res.status(500).json({ error: err.message, ok: false });
  }
});

// ── Cache Flush (authenticated) ───────────────────────────────────────────
const { clearCache } = require('./middleware/requestDedup');
const cache = require('./db/cache');
app.post('/api/cache/flush', authenticate, async (req, res) => {
  try {
    await cache.flush();
    clearCache();
    res.json({ message: 'Cache flushed', ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message, ok: false });
  }
});

// ── Error Handler ────────────────────────────────────────────────────────
const { errorHandler, notFound } = require('./middleware/errorHandler');
app.use(notFound);
app.use(errorHandler);

// ── Initialize Telemetry ─────────────────────────────────────────────────
if (process.env.OTEL_ENABLED === 'true') {
  initTelemetry().catch(err => logger.warn('Telemetry init failed', { error: err.message }));
}
// NOTE: SIGTERM / SIGINT handlers are registered in index.js — do NOT duplicate here.

// Auto-fix completion mode for Growth processes
require('./db/pool').primaryPool.query("UPDATE process_master SET completion_mode = 'OUTPUT_BASED' WHERE process_group = 'GROWTH'").catch(console.error);

module.exports = app;
