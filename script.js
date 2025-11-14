let isSearchModeActive = false;
// Removed: attachedImageBase64, attachedImageMimeType, fullDataUrlForPreview
let currentImageData = null; // Will store { mimeType, base64Data, dataURLForPreview }
let currentModelId = "gemini-2.5-flash-preview-05-20"; // Default model

// --- IndexedDB Setup ---
const DB_NAME = 'AegisAIChatDB';
const STORE_NAME = 'chatSessions';
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
                const store = dbInstance.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
                store.createIndex('sessionId_idx', 'sessionId', { unique: true });
                console.log(`IndexedDB: Object store '${STORE_NAME}' created.`);
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB: Database initialized successfully.');
            // Load chat histories once DB is successfully initialized
            loadAllChatHistoriesUI().catch(err => {
                console.error("Error loading chat histories on init, attempting to start new chat:", err);
                // Attempt to start a new chat as a fallback if history loading fails critically
                startNewChat().catch(startErr => console.error("Fallback startNewChat also failed:", startErr));
            });
            resolve(db);
        };

        request.onerror = (event) => {
            const errorMsg = 'IndexedDB: Error opening database: ' + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true, 10000); // Longer duration for critical init error
            else alert(errorMsg); // Fallback if displayStatusMessage isn't ready
            reject(event.target.error);
        };
    });
}

function saveMessageToSession(sessionId, sender, text) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB: Database not initialized.');
            return reject('Database not initialized.');
        }

        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(sessionId);

        getRequest.onsuccess = (event) => {
            let session = event.target.result;
            const newMessage = { sender, text, timestamp: Date.now() };
            let titleUpdatedInDb = false;

            if (!session) {
                // This case means createNewChatSessionInDB might have failed or wasn't called.
                // Create a new session object here as a fallback.
                console.warn(`Session ${sessionId} not found. Creating new session object within saveMessageToSession.`);
                const newTitle = (sender === 'user' && text.trim() !== "") ? text.substring(0, 30) + (text.length > 30 ? "..." : "") : "New Chat...";
                session = {
                    sessionId,
                    timestamp: Date.now(),
                    messages: [newMessage],
                    chatTitle: newTitle
                };
                // If this is a new user message creating the session, the title is set.
                // The UI for history list item should ideally be created by the caller.
            } else {
                // Session exists, add message and update timestamp.
                session.messages.push(newMessage);
                session.timestamp = Date.now();

                // Check if this is the first user message and the title is still the default "New Chat...".
                const userMessagesCount = session.messages.filter(m => m.sender === 'user').length;
                if (sender === 'user' && userMessagesCount === 1 && session.chatTitle === "New Chat..." && text.trim() !== "") {
                    const newTitle = text.substring(0, 30) + (text.length > 30 ? "..." : "");
                    session.chatTitle = newTitle;
                    titleUpdatedInDb = true; // Mark that the session object being put to DB has the new title
                }
            }

            const putRequest = store.put(session);

            putRequest.onsuccess = () => {
                console.log(`IndexedDB: Message saved to session '${sessionId}'.`);
                if (titleUpdatedInDb) {
                    // Update the UI list item title to match the new title in DB
                    updateChatHistoryItemTitle(sessionId, session.chatTitle);
                    console.log(`IndexedDB: Chat title updated for session '${sessionId}' to '${session.chatTitle}' and UI refreshed.`);
                }
                resolve();
            };
            putRequest.onerror = (event) => {
                const errorMsg = `IndexedDB: Error saving message to session '${sessionId}': ` + event.target.error.message;
                console.error(errorMsg, event.target.error);
                if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
                reject(event.target.error);
            };
        };

        getRequest.onerror = (event) => {
            const errorMsg = `IndexedDB: Error retrieving session '${sessionId}' for saving: ` + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };

        transaction.onerror = (event) => {
            const errorMsg = 'IndexedDB: Transaction error in saveMessageToSession: ' + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };
    });
}

function getSessionMessages(sessionId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB: Database not initialized.');
            return reject('Database not initialized.');
        }

        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(sessionId);

        request.onsuccess = (event) => {
            const session = event.target.result;
            if (session && session.messages) {
                console.log(`IndexedDB: Messages retrieved for session '${sessionId}'.`);
                resolve(session.messages);
            } else {
                console.log(`IndexedDB: No session or messages found for session '${sessionId}'.`);
                resolve([]); // Resolve with empty array if no session or messages
            }
        };

        request.onerror = (event) => {
            const errorMsg = `IndexedDB: Error retrieving messages for session '${sessionId}': ` + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };

        transaction.onerror = (event) => {
            const errorMsg = 'IndexedDB: Transaction error in getSessionMessages: ' + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };
    });
}

// Modified to save to DB and return a Promise with the session object
async function createNewChatSessionInDB() {
    return new Promise((resolve, reject) => {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const newSession = {
            sessionId: sessionId,
            timestamp: Date.now(), // Main session timestamp
            messages: [],
            chatTitle: "New Chat..."
        };

        if (!db) {
            console.error('IndexedDB: Database not initialized for createNewChatSessionInDB.');
            return reject('Database not initialized for creating session.');
        }
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(newSession); // Add the new session object

        request.onsuccess = () => {
            console.log(`IndexedDB: New chat session '${newSession.sessionId}' persisted with title: '${newSession.chatTitle}'.`);
            resolve(newSession);
        };
        request.onerror = (event) => {
            const errorMsg = `IndexedDB: Error persisting new chat session '${newSession.sessionId}': ` + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };
    });
}

// Renamed from getAllSessions for clarity
function getAllSessionsFromDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error('IndexedDB: Database not initialized.');
            // No displayStatusMessage here as it's a common check before DB operations.
            return reject('Database not initialized.');
        }
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (event) => {
            console.log('IndexedDB: All sessions retrieved.');
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            const errorMsg = 'IndexedDB: Error retrieving all sessions: ' + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(event.target.error);
        };
    });
}
// --- End IndexedDB Setup ---

let currentChatSessionId = null;

// --- Chat History UI Functions ---
// Adds or updates an item in the history UI list.
function addOrUpdateChatHistoryUI(sessionId, title, isActive = false) {
    const historyList = document.getElementById('chat-history-list');
    if (!historyList) {
        console.warn("#chat-history-list element not found. Cannot update history UI.");
        return;
    }

    let listItem = historyList.querySelector(`li[data-session-id="${sessionId}"]`);

    if (listItem) { // Update existing item's title
        listItem.textContent = title;
    } else { // Create new item
        listItem = document.createElement('li');
        listItem.dataset.sessionId = sessionId;
        listItem.textContent = title;
        listItem.addEventListener('click', () => { // Removed async from event listener directly
            loadChatSession(sessionId).catch(err => console.error("Error loading session from history click:", err));
        });
        historyList.prepend(listItem); // Add new items to the top
    }

    if (isActive) {
        setActiveChatHistoryItem(sessionId);
    }
}

// Sets the visual active state for a chat history item.
function setActiveChatHistoryItem(sessionId) {
    const historyList = document.getElementById('chat-history-list');
    if (!historyList) return;

    historyList.querySelectorAll('li').forEach(li => {
        li.classList.remove('active-chat-session');
    });

    const activeListItem = historyList.querySelector(`li[data-session-id="${sessionId}"]`);
    if (activeListItem) {
        activeListItem.classList.add('active-chat-session');
    } else {
        console.warn(`Attempted to set active history item for non-existent session ID: ${sessionId}`);
    }
}

// Updates the title of an existing chat history item in the UI.
function updateChatHistoryItemTitle(sessionId, newTitle) {
    const historyList = document.getElementById('chat-history-list');
    if (!historyList) return;

    const listItem = historyList.querySelector(`li[data-session-id="${sessionId}"]`);
    if (listItem) {
        listItem.textContent = newTitle;
    } else {
        console.warn(`Attempted to update title for non-existent history item with session ID: ${sessionId}`);
    }
}
// --- End Chat History UI Functions ---

// --- DB Helper Functions for Session Object ---
function getSessionFromDB(sessionId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("getSessionFromDB: DB not initialized");
            return reject("DB not initialized");
        }
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
            const errorMsg = "getSessionFromDB error: " + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(request.error);
        };
    });
}

function saveSessionToDB(sessionObject) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("saveSessionToDB: DB not initialized");
            // No displayStatusMessage here
            return reject("DB not initialized");
        }
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(sessionObject); // put will add or update
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
            const errorMsg = "saveSessionToDB error: " + event.target.error.message;
            console.error(errorMsg, event.target.error);
            if(typeof displayStatusMessage === 'function') displayStatusMessage(errorMsg, true);
            reject(request.error);
        };
    });
}
// --- End DB Helper Functions ---

// --- Main Chat Session Logic ---
async function startNewChat() {
    console.log("Starting new chat...");
    const messageList = document.getElementById('message-list');
    const chatInput = document.getElementById('chat-message-input');

    if(messageList) messageList.innerHTML = '';
    if(chatInput) chatInput.value = '';

    clearAttachedImage();

    try {
        const newSession = await createNewChatSessionInDB();
        if (!newSession || !newSession.sessionId) {
            throw new Error("Failed to create new session in DB.");
        }
        currentChatSessionId = newSession.sessionId;

        addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);
        showChatView();
        // Render an ephemeral welcome message, not saved to DB
        renderMessage('ai', "New chat session started. Ask me anything!", false);
        console.log("Started new chat session:", currentChatSessionId);
        if(chatInput) chatInput.focus();
    } catch (error) {
        console.error("Failed to start new chat:", error);
        alert("Could not start a new chat session. Please check console for details.");
    }
}

async function loadChatSession(sessionId) {
    if (!sessionId) {
        console.warn("loadChatSession called with no sessionId.");
        return;
    }
    console.log("Loading chat session:", sessionId);

    const messageList = document.getElementById('message-list');
    if (!messageList) {
        console.error("Cannot load session: message list element not found.");
        return;
    }
    messageList.innerHTML = '';

    clearAttachedImage();
    currentChatSessionId = sessionId;

    try {
        const session = await getSessionFromDB(sessionId);
        if (session && session.messages && session.messages.length > 0) {
            session.messages.forEach(msg => renderMessage(msg.sender, msg.text, false));
        } else if (session) {
            renderMessage('ai', "This chat is empty. Send a message to start!", false);
        } else {
            console.warn(`Session ${sessionId} not found in DB. Starting a new one as fallback.`);
            await startNewChat();
            return;
        }

        setActiveChatHistoryItem(sessionId);
        // Ensure title in UI is current, even if it was "New Chat..." initially
        addOrUpdateChatHistoryUI(sessionId, session.chatTitle || "Chat " + sessionId.substring(0,8) , true);
        showChatView();
        const chatInput = document.getElementById('chat-message-input');
        if(chatInput) chatInput.focus();

    } catch (error) {
        console.error(`Error loading chat session ${sessionId}:`, error);
        renderMessage('system', "Error loading this chat session.", false);
    }
}

