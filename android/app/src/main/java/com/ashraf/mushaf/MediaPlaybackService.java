package com.ashraf.mushaf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Build;
import android.os.IBinder;
import android.widget.RemoteViews;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

public class MediaPlaybackService extends Service {

    public static final String CHANNEL_ID = "mushaf-playback";
    private static final int NOTIF_ID = 5501;

    public static final String ACTION_PLAY = "com.ashraf.mushaf.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.ashraf.mushaf.ACTION_PAUSE";
    public static final String ACTION_STOP = "com.ashraf.mushaf.ACTION_STOP";
    public static final String ACTION_PREVIOUS = "com.ashraf.mushaf.ACTION_PREVIOUS";
    public static final String ACTION_REWIND = "com.ashraf.mushaf.ACTION_REWIND";
    public static final String ACTION_FORWARD = "com.ashraf.mushaf.ACTION_FORWARD";
    public static final String ACTION_NEXT = "com.ashraf.mushaf.ACTION_NEXT";
    public static final String ACTION_SPEED = "com.ashraf.mushaf.ACTION_SPEED";

    private MediaSessionCompat mediaSession;
    private static MediaControlPlugin pluginRef;
    // نسخة خافتة من شعار "المصحف الأشرف" بتتحمّل مرة واحدة وتتستخدم كخلفية
    // (album art) لمشغل الإشعار/النوتيفكيشن بانل
    private Bitmap dimmedArtwork;

    public static void setPlugin(MediaControlPlugin plugin) {
        pluginRef = plugin;
    }

