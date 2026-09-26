import * as SQLite from 'expo-sqlite';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '../utils/phone';

// On-device database — mirrors the subset of the cloud schema needed for offline work
// (SYNC-01/SYNC-02). Every screen reads from here, so the app works fully offline: items,
// companies, and the full stock-transaction history (own company plus, for a Main Company,
// its Sub Companies) are pulled from the server's change feed, and this device's own unsynced
// writes sit alongside them until they're pushed (see src/sync/syncEngine.js). Reports are
// computed from these tables (src/reports/localReports.js).
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

    -- Companies visible to this user (own + linked Sub Companies), from the change feed.
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      parentCompanyId INTEGER,
      isActive INTEGER DEFAULT 1,
      allowSubCompanies INTEGER DEFAULT 1,
      priceAnomalyThresholdPercent REAL DEFAULT 20,
      updatedAt TEXT
    );

    -- Latest server item change that arrived while the item still had unsynced local work.
    -- Applied once that work has been pushed, instead of being dropped.
    CREATE TABLE IF NOT EXISTS deferred_changes (
      localId TEXT PRIMARY KEY,
      userId INTEGER,
      operation TEXT NOT NULL,
      data TEXT NOT NULL
    );

    -- Money received later from customers who owe (see saveLocalDebtPayment). Synced history plus
    -- this device's unsynced payments, like stock_transactions.
    CREATE TABLE IF NOT EXISTS debt_payments (
      clientPaymentId TEXT PRIMARY KEY,
      id INTEGER,
      companyId INTEGER NOT NULL,
      customerName TEXT NOT NULL,
      customerPhone TEXT NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      syncStatus TEXT DEFAULT 'pending',
      userId INTEGER,
      createdByUserId INTEGER
    );

    -- Last server response for data only the server has (audit log, snapshots, sub-company
    -- invite status), shown as a saved copy when offline.
    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      savedAt TEXT NOT NULL
    );
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
  tryAddColumn('stock_transactions', 'id INTEGER'); // server id once pulled
  tryAddColumn('stock_transactions', 'previousQuantity REAL'); // quantity before this movement (discrepancy report)
  tryAddColumn('stock_transactions', 'createdByUserId INTEGER'); // who recorded it (server userId)
  tryAddColumn('stock_transactions', 'paymentMethod TEXT'); // 'cash' | 'transfer' on sales; older sales count as cash
  // Part payments: amount paid at the time of sale (null = paid in full) and who owes the rest.
  tryAddColumn('stock_transactions', 'amountPaid REAL');
  tryAddColumn('stock_transactions', 'customerName TEXT');
  tryAddColumn('stock_transactions', 'customerPhone TEXT');
  db.execSync(`
    CREATE INDEX IF NOT EXISTS stock_transactions_company_idx ON stock_transactions (companyId, type, occurredAt);
    CREATE INDEX IF NOT EXISTS stock_transactions_item_idx ON stock_transactions (itemLocalId);
  `);
  migrateLegacyPendingRecords();
  resyncIfSchemaChanged();
}

// Bump when the pull starts keeping data it used to discard. Older installs advanced their
// cursor past company/transaction changes without storing them, so rewind every cursor to
// download the full feed once. Item upserts are idempotent and items with pending local
// work are still protected, so replaying the feed is safe.
const LOCAL_SCHEMA_VERSION = 3;
function resyncIfSchemaChanged() {
  const row = db.getFirstSync("SELECT value FROM sync_meta WHERE key = 'schemaVersion'");
  if (Number(row?.value || 1) >= LOCAL_SCHEMA_VERSION) return;
  db.runSync("UPDATE sync_meta SET value = '0' WHERE key LIKE 'syncCursor:%'");
  db.runSync(
    "INSERT INTO sync_meta (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(LOCAL_SCHEMA_VERSION)]
  );
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

export function getLocalItemByLocalId(localId) {
  return db.getFirstSync('SELECT * FROM items WHERE localId = ?', [localId]);
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
       (clientTransactionId, itemLocalId, itemServerId, itemClientItemId, companyId, type, quantity, unitPrice, priceWasDefaulted, occurredAt, syncStatus, userId, previousQuantity, createdByUserId, paymentMethod, amountPaid, customerName, customerPhone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
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
      tx.previousQuantity ?? null,
      tx.userId ?? null,
      tx.type === 'out' ? tx.paymentMethod || 'cash' : null,
      tx.type === 'out' && tx.amountPaid !== undefined ? tx.amountPaid : null,
      tx.type === 'out' ? tx.customerName || null : null,
      tx.type === 'out' && tx.customerPhone ? normalizePhone(tx.customerPhone) : null,
    ]
  );
}

