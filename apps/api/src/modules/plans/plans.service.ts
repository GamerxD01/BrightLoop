import { todayIso, type IsoDate, type ListQuery, type PlanInput } from '@brightloop/shared';
import { isUniqueViolation, pool, type Db } from '../../db/pool';
import { ConflictError, NotFoundError, RuleError } from '../../lib/errors';
import { events } from '../../lib/events';
import { paginated } from '../../lib/pagination';
import { plansRepository, type Plan } from './plans.repository';

export const plansService = {
  async list(q: ListQuery) {
    return paginated(await plansRepository.list(pool, q), q);
  },

  async get(id: number, db: Db = pool): Promise<Plan> {
    const plan = await plansRepository.findById(db, id);
    if (!plan) throw new NotFoundError('Plan');
    return plan;
  },

  async save(input: PlanInput, id?: number) {
    try {
      const row = id
        ? await plansRepository.update(pool, id, input)
        : await plansRepository.insert(pool, input);
      if (!row) throw new NotFoundError('Plan');
      events.publish({ type: 'catalog.changed', data: { entity: 'plan' } });
      return this.get(row.id);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('A plan with this name already exists', { name: 'Already in use' });
      throw err;
    }
  },

  /** A plan can be sold only while active and inside its availability window. */
  assertSellable(plan: Plan, onDate: IsoDate = todayIso()) {
    if (!plan.isActive) throw new RuleError(`Plan "${plan.name}" is archived`);
    if (onDate < plan.startDate)
      throw new RuleError(`Plan "${plan.name}" is available from ${plan.startDate}`);
    if (plan.endDate && onDate > plan.endDate)
      throw new RuleError(`Plan "${plan.name}" stopped being available on ${plan.endDate}`);
  },
};
