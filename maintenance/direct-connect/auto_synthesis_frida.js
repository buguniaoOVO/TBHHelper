'use strict';

var SCRIPT_BUILD_TAG = '20261027-build26211490-compat';
// Frida reports the loaded PE image size; the on-disk DLL size is 111802368.
var GAME_ASSEMBLY_VERIFIED_SIZE = 114753536;
var g_gameBuildMetadataVerified = false;

function requireCurrentGameBuild() {
    if (GA.size !== GAME_ASSEMBLY_VERIFIED_SIZE) {
        throw new Error('当前游戏版本未校验：GameAssembly.dll 大小=' + GA.size +
            '，已验证的 2026-10-27 游戏模块大小=' + GAME_ASSEMBLY_VERIFIED_SIZE);
    }
    if (g_gameBuildMetadataVerified) return;
    var anchors = [
        {ns:'', owner:'Cube', name:'jix', argc:0, rva:0x962470, result:'System.Boolean'},
        {ns:'', owner:'sj', name:'iti', argc:2, rva:0x9181e0, result:'System.Void'},
        {ns:'TaskbarHero.UI', owner:'StageBox', name:'nzr', argc:1, rva:0xbe0330, result:'System.Void'}
    ];
    anchors.forEach(function (anchor) {
        var owner = findClassByEnumeratedName(anchor.ns, anchor.owner);
        var method = isBadPtr(owner) ? ptr(0) : il2cpp.classGetMethod(
            owner, Memory.allocUtf8String(anchor.name), anchor.argc);
        if (isBadPtr(method) || il2cpp.methodGetParamCount(method) !== anchor.argc ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method))) !== anchor.result ||
                !methodPtr(method).equals(B.add(anchor.rva))) {
            throw new Error('游戏接口指纹不匹配：' + anchor.owner + '.' + anchor.name + '；已阻止旧接口调用');
        }
    });
    g_gameBuildMetadataVerified = true;
}
var TRADE_SHIP_X_EXECUTION_ENABLED = true;

// TaskbarHero background auto synthesis helper.
// No recording, no mouse simulation, no OCR.
//
// Current responsibilities:
//   1) Scan live runtime inventory from PlayerSaveData:
//      inventorySaveDatas + stashSaveDatas + materialStashSaveDatas.
//   2) Exclude locked(IsBlocked), equipped, server-pending, and unplaced items.
//   3) Group by category (equipment/accessory/material), grade, and optional item level.
//   4) Invoke the game's own synthesis autofill click event, verify all 9 slots,
//      then submit through Cube.jbh.

var GA = Process.enumerateModules().find(function (m) {
    return m.name.toLowerCase().indexOf('gameassembly') !== -1;
});
if (!GA) throw new Error('GameAssembly.dll not found');
var B = GA.base;
var PTR = Process.pointerSize;

function channelLog(channel, s) {
    var line = '[' + channel + '] ' + s;
    console.log(line);
    try { send({ type: 'auto_synthesis_log', text: line }); } catch (e) {}
}

function log(s) {
    channelLog('自动合成', s);
}

function boxLog(s) {
    channelLog('自动开箱', s);
}

function depositLog(s) {
    channelLog('自动存仓', s);
}

function tradeShipLog(s) {
    channelLog('自动交易船', s);
}

function tradeShipState(message, forceLog) {
    message = String(message || '等待自动交易船状态');
    g_lastTradeShipResult = message;
    var now = Date.now();
    if (forceLog === true || message !== g_lastTradeShipStateLog ||
            now - g_lastTradeShipStateLogAt >= 60000) {
        g_lastTradeShipStateLog = message;
        g_lastTradeShipStateLogAt = now;
        tradeShipLog(message + (/[。！？]$/.test(message) ? '' : '。'));
    }
    return message;
}

function gameplayLog(s) {
    channelLog('战斗参数', s);
}

function bossLog(s) {
    channelLog('自动打Boss', s);
}

function cycleLog(s) {
    channelLog('自动周期', s);
}

function chineseError(error) {
    var text = String(error || '未知错误')
        .replace(/^Error:\s*/i, '')
        .replace(/access violation/ig, '非法内存访问')
        .replace(/MethodInfo not found/ig, '方法信息不存在')
        .replace(/game version mismatch/ig, '游戏版本不匹配');
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > 180 ? text.slice(0, 177) + '...' : text;
}

function autoDepositRetryDelayMs(failureCount) {
    var failures = Math.max(1, parseInt(failureCount, 10) || 1);
    return Math.min(300000, 10000 * Math.pow(2, failures - 1));
}

function emit(type, payload) {
    try {
        payload = payload || {};
        payload.type = type;
        send(payload);
    } catch (e) {}
}

function api(name, ret, args) {
    return new NativeFunction(GA.getExportByName(name), ret, args);
}

var il2cpp = {
    domainGet: api('il2cpp_domain_get', 'pointer', []),
    threadAttach: api('il2cpp_thread_attach', 'pointer', ['pointer']),
    domainGetAssemblies: api('il2cpp_domain_get_assemblies', 'pointer', ['pointer', 'pointer']),
    assemblyGetImage: api('il2cpp_assembly_get_image', 'pointer', ['pointer']),
    imageGetName: api('il2cpp_image_get_name', 'pointer', ['pointer']),
    classFromName: api('il2cpp_class_from_name', 'pointer', ['pointer', 'pointer', 'pointer']),
    classGetMethod: api('il2cpp_class_get_method_from_name', 'pointer', ['pointer', 'pointer', 'int']),
    classGetMethods: api('il2cpp_class_get_methods', 'pointer', ['pointer', 'pointer']),
    classGetFields: api('il2cpp_class_get_fields', 'pointer', ['pointer', 'pointer']),
    classGetStaticFieldData: api('il2cpp_class_get_static_field_data', 'pointer', ['pointer']),
    classGetParent: api('il2cpp_class_get_parent', 'pointer', ['pointer']),
    classGetType: api('il2cpp_class_get_type', 'pointer', ['pointer']),
    typeGetObject: api('il2cpp_type_get_object', 'pointer', ['pointer']),
    objectGetClass: api('il2cpp_object_get_class', 'pointer', ['pointer']),
    classGetName: api('il2cpp_class_get_name', 'pointer', ['pointer']),
    classGetNamespace: api('il2cpp_class_get_namespace', 'pointer', ['pointer']),
    fieldGetName: api('il2cpp_field_get_name', 'pointer', ['pointer']),
    fieldGetOffset: api('il2cpp_field_get_offset', 'int32', ['pointer']),
    fieldGetFlags: api('il2cpp_field_get_flags', 'uint32', ['pointer']),
    fieldGetType: api('il2cpp_field_get_type', 'pointer', ['pointer']),
    fieldStaticGetValue: api('il2cpp_field_static_get_value', 'void', ['pointer', 'pointer']),
    typeGetName: api('il2cpp_type_get_name', 'pointer', ['pointer']),
    methodGetName: api('il2cpp_method_get_name', 'pointer', ['pointer']),
    methodGetClass: api('il2cpp_method_get_class', 'pointer', ['pointer']),
    methodGetFlags: api('il2cpp_method_get_flags', 'uint32', ['pointer', 'pointer']),
    methodGetParamCount: api('il2cpp_method_get_param_count', 'uint32', ['pointer']),
    methodGetParam: api('il2cpp_method_get_param', 'pointer', ['pointer', 'uint32']),
    methodGetReturnType: api('il2cpp_method_get_return_type', 'pointer', ['pointer']),
    resolveIcall: api('il2cpp_resolve_icall', 'pointer', ['pointer']),
    stringNew: api('il2cpp_string_new', 'pointer', ['pointer'])
};

try { il2cpp.threadAttach(il2cpp.domainGet()); } catch (e) {}

function cstr(p) {
    try { return (!p || p.isNull()) ? '' : p.readCString(); } catch (e) { return ''; }
}

// Read the logged-in Steam persona inside each attached game process.
// Sandboxie identities never come from the host Steam client.
var g_accountIdentityCache = null;
var g_accountIdentityReadAt = 0;
function readAccountIdentity() {
    var now = Date.now();
    var ttl = g_accountIdentityCache && g_accountIdentityCache.displayName ? 60000 : 10000;
    if (g_accountIdentityCache && now - g_accountIdentityReadAt < ttl) return g_accountIdentityCache;
    var result = {pid: Process.id, displayName: '', source: ''};
    try {
        var module = Process.findModuleByName('steam_api64.dll');
        if (module) {
            var getters = module.enumerateExports().filter(function (entry) {
                return entry.type === 'function' && /^SteamAPI_SteamFriends_v[0-9]{3}$/.test(entry.name);
            }).sort(function (a, b) { return b.name.localeCompare(a.name); });
            var personaAddress = module.findExportByName('SteamAPI_ISteamFriends_GetPersonaName');
            if (getters.length && personaAddress) {
                var getFriends = new NativeFunction(getters[0].address, 'pointer', []);
                var friends = getFriends();
                if (!friends.isNull()) {
                    var getPersonaName = new NativeFunction(personaAddress, 'pointer', ['pointer']);
                    var value = getPersonaName(friends);
                    if (!value.isNull()) {
                        result.displayName = String(value.readUtf8String() || '').trim().slice(0, 128);
                        if (result.displayName) result.source = 'Steam persona';
                    }
                }
            }
            var userGetter = module.enumerateExports().filter(function (entry) {
                return entry.type === 'function' && /^SteamAPI_SteamUser_v[0-9]{3}$/.test(entry.name);
            }).sort(function (a, b) { return b.name.localeCompare(a.name); });
            var steamIdAddress = module.findExportByName('SteamAPI_ISteamUser_GetSteamID');
            if (userGetter.length && steamIdAddress) {
                var steamUser = new NativeFunction(userGetter[0].address, 'pointer', [])();
                if (!steamUser.isNull()) {
                    var steamId = new NativeFunction(steamIdAddress, 'uint64', ['pointer'])(steamUser).toString();
                    if (/^[1-9][0-9]{15,19}$/.test(steamId)) result.accountKey = 'steam:' + steamId;
                }
            }
        }
    } catch (e) {}
    g_accountIdentityReadAt = now;
    g_accountIdentityCache = result;
    return result;
}

function il2cppString(p) {
    if (!p || p.isNull()) return '';
    try {
        var len = p.add(0x10).readS32();
        if (len < 0 || len > 65536) return '';
        return p.add(0x14).readUtf16String(len);
    } catch (e) {
        return '';
    }
}

function managedType(p) {
    try {
        if (!p || p.isNull()) return '';
        var k = il2cpp.objectGetClass(p);
        var namespaceName = cstr(il2cpp.classGetNamespace(k));
        var className = cstr(il2cpp.classGetName(k));
        return namespaceName ? namespaceName + '.' + className : className;
    } catch (e) {
        return '';
    }
}

function methodPtr(methodInfo) {
    try {
        if (!methodInfo || methodInfo.isNull()) return ptr(0);
        var fp = methodInfo.readPointer();
        return fp && !fp.isNull() ? fp : ptr(0);
    } catch (e) {
        return ptr(0);
    }
}

function methodRvaText(method) {
    return method && method.derived ? 'derived' :
        (method && method.ptr && !method.ptr.isNull() ? '0x' + method.ptr.sub(B).toString(16) : 'unavailable');
}

function managedMethodText(method) {
    if (!method || !method.mi || method.mi.isNull()) return 'unresolved';
    var params = [];
    var count = il2cpp.methodGetParamCount(method.mi);
    for (var i = 0; i < count && i < 5; i++)
        params.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method.mi, i))));
    return cstr(il2cpp.methodGetName(method.mi)) + '(' + params.join(',') + '):' +
        cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method.mi))) + '@' + methodRvaText(method);
}

function allImages() {
    var out = [];
    var sz = Memory.alloc(PTR);
    if (PTR === 8) sz.writeU64(0); else sz.writeU32(0);
    var assemblies = il2cpp.domainGetAssemblies(il2cpp.domainGet(), sz);
    var count = PTR === 8 ? Number(sz.readU64()) : sz.readU32();
    for (var i = 0; i < count; i++) {
        var asm = assemblies.add(i * PTR).readPointer();
        if (!asm || asm.isNull()) continue;
        var img = il2cpp.assemblyGetImage(asm);
        if (img && !img.isNull()) out.push({ image: img, name: cstr(il2cpp.imageGetName(img)) });
    }
    return out;
}

var g_images = null;
function imageByName(name) {
    if (!g_images) g_images = allImages();
    for (var i = 0; i < g_images.length; i++) {
        if (g_images[i].name === name) return g_images[i].image;
    }
    return ptr(0);
}

function klass(ns, name, imageName) {
    var img = imageByName(imageName || 'Assembly-CSharp.dll');
    if (!img || img.isNull()) return ptr(0);
    return il2cpp.classFromName(img, Memory.allocUtf8String(ns || ''), Memory.allocUtf8String(name || ''));
}

var g_classCache = {};
function classInfo(ns, name, imageName) {
    var key = (imageName || 'Assembly-CSharp.dll') + '|' + (ns || '') + '|' + name;
    if (g_classCache[key]) return g_classCache[key];
    var k = klass(ns, name, imageName);
    var fields = {};
    var fieldTypes = {};
    var fieldInfos = {};
    if (k && !k.isNull()) {
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var f = il2cpp.classGetFields(k, iter);
            if (!f || f.isNull()) break;
            var fname = cstr(il2cpp.fieldGetName(f));
            fields[fname] = il2cpp.fieldGetOffset(f);
            fieldTypes[fname] = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(f)));
            fieldInfos[fname] = f;
        }
    }
    g_classCache[key] = { klass: k, fields: fields, fieldTypes: fieldTypes, fieldInfos: fieldInfos };
    return g_classCache[key];
}

var g_runtimeClassFieldCache = {};
function runtimeClassFields(runtimeClass) {
    if (!runtimeClass || runtimeClass.isNull()) return { fields: {}, fieldInfos: {} };
    var key = String(runtimeClass);
    if (g_runtimeClassFieldCache[key]) return g_runtimeClassFieldCache[key];
    var fields = {};
    var fieldInfos = {};
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    while (true) {
        var field = il2cpp.classGetFields(runtimeClass, iter);
        if (!field || field.isNull()) break;
        var name = cstr(il2cpp.fieldGetName(field));
        fields[name] = il2cpp.fieldGetOffset(field);
        fieldInfos[name] = field;
    }
    g_runtimeClassFieldCache[key] = { fields: fields, fieldInfos: fieldInfos };
    return g_runtimeClassFieldCache[key];
}

function findMethodInfo(ns, klassName, methodName, argCount, imageName) {
    var img = imageByName(imageName || 'Assembly-CSharp.dll');
    if (!img || img.isNull()) return ptr(0);
    var k = il2cpp.classFromName(img, Memory.allocUtf8String(ns || ''), Memory.allocUtf8String(klassName || ''));
    if (!k || k.isNull()) return ptr(0);
    return il2cpp.classGetMethod(k, Memory.allocUtf8String(methodName || ''), argCount | 0);
}

function findMethodInfoByRva(targetRva) {
    targetRva = parseInt(targetRva, 10) >>> 0;
    var imgs = allImages();
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i].image;
        var classCountApi = null;
        var classApi = null;
        try {
            classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
            classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
        } catch (e) {
            return ptr(0);
        }
        var count = classCountApi(img);
        for (var ci = 0; ci < count; ci++) {
            var k = classApi(img, ci);
            if (!k || k.isNull()) continue;
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var guard = 0; guard < 400; guard++) {
                var mi = il2cpp.classGetMethods(k, iter);
                if (!mi || mi.isNull()) break;
                var fp = methodPtr(mi);
                if (fp && !fp.isNull() && ((fp.sub(B).toInt32() >>> 0) === targetRva)) return mi;
            }
        }
    }
    return ptr(0);
}

var g_enumeratedClassCache = {};
function findClassByEnumeratedName(ns, klassName) {
    var cacheKey = (ns || '') + '|' + klassName;
    if (g_enumeratedClassCache[cacheKey]) return g_enumeratedClassCache[cacheKey];
    var classCountApi = null;
    var classApi = null;
    try {
        classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
        classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    } catch (e) {
        return ptr(0);
    }
    var imgs = allImages();
    for (var i = 0; i < imgs.length; i++) {
        if (imgs[i].name !== 'Assembly-CSharp.dll') continue;
        var count = classCountApi(imgs[i].image);
        for (var ci = 0; ci < count; ci++) {
            var k = classApi(imgs[i].image, ci);
            if (!k || k.isNull()) continue;
            var cname = cstr(il2cpp.classGetName(k));
            var cns = cstr(il2cpp.classGetNamespace(k));
            if (cname !== klassName) continue;
            if ((ns || '') !== cns) continue;
            g_enumeratedClassCache[cacheKey] = k;
            return k;
        }
    }
    return ptr(0);
}

function findMethodInfoByClassMethod(ns, klassName, methodName, argCount) {
    var k = findClassByEnumeratedName(ns, klassName);
    if (!k || k.isNull()) return ptr(0);
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    for (var guard = 0; guard < 800; guard++) {
        var mi = il2cpp.classGetMethods(k, iter);
        if (!mi || mi.isNull()) break;
        if (cstr(il2cpp.methodGetName(mi)) !== methodName) continue;
        if (argCount != null && il2cpp.methodGetParamCount(mi) !== argCount) continue;
        return mi;
    }
    return ptr(0);
}

function findMethodInfoByRuntimeClassMethod(klassName, methodName, argCount, expectedRva) {
    var imgs = allImages();
    var firstMatch = ptr(0);
    for (var imageIndex = 0; imageIndex < imgs.length; imageIndex++) {
        var image = imgs[imageIndex].image;
        var classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
        var classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
        var classCount = classCountApi(image);
        for (var classIndex = 0; classIndex < classCount; classIndex++) {
            var owner = classApi(image, classIndex);
            if (isBadPtr(owner) || cstr(il2cpp.classGetName(owner)) !== klassName) continue;
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var methodIndex = 0; methodIndex < 800; methodIndex++) {
                var method = il2cpp.classGetMethods(owner, iter);
                if (isBadPtr(method)) break;
                if (cstr(il2cpp.methodGetName(method)) !== methodName) continue;
                if (argCount != null && il2cpp.methodGetParamCount(method) !== argCount) continue;
                if (isBadPtr(firstMatch)) firstMatch = method;
                if (expectedRva) {
                    var fp = methodPtr(method);
                    if (!isBadPtr(fp) && ((fp.sub(B).toInt32() >>> 0) === (expectedRva >>> 0))) return method;
                }
            }
        }
    }
    return firstMatch;
}

function findMethodInfoByManagedSignature(methodName, expectedReturn, expectedParameters) {
    var classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
    var classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    var imgs = allImages();
    var matches = [];
    for (var imageIndex = 0; imageIndex < imgs.length; imageIndex++) {
        var image = imgs[imageIndex].image;
        var classCount = classCountApi(image);
        for (var classIndex = 0; classIndex < classCount; classIndex++) {
            var owner = classApi(image, classIndex);
            if (isBadPtr(owner)) continue;
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var methodIndex = 0; methodIndex < 800; methodIndex++) {
                var method = il2cpp.classGetMethods(owner, iter);
                if (isBadPtr(method)) break;
                if (cstr(il2cpp.methodGetName(method)) !== methodName ||
                        il2cpp.methodGetParamCount(method) !== expectedParameters.length) continue;
                if (cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method))) !== expectedReturn) continue;
                var parametersMatch = expectedParameters.every(function (wanted, index) {
                    return cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method, index))) === wanted;
                });
                if (parametersMatch) matches.push(method);
            }
        }
    }
    return matches.length === 1 ? matches[0] : ptr(0);
}

function findObjectsOfType(k) {
    var objectClass = klass('UnityEngine', 'Object', 'UnityEngine.CoreModule.dll');
    if (!objectClass || objectClass.isNull() || !k || k.isNull()) return [];
    var mi = il2cpp.classGetMethod(objectClass, Memory.allocUtf8String('FindObjectsOfType'), 1);
    var fp = methodPtr(mi);
    if (!fp || fp.isNull()) return [];
    var fn = new NativeFunction(fp, 'pointer', ['pointer', 'pointer']);
    var typeObj = il2cpp.typeGetObject(il2cpp.classGetType(k));
    var arr = fn(typeObj, mi);
    return readObjectArray(arr, 64);
}

function readObjectArray(arr, limit) {
    var out = [];
    if (isBadPtr(arr)) return out;
    try {
        var n = arr.add(0x18).readU32();
        var max = Math.min(n, limit == null ? n : limit);
        for (var i = 0; i < max; i++) {
            var item = arr.add(0x20 + i * PTR).readPointer();
            if (!isBadPtr(item)) out.push(item);
        }
    } catch (e) {}
    return out;
}

function isBadPtr(p) {
    try {
        if (!p || p.isNull()) return true;
        var text = String(p).toLowerCase();
        if (text === '0xffffffffffffffff' || text === '0xffffffff') return true;
        // Frida's guarded read throws on inaccessible memory. Querying the
        // process's memory ranges for each object costs several milliseconds
        // on Windows and stalls Unity when done inside a synthesis frame.
        p.readU8();
        return false;
    } catch (e) {
        return true;
    }
}

function readU64Text(p) {
    try { return p.readU64().toString(); } catch (e) { return '0'; }
}

function firstFieldOffset(fields, names) {
    if (!fields) return null;
    for (var i = 0; i < names.length; i++) {
        if (fields[names[i]] != null) return fields[names[i]];
    }
    return null;
}


function readS32Field(obj, fields, names, fallback) {
    var off = firstFieldOffset(fields, names);
    if (off == null) return fallback == null ? 0 : fallback;
    try { return obj.add(off).readS32(); } catch (e) { return fallback == null ? 0 : fallback; }
}

function readBoolField(obj, fields, names) {
    var off = firstFieldOffset(fields, names);
    if (off == null) return false;
    try { return obj.add(off).readU8() !== 0; } catch (e) { return false; }
}

function readListObjects(listPtr, limit) {
    var out = [];
    if (isObviouslyInvalidPtr(listPtr)) return out;
    try {
        var items = listPtr.add(0x10).readPointer();
        var size = listPtr.add(0x18).readS32();
        if (isObviouslyInvalidPtr(items) || size < 0 || size > 200000) return out;
        var max = Math.min(size, limit == null ? size : limit);
        for (var i = 0; i < max; i++) {
            var item = items.add(0x20 + i * PTR).readPointer();
            if (!isObviouslyInvalidPtr(item)) out.push(item);
        }
    } catch (e) {}
    return out;
}

function isObviouslyInvalidPtr(p) {
    try {
        if (!p || p.isNull()) return true;
        var text = String(p).toLowerCase();
        return text === '0xffffffffffffffff' || text === '0xffffffff';
    } catch (e) {
        return true;
    }
}

function readIntListOrArray(listPtr, limit) {
    var out = [];
    if (isObviouslyInvalidPtr(listPtr)) return out;
    try {
        var items = listPtr.add(0x10).readPointer();
        var size = listPtr.add(0x18).readS32();
        if (!isObviouslyInvalidPtr(items) && size >= 0 && size <= 10000) {
            var maxList = Math.min(size, limit == null ? size : limit);
            for (var i = 0; i < maxList; i++) out.push(items.add(0x20 + i * 4).readS32());
            return out;
        }
    } catch (e) {}
    try {
        var n = listPtr.add(0x18).readS32();
        if (n < 0 || n > 10000) return out;
        var maxArr = Math.min(n, limit == null ? n : limit);
        for (var j = 0; j < maxArr; j++) out.push(listPtr.add(0x20 + j * 4).readS32());
    } catch (e2) {}
    return out;
}

function readU64Array(arrPtr, limit) {
    var out = [];
    if (isBadPtr(arrPtr)) return out;
    try {
        var n = arrPtr.add(0x18).readS32();
        if (n < 0 || n > 10000) return out;
        var max = Math.min(n, limit == null ? n : limit);
        for (var i = 0; i < max; i++) out.push(readU64Text(arrPtr.add(0x20 + i * 8)));
    } catch (e) {}
    return out;
}

function readU64ListOrArray(listPtr, limit) {
    var out = [];
    if (isObviouslyInvalidPtr(listPtr)) return out;
    try {
        var items = listPtr.add(0x10).readPointer();
        var size = listPtr.add(0x18).readS32();
        if (!isObviouslyInvalidPtr(items) && size >= 0 && size <= 10000) {
            var maxList = Math.min(size, limit == null ? size : limit);
            for (var i = 0; i < maxList; i++) out.push(readU64Text(items.add(0x20 + i * 8)));
            return out;
        }
    } catch (e) {}
    return readU64Array(listPtr, limit);
}

function enumName(v) {
    v = parseInt(v, 10);
    return {
        0: 'COMMON',
        1: 'UNCOMMON',
        2: 'RARE',
        3: 'LEGENDARY',
        4: 'IMMORTAL',
        5: 'ARCANA',
        6: 'BEYOND',
        7: 'CELESTIAL',
        8: 'DIVINE',
        9: 'COSMIC'
    }[v] || String(v);
}

function gradeZh(v) {
    v = parseInt(v, 10);
    return {
        0: '普通',
        1: '罕见',
        2: '稀有',
        3: '传奇',
        4: '不朽',
        5: '至宝',
        6: '超凡',
        7: '天界',
        8: '神圣',
        9: '宇宙'
    }[v] || String(v);
}

function categoryFromItemKeyPrefix(itemKey) {
    var s = String(itemKey || '');
    var pref = s.length >= 2 ? s.substring(0, 2) : '';
    if (/^(60|61|62|63)$/.test(pref)) return { key: 'accessory', name: '首饰' };
    if (/^(30|31|32|33|34|35|40|41|42|43|44|45|50|51|52|53)$/.test(pref)) return { key: 'equipment', name: '装备' };
    if (/^(11|12|13|14|15|16|17|18|19)$/.test(pref)) return { key: 'material', name: '材料' };
    return null;
}


function categoryFromItem(meta, allowPrefixFallback) {
    meta = meta || {};
    var synthType = parseInt(meta.synthesisType, 10);
    // 1.3.0: only the three existing synthesis categories are automated.
    if (synthType === 0) return { key: 'equipment', name: '装备' };
    if (synthType === 1) return { key: 'accessory', name: '首饰' };
    if (synthType === 2) return { key: 'material', name: '材料' };
    if (synthType >= 3 || !allowPrefixFallback) return null;
    return categoryFromItemKeyPrefix(meta.itemKey || 0);
}

var DIRECT = {
    synthesisBackend: { rva: 0x8c1260, className: 'Cube', methodName: 'ipe', friendly: '后台合成' },
    synthesis: { rva: 0x8c14e0, className: 'Cube', methodName: 'ipg', friendly: '合成' },
    craftingBackend: { rva: 0x8c1970, className: 'Cube', methodName: 'ipi', friendly: '后台制作' },
    crafting: { rva: 0x8c1a60, className: 'Cube', methodName: 'ipj', friendly: '制作' }
};

var SYNTHESIS_BRIDGE = {
    slotCount: { rva: 0x8b4380, methodName: 'ilp', argCount: 0 },
    selectRecipe: { rva: 0x8b6410, methodName: 'imq', argCount: 1 },
    selectSynthesisType: { rva: 0x8b5150, methodName: 'imf', argCount: 1 },
    reset: { rva: 0x8c3350, methodName: 'ipv', argCount: 0 },
    addSlot: { rva: 0x8c5080, methodName: 'ior', argCount: 2 },
    executeBackend: { rva: 0x8c1260, methodName: 'ipe', argCount: 0 },
    getSlotItem: { rva: 0x8be440, className: 'Cube', methodName: 'ios', argCount: 2 },
    getItemUid: { rva: 0x908400, className: 'ty', methodName: 'iwx', argCount: 0 },
    getItemTier: { rva: 0x908600, className: 'ty', methodName: 'ixj', argCount: 0 }
};

var SYNTHESIS_BRIDGE_CURRENT = {
    slotCount: null,
    selectRecipe: { rva: 0x964e80, methodName: 'jki', argCount: 1 },
    selectSpecificRecipe: { rva: 0x9650f0, methodName: 'jkj', argCount: 1 },
    selectSynthesisType: { rva: 0x963920, methodName: 'jjv', argCount: 1 },
    reset: { rva: 0x9783d0, methodName: 'joq', argCount: 0 },
    addSlot: { rva: 0x96d000, methodName: 'jmk', argCount: 2 },
    executeBackend: { rva: 0x96fc80, methodName: 'jmw', argCount: 0 },
    triggerRecipe: { rva: 0x968460, methodName: 'jle', argCount: 0 },
    refreshRecipe: { rva: 0x966910, methodName: 'jku', argCount: 1 },
    busy: { rva: 0x962470, methodName: 'jix', argCount: 0 },
    getSlotList: { rva: 0x9623d0, methodName: 'jiv', argCount: 0 },
    getSlotUid: { rva: 0xa75d60, namespace: 'TaskbarHero', className: 'CubeInData', methodName: 'lfa', argCount: 0 },
    getSlotItem: { rva: 0x96d2a0, methodName: 'jml', argCount: 2 },
    getItemUid: { rva: 0x9c5960, className: 'vs', methodName: 'jwl', argCount: 0 },
    getItemTier: { rva: 0x9c5b30, className: 'vs', methodName: 'jww', argCount: 0 }
};
var SYNTHESIS_AUTO_FILL_UI_CURRENT = {
    managerNamespace: 'TaskbarHero',
    managerClassName: 'UIManager',
    managerCubeFieldName: 'Ui_Cube',
    managerCubeFieldOffset: 0xe8,
    cubeClassName: 'UI_Cube',
    cubeAutoFillFieldName: 'm_synthesisAutoFillButton',
    cubeAutoFillFieldOffset: 0xc8,
    cubeFixedLevelToggleFieldName: 'toggleButton_AutoFill',
    cubeFixedLevelToggleFieldOffset: 0xd0,
    cubeFixedLevelToggleFieldType: 'TS.ToggleButton',
    fixedLevelGetterMethodName: 'gjv',
    fixedLevelSetterMethodName: 'gjw',
    baseButtonFieldName: 'button',
    baseButtonFieldOffset: 0x50,
    clickEventFieldName: 'm_OnClick',
    clickEventFieldOffset: 0x100,
    unityEventInvoke: {
        rva: 0x493e670,
        namespace: 'UnityEngine.Events',
        className: 'UnityEvent',
        methodName: 'Invoke',
        argCount: 0
    }
};

// These are the nine result-level options shown by the current game UI.
var CURRENT_SYNTHESIS_LEVEL_BANDS = {
    equipment: [[1, 1, 10], [2, 10, 20], [3, 15, 30], [4, 20, 40],
        [5, 30, 50], [6, 40, 65], [7, 50, 65], [8, 65, 80], [9, 80, 90]],
    accessory: [[1, 1, 10], [2, 10, 20], [3, 15, 30], [4, 20, 40],
        [5, 30, 50], [6, 40, 65], [7, 50, 65], [8, 65, 80], [9, 80, 90]],
    material: [[1, 1, 10], [2, 10, 20], [3, 15, 30], [4, 20, 40],
        [5, 30, 50], [6, 40, 65], [7, 50, 65], [8, 65, 80], [9, 80, 90]]
};

function synthesisBridgeProfile() {
    var playerInfo = classInfo('TaskbarHero', 'PlayerSaveData');
    if (playerInfo.fields.BoxData == null) {
        requireCurrentGameBuild();
        return SYNTHESIS_BRIDGE_CURRENT;
    }
    return SYNTHESIS_BRIDGE;
}

function verifyManagedMethodShape(label, method, expectedReturn, expectedParameters) {
    if (!method || isBadPtr(method.mi)) throw new Error(label + ' MethodInfo 缺失');
    var returnType = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method.mi)));
    var count = il2cpp.methodGetParamCount(method.mi);
    var params = [];
    for (var i = 0; i < count; i++)
        params.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method.mi, i))));
    var returnMatches = !expectedReturn || returnType.indexOf(expectedReturn) >= 0;
    var paramsMatch = !expectedParameters || (count === expectedParameters.length &&
        expectedParameters.every(function (wanted, index) {
            return !wanted || params[index].indexOf(wanted) >= 0;
        }));
    if (!returnMatches || !paramsMatch) {
        throw new Error(label + ' 签名不匹配：' + returnType + '(' + params.join(',') + ')');
    }
}

var E_ADD_CUBE_RESULT_NAMES = {
    0: '成功', 1: '物品已经装备', 2: '材料过多且物品已经装备',
    3: '已装备物品不能放入合成槽', 4: '不符合炼金配方', 5: '不符合合成配方',
    6: '合成品质不一致', 7: '合成类别不一致', 8: '不符合制作配方',
    9: '不符合装饰配方', 10: '不符合雕刻配方', 11: '不符合铭文配方',
    12: '不符合供奉配方', 13: '不符合提取配方', 14: '物品无效',
    15: '当前配方未初始化或无效', 16: '宇宙品质不能合成', 17: '物品已上锁',
    18: '保留的灵魂石不能使用', 19: '物品正在等待服务器同步', 20: '低阶合成受限',
    21: '同一物品已经在合成槽中', 22: '物品已在合成槽中并被移除',
    23: '该物品只能用于炼金删除', 24: '合成器正在运行', 25: '合成器等级不足'
};

var BOX_TYPE_NAMES = { 0: '普通宝箱', 1: '首领宝箱', 2: '章节首领宝箱' };

var STAGEBOX_AUTO_OPEN = {
    namespace: 'TaskbarHero.UI',
    className: 'StageBox'
};

var AUTO_DEPOSIT_BRIDGE = {
    firstEmptyIndex: { rva: 0x91cfd0, className: 'Stash', methodName: 'jwo', argCount: 0 },
    pageFromIndex: { rva: 0x91d290, className: 'Stash', methodName: 'jwp', argCount: 1 },
    addToPage: { rva: 0x91cd20, className: 'Stash', methodName: 'jwm', argCount: 2 },
    removeFromInventory: { rva: 0x8fe370, className: 'tx', methodName: 'iuz', argCount: 1 }
};
var AUTO_DEPOSIT_BRIDGE_CURRENT = {
    moveRequest: { rva: 0x9181e0, className: 'sj', methodName: 'iti', argCount: 2 }
};
var AUTO_TRADE_SHIP_BRIDGE = {
    moveDirect: { rva: 0x8867f0, className: 'ra', methodName: 'hyf', argCount: 4 },
    firstAvailableSlot: { rva: 0x93e420, className: 'uw', methodName: 'jle', argCount: 0 },
    validSlotCount: { rva: 0x93e210, className: 'uw', methodName: 'jle', argCount: 0 },
    cacheForSlot: { rva: 0x93dda0, className: 'uw', methodName: 'jkz', argCount: 1 },
    cacheOccupied: {
        rva: 0x9510c0,
        namespace: 'TaskbarHero',
        className: 'TradingStashCache',
        methodName: 'jkf',
        argCount: 0
    },
    waitingContains: { rva: 0x959b20, className: 'vf', methodName: 'jst', argCount: 1 },
    downloadBlocked: { rva: 0x959f10, className: 'vf', methodName: 'mgl', argCount: 1 },
    uploadButton: {
        rva: 0xa341f0,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'llr',
        argCount: 0
    },
    confirmButton: {
        rva: 0xa66310,
        namespace: 'TaskbarHero.UI',
        className: 'UI_TradingStash',
        methodName: 'lzq',
        argCount: 0
    },
    getSlot: {
        rva: 0xa66400,
        namespace: 'TaskbarHero.UI',
        className: 'UI_TradingStash',
        methodName: 'lzu',
        argCount: 1
    },
    cooldownActive: {
        rva: 0xa34130,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'llq',
        argCount: 0
    },
    cooldownEndForSlot: { rva: 0x9595c0, className: 'vf', methodName: 'jsp', argCount: 2 },
    cooldownSyncRequest: {
        rva: 0x9af420,
        className: 'wn',
        methodName: 'kyd',
        argCount: 1
    },
    cooldownSyncCallback: {
        rva: 0xc40db0,
        className: 'qi.pz',
        methodName: 'hcb',
        argCount: 1
    },
    applyCooldown: {
        rva: 0xa34650,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'lls',
        argCount: 1
    },
    pointerEnter: {
        rva: 0xbcfa30,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'OnPointerEnter',
        argCount: 1
    },
    pointerExit: {
        rva: 0xbcfa60,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'OnPointerExit',
        argCount: 1
    },
    downloadListener: {
        rva: 0xa34d30,
        namespace: 'TaskbarHero.UI',
        className: 'TradingStashSlot',
        methodName: 'llx',
        argCount: 0
    },
    buttonPress: {
        rva: 0x4a554b0,
        namespace: 'UnityEngine.UI',
        className: 'Button',
        methodName: 'Press',
        argCount: 0
    },
    gameObjectActiveSelf: {
        rva: 0x48f5220,
        namespace: 'UnityEngine',
        className: 'GameObject',
        methodName: 'get_activeSelf',
        argCount: 0
    },
    componentGameObject: {
        rva: 0x48efc80,
        namespace: 'UnityEngine',
        className: 'Component',
        methodName: 'get_gameObject',
        argCount: 0
    },
    gameObjectActiveInHierarchy: {
        rva: 0x48f5160,
        namespace: 'UnityEngine',
        className: 'GameObject',
        methodName: 'get_activeInHierarchy',
        argCount: 0
    },
    unityEventInvoke: {
        rva: 0x493e670,
        namespace: 'UnityEngine.Events',
        className: 'UnityEvent',
        methodName: 'Invoke',
        argCount: 0
    },
    dateTimeGreaterThan: {
        rva: 0x3420450,
        namespace: 'System',
        className: 'DateTime',
        methodName: 'op_GreaterThan',
        argCount: 2
    },
    serverTime: {
        rva: 0xc3bbb0,
        className: 'pv',
        methodName: 'hak',
        argCount: 0
    },
    singletonGetterRva: 0x29b0100,
    uiManagerSingletonArgumentRva: 0x5dd8a80,
    serverTimeSingletonArgumentRva: 0x5dd9908,
    qiSingletonArgumentRva: 0x5dd9ce8,
    qiPzTypeInfoRva: 0x5dd8068,
    actionWgTypeInfoRva: 0x5dc66f8,
    qiPzHcbMethodInfoRva: 0x5e50b00,
    objectNewRva: 0x591ea0,
    objectCtorRva: 0x661390,
    writeBarrierRva: 0x590d70,
    delegateCtorRva: 0x19262e0,
    downloadListenerMethodInfoRva: 0x5e28350,
    tradingStashOffset: 0xf8,
    slotListOffset: 0x70,
    slotIndexOffset: 0x88,
    slotWaitingUidOffset: 0xf8,
    slotCooldownEndOffset: 0xf0,
    slotItemOffset: 0x30,
    slotCacheOffset: 0x108,
    pendingConfirmOffset: 0xc8,
    downloadButtonBackgroundOffset: 0xd0,
    downloadButtonOffset: 0xd8,
    buttonOnClickOffset: 0x100,
    unityEventCallsOffset: 0x10,
    invokableRuntimeCallsOffset: 0x18,
    managedListItemsOffset: 0x10,
    managedListCountOffset: 0x18,
    managedArrayItemsOffset: 0x20,
    invokableDelegateOffset: 0x10,
    delegateTargetOffset: 0x20,
    delegateMethodInfoOffset: 0x28,
    cacheSaveDataOffset: 0x20,
    saveDataItemUidOffset: 0x18,
    saveDataUnlockedOffset: 0x20
};
// 1.2.8 uses a value-type MoveRequest and a different trading-slot UI layout.
// Keep its entry points separate from the older trading-ship bridge.
var AUTO_TRADE_SHIP_BRIDGE_CURRENT = {
    validateMove: { rva: 0x918470, className: 'sj', methodName: 'itj', argCount: 1 },
    moveRequest: AUTO_DEPOSIT_BRIDGE_CURRENT.moveRequest,
    // Current runtime: nwx is only a Boolean eligibility check. nxg is the
    // native handler wired to the green upload-confirm action; it builds the
    // confirmation callback and calls UI_TradingStash.oqb(Action) itself.
    uploadSlot: { rva: 0xbd15d0, namespace: 'TaskbarHero.UI', className: 'TradingStashSlot', methodName: 'nxg', argCount: 0 },
    undoWaiting: { rva: 0xbd2ce0, namespace: 'TaskbarHero.UI', className: 'TradingStashSlot', methodName: 'nxp', argCount: 0 },
    clearWaitingDisplay: { rva: 0xbd0a10, namespace: 'TaskbarHero.UI', className: 'TradingStashSlot', methodName: 'nww', argCount: 0 },
    unityEventInvoke: { rva: 0x493e670, namespace: 'UnityEngine.Events', className: 'UnityEvent', imageName: 'UnityEngine.CoreModule.dll', methodName: 'Invoke', argCount: 0 },
    pointerEnter: { rva: 0xbcfa30, namespace: 'TaskbarHero.UI', className: 'TradingStashSlot', methodName: 'OnPointerEnter', argCount: 1 },
    pointerExit: { rva: 0xbcfa60, namespace: 'TaskbarHero.UI', className: 'TradingStashSlot', methodName: 'OnPointerExit', argCount: 1 },
    buttonPress: { rva: 0x4a554b0, namespace: 'UnityEngine.UI', className: 'Button', imageName: 'UnityEngine.UI.dll', methodName: 'Press', argCount: 0 },
    componentGameObject: { rva: 0x48efc80, namespace: 'UnityEngine', className: 'Component', imageName: 'UnityEngine.CoreModule.dll', methodName: 'get_gameObject', argCount: 0 },
    gameObjectActiveSelf: { rva: 0x48f5220, namespace: 'UnityEngine', className: 'GameObject', imageName: 'UnityEngine.CoreModule.dll', methodName: 'get_activeSelf', argCount: 0 },
    gameObjectActiveInHierarchy: { rva: 0x48f5160, namespace: 'UnityEngine', className: 'GameObject', imageName: 'UnityEngine.CoreModule.dll', methodName: 'get_activeInHierarchy', argCount: 0 },
    tradingStashOffset: 0x108,
    slotListOffset: 0x78,
    slotIndexOffset: 0xa8,
    slotWaitingUidOffset: 0x108,
    slotCooldownEndOffset: 0x100,
    slotCacheOffset: 0x118,
    slotItemOffset: 0x30,
    downloadButtonBackgroundOffset: 0xe0,
    downloadButtonOffset: 0xe8,
    cacheSaveDataOffset: 0x20,
    saveDataItemUidOffset: 0x18
};
var FULL_BACKPACK_DEPOSIT_BRIDGE = {
    depositAll: { rva: 0x888450, className: 'ra', methodName: 'hyn', argCount: 2 },
    switchPage: {
        rva: 0xa4c2c0,
        namespace: 'TaskbarHero.UI',
        className: 'UI_RemakeStash',
        methodName: 'lpf',
        argCount: 1
    },
    singletonGetterRva: 0x29b0100,
    uiManagerSingletonArgumentRva: 0x5dd8a80,
    remakeStashOffset: 0xe8,
    currentPageOffset: 0xc0
};
var FULL_BACKPACK_DEPOSIT_BRIDGE_CURRENT = {
    depositAll: { rva: 0x91ae90, className: 'sj', methodName: 'itw', argCount: 2 },
    switchPage: {
        rva: 0xbeef30,
        namespace: 'TaskbarHero.UI',
        className: 'UI_RemakeStash',
        methodName: 'ocx',
        argCount: 1
    },
    currentPageOffset: 0xe8
};
var AUTO_BOSS_STAGE_BRIDGE = {
    cacheByKeyRva: 0x930070,
    validateEnterRva: 0x933840,
    enterStageRva: 0x933990,
    enterSceneRva: 0x9343f0
};
var AUTO_BOSS_STAGE_BRIDGE_CURRENT = {
    cacheByKey: null,
    validateEnter: { rva: 0xa536c0, className: 'xi', methodName: 'kxg', argCount: 1 },
    enterStage: { rva: 0xa53ab0, className: 'xi', methodName: 'kxi', argCount: 2 },
    validatePlague: { rva: 0xa53830, className: 'xi', methodName: 'kxh', argCount: 1 },
    returnScene: { rva: 0xa55010, className: 'xi', methodName: 'kxu', argCount: 2 }
};
var AUTO_BOSS_TARGETS = {
    torment: { itemKey: 190004, name: '折磨', stageKey: 4310, difficulty: 3, act: 3, stageNo: 10, stageType: 1 },
    tormentPlague: { itemKey: 190104, name: '瘟疫折磨', stageKey: 4319, difficulty: 3, act: 3, stageNo: 10, stageType: 3 },
    hell: { itemKey: 190003, name: '地狱', stageKey: 3310, difficulty: 2, act: 3, stageNo: 10, stageType: 1 },
    hellPlague: { itemKey: 190103, name: '瘟疫地狱', stageKey: 3319, difficulty: 2, act: 3, stageNo: 10, stageType: 3 },
    nightmare: { itemKey: 190002, name: '噩梦', stageKey: 2310, difficulty: 1, act: 3, stageNo: 10, stageType: 1 },
    nightmarePlague: { itemKey: 190102, name: '瘟疫噩梦', stageKey: 2319, difficulty: 1, act: 3, stageNo: 10, stageType: 3 },
    normal: { itemKey: 190001, name: '普通', stageKey: 1310, difficulty: 0, act: 3, stageNo: 10, stageType: 1 }
};
var AUTO_BOSS_TARGET_PRIORITY = [
    'torment', 'tormentPlague', 'hell', 'hellPlague',
    'nightmare', 'nightmarePlague', 'normal'
];
var ACT_BOSS_BOX_PREFIX = '93';
var STASH_PAGE_SIZE = 49;
var STASH_PAGE_COUNT = 7;
var STASH_SLOT_COUNT = STASH_PAGE_SIZE * STASH_PAGE_COUNT;

function stashTargetFromFlatIndex(flatIndex) {
    flatIndex = parseInt(flatIndex, 10);
    if (isNaN(flatIndex) || flatIndex < 0 || flatIndex >= STASH_SLOT_COUNT) return null;
    return {
        flatIndex: flatIndex,
        pageIndex: Math.floor(flatIndex / STASH_PAGE_SIZE),
        slotIndex: flatIndex % STASH_PAGE_SIZE
    };
}

function backpackCapacityState(capacity, occupied, known) {
    capacity = Math.max(0, parseInt(capacity, 10) || 0);
    occupied = Math.max(0, parseInt(occupied, 10) || 0);
    if (!known) return { free: null, full: false };
    return {
        free: Math.max(0, capacity - occupied),
        full: capacity > 0 && occupied >= capacity
    };
}

function nextStashPageWithSpace(freeByPage, startPage) {
    var page = Math.max(0, parseInt(startPage, 10) || 0);
    freeByPage = freeByPage || [];
    while (page < STASH_PAGE_COUNT && freeByPage[page] === 0) page++;
    return page;
}

var g_eventSystemUpdateInfo = ptr(0);
var g_eventSystemUpdatePtr = ptr(0);
var g_updateHooked = false;
var g_updateListener = null;
var g_directMethods = {};
var g_directPtrs = {};
var g_directFns = {};
var g_synthesisBridgeResolved = null;
var g_autoDepositBridgeResolved = null;
var g_moveResultCallback = ptr(0);
var g_moveResultCallbackLogAt = 0;
var g_autoTradeShipBridgeResolved = null;
var g_fullBackpackDepositBridgeResolved = null;
var g_stageBoxRightClickHandler = null;
var g_stageBoxRightClickBridgeReady = false;
var g_boxOpenInFlightContentType = 0;
var g_boxOpenInFlightInventoryBefore = null;
var g_boxLastRequestedInventoryBefore = null;
var g_boxResultTimer = null;
var g_boxResultPendingAdded = [];
var g_boxResultObservedInventoryAdded = [];
var g_boxLogCaptureUntil = 0;
var g_boxLogPendingAdded = [];
var g_boxLogSeenObjects = {};
var g_boxLogHistoryManager = ptr(0);
var g_boxLogHistoryManagerKey = '';
var g_boxLogHistoryIndex = -1;
var g_boxLogHistoryTail = '';
var g_boxLogHistoryTimer = null;
var g_boxLogHistoryResolveAt = 0;
var g_boxLogHistoryPollIntervalMs = 700;
var g_gameDropPreviewManagerClass = ptr(0);
var g_gameDropPreviewManagerFields = [];
var g_gameDropPreviewManagerSingletonField = ptr(0);
var g_gameDropPreviewManager = ptr(0);
var g_gameDropPreviewDiscoveryMode = 'uninitialized';
var g_gameDropPreviewFastClassName = '';
var g_gameDropPreviewResolveAt = 0;
var g_gameDropPreviewClassSearchFailedAt = 0;
var g_gameDropPreviewDiscovery = null;
var g_gameDropPreviewDiscoveryTimer = null;
var g_gameDropPreviewObscuredSearchFailedAt = 0;
var g_gameDropPreviewObscuredOffsets = null;
var g_gameDropPreviewContentTypeBridge = null;
var g_gameDropPreviewSpawnHooks = [];
var g_gameDropPreviewEnabled = false;
var g_gameDropPreviewSpawnSequence = 0;
var g_boxResultWindowMs = 15000;
var g_boxLootEventSequence = 0;
var g_autoBossStageBridgeResolved = null;
var g_eventEntryMethod = null;
var g_queue = [];
var g_boxPumpTimer = null;
var g_boxScanIntervalMs = 500;
var g_boxOpenDelayMs = 1000;
var g_backgroundTaskPauseMs = 0;
var g_boxSweepActive = false;
var g_boxLastRequestedCount = 0;
var g_boxLastRequestedAt = 0;
// Legacy config flag retained for migration only. Box opening now uses the
// game's verified right-click handler instead of the old direct StageBox RVA.
var g_allowUnsafeBoxOpen = false;
var g_boxNoInstanceRetryAt = 0;
var g_boxNoInstanceDiagnosticAt = 0;
var g_boxQueueRecoveryCount = 0;
var g_lastBoxQueueRecoveryLogAt = 0;
var g_lastBoxPumpAt = 0;
var g_boxPumpRestartCount = 0;
var g_lastBoxDiagnosticAt = 0;
var g_lastBoxDiagnosticSignature = '';
var g_autoBossEnabled = false;
var g_autoBossMinStones = 1;
var g_challengeTargets = null;
var g_mapSwitchMinimumIntervalMs = 10000;
var g_lastMapSwitchAt = 0;
var g_lastServerRequestAt = 0;
var g_serverRequestSpacingMs = 2000;
var g_autoPlagueMapEnabled = false;
var g_autoPlagueDifficulty = 3;
var g_autoPlagueStageNo = 1;
var g_autoPlagueCheckIntervalMs = 60000;
var g_autoPlagueNextCheckAt = 0;
var g_autoPlagueSwitchQueued = false;
var g_autoPlaguePortalCloseQueued = false;
var g_autoPlaguePortalCloseHandledStageKey = 0;
var g_autoPlaguePortalCloseAttempts = 0;
var g_autoPlagueAwaitingStage = null;
var g_autoPlagueManualConfirmTimer = null;
var g_autoPlagueLastResult = '';
var g_autoPlagueLastErrorAt = 0;
var g_autoPlagueCurrentStageReadError = '';
var g_autoPlagueLastPassPhase = '';
var g_autoPlaguePassCount = 0;
var g_bossAdmittedStoneTypes = {};
var g_eventAdmittedTicketTypes = {};
var g_autoHalloweenEventEnabled = false;
var g_eventDungeonContext = null;
var g_eventEntryQueued = false;
var g_eventEntryDispatching = false;
var g_eventEntryRetryAt = 0;
var g_eventLastResult = '';
var g_eventClearLogSeen = false;
var g_plagueDropSwitchPending = null;
var g_plagueManualWait = {stageKey:0, items:{}};
var g_plagueDropSwitchLastResult = '';
var EVENT_DUNGEON_TICKETS = [
    { itemKey: 170103, stageKey: 4901, name: '折磨' },
    { itemKey: 170102, stageKey: 3901, name: '地狱' },
    { itemKey: 170101, stageKey: 2901, name: '噩梦' }
];
var g_bossStageQueued = false;
var g_bossState = 'idle';
var g_bossBlockedBoxSignature = '';
var g_bossTarget = null;
var g_bossWaitStartedAt = 0;
var g_bossNextActionAt = 0;
var g_bossCompletedCount = 0;
var g_bossWaitTimeoutMs = 30000;
var g_bossBoxDrainStartedAt = 0;
var g_bossBoxDrainMaxWaitMs = 60000;
var g_bossBaselineItemBoxUids = {};
var g_bossBaselineSerializedBoxUids = {};
var g_bossBaselineSerializedBoxCount = 0;
var g_bossLastStoneCounts = emptyAutoBossStoneCounts();
var g_bossLastResult = '';
var g_bossNoStoneLogged = false;

function resolveDirect(kind) {
    kind = DIRECT[kind] ? kind : 'synthesis';
    var row = DIRECT[kind];
    if (!g_directMethods[kind] || g_directMethods[kind].isNull()) {
        var mi = findMethodInfo('', row.className, row.methodName, 0);
        if (!mi || mi.isNull()) mi = findMethodInfoByClassMethod('', row.className, row.methodName);
        if ((!mi || mi.isNull()) && row.rva) mi = findMethodInfoByRva(row.rva);
        g_directMethods[kind] = mi || ptr(0);
    }
    if (!g_directMethods[kind] || g_directMethods[kind].isNull()) {
        throw new Error('MethodInfo not found: ' + row.className + '.' + row.methodName + ' RVA=0x' + row.rva.toString(16));
    }
    if (!g_directPtrs[kind] || g_directPtrs[kind].isNull()) {
        var configuredPtr = B.add(row.rva);
        var resolvedPtr = methodPtr(g_directMethods[kind]);
        g_directPtrs[kind] = resolvedPtr;
        if (!g_directPtrs[kind] || g_directPtrs[kind].isNull()) g_directPtrs[kind] = configuredPtr;
    }
    if (!g_directFns[kind]) {
        // Windows x64 IL2CPP ABI: RCX=sret, RDX=MethodInfo for this static async method.
        g_directFns[kind] = new NativeFunction(g_directPtrs[kind], 'void', ['pointer', 'pointer']);
    }
    return { key: kind, row: row, mi: g_directMethods[kind], fn: g_directFns[kind], ptr: g_directPtrs[kind] };
}

function callDirect(kind) {
    var target = resolveDirect(kind);
    var retbuf = Memory.alloc(0x80);
    retbuf.writeByteArray(new Uint8Array(0x80));
    target.fn(retbuf, target.mi);
    var actualRva = target.ptr && !target.ptr.isNull() ? '0x' + target.ptr.sub(B).toString(16) : '0x' + target.row.rva.toString(16);
    log('已调用旧版' + target.row.friendly + '入口。');
    emit('auto_synthesis_called', {
        mode: target.key,
        methodName: target.row.methodName,
        rva: actualRva,
        runCount: g_runCount,
        batch: g_lastBatch
    });
    return 'called: ' + target.key;
}

function resolveCubeBridgeMethod(row) {
    var namespace = row.namespace || '';
    var className = row.className || 'Cube';
    var mi = findMethodInfo(namespace, className, row.methodName, row.argCount, row.imageName);
    if (!isBadPtr(mi) && row.argCount != null && il2cpp.methodGetParamCount(mi) !== row.argCount) mi = ptr(0);
    if (!mi || mi.isNull()) mi = findMethodInfoByClassMethod(namespace, className, row.methodName, row.argCount);
    if ((!mi || mi.isNull()) && row.methodName)
        mi = findMethodInfoByRuntimeClassMethod(className, row.methodName, row.argCount, row.rva);
    if ((!mi || mi.isNull()) && row.rva) mi = findMethodInfoByRva(row.rva);
    if (!mi || mi.isNull()) {
        throw new Error(className + '.' + row.methodName + ' not found; expected RVA=0x' + row.rva.toString(16));
    }
    var fp = methodPtr(mi);
    if (!fp || fp.isNull()) throw new Error(className + '.' + row.methodName + ' has no method pointer');
    if (row.argCount != null && il2cpp.methodGetParamCount(mi) !== row.argCount) {
        throw new Error(className + '.' + row.methodName + ' 签名不匹配：期望 ' + row.argCount + ' 个参数，实际 ' +
            il2cpp.methodGetParamCount(mi) + ' 个（' + cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi))) + '）');
    }
    var actualClass = il2cpp.methodGetClass(mi);
    if (!isBadPtr(actualClass) && cstr(il2cpp.classGetName(actualClass)) !== className)
        throw new Error(className + '.' + row.methodName + ' 类名不匹配：' + cstr(il2cpp.classGetName(actualClass)));
    if (namespace && !isBadPtr(actualClass) && cstr(il2cpp.classGetNamespace(actualClass)) !== namespace)
        throw new Error(className + '.' + row.methodName + ' 命名空间不匹配：' + cstr(il2cpp.classGetNamespace(actualClass)));
    var actualRva = fp.sub(B).toInt32() >>> 0;
    if (row.rva && actualRva !== (row.rva >>> 0)) {
        throw new Error('game version mismatch: ' + className + '.' + row.methodName +
            ' expected RVA=0x' + row.rva.toString(16) + ' actual=0x' + actualRva.toString(16));
    }
    return { row: row, mi: mi, ptr: fp };
}

function resolveSynthesisBridge() {
    if (g_synthesisBridgeResolved) return g_synthesisBridgeResolved;
    var profile = synthesisBridgeProfile();
    var slotCount = profile === SYNTHESIS_BRIDGE_CURRENT
        ? { mi: ptr(0), ptr: ptr(0), derived: true }
        : resolveCubeBridgeMethod(profile.slotCount);
    var selectRecipe = resolveCubeBridgeMethod(profile.selectRecipe);
    var selectSpecificRecipe = profile.selectSpecificRecipe ?
        resolveCubeBridgeMethod(profile.selectSpecificRecipe) : null;
    var selectSynthesisType = resolveCubeBridgeMethod(profile.selectSynthesisType);
    var reset = resolveCubeBridgeMethod(profile.reset);
    var addSlot = resolveCubeBridgeMethod(profile.addSlot);
    var executeBackend = resolveCubeBridgeMethod(profile.executeBackend);
    var triggerRecipe = profile.triggerRecipe ? resolveCubeBridgeMethod(profile.triggerRecipe) : null;
    var refreshRecipe = profile.refreshRecipe ? resolveCubeBridgeMethod(profile.refreshRecipe) : null;
    var busy = profile.busy ? resolveCubeBridgeMethod(profile.busy) : null;
    var getSlotItem = resolveCubeBridgeMethod(profile.getSlotItem);
    var getSlotList = profile.getSlotList ? resolveCubeBridgeMethod(profile.getSlotList) : null;
    var getSlotUid = profile.getSlotUid ? resolveCubeBridgeMethod(profile.getSlotUid) : null;
    var getItemUid = resolveCubeBridgeMethod(profile.getItemUid);
    var getItemTier = resolveCubeBridgeMethod(profile.getItemTier);
    if (profile === SYNTHESIS_BRIDGE_CURRENT) {
        verifyManagedMethodShape('Cube.jki', selectRecipe, 'System.Boolean', ['ERecipeType']);
        verifyManagedMethodShape('Cube.jkj', selectSpecificRecipe, 'System.Boolean', ['xp']);
        verifyManagedMethodShape('Cube.jjv', selectSynthesisType, 'System.Void', ['EItemSynthesisType']);
        verifyManagedMethodShape('Cube.joq', reset, 'System.Void', []);
        verifyManagedMethodShape('Cube.jmk', addSlot, 'EAddCubeResult', ['ESlotType', 'System.Int32']);
        verifyManagedMethodShape('Cube.jmw', executeBackend, 'Cysharp.Threading.Tasks.UniTask<System.Boolean>', []);
        verifyManagedMethodShape('Cube.jle', triggerRecipe, 'Cysharp.Threading.Tasks.UniTaskVoid', []);
        verifyManagedMethodShape('Cube.jku', refreshRecipe, 'System.Void', ['System.Int64']);
        verifyManagedMethodShape('Cube.jix', busy, 'System.Boolean', []);
        verifyManagedMethodShape('Cube.jio', getSlotList, 'IReadOnlyList', []);
        verifyManagedMethodShape('CubeInData.les', getSlotUid, 'System.UInt64', []);
        verifyManagedMethodShape('Cube.jml', getSlotItem, 'vs', ['ESlotType', 'System.Int32']);
        verifyManagedMethodShape('vs.jwl', getItemUid, 'System.UInt64', []);
        verifyManagedMethodShape('vs.jww', getItemTier, 'System.Int32', []);
    }
    var autoFillEventInvoke = null;
    if (profile === SYNTHESIS_BRIDGE_CURRENT) {
        try {
            autoFillEventInvoke = resolveCubeBridgeMethod(SYNTHESIS_AUTO_FILL_UI_CURRENT.unityEventInvoke);
            autoFillEventInvoke.fn = new NativeFunction(autoFillEventInvoke.ptr, 'void', ['pointer', 'pointer']);
        } catch (autoFillEventResolveError) {
            autoFillEventInvoke = null;
        }
    }
    if (profile === SYNTHESIS_BRIDGE_CURRENT) {
        slotCount.fn = function () {
            return g_synthesisBridgeResolved ? readCubeSlotUids(g_synthesisBridgeResolved).length : 0;
        };
    } else {
        slotCount.fn = new NativeFunction(slotCount.ptr, 'int', ['pointer']);
    }
    selectRecipe.fn = new NativeFunction(selectRecipe.ptr, 'bool', ['int', 'pointer']);
    if (selectSpecificRecipe) {
        selectSpecificRecipe.fn = new NativeFunction(selectSpecificRecipe.ptr,
            'bool', ['pointer', 'pointer']);
    }
    selectSynthesisType.fn = new NativeFunction(selectSynthesisType.ptr, 'void', ['int', 'pointer']);
    reset.fn = new NativeFunction(reset.ptr, 'void', ['pointer']);
    addSlot.fn = new NativeFunction(addSlot.ptr, 'int', ['int', 'int', 'pointer']);
    // Windows x64 IL2CPP ABI: RCX=sret, RDX=MethodInfo.
    executeBackend.fn = new NativeFunction(executeBackend.ptr, 'void', ['pointer', 'pointer']);
    if (refreshRecipe) refreshRecipe.fn = new NativeFunction(refreshRecipe.ptr, 'void', ['int64', 'pointer']);
    if (triggerRecipe) {
        if (cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(triggerRecipe.mi))) !==
                'Cysharp.Threading.Tasks.UniTaskVoid' || il2cpp.methodGetParamCount(triggerRecipe.mi) !== 0)
            throw new Error('魔方完整执行入口签名版本校验失败');
        // UniTaskVoid has no result to retain. The game owns the awaited backend
        // task and its finally block, including Cube.busy and UI effect teardown.
        triggerRecipe.fn = new NativeFunction(triggerRecipe.ptr, 'void', ['pointer']);
    }
    if (busy) busy.fn = new NativeFunction(busy.ptr, 'bool', ['pointer']);
    getSlotItem.fn = new NativeFunction(getSlotItem.ptr, 'pointer', ['int', 'int', 'pointer']);
    if (getSlotList) getSlotList.fn = new NativeFunction(getSlotList.ptr, 'pointer', ['pointer']);
    if (getSlotUid) getSlotUid.fn = new NativeFunction(getSlotUid.ptr, 'uint64', ['pointer', 'pointer']);
    getItemUid.fn = new NativeFunction(getItemUid.ptr, 'uint64', ['pointer', 'pointer']);
    getItemTier.fn = new NativeFunction(getItemTier.ptr, 'int', ['pointer', 'pointer']);
    g_synthesisBridgeResolved = {
        slotCount: slotCount,
        selectRecipe: selectRecipe,
        selectSpecificRecipe: selectSpecificRecipe,
        selectSynthesisType: selectSynthesisType,
        reset: reset,
        addSlot: addSlot,
        executeBackend: executeBackend,
        triggerRecipe: triggerRecipe,
        refreshRecipe: refreshRecipe,
        busy: busy,
        getSlotItem: getSlotItem,
        getSlotList: getSlotList,
        getSlotUid: getSlotUid,
        getItemUid: getItemUid,
        getItemTier: getItemTier,
        autoFillEventInvoke: autoFillEventInvoke,
        current: profile === SYNTHESIS_BRIDGE_CURRENT
    };
    return g_synthesisBridgeResolved;
}

function synthesisSlotState(bridge) {
    bridge = bridge || resolveSynthesisBridge();
    var activeCount = bridge.slotCount.fn(bridge.slotCount.mi) | 0;
    return {
        backingCount: activeCount,
        objectCount: activeCount,
        activeCount: activeCount,
        emptyCount: Math.max(0, 9 - activeCount),
        busy: false
    };
}

function readCubeSlotUids(bridge) {
    if (!bridge.getSlotList || !bridge.getSlotUid) return null;
    var list = bridge.getSlotList.fn(bridge.getSlotList.mi);
    if (isBadPtr(list)) throw new Error('无法读取合成槽列表');
    var array = list.add(0x10).readPointer();
    var count = list.add(0x18).readS32();
    if (isBadPtr(array) || count !== 9) throw new Error('合成槽结构已变化，槽位数=' + count);
    var uids = [];
    for (var i = 0; i < count; i++) {
        var slot = array.add(0x20 + i * Process.pointerSize).readPointer();
        if (isBadPtr(slot)) throw new Error('合成槽 ' + i + ' 无效');
        var uid = nativeU64Text(bridge.getSlotUid.fn(slot, bridge.getSlotUid.mi));
        if (uid && uid !== '0') uids.push(uid);
    }
    return uids;
}

function verifyCubeSlotUids(bridge, expected, label) {
    var actual = readCubeSlotUids(bridge);
    if (actual === null) return;
    var wanted = expected.map(function (row) { return String(row.uid); });
    actual.sort();
    wanted.sort();
    if (actual.length !== wanted.length || actual.some(function (uid, index) { return uid !== wanted[index]; })) {
        throw new Error(label + '合成槽物品与所选批次不一致：实际=' + actual.join(',') +
            '，预期=' + wanted.join(','));
    }
}

function resolveAutoDepositBridge() {
    if (g_autoDepositBridgeResolved) return g_autoDepositBridgeResolved;
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        var moveRequest = resolveCubeBridgeMethod(AUTO_DEPOSIT_BRIDGE_CURRENT.moveRequest);
        verifyManagedMethodShape('sj.iti', moveRequest, 'System.Void',
            ['TaskbarHero.MoveRequest', 'System.Action<TaskbarHero.MoveResult>']);
        // The game stores stash slots in PlayerSaveData; derive the first free
        // flat index from the verified inventory snapshot rather than calling
        // the old Stash helper, whose signature changed in the current build.
        var currentEmpty = {derived:true, ptr:ptr(0), mi:ptr(0), fn:function () {
            var counts = g_lastSourceCounts || {};
            var index = Number(counts.firstEmptyStashIndex);
            return Number.isInteger(index) ? index : -1;
        }};
        var currentPage = {derived:true, ptr:ptr(0), mi:ptr(0), fn:function (index) {
            index = Number(index);
            return Number.isInteger(index) && index >= 0 && index < STASH_SLOT_COUNT
                ? Math.floor(index / STASH_PAGE_SIZE) : -1;
        }};
        // MoveRequest is a 24-byte value struct, passed by pointer in the Windows x64 ABI.
        moveRequest.fn = new NativeFunction(moveRequest.ptr, 'void',
            ['pointer', 'pointer', 'pointer', 'pointer']);
        g_autoDepositBridgeResolved = {
            current: true,
            firstEmptyIndex: currentEmpty,
            pageFromIndex: currentPage,
            moveRequest: moveRequest
        };
        depositLog('自动存仓移动请求已通过当前游戏构建校验。');
        return g_autoDepositBridgeResolved;
    }
    var firstEmptyIndex = resolveCubeBridgeMethod(AUTO_DEPOSIT_BRIDGE.firstEmptyIndex);
    var pageFromIndex = resolveCubeBridgeMethod(AUTO_DEPOSIT_BRIDGE.pageFromIndex);
    var addToPage = resolveCubeBridgeMethod(AUTO_DEPOSIT_BRIDGE.addToPage);
    var removeFromInventory = resolveCubeBridgeMethod(AUTO_DEPOSIT_BRIDGE.removeFromInventory);
    firstEmptyIndex.fn = new NativeFunction(firstEmptyIndex.ptr, 'int', ['pointer']);
    pageFromIndex.fn = new NativeFunction(pageFromIndex.ptr, 'int', ['int', 'pointer']);
    addToPage.fn = new NativeFunction(addToPage.ptr, 'bool', ['int', 'uint64', 'pointer']);
    removeFromInventory.fn = new NativeFunction(removeFromInventory.ptr, 'bool', ['uint64', 'pointer']);
    g_autoDepositBridgeResolved = {
        firstEmptyIndex: firstEmptyIndex,
        pageFromIndex: pageFromIndex,
        addToPage: addToPage,
        removeFromInventory: removeFromInventory
    };
    depositLog('原生自动存仓链路已解析并完成版本校验。');
    return g_autoDepositBridgeResolved;
}

function resolveAutoTradeShipBridge() {
    if (g_autoTradeShipBridgeResolved) return g_autoTradeShipBridgeResolved;
    var moveDirect = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.moveDirect);
    var firstAvailableSlot = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.firstAvailableSlot);
    var validSlotCount = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.validSlotCount);
    var cacheForSlot = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cacheForSlot);
    var cacheOccupied = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cacheOccupied);
    var waitingContains = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.waitingContains);
    var downloadBlocked = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.downloadBlocked);
    var uploadButton = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.uploadButton);
    var confirmButton = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.confirmButton);
    var getSlot = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.getSlot);
    var cooldownActive = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cooldownActive);
    var cooldownEndForSlot = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cooldownEndForSlot);
    var cooldownSyncRequest = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cooldownSyncRequest);
    var cooldownSyncCallback = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.cooldownSyncCallback);
    var applyCooldown = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.applyCooldown);
    var pointerEnter = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.pointerEnter);
    var pointerExit = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.pointerExit);
    var downloadListener = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.downloadListener);
    var buttonPress = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.buttonPress);
    var gameObjectActiveSelf = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.gameObjectActiveSelf);
    var componentGameObject = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.componentGameObject);
    var gameObjectActiveInHierarchy = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.gameObjectActiveInHierarchy);
    var unityEventInvoke = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.unityEventInvoke);
    var dateTimeGreaterThan = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.dateTimeGreaterThan);
    var serverTime = resolveCubeBridgeMethod(AUTO_TRADE_SHIP_BRIDGE.serverTime);
    moveDirect.fn = new NativeFunction(
        moveDirect.ptr,
        'void',
        ['pointer', 'int', 'int', 'pointer', 'int', 'pointer']
    );
    firstAvailableSlot.fn = new NativeFunction(firstAvailableSlot.ptr, 'int', ['pointer']);
    validSlotCount.fn = new NativeFunction(validSlotCount.ptr, 'int', ['pointer']);
    cacheForSlot.fn = new NativeFunction(cacheForSlot.ptr, 'pointer', ['int', 'pointer']);
    cacheOccupied.fn = new NativeFunction(cacheOccupied.ptr, 'bool', ['pointer', 'pointer']);
    waitingContains.fn = new NativeFunction(waitingContains.ptr, 'bool', ['uint64', 'pointer']);
    downloadBlocked.fn = new NativeFunction(downloadBlocked.ptr, 'bool', ['uint64', 'pointer']);
    uploadButton.fn = new NativeFunction(uploadButton.ptr, 'void', ['pointer', 'pointer']);
    confirmButton.fn = new NativeFunction(confirmButton.ptr, 'void', ['pointer', 'pointer']);
    getSlot.fn = new NativeFunction(getSlot.ptr, 'pointer', ['pointer', 'int', 'pointer']);
    cooldownActive.fn = new NativeFunction(cooldownActive.ptr, 'bool', ['pointer', 'pointer']);
    cooldownEndForSlot.fn = new NativeFunction(
        cooldownEndForSlot.ptr,
        'bool',
        ['int', 'pointer', 'pointer']
    );
    cooldownSyncRequest.fn = new NativeFunction(cooldownSyncRequest.ptr, 'void', ['pointer', 'pointer']);
    applyCooldown.fn = new NativeFunction(applyCooldown.ptr, 'void', ['pointer', 'uint64', 'pointer']);
    pointerEnter.fn = new NativeFunction(pointerEnter.ptr, 'void', ['pointer', 'pointer', 'pointer']);
    pointerExit.fn = new NativeFunction(pointerExit.ptr, 'void', ['pointer', 'pointer', 'pointer']);
    buttonPress.fn = new NativeFunction(buttonPress.ptr, 'void', ['pointer', 'pointer']);
    gameObjectActiveSelf.fn = new NativeFunction(gameObjectActiveSelf.ptr, 'bool', ['pointer', 'pointer']);
    componentGameObject.fn = new NativeFunction(componentGameObject.ptr, 'pointer', ['pointer', 'pointer']);
    gameObjectActiveInHierarchy.fn = new NativeFunction(
        gameObjectActiveInHierarchy.ptr,
        'bool',
        ['pointer', 'pointer']
    );
    unityEventInvoke.fn = new NativeFunction(unityEventInvoke.ptr, 'void', ['pointer', 'pointer']);
    dateTimeGreaterThan.fn = new NativeFunction(
        dateTimeGreaterThan.ptr,
        'bool',
        ['uint64', 'uint64', 'pointer']
    );
    serverTime.fn = new NativeFunction(serverTime.ptr, 'uint64', ['pointer', 'pointer']);
    var singletonGetterPtr = B.add(AUTO_TRADE_SHIP_BRIDGE.singletonGetterRva);
    g_autoTradeShipBridgeResolved = {
        moveDirect: moveDirect,
        firstAvailableSlot: firstAvailableSlot,
        validSlotCount: validSlotCount,
        cacheForSlot: cacheForSlot,
        cacheOccupied: cacheOccupied,
        waitingContains: waitingContains,
        downloadBlocked: downloadBlocked,
        uploadButton: uploadButton,
        confirmButton: confirmButton,
        getSlot: getSlot,
        cooldownActive: cooldownActive,
        cooldownEndForSlot: cooldownEndForSlot,
        cooldownSyncRequest: cooldownSyncRequest,
        cooldownSyncCallback: cooldownSyncCallback,
        applyCooldown: applyCooldown,
        pointerEnter: pointerEnter,
        pointerExit: pointerExit,
        downloadListener: downloadListener,
        buttonPress: buttonPress,
        gameObjectActiveSelf: gameObjectActiveSelf,
        componentGameObject: componentGameObject,
        gameObjectActiveInHierarchy: gameObjectActiveInHierarchy,
        unityEventInvoke: unityEventInvoke,
        dateTimeGreaterThan: dateTimeGreaterThan,
        serverTime: serverTime,
        singletonGetter: {
            ptr: singletonGetterPtr,
            fn: new NativeFunction(singletonGetterPtr, 'pointer', ['pointer'])
        },
        objectNew: new NativeFunction(B.add(AUTO_TRADE_SHIP_BRIDGE.objectNewRva), 'pointer', ['pointer']),
        objectCtor: new NativeFunction(B.add(AUTO_TRADE_SHIP_BRIDGE.objectCtorRva), 'void', ['pointer', 'pointer']),
        writeBarrier: new NativeFunction(B.add(AUTO_TRADE_SHIP_BRIDGE.writeBarrierRva), 'void', ['pointer', 'pointer']),
        delegateCtor: new NativeFunction(
            B.add(AUTO_TRADE_SHIP_BRIDGE.delegateCtorRva),
            'void',
            ['pointer', 'pointer', 'pointer', 'pointer']
        ),
        gchandleNew: api('il2cpp_gchandle_new', 'uint', ['pointer', 'bool']),
        gchandleFree: api('il2cpp_gchandle_free', 'void', ['uint'])
    };
    return g_autoTradeShipBridgeResolved;
}

function findTradeShipMoveManager() {
    var info = classInfo('', 'ra');
    if (!info.klass || info.klass.isNull()) return ptr(0);
    return findStaticSingleton(info.klass, 'ra');
}

function findTradingStashUi(bridge) {
    bridge = bridge || resolveAutoTradeShipBridge();
    var uiManagerInfo = classInfo('TaskbarHero', 'UIManager');
    var uiManager = ptr(0);
    if (uiManagerInfo.klass && !uiManagerInfo.klass.isNull()) {
        uiManager = findStaticSingleton(uiManagerInfo.klass, 'TaskbarHero.UIManager');
    }
    if (isObviouslyInvalidPtr(uiManager)) {
        var singletonArgument = B.add(
            AUTO_TRADE_SHIP_BRIDGE.uiManagerSingletonArgumentRva
        ).readPointer();
        if (!isObviouslyInvalidPtr(singletonArgument)) {
            uiManager = bridge.singletonGetter.fn(singletonArgument);
        }
    }
    if (isObviouslyInvalidPtr(uiManager)) throw new Error('当前场景尚未创建交易船界面管理器');
    var tradingStash = uiManager.add(AUTO_TRADE_SHIP_BRIDGE.tradingStashOffset).readPointer();
    if (isObviouslyInvalidPtr(tradingStash)) throw new Error('当前场景尚未创建交易船界面实例');
    var typeName = managedType(tradingStash);
    if (typeName && typeName !== 'TaskbarHero.UI.UI_TradingStash') {
        throw new Error('交易船界面实例类型校验失败');
    }
    return tradingStash;
}

function sameNativePointer(a, b) {
    if (isObviouslyInvalidPtr(a) || isObviouslyInvalidPtr(b)) return false;
    return String(a) === String(b);
}

function tradeShipCacheUnlocked(cache) {
    if (isObviouslyInvalidPtr(cache)) return false;
    var saveData = ptr(0);
    try { saveData = cache.add(AUTO_TRADE_SHIP_BRIDGE.cacheSaveDataOffset).readPointer(); }
    catch (e) { return false; }
    if (isObviouslyInvalidPtr(saveData)) return false;
    try { return saveData.add(AUTO_TRADE_SHIP_BRIDGE.saveDataUnlockedOffset).readU8() !== 0; }
    catch (e2) { return false; }
}

function tradeShipSlotListInfo(bridge, tradingStash) {
    tradingStash = tradingStash || findTradingStashUi();
    var list = tradingStash.add(AUTO_TRADE_SHIP_BRIDGE.slotListOffset).readPointer();
    if (isObviouslyInvalidPtr(list)) throw new Error('交易船槽位列表尚未初始化');
    var rawListCount = list.add(AUTO_TRADE_SHIP_BRIDGE.managedListCountOffset).readS32();
    if (rawListCount < 0 || rawListCount > 64) throw new Error('交易船槽位列表数量异常');
    var items = list.add(AUTO_TRADE_SHIP_BRIDGE.managedListItemsOffset).readPointer();
    if (rawListCount > 0 && isObviouslyInvalidPtr(items)) throw new Error('交易船槽位列表数组无效');
    var validSlotCount = bridge.validSlotCount.fn(bridge.validSlotCount.mi) | 0;
    if (validSlotCount < 0 || validSlotCount > rawListCount) {
        throw new Error('游戏原生有效交易船槽位数与界面列表不一致');
    }
    return {
        ui: tradingStash,
        list: list,
        items: items,
        rawListCount: rawListCount,
        validSlotCount: validSlotCount,
        excludedTemplateCount: rawListCount - validSlotCount
    };
}

function strictTradingStashSlotBindingAt(bridge, listInfo, index) {
    index = index | 0;
    if (index < 0 || index >= listInfo.validSlotCount) return null;
    var slot = listInfo.items.add(
        AUTO_TRADE_SHIP_BRIDGE.managedArrayItemsOffset + index * PTR
    ).readPointer();
    if (isObviouslyInvalidPtr(slot)) throw new Error('有效交易船槽位对象为空：第 ' + (index + 1) + ' 格');
    var nativeSlot = bridge.getSlot.fn(listInfo.ui, index, bridge.getSlot.mi);
    if (!sameNativePointer(slot, nativeSlot)) {
        throw new Error('交易船槽位列表与游戏原生取槽结果不一致：第 ' + (index + 1) + ' 格');
    }
    var slotIndex = slot.add(AUTO_TRADE_SHIP_BRIDGE.slotIndexOffset).readS32();
    if (slotIndex !== index) throw new Error('交易船槽位索引绑定错误：第 ' + (index + 1) + ' 格');
    var cache = authoritativeTradeShipCache(bridge, index);
    if (isObviouslyInvalidPtr(cache)) throw new Error('交易船权威缓存为空：第 ' + (index + 1) + ' 格');
    var slotCache = slot.add(AUTO_TRADE_SHIP_BRIDGE.slotCacheOffset).readPointer();
    if (!sameNativePointer(slotCache, cache)) {
        throw new Error('交易船槽位缓存与权威缓存不一致：第 ' + (index + 1) + ' 格');
    }
    var slotItem = slot.add(AUTO_TRADE_SHIP_BRIDGE.slotItemOffset).readPointer();
    if (!sameNativePointer(slotItem, cache)) {
        throw new Error('交易船槽位物品引用与权威缓存不一致：第 ' + (index + 1) + ' 格');
    }
    if (!tradeShipCacheUnlocked(cache)) {
        throw new Error('游戏原生有效槽位未处于解锁状态：第 ' + (index + 1) + ' 格');
    }
    return {
        ui: listInfo.ui,
        slot: slot,
        index: index,
        cache: cache,
        slotItem: slotItem,
        rawListCount: listInfo.rawListCount,
        validSlotCount: listInfo.validSlotCount,
        excludedTemplateCount: listInfo.excludedTemplateCount
    };
}

function listTradingStashSlotBindings(bridge, tradingStash) {
    var info = tradeShipSlotListInfo(bridge, tradingStash);
    var result = [];
    for (var i = 0; i < info.validSlotCount; i++) {
        result.push(strictTradingStashSlotBindingAt(bridge, info, i));
    }
    result.rawListCount = info.rawListCount;
    result.validSlotCount = info.validSlotCount;
    result.excludedTemplateCount = info.excludedTemplateCount;
    return result;
}

function findTradingStashSlotBinding(bridge, uid, preferredIndex) {
    uid = String(uid || '');
    var bindings = listTradingStashSlotBindings(bridge);
    if (preferredIndex != null && preferredIndex >= 0) {
        for (var preferred = 0; preferred < bindings.length; preferred++) {
            if (bindings[preferred].index !== (preferredIndex | 0)) continue;
            var preferredUid = readU64Text(
                bindings[preferred].slot.add(AUTO_TRADE_SHIP_BRIDGE.slotWaitingUidOffset)
            );
            if (preferredUid === uid) return bindings[preferred];
            break;
        }
    }
    for (var i = 0; i < bindings.length; i++) {
        var slotUid = readU64Text(
            bindings[i].slot.add(AUTO_TRADE_SHIP_BRIDGE.slotWaitingUidOffset)
        );
        if (slotUid === uid) return bindings[i];
    }
    return null;
}

function findTradingStashSlotBindingByIndex(bridge, index) {
    index = index | 0;
    if (index < 0) return null;
    var bindings = listTradingStashSlotBindings(bridge);
    for (var i = 0; i < bindings.length; i++) {
        if (bindings[i].index === index) return bindings[i];
    }
    return null;
}

function authoritativeTradeShipCache(bridge, index) {
    try {
        var cache = bridge.cacheForSlot.fn(index | 0, bridge.cacheForSlot.mi);
        if (isObviouslyInvalidPtr(cache)) return ptr(0);
        var typeName = managedType(cache);
        if (typeName && typeName !== 'TaskbarHero.TradingStashCache') return ptr(0);
        return cache;
    } catch (e) {
        return ptr(0);
    }
}

function tradeShipSlotCache(slot) {
    var cache = ptr(0);
    try { cache = slot.add(AUTO_TRADE_SHIP_BRIDGE.slotCacheOffset).readPointer(); } catch (e) {}
    return cache;
}

function resolveFullBackpackDepositBridge() {
    if (g_fullBackpackDepositBridgeResolved) return g_fullBackpackDepositBridgeResolved;
    var profile = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT
        ? FULL_BACKPACK_DEPOSIT_BRIDGE_CURRENT : FULL_BACKPACK_DEPOSIT_BRIDGE;
    var depositAll = resolveCubeBridgeMethod(profile.depositAll);
    var switchPage = resolveCubeBridgeMethod(profile.switchPage);
    if (profile === FULL_BACKPACK_DEPOSIT_BRIDGE_CURRENT) {
        verifyManagedMethodShape('sj.itw', depositAll, 'System.Void', ['ESlotType', 'ESlotType']);
        verifyManagedMethodShape('UI_RemakeStash.ocx', switchPage, 'System.Void', ['System.Int32']);
        var stashInfo = classInfo('TaskbarHero.UI', 'UI_RemakeStash');
        if (stashInfo.fields.bkox !== profile.currentPageOffset || stashInfo.fieldTypes.bkox !== 'System.Int32')
            throw new Error('仓库当前页字段与当前游戏构建不符');
    }
    depositAll.fn = new NativeFunction(depositAll.ptr, 'void', ['pointer', 'int', 'int', 'pointer']);
    switchPage.fn = new NativeFunction(switchPage.ptr, 'void', ['pointer', 'int', 'pointer']);
    g_fullBackpackDepositBridgeResolved = {
        depositAll: depositAll,
        switchPage: switchPage,
        current: profile === FULL_BACKPACK_DEPOSIT_BRIDGE_CURRENT,
        currentPageOffset: profile.currentPageOffset
    };
    if (!g_fullBackpackDepositBridgeResolved.current) {
        var singletonGetterPtr = B.add(profile.singletonGetterRva);
        g_fullBackpackDepositBridgeResolved.singletonGetter = {
            ptr: singletonGetterPtr,
            fn: new NativeFunction(singletonGetterPtr, 'pointer', ['pointer'])
        };
    }
    return g_fullBackpackDepositBridgeResolved;
}

function runtimeInstanceFieldOffset(runtimeClass, fieldName) {
    var current = runtimeClass;
    for (var depth = 0; depth < 12 && current && !current.isNull(); depth++) {
        var fields = runtimeClassFields(current).fields;
        if (fields[fieldName] != null) return fields[fieldName];
        current = il2cpp.classGetParent(current);
    }
    return null;
}

function resolveSynthesisCubeUi(profile) {
    profile = profile || SYNTHESIS_AUTO_FILL_UI_CURRENT;
    requireCurrentGameBuild();
    var managerInfo = classInfo(profile.managerNamespace, profile.managerClassName);
    var managerOffset = managerInfo.fields[profile.managerCubeFieldName];
    if (managerOffset == null || managerOffset !== profile.managerCubeFieldOffset ||
            managerInfo.fieldTypes[profile.managerCubeFieldName] !== 'TaskbarHero.UI.UI_Cube') {
        throw new Error('UIManager 合成界面字段与已验证版本不符');
    }
    var manager = findStaticSingleton(managerInfo.klass, 'TaskbarHero.UIManager');
    if (isBadPtr(manager)) throw new Error('游戏尚未初始化合成界面管理器');
    var cubeUi = manager.add(managerOffset).readPointer();
    if (isBadPtr(cubeUi) || managedType(cubeUi) !== 'TaskbarHero.UI.UI_Cube') {
        throw new Error('UIManager 中没有有效的合成界面实例');
    }
    return cubeUi;
}

function resolveSynthesisAutoFillClickEvent() {
    var profile = SYNTHESIS_AUTO_FILL_UI_CURRENT;
    var cubeUi = resolveSynthesisCubeUi(profile);
    var cubeClass = il2cpp.objectGetClass(cubeUi);
    var autofillOffset = runtimeInstanceFieldOffset(cubeClass, profile.cubeAutoFillFieldName);
    if (autofillOffset == null || autofillOffset !== profile.cubeAutoFillFieldOffset) {
        throw new Error('合成器自动填充按钮字段与已验证版本不符');
    }
    var autofillButton = cubeUi.add(autofillOffset).readPointer();
    if (isBadPtr(autofillButton) || managedType(autofillButton) !== 'TaskbarHero.UI.CubeSynthesisAutoFillButton') {
        throw new Error('游戏合成自动填充按钮尚未初始化');
    }
    var buttonClass = il2cpp.objectGetClass(autofillButton);
    var buttonOffset = runtimeInstanceFieldOffset(buttonClass, profile.baseButtonFieldName);
    if (buttonOffset == null || buttonOffset !== profile.baseButtonFieldOffset) {
        throw new Error('合成自动填充按钮的 Unity Button 字段与已验证版本不符');
    }
    var unityButton = autofillButton.add(buttonOffset).readPointer();
    if (isBadPtr(unityButton) || managedType(unityButton) !== 'UnityEngine.UI.Button') {
        throw new Error('合成自动填充按钮未绑定 Unity Button');
    }
    var unityButtonClass = il2cpp.objectGetClass(unityButton);
    var clickOffset = runtimeInstanceFieldOffset(unityButtonClass, profile.clickEventFieldName);
    if (clickOffset == null || clickOffset !== profile.clickEventFieldOffset) {
        throw new Error('自动填充按钮点击事件字段与已验证版本不符');
    }
    var clickEvent = unityButton.add(clickOffset).readPointer();
    if (isBadPtr(clickEvent)) throw new Error('自动填充按钮点击事件尚未初始化');
    return clickEvent;
}

function syncSynthesisFixedLevelToggle() {
    var profile = SYNTHESIS_AUTO_FILL_UI_CURRENT;
    var cubeUi = resolveSynthesisCubeUi(profile);
    var cubeClass = il2cpp.objectGetClass(cubeUi);
    var toggleOffset = runtimeInstanceFieldOffset(cubeClass, profile.cubeFixedLevelToggleFieldName);
    if (toggleOffset == null || toggleOffset !== profile.cubeFixedLevelToggleFieldOffset) {
        throw new Error('合成器固定等级控件字段与已验证版本不符');
    }
    var toggleField = runtimeClassFields(cubeClass).fieldInfos[profile.cubeFixedLevelToggleFieldName];
    if (!toggleField || cstr(il2cpp.typeGetName(il2cpp.fieldGetType(toggleField))) !==
            profile.cubeFixedLevelToggleFieldType) {
        throw new Error('合成器固定等级控件类型与已验证版本不符');
    }
    var toggle = cubeUi.add(toggleOffset).readPointer();
    if (isBadPtr(toggle) || managedType(toggle) !== profile.cubeFixedLevelToggleFieldType) {
        throw new Error('合成器固定等级控件尚未初始化');
    }
    var toggleClass = il2cpp.objectGetClass(toggle);
    var getter = il2cpp.classGetMethod(toggleClass,
        Memory.allocUtf8String(profile.fixedLevelGetterMethodName), 0);
    var setter = il2cpp.classGetMethod(toggleClass,
        Memory.allocUtf8String(profile.fixedLevelSetterMethodName), 1);
    if (isBadPtr(getter) || isBadPtr(setter) || il2cpp.methodGetParamCount(getter) !== 0 ||
            il2cpp.methodGetParamCount(setter) !== 1 ||
            cstr(il2cpp.methodGetName(getter)) !== profile.fixedLevelGetterMethodName ||
            cstr(il2cpp.methodGetName(setter)) !== profile.fixedLevelSetterMethodName ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(getter))) !== 'System.Boolean' ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(setter))) !== 'System.Void' ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetParam(setter, 0))) !== 'System.Boolean') {
        throw new Error('合成器固定等级控件状态接口与已验证版本不符');
    }
    var current;
    var desired = g_sameLevelSynthesis === true;
    var stage = '读取当前状态';
    try {
        current = !!new NativeFunction(methodPtr(getter), 'uint8', ['pointer', 'pointer'])(toggle, getter);
        if (current !== desired) {
            stage = '写入目标状态';
            new NativeFunction(methodPtr(setter), 'void', ['pointer', 'uint8', 'pointer'])(
                toggle, desired ? 1 : 0, setter
            );
            stage = '复核目标状态';
            var verified = !!new NativeFunction(methodPtr(getter), 'uint8', ['pointer', 'pointer'])(toggle, getter);
            if (verified !== desired) throw new Error('状态同步后复核失败');
        }
    } catch (e) {
        throw new Error('固定等级同步' + stage + '失败：' +
            (typeof chineseError === 'function' ? chineseError(e) : String(e)));
    }
    return { enabled: desired, changed: current !== desired };
}

function findRemakeStashUi(bridge) {
    var uiManager = ptr(0);
    var uiManagerInfo = classInfo('TaskbarHero', 'UIManager');
    if (uiManagerInfo.klass && !uiManagerInfo.klass.isNull()) {
        uiManager = findStaticSingleton(uiManagerInfo.klass, 'TaskbarHero.UIManager');
    }
    if (isObviouslyInvalidPtr(uiManager) && !bridge.current) {
        var singletonArgument = B.add(
            FULL_BACKPACK_DEPOSIT_BRIDGE.uiManagerSingletonArgumentRva
        ).readPointer();
        if (!isObviouslyInvalidPtr(singletonArgument)) {
            uiManager = bridge.singletonGetter.fn(singletonArgument);
        }
    }
    if (isObviouslyInvalidPtr(uiManager)) throw new Error('当前场景尚未创建仓库界面管理器');
    var stashOffset = bridge.current ? uiManagerInfo.fields.Ui_NewStash :
        FULL_BACKPACK_DEPOSIT_BRIDGE.remakeStashOffset;
    if (stashOffset == null) throw new Error('仓库界面字段未找到');
    var remakeStash = uiManager.add(stashOffset).readPointer();
    if (isObviouslyInvalidPtr(remakeStash)) throw new Error('当前场景尚未创建仓库界面实例');
    var typeName = managedType(remakeStash);
    if (typeName && typeName !== 'TaskbarHero.UI.UI_RemakeStash') {
        throw new Error('仓库界面实例类型校验失败');
    }
    return remakeStash;
}


function createNativeMoveRequest(source, targetSlotType, targetIndex, moveType) {
    if (!source) throw new Error('MoveRequest 来源槽位为空');
    var sourceType = Number(source.slotType);
    var sourceIndex = Number(source.index);
    targetSlotType = Number(targetSlotType);
    targetIndex = Number(targetIndex);
    moveType = Number(moveType);
    var values = [sourceType, sourceIndex, targetSlotType, targetIndex, moveType];
    if (values.some(function (value) {
        return !isFinite(value) || Math.floor(value) !== value;
    })) {
        throw new Error('MoveRequest 槽位字段无效：' + JSON.stringify(values));
    }
    // MoveRequest.ivn() rejects MoveQuantity <= 0. A zero quantity reached
    // sj.iti in earlier builds and surfaced as a native "system error".
    var quantity = Math.max(1, parseInt(source.quantity, 10) || 1);
    var request = Memory.alloc(24);
    request.writeS32(sourceType);
    request.add(4).writeS32(sourceIndex);
    request.add(8).writeS32(targetSlotType);
    request.add(12).writeS32(targetIndex);
    request.add(16).writeS32(moveType);
    request.add(20).writeS32(quantity);
    return request;
}

function resolveMoveResultCallback() {
    var expectedType = 'System.Action<TaskbarHero.MoveResult>';
    var image=imageByName('Assembly-CSharp.dll'),closureClass=ptr(0);
    var count=api('il2cpp_image_get_class_count','int',['pointer'])(image);
    var getClass=api('il2cpp_image_get_class','pointer',['pointer','int']);
    for(var ci=0;ci<count;ci++) {
        var candidate=getClass(image,ci);
        if(!isBadPtr(candidate) && cstr(il2cpp.classGetName(candidate))==='<>c' &&
                cstr(il2cpp.typeGetName(il2cpp.classGetType(candidate)))==='sj.<>c') {closureClass=candidate;break;}
    }
    if(isBadPtr(closureClass)) throw new Error('sj 原生移动回调类型未找到');
    var fields=runtimeClassFields(closureClass),field=fields.fieldInfos['<>9__19_0'];
    if(!field || cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)))!==expectedType)
        throw new Error('sj 移动结果委托字段签名不匹配');
    var delegateClass=api('il2cpp_class_from_type','pointer',['pointer'])(il2cpp.fieldGetType(field));
    function validCallback(callback) {
        try {
            if(isBadPtr(callback) || !sameNativePointer(callback.readPointer(),delegateClass)) return false;
            var invoke=callback.add(0x18).readPointer(),range=Process.findRangeByAddress(invoke);
            return !!range && range.protection.indexOf('x')>=0;
        } catch(error) { return false; }
    }
    if(validCallback(g_moveResultCallback)) return g_moveResultCallback;
    api('il2cpp_runtime_class_init','void',['pointer'])(closureClass);
    var storage=Memory.alloc(PTR);storage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(field,storage);
    g_moveResultCallback=storage.readPointer();
    if(!validCallback(g_moveResultCallback)) {
        var targetField=fields.fieldInfos['<>9'];
        if(!targetField) throw new Error('sj 回调单例字段缺失');
        il2cpp.fieldStaticGetValue(targetField,storage);
        var target=storage.readPointer();
        if(isBadPtr(target)) throw new Error('sj 原生回调单例尚未就绪');
        var iter=Memory.alloc(PTR),callbackMethod=ptr(0);iter.writePointer(ptr(0));
        while(true) {
            var method=il2cpp.classGetMethods(closureClass,iter);
            if(isBadPtr(method))break;
            if(il2cpp.methodGetParamCount(method)!==1 ||
                    cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method,0)))!=='TaskbarHero.MoveResult' ||
                    cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method)))!=='System.Void') continue;
            var fp=methodPtr(method);
            // sj's cached result handlers are shared native no-op bodies.
            if(!isBadPtr(fp) && Instruction.parse(fp).mnemonic==='ret') {callbackMethod=method;break;}
        }
        if(isBadPtr(callbackMethod)) throw new Error('sj 未找到可验证的原生空结果回调');
        var ctor=il2cpp.classGetMethod(delegateClass,Memory.allocUtf8String('.ctor'),2);
        if(isBadPtr(ctor)) throw new Error('Action<MoveResult> 构造入口缺失');
        var callback=api('il2cpp_object_new','pointer',['pointer'])(delegateClass);
        new NativeFunction(methodPtr(ctor),'void',['pointer','pointer','pointer','pointer'])(
            callback,target,callbackMethod,ctor);
        if(!sameNativePointer(callback.add(0x10).readPointer(),methodPtr(callbackMethod)) ||
                !sameNativePointer(callback.add(0x20).readPointer(),target) ||
                !sameNativePointer(callback.add(0x28).readPointer(),callbackMethod))
            throw new Error('Action<MoveResult> 原生委托字段核验失败');
        // The IL2CPP static setter accepts the object itself for reference
        // fields. Passing &callback caches a temporary Frida allocation, which
        // becomes a dangling delegate after detaching the previous helper.
        api('il2cpp_field_static_set_value','void',['pointer','pointer'])(field,callback);
        il2cpp.fieldStaticGetValue(field,storage);
        if(!sameNativePointer(storage.readPointer(),callback) || !validCallback(callback))
            throw new Error('Action<MoveResult> 静态缓存回读校验失败');
        g_moveResultCallback=callback;
    }
    if (Date.now() - g_moveResultCallbackLogAt > 60000) {
        g_moveResultCallbackLogAt = Date.now();
        tradeShipLog('已绑定游戏原生 MoveResult 回调');
    }
    return g_moveResultCallback;
}

function synthesisSources(item) {
    var out = [];
    var sources = item && item.sources || [];
    for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i] || {};
            if (pass === 0 && source.source === '背包') {
                out.push({ slotType: 1, source: '背包', index: source.index | 0 });
            } else if (pass === 1 && source.source === '仓库') {
                out.push({ slotType: 2, source: '仓库', index: source.index | 0 });
            } else if (pass === 2 && source.source === '材料仓库') {
                out.push({ slotType: 6, source: '材料仓库', index: source.index | 0 });
            }
        }
    }
    return out;
}

function synthesisTypeFromCategory(categoryKey) {
    if (categoryKey === 'equipment') return 0;
    if (categoryKey === 'accessory') return 1;
    if (categoryKey === 'material') return 2;
    return -1;
}

function validateCubeSynthesisSelection(bridge, expectedType) {
    var cubeClass = il2cpp.methodGetClass(bridge.selectRecipe.mi);
    var staticData = il2cpp.classGetStaticFieldData(cubeClass);
    if (isBadPtr(staticData)) throw new Error('无法读取合成器静态状态');
    // Current recipe is a wi object; +0x230 in 1.2.8 is recipe data, often null.
    var recipe = staticData.add(bridge.current ? 0x128 : 0x140).readPointer();
    var actualType = staticData.add(bridge.current ? 0x244 : 0x254).readS32();
    if (isBadPtr(recipe)) throw new Error('合成配方初始化失败');
    if (bridge.current) {
        var recipeTypeMethod = findMethodInfoByClassMethod('', 'xp', 'lel');
        if (isBadPtr(recipeTypeMethod)) throw new Error('合成配方类型入口缺失');
        var getRecipeType = new NativeFunction(methodPtr(recipeTypeMethod), 'int', ['pointer', 'pointer']);
        if ((getRecipeType(recipe, recipeTypeMethod) | 0) !== 1) {
            throw new Error('当前配方不是合成配方');
        }
    }
    if (actualType !== expectedType) {
        throw new Error('合成类别初始化失败：期望 ' + expectedType + '，实际 ' + actualType);
    }
}

function nativeU64Text(value) {
    try { return value == null ? '' : value.toString(); } catch (e) { return ''; }
}

function resolveRuntimeSynthesisCandidate(bridge, selected) {
    var itemKeyText = String(selected && selected.itemKey != null ? selected.itemKey : '').trim();
    if (!/^\d+$/.test(itemKeyText) || Number(itemKeyText) <= 0) {
        return { ok: false, reason: '物品键无效：' + itemKeyText };
    }
    var sources = synthesisSources(selected);
    if (!sources.length) {
        return { ok: false, reason: '找不到背包或仓库位置' };
    }
    var observed = [];
    for (var i = 0; i < sources.length; i++) {
        var source = sources[i];
        if (source.index < 0) continue;
        var runtimeItem = bridge.getSlotItem.fn(source.slotType, source.index, bridge.getSlotItem.mi);
        if (isBadPtr(runtimeItem)) {
            observed.push(source.source + '第' + source.index + '格为空');
            continue;
        }
        var runtimeUid = nativeU64Text(bridge.getItemUid.fn(runtimeItem, bridge.getItemUid.mi));
        if (runtimeUid !== String(selected.uid)) {
            observed.push(source.source + '第' + source.index + '格现为唯一编号' + (runtimeUid || '未知'));
            continue;
        }
        return {
            ok: true,
            source: source,
            runtimeItem: runtimeItem,
            uid: runtimeUid,
            tier: bridge.getItemTier.fn(runtimeItem, bridge.getItemTier.mi) | 0
        };
    }
    return { ok: false, reason: observed.join('；') || '运行时槽位中未找到该物品' };
}

function rememberRuntimeSynthesisRejection(selected, batch, detail) {
    if (!selected || !selected.uid) return;
    var retryMs = Math.max(0, parseInt(detail.retryMs, 10) || 0);
    g_runtimeSynthesisRejectedUids[String(selected.uid) + '|' + String(batch.key || '')] = {
        groupKey: batch.key,
        reason: detail.reason || '不符合当前合成配方',
        tier: detail.tier == null ? -1 : detail.tier,
        minTier: detail.minTier == null ? -1 : detail.minTier,
        at: Date.now(),
        retryAt: retryMs ? Date.now() + retryMs : 0
    };
}

function rememberConsumedSynthesisBatch(batch) {
    var consumed = batchConsumedQuantities(batch);
    var now = Date.now();
    Object.keys(consumed).forEach(function (uid) {
        g_recentlyConsumedUids[uid] = {
            batchKey: batch.key || '',
            quantityBefore: consumed[uid].before,
            quantityConsumed: consumed[uid].count,
            at: now
        };
    });
}

function batchConsumedQuantities(batch) {
    var consumed = {};
    var items = batch && batch.items || [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var uid = String(item.uid || '');
        if (!uid || uid === '0') continue;
        if (!consumed[uid]) consumed[uid] = {count: 0, before: item.totalQuantity || 1};
        consumed[uid].count++;
    }
    return consumed;
}

function pruneRecentlyConsumedUids(placedQuantities) {
    var uids = Object.keys(g_recentlyConsumedUids);
    for (var i = 0; i < uids.length; i++) {
        var uid = uids[i];
        var consumed = g_recentlyConsumedUids[uid];
        var current = placedQuantities[uid] || 0;
        if (current <= Math.max(0, consumed.quantityBefore - consumed.quantityConsumed)) {
            delete g_recentlyConsumedUids[uid];
        }
    }
}

function recentlyConsumedUid(uid) {
    return g_recentlyConsumedUids[String(uid || '')] != null;
}

function isRecoverableItemAddResult(result) {
    return [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
        16, 17, 18, 19, 20, 21, 23, 25
    ].indexOf(result | 0) !== -1;
}

function shouldRememberItemAddRejection(result) {
    return [
        4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
        16, 18, 20, 23, 25
    ].indexOf(result | 0) !== -1;
}

function requeueNativeSynthesisItem(item) {
    item.deferUntil = Date.now() + 120;
    g_queue.unshift(item);
}

function finishRecoverableSynthesisBatch(bridge, item, reason) {
    try { bridge.reset.fn(bridge.reset.mi); } catch (e) {}
    g_runCount = Math.max(0, g_runCount - 1);
    g_synthesisBatchQueued = false;
    clearPendingSynthesis();
    g_lastResult = '本批次已跳过：' + reason;
    log('本批合成已跳过：' + reason + '，将继续扫描下一组。');
    emit('auto_synthesis_batch_skipped', {
        reason: reason,
        batch: item.batch || null,
        skipped: item.skipped || []
    });
}

function enqueueSynthesisResultCleanup(reason) {
    if (g_synthesisCleanupQueued) return true;
    resolveSynthesisBridge();
    if (!ensureUpdateHook()) return false;
    g_synthesisCleanupQueued = true;
    g_queue.unshift({
        action: 'synthesisCleanup',
        reason: reason || '合成成功',
        batch: g_pendingSynthesisBatch,
        at: Date.now()
    });
    g_lastResult = '已安排执行红框重置按钮的核心逻辑';
    return true;
}

function processSynthesisResultCleanup(item) {
    var bridge = resolveSynthesisBridge();
    if (item.retryAt && Date.now() < item.retryAt) {
        g_queue.unshift(item);
        return;
    }
    if (bridge.busy && bridge.busy.fn(bridge.busy.mi)) {
        item.retryAt = Date.now() + 100;
        g_queue.unshift(item);
        return;
    }
    var beforeCount = bridge.slotCount.fn(bridge.slotCount.mi) | 0;
    // Clear occupied slots without calling the auto-fill entry.
    bridge.reset.fn(bridge.reset.mi);
    var afterCount = bridge.slotCount.fn(bridge.slotCount.mi) | 0;
    if (afterCount > 0) {
        item.attempts = (item.attempts | 0) + 1;
        if (item.attempts >= 20) {
            throw new Error('合成成功后红框重置按钮连续 2 秒未能清空合成栏，剩余=' + afterCount);
        }
        if (item.attempts === 1) {
            log('合成已成功，正在等待红框重置按钮可用，当前槽内还有 ' + afterCount + ' 件。');
        }
        item.retryAt = Date.now() + 100;
        g_queue.unshift(item);
        return;
    }
    var batch = item.batch || g_pendingSynthesisBatch;
    var key = batch && batch.key || g_pendingSynthesisKey || '未知批次';
    g_synthesisCleanupQueued = false;
    g_lastSynthesisCleanupAt = Date.now();
    clearPendingSynthesis();
    g_lastResult = '合成栏已清空：' + key;
    emit('auto_synthesis_cleanup', {
        success: true,
        reason: item.reason || '',
        beforeCount: beforeCount,
        afterCount: afterCount,
        batch: batch || null,
        clearedAt: g_lastSynthesisCleanupAt
    });
}

function resetNativeSynthesisState() {
    try {
        var bridge = resolveSynthesisBridge();
        bridge.reset.fn(bridge.reset.mi);
    } catch (e) {}
}

function synthesisLevelMatchesRecipe(level, categoryKey, batch) {
    var itemLevel = Number(level || 0);
    // The selected recipe tier is an output range. Inputs may be below its
    // lower edge; only items above the tier's upper edge are incompatible.
    // The same-level toggle is checked separately against batch.level.
    if (itemLevel <= 0) {
        return categoryKey === 'material' || Number(batch.recipeMinLevel || 0) <= 0;
    }
    var recipeMax = Number(batch.recipeMaxLevel || 999999);
    return recipeMax <= 0 || itemLevel <= recipeMax;
}

function synthesisMinimumGrade() {
    return g_autoCorrosionEnabled ? Math.max(0, Math.min(9, Number(g_corrosionMaxGrade) || 0)) + 1 : 0;
}

function synthesisGradeRejection(row, categoryKey, maxGrades) {
    var minimum = synthesisMinimumGrade();
    if (minimum > 8) return '腐蚀品级已覆盖全部可合成品级';
    if (minimum > 0 && (row.gradeValue == null || !Number.isFinite(Number(row.gradeValue)))) {
        return '无法确认物品品级高于腐蚀范围';
    }
    if (row.gradeValue != null && Number(row.gradeValue) < minimum) return '物品品级属于腐蚀范围';
    maxGrades = maxGrades || g_maxGrades;
    if (row.gradeValue != null && maxGrades[categoryKey] != null &&
            Number(row.gradeValue) > Number(maxGrades[categoryKey])) return '物品超过品级上限';
    return '';
}

function synthesisAutoFillRowRejection(row, batch) {
    if (!row) return '最新背包和仓库扫描未找到该物品';
    if (batch.backpackSpaceRecovery && !boxRecoveryBackpackRow(row)) return '满包清理只使用背包内的物品';
    if (!row.placed || !row.synthable || row.locked || row.equipped || row.serverPending ||
            row.deletedInServer || row.temporaryBlocked) return '物品当前不可合成';
    if (row.categoryKey !== batch.categoryKey ||
            (g_categories && g_categories[row.categoryKey] === false)) return '合成类别不符合当前规则';
    if (g_synthesisIgnoreItemIdSet[String(row.itemKey)] === true) return '物品已加入合成忽略列表';
    if (g_tradeShipQueuedUids[String(row.uid)] === true) return '物品正在等待交易船处理';
    if (recentlyConsumedUid(row.uid)) return '物品刚被消耗';
    var gradeRejection = synthesisGradeRejection(row, batch.categoryKey);
    if (gradeRejection) return gradeRejection;
    var level = Number(row.level || 0);
    if (!synthesisLevelMatchesRecipe(level, row.categoryKey, batch)) {
        return '物品不在当前配方等级区间';
    }
    if (g_sameLevelSynthesis && level !== Number(batch.level || 0)) return '物品等级与同等级规则不符';
    return '';
}

function runtimeOnlyInventoryRow(uid) {
    uid = String(uid || '');
    if (!uid || g_lastItemSaveUidSet[uid]) return null;
    var sources = g_lastPlacedSourcesByUid[uid] || [];
    var runtime = g_lastRuntimeItemInfoByUid[uid];
    if (!sources.length || !runtime || runtime.synthable !== true) return null;
    var itemKey = Number(runtime.itemKey || 0);
    var gradeValue = Number(runtime.grade);
    if (!(itemKey > 0) || !isFinite(gradeValue) || gradeValue < 0 || gradeValue >= 9) return null;
    var category = categoryFromItem({
        itemKey: itemKey,
        synthesisType: runtime.synthesisType,
        gearGroup: runtime.gearGroup,
        parts: runtime.parts,
        gearType: runtime.gearType
    }, false);
    if (!category) return null;
    return {
        uid: uid,
        itemKey: itemKey,
        categoryKey: category.key,
        category: category.name,
        gradeKey: enumName(gradeValue),
        grade: gradeZh(gradeValue),
        gradeValue: gradeValue,
        synthesisType: Number(runtime.synthesisType),
        level: Number(runtime.level || 0),
        // The game itself selected this item for its visible auto-fill result.
        // ItemSaveData is temporarily absent, so the lock bit cannot be read.
        locked: false,
        lockStateKnown: false,
        serverPending: false,
        deletedInServer: runtime.isDeleted === true,
        temporaryBlocked: runtime.temporaryBlocked === true,
        synthable: true,
        synthableSource: 'runtime-only-autofill-verification',
        runtimeInfo: true,
        saveDataMissing: true,
        equipped: g_lastEquippedUids[uid] === true,
        placed: true,
        sources: sources
    };
}

function tryNativeSynthesisAutoFill(bridge, item, batch) {
    if (!bridge.autoFillEventInvoke || !bridge.getSlotList || !bridge.getSlotUid) return false;
    var selectedItems = [];
    var slotUids = [];
    var rejection = '';
    var freshRows = null;
    var freshScanCandidateCount = 0;
    var freshScanAcceptedCount = 0;
    var cachedScanAcceptedCount = 0;
    var freshRuntimeOnlyUids = {};
    var usedByUid = {};
    var freshUids = {};
    var freshScanUids = {};
    item.autoFillMismatch = null;
    try {
        var fixedLevelState = syncSynthesisFixedLevelToggle();
        // Invoke the same Unity onClick event wired to the game's visible
        // "自动填充" button. Cube.jcb is a lower-level helper and can ignore
        // the selected category/quality filters.
        var clickEvent = resolveSynthesisAutoFillClickEvent();
        bridge.autoFillEventInvoke.fn(clickEvent, bridge.autoFillEventInvoke.mi);
        slotUids = readCubeSlotUids(bridge) || [];
        if (slotUids.length !== g_threshold) {
            rejection = '槽位数量为 ' + slotUids.length + '/' + g_threshold;
        } else {
            var candidatePools = {};
            (batch.candidates || []).forEach(function (candidate) {
                var key = String(candidate.uid);
                if (!candidatePools[key]) candidatePools[key] = [];
                candidatePools[key].push(candidate);
            });
            for (var i = 0; i < slotUids.length; i++) {
                var uid = String(slotUids[i]);
                var pool = candidatePools[uid];
                if (!pool || !pool.length) {
                    var freshRow = null;
                    var rowUsedFreshScan = false;
                    var cachedRows = typeof g_lastPlacedRows !== 'undefined' ? g_lastPlacedRows : [];
                    for (var cachedIndex = 0; cachedIndex < cachedRows.length; cachedIndex++) {
                        if (String(cachedRows[cachedIndex].uid) === uid) {
                            freshRow = cachedRows[cachedIndex];
                            break;
                        }
                    }
                    if (!freshRow) {
                        if (freshRows === null) {
                            freshRows = scanInventory();
                            freshScanCandidateCount = freshRows.length;
                        }
                        rowUsedFreshScan = true;
                        for (var rowIndex = 0; rowIndex < freshRows.length; rowIndex++) {
                            if (String(freshRows[rowIndex].uid) === uid) {
                                freshRow = freshRows[rowIndex];
                                break;
                            }
                        }
                    }
                    if (!freshRow) {
                        freshRow = runtimeOnlyInventoryRow(uid);
                        if (freshRow) {
                            freshRuntimeOnlyUids[uid] = true;
                            log('自动填充物品在背包/仓库位置表中存在，但 ItemSaveData 行缺失；已用游戏运行时信息复核：' +
                                freshRow.category + '/' + freshRow.grade + '/Lv.' + freshRow.level + '。');
                        }
                    }
                    var freshRejection = synthesisAutoFillRowRejection(freshRow, batch);
                    if (freshRejection) {
                        var mismatchSources = g_lastPlacedSourcesByUid[uid] || [];
                        var mismatchItemSaveRowPresent = g_lastItemSaveUidSet[uid] === true;
                        var mismatchRuntimeMetadataPresent = !!g_lastRuntimeItemInfoByUid[uid];
                        if (!freshRow && mismatchSources.length && !mismatchItemSaveRowPresent) {
                            freshRejection = mismatchRuntimeMetadataPresent ?
                                '背包/仓库位置表有该物品，但 ItemSaveData 缺行且运行时信息无法生成可核验候选' :
                                '背包/仓库位置表有该物品，但 ItemSaveData 与运行时物品缓存都没有对应记录';
                        }
                        rejection = '游戏自动填充第 ' + (i + 1) + ' 格无法通过实时库存核验：' + freshRejection;
                        item.autoFillMismatch = {
                            index: i,
                            uid: uid,
                            reason: freshRejection,
                            placedInInventoryOrStash: mismatchSources.length > 0,
                            itemSaveRowPresent: mismatchItemSaveRowPresent,
                            runtimeItemMetadataPresent: mismatchRuntimeMetadataPresent
                        };
                        break;
                    }
                    var freshUnits = synthesisUnitsForRow(freshRow);
                    var usedCount = usedByUid[uid] || 0;
                    if (freshUnits.length <= usedCount) {
                        rejection = '游戏自动填充第 ' + (i + 1) + ' 格超出了该堆叠的实时数量';
                        item.autoFillMismatch = { index: i, uid: uid, reason: 'stack-quantity-exceeded' };
                        break;
                    }
                    pool = candidatePools[uid] = freshUnits.slice(usedCount);
                    if (!freshUids[uid]) {
                        freshUids[uid] = true;
                        if (rowUsedFreshScan) {
                            freshScanUids[uid] = true;
                            freshScanAcceptedCount++;
                        } else {
                            cachedScanAcceptedCount++;
                        }
                    }
                }
                var selectedCandidate = pool.shift();
                if (!selectedCandidate) {
                    rejection = '游戏自动填充第 ' + (i + 1) + ' 格没有可核验的候选物品';
                    item.autoFillMismatch = { index: i, uid: uid, reason: 'candidate-pool-empty' };
                    break;
                }
                selectedItems.push(selectedCandidate);
                usedByUid[uid] = (usedByUid[uid] || 0) + 1;
            }
            if (!rejection && selectedItems.length === g_threshold) {
                var firstGradeIdentity = synthesisGradeIdentity(selectedItems[0]);
                for (var verifyIndex = 0; verifyIndex < selectedItems.length; verifyIndex++) {
                    var selected = selectedItems[verifyIndex];
                    var selectedLevel = Number(selected.level || 0);
                    if (selected.categoryKey !== batch.categoryKey) {
                        rejection = '游戏自动填充混入了其他合成类别';
                        break;
                    }
                    if (synthesisGradeIdentity(selected) !== firstGradeIdentity) {
                        rejection = '游戏自动填充没有凑齐同一品级的 9 件物品';
                        break;
                    }
                    var gradeRejection = synthesisGradeRejection(selected, batch.categoryKey);
                    if (gradeRejection) {
                        rejection = '游戏自动填充：' + gradeRejection;
                        break;
                    }
                    if (!synthesisLevelMatchesRecipe(selectedLevel, selected.categoryKey, batch)) {
                        rejection = '游戏自动填充选入了当前配方等级区间之外的物品';
                        break;
                    }
                    if (g_sameLevelSynthesis && selectedLevel !== Number(batch.level || 0)) {
                        rejection = '游戏自动填充选入了不同物品等级';
                        break;
                    }
                }
            }
        }
        if (!rejection && selectedItems.length === g_threshold) {
            item.selectedItems = selectedItems;
            item.added = slotUids.map(function (uid) {
                var key = String(uid);
                var verificationSource = freshRuntimeOnlyUids[key] ? '运行时物品信息复核' :
                    (freshScanUids[key] ? '实时库存复核' :
                        '本轮库存复核');
                return { uid: key, source: freshUids[key] ?
                    '游戏自动填充/' + verificationSource : '游戏自动填充', index: -1,
                    tier: Number(batch.recipeTier || 0) };
            });
            item.autoFillAccepted = true;
            log('已调用游戏自动填充：' + batch.category + '/' + batch.grade + '，九格通过类别、品级和已启用的等级规则核验。');
            emit('auto_synthesis_autofill', {
                accepted: true,
                category: batch.category,
                recipeTier: batch.recipeTier,
                itemCount: selectedItems.length,
                freshScanUsed: freshScanAcceptedCount > 0,
                freshScanCandidateCount: freshScanCandidateCount,
                freshScanAcceptedCount: freshScanAcceptedCount,
                cachedScanAcceptedCount: cachedScanAcceptedCount,
                runtimeOnlyMetadataAcceptedCount: Object.keys(freshRuntimeOnlyUids).length,
                fixedLevelEnabled: fixedLevelState.enabled,
                fixedLevelChanged: fixedLevelState.changed
            });
            return true;
        }
    } catch (e) {
        rejection = '自动填充核验异常：' + chineseError(e);
    }

    try {
        bridge.reset.fn(bridge.reset.mi);
        verifyCubeSlotUids(bridge, [], '自动填充回退后');
    } catch (resetError) {
        throw new Error('游戏自动填充未通过安全校验，且无法清空合成栏：' + chineseError(resetError));
    }
    item.selectedItems = [];
    item.added = [];
    item.autoFillFailure = rejection || '自动填充结果为空';
    if (batch.manualFallbackAllowed) {
        log(item.autoFillFailure + '；已清空，接下来改用已核验的库存候选逐件补齐。');
    } else {
        log(item.autoFillFailure + '；已清空，本批候选不满足逐件回退条件，保持跳过。');
    }
    emit('auto_synthesis_autofill', {
        accepted: false,
        category: batch.category,
        recipeTier: batch.recipeTier,
        itemCount: slotUids.length,
        reason: rejection || 'empty-result',
        mismatchIndex: item.autoFillMismatch && item.autoFillMismatch.index,
        mismatchUid: item.autoFillMismatch && item.autoFillMismatch.uid,
        mismatchPlacedInInventoryOrStash: item.autoFillMismatch && item.autoFillMismatch.placedInInventoryOrStash,
        mismatchItemSaveRowPresent: item.autoFillMismatch && item.autoFillMismatch.itemSaveRowPresent,
        mismatchRuntimeItemMetadataPresent: item.autoFillMismatch && item.autoFillMismatch.runtimeItemMetadataPresent,
        freshScanUsed: freshRows !== null,
        freshScanCandidateCount: freshScanCandidateCount,
        freshScanAcceptedCount: freshScanAcceptedCount,
        cachedScanAcceptedCount: cachedScanAcceptedCount,
        runtimeOnlyMetadataAcceptedCount: Object.keys(freshRuntimeOnlyUids).length,
        manualFallbackAllowed: batch.manualFallbackAllowed === true
    });
    return false;
}

function queueNextNativeAutoFillTier(bridge, item, batch) {
    if (!batch.recipeTiers || item.recipeTierIndex + 1 >= batch.recipeTiers.length) return false;
    var previousTier = batch.recipeTier;
    item.recipeTierIndex++;
    batch.recipeTier = Number(batch.recipeTiers[item.recipeTierIndex]);
    var synthesisType = synthesisTypeFromCategory(batch.categoryKey);
    bridge.reset.fn(bridge.reset.mi);
    bridge.selectRecipe.fn(1, bridge.selectRecipe.mi);
    selectSynthesisRecipeTier(bridge, batch.recipeTier);
    bridge.selectSynthesisType.fn(synthesisType, bridge.selectSynthesisType.mi);
    validateCubeSynthesisSelection(bridge, synthesisType);
    bridge.reset.fn(bridge.reset.mi);
    verifyCubeSlotUids(bridge, [], '切换混合等级配方后');
    item.autoFillAttempted = false;
    item.deferUntil = Date.now() + 50;
    g_queue.unshift(item);
    log('游戏自动填充未在第 ' + previousTier + ' 档填满九格，已切换第 ' +
        batch.recipeTier + ' 档继续核验。');
    return true;
}

function processNativeSynthesisQueueItem(item) {
    if ((typeof g_corrosionPending !== 'undefined' && g_corrosionPending) ||
            (typeof g_corrosionFinishQueued !== 'undefined' && g_corrosionFinishQueued)) {
        item.deferUntil = Date.now() + 120;
        g_queue.push(item);
        return;
    }
    var bridge = resolveSynthesisBridge();
    var batch = item.batch;
    if (bridge.busy && bridge.busy.fn(bridge.busy.mi)) {
        requeueNativeSynthesisItem(item);
        return;
    }
    if (!batch || !batch.candidates || batch.candidates.length < g_threshold) {
        throw new Error('合成批次无效：候选物品不足 ' + g_threshold + ' 件');
    }
    if (!item.prepareStartedAt) item.prepareStartedAt = item.at || Date.now();
    if (Date.now() - item.prepareStartedAt >= 3 * 60 * 1000 && !g_pendingSynthesisSignature) {
        var preparationTimeout = '合成准备超过 3 分钟仍未提交，已清空并跳过本组，下轮重新检查';
        g_synthesisAutoFillRejectedGroups[batch.key] = {
            reason: preparationTimeout, at: Date.now(), retryAt: Date.now() + 60000
        };
        finishRecoverableSynthesisBatch(bridge, item, preparationTimeout);
        emit('automation_recovery', { reason: 'synthesis-preparation-timeout',
            phase: g_cyclePhase, queuedForMs: Date.now() - item.prepareStartedAt,
            category: batch.category, recipeTier: batch.recipeTier });
        return;
    }
    if (boxInventoryMutationActive() || g_bossStageQueued ||
            g_bossState === 'waitingBox' || sharedGameActionWaiting()) {
        requeueNativeSynthesisItem(item);
        return;
    }
    if (!item.initialized) {
        var synthesisType = synthesisTypeFromCategory(batch.categoryKey);
        if (synthesisType < 0) throw new Error('未知合成类别：' + batch.categoryKey);
        // Clear any manually filled slots before switching the game's recipe.
        bridge.reset.fn(bridge.reset.mi);
        verifyCubeSlotUids(bridge, [], '切换配方前');
        // The normal UI selects the SYNTHESIS recipe before setting the item type.
        bridge.selectRecipe.fn(1, bridge.selectRecipe.mi);
        var initialRecipeTier = batch.recipeTiers && batch.recipeTiers.length
            ? Number(batch.recipeTiers[0]) : Number(batch.recipeTier || 0);
        batch.recipeTier = initialRecipeTier;
        item.recipeTierIndex = 0;
        selectSynthesisRecipeTier(bridge, initialRecipeTier);
        bridge.selectSynthesisType.fn(synthesisType, bridge.selectSynthesisType.mi);
        validateCubeSynthesisSelection(bridge, synthesisType);
        bridge.reset.fn(bridge.reset.mi);
        verifyCubeSlotUids(bridge, [], '开始合成前');
        item.initialized = true;
        item.candidateIndex = 0;
        item.added = [];
        item.selectedItems = [];
        item.skipped = [];
        item.autoFillAttempted = false;
    }
    if (!item.autoFillAttempted) {
        item.autoFillAttempted = true;
        var autoFillAccepted = tryNativeSynthesisAutoFill(bridge, item, batch);
        if (!autoFillAccepted && batch.recipeTiers && item.recipeTierIndex + 1 < batch.recipeTiers.length) {
            try {
                if (queueNextNativeAutoFillTier(bridge, item, batch)) return;
            } catch (tierError) {
                throw new Error('切换混合等级配方到第 ' + batch.recipeTier + ' 档失败：' + chineseError(tierError));
            }
        }
        if (batch.manualFallbackAllowed === false && !autoFillAccepted) {
            var retryAt = Date.now() + 60 * 1000;
            g_synthesisAutoFillRejectedGroups[batch.key] = {
                reason: item.autoFillFailure || '游戏自动填充未通过候选核验',
                retryAt: retryAt,
                at: Date.now()
            };
            finishRecoverableSynthesisBatch(
                bridge,
                item,
                '游戏自动填充复核未通过：' +
                    (item.autoFillFailure || '未填出 9 件符合当前规则的物品')
            );
            return;
        }
    }
    // Fill one verified batch during one Unity update. The game still validates
    // every item, while a rejected candidate is replaced immediately.
    var attemptsThisFrame = 0;
    var batchGradeIdentity = batch.gradeIdentity ||
        (batch.candidates.length ? synthesisGradeIdentity(batch.candidates[0]) : '');
    while (item.added.length < g_threshold && item.candidateIndex < batch.candidates.length &&
            attemptsThisFrame++ < 12) {
        var selected = batch.candidates[item.candidateIndex++];
        var selectedItemKeyText = String(selected && selected.itemKey != null ? selected.itemKey : '').trim();
        if (selectedItemKeyText && (!/^\d+$/.test(selectedItemKeyText) || Number(selectedItemKeyText) <= 0)) {
            item.skipped.push({ uid: selected && selected.uid, reason: '物品键无效：' + (selected && selected.itemKey) });
            log('已跳过物品键无效的合成候选：唯一编号=' + (selected && selected.uid || '未知') + '。');
            continue;
        }
        var gradeRejection = synthesisGradeRejection(selected, batch.categoryKey);
        if (gradeRejection) {
            finishRecoverableSynthesisBatch(bridge, item, '合成规则已变更：' + gradeRejection);
            return;
        }
        var selectedLevel = Number(selected.level || 0);
        if (selected.categoryKey !== batch.categoryKey ||
                synthesisGradeIdentity(selected) !== batchGradeIdentity ||
                !synthesisLevelMatchesRecipe(selectedLevel, selected.categoryKey, batch) ||
                (g_sameLevelSynthesis && Number(selected.level || 0) !== Number(batch.level || 0))) {
            throw new Error('候选物品类别、品级或配方等级区间与当前批次不一致，已阻止混合合成');
        }
        var runtime = resolveRuntimeSynthesisCandidate(bridge, selected);
        if (!runtime.ok) {
            rememberRuntimeSynthesisRejection(selected, batch, {
                reason: runtime.reason,
                retryMs: 15000
            });
            item.skipped.push({ uid: selected.uid, reason: runtime.reason });
            log('暂时跳过运行时无法定位的合成物品：唯一编号=' + selected.uid + '，' + runtime.reason + '；15 秒后重试。');
            continue;
        }
        var source = runtime.source;
        var result = bridge.addSlot.fn(source.slotType, source.index, bridge.addSlot.mi) | 0;
        if (result !== 0) {
            if (isRecoverableItemAddResult(result)) {
                var rejectedReason = '游戏拒绝该物品：返回码 ' + result + '（' +
                    (E_ADD_CUBE_RESULT_NAMES[result] || '未知原因') + '）';
                if (result === 20) {
                    rejectedReason += '；程序不会在调用游戏前按阶级筛掉候选';
                }
                rememberRuntimeSynthesisRejection(selected, batch, {
                    reason: rejectedReason,
                    tier: runtime.tier,
                    retryMs: shouldRememberItemAddRejection(result) ? 0 : 60000
                });
                item.skipped.push({ uid: selected.uid, reason: rejectedReason, result: result });
                log('已跳过不可合成物品：唯一编号=' + selected.uid + '，' + rejectedReason + '。');
                continue;
            }
            bridge.reset.fn(bridge.reset.mi);
            throw new Error('加入合成槽失败：唯一编号=' + selected.uid + '，位置=' + source.source +
                ' 第 ' + source.index + ' 格，返回码=' + result + '（' +
                (E_ADD_CUBE_RESULT_NAMES[result] || '未知原因') + '）');
        }
        item.added.push({ uid: selected.uid, source: source.source, index: source.index, tier: runtime.tier });
        item.selectedItems.push(selected);
        // Keep the expensive full UID check at the commit boundary below.
        // Re-reading every occupied slot after each insertion repeated up to
        // 45 managed UID calls on the Unity main thread for one 9-item batch.
        g_lastResult = '运行时核验中：' + item.added.length + '/' + g_threshold + ' ' + batch.category + '/' + batch.grade;
    }
    if (item.added.length < g_threshold && item.candidateIndex < batch.candidates.length) {
        item.deferUntil = Date.now() + 16;
        g_queue.unshift(item);
        return;
    }

    if (item.added.length < g_threshold) {
        finishRecoverableSynthesisBatch(bridge, item,
            '游戏接受放入合成槽的' + batch.category + '/' + batch.grade + '只有 ' + item.added.length + '/' + g_threshold + ' 件');
        return;
    }

    batch.items = item.selectedItems.slice(0, g_threshold);
    for (var gradeIndex = 0; gradeIndex < batch.items.length; gradeIndex++) {
        var gradeRejection = synthesisGradeRejection(batch.items[gradeIndex], batch.categoryKey);
        if (gradeRejection) {
            finishRecoverableSynthesisBatch(bridge, item, '提交前品级核验失败：' + gradeRejection);
            return;
        }
    }
    verifyCubeSlotUids(bridge, batch.items, '提交合成前');
    batch.uids = batch.items.map(function (selectedItem) { return selectedItem.uid; });
    batch.selectedCount = batch.items.length;
    // Rejected candidates may have bfwn replaced after the preview was built.
    batch.grade = synthesisGradeSummary(batch.items);
    batch.eventId = String(Process.id) + '-synthesis-' + Date.now() + '-' + g_runCount;
    var synthesisRequestReadyAt = g_lastServerRequestAt + g_serverRequestSpacingMs;
    if (Date.now() < synthesisRequestReadyAt) {
        item.deferUntil = synthesisRequestReadyAt;
        g_queue.unshift(item);
        return;
    }
    g_lastServerRequestAt = Date.now();
    g_pendingSynthesisSignature = batchSignature(batch);
    g_pendingSynthesisKey = batch.key;
    g_pendingSynthesisAt = Date.now();
    g_pendingSynthesisBatch = batch;
    g_pendingSynthesisResultReceived = false;
    g_pendingSynthesisObservedError = '';
    if (bridge.current) {
        if (!bridge.triggerRecipe) throw new Error('当前版本缺少魔方完整执行入口');
        if (bridge.refreshRecipe) bridge.refreshRecipe.fn(0, bridge.refreshRecipe.mi);
        bridge.triggerRecipe.fn(bridge.triggerRecipe.mi);
        if (bridge.busy && !bridge.busy.fn(bridge.busy.mi) && !g_pendingSynthesisResultReceived) {
            finishRecoverableSynthesisBatch(bridge, item, '游戏原生合成校验未通过，未发送请求');
            return;
        }
    } else {
        var retbuf = Memory.alloc(0x40);
        retbuf.writeByteArray(new Uint8Array(0x40));
        bridge.executeBackend.fn(retbuf, bridge.executeBackend.mi);
    }
    g_synthesisBatchQueued = false;
    g_pendingSynthesisAt = Date.now();
    g_lastResult = '原生后台合成已提交：' + batch.category + '/' + batch.grade;
    log('运行时核验完成并已提交合成：' + batch.category + '/' + batch.grade +
        '，程序未按材料阶级预筛，选中 9/9。');
    emit('auto_synthesis_called', {
        mode: 'native',
        methodName: bridge.current ? 'Cube.jkz (完整原生执行流程)' :
            'Cube.ipv -> Cube.ior x9 -> Cube.ipe',
        rva: '0x' + (bridge.current ? bridge.triggerRecipe.ptr : bridge.executeBackend.ptr).sub(B).toString(16),
        runCount: g_runCount,
        added: item.added,
        batch: batch
    });
}

function enqueueNativeSynthesis(batch) {
    batch.backpackSpaceRecovery = g_boxCapacityBlocked === true;
    resolveSynthesisBridge();
    if (!ensureUpdateHook()) return 'update-hook-failed';
    g_synthesisBatchQueued = true;
    g_queue.push({ action: 'synthesisBatch', batch: batch, initialized: false, candidateIndex: 0, at: Date.now() });
    return 'queued-native: ' + batch.key;
}

function isMapChangeQueueItem(item) {
    if(item && item.action==='autoPlagueUiRoute') return item.phase==='enter';
    return !!item && ['bossStageEnter', 'eventDungeonEnter', 'eventDungeonReturn',
        'plagueDropStageSwitch', 'autoPlagueStageSwitch'].indexOf(item.action) >= 0;
}

function isServerMutationQueueItem(item) {
    if (!item) return false;
    if(item.action==='autoPlagueUiRoute') return item.phase==='enter';
    if (['boxOpen', 'depositItem', 'tradeShipItem', 'tradeShipConfirm',
            'tradeShipFinalize', 'tradeShipProbeSlots', 'tradeShipReleaseSlot',
            'tradeShipReleaseFinalize', 'corrosionBatch', 'bossStageEnter',
            'eventDungeonEnter', 'eventDungeonReturn', 'plagueDropStageSwitch',
            'autoPlagueStageSwitch', 'failedExchangeRecovery'].indexOf(item.action) >= 0) return true;
    return item.action === 'fullBackpackDeposit' && item.phase === 'deposit';
}

function serverRequestWaitUntil(item) {
    var now = Date.now();
    var nextAt = isServerMutationQueueItem(item) ? g_lastServerRequestAt + g_serverRequestSpacingMs : 0;
    if (isMapChangeQueueItem(item))
        nextAt = Math.max(nextAt, g_lastMapSwitchAt + g_mapSwitchMinimumIntervalMs);
    return nextAt > now ? nextAt : 0;
}

function recordServerRequestDispatch(item) {
    var now = Date.now();
    if (isServerMutationQueueItem(item)) g_lastServerRequestAt = now;
}

function recordMapSwitchDispatch() {
    g_lastMapSwitchAt = Date.now();
    g_lastServerRequestAt = g_lastMapSwitchAt;
}

function ensureUpdateHook() {
    // Keep one listener for the script lifetime. Detaching/reattaching an
    // every-frame method between one-second return polls races native listener
    // disposal; the crash dump reached an onEnter callback with null data.
    // An empty queue costs only the guard below; script unload removes the hook.
    if (g_updateListener) {
        g_updateHooked = true;
        return true;
    }
    if (!g_eventSystemUpdateInfo || g_eventSystemUpdateInfo.isNull()) {
        g_eventSystemUpdateInfo = findMethodInfo('UnityEngine.EventSystems', 'EventSystem', 'Update', 0, 'UnityEngine.UI.dll');
        if (!g_eventSystemUpdateInfo || g_eventSystemUpdateInfo.isNull()) {
            g_eventSystemUpdateInfo = findMethodInfo('UnityEngine.EventSystems', 'EventSystem', 'Update', 0);
        }
        g_eventSystemUpdatePtr = methodPtr(g_eventSystemUpdateInfo);
    }
    if (!g_eventSystemUpdatePtr || g_eventSystemUpdatePtr.isNull()) {
        log('找不到游戏主线程更新入口，无法安全执行任务队列。');
        return false;
    }
    g_updateListener = Interceptor.attach(g_eventSystemUpdatePtr, {
        onEnter: function () {
            if (!g_queue.length) return;
            if (g_queue[0].deferUntil && Date.now() < g_queue[0].deferUntil) return;
            var spacingUntil = serverRequestWaitUntil(g_queue[0]);
            if (spacingUntil) {
                g_queue[0].deferUntil = Math.max(g_queue[0].deferUntil || 0, spacingUntil);
                return;
            }
            // Execute at most one queued Unity action in one frame.
            var drainLimit = 1;
            while (g_queue.length && drainLimit-- > 0) {
                var item = g_queue.shift();
                recordServerRequestDispatch(item);
                g_activeAutomationAction = item.action || 'direct';
                g_queueLastProcessedAt = Date.now();
                try {
                    if (item.action === 'compatibilityRead') {
                        item.resolve(JSON.stringify({status:'SUCCESS', mainThread:true, pid:Process.id,
                            frameRate:readFridaFrameLimit(resolveFridaFrameLimitBridge())}));
                    } else if (item.action === 'failedExchangeRecovery') {
                        processFailedExchangeRecovery(item);
                    } else if (item.action === 'boxOpen') {
                        if (!g_boxOpenDispatching && !g_boxOpenInFlight &&
                                !synthesisInventoryMutationActive()) {
                            callStageBoxAutoOpen(item);
                        }
                    } else if (item.action === 'fullBackpackDeposit') {
                        processFullBackpackDepositQueueItem(item);
                    } else if (item.action === 'depositItem') {
                        processAutoDepositQueueItem(item);
                    } else if (item.action === 'depositVerify') {
                        verifyAutoDepositPending();
                    } else if (item.action === 'tradeShipItem') {
                        processAutoTradeShipQueueItem(item);
                    } else if (item.action === 'tradeShipConfirm') {
                        processAutoTradeShipConfirmQueueItem(item);
                    } else if (item.action === 'tradeShipFinalize') {
                        processAutoTradeShipFinalizeQueueItem(item);
                    } else if (item.action === 'tradeShipProbeSlots') {
                        processAutoTradeShipSlotProbeQueueItem(item);
                    } else if (item.action === 'tradeShipReleaseSlot') {
                        processAutoTradeShipReleaseQueueItem(item);
                    } else if (item.action === 'tradeShipReleaseFinalize') {
                        processAutoTradeShipReleaseFinalizeQueueItem(item);
                    } else if (item.action === 'corrosionBatch') {
                        processCorrosionBatch(item);
                    } else if (item.action === 'corrosionFinish') {
                        finishCorrosionBatch(item);
                    } else if (item.action === 'synthesisCleanup') {
                        processSynthesisResultCleanup(item);
                    } else if (item.action === 'synthesisBatch') {
                        processNativeSynthesisQueueItem(item);
                    } else if (item.action === 'bossStageReturn') {
                        processAutoBossReturnQueueItem();
                    } else if (item.action === 'bossStageEnter') {
                        processAutoBossStageQueueItem(item);
                    } else if (item.action === 'eventDungeonEnter') {
                        processEventDungeonEntry(item);
                    } else if (item.action === 'eventDungeonReturn') {
                        processEventDungeonReturn();
                    } else if (item.action === 'plagueDropStageSwitch') {
                        processPlagueDropStageSwitch(item);
                    } else if (item.action === 'autoPlagueStageSwitch') {
                        processAutoPlagueStageSwitch(item);
                    } else if (item.action === 'autoPlagueUiRoute') {
                        processPlagueUiRoute(item);
                    } else if (item.action === 'autoPlaguePortalClose') {
                        processAutoPlaguePortalClose(item);
                    } else if (item.action === 'autoPlaguePortalCloseVerify') {
                        processAutoPlaguePortalCloseVerify(item);
                    } else if (item.action === 'frameLimit') {
                        var frameResult = applyFridaFrameLimit(item.fps);
                        if (item.resolve) item.resolve(frameResult);
                    } else if (item.action === 'backgroundMode') {
                        var backgroundResult = applyFridaBackgroundMode(item.enabled);
                        if (item.resolve) item.resolve(backgroundResult);
                    } else {
                        callDirect(item.mode || g_mode);
                    }
                } catch (e) {
                    g_failedCount++;
                    if (item.action === 'frameLimit' || item.action === 'backgroundMode' || item.action === 'compatibilityRead') {
                        if (item.resolve) item.resolve(JSON.stringify({status:'FAILED', error:chineseError(e)}));
                    } else if (item.action === 'corrosionBatch' || item.action === 'corrosionFinish') {
                        g_corrosionQueued = false;
                        g_corrosionFinishQueued = false;
                        g_corrosionRoundFailed = true;
                        g_corrosionNextCheckAt = Date.now() + g_corrosionMinimumIntervalMs;
                        g_corrosionBatchActive = false;
                        g_corrosionLastResult = '腐蚀任务失败：' + chineseError(e);
                        corrosionLog(g_corrosionLastResult);
                        emit('auto_corrosion_failed', {error:String(e), action:item.action});
                    } else if (item.action === 'bossStageEnter') {
                        g_bossStageQueued = false;
                        g_bossState = 'idle';
                        g_bossTarget = null;
                        g_bossNextActionAt = Date.now() + 5000;
                        g_bossLastResult = '进入关卡失败：' + chineseError(e);
                        bossLog(g_bossLastResult + '；5 秒后重新检测。');
                        emit('auto_boss_failed', {
                            error: String(e),
                            failedCount: g_failedCount,
                            target: item.target || null,
                            stack: e.stack || '',
                            action: 'bossStageEnter'
                        });
                    } else if (item.action === 'eventDungeonEnter' || item.action === 'eventDungeonReturn') {
                        g_eventEntryQueued = false;
                        if (item.action === 'eventDungeonEnter') g_eventEntryRetryAt = Date.now() + 30000;
                        if (g_eventDungeonContext && g_eventDungeonContext.phase === 'entering') {
                            g_eventDungeonContext.phase = 'ready';
                        }
                        g_eventLastResult = '南瓜灯峡谷流程失败：' + chineseError(e);
                        channelLog('自动挑战', g_eventLastResult + '。');
                        emit('auto_event_dungeon_failed', {error:String(e), action:item.action});
                    } else if (item.action === 'plagueDropStageSwitch') {
                        g_plagueDropSwitchPending = null;
                        g_plagueDropSwitchLastResult = '瘟疫切关失败：' + chineseError(e);
                        emit('plague_drop_monitor_switch_failed', {error:String(e), targetStageNo:item.targetStageNo});
                    } else if (item.action === 'autoPlagueUiRoute') {
                        failPlagueUiRoute(item.context,e);
                    } else if (item.action === 'autoPlagueStageSwitch') {
                        g_autoPlagueSwitchQueued = false;
                        g_autoPlagueLastResult = '瘟疫地图切换失败：' + chineseError(e);
                        emit('auto_plague_map_switch_failed', {error:String(e), targetStageNo:item.targetStageNo});
                    } else if (item.action === 'autoPlaguePortalClose' ||
                            item.action === 'autoPlaguePortalCloseVerify') {
                        g_autoPlaguePortalCloseQueued = false;
                        g_autoPlaguePortalCloseHandledStageKey = Number(item.expectedStageKey) || 0;
                        g_autoPlaguePortalCloseAttempts = 0;
                        g_autoPlagueNextCheckAt = Date.now() + g_autoPlagueCheckIntervalMs;
                        g_autoPlagueLastResult = '传送门页面关闭失败：' + chineseError(e);
                        channelLog('自动地图', g_autoPlagueLastResult + '。');
                    } else if (item.action === 'fullBackpackDeposit') {
                        resetFullBackpackDepositState();
                        g_fullBackpackDepositRetryAt = Date.now() + 30000;
                        g_depositQueued = false;
                        g_lastDepositResult = '满包清仓失败：' + chineseError(e);
                        depositLog('满包清仓失败，将保留自动存仓并继续后续扫描。');
                        emit('auto_deposit_full_backpack_failed', {
                            error: String(e),
                            failureStage: item.phase || 'unknown',
                            failedCount: g_failedCount,
                            page: item.page == null ? 0 : item.page + 1,
                            action: 'fullBackpackDeposit'
                        });
                    } else if (item.action === 'depositItem' || item.action === 'depositVerify') {
                        if(item.row && item.row.uid) g_depositRejectedUids[String(item.row.uid)] = Date.now()+g_depositCooldownMs;
                        g_depositPending=null;
                        g_depositQueued=false;
                        g_depositConsecutiveFailures++;
                        var depositRetryDelayMs = autoDepositRetryDelayMs(g_depositConsecutiveFailures);
                        var depositWillRetry = true;
                        g_depositRetryAt = Date.now() + depositRetryDelayMs;
                        g_lastResult = '主线程任务执行失败：' + chineseError(e);
                        log('主线程任务执行失败：' + chineseError(e));
                        emit('auto_deposit_failed', {
                            error: String(e),
                            stack: String(e && e.stack || ''),
                            failureStage: item.failureStage || 'unknown',
                            failureContext: item.failureContext || null,
                            failedCount: g_failedCount,
                            consecutiveFailures: g_depositConsecutiveFailures,
                            willRetry: depositWillRetry,
                            retryDelayMs: depositRetryDelayMs,
                            retryAt: g_depositRetryAt,
                            item: item.row || null,
                            action: 'depositItem'
                        });
                        g_depositQueued = false;
                        var retrySeconds = Math.ceil(depositRetryDelayMs / 1000);
                        g_lastDepositResult = '自动存仓暂缓 ' + retrySeconds + ' 秒后重试：' + chineseError(e);
                        var failureRoute = item.failureContext && item.failureContext.sourceIndex != null &&
                            item.failureContext.targetPage != null && item.failureContext.targetSlot != null
                            ? '，背包第 ' + (item.failureContext.sourceIndex + 1) + ' 格→仓库 ' +
                                item.failureContext.targetPage + ' 第 ' + item.failureContext.targetSlot + ' 格'
                            : '';
                        depositLog('自动存仓失败，阶段=' + (item.failureStage || '未知') + failureRoute +
                            '；' + retrySeconds + ' 秒后重试（连续第 ' +
                            g_depositConsecutiveFailures + ' 次）。');
                    } else if (item.action === 'tradeShipItem' || item.action === 'tradeShipConfirm' ||
                            item.action === 'tradeShipFinalize' || item.action === 'tradeShipReleaseSlot' ||
                            item.action === 'tradeShipReleaseFinalize' || item.action === 'tradeShipProbeSlots') {
                        var failedTradeShipUid = g_tradeShipPending && g_tradeShipPending.uid ||
                            item.uid || item.row && item.row.uid || '';
                        if (g_tradeShipPending) clearAutoTradeShipPending(true);
                        else {
                            g_tradeShipQueued = false;
                            g_tradeShipProbeQueued = false;
                            g_tradeShipReleasePending = null;
                        }
                        if (failedTradeShipUid) {
                            g_tradeShipRejectedUids[String(failedTradeShipUid)] = {
                                retryAt: Date.now() + 30000,
                                itemKey: item.row && item.row.itemKey || 0
                            };
                            if (item.action === 'tradeShipReleaseSlot' || item.action === 'tradeShipReleaseFinalize') {
                                g_tradeShipReleaseRetryAt[String(failedTradeShipUid)] =
                                    Date.now() + g_tradeShipSlotCheckIntervalMs;
                                g_tradeShipNextSlotCheckAt = Date.now() + g_tradeShipSlotCheckIntervalMs;
                            }
                        }
                        g_autoTradeShipNextCheckAt =
                            item.action === 'tradeShipProbeSlots' ||
                            item.action === 'tradeShipReleaseSlot' ||
                            item.action === 'tradeShipReleaseFinalize'
                                ? Date.now() + g_tradeShipSlotCheckIntervalMs
                                : 0;
                        g_lastTradeShipResult = '自动交易船任务失败：' + chineseError(e);
                        tradeShipLog('自动交易船任务失败，将在 30 秒后重新检查。');
                        emit('auto_trade_ship_failed', {
                            error: String(e),
                            failedCount: g_failedCount,
                            item: item.row || null,
                            action: item.action || 'tradeShipItem'
                        });
                    } else if (item.action !== 'boxOpen') {
                        g_lastResult = '主线程任务执行失败：' + chineseError(e);
                        log('主线程任务执行失败：' + chineseError(e));
                        emit('auto_synthesis_failed', { error: String(e), failedCount: g_failedCount, batch: item.batch || null, action: item.action || 'synthesis' });
                        if (item.action === 'synthesisCleanup') g_synthesisCleanupQueued = false;
                        g_synthesisBatchQueued = false;
                        resetNativeSynthesisState();
                        g_synthesisPauseReason = chineseError(e);
                        g_synthesisEnabled = false;
                        g_executeMode = 'scanOnly';
                        clearPendingSynthesis();
                    } else {
                        g_lastResult = '主线程任务执行失败：' + chineseError(e);
                        boxLog('开箱主线程任务执行失败：' + chineseError(e));
                        emit('auto_box_open_failed', { error: String(e), failedCount: g_failedCount, action: 'boxOpen' });
                    }
                } finally {
                    g_activeAutomationAction = '';
                }
            }
        }
    });
    g_updateHooked = true;
    return true;
}

function enqueue(kind, batch) {
    kind = DIRECT[kind] ? kind : g_mode;
    if (batch && g_executeMode === 'native') return enqueueNativeSynthesis(batch);
    if (!g_legacyDirectAllowed) {
        return 'execution-disabled: selected item bridge is not verified';
    }
    if (!ensureUpdateHook()) return 'update-hook-failed';
    g_queue.push({ mode: kind, batch: batch || null, at: Date.now() });
    return 'queued: ' + kind;
}

function isStageBoxRightClickSignature(returnType, parameterType) {
    var normalizedParameter=String(parameterType||'').replace(/[+\\]/g,'/')
        .replace('PointerEventData.InputButton','PointerEventData/InputButton');
    return returnType==='System.Void' &&
        normalizedParameter==='UnityEngine.EventSystems.PointerEventData/InputButton';
}

function resolveStageBoxRightClickHandler() {
    if (g_stageBoxRightClickHandler) return g_stageBoxRightClickHandler;
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    if (isBadPtr(info.klass)) throw new Error('StageBox 类型未加载');
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    var candidates = [];
    while (true) {
        var mi = il2cpp.classGetMethods(info.klass, iter);
        if (isBadPtr(mi)) break;
        if ((il2cpp.methodGetParamCount(mi) | 0) !== 1) continue;
        var returnType = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi)));
        var parameterType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(mi, 0)));
        if (!isStageBoxRightClickSignature(returnType,parameterType)) continue;
        var fn = methodPtr(mi);
        if (isBadPtr(fn)) continue;
        candidates.push({mi:mi, ptr:fn, methodName:cstr(il2cpp.methodGetName(mi)),
            parameterType:parameterType});
    }
    if (candidates.length !== 1) {
        throw new Error(candidates.length ? 'StageBox 右键入口不唯一：' + candidates.length :
            'StageBox 未找到 InputButton 右键入口');
    }
    var match = candidates[0];
    // The current game's InputButton.Right=1 branch calls the native bulk-open
    // routine. InputButton.Left=0 opens one chest and has a separate request path.
    match.fn = new NativeFunction(match.ptr, 'void', ['pointer', 'int', 'pointer']);
    g_stageBoxRightClickHandler = match;
    return match;
}

function stageBoxRightClickMethodName() {
    try { return resolveStageBoxRightClickHandler().methodName; }
    catch (error) { return 'unavailable'; }
}

function findStageBoxInstances() {
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    if (!info.klass || info.klass.isNull()) return [];
    return findObjectsOfType(info.klass);
}

function stageBoxInstanceSnapshot() {
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    var instances = findStageBoxInstances();
    var rows = [];
    for (var i = 0; i < instances.length; i++) {
        var obj = instances[i];
        if (!obj || obj.isNull()) continue;
        try {
            var boxType = info.fields.m_boxType != null ? obj.add(info.fields.m_boxType).readS32() : -1;
            var contentType = info.fields.m_contentType != null ?
                obj.add(info.fields.m_contentType).readS32() : 0;
            rows.push({ type: boxType, contentType: contentType,
                name: BOX_TYPE_NAMES[boxType] || '未知宝箱' });
        } catch (e) {}
    }
    return rows;
}

function boxQueueDiagnostic() {
    var now = Date.now();
    var actions = [];
    for (var i = 0; i < g_queue.length; i++) {
        var item = g_queue[i] || {};
        actions.push({
            action: item.action || item.mode || '未知任务',
            ageMs: Math.max(0, now - (item.at || now)),
            retryInMs: item.retryAt ? Math.max(0, item.retryAt - now) : 0
        });
    }
    return actions;
}

function stageBoxRuntimeDiagnostic(snapshot) {
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    var objects = [];
    var instances = [];
    try { objects = findStageBoxInstances(); } catch (e) {}
    for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj || obj.isNull()) continue;
        var row = {
            address: String(obj),
            managedType: '',
            boxType: -1,
            contentType: 0,
            boxTypeName: '未知宝箱',
            quantity: 0,
            error: ''
        };
        try {
            row.managedType = managedType(obj);
            row.boxType = info.fields.m_boxType != null ? obj.add(info.fields.m_boxType).readS32() : -1;
            row.contentType = info.fields.m_contentType != null ?
                obj.add(info.fields.m_contentType).readS32() : 0;
            row.boxTypeName = BOX_TYPE_NAMES[row.boxType] || '未知宝箱';
            row.quantity = boxQuantity(snapshot, row.boxType, row.contentType);
        } catch (e1) {
            row.error = chineseError(e1);
        }
        instances.push(row);
    }
    return {
        classAddress: info.klass && !info.klass.isNull() ? String(info.klass) : '0x0',
        fieldOffsets: info.fields || {},
        fieldTypes: info.fieldTypes || {},
        instanceCount: instances.length,
        instances: instances
    };
}

function emitBoxDiagnostic(stage, snapshot, extra, force) {
    return;
    var now = Date.now();
    snapshot = snapshot && snapshot.quantities ? snapshot : scanBoxSnapshot();
    var quickSignature = String(stage || '') + '|' + boxSnapshotSignature(snapshot) + '|' +
        g_queue.length + '|' + (g_updateHooked ? '1' : '0') + '|' + (g_boxOpenInFlight ? '1' : '0');
    if (!force && quickSignature === g_lastBoxDiagnosticSignature && now - g_lastBoxDiagnosticAt < 5000) return;
    var stageBox = stageBoxRuntimeDiagnostic(snapshot);
    g_lastBoxDiagnosticAt = now;
    g_lastBoxDiagnosticSignature = quickSignature;
    emit('auto_box_diagnostic', {
        stage: stage || '定时检查',
        reason: extra && extra.reason || '',
        total: snapshot.total,
        quantities: snapshot.quantities,
        entries: snapshot.entries,
        stageBox: stageBox,
        queue: {
            length: g_queue.length,
            actions: boxQueueDiagnostic(),
            updateHooked: g_updateHooked,
            eventSystemUpdateRva: g_eventSystemUpdatePtr && !g_eventSystemUpdatePtr.isNull() ?
                '0x' + g_eventSystemUpdatePtr.sub(B).toString(16) : ''
        },
        timing: {
            now: now,
            lastPumpAt: g_lastBoxPumpAt,
            lastPumpAgeMs: g_lastBoxPumpAt ? now - g_lastBoxPumpAt : -1,
            detectedAt: g_boxDetectedAt,
            detectedAgeMs: g_boxDetectedAt ? now - g_boxDetectedAt : -1,
            openDelayMs: g_boxOpenDelayMs,
            noInstanceRetryInMs: Math.max(0, g_boxNoInstanceRetryAt - now),
            inFlightAt: g_boxOpenInFlightAt,
            inFlightAgeMs: g_boxOpenInFlightAt ? now - g_boxOpenInFlightAt : -1
        },
        state: {
            running: g_running,
            scriptBuild: SCRIPT_BUILD_TAG,
            autoOpenBoxes: g_autoOpenBoxes,
            allowUnsafeBoxOpen: g_allowUnsafeBoxOpen,
            boxRightClickBridgeReady: g_stageBoxRightClickBridgeReady,
            boxRightClickMethod: stageBoxRightClickMethodName(),
            openInFlight: g_boxOpenInFlight,
            openDispatching: g_boxOpenDispatching,
            openInFlightType: g_boxOpenInFlightType,
            openInFlightTypeBeforeCount: g_boxOpenInFlightTypeBefore,
            openInFlightTypeBeforeUids: g_boxOpenInFlightTypeBeforeUids,
            lastResult: g_lastBoxOpenResult,
            attemptCount: g_boxAttemptCount,
            queueRecoveryCount: g_boxQueueRecoveryCount,
            pumpRestartCount: g_boxPumpRestartCount,
            bossEnabled: g_autoBossEnabled,
            bossState: g_bossState
        },
        extra: extra || {}
    });
}

function callStageBoxAutoOpen(item) {
    var eventOnlyClear = !!(item && item.eventContentTypeOnly === 2 && g_autoHalloweenEventEnabled);
    if (nativeBoxOpenBusy() || nativeExchangePending()) {
        g_lastBoxOpenResult = '等待游戏原生开箱或交换完成';
        return 0;
    }
    if (Date.now() - g_boxCapacityScanAt >= 1000) {
        scanInventory();
        g_boxCapacityScanAt = Date.now();
    }
    if (g_boxCapacityBlocked || (g_lastSourceCounts || {}).backpackFull) {
        g_lastBoxOpenResult = '背包空间不足，已取消本次开箱，等待清理';
        return 0;
    }
    if (!g_stageBoxRightClickBridgeReady) {
        g_lastBoxOpenResult = 'box-open-disabled: verified StageBox right-click handler unavailable';
        return 0;
    }
    var target = resolveStageBoxRightClickHandler();
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    var instances = findStageBoxInstances();
    var called = 0;
    var boxTypes = [];
    var selectedType = -1;
    var selectedContentType = 0;
    var inventoryBefore = null;
    // Refresh on dispatch: game auto-opening may have consumed the queued IDs.
    var before = scanBoxSnapshot();
    g_boxNativeInstances = instances.slice(0);
    if (nativeBoxOpenBusy()) return 0;
    if (g_autoBossEnabled && g_bossState === 'waitingBox') {
        observeAutoBossBox(null, serializedActBossBoxSnapshot(before));
    }
    var candidates = [];
    for (var i = 0; i < instances.length; i++) {
        var obj = instances[i];
        if (!obj || obj.isNull()) continue;
        try {
            var boxType = info.fields.m_boxType != null ? obj.add(info.fields.m_boxType).readS32() : -1;
            var contentType = info.fields.m_contentType != null ?
                obj.add(info.fields.m_contentType).readS32() : 0;
            if (item && item.eventContentTypeOnly != null &&
                    contentType !== (parseInt(item.eventContentTypeOnly, 10) | 0)) continue;
            var quantity = boxQuantity(before, boxType, contentType);
            boxTypes.push({ type: boxType, contentType: contentType,
                name: BOX_TYPE_NAMES[boxType] || '未知宝箱', quantity: quantity });
            if (quantity > 0) candidates.push({ object: obj, type: boxType,
                contentType: contentType, quantity: quantity });
        } catch (e) {
            boxLog('调用一个开箱实例失败：' + chineseError(e));
        }
    }
    candidates.sort(function (a, b) {
        var aPriority = a.type >= 0 && a.type <= 2 ? a.type : 99;
        var bPriority = b.type >= 0 && b.type <= 2 ? b.type : 99;
        return aPriority - bPriority;
    });
    if (candidates.length > 0) {
        try {
            var selected = candidates[0];
            inventoryBefore = boxLootInventorySnapshot();
            g_boxLogCaptureUntil = Date.now() + 15000;
            g_boxLogPendingAdded = [];
            g_boxResultPendingAdded = [];
            g_lastBoxOpenAt = Date.now();
            g_boxOpenInFlight = true;
            g_boxOpenInFlightAt = g_lastBoxOpenAt;
            g_boxOpenInFlightBefore = before.total;
            g_boxOpenInFlightType = selected.type;
            g_boxOpenInFlightContentType = selected.contentType;
            g_boxOpenInFlightTypeBefore = boxQuantity(before, selected.type, selected.contentType);
            g_boxOpenInFlightTypeBeforeUids = boxUniqueIdsForType(before, selected.type, selected.contentType);
            g_boxOpenInFlightInventoryBefore = inventoryBefore;
            g_boxLastRequestedInventoryBefore = inventoryBefore;
            g_boxLastRequestedCount = before.total;
            g_boxLastRequestedType = selected.type;
            g_boxLastRequestedAt = g_boxOpenInFlightAt;
            g_boxOpenDispatching = true;
            g_boxExchangeErrors = [];
            g_boxActiveClaimUids = boxUniqueIdsForType(before, selected.type, selected.contentType);
            try {
                // This is the game's own bulk/right-click handler. The game
                // groups the whole selected chest type; no OS mouse events are sent.
                target.fn(selected.object, 1, target.mi);
            } finally {
                g_boxOpenDispatching = false;
            }
            called = 1;
            selectedType = selected.type;
            selectedContentType = selected.contentType;
        } catch (callError) {
            clearBoxOpenInFlight();
            g_boxLastRequestedAt = 0;
            g_boxOpenDispatching = false;
            g_boxLogCaptureUntil = 0;
            g_boxLogPendingAdded = [];
            boxLog('调用开箱入口失败：' + chineseError(callError));
        }
    }
    g_boxAttemptCount++;
    var after = scanBoxSnapshot();
    g_lastBoxCount = after.total;
    if (called > 0) {
        g_boxNoInstanceRetryAt = 0;
        scheduleBoxCompletionMonitor();
        g_boxDetectedAt = 0;
        g_boxDetectedCount = 0;
        g_boxDetectedSignature = '';
    }
    g_lastBoxOpenResult = 'requested method=StageBox.' + target.methodName + '(InputButton.Right=1)' +
        ' called=' + called + ' instances=' + instances.length + ' type=' + selectedType +
        ' before=' + before.total + ' after=' + after.total;
    emitBoxDiagnostic(
        called > 0 ? '已调用开箱入口' : '没有可用开箱实例',
        before,
        {
            reason: item && item.reason || '',
            called: called,
            enumeratedInstances: instances.length,
            selectedType: selectedType,
            selectedContentType: selectedContentType,
            boxTypes: boxTypes,
            after: after
        },
        true
    );
    if (called > 0 || Date.now() - g_boxNoInstanceDiagnosticAt >= 30000) {
        if (called <= 0) g_boxNoInstanceDiagnosticAt = Date.now();
        emit('auto_box_open_called', {
            reason: item && item.reason || '',
            method: 'StageBox.' + target.methodName + '(InputButton.Right=1)',
            called: called,
            instances: instances.length,
            selectedType: selectedType,
            selectedContentType: selectedContentType,
            selectedTypeName: BOX_TYPE_NAMES[selectedType] || '未知宝箱',
            before: before,
            after: after,
            boxTypes: boxTypes,
            attemptCount: g_boxAttemptCount
        });
    }
    if (called > 0) {
        boxLog('已发送开箱请求：' + (BOX_TYPE_NAMES[selectedType] || '未知宝箱') +
            '，该类剩余 ' + boxQuantity(before, selectedType, selectedContentType) +
            ' 个，总计 ' + before.total + ' 个。');
    } else {
        g_boxNoInstanceRetryAt = Date.now() + 1000;
        g_lastBoxOpenResult = '检测到宝箱，等待开箱实例可用';
    }
    return called;
}

function hasQueuedBoxOpen() {
    if (g_boxOpenDispatching) return true;
    var now = Date.now();
    var recovered = false;
    for (var i = 0; i < g_queue.length; i++) {
        var item = g_queue[i];
        if (!item || item.action !== 'boxOpen') continue;
        if (now - (item.at || now) <= 3000) return true;
        g_queue.splice(i, 1);
        i--;
        recovered = true;
        g_boxQueueRecoveryCount++;
        g_lastBoxOpenResult = '开箱主线程队列等待超时，已重新排队';
        if (now - g_lastBoxQueueRecoveryLogAt >= 30000) {
            g_lastBoxQueueRecoveryLogAt = now;
            boxLog('开箱主线程队列等待超过 3 秒，已自动重新排队。');
        }
    }
    if (recovered) {
        try {
            ensureUpdateHook();
        } catch (e) {}
        emitBoxDiagnostic('开箱队列自动恢复', scanBoxSnapshot(), {
            reason: '主线程队列等待超过 3 秒'
        }, true);
    }
    return false;
}

function enqueueBoxOpen(reason, beforeSnapshot) {
    var eventOnlyClear = !!(reason === 'eventDungeonCapacity' && g_autoHalloweenEventEnabled);
    if (!g_autoOpenBoxes && !eventOnlyClear) return 'box-disabled';
    if (g_boxCapacityBlocked || (g_lastSourceCounts || {}).backpackFull) return '背包空间不足，等待清理';
    if (!g_stageBoxRightClickBridgeReady)
        return 'box-open-disabled: verified StageBox right-click handler unavailable';
    if (g_bossStageQueued || g_bossState === 'waitingBox') return '等待关卡结束';
    if (g_queue.length || sharedGameActionWaiting() || Date.now() < g_boxYieldUntil) {
        return '等待其他后台操作结束';
    }
    if (synthesisInventoryMutationActive()) return '等待合成结果入包';
    if (!ensureUpdateHook()) return 'update-hook-failed';
    if (hasQueuedBoxOpen()) return 'box-already-queued';
    var snapshot = beforeSnapshot && beforeSnapshot.quantities ? beforeSnapshot : scanBoxSnapshot();
    if (snapshot.total <= 0) return 'no-box';
    g_queue.push({ action: 'boxOpen', reason: reason || '', beforeSnapshot: snapshot, at: Date.now() });
    return 'queued: boxOpen before=' + snapshot.total;
}

function scanBoxSnapshot() {
    var empty = {
        total: 0, quantities: [0, 0, 0], plagueQuantities: [0, 0, 0], eventQuantities: [0, 0, 0],
        types: [], entries: []
    };
    try {
        var player = findPlayerSaveData();
        if (isObviouslyInvalidPtr(player)) return empty;
        var pinfo = classInfo('TaskbarHero', 'PlayerSaveData');
        if (pinfo.fields.BoxData == null) return scanCurrentBoxSnapshot();
        var boxData = player.add(pinfo.fields.BoxData).readPointer();
        if (isObviouslyInvalidPtr(boxData)) return empty;
        var sinfo = classInfo('TaskbarHero', 'SerializedBoxData');
        if (sinfo.fields.BoxTypes == null || sinfo.fields.BoxQuantity == null) return empty;
        var boxTypesPtr = boxData.add(sinfo.fields.BoxTypes).readPointer();
        var quantitiesPtr = boxData.add(sinfo.fields.BoxQuantity).readPointer();
        if (isObviouslyInvalidPtr(boxTypesPtr) || isObviouslyInvalidPtr(quantitiesPtr)) return empty;
        var rawTypes = readIntListOrArray(boxTypesPtr, 64);
        var rawQuantities = readIntListOrArray(quantitiesPtr, 64);
        var rawUniqueIds = sinfo.fields.BoxUniqueId == null ? [] :
            readU64ListOrArray(boxData.add(sinfo.fields.BoxUniqueId).readPointer(), 64);
        var quantities = [0, 0, 0];
        var types = [];
        var entries = [];
        var total = 0;
        var rowCount = Math.min(rawTypes.length, rawQuantities.length);
        for (var i = 0; i < rowCount; i++) {
            var boxType = parseInt(rawTypes[i], 10);
            var quantity = Math.max(0, parseInt(rawQuantities[i], 10) || 0);
            if (boxType >= 0 && boxType < quantities.length) quantities[boxType] += quantity;
            if (quantity > 0) total += quantity;
            entries.push({
                type: boxType,
                name: BOX_TYPE_NAMES[boxType] || '未知宝箱',
                contentType: 0,
                uniqueId: rawUniqueIds[i] || '',
                quantity: quantity
            });
        }
        for (var typeIndex = 0; typeIndex < quantities.length; typeIndex++) {
            types.push({
                type: typeIndex,
                name: BOX_TYPE_NAMES[typeIndex] || '未知宝箱',
                quantity: quantities[typeIndex]
            });
        }
        return {
            total: total, quantities: quantities, plagueQuantities: [0, 0, 0],
            types: types, entries: entries
        };
    } catch (e) {
        g_lastBoxOpenResult = 'box scan failed: ' + e;
        return empty;
    }
}

var g_currentBoxContentField = null;

function resolveCurrentBoxContentField(k) {
    if (g_currentBoxContentField && !g_currentBoxContentField.isNull())
        return g_currentBoxContentField;
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    var preferred = null;
    var candidates = [];
    while (true) {
        var field = il2cpp.classGetFields(k, iter);
        if (!field || field.isNull()) break;
        if ((il2cpp.fieldGetFlags(field) & 0x10) === 0) continue;
        var name = cstr(il2cpp.fieldGetName(field));
        var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
        if (typeName.indexOf('Dictionary<') < 0 ||
                typeName.indexOf('ContentType') < 0) continue;
        candidates.push(field);
        if (name === 'binj') preferred = field;
    }
    if (preferred) return (g_currentBoxContentField = preferred);
    if (candidates.length === 1) return (g_currentBoxContentField = candidates[0]);
    // Some game builds rename the enum type. In that case, inspect static
    // dictionary fields structurally rather than relying on an obfuscated
    // name or a fixed metadata offset.
    if (!candidates.length) {
        var retry = Memory.alloc(PTR);
        retry.writePointer(ptr(0));
        while (true) {
            var fallbackField = il2cpp.classGetFields(k, retry);
            if (!fallbackField || fallbackField.isNull()) break;
            if ((il2cpp.fieldGetFlags(fallbackField) & 0x10) === 0) continue;
            var fallbackType = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(fallbackField)));
            if (fallbackType.indexOf('Dictionary<') >= 0 && fallbackType.indexOf('EBoxType') >= 0)
                candidates.push(fallbackField);
        }
    }
    if (candidates.length === 1) return (g_currentBoxContentField = candidates[0]);
    var diagnostic = classInfo('', cstr(il2cpp.classGetName(k))).fields;
    var fields = classInfo('', cstr(il2cpp.classGetName(k))).fieldTypes;
    var summary = Object.keys(diagnostic).map(function (name) {
        return name + '@0x' + (diagnostic[name] >>> 0).toString(16) + ':' +
            String(fields[name] || '');
    }).join('|');
    throw new Error('新版宝箱内容字典字段未能唯一识别：' + summary);
}


function intPointerDictionaryRows(dictionary, limit) {
    if (isBadPtr(dictionary)) return [];
    var entries = dictionary.add(0x18).readPointer(), count = dictionary.add(0x20).readS32();
    if (isBadPtr(entries) || count < 0 || count > limit) return [];
    var capacity = entries.add(0x18).readS32();
    if (capacity < 0 || capacity > limit * 3) return [];
    var rows = [];
    for (var i = 0; i < Math.min(count, capacity); i++) {
        var entry = entries.add(0x20 + i * 0x18);
        if (entry.readS32() < 0) continue;
        rows.push({key: entry.add(8).readS32(), value: entry.add(0x10).readPointer()});
    }
    return rows;
}

function scanCurrentBoxSnapshot() {
    var snapshot = {total:0, quantities:[0,0,0], plagueQuantities:[0,0,0], eventQuantities:[0,0,0], types:[], entries:[]};
    requireCurrentGameBuild();
    var k = findClassByEnumeratedName('', 'vq');
    if (isBadPtr(k)) return snapshot;
    // Static field metadata offsets vary between game builds; use the
    // reflected field handle, not the old hard-coded offset 0x8.
    var field = resolveCurrentBoxContentField(k);
    var storage = Memory.alloc(PTR); storage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(field, storage);
    intPointerDictionaryRows(storage.readPointer(), 16).forEach(function(content) {
        if (content.key < 0 || content.key > 2) return;
        intPointerDictionaryRows(content.value, 16).forEach(function(type) {
            if (type.key < 0 || type.key > 2 || isBadPtr(type.value)) return;
            var entries = type.value.add(0x18).readPointer(), count = type.value.add(0x20).readS32();
            if (isBadPtr(entries) || count < 0 || count > 100000) return;
            var capacity = entries.add(0x18).readS32();
            if (capacity < 0 || capacity > 200000) return;
            for (var i = 0; i < Math.min(count, capacity); i++) {
                var entry = entries.add(0x20 + i * 0x18);
                if (entry.readS32() < 0) continue;
                var uid = readU64Text(entry.add(8)), quantity = entry.add(0x10).readS32(), itemKey = entry.add(0x14).readS32();
                if (!uid || uid === '0' || quantity <= 0 || quantity > 100000) continue;
                var counts = content.key === 2 ? snapshot.eventQuantities : (content.key === 1 ? snapshot.plagueQuantities : snapshot.quantities);
                counts[type.key] += quantity; snapshot.total += quantity;
                snapshot.entries.push({type:type.key,contentType:content.key,name:BOX_TYPE_NAMES[type.key],uniqueId:uid,quantity:quantity,boxItemKey:itemKey});
            }
        });
    });
    for (var content = 0; content < 3; content++) for (var type = 0; type < 3; type++)
        snapshot.types.push({type:type,contentType:content,name:BOX_TYPE_NAMES[type],quantity:boxQuantity(snapshot,type,content)});
    return snapshot;
}

function boxQuantity(snapshot, boxType, contentType) {
    var counts = contentType === 2 ? snapshot.eventQuantities : (contentType === 1 ? snapshot.plagueQuantities : snapshot.quantities);
    return boxType >= 0 && boxType < (counts || []).length ? counts[boxType] : 0;
}


function boxSnapshotSignature(snapshot) {
    return (snapshot && snapshot.quantities || []).join(',') + '|' +
        (snapshot && snapshot.plagueQuantities || []).join(',') + '|' + (snapshot && snapshot.eventQuantities || []).join(',');
}

function boxUniqueIdsForType(snapshot, boxType, contentType) {
    var result = [];
    var seen = {};
    var entries = snapshot && snapshot.entries || [];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i] || {};
        if (parseInt(entry.type, 10) !== parseInt(boxType, 10)) continue;
        if (parseInt(entry.contentType || 0, 10) !== parseInt(contentType || 0, 10)) continue;
        if ((parseInt(entry.quantity, 10) || 0) <= 0) continue;
        var uid = String(entry.uniqueId || '');
        if (!uid || uid === '0' || seen[uid]) continue;
        seen[uid] = true;
        result.push(uid);
    }
    return result;
}

function removedBoxUniqueIds(beforeUids, afterUids) {
    var current = {};
    var removed = [];
    var i;
    beforeUids = beforeUids || [];
    afterUids = afterUids || [];
    for (i = 0; i < afterUids.length; i++) current[String(afterUids[i])] = true;
    for (i = 0; i < beforeUids.length; i++) {
        var uid = String(beforeUids[i]);
        if (uid && current[uid] !== true) removed.push(uid);
    }
    return removed;
}

function clearBoxOpenInFlight() {
    g_boxOpenInFlight = false;
    g_boxOpenInFlightAt = 0;
    g_boxOpenInFlightBefore = 0;
    g_boxOpenInFlightType = -1;
    g_boxOpenInFlightContentType = 0;
    g_boxOpenInFlightTypeBefore = 0;
    g_boxOpenInFlightTypeBeforeUids = [];
    g_boxOpenInFlightInventoryBefore = null;
    g_boxDetectedAt = 0;
    g_boxDetectedCount = 0;
    g_boxDetectedSignature = '';
}

// Read the live receipt used by xq.ksv, not PlayerSaveData's saved copy.
var g_exchangePendingField = null;
var g_nativeInventoryExchangeRequests = {};
var g_failedExchangeRecoveryQueued = false;
var g_failedExchangeRejections = [];
function nativeExchangeState() {
    var owner = classInfo('', 'zw'), state = classInfo('', 'zc');
    if (state.fields.bjkb == null) return null;
    if (!g_exchangePendingField) {
        Object.keys(owner.fieldTypes).some(function (name) {
            var field = owner.fieldInfos[name];
            if (owner.fieldTypes[name] !== 'zc' || (il2cpp.fieldGetFlags(field) & 0x10) === 0) return false;
            g_exchangePendingField = field;
            return true;
        });
    }
    if (!g_exchangePendingField) return null;
    var storage = Memory.alloc(PTR);
    il2cpp.fieldStaticGetValue(g_exchangePendingField, storage);
    var manager = storage.readPointer();
    if (isBadPtr(manager) || !il2cpp.objectGetClass(manager).equals(state.klass)) return null;
    var receipt = manager.add(state.fields.bjkb).readPointer();
    if (isBadPtr(receipt)) return null;
    var fields = classInfo('TaskbarHero', 'ExchangeReceipt').fields;
    return {manager:manager, receipt:receipt,
        busy:state.fields.bjkf == null || !!manager.add(state.fields.bjkf).readU8(),
        committing:state.fields.bjkg == null || !!manager.add(state.fields.bjkg).readU8(),
        resultItemId:receipt.add(fields.resultItem).readS32(),
        source:il2cppString(receipt.add(fields.source).readPointer()),
        timestamp:il2cppString(receipt.add(fields.timeStamp).readPointer())};
}

function failedExchangeRejectionMatches(state, rejected) {
    if (!state || state.source !== 'Synthesis' || !rejected || Number(rejected.code) !== 5001) return false;
    if (rejected.pid != null && Number(rejected.pid) !== Process.id) return false;
    var at = Date.parse(state.timestamp);
    var requestedAt = Number(rejected.requestedAt);
    return isFinite(at) && requestedAt > 0 && at <= requestedAt && requestedAt - at < 5000 &&
        state.resultItemId === Number(rejected.resultItemId);
}

function queueFailedExchangeRecovery(rejections) {
    (rejections || []).forEach(function (row) {
        if (row && Number(row.code) === 5001) g_failedExchangeRejections.push(row);
    });
    g_failedExchangeRejections = g_failedExchangeRejections.slice(-32);
    if (g_failedExchangeRecoveryQueued || !g_failedExchangeRejections.length) return false;
    var state = nativeExchangeState();
    if (!g_failedExchangeRejections.some(function (row) { return failedExchangeRejectionMatches(state, row); })) return false;
    if (!ensureUpdateHook()) return false;
    g_failedExchangeRecoveryQueued = true;
    g_queue.unshift({action:'failedExchangeRecovery',at:Date.now()});
    return true;
}

function processFailedExchangeRecovery(item) {
    g_failedExchangeRecoveryQueued = false;
    var state = nativeExchangeState();
    if (!g_failedExchangeRejections.some(function (row) { return failedExchangeRejectionMatches(state, row); })) return;
    var busyMethod = resolveCubeBridgeMethod({className:'Cube',methodName:'jix',argCount:0,rva:0x962470});
    var cubeBusy = !!new NativeFunction(busyMethod.ptr,'uint8',['pointer'])(busyMethod.mi);
    if (state.busy || state.committing || Object.keys(g_nativeInventoryExchangeRequests).length ||
            nativeBoxOpenBusy() || cubeBusy) {
        item.deferUntil = Date.now() + 1000;
        g_failedExchangeRecoveryQueued = true;
        g_queue.push(item);
        return;
    }
    var clear = resolveCubeBridgeMethod({namespace:'',className:'zc',methodName:'ltx',argCount:0,rva:0xad8c60});
    new NativeFunction(clear.ptr,'void',['pointer','pointer'])(state.manager,clear.mi);
    if (nativeExchangeState()) throw new Error('失败交换收据清理后仍存在');
    if (g_pendingSynthesisSignature && g_pendingSynthesisAt > 0 &&
            Math.abs(g_pendingSynthesisAt - Date.parse(state.timestamp)) < 5000) {
        var rejectedBatch = g_pendingSynthesisBatch;
        (rejectedBatch && rejectedBatch.items || []).forEach(function (row) {
            rememberRuntimeSynthesisRejection(row,rejectedBatch,{reason:'服务器拒绝旧库存物品',retryMs:60000});
        });
        clearPendingSynthesis();
        g_lastResult = '失败合成已收尾，重新扫描真实库存后继续';
    }
    log('服务器已拒绝的旧合成收据已通过游戏原生取消入口清理，恢复后续自动任务。');
    emit('automation_recovery',{reason:'rejected-exchange-receipt',resultItemId:state.resultItemId,receiptTime:state.timestamp});
    if (g_running) scheduleNext(200);
}
function nativeExchangePending() {
    if (Object.keys(g_nativeInventoryExchangeRequests).length) return true;
    try {
        var owner = classInfo('', 'zw');
        var state = classInfo('', 'zc');
        if (state.fields.bjkb == null) return false;
        if (!g_exchangePendingField) {
            var names = Object.keys(owner.fieldTypes);
            for (var i = 0; i < names.length; i++) {
                var field = owner.fieldInfos[names[i]];
                if (owner.fieldTypes[names[i]] === 'zc' &&
                        (il2cpp.fieldGetFlags(field) & 0x10) !== 0) {
                    g_exchangePendingField = field;
                    break;
                }
            }
        }
        if (!g_exchangePendingField) return false;
        var storage = Memory.alloc(PTR);
        il2cpp.fieldStaticGetValue(g_exchangePendingField, storage);
        var manager = storage.readPointer();
        return !isBadPtr(manager) && il2cpp.objectGetClass(manager).equals(state.klass) &&
            !isBadPtr(manager.add(state.fields.bjkb).readPointer());
    } catch (e) { return false; }
}

var g_boxNativeInstances = [];
var g_boxExchangeErrors = [];
var g_boxActiveClaimUids = [];
var g_boxCompletionTimer = null;
function nativeBoxOpenBusy() {
    var info = classInfo(STAGEBOX_AUTO_OPEN.namespace, STAGEBOX_AUTO_OPEN.className);
    var fields = info.fields;
    for (var i = 0; i < g_boxNativeInstances.length; i++) {
        try {
            var instance = g_boxNativeInstances[i];
            if (isBadPtr(instance) || !il2cpp.objectGetClass(instance).equals(info.klass)) continue;
            // Fields behind StageBox.mob/moc: single open, bulk open, coroutine.
            if ((fields.bknd != null && instance.add(fields.bknd).readU8()) ||
                    (fields.bknf != null && instance.add(fields.bknf).readU8()) ||
                    (fields.bkmy != null && !isBadPtr(instance.add(fields.bkmy).readPointer()))) return true;
        } catch (e) {}
    }
    return false;
}

function boxBatchStillRunning() {
    return nativeBoxOpenBusy() || nativeExchangePending();
}

function scheduleBoxCompletionMonitor() {
    if (g_boxCompletionTimer) return;
    g_boxCompletionTimer = setTimeout(function () {
        g_boxCompletionTimer = null;
        if (!g_boxOpenInFlight) return;
        try { runAutoBoxOpen('native-batch-completion'); }
        catch (e) { g_lastBoxOpenResult = '等待开箱完成：' + chineseError(e); }
        // Observe submitted work across stop/reapply; never submit new work here.
        if (g_boxOpenInFlight) scheduleBoxCompletionMonitor();
    }, 250);
}

function boxLootInventorySnapshot() {
    var counts = {};
    try {
        var player = findPlayerSaveData();
        if (isObviouslyInvalidPtr(player)) return null;
        var playerFields = classInfo('TaskbarHero', 'PlayerSaveData').fields;
        var itemListOffset = playerFields.itemSaveDatas;
        if (itemListOffset == null) return null;

        var sources = readPlacedUidsBackpackStash(player, playerFields);
        var itemInfo = classInfo('TaskbarHero.EasySaveData', 'ItemSaveData');
        var uidOffset = firstFieldOffset(itemInfo.fields,
            ['UniqueId', 'uniqueId', 'ItemUniqueId', 'itemUniqueId', 'UID', 'uid']);
        var itemKeyOffset = firstFieldOffset(itemInfo.fields,
            ['ItemKey', 'itemKey', 'ItemId', 'itemId']);
        if (uidOffset == null || itemKeyOffset == null) return null;
        var quantityOffset = firstFieldOffset(itemInfo.fields, ['Quantity', 'quantity']);
        var rows = readListObjects(player.add(itemListOffset).readPointer());
        var quantitiesByUid = {};
        Object.keys(sources || {}).forEach(function (uid) {
            var total = 0;
            sources[uid].forEach(function (source) {
                total += Math.max(1, source.quantity | 0);
            });
            quantitiesByUid[uid] = total;
        });
        var itemRowsByUid = {};
        for (var i = 0; i < rows.length; i++) {
            var item = rows[i];
            if (!item || item.isNull()) continue;
            var uid = readU64Text(item.add(uidOffset));
            var itemId = readS32Field(item, itemInfo.fields,
                ['ItemKey', 'itemKey', 'ItemId', 'itemId'], 0);
            if (!uid || uid === '0' || itemId <= 0) continue;
            var quantity = quantityOffset == null ? 1 :
                readS32Field(item, itemInfo.fields, ['Quantity', 'quantity'], 1);
            if (quantity < 1 || quantity > 9999) quantity = 1;
            if (quantitiesByUid[uid] > 0) quantity = quantitiesByUid[uid];
            itemRowsByUid[uid] = { itemId: itemId, quantity: quantity };
        }
        Object.keys(itemRowsByUid).forEach(function (uid) {
            var row = itemRowsByUid[uid];
            counts[row.itemId] = (counts[row.itemId] || 0) + row.quantity;
        });
        return counts;
    } catch (e) {
        return null;
    }
}

function boxLootInventoryDelta(before, after) {
    var added = [];
    if (!before || !after) return added;
    Object.keys(after).forEach(function (itemId) {
        var count = after[itemId] - (before[itemId] || 0);
        if (count > 0) added.push({ itemId: parseInt(itemId, 10), count: count });
    });
    return added;
}

function boxLogDestination(now) {
    now = now == null ? Date.now() : now;
    if ((g_boxLogCaptureUntil > 0 && now <= g_boxLogCaptureUntil) ||
            g_boxOpenDispatching || g_boxOpenInFlight || g_boxResultTimer) return 'requested-open';
    return 'native-auto-open';
}

function rememberBoxLogObject(pointerKey, now) {
    var seenAt = Number(g_boxLogSeenObjects[pointerKey]) || 0;
    if (seenAt > 0 && now - seenAt < 60000) return false;
    g_boxLogSeenObjects[pointerKey] = now;
    var keys = Object.keys(g_boxLogSeenObjects);
    if (keys.length > 512) {
        for (var i = 0; i < keys.length; i++) {
            if (now - (Number(g_boxLogSeenObjects[keys[i]]) || 0) > 60000) {
                delete g_boxLogSeenObjects[keys[i]];
            }
        }
        keys = Object.keys(g_boxLogSeenObjects);
        if (keys.length > 512) {
            keys.sort(function (a, b) {
                return g_boxLogSeenObjects[a] - g_boxLogSeenObjects[b];
            });
            for (var j = 0; j < keys.length - 512; j++) delete g_boxLogSeenObjects[keys[j]];
        }
    }
    return true;
}

function establishBoxLogHistoryBaseline(manager, size, readAt) {
    g_boxLogHistoryManager = manager;
    g_boxLogHistoryManagerKey = String(manager);
    g_boxLogHistoryIndex = Math.max(0, size | 0);
    g_boxLogHistoryTail = g_boxLogHistoryIndex > 0 ? String(readAt(g_boxLogHistoryIndex - 1)) : '';
}

function processBoxLogHistoryAppend(manager, size, readAt) {
    size = Math.max(0, size | 0);
    var managerKey = String(manager);
    if (managerKey !== g_boxLogHistoryManagerKey || g_boxLogHistoryIndex < 0) {
        establishBoxLogHistoryBaseline(manager, size, readAt);
        return 0;
    }
    if (size < g_boxLogHistoryIndex) {
        establishBoxLogHistoryBaseline(manager, size, readAt);
        return 0;
    }
    if (g_boxLogHistoryIndex > 0 && g_boxLogHistoryTail) {
        var previousTail = String(readAt(g_boxLogHistoryIndex - 1));
        if (previousTail !== g_boxLogHistoryTail) {
            establishBoxLogHistoryBaseline(manager, size, readAt);
            return 0;
        }
    }

    var captured = 0;
    for (var i = g_boxLogHistoryIndex; i < size; i++) {
        try {
            captureBoxOpenGameLog(readAt(i), 'game-record-history');
            captured++;
        } catch (e) {}
    }
    g_boxLogHistoryIndex = size;
    g_boxLogHistoryTail = size > 0 ? String(readAt(size - 1)) : '';
    return captured;
}

function boxLogHistorySnapshot(manager) {
    if (isBadPtr(manager)) return null;
    var managerFields = classInfo('TaskbarHero.Log', 'LogManager').fields;
    if (managerFields.bjto == null) return null;
    var list = manager.add(managerFields.bjto).readPointer();
    if (isBadPtr(list)) return null;
    var array = list.add(0x10).readPointer();
    var size = list.add(0x18).readS32();
    if (size < 0 || size > 100000 || (size > 0 && isBadPtr(array))) return null;
    return { array: array, size: size };
}

function setBoxLogHistoryManager(manager) {
    if (isBadPtr(manager)) return false;
    var managerKey = String(manager);
    if (managerKey === g_boxLogHistoryManagerKey) return true;
    try {
        var snapshot = boxLogHistorySnapshot(manager);
        if (!snapshot) return false;
        establishBoxLogHistoryBaseline(manager, snapshot.size, function (index) {
            return snapshot.array.add(0x20 + index * Process.pointerSize).readPointer();
        });
        return true;
    } catch (e) {
        return false;
    }
}

function resolveBoxLogHistoryManager() {
    if (!isBadPtr(g_boxLogHistoryManager)) return g_boxLogHistoryManager;
    var now = Date.now();
    if (now - g_boxLogHistoryResolveAt < 10000) return ptr(0);
    g_boxLogHistoryResolveAt = now;
    try {
        var info = classInfo('TaskbarHero.Log', 'LogManager');
        if (!info.klass || isBadPtr(info.klass)) return ptr(0);
        var managers = findObjectsOfType(info.klass);
        if (managers.length > 0 && setBoxLogHistoryManager(managers[0])) return managers[0];
    } catch (e) {}
    return ptr(0);
}

function pollBoxLogHistory() {
    var manager = resolveBoxLogHistoryManager();
    if (isBadPtr(manager)) return 0;
    try {
        var snapshot = boxLogHistorySnapshot(manager);
        if (!snapshot) return 0;
        return processBoxLogHistoryAppend(manager, snapshot.size, function (index) {
            return snapshot.array.add(0x20 + index * Process.pointerSize).readPointer();
        });
    } catch (e) {
        return 0;
    }
}

function scheduleBoxLogHistoryPoll(delayMs) {
    if (g_boxLogHistoryTimer) return;
    g_boxLogHistoryTimer = setTimeout(function () {
        g_boxLogHistoryTimer = null;
        try { pollBoxLogHistory(); } catch (e) {}
        scheduleBoxLogHistoryPoll(g_boxLogHistoryPollIntervalMs);
    }, Math.max(100, delayMs | 0));
}

function startBoxLogHistoryPolling() {
    scheduleBoxLogHistoryPoll(100);
}

// Read the game's pending reward queue. This is separate from BoxOpenLog:
// BoxData is the upcoming/unclaimed queue, while BoxOpenLog is already-earned loot.
function decodeGameDropPreviewObscuredInt(hiddenValue, currentCryptoKey) {
    return (((hiddenValue - currentCryptoKey) ^ currentCryptoKey) | 0);
}

function findGameDropPreviewObscuredOffsets() {
    if (g_gameDropPreviewObscuredOffsets) return g_gameDropPreviewObscuredOffsets;
    if (g_gameDropPreviewObscuredSearchFailedAt &&
            Date.now() - g_gameDropPreviewObscuredSearchFailedAt < 30000) return null;
    var images = allImages();
    for (var imageIndex = 0; imageIndex < images.length; imageIndex++) {
        var klass = il2cpp.classFromName(
            images[imageIndex].image,
            Memory.allocUtf8String('CodeStage.AntiCheat.ObscuredTypes'),
            Memory.allocUtf8String('ObscuredInt')
        );
        if (isBadPtr(klass)) continue;
        var offsets = {};
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var field = il2cpp.classGetFields(klass, iter);
            if (isBadPtr(field)) break;
            var name = cstr(il2cpp.fieldGetName(field));
            if (name === 'hiddenValue' || name === 'currentCryptoKey') {
                offsets[name] = il2cpp.fieldGetOffset(field);
            }
        }
        if (offsets.hiddenValue != null && offsets.currentCryptoKey != null) {
            g_gameDropPreviewObscuredOffsets = offsets;
            g_gameDropPreviewObscuredSearchFailedAt = 0;
            return offsets;
        }
    }
    g_gameDropPreviewObscuredSearchFailedAt = Date.now();
    return null;
}

function readGameDropPreviewObscuredInt(obj, fieldOffset) {
    if (isBadPtr(obj) || fieldOffset == null) return 0;
    var offsets = findGameDropPreviewObscuredOffsets();
    if (!offsets) return 0;
    try {
        // ObscuredInt is stored inline in BoxData; class field offsets include
        // the managed object header, but this nested value does not.
        var nestedBase = obj.add(fieldOffset - 0x10);
        var hidden = nestedBase.add(offsets.hiddenValue).readS32();
        var key = nestedBase.add(offsets.currentCryptoKey).readS32();
        return decodeGameDropPreviewObscuredInt(hidden, key);
    } catch (e) {
        return 0;
    }
}

function gameDropPreviewQueueFieldsForClass(klass) {
    var queueFields = [];
    if (isBadPtr(klass)) return queueFields;
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    while (true) {
        var field = il2cpp.classGetFields(klass, iter);
        if (isBadPtr(field)) break;
        var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
        var flags = il2cpp.fieldGetFlags(field);
        if ((flags & 0x10) === 0 &&
                typeName.indexOf('Dictionary<') !== -1 &&
                typeName.indexOf('TaskbarHero.EBoxType') !== -1 &&
                typeName.indexOf('TaskbarHero.BoxData') !== -1) {
            queueFields.push({
                name: cstr(il2cpp.fieldGetName(field)),
                offset: il2cpp.fieldGetOffset(field),
                typeName: typeName
            });
        }
    }
    return queueFields;
}

function gameDropPreviewFutureQueueFields(fields, managerName, assemblySize) {
    // xm.kqt returns bjjg (+0x10). Game chest creation calls krl, which
    // transfers the exact BoxData from bjjg to bjjh (+0x18) before GetBoxLog.
    // bjjh/bjji are later lifecycle states, even when plain isGet is false.
    if (managerName !== 'yx' || assemblySize !== GAME_ASSEMBLY_VERIFIED_SIZE) return [];
    return fields.filter(function (field) {
        return field.name === 'bjjg' && field.offset === 0x10;
    });
}

function gameDropPreviewDictionaryHasBox(dictionary, boxType, box) {
    if (isBadPtr(dictionary) || isBadPtr(box)) return false;
    var entries = dictionary.add(0x18).readPointer();
    var count = dictionary.add(0x20).readS32();
    if (isBadPtr(entries) || count < 0 || count > 4096) return false;
    var capacity = entries.add(0x18).readS32();
    if (capacity < 0 || capacity > 8192) return false;
    for (var i = 0; i < Math.min(count, capacity); i++) {
        var entry = entries.add(0x20 + i * 0x18);
        if (entry.readS32() < 0 || entry.add(0x08).readS32() !== boxType) continue;
        var list = entry.add(0x10).readPointer();
        if (isBadPtr(list)) return false;
        var array = list.add(0x10).readPointer();
        var size = list.add(0x18).readS32();
        if (isBadPtr(array) || size < 0 || size > 4096) return false;
        for (var j = 0; j < size; j++) {
            if (array.add(0x20 + j * PTR).readPointer().equals(box)) return true;
        }
    }
    return false;
}

function installGameDropPreviewSpawnHooks() {
    if (g_gameDropPreviewSpawnHooks.length) return true;
    var manager = resolveGameDropPreviewManager();
    if (isBadPtr(manager) || !gameDropPreviewFutureQueueFields(
            g_gameDropPreviewManagerFields,
            cstr(il2cpp.classGetName(g_gameDropPreviewManagerClass)), GA.size).length) return false;
    var profiles = [{name: 'lsn', rva: 0xab1590},
        {name: 'kwz', rva: 0xaac270}, {name: 'lma', rva: 0xaac550}];
    profiles.forEach(function (profile) {
        var mi = il2cpp.classGetMethod(g_gameDropPreviewManagerClass,
            Memory.allocUtf8String(profile.name), 4);
        if (isBadPtr(mi) || il2cpp.methodGetParamCount(mi) !== 4 ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi))) !== 'System.Void' ||
                !methodPtr(mi).equals(B.add(profile.rva))) return;
        var expected = ['TaskbarHero.BoxData', 'TaskbarHero.EBoxType'];
        for (var i = 0; i < expected.length; i++) {
            if (cstr(il2cpp.typeGetName(il2cpp.methodGetParam(mi, i))) !== expected[i]) return;
        }
        var implFlags = Memory.alloc(4);
        implFlags.writeU32(0);
        if ((il2cpp.methodGetFlags(mi, implFlags) & 0x10) === 0) return;
        g_gameDropPreviewSpawnHooks.push(Interceptor.attach(methodPtr(mi), {
            onEnter: function (args) {
                this.spawn = null;
                if (!g_gameDropPreviewEnabled) return;
                try {
                    var currentManager = g_gameDropPreviewManager;
                    if (isBadPtr(currentManager)) return;
                    var future = currentManager.add(0x10).readPointer();
                    var spawned = currentManager.add(0x18).readPointer();
                    var boxType = args[1].toInt32();
                    if (!args[2].equals(future) || !args[3].equals(spawned) ||
                            !gameDropPreviewDictionaryHasBox(future, boxType, args[0])) return;
                    this.spawn = {box: args[0], boxType: boxType,
                        future: future, spawned: spawned};
                } catch (e) { emit('game_drop_preview_error', {stage: 'spawn-enter', error: String(e)}); }
            },
            onLeave: function () {
                var row = this.spawn;
                if (!row || !g_gameDropPreviewEnabled) return;
                try {
                    if (gameDropPreviewDictionaryHasBox(row.future, row.boxType, row.box) ||
                            !gameDropPreviewDictionaryHasBox(row.spawned, row.boxType, row.box)) return;
                    var now = Date.now();
                    emit('game_drop_preview_box_spawned', {
                        eventId: String(Process.id) + '-box-spawn-' + now + '-' + (++g_gameDropPreviewSpawnSequence),
                        boxKey: String(row.box), boxType: row.boxType,
                        source: 'game-future-to-spawned-queue', confirmedAt: now
                    });
                } catch (e) { emit('game_drop_preview_error', {stage: 'spawn-leave', error: String(e)}); }
            }
        }));
    });
    return g_gameDropPreviewSpawnHooks.length > 0;
}

// The current live 1.3.0 build uses yx for its BoxData queues and zw.bjlr
// for the singleton. Validate the managed field types before using this fast
// path; if a later update renames or reshapes them, reflection fallback works.
function tryResolveGameDropPreviewKnownQueueClass() {
    if (!isBadPtr(g_gameDropPreviewManagerClass)) return g_gameDropPreviewManagerClass;
    var image = imageByName('Assembly-CSharp.dll');
    if (isBadPtr(image)) return ptr(0);
    var managerClass = il2cpp.classFromName(
        image, Memory.allocUtf8String(''), Memory.allocUtf8String('yx')
    );
    if (isBadPtr(managerClass)) return ptr(0);
    var queueFields = gameDropPreviewQueueFieldsForClass(managerClass);
    if (queueFields.length < 2) return ptr(0);

    var managerName = cstr(il2cpp.classGetName(managerClass));
    var managerNamespace = cstr(il2cpp.classGetNamespace(managerClass));
    var managerTypeName = managerNamespace ? managerNamespace + '.' + managerName : managerName;
    var ownerClass = il2cpp.classFromName(
        image, Memory.allocUtf8String(''), Memory.allocUtf8String('zw')
    );

    g_gameDropPreviewManagerClass = managerClass;
    g_gameDropPreviewManagerFields = queueFields;
    g_gameDropPreviewFastClassName = managerTypeName;
    g_gameDropPreviewDiscoveryMode = 'validated-fast-profile';
    if (isBadPtr(ownerClass)) return managerClass;

    var preferredField = null;
    var matchingFields = [];
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    while (true) {
        var field = il2cpp.classGetFields(ownerClass, iter);
        if (isBadPtr(field)) break;
        if ((il2cpp.fieldGetFlags(field) & 0x10) === 0) continue;
        var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
        if (typeName !== managerTypeName && typeName !== managerName) continue;
        matchingFields.push(field);
        if (cstr(il2cpp.fieldGetName(field)) === 'bjlr') preferredField = field;
    }
    if (preferredField) matchingFields.unshift(preferredField);
    for (var fieldIndex = 0; fieldIndex < matchingFields.length; fieldIndex++) {
        var candidateField = matchingFields[fieldIndex];
        var storage = Memory.alloc(PTR);
        storage.writePointer(ptr(0));
        try {
            il2cpp.fieldStaticGetValue(candidateField, storage);
            var manager = storage.readPointer();
            if (isBadPtr(manager) || !il2cpp.objectGetClass(manager).equals(managerClass)) continue;
            g_gameDropPreviewManagerSingletonField = candidateField;
            g_gameDropPreviewManager = manager;
            return managerClass;
        } catch (e) {}
    }
    return managerClass;
}

function gameDropPreviewScheduleDiscovery(delayMs) {
    if (g_gameDropPreviewDiscoveryTimer || !g_gameDropPreviewDiscovery) return;
    g_gameDropPreviewDiscoveryTimer = setTimeout(function () {
        g_gameDropPreviewDiscoveryTimer = null;
        try {
            gameDropPreviewDiscoveryChunk();
        } catch (e) {
            gameDropPreviewPublishDiscoveryResult('定位游戏奖励队列失败：' + String(e));
        }
    }, Math.max(0, delayMs | 0));
}

function gameDropPreviewPublishDiscoveryResult(reason) {
    var state = g_gameDropPreviewDiscovery;
    g_gameDropPreviewDiscovery = null;
    if (!state) return;
    if (state.phase === 'manager-class') g_gameDropPreviewClassSearchFailedAt = Date.now();
    else g_gameDropPreviewResolveAt = Date.now();
    var duration = Math.max(0, Date.now() - state.startedAt);
    setTimeout(function () {
        var snapshot;
        try {
            snapshot = readGameDropPreviewSnapshot();
        } catch (e) {
            snapshot = {
                available: false, status: 'waiting', reason: reason || '读取游戏奖励队列失败',
                queues: [], pendingBoxCount: 0, resolvedCount: 0, unresolvedBoxCount: 0
            };
        }
        snapshot.discoveryDurationMs = duration;
        try { snapshot.stageKey = currentAutoBossStage().stageKey; } catch (e) {}
        emit('game_drop_preview_update', snapshot);
    }, 0);
}

function gameDropPreviewDiscoveryChunk() {
    var state = g_gameDropPreviewDiscovery;
    if (!state) return;
    var chunkStartedAt = Date.now();
    var visited = 0;
    while (state.index < state.classCount && visited < 24 &&
            (visited === 0 || Date.now() - chunkStartedAt < 5)) {
        var klass = state.getClass(state.image, state.index++);
        visited++;
        if (isBadPtr(klass)) continue;
        if (state.phase === 'manager-class') {
            var queueFields = gameDropPreviewQueueFieldsForClass(klass);
            if (!queueFields.length) continue;
            g_gameDropPreviewManagerClass = klass;
            g_gameDropPreviewManagerFields = queueFields;
            var discoveredName = cstr(il2cpp.classGetName(klass));
            var discoveredNamespace = cstr(il2cpp.classGetNamespace(klass));
            g_gameDropPreviewFastClassName = discoveredNamespace ?
                discoveredNamespace + '.' + discoveredName : discoveredName;
            g_gameDropPreviewDiscoveryMode = 'runtime-class-scan';
            g_gameDropPreviewClassSearchFailedAt = 0;
            state.phase = 'singleton-holder';
            state.index = 0;
            var managerName = cstr(il2cpp.classGetName(klass));
            var managerNamespace = cstr(il2cpp.classGetNamespace(klass));
            state.expectedType = managerNamespace ? managerNamespace + '.' + managerName : managerName;
            continue;
        }
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var field = il2cpp.classGetFields(klass, iter);
            if (isBadPtr(field)) break;
            if ((il2cpp.fieldGetFlags(field) & 0x10) === 0) continue;
            var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
            var managerNameForMatch = cstr(il2cpp.classGetName(g_gameDropPreviewManagerClass));
            if (typeName !== state.expectedType && typeName !== managerNameForMatch) continue;
            var manager = gameDropPreviewManagerFromStaticField(field, g_gameDropPreviewManagerClass);
            g_gameDropPreviewManagerSingletonField = field;
            if (!isBadPtr(manager)) {
                g_gameDropPreviewManager = manager;
                g_gameDropPreviewDiscoveryMode = 'runtime-reflection-fallback';
                gameDropPreviewPublishDiscoveryResult('');
                return;
            }
        }
    }
    if (state.index >= state.classCount) {
        gameDropPreviewPublishDiscoveryResult(
            state.phase === 'manager-class' ? '未找到游戏奖励列表类型' : '游戏奖励列表尚未初始化'
        );
        return;
    }
    gameDropPreviewScheduleDiscovery(15);
}

function gameDropPreviewBeginDiscovery(phase) {
    if (g_gameDropPreviewDiscovery || g_gameDropPreviewDiscoveryTimer) return;
    var image = imageByName('Assembly-CSharp.dll');
    if (isBadPtr(image)) return;
    var classCount = api('il2cpp_image_get_class_count', 'int', ['pointer']);
    var getClass = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    var state = {
        image: image,
        classCount: classCount(image),
        getClass: getClass,
        index: 0,
        phase: phase || 'manager-class',
        expectedType: '',
        startedAt: Date.now()
    };
    if (state.phase === 'singleton-holder' && !isBadPtr(g_gameDropPreviewManagerClass)) {
        var managerName = cstr(il2cpp.classGetName(g_gameDropPreviewManagerClass));
        var managerNamespace = cstr(il2cpp.classGetNamespace(g_gameDropPreviewManagerClass));
        state.expectedType = managerNamespace ? managerNamespace + '.' + managerName : managerName;
    }
    g_gameDropPreviewDiscovery = state;
    gameDropPreviewScheduleDiscovery(0);
}

function findGameDropPreviewManagerClass() {
    if (!isBadPtr(g_gameDropPreviewManagerClass)) return g_gameDropPreviewManagerClass;
    var knownClass = tryResolveGameDropPreviewKnownQueueClass();
    if (!isBadPtr(knownClass)) return knownClass;
    if (g_gameDropPreviewClassSearchFailedAt &&
            Date.now() - g_gameDropPreviewClassSearchFailedAt < 30000) return ptr(0);
    gameDropPreviewBeginDiscovery('manager-class');
    return ptr(0);
}

function gameDropPreviewManagerFromStaticField(field, managerClass) {
    if (isBadPtr(field) || isBadPtr(managerClass)) return ptr(0);
    try {
        var storage = Memory.alloc(PTR);
        storage.writePointer(ptr(0));
        il2cpp.fieldStaticGetValue(field, storage);
        var manager = storage.readPointer();
        if (isBadPtr(manager) || !il2cpp.objectGetClass(manager).equals(managerClass)) return ptr(0);
        return manager;
    } catch (e) {
        return ptr(0);
    }
}

function resolveGameDropPreviewManager() {
    var managerClass = findGameDropPreviewManagerClass();
    if (isBadPtr(managerClass)) return ptr(0);
    if (!isBadPtr(g_gameDropPreviewManager)) {
        try {
            if (il2cpp.objectGetClass(g_gameDropPreviewManager).equals(managerClass)) {
                return g_gameDropPreviewManager;
            }
        } catch (e) {}
        g_gameDropPreviewManager = ptr(0);
    }
    if (g_gameDropPreviewManagerSingletonField &&
            !g_gameDropPreviewManagerSingletonField.isNull()) {
        var cached = gameDropPreviewManagerFromStaticField(
            g_gameDropPreviewManagerSingletonField, managerClass
        );
        if (!isBadPtr(cached)) {
            g_gameDropPreviewManager = cached;
            return cached;
        }
    }
    var now = Date.now();
    if (now - g_gameDropPreviewResolveAt < 10000) return ptr(0);
    g_gameDropPreviewResolveAt = now;
    gameDropPreviewBeginDiscovery('singleton-holder');
    return ptr(0);
}

function gameDropPreviewReadQueueDictionary(dictionary, queueRows, seenBoxes, managerField) {
    if (isBadPtr(dictionary)) return 0;
    try {
        var entries = dictionary.add(0x18).readPointer();
        var count = dictionary.add(0x20).readS32();
        if (isBadPtr(entries) || count < 0 || count > 4096) return 0;
        var capacity = entries.add(0x18).readS32();
        if (capacity < 0 || capacity > 8192) return 0;
        var rowCount = Math.min(count, capacity);
        for (var rowIndex = 0; rowIndex < rowCount; rowIndex++) {
            var entry = entries.add(0x20 + rowIndex * 0x18);
            if (entry.readS32() < 0) continue;
            var boxType = entry.add(0x08).readS32();
            var list = entry.add(0x10).readPointer();
            if (isBadPtr(list)) continue;
            var array = list.add(0x10).readPointer();
            var size = list.add(0x18).readS32();
            if (isBadPtr(array) || size < 0 || size > 4096) continue;
            var queue = queueRows[boxType] || (queueRows[boxType] = []);
            for (var itemIndex = 0; itemIndex < size; itemIndex++) {
                var box = array.add(0x20 + itemIndex * PTR).readPointer();
                if (isBadPtr(box)) continue;
                var boxKey = String(box);
                if (seenBoxes[boxKey]) continue;
                seenBoxes[boxKey] = true;
                queue.push({ object: box, sourceField: managerField && managerField.name || '' });
            }
        }
    } catch (e) {}
    return 1;
}

function resolveGameDropPreviewContentTypeBridge() {
    if (g_gameDropPreviewContentTypeBridge !== null) {
        return g_gameDropPreviewContentTypeBridge || null;
    }
    g_gameDropPreviewContentTypeBridge = false;
    // lsk is the game's own item-ID -> EContentType lookup. Pin this profile
    // to the build whose method, signature, and return values were inspected.
    if (GA.size !== GAME_ASSEMBLY_VERIFIED_SIZE) return null;
    var image = imageByName('Assembly-CSharp.dll');
    if (isBadPtr(image)) return null;
    var managerClass = g_gameDropPreviewManagerClass;
    if (isBadPtr(managerClass)) {
        managerClass = il2cpp.classFromName(
            image, Memory.allocUtf8String(''), Memory.allocUtf8String('yx')
        );
    }
    if (isBadPtr(managerClass) || cstr(il2cpp.classGetName(managerClass)) !== 'yx') return null;
    try {
        var methodInfo = il2cpp.classGetMethod(
            managerClass, Memory.allocUtf8String('lsk'), 1
        );
        if (isBadPtr(methodInfo) ||
                !il2cpp.methodGetClass(methodInfo).equals(managerClass) ||
                cstr(il2cpp.methodGetName(methodInfo)) !== 'lsk' ||
                il2cpp.methodGetParamCount(methodInfo) !== 1 ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetParam(methodInfo, 0))) !== 'System.Int32' ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(methodInfo))) !==
                    'TaskbarHero.Data.EContentType') return null;
        var implFlags = Memory.alloc(4);
        implFlags.writeU32(0);
        if ((il2cpp.methodGetFlags(methodInfo, implFlags) & 0x10) === 0 ||
                !methodPtr(methodInfo).equals(B.add(0xab10b0))) return null;
        var classify = new NativeFunction(methodPtr(methodInfo), 'int32', ['int32', 'pointer']);
        g_gameDropPreviewContentTypeBridge = {
            methodInfo: methodInfo,
            classify: function (itemId) {
                return classify(itemId | 0, methodInfo) | 0;
            }
        };
        return g_gameDropPreviewContentTypeBridge;
    } catch (e) {
        return null;
    }
}

function gameDropPreviewContentTypeForSource(boxItemId, classifyContentType) {
    var itemId = parseInt(boxItemId, 10);
    if (!(itemId > 0) || typeof classifyContentType !== 'function') return null;
    try {
        var contentType = classifyContentType(itemId) | 0;
        return contentType >= 0 && contentType <= 2 ? contentType : null;
    } catch (e) {
        return null;
    }
}

function readGameDropPreviewSnapshot(skipSourceClassification) {
    var manager = resolveGameDropPreviewManager();
    if (isBadPtr(manager)) {
        var searching = !!g_gameDropPreviewDiscovery;
        return {
            available: false,
            status: searching ? 'searching' : 'waiting',
            reason: searching ? '正在后台分段定位游戏奖励队列…' : '尚未定位游戏奖励队列',
            discoveryMode: g_gameDropPreviewDiscoveryMode,
            managerTypeName: g_gameDropPreviewFastClassName,
            queues: [], pendingBoxCount: 0, resolvedCount: 0, unresolvedBoxCount: 0
        };
    }
    if (g_gameDropPreviewEnabled) installGameDropPreviewSpawnHooks();
    var boxInfo = classInfo('TaskbarHero', 'BoxData');
    var requiredFields = ['isGet', 'itemId', 'rewardItemId', 'o_itemId', 'o_rewardItemId'];
    for (var requiredIndex = 0; requiredIndex < requiredFields.length; requiredIndex++) {
        if (boxInfo.fields[requiredFields[requiredIndex]] == null) {
            return {
                available: false, status: 'unsupported',
                reason: '当前游戏 BoxData 字段布局未识别', queues: [],
                discoveryMode: g_gameDropPreviewDiscoveryMode,
                managerTypeName: g_gameDropPreviewFastClassName,
                pendingBoxCount: 0, resolvedCount: 0, unresolvedBoxCount: 0
            };
        }
    }
    var futureFields = gameDropPreviewFutureQueueFields(g_gameDropPreviewManagerFields,
        cstr(il2cpp.classGetName(g_gameDropPreviewManagerClass)), GA.size);
    if (!futureFields.length) return {available: false, status: 'unsupported',
        reason: '当前游戏的后续掉落队列未验证', queues: [], pendingBoxCount: 0,
        resolvedCount: 0, unresolvedBoxCount: 0};
    var queueRows = {};
    var seenBoxes = {};
    var dictionaryCount = 0;
    for (var fieldIndex = 0; fieldIndex < futureFields.length; fieldIndex++) {
        var managerField = futureFields[fieldIndex];
        var dictionary = manager.add(managerField.offset).readPointer();
        if (isBadPtr(dictionary)) continue;
        dictionaryCount += gameDropPreviewReadQueueDictionary(
            dictionary, queueRows, seenBoxes, managerField
        );
    }
    if (!dictionaryCount) {
        return {
            available: false, status: 'waiting', reason: '游戏奖励列表尚未初始化', queues: [],
            discoveryMode: g_gameDropPreviewDiscoveryMode,
            managerTypeName: g_gameDropPreviewFastClassName,
            pendingBoxCount: 0, resolvedCount: 0, unresolvedBoxCount: 0
        };
    }
    var queues = [];
    var contentTypeOffset = null;
    var contentTypeFieldName = '';
    if (skipSourceClassification !== true) {
        var contentTypeCandidates = ['m_contentType', 'contentType', 'm_boxContentType', 'boxContentType'];
        for (var contentTypeIndex = 0; contentTypeIndex < contentTypeCandidates.length; contentTypeIndex++) {
            var candidateName = contentTypeCandidates[contentTypeIndex];
            if (boxInfo.fields[candidateName] != null) {
                contentTypeOffset = boxInfo.fields[candidateName];
                contentTypeFieldName = candidateName;
                break;
            }
        }
    }
    var sourceContentTypeBridge = null;
    var sourceContentTypeBridgeResolved = false;
    var contentTypeBySourceItemId = {};
    var pendingBoxCount = 0;
    var resolvedCount = 0;
    var unresolvedBoxCount = 0;
    var contentTypeReadableRowCount = 0;
    var contentTypeFieldRowCount = 0;
    var contentTypeSourceItemRowCount = 0;
    Object.keys(queueRows).map(function (value) { return parseInt(value, 10); })
        .sort(function (a, b) { return a - b; }).forEach(function (boxType) {
            var queue = queueRows[boxType] || [];
            var items = [];
            for (var itemIndex = 0; itemIndex < queue.length; itemIndex++) {
                var queueEntry = queue[itemIndex];
                var box = queueEntry.object || queueEntry;
                var boxItemId = readS32Field(box, boxInfo.fields, ['itemId'], 0);
                if (!(boxItemId > 0)) {
                    boxItemId = readGameDropPreviewObscuredInt(box, boxInfo.fields.o_itemId);
                }
                var rewardItemId = readS32Field(box, boxInfo.fields, ['rewardItemId'], 0);
                if (!(rewardItemId > 0)) {
                    rewardItemId = readGameDropPreviewObscuredInt(
                        box, boxInfo.fields.o_rewardItemId
                    );
                }
                if (rewardItemId < 0 || rewardItemId > 999999999) rewardItemId = 0;
                var item = {
                    boxKey: String(box),
                    boxItemId: boxItemId > 0 ? boxItemId : 0,
                    rewardItemId: rewardItemId,
                    order: items.length + 1
                };
                var contentType = null;
                var contentTypeFromSourceItem = false;
                if (contentTypeOffset != null) {
                    var fieldContentType = readS32Field(
                        box, boxInfo.fields, [contentTypeFieldName], -1
                    );
                    if (fieldContentType >= 0 && fieldContentType <= 2) {
                        contentType = fieldContentType;
                    }
                }
                if (skipSourceClassification !== true && contentType == null && boxItemId > 0 &&
                        !sourceContentTypeBridgeResolved) {
                    sourceContentTypeBridge = resolveGameDropPreviewContentTypeBridge();
                    sourceContentTypeBridgeResolved = true;
                }
                if (skipSourceClassification !== true && contentType == null &&
                        sourceContentTypeBridge && boxItemId > 0) {
                    var sourceItemKey = String(boxItemId);
                    if (!Object.prototype.hasOwnProperty.call(
                            contentTypeBySourceItemId, sourceItemKey)) {
                        contentTypeBySourceItemId[sourceItemKey] =
                            gameDropPreviewContentTypeForSource(
                                boxItemId, sourceContentTypeBridge.classify
                            );
                    }
                    contentType = contentTypeBySourceItemId[sourceItemKey];
                    contentTypeFromSourceItem = contentType != null;
                }
                if (contentType >= 0 && contentType <= 2) {
                    item.contentType = contentType;
                    contentTypeReadableRowCount++;
                    if (contentTypeFromSourceItem) contentTypeSourceItemRowCount++;
                    else contentTypeFieldRowCount++;
                }
                items.push(item);
                pendingBoxCount++;
                if (rewardItemId > 0) resolvedCount++;
                else unresolvedBoxCount++;
            }
            if (!items.length) return;
            queues.push({
                boxType: boxType,
                boxTypeName: BOX_TYPE_NAMES[boxType] || ('宝箱类型 ' + boxType),
                count: items.length,
                items: items
            });
        });
    return {
        available: true,
        status: pendingBoxCount ? (resolvedCount ? 'ready' : 'unresolved') : 'empty',
        source: 'game-future-box-queue',
        spawnHookReady: g_gameDropPreviewSpawnHooks.length > 0,
        managerType: managedType(manager),
        discoveryMode: g_gameDropPreviewDiscoveryMode,
        contentTypeSupported: contentTypeReadableRowCount > 0,
        contentTypeSource: contentTypeSourceItemRowCount && contentTypeFieldRowCount ? 'mixed' :
            (contentTypeSourceItemRowCount ? 'source-item-id' :
                (contentTypeFieldRowCount ? contentTypeFieldName : '')),
        sampledAt: Date.now(),
        queues: queues,
        pendingBoxCount: pendingBoxCount,
        resolvedCount: resolvedCount,
        unresolvedBoxCount: unresolvedBoxCount
    };
}

function readGameDropPreviewPendingKeysSnapshot() {
    var manager = resolveGameDropPreviewManager();
    if (isBadPtr(manager)) {
        return {
            available: false,
            status: g_gameDropPreviewDiscovery ? 'searching' : 'waiting',
            reason: '尚未定位游戏奖励队列',
            sampledAt: Date.now(),
            boxKeys: [],
            pendingBoxCount: 0
        };
    }
    var boxInfo = classInfo('TaskbarHero', 'BoxData');
    if (boxInfo.fields.isGet == null) {
        return {
            available: false,
            status: 'unsupported',
            reason: '当前游戏 BoxData 字段布局未识别',
            sampledAt: Date.now(),
            boxKeys: [],
            pendingBoxCount: 0
        };
    }
    var futureFields = gameDropPreviewFutureQueueFields(g_gameDropPreviewManagerFields,
        cstr(il2cpp.classGetName(g_gameDropPreviewManagerClass)), GA.size);
    if (!futureFields.length) return {available: false, status: 'unsupported',
        boxKeys: [], pendingBoxCount: 0, reason: '当前游戏的后续掉落队列未验证'};
    var queueRows = {};
    var seenBoxes = {};
    var dictionaryCount = 0;
    for (var fieldIndex = 0; fieldIndex < futureFields.length; fieldIndex++) {
        var managerField = futureFields[fieldIndex];
        var dictionary = manager.add(managerField.offset).readPointer();
        if (isBadPtr(dictionary)) continue;
        dictionaryCount += gameDropPreviewReadQueueDictionary(
            dictionary, queueRows, seenBoxes, managerField
        );
    }
    if (!dictionaryCount) {
        return {
            available: false,
            status: 'waiting',
            reason: '游戏奖励列表尚未初始化',
            sampledAt: Date.now(),
            boxKeys: [],
            pendingBoxCount: 0
        };
    }
    var boxKeys = [];
    Object.keys(queueRows).forEach(function (boxType) {
        var queue = queueRows[boxType] || [];
        for (var itemIndex = 0; itemIndex < queue.length; itemIndex++) {
            var box = queue[itemIndex].object || queue[itemIndex];
            boxKeys.push(String(box));
        }
    });
    return {
        available: true,
        status: boxKeys.length ? 'ready' : 'empty',
        sampledAt: Date.now(),
        boxKeys: boxKeys,
        pendingBoxCount: boxKeys.length
    };
}

function captureBoxOpenGameLog(logData, source) {
    if (isBadPtr(logData)) return;
    try {
        var runtimeClass = il2cpp.objectGetClass(logData);
        if (isBadPtr(runtimeClass) || cstr(il2cpp.classGetName(runtimeClass)) !== 'BoxOpenLog' ||
                cstr(il2cpp.classGetNamespace(runtimeClass)) !== 'TaskbarHero.Log') return;
        var pointerKey = String(logData);
        var now = Date.now();
        var baseFields = classInfo('TaskbarHero.Log', 'LogData').fields;
        var boxFields = classInfo('TaskbarHero.Log', 'BoxOpenLog').fields;
        if (baseFields.bjth == null || boxFields.bjrr == null || boxFields.bjrs == null) return;
        var eventKey = il2cppString(logData.add(baseFields.bjth).readPointer());
        if (eventKey !== 'LogMessage_GetItemWithBoxOpen') return;
        var itemName = il2cppString(logData.add(boxFields.bjrr).readPointer());
        var itemMatch = /^ItemName_(\d+)$/.exec(itemName);
        if (!itemMatch) return;
        if (!rememberBoxLogObject(pointerKey, now)) return;
        var itemId = parseInt(itemMatch[1], 10);
        if (!(itemId > 0)) return;
        var gradeValue = logData.add(boxFields.bjrs).readS32();
        var grade = gradeZh(gradeValue);
        if (boxLogDestination(now) === 'requested-open') {
            var existing = null;
            for (var i = 0; i < g_boxLogPendingAdded.length; i++) {
                var row = g_boxLogPendingAdded[i];
                if (row.itemId === itemId && row.grade === grade) {
                    existing = row;
                    break;
                }
            }
            if (existing) existing.count++;
            else g_boxLogPendingAdded.push({ itemId: itemId, count: 1, grade: grade, gradeValue: gradeValue });
            return;
        }

        g_boxLootEventSequence++;
        var lootMapName = '';
        try { lootMapName = fridaStageName(currentAutoBossStage()); } catch (mapError) {}
        emit('auto_box_loot_observed', {
            success: true,
            eventId: String(Process.id) + '-game-box-loot-' + now + '-' + g_boxLootEventSequence,
            source: source || 'game-log-native',
            boxType: -1,
            boxTypeName: '游戏自动开箱',
            mapName: lootMapName,
            produced: [{ itemId: itemId, count: 1, grade: grade, gradeValue: gradeValue }],
            lootDetection: 'game-log-native',
            confirmedAt: now
        });
    } catch (e) {}
}

function scheduleBoxLootResult(metadata, beforeInventory, initialProduced) {
    if (g_boxResultTimer) {
        if (initialProduced && initialProduced.length) g_boxResultPendingAdded = initialProduced.slice(0);
        return;
    }
    g_boxResultPendingAdded = (g_boxResultPendingAdded || []).concat(initialProduced || []);
    g_boxResultObservedInventoryAdded = boxLootInventoryDelta(
        beforeInventory, boxLootInventorySnapshot());
    var resultStartedAt = Date.now();
    var resultWindowMs = g_boxResultWindowMs;
    function sampleBoxLootResult() {
        if (!g_boxResultTimer) return;
        if (boxBatchStillRunning()) {
            g_boxLogCaptureUntil = Date.now() + 15000;
            g_boxResultTimer = setTimeout(sampleBoxLootResult, 250);
            return;
        }
        var callbackProduced = (g_boxResultPendingAdded || []).slice(0);
        var gameLogProduced = (g_boxLogPendingAdded || []).slice(0);
        var afterInventory = boxLootInventorySnapshot();
        var inventoryProduced = beforeInventory && afterInventory ?
            boxLootInventoryDelta(beforeInventory, afterInventory) : [];
        if (inventoryProduced.length) g_boxResultObservedInventoryAdded = inventoryProduced;
        var produced = callbackProduced.length ? callbackProduced :
            (gameLogProduced.length ? gameLogProduced : g_boxResultObservedInventoryAdded);
        var elapsed = Date.now() - resultStartedAt;
        if (produced.length || elapsed >= resultWindowMs) {
            var lootDetection = beforeInventory && afterInventory ? 'not-found' : 'inventory-scan-unavailable';
            if (g_boxResultObservedInventoryAdded.length) lootDetection = 'inventory-delta';
            if (gameLogProduced.length) lootDetection = 'game-log';
            if (callbackProduced.length) lootDetection = 'game-result';
            if (!produced.length) {
                g_lastBoxOpenResult = lootDetection === 'not-found' ?
                    '开箱已确认，但 15 秒后台物品采样未发现新增物品' :
                    '开箱已确认，但产物回调和后台物品采样均未取得明细';
            }
            if (!(metadata.consumedCount > 0)) {
                g_lastBoxOpenResult = metadata.error || '原生开箱已结束，未确认宝箱消耗';
                boxLog('开箱未确认：' + g_lastBoxOpenResult);
            }
            emit('auto_box_open_result', {
                success: metadata.consumedCount > 0,
                eventId: metadata.eventId,
                boxType: metadata.boxType,
                boxTypeName: metadata.boxTypeName,
                mapName: (function () { try { return fridaStageName(currentAutoBossStage()); } catch (mapError) { return ''; } })(),
                consumedCount: metadata.consumedCount,
                produced: produced,
                lootDetection: lootDetection,
                gameAddedCount: callbackProduced.length,
                gameLogAddedCount: gameLogProduced.reduce(function (total, row) {
                    return total + Math.max(0, parseInt(row.count, 10) || 0);
                }, 0),
                inventoryScanAvailable: !!(beforeInventory && afterInventory),
                detectionWindowMs: resultWindowMs,
                serverConfirmed: metadata.serverConfirmed === true,
                error: String(metadata.error || ''),
                confirmationSource: metadata.confirmationSource,
                confirmedAt: metadata.confirmedAt || Date.now()
            });
            g_boxResultTimer = null;
            g_boxResultPendingAdded = [];
            g_boxResultObservedInventoryAdded = [];
            g_boxLogCaptureUntil = 0;
            g_boxLogPendingAdded = [];
            g_boxActiveClaimUids = [];
            clearBoxOpenInFlight();
            g_boxLastRequestedCount = 0;
            g_boxLastRequestedAt = 0;
            g_boxLastRequestedInventoryBefore = null;
            markSharedGameAction(3000);
            if (g_synthesisEnabled) g_boxYieldUntil = Date.now() + 4500;
            return;
        }
        g_boxResultTimer = setTimeout(sampleBoxLootResult, 1000);
    }
    g_boxResultTimer = setTimeout(sampleBoxLootResult, 300);
}

function runAutoBoxOpen(reason) {
    if (reason === 'native-batch-completion' && !g_boxOpenInFlight) return 'no-active-batch';
    if (!g_stageBoxRightClickBridgeReady) {
        g_lastBoxOpenResult = 'box-open-disabled: verified StageBox right-click handler unavailable';
        return g_lastBoxOpenResult;
    }
    if (g_boxResultTimer) return '等待开箱产物入包';
    if (!g_boxOpenInFlight && ((g_lastSourceCounts || {}).backpackFull || g_boxCapacityBlocked)) {
        g_lastBoxOpenResult = '背包已满或正在清理，暂停开箱';
        return g_lastBoxOpenResult;
    }
    if (hasQueuedBoxOpen()) {
        g_lastBoxOpenResult = 'box-already-queued';
        return 'box-already-queued';
    }
    var now = Date.now();
    if (g_boxOpenInFlight && boxBatchStillRunning()) {
        // A native bulk open awaits each box. A decrease is only progress.
        // Do not rescan inventory or release ownership during this wait.
        g_boxLogCaptureUntil = now + 15000;
        g_lastBoxOpenResult = '游戏正在逐个开箱，等待整批完成';
        return g_lastBoxOpenResult;
    }
    if (now < g_boxNoInstanceRetryAt) {
        g_lastBoxOpenResult = '等待开箱实例可用';
        return g_lastBoxOpenResult;
    }
    var snapshot = scanBoxSnapshot();
    if (g_autoBossEnabled && g_bossState === 'waitingBox') {
        observeAutoBossBox(null, serializedActBossBoxSnapshot(snapshot));
    }
    var count = snapshot.total;
    g_lastBoxCount = snapshot.total;
    g_boxSweepActive = count > 0;
    if (count > 0) {
        emitBoxDiagnostic('检测到宝箱', snapshot, { reason: reason || '' }, false);
    }

    if (g_boxOpenInFlight) {
        var currentTypeCount = boxQuantity(
            snapshot, g_boxOpenInFlightType, g_boxOpenInFlightContentType
        );
        var currentTypeUids = boxUniqueIdsForType(
            snapshot, g_boxOpenInFlightType, g_boxOpenInFlightContentType
        );
        var removedTypeUids = removedBoxUniqueIds(g_boxOpenInFlightTypeBeforeUids, currentTypeUids);
        var countChanged = currentTypeCount < g_boxOpenInFlightTypeBefore || count <= 0;
        var uidChanged = removedTypeUids.length > 0;
        if (countChanged || uidChanged) {
            var confirmedType = g_boxOpenInFlightType;
            var confirmedCount = Math.max(1, removedTypeUids.length,
                g_boxOpenInFlightTypeBefore - currentTypeCount);
            var confirmationSource = countChanged ? '数量变化' : '唯一编号变化';
            var beforeInventory = g_boxOpenInFlightInventoryBefore;
            var eventId = String(Process.id) + '-box-' + g_boxLastRequestedAt + '-' + confirmedType;
            boxLog('已确认开箱：' + (BOX_TYPE_NAMES[confirmedType] || '宝箱') + ' ' + confirmedCount + ' 个。');
            emit('auto_box_open_confirmed', {
                eventId: eventId,
                boxType: confirmedType,
                contentType: g_boxOpenInFlightContentType,
                boxTypeName: BOX_TYPE_NAMES[confirmedType] || '未知宝箱',
                consumedCount: confirmedCount,
                beforeCount: g_boxOpenInFlightTypeBefore,
                afterCount: currentTypeCount,
                beforeUniqueIds: g_boxOpenInFlightTypeBeforeUids,
                afterUniqueIds: currentTypeUids,
                removedUniqueIds: removedTypeUids,
                confirmationSource: confirmationSource,
                confirmedAt: now
            });
            // Publish the authoritative consumed-box count immediately. The
            // later loot-detail result uses the same eventId and is deduped by
            // the UI, so statistics do not depend on loot sampling succeeding.
            emit('auto_box_open_result', {
                success: true,
                eventId: eventId,
                boxType: confirmedType,
                boxTypeName: BOX_TYPE_NAMES[confirmedType] || '未知宝箱',
                consumedCount: confirmedCount,
                produced: [],
                lootDetection: 'awaiting-loot-details',
                confirmationSource: confirmationSource,
                confirmedAt: now
            });
            scheduleBoxLootResult({
                eventId: eventId,
                boxType: confirmedType,
                boxTypeName: BOX_TYPE_NAMES[confirmedType] || '未知宝箱',
                consumedCount: confirmedCount,
                error: g_boxExchangeErrors.join('; '),
                confirmationSource: confirmationSource,
                confirmedAt: now
            }, beforeInventory, []);
            return '开箱已确认，等待产物入包';
        } else if (now - g_boxOpenInFlightAt >= g_boxOpenInFlightMaxWaitMs) {
            g_lastBoxOpenResult = '开箱请求已发送，等待游戏刷新数量';
            scheduleBoxLootResult({
                eventId: String(Process.id) + '-box-' + g_boxLastRequestedAt + '-' + g_boxOpenInFlightType,
                boxType: g_boxOpenInFlightType,
                boxTypeName: BOX_TYPE_NAMES[g_boxOpenInFlightType] || '未知宝箱',
                consumedCount: 0,
                error: g_boxExchangeErrors.join('; ') || '原生开箱已结束，但未确认宝箱消耗',
                confirmationSource: '原生流程结束，未确认消耗',
                confirmedAt: now
            }, g_boxOpenInFlightInventoryBefore, []);
            return g_lastBoxOpenResult;
        } else {
            g_lastBoxOpenResult = 'box-open-in-flight type=' + g_boxOpenInFlightType +
                ' before=' + g_boxOpenInFlightTypeBefore + ' now=' + currentTypeCount +
                ' beforeUids=' + g_boxOpenInFlightTypeBeforeUids.join(',') +
                ' nowUids=' + currentTypeUids.join(',');
            return g_lastBoxOpenResult;
        }
    }

    if (reason === 'native-batch-completion') return 'no-active-batch';

    if ((g_lastSourceCounts || {}).backpackFull || g_boxCapacityBlocked ||
            (g_autoDepositUnsynthable && (g_depositQueued || g_fullBackpackDepositActive))) {
        g_lastBoxOpenResult = '背包已满或正在清理，暂停开箱';
        return g_lastBoxOpenResult;
    }
    if (g_bossStageQueued || g_bossState === 'waitingBox') return '等待关卡结束';
    if (sharedGameActionWaiting() || now < g_boxYieldUntil) return '等待后台操作间隔';
    if (synthesisInventoryMutationActive()) return '等待合成结果入包';

    if (count <= 0) {
        g_boxSweepActive = false;
        g_boxDetectedAt = 0;
        g_boxDetectedCount = 0;
        g_boxDetectedSignature = '';
        g_boxLastRequestedCount = 0;
        g_boxNoInstanceRetryAt = 0;
        g_lastBoxOpenResult = 'no-box';
        return 'no-box';
    }

    var signature = boxSnapshotSignature(snapshot);
    if (g_boxDetectedAt <= 0 || g_boxDetectedSignature !== signature) {
        g_boxDetectedAt = now;
        g_boxDetectedCount = count;
        g_boxDetectedSignature = signature;
        g_lastBoxOpenResult = 'box-detected count=' + count + ' wait=' + g_boxOpenDelayMs + 'ms';
        return g_lastBoxOpenResult;
    }

    var waited = now - g_boxDetectedAt;
    if (waited < g_boxOpenDelayMs) {
        g_lastBoxOpenResult = 'box-delay count=' + count + ' waited=' + waited + 'ms';
        return g_lastBoxOpenResult;
    }

    g_lastBoxOpenResult = enqueueBoxOpen((reason || '') + ' boxes=' + count, snapshot);
    return g_lastBoxOpenResult;
}

var g_cachedPlayerSaveData = ptr(0);
var g_cachedLocalInventoryManager = ptr(0);
var g_cachedLocalInventoryDictOffset = null;
var g_cachedLocalInventoryDictOffsetResolved = false;
var g_lastRuntimeItemCache = {};
var g_currentRuntimeItemDictField = ptr(0);
var g_currentRuntimeItemDictFieldResolved = false;
var g_currentRuntimeItemInfoOffsets = {};
var g_staticSingletonFieldCache = {};
var g_saveManagerClassSearchFailedAt = 0;

function findStaticSingleton(startClass, expectedTypeName) {
    var cacheKey = String(startClass) + '|' + expectedTypeName;
    var cachedField = g_staticSingletonFieldCache[cacheKey];
    if (cachedField) {
        var cachedValue = Memory.alloc(PTR);
        cachedValue.writePointer(ptr(0));
        il2cpp.fieldStaticGetValue(cachedField, cachedValue);
        var cachedSingleton = cachedValue.readPointer();
        return isObviouslyInvalidPtr(cachedSingleton) ? ptr(0) : cachedSingleton;
    }
    var current = startClass;
    for (var depth = 0; depth < 12 && current && !current.isNull(); depth++) {
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var field = il2cpp.classGetFields(current, iter);
            if (!field || field.isNull()) break;
            var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
            if (typeName !== expectedTypeName || il2cpp.fieldGetOffset(field) !== 0) continue;
            g_staticSingletonFieldCache[cacheKey] = field;
            var value = Memory.alloc(PTR);
            value.writePointer(ptr(0));
            il2cpp.fieldStaticGetValue(field, value);
            var singleton = value.readPointer();
            if (!isObviouslyInvalidPtr(singleton)) return singleton;
        }
        current = il2cpp.classGetParent(current);
    }
    return ptr(0);
}

var g_saveManagerClass = ptr(0);
function findSaveManagerClass() {
    if (!g_saveManagerClass.isNull()) return g_saveManagerClass;
    if (g_saveManagerClassSearchFailedAt &&
            Date.now() - g_saveManagerClassSearchFailedAt < 30000) return ptr(0);
    var oldManager = classInfo('', 'baq');
    if (oldManager.klass && !oldManager.klass.isNull() &&
            Object.keys(oldManager.fieldTypes).some(function (name) {
                return oldManager.fieldTypes[name] === 'TaskbarHero.PlayerSaveData';
            })) {
        g_saveManagerClass = oldManager.klass;
        g_saveManagerClassSearchFailedAt = 0;
        return g_saveManagerClass;
    }
    // The obfuscated save-manager name changes between game builds. Its
    // PlayerSaveData field is a stable way to identify it without an RVA.
    var img = imageByName('Assembly-CSharp.dll');
    var countApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
    var classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    for (var i = 0, count = countApi(img); i < count; i++) {
        var k = classApi(img, i);
        if (!k || k.isNull()) continue;
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var f = il2cpp.classGetFields(k, iter);
            if (!f || f.isNull()) break;
            if (cstr(il2cpp.typeGetName(il2cpp.fieldGetType(f))) ===
                    'TaskbarHero.PlayerSaveData') {
                g_saveManagerClass = k;
                g_saveManagerClassSearchFailedAt = 0;
                return k;
            }
        }
    }
    g_saveManagerClassSearchFailedAt = Date.now();
    return ptr(0);
}

function findPlayerSaveData() {
    g_cachedPlayerSaveData = ptr(0);
    var saveManagerClass = findSaveManagerClass();
    if (!saveManagerClass || saveManagerClass.isNull()) return ptr(0);
    var saveManagerInfo = classInfo(
        cstr(il2cpp.classGetNamespace(saveManagerClass)),
        cstr(il2cpp.classGetName(saveManagerClass))
    );
    var saveManager = findStaticSingleton(
        saveManagerClass, cstr(il2cpp.classGetName(saveManagerClass))
    );
    if (isObviouslyInvalidPtr(saveManager)) return ptr(0);
    var off = null;
    Object.keys(saveManagerInfo.fields).some(function (fieldName) {
        if (saveManagerInfo.fieldTypes[fieldName] !== 'TaskbarHero.PlayerSaveData') return false;
        off = saveManagerInfo.fields[fieldName];
        return true;
    });
    if (off == null) return ptr(0);
    var ps = saveManager.add(off).readPointer();
    if (!isObviouslyInvalidPtr(ps) && managedType(ps) === 'TaskbarHero.PlayerSaveData') {
        g_cachedPlayerSaveData = ps;
        return ps;
    }
    return ptr(0);
}

function getLocalInventoryManager() {
    var lm = classInfo('TaskbarHero.Manager', 'LocalInventoryManager');
    if (!lm.klass || lm.klass.isNull()) return ptr(0);
    g_cachedLocalInventoryManager = ptr(0);
    var singletonField = lm.fieldInfos.bfwg || ptr(0);
    if (!singletonField || singletonField.isNull()) {
        Object.keys(lm.fieldInfos).some(function (name) {
            if (lm.fields[name] === 0 && lm.fieldTypes[name] === 'TaskbarHero.Manager.LocalInventoryManager') {
                singletonField = lm.fieldInfos[name];
                return true;
            }
            return false;
        });
    }
    if (!singletonField || singletonField.isNull()) return ptr(0);
    var value = Memory.alloc(PTR);
    value.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(singletonField, value);
    var manager = value.readPointer();
    if (isObviouslyInvalidPtr(manager) || managedType(manager) !== 'TaskbarHero.Manager.LocalInventoryManager') return ptr(0);
    g_cachedLocalInventoryManager = manager;
    return manager;
}

function getLocalItemInfoCache() {
    var cache = {};
    var lm = classInfo('TaskbarHero.Manager', 'LocalInventoryManager');
    g_lastRuntimeItemCache = {
        source: 'LocalInventoryManager.static',
        manager: '',
        dictionary: '',
        outerCount: 0,
        outerEntryLength: 0,
        cachedItems: 0,
        synthesisTypeCounts: {},
        gradeCounts: {}
    };
    if (!lm.klass || lm.klass.isNull()) {
        g_lastRuntimeItemCache.error = 'LocalInventoryManager class not found';
        return cache;
    }
    if (!g_cachedLocalInventoryDictOffsetResolved) {
        Object.keys(lm.fields).forEach(function (name) {
            if (lm.fieldTypes[name] && lm.fieldTypes[name].indexOf('Dictionary<System.Int32') !== -1) {
                g_cachedLocalInventoryDictOffset = lm.fields[name];
            }
        });
        g_cachedLocalInventoryDictOffsetResolved = true;
    }
    if (g_cachedLocalInventoryDictOffset == null) {
        if (readCurrentRuntimeItemCache(cache, g_lastRuntimeItemCache)) {
            g_lastRuntimeItemCache.cachedItems = Object.keys(cache).length;
            return cache;
        }
        g_lastRuntimeItemCache.error = 'runtime item dictionary field not found';
        return cache;
    }
    try {
        var manager = getLocalInventoryManager();
        if (isObviouslyInvalidPtr(manager)) {
            g_lastRuntimeItemCache.error = 'LocalInventoryManager singleton not ready';
            return cache;
        }
        g_lastRuntimeItemCache.manager = String(manager);
        var dict = manager.add(g_cachedLocalInventoryDictOffset).readPointer();
        if (isObviouslyInvalidPtr(dict)) {
            g_lastRuntimeItemCache.error = 'runtime item dictionary not ready';
            return cache;
        }
        g_lastRuntimeItemCache.dictionary = String(dict);
        readOuterItemDict(dict, cache, g_lastRuntimeItemCache);
        g_lastRuntimeItemCache.cachedItems = Object.keys(cache).length;
    } catch (e) {
        g_lastRuntimeItemCache.error = String(e);
    }
    return cache;
}

function readCurrentRuntimeItemCache(cache, stats) {
    // Game 1.2.8 stores live items in wh.vc.biph rather than on
    // LocalInventoryManager. Discover the field by its managed type.
    var k = findClassByEnumeratedName('', 'vu');
    if (!k || k.isNull()) return false;
    var field = g_currentRuntimeItemDictField;
    if (!g_currentRuntimeItemDictFieldResolved) {
        var iter = Memory.alloc(PTR);
        iter.writePointer(ptr(0));
        while (true) {
            var candidate = il2cpp.classGetFields(k, iter);
            if (!candidate || candidate.isNull()) break;
            var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(candidate)));
            if (typeName.indexOf('Dictionary<System.UInt64,xo.vu.vs>') !== -1) {
                field = candidate;
                break;
            }
        }
        g_currentRuntimeItemDictField = field;
        g_currentRuntimeItemDictFieldResolved = true;
    }
    if (field.isNull()) return false;
    var storage = Memory.alloc(PTR);
    storage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(field, storage);
    var dict = storage.readPointer();
    if (isObviouslyInvalidPtr(dict)) {
        stats.error = 'current runtime item dictionary not ready';
        return true;
    }
    stats.source = 'wh.vc.static';
    stats.dictionary = String(dict);
    var entries = dict.add(0x18).readPointer();
    var count = dict.add(0x20).readS32();
    if (isObviouslyInvalidPtr(entries) || count < 0 || count > 200000) {
        stats.error = 'current runtime item dictionary layout invalid';
        return true;
    }
    var length = entries.add(0x18).readS32();
    if (length < 0 || length > 200000) {
        stats.error = 'current runtime item entries length invalid';
        return true;
    }
    stats.outerCount = count;
    stats.outerEntryLength = length;
    var itemInfo = classInfo('TaskbarHero.Data', 'ItemInfoData');
    var f = itemInfo.fields;
    for (var i = 0; i < length; i++) {
        try {
            var entry = entries.add(0x20 + i * 0x18);
            if (entry.readS32() < 0) continue;
            var uid = readU64Text(entry.add(8));
            var item = entry.add(0x10).readPointer();
            if (!uid || uid === '0' || isObviouslyInvalidPtr(item)) continue;
            var itemClass = il2cpp.objectGetClass(item);
            var infoOffset = currentRuntimeItemInfoOffset(itemClass);
            if (infoOffset < 0) continue;
            var info = item.add(infoOffset).readPointer();
            if (isObviouslyInvalidPtr(info)) continue;
            var itemKey = f.ItemKey != null ? info.add(f.ItemKey).readS32() : 0;
            var grade = f.GRADE != null ? info.add(f.GRADE).readS32() : fallbackGrade(itemKey);
            var synthType = f.ItemSynthesisType != null ?
                info.add(f.ItemSynthesisType).readS32() : fallbackSynthesisType(itemKey);
            var synthable = synthType >= 0 && synthType <= 2 && grade >= 0 && grade < 9;
            cache[uid] = {
                itemKey: itemKey,
                grade: grade,
                synthesisType: synthType,
                parts: f.PARTS != null ? info.add(f.PARTS).readS32() : 0,
                gearType: f.GEARTYPE != null ? info.add(f.GEARTYPE).readS32() : 0,
                gearGroup: f.GearGroup != null ? info.add(f.GearGroup).readS32() : 0,
                level: f.Level != null ? info.add(f.Level).readS32() : 0,
                isDeleted: f.IsDeletedInServer != null && info.add(f.IsDeletedInServer).readU8() !== 0,
                temporaryBlocked: f.TemporaryBlockTradingStash != null &&
                    info.add(f.TemporaryBlockTradingStash).readU8() !== 0,
                synthable: synthable,
                synthableSource: synthable ? 'runtime-enum' : 'runtime-invalid'
            };
            var typeKey = String(synthType);
            var gradeKey = String(grade);
            stats.synthesisTypeCounts[typeKey] = (stats.synthesisTypeCounts[typeKey] || 0) + 1;
            stats.gradeCounts[gradeKey] = (stats.gradeCounts[gradeKey] || 0) + 1;
        } catch (e) {}
    }
    return true;
}

function currentRuntimeItemInfoOffset(itemClass) {
    if (isObviouslyInvalidPtr(itemClass)) return -1;
    var classKey = String(itemClass);
    if (Object.prototype.hasOwnProperty.call(g_currentRuntimeItemInfoOffsets, classKey)) {
        return g_currentRuntimeItemInfoOffsets[classKey];
    }
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    var offset = -1;
    while (true) {
        var field = il2cpp.classGetFields(itemClass, iter);
        if (!field || field.isNull()) break;
        if (cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field))) ===
                'TaskbarHero.Data.ItemInfoData') {
            offset = il2cpp.fieldGetOffset(field);
            break;
        }
    }
    if (offset >= 0) g_currentRuntimeItemInfoOffsets[classKey] = offset;
    return offset;
}

function readOuterItemDict(dict, cache, stats) {
    if (!dict || dict.isNull()) return;
    var entries = dict.add(0x18).readPointer();
    var count = dict.add(0x20).readS32();
    if (!entries || entries.isNull() || count < 0 || count > 200000) return;
    var len = entries.add(0x18).readS32();
    if (len < 0 || len > 200000) return;
    stats.outerCount = count;
    stats.outerEntryLength = len;
    for (var i = 0; i < len; i++) {
        var base = entries.add(0x20 + i * 0x18);
        var hash = base.readS32();
        if (hash < 0) continue;
        var itemKey = base.add(8).readS32();
        var inner = base.add(0x10).readPointer();
        readInnerItemDict(inner, itemKey, cache, stats);
    }
}

function readInnerItemDict(dict, fallbackItemKey, cache, stats) {
    if (!dict || dict.isNull()) return;
    var entries = dict.add(0x18).readPointer();
    var count = dict.add(0x20).readS32();
    if (!entries || entries.isNull() || count < 0 || count > 200000) return;
    var len = entries.add(0x18).readS32();
    var itemInfo = classInfo('TaskbarHero.Data', 'ItemInfoData');
    var f = itemInfo.fields;
    for (var i = 0; i < len; i++) {
        try {
            var base = entries.add(0x20 + i * 0x18);
            var hash = base.readS32();
            if (hash < 0) continue;
            var uid = readU64Text(base.add(8));
            if (!uid || uid === '0') continue;
            var info = base.add(0x10).readPointer();
            if (!info || info.isNull()) continue;
            var itemKey = f.ItemKey != null ? info.add(f.ItemKey).readS32() : fallbackItemKey;
            var grade = f.GRADE != null ? info.add(f.GRADE).readS32() : fallbackGrade(itemKey);
            var synthType = f.ItemSynthesisType != null ? info.add(f.ItemSynthesisType).readS32() : fallbackSynthesisType(itemKey);
            var parts = f.PARTS != null ? info.add(f.PARTS).readS32() : 0;
            var gearType = f.GEARTYPE != null ? info.add(f.GEARTYPE).readS32() : 0;
            var gearGroup = f.GearGroup != null ? info.add(f.GearGroup).readS32() : 0;
            var level = f.Level != null ? info.add(f.Level).readS32() : 0;
            var isDeleted = f.IsDeletedInServer != null && info.add(f.IsDeletedInServer).readU8() !== 0;
            var tempBlocked = f.TemporaryBlockTradingStash != null && info.add(f.TemporaryBlockTradingStash).readU8() !== 0;
            var synthable = synthType >= 0 && synthType <= 2 && grade >= 0 && grade < 9;
            cache[uid] = {
                itemKey: itemKey,
                grade: grade,
                synthesisType: synthType,
                parts: parts,
                gearType: gearType,
                gearGroup: gearGroup,
                level: level,
                isDeleted: isDeleted,
                temporaryBlocked: tempBlocked,
                synthable: synthable,
                synthableSource: synthable ? 'runtime-enum' : (synthType === 3 ? 'runtime-none' : (grade === 9 ? 'cosmic-grade' : 'runtime-invalid'))
            };
            var typeKey = String(synthType);
            var gradeKey = String(grade);
            stats.synthesisTypeCounts[typeKey] = (stats.synthesisTypeCounts[typeKey] || 0) + 1;
            stats.gradeCounts[gradeKey] = (stats.gradeCounts[gradeKey] || 0) + 1;
        } catch (e) {}
    }
}

function fallbackGrade(itemKey) {
    var s = String(itemKey || '');
    if (s.length >= 3) {
        var n = parseInt(s.charAt(2), 10);
        if (!isNaN(n)) return n;
    }
    return 0;
}

function fallbackSynthesisType(itemKey) {
    var cat = categoryFromItemKeyPrefix(itemKey);
    if (!cat) return -1;
    if (cat.key === 'equipment') return 0;
    if (cat.key === 'accessory') return 1;
    if (cat.key === 'material') return 2;
    return -1;
}


function pushScanError(stage, error, detail) {
    try {
        if (!g_lastScanErrors) g_lastScanErrors = [];
        if (g_lastScanErrors.length >= 80) return;
        g_lastScanErrors.push({
            stage: stage,
            error: String(error),
            detail: detail || null
        });
    } catch (e) {}
}

function readPlacedUidsBackpackStash(player, playerFields) {
    var sources = {};
    var stashOccupied = {};
    var counts = {
        backpack: 0,
        backpackOccupiedUnlocked: 0,
        backpackCapacity: 0,
        backpackFree: null,
        backpackFull: false,
        backpackCapacityKnown: false,
        stash: 0,
        materialStash: 0,
        stashIndexMin: null,
        stashIndexMax: null,
        stashByPage: [0, 0, 0, 0, 0, 0, 0],
        stashFreeByPage: [STASH_PAGE_SIZE, STASH_PAGE_SIZE, STASH_PAGE_SIZE, STASH_PAGE_SIZE,
            STASH_PAGE_SIZE, STASH_PAGE_SIZE, STASH_PAGE_SIZE],
        firstEmptyStashIndex: -1,
        firstEmptyStashPage: 0,
        fields: {}
    };
    function addList(fieldName, sourceName, clsName) {
        if (playerFields[fieldName] == null) {
            counts.fields[fieldName] = { present: false };
            return;
        }
        try {
            var list = player.add(playerFields[fieldName]).readPointer();
            var rows = readListObjects(list);
            var info = classInfo('TaskbarHero.EasySaveData', clsName);
            var fieldNames = Object.keys(info.fields || {});
            var quantityField = firstFieldOffset(info.fields, ['Quantity', 'quantity']);
            counts.fields[fieldName] = { present: true, rows: rows.length, className: clsName, fieldNames: fieldNames };
            var uidField = firstFieldOffset(info.fields, [
                'ItemUniqueId', 'itemUniqueId', 'UniqueId', 'uniqueId',
                'ItemId', 'itemId', 'ItemUID', 'itemUID'
            ]);
            if (uidField == null) {
                counts.fields[fieldName].uidField = 'missing';
                pushScanError('placed-uid-field-missing', 'uid field not found', { fieldName: fieldName, className: clsName, fields: fieldNames });
                return;
            }
            counts.fields[fieldName].uidField = uidField;
            var indexNames = ['Index', 'index', 'SlotIndex', 'slotIndex', 'Position', 'position', 'Slot', 'slot', 'ItemKey'];
            var unlockField = fieldName === 'inventorySaveDatas'
                ? firstFieldOffset(info.fields, ['IsUnlock', 'isUnlock', 'Unlocked', 'unlocked'])
                : null;
            var runeUnlockField = fieldName === 'inventorySaveDatas'
                ? firstFieldOffset(info.fields, ['IsUnlockedByRune', 'isUnlockedByRune'])
                : null;
            if (fieldName === 'inventorySaveDatas') {
                counts.backpackCapacityKnown = unlockField != null || runeUnlockField != null;
                counts.fields[fieldName].unlockField = unlockField;
                counts.fields[fieldName].runeUnlockField = runeUnlockField;
            }
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                if (!row || row.isNull()) continue;
                try {
                    var slotUnlocked = false;
                    if (fieldName === 'inventorySaveDatas' && counts.backpackCapacityKnown) {
                        slotUnlocked = (unlockField != null && row.add(unlockField).readU8() !== 0) ||
                            (runeUnlockField != null && row.add(runeUnlockField).readU8() !== 0);
                        if (slotUnlocked) counts.backpackCapacity++;
                    }
                    var uid = readU64Text(row.add(uidField));
                    if (!uid || uid === '0') continue;
                    var index = readS32Field(row, info.fields, indexNames, i);
                    if (fieldName === 'inventorySaveDatas') {
                        counts.backpack++;
                        if (slotUnlocked) counts.backpackOccupiedUnlocked++;
                    } else if (fieldName === 'materialStashSaveDatas') {
                        counts.materialStash++;
                    } else {
                        counts.stash++;
                        if (counts.stashIndexMin == null || index < counts.stashIndexMin) counts.stashIndexMin = index;
                        if (counts.stashIndexMax == null || index > counts.stashIndexMax) counts.stashIndexMax = index;
                        if (index >= 0 && index < STASH_SLOT_COUNT && !stashOccupied[String(index)]) {
                            stashOccupied[String(index)] = true;
                            counts.stashByPage[Math.floor(index / STASH_PAGE_SIZE)]++;
                        }
                    }
                    var quantity = quantityField == null ? 1 : row.add(quantityField).readS32();
                    if (quantity < 1 || quantity > 9999) quantity = 1;
                    sources[uid] = sources[uid] || [];
                    sources[uid].push({ source: sourceName, index: index, quantity: quantity });
                } catch (e) {
                    pushScanError('placed-row-read', e, { fieldName: fieldName, index: i });
                }
            }
        } catch (e2) {
            counts.fields[fieldName] = { present: playerFields[fieldName] != null, error: String(e2) };
            pushScanError('placed-list-read', e2, { fieldName: fieldName, className: clsName });
        }
    }
    addList('inventorySaveDatas', '背包', 'InventorySaveData');
    addList('stashSaveDatas', '仓库', 'StashSaveData');
    addList('materialStashSaveDatas', '材料仓库', 'MaterialStashSaveData');
    var capacityState = backpackCapacityState(
        counts.backpackCapacity,
        counts.backpackOccupiedUnlocked,
        counts.backpackCapacityKnown
    );
    counts.backpackFree = capacityState.free;
    counts.backpackFull = capacityState.full;
    for (var page = 0; page < STASH_PAGE_COUNT; page++) {
        counts.stashFreeByPage[page] = Math.max(0, STASH_PAGE_SIZE - counts.stashByPage[page]);
    }
    for (var stashIndex = 0; stashIndex < STASH_SLOT_COUNT; stashIndex++) {
        if (stashOccupied[String(stashIndex)]) continue;
        counts.firstEmptyStashIndex = stashIndex;
        counts.firstEmptyStashPage = Math.floor(stashIndex / STASH_PAGE_SIZE) + 1;
        break;
    }
    counts.observedAt = Date.now();
    g_lastStashOccupiedSet = stashOccupied;
    g_lastSourceCounts = counts;
    return sources;
}

function inventoryFingerprintJson() {
    var player = findPlayerSaveData();
    if (!player || player.isNull()) throw new Error('PlayerSaveData not found');
    var playerInfo = classInfo('TaskbarHero', 'PlayerSaveData');
    var sources = readPlacedUidsBackpackStash(player, playerInfo.fields);
    var uids = Object.keys(sources || {});
    uids.sort(function (a, b) {
        return a.length - b.length || a.localeCompare(b);
    });
    var parts = [];
    for (var i = 0; i < uids.length; i++) {
        var uid = uids[i];
        var placements = (sources[uid] || []).slice();
        placements.sort(function (a, b) {
            return String(a.source).localeCompare(String(b.source)) || (a.index - b.index);
        });
        parts.push(uid + '@' + placements.map(function (entry) {
            return entry.source + ':' + entry.index;
        }).join(','));
    }
    return JSON.stringify({
        signature: uids.length + '#' + parts.join('|'),
        itemCount: uids.length,
        backpackCount: g_lastSourceCounts.backpack || 0,
        backpackCapacity: g_lastSourceCounts.backpackCapacity || 0,
        backpackFree: g_lastSourceCounts.backpackFree,
        backpackFull: g_lastSourceCounts.backpackFull === true,
        stashCount: g_lastSourceCounts.stash || 0,
        observedAt: Date.now()
    });
}

var GAMEPLAY_PSTAT_PATTERN = '48 8B 05 ?? ?? ?? ?? 83 B8 E4 00 00 00 00 75 ?? 48 8B C8 E8 ?? ?? ?? ?? 48 8B 05 ?? ?? ?? ?? 48 8B 80 B8 00 00 00 48 8B 48 20 48 85 C9 74 ?? 48 8B 15 ?? ?? ?? ?? E8';
var GAMEPLAY_PSTAT_RVA = 0x8ee828;
var GAMEPLAY_PSTAT_GLOBAL_RVA = 0x5ddaa10;
var GAMEPLAY_HERO_DAMAGE_PATTERN =
    '48 89 5C 24 08 48 89 74 24 10 57 48 83 EC 50 80 3D ?? ?? ?? ?? ?? ' +
    '41 0F B6 F8 48 8B DA 48 8B F1 75 1F 48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? ' +
    '48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? C6 05 ?? ?? ?? ?? 01 0F 10 03 45 33 C9 ' +
    '44 0F B6 C7 0F 10 4B 10 48 8D 54 24 20 48 8B CE 0F 29 44 24 20 ' +
    'F2 0F 10 43 20 F2 0F 11 44 24 40 0F 29 4C 24 30 E8 ?? ?? ?? ?? ' +
    '48 8B 43 18 48 C1 E8 08 84 C0';
var GAMEPLAY_HERO_DAMAGE_RVA = 0xc1bfa0;
var GAMEPLAY_ATTACK_DAMAGE_STAT_TYPE = 1;
var GAMEPLAY_STAT_ENTRY_SIZE = 0x10;
var GAMEPLAY_STAT_ENTRY_KEY_OFFSET = 0x08;
var GAMEPLAY_STAT_ENTRY_VALUE_OFFSET = 0x0c;
var GAMEPLAY_WAVE_TOTAL_OFFSET = 0x54;
var GAMEPLAY_MONSTERS_OFFSET = 0x58;
var GAMEPLAY_INSTANT_KILL_DAMAGE = 9999999.0;
var GAMEPLAY_CURRENT_WAVE_REFRESH_RVA = 0xa6b000;
var GAMEPLAY_CURRENT_WAVE_TOTAL_GETTER_RVA = 0xa6af80;
var GAMEPLAY_CURRENT_WAVE_MONSTERS_GETTER_RVA = 0xa6afb0;
var g_currentWaveCacheBridge = null;
var g_currentWaveCacheBridgeClass = null;

function currentStageCachePointer() {
    var owner = findClassByEnumeratedName('', 'xi');
    if (isBadPtr(owner)) throw new Error('当前关卡管理器类型未找到');
    var fields = runtimeClassFields(owner);
    if (fields.fields.bizp !== 0xa8 || !fields.fieldInfos.bizp ||
            cstr(il2cpp.typeGetName(il2cpp.fieldGetType(fields.fieldInfos.bizp))) !== 'xo.StageCache') {
        throw new Error('当前关卡缓存静态字段版本校验失败');
    }
    var storage = Memory.alloc(PTR);
    storage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(fields.fieldInfos.bizp, storage);
    var cache = storage.readPointer();
    if (isBadPtr(cache)) throw new Error('当前关卡缓存尚未就绪');
    var cacheClass = il2cpp.objectGetClass(cache);
    if (cstr(il2cpp.classGetName(cacheClass)) !== 'StageCache') {
        throw new Error('当前关卡缓存对象类型校验失败');
    }
    return cache;
}

function stageCacheByKeyFromLoadedList(stageKey) {
    var phase = 'key';
    try {
        stageKey = parseInt(stageKey, 10);
        if (!isFinite(stageKey) || stageKey <= 0) return ptr(0);
        phase = 'xi-class';
        var owner = findClassByEnumeratedName('', 'xi');
        if (isBadPtr(owner)) throw new Error('关卡缓存列表所属类型未找到');
        phase = 'xi-fields';
        var fields = runtimeClassFields(owner).fields;
        if (fields.bizd !== 0x38) throw new Error('关卡缓存列表字段版本校验失败');
        phase = 'static-data';
        var staticData = il2cpp.classGetStaticFieldData(owner);
        if (isBadPtr(staticData)) return ptr(0);
        phase = 'list-pointer';
        var list = staticData.add(fields.bizd).readPointer();
        if (isBadPtr(list)) return ptr(0);
        phase = 'list-scan';
        var caches = readListObjects(list, 20000);
        for (var i = 0; i < caches.length; i++) {
            var stage = readAutoBossStageInfo(caches[i]);
            if (stage && stage.stageKey === stageKey) return caches[i];
        }
        return ptr(0);
    } catch (error) {
        throw new Error('关卡缓存列表查找阶段=' + phase + '：' + chineseError(error));
    }
}

var g_instantKillEnabled = false;
var g_godModeEnabled = false;
var g_waveLockEnabled = false;
var g_waveTotalTarget = 1;
var g_monstersPerWaveTarget = 10;
var g_memoryCleanEnabled = false;
var g_memoryCleanIntervalMs = 60000;
var g_gameplayTimer = null;
var g_gameplayPumpIntervalMs = 500;
var g_gameplayLastMemoryCleanAt = 0;
var g_gameplayLastErrorAt = {};
var g_gameplayNextAttemptAt = {};
var g_gameplaySuccessReported = {};
var g_pstatAddress = ptr(0);
var g_originalAttackDamage = null;
var g_currentInstantKillListener = null;
var g_currentInstantKillHits = 0;
var g_godModeAddress = ptr(0);
var g_godModeMethodInfo = ptr(0);
var g_godModeReplacement = null;
var g_currentGodModeListener = null;
var g_currentGodModeEntryListener = null;
var g_currentGodModeHits = 0;
var g_stageObject = ptr(0);
var g_waveCacheObject = ptr(0);
var g_waveCacheBridge = null;
var g_waveCacheBridgeClass = ptr(0);
var g_waveOriginalObject = '';
var g_originalWaveTotal = null;
var g_originalMonstersPerWave = null;
var g_emptyWorkingSet = null;
var g_getCurrentProcess = null;

function gameplayModule(name) {
    var lower = String(name || '').toLowerCase();
    var modules = Process.enumerateModules();
    for (var i = 0; i < modules.length; i++) {
        if (modules[i].name.toLowerCase() === lower) return modules[i];
    }
    return null;
}


function gameplayReportError(feature, label, error) {
    var now = Date.now();
    if (now - (g_gameplayLastErrorAt[feature] || 0) >= 30000) {
        g_gameplayLastErrorAt[feature] = now;
        gameplayLog(label + '等待中：' + chineseError(error));
        emit('gameplay_diagnostic', { feature: feature, error: String(error || ''), observedAt: now });
    }
}

function resolvePstatAddress() {
    if (!isObviouslyInvalidPtr(g_pstatAddress)) return g_pstatAddress;
    var matches = Memory.scanSync(GA.base, GA.size, GAMEPLAY_PSTAT_PATTERN);
    if (!matches || matches.length !== 1 ||
            !matches[0].address.equals(B.add(GAMEPLAY_PSTAT_RVA))) {
        throw new Error('玩家属性入口版本校验失败');
    }
    var hit = matches[0].address;
    var target = hit.add(7).add(hit.add(3).readS32());
    if (!target.equals(B.add(GAMEPLAY_PSTAT_GLOBAL_RVA))) {
        throw new Error('玩家属性全局地址版本校验失败');
    }
    g_pstatAddress = target;
    return g_pstatAddress;
}

function attackDamageAddress() {
    var root = resolvePstatAddress().readPointer();
    if (isObviouslyInvalidPtr(root)) throw new Error('玩家属性根对象尚未就绪');
    var statOwner = root.add(0xb8).readPointer();
    if (isObviouslyInvalidPtr(statOwner)) throw new Error('玩家属性容器尚未就绪');
    statOwner = statOwner.add(0x40).readPointer();
    if (isObviouslyInvalidPtr(statOwner)) throw new Error('玩家属性运行时对象尚未就绪');
    statOwner = statOwner.add(0x10).readPointer();
    if (isObviouslyInvalidPtr(statOwner)) throw new Error('玩家属性表宿主尚未就绪');
    var dictionary = statOwner.add(0x20).readPointer();
    if (isObviouslyInvalidPtr(dictionary)) throw new Error('玩家属性字典尚未就绪');
    var dictionaryType = managedType(dictionary);
    if (dictionaryType.indexOf('System.Collections.Generic.Dictionary') !== 0) {
        throw new Error('玩家属性字典类型校验失败');
    }
    var entries = dictionary.add(0x18).readPointer();
    var count = dictionary.add(0x20).readS32();
    if (isObviouslyInvalidPtr(entries) || count <= 0 || count > 256) {
        throw new Error('玩家属性字典结构校验失败');
    }
    for (var i = 0; i < count; i++) {
        var entry = entries.add(0x20 + i * GAMEPLAY_STAT_ENTRY_SIZE);
        if (entry.readS32() < 0) continue;
        if (entry.add(GAMEPLAY_STAT_ENTRY_KEY_OFFSET).readS32() !== GAMEPLAY_ATTACK_DAMAGE_STAT_TYPE) {
            continue;
        }
        return entry.add(GAMEPLAY_STAT_ENTRY_VALUE_OFFSET);
    }
    throw new Error('玩家属性字典中没有攻击伤害条目');
}

function lockInstantKillOnce() {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        if (!g_currentInstantKillListener) {
            var damageMethod = findMethodInfoByRva(0xde3dd0);
            if (isBadPtr(damageMethod) || !methodPtr(damageMethod).equals(B.add(0xde3dd0))) {
                throw new Error('怪物伤害入口版本校验失败');
            }
            var damageClass = cstr(il2cpp.classGetName(il2cpp.methodGetClass(damageMethod)));
            var firstType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(damageMethod, 0)));
            var secondType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(damageMethod, 1)));
            if (damageClass !== 'Hero' || firstType !== 'TaskbarHero.DamageInfo' ||
                    secondType !== 'System.Boolean') {
                throw new Error('怪物伤害方法签名校验失败');
            }
            var heroClass = classInfo('TaskbarHero', 'Hero').klass;
            var monsterClass = classInfo('TaskbarHero', 'Monster').klass;
            if (isBadPtr(heroClass) || isBadPtr(monsterClass)) throw new Error('战斗对象类型校验失败');
            g_currentInstantKillListener = Interceptor.attach(B.add(0xde3dd0), {
                onEnter: function (args) {
                    if (!g_instantKillEnabled) return;
                    try {
                        var receiver = args[0], damage = args[1];
                        if (isBadPtr(receiver) || isBadPtr(damage)) return;
                        var receiverClass = il2cpp.objectGetClass(receiver);
                        var isMonster = false;
                        for (var i = 0; i < 8 && !isBadPtr(receiverClass); i++) {
                            if (receiverClass.equals(monsterClass)) { isMonster = true; break; }
                            receiverClass = il2cpp.classGetParent(receiverClass);
                        }
                        if (!isMonster) return;
                        var attacker = damage.readPointer();
                        if (isBadPtr(attacker)) return;
                        var attackerClass = il2cpp.objectGetClass(attacker);
                        var isHero = false;
                        for (var j = 0; j < 8 && !isBadPtr(attackerClass); j++) {
                            if (attackerClass.equals(heroClass)) { isHero = true; break; }
                            attackerClass = il2cpp.classGetParent(attackerClass);
                        }
                        if (!isHero) return;
                        var currentDamage = damage.add(8).readFloat();
                        if (!(currentDamage > 0) || currentDamage >= GAMEPLAY_INSTANT_KILL_DAMAGE) return;
                        damage.add(8).writeFloat(GAMEPLAY_INSTANT_KILL_DAMAGE);
                        g_currentInstantKillHits++;
                    } catch (hookError) {}
                }
            });
        }
        if (!g_gameplaySuccessReported.instantKill) {
            g_gameplaySuccessReported.instantKill = true;
            gameplayLog('秒杀已启用，等待英雄攻击怪物。');
        }
        return;
    }
    var address = attackDamageAddress();
    var current = address.readFloat();
    if (g_originalAttackDamage == null) g_originalAttackDamage = current;
    if (Math.abs(current - GAMEPLAY_INSTANT_KILL_DAMAGE) > 0.5) {
        address.writeFloat(GAMEPLAY_INSTANT_KILL_DAMAGE);
    }
    if (!g_gameplaySuccessReported.instantKill) {
        g_gameplaySuccessReported.instantKill = true;
        gameplayLog('秒杀已生效，攻击伤害已锁定。');
    }
}

function disableInstantKill() {
    if (g_currentInstantKillListener) {
        try { g_currentInstantKillListener.detach(); } catch (listenerError) {}
        g_currentInstantKillListener = null;
    }
    try {
        if (g_originalAttackDamage != null && !isObviouslyInvalidPtr(g_pstatAddress)) {
            attackDamageAddress().writeFloat(g_originalAttackDamage);
        }
    } catch (e) {}
    g_originalAttackDamage = null;
    g_pstatAddress = ptr(0);
    g_gameplaySuccessReported.instantKill = false;
}

function resolveHeroDamageMethod() {
    var signatureMatches = Memory.scanSync(GA.base, GA.size, GAMEPLAY_HERO_DAMAGE_PATTERN);
    if (!signatureMatches || signatureMatches.length !== 1) {
        throw new Error('英雄受伤入口特征校验失败：匹配数=' +
            (signatureMatches ? signatureMatches.length : 0));
    }
    var expectedAddress = B.add(GAMEPLAY_HERO_DAMAGE_RVA);
    if (!signatureMatches[0].address.equals(expectedAddress)) {
        throw new Error('英雄受伤入口地址与当前版本不一致');
    }
    var methodInfo = findMethodInfo('TaskbarHero', 'Hero', 'gpt', 2);
    var address = methodPtr(methodInfo);
    if (!methodInfo || methodInfo.isNull() || isObviouslyInvalidPtr(address) ||
            !address.equals(expectedAddress)) {
        throw new Error('Hero.gpt 方法信息与当前版本入口不一致');
    }
    var firstType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(methodInfo, 0)));
    var secondType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(methodInfo, 1)));
    var returnType = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(methodInfo)));
    if (firstType !== 'TaskbarHero.DamageInfo' || secondType !== 'System.Boolean' ||
            returnType !== 'System.Void') {
        throw new Error('Hero.gpt 方法签名校验失败');
    }
    return { methodInfo: methodInfo, address: address };
}

function enableGodModeOnce() {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        if (!g_currentGodModeListener) {
            var currentMethod = findMethodInfoByRva(0xde8580);
            if (isBadPtr(currentMethod) || !methodPtr(currentMethod).equals(B.add(0xde8580))) {
                throw new Error('英雄受伤入口版本校验失败');
            }
            var currentClass = cstr(il2cpp.classGetName(il2cpp.methodGetClass(currentMethod)));
            var damageType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(currentMethod, 0)));
            var flagType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(currentMethod, 1)));
            if (currentClass !== 'Hero' || damageType !== 'TaskbarHero.DamageInfo' ||
                    flagType !== 'System.Boolean') {
                throw new Error('英雄受伤方法签名校验失败');
            }
            var entryMethod = findMethodInfoByRva(0xde3dd0);
            if (isBadPtr(entryMethod) || !methodPtr(entryMethod).equals(B.add(0xde3dd0))) {
                throw new Error('共享伤害入口版本校验失败');
            }
            function protectHero(args) {
                if (!g_godModeEnabled) return;
                try {
                    var receiver = args[0], damage = args[1];
                    if (isBadPtr(receiver) || isBadPtr(damage)) return;
                    var heroClass = classInfo('TaskbarHero', 'Hero').klass;
                    var receiverClass = il2cpp.objectGetClass(receiver);
                    var isHero = false;
                    for (var i = 0; i < 8 && !isBadPtr(receiverClass); i++) {
                        if (receiverClass.equals(heroClass)) { isHero = true; break; }
                        receiverClass = il2cpp.classGetParent(receiverClass);
                    }
                    if (!isHero) return;
                    var incoming = damage.add(8).readFloat();
                    if (!(incoming > 0) || !isFinite(incoming)) return;
                    damage.add(8).writeFloat(0);
                    g_currentGodModeHits++;
                } catch (hookError) {}
            }
            g_currentGodModeListener = Interceptor.attach(B.add(0xde8580), { onEnter: protectHero });
            g_currentGodModeEntryListener = Interceptor.attach(B.add(0xde3dd0), { onEnter: protectHero });
        }
        if (!g_gameplaySuccessReported.godMode) {
            g_gameplaySuccessReported.godMode = true;
            gameplayLog('无敌已启用，等待英雄受到伤害。');
        }
        return;
    }
    if (isObviouslyInvalidPtr(g_godModeAddress)) {
        var resolved = resolveHeroDamageMethod();
        g_godModeAddress = resolved.address;
        g_godModeMethodInfo = resolved.methodInfo;
        g_godModeReplacement = new NativeCallback(function () {}, 'void', ['pointer', 'pointer', 'uint8', 'pointer']);
        Interceptor.replace(g_godModeAddress, g_godModeReplacement);
        Interceptor.flush();
    }
    if (!g_gameplaySuccessReported.godMode) {
        g_gameplaySuccessReported.godMode = true;
        gameplayLog('无敌已生效，仅保护我方英雄。');
    }
}

function disableGodMode() {
    if (g_currentGodModeEntryListener) {
        try { g_currentGodModeEntryListener.detach(); } catch (entryError) {}
        g_currentGodModeEntryListener = null;
    }
    if (g_currentGodModeListener) {
        try { g_currentGodModeListener.detach(); } catch (listenerError) {}
        g_currentGodModeListener = null;
    }
    try {
        if (!isObviouslyInvalidPtr(g_godModeAddress) && g_godModeReplacement !== null) {
            Interceptor.revert(g_godModeAddress);
            Interceptor.flush();
        }
    } catch (e) {}
    g_godModeAddress = ptr(0);
    g_godModeMethodInfo = ptr(0);
    g_godModeReplacement = null;
    g_gameplaySuccessReported.godMode = false;
}

function findCurrentClassMethodByRva(runtimeClass, targetRva) {
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    for (var guard = 0; guard < 400; guard++) {
        var methodInfo = il2cpp.classGetMethods(runtimeClass, iter);
        if (isBadPtr(methodInfo)) break;
        var methodAddress = methodPtr(methodInfo);
        if (!isBadPtr(methodAddress) &&
                (methodAddress.sub(B).toInt32() >>> 0) === (targetRva >>> 0)) {
            return methodInfo;
        }
    }
    return ptr(0);
}

function resolveCurrentWaveCacheBridge(cacheClass) {
    if (g_currentWaveCacheBridge && g_currentWaveCacheBridgeClass &&
            g_currentWaveCacheBridgeClass.equals(cacheClass)) {
        return g_currentWaveCacheBridge;
    }
    var cacheClassName = cstr(il2cpp.classGetName(cacheClass));
    if (cacheClassName !== 'StageCache') {
        throw new Error('当前关卡缓存类型不匹配：' + cacheClassName);
    }
    var refreshInfo = findCurrentClassMethodByRva(cacheClass, GAMEPLAY_CURRENT_WAVE_REFRESH_RVA);
    var waveGetterInfo = findCurrentClassMethodByRva(cacheClass, GAMEPLAY_CURRENT_WAVE_TOTAL_GETTER_RVA);
    var monstersGetterInfo = findCurrentClassMethodByRva(cacheClass, GAMEPLAY_CURRENT_WAVE_MONSTERS_GETTER_RVA);
    if (isBadPtr(refreshInfo) || isBadPtr(waveGetterInfo) || isBadPtr(monstersGetterInfo)) {
        throw new Error('当前关卡缓存同步方法版本校验失败');
    }
    var expectedMethods = [
        { info: refreshInfo, rva: GAMEPLAY_CURRENT_WAVE_REFRESH_RVA, name: 'kzw', result: 'System.Void' },
        { info: waveGetterInfo, rva: GAMEPLAY_CURRENT_WAVE_TOTAL_GETTER_RVA, name: 'kzt', result: 'System.Int32' },
        { info: monstersGetterInfo, rva: GAMEPLAY_CURRENT_WAVE_MONSTERS_GETTER_RVA, name: 'kzu', result: 'System.Int32' }
    ];
    for (var i = 0; i < expectedMethods.length; i++) {
        var expected = expectedMethods[i];
        if (!methodPtr(expected.info).equals(B.add(expected.rva)) ||
                !il2cpp.methodGetClass(expected.info).equals(cacheClass) ||
                cstr(il2cpp.methodGetName(expected.info)) !== expected.name ||
                il2cpp.methodGetParamCount(expected.info) !== 0 ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(expected.info))) !== expected.result) {
            throw new Error('当前关卡缓存方法签名校验失败：' + expected.name);
        }
    }
    g_currentWaveCacheBridge = {
        refresh: new NativeFunction(methodPtr(refreshInfo), 'void', ['pointer']),
        readWave: new NativeFunction(methodPtr(waveGetterInfo), 'int32', ['pointer']),
        readMonsters: new NativeFunction(methodPtr(monstersGetterInfo), 'int32', ['pointer'])
    };
    g_currentWaveCacheBridgeClass = cacheClass;
    return g_currentWaveCacheBridge;
}

function currentStageWaveData() {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        var currentCache = currentStageCachePointer();
        var cacheClass = il2cpp.objectGetClass(currentCache);
        var cacheFields = runtimeClassFields(cacheClass);
        if (cacheFields.fields.bizw !== 0x10) throw new Error('当前关卡数据字段版本校验失败');
        var waveCacheBridge = resolveCurrentWaveCacheBridge(cacheClass);
        var currentInfo = currentCache.add(0x10).readPointer();
        if (isBadPtr(currentInfo) || managedType(currentInfo) !== 'TaskbarHero.Data.StageInfoData') {
            throw new Error('当前关卡数据对象校验失败');
        }
        var stageFields = runtimeClassFields(il2cpp.objectGetClass(currentInfo));
        if (stageFields.fields.WaveAmount !== GAMEPLAY_WAVE_TOTAL_OFFSET ||
                stageFields.fields.WaveMonsterAmount !== GAMEPLAY_MONSTERS_OFFSET) {
            throw new Error('关卡波数数据布局校验失败');
        }
        return {cache: currentCache, cacheClass: cacheClass, waveCacheBridge: waveCacheBridge,
            stageInfo: currentInfo,
            waveAddress: currentInfo.add(GAMEPLAY_WAVE_TOTAL_OFFSET),
            monstersAddress: currentInfo.add(GAMEPLAY_MONSTERS_OFFSET)};
    }
    var stageBridge = resolveAutoBossStageBridge();
    var managerClass = il2cpp.methodGetClass(stageBridge.cacheByKey.mi);
    var managerInfo = runtimeClassFields(managerClass);
    if (!managerInfo.fieldInfos.bfan) {
        throw new Error('当前关卡静态缓存入口不存在');
    }
    var cacheStorage = Memory.alloc(PTR);
    cacheStorage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(managerInfo.fieldInfos.bfan, cacheStorage);
    var cache = cacheStorage.readPointer();
    if (isObviouslyInvalidPtr(cache)) throw new Error('尚未进入关卡');
    var cacheInfo = runtimeClassFields(il2cpp.objectGetClass(cache));
    var stageInfoOffset = firstFieldOffset(cacheInfo.fields, ['bfar']);
    if (stageInfoOffset !== 0x10) throw new Error('当前关卡缓存字段版本校验失败');
    var stageInfo = cache.add(stageInfoOffset).readPointer();
    if (isObviouslyInvalidPtr(stageInfo) || managedType(stageInfo) !== 'TaskbarHero.Data.StageInfoData') {
        throw new Error('当前关卡数据对象校验失败');
    }
    var info = runtimeClassFields(il2cpp.objectGetClass(stageInfo));
    var waveOffset = firstFieldOffset(info.fields, ['WaveAmount']);
    var monstersOffset = firstFieldOffset(info.fields, ['WaveMonsterAmount']);
    if (waveOffset !== GAMEPLAY_WAVE_TOTAL_OFFSET || monstersOffset !== GAMEPLAY_MONSTERS_OFFSET) {
        throw new Error('关卡波数数据字段版本校验失败');
    }
    return {
        cache: cache,
        stageInfo: stageInfo,
        waveAddress: stageInfo.add(waveOffset),
        monstersAddress: stageInfo.add(monstersOffset)
    };
}

function restoreWaveValues() {
    try {
        if (!isObviouslyInvalidPtr(g_stageObject) && g_originalWaveTotal != null) {
            g_stageObject.add(GAMEPLAY_WAVE_TOTAL_OFFSET).writeU32(g_originalWaveTotal);
        }
        if (!isObviouslyInvalidPtr(g_stageObject) && g_originalMonstersPerWave != null) {
            g_stageObject.add(GAMEPLAY_MONSTERS_OFFSET).writeU32(g_originalMonstersPerWave);
        }
        if (g_waveCacheBridge && !isObviouslyInvalidPtr(g_waveCacheObject) &&
                g_originalWaveTotal != null && g_originalMonstersPerWave != null) {
            g_waveCacheBridge.refresh(g_waveCacheObject);
        }
    } catch (e) {}
    g_originalWaveTotal = null;
    g_originalMonstersPerWave = null;
    g_waveOriginalObject = '';
    g_stageObject = ptr(0);
    g_waveCacheObject = ptr(0);
    g_waveCacheBridge = null;
    g_waveCacheBridgeClass = ptr(0);
}

function applyWaveTargetsAndVerify(currentStage, waveTarget, monstersTarget) {
    if (currentStage.waveAddress.readU32() !== waveTarget) {
        currentStage.waveAddress.writeU32(waveTarget);
    }
    if (currentStage.monstersAddress.readU32() !== monstersTarget) {
        currentStage.monstersAddress.writeU32(monstersTarget);
    }
    if (currentStage.waveAddress.readU32() !== waveTarget ||
            currentStage.monstersAddress.readU32() !== monstersTarget) {
        throw new Error('关卡波数数据写入后校验失败');
    }
    if (!currentStage.waveCacheBridge) return { cacheVerified: false };
    var cachedWave = currentStage.waveCacheBridge.readWave(currentStage.cache);
    var cachedMonsters = currentStage.waveCacheBridge.readMonsters(currentStage.cache);
    if (cachedWave !== waveTarget || cachedMonsters !== monstersTarget) {
        currentStage.waveCacheBridge.refresh(currentStage.cache);
        cachedWave = currentStage.waveCacheBridge.readWave(currentStage.cache);
        cachedMonsters = currentStage.waveCacheBridge.readMonsters(currentStage.cache);
    }
    if (cachedWave !== waveTarget || cachedMonsters !== monstersTarget) {
        throw new Error('游戏实际波数缓存未同步：当前 ' + cachedWave + ' 波 / 每波 ' +
            cachedMonsters + ' 只；目标 ' + waveTarget + ' 波 / 每波 ' + monstersTarget + ' 只');
    }
    return { cacheVerified: true, cachedWave: cachedWave, cachedMonsters: cachedMonsters };
}

function lockWaveValuesOnce() {
    var currentStage = currentStageWaveData();
    var objectKey = String(currentStage.cache) + '|' + String(currentStage.stageInfo);
    if (g_waveOriginalObject !== objectKey) {
        restoreWaveValues();
        g_stageObject = currentStage.stageInfo;
        g_waveCacheObject = currentStage.cache;
        g_waveCacheBridge = currentStage.waveCacheBridge || null;
        g_waveCacheBridgeClass = currentStage.cacheClass || ptr(0);
        g_waveOriginalObject = objectKey;
        g_gameplaySuccessReported.waveLock = false;
        // StageCache getters already apply permanent/rune wave modifiers.
        // Saving those effective values as StageInfoData would apply the
        // modifiers again on restore and eventually leave the source at 1/10.
        g_originalWaveTotal = currentStage.waveAddress.readU32();
        g_originalMonstersPerWave = currentStage.monstersAddress.readU32();
    }
    var waveAddress = currentStage.waveAddress;
    var monstersAddress = currentStage.monstersAddress;
    var currentWave = waveAddress.readU32();
    var currentMonsters = monstersAddress.readU32();
    if (g_originalWaveTotal == null) g_originalWaveTotal = currentWave;
    if (g_originalMonstersPerWave == null) g_originalMonstersPerWave = currentMonsters;
    var verification = applyWaveTargetsAndVerify(currentStage,
        g_waveTotalTarget, g_monstersPerWaveTarget);
    if (!g_gameplaySuccessReported.waveLock) {
        g_gameplaySuccessReported.waveLock = true;
        gameplayLog('波数已锁定并验证' + (verification.cacheVerified ? '游戏缓存' : '关卡数据') +
            '：波数 ' + g_waveTotalTarget + '，每波怪物 ' + g_monstersPerWaveTarget + '。');
    }
}

function disableWaveLock() {
    restoreWaveValues();
    g_gameplaySuccessReported.waveLock = false;
}

function validateCurrentHeroDamageMethod(rva, label) {
    var methodInfo = findMethodInfoByRva(rva);
    if (isBadPtr(methodInfo) || !methodPtr(methodInfo).equals(B.add(rva))) {
        throw new Error(label + '入口版本校验失败');
    }
    var className = cstr(il2cpp.classGetName(il2cpp.methodGetClass(methodInfo)));
    var firstType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(methodInfo, 0)));
    var secondType = cstr(il2cpp.typeGetName(il2cpp.methodGetParam(methodInfo, 1)));
    if (className !== 'Hero' || firstType !== 'TaskbarHero.DamageInfo' ||
            secondType !== 'System.Boolean') {
        throw new Error(label + '方法签名校验失败');
    }
    return { rva: '0x' + rva.toString(16), className: className,
        firstParameter: firstType, secondParameter: secondType };
}

function gameplayReadOnlyDiagnostics() {
    var currentBuild = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT;
    var damageAddress = ptr(0);
    var heroDamage = null;
    var currentDamageMethods = null;
    if (currentBuild) {
        currentDamageMethods = {
            monsterDamage: validateCurrentHeroDamageMethod(0xde3dd0, '怪物伤害入口'),
            heroDamage: validateCurrentHeroDamageMethod(0xde8580, '英雄受伤入口')
        };
    } else {
        damageAddress = attackDamageAddress();
        heroDamage = resolveHeroDamageMethod();
    }
    var currentStage = null;
    var waveLayoutValid = false;
    if (currentBuild) {
        try {
            var currentWave = currentStageWaveData();
            var effectiveWaveAmount = currentWave.waveCacheBridge ?
                currentWave.waveCacheBridge.readWave(currentWave.cache) : null;
            var effectiveWaveMonsterAmount = currentWave.waveCacheBridge ?
                currentWave.waveCacheBridge.readMonsters(currentWave.cache) : null;
            currentStage = {
                cache: String(currentWave.cache),
                stageInfo: String(currentWave.stageInfo),
                waveAmount: currentWave.waveAddress.readS32(),
                waveMonsterAmount: currentWave.monstersAddress.readS32(),
                effectiveWaveAmount: effectiveWaveAmount,
                effectiveWaveMonsterAmount: effectiveWaveMonsterAmount
            };
            waveLayoutValid = true;
        } catch (currentWaveError) {
            if (String(currentWaveError).indexOf('尚未进入关卡') < 0) throw currentWaveError;
            currentStage = { inStage: false, reason: '尚未进入关卡' };
            waveLayoutValid = true;
        }
    } else {
        var stageBridge = resolveAutoBossStageBridge();
        var managerInfo = runtimeClassFields(il2cpp.methodGetClass(stageBridge.cacheByKey.mi));
        var probeCache = stageBridge.cacheByKey.fn(1310, stageBridge.cacheByKey.mi);
        if (isObviouslyInvalidPtr(probeCache)) throw new Error('关卡波数校验缓存为空');
        var cacheInfo = runtimeClassFields(il2cpp.objectGetClass(probeCache));
        var probeStageInfoOffset = firstFieldOffset(cacheInfo.fields, ['bfar']);
        var probeStageInfo = probeStageInfoOffset === 0x10 ?
            probeCache.add(probeStageInfoOffset).readPointer() : ptr(0);
        if (isObviouslyInvalidPtr(probeStageInfo)) throw new Error('关卡波数校验数据为空');
        var stageInfo = runtimeClassFields(il2cpp.objectGetClass(probeStageInfo));
        waveLayoutValid = !!managerInfo.fieldInfos.bfan &&
            firstFieldOffset(cacheInfo.fields, ['bfar']) === 0x10 &&
            firstFieldOffset(stageInfo.fields, ['WaveAmount']) === GAMEPLAY_WAVE_TOTAL_OFFSET &&
            firstFieldOffset(stageInfo.fields, ['WaveMonsterAmount']) === GAMEPLAY_MONSTERS_OFFSET;
        if (!waveLayoutValid) {
            throw new Error('关卡波数数据链版本校验失败：静态字段=' +
                (!!managerInfo.fieldInfos.bfan) + '，缓存字段=' +
                probeStageInfoOffset + '，波数字段=' +
                firstFieldOffset(stageInfo.fields, ['WaveAmount']) + '，每波怪物字段=' +
                firstFieldOffset(stageInfo.fields, ['WaveMonsterAmount']));
        }
        try {
            var wave = currentStageWaveData();
            currentStage = {
                cache: String(wave.cache),
                stageInfo: String(wave.stageInfo),
                waveAmount: wave.waveAddress.readS32(),
                waveMonsterAmount: wave.monstersAddress.readS32()
            };
        } catch (legacyWaveError) {
            if (String(legacyWaveError).indexOf('尚未进入关卡') < 0) throw legacyWaveError;
            currentStage = { inStage: false, reason: '尚未进入关卡' };
        }
    }
    var kernel = gameplayModule('kernel32.dll');
    var psapi = gameplayModule('psapi.dll');
    var getCurrentProcess = false;
    var emptyWorkingSet = false;
    try { getCurrentProcess = !!(kernel && kernel.getExportByName('GetCurrentProcess')); } catch (e1) {}
    try { emptyWorkingSet = !!(psapi && psapi.getExportByName('EmptyWorkingSet')); } catch (e2) {}
    try {
        if (!emptyWorkingSet) emptyWorkingSet = !!(kernel && kernel.getExportByName('K32EmptyWorkingSet'));
    } catch (e3) {}
    if (!getCurrentProcess || !emptyWorkingSet) throw new Error('内存清理系统接口版本校验失败');
    var result = {
        executed: false,
        gameVersion: currentBuild ? '2026-10-27/build26211490' : 'legacy',
        waveLayoutValid: waveLayoutValid,
        currentStage: currentStage,
        memoryCleanAvailable: true
    };
    if (currentBuild) {
        result.damageMethods = currentDamageMethods;
    } else {
        result.playerStatPatternRva = '0x' + B.add(GAMEPLAY_PSTAT_RVA).sub(B).toString(16);
        result.playerStatGlobalRva = '0x' + resolvePstatAddress().sub(B).toString(16);
        result.attackDamageAddress = String(damageAddress);
        result.attackDamage = damageAddress.readFloat();
        result.heroDamageRva = '0x' + heroDamage.address.sub(B).toString(16);
    }
    return result;
}

function cleanGameWorkingSet() {
    if (!g_emptyWorkingSet || !g_getCurrentProcess) {
        var kernel = gameplayModule('kernel32.dll');
        var psapi = gameplayModule('psapi.dll');
        if (!kernel) throw new Error('内存清理系统接口不可用');
        g_getCurrentProcess = new NativeFunction(kernel.getExportByName('GetCurrentProcess'), 'pointer', []);
        var emptyWorkingSetPtr = null;
        try {
            if (psapi) emptyWorkingSetPtr = psapi.getExportByName('EmptyWorkingSet');
        } catch (e1) {}
        try {
            if (!emptyWorkingSetPtr) emptyWorkingSetPtr = kernel.getExportByName('K32EmptyWorkingSet');
        } catch (e2) {}
        if (!emptyWorkingSetPtr) throw new Error('内存清理入口不可用');
        g_emptyWorkingSet = new NativeFunction(emptyWorkingSetPtr, 'bool', ['pointer']);
    }
    if (!g_emptyWorkingSet(g_getCurrentProcess())) throw new Error('系统拒绝清理游戏工作集');
    g_gameplayLastMemoryCleanAt = Date.now();
    gameplayLog('内存清理完成。');
}

function clearGameplayTimer() {
    if (g_gameplayTimer) {
        clearTimeout(g_gameplayTimer);
        g_gameplayTimer = null;
    }
}

function gameplayEnabled() {
    return g_instantKillEnabled || g_godModeEnabled || g_waveLockEnabled || g_memoryCleanEnabled;
}

function runGameplayPump() {
    if (!g_running || !gameplayEnabled()) return;
    var now = Date.now();
    if (g_instantKillEnabled && now >= (g_gameplayNextAttemptAt.instantKill || 0)) {
        try {
            lockInstantKillOnce();
            g_gameplayNextAttemptAt.instantKill = now + 500;
        } catch (e1) {
            g_pstatAddress = ptr(0);
            g_gameplayNextAttemptAt.instantKill = now + 5000;
            gameplayReportError('instantKill', '秒杀', e1);
        }
    }
    if (g_godModeEnabled && now >= (g_gameplayNextAttemptAt.godMode || 0)) {
        try {
            enableGodModeOnce();
            g_gameplayNextAttemptAt.godMode = now + 5000;
        } catch (e2) {
            g_gameplayNextAttemptAt.godMode = now + 5000;
            gameplayReportError('godMode', '无敌', e2);
        }
    }
    if (g_waveLockEnabled && now >= (g_gameplayNextAttemptAt.waveLock || 0)) {
        try {
            lockWaveValuesOnce();
            g_gameplayNextAttemptAt.waveLock = now + 500;
        } catch (e3) {
            g_gameplayNextAttemptAt.waveLock = now + 5000;
            gameplayReportError('waveLock', '波数锁定', e3);
        }
    }
    if (g_memoryCleanEnabled && now - g_gameplayLastMemoryCleanAt >= g_memoryCleanIntervalMs) {
        try { cleanGameWorkingSet(); }
        catch (e4) { gameplayReportError('memoryClean', '内存清理', e4); }
    }
    g_gameplayTimer = setTimeout(runGameplayPump, g_gameplayPumpIntervalMs);
}

function configureGameplayFeatures(cfg) {
    var instantKill = cfg.instantKill === true;
    var godMode = cfg.godMode === true;
    var waveLock = cfg.waveLock === true;
    var memoryClean = cfg.memoryClean === true;
    if (g_instantKillEnabled && !instantKill) disableInstantKill();
    if (g_godModeEnabled && !godMode) disableGodMode();
    if (g_waveLockEnabled && !waveLock) disableWaveLock();
    g_instantKillEnabled = instantKill;
    g_godModeEnabled = godMode;
    g_waveLockEnabled = waveLock;
    g_waveTotalTarget = Math.max(1, parseInt(cfg.waveTotal, 10) || 1);
    g_monstersPerWaveTarget = Math.max(1, parseInt(cfg.monstersPerWave, 10) || 10);
    g_memoryCleanEnabled = memoryClean;
    g_memoryCleanIntervalMs = Math.max(1000, Math.round((parseFloat(cfg.memoryCleanIntervalSeconds) || 60) * 1000));
    if (!memoryClean) g_gameplayLastMemoryCleanAt = 0;
}

function disableAllGameplayFeatures() {
    clearGameplayTimer();
    disableInstantKill();
    disableGodMode();
    disableWaveLock();
    g_instantKillEnabled = false;
    g_godModeEnabled = false;
    g_waveLockEnabled = false;
    g_memoryCleanEnabled = false;
}

function readEquippedUids(player, playerFields) {
    var equipped = {};
    if (playerFields.heroSaveDatas == null) return equipped;
    var heroes = readListObjects(player.add(playerFields.heroSaveDatas).readPointer());
    var heroInfo = classInfo('TaskbarHero.EasySaveData', 'HeroSaveData');
    for (var i = 0; i < heroes.length; i++) {
        var h = heroes[i];
        if (!h || h.isNull()) continue;
        try {
            var arr = h.add(heroInfo.fields.equippedItemIds).readPointer();
            var uids = readU64Array(arr);
            for (var j = 0; j < uids.length; j++) {
                if (uids[j] && uids[j] !== '0') equipped[uids[j]] = true;
            }
        } catch (e) {}
    }
    return equipped;
}

function addDiagSample(diag, reason, detail) {
    if (!diag || !detail) return;
    if (!diag.samples) diag.samples = [];
    if (diag.samples.length >= 20) return;
    detail.reason = reason;
    diag.samples.push(detail);
}

function finishInventoryScan(rows, startedAt) {
    g_lastScanDurationMs = Math.max(0, Date.now() - startedAt);
    g_scanCount++;
    if (g_lastScanDurationMs >= 750 && Date.now() - g_lastSlowScanLogAt >= 10000) {
        g_lastSlowScanLogAt = Date.now();
        log('扫描耗时偏高：' + g_lastScanDurationMs + 'ms，后续扫描将复用运行时对象缓存。');
    }
    return rows;
}

function scanInventory() {
    var startedAt = Date.now();
    var player = findPlayerSaveData();
    if (!player || player.isNull()) throw new Error('PlayerSaveData not found');
    var pinfo = classInfo('TaskbarHero', 'PlayerSaveData');
    var pfields = pinfo.fields;
    if (pfields.itemSaveDatas == null) throw new Error('PlayerSaveData.itemSaveDatas not found');

    g_lastScanErrors = [];
    g_lastUnsynthableRows = [];
    g_lastPlacedRows = [];
    var itemCache = getLocalItemInfoCache();
    var sources = readPlacedUidsBackpackStash(player, pfields);
    var equipped = readEquippedUids(player, pfields);
    var itemInfo = classInfo('TaskbarHero.EasySaveData', 'ItemSaveData');
    var items = readListObjects(player.add(pfields.itemSaveDatas).readPointer());
    g_lastRuntimeItemInfoByUid = itemCache;
    g_lastPlacedSourcesByUid = sources;
    g_lastEquippedUids = equipped;
    g_lastItemSaveUidSet = {};
    g_lastItemSaveFields = Object.keys(itemInfo.fields || {});
    var seenItemSaveUids = {};
    var placedUids = Object.keys(sources || {});
    g_lastPlacedUidSet = {};
    g_lastPlacedQuantityByUid = {};
    for (var placedIndex = 0; placedIndex < placedUids.length; placedIndex++) {
        var placedUid = placedUids[placedIndex];
        g_lastPlacedUidSet[placedUid] = true;
        g_lastPlacedQuantityByUid[placedUid] = sources[placedUid].reduce(function (total, source) {
            return total + (source.quantity || 1);
        }, 0);
    }
    pruneRecentlyConsumedUids(g_lastPlacedQuantityByUid);
    var placedDiagnostics = {
        placedUidCount: placedUids.length,
        itemSaveRows: items.length,
        placedItemSaveRows: 0,
        candidateRows: 0,
        missingItemSaveRows: 0,
        missingItemSaveRowsWithRuntimeInfo: 0,
        missingItemSaveRowsWithoutRuntimeInfo: 0,
        unplacedItemSaveRows: 0,
        noCategory: 0,
        notSynthable: 0,
        runtimeInfoMissing: 0,
        byItemKeyPrefix: {},
        samples: []
    };
    var itemUidField = firstFieldOffset(itemInfo.fields, ['UniqueId', 'uniqueId', 'ItemUniqueId', 'itemUniqueId', 'UID', 'uid']);
    if (itemUidField == null) {
        pushScanError('item-uid-field-missing', 'ItemSaveData uid field not found', { fields: g_lastItemSaveFields });
        g_lastPlacedDiagnostics = placedDiagnostics;
        return finishInventoryScan([], startedAt);
    }
    var rows = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || item.isNull()) continue;
        try {
            var uid = readU64Text(item.add(itemUidField));
            if (!uid || uid === '0') continue;
            seenItemSaveUids[uid] = true;
            var itemKey = readS32Field(item, itemInfo.fields, ['ItemKey', 'itemKey', 'ItemId', 'itemId'], 0);
            var itemKeyPrefix = String(itemKey || '').substring(0, 2);
            var blocked = readBoolField(item, itemInfo.fields, ['IsBlocked', 'isBlocked', 'Locked', 'locked']);
            var pending = readBoolField(item, itemInfo.fields, ['IsServerPendingItem', 'isServerPendingItem', 'ServerPending', 'serverPending']);
            var hasRuntimeInfo = itemCache[uid] != null;
            var cache = hasRuntimeInfo ? itemCache[uid] : {};
            var grade = hasRuntimeInfo ? cache.grade : fallbackGrade(itemKey);
            var synthType = hasRuntimeInfo ? cache.synthesisType : -1;
            var synthable = hasRuntimeInfo && cache.synthable === true;
            var synthableSource = hasRuntimeInfo ? (cache.synthableSource || 'runtime-enum') : 'runtime-info-missing';
            var category = categoryFromItem({
                itemKey: itemKey,
                synthesisType: synthType,
                gearGroup: cache.gearGroup,
                parts: cache.parts,
                gearType: cache.gearType
            }, !hasRuntimeInfo);
            var placed = sources[uid] || [];
            var row = {
                uid: uid,
                itemKey: itemKey,
                categoryKey: category ? category.key : '',
                category: category ? category.name : '',
                gradeKey: enumName(grade),
                grade: gradeZh(grade),
                gradeValue: grade,
                synthesisType: synthType,
                level: cache.level || 0,
                locked: blocked,
                serverPending: pending,
                deletedInServer: cache.isDeleted === true,
                temporaryBlocked: cache.temporaryBlocked === true,
                synthable: synthable,
                synthableSource: synthableSource,
                runtimeInfo: hasRuntimeInfo,
                equipped: equipped[uid] === true,
                placed: placed.length > 0,
                sources: placed
            };
            if (row.placed) {
                placedDiagnostics.placedItemSaveRows++;
                placedDiagnostics.byItemKeyPrefix[itemKeyPrefix] = (placedDiagnostics.byItemKeyPrefix[itemKeyPrefix] || 0) + 1;
                g_lastPlacedRows.push(row);
            } else {
                placedDiagnostics.unplacedItemSaveRows++;
            }
            if (!hasRuntimeInfo && row.placed) placedDiagnostics.runtimeInfoMissing++;
            if (!row.synthable) {
                if (row.placed) {
                    placedDiagnostics.notSynthable++;
                    if (row.runtimeInfo) g_lastUnsynthableRows.push(row);
                    addDiagSample(placedDiagnostics, 'not-synthable', {
                        uid: uid,
                        itemKey: itemKey,
                        synthesisType: synthType,
                        synthableSource: row.synthableSource,
                        sources: placed
                    });
                }
                continue;
            }
            if (!row.categoryKey) {
                if (row.placed) {
                    placedDiagnostics.noCategory++;
                    addDiagSample(placedDiagnostics, 'no-category', {
                        uid: uid,
                        itemKey: itemKey,
                        synthesisType: synthType,
                        synthableSource: row.synthableSource,
                        sources: placed
                    });
                }
                continue;
            }
            rows.push(row);
        } catch (e) {
            pushScanError('item-row-read', e, { index: i });
        }
    }
    for (var su = 0; su < placedUids.length; su++) {
        var placedUid = placedUids[su];
        if (seenItemSaveUids[placedUid]) continue;
        placedDiagnostics.missingItemSaveRows++;
        if (itemCache[placedUid]) placedDiagnostics.missingItemSaveRowsWithRuntimeInfo++;
        else placedDiagnostics.missingItemSaveRowsWithoutRuntimeInfo++;
        addDiagSample(placedDiagnostics, 'missing-item-save', {
            uid: placedUid,
            runtimeInfoAvailable: itemCache[placedUid] != null,
            sources: sources[placedUid]
        });
    }
    g_lastItemSaveUidSet = seenItemSaveUids;
    placedDiagnostics.candidateRows = rows.length;
    g_lastPlacedDiagnostics = placedDiagnostics;
    return finishInventoryScan(rows, startedAt);
}

function resolveMethodInfoFromRvas(rvas, className, methodName, argCount) {
    if (className && methodName) {
        var named = findMethodInfo('', className, methodName, argCount);
        var namedPtr = methodPtr(named);
        if (named && !named.isNull() && namedPtr && !namedPtr.isNull()) {
            var namedRva = namedPtr.sub(B).toInt32() >>> 0;
            for (var namedIndex = 0; namedIndex < rvas.length; namedIndex++) {
                if (namedRva === (rvas[namedIndex] >>> 0)) {
                    return { mi: named, ptr: namedPtr, rva: namedRva };
                }
            }
        }
    }
    for (var i = 0; i < rvas.length; i++) {
        var mi = findMethodInfoByRva(rvas[i]);
        if (mi && !mi.isNull()) return { mi: mi, ptr: methodPtr(mi), rva: rvas[i] };
    }
    return null;
}

function resolveAutoBossStageBridge() {
    if (g_autoBossStageBridgeResolved) return g_autoBossStageBridgeResolved;
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        var currentCache = {derived:true, mi:ptr(0), ptr:ptr(0), rva:0,
            fn:function (stageKey) { return stageCacheByKeyFromLoadedList(stageKey); }};
        var currentValidate = resolveCubeBridgeMethod(AUTO_BOSS_STAGE_BRIDGE_CURRENT.validateEnter);
        var currentEnter = resolveCubeBridgeMethod(AUTO_BOSS_STAGE_BRIDGE_CURRENT.enterStage);
        var currentScene = resolveCubeBridgeMethod(AUTO_BOSS_STAGE_BRIDGE_CURRENT.returnScene);
        var currentPlague = resolveCubeBridgeMethod(AUTO_BOSS_STAGE_BRIDGE_CURRENT.validatePlague);
        verifyManagedMethodShape('xi.kxg', currentValidate, 'TaskbarHero.EStageEnterResultType', ['xo.StageCache']);
        verifyManagedMethodShape('xi.kxi', currentEnter, 'System.Void', ['xo.StageCache', 'System.Action<System.Boolean>']);
        verifyManagedMethodShape('xi.kxh', currentPlague, 'TaskbarHero.EStageEnterResultType', ['xo.StageCache']);
        verifyManagedMethodShape('xi.kxu', currentScene, 'Cysharp.Threading.Tasks.UniTaskVoid', ['System.Int32', 'System.Int32']);
        currentValidate.fn = new NativeFunction(currentValidate.ptr, 'int', ['pointer', 'pointer']);
        currentEnter.fn = new NativeFunction(currentEnter.ptr, 'void', ['pointer', 'pointer', 'pointer']);
        currentScene.fn = new NativeFunction(currentScene.ptr, 'void', ['int', 'int', 'pointer']);
        currentPlague.fn = new NativeFunction(currentPlague.ptr, 'int', ['pointer', 'pointer']);
        g_autoBossStageBridgeResolved = {
            current: true,
            cacheByKey: currentCache,
            validateEnter: currentValidate,
            enterStage: currentEnter,
            enterScene: null,
            returnScene: currentScene,
            validatePlague: currentPlague
        };
        installAutoBossReturnHooks(g_autoBossStageBridgeResolved);
        return g_autoBossStageBridgeResolved;
    }
    var cacheByKey = resolveMethodInfoFromRvas([AUTO_BOSS_STAGE_BRIDGE.cacheByKeyRva], 'uq', 'ids', 1);
    var validateEnter = resolveMethodInfoFromRvas([AUTO_BOSS_STAGE_BRIDGE.validateEnterRva], 'uq', 'jgx', 1);
    var enterStage = resolveMethodInfoFromRvas([AUTO_BOSS_STAGE_BRIDGE.enterStageRva], 'uq', 'jgy', 2);
    var enterScene = resolveMethodInfoFromRvas([AUTO_BOSS_STAGE_BRIDGE.enterSceneRva], 'uq', 'jtt', 1);
    if (!cacheByKey || !cacheByKey.ptr || cacheByKey.ptr.isNull()) {
        throw new Error('找不到关卡缓存读取入口');
    }
    if (!validateEnter || !validateEnter.ptr || validateEnter.ptr.isNull()) {
        throw new Error('找不到关卡进入条件检查入口');
    }
    if (!enterStage || !enterStage.ptr || enterStage.ptr.isNull()) {
        throw new Error('找不到关卡进入入口');
    }
    if (!enterScene || !enterScene.ptr || enterScene.ptr.isNull()) {
        throw new Error('找不到关卡场景切换入口');
    }
    g_autoBossStageBridgeResolved = {
        cacheByKey: {
            mi: cacheByKey.mi,
            ptr: cacheByKey.ptr,
            rva: cacheByKey.rva,
            fn: new NativeFunction(cacheByKey.ptr, 'pointer', ['int', 'pointer'])
        },
        validateEnter: {
            mi: validateEnter.mi,
            ptr: validateEnter.ptr,
            rva: validateEnter.rva,
            fn: new NativeFunction(validateEnter.ptr, 'int', ['pointer', 'pointer'])
        },
        enterStage: {
            mi: enterStage.mi,
            ptr: enterStage.ptr,
            rva: enterStage.rva,
            fn: new NativeFunction(enterStage.ptr, 'void', ['pointer', 'pointer', 'pointer'])
        },
        enterScene: {
            mi: enterScene.mi,
            ptr: enterScene.ptr,
            rva: enterScene.rva,
            fn: new NativeFunction(enterScene.ptr, 'void', ['int', 'pointer'])
        }
    };
    return g_autoBossStageBridgeResolved;
}

var g_bossReturnContext = null;
var g_bossReturnListeners = [];
var g_bossReturnTimer = null;
var g_bossReturnDispatching = false;
var g_bossProgrammaticEntryUntil = 0;
var g_bossEntryCallback = null;
var g_bossResumeAfterReturn = false;

var g_ticketCheckIntervalMs = 60000;
var g_bossNextInventoryCheckAt = 0;
var g_eventNextTicketCheckAt = 0;
var g_frameLimitBridge = null;
var g_frameLimitTargetFrameRate = null;
var g_frameLimitVsync = null;
var g_backgroundModeBridge = null;
var g_backgroundModeValue = null;

function fridaCurrentCombatState() {
    try {
        var stageClass = findClassByEnumeratedName('TaskbarHero.UI', 'UI_Stage');
        if (isBadPtr(stageClass)) stageClass = findClassByEnumeratedName('', 'UI_Stage');
        if (isBadPtr(stageClass)) return null;
        var rows = findObjectsOfType(stageClass);
        if (!rows.length) return false;
        var stageInfo = runtimeClassFields(stageClass);
        var healthOffset = firstFieldOffset(stageInfo.fields, ['HealthUI', 'healthUI']);
        if (healthOffset == null) return null;
        for (var i = 0; i < rows.length; i++) {
            if (isBadPtr(rows[i])) continue;
            var health = rows[i].add(healthOffset).readPointer();
            if (isBadPtr(health)) continue;
            var healthClass = il2cpp.objectGetClass(health);
            var alphaMethod = il2cpp.classGetMethod(healthClass, Memory.allocUtf8String('get_alpha'), 0);
            var alphaPtr = methodPtr(alphaMethod);
            if (isBadPtr(alphaPtr)) continue;
            var alpha = new NativeFunction(alphaPtr, 'float', ['pointer', 'pointer'])(health, alphaMethod);
            return alpha > 0.1;
        }
        return false;
    } catch (e) { return null; }
}

function fridaStageName(stage) {
    if (!stage) return '';
    if (stage.stageType === 2) return '瘟疫之地 ' + ({1:'噩梦',2:'地狱',3:'折磨'}[stage.difficulty] || '') + ' ' + stage.stageNo + ' 层';
    if (stage.stageType === 4) return '南瓜灯峡谷';
    return '关卡 ' + stage.act + '-' + stage.stageNo;
}

function fridaInventoryRowsSnapshot() {
    scanInventory();
    var sourceCounts = g_lastSourceCounts || {};
    var rows = [];
    (g_lastPlacedRows || []).forEach(function (row) {
        (row.sources || []).forEach(function (source) {
            rows.push({
                uid: String(row.uid || ''),
                item_key: Number(row.itemKey) || 0,
                type: String(row.category || row.categoryKey || ''),
                grade: Number(row.gradeValue),
                level: Number(row.level || 0),
                quantity: Math.max(1, Number(source.quantity) || 1),
                quantity_known: true,
                page: source.source === '仓库' ? Math.floor((Number(source.index) || 0) / STASH_PAGE_SIZE) + 1 : 0,
                slot: Number(source.index) || 0,
                source: String(source.source || ''),
                locked: row.locked === true,
                equipped: row.equipped === true,
                server_pending: row.serverPending === true,
                trade_ship_deferred_until: tradeShipDeferredUntil(row.uid)
            });
        });
    });
    return JSON.stringify({
        status: 'SUCCESS',
        used: Math.max(0, Number(sourceCounts.stash) || 0),
        capacity: STASH_SLOT_COUNT,
        pages: STASH_PAGE_COUNT,
        page_size: STASH_PAGE_SIZE,
        missing: 0,
        read_at: Date.now(),
        account_key: tradeShipAccountKey(),
        items: rows,
        material_stash_count: Math.max(0, Number(sourceCounts.materialStash) || 0),
        scan_errors: g_lastScanErrors || []
    });
}

function fridaTicketInventorySnapshot() {
    scanInventory();
    var totals = {};
    (g_lastPlacedRows || []).forEach(function (row) {
        var id = Number(row.itemKey) || 0;
        var soulstone = id >= 190001 && id <= 190004;
        var contaminated = id >= 190102 && id <= 190104;
        var jack = id >= 170101 && id <= 170103;
        if (!soulstone && !contaminated && !jack) return;
        if (row.locked || row.serverPending || row.deletedInServer) return;
        var count = (row.sources || []).reduce(function (sum, source) {
            return sum + Math.max(0, Number(source.quantity) || 0);
        }, 0);
        totals[id] = (totals[id] || 0) + count;
    });
    var names = {
        190001: 'Soulstone - Normal', 190002: 'Soulstone - Nightmare',
        190003: 'Soulstone - Hell', 190004: 'Soulstone - Torment',
        190102: 'Contaminated Soulstone - Nightmare', 190103: 'Contaminated Soulstone - Hell',
        190104: 'Contaminated Soulstone - Torment',
        170101: '杰克的入场券（噩梦）', 170102: '杰克的入场券（地狱）', 170103: '杰克的入场券（折磨）'
    };
    var items = Object.keys(totals).map(function (key) {
        return {item_id:Number(key), name:names[key] || ('Item ' + key), count:totals[key], grade:-1};
    });
    return JSON.stringify({status:'SUCCESS', items:items});
}

function resolveFridaFrameLimitBridge() {
    if (g_frameLimitBridge) return g_frameLimitBridge;
    function resolveSetter(namespaceName, className, methodName) {
        var klassPtr = klass(namespaceName, className, 'UnityEngine.CoreModule.dll');
        if (isBadPtr(klassPtr)) throw new Error(className + ' class not found');
        var mi = il2cpp.classGetMethod(klassPtr, Memory.allocUtf8String(methodName), 1);
        var ptrValue = methodPtr(mi);
        if (isBadPtr(mi) || isBadPtr(ptrValue) ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetParam(mi, 0))) !== 'System.Int32') {
            throw new Error(methodName + ' method signature mismatch');
        }
        return {mi:mi, ptr:ptrValue, fn:new NativeFunction(ptrValue, 'void', ['int32', 'pointer'])};
    }
    function resolveGetter(namespaceName, className, methodName) {
        var klassPtr = klass(namespaceName, className, 'UnityEngine.CoreModule.dll');
        if (isBadPtr(klassPtr)) throw new Error(className + ' class not found');
        var mi = il2cpp.classGetMethod(klassPtr, Memory.allocUtf8String(methodName), 0);
        var ptrValue = methodPtr(mi);
        if (!isBadPtr(mi) && !isBadPtr(ptrValue) &&
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi))) === 'System.Int32') {
            return {mi:mi, ptr:ptrValue, fn:new NativeFunction(ptrValue, 'int32', ['pointer'])};
        }
        // Unity may strip the managed getter while retaining its native internal call.
        var names = [namespaceName + '.' + className + '::' + methodName + '()',
            namespaceName + '.' + className + '::' + methodName];
        for (var i = 0; i < names.length; i++) {
            var nativePtr = il2cpp.resolveIcall(Memory.allocUtf8String(names[i]));
            if (isBadPtr(nativePtr)) continue;
            var getter = new NativeFunction(nativePtr, 'int32', []);
            return {mi:ptr(0), ptr:nativePtr, fn:function () { return getter(); }, icall:true};
        }
        throw new Error(methodName + ' managed getter and Unity internal call unavailable');
    }
    g_frameLimitBridge = {
        target:resolveSetter('UnityEngine', 'Application', 'set_targetFrameRate'),
        vsync:resolveSetter('UnityEngine', 'QualitySettings', 'set_vSyncCount'),
        getTarget:resolveGetter('UnityEngine', 'Application', 'get_targetFrameRate'),
        getVsync:resolveGetter('UnityEngine', 'QualitySettings', 'get_vSyncCount'),
        listeners:[]
    };
    return g_frameLimitBridge;
}

function diagnoseFridaFrameLimit() {
    var result = {gameAssemblySize:GA.size, images:(g_images || allImages()).map(function (row) { return row.name; }), classes:{}};
    ['Application','QualitySettings'].forEach(function (className) {
        var rows = [];
        (g_images || allImages()).forEach(function (image) {
            var klassPtr = il2cpp.classFromName(image.image, Memory.allocUtf8String('UnityEngine'),
                Memory.allocUtf8String(className));
            if (isBadPtr(klassPtr)) return;
            var methods = [];
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var i = 0; i < 1000; i++) {
                var method = il2cpp.classGetMethods(klassPtr, iter);
                if (isBadPtr(method)) break;
                var name = cstr(il2cpp.methodGetName(method));
                if (name.indexOf('targetFrameRate') < 0 && name.indexOf('vSyncCount') < 0 &&
                        name.indexOf('runInBackground') < 0) continue;
                var methodPointer = methodPtr(method);
                methods.push({name:name, parameters:il2cpp.methodGetParamCount(method),
                    returnType:cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method))),
                    parameterTypes:(function () {
                        var params=[];
                        var count=il2cpp.methodGetParamCount(method);
                        for(var p=0;p<count;p++) params.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method,p))));
                        return params;
                    })(), rva:isBadPtr(methodPointer)?'':'0x'+methodPointer.sub(B).toString(16)});
            }
            rows.push({image:image.name,methods:methods});
        });
        result.classes[className]=rows;
    });
    return JSON.stringify(result);
}

function installFrameLimitHooks(bridge) {
    if (bridge.listeners.length) return;
    bridge.listeners.push(Interceptor.attach(bridge.target.ptr, {
        onEnter: function (args) {
            if (g_frameLimitTargetFrameRate !== null) args[0] = ptr(g_frameLimitTargetFrameRate);
        }
    }));
    bridge.listeners.push(Interceptor.attach(bridge.vsync.ptr, {
        onEnter: function (args) {
            if (g_frameLimitTargetFrameRate !== null) args[0] = ptr(0);
        }
    }));
}

function readFridaFrameLimit(bridge) {
    var target = bridge.getTarget.fn(bridge.getTarget.mi) | 0;
    var vsync = bridge.getVsync.fn(bridge.getVsync.mi) | 0;
    return {status:'SUCCESS', fps:target < 0 ? 0 : target,
        targetFrameRate:target, vsync:vsync,
        requestedFps:g_frameLimitTargetFrameRate == null ? null : (g_frameLimitTargetFrameRate < 0 ? 0 : g_frameLimitTargetFrameRate)};
}

function applyFridaFrameLimit(fps) {
    fps = Number(fps);
    var bridge = resolveFridaFrameLimitBridge();
    g_frameLimitTargetFrameRate = fps === 0 ? -1 : fps;
    g_frameLimitVsync = 0;
    installFrameLimitHooks(bridge);
    bridge.vsync.fn(0, bridge.vsync.mi);
    bridge.target.fn(g_frameLimitTargetFrameRate, bridge.target.mi);
    var result = readFridaFrameLimit(bridge);
    result.appliedTargetFrameRate = g_frameLimitTargetFrameRate;
    if (result.targetFrameRate !== g_frameLimitTargetFrameRate || result.vsync !== 0) {
        result.status = 'FAILED';
        result.error = 'Unity did not retain the requested frame cap';
    }
    return JSON.stringify(result);
}

function setFridaFrameLimit(fps) {
    requireCurrentGameBuild();
    fps = Number(fps);
    if ([0, 10, 15, 30].indexOf(fps) < 0)
        return JSON.stringify({status:'FAILED', error:'INVALID_FPS'});
    if (!ensureUpdateHook()) return JSON.stringify({status:'FAILED', error:'Unity main-thread update hook unavailable'});
    return new Promise(function (resolve) {
        var settled = false;
        var item = {action:'frameLimit', fps:fps, at:Date.now(), resolve:function (value) {
            if (settled) return;
            settled = true;
            if (item.timeout) clearTimeout(item.timeout);
            resolve(value);
        }};
        item.timeout = setTimeout(function () {
            var index = g_queue.indexOf(item);
            if (index >= 0) g_queue.splice(index, 1);
            item.resolve(JSON.stringify({status:'FAILED', error:'Timed out waiting for Unity main thread'}));
        }, 8000);
        g_queue.unshift(item);
    });
}

function resolveFridaBackgroundModeBridge() {
    if (g_backgroundModeBridge) return g_backgroundModeBridge;
    var klassPtr = klass('UnityEngine', 'Application', 'UnityEngine.CoreModule.dll');
    if (isBadPtr(klassPtr)) throw new Error('Application class not found');
    var mi = il2cpp.classGetMethod(klassPtr, Memory.allocUtf8String('set_runInBackground'), 1);
    var ptrValue = methodPtr(mi);
    if (!isBadPtr(mi) && !isBadPtr(ptrValue) &&
            cstr(il2cpp.typeGetName(il2cpp.methodGetParam(mi, 0))) === 'System.Boolean' &&
            cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi))) === 'System.Void') {
        g_backgroundModeBridge = {mi:mi, ptr:ptrValue,
            fn:new NativeFunction(ptrValue, 'void', ['bool', 'pointer']),
            icall:false};
    } else {
        var icallNames = [
            'UnityEngine.Application::set_runInBackground(System.Boolean)',
            'UnityEngine.Application::SetRunInBackground(System.Boolean)'
        ];
        var icallPtr = ptr(0);
        var icallName = '';
        for (var i = 0; i < icallNames.length; i++) {
            icallPtr = il2cpp.resolveIcall(Memory.allocUtf8String(icallNames[i]));
            if (!isBadPtr(icallPtr)) { icallName = icallNames[i]; break; }
        }
        if (isBadPtr(icallPtr)) throw new Error('runInBackground setter and Unity internal call are unavailable');
        g_backgroundModeBridge = {mi:ptr(0), ptr:icallPtr,
            fn:new NativeFunction(icallPtr, 'void', ['bool']), icall:true, icallName:icallName};
    }
    var getter = il2cpp.classGetMethod(klassPtr, Memory.allocUtf8String('get_runInBackground'), 0);
    var getterPtr = methodPtr(getter);
    if (isBadPtr(getter) || isBadPtr(getterPtr) ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(getter))) !== 'System.Boolean')
        throw new Error('get_runInBackground getter is unavailable');
    g_backgroundModeBridge.getterMi = getter;
    g_backgroundModeBridge.getter = new NativeFunction(getterPtr, 'bool', ['pointer']);
    return g_backgroundModeBridge;
}

function applyFridaBackgroundMode(enabled) {
    enabled = enabled === true;
    var bridge = resolveFridaBackgroundModeBridge();
    if (bridge.icall) bridge.fn(enabled ? 1 : 0);
    else bridge.fn(enabled ? 1 : 0, bridge.mi);
    g_backgroundModeValue = enabled;
    var actual = !!bridge.getter(bridge.getterMi);
    return JSON.stringify({status:actual === enabled ? 'SUCCESS' : 'FAILED',
        enabled:actual, requested:enabled, icall:bridge.icall === true,
        icallName:bridge.icallName || ''});
}

function setFridaBackgroundMode(enabled) {
    requireCurrentGameBuild();
    if (typeof enabled !== 'boolean') return JSON.stringify({status:'FAILED', error:'INVALID_BACKGROUND_MODE'});
    if (!ensureUpdateHook()) return JSON.stringify({status:'FAILED', error:'Unity main-thread update hook unavailable'});
    return new Promise(function (resolve) {
        var settled = false;
        var item = {action:'backgroundMode', enabled:enabled, at:Date.now(), resolve:function (value) {
            if (settled) return;
            settled = true;
            if (item.timeout) clearTimeout(item.timeout);
            resolve(value);
        }};
        item.timeout = setTimeout(function () {
            var index = g_queue.indexOf(item);
            if (index >= 0) g_queue.splice(index, 1);
            item.resolve(JSON.stringify({status:'FAILED', error:'Timed out waiting for Unity main thread'}));
        }, 8000);
        g_queue.unshift(item);
    });
}

function routeFridaToPlague(stageNo, expectedStageKey) {
    stageNo = parseInt(stageNo, 10);
    var target = plagueDropStageInfo(stageNo);
    if (!target) return 'LEVEL_UNAVAILABLE';
    var current = currentAutoBossStage();
    if (!current) return 'STAGE_UNKNOWN';
    if (expectedStageKey && current.stageKey !== (parseInt(expectedStageKey, 10) || 0)) return 'STAGE_CHANGED';
    if (current.stageType === 1 || current.stageType === 3 || current.stageType === 4 ||
            g_bossReturnContext || g_eventDungeonContext || g_bossState === 'waitingBox') return 'PRIORITY_ACTIVE';
    if (fridaCurrentCombatState() === true) return 'IN_COMBAT';
    var validation = target.bridge.validatePlague.fn(target.cache, target.bridge.validatePlague.mi) | 0;
    if (validation === 7) return 'COOLDOWN';
    if (validation !== 0) return 'PLAGUE_LOCKED:' + validation;
    if (g_queue.length || boxInventoryMutationActive() || synthesisInventoryMutationActive()) return 'ACTION_PENDING';
    var mapWaitUntil = Math.max(g_lastServerRequestAt + g_serverRequestSpacingMs,
        g_lastMapSwitchAt + g_mapSwitchMinimumIntervalMs);
    if (Date.now() < mapWaitUntil) return 'SAFE_INTERVAL:' + Math.ceil((mapWaitUntil - Date.now()) / 1000);
    prepareNativePlagueReturn(target.stage);
    g_lastServerRequestAt = Date.now();
    g_lastMapSwitchAt = g_lastServerRequestAt;
    g_bossReturnDispatching = true;
    try { target.bridge.returnScene.fn(target.stage.stageKey, 1, target.bridge.returnScene.mi); }
    finally { g_bossReturnDispatching = false; }
    return 'PENDING';
}

function bossReturnActionBusy() {
    // Wait only for a submitted operation or its queued preparation/cleanup.
    // Future batches and feature retry timers do not block a scene return.
    return !!(synthesisInventoryMutationActive() || g_corrosionFinishQueued ||
        g_boxOpenInFlight || g_boxResultTimer || g_boxOpenDispatching ||
        g_depositQueued || g_fullBackpackDepositQueued || g_fullBackpackDepositWaiting || g_tradeShipQueued ||
        g_tradeShipPending || g_tradeShipReleasePending || nativeExchangePending() ||
        g_queue.some(function (item) { return item.action !== 'bossStageReturn'; }));
}

function wakeBossCycleAfterReturn(record) {
    if (!record || !record.cycleYielded || !g_running || !g_autoBossEnabled) return;
    g_bossResumeAfterReturn = true;
    scheduleNext(20);
}

function resumeBossCycleAfterReturn() {
    if (!g_bossResumeAfterReturn) return false;
    if (!g_autoBossEnabled) {
        g_bossResumeAfterReturn = false;
        return false;
    }
    if (g_bossReturnContext || bossReturnActionBusy()) return false;
    g_bossResumeAfterReturn = false;
    g_cyclePhase = 'active';
    g_cycleSleepUntil = 0;
    g_bossNextActionAt = 0;
    cycleLog('已返回原关卡，继续检查剩余 Boss；其他功能保留原开关与规则。');
    return true;
}

function currentAutoBossStage() {
    var cache = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT
        ? currentStageCachePointer() : currentStageWaveData().cache;
    return readAutoBossStageInfo(cache);
}

function activeStageManagerStageInfo() {
    if (synthesisBridgeProfile() !== SYNTHESIS_BRIDGE_CURRENT) return null;
    var info = classInfo('TaskbarHero', 'StageManager');
    if (isBadPtr(info.klass) || info.fields.bgwe !== 0x20 ||
            info.fieldTypes.bgwe !== 'xo.StageCache') return null;
    var managers = findObjectsOfType(info.klass);
    for (var i = 0; i < managers.length; i++) {
        var manager = managers[i];
        if (isBadPtr(manager)) continue;
        var cache = manager.add(info.fields.bgwe).readPointer();
        if (isBadPtr(cache)) continue;
        var stage = readAutoBossStageInfo(cache);
        if (stage) {
            stage.mapSource = 'StageManager.bgwe';
            return stage;
        }
    }
    return null;
}

function savedPreviousNormalStageInfo() {
    var player = findPlayerSaveData();
    if (isBadPtr(player)) return null;
    var playerInfo = classInfo('TaskbarHero', 'PlayerSaveData');
    var commonOffset = playerInfo.fields.commonSaveData;
    if (commonOffset == null || playerInfo.fieldTypes.commonSaveData !== 'TaskbarHero.CommonSaveData')
        return null;
    var common = player.add(commonOffset).readPointer();
    if (isBadPtr(common)) return null;
    var commonInfo = classInfo('TaskbarHero', 'CommonSaveData');
    var previousNormalOffset = commonInfo.fields.prevNormalStageKey;
    if (previousNormalOffset == null) return null;
    var stageKey = common.add(previousNormalOffset).readS32();
    if (!(stageKey > 0)) return null;
    var cache = stageCacheByKeyFromLoadedList(stageKey);
    var stage = readAutoBossStageInfo(cache);
    if (!stage || stage.stageKey !== stageKey || stage.stageType !== 0) return null;
    stage.mapSource = 'CommonSaveData.prevNormalStageKey';
    return stage;
}

// xi.bizp follows the portal's selected StageCache. While the portal is open,
// that selection can differ from the stage the player is actually standing in.
// Prefer the live StageManager cache; if it is absent under the portal, use the
// game's saved previous normal stage as the entry origin instead of treating
// the selected plague floor as already entered.
function currentAutoPlagueStage() {
    try {
        var live = activeStageManagerStageInfo();
        if (live) {
            g_autoPlagueCurrentStageReadError = '';
            return live;
        }
    } catch (liveError) {
        g_autoPlagueCurrentStageReadError = 'StageManager: ' + chineseError(liveError);
    }
    // xi.bizp and CommonSaveData.currentStageKey can hold the last portal
    // selection while no playable StageManager cache exists. Treat the saved
    // previous normal stage as the origin until a live scene cache confirms a
    // real map entry; this also works after a stale portal has been closed.
    try {
        var previousNormal = savedPreviousNormalStageInfo();
        if (previousNormal) {
            g_autoPlagueCurrentStageReadError = '';
            return previousNormal;
        }
    } catch (previousError) {
        g_autoPlagueCurrentStageReadError = 'CommonSaveData: ' + chineseError(previousError);
    }
    try {
        var fallback = currentAutoBossStage();
        if (fallback) {
            fallback.mapSource = 'xi.bizp-fallback';
            return fallback;
        }
    } catch (fallbackError) {
        g_autoPlagueCurrentStageReadError = 'xi.bizp: ' + chineseError(fallbackError);
    }
    return null;
}

function plagueDropStageKey(stageNo) {
    stageNo = parseInt(stageNo, 10);
    if (stageNo < 1 || stageNo > 20) return 0;
    return 201400 + stageNo;
}

function plagueDropStageInfo(stageNo) {
    var key = plagueDropStageKey(stageNo);
    if (!key) return null;
    var bridge = resolveAutoBossStageBridge();
    var cache = bridge.cacheByKey.fn(key, bridge.cacheByKey.mi);
    var stage = readAutoBossStageInfo(cache);
    if (!stage || stage.stageKey !== key || stage.stageType !== 2 ||
            stage.act !== 23 || stage.stageNo !== stageNo) return null;
    return {bridge:bridge, cache:cache, stage:stage};
}

function plagueStageInfoByDifficultyFloor(difficulty, stageNo) {
    difficulty = parseInt(difficulty, 10);
    stageNo = parseInt(stageNo, 10);
    if (difficulty < 1 || difficulty > 3 || stageNo < 1 || stageNo > 20) return null;
    var owner = findClassByEnumeratedName('', 'xi');
    if (isBadPtr(owner)) throw new Error('瘟疫关卡缓存列表所属类型未找到');
    var fields = runtimeClassFields(owner).fields;
    if (fields.bizd !== 0x38) throw new Error('瘟疫关卡缓存列表字段版本校验失败');
    var staticData = il2cpp.classGetStaticFieldData(owner);
    if (isBadPtr(staticData)) return null;
    var list = staticData.add(fields.bizd).readPointer();
    if (isBadPtr(list)) return null;
    var caches = readListObjects(list, 20000);
    var matches = [];
    for (var i = 0; i < caches.length; i++) {
        var stage = readAutoBossStageInfo(caches[i]);
        if (!stage || stage.stageType !== 2 || stage.act !== 23 ||
                stage.difficulty !== difficulty || stage.stageNo !== stageNo) continue;
        matches.push({cache:caches[i], stage:stage});
    }
    if (matches.length !== 1) return null;
    return {bridge:resolveAutoBossStageBridge(), cache:matches[0].cache, stage:matches[0].stage};
}

function plagueStageInfoFromPortalSelection(difficulty, stageNo) {
    var portalState = autoPlaguePortalUiDiagnostics();
    if (!portalState.available || portalState.portalVisible !== true) return null;
    var managerInfo = classInfo('TaskbarHero', 'UIManager');
    if (isBadPtr(managerInfo.klass) || managerInfo.fields.Ui_Portal == null) return null;
    var manager = findStaticSingleton(managerInfo.klass, 'TaskbarHero.UIManager');
    if (isBadPtr(manager)) return null;
    var portal = manager.add(managerInfo.fields.Ui_Portal).readPointer();
    if (isBadPtr(portal)) return null;
    var portalInfo = classInfo('TaskbarHero.UI', 'UI_Portal');
    var plagueUiOffset = portalInfo.fields.plaguelandsUI;
    if (plagueUiOffset == null || portalInfo.fieldTypes.plaguelandsUI !== 'TaskbarHero.UI.UI_Plaguelands')
        return null;
    var plagueUi = portal.add(plagueUiOffset).readPointer();
    if (isBadPtr(plagueUi)) return null;
    var plagueInfo = classInfo('TaskbarHero.UI', 'UI_Plaguelands');
    var selectedNodeOffset = plagueInfo.fields.bksa;
    if (selectedNodeOffset == null || plagueInfo.fieldTypes.bksa !== 'TaskbarHero.StageNode')
        return null;
    var selectedNode = plagueUi.add(selectedNodeOffset).readPointer();
    if (isBadPtr(selectedNode)) return null;
    var nodeInfo = classInfo('TaskbarHero', 'StageNode');
    var cacheOffset = nodeInfo.fields.bgoq;
    if (cacheOffset == null || nodeInfo.fieldTypes.bgoq !== 'xo.StageCache') return null;
    var cache = selectedNode.add(cacheOffset).readPointer();
    var stage = readAutoBossStageInfo(cache);
    if (!stage || stage.stageType !== 2 || stage.act !== 23 ||
            stage.difficulty !== Number(difficulty) || stage.stageNo !== Number(stageNo)) return null;
    stage.mapSource = 'UI_Portal.plaguelandsUI.bksa';
    return {bridge:resolveAutoBossStageBridge(), cache:cache, stage:stage};
}

function resolveAutoPlagueTargetStage(difficulty, stageNo) {
    var cacheError = '';
    try {
        var cached = plagueStageInfoByDifficultyFloor(difficulty, stageNo);
        if (cached) return cached;
    } catch (error) {
        cacheError = chineseError(error);
    }
    try {
        var selected = plagueStageInfoFromPortalSelection(difficulty, stageNo);
        if (selected) return selected;
    } catch (portalError) {
        if (!cacheError) cacheError = chineseError(portalError);
    }
    if (cacheError) throw new Error('瘟疫目标缓存读取失败：' + cacheError);
    return null;
}

function plagueDropMonitorLane(boxType, boxItemId) {
    var id = String(parseInt(boxItemId, 10) || 0);
    if (/^91/.test(id)) return 'ordinary';
    if (/^(92|93)/.test(id)) return 'stage';
    return (parseInt(boxType, 10) || 0) === 0 ? 'ordinary' : 'stage';
}

function plaguePriceQueueSignature(snapshot) {
    var rows = [];
    (snapshot && snapshot.queues || []).forEach(function (group) {
        (group && group.items || []).forEach(function (reward) {
            rows.push(String(reward && reward.boxKey || '') + '|' +
                String(parseInt(reward && reward.rewardItemId, 10) || 0));
        });
    });
    rows.sort();
    return rows.join(';');
}

function evaluatePlaguePriceQueue(snapshot, priceRows, thresholdCny, targetItemIds) {
    if (!snapshot || snapshot.available !== true || !Array.isArray(snapshot.queues)) {
        return {ready:false, hit:false, reason:'drop-queue-unavailable'};
    }
    var unresolved = [];
    var hits = [];
    var threshold = Math.max(0, Number(thresholdCny) || 0);
    var targets = {};
    (targetItemIds || []).forEach(function (id) { targets[String(id)] = true; });
    (snapshot.queues || []).forEach(function (group) {
        (group && group.items || []).forEach(function (reward) {
            var itemId = parseInt(reward && reward.rewardItemId, 10) || 0;
            if (itemId <= 0) {
                unresolved.push(itemId);
                return;
            }
            var price = (priceRows || {})[String(itemId)];
            if (targets[String(itemId)]) {
                hits.push({itemId:itemId, priceCny:price && price.priceCny || null,
                    matchReason:'item-id', boxKey:String(reward.boxKey || '')});
                return;
            }
            if (!price || price.resolved !== true) {
                unresolved.push(itemId);
                return;
            }
            if (price.hasQuote === false) return;
            var priceCny = Number(price.priceCny || 0);
            if (!Number.isFinite(priceCny) || priceCny < 0) {
                unresolved.push(itemId);
                return;
            }
            if (priceCny > threshold) {
                hits.push({itemId:itemId, priceCny:priceCny, marketName:price.marketName || '',
                    matchReason:'price', boxKey:String(reward.boxKey || '')});
            }
        });
    });
    if (hits.length) {
        hits.sort(function (a,b) { return b.priceCny - a.priceCny; });
        return {ready:true, hit:true, item:hits[0]};
    }
    if (unresolved.length) {
        return {ready:false, hit:false, reason:'unresolved-price', unresolvedItemIds:unresolved};
    }
    hits.sort(function (a,b) { return b.priceCny - a.priceCny; });
    return {ready:true, hit:hits.length > 0, item:hits[0] || null};
}

function currentPlagueManualWait(snapshot, stageKey) {
    if (g_plagueManualWait.stageKey !== stageKey) {
        g_plagueManualWait = {stageKey:stageKey, items:{}};
        return null;
    }
    if (!snapshot || snapshot.available !== true) return null;
    var live = {};
    (snapshot.queues || []).forEach(function (group) {
        (group.items || []).forEach(function (row) {
            var key = String(row.boxKey || '');
            var selected = g_plagueManualWait.items[key];
            if (selected && selected.itemId === Number(row.rewardItemId)) live[key] = selected;
        });
    });
    g_plagueManualWait.items = live;
    var keys = Object.keys(live);
    return keys.length ? live[keys[0]] : null;
}

function addPlagueManualWaitBox(boxKey, expectedStageKey, itemId) {
    var current = currentAutoBossStage();
    boxKey = String(boxKey || '');
    itemId = Number(itemId) || 0;
    if (!current || !current.stageKey || current.stageKey !== Number(expectedStageKey)) {
        return JSON.stringify({accepted:false, reason:'stage-changed'});
    }
    var snapshot = readGameDropPreviewSnapshot(true);
    if (!snapshot || snapshot.available !== true) return JSON.stringify({accepted:false, reason:'queue-unavailable'});
    var selected = null;
    (snapshot.queues || []).forEach(function (group) {
        (group.items || []).forEach(function (row) {
            if (boxKey && String(row.boxKey || '') === boxKey && itemId > 0 && Number(row.rewardItemId) === itemId) {
                selected = {itemId:itemId, boxKey:boxKey, matchReason:'manual', priceCny:null};
            }
        });
    });
    if (!selected) return JSON.stringify({accepted:false, reason:'already-spawned'});
    if (currentAutoBossStage().stageKey !== current.stageKey) return JSON.stringify({accepted:false, reason:'stage-changed'});
    if (g_plagueManualWait.stageKey !== current.stageKey) g_plagueManualWait = {stageKey:current.stageKey, items:{}};
    g_plagueManualWait.items[boxKey] = selected;
    // The user may select a card after a switch has already been queued.
    // Cancel that queue entry, then guard again at the actual native dispatch.
    cancelPlaguePriceStageSwitch();
    return JSON.stringify({accepted:true, stageKey:current.stageKey, item:selected});
}

function plaguePriceAutomationBusy() {
    return !!g_bossReturnContext || automationCycleBusy() || sharedGameActionWaiting();
}

function enqueuePlaguePriceStageSwitch(stageNo, expectedStageKey, thresholdCny, priceRowsJson, initializeScan, targetItemIds) {
    stageNo = parseInt(stageNo, 10);
    initializeScan = initializeScan === true && stageNo === 1;
    var target = plagueDropStageInfo(stageNo);
    if (!target) throw new Error('瘟疫目标关卡校验失败：' + stageNo);
    var current = currentAutoBossStage();
    if (!current || current.stageType !== 2 || current.act !== 23 ||
            current.stageNo < 1 || current.stageNo > 20) {
        throw new Error('当前不在瘟疫 1–20 关，已停止自动切关');
    }
    if (expectedStageKey && current.stageKey !== (parseInt(expectedStageKey, 10) || 0)) {
        return JSON.stringify({queued:false, reason:'stage-changed', current:current});
    }
    if (plaguePriceAutomationBusy()) return JSON.stringify({queued:false, reason:'automation-active', current:current});
    if (current.stageNo === stageNo) return JSON.stringify({queued:false, reason:'already-current', current:current});
    if (g_plagueDropSwitchPending) return JSON.stringify({queued:false, reason:'switch-pending', pending:g_plagueDropSwitchPending});
    var priceRows = {};
    try { priceRows = JSON.parse(priceRowsJson || '{}') || {}; } catch (e) {}
    var snapshot = readGameDropPreviewSnapshot(true);
    if (snapshot.available !== true) return JSON.stringify({queued:false, reason:'unresolved-queue'});
    var manualItem = currentPlagueManualWait(snapshot, current.stageKey);
    if (manualItem) return JSON.stringify({queued:false, reason:'high-price', item:manualItem});
    var decision = evaluatePlaguePriceQueue(snapshot, priceRows, thresholdCny, targetItemIds);
    if (!decision.ready) return JSON.stringify({queued:false, reason:decision.reason,
        unresolvedItemIds:decision.unresolvedItemIds || []});
    if (decision.hit) return JSON.stringify({queued:false, reason:'high-price', item:decision.item});
    if (!ensureUpdateHook()) throw new Error('游戏主线程任务队列挂载失败');
    g_plagueDropSwitchPending = {
        mode:initializeScan ? 'price-start' : 'price', stageNo:stageNo, stageKey:target.stage.stageKey,
        expectedStageKey:current.stageKey, thresholdCny:Math.max(0, Number(thresholdCny) || 0),
        targetItemIds:targetItemIds || [],
        priceRows:priceRows, queueSignature:plaguePriceQueueSignature(snapshot), queuedAt:Date.now()
    };
    g_queue.push({action:'plagueDropStageSwitch', mode:g_plagueDropSwitchPending.mode, targetStageNo:stageNo,
        targetStageKey:target.stage.stageKey, expectedStageKey:current.stageKey,
        thresholdCny:g_plagueDropSwitchPending.thresholdCny, priceRows:priceRows,
        targetItemIds:g_plagueDropSwitchPending.targetItemIds,
        queueSignature:g_plagueDropSwitchPending.queueSignature, at:Date.now()});
    return JSON.stringify({queued:true, target:target.stage.stageNo, current:current});
}

function cancelPlaguePriceStageSwitch() {
    if (!g_plagueDropSwitchPending || ['price', 'price-start'].indexOf(g_plagueDropSwitchPending.mode) < 0) return false;
    g_plagueDropSwitchPending = null;
    return true;
}

function enqueuePlagueDropStageSwitch(stageNo, expectedStageKey, targetItemIds, scanLimits) {
    stageNo = parseInt(stageNo, 10);
    var target = plagueDropStageInfo(stageNo);
    if (!target) throw new Error('瘟疫目标关卡校验失败：' + stageNo);
    var current = currentAutoBossStage();
    if (!current || current.stageType !== 2 || current.act !== 23 ||
            current.stageNo < 1 || current.stageNo > 20) {
        throw new Error('当前不在瘟疫 1–20 关，已停止自动切关');
    }
    if (expectedStageKey && current.stageKey !== (parseInt(expectedStageKey, 10) || 0)) {
        throw new Error('当前关卡已变化，取消过期的自动切关请求');
    }
    if (current.stageNo === stageNo) return JSON.stringify({queued:false, reason:'already-current', current:current});
    if (g_plagueDropSwitchPending) return JSON.stringify({queued:false, reason:'switch-pending', pending:g_plagueDropSwitchPending});
    if (!ensureUpdateHook()) throw new Error('游戏主线程任务队列挂载失败');
    var ids = Array.isArray(targetItemIds) ? targetItemIds.map(function (id) { return String(id); }) : [];
    if (!ids.length) throw new Error('没有有效的目标物品编号');
    scanLimits = scanLimits || {};
    var limits = {
        ordinary: Math.max(0, parseInt(scanLimits.ordinary, 10) || 0),
        stage: Math.max(0, parseInt(scanLimits.stage, 10) || 0)
    };
    g_plagueDropSwitchPending = {stageNo:stageNo, stageKey:target.stage.stageKey, expectedStageKey:current.stageKey, targetItemIds:ids, scanLimits:limits, queuedAt:Date.now()};
    g_queue.push({action:'plagueDropStageSwitch', targetStageNo:stageNo, targetStageKey:target.stage.stageKey, expectedStageKey:current.stageKey, targetItemIds:ids, scanLimits:limits, at:Date.now()});
    return JSON.stringify({queued:true, target:target.stage.stageNo, current:current});
}

function processPlagueDropStageSwitch(item) {
    var pending = g_plagueDropSwitchPending;
    if (!pending || pending.stageKey !== item.targetStageKey) return false;
    try {
        var current = currentAutoBossStage();
        if (!current || current.stageKey !== item.expectedStageKey) throw new Error('切关前当前关卡发生变化');
        var target = plagueDropStageInfo(item.targetStageNo);
        if (!target || target.stage.stageKey !== item.targetStageKey) throw new Error('瘟疫目标关卡数据不匹配');
        if ((item.mode === 'price' || item.mode === 'price-start') && plaguePriceAutomationBusy()) {
            emit('plague_price_monitor_waiting', {reason:'automation-active', targetStageNo:item.targetStageNo});
            return false;
        }
        var snapshot = readGameDropPreviewSnapshot(item.mode === 'price' || item.mode === 'price-start');
        if (!snapshot || snapshot.available !== true) {
            g_plagueDropSwitchLastResult = '游戏掉落队列暂不可读，保留当前关卡';
            emit('plague_drop_monitor_waiting', {reason:'drop-queue-unavailable', targetStageNo:item.targetStageNo});
            return false;
        }
        var manualItem = currentPlagueManualWait(snapshot, current.stageKey);
        if (manualItem) {
            emit('plague_price_monitor_high_value', {targetStageNo:current.stageNo, item:manualItem});
            return false;
        }
        if (item.mode === 'price' || item.mode === 'price-start') {
            if (plaguePriceAutomationBusy()) {
                emit('plague_price_monitor_waiting', {
                    reason:'automation-active', targetStageNo:item.targetStageNo
                });
                return false;
            }
            var priceDecision = evaluatePlaguePriceQueue(snapshot, item.priceRows, item.thresholdCny, item.targetItemIds);
            if (!priceDecision.ready) {
                emit('plague_price_monitor_waiting', {
                    reason:priceDecision.reason, targetStageNo:item.targetStageNo,
                    unresolvedItemCount:(priceDecision.unresolvedItemIds || []).length
                });
                return false;
            }
            if (priceDecision.hit) {
                emit('plague_price_monitor_high_value', {
                    targetStageNo:current.stageNo, item:priceDecision.item,
                    thresholdCny:item.thresholdCny
                });
                return false;
            }
            if (plaguePriceQueueSignature(snapshot) !== item.queueSignature) {
                emit('plague_price_monitor_waiting', {
                    reason:'queue-changed', targetStageNo:item.targetStageNo
                });
                return false;
            }
        }
        var targetIds = item.mode === 'price' || item.mode === 'price-start' ? [] : item.targetItemIds || [];
        var targetSet = {};
        targetIds.forEach(function (id) { targetSet[String(id)] = true; });
        var found = false;
        var unresolvedCount = 0;
        var laneCounts = {ordinary:0, stage:0};
        var scanLimits = item.scanLimits || {ordinary:0, stage:0};
        (snapshot.queues || []).forEach(function (group) {
            (group.items || []).forEach(function (reward) {
                var itemLane = plagueDropMonitorLane(group.boxType, reward.boxItemId);
                laneCounts[itemLane]++;
                var itemLimit = Math.max(0, parseInt(scanLimits[itemLane], 10) || 0);
                if (itemLimit > 0 && laneCounts[itemLane] > itemLimit) return;
                if ((parseInt(reward.rewardItemId, 10) || 0) <= 0) unresolvedCount++;
                if (targetSet[String(reward.rewardItemId || '')]) found = true;
            });
        });
        if (unresolvedCount > 0) {
            g_plagueDropSwitchLastResult = '检查范围内存在未知掉落项，保留当前关卡';
            emit('plague_drop_monitor_waiting', {reason:'unresolved-reward', unresolvedBoxCount:unresolvedCount, targetStageNo:item.targetStageNo});
            return false;
        }
        if (found) {
            g_plagueDropSwitchLastResult = '发现目标物品，保留当前关卡';
            emit('plague_drop_monitor_target_found', {targetStageNo:current.stageNo});
            return false;
        }
        var validation = target.bridge.validatePlague.fn(target.cache, target.bridge.validatePlague.mi) | 0;
        if (validation === 7) {
            g_plagueDropSwitchLastResult = '游戏原生瘟疫切关冷却中';
            emit('plague_drop_monitor_waiting', {reason:'native-cooldown', validation:validation, targetStageNo:item.targetStageNo});
            return false;
        }
        if (validation !== 0) throw new Error('游戏关卡条件未通过，返回码=' + validation);
        prepareNativePlagueReturn(target.stage);
        recordMapSwitchDispatch();
        g_bossReturnDispatching = true;
        try { target.bridge.returnScene.fn(target.stage.stageKey, 1, target.bridge.returnScene.mi); }
        finally { g_bossReturnDispatching = false; }
        g_plagueDropSwitchLastResult = '已提交瘟疫 ' + item.targetStageNo + ' 关切换';
        emit('plague_drop_monitor_switched', {targetStageNo:item.targetStageNo, targetStageKey:item.targetStageKey, previousStageKey:current.stageKey, submittedAt:Date.now()});
        return true;
    } finally {
        g_plagueDropSwitchPending = null;
    }
}

function currentStageIsBossOrPumpkin(stage) {
    if (!stage) return false;
    // Every difficulty's 3-10 is a boss stage, including the polluted command
    // room variant. Use the actual act/stage identity instead of assuming a
    // particular stageType enum; Pumpkin Valley is a separate event stage.
    return (stage.act === 3 && stage.stageNo === 10) || stage.stageType === 4;
}

function autoPlagueTicketHasPriority(rows) {
    rows = rows || scanInventory();
    if (g_autoBossEnabled) {
        var stones = bossInventorySnapshot(rows).stoneCounts;
        if (selectAutoBossTarget(stones)) return true;
    }
    if (g_autoHalloweenEventEnabled && selectEventDungeonTicket(eventDungeonTicketCounts(rows))) return true;
    return false;
}

var g_autoPlagueUiRoute = null;
var g_plagueUiBridge = null;
var g_plagueUiClassCache = {};
function plagueUiFindClass(ns,name) {
    var key=ns+'.'+name;
    if(g_plagueUiClassCache[key]) return g_plagueUiClassCache[key];
    var images=allImages();
    for(var i=0;i<images.length;i++) {
        var owner=il2cpp.classFromName(images[i].image,Memory.allocUtf8String(ns),Memory.allocUtf8String(name));
        if(!isBadPtr(owner)) {g_plagueUiClassCache[key]=owner;return owner;}
    }
    return ptr(0);
}
function plagueUiMethod(ns, ownerName, name, resultType, parameterTypes, abiResult, abiParameters) {
    var owner = plagueUiFindClass(ns, ownerName);
    if (isBadPtr(owner)) throw new Error(ownerName + ' 类型未加载');
    var iter = Memory.alloc(PTR), matches = [];
    iter.writePointer(ptr(0));
    while (true) {
        var mi = il2cpp.classGetMethods(owner, iter);
        if (isBadPtr(mi)) break;
        if (cstr(il2cpp.methodGetName(mi)) !== name ||
                il2cpp.methodGetParamCount(mi) !== parameterTypes.length) continue;
        if (resultType && cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(mi))) !== resultType) continue;
        if (!parameterTypes.every(function (type, index) {
            return cstr(il2cpp.typeGetName(il2cpp.methodGetParam(mi, index))) === type;
        })) continue;
        matches.push(mi);
    }
    if (matches.length !== 1) throw new Error(ownerName + '.' + name + ' 签名匹配数=' + matches.length);
    var method = matches[0], fp = methodPtr(method);
    if (isBadPtr(fp)) throw new Error(ownerName + '.' + name + ' 原生入口为空');
    return {mi:method, ptr:fp,
        fn:new NativeFunction(fp, abiResult, ['pointer'].concat(abiParameters || [], ['pointer']))};
}
function plagueUiInvoke(method, receiver, args) {
    if (isBadPtr(receiver)) throw new Error('游戏界面对象为空');
    var values=(args||[]).map(function(value){return typeof value==='boolean'?(value?1:0):value;});
    return method.fn.apply(null, [receiver].concat(values, [method.mi]));
}
function resolvePlagueUiBridge() {
    if (g_plagueUiBridge) return g_plagueUiBridge;
    var bridge = {};
    bridge.gameObject = plagueUiMethod('UnityEngine','Component','get_gameObject','UnityEngine.GameObject',[],'pointer',[]);
    bridge.activeSelf = plagueUiMethod('UnityEngine','GameObject','get_activeSelf','System.Boolean',[],'bool',[]);
    bridge.eventInvoke = plagueUiMethod('UnityEngine.Events','UnityEvent','Invoke','System.Void',[],'void',[]);
    bridge.sliderValue = plagueUiMethod('UnityEngine.UI','Slider','get_value','System.Single',[],'float',[]);
    bridge.text = plagueUiMethod('TMPro','TMP_Text','get_text','System.String',[],'pointer',[]);
    bridge.dropdownValue = plagueUiMethod('TMPro','TMP_Dropdown','set_value','System.Void',['System.Int32'],'void',['int']);
    bridge.interactable = plagueUiMethod('UnityEngine.UI','Selectable','get_interactable','System.Boolean',[],'bool',[]);
    bridge.getComponent = plagueUiMethod('UnityEngine','GameObject','GetComponent','UnityEngine.Component',['System.Type'],'pointer',['pointer']);
    bridge.addComponent = plagueUiMethod('UnityEngine','GameObject','AddComponent','UnityEngine.Component',['System.Type'],'pointer',['pointer']);
    bridge.canvasGroupClass = plagueUiFindClass('UnityEngine','CanvasGroup');
    if (isBadPtr(bridge.canvasGroupClass)) throw new Error('CanvasGroup 类型未加载');
    [['alpha','System.Single','float'],['interactable','System.Boolean','bool'],
        ['blocksRaycasts','System.Boolean','bool']].forEach(function (entry) {
        bridge['get_'+entry[0]] = plagueUiMethod('UnityEngine','CanvasGroup','get_'+entry[0],entry[1],[],entry[2],[]);
        bridge['set_'+entry[0]] = plagueUiMethod('UnityEngine','CanvasGroup','set_'+entry[0],'System.Void',[entry[1]],'void',[entry[2]]);
    });
    g_plagueUiBridge = bridge;
    return bridge;
}
function plagueUiObjectField(object, name, required) {
    if (isBadPtr(object)) {if (required) throw new Error(name+' 所属界面未加载'); return ptr(0);}
    var field = findRuntimeFieldInfo(il2cpp.objectGetClass(object), name);
    if (!field) {if (required) throw new Error('游戏界面字段缺失：'+name); return ptr(0);}
    var value = object.add(field.offset).readPointer();
    if (required && isBadPtr(value)) throw new Error('游戏界面字段为空：'+name);
    return value;
}
function plagueUiGameObject(component) {return plagueUiInvoke(resolvePlagueUiBridge().gameObject, component);}
function plagueUiActive(gameObject) {
    return !isBadPtr(gameObject) && !!plagueUiInvoke(resolvePlagueUiBridge().activeSelf, gameObject);
}
function plagueUiClick(button, label) {
    var bridge = resolvePlagueUiBridge();
    for (var depth=0;depth<5;depth++) {
        if (isBadPtr(button)) break;
        var clickField = findRuntimeFieldInfo(il2cpp.objectGetClass(button), 'm_OnClick');
        if (clickField) {
            var event = button.add(clickField.offset).readPointer();
            if (isBadPtr(event)) throw new Error(label+' 点击事件尚未初始化');
            plagueUiInvoke(bridge.eventInvoke, event);
            return;
        }
        var next = plagueUiObjectField(button, 'toggleButton', false);
        if (isBadPtr(next)) next=plagueUiObjectField(button, 'button', false);
        button=next;
    }
    throw new Error(label+' 未绑定 Unity Button');
}
function plagueUiView() {
    var managerInfo=classInfo('TaskbarHero','UIManager');
    var manager=findStaticSingleton(managerInfo.klass,'TaskbarHero.UIManager');
    if(isBadPtr(manager)) throw new Error('UIManager 尚未初始化');
    var portal=plagueUiObjectField(manager,'Ui_Portal',true);
    return {manager:manager,portal:portal,portalObject:plagueUiGameObject(portal),
        plague:plagueUiObjectField(portal,'plaguelandsUI',true)};
}
function maskPlagueUi(context, view) {
    if (context.mask || !context.openedByHelper) return;
    var bridge=resolvePlagueUiBridge();
    var type=il2cpp.typeGetObject(il2cpp.classGetType(bridge.canvasGroupClass));
    var group=plagueUiInvoke(bridge.getComponent,view.portalObject,[type]);
    if(isBadPtr(group)) group=plagueUiInvoke(bridge.addComponent,view.portalObject,[type]);
    if(isBadPtr(group)) throw new Error('后台传送门 CanvasGroup 创建失败');
    context.mask={group:group,alpha:plagueUiInvoke(bridge.get_alpha,group),
        interactable:plagueUiInvoke(bridge.get_interactable,group),
        blocksRaycasts:plagueUiInvoke(bridge.get_blocksRaycasts,group)};
    plagueUiInvoke(bridge.set_alpha,group,[0]);
    plagueUiInvoke(bridge.set_interactable,group,[false]);
    plagueUiInvoke(bridge.set_blocksRaycasts,group,[false]);
}
function restorePlagueUiMask(context) {
    if (!context || !context.mask) return;
    var bridge=resolvePlagueUiBridge(), mask=context.mask;
    try {
        plagueUiInvoke(bridge.set_alpha,mask.group,[mask.alpha]);
        plagueUiInvoke(bridge.set_interactable,mask.group,[mask.interactable]);
        plagueUiInvoke(bridge.set_blocksRaycasts,mask.group,[mask.blocksRaycasts]);
    } finally {context.mask=null;}
}
function queuePlagueUiStep(context, phase, delayMs) {
    context.phase=phase;
    g_queue.push({action:'autoPlagueUiRoute',context:context,phase:phase,
        at:Date.now(),deferUntil:Date.now()+Math.max(0,delayMs||0)});
}
function completePlagueUiRoute(context) {
    if(context.openedByHelper) {
        try {
            if(plagueUiActive(plagueUiView().portalObject)) {
                if((context.closeAttempts||0)<2) {closePlagueUiRoute(context);return;}
                context.failureReason=(context.failureReason?context.failureReason+'；':'')+'游戏传送门未确认收起';
            }
        } catch(error) {context.failureReason=(context.failureReason||'')+'；地图收尾复查失败：'+chineseError(error);}
    }
    try {restorePlagueUiMask(context);} catch(error){channelLog('自动地图','传送门显示状态恢复失败：'+chineseError(error));}
    if (g_autoPlagueUiRoute === context) g_autoPlagueUiRoute=null;
    g_autoPlagueSwitchQueued=false;
    g_autoPlagueNextCheckAt=Date.now()+g_autoPlagueCheckIntervalMs;
    g_autoPlagueLastResult=context.failureReason || ('已确认进入瘟疫 '+context.targetStageNo+' 层');
    channelLog('自动地图',g_autoPlagueLastResult+'。');
    emit(context.failureReason?'auto_plague_map_switch_failed':'auto_plague_map_confirmed',{
        manual:context.manual===true,difficulty:context.difficulty,stageNo:context.targetStageNo,
        stageKey:context.targetStageKey,previousStageKey:context.expectedStageKey,
        reason:context.failureReason||'',route:'Unity UI events / StageNode.button_Enter',observedAt:Date.now()});
}
function closePlagueUiRoute(context) {
    if (!context) return;
    context.closeAttempts=(context.closeAttempts||0)+1;
    try {
        var view=plagueUiView();
        if(context.openedByHelper && plagueUiActive(view.portalObject))
            plagueUiClick(plagueUiObjectField(view.portal,'button_Close',true),'传送门关闭');
    } catch(error) {
        context.failureReason=(context.failureReason?context.failureReason+'；':'')+'传送门收尾失败：'+chineseError(error);
    }
    queuePlagueUiStep(context,'finalize',500);
}
function failPlagueUiRoute(context, error) {
    context=context||g_autoPlagueUiRoute;
    if(!context) return;
    context.failureReason='瘟疫界面跳转失败（'+context.phase+'）：'+chineseError(error);
    context.failureStack=String(error&&error.stack||'');
    closePlagueUiRoute(context);
}
function cancelPlagueUiRoute(reason) {
    var context=g_autoPlagueUiRoute;
    if(!context) return;
    context.failureReason=reason||'地图操作已取消';
    queuePlagueUiStep(context,'close',0);
    ensureUpdateHook();
}
function processPlagueUiRoute(item) {
    var context=item.context;
    if(!context || (g_autoPlagueUiRoute!==context && item.phase!=='finalize')) return;
    if(item.phase==='finalize') {completePlagueUiRoute(context);return;}
    if(item.phase==='close') {closePlagueUiRoute(context);return;}
    if(Date.now()>context.deadlineAt) throw new Error('游戏界面路由等待超时');
    var bridge=resolvePlagueUiBridge(), view=plagueUiView(), portalInfo=classInfo('TaskbarHero.UI','UI_Portal');
    var plagueInfo=classInfo('TaskbarHero.UI','UI_Plaguelands');
    if(item.phase==='open') {
        context.openedByHelper=!plagueUiActive(view.portalObject);
        maskPlagueUi(context,view);
        if(context.openedByHelper) {
            var main=plagueUiObjectField(view.manager,'ui_main',true);
            plagueUiClick(plagueUiObjectField(main,'button_Portal',true),'传送门');
        }
        queuePlagueUiStep(context,'prepare',500);return;
    }
    var guard=plagueUiObjectField(view.portal,'m_abuseGuardPopup',false);
    if(plagueUiActive(guard)) throw new Error('游戏传送频率限制正在生效，请按游戏提示等待');
    if(!plagueUiActive(view.portalObject)) throw new Error('游戏传送门控制器未打开');
    if(item.phase==='prepare') {
        var currentDifficulty=view.portal.add(portalInfo.fields.m_currentStageDifficulty).readS32();
        if(currentDifficulty!==context.difficulty) {
            var choices=readIntListOrArray(view.portal.add(portalInfo.fields.bktk).readPointer(),16);
            var index=choices.indexOf(context.difficulty);
            if(index<0) throw new Error('目标难度不在游戏已解锁列表中');
            plagueUiInvoke(bridge.dropdownValue,plagueUiObjectField(view.portal,'stagetDiff_dropDown',true),[index]);
            if(context.difficultyAttempts++>=2) throw new Error('游戏难度下拉框未确认选择');
            queuePlagueUiStep(context,'prepare',400);return;
        }
        var elements=plagueUiObjectField(view.portal,'plaguelandsElements',true);
        if(!plagueUiActive(elements)) {
            var tabsField=Object.keys(portalInfo.fieldTypes).filter(function(name){
                return portalInfo.fieldTypes[name]==='System.Collections.Generic.Dictionary<System.Int32,ActSlot>';})[0];
            if(!tabsField) throw new Error('传送门页签字典缺失');
            var tabs=intPointerDictionaryRows(view.portal.add(portalInfo.fields[tabsField]).readPointer(),100);
            var tab=tabs.filter(function(row){return row.key===23;})[0];
            if(!tab || isBadPtr(tab.value)) throw new Error('瘟疫之地页签尚未解锁或生成');
            var tabButton=plagueUiObjectField(tab.value,'btn',false);
            if(isBadPtr(tabButton)) tabButton=plagueUiObjectField(tab.value,'button_toggle',true);
            plagueUiClick(tabButton,'瘟疫之地页签');
            if(context.tabAttempts++>=2) throw new Error('瘟疫之地页签未确认打开');
            queuePlagueUiStep(context,'prepare',400);return;
        }
        queuePlagueUiStep(context,'level',200);return;
    }
    if(item.phase==='level') {
        var levelText=il2cppString(plagueUiInvoke(bridge.text,
            plagueUiObjectField(view.plague,'intensityText',true))).replace(/<[^>]*>/g,'').trim();
        var level=/^\d{1,2}$/.test(levelText)?parseInt(levelText,10):-1;
        if(level<1||level>20) throw new Error('游戏瘟疫强度读数超出范围：'+level);
        if(level!==context.targetStageNo) {
            if(context.levelAttempts++>=24) throw new Error('游戏瘟疫强度调整未完成');
            plagueUiClick(plagueUiObjectField(view.plague,level<context.targetStageNo?'add':'sub',true),'瘟疫强度箭头');
            queuePlagueUiStep(context,'level',350);return;
        }
        var node=plagueUiObjectField(view.plague,'bksa',true);
        var stage=readAutoBossStageInfo(plagueUiObjectField(node,'bgoq',true));
        if(!stage || stage.stageKey!==context.targetStageKey) throw new Error('游戏瘟疫节点与目标地图不一致');
        queuePlagueUiStep(context,'enter',300);return;
    }
    if(item.phase==='enter') {
        var actual=currentAutoPlagueStage();
        if(actual && currentStageIsBossOrPumpkin(actual)) throw new Error('当前进入了 Boss 或南瓜灯峡谷，已保护当前挑战');
        if(fridaCurrentCombatState()===true) {queuePlagueUiStep(context,'enter',500);return;}
        var node=plagueUiObjectField(view.plague,'bksa',true);
        var stage=readAutoBossStageInfo(plagueUiObjectField(node,'bgoq',true));
        if(!stage || stage.stageKey!==context.targetStageKey) throw new Error('提交前瘟疫节点已变化');
        var button=plagueUiObjectField(node,'button_Enter',true);
        if(!plagueUiInvoke(bridge.interactable,button)) throw new Error('游戏目标地图当前不可点击，请检查污染度、宝箱空间和入场冷却');
        recordMapSwitchDispatch();
        plagueUiClick(button,'瘟疫地图进入');
        context.submittedAt=Date.now();context.deadlineAt=Date.now()+45000;
        g_autoPlagueLastResult='已触发游戏地图节点，等待实际场景确认';
        queuePlagueUiStep(context,'verify',500);return;
    }
    if(item.phase==='verify') {
        var observed=activeStageManagerStageInfo();
        if(observed && observed.stageKey===context.targetStageKey) {
            context.confirmedStage=observed;
            closePlagueUiRoute(context);return;
        }
        queuePlagueUiStep(context,'verify',500);return;
    }
    throw new Error('未知地图路由阶段：'+item.phase);
}

function enqueueAutoPlagueMapSwitch(current, target, retryCount, manual) {
    if (g_autoPlagueSwitchQueued || !ensureUpdateHook()) return false;
    g_autoPlagueSwitchQueued = true;
    g_queue.push({action:'autoPlagueStageSwitch', difficulty:g_autoPlagueDifficulty,
        targetStageNo:g_autoPlagueStageNo, targetStageKey:target.stage.stageKey,
        expectedStageKey:current.stageKey, retryCount:Number(retryCount) || 0,
        manual:manual === true, at:Date.now()});
    g_autoPlagueLastResult = (manual ? '手动测试已加入地图切换队列：瘟疫 ' :
        '已加入地图切换队列：瘟疫 ') + g_autoPlagueStageNo + ' 层';
    return true;
}

function requestManualAutoPlagueSwitch() {
    requireCurrentGameBuild();
    if (g_autoPlagueUiRoute || g_autoPlagueSwitchQueued || g_autoPlagueAwaitingStage)
        return JSON.stringify({status:'BUSY', message:'已有瘟疫地图切换正在执行'});
    var phase = '读取当前实际地图';
    try {
        var current = currentAutoPlagueStage();
        if (!current) throw new Error('当前实际地图尚未就绪' +
            (g_autoPlagueCurrentStageReadError ? '：' + g_autoPlagueCurrentStageReadError : ''));
        if (currentStageIsBossOrPumpkin(current) || g_bossReturnContext || g_eventDungeonContext)
            return JSON.stringify({status:'BLOCKED', reason:'当前处于 Boss 或南瓜灯峡谷，保护优先级阻止手动跳转', current:current});
        if (mapSwitchMutationBusy() || boxInventoryMutationActive() || synthesisInventoryMutationActive())
            return JSON.stringify({status:'BLOCKED', reason:'有其他地图或物品操作正在执行'});
        phase = '检查门票优先级';
        if (autoPlagueTicketHasPriority(scanInventory()))
            return JSON.stringify({status:'BLOCKED', reason:'门票挑战优先级高于瘟疫地图跳转'});
        phase = '读取目标关卡';
        var target = resolveAutoPlagueTargetStage(g_autoPlagueDifficulty, g_autoPlagueStageNo);
        if (!target) throw new Error('目标瘟疫难度/层数的游戏缓存不可用');
        if (current.stageKey === target.stage.stageKey)
            return JSON.stringify({status:'ALREADY_HERE', current:current,
                target:target.stage, message:'当前已在设定瘟疫地图'});
        phase = '检查游戏进入条件';
        var plagueValidation = target.bridge.validatePlague.fn(
            target.cache, target.bridge.validatePlague.mi) | 0;
        if (plagueValidation !== 0)
            return JSON.stringify({status:'BLOCKED', reason:'瘟疫切换校验未通过',
                validation:plagueValidation, current:current, target:target.stage});
        var safeAt = Math.max(g_lastServerRequestAt + g_serverRequestSpacingMs,
            g_lastMapSwitchAt + g_mapSwitchMinimumIntervalMs);
        if (Date.now() < safeAt)
            return JSON.stringify({status:'WAIT', reason:'地图操作安全间隔尚未结束',
                waitMs:safeAt-Date.now(), current:current, target:target.stage});
        if (!enqueueAutoPlagueMapSwitch(current, target, 0, true))
            return JSON.stringify({status:'FAILED', reason:'无法将手动地图请求加入游戏主线程队列'});
        return JSON.stringify({status:'QUEUED', pid:Process.id, current:current,
            target:target.stage, message:g_autoPlagueLastResult,
            route:'无插件：游戏 Unity 页签、强度箭头与 StageNode 按钮事件'});
    } catch (error) {
        g_autoPlagueLastPassPhase = phase;
        g_autoPlagueLastResult = '手动瘟疫跳转失败（' + phase + '）：' + chineseError(error);
        return JSON.stringify({status:'FAILED', pid:Process.id, phase:phase,
            error:chineseError(error), currentStageReadError:g_autoPlagueCurrentStageReadError});
    }
}

function enqueueAutoPlaguePortalClose(stageKey, manual) {
    if (g_autoPlaguePortalCloseQueued || !ensureUpdateHook()) return false;
    g_autoPlaguePortalCloseQueued = true;
    g_queue.push({action:'autoPlaguePortalClose', expectedStageKey:Number(stageKey) || 0,
        manual:manual === true, at:Date.now()});
    g_autoPlagueLastResult = '传送门页面仍打开，正在关闭后重新读取当前地图';
    return true;
}

function findRuntimeFieldInfo(runtimeClass, fieldName) {
    var current = runtimeClass;
    for (var depth = 0; depth < 12 && !isBadPtr(current); depth++) {
        var info = runtimeClassFields(current);
        if (info.fieldInfos[fieldName]) {
            var field = info.fieldInfos[fieldName];
            return {field:field, offset:info.fields[fieldName],
                typeName:cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)))};
        }
        current = il2cpp.classGetParent(current);
    }
    return null;
}

function processAutoPlaguePortalClose(item) {
    if (!item || (!g_autoPlagueMapEnabled && item.manual !== true)) {
        g_autoPlaguePortalCloseQueued = false;
        return false;
    }
    var current = currentAutoPlagueStage();
    if (!current || current.stageKey !== Number(item.expectedStageKey || 0)) {
        g_autoPlaguePortalCloseQueued = false;
        g_autoPlaguePortalCloseHandledStageKey = 0;
        g_autoPlagueNextCheckAt = 0;
        return false;
    }
    var state = autoPlaguePortalUiDiagnostics();
    if (!state.available || state.portalVisible !== true) {
        g_autoPlaguePortalCloseQueued = false;
        g_autoPlaguePortalCloseHandledStageKey = current.stageKey;
        g_autoPlagueNextCheckAt = 0;
        return false;
    }
    var managerInfo = classInfo('TaskbarHero', 'UIManager');
    var manager = findStaticSingleton(managerInfo.klass, 'TaskbarHero.UIManager');
    if (isBadPtr(manager) || managerInfo.fields.Ui_Portal == null)
        throw new Error('传送门界面管理器字段缺失');
    var portal = manager.add(managerInfo.fields.Ui_Portal).readPointer();
    if (isBadPtr(portal) || managedType(portal) !== 'TaskbarHero.UI.UI_Portal')
        throw new Error('当前传送门界面实例无效');
    var buttonField = findRuntimeFieldInfo(il2cpp.objectGetClass(portal), 'button_Close');
    if (!buttonField || buttonField.typeName !== 'UnityEngine.UI.Button')
        throw new Error('未找到已验证的传送门 button_Close 按钮');
    var button = portal.add(buttonField.offset).readPointer();
    if (isBadPtr(button)) throw new Error('传送门关闭按钮对象为空');
    var bridge = resolveCurrentTradeBridge();
    var buttonObject = bridge.componentGameObject.fn(button, bridge.componentGameObject.mi);
    if (isBadPtr(buttonObject) || !bridge.gameObjectActiveInHierarchy.fn(
            buttonObject, bridge.gameObjectActiveInHierarchy.mi))
        throw new Error('传送门关闭按钮当前不可用');
    bridge.buttonPress.fn(button, bridge.buttonPress.mi);
    g_autoPlaguePortalCloseAttempts++;
    item.deferUntil = Date.now() + 500;
    g_queue.push({action:'autoPlaguePortalCloseVerify', expectedStageKey:current.stageKey,
        manual:item.manual === true,
        attempts:g_autoPlaguePortalCloseAttempts, at:Date.now(), deferUntil:item.deferUntil});
    channelLog('自动地图', '已通过游戏原生传送门关闭按钮收起地图页；正在复读当前关卡。');
    return true;
}

function processAutoPlaguePortalCloseVerify(item) {
    if (!item || (!g_autoPlagueMapEnabled && item.manual !== true)) {
        g_autoPlaguePortalCloseQueued = false;
        return false;
    }
    var state = autoPlaguePortalUiDiagnostics();
    if (state.available && state.portalVisible === false) {
        g_autoPlaguePortalCloseQueued = false;
        g_autoPlaguePortalCloseHandledStageKey = Number(item.expectedStageKey) || 0;
        g_autoPlaguePortalCloseAttempts = 0;
        g_autoPlagueNextCheckAt = 0;
        g_autoPlagueLastResult = '传送门页面已关闭，准备按实际关卡重新检测地图';
        channelLog('自动地图', g_autoPlagueLastResult + '。');
        return true;
    }
    if ((Number(item.attempts) || 0) >= 3)
        throw new Error('调用 button_Close 后传送门仍处于打开状态');
    g_autoPlaguePortalCloseAttempts = (Number(item.attempts) || 0) + 1;
    g_autoPlaguePortalCloseQueued = false;
    if (!enqueueAutoPlaguePortalClose(item.expectedStageKey, item.manual === true))
        throw new Error('传送门关闭重试未能进入游戏主线程队列');
    return false;
}

function scheduleManualAutoPlagueConfirmation(delayMs) {
    if (g_autoPlagueManualConfirmTimer) clearTimeout(g_autoPlagueManualConfirmTimer);
    if (!g_autoPlagueAwaitingStage || g_autoPlagueAwaitingStage.manual !== true) {
        g_autoPlagueManualConfirmTimer = null;
        return;
    }
    g_autoPlagueManualConfirmTimer = setTimeout(function () {
        g_autoPlagueManualConfirmTimer = null;
        if (!g_autoPlagueAwaitingStage || g_autoPlagueAwaitingStage.manual !== true) return;
        try { runAutoPlagueMapPass(); }
        catch (error) {
            g_autoPlagueLastResult = '手动地图确认读取失败：' + chineseError(error);
        }
        if (g_autoPlagueAwaitingStage && g_autoPlagueAwaitingStage.manual === true)
            scheduleManualAutoPlagueConfirmation(1000);
    }, Math.max(250, Number(delayMs) || 1000));
}

function runAutoPlagueMapPass() {
    if(g_autoPlagueUiRoute) return false;
    var manualAwaiting = !!(g_autoPlagueAwaitingStage && g_autoPlagueAwaitingStage.manual === true);
    if (!g_running && !manualAwaiting) return false;
    if (!g_autoPlagueMapEnabled && !manualAwaiting) {
        var disabledReason = '地图页的自动瘟疫跳转开关已关闭';
        if (g_autoPlagueLastResult !== disabledReason) {
            g_autoPlagueLastResult = disabledReason;
            channelLog('自动地图', disabledReason + '，本轮不会请求传送门或切换地图。');
        }
        return false;
    }
    g_autoPlaguePassCount++;
    var now = Date.now();
    if (g_autoPlaguePortalCloseQueued) return false;
    if (g_autoPlagueAwaitingStage) {
        var awaiting = g_autoPlagueAwaitingStage;
        var observed = null;
        try { observed = currentAutoPlagueStage(); } catch (stageError) {}
        if (observed) {
            if (g_autoPlaguePortalCloseHandledStageKey &&
                    g_autoPlaguePortalCloseHandledStageKey !== observed.stageKey) {
                g_autoPlaguePortalCloseHandledStageKey = 0;
                g_autoPlaguePortalCloseAttempts = 0;
            }
        }
        if (observed && observed.stageKey === awaiting.targetStageKey) {
            g_autoPlagueAwaitingStage = null;
            g_autoPlagueLastResult = '已确认进入瘟疫 ' + awaiting.stageNo + ' 层';
            channelLog('自动地图', g_autoPlagueLastResult + '。');
            emit('auto_plague_map_confirmed', {difficulty:awaiting.difficulty,
                stageNo:awaiting.stageNo, stageKey:awaiting.targetStageKey,
                previousStageKey:awaiting.expectedStageKey, observedAt:now});
            var enteredPortal = autoPlaguePortalUiDiagnostics();
            if (enteredPortal.available && enteredPortal.portalVisible === true &&
                    g_autoPlaguePortalCloseHandledStageKey !== observed.stageKey)
                enqueueAutoPlaguePortalClose(observed.stageKey, awaiting.manual === true);
            return true;
        }
        if (observed && observed.stageKey === awaiting.expectedStageKey &&
                Number(awaiting.retryAt || 0) > 0 && now >= awaiting.retryAt &&
                Number(awaiting.retryCount || 0) < 1) {
            var retryPortal = autoPlaguePortalUiDiagnostics();
            if (retryPortal.available && retryPortal.portalVisible === true) {
                var retryTarget = resolveAutoPlagueTargetStage(awaiting.difficulty, awaiting.stageNo);
                g_autoPlagueAwaitingStage = null;
                if (retryTarget && retryTarget.stage.stageKey === awaiting.targetStageKey &&
                        enqueueAutoPlagueMapSwitch(observed, retryTarget, 1, awaiting.manual === true)) {
                    g_autoPlagueLastResult = '实际关卡仍未变化，正在重试一次瘟疫进入请求';
                    channelLog('自动地图', g_autoPlagueLastResult + '。');
                    return false;
                }
                g_autoPlagueAwaitingStage = awaiting;
            }
        }
        if (now >= awaiting.deadlineAt) {
            g_autoPlagueAwaitingStage = null;
            g_autoPlagueLastResult = '地图请求未获游戏确认：仍在关卡 ' +
                (observed ? observed.stageKey : '未知');
            channelLog('自动地图', g_autoPlagueLastResult + '。');
            emit('auto_plague_map_failed', {difficulty:awaiting.difficulty,
                stageNo:awaiting.stageNo, targetStageKey:awaiting.targetStageKey,
                expectedStageKey:awaiting.expectedStageKey,
                observedStageKey:observed && observed.stageKey || 0,
                entryValidation:awaiting.entryValidation, observedAt:now});
            return false;
        }
        return false;
    }
    if (g_autoPlagueSwitchQueued) return false;
    if (now < g_autoPlagueNextCheckAt) return false;
    g_autoPlagueNextCheckAt = now + g_autoPlagueCheckIntervalMs;
    var phase = '读取当前实际关卡';
    try {
        var current = currentAutoPlagueStage();
        if (!current) {
            g_autoPlagueLastResult = '等待当前实际关卡就绪' +
                (g_autoPlagueCurrentStageReadError ? '：' + g_autoPlagueCurrentStageReadError : '');
            return false;
        }
        if (g_autoPlaguePortalCloseHandledStageKey &&
                g_autoPlaguePortalCloseHandledStageKey !== current.stageKey) {
            g_autoPlaguePortalCloseHandledStageKey = 0;
            g_autoPlaguePortalCloseAttempts = 0;
        }
        if (currentStageIsBossOrPumpkin(current)) {
            g_autoPlagueLastResult = '当前位于 Boss 或南瓜灯峡谷，暂停瘟疫地图切换';
            return false;
        }
        if (g_bossReturnContext || g_eventDungeonContext || g_bossStageQueued ||
                g_eventEntryQueued || mapSwitchMutationBusy() ||
                boxInventoryMutationActive() || synthesisInventoryMutationActive()) {
            g_autoPlagueLastResult = '等待门票挑战或游戏操作完成';
            return false;
        }
        phase = '读取挑战门票';
        var rows = scanInventory();
        if (autoPlagueTicketHasPriority(rows)) {
            g_autoPlagueLastResult = '检测到达到门槛的挑战门票，优先执行门票挑战';
            return false;
        }
        phase = '读取目标瘟疫缓存';
        var target = resolveAutoPlagueTargetStage(g_autoPlagueDifficulty, g_autoPlagueStageNo);
        if (!target) {
            g_autoPlagueLastResult = '目标瘟疫难度/层数的游戏关卡缓存不可用';
            return false;
        }
        if (current.stageKey === target.stage.stageKey) {
            g_autoPlagueLastResult = '已在设定的瘟疫地图';
            return false;
        }
        phase = '检查游戏战斗状态';
        if (fridaCurrentCombatState() === true) {
            g_autoPlagueLastResult = '当前正在战斗，延后地图切换';
            g_autoPlagueNextCheckAt=now+1000;
            return false;
        }
        phase = '校验瘟疫进入冷却';
        var validation = target.bridge.validatePlague.fn(target.cache, target.bridge.validatePlague.mi) | 0;
        if (validation === 7) {
            g_autoPlagueLastResult = '目标瘟疫地图仍在游戏冷却';
            return false;
        }
        if (validation !== 0) {
            g_autoPlagueLastResult = '目标瘟疫地图暂不可进入，返回码=' + validation;
            return false;
        }
        return enqueueAutoPlagueMapSwitch(current, target);
    } catch (error) {
        g_autoPlagueLastPassPhase = phase;
        g_autoPlagueLastResult = '瘟疫地图检测失败（' + phase + '）：' + chineseError(error);
        if (now - (g_autoPlagueLastErrorAt || 0) > 60000) {
            g_autoPlagueLastErrorAt = now;
            channelLog('自动地图', g_autoPlagueLastResult + '。');
        }
        return false;
    }
}

function processAutoPlagueStageSwitch(item) {
    g_autoPlagueSwitchQueued = false;
    if (!item || (!g_autoPlagueMapEnabled && item.manual !== true)) return false;
    if (mapSwitchMutationBusy()) {
        g_autoPlagueSwitchQueued = true;
        item.deferUntil = Date.now() + 1000;
        g_queue.push(item);
        return false;
    }
    var current = currentAutoPlagueStage();
    if (!current || current.stageKey !== item.expectedStageKey)
        throw new Error('切换前当前地图已变化，已取消过期请求');
    if (currentStageIsBossOrPumpkin(current) || g_bossReturnContext || g_eventDungeonContext)
        return false;
    if (fridaCurrentCombatState() === true) {
        item.combatWaitUntil=item.combatWaitUntil||Date.now()+60000;
        if(Date.now()>item.combatWaitUntil) throw new Error('等待战斗结束超过60秒，本轮地图请求已取消');
        g_autoPlagueSwitchQueued=true;
        item.deferUntil=Date.now()+500;
        g_queue.push(item);
        g_autoPlagueLastResult='等待当前战斗结束后执行地图跳转';
        return false;
    }
    var target = resolveAutoPlagueTargetStage(item.difficulty, item.targetStageNo);
    if (!target || target.stage.stageKey !== item.targetStageKey)
        throw new Error('目标瘟疫关卡与难度/层数校验不一致');
    if (autoPlagueTicketHasPriority(scanInventory())) {
        g_autoPlagueLastResult = '手动瘟疫测试未执行：门票挑战优先级更高';
        emit('auto_plague_map_switch_failed', {reason:'ticket-priority',
            targetStageNo:item.targetStageNo, manual:item.manual === true,
            previousStageKey:current.stageKey, at:Date.now()});
        return false;
    }
    var plagueValidation = target.bridge.validatePlague.fn(target.cache, target.bridge.validatePlague.mi) | 0;
    if (plagueValidation !== 0) throw new Error('目标瘟疫地图进入校验失败，返回码=' + plagueValidation);
    // The portal creates the playable StageNode cache. The catalog cache for
    // the same key may be an end-stage record; its generic entry check is not
    // authoritative for plague routing. The native UI button validates entry.
    resolvePlagueUiBridge();
    var context={difficulty:item.difficulty,targetStageNo:item.targetStageNo,
        targetStageKey:target.stage.stageKey,expectedStageKey:current.stageKey,
        manual:item.manual===true,startedAt:Date.now(),deadlineAt:Date.now()+90000,
        difficultyAttempts:0,tabAttempts:0,levelAttempts:0};
    g_autoPlagueUiRoute=context;
    g_autoPlagueSwitchQueued=true;
    g_autoPlagueAwaitingStage=null;
    g_autoPlagueLastResult='正在通过游戏原生地图控件进入瘟疫 '+item.targetStageNo+' 层';
    queuePlagueUiStep(context,'open',0);
    channelLog('自动地图',g_autoPlagueLastResult+'。');
    return true;
}

function eventDungeonTicketCounts(rows) {
    var counts = {};
    EVENT_DUNGEON_TICKETS.forEach(function (ticket) { counts[ticket.itemKey] = 0; });
    (rows || []).forEach(function (row) {
        if (!row || !row.placed || row.locked || row.serverPending || row.deletedInServer) return;
        var key = Number(row.itemKey) || 0;
        if (!Object.prototype.hasOwnProperty.call(counts, key)) return;
        (row.sources || []).forEach(function (source) {
            if (source.source === '背包' || source.source === '仓库') {
                counts[key] += Math.max(0, Number(source.quantity) || 0);
            }
        });
    });
    return counts;
}

function challengeTargetRule(key) {
    var legacyMinimum = key.indexOf('halloween') === 0 ? 1 : g_autoBossMinStones;
    if (typeof g_challengeTargets === 'undefined' || g_challengeTargets === null)
        return {enabled:true, minCount:legacyMinimum};
    var rule = g_challengeTargets[key];
    return {enabled:!!rule && rule.enabled === true,
        minCount:Math.max(1, Math.min(999999, parseInt(rule && rule.minCount, 10) || legacyMinimum))};
}

function eventDungeonRuleKey(ticket) {
    return {170101:'halloweenNightmare',170102:'halloweenHell',170103:'halloweenTorment'}[ticket.itemKey] || '';
}

function eventDungeonTicketEligible(ticket, counts) {
    var key = eventDungeonRuleKey(ticket), rule = challengeTargetRule(key);
    var count = Number(counts && counts[ticket.itemKey]) || 0;
    if (!rule.enabled || count <= 0) {
        delete g_eventAdmittedTicketTypes[key];
        return false;
    }
    return count > rule.minCount;
}

function selectEventDungeonTicket(counts) {
    counts = counts || {};
    // Clear every exhausted admission, including lower-priority difficulties.
    EVENT_DUNGEON_TICKETS.forEach(function(ticket) {
        if (!(Number(counts[ticket.itemKey]) > 0) || !challengeTargetRule(eventDungeonRuleKey(ticket)).enabled)
            delete g_eventAdmittedTicketTypes[eventDungeonRuleKey(ticket)];
    });
    for (var i = 0; i < EVENT_DUNGEON_TICKETS.length; i++) {
        var ticket = EVENT_DUNGEON_TICKETS[i];
        if (eventDungeonTicketEligible(ticket, counts)) return ticket;
    }
    return null;
}


function resolveEventDungeonEntry() {
    if (g_eventEntryMethod) return g_eventEntryMethod;
    requireCurrentGameBuild();
    // Call the game's public event-stage entry route. The private kvt method is
    // only its UniTask state-machine body and omits UI/server entry setup.
    var row = resolveCubeBridgeMethod({className:'xi', methodName:'kvw', argCount:3, rva:0xa4f080});
    var params = [0, 1, 2].map(function (index) {
        return cstr(il2cpp.typeGetName(il2cpp.methodGetParam(row.mi, index)));
    });
    var resultType = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(row.mi)));
    if (params[0] !== 'xo.StageCache' || params[1] !== 'System.Action<System.Boolean>' ||
            params[2] !== 'System.Boolean' || resultType !== 'System.Void') {
        throw new Error('活动关卡原生入场签名校验失败');
    }
    // IL2CPP System.Boolean is an unsigned byte in the native ABI. Frida
    // expects an integer argument, not JavaScript false/true.
    row.fn = new NativeFunction(row.ptr, 'void', ['pointer', 'pointer', 'uint8', 'pointer']);
    g_eventEntryMethod = row;
    return row;
}


function enqueueEventDungeonEntry(ticket) {
    if (!g_autoHalloweenEventEnabled || !ticket || g_eventEntryQueued ||
            Date.now() < g_eventEntryRetryAt ||
            g_eventDungeonContext && g_eventDungeonContext.phase !== 'ready') return false;
    if (!ensureUpdateHook()) throw new Error('活动关卡主线程队列挂载失败');
    g_eventEntryQueued = true;
    g_queue.push({action:'eventDungeonEnter', ticket:ticket, at:Date.now()});
    g_eventLastResult = '已排队：' + ticket.name + '难度南瓜灯峡谷';
    return true;
}

function processEventDungeonEntry(item) {
    g_eventEntryQueued = false;
    if (!g_autoHalloweenEventEnabled || !item || !item.ticket) return;
    if (g_queue.length || sharedGameActionWaiting() || synthesisInventoryMutationActive() ||
            boxInventoryMutationActive() || g_boxOpenInFlight || nativeExchangePending()) {
        item.at = Date.now();
        item.deferUntil = Date.now() + 500;
        g_eventEntryQueued = true;
        g_queue.push(item);
        return;
    }
    scanInventory();
    var counts = eventDungeonTicketCounts(g_lastPlacedRows);
    if ((counts[item.ticket.itemKey] || 0) <= 0) {
        g_eventLastResult = item.ticket.name + '入场券已不在背包，重新读取票券';
        return;
    }
    if (!eventDungeonTicketEligible(item.ticket, counts)) {
        g_eventLastResult = item.ticket.name + '未启用或入场券未达到该难度门槛';
        return;
    }
    var bridge = resolveAutoBossStageBridge();
    var cache = bridge.cacheByKey.fn(item.ticket.stageKey, bridge.cacheByKey.mi);
    var actual = readAutoBossStageInfo(cache);
    if (!actual || actual.stageType !== 4 || actual.stageKey !== item.ticket.stageKey) {
        throw new Error('活动关卡数据校验失败，已阻止消耗入场券；actual=' +
            JSON.stringify(actual) + '；expected=' + JSON.stringify({stageKey:item.ticket.stageKey, stageType:4}));
    }
    if (!g_eventDungeonContext) {
        var origin = currentAutoBossStage();
        if (!origin || (origin.stageType !== 0 && origin.stageType !== 2)) {
            throw new Error('进入活动前需要处于普通或瘟疫关卡');
        }
        g_eventDungeonContext = {origin:origin, phase:'ready', startedAt:Date.now(), rounds:0};
    }
    g_eventDungeonContext.ticket = item.ticket;
    g_eventDungeonContext.stageKey = item.ticket.stageKey;
    g_eventDungeonContext.ticketCountBefore = counts[item.ticket.itemKey] || 0;
    g_eventDungeonContext.ticketItemKey = item.ticket.itemKey;
    g_eventDungeonContext.phase = 'entering';
    g_eventDungeonContext.entryAt = Date.now();
    g_eventDungeonContext.roundCleared = false;
    g_eventClearLogSeen = false;
    // Let the native event flow validate unlocks, ticket quantity and box capacity.
    // It owns ticket consumption and all server requests.
    emit('auto_event_dungeon_entry_dispatching', {stage:actual,
        origin:g_eventDungeonContext.origin, ticketItemKey:item.ticket.itemKey,
        ticketCountBefore:counts[item.ticket.itemKey], entryRva:0xa44180});
    var entry = resolveEventDungeonEntry();
    // StageNode's three ticket handlers all pass the same managed ike callback
    // (RVA 0x8f8450) used by Boss entry. It initializes the scene on success;
    // omitting it submits the ticket transaction without completing entry.
    var callback = nativeAutoBossEntryCallback({enterStage:entry});
    g_eventEntryDispatching = true;
    recordMapSwitchDispatch();
    try { entry.fn(cache, callback, 0, entry.mi); }
    finally { g_eventEntryDispatching = false; }
    g_eventAdmittedTicketTypes[eventDungeonRuleKey(item.ticket)] = true;
    g_eventEntryRetryAt = 0;
    g_eventDungeonContext.rounds++;
    g_eventLastResult = '已提交原生入场：' + item.ticket.name + '南瓜灯峡谷';
    channelLog('自动挑战', g_eventLastResult + '。');
    emit('auto_event_dungeon_entry_submitted', {stage:actual,
        ticketItemKey:item.ticket.itemKey, ticketCountBefore:counts[item.ticket.itemKey]});
}

function queueEventDungeonReturn() {
    if (!g_eventDungeonContext || g_eventDungeonContext.phase === 'returning' ||
            g_eventDungeonContext.phase === 'returnWaiting' || g_eventDungeonContext.phase === 'returnQueued' ||
            !ensureUpdateHook()) return false;
    g_eventDungeonContext.phase = 'returnQueued';
    g_queue.push({action:'eventDungeonReturn', at:Date.now()});
    return true;
}

function processEventDungeonReturn() {
    if (!g_eventDungeonContext || !g_eventDungeonContext.origin) return;
    var record = g_eventDungeonContext;
    if (sharedGameActionWaiting() || bossReturnActionBusy()) {
        record.phase = 'returnQueued';
        g_queue.push({action:'eventDungeonReturn', at:Date.now(), deferUntil:Date.now()+500});
        return;
    }
    var current = currentAutoBossStage();
    if (current && autoBossStageMatches(current, record.origin)) {
        g_eventDungeonContext = null;
        g_eventLastResult = '已返回原关卡';
        emit('auto_event_dungeon_returned', {origin:record.origin, rounds:record.rounds});
        channelLog('自动挑战', g_eventLastResult + '。');
        return;
    }
    if (current && current.stageType === 4) {
        record.phase = 'settling';
        return;
    }
    if (record.returnRequestedAt && Date.now() - record.returnRequestedAt < 60000) {
        record.phase = 'returnWaiting';
        return;
    }
    if (record.origin.stageType === 2) prepareNativePlagueReturn(record.origin);
    var bridge = resolveAutoBossStageBridge();
    record.phase = 'returning';
    recordMapSwitchDispatch();
    g_bossReturnDispatching = true;
    try { bridge.returnScene.fn(record.origin.stageKey, 1, bridge.returnScene.mi); }
    finally { g_bossReturnDispatching = false; }
    record.returnRequestedAt = Date.now();
    record.phase = 'returnWaiting';
}

function runAutoEventDungeonPass() {
    if (!g_running) return;
    var record = g_eventDungeonContext;
    if (!g_autoHalloweenEventEnabled && !record) return;
    try {
        if (record) {
            var current = null;
            try { current = currentAutoBossStage(); } catch (stageError) {}
            if (current && current.stageType === 4 && current.stageKey === record.stageKey) {
                if (record.phase === 'entering') record.phase = 'inStage';
                if (record.stopAfterRound) g_eventLastResult = '当前活动关卡结束后停止，不再消耗下一张门票';
                return;
            }
            if (record.phase === 'entering') {
                if (Date.now() - record.entryAt < 120000) return;
                g_eventLastResult = '原生入场两分钟内未确认，停止自动重试以免重复消耗门票';
                channelLog('自动挑战', g_eventLastResult + '。');
                queueEventDungeonReturn();
                return;
            }
            if (record.phase === 'inStage' && !record.roundCleared) {
                record.leftStageObservedAt = record.leftStageObservedAt || Date.now();
                if (Date.now() - record.leftStageObservedAt < 5000) return;
                scanInventory();
                var afterCounts = eventDungeonTicketCounts(g_lastPlacedRows);
                var ticketAfter = Number(afterCounts[record.ticketItemKey]) || 0;
                var ticketBefore = Number(record.ticketCountBefore) || 0;
                if (ticketBefore > ticketAfter) {
                    record.roundCleared = true;
                    record.phase = 'settling';
                    record.clearObservedAt = Date.now();
                    g_eventLastResult = '南瓜灯峡谷关卡已结束，确认入场券已消耗';
                    channelLog('自动挑战', g_eventLastResult + '。');
                    emit('auto_event_dungeon_ticket_consumed', {stageKey:record.stageKey,
                        ticketItemKey:record.ticketItemKey, ticketBefore:ticketBefore,
                        ticketAfter:ticketAfter, observedAt:Date.now()});
                } else {
                    g_eventLastResult = '活动关卡已离开，入场券数量未减少，停止连续挑战';
                    emit('auto_event_dungeon_interrupted', {stageKey:record.stageKey, origin:record.origin,
                        ticketBefore:ticketBefore, ticketAfter:ticketAfter});
                    g_eventDungeonContext = null;
                    return;
                }
            }
            if (record.phase === 'settling' && !record.roundCleared) {
                record.roundCleared = true;
            }
            if (record.phase === 'returning' || record.phase === 'returnQueued' ||
                    record.phase === 'returnWaiting') {
                if (!g_queue.some(function (item) { return item.action === 'eventDungeonReturn'; })) {
                    g_queue.push({action:'eventDungeonReturn', at:Date.now()});
                }
                return;
            }
            if (record.roundCleared || record.phase === 'settling' || record.phase === 'inStage' ||
                    record.phase === 'entering') {
                if (record.roundCleared || record.phase !== 'inStage') {
                    if (!g_autoHalloweenEventEnabled || record.stopAfterRound) {
                        queueEventDungeonReturn();
                        return;
                    }
                    scanInventory();
                    var nextTicket = selectEventDungeonTicket(eventDungeonTicketCounts(g_lastPlacedRows));
                    if (!nextTicket) { queueEventDungeonReturn(); return; }
                    record.phase = 'ready';
                    enqueueEventDungeonEntry(nextTicket);
                }
                return;
            }
        }
        if (!g_autoHalloweenEventEnabled || g_eventEntryQueued ||
                g_autoBossEnabled && (g_bossStageQueued || g_bossState === 'waitingBox') ||
                g_bossReturnContext || automationCycleBusy()) return;
        if (Date.now() < g_eventNextTicketCheckAt) return;
        g_eventNextTicketCheckAt = Date.now() + g_ticketCheckIntervalMs;
        var currentStage = currentAutoBossStage();
        if (!currentStage || (currentStage.stageType !== 0 && currentStage.stageType !== 2)) return;
        scanInventory();
        var ticket = selectEventDungeonTicket(eventDungeonTicketCounts(g_lastPlacedRows));
        if (!ticket) { g_eventLastResult = '所选峡谷难度的入场券尚未达到各自门槛'; return; }
        enqueueEventDungeonEntry(ticket);
    } catch (error) {
        g_eventLastResult = '自动挑战检查失败：' + chineseError(error);
        channelLog('自动挑战', g_eventLastResult + '。');
        emit('auto_event_dungeon_failed', {error:String(error), stage:g_eventDungeonContext});
    }
}

function autoBossSeriesActive(record) {
    return !!record && g_running && g_autoBossEnabled && !record.roundsFinished;
}

function scheduleAutoBossReturnCheck() {
    if (!g_bossReturnContext || g_bossReturnTimer !== null) return;
    // Independent of the 30-minute automation cycle and its enabled switches.
    // An already submitted Boss still needs to finish returning to its source.
    g_bossReturnTimer = setTimeout(function () {
        g_bossReturnTimer = null;
        if (!g_bossReturnContext) return;
        if (!g_queue.some(function (item) { return item.action === 'bossStageReturn'; }) && ensureUpdateHook()) {
            g_queue.push({action: 'bossStageReturn', at: Date.now()});
        }
        scheduleAutoBossReturnCheck();
    }, 1000);
}

function cancelAutoBossReturn(reason) {
    if (!g_bossReturnContext) return;
    var record = g_bossReturnContext;
    emit('auto_boss_return_cancelled', {origin: g_bossReturnContext.origin, reason: reason});
    g_bossReturnContext = null;
    if (g_bossReturnTimer !== null) clearTimeout(g_bossReturnTimer);
    g_bossReturnTimer = null;
    wakeBossCycleAfterReturn(record);
}

function rememberAutoBossReturnStage(target) {
    var origin = currentAutoBossStage();
    if (!origin || (origin.stageType !== 0 && origin.stageType !== 2)) {
        throw new Error('尚未回到普通或瘟疫关卡，等待游戏返回后再进入下一轮 Boss');
    }
    if (g_bossReturnContext) {
        var record = g_bossReturnContext;
        if (!autoBossSeriesActive(record) ||
                (!autoBossStageMatches(origin, record.origin) &&
                 origin.stageKey !== record.fallbackNormalStageKey)) {
            throw new Error('正在等待返回原关卡');
        }
        // This is another Boss in the same series, entered from the game's
        // normal fallback. Preserve the first Plague origin until all stones
        // are handled; never replace it with this intermediate normal stage.
        record.bossStageKey = target.stageKey;
        record.phase = 'boss';
        record.stableSince = 0;
        record.retryAt = 0;
        record.attempts = 0;
        record.cycleYielded = false;
        record.roundCount = (record.roundCount || 1) + 1;
        emit('auto_boss_return_retained', {origin:record.origin,
            bossStageKey:target.stageKey, roundCount:record.roundCount});
        scheduleAutoBossReturnCheck();
        return;
    }
    var stageBridge = resolveAutoBossStageBridge();
    var owner = stageBridge.current ? findClassByEnumeratedName('', 'xi') :
        il2cpp.methodGetClass(stageBridge.cacheByKey.mi);
    if (isBadPtr(owner)) throw new Error('关卡管理器类型未找到');
    var fields = runtimeClassFields(owner).fields;
    // Current xi stores the last normal stage key in bizo at 0xa4;
    // bizo is a stage-index dictionary at 0x48, not a stage-key field.
    if (fields.bizo !== 0xa4) throw new Error('最后普通关卡字段版本校验失败');
    var fallbackKey = il2cpp.classGetStaticFieldData(owner).add(fields.bizo).readS32();
    var fallbackCache = stageBridge.cacheByKey.fn(fallbackKey, stageBridge.cacheByKey.mi);
    var fallbackStage = readAutoBossStageInfo(fallbackCache);
    if (!fallbackStage || fallbackStage.stageType !== 0 || fallbackStage.stageKey !== fallbackKey) {
        throw new Error('游戏未保存可返回的普通关卡');
    }
    g_bossReturnContext = {origin: origin, bossStageKey: target.stageKey,
        fallbackNormalStageKey: fallbackKey, capturedAt: Date.now(), phase: 'boss', attempts: 0,
        roundsFinished:false, roundCount:1};
    emit('auto_boss_return_saved', g_bossReturnContext);
    scheduleAutoBossReturnCheck();
}

function autoBossReturnContextForStage(current, requested) {
    var context = g_bossReturnContext;
    return context && current && current.stageKey === context.bossStageKey &&
        (current.stageType === 1 || current.stageType === 3) &&
        context.origin && (context.origin.stageType === 0 || context.origin.stageType === 2) &&
        requested && (requested.stageType === 0 || requested.stageType === 2) &&
        (requested.stageKey === context.origin.stageKey ||
            requested.stageKey === context.fallbackNormalStageKey) ? context : null;
}

function installAutoBossReturnHooks(bridge) {
    if (g_bossReturnListeners.length) return;
    var method = bridge.returnScene;
    var sceneListener = Interceptor.attach(method.ptr, {
        onEnter: function (args) {
            var record = g_bossReturnContext;
            if (!record || g_bossReturnDispatching) return;
            try {
                var requested = readAutoBossStageInfo(bridge.cacheByKey.fn(args[0].toInt32(), bridge.cacheByKey.mi));
                var current = currentAutoBossStage();
                if (autoBossReturnContextForStage(current, requested)) {
                    if (record.origin.stageType === 0) args[0] = ptr(record.origin.stageKey);
                    // Plague re-entry has a native cooldown. Allow the normal
                    // fallback, then validate eligibility on the main thread.
                    record.phase = 'waiting';
                    record.stableSince = 0;
                } else if (requested && requested.stageKey === record.origin.stageKey && record.phase !== 'boss') {
                    // Ordinary native restarts of the same stage are harmless.
                } else if (requested && requested.stageKey === record.fallbackNormalStageKey && record.phase !== 'boss') {
                    record.phase = 'waiting';
                    record.stableSince = 0;
                } else if (requested && requested.stageKey !== record.bossStageKey) {
                    cancelAutoBossReturn('游戏切换到了其他关卡');
                }
            } catch (e) {
                emit('auto_boss_return_error', {error: String(e), origin: record.origin});
                cancelAutoBossReturn('返回关卡读取失败');
            }
        }
    });
    // Even choosing the same fallback stage manually cancels the pending return.
    var select = resolveCubeBridgeMethod({namespace: 'TaskbarHero', className: 'StageNode',
        methodName: 'iko', argCount: 0, rva: 0x8fe860});
    var manualListener = Interceptor.attach(select.ptr, {onEnter: function () {
        var eventEntryPending = typeof g_eventDungeonContext !== 'undefined' &&
            g_eventDungeonContext && g_eventDungeonContext.phase === 'entering' &&
            Date.now() - (g_eventDungeonContext.entryAt || 0) < 30000;
        if (typeof g_eventDungeonContext !== 'undefined' && g_eventDungeonContext &&
                !g_eventEntryDispatching && !eventEntryPending) {
            g_eventLastResult = '检测到手动选择关卡，停止南瓜灯峡谷连续挑战';
            emit('auto_event_dungeon_cancelled', {reason:'用户手动选择关卡',
                origin:g_eventDungeonContext.origin, rounds:g_eventDungeonContext.rounds});
            channelLog('自动挑战', g_eventLastResult + '。');
            g_eventDungeonContext = null;
            g_eventEntryQueued = false;
            g_queue = g_queue.filter(function (item) {
                return item.action !== 'eventDungeonEnter' && item.action !== 'eventDungeonReturn';
            });
        }
        if (!g_bossReturnDispatching && Date.now() >= g_bossProgrammaticEntryUntil)
            cancelAutoBossReturn('用户手动选择关卡');
    }});
    g_bossReturnListeners = [sceneListener, manualListener];
}

function prepareNativePlagueReturn(_origin) {
    // The game's PlaguelandsController signatures changed. Returning through
    // xi.kxu now performs the native stage validation and navigation itself;
    // avoid calling stale controller methods before that authoritative route.
}

function processAutoBossReturnQueueItem() {
    var record = g_bossReturnContext;
    if (!record) return;
    try {
        var now = Date.now(), current = currentAutoBossStage();
        if (!current) return;
        if (record.phase === 'boss' && current.stageKey === record.bossStageKey) return;
        if (current.stageKey === record.fallbackNormalStageKey && current.stageType === 0) {
            var previousOrigin = record.origin;
            g_bossReturnContext = null;
            g_bossNextInventoryCheckAt = Math.max(g_bossNextInventoryCheckAt,
                now + g_ticketCheckIntervalMs);
            g_bossLastResult = '游戏已按原生流程返回普通关卡 3-9；本轮不再手动跳回其他地图';
            emit('auto_boss_native_returned_to_3_9', {origin:previousOrigin, actual:current,
                nextTicketCheckAt:g_bossNextInventoryCheckAt, observedAt:now});
            bossLog(g_bossLastResult + '。');
            return;
        }
        if (autoBossStageMatches(current, record.origin)) {
            if (record.phase === 'boss') return;
            if (autoBossSeriesActive(record)) return;
            if (!record.stableSince) record.stableSince = now;
            // Scene cache mutation alone is not proof: a server availability
            // callback can send the player back a few frames later.
            if (now - record.stableSince < 5000) return;
            emit('auto_boss_return_restored', {origin: record.origin, actual: current,
                bossStageKey: record.bossStageKey, observedAt: now,
                waitedMs: now - record.capturedAt, attempts: record.attempts});
            g_bossReturnContext = null;
            wakeBossCycleAfterReturn(record);
            return;
        }
        if (current.stageKey === record.bossStageKey) return;
        if (current.stageKey !== record.fallbackNormalStageKey) {
            cancelAutoBossReturn('当前关卡已变化');
            return;
        }
        record.phase = 'waiting';
        record.stableSince = 0;
        // Native Boss settlement already returns to a normal stage. Continue
        // the remaining Boss rounds there, then return to the original stage
        // once. Stopping Boss still completes the submitted return normally.
        if (autoBossSeriesActive(record)) return;
        if (bossReturnActionBusy()) return;
        if (record.retryAt && now < record.retryAt) return;
        var bridge = resolveAutoBossStageBridge();
        var cache = bridge.cacheByKey.fn(record.origin.stageKey, bridge.cacheByKey.mi);
        if (!autoBossStageMatches(readAutoBossStageInfo(cache), record.origin)) {
            throw new Error('原关卡缓存与保存的完整关卡信息不一致');
        }
        if (record.origin.stageType === 2) {
            var result = bridge.validatePlague.fn(cache, bridge.validatePlague.mi) | 0;
            if (record.lastEnterResult !== result) {
                record.lastEnterResult = result;
                emit('auto_boss_return_waiting', {origin: record.origin, enterResult: result, observedAt: now});
                bossLog(result === 7 ? '等待瘟疫重新进入冷却结束，随后返回原关卡。' :
                    result === 0 ? '瘟疫冷却结束，准备返回原关卡。' :
                    '原瘟疫关卡暂时无法进入，返回码=' + result + '，继续等待。');
            }
            if (result !== 0) return;
            prepareNativePlagueReturn(record.origin);
        }
        if (record.attempts >= 3) throw new Error('游戏未保留原关卡，已停止重复进入');
        record.attempts++;
        record.retryAt = now + 10000;
        record.phase = 'verifying';
        g_bossReturnDispatching = true;
        try { bridge.returnScene.fn(record.origin.stageKey, 1, bridge.returnScene.mi); }
        finally { g_bossReturnDispatching = false; }
    } catch (e) {
        emit('auto_boss_return_error', {error: String(e), origin: record.origin});
        bossLog('返回原关卡失败：' + chineseError(e));
        cancelAutoBossReturn('原关卡返回失败');
    }
}

function nativeAutoBossEntryCallback(bridge) {
    if (bridge && bridge.enterStage &&
            (bridge.current === true || synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT)) {
        // Game 1.3.0 renamed the old generated `ike` callback. The current
        // StageNode.iku is the verified static void(Boolean) entry callback.
        var stageNodeClass = findClassByEnumeratedName('TaskbarHero', 'StageNode');
        if (isBadPtr(stageNodeClass)) throw new Error('找不到当前版 StageNode 回调类型');
        var currentCallbackMethod = findMethodInfo('TaskbarHero', 'StageNode', 'iku', 1);
        if (isBadPtr(currentCallbackMethod) ||
                cstr(il2cpp.methodGetName(currentCallbackMethod)) !== 'iku' ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(currentCallbackMethod))) !== 'System.Void' ||
                cstr(il2cpp.typeGetName(il2cpp.methodGetParam(currentCallbackMethod, 0))) !== 'System.Boolean') {
            throw new Error('当前版 StageNode.iku 回调签名校验失败');
        }
        var callbackFlagsStorage = Memory.alloc(4);
        callbackFlagsStorage.writeU32(0);
        if ((il2cpp.methodGetFlags(currentCallbackMethod, callbackFlagsStorage) & 0x10) === 0) {
            throw new Error('当前版 StageNode.iku 不是静态成功回调');
        }
        var currentDelegateType = il2cpp.methodGetParam(bridge.enterStage.mi, 1);
        if (cstr(il2cpp.typeGetName(currentDelegateType)) !== 'System.Action<System.Boolean>') {
            throw new Error('当前版关卡成功回调类型校验失败');
        }
        var currentDelegateClass = api('il2cpp_class_from_type', 'pointer', ['pointer'])(currentDelegateType);
        if (isBadPtr(currentDelegateClass)) throw new Error('当前版 Action<Boolean> 类型未就绪');
        var ctorIter = Memory.alloc(PTR);
        ctorIter.writePointer(ptr(0));
        var delegateCtor = ptr(0);
        for (var ctorIndex = 0; ctorIndex < 128; ctorIndex++) {
            var candidateCtor = il2cpp.classGetMethods(currentDelegateClass, ctorIter);
            if (isBadPtr(candidateCtor)) break;
            if (cstr(il2cpp.methodGetName(candidateCtor)) !== '.ctor' ||
                    il2cpp.methodGetParamCount(candidateCtor) !== 2) continue;
            if (cstr(il2cpp.typeGetName(il2cpp.methodGetParam(candidateCtor, 0))) === 'System.Object' &&
                    cstr(il2cpp.typeGetName(il2cpp.methodGetParam(candidateCtor, 1))) === 'System.IntPtr') {
                delegateCtor = candidateCtor;
                break;
            }
        }
        if (isBadPtr(delegateCtor) || isBadPtr(methodPtr(currentCallbackMethod))) {
            throw new Error('当前版 Action<Boolean> 构造入口未找到');
        }
        var callbackObject = api('il2cpp_object_new', 'pointer', ['pointer'])(currentDelegateClass);
        if (isBadPtr(callbackObject)) throw new Error('当前版 Action<Boolean> 对象创建失败');
        // IL2CPP's runtime_invoke path does not initialize delegate thunk
        // fields correctly here. Call the verified native .ctor directly;
        // this constructor expects a MethodInfo* as its second managed arg.
        new NativeFunction(methodPtr(delegateCtor), 'void',
            ['pointer', 'pointer', 'pointer', 'pointer'])(
                callbackObject, ptr(0), currentCallbackMethod, delegateCtor);
        if (!sameNativePointer(callbackObject.add(0x10).readPointer(),
                    methodPtr(currentCallbackMethod)) ||
                !callbackObject.add(0x20).readPointer().isNull() ||
                !sameNativePointer(callbackObject.add(0x28).readPointer(), currentCallbackMethod) ||
                isBadPtr(callbackObject.add(0x18).readPointer())) {
            throw new Error('当前版 Action<Boolean> 委托字段校验失败');
        }
        return callbackObject;
    }
    if (g_bossEntryCallback) return g_bossEntryCallback.pointer;
    // Reproduce the game's managed Action<bool> construction, including GC
    // ownership, so jzd's successful stone transaction initializes the scene.
    var method = findMethodInfoByRva(0x8f8450);
    if (isBadPtr(method) || cstr(il2cpp.methodGetName(method)) !== 'ike')
        method = findMethodInfoByManagedSignature('ike', 'System.Void', ['System.Boolean']);
    if (isBadPtr(method)) {
        throw new Error('Boss 原生成功回调版本校验失败');
    }
    var owner = il2cpp.methodGetClass(method), info = runtimeClassFields(owner), fields = info.fields;
    if (fields['<>9'] !== 0 || fields['<>9__18_2'] !== 0x10) throw new Error('Boss 回调实例字段版本校验失败');
    api('il2cpp_runtime_class_init', 'void', ['pointer'])(owner);
    var target = il2cpp.classGetStaticFieldData(owner).add(fields['<>9']).readPointer();
    if (isBadPtr(target)) throw new Error('Boss 原生回调实例为空');
    var cached = il2cpp.classGetStaticFieldData(owner).add(fields['<>9__18_2']).readPointer();
    if (!isBadPtr(cached)) {
        if (!sameNativePointer(cached.add(0x20).readPointer(), target) ||
                !sameNativePointer(cached.add(0x28).readPointer(), method)) {
            throw new Error('Boss 缓存回调绑定校验失败');
        }
        g_bossEntryCallback = {pointer: cached};
        return cached;
    }
    var callbackType = il2cpp.methodGetParam(bridge.enterStage.mi, 1);
    if (cstr(il2cpp.typeGetName(callbackType)) !== 'System.Action<System.Boolean>') {
        throw new Error('Boss 成功回调类型版本校验失败');
    }
    var classFromType = api('il2cpp_class_from_type', 'pointer', ['pointer']);
    var objectNew = api('il2cpp_object_new', 'pointer', ['pointer']);
    var callback = objectNew(classFromType(callbackType));
    if (isBadPtr(callback)) throw new Error('Boss 原生回调创建失败');
    var delegateClass = il2cpp.objectGetClass(callback);
    var delegateCtor = il2cpp.classGetMethod(delegateClass, Memory.allocUtf8String('.ctor'), 2);
    if (isBadPtr(delegateCtor) || cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(delegateCtor))) !== 'System.Void' ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetParam(delegateCtor, 0))) !== 'System.Object' ||
            cstr(il2cpp.typeGetName(il2cpp.methodGetParam(delegateCtor, 1))) !== 'System.IntPtr') {
        throw new Error('Boss 回调构造器签名校验失败');
    }
    new NativeFunction(methodPtr(delegateCtor), 'void', ['pointer', 'pointer', 'pointer', 'pointer'])(callback, target, method, delegateCtor);
    var storage = Memory.alloc(PTR);
    storage.writePointer(callback);
    api('il2cpp_field_static_set_value', 'void', ['pointer', 'pointer'])(info.fieldInfos['<>9__18_2'], storage);
    g_bossEntryCallback = {pointer: callback};
    return callback;
}

function readAutoBossStageInfo(cachePtr) {
    if (isBadPtr(cachePtr)) return null;
    try {
        var cacheClass = il2cpp.objectGetClass(cachePtr);
        var cacheInfo = runtimeClassFields(cacheClass);
        var stageInfoOffset = firstFieldOffset(cacheInfo.fields,
            [synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT ? 'bizw' : 'bfar']);
        if (stageInfoOffset !== 0x10) return null;
        var stageInfoPtr = cachePtr.add(stageInfoOffset).readPointer();
        if (isBadPtr(stageInfoPtr)) return null;
        var info = runtimeClassFields(il2cpp.objectGetClass(stageInfoPtr));
        function value(names, expectedOffset) {
            var offset = firstFieldOffset(info.fields, names);
            if (offset !== expectedOffset) throw new Error('关卡字段版本校验失败');
            return stageInfoPtr.add(offset).readS32();
        }
        return {
            stageKey: value(['StageKey'], 0x30),
            stageType: value(['STAGETYPE'], 0x40),
            difficulty: value(['STAGEDIFFICULTY'], 0x44),
            act: value(['Act'], 0x48),
            stageNo: value(['StageNo'], 0x4c),
            level: value(['StageLevel'], 0x50),
            soulStoneItemKey: value(['SoulStoneItemKey'], 0x94),
            soulStoneAmount: value(['SoulStoneAmount'], 0x98)
        };
    } catch (e) {
        return null;
    }
}

function autoBossStageMatches(actual, target) {
    return !!actual && !!target &&
        actual.stageKey === target.stageKey &&
        (target.stageType == null || actual.stageType === target.stageType) &&
        actual.difficulty === target.difficulty &&
        actual.act === target.act &&
        actual.stageNo === target.stageNo;
}

function autoBossReadOnlyDiagnostics() {
    var bridge = resolveAutoBossStageBridge();
    var names = AUTO_BOSS_TARGET_PRIORITY.slice().reverse();
    var targets = [];
    for (var i = 0; i < names.length; i++) {
        var target = AUTO_BOSS_TARGETS[names[i]];
        var cache = bridge.cacheByKey.fn(target.stageKey, bridge.cacheByKey.mi);
        var actual = readAutoBossStageInfo(cache);
        if (!autoBossStageMatches(actual, target) ||
                actual.soulStoneItemKey !== target.itemKey || actual.soulStoneAmount <= 0) {
            throw new Error(target.name + ' 3-10 关卡缓存版本校验失败');
        }
        targets.push({
            name: target.name,
            stageKey: target.stageKey,
            stageType: actual.stageType,
            soulStoneItemKey: actual.soulStoneItemKey,
            soulStoneAmount: actual.soulStoneAmount,
            enterResult: bridge.validateEnter.fn(cache, bridge.validateEnter.mi) | 0
        });
    }
    return {
        executed: false,
        cacheByKeyRva: bridge.cacheByKey.derived ? 'derived-from-xi.bizd' :
            '0x' + bridge.cacheByKey.ptr.sub(B).toString(16),
        validateEnterRva: '0x' + bridge.validateEnter.ptr.sub(B).toString(16),
        enterStageRva: '0x' + bridge.enterStage.ptr.sub(B).toString(16),
        enterSceneRva: bridge.enterScene ? '0x' + bridge.enterScene.ptr.sub(B).toString(16) : '',
        targets: targets
    };
}

function bossInventorySnapshot(rows) {
    rows = rows || g_lastPlacedRows || [];
    var snapshot = {
        stoneCounts: emptyAutoBossStoneCounts(),
        actBossBoxUids: {},
        actBossBoxCount: 0
    };
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        if (!row.placed) continue;
        var itemKey = parseInt(row.itemKey, 10) || 0;
        AUTO_BOSS_TARGET_PRIORITY.forEach(function (targetName) {
            var target = AUTO_BOSS_TARGETS[targetName];
            if (!target || itemKey !== target.itemKey || row.locked || row.serverPending || row.deletedInServer) return;
            var quantity = (row.sources || []).reduce(function (sum, source) {
                if (['背包', '仓库', '材料仓库'].indexOf(source.source) < 0) return sum;
                return sum + Math.max(0, parseInt(source.quantity, 10) || 0);
            }, 0);
            snapshot.stoneCounts[targetName] += row.sources && row.sources.length ? quantity : 1;
        });
        if (String(itemKey).indexOf(ACT_BOSS_BOX_PREFIX) === 0) {
            snapshot.actBossBoxCount++;
            snapshot.actBossBoxUids[String(row.uid || itemKey + ':' + i)] = true;
        }
    }
    return snapshot;
}

function emptyAutoBossStoneCounts() {
    var counts = {};
    AUTO_BOSS_TARGET_PRIORITY.forEach(function (targetName) { counts[targetName] = 0; });
    return counts;
}

function serializedActBossBoxSnapshot(snapshot) {
    snapshot = snapshot || { quantities: [], entries: [] };
    var result = {
        count: Math.max(0, parseInt((snapshot.quantities || [])[2], 10) || 0),
        uids: {}
    };
    var entries = snapshot.entries || [];
    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i] || {};
        if (parseInt(entry.type, 10) !== 2 || (parseInt(entry.quantity, 10) || 0) <= 0) continue;
        var uid = String(entry.uniqueId || '');
        if (uid && uid !== '0') result.uids[uid] = true;
    }
    return result;
}

function firstNewUid(current, baseline) {
    current = current || {};
    baseline = baseline || {};
    var keys = Object.keys(current);
    for (var i = 0; i < keys.length; i++) {
        if (baseline[keys[i]] !== true) return keys[i];
    }
    return '';
}

function completeAutoBossRound(source, detectedUid) {
    if (g_bossState !== 'waitingBox') return false;
    var completedTarget = g_bossTarget;
    g_bossCompletedCount++;
    g_bossState = 'cooldown';
    g_bossStageQueued = false;
    g_bossWaitStartedAt = 0;
    g_bossNextActionAt = Date.now() + 1500;
    g_bossNextInventoryCheckAt = 0;
    markSharedGameAction(4000);
    g_bossBoxDrainStartedAt = 0;
    g_bossLastResult = '已检测到幕首宝箱，准备下一轮';
    bossLog('检测到幕首宝箱掉落，' + (completedTarget ? completedTarget.name + ' 3-10' : '当前关卡') +
        ' 已完成，准备下一轮。');
    emit('auto_boss_round_completed', {
        target: completedTarget,
        source: source || '库存',
        detectedUid: detectedUid || '',
        completedCount: g_bossCompletedCount
    });
    return true;
}

function observeAutoBossBox(itemSnapshot, serializedSnapshot) {
    if (!g_autoBossEnabled || g_bossState !== 'waitingBox') return false;
    itemSnapshot = itemSnapshot || bossInventorySnapshot(g_lastPlacedRows);
    serializedSnapshot = serializedSnapshot || serializedActBossBoxSnapshot(scanBoxSnapshot());
    var itemUid = firstNewUid(itemSnapshot.actBossBoxUids, g_bossBaselineItemBoxUids);
    if (itemUid) return completeAutoBossRound('背包或仓库', itemUid);
    var serializedUid = firstNewUid(serializedSnapshot.uids, g_bossBaselineSerializedBoxUids);
    if (serializedUid) return completeAutoBossRound('宝箱数据', serializedUid);
    if (serializedSnapshot.count > g_bossBaselineSerializedBoxCount) {
        return completeAutoBossRound('宝箱数量', '');
    }
    return false;
}

function selectAutoBossTarget(stoneCounts) {
    AUTO_BOSS_TARGET_PRIORITY.forEach(function (name) {
        if (!(stoneCounts[name] > 0) || !challengeTargetRule(name).enabled) delete g_bossAdmittedStoneTypes[name];
    });
    for (var i = 0; i < AUTO_BOSS_TARGET_PRIORITY.length; i++) {
        var name = AUTO_BOSS_TARGET_PRIORITY[i];
        var count = stoneCounts[name] || 0;
        var rule = challengeTargetRule(name);
        if (count <= 0 || !rule.enabled) continue;
        if (count > rule.minCount)
            return AUTO_BOSS_TARGETS[name];
    }
    return null;
}

function resetAutoBossState() {
    g_bossStageQueued = false;
    g_bossState = 'idle';
    g_bossBlockedBoxSignature = '';
    g_bossTarget = null;
    g_bossWaitStartedAt = 0;
    g_bossNextActionAt = 0;
    g_bossBoxDrainStartedAt = 0;
    g_bossBaselineItemBoxUids = {};
    g_bossBaselineSerializedBoxUids = {};
    g_bossBaselineSerializedBoxCount = 0;
    g_bossLastStoneCounts = emptyAutoBossStoneCounts();
    g_bossLastResult = '';
    g_bossNoStoneLogged = false;
    g_bossCompletedCount = 0;
}

function enqueueAutoBossStage(target, itemSnapshot, serializedSnapshot) {
    if (!g_autoBossEnabled || !target || g_bossStageQueued) return false;
    if (!ensureUpdateHook()) {
        g_bossLastResult = '游戏主线程任务队列挂载失败';
        return false;
    }
    g_bossStageQueued = true;
    g_bossState = 'queued';
    g_bossTarget = target;
    g_queue.push({
        action: 'bossStageEnter',
        target: target,
        baselineItemBoxUids: itemSnapshot.actBossBoxUids,
        baselineSerializedBoxUids: serializedSnapshot.uids,
        baselineSerializedBoxCount: serializedSnapshot.count,
        at: Date.now()
    });
    g_bossLastResult = '已加入关卡进入队列：' + target.name + ' 3-10';
    return true;
}

function processAutoBossStageQueueItem(item) {
    if (!g_autoBossEnabled) {
        g_bossStageQueued = false;
        g_bossState = 'idle';
        return;
    }
    var target = item && item.target;
    if (!target) throw new Error('自动打Boss目标关卡为空');
    var stageBeforeEntry = currentAutoBossStage();
    if (currentStageIsBossOrPumpkin(stageBeforeEntry)) {
        g_bossStageQueued = false;
        g_bossState = 'idle';
        g_bossTarget = null;
        g_bossLastResult = '当前已在 Boss 或南瓜灯峡谷关卡，取消重复挑战请求';
        return;
    }
    scanInventory();
    var freshStoneCounts = bossInventorySnapshot(g_lastPlacedRows).stoneCounts;
    var targetName = '';
    AUTO_BOSS_TARGET_PRIORITY.some(function (name) {
        if (AUTO_BOSS_TARGETS[name].stageKey === target.stageKey) { targetName = name; return true; }
        return false;
    });
    if (!targetName || freshStoneCounts[targetName] <= challengeTargetRule(targetName).minCount) {
        g_bossStageQueued = false;
        g_bossState = 'idle';
        g_bossTarget = null;
        g_bossLastResult = '门票数量已低于严格触发条件，取消过期挑战';
        return;
    }
    var bridge = resolveAutoBossStageBridge();
    var cachePtr = bridge.cacheByKey.fn(target.stageKey, bridge.cacheByKey.mi);
    var actual = readAutoBossStageInfo(cachePtr);
    if (!autoBossStageMatches(actual, target)) {
        throw new Error('关卡缓存校验失败，已阻止进入错误关卡；actual=' +
            JSON.stringify(actual) + '；expected=' + JSON.stringify(target));
    }
    var enterResult = bridge.validateEnter.fn(cachePtr, bridge.validateEnter.mi);
    // EStageEnterResultType.FailReasonNeedChestSpace, verified from game metadata.
    if ((enterResult | 0) === 3) {
        pauseAutoBossForBoxSpace(scanBoxSnapshot());
        return;
    }
    if ((enterResult | 0) !== 0) {
        throw new Error('关卡进入条件检查未通过，返回码=' + (enterResult | 0));
    }
    var callback = bridge.current ? nativeAutoBossEntryCallback(bridge) : ptr(0);
    if (bridge.current) rememberAutoBossReturnStage(target);
    if (bridge.current) g_bossProgrammaticEntryUntil = Date.now() + 30000;
    recordMapSwitchDispatch();
    bridge.enterStage.fn(cachePtr, callback, bridge.enterStage.mi);
    if (bridge.current && !autoBossStageMatches(currentAutoBossStage(), target)) {
        var afterEntryStage = null;
        try { afterEntryStage = currentAutoBossStage(); } catch (stageError) { afterEntryStage = {error:chineseError(stageError)}; }
        cancelAutoBossReturn('Boss 原生进入事务未成功');
        throw new Error('游戏未确认 Boss 进入事务；current=' + JSON.stringify(afterEntryStage) +
            '；expected=' + JSON.stringify(target));
    }
    if (bridge.enterScene) bridge.enterScene.fn(target.stageKey, bridge.enterScene.mi);
    AUTO_BOSS_TARGET_PRIORITY.forEach(function (name) {
        if (AUTO_BOSS_TARGETS[name].stageKey === target.stageKey) g_bossAdmittedStoneTypes[name] = true;
    });
    g_bossStageQueued = false;
    g_bossState = 'waitingBox';
    g_bossTarget = target;
    g_bossWaitStartedAt = Date.now();
    g_bossNextInventoryCheckAt = Date.now() + g_ticketCheckIntervalMs;
    g_bossBaselineItemBoxUids = item.baselineItemBoxUids || {};
    g_bossBaselineSerializedBoxUids = item.baselineSerializedBoxUids || {};
    g_bossBaselineSerializedBoxCount = Math.max(0, parseInt(item.baselineSerializedBoxCount, 10) || 0);
    g_bossLastResult = '已进入 ' + target.name + ' 3-10，等待幕首宝箱';
    bossLog('已进入 ' + target.name + ' 3-10，等待检测幕首宝箱掉落。');
    emit('auto_boss_stage_entered', {
        target: target,
        stoneCounts: g_bossLastStoneCounts,
        completedCount: g_bossCompletedCount
    });
}

function pauseAutoBossForBoxSpace(snapshot) {
    g_bossStageQueued = false;
    g_bossTarget = null;
    g_bossWaitStartedAt = 0;
    g_bossBoxDrainStartedAt = 0;
    g_bossState = 'blockedBoxSpace';
    g_bossBlockedBoxSignature = boxSnapshotSignature(snapshot);
    g_bossLastResult = '宝箱位置已满，等待定时开箱或手动腾出宝箱位置';
    bossLog(g_bossLastResult + '；当前宝箱 ' + snapshot.total + ' 个。');
    emit('auto_boss_box_space', { enterResult: 3, autoOpenBoxes: g_autoOpenBoxes,
        boxCount: snapshot.total, quantities: snapshot.quantities,
        plagueQuantities: snapshot.plagueQuantities, phase: g_cyclePhase });
}

function runAutoBossPass(rows) {
    if (!g_autoBossEnabled) return '自动打Boss开关已关闭';
    if (typeof g_eventDungeonContext !== 'undefined' && g_eventDungeonContext)
        return '南瓜灯峡谷流程未结束，暂停进入 Boss';
    var now = Date.now();
    if (g_bossState !== 'waitingBox' && g_bossState !== 'queued' &&
            now < g_bossNextInventoryCheckAt) return g_bossLastResult;
    g_bossNextInventoryCheckAt = now + g_ticketCheckIntervalMs;
    var itemSnapshot = bossInventorySnapshot(g_lastPlacedRows);
    var allBoxesSnapshot = scanBoxSnapshot();
    var serializedSnapshot = serializedActBossBoxSnapshot(allBoxesSnapshot);
    g_bossLastStoneCounts = itemSnapshot.stoneCounts;
    if (g_bossState === 'blockedBoxSpace') {
        if (boxSnapshotSignature(allBoxesSnapshot) === g_bossBlockedBoxSignature)
            return g_bossLastResult;
        g_bossState = 'idle';
        g_bossBlockedBoxSignature = '';
    }
    if (observeAutoBossBox(itemSnapshot, serializedSnapshot)) return g_bossLastResult;
    if (g_bossState === 'waitingBox') {
        if (g_bossWaitStartedAt > 0 && now - g_bossWaitStartedAt >= g_bossWaitTimeoutMs) {
            var timedOutTarget = g_bossTarget;
            g_bossState = 'cooldown';
            g_bossStageQueued = false;
            g_bossTarget = null;
            g_bossWaitStartedAt = 0;
            g_bossNextActionAt = now + 1000;
            g_bossBoxDrainStartedAt = 0;
            g_bossBaselineItemBoxUids = {};
            g_bossBaselineSerializedBoxUids = {};
            g_bossBaselineSerializedBoxCount = 0;
            g_bossLastResult = '等待章节首领宝箱超过 30 秒，正在重新扫描灵魂石';
            bossLog('等待章节首领宝箱超过 30 秒，已结束本轮等待并重新扫描灵魂石。');
            emit('auto_boss_wait_timeout', {
                target: timedOutTarget,
                waitMs: g_bossWaitTimeoutMs,
                stoneCounts: g_bossLastStoneCounts,
                timedOutAt: now
            });
            return g_bossLastResult;
        }
        return g_bossLastResult;
    }
    var liveStage = currentAutoBossStage();
    if (currentStageIsBossOrPumpkin(liveStage) && g_bossState !== 'waitingBox') {
        g_bossLastResult = '当前位于 Boss 或南瓜灯峡谷，等待游戏自动结算；不重复提交挑战';
        return g_bossLastResult;
    }
    if (g_bossReturnContext) {
        var record = g_bossReturnContext;
        var current = currentAutoBossStage();
        if (!autoBossSeriesActive(record) || !current ||
                (current.stageType !== 0 && current.stageType !== 2) ||
                (!autoBossStageMatches(current, record.origin) &&
                 current.stageKey !== record.fallbackNormalStageKey)) {
            g_bossLastResult = '等待当前 Boss 结算与游戏原生返回';
            return g_bossLastResult;
        }
    }
    if (g_bossState === 'queued') return g_bossLastResult;
    // Box opening is scheduled independently; Boss progression never starts
    // an immediate post-battle box-cleanup pass.
    if (now < g_bossNextActionAt) return g_bossLastResult;
    if (sharedGameActionWaiting() || synthesisInventoryMutationActive() ||
            boxInventoryMutationActive() || g_queue.length || hasQueuedBoxOpen()) {
        g_bossLastResult = '等待合成或开箱结束后再进入关卡';
        return g_bossLastResult;
    }
    var target = selectAutoBossTarget(itemSnapshot.stoneCounts);
    if (!target) {
        if (g_bossReturnContext) {
            g_bossReturnContext.roundsFinished = true;
            g_bossReturnContext.cycleYielded = true;
            scheduleAutoBossReturnCheck();
        }
        g_bossState = 'idle';
        g_bossTarget = null;
        g_bossLastResult = '所选 Boss 目标的灵魂石尚未达到各自门槛';
        if (!g_bossNoStoneLogged) {
            g_bossNoStoneLogged = true;
            bossLog(g_bossLastResult + '；已达标的批次已处理完毕。');
        }
        return g_bossLastResult;
    }
    g_bossNoStoneLogged = false;
    if (enqueueAutoBossStage(target, itemSnapshot, serializedSnapshot)) {
        bossLog('检测到' + target.name + '灵魂石，准备进入 ' + target.name + ' 3-10。');
    }
    return g_bossLastResult;
}

function currentPlacementSources(uid) {
    uid = String(uid || '');
    var result = [];
    if (!uid || uid === '0') return result;
    var player = findPlayerSaveData();
    if (isObviouslyInvalidPtr(player)) return result;
    var playerInfo = classInfo('TaskbarHero', 'PlayerSaveData');
    function scanList(fieldName, className, sourceName) {
        if (playerInfo.fields[fieldName] == null) return;
        var list = player.add(playerInfo.fields[fieldName]).readPointer();
        var entries = readListObjects(list);
        var info = classInfo('TaskbarHero.EasySaveData', className);
        var uidOffset = firstFieldOffset(info.fields, ['ItemUniqueId', 'itemUniqueId', 'UniqueId', 'uniqueId']);
        var indexOffset = firstFieldOffset(info.fields, ['Index', 'index', 'SlotIndex', 'slotIndex']);
        var quantityOffset = firstFieldOffset(info.fields, ['Quantity','quantity']);
        if (uidOffset == null) return;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (isObviouslyInvalidPtr(entry)) continue;
            if (readU64Text(entry.add(uidOffset)) !== uid) continue;
            var index = indexOffset == null ? i : entry.add(indexOffset).readS32();
            result.push({source:sourceName,index:index,
                quantity:quantityOffset==null?1:Math.max(1,entry.add(quantityOffset).readS32())});
        }
    }
    scanList('inventorySaveDatas', 'InventorySaveData', '背包');
    scanList('stashSaveDatas', 'StashSaveData', '仓库');
    return result;
}

function backpackSourceForDeposit(row) {
    var sources = row && row.sources || [];
    var backpack = null;
    for (var i = 0; i < sources.length; i++) {
        if (sources[i].source === '背包' && !backpack) backpack = sources[i];
    }
    if (!backpack) return null;
    return {
        source: '背包',
        slotType: 1,
        index: Number(backpack.index) | 0,
        quantity: Math.max(1, parseInt(backpack.quantity, 10) || 1)
    };
}

function autoDepositCandidate(row) {
    if (!row) return false;
    if((g_depositRejectedUids[String(row.uid)]||0)>Date.now()) return false;
    if (g_tradeShipQueuedUids[String(row.uid)]) return false;
    var explicitlyConfigured = g_extraDepositItemIdSet[String(row.itemKey)] === true;
    var runtimeUnsynthable = row.runtimeInfo && row.synthable !== true;
    if (!g_autoDepositAllItems && !explicitlyConfigured && !runtimeUnsynthable) return false;
    if (!row.placed || (!g_autoDepositAllItems && row.locked) || row.equipped || row.serverPending || row.deletedInServer ||
        row.temporaryBlocked || recentlyConsumedUid(row.uid)) return false;
    return backpackSourceForDeposit(row) != null;
}

function currentFullBackpackDepositCandidate(row) {
    if (!row || !row.placed || row.equipped || row.serverPending ||
            row.deletedInServer || row.temporaryBlocked || recentlyConsumedUid(row.uid) ||
            g_tradeShipQueuedUids[String(row.uid)]) return false;
    if((g_depositRejectedUids[String(row.uid)]||0)>Date.now()) return false;
    return backpackSourceForDeposit(row) != null;
}

function autoDepositReason(row) {
    if (!row) return '游戏标记为不可合成';
    if (row.fullBackpackDeposit) return '背包已满，按顺序清仓';
    if (g_extraDepositItemIdSet[String(row.itemKey)] === true) return '存仓参数指定';
    if (g_autoDepositAllItems) return '定时存放背包物品';
    if (row.synthesisType === 3) return '物品类型不可合成';
    if (row.gradeValue === 9) return '宇宙品质不可合成';
    return '游戏运行时标记为不可合成';
}

function autoDepositItemLabel(row) {
    var parts = [];
    if (row && row.category) parts.push(row.category);
    if (row && row.grade) parts.push(row.grade);
    parts.push('物品键=' + (row && row.itemKey || 0));
    parts.push('唯一编号=' + (row && row.uid || '0'));
    return parts.join('，');
}

function orderedStashTarget(bridge) {
    if (bridge.current) scanInventory();
    var flatIndex = bridge.firstEmptyIndex.fn(bridge.firstEmptyIndex.mi);
    var target = stashTargetFromFlatIndex(flatIndex);
    if (!target) return null;
    var gamePage = bridge.pageFromIndex.fn(flatIndex, bridge.pageFromIndex.mi);
    if (gamePage !== target.pageIndex) {
        throw new Error('仓库空位页校验失败，已阻止存入错误仓库');
    }
    return target;
}

function resetFullBackpackDepositState() {
    g_fullBackpackDepositActive = false;
    g_fullBackpackDepositQueued = false;
    g_fullBackpackDepositWaiting = false;
    g_fullBackpackDepositPage = 0;
    g_fullBackpackDepositBeforeCount = 0;
    g_fullBackpackDepositRequestedAt = 0;
    g_fullBackpackDepositMovedCount = 0;
    g_fullBackpackDepositNextActionAt = 0;
    g_fullBackpackDepositQueuedAt = 0;
}

function finishFullBackpackDeposit(remainingCount, completed) {
    var movedCount = g_fullBackpackDepositMovedCount;
    resetFullBackpackDepositState();
    g_depositQueued = false;
    g_lastDepositAt = Date.now();
    if (completed) {
        g_fullBackpackDepositRetryAt = 0;
        g_lastDepositResult = '满包清仓完成，共存入 ' + movedCount + ' 件物品';
        depositLog('满包清仓完成：已按仓库 1 到 7 的顺序存入 ' + movedCount + ' 件物品。');
    } else {
        g_fullBackpackDepositRetryAt = Date.now() + 60000;
        g_lastDepositResult = '7 个仓库已依次处理，背包仍有 ' + remainingCount + ' 件物品';
        depositLog('满包清仓结束：已按顺序检查 7 个仓库，背包仍有 ' + remainingCount +
            ' 件物品；仓库已满或剩余物品不允许存入。');
    }
    emit('auto_deposit_full_backpack_completed', {
        success: completed,
        movedCount: movedCount,
        remainingCount: remainingCount,
        pageCount: STASH_PAGE_COUNT,
        depositCount: g_depositCount
    });
    return g_lastDepositResult;
}

function processFullBackpackDepositQueueItem(item) {
    if (!g_fullBackpackDepositActive) {
        g_fullBackpackDepositQueued = false;
        g_depositQueued = false;
        return;
    }
    var now = Date.now();
    if (item.notBefore && now < item.notBefore) {
        g_queue.unshift(item);
        return;
    }
    var page = item.page | 0;
    if (page < 0 || page >= STASH_PAGE_COUNT) throw new Error('满包清仓仓库页超出 1 到 7 范围');
    var bridge = resolveFullBackpackDepositBridge();
    if (item.phase !== 'deposit') {
        var remakeStash = findRemakeStashUi(bridge);
        bridge.switchPage.fn(remakeStash, page, bridge.switchPage.mi);
        var currentPage = remakeStash.add(bridge.currentPageOffset).readS32();
        if (currentPage !== page) throw new Error('切换仓库页失败，已阻止向错误仓库存入');
        item.phase = 'deposit';
        item.notBefore = now + 100;
        g_queue.unshift(item);
        return;
    }

    var moveManagerType = bridge.current ? 'sj' : 'ra';
    var moveManagerInfo = classInfo('', moveManagerType);
    var moveManager = moveManagerInfo.klass && !moveManagerInfo.klass.isNull()
        ? findStaticSingleton(moveManagerInfo.klass, moveManagerType)
        : ptr(0);
    if (isObviouslyInvalidPtr(moveManager)) throw new Error('物品移动管理器尚未初始化');
    bridge.depositAll.fn(moveManager, 1, 2, bridge.depositAll.mi);
    g_fullBackpackDepositQueued = false;
    g_fullBackpackDepositQueuedAt = 0;
    g_fullBackpackDepositWaiting = true;
    g_fullBackpackDepositBeforeCount = Math.max(0, item.beforeCount | 0);
    g_fullBackpackDepositRequestedAt = now;
    g_lastDepositResult = '已对仓库 ' + (page + 1) + ' 执行一键存仓，等待库存确认';
    depositLog('满包清仓：已对仓库 ' + (page + 1) + ' 执行一键存仓。');
    emit('auto_deposit_full_backpack_requested', {
        page: page + 1,
        beforeCount: g_fullBackpackDepositBeforeCount,
        requestedAt: now
    });
}

function runFullBackpackDepositPass() {
    var counts = g_lastSourceCounts || {};
    var backpackCount = Math.max(0, counts.backpack | 0);
    var now = Date.now();
    if (!g_fullBackpackDepositActive) {
        if (!counts.backpackFull) return '';
        if (now < g_fullBackpackDepositRetryAt) return '满包一键存仓等待重试';
        g_fullBackpackDepositActive = true;
        g_fullBackpackDepositPage = 0;
        g_fullBackpackDepositMovedCount = 0;
        g_fullBackpackDepositNextActionAt = now;
        g_lastDepositResult = '检测到背包已满，准备按仓库 1 到 7 的顺序一键存仓';
        depositLog('检测到背包已满，开始按仓库 1 到 7 的顺序执行一键存仓。');
    }

    if (g_fullBackpackDepositWaiting) {
        if (backpackCount < g_fullBackpackDepositBeforeCount) {
            var moved = g_fullBackpackDepositBeforeCount - backpackCount;
            g_fullBackpackDepositMovedCount += moved;
            g_depositCount += moved;
            g_lastDepositAt = now;
            g_fullBackpackDepositWaiting = false;
            g_depositQueued = false;
            if (backpackCount <= 0) return finishFullBackpackDeposit(0, true);
            g_fullBackpackDepositPage++;
            g_fullBackpackDepositNextActionAt = now + 500;
        } else if (now - g_fullBackpackDepositRequestedAt >= g_fullBackpackDepositConfirmMs) {
            g_fullBackpackDepositWaiting = false;
            g_depositQueued = false;
            g_fullBackpackDepositPage++;
            g_fullBackpackDepositNextActionAt = now + 200;
        } else {
            return '等待仓库 ' + (g_fullBackpackDepositPage + 1) + ' 的一键存仓结果';
        }
    }

    if (g_fullBackpackDepositPage >= STASH_PAGE_COUNT) {
        return finishFullBackpackDeposit(backpackCount, backpackCount <= 0);
    }
    var freeByPage = counts.stashFreeByPage || [];
    g_fullBackpackDepositPage = nextStashPageWithSpace(freeByPage, g_fullBackpackDepositPage);
    if (g_fullBackpackDepositPage >= STASH_PAGE_COUNT) {
        return finishFullBackpackDeposit(backpackCount, backpackCount <= 0);
    }
    if (g_fullBackpackDepositQueued && now - g_fullBackpackDepositQueuedAt >= 10000) {
        var queuedAction = g_queue.some(function (item) {
            return item.action === 'fullBackpackDeposit';
        });
        if (queuedAction) {
            ensureUpdateHook();
            depositLog('满包清仓任务等待游戏主线程超过 10 秒，已重新确认执行入口。');
        } else {
            g_fullBackpackDepositQueued = false;
            g_depositQueued = false;
            depositLog('满包清仓队列状态异常，已重新安排当前仓库页。');
        }
        g_fullBackpackDepositQueuedAt = now;
    }
    if (g_fullBackpackDepositQueued || now < g_fullBackpackDepositNextActionAt) {
        return g_lastDepositResult;
    }
    if (g_queue.length || g_synthesisBatchQueued || g_synthesisCleanupQueued ||
            g_pendingSynthesisSignature || g_boxOpenInFlight || g_bossStageQueued) {
        return '满包清仓正在等待其他游戏操作完成';
    }
    if (!ensureUpdateHook()) {
        g_lastDepositResult = '游戏主线程任务队列挂载失败';
        return g_lastDepositResult;
    }
    g_fullBackpackDepositQueued = true;
    g_fullBackpackDepositQueuedAt = now;
    g_depositQueued = true;
    g_queue.push({
        action: 'fullBackpackDeposit',
        phase: 'switchPage',
        page: g_fullBackpackDepositPage,
        beforeCount: backpackCount,
        at: now
    });
    g_lastDepositResult = '已安排仓库 ' + (g_fullBackpackDepositPage + 1) + ' 的一键存仓';
    depositLog('满包清仓：已将仓库 ' + (g_fullBackpackDepositPage + 1) + ' 的一键存仓加入游戏主线程队列。');
    return g_lastDepositResult;
}

function processAutoDepositQueueItem(item) {
    if (item) item.failureStage = '核对候选物品';
    var row = item && item.row;
    if (!row || !row.uid) throw new Error('自动存仓候选物品无效');
    item.failureStage = '核对背包来源';
    item.failureContext = {
        uid: String(row.uid),
        itemKey: Number(row.itemKey || 0),
        category: row.category || '',
        grade: row.grade || ''
    };
    var source = backpackSourceForDeposit(row);
    if (!source) {
        g_depositQueued = false;
        g_lastDepositResult = '候选物品已经不在背包，将重新扫描';
        return;
    }
    var beforeSources = currentPlacementSources(row.uid);
    var currentBackpack = beforeSources.filter(function (entry) {
        return entry.source === '背包' && entry.index === source.index;
    })[0];
    if (!currentBackpack) {
        g_depositQueued = false;
        g_lastDepositResult = '候选物品位置已经变化，将重新扫描';
        return;
    }
    source.quantity=currentBackpack.quantity;

    item.failureStage = '解析游戏存仓接口';
    var bridge = resolveAutoDepositBridge();
    item.failureStage = '查找目标仓库';
    var target = orderedStashTarget(bridge);
    if (!target) {
        g_depositQueued = false;
        g_depositBatchActive = false;
        g_lastDepositAt = Date.now();
        g_lastDepositResult = '7 个仓库均已满，等待出现空位';
        if (Date.now() - g_lastDepositFullLogAt >= 60000) {
            g_lastDepositFullLogAt = Date.now();
            depositLog('自动存仓暂停：7 个仓库均已满。');
        }
        return;
    }
    var flatIndex = target.flatIndex;
    var pageIndex = target.pageIndex;
    item.failureContext.sourceIndex = source.index;
    item.failureContext.targetPage = pageIndex + 1;
    item.failureContext.targetSlot = (flatIndex % STASH_PAGE_SIZE) + 1;
    item.failureStage = '请求游戏移动物品';
    var added = false, removed = false, requestError = null;
    if (bridge.current) {
        var managerInfo = classInfo('', 'sj');
        var manager = managerInfo.klass && !managerInfo.klass.isNull()
            ? findStaticSingleton(managerInfo.klass, 'sj') : ptr(0);
        if (isBadPtr(manager)) throw new Error('物品移动管理器尚未初始化');
        var request = createNativeMoveRequest(source, 2, flatIndex, 1); // ESlotType.STASH / EMoveType.DIRECT
        try {
            bridge.moveRequest.fn(manager, request, resolveMoveResultCallback(), bridge.moveRequest.mi);
        } catch (moveError) {
            requestError = moveError;
            item.failureStage = '游戏移动请求返回异常';
            item.failureContext.requestError = chineseError(moveError);
        }
    } else {
        var nativeUid = uint64(String(row.uid));
        added = bridge.addToPage.fn(pageIndex, nativeUid, bridge.addToPage.mi);
        if (!added) {
            g_depositQueued = false;
            g_lastDepositResult = '目标仓库空位发生变化，将重新扫描';
            return;
        }
        removed = bridge.removeFromInventory.fn(nativeUid, bridge.removeFromInventory.mi);
    }
    g_depositPending={row:row,source:source,flatIndex:flatIndex,pageIndex:pageIndex,
        at:Date.now(),deadlineAt:Date.now()+10000,
        beforeBackpack:placementQuantity(beforeSources,'背包'),
        beforeStash:placementQuantity(beforeSources,'仓库'),
        requestError:requestError?chineseError(requestError):''};
    verifyAutoDepositPending();
}

function placementQuantity(sources, location) {
    return sources.reduce(function(total,entry){return total+(entry.source===location?(entry.quantity||1):0);},0);
}

function depositMovementConfirmed(pending, afterSources) {
    return placementQuantity(afterSources,'背包')<=pending.beforeBackpack-pending.source.quantity &&
        placementQuantity(afterSources,'仓库')>=pending.beforeStash+pending.source.quantity;
}

function verifyAutoDepositPending() {
    var pending=g_depositPending;
    if(!pending) {g_depositQueued=false;return;}
    var row=pending.row,source=pending.source,flatIndex=pending.flatIndex,pageIndex=pending.pageIndex;
    var afterSources=currentPlacementSources(row.uid);
    var bagAfter=placementQuantity(afterSources,'背包'),stashAfter=placementQuantity(afterSources,'仓库');
    var confirmed=depositMovementConfirmed(pending,afterSources);
    if(!confirmed) {
        if(Date.now()>=pending.deadlineAt || (pending.requestError && Date.now()-pending.at>=500)) {
            g_depositPending=null;
            throw new Error(pending.requestError||('存仓未确认：背包 '+pending.beforeBackpack+'→'+bagAfter+
                '，仓库 '+pending.beforeStash+'→'+stashAfter+'；本轮跳过该物品'));
        }
        g_queue.push({action:'depositVerify',row:row,at:Date.now(),deferUntil:Date.now()+250});
        g_lastDepositResult='已提交存仓，等待本账号背包/仓库数量确认';
        return;
    }
    g_depositPending=null;
    g_depositQueued = false;
    g_depositCount++;
    g_depositConsecutiveFailures = 0;
    g_depositRetryAt = 0;
    g_lastDepositAt = Date.now();
    g_lastDepositResult = '已存入仓库 ' + (pageIndex + 1) + ' 第 ' + ((flatIndex % STASH_PAGE_SIZE) + 1) + ' 格';
    depositLog('自动存仓完成：' + autoDepositItemLabel(row) + '，原因=' + autoDepositReason(row) +
        '，从背包第 ' + (source.index + 1) + ' 格移入仓库 ' + (pageIndex + 1) +
        ' 第 ' + ((flatIndex % STASH_PAGE_SIZE) + 1) + ' 格。');
    emit('auto_deposit_completed', {
        uid: row.uid,
        itemKey: row.itemKey,
        reason: autoDepositReason(row),
        backpackIndex: source.index,
        stashPage: pageIndex + 1,
        stashSlot: (flatIndex % STASH_PAGE_SIZE) + 1,
        stashFlatIndex: flatIndex,
        depositCount: g_depositCount
    });
}

function runAutoDepositPass(reason, scannedRows) {
    if (!g_autoDepositUnsynthable) return '自动存仓开关已关闭';
    var now = Date.now();
    if (now < g_depositRetryAt) return '自动存仓等待重试';
    if (g_tradeShipPending || g_tradeShipQueued) return '等待自动交易船确认完成';
    var emergencyDeposit = g_currentFullBagClearing || g_fullBackpackDepositActive ||
        (g_lastSourceCounts || {}).backpackFull === true;
    if (!g_depositBatchActive) {
        if (!emergencyDeposit && g_lastDepositAt > 0 && now - g_lastDepositAt < g_depositCooldownMs)
            return '自动存仓等待设定间隔';
        g_depositBatchActive = true;
    }
    var currentBuild = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT;
    // Current builds use the direct per-item MoveRequest path and keep the
    // game stash window closed; the old bulk UI routine stays legacy-only.
    var fullBackpackResult = currentBuild ? null : runFullBackpackDepositPass();
    if (g_fullBackpackDepositActive || fullBackpackResult) return fullBackpackResult;
    if (g_depositQueued) return '自动存仓任务正在执行';
    if (g_queue.length || g_synthesisBatchQueued || g_synthesisCleanupQueued ||
            g_pendingSynthesisSignature || g_boxOpenInFlight) {
        return '等待其他游戏操作完成';
    }
    if (!scannedRows) scanInventory();
    var counts = g_lastSourceCounts || {};
    if (currentBuild && counts.backpackFull && !g_currentFullBagClearing) {
        g_currentFullBagClearing = true;
        depositLog('检测到背包已满，按仓库空位顺序逐件存入并核对唯一编号。');
    }
    if (currentBuild && g_currentFullBagClearing && (counts.backpack | 0) <= 0) {
        g_currentFullBagClearing = false;
        depositLog('满包清仓完成：背包已清空。');
    }
    var candidates = g_currentFullBagClearing
        ? (g_lastPlacedRows || []).filter(currentFullBackpackDepositCandidate)
        : (g_lastPlacedRows || []).filter(autoDepositCandidate);
    if (g_currentFullBagClearing) {
        candidates.forEach(function (row) { row.fullBackpackDeposit = true; });
    }
    candidates.sort(function (a, b) {
        var sourceA = backpackSourceForDeposit(a);
        var sourceB = backpackSourceForDeposit(b);
        return (sourceA.index - sourceB.index) || (a.itemKey - b.itemKey) || String(a.uid).localeCompare(String(b.uid));
    });
    g_lastDepositCandidateCount = candidates.length;
    if (!candidates.length) {
        g_lastDepositResult = '本账号背包中没有可存入仓库的物品';
        g_depositBatchActive = false;
        g_lastDepositAt = Date.now();
        return g_lastDepositResult;
    }
    if (!ensureUpdateHook()) {
        g_lastDepositResult = '游戏主线程任务队列挂载失败';
        return g_lastDepositResult;
    }
    g_depositQueued = true;
    g_queue.push({ action: 'depositItem', row: candidates[0], reason: reason || '', at: Date.now() });
    g_lastDepositResult = '已加入自动存仓队列：' + autoDepositItemLabel(candidates[0]);
    return g_lastDepositResult;
}

function setMarketPrices(payloadJson) {
    var payload = {};
    try { payload = JSON.parse(payloadJson || '{}'); } catch (e) { payload = {}; }
    var sourceItems = payload && payload.items || {};
    var incomingUpdatedAt = parseInt(payload.updatedAt, 10) || 0;
    if (incomingUpdatedAt > 0 && g_marketPriceUpdatedAt > incomingUpdatedAt) {
        return JSON.stringify({success:false, itemCount:g_marketPriceItemCount,
            preservedPreviousPrices:true, reason:'stale-price-snapshot'});
    }
    var nextItems = payload.replaceCache === true ? {} : Object.assign({}, g_marketPriceItems || {});
    Object.keys(sourceItems).forEach(function (itemId) {
        var source = sourceItems[itemId];
        var priceCny = 0;
        var marketName = '';
        var priceSource = '';
        var resolved = false;
        if (Array.isArray(source)) {
            priceCny = Number(source[0] || 0);
            marketName = String(source[1] || '');
            priceSource = String(source[2] || '');
            resolved = true;
        } else if (source && typeof source === 'object') {
            priceCny = Number(source.priceCny || source.price || 0);
            marketName = String(source.marketName || '');
            priceSource = String(source.priceSource || '');
            resolved = source.resolved === true;
        }
        if (!resolved || !Number.isFinite(priceCny) || priceCny < 0) return;
        nextItems[String(itemId)] = {
            resolved: true,
            priceCny: priceCny,
            marketName: marketName,
            priceSource: priceSource,
            quoteUpdatedAt: String(source.quoteUpdatedAt || ''),
            updatedAt: Number(source.updatedAt || payload.updatedAt || Math.floor(Date.now() / 1000)),
            rawPrice: Number(source.rawPrice || 0),
            rawCurrency: String(source.rawCurrency || ''),
            priceModel: String(payload.priceModel || '')
        };
    });
    var nextItemCount = Object.keys(nextItems).length;
    if (!nextItemCount || !Object.keys(sourceItems).length) {
        return JSON.stringify({
            success: false,
            itemCount: g_marketPriceItemCount,
            preservedPreviousPrices: g_marketPriceItemCount > 0,
            currency: 'CNY'
        });
    }
    g_marketPriceItems = nextItems;
    g_marketPriceUpdatedAt = incomingUpdatedAt || Math.floor(Date.now() / 1000);
    g_marketPriceItemCount = nextItemCount;
    g_marketPriceCnyPerUsd = Number(payload.cnyPerUsd || 0);
    tradeShipState('人民币价格已同步：' + g_marketPriceItemCount + ' 个物品');
    return JSON.stringify({
        success: g_marketPriceItemCount > 0,
        itemCount: g_marketPriceItemCount,
        updatedAt: g_marketPriceUpdatedAt,
        currency: 'CNY'
    });
}

function tradeShipSource(row) {
    var sources = row && row.sources || [];
    for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i] || {};
            if (pass === 0 && source.source === '背包') {
                return { slotType: 1, source: '背包', index: source.index | 0,
                    quantity: Math.max(1, parseInt(source.quantity, 10) || 1) };
            }
            if (pass === 1 && source.source === '仓库') {
                return { slotType: 2, source: '仓库', index: source.index | 0,
                    quantity: Math.max(1, parseInt(source.quantity, 10) || 1) };
            }
            if (pass === 2 && source.source === '材料仓库') {
                return { slotType: 6, source: '材料仓库', index: source.index | 0,
                    quantity: Math.max(1, parseInt(source.quantity, 10) || 1) };
            }
        }
    }
    return null;
}

function isAutoBossStone(itemKey) {
    itemKey = parseInt(itemKey, 10) || 0;
    return AUTO_BOSS_TARGET_PRIORITY.some(function (targetName) {
        var target = AUTO_BOSS_TARGETS[targetName];
        return target && itemKey === target.itemKey;
    });
}

function tradeShipPlacementSources(uid) {
    uid = String(uid || '');
    var result = [];
    if (!uid || uid === '0') return result;
    var player = findPlayerSaveData();
    if (isObviouslyInvalidPtr(player)) return result;
    var playerInfo = classInfo('TaskbarHero', 'PlayerSaveData');
    function scanList(fieldName, className, sourceName) {
        if (playerInfo.fields[fieldName] == null) return;
        var list = player.add(playerInfo.fields[fieldName]).readPointer();
        var entries = readListObjects(list);
        var info = classInfo('TaskbarHero.EasySaveData', className);
        var uidOffset = firstFieldOffset(info.fields, ['ItemUniqueId', 'itemUniqueId', 'UniqueId', 'uniqueId']);
        var indexOffset = firstFieldOffset(info.fields, ['Index', 'index', 'SlotIndex', 'slotIndex']);
        if (uidOffset == null) return;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (isObviouslyInvalidPtr(entry)) continue;
            if (readU64Text(entry.add(uidOffset)) !== uid) continue;
            result.push({
                source: sourceName,
                index: indexOffset == null ? i : entry.add(indexOffset).readS32()
            });
        }
    }
    scanList('inventorySaveDatas', 'InventorySaveData', '背包');
    scanList('stashSaveDatas', 'StashSaveData', '仓库');
    scanList('tradingStashSaveDatas', 'TradingStashSaveData', '交易船');
    scanList('remakeTradingStashSaveDatas', 'RemakeTradingStashSaveData', '交易船');
    return result;
}

function tradeShipWaitingContains(bridge, uid) {
    try {
        return !!bridge.waitingContains.fn(uint64(String(uid)), bridge.waitingContains.mi);
    } catch (e) {
        return false;
    }
}

function tradeShipDownloadBlocked(bridge, uid) {
    try {
        return !!bridge.downloadBlocked.fn(
            uint64(String(uid)),
            bridge.downloadBlocked.mi
        );
    } catch (e) {
        return true;
    }
}

var g_tradeShipWaitingInfoMethod = null;
function tradeShipWaitingInfo(uid) {
    var info = classInfo('', 'vf');
    var field = info.fieldInfos.bfgb;
    if (!field || field.isNull()) throw new Error('交易船等待记录字段不存在');
    var storage = Memory.alloc(PTR);
    storage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(field, storage);
    var dictionary = storage.readPointer();
    if (isObviouslyInvalidPtr(dictionary)) return null;
    var runtimeClass = il2cpp.objectGetClass(dictionary);
    if (!runtimeClass || runtimeClass.isNull()) throw new Error('交易船等待记录类型无效');
    if (!g_tradeShipWaitingInfoMethod ||
            String(g_tradeShipWaitingInfoMethod.runtimeClass) !== String(runtimeClass)) {
        var methodInfo = il2cpp.classGetMethod(
            runtimeClass,
            Memory.allocUtf8String('TryGetValue'),
            2
        );
        var methodPointer = methodPtr(methodInfo);
        if (!methodInfo || methodInfo.isNull() || !methodPointer || methodPointer.isNull()) {
            throw new Error('交易船等待记录读取入口不存在');
        }
        g_tradeShipWaitingInfoMethod = {
            runtimeClass: runtimeClass,
            mi: methodInfo,
            fn: new NativeFunction(
                methodPointer,
                'bool',
                ['pointer', 'uint64', 'pointer', 'pointer']
            )
        };
    }
    var value = Memory.alloc(0x10);
    value.writeByteArray(new Uint8Array(0x10));
    if (!g_tradeShipWaitingInfoMethod.fn(
            dictionary,
            uint64(String(uid)),
            value,
            g_tradeShipWaitingInfoMethod.mi
        )) return null;
    return {
        sourceSlotType: value.readS32(),
        targetSlotIndex: value.add(4).readS32(),
        tradingStashSlotIndex: value.add(8).readS32()
    };
}

function tradeShipCacheSavedUid(cache) {
    if (isObviouslyInvalidPtr(cache)) return '0';
    var saveData = ptr(0);
    try { saveData = cache.add(AUTO_TRADE_SHIP_BRIDGE.cacheSaveDataOffset).readPointer(); } catch (e) {}
    if (isObviouslyInvalidPtr(saveData)) return '0';
    try { return readU64Text(saveData.add(AUTO_TRADE_SHIP_BRIDGE.saveDataItemUidOffset)); }
    catch (e2) { return '0'; }
}

function tradeShipCacheOccupied(bridge, cache) {
    if (isObviouslyInvalidPtr(cache)) return false;
    try {
        return !!bridge.cacheOccupied.fn(cache, bridge.cacheOccupied.mi);
    } catch (e) {
        return false;
    }
}

function tradeShipCooldownDictionaryState(bridge, index) {
    var raw = Memory.alloc(8);
    raw.writeU64(0);
    try {
        var known = !!bridge.cooldownEndForSlot.fn(
            index | 0,
            raw,
            bridge.cooldownEndForSlot.mi
        );
        return { known: known, raw: known ? raw.readU64().toString() : '0' };
    } catch (e) {
        return { known: false, raw: '0', error: String(e) };
    }
}

function tradeShipServerTimeState(bridge) {
    try {
        var timeInfo = classInfo('', 'pv');
        if (!timeInfo.klass || timeInfo.klass.isNull()) return { known: false, raw: '0' };
        var serverTimeManager = findStaticSingleton(timeInfo.klass, 'pv');
        if (isObviouslyInvalidPtr(serverTimeManager)) {
            var singletonArgument = B.add(
                AUTO_TRADE_SHIP_BRIDGE.serverTimeSingletonArgumentRva
            ).readPointer();
            if (!isObviouslyInvalidPtr(singletonArgument)) {
                serverTimeManager = bridge.singletonGetter.fn(singletonArgument);
            }
        }
        if (isObviouslyInvalidPtr(serverTimeManager)) return { known: false, raw: '0' };
        return {
            known: true,
            raw: bridge.serverTime.fn(serverTimeManager, bridge.serverTime.mi).toString()
        };
    } catch (e) {
        return { known: false, raw: '0', error: String(e) };
    }
}

function tradeShipDateTimeGreaterThan(bridge, left, right) {
    try {
        return !!bridge.dateTimeGreaterThan.fn(
            uint64(String(left || '0')),
            uint64(String(right || '0')),
            bridge.dateTimeGreaterThan.mi
        );
    } catch (e) {
        return false;
    }
}

function tradeShipDateTimeUnixMs(rawValue) {
    var raw = Number(rawValue || 0);
    if (!isFinite(raw) || raw <= 0) return 0;
    var ticks = raw % 4611686018427387904;
    return ticks > 0 ? Math.floor((ticks - 621355968000000000) / 10000) : 0;
}

function tradeShipValidSlotCount(bridge) {
    var count = bridge.validSlotCount.fn(bridge.validSlotCount.mi) | 0;
    if (count < 1 || count > 9) {
        throw new Error('游戏原生有效交易船槽位数超出 1 至 9 的范围');
    }
    return count;
}

function tradeShipReleaseListenerState(bridge, binding) {
    var state = {
        valid: false,
        button: ptr(0),
        onClick: ptr(0),
        listenerCount: 0,
        targetMatches: false,
        methodMatches: false,
        target: ptr(0),
        methodInfo: ptr(0),
        expectedMethodInfo: ptr(0),
        reason: ''
    };
    if (!binding || isObviouslyInvalidPtr(binding.slot)) {
        state.reason = '槽位对象无效';
        return state;
    }
    try {
        state.button = binding.slot.add(AUTO_TRADE_SHIP_BRIDGE.downloadButtonOffset).readPointer();
        if (isObviouslyInvalidPtr(state.button)) {
            state.reason = 'X 按钮对象为空';
            return state;
        }
        state.onClick = state.button.add(AUTO_TRADE_SHIP_BRIDGE.buttonOnClickOffset).readPointer();
        if (isObviouslyInvalidPtr(state.onClick)) {
            state.reason = 'X 按钮事件为空';
            return state;
        }
        var calls = state.onClick.add(AUTO_TRADE_SHIP_BRIDGE.unityEventCallsOffset).readPointer();
        var runtimeCalls = isObviouslyInvalidPtr(calls) ? ptr(0) : calls.add(
            AUTO_TRADE_SHIP_BRIDGE.invokableRuntimeCallsOffset
        ).readPointer();
        if (isObviouslyInvalidPtr(runtimeCalls)) {
            state.reason = 'X 按钮运行时监听列表为空';
            return state;
        }
        state.listenerCount = runtimeCalls.add(AUTO_TRADE_SHIP_BRIDGE.managedListCountOffset).readS32();
        if (state.listenerCount !== 1) {
            state.reason = 'X 按钮监听器数量不是 1';
            return state;
        }
        var listenerItems = runtimeCalls.add(AUTO_TRADE_SHIP_BRIDGE.managedListItemsOffset).readPointer();
        if (isObviouslyInvalidPtr(listenerItems)) {
            state.reason = 'X 按钮监听器数组为空';
            return state;
        }
        var invokable = listenerItems.add(AUTO_TRADE_SHIP_BRIDGE.managedArrayItemsOffset).readPointer();
        var action = isObviouslyInvalidPtr(invokable) ? ptr(0) : invokable.add(
            AUTO_TRADE_SHIP_BRIDGE.invokableDelegateOffset
        ).readPointer();
        if (isObviouslyInvalidPtr(action)) {
            state.reason = 'X 按钮委托为空';
            return state;
        }
        state.target = action.add(AUTO_TRADE_SHIP_BRIDGE.delegateTargetOffset).readPointer();
        state.methodInfo = action.add(AUTO_TRADE_SHIP_BRIDGE.delegateMethodInfoOffset).readPointer();
        state.expectedMethodInfo = B.add(
            AUTO_TRADE_SHIP_BRIDGE.downloadListenerMethodInfoRva
        ).readPointer();
        state.targetMatches = sameNativePointer(state.target, binding.slot);
        state.methodMatches = sameNativePointer(state.methodInfo, state.expectedMethodInfo);
        state.valid = state.targetMatches && state.methodMatches;
        if (!state.valid) state.reason = 'X 按钮监听器不是当前槽位的原生清理方法';
    } catch (e) {
        state.reason = chineseError(e);
    }
    return state;
}

function tradeShipSlotUiState(bridge, binding) {
    var state = {
        binding: binding,
        index: binding && binding.index == null ? -1 : binding.index | 0,
        waitingUid: '0',
        savedUid: '0',
        cooldownKnown: false,
        cooldownEndData: '0',
        cooldownSource: '无',
        slotCooldownEndData: '0',
        dictionaryCooldownKnown: false,
        dictionaryCooldownEndData: '0',
        dictionaryCooldownNewer: false,
        cooldownNeedsApply: false,
        serverTimeKnown: false,
        serverTimeData: '0',
        slotCooldownActive: null,
        cooldownActive: null,
        downloadBlocked: null,
        cache: ptr(0),
        cacheOccupied: false,
        listener: null,
        xBackgroundActive: false,
        readyForRelease: false
    };
    if (!binding || isObviouslyInvalidPtr(binding.slot)) return state;
    try {
        state.waitingUid = readU64Text(binding.slot.add(AUTO_TRADE_SHIP_BRIDGE.slotWaitingUidOffset)) || '0';
    } catch (e) {}
    state.cache = binding.cache || authoritativeTradeShipCache(bridge, state.index);
    state.savedUid = tradeShipCacheSavedUid(state.cache) || '0';
    state.cacheOccupied = tradeShipCacheOccupied(bridge, state.cache);
    try {
        state.slotCooldownEndData = binding.slot.add(
            AUTO_TRADE_SHIP_BRIDGE.slotCooldownEndOffset
        ).readU64().toString();
        state.slotCooldownActive = !!bridge.cooldownActive.fn(
            binding.slot,
            bridge.cooldownActive.mi
        );
    } catch (e2) {}
    var dictionaryState = tradeShipCooldownDictionaryState(bridge, state.index);
    state.dictionaryCooldownKnown = dictionaryState.known;
    state.dictionaryCooldownEndData = dictionaryState.raw;
    if (state.slotCooldownEndData !== '0') {
        state.cooldownKnown = true;
        state.cooldownEndData = state.slotCooldownEndData;
        state.cooldownSource = '槽位字段';
    }
    if (dictionaryState.known && (state.slotCooldownEndData === '0' ||
            tradeShipDateTimeGreaterThan(
                bridge,
                dictionaryState.raw,
                state.slotCooldownEndData
            ))) {
        state.dictionaryCooldownNewer = state.slotCooldownEndData !== '0';
        state.cooldownKnown = true;
        state.cooldownEndData = dictionaryState.raw;
        state.cooldownSource = '服务器字典';
        state.cooldownNeedsApply = true;
    }
    var serverTimeState = tradeShipServerTimeState(bridge);
    state.serverTimeKnown = serverTimeState.known;
    state.serverTimeData = serverTimeState.raw;
    if (state.cooldownKnown && serverTimeState.known) {
        state.cooldownActive = !tradeShipDateTimeGreaterThan(
            bridge,
            serverTimeState.raw,
            state.cooldownEndData
        );
    } else if (state.cooldownKnown && state.cooldownSource === '槽位字段') {
        state.cooldownActive = state.slotCooldownActive;
    }
    state.downloadBlocked = tradeShipDownloadBlocked(bridge, state.waitingUid);
    state.listener = tradeShipReleaseListenerState(bridge, binding);
    try {
        var background = binding.slot.add(
            AUTO_TRADE_SHIP_BRIDGE.downloadButtonBackgroundOffset
        ).readPointer();
        state.xBackgroundActive = !isObviouslyInvalidPtr(background) &&
            !!bridge.gameObjectActiveSelf.fn(background, bridge.gameObjectActiveSelf.mi);
    } catch (e3) {}
    state.readyForRelease = state.cacheOccupied === true && state.cooldownKnown === true &&
        state.cooldownActive === false &&
        state.downloadBlocked === false &&
        state.listener && state.listener.valid === true;
    return state;
}

function applyTradeShipAuthoritativeCooldown(bridge, binding) {
    var state = tradeShipSlotUiState(bridge, binding);
    if (!state.cacheOccupied || !state.cooldownKnown || !state.cooldownNeedsApply) return state;
    bridge.applyCooldown.fn(
        binding.slot,
        uint64(state.cooldownEndData),
        bridge.applyCooldown.mi
    );
    var refreshed = tradeShipSlotUiState(bridge, binding);
    refreshed.cooldownApplied = true;
    return refreshed;
}

function listAuthoritativeTradeShipSlots(bridge) {
    var bindings = listTradingStashSlotBindings(bridge);
    var serverTimeState = tradeShipServerTimeState(bridge);
    var states = [];
    for (var i = 0; i < bindings.length; i++) {
        states.push(tradeShipSlotUiState(bridge, bindings[i], serverTimeState));
    }
    states.rawListCount = bindings.rawListCount;
    states.validSlotCount = bindings.validSlotCount;
    states.excludedTemplateCount = bindings.excludedTemplateCount;
    return states;
}

function firstAvailableTradeShipSlot(bridge) {
    var index = bridge.firstAvailableSlot.fn(bridge.firstAvailableSlot.mi) | 0;
    var validSlotCount = tradeShipValidSlotCount(bridge);
    return index >= 0 && index < validSlotCount ? index : -1;
}

function tradeShipDiagnosticFlag(value) {
    if (value == null) return '未知';
    return value === true ? '是' : '否';
}

function logTradeShipSlotDiagnostics(bridge, forceLog) {
    var now = Date.now();
    if (forceLog !== true && now - g_tradeShipSlotDiagnosticAt < 60000) return;
    var bindings = [];
    try { bindings = listTradingStashSlotBindings(bridge); }
    catch (e) {
        if (forceLog === true || now - g_tradeShipSlotDiagnosticAt >= 60000) {
            g_tradeShipSlotDiagnosticAt = now;
            tradeShipLog('交易船槽位诊断失败：' + chineseError(e) + '。');
        }
        return;
    }
    g_tradeShipSlotDiagnosticAt = now;
    g_tradeShipLastSlotDiagnostics = [];
    g_tradeShipLastSlotLayout = {
        rawListCount: bindings.rawListCount | 0,
        validSlotCount: bindings.validSlotCount | 0,
        excludedTemplateCount: bindings.excludedTemplateCount | 0
    };
    for (var i = 0; i < bindings.length; i++) {
        var state = tradeShipSlotUiState(bridge, bindings[i]);
        var row = {
            index: state.index,
            waitingUid: state.waitingUid,
            savedUid: state.savedUid,
            cacheOccupied: state.cacheOccupied,
            cooldownKnown: state.cooldownKnown,
            cooldownEndData: state.cooldownEndData,
            cooldownSource: state.cooldownSource,
            slotCooldownEndData: state.slotCooldownEndData,
            dictionaryCooldownKnown: state.dictionaryCooldownKnown,
            dictionaryCooldownEndData: state.dictionaryCooldownEndData,
            dictionaryCooldownNewer: state.dictionaryCooldownNewer,
            cooldownNeedsApply: state.cooldownNeedsApply,
            cooldownActive: state.cooldownActive,
            downloadBlocked: state.downloadBlocked,
            listenerCount: state.listener ? state.listener.listenerCount : 0,
            listenerMatches: state.listener ? state.listener.valid : false,
            xBackgroundActive: state.xBackgroundActive,
            readyForRelease: state.readyForRelease
        };
        g_tradeShipLastSlotDiagnostics.push(row);
        tradeShipLog('交易船第 ' + (state.index + 1) + ' 格：等待编号=' + state.waitingUid +
            '，保存编号=' + state.savedUid +
            '，缓存占用=' + (state.cacheOccupied ? '是' : '否') +
            '，冷却来源=' + state.cooldownSource +
            '，仍在冷却=' + tradeShipDiagnosticFlag(state.cooldownActive) +
            '，下载阻止=' + tradeShipDiagnosticFlag(state.downloadBlocked) +
            '，X监听器=' + (state.listener && state.listener.valid ? '匹配' : '不匹配') +
            '，可执行清理=' + (state.readyForRelease ? '是' : '否') + '。');
    }
}

function tradeShipReadOnlyDiagnostics() {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        var currentBridge = resolveCurrentTradeBridge();
        var currentView = currentTradeUiAndSlots(currentBridge);
        var currentSlots = [];
        for (var currentIndex = 0; currentIndex < currentView.validCount; currentIndex++) {
            var currentBinding = currentTradeSlot(currentBridge, currentView, currentIndex);
            var savedUid = currentTradeSavedUid(currentBinding);
            var waitingUid = currentTradeWaitingUid(currentBinding);
            var cooldownEndData = currentTradeCooldownRaw(currentBinding);
            var cooldownEndAtMs = currentTradeCooldownEndUnixMs(cooldownEndData);
            currentSlots.push({
                index: currentIndex,
                savedUid: savedUid,
                waitingUid: waitingUid,
                occupied: savedUid !== '0' || waitingUid !== '0',
                cooldownKnown: true,
                cooldownEndData: cooldownEndData,
                cooldownEndAtMs: cooldownEndAtMs,
                cooldownActive: cooldownEndAtMs > Date.now()
            });
        }
        return {
            executed: false,
            gameVersion: '2026-10-27/build26211490',
            visible: currentView.visible,
            marketPriceItemCount: g_marketPriceItemCount,
            marketPriceUpdatedAt: g_marketPriceUpdatedAt,
            marketPriceAgeSeconds: g_marketPriceUpdatedAt > 0 ?
                Math.max(0, Math.floor(Date.now() / 1000 - g_marketPriceUpdatedAt)) : null,
            cnyPerUsd: g_marketPriceCnyPerUsd,
            minPriceCny: g_tradeShipMinPriceCny,
            rawListCount: currentView.slots.length,
            validSlotCount: currentView.validCount,
            firstAvailableSlot: firstAvailableCurrentTradeSlot(currentBridge, currentView),
            slots: currentSlots
        };
    }
    var bridge = resolveAutoTradeShipBridge();
    var ui = findTradingStashUi(bridge);
    var info = tradeShipSlotListInfo(bridge, ui);
    var firstAvailableSlot = firstAvailableTradeShipSlot(bridge);
    var waitingInfoProbe = tradeShipWaitingInfo('0');
    var result = {
        executed: false,
        executionEnabled: TRADE_SHIP_X_EXECUTION_ENABLED === true,
        backendReady: true,
        rawListCount: info.rawListCount,
        validSlotCount: info.validSlotCount,
        firstAvailableSlot: firstAvailableSlot,
        excludedTemplateCount: info.excludedTemplateCount,
        waitingInfoReaderReady: waitingInfoProbe === null ||
            typeof waitingInfoProbe.tradingStashSlotIndex === 'number',
        serverTime: tradeShipServerTimeState(bridge),
        cooldownSource: '游戏原生冷却字典',
        cooldownSync: tradeShipCooldownSyncSummary(),
        validSlots: [],
        excludedTemplates: [],
        errors: []
    };
    g_tradeShipLastSlotLayout = {
        rawListCount: info.rawListCount,
        validSlotCount: info.validSlotCount,
        excludedTemplateCount: info.excludedTemplateCount
    };
    for (var i = 0; i < info.rawListCount; i++) {
        var slot = ptr(0);
        try {
            slot = info.items.add(
                AUTO_TRADE_SHIP_BRIDGE.managedArrayItemsOffset + i * PTR
            ).readPointer();
        } catch (slotError) {
            result.errors.push('读取列表第 ' + (i + 1) + ' 项失败：' + String(slotError));
        }
        if (i < info.validSlotCount) {
            try {
                var binding = strictTradingStashSlotBindingAt(bridge, info, i);
                var state = tradeShipSlotUiState(bridge, binding);
                result.validSlots.push({
                    listIndex: i,
                    slot: String(binding.slot),
                    index: binding.index,
                    slotItem: String(binding.slotItem),
                    slotCache: String(tradeShipSlotCache(binding.slot)),
                    authoritativeCache: String(binding.cache),
                    cacheUnlocked: tradeShipCacheUnlocked(binding.cache),
                    waitingUid: state.waitingUid,
                    savedUid: state.savedUid,
                    cacheOccupied: state.cacheOccupied,
                    cooldownKnown: state.cooldownKnown,
                    slotCooldownEndData: state.slotCooldownEndData,
                    dictionaryCooldownKnown: state.dictionaryCooldownKnown,
                    dictionaryCooldownEndData: state.dictionaryCooldownEndData,
                    dictionaryCooldownNewer: state.dictionaryCooldownNewer,
                    cooldownSource: state.cooldownSource,
                    cooldownEndData: state.cooldownEndData,
                    cooldownEndAtMs: tradeShipDateTimeUnixMs(state.cooldownEndData),
                    cooldownNeedsApply: state.cooldownNeedsApply,
                    cooldownActive: state.cooldownActive,
                    downloadBlocked: state.downloadBlocked,
                    xBackgroundActive: state.xBackgroundActive,
                    listenerCount: state.listener ? state.listener.listenerCount : 0,
                    listenerTarget: state.listener ? String(state.listener.target) : '0x0',
                    listenerMethodInfo: state.listener ? String(state.listener.methodInfo) : '0x0',
                    expectedListenerMethodInfo: state.listener ?
                        String(state.listener.expectedMethodInfo) : '0x0',
                    listenerMatches: state.listener ? state.listener.valid : false,
                    readyForRelease: state.readyForRelease
                });
            } catch (validError) {
                result.errors.push('有效槽位第 ' + (i + 1) + ' 格校验失败：' + String(validError));
            }
            continue;
        }
        var excluded = {
            listIndex: i,
            excludedReason: '列表索引不小于游戏原生有效槽位数',
            slot: String(slot),
            index: -1,
            slotItem: '0x0',
            slotCache: '0x0',
            authoritativeCache: '0x0',
            xBackgroundActive: false,
            listenerCount: 0,
            listenerMatches: false
        };
        if (!isObviouslyInvalidPtr(slot)) {
            try { excluded.index = slot.add(AUTO_TRADE_SHIP_BRIDGE.slotIndexOffset).readS32(); }
            catch (e1) {}
            try {
                excluded.slotItem = String(
                    slot.add(AUTO_TRADE_SHIP_BRIDGE.slotItemOffset).readPointer()
                );
            } catch (e2) {}
            try { excluded.slotCache = String(tradeShipSlotCache(slot)); } catch (e3) {}
            try {
                excluded.authoritativeCache = String(authoritativeTradeShipCache(bridge, i));
            } catch (e4) {}
            try {
                var background = slot.add(
                    AUTO_TRADE_SHIP_BRIDGE.downloadButtonBackgroundOffset
                ).readPointer();
                excluded.xBackgroundActive = !isObviouslyInvalidPtr(background) &&
                    !!bridge.gameObjectActiveSelf.fn(background, bridge.gameObjectActiveSelf.mi);
            } catch (e5) {}
            var excludedListener = tradeShipReleaseListenerState(bridge, { slot: slot });
            excluded.listenerCount = excludedListener.listenerCount;
            excluded.listenerMatches = excludedListener.valid;
        }
        result.excludedTemplates.push(excluded);
    }
    return result;
}

function pruneTradeShipRuntimeState(bridge) {
    var now = Date.now();
    Object.keys(g_tradeShipRejectedUids).forEach(function (uid) {
        if ((g_tradeShipRejectedUids[uid].retryAt || 0) <= now) delete g_tradeShipRejectedUids[uid];
    });
    Object.keys(g_tradeShipQueuedUids).forEach(function (uid) {
        var placements = tradeShipPlacementSources(uid);
        var inTradeShip = placements.some(function (entry) { return entry.source === '交易船'; });
        if (!inTradeShip && !tradeShipWaitingContains(bridge, uid)) delete g_tradeShipQueuedUids[uid];
    });
}

function autoTradeShipBaseEligible(row, allowServerPending) {
    if (!row || !row.placed || !row.runtimeInfo) return false;
    if (g_boxCapacityBlocked && !boxRecoveryBackpackRow(row)) return false;
    if (row.locked || row.equipped || (!allowServerPending && row.serverPending) ||
            row.deletedInServer || row.temporaryBlocked) return false;
    if (g_tradeShipLockedUids[String(row.uid || '')]) return false;
    if (tradeShipDeferredUntil(row.uid) > Date.now()) return false;
    if (recentlyConsumedUid(row.uid)) return false;
    if (g_autoBossEnabled && isAutoBossStone(row.itemKey)) return false;
    if (String(row.itemKey || '').slice(-3) === '900') return false;
    if (!tradeShipSource(row)) return false;
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT &&
            tradeShipPlacementSources(row.uid).length !== 1) return false;
    return true;
}

function normalizeTradeShipLockedUids(values) {
    var out = {};
    if (!Array.isArray(values)) return out;
    values.forEach(function (value) {
        var uid = String(value == null ? '' : value).trim();
        if (/^[1-9][0-9]{0,19}$/.test(uid)) out[uid] = { lockedAt: 0, source: 'saved-config' };
    });
    return out;
}

function lockTradeShipUid(uid, itemKey, reason) {
    uid = String(uid == null ? '' : uid).trim();
    if (!/^[1-9][0-9]{0,19}$/.test(uid) || g_tradeShipLockedUids[uid]) return false;
    var lockedAt = Date.now();
    g_tradeShipLockedUids[uid] = {
        itemKey: Number(itemKey) || 0,
        lockedAt: lockedAt,
        reason: String(reason || '游戏提示该商品暂时无法出售').slice(0, 120)
    };
    emit('auto_trade_ship_locked', {
        uid: uid,
        itemKey: Number(itemKey) || 0,
        lockedAt: lockedAt,
        reason: g_tradeShipLockedUids[uid].reason,
        text: '[自动交易船] 商品暂不可出售，已加入助手锁定名单：物品编号 ' +
            (Number(itemKey) || 0) + '（唯一编号 ' + uid + '）；后续交易船轮次会跳过。'
    });
    return true;
}

function parseTradeShipSaleRestriction(text) {
    text = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    var restricted = /暂时?无法出售|暂不可出售|无法交易|cannot (?:be )?(?:sold|traded)|not (?:yet )?(?:marketable|tradable)|available (?:for sale|to sell)/i.test(text);
    if (!restricted) return {restricted:false, availableAt:0, text:text.slice(0,500)};
    // Only an explicitly UTC date is accepted; never interpret it as the local zone.
    var match = /(?:可出售时间|可交易时间|available[^:：]*|marketable[^:：]*)[\s（(]*UTC[\s）):：]*([0-9]{4})[-/]([0-9]{2})[-/]([0-9]{2})\s+([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?/i.exec(text);
    var at = 0;
    if (match) {
        var parts = match.slice(1).map(function (value) { return Number(value || 0); });
        var stamp = Date.UTC(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5]);
        var date = new Date(stamp);
        if (parts[0] >= 2020 && parts[0] <= 2100 && date.getUTCFullYear() === parts[0] &&
                date.getUTCMonth() === parts[1]-1 && date.getUTCDate() === parts[2] &&
                date.getUTCHours() === parts[3] && date.getUTCMinutes() === parts[4] &&
                date.getUTCSeconds() === parts[5]) at = stamp;
    }
    return {restricted:true, availableAt:at, text:text.slice(0,500)};
}

function tradeShipAccountKey() {
    var identity = readAccountIdentity();
    return identity.accountKey || 'process:' + Process.id;
}

function normalizeTradeShipDeferredItems(values, accountKey, now) {
    var result = {};
    if (!Array.isArray(values)) return result;
    values.forEach(function (row) {
        if (!row || row.accountKey !== accountKey) return;
        var uid = String(row.uid || '');
        var availableAt = Number(row.availableAt || 0);
        if (!/^[1-9][0-9]{0,19}$/.test(uid) || !isFinite(availableAt) || availableAt <= now) return;
        if (result[uid] && result[uid].availableAt >= availableAt) return;
        result[uid] = {accountKey:accountKey, uid:uid, availableAt:availableAt,
            itemKey:Number(row.itemKey)||0, observedAt:Number(row.observedAt)||0};
    });
    return result;
}

function tradeShipDeferredUntil(uid) {
    uid = String(uid || '');
    var row = g_tradeShipDeferredItems[uid];
    if (!row) return 0;
    if (row.availableAt > Date.now()) return row.availableAt;
    delete g_tradeShipDeferredItems[uid];
    delete g_tradeShipRejectedUids[uid];
    return 0;
}

function deferTradeShipUid(pending, availableAt, warningText) {
    var uid = String(pending.uid || '');
    if (!/^[1-9][0-9]{0,19}$/.test(uid) || !isFinite(availableAt) || availableAt <= Date.now()) return false;
    var accountKey = tradeShipAccountKey();
    var previous = g_tradeShipDeferredItems[uid];
    var row = {accountKey:accountKey,uid:uid,itemKey:Number(pending.itemKey)||0,
        availableAt:availableAt,observedAt:Date.now()};
    g_tradeShipDeferredItems[uid] = row;
    // A server-provided deadline replaces an older assistant-only permanent lock.
    delete g_tradeShipLockedUids[uid];
    g_tradeShipRejectedUids[uid] = {retryAt:availableAt,itemKey:row.itemKey};
    pending.saleRestricted = true;
    pending.saleAvailableAt = availableAt;
    if (!previous || previous.availableAt !== availableAt) {
        emit('auto_trade_ship_deferred', {accountKey:accountKey,uid:uid,itemKey:row.itemKey,
            availableAt:availableAt,observedAt:row.observedAt,
            text:'[自动交易船] 物品已标记限时禁售，UTC ' + new Date(availableAt).toISOString().replace('T',' ').slice(0,19) +
                ' 前跳过该物品；到期后恢复候选。'});
    }
    return true;
}

function autoTradeShipPriceCny(row) {
    var priceRow = g_marketPriceItems[String(row && row.itemKey || '')] || {};
    return Number(priceRow.priceCny || 0);
}

function autoTradeShipMeetsPriceFloor(row) {
    if (!marketPriceIsFresh()) return false;
    var price = autoTradeShipPriceCny(row);
    if (price + 0.000000001 < g_tradeShipMinPriceCny) return false;
    if (g_autoTradeShipPriceMode === 'range' && g_tradeShipMaxPriceCny > 0 &&
            price - 0.000000001 > g_tradeShipMaxPriceCny) return false;
    return true;
}

function autoTradeShipEligible(row, allowServerPending) {
    if (!autoTradeShipBaseEligible(row, allowServerPending) || !marketPriceIsFresh()) return false;
    var priceRow = g_marketPriceItems[String(row.itemKey)] || null;
    if (!priceRow || priceRow.resolved !== true || !(Number(priceRow.priceCny || 0) > 0)) return false;
    if (Date.now() / 1000 - Number(priceRow.updatedAt || g_marketPriceUpdatedAt) > 60 * 60) return false;
    return autoTradeShipMeetsPriceFloor(row);
}

function autoTradeShipCandidate(row) {
    if (!autoTradeShipEligible(row, false)) return false;
    if (g_tradeShipQueuedUids[String(row.uid)]) return false;
    if (g_tradeShipRejectedUids[String(row.uid)]) return false;
    return true;
}

function marketPriceIsFresh() {
    if (!(g_marketPriceUpdatedAt > 0)) return false;
    return Date.now() / 1000 - g_marketPriceUpdatedAt <= 60 * 60;
}

function compareAutoTradeShipRows(a, b) {
    var priceA = Number((g_marketPriceItems[String(a.itemKey)] || {}).priceCny || 0);
    var priceB = Number((g_marketPriceItems[String(b.itemKey)] || {}).priceCny || 0);
    var sourceA = tradeShipSource(a) || { slotType: 9, index: 999999 };
    var sourceB = tradeShipSource(b) || { slotType: 9, index: 999999 };
    var priority = g_autoTradeShipPriceMode === 'highest' ? priceB - priceA : 0;
    return priority || (sourceA.slotType - sourceB.slotType) ||
        (sourceA.index - sourceB.index) || String(a.uid).localeCompare(String(b.uid));
}

function scheduleAutoTradeShipAction(action, uid, delayMs) {
    setTimeout(function () {
        if (!g_running || (!g_autoTradeShipEnabled && !g_tradeShipManualRunActive) || !g_tradeShipPending) return;
        if (String(g_tradeShipPending.uid) !== String(uid)) return;
        if (!ensureUpdateHook()) {
            g_lastTradeShipResult = '游戏主线程任务队列挂载失败，正在等待重试';
            scheduleAutoTradeShipAction(action, uid, 1000);
            return;
        }
        g_queue.push({ action: action, uid: String(uid), at: Date.now() });
    }, Math.max(50, delayMs | 0));
}

function beginAutoTradeShipPending(row, source, targetSlot, adoptedWaitingItem) {
    var priceRow = g_marketPriceItems[String(row.itemKey)] || {};
    var priceCny = Number(priceRow.priceCny || 0);
    var now = Date.now();
    g_tradeShipPending = {
        uid: String(row.uid),
        itemKey: row.itemKey,
        row: row,
        source: source || tradeShipSource(row) || { source: '未知位置', index: -1 },
        targetSlot: targetSlot == null ? -1 : targetSlot | 0,
        priceCny: priceCny,
        marketName: priceRow.marketName || '',
        priceSource: priceRow.priceSource || '',
        quoteUpdatedAt: priceRow.quoteUpdatedAt || '',
        rawPrice: priceRow.rawPrice || 0,
        rawCurrency: priceRow.rawCurrency || '',
        priceModel: priceRow.priceModel || '',
        startedAt: now,
        confirmedAt: 0,
        phase: '等待交易槽刷新',
        adoptedWaitingItem: adoptedWaitingItem === true,
        waitingLogged: false,
        confirmationMode: ''
    };
    g_tradeShipQueued = true;
    g_tradeShipQueuedUids[String(row.uid)] = true;
    scheduleAutoTradeShipAction('tradeShipConfirm', row.uid, adoptedWaitingItem ? 100 : 500);
}

function clearAutoTradeShipPending(removeQueuedUid) {
    var pending = g_tradeShipPending;
    g_tradeShipPending = null;
    g_tradeShipQueued = false;
    if (removeQueuedUid && pending && pending.uid) delete g_tradeShipQueuedUids[String(pending.uid)];
}

function finishAutoTradeShipTimeout(pending) {
    var uid = String(pending.uid);
    clearAutoTradeShipPending(true);
    g_tradeShipRejectedUids[uid] = {
        retryAt: Date.now() + g_tradeShipRetryDelayMs,
        itemKey: pending.itemKey
    };
    g_autoTradeShipNextCheckAt = 0;
    g_lastTradeShipResult = '交易船确认状态暂未刷新，将在 10 秒后重新检查';
    tradeShipLog('交易船确认状态暂未刷新，将在 10 秒后重新检查该物品。');
}

var g_currentTradeBridgeResolved = null;
function resolveCurrentTradeBridge() {
    if (g_currentTradeBridgeResolved) return g_currentTradeBridgeResolved;
    var spec = AUTO_TRADE_SHIP_BRIDGE_CURRENT;
    var bridge = { current: true };
    Object.keys(spec).forEach(function (key) {
        if (!spec[key] || typeof spec[key] !== 'object' || spec[key].rva == null) return;
        bridge[key] = resolveCubeBridgeMethod(spec[key]);
    });
    bridge.moveRequest.fn = new NativeFunction(bridge.moveRequest.ptr, 'void',
        ['pointer', 'pointer', 'pointer', 'pointer']);
    verifyManagedMethodShape('sj.itj', bridge.validateMove,
        'TaskbarHero.ValidationResult', ['TaskbarHero.MoveRequest']);
    // Windows x64 returns this 16-byte value type through the first hidden
    // buffer argument (IsValid at +0, FailureReason reference at +8).
    bridge.validateMove.fn = new NativeFunction(bridge.validateMove.ptr, 'pointer',
        ['pointer', 'pointer', 'pointer', 'pointer']);
    bridge.uploadSlot.fn = new NativeFunction(bridge.uploadSlot.ptr, 'void',
        ['pointer', 'pointer']);
    bridge.undoWaiting.fn = new NativeFunction(bridge.undoWaiting.ptr, 'void', ['pointer', 'pointer']);
    verifyManagedMethodShape('TradingStashSlot.nxp', bridge.undoWaiting, 'System.Void', []);
    bridge.clearWaitingDisplay.fn = new NativeFunction(bridge.clearWaitingDisplay.ptr,'void',['pointer','pointer']);
    verifyManagedMethodShape('TradingStashSlot.nww',bridge.clearWaitingDisplay,'System.Void',[]);
    ['buttonPress', 'unityEventInvoke'].forEach(function (key) {
        bridge[key].fn = new NativeFunction(bridge[key].ptr, 'void', ['pointer', 'pointer']);
    });
    ['pointerEnter', 'pointerExit'].forEach(function (key) {
        bridge[key].fn = new NativeFunction(bridge[key].ptr, 'void', ['pointer', 'pointer', 'pointer']);
    });
    bridge.componentGameObject.fn = new NativeFunction(bridge.componentGameObject.ptr,
        'pointer', ['pointer', 'pointer']);
    ['gameObjectActiveSelf', 'gameObjectActiveInHierarchy'].forEach(function (key) {
        bridge[key].fn = new NativeFunction(bridge[key].ptr, 'bool', ['pointer', 'pointer']);
    });
    verifyManagedMethodShape('UnityEngine.UI.Button.Press', bridge.buttonPress,
        'System.Void', []);
    verifyManagedMethodShape('UnityEngine.Events.UnityEvent.Invoke', bridge.unityEventInvoke,
        'System.Void', []);
    var slotInfo = classInfo('TaskbarHero.UI', 'TradingStashSlot');
    if (slotInfo.fields.m_uploadToSteamButton == null ||
            slotInfo.fieldTypes.m_uploadToSteamButton !== 'UnityEngine.UI.Button') {
        throw new Error('游戏交易船上传按钮字段版本不匹配');
    }
    if (slotInfo.fields.m_undoWaitingListButton == null ||
            slotInfo.fieldTypes.m_undoWaitingListButton !== 'UnityEngine.UI.Button') {
        throw new Error('游戏交易船等待栏撤回按钮字段版本不匹配');
    }
    verifyManagedMethodShape('TradingStashSlot.nxg', bridge.uploadSlot,
        'System.Void', []);
    var buttonInfo = classInfo('UnityEngine.UI', 'Button', 'UnityEngine.UI.dll');
    if (buttonInfo.fields.m_OnClick == null ||
            buttonInfo.fieldTypes.m_OnClick !== 'UnityEngine.UI.Button.ButtonClickedEvent') {
        throw new Error('Unity Button.onClick 字段未找到');
    }
    bridge.buttonClickEventOffset = buttonInfo.fields.m_OnClick;
    g_currentTradeBridgeResolved = bridge;
    return bridge;
}

function currentTradeUiAndSlots(bridge) {
    var info = classInfo('TaskbarHero', 'UIManager');
    var manager = findStaticSingleton(info.klass, 'TaskbarHero.UIManager');
    if (isBadPtr(manager)) throw new Error('交易船界面管理器尚未初始化');
    var ui = manager.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.tradingStashOffset).readPointer();
    if (isBadPtr(ui) || managedType(ui) !== 'TaskbarHero.UI.UI_TradingStash') {
        throw new Error('交易船界面尚未初始化');
    }
    var gameObject = bridge.componentGameObject.fn(ui, bridge.componentGameObject.mi);
    var visible = !isBadPtr(gameObject) &&
        !!bridge.gameObjectActiveInHierarchy.fn(gameObject, bridge.gameObjectActiveInHierarchy.mi);
    var slots = readListObjects(ui.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotListOffset).readPointer());
    if (slots.length > 20) {
        throw new Error('交易船可用槽位数量异常');
    }
    var validCount = 0;
    for (var index = 0; index < slots.length; index++) {
        var slot = slots[index];
        if (isBadPtr(slot) || slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotIndexOffset).readS32() !== index)
            break;
        validCount++;
    }
    return { ui: ui, slots: slots, validCount: validCount, visible: visible };
}

function currentTradeSlot(bridge, view, index) {
    if (index < 0 || index >= view.validCount) return null;
    var slot = view.slots[index];
    if (isBadPtr(slot) || managedType(slot) !== 'TaskbarHero.UI.TradingStashSlot' ||
            slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotIndexOffset).readS32() !== index) {
        throw new Error('交易船第 ' + (index + 1) + ' 格绑定错误');
    }
    var cache = slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotCacheOffset).readPointer();
    if (isBadPtr(cache) || managedType(cache) !== 'TaskbarHero.TradingStashCache') {
        throw new Error('交易船第 ' + (index + 1) + ' 格缓存不一致');
    }
    return { slot: slot, cache: cache, index: index };
}

function firstAvailableCurrentTradeSlot(bridge, view) {
    for (var index = 0; index < view.validCount; index++) {
        var binding = currentTradeSlot(bridge, view, index);
        if (!binding) continue;
        if (currentTradeSavedUid(binding) !== '0' || currentTradeWaitingUid(binding) !== '0') continue;
        var cooldownRaw = currentTradeCooldownRaw(binding);
        if (cooldownRaw !== '0' && !currentTradeCooldownExpired(cooldownRaw)) continue;
        return index;
    }
    return -1;
}

function currentTradeSavedUid(binding) {
    var save = binding.cache.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.cacheSaveDataOffset).readPointer();
    return isBadPtr(save) ? '0' : readU64Text(
        save.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.saveDataItemUidOffset));
}

function currentTradeWaitingUid(binding) {
    return readU64Text(binding.slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotWaitingUidOffset));
}

function currentTradeCooldownRaw(binding) {
    return binding.slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotCooldownEndOffset).readU64().toString();
}

function currentTradeCooldownExpired(rawValue) {
    if (!rawValue || String(rawValue) === '0') return false;
    // DateTime stores Kind in the upper two bits. Reduce it to ticks and keep
    // a one-minute UTC safety margin so a slot is never cleared early.
    var ticks = currentTradeCooldownTicks(rawValue);
    if (!(ticks > 0)) return false;
    var nowTicks = (Date.now() - 60000) * 10000 + 621355968000000000;
    return ticks > 0 && ticks <= nowTicks;
}

function currentTradeCooldownTicks(rawValue) {
    var raw = Number(rawValue || 0);
    if (!isFinite(raw) || raw <= 0) return 0;
    return raw % 4611686018427387904; // DateTime Kind flags occupy the top 2 bits.
}

function currentTradeCooldownEndUnixMs(rawValue) {
    var ticks = currentTradeCooldownTicks(rawValue);
    if (!(ticks > 0)) return 0;
    return Math.floor((ticks - 621355968000000000) / 10000);
}

function currentTradeCooldownAdvanced(beforeRaw, afterRaw) {
    if (!afterRaw || String(afterRaw) === '0') return false;
    if (!beforeRaw || String(beforeRaw) === '0') return true;
    return currentTradeCooldownTicks(afterRaw) > currentTradeCooldownTicks(beforeRaw);
}

function currentTradeWarningState(bridge, ui) {
    var info = classInfo('TaskbarHero.UI', 'UI_TradingStash');
    var panelOffset = info.fields.m_tradingStashWarningPanel;
    var buttonOffset = info.fields.m_button_confirmTradingStash;
    if (panelOffset == null || buttonOffset == null) {
        return { available: false, active: false, button: ptr(0) };
    }
    var panel = ui.add(panelOffset).readPointer();
    var button = ui.add(buttonOffset).readPointer();
    var panelType = info.fieldTypes.m_tradingStashWarningPanel || '';
    var panelObject = panel;
    if (!isBadPtr(panel) && panelType !== 'UnityEngine.GameObject') {
        panelObject = bridge.componentGameObject.fn(panel, bridge.componentGameObject.mi);
    }
    var panelSelf = !isBadPtr(panelObject) && !!bridge.gameObjectActiveSelf.fn(
        panelObject, bridge.gameObjectActiveSelf.mi);
    var panelInHierarchy = !isBadPtr(panelObject) && !!bridge.gameObjectActiveInHierarchy.fn(
        panelObject, bridge.gameObjectActiveInHierarchy.mi);
    var buttonObject = isBadPtr(button) ? ptr(0) : bridge.componentGameObject.fn(
        button, bridge.componentGameObject.mi);
    var buttonActiveSelf = !isBadPtr(buttonObject) && !!bridge.gameObjectActiveSelf.fn(
        buttonObject, bridge.gameObjectActiveSelf.mi);
    var callbackOffset = info.fields.bkuc;
    var callbackPending = callbackOffset != null && !isBadPtr(
        ui.add(callbackOffset).readPointer());
    // oqb(Action) stores the one-shot confirmation delegate in bkuc. This is
    // authoritative even if the popup is nested below an inactive UI canvas.
    var active = panelSelf || panelInHierarchy || callbackPending;
    return { available: true, active: active, panelSelf: panelSelf,
        panelInHierarchy: panelInHierarchy, buttonActiveSelf: buttonActiveSelf,
        callbackPending: callbackPending, button: button };
}

function currentTradeSaleRestrictionPopup(bridge) {
    var result = {active:false,availableAt:0,text:'',button:ptr(0)};
    try {
        var managerInfo = classInfo('TaskbarHero','UIManager');
        var manager = findStaticSingleton(managerInfo.klass,'TaskbarHero.UIManager');
        if (isBadPtr(manager) || managerInfo.fields.Ui_Popup == null) return result;
        var popup = manager.add(managerInfo.fields.Ui_Popup).readPointer();
        if (isBadPtr(popup)) return result;
        var fields = runtimeClassFields(il2cpp.objectGetClass(popup)).fields;
        if (fields.ServerPopUpObject == null || fields.ServerPopUpNoticeText == null ||
                fields.ServerPopUpCheckButton == null) return result;
        var panel = popup.add(fields.ServerPopUpObject).readPointer();
        if (isBadPtr(panel) || !bridge.gameObjectActiveSelf.fn(panel,bridge.gameObjectActiveSelf.mi)) return result;
        var textObject = popup.add(fields.ServerPopUpNoticeText).readPointer();
        if (isBadPtr(textObject)) return result;
        var textClass = il2cpp.objectGetClass(textObject);
        var textOffset = null;
        for (var depth=0;depth<12&&!isBadPtr(textClass);depth++,textClass=il2cpp.classGetParent(textClass)) {
            var textFields = runtimeClassFields(textClass).fields;
            if (textFields.m_text != null) {textOffset=textFields.m_text;break;}
        }
        if (textOffset == null) return result;
        var parsed = parseTradeShipSaleRestriction(il2cppString(textObject.add(textOffset).readPointer()));
        if (!parsed.restricted) return result;
        var toggle = popup.add(fields.ServerPopUpCheckButton).readPointer();
        if (isBadPtr(toggle)) return result;
        var toggleClass = il2cpp.objectGetClass(toggle);
        var button = ptr(0);
        for (var td=0;td<12&&!isBadPtr(toggleClass);td++,toggleClass=il2cpp.classGetParent(toggleClass)) {
            var buttonFields = runtimeClassFields(toggleClass);
            var names = Object.keys(buttonFields.fieldInfos);
            for (var fi=0;fi<names.length;fi++) {
                var name=names[fi],field=buttonFields.fieldInfos[name];
                if (cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field))) === 'UnityEngine.UI.Button') {
                    button=toggle.add(buttonFields.fields[name]).readPointer();break;
                }
            }
            if (!isBadPtr(button)) break;
        }
        return {active:true,availableAt:parsed.availableAt,text:parsed.text,button:button,panel:panel};
    } catch (error) {
        result.error=chineseError(error);
        return result;
    }
}

function handleCurrentTradeSaleRestriction(bridge, view, binding, pending) {
    // This popup may also be opened manually. Only associate it with our submitted UID.
    if (!pending.uploadInvoked || !binding) return false;
    var popup = currentTradeSaleRestrictionPopup(bridge);
    if (popup.active) {
        if (!pending.saleRestricted) {
            pending.saleRestricted=true;
            pending.saleWarningAt=Date.now();
            pending.saleAvailableAt=popup.availableAt;
            pending.saleWarningText=popup.text;
            if (!deferTradeShipUid(pending,popup.availableAt,popup.text)) {
                // An absent/invalid deadline never becomes a permanent item lock.
                pending.saleRetryAt=Date.now()+Math.max(3600000,g_autoTradeShipIntervalMs);
                g_tradeShipRejectedUids[String(pending.uid)]={retryAt:pending.saleRetryAt,itemKey:pending.itemKey};
                tradeShipLog('暂不可出售提示未提供有效的未来 UTC 时间，本轮跳过，1 小时后重新检测。');
            }
        }
        var elapsed=Date.now()-Number(pending.saleDismissAt||0);
        if ((!pending.saleDismissCount || elapsed>=g_serverRequestSpacingMs) && (pending.saleDismissCount||0)<3) {
            if (isBadPtr(popup.button)) throw new Error('限时禁售提示确认按钮尚未就绪');
            var click=dispatchCurrentTradeButton(bridge,popup.button,'限时禁售提示确认');
            pending.saleDismissAt=Date.now();
            pending.saleDismissCount=(pending.saleDismissCount||0)+1;
            pending.phase='确认并关闭限时禁售提示';
        }
        if ((pending.saleDismissCount||0)>=3 && Date.now()-Number(pending.saleDismissAt||0)>=g_serverRequestSpacingMs) {
            g_lastTradeShipResult='限时禁售弹窗未关闭，已保留标记并暂停当前上传，等待用户确认';
            tradeShipLog(g_lastTradeShipResult+'。');
            clearAutoTradeShipPending(true);
            g_autoTradeShipNextCheckAt=Date.now()+g_autoTradeShipIntervalMs;
            return true;
        }
        scheduleAutoTradeShipAction('tradeShipFinalize',pending.uid,g_serverRequestSpacingMs);
        return true;
    }
    if (!pending.saleRestricted) return false;
    if (Date.now()-Number(pending.saleDismissAt||pending.saleWarningAt||0)<g_serverRequestSpacingMs) {
        scheduleAutoTradeShipAction('tradeShipFinalize',pending.uid,g_serverRequestSpacingMs);
        return true;
    }
    var waitingUid=currentTradeWaitingUid(binding);
    if (waitingUid===String(pending.uid) && !pending.saleUndoInvoked) {
        pressCurrentTradeUndoWaitingItem(bridge,binding);
        pending.saleUndoInvoked=true;
        pending.phase='撤回限时禁售物品，继续下一个候选';
        scheduleAutoTradeShipAction('tradeShipFinalize',pending.uid,g_serverRequestSpacingMs);
        return true;
    }
    if (waitingUid!==String(pending.uid)) {
        delete g_tradeShipDeferredCleanupRetryAt[String(pending.uid)];
        clearAutoTradeShipPending(true);
        g_autoTradeShipNextCheckAt=0;
        g_lastTradeShipResult='已关闭禁售提示并跳过物品 '+pending.itemKey+'，继续填充空交易槽';
        tradeShipLog(g_lastTradeShipResult+'。');
        return true;
    }
    if (pending.saleUndoInvoked && !pending.saleDisplayRefreshInvoked &&
            clearCurrentDeferredWaitingDisplay(bridge,binding,pending)) {
        pending.saleDisplayRefreshInvoked=true;
        scheduleAutoTradeShipAction('tradeShipFinalize',pending.uid,g_serverRequestSpacingMs);
        return true;
    }
    if (Date.now()-pending.saleWarningAt>=g_tradeShipConfirmTimeoutMs) {
        g_tradeShipDeferredCleanupRetryAt[String(pending.uid)]=Date.now()+Math.max(60000,g_autoTradeShipIntervalMs);
        clearAutoTradeShipPending(true);
        g_autoTradeShipNextCheckAt=0;
        tradeShipLog('禁售物品撤回暂未确认，已保留禁售标记，等待下轮核对。');
        return true;
    }
    scheduleAutoTradeShipAction('tradeShipFinalize',pending.uid,g_serverRequestSpacingMs);
    return true;
}

function clearCurrentDeferredWaitingDisplay(bridge,binding,pending) {
    // xy.llh removes the authoritative waiting record, but a hidden ship panel
    // skips its UI refresh. Refresh only a proven stale view, never a live upload.
    if (!pending.saleRestricted || !pending.saleUndoInvoked ||
            currentTradeSavedUid(binding)!=='0' || currentTradeWaitingUid(binding)!==String(pending.uid)) return false;
    var info=classInfo('','xy');
    var field=info.fieldInfos.bjfu;
    if (!field || info.fieldTypes.bjfu!=='System.Collections.Generic.List<xy.WaitingListInfo>') return false;
    var storage=Memory.alloc(PTR);
    il2cpp.fieldStaticGetValue(field,storage);
    var waiting=storage.readPointer();
    if (isBadPtr(waiting) || waiting.add(0x18).readS32()!==0) return false;
    var placements=tradeShipPlacementSources(pending.uid);
    if (placements.length!==1 || placements[0].source==='交易船') return false;
    bridge.clearWaitingDisplay.fn(binding.slot,bridge.clearWaitingDisplay.mi);
    return true;
}

function autoPlaguePortalUiDiagnostics() {
    var result = { available: false, portalVisible: null, portalActiveSelf: null,
        stageUiVisible: null, stageUiActiveSelf: null, portalType: '',
        portalCloseButtonFields: [], stageUiStageFields: [],
        stageUiStageCacheCandidates: [] };
    try {
        var bridge = resolveCurrentTradeBridge();
        var managerInfo = classInfo('TaskbarHero', 'UIManager');
        var manager = findStaticSingleton(managerInfo.klass, 'TaskbarHero.UIManager');
        if (isBadPtr(manager)) return result;
        function objectState(fieldName) {
            var offset = managerInfo.fields[fieldName];
            if (offset == null) return null;
            var component = manager.add(offset).readPointer();
            if (isBadPtr(component)) return null;
            var go = bridge.componentGameObject.fn(component, bridge.componentGameObject.mi);
            if (isBadPtr(go)) return null;
            return {
                component: component,
                type: managedType(component),
                activeSelf: !!bridge.gameObjectActiveSelf.fn(go, bridge.gameObjectActiveSelf.mi),
                visible: !!bridge.gameObjectActiveInHierarchy.fn(
                    go, bridge.gameObjectActiveInHierarchy.mi)
            };
        }
        var portal = objectState('Ui_Portal');
        var stageUi = objectState('Ui_Stage');
        result.available = true;
        if (portal) {
            result.portalType = portal.type;
            result.portalActiveSelf = portal.activeSelf;
            result.portalVisible = portal.visible;
            var klass = il2cpp.objectGetClass(portal.component);
            for (var depth = 0; depth < 12 && !isBadPtr(klass); depth++) {
                var fields = runtimeClassFields(klass);
                Object.keys(fields.fieldInfos).forEach(function (name) {
                    var field = fields.fieldInfos[name];
                    var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
                    if (/close|button/i.test(name) && /UnityEngine\.UI\.Button/.test(typeName)) {
                        result.portalCloseButtonFields.push(name + ':' + typeName + '@' +
                            fields.fields[name].toString(16));
                    }
                });
                klass = il2cpp.classGetParent(klass);
            }
        }
        if (stageUi) {
            result.stageUiActiveSelf = stageUi.activeSelf;
            result.stageUiVisible = stageUi.visible;
            var stageClass = il2cpp.objectGetClass(stageUi.component);
            for (var stageDepth = 0; stageDepth < 12 && !isBadPtr(stageClass); stageDepth++) {
                var stageFields = runtimeClassFields(stageClass);
                Object.keys(stageFields.fieldInfos).forEach(function (name) {
                    var field = stageFields.fieldInfos[name];
                    var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
                    if (/StageCache|StageInfo|StageData|WaveData/.test(typeName)) {
                        result.stageUiStageFields.push(name + ':' + typeName + '@' +
                            stageFields.fields[name].toString(16));
                        if (/StageCache/.test(typeName)) {
                            try {
                                var candidate = stageUi.component.add(stageFields.fields[name]).readPointer();
                                var candidateStage = isBadPtr(candidate) ? null : readAutoBossStageInfo(candidate);
                                if (candidateStage) result.stageUiStageCacheCandidates.push({
                                    field: name, stageKey: candidateStage.stageKey,
                                    stageType: candidateStage.stageType, difficulty: candidateStage.difficulty,
                                    act: candidateStage.act, stageNo: candidateStage.stageNo
                                });
                            } catch (candidateError) {}
                        }
                    }
                });
                stageClass = il2cpp.classGetParent(stageClass);
            }
        }
    } catch (error) {
        result.error = chineseError(error);
    }
    return result;
}

function currentTradeWarningDiagnostics() {
    try {
        var bridge = resolveCurrentTradeBridge();
        var view = currentTradeUiAndSlots(bridge);
        var warning = currentTradeWarningState(bridge, view.ui);
        return { available: warning.available, tradingUiVisible: view.visible,
            panelSelf: warning.panelSelf, panelInHierarchy: warning.panelInHierarchy,
            confirmButtonActiveSelf: warning.buttonActiveSelf,
            confirmationCallbackPending: warning.callbackPending,
            active: warning.active };
    } catch (error) {
        return { available: false, error: chineseError(error) };
    }
}

var g_itemLockMethodDiagnosticsCache = null;
function itemLockMethodDiagnostics() {
    if (g_itemLockMethodDiagnosticsCache) return g_itemLockMethodDiagnosticsCache;
    var result = { available: false, itemSaveData: null, methods: [], relatedClasses: [],
        slotActionMethods: [], slotActionOpaqueType: null,
        itemSlotHierarchy: [], truncated: false };
    try {
        var itemInfo = classInfo('TaskbarHero.EasySaveData', 'ItemSaveData');
        if (!itemInfo.klass || itemInfo.klass.isNull()) throw new Error('ItemSaveData 类型未找到');
        result.available = true;
        result.itemSaveData = {
            type: 'TaskbarHero.EasySaveData.ItemSaveData',
            isBlockedOffset: firstFieldOffset(itemInfo.fields, ['IsBlocked', 'isBlocked', 'Locked', 'locked']),
            fieldType: itemInfo.fieldTypes.IsBlocked || itemInfo.fieldTypes.isBlocked ||
                itemInfo.fieldTypes.Locked || itemInfo.fieldTypes.locked || ''
        };
        var image = imageByName('Assembly-CSharp.dll');
        if (isBadPtr(image)) throw new Error('Assembly-CSharp.dll 未加载');
        var classCount = api('il2cpp_image_get_class_count', 'int', ['pointer'])(image);
        var getClass = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
        for (var ci = 0; ci < classCount; ci++) {
            var klassPtr = getClass(image, ci);
            if (isBadPtr(klassPtr)) continue;
            var className = cstr(il2cpp.classGetName(klassPtr));
            var namespaceName = cstr(il2cpp.classGetNamespace(klassPtr));
            var classText = className + ' ' + namespaceName;
            if (!/item|inventory|stash|slot|save|block|lock/i.test(classText)) continue;
            if (className === 'ItemSlot') {
                var parent = il2cpp.classGetParent(klassPtr);
                for (var parentDepth = 0; parentDepth < 12 && !isBadPtr(parent); parentDepth++) {
                    var parentName = cstr(il2cpp.classGetName(parent));
                    var parentNs = cstr(il2cpp.classGetNamespace(parent));
                    var parentFields = runtimeClassFields(parent);
                    var parentFieldRows = [];
                    Object.keys(parentFields.fieldInfos).forEach(function (fieldName) {
                        var field = parentFields.fieldInfos[fieldName];
                        var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
                        if (/item|block|lock/i.test(fieldName + ' ' + typeName))
                            parentFieldRows.push(fieldName + ':' + typeName + '@' +
                                parentFields.fields[fieldName].toString(16));
                    });
                    var parentMethods = [];
                    var parentIter = Memory.alloc(PTR);
                    parentIter.writePointer(ptr(0));
                    for (var pm = 0; pm < 200; pm++) {
                        var parentMethod = il2cpp.classGetMethods(parent, parentIter);
                        if (isBadPtr(parentMethod)) break;
                        var parentMethodName = cstr(il2cpp.methodGetName(parentMethod));
                        if (!/block|lock|unlock|manual|pointer|click|item/i.test(parentMethodName)) continue;
                        var parentPointer = methodPtr(parentMethod);
                        parentMethods.push(parentMethodName + '@' +
                            (isBadPtr(parentPointer) ? '' : '0x' + parentPointer.sub(B).toString(16)));
                    }
                    result.itemSlotHierarchy.push(parentNs + '.' + parentName +
                        ' fields=' + parentFieldRows.join(',') + ' methods=' + parentMethods.join(','));
                    parent = il2cpp.classGetParent(parent);
                }
            }
            var fields = runtimeClassFields(klassPtr);
            var fieldRows = [];
            var hasItemSaveReference = false;
            var hasLockField = false;
            Object.keys(fields.fieldInfos).forEach(function (fieldName) {
                var field = fields.fieldInfos[fieldName];
                var typeName = cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field)));
                if (/ItemSaveData|ItemInfoData/.test(typeName)) hasItemSaveReference = true;
                if (/block|lock/i.test(fieldName)) hasLockField = true;
                if (className === 'SlotInteractionManager' ||
                        /ItemSaveData|ItemInfoData|blocked|locked|lock|button|item/i.test(fieldName + ' ' + typeName))
                    fieldRows.push(fieldName + ':' + typeName + '@' + fields.fields[fieldName].toString(16));
            });
            var relatedMethods = [];
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var guard = 0; guard < 400; guard++) {
                var method = il2cpp.classGetMethods(klassPtr, iter);
                if (isBadPtr(method)) break;
                var methodName = cstr(il2cpp.methodGetName(method));
                var inspectAllUiMethods = /^(ItemSlot|UI_RemakeStash|SlotInteractionManager|SlotActionContext)$/.test(className) || hasLockField;
                if (!inspectAllUiMethods &&
                        !/block|lock|unlock|manual|pointer|click|select|item/i.test(methodName)) continue;
                var count = il2cpp.methodGetParamCount(method) | 0;
                var parameters = [];
                for (var pi = 0; pi < count && pi < 8; pi++) {
                    parameters.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method, pi))));
                }
                var pointer = methodPtr(method);
                var row = {
                    namespace: namespaceName, className: className, methodName: methodName,
                    returnType: cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method))),
                    parameters: parameters,
                    rva: isBadPtr(pointer) ? '' : '0x' + pointer.sub(B).toString(16)
                };
                relatedMethods.push(row);
                if (/block|lock|unlock|manual/i.test(methodName) && result.methods.length < 100)
                    result.methods.push(row);
            }
            if ((hasItemSaveReference || hasLockField ||
                    /^(ItemSlot|InventoryItemData|ItemSaveData|TradingStashSlot|UI_RemakeStash|InventorySaveData|SlotInteractionManager|SlotActionContext)$/.test(className)) &&
                    result.relatedClasses.length < 40) {
                result.relatedClasses.push(namespaceName + '.' + className +
                    ' fields=' + fieldRows.slice(0,12).join(',') +
                    ' methods=' + relatedMethods.slice(0,30).map(function (row) {
                        return row.methodName + '(' + row.parameters.join(',') + '):' +
                            row.returnType + '@' + row.rva;
                    }).join(','));
            }
        }
        for (var actionClassIndex = 0; actionClassIndex < classCount &&
                result.slotActionMethods.length < 100; actionClassIndex++) {
            var actionClass = getClass(image, actionClassIndex);
            if (isBadPtr(actionClass)) continue;
            var actionNamespace = cstr(il2cpp.classGetNamespace(actionClass));
            if (!/^TaskbarHero(\.|$)/.test(actionNamespace)) continue;
            var actionClassName = cstr(il2cpp.classGetName(actionClass));
            var actionIter = Memory.alloc(PTR);
            actionIter.writePointer(ptr(0));
            for (var actionGuard = 0; actionGuard < 400; actionGuard++) {
                var actionMethod = il2cpp.classGetMethods(actionClass, actionIter);
                if (isBadPtr(actionMethod)) break;
                var actionParamCount = il2cpp.methodGetParamCount(actionMethod) | 0;
                var actionParams = [];
                var slotActionRelated = false;
                for (var apiIndex = 0; apiIndex < actionParamCount && apiIndex < 8; apiIndex++) {
                    var actionParamName = cstr(il2cpp.typeGetName(
                        il2cpp.methodGetParam(actionMethod, apiIndex)));
                    actionParams.push(actionParamName);
                    if (/ESlotAction|SlotActionContext/.test(actionParamName)) slotActionRelated = true;
                }
                if (!slotActionRelated) continue;
                var actionPointer = methodPtr(actionMethod);
                result.slotActionMethods.push(actionNamespace + '.' + actionClassName + '.' +
                    cstr(il2cpp.methodGetName(actionMethod)) + '(' + actionParams.join(',') + ')@' +
                    (isBadPtr(actionPointer) ? '' : '0x' + actionPointer.sub(B).toString(16)));
                if (result.slotActionMethods.length >= 100) break;
            }
        }
        var opaqueClass = findClassByEnumeratedName('', 'rs');
        if (!isBadPtr(opaqueClass)) {
            var opaqueFields = runtimeClassFields(opaqueClass);
            var opaqueFieldRows = [];
            Object.keys(opaqueFields.fieldInfos).forEach(function (fieldName) {
                var field = opaqueFields.fieldInfos[fieldName];
                opaqueFieldRows.push(fieldName + ':' +
                    cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field))) + '@' +
                    opaqueFields.fields[fieldName].toString(16));
            });
            var opaqueMethods = [];
            var opaqueIter = Memory.alloc(PTR);
            opaqueIter.writePointer(ptr(0));
            for (var om = 0; om < 100; om++) {
                var opaqueMethod = il2cpp.classGetMethods(opaqueClass, opaqueIter);
                if (isBadPtr(opaqueMethod)) break;
                var opaqueParams = [];
                var opaqueCount = il2cpp.methodGetParamCount(opaqueMethod) | 0;
                for (var op = 0; op < opaqueCount && op < 8; op++)
                    opaqueParams.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(opaqueMethod, op))));
                var opaquePointer = methodPtr(opaqueMethod);
                opaqueMethods.push(cstr(il2cpp.methodGetName(opaqueMethod)) + '(' +
                    opaqueParams.join(',') + '):' +
                    cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(opaqueMethod))) + '@' +
                    (isBadPtr(opaquePointer) ? '' : '0x' + opaquePointer.sub(B).toString(16)));
            }
            result.slotActionOpaqueType = {
                namespace: cstr(il2cpp.classGetNamespace(opaqueClass)),
                className: cstr(il2cpp.classGetName(opaqueClass)),
                fields: opaqueFieldRows.join(','), methods: opaqueMethods.join(',')
            };
        }
        result.truncated = result.methods.length >= 100;
    } catch (error) {
        result.error = chineseError(error);
    }
    g_itemLockMethodDiagnosticsCache = result;
    return result;
}

function dispatchCurrentTradeButton(bridge, button, label) {
    if (isBadPtr(button)) throw new Error(label + '按钮对象为空');
    var clickEvent = button.add(bridge.buttonClickEventOffset).readPointer();
    if (isBadPtr(clickEvent)) throw new Error(label + '按钮 onClick 事件为空');
    var gameObject = bridge.componentGameObject.fn(button, bridge.componentGameObject.mi);
    var active = !isBadPtr(gameObject) && !!bridge.gameObjectActiveInHierarchy.fn(
        gameObject, bridge.gameObjectActiveInHierarchy.mi);
    if (active) {
        bridge.buttonPress.fn(button, bridge.buttonPress.mi);
        return { clickEvent: clickEvent, mode: 'Unity Button.Press' };
    }
    // Invoke the bound game event directly when the slot button is hidden.
    // This does not move the OS cursor or synthesize pointer-enter events.
    bridge.unityEventInvoke.fn(clickEvent, bridge.unityEventInvoke.mi);
    return { clickEvent: clickEvent, mode: 'UnityEvent.Invoke（后台按钮）' };
}



function pressCurrentTradeUploadButton(bridge, binding) {
    // Hidden panels do not initialize hover-bound listeners. Call the verified
    // green-check handler itself; it retains the game's eligibility checks,
    // confirmation and server request without opening the ship or moving a mouse.
    bridge.uploadSlot.fn(binding.slot, bridge.uploadSlot.mi);
    return {mode: '游戏原生绿色确认处理器（后台）'};
}

function pressCurrentTradeWarningConfirm(bridge, state) {
    if (!state || !state.active) return false;
    return dispatchCurrentTradeButton(bridge, state.button, '交易船提示框确认');
}

function pressCurrentTradeUndoWaitingItem(bridge, binding) {
    bridge.undoWaiting.fn(binding.slot, bridge.undoWaiting.mi);
    return {mode: '游戏原生等待栏撤回处理器（后台）'};
}

function skipCurrentTradeShipPending(pending, reason) {
    var uid = String(pending.uid);
    lockTradeShipUid(uid, pending.itemKey, reason);
    g_tradeShipRejectedUids[uid] = {
        retryAt: Date.now() + Math.max(60000, g_autoTradeShipIntervalMs),
        itemKey: pending.itemKey
    };
    clearAutoTradeShipPending(true);
    g_autoTradeShipNextCheckAt = 0;
    g_lastTradeShipResult = '本轮跳过暂不可出售物品：' + pending.itemKey;
    tradeShipLog(g_lastTradeShipResult + '；' + String(reason || '游戏未接受上传') + '。');
}

function processCurrentTradeItem(item) {
    var row = item && item.row;
    if (!row || !row.uid) throw new Error('交易船候选物品无效');
    var source = tradeShipSource(row);
    if (!source || !tradeShipPlacementSources(row.uid).some(function (entry) {
        return entry.source === source.source && entry.index === source.index;
    })) {
        g_tradeShipQueued = false;
        return;
    }
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    var index = firstAvailableCurrentTradeSlot(bridge, view);
    var binding = currentTradeSlot(bridge, view, index);
    var targetCooldownRaw = binding ? currentTradeCooldownRaw(binding) : '0';
    if (!binding || currentTradeSavedUid(binding) !== '0' || currentTradeWaitingUid(binding) !== '0' ||
            (targetCooldownRaw !== '0' && !currentTradeCooldownExpired(targetCooldownRaw))) {
        g_tradeShipQueued = false;
        g_tradeShipNextSlotCheckAt = Date.now() + g_tradeShipSlotCheckIntervalMs;
        return;
    }
    tradeShipLog('开始移入交易船：物品编号 ' + row.itemKey + '，唯一编号 ' + row.uid +
        '，来源 ' + source.source + ' 第 ' + (source.index + 1) + ' 格，目标槽位 ' + (index + 1) + '。');
    var info = classInfo('', 'sj');
    var manager = findStaticSingleton(info.klass, 'sj');
    if (isBadPtr(manager)) throw new Error('物品移动管理器尚未初始化');
    // Use the game's direct transfer mode with its cached MoveResult callback.
    // DRAG requires a live pointer context and can leave the trade slot empty.
    var request = createNativeMoveRequest(source, 3, index, 1); // ESlotType.TRADINGSTASH / EMoveType.DIRECT
    var validation = Memory.alloc(16);
    bridge.validateMove.fn(validation, manager, request, bridge.validateMove.mi);
    if (validation.readU8() === 0) {
        var failureReason = il2cppString(validation.add(8).readPointer()) || '游戏未允许该物品移入';
        // Respect native item locks. A rejected candidate must not occupy the
        // confirmation queue for 25 seconds or prevent other slots being filled.
        if (/BlockedItem|NotTradable|Untradable|CannotSell/i.test(failureReason)) {
            lockTradeShipUid(row.uid, row.itemKey, failureReason);
        }
        g_tradeShipRejectedUids[String(row.uid)] = {
            retryAt: Date.now() + Math.max(60000, g_autoTradeShipIntervalMs), itemKey: row.itemKey
        };
        g_tradeShipQueued = false;
        g_autoTradeShipNextCheckAt = 0;
        tradeShipState('跳过游戏不允许移入的物品 ' + row.itemKey + '：' + failureReason, true);
        return;
    }
    var moveError = null;
    try {
        bridge.moveRequest.fn(manager, request, resolveMoveResultCallback(), bridge.moveRequest.mi);
    } catch (e) {
        moveError = new Error('sj.iti 移入请求调用失败：' + chineseError(e));
        moveError.message += '；来源=' + source.source + ' 第 ' + (source.index + 1) +
            ' 格，数量=' + Math.max(1, Number(source.quantity) || 1) +
            '，模式=DIRECT，目标交易船第 ' + (index + 1) + ' 格';
    }
    if (moveError && currentTradeWaitingUid(binding) !== String(row.uid) &&
            tradeShipPlacementSources(row.uid).some(function (entry) {
                return entry.source === source.source && entry.index === source.index;
            })) throw moveError;
    beginAutoTradeShipPending(row, source, index, false);
    tradeShipState('已发送交易船移入请求，等待第 ' + (index + 1) + ' 格刷新', true);
}

function processCurrentTradeConfirm(item) {
    var pending = g_tradeShipPending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    var binding = currentTradeSlot(bridge, view, pending.targetSlot);
    if (!binding) throw new Error('交易船目标槽位已关闭或绑定无效');
    if (handleCurrentTradeSaleRestriction(bridge,view,binding,pending)) return;
    if (currentTradeWaitingUid(binding) !== String(pending.uid)) {
        // nxg accepts the server upload synchronously and clears the waiting
        // UID before the next 350 ms poll. The source disappearing while the
        // cooldown advances is the authoritative success signal for that
        // accepted upload; do not wait for an already-cleared waiting UID.
        if (pending.uploadInvoked) {
            var uploadCooldownStarted = currentTradeCooldownAdvanced(
                pending.cooldownBeforeUpload, currentTradeCooldownRaw(binding));
            var uploadSourceGone = !tradeShipPlacementSources(pending.uid).some(function (entry) {
                return entry.source === pending.source.source && entry.index === pending.source.index;
            });
            if (uploadCooldownStarted && uploadSourceGone) {
                pending.confirmationMode = '游戏原生上传已受理';
                processCurrentTradeFinalize({ uid: pending.uid });
                return;
            }
        }
        if (!pending.waitingUidLogged || Date.now() - pending.waitingUidLoggedAt >= 10000) {
            pending.waitingUidLogged = true;
            pending.waitingUidLoggedAt = Date.now();
            tradeShipLog('等待交易船第 ' + (pending.targetSlot + 1) + ' 格接收物品：期望等待编号 ' +
                pending.uid + '，当前槽位编号 ' + currentTradeWaitingUid(binding) + '，已等待 ' +
                Math.floor((Date.now() - pending.startedAt) / 1000) + ' 秒。');
        }
        if (Date.now() - pending.startedAt >= g_tradeShipConfirmTimeoutMs) {
            finishAutoTradeShipTimeout(pending);
        } else {
            pending.phase = '等待游戏交易槽接收物品';
            scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, 350);
        }
        return;
    }
    var slotItem = binding.slot.add(AUTO_TRADE_SHIP_BRIDGE_CURRENT.slotItemOffset).readPointer();
    if (isBadPtr(slotItem)) throw new Error('交易船等待槽物品对象为空');
    var warning = currentTradeWarningState(bridge, view.ui);
    if (warning.active) {
        if (!pending.warningSeen) pending.warningAt = Date.now();
        pending.warningSeen = true;
        if (!pending.warningDismissInvoked) {
            var warningClick = pressCurrentTradeWarningConfirm(bridge, warning);
            pending.warningDismissInvoked = true;
            pending.confirmationInvoked = true;
            pending.confirmationMode = '交易船提示按钮已确认';
            pending.warningClickMode = warningClick && warningClick.mode || '';
            pending.phase = '确认交易船提示框';
            scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, g_serverRequestSpacingMs);
            return;
        }
        pending.phase = pending.undoInvoked ? '等待暂不可出售物品撤回' : '等待交易船提示关闭';
        scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, g_serverRequestSpacingMs);
        return;
    }
    if (!pending.uploadInvoked) {
        pending.cooldownBeforeUpload = currentTradeCooldownRaw(binding);
        var uploadClick = pressCurrentTradeUploadButton(bridge, binding);
        pending.uploadInvoked = true;
        pending.uploadClickMode = uploadClick.mode;
        pending.phase = '等待上传与确认操作间隔';
        tradeShipLog('交易船第 ' + (pending.targetSlot + 1) +
            ' 格已触发绿色上传确认按钮（' + uploadClick.mode + '），等待游戏回包。');
        scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, g_serverRequestSpacingMs);
        return;
    }
    pending.phase = '等待服务器确认';
    // Keep the original deadline after the first dispatch. Resetting this on
    // every confirmation poll made a missing server response wait forever and
    // left the trade queue permanently occupied.
    if (!pending.confirmedAt) pending.confirmedAt = Date.now();
    scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, 750);
}

function processCurrentTradeFinalize(item) {
    var pending = g_tradeShipPending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    var binding = currentTradeSlot(bridge, view, pending.targetSlot);
    if (handleCurrentTradeSaleRestriction(bridge,view,binding,pending)) return;
    var warning = currentTradeWarningState(bridge, view.ui);
    if (warning.active) {
        if (!pending.warningSeen) pending.warningAt = Date.now();
        pending.warningSeen = true;
        if (!pending.warningDismissInvoked) {
            var warningClick = pressCurrentTradeWarningConfirm(bridge, warning);
            pending.warningDismissInvoked = true;
            pending.confirmationInvoked = true;
            pending.confirmationMode = '交易船提示按钮已确认';
            pending.warningClickMode = warningClick && warningClick.mode || '';
            pending.phase = '确认交易船提示框';
        } else if (!pending.undoInvoked && binding &&
                Date.now() - Number(pending.warningAt || 0) >= 4000 &&
                currentTradeWaitingUid(binding) === String(pending.uid)) {
            pressCurrentTradeUndoWaitingItem(bridge, binding);
            pending.undoInvoked = true;
            pending.phase = '撤回并跳过暂不可出售物品';
            tradeShipLog('交易船第 ' + (pending.targetSlot + 1) +
                ' 格提示暂不可出售，已确认提示并触发撤回；撤回确认后将锁定该物品并跳过。');
        }
        if (pending.undoInvoked && binding && currentTradeWaitingUid(binding) === '0') {
            skipCurrentTradeShipPending(pending, '商品暂时无法出售，已确认提示并撤回');
            return;
        }
        scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, g_serverRequestSpacingMs);
        return;
    }
    var savedUid = binding ? currentTradeSavedUid(binding) : '0';
    var originalPlacements = tradeShipPlacementSources(pending.uid);
    var originalGone = !originalPlacements.some(function (entry) {
        return entry.source === pending.source.source && entry.index === pending.source.index;
    });
    var resultPlacements = savedUid === '0' ? [] : tradeShipPlacementSources(savedUid);
    var inTarget = resultPlacements.some(function (entry) {
        return entry.source === '交易船' && entry.index === pending.targetSlot;
    });
    var savedInfo = savedUid === '0' ? null : getLocalItemInfoCache()[savedUid];
    var matchingItem = savedInfo && savedInfo.itemKey === pending.itemKey;
    var waitingCleared = binding && currentTradeWaitingUid(binding) === '0';
    if (savedUid !== '0' && inTarget && matchingItem) pending.observedNewUid = savedUid;
    var cooldownStarted = binding && currentTradeCooldownAdvanced(
        pending.cooldownBeforeUpload, currentTradeCooldownRaw(binding));
    var transferred = savedUid !== '0' && inTarget && matchingItem;
    var uploadedAndCooling = savedUid === '0' && cooldownStarted;
    // The game keeps the original waiting UID on a successfully listed slot;
    // source removal plus either the new saved item or a new cooldown is the
    // authoritative server-accepted signal. A cleared waiting field is only
    // diagnostic and must not delay the queue until timeout.
    var accepted = binding && originalGone && pending.uploadInvoked === true &&
        (transferred || uploadedAndCooling);
    if (accepted) {
        clearAutoTradeShipPending(false);
        g_autoTradeShipNextCheckAt = 0;
        g_tradeShipCount++;
        g_lastTradeShipAt = Date.now();
        g_lastTradeShipResult = '交易船确认完成：物品编号 ' + pending.itemKey +
            (savedUid !== '0' ? '，新唯一编号 ' + savedUid : '，已进入冷却');
        emit('auto_trade_ship_completed', {
            uid: pending.uid, newUid: savedUid !== '0' ? savedUid : (pending.observedNewUid || ''),
            itemKey: pending.itemKey,
            targetSlot: pending.targetSlot,
            priceCny: pending.priceCny, marketName: pending.marketName,
            source: pending.source.source, sourceIndex: pending.source.index,
            priceSource: pending.priceSource, quoteUpdatedAt: pending.quoteUpdatedAt,
            rawPrice: pending.rawPrice, rawCurrency: pending.rawCurrency,
            priceModel: pending.priceModel, tradeShipCount: g_tradeShipCount
        });
        return;
    }
    if (pending.warningSeen) {
        if (Date.now() - Number(pending.warningAt || Date.now()) < g_serverRequestSpacingMs) {
            scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, 1000);
            return;
        }
        if (!pending.undoInvoked && binding &&
                currentTradeWaitingUid(binding) === String(pending.uid)) {
            pressCurrentTradeUndoWaitingItem(bridge, binding);
            pending.undoInvoked = true;
            pending.phase = '撤回并跳过暂不可出售物品';
            scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, g_serverRequestSpacingMs);
            return;
        }
        if (binding && currentTradeWaitingUid(binding) === '0') {
            skipCurrentTradeShipPending(pending, '已确认暂不可出售提示并撤回物品');
            return;
        }
    }
    if (!pending.finalizeDiagnosticAt || Date.now() - pending.finalizeDiagnosticAt >= 10000) {
        pending.finalizeDiagnosticAt = Date.now();
        tradeShipLog('等待交易船上传回报：槽位 ' + (pending.targetSlot + 1) +
            '，等待编号=' + (binding ? currentTradeWaitingUid(binding) : '槽位失效') +
            '，仓库编号=' + savedUid + '，来源已移除=' + originalGone +
            '，等待栏已清空=' + waitingCleared + '，冷却已更新=' + cooldownStarted +
            '，上传按钮已触发=' + pending.uploadInvoked + '。');
    }
    if (Date.now() - pending.confirmedAt >= g_tradeShipConfirmTimeoutMs) {
        finishAutoTradeShipTimeout(pending);
        return;
    }
    scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, 1000);
}

function processCurrentTradeSlotProbe() {
    g_tradeShipProbeQueued = false;
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    var now = Date.now();
    g_tradeShipLastSlotLayout = {
        rawListCount: view.slots.length, validSlotCount: view.validCount,
        excludedTemplateCount: view.slots.length - view.validCount
    };
    for (var i = 0; i < view.validCount; i++) {
        var binding = currentTradeSlot(bridge, view, i);
        var uid = currentTradeSavedUid(binding);
        var cooldownRaw = currentTradeCooldownRaw(binding);
        if (uid === '0' || currentTradeWaitingUid(binding) !== '0' || cooldownRaw === '0' ||
                !currentTradeCooldownExpired(cooldownRaw)) {
            continue;
        }
        bridge.pointerEnter.fn(binding.slot, ptr(0), bridge.pointerEnter.mi);
        try {
            var background = binding.slot.add(
                AUTO_TRADE_SHIP_BRIDGE_CURRENT.downloadButtonBackgroundOffset).readPointer();
            if (isBadPtr(background) || !bridge.gameObjectActiveSelf.fn(
                    background, bridge.gameObjectActiveSelf.mi)) continue;
            var button = binding.slot.add(
                AUTO_TRADE_SHIP_BRIDGE_CURRENT.downloadButtonOffset).readPointer();
            if (isBadPtr(button)) continue;
            var click = button.add(bridge.buttonClickEventOffset).readPointer();
            if (isBadPtr(click)) continue;
            var runtimeCalls = click.add(0x10).readPointer();
            if (isBadPtr(runtimeCalls)) continue;
            var calls = runtimeCalls.add(0x18).readPointer();
            if (isBadPtr(calls)) continue;
            if (calls.add(0x18).readS32() !== 1) continue;
            var callItems = calls.add(0x10).readPointer();
            if (isBadPtr(callItems)) continue;
            var invokable = callItems.add(0x20).readPointer();
            if (isBadPtr(invokable)) continue;
            var action = invokable.add(0x10).readPointer();
            if (isBadPtr(action)) continue;
            if (!sameNativePointer(action.add(0x20).readPointer(), binding.slot)) continue;
            var listenerMethod = action.add(0x28).readPointer();
            if (isBadPtr(listenerMethod) ||
                    (methodPtr(listenerMethod).sub(B).toInt32() >>> 0) !== 0xbc3e90) continue;
            var key = '槽位:' + i;
            g_tradeShipReleasePending = {
                uid: key, savedUid: uid, slotIndex: i, requestedAt: now
            };
            var buttonGameObject = bridge.componentGameObject.fn(
                button,
                bridge.componentGameObject.mi
            );
            var buttonActiveInHierarchy = !isBadPtr(buttonGameObject) &&
                !!bridge.gameObjectActiveInHierarchy.fn(
                    buttonGameObject,
                    bridge.gameObjectActiveInHierarchy.mi
                );
            var clickMode = '原生按钮按压';
            if (buttonActiveInHierarchy) {
                bridge.buttonPress.fn(button, bridge.buttonPress.mi);
            } else {
                bridge.unityEventInvoke.fn(click, bridge.unityEventInvoke.mi);
                clickMode = '后台原生按钮事件';
            }
            scheduleAutoTradeShipReleaseAction('tradeShipReleaseFinalize', key, 500);
            tradeShipLog('已触发交易船第 ' + (i + 1) + ' 格冷却完成后的 X（' + clickMode + '），等待槽位刷新。');
            return;
        } finally {
            bridge.pointerExit.fn(binding.slot, ptr(0), bridge.pointerExit.mi);
        }
    }
    g_tradeShipQueued = false;
    g_tradeShipSlotProbeFreshUntil = now + g_tradeShipSlotCheckIntervalMs;
    // Finish this check's slot probe and continue the same trade-ship round;
    // otherwise the first probe consumes the full user interval without ever
    // attempting to fill an empty slot.
    g_autoTradeShipNextCheckAt = 0;
}

function processCurrentTradeReleaseFinalize(item) {
    var pending = g_tradeShipReleasePending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    var binding = currentTradeSlot(bridge, view, pending.slotIndex);
    if (binding && currentTradeSavedUid(binding) === '0' &&
            currentTradeCooldownRaw(binding) === '0') {
        g_tradeShipReleaseCount++;
        g_lastTradeShipResult = '交易船第 ' + (pending.slotIndex + 1) + ' 格已恢复可用';
        clearTradeShipReleasePending();
        g_tradeShipSlotProbeFreshUntil = 0;
        return;
    }
    if (Date.now() - pending.requestedAt >= g_tradeShipReleaseConfirmMs) {
        g_lastTradeShipResult = '交易船冷却槽清理状态未刷新，稍后重试';
        clearTradeShipReleasePending();
        g_tradeShipSlotProbeFreshUntil = Date.now() + g_tradeShipSlotCheckIntervalMs;
        return;
    }
    scheduleAutoTradeShipReleaseAction('tradeShipReleaseFinalize', pending.uid, 500);
}

function runCurrentTradeShipPass(reason, scannedRows) {
    if (g_tradeShipPending || g_tradeShipReleasePending || g_tradeShipQueued) {
        return tradeShipState('自动交易船任务正在执行');
    }
    if (g_queue.length || g_depositQueued || g_fullBackpackDepositActive ||
            g_synthesisBatchQueued || g_synthesisCleanupQueued || g_pendingSynthesisSignature ||
            g_boxOpenInFlight || g_bossStageQueued) {
        // A due trade-ship pass is deferred while another server mutation owns
        // the queue; resume it as soon as that operation finishes rather than
        // consuming the whole hourly interval before any slot is checked.
        g_autoTradeShipNextCheckAt = 0;
        return tradeShipState('等待其他游戏操作完成');
    }
    var now = Date.now();
    Object.keys(g_tradeShipRejectedUids).forEach(function (uid) {
        if ((g_tradeShipRejectedUids[uid].retryAt || 0) <= now) delete g_tradeShipRejectedUids[uid];
    });
    Object.keys(g_tradeShipQueuedUids).forEach(function (uid) {
        var placements = tradeShipPlacementSources(uid);
        if (!placements.some(function (entry) { return entry.source === '交易船'; })) {
            delete g_tradeShipQueuedUids[uid];
        }
    });
    if (g_tradeShipSlotProbeFreshUntil <= now) {
        if (enqueueTradeShipSlotProbe()) return tradeShipState('正在检查交易船槽位与冷却 X');
        return tradeShipState('等待游戏主线程检查交易船槽位');
    }
    var bridge = resolveCurrentTradeBridge();
    var view = currentTradeUiAndSlots(bridge);
    if (!scannedRows) scanInventory();
    var salePopup=currentTradeSaleRestrictionPopup(bridge);
    var unlistedWaiting=[];
    for (var wi=0;wi<view.validCount;wi++) {
        var wb=currentTradeSlot(bridge,view,wi);
        if (currentTradeSavedUid(wb)==='0' && currentTradeWaitingUid(wb)!=='0')
            unlistedWaiting.push({slot:wi,uid:currentTradeWaitingUid(wb)});
    }
    if (salePopup.active && unlistedWaiting.length!==1)
        return tradeShipState('暂不可出售提示存在，但待确认物品不唯一；请先手动确认提示，避免误标记');
    for (var slotIndex = 0; slotIndex < view.validCount; slotIndex++) {
        var waitingBinding = currentTradeSlot(bridge, view, slotIndex);
        // A listed slot retains its original waiting UID. Do not adopt it again
        // for confirmation, which would re-upload an already accepted item.
        if (currentTradeSavedUid(waitingBinding) !== '0') continue;
        var waitingUid = currentTradeWaitingUid(waitingBinding);
        if (waitingUid === '0') continue;
        var deferredUntil=tradeShipDeferredUntil(waitingUid);
        if (deferredUntil && !salePopup.active &&
                Number(g_tradeShipDeferredCleanupRetryAt[String(waitingUid)]||0)>now) continue;
        var rejectedWaiting = g_tradeShipRejectedUids[String(waitingUid)];
        if (!salePopup.active && !deferredUntil && rejectedWaiting && (rejectedWaiting.retryAt || 0) > now) continue;
        var waitingRows = (g_lastPlacedRows || []).filter(function (row) {
            return String(row.uid) === waitingUid;
        });
        if (waitingRows.length !== 1 || tradeShipPlacementSources(waitingUid).length !== 1) {
            return tradeShipState('交易船第 ' + (slotIndex + 1) + ' 格有待确认物品，但来源记录不唯一');
        }
        var waitingSource = tradeShipSource(waitingRows[0]);
        if (!waitingSource) return tradeShipState('交易船待确认物品来源无效');
        beginAutoTradeShipPending(waitingRows[0], waitingSource, slotIndex, true);
        if (salePopup.active || deferredUntil) {
            // Resume a rejected item after reconnect without re-dispatching upload.
            g_tradeShipPending.uploadInvoked=true;
            if (!salePopup.active && deferredUntil) {
                g_tradeShipPending.saleRestricted=true;
                g_tradeShipPending.saleAvailableAt=deferredUntil;
                g_tradeShipPending.saleWarningAt=Date.now();
            }
        }
        return tradeShipState('已接管交易船第 ' + (slotIndex + 1) + ' 格待确认物品', true);
    }
    if (firstAvailableCurrentTradeSlot(bridge, view) < 0) {
        return tradeShipState('交易船暂时没有空位');
    }
    if (!g_marketPriceItemCount) return tradeShipState('等待 TBH Index/Steam 市场人民币报价');
    if (g_autoDepositUnsynthable && g_lastSourceCounts && g_lastSourceCounts.backpackFull) {
        g_autoTradeShipNextCheckAt = 0;
        return tradeShipState('背包已满，等待自动存仓先清理背包');
    }
    var eligible = (g_lastPlacedRows || []).filter(autoTradeShipCandidate);
    eligible.sort(compareAutoTradeShipRows);
    g_lastTradeShipCandidateCount = eligible.length;
    if (!eligible.length) return tradeShipState('当前没有达到价格条件的可交易物品');
    if (!ensureUpdateHook()) return tradeShipState('游戏主线程任务队列挂载失败');
    g_tradeShipQueued = true;
    g_queue.push({ action: 'tradeShipItem', row: eligible[0], reason: reason || '', at: now });
    return tradeShipState('已安排物品编号 ' + eligible[0].itemKey + ' 移入交易船', true);
}

function processAutoTradeShipConfirmQueueItem(item) {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return processCurrentTradeConfirm(item);
    }
    var pending = g_tradeShipPending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveAutoTradeShipBridge();
    var binding = null;
    try { binding = findTradingStashSlotBinding(bridge, pending.uid, pending.targetSlot); } catch (e) {}
    var waiting = tradeShipWaitingContains(bridge, pending.uid);
    if (!binding) {
        if (Date.now() - pending.startedAt >= g_tradeShipConfirmTimeoutMs) {
            finishAutoTradeShipTimeout(pending);
            return;
        }
        pending.phase = waiting ? '等待交易槽绑定物品' : '等待游戏接受移入请求';
        scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, 350);
        return;
    }

    var slotItem = ptr(0);
    try { slotItem = binding.slot.add(AUTO_TRADE_SHIP_BRIDGE.slotItemOffset).readPointer(); } catch (e2) {}
    if (isObviouslyInvalidPtr(slotItem)) {
        if (Date.now() - pending.startedAt >= g_tradeShipConfirmTimeoutMs) {
            finishAutoTradeShipTimeout(pending);
            return;
        }
        pending.phase = '等待交易槽物品数据刷新';
        scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, 350);
        return;
    }

    pending.targetSlot = binding.index;
    if (!pending.waitingLogged) {
        pending.waitingLogged = true;
        tradeShipLog('已加入交易船等待栏：物品编号 ' + pending.itemKey +
            '，交易船第 ' + (binding.index + 1) + ' 格，正在自动确认。');
    }

    if (!pending.uploadInvoked) {
        bridge.uploadButton.fn(binding.slot, bridge.uploadButton.mi);
        pending.uploadInvoked = true;
        pending.phase = '等待上传与确认操作间隔';
        scheduleAutoTradeShipAction('tradeShipConfirm', pending.uid, g_serverRequestSpacingMs);
        return;
    }
    var callback = ptr(0);
    try { callback = binding.ui.add(AUTO_TRADE_SHIP_BRIDGE.pendingConfirmOffset).readPointer(); } catch (e3) {}
    if (!isObviouslyInvalidPtr(callback)) {
        bridge.confirmButton.fn(binding.ui, bridge.confirmButton.mi);
        pending.confirmationMode = '已执行确认按钮';
    } else {
        pending.confirmationMode = '游戏已直接提交';
    }
    pending.phase = '等待服务器确认';
    pending.confirmedAt = Date.now();
    g_lastTradeShipResult = '已发送交易船确认：物品编号 ' + pending.itemKey;
    tradeShipLog(g_lastTradeShipResult + '。');
    scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, 750);
}

function processAutoTradeShipFinalizeQueueItem(item) {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return processCurrentTradeFinalize(item);
    }
    var pending = g_tradeShipPending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveAutoTradeShipBridge();
    var placements = tradeShipPlacementSources(pending.uid);
    var inTradeShip = placements.some(function (entry) { return entry.source === '交易船'; });
    var sourceStillPresent = placements.some(function (entry) {
        return entry.source === pending.source.source && entry.index === pending.source.index;
    });
    var waiting = tradeShipWaitingContains(bridge, pending.uid);
    var binding = null;
    try { binding = findTradingStashSlotBinding(bridge, pending.uid, pending.targetSlot); } catch (e) {}
    var slotStillWaiting = binding != null;

    if (inTradeShip || (!sourceStillPresent && !waiting && !slotStillWaiting)) {
        clearAutoTradeShipPending(false);
        g_autoTradeShipNextCheckAt = 0;
        g_tradeShipQueuedUids[String(pending.uid)] = true;
        g_tradeShipCount++;
        g_lastTradeShipAt = Date.now();
        g_lastTradeShipResult = '交易船确认完成：物品编号 ' + pending.itemKey +
            '，Steam 市场价格 ¥' + Number(pending.priceCny || 0).toFixed(2);
        emit('auto_trade_ship_completed', {
            uid: pending.uid,
            itemKey: pending.itemKey,
            source: pending.source.source,
            sourceIndex: pending.source.index,
            targetSlot: pending.targetSlot,
            priceCny: pending.priceCny,
            marketName: pending.marketName,
            priceSource: pending.priceSource,
            quoteUpdatedAt: pending.quoteUpdatedAt,
            rawPrice: pending.rawPrice,
            rawCurrency: pending.rawCurrency,
            priceModel: pending.priceModel,
            confirmationMode: pending.confirmationMode,
            tradeShipCount: g_tradeShipCount
        });
        return;
    }

    if (Date.now() - pending.confirmedAt >= g_tradeShipConfirmTimeoutMs) {
        finishAutoTradeShipTimeout(pending);
        return;
    }
    scheduleAutoTradeShipAction('tradeShipFinalize', pending.uid, 1000);
}

function scheduleAutoTradeShipReleaseAction(action, uid, delayMs) {
    setTimeout(function () {
        if (!g_running || (!g_autoTradeShipEnabled && !g_tradeShipManualRunActive) || !g_tradeShipReleasePending) return;
        if (String(g_tradeShipReleasePending.uid) !== String(uid)) return;
        if (!ensureUpdateHook()) {
            scheduleAutoTradeShipReleaseAction(action, uid, 1000);
            return;
        }
        g_queue.push({ action: action, uid: String(uid), at: Date.now() });
    }, Math.max(50, delayMs | 0));
}

function enqueueTradeShipSlotProbe() {
    if (g_tradeShipProbeQueued || g_tradeShipReleasePending) return false;
    if (!ensureUpdateHook()) return false;
    g_tradeShipProbeQueued = true;
    g_tradeShipQueued = true;
    g_queue.push({ action: 'tradeShipProbeSlots', at: Date.now() });
    return true;
}

function tradeShipReleaseXVisible(bridge, binding) {
    var background = ptr(0);
    try {
        background = binding.slot.add(
            AUTO_TRADE_SHIP_BRIDGE.downloadButtonBackgroundOffset
        ).readPointer();
    } catch (e) {}
    if (isObviouslyInvalidPtr(background)) return false;
    return !!bridge.gameObjectActiveSelf.fn(
        background,
        bridge.gameObjectActiveSelf.mi
    );
}

function hideTradeShipHover(bridge, slot) {
    try { bridge.pointerExit.fn(slot, ptr(0), bridge.pointerExit.mi); } catch (e) {}
}

function tradeShipCooldownSyncSummary() {
    var elapsedEnd = g_tradeShipCooldownSync.completedAt || Date.now();
    return {
        phase: g_tradeShipCooldownSync.phase,
        requestedAt: g_tradeShipCooldownSync.requestedAt || 0,
        completedAt: g_tradeShipCooldownSync.completedAt || 0,
        elapsedMs: g_tradeShipCooldownSync.requestedAt ?
            elapsedEnd - g_tradeShipCooldownSync.requestedAt : 0,
        timedOut: g_tradeShipCooldownSync.timedOut === true,
        error: g_tradeShipCooldownSync.error || '',
        closureDone: g_tradeShipCooldownSync.closureDone === true
    };
}

function releaseTradeShipCooldownSyncHandles(bridge) {
    if (!bridge) return;
    try {
        if (g_tradeShipCooldownSync.delegateHandle) {
            bridge.gchandleFree(g_tradeShipCooldownSync.delegateHandle);
        }
    } catch (e) {}
    try {
        if (g_tradeShipCooldownSync.closureHandle) {
            bridge.gchandleFree(g_tradeShipCooldownSync.closureHandle);
        }
    } catch (e2) {}
    g_tradeShipCooldownSync.delegateHandle = 0;
    g_tradeShipCooldownSync.closureHandle = 0;
}

function pollTradeShipCooldownSync(bridge) {
    var state = g_tradeShipCooldownSync;
    if (state.phase !== '等待服务器回调' && state.phase !== '等待服务器回调超时') {
        return state;
    }
    var done = false;
    try {
        done = !isObviouslyInvalidPtr(state.closure) && state.closure.add(0x18).readU8() !== 0;
    } catch (e) {
        state.error = String(e);
    }
    if (done) {
        state.closureDone = true;
        state.phase = '同步完成';
        state.completedAt = Date.now();
        releaseTradeShipCooldownSyncHandles(bridge);
        return state;
    }
    if (state.requestedAt && Date.now() - state.requestedAt >= g_tradeShipCooldownSyncTimeoutMs) {
        state.phase = '等待服务器回调超时';
        state.timedOut = true;
    }
    return state;
}

function beginTradeShipCooldownSync(bridge) {
    var current = pollTradeShipCooldownSync(bridge);
    if (current.phase === '等待服务器回调' || current.phase === '等待服务器回调超时' ||
            current.phase === '同步完成') return current;
    var state = {
        phase: '创建原生同步回调',
        requestedAt: 0,
        completedAt: 0,
        timedOut: false,
        closureDone: false,
        error: '',
        closure: ptr(0),
        delegate: ptr(0),
        closureHandle: 0,
        delegateHandle: 0
    };
    g_tradeShipCooldownSync = state;
    try {
        var qiArgument = B.add(
            AUTO_TRADE_SHIP_BRIDGE.qiSingletonArgumentRva
        ).readPointer();
        if (isObviouslyInvalidPtr(qiArgument)) throw new Error('游戏启动管理器方法信息为空');
        var qi = bridge.singletonGetter.fn(qiArgument);
        if (isObviouslyInvalidPtr(qi)) throw new Error('游戏启动管理器实例为空');
        var closureClass = B.add(AUTO_TRADE_SHIP_BRIDGE.qiPzTypeInfoRva).readPointer();
        var actionClass = B.add(AUTO_TRADE_SHIP_BRIDGE.actionWgTypeInfoRva).readPointer();
        var callbackMethodInfo = B.add(
            AUTO_TRADE_SHIP_BRIDGE.qiPzHcbMethodInfoRva
        ).readPointer();
        if (isObviouslyInvalidPtr(closureClass) || isObviouslyInvalidPtr(actionClass) ||
                isObviouslyInvalidPtr(callbackMethodInfo)) {
            throw new Error('游戏冷却同步回调类型尚未初始化');
        }
        if (!sameNativePointer(callbackMethodInfo, bridge.cooldownSyncCallback.mi)) {
            throw new Error('游戏冷却同步回调方法信息校验失败');
        }
        var closure = bridge.objectNew(closureClass);
        if (isObviouslyInvalidPtr(closure)) throw new Error('游戏冷却同步闭包创建失败');
        bridge.objectCtor(closure, ptr(0));
        bridge.writeBarrier(closure.add(0x38), qi);
        var callback = bridge.objectNew(actionClass);
        if (isObviouslyInvalidPtr(callback)) throw new Error('游戏冷却同步委托创建失败');
        bridge.delegateCtor(callback, closure, callbackMethodInfo, ptr(0));
        if (!sameNativePointer(
                callback.add(AUTO_TRADE_SHIP_BRIDGE.delegateTargetOffset).readPointer(),
                closure
            ) || !sameNativePointer(
                callback.add(AUTO_TRADE_SHIP_BRIDGE.delegateMethodInfoOffset).readPointer(),
                callbackMethodInfo
            )) {
            throw new Error('游戏冷却同步委托绑定校验失败');
        }
        state.closure = closure;
        state.delegate = callback;
        state.closureHandle = bridge.gchandleNew(closure, false);
        state.delegateHandle = bridge.gchandleNew(callback, false);
        state.requestedAt = Date.now();
        state.phase = '等待服务器回调';
        bridge.cooldownSyncRequest.fn(callback, bridge.cooldownSyncRequest.mi);
    } catch (e) {
        state.phase = '同步失败';
        state.error = String(e);
        state.completedAt = Date.now();
        releaseTradeShipCooldownSyncHandles(bridge);
    }
    return state;
}

function scheduleTradeShipSlotProbeAfterSync(delayMs) {
    if (g_tradeShipProbeQueued) return;
    g_tradeShipProbeQueued = true;
    setTimeout(function () {
        if (!g_running || (!g_autoTradeShipEnabled && !g_tradeShipManualRunActive)) {
            g_tradeShipProbeQueued = false;
            g_tradeShipQueued = false;
            return;
        }
        if (!ensureUpdateHook()) {
            g_tradeShipProbeQueued = false;
            g_tradeShipQueued = false;
            return;
        }
        g_queue.push({ action: 'tradeShipProbeSlots', at: Date.now() });
    }, Math.max(100, delayMs | 0));
}

function processAutoTradeShipSlotProbeQueueItem() {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return processCurrentTradeSlotProbe();
    }
    g_tradeShipProbeQueued = false;
    if (!g_running || (!g_autoTradeShipEnabled && !g_tradeShipManualRunActive)) {
        g_tradeShipQueued = false;
        return;
    }
    var bridge = resolveAutoTradeShipBridge();
    var bindings = listTradingStashSlotBindings(bridge);
    var now = Date.now();
    g_tradeShipLastSlotLayout = {
        rawListCount: bindings.rawListCount | 0,
        validSlotCount: bindings.validSlotCount | 0,
        excludedTemplateCount: bindings.excludedTemplateCount | 0
    };
    if (!TRADE_SHIP_X_EXECUTION_ENABLED) {
        g_tradeShipQueued = false;
        g_tradeShipSlotProbeFreshUntil = now + g_tradeShipSlotCheckIntervalMs;
        return;
    }

    var missingCooldown = false;
    for (var stateIndex = 0; stateIndex < bindings.length; stateIndex++) {
        var readState = tradeShipSlotUiState(bridge, bindings[stateIndex]);
        if (readState.cacheOccupied && !readState.cooldownKnown) {
            missingCooldown = true;
            break;
        }
    }
    if (missingCooldown) {
        var syncState = pollTradeShipCooldownSync(bridge);
        if (syncState.phase === '未请求' || syncState.phase === '同步失败') {
            syncState = beginTradeShipCooldownSync(bridge);
        }
        if (syncState.phase === '等待服务器回调') {
            g_tradeShipQueued = true;
            scheduleTradeShipSlotProbeAfterSync(250);
            return;
        }
        if (syncState.phase === '等待服务器回调超时') {
            g_tradeShipQueued = false;
            g_tradeShipSlotProbeFreshUntil = now + g_tradeShipSlotCheckIntervalMs;
            g_lastTradeShipResult = '交易船冷却数据同步仍在等待服务器回调，本轮不执行 X';
            return;
        }
        if (syncState.phase === '同步失败') {
            g_tradeShipQueued = false;
            g_tradeShipSlotProbeFreshUntil = now + g_tradeShipSlotCheckIntervalMs;
            g_lastTradeShipResult = '交易船冷却数据同步失败，本轮不执行 X';
            return;
        }
    }

    for (var i = 0; i < bindings.length; i++) {
        var binding = bindings[i];
        var state = applyTradeShipAuthoritativeCooldown(bridge, binding);
        var uid = tradeShipCacheSavedUid(binding.cache);
        var releaseKey = '槽位:' + binding.index;
        if (!state.readyForRelease) continue;
        if ((g_tradeShipReleaseRetryAt[releaseKey] || 0) > now) continue;
        bridge.pointerEnter.fn(binding.slot, ptr(0), bridge.pointerEnter.mi);
        if (!tradeShipReleaseXVisible(bridge, binding)) {
            hideTradeShipHover(bridge, binding.slot);
            continue;
        }
        var listener = tradeShipReleaseListenerState(bridge, binding);
        if (!listener.valid) {
            hideTradeShipHover(bridge, binding.slot);
            continue;
        }
        g_tradeShipReleasePending = {
            uid: releaseKey,
            savedUid: String(uid || '0'),
            slotIndex: binding.index,
            startedAt: now,
            requestedAt: now,
            listenerInvoked: true,
            clickMode: ''
        };
        g_tradeShipNextSlotCheckAt = 0;
        g_tradeShipSlotProbeFreshUntil = 0;
        var buttonGameObject = bridge.componentGameObject.fn(
            listener.button,
            bridge.componentGameObject.mi
        );
        var buttonActiveInHierarchy = !isObviouslyInvalidPtr(buttonGameObject) &&
            !!bridge.gameObjectActiveInHierarchy.fn(
                buttonGameObject,
                bridge.gameObjectActiveInHierarchy.mi
            );
        if (buttonActiveInHierarchy) {
            bridge.buttonPress.fn(listener.button, bridge.buttonPress.mi);
            g_tradeShipReleasePending.clickMode = '原生按钮按压';
        } else {
            bridge.unityEventInvoke.fn(listener.onClick, bridge.unityEventInvoke.mi);
            g_tradeShipReleasePending.clickMode = '原生按钮事件';
        }
        hideTradeShipHover(bridge, binding.slot);
        tradeShipLog('已点击交易船第 ' + (binding.index + 1) + ' 格冷却完成后显示的 X，等待槽位恢复可用。');
        scheduleAutoTradeShipReleaseAction('tradeShipReleaseFinalize', releaseKey, 500);
        return;
    }

    g_tradeShipQueued = false;
    g_tradeShipSlotProbeFreshUntil = now + g_tradeShipSlotCheckIntervalMs;
    logTradeShipSlotDiagnostics(bridge, false);
    g_autoTradeShipNextCheckAt = 0;
}

function clearTradeShipReleasePending() {
    g_tradeShipReleasePending = null;
    g_tradeShipQueued = false;
}

function processAutoTradeShipReleaseQueueItem(item) {
    var pending = g_tradeShipReleasePending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    // 兼容升级前残留的旧队列：不再直接调用旧下载入口，统一重新走
    // OnPointerEnter -> X 可见 -> Button.Press()。
    clearTradeShipReleasePending();
    g_tradeShipSlotProbeFreshUntil = 0;
    g_tradeShipNextSlotCheckAt = 0;
    enqueueTradeShipSlotProbe();
}

function processAutoTradeShipReleaseFinalizeQueueItem(item) {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return processCurrentTradeReleaseFinalize(item);
    }
    var pending = g_tradeShipReleasePending;
    if (!pending || String(pending.uid) !== String(item.uid)) return;
    var bridge = resolveAutoTradeShipBridge();
    var binding = null;
    try { binding = findTradingStashSlotBindingByIndex(bridge, pending.slotIndex); } catch (e) {}
    var occupied = binding ? tradeShipCacheOccupied(bridge, binding.cache) : false;
    if (!binding || !occupied) {
        delete g_tradeShipReleaseRetryAt[String(pending.uid)];
        g_tradeShipReleaseCount++;
        g_tradeShipNextSlotCheckAt = 0;
        g_tradeShipSlotProbeFreshUntil = Date.now() + 5000;
        g_lastTradeShipResult = '交易船第 ' + (pending.slotIndex + 1) + ' 格已恢复可用';
        tradeShipLog('冷却结束后已自动执行 X：交易船第 ' + (pending.slotIndex + 1) + ' 格已恢复可用。');
        clearTradeShipReleasePending();
        return;
    }
    if (Date.now() - pending.requestedAt >= g_tradeShipReleaseConfirmMs) {
        g_tradeShipReleaseRetryAt[String(pending.uid)] = Date.now() + g_tradeShipSlotCheckIntervalMs;
        g_tradeShipNextSlotCheckAt = Date.now() + g_tradeShipSlotCheckIntervalMs;
        g_tradeShipSlotProbeFreshUntil = 0;
        g_lastTradeShipResult = '交易船冷却槽清理状态暂未刷新，1 分钟后重试';
        logTradeShipSlotDiagnostics(bridge, true);
        clearTradeShipReleasePending();
        return;
    }
    scheduleAutoTradeShipReleaseAction('tradeShipReleaseFinalize', pending.uid, 500);
}

function processAutoTradeShipQueueItem(item) {
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return processCurrentTradeItem(item);
    }
    var row = item && item.row;
    if (!row || !row.uid) throw new Error('自动交易船候选物品无效');
    var source = tradeShipSource(row);
    if (!source) {
        g_tradeShipQueued = false;
        tradeShipState('候选物品位置已经变化，将重新扫描');
        return;
    }
    var currentSources = tradeShipPlacementSources(row.uid);
    var inExpectedSource = currentSources.some(function (entry) {
        return entry.source === source.source && entry.index === source.index;
    });
    var alreadyInTradeShip = currentSources.some(function (entry) { return entry.source === '交易船'; });
    if (!inExpectedSource || alreadyInTradeShip) {
        g_tradeShipQueued = false;
        tradeShipState('候选物品位置已经变化，将重新扫描');
        return;
    }

    var bridge = resolveAutoTradeShipBridge();
    var manager = findTradeShipMoveManager();
    if (isObviouslyInvalidPtr(manager)) {
        g_tradeShipQueued = false;
        tradeShipState('等待游戏交易船管理器初始化');
        return;
    }
    var targetSlot = bridge.firstAvailableSlot.fn(bridge.firstAvailableSlot.mi);
    if (targetSlot < 0) {
        g_tradeShipQueued = false;
        g_tradeShipNextSlotCheckAt = Date.now() + g_tradeShipSlotCheckIntervalMs;
        g_tradeShipSlotProbeFreshUntil = 0;
        tradeShipState('游戏原生交易船状态确认没有可用空位，等待冷却槽恢复');
        return;
    }
    g_tradeShipNextSlotCheckAt = 0;

    bridge.moveDirect.fn(
        manager,
        source.slotType,
        source.index,
        ptr(0),
        3,
        bridge.moveDirect.mi
    );
    beginAutoTradeShipPending(row, source, targetSlot, false);
    tradeShipState('已发送移入交易船请求：物品编号 ' + row.itemKey + '，等待交易槽刷新', true);
}

function runAutoTradeShipPass(reason, scannedRows, force) {
    force = force === true || g_tradeShipManualRunActive;
    if (!g_autoTradeShipEnabled && !force) return '自动交易船开关已关闭';
    var checkNow = Date.now();
    if (!force && checkNow < g_autoTradeShipNextCheckAt) return '自动交易船等待设定检测间隔';
    if (!force) g_autoTradeShipNextCheckAt = checkNow + g_autoTradeShipIntervalMs;
    if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
        return runCurrentTradeShipPass(reason, scannedRows);
    }
    if (g_tradeShipPending || g_tradeShipReleasePending || g_tradeShipQueued) {
        return tradeShipState('自动交易船任务正在执行');
    }
    if (g_queue.length || g_depositQueued || g_fullBackpackDepositActive ||
            g_synthesisBatchQueued || g_synthesisCleanupQueued || g_pendingSynthesisSignature ||
            g_boxOpenInFlight || g_bossStageQueued) {
        return tradeShipState('等待其他游戏操作完成');
    }
    if (g_tradeShipNextSlotCheckAt > Date.now()) {
        return tradeShipState('所有交易船槽位暂不可用，按 1 分钟间隔等待下次检测');
    }
    var bridge = null;
    try {
        bridge = resolveAutoTradeShipBridge();
    } catch (bridgeError) {
        return tradeShipState('交易船入口解析失败：' + chineseError(bridgeError), true);
    }
    pruneTradeShipRuntimeState(bridge);
    if (g_tradeShipSlotProbeFreshUntil <= Date.now()) {
        if (enqueueTradeShipSlotProbe()) {
            return tradeShipState('正在按游戏界面的真实 X 状态检测交易船槽位');
        }
        return tradeShipState('等待游戏主线程检测交易船槽位');
    }
    if (g_marketPriceItemCount && !marketPriceIsFresh()) {
        return tradeShipState('TBH Index/Steam 报价超过 1 小时，等待报价缓存刷新后再执行自动转入');
    }
    if (!g_marketPriceItemCount) {
        return tradeShipState('等待 TBH Index/Steam 市场人民币报价');
    }
    if (g_autoDepositUnsynthable && g_lastSourceCounts && g_lastSourceCounts.backpackFull) {
        return tradeShipState('背包已满，等待自动存仓优先清理背包');
    }
    if (!scannedRows) scanInventory();
    var baseEligibleRows = (g_lastPlacedRows || []).filter(function (row) {
        return autoTradeShipBaseEligible(row, true);
    });
    g_lastTradeShipPriceFilteredCount = baseEligibleRows.filter(function (row) {
        return !autoTradeShipMeetsPriceFloor(row);
    }).length;
    var eligibleRows = baseEligibleRows.filter(function (row) {
        return autoTradeShipMeetsPriceFloor(row);
    });
    eligibleRows.sort(compareAutoTradeShipRows);
    for (var waitingIndex = 0; waitingIndex < eligibleRows.length; waitingIndex++) {
        var waitingRow = eligibleRows[waitingIndex];
        if (!tradeShipWaitingContains(bridge, waitingRow.uid)) continue;
        beginAutoTradeShipPending(waitingRow, tradeShipSource(waitingRow), -1, true);
        return tradeShipState(
            '检测到交易船等待栏中有未确认物品，已接管确认：物品编号 ' + waitingRow.itemKey,
            true
        );
    }
    var candidates = (g_lastPlacedRows || []).filter(autoTradeShipCandidate);
    candidates.sort(compareAutoTradeShipRows);
    g_lastTradeShipCandidateCount = candidates.length;
    if (!candidates.length) {
        if (g_tradeShipMinPriceCny > 0 && g_lastTradeShipPriceFilteredCount > 0) {
            return tradeShipState('当前没有达到最低上架价格 ¥' +
                g_tradeShipMinPriceCny.toFixed(2) + ' 的可交易物品，已过滤 ' +
                g_lastTradeShipPriceFilteredCount + ' 件');
        } else {
            return tradeShipState('当前没有带有效 Steam 市场价格的可交易物品');
        }
    }
    if (!ensureUpdateHook()) {
        return tradeShipState('游戏主线程任务队列挂载失败');
    }
    g_tradeShipQueued = true;
    g_queue.push({
        action: 'tradeShipItem',
        row: candidates[0],
        reason: reason || '',
        at: Date.now()
    });
    var priceRow = g_marketPriceItems[String(candidates[0].itemKey)] || {};
    var priceCny = Number(priceRow.priceCny || 0);
    return tradeShipState('已安排最高价物品：物品编号 ' + candidates[0].itemKey +
        '，Steam 市场价格 ¥' + priceCny.toFixed(2), true);
}

function synthesisGradeIdentity(item) {
    if (item && item.gradeValue != null && String(item.gradeValue).trim() !== '' &&
            isFinite(Number(item.gradeValue))) {
        return 'value:' + Number(item.gradeValue);
    }
    var key = item && item.gradeKey != null ? String(item.gradeKey).trim() : '';
    if (key) return 'key:' + key;
    return 'name:' + String(item && item.grade || '未知品级').trim();
}

function synthesisRecipeTierForLevel(categoryKey, level) {
    var bands = CURRENT_SYNTHESIS_LEVEL_BANDS[categoryKey] || [];
    var itemLevel = Number(level || 0);
    if (!bands.length) return { tier: 0, min: 0, max: 999999 };
    if (itemLevel <= 0) {
        var highest = bands[bands.length - 1];
        return { tier: Number(highest[0]), min: Number(highest[1]), max: Number(highest[2]) };
    }
    var selected = null;
    for (var i = 0; i < bands.length; i++) {
        var band = bands[i];
        if (itemLevel <= Number(band[2])) {
            if (!selected || Number(band[2]) < selected.max ||
                    (Number(band[2]) === selected.max && Number(band[0]) > selected.tier)) {
                selected = { tier: Number(band[0]), min: Number(band[1]), max: Number(band[2]) };
            }
        }
    }
    if (selected) return selected;
    var last = bands[bands.length - 1];
    return { tier: Number(last[0]), min: Number(last[1]), max: Number(last[2]) };
}

function groupRows(rows, options) {
    options = options || {};
    var threshold = Math.max(1, parseInt(options.threshold, 10) || g_threshold || 9);
    var cats = options.categories || g_categories;
    var maxGrades = options.maxGrades || g_maxGrades;
    var map = {};
    var currentBuild = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT;
    var mixedLevelPool = currentBuild && !g_sameLevelSynthesis;
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row.placed) continue;
        if (!row.synthable) continue;
        if (recentlyConsumedUid(row.uid)) continue;
        if (g_tradeShipQueuedUids[String(row.uid)]) continue;
        if (g_synthesisIgnoreItemIdSet[String(row.itemKey)] === true) continue;
        if (row.locked || row.equipped || row.serverPending || row.deletedInServer || row.temporaryBlocked) continue;
        if (cats && cats[row.categoryKey] === false) continue;
        if (synthesisGradeRejection(row, row.categoryKey, maxGrades)) continue;
        if (!options.ignoreRuntimeRejections && runtimeSynthesisRejection(row)) continue;
        var units = synthesisUnitsForRow(row);
        var levelKey = g_sameLevelSynthesis ? String(row.level || 0) : '*';
        var gradeIdentity = synthesisGradeIdentity(row);
        var key = row.categoryKey + '|' + levelKey + '|g=' + gradeIdentity;
        if (!map[key]) {
            map[key] = {
                key: key,
                categoryKey: row.categoryKey,
                category: row.category,
                recipeTier: 0,
                recipeMinLevel: 0,
                recipeMaxLevel: currentBuild ? 999999 : 9999,
                levelKey: levelKey,
                level: Number(row.level || 0),
                gradeIdentity: gradeIdentity,
                grade: row.grade,
                gradeValue: row.gradeValue,
                gradeCounts: {},
                count: 0,
                batches: 0,
                items: [],
                mixedLevelPool: mixedLevelPool,
                recipeTiers: null
            };
        }
        map[key].count += units.length;
        map[key].gradeCounts[row.grade || '未知品级'] =
            (map[key].gradeCounts[row.grade || '未知品级'] || 0) + units.length;
        Array.prototype.push.apply(map[key].items, units);
    }
    var groups = Object.keys(map).map(function (k) {
        var g = map[k];
        var gradeNames = Object.keys(g.gradeCounts);
        if (gradeNames.length > 1) {
            g.grade = gradeNames.map(function (gradeName) {
                return gradeName + '×' + g.gradeCounts[gradeName];
            }).join('、');
        }
        g.items.sort(function (a, b) {
            return (b.level - a.level) || (a.itemKey - b.itemKey) || String(a.uid).localeCompare(String(b.uid));
        });
        if (g.items.length) g.level = Number(g.items[0].level || 0);
        if (currentBuild) {
            var recipe = synthesisRecipeTierForLevel(g.categoryKey, g.level);
            g.recipeTier = recipe.tier;
            g.recipeMinLevel = recipe.min;
            g.recipeMaxLevel = recipe.max;
            // Materials do not expose item levels in inventory data. Keep the
            // existing tier fallback so the game's own autofill can decide.
            g.recipeTiers = g.categoryKey === 'material' && g.items.every(function (item) {
                return Number(item.level || 0) <= 0;
            }) ? [9, 8, 7, 6, 5, 4, 3, 2, 1] : [recipe.tier];
        }
        g.key = g.categoryKey + '|' + g.recipeTier + '|' + g.levelKey + '|g=' + g.gradeIdentity;
        g.batches = Math.floor(g.count / threshold);
        g.ready = g.count >= threshold;
        g.previewUids = g.items.slice(0, threshold).map(function (x) { return x.uid; });
        return g;
    });
        groups.sort(function (a, b) {
        return b.batches - a.batches || b.count - a.count ||
            a.categoryKey.localeCompare(b.categoryKey) || b.recipeTier - a.recipeTier ||
            a.gradeValue - b.gradeValue;
    });
    return groups;
}

function synthesisUnitsForRow(row) {
    if (row.categoryKey !== 'material') return [row];
    var sources = row.sources || [];
    var totalQuantity = sources.reduce(function (total, source) {
        return total + materialStackQuantity(source);
    }, 0);
    var units = [];
    for (var i = 0; i < sources.length; i++) {
        var source = sources[i];
        var quantity = materialStackQuantity(source);
        for (var n = 0; n < quantity; n++) {
            units.push({
                uid: row.uid,
                itemKey: row.itemKey,
                categoryKey: row.categoryKey,
                category: row.category,
                gradeKey: row.gradeKey,
                grade: row.grade,
                gradeValue: row.gradeValue,
                level: row.level,
                sources: [source],
                totalQuantity: totalQuantity
            });
        }
    }
    return units;
}

function materialStackQuantity(source) {
    var quantity = parseInt(source && source.quantity, 10);
    if (!isFinite(quantity) || quantity < 1) quantity = 1;
    // Backpack stacks currently cap at five; the material warehouse exposes an
    // aggregate quantity for its UID. Truncating that aggregate corrupts the
    // before/after consumption delta (e.g. seven -> four looks like one).
    return quantity;
}

function runtimeSynthesisRejection(row, groupKey) {
    if (!row) return null;
    var prefix = String(row.uid) + '|';
    var keys = groupKey ? [prefix + groupKey] : Object.keys(g_runtimeSynthesisRejectedUids);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.indexOf(prefix) !== 0) continue;
        var rejection = g_runtimeSynthesisRejectedUids[key];
        if (rejection && rejection.retryAt && Date.now() >= rejection.retryAt) {
            delete g_runtimeSynthesisRejectedUids[key];
            continue;
        }
        if (rejection) return rejection;
    }
    return null;
}

function basicUsable(row) {
    return row.placed && row.synthable && !row.locked && !row.equipped && !row.serverPending &&
        !row.deletedInServer && !row.temporaryBlocked && !recentlyConsumedUid(row.uid) &&
        !g_tradeShipQueuedUids[String(row.uid)] &&
        !runtimeSynthesisRejection(row) &&
        g_synthesisIgnoreItemIdSet[String(row.itemKey)] !== true;
}

function summarizeCounts(rows) {
    var summary = {
        totalCandidates: rows.length,
        usableCandidates: 0,
        rejected: {
            unplaced: 0,
            locked: 0,
            equipped: 0,
            serverPending: 0,
            deletedInServer: 0,
            temporaryBlocked: 0,
            recentlyConsumed: 0,
            runtimeSynthesisRule: 0,
            synthesisIgnored: 0
        },
        byCategory: {},
        byCategoryGrade: {}
    };
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row.placed) summary.rejected.unplaced++;
        if (row.locked) summary.rejected.locked++;
        if (row.equipped) summary.rejected.equipped++;
        if (row.serverPending) summary.rejected.serverPending++;
        if (row.deletedInServer) summary.rejected.deletedInServer++;
        if (row.temporaryBlocked) summary.rejected.temporaryBlocked++;
        if (recentlyConsumedUid(row.uid)) summary.rejected.recentlyConsumed++;
        if (runtimeSynthesisRejection(row)) summary.rejected.runtimeSynthesisRule++;
        if (g_synthesisIgnoreItemIdSet[String(row.itemKey)] === true) summary.rejected.synthesisIgnored++;
        if (!basicUsable(row)) continue;
        var quantity = row.categoryKey === 'material' ? synthesisUnitsForRow(row).length : 1;
        summary.usableCandidates += quantity;
        summary.byCategory[row.categoryKey] = (summary.byCategory[row.categoryKey] || 0) + quantity;
        var key = row.category + '/' + row.grade;
        summary.byCategoryGrade[key] = (summary.byCategoryGrade[key] || 0) + quantity;
    }
    return summary;
}

function shortGroupList(groups, limit) {
    if (!groups || !groups.length) return '';
    var byKey = {};
    var unique = [];
    groups.forEach(function (g) {
        var gradeIdentity = g.gradeIdentity ||
            (g.gradeValue != null ? 'value:' + g.gradeValue : String(g.grade || '未知品级'));
        var levelKey = g.levelKey == null ? '*' : String(g.levelKey);
        var key = String(g.categoryKey || g.category || '') + '|' + gradeIdentity + '|' + levelKey;
        var prior = byKey[key];
        if (!prior) {
            prior = { group: g, count: Number(g.count) || 0 };
            byKey[key] = prior;
            unique.push(prior);
        } else if ((Number(g.count) || 0) > prior.count) {
            prior.group = g;
            prior.count = Number(g.count) || 0;
        }
    });
    return unique.slice(0, limit || 5).map(function (entry) {
        var g = entry.group;
        var label = g.category + '/' + g.grade;
        if (g.levelKey != null && String(g.levelKey) !== '*') {
            label += '/Lv.' + (g.level || g.levelKey);
        }
        return label + ' ' + entry.count + '/' + g_threshold;
    }).join('; ');
}

function compactGroups(groups, limit) {
    if (!groups || !groups.length) return [];
    return groups.slice(0, limit || 10).map(function (g) {
        return {
            key: g.key,
            categoryKey: g.categoryKey,
            category: g.category,
            levelKey: g.levelKey,
            level: g.level,
            grade: g.grade,
            gradeValue: g.gradeValue,
            count: g.count,
            batches: g.batches,
            ready: g.ready === true,
            mixedLevelPool: g.mixedLevelPool === true,
            recipeTiers: g.recipeTiers || [],
            recipeMinLevel: g.recipeMinLevel,
            recipeMaxLevel: g.recipeMaxLevel,
            previewUids: g.previewUids || []
        };
    });
}


function diagnoseInventoryJson() {
    var rows = scanInventory();
    g_lastSnapshotCount = rows.length;
    var allCats = { equipment: true, accessory: true, material: true };
    var allGrades = { equipment: 8, accessory: 8, material: 8 };
    var allGroups = groupRows(rows, { threshold: g_threshold, categories: allCats, maxGrades: allGrades });
    g_lastAllGroups = allGroups;
    g_lastGroups = groupRows(rows, { threshold: g_threshold, categories: g_categories });
    var runtimeRetryGroups = groupRows(rows, {
        threshold: g_threshold,
        categories: g_categories,
        maxGrades: g_maxGrades,
        ignoreRuntimeRejections: true
    });
    return JSON.stringify({
        count: rows.length,
        threshold: g_threshold,
        categories: g_categories,
        maxGrades: g_maxGrades,
        sameLevelSynthesis: g_sameLevelSynthesis,
        summary: summarizeCounts(rows),
        runtimeItemCache: g_lastRuntimeItemCache,
        sourceCounts: g_lastSourceCounts,
        placedDiagnostics: g_lastPlacedDiagnostics,
        itemSaveFields: g_lastItemSaveFields,
        scanErrors: g_lastScanErrors,
        runtimeSynthesisRejections: g_runtimeSynthesisRejectedUids,
        runtimeRejectedReadyGroups: runtimeRetryGroups.filter(function (group) {
            return group.ready && !g_lastGroups.some(function (activeGroup) {
                return activeGroup.key === group.key && activeGroup.ready;
            });
        }).map(function (group) {
            return {
                key: group.key,
                category: group.category,
                recipeTier: group.recipeTier,
                count: group.count,
                batches: group.batches
            };
        }),
        autoDeposit: {
            enabled: g_autoDepositUnsynthable,
            extraItemIds: g_extraDepositItemIds,
            backpackCapacity: g_lastSourceCounts.backpackCapacity || 0,
            backpackFree: g_lastSourceCounts.backpackFree,
            backpackFull: g_lastSourceCounts.backpackFull === true,
            fullBackpackActive: g_fullBackpackDepositActive,
            fullBackpackPage: g_fullBackpackDepositActive ? g_fullBackpackDepositPage + 1 : 0,
            fullBackpackWaiting: g_fullBackpackDepositWaiting,
            fullBackpackMovedCount: g_fullBackpackDepositMovedCount,
            candidateCount: (g_lastPlacedRows || []).filter(autoDepositCandidate).length,
            candidates: (g_lastPlacedRows || []).filter(autoDepositCandidate).slice(0, 30).map(function (row) {
                var source = backpackSourceForDeposit(row);
                return {
                    uid: row.uid,
                    itemKey: row.itemKey,
                    grade: row.grade,
                    synthesisType: row.synthesisType,
                    reason: autoDepositReason(row),
                    backpackIndex: source ? source.index : -1
                };
            })
        },
        synthesisIgnoreItemIds: g_synthesisIgnoreItemIds,
        groups: g_lastGroups.slice(0, 30),
        allGroups: allGroups.slice(0, 30),
        hint: g_lastGroups.length
            ? ('当前规则下最接近：' + shortGroupList(g_lastGroups, 5))
            : ('当前规则下没有候选；全部类别可用时：' + (shortGroupList(allGroups, 5) || '也没有可用候选'))
    });
}

function synthesisGradeSummary(items) {
    var counts = {};
    (items || []).forEach(function (item) {
        var grade = item.grade || '未知品级';
        counts[grade] = (counts[grade] || 0) + 1;
    });
    return Object.keys(counts).map(function (grade) {
        return grade + '×' + counts[grade];
    }).join('、') || '未知品级';
}

function currentSynthesisRecipeModel(bridge, tier) {
    if (!bridge.current || !bridge.selectSpecificRecipe) return ptr(0);
    var cubeClass = il2cpp.methodGetClass(bridge.selectRecipe.mi);
    var staticData = il2cpp.classGetStaticFieldData(cubeClass);
    var dictionaryOffset = runtimeClassFields(cubeClass).fields.bike;
    if (isBadPtr(staticData) || dictionaryOffset == null) {
        throw new Error('无法读取游戏合成配方目录');
    }
    var dictionary = staticData.add(dictionaryOffset).readPointer();
    if (isBadPtr(dictionary)) throw new Error('游戏合成配方目录尚未初始化');
    var entries = dictionary.add(0x18).readPointer();
    if (isBadPtr(entries)) throw new Error('游戏合成配方目录为空');
    var length = entries.add(0x18).readS32();
    if (length < 0 || length > 128) {
        throw new Error('游戏合成配方目录格式异常');
    }
    for (var i = 0; i < length; i++) {
        var entry = entries.add(0x20 + i * 0x18);
        if (entry.readS32() < 0 || entry.add(8).readS32() !== 1) continue;
        var models = readListObjects(entry.add(0x10).readPointer(), 32);
        for (var j = 0; j < models.length; j++) {
            var model = models[j];
            var modelOffset = runtimeClassFields(il2cpp.objectGetClass(model)).fields.bjcd;
            if (modelOffset == null) continue;
            var subRecipe = model.add(modelOffset).readPointer();
            if (isBadPtr(subRecipe)) continue;
            var tierOffset = runtimeClassFields(il2cpp.objectGetClass(subRecipe)).fields.blby;
            if (tierOffset != null && subRecipe.add(tierOffset).readS32() === tier) return model;
        }
    }
    throw new Error('游戏合成配方目录中没有等级区间 ' + tier);
}

function selectSynthesisRecipeTier(bridge, tier) {
    if (!bridge.current) return;
    if (!(tier >= 1 && tier <= 9)) throw new Error('合成配方等级区间无效：' + tier);
    var model = currentSynthesisRecipeModel(bridge, tier);
    bridge.selectSpecificRecipe.fn(model, bridge.selectSpecificRecipe.mi);
    var staticData = il2cpp.classGetStaticFieldData(il2cpp.methodGetClass(bridge.selectRecipe.mi));
    var activeOffset = runtimeClassFields(il2cpp.methodGetClass(bridge.selectRecipe.mi)).fields.bikk;
    if (activeOffset == null || !sameNativePointer(staticData.add(activeOffset).readPointer(), model)) {
        throw new Error('游戏未切换到所需合成等级区间 ' + tier);
    }
}

function synthesisBatchFromGroup(g, candidateItems, options) {
    options = options || {};
    var selected = g.items.slice(0, g_threshold);
    var recipeTiers = g.recipeTiers && g.recipeTiers.length ? g.recipeTiers.slice() : null;
    var candidates = (candidateItems || g.items).map(function (x) {
        return { uid: x.uid, itemKey: x.itemKey, level: x.level, sources: x.sources,
            categoryKey: x.categoryKey, grade: x.grade, gradeKey: x.gradeKey,
            gradeValue: x.gradeValue,
            totalQuantity: x.totalQuantity || 1 };
    });
    // Manual insertion can safely replace a failed game autofill only when
    // every candidate's item level is known. Materials with missing level
    // metadata must keep relying on the game's own recipe validation.
    var manualFallbackAllowed = candidates.length >= g_threshold && candidates.every(function (candidate) {
        return Number(candidate.level || 0) > 0;
    }) && options.manualFallbackAllowed !== false;
    return {
        key: g.key,
        categoryKey: g.categoryKey,
        category: g.category,
        recipeTier: recipeTiers ? Number(recipeTiers[0]) : g.recipeTier,
        recipeTiers: recipeTiers,
        recipeMinLevel: g.recipeMinLevel,
        recipeMaxLevel: g.recipeMaxLevel,
        levelKey: g.levelKey,
        level: Number(selected[0].level || 0),
        gradeIdentity: g.gradeIdentity || synthesisGradeIdentity(selected[0]),
        grade: synthesisGradeSummary(selected),
        gradeValue: g.gradeValue,
        count: g.count,
        selectedCount: selected.length,
        uids: selected.map(function (x) { return x.uid; }),
        items: selected.map(function (x) {
            return { uid: x.uid, itemKey: x.itemKey, level: x.level, sources: x.sources,
                categoryKey: x.categoryKey, grade: x.grade, gradeKey: x.gradeKey,
                gradeValue: x.gradeValue,
                totalQuantity: x.totalQuantity || 1 };
        }),
        candidates: candidates,
        manualFallbackAllowed: manualFallbackAllowed
    };
}

function findReadyBatch(scannedRows) {
    g_lastSynthesisAutoFillBlockedGroup = null;
    var rows = scannedRows || scanInventory();
    g_lastSnapshotCount = rows.length;
    g_lastAllGroups = groupRows(rows, {
        threshold: g_threshold,
        categories: { equipment: true, accessory: true, material: true },
        maxGrades: { equipment: 8, accessory: 8, material: 8 },
    });
    g_lastGroups = groupRows(rows, {
        threshold: g_threshold,
        categories: g_categories,
        maxGrades: g_maxGrades,
    });
    for (var i = 0; i < g_lastGroups.length; i++) {
        var g = g_lastGroups[i];
        if (!g.ready) continue;
        var blockedGroup = g_synthesisAutoFillRejectedGroups[g.key];
        if (blockedGroup && blockedGroup.retryAt > Date.now()) {
            if (!g_lastSynthesisAutoFillBlockedGroup) {
                g_lastSynthesisAutoFillBlockedGroup = {
                    category: g.category,
                    key: g.key,
                    count: g.count,
                    reason: blockedGroup.reason || '游戏自动填充复核未通过'
                };
            }
            continue;
        }
        if (blockedGroup) delete g_synthesisAutoFillRejectedGroups[g.key];
        return synthesisBatchFromGroup(g);
    }

    // A per-item Cube.addSlot rejection can hide a whole otherwise-ready group
    // for the rest of the 30-minute cycle. Give the game's own category/tier
    // auto-fill one verified chance before declaring the cycle empty.
    var bridge = g_synthesisBridgeResolved;
    if (bridge && bridge.autoFillEventInvoke && bridge.getSlotList && bridge.getSlotUid) {
        var retryGroups = groupRows(rows, {
            threshold: g_threshold,
            categories: g_categories,
            maxGrades: g_maxGrades,
            ignoreRuntimeRejections: true
        });
        for (var retryIndex = 0; retryIndex < retryGroups.length; retryIndex++) {
            var retryGroup = retryGroups[retryIndex];
            if (!retryGroup.ready) continue;
            var blocked = g_synthesisAutoFillRejectedGroups[retryGroup.key];
            if (blocked && blocked.retryAt > Date.now()) {
                if (!g_lastSynthesisAutoFillBlockedGroup) {
                    g_lastSynthesisAutoFillBlockedGroup = {
                        category: retryGroup.category,
                        key: retryGroup.key,
                        count: retryGroup.count,
                        reason: blocked.reason || '游戏自动填充复核未通过'
                    };
                }
                continue;
            }
            if (blocked) delete g_synthesisAutoFillRejectedGroups[retryGroup.key];
            var nativeCandidateItems = [];
            retryGroups.forEach(function (candidateGroup) {
                if (candidateGroup.categoryKey !== retryGroup.categoryKey ||
                        candidateGroup.recipeTier !== retryGroup.recipeTier ||
                        candidateGroup.levelKey !== retryGroup.levelKey ||
                        candidateGroup.gradeIdentity !== retryGroup.gradeIdentity) return;
                Array.prototype.push.apply(nativeCandidateItems, candidateGroup.items);
            });
            var retryBatch = synthesisBatchFromGroup(retryGroup, nativeCandidateItems, {
                manualFallbackAllowed: false
            });
            log('单件校验暂时过滤了仍够 9 件的候选，改用游戏自动填充复核：' +
                retryBatch.category + '/' + retryBatch.grade + '，等级区间 ' +
                retryBatch.recipeMinLevel + '–' + retryBatch.recipeMaxLevel + '。');
            return retryBatch;
        }
    }
    return null;
}

function scanSummaryJson() {
    return diagnoseInventoryJson();
}

var g_running = false;
var g_cyclePhase = 'active';
var g_cycleBoxStage = 'scheduled';
var g_cycleRound = 1;
var g_cycleSleepUntil = 0;
var g_cycleLastPassAt = 0;
var g_cycleNextDueAt = 0;
var g_cyclePassActive = false;
var g_activeAutomationAction = '';
var g_queueLastProcessedAt = 0;
var g_automationRepairAt = 0;
var g_automationRecoveryCount = 0;
var g_boxCapacityScanAt = 0;
var g_boxFullNoticeAt = 0;
var g_cyclePauseMs = 0;
var g_lastSynthesisNoBatch = false;
var g_startupSummaryLogged = false;
var g_timer = null;
var g_mode = 'synthesis';
var g_executeMode = 'scanOnly'; // legacy direct execution requires two explicit unsafe flags
var g_legacyDirectAllowed = false;
var g_synthesisEnabled = false;
var g_synthesisPauseReason = '';
var g_autoDepositUnsynthable = false;
var g_autoDepositAllItems = false;
var g_depositCooldownMs = 300000;
var g_depositBatchActive = false;
var g_currentFullBagClearing = false;
var g_synthesisIgnoreItemIds = [];
var g_synthesisIgnoreItemIdSet = {};
var g_extraDepositItemIds = [];
var g_extraDepositItemIdSet = {};
var g_intervalMs = 900;
var g_initialDelayMs = 0;
var g_instanceOrdinal = 1;
var g_instanceCount = 1;
var g_threshold = 9;
var g_maxRuns = 0;
var g_runCount = 0;
var g_failedCount = 0;
var g_lastResult = '';
var g_lastBatch = null;
var g_lastGroups = [];
var g_lastAllGroups = [];
var g_lastSourceCounts = {};
var g_lastPlacedDiagnostics = {};
var g_lastItemSaveFields = [];
var g_lastRuntimeItemInfoByUid = {};
var g_lastPlacedSourcesByUid = {};
var g_lastEquippedUids = {};
var g_lastItemSaveUidSet = {};
var g_lastScanErrors = [];
var g_lastSnapshotCount = 0;
var g_lastScanDurationMs = 0;
var g_scanCount = 0;
var g_lastSlowScanLogAt = 0;
var g_lastExecuteKey = '';
var g_lastExecuteAt = 0;
var g_pendingSynthesisSignature = '';
var g_pendingSynthesisKey = '';
var g_pendingSynthesisAt = 0;
var g_pendingSynthesisBatch = null;
var g_pendingSynthesisResultReceived = false;
var g_pendingSynthesisObservedError = '';
var g_pendingSynthesisWaitMs = 15000;
var g_synthesisBatchQueued = false;
var g_synthesisCleanupQueued = false;
var g_lastSynthesisCleanupAt = 0;
var g_lastPlacedUidSet = {};
var g_lastPlacedQuantityByUid = {};
var g_recentlyConsumedUids = {};
var g_lastUnsynthableRows = [];
var g_lastPlacedRows = [];
var g_lastStashOccupiedSet = {};
var g_depositQueued = false;
var g_depositPending = null;
var g_depositRejectedUids = {};
var g_depositConsecutiveFailures = 0;
var g_depositRetryAt = 0;
var g_depositCount = 0;
var g_lastDepositAt = 0;
var g_lastDepositResult = '';
var g_lastDepositCandidateCount = 0;
var g_lastDepositFullLogAt = 0;
var g_autoTradeShipEnabled = false;
var g_tradeShipManualRunActive = false;
var g_tradeShipManualOnly = false;
var g_autoTradeShipIntervalMs = 60000;
var g_autoTradeShipNextCheckAt = 0;
var g_autoTradeShipPriceMode = 'range';
var g_tradeShipMaxPriceCny = 0;
var g_marketPriceItems = {};
var g_marketPriceUpdatedAt = 0;
var g_marketPriceItemCount = 0;
var g_marketPriceCnyPerUsd = 0;
var g_tradeShipMinPriceCny = 0;
var g_tradeShipQueued = false;
var g_tradeShipCount = 0;
var g_lastTradeShipAt = 0;
var g_lastTradeShipResult = '';
var g_lastTradeShipCandidateCount = 0;
var g_lastTradeShipPriceFilteredCount = 0;
var g_lastTradeShipStateLog = '';
var g_lastTradeShipStateLogAt = 0;
var g_tradeShipQueuedUids = {};
var g_tradeShipRejectedUids = {};
var g_tradeShipLockedUids = {};
var g_tradeShipDeferredItems = {};
var g_tradeShipDeferredCleanupRetryAt = {};
var g_tradeShipPending = null;
var g_tradeShipConfirmTimeoutMs = 30000;
var g_tradeShipRetryDelayMs = 10000;
var g_tradeShipReleasePending = null;
var g_tradeShipReleaseRetryAt = {};
var g_tradeShipReleaseConfirmMs = 10000;
var g_tradeShipReleaseCount = 0;
var g_tradeShipSlotCheckIntervalMs = 60000;
var g_tradeShipNextSlotCheckAt = 0;
var g_tradeShipProbeQueued = false;
var g_tradeShipSlotProbeFreshUntil = 0;
var g_tradeShipSlotDiagnosticAt = 0;
var g_tradeShipLastSlotDiagnostics = [];
var g_tradeShipLastSlotLayout = {
    rawListCount: 0,
    validSlotCount: 0,
    excludedTemplateCount: 0
};
var g_tradeShipCooldownSyncTimeoutMs = 20000;
var g_tradeShipCooldownSync = {
    phase: '未请求',
    requestedAt: 0,
    completedAt: 0,
    timedOut: false,
    closureDone: false,
    error: '',
    closure: ptr(0),
    delegate: ptr(0),
    closureHandle: 0,
    delegateHandle: 0
};
var g_fullBackpackDepositActive = false;
var g_fullBackpackDepositQueued = false;
var g_fullBackpackDepositWaiting = false;
var g_fullBackpackDepositPage = 0;
var g_fullBackpackDepositBeforeCount = 0;
var g_fullBackpackDepositRequestedAt = 0;
var g_fullBackpackDepositMovedCount = 0;
var g_fullBackpackDepositNextActionAt = 0;
var g_fullBackpackDepositQueuedAt = 0;
var g_fullBackpackDepositRetryAt = 0;
var g_fullBackpackDepositConfirmMs = 8000;
var g_runtimeSynthesisRejectedUids = {};
var g_synthesisAutoFillRejectedGroups = {};
var g_lastSynthesisAutoFillBlockedGroup = null;
var g_cooldownMs = 2500;
var g_sharedActionQuietUntil = 0;
var g_boxYieldUntil = 0;
var g_boxCapacityBlocked = false;
var g_boxSpaceRecoveryNotice = '';
var g_sharedActionQuietMs = 3000;

function markSharedGameAction(delayMs) {
    g_sharedActionQuietUntil = Math.max(g_sharedActionQuietUntil,
        Date.now() + Math.max(g_sharedActionQuietMs, delayMs || 0));
}

function sharedGameActionWaiting() {
    return Date.now() < g_sharedActionQuietUntil || boxBatchStillRunning();
}
var g_categories = { equipment: false, accessory: false, material: false };
var g_sameLevelSynthesis = false;
var g_maxGrades = { equipment: 8, accessory: 8, material: 8 };
var g_autoOpenBoxes = false;
var g_lastBoxOpenAt = 0;
var g_lastBoxOpenResult = '';
var g_boxAttemptCount = 0;
var g_lastBoxCount = 0;
var g_boxDetectedAt = 0;
var g_boxDetectedCount = 0;
var g_boxDetectedSignature = '';
var g_boxOpenInFlight = false;
var g_boxOpenDispatching = false;
var g_boxOpenInFlightAt = 0;
var g_boxOpenInFlightBefore = 0;
var g_boxOpenInFlightType = -1;
var g_boxOpenInFlightTypeBefore = 0;
var g_boxOpenInFlightTypeBeforeUids = [];
var g_boxOpenInFlightMaxWaitMs = 12000;
var g_boxLastRequestedType = -1;

function clearTimer() {
    g_cycleNextDueAt = 0;
    if (g_timer) {
        clearTimeout(g_timer);
        g_timer = null;
    }
}

function clearBoxPumpTimer() {
    if (g_boxPumpTimer) {
        clearTimeout(g_boxPumpTimer);
        g_boxPumpTimer = null;
    }
}

function clearBoxResultTimer() {
    if (g_boxResultTimer) clearTimeout(g_boxResultTimer);
    g_boxResultTimer = null;
    g_boxResultPendingAdded = [];
    g_boxResultObservedInventoryAdded = [];
    g_boxLogCaptureUntil = 0;
    g_boxLogPendingAdded = [];
}

function scheduleBoxPump(delayMs) {
    clearBoxPumpTimer();
    if (!g_running || !g_autoOpenBoxes) return;
    // Idle scans respect the configured interval. Once any boxes are present,
    // follow the current bulk-open batch every 2 seconds so each type gets one
    // native “open all” request and the next type follows after the safe gap.
    var requestedDelay = delayMs == null
        ? (g_boxSweepActive ? 2000 : g_boxScanIntervalMs)
        : Math.max(0, delayMs | 0);
    if (g_boxSweepActive) requestedDelay = Math.max(2000, requestedDelay);
    var intervalRemaining = g_boxSweepActive ? 0 : (g_lastBoxPumpAt > 0
        ? Math.max(0, g_lastBoxPumpAt + g_boxScanIntervalMs - Date.now())
        : g_boxScanIntervalMs);
    var delay = Math.max(requestedDelay, intervalRemaining);
    g_boxPumpTimer = setTimeout(function () {
        if (!g_running || !g_autoOpenBoxes) return;
        if (!g_boxSweepActive) g_lastBoxPumpAt = Date.now();
        try {
            runAutoBoxOpen('box-pump');
        } catch (e) {
            g_failedCount++;
            g_lastBoxOpenResult = 'box scan failed: ' + e;
            boxLog('自动开箱扫描失败：' + chineseError(e));
        }
        scheduleBoxPump();
    }, Math.max(20, delay | 0));
}

function repairBoxPump() {
    if (!g_running) return '后台功能未运行';
    if (!g_autoOpenBoxes) return '自动开箱未开启';
    g_boxPumpRestartCount++;
    g_lastBoxOpenResult = '自动开箱扫描心跳已恢复';
    scheduleBoxPump(0);
    emitBoxDiagnostic('开箱扫描心跳恢复', scanBoxSnapshot(), {
        reason: '客户端检测到扫描停止'
    }, true);
    return '自动开箱扫描已恢复';
}

function normalizeCategories(raw) {
    var cats = { equipment: false, accessory: false, material: false };
    if (!raw) return cats;
    if (Array.isArray(raw)) {
        cats.equipment = raw.indexOf('equipment') !== -1 || raw.indexOf('装备') !== -1;
        cats.accessory = raw.indexOf('accessory') !== -1 || raw.indexOf('首饰') !== -1;
        cats.material = raw.indexOf('material') !== -1 || raw.indexOf('材料') !== -1;
        return cats;
    }
    if (typeof raw === 'object') {
        ['equipment', 'accessory', 'material'].forEach(function (k) {
            if (raw[k] != null) cats[k] = raw[k] !== false;
        });
    }
    return cats;
}

function normalizeMaxGrades(raw) {
    var grades = { equipment: 8, accessory: 8, material: 8 };
    if (!raw || typeof raw !== 'object') return grades;
    ['equipment', 'accessory', 'material'].forEach(function (key) {
        if (raw[key] == null) return;
        var value = parseInt(raw[key], 10);
        if (isFinite(value)) grades[key] = Math.max(0, Math.min(8, value));
    });
    return grades;
}

function normalizeItemIds(raw) {
    if (!Array.isArray(raw)) return [];
    var seen = {};
    var values = [];
    for (var i = 0; i < raw.length; i++) {
        var text = String(raw[i] == null ? '' : raw[i]).trim();
        if (!/^\d+$/.test(text)) continue;
        var itemId = parseInt(text, 10);
        if (!(itemId > 0) || seen[String(itemId)]) continue;
        seen[String(itemId)] = true;
        values.push(itemId);
    }
    values.sort(function (a, b) { return a - b; });
    return values;
}

function normalizeProtectionTokens(raw) {
    var values = Array.isArray(raw) ? raw : String(raw || '').split(',');
    var result = {};
    values.forEach(function (value) {
        var token = String(value == null ? '' : value).trim().toLowerCase();
        if (token) result[token] = true;
    });
    return result;
}

function itemIdSet(values) {
    var result = {};
    for (var i = 0; i < values.length; i++) result[String(values[i])] = true;
    return result;
}

function batchSignature(batch) {
    if (!batch || !batch.uids || !batch.uids.length) return '';
    return batch.key + '|' + batch.uids.join(',');
}

function pendingSynthesisConsumedCount() {
    var consumed = batchConsumedQuantities(g_pendingSynthesisBatch);
    var count = 0;
    Object.keys(consumed).forEach(function (uid) {
        var item = consumed[uid];
        var current = g_lastPlacedQuantityByUid[uid] || 0;
        count += Math.min(item.count, Math.max(0, item.before - current));
    });
    return count;
}

function clearPendingSynthesis() {
    g_pendingSynthesisSignature = '';
    g_pendingSynthesisKey = '';
    g_pendingSynthesisAt = 0;
    g_pendingSynthesisBatch = null;
    g_pendingSynthesisResultReceived = false;
    g_pendingSynthesisObservedError = '';
}

function synthesisInventoryMutationActive() {
    return !!(g_synthesisBatchQueued || g_synthesisCleanupQueued || g_pendingSynthesisSignature ||
        g_corrosionQueued || g_corrosionPending);
}

function boxInventoryMutationActive() {
    return !!(g_boxOpenInFlight || g_boxResultTimer || g_boxOpenDispatching ||
        (g_boxLastRequestedAt > 0 && Date.now() - g_boxLastRequestedAt < 15000));
}

function runAutoPass(reason, scannedRows) {
    g_lastSynthesisNoBatch = false;
    if (!g_synthesisEnabled) {
        g_lastResult = '合成开关已关闭';
        return g_lastResult;
    }
    if (g_synthesisCleanupQueued) {
        g_lastResult = '合成成功，正在清空上一批合成栏';
        return g_lastResult;
    }
    if (g_synthesisBatchQueued) {
        g_lastResult = '正在核验上一批候选物品';
        return g_lastResult;
    }
    if (g_corrosionQueued || g_corrosionPending || g_corrosionFinishQueued) {
        g_lastResult = '腐蚀任务尚未结算，暂缓提交合成';
        return g_lastResult;
    }
    var now = Date.now();
    if (g_executeMode !== 'scanOnly' && g_pendingSynthesisSignature) {
        var consumedCount = pendingSynthesisConsumedCount();
        if (g_pendingSynthesisResultReceived || consumedCount >= g_threshold) {
            if (consumedCount >= g_threshold) markSharedGameAction(3000);
            rememberConsumedSynthesisBatch(g_pendingSynthesisBatch);
            var cleanupReason = g_pendingSynthesisResultReceived
                ? '收到游戏合成成功回包'
                : '已确认本批 9 件材料全部消耗';
            if (enqueueSynthesisResultCleanup(cleanupReason)) {
                g_lastResult = '合成成功，正在清空合成栏：' + g_pendingSynthesisKey;
                return g_lastResult;
            }
            throw new Error('合成成功后无法挂载合成栏清空任务');
        }
        var waitedForChange = now - g_pendingSynthesisAt;
        if (waitedForChange < g_pendingSynthesisWaitMs) {
            g_lastResult = '正在等待游戏确认上一批合成：' + g_pendingSynthesisKey +
                '，材料已消耗 ' + consumedCount + '/' + g_threshold + '，已等待 ' + waitedForChange + ' 毫秒';
            return g_lastResult;
        }
        g_failedCount++;
        g_lastResult = '合成请求等待游戏确认超时：' + g_pendingSynthesisKey;
        var timeoutError = g_pendingSynthesisObservedError || '合成请求等待超时，未收到游戏确认';
        log('合成请求等待超时，材料未全部消耗，已停止自动合成以避免重复提交。');
        emit('auto_synthesis_failed', { error: timeoutError, failedCount: g_failedCount, batch: g_pendingSynthesisBatch, action: 'synthesis' });
        g_synthesisPauseReason = timeoutError;
        g_synthesisEnabled = false;
        g_queue = g_queue.filter(function (item) {
            return item.action === 'boxOpen' || item.action === 'bossStageEnter';
        });
        clearPendingSynthesis();
        return g_lastResult;
    }
    if (g_depositQueued || g_tradeShipQueued || g_tradeShipPending ||
            g_tradeShipReleasePending || g_fullBackpackDepositActive || g_bossStageQueued) {
        g_lastResult = '正在等待存仓、交易船或关卡任务结束';
        return g_lastResult;
    }
    if (g_bossState === 'waitingBox') {
        g_lastResult = '正在等待 Boss 关卡掉箱';
        return g_lastResult;
    }
    if (sharedGameActionWaiting()) {
        g_lastResult = '正在等待后台操作间隔';
        return g_lastResult;
    }
    if (g_executeMode !== 'scanOnly' &&
            (boxInventoryMutationActive() || hasQueuedBoxOpen())) {
        g_lastResult = '正在等待开箱结果，暂缓下一批合成';
        return g_lastResult;
    }
    var batch = findReadyBatch(scannedRows);
    if (!batch) {
        g_lastSynthesisNoBatch = true;
        var detail = shortGroupList(g_lastGroups, 5);
        var allDetail = shortGroupList(g_lastAllGroups, 5);
        var autofillBlocked = g_lastSynthesisAutoFillBlockedGroup;
        var retryNote = autofillBlocked
            ? ('；' + autofillBlocked.category + '仍有 ' + autofillBlocked.count +
                ' 件候选，但游戏自动填充复核未通过：' + autofillBlocked.reason + '，本轮不再重复尝试')
            : '';
        if (!detail) {
            g_lastResult = '当前规则下没有可合成组；全部类别最接近：' + (allDetail || '无') + retryNote;
            return g_lastResult;
        }
        g_lastResult = (detail ? ('数量不足 9 件：' + detail) : '当前规则下没有候选物品') + retryNote;
        return g_lastResult;
    }
    g_lastBatch = batch;
    var msg = batch.category + ' / ' + batch.grade + ' 候选：' + batch.count + ' 个，正在按游戏实际阶级核验';
    log(msg);
    emit('auto_synthesis_batch', { reason: reason || '', batch: batch });
    if (g_executeMode === 'scanOnly') {
        g_lastSynthesisNoBatch = true;
        g_lastResult = '当前仅扫描，不会提交合成：' + batch.category + '/' + batch.grade;
        return g_lastResult;
    }
    if (g_lastExecuteKey === batch.key && now - g_lastExecuteAt < g_cooldownMs) {
        return '同组合成间隔保护中：' + batch.category + '/' + batch.grade;
    }
    g_lastExecuteKey = batch.key;
    g_lastExecuteAt = now;
    g_runCount++;
    var enqueueResult = enqueue(g_mode, batch);
    if (enqueueResult.indexOf('queued') !== 0) {
        g_runCount--;
        clearPendingSynthesis();
        g_lastResult = enqueueResult === 'update-hook-failed'
            ? '游戏主线程任务队列挂载失败'
            : '合成请求未能进入游戏主线程队列';
    } else {
        g_lastResult = '已进入游戏主线程队列：' + batch.category + '/' + batch.grade;
    }
    return g_lastResult;
}

function automationCycleBusy() {
    return !!(g_queue.length || g_corrosionQueued || g_corrosionPending || g_synthesisBatchQueued || g_synthesisCleanupQueued ||
        g_pendingSynthesisSignature || g_boxOpenInFlight || g_boxResultTimer ||
        g_boxOpenDispatching || g_bossStageQueued || g_depositQueued ||
        g_fullBackpackDepositActive || g_tradeShipQueued || g_tradeShipPending ||
        (typeof g_eventEntryQueued !== 'undefined' && g_eventEntryQueued) ||
        g_tradeShipReleasePending || (g_autoDepositUnsynthable &&
            (Date.now() < g_depositRetryAt || Date.now() < g_fullBackpackDepositRetryAt)));
}

function mapSwitchMutationBusy() {
    // Do not let unrelated maintenance/diagnostic queue items starve a map
    // request. Only queued server mutations and in-flight game operations need
    // to finish before a map transition.
    var queuedMutation = g_queue.some(function (item) {
        return item && item.action !== 'autoPlagueStageSwitch' &&
            isServerMutationQueueItem(item);
    });
    return !!(queuedMutation || g_corrosionQueued || g_corrosionPending ||
        g_synthesisBatchQueued || g_synthesisCleanupQueued || g_pendingSynthesisSignature ||
        g_boxOpenInFlight || g_boxResultTimer || g_boxOpenDispatching ||
        g_bossStageQueued || g_eventEntryQueued || g_eventDungeonContext || g_bossReturnContext ||
        g_depositQueued || g_fullBackpackDepositActive || g_tradeShipQueued ||
        g_tradeShipPending || g_tradeShipReleasePending);
}


function boxRecoveryBackpackRow(row) {
    return !!row && (row.sources || []).some(function (source) { return source.source === '背包'; });
}

function boxSpaceActionActive() {
    // A failed deposit's retry timer must not prevent corrosion/synthesis from
    // clearing the bag when every warehouse is full.
    return !!(g_queue.length || g_synthesisBatchQueued || g_synthesisCleanupQueued ||
        g_pendingSynthesisSignature || g_corrosionQueued || g_corrosionPending ||
        g_depositQueued || g_fullBackpackDepositActive || g_tradeShipQueued ||
        g_tradeShipPending || g_tradeShipReleasePending || g_boxOpenInFlight || g_boxResultTimer);
}



function runAutomationCyclePass() {
    g_cyclePhase = 'active';
    g_cycleBoxStage = 'scheduled';
    g_cycleSleepUntil = 0;
    maintainCorrosionPending();
    resumeBossCycleAfterReturn();
    if (typeof runAutoEventDungeonPass === 'function') runAutoEventDungeonPass();
    if (typeof runAutoPlagueMapPass === 'function') runAutoPlagueMapPass();
    var inventoryWorkEnabled = g_synthesisEnabled || g_autoCorrosionEnabled ||
        g_autoDepositUnsynthable || g_autoTradeShipEnabled || g_autoBossEnabled ||
        g_tradeShipManualRunActive;
    var rows = inventoryWorkEnabled ? scanInventory() : null;
    if (g_autoBossEnabled) runAutoBossPass(rows || scanInventory());

    // Every job owns its own interval/cooldown. A completed synthesis or
    // corrosion pass no longer places the entire helper into a global sleep.
    if (g_synthesisEnabled) runAutoPass('定时合成', rows);
    if (g_autoCorrosionEnabled) runAutoCorrosionPass(rows || scanInventory());
    if (g_autoDepositUnsynthable) runAutoDepositPass('定时存仓', rows);
    if (g_autoTradeShipEnabled || g_tradeShipManualRunActive) {
        var tradeResult = runAutoTradeShipPass(
            g_tradeShipManualRunActive ? '手动转入一轮' : '定时检测',
            rows, g_tradeShipManualRunActive);
        if (g_tradeShipManualRunActive && !g_tradeShipManualOnly &&
                !g_tradeShipPending && !g_tradeShipReleasePending && !g_tradeShipQueued &&
                !g_tradeShipProbeQueued && !g_queue.length && !sharedGameActionWaiting() &&
                !/等待.*完成|等待.*检查|正在|已安排|已加入/.test(String(tradeResult || ''))) {
            finishManualTradeShipRound(tradeResult);
        }
    }

    if (g_tradeShipManualOnly && g_tradeShipManualRunActive &&
            !g_tradeShipPending && !g_tradeShipReleasePending && !g_tradeShipQueued &&
            !g_tradeShipProbeQueued && !g_queue.length && !sharedGameActionWaiting()) {
        var manualResult = g_lastTradeShipResult || '本轮没有可转入物品';
        finishManualTradeShipRound(manualResult);
        stopLoop();
        return 200;
    }
    return g_intervalMs;
}

function finishManualTradeShipRound(result) {
    if (!g_tradeShipManualRunActive) return false;
    g_tradeShipManualRunActive = false;
    g_lastTradeShipResult = String(result || g_lastTradeShipResult || '本轮没有可转入物品');
    tradeShipLog('手动转入交易船一轮完成：' + g_lastTradeShipResult + '。');
    return true;
}

function restartCycleForNewAutoBoss(previouslyEnabled, enabled, forceWake) {
    return false;
}

function restartCycleForReenabledAutomation(previous, current, forceWakeFeatures) {
    return false;
}

function scheduleNext(delayOverrideMs) {
    clearTimer();
    if (!g_running) return;
    var scheduledDelay = Math.max(200, delayOverrideMs == null ? (g_intervalMs | 0) : (delayOverrideMs | 0));
    // Check only stone quantities while asleep; do not rerun synthesis/corrosion
    // unless a Boss batch actually qualifies. This scan is ~5 ms when warm.
    if (g_autoBossEnabled) scheduledDelay = Math.min(scheduledDelay, 10000);
    if (g_autoPlagueMapEnabled) scheduledDelay = Math.min(scheduledDelay, 10000);
    if ((typeof g_autoHalloweenEventEnabled !== 'undefined' && g_autoHalloweenEventEnabled) ||
            (typeof g_eventDungeonContext !== 'undefined' && g_eventDungeonContext)) {
        scheduledDelay = Math.min(scheduledDelay, 1000);
    }
    // A return may finish while another submitted operation is still settling.
    // Retry that handoff promptly instead of inheriting the 30-minute sleep.
    if (g_bossResumeAfterReturn && g_autoBossEnabled) scheduledDelay = Math.min(scheduledDelay, 1000);
    g_cycleNextDueAt = Date.now() + scheduledDelay;
    g_timer = setTimeout(function () {
        if (!g_running) return;
        if (g_synthesisEnabled && g_maxRuns > 0 && g_runCount >= g_maxRuns) {
            stopLoop();
            log('达到执行次数上限：' + g_runCount);
            return;
        }
        var nextDelay = g_intervalMs;
        g_cycleLastPassAt = Date.now();
        g_cyclePassActive = true;
        try {
            nextDelay = runAutomationCyclePass();
        } catch (e) {
            g_failedCount++;
            g_lastResult = '扫描失败：' + chineseError(e);
            if (g_autoBossEnabled) bossLog('自动周期失败：' + chineseError(e) +
                (e && e.stack ? '；' + String(e.stack).split('\n').slice(0, 4).join(' / ') : ''));
            else log('扫描失败：' + chineseError(e));
        } finally {
            g_cyclePassActive = false;
        }
        scheduleNext(nextDelay);
    }, scheduledDelay);
}

function repairAutomationProgress() {
    var now = Date.now();
    var repairs = [];
    if (!g_running || g_cyclePassActive || g_activeAutomationAction) return { repaired: false, reasons: repairs };
    if (now - g_automationRepairAt < 15000) return { repaired: false, reasons: repairs };
    // Restore scheduling without restarting a round or resubmitting a request.
    var expectedDue = g_cycleNextDueAt;
    if (!g_timer || (expectedDue > 0 && now - expectedDue > 15000)) {
        scheduleNext(200);
        repairs.push('cycle-timer');
    }
    var synthesisQueued = g_queue.some(function (item) { return item.action === 'synthesisBatch'; });
    var cleanupQueued = g_queue.some(function (item) { return item.action === 'synthesisCleanup'; });
    if (g_synthesisBatchQueued && !synthesisQueued && !g_pendingSynthesisSignature) {
        g_synthesisBatchQueued = false;
        enqueueSynthesisResultCleanup('合成准备标记残留，清空合成栏后重新扫描');
        repairs.push('orphan-synthesis-preparation');
    } else if (g_synthesisCleanupQueued && !cleanupQueued) {
        g_synthesisCleanupQueued = false;
        enqueueSynthesisResultCleanup('合成清理任务丢失，重新安排清理');
        repairs.push('orphan-synthesis-cleanup');
    }
    var head = g_queue[0];
    var headReady = head && now >= Math.max(Number(head.deferUntil || 0), Number(head.retryAt || 0));
    var lastDispatch = Math.max(g_queueLastProcessedAt, Number(head && head.at || 0));
    if (headReady && (!g_updateHooked || now - lastDispatch > 20000)) {
        if (ensureUpdateHook()) repairs.push('queue-update-hook');
    }
    if (repairs.length) {
        g_automationRepairAt = now;
        g_automationRecoveryCount++;
        cycleLog('检测到后台任务停滞，已恢复调度：' + repairs.join('、') + '。');
        emit('automation_recovery', { reasons: repairs, phase: g_cyclePhase,
            queueLength: g_queue.length, headAction: head && head.action || '',
            lastPassAt: g_cycleLastPassAt, nextDueAt: g_cycleNextDueAt,
            recoveryCount: g_automationRecoveryCount });
    }
    return { repaired: repairs.length > 0, reasons: repairs };
}

function preflightClassMethodSummary(namespaceName, className) {
    var klassPtr = className === 'Cube' ?
        findClassByEnumeratedName(namespaceName || '', className) :
        klass(namespaceName || '', className, 'Assembly-CSharp.dll');
    if (isBadPtr(klassPtr)) return className + ':class-not-found';
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    var rows = [];
    for (var i = 0; i < 800; i++) {
        var method = il2cpp.classGetMethods(klassPtr, iter);
        if (isBadPtr(method)) break;
        var name = cstr(il2cpp.methodGetName(method));
        var count = il2cpp.methodGetParamCount(method);
        var params = [];
        for (var p = 0; p < count && p < 6; p++) {
            params.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method, p))));
        }
        var returnTypeName = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method)));
        if (className === 'Cube') {
            var scalarReturn = returnTypeName === 'System.Boolean' || returnTypeName === 'System.Int32' ||
                returnTypeName === 'System.Single' || returnTypeName === 'System.Void' ||
                returnTypeName.indexOf('IReadOnlyList') >= 0 || returnTypeName.indexOf('UniTask') >= 0;
            if (!scalarReturn || count > 2) continue;
        }
        if (className === 'sj' && params.indexOf('TaskbarHero.MoveRequest') < 0) continue;
        if (className === 'sj' && params.indexOf('System.Action<TaskbarHero.MoveResult>') < 0 &&
                name !== 'ite' && name !== 'itw') continue;
        var fp = methodPtr(method);
        var rva = isBadPtr(fp) ? '?' : '0x' + fp.sub(B).toString(16);
        var implFlags = Memory.alloc(4);
        implFlags.writeU32(0);
        var attributes = il2cpp.methodGetFlags(method, implFlags);
        var visibility = (attributes & 7) === 6 ? 'public' : (attributes & 7) === 4 ? 'protected' : 'private';
        rows.push(name + '(' + params.join(',') + '):' + returnTypeName + '[' + visibility + ']@' + rva);
        if (rows.length >= (className === 'Cube' ? 80 : 120)) break;
    }
    return (namespaceName ? namespaceName + '.' : '') + className + ':' + rows.join('|');
}

function preflightClassFieldSummary(namespaceName, className) {
    var info = classInfo(namespaceName || '', className, 'Assembly-CSharp.dll');
    if (isBadPtr(info.klass)) return className + ':class-not-found';
    return (namespaceName ? namespaceName + '.' : '') + className + ':' +
        Object.keys(info.fields).map(function (name) {
            return name + '@0x' + (info.fields[name] >>> 0).toString(16) +
                ':' + String(info.fieldTypes[name] || '');
        }).join('|');
}

function preflightClassMethodRows(namespaceName, className, filterKind) {
    var klassPtr = className === 'Cube' ?
        findClassByEnumeratedName(namespaceName || '', className) :
        klass(namespaceName || '', className, 'Assembly-CSharp.dll');
    if (isBadPtr(klassPtr)) return [];
    var iter = Memory.alloc(PTR);
    iter.writePointer(ptr(0));
    var rows = [];
    for (var i = 0; i < 800; i++) {
        var method = il2cpp.classGetMethods(klassPtr, iter);
        if (isBadPtr(method)) break;
        var count = il2cpp.methodGetParamCount(method);
        var name = cstr(il2cpp.methodGetName(method));
        var returnType = cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method)));
        var params = [];
        for (var p = 0; p < count && p < 8; p++)
            params.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method, p))));
        if (filterKind === 'cube-scalar' &&
                (count !== 0 || (returnType !== 'System.Boolean' && returnType !== 'System.Int32'))) continue;
        if (filterKind === 'move-request' && params.indexOf('TaskbarHero.MoveRequest') < 0) continue;
        var fp = methodPtr(method);
        rows.push({name:name, parameterCount:count, parameters:params, returnType:returnType,
            rva:isBadPtr(fp) ? '' : '0x' + fp.sub(B).toString(16)});
        if (rows.length >= 120) break;
    }
    return rows;
}

function preflightTradeMethodNameSummary() {
    var wanted = { lcb: true, lca: true, lbw: true, ite: true, itw: true };
    var hits = [];
    var classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
    var classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    var imgs = allImages();
    for (var imageIndex = 0; imageIndex < imgs.length; imageIndex++) {
        var classCount = classCountApi(imgs[imageIndex].image);
        for (var classIndex = 0; classIndex < classCount; classIndex++) {
            var klassPtr = classApi(imgs[imageIndex].image, classIndex);
            if (isBadPtr(klassPtr)) continue;
            var iter = Memory.alloc(PTR);
            iter.writePointer(ptr(0));
            for (var methodIndex = 0; methodIndex < 800; methodIndex++) {
                var method = il2cpp.classGetMethods(klassPtr, iter);
                if (isBadPtr(method)) break;
                var name = cstr(il2cpp.methodGetName(method));
                if (!wanted[name]) continue;
                var fp = methodPtr(method);
                var rva = isBadPtr(fp) ? '?' : '0x' + fp.sub(B).toString(16);
                var paramTypes = [];
                var paramCount = il2cpp.methodGetParamCount(method);
                for (var p = 0; p < paramCount && p < 6; p++)
                    paramTypes.push(cstr(il2cpp.typeGetName(il2cpp.methodGetParam(method, p))));
                var implFlags = Memory.alloc(4);
                implFlags.writeU32(0);
                var attributes = il2cpp.methodGetFlags(method, implFlags);
                var visibility = (attributes & 7) === 6 ? 'public' : (attributes & 7) === 4 ? 'protected' : 'private';
                hits.push(imgs[imageIndex].name + '!' + cstr(il2cpp.classGetNamespace(klassPtr)) + '.' +
                    cstr(il2cpp.classGetName(klassPtr)) + '.' + name + '(' + paramTypes.join(',') + '):' +
                    cstr(il2cpp.typeGetName(il2cpp.methodGetReturnType(method))) + '[' + visibility + ']@' + rva);
                if (hits.length >= 24) return hits.join('|');
            }
        }
    }
    return hits.length ? hits.join('|') : 'no-lcb-lca-lbw-methods-found';
}

function preflightTicketStageCacheAvailability(cfg) {
    var rows = scanInventory();
    var stoneCounts = bossInventorySnapshot(rows).stoneCounts;
    var eventCounts = eventDungeonTicketCounts(rows);
    var validated = [];
    var bridge = resolveAutoBossStageBridge();
    if (cfg.autoBoss === true) {
        AUTO_BOSS_TARGET_PRIORITY.forEach(function (name) {
            var rule = cfg.challengeTargets && cfg.challengeTargets[name];
            if (!rule || rule.enabled !== true) return;
            var count = Number(stoneCounts[name]) || 0;
            var minimum = Math.max(1, parseInt(rule.minCount, 10) || 1);
            if (count <= minimum) return;
            var target = AUTO_BOSS_TARGETS[name];
            var cache = bridge.cacheByKey.fn(target.stageKey, bridge.cacheByKey.mi);
            var actual = readAutoBossStageInfo(cache);
            if (!autoBossStageMatches(actual, target) || actual.soulStoneItemKey !== target.itemKey ||
                    actual.soulStoneAmount <= 0) {
                throw new Error('Boss 门票目标关卡缓存未就绪：' + name + '，key=' + target.stageKey);
            }
            validated.push({name:name, stageKey:target.stageKey, count:count});
        });
    }
    if (cfg.autoHalloweenEvent === true) {
        EVENT_DUNGEON_TICKETS.forEach(function (ticket) {
            var rule = cfg.challengeTargets && cfg.challengeTargets[eventDungeonRuleKey(ticket)];
            if (!rule || rule.enabled !== true) return;
            var count = Number(eventCounts[ticket.itemKey]) || 0;
            var minimum = Math.max(1, parseInt(rule.minCount, 10) || 1);
            if (count <= minimum) return;
            var cache = bridge.cacheByKey.fn(ticket.stageKey, bridge.cacheByKey.mi);
            var actual = readAutoBossStageInfo(cache);
            if (!actual || actual.stageKey !== ticket.stageKey || actual.stageType !== 4) {
                throw new Error('南瓜灯峡谷门票目标缓存未就绪：' + ticket.name + '，key=' + ticket.stageKey);
            }
            validated.push({name:ticket.name, stageKey:ticket.stageKey, count:count});
        });
    }
    return validated;
}

var g_preflightBridgeDiagnosticLogAt = 0;
var g_gameDataWaitingLogAt = 0;
var g_automationFeatureErrors = {};
function preflightAutomationBridges(cfg) {
    var failures = [];
    g_automationFeatureErrors = {};
    var synthesisMethodSummary = '';
    function check(label, fn) {
        try { fn(); }
        catch (error) {
            var message = chineseError(error);
            failures.push(label + '：' + message);
            var affected = {
                '魔方接口':['mainEnabled','autoCorrosion'],
                '自动开箱右键批量入口':['autoOpenBoxes'],
                '自动存仓接口':['autoDepositUnsynthable'],
                '自动转入交易船接口':['autoTradeShip'],
                '门票挑战接口':['autoBoss','autoHalloweenEvent'],
                '门票目标缓存':['autoBoss','autoHalloweenEvent'],
                '自动腐蚀接口':['autoCorrosion'],
                '瘟疫地图界面接口':['autoPlagueMapEnabled']
            }[label] || [];
            affected.forEach(function(key){if(cfg[key]===true){cfg[key]=false;g_automationFeatureErrors[key]=message;}});
        }
    }
    if (cfg.mainEnabled === true || cfg.autoCorrosion === true) {
        check('魔方接口', function () {
            var bridge = resolveSynthesisBridge();
            var slotCountDiagnostic = cfg.mainEnabled === true
                ? 'derived:' + synthesisSlotState(bridge).activeCount
                : 'deferred-headless-operation';
            synthesisMethodSummary = [
                'slotCount=' + slotCountDiagnostic,
                managedMethodText(bridge.selectRecipe), managedMethodText(bridge.selectSpecificRecipe),
                managedMethodText(bridge.selectSynthesisType), managedMethodText(bridge.reset),
                managedMethodText(bridge.addSlot), managedMethodText(bridge.executeBackend),
                managedMethodText(bridge.triggerRecipe), managedMethodText(bridge.refreshRecipe),
                managedMethodText(bridge.busy), managedMethodText(bridge.getSlotList),
                managedMethodText(bridge.getSlotUid), managedMethodText(bridge.getSlotItem),
                managedMethodText(bridge.getItemUid), managedMethodText(bridge.getItemTier)
            ].join('|');
        });
    }
    if (cfg.autoOpenBoxes === true) {
        check('自动开箱右键批量入口', resolveStageBoxRightClickHandler);
    }
    if (cfg.autoDepositUnsynthable === true) {
        check('自动存仓接口', function () {
            resolveAutoDepositBridge();
            if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT)
                resolveMoveResultCallback();
            else
                resolveFullBackpackDepositBridge();
        });
    }
    if (cfg.autoTradeShip === true) {
        check('自动转入交易船接口', function () {
            if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) {
                resolveCurrentTradeBridge();
                resolveMoveResultCallback();
                tradeShipReadOnlyDiagnostics();
            } else resolveAutoTradeShipBridge();
        });
    }
    if (cfg.autoBoss === true || cfg.autoHalloweenEvent === true) {
        check('门票挑战接口', resolveAutoBossStageBridge);
        check('门票目标缓存', function () { preflightTicketStageCacheAvailability(cfg); });
    }
    if (cfg.autoCorrosion === true) {
        check('自动腐蚀接口', function () {
            resolveCorrosionBridge();
        });
    }
    if (cfg.autoPlagueMapEnabled === true) check('瘟疫地图界面接口',resolvePlagueUiBridge);
    if (failures.length) {
        var now = Date.now();
        if (now - g_preflightBridgeDiagnosticLogAt > 60000) {
            g_preflightBridgeDiagnosticLogAt = now;
            var methodDiagnostics = {executed:false, classes:{}};
            if (failures.some(function (row) { return row.indexOf('魔方接口') >= 0 || row.indexOf('自动腐蚀接口') >= 0; }))
                methodDiagnostics.classes.Cube = preflightClassMethodRows('', 'Cube', 'cube-scalar');
            if (failures.some(function (row) { return row.indexOf('自动存仓接口') >= 0; }))
                methodDiagnostics.classes.sj = preflightClassMethodRows('', 'sj', 'move-request');
            if (failures.some(function (row) { return row.indexOf('门票挑战接口') >= 0; })) {
                methodDiagnostics.classes.xi = preflightClassMethodRows('', 'xi', 'all');
                methodDiagnostics.classes.StageNode = preflightClassMethodRows('TaskbarHero', 'StageNode', 'all');
            }
            if (failures.some(function (row) { return row.indexOf('自动转入交易船接口') >= 0; })) {
                methodDiagnostics.classes.UI_TradingStash = preflightClassMethodRows('TaskbarHero.UI', 'UI_TradingStash', 'all');
                methodDiagnostics.classes.TradingStashSlot = preflightClassMethodRows('TaskbarHero.UI', 'TradingStashSlot', 'all');
                methodDiagnostics.classes.TradingStashCache = preflightClassMethodRows('TaskbarHero', 'TradingStashCache', 'all');
                methodDiagnostics.tradeCandidates = preflightTradeMethodNameSummary();
            }
            send({type:'automation_bridge_methods', diagnostics:methodDiagnostics});
            if (failures.some(function (row) { return row.indexOf('自动开箱接口') >= 0; }))
                channelLog('接口诊断', preflightClassMethodSummary('TaskbarHero.UI', 'StageBox'));
            if (failures.some(function (row) { return row.indexOf('自动存仓接口') >= 0; }))
                channelLog('接口诊断', 'sj MoveRequest：' + preflightClassMethodSummary('', 'sj'));
            if (failures.some(function (row) { return row.indexOf('魔方接口') >= 0 || row.indexOf('自动腐蚀接口') >= 0; }))
                channelLog('接口诊断', 'Cube bool getters：' + preflightClassMethodSummary('', 'Cube'));
            if (failures.some(function (row) { return row.indexOf('自动转入交易船接口') >= 0; })) {
                channelLog('接口诊断', '交易方法候选：' + preflightTradeMethodNameSummary());
                channelLog('接口诊断', preflightClassMethodSummary('TaskbarHero.UI', 'UI_TradingStash'));
                channelLog('接口诊断', preflightClassMethodSummary('TaskbarHero.UI', 'TradingStashSlot'));
                channelLog('接口诊断', preflightClassMethodSummary('TaskbarHero', 'TradingStashCache'));
            }
        }
        var diagnostic = failures.some(function (row) { return row.indexOf('Cube.') >= 0; })
            ? '；Cube签名候选：' + preflightClassMethodSummary('', 'Cube') : '';
        if (failures.some(function (row) { return row.indexOf('CubeInData') >= 0; }))
            diagnostic += '；CubeInData方法候选：' + preflightClassMethodSummary('TaskbarHero', 'CubeInData');
        if (failures.some(function (row) { return row.indexOf('自动转入交易船接口') >= 0; }))
            diagnostic += '；交易船字段：' + preflightClassFieldSummary('TaskbarHero', 'UIManager') + '；' +
                preflightClassFieldSummary('TaskbarHero.UI', 'UI_TradingStash') + '；' +
                preflightClassFieldSummary('TaskbarHero.UI', 'TradingStashSlot');
        channelLog('自动化兼容', '以下功能暂不可用，其他任务继续运行：' + failures.join('；') + diagnostic);
        emit('automation_feature_unavailable', {pid:Process.id, features:g_automationFeatureErrors,
            errors:failures, executed:false});
    }
    return {validated:failures.length===0, errors:g_automationFeatureErrors, executed:false};
}

function startLoop(configJson) {
    requireCurrentGameBuild();
    var cfg = {};
    try { cfg = JSON.parse(configJson || '{}'); } catch (e) { cfg = {}; }
    var playerDataReady = false;
    try { playerDataReady = !isBadPtr(findPlayerSaveData()); } catch (playerDataError) {}
    if (!playerDataReady) {
        if (g_running) stopLoop();
        var waitNow = Date.now();
        if (waitNow - g_gameDataWaitingLogAt > 60000) {
            g_gameDataWaitingLogAt = waitNow;
            log('已连接游戏进程，等待游戏登录并加载角色数据；角色数据就绪后再启动后台任务。');
        }
        return '等待游戏登录和角色数据加载';
    }
    preflightAutomationBridges(cfg);
    var unsupported = [];
    if (classInfo('TaskbarHero', 'PlayerSaveData').fields.BoxData == null) {
        try { requireCurrentGameBuild(); }
        catch (versionError) { throw new Error(chineseError(versionError)); }
        if (cfg.executeMode === 'direct') { unsupported.push('旧版直接合成'); cfg.executeMode = 'native'; }
        if (unsupported.length) log('游戏 1.2.8 暂不可用：' + unsupported.join('、') + '；其他已适配功能继续启动。');
    }
    var wasRunning = g_running;
    var preserveBoxBatch = !!(g_boxOpenInFlight || g_boxResultTimer);
    var wasAutoBossEnabled = g_autoBossEnabled;
    var wasAutoTradeShipEnabled = g_autoTradeShipEnabled;
    var wasAutoCorrosionEnabled = g_autoCorrosionEnabled;
    var previousBossMinStones = g_autoBossMinStones;
    var previousChallengeTargets = JSON.stringify(g_challengeTargets);
    var wasEventEntryQueued = g_eventEntryQueued;
    var previousRuntimeAutomation = {
        mainEnabled: g_synthesisEnabled,
        autoOpenBoxes: g_autoOpenBoxes,
        autoDepositUnsynthable: g_autoDepositUnsynthable,
        autoTradeShip: g_autoTradeShipEnabled,
        autoCorrosion: g_autoCorrosionEnabled,
        autoHalloweenEvent: g_autoHalloweenEventEnabled
    };
    var preserveBossWaiting = g_autoBossEnabled && cfg.autoBoss === true && g_bossState === 'waitingBox';
    clearTimer();
    clearBoxPumpTimer();
    clearGameplayTimer();
    g_running = false;
    g_queue = [];
    cancelPlagueUiRoute('地图任务因设置更新而收尾');
    g_autoPlagueSwitchQueued = false;
    g_autoPlaguePortalCloseQueued = false;
    g_failedExchangeRecoveryQueued = false;
    g_eventEntryQueued = false;
    if (wasEventEntryQueued && g_eventDungeonContext && g_eventDungeonContext.phase === 'entering') {
        g_eventDungeonContext.phase = 'ready';
    }
    g_synthesisBatchQueued = false;
    g_synthesisCleanupQueued = false;
    g_depositQueued = false;
    g_depositPending = null;
    g_depositRejectedUids = {};
    g_depositBatchActive = false;
    g_currentFullBagClearing = false;
    g_tradeShipQueued = false;
    g_tradeShipPending = null;
    g_tradeShipReleasePending = null;
    resetFullBackpackDepositState();
    g_fullBackpackDepositRetryAt = 0;
    if (!preserveBossWaiting) resetAutoBossState();
    else g_bossStageQueued = false;
    g_corrosionQueued = false;
    g_corrosionFinishQueued = false;
    g_autoCorrosionEnabled = cfg.autoCorrosion === true;
    g_corrosionMaxGrade = Number.isInteger(cfg.corrosionMaxGrade) ? Math.max(0, Math.min(9, cfg.corrosionMaxGrade)) : 0;
    g_corrosionCategoryRules = {};
    var corrosionCategoryInput = cfg.corrosionCategoryRules && typeof cfg.corrosionCategoryRules === 'object' ? cfg.corrosionCategoryRules : {};
    ['equipment', 'material', 'relic', 'accessory'].forEach(function (key) {
        var rule = corrosionCategoryInput[key];
        if (!rule || typeof rule !== 'object') return;
        var maxGrade = Number(rule.maxGrade);
        if (!Number.isInteger(maxGrade) || maxGrade < 0 || maxGrade > 9) return;
        g_corrosionCategoryRules[key] = {enabled:rule.enabled === true,maxGrade:maxGrade};
    });
    g_corrosionProtectPriceCny = Number(cfg.corrosionProtectPriceCny || 0);
    if (!Number.isFinite(g_corrosionProtectPriceCny) || g_corrosionProtectPriceCny < 0) g_corrosionProtectPriceCny = 0;
    g_corrosionIncludeStash = cfg.corrosionIncludeStash === true;
    g_corrosionProtectedCategories = normalizeProtectionTokens(cfg.corrosionProtectedCategories);
    g_corrosionProtectedGrades = normalizeProtectionTokens(cfg.corrosionProtectedGrades);
    g_corrosionProtectedItemIds = itemIdSet(normalizeItemIds(cfg.corrosionProtectedItemIds));
    g_corrosionProtectedRelicGrades = normalizeProtectionTokens(cfg.corrosionRelicProtectedGrades);
    g_corrosionProtectSoulstones = cfg.corrosionProtectSoulstones !== false;
    g_corrosionProtectJackTickets = cfg.corrosionProtectJackTickets !== false;
    g_corrosionPollutionThreshold = Math.max(0, parseInt(cfg.corrosionPollutionThreshold, 10) || 0);
    if (!wasAutoCorrosionEnabled && cfg.autoCorrosion === true) g_corrosionNextCheckAt = 0;
    g_corrosionWarehouseThresholdPercent = Math.max(1, Math.min(100,
        parseInt(cfg.corrosionWarehouseThresholdPercent, 10) || 50));
    g_corrosionMinimumIntervalMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.corrosionMinimumIntervalMs, 10) || 120000));
    g_backgroundTaskPauseMs = 0;
    g_cyclePauseMs = 0;
    g_corrosionProtectRelics = cfg.corrosionProtectRelics !== false;
    g_corrosionProtectOfferingMaterials = cfg.corrosionProtectOfferingMaterials !== false;
    g_corrosionExcludeInscriptionScrolls = cfg.corrosionExcludeInscriptionScrolls !== false;
    g_corrosionExcludeOfferingCoins = cfg.corrosionExcludeOfferingCoins !== false;
    g_corrosionRejectedUids = {};
    g_corrosionRoundFailed = false;
    g_corrosionBatchActive = false;
    if (g_autoCorrosionEnabled) {
        resolveCorrosionBridge();
        if (Date.now() - g_corrosionLastPollErrorLogAt > 60000) {
            g_corrosionLastPollErrorLogAt = Date.now();
            try {
                var corrosionDiagnostics = JSON.parse(corrosionPollutionDiagnostics());
                var corrosionClassSummary = (corrosionDiagnostics.classes || []).map(function (row) {
                    return row.namespace + '.' + row.className + '[' + (row.fields || []).map(function (field) {
                        return field.name + ':' + field.type + (field.isStatic ? ':S' : ':I') +
                            (field.staticReferenceType ? ':' + field.staticReferenceType : '') +
                            (field.staticReferenceReady === false ? ':null' : '');
                    }).join(',') + ']';
                });
                corrosionLog('污染度运行时字段诊断：' + corrosionClassSummary.join('；'));
            } catch (diagnosticError) {
                corrosionLog('污染度运行时字段诊断失败：' + chineseError(diagnosticError));
            }
        }
    }
    maintainCorrosionPending();
    g_mode = DIRECT[cfg.mode] ? cfg.mode : 'synthesis';
    g_legacyDirectAllowed = cfg.executeMode === 'direct' &&
        cfg.allowUnsafeSynthesis === true && cfg.allowLegacyDirectSynthesis === true;
    g_executeMode = cfg.executeMode === 'native' ? 'native' : (g_legacyDirectAllowed ? 'direct' : 'scanOnly');
    if (cfg.executeMode === 'direct' && !g_legacyDirectAllowed) {
        log('已阻止旧版直接合成入口：它不接收选中的 9 个物品，可能导致卡死或崩溃。');
    }
    g_synthesisEnabled = cfg.mainEnabled === true;
    g_synthesisPauseReason = '';
    g_autoDepositUnsynthable = cfg.autoDepositUnsynthable === true;
    g_autoDepositAllItems = cfg.autoDepositAllItems === true;
    g_depositBatchActive = false;
    g_depositCooldownMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.autoDepositCooldownMs, 10) || 300000));
    g_autoTradeShipEnabled = cfg.autoTradeShip === true;
    g_autoTradeShipIntervalMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.autoTradeShipIntervalMs, 10) || 60000));
    g_autoTradeShipPriceMode = cfg.autoTradeShipPriceMode === 'highest' ? 'highest' : 'range';
    g_tradeShipMaxPriceCny = Math.max(0, Number(cfg.autoTradeShipMaxPriceCny) || 0);
    g_tradeShipMinPriceCny = Math.max(0, Number(cfg.autoTradeShipMinPriceCny) || 0);
    g_tradeShipLockedUids = normalizeTradeShipLockedUids(cfg.tradeShipLockedUids);
    var savedDeferred = normalizeTradeShipDeferredItems(cfg.tradeShipDeferredItems,tradeShipAccountKey(),Date.now());
    Object.keys(g_tradeShipDeferredItems).forEach(function (uid) {
        var row=g_tradeShipDeferredItems[uid];
        if (row.availableAt>Date.now() && (!savedDeferred[uid] || savedDeferred[uid].availableAt<row.availableAt))
            savedDeferred[uid]=row;
    });
    g_tradeShipDeferredItems=savedDeferred;
    Object.keys(g_tradeShipDeferredItems).forEach(function (uid) {delete g_tradeShipLockedUids[uid];});
    if (!wasAutoTradeShipEnabled && g_autoTradeShipEnabled) g_autoTradeShipNextCheckAt = 0;
    if (!g_autoTradeShipEnabled) g_autoTradeShipNextCheckAt = 0;
    g_autoBossEnabled = cfg.autoBoss === true;
    g_autoBossMinStones = Math.max(1, parseInt(cfg.autoBossMinStones, 10) || 1);
    g_ticketCheckIntervalMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.bossTicketCheckIntervalMs, 10) || 60000));
    g_mapSwitchMinimumIntervalMs = Math.max(2000, Math.min(3600000,
        (parseInt(cfg.mapSwitchMinimumIntervalSeconds, 10) || 10) * 1000));
    g_autoPlagueMapEnabled = cfg.autoPlagueMapEnabled === true;
    g_autoPlagueDifficulty = Math.max(1, Math.min(3, parseInt(cfg.autoPlagueDifficulty, 10) || 3));
    g_autoPlagueStageNo = Math.max(1, Math.min(20, parseInt(cfg.autoPlagueStageNo, 10) || 1));
    g_autoPlagueCheckIntervalMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.autoPlagueCheckIntervalMs, 10) || 60000));
    g_autoPlagueNextCheckAt = 0;
    g_autoPlagueSwitchQueued = false;
    g_autoPlaguePortalCloseQueued = false;
    g_autoPlaguePortalCloseHandledStageKey = 0;
    g_autoPlaguePortalCloseAttempts = 0;
    if (!g_autoPlagueMapEnabled) g_autoPlagueAwaitingStage = null;
    g_bossNextInventoryCheckAt = 0;
    g_eventNextTicketCheckAt = 0;
    g_challengeTargets = cfg.challengeTargets && typeof cfg.challengeTargets === 'object' ? cfg.challengeTargets : null;
    var challengeTargetsChanged = previousChallengeTargets !== JSON.stringify(g_challengeTargets);
    if (!wasAutoBossEnabled || !g_autoBossEnabled) g_bossAdmittedStoneTypes = {};
    if (!g_autoBossEnabled && g_bossReturnContext) g_bossReturnContext.roundsFinished = true;
    var wasEventEnabled = g_autoHalloweenEventEnabled;
    g_autoHalloweenEventEnabled = cfg.autoHalloweenEvent === true;
    if (!wasEventEnabled || !g_autoHalloweenEventEnabled) g_eventAdmittedTicketTypes = {};
    if (wasEventEnabled && !g_autoHalloweenEventEnabled && g_eventDungeonContext) {
        g_eventDungeonContext.stopAfterRound = true;
        if (g_eventDungeonContext.phase === 'ready') queueEventDungeonReturn();
    }
    g_synthesisIgnoreItemIds = normalizeItemIds(cfg.synthesisIgnoreItemIds);
    g_synthesisIgnoreItemIdSet = itemIdSet(g_synthesisIgnoreItemIds);
    g_extraDepositItemIds = normalizeItemIds(cfg.extraDepositItemIds);
    g_extraDepositItemIdSet = itemIdSet(g_extraDepositItemIds);
    g_intervalMs = Math.max(1800, parseInt(cfg.intervalMs, 10) || 1800);
    g_initialDelayMs = Math.max(0, parseInt(cfg.initialDelayMs, 10) || 0);
    g_instanceOrdinal = Math.max(1, parseInt(cfg.instanceOrdinal, 10) || 1);
    g_instanceCount = Math.max(1, parseInt(cfg.instanceCount, 10) || 1);
    g_threshold = 9;
    g_maxRuns = 0;
    g_cooldownMs = Math.max(0, parseInt(cfg.cooldownMs, 10) || 2500);
    g_categories = normalizeCategories(cfg.categories);
    g_sameLevelSynthesis = cfg.sameLevelSynthesis === true;
    g_maxGrades = normalizeMaxGrades(cfg.maxGrades);
    configureGameplayFeatures(cfg);
    // allowUnsafeBoxOpen is a legacy option; auto-opening now uses only the
    // verified game right-click handler found by signature, never a fixed RVA.
    g_allowUnsafeBoxOpen = cfg.allowUnsafeBoxOpen === true;
    g_stageBoxRightClickBridgeReady = false;
    if (cfg.autoOpenBoxes === true || g_autoHalloweenEventEnabled) {
        try {
            resolveStageBoxRightClickHandler();
            g_stageBoxRightClickBridgeReady = true;
        } catch (boxBridgeError) {
            g_lastBoxOpenResult = '游戏右键批量开箱入口未就绪：' + chineseError(boxBridgeError);
            boxLog(g_lastBoxOpenResult + '。');
        }
    }
    g_autoOpenBoxes = cfg.autoOpenBoxes === true && g_stageBoxRightClickBridgeReady;
    if (!g_autoOpenBoxes) g_boxSweepActive = false;
    if (cfg.autoOpenBoxes === true && !g_stageBoxRightClickBridgeReady) {
        boxLog('自动开箱已等待：当前游戏没有唯一、签名匹配的右键批量入口；不会调用旧版固定 RVA。');
    }
    g_boxScanIntervalMs = Math.max(60000, Math.min(86400000,
        parseInt(cfg.boxScanIntervalMs, 10) || 60000));
    g_gameplayPumpIntervalMs = Math.max(500, parseInt(cfg.gameplayPumpIntervalMs, 10) || 500);
    g_gameDropPreviewEnabled = cfg.showDropPreview === true;
    if (g_gameDropPreviewEnabled) {
        try { installGameDropPreviewSpawnHooks(); }
        catch (previewError) { log('掉落预览等待游戏奖励队列：' + chineseError(previewError)); }
    }
    g_boxOpenDelayMs = Math.max(1800, parseInt(cfg.boxOpenDelayMs, 10) || 1800);
    g_boxOpenInFlightMaxWaitMs = Math.max(12000, g_boxOpenDelayMs + 11000);
    if (g_synthesisEnabled && g_executeMode === 'native') {
        try { resolveSynthesisBridge(); } catch (e1) { throw new Error('合成入口解析失败：' + e1); }
    }
    if (g_autoDepositUnsynthable) {
        try {
            resolveAutoDepositBridge();
            if (synthesisBridgeProfile() !== SYNTHESIS_BRIDGE_CURRENT)
                resolveFullBackpackDepositBridge();
        } catch (e2) {
            throw new Error('自动存仓入口解析失败：' + chineseError(e2));
        }
    }
    if (g_autoTradeShipEnabled) {
        try {
            if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) resolveCurrentTradeBridge();
            else resolveAutoTradeShipBridge();
        }
        catch (tradeShipError) {
            throw new Error('自动交易船入口解析失败：' + chineseError(tradeShipError));
        }
    }
    if (g_autoBossEnabled) {
        try { resolveAutoBossStageBridge(); } catch (bossError) { throw new Error('自动打Boss入口解析失败：' + chineseError(bossError)); }
    }
    if (g_autoHalloweenEventEnabled) {
        try {
            resolveAutoBossStageBridge();
            resolveEventDungeonEntry();
        } catch (eventError) {
            throw new Error('南瓜灯峡谷入口解析失败：' + chineseError(eventError));
        }
    }
    if (g_autoOpenBoxes) {
        try { resolveStageBoxRightClickHandler(); } catch (e3) { throw new Error('右键批量开箱入口解析失败：' + e3); }
    }
    g_running = true;
    queueFailedExchangeRecovery(cfg.failedNativeExchanges || []);
    if (!wasRunning) {
        g_cyclePhase = 'active';
        g_cycleBoxStage = 'scheduled';
        g_cycleRound = 1;
        g_cycleSleepUntil = 0;
    } else {
        var wakeFeatures = Array.isArray(cfg.wakeAutomationFeatures) ? cfg.wakeAutomationFeatures : [];
        if (previousBossMinStones !== g_autoBossMinStones) wakeFeatures.push('autoBoss');
        if (challengeTargetsChanged) wakeFeatures.push('autoBoss', 'autoHalloweenEvent');
        var restartedForBoss = restartCycleForNewAutoBoss(
            wasAutoBossEnabled, g_autoBossEnabled, wakeFeatures.indexOf('autoBoss') >= 0
        );
        if (!restartedForBoss) {
            restartCycleForReenabledAutomation(previousRuntimeAutomation, {
                mainEnabled: g_synthesisEnabled,
                autoOpenBoxes: g_autoOpenBoxes,
                autoDepositUnsynthable: g_autoDepositUnsynthable,
                autoTradeShip: g_autoTradeShipEnabled,
                autoCorrosion: g_autoCorrosionEnabled,
                autoHalloweenEvent: g_autoHalloweenEventEnabled
            }, wakeFeatures);
        }
    }
    if (!wasRunning && !preserveBoxBatch) {
        g_sharedActionQuietUntil = 0;
        g_boxYieldUntil = 0;
    }
    g_boxCapacityBlocked = false;
    g_boxSpaceRecoveryNotice = '';
    g_runCount = 0;
    g_failedCount = 0;
    g_runtimeSynthesisRejectedUids = {};
    g_synthesisAutoFillRejectedGroups = {};
    g_boxAttemptCount = 0;
    g_boxQueueRecoveryCount = 0;
    g_lastBoxQueueRecoveryLogAt = 0;
    g_lastBoxPumpAt = g_autoOpenBoxes ? Date.now() : 0;
    g_boxSweepActive = false;
    g_boxCapacityScanAt = 0;
    g_boxFullNoticeAt = 0;
    g_boxPumpRestartCount = 0;
    g_lastBoxDiagnosticAt = 0;
    g_lastBoxDiagnosticSignature = '';
    g_depositCount = 0;
    g_depositConsecutiveFailures = 0;
    g_depositRetryAt = 0;
    g_lastDepositAt = 0;
    g_lastDepositResult = '';
    g_lastDepositCandidateCount = 0;
    g_lastDepositFullLogAt = 0;
    g_tradeShipCount = 0;
    g_lastTradeShipAt = 0;
    g_lastTradeShipResult = '';
    g_lastTradeShipCandidateCount = 0;
    g_lastTradeShipPriceFilteredCount = 0;
    g_tradeShipQueuedUids = {};
    g_tradeShipRejectedUids = {};
    g_tradeShipReleaseRetryAt = {};
    g_tradeShipReleaseCount = 0;
    g_tradeShipNextSlotCheckAt = 0;
    g_tradeShipProbeQueued = false;
    g_tradeShipSlotProbeFreshUntil = 0;
    g_tradeShipSlotDiagnosticAt = 0;
    g_tradeShipLastSlotDiagnostics = [];
    g_tradeShipLastSlotLayout = {
        rawListCount: 0,
        validSlotCount: 0,
        excludedTemplateCount: 0
    };
    if (!preserveBoxBatch) {
        clearBoxResultTimer();
        clearBoxOpenInFlight();
        g_boxLastRequestedInventoryBefore = null;
        g_boxOpenDispatching = false;
        g_boxLastRequestedCount = 0;
        g_boxLastRequestedAt = 0;
        g_boxLastRequestedType = -1;
    }
    if (!g_startupSummaryLogged) {
        log('后台功能已启动：合成=' + (g_synthesisEnabled ? '开启' : '关闭') +
            '，自动开箱=' + (g_autoOpenBoxes ? '开启' : '关闭') +
            '，自动腐蚀=' + (g_autoCorrosionEnabled ? '开启' : '关闭') +
            '（' + gradeZh(g_corrosionMaxGrade) + '及以下，' + (g_corrosionIncludeStash ? '背包和仓库' : '仅背包') + '）' +
            '，自动存仓=' + (g_autoDepositUnsynthable ? '开启' : '关闭') +
            '，自动交易船=' + (g_autoTradeShipEnabled ? '开启' : '关闭') +
            '（最低价 ¥' + g_tradeShipMinPriceCny.toFixed(2) + '）' +
            '，自动打Boss=' + (g_autoBossEnabled ? '开启' : '关闭') +
            '，南瓜灯峡谷=' + (g_autoHalloweenEventEnabled ? '开启' : '关闭') +
            '，秒杀=' + (g_instantKillEnabled ? '开启' : '关闭') +
            '，无敌=' + (g_godModeEnabled ? '开启' : '关闭') +
            '，波数锁定=' + (g_waveLockEnabled ? '开启' : '关闭') +
            '，内存清理=' + (g_memoryCleanEnabled ? '开启' : '关闭') +
            '，合成忽略=' + g_synthesisIgnoreItemIds.length + ' 项' +
            '，额外存仓=' + g_extraDepositItemIds.length + ' 项' +
            '，类别[装备=' + (g_categories.equipment ? '开' : '关') +
            '，首饰=' + (g_categories.accessory ? '开' : '关') +
            '，材料=' + (g_categories.material ? '开' : '关') + ']' +
            '，仅同等级=' + (g_sameLevelSynthesis ? '开启' : '关闭') +
            '，品级上限=' + JSON.stringify(g_maxGrades) + '。');
        g_startupSummaryLogged = true;
    }
    clearPendingSynthesis();
    scheduleNext(g_initialDelayMs > 0 ? g_initialDelayMs : g_intervalMs);
    if (g_autoOpenBoxes) {
        scheduleBoxPump(Math.max(20, g_initialDelayMs % g_boxScanIntervalMs));
    }
    if (gameplayEnabled()) {
        g_gameplayTimer = setTimeout(
            runGameplayPump,
            Math.max(20, g_initialDelayMs % g_gameplayPumpIntervalMs)
        );
    }
    return unsupported.length ? '已启动；1.2.8 暂不可用：' + unsupported.join('、') : '已启动';
}

function stopLoop() {
    var preserveBoxBatch = !!(g_boxOpenInFlight || g_boxResultTimer);
    g_running = false;
    g_autoCorrosionEnabled = false;
    g_corrosionBatchActive = false;
    g_corrosionQueued = false;
    g_corrosionFinishQueued = false;
    g_depositConsecutiveFailures = 0;
    g_depositRetryAt = 0;
    g_cyclePhase = 'active';
    g_cycleBoxStage = 'scheduled';
    g_cycleSleepUntil = 0;
    if (!preserveBoxBatch) {
        g_sharedActionQuietUntil = 0;
        g_boxYieldUntil = 0;
    }
    g_boxCapacityBlocked = false;
    g_boxSpaceRecoveryNotice = '';
    clearTimer();
    clearBoxPumpTimer();
    if (!preserveBoxBatch) clearBoxResultTimer();
    disableAllGameplayFeatures();
    g_queue = [];
    cancelPlagueUiRoute('地图任务已停止');
    g_synthesisBatchQueued = false;
    g_synthesisCleanupQueued = false;
    g_depositQueued = false;
    g_depositPending = null;
    g_depositRejectedUids = {};
    g_depositBatchActive = false;
    g_currentFullBagClearing = false;
    g_tradeShipQueued = false;
    g_tradeShipPending = null;
    g_tradeShipReleasePending = null;
    g_tradeShipQueuedUids = {};
    g_tradeShipReleaseRetryAt = {};
    g_tradeShipNextSlotCheckAt = 0;
    g_tradeShipProbeQueued = false;
    g_tradeShipSlotProbeFreshUntil = 0;
    g_tradeShipSlotDiagnosticAt = 0;
    g_tradeShipLastSlotDiagnostics = [];
    g_autoTradeShipEnabled = false;
    resetFullBackpackDepositState();
    g_fullBackpackDepositRetryAt = 0;
    g_autoBossEnabled = false;
    if (typeof g_autoHalloweenEventEnabled !== 'undefined') g_autoHalloweenEventEnabled = false;
    if (typeof g_eventEntryQueued !== 'undefined') g_eventEntryQueued = false;
    if (typeof g_eventDungeonContext !== 'undefined' && g_eventDungeonContext)
        g_eventDungeonContext.stopAfterRound = true;
    if (g_bossReturnContext) g_bossReturnContext.roundsFinished = true;
    g_bossResumeAfterReturn = false;
    resetAutoBossState();
    queueCorrosionFinish();
    if (!preserveBoxBatch) {
        clearBoxOpenInFlight();
        g_boxLastRequestedInventoryBefore = null;
        g_boxOpenDispatching = false;
        g_boxLastRequestedCount = 0;
        g_boxLastRequestedAt = 0;
        g_boxLastRequestedType = -1;
    }
    log('已停止');
    clearPendingSynthesis();
    return '已停止';
}

var g_passiveTraceInstalled = false;
var g_passiveTraceListeners = [];
var g_lastSynthesisTraceAt = 0;
var g_lastExchangeTraceAt = 0;

function readManagedStringArray(arrayPtr, limit) {
    var values = [];
    if (isBadPtr(arrayPtr)) return values;
    try {
        var count = arrayPtr.add(0x18).readU32();
        var max = Math.min(count, limit == null ? 32 : limit);
        for (var i = 0; i < max; i++) {
            var value = arrayPtr.add(0x20 + i * PTR).readPointer();
            values.push(il2cppString(value));
        }
    } catch (e) {}
    return values;
}

function readInventoryItemDataArray(arrayPtr, limit) {
    var values = [];
    if (isBadPtr(arrayPtr)) return values;
    try {
        var info = classInfo('TaskbarHero', 'InventoryItemData');
        var count = arrayPtr.add(0x18).readU32();
        var max = Math.min(count, limit == null ? 64 : limit);
        for (var i = 0; i < max; i++) {
            var item = arrayPtr.add(0x20 + i * PTR).readPointer();
            if (isBadPtr(item)) continue;
            var itemId = info.fields.itemId != null ? item.add(info.fields.itemId).readS32() : 0;
            var countValue = info.fields.count != null ? item.add(info.fields.count).readS32() : 0;
            if (itemId <= 0) itemId = callResultGetter('InventoryItemData', 'get_ItemID', 'int', item) | 0;
            if (countValue <= 0) countValue = callResultGetter('InventoryItemData', 'get_Count', 'int', item) | 0;
            values.push({
                itemId: itemId,
                itemKey: info.fields.itemKey != null ? il2cppString(item.add(info.fields.itemKey).readPointer()) : '',
                count: countValue > 0 ? countValue : 1
            });
        }
    } catch (e) {}
    return values;
}

var g_resultGetterCache = {};
function callResultGetter(className, methodName, returnType, instance) {
    var key = className + '.' + methodName + ':' + returnType;
    var row = g_resultGetterCache[key];
    if (!row) {
        var mi = findMethodInfo('TaskbarHero', className, methodName, 0);
        if (!mi || mi.isNull()) mi = findMethodInfoByClassMethod('TaskbarHero', className, methodName);
        var fp = methodPtr(mi);
        if (!fp || fp.isNull()) return returnType === 'bool' ? false : (returnType === 'int' ? 0 : ptr(0));
        row = { mi: mi, fn: new NativeFunction(fp, returnType, ['pointer', 'pointer']) };
        g_resultGetterCache[key] = row;
    }
    return row.fn(instance, row.mi);
}

function operationResultSnapshot(instance, className) {
    var out = { success: false, error: '', added: [], removed: [] };
    if (isBadPtr(instance)) return out;
    try {
        var info = classInfo('TaskbarHero', className);
        out.success = callResultGetter(className, 'get_IsSuccess', 'bool', instance) === true;
        var errorPtr = callResultGetter(className, 'get_Error', 'pointer', instance);
        out.error = il2cppString(errorPtr);
        if (info.fields.added != null) {
            out.added = readInventoryItemDataArray(instance.add(info.fields.added).readPointer(), 64);
        }
        if (info.fields.removed != null) {
            out.removed = readManagedStringArray(instance.add(info.fields.removed).readPointer(), 64);
        }
    } catch (e) {
        out.error = String(e);
    }
    return out;
}

function consumedItemsFromBatch(batch) {
    return (batch && batch.items || []).map(function (item) {
        return {
            uid: item.uid,
            itemKey: item.itemKey,
            level: item.level,
            category: batch.category,
            grade: item.grade || batch.grade,
            sources: item.sources || []
        };
    });
}

function gameItemKeysMatchBatch(keys, batch) {
    var items = batch && batch.items || [];
    if (!keys || keys.length !== items.length || !items.length) return false;
    function matches(field) {
        var expected = {};
        items.forEach(function (item) {
            var key = String(item[field]);
            expected[key] = (expected[key] || 0) + 1;
        });
        for (var i = 0; i < keys.length; i++) {
            var actual = String(keys[i]);
            if (!expected[actual]) return false;
            expected[actual]--;
        }
        return true;
    }
    return matches('uid') || matches('itemKey');
}

function exchangeRequestSnapshot(request) {
    var snapshot = { ptr: String(request || ptr(0)), resultItemId: 0, itemKeys: [] };
    if (isBadPtr(request)) return snapshot;
    try {
        var info = classInfo('TaskbarHero', 'InventoryExchangeRequest');
        if (info.fields.resultItemId != null) {
            snapshot.resultItemId = request.add(info.fields.resultItemId).readS32();
        }
        if (info.fields.itemKey != null) {
            snapshot.itemKeys = readManagedStringArray(request.add(info.fields.itemKey).readPointer(), 32);
        } else if (info.fields.items != null) {
            var array = request.add(info.fields.items).readPointer();
            var itemInfo = classInfo('TaskbarHero', 'InventoryConsumeItem');
            if (!isObviouslyInvalidPtr(array) && itemInfo.fields.itemKey != null) {
                var count = Math.min(array.add(0x18).readU32(), 32);
                for (var i = 0; i < count; i++) {
                    var item = array.add(0x20 + i * PTR).readPointer();
                    if (!isObviouslyInvalidPtr(item)) {
                        snapshot.itemKeys.push(il2cppString(item.add(itemInfo.fields.itemKey).readPointer()));
                    }
                }
            }
        }
    } catch (e) {
        snapshot.error = String(e);
    }
    return snapshot;
}

// BackEnd.Param inherits SortedList in the supported build. Keep only claim
// parameters for diagnosis; never serialize an arbitrary request or auth data.
function boxExchangeClaimParameters(parameter) {
    var result = {};
    if (isBadPtr(parameter)) return result;
    var keys = parameter.add(0x10).readPointer();
    var values = parameter.add(0x18).readPointer();
    var count = parameter.add(0x20).readS32();
    if (isBadPtr(keys) || isBadPtr(values) || count < 0 || count > 256) return result;
    for (var i = 0; i < count; i++) {
        var key = il2cppString(keys.add(0x20 + i * PTR).readPointer());
        if (['action', 'items', 'resultItemId', 'useBoxKeyList'].indexOf(key) < 0) continue;
        var value = values.add(0x20 + i * PTR).readPointer();
        if (isBadPtr(value)) continue;
        result[key] = key === 'resultItemId' ? value.add(0x10).readS32() : il2cppString(value);
    }
    return result;
}

function boxExchangeMatchesBatch(parameters) {
    try {
        var items = JSON.parse(parameters.items || '[]');
        return items.some(function (item) {
            return g_boxActiveClaimUids.indexOf(String(item.itemKey)) >= 0;
        });
    } catch (e) { return false; }
}

function installPassiveSynthesisTrace() {
    startBoxLogHistoryPolling();
    if (g_passiveTraceInstalled) return g_passiveTraceListeners.length;
    var installed = 0;
    var current = synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT;

    function attach(ns, className, methodName, argCount, callbacks, expectedRva) {
        var label = (ns ? ns + '.' : '') + className + '.' + methodName;
        try {
            var mi = findMethodInfo(ns, className, methodName, argCount);
            if (!mi || mi.isNull()) mi = findMethodInfoByClassMethod(ns, className, methodName);
            if ((!mi || mi.isNull()) && expectedRva) mi = findMethodInfoByRva(expectedRva);
            var fp = methodPtr(mi);
            if (!fp || fp.isNull()) {
                emit('auto_synthesis_trace_setup', { label: label, hooked: false, error: 'method-not-found' });
                return;
            }
            if (expectedRva && (fp.sub(B).toInt32() >>> 0) !== (expectedRva >>> 0)) {
                throw new Error(label + ' expected RVA=0x' + expectedRva.toString(16) +
                    ' actual=0x' + (fp.sub(B).toInt32() >>> 0).toString(16));
            }
            var listener = Interceptor.attach(fp, callbacks);
            g_passiveTraceListeners.push(listener);
            installed++;
            emit('auto_synthesis_trace_setup', {
                label: label,
                hooked: true,
                rva: '0x' + fp.sub(B).toString(16)
            });
        } catch (e) {
            emit('auto_synthesis_trace_setup', { label: label, hooked: false, error: String(e) });
        }
    }

    if (current) {
        var boxExchangeRequests = {};
        attach('TaskbarHero', 'InventoryExchange', 'GetParam', 0, {
            onEnter: function (args) { this.owner = String(args[0]); },
            onLeave: function (result) {
                try {
                    var parameters = boxExchangeClaimParameters(result);
                    var request = { parameters: parameters, requestedAt: Date.now(),
                        batchAt: g_boxLastRequestedAt, owner: this.owner };
                    g_nativeInventoryExchangeRequests[this.owner] = request;
                    emit('native_inventory_exchange_request', request);
                    if (!boxExchangeMatchesBatch(parameters)) return;
                    boxExchangeRequests[this.owner] = request;
                    emit('auto_box_exchange_request', request);
                } catch (e) {}
            }
        }, 0xac8af0);
        attach('TaskbarHero', 'InventoryFunction', 'lud', 1, {
            onEnter: function (args) {
                this.owner = String(args[0]);
                this.request = boxExchangeRequests[this.owner];
                this.exchangeRequest = g_nativeInventoryExchangeRequests[this.owner];
            },
            onLeave: function (result) {
                if (!this.exchangeRequest) return;
                delete boxExchangeRequests[this.owner];
                delete g_nativeInventoryExchangeRequests[this.owner];
                try {
                    var type = managedType(result);
                    var error = '';
                    var code = 0;
                    if (type.indexOf('InventoryFunctionError') >= 0) {
                        var fields = classInfo('TaskbarHero', 'InventoryFunctionError').fields;
                        error = il2cppString(result.add(fields.error).readPointer());
                        code = result.add(fields.code).readS32();
                        if (this.request && this.request.batchAt === g_boxLastRequestedAt) {
                            g_boxExchangeErrors.push(code + ': ' + error);
                        }
                    }
                    emit(this.request ? 'auto_box_exchange_response' : 'native_inventory_exchange_response', {
                        request: this.exchangeRequest, resultType: type, code: code,
                        error: error, observedAt: Date.now()
                    });
                    if (code === 5001) queueFailedExchangeRecovery([{
                        code:code, resultItemId:this.exchangeRequest.parameters.resultItemId,
                        requestedAt:this.exchangeRequest.requestedAt
                    }]);
                } catch (e) {}
            }
        }, 0xacb240);
        // FunctionBase also completes transport-error responses that may bypass
        // InventoryFunction.ktn. Do not leave a finished request marked active.
        attach('TaskbarHero', 'FunctionBase', 'lui', 1, {
            onEnter: function (args) { this.owner = String(args[0]); },
            onLeave: function () {
                if (!g_nativeInventoryExchangeRequests[this.owner]) return;
                delete g_nativeInventoryExchangeRequests[this.owner];
                delete boxExchangeRequests[this.owner];
            }
        }, 0xac56d0);
    }

    (current ? [SYNTHESIS_BRIDGE_CURRENT.executeBackend] : [
        { methodName: 'ipf', argCount: 1, rva: 0x8c1350 },
        { methodName: 'iph', argCount: 0, rva: 0x8c15d0 }
    ]).forEach(function (row) {
        attach('', 'Cube', row.methodName, row.argCount, {
            onEnter: function () {
                g_lastSynthesisTraceAt = Date.now();
                emit('auto_synthesis_trace', {
                    stage: 'cube-call',
                    method: 'Cube.' + row.methodName,
                    rva: '0x' + this.context.pc.sub(B).toString(16)
                });
            }
        }, row.rva);
    });

    attach('TaskbarHero', 'InventoryExchangeRequest', 'Initialize', current ? 3 : 2, {
        onEnter: function (args) {
            this.request = args[0];
        },
        onLeave: function () {
            var snapshot = exchangeRequestSnapshot(this.request);
            if (!snapshot.itemKeys.length) return;
            if (g_pendingSynthesisBatch && snapshot.itemKeys.length === g_threshold &&
                    Date.now() - g_pendingSynthesisAt < 3000) {
                g_pendingSynthesisBatch.gameRequestMatched =
                    gameItemKeysMatchBatch(snapshot.itemKeys, g_pendingSynthesisBatch);
            }
            g_lastExchangeTraceAt = Date.now();
            log('已捕获游戏真实合成请求：材料数量 ' + snapshot.itemKeys.length + '。');
            emit('auto_synthesis_trace', {
                stage: snapshot.itemKeys.length === 9 ? 'synthesis-exchange-request' : 'exchange-request',
                request: snapshot,
                sinceCubeCallMs: g_lastSynthesisTraceAt ? Date.now() - g_lastSynthesisTraceAt : -1
            });
        }
    }, current ? 0xac8200 : 0x96bb60);

    attach('TaskbarHero', 'InventoryExchangeRequest', 'ToJson', 0, {
        onLeave: function (retval) {
            if (Date.now() - g_lastExchangeTraceAt > 3000) return;
            emit('auto_synthesis_trace', { stage: 'exchange-json', json: il2cppString(retval) });
        }
    }, current ? 0xac82c0 : 0x96bce0);

    attach('TaskbarHero', 'InventoryExchangeResult', 'Initialize', 1, {
        onEnter: function (args) {
            this.result = args[0];
        },
        onLeave: function () {
            if (!g_pendingSynthesisSignature) return;
            var snapshot = operationResultSnapshot(this.result, 'InventoryExchangeResult');
            var confirmedByPayload = snapshot.success || snapshot.added.length > 0 || snapshot.removed.length >= g_threshold;
            if (confirmedByPayload) {
                var resultMatched = gameItemKeysMatchBatch(snapshot.removed, g_pendingSynthesisBatch);
                var consumedSource = resultMatched ? 'game-result' :
                    (g_pendingSynthesisBatch && g_pendingSynthesisBatch.gameRequestMatched ?
                        'game-request' : 'verified-cube-slots');
                if (snapshot.removed.length && !resultMatched) {
                    emit('auto_synthesis_consume_unmatched', {
                        removedCount: snapshot.removed.length,
                        selectedCount: g_pendingSynthesisBatch && g_pendingSynthesisBatch.items &&
                            g_pendingSynthesisBatch.items.length || 0,
                        requestMatched: !!(g_pendingSynthesisBatch && g_pendingSynthesisBatch.gameRequestMatched)
                    });
                }
                g_pendingSynthesisResultReceived = true;
                markSharedGameAction(3000);
                rememberConsumedSynthesisBatch(g_pendingSynthesisBatch);
                try {
                    if (!enqueueSynthesisResultCleanup('收到游戏合成成功回包')) {
                        log('合成成功，但合成栏清空任务暂未挂载，将在下一次扫描时重试。');
                    }
                } catch (cleanupError) {
                    log('合成成功，但合成栏清空任务暂未挂载，将在下一次扫描时重试。');
                }
                emit('auto_synthesis_result', {
                    success: true,
                    eventId: g_pendingSynthesisBatch && g_pendingSynthesisBatch.eventId || '',
                    category: g_pendingSynthesisBatch && g_pendingSynthesisBatch.category || '',
                    grade: g_pendingSynthesisBatch && g_pendingSynthesisBatch.grade || '',
                    consumed: consumedItemsFromBatch(g_pendingSynthesisBatch),
                    consumedSource: consumedSource,
                    removedUniqueKeys: snapshot.removed,
                    produced: snapshot.added,
                    confirmedAt: Date.now()
                });
            } else {
                var errorText = snapshot.error || '游戏服务器未确认合成';
                g_pendingSynthesisObservedError = errorText;
                emit('auto_synthesis_result_pending', {
                    success: false,
                    error: errorText,
                    consumed: consumedItemsFromBatch(g_pendingSynthesisBatch),
                    produced: snapshot.added,
                    observedAt: Date.now()
                });
            }
        }
    }, current ? 0xac8400 : 0x9b2730);

    attach('TaskbarHero.Log', 'LogManager', 'mhu', 1, {
        onEnter: function (args) {
            setBoxLogHistoryManager(args[0]);
            captureBoxOpenGameLog(args[1], 'game-log-native');
        }
    }, current ? 0xb43d10 : undefined);

    attach('TaskbarHero', 'InventoryProcessBoxResult', 'Initialize', 1, {
        onEnter: function (args) {
            this.result = args[0];
        },
        onLeave: function () {
            if (!g_boxOpenInFlight && !g_boxResultTimer) return;
            var snapshot = operationResultSnapshot(this.result, 'InventoryProcessBoxResult');
            // One callback belongs to one box, not the entire native bulk loop.
            if (snapshot.added.length) {
                g_boxResultPendingAdded = (g_boxResultPendingAdded || []).concat(snapshot.added);
            }
            if (!snapshot.success) {
                g_boxExchangeErrors.push(snapshot.error || '游戏服务器未确认开箱');
                emit('auto_box_exchange_error', {
                    boxType: g_boxOpenInFlightType,
                    error: snapshot.error || '', source: 'InventoryProcessBoxResult',
                    requestedAt: g_boxLastRequestedAt, observedAt: Date.now()
                });
            }
            scheduleBoxCompletionMonitor();
        }
    }, current ? 0xace770 : 0x9a1e20);

    g_passiveTraceInstalled = true;
    log('后台结果监听已启用：' + installed + ' 个低频入口。');
    return installed;
}

function sandboxInfoJson() {
    var markers = [];
    try {
        var modules = Process.enumerateModules();
        for (var i = 0; i < modules.length; i++) {
            var name = String(modules[i].name || '').toLowerCase();
            if (name.indexOf('sbiedll') !== -1 || name.indexOf('sandboxie') !== -1) {
                markers.push({ name: modules[i].name, path: modules[i].path });
            }
        }
    } catch (e) {}
    return JSON.stringify({
        pid: Process.id,
        sandboxed: markers.length > 0,
        label: markers.length > 0 ? 'Sandboxie 沙盒' : '普通进程',
        sandboxieDllPath: markers.length > 0 ? String(markers[0].path || '') : '',
        executablePath: Process.mainModule ? String(Process.mainModule.path || '') : '',
        markers: markers
    });
}

function readOnlyCheck(check) {
    try { return check(); }
    catch (e) { return { executed: false, error: chineseError(e) }; }
}

function verifyCurrentReadOnly() {
    var synthesis = resolveSynthesisBridge();
    var slots = synthesisSlotState(synthesis);
    var stageBox = resolveStageBoxRightClickHandler();
    var rows = scanInventory();
    var autoFillUi = readOnlyCheck(function () {
        if (!synthesis.autoFillEventInvoke) throw new Error('Unity 自动填充点击事件入口未解析');
        var event = resolveSynthesisAutoFillClickEvent();
        return {
            executed: false,
            available: true,
            clickEventType: managedType(event),
            invokeRva: '0x' + synthesis.autoFillEventInvoke.ptr.sub(B).toString(16)
        };
    });
    var deposit = readOnlyCheck(function () {
        var bridge = resolveAutoDepositBridge();
        var bulk = resolveFullBackpackDepositBridge();
        var firstEmptyIndex = bridge.firstEmptyIndex.fn(bridge.firstEmptyIndex.mi) | 0;
        var page = firstEmptyIndex >= 0 && firstEmptyIndex < STASH_SLOT_COUNT ?
            bridge.pageFromIndex.fn(firstEmptyIndex, bridge.pageFromIndex.mi) | 0 : -1;
        return {
            executed: false,
            firstEmptyIndex: firstEmptyIndex,
            firstEmptyPage: page < 0 ? 0 : page + 1,
            moveRequestRva: '0x' + bridge.moveRequest.ptr.sub(B).toString(16),
            oneClickDepositRva: '0x' + bulk.depositAll.ptr.sub(B).toString(16),
            stashPageSwitchRva: '0x' + bulk.switchPage.ptr.sub(B).toString(16),
            pageSize: STASH_PAGE_SIZE,
            pageCount: STASH_PAGE_COUNT
        };
    });
    var boss = readOnlyCheck(autoBossReadOnlyDiagnostics);
    var gameplay = readOnlyCheck(gameplayReadOnlyDiagnostics);
    return JSON.stringify({
        executed: false,
        gameAssembly: { path: GA.path, size: GA.size, base: String(B) },
        gameVersion: '2026-10-27/build26211490',
        synthesis: {
            activeSlotCount: slots.activeCount,
            slotCountRva: methodRvaText(synthesis.slotCount),
            executeBackendRva: '0x' + synthesis.executeBackend.ptr.sub(B).toString(16),
            resetRva: '0x' + synthesis.reset.ptr.sub(B).toString(16),
            gameAutofill: autoFillUi
        },
        box: {
            rightClickRva: '0x' + stageBox.ptr.sub(B).toString(16),
            rightClickMethod: stageBox.methodName,
            instances: stageBoxInstanceSnapshot(),
            snapshot: scanBoxSnapshot()
        },
        autoDeposit: deposit,
        autoBoss: boss,
        gameplay: gameplay,
        runtimeItemCount: Number(g_lastRuntimeItemCache.cachedItems) || 0,
        placedCandidateCount: rows.length,
        scanErrors: g_lastScanErrors,
        tradeShip: tradeShipReadOnlyDiagnostics(),
        unavailable: ['legacyDirectSynthesis']
    });
}

// Corrosion uses the game's CORROSION recipe and its server-confirmed currency result.
var g_autoCorrosionEnabled = false;
var g_corrosionMaxGrade = 0;
var g_corrosionCategoryRules = {};
var g_corrosionProtectPriceCny = 0;
var g_corrosionIncludeStash = false;
var g_corrosionProtectedCategories = {};
var g_corrosionProtectedGrades = {};
var g_corrosionProtectedItemIds = {};
var g_corrosionProtectedRelicGrades = {};
var g_corrosionPollutionThreshold = 300;
var g_corrosionWarehouseThresholdPercent = 50;
var g_corrosionMinimumIntervalMs = 120000;
var g_lastCorrosionAt = 0;
var g_corrosionProtectRelics = true;
var g_corrosionProtectOfferingMaterials = true;
var g_corrosionProtectSoulstones = true;
var g_corrosionProtectJackTickets = true;
var g_corrosionExcludeInscriptionScrolls = true;
var g_corrosionExcludeOfferingCoins = true;
var g_corrosionBatchActive = false;
var g_corrosionQueued = false;
var g_corrosionPending = null;
var g_corrosionFinishQueued = false;
var g_corrosionRejectedUids = {};
var g_corrosionRoundFailed = false;
var g_corrosionNextCheckAt = 0;
var g_corrosionLastPollErrorLogAt = 0;
var g_corrosionCount = 0;
var g_corrosionLastResult = '';
var g_corrosionBridge = null;
var g_corrosionListeners = [];
var g_corrosionThresholdState = null;

function corrosionThresholdStateFor(pollution, counts, observedAt) {
    counts = counts || {};
    var warehouseCapacity = STASH_SLOT_COUNT;
    var warehouseUsed = Math.max(0, Number(counts.stash) || 0);
    var warehousePercent = warehouseCapacity > 0 ?
        Math.min(100, warehouseUsed * 100 / warehouseCapacity) : 0;
    var pollutionValue = Number(pollution);
    if (!Number.isFinite(pollutionValue)) pollutionValue = -1;
    var pollutionTriggered = g_corrosionPollutionThreshold > 0 &&
        pollutionValue >= 0 && pollutionValue < g_corrosionPollutionThreshold;
    var warehouseTriggered = warehousePercent >= g_corrosionWarehouseThresholdPercent;
    var reasons = [];
    if (pollutionTriggered) reasons.push('污染度');
    if (warehouseTriggered) reasons.push('仓库占用');
    return {
        pid: Process.id,
        observedAt: observedAt || Date.now(),
        inventoryObservedAt: Number(counts.observedAt) || 0,
        pollution: pollutionValue,
        pollutionThreshold: g_corrosionPollutionThreshold,
        pollutionTriggered: pollutionTriggered,
        warehouseUsed: warehouseUsed,
        warehouseCapacity: warehouseCapacity,
        warehousePercent: warehousePercent,
        warehouseThresholdPercent: g_corrosionWarehouseThresholdPercent,
        warehouseTriggered: warehouseTriggered,
        triggered: reasons.length > 0,
        reason: reasons.join(' + ') || '未达到'
    };
}

function corrosionLog(message) { channelLog('自动腐蚀', message); }

function corrosionProtectedItemKey(itemKey, gradeValue) {
    itemKey = Number(itemKey) || 0;
    var id = String(itemKey);
    var prefix = id.substring(0, 2);
    if (g_corrosionProtectedItemIds[id] === true) return true;
    if (g_corrosionExcludeInscriptionScrolls && prefix === '13') return true;
    if (g_corrosionExcludeOfferingCoins && prefix === '16') return true;
    if (g_corrosionProtectOfferingMaterials && prefix === '16') return true;
    if (g_corrosionProtectSoulstones && prefix === '19') return true;
    if (g_corrosionProtectJackTickets && [170101, 170102, 170103].indexOf(itemKey) >= 0) return true;
    return false;
}

function corrosionCategoryForRow(row) {
    var category = String(row && row.categoryKey || '').toLowerCase();
    if (category === 'equipment' || category === 'material' || category === 'accessory') return category;
    // Runtime synthesis classification deliberately excludes relics. Their
    // stable 7x item-key family is used only for corrosion's explicit rule.
    var itemKey = String(row && row.itemKey || '');
    if (/^7[0-9]/.test(itemKey)) return 'relic';
    return '';
}

function corrosionUidRejected(uid, includeRetryable) {
    var state = g_corrosionRejectedUids[String(uid)];
    if (!state) return false;
    if (state === true || state.permanent) return true;
    return !includeRetryable && Date.now() < Number(state.retryAt || 0);
}

function rejectCorrosionUid(uid, reason, retryMs) {
    var key = String(uid), previous = g_corrosionRejectedUids[key];
    var attempts = previous && typeof previous === 'object' ? Number(previous.attempts || 0) + 1 : 1;
    var permanent = attempts >= 3;
    var state = {attempts:attempts, permanent:permanent, reason:String(reason || '未确认消耗'), at:Date.now()};
    if (!permanent) state.retryAt = Date.now() + (Number(retryMs) > 0 ? Number(retryMs) : (5000 * attempts));
    g_corrosionRejectedUids[key] = state;
    return state;
}

function corrosionCandidate(row, includeRetryableRejections) {
    if (!row || !row.runtimeInfo || !row.placed || row.equipped ||
            row.serverPending || row.deletedInServer || row.temporaryBlocked) return false;
    var corrosionCategory = corrosionCategoryForRow(row);
    var categoryRule = g_corrosionCategoryRules[corrosionCategory];
    if (!corrosionCategory || !categoryRule || categoryRule.enabled !== true) return false;
    if (g_corrosionProtectedCategories[corrosionCategory] === true ||
            g_corrosionProtectedGrades[String(row.gradeValue)] === true ||
            g_corrosionProtectedGrades[String(row.gradeKey || '').toLowerCase()] === true) return false;
    if (row.gradeValue == null) return false;
    var grade = Number(row.gradeValue);
    if (!isFinite(grade) || Math.floor(grade) !== grade || grade < 0 || grade > categoryRule.maxGrade) return false;
    if (g_corrosionProtectPriceCny > 0) {
        var cachedPrice = g_marketPriceItems[String(row.itemKey)] || null;
        var cachedPriceValue = cachedPrice ? Number(cachedPrice.priceCny) : NaN;
        var cachedPriceAt = cachedPrice ? Number(cachedPrice.updatedAt || g_marketPriceUpdatedAt) : 0;
        if (!cachedPrice || cachedPrice.resolved !== true || !Number.isFinite(cachedPriceValue) ||
                cachedPriceValue <= 0 || cachedPriceAt <= 0 || Date.now() / 1000 - cachedPriceAt > 3600) return false;
        if (cachedPriceValue > g_corrosionProtectPriceCny) return false;
    }
    if (corrosionProtectedItemKey(row.itemKey, row.gradeValue) ||
            g_synthesisIgnoreItemIds.indexOf(Number(row.itemKey)) >= 0 ||
            corrosionUidRejected(row.uid, includeRetryableRejections) ||
            g_recentlyConsumedUids[String(row.uid)]) return false;
    return (row.sources || []).some(function (source) {
        return source.source === '背包' || (g_corrosionIncludeStash && (source.source === '仓库' || source.source === '材料仓库'));
    });
}

function corrosionArrayObjects(array) {
    if (isBadPtr(array)) return [];
    var count = array.add(0x18).readU32();
    if (count > 10000) throw new Error('腐蚀回包数组长度异常');
    var result = [];
    for (var i = 0; i < count; i++) result.push(array.add(0x20 + i * PTR).readPointer());
    return result;
}

function resolveCorrosionBridge() {
    if (g_corrosionBridge) return g_corrosionBridge;
    requireCurrentGameBuild();
    if (synthesisBridgeProfile() !== SYNTHESIS_BRIDGE_CURRENT) throw new Error('自动腐蚀尚未适配该游戏版本');
    var bridge = {cube: resolveSynthesisBridge()};
    function method(ns, cls, name, rva, returnType, args) {
        var row = resolveCubeBridgeMethod({namespace: ns, className: cls, methodName: name, rva: rva,
            argCount: name === 'jnm' ? 0 : args.length - 1 - (cls === 'Cube' ? 0 : 1)});
        row.fn = new NativeFunction(row.ptr, returnType, args);
        return row;
    }
    // Current builds execute corrosion through the native recipe lifecycle.
    // The old direct entry has changed signature and is not used by this path.
    bridge.execute = bridge.cube.current ? null :
        method('', 'Cube', 'jnq', 0x972220, 'void', ['pointer', 'pointer']);
    bridge.busy = method('', 'Cube', 'jix', 0x962470, 'bool', ['pointer']);
    if (bridge.execute) verifyManagedMethodShape('Cube.jnq', bridge.execute, 'Cysharp.Threading.Tasks.UniTask', []);
    verifyManagedMethodShape('Cube.jix', bridge.busy, 'System.Boolean', []);
    bridge.initialize = method('TaskbarHero', 'CorrosionFunctionResult', 'Initialize', 0xaaafd0,
        'void', ['pointer', 'pointer', 'pointer']);
    bridge.success = method('TaskbarHero', 'CorrosionFunctionResult', 'get_IsSuccess', 0xaab660,
        'bool', ['pointer', 'pointer']);
    bridge.error = method('TaskbarHero', 'CorrosionFunctionResult', 'get_Error', 0xaaac80,
        'pointer', ['pointer', 'pointer']);
    bridge.pollution = method('TaskbarHero', 'CorrosionFunctionResult', 'get_PollutionValue', 0xaab690,
        'int64', ['pointer', 'pointer']);
    bridge.fields = classInfo('TaskbarHero', 'CorrosionFunctionResult').fields;
    bridge.countFields = classInfo('TaskbarHero', 'InventoryItemData').fields;
    bridge.progress = method('', 'wh', 'khk', 0xa36230, 'int64', ['pointer', 'pointer']);
    bridge.recipeType = method('', 'xp', 'lel', 0xa86a40, 'int', ['pointer', 'pointer']);
    // Resolve the recipe getter by its actual MethodInfo rather than assuming an offset.
    g_corrosionBridge = bridge;
    try {
        g_corrosionListeners.push(Interceptor.attach(bridge.initialize.ptr, {
            onEnter: function (args) { this.result = args[0]; },
            onLeave: function () {
                var result = this.result;
                if (!g_corrosionPending || g_corrosionPending.response || isBadPtr(result)) return;
                try {
                    if (cstr(il2cpp.classGetName(il2cpp.objectGetClass(result))) !== 'CorrosionFunctionResult') return;
                    var removed = corrosionArrayObjects(result.add(bridge.fields.removed).readPointer()).map(il2cppString);
                    var counts = {};
                    corrosionArrayObjects(result.add(bridge.fields.counts).readPointer()).forEach(function (item) {
                        if (isBadPtr(item)) return;
                        counts[il2cppString(item.add(bridge.countFields.itemKey).readPointer())] =
                            item.add(bridge.countFields.count).readS32();
                    });
                    var success = !!bridge.success.fn(result, bridge.success.mi);
                    var consumed = corrosionConfirmedItems(g_corrosionPending.items, removed, counts);
                    if (success && !consumed.length) return; // An unrelated/manual result is not our confirmation.
                    g_corrosionPending.response = {success: success,
                        pollutionAfter: Number(bridge.pollution.fn(result, bridge.pollution.mi).toString()),
                        error: il2cppString(bridge.error.fn(result, bridge.error.mi)),
                        consumed: consumed, removed: removed, counts: counts};
                    queueCorrosionFinish();
                } catch (error) {
                    corrosionLog('腐蚀回包读取失败，保持等待，不重复提交：' + chineseError(error));
                }
            }
        }));
        // This is the game's own corrosion feedback callback; its gain is optional
        // when the corresponding UI is not active. Never infer gain from a decaying balance.
        // Current builds expose no stable UI callback for pollution gain;
        // server-confirmed result fields remain authoritative.
    } catch (error) {
        g_corrosionListeners.forEach(function (listener) { listener.detach(); });
        g_corrosionListeners = [];
        g_corrosionBridge = null;
        throw error;
    }
    return bridge;
}

function readCorrosionPollution(bridge) {
    var klass = findClassByEnumeratedName('', 'Plaguelands');
    if (isBadPtr(klass)) throw new Error('无法读取游戏污染值控制器类型');
    var fieldInfo = runtimeClassFields(klass);
    var fields = fieldInfo.fields;
    var data = il2cpp.classGetStaticFieldData(klass);
    var controllerField = fields.birr;
    if (isBadPtr(data) || controllerField == null) {
        var fieldSummary = Object.keys(fields).map(function (name) {
            var info = fieldInfo.fieldInfos[name];
            var flags = info ? il2cpp.fieldGetFlags(info) : 0;
            var typeName = info ? cstr(il2cpp.typeGetName(il2cpp.fieldGetType(info))) : '';
            return name + ':' + typeName + ((flags & 0x10) !== 0 ? ':static' : ':instance');
        }).join(',');
        throw new Error('无法读取游戏污染值控制器；Plaguelands字段=' + fieldSummary);
    }
    var controller = data.add(controllerField).readPointer();
    if (isBadPtr(controller)) throw new Error('污染值控制器尚未就绪（Plaguelands.' +
        (fields.birr != null ? 'birr' : 'birr') + '为空）');
    var controllerFields = runtimeClassFields(il2cpp.objectGetClass(controller)).fields;
    var progressField = controllerFields.biry;
    if (progressField == null) throw new Error('污染值进度字段未找到；PlaguelandsController字段=' +
        Object.keys(controllerFields).join(','));
    var progress = controller.add(progressField).readPointer();
    if (isBadPtr(progress)) throw new Error('污染值数据尚未就绪（PlaguelandsController.' +
        (controllerFields.biry != null ? 'biry' : 'biry') + '为空）');
    return Number(bridge.progress.fn(progress, bridge.progress.mi).toString());
}

function corrosionPollutionDiagnostics() {
    var classCountApi = api('il2cpp_image_get_class_count', 'int', ['pointer']);
    var classApi = api('il2cpp_image_get_class', 'pointer', ['pointer', 'int']);
    var matches = [];
    allImages().forEach(function (imageRow) {
        if (imageRow.name !== 'Assembly-CSharp.dll') return;
        var count = classCountApi(imageRow.image) | 0;
        for (var i = 0; i < count; i++) {
            var runtimeClass = classApi(imageRow.image, i);
            if (isBadPtr(runtimeClass)) continue;
            var className = cstr(il2cpp.classGetName(runtimeClass));
            var namespaceName = cstr(il2cpp.classGetNamespace(runtimeClass));
            if (!/plague|pollution|corrosion/i.test(className + ' ' + namespaceName)) continue;
            var info = runtimeClassFields(runtimeClass);
            var fields = [];
            Object.keys(info.fields).forEach(function (name) {
                var field = info.fieldInfos[name];
                var flags = field ? il2cpp.fieldGetFlags(field) : 0;
                var type = field ? cstr(il2cpp.typeGetName(il2cpp.fieldGetType(field))) : '';
                var row = {name:name, offset:info.fields[name], type:type,
                    isStatic:(flags & 0x10) !== 0};
                if (row.isStatic && field && /plague|pollution|progress|controller/i.test(type)) {
                    try {
                        var storage = Memory.alloc(PTR);
                        storage.writePointer(ptr(0));
                        il2cpp.fieldStaticGetValue(field, storage);
                        var value = storage.readPointer();
                        row.staticReferenceReady = !isBadPtr(value);
                        if (!isBadPtr(value)) {
                            var valueClass = il2cpp.objectGetClass(value);
                            if (!isBadPtr(valueClass)) {
                                row.staticReferenceType = cstr(il2cpp.classGetNamespace(valueClass)) + '.' +
                                    cstr(il2cpp.classGetName(valueClass));
                            }
                        }
                    } catch (readError) { row.staticReadError = chineseError(readError); }
                }
                fields.push(row);
            });
            matches.push({namespace:namespaceName, className:className, fields:fields});
            if (matches.length >= 30) break;
        }
    });
    return JSON.stringify({status:'SUCCESS', classes:matches, count:matches.length});
}

function corrosionConfirmedItems(selected, removed, counts) {
    var consumed = [];
    selected.forEach(function (item) {
        var uid = String(item.uid), before = Number(item.totalQuantity || 1);
        var amount = removed.indexOf(uid) >= 0 ? before :
            (Object.prototype.hasOwnProperty.call(counts, uid) ? before - Number(counts[uid]) : 0);
        if (amount > 0) consumed.push({uid:uid, itemId:item.itemKey, grade:item.grade,
            category:item.category, count:Math.min(amount, before)});
    });
    return consumed;
}

function selectHeadlessCubeRecipe(bridge, recipeType) {
    var cubeClass = il2cpp.methodGetClass(bridge.cube.selectRecipe.mi);
    var info = runtimeClassFields(cubeClass);
    if (info.fields.bikg !== 0x108 || info.fields.bikk !== 0x128 ||
            !info.fieldInfos.bikg || !info.fieldInfos.bikk ||
            cstr(il2cpp.typeGetName(il2cpp.fieldGetType(info.fieldInfos.bikg))) !==
                'System.Collections.Generic.Dictionary<TaskbarHero.Data.ERecipeType,xp>' ||
            cstr(il2cpp.typeGetName(il2cpp.fieldGetType(info.fieldInfos.bikk))) !== 'xp') {
        throw new Error('当前版后台腐蚀配方字段布局校验失败');
    }
    var dictionaryStorage = Memory.alloc(PTR);
    dictionaryStorage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(info.fieldInfos.bikg, dictionaryStorage);
    var dictionary = dictionaryStorage.readPointer();
    var recipeRow = intPointerDictionaryRows(dictionary, 64).filter(function (row) {
        return row.key === (recipeType | 0);
    })[0];
    if (!recipeRow || isBadPtr(recipeRow.value) || managedType(recipeRow.value) !== 'xp') {
        throw new Error('游戏后台配方目录中没有腐蚀配方');
    }
    var selectedSpecific = false;
    if (bridge.cube.selectSpecificRecipe) {
        try {
            selectedSpecific = bridge.cube.selectSpecificRecipe.fn(
                recipeRow.value, bridge.cube.selectSpecificRecipe.mi) === true;
        } catch (specificRecipeError) {}
    }
    var activeStorage = Memory.alloc(PTR);
    activeStorage.writePointer(ptr(0));
    il2cpp.fieldStaticGetValue(info.fieldInfos.bikk, activeStorage);
    var activeRecipe = activeStorage.readPointer();
    if (isBadPtr(activeRecipe) || !sameNativePointer(activeRecipe, recipeRow.value)) {
        // Cube.jki depends on UI_Cube being initialized. With the game feature
        // window closed, select the already-loaded recipe model directly in
        // Cube's static backend state; no Unity window or mouse action is used.
        var recipeStorage = Memory.alloc(PTR);
        recipeStorage.writePointer(recipeRow.value);
        api('il2cpp_field_static_set_value', 'void', ['pointer', 'pointer'])(
            info.fieldInfos.bikk, recipeStorage);
        activeStorage.writePointer(ptr(0));
        il2cpp.fieldStaticGetValue(info.fieldInfos.bikk, activeStorage);
        activeRecipe = activeStorage.readPointer();
    }
    if (isBadPtr(activeRecipe) || !sameNativePointer(activeRecipe, recipeRow.value)) {
        throw new Error('后台腐蚀配方切换校验失败：specific=' + selectedSpecific +
            '，字典目标键=' + (recipeType | 0));
    }
    return {recipe:activeRecipe, recipeType:recipeType | 0, selectedSpecific:selectedSpecific};
}

function processCorrosionBatch(item) {
    if (!g_running || !g_autoCorrosionEnabled || g_corrosionPending) {
        g_corrosionQueued = false;
        return;
    }
    if (g_synthesisBatchQueued || g_synthesisCleanupQueued || g_pendingSynthesisSignature) {
        item.deferUntil = Date.now() + 120;
        g_queue.push(item);
        return;
    }
    g_corrosionQueued = false;
    var bridge = resolveCorrosionBridge(), cube = bridge.cube;
    if (bridge.busy.fn(bridge.busy.mi) || g_pendingSynthesisSignature || boxInventoryMutationActive()) return;
    scanInventory();
    var current = {};
    g_lastPlacedRows.filter(function (row) { return corrosionCandidate(row); }).forEach(function (row) { current[String(row.uid)] = row; });
    var candidates = item.items.map(function (row) { return current[String(row.uid)]; }).filter(function (row) {
        return !!row && (!item.backpackSpaceRecovery || boxRecoveryBackpackRow(row));
    });
    if (!candidates.length) return;
    cube.reset.fn(cube.reset.mi);
    selectHeadlessCubeRecipe(bridge, 9);
    cube.reset.fn(cube.reset.mi);
    // reset clears the slots and can also restore a default recipe when the
    // cube window is absent, so re-apply and verify the headless recipe state.
    selectHeadlessCubeRecipe(bridge, 9);
    var selected = [];
    try {
        candidates.slice(0, 9).forEach(function (row) {
            var sources = synthesisSources(row).filter(function (source) {
                return source.source === '背包' || (!item.backpackSpaceRecovery && g_corrosionIncludeStash);
            });
            var verified = resolveRuntimeSynthesisCandidate(cube, Object.assign({}, row, {sources: sources}));
            if (!verified.ok) { rejectCorrosionUid(row.uid, verified.reason); return; }
            var result = cube.addSlot.fn(verified.source.slotType, verified.source.index, cube.addSlot.mi);
            if (result !== 0) { rejectCorrosionUid(row.uid, '腐蚀槽位添加结果 ' + result); return; }
            row.totalQuantity = (row.sources || []).reduce(function (n, source) {return n + Number(source.quantity || 1);}, 0);
            selected.push(row);
        });
        if (!selected.length) { cube.reset.fn(cube.reset.mi); return; }
        verifyCubeSlotUids(cube, selected, '提交腐蚀前');
        var pollutionBefore = null;
        try { pollutionBefore = readCorrosionPollution(bridge); } catch (pollutionReadError) {}
        g_corrosionPending = {eventId: String(Process.id) + '-corrosion-' + Date.now(),
            items: selected, at: Date.now(), pollutionBefore: pollutionBefore,
            pollutionGain: null, response: null, retbuf: Memory.alloc(0x40)};
        g_corrosionPending.retbuf.writeByteArray(new Uint8Array(0x40));
        var nativeLifecycle = cube.current === true;
        if (nativeLifecycle) {
            if (!cube.triggerRecipe) throw new Error('当前版本缺少魔方完整执行入口');
            if (cube.refreshRecipe) cube.refreshRecipe.fn(0, cube.refreshRecipe.mi);
            cube.triggerRecipe.fn(cube.triggerRecipe.mi);
        } else bridge.execute.fn(g_corrosionPending.retbuf, bridge.execute.mi);
        // UniTask<bool> has source at +0 and inline result at +8 (verified
        // against the current return-type metadata). A null source with false
        // is a completed local refusal, so no server callback will ever arrive.
        var locallyRefused = nativeLifecycle ? !bridge.busy.fn(bridge.busy.mi) :
            (g_corrosionPending.retbuf.readPointer().isNull() && g_corrosionPending.retbuf.add(8).readU8() === 0);
        if (locallyRefused && !g_corrosionPending.response) {
            var refusedEventId = g_corrosionPending.eventId;
            g_corrosionPending = null;
            cube.reset.fn(cube.reset.mi);
            // The game rejects the whole local batch when one stale UID is
            // present. Do not blacklist every valid item in that batch: split
            // it into singleton requests and only reject the exact UID that
            // still fails its own native validation.
            if (selected.length > 1) {
                selected.forEach(function (row, index) {
                    g_queue.push({action:'corrosionBatch', items:[row], at:Date.now(), deferUntil:Date.now() + index * 80});
                });
                g_corrosionLastResult = '本批腐蚀被游戏拒绝，已拆分逐件复核剩余装备';
            } else {
                rejectCorrosionUid(selected[0].uid,'游戏原生腐蚀校验未通过，未发送请求');
                g_corrosionLastResult = '单件物品未通过游戏腐蚀校验，已跳过并继续检查剩余物品';
            }
            corrosionLog(g_corrosionLastResult + '。');
            emit('auto_corrosion_skipped',{eventId:refusedEventId,itemCount:selected.length,reason:g_corrosionLastResult,
                splitBatch:selected.length > 1});
            return;
        }
        emit('auto_corrosion_submitted',{eventId:g_corrosionPending.eventId,
            itemCount:selected.length,nativeLifecycle:nativeLifecycle,
            taskSource:nativeLifecycle ? null : String(g_corrosionPending.retbuf.readPointer()),
            taskResult:nativeLifecycle ? null : g_corrosionPending.retbuf.add(8).readU8()});
        g_corrosionLastResult = '已提交腐蚀 ' + selected.length + ' 个槽位，等待游戏结算';
        corrosionLog(g_corrosionLastResult + '。');
    } catch (error) {
        if (!g_corrosionPending) cube.reset.fn(cube.reset.mi);
        throw error;
    }
}

function queueCorrosionFinish() {
    if (!g_corrosionPending || !g_corrosionPending.response || g_corrosionFinishQueued) return;
    if (!ensureUpdateHook()) return;
    g_corrosionFinishQueued = true;
    g_queue.push({action:'corrosionFinish', at:Date.now()});
}

function finishCorrosionBatch(item) {
    g_corrosionFinishQueued = false;
    var pending = g_corrosionPending;
    if (!pending || !pending.response) return;
    var bridge = resolveCorrosionBridge();
    if (bridge.busy.fn(bridge.busy.mi)) {
        g_corrosionFinishQueued = true;
        item.deferUntil = Date.now() + 200;
        g_queue.push(item);
        return;
    }
    bridge.cube.reset.fn(bridge.cube.reset.mi);
    var response = pending.response;
    response.type = 'auto_corrosion_result';
    response.eventId = pending.eventId;
    response.confirmedAt = Date.now();
    response.pollutionBefore = pending.pollutionBefore;
    response.pollutionGain = pending.pollutionGain;
    response.consumedCount = response.consumed.reduce(function (n, row) {return n + row.count;}, 0);
    var retryCount = 0;
    pending.items.forEach(function (row) {
        var actual = response.consumed.find(function (item) {return item.uid === String(row.uid);});
        if (!actual) {
            if (response.success) {
                var retry = rejectCorrosionUid(row.uid, '游戏回包未确认该物品已消耗');
                if (!retry.permanent) retryCount++;
            }
        } else {
            g_recentlyConsumedUids[String(row.uid)] = {batchKey:pending.eventId,
                quantityBefore:row.totalQuantity, quantityConsumed:actual.count, at:Date.now()};
        }
    });
    if (retryCount) corrosionLog('本次有 ' + retryCount + ' 个槽位未收到消耗确认，将退避后重查；连续 3 次未确认才在本轮跳过。');
    g_corrosionRoundFailed = !response.success;
    if (!response.success) g_corrosionNextCheckAt = Date.now() + g_corrosionMinimumIntervalMs;
    if (!response.success) g_corrosionBatchActive = false;
    if (response.success) g_corrosionCount++;
    if (response.success && response.consumedCount > 0) g_lastCorrosionAt = Date.now();
    g_corrosionLastResult = response.success ? '腐蚀成功；污染值 ' + response.pollutionAfter :
        '腐蚀失败：' + response.error;
    g_corrosionPending = null;
    emit('auto_corrosion_result', response);
    if (g_running) scheduleNext(200);
}

function maintainCorrosionPending() {
    queueCorrosionFinish();
    if (g_corrosionPending && !g_corrosionPending.response &&
            Date.now() - g_corrosionPending.at > 60000 && !g_corrosionPending.timeoutReported) {
        g_corrosionPending.timeoutReported = true;
        g_corrosionLastResult = '腐蚀结算等待超过 60 秒，保留请求，不重复消耗';
        corrosionLog(g_corrosionLastResult + '。');
        emit('auto_corrosion_waiting', {eventId:g_corrosionPending.eventId, reason:g_corrosionLastResult});
    }
}

function runAutoCorrosionPass(rows) {
    maintainCorrosionPending();
    if (g_corrosionPending || g_corrosionQueued) return false;
    if (!g_autoCorrosionEnabled) {
        g_corrosionBatchActive = false;
        return true;
    }
    if (g_corrosionRoundFailed) {
        if (Date.now() < g_corrosionNextCheckAt) return true;
        g_corrosionRoundFailed = false;
        g_corrosionRejectedUids = {};
        g_corrosionLastResult = '';
    }
    if ((g_boxCapacityBlocked ? boxSpaceActionActive() : automationCycleBusy()) || sharedGameActionWaiting()) return false;
    rows = g_lastPlacedRows && g_lastPlacedRows.length ? g_lastPlacedRows : (rows || []);
    if (!g_corrosionBatchActive && !corrosionThresholdAllows(rows || [])) return true;
    var candidates = (rows || []).filter(function (row) { return corrosionCandidate(row); }).sort(function (a,b) {
        return a.gradeValue - b.gradeValue || String(a.uid).localeCompare(String(b.uid));
    });
    if (!candidates.length) {
        var waitingForRetry = (rows || []).some(function (row) {
            var state = g_corrosionRejectedUids[String(row && row.uid)];
            return !!(state && typeof state === 'object' && !state.permanent &&
                corrosionCandidate(row, true));
        });
        if (!waitingForRetry) {
            g_corrosionBatchActive = false;
            g_corrosionLastResult = '没有符合仓库负载阈值、保护规则与品级上限的腐蚀物品';
        }
        return !waitingForRetry;
    }
    if (!ensureUpdateHook()) throw new Error('无法挂载游戏主线程腐蚀队列');
    g_corrosionQueued = true;
    g_queue.push({action:'corrosionBatch', items:candidates.slice(0,9),
        backpackSpaceRecovery:g_boxCapacityBlocked === true, at:Date.now()});
    return false;
}

function corrosionThresholdAllows(rows) {
    var now = Date.now();
    if (g_corrosionBatchActive) return true;
    if (now < g_corrosionNextCheckAt) return false;
    g_corrosionNextCheckAt = now + g_corrosionMinimumIntervalMs;
    var counts = g_lastSourceCounts || {};
    var warehouseUsed = Math.max(0, Number(counts.stash) || 0);
    var warehousePercent = warehouseUsed * 100 / STASH_SLOT_COUNT;
    var warehouseNeedsCorrosion = warehousePercent >= g_corrosionWarehouseThresholdPercent;
    var pollution = -1;
    var pollutionError = '';
    try { pollution = readCorrosionPollution(resolveCorrosionBridge()); }
    catch (e) { pollutionError = chineseError(e); }
    g_corrosionThresholdState = corrosionThresholdStateFor(pollution, counts, now);
    if (pollutionError && now - g_corrosionLastPollErrorLogAt > 60000) {
        g_corrosionLastPollErrorLogAt = now;
        corrosionLog('污染度读取诊断：' + pollutionError + '；仓库占用 ' +
            warehousePercent.toFixed(1) + '%。');
    }
    if (!(pollution >= 0) && !warehouseNeedsCorrosion) {
        g_corrosionLastResult = '已连接，等待污染度数据' +
            (pollutionError ? '：' + pollutionError : '') + '；仓库占用 ' +
            warehousePercent.toFixed(1) + '% / 触发线 ' + g_corrosionWarehouseThresholdPercent + '%';
        return false;
    }
    var pollutionNeedsCorrosion = g_corrosionThresholdState.pollutionTriggered;
    if (!pollutionNeedsCorrosion && !warehouseNeedsCorrosion) {
        g_corrosionLastResult = 'PID ' + Process.id + ' 未达到腐蚀条件：污染度 ' +
            (pollution >= 0 ? pollution : '未知') + ' / ' + g_corrosionPollutionThreshold +
            '；本账号仓库 ' + warehouseUsed + '/' + STASH_SLOT_COUNT + ' 格（' +
            warehousePercent.toFixed(1) + '% / ' + g_corrosionWarehouseThresholdPercent + '%）';
        return false;
    }
    g_corrosionLastResult = 'PID ' + Process.id + ' 达到腐蚀条件：' +
        g_corrosionThresholdState.reason + '；污染度 ' + (pollution >= 0 ? pollution : '未知') +
        '，本账号仓库 ' + warehouseUsed + '/' + STASH_SLOT_COUNT + ' 格';
    g_corrosionBatchActive = true;
    return true;
}


rpc.exports = {
    checkmainthread: function () {
        requireCurrentGameBuild();
        if (!ensureUpdateHook()) return JSON.stringify({status:'FAILED',error:'游戏主线程入口不可用'});
        return new Promise(function (resolve) {
            var settled = false;
            var item = {action:'compatibilityRead',at:Date.now(),resolve:function(value){
                if (settled) return;
                settled = true;
                if (item.timeout) clearTimeout(item.timeout);
                resolve(value);
            }};
            item.timeout = setTimeout(function(){
                var index = g_queue.indexOf(item);
                if (index >= 0) g_queue.splice(index,1);
                item.resolve(JSON.stringify({status:'FAILED',error:'游戏主线程检查超时'}));
            },8000);
            g_queue.unshift(item);
        });
    },
    // Read on preview open, chest spawn and stage changes. Idle frames do not
    // rescan rewards; the controller coalesces closely spaced spawn events.
    getdropqueuesnapshot: function (skipSourceClassification) {
        requireCurrentGameBuild();
        var startedAt = Date.now();
        g_gameDropPreviewEnabled = true;
        installGameDropPreviewSpawnHooks();
        var snapshot = readGameDropPreviewSnapshot(skipSourceClassification === true);
        snapshot.spawnHookReady = g_gameDropPreviewSpawnHooks.length > 0;
        snapshot.scanDurationMs = Math.max(0, Date.now() - startedAt);
        try { snapshot.stageKey = currentAutoBossStage().stageKey; } catch (e) {}
        return JSON.stringify(snapshot);
    },
    setdroppreviewenabled: function (enabled) {
        requireCurrentGameBuild();
        g_gameDropPreviewEnabled = !!enabled;
        return g_gameDropPreviewEnabled ? installGameDropPreviewSpawnHooks() : true;
    },
    getcurrentstage: function () {
        return JSON.stringify(currentAutoBossStage());
    },
    getplaguestagecatalog: function () {
        requireCurrentGameBuild();
        var owner = findClassByEnumeratedName('', 'xi');
        if (isBadPtr(owner)) throw new Error('关卡缓存列表所属类型未找到');
        var fields = runtimeClassFields(owner).fields;
        if (fields.bizd !== 0x38) throw new Error('关卡缓存列表字段版本校验失败');
        var staticData = il2cpp.classGetStaticFieldData(owner);
        var list = isBadPtr(staticData) ? ptr(0) : staticData.add(fields.bizd).readPointer();
        var caches = isBadPtr(list) ? [] : readListObjects(list, 20000);
        var stages = [];
        caches.forEach(function (cache) {
            var stage = readAutoBossStageInfo(cache);
            if (stage && stage.stageType === 2 && stage.act === 23 &&
                    stage.stageNo >= 1 && stage.stageNo <= 20) stages.push(stage);
        });
        stages.sort(function (a, b) {
            return a.difficulty - b.difficulty || a.stageNo - b.stageNo || a.stageKey - b.stageKey;
        });
        return JSON.stringify({status:'SUCCESS', stages:stages, count:stages.length});
    },
    getgamecontext: function () {
        requireCurrentGameBuild();
        try {
            var stage = currentAutoBossStage();
            return JSON.stringify({stage:stage, stageName:fridaStageName(stage), inCombat:fridaCurrentCombatState()});
        } catch (e) {
            return JSON.stringify({stage:null, stageName:'等待进入关卡', inCombat:false,
                stageError:chineseError(e)});
        }
    },
    getaccountdashboard: function () {
        var result = {
            status: 'SUCCESS',
            pid: Process.id,
            observedAt: Date.now(),
            mapName: '地图信息暂不可用',
            stage: null,
            tradeShip: null
        };
        try {
            var stage = currentAutoBossStage();
            if (stage) {
                result.mapName = fridaStageName(stage) || '地图信息暂不可用';
                result.stage = {
                    stageType: Number(stage.stageType) || 0,
                    act: Number(stage.act) || 0,
                    stageNo: Number(stage.stageNo) || 0,
                    difficulty: Number(stage.difficulty) || 0,
                    stageKey: Number(stage.stageKey) || 0
                };
            }
        } catch (mapError) {
            result.mapError = chineseError(mapError);
        }
        try {
            var diagnostics = tradeShipReadOnlyDiagnostics();
            var sourceSlots = diagnostics.validSlots || diagnostics.slots || [];
            var serverTime = diagnostics.serverTime || {};
            var serverTicks = serverTime.known === true
                ? currentTradeCooldownTicks(serverTime.raw) : 0;
            result.tradeShip = {
                slotCount: Number(diagnostics.validSlotCount) || sourceSlots.length || 0,
                rawListCount: Number(diagnostics.rawListCount) || sourceSlots.length || 0,
                slots: sourceSlots.map(function (slot, position) {
                    var waitingUid = String(slot.waitingUid || '0');
                    var cooldownKnown = slot.cooldownKnown === true ||
                        (slot.cooldownKnown == null &&
                            (slot.cooldownEndAtMs != null || slot.cooldownEndData != null));
                    var cooldownEndAtMs = Number(slot.cooldownEndAtMs) || 0;
                    if (!cooldownEndAtMs && slot.cooldownEndData) {
                        cooldownEndAtMs = tradeShipDateTimeUnixMs(slot.cooldownEndData);
                    }
                    var endTicks = currentTradeCooldownTicks(slot.cooldownEndData ||
                        slot.slotCooldownEndData || 0);
                    var remainingMs = cooldownKnown && endTicks > 0
                        ? (serverTicks > 0 ? Math.max(0, (endTicks - serverTicks) / 10000)
                            : Math.max(0, cooldownEndAtMs - Date.now()))
                        : null;
                    var cooldownActive = slot.cooldownActive != null
                        ? slot.cooldownActive === true
                        : cooldownKnown && cooldownEndAtMs > Date.now();
                    return {
                        index: Number(slot.index != null ? slot.index :
                            (slot.listIndex != null ? slot.listIndex : position)),
                        occupied: slot.occupied === true || slot.cacheOccupied === true ||
                            waitingUid !== '0',
                        waiting: waitingUid !== '0',
                        cooldownKnown: cooldownKnown,
                        cooldownActive: cooldownKnown && cooldownActive,
                        cooldownEndAtMs: cooldownEndAtMs,
                        cooldownRemainingMs: remainingMs
                    };
                })
            };
        } catch (tradeShipError) {
            result.tradeShip = {slotCount: 0, rawListCount: 0, slots: [], available: false};
            result.tradeShipError = chineseError(tradeShipError);
        }
        return JSON.stringify(result);
    },
    getaccountdashboard: function () {
        var result = {status:'SUCCESS', pid:Process.id, observedAt:Date.now(),
            mapName:'地图信息暂不可用', stage:null, tradeShip:null};
        try {
            var stage = currentAutoBossStage();
            if (stage) {
                result.stage = {
                    stageType:Number(stage.stageType)||0, act:Number(stage.act)||0,
                    stageNo:Number(stage.stageNo)||0, difficulty:Number(stage.difficulty)||0,
                    stageKey:Number(stage.stageKey)||0
                };
                result.mapName = fridaStageName(stage) || '地图信息暂不可用';
            }
        } catch (mapError) {
            result.mapError = chineseError(mapError);
        }
        try {
            var diagnostics = tradeShipReadOnlyDiagnostics();
            var sourceSlots = diagnostics.validSlots || diagnostics.slots || [];
            result.tradeShip = {
                slotCount:Number(diagnostics.validSlotCount)||sourceSlots.length||0,
                rawListCount:Number(diagnostics.rawListCount)||sourceSlots.length||0,
                slots:sourceSlots.map(function (slot, position) {
                    var waitingUid=String(slot.waitingUid||'0');
                    var cooldownKnown=slot.cooldownKnown===true ||
                        slot.cooldownEndAtMs!=null || slot.cooldownEndData!=null;
                    var cooldownEndAtMs=Number(slot.cooldownEndAtMs)||0;
                    if (!cooldownEndAtMs && slot.cooldownEndData) {
                        cooldownEndAtMs=tradeShipDateTimeUnixMs(slot.cooldownEndData);
                    }
                    var cooldownActive=slot.cooldownActive===true ||
                        (!cooldownKnown && cooldownEndAtMs>Date.now());
                    var occupied=slot.occupied===true || slot.cacheOccupied===true ||
                        waitingUid!=='0';
                    return {
                        index:Number(slot.index!=null?slot.index:
                            (slot.listIndex!=null?slot.listIndex:position)),
                        occupied:occupied, waiting:waitingUid!=='0',
                        cooldownKnown:cooldownKnown, cooldownActive:cooldownActive,
                        cooldownEndAtMs:cooldownEndAtMs
                    };
                })
            };
        } catch (tradeShipError) {
            result.tradeShip={slotCount:0,rawListCount:0,slots:[],available:false};
            result.tradeShipError=chineseError(tradeShipError);
        }
        return JSON.stringify(result);
    },
    autoplagueonce: function () {
        return requestManualAutoPlagueSwitch();
    },
    getinventoryrows: function () {
        requireCurrentGameBuild();
        return fridaInventoryRowsSnapshot();
    },
    getticketinventory: function () {
        requireCurrentGameBuild();
        return fridaTicketInventorySnapshot();
    },
    getcorrosionpollution: function () {
        requireCurrentGameBuild();
        try {
            var bridge = resolveCorrosionBridge();
            var observedAt = Date.now();
            var pollution = readCorrosionPollution(bridge);
            if (!g_lastSourceCounts.observedAt || observedAt - g_lastSourceCounts.observedAt >= 15000) {
                var player = findPlayerSaveData();
                if (!isBadPtr(player)) readPlacedUidsBackpackStash(player,
                    classInfo('TaskbarHero', 'PlayerSaveData').fields);
            }
            var thresholdState = corrosionThresholdStateFor(
                pollution, g_lastSourceCounts || {}, observedAt);
            return JSON.stringify({status:'SUCCESS', pid:Process.id, pollution:pollution,
                warehouseUsed:thresholdState.warehouseUsed,
                warehouseCapacity:thresholdState.warehouseCapacity,
                warehousePercent:thresholdState.warehousePercent,
                pollutionThreshold:thresholdState.pollutionThreshold,
                warehouseThresholdPercent:thresholdState.warehouseThresholdPercent,
                pollutionTriggered:thresholdState.pollutionTriggered,
                warehouseTriggered:thresholdState.warehouseTriggered,
                triggered:thresholdState.triggered, triggerReason:thresholdState.reason,
                inventoryObservedAt:thresholdState.inventoryObservedAt,
                autoCorrosion:g_autoCorrosionEnabled, observedAt:observedAt});
        } catch (error) {
            var diagnostics = null;
            try { diagnostics = JSON.parse(corrosionPollutionDiagnostics()); } catch (diagnosticError) {}
            return JSON.stringify({status:'FAILED', error:chineseError(error), diagnostics:diagnostics,
                observedAt:Date.now()});
        }
    },
    getcorrosiondiagnostics: function () {
        requireCurrentGameBuild();
        return corrosionPollutionDiagnostics();
    },
    routeplaguestage: function (stageNo, expectedStageKey) {
        requireCurrentGameBuild();
        return routeFridaToPlague(stageNo, expectedStageKey);
    },
    setframelimit: function (fps) {
        requireCurrentGameBuild();
        return setFridaFrameLimit(fps);
    },
    getframelimit: function () {
        requireCurrentGameBuild();
        return JSON.stringify(readFridaFrameLimit(resolveFridaFrameLimitBridge()));
    },
    setbackgroundmode: function (enabled) { return setFridaBackgroundMode(enabled); },
    getbackgroundmode: function () {
        requireCurrentGameBuild();
        var bridge = resolveFridaBackgroundModeBridge();
        return JSON.stringify({status:'SUCCESS', enabled:!!bridge.getter(bridge.getterMi),
            requested:g_backgroundModeValue, icall:bridge.icall === true});
    },
    diagnoseframelimit: function () { return diagnoseFridaFrameLimit(); },
    switchplaguepricedropstage: function (stageNo, expectedStageKey, thresholdCny, priceRowsJson, initializeScan, targetItemIds) {
        return enqueuePlaguePriceStageSwitch(stageNo, expectedStageKey, thresholdCny, priceRowsJson, initializeScan, targetItemIds);
    },
    cancelplaguepriceswitch: function () {
        return cancelPlaguePriceStageSwitch();
    },
    addplaguemanualwaitbox: function (boxKey, expectedStageKey, itemId) {
        return addPlagueManualWaitBox(boxKey, expectedStageKey, itemId);
    },
    switchplaguedropstage: function (stageNo, expectedStageKey, targetItemIds, scanLimits) {
        return enqueuePlagueDropStageSwitch(stageNo, expectedStageKey, targetItemIds, scanLimits);
    },
    // A drop-log reconciliation needs only the stable BoxData keys and current
    // pending IDs. Skip the EContentType bridge to keep this frequent read light.
    getdropqueuekeysnapshot: function () {
        var startedAt = Date.now();
        var snapshot = readGameDropPreviewPendingKeysSnapshot();
        snapshot.scanDurationMs = Math.max(0, Date.now() - startedAt);
        return JSON.stringify(snapshot);
    },
    sandboxinfo: function () {
        return sandboxInfoJson();
    },
    verifysynthesis: function () {
        var bridge = resolveSynthesisBridge();
        var slotState = synthesisSlotState(bridge);
        return JSON.stringify({
            gameAssembly: { path: GA.path, size: GA.size, base: String(B) },
            synthesis: {
                slotCountRva: methodRvaText(bridge.slotCount),
                selectRecipeRva: '0x' + bridge.selectRecipe.ptr.sub(B).toString(16),
                selectSynthesisTypeRva: '0x' + bridge.selectSynthesisType.ptr.sub(B).toString(16),
                resetRva: '0x' + bridge.reset.ptr.sub(B).toString(16),
                addSlotRva: '0x' + bridge.addSlot.ptr.sub(B).toString(16),
                executeBackendRva: '0x' + bridge.executeBackend.ptr.sub(B).toString(16),
                getSlotItemRva: '0x' + bridge.getSlotItem.ptr.sub(B).toString(16),
                getItemUidRva: '0x' + bridge.getItemUid.ptr.sub(B).toString(16),
                getItemTierRva: '0x' + bridge.getItemTier.ptr.sub(B).toString(16),
                slotBackingCount: slotState.backingCount,
                activeSlotCount: slotState.activeCount,
                slotBusy: slotState.busy,
                abi: bridge.current ?
                    'ixs(MethodInfo); iyu(ERecipeType,MethodInfo); iyj(EItemSynthesisType,MethodInfo); jcx(MethodInfo); ' +
                    'jaw(ESlotType,index,MethodInfo); jjm(item,MethodInfo); jjx(item,MethodInfo); ' +
                    'jav(ESlotType,index,MethodInfo); jbh(sret,MethodInfo)' :
                    'ilp(MethodInfo); imq(ERecipeType,MethodInfo); imf(EItemSynthesisType,MethodInfo); ipv(MethodInfo); ' +
                    'ios(ESlotType,index,MethodInfo); iwx(item,MethodInfo); ixj(item,MethodInfo); ' +
                    'ior(ESlotType,index,MethodInfo); ipe(sret,MethodInfo)'
            },
            executed: false
        });
    },
    verifyallreadonly: function () {
        if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) return verifyCurrentReadOnly();
        var synthesis = resolveSynthesisBridge();
        var synthesisSlots = synthesisSlotState(synthesis);
        var deposit = resolveAutoDepositBridge();
        var fullDeposit = resolveFullBackpackDepositBridge();
        var stageBox = resolveStageBoxRightClickHandler();
        return JSON.stringify({
            executed: false,
            gameAssembly: { path: GA.path, size: GA.size, base: String(B) },
            synthesis: {
                slotBackingCount: synthesisSlots.backingCount,
                activeSlotCount: synthesisSlots.activeCount,
                slotBusy: synthesisSlots.busy,
                slotCountRva: methodRvaText(synthesis.slotCount),
                executeBackendRva: '0x' + synthesis.executeBackend.ptr.sub(B).toString(16),
                resetRva: '0x' + synthesis.reset.ptr.sub(B).toString(16)
            },
            box: {
                rightClickRva: '0x' + stageBox.ptr.sub(B).toString(16),
                rightClickMethod: stageBox.methodName,
                snapshot: scanBoxSnapshot()
            },
            deposit: {
                firstEmptyIndexRva: '0x' + deposit.firstEmptyIndex.ptr.sub(B).toString(16),
                addToPageRva: '0x' + deposit.addToPage.ptr.sub(B).toString(16),
                removeFromInventoryRva: '0x' + deposit.removeFromInventory.ptr.sub(B).toString(16),
                depositAllRva: '0x' + fullDeposit.depositAll.ptr.sub(B).toString(16),
                switchPageRva: '0x' + fullDeposit.switchPage.ptr.sub(B).toString(16)
            },
            tradeShip: tradeShipReadOnlyDiagnostics(),
            boss: autoBossReadOnlyDiagnostics(),
            gameplay: gameplayReadOnlyDiagnostics()
        });
    },
    verify: function () {
        if (synthesisBridgeProfile() === SYNTHESIS_BRIDGE_CURRENT) return verifyCurrentReadOnly();
        var bridge = resolveSynthesisBridge();
        var slotState = synthesisSlotState(bridge);
        var depositBridge = resolveAutoDepositBridge();
        var tradeShipBridge = resolveAutoTradeShipBridge();
        var fullDepositBridge = resolveFullBackpackDepositBridge();
        var stageBox = resolveStageBoxRightClickHandler();
        var runtimeItems = getLocalItemInfoCache();
        var tradeShipStates = listAuthoritativeTradeShipSlots(tradeShipBridge);
        var firstEmptyStashIndex = depositBridge.firstEmptyIndex.fn(depositBridge.firstEmptyIndex.mi);
        var firstEmptyStashPage = firstEmptyStashIndex >= 0 && firstEmptyStashIndex < STASH_SLOT_COUNT
            ? depositBridge.pageFromIndex.fn(firstEmptyStashIndex, depositBridge.pageFromIndex.mi)
            : -1;
        return JSON.stringify({
            gameAssembly: { path: GA.path, size: GA.size, base: String(B) },
            synthesis: {
                slotCountRva: methodRvaText(bridge.slotCount),
                selectRecipeRva: '0x' + bridge.selectRecipe.ptr.sub(B).toString(16),
                selectSynthesisTypeRva: '0x' + bridge.selectSynthesisType.ptr.sub(B).toString(16),
                resetRva: '0x' + bridge.reset.ptr.sub(B).toString(16),
                addSlotRva: '0x' + bridge.addSlot.ptr.sub(B).toString(16),
                executeBackendRva: '0x' + bridge.executeBackend.ptr.sub(B).toString(16),
                getSlotItemRva: '0x' + bridge.getSlotItem.ptr.sub(B).toString(16),
                getItemUidRva: '0x' + bridge.getItemUid.ptr.sub(B).toString(16),
                getItemTierRva: '0x' + bridge.getItemTier.ptr.sub(B).toString(16),
                slotBackingCount: slotState.backingCount,
                activeSlotCount: slotState.activeCount,
                slotBusy: slotState.busy,
                abi: 'ilp(MethodInfo); imq(ERecipeType,MethodInfo); imf(EItemSynthesisType,MethodInfo); ipv(MethodInfo); ' +
                    'ios(ESlotType,index,MethodInfo); iwx(item,MethodInfo); ixj(item,MethodInfo); ' +
                    'ior(ESlotType,index,MethodInfo); ipe(sret,MethodInfo)'
            },
            stageBox: {
                rightClickRva: '0x' + stageBox.ptr.sub(B).toString(16),
                method: 'StageBox.' + stageBox.methodName + '(InputButton.Right=1)',
                instances: stageBoxInstanceSnapshot()
            },
            autoDeposit: {
                firstEmptyIndexRva: '0x' + depositBridge.firstEmptyIndex.ptr.sub(B).toString(16),
                pageFromIndexRva: '0x' + depositBridge.pageFromIndex.ptr.sub(B).toString(16),
                addToPageRva: '0x' + depositBridge.addToPage.ptr.sub(B).toString(16),
                removeFromInventoryRva: '0x' + depositBridge.removeFromInventory.ptr.sub(B).toString(16),
                fullBackpackDepositRva: '0x' + fullDepositBridge.depositAll.ptr.sub(B).toString(16),
                switchStashPageRva: '0x' + fullDepositBridge.switchPage.ptr.sub(B).toString(16),
                fullBackpackAbi: 'hyn(物品移动管理器, 背包, 仓库, 方法信息); lpf(仓库界面, 页码, 方法信息)',
                pageSize: STASH_PAGE_SIZE,
                pageCount: STASH_PAGE_COUNT,
                firstEmptyIndex: firstEmptyStashIndex,
                firstEmptyPage: firstEmptyStashPage < 0 ? 0 : firstEmptyStashPage + 1,
                executed: false
            },
            autoTradeShip: {
                moveDirectRva: '0x' + tradeShipBridge.moveDirect.ptr.sub(B).toString(16),
                firstAvailableSlotRva: '0x' + tradeShipBridge.firstAvailableSlot.ptr.sub(B).toString(16),
                validSlotCountRva: '0x' + tradeShipBridge.validSlotCount.ptr.sub(B).toString(16),
                cacheForSlotRva: '0x' + tradeShipBridge.cacheForSlot.ptr.sub(B).toString(16),
                cacheOccupiedRva: '0x' + tradeShipBridge.cacheOccupied.ptr.sub(B).toString(16),
                waitingContainsRva: '0x' + tradeShipBridge.waitingContains.ptr.sub(B).toString(16),
                downloadBlockedRva: '0x' + tradeShipBridge.downloadBlocked.ptr.sub(B).toString(16),
                uploadButtonRva: '0x' + tradeShipBridge.uploadButton.ptr.sub(B).toString(16),
                confirmButtonRva: '0x' + tradeShipBridge.confirmButton.ptr.sub(B).toString(16),
                getSlotRva: '0x' + tradeShipBridge.getSlot.ptr.sub(B).toString(16),
                cooldownActiveRva: '0x' + tradeShipBridge.cooldownActive.ptr.sub(B).toString(16),
                cooldownEndForSlotRva: '0x' + tradeShipBridge.cooldownEndForSlot.ptr.sub(B).toString(16),
                cooldownSyncRequestRva: '0x' + tradeShipBridge.cooldownSyncRequest.ptr.sub(B).toString(16),
                cooldownSyncCallbackRva: '0x' + tradeShipBridge.cooldownSyncCallback.ptr.sub(B).toString(16),
                applyCooldownRva: '0x' + tradeShipBridge.applyCooldown.ptr.sub(B).toString(16),
                pointerEnterRva: '0x' + tradeShipBridge.pointerEnter.ptr.sub(B).toString(16),
                downloadListenerRva: '0x' + tradeShipBridge.downloadListener.ptr.sub(B).toString(16),
                abi: 'ra.hyf(管理器, 来源类型, 来源索引, 回调, 交易船, 方法信息); ' +
                    'TradingStashSlot.llr(槽位, 方法信息); UI_TradingStash.lzq(界面, 方法信息); ' +
                    'TradingStashSlot.OnPointerEnter(槽位, 指针事件, 方法信息); Button.Press(按钮, 方法信息)',
                marketPriceItemCount: g_marketPriceItemCount,
                minPriceCny: g_tradeShipMinPriceCny,
                cnyPerUsd: g_marketPriceCnyPerUsd,
                priceFilteredCount: g_lastTradeShipPriceFilteredCount,
                validSlotCount: tradeShipStates.validSlotCount | 0,
                firstAvailableSlot: firstAvailableTradeShipSlot(tradeShipBridge),
                backgroundOnly: true,
                xExecutionEnabled: TRADE_SHIP_X_EXECUTION_ENABLED === true,
                executed: false
            },
            boxes: scanBoxSnapshot(),
            runtimeItemCount: Object.keys(runtimeItems).length,
            runtimeItemCache: g_lastRuntimeItemCache,
            executed: false
        });
    },
    start: function (configJson) {
        return startLoop(configJson || '{}');
    },
    setmarketprices: function (payloadJson) {
        return setMarketPrices(payloadJson || '{}');
    },
    stop: function () {
        var result=stopLoop();
        if(!g_autoPlagueUiRoute) return result;
        return new Promise(function(resolve){var deadline=Date.now()+4000;
            function check(){if(!g_autoPlagueUiRoute||Date.now()>=deadline){resolve(result);return;}
                setTimeout(check,50);}check();});
    },
    once: function (kind) {
        if (DIRECT[kind]) return enqueue(kind, g_lastBatch);
        return runAutoPass('手动单次扫描');
    },
    scan: function () {
        return scanSummaryJson();
    },
    diagnose: function () {
        return diagnoseInventoryJson();
    },
    scanboxes: function () {
        return JSON.stringify(scanBoxSnapshot());
    },
    openboxes: function () {
        return runAutoBoxOpen('manual');
    },
    tradeshippricecandidates: function () {
        requireCurrentGameBuild();
        if (isBadPtr(findPlayerSaveData())) throw new Error('角色数据尚未加载');
        var rows = scanInventory();
        var seen = {};
        (g_lastPlacedRows || rows || []).forEach(function (row) {
            if (!autoTradeShipBaseEligible(row, false)) return;
            seen[String(row.itemKey)] = true;
        });
        return JSON.stringify(Object.keys(seen));
    },
    autotradeshiponce: function () {
        requireCurrentGameBuild();
        if (isBadPtr(findPlayerSaveData())) throw new Error('角色数据尚未加载');
        if (g_tradeShipManualRunActive)
            return JSON.stringify({status:'RUNNING', message:'手动转入轮次正在执行'});
        if (!g_running) preflightAutomationBridges({autoTradeShip:true});
        resolveCurrentTradeBridge();
        g_tradeShipManualOnly = !g_running;
        g_tradeShipManualRunActive = true;
        g_lastTradeShipResult = '正在扫描可交易物品与可用槽位';
        if (!g_running) {
            g_running = true;
            g_cyclePhase = 'active';
            g_cycleBoxStage = 'scheduled';
            g_cycleSleepUntil = 0;
        }
        scheduleNext(200);
        return JSON.stringify({status:'STARTED', manualOnly:g_tradeShipManualOnly});
    },
    repairboxpump: function () {
        return repairBoxPump();
    },
    repairautomation: function () {
        return JSON.stringify(repairAutomationProgress());
    },
    groups: function () {
        return scanSummaryJson();
    },
    inventoryfingerprint: function () {
        return inventoryFingerprintJson();
    },
    modes: function () {
        return JSON.stringify(DIRECT);
    },
    tradeshipdiagnostics: function () {
        return JSON.stringify(tradeShipReadOnlyDiagnostics());
    },
    status: function () {
        return JSON.stringify({
            scriptBuild: SCRIPT_BUILD_TAG,
            accountIdentity: readAccountIdentity(),
            dropPreviewStageKey: g_gameDropPreviewEnabled ? (function () {
                try { return currentAutoBossStage().stageKey; } catch (e) { return 0; }
            })() : 0,
            running: g_running,
            automationFeatureErrors: g_automationFeatureErrors,
            cyclePhase: g_cyclePhase,
            cycleBoxStage: g_cycleBoxStage,
            cycleRound: g_cycleRound,
            cycleSleepUntil: g_cycleSleepUntil,
            backgroundTaskPauseMs: g_backgroundTaskPauseMs,
            cycleLastPassAt: g_cycleLastPassAt,
            cycleNextDueAt: g_cycleNextDueAt,
            cycleTimerActive: !!g_timer,
            cyclePassActive: g_cyclePassActive,
            activeAutomationAction: g_activeAutomationAction,
            queueLastProcessedAt: g_queueLastProcessedAt,
            queueHeadAction: g_queue[0] && g_queue[0].action || '',
            queueHeadAt: g_queue[0] && g_queue[0].at || 0,
            queueHeadReadyAt: g_queue[0] ? Math.max(Number(g_queue[0].deferUntil || 0), Number(g_queue[0].retryAt || 0)) : 0,
            automationRecoveryCount: g_automationRecoveryCount,
            cycleSleepRemainingMs: 0,
            mode: g_mode,
            executeMode: g_executeMode,
            legacyDirectAllowed: g_legacyDirectAllowed,
            passiveTraceInstalled: g_passiveTraceInstalled,
            passiveTraceHookCount: g_passiveTraceListeners.length,
            autoCorrosion: g_autoCorrosionEnabled,
            corrosionMaxGrade: g_corrosionMaxGrade,
            corrosionCategoryRules: g_corrosionCategoryRules,
            corrosionProtectPriceCny: g_corrosionProtectPriceCny,
            corrosionIncludeStash: g_corrosionIncludeStash,
            corrosionPollutionThreshold: g_corrosionPollutionThreshold,
            corrosionWarehouseThresholdPercent: g_corrosionWarehouseThresholdPercent,
            corrosionMinimumIntervalMs: g_corrosionMinimumIntervalMs,
            corrosionNextCheckAt: g_corrosionNextCheckAt,
            corrosionAccountPid: Process.id,
            corrosionThresholdState: g_corrosionThresholdState,
            corrosionPending: g_corrosionPending ? {eventId:g_corrosionPending.eventId, at:g_corrosionPending.at, confirmed:!!g_corrosionPending.response} : null,
            corrosionCount: g_corrosionCount,
            corrosionLastResult: g_corrosionLastResult,
            synthesisEnabled: g_synthesisEnabled,
            synthesisPauseReason: g_synthesisPauseReason,
            synthesisLastResult: g_lastResult,
            synthesisExecuteMode: g_executeMode,
            autoDepositUnsynthable: g_autoDepositUnsynthable,
            autoTradeShip: g_autoTradeShipEnabled,
            tradeShipManualRunActive: g_tradeShipManualRunActive,
            tradeShipIntervalMs: g_autoTradeShipIntervalMs,
            tradeShipNextCheckAt: g_autoTradeShipNextCheckAt,
            tradeShipPriceMode: g_autoTradeShipPriceMode,
            tradeShipMinPriceCny: g_tradeShipMinPriceCny,
            tradeShipMaxPriceCny: g_tradeShipMaxPriceCny,
            marketPriceItemCount: g_marketPriceItemCount,
            marketPriceUpdatedAt: g_marketPriceUpdatedAt,
            tradeShipPriceCandidateItemIds: g_autoTradeShipEnabled ? (function () {
                var ids = {};
                (g_lastPlacedRows || []).forEach(function (row) {
                    if (!autoTradeShipBaseEligible(row, false) ||
                            g_tradeShipQueuedUids[String(row.uid)] ||
                            g_tradeShipRejectedUids[String(row.uid)]) return;
                    ids[String(row.itemKey)] = true;
                });
                return Object.keys(ids).slice(0, 100);
            })() : [],
            tradeShipMinPriceCny: g_tradeShipMinPriceCny,
            marketPriceCnyPerUsd: g_marketPriceCnyPerUsd,
            tradeShipPriceFilteredCount: g_lastTradeShipPriceFilteredCount,
            tradeShipQueued: g_tradeShipQueued,
            tradeShipMoveResultCallbackReady: !isBadPtr(g_moveResultCallback),
            tradeShipPending: g_tradeShipPending,
            tradeShipWarningDiagnostics: g_tradeShipPending ? currentTradeWarningDiagnostics() : null,
            itemLockMethodDiagnostics: itemLockMethodDiagnostics(),
            tradeShipReleasePending: g_tradeShipReleasePending,
            tradeShipReleaseCount: g_tradeShipReleaseCount,
            tradeShipSlotCheckIntervalMs: g_tradeShipSlotCheckIntervalMs,
            tradeShipNextSlotCheckAt: g_tradeShipNextSlotCheckAt,
            tradeShipProbeQueued: g_tradeShipProbeQueued,
            tradeShipSlotProbeFreshUntil: g_tradeShipSlotProbeFreshUntil,
            tradeShipSlotDiagnosticAt: g_tradeShipSlotDiagnosticAt,
            tradeShipSlotLayout: g_tradeShipLastSlotLayout,
            tradeShipSlotDiagnostics: g_tradeShipLastSlotDiagnostics,
            tradeShipCooldownSource: '游戏原生冷却字典',
            tradeShipCooldownSync: tradeShipCooldownSyncSummary(),
            tradeShipXExecutionEnabled: TRADE_SHIP_X_EXECUTION_ENABLED === true,
            tradeShipCount: g_tradeShipCount,
            lastTradeShipAt: g_lastTradeShipAt,
            lastTradeShipResult: g_lastTradeShipResult,
            lastTradeShipCandidateCount: g_lastTradeShipCandidateCount,
            tradeShipRuntimeRejectedCount: Object.keys(g_tradeShipRejectedUids).length,
            tradeShipLockedCount: Object.keys(g_tradeShipLockedUids).length,
            tradeShipDeferredItems: Object.keys(g_tradeShipDeferredItems).map(function (uid) {
                return g_tradeShipDeferredItems[uid];
            }).filter(function (row) {return row.availableAt>Date.now();}),
            tradeShipLockedUids: Object.keys(g_tradeShipLockedUids).slice(0, 500),
            tradeShipWaitingCount: Object.keys(g_tradeShipQueuedUids).length,
            autoBoss: g_autoBossEnabled,
            autoBossMinStones: g_autoBossMinStones,
            ticketCheckIntervalMs: g_ticketCheckIntervalMs,
            mapSwitchMinimumIntervalMs: g_mapSwitchMinimumIntervalMs,
            lastMapSwitchAt: g_lastMapSwitchAt,
            serverRequestSpacingMs: g_serverRequestSpacingMs,
            lastServerRequestAt: g_lastServerRequestAt,
            challengeTargets: g_challengeTargets,
            autoHalloweenEvent: g_autoHalloweenEventEnabled,
            autoPlagueMapEnabled: g_autoPlagueMapEnabled,
            autoPlagueDifficulty: g_autoPlagueDifficulty,
            autoPlagueStageNo: g_autoPlagueStageNo,
            autoPlagueCheckIntervalMs: g_autoPlagueCheckIntervalMs,
            autoPlagueNextCheckAt: g_autoPlagueNextCheckAt,
            autoPlaguePassCount: g_autoPlaguePassCount,
            autoPlagueAwaitingStage: g_autoPlagueAwaitingStage,
            autoPlagueUiRoute: g_autoPlagueUiRoute ? {
                phase:g_autoPlagueUiRoute.phase,startedAt:g_autoPlagueUiRoute.startedAt,
                targetStageKey:g_autoPlagueUiRoute.targetStageKey,
                openedByHelper:g_autoPlagueUiRoute.openedByHelper,
                failureReason:g_autoPlagueUiRoute.failureReason||''} : null,
            lastMapSwitchAt: g_lastMapSwitchAt,
            autoPlagueSwitchQueued: g_autoPlagueSwitchQueued,
            autoPlaguePortalCloseQueued: g_autoPlaguePortalCloseQueued,
            autoPlaguePortalCloseHandledStageKey: g_autoPlaguePortalCloseHandledStageKey,
            autoPlaguePortalCloseAttempts: g_autoPlaguePortalCloseAttempts,
            autoPlagueLastResult: g_autoPlagueLastResult,
            autoPlagueLastPassPhase: g_autoPlagueLastPassPhase,
            autoPlagueCurrentStageReadError: g_autoPlagueCurrentStageReadError,
            autoPlaguePortalUi: g_autoPlagueMapEnabled ? autoPlaguePortalUiDiagnostics() : null,
            autoPlagueCurrentStage: g_autoPlagueMapEnabled ? (function () {
                try {
                    var stage = currentAutoPlagueStage();
                    return stage ? {stageKey:stage.stageKey,stageType:stage.stageType,
                        difficulty:stage.difficulty,act:stage.act,stageNo:stage.stageNo,
                        mapSource:stage.mapSource || 'unknown'} : null;
                } catch (e) { return {error:chineseError(e)}; }
            })() : null,
            plagueDropSwitchPending: g_plagueDropSwitchPending,
            plagueDropSwitchLastResult: g_plagueDropSwitchLastResult,
            eventDungeonPhase: g_eventDungeonContext ? g_eventDungeonContext.phase : 'idle',
            eventDungeonTicket: g_eventDungeonContext && g_eventDungeonContext.ticket || null,
            eventDungeonRounds: g_eventDungeonContext && g_eventDungeonContext.rounds || 0,
            eventDungeonStopAfterRound: !!(g_eventDungeonContext && g_eventDungeonContext.stopAfterRound),
            eventDungeonLastResult: g_eventLastResult,
            bossState: g_bossState,
            bossTarget: g_bossTarget,
            bossStoneCounts: g_bossLastStoneCounts,
            bossCompletedCount: g_bossCompletedCount,
            bossWaitStartedAt: g_bossWaitStartedAt,
            bossWaitTimeoutMs: g_bossWaitTimeoutMs,
            bossBoxDrainStartedAt: g_bossBoxDrainStartedAt,
            bossBoxDrainMaxWaitMs: g_bossBoxDrainMaxWaitMs,
            bossLastResult: g_bossLastResult,
            bossStageQueued: g_bossStageQueued,
            instantKill: g_instantKillEnabled,
            instantKillHitCount: g_currentInstantKillHits,
            godMode: g_godModeEnabled,
            godModeHitCount: g_currentGodModeHits,
            waveLock: g_waveLockEnabled,
            waveTotal: g_waveTotalTarget,
            monstersPerWave: g_monstersPerWaveTarget,
            memoryClean: g_memoryCleanEnabled,
            memoryCleanIntervalMs: g_memoryCleanIntervalMs,
            gameplayPumpIntervalMs: g_gameplayPumpIntervalMs,
            lastMemoryCleanAt: g_gameplayLastMemoryCleanAt,
            synthesisIgnoreItemIds: g_synthesisIgnoreItemIds,
            extraDepositItemIds: g_extraDepositItemIds,
            depositQueued: g_depositQueued,
            depositPending: g_depositPending ? {at:g_depositPending.at,
                itemKey:g_depositPending.row.itemKey,quantity:g_depositPending.source.quantity} : null,
            depositConsecutiveFailures: g_depositConsecutiveFailures,
            depositRetryAt: g_depositRetryAt,
            fullBackpackClearing: g_currentFullBagClearing,
            depositCount: g_depositCount,
            lastDepositAt: g_lastDepositAt,
            lastDepositResult: g_lastDepositResult,
            lastDepositCandidateCount: g_lastDepositCandidateCount,
            fullBackpackDepositActive: g_fullBackpackDepositActive,
            fullBackpackDepositQueued: g_fullBackpackDepositQueued,
            fullBackpackDepositWaiting: g_fullBackpackDepositWaiting,
            fullBackpackDepositPage: g_fullBackpackDepositActive ? g_fullBackpackDepositPage + 1 : 0,
            fullBackpackDepositBeforeCount: g_fullBackpackDepositBeforeCount,
            fullBackpackDepositMovedCount: g_fullBackpackDepositMovedCount,
            fullBackpackDepositRequestedAt: g_fullBackpackDepositRequestedAt,
            fullBackpackDepositRetryAt: g_fullBackpackDepositRetryAt,
            autoOpenBoxes: g_autoOpenBoxes,
            allowUnsafeBoxOpen: g_allowUnsafeBoxOpen,
            lastBoxCount: g_lastBoxCount,
            lastBoxOpenResult: g_lastBoxOpenResult,
            boxAttemptCount: g_boxAttemptCount,
            boxQueueRecoveryCount: g_boxQueueRecoveryCount,
            lastBoxPumpAt: g_lastBoxPumpAt,
            boxSweepActive: g_boxSweepActive,
            boxPumpRestartCount: g_boxPumpRestartCount,
            boxScanIntervalMs: g_boxScanIntervalMs,
            boxOpenDelayMs: g_boxOpenDelayMs,
            sharedActionQuietRemainingMs: Math.max(0, g_sharedActionQuietUntil - Date.now()),
            boxYieldRemainingMs: Math.max(0, g_boxYieldUntil - Date.now()),
            boxOpenInFlight: g_boxOpenInFlight,
            boxScanIntervalMs: g_boxScanIntervalMs,
            boxOpenDispatching: g_boxOpenDispatching,
            boxOpenInFlightType: g_boxOpenInFlightType,
            boxOpenInFlightTypeBefore: g_boxOpenInFlightTypeBefore,
            boxOpenInFlightTypeBeforeUids: g_boxOpenInFlightTypeBeforeUids,
            boxLastRequestedCount: g_boxLastRequestedCount,
            boxLastRequestedType: g_boxLastRequestedType,
            boxLastRequestedAt: g_boxLastRequestedAt,
            stageBoxAutoOpenMethod: stageBoxRightClickMethodName(),
            stageBoxAutoOpenMode: 'StageBox(InputButton.Right=1) bulk/right-click; no OS mouse input',
            intervalMs: g_intervalMs,
            initialDelayMs: g_initialDelayMs,
            instanceOrdinal: g_instanceOrdinal,
            instanceCount: g_instanceCount,
            threshold: g_threshold,
            maxRuns: g_maxRuns,
            runCount: g_runCount,
            failedCount: g_failedCount,
            pending: g_queue.length,
            synthesisBatchQueued: g_synthesisBatchQueued,
            synthesisCleanupQueued: g_synthesisCleanupQueued,
            lastSynthesisCleanupAt: g_lastSynthesisCleanupAt,
            pendingConsumedCount: pendingSynthesisConsumedCount(),
            runtimeRejectedCount: Object.keys(g_runtimeSynthesisRejectedUids).length,
            recentlyConsumedCount: Object.keys(g_recentlyConsumedUids).length,
            pendingSynthesisKey: g_pendingSynthesisKey,
            pendingSynthesisAt: g_pendingSynthesisAt,
            pendingSynthesisObservedError: g_pendingSynthesisObservedError,
            pendingSynthesisWaitMs: g_pendingSynthesisWaitMs,
            updateHooked: g_updateHooked,
            eventSystemUpdate: g_eventSystemUpdatePtr && !g_eventSystemUpdatePtr.isNull() ? '0x' + g_eventSystemUpdatePtr.sub(B).toString(16) : '',
            lastResult: g_lastResult,
            lastBatch: g_lastBatch,
            lastSnapshotCount: g_lastSnapshotCount,
            lastScanDurationMs: g_lastScanDurationMs,
            scanCount: g_scanCount,
            sourceCounts: g_lastSourceCounts,
            runtimeItemCache: g_lastRuntimeItemCache,
            placedDiagnostics: g_lastPlacedDiagnostics,
            itemSaveFields: g_lastItemSaveFields,
            scanErrors: g_lastScanErrors,
            topGroups: compactGroups(g_lastGroups, 10),
            categories: g_categories,
            maxGrades: g_maxGrades,
            sameLevelSynthesis: g_sameLevelSynthesis,
            direct: Object.keys(DIRECT).reduce(function (acc, k) {
                acc[k] = {
                    rva: '0x' + DIRECT[k].rva.toString(16),
                    resolvedRva: g_directPtrs[k] && !g_directPtrs[k].isNull() ? '0x' + g_directPtrs[k].sub(B).toString(16) : '',
                    methodName: DIRECT[k].methodName,
                    resolved: !!(g_directMethods[k] && !g_directMethods[k].isNull())
                };
                return acc;
            }, {})
        });
    }
};

// BEGIN_AGENT_BACKGROUND_LISTENERS
setImmediate(function () {
    try { requireCurrentGameBuild(); installPassiveSynthesisTrace(); }
    catch (error) { emit('game_compatibility_error', {error:chineseError(error)}); log('游戏接口检查失败：' + chineseError(error)); }
});
log('脚本已加载（版本 ' + SCRIPT_BUILD_TAG + '）：运行时扫描背包、7 个物品仓库和材料仓库，排除上锁/已装备/待同步物品。');
setTimeout(function () {
    try {
        var diagnosis = JSON.parse(corrosionPollutionDiagnostics());
        var summary = (diagnosis.classes || []).filter(function (row) {
            return /plaguelands/i.test(String(row.className || ''));
        }).map(function (row) {
            return row.namespace + '.' + row.className + '[' + (row.fields || []).map(function (field) {
                return field.name + ':' + field.type + (field.isStatic ? ':S' : ':I') +
                    (field.staticReferenceType ? ':' + field.staticReferenceType : '') +
                    (field.staticReferenceReady === false ? ':null' : '');
            }).join(',') + ']';
        });
        corrosionLog('污染值控制器字段探测：' + (summary.join('；') || '未找到 Plaguelands 类型'));
    } catch (diagnosticError) {
        corrosionLog('污染值控制器字段探测失败：' + chineseError(diagnosticError));
    }
}, 5000);












































