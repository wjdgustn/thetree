const Piscina = require('piscina');
const { models } = require('mongoose');
const os = require('os');

const ACL = require('../../class/acl');

const MAXIMUM_TIME = 10000;

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
            case 't': {
                return reply(i18next.t(msg.key, {
                    defaultValue: msg.defaultValue,
                    lng: config.lang
                }));
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

        const errorCode = isTimeout ? 'render_timeout' : 'render_failed';
        const errorMsg = i18next.t('namumark.errors.' + errorCode, {
            lng: config.lang || 'ko'
        });
        return {
            html: `<h2>${errorMsg}</h2>`,
            errorMsg,
            errorCode,
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