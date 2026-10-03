#!/usr/bin/env bash
# Read client crash telemetry on the VPS (/var/log/ai-gaem/client-errors.jsonl, written by the
# forge service's POST /api/forge/telemetry).
#
#   scripts/client-errors.sh                 last 50 reports (pretty, one line each)
#   scripts/client-errors.sh -n 200          last 200
#   scripts/client-errors.sh -f              follow live
#   scripts/client-errors.sh -g Ash          only lines matching a pattern (name, kind, message, GPU…)
#   scripts/client-errors.sh -k contextlost  only one report kind (error, rejection, contextlost,
#                                            contextrestored, wasm, ws, mem, frame, fps, test, …)
#   scripts/client-errors.sh --raw           raw JSONL (pipe into jq yourself)
#   scripts/client-errors.sh --summary       counts per kind and per player
set -euo pipefail
HOST="${DEPLOY_HOST:-root@187.7.27.171}"
LOG=/var/log/ai-gaem/client-errors.jsonl
N=50; FOLLOW=0; GREP=""; KIND=""; RAW=0; SUMMARY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -n) N="$2"; shift 2 ;;
    -f) FOLLOW=1; shift ;;
    -g) GREP="$2"; shift 2 ;;
    -k) KIND="$2"; shift 2 ;;
    --raw) RAW=1; shift ;;
    --summary) SUMMARY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done

if [ "$SUMMARY" = 1 ]; then
  ssh "$HOST" "cat $LOG.1 $LOG 2>/dev/null" | python3 -c '
import sys, json, collections
kinds = collections.Counter(); players = collections.Counter(); gpus = collections.Counter()
for line in sys.stdin:
    try: r = json.loads(line)
    except Exception: continue
    kinds[r.get("kind")] += 1
    players[(r.get("name") or "?") + " " + (r.get("id") or "")] += 1
    if r.get("kind") != "mem": gpus[r.get("gpu") or "?"] += 1
print("by kind:");   [print(f"  {n:6d}  {k}") for k, n in kinds.most_common()]
print("by player:"); [print(f"  {n:6d}  {k}") for k, n in players.most_common(25)]
print("by GPU (non-mem reports):"); [print(f"  {n:6d}  {k}") for k, n in gpus.most_common(15)]
'
  exit 0
fi

PRETTY=$(cat <<'PY'
import sys, json
for line in sys.stdin:
    try:
        r = json.loads(line)
    except Exception:
        print(line.rstrip()); continue
    head = "%s %-15s %s(%s) v=%s %s" % (str(r.get("ts", ""))[:19], r.get("kind", "?"), r.get("name") or "?", r.get("id") or "-", r.get("v", "?"), r.get("screen", ""))
    skip = {"ts", "kind", "name", "id", "v", "screen", "ua", "gpu", "stack"}
    rest = " ".join("%s=%s" % (k, json.dumps(v)[:300]) for k, v in r.items() if k not in skip)
    print(head, rest)
    if r.get("stack"):
        print("    " + str(r["stack"])[:1500].replace("\n", "\n    "))
    if r.get("kind") != "mem":
        print("    gpu=%s  ua=%s" % (r.get("gpu", "?"), str(r.get("ua", "?"))[:160]))
PY
)

FILTER="cat"
[ -n "$KIND" ] && FILTER="grep --line-buffered -F '\"kind\":\"$KIND\"'"
[ -n "$GREP" ] && FILTER="$FILTER | grep --line-buffered -i -- $(printf %q "$GREP")"
if [ "$FOLLOW" = 1 ]; then REMOTE="tail -n $N -F $LOG | $FILTER"; else REMOTE="cat $LOG 2>/dev/null | $FILTER | tail -n $N"; fi

if [ "$RAW" = 1 ]; then
  ssh "$HOST" "$REMOTE"
else
  ssh "$HOST" "$REMOTE" | python3 -u -c "$PRETTY"
fi
