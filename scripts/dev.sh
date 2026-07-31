#!/bin/bash
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

find_space_root() {
  local curr="$1"
  while [ "$curr" != "/" ] && [ -n "$curr" ]; do
    if [ -d "$curr/.wopal-space" ]; then
      echo "$curr"
      return 0
    fi
    if [[ "$curr" == *"/.worktrees/"* ]] || [[ "$curr" == *"/.worktrees"* ]]; then
      local base="${curr%%/.worktrees*}"
      if [ -n "$base" ] && [ -d "$base/.wopal-space" ]; then
        echo "$base"
        return 0
      fi
    fi
    curr="$(dirname "$curr")"
  done
  echo "$(cd "$1/../.." 2>/dev/null && pwd || echo "$1")"
}

root="$(cd "$(dirname "$(resolve "$0")")/.." && pwd)"
space="$(find_space_root "$root")"
opencode_entry="$root/packages/opencode/src/index.ts"
opencode_dir="$root/packages/opencode"
opencode_preload="$opencode_dir/node_modules/@opentui/solid/scripts/preload.ts"
ellamaka_app_dir="$root/packages/ellamaka-app"
LOGDIR="$space/.wopal-space/logs"
PIDFILE="$LOGDIR/ellamaka-dev.pid"
BACKEND_LOG="$LOGDIR/ellamaka-dev-backend.log"
FRONTEND_LOG="$LOGDIR/ellamaka-dev-frontend.log"
DESKTOP_LOG="$LOGDIR/ellamaka-dev-desktop.log"
SIDECAR_LOG="$LOGDIR/ellamaka-dev-sidecar.log"
PLUGIN_DEBUG_LOG="$LOGDIR/wopal-plugins-debug.log"
SELF_PGID="$(ps -o pgid= -p "$$" | tr -d '[:space:]')"

usage() {
  cat <<EOF
Usage: $self <command> [options]

Commands:
  tui        Start TUI (default: in-process backend)
  serve      Start HTTP backend + Workbench
  restart    Restart backend, Workbench, or both (not desktop)
  status     Show running dev instances
  desktop    Build and start Electron desktop app (background)
  stop       Stop backend, Workbench, desktop, or all
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
  Desktop is not supported. Use 'stop desktop && $self desktop'.

$self stop [target]
  backend           Stop only the backend server (keep others alive)
  frontend          Stop only the Workbench dev server (keep others alive)
  desktop           Stop only the Electron desktop app (keep others alive)
  all               Stop all dev instances (default)

$self desktop [options]
  --debug [mods]    Debug mode (modules: task,rules; default: all)
  --rebuild         Rebuild sidecar bundle and re-copy icons before launch
  Desktop runs in background. Close the Electron window or use 'stop desktop'.
  By default sidecar build is skipped (assumes dist/node/node.js is current).
  Sidecar log: $SIDECAR_LOG
EOF
  exit 0
}

is_running() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

backend_healthy() {
  curl -sf --max-time 1 "http://127.0.0.1:$1/global/health" >/dev/null 2>&1
}

wait_backend() {
  local port="$1" i
  for i in $(seq 1 30); do
    backend_healthy "$port" && return 0
    sleep 0.5
  done
  return 1
}

warmup_config() {
  curl -sf "http://127.0.0.1:$1/global/config" >/dev/null 2>&1 || true
}

pgid_of() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d '[:space:]'
}

process_stamp() {
  ps -o lstart= -p "$1" 2>/dev/null | tr -d '[:space:]'
}

group_running() {
  local pgid="$1" pid state
  [[ "$pgid" =~ ^[1-9][0-9]*$ ]] && [ "$pgid" != "$SELF_PGID" ] || return 1
  while IFS= read -r pid; do
    state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    [[ "$state" != Z* ]] && return 0
  done < <(pgrep -g "$pgid" 2>/dev/null || true)
  return 1
}

record_matches() {
  [ "$1" = "$2" ] || [[ "$1" == "$2"-* ]]
}

records_for_service() {
  local service="$1" label port pid pgid stamp
  [ -f "$PIDFILE" ] || return 0
  while IFS=$' \t' read -r label port pid pgid stamp; do
    [ -n "$label" ] || continue
    record_matches "$label" "$service" && printf '%s %s %s %s %s\n' "$label" "$port" "$pid" "$pgid" "$stamp"
  done < "$PIDFILE"
}

