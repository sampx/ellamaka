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
PLUGIN_DEBUG_LOG="$LOGDIR/wopal-plugins-debug.log"

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

# 端口是否仍被监听（仅 LISTEN 状态）。
# CLOSE_WAIT / ESTABLISHED 客户端连接不算占用 —— 避免后端被杀后
# Chrome 残留的 SSE 连接被误判为"端口仍被占用"。
is_running() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 校验 pidfile 中记录的进程是否真实存活：pid 可 kill -0 且端口仍被监听。
# 用法: pid_listening <port> <pid>
pid_listening() {
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
#   BACKEND_PORT   = backend port（空如果没有 backend 行）
#   BACKEND_PID    = backend pid（空如果没有 backend 行）
#   FRONTEND_PORT  = frontend port（空如果没有 frontend 行）
#   FRONTEND_PID   = frontend pid（空如果没有 frontend 行）
read_pidfile() {
  BACKEND_PORT=""; BACKEND_PID=""; FRONTEND_PORT=""; FRONTEND_PID=""
  [ -f "$PIDFILE" ] || return 1
  local line label port pid
  while IFS=$' \t' read -r label port pid; do
    [ -n "$label" ] || continue
    case "$label" in
      backend)  BACKEND_PORT="$port"; BACKEND_PID="$pid" ;;
      frontend) FRONTEND_PORT="$port"; FRONTEND_PID="$pid" ;;
    esac
  done < "$PIDFILE"
  [ -n "$BACKEND_PID" ] || [ -n "$FRONTEND_PID" ] || return 1
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

# 杀单个 PID（及其进程组），轮询直到 PID 死亡 或 端口释放。
# PID 死亡即视为成功 —— 后端被杀后 Chrome 残留 CLOSE_WAIT 连接
# 会让 is_running 误判，必须以 PID 是否存在为准。
# 用法: kill_pid_and_wait_port <port> <pid>
kill_pid_and_wait_port() {
  local port="$1" pid="$2"
  local i

  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  for i in $(seq 1 30); do
    ! kill -0 "$pid" 2>/dev/null && return 0
    ! is_running "$port" && return 0
    sleep 0.1
  done

  kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true

  for i in $(seq 1 50); do
    ! kill -0 "$pid" 2>/dev/null && return 0
    ! is_running "$port" && return 0
    sleep 0.1
  done
  return 1
}

# 杀多个 PID（及其进程组），轮询直到所有 PID 死亡 或 所有给定端口释放。
# 用法: kill_pids_and_wait_ports <port> <app_port> <pid> [<pid> ...]
kill_pids_and_wait_ports() {
  local port="$1" app_port="$2"; shift 2
  local pids=("$@")
  local i pid alive

  for pid in "${pids[@]}"; do
    [ -n "$pid" ] || continue
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 20); do
    alive=0
    for pid in "${pids[@]}"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && { alive=1; break; }
    done
    [ $alive -eq 0 ] && { ! is_running "$port" && { [ -z "$app_port" ] || ! is_running "$app_port"; } && return 0; }
    sleep 0.1
  done

  for pid in "${pids[@]}"; do
    [ -n "$pid" ] || continue
    kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  done

  for i in $(seq 1 50); do
    alive=0
    for pid in "${pids[@]}"; do
      [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && { alive=1; break; }
    done
    [ $alive -eq 0 ] && { ! is_running "$port" && { [ -z "$app_port" ] || ! is_running "$app_port"; } && return 0; }
    sleep 0.1
  done
  return 1
}

# ── start helpers ───────────────────────────────────────────

