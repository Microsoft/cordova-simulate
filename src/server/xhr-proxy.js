// Copyright (c) Microsoft Corporation. All rights reserved.

var http = require('http'),
    https = require('https'),
    url = require('url');

module.exports.attach = function (app) {
    app.all('/xhr_proxy', function proxyXHR(request, response) {
        var requestURL = url.parse(unescape(request.query.rurl));

        request.headers.host = requestURL.host;
        // fixes encoding issue
        delete request.headers['accept-encoding'];

        var options = {
            hostname: requestURL.hostname,
            path: requestURL.path,
            port: requestURL.port,
            method: request.method,
            headers: request.headers
        };

        var proxyCallback = function (proxyResponse) {

            if(requestURL.protocol === 'https:' && proxyResponse.headers.hasOwnProperty('set-cookie')) {
                proxyResponse.headers['set-cookie'] = proxyResponse.headers['set-cookie'].map(function(h) {
                    return h.split('; ').filter(function(o) {
                        return o !== 'secure';
                    }).join('; ');
                });
            }

            response.writeHead(proxyResponse.statusCode, proxyResponse.statusMessage, proxyResponse.headers);
            proxyResponse.pipe(response);
        };
        
        var proxyRequest;

        if (requestURL.protocol === 'https:') {
            proxyRequest = https.request(options, proxyCallback);
        } else {
            proxyRequest = http.request(options, proxyCallback);
        }

        proxyRequest.on('error', function (err) {
            response.status(502).send(err.toString()).end();
        });
        request.pipe(proxyRequest);
    });
};
