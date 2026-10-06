package com.ashraf.mushaf;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * شاشة إعدادات تظهر تلقائيًا فور ما المستخدم يضيف أي ويدجت من ويدجتات التطبيق
 * للشاشة الرئيسية (وتفتح تاني لو ضغط ضغطة مطوّلة على الويدجت واختار "تعديل").
 * تسمح بالتحكم "من برّه" التطبيق في:
 *   - وضع الويدجت فاتح/داكن (لكل الويدجتات).
 *   - درجة شفافية خلفية الويدجت (لكل الويدجتات).
 *   - كل كام دقيقة يتغيّر الدعاء المعروض (لويدجت الدعاء فقط).
 */
public class WidgetConfigActivity extends Activity {

    private int appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    // خطوات الفترة المتاحة بالدقايق: من ٥ دقايق لحد ٣ ساعات
    private static final int[] INTERVAL_STEPS_MIN = {5, 10, 15, 20, 30, 45, 60, 90, 120, 180};

    // لوحة ألوان جاهزة تغطي أغلب خلفيات الفون (غامقة وفاتحة وملوّنة)، والمستخدم لسه يقدر
    // يكتب أي لون هو عاوزه بالضبط في خانة الكود اللي تحتها
    private static final int[] FONT_COLOR_PALETTE = {
            0xFF211F1A, // أسود دافئ
            0xFFFFFFFF, // أبيض
            0xFF6F7752, // زيتوني
            0xFFB8892B, // ذهبي
            0xFF8E8A7D, // رمادي
            0xFF2E4C3B, // أخضر داكن
            0xFF1E3A5F, // أزرق داكن
            0xFF7A2E2E, // عنابي
            0xFF4A2E5A, // بنفسجي داكن
            0xFFEFEDE6  // كريمي فاتح
    };

    private SeekBar transparencySeek;
    private TextView transparencyValue;
    private SeekBar intervalSeek;
    private TextView intervalValue;
    private TextView themeLight;
    private TextView themeDark;
    private boolean darkSelected = false;

    private LinearLayout fontColorSwatchesRow;
    private View fontColorPreview;
    private EditText fontColorHex;
    private TextView fontColorReset;
    private View[] fontColorSwatchViews;
    private Integer selectedFontColor = null; // null = تلقائي (السلوك الافتراضي القديم)
    private boolean suppressHexWatcher = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTheme(R.style.AppTheme);
        setResult(Activity.RESULT_CANCELED);

        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            appWidgetId = extras.getInt(
                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        setContentView(R.layout.activity_widget_config);

        transparencySeek = findViewById(R.id.config_transparency_seek);
        transparencyValue = findViewById(R.id.config_transparency_value);
        intervalSeek = findViewById(R.id.config_interval_seek);
        intervalValue = findViewById(R.id.config_interval_value);
        themeLight = findViewById(R.id.config_theme_light);
        themeDark = findViewById(R.id.config_theme_dark);
        LinearLayout intervalSection = findViewById(R.id.config_interval_section);
        LinearLayout tasbihDhikrSection = findViewById(R.id.config_tasbih_dhikr_section);
        EditText tasbihDhikrInput = findViewById(R.id.config_tasbih_dhikr_input);
        Button tasbihDhikrAdd = findViewById(R.id.config_tasbih_dhikr_add);
        Button saveButton = findViewById(R.id.config_save_button);

        boolean isDua = WidgetPrefs.isDuaWidget(this, appWidgetId);
        intervalSection.setVisibility(isDua ? LinearLayout.VISIBLE : LinearLayout.GONE);

        boolean isTasbih = WidgetPrefs.isTasbihWidget(this, appWidgetId);
        tasbihDhikrSection.setVisibility(isTasbih ? LinearLayout.VISIBLE : LinearLayout.GONE);
        setupFontColorPicker(isDua, isTasbih);

        if (isTasbih) {
            tasbihDhikrAdd.setOnClickListener(v -> {
                String entered = tasbihDhikrInput.getText() == null
                        ? "" : tasbihDhikrInput.getText().toString().trim();
                if (entered.isEmpty()) {
                    Toast.makeText(this, "اكتب الذكر أولًا", Toast.LENGTH_SHORT).show();
                    return;
                }
                int index = TasbihPrefs.addCustomDhikr(this, entered);
                if (index == -1) {
                    Toast.makeText(this, "اكتب ذكرًا صالحًا أولًا", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (index == -2) {
                    Toast.makeText(this, "هذا الذكر موجود بالفعل", Toast.LENGTH_SHORT).show();
                    return;
                }
                TasbihPrefs.setIndex(this, appWidgetId, index);
                tasbihDhikrInput.setText("");
                TasbihWidgetProvider.refreshAll(this);
                Toast.makeText(this, "أُضيف الذكر إلى أذكار الويدجت", Toast.LENGTH_SHORT).show();
            });
        }

        darkSelected = WidgetPrefs.isDark(this, appWidgetId);
        updateThemeButtons();
        themeLight.setOnClickListener(v -> { darkSelected = false; updateThemeButtons(); });
        themeDark.setOnClickListener(v -> { darkSelected = true; updateThemeButtons(); });

        int currentTransparency = WidgetPrefs.getTransparency(this, appWidgetId);
        transparencySeek.setMax(100);
        transparencySeek.setProgress(currentTransparency);
        updateTransparencyLabel(currentTransparency);
        transparencySeek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                updateTransparencyLabel(progress);
            }
            @Override public void onStartTrackingTouch(SeekBar seekBar) { }
            @Override public void onStopTrackingTouch(SeekBar seekBar) { }
        });

