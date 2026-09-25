import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import {
  Text, Screen, NavHeader, IconButton, SearchField, Card, LetterTile, Pill, Button, Banner, EmptyState, Loading,
  Field, Sheet,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const EMPTY_FORM = { companyName: '', email: '' };

export default function ManageSubCompaniesScreen() {
  const [subCompanies, setSubCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [editingCompany, setEditingCompany] = useState(null);
  const [editName, setEditName] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [togglingId, setTogglingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    return api
      .getMyCompany()
      .then(({ subCompanies: subs }) => setSubCompanies(subs))
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

  async function handleCreate() {
    const companyName = createForm.companyName.trim();
    const email = createForm.email.trim();
    if (!companyName || !email) {
      Alert.alert('Missing info', 'Company name and admin email are both required.');
      return;
    }
    setCreateSubmitting(true);
    try {
      const { emailSent } = await api.createSubCompany({ companyName, email });
      setCreateForm(EMPTY_FORM);
      setCreating(false);
      load();
      if (emailSent) {
        Alert.alert('Invite sent', `We've emailed ${email} a link to set their password. They can log in once that's done.`);
      } else {
        Alert.alert('Company created, email not sent', `${companyName} was created, but the invite email to ${email} couldn't be sent. Use "Resend invite" to try again.`);
      }
    } catch (err) {
      Alert.alert('Could not create Sub Company', err.message);
    } finally {
      setCreateSubmitting(false);
    }
  }

  function openEdit(company) {
    setEditingCompany(company);
    setEditName(company.name);
  }

  async function handleEditSave() {
    if (!editName.trim()) {
      Alert.alert('Name required', 'Please enter a company name.');
      return;
    }
    setEditSubmitting(true);
    try {
      await api.updateSubCompany(editingCompany.id, { companyName: editName });
      setEditingCompany(null);
      load();
    } catch (err) {
      Alert.alert('Could not rename Sub Company', err.message);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function toggleActive(company) {
    setTogglingId(company.id);
    try {
      if (company.isActive) {
        await api.deactivateSubCompany(company.id);
      } else {
        await api.reactivateSubCompany(company.id);
      }
      load();
    } catch (err) {
      Alert.alert('Could not update Sub Company', err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleResend(company) {
    setResendingId(company.id);
    try {
      const { email, emailSent } = await api.resendSubCompanyInvite(company.id);
      if (emailSent) Alert.alert('Invite sent', `A new link has been emailed to ${email}. Earlier links no longer work.`);
      else Alert.alert('Email not sent', "The invite couldn't be sent. Please try again in a moment.");
      load();
    } catch (err) {
      Alert.alert('Could not resend invite', err.message);
    } finally {
      setResendingId(null);
    }
  }

  function handleToggleActive(company) {
    if (!company.isActive) {
      toggleActive(company);
      return;
    }
    Alert.alert('Deactivate Sub Company', `Deactivate "${company.name}"? Its users can no longer sign in until you reactivate it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => toggleActive(company) },
    ]);
  }

  const setField = (key) => (v) => setCreateForm((f) => ({ ...f, [key]: v }));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? subCompanies.filter((c) => c.name.toLowerCase().includes(q)) : subCompanies;
  }, [subCompanies, query]);

  const header = (
    <NavHeader
      title="Sub companies"
      right={<IconButton icon="plus" label="Add sub company" variant="soft" onPress={() => setCreating(true)} iconSize={22} />}
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
              {subCompanies.length === 1 ? '1 company' : `${subCompanies.length} companies`} linked to your account. Each gets its own admin
              login and inventory.
            </Text>
            {error && <Banner kind="error" title="Couldn't load Sub Companies" subtitle={`Are you offline? ${error}`} actionLabel="Retry" onAction={handleRefresh} />}
            {subCompanies.length > 3 && <SearchField value={query} onChangeText={setQuery} placeholder="Search sub companies" />}
          </View>
        }
        ListEmptyComponent={
          subCompanies.length === 0 ? (
            <Card>
              <EmptyState
                icon="building"
                title="No Sub Companies yet"
                body="Add one to get started, or keep using the app standalone. Nothing else requires a Sub Company to work."
              >
                <Button title="Add sub company" icon="plus" height={48} onPress={() => setCreating(true)} style={{ marginTop: 8 }} />
              </EmptyState>
            </Card>
          ) : (
            <EmptyState icon="search" title="No matches" body="Try a different name." />
          )
        }
        renderItem={({ item }) => (
          <Card padding={16}>
            <View style={styles.topRow}>
              <LetterTile label={item.name} muted={!item.isActive} />
              <Text style={[styles.name, !item.isActive && { color: colors.ink2 }]} numberOfLines={2}>
                {item.name}
              </Text>
              {!item.isActive ? (
                <Pill kind="muted" label="Deactivated" />
              ) : item.inviteStatus === 'pending' ? (
                <Pill kind="warn" label="Invite pending" />
              ) : (
                <Pill kind="ok" label="Active" />
              )}
            </View>
            {item.isActive && item.inviteStatus === 'pending' && (
              <View style={styles.pendingRow}>
                <Text style={[type.small, { flex: 1 }]} numberOfLines={2}>
                  Waiting for {item.adminEmail || 'the admin'} to set a password.
                </Text>
                <Button title="Resend invite" variant="ghost" icon="mail" height={40} loading={resendingId === item.id} onPress={() => handleResend(item)} />
              </View>
            )}
            <View style={styles.actions}>
              <Button title="Rename" variant="secondary" icon="pencil" height={44} style={{ flex: 1 }} onPress={() => openEdit(item)} />
              <Button
                title={item.isActive ? 'Deactivate' : 'Reactivate'}
                variant={item.isActive ? 'danger' : 'secondary'}
                height={44}
                style={{ flex: 1 }}
                loading={togglingId === item.id}
                onPress={() => handleToggleActive(item)}
              />
            </View>
          </Card>
        )}
      />

      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="Add sub company"
        description="We'll email the admin a link to set their password. You can rename or deactivate the company later."
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Send invite" style={{ flex: 1 }} onPress={handleCreate} loading={createSubmitting} />
          </>
        }
      >
        <Field label="Company name" leadingIcon="building" placeholder="e.g. Lekki Warehouse" value={createForm.companyName} onChangeText={setField('companyName')} />
        <Field
          label="Admin email"
          leadingIcon="mail"
          placeholder="admin@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={createForm.email}
          onChangeText={setField('email')}
          hint="They'll get an email with a link that opens the app to set their password."
        />
      </Sheet>

      <Sheet
        visible={!!editingCompany}
        onClose={() => setEditingCompany(null)}
        title="Rename sub company"
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setEditingCompany(null)} />
            <Button title="Save" style={{ flex: 1 }} onPress={handleEditSave} loading={editSubmitting} />
          </>
        }
      >
        <Field label="Company name" leadingIcon="building" value={editName} onChangeText={setEditName} placeholder="Company name" autoFocus />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
