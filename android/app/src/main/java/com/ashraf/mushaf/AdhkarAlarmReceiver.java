package com.ashraf.mushaf;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AdhkarAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String kind = intent != null ? intent.getStringExtra("kind") : null;
        AdhkarAlarmScheduler.fireAndRenew(context, kind);
    }
}
