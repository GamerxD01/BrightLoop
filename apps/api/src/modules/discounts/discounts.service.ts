import type { DiscountInput } from '@brightloop/shared';
import { isUniqueViolation, pool, withTransaction } from '../../db/pool';
import { audit } from '../../lib/audit';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { discountsRepository as repo } from './discounts.repository';

export const discountsService = {
  list: () => repo.list(pool),

  async get(id: number) {
    const discount = await repo.findById(pool, id);
    if (!discount) throw new NotFoundError('Discount');
    return discount;
  },

  async save(input: DiscountInput, actor: Actor, id?: number) {
    if (id) {
      const current = await this.get(id);
      if (input.usageLimit !== null && input.usageLimit < current.timesUsed) {
        throw new ValidationError({ usageLimit: `Already used ${current.timesUsed} times` });
      }
    }
    const productIds = input.scope === 'products' ? [...new Set(input.productIds)] : [];
    try {
      const discountId = await withTransaction(async (tx) => {
        const row = id
          ? await repo.update(tx, id, input)
          : await repo.insert(tx, input, actor.userId);
        if (!row) throw new NotFoundError('Discount');
        await repo.replaceProducts(tx, row.id, productIds);
        await audit(tx, {
          actorId: actor.userId,
          action: id ? 'update_discount' : 'create_discount',
          entity: 'discount',
          entityId: row.id,
          data: { ...input },
          requestId: actor.requestId,
        });
        return row.id;
      });
      return this.get(discountId);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('A discount with this name already exists', {
          name: 'Already in use',
        });
      throw err;
    }
  },
};
