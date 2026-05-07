// claude-api.js - Claude API integration with tool use, extended thinking, auto-retry

var SYSTEM_PROMPT = [
    '你是一位资深的 Adobe After Effects 动效工程师，在 AE 扩展面板中工作。你的任务是把用户的自然语言需求精确转换为可直接执行的 ExtendScript 代码。',
    '',
    '【工作流程 - 必须遵守】',
    '在写代码前，先用工具了解 AE 当前真实状态。简单任务可以直接写；复杂任务（特定图层、复杂效果、多图层联动）必须先调用工具：',
    '1. 不确定图层结构 → 调用 query_layer 看完整属性树（位置/缩放/关键帧/效果列表/Contents 嵌套）',
    '2. 要修改某个效果 → 调用 query_effect 拿到该效果的所有子属性名（确保 setValue 用对名字）',
    '3. 要操作所有图层 → 调用 list_all_layers 获取列表',
    '禁止盲写。看到错误后，先用工具调查，再改代码。',
    '',
    '【ES3 语法约束】',
    '- 用 var 声明，function 定义函数；禁用 let/const/箭头函数/模板字符串/解构/Array.forEach/map/filter',
    '- 数组方法只有：push/pop/shift/unshift/splice/slice/concat/join/length',
    '- 字符串拼接用 +，没有模板字符串',
    '',
    '【关键 API】',
    '- comp = app.project.activeItem (检查 instanceof CompItem)',
    '- comp.layers.addText(str) / addShape() / addSolid([r,g,b], name, w, h, ratio) / addNull()',
    '- layer.property("Position").setValueAtTime(t, [x,y]) — 关键帧',
    '- layer.property("Effects").addProperty(matchName) — 必须用 matchName 不是 displayName',
    '- new KeyframeEase(speed, influence) + setTemporalEaseAtKey(idx, [in, out])',
    '- 设值: prop.setValue(v); 设关键帧: prop.setValueAtTime(t, v)',
    '',
    '【常用 matchName 速查】',
    '形状层组件:',
    '- ADBE Vector Group / ADBE Vector Shape - Rect / ADBE Vector Shape - Ellipse / ADBE Vector Shape - Star / ADBE Vector Shape - Group',
    '- ADBE Vector Graphic - Fill / ADBE Vector Graphic - Stroke / ADBE Vector Filter - Trim',
    '效果:',
    '- ADBE Gaussian Blur 2 / ADBE Drop Shadow / ADBE Glo2 / ADBE Camera Lens Blur',
    '- ADBE Wave Warp (有 Pinning 1=None,2=All,3=Top,4=Right,5=Bottom,6=Left,7=Top&Bottom,8=Left&Right)',
    '- ADBE Turbulent Displace / ADBE Fractal Noise / ADBE Set Matte3 / ADBE Linear Wipe / ADBE Radial Wipe',
    '- ADBE Hue Saturation / ADBE Curves2 / ADBE Tint / ADBE Levels2',
    '- ADBE CC RepeTile / ADBE Echo / ADBE Posterize / ADBE Slider Control / ADBE Point Control / ADBE Color Control',
    '',
    '【铁律：防御性编程】',
    '违反这些会导致 "TypeError: null 不是对象"：',
    '1. addProperty() / property() 可能返回 null，赋值前必须 if (!x) 检查',
    '2. comp.selectedLayers 可能为空，length 检查',
    '3. 用属性英文名（"Position" "Scale" "Opacity" "Rotation" "Anchor Point"），不要用本地化',
    '4. 操作每个图层用 try-catch 包裹，单图层失败不影响整体',
    '5. 读 textDocument 后修改属性（fontSize, text, font），必须重新 setValue 整个 textDocument',
    '6. 形状层是 ADBE Vector Group → Contents → ADBE Vector Shape - X，三层嵌套',
    '',
    '【输出格式 - 严格】',
    '- 在代码块外面写中文说明（2-3 行）',
    '- 代码块（```javascript ... ```）里只能是纯可执行的 JavaScript',
    '- 严禁在代码块里夹杂以下内容（会导致 SyntaxError 行 1）：',
    '  * "key": value 形式的 JSON 片段或键值标注',
    '  * ← → 箭头注释或中文说明文字（要写注释只能用 // 或 /* */，且必须是合法 JS 注释）',
    '  * Markdown 列表（- *）、标题（#）',
    '  * "注:" "提示:" "说明:" 等中文标注（即使加了 // 也容易出错，最好放代码块外）',
    '- 代码自包含、可直接执行',
    '- 头两行: var comp = app.project.activeItem; if (!(comp instanceof CompItem)) { alert("请先打开合成"); return; }',
    '- 主逻辑用 try-catch 包裹，失败给出具体中文错误（不要用 "出错了" 这种泛泛提示）',
    '- 系统会自动 beginUndoGroup/endUndoGroup，你不需要写',
    '',
    '【收到执行错误时】',
    '收到 "上一段代码执行失败：..." 类的提示时，先用 query_layer / query_effect 调查实际状态（属性是否存在、effect 是否真添加成功），再改代码。不要重复犯同样的错误。'
].join('\n');

