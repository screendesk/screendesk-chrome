import fixWebmDuration from "fix-webm-duration";
import { default as fixWebmDurationFallback } from "webm-duration-fix";

import {
  sendMessageTab,
  focusTab,
  removeTab,
  getCurrentTab,
  createTab,
} from "./modules/tabHelper";

import localforage from "localforage";

localforage.config({
  driver: localforage.INDEXEDDB,
  name: "screendesk",
  version: 1,
});

let signInWindowId = null;

// Get chunks store
const chunksStore = localforage.createInstance({
  name: "chunks",
});

// Get localDirectory store
const localDirectoryStore = localforage.createInstance({
  name: "localDirectory",
});

const startAfterCountdown = async () => {
  // Check that the recording didn't get dismissed
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { offscreen } = await chrome.storage.local.get(["offscreen"]);

  if (recordingTab != null || offscreen) {
    chrome.storage.local.set({ recording: true });
    startRecording();
  }
};


// DONE
// IMPORTANT
// TODO: this handles the countdown. Updates the page that is pinned.
// This needs to be changed if I want to open the
const resetActiveTab = async () => {
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);

  // Check if activeTab exists
  chrome.tabs.get(activeTab, async (tab) => { // Marked this callback as async
    if (tab) {
      // Focus the window
      chrome.windows.update(tab.windowId, { focused: true }, async () => { // Also consider if async is needed here
        chrome.tabs.update(activeTab, {
          active: true,
          selected: true,
          highlighted: true,
        });
        focusTab(activeTab);
        sendMessageTab(activeTab, { type: "ready-to-record" });

        // Correctly using await inside an async function
        const { countdown } = await chrome.storage.local.get(["countdown"]);
        if (countdown) {
          setTimeout(() => {
            startAfterCountdown();
          }, 3500);
        } else {
          setTimeout(() => {
            startAfterCountdown();
          }, 500);
        }
      });
    }
  });
};


const resetActiveTabRestart = async () => {
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  focusTab(activeTab).then(async () => {
    sendMessageTab(activeTab, { type: "ready-to-record" });

    // Check if countdown is set, if so start recording after 3 seconds
    const { countdown } = await chrome.storage.local.get(["countdown"]);
    if (countdown) {
      setTimeout(() => {
        startAfterCountdown();
      }, 3000);
    } else {
      startRecording();
    }
  });
};

const startRecording = async () => {
  chrome.storage.local.set({
    recordingStartTime: Date.now(),
    restarting: false,
    recording: true,
  });

  // Check if customRegion is set
  const { customRegion } = await chrome.storage.local.get(["customRegion"]);

  if (customRegion) {
    sendMessageRecord({ type: "start-recording-tab", region: true });
  } else {
    sendMessageRecord({ type: "start-recording-tab" });
  }
  chrome.action.setIcon({ path: "assets/recording-logo.png" });
  // Set up alarm if set in storage
  const { alarm } = await chrome.storage.local.get(["alarm"]);
  const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
  if (alarm) {
    const seconds = parseFloat(alarmTime);
    chrome.alarms.create("recording-alarm", { delayInMinutes: seconds / 60 });
  }
};

// Detect commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "start-recording") {
    // get active tab
    const activeTab = await getCurrentTab();

    // Check if it's possible to inject into content (not a chrome:// page, new tab, etc)
    if (
      !(
        (navigator.onLine === false &&
          !activeTab.url.includes("/playground.html") &&
          !activeTab.url.includes("/setup.html")) ||
        activeTab.url.startsWith("chrome://") ||
        (activeTab.url.startsWith("chrome-extension://") &&
          !activeTab.url.includes("/playground.html") &&
          !activeTab.url.includes("/setup.html"))
      ) &&
      !activeTab.url.includes("stackoverflow.com/") &&
      !activeTab.url.includes("chrome.google.com/webstore") &&
      !activeTab.url.includes("chromewebstore.google.com")
    ) {
      sendMessageTab(activeTab.id, { type: "start-stream" });
    } else {
      chrome.tabs
        .create({
          url: "playground.html",
          active: true,
        })
        .then((tab) => {
          chrome.storage.local.set({ activeTab: tab.id });
          // Wait for the tab to load
          chrome.tabs.onUpdated.addListener(function _(tabId, changeInfo, tab) {
            if (tabId === tab.id && changeInfo.status === "complete") {
              setTimeout(() => {
                sendMessageTab(tab.id, { type: "start-stream" });
              }, 500);
              chrome.tabs.onUpdated.removeListener(_);
            }
          });
        });
    }
  } else if (command === "cancel-recording") {
    // get active tab
    const activeTab = await getCurrentTab();
    sendMessageTab(activeTab.id, { type: "cancel-recording" });
  } else if (command == "pause-recording") {
    const activeTab = await getCurrentTab();
    sendMessageTab(activeTab.id, { type: "pause-recording" });
  }
});

const handleAlarm = async (alarm) => {
  if (alarm.name === "recording-alarm") {
    // Check if recording
    const { recording } = await chrome.storage.local.get(["recording"]);
    if (recording) {
      stopRecording();
      const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
      sendMessageTab(recordingTab, { type: "stop-recording-tab" });
      const { activeTab } = await chrome.storage.local.get(["activeTab"]);
      sendMessageTab(activeTab, { type: "stop-recording-tab" });
      const currentTab = await getCurrentTab();
      sendMessageTab(currentTab.id, { type: "stop-recording-tab" });
    }
    chrome.alarms.clear("recording-alarm");
  }
};

const alarmListener = (alarm) => {
  handleAlarm(alarm);
};

const addAlarmListener = () => {
  if (!chrome.alarms.onAlarm.hasListener(alarmListener)) {
    chrome.alarms.onAlarm.addListener(alarmListener);
  }
};

// Check if the permission is granted
if (chrome.permissions) {
  chrome.permissions.contains({ permissions: ["alarms"] }, (result) => {
    if (result) {
      addAlarmListener();
    }
  });
}

const onActivated = async (activeInfo) => {
  try {
    // Get tab with error handling
    const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
    if (!tab) return; // Exit if tab doesn't exist

    // Skip if URL is restricted
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      return;
    }

    const { recordingStartTime, recording, restarting } = await chrome.storage.local.get([
      "recordingStartTime",
      "recording",
      "restarting"
    ]);

    // Rest of your existing onActivated logic...
  } catch (error) {
    console.error('Error in onActivated:', error);
  }
};

