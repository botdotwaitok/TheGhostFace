# 📱 iOS 语音通话设置指南

> 如果你在 iOS Safari 上打开设置 → 语音通话，发现语音识别 (STT) 显示「不可用」或语音合成 (TTS) 无法连接本地服务，请按本指南操作。

## 为什么 iOS 上不能用？

iOS 所有浏览器（Safari、Chrome、Edge、Firefox）底层都是 Apple 的 WebKit 引擎。WebKit 要求必须使用 **HTTPS** 才能使用麦克风和语音识别。如果你的酒馆是通过 `http://` 访问的，这些功能就会被浏览器直接拦截。

**PC 上 Edge / Chrome 没有这个限制**，所以在电脑上一切正常。

---

## 解决方案：用 Tailscale 给酒馆加 HTTPS

如果你已经在用 Tailscale 从手机连电脑，恭喜你——加 HTTPS 超级简单！

### 前置条件

- ✅ 电脑上装了 Tailscale 并登录
- ✅ 手机上装了 Tailscale 并登录同一个账号
- ✅ 手机能通过 Tailscale IP 访问酒馆

### Step 1：开启 Tailscale HTTPS 功能

1. 登录 [Tailscale 后台](https://login.tailscale.com/admin/dns)
2. 确保 **MagicDNS** 已开启
3. 找到 **HTTPS Certificates**，点击 **Enable**

### Step 2：查看你的电脑域名

在电脑上打开 PowerShell，运行：

```powershell
tailscale status --json | findstr "DNSName"
```

会输出类似这样的结果：

```
"DNSName": "你的电脑名.tailXXXXX.ts.net.",
```

记下 `你的电脑名.tailXXXXX.ts.net` 这个域名（去掉最后的 `.`）。

### Step 3：生成 HTTPS 证书

在 PowerShell 里运行（把域名换成你自己的）：

```powershell
tailscale cert 你的电脑名.tailXXXXX.ts.net
```

会在当前目录生成两个文件：
- `你的电脑名.tailXXXXX.ts.net.crt`（证书）
- `你的电脑名.tailXXXXX.ts.net.key`（私钥）

### Step 4：修改酒馆配置

打开酒馆根目录下的 `config.yaml`，找到 `ssl` 部分，改成：

```yaml
ssl:
  enabled: true
  certPath: C:\Users\你的用户名\你的电脑名.tailXXXXX.ts.net.crt
  keyPath: C:\Users\你的用户名\你的电脑名.tailXXXXX.ts.net.key
  keyPassphrase: ""
```

> 💡 路径要填你证书文件的**完整路径**。

然后在同一个文件里找到 `hostWhitelist` 的 `hosts`，加上你的 Tailscale 域名：

```yaml
hostWhitelist:
  enabled: true
  scan: true
  hosts:
    - localhost
    - 127.0.0.1
    - "[::1]"
    - 你的电脑名.tailXXXXX.ts.net    # ← 加这行
```

如果你用了**本地 GPT-SoVITS** 做 TTS，还需要开启 CORS 代理，找到 `enableCorsProxy`，改成：

```yaml
enableCorsProxy: true
```

### Step 5：重启酒馆

关掉酒馆，重新启动。

### Step 6：从手机访问

在 iOS Safari 里输入：

```
https://你的电脑名.tailXXXXX.ts.net:8000
```

> ⚠️ 注意是 **https://** 不是 http://。端口号看你酒馆配置的 `port`（默认 8000）。

第一次访问时 Safari 可能会问你要麦克风权限，点**允许**。

---

## 没有 Tailscale 怎么办？

如果你不用 Tailscale，还有另一个方案：

### 使用 Groq Whisper（免费 API）

Groq 提供免费的语音识别 API，不需要 HTTPS 也能用（但实际上需要 HTTPS 才能获取麦克风权限，所以这个方案在 iOS 上也不行……）

**结论：iOS 用户必须通过 HTTPS 访问酒馆，没有其他绕过方法。**

推荐方案优先级：
1. **Tailscale HTTPS**（本文档介绍的方法，最推荐）
2. 给酒馆配 Nginx 反向代理 + 自签证书（需要手动信任证书，操作繁琐）
3. 在电脑上使用 Edge / Chrome 浏览器（不需要 HTTPS，但就不是手机了）

---

## 常见问题

### Q：PC 上也必须用 HTTPS 访问吗？

是的。开启 SSL 后，`http://` 就不能用了。PC 上请用 `https://localhost:8000` 或 `https://你的域名:8000`。

### Q：证书会过期吗？

Tailscale 证书有效期约 90 天。过期后重新运行 `tailscale cert 你的域名` 即可续期。

### Q：我用的不是 Tailscale，而是 ZeroTier / FRP / 内网穿透…

核心原理一样：你需要让酒馆通过 HTTPS 提供服务。如果你的内网穿透服务不支持 HTTPS，可以用 OpenSSL 生成自签证书，但 iOS Safari 需要手动安装并信任该证书（设置 → 通用 → 关于 → 证书信任设置）。
