# URL Redirect System

A URL redirect system with web-based admin panel and Cloudflare tunnel support. Deployable via Docker to EC2 or any container platform.

## Features

- **Server-side redirect**: Express server that redirects requests based on Cloudflare tunnel configuration
- **Multiple tunnels**: Support for multiple Cloudflare tunnels, each with its own redirect URL
- **Admin panel**: Web-based admin interface for managing tunnels and redirect URLs
- **Secure**: Password-protected admin interface
- **Analytics**: Track tunnel access and redirect statistics
- **Docker Support**: Ready for containerized deployment
- **EC2 Ready**: Full deployment guide for AWS EC2 on Fedora Linux

## Quick Start

### Option 1: Docker (Recommended for Production)

```bash
# Using Docker Compose
docker-compose up -d

# Or using Docker directly
docker build -t url-redirect .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name url-redirect url-redirect
```

Access:
- Redirect: http://localhost:3000 or http://YOUR_IP:3000
- Admin Panel: http://localhost:3000/admin or http://YOUR_IP:3000/admin (password: `admin123`)
- Replace `YOUR_IP` with your machine's IP address

### Option 2: Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

## Deployment

### EC2 Deployment on Fedora Linux

See [EC2-DEPLOYMENT-FEDORA.md](./EC2-DEPLOYMENT-FEDORA.md) for complete EC2 deployment guide with exact commands for Fedora Linux.

Quick steps:
1. Clone repository on EC2
2. Install Docker and Docker Compose
3. Install Cloudflared (for tunnel support)
4. Run `docker-compose up -d`
5. Configure security group to allow port 3000

## Admin Panel

Access the admin panel at: `http://localhost:3000/admin` (or your server URL)

- **Default Password**: `admin123` (change in production!)
- **Features**:
  - Create and manage multiple Cloudflare tunnels
  - Configure redirect URLs for each tunnel
  - Start/stop tunnel processes
  - View tunnel analytics and access statistics
  - Manage tunnel tokens for persistent URLs
  - Secure password authentication

**Note**: Change the default password in production by setting the `ADMIN_PASSWORD` environment variable in `docker-compose.yml`.

## Configuration

Configuration is stored in the `data/` directory (or project root if data directory doesn't exist):

- `tunnels.json` - Tunnel configurations (managed via admin panel)
- `analytics.json` - Access statistics (auto-generated)

Each tunnel can have:
- `name` - Tunnel name
- `url` - Cloudflare tunnel URL
- `redirectUrl` - Target URL to redirect to
- `tunnelToken` - Cloudflare tunnel token (for persistent URLs)
- `port` - Local port for the tunnel server

## How It Works

1. The Express server (`server.js`) listens on port 3000
2. Multiple tunnel servers can run on different ports (3000, 3001, etc.)
3. Cloudflare tunnels forward traffic to these local servers
4. The server matches incoming requests to the correct tunnel based on headers
5. Each tunnel redirects to its configured redirect URL
6. The web admin panel allows you to manage tunnels and redirect URLs

## Files

- `server.js` - Express server with redirect and tunnel management functionality
- `admin-panel-web.html` - Web-based admin interface
- `login.html` - Login page for admin panel
- `redirect.html` - Redirect page template (optional)
- `Dockerfile` - Docker container configuration
- `docker-compose.yml` - Docker Compose configuration
- `EC2-DEPLOYMENT-FEDORA.md` - EC2 deployment guide for Fedora Linux
- `package.json` - Node.js dependencies and scripts

