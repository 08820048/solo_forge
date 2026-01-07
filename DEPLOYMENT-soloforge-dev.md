# SoloForge 生产环境部署文档（soloforge.dev）

> 目标：将当前项目部署到腾讯云东京服务器上，并通过 Cloudflare 管理域名 **soloforge.dev**，支持前台站点、后台管理和后端 API 的完整生产环境运行。

服务器信息（由你提供）：

- 云厂商：腾讯云（东京）
- 公网 IP：`43.167.199.208`
- 开放端口：22（SSH）、80（HTTP）、443（HTTPS）、8080（自定义 TCP）等
- 域名：`soloforge.dev`（在 Cloudflare 管理）

本文档只描述**生产环境**部署流程，本地开发参考仓库中的 `SETUP.md`。

---

## 一、整体架构与域名规划

推荐采用「**Vercel + 自托管后端 + Supabase**」的组合：

- **前台站点**：`https://soloforge.dev`
  - 部署位置：Vercel（项目目录：`frontend`）
  - 职责：展示产品、开发者中心页面、前端路由和 `app/api` BFF。
- **后台管理**：`https://admin.soloforge.dev`
  - 部署位置：Vercel（项目目录：`admin-frontend`）
  - 职责：分类管理、赞助管理、首页模块配置等。
- **后端 API**：`https://api.soloforge.dev`
  - 部署位置：腾讯云服务器（Rust + Actix Web）
  - 进程监听：`127.0.0.1:8080`
  - 通过 Nginx 反向代理到 80/443。
- **数据库**：Supabase（PostgreSQL）
  - 使用两个 Project 区分 dev / prod，本文仅涉及 prod。

数据流示意：

- 浏览器 → `soloforge.dev`（Vercel）→ Next.js `app/api/*` → `https://api.soloforge.dev/api/*` → Rust 后端 → Supabase
- 管理端浏览器 → `admin.soloforge.dev`（Vercel）→ Next.js `app/api/admin/*`（携带 `BACKEND_ADMIN_TOKEN`）→ `https://api.soloforge.dev/api/admin/*`

---

## 二、前置准备

在开始部署前，请确认：

1. 你已经在 Cloudflare 添加了 `soloforge.dev`，并成功解析到腾讯云 IP。
2. 已创建 **Supabase 生产项目**，并准备好以下信息：
   - `SUPABASE_URL`（project URL）
   - `SUPABASE_SERVICE_ROLE_KEY`（Service Role Key，仅后端使用）
   - `SUPABASE_ANON_KEY`（或 Publishable Key，前端使用）
3. 已在 Supabase 的 SQL 编辑器中执行了仓库中的数据库初始化脚本：
   - 文件位置：`backend/database_schema.sql`
4. 腾讯云服务器系统为常见 Linux 发行版（如 Ubuntu 20.04+），可以通过 SSH 登录：

```bash
ssh root@43.167.199.208
```

---

## 三、Cloudflare DNS 与 HTTPS 配置

### 3.1 DNS 记录

在 Cloudflare 的「DNS」页面中添加以下记录（示例）：

1. **后端 API 域名**

   - 类型：`A`
   - 名称：`api`
   - IPv4 地址：`43.167.199.208`
   - 代理状态：建议开启（橙色云）以利用 Cloudflare CDN 与 WAF。

2. **前台站点域名**

   - 类型：`CNAME`
   - 名称：`@`（即 `soloforge.dev`）
   - 目标：Vercel 分配的域名（如 `xxx.vercel.app`），或者在 Vercel 中直接绑定 `soloforge.dev` 后按 Vercel 提示配置。

3. **后台管理域名**

   - 类型：`CNAME`
   - 名称：`admin`
   - 目标：对应 `admin-frontend` 的 Vercel 域名（如 `soloforge-admin.vercel.app`）。

> 注：前台和后台如果都交给 Vercel 托管，实际 DNS 以 Vercel 提示为准，本节主要约定域名规划。

### 3.2 SSL/TLS 模式

在 Cloudflare「SSL/TLS」中：

- 模式建议选择 **Full（严格模式 Full (strict)）**。
- 这要求你的服务器上为 `api.soloforge.dev` 正常配置 TLS 证书（可以使用 Let’s Encrypt）。

---

## 四、后端在腾讯云服务器上的部署

后端使用 Rust + Actix Web，最终会以 systemd 服务常驻运行。

### 4.1 安装基础软件

在服务器上执行（以 Ubuntu 为例）：

