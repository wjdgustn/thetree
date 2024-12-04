const Document = require('../../../../schemas/document');

module.exports = async params => {
    const namespace = config.namespaces.includes(params) ? params : undefined;
    return Document.countDocuments({
        ...(namespace ? { namespace } : {})
    });
}