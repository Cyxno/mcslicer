#!/usr/bin/env bash
# Prepare the default block textures for a self-hosted mcslicer instance.
#
# The vanilla assets are NOT in the public repo (legal: Mojang's assets may
# not be redistributed; see README). This script extracts them from a zip
# YOU supply — a vanilla client jar template, an "assets zip", or any
# resource pack — into public/default-assets/, which Vite serves and the
# nginx image can carry. The result is gitignored.
#
# Usage:
#   scripts/prepare-default-assets.sh <path-or-url-to-zip>
#
# Accepted zip shapes:
#   - assets/minecraft/blockstates|models|textures/…   (jar / launcher export)
#   - minecraft/blockstates|models|textures/…          (pre-trimmed pack)
#   - blockstates|models|textures/…                    (flat pack root)
# Only blockstates/, models/ and textures/ are extracted (plus a generated
# manifest.json); anything else in the zip is ignored.
set -euo pipefail

die() { echo "prepare-default-assets: $*" >&2; exit 1; }

[ "$#" -eq 1 ] || die "gebruik: $0 <pad-of-url-naar-zip>"
command -v unzip >/dev/null || die "'unzip' niet gevonden in PATH"
command -v curl >/dev/null || die "'curl' niet gevonden in PATH"

ZIP_INPUT=$1
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$REPO_ROOT/public/default-assets"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---- acquire the zip ------------------------------------------------
case "$ZIP_INPUT" in
  http://*|https://*)
    echo "downloaden: $ZIP_INPUT"
    curl -fsSL --retry 2 -o "$TMP/in.zip" "$ZIP_INPUT" \
      || die "download mislukt (url bereikbaar? --retry uitgeput?)"
    ;;
  *)
    [ -f "$ZIP_INPUT" ] || die "bestand niet gevonden: $ZIP_INPUT"
    [ -s "$ZIP_INPUT" ] || die "bestand is leeg: $ZIP_INPUT"
    cp -- "$ZIP_INPUT" "$TMP/in.zip"
    ;;
esac

# ---- validate BEFORE touching the destination (no half work) --------
unzip -q "$TMP/in.zip" -d "$TMP/raw" || die "geen geldige zip"
SRC=""
for cand in "$TMP/raw/assets" "$TMP/raw"; do
  if [ -d "$cand/minecraft/blockstates" ] || [ -d "$cand/minecraft/textures" ] \
    || [ -d "$cand/blockstates" ]; then
    SRC=$cand
    break
  fi
done
[ -n "$SRC" ] || die "geen blockstates/models/textures gevonden — dit lijkt geen " \
  "vanilla-template of resource-pack-zip (verwacht assets/minecraft/…)"

COPY=()
[ -d "$SRC/minecraft/blockstates" ] && COPY+=("minecraft/blockstates")
[ -d "$SRC/minecraft/models" ] && COPY+=("minecraft/models")
[ -d "$SRC/minecraft/textures" ] && COPY+=("minecraft/textures")
[ -d "$SRC/blockstates" ] && COPY+=("blockstates")
[ -d "$SRC/models" ] && COPY+=("models")
[ -d "$SRC/textures" ] && COPY+=("textures")
[ "${#COPY[@]}" -gt 0 ] || die "zip bevat geen bruikbare assets-mappen"

# ---- stage in temp, then atomically swap into place ------------------
mkdir -p "$TMP/stage/minecraft"
for rel in "${COPY[@]}"; do
  mkdir -p "$TMP/stage/minecraft/$(dirname "$rel" | sed 's|^minecraft/||')"
  cp -r "$SRC/$rel" "$TMP/stage/minecraft/${rel#minecraft/}"
done

# manifest: every staged file as a JSON array (paths relative to stage root)
( cd "$TMP/stage" && find . -type f ! -name manifest.json -printf '%P\n' | sort > "$TMP/list.tmp" )
COUNT=$(wc -l < "$TMP/list.tmp" | tr -d ' ')
{
  printf '{"files":['
  sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/' "$TMP/list.tmp" | paste -sd, -
  printf ']}'
} > "$TMP/stage/manifest.json"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/stage" "$DEST"

echo "klaar: $COUNT bestanden in public/default-assets/ (blockstates/models/textures + manifest.json)"
echo "herstart de dev-server / herbouw de image om ze te serveren."
