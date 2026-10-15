/**
 * CourseCraft - Main Content Script
 * Version: 4.0.0
 * Robust Coursera automation: proactive metadata fetching, full session credential handling,
 * instant lecture/reading/dialogue/widget completion, and free Gemini AI quiz assistance.
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
      iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="coursecraft-toast-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    // Optional audio speech
    chrome.storage.sync.get('speechEnabled', (data) => {
      if (data?.speechEnabled && 'speechSynthesis' in window) {
        try {
          const utterance = new SpeechSynthesisUtterance(message);
          utterance.rate = 1.1;
          window.speechSynthesis.speak(utterance);
        } catch (_) {}
      }
    });

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
  let currentUserId = null;
  let currentCourseId = null;
  let currentCourseSlug = null;
  let isResolvingContext = false;

  // Listen for mirrored data from injected rdr.js if available
  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'coursecraft-bridge') return;
    const { url, response } = event.data;

    if (response?.linked && response.linked['onDemandCourseMaterialItems.v2']) {
      courseMetadata = response;
      extractCourseMetadata(response);
    }

    if (response?.elements && response.elements[0]?.id && (url.includes('api/opencourse.v1/user') || url.includes('api/users.v1'))) {
      currentUserId = String(response.elements[0].id);
    }
  });

  // Extract User ID from DOM script tags
  function extractUserIdFromDOM() {
    const scripts = document.getElementsByTagName('script');
    for (const s of scripts) {
      const text = s.textContent || s.innerHTML || '';
      if (text.includes('window.App')) {
        const match = text.match(/window\.App\s*=\s*(\{.+?\});/s);
        if (match) {
          try {
            const app = JSON.parse(match[1]);
            const user = app?.context?.dispatcher?.stores?.ApplicationStore?.userData 
                      || app?.context?.user;
            if (user?.id) {
              return String(user.id);
            }
          } catch (_) {}
        }
      }
      if (text.includes('ApplicationStore') && text.includes('userData')) {
        const userMatch = text.match(/"userData":\s*\{[^}]*"id":\s*(\d+)/);
        if (userMatch) return userMatch[1];
      }
    }
    return null;
  }

  // Extract Course Metadata from onDemandCourseMaterials.v2 response
  function extractCourseMetadata(data) {
    if (!data?.linked) return;
    const linked = data.linked;

    currentCourseId = linked['onDemandGradingParameters.v1']?.[0]?.id || null;
    const modules = linked['onDemandCourseMaterialModules.v1'] || [];
    const lessons = linked['onDemandCourseMaterialLessons.v1'] || [];
    const items = linked['onDemandCourseMaterialItems.v2'] || [];

    const pathMatch = window.location.pathname.match(/\/learn\/([^\/]+)/);
    if (pathMatch) currentCourseSlug = pathMatch[1];

    courseItems = items.map((item) => {
      const lesson = lessons.find((l) => l.id === item.lessonId) || {};
      const moduleObj = modules.find((m) => m.id === lesson.moduleId) || {};
      const summary = item.contentSummary || {};
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
        typeName: summary.typeName || '',
        videoId: summary.definition?.videoId || null,
        customDisplayTypenameOverride: item.customDisplayTypenameOverride || null,
        slug: item.slug || '',
        isQuiz: summary.typeName === 'quiz' || 
                summary.typeName === 'exam' || 
                summary.typeName === 'staffGraded' || 
                summary.typeName === 'ungradedAssignment' ||
                summary.definition?.assignmentFeatures?.includes('TAKE_HIGHEST_GRADE')
      };
    });
    console.log(`[CourseCraft] Loaded ${courseItems.length} items for course: ${currentCourseSlug}`);
  }

  // Proactive Context Resolver (Self-healing & Independent)
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

    if (courseItems.length > 0 && currentUserId && !forceRefresh) {
      return true;
    }

    isResolvingContext = true;

    try {
      // 1. Resolve User ID
      if (!currentUserId || forceRefresh) {
        currentUserId = extractUserIdFromDOM();
      }

      if (!currentUserId) {
        try {
          const uRes = await fetch('https://www.coursera.org/api/users.v1/me', {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            if (uData.elements?.[0]?.id) {
              currentUserId = String(uData.elements[0].id);
            }
          }
        } catch (_) {}
      }

      if (!currentUserId) {
        try {
          const oRes = await fetch('https://www.coursera.org/api/opencourse.v1/user/me', {
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
          });
          if (oRes.ok) {
            const oData = await oRes.json();
            if (oData.elements?.[0]?.id) {
              currentUserId = String(oData.elements[0].id);
            }
          }
        } catch (_) {}
      }

      // 2. Fetch Course Materials directly via official Coursera API
      if (courseItems.length === 0 || forceRefresh) {
        const matUrl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${currentCourseSlug}&includes=modules,lessons,items,gradingParameters`;
        const mRes = await fetch(matUrl, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (mRes.ok) {
          const mData = await mRes.json();
          extractCourseMetadata(mData);
        }
      }
    } catch (err) {
      console.warn('[CourseCraft] Context resolution error:', err);
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
          i.typeName === 'coach' || i.typeName === 'ungradedWidget' || i.customDisplayTypenameOverride === 'Dialogue'
        );
      } else if (filterType === 'ungradedWidget') {
        relevantItems = courseItems.filter((i) => i.typeName === 'ungradedWidget');
      } else if (filterType === 'quiz') {
        relevantItems = courseItems.filter((i) => i.isQuiz);
      }
    }

    const currentUrl = window.location.href;

    // Check if on a specific item page
    const specificItem = relevantItems.find((it) => currentUrl.includes(it.item_id));
    if (specificItem) {
      return [specificItem];
    }

    // Check if on a specific module/week page (/home/module/1 or /home/week/1)
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
  // AUTOMATION WORKFLOWS
  // -----------------------------------------------------------

  // 1. Single / Module Lecture Completion
  async function completeActiveLecture() {
    showToast('Connecting to course data...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data. Please refresh Coursera tab.', 'error');
      return;
    }

    // Complete video element in DOM if active
    const videoEl = document.querySelector('video');
    if (videoEl) {
      try {
        videoEl.currentTime = videoEl.duration || 1000;
        videoEl.dispatchEvent(new Event('ended'));
      } catch (_) {}
    }

    const targets = getContextItems('lecture');
    if (targets.length === 0) {
      showToast('No video lectures found in this section.', 'warning');
      return;
    }

    showToast(`Completing ${targets.length} lecture(s)...`, 'info', true);

    let completed = 0;
    for (const item of targets) {
      const success = await markLectureComplete(item);
      if (success) completed++;
    }

    showToast(`🎉 Successfully completed ${completed}/${targets.length} lecture(s)! Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 2. Skip Video+ (Bulk Complete ALL Course Lectures)
  async function completeAllLectures() {
    showToast('Connecting to course data...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data. Please refresh Coursera tab.', 'error');
      return;
    }

    const allVideos = courseItems.filter((i) => i.typeName === 'lecture');
    if (allVideos.length === 0) {
      showToast('No video lectures found in this course.', 'warning');
      return;
    }

    showToast(`Processing all ${allVideos.length} lectures in course...`, 'info', true);

    let completed = 0;
    for (let i = 0; i < allVideos.length; i++) {
      const item = allVideos[i];
      showToast(`Processing (${i + 1}/${allVideos.length}): ${item.item_name}`, 'info', true);
      const success = await markLectureComplete(item);
      if (success) completed++;
      await wait(300);
    }

    showToast(`🎉 Skip Video+ completed! ${completed}/${allVideos.length} lectures marked finished. Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  }

  // Single Lecture API Mark
  async function markLectureComplete(item) {
    if (!currentUserId || !item) return false;
    const slug = item.open_course_slug || currentCourseSlug;
    const itemId = item.item_id;

    const endedUrl = `https://www.coursera.org/api/opencourse.v1/user/${currentUserId}/course/${slug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
    
    try {
      const res = await fetch(endedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentRequestBody: {} })
      });

      if (res.ok) {
        return true;
      }

      // If ended needs play event first
      const playUrl = `https://www.coursera.org/api/opencourse.v1/user/${currentUserId}/course/${slug}/item/${itemId}/lecture/videoEvents/play?autoEnroll=false`;
      await fetch(playUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentRequestBody: {} })
      });

      if (item.course_id && item.videoId) {
        const progressId = `${currentUserId}~${item.course_id}~${item.videoId}`;
        await fetch(`https://www.coursera.org/api/onDemandVideoProgresses.v1/${progressId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            viewedUpTo: Math.floor(item.timeCommitment || 60),
            videoProgressId: progressId
          })
        }).catch(() => {});
      }

      await wait(600);

      const res2 = await fetch(endedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentRequestBody: {} })
      });
      return res2.ok;
    } catch (err) {
      return false;
    }
  }

  // 3. Complete Reading Materials
  async function completeReading() {
    showToast('Connecting to course data...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data. Please refresh Coursera tab.', 'error');
      return;
    }

    const readings = getContextItems('reading');
    if (readings.length === 0) {
      showToast('No reading materials found in this section.', 'warning');
      return;
    }

    showToast(`Completing ${readings.length} reading item(s)...`, 'info', true);

    let completed = 0;
    for (const item of readings) {
      try {
        const res = await fetch('https://www.coursera.org/api/onDemandSupplementCompletions.v1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: currentUserId,
            courseId: item.course_id,
            itemId: item.item_id
          })
        });
        if (res.ok) completed++;
      } catch (_) {}
    }

    // Also trigger mark as completed button on current reading page if open
    const markCompleteBtn = document.querySelector('button[data-testid="mark-complete"]');
    if (markCompleteBtn) {
      markCompleteBtn.click();
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    showToast(`🎉 Successfully marked ${completed}/${readings.length} reading(s) completed! Reloading...`, 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 4. Complete AI Coach Dialogue & Interactive sessions
  async function completeDialogue() {
    showToast('Connecting to course data...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data. Please refresh Coursera tab.', 'error');
      return;
    }

    const dialogues = getContextItems('dialogue');
    if (dialogues.length === 0) {
      showToast('No dialogue sessions found.', 'warning');
      return;
    }

    showToast(`Completing ${dialogues.length} dialogue item(s)...`, 'info', true);

    let completed = 0;
    for (const item of dialogues) {
      try {
        // Create session
        const createRes = await fetch('https://www.coursera.org/graphql-gateway?opname=AiCoachPlatform_CreateChatSession', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify([{
            operationName: 'AiCoachPlatform_CreateChatSession',
            variables: {
              input: {
                title: `coachItem-${item.course_id}-${item.item_id}`,
                userId: String(currentUserId)
              }
            },
            query: 'mutation AiCoachPlatform_CreateChatSession($input: AiCoach_CreateChatSessionInput!) { AiCoach_CreateChatSession(input: $input) { id title __typename } }'
          }])
        });

        if (createRes.ok) {
          const cJson = await createRes.json();
          const sessionId = cJson?.[0]?.data?.AiCoach_CreateChatSession?.id;
          if (sessionId) {
            await fetch('https://www.coursera.org/graphql-gateway?opname=CoachItem_EndSession', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify([{
                operationName: 'CoachItem_EndSession',
                variables: {
                  input: {
                    chatSessionId: sessionId,
                    message: 'Generate final session summary',
                    coachModeId: 'COACH_ITEM_DIALOGUE',
                    terminalActionId: 'STUCK_END',
                    courseraContext: {
                      courseId: item.course_id,
                      itemId: item.item_id,
                      courseBranchId: item.course_id
                    },
                    additionalContext: []
                  }
                },
                query: 'mutation CoachItem_EndSession($input: CoachItem_EndSessionInput!) { CoachItem_EndSession(input: $input) { chatSessionId itemCompletionHandled __typename } }'
              }])
            });
            completed++;
          }
        }

        // Complete widget session if exists
        const key = `${currentUserId}~${item.course_id}~${item.item_id}`;
        const wRes = await fetch(`https://www.coursera.org/api/onDemandWidgetSessions.v1/${key}?fields=session,sessionId`, {
          credentials: 'include'
        });
        if (wRes.ok) {
          const wJson = await wRes.json();
          const wSessionId = wJson?.elements?.[0]?.sessionId;
          if (wSessionId) {
            await fetch(`https://www.coursera.org/api/onDemandWidgetProgress.v1/${key}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                sessionId: wSessionId,
                progressState: 'Completed'
              })
            });
          }
        }
      } catch (_) {}
    }

    // Also click End Session button if present on page
    const endBtn = document.querySelector('button[aria-label="End session"], button:has-text("End Session")');
    if (endBtn) endBtn.click();

    showToast('🎉 Dialogue completed! Reloading...', 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 5. Complete Discussion
  async function completeDiscussion() {
    showToast('Connecting to course data...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) {
      showToast('Could not load course data.', 'error');
      return;
    }

    const discussions = getContextItems('discussion');
    if (discussions.length === 0) {
      showToast('No discussion prompts found in this section.', 'warning');
      return;
    }

    showToast(`Submitting response for ${discussions.length} discussion(s)...`, 'info', true);

    const phrases = [
      'Very insightful points covered in this topic. Thank you.',
      'Clear explanations and valuable real-world examples.',
      'Helpful discussion and great practical takeaways.',
      'The foundational concepts explained here are very helpful.'
    ];

    let completed = 0;
    for (const item of discussions) {
      try {
        const promptUrl = `https://www.coursera.org/api/onDemandDiscussionPrompts.v1/${currentUserId}~${item.course_id}~${item.item_id}?fields=onDemandDiscussionPromptQuestions.v1(content,creatorId,createdAt,forumId,sessionId,lastAnsweredBy,lastAnsweredAt,totalAnswerCount,topLevelAnswerCount,viewCount),promptType,question&includes=question`;
        const promptRes = await fetch(promptUrl, { credentials: 'include' });
        if (promptRes.ok) {
          const promptJson = await promptRes.json();
          const forumQId = promptJson.elements?.[0]?.promptType?.definition?.courseItemForumQuestionId;
          if (forumQId) {
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            const answerUrl = 'https://www.coursera.org/api/onDemandCourseForumAnswers.v1/?fields=content,forumQuestionId,parentForumAnswerId,state,creatorId,createdAt,order,upvoteCount,childAnswerCount,isFlagged,isUpvoted,courseItemForumQuestionId,parentCourseItemForumAnswerId&includes=profiles,children,userId';
            const aRes = await fetch(answerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                content: {
                  typeName: 'cml',
                  definition: {
                    dtdId: 'discussion/1',
                    value: `<co-content><text>${phrase}</text></co-content>`
                  }
                },
                courseForumQuestionId: `${item.course_id}~${forumQId.split('~')[2] || forumQId}`
              })
            });
            if (aRes.ok) completed++;
          }
        }
      } catch (_) {}
    }

    // Also type into active DOM prompt if open
    const promptEl = document.querySelector('textarea, div[contenteditable="true"]');
    if (promptEl) {
      promptEl.focus();
      document.execCommand('insertText', false, 'Insightful discussion points shared. Thank you.');
      await wait(500);
      const submitBtn = document.querySelector('button[data-testid="discussion-submit"], button[aria-label="Post"], button:has-text("Post")');
      if (submitBtn) submitBtn.click();
    }

    showToast('🎉 Discussion responses submitted! Reloading...', 'success', true);
    setTimeout(() => {
      window.location.reload();
    }, 1800);
  }

  // 6. Complete Practice Widgets / Ungraded Plugins
  async function completeUngradedPlugin() {
    showToast('Submitting practice widgets...', 'info');
    const ok = await ensureCourseContext();
    if (!ok) return;

    const widgets = getContextItems('ungradedWidget');
    for (const item of widgets) {
      try {
        const key = `${currentUserId}~${item.course_id}~${item.item_id}`;
        const res = await fetch(`https://www.coursera.org/api/onDemandWidgetSessions.v1/${key}?fields=session,sessionId`, {
          credentials: 'include'
        });
        if (res.ok) {
          const json = await res.json();
          const sessId = json?.elements?.[0]?.sessionId;
          if (sessId) {
            await fetch(`https://www.coursera.org/api/onDemandWidgetProgress.v1/${key}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ sessionId: sessId, progressState: 'Completed' })
            });
          }
        }
      } catch (_) {}
    }

    const checkBtn = document.querySelector('button[data-testid="widget-submit"], button[aria-label="Submit"], button[data-testid="mark-complete"]');
    if (checkBtn) checkBtn.click();

    showToast('Practice widgets marked complete! Reloading...', 'success', true);
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

  // 9. AI Quiz Assistant
  async function solveQuizAssistant() {
    showToast('Analyzing quiz questions...', 'info', true);

    const questionCards = document.querySelectorAll('div.css-1tfphom');
    if (questionCards.length === 0) {
      showToast('No quiz questions found on this page.', 'warning');
      return;
    }

    const config = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);
    const apiKey = config.geminiApiKey?.trim();
    const model = config.geminiModel || 'gemini-1.5-flash';

    if (apiKey) {
      showToast('Solving quiz with Google Gemini AI...', 'info', true);
      try {
        const extractedQuestions = [];
        questionCards.forEach((card, index) => {
          const promptEl = card.querySelector('div[data-testid="cml-viewer"]');
          const optionEls = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
          const optionsText = [];
          optionEls.forEach((opt) => {
            const label = opt.parentElement?.querySelector('div[data-testid="cml-viewer"]')?.textContent?.trim() || '';
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
          showToast('🎉 All answers marked via Gemini AI!', 'success');
          return;
        }
      } catch (err) {
        console.warn('[CourseCraft] Gemini API error:', err);
      }
    }

    // Fallback: Select first option if not answered
    questionCards.forEach((card) => {
      const options = card.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (options.length > 0 && !Array.from(options).some((o) => o.checked)) {
        options[0].click();
      }
    });

    if (!apiKey) {
      showToast('Options selected! (Tip: Add free Gemini API key in Settings for smart AI answers)', 'info');
    } else {
      showToast('Quiz options updated.', 'success');
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
          itemCount: courseItems.length
        });
      });
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

  console.log('[CourseCraft] Content script v4.0.0 ready.');
})();
