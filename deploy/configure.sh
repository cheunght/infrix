# Sourced only for a fresh interactive installation.
configure_fresh_install() {
  [[ -t 0 ]] || fail "首次安装需要配置。请在终端运行安装向导，或显式提供生产环境参数。"
  command -v openssl >/dev/null || fail "安装向导需要 openssl，请先安装 openssl。"
  echo 'Infrix 首次安装：生产环境配置向导'
  read -r -p '访问 IP 或域名（不含协议和端口）：' SERVER_NAME
  [[ "$SERVER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail "访问地址格式无效。"
  DJANGO_ENV=production
  DJANGO_ALLOWED_HOSTS="$SERVER_NAME,127.0.0.1,localhost"
  DJANGO_CSRF_TRUSTED_ORIGINS="https://$SERVER_NAME"
  DJANGO_SECRET_KEY="$(openssl rand -hex 32)"
  INFRIX_CONFIG_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"
  DB_ENGINE=mysql
  DB_NAME=infrix
  DB_USER=infrix
  DB_HOST=127.0.0.1
  DB_PORT=3306
  local database_choice certificate_choice
  read -r -p '数据库：1 本机自动安装；2 已有数据库 [1]：' database_choice
  case "${database_choice:-1}" in
    1) SKIP_MARIADB=0; DB_PASSWORD="$(openssl rand -hex 24)" ;;
    2)
      SKIP_MARIADB=1
      read -r -p '数据库主机：' DB_HOST
      read -r -p '数据库端口 [3306]：' DB_PORT
      DB_PORT="${DB_PORT:-3306}"
      read -r -p '数据库名称：' DB_NAME
      read -r -p '数据库用户：' DB_USER
      read -r -s -p '数据库密码：' DB_PASSWORD
      printf '\n'
      ;;
    *) fail '数据库选项无效。' ;;
  esac
  read -r -p 'HTTPS：1 已有证书；2 内网自签证书；3 外部HTTPS网关 [2]：' certificate_choice
  case "${certificate_choice:-2}" in
    1)
      TLS_MODE=certificate
      read -r -p '证书文件绝对路径：' TLS_CERT_FILE
      read -r -p '私钥文件绝对路径：' TLS_KEY_FILE
      [[ "$TLS_CERT_FILE" =~ ^/[A-Za-z0-9._/-]+$ && "$TLS_KEY_FILE" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail '证书路径必须为绝对路径，且不含空格或特殊字符。'
      [[ -f "$TLS_CERT_FILE" && -f "$TLS_KEY_FILE" ]] || fail '证书或私钥不存在。'
      ;;
    2)
      TLS_MODE=self-signed
      echo '内网自签证书需要在访问电脑上加入信任；证书会保留供后续升级使用。'
      ;;
    3) TLS_MODE=gateway ;;
    *) fail 'HTTPS 选项无效。' ;;
  esac
  echo "配置将保存到 $ENV_FILE；访问地址 https://$SERVER_NAME"
}
