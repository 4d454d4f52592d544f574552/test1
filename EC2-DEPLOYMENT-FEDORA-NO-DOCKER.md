# EC2 Deployment Guide for Fedora Linux (Without Docker)

This guide provides step-by-step instructions to deploy the URL Redirect System on an AWS EC2 instance running Fedora Linux **without using Docker**.

## Prerequisites

- AWS EC2 instance running Fedora Linux
- SSH access to your EC2 instance
- Git installed (or ability to upload files)

## Step 1: Connect to Your EC2 Instance

```bash
ssh -i /path/to/your-key.pem ec2-user@your-ec2-ip-address
```

Or if using a different user:
```bash
ssh -i /path/to/your-key.pem fedora@your-ec2-ip-address
```

## Step 2: Update System Packages

```bash
sudo dnf update -y
```

## Step 3: Install Node.js

### Install Node.js 18 (LTS)

```bash
sudo dnf install -y nodejs npm
```

### Verify Node.js Installation

```bash
node --version
npm --version
```

**Note**: If the default version is too old, you can install Node.js 18+ using NodeSource:

```bash
# Install NodeSource repository
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -

# Install Node.js
sudo dnf install -y nodejs

# Verify
node --version
npm --version
```

## Step 4: Install Cloudflared

### Download Cloudflared

```bash
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
```

### Install Cloudflared

```bash
sudo dnf install -y ./cloudflared-linux-x86_64.rpm
```

### Verify Cloudflared Installation

```bash
cloudflared --version
```

### Make Cloudflared Available in PATH (if needed)

```bash
which cloudflared
```

If not found, you may need to add it to PATH or create a symlink:
```bash
sudo ln -s /usr/local/bin/cloudflared /usr/bin/cloudflared
```

## Step 5: Configure Firewall

### Check Firewall Status

```bash
sudo firewall-cmd --state
```

### Allow Port 3000 (if firewall is active)

```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### Verify Port is Open

```bash
sudo firewall-cmd --list-ports
```

## Step 6: Clone the Repository

### Navigate to Home Directory

```bash
cd ~
```

### Clone Your Repository

```bash
git clone <your-repository-url> url-redirect
```

Replace `<your-repository-url>` with your actual Git repository URL.

### Navigate to Project Directory

```bash
cd url-redirect
```

Or if you're using the production folder:
```bash
cd "URL REDIRECT PRODUCTION"
```

## Step 7: Install Node.js Dependencies

```bash
npm install --production
```

This will install:
- express
- express-session

## Step 8: Create Data Directory (Optional)

The application will automatically use the project root if no `data` directory exists, but it's recommended to create one for organization:

```bash
mkdir -p data
```

## Step 9: Configure AWS Security Group

**Important**: Before starting the server, configure your EC2 security group in AWS Console:

1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Add inbound rule:
   - Type: Custom TCP
   - Port: 3000
   - Source: 0.0.0.0/0 (or your specific IP for better security)
   - Description: URL Redirect Server

## Step 10: Start the Application

### Option A: Run Directly (Foreground - for testing)

```bash
npm start
```

Or:
```bash
node server.js
```

### Option B: Run in Background

```bash
nohup npm start > server.log 2>&1 &
```

Or:
```bash
nohup node server.js > server.log 2>&1 &
```

### Option C: Use PM2 (Recommended for Production)

#### Install PM2

```bash
sudo npm install -g pm2
```

#### Start Application with PM2

```bash
pm2 start server.js --name url-redirect
```

#### Save PM2 Configuration

```bash
pm2 save
```

#### Setup PM2 to Start on Boot

```bash
pm2 startup
```

Follow the command it outputs (usually something like):
```bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ec2-user --hp /home/ec2-user
```

### Verify Application is Running

```bash
# Check if process is running
ps aux | grep node

# Or with PM2
pm2 status

# Test the endpoint
curl http://localhost:3000/test
```

## Step 11: Access the Application

### Get Your EC2 Public IP

```bash
curl ifconfig.me
```

Or check in AWS Console: EC2 → Instances → Your Instance → Public IPv4 address

### Access URLs

- **Redirect Service**: `http://YOUR_EC2_IP:3000`
- **Admin Panel**: `http://YOUR_EC2_IP:3000/admin`
- **Login Page**: `http://YOUR_EC2_IP:3000/login`
- **Health Check**: `http://YOUR_EC2_IP:3000/test`

**Default Admin Password**: `admin123`

**Important**: Change the default password in production by setting the `ADMIN_PASSWORD` environment variable.

## Step 12: Configure Environment Variables (Optional)

### Set Admin Password

