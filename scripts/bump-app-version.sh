#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_VERSION=${1:-$(date +"%Y%m%d-%H%M%S")}

case "$APP_VERSION" in
  *[!0-9A-Za-z._-]*|"")
    echo "Version invalide : $APP_VERSION" >&2
    exit 1
    ;;
esac

for file in index.html OneSignalSDKWorker.js update.html; do
  path="$ROOT_DIR/$file"
  if ! grep -q 'const APP_VERSION="[^"]*";' "$path"; then
    echo "APP_VERSION introuvable dans $file" >&2
    exit 1
  fi
done

if ! grep -q '"start_url": "./index.html?v=[^"]*"' "$ROOT_DIR/manifest.json"; then
  echo "Version du manifest introuvable" >&2
  exit 1
fi

for file in index.html OneSignalSDKWorker.js update.html; do
  APP_VERSION="$APP_VERSION" perl -0pi -e \
    's/const APP_VERSION="[^"]*";/const APP_VERSION="$ENV{APP_VERSION}";/' \
    "$ROOT_DIR/$file"
done

APP_VERSION="$APP_VERSION" perl -0pi -e \
  's#("start_url": "\./index\.html\?v=)[^"]*#${1}$ENV{APP_VERSION}#' \
  "$ROOT_DIR/manifest.json"

for path in "$ROOT_DIR"/*.html; do
  APP_VERSION="$APP_VERSION" perl -0pi -e \
    's#((?:assets/(?:css|js)/[^"?]+|app-shell\.css|vigilance-data\.js)\?v=)[^"]*#${1}$ENV{APP_VERSION}#g' \
    "$path"
done

echo "APP_VERSION synchronisée : $APP_VERSION"