read_record() {
  local wanted="$1" label port pid pgid stamp
  RECORD_PORT=""
  RECORD_PID=""
  RECORD_PGID=""
  RECORD_STAMP=""
  [ -f "$PIDFILE" ] || return 1
  while IFS=$' \t' read -r label port pid pgid stamp; do
    [ "$label" = "$wanted" ] || continue
    RECORD_PORT="$port"
    RECORD_PID="$pid"
    RECORD_PGID="${pgid:-$(pgid_of "$pid")}"
    RECORD_STAMP="$stamp"
    return 0
  done < "$PIDFILE"
  return 1
}

record_is_current() {
  local label="$1" pid="$2" stamp="$3" command
  [ -n "$stamp" ] && [ "$(process_stamp "$pid")" = "$stamp" ] && return 0
  [ -n "$stamp" ] && return 1
  command="$(ps -o command= -p "$pid" 2>/dev/null)"
  case "$label" in
    backend) [[ "$command" == *"$opencode_entry"* ]] ;;
    frontend) [[ "$command" == *"bun run dev"* || "$command" == *"vite"* ]] ;;
    desktop) [[ "$command" == *"electron-vite"* ]] ;;
    *) return 1 ;;
  esac
}

rewrite_records() {
  local mode="$1" value="$2" label port pid pgid stamp tmp
  mkdir -p "$LOGDIR"
  tmp="$(mktemp "$LOGDIR/ellamaka-dev.pid.XXXXXX")"
  if [ -f "$PIDFILE" ]; then
    while IFS=$' \t' read -r label port pid pgid stamp; do
      [ -n "$label" ] || continue
      case "$mode" in
        label) record_matches "$label" "$value" && [ "$label" = "$value" ] && continue ;;
        service) record_matches "$label" "$value" && continue ;;
      esac
      printf '%s %s %s %s %s\n' "$label" "$port" "$pid" "$pgid" "$stamp" >> "$tmp"
    done < "$PIDFILE"
  fi
  if [ -s "$tmp" ]; then
    mv "$tmp" "$PIDFILE"
  else
    rm -f "$tmp" "$PIDFILE"
  fi
}

write_record() {
  local label="$1" port="$2" pid="$3" pgid="$4" stamp="${5:-}" line_label line_port line_pid line_pgid line_stamp tmp
  [ -n "$pgid" ] || pgid="$(pgid_of "$pid")"
  [ -n "$stamp" ] || stamp="$(process_stamp "$pid")"
  [[ "$pid" =~ ^[1-9][0-9]*$ && "$pgid" =~ ^[1-9][0-9]*$ ]] || {
    echo "cannot register $label: invalid pid or process group" >&2
    return 1
  }
  mkdir -p "$LOGDIR"
  tmp="$(mktemp "$LOGDIR/ellamaka-dev.pid.XXXXXX")"
  if [ -f "$PIDFILE" ]; then
    while IFS=$' \t' read -r line_label line_port line_pid line_pgid line_stamp; do
      [ -n "$line_label" ] || continue
      [ "$line_label" = "$label" ] && continue
      printf '%s %s %s %s %s\n' "$line_label" "$line_port" "$line_pid" "$line_pgid" "$line_stamp" >> "$tmp"
    done < "$PIDFILE"
  fi
  printf '%s %s %s %s %s\n' "$label" "$port" "$pid" "$pgid" "$stamp" >> "$tmp"
  mv "$tmp" "$PIDFILE"
}

remove_service_records() {
  rewrite_records service "$1"
}

service_running() {
  local service="$1" label port pid pgid stamp
  while IFS=' ' read -r label port pid pgid stamp; do
    [ -n "$pgid" ] || pgid="$(pgid_of "$pid")"
    if record_is_current "$label" "$pid" "$stamp" && group_running "$pgid"; then
      return 0
    fi
    # Recorded PID may have drifted: `bun run dev` (the recorded parent) can
    # exit while its `vite` child keeps listening on the port. Trust the port:
    # if a process matching this service is still listening, the service is
    # alive — refresh the record so stop/restart target the real listener
    # instead of misreporting "not running" and orphaning the listener.
    if listener_matches_service "$label" "$port"; then
      write_record "$label" "$port" "$LISTENER_PID" "$LISTENER_PGID"
      return 0
    fi
  done < <(records_for_service "$service")
  return 1
}

