import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922010000_atomic_stripe_credit_webhooks.sql',
), 'utf8');
const schemaReloadSql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922010100_reload_atomic_stripe_webhook_schema.sql',
), 'utf8');

describe('atomic Stripe Credit webhook migration', () => {
  it('claims each Stripe event once before changing an order', () => {
    expect(sql).toMatch(/create or replace function public\.process_stripe_checkout_event/i);
    expect(sql).toMatch(/insert into public\.payment_webhook_events[\s\S]*on conflict \(id\) do nothing/i);
    expect(sql).toMatch(/if not found then[\s\S]*processed[\s\S]*false/i);
    expect(sql).toMatch(/from public\.payment_orders[\s\S]*for update/i);
  });

  it('updates the order and grants paid Checkout Credits in the same function', () => {
    expect(sql).toMatch(/update public\.payment_orders/i);
    expect(sql).toMatch(/insert into public\.credit_ledger_entries/i);
    expect(sql).toMatch(/reference_key[\s\S]*'stripe-checkout:'\s*\|\|\s*p_session_id/i);
    expect(sql).toMatch(/p_credit_amount\s*<=\s*0/i);
    expect(sql).toMatch(/p_status\s+not in\s*\('paid',\s*'failed'\)/i);
  });

  it('exposes the transaction only to the service role', () => {
    expect(sql).toMatch(/security definer\s+set search_path\s*=\s*''/i);
    expect(sql).toMatch(/revoke all on function public\.process_stripe_checkout_event[\s\S]*from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.process_stripe_checkout_event[\s\S]*to service_role/i);
  });

  it('reloads the PostgREST schema for both fresh and already-migrated environments', () => {
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
    expect(schemaReloadSql).toMatch(/notify pgrst,\s*'reload schema'/i);
  });
});
