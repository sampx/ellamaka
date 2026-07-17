#!/bin/bash
# ellamaka 开发启动器
# dev.sh tui      — 启动 TUI（-a 连接已有后端）
# dev.sh serve    — 启动后端 + Workbench
# dev.sh desktop  — 构建并启动 Electron 桌面应用
# dev.sh status   — 查看运行状态
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
  status     Show backend/workbench status
  desktop    Build and start Electron desktop app
  stop       Stop backend and Workbench
  help       Show this help

$self tui [options]
  -a, --attach      Start backend + workbench, then attach TUI client
  --port <port>     Backend port (default: 4096)
  --app-port <port> Workbench port (default: 3000, attach mode only)
  --debug [mods]    Debug mode (modules: task,rules; default: all)
  -ns               Disable WopalSpace mode
  -- <args>         Forward args to ellamaka

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
# These are reused by stop / status / serve / tui-attach so that pidfile
# naming, PID extraction, and process-group kill stay consistent everywhere.

is_running() { lsof -ti :"$1" >/dev/null 2>&1; }

# Quick health check (1s timeout, non-blocking)
backend_healthy() {
  curl -sf --max-time 1 "http://127.0.0.1:$1/global/health" >/dev/null 2>&1
}

# Echo the first free port starting from $1 (inclusive).
next_free_port() {
  local p="$1"
  while is_running "$p"; do p=$((p + 1)); done
  echo "$p"
}

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

# pidfile path for a backend/app port pair
pidfile_for()    { echo "$LOGDIR/ellamaka-dev-$1-$2.pid"; }
# server (backend) log path
server_log_for() { echo "$LOGDIR/ellamaka-dev-$1-server.log"; }
# frontend (workbench) log path
frontend_log_for() { echo "$LOGDIR/ellamaka-dev-$1-frontend.log"; }

# Parse a pidfile basename into globals BP (backend port) and AP (app port).
# AP is "" when the pidfile has no app suffix (attach-only backend).
# Usage: parse_pidfile_base "ellamaka-dev-4097-3000"
parse_pidfile_base() {
  local base="${1#ellamaka-dev-}"
  if [[ "$base" == *-* ]]; then
    AP="${base##*-}"; BP="${base%-*}"
  else
    AP=""; BP="$base"
  fi
}

# Read PIDs from a pidfile into the global PIDS array.
# Returns 0 if at least one PID was read, 1 otherwise (no file / empty).
read_pids() {
  local pidfile="$1"
  PIDS=()
  [ -f "$pidfile" ] || return 1
  local pid
  while IFS= read -r pid; do
    [ -n "$pid" ] && PIDS+=("$pid")
  done < "$pidfile"
  [ ${#PIDS[@]} -gt 0 ]
}

# True (return 0) when both backend port and app port are free.
ports_free() {
  local port="$1" app_port="$2"
  is_running "$port" && return 1
  [ -n "$app_port" ] && is_running "$app_port" && return 1
  return 0
}

# Kill a list of PIDs (and their process groups) and poll until the given
# ports are confirmed free by lsof.
#
# Sequence: TERM (grace) → short wait → KILL (force) → poll until free.
# The post-KILL poll is what makes `serve` able to reuse the same port on
# restart instead of bumping upward every time.
#
# Args: port app_port pid [pid ...]
kill_group_and_wait() {
  local port="$1" app_port="$2"; shift 2
  local pids=("$@")
  local i pid

  for pid in "${pids[@]}"; do
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 20); do
    ports_free "$port" "$app_port" && return 0
    sleep 0.1
  done

  for pid in "${pids[@]}"; do
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 50); do
    ports_free "$port" "$app_port" && return 0
    sleep 0.1
  done
  return 1
}

# ── stop ───────────────────────────────────────────────────

cmd_stop() {
  local port="${1:-}" app_port="${2:-}"

  if [ -z "$port" ]; then
    local any=0
    for pf in "$LOGDIR"/ellamaka-dev-*.pid; do
      [ -f "$pf" ] || continue
      any=1
      parse_pidfile_base "$(basename "$pf" .pid)"
      _stop_one "$BP" "$AP" "$pf"
    done
    [ "$any" -eq 0 ] && echo "no dev instances running"
    return 0
  fi

  [ -z "$app_port" ] && app_port="3000"
  _stop_one "$port" "$app_port" "$(pidfile_for "$port" "$app_port")"
}

