# EC2 Deployment with TMUX - Quick Start Guide

Complete step-by-step guide to deploy the URL Redirect System on AWS EC2 using tmux.

## Prerequisites

- AWS EC2 instance running Fedora Linux
- SSH access to your EC2 instance
- Cloudflare account (for tunnels)

---

## Step 1: Connect to EC2 Instance

**Summary**: Establish SSH connection to your EC2 instance.

```bash
ssh -i /path/to/your-key.pem Ladmin@your-ec2-ip-address
```

---

## Step 2: Update System and Install Dependencies

**Summary**: Update all system packages to ensure latest security patches and dependencies.

```bash
sudo dnf update -y
```

---

## Step 3: Install Node.js

**Summary**: Install Node.js 18+ runtime and npm package manager required to run the application.

```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs
node --version
npm --version
```

---

## Step 4: Install Cloudflared

**Summary**: Download and install Cloudflared binary for creating Cloudflare tunnels.

```bash
cd /tmp
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64
chmod +x cloudflared-linux-x86_64
sudo mv cloudflared-linux-x86_64 /usr/local/bin/cloudflared
cloudflared --version
```

---

## Step 5: Install TMUX

**Summary**: Install tmux terminal multiplexer to keep server running after SSH disconnection.

```bash
sudo dnf install -y tmux
```

---

## Step 6: Install Git

**Summary**: Install Git version control to clone the repository from GitHub.

```bash
sudo dnf install -y git
```

---

## Step 7: Configure Firewall

**Summary**: Install and configure firewalld to allow incoming connections on ports 3000-3003 for the server and tunnels.

```bash
sudo dnf install -y firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=3002/tcp
sudo firewall-cmd --permanent --add-port=3003/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

---

## Step 8: Clone Repository

**Summary**: Download the application code from GitHub repository to the server.

```bash
cd ~
rm -rf url-redirect
git clone https://github.com/4d454d4f52592d544f574552/test1.git url-redirect
cd url-redirect
```

**If directory doesn't exist, check and fix:**

```bash
# Check current location
pwd

# Check what's in home directory
ls -la ~

# Check if url-redirect exists
ls -la ~/url-redirect

# If url-redirect exists, check its contents
ls -la ~/url-redirect/

# If URL-REDIRECT-PRODUCTION doesn't exist, check what directories are there
find ~/url-redirect -type d -name "*REDIRECT*"

# Re-clone if needed
cd ~
rm -rf url-redirect
git clone https://github.com/4d454d4f52592d544f574552/test1.git url-redirect
ls -la url-redirect/
cd url-redirect
```

---

## Step 9: Install Dependencies

**Summary**: Install all Node.js package dependencies required by the application.

```bash
npm install --production
```

---

## Step 10: Create Data Directory

**Summary**: Create directory to store application data files (tunnels.json, analytics.json).

```bash
mkdir -p data
```

---

## Step 11: Generate Session Secret

**Summary**: Generate a cryptographically secure random string to use as session secret for authentication.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
2dc5702c9cd35189d9fa249f9182a9c51eb01ba5d585e9a9150e40d30c6effa6

**Note**: You can use the generated value or use "adminL" as specified.

---

## Step 12: Create Environment File

**Summary**: Create .env file with configuration variables including admin password and session secret.

```bash
nano .env
```

Add the following:

```
ADMIN_PASSWORD=12345
SESSION_SECRET=adminL
PORT=3000
NODE_ENV=production
```

Press `Ctrl+X`, then `Y`, then `Enter` to save.

---

## Step 13: Configure AWS Security Group

**Summary**: Configure EC2 security group in AWS Console to allow inbound traffic on required ports.

1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Add inbound rules:
   - **Port 3000**: Custom TCP, Source: 0.0.0.0/0
   - **Port 3001-3010**: Custom TCP, Source: 0.0.0.0/0 (for tunnels)
   - **Port 22**: SSH (should already be open)

---

## Step 14: Authenticate Cloudflared

**Summary**: Authenticate cloudflared with your Cloudflare account to enable tunnel creation.

```bash
cloudflared tunnel login
```

This will give you a URL to open in your browser. Complete the authentication.

---

## Step 15: Start Server in TMUX

**Summary**: Start the Node.js server in a tmux session on the EC2 instance so it continues running after SSH disconnection.

**Verify you're on the EC2 instance, then run:**

```bash
# Navigate to project directory
cd ~/url-redirect

