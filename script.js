let isSearchModeActive = false;
// Removed: attachedImageBase64, attachedImageMimeType, fullDataUrlForPreview
let currentImageData = null; // Will store { mimeType, base64Data, dataURLForPreview }
let currentModelId = "gemini-2.5-flash-preview-05-20"; // Default model
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
const googleApiKey = "YOUR_GOOGLE_API_KEY"; // Placeholder for Google Custom Search API Key
const googleCx = "YOUR_GOOGLE_CX_ID"; // Placeholder for Google Custom Search Engine ID

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
    console.log("callGeminiAPI: Received parameters", {
        inputText: inputText,
        thinkingBudget: thinkingBudget,
        enableSearchTool: enableSearchTool,
        currentImageData_global: currentImageData ? { mimeType: currentImageData.mimeType, base64Data: currentImageData.base64Data.substring(0,30) + "..."} : null
    });
    const responseArea = document.getElementById('api-response-area');
    const spinnerContainer = responseArea ? responseArea.querySelector('.spinner-container') : null;
    const responseContentDiv = responseArea ? responseArea.querySelector('.response-content') : null;

    if (typeof GEMINI_API_KEY === 'undefined' || !GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set. Please set it before calling the API.");
        alert("GEMINI_API_KEY is not set. Please configure it in the script.");
        if (responseContentDiv && responseArea) { // Ensure responseContentDiv exists
            responseContentDiv.innerText = "API Key is not configured. Please set GEMINI_API_KEY in the script.";
            responseContentDiv.style.color = 'var(--google-red)';
            if(spinnerContainer) spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            responseArea.style.display = 'block';
        }
        return null;
    }

    if (responseArea && spinnerContainer && responseContentDiv) {
        responseContentDiv.innerHTML = ''; // Clear previous content
        responseContentDiv.style.display = 'none'; // Hide content area
        spinnerContainer.style.display = 'flex'; // Show spinner (use flex due to its styling)
        responseArea.style.display = 'block'; // Ensure main area is visible
    }

    // const MODEL_ID = "gemini-2.5-flash-preview-05-20"; // REMOVE THIS LINE
    // The global 'currentModelId' variable (defined outside) will be used here.
    const GENERATE_CONTENT_API = "streamGenerateContent";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${currentModelId}:${GENERATE_CONTENT_API}?key=${GEMINI_API_KEY}`;

    const requestBody = {
        contents: [{ role: "user", parts: [] }], // Parts will be populated below
        generationConfig: {
            thinkingConfig: {
                thinkingBudget: thinkingBudget,
            },
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "text/plain", // Keep as text/plain for Markdown parsing
        },
        systemInstruction: {
            parts: [{
                text: "You are Aegis Protocol, an AI-driven gateway that unites DeFi, GameFi, and Real-World Assets under a single intelligent framework. Your tasks include providing real-time token analytics, automating asset tokenization validation, and optimizing gaming economies. Uphold the principles of transparency, interpretability, and consumer protection. When offering recommendations, cite on-chain data points, market trends, and risk assessments. Always ensure users can trace how your conclusions were derived. Use proper markdown formatting including headings, lists, code blocks, tables, and other formatting elements."
            }]
        }
    };

    if (enableSearchTool) {
        requestBody.tools = [ { "urlContext": {} }, { "googleSearch": {} } ];
    }

    const parts = [];
    
    // Enhanced prompt to encourage rich markdown formatting with Aegis Protocol branding
    const markdownPrompt = `You are Aegis Protocol, an AI-driven gateway specializing in DeFi, GameFi, and Real-World Assets. Provide comprehensive analysis with rich markdown formatting including headings, bullet points, code blocks, tables, and other elements for enhanced readability.

User Query: ${inputText || ""}

