package com.ashraf.mushaf;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

// نفس فكرة AdhanAlarmReceiver بالظبط: مجرد "ناقل" بسيط، شغله الوحيد إنه يستقبل
// المنبّه من AlarmManager ويشغّل SalawatAlarmService (كـ Foreground Service عشان
// أندرويد 8+ ميرفضش تشغيل خدمة من الخلفية). كل منطق التشغيل والتصويت وإعادة
// الجدولة نفسه موجود جوّه السيرفيس.
public class SalawatAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent serviceIntent = new Intent(context, SalawatAlarmService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}
