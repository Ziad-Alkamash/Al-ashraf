(function () {
  'use strict';

  const Core = window.AlAshrafUpdateCore;
  const LAST_CHECK_KEY = 'alashraf:apk-update:last-check';
  const LATER_KEY = 'alashraf:apk-update:later-until';
  const CHECK_INTERVAL = 60 * 60 * 1000;
  const RESUME_INTERVAL = 5 * 60 * 1000;
  let updateDialog = null;
  let currentUpdate = null;
  let installedVersionName = '';
  let isForced = false;
  let checking = false;
  let lastCheckAt = 0;
  let progressListener = null;
  let state = 'idle';
  let apkReady = false;
  let apkReadyVersionCode = 0;
  let homeReady = false;
  let pendingDialogTimer = null;

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

  function showPendingUpdateDialog() {
    if (pendingDialogTimer) {
      clearTimeout(pendingDialogTimer);
      pendingDialogTimer = null;
    }
    if (!homeReady || !currentUpdate || updateDialog?.isConnected || document.visibilityState !== 'visible') return;
    // انتظر اختفاء شاشة البداية كيلا يظهر تنبيه التحديث فوقها.
    if (document.querySelector('#splash')) {
      pendingDialogTimer = setTimeout(showPendingUpdateDialog, 350);
      return;
    }
    renderDialog(currentUpdate.manifest, isForced);
  }

  async function readJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: controller.signal });
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
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'apk-update-title');
    dialog.dir = 'rtl';

    const mark = document.createElement('div');
    mark.className = 'apk-update-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '↻';
    dialog.appendChild(mark);

    const title = document.createElement('h2');
    title.id = 'apk-update-title';
    title.textContent = uiText(forced ? 'update.title' : 'update.available_title', forced ? 'تحديث التطبيق مطلوب' : 'A new version is available');
    dialog.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'apk-update-intro';
    intro.textContent = uiText(forced ? 'update.subtitle' : 'update.available_message', forced
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
    if (manifest.releaseNotes.length && language === 'ar') {
      const notesTitle = document.createElement('h3');
      notesTitle.className = 'apk-update-notes-title';
      notesTitle.textContent = 'ما الجديد؟';
      dialog.appendChild(notesTitle);
      const notes = document.createElement('ul');
      notes.className = 'apk-update-notes';
      manifest.releaseNotes.forEach((note) => {
        const item = document.createElement('li');
        item.textContent = note;
        notes.appendChild(item);
      });
      dialog.appendChild(notes);
    }

    const progress = document.createElement('div');
    progress.className = 'apk-update-progress';
    progress.hidden = true;
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
    install.textContent = uiText('update.install_now', 'Install now');
    install.addEventListener('click', handleInstallClick);
    actions.appendChild(install);

    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'apk-update-later';
    later.textContent = uiText('update.later_button', 'Later');
    later.addEventListener('click', dismissOptionalUpdate);
    actions.appendChild(later);
    dialog.appendChild(actions);
    updateDialog.appendChild(dialog);
    document.body.appendChild(updateDialog);
    install.focus({ preventScroll: true });
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

  async function handleInstallClick() {
    const plugin = getPlugin();
    if (!plugin || !currentUpdate || state === 'downloading') return;
    if (apkReadyVersionCode !== currentUpdate.manifest.versionCode) apkReady = false;
    state = 'downloading';
    const button = updateDialog?.querySelector('.apk-update-install');
    const later = updateDialog?.querySelector('.apk-update-later');
    if (button) button.textContent = uiText('update.cancel_download', 'Cancel download');
    if (later) later.disabled = true;
    setStatus(uiText('update.dialog_downloading', 'Downloading and verifying the update…'), false);
    try {
      if (!apkReady && plugin.addListener) {
        progressListener = await plugin.addListener('downloadProgress', (event) => {
          const percent = Number.isFinite(event?.percent) ? event.percent : -1;
          setProgress(percent, percent >= 0 ? `${Math.round(percent)}٪` : 'جارٍ تنزيل التحديث…');
        });
      }
      if (!apkReady) {
        await plugin.downloadAndVerify({
          downloadUrl: currentUpdate.manifest.downloadUrl,
          sha256: currentUpdate.manifest.sha256,
          ownerRepo: currentUpdate.ownerRepo,
          tagName: currentUpdate.manifest.tagName,
          versionCode: currentUpdate.manifest.versionCode
        });
        apkReady = true;
        apkReadyVersionCode = currentUpdate.manifest.versionCode;
        if (progressListener?.remove) await progressListener.remove();
        progressListener = null;
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
      if (button && button.isConnected) { button.textContent = uiText('update.download_button', 'Download update'); button.disabled = false; }
      if (later && later.isConnected) later.disabled = false;
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

  async function checkForUpdate(forceNetwork, showDialog) {
    if (checking || !Core) return { status: 'error' };
    const cap = window.Capacitor;
    const plugin = getPlugin();
    if (!cap || cap.getPlatform?.() !== 'android' || !plugin) return { status: 'unsupported' };
    const now = Date.now();
    if (forceNetwork && now - lastCheckAt < RESUME_INTERVAL) {
      if (currentUpdate) return { status: 'available', manifest: currentUpdate.manifest, currentVersion: installedVersionName };
      return { status: 'error' };
    }
    const last = Number(storageGet(localStorage, LAST_CHECK_KEY) || 0);
    if (!forceNetwork && last > 0 && now - last < CHECK_INTERVAL) {
      return { status: 'skipped' };
    }
    checking = true;
    lastCheckAt = now;
    try {
      const configResponse = await fetch('./update-config.json', { cache: 'no-store' });
      if (!configResponse.ok) return { status: 'error' };
      const config = await configResponse.json();
      const parsedUrl = Core.parseManifestUrl(config?.manifestUrl);
      if (!parsedUrl) return { status: 'error' };
      const manifest = await readJson(config.manifestUrl);
      if (!Core.isValidManifest(manifest, parsedUrl.ownerRepo)) return { status: 'error' };
      const installed = await plugin.getAppInfo();
      const installedVersionCode = Number(installed?.versionCode);
      installedVersionName = String(installed?.versionName || '');
      const decision = Core.getUpdateDecision(installedVersionCode, manifest, parsedUrl.ownerRepo);
      storageSet(localStorage, LAST_CHECK_KEY, String(Date.now()));

      if (!decision.available) {
        currentUpdate = null;
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
      isForced = decision.forced;
      if (showDialog !== false) showPendingUpdateDialog();
      return { status: 'available', manifest, currentVersion: installedVersionName };
    } catch (_) {
      // Update checks are deliberately silent when GitHub or the network is unavailable.
      return { status: 'error' };
    } finally {
      checking = false;
    }
  }

  window.AlAshrafApkUpdater = {
    getInstalledVersion: async () => {
      const plugin = getPlugin();
      if (!window.Capacitor || window.Capacitor.getPlatform?.() !== 'android' || !plugin) return '';
      try {
        const installed = await plugin.getAppInfo();
        installedVersionName = String(installed?.versionName || '');
        return installedVersionName;
      } catch (_) {
        return '';
      }
    },
    checkNow: async () => {
      for (let attempt = 0; checking && attempt < 24; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (checking) return { status: 'error' };
      lastCheckAt = 0;
      return checkForUpdate(true, false);
    },
    downloadUpdate: async () => {
      if (!currentUpdate) return false;
      renderDialog(currentUpdate.manifest, isForced);
      await handleInstallClick();
      return true;
    }
  };

  function start() {
    if (!Core) return;
    const postponedUntil = Number(storageGet(localStorage, LATER_KEY) || 0);
    if (postponedUntil - Date.now() > CHECK_INTERVAL) storageRemove(localStorage, LATER_KEY);
    const checkIfDue = () => checkForUpdate(false);
    setTimeout(checkIfDue, 3500);
    setInterval(checkIfDue, CHECK_INTERVAL);
    window.addEventListener('app:tab-changed', (event) => {
      homeReady = event.detail?.tab === 'tools';
      if (homeReady) setTimeout(showPendingUpdateDialog, 420);
    });
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
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('.apk-update-install') && state === 'downloading') {
        event.preventDefault();
        cancelDownload();
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