Please provide a detailed crypto/blockchain-focused response using markdown elements where appropriate.`;
    
    let textToSend = markdownPrompt;

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
        if (responseContentDiv && responseArea && spinnerContainer) { // Ensure spinnerContainer is defined here too
            responseContentDiv.innerText = "Please provide text or an image to send.";
            responseContentDiv.style.color = 'var(--google-red)';
            spinnerContainer.style.display = 'none';
            responseContentDiv.style.display = 'block';
            responseArea.style.display = 'block';
        }
        return null;
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

        if (spinnerContainer) spinnerContainer.style.display = 'none'; // Hide spinner

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error:", response.status, errorText);
            alert(`API Error: ${response.status}. Check console for details.`);
            if (responseContentDiv) { // Update to use responseContentDiv
                responseContentDiv.innerText = `Sorry, something went wrong. \nError: ${response.status}. See console for details.`;
                responseContentDiv.style.color = 'var(--google-red)';
                responseContentDiv.style.display = 'block';
            }
            return null;
        }

        const data = await response.text();
        console.log("API Success (raw):", data);

        if (responseContentDiv) {
            let cleanedData = data;
            if (data.startsWith(")]}'\n")) { cleanedData = data.substring(5); }
            let finalText = cleanedData;
            
            // Enhanced JSON parsing for streaming responses
            try {
                if ((cleanedData.startsWith("{") && cleanedData.endsWith("}")) || (cleanedData.startsWith("[") && cleanedData.endsWith("]"))) {
                    const jsonData = JSON.parse(cleanedData);
                    if (jsonData && jsonData.text) { 
                        finalText = jsonData.text; 
                    }
                    else if (Array.isArray(jsonData) && jsonData.length > 0) {
                        let accumulatedText = "";
                        jsonData.forEach(item => {
                            if (item.candidates && item.candidates[0] && item.candidates[0].content && item.candidates[0].content.parts && item.candidates[0].content.parts[0] && item.candidates[0].content.parts[0].text) {
                                accumulatedText += item.candidates[0].content.parts[0].text;
                            }
                        });
                        if (accumulatedText) finalText = accumulatedText;
                    }
                } else {
                    // Handle streaming JSON-like responses
                    const lines = cleanedData.trim().split('\n');
                    let accumulatedText = "";
                    lines.forEach(line => {
                        if (line.trim() && !line.trim().startsWith(',')) {
                            try {
                                const parsedLine = JSON.parse(line.replace(/,$/, ''));
                                if (parsedLine.candidates && parsedLine.candidates[0] && parsedLine.candidates[0].content && parsedLine.candidates[0].content.parts && parsedLine.candidates[0].content.parts[0] && parsedLine.candidates[0].content.parts[0].text) {
                                    accumulatedText += parsedLine.candidates[0].content.parts[0].text;
                                }
                            } catch (lineError) {
                                // Skip invalid JSON lines
                            }
                        }
                    });
                    if (accumulatedText) finalText = accumulatedText;
                }
            } catch (e) { 
                console.warn("Response was not valid JSON or a known structure, displaying as plain text.", e); 
            }

            // Enhanced markdown processing
            if (typeof marked !== 'undefined') {
                // Post-process the text to ensure better markdown formatting
                let processedText = finalText
                    .replace(/\n\n\n+/g, '\n\n') // Remove excessive line breaks
                    .replace(/^\s+/gm, '') // Remove leading whitespace from lines
                    .trim();
                
                // Ensure proper spacing around headers
                processedText = processedText.replace(/^(#+\s.+)$/gm, '\n$1\n');
                
                // Parse and render markdown
                responseContentDiv.innerHTML = marked.parse(processedText);
                
                // Add copy buttons to code blocks
                addCopyButtonsToCodeBlocks(responseContentDiv);
                
                // Smooth scroll to the response area
                setTimeout(() => {
                    responseArea.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                }, 100);
            } else {
                console.error("Marked.js library not loaded. Displaying as plain text.");
                responseContentDiv.innerText = finalText;
            }
            responseContentDiv.style.display = 'block';
        }
        return data;

    } catch (error) {
        if (spinnerContainer) spinnerContainer.style.display = 'none'; // Hide spinner
        console.error("Fetch Error:", error);
        alert("Fetch Error. Check console for details.");
        if (responseContentDiv) { // Update to use responseContentDiv
            responseContentDiv.innerText = "Failed to fetch response. Please check your connection or API key.";
            responseContentDiv.style.color = 'var(--google-red)';
            responseContentDiv.style.display = 'block';
        }
        return null;
    }
}

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
        // Think button
        else if (button.classList.contains('action-button') && button.querySelector('i.fa-lightbulb')) {
            // console.log("Think button clicked"); // Optional debug log
            if (!inputText && !currentImageData) {
                alert("Please enter something or attach an image to think about.");
                console.log("Input and attachment are empty, 'Think' button not calling API.");
            } else {
                console.log("Think Button: Before callGeminiAPI", {
                    inputText: inputText,
                    isSearchModeActive: isSearchModeActive,
                    currentImageData_global: currentImageData ? { mimeType: currentImageData.mimeType, base64Data: currentImageData.base64Data.substring(0,30) + "..." } : null
                });
                callGeminiAPI(inputText, 24576, isSearchModeActive);
                // NOTE: "Think" button intentionally does not clear attachment or text.
            }
        }
        // Send button
        else if (button.classList.contains('send-button')) {
            // console.log("Send button clicked. Input:", inputText); // Optional debug log
            if (!inputText && !currentImageData) {
                alert("Please type something or attach an image to send.");
                console.log("Input and attachment are empty, 'Send' button not calling API.");
            } else {
                console.log("Send Button: Before callGeminiAPI", {
                    inputText: inputText,
                    isSearchModeActive: isSearchModeActive,
                    currentImageData_global: currentImageData ? { mimeType: currentImageData.mimeType, base64Data: currentImageData.base64Data.substring(0,30) + "..." } : null
                });
                callGeminiAPI(inputText, 0, isSearchModeActive);
                // Clear input after sending
                askAnythingDiv.innerText = '';
                clearAttachedImage(); // Clear attachment after sending for "Send" button
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
document.addEventListener('DOMContentLoaded', () => {
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

async function fetchGoogleSearchResults(query) {
    if (!googleApiKey || googleApiKey === "YOUR_GOOGLE_API_KEY" || !googleCx || googleCx === "YOUR_GOOGLE_CX_ID") {
        console.error("Google API Key or CX ID is not configured. Please set them in script.js.");
        // In a real app, you might throw an error or return a specific status
        // For this PoC, we'll simulate an empty search result or specific error object
        return Promise.reject("API Key/CX not configured");
    }

    const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleCx}&q=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Failed to parse error JSON.' }));
            console.error(`Google Search API Error: ${response.status} ${response.statusText}`, errorData);
            throw new Error(`HTTP error ${response.status}: ${errorData.error?.message || response.statusText}`);
        }
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            return data.items; // Array of search result items
        } else {
            console.log("No results found for query:", query);
            return []; // Return empty array for no results
        }
    } catch (error) {
        console.error("Failed to fetch Google Search results:", error);
        // Depending on how you want to handle errors upstream, you might re-throw or return a specific error indicator
        throw error;
    }
}

function extractCryptoDataFromSearchResults(searchResults, symbol) {
    const data = {
        coinName: "N/A", // Will try to infer or default
        symbol: symbol.toUpperCase(),
        currentPrice: "N/A",
        marketCap: "N/A",
        volume24h: "N/A",
        priceChange24h: "N/A",
        allTimeHigh: "N/A",
        athDate: "N/A",
        percentFromAth: "N/A",
        totalSupply: "N/A",
        maxSupply: "N/A",
        change1h: "N/A",
        change24h: "N/A", // Note: This is different from priceChange24h in the template, might be redundant or a typo in issue
        change7d: "N/A",
        change30d: "N/A",
        change1y: "N/A",
        futureUnlocks: "N/A"
    };

    // Attempt to infer coinName (very basic)
    const commonNames = { BTC: "Bitcoin", ETH: "Ethereum", ADA: "Cardano", SOL: "Solana", DOGE: "Dogecoin" };
    data.coinName = commonNames[data.symbol] || data.symbol; // Default to symbol if not in common map

    if (!searchResults || searchResults.length === 0) {
        return data;
    }

    for (const item of searchResults) {
        const snippet = (item.snippet || "").toLowerCase();
        const title = (item.title || "").toLowerCase();
        const textToSearch = title + " " + snippet;

        // Try to find current price (very naive regex)
        // Looks for patterns like $123,456.78 or $123.45 or €... or £...
        const priceRegex = /([\$€£])(\d{1,3}(?:,\d{3})*(\.\d+)?|\d+(\.\d+)?)/;
        let priceMatch = textToSearch.match(priceRegex);

        if (priceMatch && data.currentPrice === "N/A") { // Take first plausible price found
            // Check if the text also mentions the symbol or a common name for it, to reduce false positives
            if (textToSearch.includes(data.symbol.toLowerCase()) || textToSearch.includes(data.coinName.toLowerCase())) {
                 data.currentPrice = priceMatch[1] + priceMatch[2];
            }
        }

        // Example for Market Cap (even more naive and unlikely to be reliable)
        const marketCapRegex = /market cap(?:italisation|italization)?(?: of|:)?.*?([\$€£])(\d{1,3}(?:,\d{3})*(?:,\d{3})*(\.\d+)?|\d+(\.\d+)?)/;
        let mcMatch = textToSearch.match(marketCapRegex);
        if (mcMatch && data.marketCap === "N/A") {
             if (textToSearch.includes(data.symbol.toLowerCase()) || textToSearch.includes(data.coinName.toLowerCase())) {
                data.marketCap = mcMatch[1] + mcMatch[2];
            }
        }
        // Add more extraction logic here if other fields are deemed feasible from snippets
        // For now, most will remain N/A
    }
    return data;
}

function formatCryptoDataToMarkdown(data) {
    // Ensure symbol is available for template, default to 'N/A' if data or data.symbol is missing
    const sym = data?.symbol || 'N/A';
    const coinName = data?.coinName || sym; // Default coinName to symbol if not available

    return `
