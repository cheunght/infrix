# Rocky Linux 9 自动安装和升级

本文档是 Infrix 在 Rocky Linux 9.x 上的中文自动安装主文档。英文版本见[Rocky Linux 安装文档](INSTALL_VM.md)，安装器的重试和发布包行为见[安装流程说明](INSTALLER_WORKFLOW.zh-CN.md)。

自动安装器负责应用运行环境、数据库、前端资源、systemd 服务和 Nginx 入口。其他 Linux 发行版或自定义服务布局请使用[中文手工部署文档](MANUAL_DEPLOYMENT.zh-CN.md)。

## 1. 选择部署方式

| 场景 | 推荐方式 |
| --- | --- |
| Rocky Linux 9.x 新主机 | 执行 `deploy/install.sh`，使用安装向导。 |
| Rocky Linux 9.x 已有 Infrix | 重新执行安装器，进行原地升级。 |
| 预构建发布包 | 解压后执行安装器；目标机不需要 Node.js。 |
| 其他 Linux 发行版 | 参阅[手工部署文档](MANUAL_DEPLOYMENT.zh-CN.md)。 |

参考运行链路：

```text
用户浏览器 → HTTPS 网关或本机 Nginx TLS → Nginx → Gunicorn:127.0.0.1:8001 → MariaDB
                                         └→ frontend/dist
```

外部网关可以终止公网 TLS，再转发到内网 Nginx 的 80 端口。没有外部网关时，可以通过向导生成自签名证书，或提供已有证书，让本机 Nginx 监听 443。不要向不可信客户端暴露 Gunicorn 或 MariaDB。

`v0.1.0` 源码使用干净的全新安装迁移基线。由更早迁移历史创建的发布前开发数据库，必须按该基线重建；生产数据不适用此规则。未来 `v0.1.x` 生产升级必须提供明确的增量迁移。

## 2. 部署前准备

目标主机需要：

- Rocky Linux 9.x，以及 root 权限或可使用 sudo 的账号。
- 可以访问 Rocky 软件源和 Python 包源。
- `/var/tmp` 至少有 2 GiB 可用空间，用于安装准备目录。
- 已同步的系统时间、可用 DNS 和必要的网络路由。
- 80、443、8001 端口未被无关程序占用，或已明确纳入现有部署管理。

源码安装需要完整源码树，至少包含 `backend/manage.py`、`backend/requirements.txt`、`frontend/package.json` 和 `frontend/package-lock.json`。安装器可以从 Rocky 软件源安装 Python 3.10+ 和 Node.js 18+。发布包目标机仍需 Python 和系统软件包，但不需要 Node.js 或 npm。

开始前选择数据库和 HTTPS 方式：

- 本机 MariaDB：允许安装器管理 MariaDB、创建专用数据库账号，并将 3306 限制到 loopback。
- 外部 MariaDB：先创建数据库和账号，再在生产环境文件中设置 `SKIP_MARIADB=1`。
- 本机 TLS：内网部署可以使用自签名证书，也可以提供已有证书和私钥。
- 网关 TLS：在最终 HTTPS 检查前配置可信网关，并由网关覆盖 `X-Forwarded-Proto` 为唯一可信值。

安装器会在系统时间未同步时给出提示。如果软件源或证书验证失败，请先修正主机时间再重试。

## 3. 获取源码或发布包

### 源码目录

将仓库克隆或复制到 staging 目录：

```bash
dnf install -y git
git clone <repository-url> /tmp/infrix-src
cd /tmp/infrix-src
```

### 预构建发布包

按照[安装流程说明](INSTALLER_WORKFLOW.zh-CN.md)在开发机生成发布包，再在目标机解压：

```bash
mkdir /tmp/infrix-release
tar -xzf infrix-release.tar.gz -C /tmp/infrix-release
cd /tmp/infrix-release
```

安装器会校验 `frontend-release.json` 以及 `frontend/dist` 下的文件。打包后不要修改这些文件。

### 远程同步

从管理工作站执行：

```bash
./deploy-to-remote.sh <ssh-target>
```

默认远程 staging 目录为 `/tmp/infrix-src`。自定义目录必须由 SSH 账号直接写入。助手会同步源码，再在远程主机上通过 sudo 调用安装器：

```bash
./deploy-to-remote.sh --config /etc/infrix/infrix.env <ssh-target>
./deploy-to-remote.sh --non-interactive \
  --config /etc/infrix/infrix.env <ssh-target>
```

`--config` 指的是远程服务器上的文件，不会从工作站复制。非交互模式要求免密码 sudo 和完整的环境文件。

## 4. 首次安装

在源码或解压后的发布包目录执行：

