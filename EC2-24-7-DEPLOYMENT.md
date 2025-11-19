# EC2 24/7 Deployment Guide - URL Redirect System with Cloudflare Tunnels

Complete guide for deploying the URL Redirect System on AWS EC2 to run 24/7 with automatic Cloudflare tunnel management.

## Overview

This guide will help you:
- Deploy the URL Redirect System on EC2 (Fedora Linux)
- Run the system 24/7 with automatic restarts
- Launch and manage Cloudflare tunnels from within EC2
- Ensure tunnels automatically restart on server reboot
- Monitor and maintain the system

## Prerequisites

- AWS EC2 instance running Fedora Linux
- SSH access to your EC2 instance
- Cloudflare account (for tunnels)
- Git repository with the code

## Part 1: Initial Setup

### Step 1: Connect to EC2 Instance

```bash
ssh -i /path/to/your-key.pem ec2-user@your-ec2-ip-address
```

### Step 2: Update System

```bash
sudo dnf update -y
```

### Step 3: Install Node.js

```bash
# Install Node.js 18+ from NodeSource
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs

# Verify installation
node --version
npm --version
```

### Step 4: Install Cloudflared

```bash
# Download and install cloudflared
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo dnf install -y ./cloudflared-linux-x86_64.rpm

# Verify installation
cloudflared --version
which cloudflared
```

### Step 5: Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

PM2 will manage both the Node.js server and ensure it runs 24/7.

### Step 6: Configure Firewall

```bash
# Allow port 3000 (and additional ports for tunnels)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=3002/tcp
sudo firewall-cmd --permanent --add-port=3003/tcp
sudo firewall-cmd --reload

# Verify
sudo firewall-cmd --list-ports
```

### Step 7: Clone Repository

```bash
cd ~
git clone <your-repository-url> url-redirect
cd url-redirect
```

If using the production folder:
```bash
cd "URL REDIRECT PRODUCTION"
```

### Step 8: Install Dependencies

```bash
npm install --production
```

### Step 9: Create Data Directory

```bash
mkdir -p data
```

## Part 2: Cloudflare Tunnel Setup

### Step 10: Authenticate Cloudflared

```bash
cloudflared tunnel login
```

This will:
1. Open a browser window (or give you a URL to open)
2. Log you into Cloudflare
3. Authorize cloudflared to create tunnels

**Note**: If you're on a headless server, copy the URL and open it on your local machine.

### Step 11: Create a Tunnel (Optional - for Token-Based Tunnels)

If you want to use token-based tunnels (recommended for persistence):

```bash
# Create a named tunnel
cloudflared tunnel create my-tunnel

# List your tunnels
cloudflared tunnel list
```

### Step 12: Get Tunnel Token (For Token-Based Tunnels)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to: **Networks** → **Tunnels**
3. Click on your tunnel
4. Click **Configure**
5. Copy the **Tunnel Token**

You'll use this token in the admin panel later.

## Part 3: Configure AWS Security Group

### Step 13: Open Required Ports in EC2 Security Group

1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Add inbound rules:
   - **Port 3000**: Custom TCP, Source: 0.0.0.0/0 (or your IP)
   - **Port 3001-3010**: Custom TCP, Source: 0.0.0.0/0 (for additional tunnels)
   - **Port 22**: SSH (should already be open)

## Part 4: Start the Application

### Step 14: Set Environment Variables

Create a startup script or set environment variables:

```bash
# Create environment file
nano ~/url-redirect/.env
```

Add:
```
ADMIN_PASSWORD=your-secure-password-here
SESSION_SECRET=your-random-session-secret-here
PORT=3000
NODE_ENV=production
AUTO_START_TUNNELS=false
```

**Note**: Set `AUTO_START_TUNNELS=true` if you want tunnels to auto-start on server restart (see Part 6).

### Step 15: Start with PM2

```bash
cd ~/url-redirect

# Start the application
pm2 start server.js --name url-redirect --env production

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

Follow the command it outputs (usually):
```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
```

### Step 16: Verify Application is Running

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs url-redirect

# Test the endpoint
curl http://localhost:3000/test
```

### Step 17: Access Admin Panel

Get your EC2 public IP:
```bash
curl ifconfig.me
```

Access:
- **Admin Panel**: `http://YOUR_EC2_IP:3000/admin`
- **Login**: Use the password you set in `.env` (or default: `admin123`)

## Part 5: Launch Cloudflare Tunnels from Admin Panel

### Step 18: Create a Tunnel in Admin Panel

1. Access the admin panel: `http://YOUR_EC2_IP:3000/admin`
2. Login with your password
3. Click **"Add Tunnel"** or **"Create New Tunnel"**
4. Fill in:
   - **Name**: A descriptive name (e.g., "Main Redirect")
   - **Tunnel Token**: (Optional) Paste your Cloudflare tunnel token for persistent URLs
   - **Redirect URL**: The URL you want to redirect to (e.g., `https://example.com`)
   - **Client Name**: (Optional) For tracking
   - **Notes**: (Optional) Any notes