start_backend() {
  local port="$1" debug="$2" debug_modules="$3" preload="$4" passthrough=("${@:5}")

  local srv_env=() srv_args=(serve --port "$port" --print-logs)

  if [ "$debug" = true ]; then
    srv_args+=(--log-level DEBUG)
    srv_env+=(
      WOPAL_PLUGIN_DEBUG="$debug_modules"
      WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG"
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

# ── stop helpers ────────────────────────────────────────────

# 停掉单个组件：杀进程 + 清理 pidfile + 归档日志。
# 用法: stop_one <label> <port> <pid> <log_file> [on_fail_mode]
#   on_fail_mode: "return" (默认, kill 失败则 return 1) | "warn" (kill 失败仅警告继续清理)
# 返回值：
#   0  清理完成（含 stale pidfile 清理 / 无可停项）
#   1  kill 失败且 mode=return
stop_one() {
  local label="$1" port="$2" pid="$3" log_file="$4" mode="${5:-return}"
  local display_label
  case "$label" in
    frontend) display_label="workbench" ;;
    *)        display_label="$label" ;;
  esac

  if [ -z "$pid" ]; then
    echo "stop: no $display_label running"
    return 0
  fi

  if ! pid_listening "$port" "$pid"; then
    echo "stop: $display_label not running (stale pidfile line removed)"
  else
    echo "stopping $display_label :$port (pid $pid)..."
    if ! kill_pid_and_wait_port "$port" "$pid"; then
      if [ "$mode" = "warn" ]; then
        echo "stop: $display_label did not exit cleanly"
      else
        echo "stop: $display_label did not exit"
        return 1
      fi
    else
      echo "stopped $display_label :$port"
    fi
  fi

  remove_pidfile_line "$label"
  rm -f "$log_file"
  # plugin debug log 由 backend 在 debug 模式下写入，跟随 backend 一起清理
  [ "$label" = "backend" ] && rm -f "$PLUGIN_DEBUG_LOG"
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
      stop_one backend "$BACKEND_PORT" "$BACKEND_PID" "$BACKEND_LOG" return
      ;;
    frontend)
      stop_one frontend "$FRONTEND_PORT" "$FRONTEND_PID" "$FRONTEND_LOG" return
      ;;
    all)
      local stopped=0
      if [ -n "$BACKEND_PID" ]; then
        stop_one backend "$BACKEND_PORT" "$BACKEND_PID" "$BACKEND_LOG" warn || true
        stopped=1
      fi
      if [ -n "$FRONTEND_PID" ]; then
        stop_one frontend "$FRONTEND_PORT" "$FRONTEND_PID" "$FRONTEND_LOG" warn || true
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
        WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG"
        WOPAL_DEBUG_LOG_DIR="$LOGDIR"
      )
    fi

    # Attach to a healthy running backend if one exists.
    if read_pidfile && [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null \
       && [ -n "$BACKEND_PORT" ] && is_running "$BACKEND_PORT" && backend_healthy "$BACKEND_PORT"; then
      echo "attaching to running server :$BACKEND_PORT"
      warmup_config "$BACKEND_PORT"
      cd "$opencode_dir"
      exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" \
        "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$BACKEND_PORT" --dir "$caller_pwd"
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

    start_backend "$PORT" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

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
      WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG"
      WOPAL_DEBUG_LOG_DIR="$LOGDIR"
    )
    echo "debug enabled (modules: $debug_modules)"
    echo "  plugin log: $PLUGIN_DEBUG_LOG"
    echo "watch: tail -f $PLUGIN_DEBUG_LOG"
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

  start_backend "$PORT" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || exit 1

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
      if ! pid_listening "$BACKEND_PORT" "$BACKEND_PID"; then
        echo "restart: backend not running"; return 1
      fi
      echo "restarting backend :$BACKEND_PORT ..."
      kill_pid_and_wait_port "$BACKEND_PORT" "$BACKEND_PID" || { echo "restart: backend did not exit"; return 1; }
      rm -f "$PLUGIN_DEBUG_LOG"
      start_backend "$BACKEND_PORT" false "all" "$opencode_preload" || return 1
      if ! wait_backend "$BACKEND_PORT"; then
        echo "restart: backend failed to start; see $BACKEND_LOG"
        return 1
      fi
      warmup_config "$BACKEND_PORT"
      echo "  backend :$BACKEND_PORT restarted"
      [ -n "$FRONTEND_PORT" ] && echo "  → http://127.0.0.1:$FRONTEND_PORT/workbench"
      ;;
    frontend)
      if ! pid_listening "$FRONTEND_PORT" "$FRONTEND_PID"; then
        echo "restart: frontend not running"; return 1
      fi
      echo "restarting workbench :$FRONTEND_PORT ..."
      kill_pid_and_wait_port "$FRONTEND_PORT" "$FRONTEND_PID" || { echo "restart: frontend did not exit"; return 1; }
      start_frontend "$FRONTEND_PORT" "$BACKEND_PORT" || return 1
      echo "  workbench :$FRONTEND_PORT restarted"
      echo "  → http://127.0.0.1:$FRONTEND_PORT/workbench"
      ;;
    all)
      # 保留范围：只 restart pidfile 中存在的组件，不新增。
      [ -n "$BACKEND_PID" ] || [ -n "$FRONTEND_PID" ] || { echo "restart: no dev instance in pidfile"; return 1; }

      local restart_backend=false restart_frontend=false
      [ -n "$BACKEND_PID" ] && restart_backend=true
      [ -n "$FRONTEND_PID" ] && restart_frontend=true

      echo "restarting :${BACKEND_PORT:-?} backend + :${FRONTEND_PORT:-?} workbench ..."

      # 优先并行 kill（两进程都存活时更快）；否则退化到 stop_one 顺序清理
      if $restart_backend && $restart_frontend \
         && pid_listening "$BACKEND_PORT" "$BACKEND_PID" \
         && pid_listening "$FRONTEND_PORT" "$FRONTEND_PID"; then
        kill_pids_and_wait_ports "$BACKEND_PORT" "$FRONTEND_PORT" "$BACKEND_PID" "$FRONTEND_PID" || true
        rm -f "$PLUGIN_DEBUG_LOG"
      else
        $restart_backend  && { stop_one backend  "$BACKEND_PORT"  "$BACKEND_PID"  "$BACKEND_LOG"  warn || true; }
        $restart_frontend && { stop_one frontend "$FRONTEND_PORT" "$FRONTEND_PID" "$FRONTEND_LOG" warn || true; }
      fi

      if $restart_backend; then
        start_backend "${BACKEND_PORT:-4096}" false "all" "$opencode_preload" || return 1
        if ! wait_backend "${BACKEND_PORT:-4096}"; then
          echo "restart: backend failed to start; see $BACKEND_LOG"
          return 1
        fi
        warmup_config "${BACKEND_PORT:-4096}"
        echo "  backend :${BACKEND_PORT} restarted"
      fi
      if $restart_frontend; then
        start_frontend "${FRONTEND_PORT:-3000}" "${BACKEND_PORT:-4096}" || { cmd_stop; return 1; }
        echo "  workbench :${FRONTEND_PORT} restarted"
      fi
      [ -n "$FRONTEND_PORT" ] && echo "  → http://127.0.0.1:${FRONTEND_PORT}/workbench"
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

  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null && [ -n "$BACKEND_PORT" ] && backend_healthy "$BACKEND_PORT"; then
    echo "  ✓  backend   :$BACKEND_PORT  (pid $BACKEND_PID)"
    if [ -n "$FRONTEND_PID" ] && [ -n "$FRONTEND_PORT" ]; then
      if kill -0 "$FRONTEND_PID" 2>/dev/null && is_running "$FRONTEND_PORT"; then
        echo "     workbench :$FRONTEND_PORT  (pid $FRONTEND_PID)"
      else
        echo "     workbench :$FRONTEND_PORT  (pid $FRONTEND_PID, not responding)"
      fi
      echo "     → http://127.0.0.1:$FRONTEND_PORT/workbench"
    fi
    echo "     pidfile    $PIDFILE"
    echo "     backend    $BACKEND_LOG"
    [ -n "$FRONTEND_PORT" ] && echo "     workbench  $FRONTEND_LOG"
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
