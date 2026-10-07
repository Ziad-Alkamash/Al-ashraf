package com.ashraf.mushaf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

// أندرويد بيمسح كل منبّهات AlarmManager تلقائيًا بعد إعادة تشغيل الموبايل.
// الإشعارات العادية (LocalNotifications) بترجع لوحدها لأن بلجن Capacitor نفسه
// عنده Receiver خاص بيعمل كده تلقائيًا (LocalNotificationRestoreReceiver).
// لكن منبّه الأذان الكامل (AdhanAlarm) بلجن مخصص من عندنا، من غير ميزة زي دي —
// فلو الموبايل اتقفل وفتح تاني قبل ما المستخدم يفتح التطبيق، كان الأذان الكامل
// مش هيرن في معاده وهو بالظبط سبب "بيتأخر/مبيشتغلش أحيانًا".
//
// الحل: كل مرة يتجدول فيها الأذان من app.js (scheduleNativeAdhanAlarms)، بيتسجّل
// نسخة من الجدول (id/atMillis/title/body/soundAssetName) في Capacitor Preferences،
// اللي بيتخزن فعليًا في SharedPreferences اسمها "CapacitorStorage" على مستوى
// النظام (مش جوّه الـ WebView زي localStorage، فمتاح هنا بدون فتح أي WebView أو
// حتى تشغيل التطبيق خالص). هنا وقت الإقلاع بنقرأها مباشرة ونعيد تسجيل أي منبّه
// لسه معاده جاي في AlarmManager، فيرجع الأذان يشتغل في معاده حتى لو المستخدم
// ما فتحش التطبيق بعد الريستارت
public class BootReceiver extends BroadcastReceiver {
    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String SCHEDULE_KEY = "nativeAdhanSchedule";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return;
        // بعض واجهات الأندرويد المعدَّلة (شاومي/هواوي وغيرها) بتبعت QUICKBOOT_POWERON
        // بدل BOOT_COMPLETED القياسي أحيانًا، فبنستقبل الاتنين لضمان التوافق الأوسع
        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);
        boolean isTimeChange = Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action);
        boolean isAppUpdated = Intent.ACTION_MY_PACKAGE_REPLACED.equals(action);
        if (!isBoot && !isTimeChange && !isAppUpdated) return;

        if (isBoot) {
            rescheduleAdhanAlarms(context);
            rescheduleSalawatAlarm(context);
        }
        if (isTimeChange) {
            AdhkarAlarmScheduler.rescheduleForLocalTime(context, "sabah");
            AdhkarAlarmScheduler.rescheduleForLocalTime(context, "masaa");
        } else {
            AdhkarAlarmScheduler.restore(context, "sabah");
            AdhkarAlarmScheduler.restore(context, "masaa");
        }
    }

    // نفس فكرة رجوع منبّه الأذان بعد الريستارت فوق، لكن لتذكير "صلِّ على محمد
    // ﷺ" الدوري (راجع SalawatAlarmService/SalawatAlarmPlugin). هنا مش محتاجين
    // نقرا جدول كامل زي الأذان لأن التذكير ده منبّه واحد بيتجدّد لوحده — كل
    // اللي محتاجينه هو آخر معاد كان متسجّل + مدة التكرار المحفوظين في
    // SharedPreferences مستقلة (MushafSalawatAlarm)
    private void rescheduleSalawatAlarm(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(
            SalawatAlarmService.PREFS_NAME, Context.MODE_PRIVATE
        );
        if (!prefs.getBoolean(SalawatAlarmService.KEY_ENABLED, false)) return;

        int intervalMinutes = prefs.getInt(SalawatAlarmService.KEY_INTERVAL_MIN, 60);
        if (intervalMinutes <= 0) intervalMinutes = 60;

        long nextAt = prefs.getLong(SalawatAlarmService.KEY_NEXT_AT, 0);
        long now = System.currentTimeMillis();
        // لو الموبايل كان مقفول وقت ما الميعاد المحفوظ فات أصلًا (يعني عدّى وقت
        // طويل)، منسيبوش يقف — نجدول أقرب ميعاد جاي (دقيقة من دلوقتي) بدل ما
        // ننتظر لحد دورة تكرار كاملة تانية
        if (nextAt <= now) nextAt = now + 60_000L;

        prefs.edit().putLong(SalawatAlarmService.KEY_NEXT_AT, nextAt).apply();
        SalawatAlarmScheduler.scheduleExactAt(context, nextAt);
    }

    private void rescheduleAdhanAlarms(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(SCHEDULE_KEY, null);
        if (json == null || json.isEmpty()) return;

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        // لو إذن "المنبّهات والتذكيرات" (أندرويد 12+) اتلغى بعد الريستارت لأي سبب،
        // مفيش داعي نحاول ونرمي استثناءات؛ الصف الخاص بيه في الإعدادات هيظهر
        // للمستخدم عادي أول ما يفتح التطبيق (نفس آلية refreshExactAlarmPermissionUI)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) return;

        try {
            JSONArray arr = new JSONArray(json);
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) continue;
                long atMillis = item.optLong("atMillis", 0);
                int id = item.optInt("id", 0);
                if (atMillis <= now || id == 0) continue; // ميعاد فات بالفعل، تجاهله

                Intent alarmIntent = new Intent(context, AdhanAlarmReceiver.class);
                alarmIntent.putExtra("id", id);
                alarmIntent.putExtra("title", item.optString("title", "حان وقت الصلاة 🕌"));
                alarmIntent.putExtra("body", item.optString("body", "حي على الصلاة، حي على الفلاح."));
                alarmIntent.putExtra("soundAssetName", item.optString("soundAssetName", "makkah.mp3"));
                alarmIntent.putExtra("mediaVolume", item.optBoolean("mediaVolume", false));

                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, id, alarmIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                try {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pendingIntent);
                } catch (SecurityException e) {
                    // تجاهل هذا المنبّه بالذات وكمّل الباقي
                }
            }
        } catch (Exception e) {
            // بيانات محفوظة غير متوقعة (نسخة قديمة من الفورمات مثلاً) — تجاهل بأمان
        }
    }
}
