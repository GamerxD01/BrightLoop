import type { TemplateInput } from '@brightloop/shared';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  pool,
  query,
  withTransaction,
} from '../../db/pool';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { templatesRepository as repo, type Template } from './templates.repository';

export const templatesService = {
  list: () => repo.list(pool),

  async get(id: number): Promise<Template> {
    const template = await repo.findById(pool, id);
    if (!template) throw new NotFoundError('Quotation template');
    return template;
  },

  async save(input: TemplateInput, id?: number) {
    try {
      const templateId = await withTransaction(async (tx) => {
        const row = id ? await repo.update(tx, id, input) : await repo.insert(tx, input);
        if (!row) throw new NotFoundError('Quotation template');
        await repo.replaceLines(tx, row.id, input.lines);
        return row.id;
      });
      return this.get(templateId);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('A template with this name already exists', {
          name: 'Already in use',
        });
      if (isForeignKeyViolation(err))
        throw new ValidationError({ _: 'The plan, payment term or a product no longer exists' });
      throw err;
    }
  },

  /** Subscriptions made from a template keep their lines; only the shortcut goes. */
  async remove(id: number) {
    const rows = await query<{ id: number }>(
      pool,
      'DELETE FROM quotation_templates WHERE id = $1 RETURNING id',
      [id],
    );
    if (!rows.length) throw new NotFoundError('Quotation template');
  },
};
