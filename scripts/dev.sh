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

# ── 固定文件名 ──────────────────────────────────────────────
# pidfile 用标签行存储，不再把端口编码进文件名：
#   backend  4097  12345
#   frontend 3000  67890
PIDFILE="$LOGDIR/ellamaka-dev.pid"
BACKEND_LOG="$LOGDIR/ellamaka-dev-backend.log"
FRONTEND_LOG="$LOGDIR/ellamaka-dev-frontend.log"

usage() {
  cat <<EOF
Usage: $self <command> [options]

Commands:
  tui        Start TUI (default: in-process backend)
  serve      Start HTTP backend + Workbench
  restart    Restart backend, Workbench, or both
  status     Show backend/workbench status
  desktop    Build and start Electron desktop app
  stop       Stop backend and/or Workbench
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
  --backend-only    Start only the backend server (skip Workbench)

$self restart [target]
  backend           Restart only the backend server (keep Workbench alive)
  frontend          Restart only the Workbench dev server (keep backend alive)
  all               Restart both backend and Workbench (default)

$self stop [target]
  backend           Stop only the backend server (keep Workbench alive)
  frontend          Stop only the Workbench dev server (keep backend alive)
  all               Stop both backend and Workbench (default)

$self desktop
EOF
  exit 0
}

# ── Shared helpers ─────────────────────────────────────────

is_running() { lsof -ti :"$1" >/dev/null 2>&1; }

# 校验 pidfile 中记录的进程是否真实存活：pid 可 kill -0 且端口仍被占用。
# 用法: pid_alive <port> <pid>
pid_alive() {
  local port="$1" pid="$2"
  [ -n "$pid" ] && [ -n "$port" ] || return 1
  kill -0 "$pid" 2>/dev/null && is_running "$port"
}

backend_healthy() {
  curl -sf --max-time 1 "http://127.0.0.1:$1/global/health" >/dev/null 2>&1
}

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

# ── pidfile 读写 ────────────────────────────────────────────
# 格式：每行一个标签行 "backend <port> <pid>" 或 "frontend <port> <pid>"

# 读取 pidfile，设置全局变量。返回 1 如果文件不存在或为空。
# 设置的全局变量：
#   BP   = backend port（空如果没有 backend 行）
#   BPID = backend pid（空如果没有 backend 行）
#   AP   = frontend port（空如果没有 frontend 行）
#   FPID = frontend pid（空如果没有 frontend 行）
read_pidfile() {
  BP=""; BPID=""; AP=""; FPID=""
  [ -f "$PIDFILE" ] || return 1
  local line label port pid
  while IFS=$' \t' read -r label port pid; do
    [ -n "$label" ] || continue
    case "$label" in
      backend)  BP="$port"; BPID="$pid" ;;
      frontend) AP="$port"; FPID="$pid" ;;
    esac
  done < "$PIDFILE"
  [ -n "$BPID" ] || [ -n "$FPID" ] || return 1
  return 0
}

# 写入或替换 pidfile 中的指定标签行。
# 用法: write_pidfile_line <label> <port> <pid>
write_pidfile_line() {
  local label="$1" port="$2" pid="$3"
  local tmp=""
  # 保留其它标签行，替换目标行
  if [ -f "$PIDFILE" ]; then
    tmp=$(grep -v "^$label " "$PIDFILE" 2>/dev/null || true)
  fi
  {
    [ -n "$tmp" ] && echo "$tmp"
    echo "$label $port $pid"
  } > "$PIDFILE"
}

# 从 pidfile 中移除指定标签行。
# 用法: remove_pidfile_line <label>
remove_pidfile_line() {
  local label="$1"
  [ -f "$PIDFILE" ] || return 0
  local tmp
  tmp=$(grep -v "^$label " "$PIDFILE" 2>/dev/null || true)
  if [ -n "$tmp" ]; then
    echo "$tmp" > "$PIDFILE"
  else
    rm -f "$PIDFILE"
  fi
}

# ── 进程 kill helpers ───────────────────────────────────────

# 杀单个 PID（及其进程组），轮询直到端口释放。
# 用法: kill_pid_and_wait_port <port> <pid>
kill_pid_and_wait_port() {
  local port="$1" pid="$2"
  local i

  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  for i in $(seq 1 30); do
    ! is_running "$port" && return 0
    sleep 0.1
  done

  kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true

  for i in $(seq 1 50); do
    ! is_running "$port" && return 0
    sleep 0.1
  done
  return 1
}

