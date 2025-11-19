# URL Redirect System - EC2 Deployment

This is the production-ready version of the URL Redirect System, optimized for 24/7 operation on AWS EC2.

## Quick Start

### 1. Initial Setup

Follow the complete guide in **`EC2-24-7-DEPLOYMENT.md`** for detailed instructions.

### 2. Quick Installation

```bash
# On your EC2 instance (Fedora)
sudo dnf update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs

# Install cloudflared
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo dnf install -y ./cloudflared-linux-x86_64.rpm

# Install PM2
sudo npm install -g pm2

# Clone and setup
cd ~
git clone <your-repo-url> url-redirect
cd url-redirect/"URL REDIRECT PRODUCTION"
npm install --production
```

### 3. Start the Application

```bash
# Option 1: Use the start script
./start.sh

# Option 2: Manual start with PM2
pm2 start server.js --name url-redirect
pm2 save
pm2 startup  # Follow the command it outputs
```

### 4. Configure Cloudflare Tunnels

1. Authenticate cloudflared:
   ```bash
   cloudflared tunnel login
   ```

2. Access admin panel: `http://YOUR_EC2_IP:3000/admin`
3. Create tunnels and configure redirect URLs in the admin panel

## Key Features

- ✅ **24/7 Operation**: Runs continuously with PM2 process management
- ✅ **Auto-Restart**: Automatically restarts on server reboot
- ✅ **Cloudflare Tunnels**: Launch and manage tunnels from admin panel
- ✅ **Multiple Tunnels**: Support for multiple tunnels with automatic port assignment
- ✅ **Analytics**: Track tunnel access and redirect statistics
- ✅ **Secure**: Password-protected admin interface

## Documentation

- **`EC2-24-7-DEPLOYMENT.md`**: Complete deployment guide with all commands
- **`EC2-DEPLOYMENT-FEDORA-NO-DOCKER.md`**: Alternative guide without Docker

## Important Notes

1. **Change Default Password**: Set `ADMIN_PASSWORD` environment variable
2. **Firewall**: Ensure ports 3000+ are open in both EC2 Security Group and local firewall
3. **Cloudflared**: Must be authenticated before creating tunnels
4. **PM2**: Recommended for production - handles restarts and logging

## Common Commands

```bash
# View logs
pm2 logs url-redirect

# Restart
pm2 restart url-redirect

# Stop
pm2 stop url-redirect

# Status
pm2 status

# Monitor
pm2 monit
```

## Support

See `EC2-24-7-DEPLOYMENT.md` for troubleshooting and detailed instructions.

