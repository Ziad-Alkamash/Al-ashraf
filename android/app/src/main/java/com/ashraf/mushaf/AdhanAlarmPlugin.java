package com.ashraf.mushaf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// بلجن Capacitor مخصص: بيسجّل "منبّه" حقيقي في نظام أندرويد (AlarmManager) بيشتغل حتى لو
// التطبيق مقفول تمامًا من الذاكرة. لما الميعاد يجي، الأذان الكامل بيتشغّل من نفس ملفات
// الأذان الموجودة أصلاً في www/audio/adhan (بيتقروا مباشرة من الـ APK assets من غير
// ما تتكرر أو تتحط في مكان تاني).
@CapacitorPlugin(name = "AdhanAlarm")
public class AdhanAlarmPlugin extends Plugin {

    @PluginMethod
    public void schedule(PluginCall call) {
        Integer id = call.getInt("id");
        Long atMillis = call.getLong("atMillis");
        if (id == null || atMillis == null) {
            call.reject("id و atMillis مطلوبين");
            return;
        }
        String title = call.getString("title", "حان وقت الصلاة");
        String body = call.getString("body", "حي على الصلاة، حي على الفلاح.");
        String soundAssetName = call.getString("soundAssetName", "makkah.mp3");
        // ثانية "نهاية أول تكبيرتين" لو المستخدم مختار "أذان قصير" (راجع
        // getAdhanShortEndSeconds في app.js) — null/غير موجودة معناها "كامل"،
        // فبنبعتها -1 للـ Service عشان يفرّق بين الحالتين (راجع AdhanAlarmService)
        Double shortEndSecondsObj = call.getDouble("shortEndSeconds");
        double shortEndSeconds = shortEndSecondsObj != null ? shortEndSecondsObj : -1;
        boolean mediaVolume = call.getBoolean("mediaVolume", false);

        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        Intent intent = new Intent(context, AdhanAlarmReceiver.class);
        intent.putExtra("id", (int) id);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("soundAssetName", soundAssetName);
        intent.putExtra("shortEndSeconds", shortEndSeconds);
        intent.putExtra("mediaVolume", mediaVolume);

        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                call.reject("EXACT_ALARM_PERMISSION_NEEDED");
                return;
            }
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pendingIntent);
            JSObject result = new JSObject();
            result.put("scheduled", true);
            call.resolve(result);
        } catch (SecurityException e) {
            call.reject("EXACT_ALARM_PERMISSION_NEEDED", e);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) { call.reject("id مطلوب"); return; }
        Context context = getContext();
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, AdhanAlarmReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        alarmManager.cancel(pendingIntent);
        call.resolve();
    }

    // لو مافيش إذن الـ Exact Alarm (أندرويد 12+)، الدالة دي بترجّع حالته
    @PluginMethod
    public void checkExactAlarmPermission(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            result.put("granted", alarmManager.canScheduleExactAlarms());
        } else {
            result.put("granted", true);
        }
        call.resolve(result);
    }

    // بتودي المستخدم مباشرة لشاشة النظام اللي بتفعّل "Alarms & reminders" (أندرويد 12+)
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("مش متاح على النسخة دي من أندرويد", e);
        }
    }

    // بترجّع حالة بلاطة "كتم الأذان مؤقتًا" (نفس القيمة اللي بتتحكم فيها
    // AdhanMuteTileService من لوحة الإشعارات السريعة) — محتاجينها في الـ JS
    // عشان طبقة "إعادة تشغيل الأذان لو التطبيق كان مفتوح وقت دخول الصلاة"
    // (checkReminders) تحترم نفس الكتم، بدل ما تشغّل الصوت من غير ما تسأل
    @PluginMethod
    public void isMuted(PluginCall call) {
        JSObject result = new JSObject();
        result.put("muted", AdhanMutePrefs.isMuted(getContext()));
        call.resolve(result);
    }

    // إيقاف الأذان لو شغال دلوقتي (مثلاً المستخدم فتح التطبيق وقفل الأذان يدويًا)
    @PluginMethod
    public void stopIfPlaying(PluginCall call) {
        Intent stopIntent = new Intent(getContext(), AdhanAlarmService.class);
        stopIntent.setAction("STOP");
        getContext().startService(stopIntent);
        call.resolve();
    }

    // بعض واجهات أندرويد المعدَّلة (شاومي/هواوي/سامسونج وغيرها) بتوقف أو بتأخّر
    // المنبّهات والخدمات في الخلفية بشكل عدواني حتى مع وجود إذن "المنبّهات
    // الدقيقة" — إعفاء التطبيق من "تحسين استهلاك البطارية" (Battery Optimization)
    // هو الحل الرسمي المعتمد من جوجل لهذه الحالة تحديدًا، وهو السبب الأشهر عمليًا
    // وراء تأخّر إشعارات المواقيت أحيانًا حتى بعد ضبط كل حاجة صح داخل التطبيق
    @PluginMethod
    public void checkBatteryOptimizationExemption(PluginCall call) {
        JSObject result = new JSObject();
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean ignoring = pm != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        result.put("granted", ignoring);
        call.resolve(result);
    }

    // بتودي المستخدم مباشرة لشاشة النظام اللي بتستثني التطبيق من تحسين البطارية
    // (بدون ما نحتاج نمر بشاشة قائمة كل التطبيقات، أسرع وأوضح للمستخدم)
    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("مش متاح على هذه النسخة من أندرويد", e);
        }
    }
}
