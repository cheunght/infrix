# Infrix

[English README](README.md) · [Rocky Linux 9 中文安装文档](docs/DEPLOYMENT.zh-CN.md)

Infrix 是面向基础设施团队的 IT 资产管理平台，统一管理资产台账、位置、维修、软件许可、盘点、备件、通知和审计记录。

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

## 主要功能

- 资产台账、导入、导出、自定义字段、标签和生命周期数据。
- 数据中心、机房、机柜、U 位分配和容量视图。
- 故障登记、维修流程、维修成本和维修历史。
- 软件许可、盘点任务、备件、库存和库存流水。
- 组织、角色、LDAP/Active Directory 集成和审计日志。
- 语言、安全、SMTP、通知、品牌和系统维护设置。

## 文档导航

- [Rocky Linux 9 自动安装和升级](docs/DEPLOYMENT.zh-CN.md)
- [安装向导、中断恢复、发布包和 HTTPS 验收](docs/INSTALLER_WORKFLOW.zh-CN.md)
- [其他 Linux 发行版手工部署](docs/MANUAL_DEPLOYMENT.zh-CN.md)
- [生产环境示例文件](deploy/infrix.env.example)
- [变更记录](CHANGELOG.md)

英文文档入口：[English Rocky installation guide](docs/INSTALL_VM.md)、
[English installer workflow](docs/INSTALLER_WORKFLOW.md) 和
[English manual deployment guide](docs/MANUAL_DEPLOYMENT.md)。

## 版本说明

`v0.1.0` 使用干净的全新安装迁移基线。发布安装、原地升级以及发布前开发数据库的限制，详见中英文安装文档。
