const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = 3000;

// Admin password (can be overridden by environment variable)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Default tunnel token (can be overridden by environment variable)
// If set, all new tunnels will use this token unless a different one is provided
const DEFAULT_TUNNEL_TOKEN = process.env.DEFAULT_TUNNEL_TOKEN || 'eyJhIjoiMTk2NTY0M2FlMzRjM2M0Y2IwOWY2ZGJhNTk3OTAwMjQiLCJ0IjoiMmFhZTg1MzMtNzA4ZS00M2Y2LTgzNmEtY2RkOTFmYTRhNDNlIiwicyI6Ik1qbG1NVGxrTWpNdFl6YzBZaTAwTmpnMExUZ3haRFl0TUdNeE9HRTRZMk0wTnpjMCJ9';

// Global reference to allow restart
let server;
let redirectHTMLCache = null;

// Store tunnel processes (similar to Electron app)
// Key: tunnel index, Value: { process, url, name }
const tunnelProcesses = new Map();

// Store tunnel servers (one Express server per tunnel port)
// Key: port number, Value: { server, tunnelIndex }
const tunnelServers = new Map();

// Load HTML template once
function loadRedirectHTML() {
  try {
    const template = fs.readFileSync(path.join(__dirname, 'redirect.html'), 'utf8');
    return template;
  } catch (error) {
    console.error('Error loading redirect HTML:', error);
    return null;
  }
}

// Initialize cache
const htmlTemplate = loadRedirectHTML();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'url-redirect-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Add request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[REQUEST] ${req.method} ${req.url} from ${req.ip || req.connection.remoteAddress || 'unknown'}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[RESPONSE] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Path to the data files
// Check for data directory first (Docker volume), then fallback to project root
const DATA_DIR = fs.existsSync(path.join(__dirname, 'data')) 
  ? path.join(__dirname, 'data') 
  : __dirname;
const TUNNELS_FILE = path.join(DATA_DIR, 'tunnels.json');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

// Get tunnel configs
function getTunnels() {
  try {
    if (fs.existsSync(TUNNELS_FILE)) {
      return JSON.parse(fs.readFileSync(TUNNELS_FILE, 'utf8'));
    }
    return [];
  } catch (error) {
    return [];
  }
}

// Find the next available port starting from 3000
function findNextAvailablePort() {
  const tunnels = getTunnels();
  const usedPorts = tunnels
    .filter(t => t.port)
    .map(t => t.port)
    .sort((a, b) => a - b);
  
  let port = 3000;
  while (usedPorts.includes(port)) {
    port++;
  }
  return port;
}

