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
      type TEXT NOT NULL,          -- 'in' | 'out' | 'adjustment' | 'return'
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

    -- Money paid to suppliers against part-paid or credit purchases (see saveLocalSupplierPayment).
    -- Synced history plus this device's unsynced payments, like debt_payments.
    CREATE TABLE IF NOT EXISTS supplier_payments (
      clientPaymentId TEXT PRIMARY KEY,
      id INTEGER,
      companyId INTEGER NOT NULL,
      supplierName TEXT NOT NULL,
      supplierPhone TEXT NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      syncStatus TEXT DEFAULT 'pending',
      userId INTEGER,
      createdByUserId INTEGER
    );

    -- Money out other than stock purchases (expenses, savings, withdrawals, loans, refunds, taxes)
    -- and the savings goals that savings point at. Synced history plus this device's unsynced
    -- entries, like debt_payments. See saveLocalOutflow / saveLocalSavingsGoal.
    CREATE TABLE IF NOT EXISTS money_outflows (
      clientOutflowId TEXT PRIMARY KEY,
      id INTEGER,
      companyId INTEGER NOT NULL,
      kind TEXT NOT NULL,
      category TEXT,
      clientGoalId TEXT,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      note TEXT,
      repeatsMonthly INTEGER DEFAULT 0,
      occurredAt TEXT NOT NULL,
      syncStatus TEXT DEFAULT 'pending',
      userId INTEGER,
      createdByUserId INTEGER
    );

    CREATE INDEX IF NOT EXISTS money_outflows_company_idx ON money_outflows (companyId, occurredAt);
    CREATE INDEX IF NOT EXISTS stock_transactions_company_time_idx ON stock_transactions (companyId, occurredAt);

    CREATE TABLE IF NOT EXISTS savings_goals (
      clientGoalId TEXT PRIMARY KEY,
      id INTEGER,
      companyId INTEGER NOT NULL,
      name TEXT NOT NULL,
      targetAmount REAL,
      targetDate TEXT,
      isActive INTEGER DEFAULT 1,
      createdAt TEXT,
      syncStatus TEXT DEFAULT 'pending',
      userId INTEGER
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
  tryAddColumn('items', 'allowDecimal INTEGER DEFAULT 0'); // 1 = stock can be recorded as e.g. 2.5
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
  // Multi-item sales: the rows of one sale share a saleId (null for single-item sales).
  tryAddColumn('stock_transactions', 'saleId TEXT');
  // What an item normally sells for; a sale with no price typed uses it (before the last purchase price).
  tryAddColumn('items', 'sellingPrice REAL');
  // Mixed payments: JSON like {"cash":2000,"transfer":3000} when paymentMethod is 'mixed'.
  tryAddColumn('stock_transactions', 'paymentBreakdown TEXT');
  // Returns ('return' rows): the sale row's clientTransactionId and 'void' | 'return'.
  tryAddColumn('stock_transactions', 'returnOf TEXT');
  tryAddColumn('stock_transactions', 'returnReason TEXT');
  // Purchases: who it was bought from (amountPaid below the total = owed to them) and when the batch expires.
  tryAddColumn('stock_transactions', 'supplierName TEXT');
  tryAddColumn('stock_transactions', 'supplierPhone TEXT');
  tryAddColumn('stock_transactions', 'expiryDate TEXT'); // 'YYYY-MM-DD'
  // Stock moved between branches ('transfer_out' / 'transfer_in'): both rows share transferId.
  tryAddColumn('stock_transactions', 'transferId TEXT');
  tryAddColumn('stock_transactions', 'transferCompanyId INTEGER');
  // Packs: e.g. packSize 24, packName 'carton'. Stock stays in the item's own unit.
  tryAddColumn('items', 'packSize INTEGER');
  tryAddColumn('items', 'packName TEXT');
  // Receipt photos: the server's marker, the photo on this phone, and whether it still needs uploading.
  tryAddColumn('money_outflows', 'receiptMimeType TEXT');
  tryAddColumn('money_outflows', 'receiptUri TEXT');
  tryAddColumn('money_outflows', 'receiptPending INTEGER DEFAULT 0');
  // Item photos: the server's marker (type and when it changed), a photo picked on this phone,
  // and what still has to reach the server (1 = upload photoUri, 2 = remove the photo).
  tryAddColumn('items', 'photoMimeType TEXT');
  tryAddColumn('items', 'photoUpdatedAt TEXT');
  tryAddColumn('items', 'photoUri TEXT');
  tryAddColumn('items', 'photoPending INTEGER DEFAULT 0');
  // Company details shown on receipts and the account screen.
  tryAddColumn('companies', 'phone TEXT');
  tryAddColumn('companies', 'address TEXT');
  tryAddColumn('companies', 'logoMimeType TEXT');
  tryAddColumn('companies', 'logoUpdatedAt TEXT');
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
const LOCAL_SCHEMA_VERSION = 6; // 6: keeps item photo and company detail fields
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
    `INSERT INTO items (id, localId, clientItemId, sku, name, category, unit, companyId, quantityOnHand, lowStockThreshold, lastPurchasePrice, version, updatedAt, syncStatus, userId, isActive, allowDecimal, sellingPrice, packSize, packName)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(localId) DO UPDATE SET
       id=excluded.id, clientItemId=excluded.clientItemId, sku=excluded.sku, name=excluded.name,
       category=excluded.category, unit=excluded.unit, companyId=excluded.companyId,
       quantityOnHand=excluded.quantityOnHand, lowStockThreshold=excluded.lowStockThreshold,
       lastPurchasePrice=excluded.lastPurchasePrice, version=excluded.version, updatedAt=excluded.updatedAt,
       syncStatus=excluded.syncStatus, userId=excluded.userId, isActive=excluded.isActive,
       allowDecimal=excluded.allowDecimal, sellingPrice=excluded.sellingPrice, packSize=excluded.packSize, packName=excluded.packName`,
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
      item.allowDecimal ? 1 : 0,
      item.sellingPrice === null || item.sellingPrice === undefined || item.sellingPrice === '' ? null : Number(item.sellingPrice),
      Number(item.packSize) > 1 ? Number(item.packSize) : null,
      Number(item.packSize) > 1 ? item.packName || 'pack' : null,
    ]
  );
}

