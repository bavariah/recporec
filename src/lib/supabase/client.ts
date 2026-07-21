import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isLocalSupabaseUrl = (() => {
  if (!url) return false;

  try {
    const hostname = new URL(url).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
})();

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: !isLocalSupabaseUrl,
          detectSessionInUrl: true,
        },
      })
    : null;

export async function isSupabaseReachable() {
  if (!url) return false;

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
