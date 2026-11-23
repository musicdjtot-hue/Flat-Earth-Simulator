#!/usr/bin/env bash
set -e
echo "=== Азимут-40: Сборка APK для Android 16-17 ==="
npm install --legacy-peer-deps
npm run build
node scripts/setup-android.mjs
cd android
chmod +x gradlew
./gradlew assembleDebug --no-daemon
echo ""
echo "ГОТОВО! APK файл создан:"
echo "android/app/build/outputs/apk/debug/app-debug.apk"