// The server's photo marker for an item, from the change feed or an upload response. A photo
// still waiting to upload from this phone is left alone.
export function setLocalItemPhotoMeta(localId, { photoMimeType, photoUpdatedAt, version }) {
  db.runSync(
    `UPDATE items SET photoMimeType = ?, photoUpdatedAt = ?, version = COALESCE(?, version),
       photoUri = CASE WHEN photoUpdatedAt IS ? THEN photoUri ELSE NULL END
     WHERE localId = ? AND photoPending = 0`,
    [photoMimeType ?? null, photoUpdatedAt ?? null, version ?? null, photoUpdatedAt ?? null, localId]
  );
}

// A photo picked on this phone (already copied into the app's files), or null to remove it.
// Shown straight away and sent to the server on the next sync once the item itself has synced.
export function setLocalItemPhoto(localId, photoUri) {
  db.runSync('UPDATE items SET photoUri = ?, photoPending = ? WHERE localId = ?', [photoUri, photoUri ? 1 : 2, localId]);
}

// Items whose photo change still has to reach the server (only items the server already has).
// Only this phone's admin sets a photo, so every pending one belongs to the signed-in company.
export function getPendingItemPhotos() {
  return db.getAllSync('SELECT localId, id, photoUri, photoPending FROM items WHERE photoPending > 0 AND id IS NOT NULL');
}

export function markItemPhotoSynced(localId, serverItem) {
  db.runSync(
    `UPDATE items SET photoPending = 0, photoMimeType = ?, photoUpdatedAt = ?, version = COALESCE(?, version),
       photoUri = CASE WHEN ? IS NULL THEN NULL ELSE photoUri END
     WHERE localId = ?`,
    [serverItem?.photoMimeType ?? null, serverItem?.photoUpdatedAt ?? null, serverItem?.version ?? null, serverItem?.photoMimeType ?? null, localId]
  );
}

