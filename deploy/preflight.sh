# Read-only machine checks, sourced by install.sh before package installation.
check_machine_readiness() {
  local problems=0 available_kb listener port
  if command -v timedatectl >/dev/null 2>&1 && \
    [[ "$(timedatectl show -p NTPSynchronized --value)" != yes ]]; then
    echo '提示：系统时间尚未同步。快照还原后请核对时间，否则软件源和 HTTPS 证书可能验证失败。' >&2
  fi
  available_kb="$(df -Pk /var/tmp | awk 'NR==2 {print $4}')"
  if [[ ! "$available_kb" =~ ^[0-9]+$ || "$available_kb" -lt 2097152 ]]; then
    echo '检查失败：/var/tmp 至少需要 2 GB 可用空间用于安装准备。' >&2
    problems=$((problems + 1))
  fi
  if command -v ss >/dev/null 2>&1; then
    for port in 80 443 8001; do
      listener="$(ss -ltnpH | awk -v port="$port" '$4 ~ (":" port "$") {print}')"
      if [[ -n "$listener" && "$listener" != *nginx* && "$listener" != *gunicorn* ]]; then
        echo "检查失败：端口 $port 已被其他程序占用。" >&2
        problems=$((problems + 1))
      fi
    done
  fi
  if [[ "${TLS_MODE:-auto}" == certificate || -f "$TLS_CERT_FILE" ]]; then
    if [[ ! -r "$TLS_CERT_FILE" || ! -r "$TLS_KEY_FILE" ]]; then
      echo '检查失败：证书或私钥不可读。' >&2
      problems=$((problems + 1))
    elif ! openssl x509 -in "$TLS_CERT_FILE" -checkend 86400 -noout >/dev/null 2>&1; then
      echo '检查失败：证书无效或将在 24 小时内过期。' >&2
      problems=$((problems + 1))
    else
      local cert_public key_public
      cert_public="$(openssl x509 -in "$TLS_CERT_FILE" -pubkey -noout 2>/dev/null)"
      key_public="$(openssl pkey -in "$TLS_KEY_FILE" -passin pass: -pubout 2>/dev/null)" || key_public=""
      if [[ -z "$key_public" || "$cert_public" != "$key_public" ]]; then
        echo '检查失败：证书与私钥不匹配，或私钥需要密码。' >&2
        problems=$((problems + 1))
      fi
    fi
  fi
  [[ "$problems" -eq 0 ]] || fail "安装前检查发现 $problems 个问题，请处理后重试。"
  log '安装前主机检查通过。'
}
