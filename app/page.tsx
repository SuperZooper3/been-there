import { createServerClient } from "@/lib/supabase-server";
import LandingPage from "@/components/LandingPage";
import MapApp from "@/components/MapApp";

export default async function Home() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <LandingPage />;

  return <MapApp />;
}