// A photo the server will never take (too big, not an image): give up on it.
export function dropPendingItemPhoto(localId) {
  db.runSync('UPDATE items SET photoPending = 0, photoUri = NULL WHERE localId = ?', [localId]);
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
        allowDecimal: !!item.allowDecimal,
        sellingPrice: item.sellingPrice ?? null,
        packSize: Number(item.packSize) > 1 ? Number(item.packSize) : null,
        packName: Number(item.packSize) > 1 ? item.packName || 'pack' : null,
      }
    : {
        id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        lowStockThreshold: item.lowStockThreshold,
        allowDecimal: !!item.allowDecimal,
        sellingPrice: item.sellingPrice ?? null,
        packSize: Number(item.packSize) > 1 ? Number(item.packSize) : null,
        packName: Number(item.packSize) > 1 ? item.packName || 'pack' : null,
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
       (clientTransactionId, itemLocalId, itemServerId, itemClientItemId, companyId, type, quantity, unitPrice, priceWasDefaulted, occurredAt, syncStatus, userId, previousQuantity, createdByUserId, paymentMethod, amountPaid, customerName, customerPhone, saleId, paymentBreakdown, returnOf, returnReason,
        supplierName, supplierPhone, expiryDate, transferId, transferCompanyId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      isSaleOrReturn(tx) ? tx.paymentMethod || 'cash' : null,
      (isSaleOrReturn(tx) || tx.type === 'in') && tx.amountPaid !== undefined ? tx.amountPaid : null,
      isSaleOrReturn(tx) ? tx.customerName || null : null,
      isSaleOrReturn(tx) && tx.customerPhone ? normalizePhone(tx.customerPhone) : null,
      isSaleOrReturn(tx) ? tx.saleId || null : null,
      isSaleOrReturn(tx) && tx.paymentMethod === 'mixed' && tx.paymentBreakdown ? JSON.stringify(tx.paymentBreakdown) : null,
      tx.type === 'return' ? tx.returnOf : null,
      tx.type === 'return' ? tx.returnReason || 'return' : null,
      tx.type === 'in' ? tx.supplierName?.trim() || null : null,
      tx.type === 'in' && tx.supplierPhone ? normalizePhone(tx.supplierPhone) : null,
      tx.type === 'in' ? tx.expiryDate || null : null,
      isTransfer(tx) ? tx.transferId : null,
      isTransfer(tx) ? tx.transferCompanyId : null,
    ]
  );
}

function isTransfer(tx) {
  return tx.type === 'transfer_in' || tx.type === 'transfer_out';
}

// How a movement changes the item's stock: purchases, returns and transfers in add to it, sales
// and transfers out take from it, and an adjustment (a count) sets it.
export function stockAfter(current, tx) {
  if (tx.type === 'in' || tx.type === 'return' || tx.type === 'transfer_in') return current + Number(tx.quantity);
  if (tx.type === 'out' || tx.type === 'transfer_out') return current - Number(tx.quantity);
  return Number(tx.quantity);
}

// Sales and returns carry payment and customer fields; purchases and adjustments don't.
function isSaleOrReturn(tx) {
  return tx.type === 'out' || tx.type === 'return';
}

// Stock movement, optimistic item balance, and its outbox entry commit together. A crash can
// therefore never leave visible stock without an operation that will eventually reach the API.
// The balance is computed from the item's *current* row inside the same transaction — never
// from a copy the screen loaded earlier — and only the stock fields are written, so a
// background sync or another edit made while the screen was open is never overwritten.
// Throws an error with code 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' (and `available`) for a
// stock-out the current balance can't cover.
export function saveLocalStockTransaction(tx) {
  return runLocalTransaction(() => writeLocalStockTransaction(tx));
}

// A sale of several items: one stock-out per line (all sharing saleId, customer and payment),
// written in a single local transaction, so either the whole sale is saved or none of it. The
// stock check runs for every line against the current rows; a failure names the line's item
// via err.itemLocalId.
export function saveLocalSale(transactions) {
  return saveLocalTransactions(transactions);
}

// Returns of one or more sale rows (a void, or items brought back): stock goes back on each
// item, all lines together or none.
export function saveLocalReturn(transactions) {
  return saveLocalTransactions(transactions);
}

function saveLocalTransactions(transactions) {
  return runLocalTransaction(() =>
    transactions.map((tx) => {
      try {
        return writeLocalStockTransaction(tx);
      } catch (err) {
        err.itemLocalId = tx.itemLocalId;
        throw err;
      }
    })
  );
}

function writeLocalStockTransaction(tx) {
  const item = db.getFirstSync('SELECT * FROM items WHERE localId = ?', [tx.itemLocalId]);
  if (!item) throw new Error('This item is no longer on this device. Go back and try again.');

  const current = Number(item.quantityOnHand) || 0;
  if (tx.type === 'out') {
    if (current <= 0) throw Object.assign(new Error('Out of stock'), { code: 'OUT_OF_STOCK', available: current });
    if (tx.quantity > current) throw Object.assign(new Error('Not enough stock'), { code: 'INSUFFICIENT_STOCK', available: current });
  }
  const nextQuantity = stockAfter(current, tx);

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
      paymentMethod: isSaleOrReturn(tx) ? tx.paymentMethod || 'cash' : undefined,
      paymentBreakdown: isSaleOrReturn(tx) && tx.paymentMethod === 'mixed' ? tx.paymentBreakdown : undefined,
      amountPaid: (isSaleOrReturn(tx) || tx.type === 'in') && tx.amountPaid !== null && tx.amountPaid !== undefined ? tx.amountPaid : undefined,
      customerName: tx.type === 'out' ? tx.customerName || undefined : undefined,
      customerPhone: tx.type === 'out' && tx.customerPhone ? normalizePhone(tx.customerPhone) : undefined,
      saleId: tx.type === 'out' && tx.saleId ? tx.saleId : undefined,
      returnOf: tx.type === 'return' ? tx.returnOf : undefined,
      returnReason: tx.type === 'return' ? tx.returnReason || 'return' : undefined,
      supplierName: tx.type === 'in' ? tx.supplierName?.trim() || undefined : undefined,
      supplierPhone: tx.type === 'in' && tx.supplierPhone ? normalizePhone(tx.supplierPhone) : undefined,
      expiryDate: tx.type === 'in' ? tx.expiryDate || undefined : undefined,
      occurredAt: tx.occurredAt,
    },
  });
  return { previousQuantity: current, quantityOnHand: nextQuantity };
}

