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



exports.removeNews = function (req, res) {
    logger.info(format('dev', req, res));

    pool.getConnection(function (err, connection) {
        queues(connection, true);

        var timeline_id = req.body.timeline_id;
        var my_id = req.body.my_id;
        var tx = connection.startTransaction();

        async.series([
                // 글쓴이 확인
                // if 문으로 싸서 my_id === timeline.user_id 이면 실행
                // 아니면글을 삭제할수 잇는 권한이 없습니다 출력
                function (callback) {
                    tx.query('select user_id from timeline where id = ?', [timeline_id], function (err, rows) {
                        if (err) {
                            tx.rollback(function () {
                                callback("select 문이 제대로 실행되지 않았습니다.", connection);
                            });
                        } else {
                            if (rows[0].user_id != my_id) { // 사용자가 글을 쓴 사용자가 아니면 실행
                                console.log("Error : You can't remove this timeline.");
                                callback("You can't remove this timeline.", connection);
                            } else {
                                callback(null);
                            }
                        }
                    });
                    tx.execute();
                },

                // 댓글 테이블 삭제
                function (callback) {
                    tx.query('delete from reply where timeline_id = ? ', [timeline_id], function (err) {
                        if (err) {
                            tx.rollback(function () {
                                callback("Fail delete reply", connection);
                            });
                        } else {
                            console.log("message : Delete reply Success");
                            callback(null);
                            return;
                        }
                    });
                },

                // 신고 테이블 삭제
                function (callback) {
                    tx.query('delete from report_timeline where timeline_id = ? ', [timeline_id], function (err) {
                        if (err) { // 에러시 콜백
                            tx.rollback(function () {
                                callback("Fail delete report", connection);
                            });
                        } else {
                            console.log("message : Delete report Success");
                            callback(null);
                        }
                    });
                },

                // 좋아요 테이블 삭제
                function (callback) {
                    tx.query('delete from like_timeline where timeline_id = ? ', [timeline_id], function (err) {
                        if (err) { // 에러시 콜백
                            tx.rollback(function () {
                                callback("Fail delete like", connection);
                            });
                        } else {
                            console.log("message : Delete like timeline");
                            callback(null);
                        }
                    });
                },

                // 실제 글 삭제
                function (callback) {
                    tx.query('delete from timeline where id = ? ', [timeline_id], function (err) {
                        if (err) { // 에러시 콜백
                            tx.rollback(function () {
                                callback("Fail delete timeline", connection);
                            });
                        } else {
                            console.log("message : Delete timeline success!!!");
                            callback(null);
                            tx.commit(function () {
                                connection.end();
                            });
                        }
                    });
                }
            ],
            function (err, connection) {
                if (err) {
                    connection.end();
                    res.jsonp({"Error": err});
                }
                console.log("Delete all Success!!");
                res.jsonp({"message": "Delete timeline Success!!"});
            });
    });
};
