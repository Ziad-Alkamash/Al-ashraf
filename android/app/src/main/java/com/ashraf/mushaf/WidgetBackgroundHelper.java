package com.ashraf.mushaf;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;

/**
 * يرسم خلفية الويدجت برمجيًا بنفس طابع صفحة "الصوتيات": لون مسطّح هادي
 * (كريمي في الوضع الفاتح، أسود دافئ في الداكن) بحد رفيع وزوايا دايرية كبيرة،
 * بدل التدرّج الغامق بالتوهّج الذهبي القديم. درجة الشفافية (0 = شفاف تمامًا،
 * 100 = معتم) بيحددها المستخدم من شاشة إعدادات الويدجت.
 */
public class WidgetBackgroundHelper {

    private static final float RADIUS_DP = 24f;

    public static Bitmap createBackground(Context context, int widthDp, int heightDp,
                                          int transparencyPercent, boolean dark) {
        WidgetTheme theme = WidgetTheme.get(dark);
        float density = context.getResources().getDisplayMetrics().density;
        int w = Math.max(2, Math.round(widthDp * density));
        int h = Math.max(2, Math.round(heightDp * density));

        int percent = Math.max(0, Math.min(100, transparencyPercent));
        int alpha = Math.round(255 * (percent / 100f));

        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        float strokeWidth = Math.max(1f, 1f * density);
        RectF rect = new RectF(strokeWidth, strokeWidth, w - strokeWidth, h - strokeWidth);
        float radius = RADIUS_DP * density;

        Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        fillPaint.setColor(theme.bg);
        fillPaint.setAlpha(alpha);
        canvas.drawRoundRect(rect, radius, radius, fillPaint);

        Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(strokeWidth);
        strokePaint.setColor(theme.line);
        strokePaint.setAlpha(Math.min(Color.alpha(theme.line), alpha));
        canvas.drawRoundRect(rect, radius, radius, strokePaint);

        return bitmap;
    }

    /** نسخة قديمة للتوافق (وضع فاتح) */
    public static Bitmap createBackground(Context context, int widthDp, int heightDp, int transparencyPercent) {
        return createBackground(context, widthDp, heightDp, transparencyPercent, false);
    }

    /**
     * أبعاد الويدجت الحالية بالـ dp بحسب اتجاه الشاشة، بتتحدّث تلقائيًا لو المستخدم غيّر حجم
     * الويدجت بإصبعه. حسب توثيق أندرويد: في الوضع الطولي العرض الفعلي = MIN_WIDTH والارتفاع
     * الفعلي = MAX_HEIGHT، وفي العرضي العكس. (النسخة القديمة كانت بتاخد MAX_WIDTH دايمًا، وده
     * عرض الوضع العرضي — أكبر من العرض الفعلي في الطولي — فكان نص الدعاء المرسوم كصورة أعرض
     * من الويدجت وأطرافه بتتقص.)
     */
    public static int[] currentSizeDp(Context context, AppWidgetManager manager, int widgetId,
                                      int fallbackW, int fallbackH) {
        try {
            Bundle options = manager.getAppWidgetOptions(widgetId);
            boolean landscape = context.getResources().getConfiguration().orientation
                    == Configuration.ORIENTATION_LANDSCAPE;
            int w = options.getInt(landscape
                    ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
                    : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int h = options.getInt(landscape
                    ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                    : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            if (w <= 0) w = fallbackW;
            if (h <= 0) h = fallbackH;
            return new int[]{w, h};
        } catch (Exception e) {
            return new int[]{fallbackW, fallbackH};
        }
    }

    /** نسخة قديمة للتوافق */
    public static int[] currentSizeDp(AppWidgetManager manager, int widgetId, int fallbackW, int fallbackH) {
        try {
            Bundle options = manager.getAppWidgetOptions(widgetId);
            int w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            int h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            if (w <= 0) w = fallbackW;
            if (h <= 0) h = fallbackH;
            return new int[]{w, h};
        } catch (Exception e) {
            return new int[]{fallbackW, fallbackH};
        }
    }
}
