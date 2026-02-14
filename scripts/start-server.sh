#!/bin/bash

# Runtime Debugging Server Launcher
# Handles lifecycle management: checks if running, starts if needed
#
# Usage:
#   ./start-server.sh              # Local mode (127.0.0.1 only)
#   ./start-server.sh --lan        # LAN mode (accessible from devices)
#   ./start-server.sh --restart    # Kill existing server and restart
#   ./start-server.sh --stop       # Stop the running server
#   ./start-server.sh --clear      # Clear debug.log without restarting
#   ./start-server.sh --port 8080  # Custom port (default: 7243)

PORT=7243
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/debug-server.cjs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments for port override (need this early for health checks)
parse_port() {
  local args=("$@")
  for ((i=0; i<${#args[@]}; i++)); do
    if [[ "${args[$i]}" == "--port" ]] && [[ -n "${args[$((i+1))]}" ]]; then
      PORT="${args[$((i+1))]}"
    fi
  done
}

# Check if server is already running by testing the health endpoint
check_server_running() {
  curl -s --connect-timeout 1 "http://127.0.0.1:$PORT/health" > /dev/null 2>&1
  return $?
}

# Check if port is in use (might be another process)
check_port_in_use() {
  lsof -i :"$PORT" > /dev/null 2>&1
  return $?
}

# Kill the server on the configured port
kill_server() {
  if check_port_in_use; then
    local pid
    pid=$(lsof -t -i :"$PORT" 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      sleep 0.5
      # Force kill if still alive
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null
        sleep 0.3
      fi
      echo -e "${GREEN}✓ Server on port $PORT stopped (PID: $pid)${NC}"
      return 0
    fi
  fi
  echo -e "${YELLOW}⚠ No server found on port $PORT${NC}"
  return 1
}

# Clear debug.log
clear_logs() {
  local log_file
  log_file="$(pwd)/debug.log"

  if [ -f "$log_file" ]; then
    > "$log_file"
    echo -e "${GREEN}✓ Log file cleared: $log_file${NC}"
  else
    echo -e "${YELLOW}⚠ No log file found at: $log_file${NC}"
  fi

  # Also try to clear via API if server is running
  if check_server_running; then
    curl -s -X DELETE "http://127.0.0.1:$PORT/logs" > /dev/null 2>&1
    echo -e "${CYAN}  Also cleared logs via server API${NC}"
  fi
}

# Show server status
show_status() {
  if check_server_running; then
    local health
    health=$(curl -s --connect-timeout 2 "http://127.0.0.1:$PORT/health")
    echo -e "${GREEN}✓ Debug server is running on port $PORT${NC}"
    echo ""
    echo "Health response:"
    echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
    echo ""
  elif check_port_in_use; then
    echo -e "${YELLOW}⚠ Port $PORT is in use but not responding to health check${NC}"
    echo ""
    lsof -i :"$PORT"
  else
    echo -e "${RED}✗ Debug server is not running${NC}"
  fi
}

# Main logic
main() {
  parse_port "$@"

  # Handle special flags
  case "$1" in
    --stop)
      echo ""
      echo "Runtime Debugging Server — Stop"
      echo "================================"
      echo ""
      kill_server
      exit $?
      ;;
    --clear)
      echo ""
      echo "Runtime Debugging Server — Clear Logs"
      echo "======================================"
      echo ""
      clear_logs
      exit 0
      ;;
    --status)
      echo ""
      echo "Runtime Debugging Server — Status"
      echo "=================================="
      echo ""
      show_status
      exit 0
      ;;
    --restart)
      echo ""
      echo "Runtime Debugging Server — Restart"
      echo "==================================="
      echo ""
      kill_server 2>/dev/null
      sleep 0.5
      # Remove --restart from args and continue to start
      shift
      ;;
  esac

  echo ""
  echo "Runtime Debugging Server Launcher"
  echo "=================================="
  echo ""

  # First, check if our server is already running and healthy
  if check_server_running; then
    echo -e "${GREEN}✓ Debug server is already running on port $PORT${NC}"
    echo ""
    echo "Health check: http://127.0.0.1:$PORT/health"
    echo "Ingest endpoint: http://127.0.0.1:$PORT/ingest/<session-id>"
    echo "Logs API: http://127.0.0.1:$PORT/logs"
    echo ""
    echo "Options:"
    echo "  Restart:  $0 --restart"
    echo "  Stop:     $0 --stop"
    echo "  Clear:    $0 --clear"
    echo "  Status:   $0 --status"
    echo ""
    exit 0
  fi

  # Check if port is in use by something else
  if check_port_in_use; then
    echo -e "${YELLOW}⚠ Port $PORT is in use but not responding to health check${NC}"
    echo ""
    echo "This might be:"
    echo "  1. Another process using port $PORT"
    echo "  2. A crashed debug server instance"
    echo ""
    echo "To investigate:"
    echo "  lsof -i :$PORT"
    echo ""
    echo "To kill and restart:"
    echo "  $0 --restart"
    echo ""
    exit 1
  fi

  # Check if server script exists
  if [ ! -f "$SERVER_SCRIPT" ]; then
    echo -e "${RED}✗ Server script not found: $SERVER_SCRIPT${NC}"
    exit 1
  fi

  # Check if node is available
  if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed or not in PATH${NC}"
    exit 1
  fi

  # Start the server, passing through any arguments (like --lan, --port)
  echo "Starting debug server..."
  echo ""

  # Run in foreground so user can see logs and Ctrl+C to stop
  node "$SERVER_SCRIPT" "$@"
}

main "$@"
