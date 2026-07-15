#!/bin/bash

# Purpose: start the dev server in WSL and configure LAN access
# so other devices on the local network can reach the dev server.

set -e

PORT=3000
echo "🚀 Configuring WSL LAN access..."
echo ""

# Get the WSL IP address
WSL_IP=$(hostname -I | awk '{print $1}')
echo "📍 WSL IP: $WSL_IP"

# Get the Windows host IP address (via /etc/resolv.conf)
WINDOWS_IP=$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}')
echo "📍 Windows Host IP: $WINDOWS_IP"

# Try to get the Windows LAN IP (via PowerShell)
echo ""
echo "🔍 Detecting the Windows host's LAN IP address..."
# Note: the Chinese-locale Windows ethernet interface alias (previously matched
# literally) is no longer included; on Chinese-locale Windows the LAN IP may not
# be auto-detected and must be looked up manually with ipconfig.
LAN_IP=$(powershell.exe -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi','Ethernet' | Where-Object {(\$_.IPAddress -like '192.168.*') -or (\$_.IPAddress -like '10.*') -or (\$_.IPAddress -like '172.*')} | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r')

if [ -n "$LAN_IP" ]; then
    echo "✅ Windows LAN IP: $LAN_IP"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📱 Other devices can access via:"
    echo "   http://$LAN_IP:$PORT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    echo "⚠️  Could not detect the LAN IP automatically"
    echo "   Run ipconfig on Windows to find the LAN IP manually"
fi

echo ""
echo "🔧 Configuring Windows port forwarding..."

# Check existing port forwarding rules
EXISTING_PROXY=$(powershell.exe -Command "netsh interface portproxy show v4tov4" 2>/dev/null | grep -i "$PORT")

if [ -n "$EXISTING_PROXY" ]; then
    echo "   Found an existing port forwarding rule:"
    echo "   $EXISTING_PROXY"
    echo "   Updating the rule..."
    # Delete the old port forwarding rule
    powershell.exe -Command "netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0" 2>/dev/null || true
fi

# Add a new port forwarding rule: forward the Windows port to WSL
PROXY_RESULT=$(powershell.exe -Command "netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP" 2>&1)

# Note: only the English elevation error message is matched; on non-English
# Windows locales (e.g. Chinese) the elevation prompt may not be detected.
if echo "$PROXY_RESULT" | grep -q "requires elevation"; then
    echo "⚠️  Administrator privileges are required to configure port forwarding"
    echo ""
    echo "   Run the following command in an administrator PowerShell:"
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP"
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "   After configuring, press Enter to continue starting the server..."
    read -r
elif [ $? -eq 0 ]; then
    echo "✅ Port forwarding configured successfully"
fi

# Check firewall rules
echo ""
echo "🔥 Checking Windows firewall rules..."
FIREWALL_RULE_EXISTS=$(powershell.exe -Command "Get-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name" 2>/dev/null | tr -d '\r')

if [ -z "$FIREWALL_RULE_EXISTS" ]; then
    echo "   Adding a firewall rule..."
    FIREWALL_RESULT=$(powershell.exe -Command "New-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -Direction Inbound -LocalPort $PORT -Protocol TCP -Action Allow" 2>&1)

    # Note: only the English elevation error message is matched; on non-English
    # Windows locales (e.g. Chinese) the elevation prompt may not be detected.
    if echo "$FIREWALL_RESULT" | grep -q "requires elevation"; then
        echo "⚠️  Administrator privileges are required to configure the firewall"
        echo ""
        echo "   Run the following command in an administrator PowerShell:"
        echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "   New-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -Direction Inbound -LocalPort $PORT -Protocol TCP -Action Allow"
        echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "   After configuring, press Enter to continue starting the server..."
        read -r
    elif echo "$FIREWALL_RESULT" | grep -q "Name"; then
        echo "✅ Firewall rule added successfully"
    fi
else
    echo "✅ Firewall rule already exists"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 Configuration complete! Starting the dev server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Define the cleanup function
cleanup() {
    echo ""
    echo "🛑 Cleaning up port forwarding rules..."
    powershell.exe -Command "netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0" 2>/dev/null || true
    echo "✅ Cleanup complete"
    exit 0
}

# Trap exit signals
trap cleanup SIGINT SIGTERM EXIT

# Start the Next.js dev server (listen on all network interfaces)
HOSTNAME=0.0.0.0 npm run dev

# Note: the cleanup function runs automatically when the server stops

