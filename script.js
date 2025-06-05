let isSearchModeActive = false;
let currentImageData = null;
let currentModelId = "gemini-2.5-flash-preview-05-20";

// --- INDEXEDDB SETUP ---
const DB_NAME = 'AegisChatDB';
const SESSIONS_STORE_NAME = 'chatSessions';
let db = null; // Will hold the database instance

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (event) => {
            const tempDb = event.target.result;
            if (!tempDb.objectStoreNames.contains(SESSIONS_STORE_NAME)) {
                tempDb.createObjectStore(SESSIONS_STORE_NAME, { keyPath: 'id' });
            }
            console.log("Database upgrade needed/completed.");
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("Database opened successfully.");
            resolve(db);
        };

        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject(event.target.error);
        };
    });
}

async function saveChatSession(sessionData) {
    try {
        const currentDb = await openDB();
        const transaction = currentDb.transaction(SESSIONS_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SESSIONS_STORE_NAME);
        store.put(sessionData); // put will add or update
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                console.log(`Session ${sessionData.id} saved/updated successfully.`);
                resolve();
            };
            transaction.onerror = (event) => {
                console.error(`Error saving session ${sessionData.id}:`, event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Failed to open DB for saving session:", error);
        return Promise.reject(error);
    }
}

async function getChatSession(sessionId) {
    try {
        const currentDb = await openDB();
        const transaction = currentDb.transaction(SESSIONS_STORE_NAME, 'readonly');
        const store = transaction.objectStore(SESSIONS_STORE_NAME);
        const request = store.get(sessionId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error(`Error getting session ${sessionId}:`, event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Failed to open DB for getting session:", error);
        return Promise.reject(error);
    }
}

async function getAllChatSessions() {
    try {
        const currentDb = await openDB();
        const transaction = currentDb.transaction(SESSIONS_STORE_NAME, 'readonly');
        const store = transaction.objectStore(SESSIONS_STORE_NAME);
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error("Error getting all sessions:", event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Failed to open DB for getting all sessions:", error);
        return Promise.reject(error);
    }
}
// --- END INDEXEDDB SETUP ---

// --- CRYPTO DATA HANDLING ---
function isCryptoQuery(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    // Simple checks: token symbols like $BTC, $ETH, keywords
    if (/\$[A-Z]{2,5}\b/.test(text)) return true; // $TOKEN
    const keywords = [
        "price of", "market cap of", "volume of", "24h change", "all-time high",
        "bitcoin", "ethereum", "crypto", "cryptocurrency", "token", "coin"
    ];
    if (keywords.some(kw => lowerText.includes(kw))) return true;
    return false;
}

function formatCryptoDataToHTML(data) {
    if (!data || typeof data !== 'object') {
        return "<p><em>Could not retrieve or parse cryptocurrency data.</em></p>";
    }

    // Helper to safely get value or return 'N/A'
    const get = (value, prefix = "", suffix = "") => (value !== undefined && value !== null && value !== 'N/A') ? `${prefix}${value}${suffix}` : "N/A";
    const getPercent = (value) => (value !== undefined && value !== null && !isNaN(parseFloat(value))) ? `${parseFloat(value).toFixed(2)}%` : "N/A";

    let html = `<div class="crypto-data-card">`;
    html += `<h3>${get(data.coinName)} (${get(data.symbol)})</h3>`;
    html += `<ul>`;
    html += `<li><strong>Current Price:</strong> ${get(data.currentPrice, "$")}</li>`;
    html += `<li><strong>Market Cap:</strong> ${get(data.marketCap, "$")}</li>`;
    html += `<li><strong>24h Trading Volume:</strong> ${get(data.volume24h, "$")}</li>`;
    html += `<li><strong>Price Change (24h):</strong> <span class="${parseFloat(data.priceChange24h) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.priceChange24h)}</span></li>`;
    html += `<li><strong>All-Time High:</strong> ${get(data.allTimeHigh, "$")} (on ${get(data.athDate)})</li>`;
    html += `<li><strong>Percent from ATH:</strong> ${getPercent(data.percentFromAth)}</li>`;
    html += `<li><strong>Total Supply:</strong> ${get(data.totalSupply)}</li>`;
    html += `<li><strong>Max Supply:</strong> ${get(data.maxSupply || "N/A")}</li>`;
    html += `</ul>`;
    html += `<h4>Price Movements:</h4>`;
    html += `<ul>`;
    html += `<li><strong>1h:</strong> <span class="${parseFloat(data.change1h) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.change1h)}</span></li>`;
    html += `<li><strong>24h:</strong> <span class="${parseFloat(data.change24h) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.change24h)}</span></li>`;
    html += `<li><strong>7d:</strong> <span class="${parseFloat(data.change7d) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.change7d)}</span></li>`;
    html += `<li><strong>30d:</strong> <span class="${parseFloat(data.change30d) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.change30d)}</span></li>`;
    html += `<li><strong>1y:</strong> <span class="${parseFloat(data.change1y) >= 0 ? 'crypto-positive' : 'crypto-negative'}">${getPercent(data.change1y)}</span></li>`;
    html += `</ul>`;
    if (data.futureUnlocks) { // Only show if data exists
        html += `<h4>Future Unlocks:</h4><p>${get(data.futureUnlocks)}</p>`;
    }
    html += `</div>`;
    return html;
}
// --- END CRYPTO DATA HANDLING ---


// --- CHAT HISTORY DATA STRUCTURES ---
let chatSessions = []; // In-memory cache of sessions, loaded from DB
let currentChatSessionId = null;
// --- END CHAT HISTORY DATA STRUCTURES ---

const availableModels = [
    {
        id: "gemini-2.5-flash-preview-05-20",
        label: "Aegis Core Pro",
        capabilities: { think: true, search: true, attach: true }
    },
    {
        id: "gemini-2.0-flash",
        label: "Aegis Core",
        capabilities: { think: false, search: true, attach: true }
    },
    {
        id: "gemini-2.0-flash-lite",
        label: "Aegis Lite",
        shortLabel: "Aegis Lite",
        capabilities: { think: false, search: false, attach: true }
    }
];
const GEMINI_API_KEY = "AIzaSyCL0lyAzof7p-R8d8QhExCwNWiZE0WiaXQ";

// Initialize Marked.js options
if (typeof marked !== 'undefined') {
    marked.setOptions({
        gfm: true,          // Enable GitHub Flavored Markdown
        breaks: false,       // CHANGED FROM true
        pedantic: false     // Be less strict about Markdown syntax
        // Note: `sanitize` option is deprecated. For robust sanitization, an external library
        // like DOMPurify would be needed in conjunction with Marked.js.
        // Relying on Marked.js's default escaping for now.
    });
} else {
    console.error("Marked.js library not loaded. Markdown rendering will not be available.");
}

// The above key is now set. The placeholder comment below can be removed or kept for reference.
// Assume GEMINI_API_KEY will be set globally, e.g.
// const GEMINI_API_KEY = "YOUR_ACTUAL_API_KEY"; // Needs to be set by the user/environment


// --- CHAT HISTORY SIDEBAR RENDERING ---
function renderChatHistorySidebar() {
    const sidebar = document.querySelector('.sidebar'); // Assuming the sidebar div has class 'sidebar'
    if (!sidebar) {
        console.error("Sidebar element not found for rendering chat history.");
        return;
    }
    // First child of sidebar is the placeholder <p>Chat History</p> or a "New Chat" button
    let firstChild = sidebar.firstChild;
    sidebar.innerHTML = ''; // Clear existing items, but preserve the first child (e.g. New Chat button)
    if (firstChild) { // Re-append the first child if it existed
        sidebar.appendChild(firstChild);
    }


    // Add a "New Chat" button if it doesn't exist (or handle its existence)
    let newChatButton = sidebar.querySelector('.new-chat-button');
    if (!newChatButton) {
        newChatButton = document.createElement('button');
        newChatButton.textContent = '➕ New Chat';
        newChatButton.className = 'new-chat-button action-button'; // Reuse styles
        newChatButton.style.width = 'calc(100% - 20px)'; // Adjust width
        newChatButton.style.margin = '10px';
        newChatButton.style.justifyContent = 'center';
        newChatButton.addEventListener('click', () => {
            createNewChatSession();
        });
        // sidebar.insertBefore(newChatButton, sidebar.firstChild); // Add to top
        // Let's decide where to put it. If firstChild was placeholder, replace it. Otherwise, prepend.
        if (firstChild && firstChild.tagName === 'P' && firstChild.textContent.includes("Chat History")) {
             sidebar.replaceChild(newChatButton, firstChild);
        } else {
            sidebar.insertBefore(newChatButton, sidebar.firstChild);
        }
    }


    const historyItemsContainer = document.createElement('div');
    historyItemsContainer.className = 'chat-history-items';
    sidebar.appendChild(historyItemsContainer);

    chatSessions.sort((a, b) => b.createdAt - a.createdAt); // Show newest first

    if (chatSessions.length === 0) {
        const noChatsMessage = document.createElement('p');
        noChatsMessage.textContent = 'No chat sessions yet.';
        noChatsMessage.style.textAlign = 'center';
        noChatsMessage.style.padding = '10px';
        noChatsMessage.style.color = 'var(--text-secondary)';
        historyItemsContainer.appendChild(noChatsMessage);
    } else {
        chatSessions.forEach(session => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'chat-history-item';
            itemDiv.textContent = session.title || `Chat ${new Date(session.createdAt).toLocaleTimeString()}`;
            itemDiv.dataset.sessionId = session.id;
            if (session.id === currentChatSessionId) {
                itemDiv.classList.add('active-chat-session');
            }
            itemDiv.addEventListener('click', () => switchChatSession(session.id));
            historyItemsContainer.appendChild(itemDiv);
        });
    }
    console.log("Chat history sidebar rendered.");
}
// --- END CHAT HISTORY SIDEBAR RENDERING ---

// --- CORE CHAT SESSION FUNCTIONS ---
async function createNewChatSession() {
    const newSessionId = Date.now().toString();
    const newSession = {
        id: newSessionId,
        title: null,
        messages: [],
        createdAt: Date.now()
    };

    // Add to in-memory cache first
    const existingSessionIndex = chatSessions.findIndex(s => s.id === newSessionId);
    if (existingSessionIndex > -1) {
        chatSessions[existingSessionIndex] = newSession;
    } else {
        chatSessions.push(newSession);
    }
    currentChatSessionId = newSessionId;

    try {
        await saveChatSession(newSession); // Save to IndexedDB
        console.log(`New chat session ${newSessionId} saved to DB.`);
    } catch (error) {
        console.error(`Failed to save new session ${newSessionId} to DB:`, error);
        // Potentially handle UI feedback for save failure if critical
    }

    const conversationContent = document.getElementById('conversation-content');
    if (conversationContent) conversationContent.innerHTML = '';

    clearAttachedImage();
    const chatInputField = document.getElementById('chat-input-field');
    if (chatInputField) chatInputField.innerText = '';

    console.log(`Created new chat session: ${newSessionId}`);
    renderChatHistorySidebar();
    return newSessionId;
}

function switchChatSession(sessionId) {
    if (currentChatSessionId === sessionId && document.getElementById('conversation-content').children.length > 0) {
        console.log(`Session ${sessionId} is already active.`);
        return; // Avoid reloading if already active and populated
    }
    const session = chatSessions.find(s => s.id === sessionId);
    if (!session) {
        console.error(`Session ${sessionId} not found.`);
        return createNewChatSession(); // Or handle error appropriately
    }

    currentChatSessionId = sessionId;
    const conversationContent = document.getElementById('conversation-content');
    if (conversationContent) conversationContent.innerHTML = ''; // Clear current messages

    session.messages.forEach(msg => {
        // Use stored HTML for assistant, otherwise use text. Image URL also from stored message.
        const contentToDisplay = msg.sender === 'assistant' && msg.html ? msg.html : msg.text;
        displayMessage(contentToDisplay, msg.sender, msg.sender === 'assistant' && msg.html, msg.imageUrl);
    });

    clearAttachedImage();
    const chatInputField = document.getElementById('chat-input-field');
    if (chatInputField) chatInputField.innerText = '';

    console.log(`Switched to chat session: ${sessionId}`);
    renderChatHistorySidebar(); // Highlight active session
}

async function addMessageToCurrentChat(sender, text, htmlContent = null, imageUrl = null) {
    if (!currentChatSessionId) {
        console.warn("No currentChatSessionId. Attempting to create a new session.");
        await createNewChatSession(); // Ensure a session exists and is set as current
        if (!currentChatSessionId) { // If still no ID after creation attempt
             console.error("Critical: Failed to create or set a current chat session ID.");
             return;
        }
    }

    let session = chatSessions.find(s => s.id === currentChatSessionId);
    if (!session) {
        console.warn(`Session ${currentChatSessionId} not found in memory. Attempting to fetch from DB or create new.`);
        session = await getChatSession(currentChatSessionId);
        if (session) {
            // Add to in-memory cache
            const existingSessionIndex = chatSessions.findIndex(s => s.id === currentChatSessionId);
            if (existingSessionIndex > -1) chatSessions[existingSessionIndex] = session;
            else chatSessions.push(session);
        } else {
            console.warn(`Session ${currentChatSessionId} also not in DB. Creating new.`);
            await createNewChatSession(); // This will set currentChatSessionId and add to chatSessions
            session = chatSessions.find(s => s.id === currentChatSessionId); // Get the newly created session
            if (!session) {
                 console.error("Critical: Failed to create and retrieve a new session after multiple attempts.");
                 return;
            }
        }
    }


    const message = {
        sender,
        text: text,
        html: htmlContent,
        imageUrl,
        timestamp: Date.now()
    };
    session.messages.push(message);

    let titleChanged = false;
    if (sender === 'user' && !session.title && text) {
        session.title = text.substring(0, 30) + (text.length > 30 ? "..." : "");
        titleChanged = true;
    }

    try {
        await saveChatSession(session); // Save updated session to IndexedDB
        console.log(`Message added and session ${session.id} updated in DB.`);
        if (titleChanged) {
            renderChatHistorySidebar(); // Update sidebar if title changed
        }
    } catch (error) {
        console.error(`Failed to save session ${session.id} after adding message:`, error);
    }

    const contentToDisplay = (sender === 'assistant' || sender === 'error') && htmlContent ? htmlContent : text;
    const isHTML = (sender === 'assistant' || sender === 'error') && htmlContent != null;
    displayMessage(contentToDisplay, sender, isHTML, imageUrl);

    console.log(`Added message to session ${currentChatSessionId}:`, message);
}
// --- END CORE CHAT SESSION FUNCTIONS ---


// --- UI FUNCTION: displayMessage (Purely for UI rendering) ---
// Accepts an optional messageId to identify the message div for streaming updates
function displayMessage(content, sender, isHTML = false, imageUrl = null, messageId = null) {
    const conversationContent = document.getElementById('conversation-content');
    if (!conversationContent) {
        console.error("Error: conversation-content element not found for displayMessage.");
        return null;
    }

    let messageDiv = messageId ? document.getElementById(messageId) : null;
    let textContentElement = null; // Specific element to hold text/HTML content
    let messageContentWrapper = null;

    if (messageDiv) {
        messageContentWrapper = messageDiv.querySelector('.message-content');
        // Ensure message-content exists, then find/create message-text-content within it
        if (!messageContentWrapper) {
            // This case implies the messageDiv itself might be the direct container, or structure is unexpected.
            // For robustness, ensure .message-content exists.
            messageContentWrapper = document.createElement('div');
            messageContentWrapper.classList.add('message-content');
            // Move existing children of messageDiv into new wrapper if any, or clear messageDiv
            while (messageDiv.firstChild) {
                 messageContentWrapper.appendChild(messageDiv.firstChild);
            }
            messageDiv.appendChild(messageContentWrapper);
        }
        textContentElement = messageContentWrapper.querySelector('.message-text-content');
        if (!textContentElement) {
            textContentElement = document.createElement('div');
            textContentElement.classList.add('message-text-content');
            messageContentWrapper.appendChild(textContentElement);
        }
    } else {
        messageDiv = document.createElement('div');
        if (messageId) messageDiv.id = messageId;
        messageDiv.classList.add('message', sender + '-message');

        messageContentWrapper = document.createElement('div');
        messageContentWrapper.classList.add('message-content');

        if (imageUrl) {
            const imgElement = document.createElement('img');
            imgElement.src = imageUrl;
            imgElement.alt = sender === 'user' ? "User attachment" : "Assistant image";
            imgElement.style.maxWidth = '200px';
            imgElement.style.maxHeight = '200px';
            imgElement.style.borderRadius = '8px';
            // Margin if text/placeholder will follow, or if it's an assistant message being prepared for stream
            imgElement.style.marginBottom = (content || (sender === 'assistant' && messageId && messageId.startsWith("stream-"))) ? '8px' : '0';
            messageContentWrapper.appendChild(imgElement);
        }

        textContentElement = document.createElement('div');
        textContentElement.classList.add('message-text-content'); // Use a specific class for the content part
        messageContentWrapper.appendChild(textContentElement);
        messageDiv.appendChild(messageContentWrapper);
        conversationContent.appendChild(messageDiv);
    }

    if (!textContentElement) {
        console.error("Text content element could not be found or created for message:", messageId || "new message");
        return messageDiv;
    }

    // Set content (even if empty for initial stream bubble)
    if (isHTML) {
        textContentElement.innerHTML = content || "";
        if (sender === 'assistant') { // Apply copy buttons only on final HTML render
            addCopyButtonsToCodeBlocks(textContentElement);
        }
    } else {
        // When streaming, content will be the full accumulated text.
        // For initial empty bubble, content will be "".
        textContentElement.textContent = content || "";
    }

    conversationContent.scrollTop = conversationContent.scrollHeight;
    return messageDiv;
}
// --- END UI FUNCTION ---

function updateButtonCapabilities(capabilities) {
    const thinkButton = document.querySelector('.action-button i.fa-lightbulb')?.closest('.action-button');
    const searchButton = document.querySelector('.action-button i.fa-globe')?.closest('.action-button');
    // const attachButton = document.querySelector('.action-button i.fa-paperclip')?.closest('.action-button');

    if (thinkButton) {
        thinkButton.disabled = !capabilities.think;
    }
    if (searchButton) {
        searchButton.disabled = !capabilities.search;
        if (!capabilities.search && isSearchModeActive) {
            isSearchModeActive = false;
            searchButton.classList.remove('search-button-active');
            console.log("Search mode deactivated due to model change not supporting search.");
        }
    }
    // if (attachButton) { // Example for attach capability
    //     attachButton.disabled = !capabilities.attach;
    // }
    console.log("Button capabilities updated for current model:", capabilities);
}

function clearAttachedImage() { // Renamed and refactored
    const imageUploadInput = document.getElementById('image-upload-input'); // Keep for resetting value
    const attachmentPreviewArea = document.getElementById('attachment-preview-area');
    const attachmentThumbnail = document.getElementById('attachment-thumbnail');

    currentImageData = null;
    if (attachmentPreviewArea) attachmentPreviewArea.style.display = 'none';
    if (attachmentThumbnail) attachmentThumbnail.src = '#';
    if (imageUploadInput) imageUploadInput.value = null;
    console.log("Attachment cleared.");
}

function createRipple(event) {
    const button = event.currentTarget;

    const ripple = document.createElement("span");
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    ripple.style.width = ripple.style.height = `${diameter}px`;
    // Get click position relative to the button
    const rect = button.getBoundingClientRect();
    ripple.style.left = `${event.clientX - rect.left - radius}px`;
    ripple.style.top = `${event.clientY - rect.top - radius}px`;

    ripple.classList.add("ripple");

    // Check if there's an old ripple and remove it (though with timeout this might not be strictly necessary)
    const oldRipple = button.querySelector(".ripple");
    if (oldRipple) {
        oldRipple.remove();
    }

    button.appendChild(ripple);

    // Remove ripple after animation
    setTimeout(() => {
        if (ripple.parentElement) { // Check if still part of DOM
            ripple.remove();
        }
    }, 600); // Match animation duration
}

async function callGeminiAPI(inputText, thinkingBudget = 0, enableSearchTool = false) { // Removed image params
    console.log("callGeminiAPI: Parameters", { inputText, thinkingBudget, enableSearchTool /*, imageData for future */ });

    if (typeof GEMINI_API_KEY === 'undefined' || !GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set.");
        // Use await as addMessageToCurrentChat is async
        await addMessageToCurrentChat('error', "API Key is not configured.", "<b>API Key Error:</b> API Key is not configured.");
        return; // Return undefined (or null) as it's an async function
    }

    const streamId = `stream-${Date.now()}`;
    // Create an empty placeholder message in history and UI for the assistant's response.
    // The message object in chatSessions will be created/updated by addMessageToCurrentChat.
    // We pass empty text and null HTML initially. The message.id will be streamId.
    await addMessageToCurrentChat('assistant', '', null, null, streamId);

    const assistantMessageDiv = document.getElementById(streamId);
    // The actual text content will go into the '.message-text-content' child
    const assistantTextElement = assistantMessageDiv ? assistantMessageDiv.querySelector('.message-text-content') : null;

    if (!assistantMessageDiv || !assistantTextElement) {
        console.error("Could not create or find assistant message bubble for streaming.");
        // Attempt to log error into a new message if the placeholder failed, or update existing if somehow only textElement is missing
        await addMessageToCurrentChat('error', "Internal error: Could not display AI response.", "<b>Display Error</b>", null, streamId + "-error"); // Use a different ID for this error msg
        return;
    }

    // const MODEL_ID = "gemini-2.5-flash-preview-05-20"; // REMOVE THIS LINE
    // The global 'currentModelId' variable (defined outside) will be used here.
    const GENERATE_CONTENT_API = "streamGenerateContent";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModelId}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}`;

    let effectiveEnableSearchTool = enableSearchTool;
    const cryptoQueryDetected = isCryptoQuery(inputText);
    if (cryptoQueryDetected) {
        effectiveEnableSearchTool = true; // Force search for crypto queries
    }

    const baseSystemInstruction = "You are Aegis Protocol, an AI-driven gateway that unites DeFi, GameFi, and Real-World Assets under a single intelligent framework. Your tasks include providing real-time token analytics, automating asset tokenization validation, and optimizing gaming economies. Uphold the principles of transparency, interpretability, and consumer protection. When offering recommendations, cite on-chain data points, market trends, and risk assessments. Always ensure users can trace how your conclusions were derived. Use proper markdown formatting including headings, lists, code blocks, tables, and other formatting elements.";

    let cryptoSystemInstruction = "";
    if (cryptoQueryDetected) {
        cryptoSystemInstruction = `\n\nIMPORTANT: The user's query appears to be about cryptocurrencies. Please use your search tool to get the latest data. Return the information in a JSON object format, enclosed between '%%%CRYPTO_DATA_START%%%' and '%%%CRYPTO_DATA_END%%%'. The JSON object should have the following fields: "coinName", "symbol", "currentPrice", "marketCap", "volume24h", "priceChange24h", "allTimeHigh", "athDate", "percentFromAth", "totalSupply", "maxSupply", "change1h", "change24h", "change7d", "change30d", "change1y", "futureUnlocks". Ensure all numerical values are returned as strings to preserve formatting (e.g. "123.45", not 123.45), but represent percentage changes as numbers where appropriate for direct use (e.g. for 'percentFromAth', 'change1h', etc., return values like -2.5 for -2.5%). If some data is unavailable, use 'N/A' as the string value for that field. After the '%%%CRYPTO_DATA_END%%%' marker, you can add a brief natural language summary or commentary if you wish, but the primary data must be in the JSON block.`;
    }

    const requestBody = {
        contents: [{ role: "user", parts: [] }],
        generationConfig: {
            thinkingConfig: { thinkingBudget },
            temperature: 0.7, topP: 0.8, topK: 40, maxOutputTokens: 8192,
            responseMimeType: "text/plain",
        },
        systemInstruction: {
            parts: [{ text: baseSystemInstruction + cryptoSystemInstruction }]
        }
    };

    if (effectiveEnableSearchTool) { // Use the potentially updated flag
        requestBody.tools = [ { "urlContext": {} }, { "googleSearch": {} } ];
    }

    const parts = [];
    // The user's actual query. The crypto instruction is now part of the system prompt.
    const userQueryPrompt = `User Query: ${inputText || ""}`;
    parts.push({ text: userQueryPrompt });


    if (currentImageData && currentImageData.base64Data && currentImageData.mimeType) {
        // If there's an image, the text part should ideally describe or relate to the image.
        // For now, we're just appending the image after the main text.
        parts.push({
            inline_data: {
                mime_type: currentImageData.mimeType,
                data: currentImageData.base64Data
            }
        });
        console.log(`callGeminiAPI: Preparing multimodal request with model: ${currentModelId}`, { text: inputText, imageMime: currentImageData.mimeType });
    }

    if (parts.length === 0 || (parts.length === 1 && parts[0].text.trim() === "User Query:")) { // Check if only "User Query:" is there
        const errorMsg = "Input Error: Please provide text or an image to send.";
        if (assistantTextElement) { // Check if element exists before updating
            assistantTextElement.innerHTML = `<b>${errorMsg}</b>`;
        }
        // Update the stored message to reflect this error state instead of being empty
        await addMessageToCurrentChat('assistant', errorMsg, `<b>${errorMsg}</b>`, null, streamId);
        return;
    }
    requestBody.contents[0].parts = parts;
    console.log("callGeminiAPI: Constructed parts for API request", JSON.stringify(parts, (key, value) => {
        if (key === 'data' && typeof value === 'string' && value.length > 50) { // Snippet for base64 data in parts
            return value.substring(0, 30) + "... (truncated)";
        }
        return value;
    }, 2));
    console.log("callGeminiAPI: Full requestBody for API", JSON.stringify(requestBody, (key, value) => {
        if (key === 'data' && typeof value === 'string' && value.length > 50) { // Snippet for base64 data in requestBody
            return value.substring(0, 30) + "... (truncated)";
        }
        return value;
    }, 2));

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        // if (spinnerContainer) spinnerContainer.style.display = 'none'; // Hide spinner // REMOVED

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error:", response.status, errorText);
            const displayError = `<b>API Error ${response.status}:</b> ${errorText.substring(0, 200)}`;
            if (assistantTextElement) assistantTextElement.innerHTML = displayError; // Check if element exists
            // Update the stored message to reflect this error
            await addMessageToCurrentChat('assistant', `API Error ${response.status}: ${errorText}`, displayError, null, streamId);
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let buffer = ""; // Buffer for incomplete JSON chunks

        // Placeholder for stream processing loop (will be added in next step)
        // For now, let's simulate a final response after a delay to test structure
        // In the next step, this will be replaced with the actual stream reading loop.

        // SIMULATED DELAY & RESPONSE (REMOVE/REPLACE IN NEXT STEP)
        // await new Promise(resolve => setTimeout(resolve, 1000));
        // accumulatedText = "This is a simulated streamed response.\n\n- Point 1\n- Point 2\n\n```javascript\nconsole.log('simulated');\n```";
        // console.log("Simulated stream finished.");
        // END OF SIMULATION

        // The actual stream processing loop will go here.
        // For now, the rest of the function (final processing) will assume accumulatedText is populated by the (future) loop.

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            
            // Process buffer line by line (assuming newline-delimited JSON objects)
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.substring(0, newlineIndex).trim();
                buffer = buffer.substring(newlineIndex + 1);

                // Skip empty lines or lines that are just array delimiters or commas from stream formatting
                if (line.length === 0 || line === "[" || line === "]" || line === ",") continue;

                try {
                    // Clean the line: remove leading/trailing commas if they exist from partial reads
                    // This is important as chunks might split JSON objects or arrays of them.
                    let cleanedLine = line.replace(/^,|,$/g, '').trim();
                    if (cleanedLine.length === 0) continue;

                    const parsedChunk = JSON.parse(cleanedLine);
                    // Accessing the text based on Gemini's typical stream structure
                    if (parsedChunk.candidates && parsedChunk.candidates[0] &&
                        parsedChunk.candidates[0].content &&
                        parsedChunk.candidates[0].content.parts &&
                        parsedChunk.candidates[0].content.parts[0] &&
                        parsedChunk.candidates[0].content.parts[0].text) {

                        const textPart = parsedChunk.candidates[0].content.parts[0].text;
                        accumulatedText += textPart;
                        if (assistantTextElement) assistantTextElement.textContent = accumulatedText; // Live update with plain text

                        // Scroll to bottom
                        if (conversationContent) conversationContent.scrollTop = conversationContent.scrollHeight;

                        // Update in-memory session incrementally for resilience, but don't save to DB on every chunk
                        const session = chatSessions.find(s => s.id === currentChatSessionId);
                        if (session) {
                            const messageToUpdate = session.messages.find(m => m.id === streamId);
                            if (messageToUpdate) {
                                messageToUpdate.text = accumulatedText; // Keep raw text updated
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Error parsing streamed JSON chunk:", e, "Chunk considered:", `"${line}"`);
                    // Don't let a single bad chunk stop the whole stream if possible.
                    // Could accumulate problematic lines for debugging if needed.
                }
            }
        }
        // Process any remaining buffer content (e.g. if the stream didn't end with a newline)
        if (buffer.trim().length > 0) {
             try {
                let cleanedLine = buffer.trim().replace(/^,|,$/g, '');
                if (cleanedLine.length > 0 && cleanedLine !== "[" && cleanedLine !== "]") {
                    const parsedChunk = JSON.parse(cleanedLine);
                     if (parsedChunk.candidates && parsedChunk.candidates[0].content &&
                         parsedChunk.candidates[0].content.parts &&
                         parsedChunk.candidates[0].content.parts[0] &&
                         parsedChunk.candidates[0].content.parts[0].text) {
                        const textPart = parsedChunk.candidates[0].content.parts[0].text;
                        accumulatedText += textPart;
                        if (assistantTextElement) assistantTextElement.textContent = accumulatedText;
                    }
                }
            } catch (e) {
                console.warn("Error parsing final buffered JSON chunk:", e, "Buffer:", `"${buffer.trim()}"`);
            }
        }

        // If after stream processing, accumulatedText is still empty (and UI was empty), provide a message.
        if (accumulatedText === "" && assistantTextElement && assistantTextElement.textContent === "") {
             console.warn("Stream was empty or contained no processable text parts after full processing.");
             accumulatedText = "Received an empty or unparseable response from the AI.";
             if (assistantTextElement) assistantTextElement.textContent = accumulatedText;
        }

        // Final processing after stream is complete
        let finalHtmlContent = accumulatedText;
        let successfullyParsedCryptoData = false;

        if (cryptoQueryDetected && accumulatedText.includes("%%%CRYPTO_DATA_START%%%") && accumulatedText.includes("%%%CRYPTO_DATA_END%%%")) {
            const startIndex = accumulatedText.indexOf("%%%CRYPTO_DATA_START%%%") + "%%%CRYPTO_DATA_START%%%".length;
            const endIndex = accumulatedText.indexOf("%%%CRYPTO_DATA_END%%%");
            const jsonString = accumulatedText.substring(startIndex, endIndex).trim();

            try {
                const cryptoData = JSON.parse(jsonString);
                finalHtmlContent = formatCryptoDataToHTML(cryptoData);
                successfullyParsedCryptoData = true;
                
                // Optional: Extract any text *after* the crypto data block as commentary
                const commentary = accumulatedText.substring(endIndex + "%%%CRYPTO_DATA_END%%%".length).trim();
                if (commentary) {
                    finalHtmlContent += `<div class="ai-commentary">${ (typeof marked !== 'undefined') ? marked.parse(commentary) : commentary }</div>`;
                }

            } catch (e) {
                console.error("Error parsing crypto JSON data:", e, "JSON String:", jsonString);
                finalHtmlContent = `<p><em>Error parsing structured cryptocurrency data. Displaying raw data instead:</em></p>` +
                                   ((typeof marked !== 'undefined') ? marked.parse(accumulatedText) : `<pre>${accumulatedText}</pre>`);
            }
        } else if (cryptoQueryDetected && !accumulatedText.includes("%%%CRYPTO_DATA_START%%%")) {
             finalHtmlContent = `<p><em>AI did not return structured data for the crypto query. Displaying standard response:</em></p>` +
                                   ((typeof marked !== 'undefined') ? marked.parse(accumulatedText) : `<pre>${accumulatedText}</pre>`);
        }

        // If not crypto data or parsing failed, use standard markdown
        if (!successfullyParsedCryptoData && !(cryptoQueryDetected && finalHtmlContent.includes("<em>"))) { // Avoid re-processing if error message already set
            if (typeof marked !== 'undefined') {
                let processedTextForMarkdown = accumulatedText
                    .replace(/\n\n\n+/g, '\n\n')
                    .replace(/^\s+/gm, '')
                    .trim();
                processedTextForMarkdown = processedTextForMarkdown.replace(/^(#+\s.+)$/gm, '\n$1\n');
                finalHtmlContent = marked.parse(processedTextForMarkdown);
            } else {
                console.error("Marked.js not available for final rendering.");
                // finalHtmlContent remains accumulatedText (plain text)
            }
        }

        if (assistantTextElement) {
            assistantTextElement.innerHTML = finalHtmlContent;
            addCopyButtonsToCodeBlocks(assistantTextElement);
        }

        const session = chatSessions.find(s => s.id === currentChatSessionId);
        if (session) {
            const messageToUpdate = session.messages.find(m => m.id === streamId);
            if (messageToUpdate) {
                messageToUpdate.text = accumulatedText; // Save the raw accumulated text
                messageToUpdate.html = finalHtmlContent; // Save the final parsed HTML
                // messageToUpdate.timestamp = parseInt(streamId.split('-').pop()); // Timestamp already set via ID
                await saveChatSession(session);
                console.log("Stream finished, assistant message updated in DB:", messageToUpdate);
            } else {
                 console.error("Could not find message in session to update after stream: ", streamId);
            }
        } else {
            console.error("Could not find session to update after stream: ", currentChatSessionId);
        }
        // Ensure conversation scrolls to the bottom
        if (conversationContent) conversationContent.scrollTop = conversationContent.scrollHeight;

    } catch (error) {
        console.error("Fetch or Streaming Error in callGeminiAPI:", error);
        const errorMsg = `Streaming Error: ${error.message}. Please check console.`;
        if (assistantTextElement) assistantTextElement.innerHTML = `<b>${errorMsg}</b>`;
        // Update the stored message with the error
        await addMessageToCurrentChat('assistant', errorMsg, `<b>${errorMsg}</b>`, null, streamId);
    }
}

document.querySelectorAll('.action-button, .model-selector, .send-button, .legacy-search-link').forEach(button => {
        button.addEventListener('click', (e) => {
        // Apply ripple to specific button types
        if (button.classList.contains('action-button') ||
            button.classList.contains('send-button') ||
            button.classList.contains('model-selector')) {
            createRipple(e);
        }

        e.preventDefault(); // Keep this early

        const chatInputField = document.getElementById('chat-input-field');
        const rawInputText = chatInputField ? chatInputField.innerText.trim() : ""; // Keep raw text for API

        // Search button (fa-globe)
        if (button.classList.contains('action-button') && button.querySelector('i.fa-globe')) {
            isSearchModeActive = !isSearchModeActive;
            button.classList.toggle('search-button-active');
            console.log("Search mode toggled:", isSearchModeActive);
        }
        // Think button
        else if (button.classList.contains('action-button') && button.querySelector('i.fa-lightbulb')) {
            if (!rawInputText && !currentImageData) {
                addMessageToCurrentChat('error', "Please enter text or attach an image to use the 'Think' feature.", "<b>Input Error:</b> Please provide text or an image for the 'Think' feature.");
                console.log("Input and attachment are empty, 'Think' button not calling API.");
            } else {
                const userMessageText = rawInputText || "Thinking about the attached image...";
                // Add user's "thought" to chat history and display it
                addMessageToCurrentChat('user', userMessageText, null, currentImageData ? currentImageData.dataURLForPreview : null);

                console.log("Think Button: Before callGeminiAPI", {
                    inputText: rawInputText, // Send raw text to API
                    isSearchModeActive: isSearchModeActive,
                    // currentImageData is already global for callGeminiAPI
                });
                callGeminiAPI(rawInputText, 24576, isSearchModeActive);
                // "Think" button does not clear input field or image attachment
            }
        }
        // Send button
        else if (button.classList.contains('send-button')) {
            if (!rawInputText && !currentImageData) {
                addMessageToCurrentChat('error', "Please type a message or attach an image to send.", "<b>Input Error:</b> Please type a message or attach an image.");
                console.log("Input and attachment are empty, 'Send' button not calling API.");
            } else {
                // Add user's message to chat history and display it
                // If only image, use a placeholder text or handle as needed
                const userMessageText = rawInputText || (currentImageData ? "Image attached" : "");
                addMessageToCurrentChat('user', userMessageText, null, currentImageData ? currentImageData.dataURLForPreview : null);

                console.log("Send Button: Before callGeminiAPI", {
                    inputText: rawInputText, // Send raw text to API
                    isSearchModeActive: isSearchModeActive,
                    // currentImageData is already global for callGeminiAPI
                });
                callGeminiAPI(rawInputText, 0, isSearchModeActive);

                // Clear input after sending
                if (chatInputField) chatInputField.innerText = '';
                clearAttachedImage(); // Clear attachment after sending
            }
        }
        // Attach button (fa-paperclip)
        else if (button.classList.contains('action-button') && button.querySelector('i.fa-paperclip')) {
            const imageUploadInput = document.getElementById('image-upload-input');
            if (imageUploadInput) {
                imageUploadInput.click(); // Trigger file picker dialog
            } else {
                console.error("Image upload input element not found!");
            }
        }
        // Model selector
        else if (button.classList.contains('model-selector')) {
            const dropdown = document.getElementById('model-dropdown-list');
            if (dropdown) {
                const isVisible = dropdown.style.display === 'block';
                dropdown.style.display = isVisible ? 'none' : 'block';
                console.log("Model dropdown toggled:", !isVisible);
            }
        }
        // Legacy search link
        else if (button.classList.contains('legacy-search-link')) {
            alert("This would redirect to legacy Google Search in a real implementation.");
        }
    });
});

// Model dropdown population and handling
// Model dropdown population and handling (DOMContentLoaded part 1)
document.addEventListener('DOMContentLoaded', () => {
    const dropdown = document.getElementById('model-dropdown-list');
    const selectedModelLabel = document.getElementById('selected-model-label');

    if (dropdown && selectedModelLabel) { // Ensure selectedModelLabel also exists
        availableModels.forEach(model => {
            const item = document.createElement('div');
            item.className = 'model-dropdown-item';
            if (model.id === currentModelId) {
                item.classList.add('selected-model-item');
            }
            item.textContent = model.label;
            item.dataset.modelId = model.id;

            item.addEventListener('click', () => {
                currentModelId = model.id;
                selectedModelLabel.textContent = (model.id === "gemini-2.0-flash-lite") ? model.shortLabel : model.label;
                document.querySelectorAll('.model-dropdown-item').forEach(i => i.classList.remove('selected-model-item'));
                item.classList.add('selected-model-item');
                updateButtonCapabilities(model.capabilities);
                dropdown.style.display = 'none';
                console.log("Model changed to:", model.label, "capabilities:", model.capabilities);
            });
            dropdown.appendChild(item);
        });

        const defaultModel = availableModels.find(m => m.id === currentModelId);
        if (defaultModel) {
            updateButtonCapabilities(defaultModel.capabilities);
            // Set initial label correctly
            selectedModelLabel.textContent = (defaultModel.id === "gemini-2.0-flash-lite") ? defaultModel.shortLabel : defaultModel.label;
        }
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const modelDropdownList = document.getElementById('model-dropdown-list');
        const modelSelectorContainer = document.querySelector('.model-selector-container'); // Target container
        
        if (modelDropdownList && modelSelectorContainer && !modelSelectorContainer.contains(e.target)) {
            modelDropdownList.style.display = 'none';
        }
    });
});

// Existing script content follows...

// Image upload handling
document.getElementById('image-upload-input')?.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (file) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }

        // Validate file size (e.g., 10MB limit)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            alert('File size must be less than 10MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const dataURL = e.target.result;
            const base64Data = dataURL.split(',')[1]; // Remove data:image/...;base64, prefix
            
            // Store image data globally
            currentImageData = {
                mimeType: file.type,
                base64Data: base64Data,
                dataURLForPreview: dataURL
            };

            // Show preview
            const attachmentPreviewArea = document.getElementById('attachment-preview-area');
            const attachmentThumbnail = document.getElementById('attachment-thumbnail');
            
            if (attachmentPreviewArea && attachmentThumbnail) {
                attachmentThumbnail.src = dataURL;
                attachmentPreviewArea.style.display = 'block';
            }

            console.log('Image uploaded:', {
                name: file.name,
                type: file.type,
                size: file.size,
                base64Length: base64Data.length
            });
        };
        reader.readAsDataURL(file);
    }
});

