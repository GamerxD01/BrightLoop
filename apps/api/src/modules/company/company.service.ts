import { LOGO_MAX_BYTES, stateName, type CompanyInput } from '@brightloop/shared';
import { pool, type Db } from '../../db/pool';
import { audit } from '../../lib/audit';
import { ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { companyRepository as repo, type Company } from './company.repository';

/** The seller as printed on an invoice, frozen into the invoice when it is issued. */
export interface SellerSnapshot {
  legalName: string;
  brandName: string;
  address: string | null;
  stateCode: string | null;
  stateName: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  bank: { name: string | null; account: string | null; ifsc: string | null } | null;
  upiId: string | null;
  footer: string | null;
}

/** Recognise the file by its first bytes, not by what the browser claims. */
function sniffImage(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    buf.length > 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

let cache: { company: Company; at: number } | null = null;

export const companyService = {
  async get(db: Db = pool): Promise<Company> {
    if (db === pool && cache && Date.now() - cache.at < 30_000) return cache.company;
    const company = await repo.get(db);
    if (db === pool) cache = { company, at: Date.now() };
    return company;
  },

  /** What anyone may see, signed in or not: the name and whether a logo exists. */
  async brand() {
    const c = await this.get();
    return {
      brandName: c.brandName,
      legalName: c.legalName,
      hasLogo: c.hasLogo,
      version: new Date(c.updatedAt).getTime(),
    };
  },

  async update(input: CompanyInput, actor: Actor) {
    await repo.update(pool, input);
    cache = null;
    await audit(pool, {
      actorId: actor.userId,
      action: 'update_company',
      entity: 'company',
      data: { ...input },
      requestId: actor.requestId,
    });
    events.publish({ type: 'catalog.changed', data: { entity: 'company' } });
    return this.get();
  },

  async setLogo(body: unknown, actor: Actor) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new ValidationError({ logo: 'Choose a PNG or JPEG file' });
    if (body.length > LOGO_MAX_BYTES)
      throw new ValidationError({ logo: 'The logo must be 512 KB or smaller' });
    const mime = sniffImage(body);
    if (!mime) throw new ValidationError({ logo: 'Only PNG or JPEG images are accepted' });
    await repo.setLogo(pool, body, mime);
    cache = null;
    await audit(pool, {
      actorId: actor.userId,
      action: 'update_logo',
      entity: 'company',
      data: { bytes: body.length, mime },
      requestId: actor.requestId,
    });
    events.publish({ type: 'catalog.changed', data: { entity: 'company' } });
    return this.get();
  },

  async removeLogo(actor: Actor) {
    await repo.setLogo(pool, null, null);
    cache = null;
    await audit(pool, {
      actorId: actor.userId,
      action: 'remove_logo',
      entity: 'company',
      requestId: actor.requestId,
    });
    return this.get();
  },

  logo: () => repo.getLogo(pool),

  async snapshot(db: Db = pool): Promise<SellerSnapshot> {
    const c = await this.get(db);
    const address = [
      c.addressLine,
      c.city,
      c.pincode ? `${stateName(c.stateCode) ?? ''} ${c.pincode}`.trim() : stateName(c.stateCode),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      legalName: c.legalName,
      brandName: c.brandName,
      address: address || null,
      stateCode: c.stateCode,
      stateName: stateName(c.stateCode),
      gstin: c.gstin,
      email: c.email,
      phone: c.phone,
      bank: c.bankAccount ? { name: c.bankName, account: c.bankAccount, ifsc: c.bankIfsc } : null,
      upiId: c.upiId,
      footer: c.invoiceFooter,
    };
  },
};
