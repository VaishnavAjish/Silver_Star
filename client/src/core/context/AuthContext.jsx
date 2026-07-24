import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);

// Storage keys for tab persistence
const STORAGE_KEYS = {
  TOKEN: 'sg_token',
  OPEN_TABS: 'sg_open_tabs',
  ACTIVE_TAB: 'sg_active_tab',
};

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function getAuthErrorMessage(res, data) {
  if (data?.error && !String(data.error).trim().startsWith('<')) {
    return String(data.error).slice(0, 200);
  }
  if (res.status === 0) return 'Unable to reach the server';
  if (res.status === 401) return 'Invalid credentials';
  if (data?.error) return 'Login failed: server returned a non-JSON response';
  return `Login failed (HTTP ${res.status})`;
}

// Mirrors server/middleware/permissions.js — keep in sync
export const ROLE_DEFAULTS = {
  // null = admin: all allowed, checked separately
  operator: {
    dashboard: ['view'],
    inventory: ['view', 'create', 'edit', 'export', 'print'],
    purchase: ['view', 'create', 'edit', 'print'],
    sales: ['view', 'create', 'edit', 'print'],
    process: ['view', 'create', 'edit'],
    rough: ['view', 'create', 'edit'],
    assets: ['view', 'print'],
    accounting: ['view', 'create', 'edit'],
    reports: ['view', 'export', 'print'],
    management: ['view'],
    manufacturing: ['view', 'create', 'edit'],
  },
  viewer: {
    dashboard: ['view'],
    inventory: ['view', 'print'],
    purchase: ['view', 'print'],
    sales: ['view', 'print'],
    process: ['view'],
    rough: ['view'],
    assets: ['view'],
    accounting: ['view'],
    reports: ['view', 'print'],
    management: ['view'],
    manufacturing: ['view'],
  },
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('sg_token'));
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.OPEN_TABS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
    sessionStorage.clear();
    setToken(null);
    setUser(null);
  }, []);

  // --- Idle Timeout Logic ---
  useEffect(() => {
    if (!token) return; // Only track idle time if logged in

    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 15 minutes of inactivity
    let idleTimer = null;

    const resetTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logout();
        toast.error('You were automatically logged out due to 15 minutes of inactivity.', { duration: 6000 });
      }, IDLE_TIMEOUT_MS);
    };

    // Listen to standard user interactions
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach(evt => window.addEventListener(evt, resetTimer));

    resetTimer(); // Initialize timer

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach(evt => window.removeEventListener(evt, resetTimer));
    };
  }, [token, logout]);

  const fetchMe = async (tk) => {
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) throw new Error('session invalid');
    return readJsonResponse(res);
  };

  useEffect(() => {
    if (token) {
      fetchMe(token)
        .then(u => {
          // Server issues a fresh token when the DB role differs from the JWT role
          // (e.g. an admin changed this user's role after they last logged in).
          const { token: freshToken, ...userData } = u;
          setUser(userData);
          if (freshToken) {
            localStorage.setItem('sg_token', freshToken);
            setToken(freshToken);
          }
          setLoading(false);
        })
        .catch(() => { logout(); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [token, logout]);

  const login = async (username, password) => {
    let res;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch (err) {
      throw new Error('Unable to connect to server. Make sure the backend is running on port 5001.');
    }
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(getAuthErrorMessage(res, data));
    }
    if (!data?.token) throw new Error('Login response was missing a token');

    // Clear previous tab state for clean workspace on new login
    localStorage.removeItem(STORAGE_KEYS.OPEN_TABS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);

    localStorage.setItem('sg_token', data.token);
    setToken(data.token);
    // /me will be called by the useEffect above; set minimal user immediately
    setUser(data.user);
    return data.user;
  };

  // Re-fetch /me to pick up permission/preference changes without logout
  const refreshUser = async () => {
    const tk = localStorage.getItem('sg_token');
    if (!tk) return;
    try { setUser(await fetchMe(tk)); } catch { /* ignore */ }
  };

  // Role comparison is case-insensitive — server may emit 'SUPER_ADMIN' or 'super_admin'.
  const hasRole = (...roles) => {
    if (!user?.role) return false;
    const r = String(user.role).toLowerCase();
    return roles.some(role => String(role).toLowerCase() === r);
  };
  const canEdit = () => hasRole('super_admin', 'admin', 'operator');

  const _PERM_BITS = { view: 1, create: 2, edit: 4, delete: 8, approve: 16, export: 32, print: 64, reject: 128, import: 256, manage: 512, sidebar: 1024 };

  // Check permission — order: admin bypass → RBAC bitmask → legacy overrides → role defaults
  const hasPermission = (module, action, submodule = '') => {
    if (!user) return false;
    const role = String(user.role || '').toLowerCase().trim();
    if (role === 'super_admin' || role === 'superadmin' || role === 'super admin') return true;

    const bit = _PERM_BITS[action];
    if (bit === undefined) return false;

    // 1. RBAC bitmask from assigned roles (loaded by /me)
    const rbacPerms = user.rbac_permissions || [];
    if (rbacPerms.length > 0) {
      if (submodule) {
        const sub = rbacPerms.find(p => p.module === module && p.submodule === submodule);
        if (sub != null) return (parseInt(sub.mask) & bit) === bit;
      }
      const mod = rbacPerms.find(p => p.module === module && p.submodule === '');
      if (mod != null) return (parseInt(mod.mask) & bit) === bit;

      // If submodules exist for this module, evaluate authoritatively across module submodules
      const modEntries = rbacPerms.filter(p => p.module === module);
      if (modEntries.length > 0) {
        return modEntries.some(p => (parseInt(p.mask) & bit) === bit);
      }
    }

    // 2. Legacy per-user permission overrides
    const override = (user.permissions || []).find(
      p => p.module === module && p.permission_key === action
    );
    if (override !== undefined) return Boolean(override.allowed);

    // 3. Legacy ROLE_DEFAULTS fallback ONLY if no RBAC entries exist for this user
    if (rbacPerms.length > 0) return false;
    return ROLE_DEFAULTS[user.role]?.[module]?.includes(action) ?? false;
  };

  // Preference value (stored as string in DB)
  const getPreference = (key, defaultValue = null) => {
    const p = (user?.preferences || []).find(p => p.pref_key === key);
    return p ? p.pref_value : defaultValue;
  };

  // Visibility flag (stored as "true"/"false" string under "vis.<key>")
  const getVisibility = (key) => {
    const p = (user?.preferences || []).find(p => p.pref_key === `vis.${key}`);
    return p ? p.pref_value === 'true' : true; // default: visible
  };

  const setNewToken = useCallback((newToken) => {
    localStorage.setItem('sg_token', newToken);
    setToken(newToken);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, token, loading,
      login, logout, refreshUser, setNewToken,
      hasRole, canEdit,
      hasPermission, getPreference, getVisibility,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