// Several adjustments from one stock count, saved together: each item's stock is set to what was
// counted, and each count syncs like a single adjustment.
export function saveLocalCount(transactions) {
  return saveLocalTransactions(transactions.map((tx) => ({ ...tx, type: 'adjustment' })));
}

// Moves stock between two branches (main company admins). Both rows and both items' stock change
// together, with one outbox operation the server applies all-or-nothing. When the receiving
// branch doesn't stock the item yet, `newTarget` is a copy of it to create there: the phone and
// the server create it under the same clientItemId, so the copy the server sends back replaces
// this one in place.
export function saveLocalTransfer({ transferId, from, to, quantity, occurredAt, userId, companyId, newTarget }) {
  return runLocalTransaction(() => {
    if (newTarget) upsertLocalItem({ ...newTarget, quantityOnHand: 0, syncStatus: 'pending', userId });
    const source = db.getFirstSync('SELECT * FROM items WHERE localId = ?', [from.itemLocalId]);
    const target = db.getFirstSync('SELECT * FROM items WHERE localId = ?', [to.itemLocalId]);
    if (!source || !target) throw new Error('This item is no longer on this device. Go back and try again.');
    const sourceBefore = Number(source.quantityOnHand) || 0;
    if (quantity > sourceBefore) throw Object.assign(new Error('Not enough stock'), { code: 'INSUFFICIENT_STOCK', available: sourceBefore });
    const targetBefore = Number(target.quantityOnHand) || 0;
    const cost = source.lastPurchasePrice ?? null;
    const now = new Date().toISOString();
    const rows = [
      { row: from, item: source, before: sourceBefore, type: 'transfer_out', other: to.companyId },
      { row: to, item: target, before: targetBefore, type: 'transfer_in', other: from.companyId },
    ];
    for (const { row, item, before, type, other } of rows) {
      insertLocalTransaction({
        clientTransactionId: row.clientTransactionId,
        itemLocalId: item.localId,
        itemServerId: item.id ?? null,
        itemClientItemId: item.clientItemId ?? null,
        companyId: row.companyId,
        type,
        quantity,
        unitPrice: cost,
        occurredAt,
        userId,
        previousQuantity: before,
        transferId,
        transferCompanyId: other,
      });
      const after = stockAfter(before, { type, quantity });
      db.runSync(
        `UPDATE items SET quantityOnHand = ?, updatedAt = ?,
           lastPurchasePrice = CASE WHEN ? = 'transfer_in' AND ? IS NOT NULL THEN ? ELSE lastPurchasePrice END
         WHERE localId = ?`,
        [after, now, type, cost, cost, item.localId]
      );
    }
    insertOutboxOperation({
      operationId: transferId,
      userId,
      companyId,
      entityType: 'stock_transfer',
      entityLocalId: transferId,
      operationType: 'stock_transfer.create',
      payload: {
        transferId,
        fromCompanyId: from.companyId,
        toCompanyId: to.companyId,
        fromItemId: source.id ?? undefined,
        fromClientItemId: source.id ? undefined : source.clientItemId || source.localId,
        toItemId: target.id ?? undefined,
        toClientItemId: target.id ? undefined : target.clientItemId || target.localId,
        quantity,
        outClientTransactionId: from.clientTransactionId,
        inClientTransactionId: to.clientTransactionId,
        occurredAt,
      },
      createdAt: now,
    });
  });
}

// Both rows of a stock transfer.
export function getLocalTransferRows(transferId) {
  return db.getAllSync('SELECT * FROM stock_transactions WHERE transferId = ?', [transferId]);
}