// Create a server for a specific tunnel
function createTunnelServer(tunnelIndex, port, redirectUrl) {
  const tunnelApp = express();
  
  // Trust proxy for accurate IP addresses
  tunnelApp.set('trust proxy', true);
  
  // Simple redirect server for this tunnel
  tunnelApp.all('*', (req, res) => {
    if (!redirectUrl) {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Configuration Error</title></head>
        <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;text-align:center;">
          <h1>⚠️ Configuration Error</h1>
          <p>Redirect URL is not configured for this tunnel.</p>
        </body>
        </html>
      `);
    }
    
    console.log(`[TUNNEL PORT ${port}] Redirecting to: ${redirectUrl}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.redirect(301, redirectUrl);
  });
  
  let tunnelServer;
  try {
    tunnelServer = tunnelApp.listen(port, '0.0.0.0', () => {
      console.log(`✅ Tunnel server started on port ${port} for tunnel index ${tunnelIndex}`);
      console.log(`   Server accessible at http://192.168.62.188:${port} and http://localhost:${port}`);
    });
    
    tunnelServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} is already in use for tunnel ${tunnelIndex}`);
      } else {
        console.error(`❌ Error starting tunnel server on port ${port}:`, error);
      }
    });
  } catch (error) {
    console.error(`❌ Failed to create tunnel server on port ${port}:`, error);
    throw error;
  }
  
  return tunnelServer;
}

// Find matching tunnel based on request headers and query params
function findTunnelByRequest(req) {
  const tunnels = getTunnels();
  if (tunnels.length === 0) return null;
  
  // First, check query parameter (most reliable)
  if (req.query.tunnel) {
    const tunnel = tunnels.find(t => t.name === req.query.tunnel || t.url.includes(req.query.tunnel));
    if (tunnel) {
      console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using query parameter`);
      return tunnel;
    }
  }
  
  // Get all possible host identifiers from headers
  const host = req.headers.host || '';
  const forwardedHost = req.headers['x-forwarded-host'] || '';
  const cfRay = req.headers['cf-ray'] || ''; // Cloudflare-specific header
  const cfConnectingIP = req.headers['cf-connecting-ip'] || '';
  const referer = req.headers.referer || '';
  const origin = req.headers.origin || '';
  
  // Check if this is a Cloudflare tunnel request
  // Check for various Cloudflare headers
  const hasCFRay = !!cfRay;
  const hasCFConnectingIP = !!cfConnectingIP;
  const hasCFVisitor = !!req.headers['cf-visitor'];
  const hasCFIPCountry = !!req.headers['cf-ipcountry'];
  // Check if forwarded host matches any tunnel domain (including custom domains)
  const forwardedHostMatchesTunnel = tunnels.some(t => {
    if (!t.url) return false;
    const tunnelDomain = t.url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
    return forwardedHost.toLowerCase().includes(tunnelDomain);
  });
  const isCloudflareRequest = !!(hasCFRay || hasCFConnectingIP || hasCFVisitor || hasCFIPCountry || forwardedHostMatchesTunnel);
  
  // AGGRESSIVE FALLBACK: If we detect ANY Cloudflare headers and only one tunnel exists, use it
  // This handles cases where Cloudflare doesn't preserve the original host at all
  if (isCloudflareRequest && tunnels.length === 1) {
    console.log(`[DEBUG] Matched tunnel "${tunnels[0].name}" using Cloudflare header detection (single tunnel fallback)`);
    console.log(`[DEBUG] Cloudflare headers detected: CF-Ray=${hasCFRay}, CF-Connecting-IP=${hasCFConnectingIP}, CF-Visitor=${hasCFVisitor}`);
    return tunnels[0];
  }
  
  // Collect all possible host values
  const hostValues = [];
  
  // Priority 1: X-Forwarded-Host (most reliable for proxies)
  if (forwardedHost) {
    hostValues.push(forwardedHost);
  }
  
  // Priority 2: Origin header
  if (origin) {
    try {
      const originUrl = new URL(origin);
      hostValues.push(originUrl.hostname);
      // Also add full origin for matching (check if it matches any tunnel domain)
      const originMatchesTunnel = tunnels.some(t => {
        if (!t.url) return false;
        const tunnelDomain = t.url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
        return origin.toLowerCase().includes(tunnelDomain);
      });
      if (originMatchesTunnel || origin.includes('.trycloudflare.com')) {
        hostValues.push(origin);
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
  
  // Priority 3: Host header
  // If Cloudflare headers are present, trust the Host header more
  // Also check if host matches any tunnel domain (including custom domains)
  // For Cloudflare requests, always include the Host header
  if (host) {
    const hostMatchesTunnel = tunnels.some(t => {
      if (!t.url) return false;
      const tunnelDomain = t.url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      return host.toLowerCase().includes(tunnelDomain);
    });
    // Always add Host header for Cloudflare requests, or if it matches a tunnel domain
    if (isCloudflareRequest || host.includes('.trycloudflare.com') || hostMatchesTunnel) {
      hostValues.push(host);
      // Also try without port
      if (host.includes(':')) {
        hostValues.push(host.split(':')[0]);
      }
      // For custom domains, also try with https:// prefix
      if (hostMatchesTunnel && !host.includes('.trycloudflare.com')) {
        hostValues.push(`https://${host}`);
      }
    }
  }
  
  // Priority 4: Referer header
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererHost = refererUrl.hostname;
      hostValues.push(refererHost);
      
      // If referer contains tunnel domain, it's a strong signal (check all tunnel domains)
      const refererMatchesTunnel = tunnels.some(t => {
        if (!t.url) return false;
        const tunnelDomain = t.url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
        return referer.toLowerCase().includes(tunnelDomain);
      });
      if (refererMatchesTunnel || referer.includes('.trycloudflare.com')) {
        hostValues.push(referer); // Add full referer URL too
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
  
  // Also check all headers for any mention of tunnel domains (including custom domains)
  if (isCloudflareRequest) {
    Object.keys(req.headers).forEach(key => {
      const headerValue = req.headers[key];
      if (typeof headerValue === 'string') {
        // Check if header value matches any tunnel domain
        const headerMatchesTunnel = tunnels.some(t => {
          if (!t.url) return false;
          const tunnelDomain = t.url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
          return headerValue.toLowerCase().includes(tunnelDomain);
        });
        
        if (headerMatchesTunnel || headerValue.includes('.trycloudflare.com')) {
          try {
            const url = new URL(headerValue.startsWith('http') ? headerValue : `https://${headerValue}`);
            hostValues.push(url.hostname);
          } catch (e) {
            // If not a URL, just add the value as-is
            hostValues.push(headerValue);
          }
        }
      }
    });
  }
  
  // Debug logging
  console.log(`[DEBUG] Tunnel matching - Host: ${host}, ForwardedHost: ${forwardedHost}, Origin: ${origin}, Referer: ${referer}`);
  console.log(`[DEBUG] Cloudflare request: ${isCloudflareRequest}, HostValues: ${JSON.stringify(hostValues)}`);
  console.log(`[DEBUG] Available tunnels: ${tunnels.map(t => `${t.name} (${t.url})`).join(', ')}`);
  
  // Try to match against each tunnel
  for (const tunnel of tunnels) {
    const tunnelUrl = tunnel.url.replace('https://', '').replace('http://', '');
    const tunnelDomain = tunnelUrl.split('/')[0].toLowerCase();
    const tunnelSubdomain = tunnelDomain.split('.')[0]; // e.g., "beside-perceived-sorry-containers"
    
    console.log(`[DEBUG] Checking tunnel "${tunnel.name}" with domain "${tunnelDomain}"`);
    
    // Check if any host value matches the tunnel domain
    for (const hostValue of hostValues) {
      if (!hostValue) continue;
      
      const hostValueLower = hostValue.toLowerCase();
      
      // Exact domain match
      if (hostValueLower === tunnelDomain) {
        console.log(`[DEBUG] ✅ Matched tunnel "${tunnel.name}" using exact domain: ${hostValue}`);
        return tunnel;
      }
      
      // Contains tunnel domain
      if (hostValueLower.includes(tunnelDomain)) {
        console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using domain contains: ${hostValue}`);
        return tunnel;
      }
      
      // Check if tunnel subdomain is in host value
      if (hostValueLower.includes(tunnelSubdomain)) {
        // Verify it's actually a trycloudflare.com domain
        if (hostValueLower.includes('trycloudflare.com')) {
          console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using subdomain match: ${hostValue}`);
          return tunnel;
        }
      }
      
      // Check main domain (trycloudflare.com)
      const domainParts = tunnelDomain.split('.');
      if (domainParts.length >= 2) {
        const mainDomain = domainParts.slice(-2).join('.'); // e.g., "trycloudflare.com"
        if (hostValueLower.includes(mainDomain) && hostValueLower.includes(tunnelSubdomain)) {
          console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using main domain + subdomain: ${hostValue}`);
          return tunnel;
        }
      }
    }
    
    // Check if the tunnel domain is in the referer or origin
    if ((referer && referer.toLowerCase().includes(tunnelDomain)) ||
        (origin && origin.toLowerCase().includes(tunnelDomain)) ||
        (referer && referer.includes(tunnel.url)) ||
        (origin && origin.includes(tunnel.url))) {
      console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using referer/origin: ${referer || origin}`);
      return tunnel;
    }
    
    // Check if tunnel URL is mentioned anywhere in headers
    if (isCloudflareRequest) {
      const allHeaders = JSON.stringify(req.headers).toLowerCase();
      if (allHeaders.includes(tunnelSubdomain) && allHeaders.includes('trycloudflare')) {
        console.log(`[DEBUG] Matched tunnel "${tunnel.name}" using header content search`);
        return tunnel;
      }
    }
  }
  
  return null;
}

// Ensure data directory exists
function ensureDataDir() {
  if (DATA_DIR !== __dirname && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // Initialize analytics file if it doesn't exist
  if (!fs.existsSync(ANALYTICS_FILE)) {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify({}, null, 2));
  }
}

// Get analytics data
function getAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    }
    return {};
  } catch (error) {
    return {};
  }
}

// Save analytics data
function saveAnalytics(analytics) {
  try {
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving analytics:', error);
    return false;
  }
}

// Track tunnel access
function trackTunnelAccess(tunnelUrl) {
  const analytics = getAnalytics();
  if (!analytics[tunnelUrl]) {
    analytics[tunnelUrl] = {
      count: 0,
      firstAccess: new Date().toISOString(),
      lastAccess: new Date().toISOString()
    };
  }
  analytics[tunnelUrl].count++;
  analytics[tunnelUrl].lastAccess = new Date().toISOString();
  saveAnalytics(analytics);
  return analytics[tunnelUrl].count;
}

