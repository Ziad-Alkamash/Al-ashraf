package com.ashraf.mushaf;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

final class AdhkarAlarmNotifications {
    private static final int SABAH_NOTIFICATION_ID = 9010;
    private static final int MASAA_NOTIFICATION_ID = 9020;
    private static final String[] SABAH_TITLES = { "صباحٌ يبدأ بالذكر", "لديك دقيقة واحدة لنفسك", "صباحك يبدأ من هنا" };
    private static final String[] SABAH_BODIES = {
        "لا تدع صباحكَ يمرُّ دون ذكرِ الله، ابدأ يومَك بأذكار الصباح.",
        "اجعلها مع أذكار الصباح… المصحف الأشرف بانتظارك.",
        "افتح المصحف الأشرف، وخذ أولى لحظات يومك مع ذكر الله."
    };
    private static final String[] MASAA_TITLES = { "اختم يومكَ بالذكر", "قبل أن تطوي صفحة اليوم", "هنا تنتهي حكاية يومك" };
    private static final String[] MASAA_BODIES = {
        "قبل أن ينتهي يومُك، خذ لحظات مع أذكار المساء واطمئنَّ بذكر الله.",
        "خذ دقيقة لأذكار المساء، ثم أكمل ليلتك بقلبٍ مطمئن.",
        "أهدِ يومك لحظات من الذكر، ودع آخر ما يرافقك هو ذكر الله."
    };

    private AdhkarAlarmNotifications() { }

    static void show(Context context, String kind, int variation) {
        boolean sabah = "sabah".equals(kind);
        String channelId = sabah ? "mushaf-sabah-azkar-v2" : "mushaf-masaa-azkar-v2";
        String channelName = sabah ? "تذكير أذكار الصباح" : "تذكير أذكار المساء";
        String soundName = sabah ? "sabah_reminder" : "masaa_reminder";
        int index = Math.max(0, Math.min(variation, 2));
        String title = (sabah ? SABAH_TITLES : MASAA_TITLES)[index];
        String body = (sabah ? SABAH_BODIES : MASAA_BODIES)[index];
        ensureChannel(context, channelId, channelName, soundName);

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = null;
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            contentIntent = PendingIntent.getActivity(context, sabah ? SABAH_NOTIFICATION_ID : MASAA_NOTIFICATION_ID, launchIntent, flags);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(Color.rgb(142, 111, 48))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false);
        if (contentIntent != null) builder.setContentIntent(contentIntent);

        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(sabah ? SABAH_NOTIFICATION_ID : MASAA_NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) { /* نظام الإشعارات قد يكون مرفوضًا من المستخدم */ }
    }

    private static void ensureChannel(Context context, String channelId, String channelName, String soundName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(channelId) != null) return;
        int soundId = context.getResources().getIdentifier(soundName, "raw", context.getPackageName());
        Uri sound = soundId == 0 ? null : Uri.parse("android.resource://" + context.getPackageName() + "/" + soundId);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("إشعار أذكار يومي");
        channel.enableVibration(true);
        channel.setSound(sound, audio);
        manager.createNotificationChannel(channel);
    }
}
