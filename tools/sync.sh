#!/usr/bin/env bash
#
# Re-pull every vendor file from hed.aulacn.com, then re-apply the Mongolian
# localisation on top.
#
#   bash tools/sync.sh
#
# Run this when AULA ships a driver or firmware update. It overwrites vendor
# files only; js/peaklab.js and tools/ are never touched.
#
# Afterwards: check the diff, test locally (node tools/serve.js), then push.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
BASE="https://hed.aulacn.com"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
MANIFEST="tools/manifest.txt"

if [ ! -f "$MANIFEST" ]; then
  echo "missing $MANIFEST" >&2
  exit 1
fi

echo "Syncing from $BASE"

fetch() {
  local p="$1" tmp code

  # Firmware zips and the rhythm plugin are tens of megabytes. Compare the
  # remote size first and skip the body when it is unchanged.
  case "$p" in
    config/firmware/*|plug/*)
      if [ -f "$p" ]; then
        local remote local_size
        remote=$(curl -sSI --max-time 30 -A "$UA" "$BASE/$p" 2>/dev/null \
                 | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)
        local_size=$(wc -c < "$p" 2>/dev/null | tr -d ' ')
        if [ -n "$remote" ] && [ "$remote" = "$local_size" ]; then
          echo "same   $p"; return
        fi
      fi
      ;;
  esac

  tmp="$(mktemp)"
  code=$(curl -sS --max-time 600 -o "$tmp" -w "%{http_code}" -A "$UA" "$BASE/$p" 2>/dev/null)
  if [ "$code" = "200" ] && [ -s "$tmp" ]; then
    mkdir -p "$(dirname "$p")"
    if [ -f "$p" ] && cmp -s "$tmp" "$p"; then
      rm -f "$tmp"; echo "same   $p"
    else
      mv -f "$tmp" "$p"; echo "UPDATED $p"
    fi
  else
    rm -f "$tmp"; echo "FAIL($code) $p"
  fi
}
export -f fetch
export BASE UA

# 12 at a time; the vendor's nginx is fine with it and serial takes minutes
xargs -P 12 -I{} bash -c 'fetch "$@"' _ {} < "$MANIFEST" | sort > /tmp/aula_sync.log
grep -c '^same'    /tmp/aula_sync.log | xargs echo "unchanged:"
grep '^UPDATED'    /tmp/aula_sync.log || true
grep '^FAIL'       /tmp/aula_sync.log || true

# Pick up files the vendor added since the manifest was written.
echo
echo "Checking for new config files the vendor may have added..."
for extra in config/language.json config/device.json config/firmware.json config/keys.json; do
  grep -qx "$extra" "$MANIFEST" || { echo "  NEW: $extra"; fetch "$extra"; }
done

# Firmware listed in firmware.json but not yet mirrored.
if command -v node >/dev/null 2>&1 && [ -f config/firmware.json ]; then
  node -e '
    const fs=require("fs");
    const j=JSON.parse(fs.readFileSync("config/firmware.json","utf8"));
    for (const d of (j.device||[])) {
      if (!fs.existsSync("config/firmware/"+d.file)) console.log(d.file);
    }
  ' | while read -r f; do
    [ -n "$f" ] || continue
    echo "  NEW firmware: $f"
    fetch "config/firmware/$f"
  done
fi

echo
echo "Re-applying Mongolian localisation..."
node tools/apply-mn.js

echo
echo "Refreshing manifest..."
find . -type f ! -path './tools/*' ! -path './.git/*' ! -name 'peaklab.js' \
  | sed 's#^\./##' | sort > "$MANIFEST"

echo
echo "Done. Review with:  git diff --stat"
echo "Test with:          node tools/serve.js"
