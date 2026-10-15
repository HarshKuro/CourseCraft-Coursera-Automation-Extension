/**
 * CourseCraft - Injected Page Bridge (rdr.js)
 * Emulates locking browser User-Agent & safely mirrors course metadata
 * to the content script via window.postMessage.
 */

(() => {
  'use strict';

  if (window.__COURSECRAFT_ATTACHED__) return;
  window.__COURSECRAFT_ATTACHED__ = true;

  const LOCKING_UA = 'coursera-locking-browser/0.6.6';

  // Override navigator.userAgent to satisfy locked-quiz checks
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

  // Ensure window.coursera namespace exists
  window.coursera = window.coursera || {};

  // Intercept coursera-lock protocol in window.open
  const originalOpen = window.open;
  window.open = function (url, target, features) {
    try {
      const urlStr = typeof url === 'string' ? url : url?.toString() || '';
      if (urlStr.startsWith('coursera-lock:')) {
        window.dispatchEvent(new CustomEvent('__COR_IPC_PACKET_TRANSFER__', { detail: urlStr }));
        return {
          closed: false,
          focus: () => {},
          close: () => {},
          postMessage: () => {},
          document: {},
          location: { href: urlStr }
        };
      }
      return originalOpen.call(this, url, target, features);
    } catch (e) {
      return null;
    }
  };

  // Safe dispatcher to content script
  function dispatchToExtension(url, contentType, data) {
    try {
      window.postMessage({
        source: 'coursecraft-bridge',
        url: url,
        contentType: contentType,
        response: data
      }, '*');
    } catch (err) {}
  }

  // Intercept XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._ccUrl = url;
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        if (!this._ccUrl || this.responseType === 'blob') return;
        const contentType = this.getResponseHeader('content-type') || '';
        if (contentType.includes('application/json') && this.responseText) {
          try {
            const parsed = JSON.parse(this.responseText);
            dispatchToExtension(this._ccUrl, contentType, parsed);
          } catch (_) {}
        }
      } catch (_) {}
    });
    return originalXhrSend.apply(this, arguments);
  };

  // Intercept Fetch
  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        response.clone().json().then((json) => {
          dispatchToExtension(url, contentType, json);
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };
})();
