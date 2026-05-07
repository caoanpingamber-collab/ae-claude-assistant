// settings.js - API key and preferences storage

function getApiKey() {
    return localStorage.getItem('claude_api_key') || '';
}

function setApiKey(key) {
    localStorage.setItem('claude_api_key', key);
}

function getModel() {
    return localStorage.getItem('claude_model') || 'claude-opus-4-7';
}

function setModel(model) {
    localStorage.setItem('claude_model', model);
}

function getApiEndpoint() {
    return localStorage.getItem('claude_api_endpoint') || 'https://api.anthropic.com';
}

function setApiEndpoint(endpoint) {
    localStorage.setItem('claude_api_endpoint', endpoint.replace(/\/+$/, ''));
}

// Chat log: array of {type, text, images?} entries displayed in chat history
function getChatLog() {
    try {
        var data = localStorage.getItem('claude_chat_log');
        return data ? JSON.parse(data) : [];
    } catch(e) {
        return [];
    }
}

function setChatLog(log) {
    try {
        localStorage.setItem('claude_chat_log', JSON.stringify(log));
    } catch(e) {
        // Storage full — drop oldest half and retry
        try {
            var half = log.slice(Math.floor(log.length / 2));
            localStorage.setItem('claude_chat_log', JSON.stringify(half));
        } catch(e2) {}
    }
}

function clearChatLog() {
    localStorage.removeItem('claude_chat_log');
}

// Conversation messages for API: array of {role, content} for Claude
function getConversationMessages() {
    try {
        var data = localStorage.getItem('claude_conversation');
        return data ? JSON.parse(data) : [];
    } catch(e) {
        return [];
    }
}

function setConversationMessages(messages) {
    try {
        localStorage.setItem('claude_conversation', JSON.stringify(messages));
    } catch(e) {}
}

function clearConversationMessages() {
    localStorage.removeItem('claude_conversation');
}
