// settings.js - API key and preferences storage

function getApiKey() {
    return localStorage.getItem('claude_api_key') || 'sk-test-auth2api-local';
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
    return localStorage.getItem('claude_api_endpoint') || 'http://127.0.0.1:8317';
}

function setApiEndpoint(endpoint) {
    localStorage.setItem('claude_api_endpoint', endpoint.replace(/\/+$/, ''));
}

function getConversationHistory() {
    try {
        var data = localStorage.getItem('claude_conversation');
        return data ? JSON.parse(data) : [];
    } catch(e) {
        return [];
    }
}

function setConversationHistory(history) {
    try {
        localStorage.setItem('claude_conversation', JSON.stringify(history));
    } catch(e) {}
}

function clearConversationHistory() {
    localStorage.removeItem('claude_conversation');
}
