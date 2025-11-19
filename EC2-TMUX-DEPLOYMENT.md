# EC2 Deployment with TMUX - 24/7 Operation Guide

Complete guide for deploying the URL Redirect System on AWS EC2 using **tmux** to keep the server running 24/7.

## Why TMUX?

- ✅ Simple and lightweight
- ✅ Sessions persist after SSH disconnection
- ✅ Easy to monitor and manage
- ✅ No additional dependencies (PM2 not required)
- ✅ Perfect for single-server deployments

## Prerequisites

- AWS EC2 instance running Fedora Linux
- SSH access to your EC2 instance
- Cloudflare account (for tunnels)

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

### Step 5: Install TMUX

```bash
sudo dnf install -y tmux
```

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
cd url-redirect/"URL REDIRECT PRODUCTION"
```

### Step 8: Install Dependencies

```bash
npm install --production
```

### Step 9: Create Data Directory

```bash
mkdir -p data
```

### Step 10: Set Environment Variables

Create a `.env` file:

```bash
nano .env
```

Add:
```
ADMIN_PASSWORD=your-secure-password-here
SESSION_SECRET=your-random-session-secret-here
PORT=3000
NODE_ENV=production
```

Generate a secure session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Part 2: Cloudflare Tunnel Setup

### Step 11: Authenticate Cloudflared

```bash
cloudflared tunnel login
```

This will open a browser window (or give you a URL to open on your local machine).

### Step 12: Create a Tunnel (Optional - for Token-Based Tunnels)

```bash
# Create a named tunnel
cloudflared tunnel create my-tunnel

# List your tunnels
cloudflared tunnel list
```

### Step 13: Get Tunnel Token (For Token-Based Tunnels)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to: **Networks** → **Tunnels**
3. Click on your tunnel
4. Click **Configure**
5. Copy the **Tunnel Token**

## Part 3: Configure AWS Security Group

### Step 14: Open Required Ports

1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Add inbound rules:
   - **Port 3000**: Custom TCP, Source: 0.0.0.0/0 (or your IP)
   - **Port 3001-3010**: Custom TCP, Source: 0.0.0.0/0 (for additional tunnels)
   - **Port 22**: SSH (should already be open)

## Part 4: Start with TMUX

### Step 15: Create TMUX Session

```bash
# Create a new tmux session named "url-redirect"
tmux new-session -d -s url-redirect

# Attach to the session
tmux attach-session -t url-redirect
```

### Step 16: Start the Server

Inside the tmux session:

```bash
# Navigate to project directory
cd ~/url-redirect/"URL REDIRECT PRODUCTION"

# Load environment variables (if using .env file, you'll need dotenv package)
# Or set them directly:
export ADMIN_PASSWORD=your-secure-password-here
export SESSION_SECRET=your-session-secret-here
export PORT=3000
export NODE_ENV=production

# Start the server
node server.js
```

Or use npm:
```bash
npm start
```

### Step 17: Detach from TMUX

Once the server is running, detach from tmux:
- Press: `Ctrl+B`, then `D` (or `Ctrl+B D`)

The server will continue running in the background!

### Step 18: Verify Server is Running

```bash
# Check if server is running
curl http://localhost:3000/test

# Check tmux session
tmux list-sessions

# View server output (reattach to session)
tmux attach-session -t url-redirect
```

## Part 5: TMUX Management Commands

### Basic TMUX Commands

```bash
# Create a new session
tmux new-session -d -s session-name

# List all sessions
tmux list-sessions

# Attach to a session
tmux attach-session -t session-name

# Detach from session (while inside)
# Press: Ctrl+B, then D

# Kill a session
tmux kill-session -t session-name

# Rename a session
tmux rename-session -t old-name new-name
```

### Inside TMUX (Key Bindings)

- **Ctrl+B D**: Detach from session
- **Ctrl+B C**: Create new window
- **Ctrl+B N**: Next window
- **Ctrl+B P**: Previous window
- **Ctrl+B %**: Split pane vertically
- **Ctrl+B "**: Split pane horizontally
- **Ctrl+B [**: Enter scroll mode (use arrow keys, press Q to exit)

## Part 6: Auto-Start on Server Reboot

### Option A: Using systemd (Recommended)

Create a systemd service that starts tmux and runs the server:

```bash
sudo nano /etc/systemd/system/url-redirect.service
```

Add:
```ini
[Unit]
Description=URL Redirect Service (TMUX)
After=network.target