// Get analytics for a specific tunnel
function getTunnelAnalytics(tunnelUrl) {
  const analytics = getAnalytics();
  return analytics[tunnelUrl] || { count: 0, firstAccess: null, lastAccess: null };
}

// Get local IP address
function getLocalIP() {
  const networkInterfaces = os.networkInterfaces();
  for (const name of Object.keys(networkInterfaces)) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized - Please login' });
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  res.json({ 
    authenticated: !!(req.session && req.session.authenticated) 
  });
});

// API endpoint to get analytics (protected)
app.get('/api/analytics', requireAuth, (req, res) => {
  const analytics = getAnalytics();
  res.json(analytics);
});

// API endpoint to get analytics for a specific tunnel (protected)
app.get('/api/analytics/:tunnelUrl', requireAuth, (req, res) => {
  const tunnelUrl = decodeURIComponent(req.params.tunnelUrl);
  const stats = getTunnelAnalytics(tunnelUrl);
  res.json(stats);
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    status: 'ok',
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint to see all headers (useful for tunnel debugging)
app.get('/debug-headers', (req, res) => {
  const headers = {};
  Object.keys(req.headers).forEach(key => {
    headers[key] = req.headers[key];
  });
  
  const tunnel = findTunnelByRequest(req);
  
  // Check if this is a Cloudflare request
  const isCloudflareRequest = !!(req.headers['cf-ray'] || req.headers['cf-connecting-ip'] || req.headers['cf-visitor']);
  
  res.json({
    headers: headers,
    matchedTunnel: tunnel ? {
      name: tunnel.name,
      url: tunnel.url,
      redirectUrl: tunnel.redirectUrl
    } : null,
    availableTunnels: getTunnels().map(t => ({
      name: t.name,
      url: t.url,
      redirectUrl: t.redirectUrl
    })),
    isCloudflareRequest: isCloudflareRequest,
    tunnelStatus: isCloudflareRequest ? 'active' : 'not_detected'
  });
});

// Tunnel status endpoint
app.get('/api/tunnel-status', requireAuth, async (req, res) => {
  const tunnels = getTunnels();
  const status = [];
  const analytics = getAnalytics();
  
  for (let i = 0; i < tunnels.length; i++) {
    const tunnel = tunnels[i];
    const processInfo = tunnelProcesses.get(i);
    const isRunning = !!processInfo;
    const tunnelUrl = processInfo?.url || tunnel.url;
    const tunnelStats = analytics[tunnelUrl] || { count: 0, firstAccess: null, lastAccess: null };
    
    const tunnelStatus = {
      name: tunnel.name,
      url: tunnelUrl, // Use process URL if available
      redirectUrl: tunnel.redirectUrl,
      clientName: tunnel.clientName || '',
      notes: tunnel.notes || '',
      status: isRunning ? 'running' : 'stopped',
      processRunning: isRunning,
      accessCount: tunnelStats.count,
      firstAccess: tunnelStats.firstAccess,
      lastAccess: tunnelStats.lastAccess,
      hasToken: !!(tunnel.tunnelToken && tunnel.tunnelToken.trim().length > 0),
      hasNamedTunnel: !!(tunnel.tunnelId && tunnel.tunnelName),
      note: isRunning 
        ? 'Tunnel process is running' 
        : 'Tunnel process is not running. Click "Start Tunnel" to launch it.'
    };
    
    // Check if URL is a valid Cloudflare tunnel format
    // Accept both .trycloudflare.com domains and custom domains (like .dtrap)
    const isValidUrl = tunnelStatus.url && 
                       !tunnelStatus.url.includes('placeholder') &&
                       (tunnelStatus.url.includes('.trycloudflare.com') || 
                        tunnelStatus.url.includes('.') || 
                        tunnelStatus.url.startsWith('https://'));
    
    if (!isValidUrl) {
      if (isRunning) {
        tunnelStatus.note = 'Tunnel is starting, URL will be available soon...';
      } else {
        tunnelStatus.status = 'invalid';
        tunnelStatus.note = 'URL is not set. Start the tunnel to get a URL.';
      }
    }
    
    status.push(tunnelStatus);
  }
  
  res.json({ tunnels: status });
});

// Tunnel health check endpoint
app.get('/api/tunnel-health/:index', requireAuth, (req, res) => {
  const index = parseInt(req.params.index);
  const tunnels = getTunnels();
  
  if (index < 0 || index >= tunnels.length) {
    return res.status(400).json({ error: 'Invalid tunnel index' });
  }
  
  const tunnel = tunnels[index];
  const processInfo = tunnelProcesses.get(index);
  
  const health = {
    tunnelName: tunnel.name,
    isRunning: !!processInfo,
    hasToken: !!(tunnel.tunnelToken && tunnel.tunnelToken.trim().length > 0),
    hasUrl: !!(tunnel.url && !tunnel.url.includes('placeholder')),
    url: tunnel.url,
    redirectUrl: tunnel.redirectUrl,
    status: 'unknown',
    issues: []
  };
  
  // Check for common issues
  if (!health.isRunning) {
    health.issues.push('Tunnel process is not running. Click "Start Tunnel" to launch it.');
    health.status = 'stopped';
  } else if (!health.hasUrl) {
    health.issues.push('Tunnel URL is not set. For token-based tunnels, get the URL from Cloudflare Dashboard and update it in the admin panel.');
    health.status = 'no_url';
  } else if (!health.hasToken && !tunnel.tunnelName) {
    health.issues.push('Tunnel is using quick tunnel mode. URLs will change on restart. Consider using a token-based tunnel for persistent URLs.');
    health.status = 'quick_tunnel';
  } else if (health.hasToken) {
    health.status = 'token_tunnel';
        health.issues.push('For token-based tunnels, ensure the route is configured in Cloudflare Dashboard: Networks → Tunnels → Your Tunnel → Configure → Add Public Hostname → Service: http://localhost:3000');
  } else {
    health.status = 'healthy';
  }
  
  if (!health.redirectUrl) {
    health.issues.push('Redirect URL is not configured. Set it in the admin panel.');
  }
  
  res.json({ health });
});

// Start tunnel process
app.post('/api/tunnels/:index/start', requireAuth, (req, res) => {
  const index = parseInt(req.params.index);
  const tunnels = getTunnels();
  
  if (index < 0 || index >= tunnels.length) {
    return res.status(400).json({ error: 'Invalid tunnel index' });
  }
  
  const tunnel = tunnels[index];
  
  // Check if already running (by index)
  if (tunnelProcesses.has(index)) {
    const processInfo = tunnelProcesses.get(index);
    return res.json({ 
      success: true, 
      message: 'Tunnel is already running',
      url: processInfo.url || tunnel.url,
      processRunning: true
    });
  }
  
  console.log(`[TUNNEL ${tunnel.name}] Starting cloudflared process...`);
  
  // Get the tunnel's assigned port (default to 3000 for backwards compatibility)
  const tunnelPort = tunnel.port || 3000;
  
  // Ensure tunnel server is running on the assigned port
  if (!tunnelServers.has(tunnelPort)) {
    console.log(`[TUNNEL ${tunnel.name}] Starting server on port ${tunnelPort}`);
    const tunnelServer = createTunnelServer(index, tunnelPort, tunnel.redirectUrl || '');
    tunnelServers.set(tunnelPort, { server: tunnelServer, tunnelIndex: index });
  } else {
    // Update redirect URL if server already exists
    console.log(`[TUNNEL ${tunnel.name}] Server already running on port ${tunnelPort}`);
  }
  
  // Check tunnel type: token > named tunnel > quick tunnel
  // Priority: token (most persistent) > named tunnel > quick tunnel
  const hasToken = tunnel.tunnelToken && tunnel.tunnelToken.trim().length > 0;
  let useNamedTunnel = tunnel.tunnelId && tunnel.tunnelName;
  let cloudflaredCmd;
  
  if (hasToken) {
    // Use token-based tunnel for maximum persistence
    console.log(`[TUNNEL ${tunnel.name}] Using token-based tunnel (persistent URL)`);
    // For token tunnels, we need to configure the route in Cloudflare Dashboard
    // The route should point to http://localhost:${tunnelPort}
    cloudflaredCmd = spawn('cloudflared', ['tunnel', '--no-autoupdate', 'run', '--token', tunnel.tunnelToken], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true  // Detach process so it survives parent process issues
    });
    cloudflaredCmd.unref(); // Allow parent to exit independently
    const useNamedTunnel = true; // Token tunnels are persistent like named tunnels
  } else if (useNamedTunnel) {
    // Use named tunnel for persistent URL
    console.log(`[TUNNEL ${tunnel.name}] Using named tunnel: ${tunnel.tunnelName}`);
    cloudflaredCmd = spawn('cloudflared', ['tunnel', 'run', tunnel.tunnelName], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true  // Detach process so it survives parent process issues
    });
    cloudflaredCmd.unref(); // Allow parent to exit independently
  } else {
    // Check if we have a valid URL - if so, try to create named tunnel on first start
    // Otherwise use quick tunnel (will create named tunnel when URL is received)
    // Accept both .trycloudflare.com domains and custom domains (like .dtrap)
    const hasValidUrl = tunnel.url && 
                       !tunnel.url.includes('placeholder') &&
                       (tunnel.url.includes('.trycloudflare.com') || 
                        tunnel.url.includes('.') || 
                        tunnel.url.startsWith('https://'));
    
    if (hasValidUrl && !tunnel.tunnelName) {
      // We have a URL but no named tunnel - try to create one now
      console.log(`[TUNNEL ${tunnel.name}] Has URL but no named tunnel. Creating named tunnel for persistence...`);
      const safeTunnelName = tunnel.name.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `tunnel-${index}`;
      
      try {
        const { execSync } = require('child_process');
        const createOutput = execSync(`cloudflared tunnel create ${safeTunnelName}`, { 
          encoding: 'utf8',
          timeout: 30000,
          stdio: 'pipe'
        });
        
        const listOutput = execSync(`cloudflared tunnel list`, { 
          encoding: 'utf8',
          timeout: 10000,
          stdio: 'pipe'
        });
        
        let tunnelId = null;
        const lines = listOutput.split('\n');
        for (const line of lines) {
          if (line.includes(safeTunnelName)) {
            const match = line.match(/([a-f0-9-]{36})/);
            if (match) {
              tunnelId = match[1];
              break;
            }
          }
        }
        
        if (tunnelId) {
          tunnel.tunnelName = safeTunnelName;
          tunnel.tunnelId = tunnelId;
          const updatedTunnels = getTunnels();
          updatedTunnels[index] = tunnel;
          saveTunnels(updatedTunnels);
          console.log(`[TUNNEL ${tunnel.name}] ✅ Created named tunnel: ${safeTunnelName}`);
          // Update flag to use named tunnel
          useNamedTunnel = true;
          // Now use named tunnel
          cloudflaredCmd = spawn('cloudflared', ['tunnel', 'run', safeTunnelName], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true  // Detach process so it survives parent process issues
          });
          cloudflaredCmd.unref(); // Allow parent to exit independently
        } else {
          throw new Error('Could not extract tunnel ID');
        }
      } catch (error) {
        console.log(`[TUNNEL ${tunnel.name}] ⚠️ Could not create named tunnel: ${error.message}`);
        console.log(`[TUNNEL ${tunnel.name}] Using quick tunnel - URL may change on restart`);
        cloudflaredCmd = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${tunnelPort}`], {
          cwd: __dirname,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true  // Detach process so it survives parent process issues
        });
        cloudflaredCmd.unref(); // Allow parent to exit independently
      }
    } else {
      // No URL yet or already has named tunnel - use quick tunnel
      cloudflaredCmd = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true  // Detach process so it survives parent process issues
      });
      cloudflaredCmd.unref(); // Allow parent to exit independently
    }
  }
  
  let tunnelUrl = '';
  let urlFound = false;
  let output = '';
  let responseSent = false;
  
  const sendResponse = (url, message, note = null) => {
    if (responseSent) return;
    responseSent = true;
    
    res.json({ 
      success: true, 
      message: message,
      url: url,
      processRunning: true,
      note: note
    });
  };
  
  const handleOutput = (data) => {
    const text = data.toString();
    output += text;
    console.log(`[TUNNEL ${tunnel.name}] ${text.trim()}`);
    
    // Check for connection errors or warnings
    if (text.includes('ERR') || text.includes('Error') || text.includes('error')) {
      console.log(`[TUNNEL ${tunnel.name}] ⚠️ Error detected in output: ${text.trim()}`);
    }
    
    // Check for successful connection
    if (text.includes('Registered tunnel connection') || text.includes('Connection established')) {
      console.log(`[TUNNEL ${tunnel.name}] ✅ Tunnel connection established`);
    }
    
    // Try multiple patterns to extract the URL
    const urlPatterns = [
      /https:\/\/[^\s]+\.trycloudflare\.com/g,
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g,
      /(https?:\/\/[^\s]+trycloudflare[^\s]+)/g,
      /https:\/\/[a-z0-9-]+-[a-z0-9-]+-[a-z0-9-]+\.trycloudflare\.com/g
    ];
    
    for (const pattern of urlPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        const foundUrl = matches[0].trim();
        if (foundUrl && !tunnelUrl) {
          tunnelUrl = foundUrl;
          console.log(`[TUNNEL ${tunnel.name}] Found URL: ${tunnelUrl}`);
        }
      }
    }
    
    // Check for tunnel ready signals
    // For token tunnels, we can consider them ready if we see connection signals, even without URL in output
    const isConnectionReady = text.includes('INF |') || 
          text.includes('Your quick Tunnel has been created') || 
          text.includes('Registered tunnel connection') ||
          text.includes('Connection established') ||
          text.includes('Serving at') ||
          text.includes('Tunnel is ready') ||
          text.includes('Ready to serve traffic');
    
    if (isConnectionReady && !urlFound) {
      // For token tunnels with stored URL, we can mark as ready even if URL not in output
      if (hasToken && tunnel.url && !tunnel.url.includes('placeholder') && !tunnelUrl) {
        // Token tunnel with stored URL - use stored URL
        tunnelUrl = tunnel.url;
        console.log(`[TUNNEL ${tunnel.name}] ✅ Token tunnel connected - using stored URL: ${tunnelUrl}`);
        urlFound = true;
      } else if (tunnelUrl) {
        // We found URL in output
        urlFound = true;
      } else {
        // Connection ready but no URL yet - wait a bit more
        return;
      }
      
      if (urlFound) {
        // Handle URL based on tunnel type
        if (hasToken) {
          // Token-based tunnel - URL is persistent, save it if not set
          // For custom domains (not .trycloudflare.com), never overwrite the stored URL
          const isCustomDomain = tunnel.url && 
                                !tunnel.url.includes('.trycloudflare.com') && 
                                !tunnel.url.includes('placeholder');
          
          if (!tunnel.url || tunnel.url.includes('placeholder')) {
            console.log(`[TUNNEL ${tunnel.name}] 💾 Saving persistent URL from token tunnel: ${tunnelUrl}`);
            tunnel.url = tunnelUrl;
            const updatedTunnels = getTunnels();
            updatedTunnels[index] = tunnel;
            saveTunnels(updatedTunnels);
          } else if (isCustomDomain) {
            // Custom domain - never overwrite, trust the stored URL
            console.log(`[TUNNEL ${tunnel.name}] ✅ Token tunnel with custom domain - preserving stored URL: ${tunnel.url}`);
            tunnelUrl = tunnel.url; // Use stored URL instead of output
          } else if (tunnel.url !== tunnelUrl && tunnelUrl) {
            // Only update if it's a .trycloudflare.com domain and URLs don't match
            console.log(`[TUNNEL ${tunnel.name}] ⚠️ Token tunnel URL mismatch. Updating stored URL: ${tunnelUrl}`);
            tunnel.url = tunnelUrl;
            const updatedTunnels = getTunnels();
            updatedTunnels[index] = tunnel;
            saveTunnels(updatedTunnels);
          } else {
            console.log(`[TUNNEL ${tunnel.name}] ✅ Token tunnel - URL matches: ${tunnelUrl}`);
          }
        } else if (useNamedTunnel) {
          // Named tunnel - URL should be persistent, but verify it matches
          if (tunnel.url && tunnel.url !== tunnelUrl) {
            console.log(`[TUNNEL ${tunnel.name}] ⚠️ Named tunnel URL mismatch. Stored: ${tunnel.url}, Actual: ${tunnelUrl}`);
            console.log(`[TUNNEL ${tunnel.name}] Using actual tunnel URL: ${tunnelUrl}`);
            tunnel.url = tunnelUrl; // Update to match actual tunnel
            const updatedTunnels = getTunnels();
            updatedTunnels[index] = tunnel;
            saveTunnels(updatedTunnels);
          } else {
            console.log(`[TUNNEL ${tunnel.name}] ✅ Named tunnel - URL matches: ${tunnelUrl}`);
          }
        } else {
          // Quick tunnel - MUST use the actual URL from the process
          // Quick tunnels generate new URLs each time, so we must update
          console.log(`[TUNNEL ${tunnel.name}] Quick tunnel - updating to actual URL: ${tunnelUrl}`);
          console.log(`[TUNNEL ${tunnel.name}] ⚠️ WARNING: Quick tunnel URLs change on restart!`);
          console.log(`[TUNNEL ${tunnel.name}] For persistent URLs, use token-based tunnels or named tunnels`);
          tunnel.url = tunnelUrl;
          const updatedTunnels = getTunnels();
          updatedTunnels[index] = tunnel;
          saveTunnels(updatedTunnels);
        }
        
        // Store process info by index
        tunnelProcesses.set(index, {
          process: cloudflaredCmd,
          url: tunnelUrl,
          name: tunnel.name
        });
        
        console.log(`✅ Tunnel "${tunnel.name}" started successfully! URL: ${tunnelUrl}`);
        sendResponse(tunnelUrl, 'Tunnel started successfully!', null);
      }
    }
  };
  
  cloudflaredCmd.stdout.on('data', handleOutput);
  cloudflaredCmd.stderr.on('data', handleOutput);
  
  cloudflaredCmd.on('close', (code) => {
    console.log(`[TUNNEL ${tunnel.name}] Process exited with code ${code}`);
    tunnelProcesses.delete(index);
  });
  
  cloudflaredCmd.on('error', (error) => {
    console.error(`[TUNNEL ${tunnel.name}] Error:`, error);
    tunnelProcesses.delete(index);
    if (!responseSent) {
      responseSent = true;
      res.status(500).json({ 
        error: 'Failed to start tunnel. Is cloudflared installed?',
        details: error.message 
      });
    }
  });
  
  // Wait for URL with multiple timeouts
  // For token tunnels with stored URL, we can respond faster
  setTimeout(() => {
    if (!responseSent) {
      // Use actual tunnel URL (for quick tunnels) or stored URL (for token/named tunnels)
      const finalUrl = tunnelUrl || tunnel.url;
      
      // For token tunnels with stored URL, consider ready if process is running
      // For custom domains, always preserve the stored URL
      const isCustomDomain = tunnel.url && 
                            !tunnel.url.includes('.trycloudflare.com') && 
                            !tunnel.url.includes('placeholder');
      
      if (hasToken && tunnel.url && !tunnel.url.includes('placeholder') && !tunnelUrl) {
        // Token tunnel with stored URL - trust it and mark as ready
        console.log(`[TUNNEL ${tunnel.name}] ✅ Token tunnel process running - using stored URL: ${tunnel.url}`);
        tunnelProcesses.set(index, {
          process: cloudflaredCmd,
          url: tunnel.url,
          name: tunnel.name
        });
        sendResponse(tunnel.url, 'Token tunnel started (using stored URL)', 'Tunnel is connected and ready');
        return;
      }
      
      // For quick tunnels, always update to match actual process
      // For token/named tunnels, URL should already match or be saved
      if (!hasToken && !useNamedTunnel && tunnelUrl && tunnelUrl !== tunnel.url) {
        console.log(`[TUNNEL ${tunnel.name}] Updating URL to match running tunnel: ${tunnelUrl}`);
        tunnel.url = tunnelUrl;
        const updatedTunnels = getTunnels();
        updatedTunnels[index] = tunnel;
        saveTunnels(updatedTunnels);
      } else if (hasToken && !isCustomDomain && tunnelUrl && (!tunnel.url || tunnel.url.includes('placeholder'))) {
        // Token tunnel - save URL if not set (but not for custom domains)
        console.log(`[TUNNEL ${tunnel.name}] Saving token tunnel URL: ${tunnelUrl}`);
        tunnel.url = tunnelUrl;
        const updatedTunnels = getTunnels();
        updatedTunnels[index] = tunnel;
        saveTunnels(updatedTunnels);
      } else if (hasToken && isCustomDomain) {
        // Custom domain - preserve stored URL, don't overwrite
        console.log(`[TUNNEL ${tunnel.name}] ✅ Custom domain - preserving stored URL: ${tunnel.url}`);
      }
      
      if (finalUrl) {
        tunnelProcesses.set(index, {
          process: cloudflaredCmd,
          url: finalUrl,
          name: tunnel.name
        });
        
        const message = hasToken 
          ? 'Token tunnel started (persistent URL)' 
          : useNamedTunnel 
            ? 'Using persistent URL.' 
            : 'URL updated to match running tunnel.';
        
        sendResponse(finalUrl, 'Tunnel started!', message);
      }
    }
  }, 5000);
  
  // Final timeout after 10 seconds
  setTimeout(() => {
    if (!responseSent) {
      const finalUrl = tunnelUrl || tunnel.url;
      
      // For token tunnels with stored URL, always use it even if not in output
      // For custom domains, always preserve the stored URL
      const isCustomDomain = tunnel.url && 
                            !tunnel.url.includes('.trycloudflare.com') && 
                            !tunnel.url.includes('placeholder');
      
      if (hasToken && tunnel.url && !tunnel.url.includes('placeholder')) {
        console.log(`[TUNNEL ${tunnel.name}] ✅ Token tunnel - using stored URL: ${tunnel.url}`);
        tunnelProcesses.set(index, {
          process: cloudflaredCmd,
          url: tunnel.url,
          name: tunnel.name
        });
        sendResponse(tunnel.url, 'Token tunnel started (using stored URL)', 'Tunnel is connected and ready');
        return;
      }
      
      // Update URL for quick tunnels, save for token tunnels
      if (!hasToken && !useNamedTunnel && tunnelUrl && tunnelUrl !== tunnel.url) {
        console.log(`[TUNNEL ${tunnel.name}] Updating URL: ${tunnelUrl}`);
        tunnel.url = tunnelUrl;
        const updatedTunnels = getTunnels();
        updatedTunnels[index] = tunnel;
        saveTunnels(updatedTunnels);
      } else if (hasToken && !isCustomDomain && tunnelUrl && (!tunnel.url || tunnel.url.includes('placeholder'))) {
        // Token tunnel - save URL if not set (but not for custom domains)
        console.log(`[TUNNEL ${tunnel.name}] Saving token tunnel URL: ${tunnelUrl}`);
        tunnel.url = tunnelUrl;
        const updatedTunnels = getTunnels();
        updatedTunnels[index] = tunnel;
        saveTunnels(updatedTunnels);
      } else if (hasToken && isCustomDomain) {
        // Custom domain - preserve stored URL, don't overwrite
        console.log(`[TUNNEL ${tunnel.name}] ✅ Custom domain - preserving stored URL: ${tunnel.url}`);
      }
      
      if (finalUrl) {
        tunnelProcesses.set(index, {
          process: cloudflaredCmd,
          url: finalUrl,
          name: tunnel.name
        });
        
        const message = hasToken 
          ? 'Token tunnel started (persistent URL)' 
          : useNamedTunnel 
            ? 'Using persistent URL.' 
            : 'URL updated. For persistent URLs, use token-based tunnels.';
        
        sendResponse(finalUrl, 'Tunnel process started', message);
      } else {
        // No URL found - still mark process as running for token tunnels
        if (hasToken && tunnel.url && !tunnel.url.includes('placeholder')) {
          tunnelProcesses.set(index, {
            process: cloudflaredCmd,
            url: tunnel.url,
            name: tunnel.name
          });
          sendResponse(tunnel.url, 'Token tunnel started (using stored URL)', 'Tunnel is connected and ready');
        } else {
          sendResponse(tunnel.url || 'Unknown', 'Tunnel process started', 'Waiting for URL...');
        }
      }
    }
  }, 10000);
});

// Stop tunnel process
app.post('/api/tunnels/:index/stop', requireAuth, (req, res) => {
  const index = parseInt(req.params.index);
  const tunnels = getTunnels();
  
  if (index < 0 || index >= tunnels.length) {
    return res.status(400).json({ error: 'Invalid tunnel index' });
  }
  
  const tunnel = tunnels[index];
  const processInfo = tunnelProcesses.get(index);
  
  if (!processInfo) {
    return res.json({ 
      success: true, 
      message: 'Tunnel is not running' 
    });
  }
  
  try {
    // Try to kill the process
    if (processInfo.process && !processInfo.process.killed) {
      processInfo.process.kill('SIGTERM');
      // If still alive after 2 seconds, force kill
      setTimeout(() => {
        if (processInfo.process && !processInfo.process.killed) {
          try {
            processInfo.process.kill('SIGKILL');
          } catch (e) {
            // Process may have already exited
          }
        }
      }, 2000);
    }
    tunnelProcesses.delete(index);
    console.log(`🛑 Tunnel "${tunnel.name}" stopped`);
    
    res.json({ 
      success: true, 
      message: 'Tunnel stopped' 
    });
  } catch (error) {
    console.error(`Error stopping tunnel:`, error);
    tunnelProcesses.delete(index);
    res.json({ 
      success: true, 
      message: 'Tunnel stopped (process may have already exited)' 
    });
  }
});

// Diagnostic page to verify phone can connect
app.get('/check', (req, res) => {
  const info = {
    status: 'Server is reachable!',
    clientIP: req.ip || req.connection.remoteAddress,
    timestamp: new Date().toISOString()
  };
  console.log('[CHECK REQUEST]', info);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>URL Redirect - Check</title></head>
    <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;">
      <h1>✅ Server is Working!</h1>
      <p><strong>Your IP:</strong> ${info.clientIP}</p>
      <p><strong>Time:</strong> ${info.timestamp}</p>
      <hr>
      <h2>If you see this page, the server can connect!</h2>
      <p>This is a tunnel-based redirect system. Each tunnel has its own redirect URL.</p>
    </body>
    </html>
  `);
});

// Save tunnels
function saveTunnels(tunnels) {
  try {
    fs.writeFileSync(TUNNELS_FILE, JSON.stringify(tunnels, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving tunnels:', error);
    return false;
  }
}

// API endpoint to get tunnels (protected)
app.get('/api/tunnels', requireAuth, (req, res) => {
  res.json({ tunnels: getTunnels() });
});

// API endpoint to add tunnel (protected)
app.post('/api/tunnels', requireAuth, (req, res) => {
  const { name, url, redirectUrl, clientName, notes, tunnelToken } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  
  const tunnels = getTunnels();
  
  // Find next available port and start server immediately
  const assignedPort = findNextAvailablePort();
  console.log(`[TUNNEL ${name}] Assigning port ${assignedPort}`);
  
  // Start the tunnel server on the assigned port (even if redirectUrl is not set yet)
  const tunnelServer = createTunnelServer(tunnels.length, assignedPort, redirectUrl || '');
  tunnelServers.set(assignedPort, { server: tunnelServer, tunnelIndex: tunnels.length });
  
  console.log(`[TUNNEL ${name}] ✅ Server started on port ${assignedPort}`);
  
  // If token is provided, use it (highest priority for persistence)
  // Otherwise, use default token if available
  // Otherwise, try to create a named tunnel for persistence
  let tunnelName = null;
  let tunnelId = null;
  let finalUrl = url;
  let finalToken = tunnelToken && tunnelToken.trim().length > 0 
    ? tunnelToken 
    : (DEFAULT_TUNNEL_TOKEN || '');
  
  if (finalToken) {
    // Token provided (explicit or default) - this gives persistent URLs
    console.log(`[TUNNEL ${name}] Using tunnel token for persistent URL`);
  } else if (!url || url.includes('placeholder')) {
    // Try to create a named tunnel for persistence (if not logged in, will fail gracefully)
    const safeTunnelName = name.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `tunnel-${tunnels.length}`;
    
    try {
      const { execSync } = require('child_process');
      console.log(`[TUNNEL ${name}] Creating named tunnel for persistence: ${safeTunnelName}`);
      
      const createOutput = execSync(`cloudflared tunnel create ${safeTunnelName}`, { 
        encoding: 'utf8',
        timeout: 30000,
        stdio: 'pipe'
      });
      
      const listOutput = execSync(`cloudflared tunnel list`, { 
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });
      
      const lines = listOutput.split('\n');
      for (const line of lines) {
        if (line.includes(safeTunnelName)) {
          const match = line.match(/([a-f0-9-]{36})/);
          if (match) {
            tunnelId = match[1];
            tunnelName = safeTunnelName;
            console.log(`[TUNNEL ${name}] ✅ Created named tunnel: ${tunnelName} (ID: ${tunnelId})`);
            break;
          }
        }
      }
    } catch (error) {
      console.log(`[TUNNEL ${name}] ⚠️ Could not create named tunnel: ${error.message}`);
      console.log(`[TUNNEL ${name}] Will use quick tunnel - URL will be generated on start`);
    }
  }
  
  // Preserve the URL exactly as provided - don't default to placeholder if URL was provided
  // Only use placeholder if URL was truly not provided or is empty
  const savedUrl = (finalUrl && finalUrl.trim() && !finalUrl.includes('placeholder')) 
    ? finalUrl 
    : (url && url.trim() && !url.includes('placeholder'))
      ? url
      : 'https://placeholder-will-be-updated.trycloudflare.com';
  
  tunnels.push({ 
    name, 
    url: savedUrl, 
    redirectUrl: redirectUrl || '', 
    clientName: clientName || '',
    notes: notes || '',
    tunnelToken: finalToken,
    tunnelName: tunnelName,
    tunnelId: tunnelId,
    port: assignedPort  // Store the assigned port
  });
  
  if (saveTunnels(tunnels)) {
    const message = finalToken 
      ? `Tunnel server started on port ${assignedPort}. Tunnel created with token (persistent URL)` 
      : tunnelName 
        ? `Tunnel server started on port ${assignedPort}. Tunnel created with named tunnel (persistent URL)` 
        : `Tunnel server started on port ${assignedPort}. Tunnel created (will use quick tunnel - URL may change)`;
    
    res.json({ 
      success: true,
      port: assignedPort,
      hasToken: !!finalToken,
      hasNamedTunnel: !!tunnelName,
      message: message
    });
  } else {
    res.status(500).json({ error: 'Failed to save tunnel' });
  }
});

// API endpoint to update tunnel (protected)
app.put('/api/tunnels/:index', requireAuth, (req, res) => {
  const index = parseInt(req.params.index);
  
  const tunnels = getTunnels();
  if (index < 0 || index >= tunnels.length) {
    return res.status(400).json({ error: 'Invalid tunnel index' });
  }
  
  const { name, url, redirectUrl, clientName, notes, tunnelToken } = req.body;
  if (name !== undefined) tunnels[index].name = name;
  
  // Preserve custom domain URLs - never overwrite them
  if (url !== undefined) {
    const currentUrl = tunnels[index].url;
    const isCurrentCustomDomain = currentUrl && 
                                 !currentUrl.includes('.trycloudflare.com') && 
                                 !currentUrl.includes('placeholder');
    const isNewCustomDomain = url && 
                             !url.includes('.trycloudflare.com') && 
                             !url.includes('placeholder');
    
    // If current URL is a custom domain, only allow update if new URL is also a custom domain
    // Otherwise, always allow the update
    if (isCurrentCustomDomain && !isNewCustomDomain) {
      console.log(`[TUNNEL ${tunnels[index].name}] ⚠️ Preserving custom domain URL: ${currentUrl} (rejecting update to: ${url})`);
      // Don't update - preserve the custom domain
    } else {
      tunnels[index].url = url;
    }
  }
  
  // redirectUrl is handled above
  if (clientName !== undefined) tunnels[index].clientName = clientName;
  if (notes !== undefined) tunnels[index].notes = notes;
  if (tunnelToken !== undefined) tunnels[index].tunnelToken = tunnelToken;
  
  if (saveTunnels(tunnels)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to update tunnel' });
  }
});

// API endpoint to delete tunnel (protected)
app.delete('/api/tunnels/:index', requireAuth, (req, res) => {
  const index = parseInt(req.params.index);
  
  const tunnels = getTunnels();
  if (index < 0 || index >= tunnels.length) {
    return res.status(400).json({ error: 'Invalid tunnel index' });
  }
  
  tunnels.splice(index, 1);
  
  if (saveTunnels(tunnels)) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to delete tunnel' });
  }
});

// Serve login page
app.get('/login', (req, res) => {
  // If already authenticated, redirect to admin
  if (req.session && req.session.authenticated) {
    return res.redirect('/admin');
  }
  
  try {
    const loginHTML = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');
    res.send(loginHTML);
  } catch (error) {
    console.error('Error serving login page:', error);
    res.status(500).send('Login page not available');
  }
});

// Serve admin panel (protected)
app.get('/admin', (req, res) => {
  // Redirect to login if not authenticated
  if (!req.session || !req.session.authenticated) {
    return res.redirect('/login');
  }
  
  try {
    const adminHTML = fs.readFileSync(path.join(__dirname, 'admin-panel-web.html'), 'utf8');
    res.send(adminHTML);
  } catch (error) {
    console.error('Error serving admin panel:', error);
    res.status(500).send('Admin panel not available');
  }
});

// Serve redirect HTML page - use simple HTTP redirect for speed
app.get('/', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const timestamp = new Date().toISOString();
  
  // Find tunnel that matches this request
  const tunnel = findTunnelByRequest(req);
  
  if (!tunnel) {
    // No tunnel matched - return error page
    console.log(`[${timestamp}] No tunnel matched for request from ${clientIP}`);
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>No Tunnel Found</title></head>
      <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;text-align:center;">
        <h1>❌ No Tunnel Configured</h1>
        <p>No tunnel was found for this request. Please configure a tunnel in the admin panel.</p>
        <p><a href="/admin">Go to Admin Panel</a></p>
      </body>
      </html>
    `);
    return;
  }
  
  // Track analytics
  const tunnelUrl = tunnel.url;
  const accessCount = trackTunnelAccess(tunnelUrl);
  
  // Get redirect URL (must have one)
  let redirectUrl = tunnel.redirectUrl;
  if (!redirectUrl) {
    console.log(`[${timestamp}] Tunnel "${tunnel.name}" has no redirect URL configured`);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Configuration Error</title></head>
      <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;text-align:center;">
        <h1>⚠️ Configuration Error</h1>
        <p>Tunnel "${tunnel.name}" does not have a redirect URL configured.</p>
        <p><a href="/admin">Go to Admin Panel</a></p>
      </body>
      </html>
    `);
    return;
  }
  
  console.log(`[${timestamp}] Tunnel "${tunnel.name}" (${tunnel.clientName || 'No client'}) → ${redirectUrl} [Access #${accessCount}]`);
  
  // Use simple HTTP redirect for maximum speed and compatibility
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.redirect(301, redirectUrl);
});

