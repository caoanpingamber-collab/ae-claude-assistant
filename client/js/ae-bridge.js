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
