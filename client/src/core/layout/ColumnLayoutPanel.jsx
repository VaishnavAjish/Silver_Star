import { useState, useRef } from 'react';

const SYSTEM_BADGE = (
  <span style={{ fontSize: 10, background: '#e8f5e9', color: '#2e7d32', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>
    system
  </span>
);

export default function ColumnLayoutPanel({
  allCols,
  activeColKeys,
  onColKeysChange,
  allTemplates,
  activeTemplateId,
  onTemplateSelect,
  onSaveAsNew,
  onUpdateTemplate,
  onDeleteTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onSetDefault,
  defaultTemplateId,
  onClose,
}) {
  const [tab, setTab] = useState('columns');
  const [colSearch, setColSearch] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // DnD state
  const dragKey = useRef(null);
  const dragOverKey = useRef(null);

  const activeSet = new Set(activeColKeys);
  const filteredAll = allCols.filter(c =>
    !colSearch || c.label.toLowerCase().includes(colSearch.toLowerCase()) || c.key.includes(colSearch.toLowerCase())
  );

  // Ordered: active cols in current order, then inactive
  const activeCols = activeColKeys.map(k => allCols.find(c => c.key === k)).filter(Boolean);
  const inactiveCols = filteredAll.filter(c => !activeSet.has(c.key));
  const displayCols = colSearch
    ? filteredAll
    : [...activeCols, ...inactiveCols];

  function toggleCol(key) {
    if (activeSet.has(key)) {
      if (activeColKeys.length <= 1) return; // keep at least 1
      onColKeysChange(activeColKeys.filter(k => k !== key));
    } else {
      onColKeysChange([...activeColKeys, key]);
    }
  }

  function handleDragStart(e, key) {
    dragKey.current = key;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, key) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverKey.current = key;
  }

  function handleDrop(e, key) {
    e.preventDefault();
    if (!dragKey.current || dragKey.current === key) return;
    const from = activeColKeys.indexOf(dragKey.current);
    const to = activeColKeys.indexOf(key);
    if (from === -1 || to === -1) return;
    const next = [...activeColKeys];
    next.splice(from, 1);
    next.splice(to, 0, dragKey.current);
    onColKeysChange(next);
    dragKey.current = null;
    dragOverKey.current = null;
  }

  function handleDragEnd() {
    dragKey.current = null;
    dragOverKey.current = null;
  }

  function startRename(id, currentLabel) {
    setRenamingId(id);
    setRenameValue(currentLabel);
  }

  function commitRename(id) {
    if (renameValue.trim()) onRenameTemplate(id, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  }

  const activeTemplate = allTemplates.find(t => t.id === activeTemplateId);
  const canUpdate = activeTemplate && !activeTemplate.isSystem;

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 300, height: '100%',
      background: '#fff', borderLeft: '1px solid #c8e6c9', zIndex: 200,
      display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: '1px solid #e8f5e9', background: '#f1f8e9' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1b5e20' }}>Columns & Templates</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 18, color: '#555', lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8f5e9' }}>
        {['columns', 'templates'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 0', border: 'none', cursor: 'pointer', fontSize: 13,
            background: tab === t ? '#e8f5e9' : 'transparent',
            color: tab === t ? '#2e7d32' : '#555',
            fontWeight: tab === t ? 700 : 400,
            borderBottom: tab === t ? '2px solid #43a047' : '2px solid transparent',
          }}>
            {t === 'columns' ? 'Columns' : 'Templates'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>

        {tab === 'columns' && (
          <>
            <div style={{ padding: '0 10px 8px' }}>
              <input
                value={colSearch}
                onChange={e => setColSearch(e.target.value)}
                placeholder="Search columns..."
                style={{ width: '100%', padding: '5px 8px', border: '1px solid #c8e6c9',
                  borderRadius: 4, fontSize: 12, boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            {!colSearch && activeCols.length > 0 && (
              <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>
                Visible (drag to reorder)
              </div>
            )}
            {displayCols.map(col => {
              const isActive = activeSet.has(col.key);
              const isDraggable = isActive && !colSearch;
              return (
                <div
                  key={col.key}
                  draggable={isDraggable}
                  onDragStart={isDraggable ? e => handleDragStart(e, col.key) : undefined}
                  onDragOver={isDraggable ? e => handleDragOver(e, col.key) : undefined}
                  onDrop={isDraggable ? e => handleDrop(e, col.key) : undefined}
                  onDragEnd={isDraggable ? handleDragEnd : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', padding: '5px 12px', gap: 8,
                    cursor: isDraggable ? 'grab' : 'default',
                    background: isActive ? '#f9fbe7' : 'transparent',
                    borderLeft: isActive ? '3px solid #43a047' : '3px solid transparent',
                    opacity: isActive ? 1 : 0.6,
                  }}
                >
                  {isDraggable && (
                    <span style={{ color: '#aaa', fontSize: 14, userSelect: 'none' }}>⠿</span>
                  )}
                  {!isDraggable && <span style={{ width: 14 }} />}
                  <span style={{ flex: 1, fontSize: 12, color: '#333' }}>{col.label}</span>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => toggleCol(col.key)}
                    style={{ accentColor: '#43a047', cursor: 'pointer', width: 14, height: 14 }}
                  />
                </div>
              );
            })}
            {!colSearch && inactiveCols.length > 0 && activeCols.length > 0 && (
              <div style={{ padding: '6px 12px 2px', fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1 }}>
                Hidden
              </div>
            )}
          </>
        )}

        {tab === 'templates' && (
          <>
            {allTemplates.map(tmpl => {
              const isActive = tmpl.id === activeTemplateId;
              const isDefault = tmpl.id === defaultTemplateId;
              return (
                <div key={tmpl.id} style={{
                  padding: '7px 12px', cursor: 'pointer',
                  background: isActive ? '#e8f5e9' : 'transparent',
                  borderLeft: isActive ? '3px solid #43a047' : '3px solid transparent',
                  borderBottom: '1px solid #f5f5f5',
                }}>
                  {renamingId === tmpl.id ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(tmpl.id); if (e.key === 'Escape') setRenamingId(null); }}
                        style={{ flex: 1, padding: '3px 6px', border: '1px solid #a5d6a7', borderRadius: 3, fontSize: 12 }}
                      />
                      <button onClick={() => commitRename(tmpl.id)} style={btnStyle('#43a047')}>✓</button>
                      <button onClick={() => setRenamingId(null)} style={btnStyle('#999')}>✕</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}
                        onClick={() => onTemplateSelect(tmpl.id)}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: isActive ? 700 : 400, color: isActive ? '#1b5e20' : '#333' }}>
                          {tmpl.label}
                          {tmpl.isSystem && SYSTEM_BADGE}
                        </span>
                        {isDefault && (
                          <span style={{ fontSize: 10, color: '#43a047', marginLeft: 4 }}>★ default</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {!tmpl.isSystem && (
                          <>
                            <button onClick={() => startRename(tmpl.id, tmpl.label)} style={smallBtn}>Rename</button>
                            {!isDefault && (
                              <button onClick={() => onSetDefault(tmpl.id)} style={smallBtn}>Set default</button>
                            )}
                            <button onClick={() => onDeleteTemplate(tmpl.id)} style={{ ...smallBtn, color: '#c62828' }}>Delete</button>
                          </>
                        )}
                        <button onClick={() => onDuplicateTemplate(tmpl.id)} style={smallBtn}>Duplicate</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <div style={{ padding: '14px 12px 6px', borderTop: '1px solid #e8f5e9', marginTop: 4 }}>
              {canUpdate && (
                <button
                  onClick={() => onUpdateTemplate(activeTemplateId)}
                  style={{ width: '100%', padding: '6px 0', marginBottom: 8, background: '#e8f5e9',
                    border: '1px solid #a5d6a7', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                    color: '#2e7d32', fontWeight: 600 }}
                >
                  Update "{activeTemplate?.label}"
                </button>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  placeholder="New template name..."
                  onKeyDown={e => { if (e.key === 'Enter' && newTemplateName.trim()) { onSaveAsNew(newTemplateName.trim()); setNewTemplateName(''); } }}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #c8e6c9',
                    borderRadius: 4, fontSize: 12, outline: 'none' }}
                />
                <button
                  disabled={!newTemplateName.trim()}
                  onClick={() => { if (newTemplateName.trim()) { onSaveAsNew(newTemplateName.trim()); setNewTemplateName(''); } }}
                  style={{ padding: '5px 10px', background: newTemplateName.trim() ? '#43a047' : '#ccc',
                    color: '#fff', border: 'none', borderRadius: 4, cursor: newTemplateName.trim() ? 'pointer' : 'default',
                    fontSize: 12, fontWeight: 600 }}
                >
                  Save
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnStyle = bg => ({
  padding: '2px 7px', background: bg, color: '#fff', border: 'none',
  borderRadius: 3, cursor: 'pointer', fontSize: 11,
});

const smallBtn = {
  padding: '2px 7px', background: '#f5f5f5', color: '#555', border: '1px solid #ddd',
  borderRadius: 3, cursor: 'pointer', fontSize: 11,
};
