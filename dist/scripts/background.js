/**
 * CourseCraft - Background Service Worker
 * Version: 4.0.0
 * Pure client-side background tasks: video progress processing, quiz tab pooling,
 * session forwarding, and options routing.
 */

'use strict';

const COURSERA_API = 'https://www.coursera.org/api';
const DEFAULT_LOCKING_UA = 'coursera-locking-browser/0.6.6';

// Helper for delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Send a toast notification to a specific tab
async function sendTabToast(tabId, message, type = 'info', keep = false) {
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'SHOW_TOAST',
      payload: { message, type, keep }
    });
  } catch (err) {
    // Tab might not have content script ready
  }
}

// Coursera Video Event Caller (Play & Ended)
async function sendVideoEvent(userId, item, eventType = 'play', retries = 3, retryDelay = 2000) {
  const url = `${COURSERA_API}/opencourse.v1/user/${userId}/course/${item.open_course_slug}/item/${item.item_id}/lecture/videoEvents/${eventType}?autoEnroll=false`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentRequestBody: {} })
      });

      if (eventType === 'play' && response.ok) return true;

      const data = await response.json().catch(() => ({}));
      const progressState = data?.itemProgress?.progressState;
      if (response.ok && progressState === 'Completed') return true;

      if (eventType === 'ended' && (response.status === 400 || progressState === 'Started') && attempt < retries) {
        await delay(retryDelay);
        continue;
      }
      return response.ok;
    } catch (err) {
      if (attempt < retries) {
        await delay(retryDelay);
      }
    }
  }
  return false;
}

// Update OnDemand Video Progress
async function updateVideoProgress(userId, courseId, videoId, timeCommitment) {
  const progressId = `${userId}~${courseId}~${videoId}`;
  const url = `${COURSERA_API}/onDemandVideoProgresses.v1/${progressId}`;
  try {
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        viewedUpTo: Math.floor(timeCommitment || 0),
        videoProgressId: progressId
      })
    });
    return true;
  } catch (err) {
    return false;
  }
}

// Quiz tab pool state
const quizTabPool = new Map();
let quizQueue = [];
let quizConcurrency = 2;
let isQuizPoolActive = false;
let parentQuizTabId = null;

async function processQuizPool() {
  if (!isQuizPoolActive) return;

  while (quizTabPool.size < quizConcurrency && quizQueue.length > 0) {
    const quizItem = quizQueue.shift();
    try {
      const tab = await chrome.tabs.create({ url: quizItem.url, active: false });
      if (tab.id) {
        quizItem.tabId = tab.id;
        quizTabPool.set(tab.id, quizItem);
      }
    } catch (err) {
      console.warn('[CourseCraft] Failed to open quiz tab:', quizItem.itemId, err);
    }
  }

  if (quizTabPool.size === 0 && quizQueue.length === 0 && isQuizPoolActive) {
    isQuizPoolActive = false;
    if (parentQuizTabId) {
      sendTabToast(parentQuizTabId, 'All automated quizzes completed!', 'success');
      setTimeout(() => {
        chrome.tabs.reload(parentQuizTabId).catch(() => {});
      }, 1500);
    }
  }
}

// Chrome Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;
  const tabId = sender?.tab?.id;

  // 1. Bulk Skip Videos
  if (action === 'SKIP_VIDEO_PLUS') {
    (async () => {
      const userId = request.payload?.userId;
      const items = request.payload?.items || [];
      
      if (!userId || items.length === 0) {
        sendResponse({ success: false, error: 'No items provided' });
        return;
      }

      try {
        await sendTabToast(tabId, `Processing ${items.length} videos...`, 'info', true);
        
        let completed = 0;
        for (const item of items) {
          try {
            await sendVideoEvent(userId, item, 'play');
            if (item.course_id && item.videoId) {
              await updateVideoProgress(userId, item.course_id, item.videoId, item.timeCommitment);
            }
            await delay(1200);
            await sendVideoEvent(userId, item, 'ended');
            completed++;
            await sendTabToast(tabId, `Completed ${completed}/${items.length} videos`, 'info', true);
          } catch (itemErr) {
            console.error('[CourseCraft] Error processing video:', item.item_name, itemErr);
          }
        }

        await sendTabToast(tabId, 'All videos completed successfully!', 'success');
        sendResponse({ success: true, count: completed });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // 2. Open Settings / Options Page
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

  // 4. Open Background Tab
  if (action === 'OPEN_TAB' && request.url) {
    chrome.tabs.create({ url: request.url, active: false });
    sendResponse({ success: true });
    return true;
  }

  // 5. Close Tab
  if (action === 'CLOSE_TAB' && tabId) {
    chrome.tabs.remove(tabId).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  // 6. Quiz Pool Controls
  if (action === 'START_QUIZ_POOL') {
    parentQuizTabId = tabId || null;
    quizConcurrency = Math.min(Math.max(request.concurrency || 2, 1), 5);
    quizQueue = (request.quizzes || []).map((q) => ({
      itemId: q.itemId,
      name: q.name || q.itemId,
      slug: q.slug,
      url: `https://www.coursera.org/learn/${request.openCourseSlug}/assignment-submission/${q.itemId}/${q.slug}/attempt`,
      openCourseSlug: request.openCourseSlug
    }));
    quizTabPool.clear();
    isQuizPoolActive = true;
    processQuizPool();
    sendResponse({ success: true, count: quizQueue.length });
    return true;
  }

  if (action === 'STOP_QUIZ_POOL') {
    isQuizPoolActive = false;
    quizQueue = [];
    for (const [id] of quizTabPool) {
      chrome.tabs.remove(id).catch(() => {});
    }
    quizTabPool.clear();
    sendResponse({ success: true });
    return true;
  }

  if (action === 'GET_QUIZ_POOL_STATUS') {
    sendResponse({ active: isQuizPoolActive, remaining: quizQueue.length, running: quizTabPool.size });
    return true;
  }

  // 7. Get Locking User Agent
  if (action === 'COR_RPC_GET_UA') {
    sendResponse({ ua: DEFAULT_LOCKING_UA });
    return true;
  }

  return false;
});

// Clean up quiz tabs if closed by user
chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (quizTabPool.has(closedTabId)) {
    quizTabPool.delete(closedTabId);
    processQuizPool();
  }
});

// Forward URL change notifications to content script
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('coursera.org')) {
    chrome.tabs.sendMessage(tabId, {
      message: 'urlChanged',
      url: tab.url
    }).catch(() => {});
  }
});

// Keyboard Commands Listener
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open_popup_1' || command === 'open_popup_2') {
    chrome.action.openPopup().catch(() => {});
  }
});
