/** Supabase client for RupeeTrail.
 *
 * Configuration (Vite env, see .env.example):
 *   VITE_SUPABASE_URL=https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY=<anon key>
 *
 * Access is scoped by the device's member token. Every request carries it in the
 * `x-rt-token` header, and the Postgres policies in supabase/migrations compare
 * it against the membership row. Without a valid token a client sees nothing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

// One client per token: the header is fixed at creation time.
const clients = new Map<string, SupabaseClient>()

/**
 * Get a Supabase client that authenticates as one group membership.
 * Pass an empty token for the public client (used by create/join RPCs).
 */
export function getSupabase(token = ''): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }

  const cached = clients.get(token)
  if (cached) return cached

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { 'x-rt-token': token } : {} },
  })

  if (token) clients.set(token, client)
  return client
}

export type { SupabaseClient }
