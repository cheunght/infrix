#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
install_script="$script_dir/install.sh"
command -v rsync >/dev/null || { echo 'rsync unavailable' >&2; exit 2; }

# Execute the installer's actual sync function against disposable directories.
# The fallback also reproduces the original unprotected command on old code.
filter_function="$(awk '
  /^configure_media_sync_filter\(\) \{$/ { capture=1 }
  capture { print; if ($0 == "}") exit }
' "$install_script")"
sync_function="$(awk '
  /^sync_application_source\(\) \{$/ { capture=1 }
  capture { print; if ($0 == "}") exit }
' "$install_script")"
if [[ -z "$sync_function" ]]; then
  sync_fragment="$(awk '
    /^  rsync -a --delete \\$/ { capture=1 }
    capture { print; if ($0 == "    \"$SOURCE_DIR/\" \"$APP_DIR/\"") exit }
  ' "$install_script")"
else
  [[ "$sync_function" == *'"$SOURCE_DIR/" "$APP_DIR/"'* ]] || {
    echo 'Could not extract application rsync command' >&2
    exit 2
  }
  [[ -n "$filter_function" ]] || { echo 'Could not extract media filter' >&2; exit 2; }
  eval "$filter_function"
  eval "$sync_function"
  grep -Fq 'configure_media_sync_filter' "$install_script" || exit 2
  grep -Fq '  sync_application_source' "$install_script" || {
    echo 'Installer does not invoke the tested sync function' >&2
    exit 2
  }
fi

fixture_root="$(mktemp -d)"
trap 'rm -rf -- "$fixture_root"' EXIT
SOURCE_DIR="$fixture_root/release"
APP_DIR="$fixture_root/app"
PYTHON_BIN="$(command -v python3)"
mkdir -p "$SOURCE_DIR/backend" "$APP_DIR/backend/media" "$fixture_root/external-media"
printf 'upload\n' > "$APP_DIR/backend/media/sentinel.txt"
printf 'stale\n' > "$APP_DIR/backend/stale.py"
printf 'old\n' > "$APP_DIR/backend/app.py"
printf 'updated\n' > "$SOURCE_DIR/backend/app.py"
printf 'added\n' > "$SOURCE_DIR/backend/new.py"
printf 'sibling\n' > "$SOURCE_DIR/backend/media2.txt"
printf 'database\n' > "$APP_DIR/backend/db.sqlite3"

unset INFRIX_MEDIA_ROOT
fail() { echo "FAIL: $*" >&2; exit 1; }
log() { :; }
if [[ -n "$sync_function" ]]; then
  configure_media_sync_filter
  sync_application_source
else
  eval "$sync_fragment"
fi

[[ -f "$APP_DIR/backend/media/sentinel.txt" ]] || {
  echo 'FAIL: media sentinel was deleted' >&2
  exit 1
}
[[ ! -e "$APP_DIR/backend/stale.py" ]] || { echo 'FAIL: stale source survived' >&2; exit 1; }
[[ "$(< "$APP_DIR/backend/app.py")" == updated ]] || { echo 'FAIL: application source not updated' >&2; exit 1; }
[[ "$(< "$APP_DIR/backend/new.py")" == added ]] || { echo 'FAIL: new source not copied' >&2; exit 1; }
[[ -f "$APP_DIR/backend/media2.txt" ]] || { echo 'FAIL: sibling source was excluded' >&2; exit 1; }
[[ -f "$APP_DIR/backend/db.sqlite3" ]] || { echo 'FAIL: database sentinel deleted' >&2; exit 1; }

if [[ -n "$sync_function" ]]; then
  # An environment-configured path under the application is protected too.
  SOURCE_DIR="$fixture_root/custom-release"
  APP_DIR="$fixture_root/custom-app"
  mkdir -p "$SOURCE_DIR/backend" "$APP_DIR/backend/uploads"
  printf 'custom upload\n' > "$APP_DIR/backend/uploads/sentinel.txt"
  printf 'stale\n' > "$APP_DIR/backend/stale.py"
  printf 'updated\n' > "$SOURCE_DIR/backend/app.py"
  INFRIX_MEDIA_ROOT=uploads
  configure_media_sync_filter
  sync_application_source
  [[ -f "$APP_DIR/backend/uploads/sentinel.txt" ]] || { echo 'FAIL: custom media deleted' >&2; exit 1; }
  [[ ! -e "$APP_DIR/backend/stale.py" ]] || { echo 'FAIL: custom stale source survived' >&2; exit 1; }
  [[ -f "$APP_DIR/backend/app.py" ]] || { echo 'FAIL: custom source not copied' >&2; exit 1; }

  # An absolute override has the same protection as a relative override.
  INFRIX_MEDIA_ROOT="$APP_DIR/backend/uploads"
  configure_media_sync_filter
  sync_application_source
  [[ -f "$APP_DIR/backend/uploads/sentinel.txt" ]] || { echo 'FAIL: absolute media deleted' >&2; exit 1; }

  # A collision with release-owned code must fail before any sync begins.
  mkdir -p "$SOURCE_DIR/backend/assets"
  INFRIX_MEDIA_ROOT="$APP_DIR/backend/assets"
  if (configure_media_sync_filter 2>/dev/null); then
    echo 'FAIL: release-owned MEDIA_ROOT was accepted' >&2
    exit 1
  fi
  INFRIX_MEDIA_ROOT="$APP_DIR/frontend/dist/uploads"
  if (configure_media_sync_filter 2>/dev/null); then
    echo 'FAIL: rebuilt frontend directory was accepted as MEDIA_ROOT' >&2
    exit 1
  fi
  INFRIX_MEDIA_ROOT="$APP_DIR/backend/media\\unsafe"
  if (configure_media_sync_filter 2>/dev/null); then
    echo 'FAIL: rsync pattern metacharacter was accepted' >&2
    exit 1
  fi
  [[ -f "$APP_DIR/backend/uploads/sentinel.txt" ]] || { echo 'FAIL: rejected path altered uploads' >&2; exit 1; }

  # Protect the configured path itself when media is a symlink to external data.
  SOURCE_DIR="$fixture_root/symlink-release"
  APP_DIR="$fixture_root/symlink-app"
  mkdir -p "$SOURCE_DIR/backend" "$APP_DIR/backend"
  printf 'external upload\n' > "$fixture_root/external-media/sentinel.txt"
  ln -s "$fixture_root/external-media" "$APP_DIR/backend/media"
  INFRIX_MEDIA_ROOT="$APP_DIR/backend/media"
  configure_media_sync_filter
  sync_application_source
  [[ -L "$APP_DIR/backend/media" && -f "$APP_DIR/backend/media/sentinel.txt" ]] || {
    echo 'FAIL: media symlink was deleted' >&2
    exit 1
  }

  # External media is outside the deletion boundary and needs no filter.
  INFRIX_MEDIA_ROOT="$fixture_root/external-media"
  configure_media_sync_filter
  [[ ${#media_exclude[@]} -eq 0 ]] || { echo 'FAIL: external media was filtered' >&2; exit 1; }

  # An external-looking symlink into the app must not bypass protection.
  APP_DIR="$fixture_root/custom-app"
  SOURCE_DIR="$fixture_root/custom-release"
  ln -s "$APP_DIR/backend" "$fixture_root/app-alias"
  INFRIX_MEDIA_ROOT="$fixture_root/app-alias/uploads"
  if (configure_media_sync_filter 2>/dev/null); then
    echo 'FAIL: alias into application was accepted' >&2
    exit 1
  fi

  # A manual in-place install does not source-sync and may already contain media.
  APP_DIR="$fixture_root/symlink-app"
  SOURCE_DIR="$APP_DIR"
  unset INFRIX_MEDIA_ROOT
  configure_media_sync_filter
  echo 'PASS: default, custom, and symlinked media preserved; unsafe overlap rejected; stale source deleted; changed/new source synced; database preserved'
else
  echo 'PASS: media preserved; stale source deleted; changed/new source synced; database preserved'
fi
