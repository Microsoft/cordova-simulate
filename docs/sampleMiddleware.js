module.exports = function(req,res,next) {
    /*
    To call an exec method from the middleware:
    simulateGapPlugins[service][method](success callback,failure callback,args as array,simulateGapPlugins)

    Tou can also add custom methods/data to the simulate_gap file that do not map to an exec call:
    simulateGapPlugins[service][data or method]
    */
    console.log(simulateGapPlugins)
    next()
}