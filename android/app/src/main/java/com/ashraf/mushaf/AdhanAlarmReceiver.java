package com.ashraf.mushaf;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class AdhanAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Intent serviceIntent = new Intent(context, AdhanAlarmService.class);
        serviceIntent.putExtra("id", intent.getIntExtra("id", 0));
        serviceIntent.putExtra("title", intent.getStringExtra("title"));
        serviceIntent.putExtra("body", intent.getStringExtra("body"));
        serviceIntent.putExtra("soundAssetName", intent.getStringExtra("soundAssetName"));
        // ثانية "نهاية أول تكبيرتين" لو "أذان قصير" — راجع AdhanAlarmPlugin
        // و AdhanAlarmService لباقي حلقات تمرير القيمة دي
        serviceIntent.putExtra("shortEndSeconds", intent.getDoubleExtra("shortEndSeconds", -1));
        serviceIntent.putExtra("mediaVolume", intent.getBooleanExtra("mediaVolume", false));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}
