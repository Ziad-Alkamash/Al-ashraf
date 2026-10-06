package com.ashraf.mushaf;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.widget.RemoteViews;

/**
 * ويدجت المسبحة الدائري: زرار كبير في المنتصف (الضغط = +1) بيلفّه حلقة حبّات بتتلوّن مع العدّ،
 * وتحته زرار تصفير دائري بسهم ↺، وفوقه شيبس باسم الذكر (الضغط عليه = الذكر التالي).
 * كل الضغطات بتوصل كـ Broadcast للـ Provider نفسه فالتسبيح بيشتغل من الشاشة الرئيسية من غير ما
 * يتفتح التطبيق. الويدجت كله صورة واحدة (TasbihDialRenderer) وفوقها مناطق ضغط شفافة.
 */
public class TasbihWidgetProvider extends AppWidgetProvider {

    public static final String ACTION_COUNT = "com.ashraf.mushaf.TASBIH_COUNT";
    public static final String ACTION_RESET = "com.ashraf.mushaf.TASBIH_RESET";
    public static final String ACTION_NEXT = "com.ashraf.mushaf.TASBIH_NEXT";

    /** false = أرقام لاتينية (9) زي شاشة المسبحة في التطبيق، true = أرقام عربية (٩) */
    private static final boolean ARABIC_DIGITS = false;

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (action != null && id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            switch (action) {
                case ACTION_COUNT:
                    handleCount(context, manager, id);
                    return;
                case ACTION_RESET:
                    TasbihPrefs.resetCurrent(context, id);
                    updateWidget(context, manager, id);
                    return;
                case ACTION_NEXT:
                    TasbihPrefs.shiftIndex(context, id, +1);
                    updateWidget(context, manager, id);
                    return;
                default:
                    break;
            }
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateWidget(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager,
                                          int appWidgetId, Bundle newOptions) {
        updateWidget(context, manager, appWidgetId);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetPrefs.remove(context, id);
            TasbihPrefs.remove(context, id);
        }
    }

    /** يحدّث كل نسخ المسبحة من أي مكان تاني (اختياري) */
    public static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, TasbihWidgetProvider.class));
            if (ids == null) return;
            for (int id : ids) updateWidget(context, manager, id);
        } catch (Exception ignored) { }
    }

    // ---------------------------------------------------------------- actions

    private static void handleCount(Context context, AppWidgetManager manager, int id) {
        int idx = TasbihPrefs.getIndex(context, id);
        int n = TasbihPrefs.increment(context, id, idx);
        haptic(context, n % TasbihPrefs.TARGET == 0);

        try {
            // تحديث جزئي: صورة الدايرة بس (من غير ما نعيد ربط الضغطات مع كل تسبيحة)
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasbih);
            bindDial(context, manager, id, views);
            manager.partiallyUpdateAppWidget(id, views);
        } catch (Exception e) {
            updateWidget(context, manager, id);
        }
    }

    /** اهتزازة خفيفة مع كل تسبيحة، واهتزازة مزدوجة أطول لما العدّ يكمّل الهدف (٣٣) */
    private static void haptic(Context context, boolean milestone) {
        try {
            Vibrator v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(milestone
                        ? VibrationEffect.createWaveform(new long[]{0, 120, 90, 120}, -1)
                        : VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                v.vibrate(milestone ? 250 : 18);
            }
        } catch (Exception ignored) {
            // بدون صلاحية VIBRATE أو جهاز بدون اهتزاز: نتجاهل، الاهتزاز شكلي فقط
        }
    }

    // ---------------------------------------------------------------- rendering

    public static void updateWidget(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasbih);
        try {
            bindDial(context, manager, id, views);
            views.setOnClickPendingIntent(R.id.widget_tasbih_zone_count, actionIntent(context, id, ACTION_COUNT));
            views.setOnClickPendingIntent(R.id.widget_tasbih_zone_reset, actionIntent(context, id, ACTION_RESET));
            views.setOnClickPendingIntent(R.id.widget_tasbih_zone_dhikr, actionIntent(context, id, ACTION_NEXT));
        } catch (Exception e) {
            // شبكة أمان: الويدجت يظهر حتى لو حصل خطأ غير متوقع في الرسم
        }
        try {
            manager.updateAppWidget(id, views);
        } catch (Exception ignored) { }
    }

    /** يرسم الدايرة كلها بالحالة الحالية (العدّ + الحبّات) ويحطها في RemoteViews */
    private static void bindDial(Context context, AppWidgetManager manager, int id, RemoteViews views) {
        int transparency = WidgetPrefs.getTransparency(context, id);
        WidgetTheme theme = WidgetTheme.get(WidgetPrefs.isDark(context, id));
        int[] size = WidgetBackgroundHelper.currentSizeDp(context, manager, id, 180, 225);

        int idx = TasbihPrefs.getIndex(context, id);
        int target = TasbihPrefs.TARGET;
        int count = TasbihPrefs.getCount(context, id, idx);

        // العدد المعروض والحبّات = التقدّم داخل الجولة الحالية (بعد ٣٣ بتبدأ جولة جديدة من ١)
        int inRound = count == 0 ? 0 : ((count - 1) % target) + 1;

        Integer custom = WidgetPrefs.hasCustomFontColor(context, id)
                ? WidgetPrefs.getFontColor(context, id, theme.ink) : null;

        Bitmap dial = TasbihDialRenderer.render(context, size[0], size[1], theme, transparency,
                target, inRound, digits(inRound), "من " + digits(target),
                TasbihPrefs.getDhikr(context, idx), custom);
        views.setImageViewBitmap(R.id.widget_tasbih_dial, dial);
    }

    /**
     * الـ PendingIntent بيتميّز بالـ action + الـ data (مش بالـ extras)، فبنحط الـ id في الـ data
     * عشان لو المستخدم عنده أكتر من نسخة مسبحة كل نسخة يبقى ليها ضغطاتها المستقلة.
     */
    private static PendingIntent actionIntent(Context context, int id, String action) {
        Intent intent = new Intent(context, TasbihWidgetProvider.class);
        intent.setAction(action);
        intent.setData(Uri.parse("tasbih://widget/" + id + "/" + action));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String digits(int n) {
        String s = String.valueOf(n);
        if (!ARABIC_DIGITS) return s;
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(c >= '0' && c <= '9' ? (char) ('\u0660' + (c - '0')) : c);
        }
        return sb.toString();
    }
}