service_has_records() {
  local service="$1" label port pid pgid stamp
  while IFS=' ' read -r label port pid pgid stamp; do
    return 0
  done < <(records_for_service "$service")
  return 1
}

require_stopped() {
  local service
  for service in "$@"; do
    if service_running "$service"; then
      echo "$service is already running; run '$self stop $service' first"
      return 1
    fi
    if service_has_records "$service"; then
      remove_service_records "$service"
      cleanup_service_logs "$service"
    fi
  done
  return 0
}

next_free_port() {
  local port="$1"
  while is_running "$port"; do port=$((port + 1)); done
  echo "$port"
}

choose_free_port() {
  local name="$1" port="$2"
  SELECTED_PORT="$port"
  if is_running "$port"; then
    SELECTED_PORT="$(next_free_port "$((port + 1))")"
    echo "port :$port in use, auto-bumped $name → :$SELECTED_PORT"
  fi
}

require_free_ports() {
  local port
  for port in "$@"; do
    [ "$port" = "-" ] && continue
    if is_running "$port"; then
      echo "port :$port is already in use; stop its owner first"
      return 1
    fi
  done
}

wait_for_group_exit() {
  local pgid="$1" i
  for i in $(seq 1 30); do
    group_running "$pgid" || return 0
    sleep 0.1
  done
  return 1
}

append_unique() {
  case " $PROCESS_GROUPS " in
    *" $1 "*) ;;
    *) PROCESS_GROUPS="${PROCESS_GROUPS:+$PROCESS_GROUPS }$1" ;;
  esac
}

cleanup_service_logs() {
  case "$1" in
    backend)
      rm -f "$BACKEND_LOG"
      if ! service_running desktop; then rm -f "$PLUGIN_DEBUG_LOG"; fi
      ;;
    frontend) rm -f "$FRONTEND_LOG" ;;
    desktop)
      rm -f "$DESKTOP_LOG" "$SIDECAR_LOG"
      if ! service_running backend; then rm -f "$PLUGIN_DEBUG_LOG"; fi
      ;;
  esac
}

plugin_debug_modules() {
  [ "$1" = "all" ] && return 0
  printf '%s' "$1"
}

stop_service() {
  local service="$1" label port pid pgid stamp failed=false
  local PROCESS_GROUPS=""

  while IFS=' ' read -r label port pid pgid stamp; do
    [ -n "$pgid" ] || pgid="$(pgid_of "$pid")"
    if record_is_current "$label" "$pid" "$stamp" && group_running "$pgid"; then
      append_unique "$pgid"
    elif listener_matches_service "$label" "$port"; then
      # PID drifted (e.g. bun dead, vite child still listening) — kill the
      # real listener's process group so stop actually reclaims the port.
      append_unique "$LISTENER_PGID"
    fi
  done < <(records_for_service "$service")

  if [ -z "$PROCESS_GROUPS" ]; then
    if service_has_records "$service"; then remove_service_records "$service"; fi
    cleanup_service_logs "$service"
    echo "stop: no $service running"
    return 0
  fi

  for pgid in $PROCESS_GROUPS; do
    echo "stopping $service process group $pgid..."
    kill -TERM -"$pgid" 2>/dev/null || true
  done

  for pgid in $PROCESS_GROUPS; do
    wait_for_group_exit "$pgid" && continue
    echo "forcing $service process group $pgid..."
    kill -KILL -"$pgid" 2>/dev/null || true
    wait_for_group_exit "$pgid" || failed=true
  done

  if $failed; then
    echo "stop: $service still has live processes; pidfile was preserved" >&2
    return 1
  fi

  remove_service_records "$service"
  cleanup_service_logs "$service"
  echo "stopped $service"
}

start_process() {
  local service="$1" port="$2" log="$3" dir="$4"
  shift 4
  mkdir -p "$(dirname "$log")"
  (
    cd "$dir" || exit 1
    exec perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' nohup "$@"
  ) < /dev/null > "$log" 2>&1 &
  local pid=$! pgid attempt
  for attempt in $(seq 1 10); do
    pgid="$(pgid_of "$pid")"
    if [ -n "$pgid" ] && [ "$pgid" = "$pid" ]; then
      break
    fi
    sleep 0.1
  done

  if [ "$pgid" != "$pid" ]; then
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "failed to start $service process (process died immediately); see $log" >&2
    else
      echo "failed to isolate $service process" >&2
      kill -TERM "$pid" 2>/dev/null || true
    fi
    return 1
  fi
  write_record "$service" "$port" "$pid" "$pgid"
}

