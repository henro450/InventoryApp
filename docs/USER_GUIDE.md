# Inventory App — User Guide

## Getting started

**If your company is new**, the platform administrator (SuperAdmin) registers it with your
email address. You'll get an email saying you've been registered, with a **Set your password**
button. Open it on the phone where the app is installed: it opens the app on a Set password
screen. Choose a password (at least 8 characters), then log in with your email and that
password. The link expires after 72 hours; if it has, use **Forgot password?** on the login
screen to get a new one. You don't need to link any other company to fully use the app; a
standalone company works exactly the same as one with linked Sub Companies.

**If you forget your password**, tap **Forgot password?** on the login screen and enter your
email. You'll get a link (valid for 1 hour) that opens the same Set password screen.

**If you already have an account**, log in with your email and password. You'll stay logged in
even without an internet connection — the app caches your session so you can keep working
offline; it'll pick back up with the server automatically once you're back online.

## The two kinds of accounts

- **Main Company** — your own inventory, plus (optionally) oversight of any linked Sub
  Companies: a combined dashboard, a side-by-side comparison across all of them, and read-only
  drill-down into each one's inventory, reports, and audit log.
- **Sub Company** — your own inventory only. Everything you do is visible to your Main
  Company for oversight, but they can't edit your data — only view it.

Which one you are is decided when your account is created, not something you choose in the
app.

## Managing your inventory

- **Add an item**: tap "+ Add Item" from the Inventory screen. Fill in SKU, name, category
  (optional), unit, and a low-stock threshold. You can also tap **Scan** next to the SKU field
  to fill it from a barcode/QR code instead of typing it.
- **Edit or deactivate an item**: each item in the list has Edit and Deactivate links.
  Deactivating hides it from your inventory (it's not permanently deleted — the data is kept
  for your records) but there's currently no way to reactivate one from the app, so double
  check before confirming.
- **Find an item quickly**: tap "Scan Item" and scan its barcode to jump straight to recording
  a transaction for it, instead of searching the list.
- **Record stock in/out**: tap an item to record a purchase ("Stock In"), a sale ("Stock Out"),
  or a manual count correction ("Adjustment"). For a sale, if you leave the price blank it'll
  use the item's last purchase price automatically and label it as such — you can always
  type a different price instead.
- **Low stock**: any item at or below its threshold is marked in red in the list. Toggle
  "Low stock only" to see just those. The Alerts screen also lists them, and — for a Main
  Company — the Dashboard shows a badge with the total count across your own inventory.

## Everything works offline

Add items, record transactions, edit things — all of it works with no connection at all. The
sync bar at the top of Inventory tells you how many changes are still waiting to reach the
server ("All synced" or "N record(s) pending sync"). Nothing is ever lost by going offline;
queued changes sync automatically the moment you're back online (and periodically retry on
their own if a sync attempt fails).

## Importing/exporting your item catalog

From Inventory, "Export Catalog" saves your current item list as a CSV file you can save or
share. "Import Catalog" lets you pick a CSV file (in the same column format) to bulk-create
items — useful for loading an existing spreadsheet of items instead of typing them one by one.
Rows missing a SKU or name are skipped and you'll be told how many were imported vs. skipped.

## Reports

Reports covers stock on hand, sales vs. purchases, margin (by item, by category, and — for a
Main Company — by Sub Company), a price trend for any one item you select, a discrepancy
report (comparing what the system expected vs. what you actually counted, for every manual
adjustment you've made), and a history of automatically-generated daily summaries. Every
section can be filtered by category, item, and/or date range, and exported to CSV
individually.

## Alerts

Two kinds, both computed only while the app is open (there's no push notification for these —
open the Alerts screen or Dashboard to see current alerts):
- **Low stock** — reuses the threshold you set per item.
- **Price anomalies** — flags a purchase whose price is unusually different from that item's
  previous purchase price. How different counts as "unusual" is configurable on the Alerts
  screen (a percentage — the default is 20%).

## Audit log

A read-only record of every create/update/deactivate action taken in your company, with who
did it, when, and what changed. Nothing here can ever be edited or deleted, by anyone,
including a Main Company account — it's an audit trail, not an editable log. Filter it by
date, user, or action type. A Main Company can also view (never edit) each linked Sub
Company's audit log.

## Main Company oversight

- **Dashboard**: your own quick links, an aggregate summary across yourself + every linked Sub
  Company, and a list of your Sub Companies with drill-down links into each one's inventory,
  reports, audit log, and alerts (always read-only when viewing someone else's data).
- **Manage Sub Companies**: add a new one by entering its name and its admin's email (they get
  an email with a link to set their own password; until they do, it shows **Invite pending**
  with a **Resend invite** button), rename, deactivate, or reactivate an existing one. This is
  only available if the SuperAdmin set your company up to have Sub Companies.
- **Compare Companies**: a side-by-side table of item count, low-stock count, sales, purchase
  cost, and margin across every company you can see, including your own.

## Logging out

If you have unsynced changes when you log out, you'll be warned first — confirming will clear
them from this device (they won't sync later), so make sure you have connectivity to sync
first if you want to keep them. If you have nothing pending, logging out is immediate.
