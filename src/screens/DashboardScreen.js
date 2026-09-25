import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLocalItems, getLastSyncedAt } from '../db/localDb';
import { isLowStock } from '../utils/inventory';

// RPT-06: Main Company dashboard. If there are no linked Sub Companies, this simply shows
// an empty state below — a standalone company (ROLE-07) is not treated as an error state.
export default function DashboardScreen({ navigation }) {
  const { user } = useAuth();
  const [subCompanies, setSubCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ subCompanies: subs }, summaryResp] = await Promise.all([
          api.getMyCompany(),
          api.getOversightSummary(),
        ]);
        setSubCompanies(subs);
        setSummary(summaryResp);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // INV-05: own-company low-stock count only — not aggregated across Sub Companies.
  useFocusEffect(
    useCallback(() => {
      setLowStockCount(getLocalItems(user.companyId).filter(isLowStock).length);
    }, [user.companyId])
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  const lastSynced = getLastSyncedAt(user.id);
  const lastSyncedLabel = lastSynced
    ? `Data last synced: ${new Date(lastSynced).toLocaleString()}`
    : 'Not yet synced';

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Company Overview</Text>

      {summary && (
        <View style={styles.summaryCard}>
          <SummaryRow label="Total items" value={String(summary.totals.itemCount)} />
          <SummaryRow
            label="Low stock"
            value={String(summary.totals.lowStockCount)}
            valueStyle={summary.totals.lowStockCount > 0 && styles.negative}
          />
          <SummaryRow label="Total sales revenue" value={formatMoney(summary.totals.totalSalesRevenue)} />
          <SummaryRow label="Total purchase cost" value={formatMoney(summary.totals.totalPurchaseCost)} />
          <SummaryRow
            label="Total margin"
            value={formatMoney(summary.totals.margin)}
            valueStyle={summary.totals.margin >= 0 ? styles.positive : styles.negative}
          />
          <Text style={styles.syncText}>{lastSyncedLabel}</Text>
        </View>
      )}

      <View style={styles.ownLinksRow}>
        <TouchableOpacity style={styles.ownLink} onPress={() => navigation.navigate('Inventory')}>
          <Text style={styles.ownLinkText}>My Inventory</Text>
          {lowStockCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{lowStockCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.ownLink} onPress={() => navigation.navigate('Reports')}>
          <Text style={styles.ownLinkText}>Reports</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ownLink} onPress={() => navigation.navigate('AuditLog')}>
          <Text style={styles.ownLinkText}>Audit Log</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ownLink} onPress={() => navigation.navigate('ManageSubCompanies')}>
          <Text style={styles.ownLinkText}>Manage Sub Companies</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ownLink} onPress={() => navigation.navigate('CompareSubCompanies')}>
          <Text style={styles.ownLinkText}>Compare Companies</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>Could not load Sub Companies (are you offline?): {error}</Text>}

      {subCompanies.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No Sub Companies linked yet</Text>
          <Text style={styles.emptyText}>
            You're using this app as a standalone company — everything below works the same
            whether or not you ever link a Sub Company.
          </Text>
        </View>
      ) : (
        <FlatList
          data={subCompanies}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <View style={styles.subCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subName}>{item.name}</Text>
                <Text style={styles.subMeta}>{item.isActive ? 'Active' : 'Deactivated'}</Text>
              </View>
              <View style={styles.subLinks}>
                <TouchableOpacity onPress={() => navigation.navigate('Inventory', { companyId: item.id, companyName: item.name })}>
                  <Text style={styles.subLinkText}>Inventory</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('Reports', { companyId: item.id, companyName: item.name })}>
                  <Text style={styles.subLinkText}>Reports</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => navigation.navigate('AuditLog', { companyId: item.id, companyName: item.name })}>
                  <Text style={styles.subLinkText}>Audit</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

function SummaryRow({ label, value, valueStyle }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryRowLabel}>{label}</Text>
      <Text style={[styles.summaryRowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

function formatMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 16 },
  ownLinksRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  ownLink: {
    flex: 1, backgroundColor: '#eef2fd', borderRadius: 8, padding: 10, alignItems: 'center',
    position: 'relative',
  },
  ownLinkText: { color: '#2f6fed', fontWeight: '600', fontSize: 12 },
  badge: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#d9534f', borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  summaryCard: { backgroundColor: '#f4f6fb', borderRadius: 10, padding: 14, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryRowLabel: { color: '#666', fontSize: 13 },
  summaryRowValue: { fontWeight: '600', fontSize: 13 },
  positive: { color: '#2e9c4c' },
  negative: { color: '#d9534f' },
  syncText: { fontSize: 11, color: '#999', marginTop: 8 },
  error: { color: '#d9534f', marginBottom: 12 },
  emptyBox: { padding: 16, backgroundColor: '#f4f6fb', borderRadius: 10 },
  emptyTitle: { fontWeight: '600', marginBottom: 6 },
  emptyText: { color: '#666', fontSize: 13, lineHeight: 18 },
  subCard: {
    padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  subLinks: { flexDirection: 'row', gap: 12 },
  subLinkText: { color: '#2f6fed', fontWeight: '600', fontSize: 12 },
  subName: { fontSize: 16, fontWeight: '600' },
  subMeta: { color: '#888' },
});
