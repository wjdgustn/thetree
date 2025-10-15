module.exports = async (params, { parentAction }) => {
    const namespace = config.namespaces.includes(params) ? params : undefined;
    return await parentAction('db', {
        model: 'Document',
        action: 'countDocuments',
        data: {
            ...(namespace ? { namespace } : {}),
            contentExists: true
        }
    });
}