# 杀多个 PID（及其进程组），轮询直到所有给定端口释放。
# 用法: kill_group_and_wait <port> <app_port> <pid> [<pid> ...]
kill_group_and_wait() {
  local port="$1" app_port="$2"; shift 2
  local pids=("$@")
  local i pid

  for pid in "${pids[@]}"; do
    [ -n "$pid" ] || continue
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 20); do
    ! is_running "$port" && { [ -z "$app_port" ] || ! is_running "$app_port"; } && return 0
    sleep 0.1
  done

  for pid in "${pids[@]}"; do
    [ -n "$pid" ] || continue
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 50); do
    ! is_running "$port" && { [ -z "$app_port" ] || ! is_running "$app_port"; } && return 0
    sleep 0.1
  done
  return 1
}

# ── start helpers ───────────────────────────────────────────

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
  ) > "$BACKEND_LOG" 2>&1 &
  local pid=$!
  write_pidfile_line backend "$port" "$pid"
}

start_frontend() {
  local app_port="$1" backend_port="$2"
  if [ ! -d "$ellamaka_app_dir" ]; then
    echo "missing Ellamaka Workbench: $ellamaka_app_dir"
    return 1
  fi
  (
    cd "$ellamaka_app_dir" || exit 1
    export VITE_OPENCODE_SERVER_PORT="$backend_port"
    exec perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' \
      nohup bun run dev -- --host 127.0.0.1 --port "$app_port" --strictPort
  ) > "$FRONTEND_LOG" 2>&1 &
  write_pidfile_line frontend "$app_port" "$!"
}

# ── stop ───────────────────────────────────────────────────

cmd_stop() {
  local target="${1:-all}"
  case "$target" in
    backend|frontend|all) shift 2>/dev/null || true ;;
    -h|--help)
      cat <<EOF
Usage: $self stop [target]

Targets:
  backend    Stop only the backend server (keep Workbench alive)
  frontend   Stop only the Workbench dev server (keep backend alive)
  all        Stop both (default)
