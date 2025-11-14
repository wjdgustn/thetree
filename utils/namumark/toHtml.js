const Piscina = require('piscina');
const { models } = require('mongoose');
const os = require('os');

const ACL = require('../../class/acl');

const MAXIMUM_TIME = 10000;
const ERROR_HTML = '문서 렌더링이 실패했습니다.';
const MAXIMUM_TIME_HTML = '문서 렌더링이 너무 오래 걸립니다.';

let minThreads = parseInt(process.env.MULTITHREAD_MIN_THREADS);
if(isNaN(minThreads) || minThreads < 1) minThreads = Math.min(4, os.cpus().length);
let maxThreads = parseInt(process.env.MULTITHREAD_MAX_THREADS);
if(isNaN(maxThreads) || maxThreads < 1) maxThreads = Math.max(4, os.cpus().length);

const worker = new Piscina({
    filename: require.resolve('./toHtmlWorker'),
    workerData: {
        config,
        macroPluginPaths: (global.plugins.macro ?? []).map(a => a.path)
    },
    minThreads,
    maxThreads
});

module.exports = async (...params) => {
    const channel = new MessageChannel();

    const setupOptions = options => {
        if(options.req) {
            options.isInternal = options.req.isInternal;
        }

        for(let [key, value] of Object.entries(options)) {
            if(key === 'req') delete options[key];
            else if(value?.toJSON) options[key] = value.toJSON();
        }

        options.config = global.config;
        options.port = channel.port1;
    }

    if(params[0].batch) for(let param of params[0].batch) setupOptions(param[1]);
    else setupOptions(params[1]);

    channel.port2.on('message', async msg => {
        const reply = result => channel.port2.postMessage({ id: msg.id, result });

        switch(msg.type) {
            case 'db': {
                const query = models[msg.model][msg.action](msg.data);
                if(msg.sort) query.sort(msg.sort);
                const result = await query.lean().exec();
                return reply(result);
            }
            case 'aclCheck': {
                const acl = await ACL.get(...msg.getOptions);
                const result = await acl.check(...msg.checkOptions);
                return reply(result);
            }
        }
    });

    try {
        return await worker.run(params, {
            signal: AbortSignal.timeout(config.document_maximum_time ?? MAXIMUM_TIME),
            transferList: [channel.port1]
        });
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        if(!isTimeout) console.error(e);

        const errorMsg = isTimeout ? MAXIMUM_TIME_HTML : ERROR_HTML;
        return {
            html: `<h2>${errorMsg}</h2>`,
            errorMsg,
            errorCode: isTimeout ? 'render_timeout' : 'render_failed',
            links: [],
            files: [],
            categories: [],
            headings: [],
            hasError: true,
            embed: {
                text: null,
                image: null
            }
        }
    }
}