start_backend() {
  local port="$1" debug="$2" debug_modules="$3" preload="$4"
  shift 4
  local plugin_modules=""
  local -a env_args=(WOPAL_DEBUG_LOG_DIR="$LOGDIR" OPENCODE_MODELS_PATH="$root/.ci/models.json") args=(serve --port "$port" --print-logs)
  if [ "$debug" = true ]; then
    plugin_modules="$(plugin_debug_modules "$debug_modules")"
    args+=(--log-level DEBUG)
    env_args+=(WOPAL_PLUGIN_LOG_LEVEL=debug WOPAL_PLUGIN_LOG_MODULES="$plugin_modules" WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG")
  else
    args+=(--log-level INFO)
  fi
  args+=("$@")
  [ -f "$preload" ] || { echo "missing OpenTUI preload: $preload"; return 1; }
  start_process backend "$port" "$BACKEND_LOG" "$opencode_dir" env "${env_args[@]}" bun --preload "$preload" "$opencode_entry" "${args[@]}"
}

start_frontend() {
  local port="$1" backend_port="$2"
  [ -d "$ellamaka_app_dir" ] || { echo "missing Ellamaka Workbench: $ellamaka_app_dir"; return 1; }
  start_process frontend "$port" "$FRONTEND_LOG" "$ellamaka_app_dir" env VITE_OPENCODE_SERVER_PORT="$backend_port" bun run dev -- --host 127.0.0.1 --port "$port" --strictPort
}

listener_pid() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | { IFS= read -r pid || true; printf '%s' "$pid"; }
}

record_listener() {
  local label="$1" port="$2" pid pgid
  pid="$(listener_pid "$port")"
  [ -n "$pid" ] || return 1
  pgid="$(pgid_of "$pid")"
  write_record "$label" "$port" "$pid" "$pgid"
}

# Port-based fallback for drifted records: the recorded PID (e.g. `bun run dev`)
# may be gone while a child process (`vite`) is still listening on the port.
# Finds the actual listener on $2 and confirms it belongs to service $1 via
# record_is_current's command check. Sets LISTENER_PID / LISTENER_PGID on match.
listener_matches_service() {
  LISTENER_PID=""
  LISTENER_PGID=""
  local label="$1" port="$2" pid pgid
  [ "$port" != "-" ] || return 1
  pid="$(listener_pid "$port")"
  [ -n "$pid" ] || return 1
  record_is_current "$label" "$pid" "" || return 1
  pgid="$(pgid_of "$pid")"
  [ -n "$pgid" ] || return 1
  LISTENER_PID="$pid"
  LISTENER_PGID="$pgid"
  return 0
}

record_crashpads() {
  local pid pgid
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    pgid="$(pgid_of "$pid")"
    [ -n "$pgid" ] && write_record "desktop-crashpad-$pid" - "$pid" "$pgid"
  done < <(pgrep -f 'ai\.ellamaka\.desktop\.local/Crashpad' 2>/dev/null || true)
}

cmd_stop() {
  local target="${1:-all}" failed=false
  case "$target" in
    backend|frontend|desktop|all) ;;
    -h|--help)
      cat <<EOF
Usage: $self stop [target]

Targets:
  backend    Stop only the backend server (keep Workbench alive)
  frontend   Stop only the Workbench dev server (keep backend alive)
  desktop    Stop only the Electron desktop app (keep backend/Workbench alive)
  all        Stop all dev instances (default)
