package com.ashraf.mushaf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextDirectionHeuristics;
import android.text.TextPaint;
import android.text.TextUtils;
import androidx.core.content.res.ResourcesCompat;

/**
 * يرسم النص العربي بخط "تاجوال" المخصص مباشرة على Bitmap، بدل الاعتماد على
 * android:fontFamily داخل تخطيط الويدجت (RemoteViews).
 *
 * السبب: ويدجتات الشاشة الرئيسية بتتحمّل وتُرسم بواسطة عملية اللانشر (منزل الجهاز)
 * وليس عملية التطبيق نفسه. كتير من الأجهزة والواجهات (خصوصًا الشاشات الرئيسية
 * المعدّلة من الشركات المصنّعة) بتتجاهل خط XML المخصص المحدد في التخطيط وترجع
 * للخط الافتراضي للنظام بصمت من غير أي خطأ ظاهر — وده بيحصل بغض النظر عن كون
 * النص عربي أو إنجليزي، المشكلة في طريقة عرض الويدجت مش في الخط نفسه.
 * رسم النص كصورة بالخط الصحيح مباشرة بيضمن ظهوره كما هو على أي جهاز أو لانشر.
 *
 * كل الأحجام هنا بـ density بس (مش scaledDensity) عمدًا، عشان تتجاهل إعداد "حجم الخط"
 * بتاع نظام أندرويد وما تتراكبش عناصر الويدجت فوق بعض.
 */
public class WidgetTextRenderer {

    private static TextPaint newPaint(Context context, int colorArgb, int fontResId) {
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(colorArgb);
        try {
            Typeface typeface = ResourcesCompat.getFont(context, fontResId);
            if (typeface != null) paint.setTypeface(typeface);
        } catch (Exception ignored) {
            // fallback على الخط الافتراضي لو تعذّر تحميل الخط لأي سبب، أفضل من عدم ظهور نص خالص
        }
        return paint;
    }

    /** يرسم نصًا متعدد الأسطر، محاذى للوسط، باتجاه عربي (RTL)، بعرض ثابت وارتفاع محسوب تلقائيًا حسب المحتوى */
    public static Bitmap renderCenteredText(Context context, String text, int widthDp, float textSizeSp,
                                              float lineSpacingExtraDp, int colorArgb, int fontResId, int maxLines) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int widthPx = Math.max(1, Math.round(widthDp * metrics.density));

        TextPaint paint = newPaint(context, colorArgb, fontResId);
        paint.setTextSize(textSizeSp * metrics.density);