// Remove attachment button
document.getElementById('remove-attachment-button')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearAttachedImage();
});

// Handle Enter key in text input with enhanced features
document.getElementById('chat-input-field')?.addEventListener('keydown', (e) => { // UPDATED selector
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sendButton = document.querySelector('.send-button');
        if (sendButton) {
            sendButton.click(); // This will trigger the send button's click logic
        }
    }
});

// Auto-resize text input based on content
document.getElementById('chat-input-field')?.addEventListener('input', (e) => { // UPDATED selector
    const element = e.target;
    // Basic auto-resize, can be improved. For div contenteditable, scrollHeight might not be direct.
    // This part might need refinement for contenteditable div height.
    // For now, simple focus on enabling/disabling send button.
    const hasContent = element.innerText.trim().length > 0 || currentImageData !== null; // Consider image too
    const sendButton = document.querySelector('.send-button');
    
    if (sendButton) {
        sendButton.disabled = !hasContent;
        sendButton.style.opacity = hasContent ? '1' : '0.5'; // Example styling
    }

    // Basic auto-expand for contenteditable div (might need more robust solution)
    element.style.height = 'auto'; // Reset height
    let newHeight = Math.min(element.scrollHeight, 120); // Max height 120px
    if (newHeight < 30) newHeight = 30; // Min height (approx 1 line)
    element.style.height = newHeight + 'px';

});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter to send message
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const sendButton = document.querySelector('.send-button');
        if (sendButton && !sendButton.disabled) {
            sendButton.click();
        }
    }
    
    // Escape to clear input
    if (e.key === 'Escape') {
        const textInput = document.getElementById('chat-input-field'); // UPDATED selector
        if (textInput && textInput.innerText.trim()) { // Changed from textContent
            textInput.innerText = ''; // Changed from textContent
            // Also potentially clear image on Escape? For now, just text.
            // clearAttachedImage(); // Optional: uncomment to also clear image
            textInput.focus();
            // Manually trigger input event to update send button state
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            textInput.dispatchEvent(inputEvent);
        } else if (textInput && currentImageData) { // If text is empty but image exists, clear image
            clearAttachedImage();
             // Manually trigger input event to update send button state
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            textInput.dispatchEvent(inputEvent);
        }
    }
});

