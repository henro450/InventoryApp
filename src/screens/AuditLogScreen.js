import React, { useEffect, useMemo, useState } from 'react';
import { View, SectionList, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';
import { ROLES } from '../constants/roles';
import { formatDate, formatMoney, formatTime, lastSyncedLabel } from '../utils/format';
import Icon from '../components/Icon';
import {
  Text, Screen, LargeHeader, NavHeader, IconButton, Chip, Card, Field, Button, Banner, EmptyState, Loading,
  CompanySwitcher, ReadOnlyBanner,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const ACTIONS = ['create', 'update', 'delete'];
const ACTION_STYLE = {
  create: { bg: colors.okSoft, fg: colors.ok, icon: 'plus', verb: 'created' },
  update: { bg: colors.primarySoft, fg: colors.primary, icon: 'pencil', verb: 'updated' },
  delete: { bg: colors.dangerSoft, fg: colors.danger, icon: 'trash', verb: 'deleted' },
};
// Bookkeeping fields that change on every write and would only add noise to a diff.
const IGNORED_FIELDS = new Set(['updatedAt', 'createdAt', 'version', 'syncStatus', 'userId', 'id', 'companyId', 'localId', 'clientItemId']);

function parse(json) {
  if (!json) return null;
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}

function roleLabel(role) {
  if (role === ROLES.MAIN) return 'Main company';
  if (role === ROLES.SUB) return 'Sub company';
  return role || null;
}

function humanize(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

function show(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

// Turn a raw audit row into something readable: what it was about, and what changed.
function describe(log) {
  const oldV = parse(log.oldValue);
  const newV = parse(log.newValue);
  const snapshot = newV || oldV || {};
  const subject = snapshot.name || snapshot.itemName || snapshot.companyName || `${humanize(log.entityType || 'Record')} #${log.entityId}`;

  let detail = null;
  if (log.action === 'update' && oldV && newV) {
    const changes = Object.keys(newV)
      .filter((k) => !IGNORED_FIELDS.has(k) && typeof newV[k] !== 'object' && show(oldV[k]) !== show(newV[k]))
      .slice(0, 3)
      .map((k) => `${humanize(k)}: ${show(oldV[k])} → ${show(newV[k])}`);
    if (changes.length) detail = changes.join('\n');
  } else if (log.action === 'create' && newV && newV.type && newV.quantity != null) {
    const kind = newV.type === 'in' ? 'Stock in' : newV.type === 'out' ? 'Stock out' : 'Adjustment';
    detail = `${kind} · ${newV.quantity}${newV.unitPrice != null && newV.type !== 'adjustment' ? ` × ${formatMoney(newV.unitPrice)}` : ''}`;
  }
  return { subject, detail };
}

function dayKey(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDate(iso);
}

// AUD-03/AUD-04: read-only audit log view with filters. Sub Company sees only its own log;
// Main Company can pass a companyId (e.g. a linked Sub Company) to view that company's log
// instead — reuses the existing Dashboard drill-down navigation for "which company," rather
// than a second in-screen company switcher.
// There is intentionally no edit or delete action anywhere on this screen (AUD-02).
export default function AuditLogScreen({ route }) {
  const { user, isMainCompany } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const isOwnCompany = companyId === user.companyId;
  const lastSynced = getLastSyncedAt(user.id);

  const [baseLogs, setBaseLogs] = useState([]);
  const [displayLogs, setDisplayLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [actionFilter, setActionFilter] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [datesOpen, setDatesOpen] = useState(false);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [appliedDates, setAppliedDates] = useState({ from: '', to: '' });
  const [dateError, setDateError] = useState(null);

  async function loadUnfiltered() {
    setError(null);
    try {
      const { logs } = await api.getAuditLogs(companyId);
      setBaseLogs(logs);
      setDisplayLogs(logs);
      setActionFilter(null);
      setSelectedUserId(null);
      setFromInput('');
      setToInput('');
      setAppliedDates({ from: '', to: '' });
      setDateError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUnfiltered();
  }, [companyId]);

  async function handleRefresh() {
    setRefreshing(true);
    await loadUnfiltered();
    setRefreshing(false);
  }

  // AUD-04: derived from the initial unfiltered load only, never recomputed from the currently
  // filtered displayLogs — otherwise applying e.g. an action filter would shrink the roster to
  // only users who happened to match it, making it impossible to then pivot to a user who's
  // never done that action. Keeping it keyed to baseLogs keeps every user who's appeared in
  // this company's log available as a filter target regardless of what else is applied.
  const availableUsers = useMemo(() => {
    const map = new Map();
    for (const log of baseLogs) {
      if (!map.has(log.userId)) map.set(log.userId, log.role || null);
    }
    return Array.from(map, ([userId, role]) => ({ userId, role }));
  }, [baseLogs]);

  // Chips apply immediately; dates apply from their panel.
  async function applyFilters({ action = actionFilter, userId = selectedUserId, from = appliedDates.from, to = appliedDates.to } = {}) {
    try {
      const { logs } = await api.getAuditLogs(companyId, { userId, action, from, to });
      setDisplayLogs(logs);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleAction(a) {
    const next = actionFilter === a ? null : a;
    setActionFilter(next);
    applyFilters({ action: next });
  }

  function toggleUser(userId) {
    const next = selectedUserId === userId ? null : userId;
    setSelectedUserId(next);
    applyFilters({ userId: next });
  }

  function handleApplyDates() {
    if (fromInput && isNaN(Date.parse(fromInput))) {
      setDateError('Invalid "from" date — use YYYY-MM-DD');
      return;
    }
    if (toInput && isNaN(Date.parse(toInput))) {
      setDateError('Invalid "to" date — use YYYY-MM-DD');
      return;
    }
    setDateError(null);
    const dates = { from: fromInput.trim(), to: toInput.trim() };
    setAppliedDates(dates);
    setDatesOpen(false);
    applyFilters(dates);
  }

  function clearDates() {
    setFromInput('');
    setToInput('');
    setAppliedDates({ from: '', to: '' });
    applyFilters({ from: '', to: '' });
  }

  const sections = useMemo(() => {
    const groups = [];
    const index = new Map();
    for (const log of displayLogs) {
      const key = dayKey(log.occurredAt);
      if (!index.has(key)) {
        index.set(key, groups.length);
        groups.push({ title: key, data: [] });
      }
      groups[index.get(key)].data.push(log);
    }
    return groups;
  }, [displayLogs]);

  const header = isOwnCompany ? (
    <LargeHeader
      eyebrow={isMainCompany ? 'Main company' : 'Sub company'}
      title="Audit log"
      right={<IconButton icon="sync" label="Refresh audit log" onPress={handleRefresh} />}
    />
  ) : (
    <>
      <NavHeader title={companyLabel || 'Sub Company'} />
      <View style={styles.readOnlyWrap}>
        <ReadOnlyBanner subtitle={lastSyncedLabel(lastSynced)} />
        <CompanySwitcher active="audit" params={{ companyId, companyName: companyLabel }} />
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

  const dateLabel = appliedDates.from || appliedDates.to ? `${appliedDates.from || 'Start'} – ${appliedDates.to || 'Today'}` : 'Any date';

  const filters = (
    <View style={styles.filters}>
      {error && <Banner kind="error" title="Audit log needs a connection" subtitle={error} actionLabel="Retry" onAction={handleRefresh} />}
      <View style={styles.chipRow} accessibilityLabel="Action">
        <Chip label="All" active={!actionFilter} onPress={() => actionFilter && toggleAction(actionFilter)} />
        {ACTIONS.map((a) => (
          <Chip key={a} label={a.charAt(0).toUpperCase() + a.slice(1)} active={actionFilter === a} onPress={() => toggleAction(a)} />
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hChips}>
        <Chip
          label={dateLabel}
          icon="calendar"
          active={datesOpen}
          onPress={() => setDatesOpen((o) => !o)}
          onClear={appliedDates.from || appliedDates.to ? clearDates : undefined}
        />
        {availableUsers.map(({ userId, role }) => (
          <Chip
            key={userId}
            icon="user"
            label={`User #${userId}${roleLabel(role) ? ` · ${roleLabel(role)}` : ''}`}
            active={selectedUserId === userId}
            onPress={() => toggleUser(userId)}
          />
        ))}
      </ScrollView>
      {datesOpen && (
        <Card padding={16} gap={12}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field style={{ flex: 1 }} label="From" value={fromInput} onChangeText={setFromInput} placeholder="YYYY-MM-DD" />
            <Field style={{ flex: 1 }} label="To" value={toInput} onChangeText={setToInput} placeholder="YYYY-MM-DD" />
          </View>
          {dateError && <Text style={styles.error}>{dateError}</Text>}
          <Button title="Apply dates" variant="dark" height={48} onPress={handleApplyDates} />
        </Card>
      )}
    </View>
  );

  return (
    <Screen>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(log) => String(log.id)}
        ListHeaderComponent={filters}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        ListEmptyComponent={<EmptyState icon="list" title="No audit activity yet" body="Creates, updates and deletes will show up here." />}
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        renderItem={({ item, index, section }) => (
          <Entry log={item} first={index === 0} last={index === section.data.length - 1} />
        )}
      />
    </Screen>
  );
}

function Entry({ log, first, last }) {
  const s = ACTION_STYLE[log.action] || ACTION_STYLE.update;
  const { subject, detail } = describe(log);
  const role = roleLabel(log.role);
  return (
    <View style={[styles.entry, first && styles.entryFirst, last && styles.entryLast, !first && styles.entryDivider]}>
      <View style={[styles.badge, { backgroundColor: s.bg }]}>
        <Icon name={s.icon} size={18} color={s.fg} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.sentence}>
          <Text style={styles.strong}>User #{log.userId}</Text> {s.verb} <Text style={styles.strong}>{subject}</Text>
        </Text>
        <Text style={type.caption}>
          {humanize(log.entityType || 'Record')} · {formatTime(log.occurredAt)}
          {role ? ` · ${role}` : ''}
        </Text>
        {detail ? (
          <View style={styles.detail}>
            <Text style={styles.detailText}>{detail}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readOnlyWrap: { paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12, gap: 14 },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
  filters: { gap: 12, paddingBottom: 4 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  hScroll: { marginHorizontal: -20, flexGrow: 0 },
  hChips: { paddingHorizontal: 20, gap: 8 },
  error: { fontSize: 12, color: colors.danger, fontFamily: fonts.medium },
  day: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.ink3, marginTop: 18, marginBottom: 8 },
  entry: {
    flexDirection: 'row', gap: 12, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.surface,
    borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line,
  },
  entryFirst: { borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  entryLast: { borderBottomWidth: 1, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  entryDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sentence: { fontSize: 14, lineHeight: 20, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  detail: { alignSelf: 'flex-start', backgroundColor: colors.ground, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  detailText: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 17, color: colors.ink2 },
});
