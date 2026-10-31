import type { CustomerInput, ListQuery } from '@brightloop/shared';
import { isUniqueViolation, pool, type Db } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { paginated } from '../../lib/pagination';
import { customersRepository, type Customer } from './customers.repository';

const duplicateEmail = () =>
  new ConflictError('A customer with this email already exists', { email: 'Already in use' });

export const customersService = {
  async list(q: ListQuery) {
    return paginated(await customersRepository.list(pool, q), q);
  },

  async get(id: number): Promise<Customer> {
    const customer = await customersRepository.findById(pool, id);
    if (!customer) throw new NotFoundError('Customer');
    return customer;
  },

  async create(input: CustomerInput) {
    try {
      return await customersRepository.insert(pool, input);
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateEmail();
      throw err;
    }
  },

  async update(id: number, input: CustomerInput) {
    try {
      const updated = await customersRepository.update(pool, id, input);
      if (!updated) throw new NotFoundError('Customer');
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateEmail();
      throw err;
    }
  },

  /**
   * A customer the sales team already created (same email) gets linked to the
   * new login instead of duplicated, so their history shows up in the portal.
   */
  async findOrCreateForSignup(
    db: Db,
    input: { name: string; email: string; company: string | null },
  ) {
    const existing = await customersRepository.findByEmail(db, input.email);
    if (existing) return existing;
    return customersRepository.insert(db, { ...input, phone: null, address: null });
  },
};
