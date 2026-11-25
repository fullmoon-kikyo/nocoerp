// Adapted from NocoITAM 30c98511044708616a163a98916aeeada32abf0d (Apache-2.0).
// Modified: strict syntax/column checks, row locations and reversible spreadsheet formula protection.
/**
 * RFC 4180 CSV parsing and writing, small enough to own: quoted fields,
 * doubled quotes, embedded newlines, CRLF, an optional BOM.
 */
export interface CsvTable {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
  readonly lineNumbers: readonly number[];
}

export class CategoryCsvError extends Error {
  constructor(readonly line: number) {
    super('CATEGORY_CSV_INVALID');
  }
}

export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let start = 1;
  const positions: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
        if (char === '\n') line += 1;
      }
      continue;
    }
    if (closedQuote && char !== ',' && char !== '\n' && char !== '\r')
      throw new CategoryCsvError(line);
    if (char === '"') {
      if (field) throw new CategoryCsvError(line);
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
      closedQuote = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      positions.push(start);
      line += 1;
      start = line;
      record = [];
      field = '';
      closedQuote = false;
    } else field += char;
  }
  if (quoted) throw new CategoryCsvError(start);
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
    positions.push(start);
  }
  const nonempty = records
    .map((row, index) => ({ row, line: positions[index] }))
    .filter(({ row }) => row.length > 1 || (row[0] ?? '').trim() !== '');
  const header = nonempty[0]?.row;
  const body = nonempty.slice(1);
  const columns = (header ?? []).map((column) => column.trim());
  return {
    columns,
    lineNumbers: body.map((entry) => entry.line),
    rows: body.map(({ row, line }) => {
      if (row.length !== columns.length) throw new CategoryCsvError(line);
      return Object.fromEntries(
        columns.map((column, i) => {
          const value = row[i] ?? '';
          return [
            column,
            (value.startsWith("'") && /^(?:\s*[=+\-@]|')/.test(value.slice(1))
              ? value.slice(1)
              : value
            ).trim(),
          ];
        }),
      );
    }),
  };
}

export function toCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  const escape = (value: unknown) => {
    const text =
      value === null || value === undefined
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value);
    const safe = /^(?:\s*[=+\-@]|')/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map(escape).join(',')];
  for (const row of rows)
    lines.push(columns.map((column) => escape(row[column])).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}
