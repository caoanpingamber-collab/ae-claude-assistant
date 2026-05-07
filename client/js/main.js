// main.js - Claude AE Assistant main logic

(function() {
    var lastGeneratedCode = null;
    var isProcessing = false;
    var pendingImages = []; // {data: base64, mediaType: 'image/png', dataUrl: 'data:...'}
    var pendingVideoSummaries = []; // strings, prepended to next user message

    var chatHistory = document.getElementById('chat-history');
    var userInput = document.getElementById('user-input');
    var sendBtn = document.getElementById('send-btn');
    var settingsBtn = document.getElementById('settings-btn');
    var settingsPanel = document.getElementById('settings-panel');
    var apiEndpointInput = document.getElementById('api-endpoint-input');
    var apiKeyInput = document.getElementById('api-key-input');
    var modelInput = document.getElementById('model-input');
    var providerHint = document.getElementById('provider-hint');
    var saveKeyBtn = document.getElementById('save-key-btn');
    var clearBtn = document.getElementById('clear-btn');
    var undoBtn = document.getElementById('undo-btn');
    var codePreview = document.getElementById('code-preview');
    var codeContent = document.getElementById('code-content');
    var executeBtn = document.getElementById('execute-btn');
    var copyBtn = document.getElementById('copy-btn');
    var dismissBtn = document.getElementById('dismiss-btn');
    var uploadBtn = document.getElementById('upload-btn');
    var imageInput = document.getElementById('image-input');
    var imagePreviewBar = document.getElementById('image-preview-bar');
    var imageThumbnails = document.getElementById('image-thumbnails');
    var clearImagesBtn = document.getElementById('clear-images-btn');

    // Init settings
    apiEndpointInput.value = (localStorage.getItem('claude_api_endpoint') || '');
    apiKeyInput.value = getApiKey();
    modelInput.value = (localStorage.getItem('claude_model') || '');
    updateProviderHint();

    function updateProviderHint() {
        var key = apiKeyInput.value.trim();
        if (!key) {
            providerHint.textContent = '';
            providerHint.className = 'provider-hint';
            return;
        }
        var p = detectProviderFromKey(key);
        if (p === 'anthropic') {
            providerHint.textContent = '✓ 检测到 Anthropic Claude（默认 Opus 4.7 + extended thinking）';
            providerHint.className = 'provider-hint detected';
        } else if (p === 'openai') {
            providerHint.textContent = '✓ 检测到 OpenAI 兼容（默认 gpt-5；可在高级设置改成 codex / o1 / 本地代理）';
            providerHint.className = 'provider-hint detected';
        } else {
            providerHint.textContent = '⚠ 未识别的密钥格式（可在高级设置手动指定 API 地址）';
            providerHint.className = 'provider-hint invalid';
        }
    }

    apiKeyInput.addEventListener('input', updateProviderHint);

    // Chat log: in-memory mirror of persisted chat history
    var chatLog = getChatLog();

    function persistChatLog() {
        setChatLog(chatLog);
    }

    function logEntry(entry) {
        chatLog.push(entry);
        // Cap at 100 entries to keep localStorage manageable
        if (chatLog.length > 100) {
            chatLog = chatLog.slice(-100);
        }
        persistChatLog();
    }

    // Restore previous chat on panel load
    function restoreChat() {
        if (!chatLog || chatLog.length === 0) return;
        var welcome = chatHistory.querySelector('.welcome');
        if (welcome) welcome.remove();
        for (var i = 0; i < chatLog.length; i++) {
            var e = chatLog[i];
            if (e.type === 'user') {
                renderUserMessage(e.text, e.images || []);
            } else if (e.type === 'assistant') {
                renderMessage('assistant', e.text);
            } else if (e.type === 'error') {
                renderMessage('error', e.text);
            } else if (e.type === 'system') {
                renderMessage('system', e.text);
            }
        }
        // Restore Claude conversation messages too (for API context)
        if (typeof restoreConversationMessages === 'function') {
            restoreConversationMessages(getConversationMessages());
        }
    }

    // CEP doesn't natively support Cmd/Ctrl+C outside form fields.
    // Manually copy the current selection when pressing the shortcut.
    document.addEventListener('keydown', function(e) {
        var isCopy = (e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C');
        if (!isCopy) return;
        // Don't interfere with native copy in editable fields
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString()) return;

        var text = sel.toString();
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch(err) {}
        document.body.removeChild(ta);
        e.preventDefault();
    });

    // Auto-resize textarea (capped at 120px, content scrolls beyond that)
    function resizeTextarea() {
        userInput.style.height = '36px';
        var h = Math.min(userInput.scrollHeight, 120);
        userInput.style.height = h + 'px';
    }
    userInput.addEventListener('input', resizeTextarea);

    // @ mention dropdown
    var mentionDropdown = null;
    var mentionStartPos = -1;
    var mentionLayers = [];
    var mentionActiveIndex = 0;

    function getDropdown() {
        if (!mentionDropdown) {
            mentionDropdown = document.createElement('div');
            mentionDropdown.id = 'mention-dropdown';
            mentionDropdown.className = 'hidden';
            document.body.appendChild(mentionDropdown);
        }
        return mentionDropdown;
    }

    function hideMentionDropdown() {
        if (mentionDropdown) mentionDropdown.classList.add('hidden');
        mentionStartPos = -1;
        cachedLayers = null; // refresh layer list on next @
    }

    function showMentionEmpty(message) {
        var dd = getDropdown();
        dd.innerHTML = '';
        var item = document.createElement('div');
        item.className = 'mention-empty';
        item.textContent = message;
        dd.appendChild(item);
        var rect = userInput.getBoundingClientRect();
        dd.style.left = rect.left + 'px';
        dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        dd.style.width = rect.width + 'px';
        dd.classList.remove('hidden');
        mentionLayers = [];
    }

    function showMentionDropdown(layers, filter) {
        var dd = getDropdown();

        if (!layers || layers.length === 0) {
            showMentionEmpty('当前合成无图层（或未打开合成）');
            return;
        }

        var filtered = filter ? layers.filter(function(l) {
            return l.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
        }) : layers.slice();

        if (filtered.length === 0) {
            showMentionEmpty('未找到匹配 "' + filter + '" 的图层');
            return;
        }

        mentionLayers = filtered;
        mentionActiveIndex = 0;

        dd.innerHTML = '';
        for (var i = 0; i < filtered.length; i++) {
            (function(idx) {
                var item = document.createElement('div');
                item.className = 'mention-item' + (idx === 0 ? ' active' : '');
                var typeTag = document.createElement('span');
                typeTag.className = 'mention-type';
                typeTag.textContent = filtered[idx].type || '';
                var nameSpan = document.createElement('span');
                nameSpan.className = 'mention-name';
                nameSpan.textContent = filtered[idx].name;
                item.appendChild(typeTag);
                item.appendChild(nameSpan);
                item.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    selectMention(idx);
                });
                item.addEventListener('mouseenter', function() {
                    setActiveIndex(idx);
                });
                dd.appendChild(item);
            })(i);
        }

        // Position dropdown above the textarea
        var rect = userInput.getBoundingClientRect();
        dd.style.left = rect.left + 'px';
        dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        dd.style.width = rect.width + 'px';
        dd.classList.remove('hidden');
    }

    function setActiveIndex(idx) {
        var items = mentionDropdown.querySelectorAll('.mention-item');
        for (var i = 0; i < items.length; i++) items[i].classList.remove('active');
        if (items[idx]) items[idx].classList.add('active');
        mentionActiveIndex = idx;
    }

    function selectMention(idx) {
        if (idx < 0 || idx >= mentionLayers.length) return;
        var name = mentionLayers[idx].name;
        var val = userInput.value;
        var caret = userInput.selectionStart;
        var before = val.substring(0, mentionStartPos);
        var after = val.substring(caret);
        var inserted = '@' + name + ' ';
        userInput.value = before + inserted + after;
        var newCaret = before.length + inserted.length;
        userInput.focus();
        userInput.setSelectionRange(newCaret, newCaret);
        userInput.style.height = 'auto';
        userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
        hideMentionDropdown();
    }

    var cachedLayers = null;

    function fetchAndShowMentions(filter) {
        if (cachedLayers) {
            showMentionDropdown(cachedLayers, filter);
            return;
        }
        showMentionEmpty('正在加载图层...');
        getAEContext().then(function(ctx) {
            cachedLayers = (ctx.allLayers || []).map(function(l) {
                return { name: l.name, type: l.type };
            });
            showMentionDropdown(cachedLayers, filter);
        }).catch(function(err) {
            showMentionEmpty('加载失败: ' + (err && err.message ? err.message : '未知错误'));
        });
    }

    userInput.addEventListener('input', function(e) {
        var val = userInput.value;
        var caret = userInput.selectionStart;

        // Detect @ trigger
        if (mentionStartPos === -1) {
            // Check if the char just typed was @
            if (caret > 0 && val.charAt(caret - 1) === '@') {
                // Trigger as long as @ isn't part of an email (preceded by alphanumeric)
                var prevChar = caret >= 2 ? val.charAt(caret - 2) : '';
                if (!/[A-Za-z0-9._-]/.test(prevChar)) {
                    mentionStartPos = caret - 1;
                    fetchAndShowMentions('');
                    return;
                }
            }
        } else {
            // Already in mention mode - check if still valid
            if (caret <= mentionStartPos) {
                hideMentionDropdown();
                return;
            }
            var typed = val.substring(mentionStartPos + 1, caret);
            if (/\s/.test(typed)) {
                hideMentionDropdown();
                return;
            }
            fetchAndShowMentions(typed);
        }
    });

    userInput.addEventListener('keydown', function(e) {
        if (mentionDropdown && !mentionDropdown.classList.contains('hidden')) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex(Math.min(mentionActiveIndex + 1, mentionLayers.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(Math.max(mentionActiveIndex - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                selectMention(mentionActiveIndex);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideMentionDropdown();
            }
        }
    });

    document.addEventListener('click', function(e) {
        if (mentionDropdown && !mentionDropdown.contains(e.target) && e.target !== userInput) {
            hideMentionDropdown();
        }
    });

    // Settings toggle
    settingsBtn.addEventListener('click', function() {
        settingsPanel.classList.toggle('hidden');
    });

    // Save settings
    saveKeyBtn.addEventListener('click', function() {
        var key = apiKeyInput.value.trim();
        if (!key) {
            appendMessage('error', '请填入 API 密钥');
            return;
        }

        // Auto-detect provider from key
        var detected = detectProviderFromKey(key);
        if (detected) {
            setProvider(detected);
        }

        // Endpoint: user-provided takes priority, else default by provider
        var endpoint = apiEndpointInput.value.trim();
        if (endpoint) {
            setApiEndpoint(endpoint);
        } else if (detected) {
            localStorage.setItem('claude_api_endpoint', getDefaultEndpointForProvider(detected));
        }

        // Model: user-provided takes priority, else default by provider
        var modelStr = modelInput.value.trim();
        if (modelStr) {
            setModel(modelStr);
        } else if (detected) {
            localStorage.setItem('claude_model', getDefaultModelForProvider(detected));
        }

        setApiKey(key);
        settingsPanel.classList.add('hidden');
        var providerLabel = getProvider() === 'openai' ? 'OpenAI 兼容' : 'Anthropic Claude';
        appendMessage('system', '设置已保存 · ' + providerLabel + ' · 模型 ' + getModel());
    });

    // Clear conversation
    clearBtn.addEventListener('click', function() {
        chatHistory.innerHTML = '';
        resetConversation();
        clearChatLog();
        clearConversationMessages();
        chatLog = [];
        hideCodePreview();
        clearPendingImages();
        appendWelcome();
    });

    // Undo last AE change
    undoBtn.addEventListener('click', function() {
        undoBtn.disabled = true;
        undoInAE()
            .then(function(result) {
                if (result.success) {
                    appendMessage('system', '已撤销上一步改动');
                } else {
                    appendMessage('error', '撤销失败: ' + (result.error || '未知错误'));
                }
            })
            .catch(function(err) {
                appendMessage('error', '撤销失败: ' + err.message);
            })
            .then(function() {
                undoBtn.disabled = false;
            });
    });

    // Send / cancel button
    var SEND_ICON = '发送';
    var STOP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';

    function updateSendButton() {
        var hasInput = userInput.value.trim().length > 0 || pendingImages.length > 0;
        if (isProcessing && !hasInput) {
            sendBtn.innerHTML = STOP_ICON;
            sendBtn.classList.add('stop-mode');
            sendBtn.title = '中止当前任务';
        } else {
            sendBtn.innerHTML = SEND_ICON;
            sendBtn.classList.remove('stop-mode');
            sendBtn.title = isProcessing ? '排队发送（当前任务结束后处理）' : '发送';
        }
    }

    sendBtn.addEventListener('click', function() {
        var hasInput = userInput.value.trim().length > 0 || pendingImages.length > 0;
        if (isProcessing && !hasInput) {
            // Cancel current task
            try { abortCurrentRequest(); } catch(e) {}
            messageQueue = [];
            isProcessing = false;
            removeAllStatusMessages();
            appendMessage('system', '已中止当前任务');
            updateSendButton();
            return;
        }
        handleSend();
    });

    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Keep the button visual in sync with input content & processing state
    userInput.addEventListener('input', updateSendButton);

    function removeAllStatusMessages() {
        var msgs = chatHistory.querySelectorAll('.message.system.status');
        for (var i = 0; i < msgs.length; i++) msgs[i].remove();
    }

    // Execute code
    executeBtn.addEventListener('click', handleExecute);

    // Copy code
    copyBtn.addEventListener('click', function() {
        if (lastGeneratedCode) {
            copyToClipboard(lastGeneratedCode);
            appendMessage('system', '代码已复制到剪贴板');
        }
    });

    // Dismiss code preview
    dismissBtn.addEventListener('click', hideCodePreview);

    // Upload button
    uploadBtn.addEventListener('click', function() {
        imageInput.click();
    });

    // File input change
    imageInput.addEventListener('change', function(e) {
        var files = e.target.files;
        for (var i = 0; i < files.length; i++) {
            addImageFile(files[i]);
        }
        imageInput.value = '';
    });

    // Clear all images
    clearImagesBtn.addEventListener('click', clearPendingImages);

    function isMediaFile(type) {
        return type && (type.indexOf('image') === 0 || type.indexOf('video') === 0);
    }

    // Paste media from clipboard, plus re-trigger resize for text paste
    userInput.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (items) {
            for (var i = 0; i < items.length; i++) {
                if (isMediaFile(items[i].type)) {
                    e.preventDefault();
                    addImageFile(items[i].getAsFile());
                    return;
                }
            }
        }
        setTimeout(resizeTextarea, 0);
    });

    // Drag and drop
    var appEl = document.getElementById('app');
    appEl.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        appEl.style.outline = '2px solid #4A90D9';
    });
    appEl.addEventListener('dragleave', function(e) {
        e.preventDefault();
        appEl.style.outline = 'none';
    });
    appEl.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        appEl.style.outline = 'none';
        var files = e.dataTransfer.files;
        for (var i = 0; i < files.length; i++) {
            if (isMediaFile(files[i].type)) {
                addImageFile(files[i]);
            }
        }
    });

    // Preset buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('preset-btn')) {
            var prompt = e.target.getAttribute('data-prompt');
            if (prompt) {
                userInput.value = prompt;
                handleSend();
            }
        }
    });

    function addImageFile(file) {
        if (!file) return;
        if (file.type.indexOf('image') === 0) {
            addPureImageFile(file);
        } else if (file.type.indexOf('video') === 0) {
            addVideoFile(file);
        }
    }

    function addPureImageFile(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var dataUrl = e.target.result;
            var base64 = dataUrl.split(',')[1];
            var mediaType = file.type || 'image/png';
            pendingImages.push({
                data: base64,
                mediaType: mediaType,
                dataUrl: dataUrl
            });
            renderImagePreviews();
        };
        reader.readAsDataURL(file);
    }

    // Extract frames from a video. Cover frame is shown immediately;
    // remaining frames + summary happen in the background.
    function addVideoFile(file) {
        var FRAME_COUNT = 6;
        var MAX_WIDTH = 1024;

        var url = URL.createObjectURL(file);
        var video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        video.addEventListener('loadedmetadata', function() {
            var duration = video.duration;
            if (!duration || !isFinite(duration) || duration <= 0) {
                URL.revokeObjectURL(url);
                appendMessage('error', '视频元数据读取失败');
                return;
            }

            var w = video.videoWidth || 640;
            var h = video.videoHeight || 360;
            var scale = Math.min(1, MAX_WIDTH / w);
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            var ctx = canvas.getContext('2d');

            var times = [];
            for (var k = 0; k < FRAME_COUNT; k++) {
                times.push(duration * (k + 0.5) / FRAME_COUNT);
            }
            // Reorder so middle frame goes first (becomes cover quickly)
            var midIdx = Math.floor(FRAME_COUNT / 2);
            var captureOrder = [midIdx];
            for (var n = 0; n < FRAME_COUNT; n++) {
                if (n !== midIdx) captureOrder.push(n);
            }

            var frames = new Array(FRAME_COUNT);
            var captured = 0;
            var orderIdx = 0;
            var coverPlaceholder = null;

            function captureFrameAtSlot(slot, isFirst) {
                return new Promise(function(resolve) {
                    var onSeek = function() {
                        video.removeEventListener('seeked', onSeek);
                        try {
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                            var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                            var base64 = dataUrl.split(',')[1];
                            frames[slot] = {
                                data: base64,
                                mediaType: 'image/jpeg',
                                dataUrl: dataUrl
                            };
                            captured++;

                            if (isFirst) {
                                // Show cover immediately
                                coverPlaceholder = {
                                    data: base64,
                                    mediaType: 'image/jpeg',
                                    dataUrl: dataUrl,
                                    isVideoCover: true,
                                    videoDuration: duration,
                                    videoSummaryPending: true
                                };
                                pendingImages.push(coverPlaceholder);
                                renderImagePreviews();
                            }
                            resolve();
                        } catch (err) {
                            resolve();
                        }
                    };
                    video.addEventListener('seeked', onSeek);
                    video.currentTime = times[slot];
                });
            }

            // Capture middle frame first (cover), then chain the rest
            captureFrameAtSlot(captureOrder[0], true).then(function() {
                var chain = Promise.resolve();
                for (var p = 1; p < captureOrder.length; p++) {
                    (function(slot) {
                        chain = chain.then(function() { return captureFrameAtSlot(slot, false); });
                    })(captureOrder[p]);
                }
                chain.then(function() {
                    URL.revokeObjectURL(url);
                    var orderedFrames = frames.filter(function(f) { return f; });
                    if (coverPlaceholder) {
                        summarizeVideoBackground(orderedFrames, times, duration, coverPlaceholder);
                    }
                });
            });
        });

        video.addEventListener('error', function() {
            URL.revokeObjectURL(url);
            appendMessage('error', '视频加载失败 (格式可能不支持)');
        });
    }

    function summarizeVideoBackground(frames, times, duration, coverPlaceholder) {
        var apiKey = getApiKey();
        if (!apiKey) {
            coverPlaceholder.videoSummaryPending = false;
            coverPlaceholder.videoSummaryError = '未设置 API 密钥';
            renderImagePreviews();
            return;
        }

        var prompt = '下面是从一段时长 ' + duration.toFixed(2) + ' 秒的视频中均匀抽取的 ' +
            frames.length + ' 帧画面。时间戳分别为：' +
            times.map(function(t) { return t.toFixed(2) + 's'; }).join(', ') + '。\n\n' +
            '请用中文按时间顺序简洁描述视频中发生的视觉变化、动作、运动方向、转场等关键信息。' +
            '格式要求：每帧一行，"[时间戳] 描述"。最后用 1-2 句话总结整体动画意图。' +
            '聚焦动效相关的细节（位置、缩放、旋转、出现/消失、颜色、形变等），便于后续在 AE 中复现。';

        callClaudeOneShot(prompt, frames, apiKey, 'claude-haiku-4-5-20251001')
            .then(function(summary) {
                coverPlaceholder.videoSummary = summary;
                coverPlaceholder.videoSummaryPending = false;
                pendingVideoSummaries.push(summary);
                renderImagePreviews();
            })
            .catch(function(err) {
                coverPlaceholder.videoSummaryPending = false;
                coverPlaceholder.videoSummaryError = err.message;
                renderImagePreviews();
            });
    }

    function renderImagePreviews() {
        imageThumbnails.innerHTML = '';
        if (pendingImages.length === 0) {
            imagePreviewBar.classList.add('hidden');
            return;
        }
        imagePreviewBar.classList.remove('hidden');

        for (var i = 0; i < pendingImages.length; i++) {
            (function(idx) {
                var p = pendingImages[idx];
                var thumb = document.createElement('div');
                thumb.className = 'img-thumb' + (p.isVideoCover ? ' video-cover' : '');
                var img = document.createElement('img');
                img.src = p.dataUrl;
                thumb.appendChild(img);

                if (p.isVideoCover) {
                    var badge = document.createElement('div');
                    badge.className = 'video-badge' + (p.videoSummaryPending ? ' pending' : '');
                    if (p.videoSummaryPending) {
                        badge.innerHTML = '<svg class="spinner" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
                        badge.title = '正在理解视频时序...';
                    } else if (p.videoSummaryError) {
                        badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
                        badge.title = '视频时序分析失败: ' + p.videoSummaryError + '（仍会发送封面图）';
                        badge.style.background = 'rgba(229, 57, 53, 0.85)';
                    } else {
                        badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
                        badge.title = '视频（' + (p.videoDuration ? p.videoDuration.toFixed(1) + 's' : '') + '）已分析时序';
                    }
                    thumb.appendChild(badge);
                }

                var removeBtn = document.createElement('button');
                removeBtn.className = 'remove-img';
                removeBtn.title = '移除';
                removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
                removeBtn.addEventListener('click', function() {
                    if (pendingImages[idx] && pendingImages[idx].isVideoCover) {
                        // Also drop the corresponding summary
                        var videoCovers = 0;
                        for (var k = 0; k <= idx; k++) {
                            if (pendingImages[k] && pendingImages[k].isVideoCover) videoCovers++;
                        }
                        if (pendingVideoSummaries.length >= videoCovers) {
                            pendingVideoSummaries.splice(videoCovers - 1, 1);
                        }
                    }
                    pendingImages.splice(idx, 1);
                    renderImagePreviews();
                });
                thumb.appendChild(removeBtn);

                imageThumbnails.appendChild(thumb);
            })(i);
        }
    }

    function clearPendingImages() {
        pendingImages = [];
        renderImagePreviews();
    }

    var messageQueue = [];

    function handleSend() {
        var message = userInput.value.trim();
        if (!message && pendingImages.length === 0) return;

        var apiKey = getApiKey();
        if (!apiKey) {
            settingsPanel.classList.remove('hidden');
            appendMessage('error', '请先设置 API 密钥');
            return;
        }

        // Remove welcome if present
        var welcome = chatHistory.querySelector('.welcome');
        if (welcome) welcome.remove();

        // Show user message immediately
        appendUserMessage(message, pendingImages);

        // Compose final message: prepend any video summaries as context
        var finalMessage = message;
        if (pendingVideoSummaries.length > 0) {
            var videoCtx = pendingVideoSummaries.map(function(s, i) {
                return '[视频 ' + (i + 1) + ' 的时序分析]\n' + s;
            }).join('\n\n');
            finalMessage = videoCtx + (message ? '\n\n[用户需求]\n' + message : '');
        }

        var imagesToSend = pendingImages.slice();
        userInput.value = '';
        userInput.style.height = 'auto';
        clearPendingImages();
        pendingVideoSummaries = [];

        // Queue the message
        messageQueue.push({ message: finalMessage, images: imagesToSend });

        if (isProcessing) {
            // Just show that it's queued; will process after current finishes
            appendMessage('system', '已加入队列，等待当前请求完成后发送 (队列: ' + messageQueue.length + ')');
            return;
        }

        processQueue();
    }

    function processQueue() {
        if (messageQueue.length === 0) {
            isProcessing = false;
            updateSendButton();
            return;
        }

        // Merge all queued messages into one combined request
        var items = messageQueue.splice(0, messageQueue.length);
        var combinedMessage;
        var combinedImages = [];

        if (items.length === 1) {
            combinedMessage = items[0].message;
            combinedImages = items[0].images;
        } else {
            // Multiple messages: combine as supplementary
            var parts = [items[0].message];
            for (var i = 1; i < items.length; i++) {
                parts.push('补充：' + items[i].message);
                for (var j = 0; j < items[i].images.length; j++) {
                    items[0].images.push(items[i].images[j]);
                }
            }
            combinedMessage = parts.join('\n\n');
            combinedImages = items[0].images;
            for (var k = 1; k < items.length; k++) {
                for (var m = 0; m < items[k].images.length; m++) {
                    combinedImages.push(items[k].images[m]);
                }
            }
        }

        var apiKey = getApiKey();
        isProcessing = true;
        updateSendButton();
        hideCodePreview();
        appendStatus('收集合成与图层信息...');

        var callbacks = {
            onStatus: function(text) { updateLastSystemMessage(text); },
            onToolCall: function(call) {
                // Show as a permanent system note so user sees Claude's investigations
                appendMessage('system', '🔍 Claude 调用工具：' + call.name +
                    (call.args && Object.keys(call.args).length ? ' ' + JSON.stringify(call.args) : ''));
            }
        };

        getAEContext()
            .then(function(context) {
                updateLastSystemMessage('上下文已就绪，连接 Claude...');
                return callClaudeAPI(combinedMessage, context, apiKey, getModel(), combinedImages, callbacks);
            })
            .then(function(response) {
                removeLastSystemMessage();

                var code = extractCode(response);
                var displayText = response;

                if (code) {
                    displayText = response
                        .replace(/```(?:javascript|jsx|extendscript)?\s*\n[\s\S]*?```/g, '')
                        .trim();
                }

                if (displayText) {
                    appendMessage('assistant', displayText);
                }

                if (code) {
                    code = sanitizeCode(code);
                    lastGeneratedCode = code;
                    showCodePreview(code);
                }
            })
            .catch(function(err) {
                removeLastSystemMessage();
                appendMessage('error', '错误: ' + err.message);
            })
            .then(function() {
                if (messageQueue.length > 0) {
                    // Process newly queued messages
                    processQueue();
                } else {
                    isProcessing = false;
                    updateSendButton();
                }
            });
    }

    var autoRetryAttempts = 0;
    var MAX_AUTO_RETRIES = 2;

    function handleExecute() {
        if (!lastGeneratedCode) return;
        autoRetryAttempts = 0;
        executeWithAutoRetry(lastGeneratedCode);
    }

    function executeWithAutoRetry(code) {
        executeBtn.disabled = true;
        appendStatus('正在执行代码...');

        executeInAE(code)
            .then(function(result) {
                removeLastSystemMessage();
                if (result.success) {
                    appendMessage('system', '执行成功' + (result.result !== 'OK' ? ': ' + result.result : ''));
                    autoRetryAttempts = 0;
                    hideCodePreview();
                } else {
                    if (autoRetryAttempts < MAX_AUTO_RETRIES) {
                        autoRetryAttempts++;
                        appendMessage('error', '执行失败 (将自动重试 ' + autoRetryAttempts + '/' + MAX_AUTO_RETRIES + '): ' + result.error + (result.line ? ' (行 ' + result.line + ')' : ''));
                        autoFixViaClaud(code, result.error, result.line);
                    } else {
                        autoRetryAttempts = 0;
                        appendErrorWithFixButton(
                            '执行失败 (自动重试 ' + MAX_AUTO_RETRIES + ' 次后仍失败): ' + result.error + (result.line ? ' (行 ' + result.line + ')' : ''),
                            code, result.error, result.line
                        );
                        hideCodePreview();
                    }
                }
            })
            .catch(function(err) {
                removeLastSystemMessage();
                appendMessage('error', '执行出错: ' + err.message);
                hideCodePreview();
            })
            .then(function() {
                executeBtn.disabled = false;
            });
    }

    // Build a diagnostic checklist tailored to the error type, so retry has direction
    function buildAutoFixPrompt(failedCode, errorMsg, errorLine) {
        var hints = [];
        var em = (errorMsg || '').toLowerCase();
        var emRaw = errorMsg || '';

        // Syntax error → likely non-JS content sneaked into code, or ES6 syntax leak
        if (em.indexOf('syntax') !== -1 || emRaw.indexOf('应为') !== -1 || emRaw.indexOf('expected') !== -1) {
            hints.push('● [SyntaxError 优先排查] 代码块第 ' + (errorLine || '?') + ' 行无法解析，可能原因（按概率排序）：');
            hints.push('  1. 代码块开头夹杂了非 JS 内容（JSON 片段、"key": value 标注、← 箭头注释、Markdown 列表）。本次修复必须输出纯 JS，代码块里禁止任何标注或解释。');
            hints.push('  2. ES6 语法泄漏：检查 let/const/箭头函数 (=>)/模板字符串 (`...`)/解构 ({a,b}=)/Array.forEach/map/filter；ExtendScript 是 ES3。');
            hints.push('  3. 字符串里有未转义的引号或换行；中文标点（双引号、单引号、；）误用为 JS 语法。');
            hints.push('  4. 缺少分号导致两条语句粘在一起。');
        }

        // Null reference → property/effect not found
        if (em.indexOf('null') !== -1 || emRaw.indexOf('不是对象') !== -1) {
            hints.push('● [TypeError null 排查]');
            hints.push('  1. addProperty(matchName) 返回 null：matchName 拼写错误。先用 list_all_layers + query_effect 看实际可用的 matchName。');
            hints.push('  2. layer.property("xxx") 返回 null：属性名错误。用 query_layer 看真实属性树。');
            hints.push('  3. 选中图层为空：comp.selectedLayers.length 为 0。');
            hints.push('  4. 找不到目标图层：用 list_all_layers 确认图层名拼写。');
        }

        // Range / index errors
        if (em.indexOf('range') !== -1 || emRaw.indexOf('范围') !== -1 || emRaw.indexOf('索引') !== -1) {
            hints.push('● [范围错误] 索引超界。AE 集合是 1-indexed (从 1 开始)，不是 0。检查 numProperties / numLayers 边界。');
        }

        // Type errors
        if (em.indexOf('value') !== -1 || em.indexOf('参数') !== -1 || emRaw.indexOf('数组') !== -1) {
            hints.push('● [值类型] setValue 传错类型。Position/Scale 必须是 [x,y] 数组；Opacity/Rotation 是数字。检查每个 setValueAtTime 的 value 形状。');
        }

        if (hints.length === 0) {
            hints.push('● 通用排查：用 query_layer 看图层真实状态，对比代码假设的属性名/结构是否一致。');
        }

        return '上一段代码执行失败。\n\n' +
            '错误信息：' + errorMsg + (errorLine ? ' (行 ' + errorLine + ')' : '') + '\n\n' +
            '失败的代码：\n```javascript\n' + failedCode + '\n```\n\n' +
            '诊断方向：\n' + hints.join('\n') + '\n\n' +
            '请按上面的方向，先用 query_layer / query_effect / list_all_layers 工具调查实际状态（不要只看错误信息字面），定位真正原因，再给出修复后的完整代码。\n\n' +
            '重要：代码块里只能是纯可执行的 JavaScript，禁止夹杂 JSON 片段、"key":value 标注、← 箭头说明、Markdown 列表、中文注释等任何非代码内容。所有解释放在代码块外面。';
    }

    function autoFixViaClaud(failedCode, errorMsg, errorLine) {
        var apiKey = getApiKey();
        if (!apiKey) return;

        appendStatus('Claude 正在分析错误并修复...');

        var fixMsg = buildAutoFixPrompt(failedCode, errorMsg, errorLine);

        var callbacks = {
            onStatus: function(text) { updateLastSystemMessage(text); },
            onToolCall: function(call) {
                appendMessage('system', '🔍 Claude 调用工具：' + call.name +
                    (call.args && Object.keys(call.args).length ? ' ' + JSON.stringify(call.args) : ''));
            }
        };

        getAEContext()
            .then(function(ctx) {
                return callClaudeAPI(fixMsg, ctx, apiKey, getModel(), [], callbacks);
            })
            .then(function(response) {
                removeLastSystemMessage();
                var code = extractCode(response);
                var displayText = response.replace(/```(?:javascript|jsx|extendscript)?\s*\n?[\s\S]*?```/g, '').trim();
                if (displayText) appendMessage('assistant', displayText);
                if (code) {
                    code = sanitizeCode(code);
                    lastGeneratedCode = code;
                    showCodePreview(code);
                    // Recursively retry execution
                    executeWithAutoRetry(code);
                } else {
                    appendMessage('error', 'Claude 未返回可执行代码，自动重试中止');
                    autoRetryAttempts = 0;
                }
            })
            .catch(function(err) {
                removeLastSystemMessage();
                appendMessage('error', '自动修复失败: ' + err.message);
                autoRetryAttempts = 0;
            });
    }

    function renderMessage(type, text) {
        var div = document.createElement('div');
        div.className = 'message ' + type;
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;
        div.appendChild(bubble);
        chatHistory.appendChild(div);
        scrollToBottom();
    }

    function appendMessage(type, text) {
        renderMessage(type, text);
        // Persist to chat log (skip transient status messages — those use appendStatus)
        logEntry({ type: type, text: text });
    }

    function appendErrorWithFixButton(errorText, failedCode, errorMsg, errorLine) {
        var div = document.createElement('div');
        div.className = 'message error';
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        var textDiv = document.createElement('div');
        textDiv.textContent = errorText;
        bubble.appendChild(textDiv);

        var fixBtn = document.createElement('button');
        fixBtn.className = 'fix-btn';
        fixBtn.textContent = '🔧 让 Claude 修复';
        fixBtn.addEventListener('click', function() {
            fixBtn.disabled = true;
            var fixPrompt = '上一段代码执行失败：\n错误: ' + errorMsg +
                (errorLine ? '\n位置: 行 ' + errorLine : '') +
                '\n\n失败的代码：\n```javascript\n' + failedCode + '\n```\n\n请分析错误原因并给出修复后的完整代码。';
            userInput.value = fixPrompt;
            handleSend();
        });
        bubble.appendChild(fixBtn);

        div.appendChild(bubble);
        chatHistory.appendChild(div);
        scrollToBottom();
    }

    function renderUserMessage(text, images) {
        var div = document.createElement('div');
        div.className = 'message user';
        var bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (images && images.length > 0) {
            for (var i = 0; i < images.length; i++) {
                var img = document.createElement('img');
                img.className = 'chat-image';
                img.src = images[i].dataUrl;
                bubble.appendChild(img);
            }
        }

        if (text) {
            var textNode = document.createElement('div');
            textNode.textContent = text;
            bubble.appendChild(textNode);
        }

        div.appendChild(bubble);
        chatHistory.appendChild(div);
        scrollToBottom();
    }

    function appendUserMessage(text, images) {
        renderUserMessage(text, images);
        // Persist (only keep dataUrl for image preview rendering, skip raw base64 to save space)
        var imgRefs = (images || []).map(function(img) {
            return { dataUrl: img.dataUrl, mediaType: img.mediaType };
        });
        logEntry({ type: 'user', text: text, images: imgRefs });
    }

    function appendWelcome() {
        chatHistory.innerHTML = '<div class="welcome">' +
            '<h3>Claude AI 助手</h3>' +
            '<p>在 After Effects 中用自然语言创建动画</p>' +
            '<p style="font-size: 11px; color: #555; margin-top: 8px;">请先点击右上角 ⚙ 设置 API 密钥</p>' +
            '<div class="presets">' +
            '<button class="preset-btn" data-prompt="创建一个文字飞入动画，从左侧滑入并带有弹性效果">文字飞入</button>' +
            '<button class="preset-btn" data-prompt="给选中图层添加弹性缩放动画，从0缩放到100%带回弹">弹性缩放</button>' +
            '<button class="preset-btn" data-prompt="创建一个圆形扩展转场效果">圆形转场</button>' +
            '<button class="preset-btn" data-prompt="给选中图层添加抖动效果和运动模糊">抖动效果</button>' +
            '<button class="preset-btn" data-prompt="创建一个彩色粒子爆炸效果">粒子爆炸</button>' +
            '<button class="preset-btn" data-prompt="创建一个数据柱状图增长动画">柱状图动画</button>' +
            '</div></div>';
    }

    // Status messages are transient progress indicators (".status" class).
    // Regular system messages (settings saved, queue notice) are permanent.
    function appendStatus(text) {
        var div = document.createElement('div');
        div.className = 'message system status';
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;
        div.appendChild(bubble);
        chatHistory.appendChild(div);
        scrollToBottom();
    }

    function updateLastSystemMessage(text) {
        var msgs = chatHistory.querySelectorAll('.message.system.status');
        if (msgs.length > 0) {
            msgs[msgs.length - 1].querySelector('.bubble').textContent = text;
        }
    }

    function removeLastSystemMessage() {
        var msgs = chatHistory.querySelectorAll('.message.system.status');
        if (msgs.length > 0) {
            msgs[msgs.length - 1].remove();
        }
    }

    function showCodePreview(code) {
        codeContent.textContent = code;
        codePreview.classList.remove('hidden');
    }

    function hideCodePreview() {
        codePreview.classList.add('hidden');
        lastGeneratedCode = null;
    }

    function scrollToBottom() {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function copyToClipboard(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    // Restore previous chat (if any) on panel open
    restoreChat();
})();
