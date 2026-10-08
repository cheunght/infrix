# ITAM 第一阶段修复与验收记录

日期：2026-10-08（Asia/Shanghai）。审查基线 `98a9e88`，修复保留 Django/Vue 单体架构，不新增业务表迁移。系统尚未部署；本记录包含代码验收和隔离环境演练，首次生产部署清单仍待在目标机器执行。

## 1. 批次与行为变化

| 批次 | 提交 | 交付与回归 |
| --- | --- | --- |
| 认证 | `964443e` | 认证完成后统一改密校验；管理员重置密码同事务更新密码、改密标记、PAT 撤销和撤销数量审计；修正 S02 误判，真实 HTTP API/Admin 双向锁定通过 |
| 业务 | `2739ca3` | 空白故障安全摘要；同一 Exists 匹配地点、全局库存聚合；机房改挂统一事务约束和盘点创建/重开位置锁；业务回归 5 项通过 |
| 认证补充 | `af06093` | 最终复查修正本次引入的 Admin 2FA 跳转缩进，补错误/正确验证码与 LDAP 本地有效期排除回归；认证用例合计 8 项通过；保留 OpenAPI cookie 会话认证说明 |
| 维护 | `d278b59` | 跨进程维护屏障、格式 2 媒体引用校验、CLI 备份恢复与失败关闭、网页 405 命令说明、安装配置及中英文文档；维护回归 8 项通过 |
| 联合验收 | 本文所在提交 | 可重复的 MariaDB 演练脚本、修复状态报告和首次部署清单 |

管理员重置密码后，旧 PAT 的读写请求均失败；新会话需要改密。Admin 在完成密码及已启用的 2FA 后引导需改密用户回主应用，本地密码过期执行相同策略，LDAP 密码期限继续由目录服务负责。审计只存撤销数量，不保存 Token 原文。

故障原因和描述仍允许为空：优先选原因的首个非空行，其次描述，最长 160 字；均空时为“未填写故障说明”。一条空白故障不阻断通知列表或邮件摘要。

机房存在任意备件库存记录（包括零余额）或进行中盘点时，改挂返回 `409 room_reparent_blocked`；失败不改变位置及库存。无关联时仍同步机柜和资产位置。库存筛选只选择备件，数量、地点数及低库存判断均为全局统计，列表、详情与导出共用查询口径。两个真实 5 件余额不会被去重。

备份/恢复仅支持服务器命令。网页保留列表、下载、删除和操作说明；原创建/恢复 POST 返回 `405 maintenance_cli_required`。维护期间 API/Admin 返回 `503 maintenance_in_progress`，带 `Retry-After: 30`，前端展示维护提示并且不自动重试写请求。

## 2. 基线复现与最终检查

新增认证/业务回归在原始 `98a9e88` 的独立临时副本执行：13 项中 8 项断言失败、1 项空白故障触发 IndexError，实际入口锁定及无约束位置同步等兼容场景仍通过。它们能捕获旧 Token 未撤销、PAT 绕过改密、Admin 改密/过期入口、库存聚合及两种改挂阻止条件。原始 S04 媒体缺失却归档有效的复现保留于审查报告；新增维护测试检查缺失文件必须失败、哈希被篡改必须拒绝、旧格式必须明确标识。

认证补充测试先捕获本次缩进回归的 `UnboundLocalError`，修正后验证错误验证码不会建立会话、正确验证码后仍受强制改密限制。最终结果如下：

| 检查 | 最终结果 |
| --- | --- |
| 在 backend 目录执行 `.venv/bin/python manage.py test --verbosity 1` | SQLite：115 项通过；独立 MariaDB：115 项通过；系统检查无异常 |
| `npm run test`（frontend） | 2 个文件、4 项通过，含维护响应不重试写请求 |
| `npm run build`（frontend，含 `vue-tsc --noEmit`） | 类型检查及生产构建通过 |
| `manage.py makemigrations --check --dry-run` | No changes detected |
| `backend/.venv/bin/python scripts/installer-regression.py` | 15 项通过，含维护目录与应用/媒体/备份重叠拒绝 |
| `bash deploy/test-persistent-sync.sh` | 通过；默认、自定义、符号链接媒体的保留与不安全重叠检查均通过 |
| `git diff --check` | 通过 |
| OpenAPI 生成、`--validate` 与新接口说明检查 | 退出码 0；新 POST 的 405 与 cookie 会话认证已描述。仍存在基线已有的 GroupViewSet 未声明 serializer（1 种、4 次）及 get_definitions 类型提示（1 种、1 次）诊断，本次未扩大范围处理 |

