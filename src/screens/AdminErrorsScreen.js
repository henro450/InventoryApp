import React, { useCallback, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { formatDateTime, timeAgo } from '../utils/format';
import { Text, Screen, NavHeader, Chip, Card, Pill, Banner, EmptyState, Loading, Button } from '../components/ui';
import { colors, fonts, type } from '../theme';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'app', label: 'App' },
  { key: 'api', label: 'Server' },
];

function contextLine(r) {
  const c = r.context || {};
  return [
    c.screen && `Screen: ${c.screen}`,
    c.route,
    c.appVersion && `v${c.appVersion}`,
    c.platform && `${c.platform}${c.osVersion ? ` ${c.osVersion}` : ''}`,
    c.fatal ? 'crashed' : null,
    c.during && `during ${c.during}`,
  ].filter(Boolean).join(' · ');
}

// SuperAdmin: errors and crashes reported by the app and the API, most recently seen first. Each
// row is one kind of error with how many times it happened. Tap to see where it happened, and
// clear it once fixed (it comes back if it happens again).
export default function AdminErrorsScreen() {
  const [filter, setFilter] = useState('');
  const [reports, setReports] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback((source = filter) => {
    setError(null);
    return api
      .adminListErrors({ source })
      .then((page) => {
        setReports(page.reports);
        setNextCursor(page.nextCursor ?? null);
      })
      .catch((err) => setError(err.message));
  }, [filter]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.adminListErrors({ source: filter, before: nextCursor });
      setReports((list) => [...(list || []), ...page.reports.filter((r) => !list?.some((x) => x.id === r.id))]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      // Keep the button for another try.
    } finally {
      setLoadingMore(false);
    }
  }

  function changeFilter(key) {
    setFilter(key);
    setReports(null);
    load(key);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function clear(report) {
    Alert.alert('Mark as fixed?', 'It disappears from this list, and comes back if it happens again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark fixed',
        onPress: async () => {
          try {
            await api.adminClearError(report.id);
            setReports((list) => list.filter((r) => r.id !== report.id));
          } catch (err) {
            Alert.alert("Couldn't clear it", err.message);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <NavHeader title="App errors" />
      <FlatList
        data={reports || []}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 14 }}>
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Chip key={f.key || 'all'} label={f.label} active={filter === f.key} onPress={() => changeFilter(f.key)} />
              ))}
            </View>
            {error && <Banner kind="error" title="Couldn't load errors" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {!reports && !error && <Loading />}
          </View>
        }
        ListEmptyComponent={
          reports ? (
            <Card>
              <EmptyState icon="check" title="No errors" body="Crashes and errors from the app and the server appear here." />
            </Card>
          ) : null
        }
        ListFooterComponent={
          nextCursor ? (
            <View style={styles.more}>
              {loadingMore ? <ActivityIndicator color={colors.ink3} /> : <Button title="Load more" variant="ghost" height={44} onPress={loadMore} />}
            </View>
          ) : null
        }
        renderItem={({ item: r }) => {
          const expanded = open === r.id;
          const where = contextLine(r);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : r.id)}
              style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surfaceMuted }]}
            >
              <View style={styles.top}>
                <Pill kind={r.source === 'api' ? 'warn' : 'danger'} label={r.source === 'api' ? 'Server' : 'App'} />
                <Text style={type.caption}>
                  {r.occurrences === 1 ? 'Once' : `${r.occurrences} times`} · {timeAgo(r.lastSeenAt)}
                </Text>
              </View>
              <Text style={styles.message} numberOfLines={expanded ? undefined : 3}>
                {r.message}
              </Text>
              {(r.companyName || where) && (
                <Text style={type.caption} numberOfLines={expanded ? undefined : 1}>
                  {[r.companyName, where].filter(Boolean).join(' · ')}
                </Text>
              )}
              {expanded && (
                <View style={{ gap: 10 }}>
                  <Text style={type.caption}>
                    First seen {formatDateTime(r.firstSeenAt)}. Last seen {formatDateTime(r.lastSeenAt)}.
                  </Text>
                  {r.stack ? <Text style={styles.stack} selectable>{r.stack}</Text> : null}
                  <Button title="Mark fixed" variant="secondary" icon="check" height={44} onPress={() => clear(r)} />
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 16, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  message: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  stack: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 15, color: colors.ink2, backgroundColor: colors.surfaceMuted, borderRadius: 10, padding: 10 },
  more: { paddingVertical: 12, alignItems: 'center' },
});
