import { Alert } from 'react-native';
import { getLocalItems } from '../db/localDb';

// Scan-to-find: open the scanner, match the code against this company's local catalog by SKU,
// and jump straight to recording a transaction for the match. Used by the tab bar's Scan button
// and the scan button on the Inventory screen.
export function startScanToFind(navigation, companyId) {
  navigation.navigate('ScanBarcode', {
    onScanned: (code) => {
      const normalized = code.trim().toLowerCase();
      const match = getLocalItems(companyId).find((i) => i.sku.trim().toLowerCase() === normalized);
      if (!match) {
        Alert.alert('Not found', `No item in this list has SKU "${code}".`);
        return;
      }
      navigation.navigate('StockTransaction', { item: match });
    },
  });
}
