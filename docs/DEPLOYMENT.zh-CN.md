# Infrix 中文部署文档

本文档面向 Infrix 管理员，说明 Rocky Linux 9 自动部署、手工部署、生产配置、LDAP、升级、备份、日常运维和故障排查。

## 1. 部署架构

推荐的生产链路：

```text
用户浏览器 → HTTPS 网关 → Nginx:80 → Gunicorn:127.0.0.1:8001 → MariaDB
                         └→ frontend/dist
```

外部 HTTPS 网关负责终止公网 TLS，并向 Nginx 传递唯一可信的
`X-Forwarded-Proto`。内部 Nginx、Gunicorn 和数据库端口不应直接暴露给不可信客户端。

自动安装脚本支持 Rocky Linux 9.x。其他 Linux 发行版请参阅[手工部署文档](MANUAL_DEPLOYMENT.md)。

## v0.1 数据库基线

`v0.1.0` 使用干净的全新安装迁移基线。由基线前迁移历史创建的开发数据库，必须为 v0.1 基线重建，不能原地升级。该说明仅适用于发布前开发数据；不得重建生产数据库，未来 `v0.1.x` 生产升级必须提供明确的增量迁移。

## 2. 部署前准备

目标主机应满足：

- Rocky Linux 9.x，具备 root 权限或可执行安装所需 sudo 命令的账号。
- 可以访问系统软件仓库以及 Python/npm 包源。
- 已准备完整源码，至少包含 `backend/manage.py`、`backend/requirements.txt`、
  `frontend/package.json` 和 `frontend/package-lock.json`。
- Python 3.10+、Node.js 18+ 和 npm，或允许安装脚本安装这些依赖。
- 已配置主机名、DNS、默认路由和时间同步。
- 已准备生产域名、TLS 证书和 HTTPS 网关。
- 应用使用非 root 账号运行，推荐使用 `infrix`。

数据库要求：

- 使用 MariaDB 或兼容 MySQL。
- 为 Infrix 创建独立数据库和专用账号。
- 数据库使用 `utf8mb4` 和兼容排序规则，例如 `utf8mb4_unicode_ci`。
- 本机数据库只监听本地受保护地址；外部数据库通过授权和网络策略限制来源。
- 数据库账号具备 Django 迁移所需的表和索引创建、修改权限。

## 3. 获取和同步源码

### 3.1 在主机准备源码

可以将源码包放入临时目录，或从代码仓库复制到目标主机：

```bash
sudo -i
dnf install -y git
git clone <repository-url> /tmp/infrix-src
cd /tmp/infrix-src
```

源码目录至少应包含：

```text
backend/manage.py
backend/requirements.txt
frontend/package.json
frontend/package-lock.json
scripts/check-production-config.py
deploy/install.sh
```

不要把 `/etc/infrix/infrix.env`、数据库、密码、密钥、备份或运行时数据放入源码目录。

### 3.2 远程同步助手

从管理终端同步到远程主机：

```bash
./deploy-to-remote.sh <ssh-target> [remote-source-dir]
```

`<ssh-target>` 可以是 `user@hostname` 或 SSH 配置中的主机别名。
默认远程 staging 目录为 `/tmp/infrix-src`；自定义目录必须由 SSH 账号直接写入。
安装阶段会通过 sudo 将应用部署到 `/opt/infrix`。

不要使用 SSH 账号无写权限的系统目录作为同步目录，否则 rsync 会因权限不足失败。

## 4. 生产配置

生产环境文件默认位于 `/etc/infrix/infrix.env`。下面是配置模板，执行前请替换所有占位符：

```dotenv
DJANGO_ENV=production
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<随机密钥，至少 50 个字符>
DJANGO_ALLOWED_HOSTS=<hostname>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<hostname>
DJANGO_HTTPS_MODE=proxy
DJANGO_SECURE_SSL_REDIRECT=1
DJANGO_SESSION_COOKIE_SECURE=1
DJANGO_CSRF_COOKIE_SECURE=1
DJANGO_SECURE_HSTS_SECONDS=3600
DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=0
DJANGO_SECURE_HSTS_PRELOAD=0
DJANGO_USE_X_FORWARDED_HOST=0
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<数据库密码>
DB_HOST=<database-host>
DB_PORT=3306
INFRIX_CONFIG_ENCRYPTION_KEY=<Fernet 密钥>
```