# Load environment variables from .env file
export $(grep -v '^#' .env | xargs)

# Kill any existing session (optional, if restarting)
tmux kill-session -t url-redirect2 2>/dev/null

# Create new tmux session in detached mode
tmux new-session -d -s url-redirect2

# Send commands to start the server inside tmux
tmux send-keys -t url-redirect2 "cd ~/url-redirect && export \$(grep -v '^#' .env | xargs) && node server.js" Enter

# Wait a moment for server to start
sleep 3

# Verify server started (should work from EC2)
curl http://localhost:3000/test
```

**Expected output**: You should see a response from the server, confirming it's running on EC2.

**To view server logs:**
```bash
tmux attach-session -t url-redirect2
# Press Ctrl+B then D to detach
```

---

## Step 16: Verify Server is Running on EC2

**Summary**: Verify that the server is running successfully on the EC2 instance.

**All these commands should be run ON THE EC2 INSTANCE:**

**Step 1: Check if tmux session exists:**
```bash
tmux list-sessions
```
Should show: `url-redirect2: 1 windows`

**Step 2: Check if server process is running:**
```bash
ps aux | grep "node server.js"
```
Should show the node process running.

**Step 3: Check if port 3000 is listening:**
```bash
sudo netstat -tlnp | grep 3000
```
Should show: `tcp 0 0 0.0.0.0:3000` (listening on all interfaces)

**Step 4: Test server locally on EC2:**
```bash
curl http://localhost:3000/test
```
**If this works, your server IS running on EC2!**

**Step 5: Check server logs:**
```bash
tmux attach-session -t url-redirect2
```
- Look for: "Main server running at http://localhost:3000"
- Press `Ctrl+B` then `D` to detach from tmux
- If you see errors, fix them and restart

**Step 6: Verify firewall allows port 3000:**
```bash
sudo firewall-cmd --list-ports
```
Should show: `3000/tcp`

**Step 7: Get your public IP (to access from outside):**
```bash
curl ifconfig.me
```
Copy this IP - you'll use it to access from your local computer.

**The server is now running on EC2!** To access it from your local computer, use the public IP in your browser: `http://YOUR_PUBLIC_IP:3000/admin`

---

## Step 17: Access Admin Panel

**Summary**: Get your EC2 public IP address and access the web-based admin panel.

**IMPORTANT**: You must use the **PUBLIC IP**, not the private IP (172.31.x.x). The private IP only works from within AWS network.

**Get your EC2 public IP (choose one method):**

**Method 1: From EC2 instance (recommended):**
```bash
curl ifconfig.me
```

**Method 2: From AWS Console:**
1. Go to AWS Console → EC2 → Instances
2. Select your instance
3. Copy the **Public IPv4 address** (NOT the Private IPv4 address)

**Method 3: From EC2 instance metadata:**
```bash
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

**Access the admin panel:**
Open in your browser: `http://YOUR_PUBLIC_IP:3000/admin`

**Example**: If your public IP is `54.123.45.67`, use: `http://54.123.45.67:3000/admin`

Login with password: **12345**

**Note**: If you see `172.31.x.x` (private IP), that won't work from your local machine. You MUST use the public IP.

---

## Step 18: Create and Start Tunnels

**Summary**: Use the admin panel to create and start Cloudflare tunnels for URL redirection.

**Creating a New Tunnel:**

