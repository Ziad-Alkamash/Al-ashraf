package com.ashraf.mushaf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

// كود مشترك لجدولة/إلغاء منبّه "الصلاة على النبي ﷺ" على مستوى AlarmManager،
// مستخدَم من ٣ أماكن (SalawatAlarmPlugin وقت أول تفعيل من المستخدم،
// SalawatAlarmService وقت إعادة الجدولة الذاتية بعد كل رنة، وBootReceiver
// وقت إرجاع الجدولة بعد ريستارت الموبايل) عشان الكود ميتكررش ٣ مرات
final class SalawatAlarmScheduler {
    private static final int ALARM_REQUEST_ID = 9500;

    private SalawatAlarmScheduler() { }

    private static PendingIntent buildPendingIntent(Context context) {
        Intent intent = new Intent(context, SalawatAlarmReceiver.class);
        return PendingIntent.getBroadcast(
            context, ALARM_REQUEST_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // بيرجع true لو نجح الجدولة "الدقيقة" فعلًا، وfalse لو رجع لجدولة تقريبية
    // بديلة (يعني إذن المنبّهات الدقيقة مش متاح) — لسه بيجدول في الحالتين،
    // فرقهم بس دقة التوقيت مش وصول التذكير من عدمه
    static boolean scheduleExactAt(Context context, long atMillis) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return false;
        PendingIntent pendingIntent = buildPendingIntent(context);

        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms();
        try {
            if (exact) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pendingIntent);
                return true;
            } else {
                // من غير إذن "المنبّهات الدقيقة" (أندرويد 12+)، برضو بنجدول منبّه
                // تقريبي بدل ما نسيب التذكير يقف تمامًا — أفضل من عدم الوصول خالص
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pendingIntent);
                return false;
            }
        } catch (SecurityException e) {
            try {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pendingIntent);
            } catch (Exception ignored) { /* تجاهل */ }
            return false;
        }
    }

    static void cancel(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        alarmManager.cancel(buildPendingIntent(context));
    }
}