// Improve mobile scrolling performance
if ('ontouchstart' in window) {
    document.body.style.webkitOverflowScrolling = 'touch';
}

// Function to add copy buttons to code blocks
function addCopyButtonsToCodeBlocks(container) {
    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach(block => {
        const pre = block.parentElement;
        if (pre && !pre.querySelector('.copy-button')) {
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button';
            copyButton.innerHTML = '<i class="fas fa-copy"></i>';
            copyButton.title = 'Copy code';
            copyButton.style.cssText = `
                position: absolute;
                top: 8px;
                right: 8px;
                background: var(--button-bg); /* Use theme variable */
                border: 1px solid var(--button-border); /* Use theme variable */
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 12px;
                color: var(--text-secondary); /* Use theme variable */
                transition: all 0.2s ease;
            `;
            copyButton.addEventListener('mouseover', () => {
                copyButton.style.background = 'var(--button-bg-hover)';
                copyButton.style.color = 'var(--text-primary)';
            });
            copyButton.addEventListener('mouseout', () => {
                copyButton.style.background = 'var(--button-bg)';
                copyButton.style.color = 'var(--text-secondary)';
            });
            
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(block.textContent).then(() => {
                    copyButton.innerHTML = '<i class="fas fa-check"></i>';
                    copyButton.style.color = 'var(--accent-cyan)'; // Use theme variable
                    setTimeout(() => {
                        copyButton.innerHTML = '<i class="fas fa-copy"></i>';
                        copyButton.style.color = 'var(--text-secondary)'; // Reset to original
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    copyButton.innerHTML = '<i class="fas fa-times"></i>'; // Error icon
                    copyButton.style.color = 'var(--google-red)'; // Error color
                     setTimeout(() => {
                        copyButton.innerHTML = '<i class="fas fa-copy"></i>';
                        copyButton.style.color = 'var(--text-secondary)';
                    }, 2000);
                });
            });
            
            // Ensure pre has position relative for absolute positioning of button
            if (window.getComputedStyle(pre).position === 'static') {
                pre.style.position = 'relative';
            }
            pre.appendChild(copyButton);
        }
    });
}


