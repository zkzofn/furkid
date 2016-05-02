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


exports.removePetProfile = function (req, res) {
    logger.info(format('dev', req, res));

    //다른사람들이 썼을 수도 있을 글의 댓글들 지우고
    //해당 동물이 쓴 글의 댓글들 지우고
    //해당 동물이 쓴 글 지우고
    //해당 동물의 프로필 삭제

    pool.getConnection(function (err, connection) {
        queues(connection, true);

        var pet_id = req.body.pet_id;
        var my_id = req.body.my_id;
        var tx = connection.startTransaction();

        async.series([
                // 해당 동물이 사용자의 동물이 맞는지 확인
                // my_id === pet.user_id 이면 실행
                // 아니면 해당 동물의 프로필을 삭제할수 있는 권한이 없습니다 출력
                function (callback) {
                    tx.query('select user_id from pet where id = ?', [pet_id], function (err, rows) {
                        if (err) {
                            connection.end(function () {
                                tx.rollback();
                                console.log("Fail in first step");
                                callback("select 문이 제대로 실행되지 않았습니다.");
                            });
                        } else {
                            if (rows[0].user_id != my_id) { // 사용자가 글을 쓴 사용자가 아니면 실행
                                connection.end(function () {
                                    tx.commit();
                                    console.log("Message : Don't match pet_id <-> my_id");
                                    res.jsonp({"Message": "You can't remove this pet"});
                                });
                            } else {
                                callback(null);
                            }
                        }
                    });
                    tx.execute();
                },

                // 댓글중 해당 동물이 게시한 댓글 삭제
                function (callback) {
                    tx.query('delete from reply where pet_id = ? ', [pet_id], function (err, result) {
                        if (err) {
                            connection.end(function () {
                                tx.rollback();
                                console.log("Fail in delete reply");
                                callback("Fail in delete reply");
                            });
                        } else {
                            if (result.affectedRows == 0) {
                                console.log("(pet_id:" + pet_id + ")가 작성한 댓글이 업습니다.");
                            } else {
                                console.log(result.affectedRows + " 개의 댓글을 삭제했습니다.");
                            }
                            callback(null);
                        }
                    });
                },

                // 해당 동물이 쓴 timeline 의 댓글들을 삭제
                function (callback) {
                    tx.query('select id from timeline where pet_id = ? ', [pet_id], function (err, rows) {
                        if (err) { // 에러시 콜백
                            connection.end(function () {
                                tx.rollback();
                                consol.log("Error : Fail in select timeline_id");
                                callback("Fail in select timeline_id");
                            });
                        } else {
                            // 각 타임라인 id 별로 댓글, 좋아요, 신고 테이블을 삭제
                            ///////////////////////////////////////////////////////////////////////////
                            //각 댓글, 좋아요, 신고테이블 별로 삭제해줘야돼
                            //아래에서는 join 걸어놔서 에러터져
                            rows.forEach(function (row, idx, array) {
                                tx.query('delete from reply where timeline_id = ? ', [row.id], function (err) {
                                    if (err) {
                                        connection.end(function () {
                                            tx.rollback();
                                            console.log("Error : Fail in delteing reply");
                                        });
                                    } else {
                                        console.log("timeline_id : " + row.id + " 인 글의 댓글을 삭제 했습니다.");
                                    }
                                });

                                tx.query('delete from like_timeline where timeline_id = ? ', [row.id], function (err) {
                                    if (err) {
                                        connection.end(function () {
                                            tx.rollback();
                                            console.log("Error : Fain in deleting like_timeline");
                                        });
                                    } else {
                                        console.log("timeline_id : " + row.id + " 인 글의 like 테이블의 column을 삭제했습니다.");
                                    }
                                });

                                tx.query('delete from report_timeline where timeline_id = ? ', [row.id], function (err) {
                                    if (err) {
                                        connection.end(function () {
                                            tx.rollback();
                                            console.log("Error : Fain in deleting report_timeline");
                                            para_callback("Fail in deleting report_timeline");
                                        });
                                    } else {
                                        console.log("timeline_id : " + row.id + " 인 글의 report 테이블의 column을 삭제했습니다");
                                    }
                                });

                                if (idx === (array.length - 1))
                                    callback(null);
                            });
                        }
                    });
                },
                // timeline 테이블 삭제
                function (callback) {
                    tx.query('delete from timeline where pet_id = ? ', [pet_id], function (err) {
                        if (err) { // 에러시 콜백
                            connection.end(function () {
                                tx.rollback();
                                console.log("Error : Fail in delete timeline");
                                callback("Fail in delete timeline", connection);
                            });
                        } else {
                            console.log("Timeline that (pet_id:" + pet_id + ") wrote is delete ");
                            callback(null);
                        }
                    });
                },

                // 동물의 프로필 삭제
                function (callback) {
                    tx.query('delete from pet where id = ? ', [pet_id], function (err) {
                        if (err) { // 에러시 콜백
                            tx.rollback(function () {
                                console.log("Error : Fail in delete pet profile");
                                callback("Fail in delete pet profile", connection);
                            });
                        } else {
                            connection.end(function () {
                                tx.commit();
                                console.log("(Pet_id:" + pet_id + ") delete Success!!");
                                callback(null);
                            });
                        }
                    });
                }
            ],
            function (err, connection) {
                if (err) {
                    console.log("에러에 들어왔어");
                    res.jsonp({"Error": err});
                } else {
                    console.log("Delete pet profile Success!!");
                    res.jsonp({"message": "Delete pet profile Success!!"});
                }
            });
    });
};
