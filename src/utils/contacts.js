import { Alert, Linking } from 'react-native';
import * as Contacts from 'expo-contacts';

// Opens the phone's own contact picker and resolves { name, phone } for the chosen contact, or
// null if the user cancels. A contact with several numbers asks which one; one with no number
// comes back with an empty phone for the user to type in.
export async function pickContact() {
  const { status, canAskAgain } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Contacts access needed',
      'Allow access to your contacts to pick a customer, or type their name and number instead.',
      canAskAgain ? [{ text: 'OK' }] : [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }]
    );
    return null;
  }

  const contact = await Contacts.presentContactPickerAsync();
  if (!contact) return null;

  const name = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '';
  const numbers = [...new Set((contact.phoneNumbers || []).map((p) => p.number).filter(Boolean))];
  if (numbers.length <= 1) return { name, phone: numbers[0] || '' };

  return new Promise((resolve) => {
    Alert.alert(
      name || 'Choose a number',
      'Which number should be used?',
      [
        ...numbers.slice(0, 5).map((number) => ({ text: number, onPress: () => resolve({ name, phone: number }) })),
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}
