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
ellamaka_app_dir="$root/packages/ellamaka-app"

LOGDIR="$space/.wopal-space/logs"
APP_DEBUG_LOG="$LOGDIR/dev.log"

stop() {
  local pids=()
  if [ -f "$PIDFILE" ]; then
    while IFS= read -r pid; do
      pids+=("$pid")
    done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
  rm -f "$BACKEND_LOG" "$FRONTEND_LOG" "$LOGDIR/wopal-plugins-debug.log"
  local pp="$(lsof -ti :"$PORT" 2>/dev/null)"
  [ -n "$pp" ] && pids+=($pp)
  pp="$(lsof -ti :"$APP_PORT" 2>/dev/null)"
  [ -n "$pp" ] && pids+=($pp)
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
    serve        Start the backend and Ellamaka Workbench
    stop          Stop the backend and Ellamaka Workbench
    help          Show this help message

  Options:
    -a, --attach      Start HTTP server + attach TUI client
    --debug [mods]    Enable debug mode (default: all)
                       Modules: task, rules, or comma-separated list
    --port <port>      Backend port (default: 4096)
    --app-port <port>  Workbench port (default: 3000)
    -ns               Disable WopalSpace mode (native opencode behavior)
    -h, --help        Forwarded to ellamaka

  Without args, starts TUI directly (no HTTP server, backend in-process).

  Pass-through:
    After --, all args are forwarded to ellamaka verbatim.
    Example: $self -- --help

Debug logs:
  $LOGDIR/ellamaka-dev-<port>-server.log    Backend stdout/stderr
  $LOGDIR/ellamaka-dev-<port>-frontend.log  Workbench stdout/stderr
  $LOGDIR/wopal-plugins-debug.log    Plugin debug output

Backend:   http://127.0.0.1:4096 (default, use --port to override)
Workbench: http://127.0.0.1:3000/workbench (use --app-port to override)
EOF
}

cmd=""
attach=false
debug=false
debug_modules=""
passthrough=()
PORT=4096
APP_PORT=3000

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
    --port) PORT="$2"; shift 2 ;;
    --app-port) APP_PORT="$2"; shift 2 ;;
    -ns) passthrough+=(--disable-wopalspace); shift ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

PIDFILE="$LOGDIR/ellamaka-dev-$PORT-$APP_PORT.pid"
BACKEND_LOG="$LOGDIR/ellamaka-dev-$PORT-server.log"
FRONTEND_LOG="$LOGDIR/ellamaka-dev-$APP_PORT-frontend.log"

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
    curl -sf "http://127.0.0.1:$PORT/global/health" > /dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

wait_frontend() {
  local i
  for i in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$APP_PORT/workbench" > /dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

warmup_config() {
  curl -sf "http://127.0.0.1:$PORT/global/config" > /dev/null 2>&1 || true
}

start_backend() {
  local srv_env=()
  local srv_args=(serve --port "$PORT" --print-logs)

  if [ "$debug" = true ]; then
    srv_args+=(--log-level DEBUG)
    srv_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
  fi

  srv_args+=("${passthrough[@]}")

  if [ ! -f "$opencode_preload" ]; then
    echo "missing OpenTUI preload: $opencode_preload"
    return 1
  fi

  (
    cd "$opencode_dir" || exit 1
    exec env "${srv_env[@]}" nohup bun --preload "$opencode_preload" "$opencode_entry" "${srv_args[@]}"
  ) > "$BACKEND_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >> "$PIDFILE"
}

start_frontend() {
  if [ ! -d "$ellamaka_app_dir" ]; then
    echo "missing Ellamaka Workbench: $ellamaka_app_dir"
    return 1
  fi

  (
    cd "$ellamaka_app_dir" || exit 1
    exec nohup bun run dev -- --host 127.0.0.1 --port "$APP_PORT" --strictPort
  ) > "$FRONTEND_LOG" 2>&1 &
  echo "$!" >> "$PIDFILE"
}

# ----- attach mode (HTTP server + TUI client) -----

if $attach; then
if ! is_running "$PORT"; then
    [ "$debug" = true ] && echo "logs: $BACKEND_LOG"
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
  exec bun --preload "$opencode_preload" "$opencode_entry" attach "http://localhost:$PORT" --dir "$space"
fi

# ----- serve mode -----

if [ "$cmd" = "serve" ]; then
if [ -f "$PIDFILE" ] || is_running "$PORT" || is_running "$APP_PORT"; then
  echo "already running."
  read -p "stop and restart? [Y/n] " yn
  case "${yn:-Y}" in
    [Yy]*) stop; echo "";;
    *) exit 0;;
  esac
fi

[ "$debug" = true ] && echo "debug: modules=$debug_modules"
echo "logs: $LOGDIR/"

rm -f "$PIDFILE"
if ! start_backend; then
  exit 1
fi

if ! wait_backend; then
  echo "backend failed to start; see $BACKEND_LOG"
  stop
  exit 1
fi

warmup_config

if ! start_frontend; then
  stop
  exit 1
fi

if ! wait_frontend; then
  echo "Workbench failed to start; see $FRONTEND_LOG"
  stop
  exit 1
fi

echo "started (backend :$PORT, Workbench :$APP_PORT)"
echo "open http://127.0.0.1:$APP_PORT/workbench"
echo "run '$self stop' to stop"
fi
