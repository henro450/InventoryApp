import * as Network from 'expo-network';
import NetInfo from '@react-native-community/netinfo';
import { api } from '../api/client';
import {
  getPendingOperations,
  markOperationApplied,
  markOperationFailed,
  markOperationConflict,
  getSyncCursor,
  setSyncCursor,
  setLastSyncedAt,
  upsertLocalItem,
  hasPendingItemWork,
  purgeOldSyncedTransactions,
} from '../db/localDb';

let syncInProgress = false;

// NFR-07: a huge pending queue is pushed in fixed-size chunks rather than one giant request,
// so a large offline backlog can't produce a single oversized/slow/failure-prone payload.
const BATCH_SIZE = 50;

// Pushes the durable outbox first, then advances an ordered PostgreSQL change cursor. Both
// directions are retry-safe: operation receipts dedupe uploads and sequence cursors cannot
// miss writes that commit while a pull is running.
export async function runSync(userId) {
  if (syncInProgress) return { skipped: true };
  syncInProgress = true;

  try {
    const netState = await Network.getNetworkStateAsync();
    if (!netState.isConnected || netState.isInternetReachable === false) {
      return { offline: true };
    }

    let operationsSynced = 0;
    for (let pass = 0; pass < 100; pass++) {
      const batch = getPendingOperations(userId, BATCH_SIZE);
      if (batch.length === 0) break;

      let response;
      try {
        response = await api.syncOperations(batch);
      } catch (error) {
        for (const operation of batch) markOperationFailed(operation.id, error.message);
        throw error;
      }

      const byId = new Map(response.results.map((result) => [result.operationId, result]));
      for (const operation of batch) {
        const result = byId.get(operation.id);
        if (!result) {
          markOperationFailed(operation.id, 'Server returned no operation result');
        } else if (result.status === 'applied' || result.status === 'deduped') {
          markOperationApplied(operation.id, result);
          operationsSynced++;
        } else if (result.status === 'conflict') {
          markOperationConflict(operation.id, result.error, result.serverRecord);
        } else {
          markOperationFailed(operation.id, result.error);
        }
      }
    }

    let cursor = getSyncCursor(userId);
    let pulledChanges = 0;
    let hasMore;
    do {
      const page = await api.syncChanges(cursor, 500);
      for (const change of page.changes) {
        if (change.entityType !== 'item' || !change.data) continue;
        const item = change.data;
        const localId = item.clientItemId || `server-${item.id}`;
        if (hasPendingItemWork(localId, item.id)) continue;

        upsertLocalItem({
          id: item.id,
          localId,
          clientItemId: item.clientItemId,
          sku: item.sku,
          name: item.name,
          category: item.category,
          unit: item.unit,
          companyId: item.companyId,
          quantityOnHand: item.quantityOnHand,
          lowStockThreshold: item.lowStockThreshold,
          lastPurchasePrice: item.lastPurchasePrice,
          version: item.version,
          updatedAt: item.updatedAt,
          syncStatus: 'synced',
          userId,
          isActive: change.operation === 'delete' ? false : item.isActive,
        });
      }
      cursor = page.cursor;
      setSyncCursor(userId, cursor);
      pulledChanges += page.changes.length;
      hasMore = page.hasMore;
    } while (hasMore);

    setLastSyncedAt(userId, new Date().toISOString());
    purgeOldSyncedTransactions(); // NFR-06: prune old synced history now that sync succeeded

    return {
      success: true,
      operationsSynced,
      pulledChanges,
      cursor,
    };
  } catch (err) {
    return { error: err.message };
  } finally {
    syncInProgress = false;
  }
}

// Call this once near app startup. SYNC-03: subscribes to real connectivity-change events via
// NetInfo and fires runSync immediately on an offline->online transition, so the user isn't
// stuck waiting for the next poll tick after reconnecting. The interval poll is kept as a
// fallback in case a transition is missed (e.g. the app was backgrounded through it).
export function startConnectivityWatcher(userId, intervalMs = 15000) {
  let wasOffline = false;

  const unsubscribeListener = NetInfo.addEventListener((state) => {
    const isOnline = !!(state.isConnected && state.isInternetReachable);
    if (isOnline && wasOffline) {
      runSync(userId);
    }
    wasOffline = !isOnline;
  });

  const interval = setInterval(() => {
    runSync(userId);
  }, intervalMs);

  return () => {
    unsubscribeListener();
    clearInterval(interval);
  };
}
