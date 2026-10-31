import { writeFileSync } from 'node:fs';
import { pool, queryOne } from './pool';
import { invoicesService } from '../modules/invoices/invoices.service';
const out = process.argv[2]!;
const paid = await queryOne<{ id: number }>(
  pool,
  `SELECT i.id FROM invoices i WHERE i.status='paid' AND i.amount_discount > 0 ORDER BY i.id LIMIT 1`,
);
writeFileSync(`${out}/paid.pdf`, (await invoicesService.pdf(paid!.id)).content);
const intra = await queryOne<{ id: number }>(
  pool,
  `SELECT i.id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE c.state_code='09' AND i.status='confirmed' ORDER BY i.id LIMIT 1`,
);
writeFileSync(`${out}/intra.pdf`, (await invoicesService.pdf(intra!.id)).content);
await pool.end();
