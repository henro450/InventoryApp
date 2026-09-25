import React, { useCallback, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import {
  Text, Screen, NavHeader, IconButton, SearchField, Card, LetterTile, Pill, Button, Banner, EmptyState, Loading,
  Field, Sheet,
} from '../components/ui';
import { colors, fonts, type } from '../theme';

const EMPTY_FORM = { companyName: '', adminName: '', email: '', password: '' };

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
    const { companyName, adminName, email, password } = createForm;
    if (!companyName || !adminName || !email || !password) {
      Alert.alert('Missing info', 'Company name, admin name, email, and password are all required.');
      return;
    }
    setCreateSubmitting(true);
    try {
      await api.createSubCompany(createForm);
      setCreateForm(EMPTY_FORM);
      setCreating(false);
      load();
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
              {item.isActive ? <Pill kind="ok" label="Active" /> : <Pill kind="muted" label="Deactivated" />}
            </View>
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
        description="Creates the company and its first admin login. You can rename or deactivate it later."
        footer={
          <>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Create company" style={{ flex: 1 }} onPress={handleCreate} loading={createSubmitting} />
          </>
        }
      >
        <Field label="Company name" leadingIcon="building" placeholder="e.g. Lekki Warehouse" value={createForm.companyName} onChangeText={setField('companyName')} />
        <Field label="Admin name" leadingIcon="user" placeholder="Full name" value={createForm.adminName} onChangeText={setField('adminName')} />
        <Field
          label="Admin email"
          leadingIcon="mail"
          placeholder="admin@company.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={createForm.email}
          onChangeText={setField('email')}
        />
        <Field
          label="Temporary password"
          leadingIcon="lock"
          placeholder="Admin password"
          secureTextEntry
          value={createForm.password}
          onChangeText={setField('password')}
          hint="Share it with the admin securely. They sign in with this email and password."
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
});