1. In the admin panel, click **"Add Tunnel"** or fill out the form
2. Fill in:
   - **Tunnel Name**: Any descriptive name (e.g., "Tunnel 1", "Client A")
   - **Cloudflare Tunnel Token**: Get a token from Cloudflare Dashboard → Networks → Tunnels → Create Tunnel → Copy Token
   - **Redirect URL**: Target URL to redirect to (e.g., https://youtube.com)
   - **Tunnel URL**: Leave blank (will auto-create)
3. Click **"Add Tunnel"** or **"Create & Start"**
4. **Note**: Port is automatically assigned (3000, 3001, 3002, etc.) - check the tunnel info to see which port

**Starting a Tunnel:**

1. Find your tunnel in the list
2. Click **"Start"** button
3. Wait 10-15 seconds for tunnel to connect
4. Check the port number displayed (e.g., Port: 3001)

**Configuring Cloudflare Route (CRITICAL):**

1. Go to Cloudflare Dashboard → Networks → Tunnels
2. Find your tunnel (the one matching your token)
3. Click **"Configure"**
4. Click **"Add Public Hostname"** or **"Add a published application route"**
5. Fill in:
   - **Subdomain**: Your desired subdomain (e.g., `cnt-0000-test`)
   - **Domain**: Your domain (e.g., `stratus-labs.org`)
   - **Service Type**: **HTTP** (NOT HTTPS - this is critical!)
   - **Service URL**: `http://localhost:PORT` (use the port from step 4, e.g., `http://localhost:3001`)
6. Click **"Save"**

**Important Notes:**
- ⚠️ **Service Type MUST be HTTP** (not HTTPS) - otherwise you'll get "tls: first record does not look like a TLS handshake" error
- ⚠️ **Service URL MUST be localhost** (not public IP like 54.206.76.17)
- ⚠️ Cloudflare may show "service URL is not valid" - **IGNORE THIS** if tunnel is running
- The tunnel will retry connecting until the route is configured correctly

**Checking Tunnel Status:**

On EC2, check if tunnel is running:
```bash
# List all tmux sessions (tunnels run in sessions like tunnel-0, tunnel-1, etc.)
tmux list-sessions

# View a specific tunnel's logs
tmux attach-session -t tunnel-1
# Press Ctrl+B then D to detach
```

**If Tunnel Shows "Retrying connection":**
- This is normal if the route isn't configured in Cloudflare Dashboard yet
- Configure the route as described above
- The tunnel will connect once the route is properly configured

---

## Useful Commands

### View Server Logs
**Summary**: Attach to tmux session to view real-time server logs and output.

```bash
tmux attach-session -t url-redirect2
```
Press `Ctrl+B` then `D` to detach.

### Check Server Status
**Summary**: Verify server is running and responding to requests.

```bash
curl http://localhost:3000/test
tmux list-sessions
```

### Restart Server
**Summary**: Stop and restart the server in tmux session.

```bash
tmux kill-session -t url-redirect2
cd ~/url-redirect
export $(grep -v '^#' .env | xargs)
tmux new-session -d -s url-redirect2
tmux send-keys -t url-redirect2 "cd ~/url-redirect && export \$(grep -v '^#' .env | xargs) && node server.js" Enter
```

### Stop Server
**Summary**: Stop the server by killing the tmux session.

```bash
tmux kill-session -t url-redirect2
```

---

## Auto-Start on Reboot (Optional)

**Summary**: Configure systemd service to automatically start the server when EC2 instance reboots.

Create a systemd service:

```bash
sudo nano /etc/systemd/system/url-redirect.service
```

Paste this (replace `Ladmin` with your actual EC2 username if different):

```ini
[Unit]
Description=URL Redirect Service
After=network.target

[Service]
Type=simple
User=Ladmin
WorkingDirectory=/home/Ladmin/url-redirect
EnvironmentFile=/home/Ladmin/url-redirect/.env
ExecStart=/usr/bin/node /home/Ladmin/url-redirect/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable url-redirect
sudo systemctl start url-redirect
sudo systemctl status url-redirect
```

---

## Troubleshooting

### Server Not Running
**Summary**: Check tmux session for error messages and restart if needed.

**Step 1: Check if tmux session exists:**
```bash
tmux list-sessions
```

**Step 2: Check if server process is running:**
```bash
ps aux | grep "node server.js"
```

**Step 3: Check if port 3000 is in use:**
```bash
sudo lsof -i :3000
# Or
sudo netstat -tlnp | grep 3000
```

**Step 4: View server logs to see errors:**
```bash
tmux attach-session -t url-redirect2
```
Look for error messages. Press `Ctrl+B` then `D` to detach.

**Step 5: Test server locally:**
```bash
curl http://localhost:3000/test
```
If this works, server is running correctly!

**Step 6: Verify port is listening on all interfaces:**
```bash
sudo netstat -tlnp | grep 3000
# Should show: tcp 0 0 0.0.0.0:3000 (not 127.0.0.1:3000)
```

**Step 7: Verify firewall allows port 3000:**
```bash
sudo firewall-cmd --list-ports
# Should show: 3000/tcp
```

**Step 8: Verify AWS Security Group:**
- Go to AWS Console → EC2 → Security Groups
- Select your instance's security group
- Inbound Rules must have: Type: Custom TCP, Port: 3000, Source: 0.0.0.0/0

**Step 9: Test from your LOCAL COMPUTER (not from EC2):**
From your local machine, open browser or use curl:
```bash
curl http://54.206.76.17:3000/test
```
**IMPORTANT**: You cannot test the public IP from within EC2. You MUST test from your local computer.

**Step 3: If session doesn't exist or server crashed, restart:**
```bash
cd ~/url-redirect
export $(grep -v '^#' .env | xargs)
tmux new-session -d -s url-redirect2
tmux send-keys -t url-redirect2 "cd ~/url-redirect && export \$(grep -v '^#' .env | xargs) && node server.js" Enter
sleep 2
curl http://localhost:3000/test
```

**Step 4: Check if port is already in use:**
```bash
sudo lsof -i :3000
# If something is using port 3000, kill it:
# sudo kill -9 <PID>
```

**Step 5: Verify .env file exists and has correct values:**
```bash
cat ~/url-redirect/.env
```

**Step 6: Test server manually (outside tmux) to see errors:**
```bash
cd ~/url-redirect
export $(grep -v '^#' .env | xargs)
node server.js
```
Press `Ctrl+C` to stop after checking for errors.

### Can't Access Admin Panel
**Summary**: Troubleshoot connection issues by checking server, firewall, and security group.

**Step 1: Verify you're using the PUBLIC IP, not private IP:**
```bash
# Get your public IP
curl ifconfig.me

# Or from metadata
curl http://169.254.169.254/latest/meta-data/public-ipv4
```
**IMPORTANT**: If you see `172.31.x.x`, that's the private IP and won't work from outside AWS. You MUST use the public IP.

**Step 2: Check server is running locally:**
```bash
curl http://localhost:3000/test
```

**Step 3: Check firewall:**
```bash
sudo firewall-cmd --list-ports
```

**Step 4: CRITICAL - Fix AWS Security Group (Most Common Issue):**

Your server is running correctly, but AWS Security Group is blocking external access. Follow these exact steps:

**4a. Go to AWS Console:**
1. Open AWS Console → **EC2** → **Instances**
2. Find your instance (the one with IP 54.206.76.17)
3. Click on the instance to select it

**4b. Check Security Group:**
1. Look at the bottom panel, click the **Security** tab
2. You'll see "Security groups" - click on the security group name (it's a blue link)

