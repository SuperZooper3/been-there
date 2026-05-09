# Manual Setup Checklist

These are the external service steps you need to complete before running the app. It takes about 15 minutes total.

---

## 1. Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New project**, give it a name (e.g. `been-there`), and choose a region close to you (US West for SF).
3. Wait for the project to finish provisioning (about a minute).
4. Go to **Project Settings > API**.
5. Copy:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 2. Enable email magic link auth

1. In the Supabase dashboard, go to **Authentication > Providers**.
2. Make sure **Email** is enabled (it is by default).
3. Under **Email**, confirm **Enable magic link** is turned on.

That's it — no OAuth credentials needed.

---

## 3. Run the database migration

1. In the Supabase dashboard, go to **SQL Editor**.
2. Open `supabase/migrations/001_initial.sql` from this repo.
3. Paste the full contents and click **Run**.
4. Confirm no errors appear and that `visit_cells` and `place_photos` show up under **Table Editor**.

---

## 4. Create the photo storage bucket

1. Go to **Storage** in the Supabase dashboard.
2. Click **New bucket**.
3. Name it exactly: `photos`
4. Set it to **Public** (so photo URLs are accessible without auth tokens).
5. Click **Create bucket**.

---

## 5. Set up local environment

1. Copy the example env file:
   ```bash
   cp .env.local.example .env.local
   ```
2. Fill in the two values you copied in step 1:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

That's all the env vars needed. No Stadia API key is required — Stadia uses domain-based authentication for web apps, which works automatically in the browser.

---

## 6. Install and run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter your email, check your inbox for the sign-in link, and you're in.

---

## 7. Deploy to Vercel

1. Push the repo to GitHub.
2. Go to [vercel.com](https://vercel.com), click **Add New Project**, and import the repo.
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**.
5. Once deployed, copy your Vercel URL (e.g. `been-there.vercel.app`) and do two things:

   **In Supabase:**
   - **Authentication > URL Configuration > Site URL** → set to `https://been-there.vercel.app`
   - **Authentication > URL Configuration > Redirect URLs** → add `https://been-there.vercel.app/**`

   **In Stadia Maps:**
   - Sign in at [stadiamaps.com](https://stadiamaps.com) and go to **Manage Properties**.
   - Under **Authentication Configuration**, click **Add Domain**.
   - Enter your Vercel domain (e.g. `been-there.vercel.app`).
   - No API key or code changes needed — Stadia authenticates web apps by domain automatically.

---

## Summary of env vars

| Variable | Where to get it | Required locally? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase > Project Settings > API | Yes |

Stadia Maps requires no env var — it authenticates via domain in production and works on localhost with no setup

---

## 8. Build the Android app (optional — for background GPS tracking)

Background geolocation requires the native Android app. See the full step-by-step guide:

→ **[`docs/android-setup.md`](./android-setup.md)**

It covers installing Android Studio, building a debug build, creating a release keystore, generating a signed APK, and sideloading it onto a device.