```bash
apt update
apt install -y git build-essential pkg-config libssl-dev nginx

# 安装 Rust（如已安装可跳过）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### 4.2 拉取代码

```bash
cd /opt
git clone https://github.com/your-account/SoloForges.git soloforge
cd soloforge/backend
```

> 将 `your-account` 替换为你自己的仓库地址，如果代码不是托管在 GitHub，请按实际情况调整。

### 4.3 配置生产环境变量

生产环境推荐使用 systemd 的 `Environment` 配置，而不是 `.env` 文件。  
下面先准备一个环境变量文件 `/etc/default/soloforge-backend`：

```bash
cat >/etc/default/soloforge-backend <<'EOF'
SUPABASE_URL=https://your-prod-supabase-project.supabase.co
SUPABASE_KEY=your-prod-service-role-key

HOST=127.0.0.1
PORT=8080
RUST_LOG=info

# 对外访问用到的 URL，可根据实际情况调整
BACKEND_PUBLIC_URL=https://api.soloforge.dev
FRONTEND_BASE_URL=https://soloforge.dev

# 如暂不启用 newsletter，可关闭
NEWSLETTER_ENABLED=0
EOF
```

> 所有带 `your-...` 的值需要根据你的 Supabase 项目和域名实际填写。  
> `SUPABASE_KEY` 属于高权限密钥，只能存放在服务器后端环境，**不要泄露**。

### 4.4 构建后端二进制

```bash
cd /opt/soloforge/backend
cargo build --release
```

构建成功后，将生成二进制文件：

- `/opt/soloforge/backend/target/release/soloforge_backend`

### 4.5 配置 systemd 服务

创建服务文件 `/etc/systemd/system/soloforge-backend.service`：

```ini
[Unit]
Description=SoloForge Backend (Actix Web)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/soloforge/backend
ExecStart=/opt/soloforge/backend/target/release/soloforge_backend
EnvironmentFile=/etc/default/soloforge-backend
Restart=on-failure
RestartSec=5s
User=root

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
systemctl daemon-reload
systemctl enable soloforge-backend
systemctl start soloforge-backend
systemctl status soloforge-backend
```

此时后端进程应监听在 `127.0.0.1:8080`：

```bash
ss -tulpn | grep 8080
```

本机测试：

```bash
curl http://127.0.0.1:8080/api/health
```

返回健康检查 JSON 即表示后端正常运行。

---

## 五、Nginx 反向代理与 HTTPS

### 5.1 安装与基本配置

上文已经安装了 Nginx，如未安装：

```bash
apt install -y nginx
```

### 5.2 为 api.soloforge.dev 配置虚拟主机

新建配置文件 `/etc/nginx/sites-available/api.soloforge.dev.conf`：

```nginx
server {
    listen 80;
    server_name api.soloforge.dev;

    # 将所有 HTTP 请求重定向到 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.soloforge.dev;

    # TLS 证书路径（使用 certbot 获取后替换）
    ssl_certificate     /etc/letsencrypt/live/api.soloforge.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.soloforge.dev/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
    }
}
```

启用站点：

```bash
ln -s /etc/nginx/sites-available/api.soloforge.dev.conf /etc/nginx/sites-enabled/api.soloforge.dev.conf
nginx -t
systemctl reload nginx
```

### 5.3 申请 TLS 证书（Let’s Encrypt）

使用 certbot 为 `api.soloforge.dev` 申请证书：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.soloforge.dev
```

根据提示完成 HTTP 验证后，certbot 会自动帮你写好 HTTPS 配置（可与上面的示例合并或直接使用 certbot 生成的配置）。

验证：

```bash
curl https://api.soloforge.dev/api/health
```

看到健康检查响应则说明反向代理 + HTTPS 正常。

---

## 六、在 Vercel 部署前台 `frontend`

### 6.1 创建 Vercel 项目（前台）

1. 在 Vercel 控制台点击「New Project」。
2. 选择 Git 仓库，项目根目录选择 `frontend`。
3. 保持默认构建命令（Next.js 16 会自动识别）。

### 6.2 配置环境变量（Production）

在 Vercel 项目 Settings → Environment Variables 中添加：

- `BACKEND_API_URL=https://api.soloforge.dev/api`
- `NEXT_PUBLIC_SUPABASE_URL=https://your-prod-supabase-project.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=your-prod-anon-or-publishable-key`

> 注意：`NEXT_PUBLIC_*` 变量在浏览器可见，只能填写 Supabase 的匿名/可公开 key，**不要**填 Service Role Key。

### 6.3 绑定域名 soloforge.dev

1. 在 Vercel 的「Domains」中为前台项目添加 `soloforge.dev`。
2. 按 Vercel 提示到 Cloudflare 中配置 DNS（通常是把 `soloforge.dev` 的 CNAME/A 指向 Vercel）。
3. 部署完成后访问 `https://soloforge.dev`，测试：
   - 产品列表页；
   - 搜索、分类；
   - 开发者中心基础功能（不依赖 OAuth 的部分）。

