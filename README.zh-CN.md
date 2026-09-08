# Infrix

Infrix 是一个面向企业基础设施团队的 IT 资产管理平台，用于管理资产台账、数据中心位置、机柜、维修、软件许可、盘点、备件和审计记录。

## 文档导航

- [中文部署文档](docs/DEPLOYMENT.zh-CN.md)：Rocky Linux 9 自动部署、升级、LDAP 配置、备份和故障排查。
- [Rocky Linux 9 英文部署文档](docs/INSTALL_VM.md)：官方自动安装和升级流程。
- [手工部署文档](docs/MANUAL_DEPLOYMENT.md)：不依赖特定发行版的生产部署要求。

## 主要功能

- 用户登录、角色、组织权限和管理员能力管理。
- 资产台账、资产详情、部门归属、Excel/CSV 导入预览、Excel 导出和自定义字段。
- 数据中心、机房、机柜、U 位分配、机柜可视化和容量统计。
- 设备类型、厂商、标签和字典管理。
- 故障登记、维修流程、维修成本、维修历史和维修记录导出。
- 软件许可管理。
- 盘点任务、盘点明细、历史盘点记录和结果导出。
- 备件定义、多地点库存和出入库流水。
- 审计日志和系统管理员工具。
- LDAP / Active Directory 配置、连接诊断和按需即时创建用户。
- 系统设置：语言、区域、安全、SMTP、通知、品牌和系统维护。
- SMTP 测试邮件和可选的每日提醒摘要。

## 部署入口

官方自动安装路径支持 Rocky Linux 9.x：

```bash
sudo -E ./deploy/install.sh
```

安装脚本会安装系统依赖，创建应用运行环境，初始化数据库，执行迁移，构建前端，并配置 systemd 与 Nginx。已有部署使用 `INSTALL_MODE=upgrade` 执行升级。

## v0.1 数据库基线

`v0.1.0` 使用干净的全新安装迁移基线。由基线前迁移历史创建的开发数据库，必须为 v0.1 基线重建，不能原地升级。该说明仅适用于发布前开发数据；不得重建生产数据库，未来 `v0.1.x` 生产升级必须提供明确的增量迁移。

其他 Linux 发行版请参阅[手工部署文档](docs/MANUAL_DEPLOYMENT.md)。生产架构建议使用 MySQL/MariaDB、Gunicorn、Nginx、systemd 和 HTTPS 网关。

从管理终端同步到远程主机：

```bash
./deploy-to-remote.sh <ssh-target> [remote-source-dir]
```

默认远程 staging 目录为 `/tmp/infrix-src`。自定义目录必须由 SSH 账号直接写入；安装阶段再通过 `sudo` 将应用部署到 `/opt/infrix`。

## 生产配置

生产环境文件应放在 `/etc/infrix/infrix.env` 或受控的密钥管理位置，不得放在源码目录中。

生产至少需要明确配置：

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
DJANGO_USE_X_FORWARDED_HOST=0
DB_ENGINE=mysql
DB_NAME=infrix
DB_USER=infrix
DB_PASSWORD=<数据库密码>
DB_HOST=<database-host>
DB_PORT=3306
INFRIX_CONFIG_ENCRYPTION_KEY=<Fernet 密钥>
```

使用专用数据库账号，不要公开数据库或 Gunicorn 监听端口，并妥善保护环境文件、备份、证书和私钥。

## LDAP / Active Directory

系统管理员在“组织权限 → LDAP / AD”页面配置目录服务。保存绑定密码前必须准备 `INFRIX_CONFIG_ENCRYPTION_KEY`；该密钥用于加密数据库中的绑定密码。新安装默认关闭 LDAP。

生产环境优先使用 LDAPS 或 StartTLS。连接诊断使用当前草稿，不会自动保存或启用 LDAP。

## SMTP 与通知

SMTP 是可选项，不配置 SMTP 也不会阻止应用启动。在“系统设置 → SMTP”中
配置并保存邮件服务，然后使用测试邮件功能验证配置。如需每日摘要，在“系统设置 →
通知”中明确启用摘要、填写收件人和用于邮件链接的公网 HTTPS 地址。安装脚本会创建
摘要定时器；只有明确启用且存在相关提醒时才会发送。

## 首次登录与日常运维

创建首个管理员：

```bash
cd /opt/infrix/backend
sudo -u infrix ./run.sh createsuperuser
```

首次登录后，按页面提示完成密码变更，先建立组织和位置数据，再录入资产并配置权限。

常用服务命令：

```bash
sudo systemctl status infrix --no-pager
sudo systemctl restart infrix
sudo systemctl reload nginx
sudo journalctl -u infrix -n 100 --no-pager
```

## 备份、升级与故障排查

定期备份 Infrix 数据库和 `/etc/infrix/infrix.env`，其中包括 LDAP 加密密钥。数据库备份
也会保留系统设置和已上传的品牌图片。原地升级前确认受限备份可读取；已有部署使用
`INSTALL_MODE=upgrade`，安装脚本会在迁移前保留环境文件和业务数据。

服务、数据库、迁移、前端、Nginx、LDAP 和权限问题，请参阅[中文部署文档](docs/DEPLOYMENT.zh-CN.md)或[手工部署文档](docs/MANUAL_DEPLOYMENT.md)。
