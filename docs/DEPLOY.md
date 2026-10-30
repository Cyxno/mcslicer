# Deployment — cyxno.eu/mcslicer/ (Unraid, binhex-nginx)

How this app is built and deployed, and how to refresh it later.
Server paths below are the ones on the Unraid host (`homeserver`).

## Topology

Cloudflare → Nginx Proxy Manager (TLS, host `cyxno.eu`) → `binhex-nginx`
container (port 8283 → 8080). Static sites live under
`/mnt/cache/appdata/binhex-nginx/nginx/html/` (container `/config/nginx/html`),
site config in `/mnt/cache/appdata/binhex-nginx/nginx/config/conf.d/cyxno.conf`.

mcslicer is served from its own webroot:

    webroot (host)   /mnt/cache/appdata/binhex-nginx/nginx/html/mcslicer
    webroot (container) /config/nginx/html/mcslicer
    URL              https://cyxno.eu/mcslicer/

Inside the webroot, `default-assets/` is operator-owned and excluded from
deploys, so textures can be refreshed without a new release.

## Build

The base must match the subpath; local dev stays at `/`:

    VITE_BASE=/mcslicer/ npm run build      # outputs dist/
    npm run dev                             # local, base /

Quality gate before every deploy:

    npm ci && npm run lint && npm test && VITE_BASE=/mcslicer/ npm run build

## Deploy a new version

    VITE_BASE=/mcslicer/ npm run build
    rsync -rlpt --delete --exclude=default-assets \
      dist/ /mnt/cache/appdata/binhex-nginx/nginx/html/mcslicer/

- `-rlpt` preserves mtimes/permissions, no temp files; `--delete` removes
  stale hashed chunks; `default-assets/` survives.
- No nginx reload needed for content-only changes (static files).
- Rollback: rebuild the previous commit and rsync again (hashed filenames
  make old and new chunks coexist safely mid-transfer).

## Default textures (vanilla assets, operator-supplied)

The repo ships **no** Mojang assets. The empty
`default-assets/manifest.json` makes the app start cleanly in color mode.

To install the real set:

    scripts/prepare-default-assets.sh <pad-of-url-naar-vanilla-zip>
    rsync -rlpt --delete \
      public/default-assets/ \
      /mnt/cache/appdata/binhex-nginx/nginx/html/mcslicer/default-assets/

No rebuild, no nginx reload — the manifest is served with `no-cache` and
the app re-reads it per session. Check the result: the status bar should
report `N types (default assets)` after loading a schematic.

## nginx (only when changing routing)

The `location ^~ /mcslicer/` block lives in
`/mnt/cache/appdata/binhex-nginx/nginx/config/conf.d/cyxno.conf`
(backup convention: `*.bak-<topic>-<ts>`). After edits:

    docker exec binhex-nginx nginx -t && docker exec binhex-nginx nginx -s reload

Caching policy: `index.html` and `default-assets/manifest.json` → `no-cache`;
hashed `assets/*` and images → `public, max-age=31536000, immutable`;
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on the
whole subpath. `/mcslicer` (no slash) 301s to `/mcslicer/`.

## Logs

    docker logs --tail 100 binhex-nginx           # nginx access/error
    docker exec binhex-nginx tail -20 /var/log/nginx/error.log
    NPM (TLS front):  docker logs --tail 100 Nginx-Proxy-Manager-Official
    site pipeline:    /mnt/cache/appdata/cyxno-deploy/deploy/logs/deploy.log

## Homepage link

The card on cyxno.eu comes from the **cyxno-site** repo
(`src/data/projects.ts`, slug `mcslicer`) and is deployed by the normal
pull-based pipeline (`deploy-site.sh`, runs every 15 min; manual run:
`/mnt/cache/appdata/cyxno-deploy/deploy/deploy-site.sh`). Adding a project
slug also requires adding it to the two `/projects/(…)` whitelists in
`cyxno.conf`.
