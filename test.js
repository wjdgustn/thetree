const { generateSlug } = require('random-word-slugs');
console.log(generateSlug(4, {
    format: 'title'
}).replaceAll(' ', ''));