[Service]
Type=forking
User=ec2-user
WorkingDirectory=/home/ec2-user/url-redirect/URL REDIRECT PRODUCTION
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="ADMIN_PASSWORD=your-secure-password-here"
Environment="SESSION_SECRET=your-session-secret-here"
ExecStart=/usr/bin/tmux new-session -d -s url-redirect -c /home/ec2-user/url-redirect/"URL REDIRECT PRODUCTION" 'node server.js'
ExecStop=/usr/bin/tmux kill-session -t url-redirect
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

**Note**: Replace paths and username as needed.

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable url-redirect
sudo systemctl start url-redirect
```

Check status:
```bash
sudo systemctl status url-redirect
```

### Option B: Using rc.local (Alternative)

```bash
sudo nano /etc/rc.local
```

Add before `exit 0`:
```bash
# Start URL Redirect in tmux
su - ec2-user -c "tmux new-session -d -s url-redirect -c '/home/ec2-user/url-redirect/URL REDIRECT PRODUCTION' 'node server.js'"
```

Make executable:
```bash
sudo chmod +x /etc/rc.local
```

### Option C: Using Crontab @reboot

```bash
crontab -e
```

Add:
```
@reboot sleep 30 && cd /home/ec2-user/url-redirect/"URL REDIRECT PRODUCTION" && /usr/bin/tmux new-session -d -s url-redirect 'export ADMIN_PASSWORD=your-password && export SESSION_SECRET=your-secret && node server.js'
```

## Part 7: Launch Cloudflare Tunnels

### Step 19: Access Admin Panel

Get your EC2 public IP:
```bash
curl ifconfig.me
```

Access: `http://YOUR_EC2_IP:3000/admin`

Login with your password.

### Step 20: Create and Start Tunnels

1. Click **"Add Tunnel"** or **"Create New Tunnel"**
2. Fill in tunnel details:
   - **Name**: Descriptive name
   - **Tunnel Token**: (Optional) Your Cloudflare tunnel token
   - **Redirect URL**: Target URL
3. Click **"Save"**
4. Click **"Start Tunnel"** to launch the tunnel

The tunnel will run in a detached process and continue even if you disconnect from tmux!

## Part 8: Monitoring and Maintenance

### View Server Logs

```bash
# Attach to tmux session to see live logs
tmux attach-session -t url-redirect

# Or capture output to a file (modify start command)
# node server.js | tee server.log
```

### Check Server Status

```bash
# Test endpoint
curl http://localhost:3000/test

# Check if process is running
ps aux | grep "node server.js"

# Check tmux session
tmux list-sessions
```

### Restart Server

```bash
# Option 1: Restart from inside tmux
tmux attach-session -t url-redirect
# Press Ctrl+C to stop, then restart: node server.js

# Option 2: Kill and restart session
tmux kill-session -t url-redirect
tmux new-session -d -s url-redirect -c ~/url-redirect/"URL REDIRECT PRODUCTION" 'node server.js'
```

### Check Cloudflared Processes

```bash
# Check if cloudflared processes are running
ps aux | grep cloudflared

# Check tunnel status in admin panel
# Or view server logs in tmux
```

## Part 9: Troubleshooting

### Server Won't Start in TMUX

```bash
# Check if tmux session exists
tmux list-sessions

# Check for errors
tmux attach-session -t url-redirect

# Check Node.js
node --version

# Check dependencies
cd ~/url-redirect/"URL REDIRECT PRODUCTION"
npm install --production
```

### Can't Access Admin Panel

1. **Check if server is running**:
   ```bash
   tmux list-sessions
   curl http://localhost:3000/test
   ```

2. **Check firewall**:
   ```bash
   sudo firewall-cmd --list-ports
   ```

3. **Check security group** in AWS Console

4. **View server logs**:
   ```bash
   tmux attach-session -t url-redirect
   ```

### TMUX Session Died

```bash
# Check what happened
tmux list-sessions

# If session doesn't exist, recreate it
tmux new-session -d -s url-redirect -c ~/url-redirect/"URL REDIRECT PRODUCTION" 'node server.js'

# Check system logs if using systemd
sudo journalctl -u url-redirect -n 50
```

