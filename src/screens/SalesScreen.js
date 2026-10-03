import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getSales } from '../reports/localReports';
import { receiptNumber } from '../reports/salesMath';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { formatDate, formatMoney, formatTime, formatNumber, plural } from '../utils/format';
import Icon from '../components/Icon';
import LocalDataNotice from '../components/LocalDataNotice';
import { Text, Screen, LargeHeader, AccountButton, SearchField, Chip, Card, Pill, EmptyState, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
  { key: 'all', label: 'All' },
];

function periodStart(key) {
  if (key === 'all') return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (key === 'week') start.setDate(start.getDate() - 6);
  if (key === 'month') start.setDate(start.getDate() - 29);
  return start.getTime();
}

// Every sale on this phone (synced history plus unsynced sales), newest first, with totals for the
// chosen period. Search by customer, phone, item or receipt number. Tapping a sale opens it to
// share a receipt, or (company admins) to void it or take items back.
export default function SalesScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [sales, setSales] = useState(null);
  const [period, setPeriod] = useState('today');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Only the chosen period is read from the phone, so a long history doesn't slow the screen.
  const readSales = useCallback(() => {
    const start = periodStart(period);
    return getSales(user.companyId, { since: start === null ? undefined : new Date(start).toISOString() });
  }, [user.companyId, period]);

  useLocalRefresh(() => setSales(readSales()));
  useEffect(() => {
    setSales(readSales());
  }, [readSales]);

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    setSales(readSales());
    setRefreshing(false);
  }

  const visible = useMemo(() => {
    if (!sales) return [];
    const since = periodStart(period);
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return sales
      .filter((s) => since === null || new Date(s.occurredAt).getTime() >= since)
      .filter(
        (s) =>
          !q ||
          (s.customerName || '').toLowerCase().includes(q) ||
          (digits.length >= 3 && (s.customerPhone || '').includes(digits)) ||
          receiptNumber(s.key).toLowerCase().includes(q) ||
          s.lines.some((l) => l.itemName.toLowerCase().includes(q))
      );
  }, [sales, period, query]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, s) => ({ sold: acc.sold + s.total - s.returnedValue, paid: acc.paid + s.paid - s.refunded, owed: acc.owed + s.owed }),
        { sold: 0, paid: 0, owed: 0 }
      ),
    [visible]
  );

  const header = <LargeHeader title="Sales" right={<AccountButton user={user} onLogout={logout} />} />;

  if (!sales) {
    return (
      <Screen>
        {header}
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <FlatList
        data={visible}
        keyExtractor={(s) => s.key}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <LocalDataNotice user={user} onSynced={() => setSales(readSales())} />
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>Sold, after returns</Text>
              <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
                {formatMoney(totals.sold)}
              </Text>
              <Text style={styles.heroSub}>
                {plural(visible.length, 'sale')} · {formatMoney(totals.paid)} received
                {totals.owed > 0 ? ` · ${formatMoney(totals.owed)} still owed` : ''}
              </Text>
            </View>
            <View style={styles.chips}>
              {PERIODS.map((p) => (
                <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => setPeriod(p.key)} />
              ))}
            </View>
            <SearchField value={query} onChangeText={setQuery} placeholder="Customer, item or receipt number" />
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState
              icon="receipt"
              title={sales.length === 0 ? 'No sales yet' : 'No sales here'}
              body={sales.length === 0 ? 'Sales you record show up here, with a receipt you can share.' : 'Try another period or search.'}
            />
          </Card>
        }
        renderItem={({ item: s }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the sale and its receipt"
            onPress={() => navigation.navigate('SaleDetail', { saleKey: s.key })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.items} numberOfLines={2}>
                {s.lines.map((l) => `${l.itemName} × ${formatNumber(l.quantity)}`).join(', ')}
              </Text>
              <Text style={type.caption} numberOfLines={1}>
                {period === 'today' ? formatTime(s.occurredAt) : `${formatDate(s.occurredAt)}, ${formatTime(s.occurredAt)}`} · #{receiptNumber(s.key)}
                {s.customerName ? ` · ${s.customerName}` : ''}
              </Text>
              <View style={styles.pills}>
                {s.status === 'voided' && <Pill kind="danger" label="Voided" />}
                {s.status === 'returned' && <Pill kind="warn" label="Items returned" />}
                {s.owed > 0 && <Pill kind="danger" label={`Owes ${formatMoney(s.owed)}`} />}
                {s.pending && <Pill kind="warn" icon="sync" label="Not synced" />}
              </View>
            </View>
            <Text style={[styles.total, s.status === 'voided' && styles.struck]}>{formatMoney(s.total)}</Text>
            <Icon name="chev" size={18} color={colors.chevron} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  hero: { backgroundColor: colors.inkBg, borderRadius: 20, padding: 18, gap: 6 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onDarkMuted },
  heroValue: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, letterSpacing: -1, color: colors.onInk },
  heroSub: { fontSize: 13, color: colors.onDarkMuted },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  items: { fontFamily: fonts.semibold, fontSize: 15 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  total: { fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through', color: colors.ink3 },
});
