package com.ashraf.mushaf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.res.AssetFileDescriptor;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import java.io.IOException;

// Foreground Service بيشغّل ملف الأذان الكامل (من نفس ملفات www/audio/adhan) على
// STREAM_ALARM (نفس فوليوم "المنبّه" اللي في إعدادات الصوت بالموبايل) — يعني بيتبع
// مستوى صوت المنبّه اللي ضابطه المستخدم، وبيتخطى وضع الصامت/الاهتزاز (تمامًا زي أي
// منبّه/تنبيه صلاة حقيقي)، عشان الأذان يوصل للمستخدم حتى لو الميديا مكتومة أو الفون
// ع "صامت". وبرضو بتراقب حساس التسارع عشان لو المستخدم قلب الفون ع وشه (الشاشة لأسفل)
// يوقف الصوت فورًا — بنفس منطق initFaceDownStop() الموجود في www/app.js لما التطبيق مفتوح.
public class AdhanAlarmService extends Service implements SensorEventListener {

    private MediaPlayer mediaPlayer;
    private SensorManager sensorManager;
    private Sensor accelerometer;
    private long lastFlipTrigger = 0;
    private PowerManager.WakeLock wakeLock;
    // مؤقّت "الأذان القصير": بيوقف التشغيل عند ثانية "نهاية أول تكبيرتين"
    // المكتشفة من جانب الجافاسكريبت (راجع shortEndSeconds تحت)، بدل ما
    // نسيب الملف يكمل كامل زي ما كان بيحصل قبل كده بغضّ النظر عن الإعداد
    private final Handler shortStopHandler = new Handler(Looper.getMainLooper());
    private Runnable shortStopRunnable;
    private static final String CHANNEL_ID = "adhan-alarm-channel";
    // قناة منفصلة هادئة (بدون صوت) لإشعار "الأذان مكتوم مؤقتًا" لما بلاطة الكتم
    // السريعة تكون مفعّلة — مش بنستخدم نفس قناة الأذان العادية عشان متتقلبش
    // إعدادات الصوت بتاعتها (القنوات في أندرويد بمجرد إنشائها بإعدادات معينة
    // مبتتغيرش بعد كده)
    private static final String SILENT_CHANNEL_ID = "adhan-alarm-silent-channel";
    private static final int NOTIF_ID = 5001;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) {
            stopPlaybackAndService();
            return START_NOT_STICKY;
        }

        String title = "حان وقت الصلاة 🕌";
        String body = "حي على الصلاة، حي على الفلاح.";
        String soundAssetName = "makkah.mp3";
        // shortEndSeconds جاية من جانب الجافاسكريبت (scheduleNativeAdhanAlarms في
        // app.js): ثانية "نهاية أول تكبيرتين" الحقيقية المكتشفة من تحليل الملف
        // نفسه، لو المستخدم مختار "أذان قصير". لو الإعداد "كامل" أو الحقل مش
        // موجود أصلاً (نسخة جافاسكريبت أقدم لسه ما بتبعتوش)، بترجع -1 ويشتغل
        // الأذان كامل زي ما كان دايمًا
        double shortEndSeconds = -1;
        boolean mediaVolume = false;
        if (intent != null) {
            if (intent.getStringExtra("title") != null) title = intent.getStringExtra("title");
            if (intent.getStringExtra("body") != null) body = intent.getStringExtra("body");
            if (intent.getStringExtra("soundAssetName") != null) soundAssetName = intent.getStringExtra("soundAssetName");
            if (intent.hasExtra("shortEndSeconds")) {
                shortEndSeconds = intent.getDoubleExtra("shortEndSeconds", -1);
            }
            mediaVolume = intent.getBooleanExtra("mediaVolume", false);
        }

        // لو المستخدم مفعّل بلاطة "كتم الأذان مؤقتًا" من لوحة الإشعارات السريعة
        // (مثلاً هو داخل ميتينج)، نكتفي بإشعار هادئ من غير ما نشغّل صوت الأذان
        // خالص. الكتم بيفضل شغال لحد ما المستخدم يلغي تفعيل البلاطة بنفسه — مفيش
        // رجوع تلقائي، بالظبط زي أي زرار كتم عادي.
        if (AdhanMutePrefs.isMuted(this)) {
            createSilentChannel();
            startForeground(NOTIF_ID, buildSilentNotification(title, body));
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        startForeground(NOTIF_ID, buildNotification(title, body));
        playAdhan(soundAssetName, shortEndSeconds, mediaVolume);

        return START_NOT_STICKY;
    }

    private void playAdhan(String assetFileName, double shortEndSeconds, boolean mediaVolume) {
        try {
            // ملفات الأذان موجودة أصلاً جوّه www/audio/adhan، وCapacitor بينسخها وقت
            // البناء لـ assets/public/audio/adhan — فبنقراها من هناك مباشرة من غير
            // ما نكررها في مكان تاني (raw) ونضخّم حجم التطبيق
            AssetFileDescriptor afd = getAssets().openFd("public/audio/adhan/" + assetFileName);

            // يختار المستخدم بين مجرى المنبّه ومجرى الوسائط من إعدادات مواقيت الصلاة.
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(mediaVolume ? AudioAttributes.USAGE_MEDIA : AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            );
            mediaPlayer.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            mediaPlayer.setLooping(false);
            mediaPlayer.prepare();
            mediaPlayer.setOnCompletionListener(mp -> stopPlaybackAndService());
            mediaPlayer.start();

            // أذان قصير: نجدول وقف تلقائي عند ثانية "نهاية أول تكبيرتين" المكتشفة.
            // shortEndSeconds <= 0 معناها "كامل" فمنعملش حاجة ونسيب الملف يكمل
            // لحد آخره زي ما كان دايمًا (نفس السلوك القديم بالظبط)
            if (shortEndSeconds > 0) {
                shortStopRunnable = this::stopPlaybackAndService;
                shortStopHandler.postDelayed(shortStopRunnable, (long) (shortEndSeconds * 1000));
            }

            // لازم نمسك Partial Wake Lock طول مدة تشغيل الأذان: من غير كده، لو الشاشة
            // مقفولة (الفون في الجيب/مقلوب على الترابيزة)، المعالج ممكن يرجع "ينام" بين
            // كل دفعة صوت والتانية (خصوصًا مع تشغيل الصوت offloaded على معالجات صوت
            // منفصلة بالأجهزة الحديثة)، وده بيأخّر أو يمنع وصول قراءات حساس التسارع
            // (registerFaceDownSensor) لحد ما حاجة تانية توقّظ الجهاز — يعني قلب الفون
            // مبيوقفش الأذان فورًا زي ما المفروض. مسك الـ Wake Lock هنا بيضمن إن
            // المعالج فاضل صاحي طول ما الأذان شغال عشان الحساس يستجيب فورًا
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mushaf:AdhanAlarmWakeLock");
                wakeLock.setReferenceCounted(false);
                // تايم-آوت أمان (أطول من أي ملف أذان متوقّع) عشان لو حصل أي استثناء
                // ومنعناش release() بطريقة ما، الـ wake lock يترفع لوحده وميستهلكش بطارية
                wakeLock.acquire(6 * 60 * 1000L);
            }

            registerFaceDownSensor();
        } catch (IOException | RuntimeException e) {
            stopPlaybackAndService();
        }
    }

    private void registerFaceDownSensor() {
        sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager != null) {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (accelerometer != null) {
                sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_NORMAL);
            }
        }
    }

    private void unregisterFaceDownSensor() {
        if (sensorManager != null && accelerometer != null) {
            sensorManager.unregisterListener(this);
        }
        sensorManager = null;
        accelerometer = null;
    }

    // نفس عتبة الكشف المستخدمة في www/app.js (initFaceDownStop): تسارع الجاذبية على
    // محور Z بيبقى سالب وقوي لما الشاشة تبقى لأسفل، مع تأخير ثانية بين كل محاولة
    // عشان منمنعش تشغيل متكرر بسبب اهتزاز بسيط
    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ACCELEROMETER) return;
        if (mediaPlayer == null) return;
        float z = event.values[2];
        if (z < -8f && System.currentTimeMillis() - lastFlipTrigger > 1000) {
            lastFlipTrigger = System.currentTimeMillis();
            stopPlaybackAndService();
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // مش محتاجينها هنا
    }

    private Notification buildNotification(String title, String body) {
        Intent stopIntent = new Intent(this, AdhanAlarmService.class);
        stopIntent.setAction("STOP");
        PendingIntent stopPending = PendingIntent.getService(
            this, 0, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent openAppIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_notify) // ممكن تستبدلها بأيقونة التطبيق (notif-icon)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setContentIntent(openPending)
            .setFullScreenIntent(openPending, true)
            .addAction(android.R.drawable.ic_media_pause, "إيقاف", stopPending)
            .setOngoing(true)
            .build();
    }

    // إشعار هادئ بديل وقت الكتم: من غير صوت، من غير اهتزاز، من غير فُل سكرين
    // (عشان متقاطعش الميتينج)، بس بيوصل للمستخدم إن معاد الصلاة دخل فعلاً
    private Notification buildSilentNotification(String title, String body) {
        Intent openAppIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, SILENT_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body + " (الأذان مكتوم مؤقتًا)")
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(openPending)
            .setOngoing(false)
            .build();
    }

    private void stopPlaybackAndService() {
        if (shortStopRunnable != null) {
            shortStopHandler.removeCallbacks(shortStopRunnable);
            shortStopRunnable = null;
        }
        unregisterFaceDownSensor();
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
            } catch (Exception e) { /* تجاهل */ }
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) wakeLock.release();
            } catch (Exception e) { /* تجاهل */ }
            wakeLock = null;
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopPlaybackAndService();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "منبّه الأذان", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("إشعار تشغيل الأذان الكامل حتى مع إغلاق التطبيق");
            channel.setSound(null, null); // الصوت بيتشغل يدويًا عبر MediaPlayer مش عبر القناة
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    private void createSilentChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                SILENT_CHANNEL_ID, "إشعار الأذان (وضع الكتم)", NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("إشعار هادئ بدخول وقت الصلاة أثناء تفعيل بلاطة كتم الأذان");
            channel.setSound(null, null);
            channel.enableVibration(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
