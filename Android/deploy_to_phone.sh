#!/usr/bin/env bash
# Build, verify, and install the Melodious Android app onto a physical Android phone
# Usage:
#   ./Android/deploy_to_phone.sh                           # USB-connected phone (or already paired via adb)
#   ./Android/deploy_to_phone.sh --wireless 192.168.0.x:p  # Connect via Android Wireless Debugging first
#   ./Android/deploy_to_phone.sh --build-only              # Build APK & run JVM unit tests without installing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WIRELESS_TARGET=""
BUILD_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wireless)
      WIRELESS_TARGET="${2:-}"
      shift 2
      ;;
    --build-only)
      BUILD_ONLY=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--wireless <phone-ip:port>] [--build-only]" >&2
      exit 1
      ;;
  esac
done

echo "==> [1/5] Checking Java 17/21 & Android build toolchain..."
if [[ -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
elif [[ -d "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]]; then
  export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
fi
export PATH="$JAVA_HOME/bin:$PATH"

# Locate or bootstrap Android SDK
if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
  SDK_DIR="$ANDROID_HOME"
elif [[ -d "$HOME/Library/Android/sdk" ]]; then
  SDK_DIR="$HOME/Library/Android/sdk"
elif [[ -d "/opt/homebrew/share/android-commandlinetools" ]]; then
  SDK_DIR="/opt/homebrew/share/android-commandlinetools"
else
  echo "    Android SDK not found. Installing android-commandlinetools and android-platform-tools via Homebrew..."
  brew install --cask android-commandlinetools android-platform-tools
  SDK_DIR="/opt/homebrew/share/android-commandlinetools"
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$SDK_DIR/platform-tools:$SDK_DIR/cmdline-tools/latest/bin:/opt/homebrew/bin:$PATH"

if ! command -v adb >/dev/null 2>&1; then
  echo "    Installing adb (android-platform-tools) via Homebrew..."
  brew install --cask android-platform-tools
fi

if [[ ! -d "$SDK_DIR/platforms/android-36" ]]; then
  if command -v sdkmanager >/dev/null 2>&1; then
    echo "    Installing Android SDK Platform 36 & Build-Tools 36.0.0..."
    yes | sdkmanager --licenses >/dev/null 2>&1 || true
    sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  else
    echo "ERROR: Android SDK Platform 36 not found under $SDK_DIR and sdkmanager is not on PATH." >&2
    echo "Open Android Studio -> SDK Manager and install Android 16 (API 36), or run:" >&2
    echo "  brew install --cask android-commandlinetools" >&2
    exit 1
  fi
fi

# Write local.properties for Gradle
printf "sdk.dir=%s\n" "$SDK_DIR" > "$SCRIPT_DIR/local.properties"

# Ensure Gradle wrapper exists
if [[ ! -x "$SCRIPT_DIR/gradlew" ]]; then
  if ! command -v gradle >/dev/null 2>&1; then
    echo "    Installing Gradle via Homebrew to generate ./gradlew wrapper..."
    brew install gradle
  fi
  echo "    Generating Gradle wrapper (8.9)..."
  gradle wrapper --gradle-version 8.9
fi

echo "==> [2/5] Running :core-protocol JVM unit tests..."
./gradlew :core-protocol:test

echo "==> [3/5] Building Debug APK (:app:assembleDebug)..."
./gradlew :app:assembleDebug

APK_PATH="$SCRIPT_DIR/app/build/outputs/apk/debug/app-debug.apk"
echo "    Built APK: $APK_PATH"

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  echo "==> Build complete (--build-only specified)."
  exit 0
fi

echo "==> [4/5] Checking connected Android phone via adb..."
if [[ -n "$WIRELESS_TARGET" ]]; then
  adb connect "$WIRELESS_TARGET"
fi

DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {count++} END {print count+0}')"
if [[ "$DEVICE_COUNT" -eq 0 ]]; then
  echo ""
  echo "No authorized Android phone detected over adb."
  echo "To connect your phone:"
  echo "  Option A (USB Cable):"
  echo "    1. On your phone, go to Settings -> About Phone -> tap 'Build number' 7 times."
  echo "    2. Go to Settings -> System -> Developer options -> enable 'USB debugging'."
  echo "    3. Plug the phone into your Mac, tap 'Allow USB debugging' on the phone screen, and re-run:"
  echo "       ./Android/deploy_to_phone.sh"
  echo ""
  echo "  Option B (Wi-Fi Wireless Debugging — no cable needed):"
  echo "    1. Enable 'Wireless debugging' in Developer options on your phone."
  echo "    2. Tap 'Wireless debugging' -> 'Pair device with pairing code' and run:"
  echo "       adb pair <phone-ip>:<pairing-port>"
  echo "    3. Then run:"
  echo "       ./Android/deploy_to_phone.sh --wireless <phone-ip>:<connect-port>"
  exit 1
fi

echo "==> [5/5] Installing and launching Melodious on your phone..."
adb install -r "$APK_PATH"
adb shell am start -n "app.melodious/.MainActivity"
echo "==> Done! Melodious is now running on your Android phone."