_stop_one() {
  local port="$1" app_port="$2" pidfile="$3"

  read_pids "$pidfile" || { echo "stop: not running (no pidfile)"; return 0; }
  rm -f "$pidfile"

  kill_group_and_wait "$port" "$app_port" "${PIDS[@]}"

  rm -f "$(server_log_for "$port")"
  [ -n "$app_port" ] && rm -f "$(frontend_log_for "$app_port")"
  rm -f "$LOGDIR/wopal-plugins-debug.log"

  local label
  [ -n "$app_port" ] && label="backend :$port + workbench :$app_port" || label="backend :$port"
  echo "stopped $label"
  echo "  logs cleaned:"
  echo "    $(server_log_for "$port")"
  [ -n "$app_port" ] && echo "    $(frontend_log_for "$app_port")"
  echo "    $LOGDIR/wopal-plugins-debug.log"
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
  else
    srv_args+=(--log-level INFO)
  fi
  srv_args+=("${passthrough[@]}")

  if [ ! -f "$preload" ]; then
    echo "missing OpenTUI preload: $preload"
    return 1
  fi

  (
    cd "$opencode_dir" || exit 1
    exec perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
      env "${srv_env[@]}" nohup bun --preload "$preload" "$opencode_entry" "${srv_args[@]}"
  ) > "$(server_log_for "$port")" 2>&1 &
  local pid=$!
  echo "$pid" >> "$pidfile"
}

start_frontend() {
  local app_port="$1" pidfile="$2" backend_port="$3"
  if [ ! -d "$ellamaka_app_dir" ]; then
    echo "missing Ellamaka Workbench: $ellamaka_app_dir"
    return 1
  fi
  (
    cd "$ellamaka_app_dir" || exit 1
    export VITE_OPENCODE_SERVER_PORT="$backend_port"
    exec perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
      nohup bun run dev -- --host 127.0.0.1 --port "$app_port" --strictPort
  ) > "$(frontend_log_for "$app_port")" 2>&1 &
  echo "$!" >> "$pidfile"
}

# ── tui ────────────────────────────────────────────────────

cmd_tui() {
  local attach=false PORT=4096 APP_PORT=3000 debug=false debug_modules="all" ns=false passthrough=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; passthrough+=("$@"); break ;;
      -a|--attach) attach=true; shift ;;
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

  # `--disable-wopalspace` is a TUI-client flag (consumed in index.ts middleware
  # before WopalSpace detection on the client's cwd). It is NOT a server flag:
  # `serve`/`web` are in SERVER_COMMANDS and skip WopalSpace detection anyway.
  # So the ns flag must reach the attach/exec call, and must NOT be forwarded
  # into start_backend's `serve` argv.
  local ns_arg=()
  $ns && ns_arg=(--disable-wopalspace)

  if $attach; then
    mkdir -p "$LOGDIR"
    local caller_pwd="$(pwd)"

    local attach_env=() attach_args=()
    if $debug; then
      attach_args+=(--log-level DEBUG)
      attach_env+=(
        WOPAL_PLUGIN_DEBUG="$debug_modules"
        WOPAL_PLUGIN_LOG_FILE="$LOGDIR/wopal-plugins-debug.log"
        WOPAL_DEBUG_LOG_DIR="$LOGDIR"
      )
    fi

    # Scan existing pidfiles for a healthy running backend to attach to.
    for pf in "$LOGDIR"/ellamaka-dev-*.pid; do
      [ -f "$pf" ] || continue
      parse_pidfile_base "$(basename "$pf" .pid)"

      read_pids "$pf" || { rm -f "$pf"; continue; }
      local recorded_pid="${PIDS[0]}"

      # PID dead → stale pidfile, clean up and skip.
      if ! kill -0 "$recorded_pid" 2>/dev/null; then
        rm -f "$pf"
        continue
      fi

      # PID alive + port listening + healthy → attach.
      if is_running "$BP" && backend_healthy "$BP"; then
        echo "attaching to running server :$BP"
        echo "  pidfile $pf"
        warmup_config "$BP"
        cd "$opencode_dir"
        exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" \
          "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$BP" --dir "$caller_pwd"
      fi
    done

    # No existing backend → start backend + workbench, same as serve.
    local pidfile="$(pidfile_for "$PORT" "$APP_PORT")"
    [ -f "$pidfile" ] && cmd_stop "$PORT" "$APP_PORT"

    if is_running "$PORT"; then
      local new_port; new_port=$(next_free_port "$((PORT + 1))")
      echo "port :$PORT in use, auto-bumped backend → :$new_port"
      PORT="$new_port"
    fi
    if is_running "$APP_PORT"; then
      local new_app_port; new_app_port=$(next_free_port "$((APP_PORT + 1))")
      echo "port :$APP_PORT in use, auto-bumped workbench → :$new_app_port"
      APP_PORT="$new_app_port"
    fi

    pidfile="$(pidfile_for "$PORT" "$APP_PORT")"
    $debug && echo "debug: modules=$debug_modules"

    rm -f "$pidfile"
    start_backend "$PORT" "$pidfile" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

    if ! wait_backend "$PORT"; then
      echo "backend failed to start; see $(server_log_for "$PORT")"
      cmd_stop "$PORT" "$APP_PORT"
      exit 1
    fi

    warmup_config "$PORT"
    start_frontend "$APP_PORT" "$pidfile" "$PORT" || { cmd_stop "$PORT" "$APP_PORT"; exit 1; }

    echo "  backend :$PORT, workbench :$APP_PORT"
    echo "  pidfile $pidfile"
    echo "  logs    $(server_log_for "$PORT")"
    echo "  → http://127.0.0.1:$APP_PORT/workbench"

    cd "$opencode_dir"
    exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" \
      "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$PORT" --dir "$caller_pwd"
  fi

  # ── default: in-process backend ──
  mkdir -p "$LOGDIR"
  local caller_pwd="$(pwd)"
  local tui_env=() tui_args=()

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
    "${ns_arg[@]}" \
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

  # `serve` is a server command (SERVER_COMMANDS in index.ts): WopalSpace
  # detection is skipped for it regardless, so -ns is a no-op here. We accept
  # the flag for a consistent CLI surface but do NOT forward --disable-wopalspace
  # into the serve argv (it would be meaningless to the server).
  $ns && echo "note: -ns has no effect on serve (server-side); use 'tui -ns' instead"

  # Stop ALL existing ellamaka dev instances first so we never stack.
  cmd_stop

  # Auto-bump only if a port is still held by something we don't own.
  if is_running "$PORT"; then
    local new_port; new_port=$(next_free_port "$((PORT + 1))")
    echo "port :$PORT in use, auto-bumped backend → :$new_port"
    PORT="$new_port"
  fi
  if is_running "$APP_PORT"; then
    local new_app_port; new_app_port=$(next_free_port "$((APP_PORT + 1))")
    echo "port :$APP_PORT in use, auto-bumped workbench → :$new_app_port"
    APP_PORT="$new_app_port"
  fi

  local pidfile="$(pidfile_for "$PORT" "$APP_PORT")"
  mkdir -p "$LOGDIR"
  $debug && echo "debug: modules=$debug_modules"

  rm -f "$pidfile"
  start_backend "$PORT" "$pidfile" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

  if ! wait_backend "$PORT"; then
    echo "backend failed to start; see $(server_log_for "$PORT")"
    cmd_stop "$PORT" "$APP_PORT"
    exit 1
  fi

  warmup_config "$PORT"
  start_frontend "$APP_PORT" "$pidfile" "$PORT" || { cmd_stop "$PORT" "$APP_PORT"; exit 1; }

  if ! curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1; then
    for i in $(seq 1 30); do
      curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi

  echo "  backend :$PORT, workbench :$APP_PORT"
  echo "  pidfile $(pidfile_for "$PORT" "$APP_PORT")"
  echo "  logs    $(server_log_for "$PORT")"
  echo "  → http://127.0.0.1:$APP_PORT/workbench"
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

