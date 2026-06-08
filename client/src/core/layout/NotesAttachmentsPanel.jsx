import FormSectionCard from './FormSectionCard';
import { MessageSquare } from 'lucide-react';

export default function NotesAttachmentsPanel({
  value,
  onChange,
  label = 'Memo / Notes',
  placeholder = 'Internal notes…',
  readOnly = false,
  rows = 2,
}) {
  return (
    <FormSectionCard
      title={label}
      icon={<MessageSquare size={13} />}
      collapsible
      defaultOpen={!!value}
    >
      <div className="fg w notes-pnl">
        <textarea
          value={value || ''}
          onChange={onChange}
          rows={rows}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={readOnly}
        />
      </div>
    </FormSectionCard>
  );
}
