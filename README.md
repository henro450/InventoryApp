# Inventory App (React Native / Expo)

Mobile client for the multi-company inventory system. Single app binary serves both
Main Company and Sub Company roles — the UI adapts based on who's logged in.

## Setup

```bash
npm install
```

Then edit `src/api/client.js` and set `API_BASE_URL` to your machine's **LAN IP**, not
`localhost` — a physical phone or emulator can't resolve your computer's `localhost`.

```js
export const API_BASE_URL = 'http://192.168.1.50:4000/api'; // example
```

Make sure the API (`InventoryApi/`) is running first, then:

```bash
npm start
```

This opens the Expo dev tools — scan the QR code with the Expo Go app on your phone, or
press `a` for an Android emulator / `i` for an iOS simulator.

## Project structure

```
src/
  api/client.js          Thin fetch wrapper for all API calls
  context/AuthContext.js Login/logout, cached session for offline use (AUTH-02)
  db/localDb.js          On-device SQLite schema + queries (items, transactions, sync_meta)
  sync/syncEngine.js      Push pending items/transactions, pull updates, track last sync
  navigation/RootNavigator.js  Role-based screen routing (single app binary — ROLE-06)
  screens/
    LoginScreen.js
    InventoryScreen.js        List + sync status + low-stock highlighting
    AddItemScreen.js          Fully offline-capable item creation
    StockTransactionScreen.js Stock in/out/adjustment, with default-sale-price UI
    DashboardScreen.js        Main Company oversight — Sub Company list + drill-down
    ReportsScreen.js          Stock on hand, sales vs. purchases, margin by item
    AuditLogScreen.js         Read-only audit trail viewer
```

## Key behaviors implemented

- **Offline-first inventory & transactions** (INV-06, SYNC-01): adding items and recording
  stock in/out/adjustment all write to local SQLite immediately and work with zero
  connectivity. A background timer (`startConnectivityWatcher`) attempts sync every 15s;
  pulling to refresh on the Inventory screen also triggers an immediate sync attempt.
- **Default sale price in the UI** (PRC-08): leaving the sale price blank on a "Stock Out"
  shows a note confirming which price will be used, matching the server's default logic.
- **Sync status indicator** (SYNC-06): the Inventory screen always shows "All synced" or
  "N record(s) pending sync".
- **Main Company oversight** (RPT-06/RPT-07): the Dashboard lists linked Sub Companies (or
  shows a clean empty state if there are none — ROLE-07) and lets you drill into any one of
  them, read-only (the item list disables tapping into a transaction screen when viewing
  another company's data).

## Known gaps / next steps

- **Not yet tested against a real device or emulator** — this was built and syntax-checked
  in a sandboxed environment without Android/iOS toolchains. Your first `npm start` +
  device test is the real integration test.
- **Native module versions** (`expo-sqlite`, `expo-network`, `expo-secure-store`) are pinned
  to versions compatible with Expo SDK 51 as of this writing — if `npm install` complains
  about peer dependency mismatches, run `npx expo install --check` to have Expo align
  versions automatically.
- **Comparison view across Sub Companies** (RPT-07) is not yet built — the Dashboard lists
  and drills into Sub Companies individually, but there's no side-by-side metric view yet.
- **Report export to PDF/Excel/CSV** (RPT-05) is not implemented on either the client or
  server side yet.
- **Conflict handling**: the sync engine currently doesn't detect or flag conflicting edits
  made across two devices before syncing — matches the PRD's default (last-write-wins) but
  no explicit conflict UI exists yet.
