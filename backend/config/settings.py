from pathlib import Path
import os
from urllib.parse import urlsplit

from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent
_DEVELOPMENT_SECRET_KEY = "dev-only-change-me"
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}
_PRODUCTION_DB_PASSWORD_PLACEHOLDERS = {
    "change-me",
    "changeme",
    "password",
    "<database-password>",
    "数据库密码",
    "请替换为数据库密码",
}


def _env_bool(name, default):
    raw_value = os.getenv(name, default)
    value = str(raw_value).strip().lower()
    if value in _TRUE_VALUES:
        return True
    if value in _FALSE_VALUES:
        return False
    raise ImproperlyConfigured(
        f"{name} must be one of: 1, 0, true, false, yes, no, on, off."
    )


def _env_int(name, default, *, minimum=None):
    raw_value = os.getenv(name, default)
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError) as exc:
        raise ImproperlyConfigured(f"{name} must be an integer.") from exc
    if minimum is not None and value < minimum:
        raise ImproperlyConfigured(f"{name} must be an integer >= {minimum}.")
    return value


def _env_list(name, default=()):
    raw_value = os.getenv(name)
    if raw_value is None:
        return list(default)
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def validate_database_settings(
    *,
    engine,
    password="",
    name="",
    user="",
    host="",
    port="3306",
    is_production,
):
    """Validate the supported database contract without exposing credentials."""
    normalized_engine = str(engine or "").strip().lower()
    if normalized_engine not in {"mysql", "sqlite"}:
        if is_production:
            raise ImproperlyConfigured(
                "Unsupported DB_ENGINE for production; production requires mysql."
            )
        raise ImproperlyConfigured("Unsupported DB_ENGINE; use mysql or sqlite.")

    if not is_production:
        return

    if normalized_engine != "mysql":
        raise ImproperlyConfigured(
            "Production requires DB_ENGINE=mysql; SQLite is only supported for development and tests."
        )

    required_values = {
        "DB_NAME": name,
        "DB_USER": user,
        "DB_PASSWORD": password,
        "DB_HOST": host,
    }
    for setting_name, value in required_values.items():
        if not str(value or "").strip():
            raise ImproperlyConfigured(
                f"Production MySQL requires {setting_name}; the value is missing."
            )
    if str(password).strip().lower() in _PRODUCTION_DB_PASSWORD_PLACEHOLDERS:
        raise ImproperlyConfigured("Production DB_PASSWORD must not be a placeholder.")

    try:
        normalized_port = int(str(port).strip())
    except (TypeError, ValueError) as exc:
        raise ImproperlyConfigured("Production DB_PORT must be an integer.") from exc
    if not 1 <= normalized_port <= 65535:
        raise ImproperlyConfigured("Production DB_PORT must be between 1 and 65535.")


