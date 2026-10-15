/**
 * CourseCraft - Popup Controller
 * Handles user interactions, theme management, and commands to content script.
 */

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initStatus();
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

// Check if currently on Coursera tab
function initStatus() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const contextCard = document.getElementById('contextCard');
    const titleEl = document.getElementById('courseStatusTitle');
    const subtitleEl = document.getElementById('courseStatusSubtitle');

    if (!activeTab || !activeTab.url || !activeTab.url.includes('coursera.org')) {
      if (contextCard) contextCard.className = 'context-card status-waiting';
      if (titleEl) titleEl.textContent = 'Not on Coursera';
      if (subtitleEl) subtitleEl.textContent = 'Navigate to Coursera to use actions';
      return;
    }

    // Tab is on Coursera
    if (contextCard) contextCard.className = 'context-card status-active';
    
    // Extract course slug from URL
    const slugMatch = activeTab.url.match(/\/learn\/([^\/]+)/);
    const courseSlug = slugMatch ? slugMatch[1].replace(/-/g, ' ').toUpperCase() : 'Coursera Workspace';
    
    if (titleEl) titleEl.textContent = courseSlug;
    if (subtitleEl) subtitleEl.textContent = 'Connecting...';

    // Query content script for metadata
    chrome.tabs.sendMessage(activeTab.id, { action: 'GET_COURSE_INFO' }, (res) => {
      if (chrome.runtime.lastError) {
        if (subtitleEl) {
          subtitleEl.innerHTML = 'Script offline — <span id="reloadTabLink" style="color:var(--primary);cursor:pointer;text-decoration:underline;">Click to refresh tab</span>';
          document.getElementById('reloadTabLink')?.addEventListener('click', () => {
            chrome.tabs.reload(activeTab.id);
            window.close();
          });
        }
        return;
      }
      if (res && res.courseName) {
        if (titleEl) titleEl.textContent = res.courseName;
        if (subtitleEl) subtitleEl.textContent = res.itemCount ? `${res.itemCount} course items ready` : 'Ready for automation';
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
            showToast(`${title} started! Check Coursera for progress.`);
            setTimeout(() => window.close(), 1200);
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
