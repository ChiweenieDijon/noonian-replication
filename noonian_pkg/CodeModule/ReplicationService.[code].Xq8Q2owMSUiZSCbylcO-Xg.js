function (db, httpRequestLib, _, Q) {
    var exports = {};
    var inProgress = {};
    var removeInProgress = function(key) {
        delete inProgress[key];
    };
    
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
        console.log("PROCESSING REPLICATION QUEUE!");
        var prQuery = {status:'new'};
        var idsInProgress = Object.keys(inProgress);
        if(idsInProgress.length > 0) {
            prQuery._id = {$nin:idsInProgress};
        }
        
      db.PendingReplication.find(prQuery).exec().then(function(prList) {
          
          _.forEach(prList, function(pr) {
              if(inProgress[pr._id])
                return;
                
              var targetBoClassName;
              
              pr.status = 'in_progress';
              inProgress[pr._id] = true;
              
             //Grab the ReplicationSpec for this PR
             Q.all([
                pr.save({skipTriggers:true}, null),  
                db.ReplicationSpec.findOne({_id:pr.spec._id}).exec()
            ])
            .then(function(resultArr){
                  var repSpec = resultArr[1];
                  targetBoClassName = repSpec.business_object._disp;
                  
                  //Grab the partner
                  return db.ReplicationPartner.findOne({_id:repSpec.partner._id}).exec();
              })
              .then(function(partner) {
                  //Now, let's send pr.target_object to partner.url using credentials in partner.auth
                  console.log('sending to %s -> %s', partner.name, pr.target_object._id);
                  var url = partner.url+'/ws/replication';
                  var header = { authorization:'Bearer '+partner.auth.token};
                  
                  httpRequestLib.post( {
                      uri:url,
                      headers:header,
                      rejectUnauthorized: false,
                      json:true,
                      body:{update_type:pr.update_type, target_class:targetBoClassName, target_object:pr.target_object, target_version:pr.target_version}
                  }, function(err, httpResponse, body) {
                      if(body && body.result === 'success') {
                          console.log('Successful replication of %s %s', targetBoClassName, pr.target_object._id);
                          pr.remove().then(removeInProgress.bind(null, pr._id));
                      }
                      else {
                          console.error('FAILED REPLICATION: %s, %j', err, body);
                          if(!body) body = {};
                          body._http_err = err;
                          pr.attempt_result = body;
                          pr.status = 'error';
                          pr.save().then(removeInProgress.bind(null, pr._id));
                      }
                  });
                  
                  
              });
              
              
          });//End prList iteration
          
      });
      
    };//end processQueue
    
    
    return exports;
}