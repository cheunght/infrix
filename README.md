# Infrix

Infrix 是 IT 资产管理平台，后端使用 Python/Django + Django REST Framework，前端使用 Vue 3 + Element Plus。

当前仓库是私有开发基线，不包含本地数据库、账号、业务数据、密钥、依赖目录或构建产物。

## 本地开发

需要 Python 3.10+、Node.js 18+ 和 npm。

### 后端

默认使用 SQLite，仅用于本地开发；生产环境通过环境变量切换 MySQL。

```bash
cd backend
./setup.sh
./run.sh createsuperuser
./run.sh runserver
```

`setup.sh` 会创建虚拟环境、安装依赖、执行迁移并初始化应用预设角色。不要使用系统 Python 直接运行 `manage.py`。

### 前端

```bash
cd frontend
npm ci
npm run dev
```

前端默认将 API 请求发送到 `/api/v1`。本地开发时可通过 `VITE_API_BASE` 覆盖 API 地址。

生产构建和类型检查：

```bash
npm run typecheck
npm run build
```

`npm run build` 会先执行前端 UI 回归契约检查，确保字典 Tab、Rack 分页和 Dashboard 资源跳转的关键交互不会被布局清理误改。

API 文档：`http://127.0.0.1:8000/api/docs/`

## 当前功能

- 登录、预设角色和后端能力校验
- 资产台账、资产详情、Excel/CSV 导入预览、Excel 导出和自定义字段
- 数据中心、机房、机柜、U 位分配、机柜视图和容量统计
- 设备分类、厂商、设备类型、标签和自定义字段管理
- 故障登记、维修闭环、维修记录导出
- 软件许可证管理
- 数据中心设备盘点、历史盘点记录和结果导出
- 备件定义、多地点库存和库存流水
- 操作日志、管理员组织权限和系统维护（应用级恢复初始状态）
- Rocky Linux 9 + MySQL/MariaDB + Gunicorn + Nginx 部署

## 数据与安全

- `.env`、SQLite 数据库、数据库备份、日志和构建目录不会进入 Git。
- 请复制 `backend/.env.example` 为本地环境文件，并替换所有示例密钥。
- 生产环境请使用随机 `DJANGO_SECRET_KEY`、最小数据库权限、定期数据库备份和恢复演练。
- 本仓库当前为 private；正式公开发布前再补充开源许可证和公开发布说明。

## Rocky Linux 9 部署

参阅 [docs/INSTALL_VM.md](docs/INSTALL_VM.md)，在 Rocky 9 上执行：

```bash
sudo -E ./deploy/install.sh
```

脚本会在迁移前备份 MySQL/MariaDB、执行 Django 检查、构建前端、启动 Gunicorn，并检查 API 和 Nginx 健康状态。

生产部署使用显式的 `DJANGO_ENV=production`，启动时会 fail closed 校验密钥、调试模式、
Host、CSRF 来源、HTTPS/代理策略、安全 Cookie、HSTS 和 `X-Frame-Options`。上线验收脚本
会以阻断式门禁执行这些检查及 `manage.py check --deploy`；本地开发仍保留 HTTP、调试模式
和非 secure cookie 的默认体验。生产入口的 HTTPS 终止与 `X-Forwarded-Proto` 约定见
[docs/INSTALL_VM.md](docs/INSTALL_VM.md)。

如果是在 Rocky 9 上部署开发环境，请显式设置 `DJANGO_ENV=development`；此模式允许
`DJANGO_ALLOWED_HOSTS=*`，并跳过仅面向生产的安全门禁。

从 macOS 更新虚拟机可使用：

```bash
./deploy-to-remote.sh <ssh-target> [remote-source-dir]
```

例如：

```bash
./deploy-to-remote.sh root@rocky-host
./deploy-to-remote.sh deploy@server-host /opt/itam-src
```

该脚本只同步源码，不同步数据库、虚拟环境、依赖目录和构建产物。
