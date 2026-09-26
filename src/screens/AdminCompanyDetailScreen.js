import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { getCached, setCached } from '../db/localDb';
import { formatDateTime, formatSubscription } from '../utils/format';
import { Text, Screen, NavHeader, Card, SectionTitle, Divider, LetterTile, Pill, Banner, InlineEmpty, Loading, CountBadge } from '../components/ui';
import { colors, fonts, type } from '../theme';

// SuperAdmin: a company's subscription price and everyone who uses it and each of its Sub
// Companies. Read-only — each company's own admins manage their users. Offline, the last
// loaded copy is shown.
export default function AdminCompanyDetailScreen({ route }) {
  const { companyId, companyName } = route.params;
  const cacheKey = `adminCompanyUsers:${companyId}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    return api
      .adminCompanyUsers(companyId)
      .then((result) => {
        setData(result);
        setSavedAt(null);
        setCached(cacheKey, result);
      })
      .catch((err) => {
        const saved = getCached(cacheKey);
        if (saved) {
          setData(saved.data);
          setSavedAt(saved.savedAt);
        } else {
          setError(err.message);
        }
      });
  }, [companyId, cacheKey]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const title = data?.company?.name || companyName || 'Company';

  if (!data && !error) {
    return (
      <Screen>
        <NavHeader title={title} />
        <Loading />
      </Screen>
    );
  }

  const totalUsers = data ? data.company.users.length + data.subCompanies.reduce((n, s) => n + s.users.length, 0) : 0;

  return (
    <Screen>
      <NavHeader title={title} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
      >
        {error && <Banner kind="error" title="Couldn't load users" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
        {savedAt && <Banner kind="info" icon="cloud" title="Offline · saved copy" subtitle={`From ${formatDateTime(savedAt)}.`} actionLabel="Retry" onAction={handleRefresh} />}

        {data && (
          <>
            <Card padding={18} gap={6}>
              <Text style={type.caption}>Subscription</Text>
              <Text style={styles.price}>{formatSubscription(data.company.subscription)}</Text>
              <Text style={type.caption}>
                {totalUsers === 1 ? '1 user' : `${totalUsers} users`} across {data.subCompanies.length + 1}{' '}
                {data.subCompanies.length === 0 ? 'company' : 'companies'}. Change the price with Edit, or subscribe/end it, on the Companies screen.
              </Text>
            </Card>

            <UserGroup title={data.company.name} subtitle="Main company" users={data.company.users} inactive={!data.company.isActive} />

            {data.subCompanies.length === 0 ? (
              <Text style={type.caption}>No sub-companies.</Text>
            ) : (
              data.subCompanies.map((sub) => (
                <UserGroup key={sub.id} title={sub.name} subtitle="Sub-company" users={sub.users} inactive={!sub.isActive} />
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function UserGroup({ title, subtitle, users, inactive }) {
  return (
    <Card padding={16} gap={4}>
      <SectionTitle
        title={title}
        badge={<CountBadge count={users.length} kind="primary" />}
        right={inactive ? <Pill kind="muted" label="Deactivated" /> : null}
      />
      <Text style={[type.caption, { marginTop: -6, marginBottom: 4 }]}>{subtitle}</Text>
      {users.length === 0 ? (
        <InlineEmpty>No users.</InlineEmpty>
      ) : (
        users.map((u, i) => (
          <View key={u.id}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <LetterTile label={u.name} muted={!u.isActive} size={36} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.name, !u.isActive && { color: colors.ink2 }]} numberOfLines={1}>
                  {u.name}
                </Text>
                <Text style={type.caption} numberOfLines={1}>
                  {u.email}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Pill kind={u.isCompanyAdmin ? 'primary' : 'muted'} label={u.isCompanyAdmin ? 'Admin' : 'Regular'} />
                {u.status === 'pending' && <Pill kind="warn" label="Invite pending" />}
                {u.status === 'deactivated' && <Pill kind="muted" label="Deactivated" />}
              </View>
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16 },
  price: { fontFamily: fonts.display, fontSize: 26, letterSpacing: -0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  name: { fontFamily: fonts.semibold, fontSize: 14 },
});