        StaticLayout layout = buildLayout(text, paint, widthPx, maxLines, lineSpacingExtraDp * metrics.density);
        return drawLayout(layout, widthPx, metrics);
    }

    /**
     * نص متعدد الأسطر بيختار لوحده أكبر حجم خط (بين maxSp وminSp) يخلّي النص كله يدخل في
     * مساحة widthDp × heightDp — عشان الدعاء يبان كبير وواضح في الويدجت الكبير، ويصغّر
     * تلقائيًا بس لو الدعاء طويل. لو لسه مش داخل عند أصغر حجم، بيتقص بنقط (…) بدل ما يفيض.
     */
    public static Bitmap renderFittedCenteredText(Context context, String text, int widthDp, int heightDp,
                                                  float maxSp, float minSp, int colorArgb, int fontResId) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int widthPx = Math.max(1, Math.round(widthDp * metrics.density));
        int heightPx = Math.max(1, Math.round(heightDp * metrics.density));

        TextPaint paint = newPaint(context, colorArgb, fontResId);
        float sp = maxSp;
        StaticLayout layout;
        while (true) {
            paint.setTextSize(sp * metrics.density);
            // تباعد الأسطر نسبي لحجم الخط (٣٠٪) عشان القراءة تفضل مريحة في كل الأحجام
            layout = buildLayout(text, paint, widthPx, Integer.MAX_VALUE, sp * 0.3f * metrics.density);
            if (layout.getHeight() <= heightPx || sp <= minSp) break;
            sp -= 1f;
        }

        if (layout.getHeight() > heightPx) {
            // لسه أطول من المساحة حتى بأصغر خط: نقصّه بعدد الأسطر اللي بتتّسع فعلًا
            int lineHeight = Math.max(1, layout.getHeight() / Math.max(1, layout.getLineCount()));
            int maxLines = Math.max(1, heightPx / lineHeight);
            layout = buildLayout(text, paint, widthPx, maxLines, sp * 0.3f * metrics.density);
        }
        return drawLayout(layout, widthPx, metrics);
    }

    /** يرسم نصًا في سطر واحد بعرض مضبوط تلقائيًا على حجم النص نفسه (بديل TextView بـ wrap_content) */
    public static Bitmap renderSingleLineText(Context context, String text, float textSizeSp,
                                                int colorArgb, int fontResId) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();

        TextPaint paint = newPaint(context, colorArgb, fontResId);
        paint.setTextSize(textSizeSp * metrics.density);

        int widthPx = Math.max(1, (int) Math.ceil(Layout.getDesiredWidth(text, paint)));
        StaticLayout layout = buildLayout(text, paint, widthPx, 1, 0f);
        return drawLayout(layout, widthPx, metrics);
    }

    /**
     * سطر واحد بيصغّر الخط تلقائيًا (من maxSp لحد minSp) لحد ما يدخل في maxWidthDp، وبعدها لو لسه
     * أعرض بيتقص بنقط. بيمنع تراكب/قص الأوقات والأسماء في الخانات الضيقة.
     */
    public static Bitmap renderSingleLineTextFit(Context context, String text, float maxSp, float minSp,
                                                 int maxWidthDp, int colorArgb, int fontResId) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int maxPx = Math.max(1, Math.round(maxWidthDp * metrics.density));

        TextPaint paint = newPaint(context, colorArgb, fontResId);
        float sp = maxSp;
        paint.setTextSize(sp * metrics.density);
        while (Layout.getDesiredWidth(text, paint) > maxPx && sp > minSp) {
            sp -= 0.5f;
            paint.setTextSize(sp * metrics.density);
        }

        int widthPx = Math.max(1, Math.min(maxPx, (int) Math.ceil(Layout.getDesiredWidth(text, paint))));
        StaticLayout layout = buildLayout(text, paint, widthPx, 1, 0f);
        return drawLayout(layout, widthPx, metrics);
    }

    /**
     * أيقونة (Vector Drawable) بلون محدد فوق دايرة ملوّنة اختيارية (زي أفاتار صفحة المواقيت).
     * circleColor = 0 يعني بدون دايرة. iconFraction = نسبة حجم الأيقونة من الدايرة (مثلًا 0.6).
     */
    public static Bitmap renderIconAvatar(Context context, int drawableResId, int sizeDp,
                                          int circleColor, int iconColor, float iconFraction) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int px = Math.max(2, Math.round(sizeDp * metrics.density));

        Bitmap bitmap = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(metrics.densityDpi);
        Canvas canvas = new Canvas(bitmap);

        if (circleColor != 0) {
            Paint circlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            circlePaint.setColor(circleColor);
            canvas.drawCircle(px / 2f, px / 2f, px / 2f, circlePaint);
        }

        try {
            Drawable drawable = ResourcesCompat.getDrawable(context.getResources(), drawableResId, null);
            if (drawable != null) {
                drawable = drawable.mutate();
                drawable.setTint(iconColor);
                int inset = Math.round(px * (1f - iconFraction) / 2f);
                drawable.setBounds(inset, inset, px - inset, px - inset);
                drawable.draw(canvas);
            }
        } catch (Exception ignored) {
            // لو تعذّر رسم الأيقونة نسيب الدايرة لوحدها بدل ما نوقف الويدجت
        }
        return bitmap;
    }

    private static TextPaint newStrokePaint(Context context, int colorArgb, float strokeWidthPx, int fontResId) {
        TextPaint paint = newPaint(context, colorArgb, fontResId);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(strokeWidthPx);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeMiter(2f);
        return paint;
    }

    /**
     * سطر واحد بلون تعبئة + حد (outline) متباين، بيصغّر الخط تلقائيًا زي renderSingleLineTextFit.
     * مصمم للنصوص اللي بترسم مباشرة فوق خلفية الفون (بدون كارت تحتها): الحد المتباين بيضمن
     * وضوح النص فوق أي خلفية (فاتحة أو غامقة) من غير ما نحتاج نعرف لون خلفية الفون فعليًا،
     * لأن اكتشاف لون الخلفية عن طريق النظام (WallpaperManager) مش متاح بشكل موثوق على كل
     * الأجهزة والواجهات (زي بعض هواتف سامسونج One UI).
     */
    public static Bitmap renderSingleLineTextFitStroked(Context context, String text, float maxSp, float minSp,
                                                         int maxWidthDp, int fillColorArgb, int strokeColorArgb,
                                                         float strokeWidthDp, int fontResId) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int maxPx = Math.max(1, Math.round(maxWidthDp * metrics.density));

        TextPaint measure = newPaint(context, fillColorArgb, fontResId);
        float sp = maxSp;
        measure.setTextSize(sp * metrics.density);
        while (Layout.getDesiredWidth(text, measure) > maxPx && sp > minSp) {
            sp -= 0.5f;
            measure.setTextSize(sp * metrics.density);
        }
        int widthPx = Math.max(1, Math.min(maxPx, (int) Math.ceil(Layout.getDesiredWidth(text, measure))));

        float strokePx = strokeWidthDp * metrics.density;
        TextPaint strokePaint = newStrokePaint(context, strokeColorArgb, strokePx, fontResId);
        strokePaint.setTextSize(sp * metrics.density);
        TextPaint fillPaint = newPaint(context, fillColorArgb, fontResId);
        fillPaint.setTextSize(sp * metrics.density);

        StaticLayout strokeLayout = buildLayout(text, strokePaint, widthPx, 1, 0f);
        StaticLayout fillLayout = buildLayout(text, fillPaint, widthPx, 1, 0f);
        return drawStrokedLayout(strokeLayout, fillLayout, widthPx, metrics);
    }

    /**
     * نص متعدد الأسطر بلون تعبئة + حد متباين، بيتكبّر لأقصى حجم يدخل في المساحة زي
     * renderFittedCenteredText. نفس فكرة renderSingleLineTextFitStroked بس لنص الدعاء
     * الطويل متعدد الأسطر.
     */
    public static Bitmap renderFittedCenteredTextStroked(Context context, String text, int widthDp, int heightDp,
                                                          float maxSp, float minSp, int fillColorArgb,
                                                          int strokeColorArgb, float strokeWidthDp, int fontResId) {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        int widthPx = Math.max(1, Math.round(widthDp * metrics.density));
        int heightPx = Math.max(1, Math.round(heightDp * metrics.density));
        float strokePx = strokeWidthDp * metrics.density;

        TextPaint measure = newPaint(context, fillColorArgb, fontResId);
        float sp = maxSp;
        StaticLayout measureLayout;
        while (true) {
            measure.setTextSize(sp * metrics.density);
            measureLayout = buildLayout(text, measure, widthPx, Integer.MAX_VALUE, sp * 0.3f * metrics.density);
            if (measureLayout.getHeight() <= heightPx || sp <= minSp) break;
            sp -= 1f;
        }
        int maxLines = Integer.MAX_VALUE;
        if (measureLayout.getHeight() > heightPx) {
            int lineHeight = Math.max(1, measureLayout.getHeight() / Math.max(1, measureLayout.getLineCount()));
            maxLines = Math.max(1, heightPx / lineHeight);
        }

        TextPaint strokePaint = newStrokePaint(context, strokeColorArgb, strokePx, fontResId);
        strokePaint.setTextSize(sp * metrics.density);
        TextPaint fillPaint = newPaint(context, fillColorArgb, fontResId);
        fillPaint.setTextSize(sp * metrics.density);
        float lineSpacingPx = sp * 0.3f * metrics.density;

        StaticLayout strokeLayout = buildLayout(text, strokePaint, widthPx, maxLines, lineSpacingPx);
        StaticLayout fillLayout = buildLayout(text, fillPaint, widthPx, maxLines, lineSpacingPx);
        return drawStrokedLayout(strokeLayout, fillLayout, widthPx, metrics);
    }

    private static Bitmap drawStrokedLayout(StaticLayout strokeLayout, StaticLayout fillLayout, int widthPx,
                                            android.util.DisplayMetrics metrics) {
        int heightPx = Math.max(1, Math.max(strokeLayout.getHeight(), fillLayout.getHeight()));
        Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(metrics.densityDpi);
        Canvas canvas = new Canvas(bitmap);
        strokeLayout.draw(canvas);
        fillLayout.draw(canvas);
        return bitmap;
    }

    private static Bitmap drawLayout(StaticLayout layout, int widthPx, android.util.DisplayMetrics metrics) {
        int heightPx = Math.max(1, layout.getHeight());
        Bitmap bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(metrics.densityDpi);
        Canvas canvas = new Canvas(bitmap);
        layout.draw(canvas);
        return bitmap;
    }

    private static StaticLayout buildLayout(String text, TextPaint paint, int widthPx, int maxLines, float lineSpacingExtraPx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return StaticLayout.Builder.obtain(text, 0, text.length(), paint, widthPx)
                    .setAlignment(Layout.Alignment.ALIGN_CENTER)
                    .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_RTL)
                    .setLineSpacing(lineSpacingExtraPx, 1f)
                    .setMaxLines(maxLines)
                    .setEllipsize(TextUtils.TruncateAt.END)
                    .setIncludePad(false)
                    .build();
        }
        //noinspection deprecation
        return new StaticLayout(text, paint, widthPx, Layout.Alignment.ALIGN_CENTER, 1f, lineSpacingExtraPx, false);
    }
}
