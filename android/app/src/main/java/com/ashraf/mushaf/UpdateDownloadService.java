package com.ashraf.mushaf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

/** Keeps the verified APK transfer alive while the user continues using the app. */
public class UpdateDownloadService extends Service {
    private static final String CHANNEL_ID = "apk-update-download";
    private static final int NOTIFICATION_ID = 54031;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static volatile UpdateDownloadService activeService;
    private String versionName = "";
    private PowerManager.WakeLock downloadWakeLock;

    public static void start(Context context, String version) {
        Intent intent = new Intent(context, UpdateDownloadService.class);
        intent.putExtra("versionName", version == null ? "" : version);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void updateProgress(Context context, long downloaded, long total) {
        MAIN.post(() -> {
            UpdateDownloadService service = activeService;
            if (service != null) service.showProgress(downloaded, total);
        });
    }

    public static void finish(Context context, boolean success, String detail) {
        MAIN.post(() -> {
            UpdateDownloadService service = activeService;
            if (service != null) service.showFinished(success, detail);
        });
    }

    public static void cancel(Context context) {
        MAIN.post(() -> {
            UpdateDownloadService service = activeService;
            if (service != null) {
                service.stopForeground(true);
                service.stopSelf();
            } else {
                NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) manager.cancel(NOTIFICATION_ID);
            }
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = this;
        ensureChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        versionName = intent == null ? "" : intent.getStringExtra("versionName");
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null && (downloadWakeLock == null || !downloadWakeLock.isHeld())) {
            downloadWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":apk-update");
            downloadWakeLock.acquire(2L * 60L * 60L * 1000L);
        }
        Notification notification = buildProgress(0, -1);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        if (activeService == this) activeService = null;
        super.onDestroy();
    }

    private void showProgress(long downloaded, long total) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            try { manager.notify(NOTIFICATION_ID, buildProgress(downloaded, total)); }
            catch (SecurityException ignored) { /* FGS still runs when notification permission is denied. */ }
        }
    }

    private Notification buildProgress(long downloaded, long total) {
        String body = total > 0
            ? "تم تنزيل " + formatBytes(downloaded) + " من " + formatBytes(total)
            : "جارٍ تنزيل ملف التحديث";
        int progress = total > 0 ? (int) Math.min(100, downloaded * 100 / total) : 0;
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("تنزيل تحديث المصحف الأشرف")
            .setContentText(body)
            .setSubText(versionName)
            .setContentIntent(openAppPendingIntent(this))
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentInfo(total > 0 ? progress + "%" : versionName)
            .setProgress(100, progress, total <= 0)
            .build();
    }

    private void showFinished(boolean success, String detail) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            try { manager.notify(NOTIFICATION_ID, buildFinished(this, success, detail)); }
            catch (SecurityException ignored) { /* Android may hide drawer notifications when permission is denied. */ }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_DETACH);
        else stopForeground(false);
        releaseWakeLock();
        stopSelf();
    }

    private void releaseWakeLock() {
        if (downloadWakeLock != null && downloadWakeLock.isHeld()) downloadWakeLock.release();
        downloadWakeLock = null;
    }

    private static Notification buildFinished(Context context, boolean success, String detail) {
        ensureChannel(context);
        String message = success
            ? "اكتمل التنزيل والتحقق. اضغط هنا للمتابعة إلى التثبيت."
            : "تعذر تنزيل التحديث. اضغط هنا لفتح التطبيق والمحاولة مرة أخرى.";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(success ? "التحديث جاهز للتثبيت" : "تعذر إكمال التحديث")
            .setContentText(message)
            .setContentIntent(openAppPendingIntent(context))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setOngoing(false);
        if (detail != null && !detail.isEmpty()) builder.setStyle(new NotificationCompat.BigTextStyle().bigText(detail));
        return builder.build();
    }

    private static PendingIntent openAppPendingIntent(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("open_update_ready", true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, NOTIFICATION_ID, launch, flags);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null && manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID, "تنزيل تحديث التطبيق", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private static String formatBytes(long bytes) {
        if (bytes >= 1024L * 1024L) return String.format(java.util.Locale.ROOT, "%.1f ميجابايت", bytes / (1024.0 * 1024.0));
        return String.format(java.util.Locale.ROOT, "%.0f كيلوبايت", bytes / 1024.0);
    }
}
