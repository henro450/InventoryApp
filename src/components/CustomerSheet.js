import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { pickContact } from '../utils/contacts';
import { isValidPhone } from '../utils/phone';
import { Text, Sheet, Field, Button } from './ui';
import { type } from '../theme';

// Who is paying part (or owes the whole sale). "Choose from contacts" fills the fields from the
// phone's contacts; for someone who isn't in the contacts, type the name and number directly.
export default function CustomerSheet({ visible, initial, onClose, onSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initial?.name || '');
    setPhone(initial?.phone || '');
    setError(null);
  }, [visible]);

  async function handlePick() {
    setPicking(true);
    try {
      const contact = await pickContact();
      if (!contact) return;
      setName(contact.name);
      setPhone(contact.phone);
      setError(contact.phone ? null : 'This contact has no phone number. Type one in.');
    } catch (err) {
      setError(`Couldn't open contacts. ${err.message}`);
    } finally {
      setPicking(false);
    }
  }

  function handleSave() {
    if (!name.trim()) {
      setError("Enter the customer's name.");
      return;
    }
    if (!isValidPhone(phone)) {
      setError('Enter a valid phone number.');
      return;
    }
    onSave({ name: name.trim(), phone: phone.trim() });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Who is paying?"
      description="The balance will be recorded against this customer so you can follow it up."
      footer={
        <>
          <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
          <Button title="Save customer" style={{ flex: 1 }} onPress={handleSave} />
        </>
      }
    >
      <Button title="Choose from contacts" variant="secondary" icon="contacts" height={48} onPress={handlePick} loading={picking} />
      <View style={{ gap: 4, alignItems: 'center' }}>
        <Text style={type.caption}>or type their details</Text>
      </View>
      <Field label="Customer name" leadingIcon="user" placeholder="Full name" autoCapitalize="words" value={name} onChangeText={setName} />
      <Field
        label="Phone number"
        leadingIcon="phone"
        placeholder="e.g. 0803 123 4567"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        value={phone}
        onChangeText={setPhone}
        error={error}
      />
    </Sheet>
  );
}
