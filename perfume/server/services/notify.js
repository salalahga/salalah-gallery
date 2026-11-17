import { id } from '../util.js';

/** In-app notification. External delivery (WhatsApp/email/SMS) hooks in here once those integrations are configured. */
export async function notify(q, { kind, title, body, userId, roles, branchId, entity, entityId, dedupeDay = false }) {
  if (dedupeDay) {
    const dup = await q.one(`SELECT id FROM notifications WHERE kind = $1 AND COALESCE(entity_id,'') = COALESCE($2,'') AND at > now() - interval '20 hours'`, [kind, entityId || null]);
    if (dup) return dup.id;
  }
  const nid = id('ntf_');
  await q(`INSERT INTO notifications (id, kind, title, body, user_id, roles, branch_id, entity, entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [nid, kind, title, body || null, userId || null, roles || null, branchId || null, entity || null, entityId || null]);
  return nid;
}

export async function listFor(q, user, limit = 50) {
  return q(`SELECT *, ($1 = ANY(read_by)) AS read FROM notifications WHERE (user_id = $1 OR (user_id IS NULL AND (roles IS NULL OR $2 = ANY(roles))))
    ORDER BY at DESC LIMIT $3`, [user.id, user.role === 'owner' ? 'owner' : user.role, limit]);
}
