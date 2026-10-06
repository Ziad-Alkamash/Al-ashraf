package com.ashraf.mushaf;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

// بلجن بسيط شغله الوحيد: فتح نافذة "حفظ باسم" الحقيقية بتاعة أندرويد
// (Storage Access Framework عبر ACTION_CREATE_DOCUMENT) عشان المستخدم
// يختار مكان واسم ملف النسخة الاحتياطية بنفسه (أي مجلد على الجهاز/بطاقة
// الذاكرة)، بدل ما نفتح قائمة مشاركة (Share sheet) بس زي ما كان قبل كده.
// نفس فكرة MediaSaverPlugin تمامًا، بس هنا الوجهة محددة من المستخدم نفسه
// مش من التطبيق.
@CapacitorPlugin(name = "BackupExporter")
public class BackupExporterPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String fileName = call.getString("fileName", "backup.json");
        String mimeType = call.getString("mimeType", "application/json");

        // نفضّل الطلب مفتوح (saveCall) لحد ما نتيجة نافذة الحفظ ترجع —
        // ممكن تاخد وقت (المستخدم بيتصفح مجلدات)، فمينفعش نرجّع النتيجة
        // فورًا زي أي PluginMethod عادي
        saveCall(call);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            // المستخدم لغى النافذة بنفسه (ضغط رجوع/إلغاء) من غير ما
            // يختار مكان — مش خطأ فعلي، فنميّزها بكود واضح
            call.reject("CANCELLED");
            return;
        }

        Uri uri = (result.getData() != null) ? result.getData().getData() : null;
        if (uri == null) {
            call.reject("تعذّر تحديد مكان الحفظ", "NO_URI");
            return;
        }

        try {
            String base64 = call.getString("base64", "");
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                if (out == null) {
                    call.reject("تعذّر فتح الملف للكتابة", "NO_STREAM");
                    return;
                }
                out.write(bytes);
                out.flush();
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("تعذّر حفظ الملف: " + e.getMessage(), "WRITE_FAILED");
        }
    }
}
