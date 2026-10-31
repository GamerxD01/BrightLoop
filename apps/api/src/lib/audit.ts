import { query, type Db } from '../db/pool';

export interface AuditEntry {
  actorId: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  data?: Record<string, unknown>;
  requestId?: string;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await query(
    db,
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, data, request_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actorId,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.data ?? null,
      entry.requestId ?? null,
    ],
  );
}
