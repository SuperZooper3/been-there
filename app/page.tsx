import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase-server";
import MapApp from "@/components/MapApp";

export default async function Home() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <MapApp user={user} />;
}
