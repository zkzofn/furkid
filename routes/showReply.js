var mysql = require('mysql'),
    crypto = require('crypto'),
    uuid = require('node-uuid'),
    fstools = require('fs-tools'),       //파일이동 관련 npm
    ffmpeg = require('fluent-ffmpeg'),
    async = require('async'),
    easyimage = require('easyimage'),   //thunbnail 만들어주는 npm;
    util = require('util'),
    path = require('path'),
    queues = require('mysql-queues'),
    winston = require('winston');

var serverUrl = "192.241.222.231";

function format(name, req, res) {
    //:remote-addr - - [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"
    req._startTime = new Date();
    var remoteAddr = req.socket &&
        req.socket.remoteAddress || (req.socket.socket && req.socket.socket.remoteAddress);
    var date = new Date().toUTCString();
    var method = req.method;
    var url = req.originalUrl || req.url;
    var httpVersion = 'HTTP/' + req.httpVersionMajor + '.' + req.httpVersionMinor;
    var status = res.statusCode;
    var resContentLength = parseInt(res.getHeader('Content-Length'), 10) || '-';
    var referrer = req.headers['referer'] || req.headers['referrer'] || '-';
    var userAgent = req.headers['user-agent'];

    var info = remoteAddr + ' - - [' + date + '] "' + method + ' ' + url + ' ' +
        httpVersion + '" ' + status + ' "' + referrer + '" ' + resContentLength +
        ' - ' + (new Date() - req._startTime) + 'ms "' + userAgent + '"';
    var debug = util.format('query: %j\nbody: %j\nfiles: %j\nparams: %j\n', req.query, req.body, req.files, req.params);

    if (name === 'dev') {
        return info + '\n' + debug;
    } else {
        return info;
    }
}

var logger = new winston.Logger({
    transports: [
        new winston.transports.Console({level: 'debug', timestamp: false}),
        new winston.transports.File({
            level: 'debug',
            filename: './logs/winston_application.log',
            timestamp: false,
            maxsize: 1 * 1024 * 1024,
            json: false
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: './logs/winston_exception.log',
            maxsize: 1 * 1024,
            json: false
        })
    ]
});

var pool = mysql.createPool({
    host: 'localhost',
    port: '3306',
    user: 'root',
    password: 'rhwkdtns',
    database: 'Furkid',
    waitForConnections: true,
    connectionLimit: 50
});



exports.showReply = function (req, res) {
    logger.info(format('dev', req, res));

    var page_cnt = (req.query.page_cnt - 1) * 10;
    var timeline_id = req.query.timeline_id;

    if (page_cnt === undefined) {
        console.log("page_cnt 값이 입력되지 않았음");
        res.jsonp({"Error": "Not insert to page_cnt value"});
    }
    if (timeline_id === undefined) {
        console.log("timeline_id 값이 입력되지 않았음");
        res.jsonp({"Error": "Not insert to timeline_id value"});
    }
    pool.getConnection(function (err, connection) {
        connection.query('select id, pet_id, re_date, re_content, pet_name, pet_photo_path ' +
            '  from reply ' +
            ' where timeline_id = ? ' +
            ' limit ?, 10 ', [timeline_id, page_cnt], function (err, replies) {
            if (err) {
                connection.end(function () {
                    console.log("timeline_id / page_cnt 값이 제대로 입력되지 않았음");
                    res.jsonp({"Error": "Fail in show reply"});
                });
            } else {
                connection.end(function () {
                    console.log("Show reply success!");
                    res.jsonp({"replies": replies});
                });
            }
        });
    });
};