export function getPendingOperations(userId, limit = 50) {
  const now = new Date().toISOString();
  const rows = db.getAllSync(
    `SELECT * FROM outbox
     WHERE userId = ?
       AND (status = 'pending' OR (status = 'failed' AND (nextRetryAt IS NULL OR nextRetryAt <= ?)))
     ORDER BY
       CASE operationType WHEN 'item.create' THEN 0 WHEN 'savings_goal.create' THEN 0 WHEN 'item.update' THEN 1 WHEN 'item.delete' THEN 1 ELSE 2 END,
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
    } else if (operation.entityType === 'supplier_payment') {
      db.runSync("UPDATE supplier_payments SET syncStatus = 'synced', id = COALESCE(?, id) WHERE clientPaymentId = ?", [
        result.serverId ?? null,
        operation.entityLocalId,
      ]);
    } else if (operation.entityType === 'stock_transfer') {
      db.runSync("UPDATE stock_transactions SET syncStatus = 'synced', retryCount = 0, nextRetryAt = NULL WHERE transferId = ?", [
        operation.entityLocalId,
      ]);
      // A receiving item this transfer created now has its server id.
      if (result.toItemId) {
        db.runSync(
          `UPDATE items SET id = COALESCE(id, ?), syncStatus = CASE WHEN id IS NULL THEN 'synced' ELSE syncStatus END
           WHERE localId = (SELECT itemLocalId FROM stock_transactions WHERE transferId = ? AND type = 'transfer_in')`,
          [result.toItemId, operation.entityLocalId]
        );
      }
    } else if (operation.entityType === 'money_outflow' || operation.entityType === 'savings_goal') {
      const { table, key } = OUTFLOW_TABLES[operation.entityType];
      const remaining = db.getFirstSync('SELECT COUNT(*) AS count FROM outbox WHERE entityLocalId = ?', [operation.entityLocalId]);
      db.runSync(`UPDATE ${table} SET syncStatus = ?, id = COALESCE(?, id) WHERE ${key} = ?`, [
        remaining.count ? 'pending' : 'synced',
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
  } else if (row.entityType === 'supplier_payment') {
    db.runSync("UPDATE supplier_payments SET syncStatus = 'failed' WHERE clientPaymentId = ?", [row.entityLocalId]);
  } else if (row.entityType === 'stock_transfer') {
    db.runSync("UPDATE stock_transactions SET syncStatus = 'failed' WHERE transferId = ?", [row.entityLocalId]);
  } else if (OUTFLOW_TABLES[row.entityType]) {
    const { table, key } = OUTFLOW_TABLES[row.entityType];
    db.runSync(`UPDATE ${table} SET syncStatus = 'failed' WHERE ${key} = ?`, [row.entityLocalId]);
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
        OR (entityType = 'stock_transfer' AND (
             json_extract(payload, '$.fromClientItemId') = ? OR json_extract(payload, '$.toClientItemId') = ?
             OR json_extract(payload, '$.fromItemId') = ? OR json_extract(payload, '$.toItemId') = ?
           ))
     LIMIT 1`,
    [localId, localId, serverId ?? null, localId, localId, serverId ?? null, serverId ?? null]
  );
  return !!row;
}

