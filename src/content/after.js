// This content script runs on WhatsApp Web
// console.log('WhatsApp Voice Transcriber: Content Script Loaded');

// --- INJECTION LOGIC ---
function injectScript(file_path) {
  const script = document.createElement('script');
  script.setAttribute('type', 'text/javascript');
  script.setAttribute('src', file_path);
  (document.head || document.documentElement).appendChild(script);
  script.onload = function () {
    script.remove();
  };
}
injectScript(chrome.runtime.getURL('src/content/inject.js'));

// --- MAIN LOGIC ---

const observerConfig = { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'src', 'data-testid', 'data-id', 'class'] };
let detectedVoiceMessages = new Map();
let pendingAudioResolve = null;
let isTranscribing = false;
let currentChatTitle = "";

// Log helper to send logs to sidepanel
function logToSidePanel(...args) {
  // console.log(...args); // Keep local log
  chrome.runtime.sendMessage({
    action: 'LOG',
    args: args
  }).catch(() => { });
}

// Helper to find the active chat title (Contact Name)
function getActiveChatTitle() {
  // Verified against User HTML: <div id="main"> <header> ... <span dir="auto">Name</span>
  const mainFunc = document.getElementById('main');
  if (mainFunc) {
    const header = mainFunc.querySelector('header');
    if (header) {
      // Priority: span[dir="auto"] inside the header info block
      // The structure is deep, usually: header -> div -> div -> div -> span[dir="auto"]

      // Refined Selector:
      // 1. Look for H2/H1 if they exist (unlikely in WA Web but possible)
      // 2. Look for span[dir="auto"] that is NOT "click here for contact info" or status
      // The title usually has a 'title' attribute or is the first significant text

      const titleSpan = header.querySelector('div[role="button"] span[dir="auto"][title]') ||
        header.querySelector('span[dir="auto"][title]') ||
        header.querySelector('span[dir="auto"]');

      if (titleSpan) return titleSpan.innerText;
    }
  }
  return "";
}

const observer = new MutationObserver((mutations) => {
  let shouldScan = false;
  for (const mutation of mutations) {
    if (mutation.type === 'childList' || mutation.type === 'attributes') {
      shouldScan = true;
      break;
    }
  }
  if (shouldScan) {
    scanAndBroadcast();
  }
});

observer.observe(document.body, observerConfig);

const scanInterval = setInterval(() => {
  scanAndBroadcast();
}, 2000);


// --- Audio Capture via Interception ---
window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data.type && event.data.type === 'WA_AUDIO_INTERCEPT') {
    const src = event.data.src;
    if (isTranscribing) {
      logToSidePanel('CAPTURED via Injection:', src);
      if (pendingAudioResolve) {
        pendingAudioResolve(src);
        pendingAudioResolve = null;
        isTranscribing = false;
      }
    }
  }
}, false);