构建仍提示依赖 `@vueuse/core` 的 PURE 注释位置，但构建成功。未执行浏览器完整端到端或生产压力测试，不以测试数量推导覆盖率。

## 3. 独立 MariaDB 事务与恢复演练

环境：macOS，Python 3.14.5、Django 5.2.17、Gunicorn 23.0.0、MariaDB 10.11.19，InnoDB。临时数据库 `infrix_phase1_5`，本机回环端口 13317；数据库、媒体、备份、维护状态均位于独立临时目录，未读取或恢复现有业务数据库。MariaDB dump/import 使用真实客户端，不以 SQLite 或模拟 SQL 代替。

备份服务原本仅在生产标记下启用。演练脚本先要求开发模式、指定的 `infrix_phase1` 前缀空库，再仅在受控 CLI 子进程打开该标记，避免把开发运输配置误当成目标生产部署。脚本拒绝生产配置、非 MariaDB、不匹配的数据库名，以及已有用户/资产的库。

可重复脚本：[scripts/phase1-mariadb-acceptance.py](../scripts/phase1-mariadb-acceptance.py)。运行前以隔离实例提供 DB 环境变量、绝对媒体/备份/维护目录，以及可运行的 MariaDB 客户端 PATH；先迁移新的空数据库，再从仓库根目录执行：

```bash
# 当前 shell 先加载完整隔离环境，包含 DB_ENGINE=mysql、
# DB_NAME=infrix_phase1_example、DJANGO_ENV=development、
# DB_HOST/PORT/USER/PASSWORD 和三个独立目录。
backend/.venv/bin/python backend/manage.py migrate --noinput
backend/.venv/bin/python scripts/phase1-mariadb-acceptance.py \
  --database infrix_phase1_example
```

该脚本只用于一次性的空测试库，会恢复及更改测试数据；需要建库、导入、dump 和测试用的 PROCESSLIST 权限，并在本机启动临时 HTTP 服务。不要以名称前缀代替实际隔离。

| 场景 | 结果与观察 |
| --- | --- |
| 附件上传与 CLI 备份并发 | 在真实存储写入处暂停已准入上传；CLI 发布维护状态后，后续 API/Admin/写请求 503；放行上传后，SQL 与归档均包含完成的附件 |
| 附件删除提交回调与备份并发 | 删除事务提交后的真实物理删除暂停；CLI 等待回调结束，归档不含已删除文件 |
| 完整备份恢复 | 修改资产名、附件字节和库存后，真实导入恢复原资产、附件内容及 5 件库存；旧会话失效，密码登录成功，恢复后出库成功 |
| 数据库导入失败 | 在 import 适配边界注入失败，其余安全备份、媒体准备/交换使用真实流程；持续 503，用原安全备份实际导入恢复到 4 件库存后开放 |
| 恢复进程被终止 | 仅测试归档的真实 SQL 末尾加入 `SELECT SLEEP(8)`；确认客户端进入延时后杀死 CLI。维护仍为 dirty，存活客户端保留锁并拒绝抢先恢复；客户端退出后仍 503，原安全备份恢复成功，库存与终止前附件字节一致 |
| 旧格式恢复 | 将合法测试归档转换格式 1，不含媒体引用清单；列表标为 `legacy_unverified`，真实恢复后引用文件存在、字节正确 |
| 机房改挂与入库并发 | 8 次真实 InnoDB 双线程竞争；覆盖 `(200, 400)` 改挂先完成和 `(409, 201)` 入库先完成两种结果，未出现库存中心/机房错配 |
| 多 worker、CLI 与网页并发 | 实际启动 3 个 Gunicorn worker，CLI 进入等待独占窗口时，120 次真实 HTTP 请求全部 503；日志确认三个 worker 均处理请求；放行后真实备份成功，HTTP 恢复到正常未认证响应 |

