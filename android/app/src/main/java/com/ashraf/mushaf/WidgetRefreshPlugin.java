package com.ashraf.mushaf;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * يسمح لصفحات الويب داخل التطبيق بطلب تحديث فوري لويدجت مواقيت الصلاة
 * بالشاشة الرئيسية بعد حفظ مواقيت جديدة، بدل انتظار دورة التحديث التلقائية
 * كل ٣٠ دقيقة التي يفرضها نظام أندرويد.
 */
@CapacitorPlugin(name = "WidgetRefresh")
public class WidgetRefreshPlugin extends Plugin {

    @PluginMethod
    public void refreshPrayerWidget(PluginCall call) {
        try {
            PrayerWidgetProvider.refreshAll(getContext());
        } catch (Exception e) {
            // نتجاهل أي خطأ هنا، فهذا تحديث اختياري وليس حرجًا لعمل التطبيق
        }
        call.resolve();
    }
}