```bash
sudo bash deploy/install.sh
```

没有 Infrix 运行环境且没有预先设置 `DJANGO_ENV` 时，向导会询问访问 IP/域名、数据库方式和 HTTPS 方式，然后：

1. 按需生成 Django 密钥和 Fernet 密钥。
2. 选择本机 MariaDB 时生成数据库密码。
3. 以 `root:infrix`、权限 `640` 写入 `/etc/infrix/infrix.env`。
4. 确认目标数据库为空后执行迁移。
5. 安装运行环境、初始化系统数据、配置 systemd/Nginx，并验收 HTTPS 入口。

交互式终端中，安装器会检查是否已有启用的超级管理员；没有时打开管理员创建提示。非交互安装在服务就绪后执行：

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

完成的环境文件、数据库、私钥和备份必须放在源码目录之外。不要把环境文件内容粘贴到日志或共享终端。

## 5. 配置、密钥和 preflight

字段说明以 [`deploy/infrix.env.example`](../deploy/infrix.env.example) 为唯一参考。预配置或非交互安装时传入绝对路径：

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env
```

生产环境必须显式设置 `DJANGO_ENV=production`、非 debug 配置、允许的主机、HTTPS CSRF 来源和 MySQL 连接字段。如果使用 LDAP/AD 或其他受保护配置，应保存稳定的 `INFRIX_CONFIG_ENCRYPTION_KEY`；该 Fernet 密钥用于加密数据库中的受保护内容。只生成一次，并与环境文件和数据库一起备份：

```bash
python3 -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
```

升级时不要重新生成密钥。缺失的 Django 密钥只有在确认目标数据库为空的全新安装中才可以生成；已有生产安装必须保留当前密钥。

只读配置检查：

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

该命令只校验环境文件，不修改软件包、服务、Nginx 或数据库。磁盘空间、端口冲突和证书可读性等主机检查，会在正常安装过程中自动执行。

## 6. 数据库设置

### 本机 MariaDB

向导中的本机数据库选项会安装并启动 MariaDB，创建 `infrix` 数据库和专用应用账号，并验证 MariaDB 只监听 loopback。不需要开放公网数据库端口。

### 外部 MariaDB

先在数据库服务器创建空的 `utf8mb4` 数据库和专用账号，授予 Django 迁移所需的表和索引权限，限制来源网络，然后在应用主机的生产环境文件中配置：

```dotenv
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<database-password>
DB_HOST=<database-host>
DB_PORT=3306
SKIP_MARIADB=1
```

再使用该环境文件执行安装器。安装器会检查连接并执行迁移，不会替你配置外部数据库服务器。不要向不可信客户端开放 3306。

## 7. HTTPS 和访问模式

安装器支持三种 HTTPS 选择：

| 安装器模式 | 行为 |
| --- | --- |
| `TLS_MODE=self-signed` | 没有证书/私钥对时生成本机证书；Nginx 监听 443，并将 80 重定向到 HTTPS。 |
| `TLS_MODE=certificate` | 使用指定的 `TLS_CERT_FILE` 和 `TLS_KEY_FILE`，由本机 Nginx 提供 TLS。 |
| `TLS_MODE=gateway` | 本机不终止 TLS；可信外部网关提供 HTTPS，并访问内网 Nginx 的 80 端口。 |

随附 Nginx 部署的 Django 设置仍使用 `DJANGO_HTTPS_MODE=proxy`。网关模式下只有可信网关可以设置转发协议头；自签名模式下应将生成的证书加入客户端信任，或在诊断时作为 CA 传入，否则浏览器会提示证书不受信任。

安装器启动服务后会执行真实 HTTPS 检查，之后也可以单独执行：

```bash
bash deploy/doctor.sh https://infrix.example.com
```

自签名证书示例：

```bash
bash deploy/doctor.sh \
  https://192.0.2.10 \
  /etc/pki/tls/certs/infrix.crt
