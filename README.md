# INFRIX

INFRIX 是数据中心资产管理平台，后端使用 Python/Django + Django REST Framework，前端使用 Vue 3 + Element Plus。

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

`setup.sh` 会创建虚拟环境、安装依赖并执行迁移。不要使用系统 Python 直接运行 `manage.py`。

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

API 文档：`http://127.0.0.1:8000/api/docs/`

## 当前功能

- 登录、预设角色和后端能力校验
- 资产台账、资产详情、CSV 导入预览、Excel 导出和自定义字段
- 数据中心、机房、机柜、U 位分配、机柜视图和容量统计
- 设备分类、品牌、设备类型、标签和自定义字段管理
- 故障登记、维修闭环、维修记录导出
- 软件许可证管理
- 数据中心设备盘点、历史盘点记录和结果导出
- 备件定义、多地点库存和库存流水
- 操作日志和管理员组织权限
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

从 macOS 更新虚拟机可使用：

```bash
./deploy-to-rocky.sh
```

该脚本只同步源码，不同步数据库、虚拟环境、依赖目录和构建产物。
