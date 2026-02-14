#!/usr/bin/env node

/**
 * Runtime Debugging Log Server
 *
 * Receives log events via HTTP POST and writes them to debug.log.
 * Provides log querying and statistics for hypothesis-driven debugging.
 *
 * Usage:
 *   node debug-server.cjs              # Listen on 127.0.0.1 (localhost only)
 *   node debug-server.cjs --lan        # Listen on 0.0.0.0 (accessible from LAN/devices)
 *   node debug-server.cjs --port 8080  # Custom port (default: 7243)
 *
 * Or via the start-server.sh script which handles lifecycle management
 *
 * Endpoints:
 *   POST   /ingest/<session-id>         - Ingest a single log entry
 *   POST   /ingest/<session-id>/batch   - Ingest multiple log entries
 *   GET    /health                      - Health check
 *   GET    /logs                        - Query logs (with filters)
 *   GET    /logs/stats                  - Log statistics
 *   GET    /logs/timeline               - Execution timeline
 *   DELETE /logs                        - Clear all logs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Configuration ---
const DEFAULT_PORT = 7243;
const MAX_BODY_SIZE = 1024 * 1024; // 1MB max request body

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    lan: false,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lan') config.lan = true;
    if (args[i] === '--port' && args[i + 1]) {
      config.port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return config;
}

const CONFIG = parseArgs();
const PORT = CONFIG.port;
const LOG_FILE = path.join(process.cwd(), 'debug.log');
const BIND_HOST = CONFIG.lan ? '0.0.0.0' : '127.0.0.1';

// --- State ---
let logCounter = 0;

// --- Utilities ---

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

// Log level color mapping for console output
const LOG_LEVEL_COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m', // Yellow
  info: '\x1b[36m', // Cyan
  debug: '\x1b[90m', // Gray
};
const RESET = '\x1b[0m';

function colorize(level, text) {
  const color = LOG_LEVEL_COLORS[level] || '';
  return color ? `${color}${text}${RESET}` : text;
}

// Parse query string
function parseQuery(url) {
  const queryString = url.split('?')[1] || '';
  const params = {};
  queryString.split('&').forEach((pair) => {
    const [key, value] = pair.split('=').map(decodeURIComponent);
    if (key) params[key] = value;
  });
  return params;
}

// Read all log entries from file
function readLogEntries() {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8').trim();
    if (!content) return [];
    return content
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Read body with size limit
function readBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error(`Body exceeds maximum size of ${maxSize} bytes`));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Process and store a single log entry
function processLogEntry(data) {
  logCounter++;

  const logEntry = {
    _seq: logCounter,
    _receivedAt: Date.now(),
    ...data,
    level: data.level || 'info',
  };

  // Append to log file
  fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');

  // Console output with colors and levels
  const timestamp = new Date().toISOString().slice(11, 23);
  const level = (logEntry.level || 'info').toUpperCase().padEnd(5);
  const hypothesis = data.hypothesisId ? `[${data.hypothesisId}]` : '';

  console.log(
    colorize(logEntry.level, `${timestamp} ${level}`) +
      ` ${hypothesis} [${data.location}] ${data.message}`
  );

  if (data.data && Object.keys(data.data).length > 0) {
    const dataStr = JSON.stringify(data.data, null, 0);
    // Truncate long data in console but keep full data in file
    const truncated = dataStr.length > 200 ? dataStr.slice(0, 200) + '...' : dataStr;
    console.log(`           └─ ${truncated}`);
  }

  if (data.error) {
    console.log(colorize('error', `           └─ ERROR: ${data.error.message || data.error}`));
    if (data.error.stack) {
      const stackLines = data.error.stack.split('\n').slice(0, 3);
      stackLines.forEach((line) => {
        console.log(colorize('error', `              ${line.trim()}`));
      });
    }
  }

  return logEntry;
}

// --- Clear log file on startup ---
try {
  fs.writeFileSync(LOG_FILE, '');
  console.log(`[Debug Server] Log file cleared: ${LOG_FILE}`);
} catch (e) {
  console.error(`[Debug Server] Failed to clear log file: ${e.message}`);
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  // CORS headers for browser environments
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const urlPath = req.url?.split('?')[0] || '';
  const query = parseQuery(req.url || '');

  // --- Preflight ---
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // --- Health Check ---
  if (req.method === 'GET' && urlPath === '/health') {
    const entries = readLogEntries();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        port: PORT,
        logFile: LOG_FILE,
        logCount: entries.length,
        uptime: process.uptime(),
      })
    );
    return;
  }

  // --- Query Logs ---
  if (req.method === 'GET' && urlPath === '/logs') {
    const entries = readLogEntries();
    let filtered = entries;

    // Filter by hypothesis
    if (query.hypothesis) {
      filtered = filtered.filter((e) => e.hypothesisId === query.hypothesis);
    }

    // Filter by level
    if (query.level) {
      const levels = query.level.split(',');
      filtered = filtered.filter((e) => levels.includes(e.level || 'info'));
    }

    // Filter by location (partial match)
    if (query.location) {
      filtered = filtered.filter((e) => e.location && e.location.includes(query.location));
    }

    // Search in message
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          (e.message && e.message.toLowerCase().includes(searchLower)) ||
          (e.location && e.location.toLowerCase().includes(searchLower))
      );
    }

    // Limit results
    if (query.limit) {
      const limit = parseInt(query.limit, 10);
      filtered = filtered.slice(-limit);
    }

    // Tail mode (last N)
    if (query.tail) {
      const tail = parseInt(query.tail, 10);
      filtered = filtered.slice(-tail);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: filtered.length, entries: filtered }));
    return;
  }

  // --- Log Statistics ---
  if (req.method === 'GET' && urlPath === '/logs/stats') {
    const entries = readLogEntries();

    const stats = {
      totalEntries: entries.length,
      byHypothesis: {},
      byLevel: {},
      byLocation: {},
      timeRange: { earliest: null, latest: null },
      errorCount: 0,
    };

    entries.forEach((e) => {
      // By hypothesis
      const hId = e.hypothesisId || 'none';
      stats.byHypothesis[hId] = (stats.byHypothesis[hId] || 0) + 1;

      // By level
      const lvl = e.level || 'info';
      stats.byLevel[lvl] = (stats.byLevel[lvl] || 0) + 1;

      // By location (top-level file only)
      if (e.location) {
        const file = e.location.split(':')[0];
        stats.byLocation[file] = (stats.byLocation[file] || 0) + 1;
      }

      // Time range
      if (e.timestamp) {
        if (!stats.timeRange.earliest || e.timestamp < stats.timeRange.earliest) {
          stats.timeRange.earliest = e.timestamp;
        }
        if (!stats.timeRange.latest || e.timestamp > stats.timeRange.latest) {
          stats.timeRange.latest = e.timestamp;
        }
      }

      // Error count
      if (e.level === 'error' || e.error) stats.errorCount++;
    });

    if (stats.timeRange.earliest && stats.timeRange.latest) {
      stats.timeRange.durationMs = stats.timeRange.latest - stats.timeRange.earliest;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // --- Execution Timeline ---
  if (req.method === 'GET' && urlPath === '/logs/timeline') {
    const entries = readLogEntries();
    let filtered = entries;

    if (query.hypothesis) {
      filtered = filtered.filter((e) => e.hypothesisId === query.hypothesis);
    }

    const timeline = filtered
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map((e, i, arr) => {
        const elapsed =
          i > 0 && arr[i - 1].timestamp && e.timestamp ? e.timestamp - arr[i - 1].timestamp : 0;
        return {
          seq: e._seq,
          timestamp: e.timestamp,
          elapsed: `+${elapsed}ms`,
          hypothesis: e.hypothesisId || '-',
          level: e.level || 'info',
          location: e.location,
          message: e.message,
          hasData: !!(e.data && Object.keys(e.data).length > 0),
          hasError: !!e.error,
        };
      });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: timeline.length, timeline }));
    return;
  }

  // --- Clear Logs ---
  if (req.method === 'DELETE' && urlPath === '/logs') {
    try {
      fs.writeFileSync(LOG_FILE, '');
      logCounter = 0;
      console.log('[Debug Server] Logs cleared via API');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Logs cleared' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: e.message }));
    }
    return;
  }

  // --- Batch Log Ingestion ---
  if (req.method === 'POST' && urlPath.match(/^\/ingest\/[^/]+\/batch$/)) {
    try {
      const body = await readBody(req, MAX_BODY_SIZE);
      const data = JSON.parse(body);

      if (!Array.isArray(data.entries)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Expected { entries: [...] }' }));
        return;
      }

      const results = data.entries.map((entry) => processLogEntry(entry));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', processed: results.length }));
    } catch (e) {
      console.error(`[Debug Server] Batch ingestion error: ${e.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: e.message }));
    }
    return;
  }

  // --- Single Log Ingestion ---
  if (req.method === 'POST' && urlPath.startsWith('/ingest/')) {
    try {
      const body = await readBody(req, MAX_BODY_SIZE);
      const data = JSON.parse(body);

      processLogEntry(data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (e) {
      console.error(`[Debug Server] Failed to parse log: ${e.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
    }
    return;
  }

  // --- 404 ---
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'error',
      message: 'Not Found',
      availableEndpoints: [
        'GET  /health',
        'POST /ingest/<session-id>',
        'POST /ingest/<session-id>/batch',
        'GET  /logs',
        'GET  /logs/stats',
        'GET  /logs/timeline',
        'DELETE /logs',
      ],
    })
  );
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
  console.log('║                  Runtime Debugging Server                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  if (CONFIG.lan) {
    console.log('║  Mode: LAN (accessible from devices)                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Hosts for fetch() calls:                                    ║');
    console.log('║                                                              ║');
    console.log(`║  Mac/iOS Simulator:  http://127.0.0.1:${PORT}                   ║`);
    console.log(`║  Android Emulator:   http://10.0.2.2:${PORT}                    ║`);
    console.log(`║  Real Devices:       http://${localIP}:${PORT}`.padEnd(63) + '║');
  } else {
    console.log('║  Mode: Local (127.0.0.1 only)                                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Ingest:  http://127.0.0.1:${PORT}/ingest/<session-id>          ║`);
    console.log('║                                                              ║');
    console.log('║  TIP: Use --lan flag for device debugging                    ║');
  }

  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  API Endpoints:                                              ║');
  console.log(
    `║  Logs:     http://${CONFIG.lan ? localIP : '127.0.0.1'}:${PORT}/logs`.padEnd(63) + '║'
  );
  console.log(
    `║  Stats:    http://${CONFIG.lan ? localIP : '127.0.0.1'}:${PORT}/logs/stats`.padEnd(63) + '║'
  );
  console.log(
    `║  Timeline: http://${CONFIG.lan ? localIP : '127.0.0.1'}:${PORT}/logs/timeline`.padEnd(63) +
      '║'
  );
  console.log(
    `║  Health:   http://${CONFIG.lan ? localIP : '127.0.0.1'}:${PORT}/health`.padEnd(63) + '║'
  );
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Log file: debug.log                                         ║`);
  console.log('║  Press Ctrl+C to stop                                        ║');
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