```

检查要求 TLS 成功、HTTP 200、`/` 和 `/assets` 返回有效前端内容、CSRF 返回有效 token，以及品牌接口可访问。301、400、连接拒绝、证书错误或 HTML 错误响应都不会被视为健康。

## 8. 升级、重试和备份行为

已有安装时，默认 `INSTALL_MODE=auto` 会识别运行环境并执行原地升级。需要明确指定时：

```bash
sudo env INSTALL_MODE=upgrade bash deploy/install.sh
```

升级会保留 `/etc/infrix/infrix.env` 和业务数据。停止现有应用前，安装器会检查迁移兼容性，在 `/var/backups/infrix` 创建受限数据库备份，下载 Python wheel 并准备前端。停止服务前的准备失败不会影响旧应用继续运行。

全新安装会在 `${ENV_FILE}.install-state` 中记录 `configured`、`database-ready` 和 `complete`。如果中断，使用相同源码、环境文件路径、应用目录和命令重试。安装器会复用已保存密钥；若配置或目录发生变化，会停止而不是冒险连接错误数据库。

替换 Nginx 配置前会创建备份。如果 `nginx -t` 失败，会恢复旧配置且不会 reload Nginx。数据库迁移不会自动回滚；发生实时修改失败时，应使用保留的数据库备份和正常恢复流程。失败的 `/var/tmp/infrix-prepare.*` 目录会保留用于排障。

## 9. 首次登录、健康检查和日常运维

标准访问地址：

- 应用：`https://<hostname>/`
- 管理后台：`https://<hostname>/admin/`
- API 文档：`https://<hostname>/api/docs/`

登录后按提示完成密码变更，建立组织和位置，再配置资产和权限。LDAP/AD 和 SMTP 都是可选集成，基础应用健康后再从管理界面配置。保存 LDAP 或其他受保护密码前，必须确保 Fernet 密钥仍然可用。

### 人员和资产使用人

“组织权限”页签按以下顺序显示：用户账号、人员管理、部门、角色、LDAP / AD。系统会根据当前账号的权限显示可用页签。

“人员管理”维护可以使用资产的人员。人员可以没有系统账号。姓名必填，员工编号可选但必须唯一，还可以填写所属部门、单位、联系方式和启用状态。创建本地账号时可以选择一个尚未关联账号的人员；不选择时，系统会为新账号自动建立人员记录。停用或删除登录账号不会删除人员记录，也不会自动解除该人员名下的资产。

资产可以没有使用人，也只能有一个当前使用人。新建或编辑资产时可以直接选择使用人，也可以在资产详情中执行指定、转交和归还。只有启用中的人员可以被选择。转交只修改使用人并写入使用历史，不会改变资产状态。资产详情中可以查看使用人变化记录。部门属于人员资料，不是资产归属字段。

资产台账支持管理员批量指定或批量转交当前页选中的资产，每批最多 100 项。接口会返回逐项结果；成功项会取消选中，失败项仍保留选中，修正后可以重试。

资产导入支持 `assigned_person_employee_no`、`assigned_person_name`、`assigned_person_department` 和 `assignment_reason`。导入时只匹配已有人员，不会自动创建人员。资产导出会包含使用人姓名、员工编号、部门、单位和联系方式。

部署检查：

```bash
sudo systemctl is-active infrix nginx mariadb
sudo nginx -t
bash deploy/doctor.sh https://<hostname>
sudo journalctl -u infrix -n 100 --no-pager
```

定期备份数据库和 `/etc/infrix/infrix.env`，其中包括 `DJANGO_SECRET_KEY` 和 `INFRIX_CONFIG_ENCRYPTION_KEY`。数据库备份、证书、私钥和日志应按站点恢复策略保护。

## 10. 常见故障和生产安全清单

### 安装器提示缺少 `DJANGO_ENV`

在终端执行安装向导，或通过 `--config` 提供完整生产环境文件。不要将包含真实密钥的文件放入源码目录。不要打印文件内容，使用下面的只读检查：

```bash
sudo bash deploy/install.sh \
  --config /etc/infrix/infrix.env \
  --preflight
```

### 浏览器出现 HTTP 400、连接拒绝或会话初始化失败

检查 `infrix` 和 Nginx 的状态及日志，确认访问地址在 `DJANGO_ALLOWED_HOSTS` 中，并针对准确的 HTTPS 地址运行 `doctor.sh`。网关模式还要确认网关能够访问内网 Nginx，并只设置一个可信的 `X-Forwarded-Proto`。本机 TLS 需要确认证书名称匹配 IP/域名，且客户端信任该证书。

### 数据库或迁移检查失败

核对 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`、数据库授权和网络策略。全新数据库必须为空；升级时必须包含所有已应用迁移文件，并有可读取的升级前备份。不要删除迁移记录或已应用的迁移文件来绕过错误。

### 生产安全清单

- 使用 `DJANGO_ENV=production`、`DJANGO_DEBUG=0`、明确主机和 HTTPS。
- 环境文件保持 `root:infrix` 所有者和 `640` 权限。
- Gunicorn 和本机 MariaDB 只监听受保护接口。
- 保持 SELinux 启用，仅允许 Nginx 到 Gunicorn 所需策略。
- 限制数据库、证书、私钥、日志和备份的访问权限。
- 定期维护并验证数据库和环境文件备份。
