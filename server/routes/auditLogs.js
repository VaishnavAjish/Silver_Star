'use strict';

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * GET /api/audit-logs/overview
 * Fetches grouped audit log data for all users.
 */
router.get('/overview', authenticate, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize) || 30, 100);
    const offset = (page - 1) * pageSize;

    // Get total unique users in audit_logs
    const countQuery = `
      SELECT COUNT(DISTINCT user_id) as total 
      FROM audit_logs
    `;
    const countRes = await pool.query(countQuery);
    const totalUsers = parseInt(countRes.rows[0].total) || 0;

    // Get latest action and stats per user
    const dataQuery = `
      WITH UserStats AS (
        SELECT 
          al.user_id,
          COUNT(al.id) as total_actions,
          MAX(al.timestamp) as last_active
        FROM audit_logs al
        GROUP BY al.user_id
      ),
      LatestActions AS (
        SELECT DISTINCT ON (al.user_id) 
          al.user_id,
          al.action,
          al.table_name,
          al.record_id,
          al.ip_address
        FROM audit_logs al
        ORDER BY al.user_id, al.timestamp DESC
      )
      SELECT 
        u.id as user_id,
        u.full_name as user_name,
        u.username,
        u.role,
        us.total_actions,
        us.last_active,
        la.action as latest_action,
        la.table_name as latest_table,
        la.record_id as latest_record_id,
        la.ip_address as latest_ip
      FROM UserStats us
      JOIN LatestActions la ON la.user_id = us.user_id
      LEFT JOIN users u ON u.id = us.user_id
      ORDER BY us.last_active DESC
      LIMIT $1 OFFSET $2
    `;

    const { rows } = await pool.query(dataQuery, [pageSize, offset]);

    res.json({
      data: rows,
      total: totalUsers,
      page,
      pageSize
    });
  } catch (err) {
    console.error('[Audit Logs Overview Error]', err);
    res.status(500).json({ error: 'Failed to fetch audit overview' });
  }
});

/**
 * GET /api/audit-logs/user/:userId
 * Fetches detailed history for a specific user.
 */
router.get('/user/:userId', authenticate, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const userId = req.params.userId;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize) || 50, 200);
    const offset = (page - 1) * pageSize;

    // Allow looking up "System" actions when userId is null/0
    let userFilter = 'user_id = $1';
    let params = [userId];
    if (userId === 'null' || userId === '0') {
      userFilter = 'user_id IS NULL';
      params = [];
    }

    const countQuery = `SELECT COUNT(*) FROM audit_logs WHERE ${userFilter}`;
    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count) || 0;

    const dataQuery = `
      SELECT 
        id, 
        timestamp, 
        action, 
        table_name, 
        record_id, 
        new_values, 
        ip_address 
      FROM audit_logs 
      WHERE ${userFilter}
      ORDER BY timestamp DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const { rows } = await pool.query(dataQuery, [...params, pageSize, offset]);

    res.json({
      data: rows,
      total,
      page,
      pageSize
    });
  } catch (err) {
    console.error('[Audit Logs User Error]', err);
    res.status(500).json({ error: 'Failed to fetch user history' });
  }
});

module.exports = router;
