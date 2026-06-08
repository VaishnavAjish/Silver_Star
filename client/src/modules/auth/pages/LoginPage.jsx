import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../../../core/context/AuthContext';
import { Leaf, Eye, EyeOff, User, Lock, AlertCircle } from 'lucide-react';
import './login-page.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  // Already logged in — redirect to intended page
  if (user) return <Navigate to={from} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lp-root">
      {/* ── Left Panel ── */}
      <div className="lp-left">
        <div className="lp-left-overlay" />
        <div className="lp-left-content">
          <div className="lp-brand-chip">
            <div className="lp-brand-icon"><Leaf size={16} /></div>
            <span className="lp-brand-chip-text">Silverstar Grow</span>
          </div>
          <h1 className="lp-headline">
            Precision <span className="lp-headline-accent">Manufacturing</span>
            <br />at Your Fingertips
          </h1>
          <p className="lp-tagline">
            Streamline your lab diamond operations with enterprise-grade tools
            built for scale and precision.
          </p>
          <div className="lp-features">
            <div className="lp-feature-item">
              <span className="lp-feature-dot" />
              Real-time production tracking
            </div>
            <div className="lp-feature-item">
              <span className="lp-feature-dot" />
              Inventory &amp; stock management
            </div>
            <div className="lp-feature-item">
              <span className="lp-feature-dot" />
              Integrated accounting &amp; reporting
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="lp-right">
        <div className="lp-form-wrapper">
          {/* Logo — pill chip (matches left-panel brand chip) */}
          <div className="lp-logo-row">
            <div className="lp-brand-chip lp-chip-light">
              <div className="lp-brand-icon"><Leaf size={16} /></div>
              <span className="lp-brand-chip-text lp-chip-light-text">Silverstar Grow</span>
            </div>
          </div>

          {/* Heading */}
          <h2 className="lp-welcome">
            Welcome back to{' '}
            <span className="lp-welcome-accent">Silverstar Grow</span>
          </h2>
          <p className="lp-welcome-sub">Lab Diamond Manufacturing ERP</p>


          {/* Error */}
          {error && (
            <div className="lp-error" role="alert">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="lp-form" noValidate>
            {/* Username */}
            <div className="lp-field">
              <div className="lp-input-wrap">
                <span className="lp-input-icon"><User size={15} /></span>
                <input
                  id="login-username"
                  type="text"
                  className="lp-input"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Username"
                  autoFocus
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="lp-field">
              <div className="lp-input-wrap">
                <span className="lp-input-icon"><Lock size={15} /></span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  className="lp-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lp-eye-btn"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              id="login-submit"
              type="submit"
              className={`lp-btn${loading ? ' lp-btn--loading' : ''}`}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="lp-spinner" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
