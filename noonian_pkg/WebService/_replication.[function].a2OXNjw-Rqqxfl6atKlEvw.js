function (db, auth, req, postBody, _, Q) {
    
    if(!postBody || !postBody.update_type || !postBody.target_class || !db[postBody.target_class]) {
        throw "invalid request";
    }
    
    var dataTriggerPattern = '.*onReplication.*';
    
    var className = postBody.target_class;
    var targetObj = postBody.target_object;
    var targetVer = postBody.target_version;
    var isDelete = postBody.update_type === 'delete';
    
    var TargetModel = db[className];
    var currPromise = TargetModel.findOne({_id:targetObj._id}).exec();
    
    if(!isDelete) {
        //First, check for existing
        return Q.all([currPromise, auth.aggregateUpdateDacs(req, TargetModel)])
        .then(function(resultArr){
            var currObj = resultArr[0];
            var dacObj = resultArr[1];
            
            if(currObj) {
                // if(!currObj.satisfiesCondition(dacObj.condition)) {
                //     return {error:'Insufficient privileges'};
                // }
                
                //Check Version
                var versionInDb = ''+currObj.__ver;
                var newVersion = targetObj.__ver;
                
                if(versionInDb === newVersion) {
                    return {result:'up-to-date'};
                }
                else if(versionInDb !== targetVer) {
                    return {error:'Version mismatch - mine:'+currObj.__ver+' yours:'+targetVer};
                }
                
                
                targetObj.__ver = targetVer;
                
                _.assign(currObj, targetObj); 
                
                return currObj.save({useVersionId:newVersion,filterTriggers:dataTriggerPattern}, null).then(function(){return {result:'success'}});
            }
            else {
                var newObj = new TargetModel(targetObj);
                return newObj.save({useVersionId:targetObj.__ver,filterTriggers:dataTriggerPattern}, null).then(function(){return {result:'success'}});
            }
            
        },
        function(err) {
            return {error:'Insufficient privileges'};
        });
    }
    else {
        return {result:'no deletes yet'};
    }
    
    
}