### Cloudflared Not Found

```bash
# Check if installed
which cloudflared

# Reinstall if needed
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
sudo dnf install -y ./cloudflared-linux-x86_64.rpm
```

### Tunnels Stop After Reconnect

The cloudflared processes are detached, so they should survive. However, if the Node.js server restarts, you'll need to restart tunnels from the admin panel.

**Solution**: Use the admin panel to restart tunnels after server restart, or implement auto-start (see Part 10).

## Part 10: Advanced Configuration

### Auto-Start Tunnels on Server Restart

The server doesn't automatically restart tunnels on startup. You have two options:

**Option 1**: Manually start tunnels from admin panel after server restart

**Option 2**: Create a startup script that starts tunnels via API:

```bash
nano ~/url-redirect/"URL REDIRECT PRODUCTION"/start-tunnels.sh
```

Add:
```bash
#!/bin/bash
# Wait for server to be ready
sleep 10

# Login to admin panel and start tunnels
# You'll need to implement this based on your tunnel configuration
# Or use curl with session cookies to call the API
```

### Multiple TMUX Windows

You can use multiple windows in tmux for different tasks:

```bash
# Inside tmux session
# Ctrl+B C - Create new window
# Ctrl+B N - Next window
# Ctrl+B P - Previous window

# Or from command line
tmux new-window -t url-redirect -n logs 'tail -f server.log'
```

### Logging to File

Modify the start command to log to a file:

```bash
# Inside tmux
node server.js 2>&1 | tee server.log
```

Or create a startup script:

```bash
nano ~/url-redirect/"URL REDIRECT PRODUCTION"/start-server.sh
```

Add:
```bash
#!/bin/bash
cd "$(dirname "$0")"
export ADMIN_PASSWORD=your-password
export SESSION_SECRET=your-secret
export PORT=3000
export NODE_ENV=production
node server.js 2>&1 | tee server.log
```

Make executable:
```bash
chmod +x start-server.sh
```

Then start in tmux:
```bash
tmux new-session -d -s url-redirect -c ~/url-redirect/"URL REDIRECT PRODUCTION" './start-server.sh'
```

## Part 11: Security Best Practices

### 1. Change Default Password

Set `ADMIN_PASSWORD` environment variable (already done in setup).

### 2. Use Strong Session Secret

Generate a random secret (already done in setup).

### 3. Restrict Security Group

Use your specific IP instead of `0.0.0.0/0` in AWS Security Group.

### 4. Use HTTPS (Optional)

Set up Nginx reverse proxy with Let's Encrypt (see main deployment guide).

## Quick Reference Commands

```bash
# Start server in tmux
tmux new-session -d -s url-redirect -c ~/url-redirect/"URL REDIRECT PRODUCTION" 'node server.js'

# Attach to session
tmux attach-session -t url-redirect

# Detach from session
# Press: Ctrl+B, then D

# List sessions
tmux list-sessions

# Kill session
tmux kill-session -t url-redirect

# Check server
curl http://localhost:3000/test

# View logs (inside tmux)
# Just look at the output, or use scroll mode: Ctrl+B [
```

## Comparison: TMUX vs PM2

| Feature | TMUX | PM2 |
|---------|------|-----|
| **Simplicity** | ✅ Very simple | More complex |
| **Auto-restart on crash** | ❌ Manual | ✅ Automatic |
| **Log management** | Manual | ✅ Built-in |
| **Resource monitoring** | Manual | ✅ Built-in |
| **Process management** | Basic | ✅ Advanced |
| **Dependencies** | None (built-in) | Requires npm install |

**Recommendation**: 
- Use **TMUX** if you want simplicity and don't need auto-restart
- Use **PM2** if you need automatic crash recovery and advanced monitoring

## Summary

Your URL Redirect System is now:
- ✅ Running 24/7 in tmux
- ✅ Survives SSH disconnection
- ✅ Cloudflare tunnels can be managed from admin panel
- ✅ Can be configured to auto-start on server reboot
- ✅ Simple and lightweight

**Access your admin panel**: `http://YOUR_EC2_IP:3000/admin`

**Note**: If the server crashes, you'll need to manually restart it. Consider using PM2 if you need automatic crash recovery.

