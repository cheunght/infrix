# Infrix 安装流程说明

本文档补充[Rocky Linux 安装文档](DEPLOYMENT.zh-CN.md)中的命令，说明安装器的实际行为。英文版本见[Installer Workflow](INSTALLER_WORKFLOW.md)。

## 首次安装

自动安装支持 Rocky Linux 9.x。在项目根目录或解压后的发布包目录执行：

```bash
sudo bash deploy/install.sh
```

目标是全新安装且没有提供 `DJANGO_ENV` 时，交互式向导会询问：

1. 不带协议和端口的访问 IP 或域名。
2. 使用本机 MariaDB，还是使用已有的外部 MariaDB。
3. 使用已有证书、生成本机自签名证书，还是使用外部 HTTPS 网关。

向导会把配置保存到 `/etc/infrix/infrix.env`，所有者为 `root:infrix`，权限为 `640`。需要时会生成 Django 密钥、稳定的 Fernet 密钥和本机数据库密码。升级时不会替换已有环境文件。

交互式安装在服务启动后会检查是否已有启用的管理员；没有管理员时会打开 `createsuperuser` 输入提示。非交互安装会打印创建管理员的命令：

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

全新安装要求目标数据库为空。正式安装还会自动检查主机：提示系统时间是否同步，要求 `/var/tmp` 至少有 2 GiB 可用空间，并拒绝 80、443 或 8001 端口被其他程序占用的情况。

## 配置和非交互安装

字段说明以仓库中的 [`deploy/infrix.env.example`](../deploy/infrix.env.example) 为准。填写完成的真实文件应放在源码目录之外。使用其他路径时必须显式传入绝对路径：

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env
```

非交互首次安装前，应准备完整的生产环境文件，至少包含生产 Django 配置、明确的主机和 HTTPS CSRF 来源以及 MySQL 连接字段。如果使用 LDAP/AD 或其他受保护配置，再加入 `INFRIX_CONFIG_ENCRYPTION_KEY`。安装器只有在确认是全新且为空的数据库时才可能生成缺失的密钥；升级不能依赖这个行为。

`INFRIX_CONFIG_ENCRYPTION_KEY` 是 URL-safe Fernet 密钥，用于加密数据库中保存的 LDAP/AD 以及其他受保护配置。该密钥必须只生成一次，与环境文件和数据库备份一起保存：

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

只读配置检查命令：

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

`--preflight` 只读取并校验环境文件，不安装软件包、不修改服务、不写数据库，也不修改 Nginx。磁盘空间、端口和证书等更完整的主机检查，会在正常安装过程中自动执行。

## 远程部署

远程助手会把项目源码同步到 SSH 账号可写的 staging 目录，再在远程主机上通过 `sudo` 调用安装器：

```bash
./deploy-to-remote.sh <ssh-target>
./deploy-to-remote.sh --config /etc/infrix/infrix.env <ssh-target>
./deploy-to-remote.sh --non-interactive \
  --config /etc/infrix/infrix.env <ssh-target>
```

`--config` 指的是远程服务器上的文件，不会从本地上传。交互模式会分配终端，以便向导和密码输入使用；非交互模式要求免密码 sudo 和完整的远程环境文件。默认 staging 目录为 `/tmp/infrix-src`。

## 重试和升级行为

全新安装期间，安装器会在 `${ENV_FILE}.install-state` 记录 `configured`、`database-ready` 和 `complete` 阶段。状态文件包含环境文件和 `APP_DIR` 的指纹。进程中断后，应使用相同源码、配置和命令重新执行；已生成的密钥会被复用。只要环境文件或应用目录发生变化，安装器就会停止，避免误用错误数据库。

已有部署时，`INSTALL_MODE=auto` 会识别运行环境并执行原地升级，也可以显式指定：

```bash
sudo env INSTALL_MODE=upgrade bash deploy/install.sh
```

升级会保留环境文件和业务数据，先确认已有迁移文件与新源码兼容，在 `/var/backups/infrix` 创建受限数据库备份，然后在停止现有应用前准备 Python wheel 和前端产物。准备失败时旧应用保持可用。应用文件或数据库已经修改后，恢复应按备份执行；安装器不会自动回滚数据库迁移。

替换 Nginx 配置前，原配置会复制到 `/var/backups/infrix`。如果 `nginx -t` 失败，会恢复原文件且不会 reload Nginx。失败的 `/var/tmp/infrix-prepare.*` 准备目录会保留用于排障，问题处理完后可由管理员清理。

## 发布安装包

在具备 Git、Python 3、Node.js 和 npm 的开发机上构建：

```bash
python3 scripts/release-package.py \
  --output /tmp/infrix-release.tar.gz
```

构建器会执行 `npm ci` 和前端构建，将源码、`frontend/dist` 及校验清单一起打包。目标主机安装时会校验清单，因此不需要安装 Node.js，也不需要重新构建前端：

```bash
mkdir /tmp/infrix-release
tar -xzf /tmp/infrix-release.tar.gz -C /tmp/infrix-release
cd /tmp/infrix-release
sudo bash deploy/install.sh
```

这不是完整离线安装包：Rocky 软件包和 Python 依赖仍需来自配置的软件源或本地缓存。构建后不要修改 `frontend/dist`，校验清单用于发现不完整或被篡改的发布包。

## HTTPS 验收和诊断

安装器启动服务后会验证真实 HTTPS 入口。检查要求 TLS 成功、HTTP 200、`/` 和 `/assets` 返回有效 SPA 页面，以及 CSRF 和品牌接口返回有效内容。重定向、证书错误、连接拒绝或 CSRF 接口返回 HTML 错误页都会判定失败。

后续可单独运行只读诊断：

```bash
bash deploy/doctor.sh https://infrix.example.com
```

使用自签名证书时，把证书作为本地 CA 文件传入：

```bash
bash deploy/doctor.sh \
  https://192.0.2.10 \
  /etc/pki/tls/certs/infrix.crt
```

本机 Nginx TLS 使用 `TLS_MODE=self-signed`；已有证书/私钥使用 `TLS_MODE=certificate`；由可信外部网关终止 TLS 时使用 `TLS_MODE=gateway`。当前 Nginx 部署仍要求 `DJANGO_HTTPS_MODE=proxy`；网关模式下必须由网关覆盖并统一设置唯一可信的 `X-Forwarded-Proto`。

## 管理员验收清单

安装成功后检查：

- 适用的 `infrix`、`nginx`、`mariadb` 服务均为 active。
- `nginx -t` 成功，配置的 HTTPS 地址通过 `doctor.sh`。
- `/etc/infrix/infrix.env` 仍为 `root:infrix`、权限 `640`。
- 管理员可以登录，并按要求完成密码变更。
- 数据库备份和包含 Fernet 密钥的环境文件已按恢复策略保存。

数据库、LDAP、SMTP、反向代理、备份和生产安全的详细操作，请继续阅读本中文安装文档或[中文手工部署文档](MANUAL_DEPLOYMENT.zh-CN.md)。
