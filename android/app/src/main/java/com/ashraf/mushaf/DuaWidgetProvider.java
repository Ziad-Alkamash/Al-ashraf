package com.ashraf.mushaf;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.widget.RemoteViews;

public class DuaWidgetProvider extends AppWidgetProvider {

    // مجموعة موسّعة من الأدعية لعبدنا أشرف أحمد جاهين رحمه الله ولموتى المسلمين أجمعين،
    // بتتغيّر تلقائيًا حسب الفترة اللي يحددها المستخدم من شاشة إعدادات الويدجت
    // (افتراضيًا كل ٣٠ دقيقة، وقابلة للضبط لأقل من كده أو أكتر حسب رغبته)
    private static final String[] DUAS = {
        "اللهم اغفر لعبدك أشرف أحمد جاهين ولموتى المسلمين أجمعين، وارحمهم وأسكنهم فسيح جناتك",
        "اللهم ارحم عبدك أشرف أحمد جاهين وسائر موتى المسلمين رحمة واسعة، واجعل قبورهم روضة من رياض الجنة",
        "اللهم اجعل ما قرأناه من كتابك في صحيفة حسنات عبدك أشرف أحمد جاهين وموتى المسلمين أجمعين",
        "اللهم نوّر قبر عبدك أشرف أحمد جاهين وقبور موتى المسلمين، وثبّتهم بالقول الثابت",
        "اللهم اغفر لعبدك أشرف أحمد جاهين ولموتى المسلمين أجمعين، وعافهم واعفُ عنهم، وأكرم نزلهم ووسّع مدخلهم",
        "اللهم اجعل عبدك أشرف أحمد جاهين وموتى المسلمين من أهل الفردوس الأعلى من الجنة بغير حساب ولا سابقة عذاب",
        "اللهم اغفر لحيّنا وميّتنا، وخص برحمتك عبدك أشرف أحمد جاهين وسائر موتى المسلمين",
        "اللهم أبدل عبدك أشرف أحمد جاهين وموتى المسلمين دارًا خيرًا من دارهم، وأهلًا خيرًا من أهلهم",
        "اللهم إن عبدك أشرف أحمد جاهين وموتى المسلمين في قبضتك، فارحمهم برحمتك التي وسعت كل شيء",
        "اللهم افسح لعبدك أشرف أحمد جاهين وموتى المسلمين في قبورهم، ونوّر لهم فيها، والحقهم بالصالحين",
        "اللهم ثبّت عبدك أشرف أحمد جاهين وموتى المسلمين عند سؤال الملكين، وارزقهم الجواب الصادق برحمتك",
        "اللهم إنا نسألك أن تتجاوز عن سيئات عبدك أشرف أحمد جاهين وموتى المسلمين، وتتقبل حسناتهم",
        "اللهم اجمع عبدك أشرف أحمد جاهين وموتى المسلمين مع النبيين والصديقين والشهداء والصالحين في الفردوس الأعلى",
        "اللهم ارحم غربة عبدك أشرف أحمد جاهين وموتى المسلمين في قبورهم، وآنس وحشتهم بذكرك ورحمتك",
        "اللهم اجعل القرآن الذي نقرؤه حجة لعبدك أشرف أحمد جاهين وموتى المسلمين لا حجة عليهم",
        "اللهم اغسل عبدك أشرف أحمد جاهين وموتى المسلمين بالماء والثلج والبرد، ونقّهم من الخطايا كما يُنقّى الثوب الأبيض من الدنس",
        "اللهم اجعل قبر عبدك أشرف أحمد جاهين وقبور موتى المسلمين روضة من رياض الجنة لا حفرة من حفر النار",
        "اللهم اربط على قلوب أهل عبدك أشرف أحمد جاهين وأهل موتى المسلمين، واجعل ما أصابهم في ميزان حسناتهم",
        "اللهم يا حي يا قيوم، برحمتك نستغيث، اغفر لعبدك أشرف أحمد جاهين ولموتى المسلمين أجمعين",
        "اللهم إنك عفوّ تحب العفو فاعفُ عن عبدك أشرف أحمد جاهين وعن موتى المسلمين أجمعين",
        "اللهم اجعل قبر عبدك أشرف أحمد جاهين وقبور موتى المسلمين مفروشًا بفراش الجنة، ومكسوًا بكسوة أهلها",
        "اللهم صلِّ على نبينا محمد، واغفر لعبدك أشرف أحمد جاهين ولموتى المسلمين، واجعل قبورهم روضة من رياض الجنة",
        "اللهم إن كان عبدك أشرف أحمد جاهين محسنًا فزد في إحسانه، وإن كان مسيئًا فتجاوز عنه، واجعل التراب خفيفًا عليه",
        "اللهم اكتب عبدك أشرف أحمد جاهين وموتى المسلمين في الشهداء، وارزقهم شفاعة الشافعين يوم القيامة",
        "اللهم آنس عبدك أشرف أحمد جاهين وموتى المسلمين في وحدة القبور، وارحم ضعفهم وغربتهم",
        "اللهم اجعل عبدك أشرف أحمد جاهين وموتى المسلمين ممن يُقال لهم يوم القيامة: ادخلوا الجنة بغير حساب",
        "اللهم إنا نستودعك عبدك أشرف أحمد جاهين وموتى المسلمين، فاحفظهم برحمتك يوم الفزع الأكبر",
        "اللهم اجعل حسناتهم في ميزان عبدك أشرف أحمد جاهين، وتقبل منه ومن موتى المسلمين صالح الأعمال",
        "اللهم ارزق عبدك أشرف أحمد جاهين وموتى المسلمين النظر إلى وجهك الكريم في جنات النعيم",
        "اللهم اجعل قبر عبدك أشرف أحمد جاهين نورًا، وارزقه ومن معه من موتى المسلمين رحمة لا انقطاع لها",
        "اللهم اغفر لعبدك أشرف أحمد جاهين ذنبه، ووسّع له في قبره، ونوّر له فيه إلى يوم يبعث",
        "اللهم إنا نسألك الجنة لعبدك أشرف أحمد جاهين وموتى المسلمين، ونعوذ بك من النار التي قرّبتهم منها أعمالهم",
        "اللهم تقبل من عبدك أشرف أحمد جاهين وموتى المسلمين ما قدّموه من خير، واعف عما قصّروا فيه",
        "اللهم اجعل عبدك أشرف أحمد جاهين وموتى المسلمين في جوارك يوم لا ظل إلا ظلك",
        "اللهم لا تحرمنا أجر عبدك أشرف أحمد جاهين، ولا تفتنّا بعده، واغفر لنا وله ولموتى المسلمين أجمعين",
        "اللهم إن عبدك أشرف أحمد جاهين ضيفك ونزيلك، وأنت خير مضيف فأكرم نزله ووسّع مدخله",
        "اللهم اجعل ما نتصدق به ونقرؤه اليوم واصلًا لعبدك أشرف أحمد جاهين ولموتى المسلمين أجمعين",
        // صيغ دعائية إضافية للتنويع في الويدجت، وهي أدعية عامة غير منسوبة إلى حديث بعينه.
        "اللهم اغفر لعبدك أشرف أحمد جاهين مغفرةً تمحو بها خطاياه، وارحمه رحمةً تسع السماوات والأرض",
        "اللهم أنزل على قبر أشرف أحمد جاهين سكينةً ونورًا، واجعله في أمنك ورضوانك إلى يوم يبعثون",
        "اللهم ارفع درجات أشرف أحمد جاهين في المهديين، واخلفه في عقبه في الغابرين، واغفر لنا وله يا رب العالمين",
        "اللهم اجعل أشرف أحمد جاهين في ضيافتك، وأكرم وفادته، واجعل مقامه في جنات النعيم",
        "اللهم تجاوز عن تقصير أشرف أحمد جاهين، وضاعف له ما قدّم من خير، واجعل عاقبته إلى رحمتك ورضوانك",
        "اللهم آنس أشرف أحمد جاهين في قبره، واجعل القرآن نورًا له، والرحمة رفيقًا، والجنة دارًا ومستقرًا",
        "اللهم ارحم أشرف أحمد جاهين في غربته، وآمن روعته، وثبّته عند السؤال، واجعل لقائك أحبّ إليه",
        "اللهم اجعل قبر أشرف أحمد جاهين واسعًا مديدًا، وافتح له بابًا إلى الجنة يأتيه منه روحها وريحانها",
        "اللهم اجعل أشرف أحمد جاهين ممن رضيت عنهم، وأكرمت نزلهم، ورفعت منزلتهم في عليين",
        "اللهم اجزه عن إحسانه إحسانًا، وعن إساءته عفوًا وغفرانًا، واجعل ما عندك خيرًا له مما ترك",
        "اللهم اجعل دعاءنا له رحمةً تصل إليه، واجمعنا به في مستقر رحمتك من غير خزي ولا فتنة",
        "اللهم أبدل وحشة قبر أشرف أحمد جاهين أنسًا، وظلمته نورًا، وضيقته سعةً من فضلك يا أرحم الراحمين",
        "اللهم اجعل عمله الصالح شفيعًا له، واجعل عفوك أوسع من ذنبه، ورحمتك أرجى عنده من عمله",
        "اللهم احشر أشرف أحمد جاهين مع عبادك الصالحين، واسقه من حوض نبيك شربةً هنيئةً لا يظمأ بعدها أبدًا",
        "اللهم اجعل كتابه في عليين، ويسّر حسابه، وثقّل بالحسنات ميزانه، وثبّت على الصراط قدمه",
        "اللهم اجعل أشرف أحمد جاهين من الآمنين يوم الفزع الأكبر، وبشّره بروح وريحان وربٍّ غير غضبان",
        "اللهم ارزق أهل أشرف أحمد جاهين الصبر والاحتساب، واجبر مصابهم، واخلف عليهم خيرًا، واربط على قلوبهم",
        "اللهم لا تحرم أشرف أحمد جاهين لذة النظر إلى وجهك الكريم، واجعله في جوار نبيك في جنات الخلد",
        "اللهم اجعل ما أصابه تكفيرًا ورفعةً، وما قدّمه من خيرٍ ذخيرةً له، وما عندك خيرًا وأبقى",
        "اللهم اغسل قلبه من الخطايا، ونقّه من الذنوب، واجعل لقاءك له لقاء رحمةٍ وبشرى وأمان",
        "اللهم اجعل ذكره الطيب باقيًا، وأجره جاريًا، ودعاء أهله ومحبيه نورًا ورحمةً له في قبره",
        "اللهم اجعل أشرف أحمد جاهين في ظل عرشك يوم لا ظل إلا ظلك، واسقه من حوض الكوثر بيد نبيك",
        "اللهم اجعل قبره روضةً من رياض الجنة، وافسح له فيه مدّ بصره، وافتح له أبواب رحمتك ورضوانك",
        "اللهم اكتب لأشرف أحمد جاهين من كل دعوةٍ صادقةٍ نصيبًا، ومن كل صدقةٍ جاريةٍ أجرًا، ومن كل رحمةٍ وافرًا",
        "اللهم ارحمه فوق الأرض وتحت الأرض ويوم العرض عليك، واجعل يوم القيامة يوم أمنه وبشراه",
        "اللهم لا تدع لأشرف أحمد جاهين ذنبًا إلا غفرته، ولا هَمًّا إلا فرّجته عنه برحمتك وكرمك",
        "اللهم اجعل ما قرأه من القرآن حجةً له ونورًا، وارفعه به درجاتٍ في الجنة، واجعل ثوابه واصلًا إليه",
        "اللهم اجعل ملائكة الرحمة تستقبله بالبشرى، واجعل مقامه في الفردوس الأعلى مع النبيين والصديقين",
        "اللهم أكرم أشرف أحمد جاهين بعفوك، وأبدله دارًا خيرًا من داره، وأهلًا خيرًا من أهله، وأدخله الجنة",
        "اللهم ارزقه أمنًا بعد الخوف، وراحةً بعد التعب، ونعيمًا مقيمًا لا ينقطع في جناتك",
        "اللهم اجعل أحسن أيامه يوم يلقاك، وأحسن عمله خواتيمه، وأحسن جزائه رضوانك والجنة",
        "اللهم اجمع له بين المغفرة والرحمة والرضوان، وأعذه من عذاب القبر ومن عذاب النار",
        "اللهم اجعل ما تركه من أثرٍ طيبٍ في ميزان حسناته، وبارك في كل من يدعو له ويتصدق عنه",
        "اللهم بلّغه منازل الشهداء والصالحين بفضلك، ولا تحاسبه بما تعلم، وعامله بما أنت أهله",
        "اللهم أكرم نزله، ووسّع مدخله، وأحسن مثواه، واجعل الجنة مستقره ومأواه",
        "اللهم اجعل أشرف أحمد جاهين ممن تبدّل سيئاتهم حسنات، وتُقبل توبتهم، وتُضاعف أجورهم",
        "اللهم اجعل له من كل ضيقٍ فرجًا، ومن كل وحشةٍ أنسًا، ومن كل خوفٍ أمنًا في قبره ويوم لقائك",
        "اللهم اجعل روح أشرف أحمد جاهين في نعيمٍ وسرور، وأكرمه بجوار عبادك الذين أنعمت عليهم",
        "اللهم ثبّت أشرف أحمد جاهين بالقول الثابت، وافتح له بابًا إلى رحمتك، وأره مقعده من الجنة",
        "اللهم اجعل دعاء أبنائه وأهله وأحبابه رفعةً له، واجعل اجتماعنا به اجتماعًا في دار كرامتك",
        "اللهم أعط أشرف أحمد جاهين كتابه بيمينه، ويسّر حسابه، واجعل الجنة موعده ومستقره",
        "اللهم ارزقه من فضلك رحمةً لا تنفد، ومغفرةً لا تنقطع، ونعيمًا دائمًا في جناتك",
        "اللهم اكتب له بكل حرفٍ قُرئ، وكل دعاءٍ رُفع، وكل خيرٍ أُهدي، أجرًا عظيمًا ورحمةً واسعة",
        "اللهم اجعل قبره مضيئًا بنور الإيمان، مطمئنًا بذكرك، معمورًا برحمتك إلى يوم الدين",
        "اللهم اجعل أشرف أحمد جاهين في أعلى عليين، مع الذين أنعمت عليهم من عبادك الصالحين",
        "اللهم اجعل عفوك عنه سابقًا لعقابك، ورحمتك به أوسع من ذنبه، وإحسانك إليه أعظم من رجائه",
        "اللهم هوّن عليه مرقده، وآنس وحشته، ولقّنه حجته، واجعل الجنة خيرًا له من الدنيا وما فيها",
        "اللهم ارزقنا وإياه لقاءً في الفردوس، لا فراق بعده، في رحمتك يا أرحم الراحمين",
        "اللهم اغفر له ولوالديه وللمؤمنين والمؤمنات، الأحياء منهم والأموات، برحمتك يا واسع المغفرة",
        "اللهم اختم دعاءنا له بالقبول، واجعل رجاءنا فيه حسن الظن بك، فأنت أرحم به منّا يا أرحم الراحمين"
    };

