package com.ashraf.mushaf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * يرسم ويدجت المسبحة كله كصورة واحدة:
 *   - فوق: شيبس (كبسولة كريمي بحد ذهبي) عليها اسم الذكر، والضغط عليها بيبدّل الذكر.
 *   - تحتها: دايرة بنفس تصميم شاشة المسبحة في التطبيق: قرص خارجي (بشفافية يحددها المستخدم)
 *     + حلقة حبّات بتتلوّن مع العدّ + زرار دائري كبير عليه العدد الكبير وكبسولة "من ٣٣"
 *     وزرار تصفير دائري (سهم ↺).
 *
 * الشريط العلوي (الشيبس) ارتفاعه ثابت TOP_AREA_DP وبيقابله FrameLayout بنفس الارتفاع في
 * widget_tasbih.xml. الدايرة بتتوسّط في المساحة اللي تحته، ومواضع عناصرها كنسب من قطرها
 * (نفس النسب اللي بيعتمد عليها تقسيم مناطق الضغط في التخطيط):
 *   العدد ٤٣٪ - الكبسولة ٦٥٪ - زرار التصفير ٨٢٪ (من أعلى الدايرة)
 */
final class TasbihDialRenderer {

    /** ارتفاع الشريط العلوي بالـ dp (الشيبس ٣٤ + هامش) — لازم يطابق widget_tasbih.xml */
    static final int TOP_AREA_DP = 42;
    /** نسبة عرض الشيبس الأقصى من عرض الويدجت — لازم تطابق وزن المنطقة الوسطى (٧٦) في التخطيط */
    private static final float CHIP_MAX_WIDTH_FRACTION = 0.76f;

    private static final int CHIP_FILL = 0xFFFFFBF0;
    private static final int CHIP_STROKE = 0xFFC79A3A;
    private static final int CHIP_TEXT = 0xFF6B5212;

    private TasbihDialRenderer() { }

    static Bitmap render(Context context, int wDp, int hDp, WidgetTheme t, int transparencyPercent,
                         int beads, int filledBeads, String number, String pillText,
                         String dhikrName, Integer customTextColor) {
        float d = context.getResources().getDisplayMetrics().density;
        int w = Math.max(2, Math.round(wDp * d));
        int h = Math.max(2, Math.round(hDp * d));
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);

        // ---- الهندسة: الشريط العلوي للشيبس، والدايرة متوسّطة في اللي تحته
        float topPx = TOP_AREA_DP * d;
        float areaH = Math.max(2f, h - topPx);
        float cx = w / 2f;
        float cy = topPx + areaH / 2f;
        float sPx = Math.max(2f, Math.min(w, areaH) - 2f * d);   // قطر الدايرة الخارجية
        float sDp = sPx / d;
        float rad = sPx / 2f;

        int alpha = Math.round(255 * (Math.max(0, Math.min(100, transparencyPercent)) / 100f));
        boolean dark = t.dark;
        int accent = dark ? t.gold : 0xFF6B5212;                    // حبّات مملوءة + عناصر التمييز
        int beadOff = dark ? ((t.gold & 0x00FFFFFF) | (0x47 << 24)) : 0xFFCEC4AB;
        int chipBg = dark ? 0xFF352D1F : 0xFFECEADF;                // كبسولة "من ٣٣" + خلفية زرار التصفير

        // ---- شيبس اسم الذكر (كريمي بحد ذهبي، معتم دايمًا عشان يقرأ فوق أي خلفية)
        drawDhikrChip(canvas, context, d, w, dhikrName);

        // ---- القرص الخارجي (شفافيته من إعدادات الويدجت) + حد رفيع ذهبي
        Paint disc = new Paint(Paint.ANTI_ALIAS_FLAG);
        disc.setColor(t.bg);
        disc.setAlpha(alpha);
        canvas.drawCircle(cx, cy, rad, disc);

        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(Math.max(1f, d));
        ring.setColor(t.gold);
        ring.setAlpha(Math.min(0x50, alpha));
        canvas.drawCircle(cx, cy, rad - ring.getStrokeWidth() / 2f, ring);

        // ---- حلقة الحبّات: تبدأ من أعلى الدايرة وتلف مع عقارب الساعة
        int n = Math.max(1, beads);
        float orbit = 0.933f * rad;
        float beadR = Math.max(2f * d, 0.058f * rad);
        Paint bead = new Paint(Paint.ANTI_ALIAS_FLAG);
        for (int i = 0; i < n; i++) {
            double ang = Math.toRadians(-90.0 + 360.0 * i / n);
            bead.setColor(i < filledBeads ? accent : beadOff);
            canvas.drawCircle(cx + (float) (orbit * Math.cos(ang)),
                    cy + (float) (orbit * Math.sin(ang)), beadR, bead);
        }

        // ---- الزرار الدائري الكبير (فوق الحبّات زي التصميم، بظل خفيف في الوضع الفاتح)
        Paint inner = new Paint(Paint.ANTI_ALIAS_FLAG);
        inner.setColor(t.card);
        if (!dark) inner.setShadowLayer(0.06f * rad, 0f, 0.03f * rad, 0x33000000);
        canvas.drawCircle(cx, cy, 0.89f * rad, inner);

