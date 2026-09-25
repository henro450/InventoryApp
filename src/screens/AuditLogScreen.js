import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLastSyncedAt } from '../db/localDb';

const ACTIONS = ['create', 'update', 'delete'];

// AUD-03/AUD-04: read-only audit log view with filters. Sub Company sees only its own log;
// Main Company can pass a companyId (e.g. a linked Sub Company) to view that company's log
// instead — reuses the existing Dashboard drill-down navigation for "which company," rather
// than a second in-screen company switcher.
// There is intentionally no edit or delete action anywhere on this screen (AUD-02).
export default function AuditLogScreen({ route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const lastSynced = getLastSyncedAt(user.id);
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  const [baseLogs, setBaseLogs] = useState([]);
  const [displayLogs, setDisplayLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [actionFilter, setActionFilter] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [dateError, setDateError] = useState(null);

  async function loadUnfiltered() {
    setLoading(true);
    setError(null);
    try {
      const { logs } = await api.getAuditLogs(companyId);
      setBaseLogs(logs);
      setDisplayLogs(logs);
      setActionFilter(null);
      setSelectedUserId(null);
      setFromInput('');
      setToInput('');
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

  async function handleApplyFilters() {
    if (fromInput && isNaN(Date.parse(fromInput))) {
      setDateError('Invalid "from" date — use YYYY-MM-DD');
      return;
    }
    if (toInput && isNaN(Date.parse(toInput))) {
      setDateError('Invalid "to" date — use YYYY-MM-DD');
      return;
    }
    setDateError(null);
    try {
      const { logs } = await api.getAuditLogs(companyId, {
        userId: selectedUserId,
        action: actionFilter,
        from: fromInput.trim(),
        to: toInput.trim(),
      });
      setDisplayLogs(logs);
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleAction(a) {
    setActionFilter((cur) => (cur === a ? null : a));
  }

  function toggleUser(userId) {
    setSelectedUserId((cur) => (cur === userId ? null : userId));
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {companyLabel && (
        <Text style={styles.syncLabel}>{companyLabel} — {lastSyncedLabel}</Text>
      )}

      {error && (
        <Text style={styles.error}>Audit log requires connectivity to load — {error}</Text>
      )}

      <TouchableOpacity onPress={loadUnfiltered} style={styles.refreshButton}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>

      <View style={styles.filterCard}>
        <Text style={styles.filterLabel}>Action</Text>
        <View style={styles.chipRow}>
          {ACTIONS.map((a) => (
            <TouchableOpacity
              key={a}
              style={[styles.filterChip, actionFilter === a && styles.filterChipActive]}
              onPress={() => toggleAction(a)}
            >
              <Text style={[styles.filterChipText, actionFilter === a && styles.filterChipTextActive]}>
                {a}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {availableUsers.length > 0 && (
          <>
            <Text style={styles.filterLabel}>User</Text>
            <View style={styles.chipRow}>
              {availableUsers.map(({ userId, role }) => (
                <TouchableOpacity
                  key={userId}
                  style={[styles.filterChip, selectedUserId === userId && styles.filterChipActive]}
                  onPress={() => toggleUser(userId)}
                >
                  <Text style={[styles.filterChipText, selectedUserId === userId && styles.filterChipTextActive]}>
                    User #{userId}{role ? ` (${role})` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={styles.filterLabel}>From (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={fromInput} onChangeText={setFromInput} placeholder="Optional" />

        <Text style={styles.filterLabel}>To (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} value={toInput} onChangeText={setToInput} placeholder="Optional" />

        {dateError && <Text style={styles.error}>{dateError}</Text>}

        <TouchableOpacity style={styles.applyButton} onPress={handleApplyFilters}>
          <Text style={styles.applyButtonText}>Apply Filters</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={displayLogs}
        keyExtractor={(log) => String(log.id)}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty}>No audit activity yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text style={styles.entityType}>
                {item.action.toUpperCase()} · {item.entityType} #{item.entityId}
              </Text>
              <Text style={styles.timestamp}>{new Date(item.occurredAt).toLocaleString()}</Text>
            </View>
            <Text style={styles.meta}>
              User #{item.userId}{item.role ? ` (${item.role})` : ''} · Company #{item.companyId}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#d9534f', padding: 16, fontSize: 13 },
  refreshButton: { alignSelf: 'flex-end', marginRight: 16, marginTop: 8 },
  syncLabel: { fontSize: 11, color: '#999', margin: 16, marginBottom: 0 },
  refreshText: { color: '#2f6fed', fontWeight: '600' },
  filterCard: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 12, margin: 16, marginBottom: 0 },
  filterLabel: { fontSize: 12, color: '#666', marginBottom: 6, marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { backgroundColor: '#eef2fd', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  filterChipActive: { backgroundColor: '#2f6fed' },
  filterChipText: { color: '#2f6fed', fontWeight: '600', fontSize: 12 },
  filterChipTextActive: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fff' },
  applyButton: { backgroundColor: '#2f6fed', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12 },
  applyButtonText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
  entry: {
    borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 12, marginBottom: 10,
  },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  entityType: { fontWeight: '600', fontSize: 13 },
  timestamp: { fontSize: 11, color: '#999' },
  meta: { fontSize: 12, color: '#777' },
});
