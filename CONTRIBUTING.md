# 贡献指南

感谢你愿意为 SoloForge 做贡献！本指南帮助你快速上手并保持协作一致性。

## 开发准备

1. Fork 本仓库并创建分支
2. 按 [SETUP.md](file:///Users/xuyi/Desktop/SoloForges/SETUP.md) 完成环境与依赖安装
3. 修改代码并确保本地通过检查

## 代码风格

- 保持与现有代码风格一致
- 避免提交敏感信息或密钥
- 新增逻辑尽量复用已有工具与模式

## 提交规范

- 提交信息简洁、描述清晰
- 建议格式：`type: summary`
  - 例如：`feat: add sponsor request flow`

## 本地校验

请确保以下命令通过：

- 前端：`npm --prefix frontend run lint`
- 前端类型检查：`npm --prefix frontend exec -- tsc -p tsconfig.json --noEmit`
- 管理后台：`npm --prefix admin-frontend run lint`

后端测试或检查请依据实际修改范围选择执行。

## 提交 Pull Request

请在 PR 描述中说明：

- 变更目的与内容
- 影响范围（前端 / 管理后台 / 后端）
- 是否需要更新配置或迁移步骤
