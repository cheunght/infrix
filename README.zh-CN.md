# Infrix

[English README](README.md) · [Rocky Linux 9 中文安装文档](docs/DEPLOYMENT.zh-CN.md)

Infrix 安装、部署和运行维护入口。

## 快速开始

官方自动安装目标为 Rocky Linux 9.x。在项目根目录或解压后的发布包目录执行：

```bash
sudo bash deploy/install.sh
```

首次安装时，安装器会询问访问地址、数据库方式和 HTTPS 方式，自动保存生产配置，并在终端引导创建首个管理员。已有部署再次执行同一命令时，会复用原配置并执行原地升级。

使用包含预构建前端的发布包：

```bash
mkdir /tmp/infrix-release
tar -xzf infrix-release.tar.gz -C /tmp/infrix-release
cd /tmp/infrix-release
sudo bash deploy/install.sh
```

从管理终端同步到支持 sudo 的远程主机：

```bash
./deploy-to-remote.sh <ssh-target>
```

远程助手支持 `--config /服务器上的绝对路径` 和 `--non-interactive`。用于生产主机前，请先阅读安装文档。

## 部署后验收

使用随附安装器部署后，可执行完整的只读验收：

```bash
sudo env BASE_URL=https://<hostname> bash deploy/verify-release.sh
```

该检查会验证生产安全配置、Django 检查与迁移、核心数据表、机柜 U 位完整性、静态资源、API、前端路由和 Nginx 入口。入口诊断也可以单独执行：

```bash
bash deploy/doctor.sh https://<hostname>
```

## 文档导航

- [Rocky Linux 9 自动安装和升级](docs/DEPLOYMENT.zh-CN.md)
- [本机 MariaDB 备份与恢复](docs/DEPLOYMENT.zh-CN.md#本机备份与恢复)
- [安装向导、中断恢复、发布包和 HTTPS 验收](docs/INSTALLER_WORKFLOW.zh-CN.md)
- [其他 Linux 发行版手工部署](docs/MANUAL_DEPLOYMENT.zh-CN.md)
- [生产环境示例文件](deploy/infrix.env.example)

英文文档入口：[English Rocky installation guide](docs/INSTALL_VM.md)、
[English installer workflow](docs/INSTALLER_WORKFLOW.md) 和
[English manual deployment guide](docs/MANUAL_DEPLOYMENT.md)。
