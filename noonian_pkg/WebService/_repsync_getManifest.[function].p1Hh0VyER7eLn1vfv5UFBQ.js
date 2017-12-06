function (db, queryParams) {
    var boClass = queryParams.boClass;
    return db[boClass].find({},{__ver:1, _id:1}).then(function(resultArr) {
        return {result:resultArr};
    });
}