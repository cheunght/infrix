#!/usr/bin/env bash
# Read-only checks of the actual browser entry point; no environment sourcing.
set -uo pipefail
site_url="${1:-}"
ca_file="${2:-}"
if [[ ! "$site_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  echo '用法：bash deploy/doctor.sh https://访问域名或IP [CA证书文件]' >&2
  exit 2
fi
site_url="${site_url%/}"
tls_args=(--proto '=https')
if [[ -n "$ca_file" ]]; then
  [[ -r "$ca_file" ]] || { echo '无法读取 CA 证书文件' >&2; exit 2; }
  tls_args+=(--cacert "$ca_file")
fi
failed=0
for path in / /assets /api/v1/auth/csrf/ /api/v1/branding/; do
  curl_result=0
  response=$(curl "${tls_args[@]}" --silent --show-error --connect-timeout 5 --max-time 15 \
    --max-filesize 1048576 --write-out '\n%{http_code}' "$site_url$path") || curl_result=$?
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  content_ok=1
  if [[ "$path" == /api/v1/auth/csrf/ ]]; then
    printf '%s' "$body" | grep -Eq '"csrfToken"[[:space:]]*:[[:space:]]*"[A-Za-z0-9]{64}"' || content_ok=0
  elif [[ "$path" == / || "$path" == /assets ]]; then
    [[ "$body" == *'id="app"'* ]] || content_ok=0
  fi
  if [[ "$curl_result" == 0 && "$code" == 200 && "$content_ok" == 1 ]]; then
    printf '通过 HTTP 200 %s\n' "$path"
  else
    printf '失败 HTTP %s %s（检查入口、证书、反向代理和响应内容）\n' "$code" "$path" >&2
    failed=1
  fi
done
if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active infrix nginx || failed=1
fi
if [[ "$failed" == 1 ]]; then
  echo '本机诊断：sudo nginx -t；sudo journalctl -u infrix -u nginx -n 80 --no-pager' >&2
fi
exit "$failed"
