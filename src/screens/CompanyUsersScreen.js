import React, { useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getCached, setCached } from '../db/localDb';
import { formatDateTime } from '../utils/format';
import {
  Text, Screen, NavHeader, IconButton, Card, LetterTile, Pill, Button, Banner, EmptyState, Loading, Field, Sheet, Segmented,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const ROLE_OPTIONS = [
  { key: 'regular', label: 'Regular user' },
  { key: 'admin', label: 'Admin' },
];
const EMPTY_FORM = { name: '', email: '', role: 'regular' };

// Company admins manage who can use the app for their company (main or sub). New users get an
// email with a link to set their password. Regular users record sales and stock and see debtors;
// admins also manage items, reports, settings and users. Changes need a connection; offline the
// last loaded list is shown.
export default function CompanyUsersScreen() {
  const { user } = useAuth();
  const cacheKey = `companyUsers:${user.companyId}`;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api
      .getCompanyUsers()
      .then(({ users: list }) => {
        setUsers(list);
        setSavedAt(null);
        setCached(cacheKey, list);
      })
      .catch((err) => {
        const saved = getCached(cacheKey);
        if (saved) {
          setUsers(saved.data);
          setSavedAt(saved.savedAt);
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [cacheKey]);

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

  const setField = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  async function handleAdd() {
    const email = form.email.trim();
    if (!email) {
      Alert.alert('Email required', "Enter the new user's email address.");
      return;
    }
    setSubmitting(true);
    try {
      const { emailSent } = await api.addCompanyUser({ email, name: form.name.trim() || undefined, isCompanyAdmin: form.role === 'admin' });
      setAdding(false);
      setForm(EMPTY_FORM);
      load();
      Alert.alert(
        emailSent ? 'User added' : 'User added, email not sent',
        emailSent
          ? `We've emailed ${email} a link to set their password. They can log in once that's done.`
          : `The invite email to ${email} couldn't be sent. Use "Resend invite" to try again.`
      );
    } catch (err) {
      Alert.alert("Couldn't add user", err.status ? err.message : 'Adding users needs an internet connection.');
    } finally {
      setSubmitting(false);
    }
  }

  async function update(target, changes, done) {
    setBusyId(target.id);
    try {
      await api.updateCompanyUser(target.id, changes);
      await load();
      if (done) Alert.alert(done);
    } catch (err) {
      Alert.alert("Couldn't update user", err.status ? err.message : 'Changing users needs an internet connection.');
    } finally {
      setBusyId(null);
    }
  }

  async function resend(target) {
    setBusyId(target.id);
    try {
      const { emailSent } = await api.resendCompanyUserInvite(target.id);
      Alert.alert(emailSent ? 'Invite sent' : 'Email not sent', emailSent ? `A new link has been emailed to ${target.email}.` : 'Please try again in a moment.');
    } catch (err) {
      Alert.alert("Couldn't resend invite", err.status ? err.message : 'This needs an internet connection.');
    } finally {
      setBusyId(null);
    }
  }

  function openActions(target) {
    const isMe = target.id === user.id;
    const actions = [];
    if (target.isActive) {
      actions.push(
        target.isCompanyAdmin
          ? { text: 'Make regular user', onPress: () => update(target, { isCompanyAdmin: false }) }
          : { text: 'Make admin', onPress: () => update(target, { isCompanyAdmin: true }) }
      );
      if (target.status === 'pending') actions.push({ text: 'Resend invite', onPress: () => resend(target) });
      actions.push({
        text: isMe ? 'Deactivate my account' : 'Deactivate',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Deactivate ${target.name}?`, "They won't be able to log in until you reactivate them. Their past records stay.", [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Deactivate', style: 'destructive', onPress: () => update(target, { isActive: false }) },
          ]),
      });
    } else {
      actions.push({ text: 'Reactivate', onPress: () => update(target, { isActive: true }, `${target.name} can log in again.`) });
    }
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(target.name, target.email, actions);
  }

  const header = (
    <NavHeader
      title="Users"
      right={<IconButton icon="plus" label="Add user" variant="soft" iconSize={22} onPress={() => setAdding(true)} />}
    />
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
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <Text style={type.small}>
              Admins manage users, items, reports and settings. Regular users record sales and stock and can see who owes money.
            </Text>
            {error && <Banner kind="error" title="Couldn't load users" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {savedAt && (
              <Banner
                kind="info"
                icon="cloud"
                title="Offline · changing users needs a connection"
                subtitle={`Showing the list saved ${formatDateTime(savedAt)}.`}
                actionLabel="Retry"
                onAction={handleRefresh}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          <Card>
            <EmptyState icon="user" title="No users yet" body="Add the people who work with you." />
          </Card>
        }
        renderItem={({ item: u }) => (
          <Card padding={14}>
            <View style={styles.row}>
              <LetterTile label={u.name} muted={!u.isActive} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.name, !u.isActive && { color: colors.ink2 }]} numberOfLines={1}>
                  {u.name}
                  {u.id === user.id ? ' (you)' : ''}
                </Text>
                <Text style={type.caption} numberOfLines={1}>
                  {u.email}
                </Text>
                <View style={styles.pills}>
                  <Pill kind={u.isCompanyAdmin ? 'primary' : 'muted'} label={u.isCompanyAdmin ? 'Admin' : 'Regular user'} />
                  {u.status === 'pending' && <Pill kind="warn" label="Invite pending" />}
                  {u.status === 'deactivated' && <Pill kind="muted" label="Deactivated" />}
                </View>
              </View>
              <Button title="Manage" variant="secondary" height={40} loading={busyId === u.id} onPress={() => openActions(u)} />
            </View>
          </Card>
        )}
      />

      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Add user"
        description="We'll email them a link to set their password."
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setAdding(false)} />
            <Button title="Send invite" style={{ flex: 1 }} onPress={handleAdd} loading={submitting} />
          </>
        }
      >
        <Field label="Name" optional leadingIcon="user" placeholder="Full name" autoCapitalize="words" value={form.name} onChangeText={setField('name')} />
        <Field
          label="Email"
          leadingIcon="mail"
          placeholder="name@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={form.email}
          onChangeText={setField('email')}
        />
        <View style={{ gap: 8 }}>
          <Text style={type.label}>Access</Text>
          <Segmented accessibilityLabel="Access level" options={ROLE_OPTIONS} value={form.role} onChange={setField('role')} />
          <Text style={type.caption}>
            {form.role === 'admin'
              ? 'Can do everything, including managing users, items, reports and settings.'
              : 'Can record sales and stock, and see who owes money.'}
          </Text>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  pills: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
});
