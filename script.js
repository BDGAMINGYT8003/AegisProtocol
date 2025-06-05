// --- DOM Elements ---
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const imageUploadInput = document.getElementById('image-upload-input');
const uploadButton = document.getElementById('upload-button');
const newChatButton = document.getElementById('new-chat-btn');
const historyIcon = document.getElementById('history-icon');
const historyPanel = document.getElementById('history-panel');
const historyCloseButton = document.getElementById('history-close-btn');
const historyList = document.getElementById('history-list');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const initialGreeting = document.getElementById('initial-greeting');
const thinkingIndicator = document.createElement('div');
thinkingIndicator.classList.add('message', 'assistant-message', 'thinking');
thinkingIndicator.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

let currentChatId = null;
let db;

// --- API Configuration ---
const apiKey = 'YOUR_API_KEY'; // Replace with your actual API key
const modelName = 'gemini-1.5-flash-latest'; // Or your desired model
const apiUrlBase = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}`;
const streamApiUrl = `${apiUrlBase}:streamGenerateContent?key=${apiKey}&alt=sse`;

const generationConfig = {
    temperature: 0.7,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
    // stopSequences: [], // Add if needed
};

const safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

const systemInstruction = {
    role: "system",
    parts: [{ text: "You are ChoraAI, a helpful and friendly assistant. Your responses should be informative, concise, and engaging. Format your responses using basic markdown (bold, italics) where appropriate to enhance readability. You can also include lists if it helps clarify information. Avoid overly long paragraphs. For general, casual conversations not related to specific data lookups, keep your responses relatively short and conversational." }]
};

const cryptoSystemInstruction = {
    role: "system",
    parts: [{ text: `You are ChoraAI. The user is asking about a cryptocurrency. Please respond using the following Markdown format, filling it with plausible example data. Clearly state that the data is illustrative and not real-time.
---
{{Coin Name}} ({{Symbol}})
- Current Price: $\{{Current Price}}
- Market Cap: $\{{Market Cap}}
- 24h Trading Volume: $\{{24h Trading Volume}}
- Price Change (24h): {{24h Price Change}}%
- All-Time High: $\{{All-Time High}} (on {{ATH Date}})
- Percent from ATH: {{Percent from ATH}}%
- Total Supply: {{Total Supply}} {{Symbol}}
- Max Supply: {{Max Supply}} {{Symbol}}

Key Price Movements:
- 1 Hour Change: {{1h Change}}%
- 24 Hour Change: {{24h Change}}%
- 7 Day Change: {{7d Change}}%
- 30 Day Change: {{30d Change}}%
- 1 Year Change: {{1y Change}}%

