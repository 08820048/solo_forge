# Supabase Auth 登录配置（邮箱 / GitHub / Google）

本项目的前端已集成 Supabase Auth，并提供：
- 邮箱 + 密码登录/注册
- GitHub OAuth 登录
- Google OAuth 登录

登录入口在顶部 Header 的「登录」按钮中。OAuth 登录完成后会回跳到 `/{locale}/auth/callback`。

## 1. 前端环境变量

在 `/Users/xuyi/Desktop/SoloForges/frontend` 下创建或更新 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

说明：
- 使用 `anon` key（公开可用），不要把 `service_role` key 放到前端。
- 修改 `.env.local` 后需要重启前端 dev server。

## 2. Supabase 控制台基础配置

进入 Supabase 控制台：
- Authentication → URL Configuration

建议配置：
- Site URL：
  - 本地开发：`http://localhost:3001`
  - 线上：填写你的域名，例如 `https://soloforge.your-domain.com`
- Redirect URLs（至少包含以下几项）：
  - `http://localhost:3001/en/auth/callback`
  - `http://localhost:3001/zh/auth/callback`
  - 线上同理追加：
    - `https://你的域名/en/auth/callback`
    - `https://你的域名/zh/auth/callback`

注意：本项目强制使用 `/{locale}` 路由前缀，所以需要把 `en/zh` 两个回跳地址都加入白名单。

## 3. 启用邮箱登录（Email）

Supabase 控制台：
- Authentication → Providers → Email

按需求选择：
- Email + Password：开启即可（本项目已支持）
- Email Confirmations：如果开启，注册后需要邮箱验证才能完成登录（会影响测试流程）

## 4. 启用 GitHub OAuth

### 4.1 在 GitHub 创建 OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App：

- Homepage URL
  - 本地：`http://localhost:3001`
  - 线上：你的域名
- Authorization callback URL（必须与 Supabase 的回跳一致）
  - 本地建议先填：
    - `http://localhost:3001/en/auth/callback`
  - 然后在 Supabase 的 Redirect URLs 里补齐 `zh` 与线上地址

创建完成后拿到：
- Client ID
- Client Secret

### 4.2 回填到 Supabase

Supabase 控制台：
- Authentication → Providers → GitHub

填入：
- Client ID
- Client Secret

保存后即可使用。

## 5. 启用 Google OAuth

### 5.1 在 Google Cloud Console 创建 OAuth Client

Google Cloud Console：
- APIs & Services → Credentials → Create Credentials → OAuth client ID

配置要点：
- Authorized JavaScript origins：
  - `http://localhost:3001`
  - `https://你的线上域名`
- Authorized redirect URIs（同样需要包含回跳地址）：
  - `http://localhost:3001/en/auth/callback`
  - `http://localhost:3001/zh/auth/callback`
  - 以及线上对应的两条

创建完成后拿到：
- Client ID
- Client Secret

### 5.2 回填到 Supabase

Supabase 控制台：
- Authentication → Providers → Google

填入：
- Client ID
- Client Secret

保存后即可使用。

## 6. 常见问题排查

### 6.1 点击 GitHub/Google 登录后报 “redirect_uri_mismatch”

检查两处是否都包含你当前使用的回跳地址：
- Supabase → Authentication → URL Configuration → Redirect URLs
- GitHub/Google OAuth App 的回调 URL（Authorized redirect URIs / callback URL）

### 6.2 登录成功但 Header 没显示头像

本项目前端会从 Supabase session 的 `user_metadata` 中读取：
- `full_name` / `name`
- `avatar_url` / `picture`

如果 Provider 未返回头像字段，Header 会显示名字首字母作为回退。

