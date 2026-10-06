package com.ashraf.mushaf;

import android.os.Bundle;
import android.content.SharedPreferences;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private final Handler inviteHandler = new Handler(Looper.getMainLooper());
    // نمسك ريفرنس للكولباك عشان نقدر نعطّلها مؤقتًا لما نحب نسيب النظام
    // يقفل الـ Activity فعليًا (نتجنب Loop لا نهائي)
    private OnBackPressedCallback backCallback;

    // ريفرنس لكونترولر شريط الحالة/التنقل، محتاجينه تاني في onWindowFocusChanged
    // عشان نعيد إخفاء شريط الحالة كل ما التطبيق يرجع للـ focus (بعد ما
    // المستخدم يسحب ستارة الإشعارات ويقفلها، أو يرجع من تطبيق تاني) — من غيرها
    // أندرويد بيسيب شريط الحالة ظاهر تاني وميرجعش يخفيه لوحده
    private WindowInsetsControllerCompat insetsController;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaControlPlugin.class);
        registerPlugin(WidgetRefreshPlugin.class);
        registerPlugin(AdhanAlarmPlugin.class);
        registerPlugin(SalawatAlarmPlugin.class);
        registerPlugin(MediaSaverPlugin.class);
        registerPlugin(BackupExporterPlugin.class);
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);

        // إعدادات WebView مطلوبة عشان بث الراديو الحي (إذاعة الحرم المكي
        // والقاهرة) يشتغل: بعض السيرفرات (زي radiojar.com) لسه بترجع
        // بعض الروابط/الـ redirects على HTTP عادي مش HTTPS، فمن غير
        // MIXED_CONTENT_ALWAYS_ALLOW الـ WebView بيمنعها. كمان بعض
        // سيرفرات البث بترفض الطلبات اللي الـ User-Agent بتاعها "غريب"
        // (زي WebView الافتراضي بتاع Capacitor)، فبنستخدم User-Agent
        // قياسي لمتصفح Chrome على أندرويد عشان السيرفر يعاملنا كمتصفح عادي
        WebView webView = (getBridge() != null) ? getBridge().getWebView() : null;
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            );

            // نقفل تكبير/تصغير خط الـ WebView على 100% دايمًا، بغض النظر
            // عن إعداد "حجم الخط" في إعدادات عرض الهاتف. من غير السطر ده،
            // أندرويد بيورّث الـ fontScale بتاع النظام للـ WebView مباشرة
            // (قبل ما صفحة الويب حتى تتحمل)، وده بيكبّر كل نصوص الواجهة
            // (الهيدر، بطاقة أوقات الصلاة، الأزرار...) بشكل غير متناسب مع
            // الصناديق التصميمية الثابتة حواليها فتركب فوق بعضها. تعديل
            // CSS وحده (text-size-adjust) مش كافي هنا لأن المشكلة أصلها
            // من نظام أندرويد نفسه مش من المتصفح. تكبير خط قراءة المصحف
            // نفسه هيفضل شغال عادي لأنه إعداد داخلي في التطبيق (منفصل
            // تمامًا عن إعداد النظام ده)
            settings.setTextZoom(100);
            clearStaleAppShellCacheAfterUpgrade(webView);
        }

        // Edge-to-Edge حقيقي: مبنسيبش الـ WebView يتوقف عند حدود شريط الحالة/شريط
        // التنقل، وخلفية التطبيق (الغامقة) هي اللي بتتمدد وتلف وراهم بدل ما
        // نخفيهم. ملحوظة مهمة: كنا قبل كده بنعمل hide() لشريط الحالة بالكامل —
        // ده كان هو سبب الشريط الأسود الفاضي اللي بيبان فوق (النظام بيحجز
        // مساحة شريط الحالة كـ "منطقة سحب مؤقتة" بلون أسود من عنده هو، مش من
        // خلفية التطبيق، عشان تقدر تسحبه يرجع تاني). الحل الصح لـ Edge-to-Edge
        // إننا نسيب الشريطين ظاهرين لكن شفافين تمامًا، فمحتوى التطبيق (بخلفيته
        // الغامقة) هو اللي بيبان وراهم مباشرة من غير أي حجز مساحة أو لون غريب.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            // من غير ده، أندرويد بيرسم طبقة شبه شفافة (scrim) لوحده وراء أزرار
            // التنقل عشان يضمن وضوحها فوق أي خلفية — بيبقى شكله وكأنه شريط
            // غامق برضو. تعطيلها هنا يخلي خلفية التطبيق تبان صافية 100% تحتها.
            getWindow().setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            // خلفية التطبيق غامقة (شبه سوداء) في كل الأحوال، فأيقونات شريط
            // الحالة/التنقل (الساعة، البطارية، خط الرجوع) لازم تبقى فاتحة
            // (بيضاء) عشان تتقرأ فوقها — isAppearanceLight = false يعني كده.
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);

            // إخفاء شريط الحالة (الساعة/الأيقونات) بالكامل وهو التطبيق مفتوح،
            // من غير ما نمنع سحب ستارة الإشعارات خالص — BEHAVIOR_SHOW_TRANSIENT
            // _BARS_BY_SWIPE يخلي أي سحب من فوق يظهر الشريط مؤقتًا (وستارة
            // الإشعارات تنزل عادي بالظبط زي أي تطبيق تاني)، وبعد ما المستخدم
            // يقفل الستارة يرجع يخفي تلقائي. شريط التنقل السفلي (زر الرجوع)
            // فضل ظاهر عادي زي ما كان، محدش طلب نخفيه هو
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.statusBars());
            insetsController = controller;
        }

        // ملحوظة مهمة: زر/جيستشر الرجوع كان بيقفل التطبيق على طول، والسبب
        // الأصلي كان بلجن @capacitor/app مش متسجل. بس تصحيح onBackPressed()
        // "الكلاسيكي" (override عادي) ما اشتغلش برضه، لأن أندرويد الحديثة
        // (13/14+) بتستخدم نظام الـ "predictive back gesture" اللي بيعتمد
        // على OnBackPressedDispatcher/OnBackPressedCallback بدل onBackPressed()
        // القديمة — وقوالب Capacitor الحديثة (وAppCompatActivity نفسها) بتفعّل
        // الميكانيزم ده فعليًا، فـ onBackPressed() القديمة كانت بتتجاهل تمامًا
        // ومفيش داعي حتى نعرّفها. الحل الصحيح دلوقتي هو تسجيل Callback على
        // الـ dispatcher نفسه، وده بيشتغل صح مع الجيستشر وزرار النظام مع بعض.
        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = (getBridge() != null) ? getBridge().getWebView() : null;
                if (webView == null) {
                    exitViaSystemDefault();
                    return;
                }

                String js = "(function(){"
                        + "try {"
                        + "  if (typeof window.__handleNativeBackPress === 'function') {"
                        + "    return window.__handleNativeBackPress() === 'exit' ? 'exit' : 'handled';"
                        + "  }"
                        + "} catch (e) {}"
                        + "return 'missing';"
                        + "})();";

                webView.evaluateJavascript(js, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String result) {
                        // 'missing' يعني الجافاسكريبت لسه ما اتحملش (زي أول
                        // تحميل للتطبيق)، فنسيب السلوك الافتراضي بدل ما نعلّق
                        // زر الرجوع تمامًا. 'exit' يعني واقف في الصفحة
                        // الرئيسية من غير أي حاجة مفتوحة فعلًا محتاج يقفل.
                        if (result == null || result.contains("exit") || result.contains("missing")) {
                            runOnUiThread(MainActivity.this::exitViaSystemDefault);
                        }
                        // لو 'handled' مفيش حاجة نعملها، الجافاسكريبت خلص
                        // المطلوب فعلًا (قفل أوفرلاي أو رجوع بين الصفحات)
                    }
                });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);

        // رابط الدعوة ممكن يفتح التطبيق وهو مقفول. نعيد تمريره بعد تحميل
        // واجهة WebView لأن سكربت الختمة الجماعية يُحمّل بعد إنشاء الـ Activity.
        dispatchKhatmaInvite(getIntent());
        dispatchWidgetNavigation(getIntent());
        dispatchUpdateNotification(getIntent());
    }

    /**
     * The app shell is bundled inside the APK, but the WebView service worker
     * cache survives APK upgrades. On a native version change, remove only the
     * versioned app-shell caches and reload once so the new APK's HTML/JS is
     * used immediately. Quran/audio caches and all user data remain untouched.
     */
    private void clearStaleAppShellCacheAfterUpgrade(WebView webView) {
        final int currentVersionCode;
        try {
            PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            currentVersionCode = android.os.Build.VERSION.SDK_INT >= 28
                ? (int) packageInfo.getLongVersionCode()
                : packageInfo.versionCode;
        } catch (PackageManager.NameNotFoundException error) {
            return;
        }
        final SharedPreferences prefs = getSharedPreferences("web_asset_migration", MODE_PRIVATE);
        if (prefs.getInt("native_version_code", 0) == currentVersionCode) return;

        final Runnable[] migrate = new Runnable[1];
        final long deadline = android.os.SystemClock.uptimeMillis() + 30000;
        migrate[0] = () -> {
            if (isFinishing() || isDestroyed()) return;
            if (webView.getUrl() == null || webView.getProgress() < 100) {
                if (android.os.SystemClock.uptimeMillis() < deadline) {
                    webView.postDelayed(migrate[0], 250);
                }
                return;
            }
            webView.evaluateJavascript(
                "(async()=>{try{" +
                    "const names=await caches.keys();" +
                    "const current='mushaf-ashraf-v" + currentVersionCode + "';" +
                    "const stale=names.filter(n=>/^mushaf-ashraf-v\\d+$/.test(n)&&n!==current);" +
                    "if(!stale.length)return 'clean';" +
                    "await Promise.all(stale.map(n=>caches.delete(n)));" +
                    "sessionStorage.setItem('alashraf:skip-splash-on-shell-refresh','1');" +
                    "location.reload();return 'cleared';" +
                "}catch(e){console.error('App shell cache migration failed',e);return 'failed';}})()",
                result -> {
                    if ("\"failed\"".equals(result)) return;
                    prefs.edit().putInt("native_version_code", currentVersionCode).apply();
                }
            );
        };
        webView.postDelayed(migrate[0], 500);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchKhatmaInvite(intent);
        dispatchWidgetNavigation(intent);
        dispatchUpdateNotification(intent);
    }

    private void dispatchUpdateNotification(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("open_update_ready", false)) return;
        intent.removeExtra("open_update_ready");
        final int[] attempts = {0};
        Runnable[] deliver = new Runnable[1];
        deliver[0] = () -> {
            if (isFinishing() || isDestroyed()) return;
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) {
                if (++attempts[0] < 40) inviteHandler.postDelayed(deliver[0], 250);
                return;
            }
            webView.evaluateJavascript(
                "window.__ashrafUpdateReadyPending=true;window.dispatchEvent(new Event('alashraf:update-download-notification-tap'))", null);
        };
        inviteHandler.postDelayed(deliver[0], 300);
    }

    private void dispatchWidgetNavigation(Intent intent) {
        if (intent == null || !"prayer".equals(intent.getStringExtra("openTab"))) return;
        // لا نستهلك النية قبل أن تجهز واجهة الويب: قد يبدأ التطبيق باردًا
        // ويحتاج WebView بعض الوقت قبل إتاحة دالة الانتقال إلى صفحة الصلاة.
        intent.removeExtra("openTab");
        final int[] attempts = {0};
        Runnable[] deliver = new Runnable[1];
        deliver[0] = () -> {
            if (isFinishing() || isDestroyed()) return;
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) {
                if (++attempts[0] < 40) inviteHandler.postDelayed(deliver[0], 250);
                return;
            }
            webView.evaluateJavascript(
                    "(function(){if(typeof window.__openPrayerFromWidget==='function'){"
                    + "window.__openPrayerFromWidget();return true;}return false;})()",
                    value -> {
                        if ((value == null || value.contains("false")) && ++attempts[0] < 40) {
                            inviteHandler.postDelayed(deliver[0], 250);
                        }
                    });
        };
        inviteHandler.postDelayed(deliver[0], 350);
    }

    private void dispatchKhatmaInvite(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;
        String scheme = uri.getScheme();
        boolean supported = "almushafalashraf".equalsIgnoreCase(scheme)
                || ("https".equalsIgnoreCase(scheme)
                    && ("almushaf-alashraf-b284b.web.app".equalsIgnoreCase(uri.getHost())
                        || "almushaf-alashraf-b284b.firebaseapp.com".equalsIgnoreCase(uri.getHost())));
        if (!supported || (uri.getQueryParameter("khatmaCode") == null
                && uri.getQueryParameter("code") == null)) return;

        String safeUrl = JSONObject.quote(uri.toString());
        final int[] attempts = {0};
        Runnable[] deliver = new Runnable[1];
        deliver[0] = () -> {
            if (isFinishing() || isDestroyed()) return;
            android.webkit.WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) {
                if (++attempts[0] < 40) inviteHandler.postDelayed(deliver[0], 250);
                return;
            }
            webView.evaluateJavascript(
                    "(function(u){if(typeof window.__openKhatmaInviteUrl==='function'){"
                    + "window.__openKhatmaInviteUrl(u);return true;}"
                    + "window.__pendingInviteUrl=u;return false;})(" + safeUrl + ");",
                    value -> {
                        if ((value == null || value.contains("false")) && ++attempts[0] < 40) {
                            inviteHandler.postDelayed(deliver[0], 250);
                        }
                    });
        };
        inviteHandler.postDelayed(deliver[0], 350);
    }

    // بنعطّل الكولباك بتاعنا مؤقتًا وننادي على الديسباتشر تاني عشان يوصل
    // للسلوك الافتراضي (قفل الـ Activity)، بعدين نرجّع تفعيلها عشان تفضل
    // شغالة للمرة الجاية
    private void exitViaSystemDefault() {
        backCallback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        backCallback.setEnabled(true);
    }

    // لما المستخدم يسحب ستارة الإشعارات ويقفلها تاني (أو يرجع للتطبيق من
    // تطبيق/شاشة تانية)، أندرويد بيرجّع شريط الحالة ظاهر تلقائيًا ومبيخفيهوش
    // لوحده تاني. الـ Activity بترجع تاخد الـ focus (hasFocus=true) في اللحظة
    // دي بالظبط، فبنعيد إخفاءه هنا عشان يفضل مخفي دايمًا لحد ما المستخدم يسحب
    // من فوق تاني (السلوك المؤقت العادي)
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && insetsController != null) {
            insetsController.hide(WindowInsetsCompat.Type.statusBars());
        }
    }
}
