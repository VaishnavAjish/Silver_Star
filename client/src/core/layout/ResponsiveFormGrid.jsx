export default function ResponsiveFormGrid({ cols = 2, children, style }) {
  return (
    <div className={`fgrid fgrid-${cols}`} style={style}>
      {children}
    </div>
  );
}