5. Click **"Save"** or **"Create"**

### Step 19: Start the Tunnel

1. In the admin panel, find your tunnel in the list
2. Click **"Start Tunnel"**
3. Wait a few seconds for the tunnel to initialize
4. The tunnel URL will appear (e.g., `https://xxxxx.trycloudflare.com`)

**Note**: 
- If using a token, the URL will be persistent
- If not using a token, it's a quick tunnel (URL changes on restart)

### Step 20: Configure Redirect URL

1. In the admin panel, find your tunnel
2. Update the **Redirect URL** field
3. Click **"Update"** or **"Save"**

The redirect will work immediately - no restart needed!

## Part 6: Auto-Start Tunnels on Server Restart

### Option A: Using Environment Variable (Recommended)

The server can auto-start tunnels if configured. Edit the server startup:

```bash
# Edit PM2 ecosystem or use environment variable
pm2 delete url-redirect
pm2 start server.js --name url-redirect --env production --update-env
```

Then in the admin panel, you can configure which tunnels should auto-start.

### Option B: Manual Auto-Start Script

Create a script to auto-start tunnels:

```bash
nano ~/url-redirect/start-tunnels.sh
```

Add:
```bash
#!/bin/bash
cd ~/url-redirect
source .env

# Wait for server to be ready
sleep 5

# Use curl to start tunnels via API
# You'll need to implement this based on your tunnel configuration
# Or use the admin panel to start tunnels after server starts
```

Make executable:
```bash
chmod +x ~/url-redirect/start-tunnels.sh
```

### Option C: Use Admin Panel After Restart

Simply log into the admin panel after server restart and click "Start Tunnel" for each tunnel you want running.

## Part 7: Monitoring and Maintenance

### View Application Logs

```bash
# PM2 logs
pm2 logs url-redirect

# Last 100 lines
pm2 logs url-redirect --lines 100

# Follow logs in real-time
pm2 logs url-redirect --follow
```

### Check Application Status

```bash
# PM2 status
pm2 status

# Detailed info
pm2 info url-redirect

# Monitor resources
pm2 monit
```

### Check Cloudflared Processes

```bash
# Check if cloudflared is running
ps aux | grep cloudflared

# Check tunnel processes
pm2 logs url-redirect | grep TUNNEL
```

### Restart Application

```bash
# Restart the application
pm2 restart url-redirect

# Restart and update environment
pm2 restart url-redirect --update-env
```

### Stop Application

```bash
# Stop the application
pm2 stop url-redirect

# Stop and remove from PM2
pm2 delete url-redirect
```

## Part 8: Troubleshooting

### Application Won't Start

```bash
# Check Node.js
node --version

# Check dependencies
cd ~/url-redirect
npm install --production

# Check logs
pm2 logs url-redirect --err

# Check if port is in use
sudo netstat -tlnp | grep 3000
```

### Cloudflared Not Found

```bash
# Check if installed
which cloudflared

# Check PATH
echo $PATH

# Reinstall if needed
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo dnf install -y ./cloudflared-linux-x86_64.rpm
```

### Tunnel Won't Start

1. **Check Cloudflared Authentication**:
   ```bash
   cloudflared tunnel list
   ```
   If this fails, re-authenticate:
   ```bash
   cloudflared tunnel login
   ```

2. **Check Tunnel Token** (if using token-based):
   - Verify token is correct in admin panel
   - Check token hasn't expired in Cloudflare Dashboard

3. **Check Logs**:
   ```bash
   pm2 logs url-redirect | grep -i tunnel
   ```

4. **Test Cloudflared Manually**:
   ```bash
   # Test quick tunnel
   cloudflared tunnel --url http://localhost:3000
   ```

### Can't Access Admin Panel

1. **Check Firewall**:
   ```bash
   sudo firewall-cmd --list-ports
   ```

2. **Check Security Group**: Ensure port 3000 is open in AWS Console

3. **Check Application is Running**:
   ```bash
   pm2 status
   curl http://localhost:3000/test
   ```

4. **Check Application Logs**:
   ```bash
   pm2 logs url-redirect
   ```

### Tunnels Stop After Reboot

1. **Check PM2 Startup**:
   ```bash
   pm2 startup
   # Follow the command it outputs
   ```

2. **Check PM2 Save**:
   ```bash
   pm2 save
   ```

3. **Manually Start Tunnels**: After reboot, log into admin panel and start tunnels

### Port Already in Use

```bash
# Find what's using the port
sudo lsof -i :3000

# Kill the process if needed
sudo kill -9 <PID>

# Or change the port in .env
```

## Part 9: Updating the Application

### Update Code

