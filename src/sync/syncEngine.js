import * as Network from 'expo-network';
import { api } from '../api/client';
import {
  getPendingTransactions,
  markTransactionSynced,
  markTransactionFailed,
  getPendingItems,
  markItemSynced,
  markItemFailed,
  getLastSyncedAt,
  setLastSyncedAt,
  upsertLocalItem,
} from '../db/localDb';

let syncInProgress = false;

// SYNC-03/SYNC-05: called whenever connectivity is regained (see useSyncOnReconnect hook)
// or on a periodic timer. Pushes pending items, then pending transactions (in that order,
// since a transaction for an offline-created item needs that item's server id first), then
// pulls down anything new from the server. Safe to call repeatedly — records already synced
// are skipped by the server's dedupe checks on clientItemId / clientTransactionId.
export async function runSync(userId) {
  if (syncInProgress) return { skipped: true };
  syncInProgress = true;

  try {
    const netState = await Network.getNetworkStateAsync();
    if (!netState.isConnected || !netState.isInternetReachable) {
      return { offline: true };
    }

    // --- Push pending items first (INV-01/INV-06: items created offline) ---
    // AUTH-04: scoped to the current session's own backlog only — a device that's seen
    // other users never cross-pushes their leftover pending rows.
    const pendingItems = getPendingItems(userId);
    const pendingTransactions = getPendingTransactions(userId);

    // INV-01: an item with no server id yet is a create; one that's already synced but was
    // edited/deactivated locally needs an update instead — pushing an edit through the create
    // path would just get deduped by clientItemId and silently drop the change.
    const pendingCreates = pendingItems.filter((i) => !i.id);
    const pendingEdits = pendingItems.filter((i) => i.id);

    if (pendingItems.length > 0 || pendingTransactions.length > 0) {
      const itemsPayload = pendingCreates.map((i) => ({
        clientItemId: i.clientItemId,
        sku: i.sku,
        name: i.name,
        category: i.category,
        unit: i.unit,
        lowStockThreshold: i.lowStockThreshold,
      }));

      const itemUpdatesPayload = pendingEdits.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        unit: i.unit,
        lowStockThreshold: i.lowStockThreshold,
        isActive: !!i.isActive,
      }));

      const transactionsPayload = pendingTransactions.map((t) => ({
        clientTransactionId: t.clientTransactionId,
        itemId: t.itemServerId || undefined, // already-synced item
        clientItemId: t.itemServerId ? undefined : t.itemClientItemId, // newly-created item in this same batch
        type: t.type,
        quantity: t.quantity,
        unitPrice: t.unitPrice,
        occurredAt: t.occurredAt,
      }));

      const { itemResults, results, itemUpdateResults } = await api.syncPush(
        itemsPayload,
        transactionsPayload,
        itemUpdatesPayload
      );

      for (const r of itemResults) {
        if (r.status === 'synced' || r.status === 'deduped') {
          markItemSynced(
            pendingCreates.find((i) => i.clientItemId === r.clientItemId)?.localId,
            r.serverId
          );
        } else {
          markItemFailed(pendingCreates.find((i) => i.clientItemId === r.clientItemId)?.localId);
        }
      }

      for (const r of itemUpdateResults) {
        const match = pendingEdits.find((i) => i.id === r.id);
        if (!match) continue;
        if (r.status === 'synced') {
          markItemSynced(match.localId, r.id); // id is unchanged, pass it straight through
        } else {
          markItemFailed(match.localId);
        }
      }

      for (const r of results) {
        if (r.status === 'synced' || r.status === 'deduped') {
          markTransactionSynced(r.clientTransactionId, r.serverId);
        } else {
          markTransactionFailed(r.clientTransactionId); // will retry on next sync pass
        }
      }
    }

    // --- Pull updates since last successful sync ---
    const since = getLastSyncedAt();
    const pulled = await api.syncPull(since);

    for (const item of pulled.items) {
      upsertLocalItem({
        id: item.id,
        localId: item.clientItemId || `server-${item.id}`, // keep client-generated items on their original localId
        clientItemId: item.clientItemId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        companyId: item.companyId,
        quantityOnHand: item.quantityOnHand,
        lowStockThreshold: item.lowStockThreshold,
        lastPurchasePrice: item.lastPurchasePrice,
        updatedAt: item.updatedAt,
        syncStatus: 'synced',
        userId,
        isActive: item.isActive,
      });
    }

    setLastSyncedAt(pulled.syncedAt); // SYNC-07: labels how current the cached data is

    return {
      success: true,
      itemsSynced: pendingItems.length,
      transactionsSynced: pendingTransactions.length,
      pulledItems: pulled.items.length,
    };
  } catch (err) {
    return { error: err.message };
  } finally {
    syncInProgress = false;
  }
}

// Call this once near app startup to sync periodically. (A production build would use
// Network.addNetworkStateListener; this simple polling version keeps the example
// dependency-light and easy to follow.)
export function startConnectivityWatcher(userId, intervalMs = 15000) {
  const interval = setInterval(() => {
    runSync(userId);
  }, intervalMs);
  return () => clearInterval(interval);
}
