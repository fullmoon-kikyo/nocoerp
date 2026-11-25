import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  toCsv,
  CategoryCsvError,
} from '../../server/material-master-data/category-csv.js';

describe('category CSV', () => {
  it('preserves quoted commas, escaped quotes, multiline positions and UTF-8 BOM', () => {
    const parsed = parseCsv(
      '\uFEFFcode,name,parentCode,description\r\nA,"模具,钢材",,"line 1\r\nline 2"\r\nB,"He said ""yes""",A,\r\n',
    );
    expect(parsed.lineNumbers).toEqual([2, 4]);
    expect(parsed.rows[0]).toMatchObject({
      name: '模具,钢材',
      description: 'line 1\r\nline 2',
    });
    expect(parsed.rows[1].name).toBe('He said "yes"');
  });
  it.each([
    'code,name\nA,"unclosed',
    'code,name\nA,"quoted"trailing',
    'code,name\nA,b,c',
    'code,name\nA,un"quoted',
  ])('rejects malformed CSV: %s', (csv) => {
    expect(() => parseCsv(csv)).toThrow(CategoryCsvError);
  });
  it('reversibly escapes every spreadsheet formula prefix and an original apostrophe', () => {
    const inputs = [
      '=SUM(1,2)',
      '+1',
      '-2',
      '@SUM',
      '  =hidden',
      "'original",
      "''two",
      '普通中文',
    ];
    const csv = toCsv(
      ['code'],
      inputs.map((code) => ({ code })),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=SUM");
    expect(parseCsv(csv).rows.map((row) => row.code)).toEqual(
      inputs.map((value) => value.trim()),
    );
  });
});
