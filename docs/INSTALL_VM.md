# Rocky Linux 9 安装与更新说明

本文适用于将 Infrix 部署到 Rocky Linux 9 虚拟机。安装脚本会安装 Python、Node.js、Nginx、MariaDB、Gunicorn，创建 systemd 服务，并构建 Vue 前端。

仓库只保存源码、迁移、配置示例和必要资源，不保存 SQLite、MySQL 数据、账号、密钥、虚拟环境或前端依赖。私有 GitHub 仓库拉取后，需要按本文重新创建环境。

脚本不会修改 SELinux 和防火墙配置；本说明假设这两项已经按现场要求关闭或由现场统一管理。

## 上线前必读

- 安装或更新脚本会在执行迁移前自动备份 MySQL 数据库；备份失败会立即停止部署。
- 升级后自动建立四个预设角色：系统管理员、资产管理员、维修人员、只读审计员。预设角色不能重命名或删除。
- 现有超级管理员归入系统管理员；其他现有账号默认归入只读审计员。上线后请由系统管理员逐一核对账号角色。
- 机房和机柜必须先在“机房资源 / 机房维护”中建立。资产录入和 CSV 导入不会再自动创建位置基础数据。
- 更新完成后脚本会执行迁移、预设角色检查、Django 部署检查及 HTTP 健康检查。
- 迁移前后会输出资产、故障、维修、许可证和机柜数量；迁移失败时会打印备份文件及恢复命令示例。

## 一、准备条件

- Rocky Linux 9，使用 root 或具有 sudo 权限的账号。
- 虚拟机可以访问 Rocky Linux 软件源和 npm/Python 包源。
- 服务器使用 TCP 80；如由其他网关提供 HTTPS，只需要把网关转发到本机 80 端口。
- 项目源码完整，至少包含 `backend/manage.py`、`backend/requirements.txt`、`frontend/package.json` 和 `frontend/package-lock.json`。

## 二、上传或获取源码

使用 Git 获取源码：

```bash
sudo -i
dnf install -y git
git clone <仓库地址> /tmp/itam-src
cd /tmp/itam-src
```

如果源码已经上传到服务器，直接进入项目根目录即可：

```bash
cd /tmp/itam-src
```

不要把 `/etc/itam/itam.env` 放进源码目录，也不要把数据库文件提交到 Git。

## 三、首次安装

### 1. 设置部署参数

最小配置如下。`DJANGO_ALLOWED_HOSTS=*` 表示允许所有 Host，适合内网 IP 访问；如果有固定域名，建议改成具体域名或 IP。

```bash
export SERVER_NAME=_
export DJANGO_ALLOWED_HOSTS='*'
export DB_NAME=itam
export DB_USER=itam
export DB_PASSWORD='请替换为数据库密码'
```

可选参数：

```bash
export APP_DIR=/opt/itam
export APP_USER=itam
export BACKUP_DIR=/var/backups/itam
export GUNICORN_WORKERS=3
```

### 2. 执行安装

```bash
chmod +x deploy/install.sh
sudo -E ./deploy/install.sh
```

安装脚本按以下顺序执行：

1. 检查 Rocky Linux 9 和项目文件。
2. 安装系统依赖。
3. 创建 `itam` 系统用户和 `/opt/itam` 应用目录。
4. 创建 `/etc/itam/itam.env`，已有文件不会覆盖。
5. 启动 MariaDB，创建数据库和数据库用户。
6. 在迁移前将数据库备份到 `/var/backups/itam/`。
7. 创建 `backend/.venv`，安装 Django 和 Gunicorn。
8. 执行数据库迁移、Django 检查和静态文件收集。
9. 执行 `npm ci` 和 `npm run build`。
10. 写入 `itam.service` 和 Nginx 配置并执行健康检查。

服务启动和 HTTP 健康检查会自动重试；若仍失败，脚本会输出 `systemctl status`
和最近的 Gunicorn 日志，便于直接定位数据库、迁移或环境变量问题。

如果 Rocky 9 自带的 `/etc/nginx/conf.d/default.conf` 与 Infrix 都使用
`server_name _`，脚本会先将该默认配置备份到 `BACKUP_DIR`，再停用它，避免
Nginx 将请求转到默认站点。备份文件可以在需要时手工恢复。

安装完成后，脚本会显示访问地址和环境文件位置。

## 四、使用外部 MariaDB

如果数据库不在本机，提前在数据库服务器创建数据库和用户，然后设置：

```bash
export SKIP_MARIADB=1
export DB_HOST=192.168.1.20
export DB_PORT=3306
export DB_NAME=itam
export DB_USER=itam
export DB_PASSWORD='数据库密码'
sudo -E ./deploy/install.sh
```

外部数据库必须允许应用服务器访问，并授予 `itam` 用户对 `itam` 数据库的建表、修改表和索引权限。脚本仍会在迁移前尝试备份外部数据库；如果备份权限不足，脚本会停止，不会继续迁移。

## 五、创建管理员和访问系统

不要使用系统 Python 直接执行 `python manage.py`。生产环境统一使用 `run.sh`，它会自动加载 `/etc/itam/itam.env`：

```bash
cd /opt/itam/backend
sudo -u itam ./run.sh createsuperuser
```

访问地址：

- 首页：`http://服务器IP/`
- 管理后台：`http://服务器IP/admin/`
- API 文档：`http://服务器IP/api/docs/`

## 六、安装后检查