# ── status ─────────────────────────────────────────────────

cmd_status() {
  local any=0
  for pf in "$LOGDIR"/ellamaka-dev-*.pid; do
    [ -f "$pf" ] || continue
    any=1
    parse_pidfile_base "$(basename "$pf" .pid)"

    read_pids "$pf" || { rm -f "$pf"; continue; }
    # PIDS[0] = backend PID (start_backend), PIDS[1] = workbench PID (start_frontend)
    local bpid="${PIDS[0]}" fpid="${PIDS[1]:-}"
    local b_alive=false f_alive=false
    kill -0 "$bpid" 2>/dev/null && backend_healthy "$BP" && b_alive=true
    if [ -n "$fpid" ] && [ -n "$AP" ]; then
      kill -0 "$fpid" 2>/dev/null && is_running "$AP" && f_alive=true
    fi

    if $b_alive; then
      echo "  ✓  backend   :$BP  (pid $bpid)"
      if [ -n "$AP" ]; then
        if $f_alive; then
          echo "     workbench :$AP  (pid $fpid)"
        else
          echo "     workbench :$AP  (pid $fpid, not responding)"
        fi
        echo "     → http://127.0.0.1:$AP/workbench"
      fi
      echo "     pidfile    $pf"
      echo "     backend    $(server_log_for "$BP")"
      [ -n "$AP" ] && echo "     workbench  $(frontend_log_for "$AP")"
    else
      echo "  ✗  backend :$BP  (stale, pidfile removed)"
      rm -f "$pf"
    fi
  done
  [ "$any" -eq 0 ] && echo "no dev instances running"
}

# ── Dispatch (only when executed, not when sourced for tests) ──

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-help}"
  shift 2>/dev/null || true

  case "$cmd" in
    tui)      cmd_tui "$@" ;;
    serve)    cmd_serve "$@" ;;
    status)   cmd_status ;;
    desktop)  cmd_desktop "$@" ;;
    stop)     cmd_stop ;;
    help|*)   usage ;;
  esac
fi
