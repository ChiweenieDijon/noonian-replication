function (queryParams, db, ReplicationService) {
    return db.ReplicationSpec.findOne({_id:queryParams.id}).exec().then(function(rs) {
        var TargetModel = db[rs.business_object._id];
        var queryObj = rs.condition || {};
        TargetModel.find(queryObj).then(function(resultList) {
            if(!resultList || resultList.length === 0) {
                return {message:'no records to replicate'};
            }
            
            //Nice and slow...
            var delay = 2000; //2 sec
            var i=0;
            
            var intervalObj = setInterval(function(){
                ReplicationService.enqueueEvent(resultList[i], 'create');
                i++;
                if( i >= resultList.length) {
                    clearInterval(intervalObj);
                }
            }, delay);
            
            return {
                message:'Replicating '+resultList.length+' records - one every '+delay+' millis.'
            };
        });
    });
}