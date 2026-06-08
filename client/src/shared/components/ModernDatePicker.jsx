import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Calendar } from 'lucide-react';

export default function ModernDatePicker({ selected, onChange, placeholderText = 'Select date', ...props }) {
  // Use a custom input to style it exactly like the rest of the app's inputs
  const CustomInput = React.forwardRef(({ value, onClick, onChange: onInputChange, placeholder, className, ...rest }, ref) => (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        ref={ref}
        value={value}
        onClick={onClick}
        onChange={onInputChange}
        placeholder={placeholder}
        className={className}
        {...rest}
        style={{
          width: '100%',
          paddingLeft: 30, // Make room for the icon
          cursor: 'pointer'
        }}
      />
      <Calendar 
        size={14} 
        style={{ 
          position: 'absolute', 
          left: 10, 
          top: '50%', 
          transform: 'translateY(-50%)', 
          color: 'var(--g400)',
          pointerEvents: 'none'
        }} 
      />
    </div>
  ));

  return (
    <DatePicker
      selected={selected}
      onChange={onChange}
      placeholderText={placeholderText}
      customInput={<CustomInput />}
      dateFormat="MMM d, yyyy"
      {...props}
    />
  );
}
