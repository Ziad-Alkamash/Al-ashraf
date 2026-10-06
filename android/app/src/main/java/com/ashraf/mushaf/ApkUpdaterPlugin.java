package com.ashraf.mushaf;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** Native, verified APK download and Android package-installer bridge. */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    private static final long MAX_APK_BYTES = 512L * 1024L * 1024L;
    private static final String PREFS = "apk-updater";
    private static final String APK_NAME = "AlAshraf.apk";
    private static final Pattern OWNER_OR_REPO = Pattern.compile("[A-Za-z0-9_.-]{1,100}");
    private static final Pattern TAG = Pattern.compile("v[0-9A-Za-z][0-9A-Za-z.+-]{0,63}");
    private static final Pattern SHA256 = Pattern.compile("[A-Fa-f0-9]{64}");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private volatile HttpURLConnection activeConnection;
    private volatile boolean downloading = false;

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("packageName", getContext().getPackageName());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("تعذر قراءة إصدار التطبيق المثبت", "APP_INFO_FAILED", e);
        }
    }

    @PluginMethod
    public void getInstallPermissionState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("allowed", true);
            call.resolve(result);
            return;
        }

        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName()));
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("افتح إعدادات التطبيقات وثبّت التطبيقات من هذا المصدر", "INSTALL_SETTINGS_UNAVAILABLE");
            return;
        }
        saveCall(call);
        startActivityForResult(call, intent, "handleInstallPermissionResult");
    }

    @ActivityCallback
    private void handleInstallPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean allowed = Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
        if (allowed) {
            JSObject value = new JSObject();
            value.put("allowed", true);
            call.resolve(value);
        } else {
            call.reject("لم يتم السماح بتثبيت التطبيقات من هذا المصدر", "INSTALL_PERMISSION_DENIED");
        }
    }

    @PluginMethod
    public synchronized void downloadAndVerify(PluginCall call) {
        if (downloading) {
            call.reject("يوجد تنزيل تحديث جارٍ بالفعل", "DOWNLOAD_BUSY");
            return;
        }
        String downloadUrl = call.getString("downloadUrl");
        String expectedHash = call.getString("sha256");
        String ownerRepo = call.getString("ownerRepo");
        String tagName = call.getString("tagName");
        Integer expectedVersionCode = call.getInt("versionCode");
        if (!isOfficialDownloadUrl(downloadUrl, ownerRepo, tagName) || expectedHash == null
            || !SHA256.matcher(expectedHash).matches() || expectedVersionCode == null || expectedVersionCode < 1) {
            call.reject("بيانات التحديث غير صالحة", "INVALID_UPDATE_METADATA");
            return;
        }

        downloading = true;
        cancelRequested.set(false);
        saveCall(call);
        executor.execute(() -> {
            File partial = null;
            try {
                File dir = new File(getContext().getCacheDir(), "apk-updates");
                if (!dir.exists() && !dir.mkdirs()) throw new UpdateException("تعذر تجهيز مساحة التحديث", "STORAGE_FAILED");
                File apk = new File(dir, APK_NAME);
                partial = new File(dir, APK_NAME + ".part");
                if (partial.exists() && !partial.delete()) throw new UpdateException("تعذر تنظيف تنزيل سابق", "STORAGE_FAILED");
                if (apk.exists() && !apk.delete()) throw new UpdateException("تعذر تنظيف تنزيل سابق", "STORAGE_FAILED");

                download(downloadUrl, ownerRepo, tagName, expectedHash.toLowerCase(Locale.ROOT), partial);
                if (!partial.renameTo(apk)) throw new UpdateException("تعذر حفظ ملف التحديث", "STORAGE_FAILED");
                validateApk(apk, expectedVersionCode);
                getContext().getSharedPreferences(PREFS, 0).edit()
                    .putString("apkPath", apk.getAbsolutePath())
                    .putString("sha256", expectedHash.toLowerCase(Locale.ROOT))
                    .putInt("versionCode", expectedVersionCode)
                    .apply();

                JSObject result = new JSObject();
                result.put("verified", true);
                result.put("bytes", apk.length());
                call.resolve(result);
            } catch (UpdateException e) {
                if (partial != null && partial.exists()) partial.delete();
                call.reject(e.getMessage(), e.code, e);
            } catch (Exception e) {
                if (partial != null && partial.exists()) partial.delete();
                if (cancelRequested.get()) call.reject("تم إلغاء التنزيل", "DOWNLOAD_CANCELLED", e);
                else call.reject("تعذر تنزيل التحديث أو التحقق منه", "DOWNLOAD_FAILED", e);
            } finally {
                activeConnection = null;
                downloading = false;
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelRequested.set(true);
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void installDownloadedApk(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("يجب السماح بتثبيت التطبيق من هذا المصدر أولًا", "INSTALL_PERMISSION_REQUIRED");
            return;
        }
        File apk = getSavedApk();
        if (apk == null || !apk.isFile()) {
            call.reject("ملف التحديث غير موجود؛ أعد تنزيله", "APK_MISSING");
            return;
        }
        try {
            String expectedHash = getContext().getSharedPreferences(PREFS, 0).getString("sha256", "");
            int expectedVersionCode = getContext().getSharedPreferences(PREFS, 0).getInt("versionCode", -1);
            if (!SHA256.matcher(expectedHash).matches() || !expectedHash.equalsIgnoreCase(sha256(apk))) {
                apk.delete();
                clearSavedApk();
                call.reject("فشل التحقق الأمني من ملف التحديث", "APK_HASH_MISMATCH");
                return;
            }
            validateApk(apk, expectedVersionCode);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setData(uri);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            saveCall(call);
            startActivityForResult(call, intent, "handleInstallerResult");
        } catch (Exception e) {
            call.reject("تعذر فتح مثبت Android؛ حاول مرة أخرى", "INSTALL_FAILED", e);
        }
    }

    @ActivityCallback
    private void handleInstallerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result != null && result.getResultCode() == Activity.RESULT_OK) {
            call.resolve();
        } else {
            call.reject("لم يكتمل تثبيت التحديث. يمكنك إعادة المحاولة.", "INSTALL_CANCELLED_OR_FAILED");
        }
    }

    private void download(String initialUrl, String ownerRepo, String tagName, String expectedHash, File output) throws Exception {
        URL current = new URL(initialUrl);
        long downloaded = 0;
        int redirects = 0;
        MessageDigest digest = MessageDigest.getInstance("SHA-256");

        while (true) {
            if (cancelRequested.get()) throw new UpdateException("تم إلغاء التنزيل", "DOWNLOAD_CANCELLED");
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            activeConnection = connection;
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "AlAshraf-Android-Updater");
            int status = connection.getResponseCode();

            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || ++redirects > 5) throw new UpdateException("رابط تنزيل غير صالح", "DOWNLOAD_URL_INVALID");
                current = new URL(current, location);
                if (!isAllowedReleaseRedirect(current, ownerRepo, tagName) || !"https".equalsIgnoreCase(current.getProtocol())) {
                    throw new UpdateException("تم رفض تحويل رابط التنزيل لسبب أمني", "DOWNLOAD_URL_INVALID");
                }
                continue;
            }
            if (status != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new UpdateException("تعذر الوصول إلى ملف التحديث (HTTP " + status + ")", "DOWNLOAD_HTTP_ERROR");
            }

            long total = connection.getContentLengthLong();
            if (total > MAX_APK_BYTES) {
                connection.disconnect();
                throw new UpdateException("حجم ملف التحديث أكبر من الحد المسموح", "APK_TOO_LARGE");
            }
            if (total > 0 && output.getParentFile().getUsableSpace() < total + 2L * 1024L * 1024L) {
                connection.disconnect();
                throw new UpdateException("لا توجد مساحة كافية لتنزيل التحديث", "INSUFFICIENT_STORAGE");
            }

            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream fileOut = new FileOutputStream(output);
                 BufferedOutputStream out = new BufferedOutputStream(fileOut)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (cancelRequested.get() || Thread.currentThread().isInterrupted()) {
                        throw new UpdateException("تم إلغاء التنزيل", "DOWNLOAD_CANCELLED");
                    }
                    downloaded += count;
                    if (downloaded > MAX_APK_BYTES) throw new UpdateException("حجم ملف التحديث أكبر من الحد المسموح", "APK_TOO_LARGE");
                    digest.update(buffer, 0, count);
                    out.write(buffer, 0, count);
                    notifyDownloadProgress(downloaded, total);
                }
                out.flush();
                fileOut.getFD().sync();
            } finally {
                connection.disconnect();
            }
            break;
        }

        if (downloaded == 0) throw new UpdateException("ملف التحديث فارغ", "APK_INVALID");
        String actualHash = toHex(digest.digest());
        if (!MessageDigest.isEqual(actualHash.getBytes("UTF-8"), expectedHash.getBytes("UTF-8"))) {
            throw new UpdateException("فشل التحقق من بصمة SHA-256 لملف التحديث", "APK_HASH_MISMATCH");
        }
    }

    private void notifyDownloadProgress(long downloaded, long total) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloaded);
        data.put("totalBytes", total);
        data.put("percent", total > 0 ? Math.min(100, Math.round((downloaded * 100.0) / total)) : -1);
        notifyListeners("downloadProgress", data);
    }

    private void validateApk(File apk, long expectedVersionCode) throws Exception {
        PackageManager pm = getContext().getPackageManager();
        int signingFlag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo downloaded = pm.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlag);
        if (downloaded == null || downloaded.applicationInfo == null || !getContext().getPackageName().equals(downloaded.packageName)) {
            throw new UpdateException("ملف التحديث ليس نسخة صالحة من المصحف الأشرف", "APK_INVALID");
        }
        PackageInfo installed = pm.getPackageInfo(getContext().getPackageName(), signingFlag);
        Set<String> downloadedSigners = signerFingerprints(downloaded);
        Set<String> installedSigners = signerFingerprints(installed);
        if (downloadedSigners.isEmpty() || !downloadedSigners.equals(installedSigners)) {
            throw new UpdateException("شهادة توقيع التحديث لا تطابق التطبيق المثبت", "APK_SIGNER_MISMATCH");
        }
        long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        long downloadedCode = Build.VERSION.SDK_INT >= 28 ? downloaded.getLongVersionCode() : downloaded.versionCode;
        if (downloadedCode <= installedCode || downloadedCode != expectedVersionCode) {
            throw new UpdateException("إصدار ملف التحديث ليس أحدث من التطبيق المثبت", "APK_VERSION_INVALID");
        }
    }

    @SuppressWarnings("deprecation")
    private Set<String> signerFingerprints(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        Set<String> fingerprints = new TreeSet<>();
        if (signatures != null) {
            for (Signature signature : signatures) {
                fingerprints.add(toHex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
            }
        }
        return fingerprints;
    }

    private boolean isOfficialDownloadUrl(String raw, String ownerRepo, String tagName) {
        if (raw == null || ownerRepo == null || tagName == null || !TAG.matcher(tagName).matches()) return false;
        String[] parts = ownerRepo.split("/", -1);
        if (parts.length != 2 || !OWNER_OR_REPO.matcher(parts[0]).matches() || !OWNER_OR_REPO.matcher(parts[1]).matches()) return false;
        try {
            URL url = new URL(raw);
            String stablePath = "/" + parts[0] + "/" + parts[1] + "/releases/latest/download/" + APK_NAME;
            String pinnedPath = "/" + parts[0] + "/" + parts[1] + "/releases/download/" + tagName + "/" + APK_NAME;
            return "https".equalsIgnoreCase(url.getProtocol())
                && "github.com".equalsIgnoreCase(url.getHost())
                && url.getPort() == -1
                && (url.getPath().equals(stablePath) || url.getPath().equals(pinnedPath))
                && url.getQuery() == null
                && url.getRef() == null
                && url.getUserInfo() == null;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isAllowedReleaseHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        return lower.equals("github.com")
            || lower.equals("release-assets.githubusercontent.com")
            || lower.equals("objects.githubusercontent.com")
            || lower.matches("github-production-release-asset-[0-9a-f]+\\.s3\\.amazonaws\\.com");
    }

    private boolean isAllowedReleaseRedirect(URL url, String ownerRepo, String tagName) {
        if (!isAllowedReleaseHost(url.getHost())) return false;
        if ("github.com".equalsIgnoreCase(url.getHost())) return isOfficialDownloadUrl(url.toString(), ownerRepo, tagName);
        return true;
    }

    private File getSavedApk() {
        String path = getContext().getSharedPreferences(PREFS, 0).getString("apkPath", null);
        return path == null ? null : new File(path);
    }

    private void clearSavedApk() {
        getContext().getSharedPreferences(PREFS, 0).edit().remove("apkPath").remove("sha256").remove("versionCode").apply();
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return toHex(digest.digest());
    }

    private String toHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) value.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return value.toString();
    }

    @Override
    protected void handleOnDestroy() {
        cancelRequested.set(true);
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class UpdateException extends Exception {
        final String code;
        UpdateException(String message, String code) { super(message); this.code = code; }
    }
}
