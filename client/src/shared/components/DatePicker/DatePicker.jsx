import { useState, useEffect, useRef, useCallback, useMemo, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import './styles/datepicker.css';

// ── Constants ────────────────────────────────────────────────────────────────
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_S   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ── Utilities ────────────────────────────────────────────────────────────────
function parseYMD(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

function toYMD(date) {
  if (!date) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDisplay(date, fmt = 'DD MMM YYYY') {
  if (!date) return '';
  const map = {
    YYYY: date.getFullYear(),
    YY:   String(date.getFullYear()).slice(2),
    MMMM: MONTHS[date.getMonth()],
    MMM:  MONTHS_S[date.getMonth()],
    MM:   String(date.getMonth() + 1).padStart(2, '0'),
    M:    String(date.getMonth() + 1),
    DD:   String(date.getDate()).padStart(2, '0'),
    D:    String(date.getDate()),
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/g, t => map[t] ?? t);
}

function buildGrid(year, month) {
  const first   = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const cells   = [];
  // Leading padding from previous month
  for (let i = 0; i < first.getDay(); i++) {
    cells.push({ date: new Date(year, month, i - first.getDay() + 1), out: true });
  }
  // Current month days
  for (let d = 1; d <= lastDay; d++) {
    cells.push({ date: new Date(year, month, d), out: false });
  }
  // Trailing padding to fill 6 rows × 7 cols
  let next = 1;
  while (cells.length < 42) cells.push({ date: new Date(year, month + 1, next++), out: true });
  return cells;
}

function dateCmp(a, b) {
  if (!a || !b) return NaN;
  const n = (d) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
  return n(a) - n(b);
}

// ── Animation variants ───────────────────────────────────────────────────────
const popupAnim = {
  hidden:  { opacity: 0, y: -8, scale: 0.97 },
  visible: { opacity: 1, y: 0,  scale: 1, transition: { duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit:    { opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } },
};

const overlayAnim = {
  hidden:  { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1,    transition: { duration: 0.14, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.95, transition: { duration: 0.1 } },
};

export default function DatePicker({
  value,
  onChange,
  format: fmt = 'DD/MM/YYYY',
  placeholder = 'Select date',
  disabled = false,
  min,
  max,
  disabledDates = [],
  className = '',
}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const selected    = useMemo(() => parseYMD(value),       [value]);
  const minDate     = useMemo(() => parseYMD(min),         [min]);
  const maxDate     = useMemo(() => parseYMD(max),         [max]);
  const disabledSet = useMemo(() => new Set(disabledDates), [disabledDates]);

  const [open,      setOpen]      = useState(false);
  const [mode,      setMode]      = useState('days');
  const [viewYear,  setViewYear]  = useState(() => (selected ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? today).getMonth());
  const [slideDir,  setSlideDir]  = useState(1);
  const [yearBase,  setYearBase]  = useState(() =>
    Math.floor(((selected ?? today).getFullYear() - 4) / 12) * 12
  );
  const [inputValue, setInputValue] = useState('');

  // Sync view to selected date when popup opens
  useEffect(() => {
    if (!open) return;
    const base = selectedRef.current ?? today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setYearBase(Math.floor((base.getFullYear() - 4) / 12) * 12);
    setMode('days');
  }, [open, today]);

  // Sync inputValue to selected date
  useEffect(() => {
    setInputValue(formatDisplay(selected, fmt) || '');
  }, [selected, fmt]);

  const commitInput = () => {
    if (!inputValue) {
      onChange?.('', null);
      return;
    }
    const parts = inputValue.split(/[\/\-\.]/);
    if (parts.length === 3) {
      let d = parseInt(parts[0], 10);
      let m = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);
      
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
        if (y < 100) y += 2000;
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
          const newDate = new Date(y, m - 1, d);
          if (newDate.getDate() === d) {
             if (!isDayDisabled(newDate)) {
               onChange?.(toYMD(newDate), newDate);
               setViewYear(newDate.getFullYear());
               setViewMonth(newDate.getMonth());
               setInputValue(formatDisplay(newDate, fmt));
               return;
             }
          }
        }
      }
    }
    // Invalid or disabled date, revert
    setInputValue(formatDisplay(selected, fmt) || '');
  };

  const triggerRef  = useRef(null);
  const popupRef    = useRef(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });



  // Compute and maintain popup position
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r    = el.getBoundingClientRect();
    const popH = 350;
    const popW = 280;
    const top  = (window.innerHeight - r.bottom >= popH) ? r.bottom + 4 : r.top - popH - 4;
    let   left = r.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (left < 8) left = 8;
    setPos({ top, left, width: popW });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!triggerRef.current?.contains(e.target) && !popupRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Month navigation
  const navMonth = (dir) => {
    setSlideDir(dir);
    setViewMonth((m) => {
      const nm = m + dir;
      if (nm < 0)  { setViewYear((y) => y - 1); return 11; }
      if (nm > 11) { setViewYear((y) => y + 1); return 0; }
      return nm;
    });
  };

  const selectDay = useCallback((date) => {
    onChange?.(toYMD(date), date);
    setOpen(false);
  }, [onChange]);

  const isDayDisabled = useCallback((date) => {
    if (minDate && dateCmp(date, minDate) < 0) return true;
    if (maxDate && dateCmp(date, maxDate) > 0) return true;
    return disabledSet.has(toYMD(date));
  }, [minDate, maxDate, disabledSet]);

  const handleTodayClick = () => {
    if (!isDayDisabled(today)) {
      selectDay(today);
    } else {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth());
      setMode('days');
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.('', null);
  };

  const grid    = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const gridKey = `${viewYear}-${viewMonth}`;
  const display = formatDisplay(selected, fmt);

  // Slide direction is captured at render time for both enter and exit
  const slideEnter = { opacity: 0, x: slideDir * 20 };
  const slideExit  = { opacity: 0, x: slideDir * -20 };

  return (
    <div ref={triggerRef} className={`dp-wrap${className ? ' ' + className : ''}`}>
      {/* ── Trigger ── */}
      <div
        className={[
          'dp-trigger',
          open     ? 'dp-trigger--open'     : '',
          disabled ? 'dp-trigger--disabled' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => !disabled && setOpen(true)}
        role="button"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarIcon size={13} className="dp-trigger-ico" />
        <input
          type="text"
          className={`dp-trigger-val${!inputValue ? ' dp-placeholder' : ''}`}
          value={inputValue}
          onChange={(e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 8) v = v.slice(0, 8);
            let f = '';
            if (v.length > 0) f += v.substring(0, 2);
            if (v.length > 2) f += '/' + v.substring(2, 4);
            if (v.length > 4) f += '/' + v.substring(4, 8);
            setInputValue(f);
          }}
          onBlur={commitInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitInput();
              setOpen(false);
            } else if (e.key === 'Tab') {
              commitInput();
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          tabIndex={disabled ? -1 : 0}
        />
        {selected && !disabled && (
          <button className="dp-trigger-clear" onClick={handleClear} aria-label="Clear date" tabIndex={-1}>
            <X size={11} />
          </button>
        )}
      </div>

      {/* ── Popup portal ── */}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={popupRef}
              className="dp-popup"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, minWidth: 280 }}
              variants={popupAnim}
              initial="hidden"
              animate="visible"
              exit="exit"
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              role="dialog"
              aria-label="Date picker"
            >
              {/* Header */}
              <div className="dp-hdr">
                <button
                  className="dp-arrow"
                  onClick={() => {
                    if (mode === 'days')  navMonth(-1);
                    if (mode === 'years') setYearBase((b) => b - 12);
                  }}
                  disabled={mode === 'months'}
                >
                  <ChevronLeft size={14} />
                </button>

                <div className="dp-hdr-labels">
                  <button
                    className={`dp-hdr-label${mode === 'months' ? ' dp-hdr-label--on' : ''}`}
                    onClick={() => setMode((m) => m === 'months' ? 'days' : 'months')}
                  >
                    {MONTHS[viewMonth]}
                  </button>
                  <button
                    className={`dp-hdr-label${mode === 'years' ? ' dp-hdr-label--on' : ''}`}
                    onClick={() => setMode((m) => m === 'years' ? 'days' : 'years')}
                  >
                    {viewYear}
                  </button>
                </div>

                <button
                  className="dp-arrow"
                  onClick={() => {
                    if (mode === 'days')  navMonth(1);
                    if (mode === 'years') setYearBase((b) => b + 12);
                  }}
                  disabled={mode === 'months'}
                >
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Body */}
              <div className="dp-body">
                <AnimatePresence mode="wait" initial={false}>
                  {/* ── Days grid ── */}
                  {mode === 'days' && (
                    <motion.div
                      key={gridKey}
                      initial={slideEnter}
                      animate={{ opacity: 1, x: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
                      exit={{ ...slideExit, transition: { duration: 0.15 } }}
                    >
                      <div className="dp-dow">
                        {DAYS_S.map((d) => <span key={d}>{d}</span>)}
                      </div>
                      <div className="dp-grid">
                        {grid.map(({ date, out }, i) => {
                          const isSel   = !out && !!selected && dateCmp(date, selected) === 0;
                          const isToday = dateCmp(date, today) === 0;
                          const isDis   = isDayDisabled(date);
                          return (
                            <button
                              key={i}
                              className={[
                                'dp-day',
                                out     ? 'dp-day--out' : '',
                                isSel   ? 'dp-day--sel' : '',
                                isToday ? 'dp-day--now' : '',
                                isDis   ? 'dp-day--dis' : '',
                              ].filter(Boolean).join(' ')}
                              onClick={() => !out && !isDis && selectDay(date)}
                              tabIndex={out || isDis ? -1 : 0}
                              disabled={!out && isDis}
                            >
                              {date.getDate()}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {/* ── Month picker ── */}
                  {mode === 'months' && (
                    <motion.div
                      key="months"
                      className="dp-months"
                      variants={overlayAnim}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                    >
                      {MONTHS_S.map((m, i) => (
                        <button
                          key={m}
                          className={`dp-mpick${viewMonth === i ? ' dp-mpick--on' : ''}`}
                          onClick={() => { setViewMonth(i); setSlideDir(0); setMode('days'); }}
                        >
                          {m}
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Year picker ── */}
                  {mode === 'years' && (
                    <motion.div
                      key="years"
                      className="dp-years"
                      variants={overlayAnim}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                    >
                      <div className="dp-ynav">
                        <button className="dp-arrow dp-arrow--sm" onClick={() => setYearBase((b) => b - 12)}>
                          <ChevronLeft size={13} />
                        </button>
                        <span className="dp-yrange">{yearBase} – {yearBase + 11}</span>
                        <button className="dp-arrow dp-arrow--sm" onClick={() => setYearBase((b) => b + 12)}>
                          <ChevronRight size={13} />
                        </button>
                      </div>
                      <div className="dp-ygrid">
                        {Array.from({ length: 12 }, (_, i) => yearBase + i).map((y) => (
                          <button
                            key={y}
                            className={`dp-ypick${viewYear === y ? ' dp-ypick--on' : ''}`}
                            onClick={() => { setViewYear(y); setSlideDir(0); setMode('months'); }}
                          >
                            {y}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="dp-foot">
                <button className="dp-foot-today" onClick={handleTodayClick}>
                  Today
                </button>
                {selected && (
                  <button
                    className="dp-foot-clear"
                    onClick={() => { onChange?.('', null); setOpen(false); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
