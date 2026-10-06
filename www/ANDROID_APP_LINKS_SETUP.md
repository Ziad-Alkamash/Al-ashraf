# روابط دعوة الختمة الجماعية

رابط الدعوة يستخدم Firebase Hosting، ويفتح مباشرةً في تطبيق Android بعد نشر ملف التحقق:

`https://almushaf-alashraf-b284b.web.app/.well-known/assetlinks.json`

## إعداد Android

المشروع يعلن عن روابط HTTPS على `almushaf-alashraf-b284b.web.app` و`almushaf-alashraf-b284b.firebaseapp.com` في `android/app/src/main/AndroidManifest.xml`. و`MainActivity` يمرّر رابط التشغيل البارد والروابط الجديدة إلى واجهة الختمة. معرّف التطبيق هو `com.ashraf.mushaf`.

## نشر ملف التحقق

الملف `www/.well-known/assetlinks.json` يحتوي بصمة شهادة ملف `android/app/release/app-release.apk` الموجود في المشروع:

`1C:52:32:7F:F2:99:45:8A:DF:C5:CE:EB:AF:95:00:E8:0C:71:28:B4:0F:C9:9E:F2:92:B3:34:36:77:EC:60:0A`

انشره على Firebase Hosting بحيث يرجع المسار أعلاه الملف بصيغة JSON مع استجابة HTTP ناجحة، ومن دون تحويل إلى صفحة HTML.

إعداد Hosting موجود الآن في `firebase.json` ويستخدم `www` كمجلد نشر، مع استثناء `.well-known` من التجاهل. بعد تسجيل الدخول إلى Firebase CLI، انشر الموقع بالأمر:

```powershell
firebase deploy --only hosting
```

لو وقّعت APK جديدًا بمفتاح مختلف، استخرج SHA-256 للشهادة التي على APK النهائي بالأمر:

```powershell
apksigner verify --print-certs android/app/release/app-release.apk
```

حدّث البصمة في الملفين `www/assetlinks.json` و`www/.well-known/assetlinks.json`، ثم أعد نشر Hosting.

## سلوك الدعوة

بعد فتح الرابط داخل التطبيق، تظهر معاينة اسم الختمة وتقدمها وزر **انضمام**. لا يُرسل طلب الانضمام قبل الضغط على الزر. إذا لم يفتح Android التطبيق تلقائيًا، تعرض صفحة الدعوة خيار **فتح في التطبيق** كحل احتياطي.
