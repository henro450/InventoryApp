import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

// RPT-05: CSV export only (no PDF/Excel — decided to keep this to what needs zero new
// heavyweight dependencies; CSV is just string-joining, no library required).

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// columns: [{ key, label }]. rows: array of plain objects.
export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => escapeCsvValue(row[c.key])).join(','));
  return [header, ...lines].join('\n');
}

// Writes the CSV to a temp file and opens the native share sheet so the user can save/send
// it — a mobile app has no browser-style "Downloads" folder to drop a file into directly.
export async function exportCsv(filename, rows, columns) {
  const csv = toCsv(rows, columns);
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: filename });
}

// RFC4180-ish parser (handles quoted fields containing commas/newlines/escaped quotes) —
// the counterpart to toCsv's escaping, since bulk import needs to read back what export
// (or a spreadsheet program) produces. Returns an array of plain objects keyed by the
// header row's column names.
export function parseCsv(csvString) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const text = csvString.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmptyRows.length === 0) return [];

  const [header, ...dataRows] = nonEmptyRows;
  return dataRows.map((cells) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = cells[idx] ?? '';
    });
    return obj;
  });
}

// Opens the native document picker for a CSV file and returns its parsed rows (keyed by
// header row, matching parseCsv's shape) — null if the user cancelled.
export async function pickAndParseCsv() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const content = await FileSystem.readAsStringAsync(result.assets[0].uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return parseCsv(content);
}
