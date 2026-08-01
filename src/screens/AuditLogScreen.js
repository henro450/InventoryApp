import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

// AUD-03/AUD-04: read-only audit log view. Sub Company sees only its own log; Main Company
// can pass a companyId (e.g. a linked Sub Company) to view that company's log instead.
// There is intentionally no edit or delete action anywhere on this screen (AUD-02).
export default function AuditLogScreen({ route }) {
  const { user } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { logs: fetched } = await api.getAuditLogs(companyId);
        setLogs(fetched);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && (
        <Text style={styles.error}>Audit log requires connectivity to load — {error}</Text>
      )}
      <FlatList
        data={logs}
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
            <Text style={styles.meta}>User #{item.userId} · Company #{item.companyId}</Text>
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
  empty: { textAlign: 'center', color: '#999', marginTop: 40 },
  entry: {
    borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 12, marginBottom: 10,
  },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  entityType: { fontWeight: '600', fontSize: 13 },
  timestamp: { fontSize: 11, color: '#999' },
  meta: { fontSize: 12, color: '#777' },
});