Future Unlocks: {{Future Unlock Info}}
---
If you need additional details or have further questions, feel free to ask! **Remember to state that this data is illustrative.**`}]
};

const cryptoKeywords = [
    '$btc', '$eth', 'bitcoin', 'ethereum', ' price of ', ' market cap of ', ' tokenomics', 'crypto currency',
    'buy bitcoin', 'sell bitcoin', 'bitcoin price', 'ethereum price', 'dogecoin price', 'shiba inu price',
    'cardano price', 'solana price', 'xrp price', 'polkadot price', 'litecoin price', 'binance coin price',
    'what is the price of', 'how to buy', 'trading volume of', 'details for token'
];

let chatHistory = []; // To store the conversation history for the current session (for API calls)

// --- Sound Effects ---
const sendSound = new Audio('send_sound.mp3'); // Replace with actual path if different
const receiveSound = new Audio('receive_sound.mp3'); // Replace with actual path if different
sendSound.volume = 0.3;
receiveSound.volume = 0.3;

// --- Haptics ---
function vibrate(duration) {
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

// --- Markdown Configuration ---
// Assuming marked.js is included in index.html
if (typeof marked !== 'undefined') {
    marked.setOptions({
        breaks: true, // Convert GFM line breaks to <br>
        gfm: true, // Enable GitHub Flavored Markdown
        // sanitize: true, // IMPORTANT: If you allow user input that might contain HTML/JS, enable sanitization or use a dedicated sanitizer.
                       // For this project, only AI responses are parsed, so direct sanitization here might be optional
                       // if the AI's output is trusted or sanitized server-side.
                       // However, for general web apps, always sanitize user-generated content.
    });
} else {
    console.warn("marked.js library not found. Markdown rendering will be basic.");
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    try {
        await openDB();
        loadChatHistory();
        attachEventListeners();
        userInput.focus();
        // displayWelcomeMessage(); // Or some initial state setup
    } catch (error) {
        console.error("Initialization failed:", error);
        if (initialGreeting) {
            initialGreeting.innerHTML = `<h1 class='error-message'>Error initializing storage. Chat history may not work reliably.</h1>`;
            initialGreeting.style.display = 'flex'; // Ensure it's visible
        }
        // Disable input fields if initialization fails
        if (userInput) {
            userInput.placeholder = "Initialization failed. Cannot save chats.";
            userInput.disabled = true;
        }
        if (sendButton) sendButton.disabled = true;
        if (uploadButton) uploadButton.disabled = true;
        // Consider also disabling other features that rely on DB.
    }
}

// --- Event Listeners ---
function attachEventListeners() {
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    userInput.addEventListener('input', autoGrowTextarea);
    uploadButton.addEventListener('click', () => imageUploadInput.click());
    imageUploadInput.addEventListener('change', handleFileChange);
    removeImageBtn.addEventListener('click', clearImageSelection);
    newChatButton.addEventListener('click', startNewChat);
    historyIcon.addEventListener('click', showHistoryPanel);
    historyCloseButton.addEventListener('click', hideHistoryPanel);

    // Click outside to close history panel
    document.addEventListener('click', (event) => {
        // Ensure historyPanel is initialized and the click is outside relevant elements
        if (historyPanel && historyPanel.style.display === 'flex' &&
            !historyPanel.contains(event.target) &&
            !historyIcon.contains(event.target)) {
            // Check if the click target is part of an element that should NOT close the panel
            // This prevents closing when interacting with elements that might open or control other UI parts.
            // Example: if other buttons on the main page should not close history, add them here.
            // For now, only historyPanel and historyIcon are explicitly excluded from closing.
            hideHistoryPanel();
        }
    });
}

// --- Database Operations (IndexedDB) ---
async function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ChoraAIChatDB', 1);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains('chats')) {
                db.createObjectStore('chats', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => {
            console.error("Database error: ", event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

async function addChat(chatData) {
    return new Promise((resolve, reject) => {
        if (!db) {
             console.error("DB not initialized");
             return reject("DB not initialized");
        }
        const transaction = db.transaction(['chats'], 'readwrite');
        const store = transaction.objectStore('chats');
        const request = store.add({ ...chatData, timestamp: new Date() });
        request.onsuccess = (event) => resolve(event.target.result); // Returns new chat ID
        request.onerror = (event) => reject(event.target.error);
    });
}

async function updateChat(chatId, message) {
     return new Promise((resolve, reject) => {
        if (!db) {
             console.error("DB not initialized");
             return reject("DB not initialized");
        }
        const transaction = db.transaction(['chats'], 'readwrite');
        const store = transaction.objectStore('chats');
        const getRequest = store.get(chatId);
        getRequest.onsuccess = () => {
            const chat = getRequest.result;
            if (chat) {
                chat.messages.push(message);
                chat.timestamp = new Date(); // Update timestamp for recent sorting
                const putRequest = store.put(chat);
                putRequest.onsuccess = () => resolve(putRequest.result);
                putRequest.onerror = (event) => reject(event.target.error);
            } else {
                reject('Chat not found');
            }
        };
        getRequest.onerror = (event) => reject(event.target.error);
    });
}

async function getChat(chatId) {
    return new Promise((resolve, reject) => {
        if (!db) {
             console.error("DB not initialized");
             return reject("DB not initialized");
        }
        const transaction = db.transaction(['chats'], 'readonly');
        const store = transaction.objectStore('chats');
        const request = store.get(chatId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getAllChats() {
    return new Promise((resolve, reject) => {
        if (!db) {
             console.error("DB not initialized");
             return reject("DB not initialized");
        }
        const transaction = db.transaction(['chats'], 'readonly');
        const store = transaction.objectStore('chats');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.sort((a, b) => b.timestamp - a.timestamp)); // Sort by newest first
        request.onerror = (event) => reject(event.target.error);
    });
}

async function deleteChatFromDB(chatId) {
    return new Promise((resolve, reject) => {
        if (!db) {
             console.error("DB not initialized");
             return reject("DB not initialized");
        }
        const transaction = db.transaction(['chats'], 'readwrite');
        const store = transaction.objectStore('chats');
        const request = store.delete(chatId);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}


// --- Chat Functionality ---
async function sendMessage() {
    const messageText = userInput.value.trim();
    const imageFile = imageUploadInput.files[0];

    if (!messageText && !imageFile) return;

    if (initialGreeting) initialGreeting.style.display = 'none';
    sendSound.play();
    vibrate(50);

    let userMessageParts = [];
    if (messageText) {
        userMessageParts.push({ text: messageText });
    }

    let displayedUserImage = null; // For UI display
    let apiUserImagePayload = null; // For API

    if (imageFile) {
        try {
            const imageBase64 = await readFileAsDataURL(imageFile);
            displayedUserImage = imageBase64; // For immediate display
            // For API, extract only base64 content, not the full data URL prefix
            apiUserImagePayload = {
                mimeType: imageFile.type,
                inlineData: imageBase64.split(',')[1]
            };
            userMessageParts.push({ inlineData: apiUserImagePayload });
        } catch (error) {
            console.error("Error reading image file:", error);
            displayMessage("Error sending image. Please try again.", 'system');
            return;
        }
    }

    displayMessage(messageText, 'user', displayedUserImage, imageFile ? imageFile.name : null);
    chatHistory.push({ role: "user", parts: userMessageParts });

    // Save user message to DB
    const userMessageForDB = {
        role: 'user',
        content: messageText,
        // Store image as base64 for simplicity in DB, or could be a reference/path
        ...(displayedUserImage && { image: displayedUserImage, imageName: imageFile.name })
    };

    if (currentChatId) {
        await updateChat(currentChatId, userMessageForDB);
    } else {
        // Create a title for the new chat based on the first message
        const title = messageText.substring(0, 30) || (imageFile ? "Image chat" : "New Chat");
        const newChatData = { title: title, messages: [userMessageForDB] };
        currentChatId = await addChat(newChatData);
        loadChatHistory(); // Refresh history panel
    }

    clearInput();
    setInputState(false); // Disable input while AI is thinking
    showThinkingIndicator();

    // Prepare API request body
    // Ensure chatHistory for API does not grow indefinitely if not handled by session logic
    const apiContents = [...chatHistory];
    let activeSystemInstruction = systemInstruction;

    // Crypto keyword detection
    const lowerMessageText = messageText.toLowerCase();
    let isCryptoQuery = false;
    for (const keyword of cryptoKeywords) {
        if (lowerMessageText.includes(keyword)) {
            isCryptoQuery = true;
            break;
        }
    }

    if (isCryptoQuery) {
        activeSystemInstruction = cryptoSystemInstruction;
        console.log("Crypto keyword detected. Using crypto system instruction.");
    }

    // Prepend system instruction if not already there or if it's different
    if (apiContents.length === 0 || apiContents[0].role !== "system") {
        apiContents.unshift(activeSystemInstruction);
    } else if (apiContents[0].role === "system" && isCryptoQuery) {
        // If it's a crypto query and a system instruction exists, replace it with crypto one
        // This assumes we want to override any existing system instruction for crypto queries.
        apiContents[0] = cryptoSystemInstruction;
    } else if (apiContents[0].role === "system" && !isCryptoQuery && apiContents[0] !== systemInstruction) {
        // If not a crypto query but the current system instruction is the crypto one (e.g. from a previous turn), revert to default
        apiContents[0] = systemInstruction;
    }


    const requestBody = {
        contents: apiContents,
        generationConfig,
        safetySettings,
    };

    try {
        await getAIResponseStreaming(requestBody);
    } catch (error) {
        console.error("Error getting AI response:", error);
        hideThinkingIndicator();
        displayMessage(error.message || "Sorry, I couldn't connect to the AI.", 'system');
        chatHistory.push({ role: "model", parts: [{ text: `Error: ${error.message}` }] }); // Save error as AI response
        if (currentChatId) {
            await updateChat(currentChatId, { role: 'system', content: `Error: ${error.message}` });
        }
    } finally {
        setInputState(true); // Re-enable input
        userInput.focus();
    }
}

function displayMessage(text, role, imageUrl = null, imageName = null, elementToUpdate = null) {
    let messageElement = elementToUpdate;
    if (!messageElement) {
        messageElement = document.createElement('div');
        messageElement.classList.add('message', `${role}-message`);
        chatWindow.appendChild(messageElement);
    }

    let contentHTML = '';
    if (text) {
        if (typeof marked !== 'undefined') {
            contentHTML += marked.parse(text);
        } else {
            // Fallback basic formatting if marked.js is not available
            contentHTML += text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                               .replace(/\*(.*?)\*/g, '<em>$1</em>')
                               .replace(/\n/g, '<br>');
        }
    }

    if (imageUrl && !elementToUpdate) { // Only add image if it's a new message
        const uniqueId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        contentHTML += `<div class="message-image-container">
                            <img src="${imageUrl}" alt="${imageName || 'Uploaded Image'}" class="message-image" id="${uniqueId}">
                            <p class="image-name">${imageName || 'Image'}</p>
                        </div>`;
        // Add click listener for full screen view (basic implementation)
        setTimeout(() => {
            const imgElement = document.getElementById(uniqueId);
            if (imgElement) {
                imgElement.addEventListener('click', () => {
                    if (document.fullscreenElement) document.exitFullscreen();
                    else imgElement.requestFullscreen().catch(err => console.error(err));
                });
            }
        }, 0);
    }

    messageElement.innerHTML = contentHTML; // Set or update content

    if (!elementToUpdate) { // Only scroll for new messages
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    if (initialGreeting && initialGreeting.style.display !== 'none') {
        initialGreeting.style.display = 'none';
    }
    return messageElement;
}

async function getAIResponseStreaming(requestBody) {
    if (apiKey === 'YOUR_API_KEY') {
        hideThinkingIndicator();
        displayMessage("Please set your API key in script.js to use the AI.", 'system');
        chatHistory.push({ role: "model", parts: [{text: "API Key not set."}] });
        if(currentChatId) await updateChat(currentChatId, {role: 'system', content: "API Key not set."});
        return;
    }

    hideThinkingIndicator(); // Global thinking indicator removed once streaming starts or an immediate error.
    const aiMessageElement = displayMessage("", 'assistant'); // Create empty bubble for AI response
    let currentText = "";
    let finalAiMessageParts = []; // To store parts for chatHistory

    try {
        const response = await fetch(streamApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error Response:", errorText);
            throw new Error(`API request failed: ${response.status} ${response.statusText}. ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Process Server-Sent Events (SSE)
            let eolIndex;
            while ((eolIndex = buffer.indexOf('\n')) >= 0) {
                const line = buffer.substring(0, eolIndex).trim();
                buffer = buffer.substring(eolIndex + 1);

                if (line.startsWith('data: ')) {
                    const jsonData = JSON.parse(line.substring(5)); // Skip 'data: '
                    if (jsonData.candidates && jsonData.candidates.length > 0) {
                        const content = jsonData.candidates[0].content;
                        if (content && content.parts && content.parts.length > 0) {
                            const part = content.parts[0];
                            if (part.text) {
                                currentText += part.text;
                                finalAiMessageParts.push({ text: part.text }); // Store for history
                                displayMessage(currentText, 'assistant', null, null, aiMessageElement);
                                vibrate(15); // Haptic feedback per chunk
                                chatWindow.scrollTop = chatWindow.scrollHeight; // Keep scrolled to bottom
                            }
                        }
                    }
                }
            }
        }
        if (buffer.trim().startsWith('data: ')) { // Process any remaining buffer
             const jsonData = JSON.parse(buffer.trim().substring(5));
             if (jsonData.candidates && jsonData.candidates.length > 0) {
                const content = jsonData.candidates[0].content;
                if (content && content.parts && content.parts.length > 0) {
                    const part = content.parts[0];
                    if (part.text) {
                        currentText += part.text;
                        finalAiMessageParts.push({ text: part.text });
                        displayMessage(currentText, 'assistant', null, null, aiMessageElement);
                         chatWindow.scrollTop = chatWindow.scrollHeight;
                    }
                }
            }
        }


        if (currentText.trim() === "") { // If AI returned empty or only whitespace
            displayMessage("I received an empty response.", 'assistant', null, null, aiMessageElement);
            finalAiMessageParts.push({ text: "I received an empty response."});
        }

        receiveSound.play();
        vibrate(75);

    } catch (error) {
        console.error("Streaming API error:", error);
        displayMessage(`Error: ${error.message}`, 'assistant', null, null, aiMessageElement);
        finalAiMessageParts.push({ text: `Error: ${error.message}` }); // Store error for history
    } finally {
        chatHistory.push({ role: "model", parts: finalAiMessageParts.length > 0 ? finalAiMessageParts : [{text: "(No textual response)"}] });
        if (currentChatId) {
            // Consolidate parts into a single content string for DB
            const fullAssistantContent = finalAiMessageParts.map(p => p.text).join("");
            await updateChat(currentChatId, { role: 'assistant', content: fullAssistantContent || "(No textual response)" });
        }
        // Ensure chat history doesn't grow excessively without a session refresh mechanism
        if (chatHistory.length > 20) { // Example limit
            // chatHistory.splice(1, chatHistory.length - 10); // Keep system prompt + last 10 exchanges
            // Or simply reset for new context if too long and no explicit session management
            // For this example, we'll let it grow but log a warning.
            console.warn("Chat history for API is growing large. Consider session management.");
        }
    }
}


