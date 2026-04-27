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
opencode_entry="$root/packages/opencode/src/index.ts"
opencode_dir="$root/packages/opencode"

LOGDIR="$space/logs"
PIDFILE="$LOGDIR/ellamaka-dev.pid"

stop() {
  local pids=()
  if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
      pids+=("$pid")
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  rm -f "$LOGDIR/ellamaka-dev-server.log" "$LOGDIR/wopal-plugins-debug.log"
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
ellamaka - EllaMaka dev launcher

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

Debug logs:
  $LOGDIR/ellamaka-dev-server.log   Backend stdout/stderr
  $LOGDIR/wopal-plugins-debug.log   Plugin debug output

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
    stop|-h|--help|help|server) cmd="$1"; shift ;;
    backend) cmd="server"; backend_only=true; shift ;;
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

mkdir -p "$LOGDIR"

# ----- helpers -----

is_running() { lsof -ti :"$1" > /dev/null 2>&1; }

wait_backend() {
  local i
  for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:4096/health > /dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

warmup_config() {
  curl -sf -H "x-opencode-directory: $space" http://127.0.0.1:4096/config > /dev/null 2>&1 || true
}

start_backend() {
  local srv_env=(
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1
    OPENCODE_DISABLE_AGENTS_SKILLS=1
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1
  )
  local srv_args=(serve --wopal-space --port 4096 --print-logs)

  if [ "$debug" = true ]; then
    srv_args+=(--log-level DEBUG)
    srv_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
    )
  fi

  cd "$space"
  env "${srv_env[@]}" \
    nohup bun "$opencode_entry" "${srv_args[@]}" > "$LOGDIR/ellamaka-dev-server.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDFILE"
}

start_frontend() {
  local port=3000
  while is_running "$port"; do ((port++)); done
  nohup bun --cwd "$root/packages/app" dev -p "$port" > /dev/null 2>&1 &
  echo $! >> "$PIDFILE"
  echo "frontend :$port started"
}

# ----- tui mode -----

if [ "$cmd" = "tui" ]; then
  if ! is_running 4096; then
    [ "$debug" = true ] && echo "logs: $LOGDIR/ellamaka-dev-server.log"
    start_backend
    echo -n "starting server (pid $(cat "$PIDFILE"))"
    wait_backend && echo " ready" || echo " (health check timeout)"
    start_frontend
  else
    echo "attaching to running server"
  fi
  warmup_config
  cd "$opencode_dir"
  exec bun "$opencode_entry" attach "http://localhost:4096" --dir "$space"
fi

# ----- server mode -----

if [ -f "$PIDFILE" ] || is_running 4096 || is_running 3000; then
  echo "already running."
  read -p "stop and restart? [Y/n] " yn
  case "${yn:-Y}" in
    [Yy]*) stop; echo "";;
    *) exit 0;;
  esac
fi

[ "$debug" = true ] && echo "debug: modules=$debug_modules"
echo "logs: $LOGDIR/"

start_backend

if [ "$backend_only" = false ]; then
  start_frontend
  echo "started (backend :4096 + frontend)"
else
  echo "started (backend :4096)"
fi

wait_backend && warmup_config

echo "run '$self stop' to stop"
