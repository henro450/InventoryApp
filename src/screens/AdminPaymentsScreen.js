import React, { useCallback, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { formatDateTime, formatMoney } from '../utils/format';
import Icon from '../components/Icon';
import { Text, Screen, NavHeader, Chip, Card, Pill, Banner, EmptyState, Loading } from '../components/ui';
import { colors, fonts, type } from '../theme';

const FILTERS = [
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];
const STATUS = {
  pending: { kind: 'warn', label: 'Pending' },
  approved: { kind: 'ok', label: 'Approved' },
  rejected: { kind: 'danger', label: 'Rejected' },
};

// SuperAdmin: proofs of payment companies have uploaded, newest first. Tap one to preview the
// image/PDF and approve (starts the company's subscription from today) or reject it.
export default function AdminPaymentsScreen({ navigation }) {
  const [filter, setFilter] = useState('pending');
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    (status = filter) => {
      setError(null);
      return api
        .adminListPayments(status)
        .then(({ payments: list }) => setPayments(list))
        .catch((err) => setError(err.message));
    },
    [filter]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function changeFilter(key) {
    setFilter(key);
    setPayments(null);
    load(key);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen>
      <NavHeader title="Proofs of payment" />
      <FlatList
        data={payments || []}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 14 }}>
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f.key || 'all'} label={f.label} active={filter === f.key} onPress={() => changeFilter(f.key)} />
              ))}
            </View>
            {error && <Banner kind="error" title="Couldn't load payments" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {!payments && !error && <Loading />}
          </View>
        }
        ListEmptyComponent={
          payments ? (
            <Card>
              <EmptyState icon="wallet" title={filter === 'pending' ? 'Nothing to review' : 'No payments'} body="Proofs of payment companies upload appear here." />
            </Card>
          ) : null
        }
        renderItem={({ item: p }) => {
          const st = STATUS[p.status];
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Opens the proof of payment"
              onPress={() => navigation.navigate('AdminPaymentDetail', { payment: p })}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
            >
              <View style={[styles.fileIcon, p.mimeType === 'application/pdf' && { backgroundColor: colors.dangerSoft }]}>
                <Text style={[styles.fileIconText, p.mimeType === 'application/pdf' && { color: colors.danger }]}>
                  {p.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.company} numberOfLines={1}>
                  {p.companyName || `Company #${p.companyId}`}
                </Text>
                <Text style={type.caption} numberOfLines={1}>
                  {p.amount !== null ? `${formatMoney(p.amount)} · ` : ''}
                  {formatDateTime(p.createdAt)}
                </Text>
              </View>
              <Pill kind={st.kind} label={st.label} />
              <Icon name="chev" size={18} color={colors.chevron} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  fileIcon: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  fileIconText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary },
  company: { fontFamily: fonts.semibold, fontSize: 15 },
});
