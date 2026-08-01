import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';

// ROLE-05: Main Company can create, rename, deactivate, and reactivate Sub Company accounts.
export default function ManageSubCompaniesScreen() {
  const [subCompanies, setSubCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ companyName: '', adminName: '', email: '', password: '' });
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [editingCompany, setEditingCompany] = useState(null);
  const [editName, setEditName] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [togglingId, setTogglingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api
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

  async function handleCreate() {
    const { companyName, adminName, email, password } = createForm;
    if (!companyName || !adminName || !email || !password) {
      Alert.alert('Missing info', 'Company name, admin name, email, and password are all required.');
      return;
    }
    setCreateSubmitting(true);
    try {
      await api.createSubCompany(createForm);
      setCreateForm({ companyName: '', adminName: '', email: '', password: '' });
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

  async function handleToggleActive(company) {
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>Could not load Sub Companies (are you offline?): {error}</Text>}

      <TouchableOpacity style={styles.createButton} onPress={() => setCreating(true)}>
        <Text style={styles.createButtonText}>+ Add Sub Company</Text>
      </TouchableOpacity>

      {subCompanies.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No Sub Companies yet</Text>
          <Text style={styles.emptyText}>
            Add one above to get started — or keep using the app standalone; nothing else
            requires a Sub Company to work.
          </Text>
        </View>
      ) : (
        <FlatList
          data={subCompanies}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ paddingTop: 16 }}
          renderItem={({ item }) => (
            <View style={styles.subCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subName}>{item.name}</Text>
                <Text style={styles.subMeta}>{item.isActive ? 'Active' : 'Deactivated'}</Text>
              </View>
              <View style={styles.subActions}>
                <TouchableOpacity onPress={() => openEdit(item)}>
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleToggleActive(item)} disabled={togglingId === item.id}>
                  {togglingId === item.id ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text style={[styles.actionText, item.isActive && styles.actionTextDanger]}>
                      {item.isActive ? 'Deactivate' : 'Reactivate'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Create modal */}
      <Modal visible={creating} animationType="slide" transparent onRequestClose={() => setCreating(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Sub Company</Text>
            <TextInput
              style={styles.input}
              placeholder="Company name"
              value={createForm.companyName}
              onChangeText={(v) => setCreateForm((f) => ({ ...f, companyName: v }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Admin name"
              value={createForm.adminName}
              onChangeText={(v) => setCreateForm((f) => ({ ...f, adminName: v }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Admin email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={createForm.email}
              onChangeText={(v) => setCreateForm((f) => ({ ...f, email: v }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Admin password"
              secureTextEntry
              value={createForm.password}
              onChangeText={(v) => setCreateForm((f) => ({ ...f, password: v }))}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCreating(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleCreate} disabled={createSubmitting}>
                {createSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editingCompany} animationType="slide" transparent onRequestClose={() => setEditingCompany(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Sub Company</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Company name" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setEditingCompany(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={handleEditSave} disabled={editSubmitting}>
                {editSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#d9534f', marginBottom: 12 },
  createButton: { backgroundColor: '#2f6fed', borderRadius: 8, padding: 12, alignItems: 'center' },
  createButtonText: { color: '#fff', fontWeight: '600' },
  emptyBox: { padding: 16, backgroundColor: '#f4f6fb', borderRadius: 10, marginTop: 16 },
  emptyTitle: { fontWeight: '600', marginBottom: 6 },
  emptyText: { color: '#666', fontSize: 13, lineHeight: 18 },
  subCard: {
    padding: 14, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  subName: { fontSize: 16, fontWeight: '600' },
  subMeta: { color: '#888' },
  subActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  actionText: { color: '#2f6fed', fontWeight: '600', fontSize: 13 },
  actionTextDanger: { color: '#d9534f' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalCancel: { padding: 10 },
  modalCancelText: { color: '#666', fontWeight: '600' },
  modalSave: { backgroundColor: '#2f6fed', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  modalSaveText: { color: '#fff', fontWeight: '600' },
});