def validate_production_settings(
    *,
    secret_key,
    debug,
    allowed_hosts,
    csrf_trusted_origins,
    https_mode,
    secure_ssl_redirect,
    session_cookie_secure,
    csrf_cookie_secure,
    hsts_seconds,
    secure_proxy_ssl_header,
    use_x_forwarded_host,
    x_frame_options,
    clickjacking_middleware_enabled,
):
    """Reject an incomplete or internally inconsistent production config."""
    normalized_secret = (secret_key or "").strip()
    insecure_secrets = {
        "",
        _DEVELOPMENT_SECRET_KEY,
        "change-me",
        "changeme",
        "insecure",
    }
    if (
        normalized_secret in insecure_secrets
        or normalized_secret.lower().startswith("django-insecure-")
        or len(normalized_secret) < 50
    ):
        raise ImproperlyConfigured(
            "Production requires DJANGO_SECRET_KEY with at least 50 characters; "
            "the development fallback or placeholder is not allowed."
        )
    if debug:
        raise ImproperlyConfigured("DJANGO_DEBUG must be false when DJANGO_ENV=production.")
    if not allowed_hosts or any(not host or host == "*" for host in allowed_hosts):
        raise ImproperlyConfigured(
            "Production requires DJANGO_ALLOWED_HOSTS to contain explicit hosts; '*' is not allowed."
        )
    if not csrf_trusted_origins:
        raise ImproperlyConfigured(
            "Production requires DJANGO_CSRF_TRUSTED_ORIGINS; configure HTTPS origins explicitly."
        )
    invalid_origins = [
        origin
        for origin in csrf_trusted_origins
        if urlsplit(origin).scheme != "https" or not urlsplit(origin).netloc
    ]
    if invalid_origins:
        raise ImproperlyConfigured(
            "Production DJANGO_CSRF_TRUSTED_ORIGINS must contain valid https:// origins."
        )
    if https_mode not in {"proxy", "direct"}:
        raise ImproperlyConfigured(
            "DJANGO_HTTPS_MODE must be 'proxy' or 'direct' in production."
        )
    if not secure_ssl_redirect:
        raise ImproperlyConfigured(
            "DJANGO_SECURE_SSL_REDIRECT must be true when DJANGO_ENV=production."
        )
    if not session_cookie_secure or not csrf_cookie_secure:
        raise ImproperlyConfigured(
            "Production session and CSRF cookies must both set the Secure attribute."
        )
    if hsts_seconds <= 0:
        raise ImproperlyConfigured(
            "Production requires a positive DJANGO_SECURE_HSTS_SECONDS value."
        )
    expected_proxy_header = ("HTTP_X_FORWARDED_PROTO", "https")
    if https_mode == "proxy" and secure_proxy_ssl_header != expected_proxy_header:
        raise ImproperlyConfigured(
            "Proxy HTTPS mode requires SECURE_PROXY_SSL_HEADER to trust only "
            "HTTP_X_FORWARDED_PROTO=https from the configured proxy."
        )
    if https_mode == "direct" and secure_proxy_ssl_header is not None:
        raise ImproperlyConfigured(
            "Direct HTTPS mode must not trust a forwarded protocol header."
        )
    if use_x_forwarded_host:
        raise ImproperlyConfigured(
            "USE_X_FORWARDED_HOST is disabled for this deployment; use the validated Host header."
        )
    if x_frame_options != "DENY" or not clickjacking_middleware_enabled:
        raise ImproperlyConfigured(
            "Production must enable XFrameOptionsMiddleware with X_FRAME_OPTIONS=DENY."
        )


DJANGO_ENV = os.getenv("DJANGO_ENV", "development").strip().lower()
if DJANGO_ENV not in {"development", "production"}:
    raise ImproperlyConfigured("DJANGO_ENV must be either 'development' or 'production'.")
IS_PRODUCTION = DJANGO_ENV == "production"

SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "" if IS_PRODUCTION else _DEVELOPMENT_SECRET_KEY,
).strip()
DEBUG = _env_bool("DJANGO_DEBUG", "0" if IS_PRODUCTION else "1")
ALLOWED_HOSTS = _env_list(
    "DJANGO_ALLOWED_HOSTS",
    () if IS_PRODUCTION else ("127.0.0.1", "localhost"),
)
CSRF_TRUSTED_ORIGINS = _env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    ()
    if IS_PRODUCTION
    else ("http://127.0.0.1:5173", "http://localhost:5173"),
)
HTTPS_MODE = os.getenv("DJANGO_HTTPS_MODE", "" if IS_PRODUCTION else "direct").strip().lower()
if not IS_PRODUCTION and HTTPS_MODE not in {"proxy", "direct"}:
    raise ImproperlyConfigured("DJANGO_HTTPS_MODE must be either 'proxy' or 'direct'.")

SECURE_SSL_REDIRECT = _env_bool(
    "DJANGO_SECURE_SSL_REDIRECT", "1" if IS_PRODUCTION else "0"
)
SESSION_COOKIE_SECURE = _env_bool(
    "DJANGO_SESSION_COOKIE_SECURE", "1" if IS_PRODUCTION else "0"
)
CSRF_COOKIE_SECURE = _env_bool(
    "DJANGO_CSRF_COOKIE_SECURE", "1" if IS_PRODUCTION else "0"
)
SECURE_HSTS_SECONDS = _env_int(
    "DJANGO_SECURE_HSTS_SECONDS", "3600" if IS_PRODUCTION else "0"
)
SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", "0"
)
SECURE_HSTS_PRELOAD = _env_bool("DJANGO_SECURE_HSTS_PRELOAD", "0")
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https")
    if HTTPS_MODE == "proxy"
    else None
)
USE_X_FORWARDED_HOST = _env_bool("DJANGO_USE_X_FORWARDED_HOST", "0")
X_FRAME_OPTIONS = "DENY"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "assets",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "assets.middleware.PasswordChangeRequiredMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

