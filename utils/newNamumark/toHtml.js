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
    },
    minThreads: 30
});

module.exports = async (...params) => {
    for(let [key, value] of Object.entries(params[1])) {
        if(key === 'req') delete params[1][key];
        else if(value.toJSON) params[1][key] = value.toJSON();
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), config.document_maximum_time ?? MAXIMUM_TIME);

    params[1].config = global.config;

    const channel = new MessageChannel();
    params[1].port = channel.port1;
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
            signal: ac.signal,
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
        clearTimeout(timeout);
    }
}