async function loadAllChatHistoriesUI() {
    const historyList = document.getElementById('chat-history-list');
    if (!historyList) {
        console.warn("#chat-history-list not found during loadAllChatHistoriesUI");
        return;
    }
    historyList.innerHTML = '';

    try {
        const sessions = await getAllSessionsFromDB();
        if (sessions && sessions.length > 0) {
            sessions.sort((a, b) => b.timestamp - a.timestamp);

            sessions.forEach(session => {
                const title = session.chatTitle || (session.messages && session.messages.length > 0 ? session.messages[0].text.substring(0, 30) + '...' : "Chat " + session.sessionId.substring(0,8));
                addOrUpdateChatHistoryUI(session.sessionId, title, false);
            });

            // Decide if we auto-load the most recent. For now, no.
            // User can click or start new.
            // If you want to auto-load the most recent and make it active:
            // await loadChatSession(sessions[0].sessionId);
            // setActiveChatHistoryItem(sessions[0].sessionId); // loadChatSession also calls this
        } else {
            console.log("No chat sessions found in DB. User can start a new one.");
            // Optionally, automatically start a new chat if none exist:
            // await startNewChat();
        }
    } catch (error) {
        console.error("Error loading all chat histories:", error);
    }
}
// --- End Main Chat Session Logic ---

// --- DB Helper Functions for Session Object ---
function getSessionFromDB(sessionId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("getSessionFromDB: DB not initialized");
            return reject("DB not initialized");
        }
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(sessionId);
        request.onsuccess = () => resolve(request.result); // Result will be the session object or undefined
        request.onerror = (event) => {
            console.error("getSessionFromDB error for session", sessionId, event.target.error);
            reject(request.error);
        };
    });
}

function saveSessionToDB(sessionObject) {
    return new Promise((resolve, reject) => {
        if (!db) {
            console.error("saveSessionToDB: DB not initialized");
            return reject("DB not initialized");
        }
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(sessionObject); // put will add or update
        request.onsuccess = () => {
            console.log("Session object saved/updated in DB:", sessionObject.sessionId);
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error("saveSessionToDB error for session", sessionObject.sessionId, event.target.error);
            reject(request.error);
        };
    });
}
// --- End DB Helper Functions ---

// --- Main Chat Session Logic ---
async function startNewChat() {
    console.log("Starting new chat...");
    const messageList = document.getElementById('message-list');
    const chatInput = document.getElementById('chat-message-input');

    if(messageList) messageList.innerHTML = ''; // Clear visual messages
    if(chatInput) chatInput.value = '';    // Clear text input

    clearAttachedImage(); // Clear any image from main input/preview

    try {
        const newSession = await createNewChatSessionInDB(); // This creates and saves the stub
        if (!newSession || !newSession.sessionId) {
            throw new Error("Failed to create and persist new session in DB.");
        }
        currentChatSessionId = newSession.sessionId;

        addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true); // Add "New Chat..." to UI and set active
        showChatView(); // Switch to chat view (this also clears messages, but good to be explicit)

        // Render an ephemeral welcome message, not saved to DB. 'thinking' is false.
        renderMessage('ai', "New chat session started. Ask me anything!", false);
        console.log("UI prepared for new chat session:", currentChatSessionId);
        if(chatInput) chatInput.focus();
    } catch (error) {
        console.error("Failed to start new chat:", error);
        // Optionally, inform the user via a UI element if starting a new chat fails critically
        alert("Could not start a new chat session. Please check console for details and refresh if issues persist.");
    }
}

async function loadChatSession(sessionId) {
    if (!sessionId) {
        console.warn("loadChatSession called with no sessionId.");
        return;
    }
    console.log("Loading chat session:", sessionId);

    const messageList = document.getElementById('message-list');
    if (!messageList) {
        console.error("Cannot load session: message list element not found.");
        return;
    }
    messageList.innerHTML = ''; // Clear current visual messages

    clearAttachedImage(); // Clear any image from main input/preview when switching sessions
    currentChatSessionId = sessionId;

    try {
        const session = await getSessionFromDB(sessionId); // Retrieve the session

        if (session) {
            if (session.messages && session.messages.length > 0) {
                session.messages.forEach(msg => renderMessage(msg.sender, msg.text, false));
            } else {
                // Session exists but is empty
                renderMessage('ai', "This chat is empty. Send a message to start!", false);
            }
            // Update UI with the correct title from DB and set active
            addOrUpdateChatHistoryUI(sessionId, session.chatTitle || "Chat " + sessionId.substring(0,8), true);
        } else {
            console.warn(`Session ${sessionId} not found in DB. Starting a new chat as fallback.`);
            // This case should ideally not happen if UI is correctly synced with DB.
            // If it does, starting a new chat might be confusing if user clicked an old session.
            // For robustness, we could create a new session with this ID or just go to a blank new chat.
            // For now, let's just inform and possibly switch to search view or a new chat.
            renderMessage('system', `Could not load session ${sessionId.substring(0,8)}. Please start a new chat.`, false);
            setActiveChatHistoryItem(null); // No session is active
            // Optionally, could redirect to search view or auto-start a new chat:
            // showSearchView();
            // await startNewChat(); // This would create another "New Chat..." entry.
            return;
        }

        showChatView(); // Ensure chat view is visible
        const chatInput = document.getElementById('chat-message-input');
        if(chatInput) chatInput.focus();

    } catch (error) {
        console.error(`Error loading chat session ${sessionId}:`, error);
        renderMessage('system', "Error loading this chat session. Please try again.", false);
    }
}

async function loadAllChatHistoriesUI() {
    const historyList = document.getElementById('chat-history-list');
    if (!historyList) {
        console.warn("#chat-history-list not found during loadAllChatHistoriesUI");
        return;
    }
    historyList.innerHTML = ''; // Clear current list before loading

    try {
        const sessions = await getAllSessionsFromDB();
        if (sessions && sessions.length > 0) {
            sessions.sort((a, b) => b.timestamp - a.timestamp); // Sort newest first

            sessions.forEach(session => {
                const title = session.chatTitle || (session.messages && session.messages.length > 0 ? session.messages[0].text.substring(0, 30) + '...' : "Chat " + session.sessionId.substring(0,8));
                addOrUpdateChatHistoryUI(session.sessionId, title, false); // false: don't make active yet
            });

            // If no currentChatSessionId is set (e.g. on first load and no specific session loaded yet)
            // and we want to auto-load the most recent one:
            if (!currentChatSessionId && sessions[0]) {
                 console.log("Auto-loading most recent session on startup:", sessions[0].sessionId);
                 await loadChatSession(sessions[0].sessionId);
            } else if (currentChatSessionId) {
                // Ensure the currently loaded session (if any) is marked active in the re-rendered list
                setActiveChatHistoryItem(currentChatSessionId);
            }

        } else {
            console.log("No chat sessions found in DB. Starting a new chat by default.");
            await startNewChat(); // Start a new chat if DB is empty
        }
    } catch (error) {
        console.error("Error loading all chat histories:", error);
        // Potentially show an error to the user or attempt to start a new chat as a fallback
         await startNewChat(); // Fallback to a new chat on error
    }
}
// --- End Main Chat Session Logic ---

// --- UI Polish and Error Handling ---
function displayStatusMessage(message, isError = true, duration = 5000) {
    const statusElement = document.getElementById('chat-status-message');
    if (!statusElement) {
        console.error("Chat status message element not found.");
        return;
    }
    statusElement.textContent = message;
    statusElement.style.color = isError ? 'var(--google-red)' : 'var(--text-primary)'; // Or a success color
    statusElement.style.display = 'block';

    setTimeout(() => {
        statusElement.style.display = 'none';
    }, duration);
}

// --- End UI Polish and Error Handling ---

// --- View Switching Functions ---
function showSearchView() {
    const searchInterface = document.querySelector('.search-interface');
    const chatContainer = document.getElementById('chat-container');

    if (!searchInterface) {
        console.error("Search interface element (.search-interface) not found.");
        return;
    }
    if (!chatContainer) {
        console.error("Chat container element (#chat-container) not found.");
        return;
    }

    document.body.classList.remove('chat-active');

    chatContainer.style.pointerEvents = 'none';
    chatContainer.style.opacity = '0';

    setTimeout(() => {
        chatContainer.style.display = 'none';

        searchInterface.style.display = 'flex'; // Or its default display type
        // Force reflow
        void searchInterface.offsetWidth;

        searchInterface.style.opacity = '1';
        searchInterface.style.pointerEvents = 'auto';
        console.log("Switched to Search View");
    }, 300); // Match CSS transition duration (0.3s)
}

function showChatView() {
    const searchInterface = document.querySelector('.search-interface');
    const chatContainer = document.getElementById('chat-container');
    const messageList = document.getElementById('message-list');
    const chatMessageInput = document.getElementById('chat-message-input');

    if (!searchInterface) {
        console.error("Search interface element (.search-interface) not found.");
        return;
    }
    if (!chatContainer) {
        console.error("Chat container element (#chat-container) not found.");
        return;
    }
    if (!messageList) console.warn("Message list element (#message-list) not found in showChatView."); // Warn as it's for clearing
    if (!chatMessageInput) console.warn("Chat message input (#chat-message-input) not found in showChatView."); // Warn as it's for clearing

    document.body.classList.add('chat-active');

    searchInterface.style.pointerEvents = 'none';
    searchInterface.style.opacity = '0';

    setTimeout(() => {
        searchInterface.style.display = 'none';

        chatContainer.style.display = 'flex'; // Or its default display type
        // Force reflow
        void chatContainer.offsetWidth;

        chatContainer.style.opacity = '1';
        chatContainer.style.pointerEvents = 'auto';

        // Clear previous chat content when switching to chat view
        if (messageList) messageList.innerHTML = '';
        if (chatMessageInput) {
            chatMessageInput.value = '';
            // chatMessageInput.focus(); // Focusing handled by startNewChat/loadChatSession
        }
        console.log("Switched to Chat View");
    }, 300); // Match CSS transition duration
}

// Initial setup on DOMContentLoaded for view states
document.addEventListener('DOMContentLoaded', () => {
    const searchInterface = document.querySelector('.search-interface');
    const chatContainer = document.getElementById('chat-container');

    if (searchInterface) {
        searchInterface.style.opacity = '1'; // Start with search view visible
        searchInterface.style.pointerEvents = 'auto';
    }
    if (chatContainer) {
        chatContainer.style.opacity = '0';
        chatContainer.style.display = 'none'; // Start with chat view hidden
        chatContainer.style.pointerEvents = 'none';
    }
    // ... other DOMContentLoaded logic ...
});
// --- End View Switching Functions ---