// Modify tab event listeners to include error handling
chrome.tabs.onActivated.addListener((activeInfo) => {
  onActivated(activeInfo).catch(console.error);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  try {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return;
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      windowId: windowId,
    }).catch(() => [null]);

    if (activeTab && isValidTab(activeTab)) {
      onActivated({ tabId: activeTab.id });
    }
  } catch (error) {
    console.error('Error in onFocusChanged:', error);
  }
});

// Add helper function to check if a tab is valid
const isValidTab = (tab) => {
  return tab && tab.url &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('chrome-extension://') &&
    !tab.url.startsWith('about:');
};

// Check when a page is activated
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    // Check if not recording (needs to hide the extension)
    const { recording } = await chrome.storage.local.get(["recording"]);
    const { restarting } = await chrome.storage.local.get(["restarting"]);
    const { tabRecordedID } = await chrome.storage.local.get(["tabRecordedID"]);

    if (!recording && !restarting) {
      sendMessageTab(tabId, { type: "recording-ended" });
    } else if (recording && tabRecordedID && tabRecordedID == tabId) {
      sendMessageTab(tabId, { type: "recording-check", force: true });
    }

    const { recordingStartTime } = await chrome.storage.local.get([
      "recordingStartTime",
    ]);
    // Get tab
    const tab = await chrome.tabs.get(tabId);

    if (recordingStartTime) {
      // Check if alarm
      const { alarm } = await chrome.storage.local.get(["alarm"]);
      if (alarm) {
        // Send remaining seconds
        const { alarmTime } = await chrome.storage.local.get(["alarmTime"]);
        const seconds = parseFloat(alarmTime);
        const time = Math.floor((Date.now() - recordingStartTime) / 1000);
        const remaining = seconds - time;
        sendMessageTab(tabId, {
          type: "time",
          time: remaining,
        });
      } else {
        const time = Math.floor((Date.now() - recordingStartTime) / 1000);
        sendMessageTab(tabId, { type: "time", time: time });
      }
    }

    const commands = await chrome.commands.getAll();
    sendMessageTab(tabId, {
      type: "commands",
      commands: commands,
    });

    // Check if tab is playground.html
    if (
      tab.url.includes(chrome.runtime.getURL("playground.html")) &&
      changeInfo.status === "complete"
    ) {
      sendMessageTab(tab.id, { type: "toggle-popup" });
    }
  }
});