function scanAndBroadcast() {
  // ORPHAN CHECK: If extension reloaded, stop everything.
  try {
    if (!chrome.runtime || !chrome.runtime.id) throw new Error("Context Invalidated");
  } catch (e) {
    console.log("Extension context invalidated. Disconnecting observer.");
    observer.disconnect();
    if (scanInterval) clearInterval(scanInterval);
    return;
  }

  // Always check the current title in the DOM to detect changes
  const freshTitle = getActiveChatTitle();

  if (freshTitle && freshTitle !== currentChatTitle) {
    // console.log(`Chat Switch Detected: "${currentChatTitle}" -> "${freshTitle}"`);
    currentChatTitle = freshTitle;
    try {
      chrome.runtime.sendMessage({
        action: 'CHAT_SWITCHED',
        chatName: currentChatTitle
      }).catch(() => { });
    } catch (e) { }
  } else if (!freshTitle && currentChatTitle) {
    // If we lost the title but are still in #main, keep it (flicker protection)
    // If #main is gone, we left the chat.
    if (!document.getElementById('main')) {
      currentChatTitle = null;
      try {
        chrome.runtime.sendMessage({
          action: 'CHAT_SWITCHED',
          chatName: null
        }).catch(() => { });
      } catch (e) { }
      return;
    }
  }

  // Initial load logic
  if (!currentChatTitle && freshTitle) {
    currentChatTitle = freshTitle;
    try {
      chrome.runtime.sendMessage({
        action: 'CHAT_SWITCHED',
        chatName: currentChatTitle
      }).catch(() => { });
    } catch (e) { }
  }

  const root = document.body;
  // Use a query that respects document order
  const candidates = Array.from(root.querySelectorAll('button[aria-label="Play voice message"], span[data-icon="audio-play"], button[aria-label="Pause voice message"]'));

  const newMap = new Map();
  const payload = [];

  // Filter candidates to ONLY those inside #main (Active Chat)
  // This solves the issue of pre-loading items or sidebar items appearing
  const mainPanel = document.getElementById('main');

  // Optimization: If no main panel, we can't possibly have valid messages for the active chat
  if (!mainPanel) return;

  const processedContainers = new Set();

  candidates.forEach((btn, index) => {
    try {
      // Strict Check: Must be inside #main to be relevant to current chat
      if (!mainPanel.contains(btn)) {
        return;
      }

      let container = btn.closest('div[role="row"]');
      // Robust Fallback: If role="row" not found, find the message container directly
      if (!container) {
        container = btn.closest('div.message-in') || btn.closest('div.message-out') || btn.parentElement.parentElement.parentElement;
      }
      if (!container) return;

      // Deduplication: One candidate per container
      if (processedContainers.has(container)) return;
      processedContainers.add(container);

      // Extract metadata early to help with ID generation
      const meta = extractMetadata(container, btn);

      let id = '';
      // Robust ID: Look for data-id on the container OR any ancestor up to main
      const row = btn.closest('div[data-id]') || container.closest('div[data-id]');

      if (row && row.dataset.id) {
        id = 'vm_' + row.dataset.id;
      } else {
        // Fallback for ID if data-id is missing (common in some views)
        // Create a stable hash based on content: Sender + Timestamp + Duration + Message Index
        // Avoiding Date.now() prevents duplicates on re-scan
        const fingerprint = `${meta.sender}_${meta.timestamp}_${meta.duration}`;
        // Simple hash or cleaner string
        id = `vm_fallback_${fingerprint.replace(/[^a-z0-9]/gi, '')}_${index}`;
      }

      newMap.set(id, {
        id: id,
        element: container,
        playBtn: btn
      });

      payload.push({
        id: id,
        sender: meta.sender,
        timestamp: meta.timestamp,
        duration: meta.duration
      });
    } catch (err) {
      console.error("Error processing voice message candidate:", err, btn);
      // Do not throw, continue to next
    }
  });

  // Debug Log (Visible in console if user checks)
  // logToSidePanel("Scanned messages:", payload.length);

  detectedVoiceMessages = newMap;

  if (currentChatTitle) {
    // Safety check: Extension context invalidated?
    if (chrome.runtime && chrome.runtime.id) {
      try {
        chrome.runtime.sendMessage({
          action: 'VOICE_MESSAGES_LIST_UPDATE',
          messages: payload,
          chatName: currentChatTitle
        }).catch(() => { });
      } catch (err) {
        // Context invalidated or other runtime error
        // console.debug("Runtime message failed:", err);
      }
    }
  }
}