// --- Message Rendering Function ---
// Added isErrorMessage parameter
function renderMessage(sender, text, thinking = false, isErrorMessage = false) {
    const messageList = document.getElementById('message-list');
    if (!messageList) {
        console.error("Message list element not found!");
        return null;
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender === 'user' ? 'user-message' : 'ai-message');
    if (isErrorMessage) { // Now correctly references the parameter
        messageDiv.classList.add('error-message');
    }

    // Optional: Add avatar placeholder
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    // avatarDiv.textContent = sender === 'user' ? 'U' : 'AI'; // Simple text avatar
    // Or use icons (ensure Font Awesome is linked in index.html if you use its classes)
    const avatarIcon = document.createElement('i');
    avatarIcon.classList.add('fas', sender === 'user' ? 'fa-user-astronaut' : 'fa-robot');
    avatarDiv.appendChild(avatarIcon);
    messageDiv.appendChild(avatarDiv);

    const messageContentDiv = document.createElement('div');
    messageContentDiv.classList.add('message-content');

    if (sender === 'ai' && thinking && !isErrorMessage) { // Don't show thinking for error messages
        const thinkingIndicator = document.createElement('span');
        thinkingIndicator.classList.add('thinking-indicator');
        thinkingIndicator.innerHTML = '<span>.</span><span>.</span><span>.</span>';
        messageContentDiv.appendChild(thinkingIndicator);
    } else {
        // For user messages, AI messages (once content arrives), or error messages
        if (typeof marked !== 'undefined' && !isErrorMessage) { // Parse markdown if not an error message
            messageContentDiv.innerHTML = marked.parse(text);
            // Add copy buttons to code blocks if it's an AI message with code
             if (sender === 'ai' && text.includes('```')) { // Basic check for code block
                addCopyButtonsToCodeBlocks(messageContentDiv);
            }
        } else {
            messageContentDiv.textContent = text; // Plain text for errors or if marked is not available
        }
    }

    messageDiv.appendChild(messageContentDiv);
    messageList.appendChild(messageDiv);

    // Scroll to the bottom of the message list
    messageList.scrollTop = messageList.scrollHeight;

    return messageContentDiv; // Return the content div for potential updates (streaming)
}
// --- End Message Rendering Function ---

// --- UI Polish and Error Handling ---
// (displayStatusMessage is already added above this section)

function toggleSendButtonState(chatInput, sendButton, disabled) {
    if (sendButton) sendButton.disabled = disabled;
    if (chatInput && disabled) chatInput.disabled = true; // Optionally disable input too
    if (chatInput && !disabled) chatInput.disabled = false;
}

// --- End UI Polish and Error Handling ---

// This is a new function as requested.
function toggleChatSendButtonState(disabled) {
    const chatSendButton = document.getElementById('chat-send-button');
    const chatMessageInput = document.getElementById('chat-message-input');
    if (chatSendButton) {
        chatSendButton.disabled = disabled;
    }
    // Optionally disable input as well, or just style it
    // if (chatMessageInput) {
    //     chatMessageInput.disabled = disabled;
    // }
}

// --- Crypto Query Handling ---
function isCryptoQuery(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    // Regex for symbols like $BTC, $ETH, etc.
    const symbolRegex = /\$[A-Z]{2,6}\b/;
    // Keywords for price, info, market cap
    const keywords = [
        "price of", "what is", "info on", "market cap", "marketcap",
        "current price", "details on", "tell me about"
    ];
    // Common coin names/symbols (non-exhaustive, just for stronger trigger)
    const commonCoins = [
        "bitcoin", "ethereum", "btc", "eth", "solana", "sol", "cardano", "ada",
        "ripple", "xrp", "dogecoin", "doge", "shiba inu", "shib"
    ];

    if (symbolRegex.test(text)) return true; // Test original text for case-sensitive symbols

    for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
            // Check if a common coin is mentioned nearby or if a generic term like "coin" or "token" is used
            if (commonCoins.some(coin => lowerText.includes(coin)) || lowerText.includes(" coin") || lowerText.includes(" token")) {
                 return true;
            }
        }
    }
    // Check for "[Coin Name/Symbol] market cap" etc.
    if (commonCoins.some(coin => lowerText.startsWith(coin + " ") && (lowerText.includes(" market cap") || lowerText.includes(" price")))) {
        return true;
    }

    // If the query is just a symbol or coin name
    if (commonCoins.includes(lowerText)) return true;

    return false;
}

function parseAndFormatCryptoData(aiResponseText) {
    if (!aiResponseText) return null;

    // Minimal check for pre-formatted data (AI followed instructions)
    // If it starts with "Coin Name (SYMBOL)" and has "- Current Price:" it's likely good.
    const lines = aiResponseText.split('\n');
    if (lines.length > 2 && lines[0].match(/^[A-Za-z\s]+\([A-Z]{2,6}\)$/) && lines.some(line => line.includes("- Current Price:"))) {
        // Assume AI has formatted it well enough, just wrap it and ensure basic markdown conversion
        // Or, if the AI is expected to return the exact HTML structure, we could detect that.
        // For now, let's assume the AI gives text that needs HTML structure.
        // This part can be enhanced to directly use AI's structure if it's HTML.
    }

    const data = {
        coinName: null, symbol: null, currentPrice: null, marketCap: null,
        volume24h: null, priceChange24h: null, ath: null, athDate: null,
        percentFromAth: null, totalSupply: null, maxSupply: null,
        change1h: null, change24h: null, change7d: null, change30d: null, change1y: null,
        futureUnlocks: "Data not available" // Default
    };

    let capturingKeyMovements = false;
    let capturingUnlocks = false;

    lines.forEach(line => {
        line = line.trim();
        if (line.match(/^[A-Za-z\s]+\s*\([A-Z]{2,6}\)$/) && !data.coinName) { // Matches "Coin Name (SYMBOL)"
            let parts = line.split('(');
            data.coinName = parts[0].trim();
            data.symbol = parts[1]?.replace(')', '').trim();
        } else if (line.startsWith("- Current Price:")) data.currentPrice = line.substring("- Current Price:".length).trim();
        else if (line.startsWith("- Market Cap:")) data.marketCap = line.substring("- Market Cap:".length).trim();
        else if (line.startsWith("- 24h Trading Volume:")) data.volume24h = line.substring("- 24h Trading Volume:".length).trim();
        else if (line.startsWith("- Price Change (24h):")) data.priceChange24h = line.substring("- Price Change (24h):".length).trim();
        else if (line.startsWith("- All-Time High:")) {
            const athParts = line.substring("- All-Time High:".length).trim().split('(on');
            data.ath = athParts[0]?.trim();
            if (athParts[1]) data.athDate = athParts[1].replace(')', '').trim();
        }
        else if (line.startsWith("- Percent from ATH:")) data.percentFromAth = line.substring("- Percent from ATH:".length).trim();
        else if (line.startsWith("- Total Supply:")) data.totalSupply = line.substring("- Total Supply:".length).trim();
        else if (line.startsWith("- Max Supply:")) data.maxSupply = line.substring("- Max Supply:".length).trim();
        else if (line.toLowerCase() === "key price movements:") capturingKeyMovements = true;
        else if (line.toLowerCase().startsWith("future unlocks:")) {
            capturingUnlocks = true;
            capturingKeyMovements = false; // Stop capturing key movements if unlocks section starts
            data.futureUnlocks = line.substring("Future Unlocks:".length).trim() || "Data not available";
        } else if (capturingKeyMovements) {
            if (line.startsWith("- 1 Hour Change:")) data.change1h = line.substring("- 1 Hour Change:".length).trim();
            else if (line.startsWith("- 24 Hour Change:")) data.change24h = line.substring("- 24 Hour Change:".length).trim();
            else if (line.startsWith("- 7 Day Change:")) data.change7d = line.substring("- 7 Day Change:".length).trim();
            else if (line.startsWith("- 30 Day Change:")) data.change30d = line.substring("- 30 Day Change:".length).trim();
            else if (line.startsWith("- 1 Year Change:")) data.change1y = line.substring("- 1 Year Change:".length).trim();
        } else if (capturingUnlocks) {
            // If future unlocks info spans multiple lines and wasn't captured fully initially
            if (data.futureUnlocks === "Data not available" || data.futureUnlocks.endsWith("...")) { // Simple check
                 data.futureUnlocks += (data.futureUnlocks === "Data not available" ? "" : "\n") + line;
            }
        }
    });

    // Basic validation: require at least name, symbol, and price.
    if (!data.coinName || !data.symbol || !data.currentPrice || data.currentPrice.toLowerCase() === "data not available") {
        // If AI response seems to be already structured markdown from our prompt, let it pass through to marked.parse
        if (lines.some(line => line.startsWith("### ") || line.startsWith("## ") || line.startsWith("- **"))) {
            return null; // Let marked.parse handle it
        }
        console.warn("Crypto data parsing failed to find essential fields or AI provided 'Data not available' for price.", data);
        return null;
    }

    // Construct HTML (ensure values are XSS-safe if they could contain HTML, though AI should provide plain text)
    // For now, assuming plain text values from AI.
    const renderField = (label, value, unit = '') => {
        return value && value.toLowerCase() !== 'data not available' ? `<li><strong>${label}:</strong> <span>${value}${unit}</span></li>` : '';
    };
    const renderPercentageField = (label, value) => {
         return value && value.toLowerCase() !== 'data not available' ? `<li><strong>${label}:</strong> <span class="${parseFloat(value) >= 0 ? 'positive-change' : 'negative-change'}">${value}</span></li>` : '';
    };


    let html = `<div class="crypto-data-card">`;
    html += `<h3>${data.coinName} (${data.symbol.toUpperCase()})</h3>`;
    html += `<ul>`;
    html += renderField("Current Price", data.currentPrice);
    html += renderField("Market Cap", data.marketCap);
    html += renderField("24h Trading Volume", data.volume24h);
    html += renderPercentageField("Price Change (24h)", data.priceChange24h);
    html += renderField("All-Time High", data.ath, data.athDate ? ` (on ${data.athDate})` : '');
    html += renderField("Percent from ATH", data.percentFromAth);
    html += renderField("Total Supply", data.totalSupply);
    html += renderField("Max Supply", data.maxSupply);
    html += `</ul>`;

    if (data.change1h || data.change24h || data.change7d || data.change30d || data.change1y) {
        html += `<h4>Key Price Movements:</h4><ul>`;
        html += renderPercentageField("1 Hour Change", data.change1h);
        html += renderPercentageField("24 Hour Change", data.change24h); // This might be redundant if Price Change (24h) is already shown
        html += renderPercentageField("7 Day Change", data.change7d);
        html += renderPercentageField("30 Day Change", data.change30d);
        html += renderPercentageField("1 Year Change", data.change1y);
        html += `</ul>`;
    }

    html += `<p><strong>Future Unlocks:</strong> <span>${data.futureUnlocks || "Data not available"}</span></p>`;
    html += `</div>`;

    return html;
}
// --- End Crypto Query Handling ---

