import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

/**
 * POST /api/cells/sync
 * Body: { clientBatchId: string, events: { op: 'paint'|'erase', h3: string, t?: string }[] }
 * Replays visit events via Postgres RPC (idempotent per clientBatchId).
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const clientBatchId = body.clientBatchId as string | undefined;
  const events = body.events as unknown;

  if (!clientBatchId || typeof clientBatchId !== "string") {
    return NextResponse.json({ error: "clientBatchId required" }, { status: 400 });
  }

  let parsedId: string;
  try {
    parsedId = clientBatchId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsedId)) {
      return NextResponse.json({ error: "clientBatchId must be a UUID" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid clientBatchId" }, { status: 400 });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "events array required" }, { status: 400 });
  }

  const normalized = events
    .filter(
      (e): e is { op: string; h3: string; t?: string } =>
        e != null &&
        typeof e === "object" &&
        (e.op === "paint" || e.op === "erase") &&
        typeof e.h3 === "string" &&
        e.h3.length > 0
    )
    .map((e) => ({
      op: e.op,
      h3: e.h3,
      t: typeof e.t === "string" ? e.t : new Date().toISOString(),
    }));

  if (normalized.length === 0) {
    return NextResponse.json({ error: "No valid events" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("apply_visit_batch", {
    p_client_batch_id: parsedId,
    p_events: normalized,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data as { ok?: boolean; duplicate?: boolean } | null;
  return NextResponse.json({
    applied: true,
    duplicate: result?.duplicate === true,
  });
}