        Paint chip = new Paint(Paint.ANTI_ALIAS_FLAG);
        chip.setColor(chipBg);

        // ---- العدد الكبير
        int numColor = customTextColor != null ? customTextColor : t.ink;
        Bitmap num = WidgetTextRenderer.renderSingleLineTextFit(context, number,
                0.34f * sDp, 12f, Math.round(0.60f * sDp), numColor, R.font.tajawal_bold);
        drawCentered(canvas, num, cx, cy + (0.43f - 0.5f) * sPx);

        // ---- كبسولة "من ٣٣"
        Bitmap pillLabel = WidgetTextRenderer.renderSingleLineTextFit(context, pillText,
                0.072f * sDp, 7f, Math.round(0.40f * sDp), accent, R.font.tajawal_bold);
        float pcy = cy + (0.65f - 0.5f) * sPx;
        float pw = pillLabel.getWidth() + 0.10f * sPx;
        float ph = pillLabel.getHeight() + 0.035f * sPx;
        canvas.drawRoundRect(new RectF(cx - pw / 2f, pcy - ph / 2f, cx + pw / 2f, pcy + ph / 2f),
                ph / 2f, ph / 2f, chip);
        drawCentered(canvas, pillLabel, cx, pcy);

        // ---- زرار التصفير: دايرة صغيرة فيها سهم ↺ (قوس عكس عقارب الساعة + رأس سهم ممتلئة)
        Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setStrokeWidth(Math.max(1.8f * d, 0.017f * sPx));
        stroke.setColor(accent);

        float by = cy + (0.82f - 0.5f) * sPx;
        canvas.drawCircle(cx, by, 0.075f * sPx, chip);
        drawResetArrow(canvas, cx, by, 0.036f * sPx, stroke, accent);
        return bmp;
    }

    /** الشيبس: كبسولة كريمي بحد ذهبي، عرضها على قد الاسم (وبحد أقصى ٧٦٪ من عرض الويدجت) */
    private static void drawDhikrChip(Canvas canvas, Context context, float d, int w, String text) {
        float chipH = 34f * d;
        float top = 2f * d;
        float padX = 14f * d;
        float maxW = CHIP_MAX_WIDTH_FRACTION * w;

        int textMaxDp = Math.max(20, Math.round((maxW - 2f * padX) / d));
        Bitmap label = WidgetTextRenderer.renderSingleLineTextFit(context, text,
                15f, 8f, textMaxDp, CHIP_TEXT, R.font.tajawal_bold);

        float chipW = Math.min(maxW, label.getWidth() + 2f * padX);
        float cx = w / 2f;
        float strokeW = 2f * d;
        RectF r = new RectF(cx - chipW / 2f, top, cx + chipW / 2f, top + chipH);

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(CHIP_FILL);
        canvas.drawRoundRect(r, chipH / 2f, chipH / 2f, fill);

        Paint border = new Paint(Paint.ANTI_ALIAS_FLAG);
        border.setStyle(Paint.Style.STROKE);
        border.setStrokeWidth(strokeW);
        border.setColor(CHIP_STROKE);
        RectF rs = new RectF(r.left + strokeW / 2f, r.top + strokeW / 2f,
                r.right - strokeW / 2f, r.bottom - strokeW / 2f);
        canvas.drawRoundRect(rs, chipH / 2f, chipH / 2f, border);

        drawCentered(canvas, label, cx, top + chipH / 2f);
    }

    /** قوس عكس عقارب الساعة بفتحة من فوق، ورأس السهم مثلث ممتلئ عند نهاية القوس */
    private static void drawResetArrow(Canvas canvas, float ax, float ay, float r,
                                       Paint stroke, int color) {
        canvas.drawArc(new RectF(ax - r, ay - r, ax + r, ay + r), -120f, -290f, false, stroke);

        double th = Math.toRadians(-50.0);                       // نهاية القوس
        float px = ax + (float) (r * Math.cos(th));
        float py = ay + (float) (r * Math.sin(th));
        float tx = (float) Math.sin(th), ty = (float) -Math.cos(th);   // اتجاه الحركة (عكس عقارب الساعة)
        float nx = -ty, ny = tx;                                       // العمودي عليه
        float hs = r * 1.15f;                                          // حجم رأس السهم

        Path head = new Path();
        head.moveTo(px + tx * hs * 0.60f, py + ty * hs * 0.60f);                       // الرأس
        head.lineTo(px - tx * hs * 0.40f + nx * hs * 0.55f, py - ty * hs * 0.40f + ny * hs * 0.55f);
        head.lineTo(px - tx * hs * 0.40f - nx * hs * 0.55f, py - ty * hs * 0.40f - ny * hs * 0.55f);
        head.close();

        Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(color);
        canvas.drawPath(head, fill);
    }

    private static void drawCentered(Canvas canvas, Bitmap b, float cx, float cy) {
        canvas.drawBitmap(b, cx - b.getWidth() / 2f, cy - b.getHeight() / 2f, null);
    }
}
