import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const androidDir = path.join(root, 'android');
const wrapperJar = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.jar');

const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const activityPath = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'azimut40', 'simulator', 'MainActivity.java');
const stringsPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const stylesPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'styles.xml');
const varsPath = path.join(androidDir, 'variables.gradle');
const capConfigPath = path.join(root, 'capacitor.config.json');

function readIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

if (!fs.existsSync(capConfigPath)) {
  fs.writeFileSync(
    capConfigPath,
    JSON.stringify(
      {
        appId: 'com.azimut40.simulator',
        appName: 'Азимут-40',
        webDir: 'dist',
        android: { backgroundColor: '#050811', allowMixedContent: false },
        plugins: { SystemBars: { insetsHandling: 'css', style: 'DARK' } },
      },
      null,
      2,
    ),
    'utf8',
  );
}

if (!fs.existsSync(path.join(root, 'dist'))) {
  console.log('[Azimut-40] Building web assets into dist/...');
  execSync('npm run build', { stdio: 'inherit' });
}

const saved = {
  manifest: readIfExists(manifestPath),
  activity: readIfExists(activityPath),
  strings: readIfExists(stringsPath),
  styles: readIfExists(stylesPath),
};

if (!fs.existsSync(wrapperJar)) {
  console.log('[Azimut-40] Initializing Capacitor 8 Android Gradle project (SDK 36 / Android 16-17)...');
  if (fs.existsSync(androidDir)) {
    fs.rmSync(androidDir, { recursive: true, force: true });
  }
  execSync('npx cap add android', { stdio: 'inherit' });
}

if (saved.manifest) fs.writeFileSync(manifestPath, saved.manifest, 'utf8');
if (saved.strings) fs.writeFileSync(stringsPath, saved.strings, 'utf8');
if (saved.styles) fs.writeFileSync(stylesPath, saved.styles, 'utf8');
if (saved.activity) {
  fs.mkdirSync(path.dirname(activityPath), { recursive: true });
  fs.writeFileSync(activityPath, saved.activity, 'utf8');
}

if (fs.existsSync(varsPath)) {
  let vars = fs.readFileSync(varsPath, 'utf8');
  vars = vars.replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 36');
  vars = vars.replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 36');
  vars = vars.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 24');
  fs.writeFileSync(varsPath, vars, 'utf8');
}

console.log('[Azimut-40] Syncing dist/ into Android project...');
execSync('npx cap sync android', { stdio: 'inherit' });
console.log('[Azimut-40] Android 16-17 project ready!');
