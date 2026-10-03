import React, { useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getSuppliers } from '../reports/localReports';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { exportCsv } from '../utils/csvExport';
import { formatDate, formatMoney, plural } from '../utils/format';
import { formatPhone } from '../utils/phone';
import Icon from '../components/Icon';
import LocalDataNotice from '../components/LocalDataNotice';
import { Text, Screen, NavHeader, IconButton, SearchField, Chip, Card, LetterTile, EmptyState, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

const FILTERS = [
  { key: 'owed', label: 'You owe' },
  { key: 'all', label: 'All' },
];

// Suppliers this company bought stock from, and what is still owed to each, biggest first.
// The mirror of Debtors: built from stock-ins that named a supplier, plus payments made to them.
export default function SuppliersScreen({ navigation, route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('owed');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    const next = getSuppliers(companyId);
    setData(next);
    // Nothing owed: show everyone rather than an empty list.
    if (next.totals.suppliersOwed === 0) setFilter((f) => (f === 'owed' ? 'all' : f));
  }
  useLocalRefresh(load);

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    load();
    setRefreshing(false);
  }

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return data.suppliers
      .filter((s) => (filter === 'owed' ? s.balance > 0 : true))
      .filter((s) => !q || s.supplierName.toLowerCase().includes(q) || (digits && s.supplierPhone.includes(digits)));
  }, [data, filter, query]);

  async function handleExport() {
    if (!data || data.suppliers.length === 0) {
      Alert.alert('Nothing to export', 'No stock has been bought from a named supplier yet.');
      return;
    }
    try {
      await exportCsv('suppliers.csv', data.suppliers, [
        { key: 'supplierName', label: 'Supplier' },
        { key: 'supplierPhone', label: 'Phone' },
        { key: 'totalBought', label: 'Total Bought' },
        { key: 'totalOwed', label: 'Owed From Purchases' },
        { key: 'totalPaid', label: 'Paid Since' },
        { key: 'balance', label: 'Balance' },
        { key: 'purchases', label: 'Purchases' },
        { key: 'lastActivityAt', label: 'Last Activity' },
      ]);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  const header = (
    <NavHeader title="Suppliers" right={<IconButton icon="download" label="Export suppliers as CSV" variant="ghost" onPress={handleExport} />} />
  );

  if (!data) {
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
        keyExtractor={(s) => s.supplierPhone}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <LocalDataNotice user={user} onSynced={load} />
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>You owe suppliers</Text>
              <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
                {formatMoney(data.totals.outstanding)}
              </Text>
              <Text style={styles.heroSub}>
                {data.totals.suppliersOwed === 0 ? 'You owe no supplier right now' : `${plural(data.totals.suppliersOwed, 'supplier')} to pay`}
                {data.totals.totalPaid > 0 ? ` · ${formatMoney(data.totals.totalPaid)} paid off so far` : ''}
              </Text>
            </View>
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </View>
            {data.suppliers.length > 5 && <SearchField value={query} onChangeText={setQuery} placeholder="Search by name or phone" />}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState
              icon="box"
              title={data.suppliers.length === 0 ? 'No suppliers yet' : 'No matches'}
              body={
                data.suppliers.length === 0
                  ? 'When you record stock in and name who you bought it from, they show up here. Buying on credit adds what you owe.'
                  : 'Try a different filter or search.'
              }
            />
          </Card>
        }
        renderItem={({ item: s }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens this supplier's purchases and payments"
            onPress={() => navigation.navigate('SupplierDetail', { companyId, supplierPhone: s.supplierPhone, supplierName: s.supplierName })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <LetterTile label={s.supplierName} muted={s.balance <= 0} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name} numberOfLines={1}>
                {s.supplierName}
              </Text>
              <Text style={type.caption} numberOfLines={1}>
                {formatPhone(s.supplierPhone)} · last {formatDate(s.lastActivityAt)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={[styles.balance, s.balance <= 0 && { color: colors.ok }]}>
                {s.balance > 0 ? formatMoney(s.balance) : s.balance < 0 ? `${formatMoney(-s.balance)} overpaid` : 'Paid up'}
              </Text>
              <Text style={type.caption}>{s.balance > 0 ? 'you owe' : ' '}</Text>
            </View>
            <Icon name="chev" size={18} color={colors.chevron} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  hero: { backgroundColor: colors.ink, borderRadius: 20, padding: 18, gap: 6 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onDarkMuted },
  heroValue: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, letterSpacing: -1, color: '#FFFFFF' },
  heroSub: { fontSize: 13, color: colors.onDarkMuted },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  balance: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger, fontVariant: ['tabular-nums'] },
});
