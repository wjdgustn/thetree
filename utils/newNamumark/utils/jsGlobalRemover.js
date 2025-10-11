const whitelistedFunctions = {
    Array: [
        'includes'
    ],
    String: [
        'indexOf',
        'lastIndexOf',
        'startsWith',
        'endsWith',
        'substring',
        'trim',
        'substr',
        'toString'
    ]
}
const laterProcess = ['Array'];

let tempProtos = {};
let tempObj = Object;
for(let key of [...Object.getOwnPropertyNames(globalThis).filter(a => !laterProcess.includes(a)), ...laterProcess]) {
    const item = globalThis[key];
    if(typeof item !== 'function' || key === 'log') continue;
    if(['String', 'Array', 'Object'].includes(key)) for(let protoKey of [...tempObj.getOwnPropertyNames(item.prototype)]) {
        // if(['caller', 'callee', 'arguments'].includes(protoKey)) continue;
        if(whitelistedFunctions[key]?.includes(protoKey)) continue;

        const proto = item.prototype[protoKey];
        if(typeof proto !== 'function') continue;
        tempObj.defineProperty(item.prototype, protoKey, {
            value: undefined
        });
    }

    tempProtos[key] = item.prototype;
    item.prototype = undefined;
    globalThis[key] = undefined;
}
tempObj.defineProperty(tempProtos.Array, 'includes', {
    value: undefined
});
tempObj = undefined;
tempProtos = undefined;