import * as SQLite from 'expo-sqlite';

// On-device database — mirrors the subset of the cloud schema needed for offline work
// (SYNC-01/SYNC-02). A Sub Company device stores its own items/transactions; a Main
// Company device additionally caches a read-only snapshot of its Sub Companies' data
// after each pull (see src/sync/syncEngine.js).
const db = SQLite.openDatabaseSync('inventory.db');

export function initLocalDb() {
  db.execSync(`
    PRAGMA journal_mode = WAL;

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
      updatedAt TEXT,
      syncStatus TEXT DEFAULT 'synced', -- 'pending' | 'synced' | 'failed'
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
  `);

  // Guarded migration for dev databases created before the userId column existed —
  // fails harmlessly on fresh installs where CREATE TABLE already included it.
  tryAddColumn('items', 'userId INTEGER');
  tryAddColumn('stock_transactions', 'userId INTEGER');
  tryAddColumn('items', 'isActive INTEGER DEFAULT 1');
}

function tryAddColumn(table, columnDef) {
  try {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    // column already exists
  }
}

export function getDb() {
  return db;
}

// --- sync_meta helpers: tracks the last successful pull timestamp (SYNC-04, SYNC-07) ---
export function getLastSyncedAt() {
  const row = db.getFirstSync('SELECT value FROM sync_meta WHERE key = ?', ['lastSyncedAt']);
  return row ? row.value : null;
}

export function setLastSyncedAt(isoTimestamp) {
  db.runSync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['lastSyncedAt', isoTimestamp]
  );
}

// --- Items ---
export function upsertLocalItem(item) {
  db.runSync(
    `INSERT INTO items (id, localId, clientItemId, sku, name, category, unit, companyId, quantityOnHand, lowStockThreshold, lastPurchasePrice, updatedAt, syncStatus, userId, isActive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(localId) DO UPDATE SET
       id=excluded.id, clientItemId=excluded.clientItemId, sku=excluded.sku, name=excluded.name,
       category=excluded.category, unit=excluded.unit, companyId=excluded.companyId,
       quantityOnHand=excluded.quantityOnHand, lowStockThreshold=excluded.lowStockThreshold,
       lastPurchasePrice=excluded.lastPurchasePrice, updatedAt=excluded.updatedAt,
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
      item.updatedAt ?? new Date().toISOString(),
      item.syncStatus ?? 'synced',
      item.userId ?? null,
      item.isActive === undefined || item.isActive === null ? 1 : (item.isActive ? 1 : 0),
    ]
  );
}

export function getLocalItems(companyId) {
  return db.getAllSync(
    'SELECT * FROM items WHERE companyId = ? AND (isActive IS NULL OR isActive = 1) ORDER BY name ASC',
    [companyId]
  );
}

export function getPendingItems(userId) {
  return db.getAllSync("SELECT * FROM items WHERE syncStatus = 'pending' AND userId = ?", [userId]);
}

export function markItemSynced(localId, serverId) {
  db.runSync("UPDATE items SET id = ?, syncStatus = 'synced' WHERE localId = ?", [serverId, localId]);
}

export function markItemFailed(localId) {
  db.runSync("UPDATE items SET syncStatus = 'failed' WHERE localId = ?", [localId]);
}

// Resolves the current server id for an item given its localId — stock transactions
// created immediately after an offline item-creation need this (see StockTransactionScreen).
export function getServerIdForLocalItem(localId) {
  const row = db.getFirstSync('SELECT id FROM items WHERE localId = ?', [localId]);
  return row ? row.id : null;
}

// INV-01: hard-deletes an item that never reached the server (id still null) — nothing to
// reconcile server-side, so there's no reason to keep it around as a soft-deleted row. Also
// removes any transactions queued against it, which can only still be 'pending' themselves
// (a transaction can't have synced for an item the server has never heard of).
export function deleteLocalItem(localId) {
  db.runSync('DELETE FROM stock_transactions WHERE itemLocalId = ?', [localId]);
  db.runSync('DELETE FROM items WHERE localId = ?', [localId]);
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

export function getPendingTransactions(userId) {
  return db.getAllSync("SELECT * FROM stock_transactions WHERE syncStatus = 'pending' AND userId = ?", [userId]);
}

export function markTransactionSynced(clientTransactionId, serverId) {
  db.runSync(
    "UPDATE stock_transactions SET syncStatus = 'synced', itemServerId = ? WHERE clientTransactionId = ?",
    [serverId, clientTransactionId]
  );
}

export function markTransactionFailed(clientTransactionId) {
  db.runSync(
    "UPDATE stock_transactions SET syncStatus = 'failed' WHERE clientTransactionId = ?",
    [clientTransactionId]
  );
}

export function getPendingCount(userId) {
  const txQuery = userId
    ? { sql: "SELECT COUNT(*) as count FROM stock_transactions WHERE syncStatus = 'pending' AND userId = ?", params: [userId] }
    : { sql: "SELECT COUNT(*) as count FROM stock_transactions WHERE syncStatus = 'pending'", params: [] };
  const itemQuery = userId
    ? { sql: "SELECT COUNT(*) as count FROM items WHERE syncStatus = 'pending' AND userId = ?", params: [userId] }
    : { sql: "SELECT COUNT(*) as count FROM items WHERE syncStatus = 'pending'", params: [] };

  const txRow = db.getFirstSync(txQuery.sql, txQuery.params);
  const itemRow = db.getFirstSync(itemQuery.sql, itemQuery.params);
  return (txRow ? txRow.count : 0) + (itemRow ? itemRow.count : 0);
}

// AUTH-04: wipes all local offline data on a confirmed logout. Only called when the user
// has explicitly confirmed (or had nothing pending to lose) — a forced/session-expiry
// logout never calls this, so an unclean exit's pending backlog survives to resume syncing
// on that same user's next login.
export function clearLocalData() {
  db.execSync('DELETE FROM items; DELETE FROM stock_transactions; DELETE FROM sync_meta;');
}