// Catch-all for other routes
app.all('*', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const timestamp = new Date().toISOString();
  
  // Find tunnel that matches this request
  const tunnel = findTunnelByRequest(req);
  
  if (!tunnel) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>No Tunnel Found</title></head>
      <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;text-align:center;">
        <h1>❌ No Tunnel Configured</h1>
        <p>No tunnel was found for this request. Please configure a tunnel in the admin panel.</p>
        <p><a href="/admin">Go to Admin Panel</a></p>
      </body>
      </html>
    `);
    return;
  }
  
  // Track analytics
  const tunnelUrl = tunnel.url;
  const accessCount = trackTunnelAccess(tunnelUrl);
  
  // Get redirect URL (must have one)
  let redirectUrl = tunnel.redirectUrl;
  if (!redirectUrl) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Configuration Error</title></head>
      <body style="font-family:Arial;padding:20px;max-width:600px;margin:0 auto;text-align:center;">
        <h1>⚠️ Configuration Error</h1>
        <p>Tunnel "${tunnel.name}" does not have a redirect URL configured.</p>
        <p><a href="/admin">Go to Admin Panel</a></p>
      </body>
      </html>
    `);
    return;
  }
  
  console.log(`[${timestamp}] Tunnel "${tunnel.name}" (${tunnel.clientName || 'No client'}) → ${redirectUrl} [Access #${accessCount}]`);
  
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  res.redirect(302, redirectUrl);
});

