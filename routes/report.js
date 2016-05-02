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


//신고 기능
exports.report = function (req, res) {
    logger.info(format('dev', req, res));
    pool.getConnection(function (err, connection) {
        var timeline_id = req.body.timeline_id;		//신고할 글의 ID
        var user_id = req.body.user_id;				//신고하는 사용자의 ID
        queues(connection, true);
        if (err) {
            if (connection !== undefined) {
                connection.end();
                console.log('connection 연결은 됐는데 에러났음');
            }
        }
        //해당 사용자가 신고한 게시글의 아이디를 출력
        connection.query('select timeline_id ' +
            '  from report_timeline ' +
            ' where user_id = ? and timeline_id = ? ',
            [user_id, timeline_id], function (err, sel_rt_id) {
                if (err) {
                    console.log("select error");
                    connection.end();
                    res.jsonp({"Error": "select error"});
                }
                var trans = connection.startTransaction();
                if (sel_rt_id.length === 0) {//사용자가 해당 글에 좋아요를 누른 적이 없는 경우에 신고를 적용하는 코드
                    console.log("신고 누르러 왔다~");
                    //신고 정보를 입력한다
                    trans.query('insert into report_timeline (user_id, timeline_id, report_date) ' +
                        'values(?,?,now()) ', [user_id, timeline_id], function (err, in_rt_result) {
                        if (err) {
                            trans.rollback(function () {
                                res.jsonp({"error": "Wrong data inserted"});
                                connection.end();
                                return;
                            });
                        }
                        //글의 report_cnt를 +1 시킨다
                        trans.query('update timeline set report_cnt=report_cnt + 1 where id = ? ', [timeline_id], function (err, up_report_cnt) {
                            if (err) {
                                trans.rollback(function () {
                                    connection.end();
                                    res.jsonp({"error": "update Failed"});
                                    return;
                                });
                            } else {
                                trans.commit(function () {
                                    console.log("reportNews complete.");
                                    res.jsonp({"message": "report_timeline complete"});
                                    connection.end();
                                });
                            }
                        });
                    });
                    trans.execute();
                } else {//사용자가 신고를 이미 누른경우에 좋아요를 취소하는 코드
                    //신고 기록을 삭제한다
                    trans.query('delete from report_timeline where timeline_id = ? and user_id =? ', [timeline_id, user_id], function (err, del_rt_result) {
                        if (err) {
                            trans.rollback(function () {
                                console.log("Fail deleting report_timeline");
                                res.jsonp({"Error": "Fail deleting report_timeline"});
                                connection.end();
                                return;
                            });
                        }
                        console.log("delete report_timeline result : " + del_rt_result[0]);
                        //해당글의 report_cnt 를 -1 시킨다
                        trans.query('update timeline set report_cnt=report_cnt-1 where id = ? ', [timeline_id], function (err, result) {
                            if (err) {
                                trans.rollback(function () {
                                    console.log("update Failed");
                                    res.jsonp({"error": "update Failed"});
                                    connection.end();
                                    return;
                                });
                            } else {
                                trans.commit(function () {
                                    console.log("report_cancel complete.");
                                    res.jsonp({"message": "reportNews_cancel complete"});
                                    connection.end();

                                });
                            }
                        });

                    });
                    trans.execute();
                }
            });
    });
};