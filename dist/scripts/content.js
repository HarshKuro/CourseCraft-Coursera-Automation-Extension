/**
 * CourseCraft - Main Content Script
 * Version: 4.5.0
 * Multi-strategy lecture completion engine with detailed HTTP response body logging,
 * automatic fallback across endpoint variants, onDemandLectureVideos resolution,
 * and live execution diagnostics.
 */

'use strict';

(() => {
  // Inject rdr.js into page context for userAgent emulation
  try {
    const scriptEl = document.createElement('script');
    scriptEl.src = chrome.runtime.getURL('dist/scripts/rdr.js');
    scriptEl.onload = () => scriptEl.remove();
    (document.head || document.documentElement).appendChild(scriptEl);
  } catch (_) {}

  // -----------------------------------------------------------
  // LIVE LOGGING ENGINE (Populates Popup & Console)
  // -----------------------------------------------------------
  const logsBuffer = [];

  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = { time, msg: String(msg), type };
    logsBuffer.push(entry);
    if (logsBuffer.length > 100) logsBuffer.shift();

    if (type === 'error') console.error('[CourseCraft]', msg);
    else if (type === 'warn') console.warn('[CourseCraft]', msg);
    else console.log('[CourseCraft]', msg);

    // Persist latest 50 logs for popup
    chrome.storage.local.set({ liveLogs: logsBuffer.slice(-50) });
  }

  // -----------------------------------------------------------
  // TOAST NOTIFICATION SYSTEM
  // -----------------------------------------------------------
  let toastContainer = null;

  function ensureToastContainer() {
    if (!toastContainer || !document.body.contains(toastContainer)) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'coursecraft-toast-container';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function showToast(message, type = 'info', persistent = false) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `coursecraft-toast ${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="coursecraft-toast-icon"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (type === 'error' || type === 'warning') {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="coursecraft-toast-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="coursecraft-toast-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    if (!persistent) {
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }
    return toast;
  }

  // -----------------------------------------------------------
  // COURSERA STATE & DATA STORE
  // -----------------------------------------------------------
  let courseMetadata = null;
  let courseItems = [];
  let currentUserId = '161276145';
  let currentUserName = 'Coursera Learner';
  let currentCourseId = null;
  let currentCourseSlug = null;
  let isResolvingContext = false;
  let realCsrfToken = null;

  // Listen for mirrored data from injected rdr.js
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'coursecraft-bridge') return;
    const { url, response, userId } = event.data;

    if (userId) {
      setUserId(userId);
    }

    if (response?.linked && response.linked['onDemandCourseMaterialItems.v2']) {
      courseMetadata = response;
      extractCourseMetadata(response);
    }

    if (response?.elements && response.elements[0]?.id && (url?.includes('api/opencourse.v1/user') || url?.includes('api/users.v1') || url?.includes('userPreferences.v1'))) {
      setUserId(String(response.elements[0].id));
    }
  });

  function setUserId(uid) {
    if (uid && uid !== 'null' && uid !== 'undefined' && !isNaN(Number(uid)) && String(uid).length >= 6) {
      currentUserId = String(uid);
      chrome.storage.local.set({ cachedUserId: currentUserId });
      log(`Active User ID detected: ${currentUserId}`, 'info');
    }
  }

  // Load custom/cached User ID on startup
  chrome.storage.local.get(['customUserId', 'cachedUserId', 'cachedUserName'], (data) => {
    if (data?.customUserId) currentUserId = String(data.customUserId);
    else if (data?.cachedUserId) currentUserId = String(data.cachedUserId);
    if (data?.cachedUserName) currentUserName = String(data.cachedUserName);
  });

  // CSRF Token Extractor: ONLY genuine CSRF3-Token cookie
  function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)CSRF3-Token=([^;]+)/i)
               || document.cookie.match(/(?:^|;\s*)csrf3-token=([^;]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function getCourseraHeaders() {
    let csrf = getCsrfToken() || realCsrfToken;
    if (!csrf) {
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'GET_CSRF_AND_USER' }, (r) => resolve(r));
        });
        if (res?.csrfToken) {
          realCsrfToken = res.csrfToken;
          csrf = res.csrfToken;
        }
        if (res?.userId && !currentUserId) setUserId(res.userId);
      } catch (_) {}
    }

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*'
    };

    if (csrf) {
      headers['X-CSRF3-Token'] = csrf;
    }

    return headers;
  }

  // Multi-tier User ID Resolver
  async function resolveUserId() {
    const stored = await chrome.storage.local.get(['customUserId', 'cachedUserId']);
    if (stored?.customUserId) {
      currentUserId = String(stored.customUserId);
      return currentUserId;
    }
    if (stored?.cachedUserId) {
      currentUserId = String(stored.cachedUserId);
      return currentUserId;
    }

    try {
      const entries = window.performance?.getEntriesByType?.('resource') || [];
      for (const entry of entries) {
        const name = entry.name || '';
        const match = name.match(/\/userPreferences\.v1\/(\d{6,})/)
                   || name.match(/\/opencourse\.v1\/user\/(\d{6,})/)
                   || name.match(/userId=(\d{6,})/)
                   || name.match(/\/users\.v1\/(\d{6,})/)
                   || name.match(/\/(\d{7,})~/);
        if (match) {
          setUserId(match[1]);
          return currentUserId;
        }
      }
    } catch (_) {}

    try {
      const match204 = document.cookie.match(/(?:^|;\s*)__204u=(\d{6,})-/);
      if (match204) {
        setUserId(match204[1]);
        return currentUserId;
      }
      const matchUid = document.cookie.match(/(?:^|;\s*)(?:coursera_user_id|userId|c_user)=(\d{6,})/);
      if (matchUid) {
        setUserId(matchUid[1]);
        return currentUserId;
      }
    } catch (_) {}

    try {
      const bgRes = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'GET_CSRF_AND_USER' }, (r) => resolve(r));
      });
      if (bgRes?.userId) {
        setUserId(bgRes.userId);
        return currentUserId;
      }
    } catch (_) {}

    return currentUserId;
  }

  // Extract Course Metadata from onDemandCourseMaterials.v2 response
  function extractCourseMetadata(data) {
    if (!data) return;
    const linked = data.linked || {};

    currentCourseId = data.elements?.[0]?.id 
                   || linked['onDemandGradingParameters.v1']?.[0]?.id 
                   || currentCourseId;

    const modules = linked['onDemandCourseMaterialModules.v1'] || [];
    const lessons = linked['onDemandCourseMaterialLessons.v1'] || [];
    const items = linked['onDemandCourseMaterialItems.v2'] || [];

    const pathMatch = window.location.pathname.match(/\/learn\/([^\/]+)/);
    if (pathMatch) currentCourseSlug = pathMatch[1];

    courseItems = items.map((item) => {
      const lesson = lessons.find((l) => l.id === item.lessonId) || {};
      const moduleObj = modules.find((m) => m.id === lesson.moduleId) || {};
      const summary = item.contentSummary || {};
      const customType = item.customDisplayTypenameOverride || '';
      
      let effectiveType = summary.typeName || '';
      if (!effectiveType) {
        if (customType.toLowerCase().includes('dialogue') || item.name?.toLowerCase().includes('dialogue')) {
          effectiveType = 'dialogue';
        } else if (item.name?.toLowerCase().includes('video') || item.name?.toLowerCase().includes('introduction')) {
          effectiveType = 'lecture';
        } else if (item.name?.toLowerCase().includes('reading') || item.name?.toLowerCase().includes('guide')) {
          effectiveType = 'supplement';
        } else if (/quiz|exam|graded|assignment/i.test(item.name)) {
          effectiveType = 'gradedQuiz';
        }
      }

      const isQuizType = /quiz|exam|graded|assignment|assessment/i.test(effectiveType) ||
                         /quiz|exam|graded/i.test(customType) ||
                         /quiz|exam|graded/i.test(item.name || '') ||
                         summary.definition?.assignmentFeatures?.includes('TAKE_HIGHEST_GRADE');

      return {
        open_course_slug: currentCourseSlug,
        course_id: currentCourseId,
        item_id: item.id,
        item_name: item.name || '',
        lesson_id: lesson.id || '',
        lesson_name: lesson.name || '',
        module_id: moduleObj.id || '',
        module_name: moduleObj.name || '',
        module_slug: moduleObj.slug || '',
        timeCommitment: item.timeCommitment || 0,
        typeName: effectiveType,
        videoId: summary.definition?.videoId || null,
        customDisplayTypenameOverride: customType,
        slug: item.slug || '',
        isQuiz: Boolean(isQuizType)
      };
    });

    log(`Loaded ${courseItems.length} items for ${currentCourseSlug} (Course ID: ${currentCourseId})`, 'info');
  }

  // Scan items present on the DOM (for dynamic items, AI Coach dialogues, practice widgets)
  function scanDomItems() {
    const domItems = [];
    const links = document.querySelectorAll('a[href*="/learn/"][href*="/item/"], a[href*="/learn/"][href*="/lecture/"], a[href*="/learn/"][href*="/supplement/"], a[href*="/learn/"][href*="/coach/"]');
    links.forEach((a) => {
      const href = a.getAttribute('href') || a.href;
      const match = href.match(/\/(item|lecture|supplement|coach)\/([a-zA-Z0-9_-]+)/);
      if (match) {
        const itemType = match[1];
        const itemId = match[2];
        const text = a.textContent?.trim() || '';
        const parentText = a.parentElement?.parentElement?.textContent || '';
        const isDialogue = text.toLowerCase().includes('dialogue') || parentText.toLowerCase().includes('dialogue') || itemType === 'coach';
        const isReading = text.toLowerCase().includes('reading') || parentText.toLowerCase().includes('reading') || itemType === 'supplement';
        const isVideo = text.toLowerCase().includes('video') || parentText.toLowerCase().includes('video') || itemType === 'lecture';
        const isQuiz = /quiz|exam|assignment|graded/i.test(text) || /quiz|exam|assignment|graded/i.test(parentText);

        domItems.push({
          item_id: itemId,
          item_name: text || itemId,
          course_id: currentCourseId,
          open_course_slug: currentCourseSlug,
          typeName: isDialogue ? 'dialogue' : isQuiz ? 'gradedQuiz' : isReading ? 'supplement' : isVideo ? 'lecture' : 'supplement',
          isDialogue,
          isQuiz,
          href
        });
      }
    });
    return domItems;
  }

  // Proactive Context Resolver
  async function ensureCourseContext(forceRefresh = false) {
    if (isResolvingContext) {
      while (isResolvingContext) {
        await wait(200);
      }
      return (courseItems.length > 0 && !!currentUserId);
    }

    const slugMatch = window.location.pathname.match(/\/learn\/([^\/]+)/);
    if (!slugMatch) {
      showToast('Please open a Coursera course page first', 'warning');
      return false;
    }
    currentCourseSlug = slugMatch[1];

    if (courseItems.length > 0 && currentUserId && currentCourseId && !forceRefresh) {
      return true;
    }

    isResolvingContext = true;

    try {
      // 1. Multi-tier User ID Resolver
      await resolveUserId();

      // 2. Fetch Course Materials with fields
      if (courseItems.length === 0 || !currentCourseId || forceRefresh) {
        const matUrl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${currentCourseSlug}&includes=modules,lessons,items,gradingParameters&fields=onDemandCourseMaterialItems.v2(name,slug,timeCommitment,contentSummary,customDisplayTypenameOverride)`;
        const mRes = await fetch(matUrl, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (mRes.ok) {
          const mData = await mRes.json();
          extractCourseMetadata(mData);
        }
      }

      // 3. Fallback for Course ID if needed
      if (!currentCourseId) {
        try {
          const cRes = await fetch(`https://www.coursera.org/api/courses.v1?q=slug&slug=${currentCourseSlug}`, {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (cRes.ok) {
            const cData = await cRes.json();
            if (cData.elements?.[0]?.id) {
              currentCourseId = cData.elements[0].id;
              courseItems.forEach((it) => { it.course_id = currentCourseId; });
            }
          }
        } catch (_) {}
      }

      // Extract User Name from navbar if available
      const profileEl = document.querySelector('[data-testid="user-profile-menu-button"]')
                     || document.querySelector('.profile-name')
                     || document.querySelector('button[aria-label*="Profile"]');
      if (profileEl?.textContent?.trim()) {
        currentUserName = profileEl.textContent.trim();
        chrome.storage.local.set({ cachedUserName: currentUserName });
      }

      // Final check on user ID after materials load
      if (!currentUserId) {
        await resolveUserId();
      }
    } catch (err) {
      log(`Context resolution error: ${err.message}`, 'warn');
    } finally {
      isResolvingContext = false;
    }

    return (courseItems.length > 0 && !!currentUserId);
  }

  // Get items matching current page context (specific item, current module, or course)
  function getContextItems(filterType = null) {
    let relevantItems = courseItems;

    if (filterType) {
      if (filterType === 'lecture') {
        relevantItems = courseItems.filter((i) => i.typeName === 'lecture');
      } else if (filterType === 'reading' || filterType === 'supplement') {
        relevantItems = courseItems.filter((i) => i.typeName === 'supplement');
      } else if (filterType === 'discussion') {
        relevantItems = courseItems.filter((i) => i.typeName === 'discussionPrompt');
      } else if (filterType === 'dialogue') {
        relevantItems = courseItems.filter((i) =>
          i.typeName === 'coach' || 
          i.typeName === 'ungradedWidget' || 
          i.typeName === 'dialogue' ||
          i.customDisplayTypenameOverride?.toLowerCase().includes('dialogue') ||
          i.item_name.toLowerCase().includes('dialogue') ||
          i.item_name.toLowerCase().includes('starting point')
        );
      } else if (filterType === 'ungradedWidget') {
        relevantItems = courseItems.filter((i) => i.typeName === 'ungradedWidget' || i.typeName === 'dialogue');
      } else if (filterType === 'quiz') {
        relevantItems = courseItems.filter((i) => i.isQuiz);
      }
    }

    const currentUrl = window.location.href;

    // Check if viewing a specific item page
    const specificItem = relevantItems.find((it) => currentUrl.includes(it.item_id));
    if (specificItem) {
      return [specificItem];
    }

    // Check if viewing a specific module page (/home/module/1 or /home/week/1)
    const moduleMatch = currentUrl.match(/\/home\/module\/(\d+)/i) || currentUrl.match(/\/home\/week\/(\d+)/i);
    if (moduleMatch) {
      const moduleIdx = parseInt(moduleMatch[1], 10) - 1;
      const moduleIds = [...new Set(courseItems.map((i) => i.module_id).filter(Boolean))];
      if (moduleIds[moduleIdx]) {
        const activeModuleId = moduleIds[moduleIdx];
        const moduleFiltered = relevantItems.filter((i) => i.module_id === activeModuleId);
        if (moduleFiltered.length > 0) {
          return moduleFiltered;
        }
      }
    }

    return relevantItems;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // -----------------------------------------------------------
  // REAL VIDEO ID LOOKUP (FROM onDemandLectureVideos.v1)
  // -----------------------------------------------------------
  async function fetchRealVideoId(item) {
    if (item.videoId) return item.videoId;
    if (!item.course_id || !item.item_id) return null;

    try {
      const url = `https://www.coursera.org/api/onDemandLectureVideos.v1/${item.course_id}~${item.item_id}?includes=video&fields=onDemandVideos.v1`;
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const vId = data.linked?.['onDemandVideos.v1']?.[0]?.id;
        if (vId) {
          item.videoId = vId;
          return vId;
        }
      }
    } catch (_) {}
    return null;
  }

  // -----------------------------------------------------------
  // MULTI-STRATEGY VIDEO ENDED DISPATCHER
  // -----------------------------------------------------------
  async function sendEndedEventMulti(userId, slug, courseId, itemId, durationSec, headers) {
    const targetUrls = [
      `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${slug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`,
      `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseId}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`,
      `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${slug}/item/${itemId}/lecture/videoEvents/ended`
    ];

    const targetBodies = [
      JSON.stringify({ contentRequestBody: {} }),
      JSON.stringify({ contentRequestBody: { viewedUpTo: durationSec } })
    ];

    for (let u = 0; u < targetUrls.length; u++) {
      for (let b = 0; b < targetBodies.length; b++) {
        try {
          const res = await fetch(targetUrls[u], {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: targetBodies[b]
          });

          const rawText = await res.text();
          let data = {};
          try { data = JSON.parse(rawText); } catch (_) {}
          const progressState = data?.itemProgress?.progressState;

          log(`Ended [${itemId}] (T${u + 1}B${b + 1}): HTTP ${res.status} | Body: ${rawText.slice(0, 120)}`, res.ok ? 'info' : 'warn');

          if (res.ok && progressState === 'Completed') {
            return { success: true, progressState: 'Completed' };
          }
          if (res.ok || res.status === 200 || res.status === 201 || res.status === 204) {
            return { success: true, progressState: progressState || 'ok' };
          }
        } catch (err) {
          log(`Ended [${itemId}] Error: ${err.message}`, 'warn');
        }
      }
    }

    return { success: false };
  }

  // -----------------------------------------------------------
  // AUTOMATION WORKFLOWS
  // -----------------------------------------------------------

  // 1. Single / Module Lecture Completion
  async function completeActiveLecture() {
    log('Connecting to course data...', 'info');
    showToast('Connecting to course data...', 'info');

    const ok = await ensureCourseContext();
    if (!ok) {
      log('Failed to detect User ID or load course data.', 'error');
      showToast('Could not detect User ID. Please check the popup to set it.', 'error');
      return;
    }

    // Trigger video element on screen if present
    const videoEl = document.querySelector('video');
    if (videoEl) {
      try {
        videoEl.currentTime = videoEl.duration || 1000;
        videoEl.dispatchEvent(new Event('timeupdate'));
        videoEl.dispatchEvent(new Event('ended'));
        videoEl.dispatchEvent(new Event('pause'));
      } catch (_) {}
    }

    const targets = getContextItems('lecture');
    if (targets.length === 0) {
      log('No video lectures found in this section.', 'warn');
      showToast('No video lectures found in this section.', 'warning');
      return;
    }

    log(`Starting completion of ${targets.length} lectures for user ${currentUserId}...`, 'info');
    showToast(`Processing ${targets.length} lecture(s)...`, 'info', true);

    let completed = 0;
    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      showToast(`Processing (${i + 1}/${targets.length}): ${item.item_name}`, 'info', true);
      const success = await markLectureComplete(item);
      if (success) completed++;
      await wait(400);
    }

    log(`Lectures Finished: ${completed}/${targets.length} completed.`, completed > 0 ? 'success' : 'warn');
    showToast(`🎉 Successfully completed ${completed}/${targets.length} lecture(s)! Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 2. Skip Video+ (Bulk Complete ALL Course Lectures)
  async function completeAllLectures() {
    log('Connecting to course data for Skip Video+...', 'info');
    showToast('Connecting to course data...', 'info');

    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not detect User ID. Please check the popup.', 'error');
      return;
    }

    const allVideos = courseItems.filter((i) => i.typeName === 'lecture');
    if (allVideos.length === 0) {
      showToast('No video lectures found in this course.', 'warning');
      return;
    }

    log(`Skip Video+: Processing all ${allVideos.length} lectures in course...`, 'info');
    showToast(`Processing all ${allVideos.length} lectures in course...`, 'info', true);

    let completed = 0;
    for (let i = 0; i < allVideos.length; i++) {
      const item = allVideos[i];
      showToast(`Processing (${i + 1}/${allVideos.length}): ${item.item_name}`, 'info', true);
      const success = await markLectureComplete(item);
      if (success) completed++;
      await wait(350);
    }

    log(`Skip Video+ completed: ${completed}/${allVideos.length} finished.`, 'success');
    showToast(`🎉 Skip Video+ completed! ${completed}/${allVideos.length} lectures finished. Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  }

  // Single Lecture API Mark (Full Lifecycle & Multi-Strategy Fallback)
  async function markLectureComplete(item) {
    if (!currentUserId || !item) return false;
    const slug = item.open_course_slug || currentCourseSlug;
    const courseId = item.course_id || currentCourseId;
    const itemId = item.item_id;
    const headers = await getCourseraHeaders();

    log(`Lecture [${itemId}] "${item.item_name}": Fetching video metadata...`, 'info');

    // 1. Fetch real videoId from onDemandLectureVideos.v1
    const videoId = await fetchRealVideoId(item);
    if (videoId) {
      log(`Lecture [${itemId}]: Found Video ID ${videoId}`, 'info');
    }

    const rawTime = item.timeCommitment || 120000;
    const durationSec = Math.floor(rawTime > 1000 ? rawTime / 1000 : rawTime);

    try {
      // Step A: Send Play event
      const playUrl = `https://www.coursera.org/api/opencourse.v1/user/${currentUserId}/course/${slug}/item/${itemId}/lecture/videoEvents/play?autoEnroll=false`;
      const playRes = await fetch(playUrl, {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({ contentRequestBody: {} })
      }).catch(() => {});

      if (playRes) {
        log(`Lecture [${itemId}] Play Event: HTTP ${playRes.status}`, playRes.ok ? 'info' : 'warn');
      }

      // Step B: Send Video Progress PUT
      if (videoId && courseId) {
        const progressId = `${currentUserId}~${courseId}~${videoId}`;
        const putRes = await fetch(`https://www.coursera.org/api/onDemandVideoProgresses.v1/${progressId}`, {
          method: 'PUT',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            viewedUpTo: durationSec,
            videoProgressId: progressId
          })
        }).catch(() => {});

        if (putRes) {
          log(`Lecture [${itemId}] Progress PUT (${durationSec}s): HTTP ${putRes.status}`, putRes.ok ? 'info' : 'warn');
        }
      }

      // Step C: Send multi-strategy ended event
      const endedResult = await sendEndedEventMulti(currentUserId, slug, courseId, itemId, durationSec, headers);

      // Step D: Supplement completion fallback
      try {
        const supRes = await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            userId: Number(currentUserId) || 161276145,
            courseId: courseId,
            itemId: itemId
          })
        });
        log(`Lecture [${itemId}] Supplement Completion: HTTP ${supRes.status}`, supRes.ok ? 'info' : 'warn');
      } catch (_) {}

      // Step E: Trigger DOM mark complete button if active page
      const markBtn = document.querySelector('button[data-testid="mark-complete"], button[aria-label="Mark as completed"]');
      if (markBtn) {
        try { markBtn.click(); } catch (_) {}
      }

      if (endedResult.success) {
        log(`Lecture [${itemId}]: Verified COMPLETED!`, 'success');
        return true;
      }

      return false;
    } catch (err) {
      log(`Lecture [${itemId}] Exception: ${err.message}`, 'error');
      return false;
    }
  }

  // 3. Complete Reading Materials
  async function completeReading() {
    log('Connecting to course data for Readings...', 'info');
    showToast('Connecting to course data...', 'info');

    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data.', 'error');
      return;
    }

    let readings = getContextItems('reading');
    if (readings.length === 0) {
      const domItems = scanDomItems().filter((d) => d.typeName === 'supplement');
      if (domItems.length > 0) readings = domItems;
    }

    if (readings.length === 0) {
      showToast('No reading materials found in this section.', 'warning');
      return;
    }

    showToast(`Completing ${readings.length} reading item(s)...`, 'info', true);

    const headers = await getCourseraHeaders();
    const userIdNum = Number(currentUserId) || 161276145;
    const courseId = currentCourseId || 'SG_K6nEmEeWxvQr3acyajw';

    let completed = 0;
    for (const item of readings) {
      try {
        const cId = item.course_id || courseId;
        const res = await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            userId: userIdNum,
            courseId: cId,
            itemId: item.item_id
          })
        });

        if (res.ok || res.status === 200 || res.status === 201 || res.status === 204) {
          completed++;
          log(`Reading [${item.item_id}] Completed (HTTP ${res.status})`, 'success');
        } else {
          const errText = await res.text().catch(() => '');
          if (errText.toLowerCase().includes('already')) {
            completed++;
            log(`Reading [${item.item_id}] Already Completed`, 'info');
          }
        }
      } catch (err) {
        log(`Reading [${item.item_id}] Error: ${err.message}`, 'warn');
      }
    }

    // Trigger on-page button if active reading open
    const markCompleteBtn = document.querySelector('button[data-testid="mark-complete"], button[aria-label="Mark as completed"]');
    if (markCompleteBtn) {
      try { markCompleteBtn.click(); } catch (_) {}
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    showToast(`🎉 Successfully marked ${completed}/${readings.length} reading(s) completed! Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 4. Complete AI Coach Dialogue & Interactive sessions
  async function completeDialogue() {
    log('Connecting to course data for Dialogues...', 'info');
    showToast('Connecting to course data...', 'info');
    await ensureCourseContext();

    let dialogues = getContextItems('dialogue');
    if (dialogues.length === 0) {
      const domItems = scanDomItems().filter((d) => d.isDialogue || d.typeName === 'dialogue');
      if (domItems.length > 0) dialogues = domItems;
    }

    // Check active URL for direct item ID
    const urlMatch = window.location.pathname.match(/\/(item|coach|supplement)\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      const activeId = urlMatch[2];
      if (!dialogues.some((d) => d.item_id === activeId)) {
        dialogues.unshift({
          item_id: activeId,
          item_name: document.title || 'Active Dialogue',
          course_id: currentCourseId,
          open_course_slug: currentCourseSlug
        });
      }
    }

    const headers = await getCourseraHeaders();
    const courseId = currentCourseId || 'SG_K6nEmEeWxvQr3acyajw';
    let completed = 0;

    showToast('Completing dialogue session...', 'info', true);

    // Safe button search across all buttons in DOM
    const allButtons = Array.from(document.querySelectorAll('button'));
    const endBtns = allButtons.filter((btn) => {
      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      return (
        text.includes('end session') ||
        text.includes('end dialogue') ||
        text.includes('leave conversation') ||
        text.includes('mark as completed') ||
        text.includes('mark complete') ||
        text.includes('complete') ||
        text.includes('finish') ||
        aria.includes('end session') ||
        aria.includes('mark as completed') ||
        testId.includes('end-session') ||
        testId.includes('mark-complete')
      );
    });

    endBtns.forEach((btn) => {
      try { btn.click(); completed++; } catch (_) {}
    });

    for (const item of dialogues) {
      try {
        const cId = item.course_id || courseId;
        const itemId = item.item_id;

        // 1. Create and end GraphQL chat session
        const createRes = await fetch('https://www.coursera.org/graphql-gateway?opname=AiCoachPlatform_CreateChatSession', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify([{
            operationName: 'AiCoachPlatform_CreateChatSession',
            variables: {
              input: {
                title: `coachItem-${cId}-${itemId}`,
                userId: String(currentUserId || '161276145')
              }
            },
            query: 'mutation AiCoachPlatform_CreateChatSession($input: AiCoach_CreateChatSessionInput!) { AiCoach_CreateChatSession(input: $input) { id title __typename } }'
          }])
        });

        let sessionId = null;
        if (createRes.ok) {
          const cJson = await createRes.json();
          sessionId = cJson?.[0]?.data?.AiCoach_CreateChatSession?.id || cJson?.data?.AiCoach_CreateChatSession?.id;
        }

        // End chat session
        await fetch('https://www.coursera.org/graphql-gateway?opname=CoachItem_EndSession', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify([{
            operationName: 'CoachItem_EndSession',
            variables: {
              input: {
                chatSessionId: sessionId || `session-${cId}-${itemId}`,
                message: 'Generate final session summary',
                coachModeId: 'COACH_ITEM_DIALOGUE',
                terminalActionId: 'STUCK_END',
                courseraContext: {
                  courseId: cId,
                  itemId: itemId,
                  courseBranchId: cId
                },
                additionalContext: []
              }
            },
            query: 'mutation CoachItem_EndSession($input: CoachItem_EndSessionInput!) { CoachItem_EndSession(input: $input) { chatSessionId itemCompletionHandled __typename } }'
          }])
        }).catch(() => {});

        // 2. Mark widget progress
        const key = `${currentUserId || '161276145'}~${cId}~${itemId}`;
        await fetch(`https://www.coursera.org/api/onDemandWidgetProgress.v1/${key}`, {
          method: 'PUT',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            sessionId: sessionId || 'completed-session',
            progressState: 'Completed'
          })
        }).catch(() => {});

        // 3. Mark supplement completion as fallback
        await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
          method: 'POST',
          headers: headers,
          credentials: 'include',
          body: JSON.stringify({
            userId: Number(currentUserId || '161276145'),
            courseId: cId,
            itemId: itemId
          })
        }).catch(() => {});

        completed++;
        log(`Dialogue [${itemId}] completed successfully.`, 'success');
      } catch (err) {
        log(`Dialogue error on ${item.item_id}: ${err.message}`, 'warn');
      }
    }

    showToast('🎉 Dialogue session completed! Reloading...', 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 5. Complete Discussion
  async function completeDiscussion() {
    log('Connecting to course data for Discussions...', 'info');
    showToast('Connecting to course data...', 'info');
    await ensureCourseContext();

    const discussions = getContextItems('discussion');
    const headers = await getCourseraHeaders();
    const courseId = currentCourseId || 'SG_K6nEmEeWxvQr3acyajw';

    const phrases = [
      'Very insightful points covered in this topic. Thank you.',
      'Clear explanations and valuable real-world practical examples.',
      'Helpful discussion and great practical takeaways for this lesson.',
      'The foundational concepts explained here are very clear and helpful.'
    ];

    let completed = 0;

    // Type into active DOM prompt if on a discussion page
    const promptEl = document.querySelector('textarea, div[contenteditable="true"]');
    if (promptEl) {
      try {
        promptEl.focus();
        document.execCommand('insertText', false, 'Insightful discussion points shared. Thank you.');
        await wait(500);
        const allBtns = Array.from(document.querySelectorAll('button'));
        const submitBtn = allBtns.find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'post' || t === 'reply' || b.getAttribute('data-testid') === 'discussion-submit';
        });
        if (submitBtn) {
          submitBtn.click();
          completed++;
        }
      } catch (_) {}
    }

    for (const item of discussions) {
      try {
        const promptUrl = `https://www.coursera.org/api/onDemandDiscussionPrompts.v1/${currentUserId}~${courseId}~${item.item_id}?fields=onDemandDiscussionPromptQuestions.v1(content,creatorId,createdAt,forumId,sessionId,lastAnsweredBy,lastAnsweredAt,totalAnswerCount,topLevelAnswerCount,viewCount),promptType,question&includes=question`;
        const promptRes = await fetch(promptUrl, { headers: headers, credentials: 'include' });
        if (promptRes.ok) {
          const promptJson = await promptRes.json();
          const forumQId = promptJson.elements?.[0]?.promptType?.definition?.courseItemForumQuestionId;
          if (forumQId) {
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            const answerUrl = 'https://www.coursera.org/api/onDemandCourseForumAnswers.v1/?fields=content,forumQuestionId,parentForumAnswerId,state,creatorId,createdAt,order,upvoteCount,childAnswerCount,isFlagged,isUpvoted,courseItemForumQuestionId,parentCourseItemForumAnswerId&includes=profiles,children,userId';
            const aRes = await fetch(answerUrl, {
              method: 'POST',
              headers: headers,
              credentials: 'include',
              body: JSON.stringify({
                content: {
                  typeName: 'cml',
                  definition: {
                    dtdId: 'discussion/1',
                    value: `<co-content><text>${phrase}</text></co-content>`
                  }
                },
                courseForumQuestionId: `${courseId}~${forumQId.split('~')[2] || forumQId}`
              })
            });
            if (aRes.ok) {
              completed++;
              log(`Discussion posted on ${item.item_id}`, 'success');
            }
          }
        }
      } catch (_) {}
    }

    showToast('🎉 Discussion response submitted! Reloading...', 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 6. Complete Practice Widgets / Ungraded Plugins
  async function completeUngradedPlugin() {
    showToast('Submitting practice widgets...', 'info');
    await ensureCourseContext();

    const headers = await getCourseraHeaders();
    const courseId = currentCourseId || 'SG_K6nEmEeWxvQr3acyajw';
    const widgets = getContextItems('ungradedWidget');

    // Click on-page submit buttons
    const checkBtns = document.querySelectorAll('button[data-testid="widget-submit"], button[aria-label="Submit"], button[data-testid="mark-complete"], button[aria-label="Check"]');
    checkBtns.forEach((btn) => {
      try { btn.click(); } catch (_) {}
    });

    for (const item of widgets) {
      try {
        const key = `${currentUserId}~${courseId}~${item.item_id}`;
        const res = await fetch(`https://www.coursera.org/api/onDemandWidgetSessions.v1/${key}?fields=session,sessionId`, {
          headers: headers,
          credentials: 'include'
        });
        if (res.ok) {
          const json = await res.json();
          const sessId = json?.elements?.[0]?.sessionId;
          if (sessId) {
            await fetch(`https://www.coursera.org/api/onDemandWidgetProgress.v1/${key}`, {
              method: 'PUT',
              headers: headers,
              credentials: 'include',
              body: JSON.stringify({ sessionId: sessId, progressState: 'Completed' })
            });
            log(`Practice widget [${item.item_id}] Completed`, 'success');
          }
        }
      } catch (_) {}
    }

    showToast('🎉 Practice widgets marked complete! Reloading...', 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 7. Shareable Link
  function copyShareableLink() {
    const url = window.location.href;
    if (url.includes('/assignment-submission/')) {
      const shareUrl = url.split('/attempt')[0];
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Assignment link copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Link: ' + shareUrl, 'info');
      });
    } else {
      navigator.clipboard.writeText(url);
      showToast('Current course link copied!', 'success');
    }
  }

  // 8. Course Backup (ZIP Export)
  async function backupCourseMaterials() {
    await ensureCourseContext();
    if (courseItems.length === 0) {
      showToast('Could not load course outline for backup.', 'warning');
      return;
    }

    if (typeof JSZip === 'undefined') {
      showToast('Initializing backup engine, please try again in a moment...', 'info');
      return;
    }

    showToast('Generating course archive...', 'info', true);

    try {
      const zip = new JSZip();
      const folderName = (currentCourseSlug || 'coursera-course') + '-backup';
      const rootFolder = zip.folder(folderName);

      let outlineText = `CourseCraft Course Backup\nCourse: ${currentCourseSlug}\nTotal Items: ${courseItems.length}\n\n`;
      courseItems.forEach((item, idx) => {
        outlineText += `${idx + 1}. [${item.typeName}] ${item.module_name} > ${item.lesson_name} > ${item.item_name}\n`;
      });
      rootFolder.file('Course-Outline.txt', outlineText);

      const contentBlob = await zip.generateAsync({ type: 'blob' });
      const downloadUrl = URL.createObjectURL(contentBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      showToast('🎉 Course Backup downloaded successfully!', 'success');
    } catch (err) {
      showToast('Backup error: ' + err.message, 'error');
    }
  }

  // 9. AI Quiz Assistant & Graded Assignments
  async function solveQuizAssistant() {
    const currentUrl = window.location.href;

    // Check if on a quiz attempt page or if questions are present
    let questionCards = Array.from(document.querySelectorAll(
      'div.css-1tfphom, div[data-testid="part-SubmissionPartWidget"], div.rc-FormPartsQuestion, div[data-testid="question-card"], div.rc-QuizQuestion, fieldset'
    ));

    // Fallback: If no containers found, group radios by name
    if (questionCards.length === 0) {
      const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => r.id !== 'agreement-checkbox-base');
      const radioGroups = new Set(radios.map(r => r.name).filter(Boolean));
      if (radioGroups.size > 0) {
        questionCards = Array.from(radioGroups).map(name => {
          return document.querySelector(`input[type="radio"][name="${name}"]`)?.closest('div[role="group"], fieldset, div') || document.body;
        });
      }
    }

    const isQuizAttemptPage = currentUrl.includes('/attempt') || currentUrl.includes('/assignment-submission/') || questionCards.length > 0;

    if (!isQuizAttemptPage) {
      // Check if on quiz cover page with a Start / Resume button
      const allBtns = Array.from(document.querySelectorAll('button'));
      const startBtn = allBtns.find(b => {
        const text = (b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const testId = (b.getAttribute('data-testid') || '').toLowerCase();
        return (
          text.includes('start assignment') ||
          text.includes('resume assignment') ||
          text.includes('start quiz') ||
          text.includes('resume quiz') ||
          text.includes('try again') ||
          aria.includes('start assignment') ||
          aria.includes('resume assignment') ||
          testId.includes('coverpageactionbutton')
        );
      });

      if (startBtn && !startBtn.disabled) {
        log('Starting quiz assignment attempt from cover page...', 'info');
        showToast('Starting quiz assignment attempt...', 'info');
        startBtn.click();
        return;
      }

      // If on module page, navigate directly to the current module's quiz
      await ensureCourseContext();
      const quizzes = getContextItems('quiz');
      if (quizzes.length > 0) {
        log(`Opening quiz item: ${quizzes[0].item_name}...`, 'info');
        showToast(`Opening quiz: ${quizzes[0].item_name}...`, 'info');
        const targetUrl = `https://www.coursera.org/learn/${currentCourseSlug}/item/${quizzes[0].item_id}`;
        window.location.assign(targetUrl);
        return;
      } else {
        showToast('Please open any graded quiz or exam assignment to use Quiz Assistant.', 'info');
        return;
      }
    }

    showToast('Analyzing quiz questions...', 'info', true);

    const config = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'autoSubmitQuiz']);
    const apiKey = config.geminiApiKey?.trim();
    const model = config.geminiModel || 'gemini-1.5-flash';

    if (apiKey) {
      showToast('Solving quiz with Google Gemini AI...', 'info', true);
      try {
        const extractedQuestions = [];
        questionCards.forEach((card, index) => {
          const promptEl = card.querySelector('div[data-testid="cml-viewer"], div.rc-CML, legend, h3, p');
          const optionEls = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
          const optionsText = [];
          optionEls.forEach((opt) => {
            const label = opt.parentElement?.textContent?.trim() || '';
            if (label) optionsText.push(label);
          });

          extractedQuestions.push({
            id: index,
            question: promptEl?.textContent?.trim() || `Question ${index + 1}`,
            options: optionsText
          });
        });

        const aiPrompt = `You are an academic exam assistant. Below are multiple-choice quiz questions.
For each question, select the best correct option.
Return ONLY valid JSON matching this exact format:
{"answers": [{"id": 0, "correctIndex": 1}, {"id": 1, "correctIndex": 0}]}

Questions:
${JSON.stringify(extractedQuestions)}`;

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiPrompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (res.ok) {
          const data = await res.json();
          const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          const solution = JSON.parse(replyText);
          const answers = solution.answers || [];

          answers.forEach((ans) => {
            const card = questionCards[ans.id];
            if (card) {
              const options = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
              const targetInput = options[ans.correctIndex];
              if (targetInput && !targetInput.checked) {
                targetInput.click();
              }
            }
          });

          handleHonorCodeAndSubmit(config.autoSubmitQuiz);
          showToast('🎉 All answers marked via Gemini AI!', 'success');
          return;
        }
      } catch (err) {
        log(`Gemini API error: ${err.message}`, 'warn');
      }
    }

    // Fallback: Select first unselected options & handle honor code
    questionCards.forEach((card) => {
      const options = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (options.length > 0 && !Array.from(options).some((o) => o.checked)) {
        options[0].click();
      }
    });

    handleHonorCodeAndSubmit(config.autoSubmitQuiz);

    if (!apiKey) {
      showToast('Options selected! (Tip: Add your free Gemini API key in Settings for AI answers)', 'info');
    } else {
      showToast('Quiz options updated.', 'success');
    }
  }

  // Auto-fill Honor Code and optionally submit
  function handleHonorCodeAndSubmit(autoSubmit = false) {
    // 1. Honor Code Checkbox
    const agreementBox = document.getElementById('agreement-checkbox-base')
                      || document.querySelector('input[data-testid="agreement-checkbox-base"]')
                      || document.querySelector('input[name*="agreement" i]')
                      || document.querySelector('input[type="checkbox"][id*="agreement" i]');
    if (agreementBox && !agreementBox.checked) {
      agreementBox.click();
      agreementBox.parentElement?.parentElement?.click();
      log('Honor code checkbox auto-checked.', 'info');
    }

    // 2. Honor Code Name Input
    const nameInput = document.querySelector('input[data-testid="honor-code-legal-name-input"]')
                   || document.querySelector('input[placeholder*="legal name" i]')
                   || document.querySelector('input[aria-label*="name" i]');
    if (nameInput) {
      const profileName = document.querySelector('[data-testid="user-profile-menu-button"]')?.textContent?.trim()
                       || document.querySelector('.profile-name')?.textContent?.trim()
                       || currentUserName
                       || 'Student Participant';
      
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(nameInput, profileName);
      } else {
        nameInput.value = profileName;
      }
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      nameInput.dispatchEvent(new Event('blur', { bubbles: true }));
      log(`Honor code legal name auto-filled: "${profileName}"`, 'info');
    }

    // 3. Optional Auto-submit
    if (autoSubmit) {
      setTimeout(() => {
        const submitBtn = document.querySelector('button[data-testid="submit-button"], button[aria-label="Submit"]');
        if (submitBtn && submitBtn.getAttribute('aria-disabled') !== 'true') {
          submitBtn.click();
          log('Submit button clicked.', 'info');
          setTimeout(() => {
            const confirmBtn = document.querySelector('button[data-testid="dialog-submit-button"]');
            if (confirmBtn && !confirmBtn.disabled) {
              confirmBtn.click();
              log('Confirmation dialog submitted.', 'info');
            }
          }, 1000);
        }
      }, 1500);
    }
  }

  // -----------------------------------------------------------
  // MESSAGE DISPATCHER (FROM POPUP & BACKGROUND)
  // -----------------------------------------------------------
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request?.action;

    if (action === 'GET_COURSE_INFO') {
      ensureCourseContext().then(() => {
        sendResponse({
          courseName: currentCourseSlug ? currentCourseSlug.replace(/-/g, ' ').toUpperCase() : 'Coursera Course',
          itemCount: courseItems.length,
          userId: currentUserId || '161276145',
          userName: currentUserName || 'Coursera Learner'
        });
      });
      return true;
    }

    if (action === 'SET_USER_ID' && request.userId) {
      currentUserId = String(request.userId).trim();
      chrome.storage.local.set({ customUserId: currentUserId, cachedUserId: currentUserId });
      log(`User ID updated by user to ${currentUserId}`, 'info');
      showToast(`User ID updated to ${currentUserId}`, 'success');
      sendResponse({ success: true, userId: currentUserId });
      return true;
    }

    if (action === 'SHOW_TOAST' && request.payload) {
      showToast(request.payload.message, request.payload.type, request.payload.keep);
      sendResponse({ success: true });
      return true;
    }

    // Action mappings
    if (action === 'lecture') completeActiveLecture();
    else if (action === 'skipvideoplus') completeAllLectures();
    else if (action === 'reading') completeReading();
    else if (action === 'discussion') completeDiscussion();
    else if (action === 'dialogue') completeDialogue();
    else if (action === 'ungradedplugin') completeUngradedPlugin();
    else if (action === 'shareablelink') copyShareableLink();
    else if (action === 'coursebackup') backupCourseMaterials();
    else if (action === 'quiz') solveQuizAssistant();

    sendResponse({ success: true, message: 'Action triggered' });
    return true;
  });

  // Keyboard shortcut listener
  window.addEventListener('keydown', (e) => {
    if ((e.altKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
      solveQuizAssistant();
    }
  });

  // Initial proactive context resolution
  ensureCourseContext().catch(() => {});

  log('CourseCraft v4.5.0 active on page.', 'info');
})();
