#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="${APP_DIR:-/opt/itam}"
APP_USER="${APP_USER:-itam}"
ENV_FILE="${ENV_FILE:-/etc/itam/itam.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1}"

fail() {
  echo "验收失败：$*" >&2
  systemctl status itam --no-pager >&2 2>/dev/null || true
  journalctl -u itam -n 60 --no-pager >&2 2>/dev/null || true
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

[[ "$(id -u)" -eq 0 ]] || fail "请使用 root 执行，以便读取服务状态和应用环境。"
[[ -x "$APP_DIR/backend/run.sh" ]] || fail "未找到应用入口：$APP_DIR/backend/run.sh"
[[ -f "$ENV_FILE" ]] || fail "未找到环境文件：$ENV_FILE"

run_app() {
  runuser -u "$APP_USER" -- "$APP_DIR/backend/run.sh" "$@"
}

env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

production_security_hints() {
  local debug_value secret_value hosts_value risk_count=0
  debug_value="$(env_value DJANGO_DEBUG)"
  secret_value="$(env_value DJANGO_SECRET_KEY)"
  hosts_value="$(env_value DJANGO_ALLOWED_HOSTS)"

  log "检查生产安全配置（仅提示，不阻断验收）"
  if [[ "$debug_value" != "0" ]]; then
    echo "安全提示 [高]：DJANGO_DEBUG 未设置为 0。生产环境应关闭调试模式。" >&2
    risk_count=$((risk_count + 1))
  fi
  if [[ -z "$secret_value" || "$secret_value" == "dev-only-change-me" || ${#secret_value} -lt 32 ]]; then
    echo "安全提示 [高]：DJANGO_SECRET_KEY 缺失或过短，请使用随机且仅生产环境可读的密钥。" >&2
    risk_count=$((risk_count + 1))
  fi
  if [[ -z "$hosts_value" || "$hosts_value" == "*" ]]; then
    echo "安全提示 [中]：DJANGO_ALLOWED_HOSTS 过宽，请限制为实际域名或 IP。" >&2
    risk_count=$((risk_count + 1))
  fi
  case "${BASE_URL,,}" in
    https://*) ;;
    *)
      echo "安全提示 [中]：当前 BASE_URL 未使用 HTTPS；正式入口应启用 HTTPS、安全 Cookie、HSTS 和 X-Frame-Options。" >&2
      risk_count=$((risk_count + 1))
      ;;
  esac
  if [[ "$risk_count" -eq 0 ]]; then
    log "生产安全配置提示：未发现明显风险（仍需由网关确认 HTTPS 和安全响应头）。"
  else
    log "生产安全配置提示：发现 $risk_count 项建议，未阻断本次验收。"
  fi
}

production_security_hints

log "检查 systemd 服务"
systemctl is-active --quiet itam || fail "itam.service 未运行。"
systemctl is-active --quiet nginx || fail "nginx 未运行。"

log "检查 Django 配置和迁移"
run_app check >/dev/null || fail "Django check 未通过。"
run_app makemigrations --check --dry-run >/dev/null || fail "存在未生成的模型迁移。"
run_app check_preset_roles >/dev/null || fail "预设角色检查未通过。"

migration_plan="$(run_app showmigrations --plan)"
if printf '%s\n' "$migration_plan" | grep -qE '^[[:space:]]*\[ \]'; then
  printf '%s\n' "$migration_plan" | grep -E '^[[:space:]]*\[ \]' >&2
  fail "存在未应用的数据库迁移。"
fi

log "检查核心数据表和数据量"
run_app shell -c 'from django.db import connection; from assets.models import Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog; models=[Asset,DataCenter,ServerRoom,Rack,RackUnitAllocation,FaultEvent,RepairRecord,SoftwareLicense,InventoryTask,InventoryItem,SparePart,SpareStock,SpareStockTransaction,CustomField,AssetCustomValue,Tag,AssetTag,AuditLog]; tables=set(connection.introspection.table_names()); missing=[model._meta.db_table for model in models if model._meta.db_table not in tables]; print("缺少数据表："+", ".join(missing)) if missing else None; print("数据量："+" ".join(f"{model.__name__}={model.objects.count()}" for model in models)) if not missing else None; raise SystemExit(1 if missing else 0)' || fail "核心数据表检查失败。"

log "检查机柜 U 位完整性"
run_app shell -c 'from collections import defaultdict; from assets.models import RackUnitAllocation; allocations=list(RackUnitAllocation.objects.select_related("rack").order_by("rack_id","start_u","end_u","id")); errors=[]; grouped=defaultdict(list); [errors.append(f"allocation={row.id}: U位范围 {row.start_u}-{row.end_u} 超出机柜 {row.rack.code}/{row.rack.total_u}容量") for row in allocations if row.start_u < 1 or row.start_u > row.end_u or row.end_u > row.rack.total_u]; [grouped[row.rack_id].append(row) for row in allocations]; [(errors.append(f"rack={rack_id}: U位 {current.start_u}-{current.end_u} 与 {previous.start_u}-{previous.end_u} 重叠"), None) for rack_id, rows in grouped.items() for previous, current in zip(rows, rows[1:]) if current.start_u <= previous.end_u]; print("U位完整性检查通过："+str(len(allocations))+" 条上架记录") if not errors else print("U位完整性异常："+"；".join(errors[:20])); raise SystemExit(1 if errors else 0)' || fail "发现机柜 U 位越界或重叠。"

log "检查应用静态资源"
[[ -s "$APP_DIR/frontend/dist/index.html" ]] || fail "缺少前端构建产物：frontend/dist/index.html"
[[ -s "$APP_DIR/frontend/dist/platform-icon.png" ]] || fail "缺少浏览器图标：frontend/dist/platform-icon.png"

log "检查 API 和 Nginx 反向代理"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/api/v1/auth/csrf/" >/dev/null || fail "API 健康检查失败：${BASE_URL%/}"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/" >/dev/null || fail "前端静态资源健康检查失败：${BASE_URL%/}"
curl --retry 5 --retry-delay 1 --connect-timeout 3 --max-time 10 -fsS \
  "${BASE_URL%/}/assets" >/dev/null || fail "前端路由刷新检查失败：${BASE_URL%/}/assets"

log "上线验收通过"
echo "应用目录：$APP_DIR"
echo "环境文件：$ENV_FILE"
echo "检查地址：${BASE_URL%/}"
echo "最近备份："
find /var/backups/itam -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort -r | head -5 || true
