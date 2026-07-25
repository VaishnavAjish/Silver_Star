import { ShieldAlert } from 'lucide-react';

export default function AccessRestricted({ message = "You do not have permission to view this content." }) {
  return (
    <div className="access-restricted" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: '24px 16px',
      color: 'var(--g500)',
      textAlign: 'center',
      height: '100%'
    }}>
      <ShieldAlert size={32} style={{ marginBottom: 12, color: 'var(--red)' }} />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--g800)', marginBottom: 4 }}>Access Restricted</div>
      <div style={{ fontSize: 12, maxWidth: 220 }}>{message}</div>
    </div>
  );
}
