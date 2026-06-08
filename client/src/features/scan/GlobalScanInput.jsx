import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../core/context/AuthContext';
import { openPaletteWith } from '../command-palette/CommandPalette';

const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditable(el) {
  if (!el) return false;
  return EDITABLE.has(el.tagName) || el.isContentEditable;
}

export default function GlobalScanInput() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const bufRef     = useRef('');
  const timeRef    = useRef(0);
  const lastKeyRef = useRef(0);
  // Prevent repeated navigation from the same scan within 2s
  const lastScanRef = useRef({ value: '', at: 0 });

  useEffect(() => {
    const onKeyDown = async (e) => {
      if (isEditable(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();

      if (e.key === 'Enter') {
        const buf     = bufRef.current;
        const elapsed = now - timeRef.current;

        bufRef.current  = '';
        timeRef.current = 0;

        if (buf.length >= 3 && elapsed <= 500) {
          e.preventDefault();

          const last = lastScanRef.current;
          if (last.value === buf && now - last.at < 2000) {
            toast('Already scanned', { icon: '⚡' });
            return;
          }
          lastScanRef.current = { value: buf, at: now };

          if (!token) { navigate('/login'); return; }

          try {
            const res = await fetch(
              `/api/search?q=${encodeURIComponent(buf)}&limit=2`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const data    = await res.json();
            const results = data.results || [];

            if (results.length === 1) {
              toast.success(`Scanned: ${buf} → opened`);
              navigate(results[0].url);
            } else {
              toast(`Scanned: ${buf} — ${results.length === 0 ? 'not found' : 'multiple matches'}`, { icon: '🔍' });
              openPaletteWith(buf);
            }
          } catch {
            toast.error('Scan lookup failed');
          }
        }
        return;
      }

      if (e.key.length === 1) {
        const gap = now - lastKeyRef.current;
        if (gap > 50 && bufRef.current.length > 0) {
          bufRef.current  = '';
          timeRef.current = 0;
        }
        if (bufRef.current.length === 0) timeRef.current = now;
        bufRef.current += e.key;
        lastKeyRef.current = now;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [token, navigate]);

  return null;
}
