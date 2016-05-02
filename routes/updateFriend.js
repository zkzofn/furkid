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



//친구상태변경
exports.updateFriend = function (req, res) {
    logger.info(format('dev', req, res));
    pool.getConnection(function (err, connection) {
        var my_id = req.body.my_id;				//현재사용자의 ID
        var user_id = req.body.user_id;			//상대방의 ID
        //   var accept_reject = req.body.accept_reject;
        //   var trans = connection.startTransaction();
        queues(connection, true);
        if (err) {
            if (connection !== undefined) {
                connection.end();
                console.log('connection 연결은 됐는데 에러났음');
            }
        }
        //두 사용자의 친구 상태를 출력한다
        connection.query('select friend_check ' +
            '  from friend ' +
            ' where s_user_id = ? and r_user_id = ? ', [my_id, user_id], function (err, result) {
            var trans = connection.startTransaction();
            if (result.length == 0) {//현재 친구가 아닌 경우 --> 친구 신청하는 작업
                console.log("0번으로 들어왔네");
                trans.query('insert into friend (s_user_id, r_user_id, friend_check) ' + 'values (?,?,2) ', [my_id, user_id], function (err) {
                    if (err) {
                        console.log("1st insert Failed");
                        res.jsonp({"Error": "1st insert Error"});
                        trans.rollback(function () {
                            connection.end();
                        });
                    }
                    console.log("1st insert Success!!");
                    //친구신청을 수락하는 작업
                    trans.query('insert into friend(s_user_id, r_user_id, friend_check) ' + 'values (?,?,3) ', [user_id, my_id], function (err) {
                        if (err) {
                            console.log("2nd insert Failed");
                            res.jsonp({"Error": "2nd insert Error"});
                            trans.rollback(function () {
                                connection.end();
                            });
                        }
                        console.log("Friend request Success!!");
                        res.jsonp({"message": "Friend request Success"});
                        trans.commit(function () {
                            connection.end();
                        });
                    });
                });
                trans.execute();
            } else if (result[0].friend_check == 1 || result[0].friend_check == 2) {
                //1.현재 친구 상태일때 --> 친구 끊는 작업
                //2.현재 친구 신청중인 상태일때 --> 친구신청 취소하는 작업
                console.log("1/2번으로 들어왔네");
                //두 사용자의 정보에 매치되는 친구정보를 삭제
                trans.query('delete from friend where s_user_id = ? and r_user_id = ? ', [my_id, user_id], function (err) {
                    if (err) {
                        console.log("Delete Failed");
                        res.jsonp({"Error": "Delete Failed"});
                        trans.rollback(function () {
                            connection.end();
                        });
                    }
                    console.log("First delete success");
                    //두 사용자의 정보에 매치되는 친구정보를 삭제
                    trans.query('delete from friend where s_user_id = ? and r_user_id = ? ', [user_id, my_id], function (err) {
                        console.log("End of relationship");
                        res.jsonp({"message": "End of relationship"});
                        trans.commit(function () {
                            connection.end();
                        });
                    });
                });
                trans.execute();
            } else if (result[0].friend_check == 3) {//현재 친구 신청을 받은 상태 --> 친구 신청을 수락or거절하는 작업
                console.log("3번으로 들어왔네");
                var accept_reject = req.body.accept_reject;	//친구 수락 or 거절을 정하는 임시변수
                console.log("accept_reject : " + accept_reject);
                if (accept_reject == 0) {//거절	//여기서 type check 까지하면 못들어가서 값만 체크함
                    console.log("거절로 들어왔어");
                    //두 사용자의 정보에 매치되는 친구정보를 삭제
                    trans.query('delete from friend where s_user_id = ? and r_user_id = ? ', [my_id, user_id], function (err) {
                        if (err) {
                            console.log("Reject Delete Failed");
                            res.jsonp({"Error": "Reject Delete Failed"});
                            trans.rollback(function () {
                                connection.end();
                            });
                        }
                        console.log("First reject delete success");
                        //두 사용자의 정보에 매치되는 친구정보를 삭제
                        trans.query('delete from friend where s_user_id = ? and r_user_id = ? ', [user_id, my_id], function (err) {
                            if (err) {
                                console.log("Reject Delete Fauled");
                                res.jsonp({"Error": "Reject Delete Failed"});
                                trans.rollback(function () {
                                    connection.end();
                                });
                            }
                            console.log("Reject request");
                            res.jsonp({"message": "Reject request"});
                            trans.commit(function () {
                                connection.end();
                            });
                        });
                    });
                    trans.execute();
                } else if (accept_reject == 1) {//수락  //여기서 type check 까지하면 못들어가서 값만 체크함
                    console.log("수락으로들어오긴햇어");
                    //두 사용자의 친구정보를 변경
                    trans.query('update friend set friend_check = 1 ' + 'where s_user_id = ? and r_user_id = ? ', [my_id, user_id], function (err) {
                        if (err) {
                            console.log("Update Failed");
                            res.jsonp({"Error": "Update Failed"});
                            trans.rollback(function () {
                                connection.end();
                            });
                        }
                        console.log("First update success");
                        //두 사용자의 친구정보를 변경
                        trans.query('update friend set friend_check = 1 ' + 'where s_user_id = ? and r_user_id = ? ', [user_id, my_id], function (err) {
                            if (err) {
                                console.log("Update Failed");
                                res.jsonp({"Error": "Update Failed"});
                                trans.rollback(function () {
                                    connection.end();
                                });
                            }
                            console.log("Accept request");
                            res.jsonp({"message": "Accept request"});
                            trans.commit(function () {
                                connection.end();
                            });
                        });
                    });
                    trans.execute();
                } else {
                    console.log("Wrong accept_reject value");
                    res.jsonp({"Error": "Wrong accept_reject value"});
                    connection.end();
                }
            } else {//예외처리
                console.log("Wrong friend_check value");
                res.jsonp({"Error": "Wrong friend_check value"});
                connection.end();
            }
        });
    });
};
