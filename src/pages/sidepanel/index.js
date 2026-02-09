document.addEventListener('DOMContentLoaded', () => {
    // --- State & Elements ---
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('modelSelect');
    const languageSelect = document.getElementById('languageSelect');
    const saveSettingsBtn = document.getElementById('saveSettings');
    const statusMessage = document.getElementById('statusMessage');
    const themeToggle = document.getElementById('theme-toggle');
    const messagesListContainer = document.getElementById('messages-list');

    // Create Load More button container
    const loadMoreContainer = document.createElement('div');
    loadMoreContainer.id = 'load-more-container';
    loadMoreContainer.style.display = 'none';
    loadMoreContainer.innerHTML = '<button id="loadOlderMessages">Load older messages</button>';
    document.getElementById('detected-messages').insertBefore(loadMoreContainer, messagesListContainer);
    const loadOlderMessagesBtn = loadMoreContainer.querySelector('#loadOlderMessages');

    let allVoiceMessages = []; // Stores all unique messages
    let visibleCount = 3; // Initially show 3

    const clearCacheBtn = document.getElementById('clearCacheBtn');
    const searchInput = document.getElementById('searchInput');
    const customLanguageInput = document.getElementById('customLanguage');

    // --- Initialization ---
    loadSettings();
    setupTheme();

    // --- Event Listeners ---
    saveSettingsBtn.addEventListener('click', saveSettings);
    themeToggle.addEventListener('click', toggleTheme);
    loadOlderMessagesBtn.addEventListener('click', () => {
        visibleCount += 3; // Load 3 more
        renderMessagesList();
    });
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', clearCache);
    }
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            toggleClearButton();
            renderMessagesList();
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            toggleClearButton();
            renderMessagesList();
            searchInput.focus();
        });
    }

    function toggleClearButton() {
        if (searchInput.value.trim().length > 0) {
            clearSearchBtn.style.display = 'block';
        } else {
            clearSearchBtn.style.display = 'none';
        }
    }
    if (languageSelect) {
        languageSelect.addEventListener('change', () => {
            if (languageSelect.value === 'Other') {
                customLanguageInput.style.display = 'block';
            } else {
                customLanguageInput.style.display = 'none';
            }
        });
    }

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'CHAT_SWITCHED') {
            // console.log("Chat Switched. Clearing UI.");
            allVoiceMessages = []; // Clear data
            renderMessagesList();  // Clear View
            return;
        }

        if (message.action === 'VOICE_MESSAGES_LIST_UPDATE') {
            mergeMessages(message.messages);
        } else if (message.action === 'TRANSCRIPTION_DATA') {
            handleTranscriptionData(message.id, message.audioSrc);
        } else if (message.action === 'ERROR') {
            updateMessageStatus(message.id, `Error: ${message.error}`, 'error');
        } else if (message.action === 'LOG') {
            // console.log("[Content Script]:", ...message.args);
        }
    });

    // --- Message Management ---
    function mergeMessages(newMessages) {
        // The content script sends messages in DOM order (Oldest -> Newest)
        // We should trust this order to handle scrolling (loading older messages) correctly.
        // Instead of merging and pushing to the end, we should essentially replace the list
        // but preserve any object references/state if needed (though we use ID for that).

        // Simple Replacement strategy is safest for ordering:

        // Check if list effectively changed to avoid unnecessary re-renders
        const newIds = newMessages.map(m => m.id).join(',');
        const oldIds = allVoiceMessages.map(m => m.id).join(',');

        if (newIds !== oldIds) {
            allVoiceMessages = newMessages; // Trust the DOM order
            renderMessagesList();
        }
    }

    async function renderMessagesList() {
        messagesListContainer.innerHTML = '';

        const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
        let messagesToShow = [];

        if (query) {
            // --- SEARCH MODE ---
            loadMoreContainer.style.display = 'none'; // Hide pagination during search

            // We need to check cache for matching text
            // Optimization: Fetch all cache for current messages in one go
            const allIds = allVoiceMessages.map(m => m.id);
            let wholeCache = {};
            try {
                wholeCache = await chrome.storage.local.get(allIds);
            } catch (e) { console.error("Search cache fetch error", e); }

            // Filter
            messagesToShow = allVoiceMessages.filter(msg => {
                // 1. Check Sender
                if ((msg.sender || '').toLowerCase().includes(query)) return true;

                // 2. Check Cached Text
                const cachedData = wholeCache[msg.id];
                if (cachedData) {
                    let textToCheck = '';
                    if (typeof cachedData === 'string') textToCheck = cachedData;
                    else if (typeof cachedData === 'object') {
                        textToCheck = (cachedData.summary || '') + ' ' + (cachedData.transcript || '') + ' ' + (cachedData.fullText || '');
                    }
                    if (textToCheck.toLowerCase().includes(query)) return true;
                }

                return false;
            });

        } else {
            // --- NORMAL MODE ---
            // Filter: Last N messages
            const startIndex = Math.max(0, allVoiceMessages.length - visibleCount);
            messagesToShow = allVoiceMessages.slice(startIndex);

            // Show/Hide Load More
            if (startIndex > 0) {
                loadMoreContainer.style.display = 'block';
            } else {
                loadMoreContainer.style.display = 'none';
            }
        }

        if (messagesToShow.length === 0) {
            if (query) {
                messagesListContainer.innerHTML = `<div class="empty-state"><small>No matches for "${query}"</small></div>`;
            } else {
                messagesListContainer.innerHTML = `
                    <div class="empty-state">
                        <p>No messages detected yet</p>
                        <small>Open a WhatsApp chat with voice messages.</small>
                         <p style="color: var(--text-secondary); margin-top: 12px; font-size: 12px; line-height: 1.4;">
                            If the open chat has voice messages, please <b>refresh the Whatsapp page</b> so TL;DL can find them.
                        </p>
                    </div>`;
            }
            return;
        }

        messagesToShow.forEach(async (msg) => {
            const el = document.createElement('div');
            el.id = `msg-${msg.id}`;
            el.className = 'message-card';

            // Check Cache
            let cached = null;
            try {
                const stored = await chrome.storage.local.get(msg.id);
                cached = stored[msg.id];
            } catch (e) { console.error("Cache read error", e); }

            const hasCache = !!cached;

            // Re-run UI: New Design (Subtle link/icon)
            const btnHtml = hasCache
                ? `<span class="rerun-link" id="btn-${msg.id}" title="Re-run transcription">↻ Re-run</span>`
                : `<button class="btn-primary btn-sm" id="btn-${msg.id}">Transcribe</button>`;

            el.innerHTML = `
                <div class="message-header">
                    <span class="sender-name">${msg.sender || 'Unknown'}</span>
                </div>
                <div class="audio-preview">
                    <span class="duration-pill">🎤 ${msg.duration || 'Voice'}</span>
                    <div class="action-area" id="action-${msg.id}">
                        ${btnHtml}
                    </div>
                </div>
                <div class="result-area" id="result-${msg.id}" style="${hasCache ? 'display:block;' : 'display:none;'}">
                    ${hasCache ? formatTranscription(cached) : ''}
                </div>
                <div class="message-meta">
                    <span>${msg.timestamp}</span>
                </div>
            `;
            messagesListContainer.appendChild(el);

            // --- Highlight on Hover ---
            el.addEventListener('mouseenter', () => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'HIGHLIGHT_MESSAGE',
                            id: msg.id,
                            active: true
                        }).catch(() => { });
                    }
                });
            });

            el.addEventListener('mouseleave', () => {
                chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            action: 'HIGHLIGHT_MESSAGE',
                            id: msg.id,
                            active: false
                        }).catch(() => { });
                    }
                });
            });

            const btn = document.getElementById(`btn-${msg.id}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    requestTranscription(msg.id);
                });
            }
        });
    }

    // --- Transcription Logic ---
    function requestTranscription(id) {
        updateMessageStatus(id, 'Loading...', 'loading');
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'TRANSCRIBE_REQUEST',
                    id: id
                });
            }
        });
    }

    async function handleTranscriptionData(id, audioSrc) {
        updateMessageStatus(id, 'Thinking...', 'loading');

        try {
            const settings = await chrome.storage.local.get(['apiKey', 'model', 'language']);
            if (!settings.apiKey) {
                updateMessageStatus(id, 'Set API Key!', 'error');
                return;
            }

            const result = await processWithGemini(audioSrc, settings);

            // Save to Cache
            try {
                const saveObj = {};
                saveObj[id] = result;
                await chrome.storage.local.set(saveObj);
            } catch (e) { console.error("Cache save error", e); }

            // Render Result
            const resultContainer = document.getElementById(`result-${id}`);
            resultContainer.style.display = 'block';
            resultContainer.innerHTML = formatTranscription(result);

            // Switch button to Re-run
            const actionArea = document.getElementById(`action-${id}`);
            if (actionArea) {
                actionArea.innerHTML = `<span class="rerun-link" id="btn-${id}" title="Re-run transcription">↻ Re-run</span>`;
                const newBtn = document.getElementById(`btn-${id}`);
                if (newBtn) {
                    newBtn.addEventListener('click', () => requestTranscription(id));
                }
            }

            updateMessageStatus(id, 'Done', 'success');

        } catch (error) {
            updateMessageStatus(id, `Error`, 'error');
            console.error(error);
        }
    }

    function updateMessageStatus(id, text, type) {
        const actionContainer = document.getElementById(`action-${id}`);
        if (actionContainer) {
            actionContainer.innerHTML = `<span style="font-size:11px; color:var(--accent-color);">${text}</span>`;
        }
    }



    // --- Settings & Utils ---
    async function loadSettings() {
        const data = await chrome.storage.local.get(['apiKey', 'model', 'language', 'theme']);
        if (data.apiKey) apiKeyInput.value = data.apiKey;
        if (data.model) modelSelect.value = data.model;

        // Language Logic
        if (data.language) {
            const validOptions = ['English', 'Portuguese (Brazil)', 'Spanish'];
            if (validOptions.includes(data.language)) {
                languageSelect.value = data.language;
                customLanguageInput.style.display = 'none';
            } else {
                languageSelect.value = 'Other';
                customLanguageInput.value = data.language;
                customLanguageInput.style.display = 'block';
            }
        }

        if (data.theme) document.documentElement.setAttribute('data-theme', data.theme);
    }

    async function saveSettings() {
        const apiKey = apiKeyInput.value.trim();
        const model = modelSelect.value;

        let language = languageSelect.value;
        if (language === 'Other') {
            language = customLanguageInput.value.trim();
            if (!language) {
                showStatus('Enter a language!', 'error');
                return;
            }
        }

        await chrome.storage.local.set({ apiKey, model, language });
        showStatus('Saved', 'success');
    }

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = type;
        setTimeout(() => { statusMessage.textContent = ''; }, 2000);
    }

    function setupTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        chrome.storage.local.set({ theme: newTheme });
    }

    async function clearCache() {
        if (confirm("Are you sure you want to clear all transcriptions and history? This cannot be undone.")) {
            // Get current settings to preserve them
            const apiKey = apiKeyInput.value;
            const model = modelSelect.value;
            const language = languageSelect.value;
            const theme = document.documentElement.getAttribute('data-theme');

            await chrome.storage.local.clear();

            // Restore settings
            await chrome.storage.local.set({ apiKey, model, language, theme });

            allVoiceMessages = [];
            renderMessagesList();
            showStatus('Cache Cleared', 'success');
        }
    }

    function formatTranscription(data) {
        // data can be:
        // 1. String (Old cache format, just transcript)
        // 2. Object (New cache format, { summary, transcript })

        let summary = '';
        let fullText = '';

        if (typeof data === 'string') {
            fullText = data;
            summary = "Legacy Cache (Re-run to update)";
        } else if (data && typeof data === 'object') {
            summary = data.summary || "No summary available";
            fullText = data.transcript || data.fullText || "";
        }

        return `
            <div class="summary-block">
               <strong>TL;DL</strong><br><br>
               ${summary}
            </div>
            <details style="margin-top:4px; font-size:12px; color:var(--text-secondary);">
                <summary>Read Transcription</summary>
                <p>${fullText}</p>
            </details>
        `;
    }

    async function processWithGemini(base64Audio, settings) {
        const MODEL_NAME = settings.model || 'gemini-3-flash-preview';
        const API_KEY = settings.apiKey;
        const TARGET_LANG = settings.language || 'English';
        const prompt = `Listen to this voice message directly. Transcribe it accurately and then provide a concise summary in ${TARGET_LANG}. Return JSON format: { "transcript": "...", "summary": "..." }`;
        const cleanBase64 = base64Audio.split(',')[1] || base64Audio;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "audio/ogg", data: cleanBase64 } }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error("Gemini API Error Detail:", errData);
            throw new Error(`API Error ${response.status}: ${errData}`);
        }
        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        try { return JSON.parse(text); } catch { return { transcript: text, summary: "Raw output received" }; }
    }
});