function showThinkingIndicator(elementToAppendTo = chatWindow) {
    if (elementToAppendTo === chatWindow && chatWindow.contains(thinkingIndicator)) {
        // Already showing global thinking indicator
        return;
    }
    elementToAppendTo.appendChild(thinkingIndicator);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function hideThinkingIndicator(elementToRemoveFrom = chatWindow) {
    if (elementToRemoveFrom.contains(thinkingIndicator)) {
        elementToRemoveFrom.removeChild(thinkingIndicator);
    }
}


function clearInput() {
    userInput.value = '';
    clearImageSelection();
    autoGrowTextarea(); // Reset height and button state
}

// --- UI Enhancements ---
function autoGrowTextarea() {
    userInput.style.height = 'auto'; // Reset height
    userInput.style.height = (userInput.scrollHeight) + 'px';
    setInputState(userInput.value.trim() !== '' || imageUploadInput.files.length > 0);
}

function setInputState(hasContent) {
    if (hasContent) {
        sendButton.classList.add('active');
        sendButton.disabled = false;
    } else {
        sendButton.classList.remove('active');
        sendButton.disabled = true;
    }
}

function handleFileChange(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            imagePreviewContainer.style.display = 'flex';
            uploadButton.style.display = 'none'; // Hide upload icon
            setInputState(true); // Enable send button
        };
        reader.readAsDataURL(file);
    }
}

