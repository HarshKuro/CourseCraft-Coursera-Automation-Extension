/**
 * CourseCraft - Injected Page Bridge (rdr.js)
 * Version: 4.6.1
 * Features:
 * - Emulates locking browser User-Agent
 * - Sniffs User ID & course metadata from internal Coursera requests
 * - Unlocks HTML5 video playbackRate (removes 2x limit, enables up to 16x)
 * - Unlocks forward-seeking restrictions
 * - Native video player fast-forward with asynchronous polling
 * - Auto-advances across course items in Marathon Mode
 */

(() => {
  'use strict';

  if (window.__COURSECRAFT_ATTACHED__) return;
  window.__COURSECRAFT_ATTACHED__ = true;

  const LOCKING_UA = 'coursera-locking-browser/0.6.6';

  // 1. Override navigator.userAgent
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

  // 2. Sniff User ID from Network Requests
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

  // 3. Intercept XMLHttpRequest
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

  // 4. Intercept Fetch API
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

  // 5. Unlock HTMLMediaElement playbackRate & Seeking
  const nativeRate = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  const nativePlay = HTMLMediaElement.prototype.play;

  let currentMarathonSpeed = 16.0;
  window.__COURSECRAFT_FAST_FORWARDING__ = false;
  window.__COURSECRAFT_MARATHON__ = false;

  try {
    Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
      get: function() {
        return nativeRate?.get ? nativeRate.get.call(this) : (this.__cc_rate || 1.0);
      },
      set: function(val) {
        this.__cc_rate = val;
        const effective = (window.__COURSECRAFT_FAST_FORWARDING__ || window.__COURSECRAFT_MARATHON__) 
          ? Math.max(val, currentMarathonSpeed) 
          : val;
        if (nativeRate?.set) {
          nativeRate.set.call(this, effective);
        }
      },
      configurable: true
    });
  } catch (_) {}

  // Hook individual video elements to prevent seeking traps and maintain high playback speed
  const hookedVideos = new WeakSet();
  function hookVideo(video) {
    if (!video || hookedVideos.has(video)) return;
    hookedVideos.add(video);

    // Prevent platform forward-seeking lock from reverting position
    ['seeking', 'seeked'].forEach((evt) => {
      video.addEventListener(evt, (e) => {
        if (window.__COURSECRAFT_FAST_FORWARDING__) {
          e.stopImmediatePropagation();
        }
      }, { capture: true });
    });

    // Auto-resume if accidentally paused during fast-forward
    video.addEventListener('pause', () => {
      if (window.__COURSECRAFT_FAST_FORWARDING__ && !video.__userPaused) {
        setTimeout(() => {
          if (video.paused && !video.__userPaused) {
            nativePlay.call(video).catch(() => {});
          }
        }, 200);
      }
    }, { capture: true });
  }

  // Monitor DOM for dynamically added video players
  const observer = new MutationObserver(() => {
    document.querySelectorAll('video').forEach(hookVideo);
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  // 6. Active Video Fast-Forward Engine with Asynchronous DOM Polling
  function runVideoFastForward(callback) {
    let attempts = 0;
    const maxAttempts = 25; // 12.5 seconds total

    function findAndFastForward() {
      const video = document.querySelector('video');
      if (!video) {
        attempts++;
        if (attempts > maxAttempts) {
          if (callback) callback({ success: false, reason: 'No video player found after 12s polling' });
          return;
        }
        setTimeout(findAndFastForward, 500);
        return;
      }

      hookVideo(video);
      window.__COURSECRAFT_FAST_FORWARDING__ = true;

      const performSeek = () => {
        const dur = video.duration;
        if (!dur || !isFinite(dur) || dur <= 0) {
          setTimeout(performSeek, 400);
          return;
        }

        // Mute audio to avoid noise burst during high-speed seek
        video.muted = true;
        
        // Seek to 12s before end (takes ~0.8s at 16x speed to play through end)
        const targetTime = Math.max(0, dur - 12);

        try {
          if (nativeTime?.set) nativeTime.set.call(video, targetTime);
          else video.currentTime = targetTime;
        } catch (_) {
          video.currentTime = targetTime;
        }

        try {
          if (nativeRate?.set) nativeRate.set.call(video, currentMarathonSpeed);
          else video.playbackRate = currentMarathonSpeed;
        } catch (_) {}

        video.__userPaused = false;
        nativePlay.call(video).catch(() => {});
        video.dispatchEvent(new Event('timeupdate', { bubbles: true }));

        let finished = false;
        const cleanup = (wasFallback = false) => {
          if (finished) return;
          finished = true;
          window.__COURSECRAFT_FAST_FORWARDING__ = false;

          // Try clicking on-page completion button if Coursera rendered it
          const markBtn = document.querySelector('button[data-testid="mark-complete"], button[aria-label="Mark as completed"], button[data-testid="mark-as-completed-button"], button.rc-MarkAsCompleteButton');
          if (markBtn) {
            try { markBtn.click(); } catch (_) {}
          }

          if (callback) callback({ success: true, duration: dur, fallback: wasFallback });
        };

        video.addEventListener('ended', () => cleanup(false), { once: true });

        // Safety fallback: if video doesn't end in 5.5s, trigger completion dispatch
        setTimeout(() => {
          if (!finished && window.__COURSECRAFT_FAST_FORWARDING__) {
            try {
              if (nativeTime?.set) nativeTime.set.call(video, dur);
              else video.currentTime = dur;
              video.dispatchEvent(new Event('timeupdate', { bubbles: true }));
              video.dispatchEvent(new Event('ended', { bubbles: true }));
            } catch (_) {}
            cleanup(true);
          }
        }, 5500);
      };

      if (video.readyState >= 1 && isFinite(video.duration) && video.duration > 0) {
        performSeek();
      } else {
        video.addEventListener('loadedmetadata', performSeek, { once: true });
        video.addEventListener('canplay', performSeek, { once: true });
        nativePlay.call(video).catch(() => {});
      }
    }

    findAndFastForward();
  }

  // 7. Auto-Advance Next Item Selector
  function triggerNextNavigation() {
    const nextSelectors = [
      'button[data-testid="forward-navigation-button"]',
      'button[data-testid="next-item-button"]',
      '[data-e2e="forward-arrow"]',
      '[data-e2e="next-item-link"]',
      '[data-track-component="next_item_button"]',
      'button[aria-label*="Next" i]',
      'a[aria-label*="Next" i]',
      '[class*="NextButton"]',
      '[class*="next-button"]',
      'button[data-testid*="next" i]'
    ];

    for (const sel of nextSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null && !el.disabled) {
        el.click();
        return true;
      }
    }
    return false;
  }

  // 8. Communication Bridge with content.js
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'coursecraft-content') return;
    const { command, payload } = event.data;

    if (command === 'FAST_FORWARD') {
      runVideoFastForward((result) => {
        window.postMessage({
          source: 'coursecraft-bridge',
          type: 'FAST_FORWARD_RESULT',
          result
        }, '*');
      });
    } else if (command === 'ADVANCE_NEXT') {
      const ok = triggerNextNavigation();
      window.postMessage({
        source: 'coursecraft-bridge',
        type: 'ADVANCE_NEXT_RESULT',
        success: ok
      }, '*');
    } else if (command === 'SET_MARATHON') {
      window.__COURSECRAFT_MARATHON__ = !!payload?.enabled;
      if (payload?.speed) currentMarathonSpeed = Number(payload.speed);
    }
  });
})();