**4c. Edit Inbound Rules:**
1. In the security group page, click **Edit inbound rules** button
2. Check if there's a rule for port 3000:
   - Look for: **Type**: Custom TCP, **Port**: 3000, **Source**: 0.0.0.0/0

**4d. If rule is MISSING or incorrect:**
1. Click **Add rule**
2. Fill in:
   - **Type**: Custom TCP
   - **Port range**: `3000`
   - **Source**: `0.0.0.0/0` (allows from anywhere) OR your specific IP for better security
   - **Description**: `URL Redirect Server`
3. Click **Save rules**

**4e. Wait 10-30 seconds** for AWS to propagate the changes

**4f. Test again from your LOCAL COMPUTER:**
```bash
# From your local terminal (not EC2)
curl http://54.206.76.17:3000/test
```

Or open in browser: `http://54.206.76.17:3000/admin`

**4g. If still not working, check for multiple security groups:**
- Your instance might have multiple security groups
- Check ALL security groups attached to your instance
- Make sure at least ONE of them allows port 3000

**Step 5: Check server logs:**
```bash
tmux attach-session -t url-redirect2
```

**Step 6: Verify server is actually running:**
```bash
# Check if process is running
ps aux | grep "node server.js"

# Check if port 3000 is listening
sudo netstat -tlnp | grep 3000
# Or
sudo ss -tlnp | grep 3000

# Check what's listening on port 3000
sudo lsof -i :3000
```

