# release-build

Capacitor shells for packaging only. Do not merge into main / admin / v7-* branches.

- `user/` — Nova (`com.nova.app`), web assets in `www/` (0.7.0-m6.1, API http://47.239.0.90)
- `admin/` — Nova Admin (`com.nova.admin`), web assets in `dist-spa/` (v7)
- `.github/workflows/ios-unsigned.yml` — macOS unsigned IPA build for 全能签

Android APKs are built on the shared box, not in this workflow.
