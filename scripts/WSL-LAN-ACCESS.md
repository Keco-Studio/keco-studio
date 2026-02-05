# WSL局域网访问配置指南

## 问题背景

在WSL环境中开发时，默认情况下其他设备无法通过局域网访问开发服务器。这对于测试协同编辑功能等需要多设备的场景造成了不便。

## 解决方案

使用 `dev-lan.sh` 脚本自动配置WSL端口转发和防火墙规则，使局域网内的其他设备可以访问开发服务器。

## 使用方法

### 快速启动

```bash
npm run dev:lan
```

或者直接运行脚本：

```bash
bash scripts/dev-lan.sh
```

### 脚本功能

该脚本会自动完成以下操作：

1. **检测IP地址**
   - 获取WSL的IP地址
   - 获取Windows主机的IP地址
   - 获取Windows的局域网IP地址

2. **配置端口转发**
   - 在Windows上配置端口转发规则
   - 将Windows的3000端口转发到WSL的3000端口

3. **配置防火墙**
   - 自动添加Windows防火墙规则
   - 允许3000端口的入站连接

4. **启动开发服务器**
   - 使用 `HOSTNAME=0.0.0.0` 启动Next.js
   - 监听所有网络接口

5. **自动清理**
   - 当停止服务器时（Ctrl+C）
   - 自动删除端口转发规则

## 访问方式

脚本启动后，会显示局域网访问地址，例如：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 其他设备可通过以下地址访问：
   http://192.168.1.100:3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

在其他设备（手机、平板、其他电脑）上使用该地址即可访问开发服务器。

## 权限要求

某些操作需要Windows管理员权限：
- 配置端口转发（`netsh` 命令）
- 添加防火墙规则（`New-NetFirewallRule` 命令）

### 如果遇到权限错误

如果脚本无法自动配置，请按以下步骤手动操作：

1. **以管理员身份打开PowerShell**
2. **运行端口转发命令**：
   ```powershell
   netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL_IP>
   ```
   （将 `<WSL_IP>` 替换为脚本显示的WSL IP地址）

3. **添加防火墙规则**：
   ```powershell
   New-NetFirewallRule -DisplayName 'WSL Dev Server Port 3000' -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
   ```

4. **重新运行脚本**：
   ```bash
   npm run dev:lan
   ```

## 常见问题

### 1. 其他设备无法连接

- 确认Windows防火墙已允许3000端口
- 确认设备在同一局域网内
- 尝试关闭Windows防火墙测试（不推荐长期使用）

### 2. 端口已被占用

如果3000端口已被占用，可以修改脚本中的 `PORT=3000` 为其他端口。

### 3. 无法获取局域网IP

脚本可能无法自动检测局域网IP，此时：
1. 在Windows上运行 `ipconfig`
2. 查找 "无线局域网适配器 Wi-Fi" 或 "以太网适配器"
3. 找到 "IPv4 地址"
4. 手动使用该IP地址访问

### 4. 停止服务器后端口转发未清理

手动清理端口转发规则：

```powershell
# 在管理员PowerShell中运行
netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0
```

### 5. 查看现有端口转发规则

```powershell
netsh interface portproxy show all
```

## 与其他解决方案对比

### vs `dev:tunnel` (ngrok)

- **dev:lan**: 仅局域网访问，速度快，无需外网
- **dev:tunnel**: 通过公网隧道，可从任何地方访问，但速度较慢

### 使用场景

- **局域网访问** (`dev:lan`): 多设备测试、协同编辑测试
- **公网访问** (`dev:tunnel`): 远程演示、移动设备测试（不在同一网络）

## 技术原理

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  手机/平板   │ -------> │ Windows主机  │ -------> │   WSL       │
│192.168.1.x  │  LAN    │192.168.1.100 │ forward │ 172.x.x.x   │
└─────────────┘         │ :3000        │         │ :3000       │
                        └──────────────┘         └─────────────┘
                              ↓                        ↓
                        端口转发规则              Next.js Dev
                        防火墙规则                HOSTNAME=0.0.0.0
```

## 安全提示

- 仅在受信任的局域网中使用
- 不要在公共WiFi中使用
- 测试完成后停止服务器（自动清理端口转发）
- 生产环境不应使用开发服务器

## 协同编辑测试建议

1. 使用 `npm run dev:lan` 启动服务器
2. 在主设备上登录账号A
3. 在其他设备上通过局域网IP访问，登录账号B
4. 在同一个文档中进行编辑，测试协同功能
5. 测试完成后停止服务器

## 参考资源

- [WSL网络配置文档](https://docs.microsoft.com/zh-cn/windows/wsl/networking)
- [Next.js自定义服务器](https://nextjs.org/docs/advanced-features/custom-server)