**Step 7: Test from EC2 instance using localhost (should work):**
```bash
curl http://localhost:3000/test
```

**Step 8: CRITICAL - Test from your LOCAL COMPUTER, not from EC2:**

**You CANNOT reliably test the public IP from within the EC2 instance itself.** This is normal AWS behavior.

**From your local computer (not EC2), run:**
```bash
# Replace with your actual public IP
curl http://54.206.76.17:3000/test
```

**Or open in your browser:**
```
http://54.206.76.17:3000/admin
```

**If this fails from your local computer, check:**
1. Server is running on EC2: `curl http://localhost:3000/test` (on EC2)
2. Port 3000 is listening: `sudo netstat -tlnp | grep 3000` (on EC2)
3. AWS Security Group has inbound rule: Port 3000, Source 0.0.0.0/0
4. Firewall allows port 3000: `sudo firewall-cmd --list-ports` (on EC2)

**Step 9: Verify AWS Security Group is configured:**
1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Check **Inbound Rules** tab
4. Must have: **Type**: Custom TCP, **Port**: 3000, **Source**: 0.0.0.0/0
5. If missing, click "Edit inbound rules" → "Add rule" → Save

**Step 10: Test from your local computer (not EC2):**
From your local machine, open browser or use curl:
```bash
# Replace with your actual public IP
curl http://54.206.76.17:3000/test
```

**Common Issues:**
- ❌ **Wrong**: `http://172.31.18.120:3000/admin` (private IP - won't work from your computer)
- ✅ **Correct**: `http://54.206.76.17:3000/admin` (public IP - works from anywhere)
- ⚠️ **Server not running**: Check tmux session and restart if needed
- ⚠️ **Security group blocking**: Must allow port 3000 from 0.0.0.0/0

### Cloudflared Not Found
**Summary**: Verify cloudflared installation and reinstall if missing.

```bash
which cloudflared
# If not found, reinstall from Step 4
```

### Firewall Not Working
**Summary**: Check firewalld service status and reload configuration.

```bash
sudo systemctl status firewalld
sudo firewall-cmd --reload
```

### Directory Not Found Error
**Summary**: Fix "No such file or directory" error when trying to access the project directory.

**Step 1: Check current location and what exists:**
```bash
pwd
ls -la ~
```

**Step 2: Check if url-redirect directory exists:**
```bash
ls -la ~/url-redirect
```

**Step 3: If url-redirect exists, check its contents:**
```bash
ls -la ~/url-redirect/
find ~/url-redirect -type d
```

**Step 4: Re-clone the repository:**
```bash
cd ~
rm -rf url-redirect
git clone https://github.com/4d454d4f52592d544f574552/test1.git url-redirect
ls -la url-redirect/
```

**Step 5: Navigate to the correct directory:**
```bash
# Check what's actually in the repository
ls -la ~/url-redirect/

# Navigate to the project directory
cd ~/url-redirect
ls -la

# Verify server.js exists
ls -la server.js
```

---

## Summary

Your system is now:
- ✅ Running 24/7 in tmux
- ✅ Survives SSH disconnection
- ✅ Accessible at `http://YOUR_PUBLIC_IP:3000/admin`
- ✅ Ready to create and manage Cloudflare tunnels

**Access your admin panel**: `http://YOUR_PUBLIC_IP:3000/admin`
**Default login password**: **12345**

**To get your public IP, run on EC2:**
```bash
curl ifconfig.me
```

**IMPORTANT**: Always use the **PUBLIC IP** (not 172.31.x.x private IP) to access from your local machine!