function extractMetadata(container, playBtn) {
  let sender = "Unknown";
  let timestamp = "";
  let duration = "Unknown";

  // --- Sender Logic (User Requested: Myself vs Contact) ---
  const isMessageOut = container.classList.contains('message-out') || container.querySelector('.message-out') || container.closest('.message-out');
  const isMessageIn = container.classList.contains('message-in') || container.querySelector('.message-in') || container.closest('.message-in');

  if (isMessageOut) {
    sender = "Myself";
  } else if (isMessageIn) {
    // --- Group Chat vs 1:1 Logic ---

    // Priority 1: Check for data-pre-plain-text (Reliable if present)
    const messageNode = container.querySelector('div[data-pre-plain-text]') || container.closest('div[data-pre-plain-text]');
    if (messageNode) {
      const rawAttr = messageNode.getAttribute('data-pre-plain-text');
      const senderMatch = rawAttr.match(/] (.*?):/);
      if (senderMatch) {
        sender = senderMatch[1];
      }
    }

    // Priority 2: Heuristic Scan for Name in Bubble (Common in Groups)
    // If we didn't find it via data-pre-plain-text (common in Voice Messages)
    if (sender === "Unknown") {
      // Find all span[dir="auto"]
      const candidates = Array.from(container.querySelectorAll('span[dir="auto"]'));

      for (const cand of candidates) {
        const text = cand.innerText.trim();
        // Filters:
        // 1. Is it Time? (e.g. 20:46)
        if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(text)) continue;

        // 2. Is it inside a Quoted Message?
        if (cand.closest('div[aria-label="Quoted message"]')) continue;

        // 3. Is it "Forwarded"?
        if (text.toLowerCase() === 'forwarded') continue;

        // If it passes filters, it's likely the name (First valid one)
        if (text.length > 0) {
          sender = text;
          break;
        }
      }
    }

    // Priority 3: Fallback to Chat Title (1:1 Chats)
    // CRITICAL FIX: If we are in a 1:1 chat, the sender should ALWAYS be the chat contact name 
    // unless we explicitly identified it as "Myself".
    // "Unknown" check might be failing if we found a partial match earlier, 
    // so we re-verify against currentChatTitle if it's not "Myself".

    if (sender !== "Myself" && currentChatTitle) {
      // If we found a name but it looks like a time or generic text, override it.
      // But if we have no name "Unknown", definitely use title.
      if (sender === "Unknown") {
        sender = currentChatTitle;
      }
      // Optional: Logic to prefer Chat Title over heuristics for 1:1 chats could go here
      // But identifying 1:1 vs Group is tricky without more DOM inspection.
      // For now, "Unknown" fallback is the key missing piece if heuristics fail.
    }
  }

  // --- Timestamp & Duration Logic ---
  // 1. Try visual scraping for time
  const fullText = container.innerText || "";
  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const timeRegex = /(\d{1,2}:\d{2}\s?(?:[AP]M)?)/i;

  // Use data-pre-plain-text first for Timestamp if available (It has Date!)
  const messageNode = container.querySelector('div[data-pre-plain-text]') || container.closest('div[data-pre-plain-text]');
  if (messageNode) {
    const rawAttr = messageNode.getAttribute('data-pre-plain-text');
    // Format: [16:50, 01/12/2025] 
    const dateMatch = rawAttr.match(/\[(.*?)\]/);
    if (dateMatch) timestamp = dateMatch[1];
  } else {
    // Fallback to visual lines
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(timeRegex);
      if (match && lines[i].length < 10) {
        timestamp = match[0];
        break;
      }
    }
  }

  // Duration
  let playerContainer = playBtn.closest('div[aria-label="Voice message"]');
  if (!playerContainer) playerContainer = playBtn.parentElement ? playBtn.parentElement.parentElement : null;

  if (playerContainer) {
    const allDurMatches = [...(playerContainer.innerText || "").matchAll(/(\d{1,2}:\d{2})/g)];
    if (allDurMatches.length > 0) {
      // Usually the longest time string in the player container is the duration
      // (Current position vs Total duration)
      let maxSeconds = -1;
      let bestDur = allDurMatches[0][0];
      allDurMatches.forEach(m => {
        const parts = m[0].split(':');
        const secs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        if (secs > maxSeconds && secs < 3600) {
          maxSeconds = secs;
          bestDur = m[0];
        }
      });
      duration = bestDur;
    }
  }

  return { sender, timestamp, duration };
}



