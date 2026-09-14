#!/usr/bin/env bash
set -e

# HyperShare Universal Linux Installer
# Supports Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE, Alpine and other Linux distros

APP_NAME="hypershare"
DISPLAY_NAME="HyperShare"
REPO="CallMeParadox/HyperShare"
INSTALL_DIR="/usr/local/bin"
DESKTOP_DIR="/usr/share/applications"
ICON_DIR="/usr/share/icons/hicolor/scalable/apps"
ICON_PNG_DIR="/usr/share/icons/hicolor/512x512/apps"
SYSTEMD_DIR="/usr/lib/systemd/user"

# Check for root / sudo
if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

# Handle uninstall
if [ "$1" = "uninstall" ]; then
  echo "🗑️  Removing $DISPLAY_NAME..."
  $SUDO rm -f "$INSTALL_DIR/$APP_NAME"
  $SUDO rm -f "$DESKTOP_DIR/$APP_NAME.desktop"
  $SUDO rm -f "$ICON_DIR/$APP_NAME.svg"
  $SUDO rm -f "$ICON_PNG_DIR/$APP_NAME.png"
  $SUDO rm -f "$SYSTEMD_DIR/$APP_NAME.service"
  if command -v update-desktop-database >/dev/null 2>&1; then
    $SUDO update-desktop-database "$DESKTOP_DIR" || true
  fi
  echo "✅ $DISPLAY_NAME has been successfully uninstalled."
  exit 0
fi

echo "======================================================="
echo "⚡ Installing $DISPLAY_NAME for Linux..."
echo "======================================================="

# Detect Architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    TARGET_ARCH="amd64"
    ;;
  aarch64|arm64)
    TARGET_ARCH="arm64"
    ;;
  armv7*|armhf)
    TARGET_ARCH="armv7"
    ;;
  *)
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

echo "🔍 Detected architecture: $ARCH ($TARGET_ARCH)"

# Check if local binary exists, otherwise fetch latest release from GitHub
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN="$SCRIPT_DIR/../../hypershare"

if [ -f "$LOCAL_BIN" ]; then
  echo "📦 Found local binary: $LOCAL_BIN"
  $SUDO cp -f "$LOCAL_BIN" "$INSTALL_DIR/$APP_NAME"
else
  echo "🌐 Fetching latest release from GitHub ($REPO)..."
  LATEST_TAG=$(curl -sSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v1.1.3"
  fi
  TAR_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/hypershare-linux-$TARGET_ARCH.tar.gz"
  TMP_DIR=$(mktemp -d)
  echo "⬇️ Downloading $TAR_URL..."
  curl -sSL "$TAR_URL" -o "$TMP_DIR/hypershare.tar.gz"
  tar -xzf "$TMP_DIR/hypershare.tar.gz" -C "$TMP_DIR"
  $SUDO cp -f "$TMP_DIR/hypershare" "$INSTALL_DIR/$APP_NAME"
  rm -rf "$TMP_DIR"
fi

$SUDO chmod +x "$INSTALL_DIR/$APP_NAME"

# Install Desktop Entry
$SUDO mkdir -p "$DESKTOP_DIR"
if [ -f "$SCRIPT_DIR/hypershare.desktop" ]; then
  $SUDO cp -f "$SCRIPT_DIR/hypershare.desktop" "$DESKTOP_DIR/"
  # Ensure path points to /usr/local/bin/hypershare
  $SUDO sed -i 's|/usr/bin/hypershare|/usr/local/bin/hypershare|g' "$DESKTOP_DIR/hypershare.desktop"
fi

# Install Icons
$SUDO mkdir -p "$ICON_DIR" "$ICON_PNG_DIR"
if [ -f "$SCRIPT_DIR/../icons/hypershare.svg" ]; then
  $SUDO cp -f "$SCRIPT_DIR/../icons/hypershare.svg" "$ICON_DIR/"
fi
if [ -f "$SCRIPT_DIR/../icons/hypershare.png" ]; then
  $SUDO cp -f "$SCRIPT_DIR/../icons/hypershare.png" "$ICON_PNG_DIR/"
fi

# Install Systemd User Service
$SUDO mkdir -p "$SYSTEMD_DIR"
if [ -f "$SCRIPT_DIR/hypershare.service" ]; then
  $SUDO cp -f "$SCRIPT_DIR/hypershare.service" "$SYSTEMD_DIR/"
  $SUDO sed -i 's|/usr/bin/hypershare|/usr/local/bin/hypershare|g' "$SYSTEMD_DIR/hypershare.service"
fi

# Update desktop cache
if command -v update-desktop-database >/dev/null 2>&1; then
  $SUDO update-desktop-database "$DESKTOP_DIR" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  $SUDO gtk-update-icon-cache -f -t /usr/share/icons/hicolor || true
fi

echo "-------------------------------------------------------"
echo "✅ $DISPLAY_NAME installed successfully to $INSTALL_DIR/$APP_NAME!"
echo ""
echo "🚀 Run manually:       hypershare"
echo "🖥️  Launch from menu:  Open your application menu and search 'HyperShare'"
echo "⚙️  Run as service:     systemctl --user enable --now hypershare"
echo "-------------------------------------------------------"
