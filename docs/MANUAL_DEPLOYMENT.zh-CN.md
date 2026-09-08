# 手工部署

本文档说明不依赖特定发行版的 Infrix 生产部署，覆盖运行环境、数据库、环境文件、进程管理、反向代理、LDAP、升级、备份和日常运维。英文版本见[Manual Deployment](MANUAL_DEPLOYMENT.md)。

Rocky Linux 9.x 新部署优先使用[中文自动安装文档](DEPLOYMENT.zh-CN.md)和[中文安装流程说明](INSTALLER_WORKFLOW.zh-CN.md)。当操作系统或服务布局由管理员手工管理时，再使用本文档。

## v0.1 迁移基线

`v0.1.0` 源码使用干净的全新安装迁移基线。由基线前迁移历史创建的发布前开发数据库，必须按 v0.1 基线重建，不能原地升级。该规则不授权重建生产数据；未来 `v0.1.x` 必须为已有生产数据库提供明确的增量迁移。

## 1. 生产架构

参考部署由以下组件组成：

- Python 3.10+ 和独立虚拟环境。
- MariaDB 或兼容的 MySQL 服务器。
- 提供 Django 应用的 Gunicorn。
- 提供前端并转发后端请求的 Nginx。
- 管理应用进程的 systemd。
- HTTPS 网关或支持 TLS 的反向代理。

只要具备相同的安全边界和运行能力，也可以使用等效组件。部署必须满足：

- 应用以非 root 账号运行，并提供 `config.wsgi:application`。
- 进程由可靠的服务管理器监管，能够受控重启并处理失败。
- 反向代理提供前端并路由后端请求。
- 生产流量使用 HTTPS；TLS 在上游终止时必须有可信代理边界。
- 新安装使用空数据库，原地升级前必须有可验证的备份。
- 密钥、数据库凭据、备份和生成文件使用受限权限。

## 2. 运行环境要求

### Python

使用 Python 3.10 或更高版本，为 Infrix 建立独立虚拟环境：

```bash
python3 -m venv /opt/infrix/backend/.venv
/opt/infrix/backend/.venv/bin/python -m pip install -r /opt/infrix/backend/requirements.txt
```

不要把应用依赖安装到系统 Python，也不要执行 `sudo pip install`。

### Node.js 和 npm

从源码构建前端需要 Node.js 18+ 和 npm：

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
```

构建产物为 `frontend/dist`，由反向代理提供。使用包含预构建前端的发布包时，目标主机不需要 Node.js/npm。

### 系统能力

准备进程和文件系统管理、TCP 网络、DNS、Python 虚拟环境、兼容的 MariaDB/MySQL 客户端，以及目标发行版所需的系统库。

## 3. 数据库要求

生产使用 `DB_ENGINE=mysql`。MariaDB 或兼容 MySQL 服务器应提供：

- 独立的 Infrix 数据库。
- 独立的应用账号，不要使用数据库 root 运行应用。
- 受数据库授权和网络策略保护的主机与端口。
- `utf8mb4` 和兼容排序规则，例如 `utf8mb4_unicode_ci`。
- 普通读写以及 Django 表和索引迁移所需权限。
- 可用于备份的 `mariadb-dump` 兼容客户端。

如果数据库独立于应用主机，可按数据库管理员策略创建数据库和账号。下面只展示关系：

```sql
CREATE DATABASE infrix
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'infrix'@'application-host' IDENTIFIED BY '<database-password>';

GRANT ALL PRIVILEGES ON infrix.* TO 'infrix'@'application-host';
FLUSH PRIVILEGES;
```

数据库管理凭据应与 `DB_USER`、`DB_PASSWORD` 分离。使用服务相同的值测试连接：

```bash
MYSQL_PWD='<database-password>' mariadb \
  --protocol=tcp -h <database-host> -P 3306 -u infrix infrix \
  -e 'SELECT 1;'
