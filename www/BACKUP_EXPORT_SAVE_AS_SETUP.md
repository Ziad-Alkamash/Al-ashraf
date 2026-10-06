# تصدير النسخة الاحتياطية بنافذة "حفظ باسم" حقيقية (بدل قائمة المشاركة)

## ليه ده مطلوب؟
زرار "تصدير نسخة احتياطية" في الإعدادات كان بيكتب الملف في مجلد كاش
مؤقت وبعدين يفتح قائمة **مشاركة** النظام (Share sheet) — يعني اختياراتك
هي "واتساب/تيليجرام/نسخ الرابط..." مش "اختار مكان على جهازي". ده عكس
تمامًا استيراد النسخة الاحتياطية، اللي بيفتح متصفح ملفات الجهاز عادي
(`<input type="file">` بيسلّم الاختيار لأندرويد نفسه).

عشان زرار التصدير يفتح نفس نافذة "حفظ باسم" الحقيقية بتاعة أندرويد
(اللي فيها تصفّح مجلدات الجهاز/بطاقة الذاكرة واختيار مكان واسم)، مفيش
API جاهزة لكده في المتصفح ولا في بلجن Capacitor الرسمي `Filesystem` —
لازم بلجن أندرويد أصلي صغير بيستخدم Storage Access Framework
(`Intent.ACTION_CREATE_DOCUMENT`)، بنفس الطريقة اللي بلجن `MediaSaver`
الموجود عندك بالفعل مبني بيها.

الكود بتاع `app.js` (ملف الويب) **جاهز خالص ومحدّث فعلاً** — بيدوّر على
بلجن اسمه `BackupExporter`، ولو مش موجود بيرجع تلقائيًا لسلوك المشاركة
القديم (يعني الزرار مش هيبوّظ لو اتأخرت تضيف البلجن). المطلوب منك بس
الخطوات دي في **مشروع الأندرويد الأصلي** (مش مجلد `www`).

## الخطوات

### 1) إنشاء ملف البلجن
جوه `android/app/src/main/java/<مسار-الباكدج بتاعك>/`
(نفس المجلد اللي فيه بلجن `MediaSaver` أو `MainActivity` عندك)، أنشئ
ملف اسمه `BackupExporterPlugin.kt`:

```kotlin
package com.example.almushafalashraf // <-- غيّرها لباكدج مشروعك الحقيقي (نفسه المكتوب في MainActivity.java/kt)

import android.app.Activity
import android.content.Intent
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "BackupExporter")
class BackupExporterPlugin : Plugin() {

    // بيفتح نافذة "حفظ باسم" الحقيقية بتاعة أندرويد (Storage Access
    // Framework)، فالمستخدم بيختار المجلد والاسم بنفسه، وبعدين بنكتب
    // البيانات (base64 جاي من الجافاسكريبت) في المكان اللي اختاره
    @PluginMethod
    fun saveFile(call: PluginCall) {
        val fileName = call.getString("fileName") ?: "backup.json"
        val mimeType = call.getString("mimeType") ?: "application/json"

        saveCall(call) // نفضّل الطلب مفتوح لحد ما نتيجة النافذة ترجع

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mimeType
            putExtra(Intent.EXTRA_TITLE, fileName)
        }
        startActivityForResult(call, intent, "handleSaveResult")
    }

    @ActivityCallback
    private fun handleSaveResult(call: PluginCall?, result: androidx.activity.result.ActivityResult) {
        if (call == null) return

        if (result.resultCode != Activity.RESULT_OK) {
            // المستخدم رجع/لغى النافذة من غير ما يختار مكان — مش خطأ حقيقي
            call.reject("CANCELLED")
            return
        }

        val uri = result.data?.data
        if (uri == null) {
            call.reject("NO_URI", "تعذّر تحديد مكان الحفظ")
            return
        }

        try {
            val base64 = call.getString("base64") ?: ""
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            context.contentResolver.openOutputStream(uri)?.use { out ->
                out.write(bytes)
                out.flush()
            }
            val ret = JSObject()
            ret.put("uri", uri.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("WRITE_FAILED", e.message)
        }
    }
}
```

> ملحوظة: لو مشروعك بـ Java مش Kotlin، قوللي وهحوّلها لك — نفس المنطق
> بالظبط، بس بصيغة Java.

### 2) تسجيل البلجن
افتح `MainActivity.java` (أو `.kt`) بتاعك، ودوّر على أي سطر `registerPlugin(...)`
موجود بالفعل (غالبًا بتسجّل بيه `MediaSaver` أو بلجنات مخصصة تانية) —
لو موجود، زوّد عليه سطر جديد. لو مفيش، حط السطر ده **قبل** استدعاء
`super.onCreate(savedInstanceState)`:

```java
registerPlugin(BackupExporterPlugin.class);
```

### 3) مزامنة المشروع
```bash
npx cap sync android
```

## بعد كده
زرار "تصدير نسخة احتياطية" هيفتح نافذة "حفظ باسم" الحقيقية بتاعة
أندرويد تلقائيًا (فيها تصفّح كل مجلدات الجهاز)، ومفيش أي تعديل تاني
مطلوب — كود الويب (`app.js`) بيكتشف البلجن الجديد ويستخدمه لوحده.

لو لسه مش جاهز تضيف البلجن دلوقتي، الزرار هيفضل شغال بسلوكه القديم
(قائمة المشاركة) لغاية ما تضيفه.
