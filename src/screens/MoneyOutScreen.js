import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { getMoneyOut, getSavings, getRecentCategories, getDueRepeats, visibleCompanyIds } from '../reports/localReports';
import { getLocalCompany, updateLocalOutflow } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import { formatDate, formatMoney, formatTime, plural } from '../utils/format';
import { KIND_META, outflowSubtitle, outflowTitle } from '../utils/outflows';
import { SPENDING_KINDS } from '../reports/outflowMath';
import Icon from '../components/Icon';
import RecordOutflowSheet from '../components/RecordOutflowSheet';
import DueBill, { dueRecordValues } from '../components/DueBill';
import {
  Text, Screen, NavHeader, Card, ListCard, Divider, Segmented, Chip, Sheet, Button, Pill, EmptyState, KV, IconButton,
} from '../components/ui';
import { colors, fonts, outflowColors, shadow, type } from '../theme';

const PERIODS = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All' },
];
const PERIOD_LABEL = { week: 'This week', month: 'This month', year: 'This year', all: 'All time' };
const PAGE = 60;

function periodRange(key) {
  const now = new Date();
  if (key === 'all') return {};
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (key === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // weeks start on Monday
  if (key === 'month') start.setDate(1);
  if (key === 'year') start.setMonth(0, 1);
  return { from: start.toISOString() };
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDate(iso);
}

const isRepeating = (o) => o?.repeatsMonthly === 1 || o?.repeatsMonthly === true;

// Everything that went out of the business in a period: stock bought (added automatically from
// stock-in transactions), expenses, savings, withdrawals, loan repayments, refunds and taxes.
// Company admins see every kind and can record, stop a monthly repeat, or delete; other users see
// and record expenses only. A Main Company sees its Sub Companies' entries too.
export default function MoneyOutScreen({ navigation, route }) {
  const { user, isCompanyAdmin } = useAuth();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState(route.params?.period || 'month');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [savings, setSavings] = useState(null);
  const [recent, setRecent] = useState({});
  const [dues, setDues] = useState([]);
  const [shown, setShown] = useState(PAGE);
  const [recording, setRecording] = useState(route.params?.record ? { ...route.params.record } : null);
  const [selected, setSelected] = useState(null);

  const companyIds = isCompanyAdmin ? visibleCompanyIds(user) : [user.companyId];

  function load() {
    const result = getMoneyOut(user, periodRange(period), companyIds);
    if (!isCompanyAdmin) result.entries = result.entries.filter((e) => e.kind === 'expense');
    setData(result);
    setSavings(getSavings(user.companyId));
    setRecent(getRecentCategories(user.companyId));
    setDues(isCompanyAdmin ? getDueRepeats(user.companyId) : []);
  }
  useLocalRefresh(load);
  React.useEffect(load, [period]);

  const goalNames = useMemo(() => new Map((savings?.goals || []).map((g) => [g.clientGoalId, g.name])), [savings]);
  const companyNames = useMemo(() => {
    if (companyIds.length < 2) return null;
    return new Map(companyIds.map((id) => [id, getLocalCompany(id)?.name || `Company #${id}`]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIds.join(',')]);

  if (!data) return <Screen><NavHeader title="Money out" /></Screen>;

  const { totals } = data;
  const rows = [
    ...SPENDING_KINDS.map((k) => ({ kind: k, value: totals.byKind[k] })),
    { kind: 'savings', value: totals.savingsNet },
  ].filter((r) => r.value > 0 && (isCompanyAdmin || r.kind === 'expense'));
  const grand = rows.reduce((s, r) => s + r.value, 0);
  const presentKinds = new Set(data.entries.map((e) => (e.kind === 'savings_return' ? 'savings' : e.kind)));
  const filters = ['all', ...['expense', 'savings', 'stock', 'withdrawal', 'loan', 'refund', 'tax'].filter((k) => presentKinds.has(k))];
  const visible = data.entries.filter((e) => filter === 'all' || e.kind === filter || (filter === 'savings' && e.kind === 'savings_return'));

  const groups = [];
  for (const e of visible.slice(0, shown)) {
    const label = dayLabel(e.occurredAt);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, total: 0, entries: [] };
      groups.push(group);
    }
    group.entries.push(e);
  }
  // Day totals count everything that left the till that day, so money taken back out of savings
  // doesn't count against it.
  for (const g of groups) g.total = g.entries.reduce((s, e) => s + (e.kind === 'savings_return' ? 0 : e.amount), 0);

  function afterSave(message) {
    setRecording(null);
    load();
    runSync(user.id);
    Alert.alert('Saved', message);
  }

  function changeSelected(changes, done) {
    updateLocalOutflow(selected.outflow, changes, user.id);
    setSelected(null);
    load();
    runSync(user.id);
    if (done) Alert.alert(done);
  }

  function confirmDelete() {
    Alert.alert('Delete this entry?', `${formatMoney(selected.amount)} will be taken off Money out on every phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => changeSelected({ delete: true }) },
    ]);
  }

  const canEdit = (e) => isCompanyAdmin && !e.auto && e.companyId === user.companyId;

  return (
    <Screen>
      <NavHeader
        title={isCompanyAdmin ? 'Money out' : 'Expenses'}
        right={isCompanyAdmin ? <IconButton icon="piggy" label="Savings" variant="ghost" onPress={() => navigation.navigate('Savings')} /> : null}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}>
        {dues.map((d) => (
          <DueBill key={d.outflow.clientOutflowId} due={d} onRecord={() => setRecording(dueRecordValues(d))} />
        ))}

        <Segmented accessibilityLabel="Period" options={PERIODS} value={period} onChange={(p) => { setPeriod(p); setShown(PAGE); }} />

        <Card padding={16} gap={14}>
          <View style={styles.totalRow}>
            <Text style={type.small}>{PERIOD_LABEL[period]}</Text>
            <Text style={styles.total} adjustsFontSizeToFit numberOfLines={1}>{formatMoney(grand).replace(/\.00$/, '')}</Text>
          </View>
          {grand > 0 ? (
            <>
              <View style={styles.stack}>
                {rows.map((r) => (
                  <View key={r.kind} style={{ flex: r.value, backgroundColor: outflowColors[r.kind].ink }} />
                ))}
              </View>
              <View style={{ gap: 9 }}>
                {rows.map((r) => (
                  <View key={r.kind} style={styles.breakRow}>
                    <View style={[styles.swatch, { backgroundColor: outflowColors[r.kind].ink }]} />
                    <Text style={styles.breakLabel}>{r.kind === 'savings' ? 'Savings (net)' : KIND_META[r.kind].label}</Text>
                    <Text style={styles.breakValue}>{formatMoney(r.value).replace(/\.00$/, '')}</Text>
                    <Text style={styles.breakPct}>{Math.round((r.value / grand) * 100)}%</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={type.small}>Nothing went out in this period yet.</Text>
          )}
        </Card>

        {isCompanyAdmin && savings && (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Savings')}
            style={({ pressed }) => [styles.savingsRow, pressed && { opacity: 0.8 }]}
          >
            <Icon name="piggy" size={20} color={colors.ok} />
            <View style={{ flex: 1 }}>
              <Text style={styles.savingsTitle}>{formatMoney(savings.total).replace(/\.00$/, '')} in savings</Text>
              <Text style={type.caption}>{savings.goals.length ? plural(savings.goals.length, 'goal') : 'Set money aside for rent, a generator, or emergencies'}</Text>
            </View>
            <Icon name="chev" size={18} color={colors.chevron} />
          </Pressable>
        )}

        {filters.length > 2 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
            {filters.map((f) => (
              <Chip key={f} label={f === 'all' ? 'All' : KIND_META[f].short} active={filter === f} onPress={() => { setFilter(f); setShown(PAGE); }} />
            ))}
          </ScrollView>
        )}

        {visible.length === 0 ? (
          <ListCard>
            <EmptyState
              icon="receipt"
              title={isCompanyAdmin ? 'No money out recorded' : 'No expenses recorded'}
              body={isCompanyAdmin
                ? 'Record rent, fuel, salaries and other spending here. Stock you buy shows up on its own.'
                : 'Record fuel, transport and other shop spending so the owner can see where money went.'}
            />
          </ListCard>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={{ gap: 8 }}>
              <View style={styles.dayRow}>
                <Text style={styles.dayLabel}>{g.label}</Text>
                <Text style={styles.dayLabel}>{formatMoney(g.total).replace(/\.00$/, '')}</Text>
              </View>
              <ListCard>
                {g.entries.map((e, i) => {
                  const tint = outflowColors[e.kind] || outflowColors.stock;
                  const company = companyNames && e.companyId !== user.companyId ? companyNames.get(e.companyId) : null;
                  return (
                    <View key={e.key}>
                      {i > 0 && <Divider />}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Shows the details"
                        onPress={() => setSelected(e)}
                        style={({ pressed }) => [styles.entry, pressed && { backgroundColor: colors.surfaceMuted }]}
                      >
                        <View style={[styles.entryIcon, { backgroundColor: tint.soft }]}>
                          <Icon name={KIND_META[e.kind].icon} size={18} color={tint.ink} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.entryTitle} numberOfLines={1}>{outflowTitle(e)}</Text>
                          <Text style={type.caption} numberOfLines={1}>
                            {company ? `${company} · ` : ''}{outflowSubtitle(e, goalNames)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                          <Text style={[styles.entryAmount, e.kind === 'savings_return' && { color: colors.ok }]}>
                            {e.kind === 'savings_return' ? '+' : ''}{formatMoney(e.amount).replace(/\.00$/, '')}
                          </Text>
                          {e.syncStatus && e.syncStatus !== 'synced' ? (
                            <Text style={styles.pending}>Not synced</Text>
                          ) : e.auto ? (
                            <Text style={styles.auto}>Auto</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </ListCard>
            </View>
          ))
        )}
        {visible.length > shown && (
          <Button title={`Show ${Math.min(PAGE, visible.length - shown)} more`} variant="secondary" height={46} onPress={() => setShown(shown + PAGE)} />
        )}
      </ScrollView>

      <View style={[styles.fabWrap, { bottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          onPress={() => setRecording({})}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        >
          <Icon name="plus" size={20} color="#FFFFFF" strokeWidth={2.2} />
          <Text style={styles.fabText}>{isCompanyAdmin ? 'Record money out' : 'Record expense'}</Text>
        </Pressable>
      </View>

      <RecordOutflowSheet
        visible={!!recording}
        initial={recording}
        onClose={() => setRecording(null)}
        onSaved={afterSave}
        user={user}
        isCompanyAdmin={isCompanyAdmin}
        goals={(savings?.goals || []).filter((g) => g.isActive)}
        recentCategories={recent}
      />

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title={selected ? formatMoney(selected.amount) : ''} description={selected ? outflowTitle(selected) : undefined}>
        {selected && (
          <>
            <View style={{ gap: 10 }}>
              <KV label="Kind" value={KIND_META[selected.kind].label} />
              {selected.outflow?.clientGoalId ? <KV label="Goal" value={goalNames.get(selected.outflow.clientGoalId) || 'Savings goal'} /> : null}
              {selected.outflow?.category ? <KV label={KIND_META[selected.kind].categoryLabel || 'Category'} value={selected.outflow.category} /> : null}
              <KV label="Date" value={`${formatDate(selected.occurredAt)}, ${formatTime(selected.occurredAt)}`} />
              {!selected.auto && <KV label="Paid with" value={selected.outflow.paymentMethod === 'transfer' ? 'Transfer' : 'Cash'} />}
              {selected.outflow?.note && selected.outflow.note !== outflowTitle(selected) ? <KV label="Note" value={selected.outflow.note} /> : null}
              {isRepeating(selected.outflow) ? <Pill kind="primary" icon="calendar" label="Repeats every month" /> : null}
              {selected.auto ? <Text style={type.small}>Added from a stock-in on the Inventory screen. Change it there if the cost is wrong.</Text> : null}
            </View>
            {canEdit(selected) && (
              <View style={{ gap: 10 }}>
                {(selected.kind === 'expense' || selected.kind === 'loan' || selected.kind === 'tax') && (
                  <Button
                    title={isRepeating(selected.outflow) ? 'Stop monthly reminder' : 'Remind me every month'}
                    variant="secondary"
                    icon="calendar"
                    height={48}
                    onPress={() => changeSelected({ repeatsMonthly: !isRepeating(selected.outflow) })}
                  />
                )}
                <Button title="Delete entry" variant="danger" icon="trash" height={48} onPress={confirmDelete} />
              </View>
            )}
            <Button title="Close" variant="ghost" height={44} onPress={() => setSelected(null)} />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 14 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  total: { flexShrink: 1, fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, backgroundColor: colors.track },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  breakLabel: { flex: 1, fontSize: 14 },
  breakValue: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  breakPct: { width: 38, textAlign: 'right', fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },
  savingsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.okSoft, borderWidth: 1, borderColor: '#BFE0CC',
  },
  savingsTitle: { fontFamily: fonts.semibold, fontSize: 15, color: '#0F5434' },
  chipScroll: { marginHorizontal: -20 },
  chips: { paddingHorizontal: 20, gap: 8 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginTop: 4 },
  dayLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink3, fontVariant: ['tabular-nums'] },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 62 },
  entryIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { fontFamily: fonts.semibold, fontSize: 14.5 },
  entryAmount: { fontFamily: fonts.semibold, fontSize: 14.5, fontVariant: ['tabular-nums'] },
  auto: { fontFamily: fonts.medium, fontSize: 11, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  pending: { fontFamily: fonts.medium, fontSize: 11, color: colors.warn },
  fabWrap: { position: 'absolute', right: 20, left: 20, alignItems: 'flex-end' },
  fab: {
    height: 54, paddingLeft: 16, paddingRight: 20, borderRadius: 18, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', gap: 8, ...shadow.primary,
  },
  fabText: { fontFamily: fonts.semibold, fontSize: 15, color: '#FFFFFF' },
});
