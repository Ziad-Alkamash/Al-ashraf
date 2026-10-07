package com.ashraf.mushaf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;

final class AdhkarAlarmScheduler {
    static final String PREFS_NAME = "MushafAdhkarAlarm";
    private static final int SABAH_REQUEST_ID = 10610;
    private static final int MASAA_REQUEST_ID = 10611;

    private AdhkarAlarmScheduler() { }

    static boolean isValidKind(String kind) {
        return "sabah".equals(kind) || "masaa".equals(kind);
    }

    static void configure(Context context, String kind, boolean enabled, int hour, int minute) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prefix = kind + ".";
        boolean sameTime = prefs.getBoolean(prefix + "enabled", false)
            && prefs.getInt(prefix + "hour", -1) == hour
            && prefs.getInt(prefix + "minute", -1) == minute;
        long nextAt = prefs.getLong(prefix + "nextAt", 0L);

        prefs.edit()
            .putBoolean(prefix + "enabled", enabled)
            .putInt(prefix + "hour", hour)
            .putInt(prefix + "minute", minute)
            .apply();

        if (!enabled) {
            cancel(context, kind);
            prefs.edit().putLong(prefix + "nextAt", 0L).apply();
            return;
        }

        if (!sameTime || nextAt <= System.currentTimeMillis()) nextAt = nextOccurrence(hour, minute, System.currentTimeMillis());
        scheduleAt(context, kind, nextAt);
    }

    static void restore(Context context, String kind) {
        if (!isValidKind(kind)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prefix = kind + ".";
        if (!prefs.getBoolean(prefix + "enabled", false)) return;
        int hour = prefs.getInt(prefix + "hour", "sabah".equals(kind) ? 8 : 17);
        int minute = prefs.getInt(prefix + "minute", 0);
        long nextAt = prefs.getLong(prefix + "nextAt", 0L);
        if (nextAt <= System.currentTimeMillis()) nextAt = nextOccurrence(hour, minute, System.currentTimeMillis());
        scheduleAt(context, kind, nextAt);
    }

    static void rescheduleForLocalTime(Context context, String kind) {
        if (!isValidKind(kind)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prefix = kind + ".";
        if (!prefs.getBoolean(prefix + "enabled", false)) return;
        int hour = prefs.getInt(prefix + "hour", "sabah".equals(kind) ? 8 : 17);
        int minute = prefs.getInt(prefix + "minute", 0);
        scheduleAt(context, kind, nextOccurrence(hour, minute, System.currentTimeMillis()));
    }

    static void fireAndRenew(Context context, String kind) {
        if (!isValidKind(kind)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String prefix = kind + ".";
        if (!prefs.getBoolean(prefix + "enabled", false)) return;
        int hour = prefs.getInt(prefix + "hour", "sabah".equals(kind) ? 8 : 17);
        int minute = prefs.getInt(prefix + "minute", 0);

        long tomorrowAt = nextDayOccurrence(hour, minute);
        scheduleAt(context, kind, tomorrowAt);
        AdhkarAlarmNotifications.show(context, kind, variationForToday());
    }

    static void cancel(Context context, String kind) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager != null) manager.cancel(pendingIntent(context, kind));
    }

    private static void scheduleAt(Context context, String kind, long atMillis) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(kind + ".nextAt", atMillis).apply();
        PendingIntent intent = pendingIntent(context, kind);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms();
        try {
            if (exact) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, intent);
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, intent);
        } catch (SecurityException e) {
            try { manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, intent); }
            catch (Exception ignored) { /* يظل الإعداد محفوظًا ليُستعاد عند فتح التطبيق أو إعادة تشغيل الهاتف */ }
        }
    }

    private static PendingIntent pendingIntent(Context context, String kind) {
        Intent intent = new Intent(context, AdhkarAlarmReceiver.class);
        intent.setAction("com.ashraf.mushaf.Adhkar." + kind);
        intent.putExtra("kind", kind);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, requestId(kind), intent, flags);
    }

    private static int requestId(String kind) {
        return "sabah".equals(kind) ? SABAH_REQUEST_ID : MASAA_REQUEST_ID;
    }

    private static long nextOccurrence(int hour, int minute, long nowMillis) {
        Calendar next = Calendar.getInstance();
        next.setTimeInMillis(nowMillis);
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, minute);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= nowMillis) next.add(Calendar.DAY_OF_YEAR, 1);
        return next.getTimeInMillis();
    }

    private static long nextDayOccurrence(int hour, int minute) {
        Calendar next = Calendar.getInstance();
        next.add(Calendar.DAY_OF_YEAR, 1);
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, minute);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        return next.getTimeInMillis();
    }

    private static int variationForToday() {
        Calendar today = Calendar.getInstance();
        long previousYears = today.get(Calendar.YEAR) - 1L;
        long dayNumber = previousYears * 365L + previousYears / 4L - previousYears / 100L
            + previousYears / 400L + today.get(Calendar.DAY_OF_YEAR) - 1L;
        return (int) (dayNumber % 3L);
    }
}

