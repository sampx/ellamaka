#!/bin/bash
self="$(basename "$0")"

resolve() {
  local src="$1"
  while [ -L "$src" ]; do
    local dir="$(cd "$(dirname "$src")" && pwd)"
    src="$(readlink "$src")"
    [[ "$src" != /* ]] && src="$dir/$src"
  done
  echo "$src"
}

root="$(cd "$(dirname "$(resolve "$0")")/.." && pwd)"
space="$(cd "$root/../.." && pwd)"
opencode_bin="$root/packages/opencode/dist/opencode-darwin-x64/bin/ellamaka"

stop() {
  local pidfile="$space/.tmp/ellamaka-dev.pid"
  local pids=()
  if [ -f "$pidfile" ]; then
    while IFS= read -r pid; do
      pids+=("$pid")
    done < "$pidfile"
    rm -f "$pidfile"
  fi
  for port in 4096 3000; do
    local pp="$(lsof -ti :"$port" 2>/dev/null)"
    [ -n "$pp" ] && pids+=($pp)
  done
  if [ ${#pids[@]} -gt 0 ]; then
    for pid in $(printf '%s\n' "${pids[@]}" | sort -u); do
      kill "$pid" 2>/dev/null
    done
    echo "stopped"
  else
    echo "not running"
  fi
}

usage() {
  cat <<EOF
ellamaka - OpenCode dev launcher

Usage: $self [command] [options]

  Commands:
  (none)        Start opencode TUI (default)
  server        Start backend (+ frontend) as headless server
  backend       Start only the backend server
  stop          Stop all dev servers
  help          Show this help message

Options:
  -h, --help        Show this help message
  --debug [mods]    Enable debug mode (default: all)
                    Modules: task, rules, or comma-separated list

Debug logs (server mode only):
  $space/logs/backend.log              Backend stdout/stderr
  $space/logs/frontend.log             Frontend stdout/stderr
  $space/logs/wopal-plugins-debug.log  Plugin debug output

Server: http://127.0.0.1:4096
Frontend: http://localhost:3000
EOF
}

cmd="tui"
backend_only=false
debug=false
debug_modules=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    stop|-h|--help|help|server|backend) cmd="$1"; shift ;;
    --debug)
      debug=true
      if [[ $# -gt 1 ]] && [[ ! "$2" =~ ^- ]]; then
        debug_modules="$2"; shift 2
      else
        debug_modules="all"; shift
      fi
      ;;
    *) echo "unknown: $1"; exit 1 ;;
  esac
done

case "$cmd" in
  stop) stop; exit ;;
  -h|--help|help) usage; exit ;;
esac

if [ "$cmd" = "tui" ]; then
  debug_env=()
  if [ "$debug" = true ]; then
    mkdir -p "$space/logs"
    : > "$space/logs/wopal-plugins-debug.log"
    debug_env=(WOPAL_PLUGIN_DEBUG="$debug_modules" WOPAL_PLUGIN_LOG_FILE="$space/logs/wopal-plugins-debug.log")
  fi
  exec env "${debug_env[@]}" OPENCODE_CONFIG="$space/.wopal/opencode.jsonc" "$opencode_bin"
fi

# server / backend mode
pidfile="$space/.tmp/ellamaka-dev.pid"
logdir="$space/logs"

if [ -f "$pidfile" ] || [ -n "$(lsof -ti :4096 2>/dev/null)" ] || [ -n "$(lsof -ti :3000 2>/dev/null)" ]; then
  echo "already running. run '$self stop' first."
  exit 1
fi

mkdir -p "$space/.tmp"
backend_out="/dev/null"
debug_env=()
serve_flags=(--port 4096)

if [ "$debug" = true ]; then
  mkdir -p "$logdir"
  backend_out="$logdir/backend.log"
  : > "$logdir/wopal-plugins-debug.log"
  debug_env=(WOPAL_PLUGIN_DEBUG="$debug_modules" WOPAL_PLUGIN_LOG_FILE="$logdir/wopal-plugins-debug.log")
  serve_flags+=(--print-logs --log-level DEBUG)
  echo "debug: modules=$debug_modules"
  echo "logs:  $logdir/"
fi

OPENCODE_CONFIG="$space/.wopal/opencode.jsonc" \
  env "${debug_env[@]}" \
  nohup "$opencode_bin" serve "${serve_flags[@]}" > "$backend_out" 2>&1 &
echo $! >> "$pidfile"

if [ "$backend_only" = false ]; then
  nohup bun --cwd "$root/packages/app" dev >/dev/null 2>&1 &
  echo $! >> "$pidfile"
  echo "started (backend :4096, frontend :3000)"
else
  echo "started (backend :4096)"
fi

# warmup: trigger plugin lazy-loading
for i in $(seq 1 10); do
  if curl -sf http://127.0.0.1:4096/health > /dev/null 2>&1; then
    curl -sf -H "x-opencode-directory: $space" http://127.0.0.1:4096/api/v1/session > /dev/null 2>&1 || true
    break
  fi
  sleep 0.5
done

echo "run '$self stop' to stop"
