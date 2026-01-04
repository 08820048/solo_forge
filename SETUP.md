# SoloForge 部署指南

## 项目概述

SoloForge 是一个面向全球独立开发者的产品收录与展示平台，支持中英双语。

## 技术栈

- **后端**: Rust + Actix Web + Supabase (PostgreSQL)
- **前端**: Next.js 16 + TypeScript + Tailwind CSS + next-intl
- **数据库**: Supabase (PostgreSQL)
- **国际化**: next-intl

## 快速开始

### 1. 环境准备

确保您的系统已安装：
- Node.js 18+
- Rust 1.70+
- Supabase 账户
- PostgreSQL (可选，使用 Supabase)

### 2. 后端设置

#### 2.1 创建 Supabase 项目

1. 访问 [supabase.com](https://supabase.com) 并创建新项目
2. 在项目设置中获取：
   - Project URL
   - Service Role Key
3. 复制 `backend/database_schema.sql` 内容到 Supabase SQL 编辑器中执行

#### 2.2 配置环境变量

```bash
cd backend

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入您的 Supabase 凭据
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
PORT=8080
HOST=0.0.0.0
RUST_LOG=info
```

#### 2.3 启动后端

```bash
# 安装依赖
cargo install cargo-watch

# 开发模式
cargo watch -x run

# 或直接运行
cargo run
```

后端将在 `http://localhost:8080` 启动

### 3. 前端设置

#### 3.1 安装依赖

```bash
cd frontend

# 安装 Node.js 依赖
npm install
```

#### 3.2 配置环境变量

```bash
# 复制环境变量模板
cp .env.local.example .env.local

# 如果后端不在 localhost:8080，请设置 BACKEND_API_URL
# BACKEND_API_URL=http://your-backend-url.com/api
```

#### 3.3 启动前端

```bash
# 开发模式
npm run dev

# 构建生产版本
npm run build
npm start
```

前端将在 `http://localhost:3000` 启动

### 4. 国际化配置

项目已配置中英双语支持：
- 默认语言：英文 (`/`)
- 中文路径：`/zh`
- 可通过 Header 组件切换语言

## 数据库结构

### 产品表 (products)
```sql
- id: UUID (主键)
- name: 产品名称
- slogan: 产品标语
- description: 产品描述
- website: 产品网站
- logo_url: Logo URL
- category: 分类
- tags: 标签数组
- maker_name: 开发者姓名
- maker_email: 开发者邮箱
- maker_website: 开发者网站
- language: 语言 (en/zh)
- status: 状态 (pending/approved/rejected)
- created_at/updated_at: 时间戳
```

### 分类表 (categories)
```sql
- id: 分类标识
- name_en: 英文名称
- name_zh: 中文名称
- icon: 图标
- color: 颜色类名
```

## API 端点

### 产品相关
- `GET /api/products` - 获取产品列表
- `POST /api/products` - 创建新产品
- `GET /api/products/{id}` - 获取单个产品
- `PUT /api/products/{id}` - 更新产品
- `DELETE /api/products/{id}` - 删除产品

### 分类相关
- `GET /api/categories` - 获取所有分类

### 其他
- `GET /api/health` - 健康检查

## 环境变量

### 后端 (.env)
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_service_role_key
PORT=8080
HOST=0.0.0.0
RUST_LOG=info
```

### 前端 (.env.local)
```
BACKEND_API_URL=http://localhost:8080/api
```

## 部署

### Vercel + Supabase 推荐部署

1. **前端部署到 Vercel**
   - 连接 GitHub 仓库到 Vercel
   - 配置环境变量 `BACKEND_API_URL`
   - 自动部署

2. **后端部署**
   - 使用 Docker 容器部署
   - 或使用 Railway/Render 等平台
   - 配置环境变量

### Docker 部署

```bash
# 构建后端
cd backend
cargo build --release

# 前端构建
cd ../frontend
npm run build
```

## 开发指南

### 添加新分类
1. 更新 `backend/database_schema.sql` 中的 categories 表
2. 前端分类会自动从 API 获取

### 国际化
1. 翻译文件位于 `frontend/messages/`
2. 添加新语言需要在 `next.config.ts` 中配置

### 自定义样式
- 使用 Tailwind CSS 类
- 样式文件位于 `frontend/components/`

## 故障排除

### 常见问题

1. **数据库连接错误**
   - 检查 Supabase URL 和密钥
   - 确保 SQL schema 已执行

2. **CORS 错误**
   - 后端已配置 CORS，确保 API URL 正确

3. **构建错误**
   - 检查 Rust 和 Node.js 版本
   - 确保所有依赖已安装

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 发起 Pull Request

## 许可证

MIT License

## 支持

如有问题，请创建 Issue 或联系开发团队。