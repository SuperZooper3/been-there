'use strict';

/**
 * patch-package mutates node_modules for the Capacitor Android/iOS build (background-geolocation).
 * Vercel only runs `next build` — it never uses those native files — and `npm install` there can fail
 * to apply the same patch (different hoisting / integrity). Skip on Vercel.
 *
 * To skip elsewhere (e.g. a CI job that only runs Next): SKIP_PATCH_PACKAGE=1
 */
if (process.env.VERCEL || process.env.SKIP_PATCH_PACKAGE === '1') {
  console.log(
    '[postinstall] Skipping patch-package (not needed for this environment; native dev: run locally after npm install).'
  );
  process.exit(0);
}

const { execSync } = require('child_process');
const path = require('path');

execSync('npx patch-package', {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});