EOF
      return 0
      ;;
    *) shift 2>/dev/null || true; target="all" ;;
  esac

  read_pidfile || { echo "no dev instances running"; rm -f "$PIDFILE"; return 0; }

  case "$target" in
    backend)
      if pid_alive "$BP" "$BPID"; then
        echo "stopping backend :$BP (pid $BPID)..."
        kill_pid_and_wait_port "$BP" "$BPID" || { echo "stop: backend did not exit"; return 1; }
        echo "stopped backend :$BP"
      elif [ -n "$BPID" ]; then
        echo "stop: backend not running (stale pidfile line removed)"
      else
        echo "stop: no backend running"; return 0
      fi
      remove_pidfile_line backend
      rm -f "$BACKEND_LOG"
      ;;
    frontend)
      if pid_alive "$AP" "$FPID"; then
        echo "stopping workbench :$AP (pid $FPID)..."
        kill_pid_and_wait_port "$AP" "$FPID" || { echo "stop: frontend did not exit"; return 1; }
        echo "stopped workbench :$AP"
      elif [ -n "$FPID" ]; then
        echo "stop: frontend not running (stale pidfile line removed)"
      else
        echo "stop: no frontend running"; return 0
      fi
      remove_pidfile_line frontend
      rm -f "$FRONTEND_LOG"
      ;;
    all)
      local stopped=0
      if [ -n "$BPID" ]; then
        if pid_alive "$BP" "$BPID"; then
          echo "stopping backend :$BP (pid $BPID)..."
          kill_pid_and_wait_port "$BP" "$BPID" || echo "stop: backend did not exit cleanly"
          echo "stopped backend :$BP"
        else
          echo "stop: backend not running (stale pidfile line removed)"
        fi
        remove_pidfile_line backend
        rm -f "$BACKEND_LOG"
        stopped=1
      fi
      if [ -n "$FPID" ]; then
        if pid_alive "$AP" "$FPID"; then
          echo "stopping workbench :$AP (pid $FPID)..."
          kill_pid_and_wait_port "$AP" "$FPID" || echo "stop: frontend did not exit cleanly"
          echo "stopped workbench :$AP"
        else
          echo "stop: frontend not running (stale pidfile line removed)"
        fi
        remove_pidfile_line frontend
        rm -f "$FRONTEND_LOG"
        stopped=1
      fi
      [ $stopped -eq 0 ] && echo "no dev instances running"
      echo "stopped all dev instances"
      ;;
  esac
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

    # Attach to a healthy running backend if one exists.
    if read_pidfile && [ -n "$BPID" ] && kill -0 "$BPID" 2>/dev/null \
       && [ -n "$BP" ] && is_running "$BP" && backend_healthy "$BP"; then
      echo "attaching to running server :$BP"
      warmup_config "$BP"
      cd "$opencode_dir"
      exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" \
        "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$BP" --dir "$caller_pwd"
    fi

    # No existing backend → start backend + workbench, same as serve.
    cmd_stop
    mkdir -p "$LOGDIR"

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

    $debug && echo "debug: modules=$debug_modules"

    start_backend "$PORT" "$PIDFILE" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

    if ! wait_backend "$PORT"; then
      echo "backend failed to start; see $BACKEND_LOG"
      cmd_stop
      exit 1
    fi

    warmup_config "$PORT"
    start_frontend "$APP_PORT" "$PORT" || { cmd_stop; exit 1; }

    echo "  backend :$PORT, workbench :$APP_PORT"
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
  local PORT=4096 APP_PORT=3000 debug=false debug_modules="all" backend_only=false passthrough=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --) shift; passthrough+=("$@"); break ;;
      --port) PORT="$2"; shift 2 ;;
      --app-port) APP_PORT="$2"; shift 2 ;;
      --debug)
        debug=true
        [[ $# -gt 1 && ! "$2" =~ ^- ]] && { debug_modules="$2"; shift 2; } || { debug_modules="all"; shift; }
        ;;
      --backend-only) backend_only=true; shift ;;
      -h|--help) usage ;;
      *) passthrough+=("$1"); shift ;;
    esac
  done

  # Stop only what we're about to start (preserve scope: --backend-only 不动前端)
  if $backend_only; then
    cmd_stop backend
  else
    cmd_stop all
  fi

  # Auto-bump only if a port is still held by something we don't own.
  if is_running "$PORT"; then
    local new_port; new_port=$(next_free_port "$((PORT + 1))")
    echo "port :$PORT in use, auto-bumped backend → :$new_port"
    PORT="$new_port"
  fi
  if ! $backend_only && is_running "$APP_PORT"; then
    local new_app_port; new_app_port=$(next_free_port "$((APP_PORT + 1))")
    echo "port :$APP_PORT in use, auto-bumped workbench → :$new_app_port"
    APP_PORT="$new_app_port"
  fi

  mkdir -p "$LOGDIR"
  $debug && echo "debug: modules=$debug_modules"

  start_backend "$PORT" "$PIDFILE" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

  if ! wait_backend "$PORT"; then
    echo "backend failed to start; see $BACKEND_LOG"
    cmd_stop
    exit 1
  fi

  warmup_config "$PORT"

  if $backend_only; then
    echo "  backend :$PORT (backend-only)"
    echo "  pidfile $PIDFILE"
    echo "  logs    $BACKEND_LOG"
    return 0
  fi

  start_frontend "$APP_PORT" "$PORT" || { cmd_stop; exit 1; }

  if ! curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1; then
    for i in $(seq 1 30); do
      curl -sf "http://127.0.0.1:$APP_PORT/workbench" >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi

  echo "  backend :$PORT, workbench :$APP_PORT"
  echo "  pidfile $PIDFILE"
  echo "  logs    $BACKEND_LOG / $FRONTEND_LOG"
  echo "  → http://127.0.0.1:$APP_PORT/workbench"
}

# ── restart ─────────────────────────────────────────────────

cmd_restart() {
  local target="${1:-all}"
  case "$target" in
    backend|frontend|all) shift 2>/dev/null || true ;;
    -h|--help|"")
      cat <<EOF
Usage: $self restart [target]

Targets:
  backend    Restart only the backend server (keep Workbench alive)
  frontend   Restart only the Workbench dev server (keep backend alive)
  all        Restart both (default)
