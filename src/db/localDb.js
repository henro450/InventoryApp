import * as SQLite from 'expo-sqlite';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

// On-device database — mirrors the subset of the cloud schema needed for offline work
// (SYNC-01/SYNC-02). A Sub Company device stores its own items/transactions; a Main
// Company device additionally caches a read-only snapshot of its Sub Companies' data
// after each pull (see src/sync/syncEngine.js).
const db = SQLite.openDatabaseSync('inventory.db');

export function initLocalDb() {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER,               -- server id, null until first synced
      localId TEXT PRIMARY KEY, -- client-generated id, always present
      clientItemId TEXT,        -- same value as localId when created offline; used for server dedupe
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT DEFAULT 'unit',
      companyId INTEGER,
      quantityOnHand REAL DEFAULT 0,
      lowStockThreshold REAL DEFAULT 0,
      lastPurchasePrice REAL,
      version INTEGER DEFAULT 1,
      updatedAt TEXT,
      syncStatus TEXT DEFAULT 'synced', -- 'pending' | 'synced' | 'failed' | 'conflict'
      userId INTEGER, -- AUTH-04: owner of this row, so a sync run only ever pushes the current user's own backlog
      isActive INTEGER DEFAULT 1 -- INV-01: soft-delete flag, mirrors the server's Item.isActive
    );

    CREATE TABLE IF NOT EXISTS stock_transactions (
      clientTransactionId TEXT PRIMARY KEY, -- matches server's clientTransactionId (dedupe key)
      itemLocalId TEXT NOT NULL,
      itemServerId INTEGER,        -- null if the item hasn't synced yet
      itemClientItemId TEXT,       -- used to resolve the item server-side when itemServerId is null
      companyId INTEGER,
      type TEXT NOT NULL,          -- 'in' | 'out' | 'adjustment'
      quantity REAL NOT NULL,
      unitPrice REAL,
      priceWasDefaulted INTEGER DEFAULT 0,
      occurredAt TEXT NOT NULL,
      syncStatus TEXT DEFAULT 'pending', -- 'pending' | 'synced' | 'failed'
      userId INTEGER -- AUTH-04: owner of this row
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox (
      operationId TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      companyId INTEGER NOT NULL,
      entityType TEXT NOT NULL,
      entityLocalId TEXT NOT NULL,
      operationType TEXT NOT NULL,
      payload TEXT NOT NULL,
      baseVersion INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      retryCount INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT,
      lastError TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS outbox_user_status_created_idx
      ON outbox (userId, status, createdAt);
  `);

  // Guarded migration for dev databases created before the userId column existed —
  // fails harmlessly on fresh installs where CREATE TABLE already included it.
  tryAddColumn('items', 'userId INTEGER');
  tryAddColumn('stock_transactions', 'userId INTEGER');
  tryAddColumn('items', 'isActive INTEGER DEFAULT 1');
  tryAddColumn('items', 'retryCount INTEGER DEFAULT 0');
  tryAddColumn('items', 'nextRetryAt TEXT');
  tryAddColumn('items', 'version INTEGER DEFAULT 1');
  tryAddColumn('stock_transactions', 'retryCount INTEGER DEFAULT 0');
  tryAddColumn('stock_transactions', 'nextRetryAt TEXT');
  migrateLegacyPendingRecords();
}

function tryAddColumn(table, columnDef) {
  try {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    // column already exists
  }
}

// SYNC-05: exponential backoff for failed syncs — 30s, 60s, 120s, 240s, 480s, capped at 10min.
// Uncapped retries (no permanent give-up): this is a low-frequency, small-payload background
// process, so a permanently-broken record just sits retrying every ~10min at negligible cost.
function computeNextRetryAt(retryCount) {
  const delaySeconds = Math.min(30 * Math.pow(2, retryCount - 1), 600);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export function getDb() {
  return db;
}

function runLocalTransaction(work) {
  db.execSync('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.execSync('COMMIT');
    return result;
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}

// --- sync_meta helpers: tracks the last successful pull timestamp (SYNC-04, SYNC-07) ---
export function getLastSyncedAt(userId) {
  const key = userId ? `lastSyncedAt:${userId}` : 'lastSyncedAt';
  const row = db.getFirstSync('SELECT value FROM sync_meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

export function setLastSyncedAt(userId, isoTimestamp) {
  db.runSync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [`lastSyncedAt:${userId}`, isoTimestamp]
  );
}

export function getSyncCursor(userId) {
  const row = db.getFirstSync('SELECT value FROM sync_meta WHERE key = ?', [`syncCursor:${userId}`]);
  return row ? row.value : '0';
}

export function setSyncCursor(userId, cursor) {
  db.runSync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [`syncCursor:${userId}`, String(cursor)]
  );
}

// --- Items ---
export function upsertLocalItem(item) {
  db.runSync(
    `INSERT INTO items (id, localId, clientItemId, sku, name, category, unit, companyId, quantityOnHand, lowStockThreshold, lastPurchasePrice, version, updatedAt, syncStatus, userId, isActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(localId) DO UPDATE SET
       id=excluded.id, clientItemId=excluded.clientItemId, sku=excluded.sku, name=excluded.name,
       category=excluded.category, unit=excluded.unit, companyId=excluded.companyId,
       quantityOnHand=excluded.quantityOnHand, lowStockThreshold=excluded.lowStockThreshold,
       lastPurchasePrice=excluded.lastPurchasePrice, version=excluded.version, updatedAt=excluded.updatedAt,
       syncStatus=excluded.syncStatus, userId=excluded.userId, isActive=excluded.isActive`,
    [
      item.id ?? null,
      item.localId,
      item.clientItemId ?? null,
      item.sku,
      item.name,
      item.category ?? null,
      item.unit ?? 'unit',
      item.companyId,
      item.quantityOnHand ?? 0,
      item.lowStockThreshold ?? 0,
      item.lastPurchasePrice ?? null,
      item.version ?? 1,
      item.updatedAt ?? new Date().toISOString(),
      item.syncStatus ?? 'synced',
      item.userId ?? null,
      item.isActive === undefined || item.isActive === null ? 1 : (item.isActive ? 1 : 0),
    ]
  );
}

function insertOutboxOperation(operation) {
  db.runSync(
    `INSERT INTO outbox
       (operationId, userId, companyId, entityType, entityLocalId, operationType,
        payload, baseVersion, status, retryCount, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      operation.operationId,
      operation.userId,
      operation.companyId,
      operation.entityType,
      operation.entityLocalId,
      operation.operationType,
      JSON.stringify(operation.payload),
      operation.baseVersion ?? null,
      operation.createdAt || new Date().toISOString(),
    ]
  );
}

function itemOperation(item) {
  const operationType = !item.id
    ? 'item.create'
    : item.isActive === 0 || item.isActive === false
      ? 'item.delete'
      : 'item.update';
  const payload = operationType === 'item.create'
    ? {
        clientItemId: item.clientItemId || item.localId,
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        lowStockThreshold: item.lowStockThreshold,
      }
    : {
        id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        lowStockThreshold: item.lowStockThreshold,
      };

  return { operationType, payload };
}

// Writes the local item and its durable operation atomically. Repeated offline edits are
// coalesced into one latest operation so reconnecting never replays stale intermediate forms.
export function saveLocalItem(item) {
  if (!item.userId || !item.companyId || !item.localId) {
    throw new Error('userId, companyId, and localId are required for an offline item write');
  }
  const { operationType, payload } = itemOperation(item);
  return runLocalTransaction(() => {
    upsertLocalItem({ ...item, syncStatus: 'pending' });
    db.runSync(
      "DELETE FROM outbox WHERE entityType = 'item' AND entityLocalId = ? AND userId = ?",
      [item.localId, item.userId]
    );
    insertOutboxOperation({
      operationId: uuidv4(),
      userId: item.userId,
      companyId: item.companyId,
      entityType: 'item',
      entityLocalId: item.localId,
      operationType,
      payload,
      baseVersion: item.id ? (item.version ?? 1) : null,
    });
  });
}

function migrateLegacyPendingRecords() {
  const pendingItems = db.getAllSync(
    "SELECT * FROM items WHERE userId IS NOT NULL AND syncStatus IN ('pending', 'failed')"
  );
  for (const item of pendingItems) {
    const exists = db.getFirstSync(
      "SELECT 1 FROM outbox WHERE entityType = 'item' AND entityLocalId = ? LIMIT 1",
      [item.localId]
    );
    if (exists) continue;
    const { operationType, payload } = itemOperation(item);
    insertOutboxOperation({
      operationId: `legacy-item-${item.userId}-${item.localId}`,
      userId: item.userId,
      companyId: item.companyId,
      entityType: 'item',
      entityLocalId: item.localId,
      operationType,
      payload,
      baseVersion: item.id ? (item.version ?? 1) : null,
      createdAt: item.updatedAt,
    });
  }

  const pendingTransactions = db.getAllSync(
    "SELECT * FROM stock_transactions WHERE userId IS NOT NULL AND syncStatus IN ('pending', 'failed')"
  );
  for (const tx of pendingTransactions) {
    const operationId = `legacy-tx-${tx.clientTransactionId}`;
    const exists = db.getFirstSync('SELECT 1 FROM outbox WHERE operationId = ?', [operationId]);
    if (exists) continue;
    insertOutboxOperation({
      operationId,
      userId: tx.userId,
      companyId: tx.companyId,
      entityType: 'stock_transaction',
      entityLocalId: tx.clientTransactionId,
      operationType: 'stock_transaction.create',
      payload: {
        clientTransactionId: tx.clientTransactionId,
        itemId: tx.itemServerId,
        clientItemId: tx.itemClientItemId,
        type: tx.type,
        quantity: tx.quantity,
        unitPrice: tx.unitPrice,
        occurredAt: tx.occurredAt,
      },
      createdAt: tx.occurredAt,
    });
  }
}

export function getLocalItems(companyId) {
  return db.getAllSync(
    'SELECT * FROM items WHERE companyId = ? AND (isActive IS NULL OR isActive = 1) ORDER BY name ASC',
    [companyId]
  );
}

// INV-01: hard-deletes an item that never reached the server (id still null) — nothing to
// reconcile server-side, so there's no reason to keep it around as a soft-deleted row. Also
// removes any transactions queued against it, which can only still be 'pending' themselves
// (a transaction can't have synced for an item the server has never heard of).
export function deleteLocalItem(localId) {
  runLocalTransaction(() => {
    const transactions = db.getAllSync(
      'SELECT clientTransactionId FROM stock_transactions WHERE itemLocalId = ?', [localId]
    );
    for (const tx of transactions) {
      db.runSync('DELETE FROM outbox WHERE entityLocalId = ?', [tx.clientTransactionId]);
    }
    db.runSync("DELETE FROM outbox WHERE entityType = 'item' AND entityLocalId = ?", [localId]);
    db.runSync('DELETE FROM stock_transactions WHERE itemLocalId = ?', [localId]);
    db.runSync('DELETE FROM items WHERE localId = ?', [localId]);
  });
}

// --- Stock transactions (queued for sync) ---
export function insertLocalTransaction(tx) {
  db.runSync(
    `INSERT INTO stock_transactions
       (clientTransactionId, itemLocalId, itemServerId, itemClientItemId, companyId, type, quantity, unitPrice, priceWasDefaulted, occurredAt, syncStatus, userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      tx.clientTransactionId,
      tx.itemLocalId,
      tx.itemServerId ?? null,
      tx.itemClientItemId ?? null,
      tx.companyId,
      tx.type,
      tx.quantity,
      tx.unitPrice ?? null,
      tx.priceWasDefaulted ? 1 : 0,
      tx.occurredAt || new Date().toISOString(),
      tx.userId ?? null,
    ]
  );
}

// Stock movement, optimistic item balance, and its outbox entry commit together. A crash can
// therefore never leave visible stock without an operation that will eventually reach the API.
export function saveLocalStockTransaction(tx, updatedItem) {
  return runLocalTransaction(() => {
    insertLocalTransaction(tx);
    upsertLocalItem(updatedItem);
    insertOutboxOperation({
      operationId: tx.clientTransactionId,
      userId: tx.userId,
      companyId: tx.companyId,
      entityType: 'stock_transaction',
      entityLocalId: tx.clientTransactionId,
      operationType: 'stock_transaction.create',
      payload: {
        clientTransactionId: tx.clientTransactionId,
        itemId: tx.itemServerId,
        clientItemId: tx.itemClientItemId,
        type: tx.type,
        quantity: tx.quantity,
        unitPrice: tx.unitPrice,
        occurredAt: tx.occurredAt,
      },
    });
  });
}

export function getPendingOperations(userId, limit = 50) {
  const now = new Date().toISOString();
  const rows = db.getAllSync(
    `SELECT * FROM outbox
     WHERE userId = ?
       AND (status = 'pending' OR (status = 'failed' AND (nextRetryAt IS NULL OR nextRetryAt <= ?)))
     ORDER BY
       CASE operationType WHEN 'item.create' THEN 0 WHEN 'item.update' THEN 1 WHEN 'item.delete' THEN 1 ELSE 2 END,
       createdAt ASC
     LIMIT ?`,
    [userId, now, limit]
  );
  return rows.map((row) => ({
    id: row.operationId,
    type: row.operationType,
    entityId: JSON.parse(row.payload).id ?? null,
    baseVersion: row.baseVersion,
    payload: JSON.parse(row.payload),
  }));
}

export function markOperationApplied(operationId, result) {
  runLocalTransaction(() => {
    const operation = db.getFirstSync('SELECT * FROM outbox WHERE operationId = ?', [operationId]);
    if (!operation) return;
    db.runSync('DELETE FROM outbox WHERE operationId = ?', [operationId]);

    if (operation.entityType === 'item') {
      const remaining = db.getFirstSync(
        "SELECT COUNT(*) AS count FROM outbox WHERE entityType = 'item' AND entityLocalId = ?",
        [operation.entityLocalId]
      );
      db.runSync(
        `UPDATE items SET id = COALESCE(?, id), version = COALESCE(?, version),
                          syncStatus = ?, retryCount = 0, nextRetryAt = NULL
         WHERE localId = ?`,
        [result.serverId ?? null, result.version ?? null, remaining.count ? 'pending' : 'synced', operation.entityLocalId]
      );
    } else if (operation.entityType === 'stock_transaction') {
      db.runSync(
        `UPDATE stock_transactions
         SET syncStatus = 'synced', itemServerId = COALESCE(?, itemServerId), retryCount = 0, nextRetryAt = NULL
         WHERE clientTransactionId = ?`,
        [result.itemId ?? null, operation.entityLocalId]
      );
      if (result.itemId) {
        db.runSync(
          `UPDATE items SET id = COALESCE(id, ?)
           WHERE localId = (SELECT itemLocalId FROM stock_transactions WHERE clientTransactionId = ?)`,
          [result.itemId, operation.entityLocalId]
        );
      }
    }
  });
}

export function markOperationFailed(operationId, errorMessage) {
  const row = db.getFirstSync('SELECT retryCount, entityType, entityLocalId FROM outbox WHERE operationId = ?', [operationId]);
  if (!row) return;
  const retryCount = (row.retryCount || 0) + 1;
  db.runSync(
    `UPDATE outbox SET status = 'failed', retryCount = ?, nextRetryAt = ?, lastError = ?
     WHERE operationId = ?`,
    [retryCount, computeNextRetryAt(retryCount), errorMessage || null, operationId]
  );
  if (row.entityType === 'item') {
    db.runSync("UPDATE items SET syncStatus = 'failed' WHERE localId = ?", [row.entityLocalId]);
  } else {
    db.runSync("UPDATE stock_transactions SET syncStatus = 'failed' WHERE clientTransactionId = ?", [row.entityLocalId]);
  }
}

export function markOperationConflict(operationId, errorMessage, serverRecord) {
  const row = db.getFirstSync(
    'SELECT entityType, entityLocalId, operationType FROM outbox WHERE operationId = ?',
    [operationId]
  );
  if (!row) return;
  runLocalTransaction(() => {
    db.runSync(
      "UPDATE outbox SET status = 'conflict', lastError = ?, nextRetryAt = NULL WHERE operationId = ?",
      [errorMessage || 'Changed on another device', operationId]
    );
    if (row.entityType === 'item') {
      // Keep the user's edited fields, but adopt the current server version. Their next
      // explicit edit/deactivate is then a deliberate retry against the latest revision.
      db.runSync(
        `UPDATE items
         SET syncStatus = 'conflict', version = COALESCE(?, version),
             isActive = CASE WHEN ? = 'item.delete' THEN 1 ELSE isActive END
         WHERE localId = ?`,
        [serverRecord?.version ?? null, row.operationType, row.entityLocalId]
      );
    }
  });
}

export function hasPendingItemWork(localId, serverId) {
  const row = db.getFirstSync(
    `SELECT 1 FROM outbox
     WHERE entityLocalId = ?
        OR (entityType = 'stock_transaction' AND (
             json_extract(payload, '$.clientItemId') = ?
             OR json_extract(payload, '$.itemId') = ?
           ))
     LIMIT 1`,
    [localId, localId, serverId ?? null]
  );
  return !!row;
}

export function getPendingCount(userId) {
  const query = userId
    ? { sql: 'SELECT COUNT(*) AS count FROM outbox WHERE userId = ?', params: [userId] }
    : { sql: 'SELECT COUNT(*) AS count FROM outbox', params: [] };
  const row = db.getFirstSync(query.sql, query.params);
  return row ? row.count : 0;
}

export function getSyncStatusSummary(userId) {
  const rows = db.getAllSync(
    `SELECT status, COUNT(*) AS count FROM outbox
     WHERE userId = ? GROUP BY status`,
    [userId]
  );
  const summary = { total: 0, pending: 0, failed: 0, conflict: 0 };
  for (const row of rows) {
    summary[row.status] = row.count;
    summary.total += row.count;
  }
  return summary;
}

// NFR-06: local data retention/cleanup for already-synced records. Only 'synced' rows are
// ever eligible — 'pending'/'failed' rows are never touched regardless of age, since their
// data isn't safely persisted server-side yet. Items (the catalog) are never purged, only
// historical stock_transactions rows, whose cumulative effect is already baked into the
// item's current quantityOnHand and is safely queryable server-side via reports if needed.
// Called automatically after every successful sync (see syncEngine.js) — cheap no-op when
// there's nothing old enough to remove.
export function purgeOldSyncedTransactions(retentionDays = 90) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  db.runSync("DELETE FROM stock_transactions WHERE syncStatus = 'synced' AND occurredAt < ?", [cutoff]);
}

// AUTH-04: wipes all local offline data on a confirmed logout. Only called when the user
// has explicitly confirmed (or had nothing pending to lose) — a forced/session-expiry
// logout never calls this, so an unclean exit's pending backlog survives to resume syncing
// on that same user's next login.
export function clearLocalData() {
  db.execSync('DELETE FROM outbox; DELETE FROM items; DELETE FROM stock_transactions; DELETE FROM sync_meta;');
}
