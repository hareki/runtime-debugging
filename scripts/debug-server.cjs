#!/usr/bin/env node

/**
 * Runtime Debugging Log Server
 *
 * Receives log events via HTTP POST and writes them to debug.log
 *
 * Usage:
 *   node debug-server.cjs              # Listen on 127.0.0.1 (localhost only)
 *   node debug-server.cjs --lan        # Listen on 0.0.0.0 (accessible from LAN/devices)
 *
 * Or via the start-server.sh script which handles lifecycle management
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 7243;
const LOG_FILE = path.join(process.cwd(), 'debug.log');

// Check for --lan flag to bind to all interfaces
const LAN_MODE = process.argv.includes('--lan');
const BIND_HOST = LAN_MODE ? '0.0.0.0' : '127.0.0.1';

// Get local IP address for LAN mode
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Clear log file on startup
try {
  fs.writeFileSync(LOG_FILE, '');
  console.log(`[Debug Server] Log file cleared: ${LOG_FILE}`);
} catch (e) {
  console.error(`[Debug Server] Failed to clear log file: ${e.message}`);
}

const server = http.createServer((req, res) => {
  // CORS headers for browser environments
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, logFile: LOG_FILE }));
    return;
  }

  // Log ingestion endpoint
  if (req.method === 'POST' && req.url?.startsWith('/ingest/')) {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const logEntry = {
          ...data,
          _receivedAt: Date.now()
        };

        // Append to log file
        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');

        // Console output for real-time monitoring
        const timestamp = new Date().toISOString().slice(11, 23);
        const hypothesis = data.hypothesisId ? `[${data.hypothesisId}]` : '';
        console.log(`${timestamp} ${hypothesis} [${data.location}] ${data.message}`);

        if (data.data && Object.keys(data.data).length > 0) {
          console.log(`           └─ ${JSON.stringify(data.data)}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        console.error(`[Debug Server] Failed to parse log: ${e.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
      }
    });

    req.on('error', (e) => {
      console.error(`[Debug Server] Request error: ${e.message}`);
      res.writeHead(500);
      res.end();
    });

    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Not Found' }));
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[Debug Server] Port ${PORT} is already in use`);
    console.error('[Debug Server] Another debug server may be running');
    process.exit(1);
  }
  console.error(`[Debug Server] Server error: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, BIND_HOST, () => {
  const localIP = getLocalIP();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║             Runtime Debugging Server Started                 ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  if (LAN_MODE) {
    console.log('║  Mode: LAN (accessible from devices)                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Use these hosts in your fetch() calls:                      ║');
    console.log('║                                                              ║');
    console.log(`║  Mac/iOS Simulator:  http://127.0.0.1:${PORT}                     ║`);
    console.log(`║  Android Emulator:   http://10.0.2.2:${PORT}                      ║`);
    console.log(`║  Real Devices:       http://${localIP}:${PORT}`.padEnd(63) + '║');
  } else {
    console.log('║  Mode: Local (127.0.0.1 only)                                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Endpoint: http://127.0.0.1:${PORT}/ingest/<session-id>           ║`);
    console.log('║                                                              ║');
    console.log('║  TIP: Use --lan flag for device debugging                    ║');
  }

  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Log file: debug.log                                          ║`);
  console.log(`║  Health:   http://${LAN_MODE ? localIP : '127.0.0.1'}:${PORT}/health`.padEnd(63) + '║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Press Ctrl+C to stop                                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Waiting for logs...');
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Debug Server] Shutting down...');
  server.close(() => {
    console.log('[Debug Server] Server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