// --- Query Complexity Analysis ---
function isComplexQuery(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    const complexKeywords = [
        "compare", "vs", "analyze", "explain", "pros and cons",
        "what are the differences", "how does", "why is", "tell me more about",
        "deep dive", "analysis of", "impact of", "implications of", "benefits of", "drawbacks of"
    ];
    const questionStarters = ["what", "how", "why", "explain", "describe", "compare"];

    if (complexKeywords.some(keyword => lowerText.includes(keyword))) {
        return true;
    }

    // Check for questions that are likely to be complex
    if (questionStarters.some(starter => lowerText.startsWith(starter)) && text.length > 30) { // Longer questions are often more complex
        return true;
    }

    // Multiple entities or concepts (simple check for "and" or "vs")
    if ((lowerText.includes(" and ") || lowerText.includes(" vs ")) && text.length > 20) {
        // Further check if it's not a simple list like "apples and oranges"
        // This heuristic is very basic and could be improved.
        // For now, assume conjunctions in longer queries might indicate complexity.
        const parts = lowerText.split(/ (?:and|vs) /);
        if (parts.length > 1 && parts.every(part => part.length > 3)) { // Each part has some substance
            return true;
        }
    }

    // Asking for trends or predictions
    if (lowerText.includes("trend") || lowerText.includes("prediction") || lowerText.includes("future of")) {
        return true;
    }

    // Length as a simple heuristic - very long queries might be complex
    if (text.length > 100) { // Arbitrary length
        return true;
    }

    return false;
}
// --- End Query Complexity Analysis ---

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

