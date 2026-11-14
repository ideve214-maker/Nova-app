// After `cap add`, write VEXO 1.0.0 into the generated Android/iOS projects
// and keep location at coarse accuracy only.
//   node scripts/stamp-native.mjs <project-dir>
import {readFileSync, writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

export const VERSION_NAME = '1.0.0';
export const VERSION_CODE = 100;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

export function patchGradle(text) {
  let out = text;
  if (/versionCode\s+\d+/.test(out)) out = out.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  if (/versionName\s+"[^"]*"/.test(out)) out = out.replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
  if (/versionCode\s*=\s*\d+/.test(out)) out = out.replace(/versionCode\s*=\s*\d+/, `versionCode = ${VERSION_CODE}`);
  if (/versionName\s*=\s*'[^']*'/.test(out)) out = out.replace(/versionName\s*=\s*'[^']*'/, `versionName = '${VERSION_NAME}'`);
  if (/versionName\s*=\s*"[^"]*"/.test(out)) out = out.replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${VERSION_NAME}"`);
  return out;
}

export function patchPbx(text) {
  return text
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${VERSION_CODE};`)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${VERSION_NAME};`);
}

export function patchManifest(text) {
  let out = text;
  if (!out.includes('xmlns:tools=')) {
    out = out.replace('<manifest', '<manifest xmlns:tools="http://schemas.android.com/tools"');
  }
  out = out.replace(/<uses-permission\b[^>]*android:name="android\.permission\.ACCESS_FINE_LOCATION"[^>]*\/>\s*/g, '');
  out = out.replace(/<uses-permission\b[^>]*android:name="android\.permission\.ACCESS_FINE_LOCATION"[^>]*>\s*<\/uses-permission>\s*/g, '');
  if (!out.includes('ACCESS_COARSE_LOCATION')) {
    out = out.replace(
      /<manifest\b[^>]*>/,
      (m) => `${m}\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:node="remove" />`,
    );
  } else if (!out.includes('ACCESS_FINE_LOCATION" tools:node="remove"') && !out.includes("ACCESS_FINE_LOCATION\" tools:node=\"remove\"")) {
    out = out.replace(
      /<uses-permission\b[^>]*ACCESS_COARSE_LOCATION[^>]*\/>/,
      (m) => `${m}\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:node="remove" />`,
    );
  }
  // r10：语音消息要用麦克风（网页里的 getUserMedia 需要原生 RECORD_AUDIO 权限）。
  for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
    if (!out.includes(perm)) {
      out = out.replace(/<manifest\b[^>]*>/, (m) => `${m}\n    <uses-permission android:name="${perm}" />`);
    }
  }
  if (!out.includes('ACCESS_COARSE_LOCATION')) {
    throw new Error('failed to declare ACCESS_COARSE_LOCATION');
  }
  if (!out.includes('android.permission.RECORD_AUDIO')) throw new Error('failed to declare RECORD_AUDIO');
  if (/ACCESS_FINE_LOCATION"\s*\/>/.test(out) && !/ACCESS_FINE_LOCATION"\s+tools:node="remove"/.test(out)) {
    throw new Error('ACCESS_FINE_LOCATION is still granted');
  }
  return out;
}

const MAIN_ACTIVITY = `package __PKG__;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int COARSE_LOCATION_REQUEST = 4107;
    private static final int MIC_REQUEST = 4108;
    private PermissionRequest pendingMic;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingOrigin;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                // Capacitor's default client also asks for ACCESS_FINE_LOCATION.
                // VEXO only declares coarse location, so request that and nothing else.
                String perm = Manifest.permission.ACCESS_COARSE_LOCATION;
                if (ContextCompat.checkSelfPermission(MainActivity.this, perm) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                    return;
                }
                pendingGeo = callback;
                pendingOrigin = origin;
                ActivityCompat.requestPermissions(MainActivity.this, new String[]{perm}, COARSE_LOCATION_REQUEST);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // 语音消息：网页请求麦克风时，先拿到系统的录音权限，再授权给 WebView。
                boolean audio = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                }
                if (!audio) {
                    super.onPermissionRequest(request);
                    return;
                }
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    return;
                }
                if (pendingMic != null) pendingMic.deny();
                pendingMic = request;
                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == COARSE_LOCATION_REQUEST && pendingGeo != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            pendingGeo.invoke(pendingOrigin, ok, false);
            pendingGeo = null;
            pendingOrigin = null;
        }
        if (requestCode == MIC_REQUEST && pendingMic != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMic.deny();
            pendingMic = null;
        }
    }
}
`;

export function patchMainActivity(text) {
  const m = text.match(/package\s+([\w.]+)\s*;/);
  const pkg = m ? m[1] : 'app.nova.client';
  return MAIN_ACTIVITY.replace('__PKG__', pkg);
}

export function patchInfoPlist(text) {
  let out = text;
  const setString = (key, value) => {
    const re = new RegExp(`<key>${key}</key>\\s*<string>[^<]*</string>`);
    if (re.test(out)) out = out.replace(re, `<key>${key}</key>\n\t<string>${value}</string>`);
    else out = out.replace('</dict>\n</plist>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
  };
  setString('CFBundleShortVersionString', VERSION_NAME);
  setString('CFBundleVersion', String(VERSION_CODE));
  setString('CFBundleDisplayName', 'VEXO');
  setString('NSLocationWhenInUseUsageDescription', '发帖时显示你大致所在的位置。可以不授权，改为自己填写地点。');
  setString('NSMicrophoneUsageDescription', '录制并发送语音消息时需要使用麦克风。');
  setString('NSCameraUsageDescription', '拍摄照片或视频并发送给好友时需要使用相机。');
  setString('NSPhotoLibraryUsageDescription', '从相册选择照片或视频发送时需要访问相册。');
  if (!out.includes('NSLocationDefaultAccuracyReduced')) {
    out = out.replace('</dict>\n</plist>', '\t<key>NSLocationDefaultAccuracyReduced</key>\n\t<true/>\n</dict>\n</plist>');
  }
  if (out.includes('NSLocationAlways')) throw new Error('do not request always-on location');
  return out;
}

export function stampProject(root) {
  const notes = [];
  for (const rel of ['android/app/build.gradle', 'android/variables.gradle']) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    writeFileSync(p, patchGradle(readFileSync(p, 'utf8')));
    notes.push(rel);
  }
  const manifest = join(root, 'android/app/src/main/AndroidManifest.xml');
  if (existsSync(manifest)) {
    writeFileSync(manifest, patchManifest(readFileSync(manifest, 'utf8')));
    notes.push('AndroidManifest.xml');
  }
  const activities = walk(join(root, 'android')).filter((p) => p.endsWith('MainActivity.java'));
  for (const p of activities) {
    writeFileSync(p, patchMainActivity(readFileSync(p, 'utf8')));
    notes.push(p);
  }
  for (const p of walk(join(root, 'ios')).filter((f) => f.endsWith('project.pbxproj'))) {
    writeFileSync(p, patchPbx(readFileSync(p, 'utf8')));
    notes.push(p);
  }
  for (const p of walk(join(root, 'ios')).filter((f) => f.endsWith('Info.plist') && !f.includes('Tests'))) {
    const raw = readFileSync(p, 'utf8');
    if (!raw.includes('<plist')) continue;
    writeFileSync(p, patchInfoPlist(raw));
    notes.push(p);
  }
  return notes;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || '.';
  const notes = stampProject(root);
  if (!notes.length) {
    console.error('stamp-native: no Android/iOS project found in ' + root);
    process.exit(1);
  }
  console.log('stamp-native', VERSION_NAME, 'versionCode', VERSION_CODE);
  for (const n of notes) console.log('  ', n);
}
