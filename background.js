console.log('QuickSlash background initialized');

// Side Panel Open Helper (with timeout for unresponsive environments like Atlas)
const runSidePanelOperation = async (operation) => {
  try {
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Operation timed out'));
      }, 1000);

      operation(() => {
        clearTimeout(timeoutId);
        const error = chrome.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve();
      });
    });
    return true;
  } catch (error) {
    console.warn('QuickSlash side panel operation failed:', error);
    return false;
  }
};

const openSidePanel = async (tabId) => {
  const success = await runSidePanelOperation((done) => {
    chrome.sidePanel.open({ tabId }, done);
  });

  if (!success) {
    console.warn('QuickSlash: Side Panel open failed.');
  }
  return success;
};

chrome.runtime.onInstalled.addListener(async () => {
  // Set default panel behavior
  await chrome.sidePanel.setOptions({
    path: 'popup/index.html',
    enabled: true
  });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await openSidePanel(tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'QUICKSLASH_AUTOFILL_PAGE') {
    return false;
  }

  handleAutofillPage(message).then(sendResponse);
  return true;
});

async function handleAutofillPage(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { ok: false, message: 'No active page found.' };
    }

    const frames = await getTabFrames(tab.id);
    const targets = frames.length ? frames : [{ frameId: 0 }];
    const results = await Promise.all(
      targets.map((frame) => sendAutofillToFrame(tab.id, frame.frameId, message.snippets))
    );
    const successful = results.filter(Boolean);
    if (!successful.length) {
      return { ok: false, message: 'Autofill is not available on this page.' };
    }
    return successful.reduce(
      (total, item) => ({
        ok: true,
        scanned: total.scanned + (item.scanned || 0),
        matched: total.matched + (item.matched || 0),
        filled: total.filled + (item.filled || 0),
        skippedNonEmpty: total.skippedNonEmpty + (item.skippedNonEmpty || 0)
      }),
      { ok: true, scanned: 0, matched: 0, filled: 0, skippedNonEmpty: 0 }
    );
  } catch (error) {
    console.warn('QuickSlash autofill failed:', error);
    return { ok: false, message: 'Autofill failed on this page.' };
  }
}

async function getTabFrames(tabId) {
  try {
    return await chrome.webNavigation.getAllFrames({ tabId });
  } catch (error) {
    console.warn('QuickSlash could not inspect frames:', error);
    return [];
  }
}

async function sendAutofillToFrame(tabId, frameId, snippets) {
  try {
    return await chrome.tabs.sendMessage(
      tabId,
      { type: 'QUICKSLASH_AUTOFILL_FRAME', snippets },
      { frameId }
    );
  } catch (_error) {
    return null;
  }
}