```

不要在日志、共享进程列表或共享终端中暴露数据库密码。

## 4. 文件系统和权限

下表是随附服务布局的参考路径；手工部署可以使用其他路径，但必须同步修改所有服务引用：

| 用途 | 参考路径 | 要求 |
| --- | --- | --- |
| 应用源码 | `/opt/infrix` | 应用账号可读取。 |
| 环境文件 | `/etc/infrix/infrix.env` | `root:infrix` 所有者，权限 `640`。 |
| 备份目录 | `/var/backups/infrix` | 受限目录，建议 `700`。 |
| 数据库备份 | `/var/backups/infrix/*.sql` | 受限文件，建议 `600`。 |
| 前端构建产物 | `/opt/infrix/frontend/dist` | 反向代理账号可读取。 |
| Django 静态文件 | `/opt/infrix/backend/staticfiles` | 服务启动前完成收集。 |

使用专用非 root 应用账号，例如 `infrix`，只授予运行和部署所需的读写权限。不要使用 `chmod 777`。

## 5. 部署应用源码

将源码放入选定的应用目录，参考布局为：

```text
/opt/infrix/
  backend/
  frontend/
  deploy/
  scripts/
```

源码目录至少应包含 `backend/manage.py`、`backend/requirements.txt`、`frontend/package.json` 和 `frontend/package-lock.json`。不要把 `/etc/infrix/infrix.env`、数据库、密码、密钥、备份或运行时数据放入源码目录。

## 6. 配置生产环境

应用进程使用一份生产环境文件。默认路径为 `/etc/infrix/infrix.env`；如果使用其他路径，必须让进程管理器和 `INFIX_ENV_FILE` 保持一致。字段以仓库的 [`deploy/infrix.env.example`](../deploy/infrix.env.example) 为唯一参考。

创建目录并保护文件：

```bash
install -d -m 750 /etc/infrix
chown root:infrix /etc/infrix
touch /etc/infrix/infrix.env
chmod 640 /etc/infrix/infrix.env
chown root:infrix /etc/infrix/infrix.env
```

生产配置会拒绝短密钥或占位符、通配符主机、非 HTTPS CSRF 来源、不安全 cookie、无效代理设置和不完整 MySQL 字段。不要把真实环境文件放在源码目录中，也不要打印其内容。

`INFRIX_CONFIG_ENCRYPTION_KEY` 用于加密数据库中的 LDAP 绑定密码和其他受保护配置。只生成一次，并与环境文件及数据库备份一起保存：

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

### LDAP / Active Directory

管理员在“组织权限 → LDAP / AD”中配置目录类型、服务器地址、安全模式、Base DN、用户搜索 Base、登录属性、绑定账号和绑定密码。生产环境使用 LDAPS 或 StartTLS。连接诊断使用当前表单，不会保存或启用 LDAP；LDAP 只有在管理员明确启用后才生效。

保存绑定密码前必须确保 `INFRIX_CONFIG_ENCRYPTION_KEY` 可用。密钥丢失后，已保存的绑定密码无法解密。

### SMTP 和通知

SMTP 是可选项，不会阻止应用启动。在“系统设置 → SMTP”中配置并测试；如需每日摘要，在“系统设置 → 通知”中明确启用，配置收件人和邮件链接使用的公网 HTTPS 地址。

## 7. 生产配置检查

启动应用前执行只读配置检查：

```bash
/opt/infrix/backend/.venv/bin/python /opt/infrix/scripts/check-production-config.py \
  --env-file /etc/infrix/infrix.env \
  --require-proxy
```

在迁移、启动服务或对外开放前解决所有错误。不要为了通过检查而打印或放宽密钥权限。

## 8. 初始化数据库和静态文件

新数据库必须确认为空；已有安装在迁移前创建并验证受限数据库备份：

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py initialize_system_data
/opt/infrix/backend/.venv/bin/python manage.py collectstatic --noinput --clear
```

## 9. 应用服务和进程管理

WSGI 入口是 `config.wsgi:application`。参考 Gunicorn 命令：

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/gunicorn \
  config.wsgi:application \
  --bind 127.0.0.1:8001 \
  --workers 3 \
  --timeout 120
```

Gunicorn 必须以专用非 root 账号运行，只绑定 loopback 或其他受保护接口。systemd 单元应使用必需的 `EnvironmentFile=/etc/infrix/infrix.env`，不要使用带前导短横线的可选环境文件形式。

### 每日通知摘要

SMTP 配置完成后，在“系统设置 → 通知”中明确启用每日摘要、填写收件人和公网 HTTPS 地址。摘要以 `infrix` 账号运行，只在启用且有相关提醒时发送。

可以使用以下服务配置：

```ini
[Unit]
Description=Infrix daily notification digest
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=oneshot
User=infrix
Group=infrix
WorkingDirectory=/opt/infrix/backend
EnvironmentFile=/etc/infrix/infrix.env
ExecStart=/opt/infrix/backend/.venv/bin/python manage.py send_notification_digest
PrivateTmp=true
NoNewPrivileges=true
```

使用 systemd timer 调度，并执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infrix-notification-digest.timer
sudo systemctl status infrix-notification-digest.timer --no-pager
```

需要时可手工执行：

```bash
sudo -u infrix /opt/infrix/backend/.venv/bin/python /opt/infrix/backend/manage.py send_notification_digest
```

## 10. 反向代理和 HTTPS

反向代理必须：

- 从 `frontend/dist` 提供前端。
- 从 `backend/staticfiles` 提供 Django 静态文件。
- 将 `/api/` 和 `/admin/` 转发到 Gunicorn。
- 保留经过验证的 Host 和客户端信息。
- 传递唯一可信的 HTTPS 状态。
- 设置适当的请求大小限制，参考值为 `50m`。
- 不允许公网直接访问 Gunicorn。

参考 Nginx 路由：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
}

location /admin/ {
    proxy_pass http://127.0.0.1:8001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
}

location /static/ {
    alias /opt/infrix/backend/staticfiles/;
}

location / {
    try_files $uri /index.html;
}
```

生产流量必须使用 HTTPS。外部网关终止 TLS 时，只有可信网关可以访问内部 Nginx，并且必须覆盖 `X-Forwarded-Proto` 为唯一值。使用本机 Nginx 终止 TLS 时，配置证书和安全请求头，并确保 Django 收到正确的 HTTPS 状态；不要信任任意客户端提交的转发头。

## 11. 安装和升级流程

手工新部署：

1. 准备操作系统、数据库、源码目录和应用账号。
2. 创建受限生产环境文件。
3. 执行生产配置检查。
4. 确认新数据库为空。
5. 创建虚拟环境并安装后端依赖。
6. 构建前端并收集 Django 静态文件。
7. 执行迁移并初始化系统数据。
8. 配置 systemd、Nginx 和 HTTPS。
9. 启动服务并完成健康检查。

原地升级：

1. 将新源码放入 staging 目录，不要覆盖正在运行的目录。
2. 确认环境文件存在且包含原有密钥。
3. 创建并验证受限数据库备份。
4. 停止应用服务后替换源码或执行迁移。
5. 同步源码，安装依赖并重新构建前端。
6. 执行 `manage.py migrate --noinput` 和 `manage.py check`。
7. 启动服务并完成健康检查。

保留所有已经应用的迁移文件。如果数据库有迁移记录但源码缺少对应文件，应先恢复兼容的源码或迁移路径，再修改数据库。

## 12. 部署健康检查

应用正式开放前确认：

- 生产配置检查通过，且没有打印密钥。
- 应用可以连接配置的数据库。
- 迁移已应用，`manage.py check` 成功。
- `frontend/dist/index.html` 和静态文件可读。
- 应用以非 root 账号运行。
- Gunicorn 只绑定受保护接口。
- Nginx 可以提供 SPA、静态文件并转发 API。
- `https://<hostname>/api/v1/auth/csrf/` 可访问。
- 登录、管理后台、API 路由和浏览器刷新正常。
- 防火墙、HTTPS 网关、证书和可信请求头规则正确。

若源码中包含诊断脚本，可运行：

```bash
bash deploy/doctor.sh https://<hostname>
```

该脚本要求真实 HTTPS、HTTP 200、有效 SPA 内容、CSRF token 和品牌接口均正常。

## 13. 备份和日常运维

备份 Infrix 数据库和 `/etc/infrix/infrix.env`，其中包括 LDAP 加密密钥。数据库备份也会保留系统设置和已上传的品牌图片。备份目录应限制访问并保留多代备份。

MariaDB 备份示例：

```bash
sudo bash -c 'f=/var/backups/infrix/database-$(date +%Y%m%d-%H%M%S).sql; mariadb-dump --protocol=socket -uroot --single-transaction --quick --triggers --hex-blob infrix > "$f"; chmod 600 "$f"'
```

常用服务命令：

```bash
sudo systemctl status infrix --no-pager
sudo systemctl status nginx --no-pager
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -n 100 --no-pager
sudo journalctl -u infrix -f
```

升级前确认最新数据库备份可读取。不要删除已经应用的 Django 迁移文件。

## 14. 故障排查

### 配置检查失败

不要打印环境文件。检查 `DJANGO_ENV`、`DJANGO_DEBUG`、`DJANGO_SECRET_KEY`、允许的主机、HTTPS CSRF 来源、cookie、HSTS、代理设置和全部 MySQL 字段。

### 数据库连接失败

核对 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` 和数据库密码，确认账号授权允许应用主机连接，并具备迁移权限。

### 迁移失败

新安装确认数据库为空；升级确认备份存在，且源码包含所有已记录迁移。确认应用账号可以创建和修改表及索引，再执行：

```bash
cd /opt/infrix/backend
/opt/infrix/backend/.venv/bin/python manage.py migrate --noinput
/opt/infrix/backend/.venv/bin/python manage.py showmigrations assets
```

### 前端旧内容或不可访问

重新构建前端，确认 `frontend/dist/index.html` 存在，检查 Nginx 后 reload：

```bash
cd /opt/infrix/frontend
npm ci --no-audit --no-fund
npm run build
[ -s /opt/infrix/frontend/dist/index.html ]
sudo nginx -t && sudo systemctl reload nginx
```

### Nginx 返回 HTTP 400 或反复重定向

检查冲突的 server block，确认主机名在 `DJANGO_ALLOWED_HOSTS` 中，确认 HTTPS 网关只传递一个可信的 `X-Forwarded-Proto`。内部监听不应直接暴露公网。

### 应用服务不可用

检查服务状态和日志，再核对环境文件路径与权限、数据库连接、迁移状态、WSGI 路径、虚拟环境和端口冲突。

## 15. 部署责任

部署管理员仍负责：

- 操作系统软件包、升级和运行环境维护。
- 数据库生命周期、凭据、授权、备份、保留和恢复。
- TLS 证书、续期和 HTTPS 策略。
- 防火墙和云安全组。
- SELinux 策略和主机加固。
- 自定义进程管理器或反向代理。
- 密钥存储和轮换。
- 监控、告警、日志保留和事故响应。

随附自动安装器不会配置云防火墙、证书颁发机构或自定义编排系统等无关基础设施。
