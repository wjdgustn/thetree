require('dotenv').config();
require('./schemas')();

const ACLGroupItem = require('./schemas/aclGroupItem');

(async () => {
    // await ACLGroupItem.create({
    //     aclGroup: 'test',
    //     ip: '58.230.143.51/16'
    // });

    const targetip = [58, 230, 143, 51];

    const test = await ACLGroupItem.findOne({
        ipMin: {
            $lte: targetip
        },
        ipMax: {
            $gte: targetip
        }
    });

    // const test = await ACLGroupItem.findOne({
    //     ['ipMin.0']: {
    //         $lte: targetip[0]
    //     },
    //     ['ipMin.1']: {
    //         $lte: targetip[1]
    //     },
    //     ['ipMin.2']: {
    //         $lte: targetip[2]
    //     },
    //     ['ipMin.3']: {
    //         $lte: targetip[3]
    //     },
    //     ['ipMax.0']: {
    //         $gte: targetip[0]
    //     },
    //     ['ipMax.1']: {
    //         $gte: targetip[1]
    //     },
    //     ['ipMax.2']: {
    //         $gte: targetip[2]
    //     },
    //     ['ipMax.3']: {
    //         $gte: targetip[3]
    //     }
    // });
    console.log(test);

    setTimeout(() => {
        process.exit();
    }, 500);
})()