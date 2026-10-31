import type {
  AttributeInput,
  ListQuery,
  PaymentTermInput,
  ProductInput,
  TaxInput,
} from '@brightloop/shared';
import { isUniqueViolation, pool, withTransaction } from '../../db/pool';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { events } from '../../lib/events';
import { paginated } from '../../lib/pagination';
import { catalogRepository as repo } from './catalog.repository';

const nameTaken = (what: string) =>
  new ConflictError(`A ${what} with this name already exists`, { name: 'Already in use' });
const changed = (entity: string) => events.publish({ type: 'catalog.changed', data: { entity } });

export const catalogService = {
  listTaxes: () => repo.listTaxes(pool),

  async saveTax(input: TaxInput, id?: number) {
    try {
      const tax = id ? await repo.updateTax(pool, id, input) : await repo.insertTax(pool, input);
      if (!tax) throw new NotFoundError('Tax');
      changed('tax');
      return tax;
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken('tax');
      throw err;
    }
  },

  listPaymentTerms: () => repo.listPaymentTerms(pool),

  async createPaymentTerm(input: PaymentTermInput) {
    try {
      return await repo.insertPaymentTerm(pool, input);
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken('payment term');
      throw err;
    }
  },

  listAttributes: () => repo.listAttributes(pool),

  async saveAttribute(input: AttributeInput, id?: number) {
    try {
      await withTransaction(async (tx) => {
        const attributeId = id
          ? (await repo.renameAttribute(tx, id, input.name))?.id
          : (await repo.insertAttribute(tx, input.name)).id;
        if (!attributeId) throw new NotFoundError('Attribute');
        for (const value of input.values) await repo.upsertAttributeValue(tx, attributeId, value);
      });
      changed('attribute');
      return repo.listAttributes(pool);
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken('attribute or value');
      throw err;
    }
  },

  async listProducts(q: ListQuery & { type?: string; active?: boolean }) {
    return paginated(await repo.listProducts(pool, q), q);
  },

  async getProduct(id: number) {
    const product = await repo.findProduct(pool, id);
    if (!product) throw new NotFoundError('Product');
    return product;
  },

  async saveProduct(input: ProductInput, id?: number) {
    const valueIds = [...new Set(input.variantValueIds)];
    if (valueIds.length && (await repo.countAttributeValues(pool, valueIds)) !== valueIds.length) {
      throw new ValidationError({
        variantValueIds: 'One of the selected variants no longer exists',
      });
    }
    if (input.taxId && !(await repo.findTax(pool, input.taxId))) {
      throw new ValidationError({ taxId: 'Tax not found' });
    }
    const productId = await withTransaction(async (tx) => {
      const row = id
        ? await repo.updateProduct(tx, id, input)
        : await repo.insertProduct(tx, input);
      if (!row) throw new NotFoundError('Product');
      await repo.syncVariants(tx, row.id, valueIds);
      return row.id;
    });
    changed('product');
    return this.getProduct(productId);
  },
};
