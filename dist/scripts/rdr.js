/**
 * CourseCraft - Injected Page Bridge (rdr.js)
 * Emulates locking browser User-Agent, mirrors network payloads,
 * and automatically sniffs user ID from internal Coursera requests.
 */

(() => {
  'use strict';

  if (window.__COURSECRAFT_ATTACHED__) return;
  window.__COURSECRAFT_ATTACHED__ = true;

  const LOCKING_UA = 'coursera-locking-browser/0.6.6';

  // Override navigator.userAgent
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => LOCKING_UA,
      configurable: true
    });
  } catch (e) {
    try {
      Object.defineProperty(Navigator.prototype, 'userAgent', {
        get: () => LOCKING_UA,
        configurable: true
      });
    } catch (_) {}
  }

  window.coursera = window.coursera || {};

  // Check URL for user ID
  function checkUrlForUserId(url) {
    if (typeof url !== 'string') return;
    const match = url.match(/\/userPreferences\.v1\/(\d{6,})/)
               || url.match(/\/opencourse\.v1\/user\/(\d{6,})/)
               || url.match(/userId=(\d{6,})/)
               || url.match(/\/users\.v1\/(\d{6,})/)
               || url.match(/\/(\d{7,})~/);
    if (match) {
      try {
        window.postMessage({
          source: 'coursecraft-bridge',
          type: 'USER_ID_DETECTED',
          userId: match[1]
        }, '*');
      } catch (_) {}
    }
  }

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    checkUrlForUserId(url);
    this.addEventListener('load', function() {
      try {
        if (typeof url === 'string' && (url.includes('onDemandCourseMaterials.v2') || url.includes('opencourse.v1'))) {
          const parsed = JSON.parse(this.responseText);
          window.postMessage({
            source: 'coursecraft-bridge',
            url: url,
            response: parsed
          }, '*');
        }
      } catch (_) {}
    });
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  // Intercept Fetch API
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    checkUrlForUserId(url);
    const response = await originalFetch.apply(this, args);
    try {
      if (typeof url === 'string' && (url.includes('onDemandCourseMaterials.v2') || url.includes('opencourse.v1'))) {
        const clone = response.clone();
        clone.json().then((parsed) => {
          window.postMessage({
            source: 'coursecraft-bridge',
            url: url,
            response: parsed
          }, '*');
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };
})();
