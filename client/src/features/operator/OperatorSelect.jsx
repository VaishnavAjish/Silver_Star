import SelectDropdown from '../../shared/components/SelectDropdown';
/**
 * OperatorSelect — reusable operator/employee dropdown.
 *
 * Props:
 *   value      string  — selected operator id ('' = none)
 *   onChange   fn      — called with new id string
 *   operators  array   — [{id, full_name, ...}] from /api/manufacturing/lookup/operators
 *   style      object  — forwarded to <SelectDropdown>
 *   placeholder string — override default empty label
 *   required   bool    — html required attr
 */
export default function OperatorSelect({ value, onChange, operators = [], style, placeholder, required }) {
  return (
    <SelectDropdown
      value={value}
      onChange={e => onChange(e.target.value)}
      style={style}
      required={required}
    >
      <option value="">{placeholder || '— unassigned —'}</option>
      {operators.map(op => (
        <option key={op.id} value={op.id}>{op.full_name}</option>
      ))}
    </SelectDropdown>
  );
}
