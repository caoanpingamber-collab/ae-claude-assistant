// ae-context.jsx - ExtendScript bridge for Claude AE Assistant
// AE 2024+ ships native JSON via ExtendScript engine; if older AE without it,
// inline a minimal polyfill (does not handle every edge case but covers our usage).

if (typeof JSON === 'undefined') {
    var JSON = {};
    JSON.stringify = function (value) {
        var t = typeof value;
        if (t === 'string') {
            var s = '';
            for (var i = 0; i < value.length; i++) {
                var c = value.charCodeAt(i);
                var ch = value.charAt(i);
                if (ch === '"') s += '\\"';
                else if (ch === '\\') s += '\\\\';
                else if (c === 0x08) s += '\\b';
                else if (c === 0x09) s += '\\t';
                else if (c === 0x0a) s += '\\n';
                else if (c === 0x0c) s += '\\f';
                else if (c === 0x0d) s += '\\r';
                else if (c < 0x20) {
                    var hex = c.toString(16);
                    s += '\\u' + ('0000' + hex).slice(-4);
                } else s += ch;
            }
            return '"' + s + '"';
        }
        if (t === 'number') return isFinite(value) ? String(value) : 'null';
        if (t === 'boolean') return String(value);
        if (value === null || value === undefined) return 'null';
        if (value instanceof Array) {
            var arr = [];
            for (var k = 0; k < value.length; k++) arr.push(JSON.stringify(value[k]));
            return '[' + arr.join(',') + ']';
        }
        if (t === 'object') {
            var pairs = [];
            for (var key in value) {
                if (value.hasOwnProperty(key)) {
                    var v = JSON.stringify(value[key]);
                    if (v !== undefined) pairs.push(JSON.stringify(key) + ':' + v);
                }
            }
            return '{' + pairs.join(',') + '}';
        }
        return undefined;
    };
}

function getLayerType(layer) {
    try {
        if (layer instanceof TextLayer) return "text";
        if (layer instanceof ShapeLayer) return "shape";
        if (layer instanceof CameraLayer) return "camera";
        if (layer instanceof LightLayer) return "light";
        if (layer instanceof AVLayer) {
            if (layer.nullLayer) return "null";
            return "av";
        }
    } catch(e) {}
    return "unknown";
}

function safeGetValue(prop) {
    try {
        if (prop && prop.value !== undefined) {
            var v = prop.value;
            if (v instanceof Array) {
                var arr = [];
                for (var i = 0; i < v.length; i++) arr.push(v[i]);
                return arr;
            }
            return v;
        }
    } catch(e) {}
    return null;
}

function getAEContext() {
    try {
        var ctx = {};
        ctx.projectName = app.project.file ? app.project.file.name : "Untitled";

        var comp = app.project.activeItem;
        if (comp && comp instanceof CompItem) {
            ctx.activeComp = {
                name: comp.name,
                width: comp.width,
                height: comp.height,
                duration: comp.duration,
                frameRate: comp.frameRate,
                numLayers: comp.numLayers
            };

            ctx.selectedLayers = [];
            var sel = comp.selectedLayers;
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var info = {
                    index: layer.index,
                    name: layer.name,
                    type: getLayerType(layer),
                    inPoint: layer.inPoint,
                    outPoint: layer.outPoint
                };

                try {
                    info.position = safeGetValue(layer.property("Position"));
                    info.scale = safeGetValue(layer.property("Scale"));
                    info.rotation = safeGetValue(layer.property("Rotation"));
                    info.opacity = safeGetValue(layer.property("Opacity"));
                } catch(e2) {}

                info.effects = [];
                try {
                    if (layer.property("Effects")) {
                        for (var j = 1; j <= layer.property("Effects").numProperties; j++) {
                            info.effects.push(layer.property("Effects").property(j).name);
                        }
                    }
                } catch(e3) {}

                if (layer instanceof TextLayer) {
                    try {
                        var textProp = layer.property("Source Text");
                        if (textProp) {
                            var textDoc = textProp.value;
                            info.text = textDoc.text;
                            info.fontSize = textDoc.fontSize;
                            info.fontName = textDoc.font;
                        }
                    } catch(e4) {}
                }

                ctx.selectedLayers.push(info);
            }

            ctx.allLayers = [];
            for (var k = 1; k <= comp.numLayers; k++) {
                ctx.allLayers.push({
                    index: k,
                    name: comp.layer(k).name,
                    type: getLayerType(comp.layer(k))
                });
            }
        } else {
            ctx.activeComp = null;
            ctx.selectedLayers = [];
            ctx.allLayers = [];
        }

        return JSON.stringify(ctx);
    } catch(e) {
        return JSON.stringify({error: e.toString(), activeComp: null, selectedLayers: [], allLayers: []});
    }
}

