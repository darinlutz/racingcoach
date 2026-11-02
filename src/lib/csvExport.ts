// CSV for Download My Data (personalDataExport.ts). Pure, so scripts/privacy-rights.test.mjs tests it directly.
// A cell a spreadsheet would run as a formula (=, +, @, tab, carriage return, or - not starting a number) gets a
// leading quote, so an exported value can't run when the requester opens the file.
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-\d/.test(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Rows as CSV with a header line, in the given column order (else the first row's), CRLF line endings
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const headers = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return [headers.join(','), ...rows.map((row) => headers.map((h) => cell(row[h])).join(','))].join('\r\n') + '\r\n';
}
