import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TextInput, Alert, Pressable, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { setLocalCompanyThreshold } from '../db/localDb';
import { getAlerts } from '../reports/localReports';
import { runSync } from '../sync/syncEngine';
import { useLocalRefresh } from '../hooks/useLocalRefresh';
import LocalDataNotice from '../components/LocalDataNotice';
import { formatDate, formatMoney, formatPercent } from '../utils/format';
import Icon from '../components/Icon';
import {
  Text, Screen, NavHeader, LargeHeader, IconButton, SectionTitle, CountBadge, ListCard, Card, Divider, Pill,
  Button, InlineEmpty, Loading, AccountButton,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

// Low stock and price anomalies, computed from this phone's items and transaction history (so
// they work offline and include unsynced stock changes). Only saving the anomaly threshold
// needs a connection, since it's a company setting stored on the server.
export default function AlertsScreen({ route, navigation }) {
  const { user, logout } = useAuth();
  const companyId = route?.params?.companyId || user.companyId;
  const companyLabel = route?.params?.companyName;
  const isOwnCompany = companyId === user.companyId;
  const asTab = !!route?.params?.asTab;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [priceAnomalies, setPriceAnomalies] = useState([]);
  const [thresholdPercent, setThresholdPercent] = useState(20);
  const [thresholdInput, setThresholdInput] = useState('20');
  const [savingThreshold, setSavingThreshold] = useState(false);

  function load({ keepInput = false } = {}) {
    const data = getAlerts(companyId);
    setLowStockItems(data.lowStockItems);
    setPriceAnomalies(data.priceAnomalies);
    setThresholdPercent(data.thresholdPercent);
    if (!keepInput) setThresholdInput(String(data.thresholdPercent));
    setLoading(false);
  }

  // Background syncs refresh the lists without wiping a threshold the user is typing.
  useLocalRefresh(() => load({ keepInput: true }));

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    load();
    setRefreshing(false);
  }

  async function handleSaveThreshold() {
    const value = Number(thresholdInput);
    if (isNaN(value) || value < 0) {
      Alert.alert('Invalid value', 'Threshold must be a non-negative number.');
      return;
    }
    setSavingThreshold(true);
    try {
      await api.updateAlertSettings({ priceAnomalyThresholdPercent: value });
      setLocalCompanyThreshold(companyId, value);
      load();
    } catch (err) {
      Alert.alert(
        'Could not save',
        err.status ? err.message : 'The threshold is saved on the server. Connect to the internet and try again.'
      );
    } finally {
      setSavingThreshold(false);
    }
  }

  // Low-stock rows are the local item rows themselves; "Restock" records a transaction, so it's
  // only offered for the user's own company.

  const header = asTab ? (
    <LargeHeader eyebrow="Sub company" title="Alerts" right={<AccountButton user={user} onLogout={logout} />} />
  ) : (
    <NavHeader title={companyLabel ? `${companyLabel} alerts` : 'Alerts'} right={<IconButton icon="sync" label="Refresh alerts" variant="ghost" onPress={handleRefresh} />} />
  );

  if (loading) {
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
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <LocalDataNotice user={user} onSynced={load} />

        <SectionTitle title="Low stock" badge={<CountBadge count={lowStockItems.length} kind="danger" />} />
        {lowStockItems.length === 0 ? (
          <Card>
            <View style={styles.allGood}>
              <Icon name="check" size={18} color={colors.ok} strokeWidth={2.2} />
              <Text style={type.small}>No items are currently low on stock.</Text>
            </View>
          </Card>
        ) : (
          <ListCard style={{ marginTop: -6 }}>
            {lowStockItems.map((item, i) => {
              const local = isOwnCompany ? item : null;
              return (
                <View key={item.localId}>
                  {i > 0 && <Divider />}
                  <View style={styles.lowRow}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={type.small}>
                        <Text style={styles.lowQty}>
                          {item.quantityOnHand} {item.unit} left
                        </Text>{' '}
                        · alert at {item.lowStockThreshold}
                      </Text>
                    </View>
                    {local && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Restock ${item.name}`}
                        onPress={() => navigation.navigate('StockTransaction', { item: local })}
                        style={styles.restock}
                      >
                        <Text style={styles.link}>Restock</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </ListCard>
        )}

        <SectionTitle title="Price anomalies" badge={<CountBadge count={priceAnomalies.length} kind="warn" />} />
        <Text style={[type.small, { marginTop: -10 }]}>Purchases more than {thresholdPercent}% away from the previous price.</Text>
        {priceAnomalies.length === 0 ? (
          <Card>
            <View style={styles.allGood}>
              <Icon name="check" size={18} color={colors.ok} strokeWidth={2.2} />
              <Text style={type.small}>No price anomalies detected.</Text>
            </View>
          </Card>
        ) : (
          priceAnomalies.map((a, idx) => (
            <Card key={`${a.itemId}-${a.effectiveDate}-${idx}`} gap={10} padding={16}>
              <View style={styles.anomalyTop}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.itemName}>{a.itemName || 'Unknown item'}</Text>
                  <Text style={type.caption}>Purchase on {formatDate(a.effectiveDate)}</Text>
                </View>
                <Pill kind={a.deviationPercent > 0 ? 'danger' : 'warn'} label={formatPercent(a.deviationPercent)} />
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.prevPrice}>{formatMoney(a.previousPrice)}</Text>
                <Icon name="chev" size={16} color={colors.chevron} />
                <Text style={styles.newPrice}>{formatMoney(a.newPrice)}</Text>
                <Text style={type.caption}>per unit</Text>
              </View>
            </Card>
          ))
        )}

        {isOwnCompany && (
          <View style={styles.threshold}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.itemName}>Anomaly threshold</Text>
              <Text style={type.caption}>Flag purchases that differ by more than this.</Text>
            </View>
            <View style={styles.thresholdInputBox}>
              <TextInput
                value={thresholdInput}
                onChangeText={setThresholdInput}
                keyboardType="numeric"
                placeholder="20"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel="Anomaly threshold percent"
                style={styles.thresholdInput}
              />
              <Text style={styles.percent}>%</Text>
            </View>
            <Button title="Save" variant="dark" height={44} onPress={handleSaveThreshold} loading={savingThreshold} />
          </View>
        )}
        {!isOwnCompany && <InlineEmpty>Only the company itself can change its anomaly threshold.</InlineEmpty>}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 16 },
  allGood: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lowRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 6, minHeight: 60 },
  itemName: { fontFamily: fonts.semibold, fontSize: 15 },
  lowQty: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },
  restock: { height: 44, paddingHorizontal: 12, justifyContent: 'center' },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  anomalyTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  prevPrice: { fontSize: 14, color: colors.ink3, textDecorationLine: 'line-through' },
  newPrice: { fontFamily: fonts.semibold, fontSize: 16, fontVariant: ['tabular-nums'] },
  threshold: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 16, paddingRight: 8,
    borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CFCBC1',
  },
  thresholdInputBox: {
    height: 44, width: 76, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10,
  },
  thresholdInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, textAlign: 'right', paddingVertical: 0 },
  percent: { fontSize: 15, color: colors.ink3, marginLeft: 2 },
});
