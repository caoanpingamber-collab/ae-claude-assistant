// ae-bridge.js - CSInterface wrapper for AE communication

var csInterface = new CSInterface();

function getExtensionPath() {
    return csInterface.getSystemPath(SystemPath.EXTENSION);
}

function loadJSX() {
    return new Promise(function(resolve, reject) {
        var jsxPath = getExtensionPath() + '/host/ae-context.jsx';
        jsxPath = jsxPath.replace(/\\/g, '/');
        csInterface.evalScript('$.evalFile("' + jsxPath + '")', function(result) {
            if (result === 'EvalScript_ErrMessage') {
                reject(new Error('无法加载 ExtendScript: ' + jsxPath));
            } else {
                resolve();
            }
        });
    });
}

function getAEContext() {
    return loadJSX().then(function() {
        return new Promise(function(resolve, reject) {
            csInterface.evalScript('getAEContext()', function(result) {
                if (result === 'EvalScript_ErrMessage') {
                    reject(new Error('无法获取 AE 上下文，请确认已打开项目'));
                } else if (!result || result === '' || result === 'undefined' || result === 'null') {
                    reject(new Error('AE 上下文返回为空 (result=' + String(result) + ')'));
                } else {
                    try {
                        resolve(JSON.parse(result));
                    } catch(e) {
                        reject(new Error('解析 AE 上下文失败: ' + e.message + ' | raw: ' + result.substring(0, 200)));
                    }
                }
            });
        });
    });
}

function getSelectedLayers() {
    return loadJSX().then(function() {
        return new Promise(function(resolve) {
            csInterface.evalScript('getSelectedLayerNames()', function(result) {
                if (result === 'EvalScript_ErrMessage' || !result) {
                    resolve({ comp: null, layers: [] });
                } else {
                    try {
                        resolve(JSON.parse(result));
                    } catch(e) {
                        resolve({ comp: null, layers: [] });
                    }
                }
            });
        });
    });
}

// Call an introspection tool defined in ae-context.jsx (query_layer / query_effect / list_all_layers)
function callTool(toolName, argsObj) {
    return loadJSX().then(function() {
        return new Promise(function(resolve) {
            var argsJson = JSON.stringify(argsObj || {})
                .replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            csInterface.evalScript("dispatchTool('" + toolName + "', '" + argsJson + "')", function(result) {
                if (result === 'EvalScript_ErrMessage' || !result) {
                    resolve({ error: 'tool dispatch failed' });
                } else {
                    try { resolve(JSON.parse(result)); }
                    catch(e) { resolve({ error: 'tool result parse failed: ' + e.message }); }
                }
            });
        });
    });
}

