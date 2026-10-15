/**
 * CourseCraft - Settings Page Controller
 * Manages automation settings, course backup parameters, and free Gemini AI configuration.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initLanguages();
  loadAutomationSettings();
  loadBackupSettings();
  loadAiSettings();
  initBackupListener();
});

// Tab Navigation
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// Subtitle Languages for Course Backup
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'pl', name: 'Polish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'nl', name: 'Dutch' }
];

function initLanguages() {
  const select = document.getElementById('subtitle');
  if (!select) return;
  select.innerHTML = '';
  LANGUAGES.forEach((lang) => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = lang.name;
    select.appendChild(opt);
  });
  select.value = 'en';
}

// 1. Automation Settings
function loadAutomationSettings() {
  const autoQuiz = document.getElementById('autoQuizToggle');
  const autoSubmit = document.getElementById('autoSubmitQuizToggle');
  const speech = document.getElementById('speechToggle');
  const autoPopup = document.getElementById('autoPopupToggle');
  const saveBtn = document.getElementById('saveAutomationBtn');
  const statusEl = document.getElementById('automationStatus');

  chrome.storage.sync.get(['autoQuiz', 'autoSubmitQuiz', 'speechEnabled', 'autoPopup'], (data) => {
    if (autoQuiz) autoQuiz.checked = data.autoQuiz ?? true;
    if (autoSubmit) autoSubmit.checked = data.autoSubmitQuiz ?? false;
    if (speech) speech.checked = data.speechEnabled ?? false;
    if (autoPopup) autoPopup.checked = data.autoPopup ?? false;
  });

  saveBtn?.addEventListener('click', () => {
    chrome.storage.sync.set({
      autoQuiz: autoQuiz?.checked ?? true,
      autoSubmitQuiz: autoSubmit?.checked ?? false,
      speechEnabled: speech?.checked ?? false,
      autoPopup: autoPopup?.checked ?? false
    }, () => {
      showSaved(statusEl);
    });
  });
}

// 2. Course Backup Settings
function loadBackupSettings() {
  const concurrency = document.getElementById('concurrency');
  const quality = document.getElementById('quality');
  const subtitle = document.getElementById('subtitle');
  const saveBtn = document.getElementById('saveBackupBtn');
  const statusEl = document.getElementById('backupStatus');

  chrome.storage.sync.get(['concurrency', 'quality', 'subtitle'], (data) => {
    if (concurrency) concurrency.value = data.concurrency || 5;
    if (quality) quality.value = data.quality || '720p';
    if (subtitle) subtitle.value = data.subtitle || 'en';
  });

  saveBtn?.addEventListener('click', () => {
    const concurrencyVal = Math.min(Math.max(parseInt(concurrency?.value || '5', 10), 1), 10);
    chrome.storage.sync.set({
      concurrency: concurrencyVal,
      quality: quality?.value || '720p',
      subtitle: subtitle?.value || 'en'
    }, () => {
      showSaved(statusEl);
    });
  });
}

// 3. AI Quiz Assistant Settings
function loadAiSettings() {
  const keyInput = document.getElementById('geminiApiKey');
  const modelSelect = document.getElementById('geminiModel');
  const saveBtn = document.getElementById('saveAiBtn');
  const testBtn = document.getElementById('testAiBtn');
  const statusEl = document.getElementById('aiStatus');

  chrome.storage.local.get(['geminiApiKey', 'geminiModel'], (data) => {
    if (keyInput) keyInput.value = data.geminiApiKey || '';
    if (modelSelect) modelSelect.value = data.geminiModel || 'gemini-1.5-flash';
  });

  saveBtn?.addEventListener('click', () => {
    const key = keyInput?.value?.trim() || '';
    const model = modelSelect?.value || 'gemini-1.5-flash';
    chrome.storage.local.set({
      geminiApiKey: key,
      geminiModel: model
    }, () => {
      showSaved(statusEl, 'Settings Saved!');
    });
  });

  testBtn?.addEventListener('click', async () => {
    const key = keyInput?.value?.trim();
    if (!key) {
      if (statusEl) {
        statusEl.textContent = 'Please enter an API key first.';
        statusEl.style.color = 'var(--warning)';
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Testing connection...';
      statusEl.style.color = 'var(--text-muted)';
    }

    try {
      const model = modelSelect?.value || 'gemini-1.5-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with just "OK".' }] }]
        })
      });

      if (res.ok) {
        if (statusEl) {
          statusEl.textContent = 'Connection Successful! Gemini is ready.';
          statusEl.style.color = 'var(--success)';
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        if (statusEl) {
          statusEl.textContent = `API Error: ${errorData.error?.message || 'Invalid key'}`;
          statusEl.style.color = '#ef4444';
        }
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = `Network Error: ${err.message}`;
        statusEl.style.color = '#ef4444';
      }
    }
  });
}

// Live Backup Progress Listener
function initBackupListener() {
  const container = document.getElementById('backupProgressContainer');
  const textEl = document.getElementById('backupProgressText');
  const percentEl = document.getElementById('backupProgressPercent');
  const fillEl = document.getElementById('backupProgressFill');

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'backupProgress') {
      if (!container) return;
      container.classList.remove('hidden');
      if (textEl) textEl.textContent = request.message || 'Backing up course materials...';

      if (request.totalVideos && request.downloadedVideos !== undefined) {
        const pct = Math.min(Math.round((request.downloadedVideos / request.totalVideos) * 100), 100);
        if (percentEl) percentEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
      }

      if (request.message && request.message.includes('complete')) {
        setTimeout(() => {
          container.classList.add('hidden');
          if (fillEl) fillEl.style.width = '0%';
        }, 4000);
      }
    }
  });
}

function showSaved(el, msg = 'Saved successfully!') {
  if (!el) return;
  el.textContent = msg;
  el.style.color = 'var(--success)';
  setTimeout(() => { el.textContent = ''; }, 2500);
}
