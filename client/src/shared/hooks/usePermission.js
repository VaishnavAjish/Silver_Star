import { useCallback, useMemo } from 'react';
import { useAuth } from '../../core/context/AuthContext';

/**
 * Enhanced permission hook that checks:
 * 1. Admin role → full access
 * 2. User-level permission overrides (from user_permissions table)
 * 3. Role defaults (ROLE_DEFAULTS)
 *
 * For module-level checks, returns boolean.
 * For submodule checks, pass submodule parameter.
 */
export function usePermission() {
  const { user, hasPermission: ctxHasPermission, hasRole } = useAuth();

  /**
   * Check if user has a specific action on a module (+ optional submodule).
   * Delegates to AuthContext.hasPermission which checks:
   *   admin bypass → RBAC bitmask → legacy overrides → role defaults
   */
  const can = useCallback((module, action, submodule = '') => {
    if (!user) return false;
    if (hasRole('admin', 'super_admin')) return true;
    return ctxHasPermission(module, action, submodule);
  }, [user, ctxHasPermission, hasRole]);

  /**
   * Check multiple permissions at once.
   * Returns true only if ALL actions are granted.
   */
  const canAll = useCallback((module, actions, submodule) => {
    return actions.every(action => can(module, action, submodule));
  }, [can]);

  /**
   * Check if user has ANY of the given actions.
   */
  const canAny = useCallback((module, actions, submodule) => {
    return actions.some(action => can(module, action, submodule));
  }, [can]);

  /**
   * Shortcuts for common checks.
   */
  const permission = useMemo(() => ({
    canView:   (mod, sub) => can(mod, 'view', sub),
    canCreate: (mod, sub) => can(mod, 'create', sub),
    canEdit:   (mod, sub) => can(mod, 'edit', sub),
    canDelete: (mod, sub) => can(mod, 'delete', sub),
    canApprove:(mod, sub) => can(mod, 'approve', sub),
    canExport: (mod, sub) => can(mod, 'export', sub),
    canPrint:  (mod, sub) => can(mod, 'print', sub),
  }), [can]);

  return { can, canAll, canAny, permission };
}

/**
 * Legacy compatibility: simple permission check.
 * Usage: hasModulePermission(user, 'inventory', 'view')
 */
export function hasModulePermission(user, module, action) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'super_admin') return true;

  const override = (user.permissions || []).find(
    p => p.module === module && p.permission_key === action
  );
  if (override !== undefined) return Boolean(override.allowed);

  const { ROLE_DEFAULTS } = require('../../core/context/AuthContext');
  return ROLE_DEFAULTS[user.role]?.[module]?.includes(action) ?? false;
}
