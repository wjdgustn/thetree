const Piscina = require('piscina');
const { models } = require('mongoose');

const ACL = require('../../class/acl');

const MAXIMUM_TIME = 10000;
const ERROR_HTML = '<h2>문서 렌더링이 실패했습니다.</h2>';
const MAXIMUM_TIME_HTML = '<h2>문서 렌더링이 너무 오래 걸립니다.</h2>';

const worker = new Piscina({
    filename: require.resolve('./toHtmlWorker'),
    workerData: {
        config,
        macroPluginPaths: global.plugins.macros ?? []
    }
});

module.exports = async (...params) => {
    const channel = new MessageChannel();

    const setupOptions = options => {
        for(let [key, value] of Object.entries(options)) {
            if(key === 'req') delete options[key];
            else if(value.toJSON) options[key] = value.toJSON();
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

    console.time('render');
    try {
        return await worker.run(params, {
            signal: AbortSignal.timeout(config.document_maximum_time ?? MAXIMUM_TIME),
            transferList: [channel.port1]
        });
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        if(!isTimeout) console.error(e);
        return {
            html: isTimeout ? MAXIMUM_TIME_HTML : ERROR_HTML,
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
    } finally {
        console.timeEnd('render');
    }
}