function (db, auth, req, postBody, _, Q, nodeRequire) {
    
    if(!postBody || !postBody.update_type || !postBody.target_class || !db[postBody.target_class]) {
        throw "invalid request";
    }
    
    var VersionId = nodeRequire('../api/datasource/version_id');
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
                
                //Check Version
                var localVersion = new VersionId(currObj.__ver);
                var incomingVersion = new VersionId(targetObj.__ver);
                
                //Compare versions...
                var localToIncoming = localVersion.relationshipTo(incomingVersion);
                
                
                //Special cases: OLD records have object id's as __ver values
                var localNewer = !localVersion.isObjectId && incomingVersion.isObjectId;
                var incomingNewer = localVersion.isObjectId && !incomingVersion.isObjectId;
                var bothOld = localVersion.isObjectId && incomingVersion.isObjectId;
                
                if(localToIncoming.same) {
                    return {result:'up-to-date'};
                }
                if(localNewer || localToIncoming.descendant) {
                    return {result:'skipped - local version newer'};
                }
                
                if(incomingNewer || localToIncoming.ancestor) {
                    //local is ancestor of incoming -> incoming is newer; 
                    //insert changes - no merge required
                    targetObj.__ver = currObj.__ver;
                
                    _.assign(currObj, targetObj); 
                
                    return currObj.save({useVersionId:incomingVersion.toString(),filterTriggers:dataTriggerPattern}, null).then(function(){return {result:'success', action:'updated'}});
                }
                
                if(bothOld || localToIncoming.cousin) {
                    //divergent changes - do a merge.
                    var manualCheck = {};
                    var tdMap = currObj._bo_meta_data.type_desc_map;
                    
                    _.forEach(_.union(Object.keys(currObj), Object.keys(targetObj)), function(f) {
                        if(f.indexOf('_') === 0) {
                            return;
                        }
                        
                        var cVal = currObj[f], tVal = targetObj[f];
                        
                        if(cVal instanceof Date) {
                            currObj[f] = cVal = cVal.toISOString(); //dates in targetObj already in ISO string format
                            
                        }
                        
                        if(cVal == tVal || _.isEqual(cVal, tVal)) {
                            return;
                        }
                        
                        var td = tdMap[f] || {};
                        
                        //Set merged value of currObj[f] 
                        
                        if(cVal == null && tVal != null) {
                            currObj[f] = tVal;
                            return;
                        }
                        else if(cVal != null && tVal == null) {
                            //current has the non-null value; we're good
                            return;
                        }
                        
                        //if it's a reference, they're equal if _id is equal.
                        if(td.type === 'reference' && cVal._id === tVal._id) {
                            return;
                        }
                        
                        //Arrays?
                        if(td instanceof Array) {
                            if(cVal.length === 0 && tVal.length !== 0) {
                                currObj[f] = tVal;
                                return;
                            }
                            else if(cVal.length !== 0 && tVal.length === 0) {
                                return;
                            }
                            var typ = td[0].type;
                            if(typ === 'string' || typ === 'enum') {
                                currObj[f] = _.union(cVal, tVal);
                                return;
                            }
                            if(typ === 'reference') {
                                currObj[f] = _.uniq(cVal.concat(tVal), '_id');
                                return;
                            }
                            if(typ === 'attachment') {
                                currObj[f] = _.uniq(cVal.concat(tVal), 'attachment_id');
                                return;
                            }
                            
                        }
                        
                        //Both are non-null and not equal at this point.
                        
                        if(td.type == 'string' || td.type == 'text') {
                            //if one is already included in the other, use the bigger one:
                            if(cVal.indexOf(tVal) > -1) {
                                //tVal is contained in cVal; we're good
                                return;
                            }
                            if(tVal.indexOf(cVal) > -1) {
                                currObj[f] = tVal;
                                return;
                            }
                            //Concatenate
                            var connector = (td.type == 'string') ? ' | ' : '\n\n';
                            currObj[f] = cVal + connector + tVal;
                            return;
                        }
                        
                        //non-null, not equal, and not strings... flag for a manual check
                        manualCheck[f] = {local:cVal, incoming:tVal};
                    }) ;
                    
                    var mergedVersion = VersionId.merge(localVersion, incomingVersion).toString();
                    
                    
                    if(Object.keys(manualCheck).length > 0) {
                        var mc = new db.MergeCheck({object_class:className, object_id:targetObj._id, fields:manualCheck});
                        mc.save();
                    }
                    
                        
                    return currObj.save({useVersionId:mergedVersion,filterTriggers:dataTriggerPattern}, null).then(function(){return {result:'success', action:'merged'}});
                }
                
                
                
            }
            else {
                var newObj = new TargetModel(targetObj);
                return newObj.save({useVersionId:targetObj.__ver,filterTriggers:dataTriggerPattern}, null).then(function(){return {result:'success', action:'created'}});
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