另有独立多进程测试覆盖读请求排空、新请求拒绝、维护进程终止、存活导入客户端持锁、dirty 状态重新恢复及验收后开放。媒体缺失及媒体摘要篡改通过真实存储/归档回归验证。演练最后输出 `ALL PHASE 1 MARIADB ACCEPTANCE CHECKS PASSED`，临时 Gunicorn 自动关闭，MariaDB 实例在验收后关闭。

## 4. 维护命令与恢复失败处理

完整安装与环境加载方法见 [部署说明](DEPLOYMENT.zh-CN.md)、[手工部署](MANUAL_DEPLOYMENT.zh-CN.md)。CLI 必须使用与 Gunicorn 相同的服务账号、配置、数据库、媒体和维护目录：

```bash
python manage.py check_backup --json
python manage.py create_backup
python manage.py restore_backup <backup-file> --confirm-restore "RESTORE INFRIX"
```

`INFRIX_MAINTENANCE_DIR` 在生产默认 `/var/lib/infrix/maintenance`，目录权限 700。锁与状态不可位于会被恢复/同步替换的应用、媒体、静态或备份目录。锁文件不删除、不替换；状态文件原子更新并同步落盘。

普通动态请求持共享访问锁至响应、事务提交文件回调结束；流式响应持锁至流结束/关闭。维护先发布阻止新请求的状态，再等待独占访问。排空默认最多 60 秒，可设置 `INFRIX_MAINTENANCE_DRAIN_SECONDS`。超时未开始操作；备份失败没有业务修改时解除维护。

恢复先完成安全备份及媒体准备，在修改数据前持久标记 dirty；数据库导入、媒体引用校验、迁移状态校验、会话失效及恢复审计全部通过才开放。格式 2 记录引用文件路径、字节数和 SHA-256，复制及归档均验证；缺引用文件时不会成功生成备份。

恢复修改数据后失败、CLI 异常退出或被杀死时，业务持续关闭。确认原 CLI 和 MariaDB 客户端已退出，读取独立维护目录 `state.json` 中的 `safety_backup`，再执行：

```bash
python manage.py restore_backup <state.json中记录的安全备份> \
  --confirm-restore "RESTORE INFRIX" --recover
```

此模式只接受记录的原安全备份，不为部分恢复的库另建安全备份。再次失败仍保持维护。不要手工删除状态强行开放。归档丢失、磁盘损坏等无法完成此流程的情况，需要保留状态并由管理员处理存储/恢复条件。

直接 SQL、迁移、人工文件修改和其他外部写入不参加屏障，维护期间不得并行执行。当前协议只支持单机多个 worker，多节点需另行设计。

## 5. 首次部署验收清单（待目标环境执行）

以下均为部署阶段待办，本次没有标记生产上线通过。

- [ ] 在目标 Rocky 9/指定发行版按安装文档运行只读 preflight，确认生产 MariaDB、客户端工具、环境文件和加密密钥；不使用演练脚本连接生产库。
- [ ] 确认服务账号拥有稳定的独立维护目录（700），所有 worker 与 CLI 使用相同配置；确认媒体、备份与应用目录关系，备份目录不由 Nginx 暴露。
- [ ] 在目标环境的单独验收库做一次备份/恢复，比较资产、库存记录和附件内容；检查旧会话失效、重新登录、出入库成功。
- [ ] 启动目标配置的多个 Gunicorn worker，验证维护时 API/Admin 的 503、Retry-After、页面提示，以及完成后恢复访问；禁止同时运行 SQL/迁移/其他文件写入。
- [ ] 验证首次登录、管理员重置后的改密、旧 PAT 失效、API/Admin 交叉锁定；若启用 LDAP/2FA，使用目标目录和认证器完成实际入口验收。
- [ ] 验证机房正/零库存及进行中盘点阻止改挂，错误提示明确；空白故障通知与邮件摘要正常，地点筛选的列表/导出均为全局库存。
- [ ] 执行 `deploy/doctor.sh`、`deploy/verify-release.sh`，确认 HTTPS、可信代理、systemd、Nginx、SELinux 和日志配置。
- [ ] 保存首次部署版本/提交、目标数据库与客户端版本、演练归档校验、时间、执行人和验收结果；确认安全备份恢复步骤及离线副本策略。

后台任务、数据范围权限、历史留存、软件授权对账、其他 P2 问题与多节点维护均未纳入本次修复。
