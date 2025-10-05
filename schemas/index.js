const mongoose = require('mongoose');
const fs = require('fs');

module.exports = () => {
    const connect = async () => {
        try {
            await mongoose.connect(process.env.MONGODB_URL || `mongodb://${process.env.MONGODB_USER}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/admin`, {
                dbName: process.env.MONGODB_DATABASE
            });

            global.scheduleMigration?.();
            console.log('MongoDB connected.');
        } catch(e) {
            console.error(e);
        }
    }
    connect().then();
    mongoose.connection.on('error', e => {
        console.error(e);
    });
    mongoose.connection.on('disconnected', () => {
        console.error('MongoDB disconnected. reconnecting...');
        connect().then();
    });

    console.log('Loading schemas...');
    fs.readdirSync('./schemas').forEach(file => {
        if(file !== 'index.js') {
            require(`./${file}`);
            // console.log(`${file.trim()} schema loaded.`);
        }
    });
    console.log('All schemas loaded.');
}