---
**${coinName} (${sym})**

- Current Price: ${data?.currentPrice || 'N/A'}
- Market Cap: ${data?.marketCap || 'N/A'}
- 24h Trading Volume: ${data?.volume24h || 'N/A'}
- Price Change (24h): ${data?.priceChange24h || 'N/A'}
- All-Time High: ${data?.allTimeHigh || 'N/A'} ${data?.athDate ? '(on ' + data.athDate + ')' : ''}
- Percent from ATH: ${data?.percentFromAth || 'N/A'}
- Total Supply: ${data?.totalSupply || 'N/A'} ${sym}
- Max Supply: ${data?.maxSupply || 'N/A'} ${sym}

**Key Price Movements:**
- 1 Hour Change: ${data?.change1h || 'N/A'}
- 24 Hour Change: ${data?.change24h || 'N/A'}
- 7 Day Change: ${data?.change7d || 'N/A'}
- 30 Day Change: ${data?.change30d || 'N/A'}
- 1 Year Change: ${data?.change1y || 'N/A'}

- Future Unlocks: ${data?.futureUnlocks || 'N/A'}

If you need additional details or have further questions, feel free to ask!
---
`;
}

async function processAndFormatCryptoData(promptQuery, symbol) {
    try {
        // Refine query for better search results if needed, e.g., focusing on price or overview
        const searchResults = await fetchGoogleSearchResults(`${symbol} cryptocurrency ${promptQuery}`);
        if (!searchResults) {
            throw new Error('No search results from Google.');
        }
        const extractedData = extractCryptoDataFromSearchResults(searchResults, symbol);
        return formatCryptoDataToMarkdown(extractedData);
    } catch (error) {
        console.error(`Error in processAndFormatCryptoData for ${symbol}:`, error);
        throw new Error(`Failed to process data for ${symbol}: ${error.message}`);
    }
}

function isCryptocurrencyQuery(promptText) {
    const lowerPrompt = promptText.toLowerCase();
    let detectedSymbol = null;

    // Regex for symbols like $BTC or BTC (case insensitive, 3-5 alpha characters)
    // It captures the symbol part after '$' or the standalone symbol.
    const symbolRegex = /\$([a-zA-Z]{3,5})\b|\b([a-zA-Z]{3,5})\b/g;
    let match;
    const potentialSymbols = [];
    // Find all potential symbol matches
    while ((match = symbolRegex.exec(lowerPrompt)) !== null) {
        // match[1] is for $SYMBOL, match[2] is for SYMBOL
        potentialSymbols.push(match[1] || match[2]);
    }

    const cryptoKeywords = [
        "bitcoin", "ethereum", "litecoin", "cardano", "solana", "dogecoin", "shiba inu",
        "xrp", "polkadot", "chainlink", "matic", "polygon", "tron", "avalanche", "binance coin", "bnb",
        "token", "coin", "crypto", "cryptocurrency", "altcoin", "defi", "gamefi", "nft",
        "blockchain", "web3", "metaverse", "exchange", "wallet", "mining", "staking"
    ];
    // Query patterns are not explicitly used in this simplified example's logic
    // but are good to keep for future enhancements.
    /* const queryPatterns = [
        "price of", "current price", "what is the price of", "how much is",
        "info on", "information on", "details about", "tell me about", "explain",
        "market cap of", "marketcap", "mcap", "trading volume", "24h volume",
        "all-time high", "ath", "all time low", "atl",
        "chart for", "prediction for", "forecast for", "future of",
        "compare", "vs", "versus", "analysis of", "review of",
        "how to buy", "where to buy", "best way to invest in"
    ]; */

    let isCryptoMatch = false;

    // Attempt to identify a primary symbol from the prompt
    if (potentialSymbols.length > 0) {
        // Prioritize symbols found. For simplicity, take the last one found as it might be more specific.
        // More sophisticated logic could involve checking against a known list of valid tickers.
        // Ensure detectedSymbol is not a common word mistaken for a symbol by checking against a small list of common English words if needed.
        const commonWords = ["the", "and", "for", "not", "you", "this", "that", "is", "are", "was", "what", "how", "tell", "me", "about", "price", "help", "info", "from"];
        let assignedSymbol = false;
        for (let i = potentialSymbols.length - 1; i >= 0; i--) {
            const symCandidate = potentialSymbols[i];
            if (!commonWords.includes(symCandidate.toLowerCase())) {
                 detectedSymbol = symCandidate.toUpperCase();
                 assignedSymbol = true;
                 break;
            }
        }
        if(assignedSymbol) isCryptoMatch = true; // If a symbol-like pattern is found and not a common word, assume it's crypto-related.
    }

    // Check for keywords, which can also indicate a crypto query
    if (!isCryptoMatch) {
        for (const keyword of cryptoKeywords) {
            if (lowerPrompt.includes(keyword)) {
                isCryptoMatch = true;
                // If keywords matched and we previously found potential symbols (but they were common words),
                // it's more likely they ARE symbols in this context. Re-assign first potential symbol.
                if (!detectedSymbol && potentialSymbols.length > 0) {
                    detectedSymbol = potentialSymbols[0].toUpperCase();
                }
                break;
            }
        }
    }

    // Final check: if a symbol was detected, isCrypto must be true.
    if (detectedSymbol) {
        isCryptoMatch = true;
    }

    let isComplexQuery = false;
    const complexKeywords = [
        "compare", "vs", "versus", "analyze", "analysis", "trend", "predict", "prediction",
        "forecast", "should i", "invest in", "future of", "compare to", "difference between"
    ];
    for (const keyword of complexKeywords) {
        if (lowerPrompt.includes(keyword)) {
            isComplexQuery = true;
            break;
        }
    }

    const uniqueSymbols = new Set(potentialSymbols.map(s => s.toUpperCase()));
    if (uniqueSymbols.size > 1) {
        isComplexQuery = true;
    }

    return {
        isCrypto: isCryptoMatch,
        symbol: detectedSymbol, // This can be null
        isComplex: isComplexQuery
    };
}

// Modify sendMessage function
async function sendMessage() {
    const messageText = userInput.value.trim();
    const imageSrcForDisplay = currentImageData ? `data:${currentImageData.mimeType};base64,${currentImageData.base64Data}` : null;

    if ((!messageText && !currentImageData) || isWaitingForResponse) {
        if (!messageText) autoGrowTextarea();
        return;
    }

    vibrate(50);
    sendSound.play().catch(e => console.warn("Send sound playback failed:", e));
    setInputState(false); // Disable input early

    const userParts = [];
    if (messageText) {
        userParts.push({ text: messageText });
    }
    if (currentImageData) {
        userParts.push({
            inline_data: {
                mime_type: currentImageData.mimeType,
                data: currentImageData.base64Data
            }
        });
    }
    const userMessageForHistory = { role: "user", parts: userParts };

    // Display user message & add to history (common for both paths now)
    displayMessage(messageText || "(Image sent)", 'user', { imageSrc: imageSrcForDisplay });
    chatHistory.push(userMessageForHistory);

    const currentImageBackup = { ...currentImageData }; // Backup image data
    userInput.value = '';
    userInput.dispatchEvent(new Event('input'));
    clearImageSelection(); // Clears currentImageData
    // userInput.blur(); // Blurring can be optional

    const cryptoQueryCheck = isCryptocurrencyQuery(messageText);

    if (cryptoQueryCheck.isCrypto && cryptoQueryCheck.symbol && !cryptoQueryCheck.isComplex) {
        const thinkingMessageElement = displayThinkingIndicator();
        try {
            const cryptoDataMarkdown = await processAndFormatCryptoData(messageText, cryptoQueryCheck.symbol);
            if (thinkingMessageElement) thinkingMessageElement.remove();
            displayMessage(cryptoDataMarkdown, 'ai');
            chatHistory.push({ role: "model", parts: [{ text: cryptoDataMarkdown }] });
        } catch (error) {
            console.error("Error processing crypto query:", error);
            if (thinkingMessageElement) thinkingMessageElement.remove();
            const errorMessage = "Sorry, I couldn't fetch the cryptocurrency data for " + cryptoQueryCheck.symbol + ". Please try again later or ask something else.";
            displayMessage(errorMessage, 'ai', { isError: true });
            chatHistory.push({ role: "model", parts: [{ text: errorMessage }] });
        }
        await saveCurrentChatState();
        setInputState(true);
    } else {
        // This is the original path for Gemini AI
        const apiContents = chatHistory.map(msg => ({ role: msg.role, parts: msg.parts }));
        // Ensure systemInstruction is correctly handled if it was modified or needs to be part of chatHistory for API
        const requestBody = {
            contents: apiContents,
            generationConfig: generationConfig,
            safetySettings: safetySettings,
            systemInstruction: systemInstruction // Make sure this is the correct system instruction object
        };
        await getAIResponseStreaming(requestBody); // This function should handle its own setInputState(true) and saveCurrentChatState
    }
}