/**
 * CourseCraft - Background Service Worker
 * Version: 4.3.0
 * Handles background operations, authentic cookie resolution,
 * and extension routing.
 */

'use strict';

const COURSERA_API = 'https://www.coursera.org/api';
const DEFAULT_LOCKING_UA = 'coursera-locking-browser/0.6.6';

async function sendTabToast(tabId, message, type = 'info', keep = false) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'SHOW_TOAST',
      payload: { message, type, keep }
    });
  } catch (_) {}
}

async function getCookiesForCoursera() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: 'coursera.org' }, (cookies = []) => {
      chrome.cookies.getAll({ url: 'https://www.coursera.org' }, (urlCookies = []) => {
        const merged = [...cookies];
        for (const uc of urlCookies) {
          if (!merged.some(c => c.name === uc.name && c.domain === uc.domain)) {
            merged.push(uc);
          }
        }
        resolve(merged);
      });
    });
  });
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;
  const tabId = sender?.tab?.id;

  // 1. Get CSRF Token and User ID from cookies
  if (action === 'GET_CSRF_AND_USER') {
    getCookiesForCoursera().then((cookies) => {
      let csrfToken = null;
      let userId = null;

      for (const c of cookies) {
        const nameLower = c.name.toLowerCase();
        if (nameLower === 'csrf3-token') {
          csrfToken = c.value;
        }
        if (c.name === '__204u') {
          const m = c.value.match(/^(\d{6,})-/);
          if (m) userId = m[1];
        }
        if (c.name === 'coursera_user_id' || c.name === 'userId' || c.name === 'c_user') {
          if (c.value && !isNaN(Number(c.value)) && c.value.length >= 6) {
            userId = c.value;
          }
        }
      }
      sendResponse({ csrfToken, userId });
    });
    return true;
  }

  // 2. Open Options Page
  if (action === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }

  // 3. Open Popup
  if (action === 'OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  // 4. User-Agent Emulation
  if (action === 'COR_RPC_GET_UA') {
    sendResponse({ ua: DEFAULT_LOCKING_UA });
    return true;
  }

  return false;
});

// Forward URL change notifications
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('coursera.org')) {
    chrome.tabs.sendMessage(tabId, {
      message: 'urlChanged',
      url: tab.url
    }).catch(() => {});
  }
});

// Auto-cleanup stale marathon state when Coursera tabs are closed
chrome.tabs.onRemoved.addListener(() => {
  chrome.tabs.query({ url: '*://*.coursera.org/*' }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      chrome.storage.local.set({ marathonActive: false, marathonHeartbeat: 0, marathonCount: 0, marathonTotal: 0 });
    }
  });
});

// Reset marathon flags on startup and install
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ marathonActive: false, marathonHeartbeat: 0, marathonCount: 0, marathonTotal: 0 });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ marathonActive: false, marathonHeartbeat: 0, marathonCount: 0, marathonTotal: 0 });
});

