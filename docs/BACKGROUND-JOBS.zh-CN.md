# 持久后台作业

适用：单机 MariaDB、多个 Gunicorn worker、一个或多个独立作业 worker。迁移 `0014_background_jobs` 增加作业表。升级时先停止 Web、worker 和摘要定时器，再迁移；不要让旧代码和新 worker 同时运行。

## 网页与接口

网页确认资产、型号、人员、部门导入，以及资产、型号、维修、许可、备件、库存流水、机柜、盘点和审计导出，均提交后台作业。模板下载和文件预览保留原行为及数量限制。顶部“后台作业”显示本人的进度、结果、失败原因和操作；完成导入后刷新业务页面。只在面板打开且有未完成作业时定期读取状态，不自动重试写请求。

| 接口 | 行为 |
| --- | --- |
| `POST /api/v1/jobs/` | JSON `kind`、`params`，或 multipart `kind`、`file`；提供 `Idempotency-Key`，返回 202 `{"job": ...}` |
| `GET /api/v1/jobs/?offset=0` | 仅本人作业，按时间倒序，每页 30 条 |
| `GET /api/v1/jobs/{id}/` | 状态、进度、检查点、次数、时间、公开失败码及结果 |
| `POST /api/v1/jobs/{id}/cancel/` | 仅排队作业可取消；正在执行返回 409 |
| `POST /api/v1/jobs/{id}/retry/` | 仅失败作业可重试，复用作业 ID 和原输入，重新检查当前权限 |
| `GET /api/v1/jobs/{id}/result/` | 本人导出文件，重新检查账号、改密策略、功能能力和范围；不可用返回 409，授权或业务变化返回 403 |

类型：`asset_import`、`asset_model_import`、`people_import`、`department_import`；`asset_export`、`asset_model_export`、`repair_record_export`、`license_export`、`spare_part_export`、`spare_transaction_export`、`rack_layout_export`、`inventory_export`、`audit_export`；`notification_digest`。盘点导出在 `params.task_id` 指定任务，其他导出使用原入口的筛选参数。

旧同步 API 保留作为有数量限制的兼容入口，网页默认使用作业 API。外部客户端应切换到作业提交、状态查询和结果下载。导入输入上限 10 MiB，仍遵守各导入器行数限制；导出仍遵守原数量上限，不解除资源限制。同一键必须对应同一类型、参数和文件字节，内容不同返回 409。浏览器保留未确认提交的键；关闭浏览器后无法找回键时先检查作业列表，不应盲目重复提交。

## 提交、取消与恢复规则

作业状态为 `queued → running → succeeded/failed`，或 `queued → cancelled`。进度 0、10、100 分别表示排队、执行、已结束；第一版不提供逐行百分比或剩余时间。检查点保存排队、执行、提交或取消阶段。

导入整份文件的业务变更、审计和作业完成在同一数据库事务提交。进程在提交前中断会回滚整份导入；提交后完成状态已持久化，不再执行。失败重试复用原文件，并按当前数据重新校验，不复用旧预览。不能中途取消正在运行的导入；修正输入后应创建新的作业。

每个 worker 持有对应作业的跨进程文件锁，活着的慢作业不会因超时被另一 worker 接管。进程退出会释放锁，下一次扫描可以接管遗留的 `running` 作业，执行次数增加。作业记录和输入文件是恢复依据，无需手动改状态或删除锁文件。进程中断时未登记的临时文件由清理命令回收。

执行和下载使用当前授权。排队期间账号停用、角色或数据范围变化时执行失败；重试重新检查权限。导出结果保存授权指纹和审计水位，任何已审计业务变化都保守地使旧导出失效，避免资产改挂到范围外后仍能下载旧数据；即使是无关记录变化也须重新导出。只拥有旧作业 ID 或媒体文件名不能取得结果。Web 服务器不得直接公开媒体目录。

邮件摘要使用既有逐收件人持久发送记录；SMTP 接受状态不确定时保留 `sending/unknown`，不能自动当作未发送重发。作业完成表示本次发送检查结束，仍须查看结果中的失败数及“邮件投递记录”。旧定时命令现在仅登记当天唯一作业，由 worker 发送。恢复数据库后取消恢复出的待发摘要，并暂停当日自动摘要，次日恢复；已发送邮件不受 SQL 恢复影响。确需人工重新发送时先核实邮件投递记录和收件端情况。

## 运行

使用与 Web 相同的服务账号、环境文件、数据库、媒体目录和独立维护目录：

```bash
cd /opt/infrix/backend
.venv/bin/python manage.py work_jobs
# 最多执行一个可用作业后退出
.venv/bin/python manage.py work_jobs --once
# 定时登记当天摘要；重复调用复用当天作业
.venv/bin/python manage.py send_notification_digest
# 默认保留 30 天；也回收没有数据库引用的作业文件
.venv/bin/python manage.py clean_jobs --days 30
```

安装器新增 `infrix-worker.service`，自动启动并在进程退出后重启。手工部署可参考安装器生成的服务：`WorkingDirectory`、`EnvironmentFile` 与 `infrix.service` 相同，`ExecStart` 为虚拟环境 Python 执行 `manage.py work_jobs`，`Restart=always`，`RestartSec=5`。worker 每次空扫描等待 2 秒，可通过 `--poll-seconds` 调整至 0.1–60 秒。安排清理命令每天执行一次，检查 `journalctl -u infrix-worker` 和磁盘空间；失败只记录作业 ID 与公开错误码，原文件和业务校验详情仅本人可见。

升级前停止 `infrix-worker`、`infrix-digest.timer`、`infrix-digest.service` 和 Web，等待进程退出后迁移，再启动各服务。备份恢复期间不用手动停 worker：它与 HTTP、清理命令共用维护屏障；新任务不执行，已入场任务连同事务和文件回调排空后，CLI 才取得独占窗口。`--once` 在维护中报错退出；常驻 worker 等待开放后继续。

输入和输出位于媒体目录下 `job-files/`，权限 600，目录 700；备份清单纳入数据库引用的作业文件。缺失引用文件时备份失败。恢复按原有迁移兼容策略检查版本，旧归档格式仍可识别，但跨迁移版本须使用匹配版本代码及升级流程。恢复后的输入按提交摘要验证，文件被改写时拒绝导入。

当前没有跨节点租约、跨机器存储协调、逐行部分提交、运行中撤销、自动业务失败重试或无限量导出。跨节点部署需要重新设计维护和 worker 协调。