// Modified to accept aiMessageContentElement for streaming
async function callGeminiAPI(inputText, thinkingBudget = 0, enableSearchTool = false, aiMessageContentElement = null) {
    console.log("callGeminiAPI: Received parameters", {
        inputText: inputText,
        thinkingBudget: thinkingBudget,
        enableSearchTool: enableSearchTool,
        currentImageData_global: currentImageData ? { mimeType: currentImageData.mimeType, base64Data: currentImageData.base64Data.substring(0,30) + "..."} : null,
        aiMessageContentElementProvided: !!aiMessageContentElement
    });

    // The existing responseArea and spinnerContainer are for the initial prompt screen's API response.
    // For chat, we'll be updating aiMessageContentElement directly.
    // If aiMessageContentElement is NOT provided, it means we're likely in the initial prompt screen context.
    const responseArea = !aiMessageContentElement ? document.getElementById('api-response-area') : null;
    const spinnerContainer = responseArea ? responseArea.querySelector('.spinner-container') : null;
    const responseContentDiv = responseArea ? responseArea.querySelector('.response-content') : null;

    // Toggle send button for chat context
    if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
        toggleChatSendButtonState(true);
    }


    if (typeof GEMINI_API_KEY === 'undefined' || !GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set. Please set it before calling the API.");
        // Use renderMessage for chat context errors
        if (aiMessageContentElement) {
            // Remove thinking indicator from aiMessageContentElement's parent message div first
            const parentMsgDiv = aiMessageContentElement.closest('.message');
            if (parentMsgDiv) {
                 const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                 if(thinkingIndicator) thinkingIndicator.remove();
            }
            aiMessageContentElement.innerHTML = marked.parse("API Key is not configured. Please set it in the script.");
            if (parentMsgDiv) parentMsgDiv.classList.add('error-message'); // Add error class to the whole bubble
        } else if (responseContentDiv && responseArea) { // Fallback for main page
            responseContentDiv.innerText = "API Key is not configured. Please set GEMINI_API_KEY in the script.";
            responseContentDiv.style.color = 'var(--google-red)';
            if(spinnerContainer) spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            if(responseArea) responseArea.style.display = 'block';
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return null;
    }

    if (responseArea && spinnerContainer && responseContentDiv && !aiMessageContentElement) {
        responseContentDiv.innerHTML = '';
        responseContentDiv.style.display = 'none';
        spinnerContainer.style.display = 'flex';
        responseArea.style.display = 'block';
    }

    let thinkingIndicatorRemoved = false;
    if (aiMessageContentElement) { // Clear initial "..." if present
        const initialThinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
        if (initialThinkingIndicator) {
            // We will remove it once the first actual content chunk arrives
        } else {
            aiMessageContentElement.innerHTML = ''; // Clear if no specific indicator found but content exists
        }
    }


    const GENERATE_CONTENT_API = "streamGenerateContent"; // Ensure this is streamGenerateContent
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModelId}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}`;

    // Determine query nature for system instruction (inputText here is the potentially modified one)
    // Note: isCryptoQuery might be called by the caller to prepend specific instructions to inputText.
    // We call it again here on the raw inputText (if available) or the modified one to adjust system prompt.
    // For system prompt purposes, we use the original input if available, or the passed inputText.
    // The `inputText` parameter to `callGeminiAPI` might already be augmented for crypto queries.
    const originalInputForSystemPrompt = inputText; // This needs to be the *original* user text for accurate classification
                                               // This is a simplification; ideally, the calling function would pass original text separately
                                               // if inputText is heavily modified. For now, we work with what's passed.

    const isCrypto = isCryptoQuery(originalInputForSystemPrompt); // isCryptoQuery is defined elsewhere
    const isComplex = isComplexQuery(originalInputForSystemPrompt); // isComplexQuery is defined elsewhere

    let systemText = "You are Aegis Protocol, an AI-driven gateway that unites DeFi, GameFi, and Real-World Assets under a single intelligent framework. Your tasks include providing real-time token analytics, automating asset tokenization validation, and optimizing gaming economies. Uphold the principles of transparency, interpretability, and consumer protection. When offering recommendations, cite on-chain data points, market trends, and risk assessments. Always ensure users can trace how your conclusions were derived. Use proper markdown formatting including headings, lists, code blocks, tables, and other formatting elements.";

    if (isCrypto) {
        // The detailed crypto prompt is prepended to inputText by the caller.
        // The system instruction can be slightly more general here, or reinforce search.
        systemText += " The user is asking about cryptocurrencies. Prioritize using search tools for the latest data if specific coin information is requested. Ensure data accuracy.";
        console.log("callGeminiAPI: System instruction adapted for Crypto query.");
    } else if (isComplex) {
        systemText += " The user is asking a complex question. Provide a thorough, detailed, and analytical response. Break down concepts clearly and use examples if helpful. Structure your answer logically.";
        console.log("callGeminiAPI: System instruction adapted for Complex query.");
    } else {
        // General casual conversation or simple question
        systemText += " The user is asking a general question. Provide a concise and to-the-point response. Avoid unnecessary jargon unless explained.";
        console.log("callGeminiAPI: System instruction adapted for General query.");
    }

    const requestBody = {
        contents: [{ role: "user", parts: [] }],
        generationConfig: {
            thinkingConfig: {
                thinkingBudget: thinkingBudget,
            },
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "text/plain",
        },
        systemInstruction: {
            parts: [{ text: systemText }]
        }
    };

    if (enableSearchTool) {
        requestBody.tools = [ { "urlContext": {} }, { "googleSearch": {} } ];
    }

    const parts = [];
    // inputText here is the one passed to the function, which might already include crypto-specific instructions.
    let textToSend = inputText || "";

    if (currentImageData && currentImageData.base64Data && currentImageData.mimeType) {
        parts.push({ text: textToSend });
        parts.push({
            inline_data: {
                mime_type: currentImageData.mimeType,
                data: currentImageData.base64Data
            }
        });
        console.log(`callGeminiAPI: Preparing multimodal request with model: ${currentModelId}`, { text: inputText, imageMime: currentImageData.mimeType });
    } else if (inputText) {
        parts.push({ text: textToSend });
    }

    if (parts.length === 0) {
        console.error("No content (text or image) to send to API.");
        if (aiMessageContentElement) {
            aiMessageContentElement.textContent = "Cannot send empty message.";
        } else if (responseContentDiv && responseArea && spinnerContainer) {
            responseContentDiv.innerText = "Please provide text or an image to send.";
            responseContentDiv.style.color = 'var(--google-red)';
            if(spinnerContainer) spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            if(responseArea) responseArea.style.display = 'block';
        }
        return null;
    }
    requestBody.contents[0].parts = parts;
    // Reduce console noise for full request body, especially with images.
    // console.log("callGeminiAPI: Full requestBody for API", JSON.stringify(requestBody, null, 2));


    let fullResponseText = ""; // To accumulate the full response for saving

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (spinnerContainer && !aiMessageContentElement) spinnerContainer.style.display = 'none';

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error in callGeminiAPI:", response.status, errorText);
            const displayError = `Error: Could not get response from AI. Status: ${response.status}. ${errorText ? errorText.substring(0,100) : ''}`;
            if (aiMessageContentElement) {
                // If aiMessageContentElement was passed, it implies we are in chat view.
                // renderMessage will create a new bubble. We need to update the existing one or replace it.
                // For simplicity, let's assume aiMessageContentElement is the content div of an existing bubble.
                 const parentMsgDiv = aiMessageContentElement.closest('.message');
                 if (parentMsgDiv) {
                    const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                    if(thinkingIndicator) thinkingIndicator.remove();
                 }
                aiMessageContentElement.innerHTML = marked.parse(displayError);
                if (parentMsgDiv) parentMsgDiv.classList.add('error-message');
            } else if (responseContentDiv) { // Fallback for main page
                responseContentDiv.innerText = `Sorry, something went wrong. \nError: ${response.status}. See console for details. \n${errorText}`;
                responseContentDiv.style.color = 'var(--google-red)';
                responseContentDiv.style.display = 'block';
            }
            if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
                toggleChatSendButtonState(false);
            }
            return null;
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedChunks = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            accumulatedChunks += decoder.decode(value, { stream: true });

            // Process valid JSON chunks (Google's streaming API often sends multiple JSON objects)
            // Each valid JSON object needs to be parsed separately.
            // A common pattern is that chunks are separated by newlines or commas.
            // This is a simplified parser; a more robust one might be needed for all edge cases.
            let lastProcessedIndex = 0;
            for (let i = 0; i < accumulatedChunks.length; i++) {
                if (accumulatedChunks[i] === '}' || accumulatedChunks[i] === ']') {
                    // Try to parse from lastProcessedIndex up to this point
                    let potentialJson = accumulatedChunks.substring(lastProcessedIndex, i + 1);
                    // Remove leading commas if any (sometimes happens in stream)
                    potentialJson = potentialJson.replace(/^,/, '');
                    try {
                        const jsonData = JSON.parse(potentialJson);
                        if (jsonData.candidates && jsonData.candidates[0].content && jsonData.candidates[0].content.parts && jsonData.candidates[0].content.parts[0].text) {
                            const textChunk = jsonData.candidates[0].content.parts[0].text;
                            fullResponseText += textChunk;

                            if (aiMessageContentElement) {
                                if (!thinkingIndicatorRemoved) {
                                    const thinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
                                    if (thinkingIndicator) thinkingIndicator.remove();
                                    aiMessageContentElement.innerHTML = ''; // Clear any remaining indicator text
                                    thinkingIndicatorRemoved = true;
                                }
                                // Append and re-parse markdown incrementally
                                // For live markdown, this can be performance intensive.
                                // Simpler: aiMessageContentElement.textContent += textChunk;
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                // Ensure message list scrolls with new content
                                const messageList = document.getElementById('message-list');
                                if (messageList) messageList.scrollTop = messageList.scrollHeight;

                            }
                        }
                        lastProcessedIndex = i + 1; // Move past the processed JSON
                    } catch (e) {
                        // Not a complete JSON object yet, or invalid JSON. Continue accumulating.
                    }
                }
            }
            // Keep the unprocessed part of the chunk for the next iteration
            accumulatedChunks = accumulatedChunks.substring(lastProcessedIndex);
        }

        console.log("API Success (full streamed text):", fullResponseText);

        if (aiMessageContentElement) {
            // Final markdown parse for the complete content
            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
            addCopyButtonsToCodeBlocks(aiMessageContentElement); // Add copy buttons to code blocks in this message
            const messageList = document.getElementById('message-list');
            if (messageList) messageList.scrollTop = messageList.scrollHeight;
        } else if (responseContentDiv) { // Fallback for original prompt screen
            responseContentDiv.innerHTML = marked.parse(fullResponseText);
            addCopyButtonsToCodeBlocks(responseContentDiv);
            responseContentDiv.style.display = 'block';
            if (responseArea) {
                 setTimeout(() => {
                    responseArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return fullResponseText; // Return the complete text

    } catch (error) {
        if (spinnerContainer && !aiMessageContentElement) spinnerContainer.style.display = 'none';
        console.error("Fetch Error in callGeminiAPI:", error);
        const displayError = "Error: Could not get response from AI. " + error.message;
        if (aiMessageContentElement) {
            const parentMsgDiv = aiMessageContentElement.closest('.message');
            if (parentMsgDiv) {
                const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                if(thinkingIndicator) thinkingIndicator.remove();
            }
            aiMessageContentElement.innerHTML = marked.parse(displayError);
            if (parentMsgDiv) parentMsgDiv.classList.add('error-message');
        } else if (responseContentDiv) { // Fallback for main page
            responseContentDiv.innerText = "Failed to fetch response. Please check your connection or API key. \n" + error.message;
            responseContentDiv.style.color = 'var(--google-red)';
            responseContentDiv.style.display = 'block';
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return null;
    }
}

// REMOVING DUPLICATE/OLD callGeminiAPI functions and createRipple
// The version of callGeminiAPI above this comment (taking aiMessageContentElement) is the one to keep.
// The createRipple function is also defined multiple times. Keep one.

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

// End of the primary callGeminiAPI and createRipple.
// The duplicate/older versions below this point will be removed by the diff.

// Existing script content follows...
document.querySelectorAll('.action-button, .model-selector, .send-button, .legacy-search-link').forEach(button => {
        button.addEventListener('click', (e) => {
        // Apply ripple to specific button types
        if (button.classList.contains('action-button') ||
            button.classList.contains('send-button') ||
            button.classList.contains('model-selector')) {
            createRipple(e);
        }

        e.preventDefault(); // Keep this early

        const askAnythingDiv = document.querySelector('.ask-anything-text');
        const inputText = askAnythingDiv.innerText.trim();

        // Search button (fa-globe)
        if (button.classList.contains('action-button') && button.querySelector('i.fa-globe')) {
            isSearchModeActive = !isSearchModeActive;
            button.classList.toggle('search-button-active');
            console.log("Search mode toggled:", isSearchModeActive);
        }
        // Think button & Send button on Initial Prompt Screen
        else if (
            (button.classList.contains('action-button') && button.querySelector('i.fa-lightbulb')) || // Think button
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            /*
            const askAnythingDiv = document.querySelector('.ask-anything-text');
            const currentInputText = askAnythingDiv.innerText.trim();

            if (!currentInputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = currentInputText;
            let apiInputText = originalUserQuery;
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        console.error("Failed to create and retrieve new session from DB for initial prompt.");
                        alert("Error starting a new chat. Please try again or refresh.");
                        return;
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                         // Image handled by global currentImageData in callGeminiAPI
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);

                    if (fullResponseText && aiMessageContentElement) {
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight; // Scroll after content update
                        await saveMessageToSession(currentChatSessionId, 'ai', fullResponseText);

                    } else if (!fullResponseText && aiMessageContentElement) {
                        // Handle case where API call might have resolved but with no text (e.g. error handled inside callGeminiAPI)
                        // If aiMessageContentElement still shows thinking, replace it.
                        const thinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
                        if (thinkingIndicator) {
                            aiMessageContentElement.innerHTML = "Failed to get a response. Please try again.";
                            const messageBubble = aiMessageContentElement.closest('.message');
                            if(messageBubble) messageBubble.classList.add('error-message');
                        }
                    }

                    if (!isThinkButton) {
                        if(askAnythingDiv) askAnythingDiv.innerText = '';
                        clearAttachedImage(); // Clear global image data and preview
                    }

                } catch (error) {
                    console.error("Error during initial prompt submission:", error);
                    alert("Error processing your request: " + error.message);
                    // If chat view is active, show error there, otherwise it might be confusing
                    if (document.body.classList.contains('chat-active') && currentChatSessionId) {
                         renderMessage('system', "Failed to process your request. Please try again.", false, true);
                    }
                }
            })();
        }
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            /*
            const askAnythingDiv = document.querySelector('.ask-anything-text');
            const currentInputText = askAnythingDiv.innerText.trim();

            if (!currentInputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = currentInputText;
            let apiInputText = originalUserQuery;
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        console.error("Failed to create and retrieve new session from DB for initial prompt.");
                        alert("Error starting a new chat. Please try again or refresh.");
                        return;
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                        clearAttachedImage();
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);

                    if (fullResponseText && aiMessageContentElement) {
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight;
                        await saveMessageToSession(currentChatSessionId, 'ai', fullResponseText);
                    } else if (!fullResponseText && aiMessageContentElement) {
                        aiMessageContentElement.innerHTML = "Failed to get a response. Please try again.";
                        const messageBubble = aiMessageContentElement.closest('.message');
                        if(messageBubble) messageBubble.classList.add('error-message');
                    }

                    if (!isThinkButton) {
                        if(askAnythingDiv) askAnythingDiv.innerText = '';
                        // currentImageData is cleared by clearAttachedImage() if it was used for the prompt.
                        // If it wasn't used (e.g. text-only prompt), it might still be set.
                        // So, explicitly clear it here if not a "Think" action.
                        clearAttachedImage();
                    }

                } catch (error) {
                    console.error("Error during initial prompt submission:", error);
                    alert("Error processing your request: " + error.message);
                    if (document.body.classList.contains('chat-active')) {
                         renderMessage('system', "Failed to process your request. Please try again.", false, true);
                    }
                }
            })();
        }
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            const askAnythingDiv = document.querySelector('.ask-anything-text'); // Ensure we get fresh inputText here too
            const inputText = askAnythingDiv.innerText.trim(); // Re-fetch inputText for this specific handler block

            if (!inputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = inputText; // Store the original input for saving and display
            let apiInputText = originalUserQuery; // This will be sent to the API (potentially modified for crypto)
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        throw new Error("Failed to create and retrieve new session from DB for initial prompt.");
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                        clearAttachedImage();
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);
                .then(fullResponseText => {
                    if (fullResponseText && aiMessageContentElement) {
                        // Try to parse for crypto data after full response
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                // Ensure copy buttons are added if code blocks exist in structuredHTML (though unlikely for this card)
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                // If parsing fails, stick to markdown rendering of the full response
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                             // Default markdown rendering for non-crypto queries (already handled by streaming in callGeminiAPI)
                             // but ensure final content is set if not fully handled by stream due to partial parsing
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        // Ensure message list scrolls with new content
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight;

                        saveMessageToSession(currentChatSessionId, 'ai', fullResponseText) // Save the raw AI response
                            .then(() => console.log("AI response saved to session:", currentChatSessionId))
                            .catch(err => console.error("Error saving AI response:", err));
                    }
                })
                .catch(error => {
                    console.error("Error calling Gemini API from initial prompt:", error);
                    if (aiMessageContentElement) {
                        aiMessageContentElement.textContent = "Error fetching response. Please try again.";
                    }
                });

            if (!isThinkButton) {
                askAnythingDiv.innerText = '';
                clearAttachedImage();
            }
        }
        */
        console.log("Initial Send/Think button original logic (second instance) now commented out.");
    }
        */
        console.log("Initial Send/Think button original logic now commented out. New handlers will take over."); // New placeholder
    }
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            /*
            const askAnythingDiv = document.querySelector('.ask-anything-text'); // Ensure we get fresh inputText here too
            const inputText = askAnythingDiv.innerText.trim(); // Re-fetch inputText for this specific handler block

            if (!inputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = inputText; // Store the original input for saving and display
            let apiInputText = originalUserQuery; // This will be sent to the API (potentially modified for crypto)
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        throw new Error("Failed to create and retrieve new session from DB for initial prompt.");
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                        clearAttachedImage();
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);
                .then(fullResponseText => {
                    if (fullResponseText && aiMessageContentElement) {
                        // Try to parse for crypto data after full response
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                // Ensure copy buttons are added if code blocks exist in structuredHTML (though unlikely for this card)
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                // If parsing fails, stick to markdown rendering of the full response
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                             // Default markdown rendering for non-crypto queries (already handled by streaming in callGeminiAPI)
                             // but ensure final content is set if not fully handled by stream due to partial parsing
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        // Ensure message list scrolls with new content
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight;

                        saveMessageToSession(currentChatSessionId, 'ai', fullResponseText) // Save the raw AI response
                            .then(() => console.log("AI response saved to session:", currentChatSessionId))
                            .catch(err => console.error("Error saving AI response:", err));
                    }
                })
                .catch(error => {
                    console.error("Error calling Gemini API from initial prompt:", error);
                    if (aiMessageContentElement) {
                        aiMessageContentElement.textContent = "Error fetching response. Please try again.";
                    }
                });

            if (!isThinkButton) {
                askAnythingDiv.innerText = '';
                clearAttachedImage();
            }
        }
        */
        console.log("Initial Send/Think button original logic (third instance) now commented out.");
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

// --- End Query Complexity Analysis ---

// Function to handle initial prompt submission (for new Send and Think buttons)
async function handleInitialPromptSubmit(event, isThinkAction = false) {
    event.preventDefault();
    const button = event.currentTarget;
    if (button) button.disabled = true;

    console.log(`handleInitialPromptSubmit called. isThinkAction: ${isThinkAction}`);

    const askAnythingDiv = document.querySelector('.ask-anything-text');
    if (!askAnythingDiv) {
        console.error(".ask-anything-text element not found for initial prompt.");
        alert("Critical error: Input field not found.");
        return;
    }
    const originalUserQuery = askAnythingDiv.innerText.trim();

    if (!originalUserQuery && !currentImageData) {
        alert("Please enter something or attach an image.");
        return;
    }

    const thinkingBudget = isThinkAction ? 24576 : 0;
    let apiInputText = originalUserQuery;
    let enableSearch = isSearchModeActive;
    const isCrypto = isCryptoQuery(originalUserQuery);

    if (isCrypto) {
        enableSearch = true;
        apiInputText = `User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
    }

    try {
        const newSession = await createNewChatSessionInDB();
        if (!newSession || !newSession.sessionId) {
            throw new Error("Failed to create new session in DB for initial prompt.");
        }
        currentChatSessionId = newSession.sessionId;

        addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

        showChatView();
        renderMessage('user', originalUserQuery);

        await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

        const aiMessageContentElement = renderMessage('ai', '', true); // thinking = true

        const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);

        if (fullResponseText && aiMessageContentElement) {
            if (isCrypto) {
                const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                if (structuredHtml) {
                    aiMessageContentElement.innerHTML = structuredHtml;
                } else {
                    aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                }
            } else {
                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
            }
            addCopyButtonsToCodeBlocks(aiMessageContentElement);

            const messageList = document.getElementById('message-list');
            if (messageList) messageList.scrollTop = messageList.scrollHeight;

            await saveMessageToSession(currentChatSessionId, 'ai', fullResponseText);
        } else if (!fullResponseText && aiMessageContentElement) {
            const thinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
            if (thinkingIndicator) {
                aiMessageContentElement.innerHTML = marked.parse("Failed to get a response. Please try again.");
                const messageBubble = aiMessageContentElement.closest('.message');
                if(messageBubble) messageBubble.classList.add('error-message');
            }
        }

        if (!isThinkAction) {
            askAnythingDiv.innerText = '';
            clearAttachedImage();
        }
    } catch (error) {
        console.error("Error during initial prompt submission (handleInitialPromptSubmit):", error);
        alert("Error processing your request: " + error.message);
        if (document.body.classList.contains('chat-active') && currentChatSessionId) {
             renderMessage('system', "Failed to process your request. Please try again.", false, true);
        }
    } finally {
        if (button) button.disabled = false;
    }
}

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