// Tools that Claude can call to introspect AE state
var TOOLS = [
    {
        name: 'query_layer',
        description: '获取指定图层的完整属性树，包括 Transform 所有子属性、关键帧（最多5个）、表达式、效果列表、形状层 Contents 嵌套结构、文字层文本属性。在写涉及该图层的代码前调用此工具，避免假设属性结构。',
        input_schema: {
            type: 'object',
            properties: {
                layer_name: { type: 'string', description: '图层名称（精确匹配）' }
            },
            required: ['layer_name']
        }
    },
    {
        name: 'query_effect',
        description: '获取图层上某个效果的完整属性树（包含所有可设置的子属性名和当前值）。在调用 fx.property("xxx").setValue 前先用此工具确认 "xxx" 是有效属性名。',
        input_schema: {
            type: 'object',
            properties: {
                layer_name: { type: 'string' },
                effect_index: { type: 'number', description: '效果索引（从 1 开始）' }
            },
            required: ['layer_name', 'effect_index']
        }
    },
    {
        name: 'list_all_layers',
        description: '列出当前合成所有图层（名称、类型、效果数量）。当上下文中没有该图层信息或想发现潜在目标图层时使用。',
        input_schema: {
            type: 'object',
            properties: {}
        }
    }
];

var conversationMessages = [];
var currentAbortController = null;

function restoreConversationMessages(saved) {
    if (saved && saved instanceof Array) conversationMessages = saved;
}

function persistConversationMessages() {
    if (typeof setConversationMessages === 'function') {
        setConversationMessages(conversationMessages);
    }
}

function abortCurrentRequest() {
    if (currentAbortController) {
        try { currentAbortController.abort(); } catch(e) {}
        currentAbortController = null;
    }
    if (conversationMessages.length > 0 &&
        conversationMessages[conversationMessages.length - 1].role === 'user') {
        conversationMessages.pop();
    }
}

function resetConversation() {
    conversationMessages = [];
    persistConversationMessages();
}

// One-shot API call (no history, no tools, no streaming) — for video summarization
function callClaudeOneShot(textPrompt, images, apiKey, model) {
    var blocks = [];
    if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: images[i].mediaType,
                    data: images[i].data
                }
            });
        }
    }
    blocks.push({ type: 'text', text: textPrompt });

    var endpoint = getApiEndpoint();
    return fetch(endpoint + '/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: model || 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: blocks }]
        })
    })
    .then(function(r) {
        if (!r.ok) return r.json().then(function(e) {
            throw new Error('API ' + r.status + ': ' + (e.error ? e.error.message : '?'));
        });
        return r.json();
    })
    .then(function(d) { return d.content[0].text; });
}

// Main API call: routes to Anthropic or OpenAI-compatible based on provider setting.
function callClaudeAPI(userMessage, aeContext, apiKey, model, images, callbacks) {
    callbacks = callbacks || {};
    var status = callbacks.onStatus || function() {};
    var safeUserMessage = (userMessage && userMessage.trim()) ? userMessage : '(请参考附图)';

    // Persistent history: text-only summary
    conversationMessages.push({ role: 'user', content: safeUserMessage });
    if (conversationMessages.length > 10) conversationMessages = conversationMessages.slice(-10);
    conversationMessages = conversationMessages.filter(function(m) {
        if (typeof m.content === 'string') return m.content.trim().length > 0;
        if (m.content instanceof Array) return m.content.length > 0;
        return false;
    });

    currentAbortController = new AbortController();
    var provider = (typeof getProvider === 'function') ? getProvider() : 'anthropic';

    var promise = (provider === 'openai')
        ? runOpenAIToolLoop(conversationMessages, aeContext, safeUserMessage, images, apiKey, model, status, callbacks)
        : runAnthropicToolLoop(conversationMessages, aeContext, safeUserMessage, images, apiKey, model, status, callbacks);

    return promise.then(function(finalText) {
        currentAbortController = null;
        conversationMessages.push({ role: 'assistant', content: finalText });
        persistConversationMessages();
        if (callbacks.onComplete) callbacks.onComplete(finalText);
        return finalText;
    });
}