EOF
      return 0
      ;;
    *) target="all" ;;
  esac

  case "$target" in
    backend|frontend|desktop) stop_service "$target" ;;
    all)
      stop_service frontend || failed=true
      stop_service desktop || failed=true
      stop_service backend || failed=true
      if $failed; then return 1; fi
      ;;
  esac
}

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
    local caller_pwd="$(pwd)" attach_env=(WOPAL_DEBUG_LOG_DIR="$LOGDIR" OPENCODE_MODELS_PATH="$root/.ci/models.json") attach_args=() plugin_modules=""
    if $debug; then
      attach_args+=(--log-level DEBUG)
      plugin_modules="$(plugin_debug_modules "$debug_modules")"
      attach_env+=(WOPAL_PLUGIN_LOG_LEVEL=debug WOPAL_PLUGIN_LOG_MODULES="$plugin_modules" WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG")
    fi

    if read_record backend && service_running backend && backend_healthy "$RECORD_PORT"; then
      echo "attaching to running server :$RECORD_PORT"
      warmup_config "$RECORD_PORT"
      cd "$opencode_dir"
      exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$RECORD_PORT" --dir "$caller_pwd"
    fi

    require_stopped backend frontend || return 1
    choose_free_port backend "$PORT"; PORT="$SELECTED_PORT"
    choose_free_port workbench "$APP_PORT"; APP_PORT="$SELECTED_PORT"
    start_backend "$PORT" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || return 1
    if ! wait_backend "$PORT"; then
      echo "backend failed to start; see $BACKEND_LOG"
      stop_service backend || true
      return 1
    fi
    warmup_config "$PORT"
    start_frontend "$APP_PORT" "$PORT" || { stop_service backend || true; return 1; }
    echo "  backend :$PORT, workbench :$APP_PORT"
    echo "  → http://127.0.0.1:$APP_PORT/workbench"
    cd "$opencode_dir"
    exec env "${attach_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" "${attach_args[@]}" "${ns_arg[@]}" attach "http://localhost:$PORT" --dir "$caller_pwd"
  fi

  mkdir -p "$LOGDIR"
  local caller_pwd="$(pwd)" tui_env=(WOPAL_DEBUG_LOG_DIR="$LOGDIR" OPENCODE_MODELS_PATH="$root/.ci/models.json") tui_args=() plugin_modules=""
  if $debug; then
    tui_args+=(--log-level DEBUG)
    plugin_modules="$(plugin_debug_modules "$debug_modules")"
    tui_env+=(WOPAL_PLUGIN_LOG_LEVEL=debug WOPAL_PLUGIN_LOG_MODULES="$plugin_modules" WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG")
    echo "debug enabled (modules: $debug_modules)"
    echo "  plugin log: $PLUGIN_DEBUG_LOG"
    echo "watch: tail -f $PLUGIN_DEBUG_LOG"
  fi
  cd "$caller_pwd"
  exec env "${tui_env[@]}" bun --preload "$opencode_preload" "$opencode_entry" "${tui_args[@]}" "${ns_arg[@]}" "${passthrough[@]}"
}

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

  if $backend_only; then
    require_stopped backend || return 1
  else
    require_stopped backend frontend || return 1
  fi
  choose_free_port backend "$PORT"; PORT="$SELECTED_PORT"
  if ! $backend_only; then
    choose_free_port workbench "$APP_PORT"; APP_PORT="$SELECTED_PORT"
  fi

  mkdir -p "$LOGDIR"
  $debug && echo "debug: modules=$debug_modules"
  start_backend "$PORT" "$debug" "$debug_modules" "$opencode_preload" "${passthrough[@]}" || return 1
  if ! wait_backend "$PORT"; then
    echo "backend failed to start; see $BACKEND_LOG"
    stop_service backend || true
    return 1
  fi
  warmup_config "$PORT"

  if $backend_only; then
    echo "  backend :$PORT (backend-only)"
    echo "  pidfile $PIDFILE"
    echo "  logs    $BACKEND_LOG"
    return 0
  fi

  start_frontend "$APP_PORT" "$PORT" || { stop_service backend || true; return 1; }
  echo "  backend :$PORT, workbench :$APP_PORT"
  echo "  pidfile $PIDFILE"
  echo "  logs    $BACKEND_LOG / $FRONTEND_LOG"
  echo "  → http://127.0.0.1:$APP_PORT/workbench"
}

cmd_restart() {
  local target="${1:-all}"
  case "$target" in
    backend|frontend|all) ;;
    -h|--help|"")
      cat <<EOF
Usage: $self restart [target]

Targets:
  backend    Restart only the backend server (keep Workbench alive)
  frontend   Restart only the Workbench dev server (keep backend alive)
  all        Restart both (default)

