#!/bin/bash
# ellamaka 开发启动器
# dev.sh tui      — 启动 TUI（-a 连接已有后端）
# dev.sh serve    — 启动后端 + Workbench
# dev.sh desktop  — 构建并启动 Electron 桌面应用
# dev.sh stop     — 停止后端和 Workbench

set -e

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

usage() {
  cat <<EOF
Usage: $self <command> [options]

Commands:
  tui        Start TUI (default: in-process backend)
  serve      Start HTTP backend + Workbench
  desktop    Build and start Electron desktop app
  stop       Stop backend and Workbench
  help       Show this help

$self tui [options]
  -a, --attach     Start HTTP backend and attach TUI client
  --port <port>    Backend port for attach mode (default: 4096)
  --debug [mods]   Debug mode (modules: task,rules; default: all)
  -ns              Disable WopalSpace mode
  -- <args>        Forward args to ellamaka

$self serve [options]
  --port <port>     Backend port (default: 4096)
  --app-port <port> Workbench port (default: 3000)
  --debug [mods]    Debug mode
  -ns               Disable WopalSpace mode

$self desktop
EOF
  exit 0
}

# ── Shared helpers ─────────────────────────────────────────

is_running() { lsof -ti :"$1" >/dev/null 2>&1; }

wait_backend() {
  local port="${1:-4096}"
  for i in $(seq 1 30); do
    curl -sf "http://127.0.0.1:$port/global/health" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

warmup_config() {
  local port="${1:-4096}"
  curl -sf "http://127.0.0.1:$port/global/config" >/dev/null 2>&1 || true
}

# ── stop ───────────────────────────────────────────────────

cmd_stop() {
  local port="${1:-4096}"
  local app_port="${2:-3000}"
  local pidfile="$LOGDIR/ellamaka-dev-$port-$app_port.pid"
  local log_files=(
    "$LOGDIR/ellamaka-dev-$port-server.log"
    "$LOGDIR/ellamaka-dev-$app_port-frontend.log"
    "$LOGDIR/wopal-plugins-debug.log"
  )

  echo "checking backend (port $port) and Workbench (port $app_port)..."

  local pids=()
  if [ -f "$pidfile" ]; then
    while IFS= read -r pid; do
      pids+=("$pid")
    done < "$pidfile"
    echo "  pidfile: $pidfile ($(printf '%s ' "${pids[@]}"))"
    rm -f "$pidfile"
  fi

  local removed=0
  local f
  for f in "${log_files[@]}"; do
    if [ -f "$f" ]; then
      rm -f "$f" && echo "  log removed: $(basename "$f")" && ((removed++))
    fi
  done
  [ "$removed" -eq 0 ] && echo "  no log files to clean"

  local pp
  pp="$(lsof -ti :"$port" 2>/dev/null)" && pids+=($pp)
  pp="$(lsof -ti :"$app_port" 2>/dev/null)" && pids+=($pp)

  if [ ${#pids[@]} -eq 0 ]; then
    echo "  not running"
    return 0
  fi

  local unique_pids=($(printf '%s\n' "${pids[@]}" | sort -u))
  echo "  stopping PIDs: ${unique_pids[*]}"

  for pid in "${unique_pids[@]}"; do
    kill "$pid" 2>/dev/null
  done

  for i in $(seq 1 50); do
    if ! is_running "$port" && ! is_running "$app_port"; then
      echo "  stopped"
      return 0
    fi
    sleep 0.1
  done

  echo "  graceful kill timed out, sending SIGKILL..."
  for pid in "${unique_pids[@]}"; do
    kill -9 "$pid" 2>/dev/null
  done
  sleep 0.5
  echo "  stopped (force killed)"
}

# ── helpers for serve/attach ───────────────────────────────

start_backend() {
  local port="$1" pidfile="$2" debug="$3" debug_modules="$4" preload="$5" passthrough=("${@:6}")

  local srv_env=() srv_args=(serve --port "$port" --print-logs)

  if [ "$debug" = true ]; then
    srv_args+=(--log-level DEBUG)
    srv_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
  fi
  srv_args+=("${passthrough[@]}")

  if [ ! -f "$preload" ]; then
    echo "missing OpenTUI preload: $preload"
    return 1
  fi

  (
    cd "$opencode_dir" || exit 1
    exec env "${srv_env[@]}" nohup bun --preload "$preload" "$opencode_entry" "${srv_args[@]}"
  ) > "$LOGDIR/ellamaka-dev-$port-server.log" 2>&1 &
  local pid=$!
  echo "$pid" >> "$pidfile"
}

start_frontend() {
  local app_port="$1" pidfile="$2"
  if [ ! -d "$ellamaka_app_dir" ]; then
    echo "missing Ellamaka Workbench: $ellamaka_app_dir"
    return 1
  fi
  (
    cd "$ellamaka_app_dir" || exit 1
    exec nohup bun run dev -- --host 127.0.0.1 --port "$app_port" --strictPort
  ) > "$LOGDIR/ellamaka-dev-$app_port-frontend.log" 2>&1 &
  echo "$!" >> "$pidfile"
}

# ── tui ────────────────────────────────────────────────────

cmd_tui() {
  local attach=false PORT=4096 debug=false debug_modules="all" ns=false passthrough=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; passthrough+=("$@"); break ;;
      -a|--attach) attach=true; shift ;;
      --port) PORT="$2"; shift 2 ;;
      --debug)
        debug=true
        [[ $# -gt 1 && ! "$2" =~ ^- ]] && { debug_modules="$2"; shift 2; } || { debug_modules="all"; shift; }
        ;;
      -ns) ns=true; shift ;;
      -h|--help) usage ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done

  $ns && passthrough+=(--disable-wopalspace)

  # ── attach mode: start backend + connect TUI client ──
  if $attach; then
    mkdir -p "$LOGDIR"
    local pidfile="$LOGDIR/ellamaka-dev-$PORT.pid"

    if ! is_running "$PORT"; then
      $debug && echo "logs: $LOGDIR/ellamaka-dev-$PORT-server.log"
      start_backend "$PORT" "$pidfile" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}"
      echo -n "starting server (pid $(cat "$pidfile"))"
      wait_backend "$PORT" && echo " ready" || echo " (health check timeout)"
    else
      echo "attaching to running server"
      wait_backend "$PORT" || { echo "backend not healthy, run '$self stop' first"; exit 1; }
    fi

    warmup_config "$PORT"
    cd "$opencode_dir"
    exec bun --preload "$opencode_preload" "$opencode_entry" attach "http://localhost:$PORT" --dir "$space"
  fi

  # ── default: in-process backend ──
  mkdir -p "$LOGDIR"
  local caller_pwd="$(pwd)"
  local tui_env=()
  local tui_args=()

  if $debug; then
    tui_args+=(--log-level DEBUG)
    tui_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
    echo "debug enabled (modules: $debug_modules)"
    echo "  plugin log: $LOGDIR/wopal-plugins-debug.log"
    echo "watch: tail -f $LOGDIR/wopal-plugins-debug.log"
    sleep 1
  fi

  cd "$caller_pwd"
  exec env "${tui_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" \
    "${tui_args[@]}" \
    "${passthrough[@]}"
}

