package com.ashraf.mushaf;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Context;
import android.content.SharedPreferences;

/**
 * تخزين إعدادات كل نسخة ويدجت بشكل مستقل (المستخدم ممكن يضيف أكتر من نسخة من نفس
 * الويدجت بإعدادات مختلفة): درجة الشفافية والوضع (فاتح/داكن) لكل الويدجتات، وفترة
 * تبديل الدعاء الخاصة بويدجت الدعاء فقط. الإعدادات دي بتتغيّر من شاشة إعدادات الويدجت
 * (WidgetConfigActivity) اللي بتظهر تلقائيًا لحظة إضافة الويدجت، ومن نفس الشاشة
 * لو المستخدم فتحها تاني بالضغط المطوّل على الويدجت واختيار "تعديل".
 */
public class WidgetPrefs {

    private static final String PREFS_NAME = "widget_settings";
    public static final int DEFAULT_TRANSPARENCY = 100; // 100 = معتم بالكامل بدون شفافية
    public static final int DEFAULT_INTERVAL_MINUTES = 30;
    public static final boolean DEFAULT_DARK = false;    // الافتراضي: فاتح زي صفحة الصوتيات

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static int getTransparency(Context context, int widgetId) {
        return prefs(context).getInt("transparency_" + widgetId, DEFAULT_TRANSPARENCY);
    }

    public static void setTransparency(Context context, int widgetId, int percentOpaque) {
        prefs(context).edit().putInt("transparency_" + widgetId, percentOpaque).apply();
    }

    public static int getIntervalMinutes(Context context, int widgetId) {
        return prefs(context).getInt("interval_" + widgetId, DEFAULT_INTERVAL_MINUTES);
    }

    public static void setIntervalMinutes(Context context, int widgetId, int minutes) {
        prefs(context).edit().putInt("interval_" + widgetId, minutes).apply();
    }

    /** true = الويدجت داكن، false = فاتح */
    public static boolean isDark(Context context, int widgetId) {
        return prefs(context).getBoolean("dark_" + widgetId, DEFAULT_DARK);
    }

    public static void setDark(Context context, int widgetId, boolean dark) {
        prefs(context).edit().putBoolean("dark_" + widgetId, dark).apply();
    }

    /**
     * لون خط مخصص يختاره المستخدم بنفسه (بدل اللون الافتراضي حسب الوضع فاتح/داكن)، عشان
     * يتوافق مع خلفية الفون اللي هو شايفها. بيتطبّق على نص الدعاء في ويدجت الدعاء، وعلى
     * خط التواريخ (الهجري/اليوم/الميلادي) وخط الشروق في ويدجت المواقيت. لو مفيش لون مخصص
     * محفوظ، بيرجع الويدجت لسلوكه الافتراضي (لون الوضع العادي، أو تلقائي حسب خلفية الفون
     * لو الويدجت شفاف بالكامل).
     */
    public static boolean hasCustomFontColor(Context context, int widgetId) {
        return prefs(context).getBoolean("font_color_set_" + widgetId, false);
    }

    /** يرجّع اللون المخصص المحفوظ، أو fallback لو معملش المستخدم أي اختيار */
    public static int getFontColor(Context context, int widgetId, int fallback) {
        if (!hasCustomFontColor(context, widgetId)) return fallback;
        return prefs(context).getInt("font_color_" + widgetId, fallback);
    }

    /** color = null يعني رجوع للسلوك الافتراضي (تلقائي)، وإلا يحفظ اللون المخصص */
    public static void setFontColor(Context context, int widgetId, Integer color) {
        SharedPreferences.Editor editor = prefs(context).edit();
        if (color == null) {
            editor.putBoolean("font_color_set_" + widgetId, false);
            editor.remove("font_color_" + widgetId);
        } else {
            editor.putBoolean("font_color_set_" + widgetId, true);
            editor.putInt("font_color_" + widgetId, color);
        }
        editor.apply();
    }

    public static void remove(Context context, int widgetId) {
        prefs(context).edit()
                .remove("transparency_" + widgetId)
                .remove("interval_" + widgetId)
                .remove("dark_" + widgetId)
                .remove("font_color_set_" + widgetId)
                .remove("font_color_" + widgetId)
                .apply();
    }

    /** true لو الآيدي ده تابع لويدجت الدعاء (عشان نظهر خيار "فترة تبديل الدعاء" بشاشة الإعدادات) */
    public static boolean isDuaWidget(Context context, int widgetId) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            AppWidgetProviderInfo info = manager.getAppWidgetInfo(widgetId);
            return info != null && info.provider != null
                    && info.provider.getClassName().endsWith("DuaWidgetProvider");
        } catch (Exception e) {
            return false;
        }
    }

    /** true لو الآيدي ده تابع لويدجت المسبحة */
    public static boolean isTasbihWidget(Context context, int widgetId) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            AppWidgetProviderInfo info = manager.getAppWidgetInfo(widgetId);
            return info != null && info.provider != null
                    && info.provider.getClassName().endsWith("TasbihWidgetProvider");
        } catch (Exception e) {
            return false;
        }
    }
}