function runAnthropicToolLoop(history, aeContext, userMessage, images, apiKey, model, status, callbacks) {
    var initialContent = [];
    if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
            initialContent.push({
                type: 'image',
                source: { type: 'base64', media_type: images[i].mediaType, data: images[i].data }
            });
        }
    }
    var contextStr = '[当前 AE 项目状态]\n' + JSON.stringify(aeContext, null, 2);
    initialContent.push({ type: 'text', text: contextStr + '\n\n[用户请求]\n' + userMessage });

    var requestMessages = history.slice(0, -1);
    requestMessages.push({ role: 'user', content: initialContent });

    return runToolLoop(requestMessages, apiKey, model, status, callbacks);
}

function runToolLoop(requestMessages, apiKey, model, status, callbacks) {
    var endpoint = getApiEndpoint();
    var iteration = 0;
    var MAX_ITERATIONS = 8;

    function iterate() {
        if (iteration >= MAX_ITERATIONS) {
            throw new Error('达到最大工具调用次数 (' + MAX_ITERATIONS + ')，已停止');
        }
        iteration++;
        status('Claude 正在思考' + (iteration > 1 ? ' (轮次 ' + iteration + ')' : '') + '...');

        var body = {
            model: model || 'claude-opus-4-7',
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: requestMessages,
            tools: TOOLS
        };
        // Extended thinking for Opus / Sonnet 4.x
        if (/opus-4|sonnet-4/.test(body.model)) {
            body.thinking = { type: 'enabled', budget_tokens: 4096 };
        }

        return fetch(endpoint + '/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(body),
            signal: currentAbortController.signal
        })
        .then(function(r) {
            if (!r.ok) return r.json().then(function(e) {
                throw new Error('API ' + r.status + ': ' + (e.error ? e.error.message : '未知'));
            });
            return r.json();
        })
        .then(function(data) {
            // Save assistant message (with all blocks: thinking + tool_use + text)
            requestMessages.push({ role: 'assistant', content: data.content });

            if (data.stop_reason === 'tool_use') {
                // Find all tool_use blocks; execute them; build user message with tool_results
                var toolUseBlocks = data.content.filter(function(b) { return b.type === 'tool_use'; });
                var toolResultsContent = [];
                var promiseChain = Promise.resolve();

                toolUseBlocks.forEach(function(tu) {
                    promiseChain = promiseChain.then(function() {
                        status('Claude 调用工具：' + tu.name + ' (' + JSON.stringify(tu.input) + ')');
                        return callTool(tu.name, tu.input).then(function(result) {
                            if (callbacks.onToolCall) {
                                callbacks.onToolCall({ name: tu.name, args: tu.input, result: result });
                            }
                            toolResultsContent.push({
                                type: 'tool_result',
                                tool_use_id: tu.id,
                                content: JSON.stringify(result)
                            });
                        });
                    });
                });

                return promiseChain.then(function() {
                    requestMessages.push({ role: 'user', content: toolResultsContent });
                    return iterate();
                });
            } else {
                // end_turn or other: extract text from content blocks
                var text = '';
                for (var i = 0; i < data.content.length; i++) {
                    if (data.content[i].type === 'text') {
                        text += data.content[i].text;
                    }
                }
                return text;
            }
        });
    }

    return iterate();
}

// === OpenAI-compatible (chat completions) tool loop ===
// Works with OpenAI API, Codex CLI server, LM Studio, vLLM, Ollama with openai compat,
// and any third-party OpenAI-format gateway.

function openaiTools() {
    return TOOLS.map(function(t) {
        return {
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema
            }
        };
    });
}