# ── serve ──────────────────────────────────────────────────

cmd_serve() {
  local PORT=4096 APP_PORT=3000 debug=false debug_modules="all" ns=false passthrough=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; passthrough+=("$@"); break ;;
      --port) PORT="$2"; shift 2 ;;
      --app-port) APP_PORT="$2"; shift 2 ;;
      --debug)
        debug=true
        [[ $# -gt 1 && ! "$2" =~ ^- ]] && { debug_modules="$2"; shift 2; } || { debug_modules="all"; shift; }
        ;;
      -ns) ns=true; shift ;;
      -h|--help) usage ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done

  $ns && passthrough+=(--disable-wopalspace)

  local pidfile="$LOGDIR/ellamaka-dev-$PORT-$APP_PORT.pid"

  if [ -f "$pidfile" ] || is_running "$PORT" || is_running "$APP_PORT"; then
    echo "already running."
    read -p "stop and restart? [Y/n] " yn
    case "${yn:-Y}" in
      [Yy]*) cmd_stop "$PORT" "$APP_PORT"; echo "" ;;
      *) exit 0 ;;
    esac
  fi

  mkdir -p "$LOGDIR"
  $debug && echo "debug: modules=$debug_modules"
  echo "logs: $LOGDIR/"

  rm -f "$pidfile"
  start_backend "$PORT" "$pidfile" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

  if ! wait_backend "$PORT"; then
    echo "backend failed to start; see $LOGDIR/ellamaka-dev-$PORT-server.log"
    cmd_stop "$PORT" "$APP_PORT"
    exit 1
  fi

  warmup_config "$PORT"
  start_frontend "$APP_PORT" "$pidfile" || { cmd_stop "$PORT" "$APP_PORT"; exit 1; }

  if ! curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1; then
    for i in $(seq 1 30); do
      curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi

  echo "started (backend :$PORT, Workbench :$APP_PORT)"
  echo "open http://127.0.0.1:$APP_PORT/workbench"
  echo "run '$self stop' to stop"
}

# ── desktop ────────────────────────────────────────────────

cmd_desktop() {
  local CHANNEL="local"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage ;;
      *) echo "Unknown option: $1"; usage ;;
    esac
  done

  export OPENCODE_CHANNEL="$CHANNEL"
  local DESKTOP_DIR="$root/packages/ellamaka-desktop"

  if pkill -f "electron-vite.*ellamaka-desktop" 2>/dev/null; then
    echo "==> Stopped previous desktop session"
    sleep 1
  fi

  echo "🖥  Starting Desktop (channel: $CHANNEL)..."
  echo ""

  echo "==> Building sidecar (packages/opencode)..."
  (cd "$opencode_dir" && bun script/build-node.ts)

  echo ""
  echo "==> Building desktop..."
  (cd "$DESKTOP_DIR" && bun run build)

  echo ""
  echo "==> Starting Electron..."
  cd "$DESKTOP_DIR"
  exec bun run dev
}

# ── Dispatch ───────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  tui)      cmd_tui "$@" ;;
  serve)    cmd_serve "$@" ;;
  desktop)  cmd_desktop "$@" ;;
  stop)     cmd_stop ;;
  help|*)   usage ;;
esac
