/**
 * CourseCraft - Popup Controller
 * Manages UI events, live diagnostics log streaming,
 * and user ID configuration.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initMarathonBanner();
  initTheme();
  initStatus();
  initUserIdEditor();
  initLogsDrawer();
  initActionHandlers();
  initSettingsRoute();
});

// Theme Management
function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');
  chrome.storage.sync.get('theme', (data) => {
    const currentTheme = data.theme || 'dark';
    applyTheme(currentTheme);
  });

  toggleBtn?.addEventListener('click', () => {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'light' : 'dark';
    applyTheme(newTheme);
    chrome.storage.sync.set({ theme: newTheme });
  });
}

function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
  const icon = document.getElementById('themeIcon');
  if (icon) {
    if (theme === 'light') {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />';
    }
  }
}

// User ID Editor
function initUserIdEditor() {
  const editBtn = document.getElementById('editUserIdBtn');
  const editBox = document.getElementById('editUserIdBox');
  const input = document.getElementById('manualUserIdInput');
  const saveBtn = document.getElementById('saveManualUserIdBtn');
  const display = document.getElementById('userIdDisplay');

  // Load current saved ID and email
  chrome.storage.local.get(['customUserId', 'cachedUserId', 'cachedUserEmail', 'cachedUserName'], (data) => {
    const activeId = data.customUserId || data.cachedUserId || '161276145';
    if (display) display.textContent = activeId;
    if (input) input.value = activeId;
    if (userNameDisplay) {
      userNameDisplay.textContent = data.cachedUserEmail || data.cachedUserName || 'learner@coursera.org';
    }
  });

  editBtn?.addEventListener('click', () => {
    editBox?.classList.toggle('hidden');
    if (!editBox?.classList.contains('hidden')) {
      input?.focus();
      input?.select();
    }
  });

  saveBtn?.addEventListener('click', () => {
    const newId = input?.value?.trim();
    if (!newId || isNaN(Number(newId))) {
      showToast('Please enter a valid numeric User ID', true);
      return;
    }

    chrome.storage.local.set({ customUserId: newId, cachedUserId: newId }, () => {
      if (display) display.textContent = newId;
      editBox?.classList.add('hidden');
      showToast(`User ID saved: ${newId}`);

      // Forward to active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'SET_USER_ID', userId: newId }).catch(() => {});
        }
      });
    });
  });
}

// Live Logs Drawer
function initLogsDrawer() {
  const toggleBtn = document.getElementById('toggleLogsBtn');
  const container = document.getElementById('logsContainer');
  const arrow = document.getElementById('logsToggleArrow');
  const consoleEl = document.getElementById('logsConsole');
  const copyBtn = document.getElementById('copyLogsBtn');
  const clearBtn = document.getElementById('clearLogsBtn');

  toggleBtn?.addEventListener('click', (e) => {
    if (e.target === copyBtn || e.target === clearBtn) return;
    container?.classList.toggle('hidden');
    if (arrow) arrow.textContent = container?.classList.contains('hidden') ? '▼' : '▲';
    renderLogs();
  });

  copyBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.storage.local.get('liveLogs', (data) => {
      const logs = data.liveLogs || [];
      const text = logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        showToast('Logs copied to clipboard!');
      });
    });
  });

  clearBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.storage.local.set({ liveLogs: [] }, () => {
      if (consoleEl) consoleEl.innerHTML = '<div class="log-line log-info">Logs cleared.</div>';
    });
  });

  function renderLogs() {
    chrome.storage.local.get('liveLogs', (data) => {
      const logs = data.liveLogs || [];
      if (!consoleEl) return;
      if (logs.length === 0) {
        consoleEl.innerHTML = '<div class="log-line log-info">No logs recorded yet.</div>';
        return;
      }
      consoleEl.innerHTML = logs.map(l => {
        return `<div class="log-line log-${l.type}">[${l.time}] ${l.msg}</div>`;
      }).join('');
      consoleEl.scrollTop = consoleEl.scrollHeight;
    });
  }

  // Poll logs periodically while popup is open
  setInterval(renderLogs, 1000);
}

// Check Tab & Coursera Status
function initStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const titleEl = document.getElementById('courseStatusTitle');
    const subtitleEl = document.getElementById('courseStatusSubtitle');
    const userDisplay = document.getElementById('userIdDisplay');
    const userNameDisplay = document.getElementById('userNameDisplay');

    if (!activeTab || !activeTab.url || !activeTab.url.includes('coursera.org')) {
      if (titleEl) titleEl.textContent = 'Not on Coursera';
      if (subtitleEl) subtitleEl.textContent = 'Navigate to Coursera to use actions';
      return;
    }

    // Extract course slug from URL
    const slugMatch = activeTab.url.match(/\/learn\/([^\/]+)/);
    const courseSlug = slugMatch ? slugMatch[1].replace(/-/g, ' ').toUpperCase() : 'Coursera Workspace';
    
    if (titleEl) titleEl.textContent = courseSlug;
    if (subtitleEl) subtitleEl.textContent = 'Connecting...';

    // Query content script for metadata
    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_COURSE_INFO' }, (res) => {
      if (chrome.runtime.lastError) {
        if (subtitleEl) {
          subtitleEl.innerHTML = 'Script standby – <span id="reloadTabLink" style="color:var(--primary);cursor:pointer;text-decoration:underline;">Click to refresh tab</span>';
          document.getElementById('reloadTabLink')?.addEventListener('click', () => {
            chrome.tabs.reload(activeTab.id);
            window.close();
          });
        }
        return;
      }

      if (res) {
        if (res.courseName && titleEl) titleEl.textContent = res.courseName;
        if (subtitleEl) subtitleEl.textContent = res.itemCount ? `${res.itemCount} course items ready` : 'Ready for automation';
        if (res.userId && userDisplay) userDisplay.textContent = res.userId;
        if ((res.userEmail || res.userName) && userNameDisplay) {
          userNameDisplay.textContent = res.userEmail || res.userName;
        }
      }
    });
  });
}

// Action Button Dispatcher
function initActionHandlers() {
  const actionButtons = document.querySelectorAll('.action-card');
  actionButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const actionName = btn.getAttribute('data-action');
      if (!actionName) return;

      const title = btn.querySelector('.card-title')?.textContent || actionName;
      showToast(`Triggering ${title}...`);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab?.id) {
          showToast('Error: No active tab found', true);
          return;
        }

        if (!activeTab.url || !activeTab.url.includes('coursera.org')) {
          showToast('Please open a Coursera course page first', true);
          return;
        }

        chrome.tabs.sendMessage(activeTab.id, { action: actionName }, (res) => {
          if (chrome.runtime.lastError) {
            showToast('Coursera tab needs a refresh. Reloading tab...', true);
            setTimeout(() => {
              chrome.tabs.reload(activeTab.id);
              window.close();
            }, 800);
          } else {
            showToast(`${title} started! Check logs below.`);
            // Auto open logs drawer on trigger
            const container = document.getElementById('logsContainer');
            container?.classList.remove('hidden');
          }
        });
      });
    });
  });
}

// Open Settings
function initSettingsRoute() {
  const settingsBtn = document.getElementById('settingsBtn');
  settingsBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// Toast helper
let toastTimeout;
function showToast(msg, isError = false) {
  const toast = document.getElementById('statusToast');
  const msgEl = document.getElementById('toastMessage');
  if (!toast || !msgEl) return;

  msgEl.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.borderColor = isError ? 'var(--warning)' : 'var(--border-focus)';

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

function initMarathonBanner() {
  // Marathon Mode Banner Poller
  const marathonBanner = document.getElementById('marathonBanner');
  const stopMarathonBtn = document.getElementById('stopMarathonBtn');

  function checkMarathonStatus() {
    chrome.storage.local.get(['marathonActive', 'marathonCount', 'marathonTotal'], (data) => {
      if (data?.marathonActive) {
        marathonBanner?.classList.remove('hidden');
        const sub = document.getElementById('marathonSubtitle');
        if (sub) {
          sub.textContent = data.marathonTotal 
            ? `Auto-advancing at 16x speed (${data.marathonCount || 0}/${data.marathonTotal} lectures)` 
            : 'Auto-advancing at 16x speed';
        }
      } else {
        marathonBanner?.classList.add('hidden');
      }
    });
  }

  stopMarathonBtn?.addEventListener('click', () => {
    chrome.storage.local.set({ marathonActive: false }, () => {
      marathonBanner?.classList.add('hidden');
      showToast('Video Marathon stopped.');
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'stopmarathon' }).catch(() => {});
        }
      });
    });
  });

  setInterval(checkMarathonStatus, 1200);
  checkMarathonStatus();
}
