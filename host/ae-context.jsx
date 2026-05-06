// ae-context.jsx - ExtendScript bridge for Claude AE Assistant

// Inline JSON polyfill (ExtendScript is ES3, no native JSON)
if (typeof JSON === 'undefined') {
    var JSON = {};
}
(function () {
    if (typeof JSON.stringify !== 'function') {
        JSON.stringify = function (value) {
            var type = typeof value;
            if (type === 'string') {
                return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
            }
            if (type === 'number' || type === 'boolean') {
                return String(value);
            }
            if (value === null || value === undefined) {
                return 'null';
            }
            if (value instanceof Array) {
                var arrParts = [];
                for (var i = 0; i < value.length; i++) {
                    arrParts.push(JSON.stringify(value[i]));
                }
                return '[' + arrParts.join(',') + ']';
            }
            if (type === 'object') {
                var objParts = [];
                for (var k in value) {
                    if (value.hasOwnProperty(k)) {
                        var v = JSON.stringify(value[k]);
                        if (v !== undefined) {
                            objParts.push('"' + k + '":' + v);
                        }
                    }
                }
                return '{' + objParts.join(',') + '}';
            }
            return undefined;
        };
    }
    if (typeof JSON.parse !== 'function') {
        JSON.parse = function (text) {
            return eval('(' + text + ')');
        };
    }
})();

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