// Auto-capture AE window using Quartz CGWindowListCopyWindowInfo via JXA.
// (Currently unused — screenshot button removed from UI. Kept here in case
// we re-enable a screenshot feature later.)
function screenshotAEAuto() {
    return new Promise(function(resolve, reject) {
        try {
            var child_process = require('child_process');
            var fs = require('fs');
            var path = require('path');
            var os = require('os');

            var tmpFile = path.join(os.tmpdir(), 'ae-shot-' + Date.now() + '.png');

            // Step 1: Activate AE via AppleEvent (no permission needed)
            try {
                child_process.execSync(
                    "osascript -e 'tell application id \"com.adobe.AfterEffects\" to activate' 2>/dev/null"
                );
            } catch (e) {}

            setTimeout(function() {
                var captured = false;
                var captureKind = '';

                // Strategy A: Find AE main window via JXA + Quartz (no accessibility needed)
                try {
                    var jxa =
                        'ObjC.import("CoreGraphics");\n' +
                        'ObjC.import("Quartz");\n' +
                        'var ws = $.CGWindowListCopyWindowInfo(' +
                        '  $.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID);\n' +
                        'var arr = ObjC.deepUnwrap(ws);\n' +
                        'var bestId = 0, bestArea = 0;\n' +
                        'for (var i = 0; i < arr.length; i++) {\n' +
                        '  var w = arr[i];\n' +
                        '  var owner = w.kCGWindowOwnerName || "";\n' +
                        '  if (owner.indexOf("After Effects") === -1) continue;\n' +
                        '  var b = w.kCGWindowBounds;\n' +
                        '  if (!b) continue;\n' +
                        '  var area = b.Width * b.Height;\n' +
                        '  if (area > bestArea && area > 250000) {\n' +
                        '    bestArea = area;\n' +
                        '    bestId = w.kCGWindowNumber;\n' +
                        '  }\n' +
                        '}\n' +
                        'bestId.toString();';

                    var jxaFile = path.join(os.tmpdir(), 'ae-find-' + Date.now() + '.js');
                    fs.writeFileSync(jxaFile, jxa);
                    var winId = child_process.execSync(
                        'osascript -l JavaScript "' + jxaFile + '" 2>/dev/null'
                    ).toString().trim();
                    try { fs.unlinkSync(jxaFile); } catch (e) {}

                    if (winId && winId !== '0' && !isNaN(parseInt(winId, 10))) {
                        child_process.execSync(
                            'screencapture -l' + winId + ' -o -t png "' + tmpFile + '" 2>/dev/null'
                        );
                        if (fs.existsSync(tmpFile)) {
                            captured = true;
                            captureKind = 'ae-window';
                        }
                    }
                } catch (e) {}

                // Strategy B: capture all displays (covers multi-monitor setups where
                // AE might not be on the main display)
                if (!captured) {
                    try {
                        // -D 1 captures display 1; loop through if needed
                        // simpler: capture main display
                        child_process.execSync(
                            'screencapture -x -t png "' + tmpFile + '"'
                        );
                        if (fs.existsSync(tmpFile)) {
                            captured = true;
                            captureKind = 'full-screen';
                        }
                    } catch (e) {}
                }

                // Strategy C: -W mode (camera cursor, user clicks any AE window once).
                // Works without Screen Recording permission since user-initiated.
                if (!captured) {
                    try {
                        child_process.execSync(
                            'screencapture -W -o -t png "' + tmpFile + '"'
                        );
                        if (fs.existsSync(tmpFile)) {
                            captured = true;
                            captureKind = 'click-window';
                        }
                    } catch (e) {}
                }

                if (!captured) {
                    reject(new Error(
                        '截图失败。如想全自动抓 AE 窗口，请：\n' +
                        '系统设置 → 隐私与安全性 → 屏幕录制 → 勾选 Adobe After Effects → 重启 AE。\n' +
                        '当前已尝试一键点选窗口模式但被取消。'
                    ));
                    return;
                }

                try {
                    var buf = fs.readFileSync(tmpFile);
                    var base64 = buf.toString('base64');
                    try { fs.unlinkSync(tmpFile); } catch (e) {}
                    resolve({
                        data: base64,
                        mediaType: 'image/png',
                        dataUrl: 'data:image/png;base64,' + base64,
                        kind: captureKind
                    });
                } catch (readErr) {
                    reject(new Error('读取截图失败: ' + readErr.message));
                }
            }, 250);
        } catch (err) {
            reject(new Error('启动截图失败: ' + err.message));
        }
    });
}

function undoInAE() {
    return loadJSX().then(function() {
        return new Promise(function(resolve, reject) {
            csInterface.evalScript('undoLastAction()', function(result) {
                if (result === 'EvalScript_ErrMessage' || !result) {
                    reject(new Error('撤销失败'));
                } else {
                    try {
                        resolve(JSON.parse(result));
                    } catch(e) {
                        reject(new Error('撤销返回解析失败'));
                    }
                }
            });
        });
    });
}

function executeInAE(code) {
    return loadJSX().then(function() {
        return new Promise(function(resolve, reject) {
            var tempDir = csInterface.getSystemPath(SystemPath.USER_DATA) + '/ClaudeAEAssistant';
            var tempPath = tempDir + '/temp_script.jsx';

            window.cep.fs.makedir(tempDir);

            var writeResult = window.cep.fs.writeFile(tempPath, code, window.cep.encoding.UTF8);
            if (writeResult.err !== 0) {
                reject(new Error('无法写入临时脚本文件 (err=' + writeResult.err + ')'));
                return;
            }

            var escapedPath = tempPath.replace(/\\/g, '/');
            csInterface.evalScript('executeGeneratedCode("' + escapedPath + '")', function(result) {
                if (result === 'EvalScript_ErrMessage') {
                    reject(new Error('ExtendScript 执行错误'));
                } else if (!result || result === '' || result === 'undefined') {
                    reject(new Error('执行返回为空'));
                } else {
                    try {
                        resolve(JSON.parse(result));
                    } catch(e) {
                        reject(new Error('解析执行结果失败: ' + e.message + ' | raw: ' + result.substring(0, 200)));
                    }
                }
            });
        });
    });
}
