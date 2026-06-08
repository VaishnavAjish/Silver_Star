import React, { useState, useEffect } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import { History, Package, RotateCcw, Box, User, ArrowRight } from 'lucide-react';

export default function LotHistoryTab({ lotId }) {
  const api = useApi();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.get(`/api/inventory/${lotId}/history`)
      .then(res => {
        if (mounted) {
          setEvents(res);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, [lotId, api]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--brand-dark)' }}>
        Error loading history: {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--g400)', fontStyle: 'italic', border: '1px dashed var(--g300)', borderRadius: 8 }}>
        No history recorded for this lot.
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--brand-dark)', marginBottom: 14, paddingBottom: 5, borderBottom: '2px solid var(--brand-50)' }}>
        <History size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Unified History Timeline
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {events.map((evt, idx) => {
          const isGrowthCycle = evt.source === 'growth_cycle';
          const isCreation = evt.source === 'creation';
          const isMovement = evt.source === 'movement';

          return (
            <div key={idx} style={{
              background: '#fff', border: '1px solid var(--g200)', borderRadius: 8, padding: '12px 16px',
              borderLeft: isGrowthCycle ? '4px solid #1565C0' : isCreation ? '4px solid #2E7D32' : '4px solid var(--g300)'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--g900)' }}>
                    {evt.event_type}
                  </div>
                  {evt.status_change && (
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--g100)', color: 'var(--g700)', fontWeight: 600 }}>
                      → {evt.status_change}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--g500)', fontFamily: 'var(--mono)' }}>
                  {new Date(evt.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>

              {/* Attributes Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {evt.weight_change && (
                  <div style={{ fontSize: 12, color: 'var(--g700)' }}>
                    <strong>Weight Change:</strong> {evt.weight_change}
                  </div>
                )}
                {evt.dimension_change && (
                  <div style={{ fontSize: 12, color: 'var(--g700)' }}>
                    <strong>Dimensions:</strong> {evt.dimension_change}
                  </div>
                )}
                {(evt.source_loc || evt.dest_loc) && (
                  <div style={{ fontSize: 12, color: 'var(--g700)', gridColumn: '1 / -1' }}>
                    <strong>Location:</strong> {evt.source_loc || '—'} <ArrowRight size={10} style={{ margin: '0 4px', verticalAlign: 'middle' }} /> {evt.dest_loc || '—'}
                  </div>
                )}
              </div>

              {/* Footer / Meta */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--g100)' }}>
                {evt.remarks ? (
                  <div style={{ fontSize: 11, color: 'var(--g600)', fontStyle: 'italic', maxWidth: '70%' }}>
                    "{evt.remarks}"
                  </div>
                ) : <div />}
                {evt.user && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--g500)' }}>
                    <User size={10} /> {evt.user}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
