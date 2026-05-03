import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";
import { snapToCell } from "@/lib/h3";

/**
 * GET /api/photos
 * Returns all photo pins for the current user.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("place_photos")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach public URLs for each photo
  const photos = (data ?? []).map((photo) => {
    const { data: urlData } = supabase.storage
      .from("photos")
      .getPublicUrl(photo.storage_key);
    return { ...photo, url: urlData.publicUrl };
  });

  return NextResponse.json({ photos });
}

/**
 * POST /api/photos
 * Body: FormData with fields: lat, lng, caption (optional), file (image)
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const lat = parseFloat(formData.get("lat") as string);
  const lng = parseFloat(formData.get("lng") as string);
  const caption = (formData.get("caption") as string | null) || null;
  const file = formData.get("file") as File | null;

  if (!file || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Upload to Supabase Storage
  const ext = file.name.split(".").pop() ?? "jpg";
  const storageKey = `${user.id}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("photos")
    .upload(storageKey, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Insert metadata
  const h3Index = snapToCell(lat, lng);
  const { data, error: insertError } = await supabase
    .from("place_photos")
    .insert({ user_id: user.id, h3_index: h3Index, lat, lng, storage_key: storageKey, caption })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("photos").getPublicUrl(storageKey);
  return NextResponse.json({ photo: { ...data, url: urlData.publicUrl } }, { status: 201 });
}

/**
 * DELETE /api/photos?id=<uuid>
 * Removes a photo pin and its stored file.
 */
export async function DELETE(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: photo, error: fetchError } = await supabase
    .from("place_photos")
    .select("storage_key")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !photo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabase.storage.from("photos").remove([photo.storage_key]);
  await supabase.from("place_photos").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}