// Modified to accept aiMessageContentElement for streaming
async function callGeminiAPI(inputText, thinkingBudget = 0, enableSearchTool = false, aiMessageContentElement = null) {
    console.log("callGeminiAPI: Received parameters", {
        inputText: inputText,
        thinkingBudget: thinkingBudget,
        enableSearchTool: enableSearchTool,
        currentImageData_global: currentImageData ? { mimeType: currentImageData.mimeType, base64Data: currentImageData.base64Data.substring(0,30) + "..."} : null,
        aiMessageContentElementProvided: !!aiMessageContentElement
    });

    // The existing responseArea and spinnerContainer are for the initial prompt screen's API response.
    // For chat, we'll be updating aiMessageContentElement directly.
    // If aiMessageContentElement is NOT provided, it means we're likely in the initial prompt screen context.
    const responseArea = !aiMessageContentElement ? document.getElementById('api-response-area') : null;
    const spinnerContainer = responseArea ? responseArea.querySelector('.spinner-container') : null;
    const responseContentDiv = responseArea ? responseArea.querySelector('.response-content') : null;

    // Toggle send button for chat context
    if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
        toggleChatSendButtonState(true);
    }


    if (typeof GEMINI_API_KEY === 'undefined' || !GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set. Please set it before calling the API.");
        // Use renderMessage for chat context errors
        if (aiMessageContentElement) {
            // Remove thinking indicator from aiMessageContentElement's parent message div first
            const parentMsgDiv = aiMessageContentElement.closest('.message');
            if (parentMsgDiv) {
                 const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                 if(thinkingIndicator) thinkingIndicator.remove();
            }
            aiMessageContentElement.innerHTML = marked.parse("API Key is not configured. Please set it in the script.");
            if (parentMsgDiv) parentMsgDiv.classList.add('error-message'); // Add error class to the whole bubble
        } else if (responseContentDiv && responseArea) { // Fallback for main page
            responseContentDiv.innerText = "API Key is not configured. Please set GEMINI_API_KEY in the script.";
            responseContentDiv.style.color = 'var(--google-red)';
            if(spinnerContainer) spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            if(responseArea) responseArea.style.display = 'block';
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return null;
    }

    if (responseArea && spinnerContainer && responseContentDiv && !aiMessageContentElement) {
        responseContentDiv.innerHTML = '';
        responseContentDiv.style.display = 'none';
        spinnerContainer.style.display = 'flex';
        responseArea.style.display = 'block';
    }

    let thinkingIndicatorRemoved = false;
    if (aiMessageContentElement) { // Clear initial "..." if present
        const initialThinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
        if (initialThinkingIndicator) {
            // We will remove it once the first actual content chunk arrives
        } else {
            aiMessageContentElement.innerHTML = ''; // Clear if no specific indicator found but content exists
        }
    }


    const GENERATE_CONTENT_API = "streamGenerateContent"; // Ensure this is streamGenerateContent
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModelId}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}`;

    // Determine query nature for system instruction (inputText here is the potentially modified one)
    // Note: isCryptoQuery might be called by the caller to prepend specific instructions to inputText.
    // We call it again here on the raw inputText (if available) or the modified one to adjust system prompt.
    // For system prompt purposes, we use the original input if available, or the passed inputText.
    // The `inputText` parameter to `callGeminiAPI` might already be augmented for crypto queries.
    const originalInputForSystemPrompt = inputText; // This needs to be the *original* user text for accurate classification
                                               // This is a simplification; ideally, the calling function would pass original text separately
                                               // if inputText is heavily modified. For now, we work with what's passed.

    const isCrypto = isCryptoQuery(originalInputForSystemPrompt); // isCryptoQuery is defined elsewhere
    const isComplex = isComplexQuery(originalInputForSystemPrompt); // isComplexQuery is defined elsewhere

    let systemText = "You are Aegis Protocol, an AI-driven gateway that unites DeFi, GameFi, and Real-World Assets under a single intelligent framework. Your tasks include providing real-time token analytics, automating asset tokenization validation, and optimizing gaming economies. Uphold the principles of transparency, interpretability, and consumer protection. When offering recommendations, cite on-chain data points, market trends, and risk assessments. Always ensure users can trace how your conclusions were derived. Use proper markdown formatting including headings, lists, code blocks, tables, and other formatting elements.";

    if (isCrypto) {
        // The detailed crypto prompt is prepended to inputText by the caller.
        // The system instruction can be slightly more general here, or reinforce search.
        systemText += " The user is asking about cryptocurrencies. Prioritize using search tools for the latest data if specific coin information is requested. Ensure data accuracy.";
        console.log("callGeminiAPI: System instruction adapted for Crypto query.");
    } else if (isComplex) {
        systemText += " The user is asking a complex question. Provide a thorough, detailed, and analytical response. Break down concepts clearly and use examples if helpful. Structure your answer logically.";
        console.log("callGeminiAPI: System instruction adapted for Complex query.");
    } else {
        // General casual conversation or simple question
        systemText += " The user is asking a general question. Provide a concise and to-the-point response. Avoid unnecessary jargon unless explained.";
        console.log("callGeminiAPI: System instruction adapted for General query.");
    }

    const requestBody = {
        contents: [{ role: "user", parts: [] }],
        generationConfig: {
            thinkingConfig: {
                thinkingBudget: thinkingBudget,
            },
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "text/plain",
        },
        systemInstruction: {
            parts: [{ text: systemText }]
        }
    };

    if (enableSearchTool) {
        requestBody.tools = [ { "urlContext": {} }, { "googleSearch": {} } ];
    }

    const parts = [];
    // inputText here is the one passed to the function, which might already include crypto-specific instructions.
    let textToSend = inputText || "";

    if (currentImageData && currentImageData.base64Data && currentImageData.mimeType) {
        parts.push({ text: textToSend });
        parts.push({
            inline_data: {
                mime_type: currentImageData.mimeType,
                data: currentImageData.base64Data
            }
        });
        console.log(`callGeminiAPI: Preparing multimodal request with model: ${currentModelId}`, { text: inputText, imageMime: currentImageData.mimeType });
    } else if (inputText) {
        parts.push({ text: textToSend });
    }

    if (parts.length === 0) {
        console.error("No content (text or image) to send to API.");
        if (aiMessageContentElement) {
            aiMessageContentElement.textContent = "Cannot send empty message.";
        } else if (responseContentDiv && responseArea && spinnerContainer) {
            responseContentDiv.innerText = "Please provide text or an image to send.";
            responseContentDiv.style.color = 'var(--google-red)';
            if(spinnerContainer) spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            if(responseArea) responseArea.style.display = 'block';
        }
        return null;
    }
    requestBody.contents[0].parts = parts;
    // Reduce console noise for full request body, especially with images.
    // console.log("callGeminiAPI: Full requestBody for API", JSON.stringify(requestBody, null, 2));


    let fullResponseText = ""; // To accumulate the full response for saving

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (spinnerContainer && !aiMessageContentElement) spinnerContainer.style.display = 'none';

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error in callGeminiAPI:", response.status, errorText);
            const displayError = `Error: Could not get response from AI. Status: ${response.status}. ${errorText ? errorText.substring(0,100) : ''}`;
            if (aiMessageContentElement) {
                // If aiMessageContentElement was passed, it implies we are in chat view.
                // renderMessage will create a new bubble. We need to update the existing one or replace it.
                // For simplicity, let's assume aiMessageContentElement is the content div of an existing bubble.
                 const parentMsgDiv = aiMessageContentElement.closest('.message');
                 if (parentMsgDiv) {
                    const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                    if(thinkingIndicator) thinkingIndicator.remove();
                 }
                aiMessageContentElement.innerHTML = marked.parse(displayError);
                if (parentMsgDiv) parentMsgDiv.classList.add('error-message');
            } else if (responseContentDiv) { // Fallback for main page
                responseContentDiv.innerText = `Sorry, something went wrong. \nError: ${response.status}. See console for details. \n${errorText}`;
                responseContentDiv.style.color = 'var(--google-red)';
                responseContentDiv.style.display = 'block';
            }
            if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
                toggleChatSendButtonState(false);
            }
            return null;
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedChunks = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            accumulatedChunks += decoder.decode(value, { stream: true });
            
            // Process valid JSON chunks (Google's streaming API often sends multiple JSON objects)
            // Each valid JSON object needs to be parsed separately.
            // A common pattern is that chunks are separated by newlines or commas.
            // This is a simplified parser; a more robust one might be needed for all edge cases.
            let lastProcessedIndex = 0;
            for (let i = 0; i < accumulatedChunks.length; i++) {
                if (accumulatedChunks[i] === '}' || accumulatedChunks[i] === ']') {
                    // Try to parse from lastProcessedIndex up to this point
                    let potentialJson = accumulatedChunks.substring(lastProcessedIndex, i + 1);
                    // Remove leading commas if any (sometimes happens in stream)
                    potentialJson = potentialJson.replace(/^,/, '');
                    try {
                        const jsonData = JSON.parse(potentialJson);
                        if (jsonData.candidates && jsonData.candidates[0].content && jsonData.candidates[0].content.parts && jsonData.candidates[0].content.parts[0].text) {
                            const textChunk = jsonData.candidates[0].content.parts[0].text;
                            fullResponseText += textChunk;

                            if (aiMessageContentElement) {
                                if (!thinkingIndicatorRemoved) {
                                    const thinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
                                    if (thinkingIndicator) thinkingIndicator.remove();
                                    aiMessageContentElement.innerHTML = ''; // Clear any remaining indicator text
                                    thinkingIndicatorRemoved = true;
                                }
                                // Append and re-parse markdown incrementally
                                // For live markdown, this can be performance intensive.
                                // Simpler: aiMessageContentElement.textContent += textChunk;
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                // Ensure message list scrolls with new content
                                const messageList = document.getElementById('message-list');
                                if (messageList) messageList.scrollTop = messageList.scrollHeight;

                            }
                        }
                        lastProcessedIndex = i + 1; // Move past the processed JSON
                    } catch (e) {
                        // Not a complete JSON object yet, or invalid JSON. Continue accumulating.
                    }
                }
            }
            // Keep the unprocessed part of the chunk for the next iteration
            accumulatedChunks = accumulatedChunks.substring(lastProcessedIndex);
        }

        console.log("API Success (full streamed text):", fullResponseText);

        if (aiMessageContentElement) {
            // Final markdown parse for the complete content
            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
            addCopyButtonsToCodeBlocks(aiMessageContentElement); // Add copy buttons to code blocks in this message
            const messageList = document.getElementById('message-list');
            if (messageList) messageList.scrollTop = messageList.scrollHeight;
        } else if (responseContentDiv) { // Fallback for original prompt screen
            responseContentDiv.innerHTML = marked.parse(fullResponseText);
            addCopyButtonsToCodeBlocks(responseContentDiv);
            responseContentDiv.style.display = 'block';
            if (responseArea) {
                 setTimeout(() => {
                    responseArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return fullResponseText; // Return the complete text

    } catch (error) {
        if (spinnerContainer && !aiMessageContentElement) spinnerContainer.style.display = 'none';
        console.error("Fetch Error in callGeminiAPI:", error);
        const displayError = "Error: Could not get response from AI. " + error.message;
        if (aiMessageContentElement) {
            const parentMsgDiv = aiMessageContentElement.closest('.message');
            if (parentMsgDiv) {
                const thinkingIndicator = parentMsgDiv.querySelector('.thinking-indicator');
                if(thinkingIndicator) thinkingIndicator.remove();
            }
            aiMessageContentElement.innerHTML = marked.parse(displayError);
            if (parentMsgDiv) parentMsgDiv.classList.add('error-message');
        } else if (responseContentDiv) { // Fallback for main page
            responseContentDiv.innerText = "Failed to fetch response. Please check your connection or API key. \n" + error.message;
            responseContentDiv.style.color = 'var(--google-red)';
            responseContentDiv.style.display = 'block';
        }
        if (aiMessageContentElement && typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        return null;
    }
}

// REMOVING DUPLICATE/OLD callGeminiAPI functions and createRipple
// The version of callGeminiAPI above this comment (taking aiMessageContentElement) is the one to keep.
// The createRipple function is also defined multiple times. Keep one.

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

// End of the primary callGeminiAPI and createRipple.
// The duplicate/older versions below this point will be removed by the diff.

// Existing script content follows...
document.querySelectorAll('.action-button, .model-selector, .send-button, .legacy-search-link').forEach(button => {
        button.addEventListener('click', (e) => {
        // Apply ripple to specific button types
        if (button.classList.contains('action-button') ||
            button.classList.contains('send-button') ||
            button.classList.contains('model-selector')) {
            createRipple(e);
        }

        e.preventDefault(); // Keep this early

        const askAnythingDiv = document.querySelector('.ask-anything-text');
        const inputText = askAnythingDiv.innerText.trim();

        // Search button (fa-globe)
        if (button.classList.contains('action-button') && button.querySelector('i.fa-globe')) {
            isSearchModeActive = !isSearchModeActive;
            button.classList.toggle('search-button-active');
            console.log("Search mode toggled:", isSearchModeActive);
        }
        // Think button & Send button on Initial Prompt Screen
        else if (
            (button.classList.contains('action-button') && button.querySelector('i.fa-lightbulb')) || // Think button
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            /*
            const askAnythingDiv = document.querySelector('.ask-anything-text');
            const currentInputText = askAnythingDiv.innerText.trim();

            if (!currentInputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = currentInputText;
            let apiInputText = originalUserQuery;
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        console.error("Failed to create and retrieve new session from DB for initial prompt.");
                        alert("Error starting a new chat. Please try again or refresh.");
                        return;
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                         // Image handled by global currentImageData in callGeminiAPI
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);

                    if (fullResponseText && aiMessageContentElement) {
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight; // Scroll after content update
                        await saveMessageToSession(currentChatSessionId, 'ai', fullResponseText);

                    } else if (!fullResponseText && aiMessageContentElement) {
                        // Handle case where API call might have resolved but with no text (e.g. error handled inside callGeminiAPI)
                        // If aiMessageContentElement still shows thinking, replace it.
                        const thinkingIndicator = aiMessageContentElement.querySelector('.thinking-indicator');
                        if (thinkingIndicator) {
                            aiMessageContentElement.innerHTML = "Failed to get a response. Please try again.";
                            const messageBubble = aiMessageContentElement.closest('.message');
                            if(messageBubble) messageBubble.classList.add('error-message');
                        }
                    }

                    if (!isThinkButton) {
                        if(askAnythingDiv) askAnythingDiv.innerText = '';
                        clearAttachedImage(); // Clear global image data and preview
                    }

                } catch (error) {
                    console.error("Error during initial prompt submission:", error);
                    alert("Error processing your request: " + error.message);
                    // If chat view is active, show error there, otherwise it might be confusing
                    if (document.body.classList.contains('chat-active') && currentChatSessionId) {
                         renderMessage('system', "Failed to process your request. Please try again.", false, true);
                    }
                }
            })();
        }
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            const askAnythingDiv = document.querySelector('.ask-anything-text');
            const currentInputText = askAnythingDiv.innerText.trim();

            if (!currentInputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = currentInputText;
            let apiInputText = originalUserQuery;
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        console.error("Failed to create and retrieve new session from DB for initial prompt.");
                        alert("Error starting a new chat. Please try again or refresh.");
                        return;
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                        clearAttachedImage();
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);

                    if (fullResponseText && aiMessageContentElement) {
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight;
                        await saveMessageToSession(currentChatSessionId, 'ai', fullResponseText);
                    } else if (!fullResponseText && aiMessageContentElement) {
                        aiMessageContentElement.innerHTML = "Failed to get a response. Please try again.";
                        const messageBubble = aiMessageContentElement.closest('.message');
                        if(messageBubble) messageBubble.classList.add('error-message');
                    }

                    if (!isThinkButton) {
                        if(askAnythingDiv) askAnythingDiv.innerText = '';
                        // currentImageData is cleared by clearAttachedImage() if it was used for the prompt.
                        // If it wasn't used (e.g. text-only prompt), it might still be set.
                        // So, explicitly clear it here if not a "Think" action.
                        clearAttachedImage();
                    }

                } catch (error) {
                    console.error("Error during initial prompt submission:", error);
                    alert("Error processing your request: " + error.message);
                    if (document.body.classList.contains('chat-active')) {
                         renderMessage('system', "Failed to process your request. Please try again.", false, true);
                    }
                }
            })();
        }
            (button.classList.contains('send-button') && !document.body.classList.contains('chat-active')) // Send button on initial prompt screen
        ) {
            const askAnythingDiv = document.querySelector('.ask-anything-text'); // Ensure we get fresh inputText here too
            const inputText = askAnythingDiv.innerText.trim(); // Re-fetch inputText for this specific handler block

            if (!inputText && !currentImageData) {
                alert("Please enter something or attach an image.");
                console.log("Initial prompt: Input and attachment are empty, not calling API.");
                return;
            }

            const isThinkButton = button.querySelector('i.fa-lightbulb');
            const thinkingBudget = isThinkButton ? 24576 : 0;
            const originalUserQuery = inputText; // Store the original input for saving and display
            let apiInputText = originalUserQuery; // This will be sent to the API (potentially modified for crypto)
            let enableSearch = isSearchModeActive;
            const isCrypto = isCryptoQuery(originalUserQuery);

            if (isCrypto) {
                enableSearch = true;
                apiInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${originalUserQuery}"`;
                console.log("Crypto query detected, modified prompt for API and enabled search.");
            }

            console.log(`${isThinkButton ? "Think" : "Initial Send"} Button: Processing initial prompt...`);

            (async () => {
                try {
                    const newSession = await createNewChatSessionInDB();
                    if (!newSession || !newSession.sessionId) {
                        throw new Error("Failed to create and retrieve new session from DB for initial prompt.");
                    }
                    currentChatSessionId = newSession.sessionId;

                    addOrUpdateChatHistoryUI(currentChatSessionId, newSession.chatTitle, true);

                    showChatView();
                    renderMessage('user', originalUserQuery);

                    await saveMessageToSession(currentChatSessionId, 'user', originalUserQuery);

                    const aiMessageContentElement = renderMessage('ai', '', true);

                    if (currentImageData && apiInputText.includes(originalUserQuery)) {
                        clearAttachedImage();
                    }

                    const fullResponseText = await callGeminiAPI(apiInputText, thinkingBudget, enableSearch, aiMessageContentElement);
                .then(fullResponseText => {
                    if (fullResponseText && aiMessageContentElement) {
                        // Try to parse for crypto data after full response
                        if (isCrypto) {
                            const structuredHtml = parseAndFormatCryptoData(fullResponseText);
                            if (structuredHtml) {
                                aiMessageContentElement.innerHTML = structuredHtml;
                                // Ensure copy buttons are added if code blocks exist in structuredHTML (though unlikely for this card)
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            } else {
                                // If parsing fails, stick to markdown rendering of the full response
                                aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                                addCopyButtonsToCodeBlocks(aiMessageContentElement);
                            }
                        } else {
                             // Default markdown rendering for non-crypto queries (already handled by streaming in callGeminiAPI)
                             // but ensure final content is set if not fully handled by stream due to partial parsing
                            aiMessageContentElement.innerHTML = marked.parse(fullResponseText);
                            addCopyButtonsToCodeBlocks(aiMessageContentElement);
                        }
                        // Ensure message list scrolls with new content
                        const messageList = document.getElementById('message-list');
                        if (messageList) messageList.scrollTop = messageList.scrollHeight;

                        saveMessageToSession(currentChatSessionId, 'ai', fullResponseText) // Save the raw AI response
                            .then(() => console.log("AI response saved to session:", currentChatSessionId))
                            .catch(err => console.error("Error saving AI response:", err));
                    }
                })
                .catch(error => {
                    console.error("Error calling Gemini API from initial prompt:", error);
                    if (aiMessageContentElement) {
                        aiMessageContentElement.textContent = "Error fetching response. Please try again.";
                    }
                });

            if (!isThinkButton) {
                askAnythingDiv.innerText = '';
                clearAttachedImage();
            }
        }
        */
        console.log("Initial Send/Think button original logic now commented out. New handlers will take over."); // New placeholder
    }
// Model dropdown population and handling
document.addEventListener('DOMContentLoaded', () => {
    // Call initDB here to ensure it runs after DOM is loaded
    initDB().then(() => {
        console.log("IndexedDB: initDB call from DOMContentLoaded completed.");
        // loadAllChatHistoriesUI is called within initDB's onsuccess
        // It will also call startNewChat if DB is empty, or load the most recent.
    }).catch(err => {
        console.error("IndexedDB: initDB call from DOMContentLoaded failed:", err);
        // If DB init fails, still try to set up a basic new chat experience
        startNewChat().catch(startErr => console.error("Fallback startNewChat after DB init failure also failed:", startErr));
    });

    showSearchView(); // Set initial view

    // Event listener for the "New Chat" button in the sidebar
    const newChatBtn = document.getElementById('new-chat-button');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            newChatBtn.disabled = true; // Prevent double clicks
            startNewChat().catch(err => {
                console.error("Error starting new chat from button click:", err);
                displayStatusMessage("Failed to start new chat. " + err.message, true); // Using the existing displayStatusMessage
                // alert("Failed to start new chat. Please check console."); // displayStatusMessage is likely better
            }).finally(() => {
                newChatBtn.disabled = false; // Re-enable button
            });
        });
    } else {
        console.warn("New Chat button ('new-chat-button') not found in sidebar.");
    }

    const dropdown = document.getElementById('model-dropdown-list');
    const selectedModelLabel = document.getElementById('selected-model-label');

    if (dropdown) {
        // Populate dropdown
        availableModels.forEach(model => {
            const item = document.createElement('div');
            item.className = 'model-dropdown-item';
            if (model.id === currentModelId) {
                item.classList.add('selected-model-item');
            }
            item.textContent = model.label;
            item.dataset.modelId = model.id;

            item.addEventListener('click', () => {
                // Update selected model
                currentModelId = model.id;
                // Only use short label for Flash-Lite
                if (selectedModelLabel) {
                    selectedModelLabel.textContent = (model.id === "gemini-2.0-flash-lite") ? model.shortLabel : model.label;
                }

                // Update UI to reflect selection
                document.querySelectorAll('.model-dropdown-item').forEach(i => i.classList.remove('selected-model-item'));
                item.classList.add('selected-model-item');

                // Update button capabilities
                updateButtonCapabilities(model.capabilities);

                // Hide dropdown
                dropdown.style.display = 'none';
                console.log("Model changed to:", model.label, "capabilities:", model.capabilities);
            });

            dropdown.appendChild(item);
        });

        // Initialize capabilities for default model
        const defaultModel = availableModels.find(m => m.id === currentModelId);
        if (defaultModel) {
            updateButtonCapabilities(defaultModel.capabilities);
        }
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('model-dropdown-list');
        const modelSelector = document.querySelector('.model-selector');
        
        if (dropdown && modelSelector && !modelSelector.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
});

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
document.querySelector('.ask-anything-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sendButton = document.querySelector('.send-button');
        if (sendButton) {
            sendButton.click();
        }
    }
});