        if (isDua) {
            int currentInterval = WidgetPrefs.getIntervalMinutes(this, appWidgetId);
            int stepIndex = closestStepIndex(currentInterval);
            intervalSeek.setMax(INTERVAL_STEPS_MIN.length - 1);
            intervalSeek.setProgress(stepIndex);
            updateIntervalLabel(INTERVAL_STEPS_MIN[stepIndex]);
            intervalSeek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    updateIntervalLabel(INTERVAL_STEPS_MIN[progress]);
                }
                @Override public void onStartTrackingTouch(SeekBar seekBar) { }
                @Override public void onStopTrackingTouch(SeekBar seekBar) { }
            });
        }

        saveButton.setOnClickListener(v -> save(isDua, isTasbih));
    }

    /** يجهّز قسم "لون الخط": لوحة ألوان جاهزة + خانة كود لون حر + زرار رجوع للتلقائي */
    private void setupFontColorPicker(boolean isDua, boolean isTasbih) {
        fontColorSwatchesRow = findViewById(R.id.config_font_color_swatches);
        fontColorPreview = findViewById(R.id.config_font_color_preview);
        fontColorHex = findViewById(R.id.config_font_color_hex);
        fontColorReset = findViewById(R.id.config_font_color_reset);
        TextView fontColorHint = findViewById(R.id.config_font_color_hint);

        fontColorHint.setText(isDua
                ? "يغيّر لون خط الدعاء، اختاره ليتوافق مع خلفيتك"
                : isTasbih
                ? "يغيّر لون العدّاد داخل الدايرة، اختاره ليتوافق مع خلفيتك"
                : "يغيّر لون خط التواريخ والشروق، اختاره ليتوافق مع خلفيتك");

        selectedFontColor = WidgetPrefs.hasCustomFontColor(this, appWidgetId)
                ? WidgetPrefs.getFontColor(this, appWidgetId, 0xFF211F1A)
                : null;

        buildFontColorSwatches();
        updateFontColorPreview();
        setFontColorHexSilently(selectedFontColor);

        fontColorHex.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable s) {
                if (suppressHexWatcher) return;
                String raw = s.toString().trim();
                if (raw.isEmpty()) return;
                try {
                    String normalized = raw.startsWith("#") ? raw : "#" + raw;
                    if (normalized.length() == 7) {
                        int color = Color.parseColor(normalized) | 0xFF000000; // نضمن عدم الشفافية
                        selectedFontColor = color;
                        updateFontColorPreview();
                        refreshFontColorSwatchHighlight();
                    }
                } catch (Exception ignored) {
                    // كود لون غير مكتمل أو غير صالح لسه: نتجاهله لحد ما المستخدم يكمل الكتابة
                }
            }
        });

        fontColorReset.setOnClickListener(v -> {
            selectedFontColor = null;
            setFontColorHexSilently(null);
            updateFontColorPreview();
            refreshFontColorSwatchHighlight();
        });
    }

    private void buildFontColorSwatches() {
        fontColorSwatchesRow.removeAllViews();
        fontColorSwatchViews = new View[FONT_COLOR_PALETTE.length];
        int size = dp(34);
        int margin = dp(8);
        for (int i = 0; i < FONT_COLOR_PALETTE.length; i++) {
            final int color = FONT_COLOR_PALETTE[i];
            View swatch = new View(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
            lp.setMarginEnd(margin);
            swatch.setLayoutParams(lp);
            swatch.setOnClickListener(v -> {
                selectedFontColor = color;
                updateFontColorPreview();
                refreshFontColorSwatchHighlight();
                setFontColorHexSilently(color);
            });
            fontColorSwatchesRow.addView(swatch);
            fontColorSwatchViews[i] = swatch;
        }
        refreshFontColorSwatchHighlight();
    }

    private void refreshFontColorSwatchHighlight() {
        if (fontColorSwatchViews == null) return;
        for (int i = 0; i < fontColorSwatchViews.length; i++) {
            boolean isSelected = selectedFontColor != null && selectedFontColor == FONT_COLOR_PALETTE[i];
            fontColorSwatchViews[i].setBackground(fontColorSwatchDrawable(FONT_COLOR_PALETTE[i], isSelected));
        }
    }

    private GradientDrawable fontColorSwatchDrawable(int fillColor, boolean selected) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(fillColor);
        drawable.setStroke(dp(selected ? 3 : 1), selected ? 0xFF6F7752 : 0x33000000);
        return drawable;
    }

    private void updateFontColorPreview() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        // مفيش لون مخصص محفوظ: نعرض دايرة رمادية محايدة تدل على "تلقائي"
        drawable.setColor(selectedFontColor != null ? selectedFontColor : 0xFFBFBBAF);
        drawable.setStroke(dp(1), 0x33000000);
        fontColorPreview.setBackground(drawable);
    }

    private void setFontColorHexSilently(Integer color) {
        suppressHexWatcher = true;
        fontColorHex.setText(color == null ? "" : String.format("#%06X", 0xFFFFFF & color));
        if (fontColorHex.getText() != null) {
            fontColorHex.setSelection(fontColorHex.getText().length());
        }
        suppressHexWatcher = false;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private int closestStepIndex(int minutes) {
        int bestIndex = 0;
        int bestDiff = Integer.MAX_VALUE;
        for (int i = 0; i < INTERVAL_STEPS_MIN.length; i++) {
            int diff = Math.abs(INTERVAL_STEPS_MIN[i] - minutes);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    /** يبدّل شكل زرّي فاتح/داكن حسب الاختيار الحالي (المختار زيتوني مصمت) */
    private void updateThemeButtons() {
        themeLight.setBackgroundResource(darkSelected ? R.drawable.config_seg_off : R.drawable.config_seg_on);
        themeLight.setTextColor(darkSelected ? 0xFF5A574D : 0xFFFFFFFF);
        themeDark.setBackgroundResource(darkSelected ? R.drawable.config_seg_on : R.drawable.config_seg_off);
        themeDark.setTextColor(darkSelected ? 0xFFFFFFFF : 0xFF5A574D);
    }

    private void updateTransparencyLabel(int progress) {
        transparencyValue.setText(progress + "% معتم");
    }

    private void updateIntervalLabel(int minutes) {
        intervalValue.setText("كل " + minutes + " دقيقة");
    }

    private void save(boolean isDua, boolean isTasbih) {
        WidgetPrefs.setTransparency(this, appWidgetId, transparencySeek.getProgress());
        WidgetPrefs.setDark(this, appWidgetId, darkSelected);
        WidgetPrefs.setFontColor(this, appWidgetId, selectedFontColor);

        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        if (isDua) {
            int minutes = INTERVAL_STEPS_MIN[intervalSeek.getProgress()];
            WidgetPrefs.setIntervalMinutes(this, appWidgetId, minutes);
            DuaWidgetProvider.updateWidget(this, manager, appWidgetId);
            DuaWidgetProvider.scheduleAlarm(this);
        } else if (isTasbih) {
            TasbihWidgetProvider.updateWidget(this, manager, appWidgetId);
        } else {
            PrayerWidgetProvider.updateWidget(this, manager, appWidgetId);
        }

        Intent resultValue = new Intent();
        resultValue.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        setResult(Activity.RESULT_OK, resultValue);
        finish();
    }
}