---

## 七、在 Vercel 部署后台 `admin-frontend`

### 7.1 创建 Vercel 项目（后台）

1. 在 Vercel 中创建新项目，根目录选择 `admin-frontend`。
2. 保持默认构建命令。

### 7.2 配置环境变量（Production）

在该项目的 Environment Variables 中添加：

- `BACKEND_API_URL=https://api.soloforge.dev/api`
- `BACKEND_ADMIN_TOKEN=your-strong-admin-token`

> - 这个 `BACKEND_ADMIN_TOKEN` 需要与你后端约定的校验逻辑一致，建议是较长、难以猜测的随机字符串。  
> - 该变量不会暴露到浏览器，只在 `app/api/admin/*` 的服务端路由中使用。

### 7.3 绑定域名 admin.soloforge.dev

1. 在 Vercel 的「Domains」中为后台项目添加 `admin.soloforge.dev`。
2. 在 Cloudflare 中为 `admin` 添加 CNAME 指向 Vercel 提供的域名。
3. 部署完成后访问 `https://admin.soloforge.dev`，测试：
   - 分类管理；
   - 赞助请求 / 发放列表；
   - 首页模块配置等接口（对应 `app/api/admin/*` 路由）。

---

## 八、Supabase 与第三方登录配置（GitHub / Google / X）

### 8.1 Supabase 项目设置

在 Supabase 控制台中：

1. 进入「Settings → General」：
   - **Site URL** 设置为：`https://soloforge.dev`
2. 进入「Authentication → URL Configuration」：
   - 在 `Redirect URLs` 中添加：
     - `https://soloforge.dev`
     - 如有多语言特定路径，可按需添加，例如：`https://soloforge.dev/zh`

### 8.2 启用第三方提供商

在「Authentication → Providers」中依次配置：

1. GitHub
2. Google
3. X（Twitter）

每个 Provider 需要到对应平台的开发者控制台中配置：

- 回调 URL：使用 Supabase 提示的 redirect URL，或以 `https://soloforge.dev` 起始的路径（依据 Supabase 文档与项目集成方式）。
- Client ID / Client Secret：填入 Supabase 对应 Provider 的配置页。

完成后，在生产站点点击「使用 GitHub/Google/X 登录」应能完整走通授权流程。

---

## 九、部署后的验证清单

部署完成后，建议按以下顺序验证：

1. **后端健康检查**
   - `curl https://api.soloforge.dev/api/health`
2. **前台基础功能**
   - 访问 `https://soloforge.dev`：
     - 产品列表、详情页是否正常；
     - 搜索和分类接口是否正常（无 5xx）。
3. **开发者中心**
   - 未登录访问是否有合理提示；
   - 登录后能否查看自己的产品、收藏等。
4. **第三方登录**
   - 依次测试 GitHub / Google / X 登录；
   - 授权完成后，用户能正确回到站点，且会话状态正常。
5. **后台管理**
   - `https://admin.soloforge.dev` 是否可用；
   - 分类增删改、赞助请求管理、首页模块配置等操作是否正常写入 Supabase。
6. **日志与监控**
   - 在服务器上通过 `journalctl -u soloforge-backend -f` 观察后端日志；
   - 定期检查 Supabase 的慢查询和配额情况。

---

## 十、更新与回滚建议

### 10.1 后端更新流程

1. 登录服务器，拉取最新代码：

   ```bash
   cd /opt/soloforge
   git pull origin main   # 分支名称视实际情况而定
   cd backend
   cargo build --release
   ```

2. 重启后台服务：

   ```bash
   systemctl restart soloforge-backend
   ```

3. 观察日志与健康检查：

   ```bash
   journalctl -u soloforge-backend -f
   curl https://api.soloforge.dev/api/health
   ```

### 10.2 前端/管理端更新

前端和管理端通过 Vercel 部署，一般只需：

1. 将代码推送到 main 或对应分支；
2. Vercel 自动触发构建与部署；
3. 如遇问题，可在 Vercel 中回滚到上一版本。

---

## 十一、后续可优化点

- 使用 Docker / docker-compose 编排后端与 Nginx，进一步标准化部署。
- 在 Cloudflare 或服务器上加入限流、防爬虫、缓存等策略。
- 引入监控（如 Prometheus + Grafana）和报警（如飞书/Slack Webhook）。
- 为前端/后端分别建立 staging 环境，配合 Supabase 的第二个项目，用于预发布测试。

以上步骤执行完成后，你的 SoloForge 项目就可以在 `soloforge.dev` 生产环境上稳定运行，并支持第三方登录等完整功能。根据后续需求，你可以在此基础上继续迭代功能与性能优化。

