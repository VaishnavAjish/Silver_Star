import { useEffect, useRef } from 'react';
import { useRealtime } from './useRealtime';

export function useModuleSync(moduleName, eventTopics, { onEvent, room } = {}) {
  const realtime = useRealtime();
  const roomName = room || `room:${moduleName}`;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const topicsRef = useRef(eventTopics);
  topicsRef.current = eventTopics;

  useEffect(() => {
    realtime.joinRoom(roomName);
    const unsubs = topicsRef.current.map(topic =>
      realtime.subscribe(topic, (payload) => {
        if (onEventRef.current) onEventRef.current(topic, payload);
      })
    );
    return () => {
      realtime.leaveRoom(roomName);
      unsubs.forEach(fn => fn());
    };
  }, [moduleName, roomName, realtime]);

  return {
    lastEvent: realtime.lastEvent,
    events: realtime.events,
    connected: realtime.connected,
  };
}

export function useDashboardSync(opts) {
  return useModuleSync('dashboard', [
    'revenue.updated', 'expenses.updated', 'netprofit.updated', 'dashboard.refresh',
  ], opts);
}

export function useInventorySync(opts) {
  return useModuleSync('inventory', [
    'inventory.created', 'inventory.updated', 'inventory.deleted', 'inventory.stock.changed',
  ], opts);
}

export function useSalesSync(opts) {
  return useModuleSync('sales', [
    'sale.created', 'sale.updated', 'sale.deleted',
  ], opts);
}

export function usePurchaseSync(opts) {
  return useModuleSync('purchase', [
    'purchase.created', 'purchase.updated', 'purchase.deleted',
  ], opts);
}

export function useAccountingSync(opts) {
  return useModuleSync('accounting', [
    'journal.created', 'journal.posted', 'journal.reversed', 'account.created',
  ], opts);
}

export function usePnlSync(opts) {
  return useModuleSync('pnl', [
    'revenue.updated', 'expenses.updated', 'netprofit.updated',
  ], opts);
}

export function useHrSync(opts) {
  return useModuleSync('hr', [
    'user.created', 'user.updated',
  ], opts);
}

export function usePayrollSync(opts) {
  return useModuleSync('payroll', [
    'payroll.updated',
  ], opts);
}

export function useCrmSync(opts) {
  return useModuleSync('crm', [
    'customer.created', 'customer.updated', 'customer.deleted',
  ], opts);
}

export function useReportsSync(opts) {
  return useModuleSync('reports', [
    'report.generated', 'dashboard.refresh',
  ], opts);
}

export function useNotificationsSync(opts) {
  return useModuleSync('notifications', [
    'notification.created',
  ], opts);
}

export function useManufacturingSync(opts) {
  return useModuleSync('manufacturing', [
    'manufacturing.process.*', 'batch.*',
  ], opts);
}

export function useAssetSync(opts) {
  return useModuleSync('asset', [
    'asset.*', 'asset_template.*', 'fa_category.*', 'depreciation.*',
  ], opts);
}

export function useBankReconSync(opts) {
  return useModuleSync('bankRecon', [
    'bank_deposit.*', 'recon.*',
  ], opts);
}

export function useAuditSync(opts) {
  return useModuleSync('audit', [
    'journal.*', 'je_allocation.*', 'bank_deposit.reversed', 'depreciation.*',
  ], opts);
}
