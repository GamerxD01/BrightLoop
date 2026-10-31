import type { CompanyInput } from '@brightloop/shared';
import { query, queryOne, type Db } from '../../db/pool';

export interface Company extends CompanyInput {
  hasLogo: boolean;
  updatedAt: string;
}

const COLUMNS = `brand_name, legal_name, address_line, city, state_code, pincode, gstin, email, phone, website,
  bank_name, bank_account, bank_ifsc, upi_id, invoice_footer, logo IS NOT NULL AS has_logo, updated_at`;

export const companyRepository = {
  get: async (db: Db) => (await queryOne<Company>(db, `SELECT ${COLUMNS} FROM company_settings`))!,

  update: (db: Db, c: CompanyInput) =>
    query(
      db,
      `UPDATE company_settings SET brand_name=$1, legal_name=$2, address_line=$3, city=$4, state_code=$5, pincode=$6,
              gstin=$7, email=$8, phone=$9, website=$10, bank_name=$11, bank_account=$12, bank_ifsc=$13, upi_id=$14,
              invoice_footer=$15, updated_at=now()`,
      [
        c.brandName,
        c.legalName,
        c.addressLine,
        c.city,
        c.stateCode,
        c.pincode,
        c.gstin,
        c.email,
        c.phone,
        c.website,
        c.bankName,
        c.bankAccount,
        c.bankIfsc,
        c.upiId,
        c.invoiceFooter,
      ],
    ),

  getLogo: (db: Db) =>
    queryOne<{ logo: Buffer | null; logoMime: string | null; updatedAt: Date }>(
      db,
      'SELECT logo, logo_mime, updated_at FROM company_settings',
    ),

  setLogo: (db: Db, logo: Buffer | null, mime: string | null) =>
    query(db, 'UPDATE company_settings SET logo = $1, logo_mime = $2, updated_at = now()', [
      logo,
      mime,
    ]),
};
