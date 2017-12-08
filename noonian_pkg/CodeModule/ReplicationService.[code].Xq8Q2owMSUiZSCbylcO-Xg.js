function (db, httpRequestLib, _, Q) {
    var PR_THROTTLE_PERIOD = 500; //throttle PendingReplication processing to 
    var exports = {};
    var inProgress = {};
    var removeInProgress = function(key) {
        delete inProgress[key];
    };
    
    var running = false;
    
    /**
     * Asynchronously enqueue a data-update event to be replicated.
     **/
    exports.enqueueEvent = function(modelObj, updateType) {
        console.log('enqueueing %s for %s', updateType, modelObj._id);
        
        //Find all ReplicationSpec's satisfied by modelObj
        db.ReplicationSpec.find({'business_object._id':modelObj._bo_meta_data.bod_id}).exec().then(function(specList){
            // console.log('Replication Specs: %j', specList);
            _.forEach(specList, function(repSpec) {
                //Check the condition on this repSpec to see if it should be 
                var conditionSatisfied = true;
                if(repSpec.condition)
                    conditionSatisfied = modelObj.satisfiesCondition(repSpec.condition);
                if(conditionSatisfied) {
                    //This modelObj should be replicated to repSpec.partner!
                    
                    var newPrObj = {
                        target_object:modelObj.toPlainObject ? modelObj.toPlainObject() : modelObj, //if its a delete, modelObj isn't real
                        update_type:updateType,
                        spec:repSpec,
                        status:'new'
                    };
                    // console.log(newPrObj);
                    // console.log('previous: %j', modelObj._previous);
                    
                    if(modelObj._previous && modelObj._previous.__ver) {
                        newPrObj.target_version = modelObj._previous.__ver;
                    }
                    
                    new db.PendingReplication(newPrObj).save().then(function() {}, 
                    function(err) {
                        console.error('problem saving PendingReplication %j', err);
                    });
                }
            });
        });
        
    };//End enqueueEvent
    
    /**
     * Process queue
     **/
    exports.processQueue = function() {
        if(!running) {
            console.log("PROCESSING REPLICATION QUEUE!");
            running = true;
            
            var lastPromise = Q(true);
            var intervalObj;
            
            //Called on a periodic to throttle replication processing
            const processNextPr = function() {
                if(lastPromise.state === 'pending') {
                    //Skip this round if still waiting on a previous record
                    return;
                }
                
                lastPromise = db.PendingReplication.findOne({status:'new'}).then(function(pr) {
                    if(!pr) {
                        running = false;
                        clearInterval(intervalObj);
                        return;
                    }
                    
                    var targetBoClassName;
                    
                    pr.status = 'in_progress';
                    
                    //Grab the ReplicationSpec for this PR
                     return Q.all([
                        pr.save({skipTriggers:true}, null),
                        db.ReplicationSpec.findOne({_id:pr.spec._id}).exec()
                    ])
                    .then(function(resultArr){
                        var repSpec = resultArr[1];
                        targetBoClassName = db[repSpec.business_object._id]._bo_meta_data.class_name;
                        
                        //Grab the partner
                        return db.ReplicationPartner.findOne({_id:repSpec.partner._id}).exec();
                    })
                    .then(function(partner) {
                        //Now, let's send pr.target_object to partner.url using credentials in partner.auth
                        console.log('sending to %s -> %s', partner.name, pr.target_object._id);
                        var url = partner.url+'/ws/replication';
                        var header = { authorization:'Bearer '+partner.auth.token};
                        
                        var postBody = {
                            update_type:pr.update_type, 
                            target_class:targetBoClassName, 
                            target_object:pr.target_object, 
                            target_version:pr.target_version
                        };
                        
                        httpRequestLib.post( {
                            uri:url,
                            headers:header,
                            rejectUnauthorized: false,
                            json:true,
                            body:postBody
                        }, function(err, httpResponse, body) {
                            if(body && body.result === 'success') {
                                console.log('Successful replication of %s %s', targetBoClassName, pr.target_object._id);
                                pr.remove();
                            }
                            else if(!body || body.result !== 'up-to-date') {
                                console.error('FAILED REPLICATION: %s, %j', err, body);
                                if(!body) body = {};
                                body._http_err = err;
                                pr.attempt_result = body;
                                pr.status = 'error';
                                pr.save();
                            }
                        });//end httpRequest.post
                    });//end "then" sequence
                }); //end PendingReplication.findOne().then(...)
                
            };//end processNextPr function def
            
            intervalObj = setInterval(processNextPr, PR_THROTTLE_PERIOD);
            
        }//end if(!running)
        
    };//end processQueue
    
    
    return exports;
}