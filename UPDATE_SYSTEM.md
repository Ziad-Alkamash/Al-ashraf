# Android APK update system

The Android app checks a small `update.json` file on the repository's default branch. If a newer `versionCode` is available, the app shows an Arabic update dialog. APKs are downloaded to the app's private cache, SHA-256 checked, parsed, checked for the expected package ID and compared with the currently installed signing certificate before Android's package installer is opened.

The update checker is Android-only. It runs after startup without blocking Quran loading, checks at most once per session and normally caches a successful check for 24 hours. When an update is mandatory, the app checks again on return to the foreground so a disabled or corrected manifest can release the block. Network and malformed-manifest failures are silent. Choosing **لاحقًا** snoozes an optional update for seven days.

## Project facts and version source

- Capacitor: `@capacitor/android` 8.5.x; no Capacitor migration is used.
- Android application ID: `com.ashraf.mushaf`.
- Existing shipped baseline inspected: version name `5.1`, version code `13`.
- The next updater-enabled bootstrap APK is set to `5.2.0` / `14` in the single source of truth: [`version.properties`](version.properties).
- The package ID and signing key must remain the same for an in-place update. Android's normal package replacement keeps application data; this updater never clears app data.
- `release-config.json` sets the minimum allowed code, the previous-code floor, the expected public signing-certificate fingerprint, and the enabled switch.

## One-time GitHub setup

1. Create a **public** GitHub repository and push this project to it. The project folder currently has no Git repository or remote configured. Public visibility is required because already-installed apps must fetch the manifest and APK without a GitHub login.
2. In **Settings → Secrets and variables → Actions**, add these repository secrets:

   - `ANDROID_KEYSTORE_BASE64`: base64 bytes of the same keystore that signed the currently distributed APK.
   - `ANDROID_KEYSTORE_PASSWORD`: keystore password.
   - `ANDROID_KEY_ALIAS`: alias of the app-signing key.
   - `ANDROID_KEY_PASSWORD`: private-key password.
   - `GOOGLE_SERVICES_JSON_BASE64`: base64 bytes of `android/app/google-services.json` (needed for the existing Firebase/FCM integration).

   `GITHUB_TOKEN` is supplied by GitHub Actions; do not create a personal token secret. The workflow restores signing files from secrets into the runner's temporary directory and never writes them into the repository.