// Initial setup (DOMContentLoaded part 2 - Chat History and Send Button)
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await openDB(); // Ensure DB is open and upgraded if necessary
        const loadedSessions = await getAllChatSessions();
        if (loadedSessions && loadedSessions.length > 0) {
            chatSessions = loadedSessions.sort((a, b) => b.createdAt - a.createdAt); // Newest first
            currentChatSessionId = chatSessions[0].id; // Load the most recent session

            // Ensure the current session's messages are loaded into the UI
            // switchChatSession already handles loading messages for the given ID
            // and also clears input fields.
            switchChatSession(currentChatSessionId);
            console.log(`Loaded ${chatSessions.length} sessions from DB. Current session: ${currentChatSessionId}`);
        } else {
            console.log("No sessions found in DB, creating a new one.");
            await createNewChatSession(); // Create and save a new session
        }
    } catch (error) {
        console.error("Error during initial DB setup or session loading:", error);
        // Fallback to creating a new session if DB operations fail critically
        if (chatSessions.length === 0) {
             console.warn("Fallback: Creating a new in-memory session due to DB load failure.");
             await createNewChatSession(); // This will attempt to save it too.
        }
    }

    renderChatHistorySidebar(); // Render sidebar with loaded/new sessions

    // Send button initial state (remains the same)
    const chatInputField = document.getElementById('chat-input-field');
    const sendButton = document.querySelector('.send-button');
    if (chatInputField && sendButton) {
        const hasContent = chatInputField.innerText.trim().length > 0 || currentImageData !== null;
        sendButton.disabled = !hasContent;
        sendButton.style.opacity = hasContent ? '1' : '0.5';
    }
});

console.log("Aegis Protocol DeFi Gateway (Chat Mode with History) loaded successfully!");