const sendChunks = async (override = false) => {
  console.log("sendChunks started with override:", override);
  try {
    const chunks = [];
    console.log("Preparing to iterate over chunks store");
    // Iterate over the chunks stored and collect them into an array.
    await chunksStore.iterate((value, key) => {
      console.log(`Processing chunk with key: ${key}, timestamp: ${value.timestamp}`);
      chunks.push(value);
    });

    console.log(`Total chunks found: ${chunks.length}`);
    if (chunks.length === 0) {
      console.log("No chunks found, returning early");
      return;
    }

    // Sort the chunks by their timestamp to ensure correct order.
    console.log("Sorting chunks by timestamp");
    chunks.sort((a, b) => a.timestamp - b.timestamp);
    console.log("Chunks sorted, first timestamp:", chunks[0].timestamp, "last timestamp:", chunks[chunks.length-1].timestamp);

    // Filter and process chunks to prepare for blob creation.
    console.log("Filtering duplicate chunks");
    const filteredChunks = chunks
      .filter((chunk, index, array) => {
        const isValid = index === 0 || chunk.timestamp > array[index - 1].timestamp;
        if (!isValid) {
          console.log(`Filtering out duplicate chunk at index ${index} with timestamp ${chunk.timestamp}`);
        }
        return isValid;
      })
      .map(chunk => {
        console.log(`Mapping chunk with timestamp ${chunk.timestamp}`);
        return chunk.chunk;
      });

    console.log(`After filtering: ${filteredChunks.length} chunks remain`);
    if (filteredChunks.length === 0) {
      console.error('No valid video chunks to upload after filtering');
      throw new Error('No valid video chunks to upload.');
    }

    // Create a Blob from the filtered chunks.
    console.log("Creating blob from filtered chunks");
    const blob = new Blob(filteredChunks, { type: "video/webm; codecs=vp8, opus" });
    console.log(`Blob created, size: ${blob.size} bytes`);

    // Check the OS type
    const isWindows10 = navigator.userAgent.includes("Windows NT 10.0");
    console.log("Is Windows 10:", isWindows10);

    // Retrieve the recordingDuration
    console.log("Getting recording duration from storage");
    const { recordingDuration } = await chrome.storage.local.get("recordingDuration");
    console.log("Recording duration:", recordingDuration);

    let fixedBlob;
    if (recordingDuration && recordingDuration > 0) {
      console.log("Valid recording duration found, fixing webm duration");
      if (!isWindows10) {
        console.log("Using standard fixWebmDuration");
        // Assuming fixWebmDuration is properly defined elsewhere
        fixedBlob = await fixWebmDuration(blob, parseInt(recordingDuration));
      } else {
        console.log("Using fallback fixWebmDurationFallback for Windows 10");
        // Fallback method if on Windows 10
        fixedBlob = await fixWebmDurationFallback(blob, { type: "video/webm; codecs=vp8, opus" });
      }
      console.log("Webm duration fixed");
    } else {
      console.log("No valid duration, using original blob");
      fixedBlob = blob; // Use the original blob if duration is not specified or invalid
    }
    console.log(`Fixed blob size: ${fixedBlob.size} bytes`);

    // Create a simple auth handler for background script
    const authHandler = {
      async getAccessToken() {
        const result = await chrome.storage.local.get(['accessToken']);
        return result.accessToken;
      },

      async getRefreshToken() {
        const result = await chrome.storage.local.get(['refreshToken']);
        return result.refreshToken;
      },

      async refreshAccessToken() {
        const refreshToken = await this.getRefreshToken();

        if (!refreshToken) {
          console.error('No refresh token available');
          return false;
        }

        try {
          console.log('Attempting to refresh access token...');
          const response = await fetch('http://localhost:3001/chrome/refresh_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              refresh_token: refreshToken
            })
          });

          if (response.ok) {
            const data = await response.json();
            console.log('Token refresh successful');
            await chrome.storage.local.set({
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              tokenTimestamp: Date.now()
            });
            return true;
          } else {
            console.error('Token refresh failed:', response.status);
            return false;
          }
        } catch (error) {
          console.error('Token refresh error:', error);
          return false;
        }
      },

      async authenticatedFetch(url, options = {}) {
        const accessToken = await this.getAccessToken();

        if (!accessToken) {
          throw new Error('No access token available');
        }

        // Add auth header
        options.headers = {
          ...options.headers,
          'Authorization': `Bearer ${accessToken}`
        };

        console.log('Making authenticated request to:', url);
        let response = await fetch(url, options);

        // If unauthorized, try to refresh token
        if (response.status === 401) {
          console.log('Received 401, attempting token refresh...');
          const refreshed = await this.refreshAccessToken();

          if (refreshed) {
            // Retry with new token
            const newAccessToken = await this.getAccessToken();
            options.headers['Authorization'] = `Bearer ${newAccessToken}`;
            console.log('Retrying request with new token...');
            response = await fetch(url, options);
          } else {
            // Refresh failed, clear tokens
            console.log('Token refresh failed, clearing tokens');
            await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenTimestamp', 'auth_token']);
            throw new Error('Authentication required');
          }
        }

        return response;
      }
    };

    // Upload the fixed Blob to the server.
    console.log("Creating FormData for upload");
    const formData = new FormData();
    formData.append("recording[file]", fixedBlob, "video.webm");
    console.log("FormData created, starting authenticated upload to server");

    // Use authenticated fetch with automatic token refresh
    const response = await authHandler.authenticatedFetch("http://localhost:3001/chrome/upload", {
      method: "POST",
      body: formData,
    });
    console.log("Upload response status:", response.status);

    if (!response.ok) {
      console.error(`HTTP error during upload! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Handle the response and create a new tab with the recording URL.
    console.log("Parsing response JSON");
    const data = await response.json();
    console.log("Response data:", data);
    // let url = "http://localhost:3001/recordings/" + data.recording_uuid;
    let url = "http://localhost:3001/recordings/" + data.recording_uuid;
    console.log("Opening new tab with URL:", url);
    chrome.tabs.create({ url: url });

    // Update local storage with the recording UUID.
    console.log("Saving recording UUID to storage:", data.recording_uuid);
    chrome.storage.local.set({ recording_uuid: data.recording_uuid });
    console.log("sendChunks completed successfully");
  } catch (error) {
    console.error("Error in sendChunks:", error);
    console.error("Error stack:", error.stack);
  }
};

const stopRecording = async () => {
  chrome.storage.local.set({ restarting: false });
  const { recordingStartTime } = await chrome.storage.local.get([
    "recordingStartTime",
  ]);
  let duration = Date.now() - recordingStartTime;
  const maxDuration = 7 * 60 * 1000;

  if (recordingStartTime === 0) {
    duration = 0;
  }
  chrome.storage.local.set({
    recording: false,
    recordingDuration: duration,
    tabRecordedID: null,
  });

  chrome.storage.local.set({ recordingStartTime: 0 });
  handleRecordingComplete();

  sendChunks();
  chrome.action.setIcon({ path: "assets/icon-34.png" });

  // Rest of the existing code...
  const { wasRegion } = await chrome.storage.local.get(["wasRegion"]);
  if (wasRegion) {
    chrome.storage.local.set({ wasRegion: false, region: true });
  }

  chrome.alarms.clear("recording-alarm");
  discardOffscreenDocuments();
};

// For some reason without this the service worker doesn't always work
chrome.runtime.onStartup.addListener(() => {
  console.log(`Starting...`);
});

chrome.action.onClicked.addListener(async (tab) => {
  // Check if recording first
  const { recording } = await chrome.storage.local.get(["recording"]);
  if (recording) {
    stopRecording();
    sendMessageRecord({ type: "stop-recording-tab" });
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    // Check if actual tab
    chrome.tabs.get(activeTab, (t) => {
      if (t) {
        sendMessageTab(activeTab, { type: "stop-recording-tab" });
      } else {
        sendMessageTab(tab.id, { type: "stop-recording-tab" });
        chrome.storage.local.set({ activeTab: tab.id });
      }
    });
    return; // Exit early when recording
  }

  // Check if it's possible to inject into content (not a chrome:// page, new tab, etc)
  const canInjectContent = !(
    (navigator.onLine === false &&
      !tab.url.includes("/playground.html") &&
      !tab.url.includes("/setup.html")) ||
    tab.url.startsWith("chrome://") ||
    (tab.url.startsWith("chrome-extension://") &&
      !tab.url.includes("/playground.html") &&
      !tab.url.includes("/setup.html"))
  ) &&
  !tab.url.includes("stackoverflow.com/") &&
  !tab.url.includes("chrome.google.com/webstore") &&
  !tab.url.includes("chromewebstore.google.com");

  if (canInjectContent) {
    // Valid tab - check if extension is currently visible
    sendMessageTab(tab.id, { type: "check-extension-visibility" }, (response) => {
      if (response && response.isVisible) {
        // Extension is visible, just hide it
        sendMessageTab(tab.id, { type: "hide-extension" });
      } else {
        // Extension is hidden, set active tab and check auth first before showing
        chrome.storage.local.set({ activeTab: tab.id });
        sendMessageTab(tab.id, { type: "check-auth-and-show" });
      }
    }, () => {
      // Content script not available, set active tab and check auth
      chrome.storage.local.set({ activeTab: tab.id });
      chrome.runtime.sendMessage({type: "check-auth-before-show"});
    });
  } else {
    // Invalid tab - create playground tab and check auth
    chrome.tabs
      .create({
        url: "playground.html",
        active: true,
      })
      .then((newTab) => {
        chrome.storage.local.set({ activeTab: newTab.id });
        // Check auth before showing extension in the new tab
        chrome.runtime.sendMessage({type: "check-auth-before-show"});
      });
  }

  const { firstTime } = await chrome.storage.local.get(["firstTime"]);

  if (firstTime && tab.url.includes(chrome.runtime.getURL("setup.html"))) {
    chrome.storage.local.set({ firstTime: false });
    // Send message to active tab
    const activeTab = await getCurrentTab();
    sendMessageTab(activeTab.id, { type: "setup-complete" });
  }
});

chrome.runtime.onMessageExternal.addListener(
  function(request, sender, sendResponse) {
    if (request.action === "authToken") {
      // Handle the old single token format for backward compatibility
      console.log("Received old format auth token from external:", request.token);
      console.log("Token type:", typeof request.token);
      console.log("Token length:", request.token ? request.token.length : 'N/A');
      console.log("Token preview:", request.token ? request.token.substring(0, 20) + '...' : 'N/A');

      chrome.storage.local.set({
        accessToken: request.token,
        // Clear old auth_token if it exists
        auth_token: null
      }, function() {
        console.log("Legacy token stored as accessToken.");

        // Close the sign in window after 3 seconds
        setTimeout(() => {
          if (signInWindowId) {
            chrome.windows.remove(signInWindowId, () => {
              signInWindowId = null;
            });
          }
        }, 3000);

        // After successful authentication, show the extension interface
        chrome.runtime.sendMessage({type: "show-extension-after-auth"});
      });
    } else if (request.action === "authTokens") {
      // Handle the new dual token format
      console.log("Received access and refresh tokens from external");
      console.log("Access token:", request.accessToken ? request.accessToken.substring(0, 20) + '...' : 'N/A');
      console.log("Refresh token:", request.refreshToken ? request.refreshToken.substring(0, 20) + '...' : 'N/A');
      console.log("Access token length:", request.accessToken ? request.accessToken.length : 'N/A');
      console.log("Refresh token length:", request.refreshToken ? request.refreshToken.length : 'N/A');

      chrome.storage.local.set({
        accessToken: request.accessToken,
        refreshToken: request.refreshToken,
        tokenTimestamp: Date.now(),
        // Clear old auth_token if it exists
        auth_token: null
      }, function() {
        console.log("Access and refresh tokens stored successfully.");

        // Verify the tokens were stored correctly
        chrome.storage.local.get(['accessToken', 'refreshToken'], function(result) {
          console.log("Verification - stored access token:", result.accessToken ? result.accessToken.substring(0, 20) + '...' : 'N/A');
          console.log("Verification - stored refresh token:", result.refreshToken ? result.refreshToken.substring(0, 20) + '...' : 'N/A');
        });

        // Close the sign in window after 3 seconds
        setTimeout(() => {
          if (signInWindowId) {
            chrome.windows.remove(signInWindowId, () => {
              signInWindowId = null;
            });
          }
        }, 3000);

        // After successful authentication, show the extension interface
        chrome.runtime.sendMessage({type: "show-extension-after-auth"});
      });
    }
  }
);

const restartActiveTab = async () => {
  const activeTab = await getCurrentTab();
  sendMessageTab(activeTab.id, { type: "ready-to-record" });
};

const getStreamingData = async () => {
  const {
    micActive,
    defaultAudioInput,
    defaultAudioOutput,
    defaultVideoInput,
    systemAudio,
    recordingType,
  } = await chrome.storage.local.get([
    "micActive",
    "defaultAudioInput",
    "defaultAudioOutput",
    "defaultVideoInput",
    "systemAudio",
    "recordingType",
  ]);

  return {
    micActive,
    defaultAudioInput,
    defaultAudioOutput,
    defaultVideoInput,
    systemAudio,
    recordingType,
  };
};

const handleDismiss = async () => {
  chrome.storage.local.set({ restarting: true });
  const { region } = await chrome.storage.local.get(["region"]);
  if (!region) {
    const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
    removeTab(sandboxTab);
  }
  // Check if wasRegion is set
  const { wasRegion } = await chrome.storage.local.get(["wasRegion"]);
  if (wasRegion) {
    chrome.storage.local.set({ wasRegion: false, region: true });
  }
  chrome.action.setIcon({ path: "assets/icon-34.png" });
};

// Need to make sure we don't open the editor.html
const handleRestart = async () => {
  chrome.storage.local.set({ restarting: true });

  // Check if Chrome version is 109 or below
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      editor_url = "editorfallback.html";
    }
  }
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  removeTab(sandboxTab);
  chrome.tabs.create(
    {
      url: editor_url,
      index: 1,
      pinned: true,
      active: false,
    },
    (tab) => {
      chrome.storage.local.set({ sandboxTab: tab.id });
      chrome.tabs.onUpdated.addListener(function _(tabId, changeInfo, tab) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          resetActiveTabRestart();
        }
      });
    }
  );
};

const sendMessageRecord = async (message) => {
  // Send a message to the recording tab or offscreen recording document, depending on which was created
  chrome.storage.local.get(["recordingTab", "offscreen"], (result) => {
    if (result.offscreen) {
      chrome.runtime.sendMessage(message);
    } else {
      // Get the recording tab first before sending the message
      sendMessageTab(result.recordingTab, message);
    }
  });
};

const initBackup = async (request, id) => {
  const { backupTab } = await chrome.storage.local.get(["backupTab"]);
  const backupURL = chrome.runtime.getURL("backup.html");

  if (backupTab) {
    chrome.tabs.get(backupTab, (tab) => {
      if (tab) {
        sendMessageTab(tab.id, {
          type: "init-backup",
          request: request,
          tabId: id,
        });
      } else {
        chrome.tabs.create(
          {
            url: backupURL,
            active: true,
            pinned: true,
            index: 0,
          },
          (tab) => {
            chrome.storage.local.set({ backupTab: tab.id });
            chrome.tabs.onUpdated.addListener(function _(
              tabId,
              changeInfo,
              updatedTab
            ) {
              // Check if recorder tab has finished loading
              if (tabId === tab.id && changeInfo.status === "complete") {
                sendMessageTab(tab.id, {
                  type: "init-backup",
                  request: request,
                  tabId: id,
                });
                chrome.tabs.onUpdated.removeListener(_);
              }
            });
          }
        );
      }
    });
  } else {
    chrome.tabs.create(
      {
        url: backupURL,
        active: true,
        pinned: true,
        index: 0,
      },
      (tab) => {
        chrome.storage.local.set({ backupTab: tab.id });
        chrome.tabs.onUpdated.addListener(function _(
          tabId,
          changeInfo,
          updatedTab
        ) {
          // Check if recorder tab has finished loading
          if (tabId === tab.id && changeInfo.status === "complete") {
            sendMessageTab(tab.id, {
              type: "init-backup",
              request: request,
              tabId: id,
            });
            chrome.tabs.onUpdated.removeListener(_);
          }
        });
      }
    );
  }
};

const offscreenDocument = async (request, tabId = null) => {
  const { backup } = await chrome.storage.local.get(["backup"]);
  let activeTab = await getCurrentTab();
  if (tabId !== null) {
    activeTab = await chrome.tabs.get(tabId);
  }
  chrome.storage.local.set({
    activeTab: activeTab.id,
    tabRecordedID: null,
    memoryError: false,
  });

  // Check activeTab URL
  if (activeTab.url.includes(chrome.runtime.getURL("playground.html"))) {
    chrome.storage.local.set({ tabPreferred: true });
  } else {
    chrome.storage.local.set({ tabPreferred: false });
  }

  // Close all offscreen documents (if chrome.offscreen is available)
  try {
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (offscreenDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {}

  if (request.region) {
    if (tabId !== null) {
      // Navigate to the tab
      chrome.tabs.update(tabId, { active: true });
    }
    chrome.storage.local.set({
      recordingTab: activeTab.id,
      offscreen: false,
      region: true,
    });

    if (request.customRegion) {
      sendMessageRecord({
        type: "loaded",
        request: request,
        backup: backup,
        region: true,
      });
    } else {
      try {
        // This is following the steps from this page, but it still doesn't work :( https://developer.chrome.com/docs/extensions/mv3/screen_capture/#audio-and-video-offscreen-doc
        throw new Error("Exit offscreen recording");
        const existingContexts = await chrome.runtime.getContexts({});

        const offDocument = existingContexts.find(
          (c) => c.contextType === "OFFSCREEN_DOCUMENT"
        );

        if (offDocument) {
          // If an offscreen document is already open, close it.
          await chrome.offscreen.closeDocument();
        }

        // Create an offscreen document.
        await chrome.offscreen.createDocument({
          url: "recorderoffscreen.html",
          reasons: ["USER_MEDIA", "AUDIO_PLAYBACK", "DISPLAY_MEDIA"],
          justification:
            "Recording from getDisplayMedia API and tabCapture API",
        });

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: activeTab.id,
        });

        chrome.storage.local.set({
          recordingTab: null,
          offscreen: true,
          region: false,
          wasRegion: true,
        });
        sendMessageRecord({
          type: "loaded",
          request: request,
          isTab: true,
          tabID: streamId,
        });
      } catch (error) {
        // Open the recorder.html page as a normal tab.
        chrome.tabs
          .create({
            url: "recorder.html",
            pinned: true,
            index: 0,
            active: activeTab.url.includes(
              chrome.runtime.getURL("playground.html")
            )
              ? true
              : false,
          })
          .then((tab) => {
            chrome.storage.local.set({
              recordingTab: tab.id,
              offscreen: false,
              region: false,
              wasRegion: true,
              tabRecordedID: activeTab.id,
            });
            chrome.tabs.onUpdated.addListener(function _(
              tabId,
              changeInfo,
              updatedTab
            ) {
              // Check if recorder tab has finished loading
              if (tabId === tab.id && changeInfo.status === "complete") {
                chrome.tabs.onUpdated.removeListener(_);
                sendMessageRecord({
                  type: "loaded",
                  request: request,
                  tabID: activeTab.id,
                  backup: backup,
                  isTab: true,
                });
              }
            });
          });
      }
    }
  } else {
    try {
      if (!request.offscreenRecording || request.camera) {
        throw new Error("Exit offscreen recording");
      }

      if (tabId !== null) {
        // Navigate to the tab
        chrome.tabs.update(tabId, { active: true });
      }

      const { qualityValue } = await chrome.storage.local.get(["qualityValue"]);
      const { fpsValue } = await chrome.storage.local.get(["fpsValue"]);

      // also add && !request.camera above if works
      const existingContexts = await chrome.runtime.getContexts({});

      const offDocument = existingContexts.find(
        (c) => c.contextType === "OFFSCREEN_DOCUMENT"
      );

      if (offDocument) {
        // If an offscreen document is already open, close it.
        await chrome.offscreen.closeDocument();
      }
      // Create an offscreen document.
      await chrome.offscreen.createDocument({
        url: "recorderoffscreen.html",
        reasons: ["USER_MEDIA", "AUDIO_PLAYBACK", "DISPLAY_MEDIA"],
        justification: "Recording from getDisplayMedia API",
      });

      chrome.storage.local.set({
        recordingTab: null,
        offscreen: true,
        region: false,
        wasRegion: false,
      });
      sendMessageRecord({
        type: "loaded",
        request: request,
        isTab: false,
        quality: qualityValue,
        fps: fpsValue,
        backup: backup,
      });
    } catch (error) {
      // Open the recorder.html page as a normal tab.
      let switchTab = true;
      if (request.camera) {
        switchTab = false;
      }
      chrome.tabs
        .create({
          url: "recorder.html",
          pinned: true,
          index: 0,
          active: switchTab,
        })
        .then((tab) => {
          chrome.storage.local.set({
            recordingTab: tab.id,
            offscreen: false,
            region: false,
            wasRegion: false,
          });
          chrome.tabs.onUpdated.addListener(function _(
            tabId,
            changeInfo,
            updatedTab
          ) {
            // Check if recorder tab has finished loading
            if (tabId === tab.id && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(_);
              sendMessageRecord({
                type: "loaded",
                request: request,
                backup: backup,
              });
            }
          });
        });
    }
  }
};

const discardOffscreenDocuments = async () => {
  // Try doing (maybe offscreen isn't available)
  try {
    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (offscreenDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {}
};

const executeScripts = async () => {
  const contentScripts = chrome.runtime.getManifest().content_scripts;
  const tabQueries = contentScripts.map((cs) =>
    chrome.tabs.query({ url: cs.matches })
  );
  const tabResults = await Promise.all(tabQueries);

  const executeScriptPromises = [];
  for (let i = 0; i < tabResults.length; i++) {
    const tabs = tabResults[i];
    const cs = contentScripts[i];

    for (const tab of tabs) {
      const executeScriptPromise = chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          files: cs.js,
        },
        () => chrome.runtime.lastError
      );
      executeScriptPromises.push(executeScriptPromise);
    }
  }

  await Promise.all(executeScriptPromises);
};

// TODO: update the setuninstall url
// On first install open setup.html
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // Clear storage
    chrome.storage.local.clear();

    const locale = chrome.i18n.getMessage("@@ui_locale");
    if (locale.includes("en")) {
      chrome.runtime.setUninstallURL(
        "https://m4lkahr28fl.typeform.com/to/HQWoa8Is?version=" +
          chrome.runtime.getManifest().version
      );
    } else {
      chrome.runtime.setUninstallURL(
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
          locale +
          "&u=https://m4lkahr28fl.typeform.com/to/HQWoa8Is?version=" +
          chrome.runtime.getManifest().version
      );
    }
    chrome.storage.local.set({ firstTime: true });
    chrome.tabs.create({
      url: "setup.html",
    });
  } else if (details.reason === "update") {
    if (details.previousVersion === "2.8.6") {
      // Clear storage
      chrome.storage.local.clear();
      chrome.storage.local.set({ updatingFromOld: true });
    } else {
      chrome.storage.local.set({ updatingFromOld: false });
    }
    const locale = chrome.i18n.getMessage("@@ui_locale");
    if (locale.includes("en")) {
      chrome.runtime.setUninstallURL(
        "https://m4lkahr28fl.typeform.com/to/HQWoa8Is?version=" +
          chrome.runtime.getManifest().version
      );
    } else {
      chrome.runtime.setUninstallURL(
        "http://translate.google.com/translate?js=n&sl=auto&tl=" +
          locale +
          "&u=https://m4lkahr28fl.typeform.com/to/HQWoa8Is?version=" +
          chrome.runtime.getManifest().version
      );
    }
  }
  // Check chrome version, if 109 or below, disable backups
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      chrome.storage.local.set({ backup: false });
    }
  }

  chrome.storage.local.set({ systemAudio: true });

  // Check if the backup tab is open, if so close it
  const { backupTab } = await chrome.storage.local.get(["backupTab"]);
  if (backupTab) {
    removeTab(backupTab);
  }

  executeScripts();
});

// Detect if recordingTab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Check if region recording
  const { region } = await chrome.storage.local.get(["region"]);

  if (region) return;
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  const { recording } = await chrome.storage.local.get(["recording"]);
  const { restarting } = await chrome.storage.local.get(["restarting"]);

  if ((tabId === recordingTab || tabId === sandboxTab) && !restarting) {
    chrome.storage.local.set({ recordingTab: null });
    // Send a message to active tab
    const { activeTab } = await chrome.storage.local.get(["activeTab"]);

    try {
      if (recording) {
        focusTab(activeTab);
      }
      sendMessageTab(activeTab, { type: "stop-recording-tab" }, null, () => {
        // Tab doesn't exist, so just set activeTab to null
        sendMessageTab(tabId, { type: "stop-recording-tab" });
        chrome.storage.local.set({ activeTab: tabId });
      });
    } catch (error) {
      sendMessageTab(tabId, { type: "stop-recording-tab" });
      chrome.storage.local.set({ activeTab: tabId });
    }

    // Update icon
    chrome.action.setIcon({ path: "assets/icon-34.png" });
  }
  if (tabId === sandboxTab && !restarting) {
    removeTab(recordingTab);
  } else if (tabId === recordingTab && recording) {
    removeTab(sandboxTab);
  }
});

const discardRecording = async () => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  // Get actual sandbox tab
  removeTab(sandboxTab);
  sendMessageRecord({ type: "dismiss-recording" });
  chrome.action.setIcon({ path: "assets/icon-34.png" });
  discardOffscreenDocuments();
  chrome.storage.local.set({
    recordingTab: null,
    sandboxTab: null,
    recording: false,
  });
  chrome.runtime.sendMessage({ type: "discard-backup" });
};

// Check if still (actually) recording by looking at recordingTab or offscreen document
const checkRecording = async () => {
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { offscreen } = await chrome.storage.local.get(["offscreen"]);
  if (recordingTab && !offscreen) {
    try {
      chrome.tabs.get(recordingTab, (tab) => {
        if (!tab) {
          discardRecording();
        }
      });
    } catch (error) {
      discardRecording();
    }
  } else if (offscreen) {
    const existingContexts = await chrome.runtime.getContexts({});
    const offDocument = existingContexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );
    if (!offDocument) {
      discardRecording();
    }
  }
};

const removeSandbox = async () => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  removeTab(sandboxTab);
};

// TODO: this needs to be checked
const newSandboxPageRestart = async () => {
  let editor_url = "editor.html";

  // Check if Chrome version is 109 or below
  if (navigator.userAgent.includes("Chrome/")) {
    const version = parseInt(navigator.userAgent.match(/Chrome\/([0-9]+)/)[1]);
    if (version <= 109) {
      editor_url = "editorfallback.html";
    }
  }
  chrome.tabs.create(
    {
      url: editor_url,
      index: 1,
      pinned: true,
      active: false,
    },
    (tab) => {
      chrome.storage.local.set({ sandboxTab: tab.id });

      chrome.tabs.onUpdated.addListener(function _(
        tabId,
        changeInfo,
        updatedTab
      ) {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(_);
          resetActiveTabRestart();
        }
      });
    }
  );
};

const isPinned = (sendResponse) => {
  chrome.action.getUserSettings().then((userSettings) => {
    sendResponse({ pinned: userSettings.isOnToolbar });
  });
};

const getPlatformInfo = (sendResponse) => {
  chrome.runtime.getPlatformInfo((info) => {
    sendResponse(info);
  });
};

const checkRestore = async (sendResponse) => {
  const chunks = [];
  await chunksStore.iterate((value, key) => {
    chunks.push(value);
  });

  if (chunks.length === 0) {
    sendResponse({ restore: false, chunks: [] });
    return;
  }
  sendResponse({ restore: true });
};

const desktopCapture = async (request) => {
  const { backup } = await chrome.storage.local.get(["backup"]);
  const { backupSetup } = await chrome.storage.local.get(["backupSetup"]);
  chrome.storage.local.set({ sendingChunks: false });
  if (backup) {
    if (!backupSetup) {
      localDirectoryStore.clear();
    }

    let activeTab = await getCurrentTab();
    initBackup(request, activeTab.id);
  } else {
    offscreenDocument(request);
  }
};

const writeFile = async (request) => {
  // Need to add safety check here to make sure the tab is still open
  const { backupTab } = await chrome.storage.local.get(["backupTab"]);

  if (backupTab) {
    sendMessageTab(
      backupTab,
      {
        type: "write-file",
        index: request.index,
      },
      null,
      () => {
        sendMessageRecord({ type: "stop-recording-tab" });
      }
    );
  } else {
    sendMessageRecord({ type: "stop-recording-tab" });
  }
};

const videoReady = async () => {
  const { backupTab } = await chrome.storage.local.get(["backupTab"]);
  if (backupTab) {
    sendMessageTab(backupTab, { type: "close-writable" });
  }
  stopRecording();
};

const newChunk = async (request) => {
  const { sandboxTab } = await chrome.storage.local.get(["sandboxTab"]);
  sendMessageTab(sandboxTab, {
    type: "new-chunk-tab",
    chunk: request.chunk,
    index: request.index,
  });

  sendResponse({ status: "ok" });
};

const handleGetStreamingData = async () => {
  const data = await getStreamingData();
  sendMessageRecord({ type: "streaming-data", data: JSON.stringify(data) });
};

const cancelRecording = async () => {
  chrome.action.setIcon({ path: "assets/icon-34.png" });
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  sendMessageTab(activeTab, { type: "stop-pending" });
  focusTab(activeTab);
  discardOffscreenDocuments();
};

const handleStopRecordingTab = async (request) => {
  if (request.memoryError) {
    chrome.storage.local.set({
      recording: false,
      restarting: false,
      tabRecordedID: null,
      memoryError: true,
    });
  }
  // sendMessageRecord({
  //   type: "loaded",
  //   request: request,
  //   backup: backup,
  //   region: true,
  // });
  sendMessageRecord({ type: "stop-recording-tab" });
};

const handleRestartRecordingTab = async () => {
  removeSandbox();
};

const handleDismissRecordingTab = async () => {
  chrome.runtime.sendMessage({ type: "discard-backup" });
  discardRecording();
};

const setMicActiveTab = async (request) => {
  chrome.storage.local.get(["region"], (result) => {
    if (result.region) {
      sendMessageRecord({
        type: "set-mic-active-tab",
        active: request.active,
        defaultAudioInput: request.defaultAudioInput,
      });
    }
  });
};

const handleRecordingError = async (request) => {
  // get actual active tab
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);

  sendMessageRecord({ type: "recording-error" }).then(() => {
    sendMessageTab(activeTab, { type: "stop-pending" });
    focusTab(activeTab);
    if (request.error === "stream-error") {
      sendMessageTab(activeTab, { type: "stream-error" });
    } else if (request.error === "backup-error") {
      sendMessageTab(activeTab, { type: "backup-error" });
    }
  });

  // Close recording tab
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);
  const { region } = await chrome.storage.local.get(["region"]);
  // Check if tab exists (with tab api)
  if (recordingTab && !region) {
    removeTab(recordingTab);
  }
  chrome.storage.local.set({ recordingTab: null });
  discardOffscreenDocuments();
};

const handleOnGetPermissions = async (request) => {
  // Send a message to (actual) active tab
  const activeTab = await getCurrentTab();
  if (activeTab) {
    sendMessageTab(activeTab.id, {
      type: "on-get-permissions",
      data: request,
    });
  }
};

const handleRecordingComplete = async () => {
  // Close the recording tab
  const { recordingTab } = await chrome.storage.local.get(["recordingTab"]);

  // Check if tab exists (with tab api)
  if (recordingTab) {
    chrome.tabs.get(recordingTab, (tab) => {
      if (tab) {
        // Check if tab url contains chrome-extension and recorder.html
        if (
          tab.url.includes("chrome-extension") &&
          tab.url.includes("recorder.html")
        ) {
          removeTab(recordingTab);
        }
      }
    });
  }
};

const setSurface = async (request) => {
  chrome.storage.local.set({
    surface: request.surface,
  });

  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  sendMessageTab(activeTab, {
    type: "set-surface",
    surface: request.surface,
  });
};

const handlePip = async (started = false) => {
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  if (started) {
    sendMessageTab(activeTab, { type: "pip-started" });
  } else {
    sendMessageTab(activeTab, { type: "pip-ended" });
  }
};

const handleSignOutDrive = async () => {
  // Get token
  const { token } = await chrome.storage.local.get(["token"]);
  var url = "https://accounts.google.com/o/oauth2/revoke?token=" + token;
  fetch(url);

  chrome.identity.removeCachedAuthToken({ token: token });
  chrome.storage.local.set({ token: false });
};

const handleStopRecordingTabBackup = async (request) => {
  chrome.storage.local.set({
    recording: false,
    restarting: false,
    tabRecordedID: null,
    memoryError: true,
  });
  sendMessageRecord({ type: "stop-recording-tab" });

  // Get active tab
  const { activeTab } = await chrome.storage.local.get(["activeTab"]);
  // Check if actual tab
  sendMessageTab(activeTab, { type: "stop-pending" });
  focusTab(activeTab);
};

const clearAllRecordings = async () => {
  chunksStore.clear();
};

const resizeWindow = async (width, height) => {
  if (width === 0 || height === 0) {
    return;
  }

  chrome.windows.getCurrent((window) => {
    chrome.windows.update(window.id, {
      width: width,
      height: height,
    });
  });
};

const checkAvailableMemory = (sendResponse) => {
  navigator.storage.estimate().then((data) => {
    sendResponse({ data: data });
  });
};

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "desktop-capture") {
    desktopCapture(request);
  } else if (request.type === "backup-created") {
    offscreenDocument(request.request, request.tabId);
  } else if (request.type === "write-file") {
    writeFile(request);
  } else if (request.type === "handle-restart") {
    handleRestart();
  } else if (request.type === "handle-dismiss") {
    handleDismiss();
  } else if (request.type === "reset-active-tab") {
    resetActiveTab();
  } else if (request.type === "reset-active-tab-restart") {
    resetActiveTabRestart();
  } else if (request.type === "start-rec") {
    startRecording();
  } else if (request.type === "video-ready") {
    videoReady();
  } else if (request.type === "start-recording") {
    startRecording();
  } else if (request.type === "restarted") {
    restartActiveTab();
  } else if (request.type === "new-chunk") {
    newChunk(request);
    return true;
  } else if (request.type === "get-streaming-data") {
    handleGetStreamingData();
  } else if (request.type === "cancel-recording") {
    cancelRecording();
  } else if (request.type === "stop-recording-tab") {
    handleStopRecordingTab(request);
  } else if (request.type === "restart-recording-tab") {
    handleRestartRecordingTab();
  } else if (request.type === "dismiss-recording-tab") {
    handleDismissRecordingTab();
  } else if (request.type === "pause-recording-tab") {
    sendMessageRecord({ type: "pause-recording-tab" });
  } else if (request.type === "resume-recording-tab") {
    sendMessageRecord({ type: "resume-recording-tab" });
  } else if (request.type === "set-mic-active-tab") {
    setMicActiveTab(request);
  } else if (request.type === "recording-error") {
    handleRecordingError(request);
  } else if (request.type === "on-get-permissions") {
    handleOnGetPermissions(request);
  } else if (request.type === "recording-complete") {
    handleRecordingComplete();
  } else if (request.type === "check-recording") {
    checkRecording();
  } else if (request.type === "review-screendesk") {
    createTab(
      "https://chrome.google.com/webstore/detail/screendesk-screen-recorder/kbbdabhdfibnancpjfhlkhafgdilcnji/reviews",
      false,
      true
    );
  } else if (request.type === "follow-twitter") {
    createTab("https://alyssax.substack.com/", false, true);
  } else if (request.type === "open-processing-info") {
    createTab(
      "https://help.screendesk.io/editing-and-exporting/dJRFpGq56JFKC7k8zEvsqb/why-is-there-a-5-minute-limit-for-editing/ddy4e4TpbnrFJ8VoRT37tQ",
      true,
      true
    );
  } else if (request.type === "upgrade-info") {
    createTab(
      "https://help.screendesk.io/getting-started/77KizPC8MHVGfpKpqdux9D/what-are-the-technical-requirements-for-using-screendesk/6kdB6qru6naVD8ZLFvX3m9",
      true,
      true
    );
  } else if (request.type === "trim-info") {
    createTab(
      "https://help.screendesk.io/editing-and-exporting/dJRFpGq56JFKC7k8zEvsqb/how-to-cut-trim-or-mute-parts-of-your-video/svNbM7YHYY717MuSWXrKXH",
      true,
      true
    );
  } else if (request.type === "join-waitlist") {
    createTab("https://m4lkahr28fl.typeform.com/to/HQWoa8Is", true, true);
  } else if (request.type === "chrome-update-info") {
    createTab(
      "https://help.screendesk.io/getting-started/77KizPC8MHVGfpKpqdux9D/what-are-the-technical-requirements-for-using-screendesk/6kdB6qru6naVD8ZLFvX3m9",
      true,
      true
    );
  } else if (request.type === "set-surface") {
    setSurface(request);
  } else if (request.type === "pip-ended") {
    handlePip(false);
  } else if (request.type === "pip-started") {
    handlePip(true);
  } else if (request.type === "new-sandbox-page-restart") {
    newSandboxPageRestart();
  } else if (request.type === "sign-out-drive") {
    handleSignOutDrive();
  } else if (request.type === "open-help") {
    createTab("https://help.screendesk.io/", true, true);
  } else if (request.type === "memory-limit-help") {
    createTab(
      "https://help.screendesk.io/troubleshooting/9Jy5RGjNrBB42hqUdREQ7W/what-does-%E2%80%9Cmemory-limit-reached%E2%80%9D-mean-when-recording/8WkwHbt3puuXunYqQnyPcb",
      true,
      true
    );
  } else if (request.type === "open-home") {
    createTab("https://screendesk.io/", false, true);
  } else if (request.type === "report-bug") {
    createTab(
      "https://m4lkahr28fl.typeform.com/to/HQWoa8Is?version=" +
        chrome.runtime.getManifest().version,
      false,
      true
    );
  } else if (request.type === "clear-recordings") {
    clearAllRecordings();
  } else if (request.type === "focus-this-tab") {
    focusTab(sender.tab.id);
  } else if (request.type === "stop-recording-tab-backup") {
    handleStopRecordingTabBackup(request);
  } else if (request.type === "indexed-db-download") {
    downloadIndexedDB();
  } else if (request.type === "get-platform-info") {
    getPlatformInfo(sendResponse);
    return true;
  } else if (request.type === "restore-recording") {
    sendChunks();
  } else if (request.type === "check-restore") {
    checkRestore(sendResponse);
    return true;
  } else if (request.type === "check-capture-permissions") {
    chrome.permissions.contains(
      {
        permissions: ["desktopCapture", "alarms", "offscreen"],
      },
      (result) => {
        if (!result) {
          chrome.permissions.request(
            {
              permissions: ["desktopCapture", "alarms", "offscreen"],
            },
            (granted) => {
              if (!granted) {
                sendResponse({ status: "error" });
              } else {
                addAlarmListener();
                sendResponse({ status: "ok" });
              }
            }
          );
        } else {
          sendResponse({ status: "ok" });
        }
      }
    );
    return true;
  } else if (request.type === "is-pinned") {
    isPinned(sendResponse);
    return true;
  } else if (request.type === "resize-window") {
    resizeWindow(request.width, request.height);
  } else if (request.type === "available-memory") {
    checkAvailableMemory(sendResponse);
    return true;
  } else if (request.type === "extension-media-permissions") {
    createTab(
      "chrome://settings/content/siteDetails?site=chrome-extension://" +
        chrome.runtime.id,
      false,
      true
    );
  } else if (request.type === "add-alarm-listener") {
    addAlarmListener();
  } else if (request.type === "open-sign-in-page") {
    chrome.windows.create({
      url: 'http://localhost:3001/users/sign_in?source=chrome_extension',
      type: 'popup',
      width: 500,
      height: 700,
      focused: true
    }, (window) => {
      signInWindowId = window.id; // Store the window ID
    });

    // Don't immediately hide the popup - wait for authentication to complete
    // chrome.runtime.sendMessage({type: "hide-popup"});
  } else if (request.type === "check-auth-before-show") {
    // This is the new auth check that only happens when extension is hidden
    chrome.runtime.sendMessage({type: "check-auth-and-show"});
  }
});
