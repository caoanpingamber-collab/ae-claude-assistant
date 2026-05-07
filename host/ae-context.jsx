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