3. Before entering the signing key as a secret, compare its certificate with the public SHA-256 fingerprint recorded in `release-config.json` and `www/assetlinks.json`. The project contains two local `.jks` files, so do not guess which one to use. Check the current APK and each candidate keystore locally with `apksigner verify --print-certs` and `keytool -list -v -keystore <file> -alias <alias>`; keytool prompts for the password. The workflow independently checks the signed APK against the expected fingerprint and stops if it differs.

   PowerShell commands to prepare secret values without printing them into the terminal:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('PATH_TO_MATCHING_KEYSTORE')) | gh secret set ANDROID_KEYSTORE_BASE64
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('android/app/google-services.json')) | gh secret set GOOGLE_SERVICES_JSON_BASE64
   gh secret set ANDROID_KEYSTORE_PASSWORD
   gh secret set ANDROID_KEY_ALIAS
   gh secret set ANDROID_KEY_PASSWORD
   ```

   The last three commands prompt for each value. They require the GitHub CLI to be authenticated for the new repository.

4. Enable GitHub Actions for the repository and allow Actions to create releases. The workflow has `contents: write` permission to create a release and update the public root `update.json` on the default branch.

## First release and future releases

The project is already prepared for the first release tag `v5.2.0` with version code `14`. Commit and push the code and workflow, then push the tag:

```powershell
git add .
git commit -m "Add Android APK updater"
git push origin main
git tag v5.2.0
git push origin v5.2.0
```

Use your repository's actual default branch name if it is not `main`. The workflow runs tests, checks release history, injects the repo-specific raw manifest URL into the APK, syncs Capacitor, builds and verifies the signed APK, calculates SHA-256, creates the GitHub Release with `AlAshraf.apk` and `update.json` assets, then publishes the current manifest to the default branch.

For every later release:

1. Increment `versionCode` in `version.properties`; never reuse or decrease it. Change `versionName` there as well. The workflow verifies the tag matches `v<versionName>` and that `versionCode` exceeds prior release manifests and the installed baseline `13`.
2. Edit `release-notes.json` with up to ten short Arabic bullet points.
3. Set `minimumVersionCode` in `release-config.json`. Leave it at `13` for optional updates to v13 users; set it to the new release code (for example `15`) to force every older supported install to update. It cannot be greater than the release's `versionCode`.
4. Commit and push those changes to the default branch, create a matching tag such as `v5.3.0`, and push that tag. Do not manually upload an unsigned APK.

Example next version edit:

```properties
versionName=5.3.0
versionCode=15
```

## Manifest and rollback controls

`update.json` is the public manifest. Its release workflow output includes:

```json
{
  "enabled": true,
  "versionName": "5.2.0",
  "versionCode": 14,
  "minimumVersionCode": 13,
  "releaseDate": "2026-10-06",
  "tagName": "v5.2.0",
  "downloadUrl": "https://github.com/OWNER/REPOSITORY/releases/latest/download/AlAshraf.apk",
  "sha256": "64 lowercase hexadecimal characters",
  "releaseNotes": ["ملاحظة قصيرة"]
}
```

The updater only accepts an HTTPS raw manifest URL for this repository and an APK URL for `AlAshraf.apk` in this repository's Releases. Remote notes are inserted as text, never executable HTML or JavaScript. SHA-256 is required. The Android bridge additionally verifies the package ID, release version code, and signing certificate before opening the installer.

To stop offering a broken release, edit the default-branch `update.json`, set `enabled` to `false`, and push the change. Existing forced-update dialogs recheck on resume; a newly launched app fetches the manifest again. To offer a previous APK, point `downloadUrl` to its version-specific release asset and restore that release's exact hash, `tagName`, version fields, and notes. Android will not install a lower version code over a higher one; for users already on a bad newer APK, publish a higher-code hotfix instead. Raw GitHub may take a short time to serve a just-pushed change.

## Permissions and installation

The app declares `REQUEST_INSTALL_PACKAGES`. On Android 8 and newer, Android may send the user to the app-specific **Install unknown apps** setting. The UI explains this step, returns to the app, and then opens Android's standard package installer. Android can still reject an install if the APK is invalid, the signature differs, the package ID differs, storage is unavailable, or the version is not newer.

The update uses Android's standard package-replacement flow. Do not change `applicationId`, signing identity, or app data backup/storage configuration as part of a release. Keep the signing keystore backed up securely; losing it prevents future updates from installing over existing copies.

## Build and checksum commands

Local unsigned/debug-capable build (the workflow is the supported signed release path):

```powershell
npm ci
npm test
npx cap sync android
cd android
.\gradlew.bat assembleRelease
```

Verify a built APK and compute its checksum:

```powershell
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
Get-FileHash android/app/build/outputs/apk/release/app-release.apk -Algorithm SHA256
```

## Rollback, limitations, and bootstrap

- Users on the existing v5.1/code13 APK need to install the first updater-enabled v5.2.0 APK manually once. The older installed APK cannot learn new JavaScript or native updater code remotely. After that bootstrap install, later APK releases can be offered in-app.
- This project directory has no GitHub owner/repository configured. The workflow derives it from `github.repository`, so no placeholder owner is hardcoded in the app. The GitHub account must create the public repository and push the project before releases can run.
- APK install is user-confirmed by Android; apps cannot silently replace themselves. The installer can be canceled by the user.
- Hash validation detects a corrupt or mismatched release file. It does not protect against a compromise of the GitHub account that controls both the manifest and release; keep repository write access and signing secrets restricted.
- Offline app features continue to work. Update checks have no user-facing failure state and never block the Quran UI.