// localIds of items with any unsynced edit or stock movement, for per-row 'waiting to sync'.
export function getItemIdsWithPendingWork(userId) {
  const rows = db.getAllSync(
    `SELECT localId FROM items
     WHERE localId IN (SELECT entityLocalId FROM outbox WHERE userId = ? AND entityType = 'item')
        OR localId IN (SELECT json_extract(payload, '$.clientItemId') FROM outbox WHERE userId = ? AND entityType = 'stock_transaction')
        OR id IN (SELECT json_extract(payload, '$.itemId') FROM outbox WHERE userId = ? AND entityType = 'stock_transaction')
        OR localId IN (SELECT itemLocalId FROM stock_transactions WHERE transferId IN
             (SELECT entityLocalId FROM outbox WHERE userId = ? AND entityType = 'stock_transfer'))`,
    [userId, userId, userId, userId]
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
    'DELETE FROM deferred_changes; DELETE FROM api_cache; DELETE FROM debt_payments; DELETE FROM supplier_payments; ' +
    'DELETE FROM money_outflows; DELETE FROM savings_goals; ' +
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
        previousQuantity, occurredAt, syncStatus, userId, createdByUserId, paymentMethod, amountPaid, customerName, customerPhone, saleId,
        paymentBreakdown, returnOf, returnReason, supplierName, supplierPhone, expiryDate, transferId, transferCompanyId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(clientTransactionId) DO UPDATE SET
       id = excluded.id, itemServerId = excluded.itemServerId, companyId = excluded.companyId, type = excluded.type,
       quantity = excluded.quantity, unitPrice = excluded.unitPrice, priceWasDefaulted = excluded.priceWasDefaulted,
       previousQuantity = excluded.previousQuantity, occurredAt = excluded.occurredAt, syncStatus = 'synced',
       createdByUserId = excluded.createdByUserId, paymentMethod = excluded.paymentMethod,
       amountPaid = excluded.amountPaid, customerName = excluded.customerName, customerPhone = excluded.customerPhone,
       saleId = excluded.saleId, paymentBreakdown = excluded.paymentBreakdown, returnOf = excluded.returnOf,
       returnReason = excluded.returnReason, supplierName = excluded.supplierName, supplierPhone = excluded.supplierPhone,
       expiryDate = excluded.expiryDate, transferId = excluded.transferId, transferCompanyId = excluded.transferCompanyId`,
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
      tx.saleId ?? null,
      tx.paymentBreakdown ? JSON.stringify(tx.paymentBreakdown) : null,
      tx.returnOf ?? null,
      tx.returnReason ?? null,
      tx.supplierName ?? null,
      tx.supplierPhone ?? null,
      tx.expiryDate ? String(tx.expiryDate).slice(0, 10) : null,
      tx.transferId ?? null,
      tx.transferCompanyId ?? null,
    ]
  );
}

export function deletePulledTransaction(clientTransactionId) {
  db.runSync("DELETE FROM stock_transactions WHERE clientTransactionId = ? AND syncStatus = 'synced'", [clientTransactionId]);
}

export function upsertLocalCompany(company, { deleted = false } = {}) {
  db.runSync(
    `INSERT INTO companies (id, name, type, parentCompanyId, isActive, allowSubCompanies, priceAnomalyThresholdPercent, updatedAt,
         phone, address, logoMimeType, logoUpdatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, type = excluded.type, parentCompanyId = excluded.parentCompanyId,
       isActive = excluded.isActive, allowSubCompanies = excluded.allowSubCompanies,
       priceAnomalyThresholdPercent = excluded.priceAnomalyThresholdPercent, updatedAt = excluded.updatedAt,
       phone = excluded.phone, address = excluded.address, logoMimeType = excluded.logoMimeType, logoUpdatedAt = excluded.logoUpdatedAt`,
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
      company.phone ?? null,
      company.address ?? null,
      company.logoMimeType ?? null,
      company.logoUpdatedAt ?? null,
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
// `since` (ISO time) limits it to rows at or after that moment, so screens showing a recent period
// don't read a year of history.
export function getLocalTransactions(companyIds, { since } = {}) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  if (since) {
    return db.getAllSync(`SELECT * FROM stock_transactions WHERE companyId IN (${marks}) AND occurredAt >= ?`, [...companyIds, since]);
  }
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

// --- Supplier payments ---

// Money paid to a supplier against what the company owes them. Saved on the device first (works
// offline) with its outbox operation, like a customer's repayment.
export function saveLocalSupplierPayment(payment) {
  const record = { ...payment, supplierPhone: normalizePhone(payment.supplierPhone), supplierName: payment.supplierName.trim() };
  return runLocalTransaction(() => {
    db.runSync(
      `INSERT INTO supplier_payments
         (clientPaymentId, companyId, supplierName, supplierPhone, amount, paymentMethod, occurredAt, syncStatus, userId, createdByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [record.clientPaymentId, record.companyId, record.supplierName, record.supplierPhone, record.amount, record.paymentMethod, record.occurredAt, record.userId, record.userId]
    );
    insertOutboxOperation({
      operationId: record.clientPaymentId,
      userId: record.userId,
      companyId: record.companyId,
      entityType: 'supplier_payment',
      entityLocalId: record.clientPaymentId,
      operationType: 'supplier_payment.create',
      payload: {
        clientPaymentId: record.clientPaymentId,
        supplierName: record.supplierName,
        supplierPhone: record.supplierPhone,
        amount: record.amount,
        paymentMethod: record.paymentMethod,
        occurredAt: record.occurredAt,
      },
    });
  });
}

export function upsertPulledSupplierPayment(p, userId) {
  db.runSync(
    `INSERT INTO supplier_payments
       (clientPaymentId, id, companyId, supplierName, supplierPhone, amount, paymentMethod, occurredAt, syncStatus, userId, createdByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?)
     ON CONFLICT(clientPaymentId) DO UPDATE SET
       id = excluded.id, companyId = excluded.companyId, supplierName = excluded.supplierName,
       supplierPhone = excluded.supplierPhone, amount = excluded.amount, paymentMethod = excluded.paymentMethod,
       occurredAt = excluded.occurredAt, syncStatus = 'synced', createdByUserId = excluded.createdByUserId`,
    [p.clientPaymentId, p.id, p.companyId, p.supplierName, p.supplierPhone, Number(p.amount), p.paymentMethod, p.occurredAt, userId, p.userId ?? null]
  );
}