function getSelectedLayerNames() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ comp: null, layers: [] });
        }
        var names = [];
        var sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) {
            names.push(sel[i].name);
        }
        return JSON.stringify({ comp: comp.name, layers: names });
    } catch(e) {
        return JSON.stringify({ comp: null, layers: [], error: e.toString() });
    }
}

// === Tool: deep introspection of a single layer ===
function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
}

function dumpProperty(prop, depth, maxDepth) {
    if (depth > maxDepth) return { _truncated: true };
    var info = {};
    try { info.name = prop.name; } catch(e) {}
    try { info.matchName = prop.matchName; } catch(e) {}
    try { info.propertyType = String(prop.propertyType); } catch(e) {}
    try {
        if (prop.numKeys && prop.numKeys > 0) {
            info.numKeys = prop.numKeys;
            info.keys = [];
            for (var k = 1; k <= Math.min(prop.numKeys, 5); k++) {
                info.keys.push({ time: prop.keyTime(k), value: prop.keyValue(k) });
            }
        }
    } catch(e) {}
    try { if (prop.expression) info.expression = prop.expression; } catch(e) {}
    try { if (prop.value !== undefined) info.value = prop.value; } catch(e) {}

    try {
        if (prop.numProperties && prop.numProperties > 0) {
            info.children = [];
            for (var j = 1; j <= prop.numProperties; j++) {
                info.children.push(dumpProperty(prop.property(j), depth + 1, maxDepth));
            }
        }
    } catch(e) {}
    return info;
}

function tool_query_layer(args) {
    try {
        var layerName = args.layer_name;
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return { error: "no active comp" };
        }
        var layer = findLayerByName(comp, layerName);
        if (!layer) return { error: "layer not found: " + layerName };

        var info = {
            name: layer.name,
            index: layer.index,
            type: getLayerType(layer),
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            startTime: layer.startTime,
            enabled: layer.enabled,
            transform: dumpProperty(layer.property("Transform"), 0, 3),
            effects: []
        };
        try {
            var fxRoot = layer.property("Effects");
            if (fxRoot) {
                for (var i = 1; i <= fxRoot.numProperties; i++) {
                    info.effects.push({
                        index: i,
                        name: fxRoot.property(i).name,
                        matchName: fxRoot.property(i).matchName
                    });
                }
            }
        } catch(e) {}

        if (layer instanceof TextLayer) {
            try {
                var td = layer.property("Source Text").value;
                info.text = { content: td.text, font: td.font, fontSize: td.fontSize };
            } catch(e) {}
        }

        if (layer instanceof ShapeLayer) {
            try {
                info.contents = dumpProperty(layer.property("Contents"), 0, 4);
            } catch(e) {}
        }

        return info;
    } catch(e) {
        return { error: e.toString() };
    }
}

function tool_query_effect(args) {
    try {
        var layerName = args.layer_name;
        var idx = args.effect_index;
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return { error: "no active comp" };
        var layer = findLayerByName(comp, layerName);
        if (!layer) return { error: "layer not found: " + layerName };
        var fxRoot = layer.property("Effects");
        if (!fxRoot || idx < 1 || idx > fxRoot.numProperties) {
            return { error: "effect index out of range" };
        }
        var fx = fxRoot.property(idx);
        return {
            name: fx.name,
            matchName: fx.matchName,
            properties: dumpProperty(fx, 0, 3)
        };
    } catch(e) {
        return { error: e.toString() };
    }
}

function tool_list_all_layers(args) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return { error: "no active comp" };
        var list = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            var entry = { index: i, name: L.name, type: getLayerType(L) };
            try {
                var fxRoot = L.property("Effects");
                if (fxRoot && fxRoot.numProperties > 0) {
                    entry.effectCount = fxRoot.numProperties;
                }
            } catch(e) {}
            list.push(entry);
        }
        return { comp: comp.name, layers: list };
    } catch(e) {
        return { error: e.toString() };
    }
}

