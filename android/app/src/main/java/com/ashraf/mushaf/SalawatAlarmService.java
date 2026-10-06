package com.ashraf.mushaf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import java.io.IOException;
import java.util.Random;

// نفس فلسفة AdhanAlarmService بالظبط لكن لتذكير "صلِّ على محمد ﷺ" الدوري:
//
// المشكلة اللي كانت موجودة قبل كده: كان الاعتماد على بلجن Capacitor
// LocalNotifications، اللي عنده قيدين مشهورين هما بالظبط سبب الأعراض اللي
// بتحصل (إشعار أحيانًا من غير صوت / أحيانًا مش بييجي خالص لو التطبيق اتقفل
// فترة طويلة):
//   ١) صوت القناة (NotificationChannel) بيتثبّت لحظة إنشاء القناة أول مرة على
//      الجهاز ومبيتغيّرش بعد كده أبدًا حتى لو غيّرنا الكود — فلو القناة اتسجلت
//      قبل كده (نسخة تطبيق قديمة / أي سبب) بصوت غلط أو من غيره، هتفضل كده على
//      طول على نفس الجهاز.
//   ٢) كنا بنسجّل "دفعة" من ٢٠ تذكير مقدمًا بس، فلو التطبيق اتقفل فترة أطول من
//      (٢٠ × مدة التكرار) من غير ما يتفتح، الدفعة بتخلص ومفيش تجديد تلقائي.
//
// الحل هنا زي منبّه الأذان تمامًا: منبّه AlarmManager حقيقي بيشغّل Foreground
// Service بيتحكم في تشغيل الصوت بنفسه يدويًا (MediaPlayer) بدل ما يعتمد على
// صوت القناة خالص (القناة هنا صامتة عمدًا)، وبيعيد جدولة نفسه تلقائيًا في كل
// مرة يرن فيها (self-renewing) — يعني بيفضل شغال للأبد من غير حد أقصى ومن غير
// ما يحتاج المستخدم يفتح التطبيق تاني، وBootReceiver بيرجّعه بعد أي ريستارت
// للموبايل بالظبط زي الأذان.
public class SalawatAlarmService extends Service {

    static final String PREFS_NAME = "MushafSalawatAlarm";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_INTERVAL_MIN = "intervalMinutes";
    static final String KEY_NEXT_AT = "nextAtMillis";

    private static final String CHANNEL_ID = "mushaf-salawat-native";
    private static final int NOTIF_ID = 5002;

    // نفس صيغ الصلاة على النبي ﷺ الموجودة في www/app.js (SALAWAT_MESSAGES)،
    // متكررة هنا عمدًا عشان التذكير يشتغل ويختار نص عشوائي حتى لو الجافاسكريبت
    // نفسه أصلًا مش شغال (التطبيق مقفول تمامًا)
    private static final String[] MESSAGES = {
        "اللهم صلِّ وسلم على نبينا محمد ﷺ",
        "اللهم صلِّ على محمد وعلى آل محمد كما صليت على آل إبراهيم",
        "صلِّ على الحبيب المصطفى محمد ﷺ",
        "اللهم صلِّ وسلم وبارك على سيدنا محمد",
        "من صلى عليّ صلاة واحدة صلى الله عليه بها عشرًا",
        "صلاةً وسلامًا عليك يا رسول الله ﷺ"
    };

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // لو المستخدم كان لغى التفعيل بالظبط وقت ما المنبّه كان مسجّل فعلًا
        // (سباق نادر بين cancel() ورنين المنبّه)، منعرضش أي حاجة ونوقف على طول
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        String body = MESSAGES[new Random().nextInt(MESSAGES.length)];
        startForeground(NOTIF_ID, buildNotification(body));

        // لو المستخدم في مكالمة (عادية أو فيديو/صوت زي واتساب) وقت رنين
        // المنبّه، منشغّلش الصوت خالص عشان ميغطيش على صوت اللي بيكلمه —
        // بس الإشعار نفسه (اللي اتعرض فوق في startForeground) بيفضل واصل
        // بصمت زي أي إشعار عادي تاني
        if (isPhoneInCall()) {
            stopPlaybackAndService();
        } else {
            playSound();
        }

        // نجدول المرة الجاية على طول (مش بعد ما الصوت يخلص) عشان لو حصل أي
        // استثناء أثناء تشغيل الصوت، السلسلة تفضل مستمرة برضو ومتقفش عند أول
        // مشكلة تشغيل صوت عابرة
        scheduleNext(prefs);