Create a `.env` file (you'll need to install dotenv package first, or set environment variables directly):

```bash
export ADMIN_PASSWORD=your-secure-password-here
export SESSION_SECRET=your-session-secret-here
export PORT=3000
```

### Or Create a Startup Script

Create a file `start.sh`:

```bash
#!/bin/bash
export ADMIN_PASSWORD=your-secure-password-here
export SESSION_SECRET=your-session-secret-here
export PORT=3000
node server.js
```

Make it executable:
```bash
chmod +x start.sh
```

Then run:
```bash
./start.sh
```

Or with PM2:
```bash
pm2 start start.sh --name url-redirect
```

## Step 13: Configure Auto-Start with Systemd (Recommended)

### Create Systemd Service File

```bash
sudo nano /etc/systemd/system/url-redirect.service
```

Add the following content (adjust paths as needed):

```ini
[Unit]
Description=URL Redirect Service
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/url-redirect
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="ADMIN_PASSWORD=your-secure-password-here"
Environment="SESSION_SECRET=your-session-secret-here"
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Note**: 
- Replace `/home/ec2-user/url-redirect` with your actual project path
- Replace `ec2-user` with your actual username
- Update the environment variables with your values

### Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable url-redirect
sudo systemctl start url-redirect
```

### Check Service Status

```bash
sudo systemctl status url-redirect
```

### View Service Logs

```bash
sudo journalctl -u url-redirect -f
```

## Step 14: Configure Cloudflared Tunnels (Optional)

If you want to use Cloudflare tunnels, you need to authenticate:

### Login to Cloudflare

```bash
cloudflared tunnel login
```

This will open a browser window. If you're on a headless server, you can copy the URL and open it on your local machine.

### Create a Tunnel (Optional)

```bash
cloudflared tunnel create my-tunnel
```

### Get Tunnel Token

For token-based tunnels, get the token from Cloudflare Dashboard:
1. Go to Cloudflare Dashboard → Networks → Tunnels
2. Create or select a tunnel
3. Copy the token

Then configure it in the admin panel at `http://YOUR_EC2_IP:3000/admin`

## Common Commands

### Stop the Application

**If running directly:**
```bash
# Find the process
ps aux | grep node

# Kill the process
kill <PID>
```

**If using PM2:**
```bash
pm2 stop url-redirect
```

**If using systemd:**
```bash
sudo systemctl stop url-redirect
```

### Start the Application

**If using PM2:**
```bash
pm2 start url-redirect
```

**If using systemd:**
```bash
sudo systemctl start url-redirect
```

### Restart the Application

**If using PM2:**
```bash
pm2 restart url-redirect
```

**If using systemd:**
```bash
sudo systemctl restart url-redirect
```

### View Logs

**If running with nohup:**
```bash
tail -f server.log
```

**If using PM2:**
```bash
pm2 logs url-redirect
```

**If using systemd:**
```bash
sudo journalctl -u url-redirect -f
```

### Check Application Status

```bash
# Test endpoint
curl http://localhost:3000/test

# Check process
ps aux | grep node

# Or with PM2
pm2 status

# Or with systemd
sudo systemctl status url-redirect
```

## Troubleshooting

### Application Won't Start

```bash
# Check Node.js is installed
node --version

# Check dependencies are installed
ls node_modules/

# If missing, install them
npm install --production

# Check for port conflicts
sudo netstat -tlnp | grep 3000

# Check logs
tail -f server.log
# Or
pm2 logs url-redirect
# Or
sudo journalctl -u url-redirect -n 50
```

### Permission Denied Errors

```bash
# Check file permissions
ls -la server.js

# Make sure you have read permissions
chmod 644 server.js

# Check directory permissions
ls -la
```

### Port Already in Use

```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process if needed
sudo kill -9 <PID>
```

### Firewall Blocking Access

```bash
# Check firewall status
sudo firewall-cmd --state

# If active, ensure port 3000 is open
sudo firewall-cmd --list-ports

# If not listed, add it
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### Can't Access from Internet

1. Check EC2 Security Group allows port 3000
2. Check firewall on EC2 instance
3. Verify application is running: `ps aux | grep node`
4. Test locally on server: `curl http://localhost:3000/test`

### Cloudflared Not Found

```bash
# Check if cloudflared is installed
which cloudflared

# If not found, reinstall
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo dnf install -y ./cloudflared-linux-x86_64.rpm

# Verify
cloudflared --version
```

### Update Application

```bash
# Pull latest changes
cd ~/url-redirect
git pull

# Install any new dependencies
npm install --production

# Restart application
# If using PM2:
pm2 restart url-redirect

# If using systemd:
sudo systemctl restart url-redirect

# If running directly:
# Stop and restart manually
```

## Security Recommendations

### 1. Change Default Password

Set the `ADMIN_PASSWORD` environment variable:
```bash
export ADMIN_PASSWORD=your-secure-password-here
```

Or in systemd service file or PM2 ecosystem file.

### 2. Use HTTPS (Optional)

Set up Nginx reverse proxy with Let's Encrypt SSL:

```bash
# Install Nginx
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

### 3. Restrict Security Group

Instead of `0.0.0.0/0`, use your specific IP address in the security group.

### 4. Regular Updates

```bash
# Update system
sudo dnf update -y

# Update Node.js (if needed)
# Check for updates
node --version

# Update npm
sudo npm install -g npm@latest
```

## Backup

### Backup Configuration Files

```bash
# Create backup directory
mkdir -p ~/backups

# Backup data directory (if exists) or project root JSON files
tar -czf ~/backups/url-redirect-backup-$(date +%Y%m%d).tar.gz ~/url-redirect/data ~/url-redirect/*.json 2>/dev/null
```

## Monitoring

### Check Application Health

```bash
curl http://localhost:3000/test
```

### View Recent Logs

**With PM2:**
```bash
pm2 logs url-redirect --lines 50
```

**With systemd:**
```bash
sudo journalctl -u url-redirect -n 50
```

**Direct logs:**
```bash
tail -n 50 server.log
```

### Monitor Resource Usage

```bash
# Check Node.js process
ps aux | grep node

# Monitor with top
top -p $(pgrep -f "node server.js")

# Or with PM2
pm2 monit
```

## Differences from Docker Version

1. **No container isolation** - Application runs directly on the host
2. **Direct process management** - Use PM2 or systemd instead of Docker
3. **System-wide Node.js** - Node.js installed on the system, not in container
4. **Direct file access** - Files are in the project directory, not in a volume
5. **Easier debugging** - Direct access to logs and processes
6. **Lower overhead** - No Docker daemon running

## Support

For issues:
1. Check application logs (see View Logs section)
2. Verify configuration files exist
3. Test endpoints: `/test`, `/check`, `/admin`
4. Check Node.js and system status

