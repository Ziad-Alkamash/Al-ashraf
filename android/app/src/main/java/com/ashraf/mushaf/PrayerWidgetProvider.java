package com.ashraf.mushaf;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.widget.RemoteViews;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ويدجت مواقيت الصلاة — بنفس شكل صفحة "مواقيت الصلاة" في التطبيق (طابع صفحة الصوتيات):
 * الصلاة القادمة + وقتها على اليمين، وكبسولة العدّاد التنازلي (أيقونة ساعة) والشروق على
 * الشمال، وتحتهم كارت الصلوات الخمس بأعمدة (أيقونة + اسم + وقت) والقادمة مميّزة.
 * الوضع (فاتح/داكن) والشفافية بيتحددوا لكل ويدجت من WidgetConfigActivity.
 */
public class PrayerWidgetProvider extends AppWidgetProvider {

    private static final String PREFS_NAME = "CapacitorStorage";
    private static final String DATA_KEY = "prayerWidgetData";
    private static final String[] ORDER = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};

    // نلتقط أول رقمين متتاليين مفصولين بـ ":" من أي نص وقت قادم من الـ API، حتى لو
    // احتوى على لاحقة منطقة زمنية أو أي نص إضافي، لتفادي أي استثناء عند التحويل لأرقام
    private static final Pattern TIME_PATTERN = Pattern.compile("(\\d{1,2}):(\\d{2})");

    private static String arabicName(String key) {
        switch (key) {
            case "Fajr": return "الفجر";
            case "Sunrise": return "الشروق";
            case "Dhuhr": return "الظهر";
            case "Asr": return "العصر";
            case "Maghrib": return "المغرب";
            case "Isha": return "العشاء";
            default: return key;
        }
    }

    private static final String[] WEEKDAYS = {
        "", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"
    }; // فهرس مطابق لـ Calendar.DAY_OF_WEEK (١=الأحد...٧=السبت)، العنصر صفر غير مستخدم

    private static final String[] GREGORIAN_MONTHS = {
        "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
        "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
    };

    /** اسم اليوم الحالي بالعربي، مثال: "الأحد" */
    private static String arabicWeekday(Calendar now) {
        int idx = now.get(Calendar.DAY_OF_WEEK);
        return (idx >= 1 && idx < WEEKDAYS.length) ? WEEKDAYS[idx] : "";
    }

    /** التاريخ الميلادي الحالي بصيغة "٢٠ سبتمبر ٢٠٢٦" (بنفس طابع أرقام باقي الويدجت: أرقام لاتينية عادية) */
    private static String gregorianDateText(Calendar now) {
        int day = now.get(Calendar.DAY_OF_MONTH);
        int monthIdx = now.get(Calendar.MONTH);
        int year = now.get(Calendar.YEAR);
        String month = (monthIdx >= 0 && monthIdx < GREGORIAN_MONTHS.length) ? GREGORIAN_MONTHS[monthIdx] : "";
        return day + " " + month + " " + year;
    }

    private static int iconFor(String key) {
        switch (key) {
            case "Fajr": return R.drawable.ic_wp_fajr;
            case "Dhuhr": return R.drawable.ic_wp_dhuhr;
            case "Asr": return R.drawable.ic_wp_asr;
            case "Maghrib": return R.drawable.ic_wp_maghrib;
            default: return R.drawable.ic_wp_isha;
        }
    }

    /** يحوّل نص وقت مثل "04:12" أو "04:12 (EET)" إلى عدد دقائق منذ منتصف الليل، أو -1 إن تعذّر ذلك */
    private static int parseMinutes(String raw) {
        if (raw == null) return -1;
        Matcher m = TIME_PATTERN.matcher(raw);
        if (!m.find()) return -1;
        try {
            int h = Integer.parseInt(m.group(1));
            int mm = Integer.parseInt(m.group(2));
            if (h < 0 || h > 23 || mm < 0 || mm > 59) return -1;
            return h * 60 + mm;
        } catch (Exception e) {
            return -1;
        }
    }

    // يحوّل نص وقت مثل "04:12" أو "16:45 (EET)" لصيغة ١٢ ساعة عربية، مثال: "٤:١٢ ص" أو "٤:٤٥ م"
    private static String cleanTime(String raw) {
        if (raw == null) return "--:--";
        Matcher m = TIME_PATTERN.matcher(raw);
        if (!m.find()) return "--:--";
        int h24 = Integer.parseInt(m.group(1));
        String mm = m.group(2);
        String period = h24 < 12 ? "ص" : "م";
        int h12 = h24 % 12;
        if (h12 == 0) h12 = 12;
        return h12 + ":" + mm + " " + period;
    }

    /** يرسم نص السطر الواحد بخط تاجوال ويحطه في ImageView بدل TextView (راجع WidgetTextRenderer) */
    private static void setBitmapText(Context context, RemoteViews views, int viewId, String text, float sizeSp, int colorArgb) {
        views.setImageViewBitmap(viewId,
                WidgetTextRenderer.renderSingleLineText(context, text, sizeSp, colorArgb, R.font.tajawal_bold));
    }

    /** نفس اللي فوق بس بيصغّر الخط تلقائيًا لو النص أعرض من maxWidthDp */
    private static void setFitText(Context context, RemoteViews views, int viewId, String text,
                                   float maxSp, float minSp, int maxWidthDp, int colorArgb) {
        views.setImageViewBitmap(viewId,
                WidgetTextRenderer.renderSingleLineTextFit(context, text, maxSp, minSp, maxWidthDp,
                        colorArgb, R.font.tajawal_bold));
    }

    /** لون الأيقونات (مش النصوص) للعناصر اللي بترسم مباشرة فوق خلفية الفون: تاخد لون التعبئة
     *  المتباين نفسه بتاع النصوص المجاورة لها لو الويدجت بدون خلفية خالص، وإلا لون الوضع العادي */
    private static int resolveOpenIconColor(boolean transparentBg, int[] openFillStroke, int fallbackColor) {
        return transparentBg ? openFillStroke[0] : fallbackColor;
    }

    /** نص بيتصغّر تلقائيًا زي setFitText، لكن لو الويدجت بدون خلفية خالص (transparentBg) بيترسم
     *  بلون تعبئة + حد متباين (بدل ما نعتمد على اكتشاف لون خلفية الفون اللي مش موثوق على كل
     *  الأجهزة) عشان يفضل واضح فوق أي خلفية؛ وإلا بياخد لون الوضع العادي زي أي نص تاني */
    private static void setOpenFitText(Context context, RemoteViews views, int viewId, String text,
                                       float maxSp, float minSp, int maxWidthDp, int fallbackColor,
                                       boolean transparentBg, int[] openFillStroke) {
        if (transparentBg) {
            views.setImageViewBitmap(viewId, WidgetTextRenderer.renderSingleLineTextFitStroked(
                    context, text, maxSp, minSp, maxWidthDp, openFillStroke[0], openFillStroke[1], 1.0f, R.font.tajawal_bold));
        } else {
            setFitText(context, views, viewId, text, maxSp, minSp, maxWidthDp, fallbackColor);
        }
    }

    /** نفس setOpenFitText، لكن لو المستخدم اختار لون خط مخصص من شاشة إعدادات الويدجت (لخط
     *  التواريخ وخط الشروق) بنستخدم اختياره مباشرة بدل السلوك التلقائي، سواء كان الويدجت
     *  بخلفية أو من غيرها — لأنه هو حدد اللون بنفسه عشان يتوافق مع خلفيته */
    private static void setDateOrSunriseText(Context context, RemoteViews views, int viewId, String text,
                                             float maxSp, float minSp, int maxWidthDp, int fallbackColor,
                                             boolean transparentBg, int[] openFillStroke,
                                             boolean hasCustomFontColor, int customFontColor) {
        if (hasCustomFontColor) {
            setFitText(context, views, viewId, text, maxSp, minSp, maxWidthDp, customFontColor);
        } else {
            setOpenFitText(context, views, viewId, text, maxSp, minSp, maxWidthDp, fallbackColor, transparentBg, openFillStroke);
        }
    }

    /** يثبّت حجم خط الـ Chronometer الحي بالبكسل مباشرة (density فقط بدون scaledDensity)
     *  عشان يتجاهل إعداد "حجم الخط" بتاع نظام أندرويد، بنفس منطق WidgetTextRenderer.
     *  الـ Chronometer هو العنصر الوحيد في الويدجت اللي لازم يفضل TextView حقيقي (مش صورة)
     *  عشان يتحدث لحظيًا من النظام، فمينفعش يترسم كـ Bitmap زي باقي النصوص */
    private static void lockChronometerTextSize(Context context, RemoteViews views, int viewId, float sizeSp) {
        float px = sizeSp * context.getResources().getDisplayMetrics().density;
        views.setTextViewTextSize(viewId, android.util.TypedValue.COMPLEX_UNIT_PX, px);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, appWidgetManager, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                           int appWidgetId, android.os.Bundle newOptions) {
        updateWidget(context, appWidgetManager, appWidgetId);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetPrefs.remove(context, id);
        }
    }

    /** يُستدعى من onUpdate الدوري كل ٣٠ دقيقة، ومن الإضافة الأصلية فور تحديث المواقيت داخل التطبيق */
    public static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            ComponentName component = new ComponentName(context, PrayerWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(component);
            if (ids == null) return;
            for (int id : ids) {
                updateWidget(context, manager, id);
            }
        } catch (Exception e) {
            // لا نترك أي استثناء يهرب من هنا حتى لا يظهر الويدجت بحالة "تعذّر التحميل"
        }
    }

    public static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_prayer);

        boolean dark = WidgetPrefs.isDark(context, widgetId);
        WidgetTheme theme = WidgetTheme.get(dark);
        int[] size = WidgetBackgroundHelper.currentSizeDp(context, manager, widgetId, 250, 190);

        // خلفية بنفس درجة الشفافية والوضع اللي اختارهم المستخدم من شاشة إعدادات الويدجت
        try {
            int transparency = WidgetPrefs.getTransparency(context, widgetId);
            views.setImageViewBitmap(R.id.widget_prayer_bg,
                    WidgetBackgroundHelper.createBackground(context, size[0], size[1], transparency, dark));
        } catch (Exception ignored) { }

        // كل منطق القراءة والحساب داخل try/catch شامل: أي استثناء غير متوقع هنا
        // كان هو السبب الأرجح في ظهور "تعذّر تحميل الودجت" على الشاشة الرئيسية
        try {
            bindContent(context, views, theme, size, widgetId);
        } catch (Exception outer) {
            // شبكة أمان أخيرة: حتى لو حدث خطأ غير متوقع في أي خطوة، نعرض ودجت بسيط
            // بنص واضح بدل ترك النظام يفشل في تحميله بالكامل
            views = new RemoteViews(context.getPackageName(), R.layout.widget_prayer);
            try {
                setBitmapText(context, views, R.id.widget_prayer_name, "افتح التطبيق لتحديث المواقيت", 14f, theme.ink);
                lockChronometerTextSize(context, views, R.id.widget_prayer_countdown, 13f);
            } catch (Exception ignored) { }
            try {
                int transparency = WidgetPrefs.getTransparency(context, widgetId);
                views.setImageViewBitmap(R.id.widget_prayer_bg,
                        WidgetBackgroundHelper.createBackground(context, size[0], size[1], transparency, dark));
            } catch (Exception ignored) { }
        }

        try {
            manager.updateAppWidget(widgetId, views);
        } catch (Exception ignored) { /* لا شيء أكثر يمكن فعله هنا */ }
    }

    private static void bindContent(Context context, RemoteViews views, WidgetTheme t, int[] size, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(DATA_KEY, null);

        boolean hasData = false;
        String nextName = "افتح التطبيق لتحديث المواقيت";
        String nextTime = "";
        String sunriseTime = "--:--";
        String hijri = "";
        String cityName = "";
        String nextKey = null;
        Integer nextMinutes = null;
        java.util.Map<String, String> cleanTimes = new java.util.HashMap<>();

        if (raw != null) {
            try {
                JSONObject obj = new JSONObject(raw);
                JSONObject timings = obj.getJSONObject("timings");
                hijri = obj.optString("hijri", "");
                cityName = obj.optString("city", "").trim();

                Calendar now = Calendar.getInstance();
                int nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);

                for (String key : ORDER) {
                    cleanTimes.put(key, cleanTime(timings.optString(key, "")));
                }
                sunriseTime = cleanTime(timings.optString("Sunrise", ""));

                for (String key : ORDER) {
                    int mins = parseMinutes(timings.optString(key, ""));
                    if (mins < 0) continue;
                    if (mins > nowMinutes) { nextKey = key; nextMinutes = mins; break; }
                }
                if (nextKey == null) {
                    // بعد العشاء: الصلاة القادمة هي فجر الغد
                    nextKey = "Fajr";
                    int fajrMins = parseMinutes(timings.optString("Fajr", ""));
                    nextMinutes = fajrMins >= 0 ? fajrMins + 24 * 60 : null;
                }
                nextTime = cleanTimes.containsKey(nextKey) ? cleanTimes.get(nextKey) : "--:--";
                nextName = arabicName(nextKey);
                hasData = true;
            } catch (Exception e) {
                nextName = "تعذّر تحميل المواقيت";
                nextKey = null;
                nextMinutes = null;
            }
        }

        boolean dark = t.dark;

        // العناصر اللي مالهاش كارت/كبسولة تحتها وبترسم على مساحة الويدجت الشفافة مباشرة
        // (اسم التطبيق فوق، الشروق، وصف التواريخ) لازم لونها يتبع خلفية الفون نفسها لما الويدجت
        // يبقى بدون خلفية خالص (شفافية 0%)، وإلا بتفضل غير واضحة فوق خلفيات الفون الغامقة أو
        // الفاتحة حسب لون النص الثابت للوضع (فاتح/داكن) اللي مختاره المستخدم للويدجت
        boolean transparentBg = WidgetPrefs.getTransparency(context, widgetId) <= 0;
        int[] openFillStroke = transparentBg ? WidgetTheme.adaptiveFillStroke(context) : null;

        // لون خط مخصص اختاره المستخدم بنفسه لخط التواريخ وخط الشروق (شاشة إعدادات الويدجت)
        boolean hasCustomFontColor = WidgetPrefs.hasCustomFontColor(context, widgetId);
        int customFontColor = WidgetPrefs.getFontColor(context, widgetId, t.ink);

        // ألوان/خلفيات العناصر الثابتة حسب الوضع (فاتح/داكن)
        views.setInt(R.id.widget_prayer_card, "setBackgroundResource",
                dark ? R.drawable.widget_wp_card_dark : R.drawable.widget_wp_card_light);
        views.setInt(R.id.widget_prayer_pill, "setBackgroundResource",
                dark ? R.drawable.widget_wp_pill_dark : R.drawable.widget_wp_pill_light);
        // صندوق الهيرو (الصلاة القادمة) مميّز بنفس خلفية وإطار "الفرض القادم" الزيتوني
        views.setInt(R.id.widget_prayer_hero_box, "setBackgroundResource",
                dark ? R.drawable.widget_wp_cell_active_dark : R.drawable.widget_wp_cell_active_light);

        // الهيرو دلوقتي في منتصف الويدجت بعرض كامل تقريبًا (ناقص حشو الجذر وحشو صندوق الهيرو)
        int heroWidthDp = Math.max(70, size[0] - 20 - 36);

        Calendar todayCal = Calendar.getInstance();

        if (!cityName.isEmpty()) {
            setOpenFitText(context, views, R.id.widget_prayer_city, cityName,
                    10.5f, 8f, size[0] - 28, t.ink2, transparentBg, openFillStroke);
            views.setContentDescription(R.id.widget_prayer_city, cityName);
        }

        // ---- الهيرو: الصلاة القادمة ----
        setBitmapText(context, views, R.id.widget_prayer_next_label, "الصلاة القادمة", 10.5f, t.gold);
        setFitText(context, views, R.id.widget_prayer_name, nextName, hasData ? 24f : 14f, 12f, heroWidthDp, t.gold);
        setFitText(context, views, R.id.widget_prayer_time, nextTime, 17f, 12f, heroWidthDp, t.ink);

        // ---- كبسولة العدّاد (أيقونة ساعة + عدّاد حي) ----
        views.setImageViewBitmap(R.id.widget_prayer_clock,
                WidgetTextRenderer.renderIconAvatar(context, R.drawable.ic_wp_clock, 15, 0, t.olive, 1f));
        lockChronometerTextSize(context, views, R.id.widget_prayer_countdown, 13f);
        views.setTextColor(R.id.widget_prayer_countdown, t.olive);
        if (nextMinutes != null) {
            // الحساب بالثواني (مش بالدقيقة) عشان العدّاد يبقى مضبوط لحد الثانية
            Calendar now = Calendar.getInstance();
            int nowSecOfDay = now.get(Calendar.HOUR_OF_DAY) * 3600 + now.get(Calendar.MINUTE) * 60 + now.get(Calendar.SECOND);
            long diffSeconds = Math.max(0L, nextMinutes * 60L - nowSecOfDay);
            long targetElapsedRealtime = SystemClock.elapsedRealtime() + diffSeconds * 1000L;
            views.setChronometerCountDown(R.id.widget_prayer_countdown, true);
            views.setChronometer(R.id.widget_prayer_countdown, targetElapsedRealtime, "%s", true);
        } else {
            views.setChronometerCountDown(R.id.widget_prayer_countdown, false);
            views.setChronometer(R.id.widget_prayer_countdown, SystemClock.elapsedRealtime(), "--:--", false);
        }

        // ---- الشروق ----
        int sunriseIconColor = resolveOpenIconColor(transparentBg, openFillStroke, t.gold);
        views.setImageViewBitmap(R.id.widget_sunrise_icon,
                WidgetTextRenderer.renderIconAvatar(context, R.drawable.ic_wp_sunrise, 15, 0, sunriseIconColor, 1f));
        setDateOrSunriseText(context, views, R.id.widget_sunrise_label, arabicName("Sunrise"),
                11f, 8f, 80, t.ink2, transparentBg, openFillStroke, hasCustomFontColor, customFontColor);
        setDateOrSunriseText(context, views, R.id.widget_sunrise_time, sunriseTime,
                11f, 8f, 80, t.ink, transparentBg, openFillStroke, hasCustomFontColor, customFontColor);

        // ---- كارت الصلوات الخمس ----
        int[][] cards = {
            {R.id.widget_card_fajr, R.id.widget_prayer_fajr_icon, R.id.widget_prayer_fajr_label, R.id.widget_prayer_fajr_time},
            {R.id.widget_card_dhuhr, R.id.widget_prayer_dhuhr_icon, R.id.widget_prayer_dhuhr_label, R.id.widget_prayer_dhuhr_time},
            {R.id.widget_card_asr, R.id.widget_prayer_asr_icon, R.id.widget_prayer_asr_label, R.id.widget_prayer_asr_time},
            {R.id.widget_card_maghrib, R.id.widget_prayer_maghrib_icon, R.id.widget_prayer_maghrib_label, R.id.widget_prayer_maghrib_time},
            {R.id.widget_card_isha, R.id.widget_prayer_isha_icon, R.id.widget_prayer_isha_label, R.id.widget_prayer_isha_time}
        };
        // عرض النص المتاح في الخانة الواحدة (الحشو والهوامش محسوبة) عشان الوقت ما يتقصّش
        int cellTextWidthDp = Math.max(30, (size[0] - 20 - 8 - 8) / 5 - 6);
        for (int i = 0; i < ORDER.length; i++) {
            String key = ORDER[i];
            String time = cleanTimes.containsKey(key) ? cleanTimes.get(key) : "--:--";
            boolean active = key.equals(nextKey);

            // الفرض القادم: خلفية + إطار زيتوني، وأفاتار زيتوني مصمت، ونص ذهبي — زي صفحة المواقيت
            views.setInt(cards[i][0], "setBackgroundResource",
                    active ? (dark ? R.drawable.widget_wp_cell_active_dark : R.drawable.widget_wp_cell_active_light) : 0);
            views.setImageViewBitmap(cards[i][1], WidgetTextRenderer.renderIconAvatar(
                    context, iconFor(key), 26,
                    active ? t.olive : t.oliveSoft,
                    active ? t.onOlive : t.olive,
                    0.62f));
            setFitText(context, views, cards[i][2], arabicName(key), 11.5f, 8f, cellTextWidthDp, active ? t.gold : t.ink);
            setFitText(context, views, cards[i][3], time, 11.5f, 8f, cellTextWidthDp, active ? t.gold : t.ink);
        }

        // ---- صف التواريخ تحت كارت الصلوات: الهجري يمين، اسم اليوم في المنتصف، الميلادي يسار ----
        int dateCellWidthDp = Math.max(50, (size[0] - 20 - 8) / 3 - 4);
        setDateOrSunriseText(context, views, R.id.widget_hijri_date, hijri,
                10.5f, 8f, dateCellWidthDp, t.ink3, transparentBg, openFillStroke, hasCustomFontColor, customFontColor);
        setDateOrSunriseText(context, views, R.id.widget_day_name, arabicWeekday(todayCal),
                10.5f, 8f, dateCellWidthDp, t.ink2, transparentBg, openFillStroke, hasCustomFontColor, customFontColor);
        setDateOrSunriseText(context, views, R.id.widget_gregorian_date, gregorianDateText(todayCal),
                10.5f, 8f, dateCellWidthDp, t.ink3, transparentBg, openFillStroke, hasCustomFontColor, customFontColor);

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.putExtra("openTab", "prayer");
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_prayer_root, pendingIntent);
    }
}