```bash
systemctl status itam --no-pager
systemctl status nginx --no-pager
systemctl status mariadb --no-pager

curl -fsS http://127.0.0.1:8001/api/v1/auth/csrf/
curl -fsS http://127.0.0.1/api/v1/auth/csrf/

journalctl -u itam -n 100 --no-pager
cd /opt/itam/backend
sudo -u itam ./run.sh showmigrations assets
```

### 一键上线验收

安装或更新完成后，可以使用只读验收脚本复核服务、迁移、核心数据表、机柜 U 位、静态资源和反向代理：

```bash
cd /opt/itam
chmod +x deploy/verify-release.sh
sudo APP_DIR=/opt/itam APP_USER=itam BASE_URL=http://127.0.0.1 \
  ./deploy/verify-release.sh
```

验收脚本不会修改数据库。它会检查：

- `itam` 和 Nginx 服务是否运行。
- Django 配置、预设角色和模型迁移是否完整。
- 资产、数据中心、机房、机柜、故障、维修、许可证、盘点、备件、自定义字段、标签和审计表是否存在，并输出数量。
- 机柜上架记录是否存在 U 位越界或重叠。
- 前端 `index.html`、`platform-icon.png` 和 `/api/v1/auth/csrf/` 是否可访问。

如果验收失败，脚本会输出 Gunicorn 状态和最近日志。迁移失败时仍以安装脚本打印的迁移前数据库备份为准进行恢复。

如果 API 健康检查失败，先查看：

```bash
journalctl -u itam -f
```

安装脚本在健康检查失败时还会自动输出 `systemctl status itam` 和最近的
Gunicorn 日志。若 `127.0.0.1:8001` 连接被拒绝，说明 Gunicorn 进程没有保持运行，
优先检查数据库连接、环境文件权限和迁移错误；若 Nginx 返回 400，检查是否仍有
其他配置声明了冲突的 `server_name _`。

常见原因是数据库密码错误、迁移未完成或 `/etc/itam/itam.env` 没有被服务读取。

## 七、更新版本

### 1. 备份环境文件

安装脚本会自动在迁移前备份 MariaDB，但更新前仍建议单独备份环境文件：

```bash
mkdir -p /var/backups/itam
cp -a /etc/itam/itam.env \
  /var/backups/itam/itam.env-$(date +%F-%H%M%S)
```

### 2. 更新源码并重新部署

```bash
cd /tmp/itam-src
git pull
sudo -E ./deploy/install.sh
```

如果源码不是 Git 仓库，上传新版本覆盖源码目录后执行同样的安装命令。不要覆盖 `/etc/itam/itam.env`。

脚本会保留虚拟环境、数据库和环境文件，重新安装依赖、执行迁移、构建前端并重启服务。数据库迁移失败时，先查看迁移前备份和服务日志，不要反复删除数据库。

从私有 GitHub 仓库更新时，确认服务器已经配置 GitHub SSH key 或凭据，并检查当前仓库没有本地未提交修改：

```bash
git status --short
git pull --ff-only
sudo -E ./deploy/install.sh
```

如果 `git pull --ff-only` 因本地修改停止，请先备份现场文件，不要直接覆盖生产目录。

### 3. 更新后确认

```bash
systemctl status itam --no-pager
curl -fsS http://127.0.0.1/api/v1/auth/csrf/
cd /opt/itam/backend
sudo -u itam ./run.sh showmigrations assets
```

## 八、手工备份与恢复

备份：

```bash
mkdir -p /var/backups/itam
MYSQL_PWD='数据库密码' mariadb-dump \
  -h 127.0.0.1 -P 3306 -u itam \
  --single-transaction --routines --events itam \
  > /var/backups/itam/itam-$(date +%F-%H%M%S).sql
chmod 600 /var/backups/itam/*.sql
```

恢复前停止应用：

```bash
systemctl stop itam
MYSQL_PWD='数据库密码' mariadb -h 127.0.0.1 -P 3306 -u itam itam \
  < /var/backups/itam/itam-YYYY-MM-DD-HHMMSS.sql
systemctl start itam
```

## 九、常见问题

### `ModuleNotFoundError: No module named 'django'`

不要使用系统 Python。执行：

```bash
cd /opt/itam/backend
sudo -u itam ./run.sh check
```

如果虚拟环境损坏，可重新运行安装脚本；脚本会按需重建 `backend/.venv`。

### 数据库 `Access denied for user 'itam'`

检查 `/etc/itam/itam.env` 中的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` 和 `DB_PASSWORD`，然后确认数据库用户已授权。修改环境文件后重启：

```bash
systemctl restart itam
```

### 迁移提示有未应用迁移

```bash
cd /opt/itam/backend
sudo -u itam ./run.sh migrate --noinput
sudo -u itam ./run.sh showmigrations assets
systemctl restart itam
```

### 页面更新后仍显示旧版本

浏览器执行强制刷新；确认前端构建成功，并检查：

```bash
ls -l /opt/itam/frontend/dist/index.html
journalctl -u itam -n 50 --no-pager
```

## 十、安全提示

- `/etc/itam/itam.env` 权限应保持为 `640`，属主为 `root:itam`。
- 生产环境保持 `DJANGO_DEBUG=0`。
- 数据库密码不要提交到 Git 或聊天记录。
- SELinux 和防火墙由现场策略管理，本脚本不会修改它们。
- 正式上线前请补充 HTTPS、账号最小权限、定期备份和恢复演练。
