import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function Barcode({
  value,
  width = 1.5,
  height = 40,
  displayValue = true,
  fontSize = 10,
}) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width,
        height,
        displayValue,
        fontSize,
        margin: 4,
        fontOptions: 'bold',
      });
    } catch {
      // invalid value — leave svg blank
    }
  }, [value, width, height, displayValue, fontSize]);

  if (!value) return null;
  return <svg ref={svgRef} />;
}
