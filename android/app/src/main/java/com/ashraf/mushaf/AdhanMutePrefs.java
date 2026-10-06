package com.ashraf.mushaf;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * تخزين حالة "كتم الأذان مؤقتًا" اللي بيتحكم فيها المستخدم من بلاطة (Tile) في
 * لوحة الإشعارات السريعة (Quick Settings). لما الحالة دي تبقى مفعّلة، خدمة
 * تشغيل الأذان (AdhanAlarmService) بتتخطى تشغيل الصوت وبتكتفي بإشعار هادئ بس،
 * وبترجع تشتغل عادي تاني أول ما المستخدم يلغي تفعيل البلاطة يدويًا.
 */
public class AdhanMutePrefs {

    private static final String PREFS_NAME = "adhan_mute_settings";
    private static final String KEY_MUTED = "adhan_muted";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static boolean isMuted(Context context) {
        return prefs(context).getBoolean(KEY_MUTED, false);
    }

    public static void setMuted(Context context, boolean muted) {
        prefs(context).edit().putBoolean(KEY_MUTED, muted).apply();
    }

    public static boolean toggle(Context context) {
        boolean newValue = !isMuted(context);
        setMuted(context, newValue);
        return newValue;
    }
}
