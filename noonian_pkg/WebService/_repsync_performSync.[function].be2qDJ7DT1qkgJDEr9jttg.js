function (db, queryParams, _, Q, httpRequestLib, nodeRequire, ReplicationService) {
    var deferred = Q.defer();
    var partnerName = queryParams.partner;
    var boClass = queryParams.boClass;
    
    var VersionId = nodeRequire('../api/datasource/version_id');
    
    var partnerUrl;
    var token;
    
    var QueryOpService = db._svc.QueryOpService; //for condition checking
    
    return db.ReplicationPartner.findOne({name:partnerName}).then(function(rp) {
        
      if(!rp) {
            throw new Error('bad partner name');
      }
      
      partnerUrl = rp.url;
      token = rp.auth.token;
      
      return db.ReplicationSpec.findOne({partner:rp._id, business_object:db[boClass]._bo_meta_data.bod_id})
    }) 
    .then(function(repSpec) {
        
      var specCondition = repSpec.condition;

      var url = partnerUrl+'/ws/repsync/getManifest?boClass='+boClass;
      var header = { authorization:'Bearer '+token};
      
      
      console.log('Attempting HTTP GET of %s', url);
      httpRequestLib.get( {
          uri:url,
          headers:header,
          rejectUnauthorized: false,
          json:true
      }, function(err, httpResponse, body) {
          if(body && body.result) {
              
              var manualMerges = [];
              var partnerVersion = {}; //maps _id to __ver
              
              _.forEach(body.result, function(item){
                  partnerVersion[item._id] = new VersionId(item.__ver);
              });
              
              db[boClass].find({}).then(function(resultArr) {
                    _.forEach(resultArr, function(localObj) {
                        var id = localObj._id;
                        var pv = partnerVersion[localObj._id];
                        
                        var lv = new VersionId(''+localObj.__ver);
                        
                        if(!pv) {
                            //It's not in partner's manifest; send a create if condition passes
                            // console.log('%s - NEW; version=%s', id, localObj.__ver);
                            if(!specCondition || QueryOpService.satisfiesCondition(localObj, specCondition)) {
                                return ReplicationService.enqueueEvent(localObj, 'create');
                            }
                            return;
                        }
                        
                        //Compare versions...
                        var localToPartner = lv.relationshipTo(pv);
                        
                        
                        //Special cases: OLD records have object id's as __ver values
                        var localNewer = !lv.isObjectId && pv.isObjectId;
                        var partnerNewer = lv.isObjectId && !pv.isObjectId;
                        var bothOld = lv.isObjectId && pv.isObjectId;
                        
                        
                        if(partnerNewer || localToPartner.ancestor || localToPartner.same) {
                            return;
                        }
                        
                        
                        if(localNewer || localToPartner.descendant) {
                            //more recent changes local - send an update
                            // console.log('%s - DESCENDANT', id);
                            return ReplicationService.enqueueEvent(localObj, 'update');
                        }
                        
                        if(bothOld || localToPartner.cousin) {
                            //divergent changes
                            // console.log('%s - COUSIN', id);
                            ReplicationService.enqueueEvent(localObj, 'merge');
                            return manualMerges.push({id:localObj._id, local:lv.toString(), remote:pv.toString()});
                        }
                        
                        
                    });
                    
                    //finished processing resultArr
                    deferred.resolve({merges:manualMerges});
                    
              });
              
              
              
          }
          else {
              console.error('FAILED MANIFEST GET: %s, %j', err, body);
              deferred.reject('failed manifest get')
          }
      });
    
    
    return deferred.promise;
    
});
    
}