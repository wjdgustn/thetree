require('dotenv').config();
require('./schemas')();

const { ACLTypes, ACLConditionTypes, ACLActionTypes } = require('./utils/types');

const ACL = require('./schemas/acl');
const ACLGroupItem = require('./schemas/aclGroupItem');

(async () => {
    // await ACLGroupItem.create({
    //     aclGroup: 'test',
    //     ip: '58.230.143.51/16'
    // });

    // const targetip = [58, 230, 143, 51];
    //
    // const test = await ACLGroupItem.findOne({
    //     ipMin: {
    //         $lte: targetip
    //     },
    //     ipMax: {
    //         $gte: targetip
    //     }
    // });

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
    // console.log(test);

    // await ACL.create({
    //     namespace: '테스트위키',
    //     type: ACLTypes.Read,
    //     conditionType: ACLConditionTypes.Perm,
    //     conditionContent: 'any',
    //     actionType: ACLActionTypes.Allow
    // });

    // await ACL.create({
    //     namespace: '테스트위키',
    //     type: ACLTypes.Read,
    //     conditionType: ACLConditionTypes.GeoIP,
    //     conditionContent: 'CN',
    //     actionType: ACLActionTypes.Deny
    // });
    //
    // await ACL.create({
    //     namespace: '테스트위키',
    //     type: ACLTypes.Read,
    //     conditionType: ACLConditionTypes.IP,
    //     conditionContent: '::1',
    //     actionType: ACLActionTypes.Allow
    // });
    //
    // await ACL.create({
    //     namespace: '테스트위키',
    //     type: ACLTypes.Read,
    //     conditionType: ACLConditionTypes.IP,
    //     conditionContent: '127.0.0.1',
    //     actionType: ACLActionTypes.Allow
    // });
    //
    // await ACL.create({
    //     namespace: '테스트위키',
    //     type: ACLTypes.Edit,
    //     conditionType: ACLConditionTypes.Member,
    //     conditionContent: 'df5994d0-2905-45a1-93b4-515aa567500e',
    //     actionType: ACLActionTypes.Allow
    // });

    setTimeout(() => {
        process.exit();
    }, 500);
})()