Note: desktop is not supported here. Use "stop desktop && dev.sh desktop" instead.
EOF
      return 0
      ;;
    desktop) echo "restart: desktop not supported (use 'stop desktop && $self desktop')"; return 1 ;;
    *) echo "Unknown restart target: $target (expected: backend|frontend|all)"; return 1 ;;
  esac

  case "$target" in
    backend)
      read_record backend && service_running backend || { echo "restart: backend not running"; return 1; }
      local backend_port="$RECORD_PORT"
      stop_service backend || return 1
      start_backend "$backend_port" false all "$opencode_preload" || return 1
      wait_backend "$backend_port" || { echo "restart: backend failed to start; see $BACKEND_LOG"; return 1; }
      warmup_config "$backend_port"
      echo "  backend :$backend_port restarted"
      ;;
    frontend)
      read_record frontend && service_running frontend || { echo "restart: frontend not running"; return 1; }
      local frontend_port="$RECORD_PORT"
      read_record backend && service_running backend || { echo "restart: backend not running"; return 1; }
      local frontend_backend_port="$RECORD_PORT"
      stop_service frontend || return 1
      start_frontend "$frontend_port" "$frontend_backend_port" || return 1
      echo "  workbench :$frontend_port restarted"
      ;;
    all)
      local restart_backend=false restart_frontend=false backend_port="" frontend_port=""
      if read_record backend && service_running backend; then restart_backend=true; backend_port="$RECORD_PORT"; fi
      if read_record frontend && service_running frontend; then restart_frontend=true; frontend_port="$RECORD_PORT"; fi
      $restart_backend || $restart_frontend || { echo "restart: no dev instance running"; return 1; }
      if $restart_frontend; then stop_service frontend || return 1; fi
      if $restart_backend; then stop_service backend || return 1; fi
      if $restart_backend; then
        start_backend "$backend_port" false all "$opencode_preload" || return 1
        wait_backend "$backend_port" || { echo "restart: backend failed to start; see $BACKEND_LOG"; return 1; }
        warmup_config "$backend_port"
      fi
      if $restart_frontend; then
        $restart_backend || { echo "restart: backend not running"; return 1; }
        start_frontend "$frontend_port" "$backend_port" || return 1
      fi
      echo "restarted dev services"
      ;;
  esac
}