```bash
cd ~/url-redirect
git pull
npm install --production
pm2 restart url-redirect
```

### Update Dependencies

```bash
cd ~/url-redirect
npm update
pm2 restart url-redirect
```

## Part 10: Backup and Recovery

### Backup Configuration

```bash
# Create backup directory
mkdir -p ~/backups

# Backup data directory
tar -czf ~/backups/url-redirect-$(date +%Y%m%d).tar.gz ~/url-redirect/data

# Backup entire project (optional)
tar -czf ~/backups/url-redirect-full-$(date +%Y%m%d).tar.gz ~/url-redirect --exclude=node_modules
```

### Restore from Backup

```bash
# Extract backup
cd ~
tar -xzf ~/backups/url-redirect-YYYYMMDD.tar.gz

# Restart application
pm2 restart url-redirect
```

## Part 11: Security Best Practices

### 1. Change Default Password

Set a strong password in `.env`:
```
ADMIN_PASSWORD=your-very-secure-password-here
```

### 2. Use Strong Session Secret

Generate a random session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:
```
SESSION_SECRET=your-generated-secret-here
```

### 3. Restrict Security Group

Instead of `0.0.0.0/0`, use your specific IP address in the security group.

### 4. Use HTTPS (Optional but Recommended)

Set up Nginx reverse proxy with Let's Encrypt:

```bash
# Install Nginx and Certbot
sudo dnf install -y nginx certbot python3-certbot-nginx

# Configure Nginx
sudo nano /etc/nginx/conf.d/url-redirect.conf
```

Add:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Test and start Nginx
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

### 5. Regular Updates

```bash
# Update system
sudo dnf update -y

# Update Node.js (if needed)
# Check current version
node --version

# Update npm
sudo npm install -g npm@latest
```

## Part 12: Advanced Configuration

### Multiple Tunnels on Different Ports

The system automatically assigns ports starting from 3000. Each tunnel gets its own port:
- Tunnel 1: Port 3000
- Tunnel 2: Port 3001
- Tunnel 3: Port 3002
- etc.

Make sure these ports are open in:
1. Firewall: `sudo firewall-cmd --permanent --add-port=300X/tcp`
2. EC2 Security Group

### Custom Cloudflared Configuration

If you need custom cloudflared configuration, you can create a config file:

```bash
nano ~/.cloudflared/config.yml
```

Example:
```yaml
tunnel: your-tunnel-id
credentials-file: /home/ec2-user/.cloudflared/your-tunnel-id.json

ingress:
  - hostname: your-domain.com
    service: http://localhost:3000
  - service: http_status:404
```

### Environment Variables Reference

Create `~/url-redirect/.env`:
```
# Server Configuration
PORT=3000
NODE_ENV=production

# Security
ADMIN_PASSWORD=your-secure-password
SESSION_SECRET=your-session-secret

# Optional: Auto-start tunnels on server start
AUTO_START_TUNNELS=false

# Optional: Default tunnel token (used for new tunnels)
DEFAULT_TUNNEL_TOKEN=your-default-token-here
```

## Part 13: Monitoring and Alerts

### Health Check Endpoint

The application provides a health check:
```bash
curl http://localhost:3000/test
```

### Set Up Monitoring (Optional)

You can use PM2's monitoring or set up external monitoring:

```bash
# PM2 monitoring
pm2 monit

# Or use PM2 Plus (cloud monitoring)
pm2 link <secret-key> <public-key>
```

### Log Rotation

PM2 handles log rotation automatically, but you can configure it:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## Quick Reference Commands

```bash
# Start application
pm2 start server.js --name url-redirect

# Stop application
pm2 stop url-redirect

# Restart application
pm2 restart url-redirect

# View logs
pm2 logs url-redirect

# Check status
pm2 status

# Monitor resources
pm2 monit

# Save PM2 configuration
pm2 save

# Check cloudflared
cloudflared --version
cloudflared tunnel list

# Test endpoint
curl http://localhost:3000/test

# View firewall rules
sudo firewall-cmd --list-ports
```

## Support and Troubleshooting

If you encounter issues:

1. **Check Logs**: `pm2 logs url-redirect`
2. **Check Status**: `pm2 status`
3. **Verify Cloudflared**: `cloudflared --version`
4. **Test Endpoints**: `curl http://localhost:3000/test`
5. **Check Firewall**: `sudo firewall-cmd --list-ports`
6. **Check Security Group**: AWS Console → EC2 → Security Groups

## Summary

Your URL Redirect System is now:
- ✅ Running 24/7 on EC2
- ✅ Automatically restarts on server reboot (via PM2)
- ✅ Cloudflare tunnels can be managed from admin panel
- ✅ Multiple tunnels supported with automatic port assignment
- ✅ Analytics and monitoring available
- ✅ Secure with password protection

Access your admin panel at: `http://YOUR_EC2_IP:3000/admin`

