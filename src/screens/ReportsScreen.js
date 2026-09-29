import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Pressable, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt, getCached, setCached } from '../db/localDb';
import { getCompanyReports, getOversightSummary } from '../reports/localReports';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import LocalDataNotice from '../components/LocalDataNotice';
import { exportCsv } from '../utils/csvExport';
import { runSync } from '../sync/syncEngine';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatYmd, lastSyncedLabel, plural, rangeBounds, dateToYmd } from '../utils/format';
import Icon from '../components/Icon';
import PriceTrendChart from '../components/PriceTrendChart';
import {
  Text, Screen, LargeHeader, NavHeader, IconButton, AccountButton, Card, SectionTitle, Chip, Field, DateField, Button,
  KV, BarRow, Divider, InlineEmpty, Loading, CompanySwitcher, ReadOnlyBanner,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const PREVIEW_ROWS = 5;
const PAYMENT_LABEL = { cash: 'Cash', transfer: 'Transfer', credit: 'Not paid yet (owed)' };

// Written for people who don't read accounts: a plain-language "How your business did" summary
// first, then who owes money and the stock you have; the detailed reports sit under "More
// details". Headings, captions and CSV columns use everyday words (profit, not margin).
// RPT-01, RPT-02, RPT-03, RPT-04, PRC-04: stock on hand (item/category filter), sales vs
// purchases (date range filter), margin by item/category/Sub Company, per-transaction margin
// (historical cost basis), discrepancy report (expected vs counted stock), and price trend for
// a selected item. RPT-05 export is CSV only — no PDF/Excel, which would need new heavyweight
// dependencies this project has otherwise avoided throughout.
// Every report is computed on the device from the local database (src/reports/localReports.js),
// so it works offline and includes this phone's unsynced changes. Only the scheduled snapshots
// come from the server; the last copy is kept for offline viewing.
export default function ReportsScreen({ route, navigation }) {
  const { user, isMainCompany, logout } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const isOwnCompany = companyId === user.companyId;
  const lastSynced = getLastSyncedAt(user.id);
  const snapshotCacheKey = `snapshots:${companyId}`;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshotsSavedAt, setSnapshotsSavedAt] = useState(null); // set when showing a saved (offline) copy
  const [stockOnHand, setStockOnHand] = useState([]);
  const [salesVsPurchases, setSalesVsPurchases] = useState(null);
  const [summary, setSummary] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [debtors, setDebtors] = useState(null);
  const [marginByItem, setMarginByItem] = useState([]);
  const [transactionMargins, setTransactionMargins] = useState([]);
  const [marginByCompany, setMarginByCompany] = useState(null);
  const [discrepancies, setDiscrepancies] = useState([]);
  const [priceTrend, setPriceTrend] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [generatingSnapshot, setGeneratingSnapshot] = useState(false);

  const [items, setItems] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryInput, setCategoryInput] = useState('');
  const [itemSearchText, setItemSearchText] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [dateError, setDateError] = useState(null);
  const today = dateToYmd(new Date());
  const [appliedFilters, setAppliedFilters] = useState({ category: '', itemId: null, itemName: '', from: '', to: '' });
  const [expanded, setExpanded] = useState({});

  function loadLocal(filters) {
    const range = rangeBounds(filters);
    const reports = getCompanyReports(user, companyId, { ...filters, ...range });
    setStockOnHand(reports.stockOnHand);
    setSalesVsPurchases(reports.salesVsPurchases);
    setSummary(reports.summary);
    setDebtors(reports.debtors);
    setMarginByItem(reports.marginByItem);
    setItems(reports.items);
    setTransactionMargins(reports.transactionMargins);
    setDiscrepancies(reports.discrepancies);
    setPriceTrend(reports.priceTrend);
    setMarginByCompany(isMainCompany && isOwnCompany ? getOversightSummary(user, range).companies : null);
    setLoading(false);
  }

  async function loadSnapshots() {
    try {
      const { snapshots: fresh } = await api.getReportSnapshots(companyId, { limit: 20 });
      setSnapshots(fresh);
      setSnapshotsSavedAt(null);
      setCached(snapshotCacheKey, fresh);
    } catch {
      const saved = getCached(snapshotCacheKey);
      setSnapshots(saved ? saved.data : []);
      setSnapshotsSavedAt(saved ? saved.savedAt : 'never');
    }
  }

  function load(filters = appliedFilters) {
    loadLocal(filters);
    return loadSnapshots();
  }

  // Recompute on focus and after every background sync, with the filters currently applied.
  const filtersRef = useRef(appliedFilters);
  filtersRef.current = appliedFilters;
  useLocalRefresh(() => loadLocal(filtersRef.current));
  useEffect(() => {
    loadSnapshots();
  }, [companyId]);

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    await load();
    setRefreshing(false);
  }

  function applyFilters(next) {
    setAppliedFilters(next);
    setExpanded({});
    load(next);
  }

  function handleApplyFilters() {
    if (fromInput && toInput && fromInput > toInput) {
      setDateError('"From" must be on or before "To".');
      return;
    }
    setDateError(null);
    setFiltersOpen(false);
    applyFilters({
      category: categoryInput.trim(),
      itemId: selectedItem?.localId || null,
      itemName: selectedItem?.name || '',
      from: fromInput,
      to: toInput,
    });
  }

  function clearFilter(key) {
    const next = { ...appliedFilters };
    if (key === 'category') {
      next.category = '';
      setCategoryInput('');
    } else if (key === 'item') {
      next.itemId = null;
      next.itemName = '';
      setSelectedItem(null);
      setItemSearchText('');
    } else {
      next.from = '';
      next.to = '';
      setFromInput('');
      setToInput('');
    }
    applyFilters(next);
  }

  function handleClearSelectedItem() {
    setSelectedItem(null);
    setItemSearchText('');
  }

  async function handleExport(filename, rows, columns) {
    if (rows.length === 0) {
      Alert.alert('Nothing to export', 'There is no data in this report to export yet.');
      return;
    }
    try {
      await exportCsv(filename, rows, columns);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  async function handleGenerateSnapshot() {
    setGeneratingSnapshot(true);
    try {
      await api.generateReportSnapshot(companyId);
      await loadSnapshots();
    } catch (err) {
      Alert.alert('Could not generate report', err.status ? err.message : 'Snapshots are created on the server. Connect to the internet and try again.');
    } finally {
      setGeneratingSnapshot(false);
    }
  }

  const itemMatches =
    itemSearchText && !selectedItem
      ? items.filter((i) => {
          const q = itemSearchText.toLowerCase();
          return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q);
        })
      : [];

  // RPT-03: category breakdown derived client-side from the per-item report — no separate
  // backend endpoint needed, this is just a regroup of data already fetched.
  const marginByCategory = Object.values(
    marginByItem.reduce((acc, row) => {
      const key = row.category || 'Uncategorized';
      if (!acc[key]) acc[key] = { category: key, totalRevenue: 0, estimatedCost: 0, estimatedMargin: 0 };
      acc[key].totalRevenue += row.totalRevenue;
      acc[key].estimatedCost += row.estimatedCost;
      acc[key].estimatedMargin += row.estimatedMargin;
      return acc;
    }, {})
  ).sort((a, b) => b.estimatedMargin - a.estimatedMargin);

  const limited = (key, rows) => (expanded[key] ? rows : rows.slice(0, PREVIEW_ROWS));
  const showAll = (key, rows, noun) =>
    rows.length > PREVIEW_ROWS ? (
      <Pressable accessibilityRole="button" onPress={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))} style={styles.showAll}>
        <Text style={styles.link}>{expanded[key] ? 'Show less' : `Show all ${formatNumber(rows.length)} ${noun}`}</Text>
      </Pressable>
    ) : null;

  const exportButton = (label, onPress) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`Export ${label} as CSV`} onPress={onPress} style={styles.csv}>
      <Icon name="download" size={16} color={colors.ink2} strokeWidth={2} />
      <Text style={styles.csvText}>CSV</Text>
    </Pressable>
  );

  const header = isOwnCompany ? (
    <LargeHeader
      eyebrow={isMainCompany ? 'Main company' : 'Sub company'}
      title="Reports"
      right={
        <>
          {isMainCompany && <IconButton icon="bell" label="Alerts" onPress={() => navigation.navigate('Alerts')} />}
          <AccountButton user={user} onLogout={logout} />
        </>
      }
    />
  ) : (
    <>
      <NavHeader title={companyLabel || 'Sub Company'} />
      <View style={styles.readOnlyWrap}>
        <ReadOnlyBanner subtitle={lastSyncedLabel(lastSynced)} />
        <CompanySwitcher active="reports" params={{ companyId, companyName: companyLabel }} />
      </View>
    </>
  );

  if (loading) {
    return (
      <Screen>
        {header}
        <Loading />
      </Screen>
    );
  }

  const svp = salesVsPurchases;
  const svpMax = svp ? Math.max(svp.totalSalesRevenue, svp.totalPurchaseCost, 1) : 1;
  const paymentRows = svp
    ? ['cash', 'transfer', 'credit'].map((key) => {
        const bucket = svp.salesByPaymentMethod[key];
        return {
          key,
          method: PAYMENT_LABEL[key],
          count: bucket.count,
          revenue: bucket.revenue,
          share: svp.totalSalesRevenue > 0 ? (bucket.revenue / svp.totalSalesRevenue) * 100 : 0,
        };
      })
    : [];
  const companyMax = marginByCompany ? Math.max(0, ...marginByCompany.map((c) => c.margin)) : 0;
  const dateLabel =
    appliedFilters.from || appliedFilters.to ? `${formatYmd(appliedFilters.from) || 'Start'} – ${formatYmd(appliedFilters.to) || 'Today'}` : null;

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <LocalDataNotice user={user} onSynced={() => loadLocal(appliedFilters)} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips} style={styles.filterScroll}>
          <Chip label="Filters" icon={filtersOpen ? 'chevup' : 'filter'} active={filtersOpen} onPress={() => setFiltersOpen((o) => !o)} />
          {dateLabel && <Chip label={dateLabel} icon="calendar" onClear={() => clearFilter('date')} />}
          {appliedFilters.category ? <Chip label={appliedFilters.category} onClear={() => clearFilter('category')} /> : null}
          {appliedFilters.itemName ? <Chip label={appliedFilters.itemName} onClear={() => clearFilter('item')} /> : null}
          {!dateLabel && !appliedFilters.category && !appliedFilters.itemName && <Chip label="All time · all items" />}
        </ScrollView>

        {filtersOpen && (
          <Card padding={16} gap={14}>
            <Field label="Category" value={categoryInput} onChangeText={setCategoryInput} placeholder="e.g. Hardware" />
            <View style={{ gap: 8 }}>
              <Text style={type.label}>Item</Text>
              {selectedItem ? (
                <View style={{ flexDirection: 'row' }}>
                  <Chip label={selectedItem.name} active onClear={handleClearSelectedItem} />
                </View>
              ) : (
                <>
                  <Field value={itemSearchText} onChangeText={setItemSearchText} placeholder="Search by name or SKU" leadingIcon="search" accessibilityLabel="Item" />
                  {itemMatches.slice(0, 5).map((i) => (
                    <Pressable
                      key={i.localId}
                      accessibilityRole="button"
                      style={styles.match}
                      onPress={() => {
                        setSelectedItem(i);
                        setItemSearchText('');
                      }}
                    >
                      <Text style={styles.matchName}>{i.name}</Text>
                      <Text style={type.mono}>{i.sku}</Text>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <DateField style={{ flex: 1 }} label="From" value={fromInput} onChange={setFromInput} placeholder="Start" maximumDate={toInput || today} />
              <DateField style={{ flex: 1 }} label="To" value={toInput} onChange={setToInput} placeholder="Today" minimumDate={fromInput || undefined} maximumDate={today} />
            </View>
            {dateError && <Text style={styles.error}>{dateError}</Text>}
            <Button title="Apply filters" variant="dark" height={48} onPress={handleApplyFilters} />
          </Card>
        )}

        <BusinessSummary
          summary={summary}
          periodLabel={dateLabel || 'All time'}
          owedTotal={debtors?.totals.outstanding}
          onOpenDebtors={() => navigation.navigate('Debtors', isOwnCompany ? {} : { companyId, companyName: companyLabel })}
        />

        <Card padding={18} gap={12}>
          <SectionTitle
            title="Customers who owe you"
            right={
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Debtors', isOwnCompany ? {} : { companyId, companyName: companyLabel })}
                style={styles.showAll}
              >
                <Text style={styles.link}>View all</Text>
              </Pressable>
            }
          />
          {!debtors || debtors.customers.length === 0 ? (
            <InlineEmpty>Nobody owes you money. Sales that weren’t fully paid show up here.</InlineEmpty>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={type.caption}>Total owed to you</Text>
                  <Text style={[styles.bigNum, debtors.totals.outstanding > 0 && { color: colors.danger }]} adjustsFontSizeToFit numberOfLines={1}>
                    {formatMoney(debtors.totals.outstanding)}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={type.caption}>Customers owing</Text>
                  <Text style={styles.bigNum}>{formatNumber(debtors.totals.customersOwing)}</Text>
                </View>
              </View>
              {debtors.customers
                .filter((c) => c.balance > 0)
                .slice(0, 3)
                .map((c) => (
                  <KV key={c.customerPhone} label={c.customerName} value={formatMoney(c.balance)} valueColor={colors.danger} />
                ))}
              <KV label="Paid back so far (all time)" value={formatMoney(debtors.totals.totalRepaid)} />
              <Text style={type.caption}>This is everything owed to date. It doesn’t change with the date filter.</Text>
            </>
          )}
        </Card>

        <Card padding={18} gap={12}>
          <SectionTitle
            title="Stock you have now"
            right={exportButton('stock on hand', () =>
              handleExport('stock-on-hand.csv', stockOnHand, [
                { key: 'sku', label: 'SKU' },
                { key: 'name', label: 'Item' },
                { key: 'category', label: 'Category' },
                { key: 'quantityOnHand', label: 'In stock' },
                { key: 'unit', label: 'Unit' },
                { key: 'lowStockThreshold', label: 'Warn me at' },
              ])
            )}
          />
          <Text style={[type.caption, { marginTop: -6 }]}>Items shown in red are running low.</Text>
          {stockOnHand.length === 0 ? (
            <InlineEmpty>No items yet.</InlineEmpty>
          ) : (
            <Table
              cols={[2, 1.1, 0.9]}
              head={['Item', 'In stock', 'Warn me at']}
              rows={limited('stock', stockOnHand).map((item) => {
                const low = item.quantityOnHand <= item.lowStockThreshold;
                return {
                  key: item.localId,
                  cells: [item.name, { text: `${formatNumber(item.quantityOnHand)} ${item.unit}`, color: low ? colors.danger : undefined }, formatNumber(item.lowStockThreshold)],
                };
              })}
            />
          )}
          {showAll('stock', stockOnHand, 'items')}
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          onPress={() => setShowDetails((v) => !v)}
          style={({ pressed }) => [styles.detailsToggle, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.bodyStrong}>{showDetails ? 'Hide details' : 'More details'}</Text>
            <Text style={type.caption}>Money in and out, how customers paid, profit per item, stock counts, prices and daily summaries.</Text>
          </View>
          <Icon name={showDetails ? 'chevup' : 'chevdown'} size={22} color={colors.ink2} />
        </Pressable>

        {showDetails && (
          <>
          <Card padding={18} gap={14}>
            <SectionTitle title="Money in and out" />
            <Text style={[type.caption, { marginTop: -8 }]}>
              Money from sales compared with money spent buying stock. This isn’t profit: stock you bought but haven’t sold yet still counts as spent.
            </Text>
            {svp ? (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={type.caption}>Money from sales</Text>
                    <Text style={styles.bigNum} adjustsFontSizeToFit numberOfLines={1}>
                      {formatMoney(svp.totalSalesRevenue)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={type.caption}>Spent on stock</Text>
                    <Text style={styles.bigNum} adjustsFontSizeToFit numberOfLines={1}>
                      {formatMoney(svp.totalPurchaseCost)}
                    </Text>
                  </View>
                </View>
                <View style={{ gap: 6 }} accessible accessibilityLabel="Sales compared with purchases">
                  <View style={[styles.svpBar, { width: `${(svp.totalSalesRevenue / svpMax) * 100}%`, backgroundColor: colors.primary }]} />
                  <View style={[styles.svpBar, { width: `${(svp.totalPurchaseCost / svpMax) * 100}%`, backgroundColor: colors.chevron }]} />
                </View>
                <KV
                  strong
                  label="Sales minus stock bought"
                  value={`${formatMoney(svp.margin)}${svp.totalSalesRevenue > 0 ? ` · ${((svp.margin / svp.totalSalesRevenue) * 100).toFixed(1)}%` : ''}`}
                  valueColor={svp.margin >= 0 ? colors.ok : colors.danger}
                />
                <KV label="Number of sales" value={formatNumber(svp.saleCount)} />
                <KV label="Times you bought stock" value={formatNumber(svp.purchaseCount)} />
              </>
            ) : (
              <InlineEmpty>No data available.</InlineEmpty>
            )}
          </Card>

          <Card padding={18} gap={14}>
            <SectionTitle
              title="How customers paid"
              right={exportButton('sales by payment method', () =>
                handleExport('sales-by-payment-method.csv', paymentRows, [
                  { key: 'method', label: 'How they paid' },
                  { key: 'count', label: 'Number of sales' },
                  { key: 'revenue', label: 'Amount' },
                  { key: 'share', label: 'Share of sales (%)' },
                ])
              )}
            />
            {!svp || svp.saleCount === 0 ? (
              <InlineEmpty>No sales recorded{dateLabel ? ' in this period' : ' yet'}.</InlineEmpty>
            ) : (
              <>
                {paymentRows.map((row) => (
                  <View key={row.key} style={{ gap: 6 }}>
                    <View style={styles.payRow}>
                      <Text style={styles.payName}>{row.method}</Text>
                      <Text style={styles.payValue}>{formatMoney(row.revenue)}</Text>
                    </View>
                    <View style={styles.payTrack}>
                      <View
                        style={[
                          styles.payFill,
                          { width: `${row.share}%`, backgroundColor: row.key === 'cash' ? colors.ok : row.key === 'transfer' ? colors.primary : colors.danger },
                        ]}
                      />
                    </View>
                    <Text style={type.caption}>
                      {plural(row.count, 'sale')} · {row.share.toFixed(1)}% of all sales
                    </Text>
                  </View>
                ))}
                {svp.repayments.total > 0 && (
                  <>
                    <Divider />
                    <KV label="Paid back by customers" value={formatMoney(svp.repayments.total)} valueColor={colors.ok} />
                    <Text style={type.caption}>
                      Cash {formatMoney(svp.repayments.cash.amount)} · Transfer {formatMoney(svp.repayments.transfer.amount)}
                    </Text>
                  </>
                )}
                <Text style={type.caption}>
                  Cash and Transfer are what customers paid when they bought. "Not paid yet" is what they still owed from those sales.
                  Older sales from before payment types were added count as cash.
                </Text>
              </>
            )}
          </Card>

          {isMainCompany && isOwnCompany && (
            <Card padding={18} gap={14}>
              <SectionTitle title="Sales minus stock bought, per company" />
              {!marginByCompany ? (
                <InlineEmpty>Couldn’t load the per-company figures.</InlineEmpty>
              ) : (
                [...marginByCompany]
                  .sort((a, b) => b.margin - a.margin)
                  .map((row) => (
                    <BarRow
                      key={row.companyId}
                      name={row.companyName}
                      you={row.isMain}
                      value={row.margin}
                      max={companyMax}
                      label={formatMoney(row.margin)}
                      danger={row.margin < 0}
                    />
                  ))
              )}
            </Card>
          )}

          <Card padding={18} gap={12}>
            <SectionTitle
              title="Profit per item (estimate)"
              right={exportButton('margin by item', () =>
                handleExport('margin-by-item.csv', marginByItem, [
                  { key: 'name', label: 'Item' },
                  { key: 'category', label: 'Category' },
                  { key: 'totalUnitsSold', label: 'Quantity sold' },
                  { key: 'totalRevenue', label: 'Sales' },
                  { key: 'estimatedCost', label: 'Cost (estimate)' },
                  { key: 'estimatedMargin', label: 'Profit (estimate)' },
                ])
              )}
            />
            <Text style={[type.caption, { marginTop: -6 }]}>All sales so far, costed at what you last paid for each item.</Text>
            {marginByItem.length === 0 ? (
              <InlineEmpty>No sales recorded yet.</InlineEmpty>
            ) : (
              <Table
                cols={[1.7, 0.7, 1.2, 1.2]}
                head={['Item', 'Sold', 'Sales', 'Profit']}
                rows={limited('marginItem', marginByItem).map((row) => ({
                  key: row.itemId,
                  cells: [
                    row.name,
                    formatNumber(row.totalUnitsSold),
                    formatMoney(row.totalRevenue),
                    { text: formatMoney(row.estimatedMargin), color: row.estimatedMargin >= 0 ? colors.ok : colors.danger },
                  ],
                }))}
              />
            )}
            {showAll('marginItem', marginByItem, 'items')}
          </Card>

          <Card padding={18} gap={12}>
            <SectionTitle
              title="Profit per category (estimate)"
              right={exportButton('margin by category', () =>
                handleExport('margin-by-category.csv', marginByCategory, [
                  { key: 'category', label: 'Category' },
                  { key: 'totalRevenue', label: 'Sales' },
                  { key: 'estimatedCost', label: 'Cost (estimate)' },
                  { key: 'estimatedMargin', label: 'Profit (estimate)' },
                ])
              )}
            />
            {marginByCategory.length === 0 ? (
              <InlineEmpty>No sales recorded yet.</InlineEmpty>
            ) : (
              <View style={styles.tiles}>
                {marginByCategory.map((row) => (
                  <View key={row.category} style={styles.catTile}>
                    <Text style={type.caption} numberOfLines={1}>
                      {row.category}
                    </Text>
                    <Text style={[styles.catValue, row.estimatedMargin < 0 && { color: colors.danger }]}>{formatMoney(row.estimatedMargin)}</Text>
                    <Text style={type.caption}>profit from {formatMoney(row.totalRevenue)} of sales</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card padding={18} gap={12}>
            <SectionTitle
              title="Recent sales and profit"
              right={exportButton('transaction margins', () =>
                handleExport('transaction-margins.csv', transactionMargins, [
                  { key: 'itemName', label: 'Item' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'occurredAt', label: 'Date' },
                  { key: 'quantity', label: 'Quantity' },
                  { key: 'unitPrice', label: 'Price each' },
                  { key: 'paymentMethod', label: 'How they paid' },
                  { key: 'amountPaid', label: 'Amount paid' },
                  { key: 'customerName', label: 'Customer (if they owe)' },
                  { key: 'estimatedCost', label: 'Cost (estimate)' },
                  { key: 'estimatedMargin', label: 'Profit (estimate)' },
                ])
              )}
            />
            <Text style={[type.caption, { marginTop: -6 }]}>Your latest 50 sales, each costed at what you paid for the item at that time.</Text>
            {transactionMargins.length === 0 ? (
              <InlineEmpty>No sales recorded yet.</InlineEmpty>
            ) : (
              <Table
                cols={[2, 1, 1]}
                head={['Sale', 'Price', 'Profit']}
                rows={limited('tx', transactionMargins).map((tx) => ({
                  key: tx.transactionId,
                  cells: [
                    {
                      text: `${tx.itemName || 'Unknown item'} × ${formatNumber(tx.quantity)}`,
                      sub:
                        tx.amountPaid < tx.revenue - 0.005
                          ? `${formatDate(tx.occurredAt)} · ${tx.amountPaid > 0 ? 'Part paid' : 'Not paid yet'}${tx.customerName ? ` · ${tx.customerName}` : ''}`
                          : `${formatDate(tx.occurredAt)} · ${PAYMENT_LABEL[tx.paymentMethod]}`,
                    },
                    formatMoney(tx.unitPrice),
                    tx.costAvailable
                      ? { text: formatMoney(tx.estimatedMargin), color: tx.estimatedMargin >= 0 ? colors.ok : colors.danger }
                      : { text: 'No cost price', color: colors.ink3 },
                  ],
                }))}
              />
            )}
            {showAll('tx', transactionMargins, 'sales')}
          </Card>

          <Card padding={18} gap={12}>
            <SectionTitle
              title="Stock count differences"
              right={exportButton('discrepancies', () =>
                handleExport('discrepancies.csv', discrepancies, [
                  { key: 'itemName', label: 'Item' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'occurredAt', label: 'Date' },
                  { key: 'expected', label: 'App said' },
                  { key: 'counted', label: 'You counted' },
                  { key: 'discrepancy', label: 'Difference' },
                ])
              )}
            />
            <Text style={[type.caption, { marginTop: -6 }]}>Each time you counted stock: what the app expected and what you actually found. A minus means items were missing.</Text>
            {discrepancies.length === 0 ? (
              <InlineEmpty>You haven’t recorded a stock count yet.</InlineEmpty>
            ) : (
              <Table
                cols={[1.8, 0.9, 0.9, 0.7]}
                head={['Item', 'App said', 'Counted', 'Diff.']}
                rows={limited('disc', discrepancies).map((d) => ({
                  key: d.transactionId,
                  cells: [
                    { text: d.itemName || 'Unknown item', sub: formatDate(d.occurredAt) },
                    d.discrepancyKnown ? formatNumber(d.expected) : 'Unknown',
                    formatNumber(d.counted),
                    !d.discrepancyKnown
                      ? { text: '—', color: colors.ink3 }
                      : {
                          text: `${d.discrepancy > 0 ? '+' : d.discrepancy < 0 ? '−' : ''}${Math.abs(d.discrepancy)}`,
                          color: d.discrepancy === 0 ? undefined : d.discrepancy > 0 ? colors.ok : colors.danger,
                        },
                  ],
                }))}
              />
            )}
            {showAll('disc', discrepancies, 'adjustments')}
          </Card>

          <Card padding={18} gap={12}>
            <SectionTitle
              title="How prices changed"
              right={exportButton('price trend', () =>
                handleExport(`price-trend-${selectedItem ? selectedItem.sku : 'item'}.csv`, priceTrend, [
                  { key: 'effectiveDate', label: 'Date' },
                  { key: 'priceType', label: 'Bought or sold' },
                  { key: 'amount', label: 'Price' },
                ])
              )}
            />
            {!appliedFilters.itemId ? (
              <View style={{ gap: 10 }}>
                <InlineEmpty>Choose an item in Filters to see what you paid and charged for it over time.</InlineEmpty>
                <Button title="Choose an item" variant="secondary" icon="filter" height={44} onPress={() => setFiltersOpen(true)} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : priceTrend.length === 0 ? (
              <InlineEmpty>No price history recorded yet for {appliedFilters.itemName}.</InlineEmpty>
            ) : (
              <>
                <Text style={styles.trendItem}>{appliedFilters.itemName}</Text>
                <PriceTrendChart history={priceTrend} />
              </>
            )}
          </Card>

          <Card padding={18} gap={12}>
            <SectionTitle title="Daily summaries" />
            <Text style={[type.caption, { marginTop: -6 }]}>
              A short summary is saved automatically once a day and listed here.
            </Text>
            {snapshotsSavedAt && (
              <Text style={type.caption}>
                {snapshotsSavedAt === 'never'
                  ? 'Offline · summaries load once you’re connected.'
                  : `Offline · saved copy from ${formatDateTime(snapshotsSavedAt)}.`}
              </Text>
            )}
            {snapshots.length === 0 ? (
              <InlineEmpty>No daily summaries yet.</InlineEmpty>
            ) : (
              <View>
                {limited('snap', snapshots).map((s, i) => (
                  <View key={s.id}>
                    {i > 0 && <Divider />}
                    <View style={styles.snapRow}>
                      <Icon name="calendar" size={20} color={colors.ink3} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.snapTitle}>{formatDateTime(s.generatedAt)}</Text>
                        <Text style={type.caption}>
                          {formatNumber(s.itemCount)} items · {formatNumber(s.lowStockCount)} running low · {formatMoney(s.totalSalesRevenue)} sales
                        </Text>
                        {Number(s.totalSalesRevenue) > 0 && (
                          <Text style={type.caption}>
                            Cash {formatMoney(s.cashSalesRevenue)} · Transfer {formatMoney(s.transferSalesRevenue)}
                          </Text>
                        )}
                        {Number(s.outstandingDebt) > 0 && <Text style={type.caption}>Customers owed {formatMoney(s.outstandingDebt)}</Text>}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text style={[styles.snapMargin, { color: s.margin >= 0 ? colors.ok : colors.danger }]}>{formatMoney(s.margin)}</Text>
                        <Text style={type.caption}>sales − stock</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
            {showAll('snap', snapshots, 'summaries')}
            <Button title="Make today’s summary now" variant="secondary" icon="sync" height={48} onPress={handleGenerateSnapshot} loading={generatingSnapshot} />
          </Card>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// "How your business did": the period's key numbers in plain sentences, for someone who
// doesn't read accounts. Profit is an estimate: each sale costed at what was paid for the item
// at the time (reportMath.businessSummary). Sales of items with no purchase price recorded can't
// be costed and are called out rather than silently counted as pure profit.
function BusinessSummary({ summary, periodLabel, owedTotal, onOpenDebtors }) {
  if (!summary) return null;
  const hasSales = summary.saleCount > 0;
  return (
    <Card padding={18} gap={14}>
      <View style={{ gap: 2 }}>
        <Text style={type.heading} accessibilityRole="header">
          How your business did
        </Text>
        <Text style={type.caption}>{periodLabel}</Text>
      </View>

      {!hasSales && summary.stockBought === 0 ? (
        <InlineEmpty>No sales or stock bought in this period yet.</InlineEmpty>
      ) : (
        <>
          <SummaryLine label="You sold goods worth" value={formatMoney(summary.sales)} note={hasSales ? plural(summary.saleCount, 'sale') : 'No sales yet'} big />
          <SummaryLine
            label="Your profit on those sales"
            value={formatMoney(summary.profit)}
            color={summary.profit >= 0 ? colors.ok : colors.danger}
            note={
              summary.salesWithoutCost > 0
                ? `An estimate. ${plural(summary.salesWithoutCost, 'sale')} of items with no cost price recorded ${summary.salesWithoutCost === 1 ? 'isn’t' : 'aren’t'} counted.`
                : 'An estimate: what you sold for, minus what you paid for those items.'
            }
            big
          />
          <SummaryLine label="You spent on new stock" value={formatMoney(summary.stockBought)} />
          <Divider />
          <View style={{ gap: 8 }}>
            <Text style={type.label}>How these sales were paid</Text>
            <SummaryLine label="Cash" value={formatMoney(summary.cash)} />
            <SummaryLine label="Transfer" value={formatMoney(summary.transfer)} />
            {summary.owedFromTheseSales > 0 && (
              <SummaryLine label="Not paid yet" value={formatMoney(summary.owedFromTheseSales)} color={colors.danger} />
            )}
            {summary.repaid > 0 && <SummaryLine label="Old debts paid back" value={formatMoney(summary.repaid)} color={colors.ok} />}
          </View>
        </>
      )}

      <Divider />
      <Pressable accessibilityRole="button" onPress={onOpenDebtors} style={({ pressed }) => [styles.summaryLink, pressed && { opacity: 0.7 }]}>
        <Icon name="user" size={18} color={colors.ink2} />
        <Text style={[type.body, { flex: 1 }]}>Customers still owe you</Text>
        <Text style={[styles.summaryValue, owedTotal > 0 && { color: colors.danger }]}>{formatMoney(owedTotal || 0)}</Text>
        <Icon name="chev" size={18} color={colors.chevron} />
      </Pressable>
      {summary.bestSeller && (
        <View style={styles.summaryLink}>
          <Icon name="chart" size={18} color={colors.ink2} />
          <Text style={[type.body, { flex: 1 }]} numberOfLines={2}>
            Best seller: <Text style={styles.summaryStrong}>{summary.bestSeller.name}</Text> ({formatMoney(summary.bestSeller.revenue)})
          </Text>
        </View>
      )}
      <View style={styles.summaryLink}>
        <Icon name="alert" size={18} color={summary.lowStockCount > 0 ? colors.danger : colors.ink2} />
        <Text style={[type.body, { flex: 1 }]}>
          {summary.lowStockCount > 0
            ? `${plural(summary.lowStockCount, 'item')} running low. See "Stock you have now" below.`
            : 'No items are running low.'}
        </Text>
      </View>
    </Card>
  );
}

function SummaryLine({ label, value, note, color, big = false }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.summaryRow}>
        <Text style={[big ? type.bodyStrong : type.body, { flex: 1 }]}>{label}</Text>
        <Text style={[big ? styles.summaryBig : styles.summaryValue, color && { color }]} adjustsFontSizeToFit numberOfLines={1}>
          {value}
        </Text>
      </View>
      {note ? <Text style={type.caption}>{note}</Text> : null}
    </View>
  );
}

// Compact table: first column left-aligned, the rest right-aligned numbers. A cell may be a
// string or { text, color, sub }.
function Table({ cols, head, rows }) {
  return (
    <View>
      <View style={[styles.tr, styles.thead]}>
        {head.map((h, i) => (
          <Text key={h} style={[styles.th, { flex: cols[i] }, i > 0 && styles.num]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.key} style={styles.tr}>
          {r.cells.map((c, i) => {
            const cell = typeof c === 'object' && c !== null ? c : { text: c };
            return (
              <View key={i} style={{ flex: cols[i] }}>
                <Text style={[styles.td, i > 0 && styles.num, cell.color && { color: cell.color }]} numberOfLines={2}>
                  {cell.text}
                </Text>
                {cell.sub ? <Text style={[type.caption, i > 0 && styles.num]}>{cell.sub}</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  readOnlyWrap: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12, gap: 14 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  filterScroll: { marginHorizontal: -20, flexGrow: 0 },
  filterChips: { paddingHorizontal: 20, gap: 8 },
  match: { paddingVertical: 10, paddingHorizontal: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  matchName: { fontFamily: fonts.medium, fontSize: 14, flex: 1 },
  error: { fontSize: 12, color: colors.danger, fontFamily: fonts.medium },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  showAll: { paddingVertical: 6 },
  csv: {
    height: 36, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  csvText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  bigNum: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  svpBar: { height: 10, borderRadius: 5, minWidth: 4 },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  payName: { fontFamily: fonts.semibold, fontSize: 15 },
  payValue: { fontFamily: fonts.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  payTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  payFill: { height: 8, borderRadius: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catTile: { flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceMuted, gap: 3 },
  catValue: { fontFamily: fonts.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  trendItem: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  snapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  snapTitle: { fontFamily: fonts.semibold, fontSize: 14 },
  snapMargin: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  tr: { flexDirection: 'row', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, alignItems: 'flex-start' },
  thead: { paddingTop: 0, paddingBottom: 8, borderBottomColor: colors.line },
  th: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink3 },
  td: { fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  num: { textAlign: 'right' },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  summaryBig: { fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.3, fontVariant: ['tabular-nums'], maxWidth: '55%' },
  summaryValue: { fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'], maxWidth: '55%' },
  summaryStrong: { fontFamily: fonts.semibold },
  summaryLink: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.surface,
  },
});
