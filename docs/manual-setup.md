# Manual Setup Checklist

These are the external service steps you need to complete. Do them while the code is being built — they take about 20 minutes total.

---

## 1. Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Choose a region close to you (US West for SF).
3. Once created, go to **Project Settings > API**.
4. Copy:
   - **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 2. Run database migrations

1. In the Supabase dashboard, go to **SQL Editor**.
2. Open `supabase/migrations/001_initial.sql` from this repo.
3. Paste the full contents and click **Run**.
4. Confirm no errors and that `visit_cells` and `place_photos` tables appear under **Table Editor**.

---

## 3. Supabase Storage bucket

1. Go to **Storage** in the Supabase dashboard.
2. Click **New bucket**.
3. Name it exactly: `photos`
4. Set it to **Public** (so photo URLs are accessible without auth tokens).
5. Click **Create bucket**.

---

## 4. Auth: Google OAuth

1. Go to **Authentication > Providers** in Supabase.
2. Enable **Google**.
3. You will need a Google OAuth Client ID and Secret:
   - Go to [console.cloud.google.com](https://console.cloud.google.com).
   - Create a project (or use an existing one).
   - Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.
   - Choose **Web application**.
   - Under **Authorized redirect URIs** add:
     `https://<your-supabase-project>.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client Secret** back into Supabase.
4. Save.

**If Google OAuth setup is blocked:** In Supabase **Authentication > Providers**, enable **Email** and make sure **Magic Link** is on. This is the fallback — no extra config needed.

---

## 5. Stadia Maps

1. Go to [stadiamaps.com](https://stadiamaps.com) and create a free account.
2. Create a new property for your domain (e.g. `been-there.vercel.app`).
3. Copy your **API key** → this is `NEXT_PUBLIC_STADIA_API_KEY`.

Note: for local development (`localhost`) Stadia tiles work without an API key. You only need the key for production.

---

## 6. Set up local environment

1. Copy the example env file:
   ```bash
   cp .env.local.example .env.local
   ```
2. Fill in the values you collected above:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   NEXT_PUBLIC_STADIA_API_KEY=your-stadia-key
   ```

---

## 7. Install dependencies and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## 8. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and import this GitHub repo.
2. Under **Environment Variables**, add the same three variables from step 6.
3. Add your Vercel deployment URL (e.g. `been-there.vercel.app`) to:
   - Supabase: **Authentication > URL Configuration > Site URL**
   - Supabase: **Authentication > URL Configuration > Redirect URLs** → add `https://been-there.vercel.app/**`
   - Google Cloud Console: **Authorized redirect URIs** (already done in step 4, but check)
4. Deploy.

---

## Summary of env vars

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase > Project Settings > API |
| `NEXT_PUBLIC_STADIA_API_KEY` | Stadia Maps dashboard |