// Watch for config changes
function watchConfigFile() {
  // Watch tunnels file for changes (no restart needed, loaded on each request)
  if (fs.existsSync(TUNNELS_FILE)) {
    fs.watchFile(TUNNELS_FILE, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('\nTunnels configuration updated.\n');
      }
    });
  }
}

// Start server function
function startServer() {
  ensureDataDir();
  const tunnels = getTunnels();
  const host = '0.0.0.0'; // Always listen on all interfaces for tunnel access
  
  server = app.listen(PORT, host, () => {
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    // Find the first non-internal IPv4 address
    for (const interfaceName of Object.keys(networkInterfaces)) {
      for (const iface of networkInterfaces[interfaceName]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
      if (localIP !== 'localhost') break;
    }
    
    console.log(`Main server running at http://localhost:${PORT}`);
    console.log(`Server also accessible at http://${localIP}:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin or http://${localIP}:${PORT}/admin`);
    console.log(`Tunnels configured: ${tunnels.length}`);
    console.log(`Analytics tracking: Enabled`);
    
    // Start servers for existing tunnels
    tunnels.forEach((tunnel, index) => {
      if (tunnel.port) {
        console.log(`Starting server for tunnel "${tunnel.name}" on port ${tunnel.port}`);
        const tunnelServer = createTunnelServer(index, tunnel.port, tunnel.redirectUrl || '');
        tunnelServers.set(tunnel.port, { server: tunnelServer, tunnelIndex: index });
      }
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is in use. Retrying in 2 seconds...`);
      setTimeout(() => startServer(), 2000);
    } else {
      console.error('Server error:', error);
    }
  });
}

// Start the server and watch for changes
startServer();
watchConfigFile();

