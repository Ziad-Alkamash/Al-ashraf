package com.ashraf.mushaf;

import android.app.WallpaperColors;
import android.app.WallpaperManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;

/**
 * ألوان الويدجتات بنفس طابع صفحة "الصوتيات" (متغيرات --ap-* في audio-page.css):
 * وضع فاتح (كريمي + بطاقات بيضا + زيتوني #6F7752 + ذهبي #B8892B) ووضع داكن
 * (أسود دافئ + زيتوني فاتح #98A278 + ذهبي #D6AE55). المستخدم بيختار الوضع لكل
 * ويدجت من شاشة إعدادات الويدجت (WidgetConfigActivity).
 */
public final class WidgetTheme {

    public final boolean dark;
    public final int bg;         // خلفية الويدجت
    public final int card;       // كروت داخلية
    public final int line;       // حدود رفيعة (فيها شفافية)
    public final int ink;        // النص الأساسي
    public final int ink2;       // نص ثانوي
    public final int ink3;       // نص خافت
    public final int olive;      // اللون الأساسي (زيتوني)
    public final int oliveSoft;  // خلفية زيتونية فاتحة (كبسولات/أفاتار)
    public final int hl;         // تظليل الفرض القادم
    public final int gold;       // الذهبي
    public final int onOlive;    // لون الأيقونة/النص فوق الزيتوني المصمت

    private WidgetTheme(boolean dark, int bg, int card, int line, int ink, int ink2, int ink3,
                        int olive, int oliveSoft, int hl, int gold, int onOlive) {
        this.dark = dark;
        this.bg = bg;
        this.card = card;
        this.line = line;
        this.ink = ink;
        this.ink2 = ink2;
        this.ink3 = ink3;
        this.olive = olive;
        this.oliveSoft = oliveSoft;
        this.hl = hl;
        this.gold = gold;
        this.onOlive = onOlive;
    }

    private static final WidgetTheme LIGHT = new WidgetTheme(false,
            0xFFFAF8F3, 0xFFFFFFFF, 0x1C5A543C,
            0xFF211F1A, 0xFF5A574D, 0xFF8E8A7D,
            0xFF6F7752, 0xFFECEADF, 0xFFE7E5D8, 0xFFB8892B, 0xFFFFFFFF);

    private static final WidgetTheme DARK = new WidgetTheme(true,
            0xFF121211, 0xFF1C1C1A, 0x14FFFFFF,
            0xFFEFEDE6, 0xFFB5B2A6, 0xFF85826F,
            0xFF98A278, 0xFF262820, 0xFF2A2C22, 0xFFD6AE55, 0xFF15160F);

    public static WidgetTheme get(boolean dark) {
        return dark ? DARK : LIGHT;
    }

    /**
     * لون تعبئة + لون حد (outline) للنصوص اللي بترسم مباشرة فوق خلفية الفون (بدون كارت/كبسولة
     * تحتها)، يعني لما شفافية الويدجت = 0%. بنحاول الأول نسأل النظام عن ألوان الخلفية الحالية
     * (WallpaperColors) عشان نختار تعبئة أسود فوق خلفية فاتحة أو أبيض فوق خلفية غامقة، بحد خفيف
     * بالعكس لزيادة التباين. لكن الاكتشاف ده مش موثوق على كل الأجهزة (بيرجع null غالبًا على شاشات
     * سامسونج One UI مهما كانت الخلفية)، فمهما كانت النتيجة بنرسم بحد متباين واضح حوالين النص
     * عشان يفضل مقروء فوق أي خلفية حتى لو الاكتشاف فشل تمامًا — مش بس لو نجح.
     * العنصر [0] = لون التعبئة، العنصر [1] = لون الحد.
     */
    public static int[] adaptiveFillStroke(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                WallpaperManager manager = WallpaperManager.getInstance(context);
                WallpaperColors colors = manager.getWallpaperColors(WallpaperManager.FLAG_SYSTEM);
                if (colors != null) {
                    boolean supportsDarkText =
                            (colors.getColorHints() & WallpaperColors.HINT_SUPPORTS_DARK_TEXT) != 0;
                    return supportsDarkText
                            ? new int[]{Color.BLACK, 0x99FFFFFF}   // خلفية فاتحة: تعبئة غامقة + حد فاتح خفيف
                            : new int[]{Color.WHITE, 0x99000000};  // خلفية غامقة: تعبئة فاتحة + حد غامق خفيف
                }
            }
        } catch (Exception ignored) {
            // نكمل على الافتراضي الآمن تحت لو تعذّر الوصول لألوان الخلفية
        }
        // تعذّر تحديد لون خلفية الفون (شائع على أجهزة سامسونج): تعبئة فاتحة + حد غامق واضح،
        // مقروءة فوق أغلب الخلفيات الغامقة والفاتحة بفضل الحد
        return new int[]{Color.WHITE, 0xCC000000};
    }
}
