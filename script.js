let isSearchModeActive = false;
// Removed: attachedImageBase64, attachedImageMimeType, fullDataUrlForPreview
let currentImageData = null; // Will store { mimeType, base64Data, dataURLForPreview }
let currentModelId = "gemini-2.5-flash-preview-05-20"; // Default model
const availableModels = [
    {
        id: "gemini-2.5-flash-preview-05-20",
        label: "Gemini 2.5 Flash",
        capabilities: { think: true, search: true, attach: true }
    },
    {
        id: "gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        capabilities: { think: false, search: true, attach: true }
    },
    {
        id: "gemini-2.0-flash-lite",
        label: "Gemini 2.0 Flash-Lite",
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
            responseMimeType: "text/plain", // Keep as text/plain for Markdown parsing
        },
    };

    if (enableSearchTool) {
        requestBody.tools = [ { "urlContext": {} }, { "googleSearch": {} } ];
    }

    const parts = [];
    let textToSend = inputText || "";

    if (currentImageData && currentImageData.base64Data && currentImageData.mimeType) {
        parts.push({ text: textToSend });
        parts.push({
            inline_data: {
                mime_type: currentImageData.mimeType,
                data: currentImageData.base64Data
            }
        });
        console.log(`callGeminiAPI: Preparing multimodal request with model: ${currentModelId}`, { text: textToSend, imageMime: currentImageData.mimeType });
    } else if (inputText) {
        parts.push({ text: inputText });
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

        if (responseContentDiv) { // Update to use responseContentDiv
            let cleanedData = data;
            if (data.startsWith(")]}'\n")) { cleanedData = data.substring(5); }
            let finalText = cleanedData;
            try {
                if ((cleanedData.startsWith("{") && cleanedData.endsWith("}")) || (cleanedData.startsWith("[") && cleanedData.endsWith("]"))) {
                    const jsonData = JSON.parse(cleanedData);
                    if (jsonData && jsonData.text) { finalText = jsonData.text; }
                    else if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0].candidates && jsonData[0].candidates[0].content && jsonData[0].candidates[0].content.parts && jsonData[0].candidates[0].content.parts[0]) {
                        let accumulatedText = "";
                        jsonData.forEach(item => {
                            if (item.candidates && item.candidates[0] && item.candidates[0].content && item.candidates[0].content.parts && item.candidates[0].content.parts[0] && item.candidates[0].content.parts[0].text) {
                                accumulatedText += item.candidates[0].content.parts[0].text;
                            }
                        });
                        if (accumulatedText) finalText = accumulatedText;
                    }
                }
            } catch (e) { console.warn("Response was not valid JSON or a known structure, displaying as plain text.", e); }

            if (typeof marked !== 'undefined') {
                responseContentDiv.innerHTML = marked.parse(finalText);
            } else {
                console.error("Marked.js library not loaded. Displaying as plain text.");
                responseContentDiv.innerText = finalText; // Fallback to plain text
            }
            // responseContentDiv.style.color = 'var(--text-primary)'; // Usually handled by CSS on child elements
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
                if (selectedModelLabel) selectedModelLabel.textContent = model.label;

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

// Handle Enter key in text input
document.querySelector('.ask-anything-text')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sendButton = document.querySelector('.send-button');
        if (sendButton) {
            sendButton.click();
        }
    }
});

console.log("Gemini Search Interface loaded successfully!");