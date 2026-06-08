import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

const PALETTE = ['#0D7C5F','#E87722','#1565C0','#7B1FA2','#D32F2F','#455A64','#00796B','#F57C00'];

function fmt(n) {
  if (n == null || isNaN(n)) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

const ttStyle = { fontSize: 11, borderRadius: 6, border: '1px solid #eee', boxShadow: '0 2px 8px rgba(0,0,0,.1)' };
const axStyle = { fontSize: 10, fill: '#9E9E9E' };

// ─── P&L Summary ─────────────────────────────────────────────────────────────
function ProfitLossWidget({ data }) {
  const navigate = useNavigate();
  const netProfit = data.profit ?? (data.revenue - data.expenses);
  const isProfit = netProfit >= 0;
  return (
    <div>
      <div className="pls-grid" style={{ cursor: 'pointer' }} onClick={() => navigate('/pnl')}>
        <div className="pls-card" style={{ background: '#E8F5E9' }}>
          <div className="pls-label">Revenue</div>
          <div className="pls-val" style={{ color: '#2E7D32' }}>{fmt(data.revenue)}</div>
        </div>
        <div className="pls-card" style={{ background: '#FFEBEE' }}>
          <div className="pls-label">Expenses</div>
          <div className="pls-val" style={{ color: '#C62828' }}>{fmt(data.expenses)}</div>
        </div>
        <div className="pls-card" style={{ background: isProfit ? '#E8F5F0' : '#FFEBEE' }}>
          <div className="pls-label">Net {isProfit ? 'Profit' : 'Loss'}</div>
          <div className="pls-val" style={{ color: isProfit ? '#0D7C5F' : '#C62828' }}>{fmt(Math.abs(netProfit))}</div>
        </div>
      </div>
      <div className="pls-period">{data.period}</div>
    </div>
  );
}

// ─── Revenue (Bar) ────────────────────────────────────────────────────────────
function SalesTrendWidget({ data }) {
  if (!data?.length) return <div className="wd-empty">No revenue data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={185}>
      <BarChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="month" tick={axStyle} />
        <YAxis tick={axStyle} tickFormatter={fmt} width={58} />
        <Tooltip formatter={v => fmt(v)} contentStyle={ttStyle} />
        <Bar dataKey="amount" name="Revenue" fill="#0D7C5F" radius={[3,3,0,0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Expenses (Pie) ───────────────────────────────────────────────────────────
function ExpensesChartWidget({ data }) {
  if (!data?.length) return <div className="wd-empty">No expense data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={185}>
      <PieChart>
        <Pie
          data={data}
          dataKey="amount"
          nameKey="name"
          cx="40%"
          cy="50%"
          outerRadius={72}
          paddingAngle={2}
        >
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={v => fmt(v)} contentStyle={ttStyle} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconSize={8}
          wrapperStyle={{ fontSize: 10, maxWidth: '40%' }}
          formatter={(val) => val.length > 14 ? val.slice(0, 13) + '…' : val}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── Cash Flow (Area) ─────────────────────────────────────────────────────────
function CashFlowWidget({ data }) {
  if (!data?.length) return <div className="wd-empty">No cash flow data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={185}>
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gIn"  x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor="#0D7C5F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#0D7C5F" stopOpacity={0}    />
          </linearGradient>
          <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor="#D32F2F" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#D32F2F" stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="month" tick={axStyle} />
        <YAxis tick={axStyle} tickFormatter={fmt} width={58} />
        <Tooltip formatter={v => fmt(v)} contentStyle={ttStyle} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
        <Area type="monotone" dataKey="inflow"  name="Revenue"  stroke="#0D7C5F" fill="url(#gIn)"  strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="outflow" name="Expenses" stroke="#D32F2F" fill="url(#gOut)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Bank Balance ─────────────────────────────────────────────────────────────
function BankBalanceWidget({ data }) {
  if (!data?.length) return <div className="wd-empty">No bank accounts found</div>;
  return (
    <div className="wd-bank-list">
      {data.map((b, i) => (
        <div key={i} className="wd-bank-row">
          <div>
            <div className="wd-bank-name">{b.name}</div>
            <div className="wd-bank-code">{b.code}</div>
          </div>
          <div className={`wd-bank-amt ${b.balance >= 0 ? 'pos' : 'neg'}`}>{fmt(b.balance)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Receivables ──────────────────────────────────────────────────────────────
function ARWidget({ data }) {
  const total = data.total || 0;
  return (
    <div className="wd-stat">
      <div className="wd-stat-big" style={{ color: '#1565C0' }}>{fmt(total)}</div>
      <div className="wd-stat-sub">Total Outstanding Receivables</div>
      {data.acct_count > 0 && <div className="wd-stat-sub">{data.acct_count} accounts</div>}
      {total === 0 && <div className="wd-stat-note">All caught up ✓</div>}
    </div>
  );
}

// ─── Payables ─────────────────────────────────────────────────────────────────
function APWidget({ data }) {
  const total = data.total || 0;
  return (
    <div className="wd-stat">
      <div className="wd-stat-big" style={{ color: '#D32F2F' }}>{fmt(total)}</div>
      <div className="wd-stat-sub">Total Outstanding Payables</div>
      {data.acct_count > 0 && <div className="wd-stat-sub">{data.acct_count} accounts</div>}
      {total === 0 && <div className="wd-stat-note">No outstanding payables ✓</div>}
    </div>
  );
}

// ─── Top Expenses (custom bar) ────────────────────────────────────────────────
function TopExpensesWidget({ data }) {
  if (!data?.length) return <div className="wd-empty">No expense data yet</div>;
  const max = Math.max(...data.map(d => d.amount), 1);
  return (
    <div className="wd-top-exp">
      {data.map((item, i) => (
        <div key={i} className="wd-exp-row">
          <div className="wd-exp-meta">
            <span className="wd-exp-name" title={item.name}>{item.name}</span>
            <span className="wd-exp-amt">{fmt(item.amount)}</span>
          </div>
          <div className="wd-exp-track">
            <div
              className="wd-exp-fill"
              style={{ width: `${(item.amount / max) * 100}%`, background: PALETTE[i % PALETTE.length] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────
const RENDERERS = {
  profit_loss_summary: ProfitLossWidget,
  sales_trend:         SalesTrendWidget,
  expenses_chart:      ExpensesChartWidget,
  cash_flow_chart:     CashFlowWidget,
  bank_balance:        BankBalanceWidget,
  accounts_receivable: ARWidget,
  accounts_payable:    APWidget,
  top_expenses:        TopExpensesWidget,
};

export function renderWidget(key, data) {
  const C = RENDERERS[key];
  if (!C) return <div className="wd-empty">Unknown widget</div>;
  return <C data={data} />;
}
