#!/bin/bash

# Runtime Debugging Server Launcher
# Handles lifecycle management: checks if running, starts if needed
#
# Usage:
#   ./start-server.sh          # Local mode (127.0.0.1 only)
#   ./start-server.sh --lan    # LAN mode (accessible from devices)

PORT=7243
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/debug-server.cjs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Main logic
main() {
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
    echo ""
    echo "To restart with different mode, first kill the server:"
    echo "  kill \$(lsof -t -i :$PORT)"
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
    echo "To kill the process:"
    echo "  kill \$(lsof -t -i :$PORT)"
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

  # Start the server, passing through any arguments (like --lan)
  echo "Starting debug server..."
  echo ""

  # Run in foreground so user can see logs and Ctrl+C to stop
  node "$SERVER_SCRIPT" "$@"
}

main "$@"
