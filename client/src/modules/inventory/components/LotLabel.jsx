import Barcode from '../../../shared/components/Barcode';

export default function LotLabel({ lot }) {
  const dateStr = lot.purchase_date
    ? new Date(lot.purchase_date).toLocaleDateString('en-IN')
    : new Date().toLocaleDateString('en-IN');

  const weight = lot.weight != null ? `${parseFloat(lot.weight).toFixed(4)} ct` : '';

  const extras = [lot.serial_no, lot.location].filter(Boolean).join(' · ');

  return (
    <div className="lot-label">
      <div className="lot-label__company">Silverstar Grow</div>
      <div className="lot-label__barcode">
        <Barcode value={lot.lot_number} width={1.2} height={32} displayValue={false} />
      </div>
      <div className="lot-label__id">{lot.lot_number}</div>
      {lot.lot_name && <div className="lot-label__name">{lot.lot_name}</div>}
      <div className="lot-label__meta">
        {extras && <span>{extras}</span>}
        {weight && <span>{weight}</span>}
        <span>{dateStr}</span>
      </div>
    </div>
  );
}
