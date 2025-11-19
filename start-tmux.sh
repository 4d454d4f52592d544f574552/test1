#!/bin/bash
# TMUX startup script for URL Redirect System

echo "Starting URL Redirect System in TMUX..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "Warning: cloudflared is not installed. Tunnels will not work."
fi

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed. Install with: sudo dnf install -y tmux"
    exit 1
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

# Check if session already exists
if tmux has-session -t url-redirect 2>/dev/null; then
    echo "TMUX session 'url-redirect' already exists!"
    echo "Attach to it with: tmux attach-session -t url-redirect"
    echo "Or kill it first with: tmux kill-session -t url-redirect"
    exit 1
fi

# Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "Loading environment variables from .env..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# Create tmux session and start server
echo "Creating TMUX session 'url-redirect'..."
tmux new-session -d -s url-redirect -c "$(pwd)" 'node server.js'

# Wait a moment for server to start
sleep 2

# Check if session is running
if tmux has-session -t url-redirect 2>/dev/null; then
    echo "✅ Server started in TMUX session 'url-redirect'"
    echo ""
    echo "Useful commands:"
    echo "  Attach to session:    tmux attach-session -t url-redirect"
    echo "  Detach from session:  Press Ctrl+B, then D"
    echo "  List sessions:        tmux list-sessions"
    echo "  Kill session:         tmux kill-session -t url-redirect"
    echo "  View logs:            tmux attach-session -t url-redirect"
    echo ""
    echo "Test server: curl http://localhost:3000/test"
    echo "Admin panel: http://YOUR_EC2_IP:3000/admin"
else
    echo "❌ Failed to create TMUX session"
    exit 1
fi

