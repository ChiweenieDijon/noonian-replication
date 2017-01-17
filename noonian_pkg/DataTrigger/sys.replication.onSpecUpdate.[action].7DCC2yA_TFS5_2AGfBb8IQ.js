function (db, isCreate, isUpdate, isDelete) {

  if(!this.business_object && !isDelete)
    throw "Must specify a business object";

  var specBo = this;
  var boClass = specBo.business_object._disp;
  
  var promiseToReturn = null;

  if(!isDelete) {
    //Create the corresponding data trigger if needed...
    var dataTriggerKey = 'sys.replication.'+boClass; 
    
    promiseToReturn = db.DataTrigger.find({key:dataTriggerKey}).exec().then(function(matchingDt) {
       if(!matchingDt || matchingDt.length === 0) {
            
            var newDataTrigger = new db.DataTrigger({
              key:dataTriggerKey,
              business_object:specBo.business_object,
              before_after:'after',
              on_create:true,
              on_update:true,
              on_delete:true,
              description:'Notify replication service of changes to '+boClass+' (this DataTrigger created automatically)',
              action:function(ReplicationService, isCreate, isUpdate) {
                  var updateType = isCreate ? 'create' : (isUpdate ? 'update' : 'delete');
                  ReplicationService.enqueueEvent(this, updateType);
                }
            });
        
            //Set reference in this record to point to the new data trigger:
            return newDataTrigger.save().then(function() {
              specBo.data_trigger = newDataTrigger;
            });
       }
       else {
           specBo.data_trigger = matchingDt[0];
       }
    });
    
    
  }
  
  if(isDelete || (isUpdate && this.data_trigger && (this._previous.business_object._id !== this.business_object._id))) {
      
      db.ReplicationSpec.find({_id:{$ne:specBo._id}, 'data_trigger._id':specBo.data_trigger._id}).exec().then(function(otherSpecs) {
         if(!otherSpecs || otherSpecs.length === 0) {
             db.DataTrigger.findOne({_id:specBo.data_trigger._id}).exec().then(function(dt) {
              dt.remove();
            });
         } 
      });
  }

  return promiseToReturn;

}