function runOpenAIToolLoop(history, aeContext, userMessage, images, apiKey, model, status, callbacks) {
    var endpoint = getApiEndpoint();
    var iteration = 0;
    var MAX_ITERATIONS = 8;

    // Build initial messages: system + history (user/assistant text-only) + this turn (images + context + user)
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
    var historyMinusLast = history.slice(0, -1);
    for (var h = 0; h < historyMinusLast.length; h++) {
        msgs.push({
            role: historyMinusLast[h].role,
            content: typeof historyMinusLast[h].content === 'string'
                ? historyMinusLast[h].content
                : '(已省略历史多模态内容)'
        });
    }
    var thisTurn = [];
    if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
            thisTurn.push({
                type: 'image_url',
                image_url: { url: 'data:' + images[i].mediaType + ';base64,' + images[i].data }
            });
        }
    }
    var contextStr = '[当前 AE 项目状态]\n' + JSON.stringify(aeContext, null, 2);
    thisTurn.push({ type: 'text', text: contextStr + '\n\n[用户请求]\n' + userMessage });
    msgs.push({ role: 'user', content: thisTurn });

    function iterate() {
        if (iteration >= MAX_ITERATIONS) {
            throw new Error('达到最大工具调用次数 (' + MAX_ITERATIONS + ')，已停止');
        }
        iteration++;
        status('AI 正在思考' + (iteration > 1 ? ' (轮次 ' + iteration + ')' : '') + '...');

        var body = {
            model: model || 'gpt-5',
            messages: msgs,
            tools: openaiTools(),
            tool_choice: 'auto'
        };

        return fetch(endpoint + '/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body),
            signal: currentAbortController.signal
        })
        .then(function(r) {
            if (!r.ok) return r.json().then(function(e) {
                throw new Error('API ' + r.status + ': ' + (e.error ? e.error.message : '未知'));
            });
            return r.json();
        })
        .then(function(data) {
            var msg = data.choices[0].message;
            // Echo assistant message back into context
            msgs.push(msg);

            if (msg.tool_calls && msg.tool_calls.length > 0) {
                var chain = Promise.resolve();
                msg.tool_calls.forEach(function(tc) {
                    chain = chain.then(function() {
                        var args = {};
                        try { args = JSON.parse(tc.function.arguments); } catch(e) {}
                        status('AI 调用工具：' + tc.function.name + ' ' + tc.function.arguments);
                        return callTool(tc.function.name, args).then(function(result) {
                            if (callbacks.onToolCall) {
                                callbacks.onToolCall({ name: tc.function.name, args: args, result: result });
                            }
                            msgs.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify(result)
                            });
                        });
                    });
                });
                return chain.then(iterate);
            } else {
                return msg.content || '';
            }
        });
    }

    return iterate();
}

function extractCode(responseText) {
    var matches = [];
    var re = /```(?:javascript|jsx|extendscript)?\s*\n?([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(responseText)) !== null) {
        matches.push(m[1].trim());
    }
    if (matches.length === 0) return null;

    // Score each block by "JS-ness": penalize blocks that look like JSON/annotations
    function scoreJS(code) {
        if (!code) return -100;
        var firstLine = (code.split('\n')[0] || '').trim();
        var score = 0;
        // Strong negative: starts with annotation arrow, JSON pair, markdown bullet
        if (/^["'][^"']+["']\s*:/.test(firstLine)) score -= 50; // "key": value
        if (/[←→]/.test(firstLine)) score -= 50;                // arrow annotation
        if (/^[*#-]/.test(firstLine)) score -= 30;              // markdown
        // Strong positive: valid JS starters
        if (/^(var |function |if |for |while |\(function|app\.|comp\.|layer\.|\/\/|\/\*)/.test(firstLine)) score += 50;
        if (code.indexOf('app.project') !== -1) score += 30;
        if (code.indexOf('var ') !== -1) score += 20;
        if (code.length > 100) score += 10;
        return score;
    }

    // Pick the highest-scoring block; if multiple are JS-good, concat them
    var scored = matches.map(function(c) { return { code: c, score: scoreJS(c) }; });
    scored.sort(function(a, b) { return b.score - a.score; });

    if (scored.length === 1) return scored[0].score >= 0 ? scored[0].code : null;

    // Take all blocks scoring >= 0 (legitimate JS), concatenate in original order
    var goodBlocks = matches.filter(function(c) { return scoreJS(c) >= 0; });
    if (goodBlocks.length === 0) return null;
    return goodBlocks.join('\n\n');
}

// Sanitize code defensively: strip leading non-JS lines (annotations, JSON snippets)
function sanitizeCode(code) {
    if (!code) return code;
    var lines = code.split('\n');
    var firstJSIdx = 0;
    for (var i = 0; i < lines.length; i++) {
        var ln = lines[i].trim();
        if (!ln) continue;
        // Skip lines that don't look like JS
        if (/^["'][^"']+["']\s*:/.test(ln)) continue;          // "key": value
        if (/[←→]/.test(ln)) continue;                          // arrows
        if (/^[*#-]\s/.test(ln)) continue;                      // markdown
        if (/^(注[:：]|提示|说明|备注)/.test(ln)) continue;     // Chinese annotations
        firstJSIdx = i;
        break;
    }
    return lines.slice(firstJSIdx).join('\n');
}
