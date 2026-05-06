// claude-api.js - Claude API integration for AE Assistant

var SYSTEM_PROMPT = '你是一个 Adobe After Effects ExtendScript 专家助手，在 AE 扩展面板中运行。\n\n' +
'核心规则：\n' +
'1. 只输出可直接在 AE 中执行的 ExtendScript 代码\n' +
'2. 代码必须是 ECMAScript 3 语法（ExtendScript 基于 ES3）\n' +
'3. 不要使用 let/const/箭头函数/模板字符串/解构等 ES6+ 语法\n' +
'4. 使用 var 声明变量\n' +
'5. 使用 function 关键字定义函数\n' +
'6. 数组方法仅限 push/pop/shift/unshift/splice/slice/concat/join\n' +
'7. 用 for 循环代替 forEach/map/filter\n' +
'8. 字符串拼接用 + 运算符\n\n' +
'AE ExtendScript 关键 API：\n' +
'- app.project.activeItem 获取当前合成（CompItem）\n' +
'- comp.layers.addText("文字") 添加文字图层\n' +
'- comp.layers.addShape() 添加形状图层\n' +
'- comp.layers.addSolid([r,g,b], "name", w, h, ratio) 添加纯色图层\n' +
'- comp.layers.addNull() 添加空对象\n' +
'- layer.property("Position").setValueAtTime(time, [x,y]) 设置关键帧\n' +
'- layer.property("Scale").setValueAtTime(time, [x,y])\n' +
'- layer.property("Opacity").setValueAtTime(time, value)\n' +
'- layer.property("Rotation").setValueAtTime(time, value)\n' +
'- layer.property("Anchor Point").setValueAtTime(time, [x,y])\n\n' +
'关键帧缓动：\n' +
'- var ease = new KeyframeEase(0, 75);\n' +
'- layer.property("Position").setTemporalEaseAtKey(keyIndex, [ease, ease]);\n' +
'- KeyframeInterpolationType.LINEAR / BEZIER / HOLD\n\n' +
'形状图层操作：\n' +
'- var shapeGroup = layer.property("Contents").addProperty("ADBE Vector Group");\n' +
'- shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Rect");\n' +
'- shapeGroup.property("Contents").addProperty("ADBE Vector Shape - Ellipse");\n' +
'- shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Fill");\n' +
'- shapeGroup.property("Contents").addProperty("ADBE Vector Graphic - Stroke");\n\n' +
'常用效果 matchName（必须用 matchName 不要用 displayName）：\n' +
'- ADBE Gaussian Blur 2 高斯模糊\n' +
'- ADBE Drop Shadow 投影\n' +
'- ADBE Glo2 发光\n' +
'- ADBE Wave Warp 波形变形（火焰、旗帜常用，有 Pinning 属性可固定一边）\n' +
'- ADBE Turbulent Displace 湍流置换\n' +
'- ADBE Fractal Noise 分形杂色\n' +
'- ADBE Set Matte3 设置遮罩\n' +
'- ADBE Linear Wipe 线性擦除\n\n' +
'设置效果属性：\n' +
'- var fx = layer.property("Effects").addProperty("ADBE Wave Warp");\n' +
'- fx.property("Wave Height").setValue(20);\n' +
'- fx.property("Wave Width").setValue(50);\n' +
'- fx.property("Pinning").setValue(2); // 1=None,2=All,3=TopEdge,4=RightEdge,5=BottomEdge,6=LeftEdge,7=Top&Bottom,8=Left&Right\n\n' +
'表达式：\n' +
'- layer.property("Position").expression = "wiggle(5, 20)";\n\n' +
'⚠️ 防御性编程（极其重要，违反会导致 null 错误）：\n' +
'1. addProperty() 在 matchName 错误时返回 null，必须检查：\n' +
'   var fx = layer.property("Effects").addProperty("ADBE Wave Warp");\n' +
'   if (!fx) { alert("效果添加失败"); return; }\n' +
'2. layer.property() 在属性名错误时也可能返回 null，访问前检查\n' +
'3. comp.selectedLayers 可能为空数组，使用前检查 length\n' +
'4. 优先使用属性的英文名（如 "Position"），不要用本地化名称\n' +
'5. 添加效果属性后，访问子属性也要检查：\n' +
'   var prop = fx.property("Wave Height");\n' +
'   if (prop) prop.setValue(20);\n' +
'6. 用 try-catch 包裹整段操作每个图层的逻辑，避免一个图层失败导致整个脚本崩溃\n' +
'7. 操作前确保有图层：if (comp.selectedLayers.length === 0) { alert("请先选中图层"); return; }\n\n' +
'输出格式：\n' +
'- 将代码放在 ```javascript 代码块中\n' +
'- 在代码前用中文简要说明将要执行的操作\n' +
'- 代码应该是自包含的，不依赖外部变量\n' +
'- 代码开头获取 comp: var comp = app.project.activeItem;\n' +
'- 检查 comp 是否存在: if (!(comp instanceof CompItem)) { alert("请先选择一个合成"); return; }\n' +
'- 用 try-catch 包裹关键操作，错误时给出明确的中文提示\n' +
'- 不需要包含 app.beginUndoGroup / app.endUndoGroup，系统会自动包裹\n\n' +
'当前 AE 项目上下文信息会在每次请求中提供，请根据上下文生成代码。';

var conversationMessages = [];
var currentAbortController = null;

function abortCurrentRequest() {
    if (currentAbortController) {
        try { currentAbortController.abort(); } catch(e) {}
        currentAbortController = null;
    }
    // Remove the last user message that was added but not completed
    if (conversationMessages.length > 0 &&
        conversationMessages[conversationMessages.length - 1].role === 'user') {
        conversationMessages.pop();
    }
}

function callClaudeAPI(userMessage, aeContext, apiKey, model, images) {
    var contextStr = '当前 AE 项目状态：\n' + JSON.stringify(aeContext, null, 2);
    var fullText = contextStr + '\n\n用户请求：' + userMessage;

    var contentBlocks = [];

    if (images && images.length > 0) {
        for (var i = 0; i < images.length; i++) {
            contentBlocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: images[i].mediaType,
                    data: images[i].data
                }
            });
        }
    }

    contentBlocks.push({ type: 'text', text: fullText });

    conversationMessages.push({ role: 'user', content: contentBlocks });

    // Keep last 10 messages to avoid token limit
    if (conversationMessages.length > 10) {
        conversationMessages = conversationMessages.slice(-10);
    }

    var endpoint = getApiEndpoint();
    currentAbortController = new AbortController();
    return fetch(endpoint + '/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: model || 'claude-opus-4-7',
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: conversationMessages
        }),
        signal: currentAbortController.signal
    })
    .then(function(response) {
        if (!response.ok) {
            return response.json().then(function(err) {
                throw new Error('API 错误 (' + response.status + '): ' + (err.error ? err.error.message : '未知错误'));
            });
        }
        return response.json();
    })
    .then(function(data) {
        currentAbortController = null;
        var text = data.content[0].text;
        conversationMessages.push({ role: 'assistant', content: text });
        return text;
    });
}

function extractCode(responseText) {
    var patterns = [
        /```(?:javascript|jsx|extendscript)\s*\n([\s\S]*?)```/,
        /```\s*\n([\s\S]*?)```/
    ];
    for (var i = 0; i < patterns.length; i++) {
        var match = responseText.match(patterns[i]);
        if (match) return match[1].trim();
    }
    return null;
}

function resetConversation() {
    conversationMessages = [];
}