使用随机且足够长度的 `DJANGO_SECRET_KEY`。新安装在确认数据库为空后可以生成该密钥；已有部署必须保留原密钥。

创建并保护环境文件目录：

```bash
sudo install -d -o root -g infrix -m 750 /etc/infrix
sudo touch /etc/infrix/infrix.env
sudo chown root:infrix /etc/infrix/infrix.env
sudo chmod 640 /etc/infrix/infrix.env
```

不要在日志、共享终端或进程列表中输出环境文件内容。

## 5. MariaDB / MySQL

### 5.1 本机数据库

自动安装脚本可以安装并启动 MariaDB，创建 `infrix` 数据库和专用账号，并将本机数据库限制在受保护的本地监听地址。

检查数据库字符集和监听：

```bash
sudo mariadb -NBe 'USE infrix; SELECT DATABASE(), @@character_set_database, @@collation_database;'
ss -lnt | grep ':3306 '
```

### 5.2 外部数据库

先在数据库服务器创建数据库和专用账号，再在应用主机配置：

```bash
export SKIP_MARIADB=1
export DB_ENGINE=mysql
export DB_NAME=infrix
export DB_USER=infrix
export DB_HOST='<database-host>'
export DB_PORT=3306
export DB_PASSWORD='<数据库密码>'
sudo -E ./deploy/install.sh
```

外部数据库必须通过数据库授权、防火墙和网络策略限制来源，不能向不可信客户端开放 3306。

## 6. 执行安装和升级

### 6.1 安装前配置检查

已有环境文件可以先执行只读配置检查：

```bash
ENV_FILE=/etc/infrix/infrix.env ./deploy/install.sh --preflight
```

该命令只检查生产配置，不修改系统或数据库。发现错误时先修正配置，再继续安装。

### 6.2 新部署

在源码根目录执行：

```bash
chmod +x deploy/install.sh
sudo -E ./deploy/install.sh
```

默认 `INSTALL_MODE=auto` 会根据目标主机是否已有服务、虚拟环境、数据库或环境文件选择安装或升级。
需要明确指定新部署时：

```bash
export INSTALL_MODE=fresh
sudo -E ./deploy/install.sh
```

安装脚本会安装系统依赖，创建 `infrix` 运行账号和 `/opt/infrix`，准备 Python 环境，初始化数据库，执行迁移，构建前端，收集静态文件，并配置 systemd 与 Nginx。

新部署的应用侧流程包括：准备源码，配置生产环境，确认 MariaDB 目标库为空，安装 Python/后端依赖，执行 `npm ci` 和前端构建，执行 `migrate`，再执行 `check_preset_roles`。后者会调用 `initialize_system_data` 并校验四个预设角色；随后安装脚本收集静态文件，写入 Gunicorn、systemd 和 Nginx 配置并启动服务。启动后再创建首个管理员。SMTP 和 LDAP 都是可选项，分别在“系统设置 → SMTP”和“组织权限 → LDAP / AD”中配置。

安装脚本还会创建并启用每日站内提醒邮件摘要定时器。它以非 root 的 `infrix` 账号运行，每天约在主机 systemd 时区的 09:00 执行；未启用邮件摘要或没有相关提醒时不会发送邮件。

### 6.3 已有部署升级

```bash
export INSTALL_MODE=upgrade
sudo -E ./deploy/install.sh
```

升级会保留 `/etc/infrix/infrix.env` 和业务数据库，在迁移前创建受限数据库备份，然后更新文件、重建前端并重启服务。

## 7. 首次登录和 LDAP

### 7.1 创建管理员

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

常用地址：

- 应用：`https://<hostname>/`
- 管理后台：`https://<hostname>/admin/`
- API 文档：`https://<hostname>/api/docs/`

首次登录后，按页面提示完成密码变更，先建立组织和位置数据，再录入资产并配置权限。

SMTP 不配置也不会阻止应用启动。需要邮件功能时，在“系统设置 → SMTP”中保存并测试；如需每日摘要，再在“系统设置 → 通知”中明确启用、配置收件人，并填写邮件链接使用的公网 HTTPS 地址。

### 7.2 LDAP / Active Directory

管理员在“组织权限 → LDAP / AD”页面配置目录服务。配置目录类型、服务器地址、端口、安全模式、Base DN、用户搜索 Base、登录属性、绑定账号和绑定密码。

保存绑定密码前必须在环境文件中配置 `INFRIX_CONFIG_ENCRYPTION_KEY`。该密钥用于加密数据库中的 LDAP 绑定密码，必须和环境文件一起备份。