function clearImageSelection() {
    imageUploadInput.value = ''; // Clear the file input
    imagePreview.src = '#';
    imagePreviewContainer.style.display = 'none';
    uploadButton.style.display = 'inline-flex'; // Show upload icon
    setInputState(userInput.value.trim() !== ''); // Update button based on text input
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}


// --- History Panel ---
function showHistoryPanel() {
    // loadChatHistory(); // Called during initializeApp and after relevant DB changes
    historyPanel.style.display = 'flex';
}

function hideHistoryPanel() {
    historyPanel.style.display = 'none';
}

async function loadChatHistory() {
    const chats = await getAllChats();
    historyList.innerHTML = ''; // Clear existing list
    if (chats && chats.length > 0) {
        chats.forEach(chat => addChatToHistoryList(chat));
    } else {
        historyList.innerHTML = '<li class="history-empty">No chats saved yet.</li>';
    }
}

function addChatToHistoryList(chat) {
    const listItem = document.createElement('li');
    
    const titleDiv = document.createElement('div');
    titleDiv.classList.add('history-item-title');
    titleDiv.textContent = chat.messages[0]?.content?.substring(0, 30) || "Chat " + chat.id;
    if (chat.messages[0]?.image) {
        const imgIndicator = document.createElement('span');
        imgIndicator.textContent = " (image)";
        imgIndicator.classList.add('history-image-indicator');
        titleDiv.appendChild(imgIndicator);
    }
    listItem.appendChild(titleDiv);

    const dateSpan = document.createElement('span');
    dateSpan.classList.add('history-item-date');
    dateSpan.textContent = new Date(chat.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    listItem.appendChild(dateSpan);
    
    listItem.dataset.chatId = chat.id;
    listItem.addEventListener('click', () => loadChat(chat.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '&times;'; // Or an icon
    deleteBtn.classList.add('delete-history-item-btn');
    deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent listItem click event
        // Use titleDiv.textContent for the confirm message, as listItem.textContent might be complex
        if (confirm(`Are you sure you want to delete "${titleDiv.textContent.replace(" (image)","").trim()}"?`)) {
            await deleteChatFromDB(chat.id);
            listItem.remove();
            if (historyList.children.length === 0) {
                historyList.innerHTML = '<li class="history-empty">No chats saved yet.</li>';
            }
            if (currentChatId === chat.id) {
                startNewChat(); // If current chat is deleted, start a new one
            }
        }
    });
    listItem.appendChild(deleteBtn);
    historyList.prepend(listItem); // Add new chats to the top
}


async function loadChat(chatId) {
    const chat = await getChat(chatId);
    if (chat) {
        currentChatId = chatId;
        chatWindow.innerHTML = ''; // Clear current chat
         if (initialGreeting) initialGreeting.style.display = 'none';

        chat.messages.forEach(msg => {
            // This assumes image URLs are stored directly if they were from assistant,
            // or need to be reconstructed/fetched if they were user uploads.
            // For simplicity, let's assume they are stored as data URLs or accessible paths.
            displayMessage(msg.content, msg.role, msg.image);
        });
        hideHistoryPanel();
        userInput.focus();
    }
}

function startNewChat() {
    currentChatId = null;
    chatWindow.innerHTML = '';
    clearInput();
    if (initialGreeting) initialGreeting.style.display = 'block'; // Show greeting
    userInput.focus();
    // Optionally, you might want to clear the history selection or highlight a "New Chat" item
    // loadChatHistory(); // Refresh to ensure no selection highlight if any
}

// --- Utility or Placeholder for Welcome ---
// function displayWelcomeMessage() {
// if (initialGreeting) initialGreeting.style.display = 'block';
// }

// Example of how to use:
// displayMessage("Hello! How can I help you today?", 'assistant');
// displayMessage("Here's an image:", 'assistant', 'https_placeholder.com/path/to/image.jpg', 'Example Image');

console.log("ChoraAI Script Loaded");