cmd_desktop() {
  local CHANNEL="local" debug=false debug_modules="all" rebuild=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --debug)
        debug=true
        [[ $# -gt 1 && ! "$2" =~ ^- ]] && { debug_modules="$2"; shift 2; } || { debug_modules="all"; shift; }
        ;;
      --rebuild) rebuild=true; shift ;;
      -h|--help) usage ;;
      *) echo "Unknown option: $1"; usage ;;
    esac
  done

  local DESKTOP_DIR="$root/packages/ellamaka-desktop"
  require_stopped desktop || return 1
  require_free_ports 5173 9222 || return 1
  export OPENCODE_CHANNEL="$CHANNEL"

  echo "🖥  Starting Desktop (channel: $CHANNEL)..."
  if $rebuild; then
    echo "==> Rebuilding sidecar (packages/opencode)..."
    (cd "$opencode_dir" && bun script/build-node.ts)
    echo "==> Copying icons..."
    (cd "$DESKTOP_DIR" && bun ./scripts/copy-icons.ts "$CHANNEL")
  else
    echo "==> Skipping sidecar build (use --rebuild to force)"
  fi

  mkdir -p "$LOGDIR"
  local plugin_modules=""
  local -a desktop_env=(ELAMAKA_DESKTOP_DEV=1 ELAMAKA_DESKTOP_LOG_LEVEL="$($debug && echo DEBUG || echo INFO)" WOPAL_DEBUG_LOG_DIR="$LOGDIR" WOPAL_DEV=1 WOPAL_DEV_CLI_PATH="$space/projects/wopal-cli/src/cli.ts")
  if [ -n "$WOPAL_HOME" ]; then
    desktop_env+=(WOPAL_HOME="$WOPAL_HOME")
    echo "📌 Using Custom WOPAL_HOME: ${WOPAL_HOME}"
  elif [ -n "$ELLAMAKA_TEST_ONBOARDING" ] || [ -n "$OPENCODE_TEST_ONBOARDING" ]; then
    export WOPAL_HOME="/tmp/wopal-onboarding-sandbox"
    desktop_env+=(WOPAL_HOME="/tmp/wopal-onboarding-sandbox" ELLAMAKA_TEST_ONBOARDING=1)
    mkdir -p "/tmp/wopal-onboarding-sandbox"
    echo "🧪 Onboarding Sandbox Active: WOPAL_HOME=/tmp/wopal-onboarding-sandbox"
  fi
  if $debug; then
    plugin_modules="$(plugin_debug_modules "$debug_modules")"
    desktop_env+=(WOPAL_PLUGIN_LOG_LEVEL=debug WOPAL_PLUGIN_LOG_FILE="$PLUGIN_DEBUG_LOG" WOPAL_PLUGIN_LOG_MODULES="$plugin_modules")
    echo "debug: modules=$debug_modules"
  fi

  local electron_vite_bin=""
  if [ -f "$DESKTOP_DIR/node_modules/.bin/electron-vite" ]; then
    electron_vite_bin="./node_modules/.bin/electron-vite"
  elif [ -f "$root/node_modules/.bin/electron-vite" ]; then
    electron_vite_bin="$root/node_modules/.bin/electron-vite"
  elif [ -f "$space/node_modules/.bin/electron-vite" ]; then
    electron_vite_bin="$space/node_modules/.bin/electron-vite"
  fi

  echo "==> Starting Electron (background)..."
  if [ -n "$electron_vite_bin" ]; then
    start_process desktop - "$DESKTOP_LOG" "$DESKTOP_DIR" env "${desktop_env[@]}" "$electron_vite_bin" dev || return 1
  else
    start_process desktop - "$DESKTOP_LOG" "$DESKTOP_DIR" env "${desktop_env[@]}" bun run dev || return 1
  fi
  read_record desktop
  local desktop_pid="$RECORD_PID" elapsed=0 sidecar_url sidecar_port
  printf "  waiting for Electron to start"
  while [ "$elapsed" -lt 300 ]; do
    service_running desktop || { echo ""; echo "Electron exited unexpectedly; see $DESKTOP_LOG"; remove_service_records desktop; return 1; }
    if grep -qE "server ready|dev server running|starting electron app" "$DESKTOP_LOG" 2>/dev/null; then break; fi
    printf "."
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo ""
  if [ "$elapsed" -eq 300 ]; then
    echo "⚠  Electron did not become ready within ${elapsed}s (still running)"
    echo "  Check logs: $DESKTOP_LOG / $SIDECAR_LOG"
    return 1
  fi

  sidecar_url="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$DESKTOP_LOG" 2>/dev/null | head -1)"
  sidecar_port="${sidecar_url##*:}"
  if [[ ! "$sidecar_port" =~ ^[1-9][0-9]*$ ]]; then
    sidecar_port="5173"
  fi
  write_record desktop "$sidecar_port,5173,9222" "$desktop_pid" "$RECORD_PGID"
  record_listener desktop-sidecar "$sidecar_port" || true
  record_listener desktop-vite 5173 || true
  record_listener desktop-devtools 9222 || true
  record_crashpads

  echo "  Electron ready (${elapsed}s)"
  echo "  pidfile: $PIDFILE"
  echo "  desktop log: $DESKTOP_LOG"
  echo "  sidecar log: $SIDECAR_LOG"
}

show_service() {
  local service="$1" display="$2"
  if ! service_has_records "$service"; then return 1; fi
  if ! service_running "$service"; then
    echo "  ✗  $display not running (stale pidfile records removed)"
    remove_service_records "$service"
    return 1
  fi
  read_record "$service" || return 1
  echo "  ✓  $display pid $RECORD_PID, pgid $RECORD_PGID, ports $RECORD_PORT"
  return 0
}

cmd_status() {
  local any=false
  show_service backend backend && any=true || true
  show_service frontend workbench && any=true || true
  show_service desktop desktop && any=true || true
  if ! $any; then
    echo "no dev instances running"
    return 0
  fi
  echo "  pidfile $PIDFILE"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  mkdir -p "$LOGDIR"
  cmd="${1:-help}"
  shift 2>/dev/null || true
  case "$cmd" in
    tui) cmd_tui "$@" ;;
    serve) cmd_serve "$@" ;;
    restart) cmd_restart "$@" ;;
    status) cmd_status ;;
    desktop) cmd_desktop "$@" ;;
    stop) cmd_stop "$@" ;;
    help|*) usage ;;
  esac
fi
