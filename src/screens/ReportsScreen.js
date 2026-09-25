import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Pressable, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';
import { exportCsv } from '../utils/csvExport';
import { formatDate, formatDateTime, formatMoney, formatNumber, lastSyncedLabel } from '../utils/format';
import Icon from '../components/Icon';
import PriceTrendChart from '../components/PriceTrendChart';
import {
  Text, Screen, LargeHeader, NavHeader, IconButton, AccountButton, Card, SectionTitle, Chip, Field, Button, Banner,
  KV, BarRow, Divider, InlineEmpty, Loading, CompanySwitcher, ReadOnlyBanner,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const PREVIEW_ROWS = 5;

// RPT-01, RPT-02, RPT-03, RPT-04, PRC-04: stock on hand (item/category filter), sales vs
// purchases (date range filter), margin by item/category/Sub Company, per-transaction margin
// (historical PriceHistory cost basis), discrepancy report (expected vs counted stock), and
// price trend for a selected item. RPT-05 export is CSV only — no PDF/Excel, which would need
// new heavyweight dependencies this project has otherwise avoided throughout.
export default function ReportsScreen({ route, navigation }) {
  const { user, isMainCompany, logout } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const isOwnCompany = companyId === user.companyId;
  const lastSynced = getLastSyncedAt(user.id);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [stockOnHand, setStockOnHand] = useState([]);
  const [salesVsPurchases, setSalesVsPurchases] = useState(null);
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
  const [appliedFilters, setAppliedFilters] = useState({ category: '', itemId: null, itemName: '', from: '', to: '' });
  const [expanded, setExpanded] = useState({});

  async function load(filters = appliedFilters) {
    setError(null);
    try {
      const calls = [
        api.getStockOnHandReport(companyId, { category: filters.category, itemId: filters.itemId }),
        api.getSalesVsPurchases(companyId, { from: filters.from, to: filters.to }),
        api.getMarginByItem(companyId),
        api.getItems(companyId),
        api.getTransactionMargins(companyId, { itemId: filters.itemId, from: filters.from, to: filters.to, limit: 50 }),
        api.getDiscrepancies(companyId, { from: filters.from, to: filters.to }),
        filters.itemId ? api.getPriceTrend(companyId, { itemId: filters.itemId }) : Promise.resolve({ history: [] }),
        isMainCompany ? api.getOversightSummary({ from: filters.from, to: filters.to }) : Promise.resolve(null),
        api.getReportSnapshots(companyId, { limit: 20 }),
      ];
      const [stock, svp, margin, itemsResp, txMargins, discrepancyResp, trendResp, summaryResp, snapshotResp] = await Promise.all(calls);
      setStockOnHand(stock.items);
      setSalesVsPurchases(svp);
      setMarginByItem(margin.report);
      setItems(itemsResp.items);
      setTransactionMargins(txMargins.transactions);
      setDiscrepancies(discrepancyResp.discrepancies);
      setPriceTrend(trendResp.history);
      setMarginByCompany(summaryResp ? summaryResp.companies : null);
      setSnapshots(snapshotResp.snapshots);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [companyId]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function applyFilters(next) {
    setAppliedFilters(next);
    setExpanded({});
    load(next);
  }

  function handleApplyFilters() {
    if (fromInput && isNaN(Date.parse(fromInput))) {
      setDateError('Invalid "from" date — use YYYY-MM-DD');
      return;
    }
    if (toInput && isNaN(Date.parse(toInput))) {
      setDateError('Invalid "to" date — use YYYY-MM-DD');
      return;
    }
    setDateError(null);
    setFiltersOpen(false);
    applyFilters({
      category: categoryInput.trim(),
      itemId: selectedItem?.id || null,
      itemName: selectedItem?.name || '',
      from: fromInput.trim(),
      to: toInput.trim(),
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
      const { snapshots: fresh } = await api.getReportSnapshots(companyId, { limit: 20 });
      setSnapshots(fresh);
    } catch (err) {
      Alert.alert('Could not generate report', err.message);
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
        isMainCompany ? (
          <IconButton icon="bell" label="Alerts" onPress={() => navigation.navigate('Alerts')} />
        ) : (
          <AccountButton user={user} onLogout={logout} />
        )
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
  const companyMax = marginByCompany ? Math.max(0, ...marginByCompany.map((c) => c.margin)) : 0;
  const dateLabel =
    appliedFilters.from || appliedFilters.to ? `${appliedFilters.from || 'Start'} – ${appliedFilters.to || 'Today'}` : null;

  return (
    <Screen>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        {error && (
          <Banner
            kind="error"
            title="Couldn't reach the latest data"
            subtitle={`Reports need an internet connection. ${error}`}
            actionLabel="Retry"
            onAction={handleRefresh}
          />
        )}

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
                      key={i.id}
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
              <Field style={{ flex: 1 }} label="From" value={fromInput} onChangeText={setFromInput} placeholder="YYYY-MM-DD" />
              <Field style={{ flex: 1 }} label="To" value={toInput} onChangeText={setToInput} placeholder="YYYY-MM-DD" />
            </View>
            {dateError && <Text style={styles.error}>{dateError}</Text>}
            <Button title="Apply filters" variant="dark" height={48} onPress={handleApplyFilters} />
          </Card>
        )}

        <Card padding={18} gap={14}>
          <SectionTitle title="Sales vs. purchases" />
          {svp ? (
            <>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={type.caption}>Sales revenue</Text>
                  <Text style={styles.bigNum} adjustsFontSizeToFit numberOfLines={1}>
                    {formatMoney(svp.totalSalesRevenue)}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={type.caption}>Purchase cost</Text>
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
                label="Margin"
                value={`${formatMoney(svp.margin)}${svp.totalSalesRevenue > 0 ? ` · ${((svp.margin / svp.totalSalesRevenue) * 100).toFixed(1)}%` : ''}`}
                valueColor={svp.margin >= 0 ? colors.ok : colors.danger}
              />
              <KV label="Sales recorded" value={formatNumber(svp.saleCount)} />
              <KV label="Purchases recorded" value={formatNumber(svp.purchaseCount)} />
            </>
          ) : (
            <InlineEmpty>No data available.</InlineEmpty>
          )}
        </Card>

        {isMainCompany && isOwnCompany && (
          <Card padding={18} gap={14}>
            <SectionTitle title="Margin by sub company" />
            {!marginByCompany ? (
              <InlineEmpty>Could not load company breakdown.</InlineEmpty>
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
            title="Stock on hand"
            right={exportButton('stock on hand', () =>
              handleExport('stock-on-hand.csv', stockOnHand, [
                { key: 'sku', label: 'SKU' },
                { key: 'name', label: 'Name' },
                { key: 'category', label: 'Category' },
                { key: 'quantityOnHand', label: 'Quantity On Hand' },
                { key: 'unit', label: 'Unit' },
                { key: 'lowStockThreshold', label: 'Low Stock Threshold' },
              ])
            )}
          />
          {stockOnHand.length === 0 ? (
            <InlineEmpty>No items yet.</InlineEmpty>
          ) : (
            <Table
              cols={[2, 1.1, 0.9]}
              head={['Item', 'On hand', 'Alert at']}
              rows={limited('stock', stockOnHand).map((item) => {
                const low = item.quantityOnHand <= item.lowStockThreshold;
                return {
                  key: item.id,
                  cells: [item.name, { text: `${formatNumber(item.quantityOnHand)} ${item.unit}`, color: low ? colors.danger : undefined }, formatNumber(item.lowStockThreshold)],
                };
              })}
            />
          )}
          {showAll('stock', stockOnHand, 'items')}
        </Card>

        <Card padding={18} gap={12}>
          <SectionTitle
            title="Margin by item"
            right={exportButton('margin by item', () =>
              handleExport('margin-by-item.csv', marginByItem, [
                { key: 'name', label: 'Item' },
                { key: 'category', label: 'Category' },
                { key: 'totalUnitsSold', label: 'Units Sold' },
                { key: 'totalRevenue', label: 'Revenue' },
                { key: 'estimatedCost', label: 'Estimated Cost' },
                { key: 'estimatedMargin', label: 'Estimated Margin' },
              ])
            )}
          />
          {marginByItem.length === 0 ? (
            <InlineEmpty>No sales recorded yet.</InlineEmpty>
          ) : (
            <Table
              cols={[1.7, 0.7, 1.2, 1.2]}
              head={['Item', 'Sold', 'Revenue', 'Est. margin']}
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
            title="Margin by category"
            right={exportButton('margin by category', () =>
              handleExport('margin-by-category.csv', marginByCategory, [
                { key: 'category', label: 'Category' },
                { key: 'totalRevenue', label: 'Revenue' },
                { key: 'estimatedCost', label: 'Estimated Cost' },
                { key: 'estimatedMargin', label: 'Estimated Margin' },
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
                  <Text style={type.caption}>of {formatMoney(row.totalRevenue)} revenue</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card padding={18} gap={12}>
          <SectionTitle
            title="Per-transaction margin"
            right={exportButton('transaction margins', () =>
              handleExport('transaction-margins.csv', transactionMargins, [
                { key: 'itemName', label: 'Item' },
                { key: 'sku', label: 'SKU' },
                { key: 'occurredAt', label: 'Date' },
                { key: 'quantity', label: 'Quantity' },
                { key: 'unitPrice', label: 'Sale Price' },
                { key: 'estimatedCost', label: 'Estimated Cost' },
                { key: 'estimatedMargin', label: 'Estimated Margin' },
              ])
            )}
          />
          <Text style={[type.caption, { marginTop: -6 }]}>Up to the 50 most recent matching sales.</Text>
          {transactionMargins.length === 0 ? (
            <InlineEmpty>No sales recorded yet.</InlineEmpty>
          ) : (
            <Table
              cols={[2, 1, 1]}
              head={['Recent sale', 'Price', 'Margin']}
              rows={limited('tx', transactionMargins).map((tx) => ({
                key: tx.transactionId,
                cells: [
                  { text: `${tx.itemName || 'Unknown item'} × ${formatNumber(tx.quantity)}`, sub: formatDate(tx.occurredAt) },
                  formatMoney(tx.unitPrice),
                  tx.costAvailable
                    ? { text: formatMoney(tx.estimatedMargin), color: tx.estimatedMargin >= 0 ? colors.ok : colors.danger }
                    : { text: 'No cost data', color: colors.ink3 },
                ],
              }))}
            />
          )}
          {showAll('tx', transactionMargins, 'sales')}
        </Card>

        <Card padding={18} gap={12}>
          <SectionTitle
            title="Discrepancy report"
            right={exportButton('discrepancies', () =>
              handleExport('discrepancies.csv', discrepancies, [
                { key: 'itemName', label: 'Item' },
                { key: 'sku', label: 'SKU' },
                { key: 'occurredAt', label: 'Date' },
                { key: 'expected', label: 'Expected (System)' },
                { key: 'counted', label: 'Counted (Physical)' },
                { key: 'discrepancy', label: 'Discrepancy' },
              ])
            )}
          />
          <Text style={[type.caption, { marginTop: -6 }]}>Expected (system) vs. counted (physical) stock for every manual adjustment.</Text>
          {discrepancies.length === 0 ? (
            <InlineEmpty>No stock adjustments recorded yet.</InlineEmpty>
          ) : (
            <Table
              cols={[1.8, 0.9, 0.9, 0.7]}
              head={['Item', 'Expected', 'Counted', 'Diff']}
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
            title="Price trend"
            right={exportButton('price trend', () =>
              handleExport(`price-trend-${selectedItem ? selectedItem.sku : 'item'}.csv`, priceTrend, [
                { key: 'effectiveDate', label: 'Date' },
                { key: 'priceType', label: 'Type' },
                { key: 'amount', label: 'Amount' },
              ])
            )}
          />
          {!appliedFilters.itemId ? (
            <View style={{ gap: 10 }}>
              <InlineEmpty>Choose an item in Filters to see how its prices have moved.</InlineEmpty>
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
          <SectionTitle title="Scheduled reports" />
          <Text style={[type.caption, { marginTop: -6 }]}>
            A summary is generated automatically once a day and appears here. There is no email or push delivery.
          </Text>
          {snapshots.length === 0 ? (
            <InlineEmpty>No automatic reports generated yet.</InlineEmpty>
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
                        {formatNumber(s.itemCount)} items · {formatNumber(s.lowStockCount)} low · {formatMoney(s.totalSalesRevenue)} sales
                      </Text>
                    </View>
                    <Text style={[styles.snapMargin, { color: s.margin >= 0 ? colors.ok : colors.danger }]}>{formatMoney(s.margin)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          {showAll('snap', snapshots, 'snapshots')}
          <Button title="Generate snapshot now" variant="secondary" icon="sync" height={48} onPress={handleGenerateSnapshot} loading={generatingSnapshot} />
        </Card>
      </ScrollView>
    </Screen>
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
});
