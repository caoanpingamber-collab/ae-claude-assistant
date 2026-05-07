// settings.js - API key and preferences storage

function getApiKey() {
    return localStorage.getItem('claude_api_key') || '';
}

function setApiKey(key) {
    localStorage.setItem('claude_api_key', key);
}

function getModel() {
    var stored = localStorage.getItem('claude_model');
    if (stored) return stored;
    return getDefaultModelForProvider(getProvider());
}

function setModel(model) {
    localStorage.setItem('claude_model', model);
}

function getProvider() {
    return localStorage.getItem('claude_provider') || 'anthropic';
}

function setProvider(provider) {
    localStorage.setItem('claude_provider', provider);
}

function getApiEndpoint() {
    var stored = localStorage.getItem('claude_api_endpoint');
    if (stored) return stored;
    return getProvider() === 'openai'
        ? 'https://api.openai.com'
        : 'https://api.anthropic.com';
}

function setApiEndpoint(endpoint) {
    localStorage.setItem('claude_api_endpoint', endpoint.replace(/\/+$/, ''));
}

function getDefaultModelForProvider(provider) {
    if (provider === 'openai') return 'gpt-5';
    return 'claude-opus-4-7';
}

// Detect provider from endpoint URL pattern
function detectProviderFromEndpoint(endpoint) {
    if (!endpoint) return null;
    var url = endpoint.toLowerCase();
    if (url.indexOf('anthropic') !== -1 || url.indexOf('claude') !== -1) return 'anthropic';
    if (url.indexOf('openai') !== -1 || url.indexOf('chat/completions') !== -1) return 'openai';
    return null;
}

// Detect provider from API key prefix (for zero-config UX)
function detectProviderFromKey(key) {
    if (!key) return null;
    var k = key.trim();
    if (k.indexOf('sk-ant-') === 0) return 'anthropic';
    if (k.indexOf('sk-proj-') === 0 || k.indexOf('sk-') === 0) return 'openai';
    return null;
}

// Default endpoint per provider
function getDefaultEndpointForProvider(provider) {
    if (provider === 'openai') return 'https://api.openai.com';
    return 'https://api.anthropic.com';
}

// On panel init, if localStorage has no key, try reading ~/.ae-claude-assistant/config.json
// This file is written by configure-key.sh and lets AI clients (Claude Code / Codex)
// pre-populate the plugin without the user manually pasting.
function loadConfigFileFallback() {
    if (localStorage.getItem('claude_api_key')) return false; // already configured
    if (!window.cep || !window.cep.fs) return false;

    var home = '';
    try { home = require('os').homedir(); } catch(e) { return false; }
    var path = home + '/.ae-claude-assistant/config.json';

    try {
        var result = window.cep.fs.readFile(path);
        if (result.err !== 0) return false;
        var cfg = JSON.parse(result.data);
        if (cfg.api_key) localStorage.setItem('claude_api_key', cfg.api_key);
        if (cfg.provider) localStorage.setItem('claude_provider', cfg.provider);
        if (cfg.api_endpoint) localStorage.setItem('claude_api_endpoint', cfg.api_endpoint);
        if (cfg.model) localStorage.setItem('claude_model', cfg.model);
        return true;
    } catch(e) {
        return false;
    }
}

// Auto-run on script load
loadConfigFileFallback();

// One-shot smart configure: takes a raw API key, sets provider/endpoint/model automatically
function smartConfigure(apiKey) {
    var provider = detectProviderFromKey(apiKey);
    if (!provider) {
        return { success: false, error: '无法识别 API key 格式（应以 sk-ant- 或 sk- 开头）' };
    }
    setProvider(provider);
    setApiKey(apiKey);
    if (!localStorage.getItem('claude_api_endpoint')) {
        localStorage.setItem('claude_api_endpoint', getDefaultEndpointForProvider(provider));
    }
    if (!localStorage.getItem('claude_model')) {
        localStorage.setItem('claude_model', getDefaultModelForProvider(provider));
    }
    return {
        success: true,
        provider: provider,
        endpoint: getApiEndpoint(),
        model: getModel()
    };
}

// Probe local clients (Claude Code, Codex CLI) by checking common config locations.
// Returns Promise resolving to {provider, hint} or null.
function detectInstalledClient() {
    return new Promise(function(resolve) {
        if (!window.cep || !window.cep.fs) {
            resolve(null);
            return;
        }

        var home = '';
        try { home = require('os').homedir(); } catch(e) {}
        if (!home) { resolve(null); return; }

        var clients = [
            { provider: 'anthropic', path: home + '/.claude/settings.json', hint: 'Claude Code 已安装' },
            { provider: 'anthropic', path: home + '/.anthropic/credentials.json', hint: 'Anthropic CLI 已安装' },
            { provider: 'openai',    path: home + '/.codex/config.toml', hint: 'Codex CLI 已安装' },
            { provider: 'openai',    path: home + '/.openai/config', hint: 'OpenAI CLI 已安装' },
            { provider: 'openai',    path: home + '/.continue/config.json', hint: 'Continue 已安装' }
        ];

        for (var i = 0; i < clients.length; i++) {
            try {
                var stat = window.cep.fs.stat(clients[i].path);
                if (stat && stat.err === 0) {
                    resolve({ provider: clients[i].provider, hint: clients[i].hint });
                    return;
                }
            } catch(e) {}
        }
        resolve(null);
    });
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