    private static final long TICK_MILLIS = 5 * 60 * 1000L; // نبضة الفحص كل ٥ دقائق (أقصر فترة ممكن يختارها المستخدم)

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            updateWidget(context, appWidgetManager, id);
        }
        scheduleAlarm(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                           int appWidgetId, Bundle newOptions) {
        updateWidget(context, appWidgetManager, appWidgetId);
    }

    @Override
    public void onEnabled(Context context) {
        scheduleAlarm(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelAlarm(context);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            WidgetPrefs.remove(context, id);
        }
    }

    /** يُستدعى من نبضة الـ AlarmManager الدورية لتحديث كل نسخ ويدجت الدعاء، كل نسخة حسب فترتها الخاصة */
    public static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            ComponentName component = new ComponentName(context, DuaWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(component);
            if (ids == null) return;
            for (int id : ids) {
                updateWidget(context, manager, id);
            }
        } catch (Exception e) {
            // تجاهل: النبضة الجاية هتحاول تاني
        }
    }

    public static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_dua);

        try {
            int intervalMinutes = Math.max(1, WidgetPrefs.getIntervalMinutes(context, appWidgetId));
            int transparency = WidgetPrefs.getTransparency(context, appWidgetId);
            boolean dark = WidgetPrefs.isDark(context, appWidgetId);
            WidgetTheme theme = WidgetTheme.get(dark);

            long slot = System.currentTimeMillis() / (intervalMinutes * 60_000L);
            String text = DUAS[(int) Math.floorMod(slot, (long) DUAS.length)];

            // الحجم الفعلي للويدجت حسب اتجاه الشاشة (راجع WidgetBackgroundHelper.currentSizeDp)
            int[] size = WidgetBackgroundHelper.currentSizeDp(context, appWidgetManager, appWidgetId, 250, 190);

            // خلفية بطابع صفحة الصوتيات (فاتح/داكن) بالشفافية اللي اختارها المستخدم
            views.setImageViewBitmap(R.id.widget_dua_bg,
                    WidgetBackgroundHelper.createBackground(context, size[0], size[1], transparency, dark));

            // "المصحف الأشرف" في منتصف الصف العلوي (بدل عنوان "دعاء اليوم" اللي اتشال)
            views.setImageViewBitmap(R.id.widget_dua_app_name,
                    WidgetTextRenderer.renderSingleLineText(context,
                            context.getString(R.string.app_name), 12f, theme.olive, R.font.tajawal_bold));

            // مساحة نص الدعاء = الويدجت ناقص حشو الجذر (12dp لكل جانب) وناقص الصف العلوي (30dp)
            // والهوامش. النص بيتكبّر لأقصى حجم يدخل في المساحة دي (لحد ٢٦sp) ويصغّر بس لو الدعاء طويل
            int textWidthDp = Math.max(60, size[0] - 32);
            int textHeightDp = Math.max(40, size[1] - 24 - 30 - 4 - 6);

            Bitmap duaBitmap;
            if (WidgetPrefs.hasCustomFontColor(context, appWidgetId)) {
                // المستخدم اختار لون خط بنفسه من شاشة إعدادات الويدجت عشان يتوافق مع خلفيته،
                // فبنستخدم اختياره مباشرة ونتجاهل السلوك التلقائي (لون الوضع أو التخمين من الخلفية)
                int customColor = WidgetPrefs.getFontColor(context, appWidgetId, theme.ink);
                duaBitmap = WidgetTextRenderer.renderFittedCenteredText(
                        context, text, textWidthDp, textHeightDp, 26f, 12f, customColor, R.font.tajawal_bold);
            } else if (transparency <= 0) {
                // بدون خلفية خالص: نرسم النص بلون تعبئة + حد متباين (renderFittedCenteredTextStroked)
                // عشان يفضل واضح فوق أي خلفية فون، بدل الاعتماد على اكتشاف لون الخلفية اللي مش
                // موثوق على كل الأجهزة (راجع WidgetTheme.adaptiveFillStroke)
                int[] fs = WidgetTheme.adaptiveFillStroke(context);
                duaBitmap = WidgetTextRenderer.renderFittedCenteredTextStroked(
                        context, text, textWidthDp, textHeightDp, 26f, 12f, fs[0], fs[1], 1.1f, R.font.tajawal_bold);
            } else {
                duaBitmap = WidgetTextRenderer.renderFittedCenteredText(
                        context, text, textWidthDp, textHeightDp, 26f, 12f, theme.ink, R.font.tajawal_bold);
            }
            views.setImageViewBitmap(R.id.widget_dua_text, duaBitmap);

            Intent launchIntent = new Intent(context, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    context, appWidgetId, launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_dua_root, pendingIntent);

        } catch (Exception e) {
            // شبكة أمان: منمنعش الويدجت من الظهور حتى لو حصل خطأ غير متوقع
        }

        try {
            appWidgetManager.updateAppWidget(appWidgetId, views);
        } catch (Exception ignored) { /* لا شيء أكثر يمكن فعله هنا */ }
    }

    /** يضبط نبضة متكررة كل ٥ دقائق تقريبًا لتحديث كل نسخ ويدجت الدعاء، كل نسخة بتتغيّر فعليًا
     *  حسب الفترة الخاصة بيها فقط (٥ دقائق هي أقصر فترة متاحة للمستخدم، فبتغطي كل الخيارات) */
    public static void scheduleAlarm(Context context) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            ComponentName component = new ComponentName(context, DuaWidgetProvider.class);
            int[] ids = manager.getAppWidgetIds(component);
            if (ids == null || ids.length == 0) return;

            Intent intent = new Intent(context, DuaWidgetProvider.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);

            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            alarmManager.setInexactRepeating(
                    AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + TICK_MILLIS,
                    TICK_MILLIS,
                    pendingIntent
            );
        } catch (Exception ignored) { }
    }

    private static void cancelAlarm(Context context) {
        try {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;
            Intent intent = new Intent(context, DuaWidgetProvider.class);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            alarmManager.cancel(pendingIntent);
        } catch (Exception ignored) { }
    }
}
