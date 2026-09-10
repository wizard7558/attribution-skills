import { buildGooglePayload, buildLinkedInPayload, buildMetaPayload, buildTikTokPayload, buildRedditPayload } from './provider-payloads.mjs';

const builders = new Map([
  ['google', buildGooglePayload], ['linkedin', buildLinkedInPayload], ['meta', buildMetaPayload],
  ['tiktok', buildTikTokPayload], ['reddit', buildRedditPayload],
]);

// The caller owns the pinned transaction, including rollback when this rejects.
export async function enqueueProviderConversion(tx, platform, input) {
  if (!tx || typeof tx.query !== 'function') throw new TypeError('tx.query must be a function');
  if (!builders.has(platform)) throw new TypeError('unsupported provider platform');
  const payload = builders.get(platform)(input);
  if (payload.status === 'blocked') {
    const error = new Error('capi_payload_blocked');
    error.code = 'capi_payload_blocked';
    error.reasons = [...payload.reasons];
    throw error;
  }
  const d = payload.destination;
  const result = await tx.query('SELECT * FROM capi_outbox.enqueue_conversion($1,$2,$3,$4,$5,$6,$7)', [
    d.platform, d.account_key, d.destination_key, d.event_type,
    payload.preparation.business_conversion_id, payload.preparation.event_id, payload.request.request_body,
  ]);
  if (!Array.isArray(result?.rows) || result.rows.length !== 1
    || !['inserted', 'replayed'].includes(result.rows[0]?.disposition)
    || !result.rows[0]?.snapshot || typeof result.rows[0].snapshot !== 'object' || Array.isArray(result.rows[0].snapshot)) {
    throw new Error('capi_outbox_invalid_result');
  }
  return { payload, disposition: result.rows[0].disposition, snapshot: result.rows[0].snapshot };
}
