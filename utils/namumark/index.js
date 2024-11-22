const fs = require('fs');

const priorityMap = [];
const syntaxLoader = (subDir = '') => {
    console.log(__dirname);
    let syntaxFiles = fs.readdirSync(__dirname + subDir + '/syntax');
    if(subDir) {
        if(syntaxFiles.includes('index.js')) syntaxFiles = ['index.js'];
        else syntaxFiles = syntaxFiles.filter(file => file !== 'index.js');
    }

    for(let file of syntaxFiles) {
        if(!subDir && file === 'index.js') continue;

        if(file.endsWith('.js')) {
            const syntax = require(__dirname + '/syntax/' + file);
            const tempClass = new syntax();
            if(!priorityMap[tempClass.priority]) priorityMap[tempClass.priority] = [];
            priorityMap[tempClass.priority].push(syntax);
            console.log(`loaded syntax: ${file}, priority: ${tempClass.priority}`);
        }
        else {
            syntaxLoader(subDir + '/' + file);
        }
    }
}

syntaxLoader();

module.exports = class NamumarkParser {
    constructor(data = {}) {
        if(data.document) this.document = data.document;
        if(data.aclData) this.aclData = data.aclData;

        this.priorityMap = [];
        for(let syntaxes of priorityMap) {
            const newArr = [];
            this.syntaxes.push(newArr);

            if(!syntaxes) continue;

            for(let syntax of syntaxes) {
                newArr.push(new syntax(this));
            }
        }
    }

    openSyntaxes(priority) {
        return this.priorityMap[priority].filter(syntax => syntax._open);
    }

    async parse(text) {
        console.log('parse!');
        console.time();
        for(let priority in this.priorityMap) {
            const syntaxes = this.priorityMap[priority];

            const openSyntaxes = () => this.openSyntaxes(priority);
            for(let i in text) {
                const char = text[i];
                const prevChar = text[i - 1];

                for(let syntax of syntaxes) {
                    if(syntax.feed()) {
                        const openSliced = syntax.openStr.slice(0, -1);
                        if(syntax.openStr === openSliced)
                            syntax._open = false;
                    }
                }
            }
        }

        console.timeEnd();
        return text.replaceAll('\n', '<br>');
    }
}