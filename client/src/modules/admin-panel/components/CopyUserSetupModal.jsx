import React, { useState, useEffect } from 'react';
import Modal from '../../../shared/components/Modal';
import { useApi } from '../../../shared/hooks/useApi';
import SelectDropdown from '../../../shared/components/SelectDropdown';
import { Copy, Loader2, CheckSquare, Square, Shield, LayoutDashboard, LayoutTemplate, Settings, Eye } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CopyUserSetupModal({ targetUser, users, onClose, onSuccess }) {
  const api = useApi();
  const [sourceUserId, setSourceUserId] = useState('');
  
  // Data for summary
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  
  const [copying, setCopying] = useState(false);

  // Checkboxes
  const [options, setOptions] = useState({
    copy_permissions: true,
    copy_visibility: true,
    copy_preferences: true,
    copy_dashboard: true,
    copy_templates: true,
  });

  const handleToggle = (key) => setOptions(o => ({ ...o, [key]: !o[key] }));

  // Load summary when source changes
  useEffect(() => {
    if (!sourceUserId) {
      setSummary(null);
      return;
    }
    const loadSummary = async () => {
      setLoadingSummary(true);
      try {
        const res = await api.get(`/api/admin/users/${sourceUserId}/setup-summary`);
        setSummary(res);
      } catch (err) {
        toast.error('Failed to load user setup summary');
        setSummary(null);
      } finally {
        setLoadingSummary(false);
      }
    };
    loadSummary();
  }, [sourceUserId]);

  const handleCopy = async () => {
    if (!sourceUserId) return toast.error('Please select a source user');
    if (!Object.values(options).some(Boolean)) return toast.error('Please select at least one configuration to copy');

    if (!window.confirm(`Are you sure you want to completely replace ${targetUser.full_name}'s selected configurations with the setup from the source user? This cannot be undone.`)) {
      return;
    }

    setCopying(true);
    try {
      await api.post(`/api/admin/users/${targetUser.id}/copy-setup`, {
        source_user_id: Number(sourceUserId),
        ...options
      });
      toast.success('User setup copied successfully!');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to copy setup');
    } finally {
      setCopying(false);
    }
  };

  const activeUsers = users.filter(u => u.is_active && u.id !== targetUser.id);

  return (
    <Modal open={true} onClose={onClose} title="Copy User Setup" width={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 16 }}>
        
        <div style={{ fontSize: 13, color: 'var(--g600)', lineHeight: '1.5' }}>
          Select an existing user to copy their exact permissions, dashboard layout, and other preferences over to <strong style={{color:'var(--g900)'}}>{targetUser.full_name}</strong>. 
          <span style={{ color: 'var(--danger-color)', display: 'block', marginTop: 4 }}>
            Warning: This will overwrite any existing configuration for the selected modules.
          </span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--g700)', marginBottom: 8 }}>
            Source User
          </label>
          <SelectDropdown 
            value={sourceUserId} 
            onChange={e => setSourceUserId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">— Select Source User —</option>
            {activeUsers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>
            ))}
          </SelectDropdown>
        </div>

        {loadingSummary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--g500)', fontSize: 13, padding: '20px 0' }}>
            <Loader2 className="spin" size={16} /> Loading user configuration...
          </div>
        )}

        {summary && !loadingSummary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--g700)' }}>
              Configuration Modules
            </label>
            
            <div style={{ border: '1px solid var(--g200)', borderRadius: 8, overflow: 'hidden' }}>
              <ModuleRow 
                icon={Shield} 
                title="Permissions" 
                desc={`Copies ${summary.permissions_count} explicit module permissions.`}
                checked={options.copy_permissions}
                onToggle={() => handleToggle('copy_permissions')}
              />
              <ModuleRow 
                icon={Eye} 
                title="Inventory Visibility" 
                desc={`Copies scope mode (${summary.scope_mode}) and ${summary.scope_depts_count} explicit department whitelists.`}
                checked={options.copy_visibility}
                onToggle={() => handleToggle('copy_visibility')}
              />
              <ModuleRow 
                icon={LayoutDashboard} 
                title="Dashboard Layout" 
                desc={`Copies ${summary.dashboard_count} widget preferences and positioning.`}
                checked={options.copy_dashboard}
                onToggle={() => handleToggle('copy_dashboard')}
              />
              <ModuleRow 
                icon={Settings} 
                title="User Preferences" 
                desc={`Copies ${summary.preferences_count} local UI preferences (table columns, etc).`}
                checked={options.copy_preferences}
                onToggle={() => handleToggle('copy_preferences')}
              />
              <ModuleRow 
                icon={LayoutTemplate} 
                title="Inventory Templates" 
                desc={`Copies ${summary.shared_templates_count} shared templates and ${summary.owned_templates_count} non-global templates created by them.`}
                checked={options.copy_templates}
                onToggle={() => handleToggle('copy_templates')}
                isLast
              />
            </div>
          </div>
        )}

      </div>
      <div className="modal-actions" style={{ marginTop: 24 }}>
        <button className="btn btn-secondary" onClick={onClose} disabled={copying}>Cancel</button>
        <button 
          className="btn btn-primary" 
          onClick={handleCopy} 
          disabled={!sourceUserId || copying}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {copying ? <Loader2 className="spin" size={16} /> : <Copy size={16} />}
          {copying ? 'Copying Setup...' : 'Copy Selected Setup'}
        </button>
      </div>
    </Modal>
  );
}

function ModuleRow({ icon: Icon, title, desc, checked, onToggle, isLast }) {
  return (
    <div 
      onClick={onToggle}
      style={{ 
        display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', 
        borderBottom: isLast ? 'none' : '1px solid var(--g200)',
        cursor: 'pointer',
        background: checked ? 'var(--brand-50)' : 'transparent',
        transition: 'background 0.2s'
      }}
    >
      <div style={{ color: checked ? 'var(--brand-dark)' : 'var(--g400)' }}>
        {checked ? <CheckSquare size={20} /> : <Square size={20} />}
      </div>
      <div style={{ 
        width: 32, height: 32, borderRadius: 6, 
        background: checked ? 'var(--brand-dark)' : 'var(--g100)', 
        color: checked ? '#fff' : 'var(--g500)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Icon size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: checked ? 'var(--brand-dark)' : 'var(--g900)' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: checked ? 'var(--brand-dark)' : 'var(--g500)', opacity: checked ? 0.8 : 1 }}>
          {desc}
        </div>
      </div>
    </div>
  );
}
