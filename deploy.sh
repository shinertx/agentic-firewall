#!/bin/bash

# Configuration
SERVER="meme-snipe-v19-vm"
DEST_DIR="~/agentic-firewall"

echo "Deploying Agentic Firewall to $SERVER..."

# Rsync the codebase
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude '.env' ./ $SERVER:$DEST_DIR

echo "Deployment complete! SSH into the server to start the proxy."