// === Tool: render current comp frame to PNG, return base64 inline ===
// We read the PNG bytes and base64-encode in ExtendScript to avoid
// cross-process filesystem reads that can fail with ENOENT.
function _b64encode(bin) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var len = bin.length;
    for (var i = 0; i < len; i += 3) {
        var b1 = bin.charCodeAt(i) & 0xff;
        var b2 = (i + 1 < len) ? (bin.charCodeAt(i + 1) & 0xff) : 0;
        var b3 = (i + 2 < len) ? (bin.charCodeAt(i + 2) & 0xff) : 0;
        var t = (b1 << 16) | (b2 << 8) | b3;
        out += chars.charAt((t >> 18) & 0x3f);
        out += chars.charAt((t >> 12) & 0x3f);
        out += (i + 1 < len) ? chars.charAt((t >> 6) & 0x3f) : '=';
        out += (i + 2 < len) ? chars.charAt(t & 0x3f) : '=';
    }
    return out;
}

function tool_screenshot_comp(args) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return { error: "no active comp" };
        }
        var time = (args && typeof args.time === 'number') ? args.time : comp.time;

        // Use system temp dir (no spaces, more reliable than userData on macOS)
        var tmpFolder = new Folder(Folder.temp.fullName + "/ClaudeAEAssistant");
        if (!tmpFolder.exists) {
            try { tmpFolder.create(); } catch(e1) {}
        }

        var filePath = tmpFolder.fullName + "/ae-shot-" + (new Date().getTime()) + ".png";
        var file = new File(filePath);

        var savedFile;
        try {
            savedFile = comp.saveFrameToPng(time, file);
        } catch(eSave) {
            return { error: "saveFrameToPng 失败: " + eSave.toString() };
        }

        // saveFrameToPng might return the actual File written (canonical path)
        var actualFile = (savedFile && savedFile instanceof File) ? savedFile : file;
        if (!actualFile.exists) {
            return { error: "PNG 文件未生成: " + actualFile.fsName };
        }

        // Read as binary
        actualFile.encoding = "BINARY";
        if (!actualFile.open("r")) {
            return { error: "PNG 文件无法打开读取" };
        }
        var bin = actualFile.read();
        actualFile.close();

        // Cleanup temp file
        try { actualFile.remove(); } catch(eRm) {}

        var base64 = _b64encode(bin);

        return {
            success: true,
            base64: base64,
            mediaType: "image/png",
            time: time,
            comp: comp.name,
            width: comp.width,
            height: comp.height
        };
    } catch(e) {
        return { error: e.toString() };
    }
}

function dispatchTool(toolName, argsJson) {
    var args = {};
    try { args = JSON.parse(argsJson); } catch(e) {}
    var result;
    if (toolName === 'query_layer') result = tool_query_layer(args);
    else if (toolName === 'query_effect') result = tool_query_effect(args);
    else if (toolName === 'list_all_layers') result = tool_list_all_layers(args);
    else result = { error: "unknown tool: " + toolName };
    return JSON.stringify(result);
}

function undoLastAction() {
    // Try multiple menu names for different language versions
    var menuNames = ["Undo", "撤消", "撤销", "Annuler", "Rueckgaengig", "Deshacer", "Annulla"];
    for (var i = 0; i < menuNames.length; i++) {
        try {
            var id = app.findMenuCommandId(menuNames[i]);
            if (id && id > 0) {
                app.executeCommand(id);
                return JSON.stringify({ success: true, method: menuNames[i] });
            }
        } catch(e) {}
    }
    // Fallback: try hardcoded undo command ID (16 is standard for AE)
    try {
        app.executeCommand(16);
        return JSON.stringify({ success: true, method: "fallback-id-16" });
    } catch(e2) {
        return JSON.stringify({ success: false, error: "no undo command found" });
    }
}

function executeGeneratedCode(filePath) {
    try {
        var f = new File(filePath);
        if (!f.exists) {
            return JSON.stringify({ success: false, error: "Script file not found: " + filePath });
        }
        f.open("r");
        f.encoding = "UTF-8";
        var code = f.read();
        f.close();

        app.beginUndoGroup("Claude AI Script");
        var result = eval(code);
        app.endUndoGroup();
        return JSON.stringify({ success: true, result: String(result || "OK") });
    } catch(e) {
        try { app.endUndoGroup(); } catch(e2) {}
        return JSON.stringify({ success: false, error: e.toString(), line: e.line });
    }
}
