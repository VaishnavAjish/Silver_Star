import { useRealTimeSync } from './useRealTimeSync';

export function useDashboardSync(onEvent) {
  useRealTimeSync({
    room: 'room:dashboard',
    eventPrefix: 'dashboard.*',
    onEvent,
    queryKeysToInvalidate: ['dashboard-stats', 'dashboard-trends']
  });
}

export function useInventorySync(onEvent) {
  useRealTimeSync({
    room: 'room:inventory',
    eventPrefix: 'inventory.*',
    onEvent,
    queryKeysToInvalidate: ['inventory', 'inventory-summary', 'inventory-ledgers', 'item-ledger']
  });
}

export function usePurchaseSync(onEvent) {
  useRealTimeSync({
    room: 'room:purchase',
    eventPrefix: 'purchase.*',
    onEvent,
    queryKeysToInvalidate: ['purchaseNotes']
  });
}

export function useSalesSync(onEvent) {
  useRealTimeSync({
    room: 'room:sales',
    eventPrefix: 'sale.*',
    onEvent,
    queryKeysToInvalidate: ['salesInvoices']
  });
}

export function useProcessSync(onEvent) {
  useRealTimeSync({
    room: 'room:process',
    eventPrefix: 'process.*',
    onEvent,
    queryKeysToInvalidate: ['process-transactions', 'process-stats', 'lot-history']
  });
}

export function useManufacturingSync(onEvent) {
  useRealTimeSync({
    room: 'room:manufacturing',
    eventPrefix: 'manufacturing.*',
    onEvent,
    queryKeysToInvalidate: ['manufacturing-dashboard', 'active-processes', 'machine-status']
  });
}

export function useProcessMasterSync(onEvent) {
  useRealTimeSync({
    room: 'room:manufacturing',
    eventPrefix: 'manufacturing.*',
    onEvent,
    queryKeysToInvalidate: ['process-master']
  });
}

export function useAuditSync(onEvent) {
  useRealTimeSync({
    room: 'room:audit',
    eventPrefix: 'audit.*',
    onEvent,
    queryKeysToInvalidate: ['audit-logs']
  });
}

export function useNotificationSync(onEvent) {
  useRealTimeSync({
    room: null, // Subscribes using personal user room implicitly (handled in socketService)
    eventPrefix: 'notification.*',
    onEvent,
    queryKeysToInvalidate: ['notifications', 'unread-notifications-count']
  });
}
