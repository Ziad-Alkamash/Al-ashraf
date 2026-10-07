(function () {
  'use strict';

  const Core = window.AlAshrafUpdateCore;
  const LAST_CHECK_KEY = 'alashraf:apk-update:last-check';
  const LATER_KEY = 'alashraf:apk-update:later-until';
  const CHECK_INTERVAL = 60 * 60 * 1000;
  let updateDialog = null;
  let currentUpdate = null;
  let installedVersionName = '';
  let isForced = false;
  let checking = false;
  let progressListener = null;
  let state = 'idle';
  let apkReady = false;
  let apkReadyVersionCode = 0;
  let pendingDialogTimer = null;
  let activeCheckPromise = null;
  let backgroundReadyToastTimer = null;

  function uiText(key, fallback) {
    const i18n = window.appI18n;
    const lang = i18n?.getSavedLang?.() || 'ar';
    const value = i18n?.t?.(lang, key);
    return value && value !== key ? value : fallback;
  }

  const getPlugin = () => window.Capacitor?.Plugins?.ApkUpdater || null;
  const storageGet = (storage, key) => { try { return storage.getItem(key); } catch (_) { return null; } };
  const storageSet = (storage, key, value) => { try { storage.setItem(key, value); } catch (_) {} };
  const storageRemove = (storage, key) => { try { storage.removeItem(key); } catch (_) {} };
  const UPDATE_AVAILABLE_KEY = 'alashraf:apk-update:available-version-code';

  function setSettingsUpdateAvailable(available, versionCode = '') {
    const button = document.getElementById('btn-open-update-check');
    const dot = document.getElementById('settings-update-dot');
    if (button) button.classList.toggle('has-update', !!available);
    if (dot) dot.classList.toggle('hidden', !available);
    window.dispatchEvent(new CustomEvent('alashraf:update-availability', { detail: { available: !!available } }));
    if (available && versionCode) storageSet(localStorage, UPDATE_AVAILABLE_KEY, String(versionCode));
    else if (!available) storageRemove(localStorage, UPDATE_AVAILABLE_KEY);
  }

  function restoreSettingsUpdateAvailability() {
    const cachedVersionCode = storageGet(localStorage, UPDATE_AVAILABLE_KEY);
    setSettingsUpdateAvailable(!!cachedVersionCode, cachedVersionCode || '');
  }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('update-check-timeout')), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  async function getInstalledAppInfo(plugin) {
    const validInfo = (value) => {
      const versionCode = Number(value?.versionCode);
      const versionName = String(value?.versionName || '').trim();
      return Number.isSafeInteger(versionCode) && versionCode > 0 && versionName
        ? { versionCode, versionName }
        : null;
    };

    // On Android, package metadata is the source of truth and is available
    // offline. Do not make the screen wait for a WebView asset/network read.
    if (plugin?.getAppInfo) {
      try {
        const nativeInfo = validInfo(await withTimeout(plugin.getAppInfo(), 1800));
        if (nativeInfo) return nativeInfo;
      } catch (_) {}
    }

    const bundledInfo = validInfo(window.AlAshrafBundledVersion);
    if (bundledInfo) return bundledInfo;

    try {
      const response = await withTimeout(fetch('./app-version.json?ts=' + Date.now(), { cache: 'no-store' }), 1500);
      if (response.ok) {
        const info = validInfo(await response.json());
        if (info) return info;
      }
    } catch (_) {}
    return validInfo(window.AlAshrafBundledVersion);
  }

  function showPendingUpdateDialog() {
    if (pendingDialogTimer) {
      clearTimeout(pendingDialogTimer);
      pendingDialogTimer = null;
    }
    if (!currentUpdate || ['downloading', 'ready'].includes(state) || updateDialog?.isConnected || document.visibilityState !== 'visible') return;
    // انتظر اختفاء شاشة البداية كيلا يظهر تنبيه التحديث فوقها.
    if (document.querySelector('#splash')) {
      pendingDialogTimer = setTimeout(showPendingUpdateDialog, 350);
      return;
    }
    renderDialog(currentUpdate.manifest, isForced);
  }

  async function readJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await withTimeout(fetch(url, { cache: 'no-store', redirect: 'error', signal: controller.signal }), 5500);
      if (!response.ok) throw new Error('manifest-unavailable');
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function setProgress(percent, label) {
    if (!updateDialog) return;
    const bar = updateDialog.querySelector('.apk-update-progress-fill');
    const labelEl = updateDialog.querySelector('.apk-update-progress-label');
    const wrap = updateDialog.querySelector('.apk-update-progress');
    if (wrap) wrap.hidden = false;
    if (bar && percent >= 0) bar.style.width = `${Math.min(100, percent)}%`;
    if (labelEl) labelEl.textContent = label || (percent >= 0 ? `${Math.round(percent)}%` : uiText('update.dialog_downloading', 'Downloading and verifying the update…'));
  }

  function setStatus(message, isError) {
    if (!updateDialog) return;
    const el = updateDialog.querySelector('.apk-update-status');
    if (el) {
      el.textContent = message || '';
      el.classList.toggle('is-error', !!isError);
      el.hidden = !message;
    }
  }

  function showBackgroundReadyToast(message, actionText, onAction) {
    document.querySelector('.apk-update-ready-toast')?.remove();
    if (backgroundReadyToastTimer) clearTimeout(backgroundReadyToastTimer);
    const toast = document.createElement('div');
    toast.className = 'apk-update-ready-toast';
    toast.setAttribute('role', 'status');
    const copy = document.createElement('span');
    copy.textContent = message;
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = actionText;
    action.addEventListener('click', () => {
      toast.remove();
      if (backgroundReadyToastTimer) clearTimeout(backgroundReadyToastTimer);
      onAction();
    });
    toast.append(copy, action);
    document.body.appendChild(toast);
    backgroundReadyToastTimer = setTimeout(() => toast.remove(), 12000);
  }

  function renderDialog(manifest, forced) {
    if (apkReady && apkReadyVersionCode !== manifest.versionCode) {
      apkReady = false;
      apkReadyVersionCode = 0;
    }
    const existing = updateDialog;
    if (existing) existing.remove();
    isForced = forced;
    updateDialog = document.createElement('div');
    updateDialog.className = 'apk-update-backdrop';
    updateDialog.setAttribute('role', 'presentation');

    const dialog = document.createElement('section');
    dialog.className = 'apk-update-dialog';
    dialog.dataset.state = state;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'apk-update-title');
    dialog.dir = 'rtl';
    const downloading = state === 'downloading';
    const ready = state === 'ready';

    const mark = document.createElement('div');
    mark.className = 'apk-update-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '↻';
    dialog.appendChild(mark);

    const title = document.createElement('h2');
    title.id = 'apk-update-title';
    title.textContent = downloading ? uiText('update.downloading_title', 'جارٍ تنزيل التحديث') : ready ? uiText('update.download_ready_title', 'التحديث جاهز للتثبيت') : uiText(forced ? 'update.title' : 'update.available_title', forced ? 'تحديث التطبيق مطلوب' : 'A new version is available');
    dialog.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'apk-update-intro';
    intro.textContent = downloading ? uiText('update.downloading_message', 'يتم تنزيل التحديث والتحقق منه. يمكنك إخفاء هذه النافذة وسيستمر التنزيل.') : ready ? uiText('update.download_ready_message', 'تم تنزيل التحديث والتحقق منه بنجاح. أصبح جاهزًا للتثبيت.') : uiText(forced ? 'update.subtitle' : 'update.available_message', forced
      ? 'حدّث التطبيق للمتابعة.'
      : 'A newer version of Al-Ashraf is available.');
    dialog.appendChild(intro);

    const version = document.createElement('div');
    version.className = 'apk-update-version';
    const currentVersion = document.createElement('span');
    currentVersion.textContent = `${uiText('update.current_version', 'Current version')}: ${installedVersionName || '—'}`;
    const newVersion = document.createElement('span');
    newVersion.textContent = `${uiText('update.new_version', 'New version')}: ${manifest.versionName}`;
    version.append(currentVersion, newVersion);
    dialog.appendChild(version);

    const language = window.appI18n?.getSavedLang?.() || 'ar';
    const localizedNotes = manifest.localizedReleaseNotes || (!Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : null);
    const releaseNotes = localizedNotes
      ? (localizedNotes[language] || localizedNotes.en || [])
      : (language === 'ar' ? (manifest.releaseNotes || []) : []);
    if (!downloading && !ready && releaseNotes.length) {
      const notesTitle = document.createElement('h3');
      notesTitle.className = 'apk-update-notes-title';
      const titleByLanguage = { ar: 'ما الجديد؟', fa: 'چه چیز تازه‌ای؟', en: 'What’s new?', fr: 'Nouveautés', tr: 'Yenilikler', ur: 'نیا کیا ہے؟', id: 'Apa yang baru?', ru: 'Что нового?', es: 'Novedades' };
      notesTitle.textContent = uiText('update.whats_new', titleByLanguage[language] || 'What’s new?');
      dialog.appendChild(notesTitle);
      const notes = document.createElement('ul');
      notes.className = 'apk-update-notes';
      releaseNotes.forEach((note) => {
        const item = document.createElement('li');
        item.textContent = note;
        notes.appendChild(item);
      });
      dialog.appendChild(notes);
    }

    const progress = document.createElement('div');
    progress.className = 'apk-update-progress';
    progress.hidden = !downloading && !ready;
    const track = document.createElement('div');
    track.className = 'apk-update-progress-track';
    const fill = document.createElement('div');
    fill.className = 'apk-update-progress-fill';
    track.appendChild(fill);
    const progressLabel = document.createElement('span');
    progressLabel.className = 'apk-update-progress-label';
    progress.append(track, progressLabel);
    dialog.appendChild(progress);

    const status = document.createElement('p');
    status.className = 'apk-update-status';
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    dialog.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'apk-update-actions';
    const install = document.createElement('button');
    install.type = 'button';
    install.className = 'apk-update-install';
    if (downloading) {
      install.textContent = uiText('update.cancel_download', 'إلغاء التنزيل');
      install.classList.add('apk-update-cancel');
      install.addEventListener('click', async () => {
        install.disabled = true;
        setStatus(uiText('update.cancelling_download', 'جارٍ إلغاء التنزيل…'), false);
        await cancelDownload();
      });
      actions.appendChild(install);
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'apk-update-later';
      hide.textContent = uiText('update.hide_continue', 'إخفاء ومتابعة التنزيل');
      hide.addEventListener('click', hideDownloadManager);
      actions.appendChild(hide);
    } else {
      install.textContent = ready ? uiText('update.install_now', 'التثبيت الآن') : uiText('update.download_button', 'تنزيل التحديث');
      install.addEventListener('click', () => handleInstallClick());
      actions.appendChild(install);
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'apk-update-later';
      later.textContent = uiText('update.later_button', 'لاحقًا');
      later.addEventListener('click', ready ? hideDownloadManager : dismissOptionalUpdate);
      actions.appendChild(later);
      if (!ready) {
        const background = document.createElement('button');
        background.type = 'button';
        background.className = 'apk-update-background';
        background.textContent = uiText('update.download_background', language === 'ar' ? 'التنزيل في الخلفية' : 'Download in background');
        background.addEventListener('click', () => handleInstallClick({ runInBackground: true }));
        actions.appendChild(background);
      }
    }
    dialog.appendChild(actions);
    updateDialog.appendChild(dialog);
    document.body.appendChild(updateDialog);
    if (downloading) setProgress(-1, uiText('update.dialog_downloading', 'جارٍ تنزيل التحديث والتحقق منه…'));
    else if (ready) setProgress(100, uiText('update.download_complete', 'اكتمل التنزيل والتحقق'));
    install.focus({ preventScroll: true });
  }

  function hideDownloadManager() {
    updateDialog?.remove();
    updateDialog = null;
  }

  function dismissOptionalUpdate() {
    if (!updateDialog) return;
    const lastCheck = Number(storageGet(localStorage, LAST_CHECK_KEY) || Date.now());
    storageSet(localStorage, LATER_KEY, String(Math.min(Date.now() + CHECK_INTERVAL, lastCheck + CHECK_INTERVAL - 5000)));
    updateDialog.remove();
    updateDialog = null;
    currentUpdate = null;
    apkReady = false;
    apkReadyVersionCode = 0;
    state = 'idle';
  }

  function errorMessage(error) {
    const code = error?.code || '';
    if (code === 'DOWNLOAD_CANCELLED') return uiText('update.dialog_cancelled', 'Download cancelled. You can try again.');
    if (code === 'INSUFFICIENT_STORAGE') return uiText('update.dialog_storage', 'There is not enough space to download the update.');
    if (code === 'APK_HASH_MISMATCH' || code === 'APK_SIGNER_MISMATCH' || code === 'APK_INVALID') return uiText('update.dialog_verify', 'The update file could not be verified and will not be installed.');
    if (code === 'INSTALL_PERMISSION_DENIED' || code === 'INSTALL_PERMISSION_REQUIRED' || code === 'INSTALL_SETTINGS_UNAVAILABLE') return uiText('update.dialog_error', 'Allow app installs from this source in Android settings, then try again.');
    return uiText('update.dialog_error', 'The update could not be completed. Check your connection and try again.');
  }

  async function handleInstallClick(options = {}) {
    const runInBackground = options?.runInBackground === true;
    const plugin = getPlugin();
    if (!plugin || !currentUpdate || state === 'downloading') return;
    if (apkReadyVersionCode !== currentUpdate.manifest.versionCode) apkReady = false;
    state = 'downloading';
    if (runInBackground) hideDownloadManager();
    else renderDialog(currentUpdate.manifest, isForced);
    const button = updateDialog?.querySelector('.apk-update-install');
    setStatus(uiText('update.dialog_downloading', 'Downloading and verifying the update…'), false);
    try {
      if (!apkReady && plugin.addListener) {
        progressListener = await plugin.addListener('downloadProgress', (event) => {
          const percent = Number.isFinite(event?.percent) ? event.percent : -1;
          setProgress(percent, percent >= 0 ? `${Math.round(percent)}٪` : 'جارٍ تنزيل التحديث…');
        });
      }
      if (!apkReady) {
        if (runInBackground) {
          try {
            const service = await plugin.startBackgroundDownload({ versionName: currentUpdate.manifest.versionName });
            if (service?.started !== true) throw new Error('background-service-not-started');
          } catch (serviceError) {
            console.warn('Background update service unavailable; continuing with an in-app download.', serviceError);
            renderDialog(currentUpdate.manifest, isForced);
            setStatus('تعذر تشغيل خدمة الخلفية؛ سيستمر التنزيل ما دام التطبيق مفتوحًا.', true);
          }
        }
        const downloadPromise = plugin.downloadAndVerify({
          downloadUrl: currentUpdate.manifest.downloadUrl,
          sha256: currentUpdate.manifest.sha256,
          ownerRepo: currentUpdate.ownerRepo,
          tagName: currentUpdate.manifest.tagName,
          versionCode: currentUpdate.manifest.versionCode,
          versionName: currentUpdate.manifest.versionName
        });
        await downloadPromise;
        apkReady = true;
        apkReadyVersionCode = currentUpdate.manifest.versionCode;
        if (progressListener?.remove) await progressListener.remove();
        progressListener = null;
      }
      if (runInBackground) {
        state = 'ready';
        showBackgroundReadyToast(
          uiText('update.download_ready', 'اكتمل تنزيل التحديث وأصبح جاهزًا للتثبيت.'),
          uiText('update.install_now', 'التثبيت الآن'),
          () => {
            renderDialog(currentUpdate.manifest, isForced);
            handleInstallClick();
          }
        );
        return;
      }
      state = 'installing';
      if (button) { button.textContent = uiText('update.installing_message', 'Opening the installer…'); button.disabled = true; }
      setProgress(100, 'اكتمل التنزيل');
      setStatus('تم التحقق من الملف. جارٍ فتح مثبت Android…', false);

      const permission = await plugin.getInstallPermissionState();
      if (!permission?.allowed) {
        setStatus('اسمح للتطبيق بتثبيت التطبيقات من هذا المصدر عند ظهور إعدادات Android.', false);
        await plugin.requestInstallPermission();
      }
      await plugin.installDownloadedApk();
      setStatus('اتبع خطوات التثبيت التي يعرضها Android.', false);
      state = 'installer-open';
    } catch (error) {
      if (progressListener?.remove) await progressListener.remove();
      progressListener = null;
      state = 'idle';
      if (currentUpdate) renderDialog(currentUpdate.manifest, isForced);
      setStatus(errorMessage(error), true);
      if (error?.code === 'DOWNLOAD_CANCELLED') {
        apkReady = false;
        const wrap = updateDialog?.querySelector('.apk-update-progress');
        if (wrap) wrap.hidden = true;
      }
      if (['APK_HASH_MISMATCH', 'APK_SIGNER_MISMATCH', 'APK_INVALID', 'APK_VERSION_INVALID'].includes(error?.code)) {
        apkReady = false;
        apkReadyVersionCode = 0;
      }
    }
  }

  async function cancelDownload() {
    const plugin = getPlugin();
    if (!plugin) return;
    try { await plugin.cancelDownload(); } catch (_) {}
  }

  async function checkForUpdate(forceNetwork, showDialog, ignoreCheckInterval = false) {
    if (!Core) return { status: 'error' };
    if (checking && activeCheckPromise) {
      return withTimeout(activeCheckPromise, 11000).catch(() => ({ status: 'error' }));
    }
    const cap = window.Capacitor;
    const plugin = getPlugin();
    if (!cap || cap.getPlatform?.() !== 'android' || !plugin) return { status: 'unsupported' };
    const now = Date.now();
    const last = Number(storageGet(localStorage, LAST_CHECK_KEY) || 0);
    if (!forceNetwork && !ignoreCheckInterval && last > 0 && now - last < CHECK_INTERVAL) {
      return { status: 'skipped' };
    }
    checking = true;
    const operation = (async () => {
      try {
        const configResponse = await withTimeout(fetch('./update-config.json?ts=' + Date.now(), { cache: 'no-store' }), 3000);
        if (!configResponse.ok) return { status: 'error' };
        const config = await configResponse.json();
        const parsedUrl = Core.parseManifestUrl(config?.manifestUrl);
        if (!parsedUrl) return { status: 'error' };
        const manifest = await readJson(config.manifestUrl);
        if (!Core.isValidManifest(manifest, parsedUrl.ownerRepo)) return { status: 'error' };
        const installed = await getInstalledAppInfo(plugin);
        const installedVersionCode = Number(installed?.versionCode);
        installedVersionName = String(installed?.versionName || window.AlAshrafBundledVersion?.versionName || '');
        if (!Number.isSafeInteger(installedVersionCode) || installedVersionCode < 1) return { status: 'error', currentVersion: installedVersionName };
        const decision = Core.getUpdateDecision(installedVersionCode, manifest, parsedUrl.ownerRepo);
        storageSet(localStorage, LAST_CHECK_KEY, String(Date.now()));

        if (!decision.available) {
          currentUpdate = null;
          setSettingsUpdateAvailable(false);
          storageRemove(localStorage, LATER_KEY);
          if (isForced && updateDialog) {
            updateDialog.remove();
            updateDialog = null;
            isForced = false;
            state = 'idle';
          }
          return { status: 'latest', currentVersion: installedVersionName };
        }
        const laterUntil = Number(storageGet(localStorage, LATER_KEY) || 0);
        if (laterUntil > Date.now() && !forceNetwork) return { status: 'snoozed', currentVersion: installedVersionName };
        currentUpdate = { manifest, ownerRepo: parsedUrl.ownerRepo };
        setSettingsUpdateAvailable(true, manifest.versionCode);
        isForced = decision.forced;
        if (showDialog !== false) showPendingUpdateDialog();
        return { status: 'available', manifest, currentVersion: installedVersionName };
      } catch (_) {
        // Keep the user informed when a bounded network request fails.
        return { status: 'error', currentVersion: installedVersionName };
      }
    })();
    activeCheckPromise = operation;
    try {
      return await operation;
    } finally {
      if (activeCheckPromise === operation) activeCheckPromise = null;
      checking = false;
    }
  }

  window.AlAshrafApkUpdater = {
    getInstalledVersion: async () => {
      const plugin = getPlugin();
      if (!window.Capacitor || window.Capacitor.getPlatform?.() !== 'android') return '';
      try {
        const installed = await getInstalledAppInfo(plugin);
        installedVersionName = String(installed?.versionName || window.AlAshrafBundledVersion?.versionName || '');
        return installedVersionName;
      } catch (_) {
        return '';
      }
    },
    checkNow: async () => {
      if (checking && activeCheckPromise) {
        const currentResult = await withTimeout(activeCheckPromise, 11000).catch(() => ({ status: 'error' }));
        if (currentResult.status !== 'skipped') return currentResult;
      }
      return checkForUpdate(true, false);
    },
    downloadUpdate: async () => {
      if (!currentUpdate) return false;
      renderDialog(currentUpdate.manifest, isForced);
      await handleInstallClick();
      return true;
    }
  };

  // صفحة معلومات الإصدار لها متحكم واحد مستقل. تعرض رقم نسخة Android أولًا،
  // ثم تبدأ الفحص عند فتح الصفحة، وكل طلب شبكة له حد زمني صريح.
  function initUpdateInfoPage() {
    const overlay = document.getElementById('update-check-overlay');
    const card = document.getElementById('update-check-status-card');
    const title = document.getElementById('update-check-status-title');
    const message = document.getElementById('update-check-status-message');
    const currentVersion = document.getElementById('update-check-current-version');
    const newVersionBlock = document.getElementById('update-check-new-version-block');
    const newVersion = document.getElementById('update-check-new-version');
    const action = document.getElementById('btn-update-check-action');
    if (!overlay || !card || !title || !message || !currentVersion || !action) return;

    let requestId = 0;
    let viewState = 'idle';
    let currentName = String(window.AlAshrafBundledVersion?.versionName || '');
    currentVersion.textContent = currentName || '—';

    const render = (nextState, overrides = {}) => {
      viewState = nextState;
      card.dataset.state = nextState;
      const titleKey = `update.${nextState}_title`;
      const messageKey = `update.${nextState}_message`;
      const titleFallbacks = {
        idle: 'التحقق من التحديثات', checking: 'جارٍ التحقق', available: 'يتوفر تحديث جديد',
        latest: 'تم تثبيت أحدث إصدار', error: 'تعذر التحقق من التحديث',
        unsupported: 'التحديث غير متاح هنا', installing: 'جارٍ تجهيز التحديث'
      };
      const messageFallbacks = {
        idle: 'يتم التحقق من أحدث إصدار للتطبيق.', checking: 'لحظات ونتأكد من أحدث إصدار.',
        available: 'يوجد إصدار أحدث جاهز للتنزيل.', latest: 'لا يتوفر إصدار جديد، أنت الآن على أحدث إصدار.',
        error: 'تعذر الاتصال بخدمة التحديث. تحقق من الإنترنت ثم أعد المحاولة.',
        unsupported: 'يمكن فحص التحديثات من تطبيق Android المثبت.',
        installing: 'سيبدأ تنزيل التحديث والتحقق منه الآن.'
      };
      title.textContent = overrides.title || uiText(titleKey, titleFallbacks[nextState] || titleFallbacks.error);
      message.textContent = overrides.message || uiText(messageKey, messageFallbacks[nextState] || messageFallbacks.error);
      if (overrides.current) currentName = overrides.current;
      currentVersion.textContent = currentName || '—';
      if (newVersionBlock) newVersionBlock.classList.toggle('hidden', nextState !== 'available');
      if (newVersion && overrides.latest) newVersion.textContent = overrides.latest;
      action.classList.toggle('hidden', ['checking', 'latest', 'unsupported', 'installing'].includes(nextState));
      action.disabled = nextState === 'checking' || nextState === 'installing';
      action.dataset.action = nextState === 'available' ? 'install' : 'check';
      const actionKey = nextState === 'available' ? 'update.download_button' : nextState === 'idle' ? 'update.check_button' : 'update.check_again';
      action.textContent = uiText(actionKey, nextState === 'available' ? 'تنزيل التحديث' : 'تحقق مرة أخرى');
    };

    render('idle');
    const check = async () => {
      const id = ++requestId;
      const bundled = String(window.AlAshrafBundledVersion?.versionName || '');
      currentName = currentName || bundled;
      render('checking');
      const updater = window.AlAshrafApkUpdater;
      if (!updater?.checkNow) {
        render('unsupported');
        return;
      }
      try {
        const installedName = await withTimeout(updater.getInstalledVersion(), 2000).catch(() => '');
        if (id !== requestId) return;
        currentName = String(installedName || bundled || currentName || '');
        currentVersion.textContent = currentName || '—';
        const result = await withTimeout(updater.checkNow(), 11500).catch(() => ({ status: 'error' }));
        if (id !== requestId) return;
        const resolvedName = String(result?.currentVersion || currentName || bundled || '');
        if (result?.status === 'available') {
          render('available', { current: resolvedName, latest: result.manifest?.versionName || '' });
        } else if (result?.status === 'latest') {
          render('latest', { current: resolvedName });
        } else if (result?.status === 'unsupported') {
          render('unsupported', { current: resolvedName });
        } else {
          render('error', { current: resolvedName });
        }
      } catch (_) {
        if (id === requestId) render('error');
      }
    };

    window.addEventListener('alashraf:update-screen-open', check);
    window.addEventListener('alashraf:update-screen-close', () => { requestId += 1; });
    const openReadyUpdateFromNotification = async () => {
      window.__ashrafUpdateReadyPending = false;
      if (!currentUpdate) {
        const result = await window.AlAshrafApkUpdater?.checkNow?.();
        if (result?.status === 'available') {
          const parts = new URL(result.manifest.downloadUrl).pathname.split('/').filter(Boolean);
          currentUpdate = { manifest: result.manifest, ownerRepo: `${parts[0]}/${parts[1]}` };
        }
      }
      if (currentUpdate) renderDialog(currentUpdate.manifest, isForced);
    };
    window.addEventListener('alashraf:update-download-notification-tap', openReadyUpdateFromNotification);
    if (window.__ashrafUpdateReadyPending) openReadyUpdateFromNotification();
    window.appI18n?.onLanguageChange?.(() => render(viewState));
    action.addEventListener('click', async () => {
      if (action.dataset.action !== 'install') {
        check();
        return;
      }
      const id = ++requestId;
      render('installing');
      try {
        const installed = await withTimeout(window.AlAshrafApkUpdater?.downloadUpdate?.(), 180000).catch(() => false);
        if (id === requestId && !installed) render('error');
      } catch (_) {
        if (id === requestId) render('error');
      }
    });
  }

  function start() {
    if (!Core) return;
    restoreSettingsUpdateAvailability();
    initUpdateInfoPage();
    const postponedUntil = Number(storageGet(localStorage, LATER_KEY) || 0);
    if (postponedUntil - Date.now() > CHECK_INTERVAL) storageRemove(localStorage, LATER_KEY);
    const checkIfDue = () => checkForUpdate(false);
    setTimeout(() => checkForUpdate(false, true, true), 3500);
    setInterval(checkIfDue, CHECK_INTERVAL);
    window.addEventListener('app:tab-changed', () => setTimeout(showPendingUpdateDialog, 420));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkForUpdate(false);
      showPendingUpdateDialog();
    });
    document.addEventListener('keydown', (event) => {
      if (updateDialog && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
