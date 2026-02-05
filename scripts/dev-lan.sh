#!/bin/bash

# 脚本用途：在WSL中启动开发服务器并配置局域网访问
# 使局域网内的其他设备可以访问开发服务器

set -e

PORT=3000
echo "🚀 正在配置WSL局域网访问..."
echo ""

# 获取WSL的IP地址
WSL_IP=$(hostname -I | awk '{print $1}')
echo "📍 WSL IP: $WSL_IP"

# 获取Windows主机的IP地址（通过/etc/resolv.conf）
WINDOWS_IP=$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}')
echo "📍 Windows Host IP: $WINDOWS_IP"

# 尝试获取Windows的局域网IP（通过PowerShell）
echo ""
echo "🔍 正在获取Windows主机的局域网IP地址..."
LAN_IP=$(powershell.exe -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi','以太网','Ethernet' | Where-Object {(\$_.IPAddress -like '192.168.*') -or (\$_.IPAddress -like '10.*') -or (\$_.IPAddress -like '172.*')} | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r')

if [ -n "$LAN_IP" ]; then
    echo "✅ Windows局域网IP: $LAN_IP"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📱 其他设备可通过以下地址访问："
    echo "   http://$LAN_IP:$PORT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
    echo "⚠️  无法自动获取局域网IP"
    echo "   请手动在Windows上运行 ipconfig 查看局域网IP"
fi

echo ""
echo "🔧 正在配置Windows端口转发..."

# 检查现有的端口转发规则
EXISTING_PROXY=$(powershell.exe -Command "netsh interface portproxy show v4tov4" 2>/dev/null | grep -i "$PORT")

if [ -n "$EXISTING_PROXY" ]; then
    echo "   检测到现有端口转发规则："
    echo "   $EXISTING_PROXY"
    echo "   正在更新规则..."
    # 删除旧的端口转发规则
    powershell.exe -Command "netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0" 2>/dev/null || true
fi

# 添加新的端口转发规则：将Windows的端口转发到WSL
PROXY_RESULT=$(powershell.exe -Command "netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP" 2>&1)

if echo "$PROXY_RESULT" | grep -q "请求的操作需要提升\|requires elevation"; then
    echo "⚠️  需要管理员权限配置端口转发"
    echo ""
    echo "   请在管理员PowerShell中运行以下命令："
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   netsh interface portproxy add v4tov4 listenport=$PORT listenaddress=0.0.0.0 connectport=$PORT connectaddress=$WSL_IP"
    echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "   配置完成后，按回车继续启动服务器..."
    read -r
elif [ $? -eq 0 ]; then
    echo "✅ 端口转发配置成功"
fi

# 检查防火墙规则
echo ""
echo "🔥 正在检查Windows防火墙规则..."
FIREWALL_RULE_EXISTS=$(powershell.exe -Command "Get-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name" 2>/dev/null | tr -d '\r')

if [ -z "$FIREWALL_RULE_EXISTS" ]; then
    echo "   正在添加防火墙规则..."
    FIREWALL_RESULT=$(powershell.exe -Command "New-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -Direction Inbound -LocalPort $PORT -Protocol TCP -Action Allow" 2>&1)
    
    if echo "$FIREWALL_RESULT" | grep -q "请求的操作需要提升\|requires elevation"; then
        echo "⚠️  需要管理员权限配置防火墙"
        echo ""
        echo "   请在管理员PowerShell中运行以下命令："
        echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "   New-NetFirewallRule -DisplayName 'WSL Dev Server Port $PORT' -Direction Inbound -LocalPort $PORT -Protocol TCP -Action Allow"
        echo "   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "   配置完成后，按回车继续启动服务器..."
        read -r
    elif echo "$FIREWALL_RESULT" | grep -q "Name"; then
        echo "✅ 防火墙规则添加成功"
    fi
else
    echo "✅ 防火墙规则已存在"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 配置完成！正在启动开发服务器..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 定义清理函数
cleanup() {
    echo ""
    echo "🛑 正在清理端口转发规则..."
    powershell.exe -Command "netsh interface portproxy delete v4tov4 listenport=$PORT listenaddress=0.0.0.0" 2>/dev/null || true
    echo "✅ 清理完成"
    exit 0
}

# 捕获退出信号
trap cleanup SIGINT SIGTERM EXIT

# 启动Next.js开发服务器（监听所有网络接口）
HOSTNAME=0.0.0.0 npm run dev

# 注意：当服务器停止时，清理函数会自动运行

