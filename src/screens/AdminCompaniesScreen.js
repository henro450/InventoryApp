import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Text, Screen, LargeHeader, IconButton, AccountButton, SearchField, Card, LetterTile, Pill, Button, Banner, EmptyState,
  Loading, Field, Sheet, Segmented,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const YES_NO = [
  { key: 'yes', label: 'Yes' },
  { key: 'no', label: 'No' },
];
const EMPTY_FORM = { email: '', companyName: '', hasSubCompanies: 'no' };

// SuperAdmin home: profile new Main Companies (email + company name + whether they have Sub
// Companies). The API emails the company's admin a link to set their password.
export default function AdminCompaniesScreen() {
  const { user, logout } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [editSubs, setEditSubs] = useState('no');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [resendingId, setResendingId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api
      .adminListCompanies()
      .then(({ companies: list }) => setCompanies(list))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

  async function handleCreate() {
    const email = form.email.trim();
    const companyName = form.companyName.trim();
    if (!email || !companyName) {
      Alert.alert('Missing info', 'Email and company name are both required.');
      return;
    }
    setSubmitting(true);
    try {
      const { emailSent } = await api.adminCreateCompany({ email, companyName, allowSubCompanies: form.hasSubCompanies === 'yes' });
      setForm(EMPTY_FORM);
      setCreating(false);
      load();
      if (emailSent) {
        Alert.alert('Company registered', `We've emailed ${email} a link to set their password. They can log in once that's done.`);
      } else {
        Alert.alert(
          'Registered, email not sent',
          `${companyName} was registered, but the email to ${email} couldn't be sent. Use "Resend invite" to try again.`
        );
      }
    } catch (err) {
      Alert.alert('Could not register company', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(company) {
    setEditing(company);
    setEditName(company.name);
    setEditSubs(company.allowSubCompanies ? 'yes' : 'no');
  }

  async function handleEditSave() {
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter a company name.');
      return;
    }
    setEditSubmitting(true);
    try {
      await api.adminUpdateCompany(editing.id, { companyName: editName.trim(), allowSubCompanies: editSubs === 'yes' });
      setEditing(null);
      load();
    } catch (err) {
      Alert.alert('Could not update company', err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleResend(company) {
    setResendingId(company.id);
    try {
      const { email, emailSent } = await api.adminResendInvite(company.id);
      if (emailSent) Alert.alert('Invite sent', `A new link has been emailed to ${email}. Earlier links no longer work.`);
      else Alert.alert('Email not sent', "The invite couldn't be sent. Please try again in a moment.");
    } catch (err) {
      Alert.alert('Could not resend invite', err.message);
    } finally {
      setResendingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.name.toLowerCase().includes(q) || (c.admin?.email || '').toLowerCase().includes(q));
  }, [companies, query]);

  const pendingCount = companies.filter((c) => c.status === 'pending').length;

  const header = (
    <LargeHeader
      eyebrow="SuperAdmin"
      title="Companies"
      right={
        <>
          <IconButton icon="plus" label="Register a company" variant="soft" iconSize={22} onPress={() => setCreating(true)} />
          <AccountButton user={user} onLogout={logout} />
        </>
      }
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
        data={visible}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink3} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 14 }}>
            <Text style={type.small}>
              {companies.length === 1 ? '1 company' : `${companies.length} companies`} registered
              {pendingCount > 0 ? ` · ${pendingCount} waiting to set a password` : ''}.
            </Text>
            {error && <Banner kind="error" title="Couldn't load companies" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {companies.length > 3 && <SearchField value={query} onChangeText={setQuery} placeholder="Search by company or email" />}
          </View>
        }
        ListEmptyComponent={
          companies.length === 0 ? (
            <Card>
              <EmptyState icon="building" title="No companies yet" body="Register a company with its admin's email. They'll get a link to set their password.">
                <Button title="Register a company" icon="plus" height={48} onPress={() => setCreating(true)} style={{ marginTop: 8 }} />
              </EmptyState>
            </Card>
          ) : (
            <EmptyState icon="search" title="No matches" body="Try a different name or email." />
          )
        }
        renderItem={({ item }) => (
          <Card padding={16}>
            <View style={styles.topRow}>
              <LetterTile label={item.name} muted={!item.isActive} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {item.admin?.email || 'No admin'}
                </Text>
              </View>
              {!item.isActive ? (
                <Pill kind="muted" label="Deactivated" />
              ) : item.status === 'pending' ? (
                <Pill kind="warn" label="Invite pending" />
              ) : (
                <Pill kind="ok" label="Active" />
              )}
            </View>
            <Text style={type.small}>
              Sub-companies: <Text style={styles.strong}>{item.allowSubCompanies ? 'Yes' : 'No'}</Text>
              {item.subCompanyCount > 0 ? ` · ${item.subCompanyCount} linked` : ''}
            </Text>
            <View style={styles.actions}>
              <Button title="Edit" variant="secondary" icon="pencil" height={44} style={{ flex: 1 }} onPress={() => openEdit(item)} />
              {item.status === 'pending' && item.isActive && (
                <Button
                  title="Resend invite"
                  variant="secondary"
                  icon="mail"
                  height={44}
                  style={{ flex: 1 }}
                  loading={resendingId === item.id}
                  onPress={() => handleResend(item)}
                />
              )}
            </View>
          </Card>
        )}
      />

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="Register a company"
        description="We'll email the admin a link that opens the app so they can set their password."
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Register & send" style={{ flex: 1 }} onPress={handleCreate} loading={submitting} />
          </>
        }
      >
        <Field
          label="Admin email"
          leadingIcon="mail"
          placeholder="admin@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={form.email}
          onChangeText={setField('email')}
        />
        <Field label="Company name" leadingIcon="building" placeholder="e.g. Brightstar Stores" value={form.companyName} onChangeText={setField('companyName')} />
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Has sub-companies?</Text>
          <Segmented accessibilityLabel="Has sub-companies" options={YES_NO} value={form.hasSubCompanies} onChange={setField('hasSubCompanies')} />
          <Text style={type.caption}>Only companies with sub-companies can add and manage them. You can change this later.</Text>
        </View>
      </Sheet>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit company"
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditing(null)} />
            <Button title="Save" style={{ flex: 1 }} onPress={handleEditSave} loading={editSubmitting} />
          </>
        }
      >
        <Field label="Company name" leadingIcon="building" value={editName} onChangeText={setEditName} placeholder="Company name" />
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Has sub-companies?</Text>
          <Segmented accessibilityLabel="Has sub-companies" options={YES_NO} value={editSubs} onChange={setEditSubs} />
          {editing && editSubs === 'no' && editing.subCompanyCount > 0 && (
            <Text style={type.caption}>
              Its {editing.subCompanyCount} existing sub-{editing.subCompanyCount === 1 ? 'company stays' : 'companies stay'} viewable, but no new ones can be added.
            </Text>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 16 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  actions: { flexDirection: 'row', gap: 10 },
});
