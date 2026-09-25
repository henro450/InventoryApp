import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getLocalItems, getLastSyncedAt, getSyncStatusSummary } from '../db/localDb';
import { runSync } from '../sync/syncEngine';
import { isLowStock } from '../utils/inventory';
import { formatMoney, formatNumber, lastSyncedLabel, plural, timeAgo } from '../utils/format';
import Icon from '../components/Icon';
import {
  Text, Screen, LargeHeader, IconButton, AccountButton, Pill, Banner, SectionTitle, ListCard, Divider,
  LetterTile, EmptyState, Loading,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

// RPT-06: Main Company dashboard. If there are no linked Sub Companies, this simply shows
// an empty state below — a standalone company (ROLE-07) is not treated as an error state.
export default function DashboardScreen({ navigation }) {
  const { user, logout, allowSubCompanies } = useAuth();
  const [subCompanies, setSubCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [syncSummary, setSyncSummary] = useState({ total: 0 });
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [{ subCompanies: subs }, summaryResp] = await Promise.all([api.getMyCompany(), api.getOversightSummary()]);
      setSubCompanies(subs);
      setSummary(summaryResp);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // INV-05: own-company low-stock count only — not aggregated across Sub Companies.
  useFocusEffect(
    useCallback(() => {
      setLowStockCount(getLocalItems(user.companyId).filter(isLowStock).length);
      setSyncSummary(getSyncStatusSummary(user.id));
    }, [user.companyId, user.id])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await runSync(user.id);
    await load();
    setSyncSummary(getSyncStatusSummary(user.id));
    setLowStockCount(getLocalItems(user.companyId).filter(isLowStock).length);
    setRefreshing(false);
  }

  if (loading) return <Loading />;

  const totals = summary?.totals;
  const ownRow = summary?.companies?.find((c) => c.isMain);
  const statsById = new Map((summary?.companies || []).map((c) => [String(c.companyId), c]));
  const lastSynced = getLastSyncedAt(user.id);
  const marginShare = totals && totals.totalSalesRevenue > 0 ? (totals.margin / totals.totalSalesRevenue) * 100 : null;

  return (
    <Screen>
      <LargeHeader
        eyebrow={`${ownRow?.companyName || 'Your company'} · Main company`}
        title="Overview"
        right={
          <>
            <IconButton icon="bell" label="Alerts" dot={lowStockCount > 0} onPress={() => navigation.navigate('Alerts')} />
            <AccountButton user={user} onLogout={logout} />
          </>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        <View style={styles.syncRow}>
          {syncSummary.total > 0 ? (
            <Pill kind="warn" icon="sync" label={`${plural(syncSummary.total, 'change')} waiting to sync`} />
          ) : (
            <Pill kind="ok" icon="check" label={lastSynced ? `All synced · ${timeAgo(lastSynced)}` : 'Not yet synced'} />
          )}
          <Text style={type.caption}>Pull down to refresh</Text>
        </View>

        {error && (
          <Banner kind="error" icon="alert" title="Couldn't load company data" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={load} />
        )}

        {totals && (
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>Total margin · all companies</Text>
              {marginShare != null && <Text style={styles.heroShare}>{marginShare.toFixed(1)}% of sales</Text>}
            </View>
            <Text style={[styles.heroValue, totals.margin < 0 && { color: '#FFB4AB' }]} adjustsFontSizeToFit numberOfLines={1}>
              {formatMoney(totals.margin)}
            </Text>
            <View style={styles.heroDivider} />
            <View style={styles.heroStats}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.heroStatLabel}>Sales revenue</Text>
                <Text style={styles.heroStatValue}>{formatMoney(totals.totalSalesRevenue)}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.heroStatLabel}>Purchase cost</Text>
                <Text style={styles.heroStatValue}>{formatMoney(totals.totalPurchaseCost)}</Text>
              </View>
            </View>
            <Text style={styles.heroSync}>{lastSyncedLabel(lastSynced)}</Text>
          </View>
        )}

        {totals && (
          <View style={styles.tiles}>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Inventory')} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
              <View style={styles.tileLabelRow}>
                <Icon name="box" size={18} color={colors.ink3} />
                <Text style={styles.tileLabel}>Total items</Text>
              </View>
              <Text style={styles.tileValue}>{formatNumber(totals.itemCount)}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Alerts')}
              style={({ pressed }) => [styles.tile, totals.lowStockCount > 0 && styles.tileDanger, pressed && styles.pressed]}
            >
              <View style={styles.tileLabelRow}>
                <Icon name="alert" size={18} color={totals.lowStockCount > 0 ? colors.danger : colors.ink3} />
                <Text style={[styles.tileLabel, totals.lowStockCount > 0 && { color: colors.danger }]}>Low stock</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={[styles.tileValue, totals.lowStockCount > 0 && { color: colors.danger }]}>{formatNumber(totals.lowStockCount)}</Text>
                <Text style={[styles.tileHint, totals.lowStockCount > 0 && { color: colors.danger }]}>
                  {lowStockCount} {lowStockCount === 1 ? 'is' : 'are'} yours
                </Text>
              </View>
            </Pressable>
          </View>
        )}

        {/* A company the SuperAdmin set up without Sub Companies doesn't see this section at all;
            if the option is turned off later, existing Sub Companies stay viewable. */}
        {(allowSubCompanies || subCompanies.length > 0) && (
          <>
            <SectionTitle
              title="Sub companies"
              right={
                allowSubCompanies && (
                  <View style={{ flexDirection: 'row' }}>
                    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CompareSubCompanies')} style={styles.headerLink}>
                      <Text style={styles.link}>Compare</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ManageSubCompanies')} style={styles.headerLink}>
                      <Text style={styles.link}>Manage</Text>
                    </Pressable>
                  </View>
                )
              }
            />

            {subCompanies.length === 0 ? (
              <ListCard>
                <EmptyState
                  icon="building"
                  title="No Sub Companies linked yet"
                  body="You're using this app as a standalone company. Everything works the same whether or not you ever link a Sub Company."
                />
              </ListCard>
            ) : (
              <ListCard style={{ marginTop: -8 }}>
                {subCompanies.map((c, i) => {
                  const stats = statsById.get(String(c.id));
                  return (
                    <View key={String(c.id)}>
                      {i > 0 && <Divider />}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityHint="Opens a read-only view of this company"
                        onPress={() => navigation.navigate('CompanyInventory', { companyId: c.id, companyName: c.name })}
                        style={({ pressed }) => [styles.subRow, pressed && { backgroundColor: colors.surfaceMuted }]}
                      >
                        <LetterTile label={c.name} muted={!c.isActive} />
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={[styles.subName, !c.isActive && { color: colors.ink2 }]} numberOfLines={1}>
                            {c.name}
                          </Text>
                          {c.isActive ? (
                            <Text style={type.small} numberOfLines={1}>
                              {stats ? `${plural(stats.itemCount, 'item')} · ` : ''}
                              {stats ? (
                                <Text style={[type.small, stats.lowStockCount > 0 && styles.lowText]}>{stats.lowStockCount} low stock</Text>
                              ) : (
                                'Active'
                              )}
                            </Text>
                          ) : (
                            <Text style={type.small}>Deactivated</Text>
                          )}
                        </View>
                        {stats && (
                          <View style={{ alignItems: 'flex-end', gap: 2 }}>
                            <Text style={[styles.subMargin, stats.margin < 0 && { color: colors.danger }]}>{formatMoney(stats.margin)}</Text>
                            <Text style={type.caption}>margin</Text>
                          </View>
                        )}
                        <Icon name="chev" size={18} color={colors.chevron} />
                      </Pressable>
                    </View>
                  );
                })}
              </ListCard>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  syncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 20, gap: 14 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.onDarkMuted },
  heroShare: { fontFamily: fonts.semibold, fontSize: 12, color: colors.okOnDark },
  heroValue: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46, letterSpacing: -1.2, color: '#FFFFFF' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  heroStats: { flexDirection: 'row', gap: 12 },
  heroStatLabel: { fontSize: 12, color: colors.onDarkMuted },
  heroStatValue: { fontFamily: fonts.semibold, fontSize: 17, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  heroSync: { fontSize: 11, color: '#8D93A5' },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  tileDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerLine },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileLabel: { fontSize: 13, color: colors.ink3 },
  tileValue: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  tileHint: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  pressed: { opacity: 0.75 },
  headerLink: { paddingVertical: 10, paddingLeft: 12 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 12, minHeight: 64 },
  subName: { fontFamily: fonts.semibold, fontSize: 15 },
  lowText: { color: colors.danger, fontFamily: fonts.medium },
  subMargin: { fontFamily: fonts.semibold, fontSize: 15, fontVariant: ['tabular-nums'] },
});