EOF
      return 0
      ;;
    *) echo "Unknown restart target: $target (expected: backend|frontend|all)"; return 1 ;;
  esac

  read_pidfile || { echo "restart: no dev instance running"; return 1; }

  case "$target" in
    backend)
      if ! pid_alive "$BP" "$BPID"; then
        echo "restart: backend not running"; return 1
      fi
      echo "restarting backend :$BP ..."
      kill_pid_and_wait_port "$BP" "$BPID" || { echo "restart: backend did not exit"; return 1; }
      start_backend "$BP" "$PIDFILE" false "all" "$opencode_preload" || return 1
      if ! wait_backend "$BP"; then
        echo "restart: backend failed to start; see $BACKEND_LOG"
        return 1
      fi
      warmup_config "$BP"
      echo "  backend :$BP restarted"
      [ -n "$AP" ] && echo "  → http://127.0.0.1:$AP/workbench"
      ;;
    frontend)
      if ! pid_alive "$AP" "$FPID"; then
        echo "restart: frontend not running"; return 1
      fi
      echo "restarting workbench :$AP ..."
      kill_pid_and_wait_port "$AP" "$FPID" || { echo "restart: frontend did not exit"; return 1; }
      start_frontend "$AP" "$BP" || return 1
      echo "  workbench :$AP restarted"
      echo "  → http://127.0.0.1:$AP/workbench"
      ;;
    all)
      # 保留范围：只 restart pidfile 中存在的组件，不新增。
      [ -n "$BPID" ] || [ -n "$FPID" ] || { echo "restart: no dev instance in pidfile"; return 1; }

      local restart_backend=false restart_frontend=false
      [ -n "$BPID" ] && restart_backend=true
      [ -n "$FPID" ] && restart_frontend=true

      echo "restarting :${BP:-?} backend + :${AP:-?} workbench ..."

      # 先停掉所有存活进程
      if $restart_backend && $restart_frontend && pid_alive "$BP" "$BPID" && pid_alive "$AP" "$FPID"; then
        kill_group_and_wait "$BP" "$AP" "$BPID" "$FPID" || true
      else
        if $restart_backend && pid_alive "$BP" "$BPID"; then
          kill_pid_and_wait_port "$BP" "$BPID" || true
        fi
        if $restart_frontend && pid_alive "$AP" "$FPID"; then
          kill_pid_and_wait_port "$AP" "$FPID" || true
        fi
      fi
      rm -f "$PIDFILE"

      if $restart_backend; then
        start_backend "${BP:-4096}" "$PIDFILE" false "all" "$opencode_preload" || return 1
        if ! wait_backend "${BP:-4096}"; then
          echo "restart: backend failed to start; see $BACKEND_LOG"
          return 1
        fi
        warmup_config "${BP:-4096}"
        echo "  backend :${BP} restarted"
      fi
      if $restart_frontend; then
        start_frontend "${AP:-3000}" "${BP:-4096}" || { cmd_stop; return 1; }
        echo "  workbench :${AP} restarted"
      fi
      [ -n "$AP" ] && echo "  → http://127.0.0.1:${AP}/workbench"
      ;;
  esac
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
  read_pidfile || { echo "no dev instances running"; rm -f "$PIDFILE"; return 0; }

  if [ -n "$BPID" ] && kill -0 "$BPID" 2>/dev/null && [ -n "$BP" ] && backend_healthy "$BP"; then
    echo "  ✓  backend   :$BP  (pid $BPID)"
    if [ -n "$FPID" ] && [ -n "$AP" ]; then
      if kill -0 "$FPID" 2>/dev/null && is_running "$AP"; then
        echo "     workbench :$AP  (pid $FPID)"
      else
        echo "     workbench :$AP  (pid $FPID, not responding)"
      fi
      echo "     → http://127.0.0.1:$AP/workbench"
    fi
    echo "     pidfile    $PIDFILE"
    echo "     backend    $BACKEND_LOG"
    [ -n "$AP" ] && echo "     workbench  $FRONTEND_LOG"
  else
    echo "  ✗  backend not running (stale pidfile removed)"
    rm -f "$PIDFILE"
  fi
}

# ── Dispatch (only when executed, not when sourced for tests) ──

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  mkdir -p "$LOGDIR"
  cmd="${1:-help}"
  shift 2>/dev/null || true

  case "$cmd" in
    tui)      cmd_tui "$@" ;;
    serve)    cmd_serve "$@" ;;
    restart)  cmd_restart "$@" ;;
    status)   cmd_status ;;
    desktop)  cmd_desktop "$@" ;;
    stop)     cmd_stop "$@" ;;
    help|*)   usage ;;
  esac
fi