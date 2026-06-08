// Add an entry here to make a new widget available everywhere.
// size: 'full' → spans both columns;  'half' → single column.
import {
  TrendingUp, Landmark, BarChart3, CreditCard,
  RotateCcw, HandCoins, Building2, TrendingDown,
} from 'lucide-react';

export const WIDGET_REGISTRY = {
  profit_loss_summary: {
    title:       'Profit & Loss',
    description: 'Current financial year P&L summary',
    size:        'full',
    icon:        TrendingUp,
    color:       '#0D7C5F',
  },
  bank_balance: {
    title:       'Bank Balances',
    description: 'Cash & bank account balances',
    size:        'half',
    icon:        Landmark,
    color:       '#1565C0',
  },
  sales_trend: {
    title:       'Revenue Trend',
    description: 'Monthly revenue – last 6 months',
    size:        'half',
    icon:        BarChart3,
    color:       '#0D7C5F',
  },
  expenses_chart: {
    title:       'Expenses Breakdown',
    description: 'Top expense categories this year',
    size:        'half',
    icon:        CreditCard,
    color:       '#E87722',
  },
  cash_flow_chart: {
    title:       'Cash Flow',
    description: 'Revenue vs Expenses – last 6 months',
    size:        'full',
    icon:        RotateCcw,
    color:       '#7B1FA2',
  },
  accounts_receivable: {
    title:       'Receivables',
    description: 'Outstanding amounts to collect',
    size:        'half',
    icon:        HandCoins,
    color:       '#1565C0',
  },
  accounts_payable: {
    title:       'Payables',
    description: 'Outstanding amounts to pay',
    size:        'half',
    icon:        TrendingDown,
    color:       '#D32F2F',
  },
  top_expenses: {
    title:       'Top Expenses',
    description: 'Highest expense accounts this year',
    size:        'half',
    icon:        Building2,
    color:       '#E87722',
  },
};

export const ALL_WIDGET_KEYS = Object.keys(WIDGET_REGISTRY);
