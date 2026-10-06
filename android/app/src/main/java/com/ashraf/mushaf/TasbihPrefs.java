package com.ashraf.mushaf;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * حالة ويدجت المسبحة لكل نسخة ويدجت بشكل مستقل: الذكر المختار حاليًا + عدّاد منفصل لكل ذكر
 * (تبديل الذكر مش بيصفّر العدّ، ولما ترجع للذكر تلاقي عدّه زي ما سبته).
 * إعدادات الشكل (فاتح/داكن، الشفافية، لون الخط) بتتخزن في WidgetPrefs زي باقي الويدجتات.
 */
public final class TasbihPrefs {

    private static final String PREFS_NAME = "tasbih_widget";
    private static final int MAX_COUNT = 999_999;

    /** نفس قائمة الأذكار في شاشة المسبحة داخل التطبيق (TASBIH_DHIKR_LIST) */
    public static final String[] DHIKR = {
            "سبحان الله وبحمده", "سبحان الله", "الحمد لله", "الله أكبر",
            "لا إله إلا الله", "أستغفر الله", "لا حول ولا قوة إلا بالله"
    };
    private static final String CUSTOM_DHIKR_KEY = "custom_dhikr_list";

    /** هدف الجولة لكل الأذكار = عدد الحبّات في الحلقة (٣٣). بعد ما يوصله العدّ بتبدأ جولة جديدة */
    public static final int TARGET = 33;

    private TasbihPrefs() { }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static int getIndex(Context context, int widgetId) {
        int i = prefs(context).getInt("idx_" + widgetId, 0);
        return (i >= 0 && i < getDhikrList(context).size()) ? i : 0;
    }

    /** الأذكار الافتراضية متبوعة بالأذكار التي أضافها المستخدم من إعدادات الويدجت. */
    public static List<String> getDhikrList(Context context) {
        List<String> names = new ArrayList<>(Arrays.asList(DHIKR));
        String saved = prefs(context).getString(CUSTOM_DHIKR_KEY, "");
        if (saved == null || saved.isEmpty()) return names;
        for (String name : saved.split("\\n")) {
            String clean = name.trim();
            if (!clean.isEmpty() && !names.contains(clean)) names.add(clean);
        }
        return names;
    }

    /** يضيف ذكرًا مخصصًا مرة واحدة، ويرجع فهرسه في القائمة الكاملة، أو قيمة سالبة عند الخطأ/التكرار. */
    public static int addCustomDhikr(Context context, String value) {
        String name = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) return -1;
        List<String> names = getDhikrList(context);
        int existing = names.indexOf(name);
        if (existing >= 0) return -2;
        names.add(name);
        StringBuilder custom = new StringBuilder();
        for (int i = DHIKR.length; i < names.size(); i++) {
            if (custom.length() > 0) custom.append('\n');
            custom.append(names.get(i));
        }
        prefs(context).edit().putString(CUSTOM_DHIKR_KEY, custom.toString()).apply();
        return names.size() - 1;
    }

    public static String getDhikr(Context context, int index) {
        List<String> names = getDhikrList(context);
        return index >= 0 && index < names.size() ? names.get(index) : DHIKR[0];
    }

    public static void setIndex(Context context, int widgetId, int index) {
        int max = getDhikrList(context).size();
        if (index < 0 || index >= max) return;
        prefs(context).edit().putInt("idx_" + widgetId, index).apply();
    }

    /** delta = +1 للذكر التالي (بيلف على القائمة) */
    public static int shiftIndex(Context context, int widgetId, int delta) {
        int n = getDhikrList(context).size();
        int next = ((getIndex(context, widgetId) + delta) % n + n) % n;
        prefs(context).edit().putInt("idx_" + widgetId, next).apply();
        return next;
    }

    public static int getCount(Context context, int widgetId, int dhikrIndex) {
        return prefs(context).getInt("count_" + widgetId + "_" + dhikrIndex, 0);
    }

    /** يزوّد العدّاد 1 ويرجّع القيمة الجديدة */
    public static int increment(Context context, int widgetId, int dhikrIndex) {
        SharedPreferences p = prefs(context);
        String key = "count_" + widgetId + "_" + dhikrIndex;
        int next = Math.min(MAX_COUNT, p.getInt(key, 0) + 1);
        p.edit().putInt(key, next).apply();
        return next;
    }

    /** تصفير عدّاد الذكر الحالي بس */
    public static void resetCurrent(Context context, int widgetId) {
        prefs(context).edit()
                .putInt("count_" + widgetId + "_" + getIndex(context, widgetId), 0)
                .apply();
    }

    public static void remove(Context context, int widgetId) {
        SharedPreferences p = prefs(context);
        SharedPreferences.Editor editor = p.edit().remove("idx_" + widgetId);
        String prefix = "count_" + widgetId + "_";
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, ?> e : p.getAll().entrySet()) {
            if (e.getKey().startsWith(prefix)) keys.add(e.getKey());
        }
        for (String k : keys) editor.remove(k);
        editor.remove("count_" + widgetId);   // مفتاح قديم من نسخة سابقة
        editor.apply();
    }
}
