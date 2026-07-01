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
opencode_preload="$opencode_dir/node_modules/@opentui/solid/scripts/preload.ts"

LOGDIR="$space/.wopal-space/logs"
PIDFILE="$LOGDIR/ellamaka-dev.pid"
APP_DEBUG_LOG="$LOGDIR/dev.log"

stop() {
  local pids=()
  if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
      pids+=("$pid")
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  rm -f "$LOGDIR/ellamaka-dev-server.log" "$LOGDIR/wopal-plugins-debug.log"
  for port in 4097 3000; do
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

Usage: $self [command|option]

  Commands:
    serve        Start backend as headless HTTP server
    stop          Stop all dev servers
    help          Show this help message

  Options:
    -a, --attach      Start HTTP server + attach TUI client
    --debug [mods]    Enable debug mode (default: all)
                      Modules: task, rules, or comma-separated list
    -ns               Disable WopalSpace mode (native opencode behavior)
    -h, --help        Forwarded to ellamaka

  Without args, starts TUI directly (no HTTP server, backend in-process).

  Pass-through:
    After --, all args are forwarded to ellamaka verbatim.
    Example: $self -- --help

Debug logs:
  $LOGDIR/ellamaka-dev-server.log   Backend stdout/stderr
  $LOGDIR/wopal-plugins-debug.log   Plugin debug output

Server: http://127.0.0.1:4097 (dev) / http://127.0.0.1:4096 (prod)
EOF
}

cmd=""
attach=false
debug=false
debug_modules=""
passthrough=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; passthrough+=("$@"); break ;;
    stop|help|serve) cmd="$1"; shift ;;
    -a|--attach) attach=true; shift ;;
    -h|--help) passthrough+=(--help); shift ;;
    --debug)
      debug=true
      if [[ $# -gt 1 ]] && [[ ! "$2" =~ ^- ]]; then
        debug_modules="$2"; shift 2
      else
        debug_modules="all"; shift
      fi
      ;;
    -ns) passthrough+=(--disable-wopalspace); shift ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

case "$cmd" in
  stop) stop; exit ;;
  help) usage; exit ;;
esac

if ! $attach && [ "$cmd" != "serve" ]; then
  # ----- default: TUI with in-process backend (no HTTP server) -----
  mkdir -p "$LOGDIR"
  caller_pwd="$(pwd)"
  tui_args=()
  tui_env=()

  if [ "$debug" = true ]; then
    tui_args+=(--log-level DEBUG)
    tui_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
    echo "debug enabled (modules: $debug_modules)"
    echo "  plugin log: $LOGDIR/wopal-plugins-debug.log"
    echo "  app log:    $APP_DEBUG_LOG"
    echo ""
    echo "watch: tail -f $LOGDIR/wopal-plugins-debug.log"
    sleep 1
  fi

  # TUI 在用户调用目录下启动，识别项目上下文
  cd "$caller_pwd"
  exec env "${tui_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" "${tui_args[@]}" "${passthrough[@]}"
fi

mkdir -p "$LOGDIR"

# ----- helpers -----

is_running() { lsof -ti :"$1" > /dev/null 2>&1; }

wait_backend() {
  local i
  for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:4097/health > /dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

warmup_config() {
  curl -sf -H "x-opencode-directory: $space" http://127.0.0.1:4097/config > /dev/null 2>&1 || true
}

start_backend() {
  local srv_env=()
  local srv_args=(serve --port 4097 --print-logs)

  if [ "$debug" = true ]; then
    srv_args+=(--log-level DEBUG)
    srv_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
  fi

  srv_args+=("${passthrough[@]}")

  cd "$space"
  env "${srv_env[@]}" \
    nohup bun --preload "$opencode_preload" "$opencode_entry" "${srv_args[@]}" > "$LOGDIR/ellamaka-dev-server.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PIDFILE"
}

# ----- attach mode (HTTP server + TUI client) -----

if $attach; then
if ! is_running 4097; then
    [ "$debug" = true ] && echo "logs: $LOGDIR/ellamaka-dev-server.log"
    start_backend
    echo -n "starting server (pid $(cat "$PIDFILE"))"
    wait_backend && echo " ready" || echo " (health check timeout)"
  else
    echo "attaching to running server"
    if ! wait_backend; then
      echo "backend not healthy, please run '$self stop' first"
      exit 1
    fi
  fi
  warmup_config
  cd "$opencode_dir"
  exec bun --preload "$opencode_preload" "$opencode_entry" attach "http://localhost:4097" --dir "$space"
fi

# ----- serve mode -----

if [ "$cmd" = "serve" ]; then
if [ -f "$PIDFILE" ] || is_running 4097; then
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

echo "started (backend :4097)"

wait_backend && warmup_config

echo "run '$self stop' to stop"
fi