if IS_PRODUCTION:
    validate_production_settings(
        secret_key=SECRET_KEY,
        debug=DEBUG,
        allowed_hosts=ALLOWED_HOSTS,
        csrf_trusted_origins=CSRF_TRUSTED_ORIGINS,
        https_mode=HTTPS_MODE,
        secure_ssl_redirect=SECURE_SSL_REDIRECT,
        session_cookie_secure=SESSION_COOKIE_SECURE,
        csrf_cookie_secure=CSRF_COOKIE_SECURE,
        hsts_seconds=SECURE_HSTS_SECONDS,
        secure_proxy_ssl_header=SECURE_PROXY_SSL_HEADER,
        use_x_forwarded_host=USE_X_FORWARDED_HOST,
        x_frame_options=X_FRAME_OPTIONS,
        clickjacking_middleware_enabled=(
            "django.middleware.clickjacking.XFrameOptionsMiddleware" in MIDDLEWARE
        ),
    )
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"

DB_ENGINE = os.getenv("DB_ENGINE", "").strip().lower()
if not DB_ENGINE and not IS_PRODUCTION:
    DB_ENGINE = "sqlite"
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "" if IS_PRODUCTION else "infrix").strip()
DB_USER = os.getenv("DB_USER", "" if IS_PRODUCTION else "infrix").strip()
DB_HOST = os.getenv("DB_HOST", "" if IS_PRODUCTION else "127.0.0.1").strip()
DB_PORT = os.getenv("DB_PORT", "3306").strip()
validate_database_settings(
    engine=DB_ENGINE,
    password=DB_PASSWORD,
    name=DB_NAME,
    user=DB_USER,
    host=DB_HOST,
    port=DB_PORT,
    is_production=IS_PRODUCTION,
)

if DB_ENGINE == "mysql":
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": DB_NAME,
        "USER": DB_USER,
        "PASSWORD": DB_PASSWORD,
        "HOST": DB_HOST,
        "PORT": DB_PORT,
        "OPTIONS": {"charset": "utf8mb4"},
    }}
elif DB_ENGINE == "sqlite":
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
AUTH_LOGIN_MAX_ATTEMPTS = _env_int("AUTH_LOGIN_MAX_ATTEMPTS", "5", minimum=1)
AUTH_LOGIN_WINDOW_SECONDS = _env_int("AUTH_LOGIN_WINDOW_SECONDS", "900", minimum=1)
AUTH_LOGIN_LOCK_SECONDS = _env_int("AUTH_LOGIN_LOCK_SECONDS", "900", minimum=1)
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = os.getenv("TZ", "Asia/Shanghai")
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "assets.pagination.StandardPagination",
    "PAGE_SIZE": 50,
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Infrix API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": [
        "rest_framework.permissions.AllowAny"
        if DEBUG
        else "rest_framework.permissions.IsAuthenticated"
    ],
    # Keep generated enum component names stable when several models expose a
    # field named ``status`` with different choice sets.
    "ENUM_NAME_OVERRIDES": {
        "AssetStatusEnum": "assets.models.Asset.STATUS",
        "RackStatusEnum": "assets.models.Rack.STATUS",
        "InventoryItemStatusEnum": "assets.models.InventoryItem.STATUS",
        "InventoryTaskStatusEnum": "assets.models.InventoryTask.STATUS",
        "OperationTypeEnum": "assets.models.SpareStockTransaction.OPERATION_TYPES",
        "RoleEnum": "assets.models.AssetNetworkAddress.ROLE",
        "FieldTypeEnum": "assets.models.CustomField.FIELD_TYPES",
        "ResolutionActionEnum": "assets.models.InventoryItem.RESOLUTION_ACTION",
    },
}
