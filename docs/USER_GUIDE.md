# Inventory App — User Guide

## Getting started

**If your company is new**, the platform administrator (SuperAdmin) registers it with your
email address. You'll get an email saying you've been registered, with a **Set your password**
button. Open it on the phone where the app is installed: it opens the app on a Set password
screen. Choose a password (at least 8 characters), then log in with your email and that
password. The link expires after 72 hours; if it has, use **Forgot password?** on the login
screen to get a new one. You don't need to link any other company to fully use the app; a
standalone company works exactly the same as one with linked Sub Companies.

**Fingerprint login:** after you log in with your email and password, if your phone has a
fingerprint set up, the app asks whether you'd like to log in with your fingerprint next time.
Tap **Use fingerprint** and scan your finger. From then on the login screen opens the fingerprint
prompt automatically (there's also a **Log in with fingerprint** button). Your password isn't
saved on the phone. To turn it off, tap your initials (the account button) and choose **Turn off
fingerprint login**. It's switched off automatically if your password is reset, and only one
account per phone can use it (setting it up for another account replaces the previous one).
Fingerprint login needs an internet connection, like a normal login.

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

The app works from the data saved on your phone, so almost everything works with no
connection at all:
- adding and editing items, and recording stock in, stock out and adjustments
- Inventory, the Dashboard, Reports, Alerts and Compare Companies. These are calculated on
  the phone from everything synced so far **plus** the changes you've made on this phone that
  haven't synced yet, so your numbers are always up to date with your own work.

When you have unsynced changes, those screens say so ("Includes N changes from this phone that
haven't synced yet") with a **Sync now** button. Offline, they say "Offline · showing data saved
on this phone". Items with an unsynced change show **Waiting to sync** in Inventory. Nothing is
ever lost by going offline; queued changes sync automatically the moment you're back online
(and retry on their own if a sync attempt fails). Changes made on other phones appear after
your next sync.

**Needs a connection:** logging in for the first time, adding/renaming/deactivating Sub
Companies and sending invites, saving the price-anomaly threshold, generating a report
snapshot, and the SuperAdmin screens. The Audit log and scheduled report snapshots come from
the server; offline you see the last copy loaded on the phone (the audit log also lists your
unsynced changes at the top as **Waiting to sync**).

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
individually. Reports are calculated on the phone, so they work offline and include changes
that haven't synced yet.

**Part payments and people owing:** on a stock out (sale), **Amount paid** is optional. Leave it
blank if the customer paid in full. Enter less for a part payment, or 0 if they're taking the goods
on credit. Tap the contact button beside the field to say who is paying: **Choose from contacts**
picks someone from your phone's contacts (you'll be asked to allow access the first time), or type
their name and phone number if they aren't in your contacts. The app shows how much will be owed
before you save, and won't save a part payment without a customer.

**Debtors** lists everyone who owes money, biggest balance first, with the total owed to you
(open it from **Money owed by customers** in Reports, or the "owed to you" line on the Dashboard).
Tap a person to see their part-paid sales and repayments, **Call** them, or **Record payment** when
they pay some or all of what they owe (enter the amount and whether it was cash or transfer). The
same person is recognised whether their number was typed as 0803…, +234 803… or picked from
contacts. Debtors can be exported to CSV. Like everything else, this works offline.

**Cash or transfer:** when you record a stock out (sale), choose how the customer paid, Cash
or Transfer (Cash is selected by default). For a part payment, this is how the part they paid
was made. Reports has a **Sales by payment method** section
showing the revenue, number of sales and share for Cash, Transfer and **Not yet paid (credit)**,
plus debt repayments received, for whatever date range you've filtered, and it can be exported to
CSV. **Money owed by customers** shows the total outstanding, how many customers owe, and the
biggest balances. Each recent sale in the per-transaction list shows its
payment method, the daily summaries show the cash/transfer split, and Compare Companies has
Cash and Transfer columns. Sales recorded before this option existed are counted as cash.

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
