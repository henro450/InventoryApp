import React, { useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getDebtors } from '../reports/localReports';
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
  { key: 'owing', label: 'Owing' },
  { key: 'settled', label: 'Paid up' },
  { key: 'all', label: 'All' },
];

// People who owe money from part-paid or credit sales, biggest balance first. Computed from this
// phone's data (works offline, includes unsynced sales and payments). A Main Company can open a
// Sub Company's list read-only with route.params.companyId.
export default function DebtorsScreen({ navigation, route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyName = route?.params?.companyName;
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('owing');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setData(getDebtors(companyId));
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
    return data.customers
      .filter((c) => (filter === 'owing' ? c.balance > 0 : filter === 'settled' ? c.balance <= 0 : true))
      .filter((c) => !q || c.customerName.toLowerCase().includes(q) || (digits && c.customerPhone.includes(digits)));
  }, [data, filter, query]);

  async function handleExport() {
    if (!data || data.customers.length === 0) {
      Alert.alert('Nothing to export', 'No one owes money yet.');
      return;
    }
    try {
      await exportCsv('debtors.csv', data.customers, [
        { key: 'customerName', label: 'Customer' },
        { key: 'customerPhone', label: 'Phone' },
        { key: 'totalOwed', label: 'Total Owed From Sales' },
        { key: 'totalRepaid', label: 'Repaid' },
        { key: 'balance', label: 'Balance' },
        { key: 'creditSales', label: 'Part-paid/Credit Sales' },
        { key: 'lastActivityAt', label: 'Last Activity' },
      ]);
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  const header = (
    <NavHeader
      title={companyName ? `${companyName} debtors` : 'Debtors'}
      right={<IconButton icon="download" label="Export debtors as CSV" variant="ghost" onPress={handleExport} />}
    />
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
        keyExtractor={(c) => c.customerPhone}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <LocalDataNotice user={user} onSynced={load} />
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>Total owed to you</Text>
              <Text style={styles.heroValue} adjustsFontSizeToFit numberOfLines={1}>
                {formatMoney(data.totals.outstanding)}
              </Text>
              <Text style={styles.heroSub}>
                {data.totals.customersOwing === 0 ? 'No one owes money right now' : `${plural(data.totals.customersOwing, 'customer')} owing`}
                {data.totals.totalRepaid > 0 ? ` · ${formatMoney(data.totals.totalRepaid)} repaid so far` : ''}
              </Text>
            </View>
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </View>
            {data.customers.length > 5 && <SearchField value={query} onChangeText={setQuery} placeholder="Search by name or phone" />}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState
              icon="wallet"
              title={data.customers.length === 0 ? 'No one owes money' : 'No matches'}
              body={
                data.customers.length === 0
                  ? 'When a sale is part-paid or on credit, the customer shows up here with what they owe.'
                  : 'Try a different filter or search.'
              }
            />
          </Card>
        }
        renderItem={({ item: c }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens this customer's sales and payments"
            onPress={() => navigation.navigate('DebtorDetail', { companyId, customerPhone: c.customerPhone, customerName: c.customerName })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <LetterTile label={c.customerName} muted={c.balance <= 0} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name} numberOfLines={1}>
                {c.customerName}
              </Text>
              <Text style={type.caption} numberOfLines={1}>
                {formatPhone(c.customerPhone)} · last {formatDate(c.lastActivityAt)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={[styles.balance, c.balance <= 0 && { color: colors.ok }]}>
                {c.balance > 0 ? formatMoney(c.balance) : c.balance < 0 ? `${formatMoney(-c.balance)} credit` : 'Paid up'}
              </Text>
              <Text style={type.caption}>{c.balance > 0 ? 'owes' : ' '}</Text>
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
