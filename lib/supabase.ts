import { createClient } from '@supabase/supabase-js';

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://bderfrcfuhnutuoyudje.supabase.co';

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  'build-placeholder-key';

export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } }
});