export function getLocalSupplierPayments(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM supplier_payments WHERE companyId IN (${marks})`, companyIds);
}

// --- Money out and savings goals ---

const OUTFLOW_TABLES = {
  money_outflow: { table: 'money_outflows', key: 'clientOutflowId' },
  savings_goal: { table: 'savings_goals', key: 'clientGoalId' },
};

function hasPendingOperation(entityLocalId) {
  return !!db.getFirstSync('SELECT 1 FROM outbox WHERE entityLocalId = ? LIMIT 1', [entityLocalId]);
}

// Money leaving the business, saved on the device first with its outbox operation. A savings
// entry for a brand-new goal passes `newGoal`, so the goal and the deposit are saved together
// (the goal's operation is pushed first, see getPendingOperations).
export function saveLocalOutflow(outflow, { newGoal } = {}) {
  const record = {
    ...outflow,
    category: outflow.category?.trim() || null,
    note: outflow.note?.trim() || null,
    clientGoalId: outflow.clientGoalId || null,
    repeatsMonthly: !!outflow.repeatsMonthly,
  };
  return runLocalTransaction(() => {
    if (newGoal) saveGoalRow(newGoal);
    db.runSync(
      `INSERT INTO money_outflows
         (clientOutflowId, companyId, kind, category, clientGoalId, amount, paymentMethod, note, repeatsMonthly,
          occurredAt, syncStatus, userId, createdByUserId, receiptUri, receiptPending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [record.clientOutflowId, record.companyId, record.kind, record.category, record.clientGoalId, record.amount,
        record.paymentMethod, record.note, record.repeatsMonthly ? 1 : 0, record.occurredAt, record.userId, record.userId,
        record.receiptUri || null, record.receiptUri ? 1 : 0]
    );
    insertOutboxOperation({
      operationId: record.clientOutflowId,
      userId: record.userId,
      companyId: record.companyId,
      entityType: 'money_outflow',
      entityLocalId: record.clientOutflowId,
      operationType: 'money_outflow.create',
      payload: {
        clientOutflowId: record.clientOutflowId,
        kind: record.kind,
        category: record.category,
        clientGoalId: record.clientGoalId,
        amount: record.amount,
        paymentMethod: record.paymentMethod,
        note: record.note,
        repeatsMonthly: record.repeatsMonthly,
        occurredAt: record.occurredAt,
      },
    });
  });
}

// A receipt photo added to an entry after it was recorded (copied into the app's own files first).
// It's uploaded on the next sync, once the entry itself is on the server.
export function setLocalOutflowReceipt(clientOutflowId, receiptUri) {
  db.runSync('UPDATE money_outflows SET receiptUri = ?, receiptPending = 1 WHERE clientOutflowId = ?', [receiptUri, clientOutflowId]);
}

// Photos waiting to upload whose entry has synced (the server needs the entry first).
export function getPendingReceipts(userId) {
  return db.getAllSync(
    `SELECT clientOutflowId, receiptUri FROM money_outflows
     WHERE receiptPending = 1 AND receiptUri IS NOT NULL AND userId = ?
       AND clientOutflowId NOT IN (SELECT entityLocalId FROM outbox WHERE entityType = 'money_outflow' AND operationType = 'money_outflow.create')`,
    [userId]
  );
}

export function markReceiptUploaded(clientOutflowId, mimeType) {
  db.runSync('UPDATE money_outflows SET receiptPending = 0, receiptMimeType = COALESCE(?, receiptMimeType) WHERE clientOutflowId = ?', [
    mimeType ?? null,
    clientOutflowId,
  ]);
}

// Admin edits after the fact: stop a monthly repeat, or delete a mistaken entry.
export function updateLocalOutflow(outflow, changes, userId) {
  return runLocalTransaction(() => {
    if (changes.delete) {
      db.runSync('DELETE FROM money_outflows WHERE clientOutflowId = ?', [outflow.clientOutflowId]);
    } else if (changes.repeatsMonthly !== undefined) {
      db.runSync("UPDATE money_outflows SET repeatsMonthly = ?, syncStatus = 'pending' WHERE clientOutflowId = ?", [
        changes.repeatsMonthly ? 1 : 0,
        outflow.clientOutflowId,
      ]);
    }
    insertOutboxOperation({
      operationId: uuidv4(),
      userId,
      companyId: outflow.companyId,
      entityType: 'money_outflow',
      entityLocalId: outflow.clientOutflowId,
      operationType: changes.delete ? 'money_outflow.delete' : 'money_outflow.update',
      payload: changes.delete
        ? { clientOutflowId: outflow.clientOutflowId }
        : { clientOutflowId: outflow.clientOutflowId, repeatsMonthly: !!changes.repeatsMonthly },
    });
  });
}

