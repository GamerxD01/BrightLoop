import { queryOne, type Db } from '../db/pool';

/**
 * Next document number, e.g. SUB/2026/00042. The upsert takes a row lock, so
 * two concurrent transactions can never receive the same number.
 */
export async function nextNumber(
  db: Db,
  prefix: 'SUB' | 'INV',
  date = new Date(),
): Promise<string> {
  const year = date.getUTCFullYear();
  const row = await queryOne<{ lastValue: number }>(
    db,
    `INSERT INTO document_sequences (prefix, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (prefix, year) DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [prefix, year],
  );
  return `${prefix}/${year}/${String(row!.lastValue).padStart(5, '0')}`;
}