    @Override
    public void onCreate() {
        super.onCreate();

        mediaSession = new MediaSessionCompat(this, "MushafMediaSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { notifyJs("play"); }
            @Override public void onPause() { notifyJs("pause"); }
            @Override public void onStop() { notifyJs("stop"); }
            @Override public void onSkipToPrevious() { notifyJs("previous"); }
            @Override public void onSkipToNext() { notifyJs("next"); }
            @Override public void onRewind() { notifyJs("rewind"); }
            @Override public void onFastForward() { notifyJs("forward"); }
            @Override public void onSetPlaybackSpeed(float speed) { notifyJs("speed"); }
        });
        mediaSession.setActive(true);

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "تشغيل الصوت", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("عناصر تحكم تشغيل القرآن والأذان");
            nm.createNotificationChannel(channel);
        }

        Bitmap raw = BitmapFactory.decodeResource(getResources(), R.drawable.notif_player_bg);
        if (raw != null) {
            // 35% نسبة الظهور تقريبًا (يعني خافتة تحت لون الميديا بلايباك مش واضحة كاملة)
            dimmedArtwork = dimBitmap(raw, 35);
        }
    }

    private void notifyJs(String action) {
        if (pluginRef != null) pluginRef.sendMediaEvent(action);
    }

    // بيرسم البيتماب بشفافية أقل (alphaPercent من 0 لـ 100) مع الحفاظ على
    // الخلفية الشفافة الأصلية للصورة، عشان تطلع خافتة مش صلبة
    private Bitmap dimBitmap(Bitmap src, int alphaPercent) {
        Bitmap out = Bitmap.createBitmap(src.getWidth(), src.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setAlpha((int) (255 * alphaPercent / 100f));
        canvas.drawBitmap(src, 0, 0, paint);
        return out;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            notifyJs("stop");
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_PLAY.equals(action)) { notifyJs("play"); return START_STICKY; }
            if (ACTION_PAUSE.equals(action)) { notifyJs("pause"); return START_STICKY; }
            if (ACTION_PREVIOUS.equals(action)) { notifyJs("previous"); return START_STICKY; }
            if (ACTION_REWIND.equals(action)) { notifyJs("rewind"); return START_STICKY; }
            if (ACTION_FORWARD.equals(action)) { notifyJs("forward"); return START_STICKY; }
            if (ACTION_NEXT.equals(action)) { notifyJs("next"); return START_STICKY; }
            if (ACTION_SPEED.equals(action)) { notifyJs("speed"); return START_STICKY; }
        }

        String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "المصحف الأشرف";
        String subtitle = intent != null && intent.getStringExtra("subtitle") != null ? intent.getStringExtra("subtitle") : "";
        String speedLabel = intent != null && intent.getStringExtra("speed") != null ? intent.getStringExtra("speed") : "1×";
        boolean isPlaying = intent != null && intent.getBooleanExtra("isPlaying", false);

        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle);
        if (dimmedArtwork != null) {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, dimmedArtwork);
        }
        MediaMetadataCompat metadata = metadataBuilder.build();
        mediaSession.setMetadata(metadata);

        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                        | PlaybackStateCompat.ACTION_STOP | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_REWIND
                        | PlaybackStateCompat.ACTION_FAST_FORWARD | PlaybackStateCompat.ACTION_SET_PLAYBACK_SPEED)
                .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build();
        mediaSession.setPlaybackState(playbackState);

        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent playPI = PendingIntent.getService(this, 1,
                new Intent(this, MediaPlaybackService.class).setAction(ACTION_PLAY),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent pausePI = PendingIntent.getService(this, 2,
                new Intent(this, MediaPlaybackService.class).setAction(ACTION_PAUSE),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stopPI = PendingIntent.getService(this, 3,
                new Intent(this, MediaPlaybackService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent previousPI = actionPendingIntent(ACTION_PREVIOUS, 4);
        PendingIntent rewindPI = actionPendingIntent(ACTION_REWIND, 5);
        PendingIntent forwardPI = actionPendingIntent(ACTION_FORWARD, 6);
        PendingIntent nextPI = actionPendingIntent(ACTION_NEXT, 7);
        PendingIntent speedPI = actionPendingIntent(ACTION_SPEED, 8);

        PendingIntent mainPI = isPlaying ? pausePI : playPI;
        int mainIcon = isPlaying ? R.drawable.ic_stat_pause : R.drawable.ic_stat_play;
        String mainLabel = isPlaying ? "إيقاف مؤقت" : "تشغيل";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(title)
                .setContentText(subtitle)
                .setContentIntent(contentIntent)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                // لون زيتوني من هوية التطبيق كتلميح
                // خافت بس على الأيقونة والأزرار، مش كخلفية كاملة صلبة للإشعار
                .setColor(0xFF6F7752)
                // من أندرويد ١٢ فما فوق، النظام بيفرض تلقائيًا تلوين "Colorized" كامل
                // وقوي (١٠٠٪) على إشعارات تشغيل الصوت المرتبطة بـ MediaSession/Foreground
                // Service، حتى بدون ما نطلبه إحنا صراحةً. ده اللي كان بيظهر كخلفية بنية
                // صريحة تمامًا. تعطيله هنا صراحةً بـ false بيرجّع الإشعار لخلفيته العادية
                // مع تلميح اللون البني خافت بس (مش خلفية كاملة)
                .setColorized(false)
                .addAction(R.drawable.ic_notif_previous, "الآية السابقة", previousPI)
                .addAction(R.drawable.ic_notif_rewind, "إرجاع ١٠ ثوانٍ", rewindPI)
                .addAction(mainIcon, mainLabel, mainPI)
                .addAction(R.drawable.ic_notif_forward, "تقديم ١٠ ثوانٍ", forwardPI)
                .addAction(R.drawable.ic_notif_next, "الآية التالية", nextPI)
                .addAction(R.drawable.ic_stat_stop, "إيقاف", stopPI)
                .addAction(R.drawable.ic_notif_speed, "سرعة التشغيل", speedPI);

        if (dimmedArtwork != null) {
            builder.setLargeIcon(dimmedArtwork);
        }

        RemoteViews compact = new RemoteViews(getPackageName(), R.layout.notification_player_compact);
        RemoteViews expanded = new RemoteViews(getPackageName(), R.layout.notification_player_expanded);
        setPlayerViews(compact, expanded, title, subtitle, mainIcon, previousPI, rewindPI,
                mainPI, forwardPI, nextPI, stopPI, speedPI, speedLabel);
        builder.setCustomContentView(compact).setCustomBigContentView(expanded);

        builder.setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 2, 4));

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        return START_STICKY;
    }

    private PendingIntent actionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void setPlayerViews(RemoteViews compact, RemoteViews expanded, String title, String subtitle,
            int mainIcon, PendingIntent previous, PendingIntent rewind, PendingIntent main,
            PendingIntent forward, PendingIntent next, PendingIntent stop, PendingIntent speed,
            String speedLabel) {
        RemoteViews[] views = { compact, expanded };
        for (RemoteViews view : views) {
            view.setTextViewText(R.id.notif_title, title);
            view.setTextViewText(R.id.notif_subtitle, subtitle);
            view.setImageViewResource(R.id.notif_play_pause, mainIcon);
            if (dimmedArtwork != null) view.setImageViewBitmap(R.id.notif_art, dimmedArtwork);
            else view.setImageViewResource(R.id.notif_art, R.drawable.notif_player_bg);
            view.setOnClickPendingIntent(R.id.notif_previous, previous);
            view.setOnClickPendingIntent(R.id.notif_rewind, rewind);
            view.setOnClickPendingIntent(R.id.notif_play_pause, main);
            view.setOnClickPendingIntent(R.id.notif_forward, forward);
            view.setOnClickPendingIntent(R.id.notif_next, next);
            if (view == expanded) {
                view.setTextViewText(R.id.notif_speed, "السرعة " + speedLabel);
                view.setOnClickPendingIntent(R.id.notif_stop, stop);
                view.setOnClickPendingIntent(R.id.notif_speed, speed);
            }
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) mediaSession.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