function saveGoalRow(goal) {
  db.runSync(
    `INSERT INTO savings_goals (clientGoalId, companyId, name, targetAmount, targetDate, isActive, createdAt, syncStatus, userId)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'pending', ?)`,
    [goal.clientGoalId, goal.companyId, goal.name.trim(), goal.targetAmount || null, goal.targetDate || null, new Date().toISOString(), goal.userId]
  );
  insertOutboxOperation({
    operationId: goal.clientGoalId,
    userId: goal.userId,
    companyId: goal.companyId,
    entityType: 'savings_goal',
    entityLocalId: goal.clientGoalId,
    operationType: 'savings_goal.create',
    payload: { clientGoalId: goal.clientGoalId, name: goal.name.trim(), targetAmount: goal.targetAmount || null, targetDate: goal.targetDate || null },
  });
}

export function saveLocalSavingsGoal(goal) {
  return runLocalTransaction(() => saveGoalRow(goal));
}

// Rename, change the target, or close (isActive: false) a goal.
export function updateLocalSavingsGoal(goal, changes, userId) {
  const next = { ...goal, ...changes };
  return runLocalTransaction(() => {
    db.runSync(
      "UPDATE savings_goals SET name = ?, targetAmount = ?, targetDate = ?, isActive = ?, syncStatus = 'pending' WHERE clientGoalId = ?",
      [next.name.trim(), next.targetAmount || null, next.targetDate || null, next.isActive === false || next.isActive === 0 ? 0 : 1, goal.clientGoalId]
    );
    insertOutboxOperation({
      operationId: uuidv4(),
      userId,
      companyId: goal.companyId,
      entityType: 'savings_goal',
      entityLocalId: goal.clientGoalId,
      operationType: 'savings_goal.update',
      payload: { clientGoalId: goal.clientGoalId, ...changes },
    });
  });
}

// Feed changes. A row with unsynced local edits keeps them; the server copy that includes those
// edits arrives after they're pushed.
export function upsertPulledOutflow(o, userId, { deleted = false } = {}) {
  if (hasPendingOperation(o.clientOutflowId)) return;
  if (deleted || o.isDeleted) {
    db.runSync('DELETE FROM money_outflows WHERE clientOutflowId = ?', [o.clientOutflowId]);
    return;
  }
  db.runSync(
    `INSERT INTO money_outflows
       (clientOutflowId, id, companyId, kind, category, clientGoalId, amount, paymentMethod, note, repeatsMonthly,
        occurredAt, syncStatus, userId, createdByUserId, receiptMimeType)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?)
     ON CONFLICT(clientOutflowId) DO UPDATE SET
       id = excluded.id, companyId = excluded.companyId, kind = excluded.kind, category = excluded.category,
       clientGoalId = excluded.clientGoalId, amount = excluded.amount, paymentMethod = excluded.paymentMethod,
       note = excluded.note, repeatsMonthly = excluded.repeatsMonthly, occurredAt = excluded.occurredAt,
       syncStatus = 'synced', createdByUserId = excluded.createdByUserId, receiptMimeType = excluded.receiptMimeType`,
    [o.clientOutflowId, o.id, o.companyId, o.kind, o.category ?? null, o.clientGoalId ?? null, Number(o.amount), o.paymentMethod,
      o.note ?? null, o.repeatsMonthly ? 1 : 0, o.occurredAt, userId, o.userId ?? null, o.receiptMimeType ?? null]
  );
}

export function upsertPulledSavingsGoal(g, userId) {
  if (hasPendingOperation(g.clientGoalId)) return;
  db.runSync(
    `INSERT INTO savings_goals (clientGoalId, id, companyId, name, targetAmount, targetDate, isActive, createdAt, syncStatus, userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)
     ON CONFLICT(clientGoalId) DO UPDATE SET
       id = excluded.id, companyId = excluded.companyId, name = excluded.name, targetAmount = excluded.targetAmount,
       targetDate = excluded.targetDate, isActive = excluded.isActive, createdAt = excluded.createdAt, syncStatus = 'synced'`,
    [g.clientGoalId, g.id, g.companyId, g.name, g.targetAmount === null || g.targetAmount === undefined ? null : Number(g.targetAmount),
      g.targetDate ?? null, g.isActive === false ? 0 : 1, g.createdAt ?? null, userId]
  );
}

export function getLocalOutflows(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM money_outflows WHERE companyId IN (${marks})`, companyIds);
}

export function getLocalSavingsGoals(companyIds) {
  if (!companyIds.length) return [];
  const marks = companyIds.map(() => '?').join(',');
  return db.getAllSync(`SELECT * FROM savings_goals WHERE companyId IN (${marks})`, companyIds);
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
