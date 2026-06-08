import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, X, FileText, TrendingUp, Receipt, Users,
  CreditCard, ShoppingCart, TrendingDown, Building2,
  BookOpen, Landmark, BarChart3, RotateCcw,
} from 'lucide-react';

const MENU_CONFIG = [
  {
    title: 'Customers',
    items: [
      { label: 'Invoice',          path: '/invoices/new',        icon: FileText,    hot: true },
      { label: 'Receive Payment',  path: '/receipts/new',        icon: TrendingUp },
      { label: 'Receipts',         path: '/receipts',            icon: Receipt },
      { label: 'Customer',         path: '/customers',           icon: Users },
    ],
  },
  {
    title: 'Vendors',
    items: [
      { label: 'Expense',          path: '/expenses',            icon: CreditCard },
      { label: 'Purchase Note',    path: '/purchase-notes/new',  icon: ShoppingCart, hot: true },
      { label: 'Demo Purchase Note', path: '/purchase-notes/new?demo=true', icon: ShoppingCart },
      { label: 'Pay Bills',        path: '/payments/new',        icon: TrendingDown },
      { label: 'Vendor',           path: '/vendors',             icon: Building2 },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { label: 'Journal Entry',     path: '/journal-entries/new', icon: BookOpen,  hot: true },
      { label: 'Bank Deposit',      path: '/bank-deposits/new',   icon: Landmark },
      { label: 'Chart of Accounts', path: '/accounts',            icon: BarChart3 },
    ],
  },
  {
    title: 'Other',
    items: [
      { label: 'Payments',          path: '/payments',            icon: RotateCcw },
    ],
  },
];

const panelVariants = {
  hidden:  { opacity: 0, y: -10, scale: 0.97 },
  visible: { opacity: 1, y: 0,   scale: 1,    transition: { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] } },
  exit:    { opacity: 0, y: -6,  scale: 0.97, transition: { duration: 0.13 } },
};

const itemVariants = {
  hidden:  { opacity: 0, x: -4 },
  visible: (i) => ({ opacity: 1, x: 0, transition: { delay: i * 0.025, duration: 0.14 } }),
};

export default function GlobalCreateMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const go = (path) => { setOpen(false); navigate(path); };

  let globalItemIdx = 0;

  return (
    <div className="gcm-wrap">
      <button
        className={`gcm-btn${open ? ' gcm-btn--open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Plus size={13} strokeWidth={2.5} />
        Create
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="gcm-overlay" onClick={() => setOpen(false)} />
            <motion.div
              className="gcm-panel"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="menu"
            >
              <div className="gcm-panel-hdr">
                <span className="gcm-panel-label">Quick Create</span>
                <button className="gcm-close-btn" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={13} />
                </button>
              </div>

              <div className="gcm-grid">
                {MENU_CONFIG.map((cat) => (
                  <div key={cat.title} className="gcm-col">
                    <div className="gcm-col-hdr">{cat.title}</div>
                    {cat.items.map((item) => {
                      const idx = globalItemIdx++;
                      return (
                        <motion.button
                          key={item.path}
                          className={`gcm-item${item.hot ? ' gcm-item--hot' : ''}`}
                          onClick={() => go(item.path)}
                          variants={itemVariants}
                          initial="hidden"
                          animate="visible"
                          custom={idx}
                          role="menuitem"
                        >
                          <item.icon className="gcm-item-ico" size={13} />
                          <span>{item.label}</span>
                          {item.hot && <span className="gcm-star" aria-hidden="true">★</span>}
                        </motion.button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="gcm-footer-hint">
                <kbd>Esc</kbd> close &nbsp;·&nbsp; <kbd>Ctrl K</kbd> search
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