        return START_NOT_STICKY;
    }

    // بنكشف إن فيه مكالمة شغالة (عادية من شركة الاتصالات، أو مكالمة صوت/فيديو
    // من تطبيق زي واتساب/ماسنجر) عن طريق وضع الصوت العام في النظام
    // (AudioManager mode)، بدل TelephonyManager.getCallState() اللي:
    //   ١) محتاج إذن READ_PHONE_STATE من أندرويد 10+ عشان يرجع قيمة حقيقية،
    //      وده إذن حساس هيحتاج توضيح على Play Store من غير داعي.
    //   ٢) أصلًا بيكشف مكالمات شركة الاتصالات بس، مش مكالمات تطبيقات زي
    //      واتساب واللي هي أغلب المكالمات دلوقتي.
    // أي تطبيق مكالمات (بما فيها تطبيق الهاتف نفسه) بيحوّل وضع الصوت لـ
    // MODE_IN_CALL أو MODE_IN_COMMUNICATION طول فترة المكالمة، فده بيغطي
    // الحالتين مع بعض من غير أي إذن إضافي في المانيفست
    private boolean isPhoneInCall() {
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                int mode = audioManager.getMode();
                return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION;
            }
        } catch (Exception e) {
            // لو حصل أي خطأ غير متوقع، نفترض إن مفيش مكالمة عشان السلوك
            // الافتراضي (تشغيل الصوت) يفضل زي ما كان
        }
        return false;
    }

    private void playSound() {
        try {
            // salawat.mp3 موجود أصلًا في جذر www (نفس الملف اللي بيشغّله
            // playNotificationSound() جوّه الجافاسكريبت من new Audio('salawat.mp3'))
            // وCapacitor بينسخه وقت البناء لـ assets/public/salawat.mp3، فبنقراه من
            // هناك مباشرة من غير ما نكرره في مكان تاني
            AssetFileDescriptor afd = getAssets().openFd("public/salawat.mp3");

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );
            mediaPlayer.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
            afd.close();
            mediaPlayer.setLooping(false);
            mediaPlayer.prepare();
            mediaPlayer.setOnCompletionListener(mp -> stopPlaybackAndService());
            mediaPlayer.start();

            // Wake Lock مؤقت طول مدة تشغيل الصوت بس (الملف قصير)، عشان يضمن إن
            // التشغيل يكمل لآخره حتى لو الشاشة مقفولة والمعالج حابب "ينام"
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mushaf:SalawatAlarmWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(60 * 1000L); // تايم-آوت أمان: دقيقة كافية جدًا لملف قصير
            }
        } catch (IOException | RuntimeException e) {
            // لو الملف مش موجود أو أي مشكلة تشغيل، على الأقل الإشعار نفسه
            // (اللي اتعرض فوق في startForeground) وصل، ونوقف السيرفيس بأمان
            stopPlaybackAndService();
        }
    }

    // بعد ما يشتغل، بنحسب المرة الجاية ونسجّلها فورًا (بنفس فكرة الأذان)، وبرضو
    // بنحدّث نسخة SharedPreferences عشان BootReceiver يلاقي أحدث معاد لو الموبايل
    // اتقفل قبل ما يجي الميعاد ده
    private void scheduleNext(SharedPreferences prefs) {
        int intervalMinutes = prefs.getInt(KEY_INTERVAL_MIN, 60);
        if (intervalMinutes <= 0) intervalMinutes = 60;
        long nextAt = System.currentTimeMillis() + (intervalMinutes * 60_000L);

        prefs.edit().putLong(KEY_NEXT_AT, nextAt).apply();
        SalawatAlarmScheduler.scheduleExactAt(this, nextAt);
    }

    private Notification buildNotification(String body) {
        Intent openAppIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPending = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("صلِّ على محمد ﷺ")
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(openPending)
            .setAutoCancel(true)
            .build();
    }

    private void stopPlaybackAndService() {
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
        // STOP_FOREGROUND_DETACH (false) بيسيب الإشعار ظاهر في اللوحة بعد ما
        // نطلع من وضع Foreground، بدل ما يختفي فورًا مع وقف الصوت
        stopForeground(STOP_FOREGROUND_DETACH);
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
                CHANNEL_ID, "تذكير الصلاة على النبي ﷺ", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("إشعار الصلاة على النبي محمد ﷺ");
            // الصوت بيتشغل يدويًا عبر MediaPlayer فوق مش عبر القناة، عشان كده
            // القناة نفسها صامتة عمدًا — ده اللي بيضمن إن الصوت يشتغل دايمًا صح
            // من غير ما يتقفل على أي إعداد قديم اتسجل بيه القناة قبل كده
            channel.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
