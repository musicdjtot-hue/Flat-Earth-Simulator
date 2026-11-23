@echo off
echo === Azimut-40: Build APK for Android 16-17 ===
call npm install --legacy-peer-deps
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
node scripts/setup-android.mjs
if errorlevel 1 exit /b 1
cd android
call gradlew.bat assembleDebug --no-daemon
if errorlevel 1 exit /b 1
echo.
echo DONE! APK file created at:
echo android\app\build\outputs\apk\debug\app-debug.apk
pause
