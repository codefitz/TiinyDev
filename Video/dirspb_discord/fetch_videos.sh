#!/bin/zsh
# Lists videos on the Tiiny OpenAI-compatible API and downloads every completed one.
# Usage: zsh fetch_videos.sh <token>
set -u
BASE="http://openai.api.tiiny/v1"
if (( $# != 1 )) || [[ -z "${1:-}" ]]; then
  print -u2 "Usage: zsh ${0:t} <token>"
  exit 2
fi
TOKEN="$1"
OUT="${0:A:h}"
cd "$OUT" || exit 1

curl -sS "$BASE/videos?limit=100" -H "Authorization: Bearer $TOKEN" -o videos.json || exit 1
echo "--- /v1/videos response saved to $OUT/videos.json"
python3 - <<'PY'
import json
d=json.load(open("videos.json"))
items=d.get("data", d if isinstance(d,list) else [])
for v in items:
    print(v.get("id"), v.get("status"), v.get("model"), v.get("seconds"), v.get("size"), (v.get("prompt") or "")[:60], sep=" | ")
open("ids.txt","w").write("\n".join(v["id"] for v in items if v.get("status") in ("completed","succeeded",None)))
PY

while read -r id; do
  [[ -z "$id" ]] && continue
  if [[ -s "$id.mp4" ]]; then echo "skip $id (exists)"; continue; fi
  echo "downloading $id ..."
  code=$(curl -sS -L "$BASE/videos/$id/content" -H "Authorization: Bearer $TOKEN" -o "$id.mp4" -w '%{http_code}')
  echo "  HTTP $code, $(stat -f%z "$id.mp4" 2>/dev/null) bytes, type: $(file -b "$id.mp4")"
done < ids.txt
