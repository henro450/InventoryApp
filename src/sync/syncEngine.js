import * as Network from 'expo-network';
import NetInfo from '@react-native-community/netinfo';
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
  getLocalItemSyncStatus,
  getServerIdForLocalItem,
  purgeOldSyncedTransactions,
} from '../db/localDb';

let syncInProgress = false;

// NFR-07: a huge pending queue is pushed in fixed-size chunks rather than one giant request,
// so a large offline backlog can't produce a single oversized/slow/failure-prone payload.
const BATCH_SIZE = 50;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// SYNC-03/SYNC-05: triggered by two things — a NetInfo listener that fires immediately on an
// offline->online transition (see startConnectivityWatcher), and a periodic timer as a
// fallback in case a transition is missed (e.g. state changed while the app was backgrounded).
// Pushes pending item creates, then edits, then transactions (in that order — a transaction
// needs its item's server id first, and batching item creates/edits to completion before
// building the transaction payload guarantees that id is available even across batches — see
// the itemId resolution comment below). Pulls down anything new afterward. Safe to call
// repeatedly — records already synced are skipped by the server's dedupe checks.
export async function runSync(userId) {
  if (syncInProgress) return { skipped: true };
  syncInProgress = true;

  try {
    const netState = await Network.getNetworkStateAsync();
    if (!netState.isConnected || !netState.isInternetReachable) {
      return { offline: true };
    }

    // AUTH-04: scoped to the current session's own backlog only — a device that's seen
    // other users never cross-pushes their leftover pending rows.
    const pendingItems = getPendingItems(userId);
    const pendingTransactions = getPendingTransactions(userId);

    // INV-01: an item with no server id yet is a create; one that's already synced but was
    // edited/deactivated locally needs an update instead — pushing an edit through the create
    // path would just get deduped by clientItemId and silently drop the change.
    const pendingCreates = pendingItems.filter((i) => !i.id);
    const pendingEdits = pendingItems.filter((i) => i.id);

    // --- Item creates, batched, pushed to completion before anything else ---
    for (const batch of chunk(pendingCreates, BATCH_SIZE)) {
      const itemsPayload = batch.map((i) => ({
        clientItemId: i.clientItemId,
        sku: i.sku,
        name: i.name,
        category: i.category,
        unit: i.unit,
        lowStockThreshold: i.lowStockThreshold,
      }));
      const { itemResults } = await api.syncPush(itemsPayload, [], []);
      for (const r of itemResults) {
        const match = batch.find((i) => i.clientItemId === r.clientItemId);
        if (!match) continue;
        if (r.status === 'synced' || r.status === 'deduped') {
          markItemSynced(match.localId, r.serverId);
        } else {
          markItemFailed(match.localId);
        }
      }
    }

    // --- Item edits/deactivations, batched ---
    for (const batch of chunk(pendingEdits, BATCH_SIZE)) {
      const itemUpdatesPayload = batch.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        unit: i.unit,
        lowStockThreshold: i.lowStockThreshold,
        isActive: !!i.isActive,
      }));
      const { itemUpdateResults } = await api.syncPush([], [], itemUpdatesPayload);
      for (const r of itemUpdateResults) {
        const match = batch.find((i) => i.id === r.id);
        if (!match) continue;
        if (r.status === 'synced') {
          markItemSynced(match.localId, r.id); // id is unchanged, pass it straight through
        } else {
          markItemFailed(match.localId);
        }
      }
    }

    // --- Transactions, batched. Resolved against the CURRENT item table state (not the
    // transaction row's possibly-stale stored itemServerId) — necessary now that item creates
    // are pushed in separate requests from transactions: an item created in this same
    // runSync() call has already synced by this point (batched to completion above), so a
    // live lookup by itemLocalId picks up its real id even though the transaction row's own
    // itemServerId column was never updated. Falls back to clientItemId only when the item
    // genuinely hasn't synced yet (e.g. it failed), matching the server's existing
    // same-request resolution for that case. ---
    for (const batch of chunk(pendingTransactions, BATCH_SIZE)) {
      const transactionsPayload = batch.map((t) => {
        const resolvedItemId = t.itemServerId || getServerIdForLocalItem(t.itemLocalId);
        return {
          clientTransactionId: t.clientTransactionId,
          itemId: resolvedItemId || undefined,
          clientItemId: resolvedItemId ? undefined : t.itemClientItemId,
          type: t.type,
          quantity: t.quantity,
          unitPrice: t.unitPrice,
          occurredAt: t.occurredAt,
        };
      });
      const { results } = await api.syncPush([], transactionsPayload, []);
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
      const localId = item.clientItemId || `server-${item.id}`; // keep client-generated items on their original localId
      const localStatus = getLocalItemSyncStatus(localId);

      // SYNC-08: a local edit is still queued (or just failed) for this item — a stale pull
      // must not silently clobber it. It gets its own chance to push this run or a later one;
      // once it syncs, a subsequent pull will correctly reflect merged server state.
      if (localStatus === 'pending' || localStatus === 'failed') continue;

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
        updatedAt: item.updatedAt,
        syncStatus: 'synced',
        userId,
        isActive: item.isActive,
      });
    }

    setLastSyncedAt(pulled.syncedAt); // SYNC-07: labels how current the cached data is
    purgeOldSyncedTransactions(); // NFR-06: prune old synced history now that sync succeeded

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
