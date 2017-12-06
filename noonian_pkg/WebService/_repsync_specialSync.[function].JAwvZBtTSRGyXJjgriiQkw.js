function (db, queryParams, _, Q, httpRequestLib, nodeRequire, ReplicationService) {
    var deferred = Q.defer();
    var partnerName = queryParams.partner;
    var boClass = queryParams.boClass;
    
    var VersionId = nodeRequire('../api/datasource/version_id');
    
    var partnerUrl;
    var token;
    
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
              
              
              var partnerVersion = {}; //maps _id to __ver
              
              _.forEach(body.result, function(item){
                  partnerVersion[item._id] = new VersionId(item.__ver);
              });
              
              db[boClass].find({}).then(function(resultArr) {
                  var toSave = [];
                  
                    _.forEach(resultArr, function(localObj) {
                        var id = localObj._id;
                        var pv = partnerVersion[localObj._id];
                        var lv = new VersionId(''+localObj.__ver);
                        
                        //Compare versions...
                        var localToPartner = lv.relationshipTo(pv);
                        if(localToPartner.same) {
                            toSave.push(localObj);
                        }
                    });
                    
                    //finished processing resultArr
                    deferred.resolve({total:toSave.length});
                    
                    var intervalObj;
                    var index=0;
                    var saveNext = function() {
                        if(index >= toSave.length) {
                            return clearInterval(intervalObj);
                        }
                        console.log('saving %s...', toSave[index]._id);
                        toSave[index].save();
                        index++;
                    };
                    intervalObj = setInterval(saveNext, 1000);
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