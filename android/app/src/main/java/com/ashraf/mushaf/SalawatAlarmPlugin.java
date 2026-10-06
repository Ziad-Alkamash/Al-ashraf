package com.ashraf.mushaf;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// بلجن Capacitor لتذكير "صلِّ على محمد ﷺ" الدوري، بنفس فلسفة AdhanAlarmPlugin:
// منبّه AlarmManager حقيقي شغال حتى لو التطبيق مقفول تمامًا. الفرق الجوهري عن
// النظام القديم (LocalNotifications دفعة ٢٠ مرة): هنا بيتجدّد لوحده للأبد
// (self-renewing من جوّه SalawatAlarmService نفسه بعد كل رنة) من غير حد أقصى،
// وبيرجع تلقائيًا بعد أي ريستارت للموبايل (BootReceiver)، وبيشغّل الصوت يدويًا
// فمش عرضة لمشكلة "صوت القناة المُثبَّت" اللي كانت بتخلي الصوت يختفي أحيانًا.
@CapacitorPlugin(name = "SalawatAlarm")
public class SalawatAlarmPlugin extends Plugin {

    // بتتنادى مش بس لما المستخدم يفعّل التذكير أو يغيّر مدة التكرار، لكن كمان
    // تلقائيًا كل مرة مواقيت الصلاة بتتحدّث (يعني كل فتح تطبيق/رجوع من الخلفية
    // — راجع scheduleAllOsNotifications في app.js). عشان كده لازم تكون "ذكية"
    // (idempotent): لو التذكير شغال أصلاً بنفس المدة وفيه منبّه محفوظ لسه
    // معاده مستقبلي، بنسيبه زي ما هو من غير ما نصفّر العدّاد. من غيرها، كل فتح
    // للتطبيق كان بيرجّع العداد لمدة كاملة من الأول، فالتذكير ما كانش بيوصل
    // إلا لو المستخدم سايب التطبيق من غير فتح لمدة التكرار كاملة متواصلة —
    // وده بالظبط سبب "بيشتغل مرة وبعدين يقف ساعات" اللي كان بيحصل
    @PluginMethod
    public void schedule(PluginCall call) {
        Integer intervalMinutes = call.getInt("intervalMinutes", 60);
        if (intervalMinutes == null || intervalMinutes <= 0) intervalMinutes = 60;

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(
            SalawatAlarmService.PREFS_NAME, Context.MODE_PRIVATE
        );

        boolean wasEnabled = prefs.getBoolean(SalawatAlarmService.KEY_ENABLED, false);
        int savedInterval = prefs.getInt(SalawatAlarmService.KEY_INTERVAL_MIN, 0);
        long savedNextAt = prefs.getLong(SalawatAlarmService.KEY_NEXT_AT, 0);
        long now = System.currentTimeMillis();

        boolean sameInterval = wasEnabled && savedInterval == intervalMinutes;
        boolean hasPendingAlarm = savedNextAt > now;

        // لو مفيش تغيير حقيقي (نفس المدة + فيه منبّه محفوظ لسه في المستقبل)،
        // سيب معاده زي ما هو. غير كده (أول تفعيل / تغيير المدة / مفيش منبّه
        // صالح أصلًا) احسب معاد جديد من دلوقتي زي المنطق الأصلي بالظبط
        long nextAt = (sameInterval && hasPendingAlarm) ? savedNextAt : (now + (intervalMinutes * 60_000L));

        prefs.edit()
            .putBoolean(SalawatAlarmService.KEY_ENABLED, true)
            .putInt(SalawatAlarmService.KEY_INTERVAL_MIN, intervalMinutes)
            .putLong(SalawatAlarmService.KEY_NEXT_AT, nextAt)
            .apply();

        // بننادي الجدولة دايمًا حتى لو المعاد ما اتغيّرش — ده كمان بيعمل
        // "self-heal" لو أي OEM قفل المنبّه من AlarmManager من غير ما يمسح
        // الـ SharedPreferences بتاعتنا، من غير ما يصفّر العداد
        boolean exact = SalawatAlarmScheduler.scheduleExactAt(context, nextAt);

        JSObject result = new JSObject();
        result.put("scheduled", true);
        result.put("exact", exact);
        call.resolve(result);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(
            SalawatAlarmService.PREFS_NAME, Context.MODE_PRIVATE
        );
        prefs.edit().putBoolean(SalawatAlarmService.KEY_ENABLED, false).apply();
        SalawatAlarmScheduler.cancel(context);
        call.resolve();
    }
}