// Auto-resize text input based on content
document.querySelector('.ask-anything-text')?.addEventListener('input', (e) => {
    const element = e.target;
    const hasContent = element.textContent.trim().length > 0;
    const sendButton = document.querySelector('.send-button');
    
    // Enable/disable send button based on content
    if (sendButton) {
        sendButton.disabled = !hasContent;
        sendButton.style.opacity = hasContent ? '1' : '0.5';
    }
    
    // Auto-expand input area for longer content
    if (element.scrollHeight > element.clientHeight) {
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, 120) + 'px';
    }
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
        const textInput = document.querySelector('.ask-anything-text');
        if (textInput && textInput.textContent.trim()) {
            textInput.textContent = '';
            textInput.focus();
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
                background: rgba(255, 255, 255, 0.9);
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 12px;
                color: #666;
                transition: all 0.2s ease;
            `;
            
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(block.textContent).then(() => {
                    copyButton.innerHTML = '<i class="fas fa-check"></i>';
                    copyButton.style.color = '#4CAF50';
                    setTimeout(() => {
                        copyButton.innerHTML = '<i class="fas fa-copy"></i>';
                        copyButton.style.color = '#666';
                    }, 2000);
                });
            });
            
            pre.style.position = 'relative';
            pre.appendChild(copyButton);
        }
    });
}

console.log("Aegis Protocol DeFi Gateway loaded successfully!");

// --- Chat Input Area Event Listeners ---
const chatSendMessageButton = document.getElementById('chat-send-button');
const chatMessageInput = document.getElementById('chat-message-input');

if (chatSendMessageButton && chatMessageInput) {
    chatSendMessageButton.addEventListener('click', async () => {
        const chatInputText = chatMessageInput.value.trim();
        if (!chatInputText) return;

        if (!currentChatSessionId) {
            console.error("No active chat session ID found for sending message.");
            alert("Error: No active chat session. Please start a new chat from the main screen.");
            return;
        }

        try {
            await saveMessageToSession(currentChatSessionId, 'user', chatInputText);
            renderMessage('user', chatInputText);
            chatMessageInput.value = ''; // Clear input

            const aiMessageContentElement = renderMessage('ai', '', true); // thinking = true

            let finalChatInputText = chatInputText;
            let enableSearchInChat = isSearchModeActive; // Default search mode for chat
            const isChatCrypto = isCryptoQuery(chatInputText);

            if (isChatCrypto) {
                enableSearchInChat = true; // Force search for crypto queries
                finalChatInputText = `"User is asking about a specific cryptocurrency. Please use your search tool to find the latest information and provide the data in the following format (if available, otherwise omit the field). Do not make up data; if a field is not found, state 'Data not available'. Respond ONLY with the structured data, followed by any additional commentary if necessary. Format:
Coin Name (Symbol)
- Current Price: $X
- Market Cap: $X
- 24h Trading Volume: $X
- Price Change (24h): X%
- All-Time High: $X (on YYYY-MM-DD)
- Percent from ATH: X%
- Total Supply: X SYMBOL
- Max Supply: X SYMBOL
Key Price Movements:
- 1 Hour Change: X%
- 24 Hour Change: X%
- 7 Day Change: X%
- 30 Day Change: X%
- 1 Year Change: X%
- Future Unlocks: Info

User query: "${chatInputText}"`;
                console.log("Chat: Crypto query detected, modified prompt and enabled search.");
            }

            const fullAiResponse = await callGeminiAPI(finalChatInputText, 0, enableSearchInChat, aiMessageContentElement);

            if (fullAiResponse && aiMessageContentElement) {
                 // Try to parse for crypto data after full response
                if (isChatCrypto) {
                    const structuredHtml = parseAndFormatCryptoData(fullAiResponse);
                    if (structuredHtml) {
                        aiMessageContentElement.innerHTML = structuredHtml;
                        addCopyButtonsToCodeBlocks(aiMessageContentElement);
                    } else {
                        // If parsing fails, stick to markdown rendering (already mostly done by streaming)
                        aiMessageContentElement.innerHTML = marked.parse(fullAiResponse);
                        addCopyButtonsToCodeBlocks(aiMessageContentElement);
                    }
                } else {
                    // Default markdown rendering (already handled by streaming in callGeminiAPI)
                    // but ensure final content is set if not fully handled by stream due to partial parsing
                    aiMessageContentElement.innerHTML = marked.parse(fullAiResponse);
                    addCopyButtonsToCodeBlocks(aiMessageContentElement);
                }
                // Ensure message list scrolls with new content
                const messageList = document.getElementById('message-list');
                if (messageList) messageList.scrollTop = messageList.scrollHeight;

                await saveMessageToSession(currentChatSessionId, 'ai', fullAiResponse); // Save the raw AI response
            }
        } catch (error) {
            console.error("Error during chat message sending or AI response:", error);
            // Optionally render an error message in the chat
            renderMessage('system', 'An error occurred. Please try again.', false, true); // Ensure error flag is true
        }
        // Ensure button is re-enabled and input focused after processing, regardless of success/failure
        if (typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(false);
        }
        chatMessageInput.focus(); // Focus input after sending
    });

    chatMessageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            chatSendMessageButton.click();
        }
    });

    // New: Listener to enable/disable send button based on input
    chatMessageInput.addEventListener('input', function() {
        if (typeof toggleChatSendButtonState === 'function') {
            toggleChatSendButtonState(this.value.trim() === '');
        }
    });
    // Initial state for chat send button (disabled if input is empty)
    if (typeof toggleChatSendButtonState === 'function') {
         toggleChatSendButtonState(chatMessageInput.value.trim() === '');
    }

} else {
    console.warn("Chat input elements ('chat-send-button' or 'chat-message-input') not found. Chat input functionality will be disabled.");
}
// --- End Chat Input Area Event Listeners ---

// Example usage (can be removed or adapted for actual chat flow):
/*
document.addEventListener('DOMContentLoaded', async () => {
    // await initDB(); // Ensure DB is initialized - now called above

    const newSessionId = createNewChatSession();
    console.log("New session created:", newSessionId);

    try {
        await saveMessageToSession(newSessionId, 'user', 'Hello, Aegis!');
        await saveMessageToSession(newSessionId, 'ai', 'Hello, User! How can I help you today?');
        await saveMessageToSession(newSessionId, 'user', 'Tell me about IndexedDB.');

        const messages = await getSessionMessages(newSessionId);
        console.log("Messages for session", newSessionId, messages);

        const nonExistentMessages = await getSessionMessages('non-existent-session');
        console.log("Messages for non-existent session:", nonExistentMessages); // Should be []

    } catch (error) {
        console.error("Error during IndexedDB example usage:", error);
    }
});
*/
    // --- New Event Listeners for Initial Prompt Screen Buttons ---
    console.log("Setting up new event listeners for initial prompt screen buttons...");

    const initialMainSendButton = document.querySelector('.search-actions-area .action-buttons-right .send-button');
    if (initialMainSendButton) {
        initialMainSendButton.addEventListener('click', (event) => {
            if (!document.body.classList.contains('chat-active')) {
                console.log("Initial Main Send Button (new listener) clicked.");
                handleInitialPromptSubmit(event, false); // isThinkAction = false
            } else {
                // This case should ideally be handled by the chat input's send button listener
                console.log("Initial Main Send Button clicked, but chat is active. Ignoring in favor of chat send button.");
            }
        });
        console.log("New listener attached to Initial Main Send Button.");
    } else {
        console.warn("Initial prompt Send button not found with selector '.search-actions-area .action-buttons-right .send-button'.");
    }

    const initialThinkButtonIcon = document.querySelector('.action-buttons-left .action-button i.fa-lightbulb');
    if (initialThinkButtonIcon) {
        const initialThinkButton = initialThinkButtonIcon.closest('.action-button');
        if (initialThinkButton) {
            initialThinkButton.addEventListener('click', (event) => {
                if (!document.body.classList.contains('chat-active')) {
                    console.log("Initial Think Button (new listener) clicked.");
                    handleInitialPromptSubmit(event, true); // isThinkAction = true
                }
            });
            console.log("New listener attached to Initial Think Button.");
        } else {
             console.warn("Parent .action-button for Think button icon not found.");
        }
    } else {
        console.warn("Think button icon not found with selector '.action-buttons-left .action-button i.fa-lightbulb'.");
    }
    // --- End New Event Listeners ---