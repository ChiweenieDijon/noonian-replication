function (db, req, queryParams, nodeRequire, Q) {
    
    const conf = nodeRequire('../conf');
    
    var metaObj;
    try {
        metaObj = JSON.parse(queryParams.metaObj);
    }
    catch(err) {
        throw 'Bad metadata';
    }
    
    // console.log(metaObj);
    
    
    const multiparty = require('multiparty');
    const form = new multiparty.Form({
        autoFiles:false,
        autoFields:false
    });
    
    const deferred = Q.defer();
    
    form.on('error', function(err) {
        console.error(err);
        deferred.resolve({result:err.message});
    });
    
    form.on('part', function(part) {
        console.log('Processing upload part: %s', part.name);
        if(part.name === 'fileStream') {
            
            const Grid = require('gridfs-stream');
            var mongoose = require('mongoose');
    
            var conn = mongoose.createConnection(conf.mongo.uri, conf.mongo.options);
            
            conn.once('open', function () {
                var gfs = Grid(conn.db, mongoose.mongo);
                
                var attachment = metaObj.attachment;
                var gridMetadata = metaObj.metadata;
                
                var opts = {
                    _id:attachment.attachment_id, 
                    metadata:gridMetadata
                };
                
                gfs.findOne({filename:attachment.attachment_id}, function (err, file) {
                    if(file) {
                        console.log('already have file '+attachment.attachment_id);
                        return conn.close();
                    }
                
                    var ws = gfs.createWriteStream(opts);
                    
                    ws.on('finish', function() {
                        console.log('SUCCESSFULLY SAVED ATTACHMENT');
                        conn.close();
                    });
                    ws.on('error', function(err) {
                        console.log('Failed to save attachment');
                        console.log(err);
                    });
                    
                    part.pipe(ws);
                });
            });
            
            
        }
        else {
            console.error('unknown part');
        }
        
    });
    
    form.on('close', function() {
        deferred.resolve({result:'success'});
    });

    form.parse(req);
    
      
    return deferred.promise;

}