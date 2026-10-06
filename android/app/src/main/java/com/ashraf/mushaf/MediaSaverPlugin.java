package com.ashraf.mushaf;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// بلجن بسيط شغله الوحيد: حفظ نسخة من صورة/فيديو الآية في معرض الصور العام
// بالموبايل (نفس تطبيق "الصور" اللي بيفتح منه المستخدم صور الكاميرا)، بدل
// ما تفضل الصورة في كاش التطبيق الداخلي بس (اللي مش ظاهر في المعرض أصلًا،
// وبيتمسح تلقائيًا وقت تنظيف الكاش). بيتنادى بالتوازي مع فتح شاشة المشاركة
// من app.js (saveMediaToGallery)، فمفيش أي تعطيل أو تأخير في ظهور شاشة
// المشاركة نفسها.
//
// من أندرويد 10 (API 29) فوق: بنستخدم MediaStore مباشرة (Scoped Storage) من
// غير أي إذن تخزين خالص. قبل كده (9 وأقل): بنكتب مباشرة في فولدر
// Pictures/Movies العام (محتاج إذن WRITE_EXTERNAL_STORAGE، متسجل في
// المانفست بـ maxSdkVersion="28" عشان ميتطلبش على أندرويد الحديثة أصلًا)
// وبعدين بنعمل MediaScannerConnection.scanFile عشان يظهر فورًا في المعرض
// من غير ما المستخدم يحتاج يعيد تشغيل الموبايل.
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

    private static final String ALBUM_NAME = "المصحف الأشرف";

    @PluginMethod
    public void saveMedia(PluginCall call) {
        String base64 = call.getString("base64");
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "image/png");
        boolean isVideo = Boolean.TRUE.equals(call.getBoolean("isVideo", false));

        if (base64 == null || fileName == null) {
            call.reject("base64/fileName مطلوبين");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            boolean ok = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                ? saveViaMediaStore(bytes, fileName, mimeType, isVideo)
                : saveLegacy(bytes, fileName, isVideo);

            if (ok) {
                JSObject result = new JSObject();
                result.put("saved", true);
                call.resolve(result);
            } else {
                call.reject("تعذّر الحفظ في المعرض");
            }
        } catch (Exception e) {
            call.reject("تعذّر الحفظ في المعرض: " + e.getMessage());
        }
    }

    // أندرويد 10+ : كتابة مباشرة عبر MediaStore (Scoped Storage)، من غير أي
    // إذن تخزين — الطريقة الرسمية الحديثة والوحيدة الموصى بيها
    private boolean saveViaMediaStore(byte[] bytes, String fileName, String mimeType, boolean isVideo) {
        Context context = getContext();
        Uri collection = isVideo
            ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String relativeDir = (isVideo ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES)
            + File.separator + ALBUM_NAME;

        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri itemUri = context.getContentResolver().insert(collection, values);
        if (itemUri == null) return false;

        try (OutputStream out = context.getContentResolver().openOutputStream(itemUri)) {
            if (out == null) return false;
            out.write(bytes);
        } catch (Exception e) {
            context.getContentResolver().delete(itemUri, null, null);
            return false;
        }

        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        context.getContentResolver().update(itemUri, values, null, null);
        return true;
    }

    // قبل أندرويد 10: كتابة مباشرة في فولدر Pictures/Movies العام + فحص
    // ميديا سكانر يدوي عشان يظهر في تطبيق الصور فورًا
    private boolean saveLegacy(byte[] bytes, String fileName, boolean isVideo) {
        File baseDir = Environment.getExternalStoragePublicDirectory(
            isVideo ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES
        );
        File albumDir = new File(baseDir, ALBUM_NAME);
        if (!albumDir.exists() && !albumDir.mkdirs()) return false;

        File outFile = new File(albumDir, fileName);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(bytes);
        } catch (Exception e) {
            return false;
        }

        try {
            MediaScannerConnection.scanFile(
                getContext(), new String[]{outFile.getAbsolutePath()}, null, null
            );
        } catch (Exception ignored) { /* الملف اتكتب أصلًا، الفحص تحسين إضافي بس */ }
        return true;
    }
}