// Stock movement, optimistic item balance, and its outbox entry commit together. A crash can
// therefore never leave visible stock without an operation that will eventually reach the API.
// The balance is computed from the item's *current* row inside the same transaction — never
// from a copy the screen loaded earlier — and only the stock fields are written, so a
// background sync or another edit made while the screen was open is never overwritten.
// Throws an error with code 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' (and `available`) for a
// stock-out the current balance can't cover.
export function saveLocalStockTransaction(tx) {
  return runLocalTransaction(() => {
    const item = db.getFirstSync('SELECT * FROM items WHERE localId = ?', [tx.itemLocalId]);
    if (!item) throw new Error('This item is no longer on this device. Go back and try again.');

    const current = Number(item.quantityOnHand) || 0;
    if (tx.type === 'out') {
      if (current <= 0) throw Object.assign(new Error('Out of stock'), { code: 'OUT_OF_STOCK', available: current });
      if (tx.quantity > current) throw Object.assign(new Error('Not enough stock'), { code: 'INSUFFICIENT_STOCK', available: current });
    }
    const nextQuantity = tx.type === 'in' ? current + tx.quantity : tx.type === 'out' ? current - tx.quantity : tx.quantity;

    const record = {
      ...tx,
      itemServerId: tx.itemServerId ?? item.id ?? null,
      itemClientItemId: tx.itemClientItemId ?? item.clientItemId ?? null,
      previousQuantity: current,
    };
    insertLocalTransaction(record);
    db.runSync(
      `UPDATE items
       SET quantityOnHand = ?, lastPurchasePrice = CASE WHEN ? = 'in' THEN ? ELSE lastPurchasePrice END, updatedAt = ?
       WHERE localId = ?`,
      [nextQuantity, tx.type, tx.unitPrice ?? null, new Date().toISOString(), tx.itemLocalId]
    );
    insertOutboxOperation({
      operationId: tx.clientTransactionId,
      userId: tx.userId,
      companyId: tx.companyId,
      entityType: 'stock_transaction',
      entityLocalId: tx.clientTransactionId,
      operationType: 'stock_transaction.create',
      payload: {
        clientTransactionId: tx.clientTransactionId,
        itemId: record.itemServerId,
        clientItemId: record.itemClientItemId,
        type: tx.type,
        quantity: tx.quantity,
        unitPrice: tx.unitPrice,
        paymentMethod: tx.type === 'out' ? tx.paymentMethod || 'cash' : undefined,
        amountPaid: tx.type === 'out' && tx.amountPaid !== null ? tx.amountPaid : undefined,
        customerName: tx.type === 'out' ? tx.customerName || undefined : undefined,
        customerPhone: tx.type === 'out' && tx.customerPhone ? normalizePhone(tx.customerPhone) : undefined,
        occurredAt: tx.occurredAt,
      },
    });
    return { previousQuantity: current, quantityOnHand: nextQuantity };
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
    } else if (operation.entityType === 'debt_payment') {
      db.runSync("UPDATE debt_payments SET syncStatus = 'synced', id = COALESCE(?, id) WHERE clientPaymentId = ?", [
        result.serverId ?? null,
        operation.entityLocalId,
      ]);
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
  } else if (row.entityType === 'debt_payment') {
    db.runSync("UPDATE debt_payments SET syncStatus = 'failed' WHERE clientPaymentId = ?", [row.entityLocalId]);
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

// localIds of items with any unsynced edit or stock movement, for per-row 'waiting to sync'.
export function getItemIdsWithPendingWork(userId) {
  const rows = db.getAllSync(
    `SELECT localId FROM items
     WHERE localId IN (SELECT entityLocalId FROM outbox WHERE userId = ? AND entityType = 'item')
        OR localId IN (SELECT json_extract(payload, '$.clientItemId') FROM outbox WHERE userId = ? AND entityType = 'stock_transaction')
        OR id IN (SELECT json_extract(payload, '$.itemId') FROM outbox WHERE userId = ? AND entityType = 'stock_transaction')`,
    [userId, userId, userId]
  );
  return new Set(rows.map((r) => r.localId));
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

// AUTH-04: wipes all local offline data on a confirmed logout. Only called when the user
// has explicitly confirmed (or had nothing pending to lose) — a forced/session-expiry
// logout never calls this, so an unclean exit's pending backlog survives to resume syncing
// on that same user's next login.
export function clearLocalData() {
  db.execSync(
    'DELETE FROM outbox; DELETE FROM items; DELETE FROM stock_transactions; DELETE FROM companies; ' +
    'DELETE FROM deferred_changes; DELETE FROM api_cache; DELETE FROM debt_payments; ' +
    "DELETE FROM sync_meta WHERE key <> 'schemaVersion';"
  );
}

// --- Pulled server data ---

// Server transactions arrive with the server's item id; map it to the local item row. Items
// always precede their transactions in the commit-ordered feed, so the row normally exists.
function resolveItemLocalId(serverItemId) {
  const row = db.getFirstSync('SELECT localId FROM items WHERE id = ? LIMIT 1', [serverItemId]);
  return row ? row.localId : `server-${serverItemId}`;
}

// Stores a transaction from the change feed. Keyed by clientTransactionId, so the server's
// copy of a transaction recorded on this device replaces the local row in place (picking up
// the server-resolved price and previousQuantity) rather than being counted twice.
export function upsertPulledTransaction(tx, userId) {
  const existing = db.getFirstSync('SELECT itemLocalId FROM stock_transactions WHERE clientTransactionId = ?', [tx.clientTransactionId]);
  db.runSync(
    `INSERT INTO stock_transactions
       (clientTransactionId, id, itemLocalId, itemServerId, companyId, type, quantity, unitPrice, priceWasDefaulted,
        previousQuantity, occurredAt, syncStatus, userId, createdByUserId, paymentMethod, amountPaid, customerName, customerPhone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(clientTransactionId) DO UPDATE SET
       id = excluded.id, itemServerId = excluded.itemServerId, companyId = excluded.companyId, type = excluded.type,
       quantity = excluded.quantity, unitPrice = excluded.unitPrice, priceWasDefaulted = excluded.priceWasDefaulted,
       previousQuantity = excluded.previousQuantity, occurredAt = excluded.occurredAt, syncStatus = 'synced',
       createdByUserId = excluded.createdByUserId, paymentMethod = excluded.paymentMethod,
       amountPaid = excluded.amountPaid, customerName = excluded.customerName, customerPhone = excluded.customerPhone`,
    [
      tx.clientTransactionId,
      tx.id,
      existing ? existing.itemLocalId : resolveItemLocalId(tx.itemId),
      tx.itemId,
      tx.companyId,
      tx.type,
      Number(tx.quantity),
      tx.unitPrice === null || tx.unitPrice === undefined ? null : Number(tx.unitPrice),
      tx.priceWasDefaulted ? 1 : 0,
      tx.previousQuantity === null || tx.previousQuantity === undefined ? null : Number(tx.previousQuantity),
      tx.occurredAt,
      userId,
      tx.userId ?? null,
      tx.paymentMethod ?? null,
      tx.amountPaid === null || tx.amountPaid === undefined ? null : Number(tx.amountPaid),
      tx.customerName ?? null,
      tx.customerPhone ?? null,
    ]
  );
}

export function deletePulledTransaction(clientTransactionId) {
  db.runSync("DELETE FROM stock_transactions WHERE clientTransactionId = ? AND syncStatus = 'synced'", [clientTransactionId]);
}

export function upsertLocalCompany(company, { deleted = false } = {}) {
  db.runSync(
    `INSERT INTO companies (id, name, type, parentCompanyId, isActive, allowSubCompanies, priceAnomalyThresholdPercent, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, type = excluded.type, parentCompanyId = excluded.parentCompanyId,
       isActive = excluded.isActive, allowSubCompanies = excluded.allowSubCompanies,
       priceAnomalyThresholdPercent = excluded.priceAnomalyThresholdPercent, updatedAt = excluded.updatedAt`,
    [
      company.id,
      company.name,
      company.type ?? null,
      company.parentCompanyId ?? null,
      deleted || company.isActive === false ? 0 : 1,
      company.allowSubCompanies === false ? 0 : 1,
      company.priceAnomalyThresholdPercent === null || company.priceAnomalyThresholdPercent === undefined
        ? 20
        : Number(company.priceAnomalyThresholdPercent),
      company.updatedAt ?? null,
    ]
  );
}

function companyRow(row) {
  return row ? { ...row, isActive: row.isActive !== 0, allowSubCompanies: row.allowSubCompanies !== 0 } : null;
}

export function getLocalCompany(id) {
  return companyRow(db.getFirstSync('SELECT * FROM companies WHERE id = ?', [id]));
}

// Sub Companies linked to a Main Company, active or not (deactivated ones stay listed).
export function getLocalSubCompanies(parentCompanyId) {
  return db.getAllSync('SELECT * FROM companies WHERE parentCompanyId = ? ORDER BY name ASC', [parentCompanyId]).map(companyRow);
}

// Reflects a setting saved through the API right away, before the change feed brings it back.
export function setLocalCompanyThreshold(id, percent) {
  db.runSync('UPDATE companies SET priceAnomalyThresholdPercent = ? WHERE id = ?', [percent, id]);
}

// Active items across a set of companies (reports and summaries).
export function getLocalItemsForCompanies(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(
    `SELECT * FROM items WHERE companyId IN (${marks}) AND (isActive IS NULL OR isActive = 1) ORDER BY name ASC`,
    companyIds
  );
}

// Every item row (active or not) for the given companies — transactions can reference an
// item that has since been deactivated.
export function getAllLocalItemsForCompanies(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM items WHERE companyId IN (${marks})`, companyIds);
}

// Every stock transaction on this device for the given companies — synced history plus this
// device's unsynced ones.
export function getLocalTransactions(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM stock_transactions WHERE companyId IN (${marks})`, companyIds);
}

// --- Debt repayments ---

// Money received from a customer against what they owe. Saved on the device first (works
// offline) with its outbox operation, like a stock transaction.
export function saveLocalDebtPayment(payment) {
  const record = { ...payment, customerPhone: normalizePhone(payment.customerPhone), customerName: payment.customerName.trim() };
  return runLocalTransaction(() => {
    db.runSync(
      `INSERT INTO debt_payments
         (clientPaymentId, companyId, customerName, customerPhone, amount, paymentMethod, occurredAt, syncStatus, userId, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [record.clientPaymentId, record.companyId, record.customerName, record.customerPhone, record.amount, record.paymentMethod, record.occurredAt, record.userId, record.userId]
    );
    insertOutboxOperation({
      operationId: record.clientPaymentId,
      userId: record.userId,
      companyId: record.companyId,
      entityType: 'debt_payment',
      entityLocalId: record.clientPaymentId,
      operationType: 'debt_payment.create',
      payload: {
        clientPaymentId: record.clientPaymentId,
        customerName: record.customerName,
        customerPhone: record.customerPhone,
        amount: record.amount,
        paymentMethod: record.paymentMethod,
        occurredAt: record.occurredAt,
      },
    });
  });
}

export function upsertPulledDebtPayment(p, userId) {
  db.runSync(
    `INSERT INTO debt_payments
       (clientPaymentId, id, companyId, customerName, customerPhone, amount, paymentMethod, occurredAt, syncStatus, userId, createdByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
     ON CONFLICT(clientPaymentId) DO UPDATE SET
       id = excluded.id, companyId = excluded.companyId, customerName = excluded.customerName,
       customerPhone = excluded.customerPhone, amount = excluded.amount, paymentMethod = excluded.paymentMethod,
       occurredAt = excluded.occurredAt, syncStatus = 'synced', createdByUserId = excluded.createdByUserId`,
    [p.clientPaymentId, p.id, p.companyId, p.customerName, p.customerPhone, Number(p.amount), p.paymentMethod, p.occurredAt, userId, p.userId ?? null]
  );
}

export function getLocalDebtPayments(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM debt_payments WHERE companyId IN (${marks})`, companyIds);
}

// --- Deferred item changes (see syncEngine pull) ---
export function deferItemChange(localId, userId, operation, data) {
  db.runSync(
    `INSERT INTO deferred_changes (localId, userId, operation, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(localId) DO UPDATE SET userId = excluded.userId, operation = excluded.operation, data = excluded.data`,
    [localId, userId, operation, JSON.stringify(data)]
  );
}

export function getDeferredChanges(userId) {
  return db.getAllSync('SELECT * FROM deferred_changes WHERE userId = ?', [userId]).map((row) => ({
    ...row,
    data: JSON.parse(row.data),
  }));
}

export function removeDeferredChange(localId) {
  db.runSync('DELETE FROM deferred_changes WHERE localId = ?', [localId]);
}

// --- Saved copies of server-only data ---
export function getCached(key) {
  const row = db.getFirstSync('SELECT json, savedAt FROM api_cache WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return { data: JSON.parse(row.json), savedAt: row.savedAt };
  } catch {
    return null;
  }
}

export function setCached(key, data) {
  db.runSync(
    'INSERT INTO api_cache (key, json, savedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, savedAt = excluded.savedAt',
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

// Unsynced operations for a company, newest first — shown in the audit log as "Waiting to sync".
export function getOutboxForCompany(userId, companyId) {
  return db.getAllSync(
    'SELECT * FROM outbox WHERE userId = ? AND companyId = ? ORDER BY createdAt DESC',
    [userId, companyId]
  ).map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
}
