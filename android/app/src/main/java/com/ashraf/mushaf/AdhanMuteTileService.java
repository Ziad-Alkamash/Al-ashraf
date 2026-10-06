package com.ashraf.mushaf;

import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * بلاطة (Tile) في لوحة الإشعارات السريعة لأندرويد (نفس مكان أيقونات الواي فاي
 * والبلوتوث اللي بتظهر بسحب شريط الإشعارات لتحت مرتين) — بتدي المستخدم زرار
 * سريع لكتم صوت الأذان مؤقتًا من غير ما يفتح التطبيق، مفيد مثلاً وهو داخل
 * ميتينج قبل معاد الصلاة. تفعيل البلاطة = الأذان الجاي هيبقى صامت (إشعار هادئ
 * بس من غير صوت). إلغاء تفعيلها = الأذان يرجع لوضعه الطبيعي تاني.
 */
public class AdhanMuteTileService extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        refreshTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        boolean nowMuted = AdhanMutePrefs.toggle(this);
        // لو المستخدم لغى الكتم والأذان شغال دلوقتي فعلاً (نادر لكن ممكن)، سيبه
        // يكمل عادي؛ الكتم بيأثر بس على الأذان الجاي بعد كده. لو مفيش أذان شغال
        // حاليًا فالسطر ده مفيهوش تأثير.
        updateTile(nowMuted);
    }

    private void refreshTile() {
        updateTile(AdhanMutePrefs.isMuted(this));
    }

    private void updateTile(boolean muted) {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(muted ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel(muted ? "الأذان مكتوم مؤقتًا" : "كتم الأذان مؤقتًا");
        // setSubtitle متاحة بس من أندرويد 10 (API 29) فيما فوق
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(muted ? "هيرجع عادي عند الإلغاء" : null);
        }
        tile.updateTile();
    }
}
