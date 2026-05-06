// main.js - Claude AE Assistant main logic

(function() {
    var lastGeneratedCode = null;
    var isProcessing = false;
    var pendingImages = []; // {data: base64, mediaType: 'image/png', dataUrl: 'data:...'}

    var chatHistory = document.getElementById('chat-history');
    var userInput = document.getElementById('user-input');
    var sendBtn = document.getElementById('send-btn');
    var settingsBtn = document.getElementById('settings-btn');
    var settingsPanel = document.getElementById('settings-panel');
    var apiEndpointInput = document.getElementById('api-endpoint-input');
    var apiKeyInput = document.getElementById('api-key-input');
    var modelSelect = document.getElementById('model-select');
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
    apiEndpointInput.value = getApiEndpoint();
    apiKeyInput.value = getApiKey();
    modelSelect.value = getModel();

    // Auto-resize textarea
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

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
    }

    function showMentionDropdown(layers, filter) {
        var dd = getDropdown();
        var filtered = filter ? layers.filter(function(l) {
            return l.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
        }) : layers.slice();

        if (filtered.length === 0) {
            hideMentionDropdown();
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

    function fetchAndShowMentions(filter) {
        getSelectedLayers().then(function(sel) {
            // Get all layers via context for the full list
            return getAEContext().then(function(ctx) {
                var layers = (ctx.allLayers || []).map(function(l) {
                    return { name: l.name, type: l.type };
                });
                showMentionDropdown(layers, filter);
            });
        }).catch(function() {});
    }

    userInput.addEventListener('input', function(e) {
        var val = userInput.value;
        var caret = userInput.selectionStart;

        // Detect @ trigger
        if (mentionStartPos === -1) {
            // Check if the char just typed was @
            if (caret > 0 && val.charAt(caret - 1) === '@') {
                // Make sure @ is at start or preceded by whitespace
                if (caret === 1 || /\s/.test(val.charAt(caret - 2))) {
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
        setApiEndpoint(apiEndpointInput.value.trim());
        setApiKey(apiKeyInput.value.trim());
        setModel(modelSelect.value);
        settingsPanel.classList.add('hidden');
        appendMessage('system', '设置已保存 (' + getApiEndpoint() + ')');
    });

    // Clear conversation
    clearBtn.addEventListener('click', function() {
        chatHistory.innerHTML = '';
        resetConversation();
        clearConversationHistory();
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

    // Send message
    sendBtn.addEventListener('click', handleSend);
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

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

    // Paste image from clipboard
    userInput.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                addImageFile(items[i].getAsFile());
            }
        }
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
            if (files[i].type.indexOf('image') !== -1) {
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
        if (!file || file.type.indexOf('image') === -1) return;

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

    function renderImagePreviews() {
        imageThumbnails.innerHTML = '';
        if (pendingImages.length === 0) {
            imagePreviewBar.classList.add('hidden');
            return;
        }
        imagePreviewBar.classList.remove('hidden');

        for (var i = 0; i < pendingImages.length; i++) {
            (function(idx) {
                var thumb = document.createElement('div');
                thumb.className = 'img-thumb';
                var img = document.createElement('img');
                img.src = pendingImages[idx].dataUrl;
                thumb.appendChild(img);

                var removeBtn = document.createElement('button');
                removeBtn.className = 'remove-img';
                removeBtn.title = '移除';
                removeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
                removeBtn.addEventListener('click', function() {
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

        var imagesToSend = pendingImages.slice();
        userInput.value = '';
        userInput.style.height = 'auto';
        clearPendingImages();

        // Queue the message
        messageQueue.push({ message: message, images: imagesToSend });

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
        hideCodePreview();
        appendMessage('system', '正在获取 AE 项目信息...');

        getAEContext()
            .then(function(context) {
                updateLastSystemMessage('正在请求 Claude 生成代码...');
                return callClaudeAPI(combinedMessage, context, apiKey, getModel(), combinedImages);
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
                }
            });
    }

    function handleExecute() {
        if (!lastGeneratedCode) return;

        var codeBeingExecuted = lastGeneratedCode;
        executeBtn.disabled = true;
        appendMessage('system', '正在执行代码...');

        executeInAE(lastGeneratedCode)
            .then(function(result) {
                removeLastSystemMessage();
                if (result.success) {
                    appendMessage('system', '执行成功' + (result.result !== 'OK' ? ': ' + result.result : ''));
                } else {
                    appendErrorWithFixButton(
                        '执行失败: ' + result.error + (result.line ? ' (行 ' + result.line + ')' : ''),
                        codeBeingExecuted,
                        result.error,
                        result.line
                    );
                }
            })
            .catch(function(err) {
                removeLastSystemMessage();
                appendMessage('error', '执行出错: ' + err.message);
            })
            .then(function() {
                executeBtn.disabled = false;
                hideCodePreview();
            });
    }

    function appendMessage(type, text) {
        var div = document.createElement('div');
        div.className = 'message ' + type;
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;
        div.appendChild(bubble);
        chatHistory.appendChild(div);
        scrollToBottom();
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

    function appendUserMessage(text, images) {
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

    function updateLastSystemMessage(text) {
        var msgs = chatHistory.querySelectorAll('.message.system');
        if (msgs.length > 0) {
            msgs[msgs.length - 1].querySelector('.bubble').textContent = text;
        }
    }

    function removeLastSystemMessage() {
        var msgs = chatHistory.querySelectorAll('.message.system');
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
})();