// --- Pulse Animation Styles ---
const pulseStyle = document.createElement('style');
pulseStyle.textContent = `
@keyframes wa-voice-pulse {
    0% {
        box-shadow: 0 0 0 0 rgba(0, 168, 132, 0.7);
    }
    70% {
        box-shadow: 0 0 0 6px rgba(0, 168, 132, 0);
    }
    100% {
        box-shadow: 0 0 0 0 rgba(0, 168, 132, 0);
    }
}
.wa-voice-highlight-pulse {
    animation: wa-voice-pulse 1.5s infinite;
    z-index: 999;
    position: relative;
    border-radius: 8px; /* Approximate radius, usually inherited */
}
`;
document.head.appendChild(pulseStyle);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TRANSCRIBE_REQUEST') {
    handleTranscribeRequest(message.id);
  }
  if (message.action === 'HIGHLIGHT_MESSAGE') {
    const vm = detectedVoiceMessages.get(message.id);
    if (vm && vm.element) {
      // Try to find the visual bubble inside the row/container
      // Use a heuristic: looks for the message-in/out container deeper down
      // or check if vm.element itself is the bubble
      let target = vm.element.querySelector('.message-in') ||
        vm.element.querySelector('.message-out') ||
        vm.element.querySelector('div[class*="message-"]');

      // If not found, look for standard bubble wrappers
      if (!target) {
        // Fallback: try to find the child div with background color? 
        // Or just use the element if it seems small enough
        target = vm.element;
      } else {
        // Often the bubble is a child of message-in
        const bubble = target.querySelector('div[class*="_amk"]'); // common obfuscated class prefix
        if (bubble) target = bubble;
      }

      if (message.active) {
        target.classList.add('wa-voice-highlight-pulse');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // Remove from potential targets (in case we switched target logic or it bubble up)
        target.classList.remove('wa-voice-highlight-pulse');
        // Safety cleanup on container too if logic changed
        vm.element.classList.remove('wa-voice-highlight-pulse');
        if (vm.element.querySelector('.wa-voice-highlight-pulse')) {
          vm.element.querySelector('.wa-voice-highlight-pulse').classList.remove('wa-voice-highlight-pulse');
        }
      }
    }
  }
});

function simClick(element) {
  if (!element) return;
  if (element.focus) element.focus();
  const opts = { view: window, bubbles: true, cancelable: true, buttons: 1 };
  element.dispatchEvent(new PointerEvent('pointerdown', opts));
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  element.dispatchEvent(new PointerEvent('pointerup', opts));
  element.dispatchEvent(new MouseEvent('mouseup', opts));
  element.dispatchEvent(new MouseEvent('click', opts));
}

async function handleTranscribeRequest(id) {
  logToSidePanel("Transcribing Request ID:", id);
  let vm = detectedVoiceMessages.get(id);

  if (!vm) {
    scanAndBroadcast();
    vm = detectedVoiceMessages.get(id);
    if (!vm) {
      chrome.runtime.sendMessage({ action: 'ERROR', id: id, error: "Message element missing. Try scrolling it into view." });
      return;
    }
  }

  try {
    const audioSrc = await new Promise((resolve, reject) => {
      isTranscribing = true;
      pendingAudioResolve = resolve;

      // Hunter Mode: Start Hunt -> Click Play -> Inject.js catches -> Pause -> Return Src
      window.postMessage({ type: 'CMD_HUNT_AUDIO' }, '*');

      const timeout = setTimeout(() => {
        if (pendingAudioResolve) {
          logToSidePanel('[Audio Debug] TIMEOUT - No Intercepted Audio.');
          isTranscribing = false;
          pendingAudioResolve = null;
          reject(new Error("Audio detection timed out. Please try again."));
        }
      }, 8000);

      simClick(vm.playBtn);
      // Backup click for nested icons
      const childIcon = vm.playBtn.querySelector('span[data-icon]');
      if (childIcon) simClick(childIcon);
    });

    logToSidePanel('Captured Src:', audioSrc);

    if (audioSrc.startsWith('blob:')) {
      const response = await fetch(audioSrc);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        chrome.runtime.sendMessage({
          action: 'TRANSCRIPTION_DATA',
          id: id,
          audioSrc: reader.result
        });
      };
      reader.readAsDataURL(blob);
    } else {
      chrome.runtime.sendMessage({
        action: 'TRANSCRIPTION_DATA',
        id: id,
        audioSrc: audioSrc
      });
    }

  } catch (error) {
    console.error("Transcribe Error:", error);
    chrome.runtime.sendMessage({
      action: 'ERROR',
      id: id,
      error: error.message
    });
  }
}
