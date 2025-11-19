#!/bin/bash
# Quick start script for URL Redirect System on EC2

echo "Starting URL Redirect System..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Warning: cloudflared is not installed. Tunnels will not work."
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "PM2 is not installed. Installing..."
    sudo npm install -g pm2
fi

# Navigate to script directory
cd "$(dirname "$0")"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --production
fi

# Create data directory if it doesn't exist
mkdir -p data

# Start with PM2
echo "Starting application with PM2..."
pm2 start server.js --name url-redirect --env production

# Save PM2 configuration
pm2 save

echo "Application started!"
echo "View logs: pm2 logs url-redirect"
echo "View status: pm2 status"
echo "Access admin panel: http://YOUR_EC2_IP:3000/admin"