生产环境优先使用 LDAPS 或 StartTLS。运行连接诊断时使用当前草稿，不会自动保存或启用 LDAP；确认连接正常后保存配置，再按需启用 LDAP 登录。

## 8. 服务和反向代理检查

检查服务状态：

```bash
sudo systemctl is-enabled infrix nginx mariadb infrix-notification-digest.timer
sudo systemctl is-active infrix nginx mariadb
sudo nginx -t
```

检查应用和 API：

```bash
curl -fsS https://<hostname>/
curl -fsS https://<hostname>/api/v1/auth/csrf/
sudo journalctl -u infrix -n 100 --no-pager
```

参考监听边界：

- Nginx：由 HTTPS 网关保护的内部 80 端口。
- Gunicorn：`127.0.0.1:8001` 或其他受保护的内部接口。
- MariaDB：本机模式使用受保护的本地监听地址。

## 9. 部署后健康检查

检查内容包括服务状态、环境文件绑定、生产安全配置、迁移、业务数据表、静态文件和 HTTP 接口。

## 10. 备份和恢复

定期备份 Infrix 数据库和 `/etc/infrix/infrix.env`，尤其要保护 `DJANGO_SECRET_KEY` 和 `INFRIX_CONFIG_ENCRYPTION_KEY`。数据库备份也会保留系统设置和已上传的品牌图片。
备份目录建议使用 700 权限，数据库备份文件建议使用 600 权限。

MariaDB 备份示例：

```bash
sudo mariadb-dump --protocol=socket -uroot --single-transaction --quick --triggers --hex-blob infrix > /var/backups/infrix/database-backup.sql
sudo chmod 600 /var/backups/infrix/database-backup.sql
```

恢复前停止应用，确认数据库、备份来源和密钥版本；恢复后执行迁移检查、服务检查和管理员登录。

## 11. 日常运维

```bash
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -n 100 --no-pager
sudo journalctl -u infrix -f
```

升级前确认数据库备份可读取。不要删除已经应用的 Django 迁移文件，也不要用放宽目录权限的方式处理服务故障。

## 12. 常见故障排查

### rsync 无法创建源码目录

如果出现权限不足，请使用默认的 `/tmp/infrix-src`，或传入 SSH 账号拥有写权限的目录：

```bash
./deploy-to-remote.sh <ssh-target> /tmp/infrix-src
```

不要为写入源码 staging 目录而放宽 `/opt` 的整体权限。

### 应用服务无法启动

```bash
sudo systemctl status infrix --no-pager
sudo journalctl -u infrix -n 100 --no-pager
```

检查环境文件路径、文件权限、数据库连接、虚拟环境、迁移状态和端口冲突。

### 数据库拒绝连接

检查环境文件中的 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` 和 `DB_PASSWORD`，确认数据库授权允许应用主机连接，并具备迁移所需权限。

### 迁移无法完成

新部署应确认数据库为空；升级应确认备份存在，并确认数据库已有迁移记录对应的文件仍在源码中。然后执行：

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh migrate --noinput
sudo -u infrix ./run.sh showmigrations assets
```

### 前端显示旧内容或无法访问

```bash
[ -s /opt/infrix/frontend/dist/index.html ]
sudo nginx -t && sudo systemctl reload nginx
```

随后刷新浏览器，并检查应用日志。

### Nginx 返回 400 或反复重定向

检查冲突的 Nginx server block，确认访问主机名在 `DJANGO_ALLOWED_HOSTS` 中，并确认 HTTPS 网关只传递一个可信的 `X-Forwarded-Proto` 值。内部 Nginx 监听不应被公网直接访问。

## 13. 生产安全清单

- 使用 `DJANGO_ENV=production` 和 `DJANGO_DEBUG=0`。
- 使用 HTTPS、secure session cookie、secure CSRF cookie 和明确的 CSRF trusted origins。
- `/etc/infrix/infrix.env` 使用 `root:infrix` 所有者和 640 权限。
- Gunicorn 和本机 MariaDB 只监听受保护的内部地址。
- 主机防火墙和安全组只放行必要入口。
- 保持 SELinux 启用，仅授予反向代理连接 Gunicorn 所需权限。
- 定期备份数据库、环境文件和 LDAP 加密密钥。
- 妥善保护数据库密码、证书私钥、日志和备份文件。
