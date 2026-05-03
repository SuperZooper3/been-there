import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";

// Database types are generated from Supabase CLI during setup.
// To generate: npx supabase gen types typescript --project-id <id> > lib/database.types.ts
export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
